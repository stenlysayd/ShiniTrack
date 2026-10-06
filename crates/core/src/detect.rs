//! Pure update detection. No I/O, so it is trivially unit-testable and shared
//! by the server poller and the on-device WorkManager fallback.

use std::collections::HashMap;

use crate::models::{ChapterEvent, LastSeen, Manga};

/// Two chapter numbers closer than this are considered equal.
const EPS: f64 = 1e-6;

/// Is `m` newer than what we last saw?
///
/// A chapter counts as new when its number is higher, or (same number) when its
/// release time is later — this catches re-uploads of a higher chapter that the
/// site published with a fractional number we already saw, and series whose
/// numbers we never recorded.
pub fn is_newer(m: &Manga, seen: &LastSeen) -> bool {
    let (Some(num), Some(_)) = (m.latest_chapter_number, m.latest_chapter_id.as_ref()) else {
        return false;
    };
    match seen.chapter_number {
        None => true,
        Some(prev) if num > prev + EPS => true,
        Some(prev) if (num - prev).abs() <= EPS => match (m.latest_chapter_time, seen.chapter_time) {
            (Some(t), Some(prev_t)) => t > prev_t,
            _ => false,
        },
        Some(_) => false, // lower number (e.g. an old chapter re-uploaded) → ignore
    }
}

/// Returns events ONLY for series present in `favorites` (the caller passes just
/// the favorites that have notifications enabled). Everything else in the feed
/// is ignored — that is the "only the comics I picked trigger a notification"
/// rule.
pub fn diff(feed: &[Manga], favorites: &HashMap<String, LastSeen>) -> Vec<ChapterEvent> {
    feed.iter()
        .filter(|m| favorites.get(&m.manga_id).is_some_and(|seen| is_newer(m, seen)))
        .filter_map(ChapterEvent::from_manga)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn manga(id: &str, num: f64, hour: u32) -> Manga {
        Manga {
            manga_id: id.into(),
            title: format!("Title {id}"),
            alternative_title: None,
            description: None,
            cover_image_url: None,
            cover_portrait_url: Some(format!("https://img/{id}.jpg")),
            latest_chapter_id: Some(format!("{id}-ch{num}")),
            latest_chapter_number: Some(num),
            latest_chapter_time: Some(Utc.with_ymd_and_hms(2026, 10, 3, hour, 0, 0).unwrap()),
            status: None,
            bookmark_count: None,
            country_id: None,
            taxonomy: HashMap::new(),
        }
    }

    fn seen(num: f64, hour: u32) -> LastSeen {
        LastSeen {
            chapter_number: Some(num),
            chapter_time: Some(Utc.with_ymd_and_hms(2026, 10, 3, hour, 0, 0).unwrap()),
        }
    }

    #[test]
    fn non_favorite_updates_produce_no_events() {
        let feed = vec![manga("a", 10.0, 5), manga("b", 99.0, 5)];
        let favs = HashMap::new();
        assert!(diff(&feed, &favs).is_empty());
    }

    #[test]
    fn only_favorite_with_higher_chapter_triggers() {
        let feed = vec![manga("a", 11.0, 5), manga("b", 99.0, 5)];
        let favs = HashMap::from([("a".to_string(), seen(10.0, 1))]);
        let ev = diff(&feed, &favs);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].manga_id, "a");
        assert_eq!(ev[0].chapter_label(), "11");
    }

    #[test]
    fn freshly_added_favorite_with_baseline_does_not_trigger() {
        // When a favorite is added we store the current latest chapter as baseline.
        let feed = vec![manga("a", 10.0, 5)];
        let favs = HashMap::from([("a".to_string(), seen(10.0, 5))]);
        assert!(diff(&feed, &favs).is_empty());
    }

    #[test]
    fn same_number_later_time_triggers_but_lower_number_does_not() {
        let favs = HashMap::from([("a".to_string(), seen(10.0, 1))]);
        assert_eq!(diff(&[manga("a", 10.0, 6)], &favs).len(), 1);
        assert!(diff(&[manga("a", 9.0, 9)], &favs).is_empty());
    }

    #[test]
    fn fractional_chapter_counts_as_new() {
        let favs = HashMap::from([("a".to_string(), seen(10.0, 1))]);
        let ev = diff(&[manga("a", 10.5, 2)], &favs);
        assert_eq!(ev[0].chapter_label(), "10.5");
    }

    #[test]
    fn entry_without_chapter_is_ignored() {
        let mut m = manga("a", 1.0, 1);
        m.latest_chapter_id = None;
        let favs = HashMap::from([("a".to_string(), LastSeen::default())]);
        assert!(diff(&[m], &favs).is_empty());
    }
}
