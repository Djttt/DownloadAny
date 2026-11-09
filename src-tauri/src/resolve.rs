//! 二进制解析：开发态优先系统 PATH；打包态将主程序内嵌的压缩基础组件
//! 释放到用户数据目录，再从版本化 tools/ 路径运行。安装目录不再放 sidecar。

use std::path::PathBuf;
use std::sync::OnceLock;

static YT_DLP: OnceLock<Result<PathBuf, String>> = OnceLock::new();
static FFMPEG: OnceLock<Result<PathBuf, String>> = OnceLock::new();

#[derive(Clone, Debug)]
pub enum Program {
    /// 随包/预置二进制（绝对路径）
    Bundled(PathBuf),
    /// 系统 PATH
    FromPath(&'static str),
}

impl Program {
    pub fn command(&self) -> tokio::process::Command {
        // mut 仅在 Windows 分支被使用（creation_flags），其他平台会误报 unused_mut
        #[cfg_attr(not(windows), allow(unused_mut))]
        let mut command = match self {
            Program::Bundled(p) => tokio::process::Command::new(p),
            Program::FromPath(name) => tokio::process::Command::new(name),
        };
        // yt-dlp/FFmpeg 都是控制台子系统程序。Tauri 本身是 GUI 程序，若不
        // 显式设置此标志，Windows 会在每次解析/下载时闪出命令提示框。
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command
    }

    /// 打包态下 yt-dlp 需要通过 --ffmpeg-location 显式定位 sidecar 目录，
    /// 避免命中用户系统里版本不可预期的 ffmpeg；开发态（PATH）不传。
    pub fn ffmpeg_location(&self) -> Option<String> {
        match self {
            Program::Bundled(p) => p.parent().map(|d| d.to_string_lossy().into_owned()),
            Program::FromPath(_) => None,
        }
    }

    pub fn source(&self) -> &'static str {
        match self {
            Program::Bundled(_) => "bundled",
            Program::FromPath(_) => "path",
        }
    }

    pub fn display(&self) -> String {
        match self {
            Program::Bundled(p) => p.to_string_lossy().into_owned(),
            Program::FromPath(n) => format!("{} (PATH)", n),
        }
    }
}

pub fn yt_dlp() -> Program {
    resolve("yt-dlp", &YT_DLP)
}

pub fn ffmpeg() -> Program {
    resolve("ffmpeg", &FFMPEG)
}

fn resolve(name: &'static str, cache: &'static OnceLock<Result<PathBuf, String>>) -> Program {
    // 开发态优先系统 PATH：官方 PyInstaller 静态包在 macOS 上每次 spawn 有
    // ~13s 的启动开销（系统评估+解包），brew/zipapp 版秒级，开发体验优先；
    // 打包态仍优先内置（开箱即用是分发的前提）。
    #[cfg(debug_assertions)]
    if exists_on_path(name) {
        return Program::FromPath(if name == "yt-dlp" { "yt-dlp" } else { "ffmpeg" });
    }

    // 首次调用时释放内嵌组件；同一进程中缓存结果，避免重复校验大文件。
    if let Ok(path) = cache.get_or_init(|| crate::embedded_components::ensure(name)) {
        return Program::Bundled(path.clone());
    }

    // 最后兜底 PATH（Windows 上 where 找不到也能经 CreateProcess 解析）
    Program::FromPath(if name == "yt-dlp" { "yt-dlp" } else { "ffmpeg" })
}

/// 用 which/where 探测 PATH 是否有该命令——不实际执行，零启动成本
fn exists_on_path(name: &str) -> bool {
    let probe = if cfg!(windows) { "where" } else { "which" };
    std::process::Command::new(probe)
        .arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// 与 scripts/fetch-binaries.mjs 中的映射保持一致
pub fn target_triple() -> Option<String> {
    use std::env::consts::{ARCH, OS};
    Some(
        match (OS, ARCH) {
            ("macos", "aarch64") => "aarch64-apple-darwin",
            ("macos", "x86_64") => "x86_64-apple-darwin",
            ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
            ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
            ("windows", "x86_64") => "x86_64-pc-windows-msvc",
            _ => return None,
        }
        .to_string(),
    )
}
