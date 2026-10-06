use serde::{Deserialize, Serialize};
use std::path::Path;

fn default_flavor() -> String {
    "vanilla".into()
}

fn default_retention() -> u32 {
    10
}

fn is_false(v: &bool) -> bool {
    !*v
}

/// Manager settings, persisted as `config/settings.json`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    /// Active game version (must be installed before it can start).
    #[serde(default)]
    pub version: Option<String>,
    /// `vanilla` or `stratum` (Stratum lands in phase 4).
    #[serde(default = "default_flavor")]
    pub flavor: String,
    /// Installed Stratum release tag, e.g. `v1.22.7-stratum.2`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stratum_tag: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_start: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub auto_restart: bool,
    /// Extra CLI arguments appended to the server command line.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub start_params: String,
    /// Mods excluded from update checks and "Update All" (lowercased modids).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pinned_mods: Vec<String>,
    /// Mods starred in the browser (lowercased mod keys).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub favorite_mods: Vec<String>,
    /// Daily restart time as local `HH:MM`; `None` disables scheduled restarts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_schedule: Option<String>,
    /// How many backups of each kind to keep.
    #[serde(default = "default_retention")]
    pub backup_retention: u32,
}

/// Parse a 24-hour `HH:MM` time.
pub fn parse_hhmm(value: &str) -> Option<(u32, u32)> {
    let (hours, minutes) = value.trim().split_once(':')?;
    let hours: u32 = hours.parse().ok()?;
    let minutes: u32 = minutes.parse().ok()?;
    (hours < 24 && minutes < 60).then_some((hours, minutes))
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: None,
            flavor: default_flavor(),
            stratum_tag: None,
            auto_start: false,
            auto_restart: false,
            start_params: String::new(),
            pinned_mods: Vec::new(),
            favorite_mods: Vec::new(),
            restart_schedule: None,
            backup_retention: default_retention(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        std::fs::rename(tmp, path)
    }
}
