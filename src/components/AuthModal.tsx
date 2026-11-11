import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AccountExistsError,
  CaptchaRequiredError,
  forgotPassword,
  GOOGLE_CLIENT_ID,
  loginWithGoogle,
  loginWithPassword,
  RegisterRequiredError,
  registerWithPassword,
  resetPasswordByEmailCode,
  type AuthUser,
} from "../lib/auth";
import { t } from "../lib/i18n";
import { googleOAuthLogin } from "../lib/tauri";
import { EyeIcon } from "./EyeIcon";

// 产品流程：登录只认「邮箱 + 密码」（或 Google）。
// 输错密码不泄露账号存在性，但邮箱没注册时后端回 404，这里就地引导去注册；
// 注册只需邮箱 / 密码 / 确认密码，不再发邮箱验证码，注册成功即登录。
// 找回密码仍走邮件验证码（/forgot-password + /reset-password/code）。
type AuthView = "login" | "register" | "forgot";
type MessageType = "success" | "error";

export function AuthModal({
  onClose,
  onAuthenticated,
  onMessage,
}: {
  onClose: () => void;
  /** signedUp = 本次是注册成功直接登录，App 据此换一条更准确的提示语。 */
  onAuthenticated: (user: AuthUser, signedUp?: boolean) => void;
  onMessage: (message: string, type: MessageType) => void;
}) {
  const [view, setView] = useState<AuthView>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<{ id: string; question: string; answer: string } | null>(null);
  const [registerHint, setRegisterHint] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const setError = (message: string | null) => message && onMessage(message, "error");
  const setNotice = (message: string | null) => message && onMessage(message, "success");

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
    action?: { label: string; onClick: () => void },
  ) {
    return (
      <label className="auth-field">
        <span className="auth-field-head">
          <span>{label}</span>
          {action && (
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                action.onClick();
              }}
            >
              {action.label}
            </button>
          )}
        </span>
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
    setRegisterHint(null);
  }

  async function submitPassword(normalizedEmail: string, value: string) {
    setBusy(true);
    setError(null);
    try {
      onAuthenticated(await loginWithPassword(normalizedEmail, value, captcha ? { id: captcha.id, answer: captcha.answer } : undefined));
      onClose();
    } catch (reason) {
      if (reason instanceof RegisterRequiredError) {
        // 没有账号：就地切到注册，邮箱留着，只等用户设密码。
        switchView("register");
        setRegisterHint(t("auth.registerHint"));
      } else if (reason instanceof CaptchaRequiredError) {
        setCaptcha({ id: reason.captchaId, question: reason.question, answer: "" });
        setError(t("auth.captchaRequired"));
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(normalizedEmail: string) {
    setBusy(true);
    setError(null);
    try {
      const user = await registerWithPassword(normalizedEmail, password, confirm);
      onAuthenticated(user, true);
      onClose();
    } catch (reason) {
      if (reason instanceof AccountExistsError) {
        // 已注册：跳回登录，让用户直接输原密码。
        switchView("login");
      }
      setError(reason instanceof Error ? reason.message : String(reason));
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

  /** 密码规则与后端一致：至少 10 位、同时含字母和数字，且两次输入一致（注册与找回密码共用）。 */
  function validatePasswordPair(): boolean {
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError(t("pwd.weak"));
      return false;
    }
    if (password !== confirm) {
      setError(t("pwd.mismatch"));
      return false;
    }
    return true;
  }

  async function sendForgotCode() {
    const normalized = trimmedEmail();
    if (!normalized) return;
    await runMessage(() => forgotPassword(normalized), true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return setError(t("auth.emailRequired"));
    if (view === "login") {
      if (!password) return setError(t("auth.passwordRequired"));
      if (captcha && !captcha.answer.trim()) return setError(t("auth.captchaAnswerRequired"));
      return submitPassword(normalizedEmail, password);
    }
    if (view === "register") {
      if (!validatePasswordPair()) return;
      return submitRegister(normalizedEmail);
    }
    if (!/^\d{6}$/.test(code)) return setError(t("auth.codeInvalid"));
    if (!validatePasswordPair()) return;
    setBusy(true);
    try {
      const message = await resetPasswordByEmailCode(normalizedEmail, code, password);
      switchView("login");
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

  const submitLabel =
    view === "register" ? t("auth.registerButton") : view === "forgot" ? t("auth.resetButton") : t("auth.login");
  // 三个页面各自有标题，找回密码页不能还挂着「登录」。
  const heading =
    view === "register" ? t("auth.registerTitle") : view === "forgot" ? t("auth.forgotTitle") : t("auth.title");

  return createPortal(
    <div className="modal-mask" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-label={heading}>
        <header className="modal-head">
          <span className="auth-badge" aria-hidden>
            <img src="/app-icon.png" alt="" />
          </span>
          <div className="auth-headings">
            <h3>{heading}</h3>
          </div>
          <button className="clear auth-close" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
        </header>
        <form className="modal-body auth-body" onSubmit={submit}>
          {/* 找回密码是独立任务页：不放 Google 登录，也不放「或使用邮箱」和登录/注册 Tab（返回走底部链接） */}
          {view !== "forgot" && (
            <>
              <button className="google-fallback" type="button" disabled={busy} onClick={signInWithGoogle}>
                <span className="google-g">G</span>{busy ? t("auth.working") : t("auth.google")}
              </button>
              <div className="auth-divider"><span>{t("auth.orEmail")}</span></div>
              <div className="auth-method-tabs" role="tablist" aria-label={t("auth.methodLabel")}>
                <button className={view === "login" ? "on" : ""} type="button" role="tab" aria-selected={view === "login"} onClick={() => switchView("login")}>
                  {t("auth.loginTab")}
                </button>
                <button className={view === "register" ? "on" : ""} type="button" role="tab" aria-selected={view === "register"} onClick={() => switchView("register")}>
                  {t("auth.registerTab")}
                </button>
              </div>
            </>
          )}
          {registerHint && (
            <p className="auth-hint" role="status">
              <span>{registerHint}</span>
            </p>
          )}
          <label className="auth-field">
            <span>{t("auth.email")}</span>
            <input type="email" value={email} disabled={busy} autoComplete="email" placeholder="name@example.com" onChange={(event) => setEmail(event.target.value)} />
          </label>
          {(view === "login" || view === "forgot") && (
            <>
              {passwordRow(
                view === "forgot" ? t("auth.newPassword") : t("auth.password"),
                view === "forgot" ? t("auth.newPasswordPlaceholder") : t("auth.passwordPlaceholder"),
                view === "forgot" ? "new-password" : "current-password",
                password,
                reveal,
                () => setReveal(!reveal),
                setPassword,
                view === "login" ? { label: t("auth.forgotPassword"), onClick: () => switchView("forgot") } : undefined,
              )}
              {view === "login" && captcha && (
                <label className="auth-field">
                  <span>{captcha.question}</span>
                  <input inputMode="numeric" maxLength={4} value={captcha.answer} disabled={busy} placeholder={t("auth.captchaAnswerPlaceholder")} onChange={(event) => setCaptcha({ ...captcha, answer: event.target.value })} />
                </label>
              )}
            </>
          )}
          {view === "register" && (
            <>
              <p className="auth-note">{t("auth.passwordHint")}</p>
              {passwordRow(
                t("auth.password"),
                t("auth.passwordPlaceholder"),
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
            </>
          )}
          {view === "forgot" && (
            <>
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
                  <button type="button" disabled={busy || codeCooldown > 0} onClick={sendForgotCode}>
                    {codeCooldown > 0 ? t("auth.sendCodeCountdown").replace("{seconds}", String(codeCooldown)) : t("auth.sendCode")}
                  </button>
                </span>
              </label>
            </>
          )}
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? t("auth.working") : submitLabel}
          </button>
          {view === "register" && (
            <button className="auth-link" type="button" disabled={busy} onClick={() => switchView("login")}>{t("auth.hasAccount")}</button>
          )}
          {view === "forgot" && (
            <button className="auth-link" type="button" disabled={busy} onClick={() => switchView("login")}>{t("auth.backToLogin")}</button>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
