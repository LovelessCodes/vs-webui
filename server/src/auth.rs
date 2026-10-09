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
    /// Base32 TOTP secret; set as soon as setup starts, enforced once enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp_secret: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub totp_enabled: bool,
    /// SHA-256 hashes of one-time recovery codes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recovery_hashes: Vec<String>,
    /// Last accepted TOTP step, so a code cannot be replayed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp_last_step: Option<u64>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// API shape for a user (never exposes the hash).
#[derive(Serialize)]
pub struct UserView {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub created: u64,
    pub totp_enabled: bool,
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
    /// Stable id for the session-management UI (never the cookie token).
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub created: u64,
    /// Updated (in memory) while the session is used.
    #[serde(default)]
    pub last_seen: u64,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub agent: String,
}

/// API shape for an active session (never exposes the cookie token).
#[derive(Serialize)]
pub struct SessionView {
    pub id: String,
    pub user: String,
    pub created: u64,
    pub last_seen: u64,
    pub ip: String,
    pub agent: String,
    pub current: bool,
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
    /// `full` (acts as operator) or `read` (read-only requests).
    #[serde(default = "default_token_scope")]
    pub scope: String,
}

fn default_token_scope() -> String {
    "full".into()
}

/// API shape for a token (never exposes the hash).
#[derive(Serialize)]
pub struct ApiTokenView {
    pub id: String,
    pub label: String,
    pub created: u64,
    pub last_used: Option<u64>,
    pub scope: String,
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

/// Outcome of a password login; 2FA accounts stop at `TotpRequired` until a
/// valid code is supplied.
pub enum LoginOutcome {
    LoggedIn(LoginOk),
    TotpRequired,
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
        // Sessions from before session management get ids and timestamps.
        let now = now_unix();
        for session in inner.sessions.values_mut() {
            if session.id.is_empty() {
                session.id = random_token(9);
            }
            if session.created == 0 {
                session.created = now;
            }
            if session.last_seen == 0 {
                session.last_seen = session.created;
            }
        }

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
                inner.users.push(new_user(name, Role::Owner, hash_password(&plaintext)));
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

    pub fn login(
        &self,
        username: &str,
        password: &str,
        ip: &str,
        agent: &str,
        code: Option<&str>,
    ) -> Result<LoginOutcome, &'static str> {
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

        // Second factor: the password is already accepted at this point.
        if user.totp_enabled {
            let Some(code) = code.map(str::trim).filter(|code| !code.is_empty()) else {
                return Ok(LoginOutcome::TotpRequired);
            };
            let step = user
                .totp_secret
                .as_deref()
                .and_then(|secret| totp_step(secret, code));
            let step_ok = step.is_some_and(|step| user.totp_last_step.map(|last| step > last).unwrap_or(true));
            let recovery_ok = !step_ok && recovery_matches(&user, code);
            if !step_ok && !recovery_ok {
                inner.attempts.push_back((ip.to_string(), now));
                return Err("invalid_totp");
            }
            if let Some(account) = inner.users.iter_mut().find(|u| u.id == user.id) {
                if let Some(step) = step.filter(|_| step_ok) {
                    account.totp_last_step = Some(step);
                }
                if recovery_ok {
                    let hash = hash_token(&normalize_code(code));
                    account.recovery_hashes.retain(|candidate| *candidate != hash);
                }
            }
        }

        inner.attempts.clear();
        let token = random_token(32);
        let timestamp = now_unix();
        let session = Session {
            csrf: random_token(24),
            expires: timestamp + SESSION_TTL_SECS,
            user: user.name.clone(),
            id: random_token(9),
            created: timestamp,
            last_seen: timestamp,
            ip: ip.to_string(),
            agent: agent.chars().take(200).collect(),
        };
        inner.sessions.insert(token.clone(), session.clone());
        drop(inner);
        self.persist_sessions();
        Ok(LoginOutcome::LoggedIn(LoginOk {
            token,
            csrf: session.csrf,
            user: user.name,
            role: user.role,
        }))
    }

    pub fn session(&self, token: &str) -> Option<Session> {
        let mut inner = self.inner.lock().unwrap();
        let now = now_unix();
        let expired = {
            let session = inner.sessions.get(token)?;
            session.expires <= now
        };
        if expired {
            inner.sessions.remove(token);
            return None;
        }
        let session = inner.sessions.get_mut(token)?;
        if now > session.last_seen + 60 {
            session.last_seen = now;
        }
        Some(session.clone())
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

    // ── session management ──────────────────────────────────────────────────

    /// Sessions visible to the viewer: owners see every session, everyone else
    /// only their own. `current_token` marks the requesting session.
    pub fn sessions(
        &self,
        viewer: &str,
        is_owner: bool,
        current_token: Option<&str>,
    ) -> Vec<SessionView> {
        let inner = self.inner.lock().unwrap();
        let current_id = current_token
            .and_then(|token| inner.sessions.get(token))
            .map(|session| session.id.clone());
        let mut list: Vec<SessionView> = inner
            .sessions
            .values()
            .filter(|session| is_owner || session.user == viewer)
            .map(|session| SessionView {
                id: session.id.clone(),
                user: session.user.clone(),
                created: session.created,
                last_seen: session.last_seen,
                ip: session.ip.clone(),
                agent: session.agent.clone(),
                current: Some(&session.id) == current_id.as_ref(),
            })
            .collect();
        list.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
        list
    }

    /// Revokes one session by id. Non-owners may only revoke their own.
    pub fn revoke_session(&self, id: &str, viewer: &str, is_owner: bool) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        let target = inner
            .sessions
            .iter()
            .find(|(_, session)| session.id == id)
            .map(|(token, session)| (token.clone(), session.user.clone()));
        let Some((token, user)) = target else {
            return Err("unknown session".into());
        };
        if !is_owner && user != viewer {
            return Err("cannot revoke another user's session".into());
        }
        inner.sessions.remove(&token);
        drop(inner);
        self.persist_sessions();
        Ok(())
    }

    /// Revokes every session of `user` except `keep_token`; returns the count.
    pub fn revoke_other_sessions(&self, user: &str, keep_token: Option<&str>) -> usize {
        let mut inner = self.inner.lock().unwrap();
        let before = inner.sessions.len();
        inner
            .sessions
            .retain(|token, session| session.user != user || Some(token.as_str()) == keep_token);
        let removed = before - inner.sessions.len();
        drop(inner);
        self.persist_sessions();
        removed
    }

    // ── two-factor (TOTP) ───────────────────────────────────────────────────

    pub fn totp_enabled(&self, user: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .users
            .iter()
            .find(|candidate| candidate.name == user)
            .map(|user| user.totp_enabled)
            .unwrap_or(false)
    }

    /// Starts TOTP setup: stores a pending secret and returns it with the
    /// `otpauth://` URL. Nothing is enforced until `enable_totp` succeeds.
    pub fn start_totp_setup(&self, user: &str) -> Result<(String, String), String> {
        let secret = totp_rs::Secret::generate_secret();
        let encoded = encode_secret(secret.as_bytes());
        let mut inner = self.inner.lock().unwrap();
        let account = inner
            .users
            .iter_mut()
            .find(|candidate| candidate.name == user)
            .ok_or("unknown user")?;
        account.totp_secret = Some(encoded.clone());
        account.totp_enabled = false;
        drop(inner);
        self.persist_users();
        let url = totp_url(user, &encoded)?;
        Ok((encoded, url))
    }

    /// Confirms setup with a code and returns one-time recovery codes.
    pub fn enable_totp(&self, user: &str, code: &str) -> Result<Vec<String>, String> {
        let mut inner = self.inner.lock().unwrap();
        let account = inner
            .users
            .iter_mut()
            .find(|candidate| candidate.name == user)
            .ok_or("unknown user")?;
        let secret = account
            .totp_secret
            .clone()
            .ok_or("two-factor setup was not started")?;
        if totp_step(&secret, code).is_none() {
            return Err("Invalid two-factor code.".into());
        }
        account.totp_enabled = true;
        account.totp_last_step = None;
        let codes = generate_recovery_codes();
        account.recovery_hashes = codes
            .iter()
            .map(|code| hash_token(&normalize_code(code)))
            .collect();
        drop(inner);
        self.persist_users();
        Ok(codes)
    }

    /// Disables TOTP for a user. `by_owner` skips the code check (lost device
    /// recovery by an owner).
    pub fn disable_totp(
        &self,
        user: &str,
        code: Option<&str>,
        by_owner: bool,
    ) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        let account = inner
            .users
            .iter_mut()
            .find(|candidate| candidate.name == user)
            .ok_or("unknown user")?;
        if account.totp_enabled && !by_owner {
            let code = code.unwrap_or_default();
            let secret_ok = account
                .totp_secret
                .as_deref()
                .is_some_and(|secret| totp_step(secret, code).is_some());
            let recovery_ok = !secret_ok && recovery_matches(account, code);
            if !secret_ok && !recovery_ok {
                return Err("Invalid two-factor code.".into());
            }
        }
        account.totp_enabled = false;
        account.totp_secret = None;
        account.recovery_hashes.clear();
        account.totp_last_step = None;
        drop(inner);
        self.persist_users();
        Ok(())
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
                totp_enabled: user.totp_enabled,
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
        let user = new_user(name, role, hash_password(password));
        let view = UserView {
            id: user.id.clone(),
            name: user.name.clone(),
            role: user.role,
            created: user.created,
            totp_enabled: user.totp_enabled,
        };
        inner.users.push(user);
        drop(inner);
        self.persist_users();
        Ok(view)
    }

    /// Updates role, password and/or two-factor state of a user. Refuses to
    /// demote the last owner.
    pub fn update_user(
        &self,
        id: &str,
        role: Option<Role>,
        password: Option<&str>,
        disable_2fa: bool,
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
        if disable_2fa {
            user.totp_enabled = false;
            user.totp_secret = None;
            user.recovery_hashes.clear();
            user.totp_last_step = None;
        }
        let view = UserView {
            id: user.id.clone(),
            name: user.name.clone(),
            role: user.role,
            created: user.created,
            totp_enabled: user.totp_enabled,
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
    /// `scope` is `full` or `read`.
    pub fn create_token(&self, label: &str, scope: &str) -> (ApiToken, String) {
        let plaintext = format!("vsw_{}", random_token(32));
        let scope = if scope == "read" { "read" } else { "full" };
        let token = ApiToken {
            id: random_token(9),
            label: label.trim().to_string(),
            hash: hash_token(&plaintext),
            created: now_unix(),
            last_used: None,
            scope: scope.to_string(),
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
                scope: token.scope.clone(),
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

    /// Verifies a bearer token, records its last use and returns its label
    /// together with its scope (`full` or `read`).
    pub fn verify_token(&self, plaintext: &str) -> Option<(String, String)> {
        let hash = hash_token(plaintext);
        let found = {
            let mut inner = self.inner.lock().unwrap();
            let now = now_unix();
            let mut found = None;
            for token in inner.tokens.iter_mut() {
                if token.hash == hash {
                    token.last_used = Some(now);
                    found = Some((token.label.clone(), token.scope.clone()));
                    break;
                }
            }
            found
        };
        if found.is_some() {
            self.persist_tokens();
        }
        found
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
    inner.users.push(new_user(name, Role::Owner, hash));
    true
}

fn new_user(name: String, role: Role, password_hash: String) -> User {
    User {
        id: random_token(9),
        name,
        role,
        password_hash,
        created: now_unix(),
        totp_secret: None,
        totp_enabled: false,
        recovery_hashes: Vec::new(),
        totp_last_step: None,
    }
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

// ── TOTP helpers ────────────────────────────────────────────────────────────

/// Builds a `Totp` from our stored secret encoding (base64url of raw bytes).
fn build_totp(secret: &str) -> Option<totp_rs::Totp> {
    let bytes = decode_secret(secret)?;
    totp_rs::Builder::new()
        .with_algorithm(totp_rs::Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_secret(bytes)
        .build()
        .ok()
}

/// Accepts `code` for `secret`; returns the matched TOTP step.
fn totp_step(secret: &str, code: &str) -> Option<u64> {
    build_totp(secret)?.check_current(code.trim())
}

fn totp_url(user: &str, secret: &str) -> Result<String, String> {
    let bytes = decode_secret(secret).ok_or("invalid two-factor secret")?;
    let totp = totp_rs::Builder::new()
        .with_algorithm(totp_rs::Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_secret(bytes)
        .with_account_name(user)
        .with_issuer(Some("vs-webui"))
        .build()
        .map_err(|e| format!("cannot build otpauth URL: {e}"))?;
    totp.to_url()
        .map_err(|e| format!("cannot build otpauth URL: {e}"))
}

fn encode_secret(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_secret(encoded: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .ok()
}

/// Recovery codes are case-insensitive and ignore spaces.
fn normalize_code(code: &str) -> String {
    code.trim().to_lowercase().replace(' ', "")
}

fn recovery_matches(user: &User, code: &str) -> bool {
    let hash = hash_token(&normalize_code(code));
    user.recovery_hashes.iter().any(|candidate| *candidate == hash)
}

fn generate_recovery_codes() -> Vec<String> {
    const ALPHABET: &[u8] = b"abcdefghijkmnopqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let mut code = String::with_capacity(11);
            for index in 0..10 {
                if index == 5 {
                    code.push('-');
                }
                code.push(ALPHABET[(rng.next_u32() as usize) % ALPHABET.len()] as char);
            }
            code
        })
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

    fn login(store: &AuthStore, user: &str, password: &str) -> Result<LoginOk, &'static str> {
        match store.login(user, password, "10.0.0.1", "test-agent", None)? {
            LoginOutcome::LoggedIn(ok) => Ok(ok),
            LoginOutcome::TotpRequired => Err("totp_required"),
        }
    }

    #[test]
    fn api_tokens_roundtrip() {
        let (dir, store) = test_store("tokens");

        let (token, plaintext) = store.create_token("monitoring", "read");
        assert!(plaintext.starts_with("vsw_"));
        assert_eq!(
            store.verify_token(&plaintext),
            Some(("monitoring".to_string(), "read".to_string()))
        );
        assert!(store.verify_token("vsw_bogus").is_none());

        let (full, full_plaintext) = store.create_token("automation", "full");
        assert_eq!(
            store.verify_token(&full_plaintext),
            Some(("automation".to_string(), "full".to_string()))
        );
        // Unknown scopes fall back to full.
        let (_, odd) = store.create_token("odd", "nonsense");
        assert_eq!(
            store.verify_token(&odd).map(|(_, scope)| scope).as_deref(),
            Some("full")
        );

        let listed = store.tokens();
        assert_eq!(listed.len(), 3);
        let odd = listed.iter().find(|token| token.label == "odd").unwrap();
        assert_eq!(odd.scope, "full");
        assert!(odd.last_used.is_some());

        assert!(store.revoke_token(&token.id));
        assert!(store.revoke_token(&full.id));
        assert!(store.verify_token(&plaintext).is_none());
        assert!(store.verify_token(&full_plaintext).is_none());
        let _ = std::fs::remove_dir_all(&dir.root);
    }

    #[test]
    fn creates_one_owner_by_default_and_logs_in() {
        let (dir, store) = test_store("owner");
        let users = store.users();
        assert_eq!(users.len(), 1);
        assert!(users[0].role.is_owner());

        // Unknown username is rejected.
        assert!(login(&store, "nobody", "whatever-123").is_err());
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
        let ok = login(&store, "admin", &password).unwrap();
        assert_eq!(ok.user, "admin");
        assert_eq!(ok.role, Role::Owner);
        assert!(login(&store, "admin", "wrong-password").is_err());
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
        assert!(store
            .update_user(&owner.id, Some(Role::Viewer), None, false)
            .is_err());
        assert!(store.delete_user(&owner.id, "mod").is_err());
        // Users cannot delete themselves.
        assert!(store.delete_user(&op.id, "mod").is_err());

        // Promote, delete the promoted owner, then the original can go.
        store
            .update_user(&viewer.id, Some(Role::Owner), None, false)
            .unwrap();
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
        store
            .update_user(&viewer.id, Some(Role::Operator), None, false)
            .unwrap();
        assert_eq!(store.role_of("looker"), Some(Role::Operator));

        store.change_password("looker", Some("viewer-pass"), "brand-new-pass", None)
            .unwrap();
        assert!(login(&store, "looker", "viewer-pass").is_err());
        assert!(login(&store, "looker", "brand-new-pass").is_ok());

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
        let ok = login(&store, "admin", "legacy-pass").unwrap();
        assert_eq!(ok.user, users[0].name);
        assert!(login(&store, "admin", "wrong-pass").is_err());
        assert!(!layout.auth_path().exists(), "legacy file is retired");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Seeds a users file with a known owner password (avoids env races).
    fn store_with_owner(tag: &str, password: &str) -> (Layout, AuthStore) {
        let dir = std::env::temp_dir().join(format!(
            "vs-webui-auth-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        std::fs::create_dir_all(layout.config_dir()).unwrap();
        std::fs::write(
            layout.users_path(),
            serde_json::json!({
                "users": [{
                    "id": "owner-1",
                    "name": "admin",
                    "role": "owner",
                    "password_hash": hash_password(password),
                    "created": 1
                }]
            })
            .to_string(),
        )
        .unwrap();
        let (store, generated) = AuthStore::new(&layout, true);
        assert!(generated.is_none());
        (layout, store)
    }

    #[test]
    fn session_management_lists_and_revokes() {
        let (dir, store) = store_with_owner("sessions", "owner-pass-123");
        store
            .create_user("mod", "operator-pass", Role::Operator)
            .unwrap();

        let first = login(&store, "admin", "owner-pass-123").unwrap();
        let _second = login(&store, "admin", "owner-pass-123").unwrap();
        let op = login(&store, "mod", "operator-pass").unwrap();

        // Owners see every session; operators only their own.
        let all = store.sessions("admin", true, Some(&first.token));
        assert_eq!(all.len(), 3);
        assert_eq!(all.iter().filter(|s| s.current).count(), 1);
        assert!(all.iter().any(|s| s.agent == "test-agent"));
        let own = store.sessions("mod", false, Some(&op.token));
        assert_eq!(own.len(), 1);

        // Revoking another user's session needs owner rights.
        let second_id = all
            .iter()
            .find(|s| s.user == "admin" && !s.current)
            .map(|s| s.id.clone())
            .unwrap();
        assert!(store.revoke_session(&second_id, "mod", false).is_err());
        assert!(store.revoke_session(&second_id, "admin", true).is_ok());
        assert_eq!(store.sessions("admin", true, None).len(), 2);

        // Revoke-others keeps the current session.
        let _third = login(&store, "admin", "owner-pass-123").unwrap();
        let removed = store.revoke_other_sessions("admin", Some(&first.token));
        assert_eq!(removed, 1);
        let remaining = store.sessions("admin", true, Some(&first.token));
        assert_eq!(remaining.len(), 2); // first admin + operator
        assert!(remaining.iter().any(|s| s.current));
        let _ = std::fs::remove_dir_all(&dir.root);
    }

    #[test]
    fn totp_login_flow() {
        let (dir, store) = store_with_owner("totp", "owner-pass-123");

        // Password login works before 2FA is enabled.
        assert!(matches!(
            store.login("admin", "owner-pass-123", "10.0.0.4", "test", None),
            Ok(LoginOutcome::LoggedIn(_))
        ));

        let (secret, url) = store.start_totp_setup("admin").unwrap();
        assert!(url.starts_with("otpauth://totp/"));
        assert!(!store.totp_enabled("admin"));

        let code = build_totp(&secret).unwrap().generate_current().to_string();
        let recovery = store.enable_totp("admin", &code).unwrap();
        assert_eq!(recovery.len(), 8);
        assert!(store.totp_enabled("admin"));

        // Without a code the password alone stops at TotpRequired.
        assert!(matches!(
            store.login("admin", "owner-pass-123", "10.0.0.4", "test", None),
            Ok(LoginOutcome::TotpRequired)
        ));
        assert!(store
            .login("admin", "owner-pass-123", "10.0.0.4", "test", Some("000000"))
            .is_err());

        // A valid code logs in, but cannot be replayed.
        let code = build_totp(&secret).unwrap().generate_current().to_string();
        assert!(matches!(
            store.login("admin", "owner-pass-123", "10.0.0.4", "test", Some(&code)),
            Ok(LoginOutcome::LoggedIn(_))
        ));
        assert!(store
            .login("admin", "owner-pass-123", "10.0.0.4", "test", Some(&code))
            .is_err());

        // A recovery code works once, then is consumed.
        let recovery_code = recovery[0].clone();
        assert!(matches!(
            store.login(
                "admin",
                "owner-pass-123",
                "10.0.0.4",
                "test",
                Some(&recovery_code)
            ),
            Ok(LoginOutcome::LoggedIn(_))
        ));
        assert!(store
            .login(
                "admin",
                "owner-pass-123",
                "10.0.0.4",
                "test",
                Some(&recovery_code)
            )
            .is_err());

        // Disabling needs a valid code; an owner reset clears everything.
        let code = build_totp(&secret).unwrap().generate_current().to_string();
        store.disable_totp("admin", Some(&code), false).unwrap();
        assert!(!store.totp_enabled("admin"));
        assert!(matches!(
            store.login("admin", "owner-pass-123", "10.0.0.4", "test", None),
            Ok(LoginOutcome::LoggedIn(_))
        ));

        let (secret, _) = store.start_totp_setup("admin").unwrap();
        let code = build_totp(&secret).unwrap().generate_current().to_string();
        store.enable_totp("admin", &code).unwrap();
        let admin_id = store.users()[0].id.clone();
        store
            .update_user(&admin_id, None, None, true)
            .expect("owner reset");
        assert!(!store.totp_enabled("admin"));
        let _ = std::fs::remove_dir_all(&dir.root);
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
