//! 白名单参数拼装：前端永远不接触命令行，这里把结构化选项翻译成 yt-dlp 参数。

use crate::error::AppError;
use std::collections::HashSet;

/// 用户可选的两个合成格式（哨兵值，不是 yt-dlp 原生 format id）
pub const FMT_BEST: &str = "__best__";
pub const FMT_AUDIO_MP3: &str = "__audio_mp3__";

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

/// format_id 校验：
/// - 哨兵值（最佳/仅音频）直接放行
/// - 其余必须是本次 probe 结果里出现过的 id，且只含安全字符
pub fn validate_format(raw: &str, probed_ids: &HashSet<String>) -> Result<(), AppError> {
    if raw == FMT_BEST || raw == FMT_AUDIO_MP3 {
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
        return Err(AppError::InvalidFormat("该格式不在本次解析结果中，请重新解析".into()));
    }
    Ok(())
}

/// 组装下载参数（argv 数组传给 spawn，天然免疫 shell 注入）
pub fn build_download_args(
    format_id: &str,
    url: &str,
    output_dir: &str,
    ffmpeg_location: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--no-colors".into(),
        "--progress-template".into(),
        PROGRESS_TEMPLATE.into(),
        "--paths".into(),
        output_dir.into(),
        "-o".into(),
        "%(title)s [%(id)s].%(ext)s".into(),
    ];
    if let Some(loc) = ffmpeg_location {
        args.push("--ffmpeg-location".into());
        args.push(loc.into());
    }
    match format_id {
        FMT_BEST => args.extend(["-f".into(), "bv*+ba/b".into()]),
        FMT_AUDIO_MP3 => args.extend([
            "-x".into(),
            "--audio-format".into(),
            "mp3".into(),
            "--audio-quality".into(),
            "0".into(),
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
        let args = build_download_args(FMT_BEST, "https://x", "/tmp/o", None);
        assert!(args.windows(2).any(|w| w[0] == "-f" && w[1] == "bv*+ba/b"));
        assert_eq!(args.last().unwrap(), "https://x");
    }

    #[test]
    fn audio_extraction_mode() {
        let args = build_download_args(FMT_AUDIO_MP3, "https://x", "/tmp/o", Some("/app/dir"));
        assert!(args.windows(2).any(|w| w[0] == "--ffmpeg-location"));
        assert!(args.contains(&"-x".to_string()));
    }
}
