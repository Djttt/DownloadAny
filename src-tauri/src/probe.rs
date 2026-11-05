//! 元数据探测：yt-dlp -J（--dump-single-json，默认 simulate 不下载）。

use crate::{error::AppError, resolve};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::process::Stdio;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub id: String,
    pub label: String,
    pub height: Option<u32>,
    pub ext: Option<String>,
    pub filesize: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub webpage_url: Option<String>,
    pub formats: Vec<FormatOption>,
}

pub struct ProbeResult {
    pub info: VideoInfo,
    /// 供入队时做 format_id 白名单校验
    pub valid_ids: HashSet<String>,
}

pub async fn probe(url: &str, proxy: Option<&str>) -> Result<ProbeResult, AppError> {
    let program = resolve::yt_dlp();
    let mut cmd = program.command();
    let mut argv: Vec<&str> = vec!["-J", "--no-playlist", "--no-warnings", "--no-colors"];
    // 探测与下载走同一代理，否则会出现"探测成功但下载连不上"（或反之）的割裂体验
    if let Some(p) = proxy {
        argv.extend(["--proxy", p]);
    }
    argv.push(url);
    cmd.args(argv)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| AppError::ProbeTimeout)??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr.lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        return Err(AppError::ProbeFailed(tail));
    }

    let json: Value = serde_json::from_slice(&output.stdout)?;
    // 少数站点（合集型 URL）即便 --no-playlist 仍返回 entries
    if json.get("entries").is_some() {
        return Err(AppError::PlaylistUnsupported);
    }

    let valid_ids = HashSet::new();
    let formats = collapse_formats(&json);

    let info = VideoInfo {
        id: json["id"].as_str().unwrap_or("").to_string(),
        title: json["title"].as_str().unwrap_or("(无标题)").to_string(),
        duration: json["duration"].as_f64(),
        thumbnail: json["thumbnail"].as_str().map(String::from),
        uploader: json["uploader"].as_str().map(String::from),
        webpage_url: json["webpage_url"].as_str().map(String::from),
        formats,
    };
    Ok(ProbeResult { info, valid_ids })
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
            label: format!("{}p", height),
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
    let has_subs = ["subtitles", "automatic_captions"]
        .iter()
        .any(|k| json[*k].as_object().is_some_and(|m| !m.is_empty()));
    if has_subs {
        out.push(FormatOption {
            id: crate::args::FMT_SUBTITLES.into(),
            label: "字幕（SRT）".into(),
            height: None,
            ext: Some("srt".into()),
            filesize: None,
        });
    }

    out
}
