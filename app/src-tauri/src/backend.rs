//! Platform-agnostic app logic shared by Tauri commands and the Android
//! background bridge (WorkManager / UnifiedPush receiver call into this via JNI
//! even when the UI has never been opened).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use shinitrack_core::detect::is_newer;
use shinitrack_core::models::ChapterEvent;
use shinitrack_core::store::{Favorite, StoredEvent, Store};
use shinitrack_core::ShinigamiClient;

pub const DB_FILE: &str = "shinitrack.db";
const KV_SERVER_URL: &str = "server_url";
const KV_SERVER_TOKEN: &str = "server_token";
const KV_LOW_QUALITY: &str = "low_quality";
const KV_LAST_SERVER_EVENT: &str = "last_server_event_id";
pub const KV_UP_ENDPOINT: &str = "unifiedpush_endpoint";

/// Set by the Android bridge before Tauri starts so the UI process and the
/// background workers use the very same database file.
static DATA_DIR_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

pub fn set_data_dir_override(p: PathBuf) {
    let _ = DATA_DIR_OVERRIDE.set(p);
}

pub fn data_dir_override() -> Option<PathBuf> {
    DATA_DIR_OVERRIDE.get().cloned()
}

const KV_GITHUB_REPO: &str = "github_repo";
const KV_AUTO_CHECK_UPDATE: &str = "auto_check_update";

pub fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILE)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub server_url: Option<String>,
    pub server_token: Option<String>,
    pub low_quality: bool,
    #[serde(default = "default_github_repo")]
    pub github_repo: Option<String>,
    #[serde(default = "default_true")]
    pub auto_check_update: bool,
}

fn default_github_repo() -> Option<String> {
    Some("stenlysayd/ShiniTrack".into())
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: None,
            server_token: None,
            low_quality: false,
            github_repo: default_github_repo(),
            auto_check_update: true,
        }
    }
}

pub fn load_settings(store: &Store) -> anyhow::Result<Settings> {
    let get = |k| store.kv_get(k).map(|v| v.filter(|s| !s.trim().is_empty()));
    let github_repo = match get(KV_GITHUB_REPO)? {
        Some(r) => Some(crate::updater::clean_github_repo(&r)),
        None => default_github_repo(),
    };
    let auto_check_update = match get(KV_AUTO_CHECK_UPDATE)? {
        Some(v) => v == "1",
        None => true,
    };
    Ok(Settings {
        server_url: get(KV_SERVER_URL)?,
        server_token: get(KV_SERVER_TOKEN)?,
        low_quality: get(KV_LOW_QUALITY)?.as_deref() == Some("1"),
        github_repo,
        auto_check_update,
    })
}

pub fn save_settings(store: &Store, s: &Settings) -> anyhow::Result<()> {
    store.kv_set(KV_SERVER_URL, s.server_url.as_deref().unwrap_or("").trim())?;
    store.kv_set(KV_SERVER_TOKEN, s.server_token.as_deref().unwrap_or("").trim())?;
    store.kv_set(KV_LOW_QUALITY, if s.low_quality { "1" } else { "0" })?;
    let repo_clean = crate::updater::clean_github_repo(s.github_repo.as_deref().unwrap_or("stenlysayd/ShiniTrack"));
    store.kv_set(KV_GITHUB_REPO, &repo_clean)?;
    store.kv_set(KV_AUTO_CHECK_UPDATE, if s.auto_check_update { "1" } else { "0" })?;
    Ok(())
}

/// A notification to show. Kotlin and the Tauri notification plugin both
/// consume this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notice {
    pub id: i32,
    pub manga_id: String,
    pub title: String,
    pub text: String,
    pub cover: Option<String>,
}

impl From<&ChapterEvent> for Notice {
    fn from(ev: &ChapterEvent) -> Self {
        // Stable id per chapter so a duplicate delivery replaces, not stacks.
        let id = ev
            .chapter_id
            .bytes()
            .fold(17i32, |h, b| h.wrapping_mul(31).wrapping_add(b as i32));
        Self {
            id,
            manga_id: ev.manga_id.clone(),
            title: ev.title.clone(),
            text: format!("Chapter {} is out! Tap to read.", ev.chapter_label()),
            cover: ev.cover.clone(),
        }
    }
}

fn is_debug_event(ev: &ChapterEvent) -> bool {
    ev.chapter_id.starts_with("debug-")
}

/// Records an event locally. Returns a notice only if it is new AND the series
/// is a favorite with notifications on.
pub fn accept_event(store: &Store, ev: &ChapterEvent) -> anyhow::Result<Option<Notice>> {
    let Some(fav) = store.get_favorite(&ev.manga_id)? else {
        return Ok(None);
    };
    if !fav.notify {
        return Ok(None);
    }
    let inserted = store.insert_event(ev)?.is_some();
    if !is_debug_event(ev) {
        store.update_last_seen(ev)?;
    }
    Ok(inserted.then(|| Notice::from(ev)))
}

// ------------------------------------------------------------------ server API

pub struct ServerClient {
    http: reqwest::Client,
    base: String,
    token: String,
}

#[derive(Deserialize)]
struct EventsResponse {
    events: Vec<StoredEvent>,
    latest_id: i64,
}

impl ServerClient {
    pub fn from_settings(s: &Settings) -> Option<Self> {
        let base = s.server_url.as_ref()?.trim().trim_end_matches('/').to_string();
        let token = s.server_token.clone()?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .ok()?;
        Some(Self { http, base, token })
    }

    pub async fn put_favorites(&self, favs: &[Favorite]) -> anyhow::Result<()> {
        self.http
            .put(format!("{}/v1/favorites", self.base))
            .bearer_auth(&self.token)
            .json(favs)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn put_device(&self, endpoint: Option<&str>) -> anyhow::Result<()> {
        self.http
            .put(format!("{}/v1/device", self.base))
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "unifiedpush_endpoint": endpoint }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn events_since(&self, since: i64) -> anyhow::Result<(Vec<StoredEvent>, i64)> {
        let r: EventsResponse = self
            .http
            .get(format!("{}/v1/events", self.base))
            .bearer_auth(&self.token)
            .query(&[("since", since)])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok((r.events, r.latest_id))
    }

    pub async fn health(&self) -> anyhow::Result<serde_json::Value> {
        Ok(self
            .http
            .get(format!("{}/healthz", self.base))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
}

// --------------------------------------------------------- background routines

/// Pulls events the server recorded while we were offline.
pub async fn server_catch_up(store: &Store) -> anyhow::Result<Vec<Notice>> {
    let settings = load_settings(store)?;
    let Some(sc) = ServerClient::from_settings(&settings) else {
        return Ok(vec![]);
    };
    let since: i64 = store
        .kv_get(KV_LAST_SERVER_EVENT)?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let (events, latest) = sc.events_since(since).await.context("server /v1/events")?;
    let mut notices = Vec::new();
    for e in &events {
        if let Some(n) = accept_event(store, &e.event)? {
            notices.push(n);
        }
    }
    let new_since = events.iter().map(|e| e.id).max().unwrap_or(since).max(since);
    // If the server DB was reset, latest_id < since: start over from its latest.
    let new_since = if latest < since { latest } else { new_since };
    store.kv_set(KV_LAST_SERVER_EVENT, &new_since.to_string())?;
    Ok(notices)
}

/// Directly asks Shinigami about each notify-enabled favorite. Works without
/// the server, so notifications still arrive (≤ 15 min late) if it is down.
pub async fn direct_check(store: &Store, api: &ShinigamiClient) -> anyhow::Result<Vec<Notice>> {
    let mut notices = Vec::new();
    for (id, seen) in store.notify_baselines()? {
        match api.detail(&id).await {
            Ok(m) if is_newer(&m, &seen) => {
                if let Some(ev) = ChapterEvent::from_manga(&m) {
                    if let Some(n) = accept_event(store, &ev)? {
                        notices.push(n);
                    }
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("direct check {id} failed: {e}"),
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    Ok(notices)
}

/// WorkManager entry point: server catch-up first, then direct check.
pub async fn background_check(dir: &Path) -> anyhow::Result<Vec<Notice>> {
    let store = Store::open(db_path(dir))?;
    let mut notices = match server_catch_up(&store).await {
        Ok(n) => n,
        Err(e) => {
            log::warn!("server catch-up failed: {e:#}");
            vec![]
        }
    };
    let api = ShinigamiClient::new()?;
    notices.extend(direct_check(&store, &api).await?);

    // Automatic backup is handled exclusively by Android WorkManager (BackupWorker) to prevent duplicate schedulers.

    Ok(notices)
}

/// UnifiedPush message entry point. Payload: `{"type":"chapter","event":{...}}`.
pub fn handle_push(dir: &Path, payload: &[u8]) -> anyhow::Result<Vec<Notice>> {
    #[derive(Deserialize)]
    struct Msg {
        #[serde(rename = "type")]
        kind: String,
        event: Option<ChapterEvent>,
    }
    let msg: Msg = serde_json::from_slice(payload).context("bad push payload")?;
    if msg.kind != "chapter" {
        return Ok(vec![]);
    }
    let Some(ev) = msg.event else { return Ok(vec![]) };
    let store = Store::open(db_path(dir))?;
    Ok(accept_event(&store, &ev)?.into_iter().collect())
}

/// Stores the UnifiedPush endpoint and forwards it to the server.
pub async fn register_endpoint(dir: &Path, endpoint: Option<String>) -> anyhow::Result<()> {
    let store = Store::open(db_path(dir))?;
    store.kv_set(KV_UP_ENDPOINT, endpoint.as_deref().unwrap_or(""))?;
    if let Some(sc) = ServerClient::from_settings(&load_settings(&store)?) {
        sc.put_device(endpoint.as_deref()).await?;
    }
    Ok(())
}

/// Builds a small runtime for blocking JNI calls (no Tauri runtime there).
pub fn block_on<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
        .block_on(f)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn ev(id: &str, num: f64, chapter_id: &str) -> ChapterEvent {
        ChapterEvent {
            manga_id: id.into(),
            title: "T".into(),
            cover: None,
            chapter_id: chapter_id.into(),
            chapter_number: num,
            released_at: Some(Utc::now()),
        }
    }

    fn fav(id: &str, notify: bool) -> Favorite {
        Favorite {
            manga_id: id.into(),
            title: "T".into(),
            cover: None,
            last_ch_id: None,
            last_ch_num: Some(10.0),
            last_ch_time: None,
            notify,
            added_at: Utc::now(),
        }
    }

    #[test]
    fn push_for_non_favorite_or_muted_is_dropped_and_duplicates_are_silent() {
        let s = Store::open_in_memory().unwrap();
        s.upsert_favorite(&fav("on", true)).unwrap();
        s.upsert_favorite(&fav("muted", false)).unwrap();
        assert!(accept_event(&s, &ev("stranger", 1.0, "x1")).unwrap().is_none());
        assert!(accept_event(&s, &ev("muted", 11.0, "m11")).unwrap().is_none());
        assert!(accept_event(&s, &ev("on", 11.0, "o11")).unwrap().is_some());
        assert!(accept_event(&s, &ev("on", 11.0, "o11")).unwrap().is_none());
    }

    #[test]
    fn debug_events_do_not_move_the_baseline() {
        let s = Store::open_in_memory().unwrap();
        s.upsert_favorite(&fav("on", true)).unwrap();
        accept_event(&s, &ev("on", 11.0, "debug-on-1")).unwrap();
        assert_eq!(s.get_favorite("on").unwrap().unwrap().last_ch_num, Some(10.0));
    }

    #[test]
    fn handle_push_parses_server_payload() {
        let dir = std::env::temp_dir().join(format!("shinitrack-test-{}", std::process::id()));
        let s = Store::open(db_path(&dir)).unwrap();
        s.upsert_favorite(&fav("on", true)).unwrap();
        let payload = serde_json::to_vec(&serde_json::json!({
            "type": "chapter", "event": ev("on", 12.0, "o12")
        }))
        .unwrap();
        let n = handle_push(&dir, &payload).unwrap();
        assert_eq!(n.len(), 1);
        assert!(n[0].text.contains("12"));
        drop(s);
        let _ = std::fs::remove_dir_all(dir);
    }
}
