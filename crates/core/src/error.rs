use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),

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
            Error::Http(e) => e.is_timeout() || e.is_connect(),
            _ => false,
        }
    }
}
