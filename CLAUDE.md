# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

DownloadAny：基于 Tauri v2 + yt-dlp 的跨平台桌面视频下载器（v1 = 核心下载）。

核心原则：**yt-dlp/FFmpeg 是无状态计算引擎（sidecar 进程），Rust 只做瘦编排层，UI 不接触命令行，下载逻辑不进渲染层。** v1 明确不做：SQLite 队列持久化、播放列表、SponsorBlock、Cookie。已接通：代理（设置页偏好 → DownloadOptions/`probe_video` → `--proxy`）与双通道热更新（整包自更新 + yt-dlp 组件热更新，安装包已签名）。

## 常用命令

```bash
pnpm tauri dev                  # 开发（自动先跑 fetch-binaries.mjs 预置 sidecar/内嵌件，再 vite + cargo）
pnpm tauri build                # 打包（macOS 出 .app/.dmg）
pnpm version:set 0.1.1          # 同步 package.json/tauri.conf.json/Cargo.toml 三处版本；发布 tag 以 tauri.conf.json 为准
pnpm exec tsc --noEmit          # 前端类型检查（无 lint 配置）

cd src-tauri && cargo test              # Rust 单元测试（args 白名单 / progress 解析）
cd src-tauri && cargo test args::tests  # 跑单个模块测试
cd src-tauri && cargo test --lib -- --nocapture
```

依赖环境：Rust（stable）、Node 18+ / pnpm。`pnpm install` 后需放行 ffmpeg-static 的构建脚本（已在 package.json 的 `pnpm.onlyBuiltDependencies` 中配置），否则 ffmpeg 二进制不会下载。

## Sidecar 与内嵌组件

- `scripts/fetch-binaries.mjs` 在 dev/build 前自动运行：先取到 `src-tauri/binaries/<name>-<target-triple>`，再把两个二进制 gzip 进 `src-tauri/embedded/{yt-dlp,ffmpeg}.gz` + `manifest.json`（schemaVersion/target/version/sha256，Rust `include_bytes!`/`include_str!` 编进主程序；`writeIfChanged` 避免无谓重编译）。两目录均 gitignore 勿提交；**安装目录里不再有 sidecar**（externalBin 已移除）
- 解析优先级（Rust 侧 `resolve.rs` 与脚本保持一致的 triple 映射）：**开发态：系统 PATH → 内嵌释放；打包态：热更指针 `active.json` → 内嵌释放 → PATH**。开发态优先 PATH 是刻意的：官方 PyInstaller 静态包（yt-dlp_macos）在 macOS 上每次 spawn 有 ~13s 启动开销（系统评估+解包），brew/zipapp 版秒级
- 释放路径 `<用户数据>/DownloadAny/tools/<id>/<version>/<file>`（版本即目录名，组件当前版本由此反推）；写入走同目录临时文件 + fsync + SHA-256 校验 + chmod 0755 + 原子 rename，崩溃也留不下半个可执行文件；结果 OnceLock 缓存
- yt-dlp 从 GitHub releases 下载并按官方 SHA-256SUMS 校验；失败回退复制系统版本（会实跑 `--version` 验证）。脚本经 undici `EnvHttpProxyAgent` 遵循 `HTTPS_PROXY` 等环境变量（Node fetch 默认不读，勿退回裸 fetch）。**yt-dlp 版本必须紧跟上游**——YouTube 反爬会拒绝旧版（"The page needs to be reloaded"），定期 `DOWNLOADANY_FORCE=1` 刷新；构建期之外还可走组件热更新通道刷新（见下），无需发整包
- FFmpeg 仅在打包态通过 `--ffmpeg-location <ffmpeg 自身释放目录>` 显式传给 yt-dlp（`queue.rs` 从 `resolve::ffmpeg()` 取）；开发态走 PATH（要求本机装 ffmpeg）

## 架构（三层）

```
React UI  ──invoke──▶  Rust commands  ──spawn (tokio::process)──▶  yt-dlp sidecar
   ▲                  （参数白名单/进程管理/stderr解析）                │
   └──listen◀── emit 事件（job-progress/job-status/log-line）◀────────┘
```

Rust 侧（`src-tauri/src/`，一模块一职责）：

- `resolve.rs` — 二进制解析（开发态 PATH / 打包态内嵌+热更）；`args.rs` — DownloadOptions → argv 白名单拼装（format_id 必须在本次 probe 结果集合或两个哨兵 `__best__`/`__audio_mp3__` 中；URL 必须 http(s) 开头；代理 URL 必须带 http/https/socks4/5 scheme 前缀且无空白，probe 与 download 两条路径都透传 `--proxy`。spawn 传数组，天然免疫 shell 注入）
- `probe.rs` — `yt-dlp -J --no-playlist` 探测，把原始 formats 折叠成人读选项（合成哨兵不暴露 yt-dlp 表达式）
- `progress.rs` — 解析 `--progress-template` 输出的竖线协议：`PROGRESS|percent|downloaded|total|total_estimate|speed|eta`，未知值 yt-dlp 打印 `None`/`NA` 而非 JSON null，因此不用 JSON。进度行实测出现在 **stdout**（stderr 同时消费）
- `queue.rs` — 任务状态机：`AppState`(Arc<Inner>) + Semaphore(3) 并发、`CommandChild` 无（自持 pid）、取消走进程组终止（Unix `process_group(0)` + `kill -TERM/-9 -<pgid>`，杀到 FFmpeg 孙进程；Windows `taskkill /T /F`）、120s 静默看门狗、探测结果 format_id 白名单缓存
- `commands.rs` — 主要 IPC 面：`probe_video`（带 proxy 参数） / `enqueue_download` / `cancel_download` / `list_jobs` / `dependency_info` / `set_max_concurrency` / `detect_proxy`（TCP 连通性探测本机常见代理端口，仅作填充建议）
- `mcp_server.rs` — Agent 接入生命周期：rmcp Streamable HTTP 挂 `127.0.0.1:8790/mcp`（axum nest_service + LocalSessionManager），IPC `set_mcp_enabled`/`mcp_status`；RUNTIME 互斥串行开关，bind 失败返回状态 `error` 字段而非 Err；每次启动默认关闭
- `mcp_tools.rs` — MCP 工具面（probe_video/start_download/list_jobs/cancel_download），直连 queue/probe 管线；agent 面窄格式白名单（本次 probe 可见项 + `__best__`/`__audio_mp3__`）；未 probe 过的 URL 在 start_download 内自动先 probe；代理记忆 url→probe 用过的值
- `mcp_prefs.rs` — 设置页偏好的 Rust 侧镜像：`StoreExt` 读 `settings.json`（proxyType/proxyAddr→`build_proxy_url` 对齐前端、outputDir 缺省回退系统下载目录）
- `embedded_components.rs` — 内嵌组件释放底座：`ensure()` 优先读 `tools/<id>/active.json` 指针（热更过的版本，验 SHA 后用），否则从 include_bytes 的 gz 原子释放内嵌版；`install_remote()` 落新版本目录 + 原子翻转指针。清单来源的 id/version/fileName 一律过 `validate_segment`（限 `[A-Za-z0-9._+-]`）防路径穿越
- `component_updater.rs` — IPC `update_ytdlp_component(channel, deviceId)`：查 `{DOWNLOADANY_API_BASE_URL}/api/updates/components/yt-dlp/<triple>/<当前版本>`（204=已最新；基址是 Rust 编译期 env，未配置则静默 no-op；release 强制 HTTPS）→ **SHA-256 + minisign 双校验**（与整包更新同一把公钥，硬编码在本文件）→ `install_remote`，下次 spawn 即新版本
- `error.rs` — `AppError`（thiserror），序列化为字符串直接给前端展示

前端（`src/`）：

- 界面为浅色侧栏布局（参考 SnapAny）：侧栏（下载/历史/Agent 接入视图切换，`AgentView.tsx` + `Agent.css`）+ UrlBar + 自动下载开关 + 表式任务列表（行内进度与"状态子行"）+ 底部保存目录栏。令牌定义在 `App.css` `:root`
- agent 下发的任务 UI 对等：事件层 `hydrateAgentJob`（500ms 宽限 + `list_jobs` 回填标题/清晰度）与 `recordJobStart` 埋点去重（`trackedStarted`/`pendingHydrate`），UI 入队与 agent 共用同一 started/terminal 口径
- `types.ts` 是前后端契约，**必须镜像 Rust serde 结构（全部 `#[serde(rename_all = "camelCase")]`）**；改 Rust 结构必须同步改这里（如 `JobRecord.formatId` 支撑失败重试）
- `App.tsx` 以 jobId 归并三个事件到 `jobs`/`logs` map；骨架记录可能先于 invoke resolve 到达，upsert 时勿覆盖未知字段。队列是纯内存的，重启即空（页面 HMR 重载后 Rust 状态还在，靠 `list_jobs` hydration 找回）
- `lib/updater.ts` — 整包自更新 hook `useAppUpdater(hasActiveJobs)`（tauri-plugin-updater 纯前端编排，Rust 零逻辑）：启动 5s 自动静默 check（失败不打扰），发现新版本弹右下角浮动提示 `UpdateNotice`；手动 checkNow 不弹浮层，结果只在设置-关于页内展示（浮层可见时关于页更新块让位，保证同一时刻只有一处更新提示；收起浮层后回落为关于页入口）；请求头带 `X-DownloadAny-Device-Id/Channel`（服务端灰度分桶）；有 queued/running 任务时 install 进 `blocked`；skip 记版本进 store 后自动检查不再提示。组件热更新由 `App.tsx` 启动 15s 后触发，尽力而为、失败吞掉
- 设置（下载目录、自动下载、updateChannel/skippedUpdateVersion）用 `@tauri-apps/plugin-store`；目录选择用 `@tauri-apps/plugin-dialog`；已完成任务的"在文件夹中显示"用 `@tauri-apps/plugin-opener` 的 `revealItemInDir`
- ffmpeg 只认单横线 `-version`（yt-dlp 用 `--version`）——版本探测与脚本校验都按工具区分参数；`dependency_info` 有 OnceLock 缓存避免重复付费

## 约定与陷阱

- **updater 私钥 `.tauri/downloadany.key`（gitignore）必须离线备份，丢失 = 老客户端永远验不过后续更新**；同 key 公钥写了两处——`tauri.conf.json` plugins.updater.pubkey 与 `component_updater.rs` 硬编码，轮换必须两处同步
- 发布动线：`pnpm version:set` → commit → 打 tag（与 tauri.conf.json 版本严格一致）→ Actions（`.github/workflows/release.yml`）**串行**构建 Windows（NSIS）+ macOS（app/dmg，仅 Apple Silicon），签名后发同一 Release 并合并写 latest.json（串行是防 platforms 键读-改-写覆盖；详见 `docs/UPDATER.md`）→ CI 绿后跑 `scripts/publish-server-release.sh <ver>` 把桌面更新登记到自托管服务器（下载签名四件套→上传 `/srv/downloadany/desktop/<ver>/`→服务器侧 admin 登记 windows+macos 两条并回查验收）；灰度/停用走后端 admin 接口（`docs/PHASE2_UPDATES.md`）
- 更新端点分两层：dev 构建指 GitHub `latest.json`；发布构建由 `write-update-config.mjs` 用 CI Variable `DOWNLOADANY_API_BASE_URL` 生成 `tauri.release.conf.json` 走自有后端。**`DOWNLOADANY_API_BASE_URL` 是 Rust 编译期环境变量，与前端联调用的 `VITE_API_BASE_URL`（运行时、可走 ssh -L 隧道）是两回事，勿混用**。该 Variable 已设为 `https://api.lumeany.cc` ⇒ **下一个 tag 起的发布构建只查自有后端，每次发版必须跑 `publish-server-release.sh` 登记，否则新客户端静默视为"已最新"**（GitHub `latest.json` 仍由 CI 维护，0.1.1 及更早发布构建照常经 GitHub 收升级）；Variable 未配置时 ⇒ 回 GitHub 通道且组件热更新静默禁用
- 组件热更新只覆盖 yt-dlp（ffmpeg 无远程通道）；旧版本目录保留、可删 `active.json` 回退内嵌版。更新下载都发生在 Rust/插件侧（reqwest），不受 webview CSP 约束，`connect-src` 无需为更新域名放行
- 修改任何传给 yt-dlp 的参数：过 `args.rs` 白名单，不在别处拼命令
- MCP 的格式白名单在 `mcp_tools.rs`（窄：仅本次 probe 可见项+两哨兵，挡字幕/封面/m4a/裸高度等 sidecar 形态）；`args.rs` 宽校验仍是下载命令的唯一边界，MCP 不绕过它、只在其上再收窄
- capabilities（`src-tauri/capabilities/default.json`）：shell 插件已随内嵌组件改造移除，进程仍由 Rust 自 spawn、不经 scope 校验；`updater:default` 与 `process:allow-restart` 是整包自更新的硬依赖，勿删
- release profile 有 `panic = "abort"`，勿在 command 路径依赖 catch panic
- `tauri.conf.json` CSP 已收紧，`connect-src` 仅 ipc + `127.0.0.1:8000/8001`（本地后端/ssh -L 隧道，见 README），改远程 API 直连地址必须同步加白，否则 webview 直接拦掉
- 端到端联调可不依赖外网：用 ffmpeg 生成测试视频 + 本地 `python3 -m http.server` 喂 generic extractor（验证过的流程见 git log / 计划文档 `~/.claude/plans/yt-dlp-tauri-sharded-toast.md`）
