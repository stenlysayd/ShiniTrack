//! Chapter downloader: 4 parallel page downloads, resumable (existing pages are
//! skipped), progress events to the UI.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::{bail, Context};
use chrono::Utc;
use serde::Serialize;
use shinitrack_core::store::Download;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Semaphore;
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
