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

pub async fn download_chapter<R: Runtime>(app: &AppHandle<R>, chapter_id: &str) -> anyhow::Result<Download> {
    let ctx = app.state::<AppCtx>();
    let detail = ctx
        .api
        .chapter_detail(chapter_id)
        .await
        .context("fetch chapter detail")?;
    let low = ctx.settings().map(|s| s.low_quality).unwrap_or(false);
    let dir: PathBuf = ctx
        .dir
        .join("downloads")
        .join(&detail.manga_id)
        .join(&detail.chapter_id);
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
                bytes.fetch_add(meta.len(), Ordering::Relaxed);
                true // already downloaded (resume)
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
                        bytes.fetch_add(b.len() as u64, Ordering::Relaxed);
                        res.is_ok()
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
}
