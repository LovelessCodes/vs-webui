use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use serde::Serialize;

use crate::paths::Layout;

/// Maximum bytes read from the end of a log file for tail views.
const TAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct LogFileEntry {
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

pub fn logs_dir(layout: &Layout) -> PathBuf {
    layout.server_dir().join("Logs")
}

/// Validate a log file name: a plain file inside `Logs`, `.log`/`.txt` only.
pub fn log_path(layout: &Layout, name: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err("invalid log file name".into());
    }
    let lower = trimmed.to_lowercase();
    if !lower.ends_with(".log") && !lower.ends_with(".txt") {
        return Err("only .log and .txt files are served".into());
    }
    Ok(logs_dir(layout).join(trimmed))
}

/// Log files with size and mtime, newest first.
pub fn list_log_files(layout: &Layout) -> Vec<LogFileEntry> {
    let Ok(entries) = std::fs::read_dir(logs_dir(layout)) else {
        return Vec::new();
    };
    let mut files: Vec<LogFileEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            if !lower.ends_with(".log") && !lower.ends_with(".txt") {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            Some(LogFileEntry {
                name,
                size: meta.len(),
                modified,
            })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    files
}

/// Read the last `max_lines` lines, capping the read to the final `TAIL_BYTES`
/// of the file. Returns the text and whether older content was dropped.
pub fn read_log_tail(
    layout: &Layout,
    name: &str,
    max_lines: usize,
) -> Result<(String, bool), String> {
    let path = log_path(layout, name)?;
    if !path.is_file() {
        return Err(format!("{name} not found"));
    }
    let mut file = File::open(&path).map_err(|e| format!("cannot open log: {e}"))?;
    let len = file
        .metadata()
        .map_err(|e| format!("cannot stat log: {e}"))?
        .len();
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| format!("cannot seek log: {e}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read log: {e}"))?;
    let text = String::from_utf8_lossy(&bytes).into_owned();

    let mut lines: Vec<&str> = text.lines().collect();
    // A mid-file start can split the first line; drop the fragment.
    if start > 0 && lines.len() > 1 {
        lines.remove(0);
    }
    let truncated = start > 0 || lines.len() > max_lines;
    let from = lines.len().saturating_sub(max_lines);
    Ok((lines[from..].join("\n"), truncated))
}

#[derive(Serialize)]
pub struct LogMatch {
    pub file: String,
    /// 1-based line number within the tail that was scanned.
    pub line: usize,
    pub text: String,
}

/// Case-insensitive search across the newest log files, bounded by `limit`.
/// Only the final `TAIL_BYTES` of each file are scanned.
pub fn search_logs(layout: &Layout, query: &str, limit: usize) -> Vec<LogMatch> {
    let query = query.trim().to_lowercase();
    if query.len() < 2 {
        return Vec::new();
    }
    let limit = limit.clamp(1, 500);
    let mut matches = Vec::new();
    for file in list_log_files(layout) {
        let Ok(path) = log_path(layout, &file.name) else {
            continue;
        };
        let Ok(mut handle) = File::open(&path) else {
            continue;
        };
        let len = handle.metadata().map(|meta| meta.len()).unwrap_or(0);
        let start = len.saturating_sub(TAIL_BYTES);
        if handle.seek(SeekFrom::Start(start)).is_err() {
            continue;
        }
        let mut bytes = Vec::new();
        if handle.read_to_end(&mut bytes).is_err() {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes).into_owned();
        for (index, line) in text.lines().enumerate() {
            if start > 0 && index == 0 {
                continue; // fragment of a line split by the tail start
            }
            if line.to_lowercase().contains(&query) {
                matches.push(LogMatch {
                    file: file.name.clone(),
                    line: index + 1,
                    text: line.chars().take(400).collect(),
                });
                if matches.len() >= limit {
                    return matches;
                }
            }
        }
    }
    matches
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_log_names() {
        let layout = Layout::new(std::env::temp_dir());
        assert!(log_path(&layout, "../evil.log").is_err());
        assert!(log_path(&layout, "a/b.log").is_err());
        assert!(log_path(&layout, "notes.md").is_err());
        assert!(log_path(&layout, "").is_err());
        assert!(log_path(&layout, "server-main.log").is_ok());
        assert!(log_path(&layout, "server-main.txt").is_ok());
    }

    #[test]
    fn searches_log_files_newest_first() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-logs-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(logs_dir(&layout)).unwrap();
        std::fs::write(
            logs_dir(&layout).join("server-main.txt"),
            "boot ok\nException: boom\nstack line\n",
        )
        .unwrap();
        std::fs::write(
            logs_dir(&layout).join("server-audit.txt"),
            "audit clean\n",
        )
        .unwrap();

        let hits = search_logs(&layout, "exception", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].file, "server-main.txt");
        assert_eq!(hits[0].line, 2);
        assert!(hits[0].text.contains("boom"));
        assert!(search_logs(&layout, "x", 10).is_empty()); // too short
        assert!(search_logs(&layout, "nothing-here", 10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
