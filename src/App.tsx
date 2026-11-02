import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { DependencyInfo, FormatOption, JobRecord, VideoInfo } from "./types";
import {
  cancelDownload,
  dependencyInfo,
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
import "./App.css";

const LOG_CAP = 500;
const TERMINAL: JobRecord["status"][] = ["completed", "failed", "cancelled"];

type View = "download" | "history";

function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [currentUrl, setCurrentUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<number, JobRecord>>({});
  const [logs, setLogs] = useState<Record<number, string[]>>({});
  const [outputDir, setOutputDir] = useState("");
  const [deps, setDeps] = useState<DependencyInfo | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [view, setView] = useState<View>("download");

  useEffect(() => {
    (async () => {
      try {
        const existing = await listJobs();
        if (existing.length) setJobs(Object.fromEntries(existing.map((j) => [j.id, j])));
        const [dir, auto] = await Promise.all([loadOutputDir(), loadAutoMode()]);
        setOutputDir(dir);
        setAutoMode(auto);
        setDeps(await dependencyInfo());
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
  async function handleStart(url: string) {
    setBusy(true);
    setError(null);
    setVideo(null);
    setCurrentUrl(url);
    try {
      const info = await probeVideo(url);
      if (autoMode && info.formats[0]) {
        await enqueue(info.formats[0], url, info.title);
      } else {
        setVideo(info);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function enqueue(format: FormatOption, url = currentUrl, title?: string) {
    if (!outputDir) return;
    try {
      const id = await enqueueDownload({
        url,
        formatId: format.id,
        outputDir,
        title: title ?? video?.title,
        formatLabel: format.label,
      });
      upsert(id, {
        url,
        title: title ?? video?.title ?? `任务 #${id}`,
        formatId: format.id,
        formatLabel: format.label,
      });
      setVideo(null);
      setView("download");
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

  const all = Object.values(jobs).sort((a, b) => b.id - a.id);
  const visible = view === "history" ? all.filter((j) => TERMINAL.includes(j.status)) : all;
  const running = all.filter((j) => j.status === "running").length;
  const done = all.filter((j) => j.status === "completed").length;

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
          <button className={view === "download" ? "nav on" : "nav"} onClick={() => setView("download")}>
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
          <button className={view === "history" ? "nav on" : "nav"} onClick={() => setView("history")}>
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none">
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v3.2l2.2 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>历史</span>
          </button>
        </nav>
        <div className="side-foot" title={deps?.ytDlpPath}>
          {deps
            ? `yt-dlp ${deps.ytDlpVersion ?? "未找到"} · FFmpeg ${deps.ffmpegVersion ?? "未找到"}`
            : "检测依赖中…"}
        </div>
      </aside>

      <main className="main">
        <header className="head">
          <h1>视频 / 音频下载器</h1>
          <label className="auto">
            <input
              type="checkbox"
              checked={autoMode}
              onChange={(e) => toggleAuto(e.target.checked)}
              aria-label="自动下载"
            />
            <span className="sw" aria-hidden />
            自动下载
          </label>
        </header>

        <UrlBar busy={busy} autoMode={autoMode} error={error} onSubmit={handleStart} />

        {video && (
          <FormatBar
            video={video}
            busy={false}
            onDownload={(f) => enqueue(f)}
            onDiscard={() => setVideo(null)}
          />
        )}

        {all.length > 0 && (
          <div className="stats">
            {all.length} 项
            {running > 0 && <em> · {running} 下载中</em>}
            {done > 0 && <em> · {done} 已完成</em>}
          </div>
        )}

        <section className="list" aria-label={view === "history" ? "历史任务" : "下载队列"}>
          <QueueList jobs={visible} logs={logs} onCancel={cancel} onRetry={handleRetry} />
        </section>

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
