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
use sha2::{Digest, Sha256};

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
    password_hash: Option<String>,
    sessions: HashMap<String, Session>,
    attempts: VecDeque<(String, Instant)>,
    tokens: Vec<ApiToken>,
}

/// Password + session store. Sessions persist across manager restarts.
pub struct AuthStore {
    enabled: bool,
    inner: Arc<Mutex<Inner>>,
    password_path: PathBuf,
    sessions_path: PathBuf,
    tokens_path: PathBuf,
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
        let tokens_path = layout.tokens_path();

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
            tokens: std::fs::read_to_string(&tokens_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<TokensFile>(&raw).ok())
                .map(|f| f.tokens)
                .unwrap_or_default(),
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
            tokens_path,
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

    /// Verifies a bearer token and records its last use.
    pub fn verify_token(&self, plaintext: &str) -> bool {
        let hash = hash_token(plaintext);
        let found = {
            let mut inner = self.inner.lock().unwrap();
            let now = now_unix();
            let mut found = false;
            for token in inner.tokens.iter_mut() {
                if token.hash == hash {
                    token.last_used = Some(now);
                    found = true;
                    break;
                }
            }
            found
        };
        if found {
            self.persist_tokens();
        }
        found
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

    #[test]
    fn api_tokens_roundtrip() {
        let dir = std::env::temp_dir().join(format!("vs-webui-auth-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::new(&dir);
        let (store, _) = AuthStore::new(&layout, true);

        let (token, plaintext) = store.create_token("monitoring");
        assert!(plaintext.starts_with("vsw_"));
        assert!(store.verify_token(&plaintext));
        assert!(!store.verify_token("vsw_bogus"));

        let listed = store.tokens();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].label, "monitoring");
        assert!(listed[0].last_used.is_some());

        assert!(store.revoke_token(&token.id));
        assert!(!store.verify_token(&plaintext));
        assert!(store.tokens().is_empty());
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
