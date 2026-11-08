// DownloadAny UI 图标集 —— 与 Figma「DownloadAny Icons」文件逐一对应
// (https://www.figma.com/design/e4Qzn8UQK5TrZWGqpN7OPJ)
// 设计规范：48px 画布（= 24px 网格 2 倍）、描边 4（渲染 2px）、圆角端点/连接，
// 主色绑定 color/icon/primary —— 代码侧统一 currentColor，由使用处 CSS 控制颜色。
import type { CSSProperties, ReactNode } from "react";

const P = (d: string, extra?: { sw?: number }) => (
  <path
    d={d}
    strokeWidth={extra?.sw ?? 4}
    stroke="currentColor"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);
const F = (d: string, opacity = 1) => (
  <path d={d} fill="currentColor" stroke="none" opacity={opacity} />
);
const R = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  sw = 4,
  fill = "none",
) => (
  <rect
    x={x}
    y={y}
    width={w}
    height={h}
    rx={r}
    strokeWidth={sw}
    stroke="currentColor"
    fill={fill}
  />
);

const ICONS: Record<string, ReactNode> = {
  // —— 导航 / URL 栏 ——
  download: P("M24 6v22M13 19l11 11 11-11M8 34v6h32v-6"),
  history: (
    <>
      {P("M24 10a14 14 0 1 1-14 14")}
      {P("M24 17v7l6 4")}
      {P("M10 17v7h7", { sw: 3.5 })}
    </>
  ),
  probe: (
    <>
      {P("M28.4 28.4 38 38")}
      {P("M20 9a11 11 0 1 0 0 22 11 11 0 0 0 0-22Z")}
      {F("M16.5 15.5 25.5 20l-9 4.5Z", 0.2)}
    </>
  ),
  paste: (
    <>
      {R(10, 8, 28, 34, 4)}
      {R(18, 3, 12, 9, 3, 4, "var(--surface)")}
      {P("M24 18v12M18.5 24.5 24 30.5l5.5-6")}
    </>
  ),
  "download-go": (
    <>
      {F("M21.5 6h5v16h6L24 31.5 15.5 22h6Z")}
      {R(8, 36, 32, 6, 2.5, 0, "currentColor")}
    </>
  ),
  "auto-download": (
    <>
      {R(6, 16, 36, 16, 8)}
      {F("M29 24a4 4 0 1 1 8 0 4 4 0 1 1-8 0Z")}
      {P("M18 18 14 23.5h3l-4 6", { sw: 3 })}
    </>
  ),
  // —— 任务队列 / 状态 ——
  stop: (
    <>
      {F("M9 24a15 15 0 1 1 30 0 15 15 0 1 1-30 0Z", 0.12)}
      {P("M16.5 24h15M24 9a15 15 0 1 1 0 30 15 15 0 0 1 0-30Z", { sw: 3.5 })}
    </>
  ),
  retry: (
    <>
      {P("M38 24a14 14 0 1 1-14-14")}
      {F("M22.5 5.5 29 10l-6.5 4.5Z")}
    </>
  ),
  log: (
    <>
      {R(10, 6, 28, 36, 3)}
      {P("M16 15h16M16 22h11M16 29h14M23 35.5 26 38.5l3-3", { sw: 3 })}
    </>
  ),
  "folder-reveal": (
    <>
      {R(19, 5, 12, 12, 2, 4, "var(--surface)")}
      {P("M6 15h10l4 4h22v19H6Z")}
    </>
  ),
  success: (
    <>
      {P("M10 24a14 14 0 1 1 28 0 14 14 0 0 1-28 0Z", { sw: 3.5 })}
      {P("M15 24.5l6.5 6.5L33 18")}
    </>
  ),
  error: (
    <>
      {P("M10 24a14 14 0 1 1 28 0 14 14 0 0 1-28 0ZM24 13v11.5", { sw: 3.5 })}
      {F("M22 30.5a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z")}
    </>
  ),
  waiting: (
    <>
      {P("M10 24a14 14 0 1 1 28 0 14 14 0 0 1-28 0Z", { sw: 3 })}
      {F("M15 24a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z", 0.9)}
      {F("M22 24a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z", 0.55)}
      {F("M29 24a2 2 0 1 1 4 0 2 2 0 1 1-4 0Z", 0.25)}
    </>
  ),
  // —— 内容类型 / 设置 ——
  video: (
    <>
      {R(8, 18, 32, 22, 3)}
      {P("M8 18 12 9h30l-2 9M18.5 10 15.5 17M27.5 10 24.5 17M36.5 10 33.5 17", { sw: 3 })}
    </>
  ),
  audio: (
    <>
      {P("M11.5 34a4.5 4.5 0 0 1 9 0 4.5 4.5 0 0 1-9 0Z", { sw: 3.5 })}
      {P("M20.5 34V13L31 16.5M20.5 19.5 31 23")}
    </>
  ),
  subtitle: (
    <>
      {R(6, 13, 36, 22, 3)}
      {P("M12 20h16M12 27h12", { sw: 3.5 })}
    </>
  ),
  cover: (
    <>
      {R(7, 7, 34, 34, 3)}
      {P("M12 34 19.5 23 25 30l4.5-5 6.5 9", { sw: 3 })}
      {F("M28 15a3 3 0 0 1 6 0 3 3 0 0 1-6 0Z", 0.25)}
    </>
  ),
  settings: (
    <>
      {P(
        "M29.9 13.19c.15.13.33.23.52.3l7.2 2.65-1.3 7.57c-.04.2-.04.4 0 .6l1.3 7.56-7.2 2.66c-.19.07-.37.17-.52.3L24 39.72l-5.9-4.92c-.15-.13-.33-.23-.52-.3l-7.2-2.65 1.3-7.57c.03-.2.03-.4 0-.6l-1.3-7.56 7.2-2.66c.19-.07.37-.17.52-.3L24 8.28Z",
        { sw: 3.5 },
      )}
      {P("M17.5 24a6.5 6.5 0 0 1 13 0 6.5 6.5 0 0 1-13 0Z", { sw: 3.5 })}
    </>
  ),
  feedback: (
    <>
      {R(7, 10, 34, 24, 6)}
      {P("M15 33l-2 8 9-7M14 22h20", { sw: 3.5 })}
    </>
  ),
  theme: (
    <>
      {P("M11 24a13 13 0 0 1 26 0 13 13 0 0 1-26 0Z", { sw: 3.5 })}
      {F("M24 11a13 13 0 0 0 0 26Z", 0.18)}
      {P(
        "M32.25 9.71 34.5 5.81M38.29 15.75 42.19 13.5M40.5 24H45M38.29 32.25 42.19 34.5M32.25 38.29 34.5 42.19",
        { sw: 3.5 },
      )}
    </>
  ),
  // —— 应用图标负空间箭头（供品牌位/关于页使用）——
  "app-arrow": (
    <>
      {F("M21.5 6h5v16h6L24 31.5 15.5 22h6Z")}
      {R(8, 36, 32, 6, 3, 0, "currentColor")}
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, verticalAlign: "-2px", ...style }}
      aria-hidden
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
