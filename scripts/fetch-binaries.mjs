#!/usr/bin/env node
// 构建时预置 sidecar 二进制（与 src-tauri/src/resolve.rs 的 triple 映射保持一致）
//
// 策略：
//   yt-dlp  ← GitHub yt-dlp/yt-dlp releases/latest（官方独立二进制构建，按 SHA2-256SUMS 校验）
//   ffmpeg  ← npm 包 ffmpeg-static（自动匹配当前平台/架构）
//   两者都失败时回退：复制系统 PATH 中的版本（仅限开发，打包分发时不建议）
//
// 用法：node scripts/fetch-binaries.mjs
// 重新下载：DOWNLOADANY_FORCE=1 node scripts/fetch-binaries.mjs

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
// Node 的 fetch 默认不读 *_PROXY 环境变量；挂上 EnvHttpProxyAgent 才会走系统代理
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new EnvHttpProxyAgent());
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN_DIR = join(ROOT, "src-tauri", "binaries");

// 与 resolve.rs::target_triple() 一致
const TRIPLE = {
  "darwin:arm64": "aarch64-apple-darwin",
  "darwin:x64": "x86_64-apple-darwin",
  "linux:x64": "x86_64-unknown-linux-gnu",
  "linux:arm64": "aarch64-unknown-linux-gnu",
  "win32:x64": "x86_64-pc-windows-msvc",
}[`${process.platform}:${process.arch}`];

if (!TRIPLE) {
  console.error(`[fetch-binaries] 不支持的平台: ${process.platform}/${process.arch}`);
  process.exit(1);
}

const EXE = process.platform === "win32" ? ".exe" : "";
const YTDLP_TARGET = join(BIN_DIR, `yt-dlp-${TRIPLE}${EXE}`);
const FFMPEG_TARGET = join(BIN_DIR, `ffmpeg-${TRIPLE}${EXE}`);

// yt-dlp 官方各平台产物名
const YTDLP_ASSET =
  process.platform === "darwin"
    ? "yt-dlp_macos"
    : process.platform === "win32"
      ? "yt-dlp.exe"
      : "yt-dlp";

main().catch((err) => {
  console.error("[fetch-binaries] 失败:", err.message);
  process.exit(1);
});

async function main() {
  mkdirSync(BIN_DIR, { recursive: true });

  const force = process.env.DOWNLOADANY_FORCE === "1";
  const sums = {};

  for (const [label, target, fetcher] of [
    ["yt-dlp", YTDLP_TARGET, fetchYtDlp],
    ["ffmpeg", FFMPEG_TARGET, fetchFfmpeg],
  ]) {
    if (existsSync(target) && !force) {
      console.log(`[fetch-binaries] ${label}: 已存在，跳过（DOWNLOADANY_FORCE=1 可强制刷新）`);
      sums[`${label}-${TRIPLE}${EXE}`] = sha256File(target);
      continue;
    }
    let from = null;
    try {
      from = await fetcher(target);
    } catch (e) {
      console.warn(`[fetch-binaries] ${label}: 获取失败（${e.message}），尝试系统 PATH 回退`);
    }
    if (!from) from = copyFromPath(label, target);
    if (!from) {
      throw new Error(
        `${label}: 在线下载与 PATH 回退均失败。请手动放置到 ${target}，或安装 \`${label}\` 后重试`,
      );
    }
    chmodSync(target, 0o755);
    sums[`${label}-${TRIPLE}${EXE}`] = sha256File(target);
    console.log(`[fetch-binaries] ${label}: ${from}`);
  }

  writeFileSync(join(BIN_DIR, "SHA256SUMS.txt"), formatSums(sums));
}

// ---------- yt-dlp：GitHub Releases latest + 官方校验和 ----------

async function fetchYtDlp(target) {
  const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
  let expected = null;
  try {
    const text = await getText(base + "SHA2-256SUMS");
    expected = text
      .split("\n")
      .find((l) => l.trim().endsWith(YTDLP_ASSET))
      ?.trim()
      .split(/\s+/)[0];
  } catch {
    console.warn("[fetch-binaries] yt-dlp: 校验和文件不可用，跳过校验");
  }
  await download(base + YTDLP_ASSET, target);
  if (expected) verify(target, expected, "yt-dlp");
  return `GitHub releases/${YTDLP_ASSET}${expected ? "（SHA-256 已校验）" : ""}`;
}

// ---------- ffmpeg：ffmpeg-static npm 包（自带平台二进制） ----------

async function fetchFfmpeg(target) {
  const require = createRequire(import.meta.url);
  const src = require("ffmpeg-static"); // 导出当前平台的 ffmpeg 可执行文件路径
  if (!src || !existsSync(src)) throw new Error("ffmpeg-static 未安装？运行 pnpm install");
  copyFileSync(src, target);
  return `node_modules/ffmpeg-static (${src.replace(ROOT + "/", "")})`;
}

// ---------- 通用工具 ----------

function copyFromPath(label, target) {
  const probe = process.platform === "win32" ? `where ${label}` : `which ${label}`;
  try {
    const found = realpathSync(execSync(probe, { encoding: "utf8" }).split("\n")[0].trim());
    if (!found || statSync(found).size === 0) return null;
    copyFileSync(found, target);
    chmodSync(target, 0o755);
    // 回退来的"二进制"必须真的能跑（Homebrew 的 yt-dlp 是带 shebang 的 python shim）
    execSync(`"${target}" --version`, { encoding: "utf8" });
    console.warn(`[fetch-binaries] ⚠ ${label}: 使用系统版本 ${found}（本机可用，分发不保证）`);
    return `PATH 回退: ${found}`;
  } catch {
    rmSync(target, { force: true });
    return null;
  }
}

async function download(url, dest, timeoutMs = 120_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`下载内容为空: ${url}`);
  writeFileSync(dest, buf);
}

async function getText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verify(path, expectedHex, label) {
  const actual = sha256File(path);
  if (actual !== expectedHex) {
    throw new Error(`${label} SHA-256 校验失败: 期望 ${expectedHex}，实际 ${actual}`);
  }
}

function formatSums(obj) {
  return Object.entries(obj)
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n") + "\n";
}
