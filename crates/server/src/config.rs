use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// Address the HTTP API listens on.
    #[serde(default = "d_listen")]
    pub listen: String,
    /// Shared secret the app sends as `Authorization: Bearer <token>`.
    pub token: String,
    #[serde(default = "d_db")]
    pub db_path: PathBuf,
    /// Base delay between feed polls (jitter + back-off are added on top).
    #[serde(default = "d_interval")]
    pub poll_interval_ms: u64,
    /// How many of the most recently updated series to fetch per poll.
    #[serde(default = "d_feed")]
    pub feed_size: u32,
    /// Safety net: re-check every favorite via `/manga/detail` this often.
    #[serde(default = "d_reconcile")]
    pub reconcile_minutes: u64,
    /// Enables `POST /v1/debug/fake-update`. Keep `false` in production.
    #[serde(default)]
    pub debug: bool,
    #[serde(default)]
    pub api_base: Option<String>,
    #[serde(default)]
    pub ntfy: NtfyConfig,
}

/// Optional plain ntfy topic (human readable notification, works with just the
/// ntfy app installed). UnifiedPush endpoints are registered by the app at
/// runtime via `PUT /v1/device` and need no config here.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct NtfyConfig {
    /// e.g. `https://ntfy.example.com` (self-hosted) or `https://ntfy.sh`
    pub server: Option<String>,
    /// e.g. `shinitrack-7f3a9c` – pick something unguessable.
    pub topic: Option<String>,
    /// Access token if the ntfy server requires auth.
    pub auth_token: Option<String>,
}

fn d_listen() -> String {
    "0.0.0.0:8787".into()
}
fn d_db() -> PathBuf {
    "shinitrack-server.db".into()
}
fn d_interval() -> u64 {
    1000
}
fn d_feed() -> u32 {
    30
}
fn d_reconcile() -> u64 {
    10
}

impl Config {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("cannot read config file {}", path.display()))?;
        let mut cfg: Config = toml::from_str(&raw).context("invalid config.toml")?;
        if let Ok(t) = std::env::var("SHINITRACK_TOKEN") {
            cfg.token = t;
        }
        cfg.validate()?;
        Ok(cfg)
    }

    pub fn validate(&self) -> anyhow::Result<()> {
        if self.token.len() < 16 || self.token == "change-me-to-a-long-random-string" {
            bail!("`token` must be set to a random string of at least 16 characters");
        }
        if self.poll_interval_ms < 250 {
            bail!("`poll_interval_ms` below 250 ms is not allowed (be nice to the API)");
        }
        if !(1..=100).contains(&self.feed_size) {
            bail!("`feed_size` must be between 1 and 100");
        }
        Ok(())
    }
}
