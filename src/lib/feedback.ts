import { analyticsContext } from "./analytics";
import { currentAccessToken } from "./auth";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000";

export const FEEDBACK_MAX_LENGTH = 300;

export class FeedbackError extends Error {
  constructor(readonly status: number) {
    super(`feedback request failed: HTTP ${status}`);
  }
}

/** 问题反馈上报：失败由调用方展示（与 analytics 的"静默吞错"相反——反馈要给用户交代）。 */
export async function submitFeedback(kind: "bug" | "feature", text: string): Promise<void> {
  const context = await analyticsContext();
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-DownloadAny-Device-Id": context.deviceId,
  });
  const token = currentAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}/api/feedback`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      kind,
      text,
      app_version: context.appVersion,
      platform: context.platform,
    }),
  });
  if (!response.ok) throw new FeedbackError(response.status);
}
