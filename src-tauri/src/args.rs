//! 白名单参数拼装：前端永远不接触命令行，这里把结构化选项翻译成 yt-dlp 参数。

use crate::error::AppError;
use std::collections::HashSet;

/// 用户可选的合成格式（哨兵值，不是 yt-dlp 原生 format id）
pub const FMT_BEST: &str = "__best__";
pub const FMT_AUDIO_MP3: &str = "__audio_mp3__";
pub const FMT_AUDIO_M4A: &str = "__audio_m4a__";
pub const FMT_AUDIO_WAV: &str = "__audio_wav__";
pub const FMT_THUMBNAIL: &str = "__thumbnail__";
pub const FMT_THUMBNAIL_JPG: &str = "__thumbnail_jpg__";
pub const FMT_THUMBNAIL_PNG: &str = "__thumbnail_png__";
pub const FMT_THUMBNAIL_WEBP: &str = "__thumbnail_webp__";
pub const FMT_SUBTITLES: &str = "__subtitles__";

fn subtitle_language(raw: &str) -> Option<&str> {
    let language = raw.strip_prefix("__subtitle_")?.strip_suffix("__")?;
    (!language.is_empty()
        && language.len() <= 35
        && language
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')))
    .then_some(language)
}

fn video_height(raw: &str) -> Option<u32> {
    let height = raw
        .strip_prefix("__video_")?
        .strip_suffix("p__")?
        .parse()
        .ok()?;
    (144..=8640).contains(&height).then_some(height)
}

/// 进度行前缀。yt-dlp 会剥掉模板里的 `download:` 段名，实际输出以下列前缀开头，
/// 每行一条：PROGRESS|<百分比>|<已下载>|<总大小>|<预估总大小>|<速度>|<ETA>
/// 注意：downloaded_bytes/total_bytes 等在未知时打印 "None"，因此不用 JSON 而用竖线分隔。
pub const PROGRESS_PREFIX: &str = "PROGRESS|";
const PROGRESS_TEMPLATE: &str = concat!(
    "download:",
    "PROGRESS|%(progress._percent_str)s",
    "|%(progress.downloaded_bytes)s",
    "|%(progress.total_bytes)s",
    "|%(progress.total_bytes_estimate)s",
    "|%(progress.speed)s",
    "|%(progress.eta)s"
);

pub fn validate_url(url: &str) -> Result<(), AppError> {
    let ok = (url.starts_with("http://") || url.starts_with("https://"))
        && url.len() <= 2000
        && !url.chars().any(|c| c.is_control() || c.is_whitespace());
    if !ok {
        return Err(AppError::InvalidUrl);
    }
    Ok(())
}

/// 代理 URL 白名单：只放行常见代理 scheme（scheme 前缀天然杜绝"值被当作选项"的注入）
const PROXY_SCHEMES: &[&str] = &[
    "http://",
    "https://",
    "socks4://",
    "socks4a://",
    "socks5://",
    "socks5h://",
];

/// 校验并规范化代理 URL；空/None → None（不走代理）。
/// 规则：长度 ≤ 300、无空白/控制字符、必须带白名单 scheme、去掉 userinfo 后主机非空。
pub fn validate_proxy(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let rest = PROXY_SCHEMES
        .iter()
        .find(|p| s.starts_with(**p))
        .map(|p| &s[p.len()..])
        .ok_or_else(|| {
            AppError::InvalidProxy("需以 http://、https:// 或 socks4/5:// 开头".into())
        })?;
    // userinfo（user:pass@）之后的部分才是主机，必须非空
    let host = match rest.rsplit_once('@') {
        Some((_, h)) => h,
        None => rest,
    };
    let ok = s.len() <= 300
        && !host.is_empty()
        && !rest.contains("//")
        && !s.chars().any(|c| c.is_control() || c.is_whitespace());
    if !ok {
        return Err(AppError::InvalidProxy("包含非法字符或格式不完整".into()));
    }
    Ok(Some(s.to_string()))
}

/// format_id 校验：
/// - 哨兵值（最佳/仅音频）直接放行
/// - 其余必须是本次 probe 结果里出现过的 id，且只含安全字符
pub fn validate_format(raw: &str, probed_ids: &HashSet<String>) -> Result<(), AppError> {
    if video_height(raw).is_some() || subtitle_language(raw).is_some() {
        return Ok(());
    }
    if matches!(
        raw,
        FMT_BEST
            | FMT_AUDIO_MP3
            | FMT_AUDIO_M4A
            | FMT_AUDIO_WAV
            | FMT_THUMBNAIL
            | FMT_THUMBNAIL_JPG
            | FMT_THUMBNAIL_PNG
            | FMT_THUMBNAIL_WEBP
            | FMT_SUBTITLES
    ) {
        return Ok(());
    }
    let safe = !raw.is_empty()
        && raw.len() <= 100
        && raw
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'));
    if !safe {
        return Err(AppError::InvalidFormat("包含非法字符".into()));
    }
    if !probed_ids.contains(raw) {
        return Err(AppError::InvalidFormat(
            "该格式不在本次解析结果中，请重新解析".into(),
        ));
    }
    Ok(())
}

/// 组装下载参数（argv 数组传给 spawn，天然免疫 shell 注入）
pub fn build_download_args(
    format_id: &str,
    url: &str,
    output_dir: &str,
    ffmpeg_location: Option<&str>,
    proxy: Option<&str>,
) -> Vec<String> {
    let output_template = if cfg!(windows) {
        // Windows 临时分片还会追加格式号、分片号等后缀；限制标题长度避免
        // 超过 Win32 路径/文件名限制后抛出 `[Errno 22] Invalid argument`。
        "%(title).120B [%(id)s].%(ext)s"
    } else {
        "%(title)s [%(id)s].%(ext)s"
    };
    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--no-colors".into(),
        "--progress-template".into(),
        PROGRESS_TEMPLATE.into(),
        "--progress".into(),
        "--print".into(),
        "after_move:FINAL_PATH|%(filepath)s".into(),
        "--paths".into(),
        output_dir.into(),
        "-o".into(),
        output_template.into(),
    ];
    if cfg!(windows) {
        args.push("--windows-filenames".into());
    }
    if let Some(p) = proxy {
        args.push("--proxy".into());
        args.push(p.into());
    }
    if let Some(loc) = ffmpeg_location {
        args.push("--ffmpeg-location".into());
        args.push(loc.into());
    }
    match format_id {
        FMT_BEST => args.extend(["-f".into(), "bv*+ba/b".into()]),
        id if video_height(id).is_some() => {
            let height = video_height(id).expect("guarded video height");
            args.extend([
                "-f".into(),
                format!("bv*[height<={height}]+ba/b[height<={height}]/b"),
            ]);
        }
        FMT_AUDIO_MP3 | FMT_AUDIO_M4A | FMT_AUDIO_WAV => args.extend([
            "-x".into(),
            "--audio-format".into(),
            match format_id {
                FMT_AUDIO_M4A => "m4a",
                FMT_AUDIO_WAV => "wav",
                _ => "mp3",
            }
            .into(),
            "--audio-quality".into(),
            "0".into(),
        ]),
        // 封面：不下载视频，仅写缩略图
        FMT_THUMBNAIL => args.extend(["--skip-download".into(), "--write-thumbnail".into()]),
        FMT_THUMBNAIL_JPG | FMT_THUMBNAIL_PNG | FMT_THUMBNAIL_WEBP => args.extend([
            "--skip-download".into(),
            "--write-thumbnail".into(),
            "--convert-thumbnails".into(),
            match format_id {
                FMT_THUMBNAIL_PNG => "png",
                FMT_THUMBNAIL_WEBP => "webp",
                _ => "jpg",
            }
            .into(),
        ]),
        // 旧任务兼容：历史记录里没有语言信息时仅尝试简体中文。
        FMT_SUBTITLES => args.extend([
            "--skip-download".into(),
            "--write-subs".into(),
            "--write-auto-subs".into(),
            "--sub-langs".into(),
            "zh-Hans".into(),
            "--ignore-errors".into(),
            "--convert-subs".into(),
            "srt".into(),
        ]),
        id if subtitle_language(id).is_some() => args.extend([
            "--skip-download".into(),
            "--write-subs".into(),
            "--write-auto-subs".into(),
            "--sub-langs".into(),
            subtitle_language(id)
                .expect("guarded subtitle language")
                .into(),
            "--ignore-errors".into(),
            "--convert-subs".into(),
            "srt".into(),
        ]),
        id => args.extend(["-f".into(), id.into()]),
    }
    args.push(url.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_must_be_http() {
        assert!(validate_url("https://www.bilibili.com/video/BV1xx").is_ok());
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("https://a b").is_err());
        assert!(validate_url("--help").is_err());
    }

    #[test]
    fn format_whitelist() {
        let ids = HashSet::from(["137".to_string(), "140.m4a".to_string()]);
        assert!(validate_format(FMT_BEST, &ids).is_ok());
        assert!(validate_format("137", &ids).is_ok());
        assert!(validate_format("999", &ids).is_err());
        assert!(validate_format("137; rm -rf /", &ids).is_err());
    }

    #[test]
    fn best_uses_merged_format_selector() {
        let args = build_download_args(FMT_BEST, "https://x", "/tmp/o", None, None);
        assert!(args.windows(2).any(|w| w[0] == "-f" && w[1] == "bv*+ba/b"));
        assert_eq!(args.last().unwrap(), "https://x");
    }

    #[test]
    fn resolution_uses_video_and_audio_merge() {
        let id = "__video_1080p__";
        assert!(validate_format(id, &HashSet::new()).is_ok());
        let args = build_download_args(id, "https://x", "/tmp/o", None, None);
        assert!(
            args.windows(2)
                .any(|w| { w[0] == "-f" && w[1] == "bv*[height<=1080]+ba/b[height<=1080]/b" })
        );
        assert!(validate_format("__video_99999p__", &HashSet::new()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_uses_safe_bounded_filenames() {
        let args = build_download_args(FMT_BEST, "https://x", "C:\\Downloads", None, None);
        assert!(args.contains(&"--windows-filenames".to_string()));
        assert!(args.contains(&"%(title).120B [%(id)s].%(ext)s".to_string()));
    }

    #[test]
    fn audio_extraction_mode() {
        let args =
            build_download_args(FMT_AUDIO_MP3, "https://x", "/tmp/o", Some("/app/dir"), None);
        assert!(args.windows(2).any(|w| w[0] == "--ffmpeg-location"));
        assert!(args.contains(&"-x".to_string()));
    }

    #[test]
    fn thumbnail_skips_video_download() {
        let args = build_download_args(FMT_THUMBNAIL, "https://x", "/tmp/o", None, None);
        assert!(args.contains(&"--skip-download".to_string()));
        assert!(args.contains(&"--write-thumbnail".to_string()));
        assert!(!args.iter().any(|a| a == "-f"), "封面不应带 -f");
    }

    #[test]
    fn subtitles_fetch_selected_language_and_convert() {
        let args = build_download_args("__subtitle_en-orig__", "https://x", "/tmp/o", None, None);
        for flag in ["--write-subs", "--write-auto-subs", "--convert-subs", "srt"] {
            assert!(args.iter().any(|a| a == flag), "缺少 {flag}");
        }
        let language_index = args.iter().position(|a| a == "--sub-langs").unwrap();
        assert_eq!(args[language_index + 1], "en-orig");
        assert!(
            !args.iter().any(|a| a.contains(',')),
            "一次只能下载一种字幕语言"
        );
        assert!(validate_format("__subtitle_zh-Hans__", &HashSet::new()).is_ok());
        assert!(validate_format(FMT_SUBTITLES, &HashSet::new()).is_ok());
        assert!(validate_format(FMT_THUMBNAIL, &HashSet::new()).is_ok());
    }

    #[test]
    fn proxy_whitelist() {
        assert_eq!(validate_proxy(None).unwrap(), None);
        assert_eq!(validate_proxy(Some("   ")).unwrap(), None);
        assert_eq!(
            validate_proxy(Some("http://127.0.0.1:7890"))
                .unwrap()
                .as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert!(validate_proxy(Some("socks5://127.0.0.1:1080")).is_ok());
        assert!(validate_proxy(Some("http://user:pass@proxy.example.com:8080")).is_ok());
        // 缺 scheme / 空主机 / 空白字符 / 注入形态一律拒绝
        assert!(validate_proxy(Some("127.0.0.1:7890")).is_err());
        assert!(validate_proxy(Some("http://")).is_err());
        assert!(validate_proxy(Some("http://a b")).is_err());
        assert!(validate_proxy(Some("--proxy=evil")).is_err());
        assert!(validate_proxy(Some("javascript://x")).is_err());
    }

    #[test]
    fn download_args_carry_proxy() {
        let args = build_download_args(
            FMT_BEST,
            "https://x",
            "/tmp/o",
            None,
            Some("socks5://127.0.0.1:1080"),
        );
        assert!(
            args.windows(2)
                .any(|w| w[0] == "--proxy" && w[1] == "socks5://127.0.0.1:1080")
        );
        let args = build_download_args(FMT_BEST, "https://x", "/tmp/o", None, None);
        assert!(!args.iter().any(|a| a == "--proxy"));
    }
}
