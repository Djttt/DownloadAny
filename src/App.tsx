import { useEffect, useRef, useState, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { FormatOption, JobRecord, VideoInfo } from "./types";
import {
  cancelDownload,
  enqueueDownload,
  listJobs,
  onJobProgress,
  onJobStatus,
  probeVideo,
  setMaxConcurrency,
  updateYtdlpComponent,
  type UnlistenFn,
} from "./lib/tauri";
import {
  CONCURRENCY_DEFAULT,
  CONCURRENCY_MAX,
  CONCURRENCY_MIN,
  buildProxyUrl,
  loadAutoMode,
  loadLangPref,
  loadMaxConcurrency,
  loadOutputDir,
  loadProxyAddr,
  loadProxyType,
  loadThemePref,
  loadUpdateChannel,
  saveAutoMode,
  saveMaxConcurrency,
  saveOutputDir,
  saveProxyAddr,
  saveProxyType,
  type ProxyType,
} from "./lib/settings";
import { setLangPref, t, useLang } from "./lib/i18n";
import { setThemePref } from "./lib/theme";
import { analyticsContext, trackAnalyticsEvent } from "./lib/analytics";
import { loadDownloadHistory, saveDownloadHistory } from "./lib/history";
import { restoreUser, type AuthUser } from "./lib/auth";
import { useAppUpdater } from "./lib/updater";
import { Icon } from "./components/Icon";
import { UrlBar } from "./components/UrlBar";
import { AuthModal } from "./components/AuthModal";
import { FormatBar } from "./components/VideoCard";
import { QueueList } from "./components/QueueList";
import { PlatformWall } from "./components/PlatformWall";
import {
  AccountMenuItem,
  FeedbackModal,
  SettingsModal,
  SupportMenuItem,
  UpdateNotice,
  menuIcons,
} from "./components/SideMenu";
import "./App.css";

const TERMINAL: JobRecord["status"][] = ["completed", "failed", "cancelled"];

type View = "download" | "history";
type Dialog = "feedback" | "settings";
type ParsedVideo = { key: string; order: number; url: string; info: VideoInfo };
type AppMessage = { id: number; text: string; type: "success" | "error" | "info" };

function App() {
  useLang(); // 订阅语言切换：偏好变化时整树重渲染
  const [videos, setVideos] = useState<ParsedVideo[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<number, JobRecord>>({});
  const [historyJobs, setHistoryJobs] = useState<JobRecord[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [maxConcurrency, setMaxConcurrencyState] = useState(CONCURRENCY_DEFAULT);
  const [proxyType, setProxyTypeState] = useState<ProxyType>("none");
  const [proxyAddr, setProxyAddrState] = useState("");
  // 组装一次、两处消费：probeVideo 与 enqueueDownload 都带上，探测/下载走同一代理
  const proxyUrl = buildProxyUrl(proxyType, proxyAddr);
  const [autoJobIds, setAutoJobIds] = useState<number[]>([]);
  const [autoCancelling, setAutoCancelling] = useState(false);
  const autoCancelRequested = useRef(false);
  const analyticsJobs = useRef<Record<number, Pick<JobRecord, "url" | "title" | "formatId" | "formatLabel">>>({});
  const trackedTerminalEvents = useRef(new Set<string>());
  const historyIds = useRef<Record<number, string>>({});
  const [view, setView] = useState<View>("download");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const pendingParse = useRef<string[] | null>(null);
  const [message, setMessage] = useState<AppMessage | null>(null);
  const messageTimer = useRef(0);
  const updater = useAppUpdater(
    Object.values(jobs).some((job) => job.status === "queued" || job.status === "running"),
  );

  function showMessage(text: string, type: AppMessage["type"]) {
    window.clearTimeout(messageTimer.current);
    setMessage({ id: Date.now(), text, type });
    messageTimer.current = window.setTimeout(() => setMessage(null), 4500);
  }

  useEffect(() => {
    let alive = true;
    restoreUser()
      .then((restored) => {
        if (alive) setUser(restored);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => window.clearTimeout(messageTimer.current), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([analyticsContext(), loadUpdateChannel()])
        .then(([context, channel]) => updateYtdlpComponent(channel, context.deviceId))
        .catch(() => {}); // 组件更新是尽力而为，失败不影响解析和下载。
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const existing = await listJobs();
        if (existing.length) {
          setJobs(Object.fromEntries(existing.map((j) => [j.id, j])));
          analyticsJobs.current = Object.fromEntries(existing.map((job) => [job.id, job]));
        }
        const [dir, auto, conc, lang, pType, pAddr, theme, history] = await Promise.all([
          loadOutputDir(),
          loadAutoMode(),
          loadMaxConcurrency(),
          loadLangPref(),
          loadProxyType(),
          loadProxyAddr(),
          loadThemePref(),
          loadDownloadHistory(),
        ]);
        setOutputDir(dir);
        setAutoMode(auto);
        setLangPref(lang);
        setThemePref(theme);
        setMaxConcurrencyState(conc);
        setProxyTypeState(pType);
        setProxyAddrState(pAddr);
        setHistoryJobs(history);
        await setMaxConcurrency(conc); // 把持久化的偏好推给 Rust 队列
        void trackAnalyticsEvent("app_open");
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    const unlisten: UnlistenFn[] = [];
    let disposed = false;
    const reg = (p: Promise<UnlistenFn>) => p.then((f) => (disposed ? f() : unlisten.push(f)));

    reg(
      onJobProgress((p) =>
        upsert(p.jobId, {
          percent: p.percent,
          downloadedBytes: p.downloadedBytes,
          totalBytes: p.totalBytes,
          speed: p.speed,
          eta: p.eta,
          status: "running", // 有进度说明已在跑
        }),
      ),
    );
    reg(onJobStatus((s) => {
      upsert(s.jobId, { status: s.status, error: s.error, outputPath: s.outputPath });
      const eventType = s.status === "completed"
        ? "download_completed"
        : s.status === "failed"
          ? "download_failed"
          : s.status === "cancelled"
            ? "download_cancelled"
            : null;
      const job = analyticsJobs.current[s.jobId];
      const eventKey = `${s.jobId}:${s.status}`;
      if (eventType && job && !trackedTerminalEvents.current.has(eventKey)) {
        trackedTerminalEvents.current.add(eventKey);
        void trackAnalyticsEvent(eventType, {
          mediaTitle: job.title,
          mediaUrl: job.url,
          formatId: job.formatId,
          formatLabel: job.formatLabel,
          error: s.error ?? undefined,
        });
      }
    }));
    return () => {
      disposed = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  function upsert(id: number, patch: Partial<JobRecord>) {
    setJobs((prev) => {
      const cur: JobRecord =
        prev[id] ?? {
          id,
          url: "",
          title: t("task.fallback", { id }),
          formatId: "",
          formatLabel: "",
          status: "queued",
          percent: 0,
          downloadedBytes: 0,
        };
      let next = { ...cur, ...patch };
      const becameTerminal = !TERMINAL.includes(cur.status) && TERMINAL.includes(next.status);
      if (becameTerminal) {
        const historyId = historyIds.current[id] ?? crypto.randomUUID();
        const savedAt = Date.now();
        historyIds.current[id] = historyId;
        next = { ...next, savedAt };
        void saveDownloadHistory({ ...next, historyId }).catch(console.error);
      }
      return { ...prev, [id]: next };
    });
  }

  /** 探测；自动模式下直接以首个格式（最佳画质+音频）入队 */
  async function handleStart(urls: string[]) {
    const activeUser = await restoreUser();
    setUser(activeUser);
    if (!activeUser) {
      pendingParse.current = urls;
      showMessage(t("auth.loginToParse"), "info");
      setAuthOpen(true);
      return;
    }
    await startParse(urls);
  }

  async function startParse(urls: string[]) {
    setBusy(true);
    setError(null);
    setVideos([]);
    setAutoJobIds([]);
    setAutoCancelling(false);
    autoCancelRequested.current = false;
    const failures: string[] = [];
    try {
      // 控制并发数，批量链接较多时避免同时启动过多 yt-dlp 进程。
      const pending = [...urls];
      const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (pending.length) {
          const url = pending.shift();
          if (!url) break;
          void trackAnalyticsEvent("parse_requested", { mediaUrl: url });
          try {
            const info = await probeVideo(url, proxyUrl);
            void trackAnalyticsEvent("parse_succeeded", {
              mediaId: info.id,
              mediaTitle: info.title,
              mediaUrl: url,
            });
            if (autoMode && info.formats[0]) {
              if (autoCancelRequested.current) continue;
              const id = await enqueue(info.formats[0], url, info.title, info.id);
              if (id != null) {
                if (autoCancelRequested.current) {
                  cancelDownload(id).catch(() => {});
                } else {
                  setAutoJobIds((current) => [...current, id]);
                }
              }
            } else {
              const item = { key: `${url}-${info.id}`, order: urls.indexOf(url), url, info };
              setVideos((current) => [...current, item].sort((a, b) => a.order - b.order));
            }
          } catch (e) {
            void trackAnalyticsEvent("parse_failed", { mediaUrl: url, error: String(e) });
            failures.push(`${url}\n${String(e)}`);
          }
        }
      });
      await Promise.all(workers);
      if (failures.length) {
        setError(`${t("probe.failedCount", { n: failures.length })}\n${failures.join("\n\n")}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function enqueue(
    format: FormatOption,
    url: string,
    title?: string,
    mediaId?: string,
  ): Promise<number | undefined> {
    if (!outputDir) return;
    try {
      const id = await enqueueDownload({
        url,
        formatId: format.id,
        outputDir,
        title,
        formatLabel: format.label,
        proxy: proxyUrl,
      });
      upsert(id, {
        url,
        title: title ?? t("task.fallback", { id }),
        formatId: format.id,
        formatLabel: format.label,
      });
      analyticsJobs.current[id] = {
        url,
        title: title ?? t("task.fallback", { id }),
        formatId: format.id,
        formatLabel: format.label,
      };
      void trackAnalyticsEvent("download_started", {
        mediaId,
        mediaTitle: title,
        mediaUrl: url,
        formatId: format.id,
        formatLabel: format.label,
      });
      setView("download");
      return id;
    } catch (e) {
      setError(String(e));
    }
  }

  async function pickDir() {
    const sel = await open({ directory: true, defaultPath: outputDir, title: t("dir.pickerTitle") });
    if (typeof sel === "string") {
      setOutputDir(sel);
      saveOutputDir(sel).catch(console.error);
    }
  }

  function toggleAuto(v: boolean) {
    setAutoMode(v);
    saveAutoMode(v).catch(console.error);
  }

  /** 代理偏好：状态 → 持久化；下次解析/下载即生效（invoke 时现取 proxyUrl） */
  function applyProxy(type: ProxyType, addr: string) {
    setProxyTypeState(type);
    setProxyAddrState(addr);
    saveProxyType(type).catch(() => {});
    saveProxyAddr(addr).catch(() => {});
  }

  /** 并发上限：钳制 → 状态 → 持久化 → 推给 Rust 立即生效 */
  function applyMaxConcurrency(n: number) {
    const v = Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, n));
    setMaxConcurrencyState(v);
    saveMaxConcurrency(v).catch(console.error);
    setMaxConcurrency(v).catch(console.error);
  }

  async function cancelAutoDownload() {
    autoCancelRequested.current = true;
    setAutoCancelling(true);
    const activeIds = autoJobIds.filter((id) => {
      const status = jobs[id]?.status;
      return status === "queued" || status === "running";
    });
    await Promise.all(activeIds.map((id) => cancelDownload(id).catch(() => {})));
    setAutoCancelling(false);
  }

  function showNavRipple(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.8;
    const ripple = document.createElement("span");
    ripple.className = "nav-ripple";
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    button.appendChild(ripple);

    const remove = () => ripple.remove();
    ripple.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, 650);
  }

  const all = [...Object.values(jobs), ...historyJobs].sort(
    (a, b) => (b.savedAt ?? b.id) - (a.savedAt ?? a.id),
  );
  const visible = view === "history" ? all.filter((j) => TERMINAL.includes(j.status)) : all;
  const running = all.filter((j) => j.status === "running").length;
  const done = all.filter((j) => j.status === "completed").length;
  const autoJobs = autoJobIds.map((id) => jobs[id]).filter((job): job is JobRecord => Boolean(job));
  const autoDownloadActive = autoJobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  const autoDownloadProgress =
    autoJobIds.length > 0 && (busy || autoDownloadActive)
      ? autoJobIds.reduce((total, id) => {
          const job = jobs[id];
          if (job?.status === "completed") return total + 100;
          return total + Math.min(100, Math.max(0, job?.percent ?? 0));
        }, 0) / autoJobIds.length
      : null;

  return (
    <div className="shell">
      {message && (
        <div key={message.id} className={`app-message ${message.type}`} role="alert" aria-live="assertive">
          <span className="app-message-icon" aria-hidden>{message.type === "success" ? "✓" : message.type === "error" ? "!" : "i"}</span>
          <span>{message.text}</span>
          <button type="button" aria-label={t("common.close")} onClick={() => setMessage(null)}>×</button>
        </div>
      )}
      <UpdateNotice updater={updater} />
      <aside className="side">
        <div className="brand">
          <span className="gem" aria-hidden>
            <img src="/app-icon.png" alt="" />
          </span>
          <span className="word">LumeAny</span>
        </div>
        <nav aria-label={t("nav.mainAria")}>
          <button
            className={view === "download" ? "nav on" : "nav"}
            onClick={(event) => {
              showNavRipple(event);
              setView("download");
            }}
          >
            <Icon name="download" size={15} />
            <span>{t("nav.download")}</span>
            {running > 0 && <span className="count">{running}</span>}
          </button>
          <button
            className={view === "history" ? "nav on" : "nav"}
            onClick={(event) => {
              showNavRipple(event);
              setView("history");
            }}
          >
            <Icon name="history" size={15} />
            <span>{t("nav.history")}</span>
          </button>
        </nav>
        <div className="side-menu">
          <SupportMenuItem />
          <button className="menu-row" type="button" onClick={() => setDialog("feedback")}>
            {menuIcons.feedback}
            <span>{t("menu.feedback")}</span>
          </button>
          <button className="menu-row" type="button" onClick={() => setDialog("settings")}>
            {menuIcons.gear}
            <span>{t("menu.settings")}</span>
          </button>
        </div>
        <AccountMenuItem user={user} onUserChange={setUser} onRequestLogin={() => setAuthOpen(true)} />
      </aside>

      <main className="main">
        {view === "download" ? (
          <>
            <header className="head">
              <h1>{t("app.title")}</h1>
            </header>
            <UrlBar
              value={urlInput}
              busy={busy || autoDownloadActive}
              autoMode={autoMode}
              downloadProgress={autoMode ? autoDownloadProgress : null}
              cancelling={autoCancelling}
              error={error}
              onValueChange={setUrlInput}
              onSubmit={handleStart}
              onCancelDownload={cancelAutoDownload}
            />
          </>
        ) : (
          <header className="head history-head">
            <h1>{t("app.historyTitle")}</h1>
          </header>
        )}

        {all.length > 0 && view === "history" && (
          <div className="stats">
            {t("stats.items", { n: all.length })}
            {running > 0 && <em> {t("stats.downloading", { n: running })}</em>}
            {done > 0 && <em> {t("stats.completed", { n: done })}</em>}
          </div>
        )}

        {/* 页面切换时保留解析卡片实例，避免 FormatBar 内的下载任务关联被重置。 */}
        <div style={{ display: view === "download" ? "contents" : "none" }}>
          {videos.length ? (
            <section className="format-results" aria-label={t("app.probeAria")}>
              {videos.map((item) => (
                <FormatBar
                  key={item.key}
                  video={item.info}
                  busy={false}
                  outputDir={outputDir}
                  jobs={jobs}
                  onDownload={(format) => enqueue(format, item.url, item.info.title, item.info.id)}
                  onCancel={cancel}
                  onDiscard={() => setVideos((current) => current.filter((video) => video.key !== item.key))}
                />
              ))}
            </section>
          ) : <PlatformWall />}
        </div>

        {view === "history" && (
          <section className="list" aria-label={t("app.listAriaHistory")}>
            <QueueList jobs={visible} outputDir={outputDir} onCancel={cancel} />
          </section>
        )}

      </main>

      {dialog === "feedback" && <FeedbackModal onClose={() => setDialog(null)} />}
      {authOpen && (
        <AuthModal
          onClose={() => {
            setAuthOpen(false);
            pendingParse.current = null;
          }}
          onAuthenticated={(authenticatedUser) => {
            setUser(authenticatedUser);
            showMessage(t("auth.loginSuccess"), "success");
            const urls = pendingParse.current;
            pendingParse.current = null;
            if (urls) void startParse(urls);
          }}
          onMessage={showMessage}
        />
      )}
      {dialog === "settings" && (
        <SettingsModal
          outputDir={outputDir}
          autoMode={autoMode}
          autoDisabled={busy || autoDownloadActive}
          maxConcurrency={maxConcurrency}
          proxyType={proxyType}
          proxyAddr={proxyAddr}
          onPickDir={pickDir}
          onToggleAuto={toggleAuto}
          onSetMaxConcurrency={applyMaxConcurrency}
          onSetProxy={applyProxy}
          updater={updater}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );

  function cancel(id: number) {
    cancelDownload(id).catch((e) => setError(String(e)));
  }
}

export default App;
