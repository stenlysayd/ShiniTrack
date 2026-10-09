//! SQLite persistence shared by the app and the server.
//!
//! The same schema is used on both sides; the server simply never touches the
//! `downloads` / `release_history` tables.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
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
CREATE TABLE IF NOT EXISTS chapter_read (
    chapter_id     TEXT PRIMARY KEY,
    manga_id       TEXT NOT NULL,
    chapter_number REAL NOT NULL,
    read_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapter_read_manga ON chapter_read(manga_id);
CREATE TABLE IF NOT EXISTS manga_meta (
    manga_id   TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    cover      TEXT,
    country_id TEXT,
    updated_at TEXT NOT NULL
);
"#;

const MIGRATIONS: &[&str] = &[
    // Version 2: categories
    r#"
    CREATE TABLE IF NOT EXISTS category (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        flags      INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS manga_category (
        manga_id    TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        PRIMARY KEY (manga_id, category_id),
        FOREIGN KEY (category_id) REFERENCES category(id) ON DELETE CASCADE
    );
    "#,
    // Version 3: chapter cache table for fast library queries
    r#"
    CREATE TABLE IF NOT EXISTS chapter (
        chapter_id     TEXT PRIMARY KEY,
        manga_id       TEXT NOT NULL,
        number         REAL NOT NULL,
        name           TEXT,
        released_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_manga ON chapter(manga_id);
    "#,
    // Version 4: download queue
    r#"
    CREATE TABLE IF NOT EXISTS download_queue (
        chapter_id     TEXT PRIMARY KEY,
        manga_id       TEXT NOT NULL,
        title          TEXT NOT NULL,
        chapter_number REAL NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        position       INTEGER NOT NULL,
        added_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_download_queue_pos ON download_queue(position);
    "#,
    // Version 5: chapter bookmarks
    r#"
    CREATE TABLE IF NOT EXISTS chapter_bookmark (
        chapter_id     TEXT PRIMARY KEY,
        manga_id       TEXT NOT NULL,
        chapter_number REAL NOT NULL,
        bookmarked_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_bookmark_manga ON chapter_bookmark(manga_id);
    "#,
    // Version 6: read duration tracking
    r#"
    ALTER TABLE reading_progress ADD COLUMN read_duration INTEGER NOT NULL DEFAULT 0;
    "#,
];

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

    fn init(mut conn: Connection) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        
        let tx = conn.transaction()?;
        let mut version: usize = tx
            .query_row("SELECT value FROM kv WHERE key = 'schema_version'", [], |r| {
                let v: String = r.get(0)?;
                Ok(v.parse().unwrap_or(1))
            })
            .unwrap_or(1);

        for (i, &migration) in MIGRATIONS.iter().enumerate() {
            let target_version = i + 2;
            if version < target_version {
                tx.execute_batch(migration)?;
                version = target_version;
            }
        }
        
        tx.execute(
            "INSERT INTO kv (key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![version.to_string()],
        )?;
        tx.commit()?;
        
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

    pub fn kv_get_prefix(&self, prefix: &str) -> Result<HashMap<String, String>> {
        let mut st = self.conn.prepare("SELECT key, value FROM kv WHERE key LIKE ?1")?;
        let like_pattern = format!("{}%", prefix);
        let rows = st.query_map([like_pattern], |r| {
            let k: String = r.get(0)?;
            let v: String = r.get(1)?;
            Ok((k, v))
        })?;
        let mut map = HashMap::new();
        for r in rows {
            let (k, v) = r?;
            map.insert(k, v);
        }
        Ok(map)
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
        read_duration: u64,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"INSERT INTO reading_progress (manga_id, chapter_id, chapter_number, last_page, read_duration, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)
               ON CONFLICT(manga_id, chapter_id) DO UPDATE SET
                   chapter_number = excluded.chapter_number,
                   last_page = excluded.last_page,
                   read_duration = excluded.read_duration,
                   updated_at = excluded.updated_at"#,
            params![manga_id, chapter_id, chapter_number, last_page, read_duration, now],
        )?;
        Ok(())
    }

    pub fn get_last_reading_progress(&self, manga_id: &str) -> Result<Option<ReadingProgress>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT manga_id, chapter_id, chapter_number, last_page, updated_at, read_duration
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
                    read_duration: r.get::<_, Option<u64>>(5)?.unwrap_or(0),
                    updated_at,
                })
            })
            .optional()?;
        Ok(row)
    }

    pub fn list_all_last_reading(&self) -> Result<HashMap<String, ReadingProgress>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT manga_id, chapter_id, chapter_number, last_page, updated_at, read_duration
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
                    read_duration: r.get::<_, Option<u64>>(5)?.unwrap_or(0),
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

    pub fn save_manga_meta(
        &self,
        manga_id: &str,
        title: &str,
        cover: Option<&str>,
        country_id: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"INSERT INTO manga_meta (manga_id, title, cover, country_id, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT(manga_id) DO UPDATE SET
                   title = excluded.title,
                   cover = COALESCE(excluded.cover, manga_meta.cover),
                   country_id = COALESCE(excluded.country_id, manga_meta.country_id),
                   updated_at = excluded.updated_at"#,
            params![manga_id, title, cover, country_id, now],
        )?;
        Ok(())
    }

    pub fn mark_chapter_read(
        &self,
        manga_id: &str,
        chapter_id: &str,
        chapter_number: f64,
        read: bool,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        if read {
            self.conn.execute(
                r#"INSERT INTO chapter_read (chapter_id, manga_id, chapter_number, read_at)
                   VALUES (?1, ?2, ?3, ?4)
                   ON CONFLICT(chapter_id) DO UPDATE SET read_at = excluded.read_at"#,
                params![chapter_id, manga_id, chapter_number, now],
            )?;
        } else {
            self.conn.execute("DELETE FROM chapter_read WHERE chapter_id = ?1", params![chapter_id])?;
            self.conn.execute("DELETE FROM reading_progress WHERE chapter_id = ?1", params![chapter_id])?;
        }
        Ok(())
    }

    pub fn mark_chapters_read_batch(
        &mut self,
        manga_id: &str,
        chapters: &[(String, f64)],
        read: bool,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        let now = Utc::now().to_rfc3339();
        if read {
            let mut stmt = tx.prepare(
                r#"INSERT INTO chapter_read (chapter_id, manga_id, chapter_number, read_at)
                   VALUES (?1, ?2, ?3, ?4)
                   ON CONFLICT(chapter_id) DO UPDATE SET read_at = excluded.read_at"#,
            )?;
            for (ch_id, ch_num) in chapters {
                stmt.execute(params![ch_id, manga_id, ch_num, now])?;
            }
        } else {
            let mut stmt_del_cr = tx.prepare("DELETE FROM chapter_read WHERE chapter_id = ?1")?;
            let mut stmt_del_rp = tx.prepare("DELETE FROM reading_progress WHERE chapter_id = ?1")?;
            for (ch_id, _) in chapters {
                stmt_del_cr.execute(params![ch_id])?;
                stmt_del_rp.execute(params![ch_id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_read_chapter_ids(&self, manga_id: &str) -> Result<HashSet<String>> {
        let mut set = HashSet::new();
        let mut stmt = self
            .conn
            .prepare("SELECT chapter_id FROM chapter_read WHERE manga_id = ?1")?;
        let rows = stmt.query_map(params![manga_id], |r| r.get(0))?;
        for r in rows {
            set.insert(r?);
        }
        Ok(set)
    }

    pub fn set_chapter_bookmark(
        &self,
        manga_id: &str,
        chapter_id: &str,
        chapter_number: f64,
        bookmarked: bool,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        if bookmarked {
            self.conn.execute(
                r#"INSERT INTO chapter_bookmark (chapter_id, manga_id, chapter_number, bookmarked_at)
                   VALUES (?1, ?2, ?3, ?4)
                   ON CONFLICT(chapter_id) DO UPDATE SET bookmarked_at = excluded.bookmarked_at"#,
                params![chapter_id, manga_id, chapter_number, now],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM chapter_bookmark WHERE chapter_id = ?1",
                params![chapter_id],
            )?;
        }
        Ok(())
    }

    pub fn list_bookmarked_chapter_ids(&self, manga_id: &str) -> Result<HashSet<String>> {
        let mut set = HashSet::new();
        let mut stmt = self
            .conn
            .prepare("SELECT chapter_id FROM chapter_bookmark WHERE manga_id = ?1")?;
        let rows = stmt.query_map(params![manga_id], |r| r.get(0))?;
        for r in rows {
            set.insert(r?);
        }
        Ok(set)
    }

    pub fn list_history(&self, limit: u32) -> Result<Vec<HistoryItem>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT
                 p.manga_id,
                 COALESCE(m.title, f.title, p.manga_id) AS title,
                 COALESCE(m.cover, f.cover) AS cover,
                 p.chapter_id,
                 p.chapter_number,
                 p.last_page,
                 p.updated_at
               FROM reading_progress p
               LEFT JOIN manga_meta m ON p.manga_id = m.manga_id
               LEFT JOIN favorites f ON p.manga_id = f.manga_id
               ORDER BY p.updated_at DESC
               LIMIT ?1"#,
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            let dt_str: String = r.get(6)?;
            let updated_at = DateTime::parse_from_rfc3339(&dt_str)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok(HistoryItem {
                manga_id: r.get(0)?,
                title: r.get(1)?,
                cover: r.get(2)?,
                chapter_id: r.get(3)?,
                chapter_number: r.get(4)?,
                last_page: r.get(5)?,
                updated_at,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn search_history(&self, query: &str, limit: u32) -> Result<Vec<HistoryItem>> {
        let pattern = format!("%{query}%");
        let mut stmt = self.conn.prepare(
            r#"SELECT
                 p.manga_id,
                 COALESCE(m.title, f.title, p.manga_id) AS title,
                 COALESCE(m.cover, f.cover) AS cover,
                 p.chapter_id,
                 p.chapter_number,
                 p.last_page,
                 p.updated_at
               FROM reading_progress p
               LEFT JOIN manga_meta m ON p.manga_id = m.manga_id
               LEFT JOIN favorites f ON p.manga_id = f.manga_id
               WHERE (COALESCE(m.title, f.title, p.manga_id) LIKE ?1)
               ORDER BY p.updated_at DESC
               LIMIT ?2"#,
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| {
            let dt_str: String = r.get(6)?;
            let updated_at = DateTime::parse_from_rfc3339(&dt_str)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok(HistoryItem {
                manga_id: r.get(0)?,
                title: r.get(1)?,
                cover: r.get(2)?,
                chapter_id: r.get(3)?,
                chapter_number: r.get(4)?,
                last_page: r.get(5)?,
                updated_at,
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn delete_history_item(&self, manga_id: &str, chapter_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM reading_progress WHERE manga_id = ?1 AND chapter_id = ?2",
            params![manga_id, chapter_id],
        )?;
        Ok(())
    }

    // -------------------------------------------------------------- categories

    pub fn list_categories_with_count(&self) -> Result<Vec<CategoryWithCount>> {
        let mut st = self.conn.prepare(
            r#"SELECT c.id, c.name, c.sort_order, c.flags,
                      COUNT(mc.manga_id) AS manga_count
               FROM category c
               LEFT JOIN manga_category mc ON c.id = mc.category_id
               GROUP BY c.id
               ORDER BY c.sort_order, c.id"#,
        )?;
        let rows = st.query_map([], |r| {
            Ok(CategoryWithCount {
                category: Category {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    sort_order: r.get(2)?,
                    flags: r.get(3)?,
                },
                manga_count: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn create_category(&self, name: &str) -> Result<Category> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(Error::Api {
                code: 400,
                message: "Nama kategori tidak boleh kosong".into(),
            });
        }
        let lower = trimmed.to_lowercase();
        if lower == "semua" || lower == "bawaan" {
            return Err(Error::Api {
                code: 400,
                message: "Nama 'Semua' dan 'Bawaan' adalah kategori sistem dan tidak dapat digunakan".into(),
            });
        }
        let next_order: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM category",
                [],
                |r| r.get(0),
            )?;
        self.conn.execute(
            "INSERT INTO category (name, sort_order) VALUES (?1, ?2)",
            params![trimmed, next_order],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Category {
            id,
            name: trimmed.to_string(),
            sort_order: next_order,
            flags: 0,
        })
    }

    pub fn rename_category(&self, id: i64, new_name: &str) -> Result<()> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(Error::Api {
                code: 400,
                message: "Nama kategori tidak boleh kosong".into(),
            });
        }
        let lower = trimmed.to_lowercase();
        if lower == "semua" || lower == "bawaan" {
            return Err(Error::Api {
                code: 400,
                message: "Nama 'Semua' dan 'Bawaan' adalah kategori sistem dan tidak dapat digunakan".into(),
            });
        }
        self.conn.execute(
            "UPDATE category SET name = ?2 WHERE id = ?1",
            params![id, trimmed],
        )?;
        Ok(())
    }

    pub fn delete_category(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM manga_category WHERE category_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM category WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn reorder_categories(&self, ids: &[i64]) -> Result<()> {
        let mut st = self.conn.prepare(
            "UPDATE category SET sort_order = ?2 WHERE id = ?1",
        )?;
        for (i, &id) in ids.iter().enumerate() {
            st.execute(params![id, i as i64])?;
        }
        Ok(())
    }

    pub fn set_manga_categories(&self, manga_id: &str, category_ids: &[i64]) -> Result<()> {
        self.conn.execute(
            "DELETE FROM manga_category WHERE manga_id = ?1",
            params![manga_id],
        )?;
        let mut st = self.conn.prepare(
            "INSERT INTO manga_category (manga_id, category_id) VALUES (?1, ?2)",
        )?;
        for &cid in category_ids {
            st.execute(params![manga_id, cid])?;
        }
        Ok(())
    }

    pub fn get_manga_categories(&self, manga_id: &str) -> Result<Vec<i64>> {
        let mut st = self.conn.prepare(
            "SELECT category_id FROM manga_category WHERE manga_id = ?1 ORDER BY category_id",
        )?;
        let rows = st.query_map(params![manga_id], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn clear_reading_history(&self) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM reading_progress", [])?;
        let has_favorite_last_read_at = {
            let mut st = tx.prepare("PRAGMA table_info(favorites)")?;
            let columns = st.query_map([], |r| r.get::<_, String>(1))?;
            let mut found = false;
            for column in columns {
                if column? == "last_read_at" {
                    found = true;
                    break;
                }
            }
            found
        };
        if has_favorite_last_read_at {
            tx.execute("UPDATE favorites SET last_read_at = NULL", [])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn clear_chapter_cache(&self) -> Result<usize> {
        let count = self.conn.execute("DELETE FROM chapter", [])?;
        Ok(count)
    }

    pub fn reset_prefs(&self) -> Result<()> {
        self.conn.execute("DELETE FROM kv WHERE key LIKE 'pref.%'", [])?;
        Ok(())
    }

    pub fn cleanup_database(&self) -> Result<()> {
        self.conn.execute("DELETE FROM events", [])?;
        self.conn.execute("DELETE FROM release_history", [])?;
        self.conn.execute(
            "DELETE FROM manga_meta WHERE manga_id NOT IN (SELECT manga_id FROM favorites)",
            [],
        )?;
        self.conn.execute("VACUUM", [])?;
        Ok(())
    }

    // ----------------------------------------------------------- chapter cache

    /// Upsert chapter rows into the `chapter` cache table.
    pub fn save_chapters(&self, chapters: &[ChapterItem]) -> Result<()> {
        let mut st = self.conn.prepare(
            "INSERT INTO chapter (chapter_id, manga_id, number, name, released_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(chapter_id) DO UPDATE SET
               number = excluded.number,
               name = excluded.name,
               released_at = excluded.released_at",
        )?;
        for c in chapters {
            st.execute(params![
                c.chapter_id,
                c.manga_id,
                c.chapter_number,
                c.chapter_title,
                c.release_date.as_ref().map(ts),
            ])?;
        }
        Ok(())
    }

    // ----------------------------------------------------------- library page

    /// Paginated library query.
    ///
    /// - `category`: `0` = all, `-1` = uncategorized, `>0` = specific category id.
    /// - `sort`: `"alpha"` | `"recent"` | `"unread"` | `"updated"` | `"added"`.
    /// - `search`: optional title substring filter.
    /// - `limit`, `offset`: for infinite-scroll pagination.
    pub fn library_page(
        &self,
        category: i64,
        sort: &str,
        sort_desc: bool,
        filter_downloaded: i64,
        filter_unread: i64,
        filter_started: i64,
        filter_completed: i64,
        search: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LibraryRow>> {
        // Build dynamic SQL
        let mut where_clauses: Vec<String> = Vec::new();
        let mut bind_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        // Category filter
        if category == -1 {
            where_clauses.push("f.manga_id NOT IN (SELECT manga_id FROM manga_category)".to_string());
        } else if category > 0 {
            where_clauses.push("f.manga_id IN (SELECT manga_id FROM manga_category WHERE category_id = ?)".to_string());
            bind_values.push(Box::new(category));
        }

        // Search filter
        if let Some(q) = search {
            if !q.is_empty() {
                where_clauses.push("title LIKE ?".to_string());
                bind_values.push(Box::new(format!("%{q}%")));
            }
        }

        // Tri-state filters: 0=off, 1=include, 2=exclude
        if filter_downloaded == 1 {
            where_clauses.push("downloaded_count > 0".to_string());
        } else if filter_downloaded == 2 {
            where_clauses.push("downloaded_count = 0".to_string());
        }

        if filter_unread == 1 {
            where_clauses.push("unread_count > 0".to_string());
        } else if filter_unread == 2 {
            where_clauses.push("unread_count = 0".to_string());
        }

        if filter_started == 1 {
            where_clauses.push("last_read_at IS NOT NULL".to_string());
        } else if filter_started == 2 {
            where_clauses.push("last_read_at IS NULL".to_string());
        }

        // Completed means last_ch_num is present AND progress >= last_ch_num
        // Actually, let's look at JS code for completed: `p && i.last_ch_num && p.chapter_number >= i.last_ch_num`
        if filter_completed == 1 {
            where_clauses.push("last_ch_num IS NOT NULL AND (SELECT MAX(chapter_number) FROM reading_progress rp WHERE rp.manga_id = manga_id) >= last_ch_num".to_string());
        } else if filter_completed == 2 {
            where_clauses.push("(last_ch_num IS NULL OR (SELECT MAX(chapter_number) FROM reading_progress rp WHERE rp.manga_id = manga_id) < last_ch_num OR (SELECT COUNT(*) FROM reading_progress rp WHERE rp.manga_id = manga_id) = 0)".to_string());
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        let dir = if sort_desc { "DESC" } else { "ASC" };
        let order_sql = match sort {
            "alpha" => format!("title COLLATE NOCASE {dir}"),
            "unread" => format!("unread_count {dir}, title COLLATE NOCASE ASC"),
            "updated" => format!("last_ch_num {dir}"),
            "added" => format!("added_at {dir}"),
            "random" => "RANDOM()".to_string(),
            _ /* recent */ => format!("last_read_at {dir} NULLS LAST"),
        };

        let sql = format!(
            "SELECT * FROM (
                SELECT
                    f.manga_id,
                    f.title,
                    f.cover,
                    f.notify,
                    f.added_at,
                    f.last_ch_num,
                    COALESCE((SELECT COUNT(*) FROM chapter c
                               WHERE c.manga_id = f.manga_id
                                 AND c.chapter_id NOT IN (SELECT chapter_id FROM chapter_read WHERE manga_id = f.manga_id)), 0) AS unread_count,
                    (SELECT MAX(rp.updated_at) FROM reading_progress rp WHERE rp.manga_id = f.manga_id) AS last_read_at,
                    COALESCE((SELECT COUNT(*) FROM downloads d WHERE d.manga_id = f.manga_id), 0) AS downloaded_count
                 FROM favorites f
             ) 
             {where_sql}
             ORDER BY {order_sql}
             LIMIT ? OFFSET ?"
        );

        bind_values.push(Box::new(limit));
        bind_values.push(Box::new(offset));

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            bind_values.iter().map(|b| b.as_ref()).collect();

        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map(params_refs.as_slice(), |r| {
            Ok(LibraryRow {
                manga_id: r.get(0)?,
                title: r.get(1)?,
                cover: r.get(2)?,
                notify: r.get::<_, i64>(3)? != 0,
                added_at: r.get::<_, String>(4)
                    .ok()
                    .and_then(|s| parse_ts(Some(s)))
                    .unwrap_or_else(Utc::now),
                last_ch_num: r.get(5)?,
                unread_count: r.get(6)?,
                last_read_at: r.get::<_, Option<String>>(7)
                    .ok()
                    .flatten()
                    .and_then(|s| parse_ts(Some(s))),
                downloaded_count: r.get(8)?,
            })
        })?;
        rows.collect::<std::result::Result<_, _>>().map_err(Into::into)
    }

    // ----------------------------------------------------------- download queue

    pub fn queue_add(&self, item: &QueueItem) -> Result<()> {
        let pos = if item.position < 0 {
            let next_pos: i64 = self.conn.query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM download_queue",
                [],
                |r| r.get(0),
            )?;
            next_pos
        } else {
            item.position
        };
        self.conn.execute(
            "INSERT INTO download_queue (chapter_id, manga_id, title, chapter_number, status, position, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(chapter_id) DO UPDATE SET
                 manga_id = excluded.manga_id,
                 title = excluded.title,
                 chapter_number = excluded.chapter_number,
                 status = excluded.status,
                 position = excluded.position,
                 added_at = excluded.added_at",
            params![
                item.chapter_id,
                item.manga_id,
                item.title,
                item.chapter_number,
                item.status,
                pos,
                ts(&item.added_at),
            ],
        )?;
        Ok(())
    }

    pub fn queue_list(&self) -> Result<Vec<QueueItem>> {
        let mut st = self.conn.prepare(
            "SELECT chapter_id, manga_id, title, chapter_number, status, position, added_at
             FROM download_queue ORDER BY position ASC, added_at ASC",
        )?;
        let rows = st.query_map([], |r| {
            Ok(QueueItem {
                chapter_id: r.get(0)?,
                manga_id: r.get(1)?,
                title: r.get(2)?,
                chapter_number: r.get(3)?,
                status: r.get(4)?,
                position: r.get(5)?,
                added_at: parse_ts(r.get(6)?).unwrap_or_else(Utc::now),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn queue_remove(&self, chapter_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM download_queue WHERE chapter_id = ?1",
            params![chapter_id],
        )?;
        Ok(())
    }

    pub fn queue_update_status(&self, chapter_id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE download_queue SET status = ?2 WHERE chapter_id = ?1",
            params![chapter_id, status],
        )?;
        Ok(())
    }

    pub fn queue_reset_downloading(&self) -> Result<usize> {
        let count = self.conn.execute(
            "UPDATE download_queue SET status = 'pending' WHERE status = 'downloading'",
            [],
        )?;
        Ok(count)
    }

    pub fn queue_reorder(&self, chapter_ids: &[String]) -> Result<()> {
        let mut st = self.conn.prepare(
            "UPDATE download_queue SET position = ?2 WHERE chapter_id = ?1",
        )?;
        for (i, cid) in chapter_ids.iter().enumerate() {
            st.execute(params![cid, i as i64])?;
        }
        Ok(())
    }

    pub fn queue_clear_done(&self) -> Result<()> {
        self.conn.execute(
            "DELETE FROM download_queue WHERE status = 'done' OR status = 'completed'",
            [],
        )?;
        Ok(())
    }

    pub fn queue_next_pending(&self) -> Result<Option<QueueItem>> {
        let mut st = self.conn.prepare(
            "SELECT chapter_id, manga_id, title, chapter_number, status, position, added_at
             FROM download_queue
             WHERE status = 'pending'
             ORDER BY position ASC, added_at ASC
             LIMIT 1",
        )?;
        let row = st
            .query_row([], |r| {
                Ok(QueueItem {
                    chapter_id: r.get(0)?,
                    manga_id: r.get(1)?,
                    title: r.get(2)?,
                    chapter_number: r.get(3)?,
                    status: r.get(4)?,
                    position: r.get(5)?,
                    added_at: parse_ts(r.get(6)?).unwrap_or_else(Utc::now),
                })
            })
            .optional()?;
        Ok(row)
    }

    pub fn queue_count(&self) -> Result<(u32, u32)> {
        let counts = self.conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0),
                COUNT(*)
             FROM download_queue",
            [],
            |r| Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?)),
        )?;
        Ok(counts)
    }

    pub fn get_statistics(&self) -> Result<Statistics> {
        let total_favorites: u64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM favorites", [], |r| r.get(0))
            .unwrap_or(0);

        let read_duration: u64 = self
            .conn
            .query_row(
                "SELECT COALESCE(SUM(read_duration), 0) FROM reading_progress",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let manga_finished: u64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM favorites f
                 WHERE (
                     (f.last_ch_num IS NOT NULL AND (
                         (SELECT MAX(chapter_number) FROM reading_progress rp WHERE rp.manga_id = f.manga_id) >= f.last_ch_num
                         OR (SELECT MAX(chapter_number) FROM chapter_read cr WHERE cr.manga_id = f.manga_id) >= f.last_ch_num
                     ))
                     OR
                     (f.last_ch_num IS NULL AND (SELECT MAX(number) FROM chapter c WHERE c.manga_id = f.manga_id) IS NOT NULL AND (
                         (SELECT MAX(chapter_number) FROM reading_progress rp WHERE rp.manga_id = f.manga_id) >= (SELECT MAX(number) FROM chapter c WHERE c.manga_id = f.manga_id)
                         OR (SELECT MAX(chapter_number) FROM chapter_read cr WHERE cr.manga_id = f.manga_id) >= (SELECT MAX(number) FROM chapter c WHERE c.manga_id = f.manga_id)
                     ))
                 )",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let total_chapters: u64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM chapter", [], |r| r.get(0))
            .unwrap_or(0);

        let total_read_chapters: u64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM chapter_read", [], |r| r.get(0))
            .unwrap_or(0);

        let total_downloads: u64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM downloads", [], |r| r.get(0))
            .unwrap_or(0);

        Ok(Statistics {
            total_favorites,
            read_duration,
            total_read_duration: read_duration,
            manga_finished,
            total_chapters,
            total_read_chapters,
            total_downloads,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadingProgress {
    pub manga_id: String,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub last_page: u32,
    #[serde(default)]
    pub read_duration: u64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryItem {
    pub manga_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub chapter_id: String,
    pub chapter_number: f64,
    pub last_page: u32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
    pub flags: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CategoryWithCount {
    #[serde(flatten)]
    pub category: Category,
    pub manga_count: i64,
}

/// One row returned by `library_page` — everything the grid card needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryRow {
    pub manga_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub notify: bool,
    pub added_at: DateTime<Utc>,
    pub last_ch_num: Option<f64>,
    pub unread_count: i64,
    pub last_read_at: Option<DateTime<Utc>>,
    pub downloaded_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueueItem {
    pub chapter_id: String,
    pub manga_id: String,
    pub title: String,
    pub chapter_number: f64,
    pub status: String,
    pub position: i64,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Statistics {
    pub total_favorites: u64,
    pub read_duration: u64,
    pub total_read_duration: u64,
    pub manga_finished: u64,
    pub total_chapters: u64,
    pub total_read_chapters: u64,
    pub total_downloads: u64,
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
        s.save_reading_progress("solo-leveling", "ch-100", 100.0, 15, 120).unwrap();
        let last = s.get_last_reading_progress("solo-leveling").unwrap().unwrap();
        assert_eq!(last.chapter_id, "ch-100");
        assert_eq!(last.last_page, 15);
        assert_eq!(last.chapter_number, 100.0);
        assert_eq!(last.read_duration, 120);

        let read_ids = s.list_read_chapter_ids("solo-leveling").unwrap();
        assert!(!read_ids.contains("ch-100"));
        
        s.mark_chapter_read("solo-leveling", "ch-100", 100.0, true).unwrap();
        let read_ids2 = s.list_read_chapter_ids("solo-leveling").unwrap();
        assert!(read_ids2.contains("ch-100"));
    }

    #[test]
    fn chapter_read_batch_and_history() {
        let mut s = Store::open_in_memory().unwrap();
        s.save_manga_meta("one-piece", "One Piece", Some("https://example.com/op.jpg"), Some("jp")).unwrap();
        s.mark_chapter_read("one-piece", "ch-1", 1.0, true).unwrap();
        s.mark_chapters_read_batch(
            "one-piece",
            &[("ch-2".into(), 2.0), ("ch-3".into(), 3.0)],
            true,
        ).unwrap();

        let read_ids = s.list_read_chapter_ids("one-piece").unwrap();
        assert_eq!(read_ids.len(), 3);
        assert!(read_ids.contains("ch-1"));
        assert!(read_ids.contains("ch-2"));
        assert!(read_ids.contains("ch-3"));

        // Unmark ch-2
        s.mark_chapter_read("one-piece", "ch-2", 2.0, false).unwrap();
        let read_ids2 = s.list_read_chapter_ids("one-piece").unwrap();
        assert_eq!(read_ids2.len(), 2);
        assert!(!read_ids2.contains("ch-2"));

        // Progress + history
        s.save_reading_progress("one-piece", "ch-3", 3.0, 10, 0).unwrap();
        let hist = s.list_history(10).unwrap();
        assert_eq!(hist.len(), 1);
        assert_eq!(hist[0].title, "One Piece");
        assert_eq!(hist[0].chapter_id, "ch-3");
    }

    #[test]
    fn test_schema_version_init() {
        let s = Store::open_in_memory().unwrap();
        let version = s.kv_get("schema_version").unwrap();
        assert_eq!(version.as_deref(), Some("6"));
    }

    #[test]
    fn categories_crud() {
        let s = Store::open_in_memory().unwrap();
        // Empty at start
        assert_eq!(s.list_categories_with_count().unwrap().len(), 0);

        // Create
        let c1 = s.create_category("Action").unwrap();
        assert_eq!(c1.name, "Action");
        assert_eq!(c1.sort_order, 0);
        let c2 = s.create_category("Romance").unwrap();
        assert_eq!(c2.sort_order, 1);

        // List
        let list = s.list_categories_with_count().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].category.name, "Action");
        assert_eq!(list[1].category.name, "Romance");
        assert_eq!(list[0].manga_count, 0);

        // Rename
        s.rename_category(c1.id, "Aksi").unwrap();
        let list2 = s.list_categories_with_count().unwrap();
        assert_eq!(list2[0].category.name, "Aksi");

        // Delete
        s.delete_category(c2.id).unwrap();
        assert_eq!(s.list_categories_with_count().unwrap().len(), 1);
    }

    #[test]
    fn categories_reorder() {
        let s = Store::open_in_memory().unwrap();
        let c1 = s.create_category("A").unwrap();
        let c2 = s.create_category("B").unwrap();
        let c3 = s.create_category("C").unwrap();
        // Reorder: C, A, B
        s.reorder_categories(&[c3.id, c1.id, c2.id]).unwrap();
        let list = s.list_categories_with_count().unwrap();
        assert_eq!(list[0].category.name, "C");
        assert_eq!(list[1].category.name, "A");
        assert_eq!(list[2].category.name, "B");
    }

    #[test]
    fn manga_category_assignment() {
        let s = Store::open_in_memory().unwrap();
        let c1 = s.create_category("Action").unwrap();
        let c2 = s.create_category("Romance").unwrap();

        // Assign manga to both categories
        s.set_manga_categories("solo-leveling", &[c1.id, c2.id]).unwrap();
        let cats = s.get_manga_categories("solo-leveling").unwrap();
        assert_eq!(cats.len(), 2);
        assert!(cats.contains(&c1.id));
        assert!(cats.contains(&c2.id));

        // Counts update
        let list = s.list_categories_with_count().unwrap();
        assert_eq!(list[0].manga_count, 1);
        assert_eq!(list[1].manga_count, 1);

        // Re-assign to only one
        s.set_manga_categories("solo-leveling", &[c1.id]).unwrap();
        let cats2 = s.get_manga_categories("solo-leveling").unwrap();
        assert_eq!(cats2.len(), 1);
        assert_eq!(cats2[0], c1.id);

        // Manga with no category = virtual Bawaan (empty list)
        let cats3 = s.get_manga_categories("unknown-manga").unwrap();
        assert!(cats3.is_empty());
    }

    #[test]
    fn delete_category_cleans_up_assignments() {
        let s = Store::open_in_memory().unwrap();
        let c1 = s.create_category("Action").unwrap();
        s.set_manga_categories("solo-leveling", &[c1.id]).unwrap();
        assert_eq!(s.get_manga_categories("solo-leveling").unwrap().len(), 1);

        s.delete_category(c1.id).unwrap();
        // Assignment should be gone
        assert!(s.get_manga_categories("solo-leveling").unwrap().is_empty());
    }

    #[test]
    fn library_page_basic() {
        let s = Store::open_in_memory().unwrap();
        // Add 3 favorites
        for i in 0..3 {
            let f = Favorite {
                manga_id: format!("manga-{i}"),
                title: format!("Title {i}"),
                cover: None,
                last_ch_id: None,
                last_ch_num: Some(i as f64 * 10.0),
                last_ch_time: None,
                notify: true,
                added_at: Utc::now(),
            };
            s.upsert_favorite(&f).unwrap();
        }
        // Save some chapters for manga-0
        use crate::models::ChapterItem;
        let chs: Vec<ChapterItem> = (0..5).map(|n| ChapterItem {
            chapter_id: format!("ch-{n}"),
            manga_id: "manga-0".to_string(),
            chapter_title: Some(format!("Chapter {n}")),
            chapter_number: n as f64,
            thumbnail_image_url: None,
            view_count: None,
            release_date: None,
        }).collect();
        s.save_chapters(&chs).unwrap();

        // First page
        let rows = s.library_page(0, "alpha", false, 0, 0, 0, 0, None, 30, 0).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].title, "Title 0"); // alphabetical
        assert_eq!(rows[0].unread_count, 5); // 5 chapters, none read

        // Pagination
        let page2 = s.library_page(0, "alpha", false, 0, 0, 0, 0, None, 2, 2).unwrap();
        assert_eq!(page2.len(), 1); // only 1 left

        // Search filter
        let search = s.library_page(0, "alpha", false, 0, 0, 0, 0, Some("Title 1"), 30, 0).unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].manga_id, "manga-1");
    }

    #[test]
    fn library_page_perf_5000() {
        let s = Store::open_in_memory().unwrap();
        // Insert 5000 favorites
        for i in 0..5000 {
            let f = Favorite {
                manga_id: format!("m-{i:05}"),
                title: format!("Manga {i:05}"),
                cover: None,
                last_ch_id: None,
                last_ch_num: Some(i as f64),
                last_ch_time: None,
                notify: true,
                added_at: Utc::now(),
            };
            s.upsert_favorite(&f).unwrap();
        }

        let start = std::time::Instant::now();
        let rows = s.library_page(0, "alpha", false, 0, 0, 0, 0, None, 30, 0).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(rows.len(), 30);
        assert!(elapsed.as_millis() < 100, "First page took {}ms, must be <100ms", elapsed.as_millis());
    }

    #[test]
    fn test_store_cleanup_and_reset() {
        let s = Store::open_in_memory().unwrap();
        // 1. Reading progress
        s.save_reading_progress("m-1", "ch-1", 1.0, 10, 0).unwrap();
        assert_eq!(s.list_history(10).unwrap().len(), 1);
        s.clear_reading_history().unwrap();
        assert_eq!(s.list_history(10).unwrap().len(), 0);

        // 2. Prefs reset
        s.kv_set("pref.test.key", "value1").unwrap();
        s.kv_set("server_url", "http://example.com").unwrap();
        assert_eq!(s.kv_get("pref.test.key").unwrap().as_deref(), Some("value1"));
        s.reset_prefs().unwrap();
        assert_eq!(s.kv_get("pref.test.key").unwrap(), None);
        assert_eq!(s.kv_get("server_url").unwrap().as_deref(), Some("http://example.com"));

        // 3. Database cleanup
        s.save_manga_meta("orphan-manga", "Orphan", None, None).unwrap();
        let f = Favorite {
            manga_id: "fav-manga".into(),
            title: "Fav Manga".into(),
            cover: None,
            last_ch_id: None,
            last_ch_num: None,
            last_ch_time: None,
            notify: true,
            added_at: Utc::now(),
        };
        s.upsert_favorite(&f).unwrap();
        s.save_manga_meta("fav-manga", "Fav Manga", None, None).unwrap();
        s.cleanup_database().unwrap();
        // Fav metadata remains, orphan is cleaned
        let meta_fav = s.conn.query_row("SELECT title FROM manga_meta WHERE manga_id = 'fav-manga'", [], |r| r.get::<_, String>(0)).ok();
        assert_eq!(meta_fav.as_deref(), Some("Fav Manga"));
        let meta_orphan = s.conn.query_row("SELECT title FROM manga_meta WHERE manga_id = 'orphan-manga'", [], |r| r.get::<_, String>(0)).ok();
        assert_eq!(meta_orphan, None);
    }

    #[test]
    fn clear_reading_history_clears_library_last_read_state() {
        let s = Store::open_in_memory().unwrap();
        let f = Favorite {
            manga_id: "m-1".into(),
            title: "Manga 1".into(),
            cover: None,
            last_ch_id: None,
            last_ch_num: Some(1.0),
            last_ch_time: None,
            notify: true,
            added_at: Utc::now(),
        };
        s.upsert_favorite(&f).unwrap();
        s.save_reading_progress("m-1", "ch-1", 1.0, 8, 60).unwrap();
        assert!(s
            .library_page(0, "recent", true, 0, 0, 1, 0, None, 30, 0)
            .unwrap()
            .iter()
            .any(|row| row.manga_id == "m-1" && row.last_read_at.is_some()));

        s.clear_reading_history().unwrap();
        let rows = s.library_page(0, "recent", true, 0, 0, 0, 0, None, 30, 0).unwrap();
        let row = rows.iter().find(|row| row.manga_id == "m-1").unwrap();
        assert!(row.last_read_at.is_none());
        assert!(s
            .library_page(0, "recent", true, 0, 0, 1, 0, None, 30, 0)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn clear_reading_history_nulls_legacy_favorites_last_read_at_column() {
        let s = Store::open_in_memory().unwrap();
        s.conn
            .execute("ALTER TABLE favorites ADD COLUMN last_read_at TEXT", [])
            .unwrap();
        let f = Favorite {
            manga_id: "m-legacy".into(),
            title: "Legacy Manga".into(),
            cover: None,
            last_ch_id: None,
            last_ch_num: Some(1.0),
            last_ch_time: None,
            notify: true,
            added_at: Utc::now(),
        };
        s.upsert_favorite(&f).unwrap();
        s.conn
            .execute(
                "UPDATE favorites SET last_read_at = ?2 WHERE manga_id = ?1",
                params!["m-legacy", Utc::now().to_rfc3339()],
            )
            .unwrap();

        s.clear_reading_history().unwrap();
        let last_read_at: Option<String> = s
            .conn
            .query_row(
                "SELECT last_read_at FROM favorites WHERE manga_id = ?1",
                ["m-legacy"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(last_read_at, None);
    }

    #[test]
    fn download_queue_flow() {
        let s = Store::open_in_memory().unwrap();

        let item1 = QueueItem {
            chapter_id: "ch-1".into(),
            manga_id: "m-1".into(),
            title: "Manga 1".into(),
            chapter_number: 1.0,
            status: "pending".into(),
            position: 0,
            added_at: Utc::now(),
        };
        let item2 = QueueItem {
            chapter_id: "ch-2".into(),
            manga_id: "m-1".into(),
            title: "Manga 1".into(),
            chapter_number: 2.0,
            status: "pending".into(),
            position: 1,
            added_at: Utc::now(),
        };
        let item3 = QueueItem {
            chapter_id: "ch-3".into(),
            manga_id: "m-1".into(),
            title: "Manga 1".into(),
            chapter_number: 3.0,
            status: "pending".into(),
            position: 2,
            added_at: Utc::now(),
        };

        // Insert 3 items
        s.queue_add(&item1).unwrap();
        s.queue_add(&item2).unwrap();
        s.queue_add(&item3).unwrap();

        let list = s.queue_list().unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].chapter_id, "ch-1");

        // Verify count: 3 pending, 3 total
        assert_eq!(s.queue_count().unwrap(), (3, 3));

        // Lowest position pending should be ch-1
        let next = s.queue_next_pending().unwrap().unwrap();
        assert_eq!(next.chapter_id, "ch-1");

        // Reorder: ch-3, ch-1, ch-2
        s.queue_reorder(&["ch-3".into(), "ch-1".into(), "ch-2".into()]).unwrap();
        let list_reordered = s.queue_list().unwrap();
        assert_eq!(list_reordered[0].chapter_id, "ch-3");
        assert_eq!(list_reordered[1].chapter_id, "ch-1");
        assert_eq!(list_reordered[2].chapter_id, "ch-2");

        // Now lowest position pending should be ch-3
        let next2 = s.queue_next_pending().unwrap().unwrap();
        assert_eq!(next2.chapter_id, "ch-3");

        // Update status of ch-3 to 'downloading'
        s.queue_update_status("ch-3", "downloading").unwrap();
        assert_eq!(s.queue_count().unwrap(), (2, 3));

        // Next pending should now be ch-1
        let next3 = s.queue_next_pending().unwrap().unwrap();
        assert_eq!(next3.chapter_id, "ch-1");

        // Remove ch-3
        s.queue_remove("ch-3").unwrap();
        assert_eq!(s.queue_list().unwrap().len(), 2);
        assert_eq!(s.queue_count().unwrap(), (2, 2));

        // Mark ch-1 as 'done' and test queue_clear_done
        s.queue_update_status("ch-1", "done").unwrap();
        assert_eq!(s.queue_count().unwrap(), (1, 2));
        s.queue_clear_done().unwrap();
        let list_after_clear = s.queue_list().unwrap();
        assert_eq!(list_after_clear.len(), 1);
        assert_eq!(list_after_clear[0].chapter_id, "ch-2");

        // Auto-assign position with negative position (-1)
        let item4 = QueueItem {
            chapter_id: "ch-4".into(),
            manga_id: "m-1".into(),
            title: "Manga 1".into(),
            chapter_number: 4.0,
            status: "pending".into(),
            position: -1,
            added_at: Utc::now(),
        };
        s.queue_add(&item4).unwrap();
        let next4 = s.queue_list().unwrap();
        assert_eq!(next4.len(), 2);
        assert_eq!(next4[1].chapter_id, "ch-4");
        assert!(next4[1].position > next4[0].position);
    }

    #[test]
    fn queue_reset_downloading_moves_active_items_back_to_pending() {
        let s = Store::open_in_memory().unwrap();
        for (chapter_id, status, position) in [
            ("ch-pending", "pending", 0),
            ("ch-downloading-1", "downloading", 1),
            ("ch-error", "error", 2),
            ("ch-downloading-2", "downloading", 3),
        ] {
            s.queue_add(&QueueItem {
                chapter_id: chapter_id.into(),
                manga_id: "m-1".into(),
                title: "Manga 1".into(),
                chapter_number: position as f64,
                status: status.into(),
                position,
                added_at: Utc::now(),
            })
            .unwrap();
        }

        assert_eq!(s.queue_reset_downloading().unwrap(), 2);
        let statuses: HashMap<String, String> = s
            .queue_list()
            .unwrap()
            .into_iter()
            .map(|item| (item.chapter_id, item.status))
            .collect();
        assert_eq!(statuses.get("ch-pending").map(String::as_str), Some("pending"));
        assert_eq!(statuses.get("ch-downloading-1").map(String::as_str), Some("pending"));
        assert_eq!(statuses.get("ch-downloading-2").map(String::as_str), Some("pending"));
        assert_eq!(statuses.get("ch-error").map(String::as_str), Some("error"));
        assert_eq!(s.queue_reset_downloading().unwrap(), 0);
    }

    #[test]
    fn history_search_and_delete_item() {
        let s = Store::open_in_memory().unwrap();
        s.save_manga_meta("m-1", "Solo Leveling", None, None).unwrap();
        s.save_manga_meta("m-2", "Tower of God", None, None).unwrap();
        s.save_manga_meta("m-3", "Omniscient Reader", None, None).unwrap();

        s.save_reading_progress("m-1", "ch-1", 1.0, 5, 0).unwrap();
        s.save_reading_progress("m-2", "ch-10", 10.0, 12, 0).unwrap();
        s.save_reading_progress("m-3", "ch-50", 50.0, 20, 0).unwrap();

        // Search for one title -> 1 result
        let search_res = s.search_history("Tower", 10).unwrap();
        assert_eq!(search_res.len(), 1);
        assert_eq!(search_res[0].manga_id, "m-2");
        assert_eq!(search_res[0].title, "Tower of God");

        // Delete it
        s.delete_history_item("m-2", "ch-10").unwrap();

        // 0 results for that search
        let search_after = s.search_history("Tower", 10).unwrap();
        assert_eq!(search_after.len(), 0);

        // list_history -> 2 remaining
        let remaining = s.list_history(10).unwrap();
        assert_eq!(remaining.len(), 2);
    }

    #[test]
    fn test_reading_progress_read_duration() {
        let s = Store::open_in_memory().unwrap();
        s.save_reading_progress("manga-x", "ch-1", 1.0, 5, 45).unwrap();
        let p = s.get_last_reading_progress("manga-x").unwrap().unwrap();
        assert_eq!(p.chapter_id, "ch-1");
        assert_eq!(p.last_page, 5);
        assert_eq!(p.read_duration, 45);

        // Update read duration on conflict
        s.save_reading_progress("manga-x", "ch-1", 1.0, 10, 120).unwrap();
        let p2 = s.get_last_reading_progress("manga-x").unwrap().unwrap();
        assert_eq!(p2.last_page, 10);
        assert_eq!(p2.read_duration, 120);

        let all = s.list_all_last_reading().unwrap();
        assert_eq!(all.get("manga-x").unwrap().read_duration, 120);
    }

    #[test]
    fn chapter_bookmark_flow() {
        let s = Store::open_in_memory().unwrap();

        // Initial list is empty
        let initial = s.list_bookmarked_chapter_ids("manga-1").unwrap();
        assert!(initial.is_empty());

        // Set bookmark for chapter 1 and 2
        s.set_chapter_bookmark("manga-1", "ch-1", 1.0, true).unwrap();
        s.set_chapter_bookmark("manga-1", "ch-2", 2.0, true).unwrap();
        // Also bookmark for another manga
        s.set_chapter_bookmark("manga-2", "ch-3", 1.0, true).unwrap();

        // List bookmarks for manga-1
        let bookmarked = s.list_bookmarked_chapter_ids("manga-1").unwrap();
        assert_eq!(bookmarked.len(), 2);
        assert!(bookmarked.contains("ch-1"));
        assert!(bookmarked.contains("ch-2"));

        // List bookmarks for manga-2
        let bookmarked_m2 = s.list_bookmarked_chapter_ids("manga-2").unwrap();
        assert_eq!(bookmarked_m2.len(), 1);
        assert!(bookmarked_m2.contains("ch-3"));

        // Unset bookmark for chapter 1
        s.set_chapter_bookmark("manga-1", "ch-1", 1.0, false).unwrap();
        let remaining = s.list_bookmarked_chapter_ids("manga-1").unwrap();
        assert_eq!(remaining.len(), 1);
        assert!(!remaining.contains("ch-1"));
        assert!(remaining.contains("ch-2"));

        // Unset again (idempotent)
        s.set_chapter_bookmark("manga-1", "ch-1", 1.0, false).unwrap();
        let remaining_again = s.list_bookmarked_chapter_ids("manga-1").unwrap();
        assert_eq!(remaining_again.len(), 1);
    }

    #[test]
    fn test_get_statistics() {
        let s = Store::open_in_memory().unwrap();

        // Initially empty
        let initial_stats = s.get_statistics().unwrap();
        assert_eq!(initial_stats.total_favorites, 0);
        assert_eq!(initial_stats.read_duration, 0);
        assert_eq!(initial_stats.manga_finished, 0);
        assert_eq!(initial_stats.total_chapters, 0);
        assert_eq!(initial_stats.total_read_chapters, 0);
        assert_eq!(initial_stats.total_downloads, 0);

        // Add 2 favorites: manga-1 (latest ch 10), manga-2 (latest ch 5)
        s.upsert_favorite(&fav("manga-1", 10.0)).unwrap();
        s.upsert_favorite(&fav("manga-2", 5.0)).unwrap();

        // Add chapters to cache
        let chapters = vec![
            ChapterItem {
                chapter_id: "ch-1".into(),
                manga_id: "manga-1".into(),
                chapter_number: 1.0,
                chapter_title: Some("Ch 1".into()),
                thumbnail_image_url: None,
                view_count: None,
                release_date: None,
            },
            ChapterItem {
                chapter_id: "ch-10".into(),
                manga_id: "manga-1".into(),
                chapter_number: 10.0,
                chapter_title: Some("Ch 10".into()),
                thumbnail_image_url: None,
                view_count: None,
                release_date: None,
            },
            ChapterItem {
                chapter_id: "ch-2-1".into(),
                manga_id: "manga-2".into(),
                chapter_number: 1.0,
                chapter_title: Some("Ch 1".into()),
                thumbnail_image_url: None,
                view_count: None,
                release_date: None,
            },
        ];
        s.save_chapters(&chapters).unwrap();

        // Save reading progress:
        // manga-1 ch-10 (finished!) with 120s duration
        s.save_reading_progress("manga-1", "ch-10", 10.0, 10, 120).unwrap();
        // manga-2 ch-2-1 (not finished) with 30s duration
        s.save_reading_progress("manga-2", "ch-2-1", 1.0, 5, 30).unwrap();

        // Mark chapters read
        s.mark_chapter_read("manga-1", "ch-10", 10.0, true).unwrap();
        s.mark_chapter_read("manga-2", "ch-2-1", 1.0, true).unwrap();

        // Add 1 download
        s.save_download(&Download {
            chapter_id: "ch-10".into(),
            manga_id: "manga-1".into(),
            chapter_number: 10.0,
            dir: "downloads/ch-10".into(),
            pages: 15,
            bytes: 10240,
            done_at: Utc::now(),
        }).unwrap();

        let stats = s.get_statistics().unwrap();
        assert_eq!(stats.total_favorites, 2);
        assert_eq!(stats.read_duration, 150);
        assert_eq!(stats.total_read_duration, 150);
        assert_eq!(stats.manga_finished, 1);
        assert_eq!(stats.total_chapters, 3);
        assert_eq!(stats.total_read_chapters, 2);
        assert_eq!(stats.total_downloads, 1);
    }

    #[test]
    fn test_category_system_names_and_clear_cache() {
        let s = Store::open_in_memory().unwrap();

        // 1. System names "Semua" and "Bawaan" must be rejected
        assert!(s.create_category("Semua").is_err());
        assert!(s.create_category("semua").is_err());
        assert!(s.create_category("  Bawaan  ").is_err());
        assert!(s.create_category("").is_err());

        let cat = s.create_category("Action").unwrap();
        assert!(s.rename_category(cat.id, "Semua").is_err());
        assert!(s.rename_category(cat.id, "Bawaan").is_err());
        assert!(s.rename_category(cat.id, "Action Shonen").is_ok());

        // 2. Clear chapter cache
        let chapters = vec![
            ChapterItem {
                chapter_id: "ch-1".into(),
                manga_id: "m-1".into(),
                chapter_number: 1.0,
                chapter_title: Some("Chapter 1".into()),
                thumbnail_image_url: None,
                view_count: None,
                release_date: None,
            },
        ];
        s.save_chapters(&chapters).unwrap();
        let cleared = s.clear_chapter_cache().unwrap();
        assert_eq!(cleared, 1);
        let cleared_again = s.clear_chapter_cache().unwrap();
        assert_eq!(cleared_again, 0);
    }
}


