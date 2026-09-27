#!/usr/bin/env node
// release.mjs — 发版工具（dby-cli-rebuild design D10 / spec「CLI 与 skills 共用一个版本号」
// 「版本信息的唯一优先级与旧信息的停止维护」）。
//
// 事实源只有 cli/package.json 的 version。一次 release 提交里由它派生：
//   ① cli/package.json 的 version（给了目标版本时先改它——它是源头，其余全部从它派生）；
//   ② skills/*/SKILL.md frontmatter 的 `version:`（13 处，恒等于①）与 `changelog:`（指向 CHANGELOG 本节）；
//   ③ 各 SKILL.md 调用约定里的确切版本 `@doubaoya/cli@<版本>`（tools/call-convention.md 的 {{CLI_VERSION}}）；
//   ④ cli/CHANGELOG.md 一节 `## <版本> - <日期>`（服务端 sync-cli-releases.mjs 按这个形状解析）；
//   ⑤ 2.x 期间：兼容视图 index.json / versions.json / known-hashes.json / .version（旧 reconcile 的最后一跳要读），
//      版本字段从①派生——跑 tools/stamp_versions.py 与 tools/build_known_hashes.py；
//      3.0.0 起**不再生成**（服务端旧 UA 判据的输入保持冻结）。
//
// CHANGELOG 本节从哪来（按顺序取第一个成立的）：
//   a. 已有 `## <版本>` 一节 → 保留要点，标题补上日期；
//   b. 有 `## 未发布` 一节 → 改名为本版本；
//   c. 正式版且有同核心的预发布节（2.0.0 之于 2.0.0-next.N）→ 合并这些节的要点；
//   d. --notes 给了要点 → 新建一节；
//   e. 都没有 → 失败（spec「变更记录缺节」）。
//
// 用法（仓库根或 cli/ 下都行）：
//   node cli/scripts/release.mjs [<版本>] [--dry-run] [--notes "要点"]... [--date YYYY-MM-DD]
//     不给版本 = 以 package.json 现有版本为准，只做派生（幂等）。
//     --dry-run：只打印将要改动的每一处，不写任何文件。
// 🔴 未知参数直接报错：Node 会静默忽略拼错的 argv，拼错一个 --dry-run 就会真写文件。

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
export const COMPAT_VIEW_LAST_MAJOR = 2; // 兼容视图只在这一 major 里生成（spec：3.0.0 起停止）
export const COMPAT_VIEW_FILES = ["index.json", "versions.json", "known-hashes.json", "renames.json", "tools/clawhub.json", "skills/*/.version"];
const UNRELEASED = /^##\s+(未发布|Unreleased)\s*$/i;

export function parseSemver(v) {
  const m = SEMVER.exec(String(v ?? ""));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, core: `${m[1]}.${m[2]}.${m[3]}` } : null;
}

export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`不是合法 semver：${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"]) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const pa = x.pre.split(".");
  const pb = y.pre.split(".");
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

export function generatesCompatView(version) {
  return parseSemver(version).major <= COMPAT_VIEW_LAST_MAJOR;
}

// ── CHANGELOG ────────────────────────────────────────────────────────────────

/** 切成 [{ heading, version|null, unreleased, start, end }]（行号区间，end 不含）。 */
export function changelogSections(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^##\s/.test(lines[i])) continue;
    const m = /^##\s+\[?v?([0-9][^\]\s（(]*)\]?/.exec(lines[i]);
    out.push({ heading: lines[i], version: m && parseSemver(m[1]) ? m[1] : null, unreleased: UNRELEASED.test(lines[i]), start: i });
  }
  out.forEach((s, i) => (s.end = i + 1 < out.length ? out[i + 1].start : lines.length));
  return { lines, sections: out };
}

const bullets = (lines, s) => lines.slice(s.start + 1, s.end).filter((l) => /^[-*]\s+/.test(l));

export function planChangelog(text, version, { date, notes = [] }) {
  const { lines, sections } = changelogSections(text);
  const heading = `## ${version} - ${date}`;
  const own = sections.find((s) => s.version === version);
  if (own) {
    if (!bullets(lines, own).length) throw new Error(`CHANGELOG 里 ${version} 一节没有要点（- 开头的列表项）。`);
    const next = [...lines];
    next[own.start] = /^##\s+\S+\s+-\s+\d{4}-\d{2}-\d{2}\s*$/.test(own.heading) ? own.heading : heading;
    return { how: "已有本节，标题补日期", heading: next[own.start], text: next.join("\n"), bullets: bullets(lines, own) };
  }
  const pending = sections.find((s) => s.unreleased);
  if (pending && bullets(lines, pending).length) {
    const next = [...lines];
    next[pending.start] = heading;
    return { how: "「未发布」一节改名", heading, text: next.join("\n"), bullets: bullets(lines, pending) };
  }
  const v = parseSemver(version);
  const pres = v.pre ? [] : sections.filter((s) => s.version && parseSemver(s.version).pre && parseSemver(s.version).core === v.core);
  let items = [];
  let how;
  if (pres.length) {
    items = [...new Set(pres.flatMap((s) => bullets(lines, s)))];
    how = `合并 ${pres.map((s) => s.version).join("、")} 的要点`;
  } else if (notes.length) {
    items = notes.map((n) => `- ${n}`);
    how = "--notes 新建";
  } else {
    throw new Error(`CHANGELOG 没有 ${version} 的待发布内容：没有「## ${version}」、没有「## 未发布」，也没有可合并的预发布节。先写要点或用 --notes。`);
  }
  const first = sections.length ? sections[0].start : lines.length;
  const block = [heading, "", ...items, ""];
  const next = [...lines.slice(0, first), ...block, ...lines.slice(first)];
  return { how, heading, text: next.join("\n"), bullets: items };
}

// ── SKILL.md ─────────────────────────────────────────────────────────────────

export function skillChangelogLine(version) {
  // 短：SKILL.md 有 6000 字符闸，这一行每个包都要付。
  return `changelog: 随 @doubaoya/cli ${version} 统一发版，要点见 CHANGELOG.md`;
}

/** 改一个 SKILL.md：frontmatter version / changelog + 调用约定确切版本。返回 { text, changes[] }。 */
/** tools/call-convention.md 按某个版本渲染出的整段（{{CLI_VERSION}} 出现几处就换几处）。 */
export function renderConvention(template, version) {
  return template.replaceAll("{{CLI_VERSION}}", version).replace(/\n+$/, "");
}

export function planSkill(text, version, oldPkgVersion, template = null) {
  const changes = [];
  if (!text.startsWith("---\n")) throw new Error("没有 frontmatter");
  const end = text.indexOf("\n---\n", 4);
  const fm = text.slice(4, end).split("\n");
  let sawVersion = false;
  let sawChangelog = false;
  for (let i = 0; i < fm.length; i++) {
    if (fm[i].startsWith("version:")) {
      sawVersion = true;
      const was = fm[i].slice(8).trim();
      if (was !== version) changes.push({ field: "version", from: was, to: version });
      fm[i] = `version: ${version}`;
    } else if (fm[i].startsWith("changelog:")) {
      sawChangelog = true;
      // 只支持单行 changelog（本仓全部是单行；折叠块会被 stamp 的解析器当多行读）
      if (/^changelog:\s*[>|]/.test(fm[i])) throw new Error("changelog 是块标量，release 工具只改单行形态");
      const line = skillChangelogLine(version);
      if (fm[i] !== line) changes.push({ field: "changelog", from: fm[i].slice(10).trim(), to: line.slice(10).trim() });
      fm[i] = line;
    }
  }
  if (!sawVersion) throw new Error("frontmatter 缺 version:");
  if (!sawChangelog) {
    const at = fm.findIndex((l) => l.startsWith("version:")) + 1;
    fm.splice(at, 0, skillChangelogLine(version));
    changes.push({ field: "changelog", from: null, to: skillChangelogLine(version).slice(10).trim() });
  }
  let body = text.slice(end);
  // 调用约定段整段按模板重渲染（第 2 步的 `dby --version` 比对值与第 3 步的 npx 版本都在里面）。
  if (template && oldPkgVersion !== version) {
    const before = renderConvention(template, oldPkgVersion);
    if (body.includes(before)) {
      body = body.replace(before, renderConvention(template, version));
      changes.push({ field: "调用约定段", from: `按 ${oldPkgVersion} 渲染`, to: `按 ${version} 渲染（tools/call-convention.md）` });
    }
  }
  const exact = /@doubaoya\/cli@([0-9][0-9A-Za-z.-]*)/g;
  const found = [...body.matchAll(exact)].map((m) => m[1]).filter((v) => v !== version);
  if (found.length) {
    const unexpected = found.filter((v) => v !== oldPkgVersion);
    if (unexpected.length) throw new Error(`调用约定里有既不是旧包版本（${oldPkgVersion}）也不是新版本的确切版本：${[...new Set(unexpected)].join("、")}——先修正再发版`);
    body = body.replace(exact, (m, v) => (v === oldPkgVersion ? `@doubaoya/cli@${version}` : m));
    changes.push({ field: "调用约定确切版本", from: `@doubaoya/cli@${oldPkgVersion} ×${found.length}`, to: `@doubaoya/cli@${version}` });
  }
  return { text: `---\n${fm.join("\n")}${body}`, changes };
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { version: null, dryRun: false, notes: [], date: new Date().toISOString().slice(0, 10), root: REPO_ROOT, skipCompat: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Error(`${a} 需要一个值`);
      return argv[++i];
    };
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--notes") opts.notes.push(value());
    else if (a === "--date") opts.date = value();
    else if (a === "--root") opts.root = path.resolve(value());
    else if (a === "--skip-compat-view") opts.skipCompat = true; // 仅测试：临时目录里没有 git 历史，跑不了闭集生成
    else if (a.startsWith("--")) throw new Error(`未知参数 ${a}`);
    else if (opts.version) throw new Error(`多余的参数 ${a}`);
    else opts.version = a;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error(`--date 要 YYYY-MM-DD，收到 ${opts.date}`);
  return opts;
}

export function planRelease(opts) {
  const root = opts.root;
  const pkgPath = path.join(root, "cli", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const current = pkg.version;
  const version = opts.version ?? current;
  if (!parseSemver(version)) throw new Error(`目标版本不是合法 semver：${version}`);
  if (compareSemver(version, current) < 0) throw new Error(`目标版本 ${version} 低于 package.json 现有的 ${current}——版本只许递增。`);

  const files = [];
  if (version !== current) {
    files.push({ path: "cli/package.json", changes: [{ field: "version", from: current, to: version }], write: () => writeFileSync(pkgPath, JSON.stringify({ ...pkg, version }, null, 2) + "\n") });
  }
  const templatePath = path.join(root, "tools", "call-convention.md");
  const template = existsSync(templatePath) ? readFileSync(templatePath, "utf8") : null;
  const skillsDir = path.join(root, "skills");
  const slugs = readdirSync(skillsDir).filter((s) => existsSync(path.join(skillsDir, s, "SKILL.md"))).sort();
  if (!slugs.length) throw new Error("skills/ 下一个 SKILL.md 都没有——扫描退化，拒绝继续。");
  for (const slug of slugs) {
    const p = path.join(skillsDir, slug, "SKILL.md");
    const { text, changes } = planSkill(readFileSync(p, "utf8"), version, current, template);
    files.push({ path: `skills/${slug}/SKILL.md`, changes, write: () => writeFileSync(p, text) });
  }
  const clPath = path.join(root, "cli", "CHANGELOG.md");
  const clBefore = readFileSync(clPath, "utf8");
  const cl = planChangelog(clBefore, version, opts);
  const clChanges = cl.text === clBefore ? [] : [{ field: "节", from: cl.how, to: cl.heading, bullets: cl.bullets }];
  files.push({ path: "cli/CHANGELOG.md", changes: clChanges, write: () => writeFileSync(clPath, cl.text) });

  const compat = generatesCompatView(version)
    ? { generate: true, productVersion: version, skillVersion: version, files: COMPAT_VIEW_FILES, how: "python3 tools/stamp_versions.py && python3 tools/build_known_hashes.py（版本字段取自 package.json / SKILL.md）" }
    : { generate: false, reason: `包版本 ${version} ≥ 3.0.0：兼容视图（${COMPAT_VIEW_FILES.join("、")}）停止生成，现有文件保持冻结；服务端旧 UA 判据用冻结的闭集继续工作。` };
  return { version, previous: current, date: opts.date, skills: slugs.length, files, compat };
}

function render(plan, dryRun) {
  const lines = [`release ${plan.previous} → ${plan.version}（${dryRun ? "dry-run，未写任何文件" : "已写入"}）`, `日期：${plan.date}`, ""];
  let touched = 0;
  for (const f of plan.files) {
    if (!f.changes.length) {
      lines.push(`= ${f.path}（无变化）`);
      continue;
    }
    touched++;
    lines.push(`~ ${f.path}`);
    for (const c of f.changes) {
      lines.push(`    ${c.field}: ${c.from ?? "（无）"} → ${c.to}`);
      for (const b of c.bullets ?? []) lines.push(`      ${b}`);
    }
  }
  lines.push("", `SKILL.md：${plan.skills} 个，version 一律 = ${plan.version}`);
  if (plan.compat.generate) {
    lines.push(`兼容视图：生成（2.x）。productVersion = ${plan.compat.productVersion}；每个在架包 versions[0].version = ${plan.compat.skillVersion}`);
    lines.push(`  产物：${plan.compat.files.join("、")}`);
    lines.push(`  做法：${plan.compat.how}`);
  } else {
    lines.push(`兼容视图：不生成。${plan.compat.reason}`);
  }
  lines.push(`改动文件：${touched} 个`);
  return lines.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const plan = planRelease(opts);
    if (!opts.dryRun) {
      for (const f of plan.files) if (f.changes.length) f.write();
      if (plan.compat.generate && !opts.skipCompat) {
        execFileSync("python3", ["tools/stamp_versions.py"], { cwd: opts.root, stdio: ["ignore", "ignore", "inherit"] });
        execFileSync("python3", ["tools/build_known_hashes.py"], { cwd: opts.root, stdio: ["ignore", "ignore", "inherit"] });
      }
    }
    process.stdout.write(render(plan, opts.dryRun) + "\n");
  } catch (err) {
    process.stderr.write(`release 失败：${err.message}\n`);
    process.exitCode = 1;
  }
}
