import { useEffect, useRef, useState } from "react";
import { mcpStatus, setMcpEnabled } from "../lib/tauri";
import { t } from "../lib/i18n";
import type { McpStatus } from "../types";
import "../Agent.css";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="agent-copy"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            window.clearTimeout(timer.current);
            setCopied(true);
            timer.current = window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    >
      {copied ? t("agent.copied") : label ?? t("agent.copy")}
    </button>
  );
}

export function AgentView() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    mcpStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      setStatus(await setMcpEnabled(on)); // bind 失败也走状态结构（error 字段），不抛错
    } catch (e) {
      setStatus((s) => ({ ...(s ?? { running: false, port: 8790, error: null }), error: String(e) }));
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running === true;

  return (
    <div className="agent">
      <header className="head">
        <h1>{t("app.agentTitle")}</h1>
        <p className="agent-sub">{t("agent.subtitle")}</p>
      </header>

      <section className="agent-card">
        <div className="agent-row">
          <span className={`agent-dot${running ? " on" : ""}`} aria-hidden />
          <span className="agent-state">{running ? t("agent.statusOn") : t("agent.statusOff")}</span>
          <button
            type="button"
            className={`agent-toggle${running ? " on" : ""}`}
            role="switch"
            aria-checked={running}
            aria-label={t("agent.enable")}
            disabled={busy}
            onClick={() => void toggle(!running)}
          >
            <span className="agent-knob" />
          </button>
        </div>
        <p className="agent-hint">{t("agent.enableHint")}</p>
        {!running && status?.error && (
          <p className="agent-error" role="alert">
            {t("agent.errorPrefix", { error: status.error })}
          </p>
        )}
      </section>

      <section className={`agent-card${running ? "" : " off"}`}>
        <div className="agent-label">{t("agent.examplesTitle")}</div>
        <p className="agent-hint">{t("agent.features")}</p>
        <div className="agent-note">
          <span className="agent-prompt">{t("agent.prompt")}</span>
          <CopyButton text={t("agent.prompt")} />
        </div>
      </section>
    </div>
  );
}
