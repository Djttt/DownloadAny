import { useState } from "react";
import type { FormatOption, VideoInfo } from "../types";
import { fmtBytes, fmtDuration } from "../lib/format";

interface Props {
  video: VideoInfo;
  downloading: boolean;
  onDownload: (format: FormatOption) => void;
}

export function VideoCard({ video, downloading, onDownload }: Props) {
  const [formatId, setFormatId] = useState(video.formats[0]?.id ?? "");
  const selected = video.formats.find((f) => f.id === formatId);

  return (
    <div className="video-card">
      {video.thumbnail && (
        <img className="thumb" src={video.thumbnail} alt="" referrerPolicy="no-referrer" />
      )}
      <div className="video-meta">
        <h3 title={video.title}>{video.title}</h3>
        <p className="sub">
          {[video.uploader, fmtDuration(video.duration)].filter(Boolean).join(" · ")}
        </p>
        <div className="row">
          <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
            {video.formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
                {f.filesize ? ` · 约 ${fmtBytes(f.filesize)}` : ""}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={downloading || !selected}
            onClick={() => selected && onDownload(selected)}
          >
            {downloading ? "加入队列…" : "下载"}
          </button>
        </div>
      </div>
    </div>
  );
}
