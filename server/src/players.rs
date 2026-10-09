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

/// Removes a whitelist entry by uid or name (case-insensitive). Returns
/// whether an entry was removed. Works while the server is stopped.
pub fn remove_whitelist_entry(
    server_dir: &Path,
    uid: Option<&str>,
    name: Option<&str>,
) -> Result<bool, String> {
    let path = server_dir.join("playerwhitelist.json");
    if !path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("playerwhitelist.json is not readable: {e}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("playerwhitelist.json is not valid JSON: {e}"))?;
    let array = value
        .as_array_mut()
        .ok_or("playerwhitelist.json is not an array")?;

    let field = |object: &serde_json::Map<String, Value>, keys: &[&str]| -> Option<String> {
        object
            .iter()
            .find(|(key, _)| keys.iter().any(|want| key.eq_ignore_ascii_case(want)))
            .and_then(|(_, value)| value.as_str())
            .map(|value| value.to_lowercase())
    };

    let uid = uid.map(str::to_lowercase);
    let name = name.map(str::to_lowercase);
    let before = array.len();
    array.retain(|item| {
        let Some(object) = item.as_object() else {
            return true;
        };
        let entry_uid = field(object, &["uid", "playeruid", "uuid"]);
        let entry_name = field(object, &["name", "playername"]);
        let uid_match = uid
            .as_deref()
            .is_some_and(|want| entry_uid.as_deref() == Some(want));
        let name_match = name
            .as_deref()
            .is_some_and(|want| entry_name.as_deref() == Some(want));
        !(uid_match || name_match)
    });
    if array.len() == before {
        return Ok(false);
    }

    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))?;
    Ok(true)
}

#[derive(Clone, Debug, Serialize)]
pub struct BanEntry {
    pub name: Option<String>,
    pub uid: Option<String>,
    pub reason: Option<String>,
    pub until: Option<String>,
}

/// Tolerant read of `Playerdata/playersbanned.json` (the game writes it).
pub fn read_bans(server_dir: &Path) -> Vec<BanEntry> {
    let path = server_dir.join("Playerdata").join("playersbanned.json");
    let Some(array) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_array().cloned())
    else {
        return Vec::new();
    };
    array
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
            Some(BanEntry {
                name: field(&["name", "playername"]),
                uid: field(&["uid", "playeruid", "uuid"]),
                reason: field(&["reason"]),
                until: field(&["untildate", "until", "expires"]),
            })
        })
        .collect()
}

/// Removes a ban by uid or name from the ban file (server must be stopped; a
/// running server is unbanned through the console instead).
pub fn remove_ban_file(
    server_dir: &Path,
    uid: Option<&str>,
    name: Option<&str>,
) -> Result<bool, String> {
    let path = server_dir.join("Playerdata").join("playersbanned.json");
    if !path.exists() {
        return Ok(false);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("playersbanned.json is not readable: {e}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("playersbanned.json is not valid JSON: {e}"))?;
    let array = value
        .as_array_mut()
        .ok_or("playersbanned.json is not an array")?;

    let field = |object: &serde_json::Map<String, Value>, keys: &[&str]| -> Option<String> {
        object
            .iter()
            .find(|(key, _)| keys.iter().any(|want| key.eq_ignore_ascii_case(want)))
            .and_then(|(_, value)| value.as_str())
            .map(|value| value.to_lowercase())
    };
    let uid = uid.map(str::to_lowercase);
    let name = name.map(str::to_lowercase);
    let before = array.len();
    array.retain(|item| {
        let Some(object) = item.as_object() else {
            return true;
        };
        let entry_uid = field(object, &["uid", "playeruid", "uuid"]);
        let entry_name = field(object, &["name", "playername"]);
        let uid_match = uid
            .as_deref()
            .is_some_and(|want| entry_uid.as_deref() == Some(want));
        let name_match = name
            .as_deref()
            .is_some_and(|want| entry_name.as_deref() == Some(want));
        !(uid_match || name_match)
    });
    if array.len() == before {
        return Ok(false);
    }
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))?;
    Ok(true)
}

#[derive(Clone, Debug, Serialize)]
pub struct RoleEntry {
    pub code: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<i64>,
}

/// Role definitions from `serverroles.json`, falling back to the `Roles` array
/// in `serverconfig.json`.
pub fn read_roles(server_dir: &Path) -> Vec<RoleEntry> {
    let from = |value: &Value| -> Option<Vec<RoleEntry>> {
        let array = value.get("Roles").and_then(Value::as_array)?;
        Some(
            array
                .iter()
                .filter_map(|item| {
                    let object = item.as_object()?;
                    let code = object.get("Code").and_then(Value::as_str)?.to_string();
                    let name = object
                        .get("Name")
                        .and_then(Value::as_str)
                        .unwrap_or(&code)
                        .to_string();
                    let level = object.get("PrivilegeLevel").and_then(Value::as_i64);
                    Some(RoleEntry { code, name, level })
                })
                .collect(),
        )
    };
    std::fs::read_to_string(server_dir.join("serverroles.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| from(&value))
        .or_else(|| {
            std::fs::read_to_string(server_dir.join("serverconfig.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| from(&value))
        })
        .unwrap_or_default()
}

/// Current role per player name, from `Playerdata/playerdata.json`.
pub fn player_roles(server_dir: &Path) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let Some(array) = std::fs::read_to_string(server_dir.join("Playerdata").join("playerdata.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_array().cloned())
    else {
        return map;
    };
    for item in array {
        let Some(object) = item.as_object() else {
            continue;
        };
        let name = object
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("playername"))
            .and_then(|(_, value)| value.as_str());
        let role = object
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("role"))
            .and_then(|(_, value)| value.as_str());
        if let (Some(name), Some(role)) = (name, role) {
            map.insert(name.to_string(), role.to_string());
        }
    }
    map
}

/// Sets a player's role in `playerdata.json` (server must be stopped).
pub fn set_player_role_file(server_dir: &Path, name: &str, code: &str) -> Result<(), String> {
    let path = server_dir.join("Playerdata").join("playerdata.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("playerdata.json is not readable: {e}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("playerdata.json is not valid JSON: {e}"))?;
    let array = value
        .as_array_mut()
        .ok_or("playerdata.json is not an array")?;
    let mut found = false;
    for item in array.iter_mut() {
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        let matches = object
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("playername"))
            .and_then(|(_, value)| value.as_str())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(name));
        if matches {
            let key = object
                .keys()
                .find(|key| key.eq_ignore_ascii_case("role"))
                .cloned()
                .unwrap_or_else(|| "Role".into());
            object.insert(key, Value::String(code.to_string()));
            found = true;
            break;
        }
    }
    if !found {
        return Err(format!("player {name} has no saved data yet"));
    }
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))?;
    Ok(())
}

/// Recognizes moderation commands sent through the console so they can be
/// recorded in the player's history.
pub fn moderation_action(command: &str) -> Option<(String, String)> {
    let rest = command.trim().strip_prefix('/')?;
    let mut parts = rest.split_whitespace();
    let verb = parts.next()?.to_ascii_lowercase();
    let action = match verb.as_str() {
        "kick" | "ban" | "unban" | "op" | "deop" => verb,
        _ => return None,
    };
    let player = parts.next()?.trim().to_string();
    (!player.is_empty()).then_some((action, player))
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
