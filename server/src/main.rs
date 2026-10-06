mod api;
mod auth;
mod backups;
mod configs;
mod console;
mod logfiles;
mod metrics;
mod mods;
mod notifications;
mod paths;
mod players;
mod serverconfig;
mod settings;
mod state;
mod storage;
mod stratum;
mod supervisor;
mod versions;

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
        supervisor,
        versions: versions::VersionCache::new(http_client.clone()),
        moddb: mods::ModDbCache::new(http_client.clone()),
        mods: Arc::new(mods::ModsManager::new()),
        stratum: stratum::StratumCache::new(http_client),
        metrics: metrics::MetricsStore::default(),
        install: Mutex::new(None),
        started: std::time::Instant::now(),
    });

    tokio::spawn(state.mods.clone().run_worker(state.clone()));
    spawn_schedulers(state.clone());
    metrics::spawn_collector(state.clone());
    metrics::spawn_tps_collector(state.clone());

    // Forward supervisor events (starts, stops, crashes, players) to the
    // configured webhook, when one is set.
    {
        let notify_state = state.clone();
        tokio::spawn(async move {
            while let Some(event) = events_rx.recv().await {
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

/// Daily restart at the configured local `HH:MM`, with 5-minute and 1-minute
/// announcements through the server console.
fn spawn_schedulers(state: SharedState) {
    tokio::spawn(async move {
        let mut fired_restart: Option<String> = None;
        let mut fired_backup: Option<String> = None;
        let mut warned5: Option<String> = None;
        let mut warned1: Option<String> = None;

        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;

            let (restart_schedule, backup_schedule, backup_before_restart) = {
                let settings = state.settings.lock().unwrap();
                (
                    settings.restart_schedule.clone(),
                    settings.backup_schedule.clone(),
                    settings.backup_before_restart,
                )
            };

            // ── scheduled backups ──────────────────────────────────────────
            if let Some(schedule) = backup_schedule {
                if let Some((seconds, key)) = next_occurrence(&schedule) {
                    if seconds <= 25 && fired_backup.as_deref() != Some(&key) {
                        run_scheduled_backup(&state).await;
                        fired_backup = Some(key);
                    }
                }
            }

            // ── scheduled restarts (with optional pre-restart backup) ──────
            let Some(schedule) = restart_schedule else {
                continue;
            };
            let Some((seconds, key)) = next_occurrence(&schedule) else {
                continue;
            };
            let running = state.supervisor.is_running();

            if seconds <= 25 {
                if fired_restart.as_deref() != Some(&key) {
                    if backup_before_restart {
                        run_scheduled_backup(&state).await;
                    }
                    if running {
                        tracing::info!("scheduled restart: restarting the server now");
                        state
                            .supervisor
                            .command("/announce Server restarting now".into())
                            .await;
                        state.supervisor.restart().await;
                    }
                    fired_restart = Some(key);
                }
            } else if seconds <= 90 {
                if running && warned1.as_deref() != Some(&key) {
                    state
                        .supervisor
                        .command("/announce Server restart in 1 minute".into())
                        .await;
                    warned1 = Some(key);
                }
            } else if seconds <= 360 && running && warned5.as_deref() != Some(&key) {
                state
                    .supervisor
                    .command("/announce Server restart in 5 minutes".into())
                    .await;
                warned5 = Some(key);
            }
        }
    });
}

/// Seconds until the next local occurrence of `HH:MM`, plus a per-day dedupe key.
fn next_occurrence(schedule: &str) -> Option<(i64, String)> {
    use chrono::{Local, TimeZone};

    let (hours, minutes) = settings::parse_hhmm(schedule)?;
    let now = Local::now();
    let naive = now.date_naive().and_hms_opt(hours, minutes, 0)?;
    let mut target = Local.from_local_datetime(&naive).single()?;
    if target <= now {
        target += chrono::Duration::days(1);
    }
    Some((
        (target - now).num_seconds(),
        target.format("%Y-%m-%d %H:%M").to_string(),
    ))
}

async fn run_scheduled_backup(state: &SharedState) {
    let layout = state.layout.clone();
    let retention = state.settings.lock().unwrap().backup_retention.max(1) as usize;
    let result = tokio::task::spawn_blocking(move || {
        backups::create_scheduled_backup(&layout, retention)
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
        }
        Err(error) => {
            tracing::warn!("scheduled backup task failed: {error}");
            state
                .supervisor
                .console
                .push(format!("[manager] scheduled backup task failed: {error}"));
        }
    }
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
