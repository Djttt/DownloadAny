import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiBase = process.env.DOWNLOADANY_API_BASE_URL?.replace(/\/$/, "");
if (apiBase && !/^https:\/\//i.test(apiBase)) {
  throw new Error("DOWNLOADANY_API_BASE_URL must be an HTTPS origin, for example https://api.example.com");
}

// 未配置后端 ⇒ 空覆盖，沿用 tauri.conf.json 的 GitHub latest.json 端点
// （tag 直发通道）；同时 component_updater 的编译期 env 缺位 ⇒ 组件热更新静默禁用。
const config = apiBase
  ? {
      plugins: {
        updater: {
          endpoints: [`${apiBase}/api/updates/desktop/{{target}}/{{arch}}/{{current_version}}`],
        },
      },
    }
  : {};

const output = resolve("src-tauri/tauri.release.conf.json");
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(apiBase ? `Wrote ${output} (backend endpoint: ${apiBase})` : `Wrote ${output} (empty override, keeping GitHub latest.json)`);
