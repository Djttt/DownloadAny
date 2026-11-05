import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DependencyInfo,
  DownloadOptions,
  JobRecord,
  LogLineEvent,
  ProgressEvent,
  ProxyCandidate,
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

export const detectProxy = () => invoke<ProxyCandidate | null>("detect_proxy");

// ---- events ----

export const onJobStatus = (handler: (e: StatusEvent) => void) =>
  listen<StatusEvent>("job-status", (ev) => handler(ev.payload));

export const onJobProgress = (handler: (e: ProgressEvent) => void) =>
  listen<ProgressEvent>("job-progress", (ev) => handler(ev.payload));

export const onLogLine = (handler: (e: LogLineEvent) => void) =>
  listen<LogLineEvent>("log-line", (ev) => handler(ev.payload));
