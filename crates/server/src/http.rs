//! HTTP API used by the app (Bearer-token auth, single user).

use std::sync::atomic::Ordering;

use axum::extract::{Query, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use shinitrack_core::models::ChapterEvent;
use shinitrack_core::store::Favorite;

use crate::notifier::UP_ENDPOINT_KEY;
use crate::poller::handle_event;
use crate::AppState;

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/favorites", get(list_favorites).put(put_favorites))
        .route("/v1/device", put(put_device))
        .route("/v1/events", get(get_events))
        .route("/v1/debug/fake-update", post(fake_update))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth));
    Router::new()
        .route("/healthz", get(healthz))
        .merge(protected)
        .with_state(state)
}

/// Error wrapper so handlers can use `?`.
pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl<E: std::fmt::Display> From<E> for ApiError {
    fn from(e: E) -> Self {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn auth(State(s): State<AppState>, req: Request, next: Next) -> Response {
    let ok = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| constant_time_eq(t.as_bytes(), s.cfg.token.as_bytes()));
    if ok {
        next.run(req).await
    } else {
        ApiError(StatusCode::UNAUTHORIZED, "invalid token".into()).into_response()
    }
}

async fn healthz(State(s): State<AppState>) -> Json<serde_json::Value> {
    let h = &s.health;
    let favorites = s
        .store
        .lock()
        .unwrap()
        .list_favorites()
        .map(|f| f.len())
        .unwrap_or(0);
    let last_ok = h.last_ok_unix.load(Ordering::Relaxed);
    Json(json!({
        "ok": true,
        "favorites": favorites,
        "polls_ok": h.polls_ok.load(Ordering::Relaxed),
        "polls_failed": h.polls_failed.load(Ordering::Relaxed),
        "events_sent": h.events_sent.load(Ordering::Relaxed),
        "seconds_since_last_ok_poll": if last_ok == 0 { None } else { Some(Utc::now().timestamp() - last_ok) },
        "last_error": h.last_error.lock().unwrap().clone(),
    }))
}

async fn list_favorites(State(s): State<AppState>) -> ApiResult<Json<Vec<Favorite>>> {
    Ok(Json(s.store.lock().unwrap().list_favorites()?))
}

async fn put_favorites(
    State(s): State<AppState>,
    Json(list): Json<Vec<Favorite>>,
) -> ApiResult<Json<serde_json::Value>> {
    let mut st = s.store.lock().unwrap();
    st.replace_favorites(&list)?;
    Ok(Json(json!({ "ok": true, "count": list.len() })))
}

#[derive(Deserialize)]
struct DeviceBody {
    /// UnifiedPush endpoint URL given to the app by the distributor (ntfy).
    /// `null` unregisters.
    unifiedpush_endpoint: Option<String>,
}

async fn put_device(
    State(s): State<AppState>,
    Json(body): Json<DeviceBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let st = s.store.lock().unwrap();
    match body.unifiedpush_endpoint.filter(|e| e.starts_with("https://") || e.starts_with("http://")) {
        Some(e) => st.kv_set(UP_ENDPOINT_KEY, &e)?,
        None => st.kv_set(UP_ENDPOINT_KEY, "")?,
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct EventsQuery {
    #[serde(default)]
    since: i64,
    #[serde(default = "default_limit")]
    limit: u32,
}

fn default_limit() -> u32 {
    100
}

async fn get_events(
    State(s): State<AppState>,
    Query(q): Query<EventsQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let st = s.store.lock().unwrap();
    let events = st.events_since(q.since, q.limit.min(500))?;
    let latest_id = st.max_event_id()?;
    Ok(Json(json!({ "events": events, "latest_id": latest_id })))
}

#[derive(Deserialize)]
struct FakeBody {
    manga_id: String,
}

/// Test hook: pretends the next chapter of a favorite was released. Does not
/// move the baseline, so the real next chapter still notifies normally.
async fn fake_update(
    State(s): State<AppState>,
    Json(body): Json<FakeBody>,
) -> ApiResult<Json<serde_json::Value>> {
    if !s.cfg.debug {
        return Err(ApiError(StatusCode::NOT_FOUND, "debug endpoints disabled".into()));
    }
    let fav = s
        .store
        .lock()
        .unwrap()
        .get_favorite(&body.manga_id)?
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "not a favorite".into()))?;
    let now = Utc::now();
    let ev = ChapterEvent {
        manga_id: fav.manga_id.clone(),
        title: fav.title.clone(),
        cover: fav.cover.clone(),
        chapter_id: format!("debug-{}-{}", fav.manga_id, now.timestamp_millis()),
        chapter_number: fav.last_ch_num.unwrap_or(0.0) + 1.0,
        released_at: Some(now),
    };
    // Send without touching the favorite's baseline.
    let id = s.store.lock().unwrap().insert_event(&ev)?;
    s.notifier.send_all(&ev).await;
    Ok(Json(json!({ "ok": true, "event_id": id, "event": ev })))
}

/// Re-export so integration tests can drive the same code path as the poller.
pub async fn inject_event(state: &AppState, ev: ChapterEvent) {
    handle_event(state, ev).await;
}
