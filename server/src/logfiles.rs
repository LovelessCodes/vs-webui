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
}
