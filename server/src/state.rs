use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::audit::AuditStore;
use crate::auth::AuthStore;
use crate::backups::RestoreProgressHandle;
use crate::chat::ChatLog;
use crate::metrics::MetricsStore;
use crate::mods::{ModDbCache, ModsManager};
use crate::notifications::NotificationStore;
use crate::paths::Layout;
use crate::playerhistory::PlayerHistory;
use crate::profiles::ProfilesStore;
use crate::settings::Settings;
use crate::stratum::StratumCache;
use crate::supervisor::Supervisor;
use crate::versions::{InstallStatus, VersionCache};

pub struct AppState {
    pub layout: Layout,
    pub settings: Arc<Mutex<Settings>>,
    pub auth: AuthStore,
    pub audit: AuditStore,
    pub notifications: NotificationStore,
    pub supervisor: Supervisor,
    pub versions: VersionCache,
    pub moddb: ModDbCache,
    pub mods: Arc<ModsManager>,
    pub stratum: StratumCache,
    pub metrics: MetricsStore,
    pub player_history: PlayerHistory,
    pub chat: ChatLog,
    pub profiles: ProfilesStore,
    pub restore: RestoreProgressHandle,
    pub install: Mutex<Option<InstallStatus>>,
    pub started: Instant,
}

pub type SharedState = Arc<AppState>;
