import { getVersion } from "@tauri-apps/api/app";
import { load } from "@tauri-apps/plugin-store";
import { currentAccessToken } from "./auth";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "")
  ?? "http://127.0.0.1:8000";
const DEVICE_ID_KEY = "analyticsDeviceId";
const CLIENT_SESSION_ID = crypto.randomUUID();
const onceEvents = new Set<AnalyticsEventType>();

export type AnalyticsEventType =
  | "app_open"
  | "parse_requested"
  | "parse_succeeded"
  | "parse_failed"
  | "download_started"
  | "download_completed"
  | "download_failed"
  | "download_cancelled"
  | "screen_view"
  | "dialog_opened"
  | "setting_changed"
  | "parse_blocked"
  | "login_succeeded"
  | "signup_succeeded"
  | "feedback_submitted"
  | "download_cancel_requested"
  | "download_enqueue_failed";

export interface AnalyticsEventData {
  mediaId?: string;
  mediaTitle?: string;
  mediaUrl?: string;
  formatId?: string;
  formatLabel?: string;
  error?: string;
}

interface AnalyticsContext {
  deviceId: string;
  appVersion: string;
  platform: string;
}

let contextPromise: Promise<AnalyticsContext> | null = null;

/** 一次运行只记录一次启动，避免 React StrictMode 重放副作用导致重复。 */
export function trackAnalyticsEventOnce(eventType: AnalyticsEventType): void {
  if (onceEvents.has(eventType)) return;
  onceEvents.add(eventType);
  void trackAnalyticsEvent(eventType);
}

export function analyticsContext(): Promise<AnalyticsContext> {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    let deviceId: string = crypto.randomUUID();
    try {
      const settings = await load("settings.json", { autoSave: true });
      const saved = await settings.get<string>(DEVICE_ID_KEY);
      if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved)) {
        deviceId = saved;
      } else {
        await settings.set(DEVICE_ID_KEY, deviceId);
      }
    } catch {
      // 存储不可用时使用本次运行的临时标识。
    }
    const appVersion = await getVersion().catch(() => "");
    return { deviceId, appVersion, platform: navigator.platform || "unknown" };
  })();
  return contextPromise;
}

/**
 * 非阻塞、尽力而为的产品统计。任何网络或服务端错误都不会影响解析和下载。
 */
export async function trackAnalyticsEvent(
  eventType: AnalyticsEventType,
  data: AnalyticsEventData = {},
): Promise<void> {
  try {
    const context = await analyticsContext();
    const token = currentAccessToken();
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    await fetch(`${API_BASE}/api/analytics/events`, {
      method: "POST",
      headers,
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        event_id: crypto.randomUUID(),
        event_type: eventType,
        device_id: context.deviceId,
        client_session_id: CLIENT_SESSION_ID,
        app_version: context.appVersion,
        platform: context.platform,
        media_id: data.mediaId,
        media_url: data.mediaUrl ? new URL(data.mediaUrl).origin + "/" : undefined,
        format_id: data.formatId,
        format_label: data.formatLabel,
        error: data.error?.slice(0, 2000),
      }),
    });
  } catch {
    // 统计不是核心功能，离线或后端异常时静默跳过。
  }
}
