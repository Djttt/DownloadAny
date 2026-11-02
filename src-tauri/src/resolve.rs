//! 二进制解析：打包态优先使用与主程序同目录的 sidecar，开发态回退到
//! src-tauri/binaries/（fetch-binaries.mjs 产物），最后回退系统 PATH。
//!
//! Tauri 打包时 `bundle.externalBin` 会把 `binaries/yt-dlp-<target-triple>`
//! 去掉后缀复制进应用目录（macOS 在 Contents/MacOS/，与主程序同级），
//! 因此从 current_exe 的父目录查找即可，无需 tauri-plugin-shell。

use std::path::PathBuf;

#[derive(Clone, Debug)]
pub enum Program {
    /// 随包/预置二进制（绝对路径）
    Bundled(PathBuf),
    /// 系统 PATH
    FromPath(&'static str),
}

impl Program {
    pub fn command(&self) -> tokio::process::Command {
        match self {
            Program::Bundled(p) => tokio::process::Command::new(p),
            Program::FromPath(name) => tokio::process::Command::new(name),
        }
    }

    /// 打包态下 yt-dlp 需要通过 --ffmpeg-location 显式定位 sidecar 目录，
    /// 避免命中用户系统里版本不可预期的 ffmpeg；开发态（PATH）不传。
    pub fn ffmpeg_location(&self) -> Option<String> {
        match self {
            Program::Bundled(p) => p
                .parent()
                .map(|d| d.to_string_lossy().into_owned()),
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
    resolve("yt-dlp")
}

pub fn ffmpeg() -> Program {
    resolve("ffmpeg")
}

fn bin_file_name(name: &str) -> String {
    format!("{}{}", name, std::env::consts::EXE_SUFFIX)
}

fn resolve(name: &str) -> Program {
    // 开发态优先系统 PATH：官方 PyInstaller 静态包在 macOS 上每次 spawn 有
    // ~13s 的启动开销（系统评估+解包），brew/zipapp 版秒级，开发体验优先；
    // 打包态仍优先内置（开箱即用是分发的前提）。
    #[cfg(debug_assertions)]
    if exists_on_path(name) {
        return Program::FromPath(if name == "yt-dlp" { "yt-dlp" } else { "ffmpeg" });
    }

    // 打包态：与主程序同目录
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf())) {
        let candidate = dir.join(bin_file_name(name));
        if candidate.is_file() {
            return Program::Bundled(candidate);
        }
    }

    // 开发态回退：src-tauri/binaries/<name>-<target-triple>（PATH 没装时）
    if cfg!(debug_assertions) {
        if let Some(triple) = target_triple() {
            let suffix = std::env::consts::EXE_SUFFIX;
            let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("{}-{}{}", name, triple, suffix));
            if candidate.is_file() {
                return Program::Bundled(candidate);
            }
        }
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
