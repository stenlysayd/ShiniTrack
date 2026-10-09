//! `#[tauri::command]`s called from the UI.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{Duration, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use shinitrack_core::detect::is_newer;
use shinitrack_core::models::{ChapterDetail, ChapterEvent, ChapterItem, Manga, Meta};
use shinitrack_core::predict::{predict, Prediction};
use shinitrack_core::store::{Category, CategoryWithCount, Favorite, LibraryRow, QueueItem, StoredEvent, Store};
use shinitrack_core::ShinigamiClient;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;

use crate::backend::{self, Notice, ServerClient, Settings};
use crate::download::QueueWorker;

pub type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Tauri-managed state.
pub struct AppCtx {
    pub dir: PathBuf,
    pub store: Mutex<Store>,
    pub api: ShinigamiClient,
    pub chapter_cache: Mutex<HashMap<String, ChapterDetail>>,
}

impl AppCtx {
    pub fn new(dir: PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            store: Mutex::new(Store::open(backend::db_path(&dir))?),
            dir,
            api: ShinigamiClient::new()?,
            chapter_cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn settings(&self) -> anyhow::Result<Settings> {
        backend::load_settings(&self.store.lock().unwrap())
    }

    pub fn server(&self) -> Option<ServerClient> {
        self.settings().ok().and_then(|s| ServerClient::from_settings(&s))
    }

    /// Sends the full favorites list to the server (best effort).
    pub async fn sync_favorites_to_server(&self) -> anyhow::Result<bool> {
        let Some(sc) = self.server() else { return Ok(false) };
        let favs = self.store.lock().unwrap().list_favorites()?;
        sc.put_favorites(&favs).await?;
        Ok(true)
    }

    pub async fn refresh_history(&self, manga_id: &str) -> anyhow::Result<()> {
        let page = self.api.chapters(manga_id, 1, 30).await?;
        self.store.lock().unwrap().save_history(&page.items)?;
        Ok(())
    }
}

pub fn show_notices<R: Runtime>(app: &AppHandle<R>, notices: &[Notice]) {
    for n in notices {
        #[cfg(target_os = "android")]
        {
            if let Err(e) = crate::jni_bridge::show_native_notification(n) {
                log::warn!("native android notification failed: {e}");
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            if let Err(e) = app
                .notification()
                .builder()
                .id(n.id)
                .title(&n.title)
                .body(&n.text)
                .show()
            {
                log::warn!("notification failed: {e}");
            }
        }
    }
}

// --------------------------------------------------------------------- search

#[derive(Serialize)]
pub struct MangaCard {
    #[serde(flatten)]
    pub manga: Manga,
    pub is_favorite: bool,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub items: Vec<MangaCard>,
    pub meta: Meta,
}

fn favorite_ids(ctx: &AppCtx) -> HashSet<String> {
    ctx.store
        .lock()
        .unwrap()
        .list_favorites()
        .unwrap_or_default()
        .into_iter()
        .map(|f| f.manga_id)
        .collect()
}

#[tauri::command]
pub async fn search(ctx: State<'_, AppCtx>, query: String, page: Option<u32>) -> CmdResult<SearchResult> {
    let page = ctx
        .api
        .search(query.trim(), page.unwrap_or(1), 20)
        .await
        .map_err(err)?;
    let favs = favorite_ids(&ctx);
    Ok(SearchResult {
        items: page
            .items
            .into_iter()
            .map(|m| MangaCard { is_favorite: favs.contains(&m.manga_id), manga: m })
            .collect(),
        meta: page.meta,
    })
}

#[tauri::command]
pub async fn latest(ctx: State<'_, AppCtx>) -> CmdResult<Vec<MangaCard>> {
    let feed = ctx.api.latest_feed(30).await.map_err(err)?;
    let favs = favorite_ids(&ctx);
    Ok(feed
        .into_iter()
        .map(|m| MangaCard { is_favorite: favs.contains(&m.manga_id), manga: m })
        .collect())
}

#[derive(Serialize)]
pub struct MangaPage {
    pub manga: Manga,
    pub favorite: Option<Favorite>,
    pub prediction: Option<Prediction>,
}

#[tauri::command]
pub async fn manga_detail(ctx: State<'_, AppCtx>, manga_id: String) -> CmdResult<MangaPage> {
    let manga = ctx.api.detail(&manga_id).await.map_err(err)?;
    let favorite = ctx.store.lock().unwrap().get_favorite(&manga_id).map_err(err)?;
    let prediction = prediction_for(&ctx, &manga_id);
    Ok(MangaPage { manga, favorite, prediction })
}

#[derive(Serialize)]
pub struct ChapterList {
    pub items: Vec<ChapterItem>,
    pub meta: Meta,
    pub downloaded: Vec<String>,
}

#[tauri::command]
pub async fn chapters(ctx: State<'_, AppCtx>, manga_id: String, page: Option<u32>) -> CmdResult<ChapterList> {
    let p = ctx
        .api
        .chapters(&manga_id, page.unwrap_or(1), 50)
        .await
        .map_err(err)?;
    let store = ctx.store.lock().unwrap();
    store.save_history(&p.items).map_err(err)?;
    store.save_chapters(&p.items).map_err(err)?;
    let downloaded = store.downloaded_chapter_ids(&manga_id).map_err(err)?;
    Ok(ChapterList { items: p.items, meta: p.meta, downloaded })
}

// ------------------------------------------------------------------ favorites

#[derive(Serialize)]
pub struct FavoriteView {
    #[serde(flatten)]
    pub fav: Favorite,
    pub prediction: Option<Prediction>,
}

fn prediction_for(ctx: &AppCtx, manga_id: &str) -> Option<Prediction> {
    let times = ctx.store.lock().unwrap().history_times(manga_id).ok()?;
    predict(&times, &Local, Utc::now())
}

#[tauri::command]
pub async fn add_favorite(ctx: State<'_, AppCtx>, manga_id: String) -> CmdResult<FavoriteView> {
    let m = ctx.api.detail(&manga_id).await.map_err(err)?;
    let fav = Favorite::from_manga(&m); // baseline = current latest chapter
    ctx.store.lock().unwrap().upsert_favorite(&fav).map_err(err)?;
    if let Err(e) = ctx.refresh_history(&manga_id).await {
        log::warn!("history fetch failed: {e}");
    }
    if let Err(e) = ctx.sync_favorites_to_server().await {
        log::warn!("server sync failed: {e}");
    }
    let prediction = prediction_for(&ctx, &manga_id);
    Ok(FavoriteView { fav, prediction })
}

#[tauri::command]
pub async fn remove_favorite(ctx: State<'_, AppCtx>, manga_id: String) -> CmdResult<()> {
    ctx.store.lock().unwrap().remove_favorite(&manga_id).map_err(err)?;
    if let Err(e) = ctx.sync_favorites_to_server().await {
        log::warn!("server sync failed: {e}");
    }
    Ok(())
}

#[tauri::command]
pub async fn set_notify(ctx: State<'_, AppCtx>, manga_id: String, notify: bool) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .set_notify(&manga_id, notify)
        .map_err(err)?;
    if let Err(e) = ctx.sync_favorites_to_server().await {
        log::warn!("server sync failed: {e}");
    }
    Ok(())
}

#[tauri::command]
pub async fn list_favorites(ctx: State<'_, AppCtx>) -> CmdResult<Vec<FavoriteView>> {
    let favs = ctx.store.lock().unwrap().list_favorites().map_err(err)?;
    Ok(favs
        .into_iter()
        .map(|fav| {
            let prediction = prediction_for(&ctx, &fav.manga_id);
            FavoriteView { fav, prediction }
        })
        .collect())
}

/// Re-downloads chapter history for every favorite (feeds the predictions).
#[tauri::command]
pub async fn refresh_all(ctx: State<'_, AppCtx>) -> CmdResult<usize> {
    let ids: Vec<String> = ctx
        .store
        .lock()
        .unwrap()
        .list_favorites()
        .map_err(err)?
        .into_iter()
        .map(|f| f.manga_id)
        .collect();
    let mut ok = 0;
    for id in &ids {
        match ctx.refresh_history(id).await {
            Ok(()) => ok += 1,
            Err(e) => log::warn!("refresh {id}: {e}"),
        }
    }
    Ok(ok)
}

#[derive(Clone, Serialize)]
pub struct LibraryUpdateProgress {
    pub current: usize,
    pub total: usize,
    pub manga_id: String,
    pub title: String,
}

#[tauri::command]
pub async fn library_update<R: Runtime>(
    app: AppHandle<R>,
    ctx: State<'_, AppCtx>,
) -> CmdResult<usize> {
    let favs = ctx.store.lock().unwrap().list_favorites().map_err(err)?;
    let total = favs.len();
    if total == 0 {
        return Ok(0);
    }

    let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(5));
    let progress_counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let ok_counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let notices = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

    let mut set = tokio::task::JoinSet::new();

    for fav in favs {
        let sem = std::sync::Arc::clone(&sem);
        let api = ctx.api.clone();
        let app_handle = app.clone();
        let progress_counter = std::sync::Arc::clone(&progress_counter);
        let ok_counter = std::sync::Arc::clone(&ok_counter);
        let notices = std::sync::Arc::clone(&notices);

        set.spawn(async move {
            let _permit = sem.acquire().await.ok()?;
            let current = progress_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            let _ = app_handle.emit(
                "library-update-progress",
                LibraryUpdateProgress {
                    current,
                    total,
                    manga_id: fav.manga_id.clone(),
                    title: fav.title.clone(),
                },
            );

            match api.chapters(&fav.manga_id, 1, 30).await {
                Ok(page) => {
                    let ctx = app_handle.state::<AppCtx>();
                    {
                        let store = ctx.store.lock().unwrap();
                        let _ = store.save_chapters(&page.items);
                        let _ = store.save_history(&page.items);
                        let seen = fav.last_seen();
                        for ch in &page.items {
                            let m = Manga {
                                manga_id: fav.manga_id.clone(),
                                title: fav.title.clone(),
                                alternative_title: None,
                                description: None,
                                cover_image_url: None,
                                cover_portrait_url: fav.cover.clone(),
                                latest_chapter_id: Some(ch.chapter_id.clone()),
                                latest_chapter_number: Some(ch.chapter_number),
                                latest_chapter_time: ch.release_date,
                                status: None,
                                bookmark_count: None,
                                country_id: None,
                                taxonomy: HashMap::new(),
                            };
                            if is_newer(&m, &seen) {
                                let ev = ChapterEvent {
                                    manga_id: fav.manga_id.clone(),
                                    title: fav.title.clone(),
                                    cover: fav.cover.clone(),
                                    chapter_id: ch.chapter_id.clone(),
                                    chapter_number: ch.chapter_number,
                                    released_at: ch.release_date,
                                };
                                if let Ok(Some(n)) = backend::accept_event(&store, &ev) {
                                    notices.lock().unwrap().push(n);
                                }
                            }
                        }
                    }
                    ok_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                Err(e) => {
                    log::warn!("library_update failed for {}: {e}", fav.manga_id);
                }
            }

            Some(())
        });
    }

    while let Some(_) = set.join_next().await {}

    ctx.store
        .lock()
        .unwrap()
        .kv_set("last_library_update", &Utc::now().to_rfc3339())
        .map_err(err)?;

    let notices_vec = notices.lock().unwrap().clone();
    show_notices(&app, &notices_vec);

    let ok = ok_counter.load(std::sync::atomic::Ordering::SeqCst);
    Ok(ok)
}

#[tauri::command]
pub fn get_last_library_update(ctx: State<'_, AppCtx>) -> CmdResult<Option<String>> {
    ctx.store
        .lock()
        .unwrap()
        .kv_get("last_library_update")
        .map_err(err)
}

// ------------------------------------------------------------------- schedule

#[derive(Serialize)]
pub struct ScheduleItem {
    pub manga_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub prediction: Prediction,
}

#[derive(Serialize)]
pub struct ScheduleDay {
    pub date: NaiveDate,
    pub items: Vec<ScheduleItem>,
}

#[derive(Serialize)]
pub struct Schedule {
    pub days: Vec<ScheduleDay>,
    /// Favorites past their window or likely on hiatus.
    pub overdue: Vec<ScheduleItem>,
    /// Favorites without enough history to predict.
    pub unknown: Vec<Favorite>,
}

#[tauri::command]
pub async fn schedule_week(ctx: State<'_, AppCtx>) -> CmdResult<Schedule> {
    let favs = ctx.store.lock().unwrap().list_favorites().map_err(err)?;
    let today = Local::now().date_naive();
    let mut buckets: BTreeMap<NaiveDate, Vec<ScheduleItem>> =
        (0..7).map(|d| (today + Duration::days(d), Vec::new())).collect();
    let (mut overdue, mut unknown) = (Vec::new(), Vec::new());
    for f in favs {
        let Some(p) = prediction_for(&ctx, &f.manga_id) else {
            unknown.push(f);
            continue;
        };
        let item = ScheduleItem {
            manga_id: f.manga_id.clone(),
            title: f.title.clone(),
            cover: f.cover.clone(),
            prediction: p.clone(),
        };
        let date = p.next_at.with_timezone(&Local).date_naive();
        if p.likely_hiatus || (p.overdue && date < today) {
            overdue.push(item);
        } else if let Some(b) = buckets.get_mut(&date) {
            b.push(item);
        }
    }
    for items in buckets.values_mut() {
        items.sort_by_key(|i| i.prediction.next_at);
    }
    Ok(Schedule {
        days: buckets
            .into_iter()
            .map(|(date, items)| ScheduleDay { date, items })
            .collect(),
        overdue,
        unknown,
    })
}

// --------------------------------------------------------------- events/sync

#[tauri::command]
pub async fn recent_events(ctx: State<'_, AppCtx>) -> CmdResult<Vec<StoredEvent>> {
    ctx.store.lock().unwrap().recent_events(100).map_err(err)
}

#[tauri::command]
pub async fn mark_events_seen(ctx: State<'_, AppCtx>) -> CmdResult<()> {
    ctx.store.lock().unwrap().mark_all_seen().map_err(err)
}

/// Pulls missed events (server queue + direct check) and pushes favorites.
#[tauri::command]
pub async fn sync_now<R: Runtime>(app: AppHandle<R>, ctx: State<'_, AppCtx>) -> CmdResult<usize> {
    if let Err(e) = ctx.sync_favorites_to_server().await {
        log::warn!("favorites sync failed: {e}");
    }
    let dir = ctx.dir.clone();
    let notices = tauri::async_runtime::spawn_blocking(move || {
        backend::block_on(backend::background_check(&dir))
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    show_notices(&app, &notices);
    Ok(notices.len())
}

// ------------------------------------------------------------------- settings

#[tauri::command]
pub async fn settings_get(ctx: State<'_, AppCtx>) -> CmdResult<Settings> {
    ctx.settings().map_err(err)
}

#[derive(Serialize)]
pub struct SettingsSaved {
    pub server_ok: Option<bool>,
    pub message: String,
}

#[tauri::command]
pub async fn settings_set(ctx: State<'_, AppCtx>, settings: Settings) -> CmdResult<SettingsSaved> {
    backend::save_settings(&ctx.store.lock().unwrap(), &settings).map_err(err)?;
    let Some(sc) = ServerClient::from_settings(&settings) else {
        return Ok(SettingsSaved { server_ok: None, message: "Saved (no server configured).".into() });
    };
    if let Err(e) = sc.health().await {
        return Ok(SettingsSaved { server_ok: Some(false), message: format!("Saved, but the server can't be reached: {e}") });
    }
    // Re-send favorites and the push endpoint now that the server is known.
    let endpoint = ctx
        .store
        .lock()
        .unwrap()
        .kv_get(backend::KV_UP_ENDPOINT)
        .map_err(err)?
        .filter(|e| !e.is_empty());
    let favs = ctx.sync_favorites_to_server().await;
    let dev = sc.put_device(endpoint.as_deref()).await;
    Ok(match (favs, dev) {
        (Ok(_), Ok(_)) => SettingsSaved {
            server_ok: Some(true),
            message: if endpoint.is_some() {
                "Connected. Favorites & push endpoint synced.".into()
            } else {
                "Connected. Favorites synced (UnifiedPush not registered yet. Is the ntfy app installed?).".into()
            },
        },
        (a, b) => SettingsSaved {
            server_ok: Some(false),
            message: format!("Server reachable but sync failed: {:?} {:?}", a.err(), b.err()),
        },
    })
}

#[tauri::command]
pub async fn pref_get_all(ctx: State<'_, AppCtx>) -> CmdResult<HashMap<String, String>> {
    let map = ctx
        .store
        .lock()
        .unwrap()
        .kv_get_prefix("pref.")
        .map_err(err)?;
    
    let mut prefs = HashMap::new();
    for (k, v) in map {
        if let Some(stripped) = k.strip_prefix("pref.") {
            prefs.insert(stripped.to_string(), v);
        }
    }
    Ok(prefs)
}

#[tauri::command]
pub async fn pref_set(
    ctx: State<'_, AppCtx>,
    worker: State<'_, QueueWorker>,
    key: String,
    value: String,
) -> CmdResult<()> {
    let db_key = format!("pref.{}", key);
    ctx.store
        .lock()
        .unwrap()
        .kv_set(&db_key, &value)
        .map_err(err)?;
    if key == "dl.wifi_only" {
        worker.wake();
    }
    Ok(())
}

#[tauri::command]
pub async fn update_worker_interval(ctx: State<'_, AppCtx>, interval: String) -> CmdResult<()> {
    let db_key = "pref.lib.update_interval";
    ctx.store
        .lock()
        .unwrap()
        .kv_set(db_key, &interval)
        .map_err(err)?;
    log::info!("Background worker interval updated: {}", interval);
    Ok(())
}

#[tauri::command]
pub async fn set_keep_awake(ctx: State<'_, AppCtx>, keep: bool) -> CmdResult<()> {
    let val = if keep { "1" } else { "0" };
    ctx.store
        .lock()
        .unwrap()
        .kv_set("pref.reader.keep_awake", val)
        .map_err(err)?;
    log::info!("Screen keep awake set to {}", keep);
    Ok(())
}

#[tauri::command]
pub async fn set_secure_screen(ctx: State<'_, AppCtx>, secure: bool) -> CmdResult<()> {
    let val = if secure { "1" } else { "0" };
    ctx.store
        .lock()
        .unwrap()
        .kv_set("pref.sec.secure_screen_active", val)
        .map_err(err)?;
    log::info!("Secure screen flag updated: {}", secure);
    Ok(())
}

#[tauri::command]
pub async fn test_notification<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    show_notices(
        &app,
        &[Notice {
            id: 9999,
            manga_id: "uji-notifikasi".into(),
            title: "Notifikasi Uji".into(),
            text: "Notifikasi uji berhasil dikirim.".into(),
            cover: None,
        }],
    );
    Ok(())
}

// --------------------------------------------------------------------- reader

#[derive(Serialize)]
pub struct ReaderChapter {
    pub chapter_id: String,
    pub manga_id: String,
    pub chapter_number: f64,
    pub pages: Vec<String>,
    pub prev_chapter_id: Option<String>,
    pub next_chapter_id: Option<String>,
    pub offline: bool,
}

/// Returns page file names; the UI turns them into `shimg` URLs
/// (`/p/<chapter_id>/<file>`), which the protocol handler serves from disk if
/// downloaded or from the network otherwise.
#[tauri::command]
pub async fn open_chapter(ctx: State<'_, AppCtx>, chapter_id: String) -> CmdResult<ReaderChapter> {
    let dl = ctx.store.lock().unwrap().get_download(&chapter_id).map_err(err)?;
    let cached = ctx.chapter_cache.lock().unwrap().get(&chapter_id).cloned();
    let detail = match cached {
        Some(d) => Some(d),
        None => match ctx.api.chapter_detail(&chapter_id).await {
            Ok(d) => {
                ctx.chapter_cache.lock().unwrap().insert(chapter_id.clone(), d.clone());
                Some(d)
            }
            Err(e) if dl.is_some() => {
                log::info!("offline, using download: {e}");
                None
            }
            Err(e) => return Err(err(e)),
        },
    };
    let res = if let Some(d) = detail {
        ReaderChapter {
            chapter_id: d.chapter_id.clone(),
            manga_id: d.manga_id.clone(),
            chapter_number: d.chapter_number,
            pages: d.chapter.data.clone(),
            prev_chapter_id: d.prev_chapter_id.clone(),
            next_chapter_id: d.next_chapter_id.clone(),
            offline: dl.is_some(),
        }
    } else {
        // Offline: list files from the download directory.
        let d = dl.expect("checked above");
        let mut pages: Vec<String> = std::fs::read_dir(&d.dir)
            .map_err(err)?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| !n.ends_with(".part"))
            .collect();
        pages.sort();
        ReaderChapter {
            chapter_id: d.chapter_id,
            manga_id: d.manga_id,
            chapter_number: d.chapter_number,
            pages,
            prev_chapter_id: None,
            next_chapter_id: None,
            offline: true,
        }
    };

    // Check pref.dl.delete_after_read
    let dir_to_delete = {
        let store = ctx.store.lock().unwrap();
        let delete_after_read = store
            .kv_get("pref.dl.delete_after_read")
            .ok()
            .flatten()
            .map(|v| v == "1")
            .unwrap_or(false);
        if delete_after_read {
            if let Ok(Some(prev)) = store.get_last_reading_progress(&res.manga_id) {
                if prev.chapter_id != res.chapter_id {
                    if let Ok(Some(d)) = store.get_download(&prev.chapter_id) {
                        let _ = store.delete_download(&prev.chapter_id);
                        Some((prev.chapter_id, d.dir))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((prev_cid, dir)) = dir_to_delete {
        let _ = std::fs::remove_dir_all(&dir);
        log::info!("Deleted previous chapter download {} at {:?}", prev_cid, dir);
    }

    Ok(res)
}

#[tauri::command]
pub async fn download_chapter<R: Runtime>(app: AppHandle<R>, chapter_id: String) -> CmdResult<u32> {
    crate::download::download_chapter(&app, &chapter_id)
        .await
        .map(|d| d.pages)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn delete_download(ctx: State<'_, AppCtx>, chapter_id: String) -> CmdResult<()> {
    let store = ctx.store.lock().unwrap();
    if let Some(d) = store.get_download(&chapter_id).map_err(err)? {
        let _ = std::fs::remove_dir_all(&d.dir);
        store.delete_download(&chapter_id).map_err(err)?;
    }
    Ok(())
}

// --------------------------------------------------------------------- updater & reading progress

#[tauri::command]
pub async fn check_app_update(
    ctx: State<'_, AppCtx>,
    repo: Option<String>,
) -> CmdResult<crate::updater::UpdateInfo> {
    let settings = ctx.settings().unwrap_or_default();
    let repo_raw = repo
        .filter(|s| !s.trim().is_empty())
        .or(settings.github_repo)
        .unwrap_or_else(|| "stenlysayd/ShiniTrack".into());

    let repo_to_use = crate::updater::clean_github_repo(&repo_raw);
    match crate::updater::check_github_release(&repo_to_use, crate::updater::CURRENT_APP_VERSION).await {
        Ok(info) => Ok(info),
        Err(e) => {
            log::warn!("update check failed for {repo_to_use}: {e:#}");
            Err("Tidak dapat memeriksa pembaruan".into())
        }
    }
}

#[tauri::command]
pub async fn download_and_install_update<R: Runtime>(
    app: AppHandle<R>,
    download_url: String,
) -> CmdResult<crate::updater::InstallOutcome> {
    crate::updater::download_and_install_apk(&app, &download_url)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn can_install_updates() -> bool {
    #[cfg(target_os = "android")]
    {
        crate::jni_bridge::can_install_packages().unwrap_or(true)
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

#[tauri::command]
pub fn request_install_permission() -> bool {
    #[cfg(target_os = "android")]
    {
        crate::jni_bridge::request_install_permission().unwrap_or(false)
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

#[tauri::command]
pub fn install_downloaded_apk(file_path: String) -> CmdResult<crate::updater::InstallOutcome> {
    crate::updater::install_apk_file(&file_path).map_err(err)
}

#[tauri::command]
pub fn simulate_update_check() -> crate::updater::UpdateInfo {
    crate::updater::mock_update_info(crate::updater::CURRENT_APP_VERSION)
}

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub build_code: u32,
    pub platform: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "ShiniTrack".into(),
        version: crate::updater::CURRENT_APP_VERSION.into(),
        build_code: crate::updater::CURRENT_BUILD_CODE,
        platform: if cfg!(target_os = "android") {
            "android".into()
        } else {
            "desktop".into()
        },
    }
}

#[tauri::command]
pub fn save_reading_progress(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    chapter_id: String,
    chapter_number: f64,
    last_page: u32,
    read_duration: u64,
) -> CmdResult<()> {
    let is_incognito = ctx
        .store
        .lock()
        .unwrap()
        .kv_get("pref.privacy.incognito")
        .ok()
        .flatten()
        .map(|v| v == "1")
        .unwrap_or(false);
    if is_incognito {
        log::debug!("Incognito active: skipping save_reading_progress");
        return Ok(());
    }
    ctx.store
        .lock()
        .unwrap()
        .save_reading_progress(
            &manga_id,
            &chapter_id,
            chapter_number,
            last_page,
            read_duration,
        )
        .map_err(err)
}

#[tauri::command]
pub fn get_reading_progress(
    ctx: State<'_, AppCtx>,
    manga_id: String,
) -> CmdResult<Option<shinitrack_core::store::ReadingProgress>> {
    ctx.store
        .lock()
        .unwrap()
        .get_last_reading_progress(&manga_id)
        .map_err(err)
}

#[tauri::command]
pub fn list_all_reading_progress(
    ctx: State<'_, AppCtx>,
) -> CmdResult<HashMap<String, shinitrack_core::store::ReadingProgress>> {
    ctx.store
        .lock()
        .unwrap()
        .list_all_last_reading()
        .map_err(err)
}

#[tauri::command]
pub fn list_read_chapters(
    ctx: State<'_, AppCtx>,
    manga_id: String,
) -> CmdResult<HashSet<String>> {
    ctx.store
        .lock()
        .unwrap()
        .list_read_chapter_ids(&manga_id)
        .map_err(err)
}

#[tauri::command]
pub fn mark_chapter_read(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    chapter_id: String,
    chapter_number: f64,
    read: bool,
) -> CmdResult<()> {
    let is_incognito = ctx
        .store
        .lock()
        .unwrap()
        .kv_get("pref.privacy.incognito")
        .ok()
        .flatten()
        .map(|v| v == "1")
        .unwrap_or(false);
    if is_incognito {
        log::debug!("Incognito active: skipping mark_chapter_read");
        return Ok(());
    }
    ctx.store
        .lock()
        .unwrap()
        .mark_chapter_read(&manga_id, &chapter_id, chapter_number, read)
        .map_err(err)
}

#[tauri::command]
pub fn list_bookmarked_chapters(
    ctx: State<'_, AppCtx>,
    manga_id: String,
) -> CmdResult<HashSet<String>> {
    ctx.store
        .lock()
        .unwrap()
        .list_bookmarked_chapter_ids(&manga_id)
        .map_err(err)
}

#[tauri::command]
pub fn set_chapter_bookmark(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    chapter_id: String,
    chapter_number: f64,
    bookmarked: bool,
) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .set_chapter_bookmark(&manga_id, &chapter_id, chapter_number, bookmarked)
        .map_err(err)
}

#[tauri::command]
pub fn mark_chapters_batch(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    chapters: Vec<(String, f64)>,
    read: bool,
) -> CmdResult<()> {
    let is_incognito = ctx
        .store
        .lock()
        .unwrap()
        .kv_get("pref.privacy.incognito")
        .ok()
        .flatten()
        .map(|v| v == "1")
        .unwrap_or(false);
    if is_incognito {
        log::debug!("Incognito active: skipping mark_chapters_batch");
        return Ok(());
    }
    ctx.store
        .lock()
        .unwrap()
        .mark_chapters_read_batch(&manga_id, &chapters, read)
        .map_err(err)
}

#[tauri::command]
pub fn save_manga_meta(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    title: String,
    cover: Option<String>,
    country_id: Option<String>,
) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .save_manga_meta(&manga_id, &title, cover.as_deref(), country_id.as_deref())
        .map_err(err)
}

#[tauri::command]
pub fn get_reading_history(
    ctx: State<'_, AppCtx>,
    limit: Option<u32>,
) -> CmdResult<Vec<shinitrack_core::store::HistoryItem>> {
    ctx.store
        .lock()
        .unwrap()
        .list_history(limit.unwrap_or(50))
        .map_err(err)
}

#[tauri::command]
pub fn delete_history_item(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    chapter_id: String,
) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .delete_history_item(&manga_id, &chapter_id)
        .map_err(err)
}

#[tauri::command]
pub fn search_history(
    ctx: State<'_, AppCtx>,
    query: String,
    limit: Option<u32>,
) -> CmdResult<Vec<shinitrack_core::store::HistoryItem>> {
    ctx.store
        .lock()
        .unwrap()
        .search_history(&query, limit.unwrap_or(200))
        .map_err(err)
}

// ---------------------------------------------------------------- categories

#[tauri::command]
pub fn category_list(ctx: State<'_, AppCtx>) -> CmdResult<Vec<CategoryWithCount>> {
    ctx.store
        .lock()
        .unwrap()
        .list_categories_with_count()
        .map_err(err)
}

#[tauri::command]
pub fn category_create(ctx: State<'_, AppCtx>, name: String) -> CmdResult<Category> {
    ctx.store
        .lock()
        .unwrap()
        .create_category(&name)
        .map_err(err)
}

#[tauri::command]
pub fn category_rename(ctx: State<'_, AppCtx>, id: i64, name: String) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .rename_category(id, &name)
        .map_err(err)
}

#[tauri::command]
pub fn category_delete(ctx: State<'_, AppCtx>, id: i64) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .delete_category(id)
        .map_err(err)
}

#[tauri::command]
pub fn category_reorder(ctx: State<'_, AppCtx>, ids: Vec<i64>) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .reorder_categories(&ids)
        .map_err(err)
}

#[tauri::command]
pub fn set_manga_categories(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    category_ids: Vec<i64>,
) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .set_manga_categories(&manga_id, &category_ids)
        .map_err(err)
}

#[tauri::command]
pub fn get_manga_categories(ctx: State<'_, AppCtx>, manga_id: String) -> CmdResult<Vec<i64>> {
    ctx.store
        .lock()
        .unwrap()
        .get_manga_categories(&manga_id)
        .map_err(err)
}

/// Used by `lib.rs` when the app is opened from a notification / resumed.
pub fn ctx<R: Runtime>(app: &AppHandle<R>) -> State<'_, AppCtx> {
    app.state::<AppCtx>()
}

#[tauri::command]
pub fn library_list(
    ctx: State<'_, AppCtx>,
    category: i64,
    sort: String,
    sort_desc: bool,
    filter_downloaded: i64,
    filter_unread: i64,
    filter_started: i64,
    filter_completed: i64,
    search: Option<String>,
    limit: i64,
    offset: i64,
) -> CmdResult<Vec<LibraryRow>> {
    ctx.store
        .lock()
        .unwrap()
        .library_page(
            category,
            &sort,
            sort_desc,
            filter_downloaded,
            filter_unread,
            filter_started,
            filter_completed,
            search.as_deref(),
            limit,
            offset,
        )
        .map_err(err)
}

// -------------------------------------------------------- data & storage (3.9)

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub data_dir: String,
    pub cache_bytes: u64,
    pub downloads_bytes: u64,
    pub database_bytes: u64,
    pub total_used_bytes: u64,
    pub last_backup: Option<String>,
}

#[tauri::command]
pub async fn storage_info(ctx: State<'_, AppCtx>) -> CmdResult<StorageInfo> {
    let data_dir = ctx.dir.to_string_lossy().into_owned();
    let cache_bytes = dir_size(&ctx.dir.join("cache"));
    let downloads_bytes = dir_size(&ctx.dir.join("downloads"));

    let db_path = backend::db_path(&ctx.dir);
    let mut database_bytes = db_path.metadata().map(|m| m.len()).unwrap_or(0);
    if let Ok(m) = db_path.with_extension("db-wal").metadata() {
        database_bytes += m.len();
    }
    if let Ok(m) = db_path.with_extension("db-shm").metadata() {
        database_bytes += m.len();
    }

    let total_used_bytes = cache_bytes + downloads_bytes + database_bytes;
    let store = ctx.store.lock().unwrap();
    let last_backup = store.kv_get("pref.storage.last_backup").ok().flatten();

    Ok(StorageInfo {
        data_dir,
        cache_bytes,
        downloads_bytes,
        database_bytes,
        total_used_bytes,
        last_backup,
    })
}

#[tauri::command]
pub async fn clear_cache(ctx: State<'_, AppCtx>, target: Option<String>) -> CmdResult<u64> {
    let mut freed = 0u64;
    let t = target.as_deref().unwrap_or("all");

    if t == "all" || t == "chapters" || t == "chapter" {
        ctx.chapter_cache.lock().unwrap().clear();
        let deleted_rows = ctx
            .store
            .lock()
            .unwrap()
            .clear_chapter_cache()
            .unwrap_or(0);
        let p = ctx.dir.join("cache").join("chapters");
        if p.exists() {
            freed += dir_size(&p);
            let _ = std::fs::remove_dir_all(&p);
            let _ = std::fs::create_dir_all(&p);
        }
        if freed == 0 && deleted_rows > 0 {
            freed += (deleted_rows as u64) * 512;
        }
    }
    if t == "all" || t == "covers" || t == "cover" || t == "img" {
        let p = ctx.dir.join("cache").join("img");
        if p.exists() {
            freed += dir_size(&p);
            let _ = std::fs::remove_dir_all(&p);
            let _ = std::fs::create_dir_all(&p);
        }
    }
    if t == "all" {
        let p = ctx.dir.join("cache");
        if p.exists() {
            let s = dir_size(&p);
            if s > freed {
                freed = s;
            }
            let _ = std::fs::remove_dir_all(&p);
            let _ = std::fs::create_dir_all(&p);
        }
    }
    log::info!("Cleared cache (target={}): freed {} bytes", t, freed);
    Ok(freed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupData {
    pub version: u32,
    pub created_at: String,
    #[serde(default)]
    pub favorites: Vec<Favorite>,
    #[serde(default)]
    pub categories: Vec<Category>,
    #[serde(default)]
    pub manga_categories: Vec<(String, Vec<i64>)>,
    #[serde(default)]
    pub reading_progress: Vec<shinitrack_core::store::ReadingProgress>,
    #[serde(default)]
    pub chapter_read: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub prefs: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupResult {
    pub file_path: String,
    pub created_at: String,
    pub favorites_count: usize,
    pub categories_count: usize,
    pub json: String,
}

pub fn cleanup_old_backups(backup_dir: &Path, keep_count: usize) {
    let Ok(entries) = std::fs::read_dir(backup_dir) else { return; };
    let mut backup_files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("shinitrack_backup_") && name.ends_with(".json") {
                    let mtime = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    backup_files.push((mtime, path));
                }
            }
        }
    }
    backup_files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.file_name().cmp(&a.1.file_name())));
    if backup_files.len() > keep_count {
        for (_, old_file) in &backup_files[keep_count..] {
            let _ = std::fs::remove_file(old_file);
        }
    }
}

pub fn create_backup_internal(
    dir: &Path,
    store: &Store,
    include_token: Option<bool>,
) -> anyhow::Result<BackupResult> {
    let favorites = store.list_favorites()?;
    let cat_with_count = store.list_categories_with_count()?;
    let categories: Vec<Category> = cat_with_count
        .into_iter()
        .map(|c| c.category)
        .collect();

    let mut manga_categories = Vec::new();
    let mut chapter_read = HashMap::new();
    for f in &favorites {
        if let Ok(cats) = store.get_manga_categories(&f.manga_id) {
            if !cats.is_empty() {
                manga_categories.push((f.manga_id.clone(), cats));
            }
        }
        if let Ok(reads) = store.list_read_chapter_ids(&f.manga_id) {
            if !reads.is_empty() {
                chapter_read.insert(f.manga_id.clone(), reads.into_iter().collect());
            }
        }
    }

    let reading_map = store.list_all_last_reading()?;
    let reading_progress: Vec<shinitrack_core::store::ReadingProgress> =
        reading_map.into_values().collect();

    let include = include_token.unwrap_or(false);
    let raw_prefs = store.kv_get_prefix("pref.")?;
    let mut prefs: HashMap<String, String> = raw_prefs
        .into_iter()
        .filter(|(k, _)| include || !k.contains("token"))
        .collect();
    if include {
        if let Ok(Some(tok)) = store.kv_get("server_token") {
            if !tok.trim().is_empty() && !prefs.contains_key("pref.sync.server_token") {
                prefs.insert("pref.sync.server_token".into(), tok);
            }
        }
    }

    let created_at = Utc::now().to_rfc3339();
    let backup_data = BackupData {
        version: 1,
        created_at: created_at.clone(),
        favorites,
        categories,
        manga_categories,
        reading_progress,
        chapter_read,
        prefs,
    };

    let json = serde_json::to_string_pretty(&backup_data)?;
    let backup_dir = dir.join("backups");
    let _ = std::fs::create_dir_all(&backup_dir);
    let filename = format!("shinitrack_backup_{}.json", Utc::now().format("%Y%m%d_%H%M%S"));
    let file_path = backup_dir.join(&filename);
    std::fs::write(&file_path, &json)?;

    cleanup_old_backups(&backup_dir, 5);

    let _ = store.kv_set("pref.storage.last_backup", &created_at);

    Ok(BackupResult {
        file_path: file_path.to_string_lossy().into_owned(),
        created_at,
        favorites_count: backup_data.favorites.len(),
        categories_count: backup_data.categories.len(),
        json,
    })
}

#[tauri::command]
pub async fn backup_create(
    ctx: State<'_, AppCtx>,
    include_token: Option<bool>,
) -> CmdResult<BackupResult> {
    let store = ctx.store.lock().unwrap();
    create_backup_internal(&ctx.dir, &store, include_token).map_err(err)
}

pub fn backup_create_headless(dir: &Path) -> anyhow::Result<BackupResult> {
    let store = Store::open(crate::backend::db_path(dir))?;
    let include_token = store
        .kv_get("pref.storage.backup_include_token")
        .ok()
        .flatten()
        .map(|v| v == "1");
    create_backup_internal(dir, &store, include_token)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreResult {
    pub favorites_restored: usize,
    pub categories_restored: usize,
    pub message: String,
}

#[tauri::command]
pub async fn backup_restore(
    ctx: State<'_, AppCtx>,
    json: Option<String>,
    file_path: Option<String>,
) -> CmdResult<RestoreResult> {
    let content = if let Some(j) = json {
        j
    } else if let Some(p) = file_path {
        std::fs::read_to_string(p).map_err(err)?
    } else {
        return Err("No backup content provided".into());
    };

    let backup_data: BackupData = serde_json::from_str(&content).map_err(err)?;
    let mut store = ctx.store.lock().unwrap();

    let existing_cats = store.list_categories_with_count().map_err(err)?;
    let mut cat_map: HashMap<String, i64> = existing_cats
        .into_iter()
        .map(|c| (c.category.name, c.category.id))
        .collect();
    let mut categories_restored = 0;

    for cat in &backup_data.categories {
        if !cat_map.contains_key(&cat.name) {
            if let Ok(created) = store.create_category(&cat.name) {
                cat_map.insert(cat.name.clone(), created.id);
                categories_restored += 1;
            }
        }
    }

    let mut favorites_restored = 0;
    for fav in &backup_data.favorites {
        if store.upsert_favorite(fav).is_ok() {
            favorites_restored += 1;
        }
    }

    for (manga_id, old_cat_ids) in &backup_data.manga_categories {
        let mut target_ids = Vec::new();
        for old_id in old_cat_ids {
            if let Some(old_cat) = backup_data.categories.iter().find(|c| c.id == *old_id) {
                if let Some(new_id) = cat_map.get(&old_cat.name) {
                    target_ids.push(*new_id);
                }
            } else if cat_map.values().any(|v| v == old_id) {
                target_ids.push(*old_id);
            }
        }
        if !target_ids.is_empty() {
            let _ = store.set_manga_categories(manga_id, &target_ids);
        }
    }

    for p in &backup_data.reading_progress {
        let _ = store.save_reading_progress(&p.manga_id, &p.chapter_id, p.chapter_number, p.last_page, p.read_duration);
    }

    for (manga_id, ch_ids) in &backup_data.chapter_read {
        let ch_tuples: Vec<(String, f64)> = ch_ids.iter().map(|id| (id.clone(), 0.0)).collect();
        let _ = store.mark_chapters_read_batch(manga_id, &ch_tuples, true);
    }

    for (k, v) in &backup_data.prefs {
        if k.starts_with("pref.") {
            let _ = store.kv_set(k, v);
            if k == "pref.sync.server_token" {
                let _ = store.kv_set("server_token", v);
            } else if k == "pref.sync.server_url" {
                let _ = store.kv_set("server_url", v);
            }
        } else if k == "server_token" {
            let _ = store.kv_set("server_token", v);
            let _ = store.kv_set("pref.sync.server_token", v);
        } else if k == "server_url" {
            let _ = store.kv_set("server_url", v);
            let _ = store.kv_set("pref.sync.server_url", v);
        }
    }

    Ok(RestoreResult {
        favorites_restored,
        categories_restored,
        message: format!(
            "Berhasil memulihkan {} komik favorit dan {} kategori baru",
            favorites_restored, categories_restored
        ),
    })
}

#[tauri::command]
pub async fn generate_crash_log(ctx: State<'_, AppCtx>) -> CmdResult<String> {
    let now = Utc::now().to_rfc3339();
    let db_path = crate::backend::db_path(&ctx.dir);
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let fav_count = ctx
        .store
        .lock()
        .unwrap()
        .list_favorites()
        .map(|f| f.len())
        .unwrap_or(0);
    let schema_version = ctx
        .store
        .lock()
        .unwrap()
        .kv_get("schema_version")
        .unwrap_or(None)
        .unwrap_or_else(|| "2".into());
    let log_path = ctx.dir.join("shinitrack.log");
    let recent_logs = if log_path.exists() {
        std::fs::read_to_string(&log_path).unwrap_or_else(|_| "Gagal membaca berkas log.".into())
    } else {
        "Tidak ada rekaman log kerusakan tercatat. Sistem beroperasi normal.".into()
    };

    let report = format!(
        "=== ShiniTrack Crash & Diagnostic Log ===\n\
         Waktu: {}\n\
         Aplikasi: ShiniTrack v{}\n\
         Platform: {}\n\
         Direktori Data: {}\n\
         Versi Skema DB: {}\n\
         Ukuran Basis Data: {} bytes\n\
         Total Favorit: {}\n\n\
         --- Log Terbaru ---\n\
         {}\n\
         =========================================",
        now,
        crate::updater::CURRENT_APP_VERSION,
        if cfg!(target_os = "android") { "Android" } else { "Desktop" },
        ctx.dir.display(),
        schema_version,
        db_size,
        fav_count,
        recent_logs
    );
    Ok(report)
}

#[tauri::command]
pub async fn clear_reading_history(ctx: State<'_, AppCtx>) -> CmdResult<()> {
    ctx.store.lock().unwrap().clear_reading_history().map_err(err)?;
    log::info!("Reading history cleared");
    Ok(())
}

#[tauri::command]
pub async fn reset_settings(ctx: State<'_, AppCtx>) -> CmdResult<()> {
    ctx.store.lock().unwrap().reset_prefs().map_err(err)?;
    log::info!("Preferences reset to default");
    Ok(())
}

#[tauri::command]
pub async fn cleanup_database(ctx: State<'_, AppCtx>) -> CmdResult<()> {
    ctx.store.lock().unwrap().cleanup_database().map_err(err)?;
    log::info!("Database cache cleaned and vacuumed");
    Ok(())
}

#[tauri::command]
pub fn get_statistics(ctx: State<'_, AppCtx>) -> CmdResult<shinitrack_core::store::Statistics> {
    ctx.store.lock().unwrap().get_statistics().map_err(err)
}

// ------------------------------------------------------------- download queue

#[tauri::command]
pub async fn queue_add(
    ctx: State<'_, AppCtx>,
    worker: State<'_, QueueWorker>,
    manga_id: String,
    chapter_id: String,
    title: String,
    chapter_number: f64,
) -> CmdResult<()> {
    let item = QueueItem {
        chapter_id,
        manga_id,
        title,
        chapter_number,
        status: "pending".into(),
        position: -1,
        added_at: Utc::now(),
    };
    ctx.store.lock().unwrap().queue_add(&item).map_err(err)?;
    worker.wake();
    Ok(())
}

#[tauri::command]
pub async fn queue_list(ctx: State<'_, AppCtx>) -> CmdResult<Vec<QueueItem>> {
    ctx.store.lock().unwrap().queue_list().map_err(err)
}

#[tauri::command]
pub async fn queue_remove(ctx: State<'_, AppCtx>, chapter_id: String) -> CmdResult<()> {
    ctx.store.lock().unwrap().queue_remove(&chapter_id).map_err(err)
}

#[tauri::command]
pub async fn queue_pause(
    ctx: State<'_, AppCtx>,
    worker: State<'_, QueueWorker>,
    chapter_id: String,
) -> CmdResult<()> {
    if chapter_id.is_empty() || chapter_id == "all" {
        worker.pause();
    } else {
        ctx.store
            .lock()
            .unwrap()
            .queue_update_status(&chapter_id, "paused")
            .map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn queue_resume(
    ctx: State<'_, AppCtx>,
    worker: State<'_, QueueWorker>,
    chapter_id: String,
) -> CmdResult<()> {
    if chapter_id.is_empty() || chapter_id == "all" {
        worker.resume();
    } else {
        ctx.store
            .lock()
            .unwrap()
            .queue_update_status(&chapter_id, "pending")
            .map_err(err)?;
        worker.resume();
    }
    worker.wake();
    Ok(())
}

#[tauri::command]
pub async fn queue_reorder(ctx: State<'_, AppCtx>, chapter_ids: Vec<String>) -> CmdResult<()> {
    ctx.store.lock().unwrap().queue_reorder(&chapter_ids).map_err(err)
}

#[tauri::command]
pub async fn queue_clear(ctx: State<'_, AppCtx>) -> CmdResult<()> {
    ctx.store.lock().unwrap().queue_clear_done().map_err(err)
}

#[tauri::command]
pub async fn queue_retry(
    ctx: State<'_, AppCtx>,
    worker: State<'_, QueueWorker>,
    chapter_id: String,
) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .queue_update_status(&chapter_id, "pending")
        .map_err(err)?;
    worker.wake();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backup_token_filtering() {
        let mut raw_prefs = HashMap::new();
        raw_prefs.insert("pref.reader.mode".to_string(), "webtoon".to_string());
        raw_prefs.insert("pref.sync.server_token".to_string(), "secret123".to_string());

        // Without token
        let include_false = false;
        let prefs_excluded: HashMap<String, String> = raw_prefs
            .clone()
            .into_iter()
            .filter(|(k, _)| include_false || !k.contains("token"))
            .collect();
        assert!(prefs_excluded.contains_key("pref.reader.mode"));
        assert!(!prefs_excluded.contains_key("pref.sync.server_token"));

        // With token
        let include_true = true;
        let prefs_included: HashMap<String, String> = raw_prefs
            .into_iter()
            .filter(|(k, _)| include_true || !k.contains("token"))
            .collect();
        assert!(prefs_included.contains_key("pref.reader.mode"));
        assert!(prefs_included.contains_key("pref.sync.server_token"));
    }

    #[test]
    fn test_cleanup_old_backups() {
        let temp_dir = std::env::temp_dir().join("shinitrack_test_backups_cleanup");
        let _ = std::fs::remove_dir_all(&temp_dir);
        let _ = std::fs::create_dir_all(&temp_dir);

        for i in 1..=7 {
            let file_name = format!("shinitrack_backup_20261006_00000{}.json", i);
            let file_path = temp_dir.join(&file_name);
            std::fs::write(&file_path, "{}").unwrap();
        }

        cleanup_old_backups(&temp_dir, 5);

        let remaining: Vec<_> = std::fs::read_dir(&temp_dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();

        assert_eq!(remaining.len(), 5);
        assert!(!remaining.contains(&"shinitrack_backup_20261006_000001.json".to_string()));
        assert!(!remaining.contains(&"shinitrack_backup_20261006_000002.json".to_string()));
        assert!(remaining.contains(&"shinitrack_backup_20261006_000007.json".to_string()));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}

