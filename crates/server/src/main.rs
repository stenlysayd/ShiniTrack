use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use shinitrack_core::store::Store;
use shinitrack_core::ShinigamiClient;
use shinitrack_server::config::Config;
use shinitrack_server::notifier::{Fanout, Notifier, NtfyTopic, UnifiedPush};
use shinitrack_server::{http, poller, AppState, Health};
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,shinitrack_server=info")),
        )
        .init();

    let cfg_path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("config.toml"));
    let cfg = Config::load(&cfg_path)?;

    let store = Arc::new(Mutex::new(
        Store::open(&cfg.db_path).with_context(|| format!("open db {}", cfg.db_path.display()))?,
    ));
    let api = match &cfg.api_base {
        Some(b) => ShinigamiClient::with_base(b.clone())?,
        None => ShinigamiClient::new()?,
    };

    let push_http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let mut notifiers: Vec<Box<dyn Notifier>> =
        vec![Box::new(UnifiedPush::new(push_http.clone(), store.clone()))];
    if let Some(t) = NtfyTopic::from_config(push_http, &cfg.ntfy) {
        info!("ntfy topic notifier enabled");
        notifiers.push(Box::new(t));
    }

    let state = AppState {
        cfg: Arc::new(cfg.clone()),
        store,
        api,
        notifier: Arc::new(Fanout(notifiers)),
        health: Arc::new(Health::default()),
    };

    tokio::spawn(poller::run_poller(state.clone()));
    tokio::spawn(poller::run_reconciler(state.clone()));

    let listener = tokio::net::TcpListener::bind(&cfg.listen)
        .await
        .with_context(|| format!("bind {}", cfg.listen))?;
    info!(addr = %cfg.listen, debug = cfg.debug, "ShiniTrack server listening");
    axum::serve(listener, http::router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            info!("shutting down");
        })
        .await?;
    Ok(())
}
