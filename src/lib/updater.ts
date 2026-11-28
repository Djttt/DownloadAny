import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { analyticsContext } from "./analytics";
import { refreshUpdatePolicy } from "./tauri";
import { loadSkippedUpdateVersion, loadUpdateChannel, saveSkippedUpdateVersion } from "./settings";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "upToDate"
  | "blocked"
  | "error";

export type UpdateState = {
  phase: UpdatePhase;
  currentVersion?: string;
  version?: string;
  notes?: string;
  progress: number;
  visible: boolean;
  error?: string;
  /** 服务端把最新可用版本标记为强制更新：渲染不可关闭的门禁层，稍后/跳过失效。 */
  forced: boolean;
  /** 插件已拿到可安装的 Update 对象（下载/安装按钮可用性的依据）。 */
  hasArtifact: boolean;
};

export type AppUpdater = {
  state: UpdateState;
  checkNow: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
  skip: () => Promise<void>;
};

const INITIAL: UpdateState = {
  phase: "idle",
  progress: 0,
  visible: false,
  forced: false,
  hasArtifact: false,
};

/** 强制更新下轮询服务端策略的间隔：长驻客户端也能在管理员后发强制令时收敛。 */
const POLICY_POLL_INTERVAL_MS = 30 * 60_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdater(hasActiveJobs: boolean): AppUpdater {
  const [state, setState] = useState<UpdateState>(INITIAL);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const forcedRef = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState((previous) => ({ ...previous, phase: "checking", error: undefined }));
    try {
      const [{ deviceId }, channel] = await Promise.all([analyticsContext(), loadUpdateChannel()]);
      // 插件的响应结构不透出自定义字段，forced 需向 Rust 侧单独查询（同一端点）。
      const [update, policy] = await Promise.all([
        check({
          timeout: 30_000,
          headers: {
            "X-DownloadAny-Device-Id": deviceId,
            "X-DownloadAny-Channel": channel,
          },
        }),
        refreshUpdatePolicy(channel, deviceId).catch(() => null),
      ]);
      // 策略查询失败时保留既有强制判定，不凭 null 解除。
      const forced = policy ? policy.forced : forcedRef.current;
      forcedRef.current = forced;
      if (!update) {
        if (forced) {
          // 服务端说有新版本且强制，但插件没拿到（理论不应发生）：门禁仍立，给出目标版本。
          setState((previous) => ({
            ...previous,
            phase: "available",
            version: policy?.latestVersion ?? previous.version,
            notes: policy?.notes ?? previous.notes,
            forced: true,
            hasArtifact: false,
            progress: 0,
            visible: false,
            error: undefined,
          }));
          return;
        }
        setState((previous) => ({
          ...previous,
          phase: manual ? "upToDate" : "idle",
          version: undefined,
          notes: undefined,
          forced: false,
          hasArtifact: false,
          progress: 0,
          visible: manual,
        }));
        return;
      }
      const skipped = await loadSkippedUpdateVersion();
      // 跳过只对非强制的自动检查生效；强制版本不允许被跳过。
      if (!manual && !forced && skipped === update.version) {
        await update.close();
        setState(INITIAL);
        return;
      }
      if (updateRef.current) await updateRef.current.close().catch(() => {});
      updateRef.current = update;
      setState({
        phase: "available",
        currentVersion: update.currentVersion,
        version: update.version,
        notes: update.body,
        progress: 0,
        // 浮动提示框只由启动自动检查弹出；手动检查的结果只在设置-关于页内展示。
        // 强制更新走全屏门禁（App 按 state.forced 渲染），不再叠一个可关浮层。
        visible: !manual && !forced,
        forced,
        hasArtifact: true,
      });
    } catch (error) {
      // 自动检查失败不打扰用户；手动检查才显示错误。保留已发现的版本信息，
      // 失败重试不至于把 available 的下载入口弄丢。
      setState((previous) => ({
        ...previous,
        phase: manual ? "error" : previous.forced ? previous.phase : "idle",
        progress: 0,
        visible: manual || (previous.forced && previous.visible),
        error: messageOf(error),
      }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void runCheck(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  // 长驻会话轮询策略：管理员中途把某版本设为强制/取消强制，客户端在半小时内收敛，
  // 无需重启。检测到新增强制时补跑一次完整检查以取得可安装的 Update 对象。
  useEffect(() => {
    const poll = async () => {
      try {
        const [{ deviceId }, channel] = await Promise.all([analyticsContext(), loadUpdateChannel()]);
        const policy = await refreshUpdatePolicy(channel, deviceId).catch(() => null);
        if (!policy) return;
        if (policy.forced && !forcedRef.current) {
          void runCheck(false);
        } else if (!policy.forced && forcedRef.current) {
          forcedRef.current = false;
          setState((previous) => ({ ...previous, forced: false, visible: false }));
        }
      } catch {
        // 轮询尽力而为，失败等下一轮。
      }
    };
    const timer = window.setInterval(() => void poll(), POLICY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [runCheck]);

  useEffect(
    () => () => {
      if (updateRef.current) void updateRef.current.close().catch(() => {});
    },
    [],
  );

  const download = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;
    let downloaded = 0;
    let total = 0;
    setState((previous) => ({ ...previous, phase: "downloading", progress: 0, error: undefined }));
    try {
      await update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        const progress = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
        setState((previous) => ({ ...previous, phase: "downloading", progress }));
      });
      setState((previous) => ({ ...previous, phase: "ready", progress: 100 }));
    } catch (error) {
      setState((previous) => ({ ...previous, phase: "error", error: messageOf(error) }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    if (hasActiveJobs) {
      setState((previous) => ({ ...previous, phase: "blocked" }));
      return;
    }
    busyRef.current = true;
    setState((previous) => ({ ...previous, phase: "installing", error: undefined }));
    try {
      await update.install({ restartAfterInstall: true });
      // Windows 安装成功后会自动退出；macOS/Linux 需要显式重启。
      await relaunch();
    } catch (error) {
      setState((previous) => ({ ...previous, phase: "error", error: messageOf(error) }));
      busyRef.current = false;
    }
  }, [hasActiveJobs]);

  const later = useCallback(() => {
    // 强制更新不可稍后。
    if (forcedRef.current) return;
    setState((previous) => ({ ...previous, visible: false }));
  }, []);

  const skip = useCallback(async () => {
    // 强制更新不可跳过。
    if (forcedRef.current) return;
    const update = updateRef.current;
    if (!update) return;
    await saveSkippedUpdateVersion(update.version);
    await update.close().catch(() => {});
    updateRef.current = null;
    setState(INITIAL);
  }, []);

  return {
    state,
    checkNow: () => runCheck(true),
    download,
    install,
    later,
    skip,
  };
}
