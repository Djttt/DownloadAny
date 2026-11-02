import { useState } from "react";
import type { JobRecord, JobStatus } from "../types";
import { fmtBytes, fmtEta, fmtSpeed } from "../lib/format";
import { LogPanel } from "./LogPanel";

const STATUS_TEXT: Record<JobStatus, string> = {
  queued: "排队中",
  running: "下载中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

interface Props {
  jobs: JobRecord[];
  logs: Record<number, string[]>;
  onCancel: (jobId: number) => void;
}

export function QueueList({ jobs, logs, onCancel }: Props) {
  if (jobs.length === 0) {
    return <div className="empty">队列里还没有任务，解析一个链接开始下载吧</div>;
  }
  return (
    <div className="queue">
      {jobs.map((job) => (
        <QueueCard
          key={job.id}
          job={job}
          lines={logs[job.id] ?? []}
          onCancel={() => onCancel(job.id)}
        />
      ))}
    </div>
  );
}

function QueueCard({
  job,
  lines,
  onCancel,
}: {
  job: JobRecord;
  lines: string[];
  onCancel: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const active = job.status === "running" || job.status === "queued";
  const sizeText =
    job.totalBytes != null
      ? `${fmtBytes(job.downloadedBytes)} / ${fmtBytes(job.totalBytes)}`
      : fmtBytes(job.downloadedBytes);

  return (
    <div className={`job-card ${job.status}`}>
      <div className="job-head">
        <span className={`badge ${job.status}`}>{STATUS_TEXT[job.status]}</span>
        <span className="job-title" title={job.title}>
          {job.title}
        </span>
        <span className="fmt">{job.formatLabel}</span>
        {active && (
          <button className="danger" onClick={onCancel}>
            取消
          </button>
        )}
      </div>

      {job.status === "running" && (
        <>
          <div className="bar">
            <div
              className={job.totalBytes != null ? "bar-fill" : "bar-fill indeterminate"}
              style={{ width: `${Math.min(job.percent, 100)}%` }}
            />
          </div>
          <div className="job-stats">
            <span>{job.percent.toFixed(1)}%</span>
            <span>{sizeText}</span>
            <span>{fmtSpeed(job.speed)}</span>
            <span>剩余 {fmtEta(job.eta)}</span>
          </div>
        </>
      )}

      {job.status === "failed" && job.error && <div className="job-error">{job.error}</div>}
      {job.status === "completed" && job.outputPath && (
        <div className="job-done" title={job.outputPath}>
          已保存到 {job.outputPath}
        </div>
      )}

      <LogPanel lines={lines} open={logOpen} onToggle={() => setLogOpen(!logOpen)} />
    </div>
  );
}
