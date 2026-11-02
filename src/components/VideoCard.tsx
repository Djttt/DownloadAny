import { useState } from "react";
import type { FormatOption, VideoInfo } from "../types";
import { fmtBytes, fmtDuration } from "../lib/format";

interface Props {
  video: VideoInfo;
  busy: boolean;
  onDownload: (format: FormatOption) => void;
  onDiscard: () => void;
}

/** 非自动模式下的格式选择条：横向、贴在输入区下方 */
export function FormatBar({ video, busy, onDownload, onDiscard }: Props) {
  const [formatId, setFormatId] = useState(video.formats[0]?.id ?? "");
  const selected = video.formats.find((f) => f.id === formatId);

  return (
    <div className="format-bar">
      {video.thumbnail && (
        <img className="thumb" src={video.thumbnail} alt="" referrerPolicy="no-referrer" />
      )}
      <div className="info">
        <div className="t" title={video.title}>
          {video.title}
        </div>
        <div className="m">
          {[video.uploader, fmtDuration(video.duration)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <select
        value={formatId}
        onChange={(e) => setFormatId(e.target.value)}
        aria-label="格式"
      >
        {video.formats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
            {f.filesize ? ` · 约 ${fmtBytes(f.filesize)}` : ""}
          </option>
        ))}
      </select>
      <button className="go" disabled={busy || !selected} onClick={() => selected && onDownload(selected)}>
        下载
      </button>
      <button className="clear" aria-label="收起" onClick={onDiscard}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
