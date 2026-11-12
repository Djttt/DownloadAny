//! MCP 工具面：解析统一请求业务后端，下载/进度/取消直连本地 queue 管线。
//! agent 可达的 format_id 走窄白名单（本次 probe 返回的可见选项 + 最佳/MP3 哨兵），
//! `args.rs` 的宽校验仍是下载命令的唯一边界。

use crate::{
    args,
    backend::{self, BackendAuthState},
    mcp_prefs,
    probe::FormatOption,
    queue::{self, AppState, ProbedInfo},
};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ErrorData};
use rmcp::{ServerHandler, schemars, tool, tool_handler, tool_router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

/// `__video_<h>p__` 伪 id 解析（args.rs 的 video_height 是私有的，这里独立小实现）
fn video_pseudo_height(id: &str) -> Option<u32> {
    let core = id.strip_prefix("__video_")?.strip_suffix("p__")?;
    if core.is_empty() || !core.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    core.parse().ok()
}

/// agent 面可见的清晰度选项：白名单保留制（最佳画质 / 具体高度档 / MP3）
pub fn agent_formats<'a>(formats: &'a [FormatOption]) -> Vec<&'a FormatOption> {
    formats
        .iter()
        .filter(|f| {
            f.id == args::FMT_BEST
                || f.id == args::FMT_AUDIO_MP3
                || video_pseudo_height(&f.id).is_some()
        })
        .collect()
}

/// MCP 入口的窄格式白名单：仅本次 probe 返回过的可见选项
pub fn format_allowed(meta: &ProbedInfo, raw: &str) -> bool {
    agent_formats(&meta.formats).iter().any(|f| f.id == raw)
}

fn internal_err(e: impl std::fmt::Display) -> ErrorData {
    ErrorData::internal_error(e.to_string(), None)
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ProbeArgs {
    pub url: String,
    #[serde(default)]
    pub proxy: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    pub url: String,
    #[serde(default)]
    pub format_id: Option<String>,
    #[serde(default)]
    pub proxy: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelArgs {
    pub job_id: u64,
}

#[derive(Clone)]
pub struct AgentTools {
    app: AppHandle,
    state: AppState,
    auth: BackendAuthState,
    /// url -> probe 时用过的代理：探测/下载同代理，避免"探测成功下载连不上"割裂
    proxy_memory: Arc<Mutex<HashMap<String, String>>>,
}

impl AgentTools {
    pub fn new(app: AppHandle, state: AppState, auth: BackendAuthState) -> Self {
        Self {
            app,
            state,
            auth,
            proxy_memory: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 代理优先级：显式参数 → 该 URL probe 时记忆 → 设置页持久化偏好
    fn resolve_proxy(
        &self,
        url: &str,
        explicit: Option<&str>,
    ) -> Result<Option<String>, ErrorData> {
        if let Some(raw) = explicit {
            return args::validate_proxy(Some(raw))
                .map_err(|e| ErrorData::invalid_params(e.to_string(), None));
        }
        if let Some(p) = self.proxy_memory.lock().unwrap().get(url) {
            return Ok(Some(p.clone()));
        }
        Ok(mcp_prefs::store_proxy(&self.app))
    }

    fn remember_proxy(&self, url: &str, proxy: Option<&String>) {
        if let Some(p) = proxy {
            self.proxy_memory
                .lock()
                .unwrap()
                .insert(url.to_string(), p.clone());
        }
    }

    async fn probe_backend_and_cache(
        &self,
        url: &str,
    ) -> Result<crate::probe::VideoInfo, ErrorData> {
        let info = backend::parse_video(&self.auth, url)
            .await
            .map_err(internal_err)?;
        let formats = info.formats.clone();
        self.state.cache_probe(
            url,
            ProbedInfo {
                valid_ids: std::collections::HashSet::new(),
                title: info.title.clone(),
                formats,
            },
        );
        Ok(info)
    }
}

#[tool_router]
impl AgentTools {
    #[tool(
        description = "通过 LumeAny 后端解析视频链接，返回标题、时长（秒）与人读清晰度选项；formats[].id 即 start_download 的 formatId 取值（__best__ 为最高画质，__audio_mp3__ 仅音频）。proxy 可省略，仅用于后续本地下载。"
    )]
    async fn probe_video(
        &self,
        Parameters(p): Parameters<ProbeArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = p.url.trim().to_string();
        args::validate_url(&url).map_err(internal_err)?;
        let proxy = self.resolve_proxy(&url, p.proxy.as_deref())?;
        let info = self.probe_backend_and_cache(&url).await?;
        self.remember_proxy(&url, proxy.as_ref());
        let formats: Vec<Value> = agent_formats(&info.formats)
            .into_iter()
            .map(|f| {
                json!({
                    "id": f.id,
                    "label": f.label,
                    "height": f.height,
                    "ext": f.ext,
                    "filesize": f.filesize,
                })
            })
            .collect();
        Ok(CallToolResult::structured(json!({
            "title": info.title,
            "durationSeconds": info.duration,
            "uploader": info.uploader,
            "formats": formats,
        })))
    }

    #[tool(
        description = "下发下载任务到 LumeAny 队列（界面上实时可见）。formatId 必须是本会话 probe_video 返回的 id，或 __best__（缺省）/ __audio_mp3__；未解析过的链接会自动先解析。完成后用 list_jobs 查询 outputPath。"
    )]
    async fn start_download(
        &self,
        Parameters(p): Parameters<StartArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        let url = p.url.trim().to_string();
        args::validate_url(&url).map_err(internal_err)?;
        let format_id = p.format_id.unwrap_or_else(|| args::FMT_BEST.to_string());
        let proxy = self.resolve_proxy(&url, p.proxy.as_deref())?;
        if self.state.probe_meta(&url).is_none() {
            self.probe_backend_and_cache(&url).await?;
            self.remember_proxy(&url, proxy.as_ref());
        }
        let meta = self
            .state
            .probe_meta(&url)
            .ok_or_else(|| ErrorData::internal_error("该链接探测未成功，无法下载", None))?;
        if !format_allowed(&meta, &format_id) {
            return Err(ErrorData::invalid_params(
                format!(
                    "格式 {format_id} 不在本次解析结果中；请使用 probe_video 返回的 id，或 __best__ / __audio_mp3__"
                ),
                None,
            ));
        }
        let format_label = meta
            .formats
            .iter()
            .find(|f| f.id == format_id)
            .map(|f| f.label.clone())
            .unwrap_or_else(|| format_id.clone());
        let output_dir = mcp_prefs::store_output_dir(&self.app);
        if output_dir.is_empty() {
            return Err(ErrorData::internal_error(
                "无法确定下载目录：设置页未指定且系统下载目录不可用",
                None,
            ));
        }
        let job_id = queue::enqueue(
            &self.app,
            &self.state,
            queue::DownloadOptions {
                url,
                format_id,
                output_dir,
                title: Some(meta.title.clone()),
                format_label: Some(format_label),
                proxy,
            },
        )
        .await
        .map_err(internal_err)?;
        Ok(CallToolResult::structured(json!({ "jobId": job_id })))
    }

    #[tool(
        description = "列出所有下载任务：id、状态（queued/running/completed/failed/cancelled）、进度百分比、速度、剩余时间、完成后的 outputPath 文件路径。"
    )]
    async fn list_jobs(&self) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::structured(
            json!({ "jobs": self.state.list() }),
        ))
    }

    #[tool(
        description = "按 jobId 取消下载任务（终止整个进程组，含 FFmpeg 子进程）。已完成的任务取消会静默成功。"
    )]
    async fn cancel_download(
        &self,
        Parameters(p): Parameters<CancelArgs>,
    ) -> Result<CallToolResult, ErrorData> {
        queue::cancel(&self.state, p.job_id).map_err(internal_err)?;
        Ok(CallToolResult::structured(json!({ "ok": true })))
    }
}

// 不给 version：宏生成的 get_info 用 env!("CARGO_PKG_VERSION")，与本 crate 版本同调
#[tool_handler(
    name = "lumeany",
    instructions = "LumeAny 桌面视频下载器：先 probe_video 获取清晰度选项，再 start_download 下发任务，list_jobs 轮询进度与 outputPath，cancel_download 取消。任务与桌面界面共享同一队列。"
)]
impl ServerHandler for AgentTools {}

#[cfg(test)]
mod tests {
    use super::{agent_formats, format_allowed};
    use crate::{args, probe::FormatOption, queue::ProbedInfo};
    use std::collections::HashSet;

    fn f(id: &str, label: &str) -> FormatOption {
        FormatOption {
            id: id.into(),
            label: label.into(),
            height: None,
            ext: None,
            filesize: None,
        }
    }

    #[test]
    fn agent_face_hides_sidecar_forms() {
        let fmts = vec![
            f(args::FMT_BEST, "最佳"),
            f("__video_1080p__", "1080p"),
            f(args::FMT_AUDIO_MP3, "MP3"),
            f(args::FMT_THUMBNAIL, "封面"),
            f("__subtitle_en", "字幕"),
            f(args::FMT_AUDIO_M4A, "m4a"),
        ];
        let visible: Vec<_> = agent_formats(&fmts)
            .into_iter()
            .map(|x| x.id.clone())
            .collect();
        assert_eq!(
            visible,
            vec![args::FMT_BEST, "__video_1080p__", args::FMT_AUDIO_MP3]
        );
        let meta = ProbedInfo {
            valid_ids: HashSet::new(),
            title: "t".into(),
            formats: fmts.clone(),
        };
        assert!(format_allowed(&meta, "__video_1080p__"));
        assert!(format_allowed(&meta, args::FMT_BEST));
        assert!(!format_allowed(&meta, args::FMT_AUDIO_M4A)); // args.rs 放行但 MCP 拒绝
        assert!(!format_allowed(&meta, args::FMT_THUMBNAIL));
        assert!(!format_allowed(&meta, "137")); // 未 probe 出的真实 id 拒绝
        assert!(!format_allowed(&meta, "__video_99999p__")); // 宽校验的裸高度哨兵拒绝
    }

    #[test]
    fn video_pseudo_requires_digits() {
        assert_eq!(super::video_pseudo_height("__video_1080p__"), Some(1080));
        assert_eq!(super::video_pseudo_height("__video_2160p__"), Some(2160));
        assert_eq!(super::video_pseudo_height("__video_p__"), None);
        assert_eq!(super::video_pseudo_height("__video_1080X__"), None);
        assert_eq!(super::video_pseudo_height("1080p"), None);
    }
}
