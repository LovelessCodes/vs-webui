use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, FromRequestParts, Path as UrlPath, Query, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use futures_util::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::console::LogLine;
use crate::mods::{self, InstalledMod, NewJob};
use crate::state::SharedState;
use crate::versions::{InstallStatus, CHANNELS};

const COOKIE_NAME: &str = "vs_session";
const SESSION_MAX_AGE: u64 = 60 * 60 * 24 * 30;

pub fn router(state: SharedState) -> Router {
    let dist = std::env::var("VS_WEB_DIST").unwrap_or_else(|_| "/app/web".into());
    let index = format!("{dist}/index.html");

    Router::new()
        .route("/api/health", get(health))
        .route("/api/login", post(login))
        .route("/api/me", get(me))
        .route("/api/logout", post(logout))
        .route("/api/password", put(change_password))
        .route("/api/status", get(status))
        .route("/api/server/start", post(start))
        .route("/api/server/stop", post(stop))
        .route("/api/server/restart", post(restart))
        .route("/api/server/command", post(command))
        .route("/api/server/version", post(set_active_version))
        .route("/api/console/history", get(console_history))
        .route("/api/console/stream", get(console_stream))
        .route("/api/versions", get(list_versions))
        .route("/api/versions/install", post(install_version))
        .route("/api/versions/{version}", delete(delete_version))
        .route("/api/storage", get(storage_view))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/webhook/test", post(test_webhook))
        .route("/api/tokens", get(list_tokens).post(create_token))
        .route("/api/tokens/{id}", delete(revoke_token))
        .route("/api/metrics", get(metrics_history))
        .route("/metrics", get(prometheus_metrics))
        .route(
            "/api/serverconfig",
            get(get_serverconfig).put(put_serverconfig),
        )
        .route("/api/modb/mods", get(modb_mods))
        .route("/api/modb/tags", get(modb_tags))
        .route("/api/modb/gameversions", get(modb_gameversions))
        .route("/api/modb/mod/{modid}", get(modb_detail))
        .route("/api/mods/installed", get(mods_installed))
        .route("/api/mods/updates", get(mods_updates))
        .route("/api/mods/jobs", get(mods_jobs))
        .route("/api/mods/install", post(mods_install))
        .route("/api/mods/remove", post(mods_remove))
        .route("/api/mods/update", post(mods_update))
        .route("/api/mods/update-all", post(mods_update_all))
        .route("/api/mods/pin", post(mods_pin))
        .route("/api/mods/favorite", post(mods_favorite))
        .route("/api/configs", get(list_configs))
        .route("/api/configs/{filename}", put(save_config))
        .route("/api/stratum/releases", get(stratum_releases))
        .route("/api/stratum/install", post(stratum_install))
        .route("/api/stratum/{tag}", delete(delete_stratum_release))
        .route("/api/stratum/configs", get(stratum_configs))
        .route("/api/stratum/configs/{filename}", put(save_stratum_config))
        .route("/api/server/flavor", post(set_flavor))
        .route("/api/players", get(players_view))
        .route("/api/whitelist/mode", post(set_whitelist_mode))
        .route("/api/backups", get(list_backups).post(create_backup))
        .route("/api/backups/{name}/restore", post(restore_backup))
        .route("/api/backups/{name}/download", get(download_backup))
        .route("/api/backups/{name}", delete(delete_backup))
        .route("/api/logs", get(list_logs))
        .route("/api/logs/{name}", get(read_log))
        .route("/api/logs/{name}/download", get(download_log))
        .fallback_service(ServeDir::new(&dist).fallback(ServeFile::new(&index)))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

// ── errors ──────────────────────────────────────────────────────────────────

pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Not logged in.")
    }

    fn forbidden() -> Self {
        Self::new(StatusCode::FORBIDDEN, "Invalid CSRF token.")
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

// ── auth extraction ─────────────────────────────────────────────────────────

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    for pair in raw.split(';') {
        let pair = pair.trim();
        if let Some(value) = pair.strip_prefix(&format!("{COOKIE_NAME}=")) {
            return Some(value.to_string());
        }
    }
    None
}

fn session_cookie(token: &str) -> String {
    let secure = std::env::var("VS_SECURE_COOKIE")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);
    format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_MAX_AGE}{}",
        if secure { "; Secure" } else { "" }
    )
}

fn clear_cookie() -> String {
    format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
}

/// Valid session (or auth disabled). Mutating methods must carry the CSRF header.
pub struct Authed {
    pub token: Option<String>,
}

impl FromRequestParts<SharedState> for Authed {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &SharedState,
    ) -> Result<Self, Self::Rejection> {
        if !state.auth.enabled() {
            return Ok(Self { token: None });
        }
        // Bearer tokens authenticate automation; there is no cookie to protect
        // against CSRF, so the header check does not apply to them.
        let bearer = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(bearer) = bearer {
            if state.auth.verify_token(bearer) {
                return Ok(Self { token: None });
            }
            return Err(ApiError::unauthorized());
        }
        let token = cookie_token(&parts.headers).ok_or_else(ApiError::unauthorized)?;
        let session = state
            .auth
            .session(&token)
            .ok_or_else(ApiError::unauthorized)?;
        if parts.method != axum::http::Method::GET && parts.method != axum::http::Method::HEAD {
            let csrf = parts
                .headers
                .get("x-csrf-token")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if csrf != session.csrf {
                return Err(ApiError::forbidden());
            }
        }
        Ok(Self { token: Some(token) })
    }
}

// ── request bodies ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginReq {
    password: String,
}

#[derive(Deserialize)]
struct CommandReq {
    command: String,
}

#[derive(Deserialize)]
struct InstallReq {
    version: String,
    #[serde(default = "default_channel")]
    channel: String,
}

#[derive(Deserialize)]
struct VersionReq {
    version: String,
}

#[derive(Deserialize)]
struct SettingsReq {
    #[serde(default)]
    auto_start: bool,
    #[serde(default)]
    auto_restart: bool,
    #[serde(default)]
    start_params: String,
    #[serde(default)]
    restart_schedule: Option<String>,
    #[serde(default)]
    backup_schedule: Option<String>,
    #[serde(default)]
    backup_before_restart: Option<bool>,
    #[serde(default)]
    backup_retention: Option<u32>,
    #[serde(default)]
    webhook_url: Option<String>,
    #[serde(default)]
    webhook_events: Option<Vec<String>>,
    #[serde(default)]
    collect_tps: Option<bool>,
}

#[derive(Deserialize)]
struct PasswordReq {
    current: Option<String>,
    new: String,
}

#[derive(Deserialize)]
struct ConfigReq {
    content: String,
}

#[derive(Deserialize)]
struct ChannelQuery {
    #[serde(default = "default_channel")]
    channel: String,
}

#[derive(Deserialize)]
struct HistoryQuery {
    limit: Option<usize>,
}

fn default_channel() -> String {
    "stable".into()
}

// ── handlers ────────────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "manager": env!("CARGO_PKG_VERSION") }))
}

async fn me(State(state): State<SharedState>, headers: HeaderMap) -> Json<Value> {
    if !state.auth.enabled() {
        return Json(json!({ "authenticated": true, "auth_disabled": true, "csrf": null }));
    }
    match cookie_token(&headers).and_then(|token| state.auth.session(&token)) {
        Some(session) => Json(json!({ "authenticated": true, "csrf": session.csrf })),
        None => Json(json!({ "authenticated": false, "csrf": null })),
    }
}

async fn login(
    State(state): State<SharedState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<LoginReq>,
) -> Result<Response, ApiError> {
    if !state.auth.enabled() {
        return Ok(Json(json!({ "ok": true })).into_response());
    }
    match state.auth.login(&req.password, &addr.ip().to_string()) {
        Ok(ok) => {
            let mut response = Json(json!({ "ok": true, "csrf": ok.csrf })).into_response();
            if let Ok(value) = session_cookie(&ok.token).parse() {
                response.headers_mut().insert(header::SET_COOKIE, value);
            }
            Ok(response)
        }
        Err("too_many_attempts") => Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Try again in a minute.",
        )),
        Err(_) => Err(ApiError::new(StatusCode::UNAUTHORIZED, "Invalid password.")),
    }
}

async fn logout(State(state): State<SharedState>, authed: Authed) -> Result<Response, ApiError> {
    if let Some(token) = authed.token {
        state.auth.logout(&token);
    }
    let mut response = Json(json!({ "ok": true })).into_response();
    if let Ok(value) = clear_cookie().parse() {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    Ok(response)
}

async fn change_password(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<PasswordReq>,
) -> Result<Json<Value>, ApiError> {
    state
        .auth
        .change_password(req.current.as_deref(), &req.new)
        .map_err(ApiError::bad_request)?;
    Ok(Json(json!({ "ok": true })))
}

async fn status(State(state): State<SharedState>) -> Json<Value> {
    let mut supervisor = state.supervisor.status();
    let settings = state.settings.lock().unwrap().clone();
    // The supervisor computes `not_installed` once at boot; refresh it once the
    // selected build has been installed (or removed).
    if supervisor.status == "not_installed" {
        if settings.flavor == "stratum" {
            if let Some(tag) = settings.stratum_tag.as_deref() {
                if state.layout.stratum_exe(tag).exists() {
                    supervisor.status = "stopped".into();
                    supervisor.version = Some(tag.to_string());
                }
            }
        } else if let Some(version) = settings.version.as_deref() {
            if state.layout.server_exe(version).exists() {
                supervisor.status = "stopped".into();
                supervisor.version = Some(version.to_string());
            }
        }
    }
    let install = state.install.lock().unwrap().clone();
    let config = crate::serverconfig::read(&state.layout)
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let config_summary = config.as_ref().map(|config| {
        json!({
            "server_name": config.get("ServerName").cloned().unwrap_or(Value::Null),
            "port": config.get("Port").cloned().unwrap_or(Value::Null),
            "max_clients": config.get("MaxClients").cloned().unwrap_or(Value::Null),
            "password_protected": config
                .get("Password")
                .and_then(Value::as_str)
                .map(|p| !p.is_empty())
                .unwrap_or(false),
        })
    });

    Json(json!({
        "status": supervisor,
        "settings": settings,
        "install": install,
        "config": config_summary,
        "manager": {
            "version": env!("CARGO_PKG_VERSION"),
            "uptime": state.started.elapsed().as_secs(),
            "data_dir": state.layout.root,
            "auth_enabled": state.auth.enabled(),
        }
    }))
}

async fn start(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    state.supervisor.start().await;
    Json(json!({ "ok": true }))
}

async fn stop(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    state.supervisor.stop().await;
    Json(json!({ "ok": true }))
}

async fn restart(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    state.supervisor.restart().await;
    Json(json!({ "ok": true }))
}

async fn command(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<CommandReq>,
) -> Result<Json<Value>, ApiError> {
    let command = req.command.trim().to_string();
    if command.is_empty() {
        return Err(ApiError::bad_request("empty command"));
    }
    state.supervisor.command(command).await;
    Ok(Json(json!({ "ok": true })))
}

async fn console_history(
    State(state): State<SharedState>,
    _authed: Authed,
    Query(query): Query<HistoryQuery>,
) -> Json<Value> {
    let limit = query.limit.unwrap_or(500).min(2000);
    let lines: Vec<LogLine> = state.supervisor.console.history(limit);
    Json(json!({ "lines": lines }))
}

async fn console_stream(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.supervisor.console.subscribe();
    let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(line) => {
                    let event = Event::default()
                        .json_data(&line)
                        .unwrap_or_else(|_| Event::default().comment("log"));
                    return Some((Ok(event), receiver));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

fn installed_versions(state: &SharedState) -> HashSet<String> {
    std::fs::read_dir(state.layout.vanilla_dir())
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| {
                    entry.path().is_dir() && crate::paths::is_server_install(&entry.path())
                })
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

async fn list_versions(
    State(state): State<SharedState>,
    _authed: Authed,
    Query(query): Query<ChannelQuery>,
) -> Result<Json<Value>, ApiError> {
    if !CHANNELS.contains(&query.channel.as_str()) {
        return Err(ApiError::bad_request("unknown channel"));
    }
    let entries = state
        .versions
        .list(&query.channel)
        .await
        .map_err(|message| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("manifest unavailable: {message}"),
            )
        })?;
    let installed = installed_versions(&state);
    let active = state.settings.lock().unwrap().version.clone();

    let versions: Vec<Value> = entries
        .into_iter()
        .map(|entry| {
            json!({
                "version": entry.version,
                "size": entry.size,
                "latest": entry.latest,
                "installed": installed.contains(&entry.version),
                "active": active.as_deref() == Some(entry.version.as_str()),
            })
        })
        .collect();

    Ok(Json(
        json!({ "channel": query.channel, "versions": versions }),
    ))
}

async fn install_version(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<InstallReq>,
) -> Result<Json<Value>, ApiError> {
    if !CHANNELS.contains(&req.channel.as_str()) {
        return Err(ApiError::bad_request("unknown channel"));
    }
    {
        let guard = state.install.lock().unwrap();
        if let Some(install) = guard.as_ref() {
            if install.phase != "done" && install.phase != "error" {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "an install is already running",
                ));
            }
        }
    }
    let entries = state
        .versions
        .list(&req.channel)
        .await
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))?;
    if !entries.iter().any(|entry| entry.version == req.version) {
        return Err(ApiError::bad_request(format!(
            "version {} not found in the {} channel",
            req.version, req.channel
        )));
    }

    {
        let mut guard = state.install.lock().unwrap();
        *guard = Some(InstallStatus {
            version: req.version.clone(),
            phase: "starting".into(),
            downloaded: 0,
            total: 0,
            message: None,
            success: None,
        });
    }
    let shared: SharedState = Arc::clone(&state);
    tokio::spawn(crate::versions::run_install(
        shared,
        req.version.clone(),
        req.channel.clone(),
    ));
    Ok(Json(json!({ "ok": true, "version": req.version })))
}

async fn set_active_version(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<VersionReq>,
) -> Result<Json<Value>, ApiError> {
    if !state.layout.server_exe(&req.version).exists() {
        return Err(ApiError::bad_request(format!(
            "version {} is not installed",
            req.version
        )));
    }
    let settings = {
        let mut guard = state.settings.lock().unwrap();
        guard.version = Some(req.version.clone());
        let _ = guard.save(&state.layout.settings_path());
        guard.clone()
    };
    Ok(Json(json!({ "ok": true, "settings": settings })))
}

async fn get_settings(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    let settings = state.settings.lock().unwrap().clone();
    Json(json!(settings))
}

async fn put_settings(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<SettingsReq>,
) -> Result<Json<Value>, ApiError> {
    let schedule = match req.restart_schedule {
        None => None,
        Some(value) if value.trim().is_empty() => Some(None),
        Some(value) => {
            if crate::settings::parse_hhmm(&value).is_none() {
                return Err(ApiError::bad_request("restart time must look like 04:30"));
            }
            Some(Some(value.trim().to_string()))
        }
    };
    let backup_schedule = match req.backup_schedule {
        None => None,
        Some(value) if value.trim().is_empty() => Some(None),
        Some(value) => {
            if crate::settings::parse_hhmm(&value).is_none() {
                return Err(ApiError::bad_request("backup time must look like 04:30"));
            }
            Some(Some(value.trim().to_string()))
        }
    };
    let webhook_url = match req.webhook_url {
        None => None,
        Some(value) if value.trim().is_empty() => Some(None),
        Some(value) => {
            let parsed = reqwest::Url::parse(value.trim())
                .map_err(|error| ApiError::bad_request(format!("invalid webhook URL: {error}")))?;
            if parsed.scheme() != "http" && parsed.scheme() != "https" {
                return Err(ApiError::bad_request("webhook URL must be http(s)"));
            }
            Some(Some(value.trim().to_string()))
        }
    };
    let webhook_events = req.webhook_events.map(|events| {
        events
            .into_iter()
            .filter(|event| crate::notifications::EVENTS.contains(&event.as_str()))
            .collect::<Vec<_>>()
    });
    let retention = match req.backup_retention {
        None => None,
        Some(value) if (1..=100).contains(&value) => Some(value),
        Some(_) => {
            return Err(ApiError::bad_request(
                "backup retention must be between 1 and 100",
            ))
        }
    };
    let settings = {
        let mut guard = state.settings.lock().unwrap();
        guard.auto_start = req.auto_start;
        guard.auto_restart = req.auto_restart;
        guard.start_params = req.start_params;
        if let Some(schedule) = schedule {
            guard.restart_schedule = schedule;
        }
        if let Some(schedule) = backup_schedule {
            guard.backup_schedule = schedule;
        }
        if let Some(before) = req.backup_before_restart {
            guard.backup_before_restart = before;
        }
        if let Some(url) = webhook_url {
            guard.webhook_url = url;
        }
        if let Some(events) = webhook_events {
            guard.webhook_events = events;
        }
        if let Some(collect) = req.collect_tps {
            guard.collect_tps = collect;
        }
        if let Some(retention) = retention {
            guard.backup_retention = retention;
        }
        guard
            .save(&state.layout.settings_path())
            .map_err(|e| ApiError::internal(format!("cannot save settings: {e}")))?;
        guard.clone()
    };
    Ok(Json(json!(settings)))
}

async fn test_webhook(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let url = state
        .settings
        .lock()
        .unwrap()
        .webhook_url
        .clone()
        .ok_or_else(|| ApiError::bad_request("no webhook URL configured"))?;
    crate::notifications::send(&url, "test", "vs-webui test notification")
        .await
        .map_err(ApiError::bad_request)?;
    Ok(Json(json!({ "ok": true })))
}

// ── API tokens ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TokenCreateReq {
    label: String,
}

async fn list_tokens(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    Json(json!({ "tokens": state.auth.tokens() }))
}

async fn create_token(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<TokenCreateReq>,
) -> Result<Json<Value>, ApiError> {
    let label = req.label.trim().to_string();
    if label.is_empty() {
        return Err(ApiError::bad_request("missing label"));
    }
    if label.chars().count() > 64 {
        return Err(ApiError::bad_request("label is too long"));
    }
    let (token, plaintext) = state.auth.create_token(&label);
    Ok(Json(json!({
        "token": {
            "id": token.id,
            "label": token.label,
            "created": token.created,
            "last_used": token.last_used,
        },
        "plaintext": plaintext,
    })))
}

async fn revoke_token(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(id): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    if !state.auth.revoke_token(&id) {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "token not found"));
    }
    Ok(Json(json!({ "ok": true })))
}

// ── metrics ─────────────────────────────────────────────────────────────────

async fn metrics_history(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    Json(json!({
        "running": state.supervisor.is_running(),
        "samples": state.metrics.samples(),
    }))
}

async fn prometheus_metrics(
    State(state): State<SharedState>,
    _authed: Authed,
) -> impl axum::response::IntoResponse {
    let running = state.supervisor.is_running();
    let last = state.metrics.last();
    let tps = state.metrics.last_tps();
    let body = format!(
        "# HELP vs_webui_server_running Whether the game server process is running.\n\
         # TYPE vs_webui_server_running gauge\n\
         vs_webui_server_running {}\n\
         # HELP vs_webui_server_cpu_percent CPU usage of the game server process (percent of one core).\n\
         # TYPE vs_webui_server_cpu_percent gauge\n\
         vs_webui_server_cpu_percent {:.2}\n\
         # HELP vs_webui_server_memory_bytes Resident memory of the game server process.\n\
         # TYPE vs_webui_server_memory_bytes gauge\n\
         vs_webui_server_memory_bytes {}\n\
         # HELP vs_webui_server_tps Ticks per second reported by /stats.\n\
         # TYPE vs_webui_server_tps gauge\n\
         vs_webui_server_tps {}\n",
        if running { 1 } else { 0 },
        last.as_ref().map(|sample| sample.cpu).unwrap_or_default(),
        last.as_ref().map(|sample| sample.memory).unwrap_or_default(),
        tps.map(|value| format!("{value:.2}"))
            .unwrap_or_else(|| "NaN".into()),
    );
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}

async fn get_serverconfig(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    let missing = !crate::serverconfig::config_path(&state.layout).exists();
    let content = crate::serverconfig::read(&state.layout).unwrap_or_else(|| "{}".into());
    let value: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    Json(json!({ "content": content, "value": value, "missing": missing }))
}

async fn put_serverconfig(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<ConfigReq>,
) -> Result<Json<Value>, ApiError> {
    crate::serverconfig::write(&state.layout, &req.content).map_err(ApiError::bad_request)?;
    Ok(Json(json!({
        "ok": true,
        "restart_required": state.supervisor.is_running(),
    })))
}

// ── mods ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ModbModsQuery {
    /// Comma-separated game versions (ModDB expects one `gameversions[]` each).
    versions: Option<String>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct ModInstallReq {
    modid: String,
    version: Option<String>,
    constraint: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct ModRemoveReq {
    file: String,
}

#[derive(Deserialize)]
struct ModUpdateReq {
    modid: String,
    version: String,
    file: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct ModPinReq {
    modid: String,
    pinned: bool,
}

#[derive(Deserialize)]
struct ModFavoriteReq {
    modid: String,
    favorite: bool,
}

async fn modb_mods(
    State(state): State<SharedState>,
    _authed: Authed,
    Query(query): Query<ModbModsQuery>,
) -> Result<Json<Value>, ApiError> {
    let text = query.text.unwrap_or_default();
    let versions: Vec<String> = query
        .versions
        .unwrap_or_default()
        .split(',')
        .map(|version| version.trim().to_string())
        .filter(|version| !version.is_empty())
        .collect();
    state
        .moddb
        .mods(&versions, &text)
        .await
        .map(Json)
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn modb_gameversions(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    state
        .moddb
        .gameversions()
        .await
        .map(Json)
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn delete_version(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(version): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    if state.supervisor.is_running() {
        return Err(ApiError::bad_request(
            "stop the server before deleting builds",
        ));
    }
    if state.settings.lock().unwrap().version.as_deref() == Some(version.as_str()) {
        return Err(ApiError::bad_request(
            "this build is selected; switch to another version first",
        ));
    }
    let layout = state.layout.clone();
    tokio::task::spawn_blocking(move || crate::versions::delete_version(&layout, &version))
        .await
        .map_err(|e| ApiError::internal(format!("delete task failed: {e}")))?
        .map_err(ApiError::bad_request)?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_stratum_release(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(tag): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    if state.supervisor.is_running() {
        return Err(ApiError::bad_request(
            "stop the server before deleting builds",
        ));
    }
    if state.settings.lock().unwrap().stratum_tag.as_deref() == Some(tag.as_str()) {
        return Err(ApiError::bad_request(
            "this release is selected; install or pick another one first",
        ));
    }
    let layout = state.layout.clone();
    tokio::task::spawn_blocking(move || crate::stratum::delete_release(&layout, &tag))
        .await
        .map_err(|e| ApiError::internal(format!("delete task failed: {e}")))?
        .map_err(ApiError::bad_request)?;
    Ok(Json(json!({ "ok": true })))
}

async fn storage_view(State(state): State<SharedState>, _authed: Authed) -> Result<Json<Value>, ApiError> {
    let layout = state.layout.clone();
    let view = tokio::task::spawn_blocking(move || crate::storage::storage_view(&layout))
        .await
        .map_err(|e| ApiError::internal(format!("storage task failed: {e}")))?;
    Ok(Json(json!(view)))
}

async fn modb_tags(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    state
        .moddb
        .tags()
        .await
        .map(Json)
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn modb_detail(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(modid): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    state
        .moddb
        .detail(&modid)
        .await
        .map(Json)
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn scan_mods_blocking(state: &SharedState) -> Result<mods::ModScan, ApiError> {
    let layout = state.layout.clone();
    tokio::task::spawn_blocking(move || mods::scan_mods(&layout.server_dir().join(mods::MODS_DIR)))
        .await
        .map_err(|e| ApiError::internal(format!("mod scan failed: {e}")))
}

async fn mods_installed(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let scan = scan_mods_blocking(&state).await?;
    Ok(Json(json!(scan)))
}

async fn mods_updates(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let scan = scan_mods_blocking(&state).await?;
    let pinned = state.settings.lock().unwrap().pinned_mods.clone();
    state
        .moddb
        .updates(&scan.mods, &pinned)
        .await
        .map(Json)
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn mods_jobs(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    Json(json!({ "jobs": state.mods.jobs() }))
}

async fn create_backup_blocking(state: &SharedState) -> Result<String, ApiError> {
    let layout = state.layout.clone();
    let retention = state.settings.lock().unwrap().backup_retention.max(1) as usize;
    tokio::task::spawn_blocking(move || mods::create_mods_backup(&layout, retention))
        .await
        .map_err(|e| ApiError::internal(format!("backup task failed: {e}")))?
        .map_err(ApiError::internal)
}

async fn mods_install(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<ModInstallReq>,
) -> Result<Json<Value>, ApiError> {
    let modid = req.modid.trim().to_string();
    if modid.is_empty() {
        return Err(ApiError::bad_request("missing mod id"));
    }
    if state.mods.has_pending(&modid) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "a job for this mod is already queued",
        ));
    }
    let backup = create_backup_blocking(&state).await?;
    let job_id = state.mods.enqueue(NewJob {
        action: "install".into(),
        modid: modid.clone(),
        name: req.name.unwrap_or_else(|| modid.clone()),
        version: req.version,
        file: None,
        constraint: req.constraint,
        dependency: false,
    });
    Ok(Json(json!({ "job_id": job_id, "backup": backup })))
}

async fn mods_remove(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<ModRemoveReq>,
) -> Result<Json<Value>, ApiError> {
    let file = req.file.trim().to_string();
    if file.is_empty()
        || file.contains('/')
        || file.contains('\\')
        || !file.to_lowercase().ends_with(".zip")
    {
        return Err(ApiError::bad_request("invalid mod file name"));
    }
    let path = state.layout.server_dir().join(mods::MODS_DIR).join(&file);
    if !path.is_file() {
        return Err(ApiError::bad_request(format!("{file} is not installed")));
    }
    let backup = create_backup_blocking(&state).await?;
    let job_id = state.mods.enqueue(NewJob {
        action: "remove".into(),
        modid: file.clone(),
        name: file.clone(),
        version: None,
        file: Some(file),
        constraint: None,
        dependency: false,
    });
    Ok(Json(json!({ "job_id": job_id, "backup": backup })))
}

async fn mods_update(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<ModUpdateReq>,
) -> Result<Json<Value>, ApiError> {
    let modid = req.modid.trim().to_string();
    if modid.is_empty() || req.version.trim().is_empty() {
        return Err(ApiError::bad_request("missing mod id or version"));
    }
    if state.mods.has_pending(&modid) {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "a job for this mod is already queued",
        ));
    }
    let backup = create_backup_blocking(&state).await?;
    let job_id = state.mods.enqueue(NewJob {
        action: "update".into(),
        modid: modid.clone(),
        name: req.name.unwrap_or_else(|| modid.clone()),
        version: Some(req.version),
        file: Some(req.file),
        constraint: None,
        dependency: false,
    });
    Ok(Json(json!({ "job_id": job_id, "backup": backup })))
}

async fn mods_update_all(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let scan = scan_mods_blocking(&state).await?;
    let pinned: HashSet<String> = state
        .settings
        .lock()
        .unwrap()
        .pinned_mods
        .iter()
        .map(|id| id.to_lowercase())
        .collect();
    let pinned_list = state.settings.lock().unwrap().pinned_mods.clone();
    let updates_value = state
        .moddb
        .updates(&scan.mods, &pinned_list)
        .await
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))?;
    let updates = updates_value
        .get("updates")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let installed_by_id: HashMap<String, &InstalledMod> = scan
        .mods
        .iter()
        .map(|module| (module.modid.to_lowercase(), module))
        .collect();

    let mut targets: Vec<(InstalledMod, String)> = Vec::new();
    for (key, value) in &updates {
        if pinned.contains(key) {
            continue;
        }
        let Some(installed) = installed_by_id.get(key) else {
            continue;
        };
        if state.mods.has_pending(&installed.modid) {
            continue;
        }
        let version = value
            .get("modversion")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if version.is_empty() {
            continue;
        }
        targets.push(((*installed).clone(), version));
    }

    if targets.is_empty() {
        return Ok(Json(json!({ "job_ids": [], "backup": null })));
    }
    let backup = create_backup_blocking(&state).await?;
    let mut job_ids = Vec::new();
    for (installed, version) in targets {
        job_ids.push(state.mods.enqueue(NewJob {
            action: "update".into(),
            modid: installed.modid.clone(),
            name: installed.name.clone(),
            version: Some(version),
            file: Some(installed.file.clone()),
            constraint: None,
            dependency: false,
        }));
    }
    Ok(Json(json!({ "job_ids": job_ids, "backup": backup })))
}

async fn mods_pin(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<ModPinReq>,
) -> Result<Json<Value>, ApiError> {
    let id = req.modid.trim().to_lowercase();
    if id.is_empty() {
        return Err(ApiError::bad_request("missing mod id"));
    }
    let settings = {
        let mut guard = state.settings.lock().unwrap();
        if req.pinned {
            if !guard.pinned_mods.contains(&id) {
                guard.pinned_mods.push(id);
            }
        } else {
            guard.pinned_mods.retain(|pinned| pinned != &id);
        }
        guard
            .save(&state.layout.settings_path())
            .map_err(|e| ApiError::internal(format!("cannot save settings: {e}")))?;
        guard.clone()
    };
    Ok(Json(json!(settings)))
}

async fn mods_favorite(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<ModFavoriteReq>,
) -> Result<Json<Value>, ApiError> {
    let id = req.modid.trim().to_lowercase();
    if id.is_empty() {
        return Err(ApiError::bad_request("missing mod id"));
    }
    let settings = {
        let mut guard = state.settings.lock().unwrap();
        if req.favorite {
            if !guard.favorite_mods.contains(&id) {
                guard.favorite_mods.push(id);
            }
        } else {
            guard.favorite_mods.retain(|favorite| favorite != &id);
        }
        guard
            .save(&state.layout.settings_path())
            .map_err(|e| ApiError::internal(format!("cannot save settings: {e}")))?;
        guard.clone()
    };
    Ok(Json(json!(settings)))
}

// ── mod configs ─────────────────────────────────────────────────────────────

async fn list_configs(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let server_dir = state.layout.server_dir();
    let list = tokio::task::spawn_blocking(move || crate::configs::list_mod_configs(&server_dir))
        .await
        .map_err(|e| ApiError::internal(format!("config scan failed: {e}")))?;
    Ok(Json(json!(list)))
}

async fn save_config(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(filename): UrlPath<String>,
    Json(req): Json<ConfigReq>,
) -> Result<Json<Value>, ApiError> {
    let server_dir = state.layout.server_dir();
    let content = req.content;
    tokio::task::spawn_blocking(move || {
        crate::configs::write_mod_config(&server_dir, &filename, &content)
    })
    .await
    .map_err(|e| ApiError::internal(format!("config save failed: {e}")))?
    .map_err(ApiError::bad_request)?;
    Ok(Json(json!({
        "ok": true,
        "restart_required": state.supervisor.is_running(),
    })))
}

// ── stratum ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct StratumInstallReq {
    tag: String,
}

#[derive(Deserialize)]
struct FlavorReq {
    flavor: String,
}

async fn stratum_releases(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    state
        .stratum
        .releases()
        .await
        .map(|releases| Json(json!({ "releases": releases })))
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))
}

async fn stratum_install(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<StratumInstallReq>,
) -> Result<Json<Value>, ApiError> {
    let tag = req.tag.trim().to_string();
    if tag.is_empty() {
        return Err(ApiError::bad_request("missing Stratum release tag"));
    }
    {
        let guard = state.install.lock().unwrap();
        if let Some(install) = guard.as_ref() {
            if install.phase != "done" && install.phase != "error" {
                return Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "an install is already running",
                ));
            }
        }
    }
    state
        .stratum
        .release(&tag)
        .await
        .map_err(|message| ApiError::new(StatusCode::BAD_GATEWAY, message))?;

    {
        let mut guard = state.install.lock().unwrap();
        *guard = Some(InstallStatus {
            version: tag.clone(),
            phase: "starting".into(),
            downloaded: 0,
            total: 0,
            message: None,
            success: None,
        });
    }
    let shared: SharedState = Arc::clone(&state);
    tokio::spawn(crate::stratum::run_install(shared, tag.clone()));
    Ok(Json(json!({ "ok": true, "tag": tag })))
}

async fn stratum_configs(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let server_dir = state.layout.server_dir();
    let list =
        tokio::task::spawn_blocking(move || crate::stratum::list_stratum_configs(&server_dir))
            .await
            .map_err(|e| ApiError::internal(format!("config scan failed: {e}")))?;
    Ok(Json(json!(list)))
}

async fn save_stratum_config(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(filename): UrlPath<String>,
    Json(req): Json<ConfigReq>,
) -> Result<Json<Value>, ApiError> {
    let server_dir = state.layout.server_dir();
    let content = req.content;
    tokio::task::spawn_blocking(move || {
        crate::stratum::write_stratum_config(&server_dir, &filename, &content)
    })
    .await
    .map_err(|e| ApiError::internal(format!("config save failed: {e}")))?
    .map_err(ApiError::bad_request)?;
    Ok(Json(json!({
        "ok": true,
        "restart_required": false,
        "reload_command": "/stratum reload",
    })))
}

async fn set_flavor(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<FlavorReq>,
) -> Result<Json<Value>, ApiError> {
    let flavor = req.flavor.trim().to_string();
    if flavor != "vanilla" && flavor != "stratum" {
        return Err(ApiError::bad_request("flavor must be vanilla or stratum"));
    }
    if flavor == "stratum" {
        let tag = state.settings.lock().unwrap().stratum_tag.clone();
        let installed = tag
            .as_deref()
            .map(|tag| state.layout.stratum_exe(tag).exists())
            .unwrap_or(false);
        if !installed {
            return Err(ApiError::bad_request("install a Stratum release first"));
        }
    }
    let settings = {
        let mut guard = state.settings.lock().unwrap();
        guard.flavor = flavor;
        guard
            .save(&state.layout.settings_path())
            .map_err(|e| ApiError::internal(format!("cannot save settings: {e}")))?;
        guard.clone()
    };
    Ok(Json(json!({
        "ok": true,
        "settings": settings,
        "restart_required": state.supervisor.is_running(),
    })))
}

// ── players & whitelist ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct WhitelistModeReq {
    enabled: bool,
}

async fn players_view(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let server_dir = state.layout.server_dir();
    let (whitelist, enabled) = tokio::task::spawn_blocking(move || {
        let whitelist = crate::players::read_whitelist(&server_dir);
        let enabled = crate::players::whitelist_enabled(&server_dir);
        (whitelist, enabled)
    })
    .await
    .map_err(|e| ApiError::internal(format!("player data scan failed: {e}")))?;

    let online: Vec<Value> = state
        .supervisor
        .online_players()
        .into_iter()
        .map(|(name, since)| json!({ "name": name, "since": since }))
        .collect();

    Ok(Json(json!({
        "online": online,
        "whitelist": whitelist,
        "whitelist_enabled": enabled,
    })))
}

async fn set_whitelist_mode(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<WhitelistModeReq>,
) -> Result<Json<Value>, ApiError> {
    let server_dir = state.layout.server_dir();
    tokio::task::spawn_blocking(move || {
        crate::players::set_whitelist_enabled(&server_dir, req.enabled)
    })
    .await
    .map_err(|e| ApiError::internal(format!("whitelist update failed: {e}")))?
    .map_err(ApiError::bad_request)?;
    Ok(Json(json!({
        "ok": true,
        "restart_required": state.supervisor.is_running(),
    })))
}

// ── backups ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct BackupCreateReq {
    #[serde(default = "default_backup_kind")]
    kind: String,
}

fn default_backup_kind() -> String {
    "server".into()
}

async fn list_backups(
    State(state): State<SharedState>,
    _authed: Authed,
) -> Result<Json<Value>, ApiError> {
    let layout = state.layout.clone();
    let backups = tokio::task::spawn_blocking(move || crate::backups::list_backups(&layout))
        .await
        .map_err(|e| ApiError::internal(format!("backup scan failed: {e}")))?;
    Ok(Json(json!({ "backups": backups })))
}

async fn create_backup(
    State(state): State<SharedState>,
    _authed: Authed,
    Json(req): Json<BackupCreateReq>,
) -> Result<Json<Value>, ApiError> {
    let layout = state.layout.clone();
    let kind = req.kind.clone();
    let retention = state.settings.lock().unwrap().backup_retention.max(1) as usize;
    let name = tokio::task::spawn_blocking(move || match kind.as_str() {
        "mods" => crate::mods::create_mods_backup(&layout, retention),
        "server" => crate::backups::create_server_backup(&layout, retention),
        other => Err(format!("unknown backup kind: {other}")),
    })
    .await
    .map_err(|e| ApiError::internal(format!("backup task failed: {e}")))?
    .map_err(ApiError::internal)?;
    crate::notifications::notify(&state, "backup", format!("Backup created: {name}"));
    Ok(Json(json!({ "ok": true, "name": name })))
}

async fn restore_backup(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(name): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    if state.supervisor.is_running() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "stop the server before restoring a backup",
        ));
    }
    let layout = state.layout.clone();
    tokio::task::spawn_blocking(move || crate::backups::restore_backup(&layout, &name))
        .await
        .map_err(|e| ApiError::internal(format!("restore task failed: {e}")))?
        .map_err(ApiError::bad_request)?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_backup(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(name): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    let layout = state.layout.clone();
    tokio::task::spawn_blocking(move || crate::backups::delete_backup(&layout, &name))
        .await
        .map_err(|e| ApiError::internal(format!("delete task failed: {e}")))?
        .map_err(ApiError::bad_request)?;
    Ok(Json(json!({ "ok": true })))
}

async fn download_backup(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(name): UrlPath<String>,
) -> Result<Response, ApiError> {
    let path = crate::backups::backup_path(&state.layout, &name).map_err(ApiError::bad_request)?;
    if !path.is_file() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "backup not found"));
    }
    let bytes = tokio::task::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| ApiError::internal(format!("read task failed: {e}")))?
        .map_err(|e| ApiError::internal(format!("cannot read backup: {e}")))?;
    Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", name.replace('"', "")),
        )
        .body(axum::body::Body::from(bytes))
        .map_err(|e| ApiError::internal(format!("response error: {e}")))
}

// ── log files ───────────────────────────────────────────────────────────────

async fn list_logs(State(state): State<SharedState>, _authed: Authed) -> Json<Value> {
    let layout = state.layout.clone();
    let files = tokio::task::spawn_blocking(move || crate::logfiles::list_log_files(&layout))
        .await
        .unwrap_or_default();
    Json(json!({ "files": files }))
}

#[derive(Deserialize)]
struct LogTailQuery {
    tail: Option<usize>,
}

async fn read_log(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(name): UrlPath<String>,
    Query(query): Query<LogTailQuery>,
) -> Result<Json<Value>, ApiError> {
    let max_lines = query.tail.unwrap_or(2000).clamp(1, 20_000);
    let layout = state.layout.clone();
    let file = name.clone();
    let (content, truncated) = tokio::task::spawn_blocking(move || {
        crate::logfiles::read_log_tail(&layout, &file, max_lines)
    })
    .await
    .map_err(|e| ApiError::internal(format!("read task failed: {e}")))?
    .map_err(ApiError::bad_request)?;
    Ok(Json(json!({
        "name": name,
        "content": content,
        "truncated": truncated,
    })))
}

async fn download_log(
    State(state): State<SharedState>,
    _authed: Authed,
    UrlPath(name): UrlPath<String>,
) -> Result<Response, ApiError> {
    let path = crate::logfiles::log_path(&state.layout, &name).map_err(ApiError::bad_request)?;
    if !path.is_file() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "log file not found"));
    }
    let bytes = tokio::task::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| ApiError::internal(format!("read task failed: {e}")))?
        .map_err(|e| ApiError::internal(format!("cannot read log: {e}")))?;
    Response::builder()
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", name.replace('"', "")),
        )
        .body(axum::body::Body::from(bytes))
        .map_err(|e| ApiError::internal(format!("response error: {e}")))
}
