//! Mirrors finished backups to WebDAV or S3-compatible storage.

use std::path::Path;
use std::time::Duration;

use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::settings::OffsiteConfig;
use crate::state::SharedState;

/// Uploads are fire-and-forget; results land in the notification history.
pub fn spawn_upload(state: &SharedState, name: String) {
    let config = { state.settings.lock().unwrap().offsite.clone() };
    let Some(config) = config else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move {
        let path = match crate::backups::backup_path(&state.layout, &name) {
            Ok(path) => path,
            Err(error) => {
                crate::notifications::alert(
                    &state,
                    "offsite_failed",
                    format!("Offsite upload failed: {name}: {error}"),
                );
                return;
            }
        };
        match upload(&config, &path, &name).await {
            Ok(()) => crate::notifications::notify(
                &state,
                "offsite",
                format!("Offsite upload complete: {name}"),
            ),
            Err(error) => crate::notifications::alert(
                &state,
                "offsite_failed",
                format!("Offsite upload failed: {name}: {error}"),
            ),
        }
    });
}

/// Uploads `path` as `name`; used for backups and the connection test.
pub async fn upload(config: &OffsiteConfig, path: &Path, name: &str) -> Result<(), String> {
    match config.kind.as_str() {
        "webdav" => upload_webdav(config, path, name).await,
        "s3" => upload_s3(config, path, name).await,
        other => Err(format!("unknown offsite kind: {other}")),
    }
}

/// Uploads a small marker object so the settings page can verify the target.
pub async fn test(config: &OffsiteConfig) -> Result<(), String> {
    let dir = std::env::temp_dir().join(format!("vs-webui-offsite-{}", std::process::id()));
    std::fs::write(
        &dir,
        format!("vs-webui offsite test {}\n", crate::console::now_unix()),
    )
    .map_err(|e| format!("cannot write test payload: {e}"))?;
    let result = upload(config, &dir, "vs-webui-test.txt").await;
    let _ = std::fs::remove_file(&dir);
    result
}

fn object_name(config: &OffsiteConfig, name: &str) -> String {
    let prefix = config.prefix.trim_matches('/');
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

async fn upload_webdav(config: &OffsiteConfig, path: &Path, name: &str) -> Result<(), String> {
    let base = config.url.trim_end_matches('/');
    let url = format!("{base}/{}", object_name(config, name));
    let client = http_client()?;
    let body = streaming_body(path).await?;
    let mut request = client.put(&url).body(body);
    if !config.user.is_empty() {
        request = request.basic_auth(&config.user, Some(&config.password));
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("endpoint returned HTTP {}", response.status()));
    }
    Ok(())
}

async fn upload_s3(
    config: &OffsiteConfig,
    file_path: &Path,
    name: &str,
) -> Result<(), String> {
    let endpoint = config.url.trim_end_matches('/');
    let parsed =
        reqwest::Url::parse(endpoint).map_err(|e| format!("invalid S3 endpoint: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("S3 endpoint must be http(s)".into());
    }
    let host = match parsed.port() {
        Some(port) => format!("{}:{port}", parsed.host_str().unwrap_or_default()),
        None => parsed.host_str().unwrap_or_default().to_string(),
    };
    let object = object_name(config, name);
    let object_path = format!(
        "/{}/{}",
        uri_encode(&config.bucket, false),
        uri_encode(&object, false)
    );
    let url = format!("{endpoint}{object_path}");

    // Streaming uploads sign with UNSIGNED-PAYLOAD, which S3 and compatible
    // stores accept for plain PUTs.
    let signed = sign_v4(
        "PUT",
        &host,
        &object_path,
        &config.region,
        &config.access_key,
        &config.secret_key,
        "UNSIGNED-PAYLOAD",
    );
    let client = http_client()?;
    let body = streaming_body(file_path).await?;
    let response = client
        .put(&url)
        .header("authorization", signed.authorization)
        .header("x-amz-content-sha256", "UNSIGNED-PAYLOAD")
        .header("x-amz-date", signed.amz_date)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("endpoint returned HTTP {}", response.status()));
    }
    Ok(())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("cannot build client: {e}"))
}

async fn streaming_body(path: &Path) -> Result<reqwest::Body, String> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    Ok(reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::new(
        file,
    )))
}

struct Signed {
    authorization: String,
    amz_date: String,
}

/// Minimal AWS Signature V4 for a single request (path-style S3).
fn sign_v4(
    method: &str,
    host: &str,
    path: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
    payload_hash: &str,
) -> Signed {
    sign_v4_at(
        method,
        host,
        path,
        region,
        "s3",
        access_key,
        secret_key,
        payload_hash,
        &[],
        chrono::Utc::now(),
    )
}

#[allow(clippy::too_many_arguments)]
fn sign_v4_at(
    method: &str,
    host: &str,
    path: &str,
    region: &str,
    service: &str,
    access_key: &str,
    secret_key: &str,
    payload_hash: &str,
    extra_headers: &[(&str, &str)],
    now: chrono::DateTime<chrono::Utc>,
) -> Signed {
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let canonical_uri = uri_encode(path, false);

    let mut headers: Vec<(String, String)> = vec![
        ("host".into(), host.to_string()),
        ("x-amz-content-sha256".into(), payload_hash.to_string()),
        ("x-amz-date".into(), amz_date.clone()),
    ];
    for (name, value) in extra_headers {
        headers.push((name.to_ascii_lowercase(), value.trim().to_string()));
    }
    headers.sort_by(|a, b| a.0.cmp(&b.0));
    let canonical_headers: String = headers
        .iter()
        .map(|(name, value)| format!("{name}:{value}\n"))
        .collect();
    let signed_headers = headers
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        hex(&Sha256::digest(canonical_request.as_bytes()))
    );
    let k_date = hmac_sha256(format!("AWS4{secret_key}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    Signed {
        authorization: format!(
            "AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
        ),
        amz_date,
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// RFC 3986 encoding as required by SigV4 (`/` kept as separator).
fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_paths_for_signing() {
        assert_eq!(uri_encode("/bucket/some file.zip", false), "/bucket/some%20file.zip");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
    }

    #[test]
    fn builds_object_names() {
        let mut config = OffsiteConfig {
            kind: "s3".into(),
            url: "https://example.com".into(),
            bucket: "backups".into(),
            region: "us-east-1".into(),
            access_key: "key".into(),
            secret_key: "secret".into(),
            ..Default::default()
        };
        assert_eq!(object_name(&config, "server-1.zip"), "server-1.zip");
        config.prefix = "/vs/".into();
        assert_eq!(object_name(&config, "server-1.zip"), "vs/server-1.zip");
    }

    #[test]
    fn matches_aws_documented_example() {
        // Example: GET Object from the S3 SigV4 documentation.
        let signed = sign_v4_at(
            "GET",
            "examplebucket.s3.amazonaws.com",
            "/test.txt",
            "us-east-1",
            "s3",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            &[("range", "bytes=0-9")],
            chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2013, 5, 24, 0, 0, 0).unwrap(),
        );
        assert!(
            signed.authorization.contains(
                "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date"
            ),
            "{}",
            signed.authorization
        );
        assert!(
            signed.authorization.contains(
                "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
            ),
            "{}",
            signed.authorization
        );
    }

    #[test]
    fn signature_is_deterministic_shape() {
        let signed = sign_v4(
            "PUT",
            "localhost:9000",
            "/backups/test.zip",
            "us-east-1",
            "minioadmin",
            "minioadmin",
            "UNSIGNED-PAYLOAD",
        );
        assert!(signed.authorization.starts_with("AWS4-HMAC-SHA256 Credential=minioadmin/"));
        assert!(signed.authorization.contains("SignedHeaders=host;x-amz-content-sha256;x-amz-date"));
        assert_eq!(signed.amz_date.len(), 16);
    }
}
