#!/usr/bin/env node
// deai-parity.mjs — 开发机专用：`dby deai` 与 skills/dby-deai/scripts/deai.py 逐字段对拍（design D5）。
//
// 只在本机手动跑，不进 `node --test`（放在 scripts/ 下不会被自动收集）；Python 在这里只是测试依赖。
// 对拍面：cli/test/fixtures/deai/ 下每篇样稿 × {裸扫, --profile, --baseline}，外加 --make-baseline；
// JSON 逐字段（含键序）比，human 文本逐字比。
//
// 用法：node cli/scripts/parity/deai-parity.mjs                    # 对拍，全一致退出 0
//       node cli/scripts/parity/deai-parity.mjs --write-snapshots  # 对拍全一致后，冻结期望到 fixtures/deai/expected/
// 缺 python3 或缺 deai.py（删 Python 之后）时打印原因并以 0 退出——那时快照测试就是唯一的尺子。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deaiScan, deaiBaseline } from "../../src/commands/deai.mjs";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..");
const PY = path.join(REPO_ROOT, "skills/dby-deai/scripts/deai.py");
const FIX = path.join(CLI_ROOT, "test/fixtures/deai");
const EXPECTED = path.join(FIX, "expected");
const PROFILE = path.join(FIX, "profile-exempt.md");

function hasPython() {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(PY) || !hasPython()) {
  process.stderr.write(`跳过对拍：${existsSync(PY) ? "本机没有 python3" : `找不到 ${PY}（Python 已删）`}。\n`);
  process.exit(0);
}

const py = (args) => execFileSync("python3", [PY, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const samples = readdirSync(FIX).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();

// 基线用 Python 产出的那份（两边读同一个文件）。
const tmp = mkdtempSync(path.join(tmpdir(), "deai-parity-"));
const baselinePy = path.join(tmp, "baseline.json");
const baselineSources = samples.filter((f) => /human|contrast/.test(f)).map((f) => path.join(FIX, f));
writeFileSync(baselinePy, py(["--make-baseline", ...baselineSources]));

let leaves = 0;
const diffs = [];

function countLeaves(v) {
  if (v && typeof v === "object") return Object.values(v).reduce((a, x) => a + countLeaves(x), 0) || 1;
  return 1;
}

/** 逐字段比（含键序）：把差异精确到路径。 */
function compare(label, a, b, at = "") {
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join("\u0000") !== kb.join("\u0000")) diffs.push(`${label} ${at || "/"}：键不同 python=[${ka}] node=[${kb}]`);
    for (const k of ka) if (k in b) compare(label, a[k], b[k], `${at}/${k}`);
    return;
  }
  if (!Object.is(a, b)) diffs.push(`${label} ${at}：python=${JSON.stringify(a)} node=${JSON.stringify(b)}`);
}

const snapshots = {};
let cases = 0;
for (const f of samples) {
  const file = path.join(FIX, f);
  const variants = [
    ["plain", [], {}],
    ["profile", ["--profile", PROFILE], { profile: PROFILE }],
    ["baseline", ["--baseline", baselinePy], { baseline: baselinePy }]
  ];
  for (const [name, extra, opts] of variants) {
    const label = `${f}#${name}`;
    const pyJson = JSON.parse(py([file, "--json", ...extra]));
    const pyHuman = py([file, ...extra]).replace(/\n$/, "");
    const node = deaiScan({ file, ...opts });
    leaves += countLeaves(pyJson);
    compare(label, pyJson, node.data);
    if (pyHuman !== node.human) {
      const pl = pyHuman.split("\n");
      const nl = node.human.split("\n");
      const i = pl.findIndex((l, k) => l !== nl[k]);
      diffs.push(`${label} human 第 ${i + 1} 行：python=${JSON.stringify(pl[i])} node=${JSON.stringify(nl[i])}`);
    }
    cases++;
    // 基线变体挂的是临时路径下的基线，快照只冻结 plain 与 profile 两种
    if (name !== "baseline") snapshots[`${f.replace(/\.md$/, "")}.${name}`] = { json: node.data, human: node.human };
  }
}

// make-baseline：全部样稿一起压
const all = samples.map((f) => path.join(FIX, f));
const pyBase = JSON.parse(py(["--make-baseline", ...all]));
const nodeBase = deaiBaseline(all).data.baseline;
leaves += countLeaves(pyBase);
compare("make-baseline", pyBase, nodeBase);
cases++;

if (diffs.length) {
  process.stderr.write(`✗ 对拍不一致（${diffs.length} 处）：\n${diffs.map((d) => `  ${d}`).join("\n")}\n`);
  process.exit(1);
}
process.stderr.write(
  `✓ deai 对拍全一致：${samples.length} 篇样稿、${cases} 组用例（JSON + human 文本）、${leaves} 个叶子字段，差异 0。\n`
);

if (process.argv.includes("--write-snapshots")) {
  mkdirSync(EXPECTED, { recursive: true });
  for (const [name, snap] of Object.entries(snapshots)) {
    writeFileSync(path.join(EXPECTED, `${name}.json`), JSON.stringify(snap.json, null, 2) + "\n");
    writeFileSync(path.join(EXPECTED, `${name}.txt`), snap.human + "\n");
  }
  writeFileSync(path.join(EXPECTED, "make-baseline.json"), JSON.stringify(nodeBase, null, 2) + "\n");
  process.stderr.write(`已冻结 ${Object.keys(snapshots).length * 2 + 1} 份期望到 ${path.relative(REPO_ROOT, EXPECTED)}/。\n`);
}
