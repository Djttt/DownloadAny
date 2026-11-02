import { useState, type FormEvent } from "react";

interface Props {
  busy: boolean;
  autoMode: boolean;
  error: string | null;
  onSubmit: (url: string) => void;
}

/** 顶部链接输入：粘贴 → 居中大按钮（参考 SnapAny 的交互姿势） */
export function UrlBar({ busy, autoMode, error, onSubmit }: Props) {
  const [url, setUrl] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!busy && url.trim()) onSubmit(url.trim());
  }

  return (
    <form className="url-bar" onSubmit={submit}>
      <div className="url-field">
        <input
          type="url"
          value={url}
          placeholder="https://www.youtube.com/watch?v=…"
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          autoFocus
          aria-label="视频链接"
        />
        {url && (
          <button
            type="button"
            className="clear"
            aria-label="清空"
            onClick={() => setUrl("")}
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
      <button type="submit" className="big" disabled={busy || !url.trim()}>
        {busy ? (
          "处理中…"
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
            {autoMode ? "下载" : "解析"}
          </>
        )}
      </button>
      {error && (
        <div className="url-error" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}
