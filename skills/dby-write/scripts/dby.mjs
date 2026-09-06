#!/usr/bin/env node
// dby.mjs — 引导壳（规格 dby-cli-coverage「装好即可达」）。真身是 dby-api 包的
// scripts/dby.mjs；这份壳只负责「找到真身 → 原样转发 argv → 透传退出码」，不重新实现
// CLI 本身。
// 🔴 本文件在四个用到 CLI 的包（dby-write / dby-charter / dby-publish / dby-banned-words）
//    下逐字节相同（社区仓校验闸 validate_cli_shims_identical 钉住），改一处要全改；
//    用户专属 skill 抄这份壳时也照抄本文件，见 dby-api/references/user-skill-template.md 附录。
//    不 import 仓内共享的 scripts/lib/locate-dby.mjs——那份是给包脚本内部用的（惰性 import 拿
//    请求层），这里要的是「在找到 dby-api 之前」就能跑的定位逻辑，四包必须各自内联一份。
// 定位顺序：环境变量 DBY_CLI（指向 dby.mjs 本身或其所在目录）→ 按自身真实路径向上找同一
// skills 根下的 dby-api/scripts/dby.mjs → 都不命中，退出码 3。

import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function locateReal() {
  const candidates = [];
  if (process.env.DBY_CLI) {
    const p = process.env.DBY_CLI;
    candidates.push(p.endsWith(".mjs") ? p : path.join(p, "dby.mjs"));
  }
  let dir = path.dirname(realpathSync(fileURLToPath(import.meta.url)));
  for (let i = 0; i < 4; i++) {
    candidates.push(path.join(dir, "dby-api", "scripts", "dby.mjs"));
    dir = path.dirname(dir);
  }
  for (const c of candidates) if (existsSync(c)) return c;
  process.stderr.write(
    "[MISSING_DBY_API] 找不到 dby-api 包（本包的接口调用都经由它）。请运行 dby-update 安装完整技能集，或用 DBY_CLI 指向 dby-api/scripts/dby.mjs。\n"
  );
  process.exit(3);
}

// 🔴 入口守卫：两边都先 realpathSync 落到同一条真路径再比——软链正是 skills CLI 装出来的
// 常态形态（`.claude/skills/<n>` → `.agents/skills/<n>`），拿字面串比会在软链下静默漏判、
// 什么都没发生（同族见 dby-api/scripts/dby.mjs 顶部注释，改一处要全改）。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const self = fileURLToPath(import.meta.url);
  const href = (p) => {
    try {
      return pathToFileURL(realpathSync(p)).href;
    } catch {
      return null;
    }
  };
  const called = href(argv1);
  const here = href(self);
  if (called && here) return called === here;
  if (argv1 === self) return true;
  console.error(
    `提示：解析不出 ${argv1} 的真实路径，没法确认是不是在直接跑本脚本；` +
      `如果你就是在直接跑它，换成绝对路径重试。`
  );
  return false;
}

if (isMainModule()) {
  const real = locateReal();
  const child = spawn(process.execPath, [real, ...process.argv.slice(2)], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
