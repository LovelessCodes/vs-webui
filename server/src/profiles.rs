//! Player notes and manager-side moderation history.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::console::now_unix;

/// Moderation entries kept on disk.
const MAX_MODERATION: usize = 500;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PlayerNote {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub updated: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModerationEntry {
    pub ts: u64,
    /// `kick`, `ban`, `unban`, `op`, `deop`.
    pub action: String,
    pub player: String,
    /// Acting user or token label.
    pub by: String,
}

#[derive(Default, Serialize, Deserialize)]
struct ProfilesFile {
    #[serde(default)]
    notes: HashMap<String, PlayerNote>,
    #[serde(default)]
    moderation: Vec<ModerationEntry>,
}

/// Notes + moderation history, persisted as `config/player-profiles.json`.
pub struct ProfilesStore {
    path: PathBuf,
    inner: Mutex<ProfilesFile>,
}

impl ProfilesStore {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("player-profiles.json");
        let file: ProfilesFile = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(file),
        }
    }

    pub fn note(&self, name: &str) -> PlayerNote {
        self.inner
            .lock()
            .unwrap()
            .notes
            .get(name)
            .cloned()
            .unwrap_or_default()
    }

    pub fn set_note(&self, name: &str, text: &str) {
        let mut inner = self.inner.lock().unwrap();
        let text = text.trim();
        if text.is_empty() {
            inner.notes.remove(name);
        } else {
            inner.notes.insert(
                name.to_string(),
                PlayerNote {
                    text: text.chars().take(4000).collect(),
                    updated: now_unix(),
                },
            );
        }
        drop(inner);
        self.persist();
    }

    pub fn record(&self, action: &str, player: &str, by: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.moderation.push(ModerationEntry {
            ts: now_unix(),
            action: action.to_string(),
            player: player.to_string(),
            by: by.to_string(),
        });
        while inner.moderation.len() > MAX_MODERATION {
            inner.moderation.remove(0);
        }
        drop(inner);
        self.persist();
    }

    /// All notes and the newest-first moderation history (capped).
    pub fn snapshot(&self, limit: usize) -> (HashMap<String, PlayerNote>, Vec<ModerationEntry>) {
        let inner = self.inner.lock().unwrap();
        let moderation = inner
            .moderation
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect();
        (inner.notes.clone(), moderation)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_notes_and_moderation() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-profiles-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = ProfilesStore::load(&dir);

        store.set_note("Ayla", "  keeps stealing copper  ");
        store.record("kick", "Ayla", "admin");
        store.record("ban", "Bram", "admin");

        assert_eq!(store.note("Ayla").text, "keeps stealing copper");
        let (notes, moderation) = store.snapshot(10);
        assert_eq!(notes.len(), 1);
        assert_eq!(moderation.len(), 2);
        assert_eq!(moderation[0].action, "ban"); // newest first

        // Clearing a note removes it; the store reloads from disk.
        store.set_note("Ayla", "");
        assert!(store.note("Ayla").text.is_empty());
        let reloaded = ProfilesStore::load(&dir);
        assert_eq!(reloaded.snapshot(10).1.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
