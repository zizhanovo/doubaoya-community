// archived-config-hint.mjs —— 找不到 config.json 时，去老包（wechat-article-pipeline，
// 已改名为 dby-publish）的对账归档目录里探一探，用户的老配置是不是被搬走了。
//
// 背景：`wechat-article-pipeline` 改名为 `dby-publish` 之后，存量用户机器上**旧版**
// `dby-update` 对账器（skills/dby-update/scripts/reconcile.mjs）还不认识改名表时，会把
// 老目录（含用户自建的 config.json / design-config.json / profiles/ / 自定义 themes/*.json /
// assets/ip/*）整体当成"上游已下架"归档掉，而不是本 change 承诺的"搬数据 → 归档老目录"。
// 这些用户下一次跑 pipeline.mjs 时会发现 config.json 消失了——本模块负责把"它去哪了、
// 怎么弄回来"讲清楚,不自动搬（用户数据，搬不搬由用户自己定）。
//
// 归档目录的形状严格照 reconcile.mjs 的 doubaoyaHome() / archiveRoot() / archivePackages()：
//   <doubaoyaHome>/archive/<时间戳>/<claude_skills|agents_skills>/<包名>/…
// 其中 doubaoyaHome 按 scope 不同是 <项目目录>/.doubaoya（project scope）或
// ~/.doubaoya（global scope）。dby-publish 平时就是从"本包目录"（= 用户当年跑
// `/dby-update` 时所在的项目目录）里 `node scripts/pipeline.mjs` 起来的，所以这里的
// projectDir 直接用 process.cwd() 即可对上。
//
// 纯函数 + 一个打印入口，方便离线自检（见 ../archived-config-hint.selfcheck.mjs）。

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OLD_PACKAGE_NAME = "wechat-article-pipeline";

/** dir 下的直接子目录名；读不了/不存在就是空数组——这是探测，不是要求，读失败不该炸主流程。 */
function listSubdirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** dir 下的直接子文件名；语义同上，用来在 themes/、assets/ip/ 里挑用户自建文件。 */
function listFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((name) => {
    try {
      return statSync(join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * 在一个 doubaoyaHome（<root>/.doubaoya）下找 archive/<时间戳>/<label>/wechat-article-pipeline。
 * label 是 reconcile.mjs 里 ".claude/skills" → "claude_skills"、".agents/skills" → "agents_skills"
 * 那种去点转下划线的写法，这里不关心具体是哪个 label，两个都扫。
 */
function findArchivedCandidates(doubaoyaHome) {
  const archiveDir = join(doubaoyaHome, "archive");
  const out = [];
  for (const timestamp of listSubdirs(archiveDir)) {
    const timestampDir = join(archiveDir, timestamp);
    for (const label of listSubdirs(timestampDir)) {
      const pkgDir = join(timestampDir, label, OLD_PACKAGE_NAME);
      if (existsSync(pkgDir)) out.push({ timestamp, path: pkgDir });
    }
  }
  return out;
}

/**
 * 探测 <projectDir>/.doubaoya/archive 与 <home>/.doubaoya/archive 里有没有归档过的老包。
 * 一个都没有返回 null；有则按时间戳倒序，`latest` 是最近一次归档，`others` 是更早的（只报数量）。
 * 时间戳是 reconcile.mjs 的 `new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)`
 * 形式（如 `2026-08-20T10-15-30`），字符串序＝时间序，可直接比较。
 */
export function detectArchivedConfig({ projectDir = process.cwd(), home = homedir() } = {}) {
  const found = [];
  if (projectDir) found.push(...findArchivedCandidates(join(projectDir, ".doubaoya")));
  if (home) found.push(...findArchivedCandidates(join(home, ".doubaoya")));
  if (!found.length) return null;
  found.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return { latest: found[0], others: found.slice(1) };
}

/**
 * 老包目录里，哪些东西值得告诉用户、怎么搬：
 *   - config.json / design-config.json：文件本身就是（存在才列）；
 *   - profiles/：整目录搬（本身就是用户身份卡，例子文件搬回来也无妨）；
 *   - themes/、assets/ip/：**只挑不在本包（当前 dby-publish）自带清单里的文件**——
 *     本包自带的主题/说明文件本来就有更新的一份在本地，不该被老归档覆盖回去。
 * builtinThemeFiles / builtinIpAssetFiles 由调用方传本包（新目录）themes/、assets/ip/ 下
 * 当前的文件名清单进来，保持"跟当前包内容比"而不是硬编码一份清单会漂移的名单。
 */
export function planRestoreItems(archivedPkgDir, { builtinThemeFiles = [], builtinIpAssetFiles = [] } = {}) {
  const items = [];
  for (const rel of ["config.json", "design-config.json"]) {
    if (existsSync(join(archivedPkgDir, rel)) && statSync(join(archivedPkgDir, rel)).isFile()) {
      items.push({ rel, kind: "file" });
    }
  }
  if (existsSync(join(archivedPkgDir, "profiles")) && statSync(join(archivedPkgDir, "profiles")).isDirectory()) {
    items.push({ rel: "profiles", kind: "dir" });
  }
  const builtinThemes = new Set(builtinThemeFiles);
  for (const name of listFiles(join(archivedPkgDir, "themes"))) {
    if (!builtinThemes.has(name)) items.push({ rel: `themes/${name}`, kind: "file" });
  }
  const builtinIpAssets = new Set(builtinIpAssetFiles);
  for (const name of listFiles(join(archivedPkgDir, "assets", "ip"))) {
    if (!builtinIpAssets.has(name)) items.push({ rel: `assets/ip/${name}`, kind: "file" });
  }
  return items;
}

/**
 * 拼一条 `cp` 命令，逐字段 JSON.stringify 当引号——比手写单引号包裹更抗路径里含空格/单引号。
 * 目录用 `cp -R`，文件用 `cp`。
 */
function cpCommand(from, to, kind) {
  const flag = kind === "dir" ? "-R " : "";
  return `cp ${flag}${JSON.stringify(from)} ${JSON.stringify(to)}`;
}

/**
 * 组装打到 stderr 的整段提示文本；探测不到归档、或探测到了但里面没有值得提的用户数据，
 * 都返回 null——调用方看到 null 原样什么都不打印，行为与"这功能不存在"完全一致。
 *
 * pkgDir：本包（新的 dby-publish）根目录，既是 cp 命令的搬入目的地，也用来读它自己的
 * themes/、assets/ip/ 清单去过滤"本包自带、别覆盖"的文件。
 */
export function buildArchivedConfigHint({ pkgDir, projectDir, home } = {}) {
  if (!pkgDir) throw new Error("buildArchivedConfigHint 需要 pkgDir（本包根目录，用作搬入目的地）");
  const found = detectArchivedConfig({ projectDir, home });
  if (!found) return null;

  const builtinThemeFiles = listFiles(join(pkgDir, "themes"));
  const builtinIpAssetFiles = listFiles(join(pkgDir, "assets", "ip"));
  const items = planRestoreItems(found.latest.path, { builtinThemeFiles, builtinIpAssetFiles });
  if (!items.length) return null;

  const lines = [];
  lines.push("⚠️  没找到 config.json，但发现旧包（wechat-article-pipeline，已改名为 dby-publish）的归档配置：");
  lines.push(`   ${found.latest.path}`);
  lines.push("   多半是早前跑 /dby-update 对账时，旧版对账器还不认识改名表，把整个老目录当下架包归档了。");
  lines.push("   要不要搬回来、搬哪些由你自己定，以下命令按需挑着跑（不会自动执行）：");
  for (const item of items) {
    lines.push(`     ${cpCommand(join(found.latest.path, item.rel), join(pkgDir, item.rel), item.kind)}`);
  }
  if (items.some((i) => i.rel.startsWith("themes/") || i.rel.startsWith("assets/ip/"))) {
    lines.push("   （themes/、assets/ip/ 只列出了不在本包自带清单里的文件，即你自己加的那些；本包自带的不会被建议覆盖。）");
  }
  if (found.others.length) {
    lines.push(`   另外还有 ${found.others.length} 处更早的归档，路径类似（按时间戳区分），从略。`);
  }
  return lines.join("\n") + "\n";
}

/**
 * 主流程唯一要调的入口：探测到就打一段到 stderr，探测不到什么都不做。
 * 只在"确实要用 config.json"的路径上调用它——本地渲染这类不依赖 config 的场景别拿这个打扰用户。
 */
export function printArchivedConfigHint(opts) {
  const text = buildArchivedConfigHint(opts);
  if (text) process.stderr.write(`\n${text}`);
}
