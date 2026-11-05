//! #[tauri::command] 入口：前端唯一可达的接口面。

use crate::args;
use crate::error::AppError;
use crate::probe::VideoInfo;
use crate::queue::{self, AppState, DownloadOptions, JobRecord};
use crate::resolve;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn probe_video(
    state: State<'_, AppState>,
    url: String,
    proxy: Option<String>,
) -> Result<VideoInfo, AppError> {
    let url = url.trim().to_string();
    args::validate_url(&url)?;
    let proxy = args::validate_proxy(proxy.as_deref())?;
    queue::probe_and_cache(&url, proxy.as_deref(), &state).await
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

/// 设置页"自动探测本地代理"返回的候选端点
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProxyCandidate {
    pub proxy_type: String,
    pub addr: String,
}

/// 本机常见代理监听端口（TCP 连通即视为候选，存在误报可能，故仅作填充建议）。
/// 顺序 = 优先级：Clash 系 mixed 端口在前，纯 SOCKS 端口在后。
const PROXY_CANDIDATES: &[(&str, u16, &str)] = &[
    ("127.0.0.1", 7890, "http"),   // Clash / Clash for Windows
    ("127.0.0.1", 7897, "http"),   // Clash Verge mixed
    ("127.0.0.1", 10808, "http"),  // v2rayN / xray http
    ("127.0.0.1", 10809, "http"),  // v2rayN / xray mixed
    ("127.0.0.1", 8118, "http"),   // privoxy
    ("127.0.0.1", 8888, "http"),
    ("127.0.0.1", 3128, "http"),   // squid
    ("127.0.0.1", 7891, "socks5"), // Clash socks
    ("127.0.0.1", 7898, "socks5"), // Clash Verge socks
    ("127.0.0.1", 1080, "socks5"),
    ("127.0.0.1", 1086, "socks5"),
];

/// 逐个 TCP 连接候选端口（300ms 超时），返回第一个连通者。
/// 串行最坏 ~3s，但只探测回环地址，连通失败通常立刻返回 refused。
#[tauri::command]
pub async fn detect_proxy() -> Option<ProxyCandidate> {
    for (host, port, kind) in PROXY_CANDIDATES {
        let connected = tokio::time::timeout(
            std::time::Duration::from_millis(300),
            tokio::net::TcpStream::connect((*host, *port)),
        )
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false);
        if connected {
            return Some(ProxyCandidate {
                proxy_type: (*kind).into(),
                addr: format!("{host}:{port}"),
            });
        }
    }
    None
}

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> Result<Vec<JobRecord>, AppError> {
    Ok(state.list())
}

/// 并发上限（设置页）：Rust 侧钳制 1..=10，改完立即生效
#[tauri::command]
pub fn set_max_concurrency(state: State<'_, AppState>, n: usize) -> Result<(), AppError> {
    state.set_max_concurrency(n);
    Ok(())
}

#[tauri::command]
pub fn open_download_location(file_path: String, fallback_dir: String) -> Result<(), AppError> {
    let file = PathBuf::from(file_path);
    let fallback = PathBuf::from(fallback_dir);
    let target_dir = if fallback.is_dir() {
        fallback.as_path()
    } else if file.is_dir() {
        file.as_path()
    } else {
        file.parent().unwrap_or(Path::new("."))
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(target_dir)
            .spawn()?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(target_dir).spawn()?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target_dir)
            .spawn()?;
    }

    Ok(())
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
