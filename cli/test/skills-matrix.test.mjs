// skills-matrix.test.mjs — tasks 6.1 的四种环境矩阵（design D11 / spec「老用户一次性迁移」：迁移 MUST 在
// 无全局权限、项目级安装、软链、仅 npmmirror 可达四种环境下都可完成）。
//
// 真 `npm pack`（隔离副本）→ 本机假 registry（假 npmjs、假 npmmirror 各一个 HTTP 服务）→ 真 `npm i` →
// 用装出来的 bin 跑 `dby skills migrate|update`。🔴 不打任何真实 registry：npm 的 --registry 与
// CLI 的 DBY_REGISTRY_* 都指向本机端口；「不可达」用一个已关闭的本机端口模拟。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { packIsolated } from "../scripts/pack-isolated.mjs";
import { startMock } from "./helpers.mjs";
import { treeSnapshot } from "./fixtures/tree.mjs";

const WORK = mkdtempSync(path.join(tmpdir(), "dby-matrix-"));
let packed;
let npmjs; // 假 npmjs
let npmmirror; // 假 npmmirror
let release; // 假 doubaoya /api/cli/release
let closedUrl; // 不可达的源

async function fakeRegistry(label) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    const url = new URL(req.url, "http://x");
    const base = `http://127.0.0.1:${server.address().port}`;
    if (url.pathname === "/@doubaoya%2fcli" || url.pathname === "/@doubaoya%2Fcli" || url.pathname === "/@doubaoya/cli") {
      const v = packed.version;
      const pkg = JSON.parse(readFileSync(path.join(packed.extracted, "package.json"), "utf8"));
      const doc = {
        name: "@doubaoya/cli",
        "dist-tags": { latest: v },
        versions: {
          [v]: {
            name: "@doubaoya/cli", version: v, bin: pkg.bin, engines: pkg.engines, dependencies: {},
            dist: { tarball: `${base}/@doubaoya/cli/-/${packed.filename}`, integrity: packed.integrity, shasum: packed.shasum }
          }
        }
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(doc));
      return;
    }
    if (url.pathname.endsWith(`/-/${packed.filename}`)) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(readFileSync(packed.tarball));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `${label}: not found ${url.pathname}` }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) };
}

before(async () => {
  packed = packIsolated(path.join(WORK, "pack"), { extract: true });
  npmjs = await fakeRegistry("npmjs");
  npmmirror = await fakeRegistry("npmmirror");
  release = await startMock({ "GET /api/cli/release": { success: true, data: { package: "@doubaoya/cli", version: packed.version, distTags: {}, highlights: [] } } });
  const dead = await startMock({});
  closedUrl = dead.url;
  await dead.close();
});

after(async () => {
  await npmjs?.close();
  await npmmirror?.close();
  await release?.close();
});

function npmEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(WORK, "home"),
    npm_config_cache: path.join(WORK, "npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_fetch_retries: "0",
    ...extra
  };
}

function newProject(name) {
  const proj = path.join(WORK, name);
  mkdirSync(proj, { recursive: true });
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: `probe-${name}`, version: "0.0.0", private: true }));
  return proj;
}

/** 1.x 渠道装的全集：每个包带 scripts/、没有 .dby/origin.json。 */
function seedLegacy(root) {
  const slugs = readdirSync(path.join(packed.extracted, "skills")).sort();
  for (const slug of slugs) {
    mkdirSync(path.join(root, slug, "scripts"), { recursive: true });
    writeFileSync(path.join(root, slug, "SKILL.md"), `---\nname: ${slug}\nversion: 1.0.0\n---\n1.x\n`);
    writeFileSync(path.join(root, slug, "scripts", "old.mjs"), "// 1.x\n");
  }
  return slugs;
}

// 🔴 必须异步：假 registry 与测试同进程，spawnSync 会卡住事件循环，npm 永远等不到响应。
function run(cmd, args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function assertMigrated(root, slugs, { version }) {
  for (const slug of slugs) {
    const dir = path.join(root, slug);
    const o = JSON.parse(readFileSync(path.join(dir, ".dby", "origin.json"), "utf8"));
    assert.equal(o.installer, "dby-cli", slug);
    assert.equal(o.version, version, slug);
    assert.ok(!existsSync(path.join(dir, "scripts")), `${slug} 迁移后还有 scripts/`);
  }
}

test("矩阵①无全局权限：全局 prefix 只读 → npm i -D + npx dby skills migrate 完成，全局目录零改动", { timeout: 240_000 }, async () => {
  const globalPrefix = path.join(WORK, "global-ro");
  mkdirSync(globalPrefix, { recursive: true }); // 空的只读 prefix：npm -g 连 lib/ 都建不出来
  chmodSync(globalPrefix, 0o555);
  const before = treeSnapshot(globalPrefix);
  const proj = newProject("no-global");
  const env = npmEnv({ npm_config_prefix: globalPrefix });
  try {
    // 全局装本来就会失败（佐证「无全局权限」这个前提是真的）
    const g = await run("npm", ["i", "-g", `@doubaoya/cli@${packed.version}`, `--registry=${npmjs.url}`], { cwd: proj, env });
    assert.notEqual(g.code, 0, "全局 prefix 可写，前提不成立");
    const i = await run("npm", ["i", "-D", `@doubaoya/cli@${packed.version}`, `--registry=${npmjs.url}`], { cwd: proj, env });
    assert.equal(i.code, 0, i.stderr);
    const slugs = seedLegacy(path.join(proj, ".claude", "skills"));
    const m = await run("npx", ["--no-install", "dby", "skills", "migrate", "--scope", "project", "--json"], { cwd: proj, env });
    assert.equal(m.code, 0, m.stderr + m.stdout);
    assertMigrated(path.join(proj, ".claude", "skills"), slugs, { version: packed.version });
    const ver = JSON.parse((await run("npx", ["--no-install", "dby", "--version", "--json"], { cwd: proj, env })).stdout).data.version;
    assert.equal(ver, packed.version);
  } finally {
    chmodSync(globalPrefix, 0o755);
  }
  chmodSync(globalPrefix, 0o555);
  assert.equal(treeSnapshot(globalPrefix), before, "全局 prefix 被写了");
  chmodSync(globalPrefix, 0o755);
});

test("矩阵②项目级安装：全局装 CLI，skills 装进项目 scope（--dir），HOME 下零写入", { timeout: 240_000 }, async () => {
  const globalPrefix = path.join(WORK, "global-rw");
  mkdirSync(globalPrefix, { recursive: true });
  const env = npmEnv({ npm_config_prefix: globalPrefix });
  const i = await run("npm", ["i", "-g", `@doubaoya/cli@${packed.version}`, `--registry=${npmjs.url}`], { cwd: WORK, env });
  assert.equal(i.code, 0, i.stderr);
  const dby = path.join(globalPrefix, "bin", "dby");
  const proj = newProject("project-scope");
  const slugs = seedLegacy(path.join(proj, ".agents", "skills"));
  const homeBefore = treeSnapshot(env.HOME);
  const m = await run(dby, ["skills", "migrate", "--scope", "project", "--dir", proj, "--json"], { cwd: WORK, env });
  assert.equal(m.code, 0, m.stderr + m.stdout);
  assertMigrated(path.join(proj, ".agents", "skills"), slugs, { version: packed.version });
  const st = await run(dby, ["skills", "status", "--dir", proj, "--json"], { cwd: WORK, env });
  assert.ok(JSON.parse(st.stdout).data.skills.every((s) => s.state === "current"));
  assert.equal(treeSnapshot(env.HOME), homeBefore, "项目级安装写到了 HOME");
});

test("矩阵③软链：.claude/skills/dby-* → .agents/skills/dby-*，migrate 写进真实路径，软链不变", { timeout: 240_000 }, async () => {
  const proj = newProject("symlink");
  const env = npmEnv();
  const i = await run("npm", ["i", "-D", `@doubaoya/cli@${packed.version}`, `--registry=${npmjs.url}`], { cwd: proj, env });
  assert.equal(i.code, 0, i.stderr);
  const slugs = seedLegacy(path.join(proj, ".agents", "skills"));
  mkdirSync(path.join(proj, ".claude", "skills"), { recursive: true });
  for (const slug of slugs) symlinkSync(`../../.agents/skills/${slug}`, path.join(proj, ".claude", "skills", slug));
  const m = await run("npx", ["--no-install", "dby", "skills", "migrate", "--target", "all", "--json"], { cwd: proj, env });
  assert.equal(m.code, 0, m.stderr + m.stdout);
  const out = JSON.parse(m.stdout);
  assert.equal(out.data.summary.migrated, slugs.length, "同一真实目录应只迁一次");
  for (const slug of slugs) {
    const link = path.join(proj, ".claude", "skills", slug);
    assert.ok(lstatSync(link).isSymbolicLink(), `${slug} 软链被替换`);
    assert.equal(readlinkSync(link), `../../.agents/skills/${slug}`);
  }
  assertMigrated(path.join(proj, ".agents", "skills"), slugs, { version: packed.version });
});

test("矩阵④仅 npmmirror 可达：npm 走镜像装上确切版本；dby skills migrate 完成、update 写明用了 npmmirror", { timeout: 240_000 }, async () => {
  const proj = newProject("mirror-only");
  const env = npmEnv();
  // 调用约定第 3 步：先 npmjs（不可达）→ 同一版本换 npmmirror
  const first = await run("npm", ["i", "-D", `@doubaoya/cli@${packed.version}`, `--registry=${closedUrl}`, "--fetch-timeout=3000"], { cwd: proj, env });
  assert.notEqual(first.code, 0, "npmjs 应不可达");
  const i = await run("npm", ["i", "-D", `@doubaoya/cli@${packed.version}`, `--registry=${npmmirror.url}`], { cwd: proj, env });
  assert.equal(i.code, 0, i.stderr);
  const slugs = seedLegacy(path.join(proj, ".claude", "skills"));
  const m = await run("npx", ["--no-install", "dby", "skills", "migrate", "--json"], { cwd: proj, env });
  assert.equal(m.code, 0, m.stderr + m.stdout);
  assertMigrated(path.join(proj, ".claude", "skills"), slugs, { version: packed.version });
  const cliEnv = { ...env, DOUBAOYA_BASE_URL: release.url, DBY_REGISTRY_NPMJS: closedUrl, DBY_REGISTRY_NPMMIRROR: npmmirror.url, DOUBAOYA_TIMEOUT_MS: "3000" };
  const u = await run("npx", ["--no-install", "dby", "skills", "update", "--json"], { cwd: proj, env: cliEnv });
  assert.equal(u.code, 0, u.stderr + u.stdout);
  const out = JSON.parse(u.stdout);
  assert.equal(out.data.release.source, "npmmirror");
  assert.equal(out.data.release.version, packed.version);
  assert.equal(out.data.release.integrity, packed.integrity, "镜像上的 integrity 应等于 tarball 实算值");
});
