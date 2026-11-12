//! 桌面 Rust 侧的后端访问层。
//! MCP 运行在 Rust 进程中，无法读取 WebView localStorage；前端登录后通过
//! `set_backend_session` 把当前会话同步到这里只驻留内存的状态中。

use crate::{error::AppError, probe::VideoInfo};
use serde::Deserialize;
use std::sync::{Arc, RwLock};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendSession {
    pub api_base: String,
    pub access_token: String,
}

#[derive(Clone, Default)]
pub struct BackendAuthState {
    inner: Arc<RwLock<Option<BackendSession>>>,
}

impl BackendAuthState {
    fn set(&self, session: Option<BackendSession>) {
        *self.inner.write().unwrap() = session;
    }

    fn get(&self) -> Option<BackendSession> {
        self.inner.read().unwrap().clone()
    }
}

#[tauri::command]
pub fn set_backend_session(
    state: State<'_, BackendAuthState>,
    session: Option<BackendSession>,
) -> Result<(), AppError> {
    if let Some(value) = &session {
        validate_api_base(&value.api_base)?;
        if value.access_token.trim().is_empty() {
            return Err(AppError::BackendAuth("登录凭证为空".into()));
        }
    }
    state.set(session);
    Ok(())
}

fn validate_api_base(raw: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(raw).map_err(|_| AppError::Backend("后端服务地址无效".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppError::Backend("后端服务地址必须是 HTTP(S) 地址".into()));
    }
    Ok(())
}

fn backend_error(body: &str, status: reqwest::StatusCode) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("detail")
                .and_then(|detail| detail.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| format!("后端请求失败 ({status})"))
}

pub async fn parse_video(auth: &BackendAuthState, url: &str) -> Result<VideoInfo, AppError> {
    let session = auth
        .get()
        .ok_or_else(|| AppError::BackendAuth("请先在 LumeAny 桌面端登录".into()))?;
    validate_api_base(&session.api_base)?;

    let endpoint = format!("{}/api/media/parse", session.api_base.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(session.access_token)
        .json(&serde_json::json!({ "url": url }))
        .send()
        .await
        .map_err(|error| AppError::Backend(format!("无法连接后端服务：{error}")))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| AppError::Backend(format!("读取后端响应失败：{error}")))?;

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::BackendAuth(
            "登录状态已失效，请在 LumeAny 中重新登录".into(),
        ));
    }
    if !status.is_success() {
        return Err(AppError::Backend(backend_error(&body, status)));
    }
    serde_json::from_str(&body)
        .map_err(|error| AppError::Backend(format!("后端解析结果格式错误：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_state_roundtrip_and_clear() {
        let state = BackendAuthState::default();
        state.set(Some(BackendSession {
            api_base: "http://127.0.0.1:8000".into(),
            access_token: "token".into(),
        }));
        assert_eq!(state.get().unwrap().access_token, "token");
        state.set(None);
        assert!(state.get().is_none());
    }
}
