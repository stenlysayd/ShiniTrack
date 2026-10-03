//! ShiniTrack server library (the binary in `main.rs` is a thin wrapper so the
//! poller and HTTP API are testable).

pub mod config;
pub mod http;
pub mod notifier;
pub mod poller;

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use shinitrack_core::store::Store;
use shinitrack_core::ShinigamiClient;

use crate::config::Config;
use crate::notifier::Fanout;

#[derive(Default)]
pub struct Health {
    pub polls_ok: AtomicU64,
    pub polls_failed: AtomicU64,
    pub last_ok_unix: AtomicI64,
    pub events_sent: AtomicU64,
    pub last_error: Mutex<Option<String>>,
}

impl Health {
    pub fn mark_ok(&self) {
        self.polls_ok.fetch_add(1, Ordering::Relaxed);
        self.last_ok_unix.store(Utc::now().timestamp(), Ordering::Relaxed);
    }

    pub fn mark_err(&self, e: String) {
        self.polls_failed.fetch_add(1, Ordering::Relaxed);
        *self.last_error.lock().unwrap() = Some(e);
    }
}

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub store: Arc<Mutex<Store>>,
    pub api: ShinigamiClient,
    pub notifier: Arc<Fanout>,
    pub health: Arc<Health>,
}
