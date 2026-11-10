# DownloadAny 桌面端更新发布

## 一次性配置

本机 updater 私钥位于 `.tauri/downloadany.key`，公钥已经写入
`src-tauri/tauri.conf.json`。私钥已被 Git 忽略，必须单独离线备份；丢失后，
已安装客户端将无法验证任何后续更新。

在 GitHub 仓库 `Settings → Secrets and variables → Actions` 新增：

- `TAURI_SIGNING_PRIVATE_KEY`：`.tauri/downloadany.key` 的完整文本内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：当前密钥未设置密码，可以不创建该 Secret。

## 发布新版本

```powershell
pnpm version:set 0.1.1
git add .
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin HEAD
git push origin v0.1.1
```

Tag 必须与 `tauri.conf.json` 中的版本完全一致。GitHub Actions（`.github/workflows/release.yml`）
会**先串行构建 Windows（NSIS），再构建 macOS（app/dmg + updater 用的 .app.tar.gz）**，
签名 updater 产物、创建 Release，并把两个平台的条目合并进同一份 `latest.json`
（`windows-x86_64` / `darwin-aarch64`）。串行是刻意的：tauri-action 的 latest.json
是"拉取旧文件→合并 platforms→删重传"的读-改-写，两个 job 并发会互相覆盖平台键。
客户端启动 10 秒后检查：

`https://github.com/Djttt/DownloadAny/releases/latest/download/latest.json`

## macOS 通道说明

- **产物**：`DownloadAny_x.y.z_aarch64.dmg`（首次手动安装）与
  `DownloadAny_x.y.z_aarch64.app.tar.gz` + `.sig`（updater 下载的就是 tar.gz）。
- **未做 Apple 开发者签名/公证**：手动下载 dmg 首次打开会被 Gatekeeper 拦
  （"无法验证开发者"），右键「打开」或 `xattr -dr com.apple.quarantine <App>` 放行一次即可；
  之后 updater 自更是程序自己解包替换 bundle，新文件不带 quarantine 属性，**不再触发 Gatekeeper**。
- **仅 Apple Silicon**：CI 只构建 `darwin-aarch64`。内嵌 ffmpeg 来自 CI 机器宿主架构，
  交叉打 Intel 包会把 arm64 的 ffmpeg 塞进去，故未构建；Intel Mac 客户端查更新会因
  latest.json 缺 `darwin-x86_64` 键而静默视为"已最新"，需要时另配 `macos-13` runner 补通道。
- **走后端端点时（第二期配置）**：记得对每个平台各登记一次 admin 发布
  （`target`/`arch` 填 `macos`/`aarch64`），Windows 的登记不会覆盖 mac。

## 本地签名构建

本地开启 updater 产物后，构建也需要签名私钥：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$PWD\.tauri\downloadany.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build --bundles nsis
```

macOS 同理（zsh）：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$PWD/.tauri/downloadany.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm tauri build --bundles app,dmg
```

## 0.1.0 → 0.1.1 验收

1. 安装 GitHub Release 中签名发布的 `0.1.0`，不要使用未签名的本地调试包。
2. 发布 `v0.1.1`，确认 Release 包含安装包、`.sig` 和 `latest.json`。
3. 启动 `0.1.0`，约 10 秒后应出现更新提示。
4. 验证更新说明、下载进度、稍后、跳过此版本。
5. 创建一个运行中的下载任务，验证立即安装被阻止。
6. 任务结束后安装，应用应退出、完成 NSIS 更新并重新启动为 `0.1.1`。
7. （macOS / Apple Silicon）首次安装 Release 中的 `.dmg`（Gatekeeper 拦时右键「打开」放行一次），
   发布 `v0.1.1` 后启动约 10s 出提示，走 下载→安装：应用应自替换 bundle 并重启为 `0.1.1`，
   且不再触发 Gatekeeper 二次确认；确认 latest.json 同时含 `windows-x86_64` 与 `darwin-aarch64`。
