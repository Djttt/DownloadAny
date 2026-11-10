import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { analyticsContext } from "./analytics";
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
};

export type AppUpdater = {
  state: UpdateState;
  checkNow: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
  skip: () => Promise<void>;
};

const INITIAL: UpdateState = { phase: "idle", progress: 0, visible: false };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdater(hasActiveJobs: boolean): AppUpdater {
  const [state, setState] = useState<UpdateState>(INITIAL);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState((previous) => ({ ...previous, phase: "checking", error: undefined }));
    try {
      const [{ deviceId }, channel] = await Promise.all([analyticsContext(), loadUpdateChannel()]);
      const update = await check({
        timeout: 30_000,
        headers: {
          "X-DownloadAny-Device-Id": deviceId,
          "X-DownloadAny-Channel": channel,
        },
      });
      if (!update) {
        setState({ phase: manual ? "upToDate" : "idle", progress: 0, visible: manual });
        return;
      }
      const skipped = await loadSkippedUpdateVersion();
      if (!manual && skipped === update.version) {
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
        visible: !manual,
      });
    } catch (error) {
      // 自动检查失败不打扰用户；手动检查才显示错误。
      setState({
        phase: manual ? "error" : "idle",
        progress: 0,
        visible: manual,
        error: messageOf(error),
      });
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void runCheck(false), 5_000);
    return () => window.clearTimeout(timer);
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
    setState((previous) => ({ ...previous, visible: false }));
  }, []);

  const skip = useCallback(async () => {
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
