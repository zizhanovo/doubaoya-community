#!/usr/bin/env node
// 都爆鸭 skill 对账器（reconcile）
//
// 用法:
//   node reconcile.mjs                    看清单（不改任何东西），然后问你要不要执行
//   node reconcile.mjs --yes              直接执行，不问
//   node reconcile.mjs --dry-run          只看清单，绝不执行
//   node reconcile.mjs --force-refresh    连「已经是当前版」的包也重下一遍（包坏了想重装用它）
//   node reconcile.mjs --scope global     只对账全局那份（默认 auto：哪儿装了对哪儿）
//   node reconcile.mjs --json             机器可读输出
//   node reconcile.mjs --self-check       离线自检（不联网）
//
// 它干什么：让本机这套「都爆鸭」skill **等于**上游当前全集——
//   上游已下架的归档掉、新增的装上、落后当前版的刷新；已经是当前版的一个都不动。
//
// 🔴 怎么判「这包是不是我们发的」：**判据是 slug × 内容哈希这一对**——先拿目录名（slug）
//    去闭集里索到那一栏，再比内容哈希，两把尺子都命中才算数。上游 known-hashes.json 就是
//    这张「我们发布过的每一版 slug × 内容哈希」的闭集（由 tools/build_known_hashes.py 从
//    git 历史聚出来）。它**不看安装记录里的 source 字段**，所以那里写的是 doubaoya-community
//    还是早期的 redfox-community 都照样认；别家有同名包也不怕——slug 撞上但哈希不命中，
//    会落进「用户动过手」那一态，同样一个字都不动。
//
// 🔴 三态，不是两态：
//    命中当前版      → 已经是最新的，保留不动（除非 --force-refresh）
//    命中历史版      → 我们的旧包，可刷新可归档可替换
//    谁的版本都不命中 → **用户动过手**，跳过并列进报告，一个字都不动
//
// 🔴 删除一律做成「移进归档目录」，不做 rm。用户机器我们看不见，多一个目录的成本，
//    换「删错了还能捞回来」。归档后直接打印可复制粘贴的复原命令；归档根自带 .gitignore
//    对 git 隐形，不污染用户仓库。
//
// 🔴 受 git 跟踪的包一个都不归档。「把 skill 版本化进自己仓库」是真实存在的用法，
//    对这种包做归档 = 从人家 git 工作区里删受跟踪文件。判不出来时按「受跟踪」保守处理。
//
// 为什么不能直接用 `npx skills update`：它只更新「已经装了的」，
// 永远删不掉上游已经砍掉的那些——那些会永久停在被砍前的旧契约上。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
 *
 * 🔴 刷新单只收「内容哈希 ≠ 上游当前版」的包，命中当前版的进 upToDate 一个都不动。
 *    之前是「还在上游的全进刷新单」，后果是**收敛态永远不收敛**：本机已经和上游一模一样了，
 *    计划仍然是「重下 43 个」，用户每跑一次都看见一大串动作，于是分不清「真有更新」和
 *    「跑了个空转」——而这正是对账器唯一要回答的问题。
 * opts.forceRefresh 恢复「全量重下」的老语义，留给「我这个包坏了想重下一遍」。
 */
export function planReconcile(installed, upstreamNames, opts = {}) {
  const upstream = new Set(upstreamNames);
  const archive = [];
  const keep = [];
  const untouched = [];
  for (const { name, state } of installed) {
    if (state === "foreign" || state === "modified") untouched.push({ name, state });
    else if (!upstream.has(name)) archive.push(name);
    else keep.push({ name, state });
  }
  const present = new Set(installed.map((i) => i.name));
  const add = [...upstream].filter((n) => !present.has(n)).sort();
  // 用户动过手的，连装都不许再装一遍盖掉它
  const blocked = new Set(untouched.filter((u) => u.state === "modified").map((u) => u.name));
  const stale = (k) => Boolean(opts.forceRefresh) || k.state !== "current";
  return {
    archive: archive.sort(),
    add: add.filter((n) => !blocked.has(n)),
    refresh: keep.filter(stale).map((k) => k.name).sort(),
    upToDate: keep.filter((k) => !stale(k)).map((k) => k.name).sort(),
    untouched: untouched.sort((a, b) => a.name.localeCompare(b.name)),
    blocked: [...blocked].sort(),
    gitTracked: [],
    gitUnknown: [],
  };
}

// ------------------------------------------------- 🔴 受 git 跟踪的包，绝不归档

/**
 * 从 dir 往上找 .git（linked worktree 里 .git 是文件，不是目录），找不到返回 null。
 */
function gitWorktreeRoot(dir) {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, ".git"))) return cur;
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

/**
 * 🔴 这些目录里有被 git 跟踪的文件吗？归档 = 把目录从原处搬走，对受跟踪的文件来说
 * 等于「从用户的 git 工作区里删掉文件」。而「把 skill 版本化进仓库」是社区里真实
 * 存在的用法（`.gitignore` 里 `.claude/*` 之后 `!.claude/skills/` 反选回来），不是孤例。
 *
 * 🔴 判不出来一律当成「受跟踪」：git 跑挂了、退出码非 0、命令不存在——宁可少归档一个
 *    （用户下次还能再跑），也不可能拿别人 git 工作区里的文件赌一把。
 *    唯一的快路径是「压根不在任何 git 工作树里」，那才是确定安全。
 *
 * 🔴 结论一样是「跳过」，但**原因必须带出来**，因为用户的正确处置完全不同：
 *    tracked 是「这是你自己版本化的包，你想清就自己 git rm」，unknown 是「你的 git 坏了，
 *    先去修 git」。只说一句「跳过了」，两拨人都不知道下一步该干什么。
 */
export function pathsWithTrackedFiles(paths) {
  const hit = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (!gitWorktreeRoot(p)) continue; // 不在 git 工作树里 ⇒ 确定没有受跟踪文件
    const res = spawnSync("git", ["-C", p, "ls-files", "--", "."], { encoding: "utf-8" });
    if (res.error || res.status !== 0) hit.push({ path: p, reason: "unknown" });
    else if ((res.stdout || "").trim()) hit.push({ path: p, reason: "tracked" });
  }
  return hit;
}

/** 归档候选里，哪些真受 git 跟踪（tracked），哪些是 git 判不出来的（unknown）。两者都不归档。 */
function findGitTracked(names, survey) {
  const tracked = [];
  const unknown = [];
  for (const name of names) {
    const entry = survey.find((s) => s.name === name);
    const paths = (entry?.dirs || []).map((d) => join(d.path, name));
    const hits = pathsWithTrackedFiles(paths);
    if (!hits.length) continue;
    // 同一个包装在两个目录、两处原因不一样：按「真受跟踪」这条更明确的说。
    if (hits.some((h) => h.reason === "tracked")) tracked.push(name);
    else unknown.push(name);
  }
  return { tracked: tracked.sort(), unknown: unknown.sort() };
}

/** 这个 scope 里到底有几个本鸭包（别人家的不算）。判 scope 有没有落空用它。 */
export function ourPackageCount(survey) {
  return survey.filter((s) => s.state !== "foreign").length;
}

/**
 * 把受 git 跟踪的从归档单里摘出来，单列一栏大声说明。纯函数，好自检。
 *
 * ponytail: 天花板 = **只挡归档，不挡刷新**。受跟踪的包如果还在上游，仍会被 `skills add`
 * 覆写。这是有意停在这里的：
 *   - 刷新只作用于**内容哈希命中我们发布版**的包，也就是用户一个字没改过的；用户改过的
 *     早在三态判定里被摘进 `modified`，连刷新都不给（见 planReconcile）。所以「覆写一个
 *     未经修改的受跟踪文件」正是用户说「更新都爆鸭」时要的结果。
 *   - 而且刷新对 git 是**可见**的：status 里看得到、能 diff、能 revert。归档是把目录整个
 *     搬走，对受跟踪文件等于不可见的丢失——两者量级不同，所以只有后者配得上一条红线。
 * 升级路径：真要连刷新一起挡，就在执行前对「受跟踪且在刷新单里」的包做一次二次确认
 * （列出名字问 y/N），别默默跳过——默默跳过会让用户以为已经更新到最新版了。
 */
export function splitGitTracked(plan, held) {
  const tracked = new Set(held?.tracked || []);
  const unknown = new Set(held?.unknown || []);
  return {
    ...plan,
    archive: plan.archive.filter((n) => !tracked.has(n) && !unknown.has(n)),
    gitTracked: plan.archive.filter((n) => tracked.has(n)).sort(),
    gitUnknown: plan.archive.filter((n) => unknown.has(n)).sort(),
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

function doubaoyaHome(scope) {
  return join(scope.kind === "global" ? homedir() : scope.dir, ".doubaoya");
}

function archiveRoot(scope) {
  return join(doubaoyaHome(scope), "archive", timestamp());
}

/**
 * 🔴 归档根落在用户**自己的项目仓**里，而 `.doubaoya` 默认没人忽略它（实测
 * `git check-ignore .doubaoya` exit=1）。后果：谁在自己项目里跑完一次对账，`git status`
 * 就多出几十个 skill 目录树的未跟踪文件，下一次 `git add -A` 直接把归档物提进他的仓库。
 *
 * 解法用 git 原生的嵌套 .gitignore：`.doubaoya/.gitignore` 写 `*`，连它自己一起忽略，
 * 整个目录对 git 隐形。**不去改用户的 .gitignore**——那是别人的文件，越界。
 * 用户自己写过这个文件就一个字都不动。
 */
export function ensureSelfIgnored(home) {
  const file = join(home, ".gitignore");
  if (existsSync(file)) return file;
  mkdirSync(home, { recursive: true });
  writeFileSync(file, "*\n");
  return file;
}

/**
 * 「怎么把归档捞回来」——可直接复制粘贴的一条命令，读 manifest 逐条移回原处。
 * ponytail: 用单引号包路径，天花板是归档路径里含单引号时得自己改写；路径 = 用户目录 +
 * 时间戳，实际不会有。升级路径是改成 `node <脚本> --restore <目录>` 子命令。
 */
function restoreCommand(root) {
  return (
    `node -e "const p=require('path'),f=require('fs');` +
    `for(const it of require('${join(root, "manifest.json")}').packages){` +
    `f.mkdirSync(p.dirname(it.from),{recursive:true});f.renameSync(it.to,it.from)}"`
  );
}

/**
 * 把包移进归档目录。**绝不 rm**——用户机器我们看不见，删错了得能捞回来。
 * 按来源目录分层存放，并写一份 manifest 说明每个包原来在哪、怎么放回去。
 */
function archivePackages(scope, names, survey) {
  if (!names.length) return null;
  const root = archiveRoot(scope);
  ensureSelfIgnored(doubaoyaHome(scope));
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
    restore: "把下面每条的 to 移回 from 即可复原（mv <to> <from>），或整份复原跑 restoreCommand 那条",
    restoreCommand: restoreCommand(root),
    restoreNote:
      "移回原处后 skill 立刻能用（宿主是按目录读的）；但 skills CLI 的安装记录已经清掉了，" +
      `想让 npx skills list 也认回来，就再跑一次：npx -y skills add ${REPO} -s <包名>`,
    packages: moved,
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { root, count: moved.length };
}

// ---------------------------------------------------------------- 执行

function runSkills(args, cwd) {
  // --json 下把子进程的 stdout 也拨到 stderr（fd 2）：npx 的进度条同样会毁掉那份 JSON。
  const stdio = jsonMode ? ["inherit", 2, "inherit"] : "inherit";
  const res = spawnSync("npx", ["-y", "skills", ...args], { stdio, cwd });
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

  // 🔴 只报「设没设」，**一个字符的密钥内容都不许进日志**——这份输出会被用户原样贴进
  //    issue、群里、给 agent 转述。前缀看着人畜无害，但它是密钥的一部分，没有例外。
  const key = process.env.DOUBAOYA_API_KEY;
  checks.push(
    key
      ? { name: "API 钥匙", ok: true, detail: "DOUBAOYA_API_KEY 已设置。" }
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
  const o = { yes: false, dryRun: false, json: false, verbose: false, forceRefresh: false, scope: "auto", dir: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") o.yes = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--force-refresh") o.forceRefresh = true;
    else if (a === "--self-check") continue; // 入口那儿已经拦掉了，这里只是别把它报成不认识的参数
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

function printPlan(scope, survey, plan, opts, upstreamCount) {
  const counts = survey.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] || 0) + 1 }), {});
  console.log(`\n── ${scope.label}`);
  console.log(
    `   已装 ${survey.length} 个：当前版 ${counts.current || 0}、我们的旧版 ${counts.historical || 0}、` +
      `你改过的 ${counts.modified || 0}、别人的 ${counts.foreign || 0}`
  );
  // 🔴 scope 落空的静默陷阱：`--scope auto` 强依赖 cwd，cwd 选错 ⇒ 目标 scope 一个本鸭包
  //    都没有 ⇒ 计划静默变成「整仓新增 N、归档 0」，等于凭空多出一整套副本，而真正该清的
  //    死包一个没清。计划本身长得完全正常，不吼一嗓子没人看得出来。
  if (ourPackageCount(survey) === 0 && plan.add.length >= upstreamCount && upstreamCount > 0) {
    console.log(
      `   ⚠️ 这个 scope 现在一个本鸭 skill 都没有，所以计划变成了「整仓装 ${plan.add.length} 个」。\n` +
        `      如果你本来是想更新装在**别处**的那套，先确认 --scope / --project-dir 再跑\n` +
        `      （--scope auto 是按当前目录猜的，cwd 选错就会静默变成这样）。`
    );
  }
  if (plan.archive.length) {
    console.log(`   📦 要归档 ${plan.archive.length} 个（上游已下架；移进归档目录，不删）：`);
    for (const n of plan.archive) console.log(`        - ${n}`);
  }
  // 🔴 两栏分开说。结论都是「没动」，可原因不同、用户该做的事也完全不同：
  //    上面那栏是「这是你自己版本化的包」，下面那栏是「我判不出来，你的 git 得先修」。
  if (plan.gitTracked?.length) {
    console.log(
      `   🔒 有 ${plan.gitTracked.length} 个上游已下架、但它们在你的 git 仓库里是**受跟踪的文件**——` +
        `这是你自己版本化进仓库的包，我不动：`
    );
    for (const n of plan.gitTracked) console.log(`        ! ${n}`);
    console.log(`        （归档=把目录从原处搬走，对受跟踪文件等于从你工作区删文件。要清就你自己来：`);
    console.log(`         先 git 提交存个档，再 git rm -r <路径>，然后重跑本对账。）`);
  }
  if (plan.gitUnknown?.length) {
    console.log(
      `   ❔ 有 ${plan.gitUnknown.length} 个上游已下架，但**我没法判断它们是不是受 git 跟踪**（git 没跑成），` +
        `保守起见跳过、没动：`
    );
    for (const n of plan.gitUnknown) console.log(`        ? ${n}`);
    console.log(`        （不是你版本化了它们，是这台机器上的 git 没能回答我。先确认 git 装了、能跑：`);
    console.log(`         git -C <包所在目录> ls-files —— 修好再重跑本对账，它们就会正常归档。）`);
  }
  if (plan.add.length) {
    console.log(`   ✨ 要新增 ${plan.add.length} 个：`);
    for (const n of plan.add) console.log(`        + ${n}`);
  }
  if (plan.refresh.length) {
    console.log(
      opts.forceRefresh
        ? `   ♻️  要刷新 ${plan.refresh.length} 个（--force-refresh：不分新旧，全部重下一遍）`
        : `   ♻️  要刷新 ${plan.refresh.length} 个（本机这份落后于上游当前版）`
    );
  }
  if (plan.upToDate?.length) {
    console.log(`   ✅ 已经是当前版的 ${plan.upToDate.length} 个，不动（真想全部重下一遍：加 --force-refresh）`);
  }
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

// `--json` 下 stdout 归 JSON 独占，人看的字一律走 stderr。
let jsonMode = false;
function say(...args) {
  if (jsonMode) console.error(...args);
  else console.log(...args);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    // 用法块就是文件头那几行，按「用法:」到第一行非缩进注释为界取，别写死行号——
    // 写死行号的下场是加一个参数就把 --help 悄悄截断，而没人会为 --help 写测试。
    const lines = readFileSync(new URL(import.meta.url), "utf-8").split("\n");
    const start = lines.findIndex((l) => l.startsWith("// 用法:"));
    const end = lines.findIndex((l, i) => i > start && !l.startsWith("//   "));
    console.log(lines.slice(start, end).join("\n").replace(/^\/\/ ?/gm, ""));
    return 0;
  }

  // 🔴 `--json` 时 stdout **只许是一份纯 JSON**，否则下游 `| jq .` 当场炸
  //    （SyntaxError: Unexpected token '提'）。提示、进度、以及 npx 自己的输出一律改走
  //    stderr，提示本身并进 JSON 里——不是丢掉，是换个出口。
  jsonMode = opts.json;

  const upstream = await fetchUpstream();
  for (const n of upstream.notes) say(`提示：${n}`);
  const scopes = resolveScopes(opts, upstream.knownHashes);

  // ---- 先把清单摊开给人看，一个字都还没改
  const report = [];
  for (const scope of scopes) {
    const survey = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    const draft = planReconcile(survey, upstream.names, { forceRefresh: opts.forceRefresh });
    // 🔴 归档之前先问 git：受跟踪的包一律摘出来不动（详见 splitGitTracked）。
    //    只对归档候选跑 git，不是对全部已装包——一次对账最多几十次探测，可忽略。
    const plan = splitGitTracked(draft, findGitTracked(draft.archive, survey));
    report.push({ scope, survey, plan });
  }

  // 🔴 刷新一样是「往用户磁盘上写文件」的动作（`skills add` 会原地覆写），不该比归档少一道门。
  //    它也是这个计数唯一的真相来源：totalChanges === 0 必须真的等于「一个动作都没有」。
  const totalChanges = report.reduce((n, r) => n + r.plan.archive.length + r.plan.add.length + r.plan.refresh.length, 0);
  if (!opts.json) {
    console.log(`\n上游现有 ${upstream.names.length} 个 skill；我们发布过的历史版本闭集覆盖 ${Object.keys(upstream.knownHashes).length} 个 slug`);
    for (const { scope, survey, plan } of report) printPlan(scope, survey, plan, opts, upstream.names.length);
    if (totalChanges === 0) console.log(`\n结论：无需任何操作——本机已经和上游当前全集完全一致。`);
  }

  if (opts.dryRun) {
    // notes 并进 JSON（不是丢掉）：它是「上游名单从哪来」的唯一线索，机器也该读得到。
    if (opts.json) console.log(JSON.stringify({ notes: upstream.notes, names: upstream.names, report: report.map(stripScope), executed: false }, null, 2));
    return 0;
  }

  // ---- 要动手了，先要确认（红线：归档绝不能是默认行为）
  if (totalChanges > 0 && !opts.yes) {
    if (!process.stdin.isTTY) {
      console.error("\n停下了：这份清单有要写你磁盘的动作（归档 / 新增 / 刷新），但当前不是交互终端，没法向你确认。\n确认清单没问题后，加 --yes 再跑一次。");
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
      say(`\n归档 ${plan.archive.length} 个上游已下架的 skill（移走，不删）…`);
      const res = archivePackages(scope, plan.archive, survey);
      archived.push({ scope: scope.label, ...res });
      say(`   已移到 ${res.root}`);
      // 目录已经移走，这一步只是让 skills CLI 把自己的安装记录也清掉。
      // 不传 -a：remove 省略 -a 时打到全部 agent；别照 --help 写 -a '*'，remove 不认星号。
      runSkills(["remove", ...plan.archive, ...scopeFlag, "-y"], cwd);
    }

    // 只装该装的：用户改过的包被排除在外，免得 --all 一把盖掉人家的改动。
    const want = [...plan.add, ...plan.refresh].sort();
    if (want.length) {
      say(`\n拉取上游 ${want.length} 个 skill…`);
      runSkills(["add", REPO, ...scopeFlag, "-s", ...want, "-a", "*", "-y"], cwd);
    }
  }

  // ---- 复核 + 自检
  const results = [];
  for (const { scope, survey, plan } of report) {
    const after = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    // 受 git 跟踪的是**故意**留在原地的，不算「没归档掉」——否则它每次都把退出码顶成 3，
    // 谁把 skill 版本化进仓库谁就永远看到一次假红。
    const kept = new Set([...plan.gitTracked, ...plan.gitUnknown]);
    const stillStale = after
      .filter((s) => s.state === "historical" && !upstream.names.includes(s.name) && !kept.has(s.name))
      .map((s) => s.name);
    const keptModified = plan.untouched
      .filter((u) => u.state === "modified")
      .filter((u) => after.find((a) => a.name === u.name)?.state === "modified").length;
    const keptForeign = plan.untouched
      .filter((u) => u.state === "foreign")
      .filter((u) => after.find((a) => a.name === u.name)?.state === "foreign").length;
    // 🔴 自检问的是「该在的都在吗」，不是「这次动过的都在吗」。刷新单收窄之后，收敛态下
    //    add / refresh 都是空的，只拿它们去查等于一个包都没查、还打印「都能找到」——
    //    正好在最该确认「东西真的还在」的那一跑上变成空转。已经是当前版的那些同样该在场。
    const expect = [...plan.add, ...plan.refresh, ...(plan.upToDate || [])];
    const checks = await selfTest(scope, expect);
    results.push({ scope, plan, after, stillStale, keptModified, keptForeign, checks });
  }

  if (opts.json) {
    console.log(JSON.stringify({ notes: upstream.notes, results: results.map(stripScope), archived, executed: true }, null, 2));
    return results.every((r) => r.checks.every((c) => c.ok)) ? 0 : 3;
  }

  let allOk = true;
  for (const r of results) {
    const counts = r.after.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] || 0) + 1 }), {});
    console.log(`\n── ${r.scope.label} 对账完成`);
    console.log(
      `   归档 ${r.plan.archive.length}，新增 ${r.plan.add.length}，刷新 ${r.plan.refresh.length}，` +
        `本来就是当前版没动 ${r.plan.upToDate.length}`
    );
    if (r.plan.gitTracked.length) {
      console.log(
        `   🔒 另有 ${r.plan.gitTracked.length} 个上游已下架、但在你 git 仓库里受跟踪（你自己版本化的包），没动：${r.plan.gitTracked.join(", ")}`
      );
    }
    if (r.plan.gitUnknown.length) {
      console.log(
        `   ❔ 另有 ${r.plan.gitUnknown.length} 个上游已下架，但 git 没跑成、判不出是否受跟踪，保守跳过：${r.plan.gitUnknown.join(", ")}`
      );
    }
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
  // 🔴 归档必须**同时**告诉用户「怎么捞回来」，而且是能直接粘贴的命令。只写「见 manifest」
  //    等于把复原门槛推给用户自己在终端里翻 JSON——那道门槛高到等于没有复原路径。
  for (const a of archived) {
    if (!a?.count) continue;
    console.log(`\n归档的 ${a.count} 份原样躺在 ${a.root}`);
    console.log(`   确认没问题 → 整个目录删掉即可。`);
    console.log(`   想全部捞回来 → 照抄这一条（按 manifest 逐条移回原处）：\n`);
    console.log(`   ${restoreCommand(a.root)}\n`);
    console.log(`   移回去就立刻能用（宿主是按目录读 skill 的）；但 skills CLI 的安装记录已经清掉，`);
    console.log(`   想让 \`npx skills list\` 也认回来，再跑一次：npx -y skills add ${REPO} -s <包名>`);
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

/**
 * 🔴 红线的**实证**：造一个真的 git 仓，把一个「命中历史版、上游已下架」的包 git add 进去，
 * 走完整条真实链路（findGitTracked → splitGitTracked → archivePackages），断言：
 *   1. 受跟踪那个包**没有被搬走**，文件原地还在；
 *   2. 没受跟踪的那个正常归档了；
 *   3. 归档根旁边生成了自忽略的 .doubaoya/.gitignore（`*`）。
 * 不 mock git、不 mock 文件系统——这条要防的就是「判定看着对、真跑起来还是把文件搬走了」。
 */
function gitTrackedFixtureCheck() {
  const fails = [];
  const probe = spawnSync("git", ["--version"], { encoding: "utf-8" });
  if (probe.error || probe.status !== 0) return ["git 跑不起来，受跟踪红线的实证自检没法做（这条不能跳过）"];

  const root = mkdtempSync(join(tmpdir(), "dby-reconcile-selfcheck-"));
  try {
    const skillsDir = join(root, ".claude", "skills");
    for (const name of ["tracked-pkg", "loose-pkg"]) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
    }
    const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf-8" });
    git("init", "-q");
    git("config", "user.email", "selfcheck@example.com");
    git("config", "user.name", "selfcheck");
    // 用户把 skill 版本化进自己仓库——真实存在的用法（`.claude/*` 后面 `!.claude/skills/`）
    git("add", "-f", ".claude/skills/tracked-pkg");
    git("commit", "-qm", "track a skill");

    const scope = { kind: "project", dir: root, label: "selfcheck fixture" };
    const dirs = [{ label: ".claude/skills", path: skillsDir }];
    const survey = [
      { name: "loose-pkg", hash: "bbb", state: "historical", dirs },
      { name: "tracked-pkg", hash: "bbb", state: "historical", dirs },
    ];
    const draft = planReconcile(survey, ["dby"]); // 两个包上游都已下架 ⇒ 都是归档候选
    if (JSON.stringify(draft.archive) !== JSON.stringify(["loose-pkg", "tracked-pkg"])) {
      fails.push(`fixture 前提不成立：归档候选应是两个，实际 ${JSON.stringify(draft.archive)}`);
    }
    const plan = splitGitTracked(draft, findGitTracked(draft.archive, survey));
    if (JSON.stringify(plan.gitTracked) !== JSON.stringify(["tracked-pkg"])) {
      fails.push(`受跟踪的包没被识别出来：gitTracked=${JSON.stringify(plan.gitTracked)}`);
    }
    // git 在这个 fixture 里是好的，所以「判不出来」那栏必须是空的——不然两种原因就串了栏。
    if (JSON.stringify(plan.gitUnknown) !== JSON.stringify([])) {
      fails.push(`git 明明跑得通，却把包记进了「判不出来」栏：gitUnknown=${JSON.stringify(plan.gitUnknown)}`);
    }
    const archived = archivePackages(scope, plan.archive, survey);

    // 1. 受跟踪的必须原地还在（这是整条链最薄的一层冰）
    if (!existsSync(join(skillsDir, "tracked-pkg", "SKILL.md"))) {
      fails.push("🔴 受 git 跟踪的包被归档搬走了——这条是防数据丢失红线");
    }
    // 2. 没受跟踪的正常归档
    if (existsSync(join(skillsDir, "loose-pkg"))) fails.push("没受跟踪的包没被归档走");
    // 3. 归档目录对 git 隐形
    const ignore = join(root, ".doubaoya", ".gitignore");
    if (!existsSync(ignore)) fails.push("归档根旁边没写 .doubaoya/.gitignore，归档物会污染用户的 git");
    else if (readFileSync(ignore, "utf-8").trim() !== "*") fails.push(".doubaoya/.gitignore 内容不是 `*`");
    const status = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf-8" });
    if ((status.stdout || "").includes(".doubaoya")) fails.push(`归档物出现在 git status 里：${status.stdout.trim()}`);

    // 4. 🔴 打给用户的那条复原命令必须**真的能复原**。一条跑不通的复原命令比没有更糟：
    //    用户以为有退路，真要捞的时候才发现没有。所以这里真跑一遍它。
    const restore = spawnSync("sh", ["-c", restoreCommand(archived.root)], { encoding: "utf-8" });
    if (restore.status !== 0) fails.push(`复原命令跑不通（退出码 ${restore.status}）：${(restore.stderr || "").trim().split("\n")[0]}`);
    if (!existsSync(join(skillsDir, "loose-pkg", "SKILL.md"))) fails.push("🔴 复原命令没把归档的包移回原处");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 fail-closed 的**实证**：git 探测失败时，包必须照样被判成「不许归档」。
 * 之前那条真 git 仓的自检里 git 是好的，所以它只证得了「tracked 认得出来」，
 * 把 `res.error || res.status !== 0` 那半句删掉它一样全绿——而删掉的后果是：
 * 谁的 git 坏了、或者根本没装 git，他受跟踪的 skill 目录就会被真的搬走。
 *
 * 造法不 mock：写一个内容是垃圾的 `.git` 文件。gitWorktreeRoot 认得出「在工作树里」，
 * 而 `git ls-files` 读到非法 gitfile 会 fatal 退出非 0 —— 正是要防的那个现场。
 */
function gitProbeFailureCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-gitprobe-selfcheck-"));
  try {
    writeFileSync(join(root, ".git"), "这不是合法的 gitfile\n");
    const pkg = join(root, "some-pkg");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), "---\nname: some-pkg\n---\n");

    const hits = pathsWithTrackedFiles([pkg]);
    if (hits.length !== 1) {
      fails.push(`🔴 git 探测失败时没有 fail-closed：这个包被放行了（hits=${JSON.stringify(hits)}）`);
    } else if (hits[0].reason !== "unknown") {
      fails.push(`git 探测失败应记成 unknown（好让用户知道该去修 git），实际 reason=${hits[0].reason}`);
    }

    // 走完整条链：判不出来的同样一个都不许进归档单。
    const survey = [{ name: "some-pkg", hash: "bbb", state: "historical", dirs: [{ label: ".claude/skills", path: root }] }];
    const plan = splitGitTracked(planReconcile(survey, ["dby"]), findGitTracked(["some-pkg"], survey));
    if (plan.archive.length) fails.push(`🔴 git 判不出来的包进了归档单：${JSON.stringify(plan.archive)}`);
    if (JSON.stringify(plan.gitUnknown) !== JSON.stringify(["some-pkg"])) {
      fails.push(`git 判不出来的包没单列进 gitUnknown：${JSON.stringify(plan.gitUnknown)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 `--json` 的 stdout 必须是**一份能被 JSON.parse 整个吃下去的纯 JSON**。
 * 判据只认这一个：真起一个子进程跑 `--dry-run --json`，把它的 stdout 原样喂给
 * JSON.parse。不用「以 { 开头」这种弱断言——弱断言正是被绕过的那种闸。
 *
 * 完全离线：DBY_RAW_BASE 指向一个临时 fixture 目录（非 http 时 fetchJson 直接读文件），
 * 目标 scope 也指到临时目录，所以既不联网、也碰不到本机任何真实安装目录。
 * 顺带这条 fixture 必然触发那句「用的是 DBY_RAW_BASE 指定的上游」提示——正是当初污染
 * stdout 的那一句，所以这个自检天然踩在缺陷现场上。
 */
function jsonPurityCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-json-selfcheck-"));
  try {
    writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: { "some-skill": "doubaoya-skill/some-skill@aaaaaaaaaaaa" } }));
    writeFileSync(join(root, "known-hashes.json"), JSON.stringify({ skills: { "some-skill": ["aaaaaaaaaaaa"] } }));
    const res = spawnSync(
      process.execPath,
      [new URL(import.meta.url).pathname, "--dry-run", "--json", "--scope", "project", "--project-dir", root],
      { encoding: "utf-8", env: { ...process.env, DBY_RAW_BASE: root } }
    );
    if (res.status !== 0) return [`--json 跑挂了（退出码 ${res.status}）：${(res.stderr || "").trim().split("\n").pop()}`];
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      return [`🔴 --json 的 stdout 不是合法 JSON（${err.message}）；头 40 字：${JSON.stringify(res.stdout.slice(0, 40))}`];
    }
    if (parsed.executed !== false) fails.push(`--json --dry-run 的 executed 应为 false，实际 ${JSON.stringify(parsed.executed)}`);
    // 提示不是被丢掉，是换了出口：JSON 里要有，stderr 上也要有。
    if (!Array.isArray(parsed.notes) || !parsed.notes.length) fails.push("提示没并进 JSON 的 notes 里（丢信息也不行）");
    if (!(res.stderr || "").includes("提示：")) fails.push("提示没走 stderr");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 M4：`gitTracked` 与 `gitUnknown` 两栏的**文案必须能分辨**。
 *
 * 两栏的结论都是「没动」，可原因不同、用户该做的事**完全相反**：
 *   🔒 受跟踪  ⇒ 是你自己版本化进仓库的包，工具不该动它，要清是**你自己 git rm**；
 *   ❔ 判不出  ⇒ 是这台机器上的 git 没能回答我，**修好 git 重跑**它们就会正常归档。
 * 数据层早就分成两个数组了（上面 splitGitTracked 那几条自检钉死了），但**用户只看得见文案**——
 * 两栏要是印出同一句话，分栏就等于没分：用户按「你自己 git rm」去删一个其实只是 git 没跑成的包，
 * 是真的会丢文件的。数据分了、文案没分，这种退化长得和通过一模一样，所以单独钉一条。
 *
 * 判据三条：两句各自带着**自己那条处置建议**的关键短语、且这两行**逐字不同**。
 * ponytail: 天花板 = 换一套同样能分辨的措辞会误报（关键短语是写死的字面量）；升级路径是
 * 把两句文案抽成具名常量再断言常量不等——但那要为一条自检重排 printPlan 的结构，先不做。
 */
function printPlanColumnsCheck() {
  const fails = [];
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    printPlan(
      { label: "自检 scope" },
      [],
      {
        archive: [], add: [], refresh: [], upToDate: [], untouched: [], blocked: [],
        gitTracked: ["tracked-pkg"],
        gitUnknown: ["unknown-pkg"],
      },
      {},
      0 // upstreamCount=0：让「scope 落空」那条告警不参与本次断言
    );
  } finally {
    console.log = original;
  }

  const tracked = lines.filter((l) => l.includes("🔒"));
  const unknown = lines.filter((l) => l.includes("❔"));
  if (tracked.length !== 1) fails.push(`受跟踪那一栏的抬头应当只有一行，实际 ${tracked.length} 行`);
  if (unknown.length !== 1) fails.push(`判不出那一栏的抬头应当只有一行，实际 ${unknown.length} 行`);
  if (fails.length) return fails;

  // 各自带着自己那条处置建议的关键短语
  if (!tracked[0].includes("受跟踪")) fails.push(`🔒 那栏没说清这是「受跟踪」的包：${JSON.stringify(tracked[0])}`);
  if (!unknown[0].includes("没法判断")) fails.push(`❔ 那栏没说清这是「没法判断」：${JSON.stringify(unknown[0])}`);
  // 🔴 最要命的那一种：正文被复制成同一句，只有开头那个图标不一样——分栏就等于没分。
  //    所以比的是**去掉图标之后的正文**：只比整行的话，图标不同就永远不相等，这条断言等于没写。
  const body = (line) => line.replace(/[🔒❔]/g, "").trim();
  if (body(tracked[0]) === body(unknown[0])) {
    fails.push(`两栏正文是同一句，用户分不出该自己 git rm 还是该去修 git：${JSON.stringify(tracked[0])}`);
  }
  return fails;
}

/**
 * 造一份「只装了一个包、上游也只有这一个包」的离线 fixture。
 *   converged 上游当前版 = 本机这份内容哈希 ⇒ 三态是 current
 *   stale     上游当前版是另一个哈希，本机这份只是历史版 ⇒ 三态是 historical
 * 哈希是真算出来的（computeSkillHash），不是编的，所以判定链路整条都在场。
 */
function buildScopeFixture(mode) {
  const root = mkdtempSync(join(tmpdir(), `dby-${mode}-selfcheck-`));
  const pkg = join(root, ".claude", "skills", "some-skill");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "SKILL.md"), "---\nname: some-skill\n---\n");
  const mine = computeSkillHash(pkg);
  const other = mine === "0".repeat(12) ? "1".repeat(12) : "0".repeat(12);
  const current = mode === "converged" ? mine : other;
  writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: { "some-skill": `doubaoya-skill/some-skill@${current}` } }));
  writeFileSync(join(root, "known-hashes.json"), JSON.stringify({ skills: { "some-skill": [mine, other] } }));
  return root;
}

/** PATH 上放一个假 npx：真被调用了就留下痕迹，且绝不联网、绝不动真东西。 */
function stubNpxDir() {
  const bin = mkdtempSync(join(tmpdir(), "dby-stub-npx-"));
  const marker = join(bin, "called.log");
  writeFileSync(join(bin, "npx"), `#!/bin/sh\necho "$@" >> '${marker}'\nexit 0\n`, { mode: 0o755 });
  return { bin, marker };
}

/**
 * 🔴 收敛态必须真的收敛。这条自检钉三件事，每一件都对应一个真出过事的形态：
 *   ① 本机已经和上游一致 ⇒ 计划是**零动作**（不是「照样重下 43 个」）；
 *   ② `--force-refresh` 仍然能把全量重下要回来（收窄不许把「包坏了想重下」这个能力砍掉）；
 *   ③ 只有刷新、没有归档也没有新增时，非交互跑**必须停在确认门**（退出码 2）——
 *      刷新同样是往用户磁盘写文件，门要是不计刷新，这一跑就会静默重下。
 * 全程离线：DBY_RAW_BASE 指向 fixture 目录，npx 是 PATH 上的假的。
 */
function refreshScopeCheck() {
  const fails = [];
  const script = new URL(import.meta.url).pathname;
  const { bin, marker } = stubNpxDir();
  const run = (root, args) =>
    spawnSync(process.execPath, [script, "--scope", "project", "--project-dir", root, ...args], {
      encoding: "utf-8",
      env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` },
    });
  const planOf = (res, label) => {
    if (res.status !== 0) {
      fails.push(`${label}: 跑挂了（退出码 ${res.status}）：${(res.stderr || "").trim().split("\n").pop()}`);
      return null;
    }
    try {
      return JSON.parse(res.stdout).report[0].plan;
    } catch (err) {
      fails.push(`${label}: 读不出计划（${err.message}）`);
      return null;
    }
  };
  const eqList = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };

  const converged = buildScopeFixture("converged");
  const stale = buildScopeFixture("stale");
  try {
    // ① 收敛态 = 零动作
    const plan = planOf(run(converged, ["--dry-run", "--json"]), "收敛态");
    if (plan) {
      eqList("🔴 收敛态还要刷新（等于每跑一次都全量重下）", plan.refresh, []);
      eqList("收敛态不该有新增", plan.add, []);
      eqList("收敛态不该有归档", plan.archive, []);
      eqList("收敛态该把包记进「已是当前版」", plan.upToDate, ["some-skill"]);
    }
    // ② --force-refresh 把全量重下要回来
    const forced = planOf(run(converged, ["--dry-run", "--json", "--force-refresh"]), "--force-refresh");
    if (forced) {
      eqList("🔴 --force-refresh 没能恢复全量刷新（「包坏了想重下」这条路断了）", forced.refresh, ["some-skill"]);
      eqList("--force-refresh 下不该再有「已是当前版」", forced.upToDate, []);
    }
    // ③ 只有刷新时也必须过确认门
    const stalePlan = planOf(run(stale, ["--dry-run", "--json"]), "落后态");
    if (stalePlan) {
      eqList("落后态该进刷新单", stalePlan.refresh, ["some-skill"]);
      eqList("落后态 fixture 前提：不该有归档", stalePlan.archive, []);
      eqList("落后态 fixture 前提：不该有新增", stalePlan.add, []);
    }
    const gated = run(stale, []); // 不给 --yes，且 stdin 是管道不是 TTY
    if (gated.status !== 2) {
      fails.push(
        `🔴 只有刷新动作时没停在确认门：退出码应为 2（需要确认但非交互终端），实际 ${gated.status}。` +
          `刷新也是往用户磁盘写文件，不该无门。`
      );
    }
    if (existsSync(marker)) {
      fails.push(`🔴 确认门之前就调了 npx：${readFileSync(marker, "utf-8").trim()}`);
    }
  } finally {
    for (const d of [converged, stale, bin]) rmSync(d, { recursive: true, force: true });
  }
  return fails;
}

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
  // dby 已经是当前版 ⇒ 不进刷新单，进「已是当前版」单
  eq("刷新单只收落后的", plan.refresh, []);
  eq("已是当前版的单列", plan.upToDate, ["dby"]);
  eq("不碰单", plan.untouched.map((u) => u.name), ["lark-base", "mine"]);
  // 🔴 用户改过的包在上游也存在，但绝不能被重装盖掉
  eq("改过的不进新增单", plan.add.includes("mine"), false);
  eq("改过的不进刷新单", plan.refresh.includes("mine"), false);
  eq("改过的被挡住", plan.blocked, ["mine"]);

  // 🔴 幂等要的是**零动作**，不只是「不归档不新增」：刷新也算动作。
  //    收敛态还刷新，用户每跑一次都看见一大串重下，就分不清「真有更新」和「空转」了。
  const idem = planReconcile([{ name: "dby", state: "current" }], ["dby"]);
  eq("幂等=零动作", [idem.archive, idem.add, idem.refresh], [[], [], []]);
  // 落后一版的才刷新
  const behind = planReconcile([{ name: "dby", state: "historical" }], ["dby"]);
  eq("落后版进刷新单", behind.refresh, ["dby"]);
  eq("落后版不算当前版", behind.upToDate, []);
  // 🔴 --force-refresh：全量重下的老语义必须还能要回来（「我这个包坏了想重装」）
  const forced = planReconcile([{ name: "dby", state: "current" }], ["dby"], { forceRefresh: true });
  eq("强制刷新收当前版", forced.refresh, ["dby"]);
  eq("强制刷新下没有「已是当前版」", forced.upToDate, []);
  // 强制刷新也不许碰用户改过的包——它绕开的是「新旧判定」，不是那条红线
  eq("强制刷新仍不碰改过的", planReconcile([{ name: "mine", state: "modified" }], ["mine"], { forceRefresh: true }).refresh, []);

  // 全新安装：全是新增，没有归档
  eq("全新安装", planReconcile([], ["a", "b"]), {
    archive: [], add: ["a", "b"], refresh: [], upToDate: [], untouched: [], blocked: [], gitTracked: [], gitUnknown: [],
  });

  // 🔴 受 git 跟踪的从归档单里摘出来，单列一栏；git 判不出来的另起一栏（原因不同、处置不同）
  const split = splitGitTracked(planReconcile(installed, ["dby"]), { tracked: ["retired"], unknown: [] });
  eq("受跟踪的不进归档单", split.archive, []);
  eq("受跟踪的单列一栏", split.gitTracked, ["retired"]);
  const unk = splitGitTracked(planReconcile(installed, ["dby"]), { tracked: [], unknown: ["retired"] });
  eq("判不出来的也不进归档单", unk.archive, []);
  eq("判不出来的另起一栏", [unk.gitUnknown, unk.gitTracked], [["retired"], []]);

  // scope 落空的判据：别人家的包不算数
  eq("本鸭包计数不含别人的", ourPackageCount([{ state: "foreign" }, { state: "foreign" }]), 0);
  eq("本鸭包计数", ourPackageCount([{ state: "foreign" }, { state: "current" }, { state: "modified" }]), 2);

  fails.push(...printPlanColumnsCheck());
  fails.push(...gitTrackedFixtureCheck());
  fails.push(...gitProbeFailureCheck());
  fails.push(...refreshScopeCheck());
  fails.push(...jsonPurityCheck());

  if (fails.length) {
    for (const f of fails) console.error(`selfcheck FAILED: ${f}`);
    return 1;
  }
  console.log(
    "selfcheck ok: classify / planReconcile / splitGitTracked（含真 git 仓实证：受跟踪的包不被归档、"
      + "受跟踪与判不出两栏的文案真能分辨、" +
      "git 探测失败时 fail-closed、归档根自忽略、复原命令真能复原、收敛态零动作且 --force-refresh 能全量重下、" +
      "只有刷新也过确认门、--json 的 stdout 真能被 JSON.parse）"
  );
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
