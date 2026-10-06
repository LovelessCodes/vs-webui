use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

use crate::console::{now_unix, ConsoleLog};
use crate::paths::Layout;
use crate::settings::Settings;

const STARTUP_MARKER: &str = "Dedicated Server now running on Port";
const MAX_AUTO_RESTARTS: u32 = 5;

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub status: String,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub version: Option<String>,
}

enum Cmd {
    Start,
    Stop,
    Restart,
    Command(String),
    Exited(Option<i32>),
    Shutdown(oneshot::Sender<()>),
}

/// Events emitted by the supervisor for webhook notifications and player
/// history. `player` is set for join/leave events.
#[derive(Clone, Debug)]
pub struct ServerEvent {
    pub kind: &'static str,
    pub text: String,
    pub player: Option<String>,
}

struct Running {
    pid: Option<u32>,
    stdin: tokio::process::ChildStdin,
    exit_rx: Option<oneshot::Receiver<Option<i32>>>,
    started: Instant,
    user_stop: bool,
}

/// Owns the game server process. All process operations run through a single
/// actor task so stdin/exit handling never races.
#[derive(Clone)]
pub struct Supervisor {
    tx: mpsc::Sender<Cmd>,
    status: Arc<Mutex<Status>>,
    pub console: ConsoleLog,
    online: Arc<Mutex<HashMap<String, u64>>>,
    /// While this instant is in the future, server output is treated as
    /// manager telemetry (`/stats` probes) and hidden from the web console.
    internal_window: Arc<Mutex<Option<Instant>>>,
}

/// How long `/stats` probe output is considered internal after the probe starts.
const PROBE_WINDOW: Duration = Duration::from_secs(5);

impl Supervisor {
    pub fn spawn(
        layout: Layout,
        settings: Arc<Mutex<Settings>>,
        events: mpsc::UnboundedSender<ServerEvent>,
    ) -> Self {
        let (tx, rx) = mpsc::channel(32);
        let notify_tx = tx.clone();
        let console = ConsoleLog::new();
        let status = Arc::new(Mutex::new(initial_status(&layout, &settings)));
        let online: Arc<Mutex<HashMap<String, u64>>> = Arc::new(Mutex::new(HashMap::new()));
        let internal_window: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));

        {
            let status = status.clone();
            let console = console.clone();
            let online = online.clone();
            let internal_window = internal_window.clone();
            tokio::spawn(async move {
                run(
                    rx,
                    notify_tx,
                    status,
                    console,
                    online,
                    layout,
                    settings,
                    events,
                    internal_window,
                )
                .await;
            });
        }

        Self {
            tx,
            status,
            console,
            online,
            internal_window,
        }
    }

    /// Best-effort online player list from console join/leave events.
    pub fn online_players(&self) -> Vec<(String, u64)> {
        let mut players: Vec<(String, u64)> = self
            .online
            .lock()
            .unwrap()
            .iter()
            .map(|(name, since)| (name.clone(), *since))
            .collect();
        players.sort_by_key(|entry| entry.0.to_lowercase());
        players
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        matches!(
            self.status.lock().unwrap().status.as_str(),
            "starting" | "running" | "stopping"
        )
    }

    pub async fn start(&self) {
        let _ = self.tx.send(Cmd::Start).await;
    }

    pub async fn stop(&self) {
        let _ = self.tx.send(Cmd::Stop).await;
    }

    pub async fn restart(&self) {
        let _ = self.tx.send(Cmd::Restart).await;
    }

    pub async fn command(&self, command: String) {
        // User commands cancel any probe window so their output is shown.
        *self.internal_window.lock().unwrap() = None;
        let _ = self.tx.send(Cmd::Command(command)).await;
    }

    /// Sends `/stats` for telemetry; its output is hidden from the web console.
    pub async fn probe_stats(&self) {
        *self.internal_window.lock().unwrap() = Some(Instant::now() + PROBE_WINDOW);
        let _ = self.tx.send(Cmd::Command("/stats".into())).await;
    }

    /// Graceful stop with a bounded wait; used on container shutdown.
    pub async fn shutdown(&self) {
        let (ack_tx, ack_rx) = oneshot::channel();
        if self.tx.send(Cmd::Shutdown(ack_tx)).await.is_ok() {
            let _ = tokio::time::timeout(Duration::from_secs(16), ack_rx).await;
        }
    }
}

fn initial_status(layout: &Layout, settings: &Arc<Mutex<Settings>>) -> Status {
    let (flavor, version, tag) = {
        let guard = settings.lock().unwrap();
        (
            guard.flavor.clone(),
            guard.version.clone(),
            guard.stratum_tag.clone(),
        )
    };
    let installed = if flavor == "stratum" {
        tag.as_deref()
            .map(|tag| layout.stratum_exe(tag).exists())
            .unwrap_or(false)
    } else {
        match version {
            Some(version) => layout.server_exe(&version).exists(),
            None => any_installed(layout).is_some(),
        }
    };
    Status {
        status: if installed {
            "stopped"
        } else {
            "not_installed"
        }
        .into(),
        pid: None,
        started_at: None,
        exit_code: None,
        version: None,
    }
}

pub fn any_installed(layout: &Layout) -> Option<String> {
    let mut versions: Vec<String> = std::fs::read_dir(layout.vanilla_dir())
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir() && crate::paths::is_server_install(&entry.path()))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    versions.sort_by(|a, b| crate::versions::compare_versions(b, a));
    versions.into_iter().next()
}

async fn run(
    mut rx: mpsc::Receiver<Cmd>,
    notify_tx: mpsc::Sender<Cmd>,
    status: Arc<Mutex<Status>>,
    console: ConsoleLog,
    online: Arc<Mutex<HashMap<String, u64>>>,
    layout: Layout,
    settings: Arc<Mutex<Settings>>,
    events: mpsc::UnboundedSender<ServerEvent>,
    internal_window: Arc<Mutex<Option<Instant>>>,
) {
    let mut running: Option<Running> = None;
    let mut failures: u32 = 0;

    while let Some(cmd) = rx.recv().await {
        match cmd {
            Cmd::Start => {
                if running.is_some() {
                    console.push("[manager] server is already running");
                    continue;
                }
                match start_server(
                    &mut running,
                    &notify_tx,
                    &status,
                    &console,
                    &online,
                    &layout,
                    &settings,
                    &events,
                    &internal_window,
                )
                .await
                {
                    Ok(()) => failures = 0,
                    Err(message) => {
                        console.push(format!("[manager] cannot start: {message}"));
                        set_status(&status, |s| {
                            s.status = "crashed".into();
                            s.pid = None;
                        });
                        let _ = events.send(ServerEvent {
                            kind: "crash",
                            text: format!("Server failed to start: {message}"),
                            player: None,
                        });
                    }
                }
            }
            Cmd::Stop => {
                stop_server(&mut running, &status, &console).await;
            }
            Cmd::Restart => {
                if stop_server(&mut running, &status, &console).await {
                    // The process is gone; drop the stale handle. The queued
                    // `Exited` notification will be ignored (running is None).
                    running = None;
                    match start_server(
                        &mut running,
                        &notify_tx,
                        &status,
                        &console,
                        &online,
                        &layout,
                        &settings,
                        &events,
                        &internal_window,
                    )
                    .await
                    {
                        Ok(()) => failures = 0,
                        Err(message) => {
                            console.push(format!("[manager] cannot restart: {message}"))
                        }
                    }
                } else {
                    console.push("[manager] restart aborted: the server would not stop");
                }
            }
            Cmd::Command(command) => match running.as_mut() {
                Some(server) => {
                    console.push(format!("» {command}"));
                    let _ = server
                        .stdin
                        .write_all(format!("{command}\n").as_bytes())
                        .await;
                    let _ = server.stdin.flush().await;
                }
                None => console.push("[manager] server is not running"),
            },
            Cmd::Exited(code) => {
                let Some(server) = running.take() else {
                    continue;
                };
                online.lock().unwrap().clear();
                let user_stop = server.user_stop;
                let uptime = server.started.elapsed().as_secs();
                let clean = user_stop || code == Some(0);
                console.push(format!(
                    "[manager] server exited (code {}, uptime {}s){}",
                    code.map(|c| c.to_string())
                        .unwrap_or_else(|| "unknown".into()),
                    uptime,
                    if clean { "" } else { " — unexpected" }
                ));
                set_status(&status, |s| {
                    s.status = if clean { "stopped" } else { "crashed" }.into();
                    s.pid = None;
                    s.exit_code = code;
                });
                let _ = events.send(ServerEvent {
                    kind: if clean { "stop" } else { "crash" },
                    text: if clean {
                        format!("Server stopped (uptime {uptime}s)")
                    } else {
                        format!(
                            "Server crashed (code {}, uptime {uptime}s)",
                            code.map(|c| c.to_string()).unwrap_or_else(|| "unknown".into())
                        )
                    },
                    player: None,
                });

                if clean {
                    failures = 0;
                    continue;
                }
                let auto_restart = settings.lock().unwrap().auto_restart;
                if !auto_restart {
                    continue;
                }
                if uptime >= 60 {
                    failures = 0;
                }
                failures += 1;
                if failures > MAX_AUTO_RESTARTS {
                    console.push(format!(
                        "[manager] too many failed starts ({MAX_AUTO_RESTARTS}); auto-restart paused"
                    ));
                    continue;
                }
                console.push(format!(
                    "[manager] auto-restart in 5s (attempt {failures}/{MAX_AUTO_RESTARTS})"
                ));
                if wait_or_stop(&mut rx, Duration::from_secs(5)).await {
                    console.push("[manager] auto-restart cancelled");
                    continue;
                }
                if let Err(message) = start_server(
                    &mut running,
                    &notify_tx,
                    &status,
                    &console,
                    &online,
                    &layout,
                    &settings,
                    &events,
                    &internal_window,
                )
                .await
                {
                    console.push(format!("[manager] cannot auto-restart: {message}"));
                }
            }
            Cmd::Shutdown(ack) => {
                stop_server(&mut running, &status, &console).await;
                let _ = ack.send(());
                return;
            }
        }
    }
}

async fn start_server(
    running: &mut Option<Running>,
    notify_tx: &mpsc::Sender<Cmd>,
    status: &Arc<Mutex<Status>>,
    console: &ConsoleLog,
    online: &Arc<Mutex<HashMap<String, u64>>>,
    layout: &Layout,
    settings: &Arc<Mutex<Settings>>,
    events: &mpsc::UnboundedSender<ServerEvent>,
    internal_window: &Arc<Mutex<Option<Instant>>>,
) -> Result<(), String> {
    online.lock().unwrap().clear();
    let (flavor, version, tag, params) = {
        let guard = settings.lock().unwrap();
        (
            guard.flavor.clone(),
            guard.version.clone(),
            guard.stratum_tag.clone(),
            guard.start_params.clone(),
        )
    };

    let (exe, label, work_dir) = if flavor == "stratum" {
        let tag = tag.ok_or("no Stratum release installed")?;
        let dir = layout.stratum_version_dir(&tag);
        let exe = dir.join("StratumServer");
        if !exe.exists() {
            return Err(format!("Stratum {tag} is not installed"));
        }
        (exe, tag, Some(dir))
    } else {
        let version = version
            .or_else(|| any_installed(layout))
            .ok_or("no version installed")?;
        let exe = layout.server_exe(&version);
        if !exe.exists() {
            return Err(format!("version {version} is not installed"));
        }
        (exe, version, None)
    };

    set_status(status, |s| {
        s.status = "starting".into();
        s.pid = None;
        s.started_at = Some(now_unix());
        s.exit_code = None;
        s.version = Some(label.clone());
    });
    console.push(if flavor == "stratum" {
        format!("[manager] starting Stratum {label}")
    } else {
        format!("[manager] starting Vintage Story {label}")
    });

    let mut cmd = Command::new(&exe);
    cmd.env("DOTNET_ROLL_FORWARD", "LatestMinor")
        .env("DOTNET_ROLL_FORWARD_TO_PRERELEASE", "0")
        .arg("--dataPath")
        .arg(layout.server_dir())
        .args(parse_params(&params))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = work_dir {
        cmd.current_dir(dir);
    }
    if std::env::var_os("DOTNET_ROOT").is_none() {
        // The apphost needs the runtime root; probe the standard install
        // locations (Linux container, macOS dev machines).
        for candidate in ["/usr/share/dotnet", "/usr/local/share/dotnet"] {
            if std::path::Path::new(candidate).join("host/fxr").exists() {
                cmd.env("DOTNET_ROOT", candidate);
                break;
            }
        }
    }
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let mut child: Child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("stdin not piped")?;
    let stdout = child.stdout.take().ok_or("stdout not piped")?;
    let stderr = child.stderr.take().ok_or("stderr not piped")?;

    set_status(status, |s| s.pid = pid);

    spawn_reader(
        stdout,
        console.clone(),
        status.clone(),
        online.clone(),
        events.clone(),
        internal_window.clone(),
    );
    spawn_reader(
        stderr,
        console.clone(),
        status.clone(),
        online.clone(),
        events.clone(),
        internal_window.clone(),
    );

    let (exit_tx, exit_rx) = oneshot::channel();
    let exit_notify = notify_tx.clone();
    tokio::spawn(async move {
        let code = match child.wait().await {
            Ok(exit) => exit.code(),
            Err(_) => None,
        };
        let _ = exit_tx.send(code);
        let _ = exit_notify.send(Cmd::Exited(code)).await;
    });

    *running = Some(Running {
        pid,
        stdin,
        exit_rx: Some(exit_rx),
        started: Instant::now(),
        user_stop: false,
    });
    Ok(())
}

/// Returns true when the process is confirmed gone.
async fn stop_server(
    running: &mut Option<Running>,
    status: &Arc<Mutex<Status>>,
    console: &ConsoleLog,
) -> bool {
    let Some(server) = running.as_mut() else {
        return true;
    };
    server.user_stop = true;
    set_status(status, |s| s.status = "stopping".into());
    console.push("[manager] sending /stop");
    let _ = server.stdin.write_all(b"/stop\n").await;
    let _ = server.stdin.flush().await;

    let pid = server.pid;
    let Some(mut exit_rx) = server.exit_rx.take() else {
        return false;
    };

    if tokio::time::timeout(Duration::from_secs(10), &mut exit_rx)
        .await
        .is_ok()
    {
        return true;
    }
    console.push("[manager] graceful stop timed out; sending SIGTERM");
    kill_group(pid, libc::SIGTERM);
    if tokio::time::timeout(Duration::from_secs(5), &mut exit_rx)
        .await
        .is_ok()
    {
        return true;
    }
    console.push("[manager] server still alive; sending SIGKILL");
    kill_group(pid, libc::SIGKILL);
    let _ = exit_rx.await;
    true
}

fn kill_group(pid: Option<u32>, signal: i32) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        // SAFETY: the child was started in its own process group (setpgid above),
        // so the pgid equals its pid. Failures (already exited) are ignored.
        unsafe {
            libc::killpg(pid as i32, signal);
        }
    }
    #[cfg(not(unix))]
    let _ = (pid, signal);
}

fn spawn_reader<R>(
    reader: R,
    console: ConsoleLog,
    status: Arc<Mutex<Status>>,
    online: Arc<Mutex<HashMap<String, u64>>>,
    events: mpsc::UnboundedSender<ServerEvent>,
    internal_window: Arc<Mutex<Option<Instant>>>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.contains(STARTUP_MARKER) {
                let became_running = {
                    let mut guard = status.lock().unwrap();
                    if guard.status == "starting" {
                        guard.status = "running".into();
                        true
                    } else {
                        false
                    }
                };
                if became_running {
                    let version = status.lock().unwrap().version.clone().unwrap_or_default();
                    let _ = events.send(ServerEvent {
                        kind: "start",
                        text: format!("Server is running ({version})"),
                        player: None,
                    });
                }
            }
            track_player(&line, &online, &events);
            let internal = internal_window
                .lock()
                .unwrap()
                .map(|until| Instant::now() < until)
                .unwrap_or(false);
            if internal {
                console.push_internal(line.clone());
            } else {
                console.push(line.clone());
            }
            tracing::info!(target: "server", "{}", line);
        }
    });
}

/// Best-effort online tracking from console join/leave events.
fn track_player(
    line: &str,
    online: &Arc<Mutex<HashMap<String, u64>>>,
    events: &mpsc::UnboundedSender<ServerEvent>,
) {
    let lower = line.to_lowercase();
    let extract = |marker: &str| -> Option<String> {
        let start = lower.find("player ")? + "player ".len();
        let end = lower[start..].find(marker)?;
        let name = line[start..start + end]
            .trim()
            .trim_matches(|c: char| c == '\'' || c == '"' || c == '.' || c == ',');
        (!name.is_empty()).then(|| name.to_string())
    };

    if lower.contains(" joined") {
        if let Some(name) = extract(" joined") {
            let newly = online.lock().unwrap().insert(name.clone(), now_unix()).is_none();
            if newly {
                let _ = events.send(ServerEvent {
                    kind: "player_join",
                    text: format!("Player {name} joined"),
                    player: Some(name),
                });
            }
        }
    } else if lower.contains(" left") || lower.contains("disconnected") {
        if let Some(name) = extract(" left").or_else(|| extract(" disconnected")) {
            let removed = online.lock().unwrap().remove(&name).is_some();
            if removed {
                let _ = events.send(ServerEvent {
                    kind: "player_leave",
                    text: format!("Player {name} left"),
                    player: Some(name),
                });
            }
        }
    }
}

async fn wait_or_stop(rx: &mut mpsc::Receiver<Cmd>, delay: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + delay;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => return false,
            cmd = rx.recv() => match cmd {
                Some(Cmd::Stop) => return true,
                Some(Cmd::Shutdown(ack)) => { let _ = ack.send(()); return true; }
                Some(_) => continue,
                None => return true,
            }
        }
    }
}

fn set_status(status: &Arc<Mutex<Status>>, f: impl FnOnce(&mut Status)) {
    let mut guard = status.lock().unwrap();
    f(&mut guard);
}

/// Shell-like argument splitting honoring single/double quotes and backslash escapes.
pub fn parse_params(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), '\\') => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            (Some(_), c) => current.push(c),
            (None, '\'' | '"') => quote = Some(c),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    out.push(std::mem::take(&mut current));
                }
            }
            (None, '\\') => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            (None, c) => current.push(c),
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_plain_args() {
        assert_eq!(
            parse_params("--port 42421 --ip 0.0.0.0"),
            vec!["--port", "42421", "--ip", "0.0.0.0"]
        );
    }

    #[test]
    fn keeps_quoted_values_together() {
        assert_eq!(
            parse_params("--worldname \"My World\" --flag"),
            vec!["--worldname", "My World", "--flag"]
        );
    }

    #[test]
    fn handles_escapes_and_empty() {
        assert_eq!(parse_params(""), Vec::<String>::new());
        assert_eq!(parse_params("a\\ b c"), vec!["a b", "c"]);
    }

    #[test]
    fn tracks_player_join_and_leave() {
        let online = Arc::new(Mutex::new(HashMap::new()));
        let (events, mut events_rx) = mpsc::unbounded_channel();
        track_player(
            "5.10.2026 20:00:00 [Server Event] Player Alice joined.",
            &online,
            &events,
        );
        track_player(
            "5.10.2026 20:00:01 [Server Event] Player Bob joined.",
            &online,
            &events,
        );
        assert_eq!(online.lock().unwrap().len(), 2);
        track_player(
            "5.10.2026 20:05:00 [Server Event] Player Alice left.",
            &online,
            &events,
        );
        let players = online.lock().unwrap();
        assert_eq!(players.len(), 1);
        assert!(players.contains_key("Bob"));
        drop(players);

        assert_eq!(events_rx.try_recv().unwrap().kind, "player_join");
        assert_eq!(events_rx.try_recv().unwrap().kind, "player_join");
        let leave = events_rx.try_recv().unwrap();
        assert_eq!(leave.kind, "player_leave");
        assert!(leave.text.contains("Alice"));
    }
}
