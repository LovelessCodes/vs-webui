mod api;
mod audit;
mod auth;
mod backups;
mod configs;
mod console;
mod logfiles;
mod metrics;
mod mods;
mod notifications;
mod paths;
mod playerhistory;
mod players;
mod saves;
mod serverconfig;
mod settings;
mod state;
mod storage;
mod stratum;
mod supervisor;
mod versions;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use state::SharedState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let data_root = std::env::var("VS_DATA").unwrap_or_else(|_| "/data".into());
    let layout = paths::Layout::new(data_root);
    layout.ensure()?;

    let mut settings = settings::Settings::load(&layout.settings_path());
    if let Ok(version) = std::env::var("VS_VERSION") {
        let version = version.trim().to_string();
        if !version.is_empty() && version != "latest" {
            settings.version = Some(version);
        }
    }
    if let Ok(flavor) = std::env::var("VS_FLAVOR") {
        if !flavor.trim().is_empty() {
            settings.flavor = flavor.trim().to_string();
        }
    }
    let _ = settings.save(&layout.settings_path());
    let settings = Arc::new(Mutex::new(settings));

    let auth_enabled = std::env::var("VS_WEB_AUTH")
        .map(|value| value != "off")
        .unwrap_or(true);
    let (auth, generated_password) = auth::AuthStore::new(&layout, auth_enabled);
    if let Some(password) = generated_password {
        tracing::warn!("==============================================================");
        tracing::warn!("  No VS_WEB_PASSWORD configured.");
        tracing::warn!("  Generated web UI password: {password}");
        tracing::warn!("  Save it now — it is stored hashed in /data/config/auth.json");
        tracing::warn!("==============================================================");
    }

    let http_client = reqwest::Client::builder()
        .user_agent(format!("vs-webui/{}", env!("CARGO_PKG_VERSION")))
        .build()?;

    let (events_tx, mut events_rx) =
        tokio::sync::mpsc::unbounded_channel::<supervisor::ServerEvent>();
    let supervisor = supervisor::Supervisor::spawn(layout.clone(), settings.clone(), events_tx);
    let state: SharedState = Arc::new(state::AppState {
        layout: layout.clone(),
        settings: settings.clone(),
        auth,
        audit: audit::AuditStore::load(&layout),
        notifications: notifications::NotificationStore::load(&layout.config_dir()),
        supervisor,
        versions: versions::VersionCache::new(http_client.clone()),
        moddb: mods::ModDbCache::new(http_client.clone()),
        mods: Arc::new(mods::ModsManager::new()),
        stratum: stratum::StratumCache::new(http_client),
        metrics: metrics::MetricsStore::default(),
        player_history: playerhistory::PlayerHistory::load(&layout.config_dir()),
        restore: Default::default(),
        install: Mutex::new(None),
        started: std::time::Instant::now(),
    });

    tokio::spawn(state.mods.clone().run_worker(state.clone()));
    spawn_schedulers(state.clone());
    metrics::spawn_collector(state.clone());
    metrics::spawn_tps_collector(state.clone());
    metrics::spawn_alert_monitor(state.clone());
    spawn_cache_warmer(state.clone());

    // Forward supervisor events (starts, stops, crashes, players) to the
    // configured webhook, when one is set.
    {
        let notify_state = state.clone();
        tokio::spawn(async move {
            while let Some(event) = events_rx.recv().await {
                if let Some(player) = event.player.as_deref() {
                    match event.kind {
                        "player_join" => notify_state.player_history.join(player),
                        "player_leave" => notify_state.player_history.leave(player),
                        _ => {}
                    }
                }
                notifications::notify(&notify_state, event.kind, event.text);
            }
        });
    }

    if let Some(version) = state.settings.lock().unwrap().version.clone() {
        if !state.layout.server_exe(&version).exists() {
            state.supervisor.console.push(format!(
                "[manager] version {version} is selected but not installed"
            ));
        }
    }

    let bootstrap_state = state.clone();
    tokio::spawn(async move { bootstrap(bootstrap_state).await });

    let port: u16 = std::env::var("VS_WEB_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    tracing::info!(
        "vs-webui manager listening on http://{addr} (data dir: {})",
        layout.root.display()
    );

    axum::serve(
        listener,
        api::router(state.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    tracing::info!("shutting down: stopping the game server…");
    state.supervisor.shutdown().await;
    tracing::info!("bye");
    Ok(())
}

/// `VS_AUTO_INSTALL` / `VS_AUTO_START` bootstrapping.
async fn bootstrap(state: SharedState) {
    tokio::time::sleep(Duration::from_secs(2)).await;

    if env_bool("VS_AUTO_INSTALL") {
        let selected = state.settings.lock().unwrap().version.clone();
        let version = match selected {
            Some(version) => Some(version),
            None => state
                .versions
                .list("stable")
                .await
                .ok()
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|entry| entry.latest)
                        .or_else(|| entries.first())
                        .map(|entry| entry.version.clone())
                }),
        };
        if let Some(version) = version {
            if !state.layout.server_exe(&version).exists() {
                let already_installing = {
                    let guard = state.install.lock().unwrap();
                    guard
                        .as_ref()
                        .map(|install| install.phase != "done" && install.phase != "error")
                        .unwrap_or(false)
                };
                if !already_installing {
                    {
                        let mut guard = state.install.lock().unwrap();
                        *guard = Some(versions::InstallStatus {
                            version: version.clone(),
                            phase: "starting".into(),
                            downloaded: 0,
                            total: 0,
                            message: None,
                            success: None,
                        });
                    }
                    tracing::info!("auto-installing Vintage Story {version}");
                    versions::run_install(state.clone(), version, "stable".into()).await;
                }
            }
        } else {
            tracing::error!("VS_AUTO_INSTALL is set but no version could be resolved");
        }
    }

    if env_bool("VS_AUTO_START") {
        tracing::info!("auto-starting the game server");
        state.supervisor.start().await;
    }
}

fn env_bool(name: &str) -> bool {
    std::env::var(name)
        .map(|value| value == "true" || value == "1" || value == "yes")
        .unwrap_or(false)
}

/// Runs scheduled tasks (restarts, backups, console commands) with 5- and
/// 1-minute restart announcements. Times use the configured IANA timezone, or
/// the container's local time when none is set.
fn spawn_schedulers(state: SharedState) {
    tokio::spawn(async move {
        let mut fired: HashMap<String, String> = HashMap::new();
        let mut warned5: HashMap<String, String> = HashMap::new();
        let mut warned1: HashMap<String, String> = HashMap::new();

        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;

            let (tasks, timezone) = {
                let settings = state.settings.lock().unwrap();
                (settings.tasks.clone(), settings.timezone.clone())
            };
            if tasks.is_empty() {
                continue;
            }
            let tz = timezone
                .as_deref()
                .and_then(|name| name.parse::<chrono_tz::Tz>().ok());
            let running = state.supervisor.is_running();

            for task in tasks.iter().filter(|task| task.enabled) {
                for time in &task.times {
                    let occurrence = match tz {
                        Some(tz) => {
                            next_task_occurrence(task, time, chrono::Utc::now().with_timezone(&tz))
                        }
                        None => next_task_occurrence(task, time, chrono::Local::now()),
                    };
                    let Some((seconds, key)) = occurrence else {
                        continue;
                    };
                    let already_fired = fired.get(&task.id).map(String::as_str) == Some(&key);

                    if seconds <= 25 && !already_fired {
                        fired.insert(task.id.clone(), key.clone());
                        run_task(&state, task).await;
                        if task.date.is_some() {
                            disable_task(&state, &task.id);
                        }
                    } else if task.kind == "restart" && running && !already_fired {
                        if seconds <= 90
                            && warned1.get(&task.id).map(String::as_str) != Some(&key)
                        {
                            warned1.insert(task.id.clone(), key.clone());
                            state
                                .supervisor
                                .command("/announce Server restart in 1 minute".into())
                                .await;
                        } else if seconds <= 360
                            && warned5.get(&task.id).map(String::as_str) != Some(&key)
                        {
                            warned5.insert(task.id.clone(), key.clone());
                            state
                                .supervisor
                                .command("/announce Server restart in 5 minutes".into())
                                .await;
                        }
                    }
                }
            }
        }
    });
}

async fn run_task(state: &SharedState, task: &settings::ScheduledTask) {
    match task.kind.as_str() {
        "restart" => {
            if task.backup_before {
                run_scheduled_backup(state).await;
            }
            if state.supervisor.is_running() {
                tracing::info!("scheduled restart firing (task {})", task.id);
                state
                    .supervisor
                    .command("/announce Server restarting now".into())
                    .await;
                state.supervisor.restart().await;
            } else {
                state
                    .supervisor
                    .console
                    .push("[manager] scheduled restart skipped: server is not running");
            }
        }
        "backup" => run_scheduled_backup(state).await,
        "command" => {
            let command = task.command.clone().unwrap_or_default();
            if command.is_empty() {
                return;
            }
            if state.supervisor.is_running() {
                tracing::info!("scheduled command firing (task {}): {command}", task.id);
                state.supervisor.command(command).await;
            } else {
                state.supervisor.console.push(format!(
                    "[manager] scheduled command skipped (server not running): {command}"
                ));
            }
        }
        _ => {}
    }
}

/// One-off tasks disable themselves after firing.
fn disable_task(state: &SharedState, id: &str) {
    let mut settings = state.settings.lock().unwrap();
    if let Some(task) = settings.tasks.iter_mut().find(|task| task.id == id) {
        task.enabled = false;
        if let Err(error) = settings.save(&state.layout.settings_path()) {
            tracing::warn!("failed to persist one-off task state: {error}");
        }
    }
}

/// Enabled tasks with their next firing, for the dashboard.
pub(crate) fn task_summaries(state: &SharedState) -> serde_json::Value {
    let (tasks, timezone) = {
        let settings = state.settings.lock().unwrap();
        (settings.tasks.clone(), settings.timezone.clone())
    };
    let tz = timezone
        .as_deref()
        .and_then(|name| name.parse::<chrono_tz::Tz>().ok());
    let mut summaries: Vec<(i64, serde_json::Value)> = Vec::new();
    for task in tasks.iter().filter(|task| task.enabled) {
        let next = task
            .times
            .iter()
            .filter_map(|time| match tz {
                Some(tz) => {
                    next_task_occurrence(task, time, chrono::Utc::now().with_timezone(&tz))
                }
                None => next_task_occurrence(task, time, chrono::Local::now()),
            })
            .min_by_key(|(seconds, _)| *seconds);
        if let Some((seconds, at)) = next {
            summaries.push((
                seconds,
                serde_json::json!({
                    "id": task.id,
                    "kind": task.kind,
                    "label": task.label,
                    "next": crate::console::now_unix() + seconds.max(0) as u64,
                    "at": at,
                    "backup_before": task.backup_before,
                }),
            ));
        }
    }
    summaries.sort_by_key(|(seconds, _)| *seconds);
    serde_json::Value::Array(summaries.into_iter().map(|(_, value)| value).collect())
}

/// Seconds until the next firing of `time` for `task`, honoring its date
/// (one-off) and weekday filters; the returned key dedupes firings.
fn next_task_occurrence<Tz: chrono::TimeZone>(
    task: &settings::ScheduledTask,
    time: &str,
    now: chrono::DateTime<Tz>,
) -> Option<(i64, String)> {
    use chrono::{Datelike, NaiveDate};

    let (hours, minutes) = settings::parse_hhmm(time)?;

    if let Some(date) = task.date.as_deref() {
        let naive = NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .ok()?
            .and_hms_opt(hours, minutes, 0)?;
        let target = now.timezone().from_local_datetime(&naive).earliest()?;
        let seconds = (target.clone() - now.clone()).num_seconds();
        return (seconds >= 0)
            .then(|| (seconds, target.naive_local().format("%Y-%m-%d %H:%M").to_string()));
    }

    // Today or the next matching weekday, up to a week out.
    for offset in 0..=7 {
        let day = (now.clone() + chrono::Duration::days(offset)).date_naive();
        if !task.weekdays.is_empty()
            && !task
                .weekdays
                .contains(&(day.weekday().number_from_monday() as u32))
        {
            continue;
        }
        let Some(naive) = day.and_hms_opt(hours, minutes, 0) else {
            continue;
        };
        let Some(target) = now.timezone().from_local_datetime(&naive).earliest() else {
            continue;
        };
        let seconds = (target.clone() - now.clone()).num_seconds();
        if seconds >= 0 {
            return Some((seconds, target.naive_local().format("%Y-%m-%d %H:%M").to_string()));
        }
    }
    None
}

async fn run_scheduled_backup(state: &SharedState) {
    let layout = state.layout.clone();
    let (retention, max_bytes) = {
        let settings = state.settings.lock().unwrap();
        (
            settings.backup_retention.max(1) as usize,
            settings.backup_max_bytes(),
        )
    };
    let result = tokio::task::spawn_blocking(move || {
        backups::create_scheduled_backup(&layout, retention, max_bytes)
    })
    .await;

    match result {
        Ok(Ok(name)) => {
            tracing::info!("scheduled backup created: {name}");
            state
                .supervisor
                .console
                .push(format!("[manager] scheduled backup created: {name}"));
            notifications::notify(state, "backup", format!("Backup created: {name}"));
        }
        Ok(Err(error)) => {
            tracing::warn!("scheduled backup failed: {error}");
            state
                .supervisor
                .console
                .push(format!("[manager] scheduled backup failed: {error}"));
            if state.settings.lock().unwrap().alert_backup {
                notifications::alert(
                    state,
                    "backup_failed",
                    format!("Scheduled backup failed: {error}"),
                );
            }
        }
        Err(error) => {
            tracing::warn!("scheduled backup task failed: {error}");
            state
                .supervisor
                .console
                .push(format!("[manager] scheduled backup task failed: {error}"));
            if state.settings.lock().unwrap().alert_backup {
                notifications::alert(
                    state,
                    "backup_failed",
                    format!("Scheduled backup task failed: {error}"),
                );
            }
        }
    }
}

/// Keeps the version/Stratum caches warm so `status` can report update notices
/// without doing network I/O on the request path.
fn spawn_cache_warmer(state: SharedState) {
    tokio::spawn(async move {
        // Give boot a moment before the first refresh.
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            if let Err(error) = state.versions.list("stable").await {
                tracing::debug!("stable manifest refresh failed: {error}");
            }
            if let Err(error) = state.stratum.releases().await {
                tracing::debug!("stratum release refresh failed: {error}");
            }
            tokio::time::sleep(Duration::from_secs(15 * 60)).await;
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<chrono_tz::Tz> {
        chrono_tz::UTC
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .unwrap()
    }

    #[test]
    fn task_occurrences_honor_weekdays_and_one_offs() {
        // 2026-10-13 is a Tuesday.
        let now = utc(2026, 10, 13, 10, 0);

        // Daily task: today at 12:00.
        let task = settings::ScheduledTask::restart(vec!["12:00".into()], false);
        let (seconds, key) = next_task_occurrence(&task, "12:00", now.clone()).unwrap();
        assert_eq!(seconds, 2 * 3600);
        assert_eq!(key, "2026-10-13 12:00");

        // Passed time today rolls to tomorrow.
        let (seconds, key) = next_task_occurrence(&task, "09:00", now.clone()).unwrap();
        assert_eq!(seconds, 23 * 3600);
        assert_eq!(key, "2026-10-14 09:00");

        // Mondays only: from Tuesday the next firing is six days out.
        let task = settings::ScheduledTask {
            weekdays: vec![1],
            ..settings::ScheduledTask::restart(vec!["12:00".into()], false)
        };
        let (seconds, key) = next_task_occurrence(&task, "12:00", now.clone()).unwrap();
        assert_eq!(seconds, 6 * 24 * 3600 + 2 * 3600);
        assert_eq!(key, "2026-10-19 12:00");

        // A one-off on a future date fires then; a past date never fires.
        let task = settings::ScheduledTask {
            date: Some("2026-10-14".into()),
            ..settings::ScheduledTask::restart(vec!["09:00".into()], false)
        };
        let (seconds, key) = next_task_occurrence(&task, "09:00", now.clone()).unwrap();
        assert_eq!(seconds, 23 * 3600);
        assert_eq!(key, "2026-10-14 09:00");
        let task = settings::ScheduledTask {
            date: Some("2026-10-12".into()),
            ..settings::ScheduledTask::restart(vec!["09:00".into()], false)
        };
        assert!(next_task_occurrence(&task, "09:00", now).is_none());
    }
}
