import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaptchaRequiredError,
  forgotPassword,
  GOOGLE_CLIENT_ID,
  loginWithGoogle,
  loginWithPassword,
  register,
  resetPasswordByEmailCode,
  verifyEmailCode,
  type AuthUser,
} from "../lib/auth";
import { t } from "../lib/i18n";
import { EyeIcon } from "./EyeIcon";

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

type AuthView = "register" | "password" | "forgot";

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
  const [view, setView] = useState<AuthView>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<{ id: string; question: string; answer: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
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

  function passwordRow(
    label: string,
    placeholder: string,
    autoComplete: string,
    value: string,
    revealed: boolean,
    onToggle: () => void,
    onChange: (v: string) => void,
  ) {
    return (
      <label className="auth-field">
        <span>{label}</span>
        <span className="auth-pwd">
          <input type={revealed ? "text" : "password"} value={value} disabled={busy} autoComplete={autoComplete} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
          <button
            type="button"
            className="pwd-eye"
            aria-label={revealed ? t("pwd.hide") : t("pwd.show")}
            onClick={(event) => {
              event.preventDefault();
              onToggle();
            }}
          >
            <EyeIcon off={revealed} />
          </button>
        </span>
      </label>
    );
  }

  function switchView(next: AuthView) {
    setView(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
    setCode("");
    setCaptcha(null);
  }

  async function submitPassword(normalizedEmail: string, value: string) {
    setBusy(true);
    setError(null);
    try {
      onAuthenticated(await loginWithPassword(normalizedEmail, value, captcha ? { id: captcha.id, answer: captcha.answer } : undefined));
      onClose();
    } catch (reason) {
      if (reason instanceof CaptchaRequiredError) {
        setCaptcha({ id: reason.captchaId, question: reason.question, answer: "" });
        setError(t("auth.captchaRequired"));
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  async function runMessage(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setNotice(await action());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function trimmedEmail(): string | null {
    const value = email.trim().toLowerCase();
    if (!value) {
      setError(t("auth.emailRequired"));
      return null;
    }
    return value;
  }

  function validateNewPassword(): boolean {
    if (password.length < 10) {
      setError(t("auth.passwordLength"));
      return false;
    }
    if (password !== confirm) {
      setError(t("pwd.mismatch"));
      return false;
    }
    return true;
  }

  async function sendRegisterCode() {
    const normalized = trimmedEmail();
    if (!normalized) return;
    if (!validateNewPassword()) return;
    await runMessage(() => register(normalized, password));
  }

  async function sendForgotCode() {
    const normalized = trimmedEmail();
    if (!normalized) return;
    await runMessage(() => forgotPassword(normalized));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return setError(t("auth.emailRequired"));
    if (view === "password") {
      if (!password) return setError(t("auth.passwordRequired"));
      if (captcha && !captcha.answer.trim()) return setError(t("auth.captchaAnswerRequired"));
      return submitPassword(normalizedEmail, password);
    }
    if (!/^\d{6}$/.test(code)) return setError(t("auth.codeInvalid"));
    if (view === "register") {
      return run(() => verifyEmailCode(normalizedEmail, code));
    }
    if (!validateNewPassword()) return;
    setBusy(true);
    try {
      const message = await resetPasswordByEmailCode(normalizedEmail, code, password);
      switchView("password");
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
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
            <button className={view === "register" ? "on" : ""} type="button" role="tab" aria-selected={view === "register"} onClick={() => switchView("register")}>
              {t("auth.registerTitle")}
            </button>
            <button className={view !== "register" ? "on" : ""} type="button" role="tab" aria-selected={view !== "register"} onClick={() => switchView("password")}>
              {t("auth.passwordLogin")}
            </button>
          </div>
          <label className="auth-field">
            <span>{t("auth.email")}</span>
            <input type="email" value={email} disabled={busy} autoComplete="email" placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} />
          </label>
          {view === "password" && (
            <>
              {passwordRow(
                t("auth.password"),
                t("auth.passwordPlaceholder"),
                "current-password",
                password,
                reveal,
                () => setReveal(!reveal),
                setPassword,
              )}
              {captcha && (
                <label className="auth-field">
                  <span>{captcha.question}</span>
                  <input inputMode="numeric" maxLength={4} value={captcha.answer} disabled={busy} placeholder={t("auth.captchaAnswerPlaceholder")} onChange={(event) => setCaptcha({ ...captcha, answer: event.target.value })} />
                </label>
              )}
            </>
          )}
          {(view === "register" || view === "forgot") && (
            <>
              {passwordRow(
                view === "forgot" ? t("auth.newPassword") : t("auth.password"),
                view === "forgot" ? t("auth.newPasswordPlaceholder") : t("auth.passwordPlaceholder"),
                "new-password",
                password,
                reveal,
                () => setReveal(!reveal),
                setPassword,
              )}
              {passwordRow(
                t("pwd.confirmLabel"),
                t("pwd.confirmPlaceholder"),
                "new-password",
                confirm,
                revealConfirm,
                () => setRevealConfirm(!revealConfirm),
                setConfirm,
              )}
              <label className="auth-field">
                <span>{t("auth.code")}</span>
                <span className="auth-code-row">
                  <input className="auth-code" inputMode="numeric" maxLength={6} value={code} disabled={busy} autoComplete="one-time-code" placeholder="000000" onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
                  <button type="button" disabled={busy} onClick={view === "forgot" ? sendForgotCode : sendRegisterCode}>
                    {view === "forgot" ? t("auth.sendCode") : t("auth.register")}
                  </button>
                </span>
              </label>
            </>
          )}
          {notice && <p className="auth-notice">{notice}</p>}
          {error && <p className="desc-error auth-error">{error}</p>}
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? t("auth.working") : view === "register" ? t("auth.verifyAndLogin") : view === "forgot" ? t("auth.resetButton") : t("auth.login")}
          </button>
          {view === "password" && (
            <button className="auth-link" type="button" disabled={busy} onClick={() => switchView("forgot")}>{t("auth.forgotPassword")}</button>
          )}
          {view === "forgot" && (
            <button className="auth-link" type="button" disabled={busy} onClick={() => switchView("password")}>{t("auth.backToLogin")}</button>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
