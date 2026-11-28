import { t } from "../lib/i18n";
import type { AppUpdater } from "../lib/updater";

/**
 * 强制更新门禁：服务端把最新版本标记为 forced 后渲染的全屏阻断层。
 * 不可关闭、不可跳过（稍后/跳过在 hook 层已失效），盖过包括更新浮层与
 * 设置面板在内的所有界面；解析/下载命令在 Rust 侧同步被拒（双保险）。
 */
export function ForcedUpdateGate({ updater }: { updater: AppUpdater }) {
  const { state } = updater;
  if (!state.forced) return null;
  const { phase, version, notes, progress, error } = state;
  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  const showDownload = (phase === "available" || phase === "error") && state.hasArtifact;
  const showInstall = phase === "ready" || phase === "blocked";
  const showRetry = (phase === "error" || phase === "idle" || (phase === "available" && !state.hasArtifact)) && !busy;
  const statusText =
    phase === "error"
      ? error || t("update.failed")
      : phase === "downloading"
        ? t("update.downloading", { progress: Math.round(progress) })
        : phase === "ready"
          ? t("update.ready", { version: version ?? "?" })
          : phase === "blocked"
            ? t("update.blocked")
            : phase === "installing"
              ? t("update.installing")
              : phase === "checking"
                ? t("update.checking")
                : t("update.requiredHint");
  return (
    <div className="force-gate" role="alertdialog" aria-modal="true" aria-live="assertive">
      <div className="force-gate-card">
        <h2 className="force-gate-title">{t("update.required", { version: version ?? "?" })}</h2>
        <p className="force-gate-hint">{t("update.requiredHint")}</p>
        {notes && <p className="update-notes">{notes}</p>}
        <p className={phase === "error" ? "update-status error" : "update-status"}>{statusText}</p>
        {phase === "downloading" && (
          <div className="update-progress" aria-label={statusText}>
            <span style={{ width: `${Math.round(progress)}%` }} />
          </div>
        )}
        <div className="force-gate-actions">
          {showDownload && (
            <button type="button" className="primary" disabled={busy} onClick={() => void updater.download()}>
              {t("update.download")}
            </button>
          )}
          {showInstall && (
            <button type="button" className="primary" disabled={busy} onClick={() => void updater.install()}>
              {t("update.install")}
            </button>
          )}
          {showRetry && (
            <button type="button" className="chg" disabled={busy} onClick={() => void updater.checkNow()}>
              {t("update.retry")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
