//! 任务队列：内存队列 + Semaphore 并发控制 + 子进程生命周期管理。
//! v1 不做持久化，应用重启即清空（设计决策）。

use crate::args;
use crate::error::{AppError, JobStatus};
use crate::probe;
use crate::progress::{self, ProgressUpdate};
use crate::resolve;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot};

/// 并发上限默认值与可调范围（设置页“最大同时下载任务数”）
pub const DEFAULT_MAX_CONCURRENT: usize = 3;
pub const MIN_CONCURRENT: usize = 1;
pub const MAX_CONCURRENT_LIMIT: usize = 10;
/// stderr/stdout 静默看门狗阈值
const WATCHDOG_SILENCE: Duration = Duration::from_secs(120);
/// SIGTERM 后等待优雅退出的时间，超时则 SIGKILL
const GRACEFUL_KILL_WAIT: Duration = Duration::from_secs(2);

/// 动态并发闸：替代固定容量 Semaphore。
/// - 名额不足时排队（oneshot 唤醒），`set_limit` 调大即时放行已排队任务；
/// - 调小只影响后续放行，已持有名额的运行中任务不被打断。
struct Gate {
    inner: Mutex<GateInner>,
}

struct GateInner {
    limit: usize,
    active: usize,
    waiters: VecDeque<oneshot::Sender<()>>,
}

/// 持有期间占用一个名额，drop 时释放并唤醒队首
struct GateGuard<'a> {
    gate: &'a Gate,
}

impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        let mut g = self.gate.inner.lock().unwrap();
        g.active -= 1;
        if g.active < g.limit {
            // 已死 waiter（任务被 drop）的 send 失败则跳过，继续补位唤醒
            while let Some(tx) = g.waiters.pop_front() {
                if tx.send(()).is_ok() {
                    break;
                }
            }
        }
    }
}

impl Gate {
    fn new(limit: usize) -> Self {
        Self {
            inner: Mutex::new(GateInner {
                limit,
                active: 0,
                waiters: VecDeque::new(),
            }),
        }
    }

    async fn acquire(&self) -> GateGuard<'_> {
        loop {
            let rx = {
                let mut g = self.inner.lock().unwrap();
                if g.active < g.limit {
                    g.active += 1;
                    return GateGuard { gate: self };
                }
                let (tx, rx) = oneshot::channel();
                g.waiters.push_back(tx);
                rx
            };
            // 醒来后回到循环重新检查名额（可能与其他唤醒者竞争）
            let _ = rx.await;
        }
    }

    fn set_limit(&self, n: usize) {
        let mut g = self.inner.lock().unwrap();
        g.limit = n;
        // 调大后最多唤醒 (limit - active) 个等待者；名额仍由醒来后的
        // acquire 循环复查确认，落选者重新排队
        let mut budget = n.saturating_sub(g.active);
        while budget > 0 {
            match g.waiters.pop_front() {
                Some(tx) => {
                    if tx.send(()).is_ok() {
                        budget -= 1;
                    }
                }
                None => break,
            }
        }
    }
}

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
    /// 代理 URL（已含 scheme），None/空 = 不走代理；args.rs 白名单校验后传 --proxy
    pub proxy: Option<String>,
}

/// 本次探测的完整元数据：白名单 ids + 展示字段。
/// MCP 入口没有前端的 probe 态，标题/清晰度标签靠这里回填任务记录。
#[derive(Debug, Clone)]
pub struct ProbedInfo {
    pub valid_ids: HashSet<String>,
    pub title: String,
    pub formats: Vec<probe::FormatOption>,
}

struct JobControl {
    cancelled: AtomicBool,
    pid: AtomicU32,
}

struct Inner {
    jobs: Mutex<HashMap<u64, JobRecord>>,
    controls: Mutex<HashMap<u64, Arc<JobControl>>>,
    next_id: AtomicU64,
    gate: Gate,
    /// url -> 该次探测的元数据（白名单校验 + 展示字段回填）
    probed: Mutex<HashMap<String, ProbedInfo>>,
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
                gate: Gate::new(DEFAULT_MAX_CONCURRENT),
                probed: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// 设置并发上限（1..=10 钳制）。调大立即放行已排队任务，调小不打断运行中任务。
    pub fn set_max_concurrency(&self, n: usize) {
        self.inner
            .gate
            .set_limit(n.clamp(MIN_CONCURRENT, MAX_CONCURRENT_LIMIT));
    }

    pub fn cache_probe(&self, url: &str, info: ProbedInfo) {
        self.inner
            .probed
            .lock()
            .unwrap()
            .insert(url.to_string(), info);
    }

    /// 该 URL 本会话的探测元数据；未探测过返回 None
    pub fn probe_meta(&self, url: &str) -> Option<ProbedInfo> {
        self.inner.probed.lock().unwrap().get(url).cloned()
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
        let meta = cache
            .get(url)
            .ok_or_else(|| AppError::InvalidFormat("请先解析该链接再下载".into()))?;
        args::validate_format(format_id, &meta.valid_ids)
    }
}

/// 入队：校验参数 → 建任务记录 → spawn 异步执行（内部等 permit 限并发）
pub async fn enqueue(
    app: &AppHandle,
    state: &AppState,
    opts: DownloadOptions,
) -> Result<u64, AppError> {
    args::validate_url(&opts.url)?;
    args::validate_proxy(opts.proxy.as_deref())?;
    state.validate_format(&opts.url, &opts.format_id)?;
    tokio::fs::create_dir_all(&opts.output_dir).await?;

    let id = state.inner.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let record = JobRecord {
        id,
        url: opts.url.clone(),
        title: opts.title.clone().unwrap_or_else(|| opts.url.clone()),
        format_id: opts.format_id.clone(),
        format_label: opts
            .format_label
            .clone()
            .unwrap_or_else(|| opts.format_id.clone()),
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
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("taskkill");
        command
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let _ = command.spawn();
    }
}

/// 逐行读一个管道并转发（空行跳过），EOF 后结束
async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    tx: mpsc::UnboundedSender<String>,
) {
    let mut reader = BufReader::new(reader);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&bytes)
                    .trim_end_matches(['\r', '\n'])
                    .to_string();
                if !line.trim().is_empty() && tx.send(line).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

async fn run_job(app: AppHandle, state: AppState, id: u64, opts: DownloadOptions) {
    // 并发闸：拿不到名额就排队（GateGuard drop 时自动释放并唤醒队首）
    let permit = state.inner.gate.acquire().await;
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
    // 代理在 argv 拼装边界再过一次白名单（入队已校验，这里是纵深防御）
    let proxy = match args::validate_proxy(opts.proxy.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            finish(&app, &state, id, JobStatus::Failed, Some(e.to_string()));
            return;
        }
    };
    let yt_dlp = resolve::yt_dlp();
    let ffmpeg = resolve::ffmpeg();
    let ffmpeg_loc = ffmpeg.ffmpeg_location();
    let cmd_args = args::build_download_args(
        &opts.format_id,
        &opts.url,
        &opts.output_dir,
        ffmpeg_loc.as_deref(),
        proxy.as_deref(),
    );

    let mut cmd = yt_dlp.command();
    cmd.args(&cmd_args)
        // Windows 的无控制台子进程可能按本地代码页输出；强制 UTF-8，避免
        // 中文标题或错误信息导致日志读取提前终止。
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // tokio::process::Command 自带的 process_group（内部代理给 std CommandExt）
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            finish(
                &app,
                &state,
                id,
                JobStatus::Failed,
                Some(AppError::Spawn(e.to_string()).to_string()),
            );
            // permit 随 return 自动释放
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
                    exit.and_then(|s| s.code())
                        .map(|c| c.to_string())
                        .unwrap_or("?".into())
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
        crate::progress::ProgressEvent { job_id: id, update },
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
/// 覆盖两种形态：视频下载 `[download] Destination: <path>`；
/// 封面/字幕写入 `[info] Writing video thumbnail (...) to: <path>`
fn extract_destination(line: &str) -> Option<String> {
    if let Some(path) = line.strip_prefix("FINAL_PATH|") {
        return Some(path.trim().to_string());
    }
    if let Some(idx) = line.find("Destination: ") {
        return Some(line[idx + "Destination: ".len()..].trim().to_string());
    }
    if line.contains("Writing ") {
        if let Some(idx) = line.find(" to: ") {
            return Some(line[idx + " to: ".len()..].trim().to_string());
        }
    }
    None
}

/// probe 的薄封装：探测并把 format_id 集合存入白名单缓存
pub async fn probe_and_cache(
    url: &str,
    proxy: Option<&str>,
    state: &AppState,
) -> Result<probe::VideoInfo, AppError> {
    let result = probe::probe(url, proxy).await?;
    let info = result.info;
    state.cache_probe(
        url,
        ProbedInfo {
            valid_ids: result.valid_ids,
            title: info.title.clone(),
            formats: info.formats.clone(),
        },
    );
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_meta_roundtrip_and_validate() {
        let state = AppState::new();
        let info = ProbedInfo {
            valid_ids: HashSet::new(),
            title: "标题".into(),
            formats: vec![probe::FormatOption {
                id: crate::args::FMT_BEST.into(),
                label: "最佳画质".into(),
                height: None,
                ext: None,
                filesize: None,
            }],
        };
        state.cache_probe("https://example.com/v", info);
        let meta = state.probe_meta("https://example.com/v").expect("cached");
        assert_eq!(meta.title, "标题");
        assert_eq!(meta.formats[0].label, "最佳画质");
        assert!(state.probe_meta("https://other").is_none());
        assert!(state.validate_format("https://example.com/v", crate::args::FMT_BEST).is_ok());
        assert!(state.validate_format("https://example.com/v", "whatever").is_err());
        assert!(state.validate_format("https://not.probed/x", crate::args::FMT_BEST).is_err());
    }

    #[tokio::test]
    async fn gate_blocks_beyond_limit_and_admits_on_release() {
        let gate = Gate::new(2);
        let a = gate.acquire().await;
        let b = gate.acquire().await;
        // 名额已满：第三个 acquire 应挂起
        let mut third = Box::pin(gate.acquire());
        assert!(
            tokio::time::timeout(Duration::from_millis(50), third.as_mut())
                .await
                .is_err(),
            "limit 已满时不应放行"
        );
        drop(a);
        // 释放一个名额后应被唤醒
        let _c = tokio::time::timeout(Duration::from_secs(1), third)
            .await
            .expect("release 后应放行排队者");
        drop(b);
    }

    #[tokio::test]
    async fn gate_set_limit_wakes_waiter_immediately() {
        let gate = Gate::new(1);
        let held = gate.acquire().await;
        let mut waiter = Box::pin(gate.acquire());
        assert!(
            tokio::time::timeout(Duration::from_millis(50), waiter.as_mut())
                .await
                .is_err()
        );
        // 调大上限：已排队任务应立刻放行（运行中的不受影响）
        gate.set_limit(2);
        let _g = tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("set_limit 调大后应放行排队者");
        drop(held);
    }

    #[test]
    fn app_state_clamps_concurrency() {
        let state = AppState::new();
        state.set_max_concurrency(0);
        state.set_max_concurrency(999);
        // 仅验证钳制不 panic；实际 limit 通过后续行为生效
    }
}
