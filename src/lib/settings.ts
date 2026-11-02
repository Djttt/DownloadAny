import { load } from "@tauri-apps/plugin-store";
import { downloadDir } from "@tauri-apps/api/path";

async function store() {
  return load("settings.json", { autoSave: true });
}

/** 输出目录：store 持久化，默认系统下载目录 */
export async function loadOutputDir(): Promise<string> {
  const s = await store();
  const saved = await s.get<string>("outputDir");
  if (saved) return saved;
  return await downloadDir();
}

export async function saveOutputDir(dir: string): Promise<void> {
  (await store()).set("outputDir", dir);
}

/** 自动下载：解析后直接以最佳画质+音频入队 */
export async function loadAutoMode(): Promise<boolean> {
  const s = await store();
  return (await s.get<boolean>("autoMode")) ?? false;
}

export async function saveAutoMode(on: boolean): Promise<void> {
  (await store()).set("autoMode", on);
}
