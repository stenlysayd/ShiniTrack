//! Push delivery. Every notifier receives every event; failures are logged and
//! never stop the poller (the app can always catch up via `/v1/events`).

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use serde_json::json;
use shinitrack_core::models::ChapterEvent;
use shinitrack_core::store::Store;
use tracing::{debug, warn};

use crate::config::NtfyConfig;

pub type BoxFut<'a> = Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + 'a>>;

pub trait Notifier: Send + Sync {
    fn name(&self) -> &'static str;
    fn send<'a>(&'a self, ev: &'a ChapterEvent) -> BoxFut<'a>;
}

/// Key in the `kv` table where the app's UnifiedPush endpoint is stored.
pub const UP_ENDPOINT_KEY: &str = "unifiedpush_endpoint";

/// UnifiedPush: POST the raw event JSON to the endpoint the app registered.
/// The distributor (ntfy app) hands it to ShiniTrack, which shows its own
/// notification. ntfy caches the message while the phone is offline.
pub struct UnifiedPush {
    http: reqwest::Client,
    store: Arc<Mutex<Store>>,
}

impl UnifiedPush {
    pub fn new(http: reqwest::Client, store: Arc<Mutex<Store>>) -> Self {
        Self { http, store }
    }
}

impl Notifier for UnifiedPush {
    fn name(&self) -> &'static str {
        "unifiedpush"
    }

    fn send<'a>(&'a self, ev: &'a ChapterEvent) -> BoxFut<'a> {
        Box::pin(async move {
            let endpoint = {
                let s = self.store.lock().unwrap();
                s.kv_get(UP_ENDPOINT_KEY)?
            };
            let Some(endpoint) = endpoint else {
                debug!("no UnifiedPush endpoint registered yet");
                return Ok(());
            };
            let body = serde_json::to_vec(&json!({ "type": "chapter", "event": ev }))?;
            self.http
                .post(&endpoint)
                .header("Content-Type", "application/json")
                // RFC 8030 (WebPush) headers understood by ntfy's UnifiedPush gateway.
                .header("TTL", "2419200")
                .header("Urgency", "high")
                .body(body)
                .send()
                .await?
                .error_for_status()
                .context("UnifiedPush endpoint rejected the message")?;
            Ok(())
        })
    }
}

/// Plain ntfy topic via the JSON publish API (handles non-ASCII titles).
pub struct NtfyTopic {
    http: reqwest::Client,
    server: String,
    topic: String,
    auth: Option<String>,
}

impl NtfyTopic {
    pub fn from_config(http: reqwest::Client, cfg: &NtfyConfig) -> Option<Self> {
        Some(Self {
            http,
            server: cfg.server.clone()?.trim_end_matches('/').to_string(),
            topic: cfg.topic.clone()?,
            auth: cfg.auth_token.clone(),
        })
    }
}

impl Notifier for NtfyTopic {
    fn name(&self) -> &'static str {
        "ntfy-topic"
    }

    fn send<'a>(&'a self, ev: &'a ChapterEvent) -> BoxFut<'a> {
        Box::pin(async move {
            let mut body = json!({
                "topic": self.topic,
                "title": ev.title,
                "message": format!("Chapter {} is out! Tap to read.", ev.chapter_label()),
                "tags": ["books"],
                "priority": 4,
                "click": format!("shinitrack://manga/{}", ev.manga_id),
            });
            if let Some(c) = &ev.cover {
                body["icon"] = json!(c);
            }
            let mut req = self.http.post(&self.server).json(&body);
            if let Some(t) = &self.auth {
                req = req.bearer_auth(t);
            }
            req.send()
                .await?
                .error_for_status()
                .context("ntfy rejected the message")?;
            Ok(())
        })
    }
}

/// Sends to every configured notifier, one after another (there are at most a
/// couple, and each has its own HTTP timeout).
pub struct Fanout(pub Vec<Box<dyn Notifier>>);

impl Fanout {
    pub async fn send_all(&self, ev: &ChapterEvent) {
        for n in &self.0 {
            if let Err(e) = n.send(ev).await {
                warn!(notifier = n.name(), error = %e, "push failed");
            }
        }
    }
}
