//! 解析 --progress-template 输出的竖线分隔进度行。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressUpdate {
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
}

/// `job-progress` 事件的完整 payload
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub job_id: u64,
    #[serde(flatten)]
    pub update: ProgressUpdate,
}

/// yt-dlp 对未知字段打印 "None"；_percent_str 形如 " 45.2%"。
pub fn parse_progress_line(prefix: &str, line: &str) -> Option<ProgressUpdate> {
    let rest = line.strip_prefix(prefix)?;
    // 去前缀后共 6 段：percent|downloaded|total|total_estimate|speed|eta
    let f: Vec<&str> = rest.split('|').collect();
    if f.len() < 6 {
        return None;
    }
    let percent = f[0].trim().trim_end_matches('%').trim().parse().ok()?;
    let downloaded_bytes = parse_num(f[1])? as u64;
    Some(ProgressUpdate {
        percent,
        downloaded_bytes,
        // total_bytes 对直播/未知长度视频为 None，退回 estimate
        total_bytes: parse_num(f[2])
            .or_else(|| parse_num(f[3]))
            .map(|v| v as u64),
        speed: parse_num(f[4]),
        eta: parse_num(f[5]).map(|v| v as u64),
    })
}

fn parse_num(s: &str) -> Option<f64> {
    let s = s.trim();
    if s == "None" || s.is_empty() || s == "NA" || s == "--:--" {
        return None;
    }
    s.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_line() {
        let line = "PROGRESS| 45.2%|12345678.0|27300000.0|None|1500000.0|10";
        let p = parse_progress_line("PROGRESS|", line).unwrap();
        assert!((p.percent - 45.2).abs() < 0.01);
        assert_eq!(p.downloaded_bytes, 12345678);
        assert_eq!(p.total_bytes, Some(27300000));
        assert_eq!(p.eta, Some(10));
    }

    #[test]
    fn handles_unknown_totals() {
        let line = "PROGRESS| 12.3%|1000.0|None|9000.0|None|None";
        let p = parse_progress_line("PROGRESS|", line).unwrap();
        assert_eq!(p.total_bytes, Some(9000)); // 退回 estimate
        assert_eq!(p.speed, None);
        assert_eq!(p.eta, None);
    }

    #[test]
    fn ignores_other_lines() {
        assert!(parse_progress_line("PROGRESS|", "[Merger] Merging formats").is_none());
        assert!(parse_progress_line("PROGRESS|", "[download] Destination: /tmp/a.mp4").is_none());
    }
}
