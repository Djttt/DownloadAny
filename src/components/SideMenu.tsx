import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { dependencyInfo, detectProxy, testSite } from "../lib/tauri";
import type { DependencyInfo } from "../types";
import {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  buildProxyUrl,
  saveLangPref,
  saveThemePref,
  loadUpdateChannel,
  saveUpdateChannel,
  type UpdateChannel,
  type ProxyType,
} from "../lib/settings";
import { getLangPref, setLangPref, t, type LangPref } from "../lib/i18n";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme";
import { changePassword, logout, type AuthUser } from "../lib/auth";
import type { AppUpdater } from "../lib/updater";
import { EyeIcon } from "./EyeIcon";

/* ========================================================================
 * 侧栏功能菜单:联系客服(悬停飞窗)/ 问题反馈(弹窗)/ 设置(弹窗)
 * ==================================================================== */

// TODO: 支持渠道占位值,上线前替换为真实的 Telegram/Discord 邀请链接、客服邮箱与 QQ 群号
const TELEGRAM_URL = "https://t.me/your-community";
const DISCORD_URL = "https://discord.gg/your-community";
const SUPPORT_EMAIL = "support@example.com";
const QQ_GROUP = "100000000";

/* ---- 小图标(线性风格,继承 currentColor) ---- */

const I = {
  headphones: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 16v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14.5" width="4.2" height="6" rx="1.6" />
      <rect x="16.8" y="14.5" width="4.2" height="6" rx="1.6" />
    </svg>
  ),
  feedback: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8.5 9.5h7M8.5 12.5h4" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.34-1.05-.63-1.62-.83l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.57.2-1.13.49-1.62.83l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.34 1.05.63 1.62.83l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.57-.2 1.13-.49 1.62-.83l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4L22 2Z" />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5.5 5.5C8 4.4 16 4.4 18.5 5.5l1.3 7.8c-2 1.9-4.2 2.9-6.4 3.1L12.6 15c-.4.1-.9.1-1.2 0l-.8 1.4c-2.2-.2-4.4-1.2-6.4-3.1L5.5 5.5Z" />
      <circle cx="9.6" cy="10.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="10.4" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  ),
  qq: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5c-3 0-5 2.6-5 5.5 0 .6-1 2.4-1.4 3.9-.4 1.6.3 2.3 1.3 1.9.3 1.4 1.2 2.6 2.3 3.3-.9.4-1.4 1-1.4 1.5 0 1 1.8 1.4 4.2 1.4s4.2-.4 4.2-1.4c0-.5-.5-1.1-1.4-1.5 1.1-.7 2-1.9 2.3-3.3 1 .4 1.7-.3 1.3-1.9C18 11.4 17 9.6 17 9c0-2.9-2-5.5-5-5.5Z" />
      <path d="M10.2 8.2h.01M13.8 8.2h.01" strokeWidth="2.2" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </svg>
  ),
};

export { I as menuIcons };

/* ---- 工具 ---- */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function useEscClose(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

/** 弹窗遮罩:点空白处关闭 */
function Modal({
  label,
  onClose,
  children,
  wide,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEscClose(onClose);
  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={wide ? "modal modal-wide" : "modal"} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/* ---- 联系客服:悬停飞窗 ---- */

export function SupportMenuItem() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleCopy(key: string, value: string) {
    if (await copyText(value)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    }
  }

  return (
    <div
      className="menu-host"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="menu-row" type="button" aria-haspopup="menu" aria-expanded={open}>
        {I.headphones}
        <span>{t("menu.support")}</span>
      </button>
      {open && (
        <div className="flyout" role="menu">
          <button className="fly-row" type="button" role="menuitem" onClick={() => openUrl(TELEGRAM_URL).catch(() => {})}>
            {I.telegram}
            <strong>{t("fly.telegram")}</strong>
          </button>
          <button className="fly-row" type="button" role="menuitem" onClick={() => openUrl(DISCORD_URL).catch(() => {})}>
            {I.discord}
            <strong>{t("fly.discord")}</strong>
          </button>
          <button className="fly-row" type="button" role="menuitem" onClick={() => handleCopy("email", SUPPORT_EMAIL)}>
            {I.mail}
            <span className="fly-copy">
              <strong>{t("fly.email")}</strong>
              <small>{copied === "email" ? t("fly.copied") : SUPPORT_EMAIL}</small>
            </span>
          </button>
          <button className="fly-row" type="button" role="menuitem" onClick={() => handleCopy("qq", QQ_GROUP)}>
            {I.qq}
            <span className="fly-copy">
              <strong>{t("fly.qq")}</strong>
              <small>{copied === "qq" ? t("fly.copied") : QQ_GROUP}</small>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- 账户入口:未登录打开登录窗口;已登录悬停弹出账户卡片 ---- */

export function AccountMenuItem({
  user,
  onUserChange,
  onRequestLogin,
}: {
  user: AuthUser | null;
  onUserChange: (user: AuthUser | null) => void;
  onRequestLogin: () => void;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const displayName = user?.email.split("@")[0] ?? "";

  // 卡片经 portal 渲染在 body 层(不受 .side/.platform-rows 层叠影响)，按条目 rect 定位到其右上方
  function showCard() {
    const r = entryRef.current?.getBoundingClientRect();
    if (!r) return;
    // 卡片弹在条目正上方(侧栏内，向上展开盖住菜单区)
    setAnchor({
      left: Math.max(8, r.left - 4),
      bottom: window.innerHeight - r.top + 6,
    });
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  }

  // 鼠标从条目移到 portal 卡片会先触发条目 mouseleave，靠延迟关闭兜住这段空隙
  function keepOpen() {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }

  return (
    <>
      <button
        ref={entryRef}
        className="account-entry"
        type="button"
        aria-label={t("account.aria")}
        title={user ? undefined : t("account.title")}
        onMouseEnter={user ? showCard : undefined}
        onMouseLeave={user ? scheduleClose : undefined}
        onClick={() => !user && onRequestLogin()}
      >
        <span className="account-avatar" aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <circle cx="12" cy="8.5" r="3.5" fill="currentColor" />
            <path d="M5.5 19c.5-3.2 2.7-5 6.5-5s6 1.8 6.5 5" fill="currentColor" />
          </svg>
        </span>
        <span className="account-copy">
          <strong>{user ? displayName : t("account.notLoggedIn")}</strong>
          <small>{user ? user.email : t("account.clickToLogin")}</small>
        </span>
        <svg
          className="account-arrow"
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          aria-hidden
        >
          <path
            d="m6 3.5 4.5 4.5L6 12.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {user && open && anchor && (
        createPortal(
          <div
            className="flyout flyout-account"
            style={{ position: "fixed", left: anchor.left, bottom: anchor.bottom, zIndex: 95 }}
            onMouseEnter={keepOpen}
            onMouseLeave={scheduleClose}
          >
            <div className="acc-head">
              <div className="acc-name-row">
                <strong>{displayName}</strong>
                <span className="acc-badge">{t("account.plan")}</span>
              </div>
              <small className="acc-email">{user.email}</small>
            </div>
            <button className="acc-row" type="button" title={t("account.todo")}>
              {t("account.personal")}
            </button>
            <button
              className="acc-row"
              type="button"
              onClick={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
            >
              {user.hasPassword ? t("account.changePassword") : t("account.setPassword")}
            </button>
            <button
              className="acc-row"
              type="button"
              onClick={() => {
                onUserChange(null);
                setOpen(false);
                logout().catch(() => {});
              }}
            >
              {t("account.logout")}
            </button>
          </div>,
          document.body,
        )
      )}
      {user && passwordOpen && (
        <PasswordModal
          hasPassword={user.hasPassword}
          onClose={() => setPasswordOpen(false)}
          onPasswordChanged={() => onUserChange({ ...user, hasPassword: true })}
        />
      )}
    </>
  );
}

/* ---- 设置 / 修改密码 ---- */

export function PasswordModal({
  hasPassword,
  onClose,
  onPasswordChanged,
}: {
  hasPassword: boolean;
  onClose: () => void;
  onPasswordChanged: () => void;
}) {
  const [currentPwd, setCurrentPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revealPwd, setRevealPwd] = useState(false);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [revealCurrent, setRevealCurrent] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = hasPassword ? t("account.changePassword") : t("account.setPassword");

  function validateNewPassword(value: string): string | null {
    if (!value) return t("pwd.required");
    if (value.length < 10 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) return t("pwd.weak");
    return null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const nextCurrentError = hasPassword && !currentPwd ? t("pwd.required") : null;
    const nextNewError = validateNewPassword(pwd);
    const nextConfirmError = !confirm ? t("pwd.required") : pwd !== confirm ? t("pwd.mismatch") : null;
    setCurrentError(nextCurrentError);
    setNewError(nextNewError);
    setConfirmError(nextConfirmError);
    if (nextCurrentError || nextNewError || nextConfirmError) return;
    setBusy(true);
    setErr(null);
    try {
      await changePassword(hasPassword ? currentPwd : null, pwd);
      onPasswordChanged();
      setDone(true);
    } catch (reason) {
      setErr(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function field(
    id: string,
    label: string,
    placeholder: string,
    value: string,
    reveal: boolean,
    onValue: (v: string) => void,
    onToggle: () => void,
    errorMessage: string | null,
    onBlur: () => void,
  ) {
    return (
      <div className="pwd-field">
        <label htmlFor={id}>{label}</label>
        <div className="pwd-wrap">
          <input
            id={id}
            className={errorMessage ? "pwd-input invalid" : "pwd-input"}
            type={reveal ? "text" : "password"}
            value={value}
            placeholder={placeholder}
            autoComplete={id === "pwd-current" ? "current-password" : "new-password"}
            disabled={busy}
            onBlur={onBlur}
            onChange={(e) => {
              onValue(e.target.value);
              if (err) setErr(null);
            }}
          />
          <button
            type="button"
            className="pwd-eye"
            aria-label={reveal ? t("pwd.hide") : t("pwd.show")}
            onClick={onToggle}
          >
            <EyeIcon off={reveal} />
          </button>
        </div>
        <p className="pwd-field-error" role={errorMessage ? "alert" : undefined}>
          {errorMessage ?? ""}
        </p>
      </div>
    );
  }

  return createPortal(
    <Modal label={title} onClose={onClose}>
      {done ? (
        <div className="feedback-done">
          <svg viewBox="0 0 48 48" width="52" height="52" fill="none" aria-hidden>
            <circle cx="24" cy="24" r="22" fill="var(--mist)" />
            <path
              d="m15 24.5 6 6 12-13"
              stroke="var(--indigo)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h3>{hasPassword ? t("pwd.changedTitle") : t("pwd.doneTitle")}</h3>
          <p>{hasPassword ? t("pwd.changedDesc") : t("pwd.doneDesc")}</p>
          <button className="primary" type="button" onClick={onClose}>
            {t("fb.close")}
          </button>
        </div>
      ) : (
        <>
          <header className="modal-head">
            <h3>{title}</h3>
            <button className="clear" type="button" onClick={onClose} aria-label={t("common.close")}>
              {I.close}
            </button>
          </header>
          <form className="modal-body" onSubmit={save}>
            {hasPassword && field(
              "pwd-current",
              t("pwd.currentLabel"),
              t("pwd.currentPlaceholder"),
              currentPwd,
              revealCurrent,
              (value) => { setCurrentPwd(value); setCurrentError(null); },
              () => setRevealCurrent(!revealCurrent),
              currentError,
              () => setCurrentError(currentPwd ? null : t("pwd.required")),
            )}
            {field(
              "pwd-input",
              hasPassword ? t("pwd.newLabel") : t("pwd.label"),
              t("pwd.placeholder"),
              pwd,
              revealPwd,
              (value) => { setPwd(value); setNewError(null); },
              () => setRevealPwd(!revealPwd),
              newError,
              () => setNewError(validateNewPassword(pwd)),
            )}
            {field(
              "pwd-confirm",
              t("pwd.confirmLabel"),
              t("pwd.confirmPlaceholder"),
              confirm,
              revealConfirm,
              (value) => { setConfirm(value); setConfirmError(null); },
              () => setRevealConfirm(!revealConfirm),
              confirmError,
              () => setConfirmError(!confirm ? t("pwd.required") : pwd !== confirm ? t("pwd.mismatch") : null),
            )}
            <p className="desc-error pwd-error" role={err ? "alert" : undefined}>{err ?? ""}</p>
            <div className="pwd-actions">
              <button className="primary" type="submit" disabled={busy}>
                {busy ? t("auth.working") : t("pwd.save")}
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>,
    document.body,
  );
}

/* ---- 问题反馈 ---- */

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<"bug" | "feature">("bug");
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // 纯前端占位:提交仅展示成功态,数据暂不上报
  function submit() {
    if (!text.trim()) {
      setInvalid(true);
      return;
    }
    setSubmitted(true);
  }

  return (
    <Modal label={t("fb.title")} onClose={onClose} wide>
      {submitted ? (
        <div className="feedback-done">
          <svg viewBox="0 0 48 48" width="52" height="52" fill="none" aria-hidden>
            <circle cx="24" cy="24" r="22" fill="var(--mist)" />
            <path d="m15 24.5 6 6 12-13" stroke="var(--indigo)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3>{t("fb.doneTitle")}</h3>
          <p>{kind === "bug" ? t("fb.doneBug") : t("fb.doneFeature")}</p>
          <button className="primary" type="button" onClick={onClose}>
            {t("fb.close")}
          </button>
        </div>
      ) : (
        <>
          <header className="modal-head">
            <h3>{t("fb.title")}</h3>
            <button className="clear" type="button" onClick={onClose} aria-label={t("common.close")}>
              {I.close}
            </button>
          </header>
          <div className="modal-body">
            <p className="modal-intro">{t("fb.intro")}</p>
            <div className="radio-cards">
              <label className={kind === "bug" ? "radio-card on" : "radio-card"}>
                <input type="radio" name="feedback-kind" checked={kind === "bug"} onChange={() => setKind("bug")} />
                <span className="radio-dot" aria-hidden />
                <span className="radio-text">
                  <strong>{t("fb.bugTitle")}</strong>
                  <small>{t("fb.bugDesc")}</small>
                </span>
              </label>
              <label className={kind === "feature" ? "radio-card on" : "radio-card"}>
                <input type="radio" name="feedback-kind" checked={kind === "feature"} onChange={() => setKind("feature")} />
                <span className="radio-dot" aria-hidden />
                <span className="radio-text">
                  <strong>{t("fb.featureTitle")}</strong>
                  <small>{t("fb.featureDesc")}</small>
                </span>
              </label>
            </div>
            <h4>{t("fb.descLabel")}</h4>
            <textarea
              className={invalid ? "desc invalid" : "desc"}
              rows={6}
              value={text}
              placeholder={t("fb.descPlaceholder")}
              onChange={(e) => {
                setText(e.target.value);
                if (invalid) setInvalid(false);
              }}
            />
            {invalid && <p className="desc-error">{t("fb.descRequired")}</p>}
            <p className="desc-hint">{t("fb.descHint")}</p>
            <button className="primary" type="button" onClick={submit}>
              {t("fb.submit")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---- 设置(常规 / 网络 / 关于) ---- */

// TODO: 官网占位,替换为真实站点地址
const WEBSITE_URL = "https://example.com";

type SettingsTab = "general" | "network" | "about";

export function SettingsModal({
  outputDir,
  autoMode,
  autoDisabled,
  maxConcurrency,
  proxyType,
  proxyAddr,
  onPickDir,
  onToggleAuto,
  onSetMaxConcurrency,
  onSetProxy,
  updater,
  onClose,
}: {
  outputDir: string;
  autoMode: boolean;
  autoDisabled: boolean;
  maxConcurrency: number;
  proxyType: ProxyType;
  proxyAddr: string;
  onPickDir: () => void;
  onToggleAuto: (v: boolean) => void;
  onSetMaxConcurrency: (n: number) => void;
  onSetProxy: (type: ProxyType, addr: string) => void;
  updater: AppUpdater;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [langPref, setLangPrefState] = useState<LangPref>(getLangPref());
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref());

  function changeLang(p: LangPref) {
    setLangPrefState(p);
    setLangPref(p);
    saveLangPref(p).catch(() => {});
  }

  function changeTheme(p: ThemePref) {
    setThemePrefState(p);
    setThemePref(p);
    saveThemePref(p).catch(() => {});
  }

  return (
    <Modal label={t("set.title")} onClose={onClose} wide>
      <header className="modal-head">
        <h3>{t("set.title")}</h3>
        <button className="clear" type="button" onClick={onClose} aria-label={t("common.close")}>
          {I.close}
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label={t("set.title")}>
          {(
            [
              ["general", t("set.tabGeneral")],
              ["network", t("set.tabNetwork")],
              ["about", t("set.tabAbout")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "settings-tab on" : "settings-tab"}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "general" && (
            <>
              <div className="setting-block">
                <h4>{t("set.langLabel")}</h4>
                <select
                  className="select"
                  value={langPref}
                  onChange={(e) => changeLang(e.target.value as LangPref)}
                  aria-label={t("set.langLabel")}
                >
                  <option value="system">{t("lang.system")}</option>
                  <option value="zh">{t("lang.zh")}</option>
                  <option value="en">{t("lang.en")}</option>
                </select>
              </div>
              <div className="setting-block">
                <h4>{t("set.themeLabel")}</h4>
                <select
                  className="select"
                  value={themePref}
                  onChange={(e) => changeTheme(e.target.value as ThemePref)}
                  aria-label={t("set.themeLabel")}
                >
                  <option value="system">{t("theme.system")}</option>
                  <option value="light">{t("theme.light")}</option>
                  <option value="dark">{t("theme.dark")}</option>
                </select>
              </div>
              <div className="setting-block">
                <h4>{t("set.dirLabel")}</h4>
                <div className="dir-row">
                  <span className="dir" title={outputDir}>
                    {outputDir || "…"}
                  </span>
                  <button className="chg" type="button" onClick={onPickDir}>
                    {t("set.dirChange")}
                  </button>
                </div>
              </div>
              <div className="setting-block toggle-row">
                <span className="toggle-copy">
                  <h4>{t("set.autoLabel")}</h4>
                  <small>{t("set.autoDesc")}</small>
                </span>
                <label className={autoDisabled ? "auto disabled" : "auto"}>
                  <input
                    type="checkbox"
                    checked={autoMode}
                    disabled={autoDisabled}
                    onChange={(e) => onToggleAuto(e.target.checked)}
                    aria-label={t("set.autoLabel")}
                  />
                  <span className="sw" aria-hidden />
                </label>
              </div>
              <div className="setting-block toggle-row">
                <span className="toggle-copy">
                  <h4>{t("set.concLabel")}</h4>
                  <small>{t("set.concDesc", { min: CONCURRENCY_MIN, max: CONCURRENCY_MAX })}</small>
                </span>
                <div className="stepper">
                  <button
                    type="button"
                    aria-label={t("set.dec")}
                    disabled={maxConcurrency <= CONCURRENCY_MIN}
                    onClick={() => onSetMaxConcurrency(maxConcurrency - 1)}
                  >
                    −
                  </button>
                  <span className="num">{maxConcurrency}</span>
                  <button
                    type="button"
                    aria-label={t("set.inc")}
                    disabled={maxConcurrency >= CONCURRENCY_MAX}
                    onClick={() => onSetMaxConcurrency(maxConcurrency + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === "network" && (
            <NetworkPane proxyType={proxyType} proxyAddr={proxyAddr} onSetProxy={onSetProxy} />
          )}
          {tab === "about" && <AboutPane updater={updater} />}
        </div>
      </div>
    </Modal>
  );
}

/* ---- 网络页:代理设置(已经由 DownloadOptions/probe_video 接通下载引擎) ---- */

const PROXY_KEYS: Record<ProxyType, "proxy.none" | "proxy.http" | "proxy.socks5"> = {
  none: "proxy.none",
  http: "proxy.http",
  socks5: "proxy.socks5",
};

// 站点 id 必须与 Rust nettest::TEST_SITES 白名单一致,label 为专名不随语言翻译
const NET_TEST_SITES: { id: string; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "twitter", label: "Twitter" },
  { id: "instagram", label: "Instagram" },
  { id: "baidu", label: "Baidu" },
];

type SiteState = "idle" | "busy" | "ok" | "fail";

function SiteStatusIcon({ state }: { state: SiteState }) {
  if (state === "ok") {
    return (
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <circle cx="7" cy="7" r="7" fill="var(--green)" />
        <path
          d="m4.1 7.2 2 2 3.8-4.4"
          stroke="#fff"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "fail") {
    return (
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <circle cx="7" cy="7" r="7" fill="var(--red)" />
        <path
          d="M4.9 4.9l4.2 4.2M9.1 4.9l-4.2 4.2"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (state === "busy") return <span className="chip-spin" aria-hidden />;
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
      <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".25" />
    </svg>
  );
}

function NetworkPane({
  proxyType,
  proxyAddr,
  onSetProxy,
}: {
  proxyType: ProxyType;
  proxyAddr: string;
  onSetProxy: (type: ProxyType, addr: string) => void;
}) {
  // 输入框本地草稿：onBlur / Enter 才提交，避免每敲一个字符写一次 store
  const [draft, setDraft] = useState(proxyAddr);
  const [detect, setDetect] = useState<"idle" | "busy" | "none">("idle");
  useEffect(() => setDraft(proxyAddr), [proxyAddr]);

  const activeUrl = buildProxyUrl(proxyType, proxyAddr);

  // 网络测试：4 站点并行，结果逐站点亮（invoke 内现取当前代理设置）
  const [siteStatus, setSiteStatus] = useState<Record<string, SiteState>>({});
  const [siteError, setSiteError] = useState<Record<string, string>>({});
  const testing = NET_TEST_SITES.some((s) => siteStatus[s.id] === "busy");

  function runNetTest() {
    const url = activeUrl;
    setSiteStatus(Object.fromEntries(NET_TEST_SITES.map((s) => [s.id, "busy" as SiteState])));
    setSiteError({});
    for (const { id } of NET_TEST_SITES) {
      testSite(id, url)
        .then((r) => {
          setSiteStatus((prev) => ({ ...prev, [id]: r.ok ? "ok" : "fail" }));
          if (!r.ok && r.error) setSiteError((prev) => ({ ...prev, [id]: r.error as string }));
        })
        .catch((e) => {
          setSiteStatus((prev) => ({ ...prev, [id]: "fail" }));
          setSiteError((prev) => ({ ...prev, [id]: String(e) }));
        });
    }
  }

  async function handleDetect() {
    setDetect("busy");
    try {
      const found = await detectProxy();
      if (found) {
        const type = found.proxyType === "socks5" ? "socks5" : "http";
        setDraft(found.addr);
        onSetProxy(type, found.addr);
        setDetect("idle");
      } else {
        setDetect("none");
      }
    } catch {
      setDetect("none");
    }
  }

  return (
    <>
      <div className="setting-block">
        <h4>{t("set.proxyLabel")}</h4>
        <select
          className="select"
          value={proxyType}
          onChange={(e) => onSetProxy(e.target.value as ProxyType, draft)}
          aria-label={t("set.proxyLabel")}
        >
          {(Object.keys(PROXY_KEYS) as ProxyType[]).map((k) => (
            <option key={k} value={k}>
              {t(PROXY_KEYS[k])}
            </option>
          ))}
        </select>
      </div>
      {proxyType !== "none" && (
        <div className="setting-block">
          <h4>{t("set.proxyAddrLabel")}</h4>
          <div className="proxy-row">
            <input
              className="text-input"
              type="text"
              value={draft}
              placeholder={t("set.proxyAddrPlaceholder")}
              spellCheck={false}
              onChange={(e) => {
                setDraft(e.target.value);
                setDetect("idle");
              }}
              onBlur={() => draft.trim() !== proxyAddr && onSetProxy(proxyType, draft)}
              onKeyDown={(e) => e.key === "Enter" && onSetProxy(proxyType, draft)}
              aria-label={t("set.proxyAddrLabel")}
            />
            <button className="chg" type="button" disabled={detect === "busy"} onClick={handleDetect}>
              {detect === "busy" ? t("set.proxyDetecting") : t("set.proxyDetect")}
            </button>
          </div>
          {detect === "none" && <p className="setting-note">{t("set.proxyDetectNone")}</p>}
        </div>
      )}
      <p className="setting-note">{t("set.proxyNote")}</p>
      <p className="setting-note">
        {activeUrl
          ? t("set.proxyEffective", { url: activeUrl })
          : proxyType === "none"
            ? t("set.proxyInactive")
            : t("set.proxyAddrMissing")}
      </p>
      <div className="setting-block net-test-block">
        <div className="net-test-head">
          <h4>{t("set.netTestTitle")}</h4>
          <button className="net-test-run" type="button" disabled={testing} onClick={runNetTest}>
            {testing && <span className="chip-spin light" aria-hidden />}
            {testing ? t("set.netTestRunning") : t("set.netTestStart")}
          </button>
        </div>
        <div className="site-chips">
          {NET_TEST_SITES.map((s) => {
            const st = siteStatus[s.id] ?? "idle";
            return (
              <span
                className="site-chip"
                key={s.id}
                title={st === "fail" ? siteError[s.id] : undefined}
              >
                {s.label}
                <SiteStatusIcon state={st} />
              </span>
            );
          })}
        </div>
        <p className="setting-note">{t("set.netTestNote")}</p>
      </div>
    </>
  );
}

/* ---- 关于页:真实版本信息 ---- */

function updateStatus(updater: AppUpdater): string {
  const { phase, version, progress, error } = updater.state;
  if (phase === "checking") return t("update.checking");
  if (phase === "available") return t("update.available", { version: version ?? "?" });
  if (phase === "downloading") return t("update.downloading", { progress: Math.round(progress) });
  if (phase === "ready") return t("update.ready", { version: version ?? "?" });
  if (phase === "installing") return t("update.installing");
  if (phase === "upToDate") return t("update.upToDate");
  if (phase === "blocked") return t("update.blocked");
  if (phase === "error") return error || t("update.failed");
  return t("update.idle");
}

function UpdateActions({ updater, compact = false }: { updater: AppUpdater; compact?: boolean }) {
  const { phase, version } = updater.state;
  const busy = phase === "checking" || phase === "downloading" || phase === "installing";
  return (
    <div className={compact ? "update-actions compact" : "update-actions"}>
      {(phase === "idle" || phase === "upToDate" || phase === "error") && (
        <button type="button" className="chg" disabled={busy} onClick={() => void updater.checkNow()}>
          {t("update.check")}
        </button>
      )}
      {(phase === "available" || phase === "error") && version && (
        <button type="button" className="primary" disabled={busy} onClick={() => void updater.download()}>
          {t("update.download")}
        </button>
      )}
      {(phase === "ready" || phase === "blocked") && (
        <button type="button" className="primary" disabled={busy} onClick={() => void updater.install()}>
          {t("update.install")}
        </button>
      )}
      {version && phase !== "installing" && (
        <button type="button" className="chg" disabled={busy} onClick={updater.later}>
          {t("update.later")}
        </button>
      )}
      {version && (phase === "available" || phase === "ready" || phase === "blocked") && (
        <button type="button" className="clear-update" disabled={busy} onClick={() => void updater.skip()}>
          {t("update.skip")}
        </button>
      )}
    </div>
  );
}

function AboutPane({ updater }: { updater: AppUpdater }) {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [dep, setDep] = useState<DependencyInfo | null>(null);
  const [channel, setChannel] = useState<UpdateChannel>("stable");

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => alive && setAppVersion(v))
      .catch(() => {});
    dependencyInfo()
      .then((d) => alive && setDep(d))
      .catch(() => {}); // PyInstaller 静态包首探可能较慢,失败时留空
    loadUpdateChannel().then((value) => alive && setChannel(value)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const rows: [string, string][] = [
    [t("about.version"), appVersion ? `v${appVersion}` : "—"],
    [t("about.components"), dep ? `${dep.ytDlpVersion ?? "?"} / ${dep.ffmpegVersion ?? "?"}` : "—"],
    [t("about.website"), WEBSITE_URL],
  ];

  return (
    <div className="about-list">
      {rows.map(([k, v]) => (
        <div className="about-row" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      <p className="setting-note">{t("about.componentsNote")}</p>
      <div className="setting-block">
        <h4>{t("update.channel")}</h4>
        <select
          className="select"
          value={channel}
          onChange={(event) => {
            const value = event.target.value as UpdateChannel;
            setChannel(value);
            void saveUpdateChannel(value);
          }}
        >
          <option value="stable">{t("update.channelStable")}</option>
          <option value="beta">{t("update.channelBeta")}</option>
        </select>
        <p className="setting-note">{t("update.channelNote")}</p>
      </div>
      <div className="about-update">
        <div>
          <strong>{t("update.title")}</strong>
          <p className={updater.state.phase === "error" ? "update-status error" : "update-status"}>
            {updateStatus(updater)}
          </p>
        </div>
        {updater.state.phase === "downloading" && (
          <div className="update-progress" aria-label={updateStatus(updater)}>
            <span style={{ width: `${updater.state.progress}%` }} />
          </div>
        )}
        <UpdateActions updater={updater} compact />
      </div>
    </div>
  );
}

/** 启动延迟检查发现更新后显示的非阻塞提示。 */
export function UpdateNotice({ updater }: { updater: AppUpdater }) {
  const { state } = updater;
  if (!state.visible || !state.version) return null;
  return (
    <aside className="update-notice" aria-live="polite">
      <div className="update-notice-head">
        <strong>{t("update.available", { version: state.version })}</strong>
        <button type="button" onClick={updater.later} aria-label={t("common.close")}>×</button>
      </div>
      {state.notes && <p className="update-notes">{state.notes}</p>}
      <p className={state.phase === "error" ? "update-status error" : "update-status"}>
        {updateStatus(updater)}
      </p>
      {state.phase === "downloading" && (
        <div className="update-progress"><span style={{ width: `${state.progress}%` }} /></div>
      )}
      <UpdateActions updater={updater} />
    </aside>
  );
}

