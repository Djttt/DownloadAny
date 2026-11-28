use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const UPDATE_PUBLIC_KEY: &str = "untrusted comment: minisign public key: C12315F5627AD4EE\nRWTu1Hpi9RUjwYq2LCJClVOnsY0x6AQRVMvpiL+O09WzwlpidSjUBPUd\n";

#[derive(Debug, Deserialize)]
struct ComponentUpdate {
    component: String,
    version: String,
    url: String,
    signature: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentUpdateResult {
    updated: bool,
    version: String,
}

#[tauri::command]
pub async fn update_ytdlp_component(
    channel: String,
    device_id: String,
) -> Result<ComponentUpdateResult, String> {
    if channel != "stable" && channel != "beta" {
        return Err("无效更新通道".to_string());
    }
    let current = crate::embedded_components::ensure("yt-dlp")?;
    let current_version = current
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .map(str::to_owned)
        .unwrap_or(crate::embedded_components::embedded_version("yt-dlp")?);
    let Some(api_base) = option_env!("DOWNLOADANY_API_BASE_URL") else {
        return Ok(ComponentUpdateResult {
            updated: false,
            version: current_version,
        });
    };
    if !api_base.starts_with("https://") && !cfg!(debug_assertions) {
        return Err("组件更新接口必须使用 HTTPS".to_string());
    }
    let target =
        crate::resolve::target_triple().ok_or_else(|| "当前平台不支持组件更新".to_string())?;
    let url = format!(
        "{}/api/updates/components/yt-dlp/{}/{}",
        api_base.trim_end_matches('/'),
        target,
        current_version
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| format!("创建组件更新客户端失败: {e}"))?;
    let response = client
        .get(url)
        .header("X-DownloadAny-Channel", channel)
        .header("X-DownloadAny-Device-Id", device_id)
        .send()
        .await
        .map_err(|e| format!("检查组件更新失败: {e}"))?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(ComponentUpdateResult {
            updated: false,
            version: current_version,
        });
    }
    if !response.status().is_success() {
        return Err(format!("组件更新接口返回 {}", response.status()));
    }
    let update: ComponentUpdate = response
        .json()
        .await
        .map_err(|e| format!("组件更新清单无效: {e}"))?;
    if update.component != "yt-dlp" {
        return Err("组件更新清单类型不匹配".to_string());
    }
    // 防降级：清单只应携带比当前更新的版本，挡掉被篡改/重放的旧版本号。
    match compare_versions(&update.version, &current_version) {
        Some(ordering) if ordering == std::cmp::Ordering::Less => {
            return Err(format!(
                "拒绝降级：清单版本 {} 低于当前版本 {}",
                update.version, current_version
            ))
        }
        Some(ordering) if ordering == std::cmp::Ordering::Equal => {
            return Ok(ComponentUpdateResult {
                updated: false,
                version: current_version,
            })
        }
        _ => {}
    }
    // 产物来源必须是 HTTPS（开发态允许 http 便于联调）；url 由服务端返回，不能退回明文。
    let url = reqwest::Url::parse(&update.url).map_err(|_| "组件下载地址无效".to_string())?;
    if url.scheme() != "https" && !cfg!(debug_assertions) {
        return Err("组件下载地址必须使用 HTTPS".to_string());
    }
    let payload = client
        .get(url.clone())
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|e| format!("下载 yt-dlp 更新失败: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("读取 yt-dlp 更新失败: {e}"))?;
    let actual_sha = format!("{:x}", Sha256::digest(&payload));
    if actual_sha != update.sha256.to_ascii_lowercase() {
        return Err("yt-dlp 更新 SHA-256 校验失败".to_string());
    }
    let public_key =
        PublicKey::decode(UPDATE_PUBLIC_KEY).map_err(|e| format!("更新公钥无效: {e}"))?;
    let signature_text = STANDARD
        .decode(&update.signature)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_else(|| update.signature.clone());
    let signature = Signature::decode(&signature_text).map_err(|e| format!("组件签名无效: {e}"))?;
    public_key
        .verify(&payload, &signature, false)
        .map_err(|e| format!("yt-dlp 签名校验失败: {e}"))?;
    // 版本绑定：trusted comment 被签名的 global 段覆盖，故其中的版本可信。要求它等于
    // 清单版本——对齐桌面通道 requireSignedVersion，防止篡改清单把新版本号配到旧产物。
    // 签名时须用 `tauri signer sign --app-version <version>`（见 docs/PHASE2_UPDATES.md）。
    let signed_version = signed_version_in_comment(signature.trusted_comment())
        .ok_or_else(|| "组件签名未绑定版本（签名需用 `tauri signer sign --app-version`）".to_string())?;
    if signed_version != update.version {
        return Err(format!(
            "组件签名版本 {signed_version} 与清单版本 {} 不一致",
            update.version
        ));
    }
    let file_name = if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    crate::embedded_components::install_remote(
        "yt-dlp",
        &update.version,
        file_name,
        &update.sha256,
        &payload,
    )?;
    // 让解析缓存作废，下一次 spawn 立即用上新版本（否则本次会话仍跑旧二进制）。
    crate::resolve::invalidate("yt-dlp");
    Ok(ComponentUpdateResult {
        updated: true,
        version: update.version,
    })
}

/// 从签名 trusted comment（形如 `timestamp:...\tfile:...\tversion:2026.11.08`）取出版本。
fn signed_version_in_comment(comment: &str) -> Option<&str> {
    comment
        .split(['\t', ' '])
        .find_map(|field| field.strip_prefix("version:"))
        .filter(|version| !version.is_empty())
}

/// 按点分数值比较版本（yt-dlp 为 2026.10.26 这类日期版本，纯字符串比较会错序）。
/// 任一段无法解析为数字前缀时按 0 处理；长度不同的短位补 0。
fn compare_versions(a: &str, b: &str) -> Option<std::cmp::Ordering> {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    };
    let (left, right) = (parse(a), parse(b));
    let len = left.len().max(right.len());
    for i in 0..len {
        let l = left.get(i).copied().unwrap_or(0);
        let r = right.get(i).copied().unwrap_or(0);
        match l.cmp(&r) {
            std::cmp::Ordering::Equal => continue,
            other => return Some(other),
        }
    }
    Some(std::cmp::Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn compares_dotted_versions() {
        assert_eq!(compare_versions("2026.11.08", "2026.10.26"), Some(Ordering::Greater));
        assert_eq!(compare_versions("2026.9.01", "2026.10.01"), Some(Ordering::Less));
        assert_eq!(compare_versions("2026.10.26", "2026.10.26"), Some(Ordering::Equal));
        // 短位补 0：2026.11 == 2026.11.0
        assert_eq!(compare_versions("2026.11", "2026.11.0"), Some(Ordering::Equal));
        // 去掉 v 前缀，非数字后缀按前缀数字算
        assert_eq!(compare_versions("v2026.12.01", "2026.11.30"), Some(Ordering::Greater));
    }

    #[test]
    fn extracts_signed_version() {
        assert_eq!(
            signed_version_in_comment("timestamp:1795869258\tfile:yt-dlp\tversion:2026.11.08"),
            Some("2026.11.08")
        );
        // 顺序无关
        assert_eq!(
            signed_version_in_comment("version:2026.11.08\ttimestamp:1"),
            Some("2026.11.08")
        );
        // 无版本字段（默认 tauri signer sign 不带 --app-version 时）→ None，触发拒绝
        assert_eq!(signed_version_in_comment("timestamp:1\tfile:yt-dlp"), None);
        // 空版本值也当缺省
        assert_eq!(signed_version_in_comment("version:"), None);
    }
}
