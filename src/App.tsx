import { useEffect, useRef, useState, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { FormatOption, JobRecord, VideoInfo } from "./types";
import {
  cancelDownload,
  enqueueDownload,
  listJobs,
  onJobProgress,
  onJobStatus,
  onLogLine,
  probeVideo,
  type UnlistenFn,
} from "./lib/tauri";
import { loadAutoMode, loadOutputDir, saveAutoMode, saveOutputDir } from "./lib/settings";
import { UrlBar } from "./components/UrlBar";
import { FormatBar } from "./components/VideoCard";
import { QueueList } from "./components/QueueList";
import { PlatformWall } from "./components/PlatformWall";
import "./App.css";

const LOG_CAP = 500;
const TERMINAL: JobRecord["status"][] = ["completed", "failed", "cancelled"];

type View = "download" | "history";
type ParsedVideo = { key: string; order: number; url: string; info: VideoInfo };

function App() {
  const [videos, setVideos] = useState<ParsedVideo[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<number, JobRecord>>({});
  const [logs, setLogs] = useState<Record<number, string[]>>({});
  const [outputDir, setOutputDir] = useState("");
  const [autoMode, setAutoMode] = useState(false);
  const [autoJobIds, setAutoJobIds] = useState<number[]>([]);
  const [autoCancelling, setAutoCancelling] = useState(false);
  const autoCancelRequested = useRef(false);
  const [view, setView] = useState<View>("download");

  useEffect(() => {
    (async () => {
      try {
        const existing = await listJobs();
        if (existing.length) setJobs(Object.fromEntries(existing.map((j) => [j.id, j])));
        const [dir, auto] = await Promise.all([loadOutputDir(), loadAutoMode()]);
        setOutputDir(dir);
        setAutoMode(auto);
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
    reg(onJobStatus((s) => upsert(s.jobId, { status: s.status, error: s.error, outputPath: s.outputPath })));
    reg(
      onLogLine((l) =>
        setLogs((prev) => {
          const arr = prev[l.jobId] ?? [];
          const next =
            arr.length >= LOG_CAP ? [...arr.slice(arr.length - LOG_CAP + 1), l.line] : [...arr, l.line];
          return { ...prev, [l.jobId]: next };
        }),
      ),
    );
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
          title: `任务 #${id}`,
          formatId: "",
          formatLabel: "",
          status: "queued",
          percent: 0,
          downloadedBytes: 0,
        };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }

  /** 探测；自动模式下直接以首个格式（最佳画质+音频）入队 */
  async function handleStart(urls: string[]) {
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
          try {
            const info = await probeVideo(url);
            if (autoMode && info.formats[0]) {
              if (autoCancelRequested.current) continue;
              const id = await enqueue(info.formats[0], url, info.title);
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
            failures.push(`${url}\n${String(e)}`);
          }
        }
      });
      await Promise.all(workers);
      if (failures.length) {
        setError(`${failures.length} 个链接解析失败：\n${failures.join("\n\n")}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function enqueue(
    format: FormatOption,
    url: string,
    title?: string,
  ): Promise<number | undefined> {
    if (!outputDir) return;
    try {
      const id = await enqueueDownload({
        url,
        formatId: format.id,
        outputDir,
        title,
        formatLabel: format.label,
      });
      upsert(id, {
        url,
        title: title ?? `任务 #${id}`,
        formatId: format.id,
        formatLabel: format.label,
      });
      setView("download");
      return id;
    } catch (e) {
      setError(String(e));
    }
  }

  function handleRetry(job: JobRecord) {
    enqueue({ id: job.formatId, label: job.formatLabel, filesize: null }, job.url, job.title).catch(
      () => {},
    );
  }

  async function pickDir() {
    const sel = await open({ directory: true, defaultPath: outputDir, title: "选择下载目录" });
    if (typeof sel === "string") {
      setOutputDir(sel);
      saveOutputDir(sel).catch(console.error);
    }
  }

  function toggleAuto(v: boolean) {
    setAutoMode(v);
    saveAutoMode(v).catch(console.error);
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

  const all = Object.values(jobs).sort((a, b) => b.id - a.id);
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
      <aside className="side">
        <div className="brand">
          <span className="gem" aria-hidden>
            <svg viewBox="0 0 20 20" width="16" height="16">
              <path
                d="M10 3.5 16.5 10 10 16.5 3.5 10 10 3.5Z"
                fill="currentColor"
                opacity=".9"
              />
            </svg>
          </span>
          <span className="word">DownloadAny</span>
        </div>
        <nav aria-label="主导航">
          <button
            className={view === "download" ? "nav on" : "nav"}
            onClick={(event) => {
              showNavRipple(event);
              setView("download");
            }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
              <path
                d="M8 2.5v7m0 0L5.2 6.7M8 9.5l2.8-2.8M3 12.5h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>下载</span>
            {running > 0 && <span className="count">{running}</span>}
          </button>
          <button
            className={view === "history" ? "nav on" : "nav"}
            onClick={(event) => {
              showNavRipple(event);
              setView("history");
            }}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v3.2l2.2 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>历史</span>
          </button>
        </nav>
        <button
          className="account-entry"
          type="button"
          title="登录功能待接入"
          aria-label="登录账户"
        >
          <span className="account-avatar" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <circle cx="12" cy="8.5" r="3.5" fill="currentColor" />
              <path d="M5.5 19c.5-3.2 2.7-5 6.5-5s6 1.8 6.5 5" fill="currentColor" />
            </svg>
          </span>
          <span className="account-copy">
            <strong>未登录</strong>
            <small>点击登录</small>
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
      </aside>

      <main className="main">
        {view === "download" ? (
          <>
            <header className="head">
              <h1>视频 / 音频下载器</h1>
              <label className={`auto${busy || autoDownloadActive ? " disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={autoMode}
                  disabled={busy || autoDownloadActive}
                  onChange={(e) => toggleAuto(e.target.checked)}
                  aria-label="自动下载"
                />
                <span className="sw" aria-hidden />
                自动下载
              </label>
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
            <h1>历史记录</h1>
          </header>
        )}

        {all.length > 0 && view === "history" && (
          <div className="stats">
            {all.length} 项
            {running > 0 && <em> · {running} 下载中</em>}
            {done > 0 && <em> · {done} 已完成</em>}
          </div>
        )}

        {view === "download" ? (
          videos.length ? (
            <section className="format-results" aria-label="解析结果">
              {videos.map((item) => (
                <FormatBar
                  key={item.key}
                  video={item.info}
                  busy={false}
                  outputDir={outputDir}
                  jobs={jobs}
                  onDownload={(format) => enqueue(format, item.url, item.info.title)}
                  onCancel={cancel}
                  onDiscard={() => setVideos((current) => current.filter((video) => video.key !== item.key))}
                />
              ))}
            </section>
          ) : <PlatformWall />
        ) : (
          <section className="list" aria-label={view === "history" ? "历史任务" : "下载队列"}>
            <QueueList jobs={visible} logs={logs} outputDir={outputDir} onCancel={cancel} onRetry={handleRetry} />
          </section>
        )}

        <footer className="savebar">
          <span className="lab">保存到</span>
          <span className="dir" title={outputDir}>
            {outputDir || "…"}
          </span>
          <button className="chg" onClick={pickDir}>
            更改目录
          </button>
        </footer>
      </main>
    </div>
  );

  function cancel(id: number) {
    cancelDownload(id).catch((e) => setError(String(e)));
  }
}

export default App;
