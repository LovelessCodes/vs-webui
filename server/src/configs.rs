use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::mods::ScanError;

pub const MODCONFIG_DIR: &str = "ModConfig";

#[derive(Clone, Debug, Serialize)]
pub struct ModConfigFile {
    pub filename: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModConfigList {
    pub files: Vec<ModConfigFile>,
    pub errors: Vec<ScanError>,
}

/// Every `ModConfig/*.json` file in the server data directory.
pub fn list_mod_configs(data_dir: &Path) -> ModConfigList {
    let dir = data_dir.join(MODCONFIG_DIR);
    let mut files = Vec::new();
    let mut errors = Vec::new();

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return ModConfigList { files, errors };
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_json = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"));
        if !path.is_file() || !is_json {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().into_owned();
        match std::fs::read_to_string(&path) {
            Ok(content) => files.push(ModConfigFile { filename, content }),
            Err(e) => errors.push(ScanError {
                file: filename,
                stage: "read".into(),
                message: e.to_string(),
            }),
        }
    }

    files.sort_by_key(|file| file.filename.to_lowercase());
    ModConfigList { files, errors }
}

/// Validate (JSON5, like the game) and atomically write a mod config file.
pub fn write_mod_config(data_dir: &Path, filename: &str, content: &str) -> Result<(), String> {
    let filename = filename.trim();
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || !filename.to_lowercase().ends_with(".json")
    {
        return Err(format!("invalid config file name: {filename}"));
    }
    json5::from_str::<Value>(content)
        .map_err(|e| format!("Refusing to save invalid JSON5: {e}"))?;

    let dir = data_dir.join(MODCONFIG_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create ModConfig dir: {e}"))?;
    let path = dir.join(filename);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_filenames() {
        let dir = Path::new("/tmp");
        assert!(write_mod_config(dir, "../evil.json", "{}").is_err());
        assert!(write_mod_config(dir, "a/b.json", "{}").is_err());
        assert!(write_mod_config(dir, "notes.txt", "{}").is_err());
    }

    #[test]
    fn rejects_invalid_json5() {
        let dir = std::env::temp_dir().join("vs-webui-config-test");
        assert!(write_mod_config(&dir, "test.json", "{nope").is_err());
        assert!(write_mod_config(&dir, "test.json", "{\"a\":1,}").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
