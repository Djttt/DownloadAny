//! 元数据探测：yt-dlp -J（--dump-single-json，默认 simulate 不下载）。

use crate::{args, embedded_components, error::AppError, resolve};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use base64::Engine;
use std::collections::HashSet;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub id: String,
    pub label: String,
    pub height: Option<u32>,
    pub ext: Option<String>,
    pub filesize: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOption {
    pub id: String,
    pub label: String,
    pub url: String,
    pub ext: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub thumbnail_preview: Option<String>,
    pub uploader: Option<String>,
    pub webpage_url: Option<String>,
    #[serde(default)]
    pub images: Vec<ImageOption>,
    pub formats: Vec<FormatOption>,
}

pub struct ProbeResult {
    pub info: VideoInfo,
    /// 供入队时做 format_id 白名单校验
    pub valid_ids: HashSet<String>,
}

/// 探测命令行：与下载共用 `args::host_request_headers` 的站点头表，
/// 否则会出现"探测拿得到、下载拿不到"（或反之）的割裂。URL 收尾，防被当选项值。
fn probe_args(url: &str, proxy: Option<&str>, plugin_dir: Option<&Path>) -> Vec<String> {
    let mut argv: Vec<String> = vec![
        "-J".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--no-colors".into(),
    ];
    if let Some(dir) = plugin_dir {
        args::add_plugin_dir(&mut argv, dir);
    }
    // 探测与下载走同一代理，否则会出现"探测成功但下载连不上"（或反之）的割裂体验
    if let Some(p) = proxy {
        argv.extend(["--proxy".into(), p.into()]);
    }
    argv.extend(args::host_request_headers(url));
    argv.push(url.into());
    argv
}

pub async fn probe(url: &str, proxy: Option<&str>) -> Result<ProbeResult, AppError> {
    let program = resolve::yt_dlp();
    let mut cmd = program.command();
    let plugin_dir = embedded_components::ensure_ytdlp_plugins().ok();
    let argv = probe_args(url, proxy, plugin_dir.as_deref());
    cmd.args(argv)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| AppError::ProbeTimeout)??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 8 行窗口：前端展示层（errorHint）按特征词分类，3 行时常把关键 ERROR 行截掉
        let tail = stderr.lines().rev().take(8).collect::<Vec<_>>().join(" | ");
        return Err(AppError::ProbeFailed(tail));
    }

    let json: Value = serde_json::from_slice(&output.stdout)?;
    // 少数站点（合集型 URL）即便 --no-playlist 仍返回 entries
    if json.get("entries").is_some() {
        return Err(AppError::PlaylistUnsupported);
    }

    let valid_ids = HashSet::new();
    let images = gallery_images(&json);
    let formats = if images.is_empty() {
        collapse_formats(&json)
    } else {
        Vec::new()
    };

    let thumbnail = json["thumbnail"].as_str().map(String::from);
    let thumbnail_preview = match thumbnail.as_deref() {
        Some(url) => weibo_thumbnail_preview(url, proxy).await,
        None => None,
    };
    let info = VideoInfo {
        id: json["id"].as_str().unwrap_or("").to_string(),
        title: json["title"].as_str().unwrap_or("(无标题)").to_string(),
        duration: json["duration"].as_f64(),
        thumbnail,
        thumbnail_preview,
        uploader: json["uploader"].as_str().map(String::from),
        webpage_url: json["webpage_url"].as_str().map(String::from),
        images,
        formats,
    };
    Ok(ProbeResult { info, valid_ids })
}

// 新浪图片防盗链要求微博 Referer，WebView 的 img 无法设置这个请求头。
// 预览失败不影响视频解析；原始 thumbnail 仍保留给封面下载。
async fn weibo_thumbnail_preview(raw: &str, proxy: Option<&str>) -> Option<String> {
    let parsed = url::Url::parse(raw).ok()?;
    let host = parsed.host_str()?;
    if parsed.scheme() != "https" || !(host == "sinaimg.cn" || host.ends_with(".sinaimg.cn")) {
        return None;
    }
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(8));
    if let Some(proxy) = proxy {
        builder = builder.proxy(reqwest::Proxy::all(proxy).ok()?);
    }
    let mut response = builder.build().ok()?
        .get(raw)
        .header(reqwest::header::REFERER, "https://weibo.com/")
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0")
        .send().await.ok()?.error_for_status().ok()?;
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE)?
        .to_str().ok()?.split(';').next()?.trim().to_string();
    if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp" | "image/gif") {
        return None;
    }
    const MAX_BYTES: usize = 8 * 1024 * 1024;
    if response.content_length().is_some_and(|size| size > MAX_BYTES as u64) {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() { return None; }
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn gallery_images(json: &Value) -> Vec<ImageOption> {
    json["images"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, image)| {
            let raw = image["url"].as_str()?;
            let parsed = url::Url::parse(raw).ok()?;
            if parsed.scheme() != "https" || parsed.host_str().is_none() {
                return None;
            }
            let ext = parsed
                .path()
                .rsplit_once('.')
                .map(|(_, extension)| extension.to_ascii_lowercase())
                .filter(|extension| {
                    matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp" | "avif")
                })
                .unwrap_or_else(|| "webp".into());
            Some(ImageOption {
                id: image["id"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| (index + 1).to_string()),
                label: format!("图片 {}", index + 1),
                url: raw.to_string(),
                ext,
                width: image["width"].as_u64().and_then(|n| u32::try_from(n).ok()),
                height: image["height"].as_u64().and_then(|n| u32::try_from(n).ok()),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{gallery_images, probe_args, resolution_label};

    #[test]
    fn probe_carries_the_same_host_headers_as_downloads() {
        let url = "https://www.xiaohongshu.com/explore/6af9738d00000000090214ed?xsec_token=x";
        let argv = probe_args(url, Some("http://127.0.0.1:7890"), None);
        assert_eq!(argv.last().unwrap(), url, "URL 必须收尾，不能被当成选项值");
        assert!(argv
            .windows(2)
            .any(|w| w[0] == "--add-header" && w[1] == "Referer:https://www.xiaohongshu.com/"));
        assert!(argv
            .windows(2)
            .any(|w| w[0] == "--user-agent" && w[1].starts_with("Mozilla/5.0")));
        assert!(argv
            .windows(2)
            .any(|w| w[0] == "--proxy" && w[1] == "http://127.0.0.1:7890"));
    }

    #[test]
    fn extracts_every_douyin_gallery_image() {
        let info = serde_json::json!({
            "images": [
                {"id": "1", "url": "https://p95-zjwztc-sign.douyinpic.com/first.jpeg?x-expires=1797649200", "width": 1440, "height": 1920},
                {"id": "2", "url": "https://p5-ex-gddgtc-sign.douyinpic.com/second.webp?x-expires=1797649200", "width": 1440, "height": 1920}
            ]
        });
        let images = gallery_images(&info);
        assert_eq!(images.len(), 2);
        assert_eq!(images[0].label, "图片 1");
        assert_eq!(images[0].ext, "jpeg");
        assert_eq!(images[1].ext, "webp");
        assert_eq!(images[1].width, Some(1440));
    }

    #[test]
    fn uses_compact_k_labels_for_desktop_quality_options() {
        assert_eq!(resolution_label(1080), "1080p");
        assert_eq!(resolution_label(1440), "2K");
        assert_eq!(resolution_label(1620), "3K");
        assert_eq!(resolution_label(1728), "3K");
        assert_eq!(resolution_label(1800), "3K");
        assert_eq!(resolution_label(2160), "4K");
        assert_eq!(resolution_label(4320), "8K");
        assert_eq!(resolution_label(720), "720p");
        assert_eq!(resolution_label(480), "480p");
    }
}

fn resolution_label(height: u32) -> String {
    match height {
        1440 => "2K".into(),
        1620 | 1728 | 1800 => "3K".into(),
        2160 => "4K".into(),
        4320 => "8K".into(),
        _ => format!("{height}p"),
    }
}

/// 把 yt-dlp 原始格式列表折叠成人能读懂的选项：
/// 最佳画质+音频（合并） / 各档单文件渐进格式 / 仅音频（MP3 提取）
fn collapse_formats(json: &Value) -> Vec<FormatOption> {
    let mut out = Vec::new();

    out.push(FormatOption {
        id: crate::args::FMT_BEST.into(),
        label: "最佳画质 + 音频（FFmpeg 合并）".into(),
        height: None,
        ext: None,
        filesize: json["filesize_approx"].as_f64().map(|v| v as u64),
    });

    // 从所有视频流提取实际分辨率。现代站点通常采用 DASH/HLS 分离流，
    // 因此不能只看同时包含音视频的渐进式格式。
    let mut resolutions = std::collections::BTreeMap::<u32, u64>::new();
    let best_audio_filesize = json["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| {
            f["vcodec"].as_str().unwrap_or("none") == "none"
                && f["acodec"].as_str().unwrap_or("none") != "none"
        })
        .filter_map(|f| {
            f["filesize"]
                .as_f64()
                .or(f["filesize_approx"].as_f64())
                .map(|v| v as u64)
        })
        .max()
        .unwrap_or(0);
    for f in json["formats"].as_array().into_iter().flatten() {
        let vcodec = f["vcodec"].as_str().unwrap_or("none");
        if vcodec == "none" {
            continue;
        }
        let height = f["height"].as_u64().unwrap_or(0) as u32;
        if height == 0 {
            continue;
        }
        let filesize = f["filesize"]
            .as_f64()
            .or(f["filesize_approx"].as_f64())
            .map(|v| v as u64)
            .unwrap_or(0);
        resolutions
            .entry(height)
            .and_modify(|size| *size = (*size).max(filesize))
            .or_insert(filesize);
    }
    for (height, filesize) in resolutions.into_iter().rev().take(8) {
        out.push(FormatOption {
            id: format!("__video_{}p__", height),
            label: resolution_label(height),
            height: Some(height),
            ext: None,
            filesize: (filesize > 0).then_some(filesize.saturating_add(best_audio_filesize)),
        });
    }

    out.push(FormatOption {
        id: crate::args::FMT_AUDIO_MP3.into(),
        label: "仅音频（MP3 提取）".into(),
        height: None,
        ext: Some("mp3".into()),
        filesize: None,
    });

    // 附属内容：仅在元数据里真实存在时才提供
    if json["thumbnail"].as_str().is_some_and(|s| !s.is_empty()) {
        out.push(FormatOption {
            id: crate::args::FMT_THUMBNAIL.into(),
            label: "封面图片".into(),
            height: None,
            ext: None,
            filesize: None,
        });
    }
    for language in subtitle_languages(json) {
        out.push(FormatOption {
            id: format!("__subtitle_{language}__"),
            label: subtitle_language_label(&language),
            height: None,
            ext: Some("srt".into()),
            filesize: None,
        });
    }

    out
}

fn safe_subtitle_language(language: &str) -> bool {
    !language.is_empty()
        && language != "live_chat"
        && language.len() <= 35
        && language
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// 人工字幕全部展示；自动字幕只展示常用中英文和原始语言，避免 YouTube
/// 返回上百种机器翻译语言把下拉框撑满。
fn subtitle_languages(json: &Value) -> Vec<String> {
    const PREFERRED: &[&str] = &["zh-Hans", "zh-CN", "zh", "zh-Hant", "en-orig", "en"];
    let manual = json["subtitles"].as_object();
    let automatic = json["automatic_captions"].as_object();
    let mut available = HashSet::new();

    for language in manual.into_iter().flat_map(|items| items.keys()) {
        if safe_subtitle_language(language) {
            available.insert(language.to_string());
        }
    }
    for language in automatic.into_iter().flat_map(|items| items.keys()) {
        if safe_subtitle_language(language)
            && (PREFERRED.contains(&language.as_str()) || language.ends_with("-orig"))
        {
            available.insert(language.to_string());
        }
    }

    let mut result = Vec::new();
    for preferred in PREFERRED {
        if available.remove(*preferred) {
            result.push((*preferred).to_string());
        }
    }
    let mut remaining: Vec<_> = available.into_iter().collect();
    remaining.sort();
    result.extend(remaining);
    result
}

fn subtitle_language_label(language: &str) -> String {
    match language {
        "zh-Hans" | "zh-CN" => "简体中文".into(),
        "zh-Hant" | "zh-TW" | "zh-HK" => "繁体中文".into(),
        "zh" => "中文".into(),
        "en-orig" => "英文（原始）".into(),
        "en" => "英文".into(),
        _ => language.to_string(),
    }
}
