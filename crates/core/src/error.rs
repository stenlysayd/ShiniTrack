use thiserror::Error;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum NetKind {
    Dns,
    Connect,
    Timeout,
    Tls,
    Status(u16),
    Decode,
    Other,
}

impl NetKind {
    pub fn label(&self) -> &'static str {
        match self {
            NetKind::Dns => "DNS",
            NetKind::Connect => "Connect",
            NetKind::Timeout => "Timeout",
            NetKind::Tls => "TLS",
            NetKind::Status(_) => "Status",
            NetKind::Decode => "Decode",
            NetKind::Other => "Lainnya",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            NetKind::Dns => "Domain tidak bisa ditemukan. Kemungkinan diblokir DNS operator.".into(),
            NetKind::Connect => "Tidak bisa tersambung ke server.".into(),
            NetKind::Timeout => "Server terlalu lama merespons.".into(),
            NetKind::Tls => "Sambungan aman gagal (sertifikat/TLS).".into(),
            NetKind::Status(code) if *code == 403 || *code == 429 => {
                format!("Server menolak permintaan (kode {code}).")
            }
            NetKind::Status(code) if *code >= 500 && *code < 600 => {
                format!("Server bermasalah (kode {code}).")
            }
            NetKind::Status(code) => format!("Server mengembalikan status {code}."),
            NetKind::Decode => "Format respons dari server tidak valid.".into(),
            NetKind::Other => "Terjadi kesalahan koneksi.".into(),
        }
    }
}

pub fn classify_reqwest_error(e: &reqwest::Error) -> NetKind {
    if let Some(status) = e.status() {
        return NetKind::Status(status.as_u16());
    }
    if e.is_timeout() {
        return NetKind::Timeout;
    }
    if e.is_decode() {
        return NetKind::Decode;
    }
    let mut text = e.to_string().to_lowercase();
    let mut curr: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(e);
    while let Some(src) = curr {
        text.push(' ');
        text.push_str(&src.to_string().to_lowercase());
        curr = src.source();
    }
    if text.contains("dns error")
        || text.contains("failed to lookup")
        || text.contains("name or service not known")
        || text.contains("no such host")
    {
        NetKind::Dns
    } else if text.contains("certificate")
        || text.contains("tls")
        || text.contains("handshake")
        || text.contains("ssl")
    {
        NetKind::Tls
    } else if e.is_connect() {
        NetKind::Connect
    } else {
        NetKind::Other
    }
}

#[derive(Debug, Error)]
pub enum Error {
    #[error("{message}")]
    Net {
        kind: NetKind,
        host: String,
        message: String,
    },

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

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        let host = e
            .url()
            .and_then(|u| u.host_str())
            .unwrap_or("server")
            .to_string();
        let kind = classify_reqwest_error(&e);
        let message = format!("{}  [{} · {} ]", kind.user_message(), host, kind.label());
        Error::Net {
            kind,
            host,
            message,
        }
    }
}

impl Error {
    /// True when the remote side asked us to slow down (HTTP 429) or is
    /// temporarily unavailable (5xx). Pollers should back off on these.
    pub fn should_back_off(&self) -> bool {
        match self {
            Error::Status(code) => *code == 429 || *code >= 500,
            Error::Net { kind, .. } => {
                matches!(kind, NetKind::Status(c) if *c == 429 || *c >= 500)
                    || matches!(kind, NetKind::Timeout | NetKind::Connect)
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_net_kind_messages() {
        assert_eq!(
            NetKind::Dns.user_message(),
            "Domain tidak bisa ditemukan. Kemungkinan diblokir DNS operator."
        );
        assert_eq!(
            NetKind::Connect.user_message(),
            "Tidak bisa tersambung ke server."
        );
        assert_eq!(
            NetKind::Timeout.user_message(),
            "Server terlalu lama merespons."
        );
        assert_eq!(
            NetKind::Tls.user_message(),
            "Sambungan aman gagal (sertifikat/TLS)."
        );
        assert_eq!(
            NetKind::Status(403).user_message(),
            "Server menolak permintaan (kode 403)."
        );
        assert_eq!(
            NetKind::Status(502).user_message(),
            "Server bermasalah (kode 502)."
        );
    }
}
