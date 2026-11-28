//! 二进制解析：开发态优先系统 PATH；打包态将主程序内嵌的压缩基础组件
//! 释放到用户数据目录，再从版本化 tools/ 路径运行。安装目录不再放 sidecar。

use std::path::PathBuf;
use std::sync::Mutex;

// 可失效的路径缓存：热更组件后需让缓存作废，下一次 spawn 才会重读 active.json
// 指向的新版本（OnceLock 一旦初始化无法重置，故用 Mutex<Option<_>> + invalidate）。
static YT_DLP: Mutex<Option<Result<PathBuf, String>>> = Mutex::new(None);
static FFMPEG: Mutex<Option<Result<PathBuf, String>>> = Mutex::new(None);

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

/// 组件热更成功后让对应缓存失效，下一次 resolve/spawn 重新读取 active.json 指针。
/// 由 component_updater 在 install_remote 之后调用，否则本次会话仍会用旧二进制。
pub fn invalidate(id: &str) {
    let cache = match id {
        "yt-dlp" => &YT_DLP,
        "ffmpeg" => &FFMPEG,
        _ => return,
    };
    // 中毒的锁仍要清掉，避免热更被历史 panic 卡住。
    if let Ok(mut guard) = cache.lock() {
        *guard = None;
    }
}

fn resolve(name: &'static str, cache: &'static Mutex<Option<Result<PathBuf, String>>>) -> Program {
    let fallback = if name == "yt-dlp" { "yt-dlp" } else { "ffmpeg" };

    // 开发态优先系统 PATH：官方 PyInstaller 静态包在 macOS 上每次 spawn 有
    // ~13s 的启动开销（系统评估+解包），brew/zipapp 版秒级，开发体验优先；
    // 打包态仍优先内置（开箱即用是分发的前提）。
    #[cfg(debug_assertions)]
    if exists_on_path(name) {
        return Program::FromPath(fallback);
    }

    // 首次调用时释放内嵌组件；同一进程中缓存结果（含失败结果，避免重复校验大文件），
    // 直到 invalidate() 被组件热更显式清空。
    let cached = {
        let mut guard = cache.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            *guard = Some(crate::embedded_components::ensure(name));
        }
        guard.clone()
    };

    match cached {
        Some(Ok(path)) => Program::Bundled(path),
        // 缓存为 Err（内嵌释放失败）或未命中时，兜底走 PATH（Windows 上 where
        // 找不到也能经 CreateProcess 解析）。
        _ => Program::FromPath(fallback),
    }
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
