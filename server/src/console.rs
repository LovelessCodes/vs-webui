use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

const HISTORY: usize = 2000;
const BROADCAST_CAP: usize = 1024;

#[derive(Clone, Debug, Serialize)]
pub struct LogLine {
    pub ts: String,
    pub line: String,
}

/// Bounded in-memory console ring buffer plus a broadcast feed for SSE clients.
#[derive(Clone)]
pub struct ConsoleLog {
    buf: Arc<Mutex<VecDeque<LogLine>>>,
    tx: broadcast::Sender<LogLine>,
}

impl Default for ConsoleLog {
    fn default() -> Self {
        Self::new()
    }
}

impl ConsoleLog {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAP);
        Self {
            buf: Arc::new(Mutex::new(VecDeque::with_capacity(HISTORY))),
            tx,
        }
    }

    pub fn push(&self, line: impl Into<String>) {
        let entry = LogLine {
            ts: now_hms(),
            line: line.into(),
        };
        {
            let mut buf = self.buf.lock().unwrap();
            if buf.len() >= HISTORY {
                buf.pop_front();
            }
            buf.push_back(entry.clone());
        }
        let _ = self.tx.send(entry);
    }

    /// Most recent `limit` lines, oldest first.
    pub fn history(&self, limit: usize) -> Vec<LogLine> {
        let buf = self.buf.lock().unwrap();
        buf.iter()
            .rev()
            .take(limit.min(HISTORY))
            .rev()
            .cloned()
            .collect()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LogLine> {
        self.tx.subscribe()
    }
}

pub fn now_hms() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!(
        "{:02}:{:02}:{:02}",
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60
    )
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
