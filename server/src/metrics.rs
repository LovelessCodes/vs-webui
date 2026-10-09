use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::console::now_unix;
use crate::state::SharedState;

/// 5 s sampling for 15 minutes.
pub const SAMPLE_INTERVAL_SECS: u64 = 5;
pub const SAMPLE_CAP: usize = 180;
/// How often `/stats` is sent while the server runs.
const TPS_INTERVAL_SECS: u64 = 60;
const TPS_CAPTURE_SECS: u64 = 5;

#[derive(Clone, Debug, Serialize)]
pub struct MetricSample {
    pub ts: u64,
    /// Percent of one core (may exceed 100 on multi-core saturation).
    pub cpu: f32,
    /// Resident memory in bytes.
    pub memory: u64,
    pub tps: Option<f32>,
    /// Players online at sample time.
    pub players: usize,
}

#[derive(Default)]
pub struct MetricsStore {
    samples: Mutex<VecDeque<MetricSample>>,
    last_tps: Mutex<Option<f32>>,
}

impl MetricsStore {
    pub fn push(&self, sample: MetricSample) {
        let mut samples = self.samples.lock().unwrap();
        samples.push_back(sample);
        while samples.len() > SAMPLE_CAP {
            samples.pop_front();
        }
    }

    pub fn samples(&self) -> Vec<MetricSample> {
        self.samples.lock().unwrap().iter().cloned().collect()
    }

    pub fn last(&self) -> Option<MetricSample> {
        self.samples.lock().unwrap().back().cloned()
    }

    pub fn set_tps(&self, tps: f32) {
        *self.last_tps.lock().unwrap() = Some(tps);
    }

    pub fn last_tps(&self) -> Option<f32> {
        *self.last_tps.lock().unwrap()
    }
}

/// Samples the managed server process every `SAMPLE_INTERVAL_SECS`.
pub fn spawn_collector(state: SharedState) {
    tokio::spawn(async move {
        let mut system = sysinfo::System::new();
        loop {
            tokio::time::sleep(Duration::from_secs(SAMPLE_INTERVAL_SECS)).await;

            let pid = match state.supervisor.status().pid {
                Some(pid) => pid,
                None => continue,
            };
            let sysinfo_pid = sysinfo::Pid::from_u32(pid);
            let pids = [sysinfo_pid];
            system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&pids), true);
            let Some(process) = system.process(sysinfo_pid) else {
                continue;
            };
            state.metrics.push(MetricSample {
                ts: now_unix(),
                cpu: process.cpu_usage(),
                memory: process.memory(),
                tps: state.metrics.last_tps(),
                players: state.supervisor.online_players().len(),
            });
        }
    });
}

/// Sends `/stats` every `TPS_INTERVAL_SECS` while the server runs, parsing the
/// tick rate out of its console output (best effort — the exact wording is
/// version dependent).
pub fn spawn_tps_collector(state: SharedState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(TPS_INTERVAL_SECS)).await;

            let collect = {
                let settings = state.settings.lock().unwrap();
                settings.collect_tps
            };
            if !collect || !state.supervisor.is_running() {
                continue;
            }

            let mut receiver = state.supervisor.console.subscribe();
            state.supervisor.probe_stats().await;

            let deadline = tokio::time::Instant::now() + Duration::from_secs(TPS_CAPTURE_SECS);
            let mut captured: Vec<String> = Vec::new();
            loop {
                match tokio::time::timeout_at(deadline, receiver.recv()).await {
                    Ok(Ok(line)) => captured.push(line.line),
                    _ => break,
                }
            }

            if let Some(tps) = parse_tps(&captured) {
                state.metrics.set_tps(tps);
            } else {
                tracing::debug!("tps collector found no tick rate in /stats output");
            }
        }
    });
}

/// Finds a number following a tick-rate keyword in any of the captured lines.
/// The real `/stats` output labels it `Last 2s Ticks/s`; the other spellings
/// are tolerated for older/newer builds.
fn parse_tps(lines: &[String]) -> Option<f32> {
    const KEYWORDS: [&str; 5] = [
        "ticks/s",
        "ticks per second",
        "ticks/second",
        "tick rate",
        "tps",
    ];
    for line in lines {
        let lower = line.to_lowercase();
        for keyword in KEYWORDS {
            if let Some(at) = lower.find(keyword) {
                let after = &lower[at + keyword.len()..];
                if let Some(value) = first_number(after) {
                    if (0.1..=1000.0).contains(&value) {
                        return Some(value);
                    }
                }
            }
        }
    }
    None
}

fn first_number(text: &str) -> Option<f32> {
    let mut number = String::new();
    let mut started = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() || (ch == '.' && started) {
            started = true;
            number.push(ch);
        } else if started {
            break;
        } else if ch == ':' || ch == '=' {
            continue;
        }
    }
    number.trim_end_matches('.').parse().ok()
}

/// Watches tick rate and free disk space against the configured thresholds.
/// Alerts fire once when crossing below and once on recovery (with hysteresis
/// for disk), so a sustained problem does not spam the history or webhook.
pub fn spawn_alert_monitor(state: SharedState) {
    tokio::spawn(async move {
        let mut tps_low_streak: u32 = 0;
        let mut tps_active = false;
        let mut disk_active = false;
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            tick += 1;
            let (alert_tps, tps_min, alert_disk, disk_percent) = {
                let settings = state.settings.lock().unwrap();
                (
                    settings.alert_tps,
                    settings.alert_tps_min,
                    settings.alert_disk,
                    settings.alert_disk_percent,
                )
            };

            // Tick rate: two consecutive low samples (the probe runs every
            // minute) before alerting.
            if state.supervisor.is_running() {
                if alert_tps {
                    if let Some(tps) = state.metrics.last_tps() {
                        if tps < tps_min {
                            tps_low_streak += 1;
                            if tps_low_streak >= 2 && !tps_active {
                                tps_active = true;
                                crate::notifications::alert(
                                    &state,
                                    "tps_low",
                                    format!(
                                        "Server tick rate is {tps:.1} TPS (below {tps_min:.0} TPS)"
                                    ),
                                );
                            }
                        } else {
                            tps_low_streak = 0;
                            if tps_active {
                                tps_active = false;
                                crate::notifications::alert(
                                    &state,
                                    "tps_recovered",
                                    format!("Server tick rate recovered: {tps:.1} TPS"),
                                );
                            }
                        }
                    }
                }
            } else {
                tps_low_streak = 0;
                tps_active = false;
            }

            // Disk space: checked every five minutes.
            if alert_disk && tick % 5 == 0 {
                let (free, total) = crate::storage::disk_space(&state.layout.root);
                if total > 0 {
                    let percent = (free as f64 / total as f64) * 100.0;
                    if percent < disk_percent as f64 && !disk_active {
                        disk_active = true;
                        crate::notifications::alert(
                            &state,
                            "disk_low",
                            format!(
                                "Only {percent:.1}% disk space left ({:.1} GB free, threshold {disk_percent}%)",
                                free as f64 / 1_073_741_824.0
                            ),
                        );
                    } else if percent >= disk_percent as f64 + 2.0 && disk_active {
                        disk_active = false;
                        crate::notifications::alert(
                            &state,
                            "disk_recovered",
                            format!("Disk space recovered: {percent:.1}% free"),
                        );
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tick_rate_variants() {
        // Real `/stats` output: the value follows "Last 2s Ticks/s".
        assert_eq!(
            parse_tps(&[
                "[Notification] Memory usage Managed/Total: 1200/2400 Mb".to_string(),
                "[Notification] Last 2s Average Tick Time: 12.34ms".to_string(),
                "[Notification] Last 2s Ticks/s 20".to_string(),
            ]),
            Some(20.0)
        );
        assert_eq!(
            parse_tps(&["Last 2s Ticks/s: 19.8 (avg 19.9)".to_string()]),
            Some(19.8)
        );
        assert_eq!(
            parse_tps(&["[Notification] Tick rate: 20".to_string()]),
            Some(20.0)
        );
        assert_eq!(
            parse_tps(&["Ticks per second: 19.5 (avg 19.8)".to_string()]),
            Some(19.5)
        );
        assert_eq!(parse_tps(&["TPS: 20".to_string()]), Some(20.0));
        // Only tick-time lines present: no TPS value.
        assert_eq!(
            parse_tps(&["Last 2s Average Tick Time: 12.34ms".to_string()]),
            None
        );
        // Timestamps must not be mistaken for the value.
        assert_eq!(
            parse_tps(&["20.9.2026 09:05:02 [Notification] no stats here".to_string()]),
            None
        );
    }
}
