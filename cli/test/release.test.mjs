// release.test.mjs — tasks 6.2 / 6.5：release 工具的派生与发布前检查的判据（纯函数 + 临时副本里真跑）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./helpers.mjs";
import { compareSemver, planChangelog, planSkill, renderConvention, generatesCompatView } from "../scripts/release.mjs";
import { checkIncrement } from "../scripts/prepublish-check.mjs";

const RELEASE = path.join(REPO_ROOT, "cli", "scripts", "release.mjs");
const TEMPLATE = readFileSync(path.join(REPO_ROOT, "tools", "call-convention.md"), "utf8");

test("semver 优先级：预发布 < 正式版，数字段按数值比", () => {
  assert.ok(compareSemver("2.0.0-next.0", "2.0.0") < 0);
  assert.ok(compareSemver("2.0.0-next.10", "2.0.0-next.9") > 0);
  assert.ok(compareSemver("2.10.0", "2.9.0") > 0);
  assert.equal(compareSemver("3.0.0", "3.0.0"), 0);
  assert.equal(generatesCompatView("2.9.9"), true);
  assert.equal(generatesCompatView("3.0.0"), false);
});

test("CHANGELOG：正式版合并同核心预发布节的要点；已有本节只补日期；缺内容就失败", () => {
  const cl = "# Changelog\n\n## 2.0.0-next.1 - 2026-09-28\n\n- 乙\n\n## 2.0.0-next.0 - 2026-09-27\n\n- 甲\n- 乙\n";
  const r = planChangelog(cl, "2.0.0", { date: "2026-10-01" });
  assert.equal(r.heading, "## 2.0.0 - 2026-10-01");
  assert.deepEqual(r.bullets, ["- 乙", "- 甲"]);
  assert.ok(r.text.indexOf("## 2.0.0 - 2026-10-01") < r.text.indexOf("## 2.0.0-next.1"), "新节要排在最上面");
  const own = planChangelog("## 2.0.0-next.0（未发布）\n\n- 甲\n", "2.0.0-next.0", { date: "2026-09-27" });
  assert.equal(own.heading, "## 2.0.0-next.0 - 2026-09-27");
  const pending = planChangelog("## 未发布\n\n- 丙\n\n## 2.0.0 - 2026-10-01\n\n- 甲\n", "2.0.1", { date: "2026-10-02" });
  assert.equal(pending.heading, "## 2.0.1 - 2026-10-02");
  assert.throws(() => planChangelog("## 2.0.0 - 2026-10-01\n\n- 甲\n", "3.0.0", { date: "2026-12-01" }), /没有 3\.0\.0 的待发布内容/);
  assert.equal(planChangelog("## 2.0.0 - 2026-10-01\n\n- 甲\n", "3.0.0", { date: "2026-12-01", notes: ["停"] }).bullets[0], "- 停");
});

test("SKILL.md：version / changelog / 调用约定段整段按新版本重渲染；陌生的确切版本拒绝", () => {
  const text = `---\nname: x\ndescription: d\nversion: 7.0.0\nchangelog: 旧\n---\n\n${renderConvention(TEMPLATE, "2.0.0-next.0")}\n\n正文\n`;
  const { text: out, changes } = planSkill(text, "2.0.0", "2.0.0-next.0", TEMPLATE);
  assert.match(out, /^version: 2\.0\.0$/m);
  assert.match(out, /^changelog: 随 @doubaoya\/cli 2\.0\.0 统一发版/m);
  assert.ok(out.includes(renderConvention(TEMPLATE, "2.0.0")), "调用约定段没按新版本渲染");
  assert.ok(!out.includes("2.0.0-next.0"), "旧版本号残留");
  assert.deepEqual(changes.map((c) => c.field), ["version", "changelog", "调用约定段"]);
  assert.throws(() => planSkill(text.replace("正文", "npx @doubaoya/cli@1.2.3"), "2.0.0", "2.0.0-next.0", TEMPLATE), /既不是旧包版本/);
});

function copyRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "dby-release-"));
  for (const p of ["cli/package.json", "cli/CHANGELOG.md", "tools/call-convention.md"]) {
    cpSync(path.join(REPO_ROOT, p), path.join(root, p), { recursive: true });
  }
  for (const slug of readdirSync(path.join(REPO_ROOT, "skills"))) {
    cpSync(path.join(REPO_ROOT, "skills", slug, "SKILL.md"), path.join(root, "skills", slug, "SKILL.md"));
  }
  return root;
}

test("真跑（临时副本）：package.json 是源，13 个 SKILL.md、调用约定、CHANGELOG 一次派生；幂等", () => {
  const root = copyRepo();
  const out = execFileSync(process.execPath, [RELEASE, "2.0.1", "--root", root, "--date", "2026-10-09", "--notes", "修了一个错字", "--skip-compat-view"], { encoding: "utf8" });
  assert.match(out, /release .* → 2\.0\.1/);
  assert.equal(JSON.parse(readFileSync(path.join(root, "cli", "package.json"), "utf8")).version, "2.0.1");
  const slugs = readdirSync(path.join(root, "skills"));
  assert.ok(slugs.length >= 10);
  for (const slug of slugs) {
    const t = readFileSync(path.join(root, "skills", slug, "SKILL.md"), "utf8");
    assert.match(t, /^version: 2\.0\.1$/m, slug);
    for (const m of t.matchAll(/@doubaoya\/cli@([0-9][0-9A-Za-z.-]*)/g)) assert.equal(m[1], "2.0.1", slug);
  }
  assert.match(readFileSync(path.join(root, "cli", "CHANGELOG.md"), "utf8"), /^## 2\.0\.1 - 2026-10-09\n\n- 修了一个错字$/m);
  // 再跑一次不带版本：纯派生，零改动
  const again = execFileSync(process.execPath, [RELEASE, "--root", root, "--date", "2026-10-09", "--skip-compat-view"], { encoding: "utf8" });
  assert.match(again, /改动文件：0 个/);
  // 版本只许递增
  assert.throws(() => execFileSync(process.execPath, [RELEASE, "2.0.0", "--root", root, "--dry-run"], { stdio: "pipe" }), /低于/);
  // 拼错的开关不许被忽略
  assert.throws(() => execFileSync(process.execPath, [RELEASE, "--dryrun", "--root", root], { stdio: "pipe" }), /未知参数/);
});

test("dry-run：2.x 生成兼容视图、3.0.0 起不再生成；一个文件都不写", () => {
  const root = copyRepo();
  const before = readFileSync(path.join(root, "skills", "dby", "SKILL.md"), "utf8");
  const two = execFileSync(process.execPath, [RELEASE, "--dry-run", "2.0.0", "--root", root, "--date", "2026-10-01"], { encoding: "utf8" });
  assert.match(two, /兼容视图：生成（2\.x）。productVersion = 2\.0\.0；每个在架包 versions\[0\]\.version = 2\.0\.0/);
  const three = execFileSync(process.execPath, [RELEASE, "--dry-run", "3.0.0", "--root", root, "--date", "2026-12-01", "--notes", "x"], { encoding: "utf8" });
  assert.match(three, /兼容视图：不生成。包版本 3\.0\.0 ≥ 3\.0\.0/);
  assert.equal(readFileSync(path.join(root, "skills", "dby", "SKILL.md"), "utf8"), before, "dry-run 写了文件");
});

test("发布前检查 ⑦：已发布 / 不大于 dist-tag / 不大于同线最高 都拦；从未发布放行", () => {
  const doc = { "dist-tags": { latest: "2.1.0", next: "2.2.0-next.1" }, versions: { "2.0.0": {}, "2.1.0": {}, "2.2.0-next.1": {} } };
  assert.deepEqual(checkIncrement("2.0.0-next.0", "next", null), []);
  assert.deepEqual(checkIncrement("2.1.1", "latest", doc), []);
  assert.match(checkIncrement("2.1.0", "latest", doc).join(), /已经发布过/);
  assert.match(checkIncrement("2.0.5", "latest", doc).join(), /不大于 dist-tag latest/);
  assert.match(checkIncrement("2.2.0-next.0", "next", doc).join(), /不大于/);
  assert.deepEqual(checkIncrement("2.2.0-next.2", "next", doc), []);
});

test("发布前检查对当前工作树通过（离线核对 registry 用本地 packument：从未发布）", () => {
  const empty = path.join(mkdtempSync(path.join(tmpdir(), "dby-reg-")), "packument.json");
  writeFileSync(empty, JSON.stringify({ "dist-tags": {}, versions: {} }));
  const out = execFileSync(process.execPath, [path.join(REPO_ROOT, "cli", "scripts", "prepublish-check.mjs"), "--registry-json", empty], { encoding: "utf8" });
  assert.match(out, /全部通过/);
});
