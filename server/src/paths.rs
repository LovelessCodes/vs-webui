use std::path::{Path, PathBuf};

/// Filesystem layout under the data root (`VS_DATA`, default `/data`).
#[derive(Clone, Debug)]
pub struct Layout {
    pub root: PathBuf,
}

impl Layout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn ensure(&self) -> std::io::Result<()> {
        std::fs::create_dir_all(self.config_dir())?;
        std::fs::create_dir_all(self.vanilla_dir())?;
        std::fs::create_dir_all(self.server_dir())?;
        std::fs::create_dir_all(self.backups_dir())?;
        Ok(())
    }

    pub fn config_dir(&self) -> PathBuf {
        self.root.join("config")
    }

    pub fn vanilla_dir(&self) -> PathBuf {
        self.root.join("runtime").join("vanilla")
    }

    pub fn vanilla_version_dir(&self, version: &str) -> PathBuf {
        self.vanilla_dir().join(version)
    }

    pub fn server_dir(&self) -> PathBuf {
        self.root.join("server")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.root.join("backups")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.config_dir().join("settings.json")
    }

    pub fn auth_path(&self) -> PathBuf {
        self.config_dir().join("auth.json")
    }

    pub fn sessions_path(&self) -> PathBuf {
        self.config_dir().join("sessions.json")
    }

    pub fn server_exe(&self, version: &str) -> PathBuf {
        self.vanilla_version_dir(version).join("VintagestoryServer")
    }
}

/// A directory looks like a usable server build when the apphost (or its dll) is present.
pub fn is_server_install(dir: &Path) -> bool {
    dir.join("VintagestoryServer").exists() || dir.join("VintagestoryServer.dll").exists()
}
