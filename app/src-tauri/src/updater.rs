//! In-app GitHub Release updater for ShiniTrack (Mihon-style OTA updates).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const CURRENT_BUILD_CODE: u32 = 2003;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub download_url: Option<String>,
    pub apk_name: Option<String>,
    pub apk_size: Option<u64>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub progress: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallOutcome {
    pub success: bool,
    #[serde(rename = "needsPermission", default)]
    pub needs_permission: bool,
    pub message: String,
    #[serde(default)]
    pub file_path: String,
}

pub fn clean_github_repo(raw: &str) -> String {
    let mut s = raw.trim();
    if s.is_empty() || s.eq_ignore_ascii_case("shinitrack/shinitrack") {
        return "stenlysayd/ShiniTrack".to_string();
    }
    if let Some(rest) = s.strip_prefix("https://github.com/") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("http://github.com/") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("github.com/") {
        s = rest;
    }
    s = s.trim_end_matches(".git").trim_matches('/');
    if s.is_empty() || s.eq_ignore_ascii_case("shinitrack/shinitrack") {
        "stenlysayd/ShiniTrack".to_string()
    } else {
        s.to_string()
    }
}

pub fn parse_semver(s: &str) -> (u32, u32, u32) {
    let clean = s.trim().trim_start_matches('v').trim_start_matches('V');
    let mut parts = clean.split('.');
    let major = parts
        .next()
        .and_then(|x| x.split(|c: char| !c.is_numeric()).next())
        .and_then(|x| x.parse().ok())
        .unwrap_or(0);
    let minor = parts
        .next()
        .and_then(|x| x.split(|c: char| !c.is_numeric()).next())
        .and_then(|x| x.parse().ok())
        .unwrap_or(0);
    let patch = parts
        .next()
        .and_then(|x| x.split(|c: char| !c.is_numeric()).next())
        .and_then(|x| x.parse().ok())
        .unwrap_or(0);
    (major, minor, patch)
}

pub fn is_newer_version(current: &str, remote: &str) -> bool {
    let c = parse_semver(current);
    let r = parse_semver(remote);
    r > c
}

pub async fn check_github_release(
    repo: &str,
    current_version: &str,
) -> anyhow::Result<UpdateInfo> {
    let repo_clean = clean_github_repo(repo);
    let url = format!("https://api.github.com/repos/{repo_clean}/releases/latest");
    let client = reqwest::Client::builder()
        .user_agent(format!("ShiniTrack-App/{current_version}"))
        .timeout(std::time::Duration::from_secs(12))
        .build()?;

    let res = client.get(&url).send().await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if status.as_u16() == 404 {
            anyhow::bail!("Repository '{repo_clean}' tidak ditemukan atau belum memiliki rilis publik di GitHub.");
        }
        anyhow::bail!("GitHub API error ({status}): {body}");
    }

    let json: serde_json::Value = res.json().await?;
    let tag = json.get("tag_name").and_then(|v| v.as_str()).unwrap_or("0.0.0");
    let release_name = json
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(tag)
        .to_string();
    let release_notes = json.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let published_at = json.get("published_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let html_url = json.get("html_url").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let mut download_url = None;
    let mut apk_name = None;
    let mut apk_size = None;

    if let Some(assets) = json.get("assets").and_then(|a| a.as_array()) {
        for asset in assets {
            if let Some(name) = asset.get("name").and_then(|n| n.as_str()) {
                if name.to_lowercase().ends_with(".apk") {
                    apk_name = Some(name.to_string());
                    download_url = asset
                        .get("browser_download_url")
                        .and_then(|u| u.as_str())
                        .map(|s| s.to_string());
                    apk_size = asset.get("size").and_then(|s| s.as_u64());
                    break;
                }
            }
        }
    }

    let update_available = is_newer_version(current_version, tag);

    Ok(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: tag.to_string(),
        update_available,
        release_name,
        release_notes,
        published_at,
        download_url,
        apk_name,
        apk_size,
        html_url,
    })
}

pub fn mock_update_info(current_version: &str) -> UpdateInfo {
    UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: "v0.2.3".to_string(),
        update_available: true,
        release_name: "ShiniTrack v0.2.3 - Mihon UX Edition".to_string(),
        release_notes: "### Pembaruan v0.2.3\n- Perbaikan installer APK & izin install unknown sources otomatis\n- Notifikasi rich ala Mihon dengan cover art dan tombol aksi\n- Sinkronisasi URL target repository GitHub yang tepat".to_string(),
        published_at: chrono::Utc::now().to_rfc3339(),
        download_url: Some(
            "https://github.com/stenlysayd/ShiniTrack/releases/download/v0.2.3/ShiniTrack-v0.2.3.apk"
                .to_string(),
        ),
        apk_name: Some("ShiniTrack-v0.2.3.apk".to_string()),
        apk_size: Some(15980958),
        html_url: "https://github.com/stenlysayd/ShiniTrack/releases".to_string(),
    }
}

pub async fn download_and_install_apk<R: Runtime>(
    app: &AppHandle<R>,
    download_url: &str,
) -> anyhow::Result<InstallOutcome> {
    let client = reqwest::Client::builder()
        .user_agent(format!("ShiniTrack-App/{CURRENT_APP_VERSION}"))
        .build()?;
    let mut res = client.get(download_url).send().await?.error_for_status()?;
    let total_size = res.content_length().unwrap_or(0);

    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let updates_dir = cache_dir.join("updates");
    tokio::fs::create_dir_all(&updates_dir).await?;
    let target_path = updates_dir.join("shinitrack-update.apk");

    let mut file = tokio::fs::File::create(&target_path).await?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = res.chunk().await? {
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        downloaded += chunk.len() as u64;
        let progress = if total_size > 0 {
            ((downloaded as f64 / total_size as f64) * 100.0).min(100.0) as u8
        } else {
            0
        };
        let _ = app.emit(
            "update-download-progress",
            DownloadProgressPayload {
                progress,
                downloaded_bytes: downloaded,
                total_bytes: total_size,
            },
        );
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);

    let path_str = target_path.to_string_lossy().into_owned();
    log::info!("Update APK downloaded to: {path_str}");

    let mut outcome = install_apk_file(&path_str)?;
    outcome.file_path = path_str;
    Ok(outcome)
}

pub fn install_apk_file(apk_path: &str) -> anyhow::Result<InstallOutcome> {
    #[cfg(target_os = "android")]
    {
        crate::jni_bridge::trigger_install_apk(apk_path)
    }
    #[cfg(not(target_os = "android"))]
    {
        log::info!("Mock install on non-android platform: {apk_path}");
        Ok(InstallOutcome {
            success: true,
            needs_permission: false,
            message: format!("Mock installer dibuka untuk: {apk_path}"),
            file_path: apk_path.to_string(),
        })
    }
}

