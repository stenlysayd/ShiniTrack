use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Every Shinigami response is wrapped as `{ retcode, message, meta, data }`.
#[derive(Debug, Deserialize)]
pub struct Envelope<T> {
    pub retcode: i64,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub meta: Option<Meta>,
    pub data: Option<T>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Meta {
    #[serde(default)]
    pub page: u32,
    #[serde(default)]
    pub page_size: u32,
    #[serde(default)]
    pub total_page: u32,
    #[serde(default)]
    pub total_record: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub meta: Meta,
}

/// A manga as returned by `/manga/list` and `/manga/detail/{id}`.
/// Fields are optional where the API has been observed to omit / null them.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Manga {
    pub manga_id: String,
    pub title: String,
    #[serde(default)]
    pub alternative_title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub cover_image_url: Option<String>,
    #[serde(default)]
    pub cover_portrait_url: Option<String>,
    #[serde(default)]
    pub latest_chapter_id: Option<String>,
    #[serde(default)]
    pub latest_chapter_number: Option<f64>,
    #[serde(default)]
    pub latest_chapter_time: Option<DateTime<Utc>>,
    #[serde(default)]
    pub status: Option<i64>,
    #[serde(default)]
    pub bookmark_count: Option<i64>,
    #[serde(default)]
    pub country_id: Option<String>,
}

impl Manga {
    pub fn cover(&self) -> Option<String> {
        self.cover_portrait_url
            .clone()
            .or_else(|| self.cover_image_url.clone())
    }
}

/// An item of `/chapter/{manga_id}/list`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChapterItem {
    pub chapter_id: String,
    pub manga_id: String,
    #[serde(default)]
    pub chapter_title: Option<String>,
    pub chapter_number: f64,
    #[serde(default)]
    pub thumbnail_image_url: Option<String>,
    #[serde(default)]
    pub view_count: Option<i64>,
    #[serde(default)]
    pub release_date: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChapterImages {
    pub path: String,
    #[serde(default)]
    pub data: Vec<String>,
}

/// `/chapter/detail/{chapter_id}`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChapterDetail {
    pub chapter_id: String,
    pub manga_id: String,
    pub chapter_number: f64,
    #[serde(default)]
    pub chapter_title: Option<String>,
    pub base_url: String,
    #[serde(default)]
    pub base_url_low: Option<String>,
    pub chapter: ChapterImages,
    #[serde(default)]
    pub prev_chapter_id: Option<String>,
    #[serde(default)]
    pub prev_chapter_number: Option<f64>,
    #[serde(default)]
    pub next_chapter_id: Option<String>,
    #[serde(default)]
    pub next_chapter_number: Option<f64>,
    #[serde(default)]
    pub release_date: Option<DateTime<Utc>>,
}

impl ChapterDetail {
    /// Full image URLs: `base_url + chapter.path + filename`.
    pub fn image_urls(&self, low_quality: bool) -> Vec<String> {
        let base = if low_quality {
            self.base_url_low.as_deref().unwrap_or(&self.base_url)
        } else {
            &self.base_url
        };
        let base = base.trim_end_matches('/');
        let path = self.chapter.path.trim_matches('/');
        self.chapter
            .data
            .iter()
            .map(|f| format!("{base}/{path}/{f}"))
            .collect()
    }
}

/// What we remember about a favorite to decide whether a feed entry is new.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct LastSeen {
    pub chapter_number: Option<f64>,
    pub chapter_time: Option<DateTime<Utc>>,
}

/// "A new chapter came out for one of your favorites."
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChapterEvent {
    pub manga_id: String,
    pub title: String,
    #[serde(default)]
    pub cover: Option<String>,
    pub chapter_id: String,
    pub chapter_number: f64,
    #[serde(default)]
    pub released_at: Option<DateTime<Utc>>,
}

impl ChapterEvent {
    /// Builds an event from a feed/detail entry. Returns `None` when the entry
    /// has no latest chapter (brand-new series without chapters).
    pub fn from_manga(m: &Manga) -> Option<Self> {
        Some(Self {
            manga_id: m.manga_id.clone(),
            title: m.title.clone(),
            cover: m.cover(),
            chapter_id: m.latest_chapter_id.clone()?,
            chapter_number: m.latest_chapter_number?,
            released_at: m.latest_chapter_time,
        })
    }

    /// Human-readable chapter number: `57` instead of `57.0`, keeps `12.5`.
    pub fn chapter_label(&self) -> String {
        format_chapter(self.chapter_number)
    }
}

pub fn format_chapter(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}
