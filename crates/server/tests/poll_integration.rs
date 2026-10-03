//! End-to-end poll tick against a mock Shinigami API: only the favorite with
//! notifications enabled may produce a push.

use std::sync::{Arc, Mutex};

use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use shinitrack_core::models::ChapterEvent;
use shinitrack_core::store::{Favorite, Store};
use shinitrack_core::ShinigamiClient;
use shinitrack_server::config::{Config, NtfyConfig};
use shinitrack_server::notifier::{BoxFut, Fanout, Notifier};
use shinitrack_server::{poller, AppState, Health};

struct Recorder(Arc<Mutex<Vec<ChapterEvent>>>);

impl Notifier for Recorder {
    fn name(&self) -> &'static str {
        "recorder"
    }
    fn send<'a>(&'a self, ev: &'a ChapterEvent) -> BoxFut<'a> {
        Box::pin(async move {
            self.0.lock().unwrap().push(ev.clone());
            Ok(())
        })
    }
}

fn entry(id: &str, num: f64, time: &str) -> serde_json::Value {
    json!({
        "manga_id": id, "title": format!("Title {id}"),
        "latest_chapter_id": format!("{id}-{num}"),
        "latest_chapter_number": num,
        "latest_chapter_time": time,
        "cover_portrait_url": "https://img/x.jpg"
    })
}

async fn mock_api() -> String {
    let feed = json!({
        "retcode": 0, "message": "success",
        "meta": { "page": 1, "page_size": 30, "total_page": 1, "total_record": 3 },
        "data": [
            entry("fav-on", 11.0, "2026-10-03T05:00:00Z"),   // favorite, notify on, NEW
            entry("fav-off", 21.0, "2026-10-03T04:00:00Z"),  // favorite, notify OFF
            entry("stranger", 99.0, "2026-10-03T03:00:00Z")  // not a favorite
        ]
    });
    let app = Router::new().route("/v1/manga/list", get(move || async move { Json(feed) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}/v1")
}

fn fav(id: &str, num: f64, notify: bool) -> Favorite {
    Favorite {
        manga_id: id.into(),
        title: format!("Title {id}"),
        cover: None,
        last_ch_id: Some(format!("{id}-{num}")),
        last_ch_num: Some(num),
        last_ch_time: Some("2026-10-01T00:00:00Z".parse().unwrap()),
        notify,
        added_at: chrono::Utc::now(),
    }
}

#[tokio::test]
async fn only_notify_enabled_favorites_are_pushed_once() {
    let base = mock_api().await;
    let store = Store::open_in_memory().unwrap();
    store.upsert_favorite(&fav("fav-on", 10.0, true)).unwrap();
    store.upsert_favorite(&fav("fav-off", 20.0, false)).unwrap();

    let sent = Arc::new(Mutex::new(Vec::new()));
    let state = AppState {
        cfg: Arc::new(Config {
            listen: "127.0.0.1:0".into(),
            token: "x".repeat(32),
            db_path: ":memory:".into(),
            poll_interval_ms: 1000,
            feed_size: 30,
            reconcile_minutes: 10,
            debug: false,
            api_base: Some(base.clone()),
            ntfy: NtfyConfig::default(),
        }),
        store: Arc::new(Mutex::new(store)),
        api: ShinigamiClient::with_base(base).unwrap(),
        notifier: Arc::new(Fanout(vec![Box::new(Recorder(sent.clone()))])),
        health: Arc::new(Health::default()),
    };

    // First tick: exactly one push, for fav-on ch 11.
    assert_eq!(poller::poll_once(&state).await.unwrap(), Some(1));
    {
        let sent = sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].manga_id, "fav-on");
        assert_eq!(sent[0].chapter_label(), "11");
    }

    // Second tick with the same feed: baseline advanced → no duplicate push.
    assert_eq!(poller::poll_once(&state).await.unwrap(), Some(0));
    assert_eq!(sent.lock().unwrap().len(), 1);

    // The event is queued for the app's /v1/events catch-up.
    let events = state.store.lock().unwrap().events_since(0, 10).unwrap();
    assert_eq!(events.len(), 1);
}
