use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::console::now_unix;
use crate::paths::Layout;

const SESSION_TTL_SECS: u64 = 60 * 60 * 24 * 30; // 30 days
const ATTEMPT_WINDOW: Duration = Duration::from_secs(60);
const MAX_ATTEMPTS_PER_WINDOW: usize = 10;
const MIN_PASSWORD_LEN: usize = 8;
const MAX_USER_NAME: usize = 32;

/// Web UI roles, from most to least privilege.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Everything, including user management.
    Owner,
    /// Everything except user management.
    Operator,
    /// Read-only: no mutating requests.
    Viewer,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Operator => "operator",
            Role::Viewer => "viewer",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "owner" => Some(Role::Owner),
            "operator" => Some(Role::Operator),
            "viewer" => Some(Role::Viewer),
            _ => None,
        }
    }

    pub fn is_owner(self) -> bool {
        self == Role::Owner
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub password_hash: String,
    pub created: u64,
}

/// API shape for a user (never exposes the hash).
#[derive(Serialize)]
pub struct UserView {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub created: u64,
}

/// Who performed an action, for the audit log.
#[derive(Clone, Debug)]
pub struct Actor {
    pub name: String,
    /// `None` for unauthenticated attempts (e.g. failed logins).
    pub role: Option<Role>,
    /// `session`, `token`, `system` or `none`.
    pub kind: &'static str,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub csrf: String,
    pub expires: u64,
    /// Name of the signed-in user; empty for sessions migrated from the old
    /// single-password setup (resolved to the owner on load).
    #[serde(default)]
    pub user: String,
}

/// Legacy single-password file, migrated to a user on first start.
#[derive(Default, Serialize, Deserialize)]
struct PasswordFile {
    password_hash: String,
}

#[derive(Default, Serialize, Deserialize)]
struct UsersFile {
    users: Vec<User>,
}

#[derive(Default, Serialize, Deserialize)]
struct SessionsFile {
    sessions: HashMap<String, Session>,
}

/// Bearer token for automation. Only the SHA-256 hash is persisted.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApiToken {
    pub id: String,
    pub label: String,
    pub hash: String,
    pub created: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
}

/// API shape for a token (never exposes the hash).
#[derive(Serialize)]
pub struct ApiTokenView {
    pub id: String,
    pub label: String,
    pub created: u64,
    pub last_used: Option<u64>,
}

#[derive(Default, Serialize, Deserialize)]
struct TokensFile {
    tokens: Vec<ApiToken>,
}

struct Inner {
    users: Vec<User>,
    sessions: HashMap<String, Session>,
    attempts: VecDeque<(String, Instant)>,
    tokens: Vec<ApiToken>,
}

/// User + session store. Users and sessions persist across manager restarts.
pub struct AuthStore {
    enabled: bool,
    inner: Arc<Mutex<Inner>>,
    users_path: PathBuf,
    sessions_path: PathBuf,
    tokens_path: PathBuf,
}

pub struct LoginOk {
    pub token: String,
    pub csrf: String,
    pub user: String,
    pub role: Role,
}

impl AuthStore {
    /// Returns the store and, when a password was generated because none was configured,
    /// the plaintext so the caller can log it exactly once.
    pub fn new(layout: &Layout, enabled: bool) -> (Self, Option<String>) {
        let auth_path = layout.auth_path();
        let users_path = layout.users_path();
        let sessions_path = layout.sessions_path();
        let tokens_path = layout.tokens_path();

        let mut inner = Inner {
            users: std::fs::read_to_string(&users_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<UsersFile>(&raw).ok())
                .map(|file| file.users)
                .unwrap_or_default(),
            sessions: std::fs::read_to_string(&sessions_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<SessionsFile>(&raw).ok())
                .map(|f| f.sessions)
                .unwrap_or_default(),
            attempts: VecDeque::new(),
            tokens: std::fs::read_to_string(&tokens_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<TokensFile>(&raw).ok())
                .map(|f| f.tokens)
                .unwrap_or_default(),
        };
        inner.sessions.retain(|_, s| s.expires > now_unix());

        let mut generated = None;
        if enabled {
            // Migrate the legacy single-password file into an owner account.
            if inner.users.is_empty() && migrate_legacy_password(&mut inner, &auth_path) {
                let _ = std::fs::rename(&auth_path, auth_path.with_extension("json.migrated"));
                tracing::info!("migrated the web UI password into the owner account");
            }
            if inner.users.is_empty() {
                let plaintext = match std::env::var("VS_WEB_PASSWORD") {
                    Ok(pw) if !pw.is_empty() => pw,
                    _ => {
                        let pw = random_password();
                        generated = Some(pw.clone());
                        pw
                    }
                };
                let name = std::env::var("VS_WEB_USERNAME")
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| "admin".into());
                inner.users.push(User {
                    id: random_token(9),
                    name,
                    role: Role::Owner,
                    password_hash: hash_password(&plaintext),
                    created: now_unix(),
                });
            }
        }
        // Sessions from the legacy setup belong to the (first) owner.
        let owner = inner
            .users
            .iter()
            .find(|user| user.role.is_owner())
            .map(|user| user.name.clone());
        if let Some(owner) = owner {
            for session in inner.sessions.values_mut() {
                if session.user.is_empty() {
                    session.user = owner.clone();
                }
            }
        }

        let store = Self {
            enabled,
            inner: Arc::new(Mutex::new(inner)),
            users_path,
            sessions_path,
            tokens_path,
        };
        store.persist_users();
        store.persist_sessions();
        (store, generated)
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn login(&self, username: &str, password: &str, ip: &str) -> Result<LoginOk, &'static str> {
        let mut inner = self.inner.lock().unwrap();

        let now = Instant::now();
        inner
            .attempts
            .retain(|(_, at)| now.duration_since(*at) < ATTEMPT_WINDOW);
        let recent = inner.attempts.iter().filter(|(addr, _)| addr == ip).count();
        if recent >= MAX_ATTEMPTS_PER_WINDOW {
            return Err("too_many_attempts");
        }

        // An empty username resolves when exactly one account exists; this
        // keeps password-only setups working after the multi-user upgrade.
        let username = username.trim();
        let candidate = if username.is_empty() && inner.users.len() == 1 {
            inner.users.first()
        } else {
            inner
                .users
                .iter()
                .find(|user| user.name.eq_ignore_ascii_case(username))
        };
        let Some(user) = candidate.cloned() else {
            inner.attempts.push_back((ip.to_string(), now));
            return Err("invalid_credentials");
        };

        let parsed = PasswordHash::new(&user.password_hash).map_err(|_| "internal_error")?;
        if Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_err()
        {
            inner.attempts.push_back((ip.to_string(), now));
            return Err("invalid_credentials");
        }

        inner.attempts.clear();
        let token = random_token(32);
        let session = Session {
            csrf: random_token(24),
            expires: now_unix() + SESSION_TTL_SECS,
            user: user.name.clone(),
        };
        inner.sessions.insert(token.clone(), session.clone());
        drop(inner);
        self.persist_sessions();
        Ok(LoginOk {
            token,
            csrf: session.csrf,
            user: user.name,
            role: user.role,
        })
    }

    pub fn session(&self, token: &str) -> Option<Session> {
        let mut inner = self.inner.lock().unwrap();
        let expired = {
            let session = inner.sessions.get(token)?;
            session.expires <= now_unix()
        };
        if expired {
            inner.sessions.remove(token);
            return None;
        }
        inner.sessions.get(token).cloned()
    }

    /// Role of the user a session belongs to; `None` when the account is gone.
    pub fn role_of(&self, user: &str) -> Option<Role> {
        self.inner
            .lock()
            .unwrap()
            .users
            .iter()
            .find(|candidate| candidate.name == user)
            .map(|user| user.role)
    }

    pub fn logout(&self, token: &str) {
        self.inner.lock().unwrap().sessions.remove(token);
        self.persist_sessions();
    }

    // ── users ───────────────────────────────────────────────────────────────

    pub fn users(&self) -> Vec<UserView> {
        let mut users: Vec<UserView> = self
            .inner
            .lock()
            .unwrap()
            .users
            .iter()
            .map(|user| UserView {
                id: user.id.clone(),
                name: user.name.clone(),
                role: user.role,
                created: user.created,
            })
            .collect();
        users.sort_by(|a, b| a.created.cmp(&b.created));
        users
    }

    pub fn create_user(&self, name: &str, password: &str, role: Role) -> Result<UserView, String> {
        let name = validate_user_name(name)?;
        if password.chars().count() < MIN_PASSWORD_LEN {
            return Err(format!(
                "Password must be at least {MIN_PASSWORD_LEN} characters."
            ));
        }
        let mut inner = self.inner.lock().unwrap();
        if inner
            .users
            .iter()
            .any(|user| user.name.eq_ignore_ascii_case(&name))
        {
            return Err(format!("A user named {name} already exists."));
        }
        let user = User {
            id: random_token(9),
            name,
            role,
            password_hash: hash_password(password),
            created: now_unix(),
        };
        let view = UserView {
            id: user.id.clone(),
            name: user.name.clone(),
            role: user.role,
            created: user.created,
        };
        inner.users.push(user);
        drop(inner);
        self.persist_users();
        Ok(view)
    }

    /// Updates role and/or password of a user. Refuses to demote the last owner.
    pub fn update_user(
        &self,
        id: &str,
        role: Option<Role>,
        password: Option<&str>,
    ) -> Result<UserView, String> {
        if let Some(password) = password {
            if password.chars().count() < MIN_PASSWORD_LEN {
                return Err(format!(
                    "Password must be at least {MIN_PASSWORD_LEN} characters."
                ));
            }
        }
        let mut inner = self.inner.lock().unwrap();
        let owners = inner
            .users
            .iter()
            .filter(|user| user.role.is_owner())
            .count();
        let user = inner
            .users
            .iter_mut()
            .find(|user| user.id == id)
            .ok_or("unknown user")?;
        if let Some(role) = role {
            if user.role.is_owner() && !role.is_owner() && owners <= 1 {
                return Err("The last owner cannot be demoted.".into());
            }
            user.role = role;
        }
        if let Some(password) = password {
            user.password_hash = hash_password(password);
        }
        let view = UserView {
            id: user.id.clone(),
            name: user.name.clone(),
            role: user.role,
            created: user.created,
        };
        drop(inner);
        self.persist_users();
        Ok(view)
    }

    /// Removes a user and all of their sessions. `acting` is the current user.
    pub fn delete_user(&self, id: &str, acting: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        let owners = inner
            .users
            .iter()
            .filter(|user| user.role.is_owner())
            .count();
        let user = inner
            .users
            .iter()
            .find(|user| user.id == id)
            .ok_or("unknown user")?;
        if user.name == acting {
            return Err("You cannot delete your own account.".into());
        }
        if user.role.is_owner() && owners <= 1 {
            return Err("The last owner cannot be deleted.".into());
        }
        let name = user.name.clone();
        inner.users.retain(|user| user.id != id);
        inner.sessions.retain(|_, session| session.user != name);
        drop(inner);
        self.persist_users();
        self.persist_sessions();
        Ok(())
    }

    /// Changes a user's own password. `keep_token` stays signed in.
    pub fn change_password(
        &self,
        user: &str,
        current: Option<&str>,
        new: &str,
        keep_token: Option<&str>,
    ) -> Result<(), String> {
        if new.chars().count() < MIN_PASSWORD_LEN {
            return Err(format!(
                "Password must be at least {MIN_PASSWORD_LEN} characters."
            ));
        }
        {
            let inner = self.inner.lock().unwrap();
            let account = inner
                .users
                .iter()
                .find(|candidate| candidate.name == user)
                .ok_or("unknown user")?;
            if self.enabled {
                let parsed = PasswordHash::new(&account.password_hash)
                    .map_err(|e| format!("internal error: {e}"))?;
                let current = current.unwrap_or_default();
                Argon2::default()
                    .verify_password(current.as_bytes(), &parsed)
                    .map_err(|_| "Current password is incorrect.".to_string())?;
            }
        }
        let mut inner = self.inner.lock().unwrap();
        if let Some(account) = inner.users.iter_mut().find(|candidate| candidate.name == user) {
            account.password_hash = hash_password(new);
        }
        inner
            .sessions
            .retain(|token, session| session.user != user || Some(token.as_str()) == keep_token);
        drop(inner);
        self.persist_users();
        self.persist_sessions();
        Ok(())
    }

    // ── API tokens ──────────────────────────────────────────────────────────

    /// Creates a token and returns it together with the one-time plaintext.
    pub fn create_token(&self, label: &str) -> (ApiToken, String) {
        let plaintext = format!("vsw_{}", random_token(32));
        let token = ApiToken {
            id: random_token(9),
            label: label.trim().to_string(),
            hash: hash_token(&plaintext),
            created: now_unix(),
            last_used: None,
        };
        let mut inner = self.inner.lock().unwrap();
        inner.tokens.push(token.clone());
        drop(inner);
        self.persist_tokens();
        (token, plaintext)
    }

    pub fn tokens(&self) -> Vec<ApiTokenView> {
        let mut tokens: Vec<ApiTokenView> = self
            .inner
            .lock()
            .unwrap()
            .tokens
            .iter()
            .map(|token| ApiTokenView {
                id: token.id.clone(),
                label: token.label.clone(),
                created: token.created,
                last_used: token.last_used,
            })
            .collect();
        tokens.sort_by(|a, b| b.created.cmp(&a.created));
        tokens
    }

    pub fn revoke_token(&self, id: &str) -> bool {
        let removed = {
            let mut inner = self.inner.lock().unwrap();
            let before = inner.tokens.len();
            inner.tokens.retain(|token| token.id != id);
            inner.tokens.len() != before
        };
        if removed {
            self.persist_tokens();
        }
        removed
    }

    /// Verifies a bearer token, records its last use and returns its label.
    pub fn verify_token(&self, plaintext: &str) -> Option<String> {
        let hash = hash_token(plaintext);
        let label = {
            let mut inner = self.inner.lock().unwrap();
            let now = now_unix();
            let mut label = None;
            for token in inner.tokens.iter_mut() {
                if token.hash == hash {
                    token.last_used = Some(now);
                    label = Some(token.label.clone());
                    break;
                }
            }
            label
        };
        if label.is_some() {
            self.persist_tokens();
        }
        label
    }

    fn persist_users(&self) {
        let inner = self.inner.lock().unwrap();
        let file = UsersFile {
            users: inner.users.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec_pretty(&file) {
            let tmp = self.users_path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &self.users_path);
            }
        }
    }

    fn persist_sessions(&self) {
        let inner = self.inner.lock().unwrap();
        let file = SessionsFile {
            sessions: inner.sessions.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec(&file) {
            let tmp = self.sessions_path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &self.sessions_path);
            }
        }
    }

    fn persist_tokens(&self) {
        let inner = self.inner.lock().unwrap();
        let file = TokensFile {
            tokens: inner.tokens.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec_pretty(&file) {
            let tmp = self.tokens_path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &self.tokens_path);
            }
        }
    }
}

fn validate_user_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.chars().count() < 2 || name.chars().count() > MAX_USER_NAME {
        return Err(format!(
            "User name must be 2 to {MAX_USER_NAME} characters."
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err("User name may only contain letters, digits, '.', '_' and '-'.".into());
    }
    Ok(name.to_string())
}

fn migrate_legacy_password(inner: &mut Inner, auth_path: &Path) -> bool {
    let Some(hash) = std::fs::read_to_string(auth_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<PasswordFile>(&raw).ok())
        .map(|file| file.password_hash)
        .filter(|hash| !hash.is_empty())
    else {
        return false;
    };
    let name = std::env::var("VS_WEB_USERNAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "admin".into());
    inner.users.push(User {
        id: random_token(9),
        name,
        role: Role::Owner,
        password_hash: hash,
        created: now_unix(),
    });
    true
}

fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .unwrap_or_default()
}

fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store(tag: &str) -> (Layout, AuthStore) {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-auth-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        let (store, _) = AuthStore::new(&layout, true);
        (layout, store)
    }

    #[test]
    fn api_tokens_roundtrip() {
        let (dir, store) = test_store("tokens");

        let (token, plaintext) = store.create_token("monitoring");
        assert!(plaintext.starts_with("vsw_"));
        assert_eq!(store.verify_token(&plaintext).as_deref(), Some("monitoring"));
        assert!(store.verify_token("vsw_bogus").is_none());

        let listed = store.tokens();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].label, "monitoring");
        assert!(listed[0].last_used.is_some());

        assert!(store.revoke_token(&token.id));
        assert!(store.verify_token(&plaintext).is_none());
        assert!(store.tokens().is_empty());
        let _ = std::fs::remove_dir_all(&dir.root);
    }

    #[test]
    fn creates_one_owner_by_default_and_logs_in() {
        let (dir, store) = test_store("owner");
        let users = store.users();
        assert_eq!(users.len(), 1);
        assert!(users[0].role.is_owner());

        // Unknown username is rejected.
        assert!(store.login("nobody", "whatever-123", "10.0.0.1").is_err());
        let _ = std::fs::remove_dir_all(&dir.root);
    }

    #[test]
    fn generated_password_logs_in_owner() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-auth-generated-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::env::remove_var("VS_WEB_PASSWORD");
        std::env::remove_var("VS_WEB_USERNAME");
        let (store, generated) = AuthStore::new(&layout, true);
        let password = generated.expect("a password should be generated");
        let login = store.login("admin", &password, "10.0.0.9").unwrap();
        assert_eq!(login.user, "admin");
        assert_eq!(login.role, Role::Owner);
        assert!(store.login("admin", "wrong-password", "10.0.0.9").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn users_roles_and_last_owner_guards() {
        let (dir, store) = test_store("users");
        let owner = store.users().remove(0);

        let op = store
            .create_user("mod", "operator-pass", Role::Operator)
            .unwrap();
        let viewer = store
            .create_user("looker", "viewer-pass", Role::Viewer)
            .unwrap();
        assert_eq!(store.users().len(), 3);
        assert!(store.create_user("mod", "whatever-123", Role::Viewer).is_err());

        // The only owner cannot be demoted or deleted.
        assert!(store.update_user(&owner.id, Some(Role::Viewer), None).is_err());
        assert!(store.delete_user(&owner.id, "mod").is_err());
        // Users cannot delete themselves.
        assert!(store.delete_user(&op.id, "mod").is_err());

        // Promote, delete the promoted owner, then the original can go.
        store.update_user(&viewer.id, Some(Role::Owner), None).unwrap();
        store.delete_user(&viewer.id, "admin").unwrap();
        assert_eq!(store.users().len(), 2);
        let _ = std::fs::remove_dir_all(&dir.root);
    }

    #[test]
    fn role_changes_apply_to_live_sessions() {
        let (dir, store) = test_store("roles");
        let admin = store.users().remove(0);
        let viewer = store
            .create_user("looker", "viewer-pass", Role::Viewer)
            .unwrap();

        assert_eq!(store.role_of("looker"), Some(Role::Viewer));
        store.update_user(&viewer.id, Some(Role::Operator), None).unwrap();
        assert_eq!(store.role_of("looker"), Some(Role::Operator));

        store.change_password("looker", Some("viewer-pass"), "brand-new-pass", None)
            .unwrap();
        assert!(store
            .login("looker", "viewer-pass", "10.0.0.2")
            .is_err());
        assert!(store.login("looker", "brand-new-pass", "10.0.0.2").is_ok());

        store.delete_user(&viewer.id, "admin").unwrap();
        assert_eq!(store.role_of("looker"), None);
        let _ = std::fs::remove_dir_all(&dir.root);
        let _ = admin;
    }

    #[test]
    fn migrates_legacy_password_file() {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-auth-migrate-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(layout.config_dir()).unwrap();
        std::fs::write(
            layout.auth_path(),
            serde_json::json!({ "password_hash": hash_password("legacy-pass") }).to_string(),
        )
        .unwrap();

        let (store, generated) = AuthStore::new(&layout, true);
        assert!(generated.is_none());
        let users = store.users();
        assert_eq!(users.len(), 1);
        assert!(users[0].role.is_owner());
        // Password still works (username resolves when there is one account).
        let login = store.login("admin", "legacy-pass", "10.0.0.3").unwrap();
        assert_eq!(login.user, users[0].name);
        assert!(store.login("admin", "wrong-pass", "10.0.0.3").is_err());
        assert!(!layout.auth_path().exists(), "legacy file is retired");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn random_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| ALPHABET[(rng.next_u32() as usize) % ALPHABET.len()] as char)
        .collect()
}
