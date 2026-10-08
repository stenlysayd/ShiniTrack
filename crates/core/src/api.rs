use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, REFERER};
use serde::de::DeserializeOwned;

use crate::error::{Error, Result};
use crate::models::{ChapterDetail, ChapterItem, Envelope, Manga, Meta, Page};

pub const DEFAULT_BASE: &str = "https://api.shngm.io/v1";
pub const SITE_REFERER: &str = "https://shinigami.id/";
pub const USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/// Async client for the unofficial Shinigami API.
///
/// Cheap to clone (the inner `reqwest::Client` is reference counted).
#[derive(Clone)]
pub struct ShinigamiClient {
    http: reqwest::Client,
    base: String,
}

impl ShinigamiClient {
    pub fn new() -> Result<Self> {
        Self::with_base(DEFAULT_BASE)
    }

    pub fn with_base(base: impl Into<String>) -> Result<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(REFERER, HeaderValue::from_static(SITE_REFERER));
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(35))
            .gzip(true)
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
        })
    }

    /// The underlying HTTP client (already carries the required `Referer`).
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<(T, Meta)> {
        let mut last_err = None;
        let url = format!("{}{}", self.base, path);
        for attempt in 0..2 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(600)).await;
            }
            let resp = match self.http.get(&url).query(query).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = Some(Error::Http(e));
                    continue;
                }
            };
            let status = resp.status();
            if !status.is_success() {
                last_err = Some(Error::Status(status.as_u16()));
                continue;
            }
            let env: Envelope<T> = match resp.json().await {
                Ok(env) => env,
                Err(e) => {
                    last_err = Some(Error::Http(e));
                    continue;
                }
            };
            if env.retcode != 0 {
                return Err(Error::Api {
                    code: env.retcode,
                    message: env.message,
                });
            }
            let data = env.data.ok_or(Error::Empty)?;
            return Ok((data, env.meta.unwrap_or_default()));
        }
        Err(last_err.unwrap_or(Error::Empty))
    }

    /// Most recently updated series, newest first (sorted by
    /// `latest_chapter_time`). One request covers every series, which is what
    /// makes 1-second polling feasible.
    pub async fn latest_feed(&self, page_size: u32) -> Result<Vec<Manga>> {
        let q = [
            ("page", "1".to_string()),
            ("page_size", page_size.to_string()),
            ("sort", "latest".to_string()),
        ];
        Ok(self.get::<Vec<Manga>>("/manga/list", &q).await?.0)
    }

    pub async fn search(&self, query: &str, page: u32, page_size: u32) -> Result<Page<Manga>> {
        let q = [
            ("q", query.to_string()),
            ("page", page.to_string()),
            ("page_size", page_size.to_string()),
        ];
        let (items, meta) = self.get::<Vec<Manga>>("/manga/list", &q).await?;
        Ok(Page { items, meta })
    }

    pub async fn detail(&self, manga_id: &str) -> Result<Manga> {
        Ok(self
            .get::<Manga>(&format!("/manga/detail/{manga_id}"), &[])
            .await?
            .0)
    }

    /// Chapters of a series, newest first.
    pub async fn chapters(
        &self,
        manga_id: &str,
        page: u32,
        page_size: u32,
    ) -> Result<Page<ChapterItem>> {
        let q = [
            ("page", page.to_string()),
            ("page_size", page_size.to_string()),
            ("sort_by", "chapter_number".to_string()),
            ("sort_order", "desc".to_string()),
        ];
        let (items, meta) = self
            .get::<Vec<ChapterItem>>(&format!("/chapter/{manga_id}/list"), &q)
            .await?;
        Ok(Page { items, meta })
    }

    pub async fn chapter_detail(&self, chapter_id: &str) -> Result<ChapterDetail> {
        Ok(self
            .get::<ChapterDetail>(&format!("/chapter/detail/{chapter_id}"), &[])
            .await?
            .0)
    }

    /// Downloads an asset (page image / cover) with the site referer.
    pub async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let mut last_err = None;
        for attempt in 0..2 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            let resp = match self.http.get(url).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = Some(Error::Http(e));
                    continue;
                }
            };
            let status = resp.status();
            if !status.is_success() {
                last_err = Some(Error::Status(status.as_u16()));
                continue;
            }
            match resp.bytes().await {
                Ok(b) => return Ok(b.to_vec()),
                Err(e) => {
                    last_err = Some(Error::Http(e));
                    continue;
                }
            }
        }
        Err(last_err.unwrap_or(Error::Empty))
    }
}

#[cfg(test)]
mod live_tests {
    //! Hit the real API. Run manually: `cargo test -p shinitrack-core -- --ignored`
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn api_live_feed_search_detail_chapters() {
        let c = ShinigamiClient::new().unwrap();

        let feed = c.latest_feed(5).await.unwrap();
        assert!(!feed.is_empty());
        let times: Vec<_> = feed.iter().filter_map(|m| m.latest_chapter_time).collect();
        assert!(times.windows(2).all(|w| w[0] >= w[1]), "feed must be newest first");

        let found = c.search("solo", 1, 3).await.unwrap();
        assert!(!found.items.is_empty());

        let id = &feed[0].manga_id;
        let d = c.detail(id).await.unwrap();
        assert_eq!(&d.manga_id, id);

        let ch = c.chapters(id, 1, 5).await.unwrap();
        assert!(!ch.items.is_empty());

        let cd = c.chapter_detail(&ch.items[0].chapter_id).await.unwrap();
        assert!(!cd.image_urls(false).is_empty());
    }
}
