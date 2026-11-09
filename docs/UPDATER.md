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

Tag 必须与 `tauri.conf.json` 中的版本完全一致。GitHub Actions 会构建 NSIS、
签名 updater 产物、创建 Release，并上传 `latest.json`。客户端启动 10 秒后检查：

`https://github.com/Djttt/DownloadAny/releases/latest/download/latest.json`

## 本地签名构建

本地开启 updater 产物后，构建也需要签名私钥：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$PWD\.tauri\downloadany.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build --bundles nsis
```

## 0.1.0 → 0.1.1 验收

1. 安装 GitHub Release 中签名发布的 `0.1.0`，不要使用未签名的本地调试包。
2. 发布 `v0.1.1`，确认 Release 包含安装包、`.sig` 和 `latest.json`。
3. 启动 `0.1.0`，约 10 秒后应出现更新提示。
4. 验证更新说明、下载进度、稍后、跳过此版本。
5. 创建一个运行中的下载任务，验证立即安装被阻止。
6. 任务结束后安装，应用应退出、完成 NSIS 更新并重新启动为 `0.1.1`。
