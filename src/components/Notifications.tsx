import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";

export interface AppNotice {
  id: number;
  type: "success" | "error" | "info";
  title: string;
  text?: string;
}

function Notification({ notice, onRemove }: { notice: AppNotice; onRemove: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismissTimer = useRef(0);
  const paused = hovered || focused;

  function dismiss() { setLeaving(true); }

  useEffect(() => {
    if (paused || leaving) return;
    dismissTimer.current = window.setTimeout(dismiss, notice.type === "error" ? 8000 : 5000);
    return () => window.clearTimeout(dismissTimer.current);
  }, [paused, leaving, notice.type]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onRemove(notice.id), 220);
    return () => window.clearTimeout(timer);
  }, [leaving, notice.id, onRemove]);

  return (
    <article className={`app-notice ${notice.type}${leaving ? " is-leaving" : ""}`}
      role={notice.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <span className="app-notice-icon" aria-hidden>{notice.type === "success" ? "✓" : notice.type === "error" ? "!" : "i"}</span>
      <div className="app-notice-content">
        <strong>{notice.title}</strong>
        {notice.text && <p>{notice.text}</p>}
      </div>
      <button className="app-notice-close" type="button" aria-label={t("common.close")} onClick={dismiss}>×</button>
    </article>
  );
}

export function Notifications({ notices, onRemove }: { notices: AppNotice[]; onRemove: (id: number) => void }) {
  return <section className="app-notifications" aria-label={t("notice.region")}>
    {notices.map((notice) => <Notification key={notice.id} notice={notice} onRemove={onRemove} />)}
  </section>;
}
