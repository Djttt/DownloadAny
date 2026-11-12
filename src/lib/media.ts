import type { VideoInfo } from "../types";
import { apiRequest, currentAccessToken } from "./auth";

/**
 * 元数据解析在服务端执行；桌面端仅保留本地 yt-dlp 下载能力。
 * 调用方在解析前已经通过 restoreUser 刷新登录态。
 */
export function parseVideo(url: string): Promise<VideoInfo> {
  const token = currentAccessToken();
  if (!token) throw new Error("登录状态已失效，请重新登录");
  return apiRequest<VideoInfo>(
    "/api/media/parse",
    { method: "POST", body: JSON.stringify({ url }) },
    token,
  );
}
