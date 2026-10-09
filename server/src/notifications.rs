use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::console::now_unix;
use crate::state::SharedState;

/// Event names a webhook can subscribe to.
pub const EVENTS: [&str; 6] = [
    "start",
    "stop",
    "crash",
    "player_join",
    "player_leave",
    "backup",
];

/// Maximum notifications kept in the history.
const CAP: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: u64,
    pub ts: u64,
    pub event: String,
    /// `info`, `warning` or `error`.
    pub severity: String,
    pub text: String,
    pub read: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct NotificationsFile {
    #[serde(default)]
    next_id: u64,
    #[serde(default)]
    notifications: VecDeque<Notification>,
}

/// Persistent notification history for the bell menu, newest last.
pub struct NotificationStore {
    path: PathBuf,
    inner: Mutex<NotificationsFile>,
}

impl NotificationStore {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("notifications.json");
        let mut file: NotificationsFile = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        while file.notifications.len() > CAP {
            file.notifications.pop_front();
        }
        Self {
            path,
            inner: Mutex::new(file),
        }
    }

    pub fn push(&self, event: &str, severity: &str, text: String) {
        let mut inner = self.inner.lock().unwrap();
        let id = inner.next_id + 1;
        inner.next_id = id;
        inner.notifications.push_back(Notification {
            id,
            ts: now_unix(),
            event: event.to_string(),
            severity: severity.to_string(),
            text,
            read: false,
        });
        while inner.notifications.len() > CAP {
            inner.notifications.pop_front();
        }
        drop(inner);
        self.persist();
    }

    /// Newest first, capped at `limit`.
    pub fn list(&self, limit: usize) -> Vec<Notification> {
        let inner = self.inner.lock().unwrap();
        inner
            .notifications
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn unread(&self) -> usize {
        self.inner
            .lock()
            .unwrap()
            .notifications
            .iter()
            .filter(|notification| !notification.read)
            .count()
    }

    /// Marks everything (or just `ids`) as read.
    pub fn mark_read(&self, ids: Option<&[u64]>) {
        let mut inner = self.inner.lock().unwrap();
        for notification in inner.notifications.iter_mut() {
            if ids
                .map(|ids| ids.contains(&notification.id))
                .unwrap_or(true)
            {
                notification.read = true;
            }
        }
        drop(inner);
        self.persist();
    }

    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.notifications.clear();
        drop(inner);
        self.persist();
    }

    fn persist(&self) {
        let inner = self.inner.lock().unwrap();
        if let Ok(bytes) = serde_json::to_vec_pretty(&*inner) {
            let tmp = self.path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            }
        }
    }
}

/// Severity used for the history and push styling.
fn severity_for(event: &str) -> &'static str {
    match event {
        "crash" | "tps_low" | "disk_low" | "backup_failed" | "offsite_failed" => "error",
        "stop" | "restart" => "warning",
        _ => "info",
    }
}

#[derive(Serialize)]
struct GenericPayload<'a> {
    event: &'a str,
    text: &'a str,
    timestamp: u64,
}

/// Records an event in the notification history and, when the webhook
/// subscribes to it, delivers it. Callers are never blocked on delivery.
pub fn notify(state: &SharedState, event: &str, text: String) {
    state
        .notifications
        .push(event, severity_for(event), text.clone());
    let (url, events) = {
        let settings = state.settings.lock().unwrap();
        (settings.webhook_url.clone(), settings.webhook_events.clone())
    };
    let Some(url) = url else {
        return;
    };
    if !events.iter().any(|entry| entry == event) {
        return;
    }
    deliver(state, url, event.to_string(), text);
}

/// Threshold alert: recorded and delivered regardless of the `webhook_events`
/// selection (alerts have their own toggles in the settings).
pub fn alert(state: &SharedState, event: &str, text: String) {
    state
        .notifications
        .push(event, severity_for(event), text.clone());
    let url = { state.settings.lock().unwrap().webhook_url.clone() };
    let Some(url) = url else {
        return;
    };
    deliver(state, url, event.to_string(), text);
}

fn deliver(state: &SharedState, url: String, event: String, text: String) {
    let console = state.supervisor.console.clone();
    tokio::spawn(async move {
        if let Err(error) = send(&url, &event, &text).await {
            console.push(format!("[manager] webhook failed: {error}"));
        }
    });
}

/// Post one message. Discord and Slack URLs get their native payloads, every
/// other endpoint receives `{event, text, timestamp}`.
pub async fn send(url: &str, event: &str, text: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalid webhook URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("webhook URL must be http(s)".into());
    }

    let body = if url.contains("discord.com/api/webhooks")
        || url.contains("discordapp.com/api/webhooks")
    {
        serde_json::json!({ "content": text })
    } else if url.contains("hooks.slack.com") {
        serde_json::json!({ "text": text })
    } else {
        serde_json::to_value(GenericPayload {
            event,
            text,
            timestamp: crate::console::now_unix(),
        })
        .map_err(|e| format!("cannot encode payload: {e}"))?
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("cannot build client: {e}"))?;
    let response = client
        .post(parsed)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("endpoint returned HTTP {}", response.status()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_store_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-notifications-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = NotificationStore::load(&dir);

        store.push("start", severity_for("start"), "Server started".into());
        store.push("crash", severity_for("crash"), "Server crashed".into());
        assert_eq!(store.unread(), 2);

        let listed = store.list(10);
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].event, "crash"); // newest first
        assert_eq!(listed[0].severity, "error");

        store.mark_read(Some(&[listed[0].id]));
        assert_eq!(store.unread(), 1);
        store.mark_read(None);
        assert_eq!(store.unread(), 0);

        // Reload from disk: history and read state persist.
        let reloaded = NotificationStore::load(&dir);
        assert_eq!(reloaded.list(10).len(), 2);
        assert_eq!(reloaded.unread(), 0);

        reloaded.clear();
        assert!(reloaded.list(10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
