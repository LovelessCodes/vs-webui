use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::console::now_unix;
use crate::paths::Layout;

const SESSION_TTL_SECS: u64 = 60 * 60 * 24 * 30; // 30 days
const ATTEMPT_WINDOW: Duration = Duration::from_secs(60);
const MAX_ATTEMPTS_PER_WINDOW: usize = 10;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub csrf: String,
    pub expires: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct PasswordFile {
    password_hash: String,
}

#[derive(Default, Serialize, Deserialize)]
struct SessionsFile {
    sessions: HashMap<String, Session>,
}

struct Inner {
    password_hash: Option<String>,
    sessions: HashMap<String, Session>,
    attempts: VecDeque<(String, Instant)>,
}

/// Password + session store. Sessions persist across manager restarts.
pub struct AuthStore {
    enabled: bool,
    inner: Arc<Mutex<Inner>>,
    password_path: PathBuf,
    sessions_path: PathBuf,
}

pub struct LoginOk {
    pub token: String,
    pub csrf: String,
}

impl AuthStore {
    /// Returns the store and, when a password was generated because none was configured,
    /// the plaintext so the caller can log it exactly once.
    pub fn new(layout: &Layout, enabled: bool) -> (Self, Option<String>) {
        let password_path = layout.auth_path();
        let sessions_path = layout.sessions_path();

        let mut inner = Inner {
            password_hash: std::fs::read_to_string(&password_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<PasswordFile>(&raw).ok())
                .filter(|f| !f.password_hash.is_empty())
                .map(|f| f.password_hash),
            sessions: std::fs::read_to_string(&sessions_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<SessionsFile>(&raw).ok())
                .map(|f| f.sessions)
                .unwrap_or_default(),
            attempts: VecDeque::new(),
        };
        inner.sessions.retain(|_, s| s.expires > now_unix());

        let mut generated = None;
        if enabled && inner.password_hash.is_none() {
            let plaintext = match std::env::var("VS_WEB_PASSWORD") {
                Ok(pw) if !pw.is_empty() => pw,
                _ => {
                    let pw = random_password();
                    generated = Some(pw.clone());
                    pw
                }
            };
            inner.password_hash = Some(hash_password(&plaintext));
        }

        let store = Self {
            enabled,
            inner: Arc::new(Mutex::new(inner)),
            password_path,
            sessions_path,
        };
        store.persist_password();
        store.persist_sessions();
        (store, generated)
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn login(&self, password: &str, ip: &str) -> Result<LoginOk, &'static str> {
        let mut inner = self.inner.lock().unwrap();

        let now = Instant::now();
        inner
            .attempts
            .retain(|(_, at)| now.duration_since(*at) < ATTEMPT_WINDOW);
        let recent = inner.attempts.iter().filter(|(addr, _)| addr == ip).count();
        if recent >= MAX_ATTEMPTS_PER_WINDOW {
            return Err("too_many_attempts");
        }

        let Some(hash) = inner.password_hash.clone() else {
            return Err("auth_disabled");
        };
        let parsed = PasswordHash::new(&hash).map_err(|_| "internal_error")?;
        if Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_err()
        {
            inner.attempts.push_back((ip.to_string(), now));
            return Err("invalid_password");
        }

        inner.attempts.clear();
        let token = random_token(32);
        let session = Session {
            csrf: random_token(24),
            expires: now_unix() + SESSION_TTL_SECS,
        };
        inner.sessions.insert(token.clone(), session.clone());
        drop(inner);
        self.persist_sessions();
        Ok(LoginOk {
            token,
            csrf: session.csrf,
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

    pub fn logout(&self, token: &str) {
        self.inner.lock().unwrap().sessions.remove(token);
        self.persist_sessions();
    }

    pub fn change_password(&self, current: Option<&str>, new: &str) -> Result<(), String> {
        if new.chars().count() < 8 {
            return Err("Password must be at least 8 characters.".into());
        }
        {
            let inner = self.inner.lock().unwrap();
            if self.enabled {
                let Some(hash) = inner.password_hash.clone() else {
                    return Err("auth is disabled".into());
                };
                let parsed =
                    PasswordHash::new(&hash).map_err(|e| format!("internal error: {e}"))?;
                let current = current.unwrap_or_default();
                Argon2::default()
                    .verify_password(current.as_bytes(), &parsed)
                    .map_err(|_| "Current password is incorrect.".to_string())?;
            }
        }
        let mut inner = self.inner.lock().unwrap();
        inner.password_hash = Some(hash_password(new));
        inner.sessions.clear();
        drop(inner);
        self.persist_password();
        self.persist_sessions();
        Ok(())
    }

    fn persist_password(&self) {
        let inner = self.inner.lock().unwrap();
        if let Some(hash) = inner.password_hash.clone() {
            let file = PasswordFile {
                password_hash: hash,
            };
            if let Ok(bytes) = serde_json::to_vec_pretty(&file) {
                let _ = std::fs::write(&self.password_path, bytes);
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
}

fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .unwrap_or_default()
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
