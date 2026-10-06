use std::collections::HashMap;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::console::now_unix;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlayerRecord {
    pub name: String,
    pub first_seen: u64,
    pub last_seen: u64,
    /// Total accumulated playtime in seconds.
    pub seconds: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct HistoryFile {
    players: HashMap<String, PlayerRecord>,
}

#[derive(Default)]
struct Inner {
    players: HashMap<String, PlayerRecord>,
    /// Active session start times, keyed like `players`.
    sessions: HashMap<String, u64>,
}

/// Playtime / last-seen history built from supervisor join/leave events.
/// Persisted as `config/player-history.json`.
pub struct PlayerHistory {
    path: PathBuf,
    inner: Mutex<Inner>,
}

impl PlayerHistory {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("player-history.json");
        let players = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<HistoryFile>(&raw).ok())
            .map(|file| file.players)
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(Inner {
                players,
                sessions: HashMap::new(),
            }),
        }
    }

    pub fn join(&self, name: &str) {
        let name = name.trim();
        let key = name.to_lowercase();
        if key.is_empty() {
            return;
        }
        let now = now_unix();
        {
            let mut inner = self.inner.lock().unwrap();
            let record = inner
                .players
                .entry(key.clone())
                .or_insert_with(|| PlayerRecord {
                    name: name.to_string(),
                    first_seen: now,
                    last_seen: now,
                    seconds: 0,
                });
            record.name = name.to_string();
            record.last_seen = now;
            inner.sessions.insert(key, now);
        }
        self.persist();
    }

    pub fn leave(&self, name: &str) {
        let key = name.trim().to_lowercase();
        if key.is_empty() {
            return;
        }
        let now = now_unix();
        {
            let mut inner = self.inner.lock().unwrap();
            // Fall back to last_seen when the join event was missed (e.g. the
            // manager restarted while the player was online).
            let started = inner
                .sessions
                .remove(&key)
                .or_else(|| inner.players.get(&key).map(|record| record.last_seen));
            if let Some(record) = inner.players.get_mut(&key) {
                if let Some(started) = started {
                    record.seconds += now.saturating_sub(started);
                }
                record.last_seen = now;
            }
        }
        self.persist();
    }

    /// Players sorted by last seen, newest first.
    pub fn list(&self) -> Vec<PlayerRecord> {
        let mut players: Vec<PlayerRecord> = self
            .inner
            .lock()
            .unwrap()
            .players
            .values()
            .cloned()
            .collect();
        players.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
        players
    }

    fn persist(&self) {
        let inner = self.inner.lock().unwrap();
        let file = HistoryFile {
            players: inner.players.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec_pretty(&file) {
            let tmp = self.path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_sessions_and_playtime() {
        let dir = std::env::temp_dir().join(format!("vs-webui-history-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let history = PlayerHistory::load(&dir);
        history.join("Alice");
        history.join("alice"); // duplicate joins keep the existing record
        history.leave("ALICE");
        history.join("Bob");

        let players = history.list();
        assert_eq!(players.len(), 2);
        assert!(players.iter().any(|p| p.name.eq_ignore_ascii_case("alice")));
        assert!(players.iter().any(|p| p.name == "Bob"));
        for record in &players {
            assert!(record.first_seen <= record.last_seen);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}
