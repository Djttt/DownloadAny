#!/usr/bin/env node
// 同步桌面端三个版本字段，发布 tag 以 tauri.conf.json 为准。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("用法: pnpm version:set 0.1.1");
  process.exit(1);
}

for (const relative of ["package.json", "src-tauri/tauri.conf.json"]) {
  const path = join(root, relative);
  const json = JSON.parse(readFileSync(path, "utf8"));
  json.version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

const cargoPath = join(root, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8").replace(
  /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  `$1${version}$2`,
);
writeFileSync(cargoPath, cargo);
console.log(`[version] DownloadAny -> ${version}`);
