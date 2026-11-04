import {
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import { t } from "../lib/i18n";

interface Props {
  value: string;
  busy: boolean;
  autoMode: boolean;
  downloadProgress?: number | null;
  cancelling?: boolean;
  error: string | null;
  onValueChange: (value: string) => void;
  onSubmit: (urls: string[]) => void;
  onCancelDownload?: () => void;
}

/** 顶部链接输入：粘贴 → 居中大按钮（参考 SnapAny 的交互姿势） */
export function UrlBar({
  busy,
  value,
  autoMode,
  downloadProgress,
  cancelling,
  error,
  onValueChange,
  onSubmit,
  onCancelDownload,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const urls = Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!busy && urls.length) onSubmit(urls);
  }

  function placeCursor(value: string, position: number) {
    onValueChange(value);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const textarea = e.currentTarget;
    const pasted = e.clipboardData.getData("text").replace(/\r\n?/g, "\n");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const suffix = pasted.endsWith("\n") ? "" : "\n";
    const nextValue = value.slice(0, start) + pasted + suffix + value.slice(end);
    placeCursor(nextValue, start + pasted.length + suffix.length);
  }

  function handleBlankAreaClick(e: MouseEvent<HTMLTextAreaElement>) {
    if (!value || value.endsWith("\n")) return;

    const textarea = e.currentTarget;
    const style = getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const paddingTop = Number.parseFloat(style.paddingTop);
    const clickY = e.clientY - textarea.getBoundingClientRect().top + textarea.scrollTop;
    const contentBottom = paddingTop + value.split(/\r?\n/).length * lineHeight;

    if (clickY <= contentBottom) return;
    e.preventDefault();
    placeCursor(`${value}\n`, value.length + 1);
  }

  return (
    <form className="url-bar" onSubmit={submit}>
      <div className="url-field">
        <textarea
          ref={textareaRef}
          value={value}
          placeholder={t("url.placeholder")}
          onChange={(e) => onValueChange(e.target.value)}
          onPaste={handlePaste}
          onMouseDown={handleBlankAreaClick}
          disabled={busy}
          autoFocus
          wrap="off"
          rows={Math.min(Math.max(value.split(/\r?\n/).length, 2), 5)}
          aria-label={t("url.aria")}
        />
        {value && (
          <button
            type="button"
            className="clear"
            aria-label={t("url.clear")}
            onClick={() => onValueChange("")}
            disabled={busy}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="url-actions">
        <button
          type="submit"
          className={`big${downloadProgress != null ? " downloading" : ""}`}
          disabled={busy || urls.length === 0}
        >
          {downloadProgress != null ? (
            <>
              <svg className="button-progress" viewBox="0 0 20 20" aria-hidden>
                <circle className="button-progress-track" cx="10" cy="10" r="8" />
                <circle
                  className="button-progress-value"
                  cx="10"
                  cy="10"
                  r="8"
                  style={{ strokeDashoffset: 50.27 * (1 - downloadProgress / 100) }}
                />
              </svg>
              {t("url.downloading", { p: Math.round(downloadProgress) })}
            </>
          ) : busy ? (
            t("url.processing")
          ) : (
            <>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  d="M8 2.5v7m0 0L5.2 6.7M8 9.5l2.8-2.8M3 12.5h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              {autoMode
                ? urls.length > 1
                  ? t("url.downloadN", { n: urls.length })
                  : t("url.download")
                : urls.length > 1
                  ? t("url.parseN", { n: urls.length })
                  : t("url.parse")}
            </>
          )}
        </button>
        {downloadProgress != null && onCancelDownload && (
          <button
            type="button"
            className="stop-auto-download"
            disabled={cancelling}
            onClick={onCancelDownload}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
              <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" />
            </svg>
            {cancelling ? t("url.stopping") : t("url.stop")}
          </button>
        )}
      </div>
      {error && (
        <div className="url-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
