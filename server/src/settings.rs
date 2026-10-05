use serde::{Deserialize, Serialize};
use std::path::Path;

fn default_flavor() -> String {
    "vanilla".into()
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: None,
            flavor: default_flavor(),
            auto_start: false,
            auto_restart: false,
            start_params: String::new(),
            pinned_mods: Vec::new(),
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
