use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::sync::Notify;

use crate::console::now_unix;
use crate::paths::Layout;
use crate::state::SharedState;
use crate::versions::compare_versions;

pub const MODS_DIR: &str = "Mods";
const DB_CACHE_TTL: Duration = Duration::from_secs(300);
const TAGS_CACHE_TTL: Duration = Duration::from_secs(3600);
const MAX_JOBS: usize = 100;

// ── ModDB client (with small response cache) ────────────────────────────────

pub struct ModDbCache {
    client: reqwest::Client,
    lists: Mutex<HashMap<String, (Instant, Value)>>,
    details: Mutex<HashMap<String, (Instant, Value)>>,
    tags: Mutex<Option<(Instant, Value)>>,
    gameversions: Mutex<Option<(Instant, Value)>>,
}

impl ModDbCache {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            lists: Mutex::new(HashMap::new()),
            details: Mutex::new(HashMap::new()),
            tags: Mutex::new(None),
            gameversions: Mutex::new(None),
        }
    }

    /// Mod list filtered by game versions and/or search text.
    pub async fn mods(&self, versions: &[String], text: &str) -> Result<Value, String> {
        let versions: Vec<String> = versions
            .iter()
            .map(|version| version.trim().to_string())
            .filter(|version| !version.is_empty())
            .collect();
        let text = text.trim();
        let key = format!("{}|{text}", versions.join(","));
        if let Some(value) = cached(&self.lists, &key, DB_CACHE_TTL) {
            return Ok(value);
        }
        let mut params: Vec<(String, String)> = Vec::new();
        for version in &versions {
            params.push(("gameversions[]".into(), version.clone()));
        }
        if !text.is_empty() {
            params.push(("text".into(), text.to_string()));
        }
        let value = self
            .fetch_json("https://mods.vintagestory.at/api/mods", &params)
            .await?;
        self.lists
            .lock()
            .unwrap()
            .insert(key, (Instant::now(), value.clone()));
        Ok(value)
    }

    /// Every game version tag known to ModDB (for the version filter).
    pub async fn gameversions(&self) -> Result<Value, String> {
        if let Some((at, value)) = self.gameversions.lock().unwrap().clone() {
            if at.elapsed() < TAGS_CACHE_TTL {
                return Ok(value);
            }
        }
        let value = self
            .fetch_json("https://mods.vintagestory.at/api/gameversions", &[])
            .await?;
        *self.gameversions.lock().unwrap() = Some((Instant::now(), value.clone()));
        Ok(value)
    }

    pub async fn tags(&self) -> Result<Value, String> {
        if let Some((at, value)) = self.tags.lock().unwrap().clone() {
            if at.elapsed() < TAGS_CACHE_TTL {
                return Ok(value);
            }
        }
        let value = self
            .fetch_json("https://mods.vintagestory.at/api/tags", &[])
            .await?;
        *self.tags.lock().unwrap() = Some((Instant::now(), value.clone()));
        Ok(value)
    }

    /// Full mod detail including the release list.
    pub async fn detail(&self, modid: &str) -> Result<Value, String> {
        let modid = modid.trim();
        if modid.is_empty()
            || !modid
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(format!("invalid mod id: {modid}"));
        }
        let key = modid.to_lowercase();
        if let Some(value) = cached(&self.details, &key, DB_CACHE_TTL) {
            return Ok(value);
        }
        let url = format!("https://mods.vintagestory.at/api/mod/{modid}");
        let value = self.fetch_json(&url, &[]).await?;
        self.details
            .lock()
            .unwrap()
            .insert(key, (Instant::now(), value.clone()));
        Ok(value)
    }

    /// `modidstr@version` update check, skipping pinned mods.
    pub async fn updates(&self, mods: &[InstalledMod], pinned: &[String]) -> Result<Value, String> {
        let pinned: HashSet<String> = pinned.iter().map(|p| p.to_lowercase()).collect();
        let params = mods
            .iter()
            .filter(|m| !pinned.contains(&m.modid.to_lowercase()))
            .map(|m| format!("{}@{}", m.modid, m.version))
            .collect::<Vec<_>>()
            .join(",");
        if params.is_empty() {
            return Ok(json!({ "updates": {} }));
        }
        let value = self
            .fetch_json(
                "https://mods.vintagestory.at/api/updates",
                &[("mods".to_string(), params)],
            )
            .await?;
        // Normalize keys to lowercase so the UI can match installed modids
        // case-insensitively.
        let updates = value
            .get("updates")
            .and_then(Value::as_object)
            .map(|map| {
                map.iter()
                    .map(|(key, value)| (key.to_lowercase(), value.clone()))
                    .collect::<serde_json::Map<String, Value>>()
            })
            .unwrap_or_default();
        Ok(json!({ "updates": updates }))
    }

    async fn fetch_json(&self, url: &str, params: &[(String, String)]) -> Result<Value, String> {
        let response = self
            .client
            .get(url)
            .query(params)
            .send()
            .await
            .map_err(|e| format!("ModDB request failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("ModDB HTTP {}", response.status()));
        }
        let text = response
            .text()
            .await
            .map_err(|e| format!("ModDB read failed: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("ModDB response parse failed: {e}"))
    }
}

fn cached(
    map: &Mutex<HashMap<String, (Instant, Value)>>,
    key: &str,
    ttl: Duration,
) -> Option<Value> {
    let guard = map.lock().unwrap();
    guard
        .get(key)
        .filter(|(at, _)| at.elapsed() < ttl)
        .map(|(_, value)| value.clone())
}

// ── installed mod scan ──────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct InstalledMod {
    pub modid: String,
    pub name: String,
    pub authors: Vec<String>,
    pub version: String,
    /// File name inside the `Mods` directory.
    pub file: String,
    pub dependencies: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScanError {
    pub file: String,
    pub stage: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModScan {
    pub mods: Vec<InstalledMod>,
    pub errors: Vec<ScanError>,
}

/// Scan the `Mods` directory, reading `modinfo.json` from every zip.
pub fn scan_mods(mods_dir: &Path) -> ModScan {
    let mut mods = Vec::new();
    let mut errors = Vec::new();

    let Ok(entries) = std::fs::read_dir(mods_dir) else {
        return ModScan { mods, errors };
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_zip = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"));
        if !path.is_file() || !is_zip {
            continue;
        }
        let file = entry.file_name().to_string_lossy().into_owned();

        let parsed = read_installed_mod(&path);
        match parsed {
            Ok(Some(mut module)) => {
                module.file = file;
                mods.push(module);
            }
            Ok(None) => {}
            Err((stage, message)) => errors.push(ScanError {
                file,
                stage,
                message,
            }),
        }
    }

    mods.sort_by_key(|module| module.name.to_lowercase());
    ModScan { mods, errors }
}

/// Returns `Ok(None)` for zips without a `modinfo.json` (not mods).
fn read_installed_mod(zip_path: &Path) -> Result<Option<InstalledMod>, (String, String)> {
    let file =
        std::fs::File::open(zip_path).map_err(|e| ("open_zip".to_string(), e.to_string()))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| ("open_zip".to_string(), e.to_string()))?;

    for index in 0..archive.len() {
        let mut entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(e) => return Err(("read_entry".to_string(), e.to_string())),
        };
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry.name().to_string();
        let base = Path::new(&entry_name)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if !base.eq_ignore_ascii_case("modinfo.json") {
            continue;
        }

        let mut contents = String::new();
        entry
            .read_to_string(&mut contents)
            .map_err(|e| ("read_entry".to_string(), e.to_string()))?;
        let info: Value =
            json5::from_str(&contents).map_err(|e| ("parse_json".to_string(), e.to_string()))?;

        let modid = modinfo_modid(&info);
        let name = modinfo_string(&info, "name").unwrap_or_else(|| "Unknown Mod".into());
        let authors = {
            let authors = modinfo_string_array(&info, "authors");
            if authors.is_empty() {
                vec!["Unknown".into()]
            } else {
                authors
            }
        };
        let version = modinfo_string(&info, "version").unwrap_or_else(|| "0.0.0".into());
        let dependencies = dependencies_from_modinfo(&info);

        return Ok(Some(InstalledMod {
            modid,
            name,
            authors,
            version,
            file: String::new(),
            dependencies,
        }));
    }

    Ok(None)
}

/// The `dependencies` map of a mod zip's `modinfo.json` (modid -> version).
pub fn read_zip_dependencies(zip_path: &Path) -> HashMap<String, String> {
    match read_installed_mod(zip_path) {
        Ok(Some(module)) => module.dependencies,
        _ => HashMap::new(),
    }
}

fn modinfo_field<'v>(value: &'v Value, key: &str) -> Option<&'v Value> {
    value
        .as_object()
        .and_then(|obj| obj.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)))
        .map(|(_, value)| value)
}

fn modinfo_string(value: &Value, key: &str) -> Option<String> {
    modinfo_field(value, key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn modinfo_string_array(value: &Value, key: &str) -> Vec<String> {
    modinfo_field(value, key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn modinfo_modid(value: &Value) -> String {
    match modinfo_field(value, "modid") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => "0".to_string(),
    }
}

fn dependencies_from_modinfo(value: &Value) -> HashMap<String, String> {
    modinfo_field(value, "dependencies")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(modid, version)| {
                    let modid = modid.trim();
                    if modid.is_empty() {
                        return None;
                    }
                    Some((
                        modid.to_string(),
                        version.as_str().unwrap_or_default().trim().to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

// ── releases ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Release {
    #[serde(default)]
    pub mainfile: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub modversion: String,
    #[serde(default)]
    pub fileid: i64,
}

#[derive(Debug, Deserialize)]
struct ModDetailEnvelope {
    #[serde(rename = "mod")]
    module: ModDetail,
}

#[derive(Debug, Deserialize)]
struct ModDetail {
    #[serde(default)]
    name: String,
    #[serde(default)]
    releases: Vec<Release>,
}

fn parse_detail(value: &Value) -> Result<ModDetail, String> {
    serde_json::from_value::<ModDetailEnvelope>(value.clone())
        .map(|envelope| envelope.module)
        .map_err(|e| format!("unexpected ModDB detail shape: {e}"))
}

/// Pick the release to install: an exact version, the newest satisfying a
/// minimum-version constraint, or the newest overall.
fn pick_release<'a>(
    releases: &'a [Release],
    version: Option<&str>,
    constraint: Option<&str>,
) -> Option<&'a Release> {
    if let Some(version) = version.map(str::trim).filter(|v| !v.is_empty()) {
        return releases.iter().find(|r| r.modversion == version);
    }
    if let Some(constraint) = constraint.map(str::trim).filter(|c| !c.is_empty()) {
        if let Some(best) = releases
            .iter()
            .filter(|r| compare_versions(&r.modversion, constraint) != std::cmp::Ordering::Less)
            .max_by(|a, b| compare_versions(&a.modversion, &b.modversion))
        {
            return Some(best);
        }
    }
    releases
        .iter()
        .max_by(|a, b| compare_versions(&a.modversion, &b.modversion))
}

// ── job queue ───────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct ModJob {
    pub id: u64,
    pub action: String,
    pub modid: String,
    pub name: String,
    pub version: Option<String>,
    pub file: Option<String>,
    pub status: String,
    pub progress: u64,
    pub total: u64,
    pub error: Option<String>,
    pub dependency: bool,
    pub created_at: u64,
    pub finished_at: Option<u64>,
}

pub struct NewJob {
    pub action: String,
    pub modid: String,
    pub name: String,
    pub version: Option<String>,
    pub file: Option<String>,
    pub constraint: Option<String>,
    pub dependency: bool,
}

#[derive(Clone, Debug)]
struct JobSpec {
    constraint: Option<String>,
}

pub struct ModsManager {
    jobs: Mutex<Vec<ModJob>>,
    specs: Mutex<HashMap<u64, JobSpec>>,
    next_id: AtomicU64,
    notify: Notify,
}

impl ModsManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(Vec::new()),
            specs: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            notify: Notify::new(),
        }
    }

    pub fn jobs(&self) -> Vec<ModJob> {
        let mut jobs = self.jobs.lock().unwrap();
        prune_jobs(&mut jobs);
        jobs.clone()
    }

    pub fn has_pending(&self, modid: &str) -> bool {
        let modid = modid.to_lowercase();
        self.jobs.lock().unwrap().iter().any(|job| {
            job.modid.to_lowercase() == modid && (job.status == "queued" || job.status == "running")
        })
    }

    pub fn enqueue(&self, job: NewJob) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        {
            let mut jobs = self.jobs.lock().unwrap();
            jobs.push(ModJob {
                id,
                action: job.action,
                modid: job.modid,
                name: job.name,
                version: job.version,
                file: job.file,
                status: "queued".into(),
                progress: 0,
                total: 0,
                error: None,
                dependency: job.dependency,
                created_at: now_unix(),
                finished_at: None,
            });
            prune_jobs(&mut jobs);
        }
        self.specs.lock().unwrap().insert(
            id,
            JobSpec {
                constraint: job.constraint,
            },
        );
        self.notify.notify_one();
        id
    }

    pub async fn run_worker(self: Arc<Self>, state: SharedState) {
        loop {
            self.notify.notified().await;
            while self.process_one(&state).await {}
        }
    }

    fn update(&self, id: u64, f: impl FnOnce(&mut ModJob)) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(job) = jobs.iter_mut().find(|job| job.id == id) {
            f(job);
        }
    }

    async fn process_one(&self, state: &SharedState) -> bool {
        let job = {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(job) = jobs.iter_mut().find(|job| job.status == "queued") else {
                return false;
            };
            job.status = "running".into();
            job.clone()
        };

        let result = self.execute(state, &job).await;
        match result {
            Ok(()) => {
                state
                    .supervisor
                    .console
                    .push(format!("[manager] {} {} finished", job.action, job.name));
                self.update(job.id, |job| {
                    job.status = "done".into();
                    job.progress = job.total;
                    job.finished_at = Some(now_unix());
                });
            }
            Err(message) => {
                state.supervisor.console.push(format!(
                    "[manager] {} {} failed: {message}",
                    job.action, job.name
                ));
                self.update(job.id, |job| {
                    job.status = "error".into();
                    job.error = Some(message);
                    job.finished_at = Some(now_unix());
                });
            }
        }
        self.specs.lock().unwrap().remove(&job.id);
        true
    }

    async fn execute(&self, state: &SharedState, job: &ModJob) -> Result<(), String> {
        let mods_dir = state.layout.server_dir().join(MODS_DIR);
        std::fs::create_dir_all(&mods_dir).map_err(|e| format!("cannot create Mods dir: {e}"))?;

        if job.action == "remove" {
            let file = job.file.as_deref().ok_or("missing file")?;
            let path = mods_dir.join(safe_filename(file));
            std::fs::remove_file(&path).map_err(|e| format!("cannot remove {file}: {e}"))?;
            return Ok(());
        }

        // install / update
        let detail_value = state.moddb.detail(&job.modid).await?;
        let detail = parse_detail(&detail_value)?;
        if !detail.name.is_empty() {
            self.update(job.id, |j| j.name = detail.name.clone());
        }
        let constraint = self
            .specs
            .lock()
            .unwrap()
            .get(&job.id)
            .and_then(|spec| spec.constraint.clone());
        let release = pick_release(
            &detail.releases,
            job.version.as_deref(),
            constraint.as_deref(),
        )
        .ok_or_else(|| format!("no release found for {}", job.modid))?
        .clone();
        if release.mainfile.is_empty() {
            return Err(format!(
                "release {} has no download URL",
                release.modversion
            ));
        }

        let filename = safe_filename(&release.filename);
        let dest = mods_dir.join(&filename);
        self.update(job.id, |j| {
            j.version = Some(release.modversion.clone());
            j.progress = 0;
        });
        download_to(state, self, job.id, &release.mainfile, &dest).await?;

        if job.action == "update" {
            if let Some(old) = job.file.as_deref() {
                let old = safe_filename(old);
                if old != filename {
                    let _ = std::fs::remove_file(mods_dir.join(old));
                }
            }
        }

        // Queue missing dependencies of the freshly installed zip.
        let zip_path = dest.clone();
        let dependencies = tokio::task::spawn_blocking(move || read_zip_dependencies(&zip_path))
            .await
            .map_err(|e| format!("dependency scan failed: {e}"))?;
        self.queue_dependencies(state, &dependencies).await;
        Ok(())
    }

    /// Enqueue installs for dependencies that are neither installed nor queued.
    async fn queue_dependencies(
        &self,
        state: &SharedState,
        dependencies: &HashMap<String, String>,
    ) {
        if dependencies.is_empty() {
            return;
        }
        let layout = state.layout.clone();
        let scan =
            tokio::task::spawn_blocking(move || scan_mods(&layout.server_dir().join(MODS_DIR)))
                .await
                .unwrap_or(ModScan {
                    mods: Vec::new(),
                    errors: Vec::new(),
                });
        let installed: HashSet<String> = scan
            .mods
            .iter()
            .map(|module| module.modid.to_lowercase())
            .collect();

        for (modid, constraint) in dependencies {
            let id = modid.trim();
            let lower = id.to_lowercase();
            if id.is_empty() || lower == "game" || installed.contains(&lower) {
                continue;
            }
            if self.has_pending(id) {
                continue;
            }
            let job_id = self.enqueue(NewJob {
                action: "install".into(),
                modid: id.to_string(),
                name: id.to_string(),
                version: None,
                file: None,
                constraint: Some(constraint.clone()),
                dependency: true,
            });
            state
                .supervisor
                .console
                .push(format!("[manager] queued dependency {id} (job {job_id})"));
        }
    }
}

impl Default for ModsManager {
    fn default() -> Self {
        Self::new()
    }
}

fn prune_jobs(jobs: &mut Vec<ModJob>) {
    let finished = |job: &ModJob| job.status == "done" || job.status == "error";
    if jobs.len() <= MAX_JOBS {
        return;
    }
    let mut remaining = MAX_JOBS;
    jobs.retain(|job| {
        if !finished(job) {
            return true;
        }
        if remaining > 0 {
            remaining -= 1;
            true
        } else {
            false
        }
    });
}

// ── download ────────────────────────────────────────────────────────────────

async fn download_to(
    state: &SharedState,
    manager: &ModsManager,
    job_id: u64,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let response = state
        .versions
        .client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    manager.update(job_id, |job| job.total = total);

    let part = dest.with_extension("zip.part");
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| format!("cannot create {}: {e}", part.display()))?;
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
            manager.update(job_id, |job| job.progress = downloaded);
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    drop(file);
    manager.update(job_id, |job| job.progress = downloaded);
    tokio::fs::rename(&part, dest)
        .await
        .map_err(|e| format!("cannot move into place: {e}"))?;
    Ok(())
}

/// Reduce a ModDB filename to a single safe component.
fn safe_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("mod.zip");
    let cleaned: String = base
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ()[]".contains(*c))
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() || !cleaned.to_lowercase().ends_with(".zip") {
        format!("mod-{}.zip", now_unix())
    } else {
        cleaned
    }
}

// ── backups ─────────────────────────────────────────────────────────────────

/// Zip the current `Mods` directory into `backups/`, pruning old backups.
pub fn create_mods_backup(layout: &Layout, retention: usize) -> Result<String, String> {
    let mods_dir = layout.server_dir().join(MODS_DIR);
    std::fs::create_dir_all(&mods_dir).map_err(|e| format!("cannot create Mods dir: {e}"))?;
    std::fs::create_dir_all(layout.backups_dir())
        .map_err(|e| format!("cannot create backups dir: {e}"))?;

    let name = format!("mods-{}.zip", timestamp_label());
    let path = layout.backups_dir().join(&name);
    let file = std::fs::File::create(&path).map_err(|e| format!("cannot create backup: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let entries = std::fs::read_dir(&mods_dir).map_err(|e| format!("cannot read Mods: {e}"))?;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        zip.start_file(file_name, options)
            .map_err(|e| format!("cannot add to backup: {e}"))?;
        let mut source =
            std::fs::File::open(&entry_path).map_err(|e| format!("cannot open mod: {e}"))?;
        std::io::copy(&mut source, &mut zip).map_err(|e| format!("cannot copy mod: {e}"))?;
    }
    zip.finish()
        .map_err(|e| format!("cannot finish backup: {e}"))?;

    prune_backups(layout, retention);
    Ok(name)
}

fn prune_backups(layout: &Layout, retention: usize) {
    let dir = layout.backups_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut backups: Vec<String> = entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            name.starts_with("mods-") && name.ends_with(".zip")
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    backups.sort();
    while backups.len() > retention {
        let oldest = backups.remove(0);
        let _ = std::fs::remove_file(dir.join(oldest));
    }
}

pub(crate) fn timestamp_label() -> String {
    let secs = now_unix() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rem / 3600,
        (rem / 60) % 60,
        rem % 60
    )
}

/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(version: &str) -> Release {
        Release {
            mainfile: format!("https://example.invalid/{version}.zip"),
            filename: format!("mod_{version}.zip"),
            modversion: version.to_string(),
            fileid: 0,
        }
    }

    #[test]
    fn picks_exact_version() {
        let releases = vec![release("1.0.0"), release("1.2.0"), release("2.0.0")];
        assert_eq!(
            pick_release(&releases, Some("1.2.0"), None)
                .unwrap()
                .modversion,
            "1.2.0"
        );
        assert!(pick_release(&releases, Some("9.9.9"), None).is_none());
    }

    #[test]
    fn picks_newest_satisfying_constraint() {
        let releases = vec![release("1.0.0"), release("1.4.0"), release("2.0.0")];
        assert_eq!(
            pick_release(&releases, None, Some("1.2.0"))
                .unwrap()
                .modversion,
            "2.0.0"
        );
        assert_eq!(
            pick_release(&releases, None, Some("1.5.0"))
                .unwrap()
                .modversion,
            "2.0.0"
        );
        assert_eq!(
            pick_release(&releases, None, Some("")).unwrap().modversion,
            "2.0.0"
        );
    }

    #[test]
    fn falls_back_to_newest_when_constraint_unmatched() {
        let releases = vec![release("1.0.0"), release("1.1.0")];
        assert_eq!(
            pick_release(&releases, None, Some("3.0.0"))
                .unwrap()
                .modversion,
            "1.1.0"
        );
    }

    #[test]
    fn sanitizes_filenames() {
        assert_eq!(safe_filename("../../evil.zip"), "evil.zip");
        assert_eq!(safe_filename("nice mod 1.0.zip"), "nice mod 1.0.zip");
        assert!(safe_filename("x").ends_with(".zip"));
    }

    #[test]
    fn formats_backup_timestamps() {
        // 2026-10-05 12:34:56 UTC
        let label = {
            let secs: i64 = 1_791_203_696;
            let days = secs.div_euclid(86_400);
            let rem = secs.rem_euclid(86_400);
            let (y, m, d) = civil_from_days(days);
            format!(
                "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
                rem / 3600,
                (rem / 60) % 60,
                rem % 60
            )
        };
        assert_eq!(label, "20261005-123456");
    }
}
