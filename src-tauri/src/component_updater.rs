use base64::{Engine as _, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const UPDATE_PUBLIC_KEY: &str = "untrusted comment: minisign public key: 5184A1D7455BD5D4\nRWTU1VtF16GEUcOs4j0+53GWtvSLPkn1iqChXRndy+EowiEZ/fqc0obB\n";

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
    let payload = client
        .get(&update.url)
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
    Ok(ComponentUpdateResult {
        updated: true,
        version: update.version,
    })
}
