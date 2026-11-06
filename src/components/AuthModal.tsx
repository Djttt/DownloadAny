import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaptchaRequiredError,
  forgotPassword,
  GOOGLE_CLIENT_ID,
  loginWithCode,
  loginWithGoogle,
  loginWithPassword,
  register,
  resetPasswordByEmailCode,
  sendLoginCode as requestLoginCode,
  verifyEmailCode,
  type AuthUser,
} from "../lib/auth";
import { t } from "../lib/i18n";
import { googleOAuthLogin } from "../lib/tauri";
import { EyeIcon } from "./EyeIcon";

type AuthView = "code" | "register" | "password" | "forgot";

export function AuthModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (user: AuthUser) => void }) {
  const [view, setView] = useState<AuthView>("code");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<{ id: string; question: string; answer: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
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

  async function runMessage(action: () => Promise<string>, startCooldown = false) {
    setBusy(true);
    setError(null);
    try {
      setNotice(await action());
      if (startCooldown) setCodeCooldown(60);
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
    await runMessage(() => register(normalized, password), true);
  }

  async function sendForgotCode() {
    const normalized = trimmedEmail();
    if (!normalized) return;
    await runMessage(() => forgotPassword(normalized), true);
  }

  async function sendEmailLoginCode() {
    const normalized = trimmedEmail();
    if (!normalized) return;
    await runMessage(() => requestLoginCode(normalized), true);
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
    if (view === "code") {
      return run(() => loginWithCode(normalizedEmail, code));
    }
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

  function signInWithGoogle() {
    if (!GOOGLE_CLIENT_ID) return setError(t("auth.googleUnconfigured"));
    const clientId = GOOGLE_CLIENT_ID;
    return run(async () => loginWithGoogle(await googleOAuthLogin(clientId)));
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
            <button className={view === "code" ? "on" : ""} type="button" role="tab" aria-selected={view === "code"} onClick={() => switchView("code")}>
              {t("auth.codeLogin")}
            </button>
            <button className={view === "register" ? "on" : ""} type="button" role="tab" aria-selected={view === "register"} onClick={() => switchView("register")}>
              {t("auth.registerTitle")}
            </button>
            <button className={view === "password" ? "on" : ""} type="button" role="tab" aria-selected={view === "password"} onClick={() => switchView("password")}>
              {t("auth.passwordLogin")}
            </button>
          </div>
          <label className="auth-field">
            <span>{t("auth.email")}</span>
            <input type="email" value={email} disabled={busy} autoComplete="email" placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} />
          </label>
          {view === "code" && (
            <label className="auth-field">
              <span>{t("auth.code")}</span>
              <span className="auth-code-row">
                <input className="auth-code" inputMode="numeric" maxLength={6} value={code} disabled={busy} autoComplete="one-time-code" placeholder="000000" onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
                <button type="button" disabled={busy || codeCooldown > 0} onClick={sendEmailLoginCode}>
                  {codeCooldown > 0 ? t("auth.sendCodeCountdown").replace("{seconds}", String(codeCooldown)) : t("auth.sendCode")}
                </button>
              </span>
            </label>
          )}
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
                  <button type="button" disabled={busy || codeCooldown > 0} onClick={view === "forgot" ? sendForgotCode : sendRegisterCode}>
                    {codeCooldown > 0
                      ? t("auth.sendCodeCountdown").replace("{seconds}", String(codeCooldown))
                      : view === "forgot" ? t("auth.sendCode") : t("auth.register")}
                  </button>
                </span>
              </label>
            </>
          )}
          <div className="auth-feedback" aria-live="polite">
            {notice && <p className="auth-notice">{notice}</p>}
            {error && <p className="desc-error auth-error">{error}</p>}
          </div>
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? t("auth.working") : view === "code" ? t("auth.codeLoginButton") : view === "register" ? t("auth.verifyAndLogin") : view === "forgot" ? t("auth.resetButton") : t("auth.login")}
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
