use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::{HeaderMap, HeaderValue, REFERER};
use serde::de::DeserializeOwned;

use crate::error::{Error, HttpErrorKind, Result};
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
    doh_mode: Arc<RwLock<String>>,
}

impl ShinigamiClient {
    pub fn new() -> Result<Self> {
        Self::with_base(DEFAULT_BASE)
    }

    pub fn with_base(base: impl Into<String>) -> Result<Self> {
        let doh_mode = Arc::new(RwLock::new("auto".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(REFERER, HeaderValue::from_static(SITE_REFERER));
        let resolver = Arc::new(DohResolver::new(doh_mode.clone())?);
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .dns_resolver(resolver)
            .gzip(true)
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
            doh_mode,
        })
    }

    /// The underlying HTTP client (already carries the required `Referer`).
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn set_doh_mode(&self, mode: &str) {
        let normalized = match mode {
            "off" | "cloudflare" | "google" => mode,
            _ => "auto",
        };
        if let Ok(mut current) = self.doh_mode.write() {
            *current = normalized.to_string();
        }
    }

    pub fn base_host(&self) -> Option<String> {
        host_from_url(&self.base).map(|s| s.to_string())
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
                    let err = Error::from(e);
                    if attempt == 0 && should_retry(&err) {
                        last_err = Some(err);
                        continue;
                    }
                    return Err(err);
                }
            };
            let status = resp.status();
            if !status.is_success() {
                let err = Error::Status(status.as_u16());
                if attempt == 0 && should_retry(&err) {
                    last_err = Some(err);
                    continue;
                }
                return Err(err);
            }
            let env: Envelope<T> = match resp.json().await {
                Ok(env) => env,
                Err(e) => {
                    let err = Error::from(e);
                    if attempt == 0 && should_retry(&err) {
                        last_err = Some(err);
                        continue;
                    }
                    return Err(err);
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
                    let err = Error::from(e);
                    if attempt == 0 && should_retry(&err) {
                        last_err = Some(err);
                        continue;
                    }
                    return Err(err);
                }
            };
            let status = resp.status();
            if !status.is_success() {
                let err = Error::Status(status.as_u16());
                if attempt == 0 && should_retry(&err) {
                    last_err = Some(err);
                    continue;
                }
                return Err(err);
            }
            match resp.bytes().await {
                Ok(b) => return Ok(b.to_vec()),
                Err(e) => {
                    let err = Error::from(e);
                    if attempt == 0 && should_retry(&err) {
                        last_err = Some(err);
                        continue;
                    }
                    return Err(err);
                }
            }
        }
        Err(last_err.unwrap_or(Error::Empty))
    }
}

fn should_retry(err: &Error) -> bool {
    match err {
        Error::Status(code) => *code >= 500,
        Error::Http(e) => matches!(
            e.kind(),
            HttpErrorKind::Dns | HttpErrorKind::Connect | HttpErrorKind::Timeout
        ),
        _ => false,
    }
}

fn host_from_url(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    rest.split(['/', ':', '?']).next()
}

#[derive(Clone)]
pub struct DohResolver {
    mode: Arc<RwLock<String>>,
    client: reqwest::Client,
}

impl DohResolver {
    pub fn new(mode: Arc<RwLock<String>>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .connect_timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self { mode, client })
    }

    fn mode(&self) -> String {
        self.mode
            .read()
            .map(|m| m.clone())
            .unwrap_or_else(|_| "auto".to_string())
    }
}

impl Resolve for DohResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().trim_end_matches('.').to_string();
        let mode = self.mode();
        let client = self.client.clone();
        Box::pin(async move {
            let ips = resolve_host_with_mode(&client, &host, &mode)
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                    std::io::Error::new(std::io::ErrorKind::Other, e).into()
                })?;
            let addrs: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect();
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

pub async fn resolve_host_with_mode(
    client: &reqwest::Client,
    host: &str,
    mode: &str,
) -> std::result::Result<Vec<IpAddr>, String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![ip]);
    }
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(vec![IpAddr::from([127, 0, 0, 1])]);
    }

    match mode {
        "off" => system_lookup(host).await,
        "cloudflare" => doh_lookup(client, DohProvider::Cloudflare, host).await,
        "google" => doh_lookup(client, DohProvider::Google, host).await,
        _ => {
            match tokio::time::timeout(Duration::from_secs(4), system_lookup(host)).await {
                Ok(Ok(ips)) if has_public_ips(&ips) => Ok(ips),
                _ => match doh_lookup(client, DohProvider::Cloudflare, host).await {
                    Ok(ips) => Ok(ips),
                    Err(_) => doh_lookup(client, DohProvider::Google, host).await,
                },
            }
        }
    }
}

async fn system_lookup(host: &str) -> std::result::Result<Vec<IpAddr>, String> {
    let addrs = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|e| format!("DNS sistem gagal: {e}"))?;
    let mut ips = Vec::new();
    for addr in addrs {
        let ip = addr.ip();
        if !ips.contains(&ip) {
            ips.push(ip);
        }
    }
    if ips.is_empty() {
        Err("DNS sistem tidak mengembalikan IP".to_string())
    } else {
        Ok(ips)
    }
}

fn has_public_ips(ips: &[IpAddr]) -> bool {
    ips.iter().any(|ip| match ip {
        IpAddr::V4(ip) => !ip.is_loopback() && !ip.is_unspecified(),
        IpAddr::V6(ip) => !ip.is_loopback() && !ip.is_unspecified(),
    })
}

enum DohProvider {
    Cloudflare,
    Google,
}

async fn doh_lookup(
    client: &reqwest::Client,
    provider: DohProvider,
    host: &str,
) -> std::result::Result<Vec<IpAddr>, String> {
    let url = match provider {
        DohProvider::Cloudflare => format!("https://1.1.1.1/dns-query?name={host}&type=A"),
        DohProvider::Google => format!("https://8.8.8.8/resolve?name={host}&type=A"),
    };
    let text = client
        .get(url)
        .header("accept", "application/dns-json")
        .send()
        .await
        .map_err(|e| format!("DNS-over-HTTPS gagal: {e}"))?
        .error_for_status()
        .map_err(|e| format!("DNS-over-HTTPS status gagal: {e}"))?
        .text()
        .await
        .map_err(|e| format!("DNS-over-HTTPS tidak dapat dibaca: {e}"))?;
    let ips = parse_doh_json(&text);
    if ips.is_empty() {
        Err("DNS-over-HTTPS tidak mengembalikan IP".to_string())
    } else {
        Ok(ips)
    }
}

pub async fn resolve_doh_auto(host: &str) -> std::result::Result<Vec<IpAddr>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| e.to_string())?;
    match doh_lookup(&client, DohProvider::Cloudflare, host).await {
        Ok(ips) => Ok(ips),
        Err(_) => doh_lookup(&client, DohProvider::Google, host).await,
    }
}

pub fn parse_doh_json(json: &str) -> Vec<IpAddr> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(answers) = value.get("Answer").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut ips = Vec::new();
    for answer in answers {
        if answer.get("type").and_then(|v| v.as_u64()) != Some(1) {
            continue;
        }
        if let Some(data) = answer.get("data").and_then(|v| v.as_str()) {
            if let Ok(ip) = data.parse::<IpAddr>() {
                ips.push(ip);
            }
        }
    }
    ips
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_doh_json_cloudflare() {
        let json = r#"{
            "Status": 0,
            "Answer": [
                {"name":"api.shngm.io","type":1,"TTL":300,"data":"104.21.10.10"},
                {"name":"api.shngm.io","type":28,"TTL":300,"data":"2606:4700::1"}
            ]
        }"#;
        assert_eq!(parse_doh_json(json), vec![IpAddr::from([104, 21, 10, 10])]);
    }

    #[test]
    fn parse_doh_json_google() {
        let json = r#"{
            "Status": 0,
            "TC": false,
            "RD": true,
            "RA": true,
            "Answer": [
                {"name":"assets.shngm.id.","type":5,"TTL":120,"data":"cdn.example."},
                {"name":"assets.shngm.id.","type":1,"TTL":120,"data":"172.67.20.20"}
            ]
        }"#;
        assert_eq!(parse_doh_json(json), vec![IpAddr::from([172, 67, 20, 20])]);
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
