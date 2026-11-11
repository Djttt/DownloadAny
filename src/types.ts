//! 与 Rust serde(camelCase) 结构一一对应的类型定义

export interface FormatOption {
  id: string;
  label: string;
  height?: number | null;
  ext?: string | null;
  filesize?: number | null;
}

export interface VideoInfo {
  id: string;
  title: string;
  duration?: number | null;
  thumbnail?: string | null;
  uploader?: string | null;
  webpageUrl?: string | null;
  formats: FormatOption[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  id: number;
  /** 持久化历史使用的跨会话唯一标识；当前运行任务没有该字段。 */
  historyId?: string;
  /** 写入本地历史的时间戳，用于跨会话排序。 */
  savedAt?: number;
  url: string;
  title: string;
  formatId: string;
  formatLabel: string;
  status: JobStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes?: number | null;
  speed?: number | null;
  eta?: number | null;
  outputPath?: string | null;
  error?: string | null;
}

// ---- 事件 payload ----

export interface StatusEvent {
  jobId: number;
  status: JobStatus;
  error?: string | null;
  outputPath?: string | null;
}

export interface ProgressEvent {
  jobId: number;
  percent: number;
  downloadedBytes: number;
  totalBytes?: number | null;
  speed?: number | null;
  eta?: number | null;
}

export interface DependencyInfo {
  ytDlpVersion?: string | null;
  ytDlpSource: string;
  ytDlpPath: string;
  ffmpegVersion?: string | null;
  ffmpegSource: string;
}

// ---- invoke 参数 ----

export interface DownloadOptions {
  url: string;
  formatId: string;
  outputDir: string;
  title?: string | null;
  formatLabel?: string | null;
  /** 代理 URL（含 scheme，由 settings.buildProxyUrl 组装）；null = 不走代理 */
  proxy?: string | null;
}

// ---- detect_proxy 返回（镜像 Rust ProxyCandidate）----

export interface ProxyCandidate {
  proxyType: string;
  addr: string;
}

// ---- test_site 返回（镜像 Rust SiteTestResult）----

export interface SiteTestResult {
  ok: boolean;
  error?: string | null;
  latencyMs: number;
}
