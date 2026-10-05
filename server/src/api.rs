use std::collections::HashSet;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, FromRequestParts, Query, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use futures_util::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::console::LogLine;
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
        .route("/api/settings", get(get_settings).put(put_settings))
        .route(
            "/api/serverconfig",
            get(get_serverconfig).put(put_serverconfig),
        )
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
    // selected version has been installed (or removed).
    if supervisor.status == "not_installed" {
        if let Some(version) = settings.version.as_deref() {
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
    let settings = {
        let mut guard = state.settings.lock().unwrap();
        guard.auto_start = req.auto_start;
        guard.auto_restart = req.auto_restart;
        guard.start_params = req.start_params;
        guard
            .save(&state.layout.settings_path())
            .map_err(|e| ApiError::internal(format!("cannot save settings: {e}")))?;
        guard.clone()
    };
    Ok(Json(json!(settings)))
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
