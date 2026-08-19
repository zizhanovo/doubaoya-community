#!/usr/bin/env node
// 都爆鸭 skill 对账器（reconcile）
//
// 用法:
//   node reconcile.mjs                    看清单（不改任何东西），然后问你要不要执行
//   node reconcile.mjs --yes              直接执行，不问
//   node reconcile.mjs --dry-run          只看清单，绝不执行
//   node reconcile.mjs --scope global     只对账全局那份（默认 auto：哪儿装了对哪儿）
//   node reconcile.mjs --json             机器可读输出
//   node reconcile.mjs --self-check       离线自检（不联网）
//
// 它干什么：让本机这套「都爆鸭」skill **等于**上游当前全集——
//   上游已下架的归档掉、新增的装上、其余的刷新。
//
// 🔴 怎么判「这包是不是我们发的」：**看内容哈希，不看它当初用什么名字装的**。
//    上游 known-hashes.json 是「我们发布过的每一版 slug × 内容哈希」的闭集
//    （由 tools/build_known_hashes.py 从 git 历史聚出来）。命中闭集 = 确定是我们发的，
//    与 source 字段写的是 doubaoya-community 还是早期的 redfox-community 无关，
//    也不怕别家有同名包。
//
// 🔴 三态，不是两态：
//    命中当前版      → 保留 / 刷新
//    命中历史版      → 我们的旧包，可归档可替换
//    谁的版本都不命中 → **用户动过手**，跳过并列进报告，一个字都不动
//
// 🔴 删除一律做成「移进归档目录」，不做 rm。用户机器我们看不见，多一个目录的成本，
//    换「删错了还能捞回来」。
//
// 为什么不能直接用 `npx skills update`：它只更新「已经装了的」，
// 永远删不掉上游已经砍掉的那些——那些会永久停在被砍前的旧契约上。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";

const REPO = "zizhanovo/doubaoya-community";
// DBY_RAW_BASE 只给验证用：指向本地 checkout 或某个分支，好在改动 push 之前先对着
// 合成安装态跑一遍。设了它就以版本表为名单（不再问 GitHub 目录列表）。
const RAW = process.env.DBY_RAW_BASE || `https://raw.githubusercontent.com/${REPO}/main`;
const RAW_OVERRIDDEN = Boolean(process.env.DBY_RAW_BASE);
const VERSIONS_URL = `${RAW}/versions.json`;
const KNOWN_URL = `${RAW}/known-hashes.json`;
const CONTENTS_API = `https://api.github.com/repos/${REPO}/contents/skills`;
const HEALTH_URL = "https://doubaoya.com/api/health";

// ---------------------------------------------------------------- 内容哈希

// 必须与 tools/stamp_versions.py 的 compute_skill_hash 逐位一致：
// sha256 依次吃「相对路径(utf8) + 文件内容」，路径排序，取前 12 位十六进制。
// 排除 .version 与任何点开头的路径段（.version 自身也被这条覆盖），以及 __pycache__。
export function hashedFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel) || dir)) {
      if (entry.startsWith(".") || entry === "__pycache__") continue;
      const r = rel ? `${rel}/${entry}` : entry;
      let st;
      try {
        st = statSync(join(dir, r)); // 跟随符号链接：skills CLI 默认是软链装的
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push(r);
    }
  };
  walk("");
  // 按 UTF-8 字节序排 —— 与 Python 的码点序等价，中文文件名也不会跟 Python 排岔。
  return out.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

export function computeSkillHash(dir) {
  const digest = createHash("sha256");
  for (const rel of hashedFiles(dir)) {
    digest.update(Buffer.from(rel, "utf8"));
    digest.update(readFileSync(join(dir, rel)));
  }
  return digest.digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------- 三态判定

/**
 * 这个已装的包处于哪一态。
 *   current    命中上游当前版 —— 保留 / 刷新
 *   historical 命中我们发布过的某个历史版 —— 我们的旧包，可归档可替换
 *   modified   slug 是我们的，但哈希谁都不命中 —— **用户动过手，绝不碰**
 *   foreign    slug 根本不在我们的闭集里 —— 别人的包，绝不碰
 */
export function classify(name, hash, currentHashes, knownHashes) {
  if (!Object.prototype.hasOwnProperty.call(knownHashes, name)) return "foreign";
  if (currentHashes[name] && currentHashes[name] === hash) return "current";
  if (knownHashes[name].includes(hash)) return "historical";
  return "modified";
}

/**
 * 三张单子。只有 historical 且上游已下架的才进归档单；
 * modified 一律进「不碰」单，连刷新都不给——刷新会覆盖掉用户的改动。
 */
export function planReconcile(installed, upstreamNames) {
  const upstream = new Set(upstreamNames);
  const archive = [];
  const keep = [];
  const untouched = [];
  for (const { name, state } of installed) {
    if (state === "foreign" || state === "modified") untouched.push({ name, state });
    else if (!upstream.has(name)) archive.push(name);
    else keep.push(name);
  }
  const present = new Set(installed.map((i) => i.name));
  const add = [...upstream].filter((n) => !present.has(n)).sort();
  // 用户动过手的，连装都不许再装一遍盖掉它
  const blocked = new Set(untouched.filter((u) => u.state === "modified").map((u) => u.name));
  return {
    archive: archive.sort(),
    add: add.filter((n) => !blocked.has(n)),
    refresh: keep.sort(),
    untouched: untouched.sort((a, b) => a.name.localeCompare(b.name)),
    blocked: [...blocked].sort(),
  };
}

// ---------------------------------------------------------------- 人话报错

class Friendly extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

function explainFsError(err, what, path) {
  if (err?.code === "EACCES" || err?.code === "EPERM") {
    return new Friendly(
      `没有权限${what}：${path}`,
      "这个目录不归当前用户所有。检查它的属主，或者换回你平时装 skill 的那个账号再跑一次。"
    );
  }
  if (err?.code === "ENOSPC") return new Friendly(`磁盘满了，${what}失败：${path}`, "清点空间再跑；这一步没做完，本机没有任何东西被删。");
  return new Friendly(`${what}失败：${path}（${err?.code || err?.message}）`);
}

function explainNetError(err, what) {
  const code = err?.cause?.code || err?.code || "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new Friendly(`${what}失败：DNS 解析不了，基本是断网或者 DNS 有问题。`, "连上网再跑一次。");
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT") {
    return new Friendly(`${what}失败：连不上服务器（${code}）。`, "如果你在公司网络或者开着代理，先确认能访问 github.com。");
  }
  if (err?.name === "TimeoutError" || code === "ABORT_ERR") {
    return new Friendly(`${what}超时。`, "网络太慢或者被墙了，换个网络再试。");
  }
  return new Friendly(`${what}失败：${err?.message || err}`);
}

// ---------------------------------------------------------------- 安装目录

/** 这个 scope 下 skill 会落到的两个安装目录。 */
function installDirs(scope) {
  const base = scope.kind === "global" ? homedir() : scope.dir;
  return [
    { label: ".claude/skills", path: join(base, ".claude", "skills") },
    { label: ".agents/skills", path: join(base, ".agents", "skills") },
  ];
}

function listSkillDirs(path) {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path).filter((n) => {
      if (n.startsWith(".")) return false;
      try {
        return statSync(join(path, n)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch (err) {
    throw explainFsError(err, "读取安装目录", path);
  }
}

/** 扫两个安装目录，给每个已装的包定三态。以磁盘为准，不依赖安装记录。 */
function surveyScope(scope, currentHashes, knownHashes) {
  const seen = new Map();
  for (const dir of installDirs(scope)) {
    for (const name of listSkillDirs(dir.path)) {
      let hash;
      try {
        hash = computeSkillHash(join(dir.path, name));
      } catch (err) {
        throw explainFsError(err, "读取已装 skill", join(dir.path, name));
      }
      const state = classify(name, hash, currentHashes, knownHashes);
      const prev = seen.get(name);
      // 同名出现在两个目录：任一处被动过手，就整体按「动过手」保守处理。
      if (!prev) seen.set(name, { name, hash, state, dirs: [dir] });
      else {
        prev.dirs.push(dir);
        if (state === "modified") prev.state = "modified";
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- 上游

async function fetchJson(url, label) {
  if (!/^https?:/.test(url)) {
    try {
      return JSON.parse(readFileSync(url, "utf-8"));
    } catch (err) {
      throw new Friendly(`${label}失败：读不了 ${url}（${err.code || err.message}）`);
    }
  }
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "dby-update-reconcile", Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    throw explainNetError(err, label);
  }
  if (res.status === 403 || res.status === 429) {
    throw new Friendly(`${label}被 GitHub 限流了（HTTP ${res.status}）。`, "等几分钟再跑。");
  }
  if (!res.ok) throw new Friendly(`${label}失败：HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Friendly(`${label}返回的不是合法 JSON。`);
  }
}

/**
 * 上游三件套：当前全集名单、当前版哈希、历史闭集。
 * 名单以 GitHub 目录列表为准（`skills add` 装的就是这些目录），
 * 哈希以 versions.json 为准；目录列表拉不到时退回 versions.json 的键。
 */
async function fetchUpstream() {
  const notes = [];
  const versions = await fetchJson(VERSIONS_URL, "拉取上游版本表");
  const known = await fetchJson(KNOWN_URL, "拉取历史版本闭集");
  if (!versions?.skills || !known?.skills) throw new Friendly("上游版本表格式不对，先不动你本机的任何东西。");

  const currentHashes = Object.fromEntries(
    Object.entries(versions.skills).map(([k, v]) => [k, String(v).split("@").pop()])
  );
  const knownHashes = known.skills;

  let names = null;
  if (RAW_OVERRIDDEN) notes.push(`用的是 DBY_RAW_BASE 指定的上游（${RAW}），名单以版本表为准。`);
  else {
    try {
      const items = await fetchJson(CONTENTS_API, "拉取上游 skill 目录");
      if (Array.isArray(items)) names = items.filter((x) => x.type === "dir").map((x) => x.name).sort();
    } catch (err) {
      notes.push(`目录列表拉不到（${err.message}），改用版本表的名单。`);
    }
  }
  if (!names) names = Object.keys(currentHashes).sort();
  else {
    const unstamped = names.filter((n) => !currentHashes[n]);
    if (unstamped.length) notes.push(`上游有 ${unstamped.length} 个包还没盖版本戳（${unstamped.join(", ")}），它们只会被装上、不参与新旧判定。`);
  }
  if (!names.length) throw new Friendly("上游清单是空的，这不正常，先不动你本机的任何东西。");
  return { names, currentHashes, knownHashes, notes };
}

// ---------------------------------------------------------------- 归档

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function archiveRoot(scope) {
  const base = scope.kind === "global" ? homedir() : scope.dir;
  return join(base, ".doubaoya", "archive", timestamp());
}

/**
 * 把包移进归档目录。**绝不 rm**——用户机器我们看不见，删错了得能捞回来。
 * 按来源目录分层存放，并写一份 manifest 说明每个包原来在哪、怎么放回去。
 */
function archivePackages(scope, names, survey) {
  if (!names.length) return null;
  const root = archiveRoot(scope);
  const moved = [];
  for (const name of names) {
    const entry = survey.find((s) => s.name === name);
    for (const dir of entry?.dirs || []) {
      const from = join(dir.path, name);
      if (!existsSync(from)) continue;
      // 去掉开头的点：归档目录是给人看的，藏成隐藏目录等于 ls 一眼看不见。
      const to = join(root, dir.label.replace(/^\./, "").replace(/\//g, "_"), name);
      try {
        mkdirSync(join(to, ".."), { recursive: true });
        try {
          renameSync(from, to);
        } catch (err) {
          if (err.code !== "EXDEV") throw err;
          cpSync(from, to, { recursive: true }); // 跨设备时退回「先拷再删」
          rmSync(from, { recursive: true, force: true });
        }
        moved.push({ skill: name, from, to, hash: entry?.hash });
      } catch (err) {
        throw explainFsError(err, "归档 skill", from);
      }
    }
  }
  const manifest = {
    archivedAt: new Date().toISOString(),
    reason: "上游已下架，由 dby-update 对账归档；内容哈希命中我们发布过的历史版本",
    restore: "把下面每条的 to 移回 from 即可复原：mv <to> <from>",
    packages: moved,
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { root, count: moved.length };
}

// ---------------------------------------------------------------- 执行

function runSkills(args, cwd) {
  const res = spawnSync("npx", ["-y", "skills", ...args], { stdio: "inherit", cwd });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      throw new Friendly("找不到 npx。", "先装 Node.js（https://nodejs.org），装完重开终端再跑。");
    }
    throw new Friendly(`跑 npx skills 失败：${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Friendly(
      `\`skills ${args[0]}\` 没跑成功（退出码 ${res.status}）。`,
      "常见原因就两个：安装目录没写权限，或者中途断网。上面的日志会写明是哪个。"
    );
  }
}

// ---------------------------------------------------------------- 自检

async function selfTest(scope, wantNames) {
  const checks = [];

  const dirs = installDirs(scope);
  const present = new Set(dirs.flatMap((d) => listSkillDirs(d.path)));
  const missing = wantNames.filter((n) => !present.has(n));
  checks.push(
    missing.length === 0
      ? { name: "skill 已就位", ok: true, detail: `${wantNames.length} 个 skill 都能在安装目录里找到。` }
      : {
          name: "skill 已就位",
          ok: false,
          detail: `有 ${missing.length} 个没落盘：${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`,
          hint: `检查这两个目录写得进去吗：${dirs.map((d) => d.path).join("  ")}`,
        }
  );

  const key = process.env.DOUBAOYA_API_KEY;
  checks.push(
    key
      ? { name: "API 钥匙", ok: true, detail: `DOUBAOYA_API_KEY 已设置（${key.slice(0, 8)}…）。` }
      : {
          name: "API 钥匙",
          ok: false,
          detail: "环境变量 DOUBAOYA_API_KEY 没设置，skill 能装上但调不了数据接口。",
          hint: "去 https://doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后 export DOUBAOYA_API_KEY=dyh_...",
        }
  );

  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => null);
    const ok = res.ok && body?.success === true && body?.data?.status === "ok";
    checks.push(
      ok
        ? { name: "服务连通", ok: true, detail: "doubaoya.com 健康检查通过。" }
        : { name: "服务连通", ok: false, detail: `健康检查没返回 ok（HTTP ${res.status}）。`, hint: "多半是服务端临时抽风，过一会儿再试。" }
    );
  } catch (err) {
    const f = explainNetError(err, "连接 doubaoya.com");
    checks.push({ name: "服务连通", ok: false, detail: f.message, hint: f.hint });
  }

  return checks;
}

// ---------------------------------------------------------------- 主流程

function parseArgs(argv) {
  const o = { yes: false, dryRun: false, json: false, verbose: false, scope: "auto", dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") o.yes = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--scope") o.scope = argv[++i];
    else if (a === "--project-dir") o.dir = argv[++i];
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Friendly(`不认识的参数：${a}`, "跑 --help 看用法。");
  }
  if (!["auto", "global", "project"].includes(o.scope)) {
    throw new Friendly(`--scope 只能是 auto / global / project，你给的是 ${o.scope}`);
  }
  return o;
}

function resolveScopes(opts, knownHashes) {
  const global = { kind: "global", label: "全局（所有项目共用）" };
  const project = { kind: "project", dir: opts.dir, label: `项目（${opts.dir}）` };
  if (opts.scope === "global") return [global];
  if (opts.scope === "project") return [project];
  // auto：哪儿有我们的包就对哪儿；都没有就当全新安装，装到全局。
  const picked = [];
  for (const s of [global, project]) {
    const has = installDirs(s).some((d) =>
      listSkillDirs(d.path).some((n) => Object.prototype.hasOwnProperty.call(knownHashes, n))
    );
    if (has) picked.push(s);
  }
  return picked.length ? picked : [global];
}

function printPlan(scope, survey, plan, opts) {
  const counts = survey.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] || 0) + 1 }), {});
  console.log(`\n── ${scope.label}`);
  console.log(
    `   已装 ${survey.length} 个：当前版 ${counts.current || 0}、我们的旧版 ${counts.historical || 0}、` +
      `你改过的 ${counts.modified || 0}、别人的 ${counts.foreign || 0}`
  );
  if (plan.archive.length) {
    console.log(`   📦 要归档 ${plan.archive.length} 个（上游已下架；移进归档目录，不删）：`);
    for (const n of plan.archive) console.log(`        - ${n}`);
  }
  if (plan.add.length) {
    console.log(`   ✨ 要新增 ${plan.add.length} 个：`);
    for (const n of plan.add) console.log(`        + ${n}`);
  }
  console.log(`   ♻️  要刷新 ${plan.refresh.length} 个`);
  const modified = plan.untouched.filter((u) => u.state === "modified");
  if (modified.length) {
    console.log(`   ✋ 你改过的 ${modified.length} 个，一个字都不动（也不会被刷新覆盖）：`);
    for (const u of modified) console.log(`        ~ ${u.name}`);
  }
  const foreign = plan.untouched.filter((u) => u.state === "foreign");
  if (foreign.length) {
    console.log(
      `   🚫 别人家的 ${foreign.length} 个，不碰` + (opts.verbose ? `：${foreign.map((f) => f.name).join(", ")}` : "（加 --verbose 看名字）")
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url), "utf-8").split("\n").slice(2, 10).join("\n").replace(/^\/\/ ?/gm, ""));
    return 0;
  }

  const upstream = await fetchUpstream();
  for (const n of upstream.notes) console.log(`提示：${n}`);
  const scopes = resolveScopes(opts, upstream.knownHashes);

  // ---- 先把清单摊开给人看，一个字都还没改
  const report = [];
  for (const scope of scopes) {
    const survey = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    const plan = planReconcile(survey, upstream.names);
    report.push({ scope, survey, plan });
  }

  const totalChanges = report.reduce((n, r) => n + r.plan.archive.length + r.plan.add.length, 0);
  if (!opts.json) {
    console.log(`\n上游现有 ${upstream.names.length} 个 skill；我们发布过的历史版本闭集覆盖 ${Object.keys(upstream.knownHashes).length} 个 slug`);
    for (const { scope, survey, plan } of report) printPlan(scope, survey, plan, opts);
    if (totalChanges === 0) console.log(`\n结论：没有要归档的，也没有要新增的——已经和上游一致了。`);
  }

  if (opts.dryRun) {
    if (opts.json) console.log(JSON.stringify({ names: upstream.names, report: report.map(stripScope), executed: false }, null, 2));
    return 0;
  }

  // ---- 要动手了，先要确认（红线：归档绝不能是默认行为）
  if (totalChanges > 0 && !opts.yes) {
    if (!process.stdin.isTTY) {
      console.error("\n停下了：有归档动作，但当前不是交互终端，没法向你确认。\n确认清单没问题后，加 --yes 再跑一次。");
      return 2;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question("\n按上面这份清单执行？(y/N) ");
    rl.close();
    if (!/^(y|yes|是)$/i.test(ans.trim())) {
      console.log("已取消，什么都没动。");
      return 1;
    }
  }

  // ---- 执行
  const archived = [];
  for (const { scope, survey, plan } of report) {
    const cwd = scope.kind === "global" ? undefined : scope.dir;
    const scopeFlag = scope.kind === "global" ? ["-g"] : [];

    if (plan.archive.length) {
      console.log(`\n归档 ${plan.archive.length} 个上游已下架的 skill（移走，不删）…`);
      const res = archivePackages(scope, plan.archive, survey);
      archived.push({ scope: scope.label, ...res });
      console.log(`   已移到 ${res.root}`);
      // 目录已经移走，这一步只是让 skills CLI 把自己的安装记录也清掉。
      // 不传 -a：remove 省略 -a 时打到全部 agent；别照 --help 写 -a '*'，remove 不认星号。
      runSkills(["remove", ...plan.archive, ...scopeFlag, "-y"], cwd);
    }

    // 只装该装的：用户改过的包被排除在外，免得 --all 一把盖掉人家的改动。
    const want = [...plan.add, ...plan.refresh].sort();
    if (want.length) {
      console.log(`\n拉取上游 ${want.length} 个 skill…`);
      runSkills(["add", REPO, ...scopeFlag, "-s", ...want, "-a", "*", "-y"], cwd);
    }
  }

  // ---- 复核 + 自检
  const results = [];
  for (const { scope, survey, plan } of report) {
    const after = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    const stillStale = after.filter((s) => s.state === "historical" && !upstream.names.includes(s.name)).map((s) => s.name);
    const keptModified = plan.untouched
      .filter((u) => u.state === "modified")
      .filter((u) => after.find((a) => a.name === u.name)?.state === "modified").length;
    const keptForeign = plan.untouched
      .filter((u) => u.state === "foreign")
      .filter((u) => after.find((a) => a.name === u.name)?.state === "foreign").length;
    const want = [...plan.add, ...plan.refresh];
    const checks = await selfTest(scope, want);
    results.push({ scope, plan, after, stillStale, keptModified, keptForeign, checks });
  }

  if (opts.json) {
    console.log(JSON.stringify({ results: results.map(stripScope), archived, executed: true }, null, 2));
    return results.every((r) => r.checks.every((c) => c.ok)) ? 0 : 3;
  }

  let allOk = true;
  for (const r of results) {
    const counts = r.after.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] || 0) + 1 }), {});
    console.log(`\n── ${r.scope.label} 对账完成`);
    console.log(`   归档 ${r.plan.archive.length}，新增 ${r.plan.add.length}，刷新 ${r.plan.refresh.length}`);
    console.log(`   现在：当前版 ${counts.current || 0}、你改过的 ${counts.modified || 0}（原样保留 ${r.keptModified}）、别人的 ${counts.foreign || 0}（原样保留 ${r.keptForeign}）`);
    if (r.stillStale.length) {
      allOk = false;
      console.log(`   ⚠️ 还有 ${r.stillStale.length} 个没归档掉：${r.stillStale.join(", ")}`);
    }
    console.log(`\n   自检：`);
    for (const c of r.checks) {
      console.log(`   ${c.ok ? "✅" : "❌"} ${c.name}：${c.detail}`);
      if (!c.ok) {
        allOk = false;
        if (c.hint) console.log(`      → ${c.hint}`);
      }
    }
  }
  for (const a of archived) {
    if (a?.count) console.log(`\n归档的 ${a.count} 份原样躺在 ${a.root}，确认没问题后可以自行删掉。`);
  }
  console.log(
    allOk
      ? `\n全部通过。当前对话如果还没读到新能力，新建一次对话就能用。`
      : `\n对账做完了，但自检有没过的项（上面标 ❌ 的），按提示处理完再用。`
  );
  return allOk ? 0 : 3;
}

function stripScope(r) {
  const { scope, ...rest } = r;
  return { scope: scope.label, ...rest };
}

// ---------------------------------------------------------------- 离线自检

function runSelfCheck() {
  const fails = [];
  const eq = (label, got, want) => {
    const a = JSON.stringify(got);
    const b = JSON.stringify(want);
    if (a !== b) fails.push(`${label}: got ${a}, want ${b}`);
  };

  const known = { dby: ["aaa", "bbb"], retired: ["ccc"], "cur-only": ["ddd"] };
  const current = { dby: "aaa", "cur-only": "ddd" };

  // 三态
  eq("命中当前版", classify("dby", "aaa", current, known), "current");
  eq("命中历史版", classify("dby", "bbb", current, known), "historical");
  eq("谁都不命中=用户动过手", classify("dby", "zzz", current, known), "modified");
  eq("下架包的历史版", classify("retired", "ccc", current, known), "historical");
  eq("闭集里没有=别人的", classify("lark-base", "aaa", current, known), "foreign");
  // 🔴 别人的包哪怕哈希凑巧撞上我们某个版本，也仍然是别人的（判据是 slug 在不在闭集里）
  eq("异源撞哈希仍是 foreign", classify("someone-else", "aaa", current, known), "foreign");

  // 三张单子：下架的旧包归档，新增的装，改过的既不归档也不刷新
  const installed = [
    { name: "dby", state: "current" },
    { name: "retired", state: "historical" },
    { name: "mine", state: "modified" },
    { name: "lark-base", state: "foreign" },
  ];
  const plan = planReconcile(installed, ["dby", "brand-new", "mine"]);
  eq("归档单", plan.archive, ["retired"]);
  eq("新增单", plan.add, ["brand-new"]);
  eq("刷新单", plan.refresh, ["dby"]);
  eq("不碰单", plan.untouched.map((u) => u.name), ["lark-base", "mine"]);
  // 🔴 用户改过的包在上游也存在，但绝不能被重装盖掉
  eq("改过的不进新增单", plan.add.includes("mine"), false);
  eq("改过的不进刷新单", plan.refresh.includes("mine"), false);
  eq("改过的被挡住", plan.blocked, ["mine"]);

  // 幂等：已经一致时不归档不新增
  const idem = planReconcile([{ name: "dby", state: "current" }], ["dby"]);
  eq("幂等", [idem.archive, idem.add], [[], []]);
  // 全新安装：全是新增，没有归档
  eq("全新安装", planReconcile([], ["a", "b"]), {
    archive: [], add: ["a", "b"], refresh: [], untouched: [], blocked: [],
  });

  if (fails.length) {
    for (const f of fails) console.error(`selfcheck FAILED: ${f}`);
    return 1;
  }
  console.log("selfcheck ok: classify / planReconcile");
  return 0;
}

// ---------------------------------------------------------------- 入口

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  if (process.argv.includes("--self-check")) {
    process.exit(runSelfCheck());
  } else {
    main()
      .then((code) => process.exit(code))
      .catch((err) => {
        if (err instanceof Friendly) {
          console.error(`\n没做完：${err.message}`);
          if (err.hint) console.error(`→ ${err.hint}`);
          if (process.env.DBY_DEBUG) console.error(err.stack);
        } else {
          console.error(`\n出了意料之外的问题：${err?.message || err}`);
          console.error(`→ 把这段发给我们：DBY_DEBUG=1 重跑可以看到完整堆栈。`);
          if (process.env.DBY_DEBUG) console.error(err?.stack);
        }
        process.exit(4);
      });
  }
}
