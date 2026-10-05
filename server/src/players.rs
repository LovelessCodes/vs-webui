use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Clone, Debug, Serialize)]
pub struct WhitelistEntry {
    pub name: Option<String>,
    pub uid: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct WhitelistView {
    pub entries: Vec<WhitelistEntry>,
    pub error: Option<String>,
}

/// Tolerant read of `playerwhitelist.json`: the game writes it, we only display
/// it, so field names are matched case-insensitively (`uid`/`PlayerUID`, …).
pub fn read_whitelist(server_dir: &Path) -> WhitelistView {
    let path = server_dir.join("playerwhitelist.json");
    if !path.exists() {
        return WhitelistView {
            entries: Vec::new(),
            error: None,
        };
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) => {
            return WhitelistView {
                entries: Vec::new(),
                error: Some(format!("cannot read playerwhitelist.json: {e}")),
            }
        }
    };
    let value: Value = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(e) => {
            return WhitelistView {
                entries: Vec::new(),
                error: Some(format!("playerwhitelist.json is not valid JSON: {e}")),
            }
        }
    };
    let Some(array) = value.as_array() else {
        return WhitelistView {
            entries: Vec::new(),
            error: Some("playerwhitelist.json is not an array".into()),
        };
    };

    let entries = array
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let field = |keys: &[&str]| -> Option<String> {
                object
                    .iter()
                    .find(|(key, _)| keys.iter().any(|want| key.eq_ignore_ascii_case(want)))
                    .and_then(|(_, value)| value.as_str())
                    .map(|value| value.to_string())
            };
            Some(WhitelistEntry {
                name: field(&["name", "playername"]),
                uid: field(&["uid", "playeruid", "uuid"]),
            })
        })
        .collect();

    WhitelistView {
        entries,
        error: None,
    }
}

/// `OnlyWhitelisted` (modern configs) or `WhitelistMode` (legacy: 2 = on).
pub fn whitelist_enabled(server_dir: &Path) -> Option<bool> {
    let content = std::fs::read_to_string(server_dir.join("serverconfig.json")).ok()?;
    let value: Value = serde_json::from_str(&content).ok()?;
    if let Some(enabled) = value.get("OnlyWhitelisted").and_then(Value::as_bool) {
        return Some(enabled);
    }
    value
        .get("WhitelistMode")
        .and_then(Value::as_i64)
        .map(|mode| mode == 2)
}

/// Flip the whitelist switch in serverconfig.json (game restart required).
pub fn set_whitelist_enabled(server_dir: &Path, enabled: bool) -> Result<(), String> {
    let path = server_dir.join("serverconfig.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("serverconfig.json is not readable: {e}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("serverconfig.json is not valid JSON: {e}"))?;
    let object = value
        .as_object_mut()
        .ok_or("serverconfig.json is not an object")?;
    if object.contains_key("OnlyWhitelisted") {
        object.insert("OnlyWhitelisted".into(), Value::Bool(enabled));
    } else {
        object.insert(
            "WhitelistMode".into(),
            Value::Number(if enabled { 2 } else { 1 }.into()),
        );
    }
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_both_whitelist_shapes() {
        let dir = std::env::temp_dir().join("vs-webui-whitelist-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("playerwhitelist.json"),
            r#"[{"PlayerUID":"abc","PlayerName":"Alice"},{"uid":"def","name":"Bob"}]"#,
        )
        .unwrap();
        let view = read_whitelist(&dir);
        assert!(view.error.is_none());
        assert_eq!(view.entries.len(), 2);
        assert_eq!(view.entries[0].name.as_deref(), Some("Alice"));
        assert_eq!(view.entries[1].uid.as_deref(), Some("def"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn flips_modern_and_legacy_whitelist_switches() {
        let dir = std::env::temp_dir().join("vs-webui-whitelist-mode-test");
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(
            dir.join("serverconfig.json"),
            r#"{"OnlyWhitelisted": false, "WhitelistMode": 0}"#,
        )
        .unwrap();
        set_whitelist_enabled(&dir, true).unwrap();
        assert_eq!(whitelist_enabled(&dir), Some(true));

        std::fs::write(dir.join("serverconfig.json"), r#"{"WhitelistMode": 1}"#).unwrap();
        set_whitelist_enabled(&dir, true).unwrap();
        assert_eq!(whitelist_enabled(&dir), Some(true));
        set_whitelist_enabled(&dir, false).unwrap();
        assert_eq!(whitelist_enabled(&dir), Some(false));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
