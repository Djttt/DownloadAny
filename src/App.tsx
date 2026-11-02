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
import { loadOutputDir, saveOutputDir } from "./lib/settings";
import { ProbeForm } from "./components/ProbeForm";
import { VideoCard } from "./components/VideoCard";
import { QueueList } from "./components/QueueList";
import "./App.css";

const LOG_CAP = 500;

function App() {
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [currentUrl, setCurrentUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<number, JobRecord>>({});
  const [logs, setLogs] = useState<Record<number, string[]>>({});
  const [outputDir, setOutputDir] = useState("");
  const [deps, setDeps] = useState<DependencyInfo | null>(null);

  // 初始化：hydration 现有队列（页面热重载后 Rust 状态仍在）、设置、依赖
  useEffect(() => {
    (async () => {
      try {
        const existing = await listJobs();
        if (existing.length) {
          setJobs(Object.fromEntries(existing.map((j) => [j.id, j])));
        }
        setOutputDir(await loadOutputDir());
        setDeps(await dependencyInfo());
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  // 事件订阅
  useEffect(() => {
    const unlisten: UnlistenFn[] = [];
    let disposed = false;
    const reg = (p: Promise<UnlistenFn>) =>
      p.then((f) => (disposed ? f() : unlisten.push(f)));

    reg(
      onJobProgress((p) =>
        upsert(p.jobId, {
          percent: p.percent,
          downloadedBytes: p.downloadedBytes,
          totalBytes: p.totalBytes,
          speed: p.speed,
          eta: p.eta,
        }),
      ),
    );
    reg(
      onJobStatus((s) =>
        upsert(s.jobId, { status: s.status, error: s.error, outputPath: s.outputPath }),
      ),
    );
    reg(
      onLogLine((l) =>
        setLogs((prev) => {
          const arr = prev[l.jobId] ?? [];
          const next = arr.length >= LOG_CAP ? [...arr.slice(arr.length - LOG_CAP + 1), l.line] : [...arr, l.line];
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
          formatLabel: "",
          status: "queued",
          percent: 0,
          downloadedBytes: 0,
        };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }

  async function handleProbe(url: string) {
    setProbing(true);
    setError(null);
    setVideo(null);
    setCurrentUrl(url);
    try {
      setVideo(await probeVideo(url));
    } catch (e) {
      setError(String(e));
    } finally {
      setProbing(false);
    }
  }

  async function handleDownload(format: FormatOption) {
    if (!video || !outputDir) return;
    setEnqueuing(true);
    setError(null);
    try {
      const id = await enqueueDownload({
        url: currentUrl,
        formatId: format.id,
        outputDir,
        title: video.title,
        formatLabel: format.label,
      });
      // 补全展示字段（事件可能已先创建骨架记录，故不覆盖 status）
      upsert(id, { url: currentUrl, title: video.title, formatLabel: format.label });
    } catch (e) {
      setError(String(e));
    } finally {
      setEnqueuing(false);
    }
  }

  async function pickDir() {
    const sel = await open({ directory: true, defaultPath: outputDir, title: "选择下载目录" });
    if (typeof sel === "string") {
      setOutputDir(sel);
      saveOutputDir(sel).catch(console.error);
    }
  }

  function handleCancel(jobId: number) {
    cancelDownload(jobId).catch((e) => setError(String(e)));
  }

  const jobList = Object.values(jobs).sort((a, b) => b.id - a.id);

  return (
    <div className="app">
      <header>
        <h1>DownloadAny</h1>
        <button className="dir" onClick={pickDir} title="更改下载目录">
          保存到：{outputDir || "…"}
        </button>
      </header>

      <ProbeForm probing={probing} error={error} onProbe={handleProbe} />

      {video && <VideoCard video={video} downloading={enqueuing} onDownload={handleDownload} />}

      <section className="queue-section">
        <h2>下载队列</h2>
        <QueueList jobs={jobList} logs={logs} onCancel={handleCancel} />
      </section>

      <footer className="deps">
        {deps
          ? `yt-dlp ${deps.ytDlpVersion ?? "未找到"}（${deps.ytDlpSource}） · FFmpeg ${
              deps.ffmpegVersion ?? "未找到"
            }（${deps.ffmpegSource}）`
          : "检测依赖中…"}
      </footer>
    </div>
  );
}

export default App;
