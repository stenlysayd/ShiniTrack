//! The ~1 s poll loop + a slower reconciliation loop.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use shinitrack_core::detect::{diff, is_newer};
use shinitrack_core::models::ChapterEvent;
use shinitrack_core::Error;
use tracing::{debug, error, info, warn};

use crate::AppState;

/// Exponential back-off: 0 → 2 s → 4 s → … → 60 s on consecutive failures.
#[derive(Debug, Default)]
pub struct Backoff {
    failures: u32,
}

impl Backoff {
    pub fn reset(&mut self) {
        self.failures = 0;
    }

    pub fn fail(&mut self, e: &Error) {
        // Rate limits / 5xx escalate faster than other errors.
        self.failures += if e.should_back_off() { 2 } else { 1 };
    }

    pub fn delay(&self) -> Duration {
        if self.failures == 0 {
            Duration::ZERO
        } else {
            Duration::from_secs((1u64 << self.failures.min(6)).min(60))
        }
    }
}

fn jitter(max_ms: u64) -> Duration {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    Duration::from_millis(nanos % max_ms.max(1))
}

/// Records the event (deduplicated), advances the baseline, and pushes it if new.
pub async fn handle_event(state: &AppState, ev: ChapterEvent) {
    let inserted = {
        let s = state.store.lock().unwrap();
        let r = s.insert_event(&ev);
        if let Err(e) = s.update_last_seen(&ev) {
            error!(error = %e, "failed to update baseline");
        }
        r
    };
    match inserted {
        Ok(Some(id)) => {
            info!(id, manga = %ev.title, chapter = %ev.chapter_label(), "new chapter for favorite");
            state.notifier.send_all(&ev).await;
            state
                .health
                .events_sent
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        Ok(None) => debug!(chapter_id = %ev.chapter_id, "event already known"),
        Err(e) => error!(error = %e, "failed to store event"),
    }
}

/// One poll tick. Returns the number of favorite updates found, or `Ok(None)`
/// when there are no notify-enabled favorites (nothing was requested).
pub async fn poll_once(state: &AppState) -> Result<Option<usize>, Error> {
    let baselines = state.store.lock().unwrap().notify_baselines()?;
    if baselines.is_empty() {
        return Ok(None);
    }
    let feed = state.api.latest_feed(state.cfg.feed_size).await?;
    let events = diff(&feed, &baselines);
    let n = events.len();
    for ev in events {
        handle_event(state, ev).await;
    }
    Ok(Some(n))
}

/// Main loop: one `/manga/list?sort=latest` request per tick.
pub async fn run_poller(state: AppState) {
    let base = Duration::from_millis(state.cfg.poll_interval_ms);
    let mut backoff = Backoff::default();
    info!(interval_ms = state.cfg.poll_interval_ms, "poller started");
    loop {
        match poll_once(&state).await {
            Ok(None) => {
                // Nothing to watch: idle cheaply until favorites are synced.
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
            Ok(Some(_)) => {
                state.health.mark_ok();
                backoff.reset();
            }
            Err(e) => {
                backoff.fail(&e);
                warn!(error = %e, retry_in = ?backoff.delay(), "feed poll failed");
                state.health.mark_err(e.to_string());
            }
        }
        tokio::time::sleep(base + jitter(300) + backoff.delay()).await;
    }
}

/// Safety net for anything the feed missed (e.g. > `feed_size` series updated
/// within one tick, or downtime): checks each favorite's detail page.
pub async fn run_reconciler(state: AppState) {
    let every = Duration::from_secs(state.cfg.reconcile_minutes.max(1) * 60);
    loop {
        tokio::time::sleep(every).await;
        let baselines = match state.store.lock().unwrap().notify_baselines() {
            Ok(b) => b,
            Err(e) => {
                error!(error = %e, "cannot read favorites");
                continue;
            }
        };
        debug!(count = baselines.len(), "reconciling favorites");
        for (id, seen) in baselines {
            match state.api.detail(&id).await {
                Ok(m) if is_newer(&m, &seen) => {
                    if let Some(ev) = ChapterEvent::from_manga(&m) {
                        handle_event(&state, ev).await;
                    }
                }
                Ok(_) => {}
                Err(e) => warn!(manga_id = %id, error = %e, "reconcile detail failed"),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_and_caps() {
        let mut b = Backoff::default();
        assert_eq!(b.delay(), Duration::ZERO);
        b.fail(&Error::Empty);
        assert_eq!(b.delay(), Duration::from_secs(2));
        b.fail(&Error::Status(429)); // +2
        assert_eq!(b.delay(), Duration::from_secs(8));
        for _ in 0..10 {
            b.fail(&Error::Status(503));
        }
        assert_eq!(b.delay(), Duration::from_secs(60));
        b.reset();
        assert_eq!(b.delay(), Duration::ZERO);
    }
}
