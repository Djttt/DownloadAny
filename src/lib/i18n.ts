// 轻量 i18n：模块级单例语言状态 + useSyncExternalStore 订阅。
// 约定：只有组件层的 UI 文案走这里；Rust 回传的错误信息与 yt-dlp 日志保持原文。

import { useSyncExternalStore } from "react";

export type Lang = "zh" | "en";
export type LangPref = "system" | Lang;

const zh = {
  // 侧栏
  "nav.mainAria": "主导航",
  "nav.download": "下载",
  "nav.history": "历史",
  "menu.support": "联系客服",
  "menu.feedback": "问题反馈",
  "menu.settings": "设置",
  "account.title": "登录 / 注册",
  "account.aria": "登录账户",
  "account.notLoggedIn": "登录 / 注册",
  "account.clickToLogin": "点击进入账户",
  "account.plan": "Free",
  "account.personal": "个人中心",
  "account.setPassword": "设置密码",
  "account.logout": "退出登录",
  "account.todo": "功能待接入",

  // 登录 / 注册
  "auth.title": "登录 DownloadAny",
  "auth.subtitle": "登录后可同步账户信息",
  "auth.registerTitle": "创建账户",
  "auth.verifyTitle": "验证邮箱",
  "auth.verifyHint": "验证码已发送至 {email}",
  "auth.google": "使用 Google 账号继续",
  "auth.googleUnconfigured": "请先配置 VITE_GOOGLE_CLIENT_ID",
  "auth.googleLoadFailed": "Google 登录组件加载失败",
  "auth.orEmail": "或使用邮箱",
  "auth.email": "邮箱",
  "auth.password": "密码",
  "auth.passwordPlaceholder": "请输入密码",
  "auth.passwordHint": "至少 10 位字符",
  "auth.code": "邮箱验证码",
  "auth.methodLabel": "登录方式",
  "auth.codeLogin": "验证码登录",
  "auth.passwordLogin": "密码登录",
  "auth.sendCode": "获取验证码",
  "auth.codeLoginButton": "登录 / 注册",
  "auth.codeLoginUnsupported": "验证码校验成功，但当前后端尚未提供验证码换取登录令牌的接口",
  "auth.emailRequired": "请输入邮箱地址",
  "auth.passwordRequired": "请输入密码",
  "auth.passwordLength": "密码至少需要 10 位字符",
  "auth.codeInvalid": "请输入 6 位数字验证码",
  "auth.login": "登录",
  "auth.register": "获取验证码并注册",
  "auth.verifyAndLogin": "验证并登录",
  "auth.resend": "重新发送验证码",
  "auth.toRegister": "第一次使用？注册账户",
  "auth.toLogin": "已有账户？返回登录",
  "auth.working": "请稍候…",

  // 设置密码弹窗
  "pwd.label": "密码",
  "pwd.confirmLabel": "确认密码",
  "pwd.placeholder": "请输入密码",
  "pwd.confirmPlaceholder": "请再次输入密码",
  "pwd.show": "显示密码",
  "pwd.hide": "隐藏密码",
  "pwd.required": "请先填写密码",
  "pwd.mismatch": "两次输入的密码不一致",
  "pwd.save": "保存",
  "pwd.doneTitle": "密码设置成功！",
  "pwd.doneDesc": "当前为纯前端演示，密码未上传到任何服务器。",

  // 客服飞窗
  "fly.telegram": "Telegram 社区",
  "fly.discord": "Discord 社区",
  "fly.email": "邮箱",
  "fly.qq": "QQ 群",
  "fly.copied": "已复制到剪贴板",

  // 主区
  "app.title": "视频 / 音频下载器",
  "app.historyTitle": "历史记录",
  "app.probeAria": "解析结果",
  "app.listAriaQueue": "下载队列",
  "app.listAriaHistory": "历史任务",
  "stats.items": "{n} 项",
  "stats.downloading": "· {n} 下载中",
  "stats.completed": "· {n} 已完成",
  "task.fallback": "任务 #{id}",
  "probe.failedCount": "{n} 个链接解析失败：",

  // 输入区
  "url.placeholder": "每行输入一个视频链接，例如：\nhttps://www.youtube.com/watch?v=…",
  "url.aria": "视频链接，每行一个",
  "url.clear": "清空",
  "url.downloading": "下载中 {p}%",
  "url.processing": "处理中…",
  "url.download": "下载",
  "url.downloadN": "下载 ({n})",
  "url.parse": "解析",
  "url.parseN": "解析 ({n})",
  "url.stopping": "终止中…",
  "url.stop": "终止下载",

  // 平台墙
  "platform.aria": "支持的平台",
  "platform.introTitle": "支持主流音视频平台",
  "platform.introDesc": "粘贴视频链接，即可解析并下载",
  "platform.bilibili": "哔哩哔哩",
  "platform.xiaohongshu": "小红书",
  "platform.netease": "网易云音乐",
  "platform.weibo": "微博",

  // 队列列表
  "queue.empty": "粘贴一个链接，开始下载",
  "queue.colTitle": "标题",
  "queue.colType": "类型",
  "queue.colState": "状态",
  "queue.colAct": "操作",
  "queue.progress": "进度 {p}%",
  "queue.runningSub": "下载中 {size} · {speed} · 剩余 {eta}",
  "queue.stop": "停止",
  "queue.reveal": "在文件夹中显示",
  "queue.retry": "重试",
  "queue.logCollapse": "收起日志",
  "queue.logView": "查看日志",
  "queue.logRegion": "yt-dlp 输出",
  "queue.logEmpty": "(暂无输出)",
  "status.queued": "排队中",
  "status.running": "下载中",
  "status.completed": "已完成",
  "status.failed": "失败",
  "status.cancelled": "已取消",

  // 解析结果卡片
  "video.label": "视频",
  "video.quality": "选择清晰度",
  "video.noSubtitle": "暂无字幕",
  "subtitle.label": "字幕",
  "subtitle.format": "字幕格式",
  "audio.label": "仅音频",
  "audio.format": "音频格式",
  "cover.label": "封面图片",
  "cover.format": "图片格式",
  "card.collapse": "收起",
  "row.waiting": "等待中",
  "row.cancel": "取消",
  "row.approx": "约 {size}",
  "row.openFolder": "打开文件所在文件夹",
  "row.retry": "重试",
  "row.download": "下载",

  // 弹窗通用
  "common.close": "关闭",

  // 问题反馈
  "fb.title": "提交反馈",
  "fb.intro": "反馈建议或问题，即有机会获赠专属奖励，被采纳的反馈还能获得更多惊喜！",
  "fb.bugTitle": "报告问题",
  "fb.bugDesc": "功能未按预期运行",
  "fb.featureTitle": "功能建议",
  "fb.featureDesc": "希望新增或改进某个功能",
  "fb.descLabel": "问题描述",
  "fb.descPlaceholder": "请详细描述遇到的问题及复现步骤（例如：操作步骤、出现的现象等）",
  "fb.descRequired": "请先填写问题描述",
  "fb.descHint": "提供越详细的信息，可以帮助我们更快的修复问题",
  "fb.submit": "提交",
  "fb.doneTitle": "感谢你的反馈！",
  "fb.doneBug": "我们已收到你提交的问题报告，会尽快跟进处理。",
  "fb.doneFeature": "我们已收到你提交的功能建议，会尽快跟进处理。",
  "fb.close": "完成",

  // 设置
  "set.title": "设置",
  "set.tabGeneral": "常规",
  "set.tabNetwork": "网络",
  "set.tabAbout": "关于",
  "set.dirLabel": "保存目录",
  "set.dirChange": "更改目录",
  "dir.pickerTitle": "选择下载目录",
  "set.langLabel": "语言",
  "lang.system": "跟随系统",
  "lang.zh": "简体中文",
  "lang.en": "English",
  "set.themeLabel": "主题",
  "theme.system": "跟随系统",
  "theme.light": "浅色",
  "theme.dark": "深色",
  "set.autoLabel": "自动下载",
  "set.autoDesc": "解析链接后直接以下载最佳画质+音频，无需手动选择格式",
  "set.concLabel": "最大同时下载任务数",
  "set.concDesc": "同时运行的下载进程数量上限({min}~{max})，修改后立即生效",
  "set.dec": "减少",
  "set.inc": "增加",
  "set.proxyLabel": "代理类型",
  "proxy.none": "不使用代理",
  "proxy.http": "HTTP",
  "proxy.socks5": "SOCKS5",
  "set.proxyNote": "设置后，链接解析与下载都会经由该代理。",
  "set.proxyAddrLabel": "代理地址",
  "set.proxyAddrPlaceholder": "如 127.0.0.1:7890，也可填完整 URL",
  "set.proxyDetect": "自动探测本地代理",
  "set.proxyDetecting": "探测中…",
  "set.proxyDetectNone": "未在本地常见端口探测到代理，请手动填写。",
  "set.proxyEffective": "当前生效：{url}",
  "set.proxyInactive": "未使用代理。",
  "set.proxyAddrMissing": "请填写代理地址后才会生效。",
  "set.netTestTitle": "网络测试",
  "set.netTestStart": "开始测试",
  "set.netTestRunning": "测试中",
  "set.netTestNote": "按当前代理（未设置则直连）对各站点 443 端口做连通探测，仅测链路、不传输数据。",
  "about.version": "版本号",
  "about.components": "组件版本号",
  "about.website": "官网",
  "about.componentsNote": "组件版本号依次为 yt-dlp / FFmpeg。",
} as const;

export type TKey = keyof typeof zh;

const en: Record<TKey, string> = {
  "nav.mainAria": "Main navigation",
  "nav.download": "Downloads",
  "nav.history": "History",
  "menu.support": "Support",
  "menu.feedback": "Feedback",
  "menu.settings": "Settings",
  "account.title": "Sign in / Register",
  "account.aria": "Sign in",
  "account.notLoggedIn": "Sign in / Register",
  "account.clickToLogin": "Open your account",
  "account.plan": "Free",
  "account.personal": "Account",
  "account.setPassword": "Set password",
  "account.logout": "Sign out",
  "account.todo": "Coming soon",

  "auth.title": "Sign in to DownloadAny",
  "auth.subtitle": "Sign in to sync your account",
  "auth.registerTitle": "Create an account",
  "auth.verifyTitle": "Verify your email",
  "auth.verifyHint": "We sent a code to {email}",
  "auth.google": "Continue with Google",
  "auth.googleUnconfigured": "Configure VITE_GOOGLE_CLIENT_ID first",
  "auth.googleLoadFailed": "Unable to load Google Sign-In",
  "auth.orEmail": "or use email",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.passwordPlaceholder": "Enter your password",
  "auth.passwordHint": "At least 10 characters",
  "auth.code": "Email verification code",
  "auth.methodLabel": "Sign-in method",
  "auth.codeLogin": "Email code",
  "auth.passwordLogin": "Password",
  "auth.sendCode": "Send code",
  "auth.codeLoginButton": "Sign in / Register",
  "auth.codeLoginUnsupported": "Code verified, but the server does not yet provide an endpoint that exchanges it for login tokens",
  "auth.emailRequired": "Enter your email address",
  "auth.passwordRequired": "Enter your password",
  "auth.passwordLength": "Password must be at least 10 characters",
  "auth.codeInvalid": "Enter the 6-digit verification code",
  "auth.login": "Sign in",
  "auth.register": "Get code and register",
  "auth.verifyAndLogin": "Verify and sign in",
  "auth.resend": "Resend verification code",
  "auth.toRegister": "New here? Create an account",
  "auth.toLogin": "Already registered? Sign in",
  "auth.working": "Please wait…",

  "pwd.label": "Password",
  "pwd.confirmLabel": "Confirm password",
  "pwd.placeholder": "Enter password",
  "pwd.confirmPlaceholder": "Re-enter password",
  "pwd.show": "Show password",
  "pwd.hide": "Hide password",
  "pwd.required": "Please enter a password first",
  "pwd.mismatch": "Passwords do not match",
  "pwd.save": "Save",
  "pwd.doneTitle": "Password set successfully!",
  "pwd.doneDesc": "Front-end demo only — nothing was uploaded.",

  "fly.telegram": "Telegram Community",
  "fly.discord": "Discord Community",
  "fly.email": "Email",
  "fly.qq": "QQ Group",
  "fly.copied": "Copied to clipboard",

  "app.title": "Video / Audio Downloader",
  "app.historyTitle": "History",
  "app.probeAria": "Parse results",
  "app.listAriaQueue": "Download queue",
  "app.listAriaHistory": "Past tasks",
  "stats.items": "{n} items",
  "stats.downloading": "· {n} downloading",
  "stats.completed": "· {n} completed",
  "task.fallback": "Task #{id}",
  "probe.failedCount": "Failed to parse {n} link(s):",

  "url.placeholder": "Enter video links, one per line. Example:\nhttps://www.youtube.com/watch?v=…",
  "url.aria": "Video links, one per line",
  "url.clear": "Clear",
  "url.downloading": "Downloading {p}%",
  "url.processing": "Working…",
  "url.download": "Download",
  "url.downloadN": "Download ({n})",
  "url.parse": "Parse",
  "url.parseN": "Parse ({n})",
  "url.stopping": "Stopping…",
  "url.stop": "Stop",

  "platform.aria": "Supported platforms",
  "platform.introTitle": "Supports major video & music platforms",
  "platform.introDesc": "Paste a video link to parse and download",
  "platform.bilibili": "Bilibili",
  "platform.xiaohongshu": "Xiaohongshu",
  "platform.netease": "NetEase Cloud Music",
  "platform.weibo": "Weibo",

  "queue.empty": "Paste a link to start downloading",
  "queue.colTitle": "Title",
  "queue.colType": "Type",
  "queue.colState": "Status",
  "queue.colAct": "Actions",
  "queue.progress": "Progress {p}%",
  "queue.runningSub": "{size} · {speed} · {eta} left",
  "queue.stop": "Stop",
  "queue.reveal": "Show in folder",
  "queue.retry": "Retry",
  "queue.logCollapse": "Hide log",
  "queue.logView": "View log",
  "queue.logRegion": "yt-dlp output",
  "queue.logEmpty": "(no output yet)",
  "status.queued": "Queued",
  "status.running": "Downloading",
  "status.completed": "Completed",
  "status.failed": "Failed",
  "status.cancelled": "Cancelled",

  "video.label": "Video",
  "video.quality": "Select quality",
  "video.noSubtitle": "No subtitles",
  "subtitle.label": "Subtitles",
  "subtitle.format": "Subtitle format",
  "audio.label": "Audio only",
  "audio.format": "Audio format",
  "cover.label": "Cover image",
  "cover.format": "Image format",
  "card.collapse": "Dismiss",
  "row.waiting": "Waiting",
  "row.cancel": "Cancel",
  "row.approx": "≈ {size}",
  "row.openFolder": "Show file in folder",
  "row.retry": "Retry",
  "row.download": "Download",

  "common.close": "Close",

  "fb.title": "Submit Feedback",
  "fb.intro": "Share suggestions or issues for a chance to win exclusive rewards — adopted feedback earns even more!",
  "fb.bugTitle": "Report an issue",
  "fb.bugDesc": "Something isn't working as expected",
  "fb.featureTitle": "Suggest a feature",
  "fb.featureDesc": "Want a new or improved feature",
  "fb.descLabel": "Description",
  "fb.descPlaceholder": "Describe the issue and steps to reproduce (e.g. what you did, what happened)",
  "fb.descRequired": "Please describe the issue first",
  "fb.descHint": "More detail helps us fix problems faster",
  "fb.submit": "Submit",
  "fb.doneTitle": "Thanks for your feedback!",
  "fb.doneBug": "We've received your issue report and will follow up soon.",
  "fb.doneFeature": "We've received your feature suggestion and will follow up soon.",
  "fb.close": "Done",

  "set.title": "Settings",
  "set.tabGeneral": "General",
  "set.tabNetwork": "Network",
  "set.tabAbout": "About",
  "set.dirLabel": "Save location",
  "set.dirChange": "Change…",
  "dir.pickerTitle": "Choose download folder",
  "set.langLabel": "Language",
  "lang.system": "Follow system",
  "lang.zh": "简体中文", // 语言选项一律用本族语名称，不随界面语言翻译
  "lang.en": "English",
  "set.themeLabel": "Theme",
  "theme.system": "Follow system",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "set.autoLabel": "Auto download",
  "set.autoDesc": "After parsing, download best quality + audio directly without picking a format",
  "set.concLabel": "Max concurrent downloads",
  "set.concDesc": "Upper bound of download processes running at once ({min}~{max}); takes effect immediately",
  "set.dec": "Decrease",
  "set.inc": "Increase",
  "set.proxyLabel": "Proxy type",
  "proxy.none": "No proxy",
  "proxy.http": "HTTP",
  "proxy.socks5": "SOCKS5",
  "set.proxyNote": "Once set, both parsing and downloads go through this proxy.",
  "set.proxyAddrLabel": "Proxy address",
  "set.proxyAddrPlaceholder": "e.g. 127.0.0.1:7890 (full URL also accepted)",
  "set.proxyDetect": "Detect local proxy",
  "set.proxyDetecting": "Detecting…",
  "set.proxyDetectNone": "No proxy found on common local ports; enter one manually.",
  "set.proxyEffective": "Active: {url}",
  "set.proxyInactive": "No proxy in use.",
  "set.proxyAddrMissing": "Enter a proxy address to take effect.",
  "set.netTestTitle": "Connection test",
  "set.netTestStart": "Run tests",
  "set.netTestRunning": "Testing",
  "set.netTestNote": "Probes each site's port 443 through the current proxy (direct when unset); link check only, no data transfer.",
  "about.version": "Version",
  "about.components": "Component versions",
  "about.website": "Website",
  "about.componentsNote": "Component versions are yt-dlp / FFmpeg respectively.",
};

function systemLang(): Lang {
  return (navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveLang(pref: LangPref): Lang {
  return pref === "system" ? systemLang() : pref;
}

// ---- 模块级语言状态(全局一处,App 顶层订阅后整树重渲染) ----

const listeners = new Set<() => void>();
let currentPref: LangPref = "system";
let currentLang: Lang = resolveLang(currentPref);

export function setLangPref(pref: LangPref): void {
  if (pref === currentPref) return;
  currentPref = pref;
  currentLang = resolveLang(pref);
  listeners.forEach((l) => l());
}

export function getLangPref(): LangPref {
  return currentPref;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 订阅当前语言。只需在会因语言切换而重渲染的顶层(系统语言场景亦复用此订阅)调用。 */
export function useLang(): Lang {
  return useSyncExternalStore(
    subscribe,
    () => currentLang,
    () => "zh",
  );
}

/** 取当前 UI 语言(不订阅,仅读取)。 */
export function currentUiLang(): Lang {
  return currentLang;
}

export function t(key: TKey, args?: Record<string, string | number>): string {
  let s: string = (currentLang === "zh" ? zh : en)[key] ?? zh[key];
  if (args) {
    // split/join 等价于 replaceAll,兼容 tsconfig 的 ES2020 lib
    for (const [k, v] of Object.entries(args)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
