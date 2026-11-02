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

pub async fn probe(url: &str) -> Result<ProbeResult, AppError> {
    let program = resolve::yt_dlp();
    let mut cmd = program.command();
    cmd.args([
        "-J",
        "--no-playlist",
        "--no-warnings",
        "--no-colors",
        url,
    ])
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

    let mut valid_ids = HashSet::new();
    let formats = collapse_formats(&json, &mut valid_ids);

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
fn collapse_formats(json: &Value, valid_ids: &mut HashSet<String>) -> Vec<FormatOption> {
    let mut out = Vec::new();

    out.push(FormatOption {
        id: crate::args::FMT_BEST.into(),
        label: "最佳画质 + 音频（FFmpeg 合并）".into(),
        height: None,
        ext: None,
        filesize: json["filesize_approx"].as_f64().map(|v| v as u64),
    });

    // 渐进式（单文件包含视频+音频），按 (height, ext) 取码率最高的一条
    // (height, ext, format_id, filesize, tbr)
    let mut progressive: Vec<(u32, String, String, u64, u64)> = Vec::new();
    for f in json["formats"].as_array().into_iter().flatten() {
        let vcodec = f["vcodec"].as_str().unwrap_or("none");
        let acodec = f["acodec"].as_str().unwrap_or("none");
        if vcodec == "none" || acodec == "none" {
            continue;
        }
        let Some(id) = f["format_id"].as_str() else { continue };
        let height = f["height"].as_u64().unwrap_or(0) as u32;
        let ext = f["ext"].as_str().unwrap_or("?").to_string();
        let filesize = f["filesize"]
            .as_f64()
            .or(f["filesize_approx"].as_f64())
            .map(|v| v as u64)
            .unwrap_or(0);
        let tbr = f["tbr"].as_f64().unwrap_or(0.0) as u64;
        valid_ids.insert(id.to_string());
        if let Some(existing) = progressive.iter_mut().find(|p| p.0 == height && p.1 == ext) {
            if tbr > existing.4 {
                *existing = (height, ext.clone(), id.to_string(), filesize, tbr);
            }
        } else {
            progressive.push((height, ext, id.to_string(), filesize, tbr));
        }
    }
    progressive.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.4.cmp(&a.4)));
    for (height, ext, format_id, filesize, _) in progressive.into_iter().take(8) {
        out.push(FormatOption {
            id: format_id, // 真实 format_id，入队时经 valid_ids 白名单校验
            label: format!("{}p · {}（单文件）", height, ext),
            height: (height > 0).then_some(height),
            ext: Some(ext),
            filesize: (filesize > 0).then_some(filesize),
        });
    }

    out.push(FormatOption {
        id: crate::args::FMT_AUDIO_MP3.into(),
        label: "仅音频（MP3 提取）".into(),
        height: None,
        ext: Some("mp3".into()),
        filesize: None,
    });

    out
}
