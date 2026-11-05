import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  GOOGLE_CLIENT_ID,
  loginWithGoogle,
  loginWithPassword,
  resendVerification,
  verifyEmailCode,
  type AuthUser,
} from "../lib/auth";
import { t } from "../lib/i18n";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
          renderButton(element: HTMLElement, options: Record<string, unknown>): void;
          cancel(): void;
        };
      };
    };
  }
}

type LoginMethod = "code" | "password";

function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(t("auth.googleLoadFailed"))), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(t("auth.googleLoadFailed")));
    document.head.appendChild(script);
  });
}

export function AuthModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (user: AuthUser) => void }) {
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const googleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleRef.current) return;
    const clientId = GOOGLE_CLIENT_ID;
    let active = true;
    loadGoogleIdentity()
      .then(() => {
        if (!active || !window.google || !googleRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => run(() => loginWithGoogle(credential)),
        });
        googleRef.current.replaceChildren();
        window.google.accounts.id.renderButton(googleRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          width: 360,
          text: "continue_with",
          shape: "rectangular",
        });
      })
      .catch((reason) => active && setError(String(reason instanceof Error ? reason.message : reason)));
    return () => {
      active = false;
      window.google?.accounts.id.cancel();
    };
  }, []);

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
    setBusy(true);
    try {
      await verifyEmailCode(normalizedEmail, code);
      setError(t("auth.codeLoginUnsupported"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      setNotice(await resendVerification(email.trim().toLowerCase()));
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
          {GOOGLE_CLIENT_ID ? <div className="google-signin" ref={googleRef} /> : (
            <button className="google-fallback" type="button" disabled title={t("auth.googleUnconfigured")}>
              <span className="google-g">G</span>{t("auth.google")}
            </button>
          )}
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
                <button type="button" disabled={busy} onClick={sendLoginCode}>{t("auth.sendCode")}</button>
              </span>
            </label>
          ) : (
            <label className="auth-field">
              <span>{t("auth.password")}</span>
              <input type="password" value={password} disabled={busy} autoComplete="current-password" placeholder={t("auth.passwordPlaceholder")} onChange={(event) => setPassword(event.target.value)} />
            </label>
          )}
          {notice && <p className="auth-notice">{notice}</p>}
          {error && <p className="desc-error auth-error">{error}</p>}
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? t("auth.working") : loginMethod === "code" ? t("auth.codeLoginButton") : t("auth.login")}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
