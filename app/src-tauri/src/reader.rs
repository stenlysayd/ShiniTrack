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
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::AppCtx;

const CHAPTER_CACHE_LIMIT_BYTES: u64 = 200 * 1024 * 1024;
const CHAPTER_CACHE_TARGET_BYTES: u64 = CHAPTER_CACHE_LIMIT_BYTES * 9 / 10;
static LAST_CHAPTER_CACHE_PRUNE: AtomicU64 = AtomicU64::new(0);

pub(crate) const ALLOWED_HOST_SUFFIXES: &[&str] = &["shngm.id", "shngm.io", "shinigami.id", "shinigami.asia"];

fn fnv1a64(data: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in data.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

async fn prune_chapter_cache(cache_dir: PathBuf) {
    let mut entries = match tokio::fs::read_dir(&cache_dir).await {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("chapter cache prune skipped: {e}");
            return;
        }
    };

    let mut total = 0u64;
    let mut bins = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let Ok(meta) = entry.metadata().await else { continue };
        if !meta.is_file() {
            continue;
        }
        let len = meta.len();
        total = total.saturating_add(len);
        if path.extension().and_then(|ext| ext.to_str()) == Some("bin") {
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            bins.push((modified, path, len));
        }
    }

    if total <= CHAPTER_CACHE_LIMIT_BYTES {
        return;
    }

    bins.sort_by_key(|(modified, _, _)| *modified);
    for (_, bin_path, bin_len) in bins {
        if total <= CHAPTER_CACHE_TARGET_BYTES {
            break;
        }
        match tokio::fs::remove_file(&bin_path).await {
            Ok(()) => total = total.saturating_sub(bin_len),
            Err(e) => log::warn!("failed to remove old chapter cache {}: {e}", bin_path.display()),
        }
        let ct_path = bin_path.with_extension("ct");
        if let Ok(meta) = tokio::fs::metadata(&ct_path).await {
            let len = meta.len();
            match tokio::fs::remove_file(&ct_path).await {
                Ok(()) => total = total.saturating_sub(len),
                Err(e) => log::warn!("failed to remove chapter cache content type {}: {e}", ct_path.display()),
            }
        }
    }
}

fn maybe_prune_chapter_cache(cache_dir: PathBuf) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let last = LAST_CHAPTER_CACHE_PRUNE.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 30 {
        return;
    }
    if LAST_CHAPTER_CACHE_PRUNE
        .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
        .is_ok()
    {
        tokio::spawn(prune_chapter_cache(cache_dir));
    }
}

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
    let cache_dir = ctx.dir.join("cache").join("chapters");
    let cache_key = format!("{:016x}", fnv1a64(&url));
    let bin_path = cache_dir.join(format!("{cache_key}.bin"));
    let ct_path = cache_dir.join(format!("{cache_key}.ct"));
    if let Ok(bytes) = tokio::fs::read(&bin_path).await {
        if !bytes.is_empty() {
            let ctype = tokio::fs::read_to_string(&ct_path)
                .await
                .unwrap_or_else(|_| content_type(file).to_string());
            return respond(StatusCode::OK, ctype.trim(), bytes);
        }
        let _ = tokio::fs::remove_file(&bin_path).await;
    }

    match ctx.api.fetch_bytes(&url).await {
        Ok(bytes) => {
            let ctype = content_type(file);
            if let Err(e) = tokio::fs::create_dir_all(&cache_dir).await {
                log::warn!("failed to create chapter cache dir {}: {e}", cache_dir.display());
            } else {
                let part_path = cache_dir.join(format!("{cache_key}.bin.part"));
                if let Err(e) = tokio::fs::remove_file(&part_path).await {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        log::warn!("failed to remove stale chapter cache part {}: {e}", part_path.display());
                    }
                }
                match tokio::fs::write(&part_path, &bytes).await {
                    Ok(()) => {
                        if let Err(e) = tokio::fs::rename(&part_path, &bin_path).await {
                            log::warn!("failed to commit chapter cache {}: {e}", bin_path.display());
                            let _ = tokio::fs::remove_file(&part_path).await;
                        } else if let Err(e) = tokio::fs::write(&ct_path, ctype).await {
                            log::warn!("failed to write chapter cache content type {}: {e}", ct_path.display());
                        }
                    }
                    Err(e) => {
                        log::warn!("failed to write chapter cache {}: {e}", part_path.display());
                    }
                }
                maybe_prune_chapter_cache(cache_dir);
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
    fn fnv1a64_known_values() {
        assert_eq!(fnv1a64(""), 0xcbf29ce484222325);
        assert_eq!(fnv1a64("hello"), 0xa430d84680aabd0b);
    }
}
