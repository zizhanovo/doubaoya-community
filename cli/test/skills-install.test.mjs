// skills-install.test.mjs — tasks 6.1 / 6.3（spec dby-cli-distribution「skills 由 CLI 写入宿主目录」
// 「安装与更新不静默降级」「老用户一次性迁移」）。全部在临时目录里跑真 CLI 子进程；
// update 用的 release 端点与 npmjs / npmmirror 都是本机假服务，不碰任何真实 registry。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, startMock, REPO_ROOT } from "./helpers.mjs";
import { readBundle } from "../src/skills-bundle.mjs";
import { treeSnapshot } from "./fixtures/tree.mjs";

const PKG_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const BUNDLE = readBundle(path.join(REPO_ROOT, "skills"));
const SLUGS = BUNDLE.map((p) => p.slug);

const tmp = (p = "dby-skills-") => mkdtempSync(path.join(tmpdir(), p));
const skillsDir = (proj, which = ".claude") => path.join(proj, which, "skills");
const origin = (dir) => JSON.parse(readFileSync(path.join(dir, ".dby", "origin.json"), "utf8"));
const parse = (r) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(`stdout 不是 JSON（退出码 ${r.code}）：${r.stdout}\n${r.stderr}`);
  }
};

async function dby(args, env = {}) {
  return runCli([...args, "--json"], { env });
}

test("元断言：随包 skills 不为空，且每包只有 SKILL.md 与 references/", () => {
  assert.ok(SLUGS.length >= 10, `只读到 ${SLUGS.length} 个包，随包口径多半坏了`);
  for (const p of BUNDLE) {
    for (const f of p.files) assert.ok(f === "SKILL.md" || f.startsWith("references/"), `${p.slug}/${f} 不该进包`);
  }
});

test("首次安装：全部写入，每包带 .dby/origin.json，version 等于 dby --version，退出码 0", async () => {
  const proj = tmp();
  const r = await dby(["skills", "install", "--scope", "project", "--dir", proj]);
  assert.equal(r.code, 0, r.stderr);
  const out = parse(r);
  assert.equal(out.data.summary.installed, SLUGS.length);
  const ver = parse(await runCli(["--version", "--json"])).data.version;
  assert.equal(ver, PKG_VERSION);
  for (const pkg of BUNDLE) {
    const dir = path.join(skillsDir(proj), pkg.slug);
    const o = origin(dir);
    assert.deepEqual([o.installer, o.slug, o.version, o.hash], ["dby-cli", pkg.slug, ver, pkg.hash]);
    assert.ok(o.installedAt, "origin 缺安装时间");
    assert.ok(!existsSync(path.join(dir, "scripts")), `${pkg.slug} 装进了 scripts/`);
  }
  assert.ok(!existsSync(path.join(skillsDir(proj), ".dby-staging")), "旁路目录没清理");
  // 再跑一遍：全部 unchanged，不重写
  const again = parse(await dby(["skills", "install", "--dir", proj]));
  assert.equal(again.data.summary.unchanged, SLUGS.length);
});

test("用户改过的包：update 不覆盖并标明「已被修改，加 --force 覆盖」，其余包正常更新", async () => {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  // 其余包造成「本 CLI 装的旧版」：origin 里的版本改成旧的（内容未动 ⇒ 不算用户改过）
  for (const slug of SLUGS) {
    const f = path.join(skillsDir(proj), slug, ".dby", "origin.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), version: "1.9.9" }));
  }
  const edited = path.join(skillsDir(proj), "dby-write", "SKILL.md");
  writeFileSync(edited, readFileSync(edited, "utf8") + "\n我自己加的一行\n");
  const mock = await releaseAndRegistries();
  try {
    const r = await dby(["skills", "update", "--dir", proj], mock.env);
    assert.equal(r.code, 0, r.stderr);
    const out = parse(r);
    const row = out.data.results.find((x) => x.slug === "dby-write");
    assert.equal(row.action, "skipped");
    assert.match(row.reason, /已被修改，加 --force 覆盖（会先备份）/);
    assert.match(r.stderr, /dby-write：已被修改/);
    assert.ok(readFileSync(edited, "utf8").includes("我自己加的一行"), "改过的包被覆盖了");
    assert.equal(out.data.summary.updated, SLUGS.length - 1);
    for (const slug of SLUGS.filter((s) => s !== "dby-write")) assert.equal(origin(path.join(skillsDir(proj), slug)).version, PKG_VERSION);
  } finally {
    await mock.close();
  }
});

test("--force：覆盖改过的包之前先备份进 .dby-archive/，备份里是用户改过的原样", async () => {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  const edited = path.join(skillsDir(proj), "dby-write", "SKILL.md");
  const mine = readFileSync(edited, "utf8") + "\n我自己加的一行\n";
  writeFileSync(edited, mine);
  const out = parse(await dby(["skills", "install", "--dir", proj, "--force"]));
  const row = out.data.results.find((x) => x.slug === "dby-write");
  assert.equal(row.action, "updated");
  assert.ok(row.archived && row.archived.includes(".dby-archive"), JSON.stringify(row));
  assert.equal(readFileSync(path.join(row.archived, "SKILL.md"), "utf8"), mine, "备份不是改过的原样");
  assert.ok(!readFileSync(edited, "utf8").includes("我自己加的一行"), "没覆盖");
});

for (const phase of ["stage", "swap", "verify"]) {
  test(`第 3 个包写盘失败（${phase} 阶段）：只它保持原样逐字节不变，其余换入新版，退出码非 0 并指出失败包`, async () => {
    const proj = tmp();
    await dby(["skills", "install", "--dir", proj]);
    for (const slug of SLUGS) {
      const f = path.join(skillsDir(proj), slug, ".dby", "origin.json");
      writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), version: "1.9.9" }));
    }
    const third = SLUGS[2];
    const before = treeSnapshot(path.join(skillsDir(proj), third));
    const r = await dby(["skills", "install", "--dir", proj], { DBY_SKILLS_TEST_FAIL: `${third}:${phase}` });
    assert.notEqual(r.code, 0);
    const out = parse(r);
    assert.equal(out.error.code, "SKILLS_WRITE_FAILED");
    assert.match(out.error.message, new RegExp(third));
    assert.equal(treeSnapshot(path.join(skillsDir(proj), third)), before, `${third} 没有保持原样`);
    assert.equal(origin(path.join(skillsDir(proj), third)).version, "1.9.9");
    for (const slug of SLUGS.filter((s) => s !== third)) assert.equal(origin(path.join(skillsDir(proj), slug)).version, PKG_VERSION, `${slug} 没换入新版`);
    assert.ok(!existsSync(path.join(skillsDir(proj), ".dby-staging")), "旁路目录没清理");
  });
}

test("真实写盘失败（旁路目录被占且不可删）：只该包失败并保持原样", async () => {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  const third = SLUGS[2];
  const f = path.join(skillsDir(proj), third, ".dby", "origin.json");
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), version: "1.9.9" }));
  const blocker = path.join(skillsDir(proj), ".dby-staging", third);
  mkdirSync(blocker, { recursive: true });
  writeFileSync(path.join(blocker, "x"), "占位");
  chmodSync(blocker, 0o555);
  const before = treeSnapshot(path.join(skillsDir(proj), third));
  try {
    const r = await dby(["skills", "install", "--dir", proj]);
    assert.equal(r.code, 1, r.stderr);
    assert.deepEqual(parse(r).data.results.filter((x) => x.action === "failed").map((x) => x.slug), [third]);
    assert.equal(treeSnapshot(path.join(skillsDir(proj), third)), before);
  } finally {
    chmodSync(blocker, 0o755);
  }
});

test("软链：.claude/skills/dby → .agents/skills/dby 时写进真实路径，软链本身不变", async () => {
  const proj = tmp();
  mkdirSync(path.join(skillsDir(proj, ".agents"), "dby"), { recursive: true });
  writeFileSync(path.join(skillsDir(proj, ".agents"), "dby", "SKILL.md"), "---\nname: dby\n---\n");
  mkdirSync(skillsDir(proj), { recursive: true });
  const link = path.join(skillsDir(proj), "dby");
  symlinkSync("../../.agents/skills/dby", link);
  // 先让 .agents 里那份成为「本 CLI 装的旧版」
  mkdirSync(path.join(skillsDir(proj, ".agents"), "dby", ".dby"));
  const r0 = await dby(["skills", "migrate", "--dir", proj, "--target", "claude"]);
  assert.equal(r0.code, 0, r0.stderr);
  assert.ok(lstatSync(link).isSymbolicLink(), "软链被替换成了目录");
  assert.equal(readlinkSync(link), "../../.agents/skills/dby");
  const real = path.join(skillsDir(proj, ".agents"), "dby");
  assert.equal(origin(real).installer, "dby-cli");
  assert.equal(readFileSync(path.join(real, "SKILL.md"), "utf8"), readFileSync(path.join(REPO_ROOT, "skills", "dby", "SKILL.md"), "utf8"));
  const row = parse(r0).data.results.find((x) => x.slug === "dby");
  assert.equal(row.real, realpathSync(real));
  // 两个目标都选：同一真实目录只写一次
  const r1 = parse(await dby(["skills", "install", "--dir", proj, "--target", "all"]));
  assert.equal(r1.data.results.filter((x) => x.slug === "dby").length, 1);
  assert.ok(lstatSync(link).isSymbolicLink());
});

test("status 只读：前后目录树哈希不变；目标目录不存在时也不创建", async () => {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  writeFileSync(path.join(skillsDir(proj), "dby-write", "SKILL.md"), "改过\n");
  mkdirSync(path.join(skillsDir(proj), "dby-old", "scripts"), { recursive: true });
  const before = treeSnapshot(proj);
  const r = await dby(["skills", "status", "--dir", proj]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(treeSnapshot(proj), before, "status 改动了目标目录");
  const states = Object.fromEntries(parse(r).data.skills.map((s) => [s.slug, s.state]));
  assert.equal(states["dby-write"], "modified");
  assert.equal(states.dby, "current");

  const empty = tmp();
  const snap = treeSnapshot(empty);
  const r2 = await dby(["skills", "status", "--dir", empty, "--target", "all"]);
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(treeSnapshot(empty), snap);
  assert.ok(!existsSync(path.join(empty, ".claude")));
});

/** 造一套「1.x 渠道装的」旧目录：带 scripts/、没有 origin.json。 */
function seedLegacy(root, slugs = SLUGS) {
  for (const slug of slugs) {
    const d = path.join(root, slug);
    mkdirSync(path.join(d, "scripts"), { recursive: true });
    writeFileSync(path.join(d, "SKILL.md"), `---\nname: ${slug}\nversion: 1.0.0\n---\n1.x 旧版 ${slug}\n`);
    writeFileSync(path.join(d, "scripts", "old.mjs"), "console.log('1.x');\n");
  }
}

test("migrate：1.x 旧目录整体进归档，新包带 origin 且无 scripts/，输出列出归档路径", async () => {
  const proj = tmp();
  seedLegacy(skillsDir(proj));
  writeFileSync(path.join(skillsDir(proj), "别人家的.md"), "不碰");
  mkdirSync(path.join(skillsDir(proj), "other-skill"));
  writeFileSync(path.join(skillsDir(proj), "other-skill", "SKILL.md"), "别人家的");
  // install/update 不碰旧渠道的包，提示先 migrate
  const pre = parse(await dby(["skills", "install", "--dir", proj]));
  assert.ok(pre.data.results.every((x) => x.action === "skipped" && /migrate/.test(x.reason)));
  const r = await dby(["skills", "migrate", "--dir", proj]);
  assert.equal(r.code, 0, r.stderr);
  const out = parse(r);
  assert.equal(out.data.summary.migrated, SLUGS.length);
  assert.equal(out.data.archivedPaths.length, SLUGS.length);
  for (const slug of SLUGS) {
    const dir = path.join(skillsDir(proj), slug);
    assert.equal(origin(dir).installer, "dby-cli");
    assert.ok(!existsSync(path.join(dir, "scripts")), `${slug} 迁移后还有 scripts/`);
    const archived = out.data.results.find((x) => x.slug === slug).archived;
    assert.ok(readFileSync(path.join(archived, "SKILL.md"), "utf8").includes("1.x 旧版"), "归档里不是旧内容");
    assert.ok(existsSync(path.join(archived, "scripts", "old.mjs")));
  }
  assert.equal(readFileSync(path.join(skillsDir(proj), "other-skill", "SKILL.md"), "utf8"), "别人家的");
});

test("migrate：第 5 个包换入后复核失败 → 从归档还原为旧内容，其余保留新版，退出码非 0", async () => {
  const proj = tmp();
  seedLegacy(skillsDir(proj));
  const fifth = SLUGS[4];
  const before = treeSnapshot(path.join(skillsDir(proj), fifth));
  const r = await dby(["skills", "migrate", "--dir", proj], { DBY_SKILLS_TEST_FAIL: `${fifth}:verify` });
  assert.notEqual(r.code, 0);
  assert.match(parse(r).error.message, new RegExp(fifth));
  assert.equal(treeSnapshot(path.join(skillsDir(proj), fifth)), before, "复核失败的包没还原成旧内容");
  assert.ok(existsSync(path.join(skillsDir(proj), fifth, "scripts", "old.mjs")));
  for (const slug of SLUGS.filter((s) => s !== fifth)) assert.equal(origin(path.join(skillsDir(proj), slug)).installer, "dby-cli");
});

test("下架：本 CLI 装过、随包已不再有的包移进归档，不硬删", async () => {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  const gone = path.join(skillsDir(proj), "dby-gone");
  mkdirSync(path.join(gone, ".dby"), { recursive: true });
  writeFileSync(path.join(gone, "SKILL.md"), "下架的包");
  writeFileSync(path.join(gone, ".dby", "origin.json"), JSON.stringify({ installer: "dby-cli", slug: "dby-gone", version: "1.0.0", hash: "x" }));
  const out = parse(await dby(["skills", "install", "--dir", proj]));
  const row = out.data.results.find((x) => x.slug === "dby-gone");
  assert.equal(row.action, "archived");
  assert.ok(!existsSync(gone));
  assert.equal(readFileSync(path.join(row.archived, "SKILL.md"), "utf8"), "下架的包");
});

// ── update 的目标版本（tasks 6.3）────────────────────────────────────────────

const INTEGRITY = "sha512-" + Buffer.from("fake-tarball").toString("base64");

function packument(versions) {
  return {
    name: "@doubaoya/cli",
    "dist-tags": { latest: versions.at(-1)?.[0] },
    versions: Object.fromEntries(versions.map(([v, integrity]) => [v, { name: "@doubaoya/cli", version: v, dist: { integrity, tarball: `http://x/cli-${v}.tgz` } }]))
  };
}

/** 假服务：release 端点 + 两个假 registry。closed = 该源不可达（端口已关）；"HANG" = 超时。 */
async function releaseAndRegistries({ release = PKG_VERSION, npmjs = [[PKG_VERSION, INTEGRITY]], npmmirror = [[PKG_VERSION, INTEGRITY]] } = {}) {
  const api = await startMock({ "GET /api/cli/release": { success: true, data: { package: "@doubaoya/cli", version: release, distTags: {}, highlights: [] } } });
  const reg = async (spec) => {
    if (spec === "closed") {
      const m = await startMock({});
      await m.close();
      return { url: m.url, close: async () => {} };
    }
    return startMock({ "GET /@doubaoya%2fcli": spec === "HANG" ? () => "HANG" : spec === 404 ? { status: 404, json: { error: "not_found" } } : packument(spec) });
  };
  const a = await reg(npmjs);
  const b = await reg(npmmirror);
  return {
    env: { DOUBAOYA_BASE_URL: api.url, DBY_REGISTRY_NPMJS: a.url, DBY_REGISTRY_NPMMIRROR: b.url, DOUBAOYA_TIMEOUT_MS: "800" },
    api,
    close: async () => {
      await api.close();
      await a.close();
      await b.close();
    }
  };
}

async function updateCase(opts) {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  for (const slug of SLUGS) {
    const f = path.join(skillsDir(proj), slug, ".dby", "origin.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), version: "1.9.9" }));
  }
  const before = treeSnapshot(proj);
  const mock = await releaseAndRegistries(opts);
  try {
    const r = await dby(["skills", "update", "--dir", proj], mock.env);
    return { r, out: parse(r), unchanged: treeSnapshot(proj) === before, proj };
  } finally {
    await mock.close();
  }
}

test("update 正常：两源都可见且 integrity 一致 → 装入，输出写明来源与版本", async () => {
  const { r, out } = await updateCase({});
  assert.equal(r.code, 0, r.stderr);
  assert.equal(out.data.release.version, PKG_VERSION);
  assert.equal(out.data.release.source, "npmjs");
  assert.equal(out.data.summary.updated, SLUGS.length);
});

test("镜像未同步：正式版 2.1.0，npmjs 不可达，npmmirror 最高只有 2.0.3 → 非 0，说明未同步，不装 2.0.3、不写盘", async () => {
  const { r, out, unchanged } = await updateCase({ release: "2.1.0", npmjs: "closed", npmmirror: [["2.0.3", INTEGRITY]] });
  assert.notEqual(r.code, 0);
  assert.equal(out.error.code, "VERSION_NOT_SYNCED");
  assert.match(out.error.message, /npmmirror 尚未同步 @doubaoya\/cli@2\.1\.0/);
  assert.match(out.error.message, /2\.0\.3/);
  assert.ok(unchanged, "查询不过却动了本地目录");
});

test("仅 npmmirror 可达：从 npmmirror 取该确切版本，输出写明使用了 npmmirror", async () => {
  const { r, out } = await updateCase({ npmjs: "closed" });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(out.data.release.source, "npmmirror");
  const npmjs = out.data.release.registries.find((x) => x.name === "npmjs");
  assert.equal(npmjs.reachable, false);
});

test("仅 npmmirror 可达且正式版更新：提示升级命令带 npmmirror，CLI 不自我升级", async () => {
  const { r, out } = await updateCase({ release: "9.9.9", npmjs: "closed", npmmirror: [["9.9.9", INTEGRITY]] });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(out.data.upgrade.available, true);
  assert.match(out.data.upgrade.command, /npm i -g @doubaoya\/cli@9\.9\.9 --registry=https:\/\/registry\.npmmirror\.com/);
  assert.equal(out.data.running, PKG_VERSION);
  assert.equal(out.data.version, PKG_VERSION, "装进去的必须是正在运行的版本");
});

test("两源 integrity 不一致 → 非 0，不安装", async () => {
  const { r, out, unchanged } = await updateCase({ npmmirror: [[PKG_VERSION, "sha512-DIFFERENT"]] });
  assert.notEqual(r.code, 0);
  assert.equal(out.error.code, "INTEGRITY_MISMATCH");
  assert.ok(unchanged);
});

test("两源都超时 → 退出码 5，写明两个源都查询失败，本地已装内容不变", async () => {
  const { r, out, unchanged } = await updateCase({ npmjs: "HANG", npmmirror: "HANG" });
  assert.equal(r.code, 5, r.stderr);
  assert.equal(out.error.code, "REGISTRY_UNREACHABLE");
  assert.match(out.error.message, /两个源都查询失败/);
  assert.match(out.error.message, /npmjs/);
  assert.match(out.error.message, /npmmirror/);
  assert.ok(unchanged);
});

test("release 端点给 version:null（还没有正式版）→ 退出码 5，不写盘", async () => {
  const { r, out, unchanged } = await updateCase({ release: null });
  assert.equal(r.code, 5, r.stderr);
  assert.equal(out.error.code, "RELEASE_UNKNOWN");
  assert.ok(unchanged);
});

test("release 端点不可达 → 退出码 5，不写盘", async () => {
  const proj = tmp();
  await dby(["skills", "install", "--dir", proj]);
  const before = treeSnapshot(proj);
  const r = await dby(["skills", "update", "--dir", proj], { DOUBAOYA_BASE_URL: "http://127.0.0.1:9", DOUBAOYA_TIMEOUT_MS: "800" });
  assert.equal(r.code, 5, r.stderr);
  assert.equal(parse(r).error.code, "RELEASE_QUERY_FAILED");
  assert.equal(treeSnapshot(proj), before);
});

test("scope=user 写进 HOME 下的目录；项目目录不受影响", async () => {
  const home = tmp("dby-home-");
  const r = await runCli(["skills", "install", "--scope", "user", "--target", "agents", "--json"], { env: { HOME: home } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(origin(path.join(home, ".agents", "skills", "dby")).installer, "dby-cli");
  assert.ok(!existsSync(path.join(home, ".claude")));
  rmSync(home, { recursive: true, force: true });
});
