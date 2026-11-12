# 设计文档：Agent 接入（内置 MCP 服务）

日期：2026-11-12
状态：已与需求方确认，待评审
范围：v1 仅 MCP 服务 + 新侧栏页；Skill 服务明确不做（未来另立项）

## 1. 意图与动机

让 AI agent（首个目标客户端：Claude Code）能够驱动**正在运行的 DownloadAny/LumeAny 桌面 App** 完成视频下载：agent 通过标准 MCP 协议连上 App 内置的本地服务，下发探测、下载、查询、取消任务，形成"帮我下载这个视频，选最高画质，下完告诉我文件在哪"的完整闭环。

关键定位：**App 就是服务**——不是另起一个命令行工具，agent 提交的任务与 UI 手动提交的任务进入同一个内存队列（`queue.rs` 状态机），用户在界面上实时可见进度、可随时手动取消，两条入口行为完全一致。

成功标准：在 Claude Code 里执行一条复制即用的 `claude mcp add` 命令，开关打开后，agent 能探测链接、发起下载、轮询到完成并拿到文件路径。

## 2. 目标

- App 内嵌 MCP 服务端（Streamable HTTP），只监听 `127.0.0.1:8790`，路径 `/mcp`
- 暴露四个工具，全部复用现有管线，不新增下载逻辑：
  - `probe_video(url, proxy?)` — 调 `probe.rs`，返回标题、时长与人读清晰度选项（含每项 `format_id`，以及 `__best__` / `__audio_mp3__` 两个哨兵的语义说明）
  - `start_download(url, format_id?, proxy?)` — 调 `args.rs`/`queue.rs` 现成入队路径，`format_id` 缺省视为 `__best__`；返回 `jobId`。URL 缓存未命中（本会话没 probe 过）时由 MCP handler **自动先 probe 再入队**——`queue.rs::validate_format` 对未 probe 的 URL 直接拒绝（哨兵也不例外），自动 probe 保证"帮我下载这个视频，选最高画质"一句话走通，代价是首次调用多一次 spawn 延迟
  - MCP 侧 `format_id` 走**窄白名单**：本次 probe 返回的 id + `__best__` + `__audio_mp3__`，仅此三类；不复用 `args.rs` 的宽校验（其放行 `__audio_m4a__`/缩略图/字幕/裸 "1080p" 等 v1 UI 刻意不暴露的形态，不得进入 agent 可达面）。`__audio_mp3__` 等哨兵在 Rust 侧 probe 返回中合成（现状该哨兵由前端 VideoCard 注入）
  - `list_jobs()` — 返回与 `JobRecord`（serde camelCase 契约）一致的任务数组：状态、进度、速度、完成后的文件路径
  - `cancel_download(job_id)` — 走现有进程组终止路径
- 偏好与元数据复用：MCP handler 在 Rust 侧直读 plugin-store `settings.json` 取 `downloadDir` 与代理偏好（**store 文件为准**，UI 内存值短暂不一致可接受，不为此加同步机制）；下载代理缺省沿用该 URL probe 时用过的代理，再退到设置偏好。`probe.rs` 缓存顺带存标题/人读清晰度标签（现只存 id 集合），使 agent 任务在 UI 行内不显示裸 URL——仅扩充缓存元数据，不改探测与下载行为
- 埋点口径（需求方拍板）：**前端兜底补齐**——App.tsx 对"事件中首次出现、非本前端 invoke 发起的 job"补发 `download_started`（mediaId 拿不到则留空）与 terminal 事件，agent 流量不再统计隐身
- 侧栏新增第三项「Agent 接入」（与"下载/历史"同级，`App.tsx` 的 `view` 状态扩展），页面内容：
  - 服务启停开关
  - 状态行：未启动 / 运行中 `127.0.0.1:8790` / 启动失败 + 错误原文
  - 一键复制接入命令（`claude mcp add --transport http lumeany http://127.0.0.1:8790/mcp`），并附 mcpServers JSON 配置块供其他客户端使用
  - 四个工具的用途说明列表
- 新增 IPC：`set_mcp_enabled(bool)`、`mcp_status() -> { running, port, error }`
- 中英双语文案进 `lib/i18n.ts`（含侧栏新导航项）

## 3. 非目标

- Skill 服务 / SKILL.md 分发（本期不做）
- 鉴权、token、跨设备/远程访问：本机进程即信任，与现有本地后端（127.0.0.1:8000/8001）口径一致
- 播放列表、队列持久化、SponsorBlock（沿用 v1 明确不做项）
- 修改任何 yt-dlp 参数拼装、下载、进度解析逻辑（本期对 `probe.rs` 仅做缓存元数据扩充，不触碰解析与下载行为）
- 服务端口可配置（v1 固定 8790；冲突即报错，不做自动换端口）

## 4. 反目标（做出来但这些算失败）

- agent 入口形成第二套下载实现（哪怕"只是转发一下"）——必须与 UI 共享同一 `AppState` 与命令函数
- 服务默认开启、或上次开着下次启动自动恢复——本机监听端口必须用一次开一次
- 把命令行细节（yt-dlp 表达式、argv）泄露进 MCP 工具面

## 5. 约束

- 架构红线（CLAUDE.md）：yt-dlp 是无状态 sidecar，Rust 瘦编排，UI 不碰命令行——MCP 层同样只做协议翻译
- `panic = "abort"`：不得依赖 catch panic；bind/启动失败必须以返回值/状态呈现
- 能力清单 `capabilities/default.json` 无需新增（调用方向是 agent→Rust，webview 只发 invoke）
- CSP 无需改动：HTTP 服务在 Rust 侧监听，webview 不向外连接
- `format_id` 白名单校验（必须在本次 probe 结果或两哨兵中）对 MCP 入口同样生效——因为复用同一入队函数
- 新依赖：官方 Rust SDK `rmcp`（含 streamable HTTP server 能力，底层 hyper/axum）；版本由构建者选定，注意与现有 tokio 1.x 兼容
- 内存队列语义不变：agent 提交的任务重启即失，属预期

## 6. 已定的 how（需求方拍板）

- 传输 = Streamable HTTP over `127.0.0.1`（stdio 无法连接"正在运行的 App"）
- 默认关闭，且**每次启动都回到关闭态**，不持久化开关
- 界面形态 = 独立侧栏入口「Agent 接入」，不是下载页底部卡片
- 工具面 = 上文四个，探测/下载/查询/取消全开放

## 7. 留给构建者的决定

- MCP 服务生命周期挂载点（Tauri `setup` + 懒启动 tokio task；listener 句柄存放与停止方式）
- `mcp_server.rs` 内部结构、rmcp feature 组合与具体版本
- 面板视觉细节（沿用 `App.css` 现有令牌：`--indigo-*`、`--mist` 等；开关/复制按钮复用现有组件样式）
- 复制按钮的实现（`navigator.clipboard` 在 Tauri webview 的可用性验证，不可用则退化选中文本）
- 工具返回的 JSON 字段命名（对 agent 友好为先，可不同于前端契约，但不得泄露 yt-dlp 内部表达式）
- 测试：`args` 白名单、进度解析已有；本期建议补 tool handler 层的单元/集成冒烟（至少 `tools/list` 与 `probe`→`enqueue` 链路），以及一份 README/文档里的手动联调步骤（Claude Code 实测命令）
- i18n key 命名、侧栏图标选择（与现有内联 SVG 风格一致）

## 8. 验收口径

1. 开关打开 → 端口监听，状态行显示运行中；关闭 → 端口释放
2. `claude mcp add` 后 Claude Code 能列出四个工具；probe 一个 YouTube/Bilibili 链接返回人读选项
3. agent 发起下载后：UI 任务列表实时出现该任务（标题不是裸 URL）、进度正常、行内取消与 `cancel_download` 两个入口都能杀掉（含 FFmpeg 孙进程）；agent 不调 probe 直接 `start_download` 也成功（自动先探测）
4. `list_jobs` 能看到完成任务的 `filePath`
5. 服务未启动时，MCP 客户端连接失败不产生 App 侧错误弹窗；端口被占用时面板显示错误原文
6. agent 任务在前端有埋点兜底：started 与 terminal 事件各至少一条（mediaId 允许为空）
7. `cargo test` 与 `pnpm exec tsc --noEmit` 通过

## 9. 评审记录

- 2026-11-12 builder-check（独立 reviewer）提出 4 问，处置如下：
  - Q1「未先 probe 直接下载」→ MCP handler 自动 probe（构建者决定）
  - Q2「代理/偏好来源」→ Rust 直读 settings.json + per-URL 沿用 probe 代理 + `start_download` 可选 `proxy`（构建者决定）
  - Q3「agent 任务的元数据与埋点对等」→ 埋点采用**前端兜底补齐**（需求方拍板）；probe 缓存扩充标题/标签为配套构建者决定
  - Q4「format_id 哨兵暴露面」→ MCP 窄白名单（构建者决定）
