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
//   删掉上游已经没有的、装上新增的、刷新其余的。
//
// 🔴 安全底线：只碰 skills-lock 里 source 明确属于本仓的条目
//    （新名 zizhanovo/doubaoya-community 与旧名 zizhanovo/redfox-community 都认）。
//    来源是别人的、或者来源不明的，一个字都不动。
//
// 为什么不能直接用 `npx skills update`：它只更新「已经装了的」，
// 永远删不掉上游已经砍掉的那些——那些会永久停在被砍前的旧契约上。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";

const REPO = "zizhanovo/doubaoya-community";
const CONTENTS_API = `https://api.github.com/repos/${REPO}/contents/skills`;
const VERSIONS_RAW = `https://raw.githubusercontent.com/${REPO}/main/versions.json`;
const HEALTH_URL = "https://doubaoya.com/api/health";

// ---------------------------------------------------------------- 归属判定

// 本仓早期叫 redfox-community，后来才 repoint 到 doubaoya-community。
// 老用户机器上的陈旧条目很可能还带着旧来源字符串——只认新名会把它们整批漏掉。
const OWNED_REPO_RE =
  /(?:^|github\.com\/)zizhanovo\/(?:doubaoya|redfox)-community(?:\.git)?(?:[/#?@]|$)/i;

/** 这条 lock 条目是不是本仓装的。只有 true 才允许删。 */
export function isOurs(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.sourceType === "local") return false;
  for (const raw of [entry.source, entry.sourceUrl]) {
    if (typeof raw !== "string") continue;
    if (OWNED_REPO_RE.test(raw.trim().replace(/\/+$/, ""))) return true;
  }
  return false;
}

/** 算出「要删 / 要装 / 要刷新」三张单子。 */
export function planReconcile(ownedNames, upstreamNames) {
  const upstream = new Set(upstreamNames);
  const owned = new Set(ownedNames);
  return {
    remove: [...owned].filter((n) => !upstream.has(n)).sort(),
    add: [...upstream].filter((n) => !owned.has(n)).sort(),
    refresh: [...owned].filter((n) => upstream.has(n)).sort(),
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

// ---------------------------------------------------------------- 读 lock

// 全局那份（skills CLI 写在 ~/.agents/.skill-lock.json，v3）
function globalLockPath() {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg ? join(xdg, "skills", ".skill-lock.json") : join(homedir(), ".agents", ".skill-lock.json");
}

// 项目那份（<项目根>/skills-lock.json，v1）
function projectLockPath(dir) {
  return join(dir, "skills-lock.json");
}

function readLock(path) {
  if (!existsSync(path)) return { skills: {} };
  let text;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    throw explainFsError(err, "读取安装记录", path);
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed.skills === "object" && parsed.skills ? parsed : { skills: {} };
  } catch {
    throw new Friendly(
      `安装记录读不懂（不是合法 JSON）：${path}`,
      "这个文件坏了。可以把它改名备份掉再跑一次，本工具会当成全新安装重新装齐。"
    );
  }
}

/** 一个 scope 的现状：我们的、别人的、以及哈希（用来判断这轮到底有没有变）。 */
function readScope(scope) {
  const path = scope.kind === "global" ? globalLockPath() : projectLockPath(scope.dir);
  const lock = readLock(path);
  const ours = [];
  const foreign = [];
  const hashes = new Map();
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (isOurs(entry)) {
      ours.push(name);
      hashes.set(name, entry.computedHash || entry.skillFolderHash || "");
    } else {
      foreign.push(name);
    }
  }
  return { path, ours: ours.sort(), foreign: foreign.sort(), hashes };
}

/** 这个 scope 下 skill 会落到的两个安装目录。 */
function installDirs(scope) {
  return scope.kind === "global"
    ? [join(homedir(), ".claude", "skills"), join(homedir(), ".agents", "skills")]
    : [join(scope.dir, ".claude", "skills"), join(scope.dir, ".agents", "skills")];
}

function listDirs(path) {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- 上游全集

async function fetchJson(url, label) {
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
    throw new Friendly(`${label}被 GitHub 限流了（HTTP ${res.status}）。`, "等几分钟再跑，或者直接用备用清单源。");
  }
  if (!res.ok) throw new Friendly(`${label}失败：HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Friendly(`${label}返回的不是合法 JSON。`);
  }
}

/**
 * 上游到底有哪些 skill。
 * 主源 = GitHub 目录列表（`skills add --all` 装的就是这些目录，最贴近真相）。
 * 备源 = 仓库里的 versions.json（主源限流时兜底）。
 * versions.json 不随 `skills add` 下发到用户机器，所以只能联网取。
 */
async function fetchUpstream() {
  const notes = [];
  let primary = null;
  try {
    const items = await fetchJson(CONTENTS_API, "拉取上游 skill 清单");
    if (Array.isArray(items)) {
      primary = items.filter((x) => x.type === "dir").map((x) => x.name).sort();
    }
  } catch (err) {
    notes.push(`主清单源不可用（${err.message}），改用备用源。`);
  }

  let backup = null;
  try {
    const v = await fetchJson(VERSIONS_RAW, "拉取备用清单");
    if (v && typeof v.skills === "object") backup = Object.keys(v.skills).sort();
  } catch (err) {
    if (!primary) throw err;
    notes.push(`备用清单源不可用（${err.message}）。`);
  }

  if (!primary && !backup) throw new Friendly("两个清单源都拉不到，没法知道上游现在有哪些 skill。");

  const names = primary || backup;
  const source = primary ? "github-contents" : "versions.json";
  if (primary && backup) {
    const only = [
      ...primary.filter((n) => !backup.includes(n)).map((n) => `+${n}`),
      ...backup.filter((n) => !primary.includes(n)).map((n) => `-${n}`),
    ];
    if (only.length) notes.push(`两个清单源有出入（${only.join(" ")}），以目录列表为准。`);
  }
  if (!names.length) throw new Friendly("上游清单是空的，这不正常，先不动你本机的任何东西。");
  return { names, source, notes };
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

async function selfTest(scope, upstreamNames) {
  const checks = [];

  // ① 上游全集是不是真的都躺在盘上了
  const dirs = installDirs(scope);
  const present = new Set(dirs.flatMap(listDirs));
  const missing = upstreamNames.filter((n) => !present.has(n));
  checks.push(
    missing.length === 0
      ? { name: "skill 已就位", ok: true, detail: `${upstreamNames.length} 个 skill 都能在安装目录里找到。` }
      : {
          name: "skill 已就位",
          ok: false,
          detail: `有 ${missing.length} 个没落盘：${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`,
          hint: `检查这两个目录写得进去吗：${dirs.join("  ")}`,
        }
  );

  // ② 钥匙在不在（不校验有效性，那要调计费接口）
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

  // ③ 服务连得通吗（免费只读端点，不花钱）
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

function resolveScopes(opts) {
  const global = { kind: "global", label: "全局（所有项目共用）" };
  const project = { kind: "project", dir: opts.dir, label: `项目（${opts.dir}）` };
  if (opts.scope === "global") return [global];
  if (opts.scope === "project") return [project];

  // auto：哪儿装了本鸭就对哪儿；都没装就当成全新安装，装到全局。
  const picked = [];
  for (const s of [global, project]) {
    if (readScope(s).ours.length > 0) picked.push(s);
  }
  return picked.length ? picked : [global];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url), "utf-8").split("\n").slice(2, 20).join("\n").replace(/^\/\/ ?/gm, ""));
    return 0;
  }

  const scopes = resolveScopes(opts);
  const upstream = await fetchUpstream();
  for (const n of upstream.notes) console.log(`提示：${n}`);

  // ---- 先把清单摊开给人看，一个字都还没改
  const report = [];
  for (const scope of scopes) {
    const before = readScope(scope);
    const plan = planReconcile(before.ours, upstream.names);
    report.push({ scope, before, plan });
  }

  const totalChanges = report.reduce((n, r) => n + r.plan.remove.length + r.plan.add.length, 0);

  if (!opts.json) {
    console.log(`\n上游现有 ${upstream.names.length} 个 skill（清单源：${upstream.source}）`);
    for (const { scope, before, plan } of report) {
      console.log(`\n── ${scope.label}`);
      console.log(`   本机属于本鸭的：${before.ours.length} 个；别的来源：${before.foreign.length} 个（不会碰）`);
      if (plan.remove.length) {
        console.log(`   🗑  要删除 ${plan.remove.length} 个（上游已经没有了）：`);
        for (const n of plan.remove) console.log(`        - ${n}`);
      }
      if (plan.add.length) {
        console.log(`   ✨ 要新增 ${plan.add.length} 个：`);
        for (const n of plan.add) console.log(`        + ${n}`);
      }
      console.log(`   ♻️  要刷新 ${plan.refresh.length} 个（拉到最新版）`);
      if (opts.verbose && before.foreign.length) {
        console.log(`   不碰的（来源是别人的）：${before.foreign.join(", ")}`);
      }
    }
    if (totalChanges === 0) console.log(`\n结论：没有要删的，也没有要新增的——已经和上游一致了。`);
  }

  if (opts.dryRun) {
    if (opts.json) console.log(JSON.stringify({ upstream, report: report.map(stripScope), executed: false }, null, 2));
    return 0;
  }

  // ---- 要动手了，先要确认（红线：删除绝不能是默认行为）
  if (totalChanges > 0 && !opts.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        "\n停下了：有删除动作，但当前不是交互终端，没法向你确认。\n" +
          "确认清单没问题后，加 --yes 再跑一次。"
      );
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
  for (const { scope, plan } of report) {
    const cwd = scope.kind === "global" ? undefined : scope.dir;
    const scopeFlag = scope.kind === "global" ? ["-g"] : [];

    if (plan.remove.length) {
      // 按名字删——CLI 的 remove 完全不看来源，所以「哪些名字能删」这道闸
      // 只能由上面的 isOurs() 把住。
      // 不传 -a：remove 省略 -a 时 targetAgents 取全部 agent，.claude/skills 和
      // .agents/skills 两处都会清干净。（别照 --help 写 -a '*'，remove 不认这个
      // 星号，会直接报 "Invalid agents: *" 退出 1；只有 add 认。）
      console.log(`\n删除 ${plan.remove.length} 个上游已下架的 skill…`);
      runSkills(["remove", ...plan.remove, ...scopeFlag, "-y"], cwd);
    }
    // add --all 一次搞定「新增」和「刷新」，且只从本仓拉，天然不碰别的来源。
    console.log(`\n拉取上游全集（${upstream.names.length} 个）…`);
    runSkills(["add", REPO, ...scopeFlag, "--all"], cwd);
  }

  // ---- 复核 + 自检
  const results = [];
  for (const { scope, before, plan } of report) {
    const after = readScope(scope);
    const changed = after.ours.filter((n) => before.hashes.get(n) !== after.hashes.get(n));
    const stillStale = after.ours.filter((n) => !upstream.names.includes(n));
    const foreignKept = before.foreign.filter((n) => after.foreign.includes(n));
    const checks = await selfTest(scope, upstream.names);
    results.push({ scope, before, after, plan, changed, stillStale, foreignKept, checks });
  }

  if (opts.json) {
    console.log(JSON.stringify({ upstream, results: results.map(stripScope), executed: true }, null, 2));
    return results.every((r) => r.checks.every((c) => c.ok)) ? 0 : 3;
  }

  let allOk = true;
  for (const r of results) {
    console.log(`\n── ${r.scope.label} 对账完成`);
    console.log(`   现在有 ${r.after.ours.length} 个本鸭 skill（上游 ${upstream.names.length} 个）`);
    console.log(`   删掉 ${r.plan.remove.length}，新增 ${r.plan.add.length}，内容有变化 ${r.changed.length}`);
    console.log(`   别的来源的 ${r.foreignKept.length} 个 skill 原样没动`);
    if (r.stillStale.length) {
      allOk = false;
      console.log(`   ⚠️ 还有 ${r.stillStale.length} 个没清掉：${r.stillStale.join(", ")}`);
    }

    // 另一处安装目录还有没有对不上的（来源不明的一律不删，只如实告知）
    const known = new Set([...r.after.ours, ...r.after.foreign]);
    const orphans = [...new Set(installDirs(r.scope).flatMap(listDirs))].filter(
      (n) => !known.has(n) && !upstream.names.includes(n)
    );
    if (orphans.length) {
      console.log(
        `   ℹ️ 另有 ${orphans.length} 个 skill 目录没有安装记录、来源不明，本工具不会删它们` +
          (opts.verbose ? `：${orphans.join(", ")}` : "（加 --verbose 看名字）")
      );
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

  console.log(
    allOk
      ? `\n全部通过。当前对话如果还没读到新能力，新建一次对话就能用。`
      : `\n对账做完了，但自检有没过的项（上面标 ❌ 的），按提示处理完再用。`
  );
  return allOk ? 0 : 3;
}

function stripScope(r) {
  const { scope, ...rest } = r;
  return { scope: scope.label, ...rest, before: rest.before && { ...rest.before, hashes: undefined } };
}

// ---------------------------------------------------------------- 离线自检

function runSelfCheck() {
  const fails = [];
  const eq = (label, got, want) => {
    const a = JSON.stringify(got);
    const b = JSON.stringify(want);
    if (a !== b) fails.push(`${label}: got ${a}, want ${b}`);
  };

  // 归属判定：新名 / 旧名 / 各种 URL 写法都要认出来
  for (const src of [
    "zizhanovo/doubaoya-community",
    "zizhanovo/redfox-community",
    "https://github.com/zizhanovo/doubaoya-community",
    "https://github.com/zizhanovo/redfox-community.git",
    "github.com/zizhanovo/doubaoya-community/",
  ]) {
    eq(`isOurs(${src})`, isOurs({ source: src, sourceType: "github" }), true);
  }
  // 只在 sourceUrl 里出现也要认
  eq(
    "isOurs(sourceUrl only)",
    isOurs({ source: "somewhere", sourceType: "github", sourceUrl: "https://github.com/zizhanovo/redfox-community" }),
    true
  );
  // 🔴 别人的、像但不是的、本地的，一律不是我们的
  for (const src of [
    "open.feishu.cn",
    "SpaceZephyr/pm-skills",
    "someoneelse/doubaoya-community",
    "zizhanovo/doubaoya-community-fork",
    "https://github.com/evil/zizhanovo-doubaoya-community",
    "vercel-labs/agent-skills",
  ]) {
    eq(`isOurs(${src})`, isOurs({ source: src, sourceType: "github" }), false);
  }
  eq("isOurs(local)", isOurs({ source: "zizhanovo/doubaoya-community", sourceType: "local" }), false);
  eq("isOurs(null)", isOurs(null), false);

  // 三张单子
  eq(
    "planReconcile",
    planReconcile(["keep", "gone-a", "gone-b"], ["keep", "brand-new"]),
    { remove: ["gone-a", "gone-b"], add: ["brand-new"], refresh: ["keep"] }
  );
  // 幂等：已经一致时没有增删
  const idem = planReconcile(["a", "b"], ["a", "b"]);
  eq("planReconcile idempotent", [idem.remove, idem.add], [[], []]);
  // 全新安装：全是新增，没有删除
  eq("planReconcile fresh", planReconcile([], ["a", "b"]), { remove: [], add: ["a", "b"], refresh: [] });

  if (fails.length) {
    for (const f of fails) console.error(`selfcheck FAILED: ${f}`);
    return 1;
  }
  console.log("selfcheck ok: isOurs / planReconcile");
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
