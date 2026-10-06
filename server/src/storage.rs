use std::path::Path;

use serde::Serialize;

use crate::paths::Layout;

#[derive(Serialize)]
pub struct StorageArea {
    pub name: &'static str,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct StorageView {
    pub areas: Vec<StorageArea>,
    pub free_bytes: u64,
    pub total_bytes: u64,
    pub vanilla_builds: Vec<BuildSize>,
    pub stratum_builds: Vec<BuildSize>,
}

#[derive(Serialize)]
pub struct BuildSize {
    pub id: String,
    pub bytes: u64,
}

/// Disk usage overview of the data directory, caching left to the caller.
pub fn storage_view(layout: &Layout) -> StorageView {
    let server_dir = layout.server_dir();
    let areas = vec![
        StorageArea {
            name: "runtime",
            bytes: dir_size(&layout.root.join("runtime")),
        },
        StorageArea {
            name: "saves",
            bytes: dir_size(&server_dir.join("Saves")),
        },
        StorageArea {
            name: "mods",
            bytes: dir_size(&server_dir.join("Mods")),
        },
        StorageArea {
            name: "logs",
            bytes: dir_size(&server_dir.join("Logs")),
        },
        StorageArea {
            name: "backups",
            bytes: dir_size(&layout.backups_dir()),
        },
        StorageArea {
            name: "config",
            bytes: dir_size(&layout.config_dir()),
        },
    ];

    let vanilla_builds = build_sizes(&layout.root.join("runtime").join("vanilla"));
    let stratum_builds = build_sizes(&layout.root.join("runtime").join("stratum"));

    let (free_bytes, total_bytes) = disk_space(&layout.root);

    StorageView {
        areas,
        free_bytes,
        total_bytes,
        vanilla_builds,
        stratum_builds,
    }
}

/// Sizes of each direct child directory (used where subfolders are the units).
fn build_sizes(dir: &Path) -> Vec<BuildSize> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut builds: Vec<BuildSize> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| BuildSize {
            id: entry.file_name().to_string_lossy().into_owned(),
            bytes: dir_size(&entry.path()),
        })
        .collect();
    builds.sort_by(|a, b| a.id.cmp(&b.id));
    builds
}

/// Recursively sums file sizes; symlinks are not followed.
pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total += dir_size(&entry_path);
        } else if metadata.is_file() {
            total += metadata.len();
        }
    }
    total
}

/// Free/total bytes of the disk holding `path` (best effort).
fn disk_space(path: &Path) -> (u64, u64) {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut best: Option<(&sysinfo::Disk, usize)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if canonical.starts_with(mount) {
            let depth = mount.components().count();
            if best.map(|(_, current)| depth > current).unwrap_or(true) {
                best = Some((disk, depth));
            }
        }
    }
    match best {
        Some((disk, _)) => (disk.available_space(), disk.total_space()),
        None => match disks.list().first() {
            Some(disk) => (disk.available_space(), disk.total_space()),
            None => (0, 0),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_nested_file_sizes() {
        let dir = std::env::temp_dir().join(format!("vs-webui-storage-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("a/one.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("a/b/two.bin"), vec![0u8; 50]).unwrap();
        assert_eq!(dir_size(&dir), 150);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
