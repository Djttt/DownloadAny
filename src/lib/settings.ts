import { load } from "@tauri-apps/plugin-store";
import { downloadDir } from "@tauri-apps/api/path";
import type { LangPref } from "./i18n";
import type { ThemePref } from "./theme";

async function store() {
  return load("settings.json", { autoSave: true });
}

/** 输出目录：store 持久化，默认系统下载目录 */
export async function loadOutputDir(): Promise<string> {
  const s = await store();
  const saved = await s.get<string>("outputDir");
  if (saved) return saved;
  return await downloadDir();
}

export async function saveOutputDir(dir: string): Promise<void> {
  (await store()).set("outputDir", dir);
}

/** 自动下载：解析后直接以最佳画质+音频入队 */
export async function loadAutoMode(): Promise<boolean> {
  const s = await store();
  return (await s.get<boolean>("autoMode")) ?? false;
}

export async function saveAutoMode(on: boolean): Promise<void> {
  (await store()).set("autoMode", on);
}

/** 最大同时下载任务数：与 Rust 侧钳制范围(1..=10)保持一致 */
export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 10;
export const CONCURRENCY_DEFAULT = 3;

export async function loadMaxConcurrency(): Promise<number> {
  const s = await store();
  const v = await s.get<number>("maxConcurrency");
  if (typeof v !== "number" || !Number.isFinite(v)) return CONCURRENCY_DEFAULT;
  return Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, Math.round(v)));
}

export async function saveMaxConcurrency(n: number): Promise<void> {
  (await store()).set("maxConcurrency", n);
}

/** 界面语言偏好：system / zh / en */
export async function loadLangPref(): Promise<LangPref> {
  const s = await store();
  const v = await s.get<string>("langPref");
  return v === "zh" || v === "en" ? v : "system";
}

export async function saveLangPref(p: LangPref): Promise<void> {
  (await store()).set("langPref", p);
}

/** 界面主题偏好：system / light / dark（配色生效见 lib/theme.ts） */
export async function loadThemePref(): Promise<ThemePref> {
  const s = await store();
  const v = await s.get<string>("themePref");
  return v === "light" || v === "dark" ? v : "system";
}

export async function saveThemePref(p: ThemePref): Promise<void> {
  (await store()).set("themePref", p);
}

/** 代理偏好：类型 + 地址，组装后经 DownloadOptions/probe 传入下载引擎 */
export type ProxyType = "none" | "http" | "socks5";

export async function loadProxyType(): Promise<ProxyType> {
  const s = await store();
  const v = await s.get<string>("proxyType");
  return v === "http" || v === "socks5" ? v : "none";
}

export async function saveProxyType(p: ProxyType): Promise<void> {
  (await store()).set("proxyType", p);
}

export async function loadProxyAddr(): Promise<string> {
  const s = await store();
  return (await s.get<string>("proxyAddr")) ?? "";
}

export async function saveProxyAddr(a: string): Promise<void> {
  (await store()).set("proxyAddr", a);
}

/** 地址已是完整 URL 则原样使用，否则按类型补 scheme；类型 none 或地址为空 → 不走代理 */
export function buildProxyUrl(type: ProxyType, addr: string): string | null {
  if (type === "none") return null;
  const a = addr.trim();
  if (!a) return null;
  return /^(https?|socks[45]a?h?):\/\//i.test(a) ? a : `${type}://${a}`;
}
