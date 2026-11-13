import { load } from "@tauri-apps/plugin-store";
import type { JobRecord } from "../types";

const HISTORY_KEY = "jobs";
const HISTORY_LIMIT = 500;
let writeQueue: Promise<void> = Promise.resolve();

async function historyStore() {
  return load("history.json", { autoSave: true });
}

function isStoredJob(value: unknown): value is JobRecord {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<JobRecord>;
  return (
    typeof job.id === "number"
    && typeof job.historyId === "string"
    && typeof job.savedAt === "number"
    && typeof job.url === "string"
    && typeof job.title === "string"
    && typeof job.formatId === "string"
    && typeof job.formatLabel === "string"
    && ["completed", "failed", "cancelled"].includes(job.status ?? "")
  );
}

export function removeDownloadHistory(historyId: string): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const store = await historyStore();
    const values = await store.get<unknown[]>(HISTORY_KEY);
    const current = Array.isArray(values) ? values.filter(isStoredJob) : [];
    await store.set(HISTORY_KEY, current.filter((item) => item.historyId !== historyId));
  });
  return writeQueue;
}

export async function loadDownloadHistory(): Promise<JobRecord[]> {
  const values = await (await historyStore()).get<unknown[]>(HISTORY_KEY);
  if (!Array.isArray(values)) return [];
  return values.filter(isStoredJob).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/** 串行读改写，避免多个并发下载同时结束时相互覆盖。 */
export function saveDownloadHistory(job: JobRecord): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const store = await historyStore();
    const values = await store.get<unknown[]>(HISTORY_KEY);
    const current = Array.isArray(values) ? values.filter(isStoredJob) : [];
    const next = [job, ...current.filter((item) => item.historyId !== job.historyId)]
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
      .slice(0, HISTORY_LIMIT);
    await store.set(HISTORY_KEY, next);
  });
  return writeQueue;
}
