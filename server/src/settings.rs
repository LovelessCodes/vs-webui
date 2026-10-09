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

fn is_true(v: &bool) -> bool {
    *v
}

fn default_true() -> bool {
    true
}

fn default_tps_min() -> f32 {
    15.0
}

fn is_default_tps_min(value: &f32) -> bool {
    *value == default_tps_min()
}

fn default_disk_percent() -> u32 {
    10
}

fn is_default_disk_percent(value: &u32) -> bool {
    *value == default_disk_percent()
}

/// One scheduled action: restart, server backup or console command.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// `restart`, `backup` or `command`.
    pub kind: String,
    /// Console command for `command` tasks (sent to the running server).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Local `HH:MM` times; a task may run several times a day.
    pub times: Vec<String>,
    /// ISO weekday numbers, 1 = Monday … 7 = Sunday; empty means every day.
    #[serde(default)]
    pub weekdays: Vec<u32>,
    /// Restart tasks: take a server backup right before restarting.
    #[serde(default, skip_serializing_if = "is_false")]
    pub backup_before: bool,
    /// One-off task: only fires on this date (`YYYY-MM-DD`) and is disabled
    /// after it ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

impl ScheduledTask {
    pub fn restart(times: Vec<String>, backup_before: bool) -> Self {
        Self {
            id: new_task_id(),
            enabled: true,
            kind: "restart".into(),
            command: None,
            times,
            weekdays: Vec::new(),
            backup_before,
            date: None,
            label: None,
        }
    }

    pub fn backup(times: Vec<String>) -> Self {
        Self {
            id: new_task_id(),
            enabled: true,
            kind: "backup".into(),
            command: None,
            times,
            weekdays: Vec::new(),
            backup_before: false,
            date: None,
            label: None,
        }
    }
}

/// Validates and normalizes one task from the settings API. `id` is assigned
/// when empty.
pub fn validate_task(task: &mut ScheduledTask) -> Result<(), String> {
    if task.id.trim().is_empty() {
        task.id = new_task_id();
    }
    if !matches!(task.kind.as_str(), "restart" | "backup" | "command") {
        return Err("task kind must be restart, backup or command".into());
    }
    if task.kind == "command" {
        let command = task.command.as_deref().map(str::trim).unwrap_or_default();
        if command.is_empty() {
            return Err("command tasks need a command".into());
        }
        if command.chars().count() > 256 {
            return Err("command is too long (max 256 characters)".into());
        }
        task.command = Some(command.to_string());
    } else {
        task.command = None;
    }
    if task.times.is_empty() || task.times.len() > 24 {
        return Err("tasks need between 1 and 24 times".into());
    }
    for time in &mut task.times {
        *time = time.trim().to_string();
        if parse_hhmm(time).is_none() {
            return Err(format!("invalid time: {time} (use HH:MM)"));
        }
    }
    task.times.sort();
    task.times.dedup();
    task.weekdays.retain(|day| (1..=7).contains(day));
    task.weekdays.sort_unstable();
    task.weekdays.dedup();
    if let Some(date) = task.date.as_deref() {
        let date = date.trim();
        if date.is_empty() {
            task.date = None;
        } else if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err(format!("invalid date: {date} (use YYYY-MM-DD)"));
        } else {
            task.date = Some(date.to_string());
        }
    }
    if let Some(label) = task.label.as_deref() {
        let label = label.trim();
        if label.chars().count() > 64 {
            return Err("task label is too long (max 64 characters)".into());
        }
        task.label = (!label.is_empty()).then(|| label.to_string());
    }
    Ok(())
}

pub fn new_task_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 6];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!(
        "task-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

/// Validates an IANA timezone name; empty clears it.
pub fn validate_timezone(value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    value
        .parse::<chrono_tz::Tz>()
        .map(|_| Some(value.to_string()))
        .map_err(|_| format!("unknown timezone: {value} (use an IANA name like Europe/Berlin)"))
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
    /// Legacy: migrated into `tasks` on load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_schedule: Option<String>,
    /// Daily backup time as local `HH:MM`; `None` disables scheduled backups.
    /// Legacy: migrated into `tasks` on load.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_schedule: Option<String>,
    /// Create a server backup right before a scheduled restart.
    /// Legacy: migrated into `tasks` on load.
    #[serde(default, skip_serializing_if = "is_false")]
    pub backup_before_restart: bool,
    /// Scheduled restart/backup/command tasks (cron-like).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tasks: Vec<ScheduledTask>,
    /// IANA timezone for all schedules; `None` uses the container's local time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    /// Webhook URL notified on `webhook_events` (Discord, Slack or generic JSON).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    /// Event names the webhook fires for: start, stop, crash, player_join,
    /// player_leave, backup.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub webhook_events: Vec<String>,
    /// Send `/stats` every minute to collect tick rate for the metrics charts.
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub collect_tps: bool,
    /// Guest view: unauthenticated visitors get a read-only dashboard.
    #[serde(default, skip_serializing_if = "is_false")]
    pub public_view: bool,
    /// Sections the guest view exposes (validated names).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub public_sections: Vec<String>,
    /// How many backups of each kind to keep.
    #[serde(default = "default_retention")]
    pub backup_retention: u32,
    /// Optional cap on the total size of all backups, in MB (0/None = no cap).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_max_mb: Option<u32>,
    /// Alert (in-app + webhook) when the tick rate stays below `alert_tps_min`.
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub alert_tps: bool,
    #[serde(default = "default_tps_min", skip_serializing_if = "is_default_tps_min")]
    pub alert_tps_min: f32,
    /// Alert when free disk space drops below this percentage.
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub alert_disk: bool,
    #[serde(
        default = "default_disk_percent",
        skip_serializing_if = "is_default_disk_percent"
    )]
    pub alert_disk_percent: u32,
    /// Alert when a scheduled backup fails.
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub alert_backup: bool,
    /// Set when an apply-on-restart change happened while the server was
    /// running; cleared by the supervisor on the next start.
    #[serde(default, skip_serializing_if = "is_false")]
    pub restart_required: bool,
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
            backup_schedule: None,
            backup_before_restart: false,
            tasks: Vec::new(),
            timezone: None,
            webhook_url: None,
            webhook_events: Vec::new(),
            collect_tps: true,
            public_view: false,
            public_sections: Vec::new(),
            backup_retention: default_retention(),
            backup_max_mb: None,
            alert_tps: true,
            alert_tps_min: default_tps_min(),
            alert_disk: true,
            alert_disk_percent: default_disk_percent(),
            alert_backup: true,
            restart_required: false,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        let mut settings: Self = std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        settings.migrate_legacy_schedules();
        settings
    }

    /// One-time migration of the single daily restart/backup times into tasks.
    fn migrate_legacy_schedules(&mut self) {
        if !self.tasks.is_empty() {
            self.restart_schedule = None;
            self.backup_schedule = None;
            self.backup_before_restart = false;
            return;
        }
        if let Some(schedule) = self.restart_schedule.take() {
            if parse_hhmm(&schedule).is_some() {
                self.tasks
                    .push(ScheduledTask::restart(vec![schedule], self.backup_before_restart));
            }
        }
        self.backup_before_restart = false;
        if let Some(schedule) = self.backup_schedule.take() {
            if parse_hhmm(&schedule).is_some() {
                self.tasks.push(ScheduledTask::backup(vec![schedule]));
            }
        }
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).unwrap_or_default())?;
        std::fs::rename(tmp, path)
    }

    /// Total-size cap for backups in bytes; `None` disables it.
    pub fn backup_max_bytes(&self) -> Option<u64> {
        self.backup_max_mb
            .filter(|mb| *mb > 0)
            .map(|mb| u64::from(mb) * 1024 * 1024)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_schedules_into_tasks() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-settings-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(
            &path,
            serde_json::json!({
                "version": "1.22.7",
                "restart_schedule": "04:30",
                "backup_schedule": "05:00",
                "backup_before_restart": true
            })
            .to_string(),
        )
        .unwrap();

        let settings = Settings::load(&path);
        assert_eq!(settings.tasks.len(), 2);
        let restart = settings
            .tasks
            .iter()
            .find(|task| task.kind == "restart")
            .unwrap();
        assert_eq!(restart.times, vec!["04:30"]);
        assert!(restart.backup_before);
        let backup = settings
            .tasks
            .iter()
            .find(|task| task.kind == "backup")
            .unwrap();
        assert_eq!(backup.times, vec!["05:00"]);
        assert!(settings.restart_schedule.is_none());

        // Persisting drops the legacy fields; reloading does not duplicate.
        settings.save(&path).unwrap();
        let json = std::fs::read_to_string(&path).unwrap();
        assert!(!json.contains("restart_schedule"));
        let reloaded = Settings::load(&path);
        assert_eq!(reloaded.tasks.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_scheduled_tasks() {
        let mut task = ScheduledTask::restart(vec!["25:00".into()], false);
        assert!(validate_task(&mut task).is_err());

        let mut task = ScheduledTask::restart(vec![" 04:30 ".into(), "04:30".into()], false);
        validate_task(&mut task).unwrap();
        assert_eq!(task.times, vec!["04:30"]);
        assert!(task.id.starts_with("task-"));

        let mut task = ScheduledTask {
            kind: "command".into(),
            command: None,
            ..ScheduledTask::restart(vec!["04:30".into()], false)
        };
        assert!(validate_task(&mut task).is_err());

        let mut task = ScheduledTask {
            kind: "command".into(),
            command: Some(" /announce hi ".into()),
            ..ScheduledTask::restart(vec!["04:30".into()], false)
        };
        validate_task(&mut task).unwrap();
        assert_eq!(task.command.as_deref(), Some("/announce hi"));

        let mut task = ScheduledTask {
            weekdays: vec![0, 9, 3, 3],
            ..ScheduledTask::restart(vec!["04:30".into()], false)
        };
        validate_task(&mut task).unwrap();
        assert_eq!(task.weekdays, vec![3]);

        let mut task = ScheduledTask {
            date: Some("2026-13-01".into()),
            ..ScheduledTask::restart(vec!["04:30".into()], false)
        };
        assert!(validate_task(&mut task).is_err());

        assert!(validate_timezone("Europe/Berlin").unwrap().is_some());
        assert!(validate_timezone("").unwrap().is_none());
        assert!(validate_timezone("Mars/Olympus").is_err());
    }
}
