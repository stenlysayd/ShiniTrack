use std::error::Error as StdError;
use std::fmt;

use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Http(HttpError),

    #[error("HTTP status {0}")]
    Status(u16),

    #[error("API error (retcode {code}): {message}")]
    Api { code: i64, message: String },

    #[error("API returned no data")]
    Empty,

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    /// True when the remote side asked us to slow down (HTTP 429) or is
    /// temporarily unavailable (5xx). Pollers should back off on these.
    pub fn should_back_off(&self) -> bool {
        match self {
            Error::Status(code) => *code == 429 || *code >= 500,
            Error::Http(e) => matches!(
                e.kind(),
                HttpErrorKind::Dns | HttpErrorKind::Connect | HttpErrorKind::Timeout
            ),
            _ => false,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(value: reqwest::Error) -> Self {
        Error::Http(HttpError(value))
    }
}

#[derive(Debug)]
pub struct HttpError(reqwest::Error);

impl HttpError {
    pub fn kind(&self) -> HttpErrorKind {
        classify_reqwest(&self.0)
    }
}

impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let host = self
            .0
            .url()
            .and_then(|u| u.host_str())
            .unwrap_or("host tujuan");
        match self.kind() {
            HttpErrorKind::Dns => write!(f, "DNS gagal untuk {host}"),
            HttpErrorKind::Connect => write!(f, "Tidak dapat terhubung ke {host}"),
            HttpErrorKind::Timeout => write!(f, "Koneksi ke {host} habis waktu"),
            HttpErrorKind::Tls => write!(f, "Koneksi aman ke {host} gagal"),
            HttpErrorKind::Status => {
                if let Some(status) = self.0.status() {
                    write!(f, "Server {host} mengembalikan status {status}")
                } else {
                    write!(f, "Server {host} mengembalikan status gagal")
                }
            }
            HttpErrorKind::Decode => write!(f, "Respons dari {host} tidak dapat dibaca"),
            HttpErrorKind::Other => write!(f, "Koneksi ke {host} bermasalah"),
        }
    }
}

impl StdError for HttpError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        self.0.source()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpErrorKind {
    Dns,
    Connect,
    Timeout,
    Tls,
    Status,
    Decode,
    Other,
}

pub fn classify_reqwest(error: &reqwest::Error) -> HttpErrorKind {
    if error.is_timeout() {
        return HttpErrorKind::Timeout;
    }
    if error.is_status() {
        return HttpErrorKind::Status;
    }
    if error.is_decode() {
        return HttpErrorKind::Decode;
    }

    let mut source = error.source();
    while let Some(err) = source {
        let text = err.to_string().to_ascii_lowercase();
        if text.contains("dns")
            || text.contains("lookup")
            || text.contains("name resolution")
            || text.contains("failed to resolve")
            || text.contains("failed to lookup")
        {
            return HttpErrorKind::Dns;
        }
        if text.contains("tls")
            || text.contains("ssl")
            || text.contains("certificate")
            || text.contains("rustls")
        {
            return HttpErrorKind::Tls;
        }
        source = err.source();
    }

    if error.is_connect() {
        return HttpErrorKind::Connect;
    }
    HttpErrorKind::Other
}
