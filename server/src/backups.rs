use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::mods::timestamp_label;
use crate::paths::Layout;

/// Directories never included in a server-data backup (logs/caches/tmp).
const SKIP_DIRS: [&str; 4] = ["Logs", "Cache", "Backups", "BackupSaves"];

#[derive(Clone, Debug, Serialize)]
pub struct BackupEntry {
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

pub fn list_backups(layout: &Layout) -> Vec<BackupEntry> {
    let Ok(entries) = std::fs::read_dir(layout.backups_dir()) else {
        return Vec::new();
    };
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

/// Zip the server data directory (world, mods, configs, player data).
pub fn create_server_backup(layout: &Layout, retention: usize) -> Result<String, String> {
    let server_dir = layout.server_dir();
    if !server_dir.exists() {
        return Err("server data directory does not exist".into());
    }
    std::fs::create_dir_all(layout.backups_dir())
        .map_err(|e| format!("cannot create backups dir: {e}"))?;

    let name = format!("server-{}.zip", timestamp_label());
    let path = layout.backups_dir().join(&name);
    let file = std::fs::File::create(&path).map_err(|e| format!("cannot create backup: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    add_dir(&mut zip, &server_dir, Path::new(""), &options)?;
    zip.finish()
        .map_err(|e| format!("cannot finish backup: {e}"))?;
    prune_server_backups(layout, retention);
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
/// directory. The caller must ensure the server is stopped.
pub fn restore_backup(layout: &Layout, name: &str) -> Result<(), String> {
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
        }
    }
    Ok(())
}

pub fn delete_backup(layout: &Layout, name: &str) -> Result<(), String> {
    let path = backup_path(layout, name)?;
    std::fs::remove_file(&path).map_err(|e| format!("cannot delete {name}: {e}"))
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

fn prune_server_backups(layout: &Layout, retention: usize) {
    let dir = layout.backups_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut backups: Vec<String> = entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.starts_with("server-") && name.ends_with(".zip")
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    backups.sort();
    while backups.len() > retention {
        let oldest = backups.remove(0);
        let _ = std::fs::remove_file(dir.join(oldest));
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
}
