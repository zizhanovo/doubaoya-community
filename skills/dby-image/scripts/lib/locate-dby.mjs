// locate-dby.mjs — 定位 dby-api 包的 CLI 库（规格 dby-cli-coverage「装好即可达」）。
// 顺序：环境变量 DBY_CLI（指向 dby.mjs 或其所在 scripts 目录）→ 同一 skills 根下的 dby-api/scripts → 退出码 3。
// 🔴 这是每个兄弟包各自一份的引导代码（在找到 dby-api 之前没法共享），四个包必须逐字一致。
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function locateDbyLib(fromUrl) {
  const candidates = [];
  if (process.env.DBY_CLI) {
    const p = process.env.DBY_CLI;
    candidates.push(p.endsWith(".mjs") ? path.dirname(p) : p);
  }
  let dir = path.dirname(realpathSync(fileURLToPath(fromUrl))); // <skills>/<pkg>/scripts[/lib]
  for (let i = 0; i < 4; i++) {
    candidates.push(path.join(dir, "dby-api", "scripts"));
    dir = path.dirname(dir);
  }
  for (const c of candidates) if (existsSync(path.join(c, "dby.mjs"))) return path.join(c, "lib");
  process.stderr.write(
    "[MISSING_DBY_API] 找不到 dby-api 包（本包的接口调用都经由它）。请运行 dby-update 安装完整技能集，或用 DBY_CLI 指向 dby-api/scripts/dby.mjs。\n"
  );
  process.exit(3);
}

export async function importDbyLib(fromUrl, mod) {
  return import(pathToFileURL(path.join(locateDbyLib(fromUrl), mod)).href);
}
