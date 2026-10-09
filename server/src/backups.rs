use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::console::now_unix;
use crate::mods::timestamp_label;
use crate::paths::Layout;

/// Directories never included in a server-data backup (logs/caches/tmp).
const SKIP_DIRS: [&str; 4] = ["Logs", "Cache", "Backups", "BackupSaves"];

/// Result of an integrity check, persisted per archive.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IntegrityInfo {
    pub ok: bool,
    pub checked: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackupEntry {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integrity: Option<IntegrityInfo>,
}

/// Progress of an in-flight restore, polled by the UI.
#[derive(Clone, Debug, Serialize)]
pub struct RestoreProgress {
    pub name: String,
    /// Bytes written so far and the total uncompressed size.
    pub done: u64,
    pub total: u64,
    pub entries: usize,
    pub finished: bool,
}

pub type RestoreProgressHandle = Arc<Mutex<Option<RestoreProgress>>>;

fn integrity_path(layout: &Layout) -> PathBuf {
    layout.config_dir().join("backup-integrity.json")
}

pub fn integrity_map(layout: &Layout) -> HashMap<String, IntegrityInfo> {
    std::fs::read_to_string(integrity_path(layout))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_integrity(layout: &Layout, map: &HashMap<String, IntegrityInfo>) {
    if let Ok(bytes) = serde_json::to_vec_pretty(map) {
        let path = integrity_path(layout);
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

/// Stores the outcome of a check so the UI and retention can see it.
pub fn record_integrity(layout: &Layout, name: &str, result: &Result<(), String>) {
    let mut map = integrity_map(layout);
    map.insert(
        name.to_string(),
        IntegrityInfo {
            ok: result.is_ok(),
            checked: now_unix(),
            error: result.clone().err(),
        },
    );
    save_integrity(layout, &map);
}

pub fn forget_integrity_record(layout: &Layout, name: &str) {
    let mut map = integrity_map(layout);
    if map.remove(name).is_some() {
        save_integrity(layout, &map);
    }
}

/// Walks every entry and reads it to the end, validating CRCs.
pub fn verify_backup(layout: &Layout, name: &str) -> Result<(), String> {
    let path = backup_path(layout, name)?;
    if !path.is_file() {
        return Err(format!("backup {name} not found"));
    }
    verify_path(&path)
}

pub fn verify_path(path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open backup: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("invalid zip: {e}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("entry {index}: {e}"))?;
        std::io::copy(&mut entry, &mut std::io::sink())
            .map_err(|e| format!("entry {}: {e}", entry.name()))?;
    }
    Ok(())
}

pub fn list_backups(layout: &Layout) -> Vec<BackupEntry> {
    let Ok(entries) = std::fs::read_dir(layout.backups_dir()) else {
        return Vec::new();
    };
    let integrity = integrity_map(layout);
    let mut backups: Vec<BackupEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".zip") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            Some(BackupEntry {
                integrity: integrity.get(&name).cloned(),
                name,
                size: metadata.len(),
                modified,
            })
        })
        .collect();
    backups.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.name.cmp(&a.name))
    });
    backups
}

/// Backup file name with second granularity; a counter keeps names unique when
/// two backups are created within the same second.
pub fn unique_backup_path(layout: &Layout, prefix: &str) -> (String, PathBuf) {
    let stamp = timestamp_label();
    let mut name = format!("{prefix}-{stamp}.zip");
    let mut counter = 1;
    let mut path = layout.backups_dir().join(&name);
    while path.exists() {
        name = format!("{prefix}-{stamp}-{counter}.zip");
        path = layout.backups_dir().join(&name);
        counter += 1;
    }
    (name, path)
}

/// Zip the server data directory (world, mods, configs, player data).
pub fn create_server_backup(
    layout: &Layout,
    retention: usize,
    max_bytes: Option<u64>,
) -> Result<String, String> {
    create_server_backup_named(layout, retention, max_bytes, "server")
}

/// Scheduled backups carry a distinct prefix so the UI can label them.
pub fn create_scheduled_backup(
    layout: &Layout,
    retention: usize,
    max_bytes: Option<u64>,
) -> Result<String, String> {
    create_server_backup_named(layout, retention, max_bytes, "server-scheduled")
}

fn create_server_backup_named(
    layout: &Layout,
    retention: usize,
    max_bytes: Option<u64>,
    prefix: &str,
) -> Result<String, String> {
    let server_dir = layout.server_dir();
    if !server_dir.exists() {
        return Err("server data directory does not exist".into());
    }
    std::fs::create_dir_all(layout.backups_dir())
        .map_err(|e| format!("cannot create backups dir: {e}"))?;

    let (name, path) = unique_backup_path(layout, prefix);
    let file = std::fs::File::create(&path).map_err(|e| format!("cannot create backup: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_dir(&mut zip, &server_dir, Path::new(""), &options)?;
    zip.finish()
        .map_err(|e| format!("cannot finish backup: {e}"))?;

    // Never report a corrupt archive as a successful backup.
    if let Err(error) = verify_path(&path) {
        let _ = std::fs::remove_file(&path);
        return Err(format!("backup verification failed: {error}"));
    }
    record_integrity(layout, &name, &Ok(()));
    prune_server_backups(layout, retention, max_bytes);
    Ok(name)
}

fn add_dir(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    prefix: &Path,
    options: &zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = prefix.join(&name);
        if path.is_dir() {
            if prefix.as_os_str().is_empty() && SKIP_DIRS.iter().any(|skip| *skip == name) {
                continue;
            }
            add_dir(zip, &path, &relative, options)?;
        } else if path.is_file() {
            let relative_name = relative.to_string_lossy().replace('\\', "/");
            zip.start_file(relative_name, *options)
                .map_err(|e| format!("cannot add to backup: {e}"))?;
            let mut source =
                std::fs::File::open(&path).map_err(|e| format!("cannot open file: {e}"))?;
            std::io::copy(&mut source, zip).map_err(|e| format!("cannot copy file: {e}"))?;
        }
    }
    Ok(())
}

/// Extract a backup over the server directory. `mods-*` archives restore into
/// `Mods/` (they store bare mod zips); everything else restores into the data
/// directory. The caller must ensure the server is stopped. `progress` is
/// updated per entry so the UI can show a bar.
pub fn restore_backup(
    layout: &Layout,
    name: &str,
    progress: Option<&RestoreProgressHandle>,
) -> Result<(), String> {
    let path = backup_path(layout, name)?;
    if !path.is_file() {
        return Err(format!("backup {name} not found"));
    }
    let target_root = if name.starts_with("mods-") {
        layout.server_dir().join(crate::mods::MODS_DIR)
    } else {
        layout.server_dir()
    };
    std::fs::create_dir_all(&target_root)
        .map_err(|e| format!("cannot create restore target: {e}"))?;

    let file = std::fs::File::open(&path).map_err(|e| format!("cannot open backup: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("cannot read backup: {e}"))?;

    let total: u64 = (0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|entry| entry.size()))
        .sum();
    let report = |done: u64, entries: usize, finished: bool| {
        if let Some(progress) = progress {
            if let Ok(mut guard) = progress.lock() {
                *guard = Some(RestoreProgress {
                    name: name.to_string(),
                    done,
                    total,
                    entries,
                    finished,
                });
            }
        }
    };
    report(0, 0, false);

    let mut done = 0u64;
    let mut entries = 0usize;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("cannot read backup entry: {e}"))?;
        let Some(relative) = entry.enclosed_name() else {
            return Err(format!("unsafe path in backup: {}", entry.name()));
        };
        let out = target_root.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("cannot create dir: {e}"))?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("cannot create dir: {e}"))?;
            }
            let mut output =
                std::fs::File::create(&out).map_err(|e| format!("cannot write file: {e}"))?;
            std::io::copy(&mut entry, &mut output).map_err(|e| format!("cannot copy file: {e}"))?;
            done += entry.size();
        }
        entries += 1;
        report(done, entries, false);
    }
    report(done, entries, true);
    Ok(())
}

pub fn delete_backup(layout: &Layout, name: &str) -> Result<(), String> {
    let path = backup_path(layout, name)?;
    std::fs::remove_file(&path).map_err(|e| format!("cannot delete {name}: {e}"))?;
    forget_integrity_record(layout, name);
    Ok(())
}

pub fn backup_path(layout: &Layout, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || !name.ends_with(".zip")
    {
        return Err(format!("invalid backup name: {name}"));
    }
    Ok(layout.backups_dir().join(name))
}

/// Count-based retention skips corrupt archives (they stay for inspection but
/// do not occupy retention slots); the optional size cap removes the oldest
/// archives first and never the newest one.
fn prune_server_backups(layout: &Layout, retention: usize, max_bytes: Option<u64>) {
    let dir = layout.backups_dir();
    let integrity = integrity_map(layout);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut backups: Vec<(String, u64, u64)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !(name.starts_with("server-") && name.ends_with(".zip")) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            Some((name, metadata.len(), modified))
        })
        .collect();
    // Oldest first (timestamp labels sort lexicographically).
    backups.sort_by(|a, b| a.0.cmp(&b.0));

    let corrupt = |name: &str| {
        integrity
            .get(name)
            .map(|info| !info.ok)
            .unwrap_or(false)
    };
    let mut remove: HashSet<String> = HashSet::new();
    let mut kept = 0usize;
    for (name, _, _) in backups.iter().rev() {
        if corrupt(name) {
            continue;
        }
        kept += 1;
        if kept > retention {
            remove.insert(name.clone());
        }
    }

    if let Some(max) = max_bytes {
        let mut total: u64 = backups
            .iter()
            .filter(|(name, _, _)| !remove.contains(name))
            .map(|(_, size, _)| *size)
            .sum();
        let newest = backups
            .iter()
            .max_by_key(|(_, _, modified)| *modified)
            .map(|(name, _, _)| name.clone());
        for (name, size, _) in backups.iter() {
            if total <= max {
                break;
            }
            if remove.contains(name) || Some(name) == newest.as_ref() {
                continue;
            }
            remove.insert(name.clone());
            total = total.saturating_sub(*size);
        }
    }

    for name in remove {
        let _ = std::fs::remove_file(dir.join(&name));
        forget_integrity_record(layout, &name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_backup_names() {
        let layout = Layout::new(std::env::temp_dir());
        assert!(backup_path(&layout, "../evil.zip").is_err());
        assert!(backup_path(&layout, "a/b.zip").is_err());
        assert!(backup_path(&layout, "notes.txt").is_err());
        assert!(backup_path(&layout, "server-1.zip").is_ok());
    }

    fn make_zip(path: &Path, bytes: usize) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("data.txt", options).unwrap();
        std::io::Write::write_all(&mut zip, &vec![0u8; bytes]).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn integrity_checks_and_pruning_rules() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-backups-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(layout.backups_dir()).unwrap();
        std::fs::create_dir_all(layout.config_dir()).unwrap();

        // A valid archive verifies; a truncated one does not.
        let first = "server-20260101-000000.zip";
        make_zip(&layout.backups_dir().join(first), 100);
        assert!(verify_backup(&layout, first).is_ok());
        record_integrity(&layout, first, &Ok(()));

        let bad = "server-20260102-000000.zip";
        let bad_path = layout.backups_dir().join(bad);
        make_zip(&bad_path, 100);
        let bytes = std::fs::read(&bad_path).unwrap();
        std::fs::write(&bad_path, &bytes[..bytes.len() / 2]).unwrap();
        assert!(verify_backup(&layout, bad).is_err());
        record_integrity(&layout, bad, &Err("truncated".into()));

        for name in ["server-20260103-000000.zip", "server-20260104-000000.zip"] {
            make_zip(&layout.backups_dir().join(name), 100);
            record_integrity(&layout, name, &Ok(()));
        }

        // Count-based retention: corrupt archives stay but do not use slots.
        prune_server_backups(&layout, 2, None);
        assert!(!layout.backups_dir().join(first).exists());
        assert!(bad_path.exists(), "corrupt archive stays for inspection");
        assert!(layout.backups_dir().join("server-20260103-000000.zip").exists());
        assert!(layout.backups_dir().join("server-20260104-000000.zip").exists());

        // Size cap removes oldest first and never the newest.
        prune_server_backups(&layout, 10, Some(150));
        assert!(!bad_path.exists());
        assert!(!layout.backups_dir().join("server-20260103-000000.zip").exists());
        assert!(layout.backups_dir().join("server-20260104-000000.zip").exists());

        // Records of deleted archives are forgotten.
        let map = integrity_map(&layout);
        assert!(!map.contains_key(first));
        assert!(!map.contains_key(bad));
        assert!(map.contains_key("server-20260104-000000.zip"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn restore_reports_progress() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-restore-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(layout.backups_dir()).unwrap();
        std::fs::create_dir_all(layout.server_dir()).unwrap();

        let name = "server-20260105-000000.zip";
        let path = layout.backups_dir().join(name);
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            for entry in ["a.txt", "b.txt"] {
                zip.start_file(entry, options).unwrap();
                std::io::Write::write_all(&mut zip, &vec![7u8; 100]).unwrap();
            }
            zip.finish().unwrap();
        }

        let handle: RestoreProgressHandle = Default::default();
        restore_backup(&layout, name, Some(&handle)).unwrap();
        let progress = handle.lock().unwrap().clone().unwrap();
        assert!(progress.finished);
        assert_eq!(progress.total, 200);
        assert_eq!(progress.done, 200);
        assert_eq!(progress.entries, 2);
        assert!(layout.server_dir().join("a.txt").exists());
        assert!(layout.server_dir().join("b.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
