use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::state::SharedState;

const CACHE_TTL: Duration = Duration::from_secs(300);
pub const CHANNELS: [&str; 2] = ["stable", "unstable"];

#[derive(Clone, Debug, Serialize)]
pub struct VersionEntry {
    pub version: String,
    pub filename: String,
    pub size: String,
    pub md5: String,
    pub url: String,
    pub latest: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstallStatus {
    pub version: String,
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub message: Option<String>,
    pub success: Option<bool>,
}

#[derive(Deserialize)]
struct LinuxServer {
    filename: String,
    #[serde(default)]
    filesize: String,
    #[serde(default)]
    md5: String,
    urls: DownloadUrls,
    #[serde(default)]
    latest: Option<i64>,
}

#[derive(Deserialize)]
struct DownloadUrls {
    cdn: String,
}

pub struct VersionCache {
    client: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Vec<VersionEntry>)>>,
}

impl VersionCache {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// All versions of a channel, newest first. Cached for 5 minutes.
    pub async fn list(&self, channel: &str) -> Result<Vec<VersionEntry>, String> {
        if !CHANNELS.contains(&channel) {
            return Err(format!("unknown channel: {channel}"));
        }
        {
            let cache = self.cache.lock().await;
            if let Some((fetched, entries)) = cache.get(channel) {
                if fetched.elapsed() < CACHE_TTL {
                    return Ok(entries.clone());
                }
            }
        }
        let entries = self.fetch(channel).await?;
        self.cache
            .lock()
            .await
            .insert(channel.to_string(), (Instant::now(), entries.clone()));
        Ok(entries)
    }

    pub async fn fetch(&self, channel: &str) -> Result<Vec<VersionEntry>, String> {
        let url = format!("https://api.vintagestory.at/{channel}.json");
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("manifest request failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("manifest HTTP {}", response.status()));
        }
        let manifest: HashMap<String, HashMap<String, serde_json::Value>> =
            response
                .json()
                .await
                .map_err(|e| format!("manifest parse failed: {e}"))?;

        let mut entries: Vec<VersionEntry> = manifest
            .into_iter()
            .filter_map(|(version, platforms)| {
                let raw = platforms.get("linuxserver")?;
                let server: LinuxServer = serde_json::from_value(raw.clone()).ok()?;
                Some(VersionEntry {
                    version,
                    filename: server.filename,
                    size: server.filesize,
                    md5: server.md5,
                    url: server.urls.cdn,
                    latest: server.latest.unwrap_or(0) == 1,
                })
            })
            .collect();
        entries.sort_by(|a, b| compare_versions(&b.version, &a.version));
        Ok(entries)
    }
}

/// Numeric comparison of `major.minor.patch` style versions; prerelease
/// suffixes (`-rc.1`, `-pre`) sort below the matching release.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let key = |v: &str| -> Vec<u64> {
        v.split(['-', '+'])
            .next()
            .unwrap_or(v)
            .split(|c: char| !c.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u64>().ok())
            .collect()
    };
    let (ka, kb) = (key(a), key(b));
    for i in 0..ka.len().max(kb.len()) {
        let x = ka.get(i).copied().unwrap_or(0);
        let y = kb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => {}
            other => return other,
        }
    }
    let pre = |v: &str| v.contains("-rc") || v.contains("-pre") || v.contains("-dev");
    match (pre(a), pre(b)) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => Ordering::Equal,
    }
}

fn set_install(state: &SharedState, f: impl FnOnce(&mut InstallStatus)) {
    let mut guard = state.install.lock().unwrap();
    if let Some(install) = guard.as_mut() {
        f(install);
    }
}

/// Download, verify and extract a server build. Runs in a background task.
pub async fn run_install(state: SharedState, version: String, channel: String) {
    state.supervisor.console.push(format!(
        "[manager] installing Vintage Story {version} ({channel})"
    ));
    match do_install(&state, &version, &channel).await {
        Ok(()) => {
            set_install(&state, |install| {
                install.phase = "done".into();
                install.success = Some(true);
                install.message = Some(format!("Vintage Story {version} installed"));
            });
            state
                .supervisor
                .console
                .push(format!("[manager] installed {version}"));
        }
        Err(message) => {
            state
                .supervisor
                .console
                .push(format!("[manager] install failed: {message}"));
            set_install(&state, |install| {
                install.phase = "error".into();
                install.success = Some(false);
                install.message = Some(message);
            });
        }
    }
}

async fn do_install(state: &SharedState, version: &str, channel: &str) -> Result<(), String> {
    let entries = state.versions.list(channel).await?;
    let entry = entries
        .into_iter()
        .find(|entry| entry.version == version)
        .ok_or_else(|| format!("version {version} not found in the {channel} channel"))?;

    let archive = state
        .layout
        .vanilla_dir()
        .join(format!("{}.part", entry.filename));
    let tmp_dir = state.layout.vanilla_dir().join(format!("{version}.tmp"));
    let final_dir = state.layout.vanilla_version_dir(version);

    {
        let mut guard = state.install.lock().unwrap();
        *guard = Some(InstallStatus {
            version: version.to_string(),
            phase: "downloading".into(),
            downloaded: 0,
            total: 0,
            message: None,
            success: None,
        });
    }

    // Download + hash.
    let response = state
        .versions
        .client()
        .get(&entry.url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download HTTP {}", response.status()));
    }
    let total = response
        .content_length()
        .unwrap_or_else(|| parse_size(&entry.size));
    set_install(state, |install| install.total = total);

    if let Some(parent) = archive.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let mut file = tokio::fs::File::create(&archive)
        .await
        .map_err(|e| format!("cannot create archive: {e}"))?;
    let mut hasher = Md5::new();
    let mut downloaded: u64 = 0;
    let mut last_report: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write failed: {e}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        if downloaded - last_report >= 512 * 1024 {
            last_report = downloaded;
            set_install(state, |install| install.downloaded = downloaded);
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    drop(file);
    set_install(state, |install| {
        install.downloaded = downloaded;
        install.phase = "verifying".into();
    });

    let digest = format!("{:x}", hasher.finalize());
    if !entry.md5.is_empty() && !digest.eq_ignore_ascii_case(&entry.md5) {
        let _ = std::fs::remove_file(&archive);
        return Err(format!(
            "checksum mismatch for {version}: expected {}, got {digest}",
            entry.md5
        ));
    }

    // Extract into a temp dir, then move into place.
    set_install(state, |install| install.phase = "extracting".into());
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("cannot create temp dir: {e}"))?;
    let extract_archive = archive.clone();
    let extract_dir = tmp_dir.clone();
    let result =
        tokio::task::spawn_blocking(move || extract_tar_gz(&extract_archive, &extract_dir))
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
        guard.version = Some(version.to_string());
        let _ = guard.save(&state.layout.settings_path());
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("cannot open archive: {e}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    tar.unpack(dest)
        .map_err(|e| format!("extract failed: {e}"))?;

    // Some archives nest everything under a single top folder; flatten it.
    if !dest.join("VintagestoryServer").exists() {
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
    if !dest.join("VintagestoryServer").exists() && !dest.join("VintagestoryServer.dll").exists() {
        return Err("archive does not contain a Vintage Story server".into());
    }
    Ok(())
}

fn parse_size(display: &str) -> u64 {
    let cleaned = display.trim();
    let split = cleaned
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(cleaned.len());
    let (number, unit) = cleaned.split_at(split);
    let value: f64 = number.parse().unwrap_or(0.0);
    let unit = unit.trim().to_ascii_lowercase();
    let factor = if unit.starts_with("gb") {
        1024.0 * 1024.0 * 1024.0
    } else if unit.starts_with("mb") {
        1024.0 * 1024.0
    } else if unit.starts_with("kb") {
        1024.0
    } else {
        1.0
    };
    (value * factor) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_versions_numerically() {
        assert_eq!(compare_versions("1.22.7", "1.22.10"), Ordering::Less);
        assert_eq!(compare_versions("1.22.7", "1.22.7"), Ordering::Equal);
        assert_eq!(compare_versions("1.9.0", "1.10.0"), Ordering::Less);
    }

    #[test]
    fn prerelease_sorts_below_release() {
        assert_eq!(compare_versions("1.23.0-rc.1", "1.23.0"), Ordering::Less);
        assert_eq!(compare_versions("1.23.0", "1.23.0-rc.1"), Ordering::Greater);
    }

    #[test]
    fn parses_display_sizes() {
        assert_eq!(parse_size("51.4 MB"), 53_896_806);
        assert_eq!(parse_size("2 KB"), 2048);
        assert_eq!(parse_size("100"), 100);
    }
}
