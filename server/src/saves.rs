use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::console::now_unix;
use crate::paths::Layout;
use crate::storage::dir_size;

pub const WORLD_CONFIG: &str = "worldconfig.json";

#[derive(Serialize)]
pub struct SaveEntry {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub active: bool,
}

pub fn saves_dir(layout: &Layout) -> PathBuf {
    layout.server_dir().join("Saves")
}

/// Validate a world name: a plain directory name inside `Saves`.
pub fn save_path(layout: &Layout, name: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err("invalid world name".into());
    }
    Ok(saves_dir(layout).join(trimmed))
}

/// Active world from `serverconfig.json` (`WorldName`), when set.
pub fn read_world_name(layout: &Layout) -> Option<String> {
    let raw = std::fs::read_to_string(layout.server_dir().join("serverconfig.json")).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let name = value.get("WorldName")?.as_str()?.trim().to_string();
    (!name.is_empty()).then_some(name)
}

pub fn list_saves(layout: &Layout) -> Vec<SaveEntry> {
    let Ok(entries) = std::fs::read_dir(saves_dir(layout)) else {
        return Vec::new();
    };
    let world_name = read_world_name(layout);
    let mut saves: Vec<SaveEntry> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta = entry.metadata().ok();
            SaveEntry {
                size: dir_size(&entry.path()),
                modified: meta
                    .and_then(|meta| meta.modified().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0),
                active: world_name.as_deref() == Some(name.as_str()),
                name,
            }
        })
        .collect();
    // With a single save and no configured WorldName the server will load it.
    if world_name.is_none() && saves.len() == 1 {
        if let Some(entry) = saves.first_mut() {
            entry.active = true;
        }
    }
    saves.sort_by(|a, b| b.modified.cmp(&a.modified));
    saves
}

/// Writes `WorldName` into serverconfig.json (takes effect on next start).
pub fn activate(layout: &Layout, name: &str) -> Result<(), String> {
    let path = layout.server_dir().join("serverconfig.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("serverconfig.json is not readable: {e}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("serverconfig.json is not valid JSON: {e}"))?;
    let object = value
        .as_object_mut()
        .ok_or("serverconfig.json is not an object")?;
    object.insert("WorldName".into(), Value::String(name.trim().to_string()));
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

pub fn delete_save(layout: &Layout, name: &str) -> Result<(), String> {
    let path = save_path(layout, name)?;
    if !path.is_dir() {
        return Err(format!("{name} is not a world"));
    }
    std::fs::remove_dir_all(&path).map_err(|e| format!("cannot delete {name}: {e}"))
}

/// Reads the save's `worldconfig.json`; `true` when the file does not exist yet.
pub fn read_world_config(layout: &Layout, name: &str) -> Result<(String, bool), String> {
    let path = save_path(layout, name)?.join(WORLD_CONFIG);
    if !path.exists() {
        return Ok(("{}".into(), true));
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("cannot read {WORLD_CONFIG}: {e}"))?;
    Ok((content, false))
}

pub fn write_world_config(layout: &Layout, name: &str, content: &str) -> Result<(), String> {
    json5::from_str::<Value>(content).map_err(|e| format!("Refusing to save invalid JSON5: {e}"))?;
    let dir = save_path(layout, name)?;
    if !dir.is_dir() {
        return Err(format!("{name} is not a world"));
    }
    let path = dir.join(WORLD_CONFIG);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

/// Zips a save into `config/exports` and returns (path, download filename).
pub fn zip_save(layout: &Layout, name: &str) -> Result<(PathBuf, String), String> {
    let dir = save_path(layout, name)?;
    if !dir.is_dir() {
        return Err(format!("{name} is not a world"));
    }
    let exports = layout.config_dir().join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| format!("cannot create exports dir: {e}"))?;
    let filename = format!("{name}-{}.zip", now_unix());
    let zip_path = exports.join(&filename);
    let file =
        std::fs::File::create(&zip_path).map_err(|e| format!("cannot create archive: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    add_dir(&mut zip, &dir, Path::new(""), &options)?;
    zip.finish()
        .map_err(|e| format!("cannot finish archive: {e}"))?;
    Ok((zip_path, filename))
}

/// Extracts an uploaded world zip. A zip containing exactly one top-level
/// folder is imported under that folder's name; otherwise the uploaded file
/// name is used. Returns the final world name.
pub fn import_zip(layout: &Layout, zip_path: &Path, fallback_name: &str) -> Result<String, String> {
    let dir = saves_dir(layout);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create Saves dir: {e}"))?;
    let staging = dir.join(format!(".upload-{}", now_unix()));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    std::fs::create_dir_all(&staging).map_err(|e| format!("cannot create staging dir: {e}"))?;

    let result = (|| -> Result<String, String> {
        let file = std::fs::File::open(zip_path).map_err(|e| format!("cannot open zip: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("invalid zip archive: {e}"))?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("zip entry error: {e}"))?;
            // `enclosed_name` rejects traversal (../, absolute paths).
            let Some(relative) = entry.enclosed_name() else {
                continue;
            };
            let out = staging.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&out).map_err(|e| format!("cannot create dir: {e}"))?;
                continue;
            }
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("cannot create dir: {e}"))?;
            }
            let mut target =
                std::fs::File::create(&out).map_err(|e| format!("cannot write file: {e}"))?;
            std::io::copy(&mut entry, &mut target).map_err(|e| format!("cannot copy file: {e}"))?;
        }

        let roots: Vec<PathBuf> = std::fs::read_dir(&staging)
            .map_err(|e| format!("cannot read staging dir: {e}"))?
            .flatten()
            .map(|entry| entry.path())
            .collect();
        let (root, name) = if roots.len() == 1 && roots[0].is_dir() {
            let name = roots[0]
                .file_name()
                .map(|part| part.to_string_lossy().into_owned())
                .unwrap_or_default();
            (roots[0].clone(), name)
        } else {
            (staging.clone(), sanitize_name(fallback_name))
        };
        if name.is_empty() {
            return Err("cannot determine a world name from the archive".into());
        }
        if dir_size(&root) == 0 {
            return Err("the archive contains no files".into());
        }
        let target = dir.join(&name);
        if target.exists() {
            return Err(format!("a world named {name} already exists"));
        }
        std::fs::rename(&root, &target).map_err(|e| format!("cannot move world into place: {e}"))?;
        Ok(name)
    })();

    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

fn sanitize_name(input: &str) -> String {
    let base = input.trim().trim_end_matches(".zip");
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().to_string();
    if trimmed.is_empty() {
        "imported".into()
    } else {
        trimmed.chars().take(64).collect()
    }
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
            add_dir(zip, &path, &relative, options)?;
        } else if path.is_file() {
            let relative_name = relative.to_string_lossy().replace('\\', "/");
            zip.start_file(relative_name, *options)
                .map_err(|e| format!("cannot add to archive: {e}"))?;
            let mut source =
                std::fs::File::open(&path).map_err(|e| format!("cannot open file: {e}"))?;
            let mut buffer = Vec::new();
            source
                .read_to_end(&mut buffer)
                .map_err(|e| format!("cannot read file: {e}"))?;
            std::io::Write::write_all(zip, &buffer)
                .map_err(|e| format!("cannot write entry: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_world_names() {
        let layout = Layout::new(std::env::temp_dir());
        assert!(save_path(&layout, "../evil").is_err());
        assert!(save_path(&layout, "a/b").is_err());
        assert!(save_path(&layout, "").is_err());
        assert!(save_path(&layout, "Ember Hollow").is_ok());
    }

    #[test]
    fn sanitizes_uploaded_fallback_names() {
        assert_eq!(sanitize_name("My World.zip"), "My World");
        assert_eq!(sanitize_name("../../etc/passwd"), ".._.._etc_passwd");
        assert_eq!(sanitize_name(""), "imported");
    }
}
