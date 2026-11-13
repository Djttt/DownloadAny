import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { detectProxy, testSite } from "../lib/tauri";
import { FEEDBACK_MAX_LENGTH, FeedbackError, submitFeedback } from "../lib/feedback";
import {
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  buildProxyUrl,
  saveLangPref,
  saveThemePref,
  type ProxyType,
} from "../lib/settings";
import { getLangPref, setLangPref, t, type LangPref } from "../lib/i18n";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme";
import { changePassword, logout, type AuthUser } from "../lib/auth";
import type { AppUpdater } from "../lib/updater";
import { EyeIcon } from "./EyeIcon";
import { Icon } from "./Icon";

/* ========================================================================
 * 侧栏功能菜单:联系客服(QQ 群二维码弹窗)/ 问题反馈(弹窗)/ 设置(弹窗)
 * ==================================================================== */

// QQ 群二维码图片:放在 public/qq-group-qr.png,换图只需覆盖该文件
const QQ_QR_SRC = "/qq-group-qr.png";

/* ---- 小图标(线性风格,继承 currentColor) ---- */

const I = {
  headphones: (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 16v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14.5" width="4.2" height="6" rx="1.6" />
      <rect x="16.8" y="14.5" width="4.2" height="6" rx="1.6" />
    </svg>
  ),
  feedback: <Icon name="feedback" size={18} />,
  gear: <Icon name="settings" size={18} />,
  close: (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </svg>
  ),
};

export { I as menuIcons };

/* ---- 工具 ---- */

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

/* ---- 联系客服:点击弹出 QQ 群二维码 ---- */

export function SupportMenuItem() {
  const [open, setOpen] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);

  return (
    <div className="menu-host">
      <button
        className="menu-row"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {I.headphones}
        <span>{t("menu.support")}</span>
      </button>
      {open &&
        createPortal(
          <Modal label={t("support.qqTitle")} onClose={() => setOpen(false)}>
            <header className="modal-head">
              <h3>{t("support.qqTitle")}</h3>
              <button
                className="clear"
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
              >
                {I.close}
              </button>
            </header>
            <div className="modal-body qq-group-body">
              {qrFailed ? (
                <div className="qq-group-missing">
                  <span>{t("support.qqQrMissing")}</span>
                  <code>public/qq-group-qr.png</code>
                </div>
              ) : (
                <div className="qq-group-qr">
                  <img src={QQ_QR_SRC} alt={t("support.qqQrAlt")} onError={() => setQrFailed(true)} />
                </div>
              )}
              <p className="qq-group-hint">{t("support.qqHint")}</p>
            </div>
          </Modal>,
          document.body,
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
  const [anchor, setAnchor] = useState<{ left: number; bottom: number; width: number } | null>(null);
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
      left: r.left,
      bottom: window.innerHeight - r.top + 6,
      width: r.width,
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
            style={{ position: "fixed", left: anchor.left, bottom: anchor.bottom, width: anchor.width, zIndex: 95 }}
            onMouseEnter={keepOpen}
            onMouseLeave={scheduleClose}
          >
            <div className="acc-head">
              <p className="acc-kicker">{t("account.personal")}</p>
              <div className="acc-name-row">
                <strong>{displayName}</strong>
                <span className="acc-badge">{t("account.plan")}</span>
              </div>
              <small className="acc-email">{user.email}</small>
              {/* 验证码登录的账户默认没有密码，这里给出设置入口说明 */}
            </div>
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
  const [phase, setPhase] = useState<"form" | "sending" | "done">("form");
  const [error, setError] = useState<"network" | "rate" | null>(null);

  async function submit() {
    if (!text.trim()) {
      setInvalid(true);
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      await submitFeedback(kind, text.trim());
      setPhase("done");
    } catch (err) {
      setPhase("form");
      setError(err instanceof FeedbackError && err.status === 429 ? "rate" : "network");
    }
  }

  return (
    <Modal label={t("fb.title")} onClose={onClose} wide>
      {phase === "done" ? (
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
            <div className="fb-seg" role="radiogroup" aria-label={t("fb.descLabel")}>
              <button
                type="button"
                role="radio"
                aria-checked={kind === "bug"}
                className={kind === "bug" ? "on" : ""}
                disabled={phase === "sending"}
                onClick={() => setKind("bug")}
              >
                {t("fb.bugTitle")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === "feature"}
                className={kind === "feature" ? "on" : ""}
                disabled={phase === "sending"}
                onClick={() => setKind("feature")}
              >
                {t("fb.featureTitle")}
              </button>
            </div>
            <h4>{t("fb.descLabel")}</h4>
            <div className="fb-field">
              <textarea
                className={invalid ? "desc invalid" : "desc"}
                rows={6}
                maxLength={FEEDBACK_MAX_LENGTH}
                value={text}
                disabled={phase === "sending"}
                placeholder={t("fb.descPlaceholder")}
                onChange={(e) => {
                  setText(e.target.value);
                  if (invalid) setInvalid(false);
                }}
              />
              <span className={text.length >= FEEDBACK_MAX_LENGTH ? "fb-counter max" : "fb-counter"}>
                {text.length}/{FEEDBACK_MAX_LENGTH}
              </span>
            </div>
            {invalid && <p className="desc-error">{t("fb.descRequired")}</p>}
            <div className="fb-actions">
              {error && <p className="fb-error">{t(error === "rate" ? "fb.rateLimited" : "fb.error")}</p>}
              <button className="primary" type="button" onClick={submit} disabled={phase === "sending"}>
                {phase === "sending" ? t("fb.submitting") : t("fb.submit")}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---- 设置(常规 / 网络 / 关于) ---- */

const WEBSITE_URL = "https://www.lumeany.cc";

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
                <h4>
                  <Icon name="theme" size={13} style={{ marginRight: 5, color: "var(--ink-soft)" }} />
                  {t("set.themeLabel")}
                </h4>
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
                  <h4>
                    <Icon name="auto-download" size={13} style={{ marginRight: 5, color: "var(--ink-soft)" }} />
                    {t("set.autoLabel")}
                  </h4>
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
  if (state === "ok")
    return <Icon name="success" size={14} style={{ color: "var(--green)" }} />;
  if (state === "fail")
    return <Icon name="error" size={14} style={{ color: "var(--red)" }} />;
  if (state === "busy") return <span className="chip-spin" aria-hidden />;
  return <Icon name="waiting" size={14} style={{ opacity: 0.55 }} />;
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
      {(activeUrl || (proxyType !== "none" && !activeUrl)) && (
        <p className="setting-note">
          {activeUrl ? t("set.proxyEffective", { url: activeUrl }) : t("set.proxyAddrMissing")}
        </p>
      )}
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
  const { phase, version, visible } = updater.state;
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
      {/* 「稍后」只在浮动提示可见时有意义（收起浮层）；内嵌卡片不提供死按钮。 */}
      {version && visible && phase !== "installing" && (
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

  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => alive && setAppVersion(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const rows: [string, string][] = [
    [t("about.version"), appVersion ? `v${appVersion}` : "—"],
    [t("about.website"), WEBSITE_URL],
  ];

  // 与 UpdateNotice 的渲染条件保持一致：启动自动检查弹出的浮层可见时，
  // 关于页不再重复渲染更新提示，保证同一时刻只有一处更新界面；
  // 手动检查的结果（visible=false）以及收起浮层后的回落入口都在这里。
  const noticeShown = updater.state.visible && !!updater.state.version;

  return (
    <div className="about-list">
      <div className="about-brand">
        <span className="gem" aria-hidden>
          <img src="/app-icon.png" alt="" />
        </span>
        <span>LumeAny</span>
      </div>
      {rows.map(([k, v]) => (
        <div className="about-row" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
      {!noticeShown && (
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
      )}
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

