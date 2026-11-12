//! MCP 服务生命周期：Streamable HTTP 挂 127.0.0.1:8790/mcp，默认关闭、随开随停。
//! bind 失败以状态结构返回（Ok），不炸调用方；停止走优雅关停 + 3s 兜底 abort。

use crate::{error::AppError, mcp_tools::AgentTools, queue};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde::Serialize;
use std::sync::Arc;
use tokio::{net::TcpListener, sync::oneshot};

pub const MCP_PORT: u16 = 8790;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
}

impl Default for McpStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: MCP_PORT,
            error: None,
        }
    }
}

struct Runtime {
    join: tokio::task::JoinHandle<()>,
    shutdown: oneshot::Sender<()>,
}

/// 至多一个运行实例；命令级互斥天然覆盖快速开关竞态
static RUNTIME: tokio::sync::Mutex<Option<Runtime>> = tokio::sync::Mutex::const_new(None);

/// serve 任务自行死亡（如 accept 循环报错退出）时回收条目，
/// 否则状态假"运行中"、开关短路无法重启；shutdown 发送端随条目一起丢弃。
fn reap_dead(guard: &mut Option<Runtime>) {
    if guard.as_ref().is_some_and(|rt| rt.join.is_finished()) {
        let rt = guard.take().expect("guard was Some");
        eprintln!("MCP server task exited on its own; state reset");
        drop(rt.shutdown);
    }
}

#[tauri::command]
pub async fn mcp_status() -> McpStatus {
    let mut guard = RUNTIME.lock().await;
    reap_dead(&mut guard);
    if guard.is_some() {
        McpStatus {
            running: true,
            port: MCP_PORT,
            error: None,
        }
    } else {
        McpStatus::default()
    }
}

#[tauri::command]
pub async fn set_mcp_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, queue::AppState>,
    on: bool,
) -> Result<McpStatus, AppError> {
    let mut guard = RUNTIME.lock().await;
    reap_dead(&mut guard);
    if !on {
        if let Some(rt) = guard.take() {
            let Runtime { mut join, shutdown } = rt;
            let _ = shutdown.send(());
            if tokio::time::timeout(std::time::Duration::from_secs(3), &mut join)
                .await
                .is_err()
            {
                join.abort();
                eprintln!("MCP server did not exit within 3s, aborted");
            }
        }
        return Ok(McpStatus::default());
    }
    if guard.is_some() {
        return Ok(McpStatus {
            running: true,
            port: MCP_PORT,
            error: None,
        });
    }
    let listener = match TcpListener::bind(("127.0.0.1", MCP_PORT)).await {
        Ok(l) => l,
        Err(e) => {
            return Ok(McpStatus {
                running: false,
                port: MCP_PORT,
                error: Some(e.to_string()),
            })
        }
    };
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let state = state.inner().clone();
    let service = StreamableHttpService::new(
        move || Ok(AgentTools::new(app.clone(), state.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default().with_json_response(true),
    );
    let router = axum::Router::new().nest_service("/mcp", service);
    let join = tokio::spawn(async move {
        let server = axum::serve(listener, router)
            .with_graceful_shutdown(async move { let _ = shutdown_rx.await; });
        if let Err(e) = server.await {
            eprintln!("MCP server exited with error: {e}");
        }
    });
    *guard = Some(Runtime {
        join,
        shutdown: shutdown_tx,
    });
    Ok(McpStatus {
        running: true,
        port: MCP_PORT,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_status_wire_shape_for_frontend() {
        assert_eq!(MCP_PORT, 8790);
        // 关闭态：前端按 {running, port, error} camelCase 直读，error 缺省必须是 null 而非缺席
        let off = McpStatus::default();
        assert_eq!(
            serde_json::to_value(&off).unwrap(),
            serde_json::json!({ "running": false, "port": 8790, "error": null })
        );
        let err = McpStatus {
            running: false,
            port: MCP_PORT,
            error: Some("Address in use".into()),
        };
        assert_eq!(
            serde_json::to_value(&err).unwrap()["error"],
            "Address in use"
        );
    }

    /// serve 任务自行死亡后，状态必须回落为未运行（否则面板假"运行中"、开关短路无法重启）
    #[tokio::test]
    async fn dead_serve_task_is_reaped() {
        let join = tokio::spawn(async {});
        while !join.is_finished() {
            tokio::task::yield_now().await;
        }
        let (tx, _rx) = oneshot::channel::<()>();
        *RUNTIME.lock().await = Some(Runtime {
            join,
            shutdown: tx,
        });
        let s = mcp_status().await;
        assert!(!s.running, "dead task must not report running");
        assert!(RUNTIME.lock().await.is_none(), "dead entry must be reaped");
    }

    /// 挂载链（axum nest_service + StreamableHttpService + json_response）的运行时证据：
    /// 真实 TCP 上完成 JSON-RPC initialize 握手。工具面逻辑不在此证明（需 AppHandle）。
    #[tokio::test]
    async fn streamable_http_mount_serves_initialize() {
        #[derive(Clone)]
        struct Stub;
        impl rmcp::ServerHandler for Stub {}

        let service = StreamableHttpService::new(
            || Ok(Stub),
            Arc::new(LocalSessionManager::default()),
            StreamableHttpServerConfig::default().with_json_response(true),
        );
        let router = axum::Router::new().nest_service("/mcp", service);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move { let _ = rx.await; })
                .await;
        });

        let body = serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "0" }
            }
        });
        let res = reqwest::Client::new()
            .post(format!("http://{addr}/mcp"))
            .header("accept", "application/json, text/event-stream")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), reqwest::StatusCode::OK);
        let text = res.text().await.unwrap();
        assert!(text.contains("\"serverInfo\""), "init response: {text}");
        drop(tx);
    }
}
