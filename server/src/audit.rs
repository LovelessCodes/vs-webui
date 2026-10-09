use std::collections::VecDeque;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::auth::Actor;
use crate::console::now_unix;
use crate::paths::Layout;

/// Entries kept in memory and on disk.
const CAP: usize = 2_000;
/// Compact the log file when it grows well past the cap.
const COMPACT_AT: usize = CAP * 2;

/// One recorded mutation. Append-only JSONL on disk.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: u64,
    /// User name, token label, or `anonymous`.
    pub actor: String,
    pub role: String,
    /// `session`, `token`, `system` or `none`.
    pub kind: String,
    pub method: String,
    pub path: String,
    pub status: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    pub ip: String,
}

impl AuditEntry {
    pub fn new(actor: &Actor, method: &str, path: &str, status: u16, ip: &str) -> Self {
        Self {
            ts: now_unix(),
            actor: actor.name.clone(),
            role: actor
                .role
                .map(|role| role.as_str().to_string())
                .unwrap_or_default(),
            kind: actor.kind.to_string(),
            method: method.to_string(),
            path: path.to_string(),
            status,
            action: None,
            ip: ip.to_string(),
        }
    }

    pub fn with_action(mut self, action: &str) -> Self {
        self.action = Some(action.to_string());
        self
    }

    /// Entry for an unauthenticated attempt (failed login, no session).
    pub fn anonymous(name: &str, method: &str, path: &str, status: u16, ip: &str) -> Self {
        Self {
            ts: now_unix(),
            actor: name.to_string(),
            role: String::new(),
            kind: "none".into(),
            method: method.to_string(),
            path: path.to_string(),
            status,
            action: None,
            ip: ip.to_string(),
        }
    }
}

/// In-memory ring buffer mirrored to `config/audit.jsonl`.
pub struct AuditStore {
    path: PathBuf,
    entries: Mutex<VecDeque<AuditEntry>>,
}

impl AuditStore {
    pub fn load(layout: &Layout) -> Self {
        let path = layout.audit_path();
        let mut entries: VecDeque<AuditEntry> = std::fs::read_to_string(&path)
            .map(|raw| {
                raw.lines()
                    .filter_map(|line| serde_json::from_str::<AuditEntry>(line).ok())
                    .collect()
            })
            .unwrap_or_default();
        while entries.len() > CAP {
            entries.pop_front();
        }
        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    /// Newest first, capped at `limit`.
    pub fn list(&self, limit: usize) -> Vec<AuditEntry> {
        let entries = self.entries.lock().unwrap();
        entries.iter().rev().take(limit).cloned().collect()
    }

    pub fn record(&self, entry: AuditEntry) {
        let compact = {
            let mut entries = self.entries.lock().unwrap();
            entries.push_back(entry.clone());
            if entries.len() > COMPACT_AT {
                while entries.len() > CAP {
                    entries.pop_front();
                }
                true
            } else {
                false
            }
        };
        if compact {
            let snapshot: Vec<AuditEntry> = self.entries.lock().unwrap().iter().cloned().collect();
            let body: String = snapshot
                .iter()
                .filter_map(|entry| serde_json::to_string(entry).ok())
                .map(|line| format!("{line}\n"))
                .collect();
            let tmp = self.path.with_extension("jsonl.tmp");
            if std::fs::write(&tmp, body).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            }
            return;
        }
        if let Ok(line) = serde_json::to_string(&entry) {
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
            {
                let _ = writeln!(file, "{line}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Role;

    fn actor() -> Actor {
        Actor {
            name: "admin".into(),
            role: Some(Role::Owner),
            kind: "session",
        }
    }

    #[test]
    fn records_and_lists_newest_first() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-audit-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(layout.config_dir()).unwrap();
        let store = AuditStore::load(&layout);

        store.record(AuditEntry::new(&actor(), "POST", "/api/server/start", 200, "::1"));
        store.record(
            AuditEntry::new(&actor(), "POST", "/api/backups", 200, "::1")
                .with_action("backup.create"),
        );

        let listed = store.list(10);
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].path, "/api/backups");
        assert_eq!(listed[0].action.as_deref(), Some("backup.create"));

        // Reload from disk: entries persist.
        let reloaded = AuditStore::load(&layout);
        assert_eq!(reloaded.list(10).len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
