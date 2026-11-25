// node --test src/lib/errorHint.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, describeError, type ErrorKind } from "./errorHint.ts";
import { setLangPref } from "./i18n.ts";

setLangPref("zh");

type Case = [label: string, raw: string, expected: ErrorKind];
const CASES: Case[] = [
  ["youtube 人机验证(ASCII 撇号)", "ERROR: [youtube] ZwtlQ: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.", "botCheck"],
  ["youtube 人机验证(弯引号)", "ERROR: [youtube] abc: Sign in to confirm you’re not a bot", "botCheck"],
  ["youtube 页面重载风控", "ERROR: [youtube] abc: The page, including recommendations, needs to be reloaded to view abc's comments. Do you suspect this is a bot?", "botCheck"],
  ["429 限流", "ERROR: unable to download JSON metadata: HTTP Error 429: Too Many Requests", "rateLimited"],
  ["403 拒绝(优先于 network)", "ERROR: unable to download webpage: HTTP Error 403: Forbidden", "accessDenied"],
  ["地区限制(优先于 deleted)", "ERROR: [youtube] abc: Video unavailable. This video is not available in your country", "geo"],
  ["私密视频优先于登录", "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video", "privateVideo"],
  ["会员付费中文混杂", "ERROR: [BiliBili] BV1xx: 付费前往「大会员」", "loginRequired"],
  ["年龄限制", "ERROR: [vimeo] abc: This video is age-restricted and only available on Vimeo", "ageRestricted"],
  ["不支持的 URL", "ERROR: Unsupported URL: https://www.example.com/watch/123", "unsupportedSite"],
  ["视频不存在", "ERROR: [youtube] abc: Video unavailable. This video has been removed by the publisher", "deleted"],
  ["真实样本:不可用(带 is)", "ERROR: [youtube] zzzzzzzzzzz: This video is unavailable", "deleted"],
  ["真实样本:私密(变体)", "ERROR: [youtube] abc: This video is private", "privateVideo"],
  ["页面 404 不等于视频删除", "ERROR: [generic] watch: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)", "resourceMissing"],
  ["央视媒体 404", "ERROR: unable to download video data: HTTP Error 404: Not Found", "resourceMissing"],
  ["画质失效", "ERROR: Requested format is not available. Use --list-formats for a list of available formats", "formatExpired"],
  ["磁盘满(优先于 network)", "ERROR: unable to download video data: [Errno 28] No space left on device", "diskFull"],
  ["权限(优先于 network)", "ERROR: unable to open for writing: [Errno 13] Permission denied", "permission"],
  ["代理失败(优先于 network)", "ERROR: unable to connect: Cannot connect via proxy. Tunnel connection not established", "proxyFailed"],
  ["DNS 失败", "ERROR: [Bilibili] abc: Failed to resolve hostname bilibili.com ([Errno 8] nodename nor servname provided)", "network"],
  ["连接超时", "ERROR: unable to download webpage: <urlopen error timed out>", "network"],
  ["5xx", "ERROR: unable to download JSON metadata: HTTP Error 503: Service Unavailable", "network"],
  ["CJK 直通:AppError", "无效链接：URL 必须以 http:// 或 https:// 开头", "passthrough"],
  ["CJK 直通:探测超时", "探测超时（60s），请检查网络后重试", "passthrough"],
  ["CJK 直通:看门狗", "超过 120 秒无输出，已判定异常并终止", "passthrough"],
  ["CJK 直通:退出码", "yt-dlp 退出码 1", "passthrough"],
  ["未识别英文兜底", "ERROR: some totally unknown failure from the site", "generic"],
  ["空串兜底", "", "generic"],
];

for (const [name, raw, expected] of CASES) {
  test(`classify ${name}`, () => {
    assert.equal(classifyError(raw), expected);
  });
}

test("describeError 已识别类别：人话主文案 + 原始串进详情", () => {
  const raw = "ERROR: [youtube] abc: Sign in to confirm you're not a bot";
  const d = describeError(raw, "parse");
  assert.equal(d.detail, raw);
  assert.ok(d.message.includes("该网站暂时拒绝了请求"));
});

test("媒体 404 提示重新解析，并保留原始错误", () => {
  const raw = "ERROR: unable to download video data: HTTP Error 404: Not Found";
  const result = describeError(raw, "download");
  assert.match(result.message, /重新解析/);
  assert.doesNotMatch(result.message, /已被删除/);
  assert.equal(result.detail, raw);
});

test("describeError 直通：原文即文案，无详情条目", () => {
  const d = describeError("无效代理：端口超出范围", "download");
  assert.equal(d.message, "无效代理：端口超出范围");
  assert.equal(d.detail, null);
});

test("describeError 兜底文案按场景区分", () => {
  const raw = "ERROR: totally unknown";
  assert.match(describeError(raw, "parse").message, /解析失败/);
  assert.match(describeError(raw, "download").message, /下载失败/);
});

test("英文语言环境文案生效", () => {
  setLangPref("en");
  try {
    const d = describeError("ERROR: Unsupported URL: https://example.com", "parse");
    assert.match(d.message, /isn't supported/);
  } finally {
    setLangPref("zh");
  }
});
