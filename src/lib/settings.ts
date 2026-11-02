import { load } from "@tauri-apps/plugin-store";
import { downloadDir } from "@tauri-apps/api/path";

/** 输出目录：store 持久化，默认系统下载目录 */
export async function loadOutputDir(): Promise<string> {
  const store = await load("settings.json", { autoSave: true });
  const saved = await store.get<string>("outputDir");
  if (saved) return saved;
  return await downloadDir();
}

export async function saveOutputDir(dir: string): Promise<void> {
  const store = await load("settings.json", { autoSave: true });
  await store.set("outputDir", dir);
}
