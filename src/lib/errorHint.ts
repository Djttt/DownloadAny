// yt-dlp 报错的展示层分类器：把原始 stderr/DownloadError 串映射成场景化人话文案。
// 契约层零改动——job.error、MCP 面、日志仍保持原始文本，仅 UI 展示时翻译。
// 原始串永远保留：已识别类别放折叠"详情"，未识别（generic）时原文就在详情里。
// 设计背景见 docs/ERROR_HINTS.md。

// 带 .ts 扩展名是为了 node --test 直接跑本模块（Vite 同样接受；见 tsconfig allowImportingTsExtensions）
import { t, type TKey } from "./i18n.ts";

export type ErrorKind =
  | "passthrough" // 已是面向用户的中文文案（AppError/后端自有提示），不包装
  | "botCheck"
  | "rateLimited"
  | "accessDenied"
  | "geo"
  | "ageRestricted"
  | "loginRequired"
  | "privateVideo"
  | "deleted"
  | "resourceMissing"
  | "copyright"
  | "formatExpired"
  | "unsupportedSite"
  | "proxyFailed"
  | "network"
  | "diskFull"
  | "permission"
  | "generic";

export type ErrorScene = "parse" | "download";

/** 有序规则表：首个命中生效。顺序即优先级，勿随意调整（理由见注释）。 */
const RULES: [ErrorKind, string[]][] = [
  // bot 验证常以 "Sign in to confirm..." 开头，必须排在 loginRequired 之前
  ["botCheck", ["confirm you’re not a bot", "confirm you're not a bot", "needs to be reloaded", "unusual traffic", "captcha"]],
  ["rateLimited", ["http error 429", "too many requests", "rate limit"]],
  ["proxyFailed", ["proxy"]], // 需伴随连接类失败词，见 isProxyFailure
  ["accessDenied", ["http error 403"]],
  ["geo", ["your country", "not available in your region", "geographically", "blocked in your country"]],
  ["ageRestricted", ["age-restricted", "age gate", "confirm your age", "older than"]],
  ["loginRequired", ["members-only", "membership", "premium content", "cookies are required", "log in to access", "sign in to access", "大会员", "仅会员", "需要登录"]],
  ["privateVideo", ["private video", "video is private"]],
  ["copyright", ["copyright", "legal claims"]],
  ["formatExpired", ["requested format is not available"]],
  ["unsupportedSite", ["unsupported url"]],
  ["resourceMissing", ["http error 404"]],
  ["deleted", ["video unavailable", "video is unavailable", "no longer available", "removed by the publisher", "does not exist"]],
  ["diskFull", ["no space left on device", "errno 28"]],
  ["permission", ["permission denied", "errno 13", "read-only file system"]],
  ["network", [
    "getaddrinfo", "unable to download", "unable to connect", "connection refused",
    "failed to resolve", "urlopen error",
    "network is unreachable", "timed out", "read timeout", "temporarily failed",
    "ssl", "certificate", "http error 5", "connection reset",
  ]],
];

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

function isProxyFailure(lower: string): boolean {
  return (
    lower.includes("proxy") &&
    ["cannot connect", "tunnel", "refused", "timed out", "failed", "407", "unreachable"].some((w) => lower.includes(w))
  );
}

export function classifyError(raw: string): ErrorKind {
  const text = raw.trim();
  if (!text) return "generic";
  // 直通：AppError / 后端 MediaParseError 等本就是面向用户的中文文案。
  // 判据用"含 CJK 且不带 ERROR:/error 痕迹"——混了 yt-dlp 英文报错的行不走直通。
  if (CJK.test(text) && !/error|traceback/i.test(text)) return "passthrough";
  const lower = text.toLowerCase();
  for (const [kind, needles] of RULES) {
    if (kind === "proxyFailed") {
      if (isProxyFailure(lower)) return kind;
      continue;
    }
    if (needles.some((n) => lower.includes(n))) return kind;
  }
  return "generic";
}

export interface DescribedError {
  message: string;
  /** 原始报错；passthrough 时为 null（文案即原文，无需折叠区） */
  detail: string | null;
}

export function describeError(raw: string, scene: ErrorScene): DescribedError {
  const kind = classifyError(raw);
  if (kind === "passthrough") return { message: raw.trim(), detail: null };
  if (kind === "generic") {
    return { message: t(scene === "parse" ? "err.genericParse" : "err.genericDownload"), detail: raw };
  }
  return { message: t(`err.${kind}` as TKey), detail: raw };
}

/** 单条 invoke 错误 → UrlBar 横幅（直通/纯文案时无详情条目） */
export function singleErrorBanner(raw: string, scene: ErrorScene): ErrorBanner {
  const d = describeError(raw, scene);
  return { summary: d.message, items: d.detail ? [{ message: "", raw: d.detail }] : [] };
}

export interface ErrorBanner {
  summary: string;
  items: { label?: string; message?: string; raw?: string }[];
}
