// skills.mjs — `dby skills install|update|status|migrate`（dby-cli-rebuild design D11，
// spec dby-cli-distribution「skills 由 CLI 写入宿主目录」「安装与更新不静默降级」「老用户一次性迁移」）。
//
// 一方安装路径只有一条：npm 装 @doubaoya/cli，再由本组命令把**包内**的 skills 写进宿主目录。
// 装进去的永远是正在运行的这个 CLI 版本随包带的内容——CLI 不自我升级，也不从网上另下 skill。
//
// 逐包原子替换（任一包失败只回滚该包）：
//   1. 写到同盘旁路目录 `<宿主 skills 目录>/.dby-staging/<slug>`，并写 `.dby/origin.json`，核对哈希；
//   2. 旧目录 rename 进 `.dby-archive/<本次时间戳>/<slug>`，旁路目录 rename 成正式目录；
//   3. 复核（哈希 + origin 可读）；不过就删掉新目录、把旧目录从归档 rename 回来。
//   rename 在同一文件系统内是原子的，所以任何时刻宿主看到的要么是完整旧版、要么是完整新版。
// 软链：`.claude/skills/dby` → `.agents/skills/dby` 时写进真实路径，旁路与归档也建在真实路径旁边，软链本身不动。
// 「用户改过」的判据是 `.dby/origin.json` 里记的哈希（点开头路径不计入内容哈希，写它不改变哈希）。
//
// 🔴 update 的目标版本只认服务端公布的正式版本（GET /api/cli/release），再到 npmjs 与 npmmirror
//    查同一个确切版本：两源都可达时版本与 integrity 必须一致；版本不可见 / 不一致 → 非 0 退出，
//    **绝不改用「源上能看到的最高版本」**（镜像未同步时那就是静默降级，design D10 否掉的备选）。
//    查询失败（服务端或两个源都不可达）→ 退出码 5，本地一个字节都不写。

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, DbyError } from "../errors.mjs";
import { request, getPublicJson } from "../http.mjs";
import { readVersion } from "../version.mjs";
import { lstatOrNull, readBundle, treeHash } from "../skills-bundle.mjs";
import { warn } from "../output.mjs";

export const PACKAGE_NAME = "@doubaoya/cli";
export const INSTALLER = "dby-cli";
export const REGISTRIES = {
  npmjs: "https://registry.npmjs.org",
  npmmirror: "https://registry.npmmirror.com"
};
// 与调用约定里 `npx --fetch-timeout=15000` 同值：单个源 15 秒没回音就算不可达。
export const REGISTRY_TIMEOUT_MS = 15_000;
const STAGING = ".dby-staging";
const ARCHIVE = ".dby-archive";

const usage = (msg) => new DbyError("USAGE", msg, { exit: EXIT.USAGE });

// ── 随包 skills 从哪来 ────────────────────────────────────────────────────────

const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url)); // src/commands → 包根

/**
 * npm 包形态：包根的 skills/（prepack 拷进来的）。仓库开发形态：cli/ 旁边的仓库 skills/（同一套
 * 「只要 SKILL.md + references」口径，由 readBundle 过滤）。1.x skill 镜像形态两者都没有 → 报错。
 * DBY_SKILLS_BUNDLE 只给测试用：把随包内容换成一个夹具目录。
 */
export function bundleRoot(env = process.env) {
  if (env.DBY_SKILLS_BUNDLE) return path.resolve(env.DBY_SKILLS_BUNDLE);
  const packed = path.join(PKG_ROOT, "skills");
  if (readBundle(packed).length) return packed;
  const repo = path.resolve(PKG_ROOT, "..", "skills");
  if (existsSync(path.join(PKG_ROOT, "package.json")) && readBundle(repo).length) return repo;
  return null;
}

function loadBundle(env = process.env) {
  const root = bundleRoot(env);
  const bundle = root ? readBundle(root) : [];
  if (!bundle.length) {
    throw new DbyError("NO_BUNDLED_SKILLS", "这个 dby 里没有随包的 skills（多半是 1.x 的 skill 内置副本在跑）。", {
      exit: EXIT.BUSINESS,
      remediation: `装 npm 包后再跑：npm i -g ${PACKAGE_NAME}（没有全局权限就在项目里 npm i -D ${PACKAGE_NAME}，再用 npx dby）。`
    });
  }
  return bundle;
}

// ── 目标目录 ──────────────────────────────────────────────────────────────────

const TARGETS = { claude: ".claude/skills", agents: ".agents/skills" };

/**
 * 解析要写的宿主 skills 目录。scope=project 以 --dir（缺省 cwd）为根，scope=user 以 HOME 为根。
 * --target claude|agents|all；不给时取已存在的那几个，一个都没有就用 .claude/skills。
 * 两个目标经软链指向同一真实目录时只算一个（按 realpath 去重）。
 */
export function resolveTargets({ scope = "project", target, dir } = {}, env = process.env) {
  if (!["project", "user"].includes(scope)) throw usage(`--scope 只认 project 或 user，收到 ${scope}。`);
  if (target && !["claude", "agents", "all"].includes(target)) throw usage(`--target 只认 claude、agents 或 all，收到 ${target}。`);
  const base = scope === "user" ? env.HOME || os.homedir() : path.resolve(dir || process.cwd());
  const all = Object.values(TARGETS).map((rel) => path.join(base, rel));
  let roots;
  if (target === "all") roots = all;
  else if (target) roots = [path.join(base, TARGETS[target])];
  else {
    roots = all.filter((p) => existsSync(p));
    if (!roots.length) roots = [path.join(base, TARGETS.claude)];
  }
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    const real = existsSync(root) ? realpathSync(root) : root;
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(root);
  }
  return { scope, base, roots: out };
}

// ── 已装包的状态 ──────────────────────────────────────────────────────────────

function readOrigin(dir) {
  try {
    const o = JSON.parse(readFileSync(path.join(dir, ".dby", "origin.json"), "utf8"));
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

/**
 * 一个宿主 skills 目录下某个 slug 的状态（只读）：
 *   missing  没装；
 *   current  本 CLI 装的、没改过、且内容与版本号都等于正在运行的这个 CLI 随包的那一份；
 *   outdated 本 CLI 装的、没改过、但不是随包这一版（update 会换）；
 *   modified 本 CLI 装的、但内容哈希 ≠ origin 里记的（用户动过手，默认不碰）；
 *   legacy   旧渠道装的（没有 origin，或 origin 不是本 CLI 写的，比如 1.x 对账器写的）——交给 migrate；
 *   broken   软链指向不存在的地方。
 */
export function inspectPackage(root, slug, bundled, version = readVersion()) {
  const link = path.join(root, slug);
  const st = lstatOrNull(link);
  if (!st) return { slug, root, path: link, real: link, state: "missing", symlink: false };
  const symlink = st.isSymbolicLink();
  let real = link;
  if (symlink) {
    try {
      real = realpathSync(link);
    } catch {
      return { slug, root, path: link, real: null, state: "broken", symlink };
    }
  }
  const origin = readOrigin(real);
  const hash = treeHash(real);
  const hasScripts = existsSync(path.join(real, "scripts"));
  const base = { slug, root, path: link, real, symlink, hash, origin, hasScripts, version: origin?.version ?? null };
  if (!origin || origin.installer !== INSTALLER) return { ...base, state: "legacy" };
  if (origin.hash !== hash) return { ...base, state: "modified" };
  if (bundled && origin.hash === bundled.hash && origin.version === version) return { ...base, state: "current" };
  return { ...base, state: "outdated" };
}

// ── 原子换入 ──────────────────────────────────────────────────────────────────

function testFault(slug, phase, env = process.env) {
  // 仅测试用的故障注入：DBY_SKILLS_TEST_FAIL="<slug>:<stage|swap|verify>"。生产环境不设这个变量。
  const spec = env.DBY_SKILLS_TEST_FAIL;
  if (spec && spec.split(",").includes(`${slug}:${phase}`)) throw new Error(`（测试注入）${slug} 在 ${phase} 阶段写盘失败`);
}

function removeIfEmpty(dir) {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* 清理失败不影响结果 */
  }
}

/**
 * 把随包的一个 skill 换进 dest（真实路径）。keepOld=true 时旧目录留在归档里（--force 备份、migrate、下架），
 * 否则换入成功后删掉旧副本（它就是某个旧版本的原样，随包可再生）。返回 { archived }。
 * 失败时抛错，且 dest 保持换入前的内容逐字节不变。
 */
export function swapIn(dest, pkg, { version, runId, keepOld = false, now = new Date(), env = process.env }) {
  const parent = path.dirname(dest);
  const stagingRoot = path.join(parent, STAGING);
  const staging = path.join(stagingRoot, pkg.slug);
  const archiveRun = path.join(parent, ARCHIVE, runId);
  let archived = null;
  try {
    mkdirSync(stagingRoot, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const rel of pkg.files) {
      const to = path.join(staging, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(path.join(pkg.dir, rel), to);
    }
    mkdirSync(path.join(staging, ".dby"), { recursive: true });
    const origin = { installer: INSTALLER, slug: pkg.slug, version, hash: pkg.hash, source: `${PACKAGE_NAME}@${version}`, installedAt: now.toISOString() };
    writeFileSync(path.join(staging, ".dby", "origin.json"), JSON.stringify(origin, null, 2) + "\n");
    testFault(pkg.slug, "stage", env);
    if (treeHash(staging) !== pkg.hash) throw new Error("旁路目录内容哈希与随包内容不一致");

    if (lstatOrNull(dest)) {
      mkdirSync(archiveRun, { recursive: true });
      archived = path.join(archiveRun, pkg.slug);
      renameSync(dest, archived);
    }
    try {
      testFault(pkg.slug, "swap", env);
      renameSync(staging, dest);
    } catch (err) {
      if (archived) renameSync(archived, dest);
      archived = null;
      throw err;
    }
    try {
      testFault(pkg.slug, "verify", env);
      const o = readOrigin(dest);
      if (!o || o.hash !== pkg.hash || treeHash(dest) !== pkg.hash) throw new Error("换入后复核不过（哈希或 origin 不对）");
    } catch (err) {
      rmSync(dest, { recursive: true, force: true });
      if (archived) renameSync(archived, dest);
      archived = null;
      throw err;
    }
    if (archived && !keepOld) {
      rmSync(archived, { recursive: true, force: true });
      archived = null;
    }
    return { archived };
  } finally {
    rmSync(staging, { recursive: true, force: true });
    removeIfEmpty(stagingRoot);
    removeIfEmpty(archiveRun);
    removeIfEmpty(path.join(parent, ARCHIVE));
  }
}

function archiveOnly(dir, runId) {
  const archiveRun = path.join(path.dirname(dir), ARCHIVE, runId);
  mkdirSync(archiveRun, { recursive: true });
  const to = path.join(archiveRun, path.basename(dir));
  renameSync(dir, to);
  return to;
}

function runIdOf(now) {
  return now.toISOString().replace(/[:.]/g, "-");
}

// ── 三个写命令共用的执行器 ────────────────────────────────────────────────────

/**
 * mode: install | update | migrate。
 *   install/update：missing/outdated 换入；current 不动；modified 跳过（--force 先备份再覆盖）；
 *                   legacy 跳过并提示 migrate；本 CLI 装过、随包已不再有的包移进归档（下架）。
 *   migrate：legacy 整体归档后换入；其余同 install。
 */
function applyBundle(ctx, { mode, scope, target, dir, force = false, env = process.env, now = new Date() }) {
  const bundle = loadBundle(env);
  const version = readVersion();
  const { roots, base } = resolveTargets({ scope, target, dir }, env);
  const runId = runIdOf(now);
  const results = [];
  const handled = new Set(); // 真实路径去重：两个目标经软链落到同一个包时只写一次

  for (const root of roots) {
    mkdirSync(root, { recursive: true });
    for (const pkg of bundle) {
      const info = inspectPackage(root, pkg.slug, pkg, version);
      const row = { slug: pkg.slug, root, path: info.path, symlink: info.symlink, before: info.state, version };
      if (info.state === "broken") {
        results.push({ ...row, action: "failed", error: `软链 ${info.path} 指向不存在的路径，未写入` });
        continue;
      }
      const dest = info.real;
      const key = path.join(realpathSync(path.dirname(dest)), path.basename(dest)); // 去重按规范化的真实路径
      if (handled.has(key)) continue;
      handled.add(key);
      if (info.symlink) row.real = dest;

      let keepOld = false;
      if (info.state === "current") {
        results.push({ ...row, action: "unchanged" });
        continue;
      }
      if (info.state === "modified" && !force) {
        results.push({ ...row, action: "skipped", reason: "已被修改，加 --force 覆盖（会先备份）" });
        continue;
      }
      if (info.state === "legacy" && mode !== "migrate") {
        results.push({ ...row, action: "skipped", reason: "旧渠道安装（1.x），先跑 dby skills migrate" });
        continue;
      }
      if (info.state === "modified" || info.state === "legacy") keepOld = true;
      try {
        const { archived } = swapIn(dest, pkg, { version, runId, keepOld, now, env });
        const action = info.state === "missing" ? "installed" : info.state === "legacy" ? "migrated" : "updated";
        results.push({ ...row, action, ...(archived ? { archived } : {}) });
      } catch (err) {
        results.push({ ...row, action: "failed", error: String(err?.message ?? err) });
      }
    }

    // 下架：本 CLI 装过（origin 是我们写的）、随包已不再有的包 → 移进归档，不硬删。
    const bundled = new Set(bundle.map((p) => p.slug));
    for (const name of readdirSync(root).sort()) {
      if (name.startsWith(".") || bundled.has(name)) continue;
      const full = path.join(root, name);
      const st = lstatOrNull(full);
      if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
      const origin = readOrigin(full);
      if (origin?.installer !== INSTALLER) continue; // 别人家的、用户自己的：不碰
      try {
        results.push({ slug: name, root, path: full, before: "retired", action: "archived", archived: archiveOnly(full, runId) });
      } catch (err) {
        results.push({ slug: name, root, path: full, before: "retired", action: "failed", error: String(err?.message ?? err) });
      }
    }
  }
  return { base, roots, version, results };
}

function summarize(results) {
  const count = (a) => results.filter((r) => r.action === a).length;
  return {
    installed: count("installed"),
    updated: count("updated"),
    migrated: count("migrated"),
    unchanged: count("unchanged"),
    skipped: count("skipped"),
    archived: count("archived"),
    failed: count("failed")
  };
}

function humanLines(title, outcome) {
  const lines = [title];
  for (const r of outcome.results) {
    const where = r.real ? `${r.path} → ${r.real}` : r.path;
    const extra = r.reason ?? r.error ?? (r.archived ? `旧目录已归档：${r.archived}` : "");
    lines.push(`  ${r.action.padEnd(9)} ${r.slug.padEnd(18)} ${where}${extra ? `  （${extra}）` : ""}`);
  }
  return lines;
}

function finish(ctx, title, outcome, extraData = {}) {
  const summary = summarize(outcome.results);
  const data = { version: outcome.version, roots: outcome.roots, summary, results: outcome.results, ...extraData };
  const lines = humanLines(title, outcome);
  if (summary.failed) {
    const failed = outcome.results.filter((r) => r.action === "failed").map((r) => r.slug);
    const err = new DbyError("SKILLS_WRITE_FAILED", `这些包没写成功（已保持原样，其余包不受影响）：${failed.join("、")}`, {
      exit: EXIT.GENERAL,
      remediation: "看 data.results 里的 error；修好（权限 / 磁盘空间）后重跑同一条命令，只会重试没成功的包。"
    });
    err.data = data;
    err.human = lines.join("\n");
    throw err;
  }
  for (const r of outcome.results.filter((x) => x.action === "skipped")) warn(ctx, `[跳过] ${r.slug}：${r.reason}`);
  return { data, human: lines.join("\n") };
}

// ── update 的目标版本：release 端点 + 双源 ───────────────────────────────────

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

/** semver 优先级比较（含预发布段）。不合法的串返回 null。 */
export function compareSemver(a, b) {
  const x = SEMVER.exec(a ?? "");
  const y = SEMVER.exec(b ?? "");
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) if (+x[i] !== +y[i]) return +x[i] - +y[i];
  if (!x[4] && !y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const pa = x[4].split(".");
  const pb = y[4].split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]);
    const nb = /^\d+$/.test(pb[i]);
    if (na && nb && +pa[i] !== +pb[i]) return +pa[i] - +pb[i];
    if (na !== nb) return na ? -1 : 1;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function getJson(url, timeoutMs) {
  return getPublicJson(url, { headers: { Accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" }, timeoutMs });
}

/**
 * 问一个 registry：@doubaoya/cli 的确切版本 X 可不可见、integrity 是什么。
 * reachable=false 仅限「连不上 / 超时 / 5xx / 回的不是 JSON」；404（包还不存在）算可达但不可见。
 */
export async function probeRegistry(name, baseUrl, version, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, "")}/${PACKAGE_NAME.replace("/", "%2f")}`;
  try {
    const { status, body } = await getJson(url, timeoutMs);
    if (status === 404) return { name, url, reachable: true, visible: false, integrity: null, highest: null };
    if (status !== 200 || !body || typeof body !== "object") {
      return { name, url, reachable: false, error: `HTTP ${status}` };
    }
    const versions = body.versions && typeof body.versions === "object" ? Object.keys(body.versions) : [];
    const highest = versions.filter((v) => compareSemver(v, v) === 0).sort(compareSemver).at(-1) ?? null;
    const hit = body.versions?.[version];
    return { name, url, reachable: true, visible: !!hit, integrity: hit?.dist?.integrity ?? null, highest };
  } catch (err) {
    const reason = err?.name === "TimeoutError" || err?.name === "AbortError" ? `${timeoutMs / 1000}s 内无响应` : String(err?.cause?.code ?? err?.message ?? err);
    return { name, url, reachable: false, error: reason };
  }
}

/**
 * 纯判据：两个源的查询结果 → 用哪个源，或为什么不能装。🔴 只认确切版本 X，永不改用别的版本。
 * 返回 { ok:true, source, integrity } 或 { ok:false, exit, code, message }。
 */
export function decideSource(version, probes) {
  const up = probes.filter((p) => p.reachable);
  if (!up.length) {
    return {
      ok: false, exit: EXIT.NETWORK, code: "REGISTRY_UNREACHABLE",
      message: `两个源都查询失败：${probes.map((p) => `${p.name}（${p.error}）`).join("；")}。本地已装内容未改动。`
    };
  }
  const missing = up.filter((p) => !p.visible);
  if (missing.length) {
    return {
      ok: false, exit: EXIT.BUSINESS, code: "VERSION_NOT_SYNCED",
      message: missing.map((p) => `${p.name} 尚未同步 ${PACKAGE_NAME}@${version}（那里最高只有 ${p.highest ?? "无"}）`).join("；") + "，请稍后再试。不会改装其他版本。"
    };
  }
  if (up.length > 1 && new Set(up.map((p) => p.integrity)).size > 1) {
    return {
      ok: false, exit: EXIT.BUSINESS, code: "INTEGRITY_MISMATCH",
      message: `${PACKAGE_NAME}@${version} 在两个源上的 integrity 不一致（${up.map((p) => `${p.name}=${p.integrity}`).join("，")}），不安装。`
    };
  }
  return { ok: true, source: up[0].name, integrity: up[0].integrity };
}

async function resolveReleaseTarget(ctx, env = process.env) {
  let info;
  try {
    info = await request(ctx, "GET", "/api/cli/release", { auth: "none", timeoutMs: REGISTRY_TIMEOUT_MS });
  } catch (err) {
    throw new DbyError("RELEASE_QUERY_FAILED", `查询当前正式版本失败（${ctx.baseUrl}/api/cli/release）：${err?.message ?? err}。本地已装内容未改动。`, {
      exit: EXIT.NETWORK,
      remediation: "检查网络或代理（HTTPS_PROXY）后重跑 dby skills update。"
    });
  }
  const version = info?.version;
  if (typeof version !== "string" || compareSemver(version, version) !== 0) {
    throw new DbyError("RELEASE_UNKNOWN", `服务端没有公布可用的正式版本号（收到 ${JSON.stringify(version ?? null)}），无法判定该装哪一版。本地已装内容未改动。`, {
      exit: EXIT.NETWORK,
      remediation: "稍后再试；急用可以先跑 dby skills install 装入当前 CLI 随包的版本。"
    });
  }
  const timeoutMs = ctx.timeoutOverride ?? REGISTRY_TIMEOUT_MS;
  const probes = await Promise.all([
    probeRegistry("npmjs", env.DBY_REGISTRY_NPMJS || REGISTRIES.npmjs, version, timeoutMs),
    probeRegistry("npmmirror", env.DBY_REGISTRY_NPMMIRROR || REGISTRIES.npmmirror, version, timeoutMs)
  ]);
  const decision = decideSource(version, probes);
  if (!decision.ok) {
    const err = new DbyError(decision.code, decision.message, {
      exit: decision.exit,
      remediation: decision.exit === EXIT.NETWORK ? "检查网络或代理后重跑 dby skills update。" : "等镜像同步完成（通常几分钟到一小时）后重跑；不要改装其他版本。"
    });
    err.data = { release: { version }, registries: probes };
    throw err;
  }
  return { version, source: decision.source, integrity: decision.integrity, registries: probes, highlights: info.highlights ?? [] };
}

function upgradeCommand(version, source) {
  const reg = source === "npmmirror" ? ` --registry=${REGISTRIES.npmmirror}` : "";
  return `npm i -g ${PACKAGE_NAME}@${version}${reg}（没有全局权限：npm i -D ${PACKAGE_NAME}@${version}${reg}），再跑 dby skills update`;
}

// ── 四条命令 ──────────────────────────────────────────────────────────────────

export async function skillsInstall(ctx, flags) {
  const outcome = applyBundle(ctx, { mode: "install", scope: flags.scope, target: flags.target, dir: flags.dir, force: !!flags.force });
  return finish(ctx, `dby skills install（${outcome.version}）`, outcome);
}

export async function skillsUpdate(ctx, flags) {
  // 🔴 先查、后写：查询失败时本地一个字节都不动（spec「查询新版本失败」）。
  const release = await resolveReleaseTarget(ctx);
  const running = readVersion();
  const cmp = compareSemver(release.version, running);
  const upgrade = cmp !== null && cmp > 0 ? { available: true, command: upgradeCommand(release.version, release.source) } : { available: false };
  const outcome = applyBundle(ctx, { mode: "update", scope: flags.scope, target: flags.target, dir: flags.dir, force: !!flags.force });
  const result = finish(ctx, `dby skills update（装入正在运行的 ${running}；正式版 ${release.version}，来源 ${release.source}）`, outcome, {
    release: { version: release.version, source: release.source, integrity: release.integrity, registries: release.registries },
    running,
    upgrade
  });
  if (upgrade.available) {
    warn(ctx, `[有新版本] 正在运行 ${running}，正式版 ${release.version}（${release.source} 可见）。CLI 不自我升级：${upgrade.command}`);
    result.human += `\n有新版本 ${release.version}：${upgrade.command}`;
  }
  return result;
}

export async function skillsMigrate(ctx, flags) {
  const outcome = applyBundle(ctx, { mode: "migrate", scope: flags.scope, target: flags.target, dir: flags.dir, force: !!flags.force });
  const archived = outcome.results.filter((r) => r.archived).map((r) => r.archived);
  return finish(ctx, `dby skills migrate（${outcome.version}）`, outcome, { archivedPaths: archived });
}

/** 只读：一个文件都不写，连目标目录都不建。 */
export async function skillsStatus(ctx, flags) {
  const bundle = loadBundle();
  const version = readVersion();
  const { roots } = resolveTargets({ scope: flags.scope, target: flags.target, dir: flags.dir });
  const rows = [];
  for (const root of roots) {
    for (const pkg of bundle) {
      const i = existsSync(root) ? inspectPackage(root, pkg.slug, pkg, version) : { slug: pkg.slug, path: path.join(root, pkg.slug), state: "missing", symlink: false };
      rows.push({ slug: pkg.slug, root, path: i.path, ...(i.real && i.real !== i.path ? { real: i.real } : {}), symlink: !!i.symlink, state: i.state, installedVersion: i.version ?? null, hasScripts: !!i.hasScripts });
    }
  }
  const lines = [`dby skills status（随包版本 ${version}）`, ...rows.map((r) => `  ${r.state.padEnd(9)} ${r.slug.padEnd(18)} ${r.installedVersion ?? "-"}  ${r.path}`)];
  const hint = rows.some((r) => r.state === "legacy") ? "有旧渠道（1.x）装的包：跑 dby skills migrate。" : null;
  if (hint) lines.push(hint);
  return { data: { version, roots, skills: rows }, human: lines.join("\n") };
}

const scopeFlags = {
  scope: { value: true, summary: "project（默认，以 --dir 或当前目录为根）或 user（以 HOME 为根）" },
  target: { value: true, summary: "claude（.claude/skills）/ agents（.agents/skills）/ all；缺省取已存在的，都没有就 .claude/skills" },
  dir: { value: true, summary: "scope=project 时的项目目录（默认当前目录）" }
};
const writeFlags = { ...scopeFlags, force: { summary: "覆盖用户改过的包（覆盖前先备份进 .dby-archive/）" } };

export const commands = [
  {
    group: "skills", name: "install", kind: "local",
    summary: "把本 CLI 随包的 dby-* skills 写进宿主目录（逐包原子替换；改过的包默认不碰；不联网）",
    args: [], flags: writeFlags, routes: [],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => skillsInstall(ctx, flags)
  },
  {
    group: "skills", name: "update", kind: "composite",
    summary: "先查正式版本（服务端公布 + npmjs/npmmirror 双源一致）再装入本 CLI 随包的 skills；查询失败退出码 5、不写盘",
    args: [], flags: writeFlags,
    routes: [{ method: "GET", path: "/api/cli/release" }],
    billable: false, destructive: false, composite: true,
    run: (ctx, { flags }) => skillsUpdate(ctx, flags)
  },
  {
    group: "skills", name: "status", kind: "local",
    summary: "只读：每个包装没装、哪一版、改没改过、是不是旧渠道装的（不写任何文件、不联网）",
    args: [], flags: scopeFlags, routes: [],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => skillsStatus(ctx, flags)
  },
  {
    group: "skills", name: "migrate", kind: "local",
    summary: "老用户一次性迁移：1.x 渠道装的包整体归档后装入薄层，逐包复核，不过的从归档还原（不联网）",
    args: [], flags: writeFlags, routes: [],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => skillsMigrate(ctx, flags)
  }
];
