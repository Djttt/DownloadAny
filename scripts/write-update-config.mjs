import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiBase = process.env.DOWNLOADANY_API_BASE_URL?.replace(/\/$/, "");
if (!apiBase || !/^https:\/\//i.test(apiBase)) {
  throw new Error("DOWNLOADANY_API_BASE_URL must be an HTTPS origin, for example https://api.example.com");
}

const config = {
  plugins: {
    updater: {
      endpoints: [`${apiBase}/api/updates/desktop/{{target}}/{{arch}}/{{current_version}}`],
    },
  },
};

const output = resolve("src-tauri/tauri.release.conf.json");
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Wrote ${output}`);
