//! `shimg` custom protocol: serves chapter pages and covers to the webview.
//!
//! Shinigami's CDN wants a `Referer`, which an `<img>` in the webview can't set,
//! so images are fetched by Rust instead. Downloaded chapters are served from
//! disk, so reading works fully offline.
//!
//! Routes (path part of `http://shimg.localhost/...` / `shimg://localhost/...`):
//! * `/p/<chapter_id>/<file>` – a chapter page
//! * `/u/<percent-encoded url>` – any image on an allow-listed Shinigami host (covers)

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::AppCtx;

const ALLOWED_HOST_SUFFIXES: &[&str] = &["shngm.id", "shngm.io", "shinigami.id", "shinigami.asia"];

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    }
}

fn host_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', ':']).next().unwrap_or("");
    ALLOWED_HOST_SUFFIXES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

fn respond(status: StatusCode, ctype: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, ctype)
        .header(header::CACHE_CONTROL, "max-age=604800")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap()
}

fn not_found(msg: &str) -> Response<Vec<u8>> {
    respond(StatusCode::NOT_FOUND, "text/plain", msg.as_bytes().to_vec())
}

pub async fn handle<R: Runtime>(app: &AppHandle<R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let ctx = app.state::<AppCtx>();
    let path = req.uri().path().to_string();
    let mut parts = path.trim_start_matches('/').splitn(3, '/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some("p"), Some(chapter_id), Some(file)) => page(&ctx, &percent_decode(chapter_id), &percent_decode(file)).await,
        (Some("u"), Some(first), rest) => {
            let encoded = match rest {
                Some(r) => format!("{first}/{r}"),
                None => first.to_string(),
            };
            cover(&ctx, &percent_decode(&encoded)).await
        }
        _ => not_found("unknown route"),
    }
}

pub fn fnv1a64(s: &str) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut hash = OFFSET_BASIS;
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

pub const MAX_CACHE_BYTES: u64 = 200 * 1024 * 1024; // 200 MB
pub const PRUNE_TARGET_BYTES: u64 = 180 * 1024 * 1024; // 90% = 180 MB
static LAST_PRUNE_SECS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn prune_cache_dir(dir: &std::path::Path, max_bytes: u64, target_bytes: u64) -> std::io::Result<u64> {
    if !dir.exists() {
        return Ok(0);
    }
    let mut entries = Vec::new();
    let mut total_bytes = 0u64;

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            if let Ok(meta) = entry.metadata() {
                let size = meta.len();
                let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                total_bytes += size;
                entries.push((path, size, mtime));
            }
        }
    }

    if total_bytes <= max_bytes {
        return Ok(0);
    }

    entries.sort_by_key(|(_, _, mtime)| *mtime);

    let mut deleted_bytes = 0u64;
    for (path, size, _) in entries {
        if total_bytes <= target_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total_bytes = total_bytes.saturating_sub(size);
            deleted_bytes += size;
            if path.extension().map_or(false, |ext| ext == "bin") {
                let companion = path.with_extension("ct");
                if companion.exists() {
                    if let Ok(cm) = std::fs::metadata(&companion) {
                        let csize = cm.len();
                        if std::fs::remove_file(&companion).is_ok() {
                            total_bytes = total_bytes.saturating_sub(csize);
                            deleted_bytes += csize;
                        }
                    }
                }
            }
        }
    }
    Ok(deleted_bytes)
}

fn prune_chapter_cache_rate_limited(dir: &std::path::Path) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let last = LAST_PRUNE_SECS.load(std::sync::atomic::Ordering::Relaxed);
    if now - last < 30 {
        return;
    }
    LAST_PRUNE_SECS.store(now, std::sync::atomic::Ordering::Relaxed);

    let dir_clone = dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let _ = prune_cache_dir(&dir_clone, MAX_CACHE_BYTES, PRUNE_TARGET_BYTES);
    });
}

async fn page(ctx: &AppCtx, chapter_id: &str, file: &str) -> Response<Vec<u8>> {
    if file.contains("..") || file.contains('/') || file.contains('\\') {
        return not_found("bad file name");
    }
    // 1. Downloaded → disk.
    let dl = ctx.store.lock().unwrap().get_download(chapter_id).ok().flatten();
    if let Some(d) = dl {
        let p = PathBuf::from(&d.dir).join(file);
        if let Ok(bytes) = tokio::fs::read(&p).await {
            return respond(StatusCode::OK, content_type(file), bytes);
        }
    }
    // 2. Network, via the (cached) chapter detail.
    let cached = ctx.chapter_cache.lock().unwrap().get(chapter_id).cloned();
    let detail = match cached {
        Some(d) => d,
        None => match ctx.api.chapter_detail(chapter_id).await {
            Ok(d) => {
                ctx.chapter_cache
                    .lock()
                    .unwrap()
                    .insert(chapter_id.to_string(), d.clone());
                d
            }
            Err(e) => return respond(StatusCode::BAD_GATEWAY, "text/plain", e.to_string().into_bytes()),
        },
    };
    let low = ctx.settings().map(|s| s.low_quality).unwrap_or(false);
    let Some(idx) = detail.chapter.data.iter().position(|f| f == file) else {
        return not_found("page not in chapter");
    };
    let url = detail.image_urls(low).swap_remove(idx);

    let key = format!("{:016x}", fnv1a64(&url));
    let cache_dir = ctx.dir.join("cache").join("chapters");
    let bin_path = cache_dir.join(format!("{key}.bin"));
    let ct_path = cache_dir.join(format!("{key}.ct"));

    // Check disk cache
    if bin_path.exists() {
        if let Ok(bytes) = tokio::fs::read(&bin_path).await {
            if !bytes.is_empty() {
                let ctype = tokio::fs::read_to_string(&ct_path)
                    .await
                    .unwrap_or_else(|_| content_type(file).to_string());
                return respond(StatusCode::OK, &ctype, bytes);
            }
        }
    }

    match ctx.api.fetch_bytes(&url).await {
        Ok(bytes) => {
            let ctype = content_type(file);
            if let Err(e) = tokio::fs::create_dir_all(&cache_dir).await {
                eprintln!("reader cache create_dir_all failed: {e}");
            } else {
                let part_path = cache_dir.join(format!("{key}.bin.part"));
                if let Err(e) = tokio::fs::write(&part_path, &bytes).await {
                    eprintln!("reader cache write part failed: {e}");
                } else if let Err(e) = tokio::fs::rename(&part_path, &bin_path).await {
                    eprintln!("reader cache rename failed: {e}");
                } else {
                    if let Err(e) = tokio::fs::write(&ct_path, ctype.as_bytes()).await {
                        eprintln!("reader cache write ct failed: {e}");
                    }
                    prune_chapter_cache_rate_limited(&cache_dir);
                }
            }
            respond(StatusCode::OK, ctype, bytes)
        }
        Err(e) => respond(StatusCode::BAD_GATEWAY, "text/plain", e.to_string().into_bytes()),
    }
}

async fn cover(ctx: &AppCtx, url: &str) -> Response<Vec<u8>> {
    if !host_allowed(url) {
        return not_found("host not allowed");
    }
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    let cache = ctx.dir.join("cache").join("img").join(format!("{:016x}", h.finish()));
    if let Ok(bytes) = tokio::fs::read(&cache).await {
        return respond(StatusCode::OK, content_type(url), bytes);
    }
    match ctx.api.fetch_bytes(url).await {
        Ok(bytes) => {
            if let Some(dir) = cache.parent() {
                let _ = tokio::fs::create_dir_all(dir).await;
            }
            let _ = tokio::fs::write(&cache, &bytes).await;
            respond(StatusCode::OK, content_type(url), bytes)
        }
        Err(e) => respond(StatusCode::BAD_GATEWAY, "text/plain", e.to_string().into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_and_allowlist() {
        assert_eq!(percent_decode("https%3A%2F%2Fassets.shngm.id%2Fa.jpg"), "https://assets.shngm.id/a.jpg");
        assert_eq!(percent_decode("100%"), "100%");
        assert!(host_allowed("https://assets.shngm.id/x.jpg"));
        assert!(!host_allowed("https://evil.com/assets.shngm.id"));
        assert!(!host_allowed("http://assets.shngm.id/x.jpg"));
    }

    #[test]
    fn test_fnv1a64() {
        assert_eq!(fnv1a64(""), 0xcbf29ce484222325);
        assert_ne!(fnv1a64("test"), 0);
    }

    #[test]
    fn test_prune_cache_dir() {
        let tmp = std::env::temp_dir().join(format!("shinitrack_test_cache_{}", fnv1a64("test_prune")));
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::create_dir_all(&tmp);

        let f1 = tmp.join("file1.bin");
        let f2 = tmp.join("file2.bin");
        let f3 = tmp.join("file3.bin");

        std::fs::write(&f1, vec![0u8; 600]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        std::fs::write(&f2, vec![0u8; 600]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        std::fs::write(&f3, vec![0u8; 600]).unwrap();

        // Total is 1800 bytes. Max is 1000, target is 700.
        let deleted = prune_cache_dir(&tmp, 1000, 700).unwrap();
        assert_eq!(deleted, 1200);
        let remaining = std::fs::read_dir(&tmp).unwrap().count();
        assert_eq!(remaining, 1);
        assert!(f3.exists(), "Newest file should remain");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
