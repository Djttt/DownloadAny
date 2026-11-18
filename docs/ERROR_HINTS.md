# 报错友好化设计（errorHint）

日期：2026-11-18 ｜ 状态：已批准（方案 B）

## 意图

yt-dlp 解析/下载失败时，UI 不再直接展示英文原始报错，而是按场景给一句人话
（如"该网站暂时拒绝了请求（疑似触发人机验证）"）+ 一行简短指引；原始报错收进
"查看原始报错"折叠区，排查和用户反馈现场不丢。解析报错（用户反馈最多）优先，
下载失败共用同一张表。

## 为什么不选另外两条路

- A（Rust 统一分类 + {message,detail} 结构化契约）：单点且 cargo 可测，但要动
  AppError→InvokeError 序列化、事件形状、types.ts 契约镜像，diff 最大；且会把
  对 agent 更有用的原始报错从 MCP 面抹掉。
- C（Rust 分类但只发字符串）：UI 丢失原始现场，排查只能翻日志。
- B（前端分类，零 Rust 契约变更）：错误展示本来就是渲染层职责（"Rust 只做瘦
  编排"）；MCP/agent 继续看到原始 stderr；模式表纯函数，用 node --test 兜底。

## 报错的真实来源（现状）

| 表面 | 来源 | 形态 |
|---|---|---|
| 解析失败横幅 | 后端 yt-dlp（python DownloadError.msg）+ 后端自有中文 | UrlBar error，`App.tsx startParse failures` |
| 下载失败状态子行 | 本地 CLI stderr 最后一条含 ERROR 行（queue.rs last_error_line） | QueueList / VideoCard |
| 探测失败（MCP/本地） | probe.rs stderr tail（本设计把 3 行放宽到 8 行，仅此一处 Rust 改动） | invoke 错误字符串 |
| 看门狗/超时等 | AppError 中文串 | 已是人话，直通 |

## 规则

1. `classifyError(raw)` 纯函数：小写子串匹配，有序模式表 → ErrorKind。
2. **直通规则**：字符串含 CJK 字符（AppError/后端自产的中文提示）→ 不包装，
   原文即主文案，无折叠区。
3. 顺序敏感：botCheck 先于 loginRequired（"Sign in to confirm you're not a
   bot" 归验证类）；proxyFailed 先于 network；429 先于 403。
4. `describeError(raw, scene)` 出 `{message, detail}`；message = i18n 表内
   `err.<kind>.title`（zh/en 双语），generic 文案按 parse/download 场景分化，
   detail = 原始串（generic 与已识别类都给，供折叠）。
5. 渲染点三处：UrlBar 解析失败横幅（每行 url + message + `<details>` 原文）、
   QueueList 状态子行（message，title 悬浮原文）、VideoCard 错误条（同上）。
6. 契约零变更：job.error / MCP 面继续是原始字符串，只在展示层翻译。

## 模式表（ErrorKind → 判定子串，lowercase）

kind | 子串（任一）
---|---
proxyFailed | "proxy" 且伴随 cannot connect/tunnel/refused/timed out/failed/407
botCheck | confirm you're not a bot · needs to be reloaded · unusual traffic · captcha
rateLimited | http error 429 · too many requests · rate limit
accessDenied | http error 403
geo | your country · not available in your region · geographically
ageRestricted | age-restricted · age gate · confirm your age · older than
loginRequired | sign in · log in · members-only · membership · premium · cookies are required · 大会员 · 仅会员 · 充电
privateVideo | private video · video is private
deleted | video unavailable · video is unavailable · no longer available · removed by the publisher · does not exist · http error 404
copyright | copyright · legal claims
formatExpired | requested format is not available
unsupportedSite | unsupported url
network | getaddrinfo · unable to download webpage · unable to connect · connection refused · network is unreachable · timed out · read timeout · temporarily failed · ssl · certificate · http error 5 · connection reset
diskFull | no space left on device · errno 28
permission | permission denied · errno 13 · read-only file system
generic | 兜底（含 watchdog/exit code 非 CJK 场景）

## 验证

- `node --test src/lib/errorHint.test.ts`：真实样本 stderr 全 kind 覆盖 +
  CJK 直通 + 顺序冲突样本（bot vs sign-in）。
- `pnpm exec tsc --noEmit`。
- `cargo test`（probe.rs tail 改动不影响现有用例，回归确认）。
