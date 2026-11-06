// 主题：浅色 / 深色 / 跟随系统。与 i18n 同构的模块级单例——偏好存 settings.json(见 lib/settings.ts)，
// 生效方式是把解析结果写入 <html data-theme>，App.css 靠 :root 与 :root[data-theme="dark"] 的令牌切换配色。

export type Theme = "light" | "dark";
export type ThemePref = "system" | Theme;

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let currentPref: ThemePref = "system";

export function resolveTheme(pref: ThemePref): Theme {
  if (pref === "system") return darkQuery.matches ? "dark" : "light";
  return pref;
}

function apply(): void {
  document.documentElement.dataset.theme = resolveTheme(currentPref);
}

// system 档下跟随 OS 实时切换；light/dark 档忽略系统事件
darkQuery.addEventListener("change", () => {
  if (currentPref === "system") apply();
});

export function setThemePref(pref: ThemePref): void {
  currentPref = pref;
  apply();
}

export function getThemePref(): ThemePref {
  return currentPref;
}

// 模块加载即按“跟随系统”兜底，避免 store 水合前第一帧没有主题标记
apply();
