use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::console::now_unix;
use crate::state::SharedState;

/// 5 s sampling for 15 minutes.
pub const SAMPLE_INTERVAL_SECS: u64 = 5;
pub const SAMPLE_CAP: usize = 180;
/// How often `/stats` is sent while the server runs.
const TPS_INTERVAL_SECS: u64 = 60;
const TPS_CAPTURE_SECS: u64 = 5;
/// Persisted metric files older than this are pruned.
const HISTORY_KEEP_DAYS: u64 = 30;

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    crashes: AtomicU64,
    world_bytes: AtomicU64,
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

    pub fn bump_crashes(&self) {
        self.crashes.fetch_add(1, Ordering::Relaxed);
    }

    pub fn crashes(&self) -> u64 {
        self.crashes.load(Ordering::Relaxed)
    }

    pub fn set_world_bytes(&self, bytes: u64) {
        self.world_bytes.store(bytes, Ordering::Relaxed);
    }

    pub fn world_bytes(&self) -> u64 {
        self.world_bytes.load(Ordering::Relaxed)
    }
}

/// One downsampled point for long-range charts.
#[derive(Clone, Debug, Serialize)]
pub struct HistoryPoint {
    pub ts: u64,
    pub cpu: f32,
    pub memory: u64,
    pub tps: Option<f32>,
    pub players: f32,
}

#[derive(Default)]
struct Bucket {
    cpu: f64,
    memory: u64,
    tps: f64,
    tps_count: u64,
    players: u64,
    count: u64,
}

impl Bucket {
    fn add(&mut self, sample: &MetricSample) {
        self.cpu += f64::from(sample.cpu);
        self.memory += sample.memory;
        if let Some(tps) = sample.tps {
            self.tps += f64::from(tps);
            self.tps_count += 1;
        }
        self.players += sample.players as u64;
        self.count += 1;
    }

    fn finish(&self, ts: u64) -> HistoryPoint {
        let count = self.count.max(1) as f64;
        HistoryPoint {
            ts,
            cpu: (self.cpu / count) as f32,
            memory: self.memory / self.count.max(1),
            tps: (self.tps_count > 0).then(|| (self.tps / self.tps_count as f64) as f32),
            players: (self.players as f64 / count) as f32,
        }
    }
}

fn history_dir(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join("metrics")
}

/// Appends a sample to today's JSONL file (UTC naming).
pub async fn append_sample(config_dir: &Path, sample: &MetricSample) {
    let dir = history_dir(config_dir);
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return;
    }
    let name = format!("metrics-{}.jsonl", chrono::Utc::now().format("%Y%m%d"));
    let Ok(mut line) = serde_json::to_string(sample) else {
        return;
    };
    line.push('\n');
    let path = dir.join(name);
    if let Ok(mut file) = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
    {
        let _ = tokio::io::AsyncWriteExt::write_all(&mut file, line.as_bytes()).await;
    }
}

/// Reads the persisted samples of the last `hours`, downsampled to at most
/// 240 points (blocking; call from a blocking task).
pub fn history(config_dir: &Path, hours: u64) -> Vec<HistoryPoint> {
    let hours = hours.clamp(1, HISTORY_KEEP_DAYS * 24);
    let now = now_unix();
    let from = now.saturating_sub(hours * 3600);
    let width = ((hours * 3600) / 240).max(1);
    let dir = history_dir(config_dir);

    let mut buckets: std::collections::HashMap<u64, Bucket> = std::collections::HashMap::new();
    let days = hours.div_ceil(24) + 1;
    for offset in 0..days {
        let day = chrono::Utc::now() - chrono::Duration::days(offset as i64);
        let path = dir.join(format!("metrics-{}.jsonl", day.format("%Y%m%d")));
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in raw.lines() {
            let Ok(sample) = serde_json::from_str::<MetricSample>(line) else {
                continue;
            };
            if sample.ts < from {
                continue;
            }
            buckets
                .entry(sample.ts / width)
                .or_default()
                .add(&sample);
        }
    }

    let mut points: Vec<HistoryPoint> = buckets
        .into_iter()
        .map(|(bucket, acc)| acc.finish(bucket * width + width / 2))
        .collect();
    points.sort_by_key(|point| point.ts);
    points
}

/// Removes metric files older than the retention window.
pub fn prune_history(config_dir: &Path) {
    let dir = history_dir(config_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let cutoff = chrono::Utc::now() - chrono::Duration::days(HISTORY_KEEP_DAYS as i64);
    let cutoff_name = format!("metrics-{}.jsonl", cutoff.format("%Y%m%d"));
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("metrics-") && name.ends_with(".jsonl") && name < cutoff_name {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Samples the managed server process every `SAMPLE_INTERVAL_SECS`; samples
/// are also appended to the persisted history and the world size is refreshed
/// every five minutes.
pub fn spawn_collector(state: SharedState) {
    tokio::spawn(async move {
        let mut system = sysinfo::System::new();
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(SAMPLE_INTERVAL_SECS)).await;
            tick += 1;

            if tick % 60 == 0 {
                // World size + history pruning are slow-ish; do them rarely.
                let layout = state.layout.clone();
                let bytes = tokio::task::spawn_blocking(move || {
                    crate::storage::dir_size(&layout.server_dir().join("Saves"))
                })
                .await
                .unwrap_or(0);
                state.metrics.set_world_bytes(bytes);
                let config_dir = state.layout.config_dir();
                let _ = tokio::task::spawn_blocking(move || prune_history(&config_dir)).await;
            }

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
            let sample = MetricSample {
                ts: now_unix(),
                cpu: process.cpu_usage(),
                memory: process.memory(),
                tps: state.metrics.last_tps(),
                players: state.supervisor.online_players().len(),
            };
            append_sample(&state.layout.config_dir(), &sample).await;
            state.metrics.push(sample);
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

/// Connect check against the game port; true when the server accepts a TCP
/// connection within a short timeout.
pub async fn probe_port(port: u16) -> bool {
    tokio::time::timeout(
        Duration::from_secs(5),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    .map(|result| result.is_ok())
    .unwrap_or(false)
}

/// Watches tick rate and free disk space against the configured thresholds.
/// Alerts fire once when crossing below and once on recovery (with hysteresis
/// for disk), so a sustained problem does not spam the history or webhook.
pub fn spawn_alert_monitor(state: SharedState) {
    tokio::spawn(async move {
        let mut tps_low_streak: u32 = 0;
        let mut tps_active = false;
        let mut disk_active = false;
        let mut tcp_failures: u32 = 0;
        let mut tcp_active = false;
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

            // Game-port probe: the process can be up while the server no
            // longer accepts connections. Only probe once startup settled.
            if state.supervisor.is_running() {
                let running_for = state
                    .supervisor
                    .status()
                    .started_at
                    .map(|started| now_unix().saturating_sub(started))
                    .unwrap_or(0);
                if running_for > 90 {
                    let port = crate::serverconfig::port(&state.layout).unwrap_or(42420);
                    let healthy = probe_port(port).await;
                    if healthy {
                        tcp_failures = 0;
                        if tcp_active {
                            tcp_active = false;
                            crate::notifications::notify(
                                &state,
                                "server_responsive",
                                format!("Game port {port} accepts connections again"),
                            );
                        }
                    } else {
                        tcp_failures += 1;
                        if tcp_failures >= 3 && !tcp_active {
                            tcp_active = true;
                            crate::notifications::alert(
                                &state,
                                "server_unresponsive",
                                format!(
                                    "Game port {port} is not accepting connections (the server process is up)"
                                ),
                            );
                        }
                    }
                }
            } else {
                tcp_failures = 0;
                tcp_active = false;
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

    #[test]
    fn history_downsamples_persisted_samples() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-metrics-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let metrics_dir = dir.join("metrics");
        std::fs::create_dir_all(&metrics_dir).unwrap();

        let now = now_unix();
        let name = format!("metrics-{}.jsonl", chrono::Utc::now().format("%Y%m%d"));
        let mut body = String::new();
        for index in 0..100 {
            let sample = MetricSample {
                ts: now - index * 30,
                cpu: 10.0 + index as f32,
                memory: 1000,
                tps: Some(20.0),
                players: 2,
            };
            body.push_str(&serde_json::to_string(&sample).unwrap());
            body.push('\n');
        }
        body.push_str("not json\n");
        std::fs::write(metrics_dir.join(name), body).unwrap();

        let points = history(&dir, 1);
        assert!(!points.is_empty());
        assert!(points.len() <= 240);
        // Newest bucket is close to now; averages are within the input range.
        let newest = points.last().unwrap();
        assert!(newest.ts > now - 3600);
        assert!(newest.cpu >= 10.0 && newest.cpu <= 110.0);
        assert_eq!(newest.tps, Some(20.0));
        assert_eq!(newest.players, 2.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn probes_open_and_closed_ports() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(probe_port(port).await);
        drop(listener);
        assert!(!probe_port(port).await);
    }
}
