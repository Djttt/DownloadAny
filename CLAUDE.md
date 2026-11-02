# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

DownloadAny：基于 Tauri v2 + yt-dlp 的跨平台桌面视频下载器（v1 = 核心下载）。

核心原则：**yt-dlp/FFmpeg 是无状态计算引擎（sidecar 进程），Rust 只做瘦编排层，UI 不接触命令行，下载逻辑不进渲染层。** v1 明确不做：SQLite 队列持久化、播放列表、字幕/SponsorBlock、代理/Cookie、安装包签名。

## 常用命令

```bash
pnpm tauri dev                  # 开发（自动先跑 fetch-binaries.mjs 预置 sidecar，再 vite + cargo）
pnpm tauri build                # 打包（macOS 出 .app/.dmg）
pnpm exec tsc --noEmit          # 前端类型检查（无 lint 配置）

cd src-tauri && cargo test              # Rust 单元测试（args 白名单 / progress 解析）
cd src-tauri && cargo test args::tests  # 跑单个模块测试
cd src-tauri && cargo test --lib -- --nocapture
```

依赖环境：Rust（stable）、Node 18+ / pnpm。`pnpm install` 后需放行 ffmpeg-static 的构建脚本（已在 package.json 的 `pnpm.onlyBuiltDependencies` 中配置），否则 ffmpeg 二进制不会下载。

## Sidecar 二进制

- `scripts/fetch-binaries.mjs` 在 dev/build 前自动运行，产物放入 `src-tauri/binaries/<name>-<target-triple>`（已 gitignore，勿提交）
- 解析优先级（Rust 侧 `resolve.rs` 与脚本保持一致的 triple 映射）：**打包目录（与主程序同级，Tauri 会剥掉 triple 后缀）→ binaries/ 预置 → 系统 PATH**
- yt-dlp 从 GitHub releases 下载并按官方 SHA-256SUMS 校验；失败回退复制系统版本（会实跑 `--version` 验证）。脚本经 undici `EnvHttpProxyAgent` 遵循 `HTTPS_PROXY` 等环境变量（Node fetch 默认不读，勿退回裸 fetch）。**yt-dlp 版本必须紧跟上游**——YouTube 反爬会拒绝旧版（"The page needs to be reloaded"），定期 `DOWNLOADANY_FORCE=1` 刷新
- FFmpeg 仅在打包态通过 `--ffmpeg-location <sidecar目录>` 显式传给 yt-dlp；开发态走 PATH（要求本机装 ffmpeg）

## 架构（三层）

```
React UI  ──invoke──▶  Rust commands  ──spawn (tokio::process)──▶  yt-dlp sidecar
   ▲                  （参数白名单/进程管理/stderr解析）                │
   └──listen◀── emit 事件（job-progress/job-status/log-line）◀────────┘
```

Rust 侧（`src-tauri/src/`，一模块一职责）：

- `resolve.rs` — 二进制三级解析；`args.rs` — DownloadOptions → argv 白名单拼装（format_id 必须在本次 probe 结果集合或两个哨兵 `__best__`/`__audio_mp3__` 中；URL 必须 http(s) 开头。spawn 传数组，天然免疫 shell 注入）
- `probe.rs` — `yt-dlp -J --no-playlist` 探测，把原始 formats 折叠成人读选项（合成哨兵不暴露 yt-dlp 表达式）
- `progress.rs` — 解析 `--progress-template` 输出的竖线协议：`PROGRESS|percent|downloaded|total|total_estimate|speed|eta`，未知值 yt-dlp 打印 `None`/`NA` 而非 JSON null，因此不用 JSON。进度行实测出现在 **stdout**（stderr 同时消费）
- `queue.rs` — 任务状态机：`AppState`(Arc<Inner>) + Semaphore(3) 并发、`CommandChild` 无（自持 pid）、取消走进程组终止（Unix `process_group(0)` + `kill -TERM/-9 -<pgid>`，杀到 FFmpeg 孙进程；Windows `taskkill /T /F`）、120s 静默看门狗、探测结果 format_id 白名单缓存
- `commands.rs` — 唯一 IPC 面：`probe_video` / `enqueue_download` / `cancel_download` / `list_jobs` / `dependency_info`
- `error.rs` — `AppError`（thiserror），序列化为字符串直接给前端展示

前端（`src/`）：

- `types.ts` 是前后端契约，**必须镜像 Rust serde 结构（全部 `#[serde(rename_all = "camelCase")]`）**；改 Rust 结构必须同步改这里
- `App.tsx` 以 jobId 归并三个事件到 `jobs`/`logs` map；骨架记录可能先于 invoke resolve 到达，upsert 时勿覆盖未知字段。队列是纯内存的，重启即空（页面 HMR 重载后 Rust 状态还在，靠 `list_jobs` hydration 找回）
- 设置（下载目录）用 `@tauri-apps/plugin-store`；目录选择用 `@tauri-apps/plugin-dialog`

## 约定与陷阱

- 修改任何传给 yt-dlp 的参数：过 `args.rs` 白名单，不在别处拼命令
- capabilities（`src-tauri/capabilities/default.json`）：进程由 Rust 侧 spawn，不经过 shell 插件 scope 校验，`shell:allow-spawn` 条目只是按文档预置 sidecar 权限的保险，删掉不影响当前实现
- release profile 有 `panic = "abort"`，勿在 command 路径依赖 catch panic
- `tauri.conf.json` CSP 已收紧，`img-src` 仅 `https:`（视频缩略图），加远程资源需同步改
- 端到端联调可不依赖外网：用 ffmpeg 生成测试视频 + 本地 `python3 -m http.server` 喂 generic extractor（验证过的流程见 git log / 计划文档 `~/.claude/plans/yt-dlp-tauri-sharded-toast.md`）
