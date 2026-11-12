# Agent 接入（内置 MCP 服务）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让运行中的 LumeAny App 内嵌一个 MCP（Streamable HTTP）服务，AI agent 可探测链接、下发/查询/取消下载任务；侧栏新增「Agent 接入」页管理服务并展示接入命令。

**Architecture:** Rust 新模块 `mcp_tools.rs`（四个 tool handler，直接调 `probe.rs`/`queue.rs` 同一 `AppState`）+ `mcp_server.rs`（rmcp StreamableHttpService 经 axum 挂到 `127.0.0.1:8790/mcp`，生命周期由 IPC 命令控制）；前端新增 `AgentView.tsx` 面板，并在 App.tsx 事件层为"非本前端发起的 job"补 UI 元数据与埋点兜底。下载逻辑零改动。

**Tech Stack:** Tauri v2、tokio、rmcp 3.9.0（features: server + macros + schemars + transport-streamable-http-server）、axum、React + 原生 CSS 令牌、@tauri-apps/plugin-store。

**Spec:** `docs/superpowers/specs/2026-11-12-mcp-agent-access-design.md`

## Global Constraints

- 只绑 `127.0.0.1`，端口固定 `8790`，路径 `/mcp`；无鉴权
- 服务默认关闭，且每次启动回到关闭（不持久化开关）
- `panic = "abort"`：启动/绑定失败一律以返回值呈现，勿依赖捕获 panic
- 传给 yt-dlp 的参数只过 `args.rs` 白名单；MCP 面在其上再加一层窄白名单（见 Task 3）
- Rust serde 结构全部 `#[serde(rename_all = "camelCase")]`，前端 `types.ts` 必须镜像
- 所有新文案进 `src/lib/i18n.ts` 中英两份；CSS 用 `App.css` `:root` 现有令牌（`--indigo-*`、`--mist`、`--muted` 等）
- 提交信息中文、`feat:`/`test:`/`docs:` 前缀，尾部 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 验证命令：`cd src-tauri && cargo test` / `pnpm exec tsc --noEmit`

## Review Focus

计划任务的测试覆盖不到的输入类，评审时逐条对照：

- 未 probe 过的 URL 直接 `start_download` → 应自动先探测再入队成功（而非报"请先解析"）
- 带查询参数的 URL probe、不带参数 download → 两个 trim 后的字符串是两个不同的键，不会互相命中；此时 start_download 的自动探测兜底应让它仍然成功（而不是报"请先解析"）
- 字幕/封面/`__audio_m4a__`/`__video_99999p__` 等 `args.rs` 宽校验放行、但 MCP 窄白名单不放行的 format_id → 必须被 MCP 层拒绝
- 端口 8790 被占用时开启服务 → 面板显示错误原文，App 不崩、可再次尝试
- 快速开→关→开服务 → 不残留旧 listener、`list_jobs` 等 IPC 不报错

---

### Task 1: 依赖引入 + 代理/目录偏好的 Rust 侧镜像（纯函数）

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/mcp_prefs.rs`
- Modify: `src-tauri/src/lib.rs:1-10`（`mod mcp_prefs;`）

**Interfaces:**
- Consumes: 无（独立起点）
- Produces:
  - `mcp_prefs::build_proxy_url(proxy_type: &str, addr: &str) -> Option<String>`（镜像 `src/lib/settings.ts` 的 `buildProxyUrl`：`none`/空 → `None`；addr 已带 `http(s)://`/`socks4(a)://`/`socks5(h)://` 前缀则原样 trim 返回，否则 `format!("{type}://{trim}")`）
  - `mcp_prefs::store_proxy(app: &tauri::AppHandle) -> Option<String>`（plugin-store `settings.json` 读 `proxyType`/`proxyAddr` 后调 `build_proxy_url`；store 文件为准）
  - `mcp_prefs::store_output_dir(app: &tauri::AppHandle) -> String`（store `outputDir`；缺省用 `tauri::Manager::path()` 的 `download_directory()`；两者都拿不到返回空串，由调用方报错；不引入新 crate）
  - `rmcp = { version = "3.9.0", features = ["server", "macros", "schemars", "transport-streamable-http-server"] }`、`axum = "0.8"` 加入 Cargo.toml

- [ ] **Step 1: 写失败测试** `mcp_prefs.rs` 内 `#[cfg(test)] mod tests`：

```rust
#[test]
fn build_proxy_url_mirrors_frontend() {
    assert_eq!(build_proxy_url("none", "127.0.0.1:7890"), None);
    assert_eq!(build_proxy_url("http", "  "), None);
    assert_eq!(build_proxy_url("http", "127.0.0.1:7890").as_deref(), Some("http://127.0.0.1:7890"));
    assert_eq!(build_proxy_url("socks5", "127.0.0.1:7891").as_deref(), Some("socks5://127.0.0.1:7891"));
    assert_eq!(build_proxy_url("http", "http://127.0.0.1:7890").as_deref(), Some("http://127.0.0.1:7890"));
    assert_eq!(build_proxy_url("http", "socks5://user:pass@host:1080").as_deref(), Some("socks5://user:pass@host:1080"));
}
```

scheme 判断不加正则依赖：小写后 `starts_with` 七个前缀之一即可（与 TS 正则等价语义）。

- [ ] **Step 2:** `cd src-tauri && cargo test mcp_prefs -- --nocapture` → 编译失败（模块不存在）即"红"
- [ ] **Step 3:** 实现三个函数 + Cargo.toml 依赖 + lib.rs 注册；`store_*` 用 `tauri_plugin_store::StoreExt`（`app.store("settings.json")`，`get` 返回 `Option<serde_json::Value>`，取 `.as_str()`）
- [ ] **Step 4:** `cargo test mcp_prefs` → PASS；`cargo build` 通过（确认 rmcp/axum 与 tokio 无 feature 冲突；若 rmcp 3.9.0 的 API 与 README 有出入，以编译器 + docs.rs/rmcp/3.9.0 为准，不动本计划其余约定）
- [ ] **Step 5:** commit `feat: MCP 服务依赖与偏好读取的 Rust 侧镜像（build_proxy_url 对齐前端）`

### Task 2: probe 缓存扩元数据（`ProbedInfo`）

**Files:**
- Modify: `src-tauri/src/queue.rs:161-201`（Inner.probed、cache_probe_ids、validate_format）、`src-tauri/src/queue.rs:564-573`（probe_and_cache）
- Modify: `src-tauri/src/probe.rs`（如需 Clone derive——`FormatOption`/`VideoInfo` 已是 `Clone`，确认即可）

**Interfaces:**
- Consumes: `probe::FormatOption`、`probe::VideoInfo`
- Produces:
  - `pub struct ProbedInfo { pub valid_ids: HashSet<String>, pub title: String, pub formats: Vec<probe::FormatOption> }`（`queue.rs`，`Clone`）
  - `AppState::cache_probe(&self, url: &str, info: ProbedInfo)`（替换 `cache_probe_ids`）
  - `AppState::probe_meta(&self, url: &str) -> Option<ProbedInfo>`
  - `validate_format` 行为不变（内部改为从 `ProbedInfo.valid_ids` 查）；`probe_and_cache` 签名不变，内部缓存 `title` + `formats`

- [ ] **Step 1: 写失败测试**（`queue.rs` tests 模块）：

```rust
#[test]
fn probe_meta_roundtrip_and_validate() {
    let state = AppState::new();
    let info = ProbedInfo {
        valid_ids: HashSet::new(),
        title: "标题".into(),
        formats: vec![probe::FormatOption { id: crate::args::FMT_BEST.into(), label: "最佳画质".into(), height: None, ext: None, filesize: None }],
    };
    state.cache_probe("https://example.com/v", info);
    let meta = state.probe_meta("https://example.com/v").expect("cached");
    assert_eq!(meta.title, "标题");
    assert_eq!(meta.formats[0].label, "最佳画质");
    assert!(state.probe_meta("https://other").is_none());
    assert!(state.validate_format("https://example.com/v", crate::args::FMT_BEST).is_ok());
    assert!(state.validate_format("https://example.com/v", "whatever").is_err());
    assert!(state.validate_format("https://not.probed/x", crate::args::FMT_BEST).is_err());
}
```

- [ ] **Step 2:** `cargo test queue::tests::probe_meta` → FAIL（编译错/未定义）
- [ ] **Step 3:** 实现结构替换（`probed: Mutex<HashMap<String, ProbedInfo>>`）；`probe_and_cache` 里 `cache_probe(url, ProbedInfo { valid_ids: result.valid_ids, title: result.info.title.clone(), formats: result.info.formats.clone() })`
- [ ] **Step 4:** 全量 `cargo test` → PASS（既有 args/progress 测试不回归）
- [ ] **Step 5:** commit `feat: probe 缓存扩充标题与清晰度标签，支撑 MCP 任务展示对等`

### Task 3: `mcp_tools.rs` — 四个 MCP tool（含窄白名单，纯函数先行）

**Files:**
- Create: `src-tauri/src/mcp_tools.rs`
- Modify: `src-tauri/src/lib.rs`（`mod mcp_tools;`）

**Interfaces:**
- Consumes: Task 1 `mcp_prefs::{store_proxy, store_output_dir}`、Task 2 `AppState::{probe_meta, cache_probe, list}`、`queue::{probe_and_cache, enqueue, cancel, DownloadOptions}`、`args::{validate_url, validate_proxy}`、`rmcp::{tool, tool_router, tool_handler, ServerHandler, handler::server::wrapper::Parameters, Json, ErrorData}`
- Produces:
  - `pub fn agent_formats<'a>(formats: &'a [probe::FormatOption]) -> Vec<&'a probe::FormatOption>` — **白名单保留制**：仅保留 `id` 等于 `args::FMT_BEST`、等于 `args::FMT_AUDIO_MP3`、或形如 `__video_<h>p__`（`__video_` 前缀 + `p__` 后缀、中间全数字）的项；封面/字幕/其他一切形态不进 agent 面
  - `pub fn format_allowed(meta: &queue::ProbedInfo, raw: &str) -> bool` — `raw` ∈ agent_formats(meta.formats) 的 id 集合，或等于 `args::FMT_BEST`/`args::FMT_AUDIO_MP3`
  - `#[derive(Clone)] pub struct AgentTools { app: tauri::AppHandle, state: queue::AppState, proxy_memory: Arc<Mutex<HashMap<String, String>>> }`，`AgentTools::new(app, state)`
  - tool 名（agent 可见）：`probe_video(url, proxy?)`、`start_download(url, formatId?, proxy?)`、`list_jobs()`、`cancel_download(jobId)`；返回 `Result<Json<serde_json::Value>, ErrorData>`，失败统一 `ErrorData::internal_error(e.to_string(), None)`
  - 返回体：probe → `{title, duration, uploader, formats:[{id,label,height,ext,filesize}]}`（过滤后）；start → `{jobId}`；jobs → `{jobs:[JobRecord…]}`（沿用 queue serde）；cancel → `{ok:true}`

- [ ] **Step 1: 写失败测试**（纯函数部分）：

```rust
#[test]
fn agent_face_hides_sidecar_forms() {
    let fmts = vec![
        f(crate::args::FMT_BEST, "最佳"), f("__video_1080p__", "1080p"),
        f(crate::args::FMT_AUDIO_MP3, "MP3"), f("__thumbnail", "封面"),
        f("__subtitle_en", "字幕"), f("__audio_m4a__", "m4a"),
    ];
    let visible: Vec<_> = agent_formats(&fmts).into_iter().map(|x| x.id.clone()).collect();
    assert_eq!(visible, vec![crate::args::FMT_BEST, "__video_1080p__", crate::args::FMT_AUDIO_MP3]);
    let meta = queue::ProbedInfo { valid_ids: HashSet::new(), title: "t".into(), formats: fmts.clone() };
    assert!(format_allowed(&meta, "__video_1080p__"));
    assert!(format_allowed(&meta, crate::args::FMT_BEST));
    assert!(!format_allowed(&meta, "__audio_m4a__")); // args.rs 放行但 MCP 拒绝
    assert!(!format_allowed(&meta, "__thumbnail"));
    assert!(!format_allowed(&meta, "137"));            // 未 probe 出的真实 id 拒绝
    assert!(!format_allowed(&meta, "__video_99999p__")); // 宽校验的裸高度哨兵拒绝
}
```

（`f` 为本测试模块内构造 `FormatOption` 的小 helper。上述期望与 Produces 的白名单保留制一致：`__audio_m4a__`/`__thumbnail`/`__subtitle_en` 都在白名单外被剔除。）

- [ ] **Step 2:** `cargo test mcp_tools` → FAIL
- [ ] **Step 3:** 实现纯函数 + `AgentTools`。tool 语义（handler 体各 ≤20 行，逻辑走现成函数）：
  - `probe_video`：`url.trim()` → `validate_url` → proxy 参数 `validate_proxy`（None 则 `store_proxy(&app)`）→ `probe_and_cache` → 成功后 `proxy_memory[url] = proxy`（Some 时）→ 返回过滤后 formats
  - `start_download`：trim/validate url；`format_id = params.formatId.unwrap_or(args::FMT_BEST)`；proxy 优先级：显式参数（过 `validate_proxy`）→ `proxy_memory`（该 url）→ `store_proxy`；`state.probe_meta(&url)` 为 None 时先 `probe_and_cache`（自动探测，验收#3）；再 `format_allowed` 检查（不过则 ErrorData"该格式不在本次解析结果中（MCP 仅支持 probe_video 返回的选项与 最佳/MP3 哨兵）"）；`label` 取 meta.formats 中同 id 项的 label；`output_dir = store_output_dir`（空 → ErrorData）；`queue::enqueue(&app, &state, DownloadOptions { url, format_id, output_dir, title: Some(meta.title), format_label: Some(label), proxy })` → `{jobId}`
  - `list_jobs`：`Ok(Json(json!({ "jobs": state.list() })))`
  - `cancel_download`：`queue::cancel(&state, jobId)` → `{ok:true}`
  - `#[tool_router] impl AgentTools {…}`（每个方法 `#[tool(description = "…")]`，description 用中文一句话说清用途与返回字段）；`#[tool_handler(name = "lumeany", version = env!("CARGO_PKG_VERSION"), instructions = "LumeAny 桌面下载器：先 probe_video 获取清晰度选项，再 start_download 下发任务，list_jobs 轮询进度与 outputPath，cancel_download 取消。")] impl ServerHandler for AgentTools {}`
- [ ] **Step 4:** `cargo test` → PASS；`cargo build` 通过
- [ ] **Step 5:** commit `feat: MCP 工具面——probe/下载/查询/取消，窄白名单挡住字幕封面与旁路哨兵`

### Task 4: `mcp_server.rs` — Streamable HTTP 挂载与 IPC 生命周期

**Files:**
- Create: `src-tauri/src/mcp_server.rs`
- Modify: `src-tauri/src/lib.rs`（`mod mcp_server;` + invoke_handler 加两个命令）

**Interfaces:**
- Consumes: Task 3 `mcp_tools::AgentTools`；`rmcp::transport::streamable_http_server::{StreamableHttpService, StreamableHttpServerConfig}`（tower 子模块，若 3.9.0 路径不同以编译器为准）与 `LocalSessionManager`；`axum::{serve, Router, extract::connect_info::IntoMakeServiceWithConnectInfo}` 或等价挂载方式（README 样例：`Router::new().nest_service("/mcp", service)`）
- Produces:
  - `pub const MCP_PORT: u16 = 8790`
  - `#[derive(Serialize, Clone)] #[serde(rename_all = "camelCase")] pub struct McpStatus { pub running: bool, pub port: u16, pub error: Option<String> }`
  - `#[tauri::command] pub async fn set_mcp_enabled(app: tauri::AppHandle, state: tauri::State<'_, queue::AppState>, on: bool) -> Result<McpStatus, AppError>` — on=false 幂等停止；on=true 已在运行则直接返回 running 状态；bind 失败返回 `Ok(McpStatus { running: false, port: MCP_PORT, error: Some(e.to_string()) })`（不 Err，验收#5）
  - `#[tauri::command] pub async fn mcp_status() -> McpStatus`
  - 运行态存放：`static RUNTIME: tokio::sync::Mutex<Option<Runtime>>`，`struct Runtime { join: tokio::task::JoinHandle<()>, shutdown: tokio::sync::oneshot::Sender<()> }`；start：`TcpListener::bind(("127.0.0.1", MCP_PORT))` → `StreamableHttpService::new(move || Ok(AgentTools::new(app.clone(), state.clone())), LocalSessionManager::default().into(), StreamableHttpServerConfig::default().with_json_response(true))` → `axum::serve(listener, router).with_graceful_shutdown(rx)` 进 `tokio::spawn`；stop：send shutdown → `tokio::time::timeout(3s, join)`（超时则 `join.abort()`）

- [ ] **Step 1:** lib.rs `invoke_handler` 注册 `mcp_server::set_mcp_enabled, mcp_server::mcp_status`
- [ ] **Step 2:** 实现 `mcp_server.rs`（生命周期本身无单测——bind 冲突路径用 Step 4 的手动冒烟覆盖；`cargo test` 确认无回归即可）
- [ ] **Step 3:** `cargo test && cargo build` → PASS
- [ ] **Step 4: 冒烟**（`pnpm tauri dev`，不依赖 Task 5 的 UI：App 起来后 `lsof -i :8790` 确认默认未监听（"每次启动默认关闭"的静态面）；bind/stop 的运行时行为（含端口占用返回 error 而非 Err）留待 Task 5 Step 6 用面板实测，此处 `mcp_status()` 默认值可由 DevTools `window.__TAURI__.core.invoke("mcp_status")` 一条命令验证，期望 `{running:false, port:8790, error:null}`）
- [ ] **Step 5:** commit `feat: MCP Streamable HTTP 服务挂载 127.0.0.1:8790/mcp 与 set_mcp_enabled/mcp_status IPC`

### Task 5: 前端「Agent 接入」页 + 接入命令复制

**Files:**
- Create: `src/components/AgentView.tsx`
- Modify: `src/App.tsx:59,430-452,467-525`（View 类型、nav 第三项、main 三分支）
- Modify: `src/lib/tauri.ts`（wrapper）、`src/types.ts`（McpStatus）、`src/lib/i18n.ts`（键）、`src/App.css`（样式块）、`src/components/Icon.tsx`（新 `agent` 图标，stroke 风格同现有，viewBox 48）

**Interfaces:**
- Consumes: Task 4 IPC `set_mcp_enabled`/`mcp_status`
- Produces:
  - `types.ts`：`export interface McpStatus { running: boolean; port: number; error?: string | null }`
  - `tauri.ts`：`export const mcpSetEnabled = (on: boolean) => invoke<McpStatus>("set_mcp_enabled", { on });`、`export const mcpStatus = () => invoke<McpStatus>("mcp_status");`
  - `App.tsx`：`type View = "download" | "history" | "agent";`；nav 加 `<Icon name="agent" size={15} />{t("nav.agent")}`（无 count 徽标）；main 中 `view === "agent"` 分支渲染 `<AgentView />`（history 头部条件相应收紧为 `view === "history"`）
  - `i18n` 键（zh 值定稿，en 由实现者对译）：`nav.agent`= "Agent 接入"、`agent.title`= "Agent 接入"、`agent.subtitle`= "让 Claude 等 AI agent 通过 MCP 驱动正在运行的 LumeAny 完成下载"、`agent.service`= "MCP 服务"、`agent.statusOn`= "运行中：http://127.0.0.1:{port}/mcp"、`agent.statusOff`= "未启动（每次启动 App 都默认关闭）"、`agent.statusError`= "启动失败：{error}"、`agent.commandHint`= "在终端执行以下命令，让 Claude Code 连接本机 LumeAny："、`agent.copy`= "复制命令"、`agent.copied`= "已复制"、`agent.jsonHint`= "或在任意 MCP 客户端的配置里添加："、`agent.copyJson`= "复制配置"、`agent.tools`= "agent 可用的工具"、`agent.toolProbe`= "probe_video：解析链接，返回标题与人读清晰度选项"、`agent.toolStart`= "start_download：按选项下发任务（缺省最佳画质；未解析过的链接会自动先解析）"、`agent.toolList`= "list_jobs：查询任务状态、进度与完成后的文件路径"、`agent.toolCancel`= "cancel_download：取消任务"、`agent.localNote`= "服务只监听 127.0.0.1，本机进程即信任，无鉴权；任务进入应用内同一队列，界面上可实时取消。"
  - 面板常量：`const command = \`claude mcp add --transport http lumeany http://127.0.0.1:${status.port}/mcp\``；JSON 块内容 `{ "mcpServers": { "lumeany": { "type": "http", "url": "http://127.0.0.1:8790/mcp" } } }`（格式化两空格缩进展示在 `<pre>`）
  - 复制：`navigator.clipboard.writeText(...)`，失败降级 `select()` + `document.execCommand("copy")`（Tauri mac/windows 双保险）；成功后按钮文案切 `agent.copied` 2s

- [ ] **Step 1:** types/tauri.ts 加契约与 wrapper
- [ ] **Step 2:** i18n zh/en 全部键（zh 值如上，en 对译；`t` 的 `{port}`/`{error}` 参数替换沿用现有 `t(key, params)` 机制）
- [ ] **Step 3:** AgentView：`useState<McpStatus>` 初值 null，mount 时 `mcpStatus()` 拉取；开关按钮（复用 `.menu-row`/现有开关的视觉语言，App.css 新 `.agent-*` 类，用 `--indigo-*`/`--mist`/`--muted` 令牌）；错误原文 `<p className="agent-error">` 展示 `status.error`；命令/JSON 两块 `<code>` + 复制按钮；工具列表静态 `<ul>`（四条 i18n）
- [ ] **Step 4:** App.tsx 接入第三 nav 项与视图分支（沿用 `showNavRipple`）；Icon.tsx 加 `agent` 图标
- [ ] **Step 5:** `pnpm exec tsc --noEmit` → PASS
- [ ] **Step 6: 手动验证**（`pnpm tauri dev`）：开服务 → 状态行端口出现 → `lsof -i :8790` 有监听；关 → 端口释放；复制命令可用；重启 App → 面板回到"未启动"；端口占用——先 `nc -l 8790` 占住再开服务 → 面板显示启动失败错误原文、App 不崩、`nc` 退出后可再次开启成功；快速开→关→开三次 → 无残留 listener，DevTools invoke `list_jobs` 正常返回
- [ ] **Step 7:** commit `feat: 侧栏「Agent 接入」页——MCP 服务开关、接入命令复制与工具说明`

### Task 6: agent 任务的前端对等——UI 元数据水合 + 埋点兜底

**Files:**
- Modify: `src/App.tsx:70-94`（新 refs）、`src/App.tsx:159-228`（事件层）、`src/App.tsx:295-335`（enqueue 路径）、`src/lib/analytics.ts`（只读，确认 `trackAnalyticsEvent` 字段可选性）

**Interfaces:**
- Consumes: 现有 `listJobs()` wrapper、`analyticsJobs`/`trackedTerminalEvents` refs、`upsert`
- Produces:
  - 新 refs：`const trackedStarted = useRef(new Set<number>());`、`const pendingHydrate = useRef(new Set<number>());`
  - `function recordJobStart(job: Pick<JobRecord, "id" | "url" | "title" | "formatId" | "formatLabel">, mediaId?: string): void` — `trackedStarted` 去重；`analyticsJobs.current[job.id] ??= job`；fire `download_started`（mediaId 透传，可为 undefined）
  - `async function hydrateAgentJob(id: number): Promise<JobRecord | null>` — `listJobs()` 找该 id，命中则 `upsert(id, { url, title, formatId, formatLabel })` + `recordJobStart(job)` 并返回；未命中返回 null
  - `enqueue()`（App.tsx:303 后）：注册 `analyticsJobs.current[id]` 后改为调 `recordJobStart({id, url, title…}, mediaId)`（保持 UI 任务带 mediaId 的现状）
  - `onJobStatus` 处理函数改 async：终态事件里 `const job = analyticsJobs.current[s.jobId] ?? await hydrateAgentJob(s.jobId);` 后再走既有 `trackedTerminalEvents` 分支（terminal 去重逻辑不变）；非终态且 `!analyticsJobs.current[s.jobId] && !pendingHydrate.has(id)` → `pendingHydrate.add(id)` + `setTimeout(() => void hydrateAgentJob(id), 500)`（500ms 宽限：UI 自己发起的任务此时已由 `enqueue()` 注册，不会被误抢 started 事件，Review Focus#1/#3 的竞态由此关闭）

- [ ] **Step 1:** 实现上述改动（全部在 App.tsx，无新文件）
- [ ] **Step 2:** `pnpm exec tsc --noEmit` → PASS；`cargo test` 无涉不动
- [ ] **Step 3: 手动端到端验证**（本地离线源，CLAUDE.md 验证过的流程：ffmpeg 生成测试视频 + `python3 -m http.server` 喂 generic extractor）：
  1. 开 App 与本地源；开 MCP 服务
  2. curl 三连冒烟：`POST /mcp initialize`（body：`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}`，头 `Accept: application/json, text/event-stream`）→ 从响应头取 `mcp-session-id` → `notifications/initialized` → `tools/call start_download`（直连**未 probe** 的本地 url，不带 formatId）
  3. 期望：App UI 任务行显示**真实标题与清晰度标签**（非"任务 #N"回退）；DevTools Network/Console 看到 `download_started` 与 `download_completed` 各一条、无重复；`outputPath` 文件落盘
  4. UI 手动解析下载一路照旧：started 仍带 mediaId、只发一条
- [ ] **Step 4:** commit `feat: agent 下发任务的前端对等——UI 元数据水合与埋点 started/terminal 兜底`

### Task 7: 文档收尾（README 使用说明 + CLAUDE.md 模块表）

**Files:**
- Modify: `CLAUDE.md`（架构 Rust 模块清单加 `mcp_tools.rs`/`mcp_server.rs`/`mcp_prefs.rs` 一行式职责；约定区加一条：MCP 窄白名单在 mcp_tools，`args.rs` 宽校验仍是下载唯一边界）
- Create: `docs/AGENT_MCP.md`（Claude Code 接入步骤：开服务 → 复制命令 → 对话示例 → 故障排查：端口占用/服务未开/格式不在解析结果）

- [ ] **Step 1:** 两处文档写入（CLAUDE.md 遵循现有条目文风，一行职责）
- [ ] **Step 2:** commit `docs: Agent 接入（MCP）使用说明与模块职责登记`

---

## 完成门槛（对齐 spec §8 验收）

全部任务合入后：`cargo test`、`pnpm exec tsc --noEmit` 通过；Task 5/6 的手动清单逐项实测（含"重启后默认关闭"、"未 probe 直接下载成功"、"UI 行标题非裸 URL"、"started/terminal 各恰好一条"）。Claude Code 真机联调（`claude mcp add` + 自然语言下载）作为发布前冒烟，不在计划内自动化。
