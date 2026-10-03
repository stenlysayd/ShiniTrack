//! SQLite persistence shared by the app and the server.
//!
//! The same schema is used on both sides; the server simply never touches the
//! `downloads` / `release_history` tables.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::models::{ChapterEvent, ChapterItem, LastSeen, Manga};

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS favorites (
    manga_id      TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    cover         TEXT,
    last_ch_id    TEXT,
    last_ch_num   REAL,
    last_ch_time  TEXT,
    notify        INTEGER NOT NULL DEFAULT 1,
    added_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id       TEXT NOT NULL,
    title          TEXT NOT NULL,
    cover          TEXT,
    chapter_id     TEXT NOT NULL UNIQUE,
    chapter_number REAL NOT NULL,
    released_at    TEXT,
    created_at     TEXT NOT NULL,
    seen           INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS release_history (
    manga_id       TEXT NOT NULL,
    chapter_id     TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    released_at    TEXT NOT NULL,
    PRIMARY KEY (manga_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS downloads (
    chapter_id     TEXT PRIMARY KEY,
    manga_id       TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    dir            TEXT NOT NULL,
    pages          INTEGER NOT NULL,
    bytes          INTEGER NOT NULL,
    done_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_progress (
    manga_id       TEXT NOT NULL,
    chapter_id     TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    last_page      INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (manga_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Favorite {
    pub manga_id: String,
    pub title: String,
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub last_ch_id: Option<String>,
    #[serde(default)]
    pub last_ch_num: Option<f64>,
    #[serde(default)]
    pub last_ch_time: Option<DateTime<Utc>>,
    #[serde(default = "default_true")]
    pub notify: bool,
    #[serde(default = "Utc::now")]
    pub added_at: DateTime<Utc>,
}

fn default_true() -> bool {
    true
}

impl Favorite {
    /// New favorite whose baseline is the series' current latest chapter, so
    /// adding a favorite never fires a notification for an old chapter.
    pub fn from_manga(m: &Manga) -> Self {
        Self {
            manga_id: m.manga_id.clone(),
            title: m.title.clone(),
            cover: m.cover(),
            last_ch_id: m.latest_chapter_id.clone(),
            last_ch_num: m.latest_chapter_number,
            last_ch_time: m.latest_chapter_time,
            notify: true,
            added_at: Utc::now(),
        }
    }

    pub fn last_seen(&self) -> LastSeen {
        LastSeen {
            chapter_number: self.last_ch_num,
            chapter_time: self.last_ch_time,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEvent {
    pub id: i64,
    #[serde(flatten)]
    pub event: ChapterEvent,
    pub created_at: DateTime<Utc>,
    pub seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    pub chapter_id: String,
    pub manga_id: String,
    pub chapter_number: f64,
    pub dir: String,
    pub pages: u32,
    pub bytes: u64,
    pub done_at: DateTime<Utc>,
}

pub struct Store {
    conn: Connection,
}

fn ts(t: &DateTime<Utc>) -> String {
    t.to_rfc3339()
}

fn parse_ts(s: Option<String>) -> Option<DateTime<Utc>> {
    s.and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&Utc))
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if let Some(dir) = path.as_ref().parent() {
            if !dir.as_os_str().is_empty() {
                std::fs::create_dir_all(dir)?;
            }
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // ---------------------------------------------------------------- favorites

    pub fn upsert_favorite(&self, f: &Favorite) -> Result<()> {
        self.conn.execute(
            "INSERT INTO favorites (manga_id, title, cover, last_ch_id, last_ch_num, last_ch_time, notify, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(manga_id) DO UPDATE SET
               title = excluded.title,
               cover = excluded.cover,
               notify = excluded.notify",
            params![
                f.manga_id,
                f.title,
                f.cover,
                f.last_ch_id,
                f.last_ch_num,
                f.last_ch_time.as_ref().map(ts),
                f.notify,
                ts(&f.added_at)
            ],
        )?;
        Ok(())
    }

    pub fn remove_favorite(&self, manga_id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM favorites WHERE manga_id = ?1", [manga_id])?;
        Ok(())
    }

    pub fn set_notify(&self, manga_id: &str, notify: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE favorites SET notify = ?2 WHERE manga_id = ?1",
            params![manga_id, notify],
        )?;
        Ok(())
    }

    /// Server-side sync: make the favorites table equal to `list`, keeping the
    /// stored baseline (last seen chapter) of series that were already present.
    pub fn replace_favorites(&mut self, list: &[Favorite]) -> Result<()> {
        let tx = self.conn.transaction()?;
        {
            let ids: Vec<&str> = list.iter().map(|f| f.manga_id.as_str()).collect();
            let existing: Vec<String> = {
                let mut st = tx.prepare("SELECT manga_id FROM favorites")?;
                let rows = st.query_map([], |r| r.get::<_, String>(0))?;
                rows.collect::<std::result::Result<_, _>>()?
            };
            for id in existing.iter().filter(|id| !ids.contains(&id.as_str())) {
                tx.execute("DELETE FROM favorites WHERE manga_id = ?1", [id])?;
            }
            for f in list {
                tx.execute(
                    "INSERT INTO favorites (manga_id, title, cover, last_ch_id, last_ch_num, last_ch_time, notify, added_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT(manga_id) DO UPDATE SET
                       title = excluded.title, cover = excluded.cover, notify = excluded.notify,
                       last_ch_id   = CASE WHEN favorites.last_ch_num IS NULL OR excluded.last_ch_num > favorites.last_ch_num
                                           THEN excluded.last_ch_id ELSE favorites.last_ch_id END,
                       last_ch_time = CASE WHEN favorites.last_ch_num IS NULL OR excluded.last_ch_num > favorites.last_ch_num
                                           THEN excluded.last_ch_time ELSE favorites.last_ch_time END,
                       last_ch_num  = MAX(COALESCE(favorites.last_ch_num, -1), COALESCE(excluded.last_ch_num, -1))",
                    params![
                        f.manga_id,
                        f.title,
                        f.cover,
                        f.last_ch_id,
                        f.last_ch_num,
                        f.last_ch_time.as_ref().map(ts),
                        f.notify,
                        ts(&f.added_at)
                    ],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_favorites(&self) -> Result<Vec<Favorite>> {
        let mut st = self.conn.prepare(
            "SELECT manga_id, title, cover, last_ch_id, last_ch_num, last_ch_time, notify, added_at
             FROM favorites ORDER BY title COLLATE NOCASE",
        )?;
        let rows = st.query_map([], |r| {
            Ok(Favorite {
                manga_id: r.get(0)?,
                title: r.get(1)?,
                cover: r.get(2)?,
                last_ch_id: r.get(3)?,
                last_ch_num: r.get::<_, Option<f64>>(4)?.filter(|n| *n >= 0.0),
                last_ch_time: parse_ts(r.get(5)?),
                notify: r.get(6)?,
                added_at: parse_ts(r.get(7)?).unwrap_or_else(Utc::now),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_favorite(&self, manga_id: &str) -> Result<Option<Favorite>> {
        Ok(self
            .list_favorites()?
            .into_iter()
            .find(|f| f.manga_id == manga_id))
    }

    /// Baselines of favorites that should notify — the input for [`crate::detect::diff`].
    pub fn notify_baselines(&self) -> Result<HashMap<String, LastSeen>> {
        Ok(self
            .list_favorites()?
            .into_iter()
            .filter(|f| f.notify)
            .map(|f| (f.manga_id.clone(), f.last_seen()))
            .collect())
    }

    pub fn update_last_seen(&self, ev: &ChapterEvent) -> Result<()> {
        self.conn.execute(
            "UPDATE favorites SET last_ch_id = ?2, last_ch_num = ?3, last_ch_time = ?4
             WHERE manga_id = ?1 AND (last_ch_num IS NULL OR last_ch_num <= ?3)",
            params![
                ev.manga_id,
                ev.chapter_id,
                ev.chapter_number,
                ev.released_at.as_ref().map(ts)
            ],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------- events

    /// Inserts an event. Returns `Some(id)` when new, `None` when this chapter
    /// was already recorded (dedupes push + WorkManager + sync paths).
    pub fn insert_event(&self, ev: &ChapterEvent) -> Result<Option<i64>> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO events (manga_id, title, cover, chapter_id, chapter_number, released_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                ev.manga_id,
                ev.title,
                ev.cover,
                ev.chapter_id,
                ev.chapter_number,
                ev.released_at.as_ref().map(ts),
                ts(&Utc::now())
            ],
        )?;
        Ok((n == 1).then(|| self.conn.last_insert_rowid()))
    }

    pub fn events_since(&self, since_id: i64, limit: u32) -> Result<Vec<StoredEvent>> {
        self.query_events(
            "SELECT id, manga_id, title, cover, chapter_id, chapter_number, released_at, created_at, seen
             FROM events WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
            params![since_id, limit],
        )
    }

    pub fn recent_events(&self, limit: u32) -> Result<Vec<StoredEvent>> {
        self.query_events(
            "SELECT id, manga_id, title, cover, chapter_id, chapter_number, released_at, created_at, seen
             FROM events ORDER BY id DESC LIMIT ?1",
            params![limit],
        )
    }

    fn query_events(&self, sql: &str, p: impl rusqlite::Params) -> Result<Vec<StoredEvent>> {
        let mut st = self.conn.prepare(sql)?;
        let rows = st.query_map(p, |r| {
            Ok(StoredEvent {
                id: r.get(0)?,
                event: ChapterEvent {
                    manga_id: r.get(1)?,
                    title: r.get(2)?,
                    cover: r.get(3)?,
                    chapter_id: r.get(4)?,
                    chapter_number: r.get(5)?,
                    released_at: parse_ts(r.get(6)?),
                },
                created_at: parse_ts(r.get(7)?).unwrap_or_else(Utc::now),
                seen: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn mark_all_seen(&self) -> Result<()> {
        self.conn.execute("UPDATE events SET seen = 1 WHERE seen = 0", [])?;
        Ok(())
    }

    pub fn max_event_id(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COALESCE(MAX(id), 0) FROM events", [], |r| r.get(0))?)
    }

    // ---------------------------------------------------------- release history

    pub fn save_history(&self, chapters: &[ChapterItem]) -> Result<()> {
        let mut st = self.conn.prepare(
            "INSERT OR REPLACE INTO release_history (manga_id, chapter_id, chapter_number, released_at)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        for c in chapters {
            if let Some(t) = &c.release_date {
                st.execute(params![c.manga_id, c.chapter_id, c.chapter_number, ts(t)])?;
            }
        }
        Ok(())
    }

    pub fn history_times(&self, manga_id: &str) -> Result<Vec<DateTime<Utc>>> {
        let mut st = self.conn.prepare(
            "SELECT released_at FROM release_history WHERE manga_id = ?1 ORDER BY released_at",
        )?;
        let rows = st.query_map([manga_id], |r| r.get::<_, String>(0))?;
        Ok(rows
            .filter_map(|r| parse_ts(r.ok()))
            .collect())
    }

    // ---------------------------------------------------------------- downloads

    pub fn save_download(&self, d: &Download) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO downloads (chapter_id, manga_id, chapter_number, dir, pages, bytes, done_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![d.chapter_id, d.manga_id, d.chapter_number, d.dir, d.pages, d.bytes as i64, ts(&d.done_at)],
        )?;
        Ok(())
    }

    pub fn get_download(&self, chapter_id: &str) -> Result<Option<Download>> {
        Ok(self
            .conn
            .query_row(
                "SELECT chapter_id, manga_id, chapter_number, dir, pages, bytes, done_at FROM downloads WHERE chapter_id = ?1",
                [chapter_id],
                |r| {
                    Ok(Download {
                        chapter_id: r.get(0)?,
                        manga_id: r.get(1)?,
                        chapter_number: r.get(2)?,
                        dir: r.get(3)?,
                        pages: r.get(4)?,
                        bytes: r.get::<_, i64>(5)? as u64,
                        done_at: parse_ts(r.get(6)?).unwrap_or_else(Utc::now),
                    })
                },
            )
            .optional()?)
    }

    pub fn downloaded_chapter_ids(&self, manga_id: &str) -> Result<Vec<String>> {
        let mut st = self
            .conn
            .prepare("SELECT chapter_id FROM downloads WHERE manga_id = ?1")?;
        let rows = st.query_map([manga_id], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn delete_download(&self, chapter_id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM downloads WHERE chapter_id = ?1", [chapter_id])?;
        Ok(())
    }

    // ----------------------------------------------------------------------- kv

    pub fn kv_get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn save_reading_progress(
        &self,
        manga_id: &str,
        chapter_id: &str,
        chapter_number: f64,
        last_page: u32,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"INSERT INTO reading_progress (manga_id, chapter_id, chapter_number, last_page, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(manga_id, chapter_id) DO UPDATE SET
                   chapter_number = excluded.chapter_number,
                   last_page = excluded.last_page,
                   updated_at = excluded.updated_at"#,
            params![manga_id, chapter_id, chapter_number, last_page, now],
        )?;
        Ok(())
    }

    pub fn get_last_reading_progress(&self, manga_id: &str) -> Result<Option<ReadingProgress>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT manga_id, chapter_id, chapter_number, last_page, updated_at
               FROM reading_progress
               WHERE manga_id = ?1
               ORDER BY updated_at DESC
               LIMIT 1"#,
        )?;
        let row = stmt
            .query_row(params![manga_id], |r| {
                let dt_str: String = r.get(4)?;
                let updated_at = DateTime::parse_from_rfc3339(&dt_str)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                Ok(ReadingProgress {
                    manga_id: r.get(0)?,
                    chapter_id: r.get(1)?,
                    chapter_number: r.get(2)?,
                    last_page: r.get(3)?,
                    updated_at,
                })
            })
            .optional()?;
        Ok(row)
    }

    pub fn list_all_last_reading(&self) -> Result<HashMap<String, ReadingProgress>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT manga_id, chapter_id, chapter_number, last_page, updated_at
               FROM reading_progress
               WHERE (manga_id, updated_at) IN (
                   SELECT manga_id, MAX(updated_at)
                   FROM reading_progress
                   GROUP BY manga_id
               )"#,
        )?;
        let rows = stmt.query_map([], |r| {
            let dt_str: String = r.get(4)?;
            let updated_at = DateTime::parse_from_rfc3339(&dt_str)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok((
                r.get::<_, String>(0)?,
                ReadingProgress {
                    manga_id: r.get(0)?,
                    chapter_id: r.get(1)?,
                    chapter_number: r.get(2)?,
                    last_page: r.get(3)?,
                    updated_at,
                },
            ))
        })?;
        let mut map = HashMap::new();
        for r in rows {
            let (mid, prog) = r?;
            map.insert(mid, prog);
        }
        Ok(map)
    }

    pub fn list_read_chapter_ids(&self, manga_id: &str) -> Result<HashSet<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT chapter_id FROM reading_progress WHERE manga_id = ?1")?;
        let rows = stmt.query_map(params![manga_id], |r| r.get(0))?;
        let mut set = HashSet::new();
        for r in rows {
            set.insert(r?);
        }
        Ok(set)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadingProgress {
    pub manga_id: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub last_page: u32,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn fav(id: &str, num: f64) -> Favorite {
        Favorite {
            manga_id: id.into(),
            title: id.to_uppercase(),
            cover: None,
            last_ch_id: Some(format!("{id}-{num}")),
            last_ch_num: Some(num),
            last_ch_time: Some(Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap()),
            notify: true,
            added_at: Utc::now(),
        }
    }

    fn ev(id: &str, num: f64) -> ChapterEvent {
        ChapterEvent {
            manga_id: id.into(),
            title: id.into(),
            cover: None,
            chapter_id: format!("{id}-{num}"),
            chapter_number: num,
            released_at: Some(Utc.with_ymd_and_hms(2026, 10, 3, 0, 0, 0).unwrap()),
        }
    }

    #[test]
    fn favorites_roundtrip_and_notify_filter() {
        let s = Store::open_in_memory().unwrap();
        s.upsert_favorite(&fav("a", 10.0)).unwrap();
        s.upsert_favorite(&fav("b", 5.0)).unwrap();
        s.set_notify("b", false).unwrap();
        assert_eq!(s.list_favorites().unwrap().len(), 2);
        let base = s.notify_baselines().unwrap();
        assert_eq!(base.len(), 1);
        assert_eq!(base["a"].chapter_number, Some(10.0));
    }

    #[test]
    fn events_are_deduplicated_by_chapter() {
        let s = Store::open_in_memory().unwrap();
        assert!(s.insert_event(&ev("a", 11.0)).unwrap().is_some());
        assert!(s.insert_event(&ev("a", 11.0)).unwrap().is_none());
        assert!(s.insert_event(&ev("a", 12.0)).unwrap().is_some());
        let all = s.events_since(0, 10).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(s.events_since(all[0].id, 10).unwrap().len(), 1);
    }

    #[test]
    fn last_seen_never_goes_backwards() {
        let s = Store::open_in_memory().unwrap();
        s.upsert_favorite(&fav("a", 10.0)).unwrap();
        s.update_last_seen(&ev("a", 12.0)).unwrap();
        s.update_last_seen(&ev("a", 11.0)).unwrap();
        assert_eq!(s.get_favorite("a").unwrap().unwrap().last_ch_num, Some(12.0));
    }

    #[test]
    fn replace_favorites_keeps_newer_server_baseline_and_removes_missing() {
        let mut s = Store::open_in_memory().unwrap();
        s.replace_favorites(&[fav("a", 10.0), fav("b", 1.0)]).unwrap();
        s.update_last_seen(&ev("a", 12.0)).unwrap(); // server saw ch12 already
        s.replace_favorites(&[fav("a", 10.0)]).unwrap(); // app still thinks ch10
        let list = s.list_favorites().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].last_ch_num, Some(12.0));
    }

    #[test]
    fn history_and_kv() {
        let s = Store::open_in_memory().unwrap();
        let c = ChapterItem {
            chapter_id: "c1".into(),
            manga_id: "a".into(),
            chapter_title: None,
            chapter_number: 1.0,
            thumbnail_image_url: None,
            view_count: None,
            release_date: Some(Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap()),
        };
        s.save_history(&[c.clone(), c]).unwrap();
        assert_eq!(s.history_times("a").unwrap().len(), 1);
        s.kv_set("k", "v1").unwrap();
        s.kv_set("k", "v2").unwrap();
        assert_eq!(s.kv_get("k").unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn reading_progress_flow() {
        let s = Store::open_in_memory().unwrap();
        s.save_reading_progress("solo-leveling", "ch-100", 100.0, 15).unwrap();
        let last = s.get_last_reading_progress("solo-leveling").unwrap().unwrap();
        assert_eq!(last.chapter_id, "ch-100");
        assert_eq!(last.last_page, 15);
        assert_eq!(last.chapter_number, 100.0);

        let read_ids = s.list_read_chapter_ids("solo-leveling").unwrap();
        assert!(read_ids.contains("ch-100"));
        assert!(!read_ids.contains("ch-101"));
    }
}
