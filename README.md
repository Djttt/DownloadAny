# DownloadAny

基于 **Tauri v2 + yt-dlp** 的跨平台桌面视频下载器（Windows / macOS / Linux）。

## Google 登录

桌面端使用系统浏览器完成 Google OAuth，并通过本机临时回环地址返回应用。请在
Google Cloud Console 创建 OAuth 2.0 **桌面应用**客户端，然后把同一个客户端 ID
分别写入：

```dotenv
# DownloadAny/.env
VITE_GOOGLE_CLIENT_ID=你的客户端ID.apps.googleusercontent.com

# DownloadAny-BackEnd/.env
GOOGLE_CLIENT_ID=你的客户端ID.apps.googleusercontent.com
```

桌面应用属于公共客户端，不要把 Google 客户端密钥写入前端或打包进应用。修改环境
变量后需要重启桌面端开发进程和后端服务。

## 项目背景

[yt-dlp](https://github.com/yt-dlp/yt-dlp) 是最强的命令行视频下载引擎，支持上千个站点，但它没有界面——普通用户面对几十个专业参数无从下手，进阶用户也需要一个能管理队列、展示进度、持久配置的载体。

DownloadAny 的做法是**不重新实现任何下载逻辑**，而是把 yt-dlp 与 FFmpeg 视为无状态的计算引擎（sidecar 子进程），由 Rust 承担一层"瘦编排层"：

```
React UI  ──invoke──▶  Rust 编排层  ──spawn──▶  yt-dlp + FFmpeg（sidecar）
   ▲                  进程管理 / 参数白名单 / 输出流解析 / 事件推送          │
   └──────────listen◀── 事件流（进度 / 状态 / 原始日志）◀──────────────────┘
```

三条设计原则：

1. **UI 不接触命令行**——前端只发送结构化参数（URL、格式 id、目录），所有 argv 在 Rust 侧经白名单校验后拼装，杜绝命令注入；
2. **下载逻辑不进渲染层**——进程生命周期、并发控制、进度协议解析全部收敛在 Rust；
3. **可观测**——yt-dlp 的每一行原始输出都会进入可展开的日志面板（"如果工具说了有用的话，用户就该能看到"）。

## 功能（v1）

- 🔍 单视频链接解析：标题 / 时长 / 缩略图 / 可选格式列表（先探测后下载，不盲下）
- 🎬 下载内容选择：最佳画质+音频（FFmpeg 合并）/ 各档单文件清晰度 / 仅音频（MP3 提取）/ 封面图片 / 字幕（SRT，默认 zh/en 语系，按链接可用性动态显示）
- 📊 实时进度：百分比、已下载大小、速度、剩余时间（基于 yt-dlp `--progress-template` 结构化协议）
- 🛑 任务取消：终止整个进程组（连带 yt-dlp 派生的 FFmpeg 子进程），不留孤儿进程
- 📋 内存队列：并发上限 3，超出排队；原始 stderr/stdout 日志按任务展开查看
- ⚙️ 下载目录选择与持久化（SQLite 未引入，配置走 plugin-store）
- 📦 构建时自动预置 yt-dlp / FFmpeg 官方二进制（含 SHA-256 校验），终端用户开箱即用，无需自行安装

**v1 暂不支持**（见 Roadmap）：播放列表/频道、任务重启恢复（SQLite 持久化）、字幕/元数据嵌入、限速/代理/Cookie/SponsorBlock、Full/Lite 双构建、安装包签名。

## 快速开始（开发）

环境要求：[Rust](https://www.rust-lang.org/tools/install)（stable）、Node 18+、[pnpm](https://pnpm.io)。

```bash
pnpm install          # 安装依赖（ffmpeg-static 的构建脚本已在 package.json 中放行）
pnpm tauri dev        # 启动开发实例（自动先运行 fetch-binaries.mjs 预置二进制）
```

首次运行会下载 sidecar 二进制到 `src-tauri/binaries/`（已 gitignore），自动遵循 `HTTPS_PROXY` 等代理环境变量。若所在网络无法访问 GitHub，脚本会回退复制系统安装的 yt-dlp 并实跑 `--version` 验证（回退版本仅保证本机可用，**不可用于分发**）。注意 yt-dlp 需保持较新版本，旧版会被 YouTube 反爬拒绝，可用 `DOWNLOADANY_FORCE=1 node scripts/fetch-binaries.mjs` 刷新。

测试与类型检查：

```bash
cd src-tauri && cargo test        # Rust 编排层单元测试
pnpm exec tsc --noEmit            # 前端类型检查
```

无外网时可用本地视频联调：用 ffmpeg 生成 `test.mp4`，`python3 -m http.server` 暴露后粘贴 `http://127.0.0.1:<port>/test.mp4` 即可走通探测 → 下载 → 进度全链路。

### 连调远端后端（默认本机 → 服务器 SSH 隧道）

后端部署在服务器上时只监听它自己的 `127.0.0.1:8000`，公网不开端口。本机开一个常驻隧道，
把远端后端映到本地回环：

```bash
ssh -N -o ExitOnForwardFailure=yes -L 8000:127.0.0.1:8000 root@你的服务器
pnpm tauri dev
```

`.env` 保持 `VITE_API_BASE_URL=http://127.0.0.1:8000` 即可：CSP 的 `connect-src` 与后端 CORS
都已放行该地址，两侧都不用改。部署步骤见后端仓库 README「服务器部署」一节。

只有改成公网直连（`VITE_API_BASE_URL=http://服务器地址:8000`）时，才必须同步把该地址加进
`src-tauri/tauri.conf.json` 的 `connect-src`，否则 webview 会直接拦掉请求。

## 使用方法

1. **粘贴链接，点「解析」**——支持 yt-dlp 覆盖的站点（YouTube、Bilibili、Twitter/X 等）；解析期间和结果区都会展示原始提取日志
2. **选择格式，点「下载」**——格式下拉中「最佳画质+音频」需要 FFmpeg 合并（已内置）；顶部「保存到」可更换下载目录（记忆上次选择）
3. **队列区跟踪进度**——每张卡片显示状态徽章、进度条、速度/ETA；「取消」可随时终止；「查看日志」展开该任务的 yt-dlp 原始输出
4. 完成后卡片显示输出文件完整路径

## 打包分发

```bash
pnpm tauri build    # 产出平台安装包（macOS .dmg / Windows .msi / Linux .deb|AppImage）
```

注意事项：

- externalBin 要求**当前平台**的 `src-tauri/binaries/<name>-<target-triple>` 存在，跨平台分发需在各目标平台（或 CI matrix）上分别构建
- 强制刷新二进制：`DOWNLOADANY_FORCE=1 node scripts/fetch-binaries.mjs`；发布前建议核对 `src-tauri/binaries/SHA256SUMS.txt`
- 开发版若走了 PATH 回退，打包前务必在能直连 GitHub 的环境重新执行预置脚本，确保内置的是官方独立二进制而非 Homebrew Python shim
- 未签名的下载器类二进制可能被 Windows Defender 误报，正式分发需代码签名（Roadmap）

## 项目结构

```
src/                      # React + Vite + TS 界面层（types.ts 为前后端契约）
src-tauri/src/
  ├── resolve.rs          # sidecar 三级解析：打包目录 → binaries/ → 系统 PATH
  ├── args.rs             # 白名单参数拼装（安全边界）
  ├── probe.rs            # -J 元数据探测与格式折叠
  ├── progress.rs         # PROGRESS| 竖线协议解析
  ├── queue.rs            # 任务队列 / 并发 / 进程树终止 / 看门狗
  ├── commands.rs         # 唯一 IPC 入口
  └── error.rs            # 统一错误类型
scripts/fetch-binaries.mjs  # 构建时预置官方二进制（校验 + 回退链）
```

更多实现约束与陷阱见 [CLAUDE.md](./CLAUDE.md)。

## 许可与合规

本项目许可尚未确定（仓库当前为私有，待定 LICENSE 文件）。需注意：yt-dlp 为 Unlicense（公共域），FFmpeg 构建遵循 GPL/LGPL——若未来开源并分发 FFmpeg，许可证选择会受此约束。

请遵守目标平台的服务条款与所在地版权法律，仅下载你有权访问的内容。
