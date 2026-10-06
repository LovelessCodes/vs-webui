use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::console::now_unix;
use crate::paths::Layout;
use crate::storage::dir_size;

pub const WORLD_EXT: &str = "vcdbs";
/// SQLite sidecar files that belong to a world file.
const SIDECAR_SUFFIXES: [&str; 2] = ["-shm", "-wal"];

#[derive(Serialize)]
pub struct SaveEntry {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub active: bool,
    /// Pre-`vcdbs` world stored as a folder.
    pub legacy: bool,
}

pub fn saves_dir(layout: &Layout) -> PathBuf {
    layout.server_dir().join("Saves")
}

fn serverconfig_path(layout: &Layout) -> PathBuf {
    layout.server_dir().join("serverconfig.json")
}

/// Validate a world name: a plain file/folder name inside `Saves`.
fn validate_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.starts_with('.')
    {
        return Err("invalid world name".into());
    }
    Ok(trimmed)
}

/// Path of a world: `<name>.vcdbs` (modern) or the legacy `<name>/` folder.
pub fn world_path(layout: &Layout, name: &str) -> Result<PathBuf, String> {
    let name = validate_name(name)?;
    let modern = saves_dir(layout).join(format!("{name}.{WORLD_EXT}"));
    if modern.is_file() {
        return Ok(modern);
    }
    let legacy = saves_dir(layout).join(name);
    if legacy.is_dir() {
        return Ok(legacy);
    }
    Err(format!("{name} is not a world"))
}

/// The world the server will load, from `serverconfig.json > WorldConfig`:
/// `SaveFileLocation` stem first, then `WorldName`.
pub fn active_world(layout: &Layout) -> Option<String> {
    let config = world_config_object(layout)?;
    if let Some(location) = config.get("SaveFileLocation").and_then(Value::as_str) {
        let stem = Path::new(location.trim())
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !stem.is_empty() {
            return Some(stem);
        }
    }
    config
        .get("WorldName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

/// `serverconfig.json > WorldConfig` as an object, when present.
fn world_config_object(layout: &Layout) -> Option<serde_json::Map<String, Value>> {
    let raw = std::fs::read_to_string(serverconfig_path(layout)).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    value.get("WorldConfig")?.as_object().cloned()
}

pub fn list_saves(layout: &Layout) -> Vec<SaveEntry> {
    let Ok(entries) = std::fs::read_dir(saves_dir(layout)) else {
        return Vec::new();
    };
    let active = active_world(layout);
    let mut saves: Vec<SaveEntry> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name.starts_with('.') {
            continue;
        }
        let (name, legacy, size) = if path.is_file() {
            if !file_name.to_lowercase().ends_with(&format!(".{WORLD_EXT}")) {
                continue;
            }
            let stem = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            (stem, false, file_size_with_sidecars(&path))
        } else if path.is_dir() {
            (file_name, true, dir_size(&path))
        } else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        saves.push(SaveEntry {
            name,
            size,
            modified: modified_time(&path),
            active: false,
            legacy,
        });
    }

    if let Some(active) = active.as_deref() {
        for save in saves.iter_mut() {
            save.active = save.name.eq_ignore_ascii_case(active);
        }
    }
    // With a single world and no configured target the server loads it.
    if active.is_none() && saves.len() == 1 {
        if let Some(save) = saves.first_mut() {
            save.active = true;
        }
    }
    saves.sort_by(|a, b| b.modified.cmp(&a.modified));
    saves
}

fn file_size_with_sidecars(path: &Path) -> u64 {
    let mut size = path.metadata().map(|meta| meta.len()).unwrap_or(0);
    for suffix in SIDECAR_SUFFIXES {
        let sidecar = sidecar_path(path, suffix);
        size += sidecar
            .metadata()
            .map(|meta| meta.len())
            .unwrap_or_default();
    }
    size
}

fn sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

fn modified_time(path: &Path) -> u64 {
    path.metadata()
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Points `serverconfig.json > WorldConfig.SaveFileLocation` at this world
/// (takes effect on next start).
pub fn activate(layout: &Layout, name: &str) -> Result<(), String> {
    let world = world_path(layout, name)?;
    let file_name = world
        .file_name()
        .map(|part| part.to_string_lossy().into_owned())
        .unwrap_or_default();
    let location = format!("Saves/{file_name}");

    let path = serverconfig_path(layout);
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("serverconfig.json is not readable: {e}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("serverconfig.json is not valid JSON: {e}"))?;
    let root = value
        .as_object_mut()
        .ok_or("serverconfig.json is not an object")?;
    let world_config = root
        .entry("WorldConfig")
        .or_insert_with(|| Value::Object(Default::default()));
    let world_config = world_config
        .as_object_mut()
        .ok_or("serverconfig.json WorldConfig is not an object")?;
    world_config.insert("SaveFileLocation".into(), Value::String(location));

    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

pub fn delete_save(layout: &Layout, name: &str) -> Result<(), String> {
    let path = world_path(layout, name)?;
    if path.is_dir() {
        return std::fs::remove_dir_all(&path).map_err(|e| format!("cannot delete {name}: {e}"));
    }
    std::fs::remove_file(&path).map_err(|e| format!("cannot delete {name}: {e}"))?;
    for suffix in SIDECAR_SUFFIXES {
        let _ = std::fs::remove_file(sidecar_path(&path, suffix));
    }
    Ok(())
}

/// World settings live in `serverconfig.json > WorldConfig`. Returns the pretty
/// JSON of that object plus a flag when serverconfig.json does not exist yet.
pub fn read_world_config(layout: &Layout, _name: &str) -> Result<(String, bool), String> {
    let path = serverconfig_path(layout);
    if !path.exists() {
        return Ok(("{}".into(), true));
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("serverconfig.json is not readable: {e}"))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("serverconfig.json is not valid JSON: {e}"))?;
    let world_config = value
        .get("WorldConfig")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default()));
    let pretty = serde_json::to_string_pretty(&world_config).map_err(|e| e.to_string())?;
    Ok((pretty, false))
}

pub fn write_world_config(layout: &Layout, _name: &str, content: &str) -> Result<(), String> {
    let parsed: Value =
        json5::from_str(content).map_err(|e| format!("Refusing to save invalid JSON5: {e}"))?;
    if !parsed.is_object() {
        return Err("world config must be a JSON object".into());
    }
    let path = serverconfig_path(layout);
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        format!("serverconfig.json is not readable ({e}) — it is generated on first server start")
    })?;
    let mut value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("serverconfig.json is not valid JSON: {e}"))?;
    let root = value
        .as_object_mut()
        .ok_or("serverconfig.json is not an object")?;
    root.insert("WorldConfig".into(), parsed);
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

/// Zips a world into `config/exports` and returns (path, download filename).
pub fn zip_save(layout: &Layout, name: &str) -> Result<(PathBuf, String), String> {
    let world = world_path(layout, name)?;
    let exports = layout.config_dir().join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| format!("cannot create exports dir: {e}"))?;
    let filename = format!("{name}-{}.zip", now_unix());
    let zip_path = exports.join(&filename);
    let file =
        std::fs::File::create(&zip_path).map_err(|e| format!("cannot create archive: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    if world.is_dir() {
        add_dir(&mut zip, &world, Path::new(""), &options)?;
    } else {
        add_file(&mut zip, &world, &options)?;
        for suffix in SIDECAR_SUFFIXES {
            let sidecar = sidecar_path(&world, suffix);
            if sidecar.is_file() {
                add_file(&mut zip, &sidecar, &options)?;
            }
        }
    }
    zip.finish()
        .map_err(|e| format!("cannot finish archive: {e}"))?;
    Ok((zip_path, filename))
}

/// Imports an uploaded world. `.vcdbs` files are copied in directly; zip
/// archives are searched for a `.vcdbs` member (legacy world folders work
/// too). Returns the final world name.
pub fn import_world(layout: &Layout, source: &Path, original_name: &str) -> Result<String, String> {
    let lower = original_name.to_lowercase();
    if lower.ends_with(&format!(".{WORLD_EXT}")) {
        let stem = original_name
            .trim_end_matches(&format!(".{WORLD_EXT}"))
            .trim_end_matches(&format!(".{}", WORLD_EXT.to_uppercase()));
        return import_vcdbs(layout, source, stem);
    }
    if !lower.ends_with(".zip") {
        return Err("upload a .vcdbs world file or a .zip archive".into());
    }

    let dir = saves_dir(layout);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create Saves dir: {e}"))?;
    let staging = dir.join(format!(".upload-{}", now_unix()));
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    std::fs::create_dir_all(&staging).map_err(|e| format!("cannot create staging dir: {e}"))?;

    let result = (|| -> Result<String, String> {
        let file = std::fs::File::open(source).map_err(|e| format!("cannot open zip: {e}"))?;
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

        // Prefer a modern `.vcdbs` world file anywhere in the archive.
        if let Some(vcdbs) = find_vcdbs(&staging) {
            let stem = vcdbs
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            let name = import_vcdbs(layout, &vcdbs, &stem)?;
            return Ok(name);
        }

        // Legacy folder-style world: a single top-level directory.
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
            (staging.clone(), sanitize_name(original_name))
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

fn find_vcdbs(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name.ends_with(&format!(".{WORLD_EXT}")) {
            return Some(path);
        }
    }
    subdirs.into_iter().find_map(|dir| find_vcdbs(&dir))
}

fn import_vcdbs(layout: &Layout, source: &Path, raw_name: &str) -> Result<String, String> {
    let name = sanitize_name(raw_name);
    if name.is_empty() {
        return Err("cannot determine a world name".into());
    }
    let dir = saves_dir(layout);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create Saves dir: {e}"))?;
    let target = dir.join(format!("{name}.{WORLD_EXT}"));
    if target.exists() {
        return Err(format!("a world named {name} already exists"));
    }
    std::fs::rename(source, &target).or_else(|_| {
        std::fs::copy(source, &target).map(|_| ()).and_then(|_| {
            std::fs::remove_file(source).or(Ok(()))
        })
    })
    .map_err(|e| format!("cannot move world into place: {e}"))?;
    Ok(name)
}

fn sanitize_name(input: &str) -> String {
    let base = input
        .trim()
        .trim_end_matches(&format!(".{WORLD_EXT}"))
        .trim_end_matches(&format!(".{}", WORLD_EXT.to_uppercase()))
        .trim_end_matches(".zip")
        .trim_end_matches(".ZIP");
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

fn add_file(
    zip: &mut zip::ZipWriter<std::fs::File>,
    path: &Path,
    options: &zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|part| part.to_string_lossy().into_owned())
        .unwrap_or_default();
    zip.start_file(name, *options)
        .map_err(|e| format!("cannot add to archive: {e}"))?;
    let mut source = std::fs::File::open(path).map_err(|e| format!("cannot open file: {e}"))?;
    let mut buffer = Vec::new();
    source
        .read_to_end(&mut buffer)
        .map_err(|e| format!("cannot read file: {e}"))?;
    std::io::Write::write_all(zip, &buffer).map_err(|e| format!("cannot write entry: {e}"))?;
    Ok(())
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
        assert!(world_path(&layout, "../evil").is_err());
        assert!(world_path(&layout, "a/b").is_err());
        assert!(world_path(&layout, "").is_err());
        assert!(world_path(&layout, ".hidden").is_err());
        assert!(world_path(&layout, "Ember Hollow").is_err()); // nothing installed
    }

    #[test]
    fn lists_vcdbs_files_and_reads_active_world() {
        let dir = std::env::temp_dir().join(format!("vs-webui-saves-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(saves_dir(&layout)).unwrap();
        std::fs::write(saves_dir(&layout).join("Ember Hollow.vcdbs"), vec![0u8; 64]).unwrap();
        std::fs::write(saves_dir(&layout).join("Ember Hollow.vcdbs-wal"), vec![0u8; 8]).unwrap();
        std::fs::write(saves_dir(&layout).join("Old World.vcdbs"), vec![0u8; 32]).unwrap();
        std::fs::write(
            serverconfig_path(&layout),
            serde_json::json!({
                "WorldConfig": { "SaveFileLocation": "Saves/Old World.vcdbs", "WorldName": "Ignored" }
            })
            .to_string(),
        )
        .unwrap();

        let saves = list_saves(&layout);
        assert_eq!(saves.len(), 2);
        let active = saves.iter().find(|save| save.active).unwrap();
        assert_eq!(active.name, "Old World");
        let ember = saves.iter().find(|save| save.name == "Ember Hollow").unwrap();
        assert_eq!(ember.size, 72); // world file + sidecar
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitizes_uploaded_fallback_names() {
        assert_eq!(sanitize_name("My World.zip"), "My World");
        assert_eq!(sanitize_name("default.vcdbs"), "default");
        assert_eq!(sanitize_name(""), "imported");
    }
}
