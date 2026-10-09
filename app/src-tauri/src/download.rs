//! Chapter downloader: 4 parallel page downloads, resumable (existing pages are
//! skipped), progress events to the UI.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context};
use chrono::Utc;
use serde::Serialize;
use shinitrack_core::store::Download;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{Notify, Semaphore};
use tokio::task::JoinSet;

use crate::commands::AppCtx;

const PARALLEL: usize = 4;

#[derive(Clone, Serialize)]
struct Progress<'a> {
    chapter_id: &'a str,
    done: u32,
    total: u32,
    failed: u32,
}

pub fn sanitize_folder_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control())
        .collect();
    let trimmed = clean.trim().trim_matches('.').trim();
    let limited: String = trimmed.chars().take(80).collect();
    let final_trimmed = limited.trim().trim_matches('.').trim();
    if final_trimmed.is_empty() {
        "komik".to_string()
    } else {
        final_trimmed.to_string()
    }
}

pub fn resolve_manga_folder(downloads_dir: &std::path::Path, clean_title: &str, manga_id: &str) -> PathBuf {
    let base_folder = downloads_dir.join(clean_title);
    let id_prefix = &manga_id[..manga_id.len().min(6)];
    let suffixed_folder = downloads_dir.join(format!("{clean_title} [{id_prefix}]"));

    if base_folder.exists() {
        let id_file = base_folder.join(".manga_id");
        if id_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&id_file) {
                if content.trim() == manga_id {
                    return base_folder;
                } else {
                    return suffixed_folder;
                }
            }
        } else {
            return base_folder;
        }
    }
    base_folder
}

pub fn resolve_chapter_dir(
    base_dir: &std::path::Path,
    manga_id: &str,
    clean_title: &str,
    chapter_id: &str,
    chapter_number: f64,
) -> PathBuf {
    let downloads = base_dir.join("downloads");
    // 1. Try new layout
    let new_path = downloads.join(clean_title).join(format!("Chapter {chapter_number}"));
    if new_path.is_dir() {
        return new_path;
    }
    // 2. Try suffixed layout
    let id_prefix = &manga_id[..manga_id.len().min(6)];
    let suffixed_path = downloads
        .join(format!("{clean_title} [{id_prefix}]"))
        .join(format!("Chapter {chapter_number}"));
    if suffixed_path.is_dir() {
        return suffixed_path;
    }
    // 3. Try legacy layout: downloads/<manga_id>/<chapter_id>
    let legacy_path = downloads.join(manga_id).join(chapter_id);
    if legacy_path.is_dir() {
        return legacy_path;
    }
    // Default fallback to canonical new path
    new_path
}

pub async fn download_chapter<R: Runtime>(app: &AppHandle<R>, chapter_id: &str) -> anyhow::Result<Download> {
    let ctx = app.state::<AppCtx>();
    let detail = ctx
        .api
        .chapter_detail(chapter_id)
        .await
        .context("fetch chapter detail")?;
    let low = ctx.settings().map(|s| s.low_quality).unwrap_or(false);

    let manga_title = ctx
        .store
        .lock()
        .unwrap()
        .get_favorite(&detail.manga_id)
        .ok()
        .flatten()
        .map(|f| f.title)
        .unwrap_or_else(|| detail.manga_id.clone());

    let clean_title = sanitize_folder_name(&manga_title);
    let downloads_dir = ctx.dir.join("downloads");
    let manga_dir = resolve_manga_folder(&downloads_dir, &clean_title, &detail.manga_id);
    tokio::fs::create_dir_all(&manga_dir).await?;
    let id_file = manga_dir.join(".manga_id");
    if !id_file.exists() {
        let _ = tokio::fs::write(&id_file, detail.manga_id.as_bytes()).await;
    }

    let ch_folder = format!("Chapter {}", detail.chapter_number);
    let dir: PathBuf = manga_dir.join(&ch_folder);
    tokio::fs::create_dir_all(&dir).await?;

    let urls = detail.image_urls(low);
    let total = urls.len() as u32;
    let done = Arc::new(AtomicU32::new(0));
    let failed = Arc::new(AtomicU32::new(0));
    let bytes = Arc::new(AtomicU64::new(0));
    let sem = Arc::new(Semaphore::new(PARALLEL));
    let mut set = JoinSet::new();

    for (file, url) in detail.chapter.data.iter().cloned().zip(urls) {
        let (api, dir, sem) = (ctx.api.clone(), dir.clone(), sem.clone());
        let (done, failed, bytes) = (done.clone(), failed.clone(), bytes.clone());
        let app = app.clone();
        let cid = detail.chapter_id.clone();
        set.spawn(async move {
            let _permit = sem.acquire_owned().await.expect("semaphore");
            let target = dir.join(&file);
            let ok = if let Ok(meta) = tokio::fs::metadata(&target).await {
                if meta.len() > 0 {
                    bytes.fetch_add(meta.len(), Ordering::Relaxed);
                    true // already downloaded (resume)
                } else {
                    false
                }
            } else {
                match api.fetch_bytes(&url).await {
                    Ok(b) => {
                        // Write to .part then rename, so a crash never leaves a truncated page.
                        let part = dir.join(format!("{file}.part"));
                        let res = async {
                            tokio::fs::write(&part, &b).await?;
                            tokio::fs::rename(&part, &target).await
                        }
                        .await;
                        if res.is_ok() {
                            bytes.fetch_add(b.len() as u64, Ordering::Relaxed);
                            true
                        } else {
                            log::warn!("page {file} write/rename failed: {:?}", res.err());
                            false
                        }
                    }
                    Err(e) => {
                        log::warn!("page {file} failed: {e}");
                        false
                    }
                }
            };
            if ok {
                done.fetch_add(1, Ordering::Relaxed);
            } else {
                failed.fetch_add(1, Ordering::Relaxed);
            }
            let _ = app.emit(
                "download-progress",
                Progress {
                    chapter_id: &cid,
                    done: done.load(Ordering::Relaxed),
                    total,
                    failed: failed.load(Ordering::Relaxed),
                },
            );
        });
    }
    while set.join_next().await.is_some() {}

    let failed = failed.load(Ordering::Relaxed);
    if failed > 0 {
        bail!("{failed} of {total} pages failed. Tap download again to resume.");
    }
    let d = Download {
        chapter_id: detail.chapter_id.clone(),
        manga_id: detail.manga_id.clone(),
        chapter_number: detail.chapter_number,
        dir: dir.to_string_lossy().into_owned(),
        pages: total,
        bytes: bytes.load(Ordering::Relaxed),
        done_at: Utc::now(),
    };
    ctx.store.lock().unwrap().save_download(&d)?;
    Ok(d)
}

#[cfg(not(target_os = "android"))]
pub fn is_wifi_connected() -> bool {
    true
}

#[cfg(target_os = "android")]
pub fn is_wifi_connected() -> bool {
    crate::jni_bridge::is_wifi_connected().unwrap_or(false)
}

/// Background queue worker that processes download queue items sequentially.
#[derive(Clone)]
pub struct QueueWorker {
    paused: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl Default for QueueWorker {
    fn default() -> Self {
        Self::new()
    }
}

pub fn reset_queue_on_startup(store: &shinitrack_core::store::Store) -> anyhow::Result<usize> {
    Ok(store.queue_reset_downloading_to_pending()?)
}

impl QueueWorker {
    pub fn new() -> Self {
        Self {
            paused: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
        self.notify.notify_one();
        self.notify.notify_waiters();
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn wake(&self) {
        self.notify.notify_one();
    }

    pub fn start<R: Runtime>(&self, app: &AppHandle<R>) {
        let worker = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            worker.run_loop(app).await;
        });
    }

    async fn run_loop<R: Runtime>(&self, app: AppHandle<R>) {
        log::info!("Download queue worker loop started");

        // T10: Saat worker/aplikasi mulai: ubah semua baris unduhan berstatus downloading menjadi pending
        {
            let ctx = app.state::<AppCtx>();
            if let Ok(store) = ctx.store.lock() {
                if let Ok(n) = reset_queue_on_startup(&store) {
                    if n > 0 {
                        log::info!("Reset {n} downloading queue items to pending");
                    }
                }
            }
            let _ = app.emit("queue-changed", ());
        }

        loop {
            // Check if paused
            if self.paused.load(Ordering::SeqCst) {
                self.notify.notified().await;
                continue;
            }

            // Fetch next pending item from store
            let next_item = {
                let ctx = app.state::<AppCtx>();
                let store = ctx.store.lock().unwrap();
                match store.queue_next_pending() {
                    Ok(item) => item,
                    Err(e) => {
                        log::error!("Failed to fetch next pending queue item: {e}");
                        None
                    }
                }
            };

            let Some(item) = next_item else {
                // No pending items, wait for wake notification
                self.notify.notified().await;
                continue;
            };

            // If paused while waiting/fetching, wait
            if self.paused.load(Ordering::SeqCst) {
                self.notify.notified().await;
                continue;
            }

            // Check Wi-Fi only preference: if "1", check network type.
            // On Android, use JNI to query ConnectivityManager. If not Wi-Fi, skip and emit queue-wifi-wait event.
            // On desktop, always proceed.
            let wifi_only = {
                let ctx = app.state::<AppCtx>();
                let store = ctx.store.lock().unwrap();
                store
                    .kv_get("pref.dl.wifi_only")
                    .ok()
                    .flatten()
                    .map(|v| v == "1")
                    .unwrap_or(false)
            };
            if wifi_only && !is_wifi_connected() {
                log::info!("Download queue waiting for Wi-Fi connection");
                let _ = app.emit("queue-wifi-wait", ());
                tokio::select! {
                    _ = self.notify.notified() => {},
                    _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {},
                }
                continue;
            }

            // Mark status as downloading
            {
                let ctx = app.state::<AppCtx>();
                let store = ctx.store.lock().unwrap();
                let _ = store.queue_update_status(&item.chapter_id, "downloading");
            }
            let _ = app.emit("queue-changed", ());

            // Execute download
            match download_chapter(&app, &item.chapter_id).await {
                Ok(d) => {
                    log::info!("Chapter {} downloaded successfully", item.chapter_id);
                    {
                        let ctx = app.state::<AppCtx>();
                        let store = ctx.store.lock().unwrap();
                        let _ = store.queue_update_status(&item.chapter_id, "done");
                        let _ = store.save_download(&d);
                        let _ = store.queue_remove(&item.chapter_id);
                    }
                    let _ = app.emit("queue-changed", ());
                }
                Err(e) => {
                    log::warn!("Chapter {} download failed: {e}", item.chapter_id);
                    {
                        let ctx = app.state::<AppCtx>();
                        let store = ctx.store.lock().unwrap();
                        let _ = store.queue_update_status(&item.chapter_id, "error");
                    }
                    let _ = app.emit("queue-changed", ());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_worker_state() {
        let worker = QueueWorker::new();
        assert!(!worker.is_paused());
        worker.pause();
        assert!(worker.is_paused());
        worker.resume();
        assert!(!worker.is_paused());
        worker.wake();
    }

    #[test]
    fn test_is_wifi_connected_desktop() {
        assert!(is_wifi_connected());
    }

    #[test]
    fn test_sanitize_folder_name() {
        assert_eq!(sanitize_folder_name("Normal Title"), "Normal Title");
        assert_eq!(sanitize_folder_name("Title: With / Invalid * Chars?"), "Title With  Invalid  Chars");
        assert_eq!(sanitize_folder_name("...Trimming Dots..."), "Trimming Dots");
        assert_eq!(sanitize_folder_name("   "), "komik");
        assert_eq!(sanitize_folder_name("///:::***???"), "komik");
        assert_eq!(sanitize_folder_name("\x00\x07Hello\x1b"), "Hello");
        let long_title = "a".repeat(100);
        let sanitized = sanitize_folder_name(&long_title);
        assert_eq!(sanitized.len(), 80);
    }

    #[test]
    fn test_resolve_chapter_path_both_layouts() {
        let temp_dir = std::env::temp_dir().join(format!("shinitrack_dl_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let manga_id = "abc123xyz";
        let clean_title = "One Piece";
        let chapter_id = "ch456";
        let chapter_number = 1050.0;

        // Legacy layout: downloads/<manga_id>/<chapter_id>
        let legacy_dir = temp_dir.join("downloads").join(manga_id).join(chapter_id);
        std::fs::create_dir_all(&legacy_dir).unwrap();

        let resolved_legacy = resolve_chapter_dir(&temp_dir, manga_id, clean_title, chapter_id, chapter_number);
        assert_eq!(resolved_legacy, legacy_dir);

        // New layout: downloads/<clean_title>/Chapter <N>
        let new_dir = temp_dir.join("downloads").join(clean_title).join(format!("Chapter {}", chapter_number));
        std::fs::create_dir_all(&new_dir).unwrap();

        let resolved_new = resolve_chapter_dir(&temp_dir, manga_id, clean_title, chapter_id, chapter_number);
        assert_eq!(resolved_new, new_dir);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_reset_downloading_to_pending() {
        let store = shinitrack_core::store::Store::open_in_memory().unwrap();
        let item = shinitrack_core::store::QueueItem {
            chapter_id: "ch-test-pending".into(),
            manga_id: "manga-test".into(),
            title: "Test Manga".into(),
            chapter_number: 1.0,
            status: "downloading".into(),
            position: 0,
            added_at: chrono::Utc::now(),
        };
        store.queue_add(&item).unwrap();
        let list = store.queue_list().unwrap();
        assert_eq!(list[0].status, "downloading");

        let count = reset_queue_on_startup(&store).unwrap();
        assert_eq!(count, 1);

        let list_after = store.queue_list().unwrap();
        assert_eq!(list_after[0].status, "pending");
    }
}
