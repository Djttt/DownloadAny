//! #[tauri::command] 入口：前端唯一可达的接口面。

use crate::args;
use crate::error::AppError;
use crate::probe::VideoInfo;
use crate::queue::{self, AppState, DownloadOptions, JobRecord};
use crate::resolve;
use serde::Serialize;
use std::process::Stdio;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInfo {
    pub yt_dlp_version: Option<String>,
    pub yt_dlp_source: String,
    pub yt_dlp_path: String,
    pub ffmpeg_version: Option<String>,
    pub ffmpeg_source: String,
}

/// 依赖状态（前端底部指示器）
#[tauri::command]
pub async fn dependency_info() -> Result<DependencyInfo, AppError> {
    let yt = resolve::yt_dlp();
    let ff = resolve::ffmpeg();
    let (yt_ver, ff_ver) = tokio::join!(version_of(&yt), version_of(&ff));
    Ok(DependencyInfo {
        yt_dlp_version: yt_ver,
        yt_dlp_source: yt.source().into(),
        yt_dlp_path: yt.display(),
        ffmpeg_version: ff_ver,
        ffmpeg_source: ff.source().into(),
    })
}

async fn version_of(program: &resolve::Program) -> Option<String> {
    let mut cmd = program.command();
    cmd.arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output())
        .await
        .ok()?
        .ok()?;
    if out.status.success() {
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .map(|s| s.trim().to_string())
    } else {
        None
    }
}
