use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use tokio::io::AsyncWriteExt;

use crate::configs::{ModConfigFile, ModConfigList};
use crate::paths::Layout;
use crate::mods::ScanError;
use crate::state::SharedState;
use crate::versions::{set_install_status, InstallStatus};

const RELEASES_URL: &str =
    "https://api.github.com/repos/StratumServer/Stratum/releases?per_page=30";
const CACHE_TTL: Duration = Duration::from_secs(600);

/// A Stratum release with the linux-x64 launcher asset.
#[derive(Clone, Debug, Serialize)]
pub struct StratumRelease {
    pub tag: String,
    pub name: String,
    /// Base Vintage Story version the release patches (from the tag).
    pub vs_version: String,
    /// Stratum revision suffix (e.g. `2` from `v1.22.7-stratum.2`).
    pub stratum_version: String,
    pub asset_name: String,
    pub asset_url: String,
    pub size: u64,
    pub published_at: String,
    pub prerelease: bool,
}

pub struct StratumCache {
    client: reqwest::Client,
    cache: Mutex<Option<(Instant, Vec<StratumRelease>)>>,
}

impl StratumCache {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            cache: Mutex::new(None),
        }
    }

    pub async fn releases(&self) -> Result<Vec<StratumRelease>, String> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some((at, releases)) = cache.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    return Ok(releases.clone());
                }
            }
        }
        let releases = self.fetch().await?;
        *self.cache.lock().unwrap() = Some((Instant::now(), releases.clone()));
        Ok(releases)
    }

    /// Cache-only view of the release list (no network).
    pub fn cached_releases(&self) -> Option<Vec<StratumRelease>> {
        self.cache
            .lock()
            .unwrap()
            .as_ref()
            .map(|(_, releases)| releases.clone())
    }

    pub async fn release(&self, tag: &str) -> Result<StratumRelease, String> {
        self.releases()
            .await?
            .into_iter()
            .find(|release| release.tag == tag)
            .ok_or_else(|| format!("Stratum release {tag} not found"))
    }

    async fn fetch(&self) -> Result<Vec<StratumRelease>, String> {
        let response = self
            .client
            .get(RELEASES_URL)
            .header("accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("GitHub request failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("GitHub HTTP {}", response.status()));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("GitHub response parse failed: {e}"))?;
        let items = body
            .as_array()
            .ok_or("unexpected GitHub releases response")?;

        let mut releases: Vec<StratumRelease> = items
            .iter()
            .filter_map(|item| {
                let tag = item.get("tag_name")?.as_str()?.to_string();
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&tag)
                    .to_string();
                let prerelease = item
                    .get("prerelease")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let published_at = item
                    .get("published_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let asset = item.get("assets")?.as_array()?.iter().find(|asset| {
                    asset
                        .get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|name| name.ends_with("linux-x64.zip"))
                })?;
                let asset_name = asset.get("name")?.as_str()?.to_string();
                let asset_url = asset.get("browser_download_url")?.as_str()?.to_string();
                let size = asset.get("size").and_then(Value::as_u64).unwrap_or(0);
                let (vs_version, stratum_version) = parse_tag(&tag);
                Some(StratumRelease {
                    tag,
                    name,
                    vs_version,
                    stratum_version,
                    asset_name,
                    asset_url,
                    size,
                    published_at,
                    prerelease,
                })
            })
            .collect();

        releases.sort_by(|a, b| {
            crate::versions::compare_versions(&b.vs_version, &a.vs_version).then_with(|| {
                crate::versions::compare_versions(&b.stratum_version, &a.stratum_version)
            })
        });
        Ok(releases)
    }
}

/// `v1.22.7-stratum.2` → (`1.22.7`, `2`).
fn parse_tag(tag: &str) -> (String, String) {
    let trimmed = tag.trim_start_matches('v');
    match trimmed.split_once("-stratum") {
        Some((vs, rest)) => (
            vs.to_string(),
            rest.trim_start_matches(['.', '-']).to_string(),
        ),
        None => (trimmed.to_string(), String::new()),
    }
}

/// Download, extract and activate a Stratum release. Runs in a background task.
pub async fn run_install(state: SharedState, tag: String) {
    state
        .supervisor
        .console
        .push(format!("[manager] installing Stratum {tag}"));
    match do_install(&state, &tag).await {
        Ok(()) => {
            set_install_status(&state, |install| {
                install.phase = "done".into();
                install.success = Some(true);
                install.message = Some(format!("Stratum {tag} installed"));
            });
            state
                .supervisor
                .console
                .push(format!("[manager] installed Stratum {tag}"));
        }
        Err(message) => {
            state
                .supervisor
                .console
                .push(format!("[manager] Stratum install failed: {message}"));
            set_install_status(&state, |install| {
                install.phase = "error".into();
                install.success = Some(false);
                install.message = Some(message);
            });
        }
    }
}

async fn do_install(state: &SharedState, tag: &str) -> Result<(), String> {
    let release = state.stratum.release(tag).await?;
    if release.asset_url.is_empty() {
        return Err(format!("release {tag} has no linux-x64 asset"));
    }

    let archive = state
        .layout
        .stratum_dir()
        .join(format!("{}.zip.part", release.asset_name));
    let tmp_dir = state.layout.stratum_dir().join(format!("{tag}.tmp"));
    let final_dir = state.layout.stratum_version_dir(tag);

    {
        let mut guard = state.install.lock().unwrap();
        *guard = Some(InstallStatus {
            version: tag.to_string(),
            phase: "downloading".into(),
            downloaded: 0,
            total: release.size,
            message: None,
            success: None,
        });
    }

    let response = state
        .versions
        .client()
        .get(&release.asset_url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(release.size);
    set_install_status(state, |install| install.total = total);

    if let Some(parent) = archive.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let mut file = tokio::fs::File::create(&archive)
        .await
        .map_err(|e| format!("cannot create archive: {e}"))?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_report: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        downloaded += chunk.len() as u64;
        if downloaded - last_report >= 256 * 1024 {
            last_report = downloaded;
            set_install_status(state, |install| install.downloaded = downloaded);
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    drop(file);
    set_install_status(state, |install| {
        install.downloaded = downloaded;
        install.phase = "extracting".into();
    });

    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("cannot create temp dir: {e}"))?;
    let extract_archive = archive.clone();
    let extract_dir = tmp_dir.clone();
    let result =
        tokio::task::spawn_blocking(move || extract_stratum_zip(&extract_archive, &extract_dir))
            .await
            .map_err(|e| format!("extract task failed: {e}"))?;
    if let Err(message) = result {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        let _ = std::fs::remove_file(&archive);
        return Err(message);
    }

    let _ = std::fs::remove_dir_all(&final_dir);
    std::fs::rename(&tmp_dir, &final_dir)
        .map_err(|e| format!("cannot move install into place: {e}"))?;
    let _ = std::fs::remove_file(&archive);

    {
        let mut guard = state.settings.lock().unwrap();
        guard.stratum_tag = Some(tag.to_string());
        guard.flavor = "stratum".into();
        let _ = guard.save(&state.layout.settings_path());
    }
    Ok(())
}

fn extract_stratum_zip(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("cannot open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("cannot read zip: {e}"))?;
    zip.extract(dest)
        .map_err(|e| format!("extract failed: {e}"))?;

    // Some archives nest everything under a single top folder; flatten it.
    if !dest.join("StratumServer").exists() {
        let entries: Vec<_> = std::fs::read_dir(dest)
            .map_err(|e| format!("cannot read {}: {e}", dest.display()))?
            .flatten()
            .collect();
        if entries.len() == 1 && entries[0].path().is_dir() {
            let inner = entries[0].path();
            for entry in std::fs::read_dir(&inner)
                .map_err(|e| format!("cannot read {}: {e}", inner.display()))?
                .flatten()
            {
                let target = dest.join(entry.file_name());
                std::fs::rename(entry.path(), &target)
                    .map_err(|e| format!("cannot move {}: {e}", target.display()))?;
            }
            let _ = std::fs::remove_dir(&inner);
        }
    }

    let exe = dest.join("StratumServer");
    if !exe.exists() {
        return Err("archive does not contain StratumServer".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&exe)
            .map_err(|e| format!("cannot stat StratumServer: {e}"))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&exe, permissions)
            .map_err(|e| format!("cannot mark StratumServer executable: {e}"))?;
    }
    Ok(())
}

// ── Stratum config files (data path root) ───────────────────────────────────

/// Removes an installed Stratum release. The caller checks that it is not the
/// selected tag and that the server is stopped.
pub fn delete_release(layout: &Layout, tag: &str) -> Result<(), String> {
    let trimmed = tag.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err("invalid tag".into());
    }
    let dir = layout.stratum_version_dir(trimmed);
    if !dir.is_dir() {
        return Err(format!("{trimmed} is not installed"));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("cannot delete {trimmed}: {e}"))
}

/// `stratum.json`, `stratum-commands.json`, `stratum-performance.json` — written
/// by Stratum on its first run.
pub fn list_stratum_configs(server_dir: &Path) -> ModConfigList {
    let mut files = Vec::new();
    let mut errors = Vec::new();

    let Ok(entries) = std::fs::read_dir(server_dir) else {
        return ModConfigList { files, errors };
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_stratum =
            name.to_lowercase().starts_with("stratum") && name.to_lowercase().ends_with(".json");
        if !path.is_file() || !is_stratum {
            continue;
        }
        match std::fs::read_to_string(&path) {
            Ok(content) => files.push(ModConfigFile {
                filename: name,
                content,
            }),
            Err(e) => errors.push(ScanError {
                file: name,
                stage: "read".into(),
                message: e.to_string(),
            }),
        }
    }
    files.sort_by_key(|file| file.filename.to_lowercase());
    ModConfigList { files, errors }
}

pub fn write_stratum_config(
    server_dir: &Path,
    filename: &str,
    content: &str,
) -> Result<(), String> {
    let filename = filename.trim();
    let lower = filename.to_lowercase();
    if !lower.starts_with("stratum")
        || !lower.ends_with(".json")
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
    {
        return Err(format!("invalid Stratum config file name: {filename}"));
    }
    json5::from_str::<Value>(content).map_err(|e| format!("Refusing to save invalid JSON: {e}"))?;

    let path = server_dir.join(filename);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace failed: {e}"))
}

/// Read the vanilla server archive hash marker helper (kept for tests).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_tags() {
        assert_eq!(
            parse_tag("v1.22.7-stratum.2"),
            ("1.22.7".to_string(), "2".to_string())
        );
        assert_eq!(
            parse_tag("v1.22.7-stratum.1.1"),
            ("1.22.7".to_string(), "1.1".to_string())
        );
        assert_eq!(parse_tag("v1.23.0"), ("1.23.0".to_string(), String::new()));
    }

    #[test]
    fn rejects_bad_stratum_config_names() {
        let dir = std::env::temp_dir();
        assert!(write_stratum_config(&dir, "stratum.json", "{}").is_ok());
        assert!(write_stratum_config(&dir, "modconfig.json", "{}").is_err());
        assert!(write_stratum_config(&dir, "../stratum.json", "{}").is_err());
        assert!(write_stratum_config(&dir, "stratum.json", "{nope").is_err());
    }
}
