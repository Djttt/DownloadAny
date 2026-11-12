import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DependencyInfo,
  DownloadOptions,
  JobRecord,
  McpStatus,
  ProgressEvent,
  ProxyCandidate,
  SiteTestResult,
  StatusEvent,
  VideoInfo,
} from "../types";

export type { UnlistenFn };

// ---- commands ----

export const probeVideo = (url: string, proxy: string | null) =>
  invoke<VideoInfo>("probe_video", { url, proxy });

export const enqueueDownload = (options: DownloadOptions) =>
  invoke<number>("enqueue_download", { options });

export const cancelDownload = (jobId: number) =>
  invoke<void>("cancel_download", { jobId });

export const listJobs = () => invoke<JobRecord[]>("list_jobs");

export const setMaxConcurrency = (n: number) => invoke<void>("set_max_concurrency", { n });

export const openDownloadLocation = (filePath: string, fallbackDir: string) =>
  invoke<void>("open_download_location", { filePath, fallbackDir });

export const dependencyInfo = () => invoke<DependencyInfo>("dependency_info");

// Agent 接入（内置 MCP 服务）
export const mcpStatus = () => invoke<McpStatus>("mcp_status");
export const setMcpEnabled = (on: boolean) => invoke<McpStatus>("set_mcp_enabled", { on });

export const detectProxy = () => invoke<ProxyCandidate | null>("detect_proxy");

export interface GoogleAuthorizationCode {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export const googleOAuthLogin = (clientId: string) =>
  invoke<GoogleAuthorizationCode>("google_oauth_login", { clientId });

export const testSite = (site: string, proxy: string | null) =>
  invoke<SiteTestResult>("test_site", { site, proxy });

export interface ComponentUpdateResult {
  updated: boolean;
  version: string;
}

export const updateYtdlpComponent = (channel: "stable" | "beta", deviceId: string) =>
  invoke<ComponentUpdateResult>("update_ytdlp_component", { channel, deviceId });

// ---- events ----

export const onJobStatus = (handler: (e: StatusEvent) => void) =>
  listen<StatusEvent>("job-status", (ev) => handler(ev.payload));

export const onJobProgress = (handler: (e: ProgressEvent) => void) =>
  listen<ProgressEvent>("job-progress", (ev) => handler(ev.payload));
