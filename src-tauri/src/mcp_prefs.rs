//! MCP 服务的偏好读取：镜像前端 settings.ts 的持久化语义（store 文件为准）。

use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

/// 前端 `buildProxyUrl` 认可的 scheme 前缀（正则 `^(https?|socks[45]a?h?)`）。
/// addr 已带其中任一前缀则原样返回，避免再补 scheme 造成双前缀。
const PROXY_SCHEMES: &[&str] = &[
    "http://",
    "https://",
    "socks4://",
    "socks4a://",
    "socks4h://",
    "socks4ah://",
    "socks5://",
    "socks5a://",
    "socks5h://",
    "socks5ah://",
];

/// 镜像前端 buildProxyUrl：type=none 或 addr 为空 → None；addr 已带 scheme 前缀则原样 trim，
/// 否则补 `{type}://{trim}`。
pub fn build_proxy_url(proxy_type: &str, addr: &str) -> Option<String> {
    if proxy_type == "none" {
        return None;
    }
    let a = addr.trim();
    if a.is_empty() {
        return None;
    }
    let lower = a.to_lowercase();
    if PROXY_SCHEMES.iter().any(|s| lower.starts_with(s)) {
        return Some(a.to_string());
    }
    Some(format!("{proxy_type}://{a}"))
}

/// 从 plugin-store settings.json 读 proxyType/proxyAddr，组装为代理 URL（store 文件为准）。
pub fn store_proxy(app: &AppHandle) -> Option<String> {
    let store = app.store("settings.json").ok()?;
    let get_str = |key: &str| {
        store
            .get(key)
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default()
    };
    build_proxy_url(&get_str("proxyType"), &get_str("proxyAddr"))
}

/// 输出目录：store 的 outputDir；缺省回退系统下载目录；都拿不到返回空串（由调用方报错）。
pub fn store_output_dir(app: &AppHandle) -> String {
    if let Ok(store) = app.store("settings.json") {
        if let Some(dir) = store.get("outputDir").and_then(|v| v.as_str().map(String::from)) {
            if !dir.is_empty() {
                return dir;
            }
        }
    }
    app.path()
        .download_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::build_proxy_url;

    #[test]
    fn build_proxy_url_mirrors_frontend() {
        assert_eq!(build_proxy_url("none", "127.0.0.1:7890"), None);
        assert_eq!(build_proxy_url("http", "  "), None);
        assert_eq!(
            build_proxy_url("http", "127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            build_proxy_url("socks5", "127.0.0.1:7891").as_deref(),
            Some("socks5://127.0.0.1:7891")
        );
        assert_eq!(
            build_proxy_url("http", "http://127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            build_proxy_url("http", "socks5://user:pass@host:1080").as_deref(),
            Some("socks5://user:pass@host:1080")
        );
    }
}
