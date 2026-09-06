// version.mjs — 版本号单一事实源：dby-api 包目录内的 `.version`（tools/stamp_versions.py 盖的
// 那份，形如 `doubaoya-skill/dby-api@<hash12>`）。不另存一份版本号（spec:「版本同源」）。
// 找不到文件时给 "unknown" 而不是抛错——本地裸跑 lib/ 下的模块时目录结构可能不完整。

import { readFileSync } from "node:fs";

const VERSION_FILE = new URL("../../.version", import.meta.url); // lib/ → scripts/ → dby-api/.version

export function readVersion() {
  try {
    const text = readFileSync(VERSION_FILE, "utf8").trim();
    return text || "unknown";
  } catch {
    return "unknown";
  }
}
