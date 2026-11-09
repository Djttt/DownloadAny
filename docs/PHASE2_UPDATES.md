# 第二期动态更新部署

第二期把“是否更新”从 GitHub 静态 `latest.json` 移到 DownloadAny-BackEnd。安装包和
yt-dlp 文件仍必须先签名；后端只选择版本和返回 CDN 地址，不接触签名私钥。

## 1. 必填配置

后端 `.env`：

```dotenv
UPDATE_ADMIN_TOKEN=一段足够长的随机管理令牌
UPDATE_CDN_BASE_URL=https://你的国内CDN域名/downloadany
```

GitHub 仓库 `Settings > Secrets and variables > Actions > Variables` 新增：

```text
DOWNLOADANY_API_BASE_URL=https://你的后端API域名
```

工作流会据此生成 `tauri.release.conf.json`，应用更新与 yt-dlp 更新均访问该后端。后端和
CDN 生产环境必须使用 HTTPS。

## 2. 发布桌面版本

1. 按第一期流程打标签，取得 NSIS 更新产物及 `.sig`。
2. 把 NSIS 更新产物上传到 CDN，例如 `desktop/0.2.0/DownloadAny-setup.exe`。
3. 调用管理接口登记发布（`signature` 填 `.sig` 文件的完整单行内容）：

```powershell
$headers = @{ Authorization = "Bearer $env:UPDATE_ADMIN_TOKEN" }
$body = @{
  version = "0.2.0"
  channel = "stable"
  target = "windows"
  arch = "x86_64"
  artifact_path = "desktop/0.2.0/DownloadAny-setup.exe"
  signature = "粘贴.sig内容"
  notes = "本版本更新说明"
  rollout_percent = 10
  minimum_version = "0.1.0"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$env:DOWNLOADANY_API_BASE_URL/api/updates/admin/desktop" `
  -Headers $headers -ContentType "application/json" -Body $body
```

`rollout_percent` 可通过 `PATCH /api/updates/admin/desktop/{id}` 从 10 逐步提高到
100（请求体如 `{"rollout_percent": 50}`）；同一设备始终落在同一灰度桶。
`minimum_version` 以下的客户端会忽略灰度比例，直接收到该版本。beta 客户端可收到 beta
和 stable，stable 客户端只接收 stable。错误发布可调用
`DELETE /api/updates/admin/desktop/{id}` 立即停用。

## 3. 独立发布 yt-dlp

使用与应用相同的 Tauri 私钥签名原始 yt-dlp 文件：

```powershell
pnpm tauri signer sign .\yt-dlp.exe --private-key-path .\.tauri\downloadany.key
Get-FileHash .\yt-dlp.exe -Algorithm SHA256
```

把 `yt-dlp.exe` 上传到 CDN，再登记组件发布：

```powershell
$body = @{
  component = "yt-dlp"
  version = "2026.11.08"
  channel = "stable"
  target = "x86_64-pc-windows-msvc"
  artifact_path = "components/yt-dlp/2026.11.08/yt-dlp.exe"
  signature = "粘贴.sig内容"
  sha256 = "小写SHA256"
  rollout_percent = 100
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$env:DOWNLOADANY_API_BASE_URL/api/updates/admin/components" `
  -Headers $headers -ContentType "application/json" -Body $body
```

客户端启动 15 秒后静默检查。只有 Minisign 签名和 SHA-256 都通过才会安装；新文件进入独立
版本目录并原子切换，下次解析使用新版本，失败时继续使用内置版本。

## 4. 数据库

新部署会由 `Base.metadata.create_all` 自动创建 `desktop_releases` 和
`component_releases`。已有生产库若使用正式迁移流程，应先按这两个 SQLAlchemy 模型生成
迁移，再发布后端。
