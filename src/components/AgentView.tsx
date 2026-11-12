import { useEffect, useRef, useState } from "react";
import { mcpStatus, setMcpEnabled } from "../lib/tauri";
import { t } from "../lib/i18n";
import type { McpStatus } from "../types";
import "../Agent.css";

const MCP_URL = "http://127.0.0.1:8790/mcp";
const CONFIG_JSON = JSON.stringify(
  { mcpServers: { lumeany: { type: "streamable-http", url: MCP_URL } } },
  null,
  2,
);

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
        <div className="agent-field">
          <span className="agent-label">{t("agent.endpoint")}</span>
          <code className="agent-mono">{MCP_URL}</code>
          <CopyButton text={MCP_URL} />
        </div>
        <div className="agent-field column">
          <div className="agent-field-line">
            <span className="agent-label">{t("agent.configTitle")}</span>
            <CopyButton text={CONFIG_JSON} />
          </div>
          <pre className="agent-pre">{CONFIG_JSON}</pre>
          <p className="agent-hint">{t("agent.configHint")}</p>
          <div className="agent-cli">
            <code className="agent-mono">{t("agent.cliHint")}</code>
            <CopyButton text={t("agent.cliHint")} />
          </div>
        </div>
      </section>

      <section className={`agent-card${running ? "" : " off"}`}>
        <div className="agent-label">{t("agent.examplesTitle")}</div>
        <ul className="agent-tools">
          <li>{t("agent.toolProbe")}</li>
          <li>{t("agent.toolDownload")}</li>
          <li>{t("agent.toolList")}</li>
          <li>{t("agent.toolCancel")}</li>
        </ul>
        <p className="agent-note">{t("agent.prefsNote")}</p>
      </section>
    </div>
  );
}
