//! 任务队列：内存队列 + Semaphore 并发控制 + 子进程生命周期管理。
//! v1 不做持久化，应用重启即清空（设计决策）。

use crate::args;
use crate::error::{AppError, JobStatus};
use crate::progress::{self, ProgressUpdate};
use crate::probe;
use crate::resolve;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Semaphore};

/// v1 固定并发上限（设置页可调为后续项）
const MAX_CONCURRENT: usize = 3;
/// stderr/stdout 静默看门狗阈值
const WATCHDOG_SILENCE: Duration = Duration::from_secs(120);
/// SIGTERM 后等待优雅退出的时间，超时则 SIGKILL
const GRACEFUL_KILL_WAIT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: u64,
    pub url: String,
    pub title: String,
    /// 重试时原样重新入队（types.ts 同步）
    pub format_id: String,
    pub format_label: String,
    pub status: JobStatus,
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub job_id: u64,
    pub status: JobStatus,
    pub error: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLineEvent {
    pub job_id: u64,
    pub line: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub url: String,
    pub format_id: String,
    pub output_dir: String,
    /// 展示用元数据（来自前端已探测的结果，不参与命令拼装）
    pub title: Option<String>,
    pub format_label: Option<String>,
}

struct JobControl {
    cancelled: AtomicBool,
    pid: AtomicU32,
}

struct Inner {
    jobs: Mutex<HashMap<u64, JobRecord>>,
    controls: Mutex<HashMap<u64, Arc<JobControl>>>,
    next_id: AtomicU64,
    sem: Semaphore,
    /// url -> 该次探测返回的真实 format_id 集合（入队白名单校验）
    probed: Mutex<HashMap<String, HashSet<String>>>,
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                jobs: Mutex::new(HashMap::new()),
                controls: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(0),
                sem: Semaphore::new(MAX_CONCURRENT),
                probed: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn cache_probe_ids(&self, url: &str, ids: HashSet<String>) {
        self.inner
            .probed
            .lock()
            .unwrap()
            .insert(url.to_string(), ids);
    }

    fn control(&self, id: u64) -> Arc<JobControl> {
        self.inner
            .controls
            .lock()
            .unwrap()
            .entry(id)
            .or_insert_with(|| {
                Arc::new(JobControl {
                    cancelled: AtomicBool::new(false),
                    pid: AtomicU32::new(0),
                })
            })
            .clone()
    }

    fn update(&self, id: u64, f: impl FnOnce(&mut JobRecord)) {
        if let Some(rec) = self.inner.jobs.lock().unwrap().get_mut(&id) {
            f(rec);
        }
    }

    fn snapshot(&self, id: u64) -> Option<JobRecord> {
        self.inner.jobs.lock().unwrap().get(&id).cloned()
    }

    pub fn list(&self) -> Vec<JobRecord> {
        let mut jobs: Vec<JobRecord> = self.inner.jobs.lock().unwrap().values().cloned().collect();
        jobs.sort_by_key(|j| j.id);
        jobs
    }

    pub fn validate_format(&self, url: &str, format_id: &str) -> Result<(), AppError> {
        let cache = self.inner.probed.lock().unwrap();
        let ids = cache
            .get(url)
            .ok_or_else(|| AppError::InvalidFormat("请先解析该链接再下载".into()))?;
        args::validate_format(format_id, ids)
    }
}

/// 入队：校验参数 → 建任务记录 → spawn 异步执行（内部等 permit 限并发）
pub async fn enqueue(app: &AppHandle, state: &AppState, opts: DownloadOptions) -> Result<u64, AppError> {
    args::validate_url(&opts.url)?;
    state.validate_format(&opts.url, &opts.format_id)?;
    tokio::fs::create_dir_all(&opts.output_dir).await?;

    let id = state.inner.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let record = JobRecord {
        id,
        url: opts.url.clone(),
        title: opts.title.clone().unwrap_or_else(|| opts.url.clone()),
        format_id: opts.format_id.clone(),
        format_label: opts.format_label.clone().unwrap_or_else(|| opts.format_id.clone()),
        status: JobStatus::Queued,
        percent: 0.0,
        downloaded_bytes: 0,
        total_bytes: None,
        speed: None,
        eta: None,
        output_path: None,
        error: None,
    };
    state.inner.jobs.lock().unwrap().insert(id, record.clone());
    state.control(id);

    emit_status(app, &record);

    let app2 = app.clone();
    let state2 = state.clone();
    tokio::spawn(async move { run_job(app2, state2, id, opts).await });
    Ok(id)
}

pub fn cancel(state: &AppState, job_id: u64) -> Result<(), AppError> {
    state
        .snapshot(job_id)
        .ok_or(AppError::JobNotFound(job_id))?;
    let control = state.control(job_id);
    let already_done = matches!(
        state.snapshot(job_id).unwrap().status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
    );
    if already_done {
        return Ok(());
    }
    control.cancelled.store(true, Ordering::SeqCst);
    let pid = control.pid.load(Ordering::SeqCst);
    if pid > 0 {
        // 排队中的任务（pid==0）由 run_job 拿到 permit 后自行检查 cancelled 标志
        kill_tree(pid);
    }
    Ok(())
}

fn emit_status(app: &AppHandle, rec: &JobRecord) {
    let payload = StatusEvent {
        job_id: rec.id,
        status: rec.status,
        error: rec.error.clone(),
        output_path: rec.output_path.clone(),
    };
    let _ = app.emit("job-status", payload);
}

fn emit_log(app: &AppHandle, job_id: u64, line: String) {
    let _ = app.emit("log-line", LogLineEvent { job_id, line });
}

/// 跨平台终止整个进程树：yt-dlp 会派生 FFmpeg 孙进程，
/// 只杀父进程会留下孤儿继续写盘。
fn kill_tree(pid: u32) {
    #[cfg(unix)]
    {
        // run_job 中子进程 process_group(0)，pgid == pid，负号表示杀整个进程组
        let term = format!("-{}", pid);
        if let Ok(mut child) = std::process::Command::new("kill")
            .args(["-TERM", &term])
            .spawn()
        {
            let pid_for_kill = pid;
            std::thread::spawn(move || {
                let _ = child.wait();
                std::thread::sleep(GRACEFUL_KILL_WAIT);
                let _ = std::process::Command::new("kill")
                    .args(["-KILL", &format!("-{}", pid_for_kill)])
                    .spawn();
            });
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .spawn();
    }
}

/// 逐行读一个管道并转发（空行跳过），EOF 后结束
async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    tx: mpsc::UnboundedSender<String>,
) {
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if !line.trim().is_empty() && tx.send(line).is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

async fn run_job(app: AppHandle, state: AppState, id: u64, opts: DownloadOptions) {
    // 并发闸：拿不到 permit 就排队
    let Ok(permit) = state.inner.sem.acquire().await else {
        return;
    };
    let control = state.control(id);
    if control.cancelled.load(Ordering::SeqCst) {
        state.update(id, |r| r.status = JobStatus::Cancelled);
        if let Some(rec) = state.snapshot(id) {
            emit_status(&app, &rec);
        }
        return;
    }
    state.update(id, |r| r.status = JobStatus::Running);
    if let Some(rec) = state.snapshot(id) {
        emit_status(&app, &rec);
    }

    // ---- 组装并启动进程 ----
    let yt_dlp = resolve::yt_dlp();
    let ffmpeg = resolve::ffmpeg();
    let ffmpeg_loc = ffmpeg.ffmpeg_location();
    let cmd_args =
        args::build_download_args(&opts.format_id, &opts.url, &opts.output_dir, ffmpeg_loc.as_deref());

    let mut cmd = yt_dlp.command();
    cmd.args(&cmd_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // tokio::process::Command 自带的 process_group（内部代理给 std CommandExt）
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            finish(&app, &state, id, JobStatus::Failed, Some(AppError::Spawn(e.to_string()).to_string()));
            drop(permit);
            return;
        }
    };
    control.pid.store(child.id().unwrap_or(0), Ordering::SeqCst);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let tx2 = tx.clone();
    let reader_stdout = tokio::spawn(async move {
        if let Some(s) = stdout {
            forward_lines(s, tx2).await;
        }
    });
    let reader_stderr = tokio::spawn(async move {
        if let Some(s) = stderr {
            forward_lines(s, tx).await; // tx 随任务结束 drop，主循环收到 EOF
        }
    });

    // ---- 消费行流：进度解析 / 日志转发 / 看门狗 ----
    let mut timed_out = false;
    let mut last_error_line: Option<String> = None;
    loop {
        let received = tokio::time::timeout(WATCHDOG_SILENCE, rx.recv()).await;
        let line = match received {
            Ok(Some(line)) => line,
            Ok(None) => break, // 两个 reader 都 EOF → 进程已退出
            Err(_) => {
                timed_out = true;
                kill_tree(control.pid.load(Ordering::SeqCst));
                break;
            }
        };

        if let Some(update) = progress::parse_progress_line(args::PROGRESS_PREFIX, &line) {
            apply_progress(&app, &state, id, update);
        } else {
            if line.contains("ERROR") {
                last_error_line = Some(line.clone());
            }
            if let Some(path) = extract_destination(&line) {
                state.update(id, |r| r.output_path = Some(path));
            }
            emit_log(&app, id, line);
        }
    }

    let _ = reader_stdout.await;
    let _ = reader_stderr.await;
    let exit = child.wait().await.ok();
    drop(permit);

    // ---- 定终态 ----
    let cancelled = control.cancelled.load(Ordering::SeqCst);
    let status = if cancelled {
        JobStatus::Cancelled
    } else if timed_out {
        JobStatus::Failed
    } else if exit.is_some_and(|s| s.success()) {
        JobStatus::Completed
    } else {
        JobStatus::Failed
    };
    let error = if status == JobStatus::Failed {
        Some(if timed_out {
            "超过 120 秒无输出，已判定异常并终止".to_string()
        } else {
            last_error_line.unwrap_or_else(|| {
                format!(
                    "yt-dlp 退出码 {}",
                    exit.and_then(|s| s.code()).map(|c| c.to_string()).unwrap_or("?".into())
                )
            })
        })
    } else {
        None
    };
    finish(&app, &state, id, status, error);
    state.inner.controls.lock().unwrap().remove(&id);
}

fn apply_progress(app: &AppHandle, state: &AppState, id: u64, update: ProgressUpdate) {
    state.update(id, |r| {
        r.percent = update.percent;
        r.downloaded_bytes = update.downloaded_bytes;
        r.total_bytes = update.total_bytes;
        r.speed = update.speed;
        r.eta = update.eta;
    });
    let _ = app.emit(
        "job-progress",
        crate::progress::ProgressEvent {
            job_id: id,
            update,
        },
    );
}

fn finish(app: &AppHandle, state: &AppState, id: u64, status: JobStatus, error: Option<String>) {
    state.update(id, |r| {
        r.status = status;
        r.error = error.clone();
        if status == JobStatus::Completed {
            r.percent = 100.0;
        }
    });
    if let Some(rec) = state.snapshot(id) {
        emit_status(app, &rec);
    }
}

/// 从日志行提取输出文件路径，用于"打开文件所在目录"
fn extract_destination(line: &str) -> Option<String> {
    let marker = "Destination: ";
    let idx = line.find(marker)?;
    Some(line[idx + marker.len()..].trim().to_string())
}

/// probe 的薄封装：探测并把 format_id 集合存入白名单缓存
pub async fn probe_and_cache(url: &str, state: &AppState) -> Result<probe::VideoInfo, AppError> {
    let result = probe::probe(url).await?;
    state.cache_probe_ids(url, result.valid_ids);
    Ok(result.info)
}
