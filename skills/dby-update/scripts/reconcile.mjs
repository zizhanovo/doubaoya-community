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
//   node reconcile.mjs --pin <slug> [--reason <为什么>]   把某个包固定在当前版：对账不刷新、不归档、不迁移它
//   node reconcile.mjs --unpin <slug>     解除固定
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
//
// 🔴 自更新顺序（任务 1.1 已核实，结论钉在这里防再被问一遍）：main() 每一跑固定是
//    「摊开清单给人看 → 归档 → `skills add`（装 add + refresh，**dby-update 自己也在这批里**）
//    → 复核 + 自检」，**同一个 Node 进程绝不 re-exec**——`skills add` 只是把新版脚本文件写到磁盘，
//    正在跑的这个进程仍然是旧代码，跑到文件末尾就退出了，不会自己重启去接着用刚落地的新逻辑。
//    这就是为什么 rename 表（`renames.json`）要先于「改名内容本身」单独发一趟：老用户机器上
//    首次撞见改名时，**正在执行对账的仍是当时已经在磁盘上的那份 reconcile.mjs**——如果它还不
//    认识 rename 表，就只会把老目录整体归档（数据不丢但要用户手动搬），而不是本 change 承诺的
//    「装新包 → 搬本地数据 → 归档老目录」。所以发布必须分两趟：先发「读表 + 搬运」这套机制
//    （此时表内容为空、零行为变化），等存量用户的对账器进程都已经用上这版新代码之后，
//    再单独发一趟把 renames.json 填满。同一台机器要吃到新逻辑，必须是**下一次**用户手动
//    再跑一遍 `/dby-update`，不是本次跑完之后自动生效。详见 design.md D4「机制矛盾与两趟发布」。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// 本脚本自己在磁盘上的真实路径。要拿它去 spawn 自己时用这个，别用
// `new URL(import.meta.url).pathname`——那是**没解码**的 URL 路径段，家目录里
// 只要有一个空格就变成 `%20`，spawn 当场 ENOENT。
const SELF_PATH = fileURLToPath(import.meta.url);

const REPO = "zizhanovo/doubaoya-community";
// DBY_RAW_BASE 只给验证用：指向本地 checkout 或某个分支，好在改动 push 之前先对着
// 合成安装态跑一遍。设了它就以版本表为名单（不再问 GitHub 目录列表）。
const RAW = process.env.DBY_RAW_BASE || `https://raw.githubusercontent.com/${REPO}/main`;
const RAW_OVERRIDDEN = Boolean(process.env.DBY_RAW_BASE);
// 上游元信息的唯一事实源；拉不到时退回下面三份旧文件（过渡期一趟兼容，见 fetchUpstream）。
const INDEX_URL = `${RAW}/index.json`;
const VERSIONS_URL = `${RAW}/versions.json`;
const KNOWN_URL = `${RAW}/known-hashes.json`;
const RENAMES_URL = `${RAW}/renames.json`;
const CONTENTS_API = `https://api.github.com/repos/${REPO}/contents/skills`;
const HEALTH_URL = "https://doubaoya.com/api/health";

// 🔴 Gitee 镜像只是备源，不是第二个主源：GitHub 403/429/断网/超时时用**同一 ref** 再试一次，404 不换源
//    （文件真不存在时两边一样，且 404 是索引退回旧文件的既有信号）。取文件只走 API v5 的 contents 接口
//    （返回 base64），`/raw/` 路径匿名 404，禁用。DBY_RAW_BASE 覆盖态是验证用的单源，不回退。
const MIRROR_REPO = "zizhan66/doubaoya-community";
const GITEE_GIT_URL = `https://gitee.com/${MIRROR_REPO}.git`;
const GITEE_API = `https://gitee.com/api/v5/repos/${MIRROR_REPO}/contents`;

/** Gitee contents 接口的文件响应 `{encoding:"base64", content}` → JSON；形状不对就抛，按「备源失败」处理。 */
export function decodeGiteeContent(body) {
  if (!body || body.encoding !== "base64" || typeof body.content !== "string") {
    throw new Friendly("Gitee 镜像返回的不是 base64 文件内容（接口形状变了？）。");
  }
  return JSON.parse(Buffer.from(body.content, "base64").toString("utf-8"));
}

/**
 * 上游源表（design D1）：每个源提供三件事——按 ref 取文件、列 `skills/` 目录、`skills add` 的包参数。
 * 回退散落三处 try/catch 的话，三处的回退条件会各自漂；所以条件只写在 withFallback 一处。
 * github 的 file 走 raw（main，或 DBY_RAW_BASE）；gitee 的 file 走 API v5 `contents/<path>?ref=`。
 */
export const SOURCES = [
  {
    id: "github",
    file: (path) => ({ url: `${RAW}/${path}` }),
    listDir: () => ({ url: CONTENTS_API }),
    install: (ref) => (ref ? `${REPO}#${ref}` : REPO),
  },
  {
    id: "gitee",
    file: (path, ref = "main") => ({ url: `${GITEE_API}/${path}?ref=${encodeURIComponent(ref)}`, decode: decodeGiteeContent }),
    listDir: () => ({ url: `${GITEE_API}/skills?ref=main` }),
    // D5：无 ref 不回退 clone——两边默认分支无法保证同一内容，宁可失败。
    install: (ref) => (ref ? `${GITEE_GIT_URL}#${ref}` : null),
  },
];
const GITEE = SOURCES[1];

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
 *
 * 🔴 有安装记录（`<skill>/.dby/origin.json`，见 readOrigin）时，「用户改过没有」先看它：
 *    目录哈希 ≠ origin.hash ⇒ modified，**哪怕改完的哈希恰好撞上闭集里某个历史版**——
 *    闭集只能证明"这内容我们发过"，证不了"这台机器上装的就是那一版"。origin 是装的时候
 *    写下的，它才知道。没 origin（老版本装的、或用户删了）退回闭集判定，与今天等价。
 */
export function classify(name, hash, currentHashes, knownHashes, origin = null) {
  if (!Object.prototype.hasOwnProperty.call(knownHashes, name)) return "foreign";
  if (origin?.hash && origin.hash !== hash) return "modified";
  if (currentHashes[name] && currentHashes[name] === hash) return "current";
  if (knownHashes[name].includes(hash)) return "historical";
  // origin 说没动过、闭集却不认识这个哈希：装的那一版没进闭集（发布时漏盖戳）。信 origin——
  // 它记的就是装下来的哈希；判成"我们的旧版"让它照常刷新，判成 modified 会把它永远卡住。
  if (origin?.hash === hash) return "historical";
  return "modified";
}

/** 上游索引里这些状态等于「这个 slug 已经不该以这个名字装在本机」：归档 / 迁移单只认它们。 */
const GONE_STATUSES = new Set(["retired", "renamed", "merged"]);

/**
 * 三张单子。只有 historical 且上游已下架的才进归档单；
 * modified 一律进「不碰」单，连刷新都不给——刷新会覆盖掉用户的改动。
 *
 * 🔴 刷新单只收「内容哈希 ≠ 上游当前版」的包，命中当前版的进 upToDate 一个都不动。
 *    之前是「还在上游的全进刷新单」，后果是**收敛态永远不收敛**：本机已经和上游一模一样了，
 *    计划仍然是「重下 43 个」，用户每跑一次都看见一大串动作，于是分不清「真有更新」和
 *    「跑了个空转」——而这正是对账器唯一要回答的问题。
 * opts.forceRefresh 恢复「全量重下」的老语义，留给「我这个包坏了想重下一遍」。
 *
 * 🔴 **内容是当前版 ≠ 已经就位**。同一个包要在本机每个受管安装目录里都有落位，因为宿主是
 *    按**自己那个目录**读 skill 的（Claude Code 只读 `.claude/skills`）。包只落进
 *    `.agents/skills` 时，它在 Claude Code 眼里根本不存在——而内容哈希照样命中当前版，
 *    于是旧的判据把它归进「已是当前版、不动」，**重跑多少次 /dby-update 都自愈不了**。
 *    实测踩过：`dby-banned-words`（对外主推的可安装包之一，历史名字已改名）只在 `.agents/skills`，
 *    整场会话 Claude Code 都看不见它。
 *    所以判据是「内容 **且** 落位」：任一受管 agent 目录缺落位 ⇒ 照样进刷新单重装一遍。
 *    opts.expectedAgents 给的是本机受管的 agent 名单（与 targetAgents 同源，装和查必须同一批）；
 *    不给就退回只看内容（纯函数自检里那些没有 dirs 的合成 survey 走的就是这条）。
 *
 * 🔴 归档只依据显式状态。`opts.status`（slug → 索引里的 status）给了，就只有
 *    `retired / renamed / merged` 的进归档单；索引标 active 却不在上游目录名单里的，**不归档**，
 *    单列进 `inconsistent`（索引与目录不一致，是维护者的事，不是用户机器该承担的动作）。
 *    不给 `opts.status`（索引拉不到、退回旧文件）才走老的「名单缺席 ⇒ 下架」推断。
 * 🔴 `opts.archiveSuppressed`：上游目录列表没核到时 fail-closed——归档候选全部改进 `archiveHeld`，
 *    archive 一定是空的；刷新 / 新增不受影响，它们的依据是索引本身。
 */
/**
 * 🔴 信任边界：slug 来自上游（index.json 的键、GitHub/Gitee 的目录列表），会被拿去拼安装/归档路径
 * （全文 15 处 `join(dir, slug)`）。上游被篡改、或有人 fork 一份改了 index.json，
 * `"../../../.ssh"` 这样的名字就能把文件写到安装目录外面去。
 *
 * 发布侧确实有 `tools/validate_community.py` 的命名闸，但那是**我们自己发包时**跑的；
 * 用户装包时那道闸不在场——消费侧必须自己校验，这是信任边界的输入校验，不是防御性编程。
 *
 * 判据取"允许清单"而不是"拒绝 ..": 只放行小写字母、数字、连字符，且不以连字符开头/结尾。
 * 拒绝清单永远漏（`..`、`.`、绝对路径、`~`、NUL、Windows 盘符、Unicode 同形字…），允许清单不会。
 */
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeSlug(name) {
  return typeof name === "string" && name.length > 0 && name.length <= 64 && SAFE_SLUG.test(name);
}

/** 从上游名单里滤掉形状不合法的，滤掉了就必须说出来——静默丢弃等于把攻击面藏起来。 */
export function sanitizeSlugs(names, notes) {
  const safe = [];
  const rejected = [];
  for (const n of names || []) (isSafeSlug(n) ? safe : rejected).push(n);
  if (rejected.length && Array.isArray(notes)) {
    notes.push(
      `上游名单里有 ${rejected.length} 个名字形状不合法，已丢弃（不装、不归档、不迁移）：` +
        rejected.map((r) => JSON.stringify(String(r)).slice(0, 40)).join(", ") +
        "。合法的 slug 只含小写字母、数字与连字符。这通常意味着上游被改过，别忽略它。"
    );
  }
  return { safe, rejected };
}

export function planReconcile(installed, upstreamNames, opts = {}) {
  const upstream = new Set(upstreamNames);
  const status = opts.status || null;
  const archive = [];
  const inconsistent = [];
  const keep = [];
  const untouched = [];
  for (const item of installed) {
    const { name, state } = item;
    if (state === "foreign" || state === "modified") untouched.push({ name, state });
    else if (status) {
      if (GONE_STATUSES.has(status[name])) archive.push(name);
      else if (!upstream.has(name)) inconsistent.push(name);
      else keep.push(item);
    } else if (!upstream.has(name)) archive.push(name);
    else keep.push(item);
  }
  const archiveHeld = opts.archiveSuppressed ? archive.splice(0).sort() : [];
  const present = new Set(installed.map((i) => i.name));
  const add = [...upstream].filter((n) => !present.has(n)).sort();
  // 用户动过手的，连装都不许再装一遍盖掉它
  const blocked = new Set(untouched.filter((u) => u.state === "modified").map((u) => u.name));
  // 缺落位的：只在 keep 里找。用户改过的、别人家的早就进了 untouched，缺落位也绝不许重装盖掉。
  const wantAgents = opts.expectedAgents || [];
  const misplaced = keep
    .filter((k) => {
      if (!wantAgents.length) return false;
      const placed = new Set((k.dirs || []).map((d) => d.agent));
      return wantAgents.some((a) => !placed.has(a));
    })
    .map((k) => k.name)
    .sort();
  const misplacedSet = new Set(misplaced);
  const stale = (k) => Boolean(opts.forceRefresh) || k.state !== "current" || misplacedSet.has(k.name);
  return {
    archive: archive.sort(),
    add: add.filter((n) => !blocked.has(n)),
    refresh: keep.filter(stale).map((k) => k.name).sort(),
    upToDate: keep.filter((k) => !stale(k)).map((k) => k.name).sort(),
    misplaced,
    untouched: untouched.sort((a, b) => a.name.localeCompare(b.name)),
    blocked: [...blocked].sort(),
    gitTracked: [],
    gitUnknown: [],
    ...(status ? { inconsistent: inconsistent.sort() } : {}),
    ...(opts.archiveSuppressed ? { archiveHeld } : {}),
  };
}

/**
 * 把用户固定（pin）的包在 planReconcile **之前**从 survey 里摘出来：它们不参与任何单子——
 * 不刷新、不归档、不迁移，也不能因为"不在 survey 里"而被当成缺失重新装一遍，所以上游名单里
 * 同样要摘掉。纯函数，返回摘完的 survey / names 和单独一栏 `pinned`（带 pinReason 给预检打印）。
 */
export function splitPinned(survey, upstreamNames, lock) {
  const pins = Object.entries(lock?.skills || {}).filter(([, e]) => e?.pinned);
  if (!pins.length) return { survey, names: upstreamNames, pinned: [] };
  const pinnedSet = new Map(pins);
  const pinned = survey
    .filter((s) => pinnedSet.has(s.name))
    .map((s) => ({ name: s.name, state: s.state, hash: s.hash, reason: pinnedSet.get(s.name).pinReason || null }));
  return {
    survey: survey.filter((s) => !pinnedSet.has(s.name)),
    names: upstreamNames.filter((n) => !pinnedSet.has(n)),
    pinned,
  };
}

/**
 * 从归档单 / 不碰单里，把上游已改名的老包摘出来单起一条改名迁移候选（`renameCandidates`）。
 * 纯函数：只吃 `renames` 表（fetchUpstream 拉来的那份，空表时是 `{}`）和 upstream 名单，
 * 不碰磁盘——这样才能像 planReconcile 一样离线自检，也让「空表行为必须与无表完全相同」
 * 这条 spec 要求可以直接断言。
 *
 * 🔴 两个来源都要收：
 *   - `draft.archive` 里的（老目录内容 = 我们发布过的某个历史版，一个字没被用户碰过）；
 *   - `draft.untouched` 里 `state === "modified"` 的（用户在老目录里留过东西——**这正是要搬
 *     的那批人**：`config.json` 本身就会让内容哈希偏离已知版本，于是几乎所有真实用过这个
 *     包的用户，老目录都会落在 modified 态，不是 historical 态）。
 * `state === "foreign"` 的不碰：闭集里认不出的包不该被当成"我们的老包在等改名"。
 *
 * 只有 `renames[oldSlug].to` **真的在本次上游名单里**才算数——表可能引用一个还没上线的
 * 新 slug（发布节奏没对齐时会发生），这时按"还不能搬"处理，老目录留在原来的单子里，
 * 走旧路径（该归档归档、该不碰不碰），不因为表里有一条半成品记录就贸然搬家。
 */
export function extractRenames(draft, renames, upstreamNames) {
  const table = renames || {};
  const upstream = new Set(upstreamNames);
  const renameCandidates = [];
  const archive = draft.archive.filter((name) => {
    const entry = table[name];
    if (!entry || !upstream.has(entry.to)) return true;
    renameCandidates.push({ from: name, to: entry.to, userFiles: entry.userFiles || [] });
    return false;
  });
  const untouched = draft.untouched.filter((u) => {
    if (u.state !== "modified") return true;
    const entry = table[u.name];
    if (!entry || !upstream.has(entry.to)) return true;
    renameCandidates.push({ from: u.name, to: entry.to, userFiles: entry.userFiles || [] });
    return false;
  });
  return { ...draft, archive, untouched, renameCandidates };
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

/**
 * 改名候选里同样不许碰受 git 跟踪 / 判不出来的老目录——理由与 splitGitTracked 完全一致
 * （归档 = 从用户工作区搬走文件），只是这里归档的还是"改名后的老目录"而不是"下架的老目录"。
 * 摘出来的进 `renamedSkipped`（带上原因，spec 要求"只提示不动"），剩下的才是真正会执行
 * 「装新包 → 搬数据 → 归档老目录」这条链的 `renamed`。
 */
export function splitRenameGitTracked(plan, held) {
  const tracked = new Set(held?.tracked || []);
  const unknown = new Set(held?.unknown || []);
  const renamed = [];
  const renamedSkipped = [];
  for (const r of plan.renameCandidates || []) {
    if (tracked.has(r.from)) renamedSkipped.push({ ...r, reason: "tracked" });
    else if (unknown.has(r.from)) renamedSkipped.push({ ...r, reason: "unknown" });
    else renamed.push(r);
  }
  const { renameCandidates, ...rest } = plan;
  return { ...rest, renamed, renamedSkipped };
}

// ---------------------------------------------------------------- 人话报错

class Friendly extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

/** 标成「可换源重试」：只有 403/429、网络错、超时、clone 失败这几类才配得上（design D4）。 */
function retryable(err) {
  err.retryable = true;
  return err;
}

/**
 * 🔴 主备索引 `ref` 不一致 = 镜像落后或超前，fail-closed：在 fetchUpstream 阶段就退出，
 *    不写盘、不打清单（design D6）。`mirrorMismatch` 原样进 `--json`。
 */
class MirrorMismatch extends Friendly {
  constructor(github, gitee, detail) {
    super(
      `镜像落后或超前：GitHub 索引 ref 为 ${github ?? "（未取到）"}，Gitee 镜像索引 ref 为 ${gitee ?? "（无）"}${detail ? `（${detail}）` : ""}，联系维护者。本轮没动你本机任何东西。`,
      "两边 tag 没推齐（发布惯例是 GitHub 与 Gitee 都推）。等维护者补推后重跑；或先只用 GitHub：等限流过去再跑。"
    );
    this.mirrorMismatch = { github: github ?? null, gitee: gitee ?? null };
  }
}

const STEP_LABELS = { meta: "上游索引", names: "上游目录列表", install: "安装 clone" };

/**
 * 逐源尝试（design D1/D4）：`attempts = [{source, run}]`，主源失败且错误是 `retryable` 才碰下一个；
 * 404 / 格式不对这类不换源，原错直接抛。回退成功把「改用 Gitee 镜像」写进 notes；备源也失败就把
 * 两边原因合成一条抛——用户得知道是自己的网还是上游的事。MirrorMismatch 永远直接穿透。
 */
export async function withFallback(step, attempts, notes) {
  let primaryErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const { source, run } = attempts[i];
    try {
      const value = await run();
      if (primaryErr) notes.push(`${STEP_LABELS[step] || step}在 GitHub 失败（${primaryErr.message}），改用 Gitee 镜像。`);
      return { value, source };
    } catch (err) {
      if (err?.mirrorMismatch) throw err;
      if (primaryErr) throw new Friendly(`${primaryErr.message}；改用 Gitee 镜像也失败：${err?.message || err}`, primaryErr.hint);
      if (!err?.retryable || i === attempts.length - 1) throw err;
      primaryErr = err;
    }
  }
  throw primaryErr;
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

/**
 * 这个 scope 下 skill 会落到的两个安装目录。
 * `agent` 是 skills CLI 里对应的 agent 名——装和查必须同源，否则会往一个自己从来不查的
 * 目录里装（装了不查 = 永远查不出漂移，也永远归档不掉）。
 */
function installDirs(scope) {
  const base = scope.kind === "global" ? homedir() : scope.dir;
  return [
    { label: ".claude/skills", path: join(base, ".claude", "skills"), agent: "claude-code" },
    { label: ".agents/skills", path: join(base, ".agents", "skills"), agent: "universal" },
  ];
}

/**
 * 装给谁：只装本机**真的存在那个安装目录**的 agent。
 *
 * 🔴 绝不能用 `-a '*'`。`*` 不是「装了的全部」，是**注册表里全部 ~70 个 agent**
 *    （skills CLI: `options.agent.includes("*") → targetAgents = validAgents`）。其中 eve 的
 *    安装目录是 `<项目>/agent/skills` 且落的是**真实副本不是软链**，于是每对账一次，就在用户
 *    仓库根上刨出一个几 MB 的未跟踪 `agent/` 目录——我们既不查它也不清它，纯污染。
 *
 * 🔴 也别图省事把 `-a` 整个省掉。CLI 在「一个 agent 都没探测到 + `-y`」时会**回落到全部
 *    agent**（`installedAgents.length === 0 && options.yes → targetAgents = validAgents`），
 *    等于换个入口把同一个坑再踩一遍。必须显式给名单。
 *
 * 一个目录都不存在 = 本机还没装过：装进通用默认 `.agents/skills`（agent 名就叫 `universal`）。
 * 各 agent 自己的目录本就是软链指向它，所以回落到它不会漏装。
 */
function targetAgents(scope) {
  const present = installDirs(scope)
    .filter((d) => existsSync(d.path))
    .map((d) => d.agent);
  return present.length ? present : ["universal"];
}

/**
 * 旧版遗毒：`-a '*'` 会把包**真实复制**进 `<项目>/agent/skills`（那是 skills CLI 里 eve 的
 * 安装目录，而且它落的是真副本不是软链）。我们从来不查这个目录，所以它只会一直躺在用户仓库
 * 根上当未跟踪垃圾。现在装的那一侧已经收窄了，但存量得有人告诉用户。
 *
 * 🔴 只报不删。这是用户的磁盘，而且 `agent/` 也可能真是人家自己的目录（eve 用户就是这么用的）——
 *    所以只有「里面装的确实是我方包」才点名，判据同样是 slug × 内容哈希那把尺子。
 *    删不删由用户自己定，我们只给一条能直接粘贴的命令。
 */
function surveyStrayEveDir(scope, currentHashes, knownHashes) {
  // 只有项目 scope 有这个目录；global scope 下 eve 根本没有全局安装目录。
  if (scope.kind === "global" || !scope.dir) return null;
  const path = join(scope.dir, "agent", "skills");
  if (!existsSync(path)) return null;
  const ours = [];
  const others = [];
  for (const name of listSkillDirs(path)) {
    let hash;
    try {
      hash = computeSkillHash(join(path, name));
    } catch {
      continue; // 读不动就别猜，当作不是我们的
    }
    (classify(name, hash, currentHashes, knownHashes) === "foreign" ? others : ours).push(name);
  }
  if (!ours.length) return null;
  return { path, root: join(scope.dir, "agent"), ours, others };
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

/** 扫两个安装目录，给每个已装的包定三态。以磁盘为准，不依赖 skills CLI 的安装记录；有我们自己写的 origin 就带上。 */
function surveyScope(scope, currentHashes, knownHashes) {
  const seen = new Map();
  for (const dir of installDirs(scope)) {
    for (const name of listSkillDirs(dir.path)) {
      const pkgDir = join(dir.path, name);
      let hash;
      try {
        hash = computeSkillHash(pkgDir);
      } catch (err) {
        throw explainFsError(err, "读取已装 skill", pkgDir);
      }
      const origin = readOrigin(pkgDir);
      const state = classify(name, hash, currentHashes, knownHashes, origin);
      const prev = seen.get(name);
      // 同名出现在两个目录：任一处被动过手，就整体按「动过手」保守处理。
      if (!prev) seen.set(name, { name, hash, state, origin, dirs: [dir] });
      else {
        prev.dirs.push(dir);
        if (state === "modified") prev.state = "modified";
        if (!prev.origin && origin) prev.origin = origin;
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- origin / lock / pin

/**
 * 安装记录放在 skill 目录自己的点目录里：`<skill>/.dby/origin.json {slug, version, hash, ref, installedAt}`。
 * 点目录不参与内容哈希（hashedFiles 排除所有点开头的路径段，与上游 stamp 同一规则），所以写它不会
 * 把包变成"用户改过"。随目录走而不是集中放在 lock 里：lock 丢了整批变"来历不明"，origin 只会一个个丢。
 */
export function readOrigin(pkgDir) {
  try {
    const o = JSON.parse(readFileSync(join(pkgDir, ".dby", "origin.json"), "utf-8"));
    return o && typeof o.hash === "string" && o.hash ? o : null;
  } catch {
    return null;
  }
}

/** 装完 / 刷新完写 origin：哈希按**落地的真实内容**算（不抄索引——ref 与索引万一不一致，抄来的哈希会让下一跑把它误判成"用户改过"）。 */
export function writeOrigin(pkgDir, slug, upstream) {
  const hash = computeSkillHash(pkgDir);
  const version = versionOfHash(upstream, slug, hash);
  const dby = join(pkgDir, ".dby");
  ensureSelfIgnored(dby); // 用户把 skill 版本化进仓库时，这份记录不该冒出来当未跟踪文件
  const origin = { slug, version, hash, ref: upstream.ref ?? null, installedAt: new Date().toISOString() };
  writeFileSync(join(dby, "origin.json"), JSON.stringify(origin, null, 2) + "\n");
  return origin;
}

/**
 * 给「不是本对账器装的、但内容能在索引里对上某一版」的包补 origin。返回补了几个。
 * 只补 current / historical 且无 origin 的；每个落位目录各一份（宿主按目录读，origin 也随目录走）。
 */
export function backfillOrigins(scope, survey, upstream) {
  let n = 0;
  for (const s of survey) {
    if (s.origin || (s.state !== "current" && s.state !== "historical")) continue;
    if (!versionOfHash(upstream, s.name, s.hash)) continue;
    for (const dir of uniqueRealDirs((s.dirs || []).map((d) => join(d.path, s.name)))) {
      if (readOrigin(dir)) continue;
      writeOrigin(dir, s.name, upstream);
      n++;
    }
  }
  return n;
}

/** 索引里这个 slug、这个哈希对应的 semver；索引没这一版（或退回了旧文件）返回 null。 */
export function versionOfHash(upstream, slug, hash) {
  return (upstream?.versions?.[slug] || []).find((v) => v.hash === hash)?.version ?? null;
}

function scopeRoot(scope) {
  return scope.kind === "global" ? homedir() : scope.dir;
}

function lockPath(scope) {
  return join(scopeRoot(scope), ".dby", "lock.json");
}

/** scope 根的汇总 `.dby/lock.json {version:1, skills:{slug:{version,hash,installedAt,pinned?,pinReason?}}}`；读不到 / 格式不对当空表。 */
export function readLock(scope) {
  try {
    const lock = JSON.parse(readFileSync(lockPath(scope), "utf-8"));
    if (lock?.version === 1 && lock.skills && typeof lock.skills === "object") return lock;
  } catch {
    /* 没有就是没有 */
  }
  return { version: 1, skills: {} };
}

function writeLock(scope, lock) {
  const dir = dirname(lockPath(scope));
  ensureSelfIgnored(dir); // 项目 scope 下它落在用户仓库根，自忽略，不进 git status
  writeFileSync(lockPath(scope), JSON.stringify(lock, null, 2) + "\n");
}

const pinFields = (e) => (e?.pinned ? { pinned: true, ...(e.pinReason ? { pinReason: e.pinReason } : {}) } : {});

/**
 * 每跑重建 lock 的非 pin 字段：以磁盘（survey）为准，origin 有就抄 origin，没有就按目录哈希去索引里找版本号。
 * pin 字段只从上一份 lock 里**原样继承**——它是用户的意图，不是磁盘现状，对账器无权重算。
 * 已 pin 但此刻没装的包同样保留：pin 是"别动它"，不是"它必须在"。
 */
export function rebuildLock(prev, survey, upstream) {
  const skills = {};
  for (const s of survey) {
    if (s.state === "foreign") continue;
    skills[s.name] = {
      version: s.origin?.version ?? versionOfHash(upstream, s.name, s.hash),
      hash: s.hash,
      installedAt: s.origin?.installedAt ?? null,
      ...pinFields(prev?.skills?.[s.name]),
    };
  }
  for (const [slug, e] of Object.entries(prev?.skills || {})) {
    if (e?.pinned && !skills[slug]) skills[slug] = { version: e.version ?? null, hash: e.hash ?? null, installedAt: e.installedAt ?? null, ...pinFields(e) };
  }
  return { version: 1, skills: Object.fromEntries(Object.entries(skills).sort(([a], [b]) => a.localeCompare(b))) };
}

/**
 * `--pin` / `--unpin` 子命令：不联网，只改 lock。`--scope auto` 时按"这个包装在哪"选 scope——
 * 全局、项目都装了就两边都 pin（用户说的是"别动这个包"，不是"别动某一处的这个包"）。
 */
function runPinCommand(opts) {
  const slug = opts.pin || opts.unpin;
  // pin 只认真装了的包（显式 --scope 也一样）：固定一个不存在的包等于写一条永远不会生效的记录。
  const scopes = resolvePinScopes(opts, slug).filter(
    (s) => !opts.pin || installDirs(s).some((d) => existsSync(join(d.path, slug)))
  );
  if (!scopes.length) {
    throw new Friendly(`没在任何受管安装目录里找到 ${slug}，没法固定一个不存在的包。`, "先 --dry-run 看看它装在哪个 scope，或用 --scope / --project-dir 指定。");
  }
  const done = [];
  for (const scope of scopes) {
    const lock = readLock(scope);
    if (opts.pin) {
      const dir = installDirs(scope).map((d) => join(d.path, slug)).find((p) => existsSync(p));
      const hash = dir ? computeSkillHash(dir) : lock.skills[slug]?.hash ?? null;
      const origin = dir ? readOrigin(dir) : null;
      // ponytail: pin 不联网，没 origin 时 version 先记 null；下一次真跑重建 lock 会按哈希去索引里补上。
      //   升级路径：pin 时也拉一次索引——多一次网络请求换一个此刻用不上的字段，先不做。
      lock.skills[slug] = {
        version: origin?.version ?? lock.skills[slug]?.version ?? null,
        hash,
        installedAt: origin?.installedAt ?? lock.skills[slug]?.installedAt ?? null,
        pinned: true,
        ...(opts.reason ? { pinReason: opts.reason } : {}),
      };
    } else if (lock.skills[slug]) {
      const { pinned, pinReason, ...rest } = lock.skills[slug];
      lock.skills[slug] = rest;
    }
    writeLock(scope, lock);
    done.push({ scope: scope.label, lock: lockPath(scope) });
  }
  if (opts.json) console.log(JSON.stringify({ [opts.pin ? "pinned" : "unpinned"]: slug, reason: opts.reason || null, scopes: done }, null, 2));
  else {
    for (const d of done) {
      console.log(opts.pin ? `📌 已固定 ${slug}（${d.scope}）${opts.reason ? `：${opts.reason}` : ""}` : `已解除固定 ${slug}（${d.scope}）`);
      console.log(`   记在 ${d.lock}`);
    }
    if (opts.pin) console.log(`   之后每次对账都会跳过它（不刷新、不归档、不迁移），预检里单列一栏。想恢复：--unpin ${slug}`);
    else console.log(`   下次对账它会恢复正常刷新。`);
  }
  return 0;
}

function resolvePinScopes(opts, slug) {
  const global = { kind: "global", label: "全局（所有项目共用）" };
  const project = { kind: "project", dir: opts.dir, label: `项目（${opts.dir}）` };
  if (opts.scope === "global") return [global];
  if (opts.scope === "project") return [project];
  // auto：装在哪就 pin 哪；unpin 时 lock 里有它也算
  return [global, project].filter(
    (s) => installDirs(s).some((d) => existsSync(join(d.path, slug))) || (opts.unpin && readLock(s).skills[slug])
  );
}

// ---------------------------------------------------------------- 上游

/**
 * 🔴 只给 api.github.com 带令牌（Contents API 匿名配额 60 次/小时，公司出口 IP 一会儿就撞 403）；
 *    raw.githubusercontent.com 不需要，也少一处泄漏面。令牌只进请求头，**任何日志/报错/JSON 都不许出现它**：
 *    这里返回的对象只在 fetch 调用点展开，报错文案全部只拼 label 和 URL。
 */
export function githubAuthHeader(url, env = process.env) {
  if (!/^https:\/\/api\.github\.com\//.test(url)) return {};
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** `decode`（design D2）：Gitee contents 接口把文件包成 `{content: base64}`，这里解回 JSON；GitHub raw 不需要。 */
async function fetchJson(url, label, { decode = null } = {}) {
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
      headers: { "User-Agent": "dby-update-reconcile", Accept: "application/json", ...githubAuthHeader(url) },
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    throw retryable(explainNetError(err, label));
  }
  const host = /^https:\/\/gitee\.com\//.test(url) ? "Gitee" : "GitHub";
  if (res.status === 403 || res.status === 429) {
    throw retryable(new Friendly(`${label}被 ${host} 限流了（HTTP ${res.status}）。`, "等几分钟再跑。"));
  }
  if (!res.ok) throw new Friendly(`${label}失败：HTTP ${res.status}`);
  try {
    const body = await res.json();
    return decode ? decode(body) : body;
  } catch (err) {
    if (err instanceof Friendly) throw err;
    throw new Friendly(`${label}返回的不是合法 JSON。`);
  }
}

/**
 * 按 `path` 取一份上游 JSON 文件，GitHub 失败（可重试类）就换 Gitee 同名文件（main）。
 * 覆盖态（DBY_RAW_BASE）只有一个源。备源命中时把 `sources.meta` 记成 gitee。
 */
async function fetchUpstreamFile(up, path, label) {
  const attempts = [{ source: up.sources.meta === "override" ? "override" : "github", run: () => fetchJson(`${RAW}/${path}`, label) }];
  if (!up.rawOverridden) attempts.push({ source: "gitee", run: () => fetchJson(GITEE.file(path).url, `从 Gitee 镜像${label}`, GITEE.file(path)) });
  const r = await withFallback("meta", attempts, up.notes);
  if (r.source === "gitee") up.sources.meta = "gitee";
  return r.value;
}

/**
 * D3：取索引前不知道 ref，Gitee 先取 main；取到后按其 `ref` 再取同 tag 那份复核 `ref` 相同——
 * 镜像 main 领先 / 落后于 tag 时在这儿被拦住。`githubRef` 给了（GitHub 索引已取到、只是别的步骤要用镜像）
 * 就直接比主备 `ref`，不必再复核 tag（tag 内容由 git 保证一致）。每轮最多 2 次 Gitee 请求。
 */
async function fetchGiteeIndex(up, githubRef = null) {
  if (up.giteeIndex) return up.giteeIndex; // 同一跑里只取一次
  const main = await fetchJson(GITEE.file("index.json").url, "从 Gitee 镜像拉取上游索引", GITEE.file("index.json"));
  const ref = typeof main?.ref === "string" && main.ref.trim() ? main.ref.trim() : null;
  if (githubRef !== null && ref !== githubRef) {
    // 🔴 先分辨「真没推齐」和「GitHub main 的 raw 缓存还没刷新」（实证 2026-08-26：发布后一分钟内
    //    raw 仍吐上一版索引，而 Gitee 已是新版，硬判 mismatch 会把每次发布后的头几分钟都拦死）。
    //    ref 是 release-YYYYMMDD-HHMM，字符串序即时间序：镜像更新、且那个 tag 在 GitHub 上已存在
    //    （按 tag 取 raw 不走 main 的缓存）⇒ 只是滞后：本轮按 GitHub main 说的旧 ref 对账（那也是真发过的版），
    //    镜像目录不用，几分钟后重跑自然到新版。其余情形才是 mismatch。
    if (ref && ref > githubRef) {
      let atGithubTag = null;
      try {
        atGithubTag = await fetchJson(`https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(ref)}/index.json`, `复核 GitHub 上 tag ${ref} 的索引`);
      } catch {
        /* 取不到就按 mismatch 走 */
      }
      if (atGithubTag && typeof atGithubTag.ref === "string" && atGithubTag.ref.trim() === ref) {
        up.notes.push(`GitHub main 的索引缓存滞后（仍是 ${githubRef}，tag ${ref} 已在 GitHub 上）：本轮按 ${githubRef} 对账、镜像目录不用，几分钟后重跑即到 ${ref}。`);
        throw new Friendly(`GitHub main 的索引缓存滞后于镜像（${githubRef} < ${ref}）`, "几分钟后重跑。");
      }
    }
    throw new MirrorMismatch(githubRef, ref);
  }
  if (githubRef === null && ref) {
    const atTag = await fetchJson(GITEE.file("index.json", ref).url, `从 Gitee 镜像复核 ${ref} 的索引`, GITEE.file("index.json", ref));
    const tagRef = typeof atTag?.ref === "string" ? atTag.ref.trim() : null;
    if (tagRef !== ref) throw new MirrorMismatch(null, ref, `镜像 main 声明 ${ref}，而 tag ${ref} 上的索引写的是 ${tagRef ?? "空"}，镜像 main 领先或落后`);
  }
  up.giteeIndex = main;
  return main;
}

/**
 * 🔴 rename 表按「无 rename」退化，且**不中止**对账——这是 spec 里"表缺失或不可解析"那条
 * Scenario 的硬要求。不认识的 schema_version 同样退化：以后表结构真的要改版，老对账器
 * 撞见新 schema 也不该直接崩，而是当没有表继续跑。
 */
async function fetchRenames(up) {
  let table;
  try {
    table = await fetchUpstreamFile(up, "renames.json", "拉取改名表");
  } catch (err) {
    up.notes.push(`上游没有可用的改名表（${err.message}），按无改名处理`);
    return {};
  }
  if (!table || typeof table !== "object" || table.schema_version !== 1 || typeof table.renames !== "object" || table.renames === null) {
    up.notes.push("上游没有可用的改名表（格式不对或 schema_version 不认识），按无改名处理");
    return {};
  }
  return table.renames;
}

/**
 * `skills add` 的包参数：版本表声明了 `ref`（一个 release tag）就固定到它，
 * 否则退回默认分支（skills CLI 底层是 `git clone --branch <ref>`，只认 branch/tag）。
 * `source` 为 gitee 时给镜像的完整 git URL；镜像无 ref 返回 null（不回退，design D5）。
 */
export function installSource(ref, source = "github") {
  return (SOURCES.find((s) => s.id === source) || SOURCES[0]).install(ref);
}

/**
 * 上游四件套 + 两个元信息：当前全集名单、当前版哈希、历史闭集、改名表；
 * `namesSource` 说名单从哪来（`contents-api` / `versions` / `override`），`ref` 是版本表声明的安装 tag（可为 null）。
 * 名单以 GitHub 目录列表为准（`skills add` 装的就是这些目录），
 * 哈希以 versions.json 为准；目录列表拉不到时退回 versions.json 的键——但这时结论**不许**说
 * 「与上游目录完全一致」，因为目录压根没核到，所以 namesSource 得跟着名单一起带出去。
 *
 * `sources: {meta, names, install}` 各记 `github | gitee | override`：三处回退互相独立，`--json` 顶层原样带出。
 * `opts.rawOverridden` 只给自检注入用：默认取模块常量（由 DBY_RAW_BASE 决定）。
 */
async function fetchUpstream({ rawOverridden = RAW_OVERRIDDEN } = {}) {
  const notes = [];
  const one = rawOverridden ? "override" : "github";
  const up = { rawOverridden, notes, sources: { meta: one, names: one, install: one }, giteeIndex: null };
  // 🔴 索引优先，旧三文件兜底。两条路统一成同一个内部结构，后面的代码不再关心元信息从哪来：
  //    currentHashes / knownHashes / renames 与旧文件语义逐字段一致，status / versions 只有索引那条路有。
  const meta = (await fetchIndex(up)) || (await fetchLegacy(up));
  const { currentHashes, knownHashes, renames, status, versions, metaSource, displayName = {} } = meta;
  if (up.sources.meta === "gitee") notes.push(`仅镜像：GitHub 这一跑没取到上游元信息，本轮以 Gitee 镜像为准${meta.ref ? `（已复核镜像 main 与 tag ${meta.ref} 一致）` : ""}。`);

  // 安装源固定：缺字段按老版本表兼容处理（fail-open 到默认分支），但必须说出来。
  const ref = meta.ref;
  if (!ref) notes.push(`安装源未固定：${metaSource === "index" ? "索引" : "版本表"}没有 ref 字段，这次按默认分支 main 安装（装到的是 main 此刻的内容，不一定等于版本表那份快照）。`);

  // 索引模式下"仍在架"= status active；旧文件模式下版本表的键就是全部在架的。
  const activeNames = sanitizeSlugs(
    status ? Object.keys(status).filter((n) => !GONE_STATUSES.has(status[n])).sort() : Object.keys(currentHashes).sort(),
    notes
  ).safe;
  let names = null;
  let namesSource = status ? "index" : "versions";
  let archiveSuppressed = false;
  if (rawOverridden) {
    namesSource = "override";
    notes.push(`用的是 DBY_RAW_BASE 指定的上游（${RAW}），名单以${status ? "索引" : "版本表"}为准。`);
  } else {
    try {
      const { value: items, source } = await withFallback(
        "names",
        [
          { source: "github", run: () => fetchJson(CONTENTS_API, "拉取上游 skill 目录") },
          {
            source: "gitee",
            run: async () => {
              // 镜像 main 的目录只在「镜像 main 与 GitHub 同一 ref」时才顶得上 GitHub main 的目录：
              // 先核 Gitee 索引 ref（元信息已经取自镜像的话，这一步早在 fetchIndex 里核过了）。
              if (up.sources.meta !== "gitee" && metaSource === "index") await fetchGiteeIndex(up, ref ?? null);
              return fetchJson(GITEE.listDir().url, "从 Gitee 镜像拉取上游 skill 目录");
            },
          },
        ],
        notes
      );
      if (Array.isArray(items)) {
        names = items.filter((x) => x.type === "dir").map((x) => x.name).sort();
        namesSource = "contents-api";
        up.sources.names = source;
      }
    } catch (err) {
      if (err?.mirrorMismatch) throw err;
      if (status) {
        // 🔴 fail-closed 只压归档不压刷新：刷新 / 新增的依据是索引本身，目录列表只是"缺席推断"的证据。
        archiveSuppressed = true;
        notes.push(`目录列表拉不到（${err.message}），名单改用索引——上游目录这一跑没核到，本轮不做任何归档，刷新与新增照常。`);
      } else {
        notes.push(`目录列表拉不到（${err.message}），改用版本表的名单——上游目录这一跑没核到，结论会照实标注。`);
      }
    }
  }
  if (!names) names = activeNames;
  else {
    // 目录列表来自网络，先过形状闸再参与后续任何路径拼接
    names = sanitizeSlugs(names, notes).safe;
    if (status) {
      // 索引说已下架 / 改名，目录却还在（删目录晚于发索引）：归档以索引为准，不能又把它当"新增"装回来。
      names = names.filter((n) => !GONE_STATUSES.has(status[n]));
      const missing = activeNames.filter((n) => !names.includes(n));
      if (missing.length) notes.push(`索引与目录不一致：${missing.join(", ")} 在索引里是 active，上游目录里却没有——不归档、不刷新，联系维护者。`);
    }
    const unstamped = names.filter((n) => !currentHashes[n]);
    if (unstamped.length) notes.push(`上游有 ${unstamped.length} 个包还没盖版本戳（${unstamped.join(", ")}），它们只会被装上、不参与新旧判定。`);
  }
  if (!names.length) throw new Friendly("上游清单是空的，这不正常，先不动你本机的任何东西。");
  return { names, namesSource, archiveSuppressed, metaSource, ref, currentHashes, knownHashes, renames, status, versions, displayName, notes, sources: up.sources };
}

/**
 * 读 `index.json`：slug 为键，每条 `status / knownHashes / versions[]（versions[0] 是当前版）/ redirectTo / userFiles`。
 * 拉不到或格式不认识返回 null（由调用方退回旧文件），**不中止**——过渡期上游可能还没发索引。
 * GitHub 403/429/网络错时换 Gitee（先 main、再按 ref 复核，见 fetchGiteeIndex）；404 不换源。
 */
async function fetchIndex(up) {
  const notes = up.notes;
  let index;
  try {
    const attempts = [{ source: up.sources.meta === "override" ? "override" : "github", run: () => fetchJson(INDEX_URL, "拉取上游索引") }];
    if (!up.rawOverridden) attempts.push({ source: "gitee", run: () => fetchGiteeIndex(up) });
    const r = await withFallback("meta", attempts, notes);
    index = r.value;
    if (r.source === "gitee") up.sources.meta = "gitee";
  } catch (err) {
    if (err?.mirrorMismatch) throw err;
    notes.push(`上游索引拉不到（${err.message}），退回旧版三文件对账（metaSource: legacy）——这次看不到版本号与变更说明。`);
    return null;
  }
  if (!index || typeof index !== "object" || index.schemaVersion !== 1 || !index.skills || typeof index.skills !== "object") {
    notes.push("上游索引格式不对或 schemaVersion 不认识，退回旧版三文件对账（metaSource: legacy）。");
    return null;
  }

  const currentHashes = {};
  const knownHashes = {};
  const renames = {};
  const status = {};
  const versions = {};
  const displayName = {};
  for (const [slug, entry] of Object.entries(index.skills)) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.displayName === "string" && entry.displayName && entry.displayName !== slug) displayName[slug] = entry.displayName;
    status[slug] = typeof entry.status === "string" ? entry.status : "active";
    knownHashes[slug] = Array.isArray(entry.knownHashes) ? entry.knownHashes.map(String) : [];
    versions[slug] = Array.isArray(entry.versions) ? entry.versions.filter((v) => v && typeof v.hash === "string") : [];
    const cur = versions[slug][0];
    // 闭集必须含当前版：索引生成侧本就保证，这里再兜一手，别让"当前版"落在闭集外变成 modified。
    if (cur && !knownHashes[slug].includes(cur.hash)) knownHashes[slug].push(cur.hash);
    if (!GONE_STATUSES.has(status[slug]) && cur) currentHashes[slug] = cur.hash;
    if ((status[slug] === "renamed" || status[slug] === "merged") && typeof entry.redirectTo === "string") {
      renames[slug] = { to: entry.redirectTo, userFiles: Array.isArray(entry.userFiles) ? entry.userFiles : [] };
    }
  }
  const ref = typeof index.ref === "string" && index.ref.trim() ? index.ref.trim() : null;
  return { currentHashes, knownHashes, renames, status, versions, displayName, ref, metaSource: "index" };
}

/** 过渡期兜底：`versions.json` + `known-hashes.json` + `renames.json`，语义与索引出现之前完全一样。 */
async function fetchLegacy(up) {
  const versionsFile = await fetchUpstreamFile(up, "versions.json", "拉取上游版本表");
  const known = await fetchUpstreamFile(up, "known-hashes.json", "拉取历史版本闭集");
  if (!versionsFile?.skills || !known?.skills) throw new Friendly("上游版本表格式不对，先不动你本机的任何东西。");
  const renames = await fetchRenames(up);
  const currentHashes = Object.fromEntries(
    Object.entries(versionsFile.skills).map(([k, v]) => [k, String(v).split("@").pop()])
  );
  const ref = typeof versionsFile.ref === "string" && versionsFile.ref.trim() ? versionsFile.ref.trim() : null;
  return { currentHashes, knownHashes: known.skills, renames, status: null, versions: null, ref, metaSource: "legacy" };
}

/**
 * 「无需任何操作」那句结论，按名单来源分四种说法：结论不许高于证据——
 * 目录列表没核到就不能说「与上游当前全集完全一致」。
 */
export function convergedConclusion(namesSource, sources = null) {
  // 元信息取自镜像时结论跟着标「仅镜像」：证据来自备源，不能装成主源核过的。
  const suffix = sources?.meta === "gitee" ? "（仅镜像：本轮上游元信息取自 Gitee 镜像）" : "";
  if (namesSource === "contents-api") return `结论：无需任何操作——本机已经和上游当前全集完全一致。${suffix}`;
  if (namesSource === "override") return "结论：无需任何操作——按 DBY_RAW_BASE 指定上游的名单对账一致。";
  if (namesSource === "index") return `结论：无需任何操作——按索引对账，上游目录未能核对，本轮不归档。${suffix}`;
  return `结论：无需任何操作——按版本表名单对账一致，上游目录未能核对（目录列表没拉到，上游若有还没盖版本戳的新包会漏掉）。${suffix}`;
}

/**
 * 预检刷新栏每一行要说的：`slug  旧 semver → 新 semver` + 目标版的 changelog。
 * 旧版本：本机 origin 记的；没 origin 就拿目录哈希去索引 `versions[]` 里找；找不到 `?`。
 * 退回旧文件时索引不在场：新版本 `?`、changelog「（无变更说明）」。纯函数，好自检。
 */
/** 刷新一行的打印：`↻ slug 旧 → 新  changelog`，隔了多版时把中间每一版缩进列在下面（最多 8 版，再多折叠）。 */
function printRefreshLine(d, pad = "        ") {
  const autoTag = (src) => (src === "auto" ? "［auto：作者未写，占位文案］" : "");
  console.log(`${pad}↻ ${d.slug}${d.displayName ? `（${d.displayName}）` : ""}  ${d.from} → ${d.to}  ${d.changelog}${autoTag(d.changelogSource)}`);
  const between = d.between || [];
  for (const v of between.slice(0, 8)) console.log(`${pad}     · ${v.version}  ${v.changelog}${autoTag(v.changelogSource)}`);
  if (between.length > 8) console.log(`${pad}     · …还有 ${between.length - 8} 版（--json 里全有）`);
}

export function describeRefresh(names, survey, upstream) {
  return names.map((slug) => {
    const entry = survey.find((s) => s.name === slug);
    const list = upstream.versions?.[slug] || [];
    const cur = list[0] || null;
    const from = entry?.origin?.version || versionOfHash(upstream, slug, entry?.hash) || "?";
    // 🔴 隔了好几版才更新的用户，只看最新一版的 changelog 会漏掉中间每一版改了什么：
    //    把「本机这版之后、当前版之前」的每一版都带出来（新→旧），本机这版在索引里找不到就只给当前版。
    let at = entry?.hash ? list.findIndex((v) => v.hash === entry.hash) : -1;
    if (at < 0 && entry?.origin?.version) at = list.findIndex((v) => v.version === entry.origin.version);
    const between = at > 1 ? list.slice(1, at).map((v) => ({ version: v.version, changelog: v.changelog || "（无变更说明）", changelogSource: v.changelogSource || null })) : [];
    const dn = upstream.displayName?.[slug];
    return {
      slug,
      ...(dn ? { displayName: dn } : {}),
      from,
      to: cur?.version || "?",
      changelog: cur?.changelog || "（无变更说明）",
      changelogSource: cur ? cur.changelogSource || null : null,
      between,
    };
  });
}

// ---------------------------------------------------------------- 归档

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function doubaoyaHome(scope) {
  return join(scope.kind === "global" ? homedir() : scope.dir, ".doubaoya");
}

/**
 * 归档根按秒级时间戳命名。同一跑里 archivePackages 会被叫好几次（下架归档、改名归档、遗留副本归档），
 * 同一秒内落到同一个根就会互相覆盖 manifest.json——复原命令只剩最后一份。撞上就加序号。
 */
function archiveRoot(scope) {
  const base = join(doubaoyaHome(scope), "archive", timestamp());
  let root = base;
  for (let i = 2; existsSync(root); i++) root = `${base}-${i}`;
  return root;
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
/**
 * 打给用户复制粘贴的复原命令。归档之后这是**唯一**的退路，所以两件事都不能省：
 *
 * 🔴 路径走 `process.argv` 传参，绝不拼进命令字符串。安装目录路径是用户的
 *    （目录名里带个单引号完全合法），拼进带引号的 `node -e "..."` 里当场破——
 *    而破掉的复原命令比没有复原命令更糟：用户以为有退路，真要捞的时候才发现没有。
 *    自检里 `sh -c` 会真跑一遍它，见 selfTest 的「复原命令必须真的能复原」。
 * 🔴 脚本体里不出现任何来自外部的字符串，只有固定代码 + argv[1]。
 */
const RESTORE_SNIPPET =
  "const p=require('path'),f=require('fs');" +
  "for(const it of require(process.argv[1]).packages){" +
  "f.mkdirSync(p.dirname(it.from),{recursive:true});f.renameSync(it.to,it.from)}";

/** shell 可粘贴形态：单引号包裹路径，路径里的单引号按 POSIX 规矩转义（'\''）。 */
function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

function restoreCommand(root) {
  return `node -e ${shellQuote(RESTORE_SNIPPET)} ${shellQuote(join(root, "manifest.json"))}`;
}

/**
 * 把包移进归档目录。**绝不 rm**——用户机器我们看不见，删错了得能捞回来。
 * 按来源目录分层存放，并写一份 manifest 说明每个包原来在哪、怎么放回去。
 *
 * `opts.reason` 覆盖 manifest 顶层的默认归档理由（改名迁移用它写"上游改名为 X，本地数据
 * 已搬运"，而不是泛泛的"上游已下架"）；`opts.perPackage[name]` 给单条 package 记录附加字段
 * （改名迁移用它挂 `migratedFiles` / `conflicts`），不影响普通下架归档的既有行为（不传就是
 * 原来那样）。
 */
function archivePackages(scope, names, survey, opts = {}) {
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
        moveDir(from, to);
        moved.push({ skill: name, from, to, hash: entry?.hash, ...(opts.perPackage?.[name] || {}) });
      } catch (err) {
        throw explainFsError(err, "归档 skill", from);
      }
    }
  }
  const manifest = {
    archivedAt: new Date().toISOString(),
    reason: opts.reason || "上游已下架，由 dby-update 对账归档；内容哈希命中我们发布过的历史版本",
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

/** 一次目录搬运：先 rename，跨设备（EXDEV）退回「先拷再删」。归档与复原共用，两边对称。 */
function moveDir(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/**
 * 按 manifest 把一个归档根里的包**逆向**搬回原处——`skills add` 挂掉时用它把本轮刚归档的目录复原，
 * 让磁盘回到跑之前的样子（skills CLI 的安装记录不归它管，重跑补齐）。
 * 已经不在归档里的条目（用户手动搬回过）跳过；原处已被占（同名目录又出现了）时不覆盖、记进 skipped，
 * 这种情形宁可留在归档里让用户自己看，也不能拿归档物盖掉一个现在在场的目录。
 */
export function restoreArchive(root) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf-8"));
  const restored = [];
  const skipped = [];
  for (const it of manifest.packages || []) {
    if (!existsSync(it.to)) continue;
    if (existsSync(it.from)) {
      skipped.push({ skill: it.skill, from: it.from, to: it.to, reason: "原处已有同名目录，不覆盖" });
      continue;
    }
    moveDir(it.to, it.from);
    restored.push(it.skill);
  }
  return { root, restored, skipped };
}

// ---------------------------------------------------------------- 改名迁移

/**
 * 一批候选路径里，去掉不存在的、按真实路径去重（`.claude/skills/<name>` 常常是软链指向
 * `.agents/skills/<name>`，两条路径不去重会对同一份真实目录搬两遍——第二遍会把第一遍刚
 * 搬过去的文件误判成"新目录已有同名文件"）。
 */
function uniqueRealDirs(paths) {
  const seen = new Map();
  for (const p of paths) {
    if (!existsSync(p)) continue;
    let key;
    try {
      key = realpathSync(p);
    } catch {
      key = p;
    }
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/** 目录下所有文件的相对路径（不排除点文件——用户数据里没有理由排除，与 hashedFiles 不同用途）。 */
function walkRelativeFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel) || dir)) {
      if (entry === "__pycache__") continue;
      const r = rel ? join(rel, entry) : entry;
      let st;
      try {
        st = statSync(join(dir, r));
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push(r);
    }
  };
  walk("");
  return out;
}

/**
 * 搬一个文件。`silentConflict` 区分两种"新目录已有同名文件"：
 *   - userFiles 里**直接点名的文件**（如 `config.json`）：新目录已有 = 记进 conflicts 提示
 *     （spec 的"新包已有同名文件"场景），因为这不该发生——上游包不该自带一个和用户配置同名
 *     的文件，出现了值得让用户知道。
 *   - userFiles 里**目录展开出来的文件**（如 `themes/benya-clean.json`）：新目录已有 = 静默
 *     跳过、不提示，这是**预期内**的常态——上游包本来就会带一批默认主题/资源文件，D4 的判据
 *     正是"老目录有、上游新包没有的文件才搬"，把每一个默认文件都报成"冲突"是纯噪音。
 */
function transferOne(from, to, rel, result, { execute, silentConflict }) {
  if (existsSync(to)) {
    if (!silentConflict) result.conflicts.push({ rel, keptAt: to });
    return;
  }
  if (!execute) {
    result.migrated.push(rel);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  // 🔴 校验逐字节相同：读回比对，不信任 cpSync 静默成功。
  if (!readFileSync(from).equals(readFileSync(to))) {
    throw new Error(`复制后内容不一致：${rel}`);
  }
  result.migrated.push(rel);
}

/**
 * 算一条改名迁移会搬哪些文件 / 冲突哪些（`execute: false`），或者真的去搬（`execute: true`，
 * 默认）。**两种模式走同一套判定代码**——这是刻意的：`--dry-run` 打印的"将搬运的文件清单"
 * 必须和真跑时完全一致，判定逻辑只写一份，不许有第二条"预测口径"跟真实执行口径慢慢漂开。
 *
 * `rename.userFiles` 里每一项先去掉末尾的 `/`（renames.json 里目录形态自带一个），再看它在
 * 老目录里是文件还是目录：文件直接比对，目录递归展开成文件列表逐个搬。
 */
function planRenameMigration(scope, survey, rename, { execute = true } = {}) {
  const entry = survey.find((s) => s.name === rename.from);
  const sourceDirs = uniqueRealDirs((entry?.dirs || []).map((d) => join(d.path, rename.from)));
  const targetDirs = uniqueRealDirs(installDirs(scope).map((d) => join(d.path, rename.to)));
  const result = { from: rename.from, to: rename.to, migrated: [], conflicts: [], ok: true };
  if (!sourceDirs.length) {
    // 幂等的另一半：老目录已经不在了（多半是上一跑已经搬完归档掉了），无事可做，不是失败。
    result.skipped = "老目录已经不在了（可能上一跑已经搬完）";
    return result;
  }
  const source = sourceDirs[0];
  let target;
  if (targetDirs.length) {
    target = targetDirs[0];
  } else if (!execute) {
    // 🔴 dry-run 预览：这会儿新包多半还没装（真跑时执行顺序是先 `skills add` 再搬），这不算
    //    错误。用它"将来会落在哪"的路径继续走同一套判定——`existsSync` 对不存在的路径天然
    //    返回 false，算出来的自然是"源目录这些都还没被占，会搬"；代价是没法预先排除"上游新包
    //    自带、恰好同名"的文件，如实在 pending 里说清楚，不假装算得准。
    target = join(installDirs(scope)[0].path, rename.to);
    result.pending = "新包这会儿还没落地（真跑时会先装好新包再搬）；这份清单没法排除上游新包自带、恰好同名的文件";
  } else {
    result.ok = false;
    result.error = `新包 ${rename.to} 还没落地，没法搬运用户数据`;
    result.manualCmd = `cp -R ${JSON.stringify(sourceDirs[0])} <新安装目录>/${rename.to}`;
    return result;
  }
  result.sourceDir = source;
  result.targetDir = target;
  try {
    for (const raw of rename.userFiles || []) {
      const rel = raw.replace(/\/+$/, "");
      if (!rel) continue;
      const from = join(source, rel);
      if (!existsSync(from)) continue; // 老目录里没有这一项，跳过，不是错误
      if (statSync(from).isDirectory()) {
        for (const file of walkRelativeFiles(from)) {
          const relFile = join(rel, file);
          transferOne(join(source, relFile), join(target, relFile), relFile, result, { execute, silentConflict: true });
        }
      } else {
        transferOne(from, join(target, rel), rel, result, { execute, silentConflict: false });
      }
    }
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Friendly ? err.message : explainFsError(err, "搬运改名用户数据", source).message;
    result.manualCmd = `cp -R ${JSON.stringify(source)} ${JSON.stringify(target)}`;
  }
  return result;
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
    // 退出码非 0 归「网络 / clone」一类（skills CLI 每装一次都 clone 整仓）：这类才允许换镜像重试；npx 不在则不算。
    throw retryable(
      new Friendly(
        `\`skills ${args[0]}\` 没跑成功（退出码 ${res.status}）。`,
        "常见原因就两个：安装目录没写权限，或者中途断网。上面的日志会写明是哪个。"
      )
    );
  }
}

/**
 * `skills add`：GitHub 失败且有 ref 时用 Gitee 镜像 URL 加同一 ref 重试一次（spec「安装 clone 回退到镜像」）；
 * 无 ref / 覆盖态只试 GitHub。回退成功把 `sources.install` 记成 gitee。
 */
async function installWithFallback(upstream, want, scopeFlag, agentsToo, cwd) {
  const args = (pkg) => ["add", pkg, ...scopeFlag, "-s", ...want, "-a", ...agentsToo, "-y"];
  const attempts = [{ source: upstream.sources.install, run: async () => runSkills(args(installSource(upstream.ref, "github")), cwd) }];
  const mirror = upstream.sources.install === "override" ? null : installSource(upstream.ref, "gitee");
  if (mirror) {
    attempts.push({
      source: "gitee",
      run: async () => {
        say(`   GitHub clone 失败，改用 Gitee 镜像重试：${mirror}`);
        runSkills(args(mirror), cwd);
      },
    });
  }
  const { source } = await withFallback("install", attempts, upstream.notes);
  if (source === "gitee") upstream.sources.install = "gitee";
}

/**
 * 🔴 拉取挂了之后的提示语：归档已经落盘、`skills add` 却挂了（实测最常撞上的是 github clone 抖动，
 * skills CLI 每装一次都要 clone 整仓）。这时对账器已经**自动把本轮归档的目录按 manifest 搬回原处**，
 * 磁盘回到跑之前的样子；只有 skills CLI 自己的安装记录（`skills remove` 已经跑过）还没补回来。
 *
 * 只说一句「没跑完，常见原因是断网」等于把用户丢在半路：他不知道自己机器现在是什么状态，
 * 更不敢重跑。所以这句必须说清三件事：**复原了几个、磁盘现在什么状态、重跑同一条命令即可补齐**。
 *
 * 复原本身也可能挂（磁盘满、权限……）：那部分归档根照实列出来，附上可粘贴的复原命令，**原始拉取错误不吞**。
 * `installRef` 非空时多说一句：版本表固定到的 tag 可能不存在（发布者忘打 tag），这不是用户的网络问题。
 */
export function partialMigrationHint({ restoredCount = 0, restoredRoots = [], failed = [], wantCount = 0, installRef = null, mirrorTried = false } = {}) {
  const lines = [];
  if (restoredCount) {
    lines.push(`本轮刚归档的 ${restoredCount} 个已自动复原回原处（归档根 ${restoredRoots.join("、")} 可以删了），要拉的 ${wantCount} 个一个都没落。`);
  } else if (!failed.length) {
    lines.push(`本轮没归档任何东西，要拉的 ${wantCount} 个一个都没落，你的磁盘和跑之前一样。`);
  }
  for (const f of failed) {
    lines.push(`⚠️ 有一份归档没能自动复原（${f.error}），原样躺在 ${f.root}，手动复原照抄这条：`);
    lines.push(`   ${restoreCommand(f.root)}`);
  }
  lines.push("直接重跑同一条命令即可：对账每一跑都以磁盘现状重算；skills CLI 的安装记录已经清掉，重跑会一并补齐。");
  if (installRef) {
    lines.push(`这次是固定到版本表声明的 ref「${installRef}」安装的；要是日志里是 clone 报 "Remote branch ... not found"，是这个 tag 不存在，联系维护者补打 tag，不是你的网络问题。`);
    if (mirrorTried) lines.push("GitHub 与 Gitee 镜像两边都试过了，多半不是单个站点抽风：检查本机网络，或等一会儿再跑。");
  } else {
    lines.push("要是反复卡在这一步，多半是 git clone 那条路不通（skills CLI 每装一次都要 clone 整仓），换个网络再试。");
  }
  return lines.join("\n   ");
}

// ---------------------------------------------------------------- 自检

/**
 * 「该在的都在吗」——🔴 **逐目录核，不是并集核**。
 *
 * 旧写法是 `new Set(dirs.flatMap(listSkillDirs))`：两个安装目录并成一个集合再判缺失，
 * 那是「或」——任一目录里有就算就位。可宿主是按**自己那个目录**读 skill 的
 * （Claude Code 只读 `.claude/skills`），包只落进 `.agents/skills` 时它对宿主根本不存在。
 * 于是自检打印「都能在安装目录里找到 / 全部通过」，而用户那台机器上那个包压根用不了。
 * 实测踩过：`dby-banned-words`（历史名字已改名）只在 `.agents/skills`，整场会话 Claude Code 都看不见它。
 *
 * 受管目录 = 本机**真实存在**的那些（与 targetAgents 同源）：只有一个目录的机器不该被误报成缺。
 * 一个都不存在 = 还没装过，核通用默认那一个，让它如实报缺，而不是空转成绿。
 */
export function checkPlacement(scope, wantNames) {
  const dirs = installDirs(scope);
  const live = dirs.filter((d) => existsSync(d.path));
  const managed = live.length ? live : dirs.filter((d) => d.agent === "universal");
  const bad = managed
    .map((d) => {
      const present = new Set(listSkillDirs(d.path));
      return { dir: d, missing: wantNames.filter((n) => !present.has(n)) };
    })
    .filter((x) => x.missing.length);
  if (!bad.length) {
    return {
      name: "skill 已就位",
      ok: true,
      detail: `${wantNames.length} 个 skill 在 ${managed.length} 个安装目录里逐个目录都在场（${managed.map((d) => d.label).join("、")}）。`,
    };
  }
  return {
    name: "skill 已就位",
    ok: false,
    detail: bad
      .map((x) => `${x.dir.label} 缺 ${x.missing.length} 个：${x.missing.slice(0, 8).join(", ")}${x.missing.length > 8 ? " …" : ""}`)
      .join("；"),
    hint:
      `宿主是按自己那个目录读 skill 的（Claude Code 只读 .claude/skills），少一处就等于那台机器上没有。` +
      `先确认这些目录写得进去：${bad.map((x) => x.dir.path).join("  ")}；再重跑一次对账，它会把缺落位的包补齐。`,
  };
}

async function selfTest(scope, wantNames) {
  const checks = [];

  checks.push(checkPlacement(scope, wantNames));

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
    else if (a === "--pin") o.pin = argv[++i];
    else if (a === "--unpin") o.unpin = argv[++i];
    else if (a === "--reason") o.reason = argv[++i];
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Friendly(`不认识的参数：${a}`, "跑 --help 看用法。");
  }
  if (!["auto", "global", "project"].includes(o.scope)) {
    throw new Friendly(`--scope 只能是 auto / global / project，你给的是 ${o.scope}`);
  }
  if (o.pin && o.unpin) throw new Friendly("--pin 和 --unpin 一次只能用一个。");
  for (const k of ["pin", "unpin"]) {
    if (k in o && (!o[k] || o[k].startsWith("--"))) throw new Friendly(`--${k} 后面要跟包名（slug）。`);
  }
  if (o.reason !== undefined && !o.pin) throw new Friendly("--reason 只跟 --pin 一起用。");
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

/**
 * 存量污染点名。故意不并进 printPlan 的几栏：它说的不是「上游变了」，是「上一版给你留了什么」。
 * 🔴 不打任何删除命令：我方那几份副本走**归档**（执行模式下移进归档目录、写 manifest，可复原），
 *    不是我们的东西原地不动。dry-run 只报告。
 */
function printStray(stray, opts = {}) {
  if (!stray) return;
  console.log(
    `\n   🧹 发现旧版留下的重复副本：${stray.path}\n` +
      `      里面有 ${stray.ours.length} 个包是我方发的、且和上面那套是**同一批东西的另一份真实副本**` +
      `（${stray.ours.join(", ")}）。\n` +
      `      来历：旧版对账用了 \`-a '*'\`，把包装进了 skills CLI 注册表里**每一个** agent，\n` +
      `      其中 eve 的目录就是 \`agent/skills\` 且落真副本。我们从不读它，它也不会自己更新，现在的版本已经不会再往这儿装了。\n` +
      (opts.dryRun
        ? `      执行时会把这 ${stray.ours.length} 个移进归档目录（不删，可复原）；这次是 --dry-run，磁盘不动。`
        : `      执行时会把这 ${stray.ours.length} 个移进归档目录（不删，可复原），跑完会打印归档位置和复原命令。`)
  );
  if (stray.others.length) {
    console.log(
      `      ⚠️ 这个目录里还有 ${stray.others.length} 个**不是我们的**东西（${stray.others.join(", ")}），原地不动，不归档。`
    );
  }
}

/** 遗留副本归档：借 archivePackages 的壳——造一条假 survey 条目指向 agent/skills，manifest / 复原命令同一套。 */
function archiveStray(scope, stray) {
  const dirs = [{ label: "agent/skills", path: stray.path, agent: "eve" }];
  const survey = stray.ours.map((name) => ({ name, dirs }));
  return archivePackages(scope, stray.ours, survey, {
    reason: "旧版对账 `-a '*'` 遗留在 agent/skills 的重复副本，由 dby-update 归档；正式那份仍在受管安装目录里",
  });
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
  // 🔴 fail-closed 那一栏：索引说该归档，可上游目录没核到——本轮一个都不归档，但要让用户知道它们在等。
  if (plan.archiveHeld?.length) {
    console.log(`   ⏸  有 ${plan.archiveHeld.length} 个索引已标下架 / 改名，但这一跑上游目录没核到，本轮不归档（目录能拉到时再归档）：`);
    for (const n of plan.archiveHeld) console.log(`        · ${n}`);
  }
  if (plan.inconsistent?.length) {
    console.log(`   ⚠️ 有 ${plan.inconsistent.length} 个索引标 active、上游目录里却没有（索引与目录不一致，联系维护者），不归档也不刷新：${plan.inconsistent.join(", ")}`);
  }
  if (plan.pinned?.length) {
    console.log(`   📌 已固定、不动 ${plan.pinned.length} 个（你用 --pin 固定的；不刷新、不归档、不迁移，--unpin 解除）：`);
    for (const p of plan.pinned) console.log(`        = ${p.name}${p.reason ? `（${p.reason}）` : ""}`);
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
  // 🔴 改名迁移单独一栏：结论不是「归档」也不是「新增」，是「装新包 → 搬本地数据 → 老目录归档」
  //    这条三步链，混进上面任一栏都会被当成别的动作看待。
  if (plan.renamed?.length) {
    console.log(`   🔀 改名迁移 ${plan.renamed.length} 个（上游把它们改名了；先装新包，把本地数据搬过去，老目录再归档）：`);
    for (const r of plan.renamed) {
      console.log(`        ${r.from} → ${r.to}`);
      const p = r.preview;
      if (p?.migrated?.length) console.log(`           会搬：${p.migrated.join(", ")}`);
      if (p?.conflicts?.length) console.log(`           冲突（新目录已有同名文件，不覆盖）：${p.conflicts.map((c) => c.rel).join(", ")}`);
      if (p && !p.ok) console.log(`           ⚠️ ${p.error}（这一条会保留老目录不动，需要手工处理）`);
    }
  }
  if (plan.renamedSkipped?.length) {
    console.log(
      `   🔒 另有 ${plan.renamedSkipped.length} 个老目录上游已改名，但受 git 跟踪或判不出来，跳过不动：`
    );
    for (const r of plan.renamedSkipped) {
      console.log(`        ${r.from} → ${r.to}（${r.reason === "tracked" ? "受跟踪，是你自己版本化的包" : "git 判不出来"}）`);
    }
  }
  if (plan.add.length) {
    console.log(`   ✨ 要新增 ${plan.add.length} 个：`);
    for (const n of plan.add) console.log(`        + ${n}`);
  }
  if (plan.refresh.length) {
    console.log(
      opts.forceRefresh
        ? `   ♻️  要刷新 ${plan.refresh.length} 个（--force-refresh：不分新旧，全部重下一遍）`
        : `   ♻️  要刷新 ${plan.refresh.length} 个（本机这份落后于上游当前版，或者少了一处落位）：`
    );
    // 🔴 逐项列名 + 版本号 + 变更说明：刷新是覆盖安装，用户确认的必须是「哪个包、从哪版到哪版、改了什么」。
    //    `auto` 是盖戳工具替没写说明的作者生成的占位文案，要标出来，别让用户以为那是作者说的。
    const info = new Map((plan.refreshInfo || []).map((r) => [r.slug, r]));
    for (const n of plan.refresh) {
      const r = info.get(n);
      if (!r) console.log(`        ↻ ${n}`);
      else printRefreshLine(r);
    }
  }
  // 🔴 单说一句「缺落位」，否则用户看到「内容明明是最新的还要重下」只会以为工具在空转。
  if (plan.misplaced?.length) {
    console.log(
      `   🩹 其中 ${plan.misplaced.length} 个内容其实已经是当前版，但**没在每个安装目录里都落位**` +
        `（典型是只落进了 .agents/skills，而 Claude Code 只读 .claude/skills，看不见它），重装一遍补齐：`
    );
    for (const n of plan.misplaced) console.log(`        ⤷ ${n}`);
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

  // pin / unpin 不联网、不对账，只改 lock。
  if (opts.pin || opts.unpin) return runPinCommand(opts);

  const upstream = await fetchUpstream();
  for (const n of upstream.notes) say(`提示：${n}`);
  const scopes = resolveScopes(opts, upstream.knownHashes);

  // ---- 先把清单摊开给人看，一个字都还没改
  const report = [];
  for (const scope of scopes) {
    const fullSurvey = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    // 🔴 pin 过的先摘出去：它们不进任何单子，也不能因为"不在 survey 里"被当成缺失重装。
    const lock = readLock(scope);
    const { survey, names: upstreamNames, pinned } = splitPinned(fullSurvey, upstream.names, lock);
    // expectedAgents 与执行时的 targetAgents 同一批：判「缺不缺落位」的尺子，必须就是装的那把尺子。
    const draft = planReconcile(survey, upstreamNames, {
      forceRefresh: opts.forceRefresh,
      expectedAgents: targetAgents(scope),
      status: upstream.status,
      archiveSuppressed: upstream.archiveSuppressed,
    });
    // 🔴 改名候选要先从 archive / untouched 里摘出来，再对"剩下的"跑普通归档的 git 检查——
    //    不然一个正在改名迁移的老目录会漏过普通归档的 git 检查（它已经不在 archive 里了），
    //    必须单独再对改名候选跑一遍同样的检查（详见 splitRenameGitTracked）。
    //    目录没核到（archiveSuppressed）时改名迁移也压掉：它的最后一步同样是归档老目录。
    const withRenames = extractRenames(draft, upstream.archiveSuppressed ? {} : upstream.renames, upstreamNames);
    // 🔴 归档之前先问 git：受跟踪的包一律摘出来不动（详见 splitGitTracked）。
    //    只对归档候选跑 git，不是对全部已装包——一次对账最多几十次探测，可忽略。
    const gitSplit = splitGitTracked(withRenames, findGitTracked(withRenames.archive, survey));
    const renameNames = gitSplit.renameCandidates.map((r) => r.from);
    const plan = splitRenameGitTracked(gitSplit, findGitTracked(renameNames, survey));
    // dry-run 与真跑共用同一套判定（execute:false 只读不写）：这里先把「会搬哪些文件」算出来
    // 挂在计划上，供打印 / --json 用——保证「计划说的」和「真跑做的」永远是同一份代码算出来的。
    plan.renamed = plan.renamed.map((r) => ({ ...r, preview: planRenameMigration(scope, survey, r, { execute: false }) }));
    plan.pinned = pinned;
    plan.refreshInfo = describeRefresh(plan.refresh, survey, upstream);
    // 遗留副本归档也是归档：目录没核到时一并压掉。
    const stray = upstream.archiveSuppressed ? null : surveyStrayEveDir(scope, upstream.currentHashes, upstream.knownHashes);
    report.push({ scope, survey, plan, stray, lock });
  }

  // 🔴 刷新一样是「往用户磁盘上写文件」的动作（`skills add` 会原地覆写），不该比归档少一道门。
  //    改名迁移同样要写磁盘（搬文件 + 归档老目录），也计进这个唯一真相来源：
  //    totalChanges === 0 必须真的等于「一个动作都没有」。
  //    遗留副本归档同样是搬用户磁盘上的目录，也计进来——否则「只有遗留副本要归档」那一跑会绕过确认门。
  const totalChanges = report.reduce(
    (n, r) => n + r.plan.archive.length + r.plan.add.length + r.plan.refresh.length + r.plan.renamed.length + (r.stray?.ours.length || 0),
    0
  );
  // 🔴 自更新提示靠名单判定：本进程没法知道刚落地的新脚本长什么样，「dby-update 在本轮安装名单里」是唯一可靠信号。
  const selfUpdated = report.some((r) => r.plan.add.includes("dby-update") || r.plan.refresh.includes("dby-update"));
  // sources 传引用不拷贝：执行阶段 clone 回退会把 install 改成 gitee，结尾那份 JSON 要看到改后的值。
  const meta = { namesSource: upstream.namesSource, metaSource: upstream.metaSource, archiveSuppressed: upstream.archiveSuppressed, installRef: upstream.ref, sources: upstream.sources };
  if (!opts.json) {
    console.log(`\n上游现有 ${upstream.names.length} 个 skill；我们发布过的历史版本闭集覆盖 ${Object.keys(upstream.knownHashes).length} 个 slug`);
    for (const { scope, survey, plan, stray } of report) {
      printPlan(scope, survey, plan, opts, upstream.names.length);
      printStray(stray, opts);
    }
    if (totalChanges === 0) console.log(`\n${convergedConclusion(upstream.namesSource, upstream.sources)}`);
  }

  if (opts.dryRun) {
    // notes 并进 JSON（不是丢掉）：它是「上游名单从哪来」的唯一线索，机器也该读得到。
    if (opts.json) console.log(JSON.stringify({ ...meta, notes: upstream.notes, names: upstream.names, report: report.map(stripScope), executed: false }, null, 2));
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
  const renameOutcomesByScope = new Map();
  for (const { scope, survey, plan, stray } of report) {
    const cwd = scope.kind === "global" ? undefined : scope.dir;
    const scopeFlag = scope.kind === "global" ? ["-g"] : [];
    // 本 scope 这一轮落的归档根：拉取挂了就按 manifest 原路搬回。上一个 scope 的已经完整跑完，不动。
    const scopeArchived = [];

    if (plan.archive.length) {
      say(`\n归档 ${plan.archive.length} 个上游已下架的 skill（移走，不删）…`);
      const res = archivePackages(scope, plan.archive, survey);
      archived.push({ scope: scope.label, packages: plan.archive.length, ...res });
      scopeArchived.push(res);
      say(`   已移到 ${res.root}`);
      // 目录已经移走，这一步只是让 skills CLI 把自己的安装记录也清掉。
      // 不传 -a：remove 省略 -a 时打到全部 agent；别照 --help 写 -a '*'，remove 不认星号。
      runSkills(["remove", ...plan.archive, ...scopeFlag, "-y"], cwd);
    }

    // 只装该装的：用户改过的包被排除在外，免得 --all 一把盖掉人家的改动；
    // 改名迁移的目标包也要在这批一起装上（除非它已经是当前版，不用重装）——
    // 「装新包 → 搬本地数据 → 老目录归档」这条链，第一步必须先落地。
    const upToDateSet = new Set(plan.upToDate);
    const renameTargets = plan.renamed.filter((r) => !upToDateSet.has(r.to)).map((r) => r.to);
    const want = [...new Set([...plan.add, ...plan.refresh, ...renameTargets])].sort();
    if (want.length) {
      say(`\n拉取上游 ${want.length} 个 skill…`);
      const agentsToo = targetAgents(scope);
      say(`   装给：${agentsToo.join(", ")}`);
      if (upstream.ref) say(`   安装源固定到版本表声明的 ref：${upstream.ref}`);
      try {
        await installWithFallback(upstream, want, scopeFlag, agentsToo, cwd);
        // 装完立刻写 origin：下一跑「用户改过没有」就以它为准，不再只靠闭集猜。
        for (const slug of want) {
          for (const dir of uniqueRealDirs(installDirs(scope).map((d) => join(d.path, slug)))) writeOrigin(dir, slug, upstream);
        }
      } catch (err) {
        // 🔴 归档已经落盘、拉取挂了 ⇒ 先把本 scope 这一轮归档的目录按 manifest 搬回原处，再报错。
        //    复原自己也可能挂：那份归档根照实列出来、附复原命令，原始错误不吞。
        let restoredCount = 0;
        const restoredRoots = [];
        const failed = [];
        for (const a of scopeArchived) {
          if (!a?.root) continue;
          try {
            const r = restoreArchive(a.root);
            restoredCount += r.restored.length;
            restoredRoots.push(a.root);
            for (const s of r.skipped) failed.push({ root: a.root, error: `${s.skill}：${s.reason}` });
          } catch (restoreErr) {
            failed.push({ root: a.root, error: restoreErr?.message || String(restoreErr) });
          }
        }
        if (restoredCount) say(`   拉取失败，已把本轮刚归档的 ${restoredCount} 个复原回原处。`);
        if (err instanceof Friendly) {
          err.hint = partialMigrationHint({ restoredCount, restoredRoots, failed, wantCount: want.length, installRef: upstream.ref, mirrorTried: Boolean(installSource(upstream.ref, "gitee")) && upstream.sources.install !== "override" });
        }
        throw err;
      }
    }

    // ---- 改名迁移：新包已经落地，现在搬本地数据、再把搬完的老目录归档。
    // 🔴 顺序固定：先搬、搬成功才归档——任一条搬运失败，那一条老目录原地不动（spec 硬要求）。
    if (plan.renamed.length) {
      say(`\n改名迁移 ${plan.renamed.length} 个（老 slug 已在上游改名）…`);
      const perPackage = {};
      const toArchive = [];
      const outcomes = [];
      for (const r of plan.renamed) {
        const result = planRenameMigration(scope, survey, r, { execute: true });
        outcomes.push(result);
        if (result.skipped) {
          say(`   ${r.from} → ${r.to}：${result.skipped}`);
          continue;
        }
        if (!result.ok) {
          say(`   ⚠️ ${r.from} → ${r.to} 搬运失败：${result.error}`);
          say(`      老目录原地不动，需要就手工执行：${result.manualCmd}`);
          continue;
        }
        perPackage[r.from] = {
          migratedFiles: result.migrated,
          conflicts: result.conflicts,
          reason: `上游改名为 ${r.to}，本地数据已搬运：${JSON.stringify(result.migrated)}`,
        };
        toArchive.push(r.from);
        say(
          `   ${r.from} → ${r.to}：搬了 ${result.migrated.length} 个文件` +
            (result.conflicts.length ? `，${result.conflicts.length} 个冲突未覆盖（新目录已有同名文件）` : "")
        );
      }
      if (toArchive.length) {
        const res = archivePackages(scope, toArchive, survey, {
          reason: "上游改名，由 dby-update 对账迁移；本地数据已搬到新包，老目录仅作保留可复原",
          perPackage,
        });
        archived.push({ scope: scope.label, packages: toArchive.length, ...res });
        say(`   老目录已归档到 ${res.root}`);
        // 目录已经移走，这一步只是让 skills CLI 把自己对老 slug 的安装记录也清掉。
        runSkills(["remove", ...toArchive, ...scopeFlag, "-y"], cwd);
      }
      renameOutcomesByScope.set(scope, outcomes);
    }

    // ---- 遗留副本：我方那几份移进归档（不删、可复原），不是我们的原地不动。放在最后：拉取挂了它就不动，少一样要回滚的。
    if (stray?.ours.length) {
      say(`\n归档 ${stray.ours.length} 个旧版遗留在 ${stray.path} 的重复副本（移走，不删）…`);
      const res = archiveStray(scope, stray);
      archived.push({ scope: scope.label, packages: stray.ours.length, stray: true, ...res });
      say(`   已移到 ${res.root}` + (stray.others.length ? `；不是我们的 ${stray.others.length} 个原地没动` : ""));
    }
  }

  // ---- 复核 + 自检
  const results = [];
  for (const { scope, plan, lock, survey } of report) {
    let after = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    // 🔴 origin 补录：不是对账器装的（用户手跑 skills add、或本机是 origin 机制之前装的）就没有 origin，
    //    但只要目录哈希能在索引里对上某一版，这一版是什么就是确定的——补一份，下一跑就能用 origin 判「改过」，
    //    而不是永远退回闭集猜。哈希对不上任何一版（modified / 索引退回旧文件）的不补：宁可没有也不写错。
    if (backfillOrigins(scope, after, upstream)) after = surveyScope(scope, upstream.currentHashes, upstream.knownHashes);
    // lock 每跑重建非 pin 字段：以磁盘现状为准，pin 原样继承。
    writeLock(scope, rebuildLock(lock, after, upstream));
    // 受 git 跟踪的是**故意**留在原地的，不算「没归档掉」——否则它每次都把退出码顶成 3，
    // 谁把 skill 版本化进仓库谁就永远看到一次假红。pin 的、目录没核到而压住的、索引不一致的同理。
    const kept = new Set([
      ...plan.gitTracked,
      ...plan.gitUnknown,
      ...(plan.pinned || []).map((p) => p.name),
      ...(plan.archiveHeld || []),
      ...(plan.inconsistent || []),
    ]);
    // 归档是否该发生只看索引状态（有索引时）；没索引才按名单缺席推断。
    const shouldBeGone = (name) => (upstream.status ? GONE_STATUSES.has(upstream.status[name]) : !upstream.names.includes(name));
    const stillStale = after
      .filter((s) => s.state === "historical" && shouldBeGone(s.name) && !kept.has(s.name))
      .map((s) => s.name);
    // 🔴 「装完之后真的到位了吗」——这条判据用的是**我们自己重扫磁盘**的结果，
    //    不解析 `skills add` 的输出。实证（2026-08-26 用户现场）：安装器打了
    //    `Failed to install 3` 却以退出码 0 收场，而 runSkills 只看退出码 ⇒ 失败被整个吞掉。
    //    解析别人的措辞是脆的（CLI 改一次文案就失灵），重扫盘不会骗人。
    //    注意与 stillStale 的区别：那条问「上游已下架的归档掉没有」，这条问「该刷新的刷到没有」。
    const stillBehind = [...plan.add, ...plan.refresh]
      .filter((name) => {
        const now = after.find((a) => a.name === name);
        if (!now) return true;                       // 计划装它、扫不到 ⇒ 没装上
        return now.state !== "current";              // 还停在旧版 / 状态不对 ⇒ 没刷到
      })
      .sort();
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
    const renameResults = renameOutcomesByScope.get(scope) || [];
    results.push({ scope, plan, survey, after, stillStale, stillBehind, keptModified, keptForeign, checks, renameResults });
  }

  // 改名迁移里「搬运失败、老目录没归档」的，必须让整体退出码反映出来——它不是自检项，
  // 是本轮真的没做完的事，跟 stillStale 一个级别。
  const renameFailed = results.some((r) => r.renameResults.some((o) => !o.skipped && !o.ok));

  if (opts.json) {
    console.log(JSON.stringify({ ...meta, selfUpdated, notes: upstream.notes, results: results.map(stripScope), archived, executed: true }, null, 2));
    const behind = results.some((r) => r.stillBehind.length) || results.some((r) => r.stillStale.length);
    return results.every((r) => r.checks.every((c) => c.ok)) && !renameFailed && !behind ? 0 : 3;
  }

  let allOk = true;
  for (const r of results) {
    const counts = r.after.reduce((m, s) => ({ ...m, [s.state]: (m[s.state] || 0) + 1 }), {});
    console.log(`\n── ${r.scope.label} 对账完成`);
    console.log(
      `   归档 ${r.plan.archive.length}，新增 ${r.plan.add.length}，刷新 ${r.plan.refresh.length}，` +
        `本来就是当前版没动 ${r.plan.upToDate.length}`
    );
    // 🔴 做了什么要逐项点名（用户实证：跑完只看到「刷新 1」，不知道刷的是谁、从几到几）。
    //    刷新/新增按「slug 旧 → 新  changelog」列，与预检同一格式；收敛态列一行各包版本，回答「现在都是几」。
    for (const n of r.plan.archive) console.log(`        📦 ${n}  已归档`);
    for (const d of describeRefresh(r.plan.add, [], upstream)) console.log(`        + ${d.slug}${d.displayName ? `（${d.displayName}）` : ""}  ${d.to}  ${d.changelog}`);
    for (const d of describeRefresh(r.plan.refresh, r.survey || [], upstream)) printRefreshLine(d);
    const current = r.after.filter((s) => s.state === "current").map((s) => `${s.name} ${versionOfHash(upstream, s.name, s.hash) ?? "?"}`);
    if (current.length) console.log(`   版本：${current.join(" · ")}`);
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
    if (r.stillBehind.length) {
      allOk = false;
      console.log(`   ❌ 有 ${r.stillBehind.length} 个没装上，还是旧版：${r.stillBehind.join(", ")}`);
      console.log(`      安装器可能报了失败却以退出码 0 收场。重跑一次 /dby-update；`);
      console.log(`      仍然装不上就把上面安装器的日志贴出来——这不是「更新完成」。`);
    }
    if (r.stillStale.length) {
      allOk = false;
      console.log(`   ⚠️ 还有 ${r.stillStale.length} 个没归档掉：${r.stillStale.join(", ")}`);
    }
    if (r.plan.renamed.length) {
      console.log(`   🔀 改名迁移 ${r.plan.renamed.length} 个：`);
      for (const o of r.renameResults) {
        if (o.skipped) {
          console.log(`        ${o.from} → ${o.to}：${o.skipped}`);
          continue;
        }
        if (!o.ok) {
          allOk = false;
          console.log(`        ⚠️ ${o.from} → ${o.to}：搬运失败（${o.error}），老目录原地不动`);
          console.log(`           手工执行：${o.manualCmd}`);
          continue;
        }
        console.log(`        ${o.from} → ${o.to}：搬了 ${o.migrated.length} 个文件（${o.migrated.join(", ") || "无"}）`);
        if (o.conflicts.length) console.log(`           冲突未覆盖（新目录已有同名文件）：${o.conflicts.map((c) => c.rel).join(", ")}`);
      }
    }
    if (r.plan.renamedSkipped?.length) {
      console.log(
        `   🔒 另有 ${r.plan.renamedSkipped.length} 个老目录上游已改名、但受 git 跟踪或判不出来，没动：` +
          r.plan.renamedSkipped.map((s) => `${s.from}→${s.to}`).join(", ")
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
  // 🔴 归档必须**同时**告诉用户「怎么捞回来」，而且是能直接粘贴的命令。只写「见 manifest」
  //    等于把复原门槛推给用户自己在终端里翻 JSON——那道门槛高到等于没有复原路径。
  for (const a of archived) {
    if (!a?.count) continue;
    console.log(`\n${a.stray ? "旧版遗留副本" : "归档的"} ${a.count} 份原样躺在 ${a.root}`);
    console.log(`   确认没问题 → 整个目录删掉即可。`);
    console.log(`   想全部捞回来 → 照抄这一条（按 manifest 逐条移回原处）：\n`);
    console.log(`   ${restoreCommand(a.root)}\n`);
    console.log(`   移回去就立刻能用（宿主是按目录读 skill 的）；但 skills CLI 的安装记录已经清掉，`);
    console.log(`   想让 \`npx skills list\` 也认回来，再跑一次：npx -y skills add ${REPO} -s <包名>`);
  }
  // skills CLI 会把「这次装了哪些包、哪个版本」记进项目里的 skills-lock.json，那是**受 git 跟踪**的
  // 文件（不像 .doubaoya 自带忽略），所以对账跑完 git status 会多出一行。不说清，用户会以为
  // 工具偷偷弄脏了他的工作区。
  if (totalChanges > 0) {
    for (const { scope } of report) {
      if (scope.kind !== "project" || !scope.dir) continue;
      const lock = join(scope.dir, "skills-lock.json");
      if (!existsSync(lock)) continue;
      console.log(`\n📝 ${lock} 会被 skills CLI 一起更新（记的是这次装了哪些包、哪个版本）。`);
      console.log(`   这是**预期内**的改动，不是污染；它受 git 跟踪，会出现在 git status 里，照常提交即可。`);
    }
  }
  console.log(
    allOk
      ? `\n全部通过。当前对话如果还没读到新能力，新建一次对话就能用。`
      : `\n对账做完了，但自检有没过的项（上面标 ❌ 的），按提示处理完再用。`
  );
  if (upstream.namesSource === "versions") {
    console.log(`   （这一跑上游目录列表没拉到，名单以版本表为准；上游若有还没盖版本戳的新包，这次没核到。）`);
  } else if (upstream.namesSource === "index") {
    console.log(`   （这一跑上游目录列表没拉到，按索引对账，上游目录未能核对，本轮没做任何归档；目录能拉到时再跑一次。）`);
  }
  if (upstream.metaSource === "legacy") {
    console.log(`   （上游索引没拉到，这次是按旧版三文件对账的：看不到版本号与变更说明，其余判定不受影响。）`);
  }
  // 🔴 自己被刷新了：本进程跑的仍是旧版逻辑（不 re-exec，见文件头），新逻辑要下一跑才生效。
  if (selfUpdated) {
    console.log(`\n🔁 本轮把 dby-update 自己也更新了：这次对账仍由旧版逻辑完成，建议再跑一次 /dby-update，让新版逻辑重新核一遍。`);
  }
  return allOk ? 0 : 3;
}

/**
 * `--json` 的形状：scope 只留 label；`plan.refresh` 对外是对象数组 `{slug, from, to, changelog, changelogSource}`
 * （内部各处仍按名字数组传，只在出口这一处换形状，避免几十个 caller 跟着改）。lock 是磁盘上的东西，不进 JSON。
 */
function stripScope(r) {
  const { scope, lock, ...rest } = r;
  if (rest.plan) {
    const { refreshInfo, ...plan } = rest.plan;
    rest.plan = { ...plan, refresh: refreshInfo || plan.refresh.map((slug) => ({ slug })) };
  }
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
 * 🔴 经**软链**调用时，这个脚本必须照常干活——不许静默空跑。
 *
 * 为什么单独钉一条：软链不是边角，是 skills CLI 装出来的**常态形态**。装到 claude-code 时
 * 真目录落在 `.agents/skills/<name>`，`.claude/skills/<name>` 是指过去的一条软链；而 SKILL.md
 * 教的查找顺序把 `.claude` 那条排在**前面**——照着 SKILL.md 执行的 agent，第一个找到的就是软链。
 * 入口守卫一旦退化回「`import.meta.url` 直接比 `process.argv[1]` 拼出来的串」，这条路径上
 * `main()` 一步都不进：**退出码 0、stdout 零字节**。它长得和「跑完了、没事可做」一模一样，
 * 既有的任何一条自检都不会红（自检自己是走真路径起的进程），用户也不会来报错——
 * 只会以为对账跑过了。所以判据必须是「真造一条软链、真起进程、看有没有输出」。
 *
 * fixture 完全离线：只跑 `--help`（不联网、不碰任何安装目录），
 * 目录形态照抄本机真实那份：真副本在 `.agents/skills/…`，`.claude/skills/<name>` 是相对软链。
 * 判据两条：退出码 0（本来就 0，单独看它等于没看），且**输出与走真路径调用逐字一致**。
 */
function symlinkEntryCheck() {
  // 🔴 mkdtemp 给的路径**自己就可能是条软链**（macOS 上 tmpdir() 是 /var/… → /private/var/…）。
  //    不先 realpath，这条自检的「走真路径」那一头其实也经了软链，对照组就废了。
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dby-symlink-selfcheck-")));
  try {
    const realDir = join(root, ".agents", "skills", "dby-update", "scripts");
    mkdirSync(realDir, { recursive: true });
    const realScript = join(realDir, "reconcile.mjs");
    cpSync(SELF_PATH, realScript);
    mkdirSync(join(root, ".claude", "skills"), { recursive: true });
    symlinkSync(join("..", "..", ".agents", "skills", "dby-update"), join(root, ".claude", "skills", "dby-update"));
    const linked = join(root, ".claude", "skills", "dby-update", "scripts", "reconcile.mjs");

    const run = (script) => spawnSync(process.execPath, [script, "--help"], { encoding: "utf-8" });
    const viaLink = run(linked);
    const viaReal = run(realScript);

    if (!viaReal.stdout.trim()) {
      // 前提不成立：连真路径都不出东西，下面那条断言就是在空气里跑
      return [`软链入口 · fixture 前提不成立：走真路径的 --help 也是空的（退出码 ${viaReal.status}）`];
    }
    const fails = [];
    if (viaLink.status !== 0) fails.push(`软链入口 · 退出码应为 0，实际 ${viaLink.status}：${(viaLink.stderr || "").trim().slice(-200)}`);
    if (!viaLink.stdout.trim()) {
      fails.push("🔴 软链入口 · 整个脚本静默空跑了：退出码 0、stdout 零字节（入口守卫又退化成拿 argv[1] 字面比 import.meta.url 了）");
    } else if (viaLink.stdout !== viaReal.stdout) {
      fails.push(`软链入口 · 输出与真路径不一致：软链 ${JSON.stringify(viaLink.stdout.slice(0, 80))} vs 真路径 ${JSON.stringify(viaReal.stdout.slice(0, 80))}`);
    }
    return fails;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
      [SELF_PATH, "--dry-run", "--json", "--scope", "project", "--project-dir", root],
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
/**
 * 🔴 装的目标必须**收窄到本机真有的安装目录**，而且必须落在我们自己会查的那两个目录里。
 *    这条断言盯的是一个静默事故：一旦回到全量扇出，每次对账都会往用户仓库根上刨一个
 *    `agent/skills`（skills CLI 里 eve 的目录，落的还是真实副本）。装完照样打印「完成」，
 *    污染在别处，没有任何一条既有断言会红。
 */
function targetAgentsCheck() {
  const fails = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(`装给谁 · ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  };
  const root = mkdtempSync(join(tmpdir(), "dby-agents-selfcheck-"));

  // 一个安装目录都没有 ⇒ 回落通用默认，绝不是「全部 agent」
  eq("空机器回落 universal", targetAgents({ kind: "project", dir: root }), ["universal"]);

  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  eq("只有 .claude/skills", targetAgents({ kind: "project", dir: root }), ["claude-code"]);

  mkdirSync(join(root, ".agents", "skills"), { recursive: true });
  eq("两个都有", targetAgents({ kind: "project", dir: root }), ["claude-code", "universal"]);

  // 🔴 决不能出现星号：它是「注册表里全部 ~70 个 agent」，不是「装了的」。
  for (const scope of [{ kind: "project", dir: root }, { kind: "global" }]) {
    const got = targetAgents(scope);
    if (got.includes("*")) fails.push(`装给谁 · ${scope.kind} 里出现了星号：${JSON.stringify(got)}`);
    if (!got.length) fails.push(`装给谁 · ${scope.kind} 返回空名单——省略 -a 会让 CLI 回落到全部 agent`);
  }

  // 装的目标和查的目录必须同源：装了却不查 = 永远查不出漂移，也永远归档不掉。
  const surveyed = new Set(installDirs({ kind: "project", dir: root }).map((d) => d.agent));
  for (const a of targetAgents({ kind: "project", dir: root })) {
    if (!surveyed.has(a)) fails.push(`装给谁 · 往一个自己不查的目录装：${a}`);
  }

  rmSync(root, { recursive: true, force: true });
  return fails;
}

/**
 * 存量污染走归档不走删除：造一个 `agent/skills` 里既有我方副本又有别人包的 fixture，
 *   dry-run：只报告，磁盘一个字不动，输出里不许出现 rm；
 *   真跑：我方副本移进归档目录并记进 manifest，别人的原地不动，输出里同样不许出现 rm。
 * 全程离线（DBY_RAW_BASE 指向 fixture、npx 是假的）。
 */
function strayEveDirCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-stray-selfcheck-"));
  const { bin } = stubNpxDir();
  const pkg = join(root, "agent", "skills", "some-skill");
  const otherPkg = join(root, "agent", "skills", "someone-else");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(otherPkg, { recursive: true });
  writeFileSync(join(pkg, "SKILL.md"), "---\nname: some-skill\n---\n");
  writeFileSync(join(otherPkg, "SKILL.md"), "---\nname: someone-else\n---\n");
  const mine = computeSkillHash(pkg);
  const known = { "some-skill": [mine] };
  try {
    const stray = surveyStrayEveDir({ kind: "project", dir: root }, { "some-skill": mine }, known);
    if (!stray) return ["存量污染 · agent/skills 里躺着我方包的副本，却没被点名"];
    if (!stray.ours.includes("some-skill")) fails.push(`存量污染 · 没点到名：${JSON.stringify(stray.ours)}`);
    if (!stray.others.includes("someone-else")) fails.push(`存量污染 · 别人的包该记进 others：${JSON.stringify(stray.others)}`);
    // global scope 没有这个目录的概念，别误报
    if (surveyStrayEveDir({ kind: "global" }, { "some-skill": mine }, known) !== null) fails.push("存量污染 · global scope 不该报 agent/skills");
    // 只有别人的东西不算我们的污染
    if (surveyStrayEveDir({ kind: "project", dir: root }, {}, {}) !== null) fails.push("存量污染 · 把别人的包也算成了我们的重复副本");

    // 正式那份就位（收敛态），于是整份计划只剩「遗留副本归档」这一个动作
    const proper = join(root, ".claude", "skills", "some-skill");
    mkdirSync(proper, { recursive: true });
    writeFileSync(join(proper, "SKILL.md"), "---\nname: some-skill\n---\n");
    writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: { "some-skill": `doubaoya-skill/some-skill@${mine}` } }));
    writeFileSync(join(root, "known-hashes.json"), JSON.stringify({ skills: known }));
    const run = (args) =>
      spawnSync(process.execPath, [SELF_PATH, "--scope", "project", "--project-dir", root, ...args], {
        encoding: "utf-8",
        env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` },
      });

    const dry = run(["--dry-run"]);
    const dryOut = `${dry.stdout}\n${dry.stderr}`;
    if (!dryOut.includes("some-skill")) fails.push(`存量污染 · dry-run 没点名：${JSON.stringify(dryOut.slice(-300))}`);
    if (/\brm\b/.test(dryOut)) fails.push(`🔴 存量污染 · 输出里出现了删除命令：${JSON.stringify(dryOut.match(/.*\brm\b.*/)?.[0])}`);
    if (!existsSync(join(pkg, "SKILL.md")) || !existsSync(join(otherPkg, "SKILL.md"))) fails.push("🔴 存量污染 · dry-run 动了磁盘");
    // 遗留副本归档也是往用户磁盘上动目录：非交互、不给 --yes 必须停在确认门
    if (run([]).status !== 2) fails.push("🔴 存量污染 · 只有遗留副本要归档时没停在确认门（退出码应为 2）");

    const real = run(["--yes"]);
    const realOut = `${real.stdout}\n${real.stderr}`;
    if (/\brm\b/.test(realOut)) fails.push(`🔴 存量污染 · 真跑输出里出现了删除命令：${JSON.stringify(realOut.match(/.*\brm\b.*/)?.[0])}`);
    if (existsSync(pkg)) fails.push(`🔴 存量污染 · 真跑后我方副本还在 agent/skills 里（没归档）：${JSON.stringify(realOut.slice(-400))}`);
    if (!existsSync(join(otherPkg, "SKILL.md"))) fails.push("🔴 存量污染 · 别人的包被动了——只许归档我方副本");
    if (!existsSync(join(proper, "SKILL.md"))) fails.push("🔴 存量污染 · 正式那份被动了");
    const archiveDir = join(root, ".doubaoya", "archive");
    const roots = existsSync(archiveDir) ? readdirSync(archiveDir) : [];
    const manifest = roots.length ? JSON.parse(readFileSync(join(archiveDir, roots[0], "manifest.json"), "utf-8")) : null;
    const entry = manifest?.packages?.find((p) => p.skill === "some-skill");
    if (!entry) fails.push(`🔴 存量污染 · 归档 manifest 里没有副本条目：${JSON.stringify(manifest)}`);
    else if (!existsSync(join(entry.to, "SKILL.md"))) fails.push(`存量污染 · manifest 记的归档位置里没有东西：${entry.to}`);
    if (!/复原/.test(realOut) || !/manifest/.test(realOut)) fails.push(`存量污染 · 真跑没打印归档位置与复原方式：${JSON.stringify(realOut.slice(-400))}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
  return fails;
}

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
  const script = SELF_PATH;
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
      const plan = JSON.parse(res.stdout).report[0].plan;
      // --json 里 refresh 是对象数组（slug/from/to/changelog）；这条自检只关心名字。
      return { ...plan, refresh: plan.refresh.map((r) => r.slug) };
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

/**
 * 🔴 落位 · 计划层：「内容是当前版」不等于「已经就位」。
 *
 * 这条钉的是一个**永不自愈**的形态：包只落进 `.agents/skills`，内容哈希照样命中当前版，
 * 旧判据把它归进「已是当前版、不动」——于是 Claude Code 永远看不见它，用户重跑多少次
 * /dby-update 都补不上。实测受害者是对外主推的 `dby-banned-words`（历史名字已改名）。
 * 所以判据必须是「内容 **且** 落位」：任一受管 agent 目录缺落位就得重装。
 *
 * 另一头同样得钉死：两处都在时必须**零动作**——补落位不许退化成又一个「每跑一次全量重下」；
 * 本机只有一个安装目录时不许误报成缺；用户改过的包缺落位也绝不许被重装盖掉（那条红线在上面）。
 */
function placementPlanCheck() {
  const fails = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`落位·计划 · ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  const claude = { label: ".claude/skills", path: "/nowhere/.claude/skills", agent: "claude-code" };
  const universal = { label: ".agents/skills", path: "/nowhere/.agents/skills", agent: "universal" };
  const both = ["claude-code", "universal"];

  // 缺陷现场：内容是当前版，但只落进了 .agents/skills
  const half = planReconcile([{ name: "dby", state: "current", dirs: [universal] }], ["dby"], { expectedAgents: both });
  eq("🔴 缺一处落位的包没进刷新单（老用户重跑多少次都自愈不了）", half.refresh, ["dby"]);
  eq("🔴 缺一处落位的包被算成了「已是当前版、不动」", half.upToDate, []);
  eq("缺落位的要单列出来，好在计划里说清原因", half.misplaced, ["dby"]);

  // 反面：两处都在 = 真就位 ⇒ 零动作
  const full = planReconcile([{ name: "dby", state: "current", dirs: [claude, universal] }], ["dby"], { expectedAgents: both });
  eq("🔴 两处都在还要刷新（补落位退化成了全量重下）", [full.refresh, full.misplaced], [[], []]);
  eq("两处都在该记进「已是当前版」", full.upToDate, ["dby"]);

  // 本机只有一个受管安装目录：落在那一个就算齐
  const one = planReconcile([{ name: "dby", state: "current", dirs: [universal] }], ["dby"], { expectedAgents: ["universal"] });
  eq("只有一个安装目录的机器不该被误报成缺落位", [one.refresh, one.misplaced], [[], []]);

  // 🔴 用户动过手的包，缺落位也不许重装——刷新会盖掉他的改动
  const touched = planReconcile([{ name: "mine", state: "modified", dirs: [universal] }], ["mine"], { expectedAgents: both });
  eq("🔴 改过的包缺落位也绝不许被重装盖掉", [touched.refresh, touched.add, touched.misplaced], [[], [], []]);

  // 用户只看得见文案：计划里得说清「为什么内容最新还要重下」
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    printPlan({ label: "自检 scope" }, [], { ...half, gitTracked: [], gitUnknown: [] }, {}, 0);
  } finally {
    console.log = original;
  }
  const said = lines.filter((l) => l.includes("落位"));
  if (!said.length) fails.push("落位·计划 · 计划里没解释「内容已是当前版为什么还要重下」，用户只会以为工具在空转");
  else if (!lines.some((l) => l.includes("⤷ dby"))) fails.push(`落位·计划 · 缺落位的包名没列出来：${JSON.stringify(lines)}`);

  return fails;
}

/**
 * 🔴 落位 · 自检层：`checkPlacement` 必须**逐目录**核，不是并集核。
 *
 * 旧写法把两个安装目录 flatMap 成一个集合再判缺失，那是「或」——任一目录有就算过。
 * 造真目录来钉：`only-agents` 只在 `.agents/skills` 里，`.claude/skills` 存在但没有它。
 * 并集逻辑下这条全绿（缺陷现场），逐目录逻辑必须红，而且要指名**哪个目录缺哪个包**。
 */
function placementSelfTestCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-placement-selfcheck-"));
  try {
    const scope = { kind: "project", dir: root, label: "自检 scope" };
    const claudeDir = join(root, ".claude", "skills");
    const agentsDir = join(root, ".agents", "skills");
    for (const p of [join(claudeDir, "here"), join(agentsDir, "here"), join(agentsDir, "only-agents")]) {
      mkdirSync(p, { recursive: true });
    }

    const both = checkPlacement(scope, ["here"]);
    if (!both.ok) fails.push(`落位·自检 · 两处都在却报缺：${both.detail}`);

    const missing = checkPlacement(scope, ["here", "only-agents"]);
    if (missing.ok) {
      fails.push("🔴 落位·自检 · 逐目录核退化成了并集核：包只在 .agents/skills，Claude Code 根本看不见，却报「全部通过」");
    } else if (!missing.detail.includes(".claude/skills") || !missing.detail.includes("only-agents")) {
      fails.push(`落位·自检 · 没说清是哪个目录缺哪个包：${missing.detail}`);
    }

    // 反向也要报：只在 .claude 里的包，.agents 那侧同样是缺
    mkdirSync(join(claudeDir, "only-claude"), { recursive: true });
    const reverse = checkPlacement(scope, ["only-claude"]);
    if (reverse.ok || !reverse.detail.includes(".agents/skills")) {
      fails.push(`落位·自检 · 只落进 .claude/skills 的包没在 .agents/skills 那侧报缺：ok=${reverse.ok} detail=${reverse.detail}`);
    }

    // 只有一个安装目录的机器不许被误报
    const solo = mkdtempSync(join(tmpdir(), "dby-placement-solo-"));
    try {
      mkdirSync(join(solo, ".agents", "skills", "here"), { recursive: true });
      const only = checkPlacement({ kind: "project", dir: solo }, ["here"]);
      if (!only.ok) fails.push(`落位·自检 · 只有一个安装目录的机器被误报成缺：${only.detail}`);
    } finally {
      rmSync(solo, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 半迁移态的提示语。造法不 mock 我们自己的代码：PATH 上放一个「remove 成功、add 必挂」的
 * 假 npx，于是归档**真的落盘**、拉取**真的失败**——正是网络抖动那一跑的现场（实测 5 次里中过 1 次）。
 * 判据是那句话得说清三件事：已经归档了几个、磁盘是半变更态、重跑即可续上且归档不会重复。
 */
function partialMigrationCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-partial-selfcheck-"));
  const bin = mkdtempSync(join(tmpdir(), "dby-partial-npx-"));
  try {
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\ncase " $* " in *" add "*) echo "fatal: unable to access github.com" >&2; exit 1;; esac\nexit 0\n`,
      { mode: 0o755 }
    );
    const pkg = join(root, ".claude", "skills", "retired-skill");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), "---\nname: retired-skill\n---\n");
    const retired = computeSkillHash(pkg);
    writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: { "keep-skill": "doubaoya-skill/keep-skill@aaaaaaaaaaaa" } }));
    writeFileSync(
      join(root, "known-hashes.json"),
      JSON.stringify({ skills: { "keep-skill": ["aaaaaaaaaaaa"], "retired-skill": [retired] } })
    );

    const res = spawnSync(
      process.execPath,
      [SELF_PATH, "--yes", "--scope", "project", "--project-dir", root],
      { encoding: "utf-8", env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` } }
    );
    const out = `${res.stdout || ""}\n${res.stderr || ""}`;
    const tail = () => JSON.stringify(out.slice(-600));
    // 先确认这条自检**真踩在**拉取失败上，否则下面的断言等于在空气里跑
    if (res.status === 0) fails.push(`半迁移 fixture 前提不成立：拉取那一步没失败（退出码 ${res.status}）`);
    if (!/已移到/.test(out)) fails.push(`半迁移 fixture 前提不成立：归档那一步没执行 ${tail()}`);
    if (!/skills add/.test(out)) fails.push(`🔴 原始拉取错误被吞了：${tail()}`);
    // 🔴 拉取挂了 ⇒ 本轮归档的目录必须已经自动搬回原处，磁盘回到跑之前的样子
    if (!existsSync(join(pkg, "SKILL.md"))) fails.push(`🔴 拉取失败后本轮归档的目录没有自动复原回原处：${tail()}`);
    if (!/已自动复原回原处/.test(out) || !/复原/.test(out)) fails.push(`🔴 提示没说「已复原了几个」，用户不知道自己机器现在什么状态：${tail()}`);
    if (!/直接重跑同一条命令/.test(out) || !/安装记录/.test(out)) {
      fails.push(`🔴 提示没说「重跑即可、skills CLI 安装记录需重跑补齐」，用户不敢重跑：${tail()}`);
    }
    if (/改了一半/.test(out)) fails.push(`复原之后不该再说磁盘「改了一半」：${tail()}`);
    // 归档根还在（manifest 留着），但包已经不在里面了
    const archiveDir = join(root, ".doubaoya", "archive");
    const roots = existsSync(archiveDir) ? readdirSync(archiveDir) : [];
    if (!roots.length) fails.push("半迁移 · 归档根不见了（复原只该把包搬回去，manifest 该留着）");
    else if (existsSync(join(archiveDir, roots[0], "claude_skills", "retired-skill"))) fails.push("半迁移 · 归档目录里还留着包（复原没有搬走）");

    // 🔴 复原本身失败：把归档目录里的包换成一个已经在原处出现的同名目录（不覆盖），必须报出归档路径 + 复原命令，且原始拉取错误不吞。
    const res2 = spawnSync(
      process.execPath,
      [SELF_PATH, "--yes", "--scope", "project", "--project-dir", root],
      { encoding: "utf-8", env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` } }
    );
    // 第二跑等同第一跑（幂等）；这里再单独用 restoreArchive 直接钉「原处被占就不覆盖」：
    const root2 = existsSync(archiveDir) ? readdirSync(archiveDir).sort().pop() : null;
    if (res2.status === 0 || !root2) fails.push(`半迁移 · 第二跑前提不成立（退出码 ${res2.status}）`);
    else {
      const manifest = JSON.parse(readFileSync(join(archiveDir, root2, "manifest.json"), "utf-8"));
      const it = manifest.packages[0];
      mkdirSync(it.to, { recursive: true }); // 假装归档里还有一份，而原处已被复原占着
      const r = restoreArchive(join(archiveDir, root2));
      if (r.restored.length || !r.skipped.length) fails.push(`🔴 restoreArchive 在原处已有同名目录时覆盖了它：${JSON.stringify(r)}`);
      const hint = partialMigrationHint({ restoredCount: 0, failed: [{ root: join(archiveDir, root2), error: "x" }], wantCount: 1 });
      if (!hint.includes(join(archiveDir, root2)) || !hint.includes("manifest.json")) fails.push(`🔴 复原失败的提示没带归档路径 + 复原命令：${hint}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
  return fails;
}

// ---------------------------------------------------------------- 改名迁移自检

/** 只放一个已下架老包（无 renames.json 语义）的 fixture，供"空表 / 缺表"回退检查用。 */
function buildBareOldPackageFixture() {
  const root = mkdtempSync(join(tmpdir(), "dby-renames-bare-"));
  const pkg = join(root, ".claude", "skills", "old-pkg-a");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "SKILL.md"), "---\nname: old-pkg-a\n---\n");
  const hash = computeSkillHash(pkg);
  // 上游名单不能是空的（那会被当成异常直接中止），随手带一个"仍在架"的包撑住 fetchUpstream。
  writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: { "keep-skill": "doubaoya-skill/keep-skill@aaaaaaaaaaaa" } }));
  writeFileSync(
    join(root, "known-hashes.json"),
    JSON.stringify({ skills: { "old-pkg-a": [hash], "keep-skill": ["aaaaaaaaaaaa"] } })
  );
  return root;
}

/**
 * 🔴 spec 的硬要求：表缺失 / 不可解析时**不中止**，按无改名继续，且计划必须与「空表」逐字一致。
 * 三种退化各造一份 fixture：不写 renames.json / 写非法 JSON / schema_version 给个不认识的数字，
 * 逐一跟「空表」那份的 dry-run 计划比对。
 */
function renamesFallbackCheck() {
  const fails = [];
  const run = (root) =>
    spawnSync(process.execPath, [SELF_PATH, "--dry-run", "--json", "--scope", "project", "--project-dir", root], {
      encoding: "utf-8",
      env: { ...process.env, DBY_RAW_BASE: root },
    });

  const emptyRoot = buildBareOldPackageFixture();
  writeFileSync(join(emptyRoot, "renames.json"), JSON.stringify({ schema_version: 1, renames: {} }));
  const variants = {
    缺表: buildBareOldPackageFixture(), // 干脆不写 renames.json
    非法JSON: buildBareOldPackageFixture(),
    不认识的schema: buildBareOldPackageFixture(),
  };
  writeFileSync(join(variants.非法JSON, "renames.json"), "{ 这不是合法 JSON");
  writeFileSync(join(variants.不认识的schema, "renames.json"), JSON.stringify({ schema_version: 99, renames: {} }));

  const roots = [emptyRoot, ...Object.values(variants)];
  try {
    const emptyRes = run(emptyRoot);
    if (emptyRes.status !== 0) {
      fails.push(`renames 回退 · 空表 fixture 跑挂了（退出码 ${emptyRes.status}）：${(emptyRes.stderr || "").trim().split("\n").pop()}`);
      return fails;
    }
    const emptyParsed = JSON.parse(emptyRes.stdout);
    if (!emptyParsed.report[0].plan.archive.includes("old-pkg-a")) {
      fails.push("renames 回退 fixture 前提不成立：老包应该正常进归档单");
    }

    for (const [label, root] of Object.entries(variants)) {
      const res = run(root);
      if (res.status !== 0) {
        fails.push(`renames 回退 · ${label} 跑挂了（退出码 ${res.status}）：${(res.stderr || "").trim().split("\n").pop()}`);
        continue;
      }
      const parsed = JSON.parse(res.stdout);
      // 只比 plan：survey/scope 里带着各自 fixture 的临时目录绝对路径，天然不相等，
      // 真正该比的是"算出来的计划"，不是路径字面量。
      const plans = (r) => r.report.map((s) => s.plan);
      if (JSON.stringify(plans(parsed)) !== JSON.stringify(plans(emptyParsed))) {
        fails.push(
          `🔴 renames 回退 · ${label} 时的计划应与空表完全一致：${label}=${JSON.stringify(plans(parsed))} 空表=${JSON.stringify(plans(emptyParsed))}`
        );
      }
      if (!parsed.notes.some((n) => n.includes("没有可用的改名表"))) {
        fails.push(`🔴 renames 回退 · ${label} 时 notes 没有提示按无改名处理：${JSON.stringify(parsed.notes)}`);
      }
      if (!(res.stderr || "").includes("没有可用的改名表")) {
        fails.push(`renames 回退 · ${label} 时提示没走 stderr`);
      }
    }
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 造一套"老包已在上游改名"的 fixture：project scope 下 `.claude/skills/old-pkg-a`
 * （老包，含 config.json / profiles/x.json / themes/benya-clean.json 三样用户数据）+ 可选的
 * 预装 `dby-publish`（模拟"新包已经落地"——`planRenameMigration` 只有在目标目录存在时才能
 * 正确判定"上游新包自带、不用搬"的文件，所以主线场景必须让它已经在场；这本身也是真实场景：
 * `dby-publish` 是一个真实存在于上游全集的包，`skills add` 会把它装出来）。
 * `renames.json` 固定指 `old-pkg-a → dby-publish`。
 */
function buildRenameFixture({ preinstallTarget = true, targetHasConfig = false, gitTrackOld = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "dby-rename-selfcheck-"));
  const skillsDir = join(root, ".claude", "skills");
  const oldDir = join(skillsDir, "old-pkg-a");
  mkdirSync(join(oldDir, "profiles"), { recursive: true });
  mkdirSync(join(oldDir, "themes"), { recursive: true });
  writeFileSync(join(oldDir, "SKILL.md"), "---\nname: old-pkg-a\n---\n");
  writeFileSync(join(oldDir, "config.json"), JSON.stringify({ mine: true }));
  writeFileSync(join(oldDir, "profiles", "x.json"), JSON.stringify({ ip: "my-ip" }));
  writeFileSync(join(oldDir, "themes", "benya-clean.json"), JSON.stringify({ from: "old" }));
  const oldHash = computeSkillHash(oldDir);

  const known = { "old-pkg-a": [oldHash] };
  const versions = {};
  let targetDir = null;
  if (preinstallTarget) {
    targetDir = join(skillsDir, "dby-publish");
    mkdirSync(join(targetDir, "themes"), { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), "---\nname: dby-publish\n---\n");
    // 上游新包自带的默认主题——跟老目录里那份同名但内容不同，用来证明"不覆盖"。
    writeFileSync(join(targetDir, "themes", "benya-clean.json"), JSON.stringify({ from: "upstream" }));
    if (targetHasConfig) writeFileSync(join(targetDir, "config.json"), JSON.stringify({ notMine: true }));
    const targetHash = computeSkillHash(targetDir);
    known["dby-publish"] = [targetHash];
    versions["dby-publish"] = `doubaoya-skill/dby-publish@${targetHash}`;
  }

  writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: versions }));
  writeFileSync(join(root, "known-hashes.json"), JSON.stringify({ skills: known }));
  writeFileSync(
    join(root, "renames.json"),
    JSON.stringify({
      schema_version: 1,
      renames: {
        "old-pkg-a": { to: "dby-publish", userFiles: ["config.json", "profiles/", "themes/"] },
      },
    })
  );

  if (gitTrackOld) {
    const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf-8" });
    git("init", "-q");
    git("config", "user.email", "selfcheck@example.com");
    git("config", "user.name", "selfcheck");
    git("add", "-f", ".claude/skills/old-pkg-a");
    git("commit", "-qm", "track old pkg");
  }

  return { root, oldDir, targetDir };
}

/**
 * 🔴 改名迁移全链路实证：不 mock 文件系统，真读真写。这条要防的正是"计划算得对、真搬起来
 * 还是把用户数据丢了/覆盖了"这一种退化——它长得和通过一模一样，只有真的比对文件内容才拦得住。
 *
 * 🔴 判据不含"整体退出码必须是 0"：`selfTest` 里的健康检查/API 钥匙检查会打真实网络请求，
 * 自检环境大概率没网也没配钥匙，那两项**必然**报红、把退出码顶成 3——这与改名迁移对不对
 * 是两件事（`partialMigrationCheck` 已经是这么处理的）。所以这里只信 `--json` 的 stdout 内容，
 * 不信退出码。
 */
function renameMigrationCheck() {
  const fails = [];
  const { bin } = stubNpxDir();
  const runNode = (root, args) =>
    spawnSync(process.execPath, [SELF_PATH, "--scope", "project", "--project-dir", root, ...args], {
      encoding: "utf-8",
      env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` },
    });
  const parseOrFail = (res, label) => {
    try {
      return JSON.parse(res.stdout);
    } catch (err) {
      fails.push(`改名迁移 · ${label} 的 stdout 不是合法 JSON（${err.message}）：${(res.stderr || "").trim().split("\n").pop()}`);
      return null;
    }
  };

  // ── 主线：dry-run 预览 → 真跑迁移 → 二次运行幂等 ──────────────────────
  const fx = buildRenameFixture();
  try {
    const originalConfig = readFileSync(join(fx.oldDir, "config.json"));
    const originalProfile = readFileSync(join(fx.oldDir, "profiles", "x.json"));

    const dryParsed = parseOrFail(runNode(fx.root, ["--dry-run", "--json"]), "主线 dry-run");
    const previewMigrated = dryParsed?.report?.[0]?.plan?.renamed?.[0]?.preview?.migrated;
    if (!previewMigrated) {
      fails.push(`🔴 改名迁移 · dry-run 计划里没有这条改名或没有预览：${JSON.stringify(dryParsed?.report)}`);
    } else {
      if (!previewMigrated.includes("config.json")) fails.push(`改名迁移 · dry-run 没列出 config.json：${JSON.stringify(previewMigrated)}`);
      if (!previewMigrated.includes(join("profiles", "x.json"))) {
        fails.push(`改名迁移 · dry-run 没列出 profiles/x.json：${JSON.stringify(previewMigrated)}`);
      }
      if (previewMigrated.includes(join("themes", "benya-clean.json"))) {
        fails.push(`🔴 改名迁移 · dry-run 把上游新包自带的 themes/benya-clean.json 也列进了搬运清单：${JSON.stringify(previewMigrated)}`);
      }
    }

    const realParsed = parseOrFail(runNode(fx.root, ["--yes", "--json"]), "主线真跑");
    if (realParsed) {
      const targetDir = join(fx.root, ".claude", "skills", "dby-publish");
      if (existsSync(fx.oldDir)) fails.push("🔴 改名迁移 · 真跑完老目录还在（没有归档）");
      if (!existsSync(join(targetDir, "config.json")) || !readFileSync(join(targetDir, "config.json")).equals(originalConfig)) {
        fails.push("🔴 改名迁移 · config.json 搬过去之后内容不是逐字节相同");
      }
      if (
        !existsSync(join(targetDir, "profiles", "x.json")) ||
        !readFileSync(join(targetDir, "profiles", "x.json")).equals(originalProfile)
      ) {
        fails.push("🔴 改名迁移 · profiles/x.json 搬过去之后内容不是逐字节相同");
      }
      const theme = JSON.parse(readFileSync(join(targetDir, "themes", "benya-clean.json"), "utf-8"));
      if (theme.from !== "upstream") fails.push("🔴 改名迁移 · 上游新包自带的 themes/benya-clean.json 被老目录同名文件覆盖了");

      const archiveResult = (realParsed.archived || []).find((a) => a?.count);
      const manifestPath = archiveResult && join(archiveResult.root, "manifest.json");
      const manifest = manifestPath && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf-8")) : null;
      const pkgEntry = manifest?.packages?.find((p) => p.skill === "old-pkg-a");
      if (!pkgEntry) fails.push(`🔴 改名迁移 · 归档 manifest 里没有老包的条目：${JSON.stringify(manifest)}`);
      else if (!/改名为.*dby-publish/.test(pkgEntry.reason || "")) {
        fails.push(`🔴 改名迁移 · manifest 条目的 reason 没说清改名去向：${JSON.stringify(pkgEntry.reason)}`);
      }
    }

    const againParsed = parseOrFail(runNode(fx.root, ["--dry-run", "--json"]), "二次运行");
    if (againParsed && (againParsed.report?.[0]?.plan?.renamed || []).length) {
      fails.push(`🔴 改名迁移 · 二次运行不是幂等的，仍有 renamed 条目：${JSON.stringify(againParsed.report[0].plan.renamed)}`);
    }
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }

  // ── 冲突：新目录已有 config.json → 不覆盖、conflicts 有记录，且不挡住老目录归档 ──────
  const conflictFx = buildRenameFixture({ targetHasConfig: true });
  try {
    const targetConfigBefore = readFileSync(join(conflictFx.targetDir, "config.json"));
    const realParsed = parseOrFail(runNode(conflictFx.root, ["--yes", "--json"]), "冲突场景真跑");
    if (realParsed) {
      const outcome = realParsed.results?.[0]?.renameResults?.[0];
      if (!outcome?.conflicts?.some((c) => c.rel === "config.json")) {
        fails.push(`🔴 改名迁移·冲突 · config.json 已存在却没记进 conflicts：${JSON.stringify(outcome)}`);
      }
      if (existsSync(conflictFx.oldDir)) {
        fails.push("改名迁移·冲突 · 单个文件冲突不该挡住整条老目录的归档");
      }
    }
    if (!readFileSync(join(conflictFx.targetDir, "config.json")).equals(targetConfigBefore)) {
      fails.push("🔴 改名迁移·冲突 · 目标已有的 config.json 被覆盖了——不覆盖是硬红线");
    }
  } finally {
    rmSync(conflictFx.root, { recursive: true, force: true });
  }

  // ── git 跟踪：老目录不搬、不归档，只提示 ────────────────────────────────
  const gitFx = buildRenameFixture({ gitTrackOld: true });
  try {
    const dryParsed = parseOrFail(runNode(gitFx.root, ["--dry-run", "--json"]), "git 跟踪场景 · dry-run");
    const plan = dryParsed?.report?.[0]?.plan;
    if (!plan) {
      fails.push("改名迁移·git 跟踪 · dry-run 没算出计划");
    } else {
      if ((plan.renamed || []).length) fails.push(`🔴 改名迁移·git 跟踪 · 受跟踪的老目录不该进 renamed：${JSON.stringify(plan.renamed)}`);
      if (!(plan.renamedSkipped || []).some((s) => s.from === "old-pkg-a" && s.reason === "tracked")) {
        fails.push(`🔴 改名迁移·git 跟踪 · 没有单列进 renamedSkipped：${JSON.stringify(plan.renamedSkipped)}`);
      }
    }
    if (!existsSync(gitFx.oldDir)) fails.push("🔴 改名迁移·git 跟踪 · dry-run 不该动任何文件，老目录却不见了");

    // 🔴 真跑一遍——这是这条自检最薄的一层冰：判定看着对，真执行起来还是把受跟踪的
    //    老目录搬走了，只有真跑才拦得住。
    parseOrFail(runNode(gitFx.root, ["--yes", "--json"]), "git 跟踪场景 · 真跑");
    if (!existsSync(gitFx.oldDir)) {
      fails.push("🔴 改名迁移·git 跟踪 · 真跑之后受跟踪的老目录被搬走了——这条是防数据丢失红线");
    }
    if (!existsSync(join(gitFx.oldDir, "config.json"))) {
      fails.push("🔴 改名迁移·git 跟踪 · 真跑之后老目录里的用户数据不见了");
    }
  } finally {
    rmSync(gitFx.root, { recursive: true, force: true });
  }

  rmSync(bin, { recursive: true, force: true });
  return fails;
}

/**
 * 🔴 预检刷新栏必须逐项列名：刷新是覆盖安装，用户确认的得是具体清单。造一份 refresh 非空的计划打出来，
 * 断言每个名字都在输出里；顺带钉 --json 里 refresh 是数组（jsonPurityCheck 的 fixture 是收敛态，这里单独造）。
 */
function refreshListCheck() {
  const fails = [];
  // describeRefresh 纯函数：origin 优先 → 哈希在 versions[] 里找 → `?`；legacy（无 versions）时 to=? 且 changelog 是占位句。
  const upstream = {
    versions: {
      "pkg-one": [{ version: "1.1.0", hash: "new1", changelog: "修了封面", changelogSource: "user" }, { version: "1.0.0", hash: "old1" }],
      "pkg-two": [{ version: "2.0.0", hash: "new2", changelog: "契约变更（自动生成）", changelogSource: "auto" }],
    },
  };
  const survey = [
    { name: "pkg-one", hash: "old1" }, // 没 origin，靠哈希在 versions[] 里找到 1.0.0
    { name: "pkg-two", hash: "zzz", origin: { version: "1.9.9", hash: "zzz" } }, // 有 origin，哈希不在 versions[] 里也认
    { name: "pkg-three", hash: "nope" }, // 谁都找不到 ⇒ ?
  ];
  const info = describeRefresh(["pkg-one", "pkg-two", "pkg-three"], survey, upstream);
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`刷新栏 · ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  eq("无 origin 按哈希找旧版", info[0], { slug: "pkg-one", from: "1.0.0", to: "1.1.0", changelog: "修了封面", changelogSource: "user", between: [] });
  // 隔了多版：本机 1.0.0，索引 1.3.0 ← 1.2.0 ← 1.1.0 ← 1.0.0 ⇒ between 列 1.2.0、1.1.0（新→旧），不含当前版与本机版
  const multi = { versions: { far: [
    { version: "1.3.0", hash: "h3", changelog: "三", changelogSource: "user" },
    { version: "1.2.0", hash: "h2", changelog: "二", changelogSource: "auto" },
    { version: "1.1.0", hash: "h1", changelog: "一", changelogSource: "user" },
    { version: "1.0.0", hash: "h0", changelog: "零", changelogSource: "user" },
  ] } };
  const far = describeRefresh(["far"], [{ name: "far", hash: "h0" }], multi)[0];
  eq("🔴 跨多版时列出中间每一版（新→旧）", [far.from, far.to, far.between.map((v) => `${v.version}:${v.changelog}:${v.changelogSource}`)], ["1.0.0", "1.3.0", ["1.2.0:二:auto", "1.1.0:一:user"]]);
  eq("本机版在索引里找不到 ⇒ between 为空", describeRefresh(["far"], [{ name: "far", hash: "hx" }], multi)[0].between, []);
  eq("origin 有版本号但哈希对不上 ⇒ 按版本号定位", describeRefresh(["far"], [{ name: "far", hash: "hx", origin: { version: "1.1.0", hash: "hx" } }], multi)[0].between.map((v) => v.version), ["1.2.0"]);
  eq("有 origin 用 origin 的版本", [info[1].from, info[1].to, info[1].changelogSource], ["1.9.9", "2.0.0", "auto"]);
  eq("找不到旧版显示 ?，索引没这个包时 to 也是 ?", [info[2].from, info[2].to, info[2].changelog], ["?", "?", "（无变更说明）"]);
  eq("legacy（无 versions）时 changelog 是「（无变更说明）」", describeRefresh(["pkg-one"], survey, { versions: null })[0], {
    slug: "pkg-one", from: "?", to: "?", changelog: "（无变更说明）", changelogSource: null, between: [],
  });

  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    printPlan(
      { label: "自检 scope" },
      [],
      { archive: [], add: [], refresh: ["pkg-one", "pkg-two", "pkg-three"], refreshInfo: info, upToDate: [], untouched: [], blocked: [], gitTracked: [], gitUnknown: [] },
      {},
      0
    );
  } finally {
    console.log = original;
  }
  const head = lines.findIndex((l) => l.includes("要刷新 3 个"));
  if (head < 0) return [`预检列名 · 没有「要刷新 N 个」抬头：${JSON.stringify(lines)}`];
  const body = lines.slice(head + 1);
  const line = (n) => body.find((l) => l.includes(`↻ ${n}`));
  for (const n of ["pkg-one", "pkg-two", "pkg-three"]) {
    if (!line(n)) fails.push(`🔴 预检列名 · 刷新栏只报了数、没列出 ${n}：${JSON.stringify(body)}`);
  }
  // 🔴 每行都得有「旧 → 新」和 changelog；auto 来源要标出来，user 来源不许误标
  if (!line("pkg-one")?.includes("1.0.0 → 1.1.0") || !line("pkg-one")?.includes("修了封面")) fails.push(`🔴 刷新栏 · 没打「旧semver → 新semver + changelog」：${line("pkg-one")}`);
  if (line("pkg-one")?.includes("auto")) fails.push(`刷新栏 · user 来源的 changelog 被标成了 auto：${line("pkg-one")}`);
  if (!line("pkg-two")?.includes("auto")) fails.push(`🔴 刷新栏 · auto 占位文案没标注来源：${line("pkg-two")}`);
  if (!line("pkg-three")?.includes("? → ?")) fails.push(`刷新栏 · 找不到版本时该显示 ?：${line("pkg-three")}`);
  return fails;
}

/**
 * 🔴 索引双读：只换 `globalThis.fetch`，让 fetchUpstream 真跑。
 *   ① index.json 200 ⇒ metaSource=index；currentHashes 只含 active 的 versions[0].hash；renamed/merged 变成 renames 表；
 *      knownHashes 含 retired 的闭集；不再请求三份旧文件。
 *   ② index.json 404 ⇒ metaSource=legacy，退回三旧文件，notes 标注。
 *   ③ 索引模式下 Contents API 403 ⇒ namesSource=index、archiveSuppressed=true、结论按 spec 文案；
 *      Contents API 正常 ⇒ namesSource=contents-api、archiveSuppressed=false，且索引说 retired 的目录哪怕还在也不进名单。
 * 前提同 namesSourceAndTokenCheck：进程里没设 DBY_RAW_BASE。
 */
async function indexFetchCheck() {
  const fails = [];
  if (RAW_OVERRIDDEN) return ["索引双读 · 这条自检要在没设 DBY_RAW_BASE 的环境下跑"];
  const calls = [];
  const realFetch = globalThis.fetch;
  const index = {
    schemaVersion: 1,
    ref: "release-20260825-0000",
    skills: {
      dby: { status: "active", knownHashes: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], versions: [{ version: "1.1.0", hash: "bbbbbbbbbbbb", changelog: "x", changelogSource: "user" }] },
      "old-name": { status: "renamed", redirectTo: "dby", userFiles: ["config.json"], knownHashes: ["cccccccccccc"], versions: [] },
      gone: { status: "retired", knownHashes: ["dddddddddddd"], versions: [] },
    },
  };
  const serve = ({ indexStatus, contentsStatus, dirs }) => async (url) => {
    calls.push(url);
    if (url === INDEX_URL) return indexStatus === 200 ? new Response(JSON.stringify(index), { status: 200 }) : new Response("nope", { status: indexStatus });
    if (url === CONTENTS_API) {
      return contentsStatus === 200 ? new Response(JSON.stringify(dirs.map((name) => ({ type: "dir", name }))), { status: 200 }) : new Response("rate limited", { status: contentsStatus });
    }
    if (url === VERSIONS_URL) return new Response(JSON.stringify({ ref: "release-legacy", skills: { dby: "doubaoya-skill/dby@aaaaaaaaaaaa" } }), { status: 200 });
    if (url === KNOWN_URL) return new Response(JSON.stringify({ skills: { dby: ["aaaaaaaaaaaa"] } }), { status: 200 });
    return new Response("nope", { status: 404 });
  };
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`索引双读 · ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  try {
    // ① 索引在
    globalThis.fetch = serve({ indexStatus: 200, contentsStatus: 200, dirs: ["dby", "gone", "fresh"] });
    const idx = await fetchUpstream();
    eq("metaSource", idx.metaSource, "index");
    eq("currentHashes 只含 active 的当前版", idx.currentHashes, { dby: "bbbbbbbbbbbb" });
    eq("knownHashes 含 retired / renamed 的闭集", Object.keys(idx.knownHashes).sort(), ["dby", "gone", "old-name"]);
    eq("renamed 条目变成 renames 表", idx.renames, { "old-name": { to: "dby", userFiles: ["config.json"] } });
    eq("status 表", idx.status, { dby: "active", "old-name": "renamed", gone: "retired" });
    eq("ref 取索引顶层", idx.ref, "release-20260825-0000");
    eq("namesSource", idx.namesSource, "contents-api");
    eq("archiveSuppressed", idx.archiveSuppressed, false);
    eq("🔴 索引标 retired 的目录哪怕还在上游也不进名单（否则归档完又装回来）", idx.names, ["dby", "fresh"]);
    if (calls.some((u) => u === VERSIONS_URL || u === KNOWN_URL || u === RENAMES_URL)) fails.push(`索引双读 · 索引在的时候还去拉了旧文件：${JSON.stringify(calls)}`);

    // ③ 索引在、目录 403 ⇒ fail-closed 只压归档
    calls.length = 0;
    globalThis.fetch = serve({ indexStatus: 200, contentsStatus: 403 });
    const held = await fetchUpstream();
    eq("目录 403 时 namesSource", held.namesSource, "index");
    eq("🔴 目录 403 时 archiveSuppressed", held.archiveSuppressed, true);
    eq("目录 403 时名单 = 索引 active", held.names, ["dby"]);
    if (!held.notes.some((n) => n.includes("不做任何归档"))) fails.push(`索引双读 · 目录 403 的提示没说「不归档」：${JSON.stringify(held.notes)}`);
    eq("目录 403 的结论文案", convergedConclusion("index"), "结论：无需任何操作——按索引对账，上游目录未能核对，本轮不归档。");

    // 索引 active 但目录里没有 ⇒ 只出 note
    globalThis.fetch = serve({ indexStatus: 200, contentsStatus: 200, dirs: ["fresh"] });
    const drift = await fetchUpstream();
    if (!drift.notes.some((n) => n.includes("索引与目录不一致") && n.includes("dby"))) fails.push(`索引双读 · active 却缺目录没出「索引与目录不一致」提示：${JSON.stringify(drift.notes)}`);

    // ② 索引 404 ⇒ legacy
    calls.length = 0;
    globalThis.fetch = serve({ indexStatus: 404, contentsStatus: 200, dirs: ["dby"] });
    const legacy = await fetchUpstream();
    eq("🔴 索引 404 时 metaSource", legacy.metaSource, "legacy");
    eq("legacy 的 currentHashes 来自 versions.json", legacy.currentHashes, { dby: "aaaaaaaaaaaa" });
    eq("legacy 的 ref 来自 versions.json", legacy.ref, "release-legacy");
    eq("legacy 没有 status / versions", [legacy.status, legacy.versions], [null, null]);
    if (!legacy.notes.some((n) => n.includes("legacy"))) fails.push(`索引双读 · 退回旧文件没在 notes 标注 legacy：${JSON.stringify(legacy.notes)}`);
    if (!calls.includes(VERSIONS_URL) || !calls.includes(KNOWN_URL)) fails.push(`索引双读 · 索引 404 后没去拉旧文件：${JSON.stringify(calls)}`);
  } catch (err) {
    fails.push(`索引双读 · 自检自身抛错：${err?.message || err}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  // 归档只依据显式状态（纯函数三例）
  const installed = [
    { name: "gone", state: "historical" },
    { name: "active-missing", state: "historical" },
    { name: "dby", state: "current" },
  ];
  const status = { gone: "retired", "active-missing": "active", dby: "active" };
  const byStatus = planReconcile(installed, ["dby"], { status });
  eq("索引标 retired 且命中闭集 ⇒ 归档", byStatus.archive, ["gone"]);
  eq("🔴 索引 active 但目录缺失 ⇒ 不归档，单列 inconsistent", [byStatus.inconsistent, byStatus.refresh], [["active-missing"], []]);
  const suppressed = planReconcile(installed, ["dby"], { status, archiveSuppressed: true });
  eq("🔴 目录没核到 ⇒ archive 为空", suppressed.archive, []);
  eq("目录没核到 ⇒ 归档候选进 archiveHeld", suppressed.archiveHeld, ["gone"]);
  const stillRefresh = planReconcile([{ name: "dby", state: "historical" }], ["dby"], { status, archiveSuppressed: true });
  eq("目录没核到 ⇒ 刷新照常", stillRefresh.refresh, ["dby"]);
  eq("目录没核到 ⇒ 新增照常", planReconcile([], ["dby"], { status, archiveSuppressed: true }).add, ["dby"]);
  // 没 status（legacy）⇒ 老的缺席推断原样保留
  eq("legacy 仍按名单缺席归档", planReconcile(installed, ["dby"], {}).archive, ["active-missing", "gone"]);
  return fails;
}

/**
 * 🔴 名单来源三态 + 令牌：不 mock 我们自己的代码，只把 `globalThis.fetch` 换成一个假服务器，让 fetchUpstream 真跑：
 *   ① Contents API 403 ⇒ namesSource=versions，notes 说清目录没核到；
 *   ② Contents API 正常 ⇒ namesSource=contents-api；
 *   ③ rawOverridden ⇒ namesSource=override，且根本不请求 Contents API；
 *   ④ 有 GITHUB_TOKEN 时只有 api.github.com 那一发带 Authorization，raw 不带；没令牌一发都不带；
 *   ⑤ 令牌字符串不许出现在 notes / 报错 / 结论里。
 * 前提：进程里没设 DBY_RAW_BASE（设了 fetchJson 会走读文件那条路，假 fetch 挂不上）。
 */
async function namesSourceAndTokenCheck() {
  const fails = [];
  if (RAW_OVERRIDDEN) return ["名单来源 · 这条自检要在没设 DBY_RAW_BASE 的环境下跑"];
  const token = "ghp_selfcheck_FAKE_TOKEN_0123456789";
  const calls = [];
  const realFetch = globalThis.fetch;
  const serve = (contentsStatus) => async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization || null });
    if (url === CONTENTS_API) {
      return contentsStatus === 200
        ? new Response(JSON.stringify([{ type: "dir", name: "dby" }, { type: "file", name: "README.md" }]), { status: 200 })
        : new Response("rate limited", { status: contentsStatus });
    }
    if (url === VERSIONS_URL) return new Response(JSON.stringify({ ref: "release-20260101-0000", skills: { dby: "doubaoya-skill/dby@aaaaaaaaaaaa" } }), { status: 200 });
    if (url === KNOWN_URL) return new Response(JSON.stringify({ skills: { dby: ["aaaaaaaaaaaa"] } }), { status: 200 });
    return new Response("nope", { status: 404 });
  };
  const savedToken = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
  try {
    process.env.GITHUB_TOKEN = token;
    delete process.env.GH_TOKEN;

    // ① 403 ⇒ versions
    globalThis.fetch = serve(403);
    const degraded = await fetchUpstream();
    if (degraded.namesSource !== "versions") fails.push(`🔴 名单来源 · Contents API 403 时应为 versions，实际 ${degraded.namesSource}`);
    if (!degraded.notes.some((n) => n.includes("目录列表拉不到"))) fails.push(`名单来源 · 降级没进 notes：${JSON.stringify(degraded.notes)}`);
    if (degraded.ref !== "release-20260101-0000") fails.push(`安装源 · 没读到版本表的 ref：${JSON.stringify(degraded.ref)}`);
    const conclusion = convergedConclusion(degraded.namesSource);
    if (conclusion.includes("完全一致") || !conclusion.includes("未能核对")) fails.push(`🔴 名单来源 · 降级态的结论仍在说「完全一致」：${conclusion}`);
    if (!convergedConclusion("contents-api").includes("完全一致")) fails.push("名单来源 · 正常态的结论丢了「完全一致」");
    // ④⑤ 令牌只进 api.github.com 那一发；任何输出里不许出现
    const apiCall = calls.find((c) => c.url === CONTENTS_API);
    if (apiCall?.auth !== `Bearer ${token}`) fails.push(`🔴 令牌 · api.github.com 的请求没带 Authorization: Bearer：${JSON.stringify(apiCall)}`);
    for (const c of calls.filter((c) => c.url !== CONTENTS_API)) {
      if (c.auth) fails.push(`🔴 令牌 · raw 请求也带上了令牌（多一处泄漏面）：${c.url}`);
    }
    const leak = JSON.stringify([degraded.notes, conclusion]);
    if (leak.includes(token)) fails.push(`🔴 令牌 · 出现在输出里：${leak}`);

    // ② 正常 ⇒ contents-api
    calls.length = 0;
    globalThis.fetch = serve(200);
    const fine = await fetchUpstream();
    if (fine.namesSource !== "contents-api") fails.push(`🔴 名单来源 · Contents API 正常时应为 contents-api，实际 ${fine.namesSource}`);
    if (JSON.stringify(fine.names) !== JSON.stringify(["dby"])) fails.push(`名单来源 · 目录名单不对：${JSON.stringify(fine.names)}`);

    // ③ override ⇒ 不碰 Contents API
    calls.length = 0;
    const over = await fetchUpstream({ rawOverridden: true });
    if (over.namesSource !== "override") fails.push(`🔴 名单来源 · rawOverridden 时应为 override，实际 ${over.namesSource}`);
    if (calls.some((c) => c.url === CONTENTS_API)) fails.push("名单来源 · override 态不该请求 Contents API");

    // 没令牌 ⇒ 一发都不带；GH_TOKEN 也认
    delete process.env.GITHUB_TOKEN;
    if (githubAuthHeader(CONTENTS_API).Authorization) fails.push("令牌 · 没设令牌却带了 Authorization");
    if (githubAuthHeader(CONTENTS_API, { GH_TOKEN: "x" }).Authorization !== "Bearer x") fails.push("令牌 · GH_TOKEN 没被认");
    if (githubAuthHeader(VERSIONS_URL, { GITHUB_TOKEN: "x" }).Authorization) fails.push("令牌 · raw 域名不该带令牌");
  } catch (err) {
    fails.push(`名单来源 · 自检自身抛错：${err?.message || err}`);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(savedToken)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  // 子进程整条链路：假令牌在环境里，dry-run 的 stdout/stderr 里一个字都不许有它
  const root = mkdtempSync(join(tmpdir(), "dby-token-selfcheck-"));
  try {
    writeFileSync(join(root, "versions.json"), JSON.stringify({ skills: { "some-skill": "doubaoya-skill/some-skill@aaaaaaaaaaaa" } }));
    writeFileSync(join(root, "known-hashes.json"), JSON.stringify({ skills: { "some-skill": ["aaaaaaaaaaaa"] } }));
    const res = spawnSync(
      process.execPath,
      [SELF_PATH, "--dry-run", "--json", "--scope", "project", "--project-dir", root],
      { encoding: "utf-8", env: { ...process.env, DBY_RAW_BASE: root, GITHUB_TOKEN: token, GH_TOKEN: token } }
    );
    const out = `${res.stdout}\n${res.stderr}`;
    if (out.includes(token)) fails.push("🔴 令牌 · 子进程输出里出现了令牌");
    const parsed = res.status === 0 ? JSON.parse(res.stdout) : null;
    if (parsed?.namesSource !== "override") fails.push(`名单来源 · --json 顶层 namesSource 应为 override，实际 ${JSON.stringify(parsed?.namesSource)}`);
    if (parsed && parsed.installRef !== null) fails.push(`安装源 · 版本表没 ref 时 installRef 应为 null，实际 ${JSON.stringify(parsed.installRef)}`);
    if (parsed && !parsed.notes.some((n) => n.includes("安装源未固定"))) fails.push(`安装源 · 没 ref 时 notes 该标「安装源未固定」：${JSON.stringify(parsed?.notes)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 安装源固定 + 自更新提示，整条链路真跑（假 npx 记下收到的参数）：
 *   有 ref ⇒ `skills add` 的包参数是 `<repo>#<ref>`、--json 带 installRef；无 ref ⇒ 包参数是裸 repo。
 *   刷新名单含 dby-update ⇒ selfUpdated=true 且文案提示重跑；不含 ⇒ false 且无提示。
 */
function installRefAndSelfUpdateCheck() {
  const fails = [];
  if (installSource("release-1") !== `${REPO}#release-1`) fails.push(`安装源 · 有 ref 时包参数应为 ${REPO}#release-1，实际 ${installSource("release-1")}`);
  if (installSource(null) !== REPO) fails.push(`安装源 · 无 ref 时包参数应为 ${REPO}，实际 ${installSource(null)}`);

  const { bin, marker } = stubNpxDir();
  const build = (name, ref) => {
    const root = mkdtempSync(join(tmpdir(), "dby-ref-selfcheck-"));
    const pkg = join(root, ".claude", "skills", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), `---\nname: ${name}\n---\n`);
    const mine = computeSkillHash(pkg);
    const other = mine === "0".repeat(12) ? "1".repeat(12) : "0".repeat(12);
    writeFileSync(join(root, "versions.json"), JSON.stringify({ ...(ref ? { ref } : {}), skills: { [name]: `doubaoya-skill/${name}@${other}` } }));
    writeFileSync(join(root, "known-hashes.json"), JSON.stringify({ skills: { [name]: [mine, other] } }));
    return root;
  };
  const run = (root, args) =>
    spawnSync(process.execPath, [SELF_PATH, "--yes", "--scope", "project", "--project-dir", root, ...args], {
      encoding: "utf-8",
      env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` },
    });
  const parse = (res, label) => {
    try {
      return JSON.parse(res.stdout);
    } catch (err) {
      fails.push(`${label} · stdout 不是 JSON（${err.message}）：${(res.stderr || "").trim().split("\n").pop()}`);
      return null;
    }
  };
  const withRef = build("dby-update", "release-20260101-0000");
  const noRef = build("other-skill", null);
  try {
    const a = parse(run(withRef, ["--json"]), "安装源·有 ref");
    const called = existsSync(marker) ? readFileSync(marker, "utf-8") : "";
    if (!called.includes(`add ${REPO}#release-20260101-0000`)) fails.push(`🔴 安装源 · 有 ref 时 skills add 没固定到 tag：${JSON.stringify(called.trim())}`);
    if (a && a.installRef !== "release-20260101-0000") fails.push(`安装源 · --json installRef 不对：${JSON.stringify(a?.installRef)}`);
    if (a && a.selfUpdated !== true) fails.push(`🔴 自更新 · 刷新名单含 dby-update 时 selfUpdated 应为 true：${JSON.stringify(a?.selfUpdated)}`);
    const text = run(withRef, []);
    if (!/再跑一次/.test(text.stdout)) fails.push(`🔴 自更新 · 结尾没提示重跑：${JSON.stringify(text.stdout.slice(-300))}`);

    rmSync(marker, { force: true });
    const b = parse(run(noRef, ["--json"]), "安装源·无 ref");
    const called2 = existsSync(marker) ? readFileSync(marker, "utf-8") : "";
    if (!called2.includes(`add ${REPO} `)) fails.push(`🔴 安装源 · 无 ref 时包参数该是裸 repo：${JSON.stringify(called2.trim())}`);
    if (b && b.installRef !== null) fails.push(`安装源 · 无 ref 时 installRef 应为 null：${JSON.stringify(b?.installRef)}`);
    if (b && b.selfUpdated !== false) fails.push(`自更新 · 名单不含 dby-update 时 selfUpdated 应为 false：${JSON.stringify(b?.selfUpdated)}`);
    const text2 = run(noRef, []);
    if (/再跑一次/.test(text2.stdout)) fails.push("自更新 · 名单不含 dby-update 却提示了重跑");
  } finally {
    for (const d of [withRef, noRef, bin]) rmSync(d, { recursive: true, force: true });
  }
  return fails;
}

/** restoreArchive 直接钉：归档 → 复原，目录回到原处，跨设备退回那条走 moveDir 与归档同一段代码。 */
function restoreArchiveCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-restore-selfcheck-"));
  try {
    const skillsDir = join(root, ".claude", "skills");
    for (const name of ["a-pkg", "b-pkg"]) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
    }
    const scope = { kind: "project", dir: root, label: "自检" };
    const dirs = [{ label: ".claude/skills", path: skillsDir }];
    const survey = ["a-pkg", "b-pkg"].map((name) => ({ name, hash: "x", state: "historical", dirs }));
    const archived = archivePackages(scope, ["a-pkg", "b-pkg"], survey);
    if (existsSync(join(skillsDir, "a-pkg"))) return ["复原 · fixture 前提不成立：归档没搬走"];
    const r = restoreArchive(archived.root);
    if (JSON.stringify(r.restored.sort()) !== JSON.stringify(["a-pkg", "b-pkg"])) fails.push(`🔴 复原 · 没把两个都搬回来：${JSON.stringify(r)}`);
    for (const name of ["a-pkg", "b-pkg"]) {
      if (!existsSync(join(skillsDir, name, "SKILL.md"))) fails.push(`🔴 复原 · ${name} 没回到原处`);
    }
    // 幂等：再复原一次没东西可搬，不报错
    const again = restoreArchive(archived.root);
    if (again.restored.length || again.skipped.length) fails.push(`复原 · 二次复原不该再动：${JSON.stringify(again)}`);
    // 同一秒内两次归档不许撞同一个根（manifest 会被盖掉）
    const r1 = archivePackages(scope, ["a-pkg"], survey);
    const r2 = archivePackages(scope, ["b-pkg"], survey);
    if (r1.root === r2.root) fails.push(`🔴 归档根 · 同一秒内两次归档撞到同一个根，manifest 互相覆盖：${r1.root}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 origin / lock / pin 全链路实证，真读真写：
 *   4.1 装完（假 npx 真把新内容写进目录）`<skill>/.dby/origin.json` 在场，hash = 索引 versions[0].hash，且目录哈希不因这个文件改变；
 *   4.2 scope 根 `.dby/lock.json` 条数与 origin 一致、字段一致；
 *   4.3 用户把文件改回**恰好命中闭集**的历史版：origin 在场 ⇒ 仍判 modified（闭集会说 historical，那是错的）；
 *   4.4 --pin 后上游再出新版：预检单列「已固定」并带原因、执行后目录不动、npx 没收到它；--unpin 后恢复刷新。
 */
/**
 * origin 补录：不是对账器装的、但哈希能对上索引某一版 ⇒ 补 origin；对不上的不补。
 */
function backfillOriginCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-backfill-selfcheck-"));
  try {
    const mk = (name, body) => {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "SKILL.md"), body);
      return d;
    };
    const known = mk("known-pkg", "---\nname: known-pkg\n---\n");
    const stranger = mk("odd-pkg", "---\nname: odd-pkg\n---\n");
    const kh = computeSkillHash(known);
    const upstream = { ref: "release-x", versions: { "known-pkg": [{ version: "2.0.0", hash: kh }], "odd-pkg": [{ version: "1.0.0", hash: "000000000000" }] } };
    const dirs = [{ label: ".claude/skills", path: root }];
    const survey = [
      { name: "known-pkg", hash: kh, state: "current", origin: null, dirs },
      { name: "odd-pkg", hash: computeSkillHash(stranger), state: "modified", origin: null, dirs },
    ];
    const n = backfillOrigins({ kind: "project", dir: root }, survey, upstream);
    if (n !== 1) fails.push(`origin 补录 · 应补 1 个，实际 ${n}`);
    const o = readOrigin(known);
    if (!o || o.hash !== kh || o.version !== "2.0.0") fails.push(`origin 补录 · known-pkg 的 origin 不对：${JSON.stringify(o)}`);
    if (readOrigin(stranger)) fails.push("origin 补录 · 哈希对不上任何一版的包不该被补 origin");
    if (computeSkillHash(known) !== kh) fails.push("origin 补录 · 写 origin 改变了目录哈希");
    if (backfillOrigins({ kind: "project", dir: root }, survey.map((s) => ({ ...s, origin: s.name === "known-pkg" ? o : null })), upstream) !== 0) fails.push("origin 补录 · 二次运行应为 0（幂等）");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return fails;
}

function originLockPinCheck() {
  const fails = [];
  const root = mkdtempSync(join(tmpdir(), "dby-origin-selfcheck-"));
  const bin = mkdtempSync(join(tmpdir(), "dby-origin-npx-"));
  const marker = join(bin, "called.log");
  const pkg = join(root, ".claude", "skills", "some-skill");
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`origin/lock/pin · ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  try {
    const OLD = "---\nname: some-skill\n---\nv1\n";
    const NEW = "---\nname: some-skill\n---\nv2\n";
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), OLD);
    const oldHash = computeSkillHash(pkg);
    writeFileSync(join(pkg, "SKILL.md"), NEW);
    const newHash = computeSkillHash(pkg);
    writeFileSync(join(pkg, "SKILL.md"), OLD);
    // 假 npx：add 时真把"新版内容"写进目录（模拟 skills CLI 落盘），其余只记参数。
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "$@" >> '${marker}'\ncase " $* " in *" add "*) printf -- '${NEW.replace(/\n/g, "\\n")}' > '${join(pkg, "SKILL.md")}';; esac\nexit 0\n`,
      { mode: 0o755 }
    );
    const writeIndex = (versions) =>
      writeFileSync(
        join(root, "index.json"),
        JSON.stringify({ schemaVersion: 1, ref: "release-x", skills: { "some-skill": { status: "active", knownHashes: [oldHash, newHash, "ffffffffffff"], versions } } })
      );
    writeIndex([{ version: "1.1.0", hash: newHash, changelog: "第二版", changelogSource: "user" }, { version: "1.0.0", hash: oldHash, changelog: "首版", changelogSource: "auto" }]);
    const run = (args) =>
      spawnSync(process.execPath, [SELF_PATH, "--scope", "project", "--project-dir", root, ...args], {
        encoding: "utf-8",
        env: { ...process.env, DBY_RAW_BASE: root, PATH: `${bin}:${process.env.PATH}` },
      });
    const parse = (res, label) => {
      try {
        return JSON.parse(res.stdout);
      } catch (err) {
        fails.push(`origin/lock/pin · ${label} 的 stdout 不是 JSON（${err.message}）：${(res.stderr || "").trim().split("\n").pop()}`);
        return null;
      }
    };

    // 预检：刷新栏带版本号与 changelog（无 origin ⇒ 旧版靠哈希在 versions[] 里找到 1.0.0）
    const pre = parse(run(["--dry-run", "--json"]), "预检");
    eq("--json refresh 是对象数组", pre?.report?.[0]?.plan?.refresh, [{ slug: "some-skill", from: "1.0.0", to: "1.1.0", changelog: "第二版", changelogSource: "user", between: [] }]);
    eq("metaSource=index", pre?.metaSource, "index");
    const preText = run(["--dry-run"]).stdout;
    if (!preText.includes("some-skill  1.0.0 → 1.1.0  第二版")) fails.push(`🔴 预检刷新栏没打「slug 旧 → 新 changelog」：${JSON.stringify(preText.slice(-500))}`);

    // 4.1 装完写 origin，且不影响目录哈希
    parse(run(["--yes", "--json"]), "首次刷新");
    const originPath = join(pkg, ".dby", "origin.json");
    if (!existsSync(originPath)) fails.push("🔴 origin · 刷新后 <skill>/.dby/origin.json 没写");
    const origin = readOrigin(pkg);
    eq("origin.hash = 索引 versions[0].hash", origin?.hash, newHash);
    eq("origin.version", origin?.version, "1.1.0");
    eq("origin.slug / ref", [origin?.slug, origin?.ref], ["some-skill", "release-x"]);
    if (!origin?.installedAt) fails.push("origin · 没写 installedAt");
    eq("🔴 目录哈希不因 .dby/origin.json 改变", computeSkillHash(pkg), newHash);
    // 4.2 lock 与 origin 一致
    const lock = readLock({ kind: "project", dir: root });
    eq("lock 条数 = origin 条数", Object.keys(lock.skills), ["some-skill"]);
    eq("lock 条目与 origin 一致", [lock.skills["some-skill"]?.version, lock.skills["some-skill"]?.hash, lock.skills["some-skill"]?.installedAt], [origin?.version, origin?.hash, origin?.installedAt]);
    if (!existsSync(join(root, ".dby", ".gitignore"))) fails.push("lock · 项目根 .dby/ 没自忽略，会冒进用户 git status");
    // 收敛：再跑是零动作
    const again = parse(run(["--dry-run", "--json"]), "收敛态");
    eq("装完再跑零动作", [again?.report?.[0]?.plan?.refresh, again?.report?.[0]?.plan?.upToDate], [[], ["some-skill"]]);

    // 4.3 改回恰好命中闭集的历史版：origin 说不是它装的那份 ⇒ modified
    writeFileSync(join(pkg, "SKILL.md"), OLD);
    eq("🔴 纯函数：origin 在场时哈希撞闭集仍是 modified", classify("some-skill", oldHash, { "some-skill": newHash }, { "some-skill": [oldHash, newHash] }, origin), "modified");
    eq("纯函数：没 origin 时退回闭集 ⇒ historical", classify("some-skill", oldHash, { "some-skill": newHash }, { "some-skill": [oldHash, newHash] }, null), "historical");
    const touched = parse(run(["--dry-run", "--json"]), "改过后");
    eq("🔴 全链路：改回历史版仍判「你改过」，不进刷新单", [touched?.report?.[0]?.survey?.[0]?.state, touched?.report?.[0]?.plan?.refresh], ["modified", []]);
    writeFileSync(join(pkg, "SKILL.md"), NEW);

    // 4.4 pin：上游再出新版，被 pin 的不动
    writeIndex([{ version: "1.2.0", hash: "ffffffffffff", changelog: "第三版", changelogSource: "user" }, { version: "1.1.0", hash: newHash }, { version: "1.0.0", hash: oldHash }]);
    const pinRes = run(["--pin", "some-skill", "--reason", "自己要留着这版"]);
    if (pinRes.status !== 0) fails.push(`pin · 子命令跑挂了（退出码 ${pinRes.status}）：${(pinRes.stderr || "").trim()}`);
    eq("pin 记进 lock", [readLock({ kind: "project", dir: root }).skills["some-skill"]?.pinned, readLock({ kind: "project", dir: root }).skills["some-skill"]?.pinReason], [true, "自己要留着这版"]);
    const pinnedPlan = parse(run(["--dry-run", "--json"]), "pin 后预检")?.report?.[0]?.plan;
    eq("🔴 pin 后不进刷新单", pinnedPlan?.refresh, []);
    eq("pin 后单列一栏并带原因", pinnedPlan?.pinned, [{ name: "some-skill", state: "historical", hash: newHash, reason: "自己要留着这版" }]);
    eq("pin 的不能被当成缺失重新装", pinnedPlan?.add, []);
    const pinnedText = run(["--dry-run"]).stdout;
    if (!pinnedText.includes("已固定") || !pinnedText.includes("自己要留着这版")) fails.push(`🔴 pin · 预检没打「已固定、不动」栏或没带原因：${JSON.stringify(pinnedText.slice(-400))}`);
    rmSync(marker, { force: true });
    parse(run(["--yes", "--json"]), "pin 后真跑");
    eq("🔴 pin 后执行目录哈希不变", computeSkillHash(pkg), newHash);
    if (existsSync(marker) && readFileSync(marker, "utf-8").includes("some-skill")) fails.push(`🔴 pin · 执行时 npx 还是收到了被固定的包：${readFileSync(marker, "utf-8").trim()}`);
    eq("真跑重建 lock 后 pin 原样继承", readLock({ kind: "project", dir: root }).skills["some-skill"]?.pinned, true);
    // unpin
    const unpinRes = run(["--unpin", "some-skill"]);
    if (unpinRes.status !== 0) fails.push(`unpin · 子命令跑挂了（退出码 ${unpinRes.status}）：${(unpinRes.stderr || "").trim()}`);
    const afterUnpin = readLock({ kind: "project", dir: root }).skills["some-skill"];
    if (!afterUnpin || "pinned" in afterUnpin || "pinReason" in afterUnpin) fails.push(`unpin · lock 里还留着 pinned/pinReason：${JSON.stringify(afterUnpin)}`);
    const unpinnedPlan = parse(run(["--dry-run", "--json"]), "unpin 后预检")?.report?.[0]?.plan;
    eq("🔴 unpin 后恢复刷新", unpinnedPlan?.refresh?.map((r) => r.slug), ["some-skill"]);
    eq("unpin 后刷新栏的旧版来自 origin", [unpinnedPlan?.refresh?.[0]?.from, unpinnedPlan?.refresh?.[0]?.to], ["1.1.0", "1.2.0"]);
    // pin 一个没装的包要报错，不能默默写一条
    if (run(["--pin", "not-installed"]).status === 0) fails.push("pin · 固定一个没装的包居然成功了");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
  return fails;
}

/**
 * 🔴 Gitee 镜像回退（spec `mirror-fallback-gitee`），只换 `globalThis.fetch` 让 fetchUpstream 真跑：
 *   ① GitHub 三处正常 ⇒ 一次都不碰 gitee.com，sources 三项 github；
 *   ② 目录 403、Gitee 目录正常（镜像索引 ref 与 GitHub 相同）⇒ namesSource=contents-api、sources.names=gitee、不压归档、提示含「改用 Gitee 镜像」；
 *   ③ 索引在 GitHub 拉不到（网络错）⇒ 先 main 再按 ref 复核，metaSource=index、sources.meta=gitee、结论标「仅镜像」；
 *   ④ 两源目录都失败 ⇒ archiveSuppressed=true，与现状一致；
 *   ⑤ 404 不换源（索引 404 直接退 legacy，不请求 Gitee 索引）；
 *   ⑥ 主备 ref 不同 ⇒ 抛 mirrorMismatch {github:A, gitee:B}；镜像 main 与 tag 不一致同样拦住。
 * 再起子进程（`--import` 预载假 fetch）钉全链路：mismatch 时退出非 0、stdout 纯 JSON 带 mirrorMismatch、磁盘不动；
 * clone 回退：假 npx 第一次（GitHub）抛错、第二次（Gitee URL#ref）成功，sources.install=gitee 且 origin.hash = 索引当前版；无 ref 不重试。
 */
async function mirrorFallbackCheck() {
  const fails = [];
  if (RAW_OVERRIDDEN) return ["镜像回退 · 这条自检要在没设 DBY_RAW_BASE 的环境下跑"];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`镜像回退 · ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  const REF = "release-20260825-0000";
  const index = (ref) => ({
    schemaVersion: 1,
    ref,
    skills: { dby: { status: "active", knownHashes: ["aaaaaaaaaaaa"], versions: [{ version: "1.0.0", hash: "aaaaaaaaaaaa" }] }, gone: { status: "retired", knownHashes: ["dddddddddddd"], versions: [] } },
  });
  const b64 = (obj) => ({ encoding: "base64", content: Buffer.from(JSON.stringify(obj)).toString("base64") });
  const GITEE_INDEX_MAIN = GITEE.file("index.json").url;
  const GITEE_INDEX_TAG = GITEE.file("index.json", REF).url;
  const GITEE_DIR = GITEE.listDir().url;
  // routes: url → {status, body} | {throw:true}；没配的一律 404
  const serve = (routes, calls) => async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404 });
    if (r.throw) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    return new Response(JSON.stringify(r.body ?? ""), { status: r.status ?? 200 });
  };
  const ghOk = {
    [INDEX_URL]: { body: index(REF) },
    [CONTENTS_API]: { body: [{ type: "dir", name: "dby" }, { type: "dir", name: "gone" }] },
  };
  const giteeOk = {
    [GITEE_INDEX_MAIN]: { body: b64(index(REF)) },
    [GITEE_INDEX_TAG]: { body: b64(index(REF)) },
    [GITEE_DIR]: { body: [{ type: "dir", name: "dby" }, { type: "dir", name: "mirror-only" }] },
  };
  const realFetch = globalThis.fetch;
  try {
    // ① GitHub 正常 ⇒ 不碰 Gitee
    let calls = [];
    globalThis.fetch = serve({ ...ghOk, ...giteeOk }, calls);
    const fine = await fetchUpstream();
    eq("GitHub 正常时 sources 三项 github", fine.sources, { meta: "github", names: "github", install: "github" });
    if (calls.some((u) => u.includes("gitee.com"))) fails.push(`🔴 镜像回退 · GitHub 正常却请求了 Gitee：${JSON.stringify(calls)}`);

    // ② 目录 403 ⇒ 名单取自 Gitee（先核镜像索引 ref 与 GitHub 同）
    calls = [];
    globalThis.fetch = serve({ ...ghOk, [CONTENTS_API]: { status: 403 }, ...giteeOk }, calls);
    const names = await fetchUpstream();
    eq("🔴 目录 403 ⇒ namesSource 仍是 contents-api", names.namesSource, "contents-api");
    eq("目录 403 ⇒ sources.names=gitee，其余 github", names.sources, { meta: "github", names: "gitee", install: "github" });
    eq("目录 403 ⇒ 归档不压制", names.archiveSuppressed, false);
    eq("名单来自 Gitee 目录（retired 的照样剔除）", names.names, ["dby", "mirror-only"]);
    if (!names.notes.some((n) => n.includes("改用 Gitee 镜像"))) fails.push(`镜像回退 · 目录回退没在提示里标「改用 Gitee 镜像」：${JSON.stringify(names.notes)}`);
    if (!calls.includes(GITEE_INDEX_MAIN)) fails.push("镜像回退 · 用镜像目录前没核镜像索引 ref");
    if (calls.includes(GITEE_INDEX_TAG)) fails.push("镜像回退 · GitHub 索引已在场时不该再去复核镜像 tag（多一次请求）");

    // ②b 目录 403 + 镜像比 GitHub main 新、且那个 tag 在 GitHub 上已存在 ⇒ 只是 raw 缓存滞后：不 mismatch，按旧 ref 对账，归档压制
    calls = [];
    const NEWER = "release-20260825-0100";
    const GH_AT_TAG = `https://raw.githubusercontent.com/${REPO}/${NEWER}/index.json`;
    globalThis.fetch = serve({ ...ghOk, [CONTENTS_API]: { status: 403 }, [GITEE_INDEX_MAIN]: { body: b64(index(NEWER)) }, [GH_AT_TAG]: { body: index(NEWER) }, [GITEE_DIR]: giteeOk[GITEE_DIR] }, calls);
    let lag;
    try {
      lag = await fetchUpstream();
    } catch (err) {
      fails.push(`🔴 镜像回退 · raw 缓存滞后被当成 mismatch 拦死了：${err.message}`);
    }
    if (lag) {
      eq("缓存滞后 ⇒ 仍按 GitHub main 的旧 ref 对账", lag.ref, REF);
      eq("缓存滞后 ⇒ 镜像目录不用，归档压制", lag.archiveSuppressed, true);
      eq("缓存滞后 ⇒ sources.names 不是 gitee", lag.sources.names === "gitee", false);
      if (!lag.notes.some((n) => n.includes("缓存滞后"))) fails.push(`镜像回退 · 滞后没在提示里说明：${JSON.stringify(lag.notes)}`);
      if (!calls.includes(GH_AT_TAG)) fails.push("镜像回退 · 判滞后前没去 GitHub 按 tag 复核");
    }
    // ②c 镜像比 GitHub 新、但那个 tag 在 GitHub 上不存在 ⇒ 真 mismatch
    calls = [];
    globalThis.fetch = serve({ ...ghOk, [CONTENTS_API]: { status: 403 }, [GITEE_INDEX_MAIN]: { body: b64(index(NEWER)) }, [GITEE_DIR]: giteeOk[GITEE_DIR] }, calls);
    let realMismatch = null;
    try {
      await fetchUpstream();
    } catch (err) {
      realMismatch = err;
    }
    if (!realMismatch?.mirrorMismatch) fails.push("🔴 镜像回退 · 镜像领先且 GitHub 无该 tag 时应判 mismatch");

    // ③ 索引在 GitHub 网络错 ⇒ 先 main 再按 ref 复核，仅镜像
    calls = [];
    globalThis.fetch = serve({ ...ghOk, [INDEX_URL]: { throw: true }, ...giteeOk }, calls);
    const meta = await fetchUpstream();
    eq("🔴 索引回退 ⇒ metaSource=index", meta.metaSource, "index");
    eq("索引回退 ⇒ sources.meta=gitee", meta.sources, { meta: "gitee", names: "github", install: "github" });
    eq("索引回退 ⇒ ref 取自镜像索引", meta.ref, REF);
    if (!calls.includes(GITEE_INDEX_MAIN) || !calls.includes(GITEE_INDEX_TAG)) fails.push(`🔴 镜像回退 · 镜像索引没按「先 main 再按 ref 复核」取：${JSON.stringify(calls)}`);
    if (!meta.notes.some((n) => n.includes("仅镜像"))) fails.push(`🔴 镜像回退 · 元信息取自镜像却没标「仅镜像」：${JSON.stringify(meta.notes)}`);
    if (!convergedConclusion("contents-api", meta.sources).includes("仅镜像")) fails.push("镜像回退 · 结论没标「仅镜像」");
    if (convergedConclusion("contents-api", fine.sources).includes("仅镜像")) fails.push("镜像回退 · GitHub 正常的结论不该标「仅镜像」");

    // ④ 两源目录都失败 ⇒ 与现状一致
    globalThis.fetch = serve({ ...ghOk, [CONTENTS_API]: { status: 403 }, ...giteeOk, [GITEE_DIR]: { status: 429 } }, []);
    const both = await fetchUpstream();
    eq("🔴 两源目录都失败 ⇒ archiveSuppressed", [both.namesSource, both.archiveSuppressed, both.sources.names], ["index", true, "github"]);

    // ⑤ 404 不换源
    calls = [];
    globalThis.fetch = serve({ ...ghOk, [INDEX_URL]: { status: 404 }, [VERSIONS_URL]: { body: { ref: REF, skills: { dby: "x/dby@aaaaaaaaaaaa" } } }, [KNOWN_URL]: { body: { skills: { dby: ["aaaaaaaaaaaa"] } } }, ...giteeOk }, calls);
    const legacy = await fetchUpstream();
    eq("索引 404 ⇒ 退 legacy 而不是换源", [legacy.metaSource, legacy.sources.meta], ["legacy", "github"]);
    if (calls.includes(GITEE_INDEX_MAIN)) fails.push("🔴 镜像回退 · 404 也去换源了（404 两边一样，且是 legacy 回退的既有信号）");

    // ⑥ 主备 ref 不同 ⇒ fail-closed
    globalThis.fetch = serve({ ...ghOk, [CONTENTS_API]: { status: 403 }, ...giteeOk, [GITEE_INDEX_MAIN]: { body: b64(index("release-older")) } }, []);
    let thrown = null;
    try {
      await fetchUpstream();
    } catch (err) {
      thrown = err;
    }
    eq("🔴 主备 ref 不同 ⇒ 抛 mirrorMismatch {github, gitee}", thrown?.mirrorMismatch, { github: REF, gitee: "release-older" });
    if (thrown && !/落后或超前/.test(thrown.message)) fails.push(`镜像回退 · mismatch 文案没说「落后或超前」：${thrown.message}`);
    // 镜像 main 声明 ref，tag 上那份却不是它 ⇒ 同样拦住
    globalThis.fetch = serve({ ...ghOk, [INDEX_URL]: { status: 403 }, ...giteeOk, [GITEE_INDEX_TAG]: { body: b64(index("release-older")) } }, []);
    thrown = null;
    try {
      await fetchUpstream();
    } catch (err) {
      thrown = err;
    }
    eq("🔴 镜像 main 与 tag 不一致 ⇒ 抛 mirrorMismatch", thrown?.mirrorMismatch, { github: null, gitee: REF });

    // 解码：形状不对按备源失败处理
    eq("base64 解码", decodeGiteeContent(b64({ a: 1 })), { a: 1 });
    let decodeErr = null;
    try {
      decodeGiteeContent({ content: "x" });
    } catch (err) {
      decodeErr = err;
    }
    if (!(decodeErr instanceof Friendly)) fails.push("镜像回退 · Gitee 返回形状不对时应抛 Friendly");
    // 安装源
    eq("镜像安装源 = 完整 git URL#ref", installSource(REF, "gitee"), `${GITEE_GIT_URL}#${REF}`);
    eq("🔴 无 ref 时镜像安装源为 null（不回退 clone）", installSource(null, "gitee"), null);
  } catch (err) {
    fails.push(`镜像回退 · 自检自身抛错：${err?.stack || err}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  // ── 子进程全链路：`--import` 预载一个按 DBY_FAKE_ROUTES 应答的假 fetch，其余全是真代码 ──
  const bin = mkdtempSync(join(tmpdir(), "dby-mirror-npx-"));
  const marker = join(bin, "called.log");
  const preload = join(bin, "fake-fetch.mjs");
  writeFileSync(
    preload,
    `const routes = JSON.parse(process.env.DBY_FAKE_ROUTES);
globalThis.fetch = async (url) => {
  const r = routes[url];
  if (!r) return new Response("nope", { status: 404 });
  if (r.throw) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  return new Response(JSON.stringify(r.body ?? ""), { status: r.status ?? 200 });
};
`
  );
  const health = { [HEALTH_URL]: { body: { success: true, data: { status: "ok" } } } };
  const run = (root, routes, args) =>
    spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, SELF_PATH, "--scope", "project", "--project-dir", root, ...args], {
      encoding: "utf-8",
      env: { ...process.env, DBY_FAKE_ROUTES: JSON.stringify({ ...health, ...routes }), PATH: `${bin}:${process.env.PATH}` },
    });
  const mkPkg = (root, name, body) => {
    const pkg = join(root, ".claude", "skills", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "SKILL.md"), body);
    return pkg;
  };
  const OLD = "---\nname: some-skill\n---\nv1\n";
  const NEW = "---\nname: some-skill\n---\nv2\n";

  // (a) mismatch：退出非 0、stdout 纯 JSON 带 mirrorMismatch、磁盘不动（本该归档的 retired 包原地不动、不写 lock）
  const mmRoot = mkdtempSync(join(tmpdir(), "dby-mirror-mm-"));
  try {
    const retired = mkPkg(mmRoot, "gone-skill", "---\nname: gone-skill\n---\n");
    const retiredHash = computeSkillHash(retired);
    const idx = { schemaVersion: 1, ref: REF, skills: { dby: { status: "active", knownHashes: ["aaaaaaaaaaaa"], versions: [{ version: "1.0.0", hash: "aaaaaaaaaaaa" }] }, "gone-skill": { status: "retired", knownHashes: [retiredHash], versions: [] } } };
    writeFileSync(join(bin, "npx"), `#!/bin/sh\necho "$@" >> '${marker}'\nexit 0\n`, { mode: 0o755 });
    const res = run(mmRoot, { [INDEX_URL]: { body: idx }, [CONTENTS_API]: { status: 403 }, [GITEE_INDEX_MAIN]: { body: b64({ ...idx, ref: "release-older" }) } }, ["--yes", "--json"]);
    if (res.status === 0) fails.push("🔴 镜像回退 · 主备 ref 不同时退出码应非 0");
    let parsed = null;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      fails.push(`🔴 镜像回退 · mismatch 时 --json 的 stdout 不是纯 JSON（${err.message}）：${JSON.stringify(res.stdout.slice(0, 80))}`);
    }
    eq("--json 带 mirrorMismatch", parsed?.mirrorMismatch, { github: REF, gitee: "release-older" });
    if (!existsSync(join(retired, "SKILL.md"))) fails.push("🔴 镜像回退 · mismatch 时本该 fail-closed，却把 retired 包归档走了");
    if (existsSync(join(mmRoot, ".doubaoya")) || existsSync(join(mmRoot, ".dby"))) fails.push("🔴 镜像回退 · mismatch 时写盘了（.doubaoya / .dby 出现）");
    if (existsSync(marker)) fails.push(`🔴 镜像回退 · mismatch 时还调了 npx：${readFileSync(marker, "utf-8")}`);
    if (!/落后或超前/.test(res.stderr || "")) fails.push(`镜像回退 · mismatch 的人话提示没走 stderr：${JSON.stringify((res.stderr || "").slice(-200))}`);
  } finally {
    rmSync(mmRoot, { recursive: true, force: true });
  }

  // (b) clone 回退：第一次（GitHub）挂、第二次（Gitee URL#ref）成功并落盘
  const cloneRoot = mkdtempSync(join(tmpdir(), "dby-mirror-clone-"));
  try {
    const pkg = mkPkg(cloneRoot, "some-skill", OLD);
    const oldHash = computeSkillHash(pkg);
    writeFileSync(join(pkg, "SKILL.md"), NEW);
    const newHash = computeSkillHash(pkg);
    writeFileSync(join(pkg, "SKILL.md"), OLD);
    const idx = (ref) => ({ schemaVersion: 1, ...(ref ? { ref } : {}), skills: { "some-skill": { status: "active", knownHashes: [oldHash, newHash], versions: [{ version: "1.1.0", hash: newHash }, { version: "1.0.0", hash: oldHash }] } } });
    // 假 npx：add 的包参数是 GitHub 就模拟 clone 挂掉；是 Gitee URL 就把新版内容写进目录
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "$@" >> '${marker}'\ncase " $* " in *" add ${REPO}"*) echo "fatal: unable to access github.com" >&2; exit 1;; *" add https://gitee.com/"*) printf -- '${NEW.replace(/\n/g, "\\n")}' > '${join(pkg, "SKILL.md")}';; esac\nexit 0\n`,
      { mode: 0o755 }
    );
    const routes = { [INDEX_URL]: { body: idx(REF) }, [CONTENTS_API]: { body: [{ type: "dir", name: "some-skill" }] } };
    const res = run(cloneRoot, routes, ["--yes", "--json"]);
    let parsed = null;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (err) {
      fails.push(`镜像回退·clone · stdout 不是 JSON（${err.message}）：${(res.stderr || "").trim().split("\n").pop()}`);
    }
    // 假 npx 记的是 `-y skills add <pkg> …`：取 add 后面那个 token 当包参数
    const addCalls = () => (existsSync(marker) ? readFileSync(marker, "utf-8").split("\n") : []).map((l) => l.split(" ")).filter((t) => t.includes("add")).map((t) => t.slice(t.indexOf("add") + 1));
    const called = addCalls();
    eq("🔴 clone 回退 · 先 GitHub 后 Gitee，同一 ref", called.map((t) => t[0]), [`${REPO}#${REF}`, `${GITEE_GIT_URL}#${REF}`]);
    if (called[1] && called[1].slice(1).join(" ") !== called[0].slice(1).join(" ")) fails.push(`clone 回退 · 两次 add 除包参数外其余参数应一致：${JSON.stringify(called)}`);
    eq("clone 回退 ⇒ sources.install=gitee", parsed?.sources, { meta: "github", names: "github", install: "gitee" });
    eq("🔴 clone 回退后 origin.hash = 索引当前版", readOrigin(pkg)?.hash, newHash);
    if (!(parsed?.notes || []).some((n) => n.includes("改用 Gitee 镜像"))) fails.push(`clone 回退 · notes 没标「改用 Gitee 镜像」：${JSON.stringify(parsed?.notes)}`);

    // (c) 无 ref ⇒ 只试 GitHub，不回退
    rmSync(marker, { force: true });
    writeFileSync(join(pkg, "SKILL.md"), OLD);
    rmSync(join(pkg, ".dby"), { recursive: true, force: true });
    const res2 = run(cloneRoot, { ...routes, [INDEX_URL]: { body: idx(null) } }, ["--yes", "--json"]);
    eq("🔴 无 ref ⇒ 只试 GitHub 默认分支，不回退 Gitee", addCalls().map((t) => t[0]), [REPO]);
    if (res2.status === 0) fails.push("镜像回退·clone · 无 ref 且 GitHub 挂了应当失败退出");
    if (/两边都试过/.test(res2.stderr || "")) fails.push("镜像回退·clone · 无 ref 没试镜像，提示却说两边都试过");
  } finally {
    rmSync(cloneRoot, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
  return fails;
}

async function runSelfCheck() {
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
    archive: [], add: ["a", "b"], refresh: [], upToDate: [], misplaced: [], untouched: [], blocked: [], gitTracked: [], gitUnknown: [],
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

  fails.push(...targetAgentsCheck());
  fails.push(...strayEveDirCheck());
  fails.push(...printPlanColumnsCheck());
  fails.push(...placementPlanCheck());
  fails.push(...placementSelfTestCheck());
  fails.push(...gitTrackedFixtureCheck());
  fails.push(...gitProbeFailureCheck());
  fails.push(...refreshScopeCheck());
  fails.push(...partialMigrationCheck());
  fails.push(...jsonPurityCheck());
  fails.push(...symlinkEntryCheck());
  fails.push(...refreshListCheck());
  fails.push(...(await namesSourceAndTokenCheck()));
  fails.push(...installRefAndSelfUpdateCheck());
  fails.push(...restoreArchiveCheck());
  fails.push(...(await indexFetchCheck()));
  fails.push(...originLockPinCheck(), ...backfillOriginCheck());
  fails.push(...(await mirrorFallbackCheck()));

  // 🔴 改名迁移（renames.json）：纯函数层先钉 extractRenames / splitRenameGitTracked，
  // 再用真读真写的 fixture 钉全链路——两层缺一不可，纯函数层快但证不了"真跑起来对不对"，
  // fixture 层慢但证不了"每一种输入组合都对"，见 renameMigrationCheck 顶部注释。
  const renameFixtureInstalled = [
    { name: "old-pkg-a", hash: "aaa", state: "historical" },
    { name: "old-pkg-b", hash: "zzz", state: "modified" },
    { name: "dby", hash: "ccc", state: "historical" },
  ];
  const upstreamNames = ["dby-publish", "dby"]; // old-pkg-a / old-pkg-b 都已下架
  const draft = planReconcile(renameFixtureInstalled, upstreamNames);
  eq("改名前：两个老 slug 都落进归档/不碰单", [draft.archive, draft.untouched.map((u) => u.name)], [["old-pkg-a"], ["old-pkg-b"]]);

  const emptyExtract = extractRenames(draft, {}, upstreamNames);
  eq("🔴 空表：archive/untouched 必须与无表时完全一样", [emptyExtract.archive, emptyExtract.untouched.map((u) => u.name), emptyExtract.renameCandidates], [["old-pkg-a"], ["old-pkg-b"], []]);

  const renamesTable = {
    "old-pkg-a": { to: "dby-publish", userFiles: ["config.json"] },
    "old-pkg-b": { to: "dby-publish", userFiles: [] },
  };
  const filled = extractRenames(draft, renamesTable, upstreamNames);
  eq("historical 老包摘进改名候选，不再进归档单", filled.archive, []);
  eq("🔴 modified 老包也要摘进改名候选——它正是真实用户的常态态", filled.untouched.map((u) => u.name), []);
  eq(
    "改名候选携带 to / userFiles",
    filled.renameCandidates.sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: "old-pkg-a", to: "dby-publish", userFiles: ["config.json"] },
      { from: "old-pkg-b", to: "dby-publish", userFiles: [] },
    ]
  );

  // to 还没上线到本次上游名单：老包留在原来的单子里，不许贸然搬家
  const notYetUpstream = extractRenames(draft, { "old-pkg-a": { to: "dby-publish", userFiles: [] } }, ["dby"]);
  eq("🔴 to 不在本次上游名单时不搬：老包留在归档单", notYetUpstream.archive, ["old-pkg-a"]);
  eq("to 不在名单时不产生改名候选", notYetUpstream.renameCandidates, []);

  const splitFilled = splitRenameGitTracked(filled, { tracked: ["old-pkg-a"], unknown: ["old-pkg-b"] });
  eq("受跟踪的改名候选摘进 renamedSkipped·tracked", splitFilled.renamedSkipped.find((r) => r.from === "old-pkg-a")?.reason, "tracked");
  eq("判不出的改名候选摘进 renamedSkipped·unknown", splitFilled.renamedSkipped.find((r) => r.from === "old-pkg-b")?.reason, "unknown");
  eq("两个都被摘走后 renamed 为空", splitFilled.renamed, []);
  eq("splitRenameGitTracked 之后不再带 renameCandidates 字段", "renameCandidates" in splitFilled, false);
  const splitNone = splitRenameGitTracked(filled, { tracked: [], unknown: [] });
  eq("git 都干净时两条都进 renamed", splitNone.renamed.map((r) => r.from).sort(), ["old-pkg-a", "old-pkg-b"]);
  eq("git 都干净时 renamedSkipped 为空", splitNone.renamedSkipped, []);

  // ── 信任边界：上游 slug 的形状闸 ──
  // slug 来自上游 index.json 的键与 GitHub/Gitee 的目录列表，会被拿去拼 15 处安装/归档路径。
  // 发布侧的命名闸只在我们自己发包时跑，用户装包时不在场 ⇒ 消费侧必须自己校验。
  eq("正常 slug 放行", ["dby", "dby-api", "dby-banned-words"].filter(isSafeSlug), ["dby", "dby-api", "dby-banned-words"]);
  eq(
    "路径穿越/绝对路径/家目录/空字节/反斜杠 一个都不放行",
    ["../../../.ssh", "..", ".", "/etc/passwd", "~/x", "a\u0000b", "a\\b", "a/b"].filter(isSafeSlug),
    []
  );
  eq("大写、下划线、点、空格、前后连字符 都不放行", ["DBY", "a_b", "a.b", "a b", "-a", "a-"].filter(isSafeSlug), []);
  eq("空串与超长不放行", ["", "a".repeat(65)].filter(isSafeSlug), []);
  {
    const notes = [];
    const { safe, rejected } = sanitizeSlugs(["dby-api", "../evil", "dby-image"], notes);
    eq("滤完只剩合法的", safe, ["dby-api", "dby-image"]);
    eq("被滤掉的原样带出", rejected, ["../evil"]);
    // 🔴 静默丢弃等于把攻击面藏起来——必须在 notes 里说出来，而 notes 会被转述给用户。
    if (!notes.length || !notes[0].includes("形状不合法")) fails.push("上游名单被滤掉却没进 notes——静默丢弃把攻击面藏起来了");
  }

  // ── 复原命令：路径含单引号时仍然跑得通 ──
  // 原实现把路径拼进 `node -e "...require('<路径>')..."`，安装目录带单引号（完全合法的路径）就当场破，
  // 而这是归档后**唯一**的退路。改成路径走 argv 传参 + POSIX 单引号转义。
  {
    const dir = mkdtempSync(join(tmpdir(), "dby-restore-quote-"));
    try {
      const weird = join(dir, "my'project");
      const from = join(weird, "pkg");
      const to = join(weird, "archived-pkg");
      mkdirSync(to, { recursive: true });
      writeFileSync(join(to, "SKILL.md"), "x");
      writeFileSync(join(weird, "manifest.json"), JSON.stringify({ packages: [{ from, to }] }));
      const r = spawnSync("sh", ["-c", restoreCommand(weird)], { encoding: "utf-8" });
      if (r.status !== 0) fails.push(`复原命令在带单引号的路径下跑不通（退出码 ${r.status}）：${(r.stderr || "").trim().split("\n")[0]}`);
      if (!existsSync(join(from, "SKILL.md"))) fails.push("🔴 带单引号的路径下复原命令没把包移回原处——归档的退路在这种路径上是断的");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── stillBehind：装完重扫，该刷的没刷到就必须让退出码说实话 ──
  // 背景（2026-08-26 用户现场）：`skills add` 打了 `Failed to install 3` 却以退出码 0 收场，
  // 而 runSkills 只看退出码 ⇒ 3 个包没装上，对账却报「全部通过」。判据改成我们自己重扫盘，
  // 不解析安装器的措辞（CLI 改一次文案，解析就失灵）。
  {
    const behindOf = (plan, after) =>
      [...plan.add, ...plan.refresh]
        .filter((name) => {
          const now = after.find((a) => a.name === name);
          if (!now) return true;
          return now.state !== "current";
        })
        .sort();
    const plan = { add: ["new-pkg"], refresh: ["a", "b", "c"] };
    eq(
      "装完全都到位 ⇒ stillBehind 为空",
      behindOf(plan, [
        { name: "new-pkg", state: "current" },
        { name: "a", state: "current" },
        { name: "b", state: "current" },
        { name: "c", state: "current" },
      ]),
      []
    );
    eq(
      "两个还停在旧版 ⇒ 逐个列出来",
      behindOf(plan, [
        { name: "new-pkg", state: "current" },
        { name: "a", state: "historical" },
        { name: "b", state: "current" },
        { name: "c", state: "historical" },
      ]),
      ["a", "c"]
    );
    eq(
      "计划装它却压根扫不到 ⇒ 算没装上，不是忽略",
      behindOf({ add: ["ghost"], refresh: [] }, []),
      ["ghost"]
    );
    // 🔴 反向断言：用户改过的包本来就不在 add/refresh 里（planReconcile 把它们摘进 untouched），
    //    所以不该因为它 state=modified 就把退出码顶成 3——那会让「你改过的」变成永久报错源。
    eq(
      "用户改过的包不在计划里 ⇒ 不算 behind",
      behindOf({ add: [], refresh: ["a"] }, [
        { name: "a", state: "current" },
        { name: "mine", state: "modified" },
      ]),
      []
    );
  }

  fails.push(...renamesFallbackCheck());
  fails.push(...renameMigrationCheck());

  if (fails.length) {
    for (const f of fails) console.error(`selfcheck FAILED: ${f}`);
    return 1;
  }
  console.log(
    "selfcheck ok: classify / planReconcile / splitGitTracked（含真 git 仓实证：受跟踪的包不被归档、"
      + "受跟踪与判不出两栏的文案真能分辨、" +
      "git 探测失败时 fail-closed、归档根自忽略、复原命令真能复原、收敛态零动作且 --force-refresh 能全量重下、" +
      "缺一处落位的包照样进刷新单（内容是当前版也算不上就位）且自检逐目录核不是并集核、" +
      "归档已做而拉取挂掉时提示语说清「归档了几个 / 磁盘半变更 / 重跑续上且不重复」、" +
      "只有刷新也过确认门、--json 的 stdout 真能被 JSON.parse、" +
      "经软链调用（skills CLI 装出来的常态形态）照常干活而不是静默空跑、" +
      "装的 agent 面收窄到本机真有的安装目录且与查的目录同源（不出现星号）、" +
      "agent/skills 存量副本走归档不打 rm（我方副本进归档并写 manifest、别人的原地不动、dry-run 不动盘）、" +
      "预检刷新栏逐项列名、上游目录拉不到时 namesSource=versions 且结论不说「完全一致」、" +
      "api.github.com 请求带 GITHUB_TOKEN/GH_TOKEN 而 raw 不带且令牌不进任何输出、" +
      "版本表有 ref 时 skills add 固定到 repo#ref 否则裸 repo 并标「未固定」、拉取挂了自动按 manifest 复原本轮归档且原处被占不覆盖、" +
      "刷新名单含 dby-update 时 selfUpdated=true 并提示重跑、同一秒内多次归档不撞根、" +
      "改名迁移 renames.json：空表/缺表/非法表退化一致、historical 与 modified 老包都能摘进改名候选、" +
      "to 未上线时不贸然搬家、受跟踪与判不出的改名候选单列不动、" +
      "真实文件系统上 config.json / profiles 逐字节搬对、上游新包自带的同名文件不被覆盖、" +
      "新目录已有同名文件时冲突不覆盖也不挡住老目录归档、二次运行幂等、" +
      "索引双读：index.json 优先且不再拉旧文件、404 退回三旧文件并标 metaSource=legacy、归档只认 retired/renamed/merged、" +
      "索引 active 而目录缺失只出提示、目录列表拉不到时 archiveSuppressed 且 archive 为空而刷新新增照常、" +
      "刷新栏每行「slug 旧 → 新 + changelog」且 auto 标注、--json refresh 为对象数组、" +
      "装完写 <skill>/.dby/origin.json 且目录哈希不变、scope 根 .dby/lock.json 与 origin 一致、" +
      "origin 在场时改回闭集历史版仍判 modified、--pin 后预检单列且执行不动、--unpin 后恢复刷新、" +
      "Gitee 镜像回退：GitHub 正常不碰镜像、403/网络错才换源而 404 不换、索引先 main 再按 ref 复核、" +
      "主备 ref 不同 fail-closed（退出非 0、不写盘、--json 带 mirrorMismatch）、clone 回退用同一 ref 且无 ref 不回退、sources 三项进 --json）"
  );
  return 0;
}

// ---------------------------------------------------------------- 入口

/**
 * 🔴「这个文件是不是被直接执行的」不能拿 `import.meta.url` 去比 `file://${process.argv[1]}`：
 *    `import.meta.url` 是 ESM loader **解过软链**的真路径，`process.argv[1]` 原样保留
 *    调用时给的那条路径。而软链恰恰是 skills CLI 装出来的常态形态
 *    （`.claude/skills/<name>` → `.agents/skills/<name>`，SKILL.md 的查找顺序还把软链
 *    那条排在**前面**），于是经软链调用时两串不等 ⇒ `main()` 一步都不进、退出码 0、
 *    stdout 零字节：用户看到的不是报错，是**什么都没发生**——最难查的失败形态。
 *    所以两边都先 `realpathSync` 落到同一条真路径再比。
 *    顺带 `file://${p}` 这种拼串对含空格 / 非 ASCII 的路径编码是错的，`pathToFileURL` 才是对的。
 */
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false; // node -e / REPL / 管道喂进来：本来就没有主脚本，安静退场是对的
  const href = (p) => {
    try {
      return pathToFileURL(realpathSync(p)).href;
    } catch {
      return null;
    }
  };
  const called = href(argv1);
  const here = href(SELF_PATH);
  if (called && here) return called === here;
  // realpath 解不开（路径当场被删、权限不足……）：**绝不静默**。先退回未解软链的字面比较，
  // 还判不出来就吭一声——宁可多打一行提示，也不要再来一次「零输出、退出码 0」。
  if (argv1 === SELF_PATH) return true;
  console.error(
    `提示：解析不出 ${argv1} 的真实路径，没法确认是不是在直接跑本脚本；` +
      `如果你就是在直接跑它，换成绝对路径重试。`
  );
  return false;
}

if (isMainModule()) {
  if (process.argv.includes("--self-check")) {
    runSelfCheck().then((code) => process.exit(code));
  } else {
    main()
      .then((code) => process.exit(code))
      .catch((err) => {
        // 🔴 镜像 ref 不一致：`--json` 下 stdout 仍只许是一份纯 JSON，mirrorMismatch 原样带出；磁盘此时一个字没动。
        if (err?.mirrorMismatch && jsonMode) console.log(JSON.stringify({ mirrorMismatch: err.mirrorMismatch, executed: false }, null, 2));
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
