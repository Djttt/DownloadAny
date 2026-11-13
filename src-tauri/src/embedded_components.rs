//! 编译期内嵌的基础组件，以及首次运行时的安全释放逻辑。
//!
//! 二进制以 gzip 形式进入 LumeAny 主程序，运行时释放到用户数据目录：
//! `<data>/LumeAny/tools/<component>/<version>/`。写入使用同目录临时文件和
//! 原子重命名，避免崩溃或断电留下半个可执行文件。

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MANIFEST_JSON: &str = include_str!("../embedded/manifest.json");
const YT_DLP_GZ: &[u8] = include_bytes!("../embedded/yt-dlp.gz");
const FFMPEG_GZ: &[u8] = include_bytes!("../embedded/ffmpeg.gz");
const DOUYIN_PLUGIN: &str =
    include_str!("../yt-dlp-plugins/yt_dlp_plugins/extractor/douyin_community.py");

/// 释放抖音专用的 yt-dlp 插件，并返回 `--plugin-dirs` 所需的根目录。
///
/// 插件只覆盖 DouyinIE；其他站点仍由内嵌的稳定版 yt-dlp 处理。
pub fn ensure_ytdlp_plugins() -> Result<PathBuf, String> {
    let root = data_root()?.join("LumeAny").join("plugins");
    let extractor_dir = root
        .join("douyin-pr-17826")
        .join("yt_dlp_plugins")
        .join("extractor");
    let target = extractor_dir.join("douyin_community.py");
    fs::create_dir_all(&extractor_dir).map_err(|e| format!("创建 yt-dlp 插件目录失败: {e}"))?;

    let current = fs::read_to_string(&target).ok();
    if current.as_deref() != Some(DOUYIN_PLUGIN) {
        let temp = extractor_dir.join(".douyin_community.py.installing");
        fs::write(&temp, DOUYIN_PLUGIN).map_err(|e| format!("写入 yt-dlp 插件失败: {e}"))?;
        if target.exists() {
            fs::remove_file(&target).map_err(|e| format!("替换 yt-dlp 插件失败: {e}"))?;
        }
        fs::rename(&temp, &target).map_err(|e| format!("启用 yt-dlp 插件失败: {e}"))?;
    }
    Ok(root)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    target: String,
    components: Vec<Component>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Component {
    id: String,
    version: String,
    file_name: String,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveComponent {
    version: String,
    file_name: String,
    sha256: String,
}

pub fn ensure(id: &str) -> Result<PathBuf, String> {
    let manifest: Manifest =
        serde_json::from_str(MANIFEST_JSON).map_err(|e| format!("内嵌组件清单损坏: {e}"))?;
    if manifest.schema_version != 1 {
        return Err(format!("不支持的组件清单版本: {}", manifest.schema_version));
    }
    let expected_target =
        crate::resolve::target_triple().ok_or_else(|| "当前平台不支持内嵌组件".to_string())?;
    if manifest.target != expected_target {
        return Err(format!(
            "内嵌组件平台不匹配: {} != {}",
            manifest.target, expected_target
        ));
    }

    let component = manifest
        .components
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("内嵌组件清单缺少 {id}"))?;
    validate_segment(&component.id)?;
    validate_segment(&component.version)?;
    validate_segment(&component.file_name)?;

    if let Some(path) = active_component_path(&component.id)? {
        return Ok(path);
    }

    let target = data_root()?
        .join("LumeAny")
        .join("tools")
        .join(&component.id)
        .join(&component.version)
        .join(&component.file_name);

    if target.is_file() && sha256_file(&target).is_ok_and(|hash| hash == component.sha256) {
        return Ok(target);
    }

    let payload = match id {
        "yt-dlp" => YT_DLP_GZ,
        "ffmpeg" => FFMPEG_GZ,
        _ => return Err(format!("未知内嵌组件: {id}")),
    };
    install_payload(payload, &component, &target)?;
    Ok(target)
}

pub fn embedded_version(id: &str) -> Result<String, String> {
    let manifest: Manifest =
        serde_json::from_str(MANIFEST_JSON).map_err(|e| format!("内嵌组件清单损坏: {e}"))?;
    manifest
        .components
        .into_iter()
        .find(|component| component.id == id)
        .map(|component| component.version)
        .ok_or_else(|| format!("内嵌组件清单缺少 {id}"))
}

pub fn install_remote(
    id: &str,
    version: &str,
    file_name: &str,
    sha256: &str,
    payload: &[u8],
) -> Result<PathBuf, String> {
    validate_segment(id)?;
    validate_segment(version)?;
    validate_segment(file_name)?;
    let component = Component {
        id: id.to_string(),
        version: version.to_string(),
        file_name: file_name.to_string(),
        sha256: sha256.to_ascii_lowercase(),
    };
    let target = tools_root()?.join(id).join(version).join(file_name);
    install_raw_payload(payload, &component, &target)?;
    let active = ActiveComponent {
        version: version.to_string(),
        file_name: file_name.to_string(),
        sha256: sha256.to_ascii_lowercase(),
    };
    let pointer = tools_root()?.join(id).join("active.json");
    let temp = pointer.with_extension("json.installing");
    fs::write(
        &temp,
        serde_json::to_vec(&active).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入组件指针失败: {e}"))?;
    if pointer.exists() {
        fs::remove_file(&pointer).map_err(|e| format!("替换组件指针失败: {e}"))?;
    }
    fs::rename(&temp, &pointer).map_err(|e| format!("启用组件失败: {e}"))?;
    Ok(target)
}

fn active_component_path(id: &str) -> Result<Option<PathBuf>, String> {
    let pointer = tools_root()?.join(id).join("active.json");
    if !pointer.is_file() {
        return Ok(None);
    }
    let active: ActiveComponent = match fs::read(&pointer)
        .map_err(|e| e.to_string())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
    {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    validate_segment(&active.version)?;
    validate_segment(&active.file_name)?;
    let path = tools_root()?
        .join(id)
        .join(active.version)
        .join(active.file_name);
    if path.is_file() && sha256_file(&path).is_ok_and(|hash| hash == active.sha256) {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

fn install_payload(payload: &[u8], component: &Component, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "组件安装路径无父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建组件目录失败: {e}"))?;
    let temp = parent.join(format!(".{}.installing", component.file_name));

    let result = (|| -> Result<(), String> {
        let mut decoder = GzDecoder::new(payload);
        let mut output = File::create(&temp).map_err(|e| format!("创建组件临时文件失败: {e}"))?;
        io::copy(&mut decoder, &mut output).map_err(|e| format!("释放组件失败: {e}"))?;
        output.flush().map_err(|e| format!("写入组件失败: {e}"))?;
        output
            .sync_all()
            .map_err(|e| format!("同步组件失败: {e}"))?;
        drop(output);

        let actual = sha256_file(&temp).map_err(|e| format!("校验组件失败: {e}"))?;
        if actual != component.sha256 {
            return Err(format!("{} SHA-256 校验失败", component.id));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temp, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("设置组件执行权限失败: {e}"))?;
        }

        if target.exists() {
            fs::remove_file(target).map_err(|e| format!("替换损坏组件失败: {e}"))?;
        }
        fs::rename(&temp, target).map_err(|e| format!("安装组件失败: {e}"))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn install_raw_payload(payload: &[u8], component: &Component, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "组件安装路径无父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建组件目录失败: {e}"))?;
    let temp = parent.join(format!(".{}.installing", component.file_name));
    fs::write(&temp, payload).map_err(|e| format!("写入组件失败: {e}"))?;
    let actual = sha256_file(&temp).map_err(|e| format!("校验组件失败: {e}"))?;
    if actual != component.sha256 {
        let _ = fs::remove_file(&temp);
        return Err(format!("{} SHA-256 校验失败", component.id));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("设置组件执行权限失败: {e}"))?;
    }
    if target.exists() {
        fs::remove_file(target).map_err(|e| format!("替换组件失败: {e}"))?;
    }
    fs::rename(&temp, target).map_err(|e| format!("安装组件失败: {e}"))
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_segment(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains(['/', '\\'])
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._+-".contains(c))
    {
        return Err(format!("组件清单包含非法路径段: {value}"));
    }
    Ok(())
}

fn data_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "无法定位 APPDATA".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME")
            .map(|home| PathBuf::from(home).join("Library/Application Support"))
            .ok_or_else(|| "无法定位 HOME".to_string());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(path) = env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(path));
        }
        return env::var_os("HOME")
            .map(|home| PathBuf::from(home).join(".local/share"))
            .ok_or_else(|| "无法定位 HOME".to_string());
    }
}

fn tools_root() -> Result<PathBuf, String> {
    Ok(data_root()?.join("LumeAny").join("tools"))
}
