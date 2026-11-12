# Agent 接入（内置 MCP 服务）

LumeAny 运行时内置一个 MCP（Model Context Protocol）服务器，AI Agent 通过它连接**正在运行的应用**，解析视频链接并下发下载任务——与桌面操作共享同一队列、同一设置。

## 开启服务

1. 打开 LumeAny → 侧栏「Agent 接入」
2. 打开「启用 MCP 服务」开关

服务仅监听 `127.0.0.1:8790`（路径 `/mcp`，Streamable HTTP），不对外网开放；**每次启动应用默认关闭**，关闭开关或退出应用即停止。

## Claude Code 接入

```bash
claude mcp add --transport http lumeany http://127.0.0.1:8790/mcp
```

或粘贴配置片段（Claude Desktop / Cursor 等的 `mcpServers`）：

```json
{
  "mcpServers": {
    "lumeany": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8790/mcp"
    }
  }
}
```

## 对话示例

> 帮我把这个视频下载成 1080p：https://www.youtube.com/watch?v=xxxx

Agent 的典型调用链：`probe_video`（拿到标题与清晰度选项）→ `start_download`（选定 formatId，得到 jobId）→ `list_jobs`（轮询进度，完成后返回 `outputPath`）。任务进度在应用界面上实时可见，可在界面或让 Agent 用 `cancel_download` 取消。

## 工具一览

| 工具 | 说明 |
| --- | --- |
| `probe_video` | 解析链接，返回标题、时长（秒）与清晰度选项（`formats[].id` 即下载时的 `formatId`） |
| `start_download` | 下发下载任务。`formatId` 缺省 `__best__`（最高画质+音频），可选 `__audio_mp3__`（仅音频）或本次解析返回的具体清晰度；未解析过的链接会自动先解析 |
| `list_jobs` | 列出所有任务：状态（queued/running/completed/failed/cancelled）、进度、速度、剩余时间、完成后的文件路径 |
| `cancel_download` | 按 jobId 取消任务（终止整个进程组，含 FFmpeg） |

约定：

- **保存目录、并发上限、代理**均取设置页当前值；代理在 `probe_video`/`start_download` 也可显式传 `proxy`（需带 `http://`/`socks5://` 等 scheme 前缀），同一链接的下载会沿用其探测时用过的代理。
- 不提供字幕、封面、m4a/wav 等旁路格式——清晰度选项以 `probe_video` 返回为准。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| Agent 连不上 / 工具列表为空 | 确认应用正在运行且「Agent 接入」页开关已打开（显示「服务运行中」）；重启应用后需重新打开（默认关闭） |
| 面板提示「启动失败：Address in use」 | `8790` 端口被其他程序占用：`lsof -i :8790` 找到占用进程关闭后重试（端口固定，暂不可配置） |
| 报「格式 xxx 不在本次解析结果中」 | 先调 `probe_video`，从其返回的 `formats[].id` 中选；或直接用 `__best__` / `__audio_mp3__` |
| 下载失败但任务行显示标题正常 | 展开任务行查看错误子行；多为链接失效或需要代理（设置页配置后重试） |
