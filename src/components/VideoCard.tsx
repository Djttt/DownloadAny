import { useEffect, useMemo, useRef, useState } from "react";
import type { FormatOption, JobRecord, VideoInfo } from "../types";
import { fmtBytes, fmtDuration, fmtSpeed } from "../lib/format";
import { openDownloadLocation } from "../lib/tauri";
import { t } from "../lib/i18n";
import { describeError } from "../lib/errorHint";
import { Icon, type IconName } from "./Icon";

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

interface Props {
  video: VideoInfo;
  busy: boolean;
  outputDir: string;
  jobs: Record<number, JobRecord>;
  onDownload: (format: FormatOption, urlOverride?: string, titleSuffix?: string) => Promise<number | undefined>;
  onCancel: (id: number) => void;
  onDiscard: () => void;
}

export function FormatBar({ video, busy, outputDir, jobs, onDownload, onCancel, onDiscard }: Props) {
  const videoFormats = useMemo(() => {
    const explicitFormats = video.formats.filter(
      (format) => !format.id.startsWith("__") || format.id.startsWith("__video_"),
    );
    if (explicitFormats.length > 0) return explicitFormats;

    // Some extractors do not expose a numeric resolution. Keep yt-dlp's
    // automatic best-format selector only as a last-resort download option.
    return video.formats.filter((format) => format.id === "__best__");
  }, [video.formats]);
  const subtitleLanguages = useMemo(
    () => video.formats.filter((format) => format.id.startsWith("__subtitle_")),
    [video.formats],
  );
  const galleryImages = video.images ?? [];
  const isGallery = galleryImages.length > 0;
  const [selected, setSelected] = useState<Record<string, string>>({
    video: videoFormats[0]?.id ?? "",
    audio: AUDIO_FORMATS[0].id,
    image: IMAGE_FORMATS[0].id,
    subtitle: subtitleLanguages[0]?.id ?? "",
    ...Object.fromEntries(galleryImages.map((_, index) => [`gallery-${index}`, "__direct_image__"])),
  });
  const [rowJobs, setRowJobs] = useState<Partial<Record<string, number>>>({});

  async function start(
    kind: string,
    options: FormatOption[],
    urlOverride?: string,
    titleSuffix?: string,
  ) {
    const format = options.find((item) => item.id === selected[kind]);
    if (!format) return;
    const id = await onDownload(format, urlOverride, titleSuffix);
    if (id != null) setRowJobs((current) => ({ ...current, [kind]: id }));
  }

  return (
    <div className={`format-panel${isGallery ? " gallery-panel" : ""}`}>
      {!isGallery && (
        <div className="video-summary">
          {video.thumbnail && (
            <div className="video-thumb-wrap">
              <img className="thumb" src={video.thumbnail} alt="" referrerPolicy="no-referrer" />
              {video.duration != null && <span className="video-duration">{fmtDuration(video.duration)}</span>}
            </div>
          )}
        </div>
      )}

      <div className="download-options">
        {galleryImages.map((image, index) => {
          const kind = `gallery-${index}`;
          const options: FormatOption[] = [
            { id: "__direct_image__", label: t("image.original"), ext: image.ext },
          ];
          return (
            <DownloadRow
              key={image.id || kind}
              label={image.label || t("image.numbered", { n: index + 1 })}
              icon="cover"
              selectLabel={t("cover.format")}
              options={options}
              value={selected[kind]}
              job={rowJobs[kind] == null ? undefined : jobs[rowJobs[kind]!]}
              busy={busy}
              outputDir={outputDir}
              onChange={(value) => setSelected((current) => ({ ...current, [kind]: value }))}
              onDownload={() => start(kind, options, image.url, image.label)}
              onCancel={onCancel}
            />
          );
        })}
        {!isGallery && (
          <DownloadRow
            label={t("video.label")}
            icon="video"
            selectLabel={t("video.quality")}
            options={videoFormats}
            value={selected.video}
            job={rowJobs.video == null ? undefined : jobs[rowJobs.video]}
            busy={busy}
            outputDir={outputDir}
            emptyLabel={t("video.noFormat")}
            showSelectedSize
            onChange={(value) => setSelected((current) => ({ ...current, video: value }))}
            onDownload={() => start("video", videoFormats)}
            onCancel={onCancel}
          />
        )}
        {!isGallery && (
          <DownloadRow
            label={t("subtitle.label")}
            icon="subtitle"
            selectLabel={t("subtitle.language")}
            options={subtitleLanguages}
            value={selected.subtitle}
            job={rowJobs.subtitle == null ? undefined : jobs[rowJobs.subtitle]}
            busy={busy}
            outputDir={outputDir}
            emptyLabel={t("video.noSubtitle")}
            onChange={(value) => setSelected((current) => ({ ...current, subtitle: value }))}
            onDownload={() => start("subtitle", subtitleLanguages)}
            onCancel={onCancel}
          />
        )}
        {!isGallery && (
          <DownloadRow
            label={t("audio.label")}
            icon="audio"
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
        )}
        {!isGallery && (
          <DownloadRow
            label={t("cover.label")}
            icon="cover"
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
        )}
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
  icon,
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
  emptyLabel,
}: {
  label: string;
  icon: IconName;
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
  emptyLabel?: string;
}) {
  const active = job?.status === "queued" || job?.status === "running";
  const hasProgress = Boolean(
    job?.status === "running"
      && ((job.percent ?? 0) > 0 || job.downloadedBytes > 0 || (job.speed ?? 0) > 0),
  );
  const progressText = hasProgress
    ? `${(job?.percent ?? 0).toFixed(0)}%${(job?.speed ?? 0) > 0 ? ` · ${fmtSpeed(job?.speed)}` : ""}`
    : job?.status === "queued"
      ? t("row.waiting")
      : t("row.preparing");
  const status =
    job?.status === "failed"
        ? t("status.failed")
        : job?.status === "cancelled"
          ? t("status.cancelled")
          : null;
  const selectedOption = options.find((option) => option.id === value);
  const failDesc =
    job?.status === "failed" && job.error ? describeError(job.error, "download") : null;

  return (
    <div className="download-row">
      <strong>
        <Icon name={icon} size={14} style={{ marginRight: 6, color: "var(--ink-soft)" }} />
        {label}
      </strong>
      {active ? (
        <div className="active-download">
          <div className="inline-progress">
            <span
              className={!hasProgress ? "waiting" : ""}
              style={hasProgress ? { width: `${Math.min(job?.percent ?? 0, 100)}%` } : undefined}
            />
          </div>
          <em>{progressText}</em>
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
              emptyLabel={emptyLabel}
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
                <Icon name="folder-reveal" size={18} />
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
      {failDesc && (
        <div className="download-error" role="alert" title={failDesc.detail ?? undefined}>
          {failDesc.message}
          {failDesc.detail && (
            <details>
              <summary>{t("err.rawToggle")}</summary>
              <pre>{failDesc.detail}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function FormatSelect({
  value,
  options,
  label,
  emptyLabel,
  onChange,
}: {
  value: string;
  options: FormatOption[];
  label: string;
  emptyLabel?: string;
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
        <span>{selected?.label ?? emptyLabel ?? t("video.noFormat")}</span>
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
