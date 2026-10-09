use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::{HeaderMap, HeaderValue, REFERER};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::error::{Error, NetKind, Result};
use crate::models::{ChapterDetail, ChapterItem, Envelope, Manga, Meta, Page};

pub const DEFAULT_BASE: &str = "https://api.shngm.io/v1";
pub const SITE_REFERER: &str = "https://shinigami.id/";
pub const USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DohMode {
    Auto,
    Off,
    Cloudflare,
    Google,
}

impl DohMode {
    pub fn from_str_opt(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "off" => DohMode::Off,
            "cloudflare" => DohMode::Cloudflare,
            "google" => DohMode::Google,
            _ => DohMode::Auto,
        }
    }
}

#[derive(Deserialize)]
struct DohAnswer {
    #[serde(rename = "type")]
    type_id: u16,
    data: String,
}

#[derive(Deserialize)]
struct DohResponse {
    #[serde(default)]
    #[serde(rename = "Answer")]
    answer: Vec<DohAnswer>,
}

pub fn parse_doh_json(json_str: &str) -> Vec<IpAddr> {
    let Ok(resp) = serde_json::from_str::<DohResponse>(json_str) else {
        return Vec::new();
    };
    resp.answer
        .into_iter()
        .filter(|a| a.type_id == 1) // Type 1 is DNS A record
        .filter_map(|a| a.data.trim().parse::<IpAddr>().ok())
        .collect()
}

fn is_bad_addr(addr: &IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_unspecified(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
    }
}

pub struct DohResolver {
    mode: Arc<std::sync::RwLock<DohMode>>,
    doh_client: reqwest::Client,
}

impl DohResolver {
    pub fn new(mode: DohMode) -> Self {
        let doh_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        Self {
            mode: Arc::new(std::sync::RwLock::new(mode)),
            doh_client,
        }
    }

    pub fn set_mode(&self, mode: DohMode) {
        if let Ok(mut lock) = self.mode.write() {
            *lock = mode;
        }
    }

    pub fn get_mode(&self) -> DohMode {
        self.mode.read().map(|m| *m).unwrap_or(DohMode::Auto)
    }
}

impl Resolve for DohResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let mode = self.get_mode();
        let client = self.doh_client.clone();

        Box::pin(async move {
            let mut ips: Vec<IpAddr> = Vec::new();

            if mode == DohMode::Off {
                // (1) System DNS only
                if let Ok(addrs) = tokio::net::lookup_host(format!("{}:443", host)).await {
                    ips = addrs.map(|s| s.ip()).collect();
                }
            } else if mode == DohMode::Cloudflare {
                ips = query_cloudflare(&client, &host).await;
            } else if mode == DohMode::Google {
                ips = query_google(&client, &host).await;
            } else {
                // Auto mode:
                // (1) System lookup with 4s timeout
                let sys_lookup = tokio::time::timeout(
                    Duration::from_secs(4),
                    tokio::net::lookup_host(format!("{}:443", host)),
                )
                .await;

                if let Ok(Ok(addrs)) = sys_lookup {
                    let valid_ips: Vec<IpAddr> = addrs
                        .map(|s| s.ip())
                        .filter(|ip| !is_bad_addr(ip))
                        .collect();
                    if !valid_ips.is_empty() {
                        ips = valid_ips;
                    }
                }

                // (2) If failed or only loopback/unspecified -> Cloudflare DoH
                if ips.is_empty() {
                    ips = query_cloudflare(&client, &host).await;
                }

                // (3) If failed -> Google DoH
                if ips.is_empty() {
                    ips = query_google(&client, &host).await;
                }
            }

            if ips.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("DNS resolution failed for {host}"),
                )) as Box<dyn std::error::Error + Send + Sync>);
            }

            let sock_addrs: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect();
            let addrs: Addrs = Box::new(sock_addrs.into_iter());
            Ok(addrs)
        })
    }
}

async fn query_cloudflare(client: &reqwest::Client, host: &str) -> Vec<IpAddr> {
    let url = format!("https://1.1.1.1/dns-query?name={}&type=A", host);
    if let Ok(resp) = client
        .get(&url)
        .header("accept", "application/dns-json")
        .send()
        .await
    {
        if let Ok(text) = resp.text().await {
            return parse_doh_json(&text);
        }
    }
    Vec::new()
}

async fn query_google(client: &reqwest::Client, host: &str) -> Vec<IpAddr> {
    let url = format!("https://8.8.8.8/resolve?name={}&type=A", host);
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(text) = resp.text().await {
            return parse_doh_json(&text);
        }
    }
    Vec::new()
}

/// Async client for the unofficial Shinigami API.
///
/// Cheap to clone (the inner `reqwest::Client` is reference counted).
#[derive(Clone)]
pub struct ShinigamiClient {
    http: reqwest::Client,
    base: String,
    resolver: Arc<DohResolver>,
}

impl ShinigamiClient {
    pub fn new() -> Result<Self> {
        Self::with_base_and_doh(DEFAULT_BASE, DohMode::Auto)
    }

    pub fn with_base(base: impl Into<String>) -> Result<Self> {
        Self::with_base_and_doh(base, DohMode::Auto)
    }

    pub fn with_base_and_doh(base: impl Into<String>, doh_mode: DohMode) -> Result<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(REFERER, HeaderValue::from_static(SITE_REFERER));
        let resolver = Arc::new(DohResolver::new(doh_mode));
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .dns_resolver(resolver.clone())
            .gzip(true)
            .build()?;
        Ok(Self {
            http,
            base: base.into().trim_end_matches('/').to_string(),
            resolver,
        })
    }

    pub fn set_doh_mode(&self, mode: DohMode) {
        self.resolver.set_mode(mode);
    }

    pub fn doh_mode(&self) -> DohMode {
        self.resolver.get_mode()
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
                    let err: Error = e.into();
                    let can_retry = matches!(
                        &err,
                        Error::Net {
                            kind: NetKind::Connect | NetKind::Timeout | NetKind::Dns,
                            ..
                        }
                    );
                    last_err = Some(err);
                    if can_retry {
                        continue;
                    } else {
                        break;
                    }
                }
            };
            let status = resp.status();
            if !status.is_success() {
                let code = status.as_u16();
                last_err = Some(Error::Status(code));
                if code >= 500 && code < 600 {
                    continue;
                } else {
                    break;
                }
            }
            let env: Envelope<T> = match resp.json().await {
                Ok(env) => env,
                Err(e) => {
                    last_err = Some(e.into());
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
                tokio::time::sleep(Duration::from_millis(600)).await;
            }
            let resp = match self.http.get(url).send().await {
                Ok(r) => r,
                Err(e) => {
                    let err: Error = e.into();
                    let can_retry = matches!(
                        &err,
                        Error::Net {
                            kind: NetKind::Connect | NetKind::Timeout | NetKind::Dns,
                            ..
                        }
                    );
                    last_err = Some(err);
                    if can_retry {
                        continue;
                    } else {
                        break;
                    }
                }
            };
            let status = resp.status();
            if !status.is_success() {
                let code = status.as_u16();
                last_err = Some(Error::Status(code));
                if code >= 500 && code < 600 {
                    continue;
                } else {
                    break;
                }
            }
            match resp.bytes().await {
                Ok(b) => return Ok(b.to_vec()),
                Err(e) => {
                    last_err = Some(e.into());
                    continue;
                }
            }
        }
        Err(last_err.unwrap_or(Error::Empty))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_doh_json_cloudflare() {
        let json = r#"{
            "Status": 0,
            "TC": false,
            "RD": true,
            "RA": true,
            "AD": false,
            "CD": false,
            "Question": [{"name": "api.shngm.io.", "type": 1}],
            "Answer": [
                {"name": "api.shngm.io.", "type": 1, "TTL": 300, "data": "104.21.49.201"},
                {"name": "api.shngm.io.", "type": 1, "TTL": 300, "data": "172.67.182.204"}
            ]
        }"#;
        let ips = parse_doh_json(json);
        assert_eq!(ips.len(), 2);
        assert_eq!(ips[0], "104.21.49.201".parse::<IpAddr>().unwrap());
        assert_eq!(ips[1], "172.67.182.204".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn test_parse_doh_json_google() {
        let json = r#"{
            "Status": 0,
            "TC": false,
            "RD": true,
            "RA": true,
            "AD": false,
            "CD": false,
            "Question": [{"name": "shinigami.id.", "type": 1}],
            "Answer": [
                {"name": "shinigami.id.", "type": 1, "TTL": 300, "data": "188.114.96.3"},
                {"name": "shinigami.id.", "type": 28, "TTL": 300, "data": "2a06:98c1:3121::3"}
            ]
        }"#;
        let ips = parse_doh_json(json);
        assert_eq!(ips.len(), 1); // Only type 1 (A record)
        assert_eq!(ips[0], "188.114.96.3".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn test_parse_doh_json_empty_or_malformed() {
        assert_eq!(parse_doh_json("{}").len(), 0);
        assert_eq!(parse_doh_json("invalid json").len(), 0);
    }
}
