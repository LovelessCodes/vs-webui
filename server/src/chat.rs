use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::console::{now_unix, LogLine};

/// Entries kept in the in-memory timeline.
const CAP: usize = 500;

#[derive(Clone, Debug, Serialize)]
pub struct ChatEntry {
    pub id: u64,
    pub ts: u64,
    /// `chat`, `join`, `leave` or `announce`.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player: Option<String>,
    pub text: String,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    entries: VecDeque<ChatEntry>,
}

/// Parsed console output for the chat page (in-memory, capped).
#[derive(Clone, Default)]
pub struct ChatLog {
    inner: Arc<Mutex<Inner>>,
}

impl ChatLog {
    /// Feeds one console line into the timeline.
    pub fn ingest(&self, line: &LogLine) {
        let Some((kind, player, text)) = parse_line(&line.line) else {
            return;
        };
        let mut inner = self.inner.lock().unwrap();
        inner.next_id += 1;
        let id = inner.next_id;
        inner.entries.push_back(ChatEntry {
            id,
            ts: now_unix(),
            kind,
            player,
            text,
        });
        while inner.entries.len() > CAP {
            inner.entries.pop_front();
        }
    }

    /// With `after`: entries newer than that id (oldest first). Without: the
    /// newest `limit` entries (oldest first).
    pub fn list(&self, after: Option<u64>, limit: usize) -> Vec<ChatEntry> {
        let inner = self.inner.lock().unwrap();
        match after {
            Some(after) => inner
                .entries
                .iter()
                .filter(|entry| entry.id > after)
                .take(limit)
                .cloned()
                .collect(),
            None => inner
                .entries
                .iter()
                .rev()
                .take(limit)
                .rev()
                .cloned()
                .collect(),
        }
    }
}

/// Parses console output into chat events; tolerant of the game's variants.
fn parse_line(line: &str) -> Option<(&'static str, Option<String>, String)> {
    if let Some(at) = line.find("[Server Chat]") {
        let rest = line[at + "[Server Chat]".len()..].trim();
        // Optional "N | " chat-group prefix.
        let rest = match rest.split_once(" | ") {
            Some((before, after)) if before.chars().all(|c| c.is_ascii_digit()) => after,
            _ => rest,
        };
        let (name, message) = rest.split_once(": ")?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 32 {
            return None;
        }
        return Some(("chat", Some(name.to_string()), message.trim().to_string()));
    }
    if let Some(at) = line.find("Message to all in group") {
        if let Some((_, message)) = line[at..].split_once(": ") {
            let message = message.trim();
            if !message.is_empty() {
                return Some(("announce", None, message.to_string()));
            }
        }
    }
    let lower = line.to_lowercase();
    if lower.contains("player ") {
        if let Some(name) = extract_name(line, &lower, " joined") {
            return Some(("join", Some(name), String::new()));
        }
        if let Some(name) = extract_name(line, &lower, " left")
            .or_else(|| extract_name(line, &lower, " disconnected"))
        {
            return Some(("leave", Some(name), String::new()));
        }
    }
    None
}

/// Name between "player " and a marker, matching the supervisor's tolerance.
fn extract_name(line: &str, lower: &str, marker: &str) -> Option<String> {
    let start = lower.find("player ")? + "player ".len();
    let end = lower.find(marker)?;
    if end <= start {
        return None;
    }
    let name = line[start..end].trim();
    (!name.is_empty() && name.chars().count() <= 32).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ingest_line(log: &ChatLog, text: &str) {
        log.ingest(&LogLine {
            ts: "00:00:00".into(),
            line: text.into(),
            internal: false,
        });
    }

    #[test]
    fn parses_chat_announcements_and_joins() {
        let log = ChatLog::default();
        ingest_line(
            &log,
            "13.3.2026 09:50:57 [Server Chat] 0 | ShikiTochi: its not even client sided mods",
        );
        ingest_line(&log, "[Server Chat] Ayla: hello there");
        ingest_line(&log, "[Server Chat] [farseer] Enabled for player propaneko");
        ingest_line(&log, "[Server Notification] Message to all in group 0: Server restart in 5 minutes");
        ingest_line(&log, "5.10.2026 20:00:00 [Server Event] Player Alice joined.");
        ingest_line(&log, "5.10.2026 20:05:00 [Server Event] Player Alice left.");

        let entries = log.list(None, 10);
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[0].kind, "chat");
        assert_eq!(entries[0].player.as_deref(), Some("ShikiTochi"));
        assert_eq!(entries[0].text, "its not even client sided mods");
        assert_eq!(entries[1].player.as_deref(), Some("Ayla"));
        assert_eq!(entries[2].kind, "announce");
        assert_eq!(entries[3].kind, "join");
        assert_eq!(entries[4].kind, "leave");

        // Incremental fetch returns only newer entries.
        let after = log.list(Some(entries[3].id), 10);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].kind, "leave");
    }
}
