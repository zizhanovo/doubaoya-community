#!/usr/bin/env node
// prepublish-check.mjs — 打包闸与发布前检查（dby-cli-rebuild tasks 6.5 / design D13）。
// `npm publish` 之前必须全绿；publish-npm.yml 在 publish 前跑它，本地发版同样先跑它。
//
// 判的是**打包产物**（隔离副本里真 `npm pack` 再解开），不是仓内源码——用户拿到的是那份：
//   ① 零依赖：dependencies / optionalDependencies / peerDependencies / bundleDependencies 全空；
//   ② exports 只有 "./package.json" 与 "./bin/dby.mjs"，bin 只有 dby，engines.node = ">=22"；
//   ③ 包内每个 SKILL.md 的 frontmatter version = 包版本；包内 skill 只有 SKILL.md 与 references/；
//   ④ 调用约定里的确切版本 @doubaoya/cli@<X> = 包版本；
//   ⑤ 镜像哈希：包内每个 skill 的内容哈希 = 仓库 skills/ 同名包（同一打包口径）的哈希，集合一致；
//   ⑥ 兼容视图（2.x）：index.json 的 productVersion 与每个在架包 versions[0].version = 包版本；
//   ⑦ 版本递增：待发版本严格大于 registry 上同一 dist-tag 线已发布的最高版本，且从未发布过；
//   ⑧ CHANGELOG.md 有本版本一节且有要点。
//
// 用法：node cli/scripts/prepublish-check.mjs [--dist-tag next|latest] [--registry <url>] [--registry-json <文件>] [--offline]
//   --dist-tag 缺省按版本号定：带预发布段 → next，否则 latest。
//   --registry-json：用一份本地的 packument 代替联网查询（测试 / 离线核对用）。
//   --offline：跳过⑦（只在确实无法联网时用；⑦ 标 ⏭ 未核对，其余照判；publish-npm.yml 不带它）。
// 🔴 未知参数直接报错（拼错的开关不能被静默忽略）。

import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packIsolated } from "./pack-isolated.mjs";
import { bundledHash, frontmatterField, listSkillFiles, readBundle } from "../src/skills-bundle.mjs";
import { compareSemver, parseSemver, changelogSections, generatesCompatView } from "./release.mjs";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..");
export const EXPECTED_EXPORTS = ["./bin/dby.mjs", "./package.json"];
const DEP_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"];

function parseArgs(argv) {
  const o = { distTag: null, registry: "https://registry.npmjs.org", registryJson: null, offline: false, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (argv[i + 1] === undefined) throw new Error(`${a} 需要一个值`);
      return argv[++i];
    };
    if (a === "--dist-tag") o.distTag = v();
    else if (a === "--registry") o.registry = v();
    else if (a === "--registry-json") o.registryJson = v();
    else if (a === "--offline") o.offline = true;
    else if (a === "--root") o.root = path.resolve(v());
    else throw new Error(`未知参数 ${a}`);
  }
  return o;
}

/** ⑦ 的纯判据：packument（或 null = 从未发布）→ 问题列表。 */
export function checkIncrement(version, distTag, packument) {
  if (!packument) return [];
  const problems = [];
  const published = Object.keys(packument.versions ?? {}).filter((v) => parseSemver(v));
  if (published.includes(version)) problems.push(`${version} 已经发布过（npm 版本不可重发、不可撤回）`);
  const tagged = packument["dist-tags"]?.[distTag];
  if (tagged && parseSemver(tagged) && compareSemver(version, tagged) <= 0) {
    problems.push(`待发 ${version} 不大于 dist-tag ${distTag} 当前指向的 ${tagged}`);
  }
  // 同一线：latest 线 = 全部正式版；next 线 = 全部预发布版
  const wantPre = !!parseSemver(version).pre;
  const line = published.filter((v) => !!parseSemver(v).pre === wantPre).sort(compareSemver);
  const top = line.at(-1);
  if (top && compareSemver(version, top) <= 0) problems.push(`待发 ${version} 不大于 ${distTag} 线已发布的最高版本 ${top}`);
  return problems;
}

async function fetchPackument(registry, name) {
  const url = `${registry.replace(/\/+$/, "")}/${name.replace("/", "%2f")}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  return res.json();
}

export async function runChecks(opts) {
  const root = opts.root;
  const results = [];
  const check = (name, problems) => results.push({ name, ok: problems.length === 0, problems });

  const pkg = JSON.parse(readFileSync(path.join(root, "cli", "package.json"), "utf8"));
  const version = pkg.version;
  const distTag = opts.distTag ?? (parseSemver(version)?.pre ? "next" : "latest");

  // ① ②（源 package.json 与产物里的 package.json 是同一份，先判源，产物里再判一次）
  const pkgProblems = (p, label) => {
    const out = [];
    for (const f of DEP_FIELDS) {
      const v = p[f];
      if (v && (Array.isArray(v) ? v.length : Object.keys(v).length)) out.push(`${label} 的 ${f} 不为空：${JSON.stringify(v)}（包必须零运行时依赖）`);
    }
    const exp = p.exports && typeof p.exports === "object" ? Object.keys(p.exports).sort() : [];
    if (JSON.stringify(exp) !== JSON.stringify(EXPECTED_EXPORTS)) out.push(`${label} 的 exports 是 ${JSON.stringify(p.exports)}，只许 ${EXPECTED_EXPORTS.join(" 与 ")}（内部模块不得可 import）`);
    for (const [k, target] of Object.entries(p.exports ?? {})) if (/\*/.test(k) || /\*/.test(String(target))) out.push(`${label} 的 exports 里有通配 ${k}`);
    if (JSON.stringify(Object.keys(p.bin ?? {})) !== JSON.stringify(["dby"])) out.push(`${label} 的 bin 只许有 dby：${JSON.stringify(p.bin)}`);
    if (p.engines?.node !== ">=22") out.push(`${label} 的 engines.node 是 ${JSON.stringify(p.engines?.node)}，应为 ">=22"`);
    if (!parseSemver(p.version)) out.push(`${label} 的 version 不是合法 semver：${p.version}`);
    return out;
  };
  check("① 零依赖 / ② exports·bin·engines（源 package.json）", pkgProblems(pkg, "cli/package.json"));

  // 打包产物
  const work = mkdtempSync(path.join(tmpdir(), "dby-prepublish-"));
  try {
    const packed = packIsolated(work, { extract: true, cliRoot: path.join(root, "cli"), repoRoot: root });
    const pkgDir = packed.extracted;
    const packedPkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const packProblems = pkgProblems(packedPkg, "包内 package.json");
    const allowedTop = new Set(["bin", "src", "skills", "CHANGELOG.md", "LICENSE", "README.md", "package.json"]);
    for (const f of packed.files) if (!allowedTop.has(f.split("/")[0])) packProblems.push(`包里多出了 ${f}（files 白名单之外）`);
    check("① ② 打包产物的 package.json 与文件清单", packProblems);

    // ③ ④
    const bundle = readBundle(path.join(pkgDir, "skills"));
    const fmProblems = [];
    const convProblems = [];
    if (bundle.length < 8) fmProblems.push(`包里只有 ${bundle.length} 个 skill——打包退化，这道闸在空跑`);
    for (const p of bundle) {
      const text = readFileSync(path.join(p.dir, "SKILL.md"), "utf8");
      const declared = frontmatterField(text, "version");
      if (declared !== version) fmProblems.push(`skills/${p.slug}/SKILL.md 的 version 是 ${declared}，包版本是 ${version}`);
      const all = listSkillFiles(p.dir);
      const extra = all.filter((f) => !p.files.includes(f));
      if (extra.length) fmProblems.push(`skills/${p.slug} 里有说明书以外的文件：${extra.join("、")}`);
      if (existsSync(path.join(p.dir, "scripts"))) fmProblems.push(`skills/${p.slug}/scripts/ 进了包`);
      for (const m of text.matchAll(/@doubaoya\/cli@([0-9][0-9A-Za-z.-]*)/g)) {
        if (m[1] !== version) convProblems.push(`skills/${p.slug}/SKILL.md 调用约定里是 @doubaoya/cli@${m[1]}，包版本是 ${version}`);
      }
    }
    check("③ 包内 SKILL.md 的 frontmatter version = 包版本", fmProblems);
    check("④ 调用约定里的确切版本 = 包版本", convProblems);

    // ⑤
    const repoBundle = new Map(readBundle(path.join(root, "skills")).map((p) => [p.slug, p]));
    const mirrorProblems = [];
    const packedSlugs = bundle.map((p) => p.slug);
    const repoSlugs = [...repoBundle.keys()];
    if (JSON.stringify(packedSlugs) !== JSON.stringify(repoSlugs)) mirrorProblems.push(`包内 skill 集合 ${packedSlugs.join(",")} ≠ 仓库镜像 ${repoSlugs.join(",")}`);
    for (const p of bundle) {
      const mirror = repoBundle.get(p.slug);
      if (mirror && bundledHash(mirror.dir) !== p.hash) mirrorProblems.push(`skills/${p.slug}：包内哈希 ${p.hash} ≠ 仓库镜像 ${bundledHash(mirror.dir)}`);
    }
    check("⑤ 镜像哈希：包内 skills 与仓库 skills/ 同版本同内容", mirrorProblems);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // ⑥
  const compatProblems = [];
  if (generatesCompatView(version)) {
    const index = JSON.parse(readFileSync(path.join(root, "index.json"), "utf8"));
    if (index.productVersion !== version) compatProblems.push(`index.json 的 productVersion 是 ${index.productVersion}，包版本是 ${version}`);
    for (const [slug, e] of Object.entries(index.skills ?? {})) {
      if (e.status !== "active") continue;
      const head = e.versions?.[0]?.version;
      if (head !== version) compatProblems.push(`index.json[${slug}] 最新版本是 ${head}，包版本是 ${version}`);
    }
    check("⑥ 兼容视图版本 = 包版本（2.x）", compatProblems);
  } else {
    results.push({ name: "⑥ 兼容视图（≥3.0.0 已停止生成，不判）", ok: true, problems: [] });
  }

  // ⑦
  if (opts.offline && !opts.registryJson) {
    results.push({ name: `⑦ 版本递增（dist-tag ${distTag}）`, ok: true, skipped: true, problems: ["--offline：未核对 registry"] });
  } else {
    let packument;
    let err = null;
    try {
      packument = opts.registryJson ? JSON.parse(readFileSync(opts.registryJson, "utf8")) : await fetchPackument(opts.registry, pkg.name);
    } catch (e) {
      err = e;
    }
    check(`⑦ 版本递增（dist-tag ${distTag}，${opts.registryJson ? "本地 packument" : opts.registry}）`, err ? [`查询 registry 失败：${err.message}——核对不了就不能发`] : checkIncrement(version, distTag, packument));
  }

  // ⑧
  const cl = readFileSync(path.join(root, "cli", "CHANGELOG.md"), "utf8");
  const { lines, sections } = changelogSections(cl);
  const sec = sections.find((s) => s.version === version);
  const clProblems = [];
  if (!sec) clProblems.push(`CHANGELOG.md 没有 ${version} 一节（先跑 node cli/scripts/release.mjs）`);
  else if (!lines.slice(sec.start + 1, sec.end).some((l) => /^[-*]\s+/.test(l))) clProblems.push(`CHANGELOG.md 的 ${version} 一节没有要点`);
  check("⑧ CHANGELOG 有本版本一节", clProblems);

  return { version, distTag, results, ok: results.every((r) => r.ok) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const out = await runChecks(parseArgs(process.argv.slice(2)));
    const lines = [`prepublish-check @doubaoya/cli@${out.version}（dist-tag ${out.distTag}）`];
    for (const r of out.results) {
      lines.push(`${r.skipped ? "⏭" : r.ok ? "✅" : "❌"} ${r.name}`);
      for (const p of r.problems) lines.push(`    ${p}`);
    }
    lines.push(out.ok ? "全部通过。" : "有检查不过，禁止发布。");
    process.stdout.write(lines.join("\n") + "\n");
    process.exitCode = out.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(`prepublish-check 失败：${err.message}\n`);
    process.exitCode = 1;
  }
}
