//! Release prediction from chapter history.
//!
//! 1. Group "batch" uploads (chapters released < 6 h apart = one release event).
//! 2. Median interval between events + MAD for spread.
//! 3. Weekday histogram in the user's timezone. If one weekday dominates (≥ 60 %)
//!    and the cadence is roughly weekly, snap the prediction to that weekday/hour.
//! 4. Confidence = how regular the intervals are, scaled by the amount of data.

use chrono::{DateTime, Datelike, Duration, TimeZone, Timelike, Utc, Weekday};
use serde::Serialize;

pub const BATCH_GAP_HOURS: i64 = 6;
pub const MAX_EVENTS: usize = 16;
pub const MIN_EVENTS: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Pattern {
    /// Releases cluster on one weekday around `hour` (local time).
    Weekly { weekday: u32, hour: u32 },
    /// No weekday dominance; regular-ish interval.
    Interval { days: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLabel {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize)]
pub struct Prediction {
    /// Best guess for the next release (UTC; UI converts to local).
    pub next_at: DateTime<Utc>,
    /// ± uncertainty window around `next_at`.
    pub window_hours: u32,
    pub pattern: Pattern,
    /// 0.0 – 1.0
    pub confidence: f32,
    pub label: ConfidenceLabel,
    pub last_release: DateTime<Utc>,
    pub median_interval_hours: f64,
    pub events_used: usize,
    /// `now` is already past `next_at + window`.
    pub overdue: bool,
    /// No release for > 2.5 × the usual interval (and > 3 days).
    pub likely_hiatus: bool,
}

/// Collapse releases closer than `gap` into one event (keeps the first time).
pub fn group_releases(times: &[DateTime<Utc>], gap: Duration) -> Vec<DateTime<Utc>> {
    let mut sorted = times.to_vec();
    sorted.sort();
    sorted.dedup();
    let mut out: Vec<DateTime<Utc>> = Vec::new();
    let mut group_last: Option<DateTime<Utc>> = None;
    for t in sorted {
        match group_last {
            Some(prev) if t - prev < gap => {}
            _ => out.push(t),
        }
        group_last = Some(t);
    }
    out
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

fn weekday_from_index(i: u32) -> Weekday {
    // 0 = Monday … 6 = Sunday
    [
        Weekday::Mon,
        Weekday::Tue,
        Weekday::Wed,
        Weekday::Thu,
        Weekday::Fri,
        Weekday::Sat,
        Weekday::Sun,
    ][(i % 7) as usize]
}

/// Next `weekday` at `hour:00` local time strictly after `after + min_gap`.
fn next_weekly_slot<Tz: TimeZone>(
    tz: &Tz,
    after: DateTime<Utc>,
    weekday: Weekday,
    hour: u32,
    min_gap: Duration,
) -> DateTime<Utc> {
    let threshold = after + min_gap;
    let start = after.with_timezone(tz).date_naive();
    for d in 0..21 {
        let day = start + Duration::days(d);
        if day.weekday() != weekday {
            continue;
        }
        let Some(naive) = day.and_hms_opt(hour, 0, 0) else { continue };
        if let Some(local) = tz.from_local_datetime(&naive).earliest() {
            let utc = local.with_timezone(&Utc);
            if utc > threshold {
                return utc;
            }
        }
    }
    after + Duration::days(7)
}

/// Predict the next release.
///
/// * `release_times` – `release_date` of recent chapters (any order, may contain batches)
/// * `tz`            – the user's timezone (weekday/hour are computed in it)
/// * `now`           – injected for testability
///
/// Returns `None` when there are fewer than [`MIN_EVENTS`] release events.
pub fn predict<Tz: TimeZone>(
    release_times: &[DateTime<Utc>],
    tz: &Tz,
    now: DateTime<Utc>,
) -> Option<Prediction> {
    let mut events = group_releases(release_times, Duration::hours(BATCH_GAP_HOURS));
    if events.len() > MAX_EVENTS {
        events.drain(..events.len() - MAX_EVENTS);
    }
    if events.len() < MIN_EVENTS {
        return None;
    }
    let last = *events.last().unwrap();

    let intervals: Vec<f64> = events
        .windows(2)
        .map(|w| (w[1] - w[0]).num_seconds() as f64 / 3600.0)
        .collect();
    let med = median(&mut intervals.clone()).max(1.0);
    let mut dev: Vec<f64> = intervals.iter().map(|i| (i - med).abs()).collect();
    let mad = median(&mut dev);
    let regular = intervals.iter().filter(|i| (*i - med).abs() <= 0.2 * med).count() as f32
        / intervals.len() as f32;

    // Weekday / hour histograms in local time.
    let mut wd_count = [0u32; 7];
    let mut hours_by_wd: [Vec<u32>; 7] = Default::default();
    for e in &events {
        let local = e.with_timezone(tz);
        let wd = local.weekday().num_days_from_monday() as usize;
        wd_count[wd] += 1;
        hours_by_wd[wd].push(local.hour());
    }
    let (best_wd, best_cnt) = wd_count
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| **c)
        .map(|(i, c)| (i as u32, *c))
        .unwrap();
    let wd_share = best_cnt as f32 / events.len() as f32;
    let weekly_cadence = (4.5 * 24.0..=10.0 * 24.0).contains(&med);

    let (pattern, next_at, shape_score) = if wd_share >= 0.6 && weekly_cadence {
        let mut hs: Vec<f64> = hours_by_wd[best_wd as usize].iter().map(|h| *h as f64).collect();
        let hour = median(&mut hs).round() as u32 % 24;
        let next = next_weekly_slot(tz, last, weekday_from_index(best_wd), hour, Duration::hours(24));
        (Pattern::Weekly { weekday: best_wd, hour }, next, wd_share)
    } else {
        let next = last + Duration::seconds((med * 3600.0) as i64);
        (Pattern::Interval { days: (med / 24.0 * 10.0).round() / 10.0 }, next, regular)
    };

    let data_factor = (events.len() as f32 / 6.0).min(1.0);
    let confidence = ((0.6 * regular + 0.4 * shape_score) * data_factor).clamp(0.0, 1.0);
    let label = match confidence {
        c if c >= 0.7 => ConfidenceLabel::High,
        c if c >= 0.4 => ConfidenceLabel::Medium,
        _ => ConfidenceLabel::Low,
    };
    let window_hours = (mad * 1.5).round().clamp(2.0, 72.0) as u32;

    // Roll weekly predictions forward so the schedule always shows an upcoming slot.
    let mut next_at = next_at;
    let window = Duration::hours(window_hours as i64);
    let overdue = now > next_at + window;
    if overdue {
        if let Pattern::Weekly { weekday, hour } = pattern {
            next_at = next_weekly_slot(tz, now - window, weekday_from_index(weekday), hour, Duration::zero());
        }
    }
    let since_last_h = (now - last).num_seconds() as f64 / 3600.0;
    let likely_hiatus = since_last_h > 2.5 * med && since_last_h > 72.0;

    Some(Prediction {
        next_at,
        window_hours,
        pattern,
        confidence,
        label,
        last_release: last,
        median_interval_hours: (med * 10.0).round() / 10.0,
        events_used: events.len(),
        overdue,
        likely_hiatus,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn wita() -> FixedOffset {
        FixedOffset::east_opt(8 * 3600).unwrap()
    }

    /// Local (UTC+8) date-time → UTC.
    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        wita()
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn batch_uploads_are_grouped() {
        // ch56 & ch57 were uploaded 9 minutes apart on Shinigami.
        let t = vec![at(2026, 10, 3, 10, 7), at(2026, 10, 3, 10, 16), at(2026, 9, 26, 10, 0)];
        let g = group_releases(&t, Duration::hours(6));
        assert_eq!(g, vec![at(2026, 9, 26, 10, 0), at(2026, 10, 3, 10, 7)]);
    }

    #[test]
    fn weekly_saturday_series_predicts_next_saturday() {
        // Every Saturday ~19:00 local for 8 weeks (+ a batch double-release).
        let mut t: Vec<_> = (0..8)
            .map(|w| at(2026, 8, 15, 19, 5) + Duration::weeks(w))
            .collect();
        t.push(at(2026, 10, 3, 19, 20)); // batch with the last one
        let now = at(2026, 10, 5, 12, 0); // Monday
        let p = predict(&t, &wita(), now).unwrap();
        assert_eq!(p.pattern, Pattern::Weekly { weekday: 5, hour: 19 }); // 5 = Saturday
        assert_eq!(p.next_at, at(2026, 10, 10, 19, 0));
        assert_eq!(p.label, ConfidenceLabel::High);
        assert!(!p.overdue && !p.likely_hiatus);
    }

    #[test]
    fn irregular_interval_series_uses_median() {
        // Every ~3 days, no dominant weekday.
        let base = at(2026, 9, 1, 8, 0);
        let t: Vec<_> = [0, 3, 6, 9, 12, 15].iter().map(|d| base + Duration::days(*d)).collect();
        let p = predict(&t, &wita(), base + Duration::days(16)).unwrap();
        assert!(matches!(p.pattern, Pattern::Interval { days } if (days - 3.0).abs() < 0.01));
        assert_eq!(p.next_at, base + Duration::days(18));
    }

    #[test]
    fn too_little_data_returns_none() {
        let t = vec![at(2026, 9, 1, 8, 0), at(2026, 9, 8, 8, 0)];
        assert!(predict(&t, &wita(), at(2026, 9, 9, 0, 0)).is_none());
    }

    #[test]
    fn long_silence_is_flagged_as_hiatus_and_weekly_rolls_forward() {
        let t: Vec<_> = (0..6).map(|w| at(2026, 7, 4, 19, 0) + Duration::weeks(w)).collect();
        let now = at(2026, 10, 1, 12, 0); // ~7 weeks after the last one
        let p = predict(&t, &wita(), now).unwrap();
        assert!(p.overdue);
        assert!(p.likely_hiatus);
        assert!(p.next_at > now - Duration::hours(p.window_hours as i64));
        assert_eq!(p.next_at.with_timezone(&wita()).weekday(), Weekday::Sat);
    }
}
