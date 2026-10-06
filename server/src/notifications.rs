use std::time::Duration;

use serde::Serialize;

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

#[derive(Serialize)]
struct GenericPayload<'a> {
    event: &'a str,
    text: &'a str,
    timestamp: u64,
}

/// Fire-and-forget notification for one event; failures are reported to the
/// console ring buffer. Spawns the request so callers never block on it.
pub fn notify(state: &SharedState, event: &str, text: String) {
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
    let console = state.supervisor.console.clone();
    let event_name = event.to_string();
    tokio::spawn(async move {
        if let Err(error) = send(&url, &event_name, &text).await {
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
