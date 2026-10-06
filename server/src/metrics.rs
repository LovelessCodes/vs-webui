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
            state.supervisor.command("/stats".into()).await;

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
fn parse_tps(lines: &[String]) -> Option<f32> {
    const KEYWORDS: [&str; 4] = ["tick rate", "ticks per second", "ticks/second", "tps"];
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tick_rate_variants() {
        assert_eq!(
            parse_tps(&["[Notification] Tick rate: 20".to_string()]),
            Some(20.0)
        );
        assert_eq!(
            parse_tps(&["Ticks per second: 19.5 (avg 19.8)".to_string()]),
            Some(19.5)
        );
        assert_eq!(parse_tps(&["TPS: 20".to_string()]), Some(20.0));
        // Timestamps must not be mistaken for the value.
        assert_eq!(
            parse_tps(&["20.9.2026 09:05:02 [Notification] no stats here".to_string()]),
            None
        );
    }
}
