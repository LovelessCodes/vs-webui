mod api;
mod auth;
mod console;
mod paths;
mod serverconfig;
mod settings;
mod state;
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

    let supervisor = supervisor::Supervisor::spawn(layout.clone(), settings.clone());
    let state: SharedState = Arc::new(state::AppState {
        layout: layout.clone(),
        settings: settings.clone(),
        auth,
        supervisor,
        versions: versions::VersionCache::new(http_client),
        install: Mutex::new(None),
        started: std::time::Instant::now(),
    });

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
