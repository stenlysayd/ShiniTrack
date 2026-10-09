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

pub(crate) const ALLOWED_HOST_SUFFIXES: &[&str] = &["shngm.id", "shngm.io", "shinigami.id", "shinigami.asia"];

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
    match ctx.api.fetch_bytes(&url).await {
        Ok(bytes) => respond(StatusCode::OK, content_type(file), bytes),
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
}
