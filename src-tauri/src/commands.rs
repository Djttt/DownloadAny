//! #[tauri::command] 入口：前端唯一可达的接口面。

use crate::args;
use crate::error::AppError;
use crate::probe::VideoInfo;
use crate::queue::{self, AppState, DownloadOptions, JobRecord};
use crate::resolve;
use serde::Serialize;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn probe_video(state: State<'_, AppState>, url: String) -> Result<VideoInfo, AppError> {
    let url = url.trim().to_string();
    args::validate_url(&url)?;
    queue::probe_and_cache(&url, &state).await
}

#[tauri::command]
pub async fn enqueue_download(
    app: AppHandle,
    state: State<'_, AppState>,
    options: DownloadOptions,
) -> Result<u64, AppError> {
    queue::enqueue(&app, &state, options).await
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, job_id: u64) -> Result<(), AppError> {
    queue::cancel(&state, job_id)
}

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> Result<Vec<JobRecord>, AppError> {
    Ok(state.list())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInfo {
    pub yt_dlp_version: Option<String>,
    pub yt_dlp_source: String,
    pub yt_dlp_path: String,
    pub ffmpeg_version: Option<String>,
    pub ffmpeg_source: String,
}

/// 依赖状态（前端底部指示器）。PyInstaller 静态包冷启动可能要十几秒，
/// 放宽超时并 OnceLock 缓存：整个进程生命周期只真正探测一次。
static DEP_CACHE: std::sync::OnceLock<DependencyInfo> = std::sync::OnceLock::new();

#[tauri::command]
pub async fn dependency_info() -> Result<DependencyInfo, AppError> {
    if let Some(cached) = DEP_CACHE.get() {
        return Ok(cached.clone());
    }
    let yt = resolve::yt_dlp();
    let ff = resolve::ffmpeg();
    // ffmpeg 只认单横线 -version
    let (yt_ver, ff_ver) = tokio::join!(version_of(&yt, "--version", 45), version_of(&ff, "-version", 20));
    let info = DependencyInfo {
        yt_dlp_version: yt_ver,
        yt_dlp_source: yt.source().into(),
        yt_dlp_path: yt.display(),
        ffmpeg_version: ff_ver,
        ffmpeg_source: ff.source().into(),
    };
    let _ = DEP_CACHE.set(info.clone());
    Ok(info)
}

async fn version_of(program: &resolve::Program, flag: &str, timeout_secs: u64) -> Option<String> {
    let mut cmd = program.command();
    cmd.arg(flag)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    // ffmpeg 首行是 "ffmpeg version 7.1.1 Copyright (c)…"，只取版本号；
    // yt-dlp 首行本身就是裸版本号
    Some(match first.split_once("version ") {
        Some((_, rest)) => rest.split_whitespace().next().unwrap_or(rest).to_string(),
        None => first,
    })
}
