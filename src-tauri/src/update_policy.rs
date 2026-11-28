//! 强制更新策略。
//!
//! 后台发布桌面版本时可标记 `forced`；客户端命中一个 `forced` 且更新的版本后，
//! 锁定解析/下载服务，直到用户完成更新。查询走与 tauri-plugin-updater 相同的
//! `/api/updates/desktop/{target}/{arch}/{current}` 端点——插件自身的响应结构不含
//! 自定义字段，所以我们单独发一次轻量请求读取 `forced`。基址缺位（未配置后端）
//! 或平台不支持时静默视为「不强制」，绝不误锁。

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// 最近一次策略快照。None = 尚未成功查询过（默认不强制）。
static POLICY: Mutex<Option<Policy>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    latest_version: String,
    #[serde(default)]
    forced: bool,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyStatus {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub forced: bool,
    pub notes: Option<String>,
}

/// 桌面端点 URL 里的 target 段（与 updater 插件一致：macos→darwin）。
fn os_target() -> Option<&'static str> {
    match std::env::consts::OS {
        "windows" => Some("windows"),
        "macos" => Some("darwin"),
        "linux" => Some("linux"),
        _ => None,
    }
}

fn current_version() -> &'static str {
    option_env!("CARGO_PKG_VERSION").unwrap_or("0.0.0")
}

/// 查询/刷新强制更新策略，返回当前快照。前端在启动检查与轮询时调用。
#[tauri::command]
pub async fn refresh_update_policy(
    channel: String,
    device_id: String,
) -> Result<PolicyStatus, String> {
    let channel = if channel == "beta" { "beta" } else { "stable" };
    let result = match fetch(channel, &device_id).await {
        Ok(Some(policy)) => PolicyStatus {
            current_version: current_version().to_string(),
            latest_version: Some(policy.latest_version.clone()),
            forced: policy.forced,
            notes: policy.notes.clone(),
        },
        Ok(None) => {
            // 无可用更新（或通道未配置）：解除历史门禁。
            PolicyStatus {
                current_version: current_version().to_string(),
                latest_version: None,
                forced: false,
                notes: None,
            }
        }
        // 网络/解析失败：沿用上次结果——不凭故障新增强制，也不因故障解除已生效的强制。
        Err(error) => {
            eprintln!("强制更新策略刷新失败，沿用上次结果: {error}");
            let guard = POLICY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            match guard.clone() {
                Some(previous) => PolicyStatus {
                    current_version: current_version().to_string(),
                    latest_version: Some(previous.latest_version),
                    forced: previous.forced,
                    notes: previous.notes,
                },
                None => PolicyStatus {
                    current_version: current_version().to_string(),
                    latest_version: None,
                    forced: false,
                    notes: None,
                },
            }
        }
    };
    let stored = if result.forced || result.latest_version.is_some() {
        result.latest_version.clone().map(|latest_version| Policy {
            latest_version,
            forced: result.forced,
            notes: result.notes.clone(),
        })
    } else {
        None
    };
    *POLICY.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = stored;
    Ok(result)
}

async fn fetch(channel: &str, device_id: &str) -> Result<Option<Policy>, String> {
    let Some(api_base) = option_env!("DOWNLOADANY_API_BASE_URL") else {
        return Ok(None);
    };
    if api_base.is_empty() {
        return Ok(None);
    }
    if !api_base.starts_with("https://") && !cfg!(debug_assertions) {
        return Err("更新策略接口必须使用 HTTPS".to_string());
    }
    let target = os_target().ok_or_else(|| "当前平台不支持更新策略查询".to_string())?;
    let arch = std::env::consts::ARCH;
    let url = format!(
        "{}/api/updates/desktop/{}/{}/{}",
        api_base.trim_end_matches('/'),
        target,
        arch,
        current_version()
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建更新策略客户端失败: {e}"))?;
    let response = client
        .get(&url)
        .header("X-DownloadAny-Channel", channel)
        .header("X-DownloadAny-Device-Id", device_id)
        .send()
        .await
        .map_err(|e| format!("查询更新策略失败: {e}"))?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        // 已是最新，无强制。清掉历史门禁。
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("更新策略接口返回 {}", response.status()));
    }
    #[derive(Deserialize)]
    struct Wire {
        version: String,
        #[serde(default)]
        forced: bool,
        #[serde(default)]
        notes: Option<String>,
    }
    let wire: Wire = response
        .json()
        .await
        .map_err(|e| format!("更新策略响应无效: {e}"))?;
    Ok(Some(Policy {
        latest_version: wire.version,
        forced: wire.forced,
        notes: wire.notes,
    }))
}

/// 是否处于强制更新锁定状态。queue 的解析/入队前调用，命中即拒绝服务。
pub fn is_forced() -> bool {
    POLICY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .is_some_and(|policy| policy.forced)
}

/// 服务入口的统一守卫：强制更新未完成后拒绝解析/下载。
pub fn ensure_service_allowed() -> Result<(), crate::error::AppError> {
    if is_forced() {
        return Err(crate::error::AppError::ForcedUpdate);
    }
    Ok(())
}

/// 测试用：重置策略状态，避免用例间相互污染。
#[cfg(test)]
pub fn set_forced_for_test(forced: bool) {
    let mut guard = POLICY.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = forced.then(|| Policy {
        latest_version: "9.9.9".to_string(),
        forced: true,
        notes: None,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forced_policy_blocks_service() {
        set_forced_for_test(false);
        assert!(!is_forced());
        assert!(ensure_service_allowed().is_ok());
        set_forced_for_test(true);
        assert!(is_forced());
        assert!(matches!(
            ensure_service_allowed(),
            Err(crate::error::AppError::ForcedUpdate)
        ));
        set_forced_for_test(false);
        assert!(ensure_service_allowed().is_ok());
    }

    #[test]
    fn os_target_matches_updater_convention() {
        // 桌面端点 target 段必须与 updater 插件一致：macos→darwin
        if let Some(target) = os_target() {
            assert!(["windows", "darwin", "linux"].contains(&target));
        }
    }
}
