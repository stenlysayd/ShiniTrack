//! `#[tauri::command]`s called from the UI.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{Duration, Local, NaiveDate, Utc};
use serde::Serialize;
use shinitrack_core::models::{ChapterDetail, ChapterItem, Manga, Meta};
use shinitrack_core::predict::{predict, Prediction};
use shinitrack_core::store::{Favorite, StoredEvent, Store};
use shinitrack_core::ShinigamiClient;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_notification::NotificationExt;

use crate::backend::{self, Notice, ServerClient, Settings};

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
pub async fn test_notification<R: Runtime>(app: AppHandle<R>) -> CmdResult<()> {
    show_notices(
        &app,
        &[Notice {
            id: 9999,
            manga_id: "solo-leveling-ragnarok".into(),
            title: "Solo Leveling: Ragnarok".into(),
            text: "Chapter 35 telah rilis! Ketuk untuk membaca langsung.".into(),
            cover: Some("https://shinigami.asia/media/covers/solo-leveling-ragnarok.jpg".into()),
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
    if let Some(d) = detail {
        return Ok(ReaderChapter {
            chapter_id: d.chapter_id.clone(),
            manga_id: d.manga_id.clone(),
            chapter_number: d.chapter_number,
            pages: d.chapter.data.clone(),
            prev_chapter_id: d.prev_chapter_id.clone(),
            next_chapter_id: d.next_chapter_id.clone(),
            offline: dl.is_some(),
        });
    }
    // Offline: list files from the download directory.
    let d = dl.expect("checked above");
    let mut pages: Vec<String> = std::fs::read_dir(&d.dir)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !n.ends_with(".part"))
        .collect();
    pages.sort();
    Ok(ReaderChapter {
        chapter_id: d.chapter_id,
        manga_id: d.manga_id,
        chapter_number: d.chapter_number,
        pages,
        prev_chapter_id: None,
        next_chapter_id: None,
        offline: true,
    })
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
    crate::updater::check_github_release(&repo_to_use, crate::updater::CURRENT_APP_VERSION)
        .await
        .map_err(err)
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
) -> CmdResult<()> {
    ctx.store
        .lock()
        .unwrap()
        .save_reading_progress(&manga_id, &chapter_id, chapter_number, last_page)
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
    ctx.store
        .lock()
        .unwrap()
        .mark_chapter_read(&manga_id, &chapter_id, chapter_number, read)
        .map_err(err)
}

#[tauri::command]
pub fn mark_chapters_batch(
    ctx: State<'_, AppCtx>,
    manga_id: String,
    chapters: Vec<(String, f64)>,
    read: bool,
) -> CmdResult<()> {
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

/// Used by `lib.rs` when the app is opened from a notification / resumed.
pub fn ctx<R: Runtime>(app: &AppHandle<R>) -> State<'_, AppCtx> {
    app.state::<AppCtx>()
}
