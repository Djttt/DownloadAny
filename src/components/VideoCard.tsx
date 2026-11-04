import { useEffect, useMemo, useRef, useState } from "react";
import type { FormatOption, JobRecord, VideoInfo } from "../types";
import { fmtBytes, fmtDuration, fmtSpeed } from "../lib/format";
import { openDownloadLocation } from "../lib/tauri";
import { t } from "../lib/i18n";

const AUDIO_FORMATS: FormatOption[] = [
  { id: "__audio_mp3__", label: "MP3" },
  { id: "__audio_m4a__", label: "M4A" },
  { id: "__audio_wav__", label: "WAV" },
];

const IMAGE_FORMATS: FormatOption[] = [
  { id: "__thumbnail_jpg__", label: "JPG" },
  { id: "__thumbnail_png__", label: "PNG" },
  { id: "__thumbnail_webp__", label: "WebP" },
];

const SUBTITLE_FORMAT: FormatOption = { id: "__subtitles__", label: "SRT" };

interface Props {
  video: VideoInfo;
  busy: boolean;
  outputDir: string;
  jobs: Record<number, JobRecord>;
  onDownload: (format: FormatOption) => Promise<number | undefined>;
  onCancel: (id: number) => void;
  onDiscard: () => void;
}

type RowKind = "video" | "audio" | "image" | "subtitle";

export function FormatBar({ video, busy, outputDir, jobs, onDownload, onCancel, onDiscard }: Props) {
  const videoFormats = useMemo(
    () =>
      video.formats.filter(
        (f) => !f.id.startsWith("__") || f.id.startsWith("__video_"),
      ),
    [video.formats],
  );
  const [selected, setSelected] = useState<Record<RowKind, string>>({
    video: videoFormats[0]?.id ?? "",
    audio: AUDIO_FORMATS[0].id,
    image: IMAGE_FORMATS[0].id,
    subtitle: SUBTITLE_FORMAT.id,
  });
  const [rowJobs, setRowJobs] = useState<Partial<Record<RowKind, number>>>({});
  const subtitleFormats = video.formats.some((format) => format.id === SUBTITLE_FORMAT.id)
    ? [SUBTITLE_FORMAT]
    : [];

  async function start(kind: RowKind, options: FormatOption[]) {
    const format = options.find((item) => item.id === selected[kind]);
    if (!format) return;
    const id = await onDownload(format);
    if (id != null) setRowJobs((current) => ({ ...current, [kind]: id }));
  }

  return (
    <div className="format-panel">
      <div className="video-summary">
        {video.thumbnail && (
          <div className="video-thumb-wrap">
            <img className="thumb" src={video.thumbnail} alt="" referrerPolicy="no-referrer" />
            {video.duration != null && <span className="video-duration">{fmtDuration(video.duration)}</span>}
          </div>
        )}
      </div>

      <div className="download-options">
        <DownloadRow
          label={t("video.label")}
          selectLabel={t("video.quality")}
          options={videoFormats}
          value={selected.video}
          job={rowJobs.video == null ? undefined : jobs[rowJobs.video]}
          busy={busy}
          outputDir={outputDir}
          showSelectedSize
          onChange={(value) => setSelected((current) => ({ ...current, video: value }))}
          onDownload={() => start("video", videoFormats)}
          onCancel={onCancel}
        />
        <DownloadRow
          label={t("subtitle.label")}
          selectLabel={t("subtitle.format")}
          options={subtitleFormats}
          value={selected.subtitle}
          job={rowJobs.subtitle == null ? undefined : jobs[rowJobs.subtitle]}
          busy={busy}
          outputDir={outputDir}
          onChange={(value) => setSelected((current) => ({ ...current, subtitle: value }))}
          onDownload={() => start("subtitle", subtitleFormats)}
          onCancel={onCancel}
        />
        <DownloadRow
          label={t("audio.label")}
          selectLabel={t("audio.format")}
          options={AUDIO_FORMATS}
          value={selected.audio}
          job={rowJobs.audio == null ? undefined : jobs[rowJobs.audio]}
          busy={busy}
          outputDir={outputDir}
          onChange={(value) => setSelected((current) => ({ ...current, audio: value }))}
          onDownload={() => start("audio", AUDIO_FORMATS)}
          onCancel={onCancel}
        />
        <DownloadRow
          label={t("cover.label")}
          selectLabel={t("cover.format")}
          options={IMAGE_FORMATS}
          value={selected.image}
          job={rowJobs.image == null ? undefined : jobs[rowJobs.image]}
          busy={busy || !video.thumbnail}
          outputDir={outputDir}
          onChange={(value) => setSelected((current) => ({ ...current, image: value }))}
          onDownload={() => start("image", IMAGE_FORMATS)}
          onCancel={onCancel}
        />
      </div>

      <button className="format-close clear" aria-label={t("card.collapse")} onClick={onDiscard}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function DownloadRow({
  label,
  selectLabel,
  options,
  value,
  job,
  busy,
  outputDir,
  onChange,
  onDownload,
  onCancel,
  showSelectedSize = false,
}: {
  label: string;
  selectLabel: string;
  options: FormatOption[];
  value: string;
  job?: JobRecord;
  busy: boolean;
  outputDir: string;
  onChange: (value: string) => void;
  onDownload: () => void;
  onCancel: (id: number) => void;
  showSelectedSize?: boolean;
}) {
  const active = job?.status === "queued" || job?.status === "running";
  const status =
    job?.status === "failed"
        ? t("status.failed")
        : job?.status === "cancelled"
          ? t("status.cancelled")
          : null;
  const selectedOption = options.find((option) => option.id === value);

  return (
    <div className="download-row">
      <strong>{label}</strong>
      {active ? (
        <div className="active-download">
          <div className="inline-progress">
            <span
              className={job?.status === "queued" ? "waiting" : ""}
              style={{ width: `${Math.max(job?.percent ?? 0, 3)}%` }}
            />
          </div>
          <em>
            {job?.status === "queued"
              ? t("row.waiting")
              : `${(job?.percent ?? 0).toFixed(0)}% · ${fmtSpeed(job?.speed)}`}
          </em>
          <button className="cancel-download" onClick={() => job && onCancel(job.id)}>
            {t("row.cancel")}
          </button>
        </div>
      ) : (
        <>
          <div className="format-choice">
            <FormatSelect
              value={value}
              options={options}
              label={selectLabel}
              onChange={onChange}
            />
            {showSelectedSize && selectedOption?.filesize && (
              <span>{t("row.approx", { size: fmtBytes(selectedOption.filesize) })}</span>
            )}
          </div>
          <div className="inline-download">
            {status && <em className={job?.status}>{status}</em>}
            {job?.status === "completed" ? (
              <button
                type="button"
                className="row-download folder-open"
                disabled={!outputDir && !job.outputPath}
                aria-label={t("row.openFolder")}
                title={t("row.openFolder")}
                onClick={() => {
                  openDownloadLocation(job.outputPath ?? "", outputDir).catch(console.error);
                }}
              >
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                  <path
                    d="M2.75 6.25V5.4c0-1.05.85-1.9 1.9-1.9H7.3l1.65 1.85h6.4c1.05 0 1.9.85 1.9 1.9v6.35c0 1.05-.85 1.9-1.9 1.9H4.65a1.9 1.9 0 0 1-1.9-1.9V6.25Zm0 0h14.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : (
              <button
                className="row-download"
                disabled={busy || options.length === 0}
                onClick={onDownload}
              >
                {job?.status === "failed" ? t("row.retry") : t("row.download")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FormatSelect({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: FormatOption[];
  label: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className={`format-select${open ? " open" : ""}`} ref={root}>
      <button
        type="button"
        className="format-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={options.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span>{selected?.label ?? t("video.noSubtitle")}</span>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="format-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={option.id === value ? "selected" : ""}
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.id === value && (
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
                  <path d="m3.5 8.2 2.8 2.8 6.2-6.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
