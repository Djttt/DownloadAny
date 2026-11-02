use serde::Serialize;

/// 所有 command 的统一错误类型。
/// 序列化为字符串直接呈现给前端（v1 不做错误码分类）。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("无效链接：URL 必须以 http:// 或 https:// 开头")]
    InvalidUrl,
    #[error("无效格式：{0}")]
    InvalidFormat(String),
    #[error("未找到 yt-dlp，请先安装或运行 `node scripts/fetch-binaries.mjs`")]
    YtDlpNotFound,
    #[error("探测超时（60s），请检查网络后重试")]
    ProbeTimeout,
    #[error("探测失败：{0}")]
    ProbeFailed(String),
    #[error("暂不支持播放列表/频道链接，请输入单个视频链接")]
    PlaylistUnsupported,
    #[error("启动下载进程失败：{0}")]
    Spawn(String),
    #[error("解析 yt-dlp 输出失败：{0}")]
    Parse(String),
    #[error("任务不存在: {0}")]
    JobNotFound(u64),
    #[error("IO 错误：{0}")]
    Io(#[from] std::io::Error),
}

impl From<AppError> for tauri::ipc::InvokeError {
    fn from(e: AppError) -> Self {
        tauri::ipc::InvokeError::from(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Parse(e.to_string())
    }
}

/// 任务状态机。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}
