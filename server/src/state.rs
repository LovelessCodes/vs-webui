use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::auth::AuthStore;
use crate::mods::{ModDbCache, ModsManager};
use crate::paths::Layout;
use crate::settings::Settings;
use crate::supervisor::Supervisor;
use crate::versions::{InstallStatus, VersionCache};

pub struct AppState {
    pub layout: Layout,
    pub settings: Arc<Mutex<Settings>>,
    pub auth: AuthStore,
    pub supervisor: Supervisor,
    pub versions: VersionCache,
    pub moddb: ModDbCache,
    pub mods: Arc<ModsManager>,
    pub install: Mutex<Option<InstallStatus>>,
    pub started: Instant,
}

pub type SharedState = Arc<AppState>;
