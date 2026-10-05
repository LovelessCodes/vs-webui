use serde_json::Value;
use std::path::PathBuf;

use crate::paths::Layout;

pub fn config_path(layout: &Layout) -> PathBuf {
    layout.server_dir().join("serverconfig.json")
}

/// The server writes its own (complete) config on first start; we only read it
/// back. `None` means the server has not run yet.
pub fn read(layout: &Layout) -> Option<String> {
    std::fs::read_to_string(config_path(layout)).ok()
}

/// Validate and atomically write the raw `serverconfig.json`.
pub fn write(layout: &Layout, content: &str) -> Result<(), String> {
    serde_json::from_str::<Value>(content).map_err(|e| format!("Invalid JSON: {e}"))?;
    let path = config_path(layout);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("Failed to write: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to replace: {e}"))
}
