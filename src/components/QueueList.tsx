import { useState } from "react";
import type { JobRecord } from "../types";
import { fmtBytes, fmtEta, fmtSpeed } from "../lib/format";
import { openDownloadLocation } from "../lib/tauri";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";

const STATUS_TEXT = {
  queued: "status.queued",
  running: "status.running",
  completed: "status.completed",
  failed: "status.failed",
  cancelled: "status.cancelled",
} as const;

interface Props {
  jobs: JobRecord[];
  logs: Record<number, string[]>;
  outputDir: string;
  onCancel: (id: number) => void;
  onRetry: (job: JobRecord) => void;
}

/** 队列列表：# / 标题+状态子行 / 类型 / 进度 / 动作（参考图的表式布局） */
export function QueueList({ jobs, logs, outputDir, onCancel, onRetry }: Props) {
  if (jobs.length === 0) {
    return <div className="empty">{t("queue.empty")}</div>;
  }
  return (
    <div className="table" role="table">
      <div className="thead" role="row">
        <span className="c-idx">#</span>
        <span className="c-title">{t("queue.colTitle")}</span>
        <span className="c-type">{t("queue.colType")}</span>
        <span className="c-state">{t("queue.colState")}</span>
        <span className="c-act">{t("queue.colAct")}</span>
      </div>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} lines={logs[job.id] ?? []} outputDir={outputDir} onCancel={onCancel} onRetry={onRetry} />
      ))}
    </div>
  );
}

function JobRow({
  job,
  lines,
  outputDir,
  onCancel,
  onRetry,
}: {
  job: JobRecord;
  lines: string[];
  outputDir: string;
  onCancel: (id: number) => void;
  onRetry: (job: JobRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = job.status === "running" || job.status === "queued";

  // 状态子行：这张表的签名细节——一行里同时讲完"是什么阶段、到什么程度"
  let sub: string | null = null;
  if (job.status === "running") {
    const size =
      job.totalBytes != null
        ? `${fmtBytes(job.downloadedBytes)} / ${fmtBytes(job.totalBytes)}`
        : fmtBytes(job.downloadedBytes);
    sub = t("queue.runningSub", { size, speed: fmtSpeed(job.speed), eta: fmtEta(job.eta) });
  } else if (job.status === "failed" && job.error) sub = job.error;
  else if (job.status === "completed" && job.outputPath) sub = job.outputPath;

  return (
    <div className={`row ${job.status}`} role="row">
      <span className="c-idx" aria-hidden>
        {job.id + 1}
      </span>
      <span className="c-title" title={job.title}>
        <span className="t">{job.title}</span>
        {sub && <span className="s">{sub}</span>}
      </span>
      <span className="c-type">
        <span className={`chip ${job.status}`}>{job.formatLabel || t(STATUS_TEXT[job.status])}</span>
      </span>
      <span className="c-state">
        {job.status === "running" && (
          <span className="bar" aria-label={t("queue.progress", { p: job.percent.toFixed(0) })}>
            <span
              className={job.totalBytes != null ? "fill" : "fill indeterminate"}
              style={{ width: `${Math.min(job.percent, 100)}%` }}
            />
          </span>
        )}
        <span className={`st ${job.status}`}>{t(STATUS_TEXT[job.status])}</span>
      </span>
      <span className="c-act">
        {active && (
          <button className="icon" aria-label={t("queue.stop")} title={t("queue.stop")} onClick={() => onCancel(job.id)}>
            <Icon name="stop" size={13} />
          </button>
        )}
        {job.status === "completed" && (job.outputPath || outputDir) && (
          <button
            className="icon"
            aria-label={t("queue.reveal")}
            title={t("queue.reveal")}
            onClick={() => openDownloadLocation(job.outputPath ?? "", outputDir).catch(console.error)}
          >
            <Icon name="folder-reveal" size={14} />
          </button>
        )}
        {(job.status === "failed" || job.status === "cancelled") && (
          <button className="icon" aria-label={t("queue.retry")} title={t("queue.retry")} onClick={() => onRetry(job)}>
            <Icon name="retry" size={14} />
          </button>
        )}
        <button
          className="icon"
          aria-label={open ? t("queue.logCollapse") : t("queue.logView")}
          aria-expanded={open}
          title={open ? t("queue.logCollapse") : t("queue.logView")}
          onClick={() => setOpen(!open)}
        >
          <Icon name="log" size={14} />
        </button>
      </span>
      {open && (
        <pre className="logline" role="region" aria-label={t("queue.logRegion")}>
          {lines.length === 0 ? t("queue.logEmpty") : lines.join("\n")}
        </pre>
      )}
    </div>
  );
}
