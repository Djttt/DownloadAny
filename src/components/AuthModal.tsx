import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  GOOGLE_CLIENT_ID,
  loginWithCode,
  loginWithGoogle,
  loginWithPassword,
  sendLoginCode as requestLoginCode,
  type AuthUser,
} from "../lib/auth";
import { t } from "../lib/i18n";
import { googleOAuthLogin } from "../lib/tauri";

type LoginMethod = "code" | "password";

export function AuthModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (user: AuthUser) => void }) {
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCodeCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [codeCooldown > 0]);

  async function run(action: () => Promise<AuthUser>) {
    setBusy(true);
    setError(null);
    try {
      onAuthenticated(await action());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return setError(t("auth.emailRequired"));
    if (loginMethod === "password") {
      if (!password) return setError(t("auth.passwordRequired"));
      return run(() => loginWithPassword(normalizedEmail, password));
    }
    if (!/^\d{6}$/.test(code)) return setError(t("auth.codeInvalid"));
    return run(() => loginWithCode(normalizedEmail, code));
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      setNotice(await requestLoginCode(email.trim().toLowerCase()));
      setCodeCooldown(60);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendLoginCode() {
    if (!email.trim()) return setError(t("auth.emailRequired"));
    await resend();
  }

  function signInWithGoogle() {
    if (!GOOGLE_CLIENT_ID) return setError(t("auth.googleUnconfigured"));
    const clientId = GOOGLE_CLIENT_ID;
    return run(async () => {
      const authorization = await googleOAuthLogin(clientId);
      return loginWithGoogle(authorization);
    });
  }

  return createPortal(
    <div className="modal-mask" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-label={t("auth.title")}>
        <header className="modal-head">
          <div>
            <h3>{t("auth.title")}</h3>
            <p className="auth-subtitle">{t("auth.subtitle")}</p>
          </div>
          <button className="clear auth-close" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
        </header>
        <form className="modal-body auth-body" onSubmit={submit}>
          <button className="google-fallback" type="button" disabled={busy} onClick={signInWithGoogle}>
            <span className="google-g">G</span>{busy ? t("auth.working") : t("auth.google")}
          </button>
          <div className="auth-divider"><span>{t("auth.orEmail")}</span></div>
          <div className="auth-method-tabs" role="tablist" aria-label={t("auth.methodLabel")}>
            <button className={loginMethod === "code" ? "on" : ""} type="button" role="tab" aria-selected={loginMethod === "code"} onClick={() => { setLoginMethod("code"); setError(null); setNotice(null); }}>
              {t("auth.codeLogin")}
            </button>
            <button className={loginMethod === "password" ? "on" : ""} type="button" role="tab" aria-selected={loginMethod === "password"} onClick={() => { setLoginMethod("password"); setError(null); setNotice(null); }}>
              {t("auth.passwordLogin")}
            </button>
          </div>
          <label className="auth-field">
            <span>{t("auth.email")}</span>
            <input type="email" value={email} disabled={busy} autoComplete="email" placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} />
          </label>
          {loginMethod === "code" ? (
            <label className="auth-field">
              <span>{t("auth.code")}</span>
              <span className="auth-code-row">
                <input className="auth-code" inputMode="numeric" maxLength={6} value={code} disabled={busy} autoComplete="one-time-code" placeholder="000000" onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
                <button type="button" disabled={busy || codeCooldown > 0} onClick={sendLoginCode}>
                  {codeCooldown > 0 ? t("auth.sendCodeCountdown").replace("{seconds}", String(codeCooldown)) : t("auth.sendCode")}
                </button>
              </span>
            </label>
          ) : (
            <label className="auth-field">
              <span>{t("auth.password")}</span>
              <input type="password" value={password} disabled={busy} autoComplete="current-password" placeholder={t("auth.passwordPlaceholder")} onChange={(event) => setPassword(event.target.value)} />
            </label>
          )}
          <div className="auth-feedback" aria-live="polite">
            {notice && <p className="auth-notice">{notice}</p>}
            {error && <p className="desc-error auth-error">{error}</p>}
          </div>
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? t("auth.working") : loginMethod === "code" ? t("auth.codeLoginButton") : t("auth.login")}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
