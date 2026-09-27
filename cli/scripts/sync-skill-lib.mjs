#!/usr/bin/env node
// sync-skill-lib.mjs — 把 cli/src（事实源）逐字节镜像到 skills/dby-api/scripts/lib（1.x 过渡期）。
//
// 为什么是「复制」而不是让 dby-api/scripts/dby.mjs 相对 import ../../../cli/src（design D1 取舍）：
//   社区仓 main 就是 1.x 的分发源——`npx skills add`、install.sh、dby-update 都是按目录把
//   skills/<slug>/ 装进用户机器，cli/ 根本不在用户那边。相对 import 在仓内能跑、装到用户机器上
//   必炸（找不到模块），而且炸在「dby-api 所有命令」这个最大面上。复制策略下：
//     · 事实源只有 cli/src 一处，改代码只改那里；
//     · 本脚本把它原样落到 skill 目录，1.x 用户经 dby-api/scripts/dby.mjs 拿到的就是同一份实现；
//     · cli/test/skill-lib-mirror.test.mjs 断言两边逐字节相同（漂了就红），`--check` 同一判据。
//   过渡期结束（tasks 5.1）时 dby-api/scripts/ 改成转发壳，本脚本与镜像一起删除。
//
// 用法：node scripts/sync-skill-lib.mjs           写入镜像（多余文件删除）
//       node scripts/sync-skill-lib.mjs --check   只比对，不一致时列出差异并以 1 退出

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_DIR = path.join(CLI_ROOT, "src");
export const MIRROR_DIR = path.resolve(CLI_ROOT, "..", "skills", "dby-api", "scripts", "lib");

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/** 返回差异清单：[{ file, problem }]；空数组 = 镜像与事实源逐字节一致。 */
export function mirrorDiff(srcDir = SRC_DIR, mirrorDir = MIRROR_DIR) {
  const src = listFiles(srcDir);
  const mirror = new Set(listFiles(mirrorDir));
  const problems = [];
  if (src.length === 0) problems.push({ file: "(src)", problem: "事实源一个文件都没有——比对空集没有意义" });
  for (const f of src) {
    if (!mirror.has(f)) problems.push({ file: f, problem: "镜像里缺这个文件" });
    else if (!readFileSync(path.join(srcDir, f)).equals(readFileSync(path.join(mirrorDir, f)))) {
      problems.push({ file: f, problem: "内容与 cli/src 不同" });
    }
    mirror.delete(f);
  }
  for (const f of mirror) problems.push({ file: f, problem: "镜像里多出来的文件（cli/src 没有）" });
  return problems;
}

function sync() {
  rmSync(MIRROR_DIR, { recursive: true, force: true });
  mkdirSync(MIRROR_DIR, { recursive: true });
  cpSync(SRC_DIR, MIRROR_DIR, { recursive: true });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--check")) {
    const problems = mirrorDiff();
    for (const p of problems) process.stderr.write(`✗ skills/dby-api/scripts/lib/${p.file}：${p.problem}\n`);
    if (problems.length) {
      process.stderr.write("镜像与 cli/src 不一致：跑 `node cli/scripts/sync-skill-lib.mjs` 重新同步（改代码只改 cli/src）。\n");
      process.exitCode = 1;
    } else {
      process.stderr.write("镜像与 cli/src 逐字节一致。\n");
    }
  } else {
    sync();
    process.stderr.write(`已把 cli/src 镜像到 ${path.relative(process.cwd(), MIRROR_DIR) || MIRROR_DIR}。\n`);
  }
}
