//! 网络测试：按当前代理（或直连）对站点白名单做 CONNECT 连通性探测。
//! 只测"隧道可达"，不完成 TLS 握手、不传任何数据，用于设置页即时反馈。

use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// 站点白名单：前端只传 id，域名不越界
/// （防止该接口被当成任意主机 CONNECT 的探测面）
pub const TEST_SITES: &[(&str, &str)] = &[
    ("youtube", "youtube.com"),
    ("twitter", "twitter.com"),
    ("instagram", "instagram.com"),
    ("baidu", "baidu.com"),
];

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const CONNECT_PORT: u16 = 443;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteTestResult {
    pub ok: bool,
    pub error: Option<String>,
    pub latency_ms: u64,
}

fn fail(msg: impl Into<String>, latency_ms: u64) -> SiteTestResult {
    SiteTestResult {
        ok: false,
        error: Some(msg.into()),
        latency_ms,
    }
}

pub async fn probe_site(site_id: &str, proxy: Option<&str>) -> SiteTestResult {
    let Some(&(_, host)) = TEST_SITES.iter().find(|(id, _)| *id == site_id) else {
        return fail("未知测试站点", 0);
    };
    let started = Instant::now();
    // 两个分支返回不同类型，统一装箱 dyn Future 后才能共享 timeout 等待
    let probe: Pin<Box<dyn Future<Output = Result<(), String>> + Send>> = match proxy {
        None => Box::pin(direct_probe(host)),
        Some(p) => Box::pin(proxied_probe(host, p.to_string())),
    };
    let outcome = tokio::time::timeout(PROBE_TIMEOUT, probe).await;
    let latency_ms = started.elapsed().as_millis() as u64;
    match outcome {
        Err(_) => fail(
            format!("探测超时（{}s）", PROBE_TIMEOUT.as_secs()),
            latency_ms,
        ),
        Ok(Ok(())) => SiteTestResult {
            ok: true,
            error: None,
            latency_ms,
        },
        Ok(Err(msg)) => fail(msg, latency_ms),
    }
}

/// "http://user:pass@127.0.0.1:7890" → ("http", "127.0.0.1:7890")。
/// 探测不支持代理鉴权，userinfo 直接丢弃（与下载引擎的行为可能有差异，故 UI 注明"仅测链路"）。
fn split_proxy_url(url: &str) -> Result<(&str, &str), String> {
    let (scheme, rest) = url.split_once("://").ok_or("代理 URL 缺少 scheme 前缀")?;
    let endpoint = match rest.rsplit_once('@') {
        Some((_, e)) => e,
        None => rest,
    };
    if endpoint.is_empty() {
        return Err("代理地址为空".into());
    }
    Ok((scheme, endpoint))
}

async fn direct_probe(host: &str) -> Result<(), String> {
    TcpStream::connect((host, CONNECT_PORT))
        .await
        .map(|_| ())
        .map_err(|e| format!("直连失败：{e}"))
}

async fn proxied_probe(host: &str, proxy_url: String) -> Result<(), String> {
    let (scheme, endpoint) = split_proxy_url(&proxy_url)?;
    match scheme {
        // https scheme 的代理自身要 TLS，这里按明文 CONNECT 退化处理（本地代理极少见）
        "http" | "https" => http_connect_probe(&endpoint, host).await,
        "socks5" | "socks5h" => socks5_connect_probe(&endpoint, host).await,
        // SOCKS4 没有域名 CONNECT 约定，退化为验证代理端口本身可达
        "socks4" | "socks4a" => TcpStream::connect(endpoint)
            .await
            .map(|_| ())
            .map_err(|e| format!("代理端口不可达：{e}")),
        other => Err(format!("不支持的代理协议：{other}")),
    }
}

async fn http_connect_probe(proxy: &str, host: &str) -> Result<(), String> {
    let mut stream = TcpStream::connect(proxy)
        .await
        .map_err(|e| format!("连不上代理 {proxy}：{e}"))?;
    let req =
        format!("CONNECT {host}:{CONNECT_PORT} HTTP/1.1\r\nHost: {host}:{CONNECT_PORT}\r\n\r\n");
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| format!("写入代理请求失败：{e}"))?;
    let mut buf = [0u8; 256];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("读取代理响应失败：{e}"))?;
    let status_line = String::from_utf8_lossy(&buf[..n])
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    if status_line.contains(" 200") {
        Ok(())
    } else {
        Err(format!("代理拒绝 CONNECT：{status_line}"))
    }
}

async fn socks5_connect_probe(proxy: &str, host: &str) -> Result<(), String> {
    let mut stream = TcpStream::connect(proxy)
        .await
        .map_err(|e| format!("连不上代理 {proxy}：{e}"))?;
    // greeting：仅提议 no-auth
    stream
        .write_all(&[0x05, 0x01, 0x00])
        .await
        .map_err(|e| e.to_string())?;
    let mut greeting = [0u8; 2];
    stream
        .read_exact(&mut greeting)
        .await
        .map_err(|e| e.to_string())?;
    if greeting != [0x05, 0x00] {
        return Err(format!(
            "SOCKS5 握手失败（要求鉴权或非 SOCKS5 端口）：{greeting:02x?}"
        ));
    }
    // CONNECT + 域名 + 443
    let mut req = vec![0x05u8, 0x01, 0x00, 0x03, host.len() as u8];
    req.extend_from_slice(host.as_bytes());
    req.extend_from_slice(&CONNECT_PORT.to_be_bytes());
    stream.write_all(&req).await.map_err(|e| e.to_string())?;
    // 响应地址字段长度随 ATYP 变化，只取 ver|rep|rsv 前三字节判状态码
    let mut head = [0u8; 3];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|e| e.to_string())?;
    if head[0] != 0x05 {
        return Err("SOCKS5 响应格式异常".into());
    }
    if head[1] == 0x00 {
        Ok(())
    } else {
        Err(format!("SOCKS5 拒绝 CONNECT：状态码 {}", head[1]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_proxy_url_rules() {
        assert_eq!(
            split_proxy_url("http://127.0.0.1:7890").unwrap(),
            ("http", "127.0.0.1:7890")
        );
        assert_eq!(
            split_proxy_url("socks5://user:pass@127.0.0.1:1080").unwrap(),
            ("socks5", "127.0.0.1:1080")
        );
        assert!(split_proxy_url("127.0.0.1:7890").is_err());
        assert!(split_proxy_url("http://").is_err());
        assert!(split_proxy_url("http://@").is_err());
    }

    #[tokio::test]
    async fn unknown_site_fails() {
        let r = probe_site("evil", None).await;
        assert!(!r.ok);
        assert_eq!(r.error.as_deref(), Some("未知测试站点"));
    }

    #[tokio::test]
    async fn proxied_probe_to_dead_port_fails_fast() {
        // 回环端口 1 必无人监听，connect refused 即时返回，不依赖外网
        let r = probe_site("baidu", Some("socks5://127.0.0.1:1")).await;
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("连不上代理"));
    }
}
