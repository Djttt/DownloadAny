//! 小红书短链预处理：与后端 `media_parsing/xiaohongshu.py` 同源。
//!
//! xhslink.com/xhslink.cn 短链不在 yt-dlp 识别范围，yt-dlp 自己跟随重定向会
//! 落到 xiaohongshu/rednote 的 /login 墙上，报 `ERROR: Unsupported URL`。
//! 登录页 query 里的 redirectPath 带着含 xsec_token 的完整笔记地址，解出来
//! 等价于用户手工复制长链接，交 yt-dlp 即可正常提取。

use crate::error::AppError;
use regex::Regex;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use url::Url;

/// 短链域名（含子域匹配，见 `hostname_matches`）
const SHORT_HOSTS: [&str; 2] = ["xhslink.com", "xhslink.cn"];
/// 小红书站内域名：rednote.com 是按出口 IP 分流的海外域名，yt-dlp 不认
const NOTE_HOSTS: [&str; 2] = ["xiaohongshu.com", "rednote.com"];
const NOTE_HOST: &str = "www.xiaohongshu.com";
/// 与后端 DEFAULT_USER_AGENT 保持一致：UA 会影响站内是否下发登录墙
pub(crate) const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
pub(crate) const HOME_URL: &str = "https://www.xiaohongshu.com/";
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(15);
/// 短链跳数上限：真实链条只有 1~2 跳。4 跳 × 15s 也与探测本身的超时同量级
const MAX_REDIRECTS: usize = 4;

fn note_path_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^/(?:explore|discovery/item)/[0-9a-fA-F]{8,}").expect("笔记路径正则必须能编译")
    })
}

/// 域名匹配：本身或任意子域（与后端 `_hostname_matches` 一致）
fn hostname_matches(host: &str, domains: &[&str]) -> bool {
    !host.is_empty() && domains.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

fn parse(raw: &str) -> Option<Url> {
    Url::parse(raw.trim()).ok()
}

/// 是否为需要预处理的小红书短链
fn is_short_link(url: &str) -> bool {
    parse(url)
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .is_some_and(|host| hostname_matches(&host, &SHORT_HOSTS))
}

/// 是否为小红书站内地址（含海外分流域名 rednote.com）：决定要不要带站内 Referer
pub(crate) fn is_site_url(url: &str) -> bool {
    parse(url)
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .is_some_and(|host| hostname_matches(&host, &NOTE_HOSTS))
}

/// 把小红书域名下的笔记/登录墙地址还原成规范笔记链接。
///
/// - 已是 `/explore/` 或 `/discovery/item/` 形态：统一为 https + www.xiaohongshu.com
///   （rednote.com 是按出口 IP 分流的海外域名，yt-dlp 不认，需要改写）；
/// - `/login` 登录墙：取 redirectPath 再走同一逻辑（最多 3 跳）。
///
/// query 串按原样 percent-encoding 透传，不做解码/重编码，避免二次破坏 token。
fn canonical_note_url(raw: &str) -> Option<String> {
    let mut current = raw.trim().to_string();
    for _ in 0..3 {
        let parsed = parse(&current)?;
        let host = parsed.host_str()?.to_ascii_lowercase();
        let path = parsed.path().to_string();
        if !hostname_matches(&host, &NOTE_HOSTS) {
            return None;
        }
        if note_path_regex().is_match(&path) {
            let note_url = match parsed.query() {
                Some(query) if !query.is_empty() => format!("https://{NOTE_HOST}{path}?{query}"),
                _ => format!("https://{NOTE_HOST}{path}"),
            };
            return Some(note_url);
        }
        if path.trim_end_matches('/').to_ascii_lowercase().ends_with("/login") {
            current = parsed
                .query_pairs()
                .find(|(key, _)| key == "redirectPath")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_default();
            continue;
        }
        return None;
    }
    None
}

/// 从短链重定向链条的任一落地地址还原规范笔记链接。
///
/// 落地页可能是 http/https、裸域/www 的任意组合（如 App 下载引导页没带登录
/// query），因此用同一 path+query 构造候选逐个试解。
pub fn expand_redirect(raw: &str) -> Option<String> {
    let mut candidates: Vec<String> = vec![raw.trim().to_string()];
    candidates.extend(host_and_scheme_variants(raw));
    candidates.iter().find_map(|candidate| canonical_note_url(candidate))
}

/// 同一 path+query 的 scheme × 裸域/www 变体；非 http(s) 地址没有变体可言
fn host_and_scheme_variants(raw: &str) -> Vec<String> {
    let Some(parsed) = parse(raw).filter(|url| matches!(url.scheme(), "http" | "https")) else {
        return Vec::new();
    };
    let Some(host) = parsed.host_str().map(str::to_string) else {
        return Vec::new();
    };
    let path = parsed.path();
    let query = parsed.query().unwrap_or_default();
    let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();
    let mut variants = Vec::new();
    for scheme in ["https", "http"] {
        for netloc in [host.clone(), format!("www.{host}")] {
            let alternate = format!("{scheme}://{netloc}{port}{path}");
            variants.push(if query.is_empty() {
                alternate
            } else {
                format!("{alternate}?{query}")
            });
        }
    }
    variants
}

/// 会话内"短链 → 笔记直链"映射。探测与下载分两次进入本模块，两次必须拿到
/// 同一个地址：小红书每次下发的 query（share_id/apptime 等）不保证一致，
/// 若下载时重新跟随一次重定向，格式白名单缓存键就对不上了。
fn note_urls() -> &'static Mutex<HashMap<String, String>> {
    static MEMO: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    MEMO.get_or_init(Default::default)
}

fn cached_note_url(short: &str) -> Option<String> {
    note_urls().lock().ok()?.get(short).cloned()
}

fn remember_note_url(short: &str, note: &str) {
    if let Ok(mut memo) = note_urls().lock() {
        memo.insert(short.to_string(), note.to_string());
    }
}

/// 探测入口：短链每次重新跟随，拿到新鲜 token 后覆盖会话映射。
///
/// xsec_token 会过期：若"重新解析"也只读映射，用户点多少次重解析都拿到同一条
/// 旧链，进程不重启就再也下不动（后端的 extract 每次都会重新跟随）。
pub async fn resolve_for_probe(url: &str, proxy: Option<&str>) -> Result<String, AppError> {
    if !is_short_link(url) {
        return Ok(url.to_string());
    }
    let note = follow_short_link(url, proxy).await?;
    remember_note_url(url, &note);
    Ok(note)
}

/// 下载入口：复用探测时刚登记的映射，绝不自己再解一次。
/// 两次入口必须拿到同一条地址，否则格式白名单的缓存键就劈叉了。
pub async fn resolve_for_playback(url: &str, proxy: Option<&str>) -> Result<String, AppError> {
    if !is_short_link(url) {
        return Ok(url.to_string());
    }
    if let Some(note) = cached_note_url(url) {
        return Ok(note);
    }
    let note = follow_short_link(url, proxy).await?;
    remember_note_url(url, &note);
    Ok(note)
}

/// 跟随 xhslink 重定向，返回可供 yt-dlp 提取的小红书笔记链接。
///
/// 带 UA + 站内 Referer 时，国内出口通常一跳就 302 到带 xsec_token 的笔记地址；
/// 缺头或海外/机房出口会被塞进 /login 墙，墙上 redirectPath 里才是同一个地址。
/// 两种形状都可能出现（本机实测两种都见过），所以每一跳落地都先试解，解得出
/// 立即返回——不必再请求那一页，也不用管后端那种"走完整条再倒序挑"的绕法。
///
/// 与后端有意不同的两处（都是桌面环境才需要的约束）：
/// - 手动逐跳：reqwest 0.13 已不暴露 Response::history()，且只有拿到中间跳
///   才能做下一条的域名信任校验；
/// - 跳转仅限小红书域名族（见 `is_trusted_hop`），防被用作本机端口探测。
async fn follow_short_link(url: &str, proxy: Option<&str>) -> Result<String, AppError> {
    let mut builder = reqwest::Client::builder()
        .timeout(RESOLVE_TIMEOUT)
        // reqwest 0.13 不再暴露 Response::history()，自己控制跳转才能拿到整条链
        .redirect(reqwest::redirect::Policy::none());
    if let Some(proxy) = proxy {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy).map_err(|e| AppError::InvalidProxy(e.to_string()))?,
        );
    }
    let client = builder.build().map_err(|e| {
        // 英文细节只进 stderr：混进面向用户的文案会被 errorHint 的 /error/ 判定
        // 击穿直通规则，用户反而看到泛化兜底文案
        eprintln!("小红书短链 HTTP 客户端初始化失败: {e}");
        AppError::ShortLink("小红书短链接请求失败，请稍后重试".into())
    })?;

    let mut current = parse(url).ok_or(AppError::InvalidUrl)?;
    for _ in 0..MAX_REDIRECTS {
        // 每一跳落地后先试解：能解出去就不必再请求它（省掉整页 HTML）
        if let Some(note) = expand_redirect(current.as_str()) {
            return Ok(note);
        }
        let response = client
            .get(current.clone())
            .header(reqwest::header::USER_AGENT, USER_AGENT)
            .header(reqwest::header::REFERER, HOME_URL)
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header(reqwest::header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9")
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|_| AppError::ShortLink("小红书短链接请求失败，请稍后重试".into()))?;
        if !response.status().is_redirection() {
            break;
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        match next_hop(&current, location.as_deref())? {
            Some(next) => current = next,
            None => break,
        }
    }

    Err(AppError::ShortLink(
        "无法从小红书短链接中提取笔记地址，请在 App 内复制完整链接后重试".into(),
    ))
}

/// 下一跳判定：相对 Location 归一 + 只允许停留在小红书域名族内。
/// 单独成函数是为了能离线测（不依赖真实 DNS）。
fn next_hop(current: &Url, location: Option<&str>) -> Result<Option<Url>, AppError> {
    let Some(location) = location.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let next = current.join(location).map_err(|_| {
        AppError::ShortLink("小红书短链接的跳转地址无效，请在 App 内复制完整链接后重试".into())
    })?;
    if !is_trusted_hop(&next) {
        return Err(AppError::ShortLink(
            "小红书短链接跳转到了站外地址，已中止解析".into(),
        ));
    }
    Ok(Some(next))
}

/// 跳转只允许停留在小红书自己的域名族内。
///
/// 桌面客户端跑在用户本机：短链服务异常、被劫持或 DNS 污染时，盲跟随等于
/// 替第三方在本机发请求（本应用的 MCP 服务就监听 127.0.0.1:8790，云主机上
/// 还有 169.254.169.254 这类元数据端点）。后端同样逐跳跟随，但它的出口是自己
/// 的服务器，不受这个约束，故这里是有意比后端更严的一条。
fn is_trusted_hop(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    url.host_str()
        .map(|host| host.to_ascii_lowercase())
        .is_some_and(|host| {
            hostname_matches(&host, &SHORT_HOSTS) || hostname_matches(&host, &NOTE_HOSTS)
        })
}

#[cfg(test)]
mod tests {
    use super::{
        cached_note_url, expand_redirect, follow_short_link, is_short_link, next_hop,
        remember_note_url, resolve_for_playback, resolve_for_probe, USER_AGENT,
    };
    use url::Url;

    #[test]
    fn resolves_relative_locations_against_the_current_hop() {
        let current = Url::parse("https://xhslink.cn/o/abc").unwrap();
        let next = next_hop(&current, Some("//www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed"))
            .unwrap()
            .unwrap();
        assert_eq!(next.host_str(), Some("www.xiaohongshu.com"));
        assert_eq!(next.path(), "/discovery/item/6af9738d00000000090214ed");
        assert_eq!(next_hop(&current, None).unwrap(), None);
        assert_eq!(next_hop(&current, Some("   ")).unwrap(), None);
    }

    #[tokio::test]
    async fn follows_a_live_302_to_the_note_url() {
        let port = serve("302 Found", Some(&format!("{NOTE_URL}?xsec_token=abc%3D"))).await;
        let note = follow_short_link(&format!("http://127.0.0.1:{port}/o/abc"), None)
            .await
            .unwrap();
        assert_eq!(note, format!("{NOTE_URL}?xsec_token=abc%3D"));
    }

    #[tokio::test]
    async fn decodes_a_login_wall_served_over_the_redirect() {
        // 海外/机房出口的形态：短链 302 到 /login，笔记地址藏在 redirectPath 里
        let wall_target = format!("{NOTE_URL}?xsec_token=CBc5AZxTKF4I0memE0hlKdQF2RWB6eNLMLGQP-o4ET1RY");
        let port = serve("302 Found", Some(&wall(&wall_target))).await;
        let note = follow_short_link(&format!("http://127.0.0.1:{port}/o/abc"), None)
            .await
            .unwrap();
        assert_eq!(note, wall_target, "链条里的登录墙必须能还原成笔记直链");
    }

    #[tokio::test]
    async fn fails_clearly_when_the_chain_never_reaches_a_note() {
        let port = serve("302 Found", None).await;
        let error = follow_short_link(&format!("http://127.0.0.1:{port}/o/dead"), None)
            .await
            .expect_err("没有 Location 的 302 应当失败");
        assert!(error.to_string().contains("无法从小红书短链接中提取笔记地址"), "{error}");
    }

    #[tokio::test]
    async fn reports_a_http_failure_as_a_retry_hint() {
        let port = serve("404 Not Found", None).await;
        let error = follow_short_link(&format!("http://127.0.0.1:{port}/o/expired"), None)
            .await
            .expect_err("4xx 应当报错而不是继续走链");
        assert!(error.to_string().contains("小红书短链接请求失败，请稍后重试"), "{error}");
    }

    /// 单机一次性的假 HTTP 服务：回一行状态 + 可选 Location，够一次请求
    async fn serve(status_line: &str, location: Option<&str>) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let status_line = status_line.to_string();
        let location = location.map(|v| format!("Location: {v}\r\n"));
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0_u8; 2048];
            let _ = socket.read(&mut buf).await;
            let response = format!(
                "HTTP/1.1 {status_line}\r\n{}Content-Length: 0\r\nConnection: close\r\n\r\n",
                location.unwrap_or_default()
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.flush().await;
        });
        port
    }

    #[tokio::test]
    async fn refuses_to_follow_hops_off_the_xiaohongshu_domains() {
        // 短链服务异常/被劫持时，桌面客户端盲跟随等于替攻击者在用户本机发请求
        // （本应用自己的 MCP 服务就监听 127.0.0.1:8790）
        let current = Url::parse("https://xhslink.cn/o/abc").unwrap();
        for hostile in [
            "http://127.0.0.1:8790/mcp",
            "http://169.254.169.254/latest/meta-data/",
            "https://evil.cn/x",
        ] {
            let error = next_hop(&current, Some(hostile)).expect_err("站外跳转必须被拒绝");
            assert!(error.to_string().contains("站外"), "{error}");
        }
    }

    #[test]
    fn sends_the_exact_user_agent_the_backend_sends() {
        // 逐字对齐后端 DEFAULT_USER_AGENT：UA 一变形，小红书就可能改下发登录墙
        assert_eq!(
            USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
        );
    }

    #[test]
    fn detects_xhslink_short_hosts_only() {
        assert!(is_short_link("https://xhslink.com/o/8bQrEKxb2wT"));
        assert!(is_short_link("http://xhslink.cn/o/8bQrEKxb2wT"));
        assert!(is_short_link("https://www.xhslink.com/o/x"));
        assert!(!is_short_link("https://notxhslink.com/o/x"));
        assert!(!is_short_link("https://xhslink.com.evil.cn/o/x"));
        assert!(!is_short_link("https://www.xiaohongshu.com/explore/6af9738d00000000090214ed"));
        assert!(!is_short_link("小红书分享内容"));
    }

    #[test]
    fn expands_bare_domain_and_http_variants() {
        assert_eq!(
            expand_redirect("http://rednote.com/discovery/item/6af9738d00000000090214ed?xsec_token=abc")
                .as_deref(),
            Some("https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed?xsec_token=abc")
        );
    }

    #[test]
    fn drops_fragment_but_keeps_every_query_pair() {
        // 分享文案常见形态：token 无值 + 末尾 # 锚点；锚点不属于笔记地址，
        // 但 query 里的键值对一律原样透传（与后端 urlunparse 行为一致）
        assert_eq!(
            expand_redirect(
                "https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed?xsec_token=&share_id=1#push"
            )
            .as_deref(),
            Some("https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed?xsec_token=&share_id=1")
        );
    }

    /// 后端回归样本：海外出口 IP 的登录墙（percent-encoded 一次的 redirectPath）
    const OVERSEAS_LOGIN_WALL: &str = "https://www.rednote.com/login?redirectPath=http%3A%2F%2Fwww.rednote.com%2Fdiscovery%2Fitem%2F6af9738d00000000090214ed%3Fapp_platform%3Dandroid%26xsec_source%3Dapp_share%26type%3Dvideo%26xsec_token%3DCBc5AZxTKF4I0memE0hlKdQF2RWB6eNLMLGQP-o4ET1RY%3D";

    /// 本机实采样本：国内出口 IP 访问 xhslink.cn 后落地的登录墙
    const DOMESTIC_LOGIN_WALL: &str = "https://www.xiaohongshu.com/login?redirectPath=http%3A%2F%2Fwww.xiaohongshu.com%2Fdiscovery%2Fitem%2F6af9738d00000000090214ed%3Fapp_platform%3Dandroid%26ignoreEngage%3Dtrue%26xsec_source%3Dapp_share%26type%3Dvideo%26xsec_token%3DCBc5AZxTKF4I0memE0hlKdQF2RWB6eNLMLGQP-o4ET1RY%3D%26author_share%3D1";

    const NOTE_URL: &str = "https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed";
    const NOTE_URL_404: &str = "https://www.xiaohongshu.com/404";

    /// 小红书登录墙：redirectPath 里才是真实落地地址
    fn wall(next: &str) -> String {
        format!(
            "https://www.xiaohongshu.com/login?redirectPath={}",
            urlencoding(next)
        )
    }

    #[test]
    fn expands_domestic_login_wall_to_note_url() {
        assert_eq!(
            expand_redirect(DOMESTIC_LOGIN_WALL).as_deref(),
            Some(
                "https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed\
                 ?app_platform=android&ignoreEngage=true&xsec_source=app_share\
                 &type=video&xsec_token=CBc5AZxTKF4I0memE0hlKdQF2RWB6eNLMLGQP-o4ET1RY=&author_share=1"
            )
        );
    }

    #[test]
    fn rewrites_overseas_rednote_wall_to_canonical_host() {
        assert_eq!(
            expand_redirect(OVERSEAS_LOGIN_WALL).as_deref(),
            Some(
                "https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed\
                 ?app_platform=android&xsec_source=app_share&type=video\
                 &xsec_token=CBc5AZxTKF4I0memE0hlKdQF2RWB6eNLMLGQP-o4ET1RY="
            )
        );
    }

    #[test]
    fn keeps_double_encoded_token_from_being_decoded_twice() {
        // 后端同款样本：token 里的 %3D 只应被解掉一层
        assert_eq!(
            expand_redirect(
                "https://www.xiaohongshu.com/login?redirectPath=http%3A%2F%2Fwww.xiaohongshu.com%2F\
                 discovery%2Fitem%2F6af9738d00000000090214ed%3Fxsec_token%3DCBc5%253D%26xsec_source%3Dapp_share"
            )
            .as_deref(),
            Some("https://www.xiaohongshu.com/discovery/item/6af9738d00000000090214ed?xsec_token=CBc5%3D&xsec_source=app_share")
        );
    }

    #[test]
    fn canonicalizes_direct_note_link_to_https_www() {
        assert_eq!(
            expand_redirect("http://www.xiaohongshu.com/explore/6af9738d00000000090214ed?xsec_token=abc")
                .as_deref(),
            Some("https://www.xiaohongshu.com/explore/6af9738d00000000090214ed?xsec_token=abc")
        );
    }

    #[test]
    fn rejects_non_note_pages_and_foreign_hosts() {
        assert_eq!(expand_redirect("https://www.xiaohongshu.com/"), None);
        assert_eq!(expand_redirect("https://xhslink.cn/o/8bQrEKxb2wT"), None);
        // 登录墙指向站外：不能顺着 redirectPath 把任意地址当笔记链接放过去
        assert_eq!(
            expand_redirect("https://example.com/login?redirectPath=https%3A%2F%2Fevil.com%2Fx"),
            None
        );
    }

    #[test]
    fn follows_chained_login_walls() {
        assert_eq!(
            expand_redirect(&wall(&wall(NOTE_URL))).as_deref(),
            Some(NOTE_URL)
        );
    }

    #[test]
    fn stops_following_login_walls_after_three_hops() {
        // 上限与后端一致（3 跳内解不出就放弃）：宁可对畸形链条报失败，
        // 也不被自指 redirectPath 无限展开
        assert_eq!(expand_redirect(&wall(&wall(&wall(NOTE_URL)))), None);
        assert_eq!(expand_redirect(&wall(&wall(NOTE_URL_404))), None);
    }

    #[tokio::test]
    async fn leaves_non_short_links_untouched() {
        // 站内直链不该触发任何短链预处理（也不该发网络请求）
        let direct = "https://www.xiaohongshu.com/explore/6af9738d00000000090214ed?xsec_token=abc";
        assert_eq!(resolve_for_playback(direct, None).await.unwrap(), direct);
        let other = "https://www.bilibili.com/video/BV1xx";
        assert_eq!(resolve_for_playback(other, None).await.unwrap(), other);
    }

    #[tokio::test]
    async fn reuses_the_first_expansion_for_the_same_short_link() {
        // 探测与下载各自入口都会调一次：第二次必须命中会话内映射，
        // 否则两次还原结果有差异会让格式白名单缓存未命中
        let short = "https://xhslink.cn/o/memo-only";
        remember_note_url(short, NOTE_URL);
        assert_eq!(resolve_for_playback(short, None).await.unwrap(), NOTE_URL);
    }

    /// 重新解析必须重新跟随短链拿新鲜 token（xsec_token 会过期，缓存命中即卡死），
    /// 而下载入口复用探测刚登记的那条。需联网：`cargo test --lib -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn re_parsing_self_heals_a_stale_token() {
        let short = "https://xhslink.cn/o/8bQrEKxb2wT";
        let stale = "https://www.xiaohongshu.com/discovery/item/000000000000000000000000?xsec_token=expired";
        remember_note_url(short, stale);

        let fresh = resolve_for_probe(short, None).await.unwrap();
        assert_ne!(fresh, stale, "重新解析不能复用会话里的旧映射");
        assert_eq!(cached_note_url(short).as_deref(), Some(fresh.as_str()), "新映射要覆盖回去");
        assert_eq!(resolve_for_playback(short, None).await.unwrap(), fresh, "下载复用同一条，白名单键才劈不了");
    }

    /// 真实线上短链（与后端回归样本同源）；短链会失效，替换成新的即可。
    /// 手动跑：`cargo test --lib -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn resolves_a_real_xhslink_short_link() {
        let expanded = resolve_for_playback("https://xhslink.cn/o/8bQrEKxb2wT", None)
            .await
            .unwrap();
        assert!(expanded.starts_with(NOTE_URL), "{expanded}");
        assert!(expanded.contains("xsec_token="), "{expanded}");
    }

    /// 端到端：短链 → 笔记直链 → 本机 yt-dlp 真能出标题与清晰度。
    /// 需要联网与 yt-dlp（开发态走 PATH），手动跑 `cargo test --lib -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn probes_a_real_short_link_end_to_end() {
        let target = resolve_for_playback("https://xhslink.cn/o/8bQrEKxb2wT", None)
            .await
            .unwrap();
        let probed = crate::probe::probe(&target, None)
            .await
            .expect("还原后的笔记直链应能被 yt-dlp 解析");
        assert!(!probed.info.title.is_empty());
        assert!(!probed.info.formats.is_empty());
    }

    fn urlencoding(raw: &str) -> String {
        raw.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    }
}
