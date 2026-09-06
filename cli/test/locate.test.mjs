// locate.test.mjs — 任务 4.1：兄弟包定位 dby-api 的引导代码（规格 dby-cli-coverage「装好即可达」）。
// 四个包（本次只有 dby-write / dby-charter 落地）各自一份 locate-dby.mjs，逐字一致；
// 这里既核逻辑本身，也核两份拷贝没有漂移。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startMock, runNode, REPO_ROOT, TEST_KEY, fail } from "./helpers.mjs";

const DBY_WRITE_SCRIPTS = path.join(REPO_ROOT, "skills/dby-write/scripts");
const DBY_CHARTER_SCRIPTS = path.join(REPO_ROOT, "skills/dby-charter/scripts");
const DBY_API_LIB = path.join(REPO_ROOT, "skills/dby-api/scripts/lib");
const DBY_API_ENTRY = path.join(REPO_ROOT, "skills/dby-api/scripts/dby.mjs");

const importLocate = (scriptsDir) =>
  import(pathToFileURL(path.join(scriptsDir, "lib/locate-dby.mjs")).href);

// ── (a) 正常布局：真实仓库里 dby-write/scripts 与 dby-charter/scripts 都能解析到 dby-api/scripts/lib ──
test("locateDbyLib：正常布局下从 dby-write/scripts 解析到 dby-api/scripts/lib", async () => {
  const { locateDbyLib } = await importLocate(DBY_WRITE_SCRIPTS);
  const fromUrl = pathToFileURL(path.join(DBY_WRITE_SCRIPTS, "write.mjs")).href;
  assert.equal(locateDbyLib(fromUrl), DBY_API_LIB);
});

test("locateDbyLib：正常布局下从 dby-charter/scripts 解析到 dby-api/scripts/lib", async () => {
  const { locateDbyLib } = await importLocate(DBY_CHARTER_SCRIPTS);
  const fromUrl = pathToFileURL(path.join(DBY_CHARTER_SCRIPTS, "charter.mjs")).href;
  assert.equal(locateDbyLib(fromUrl), DBY_API_LIB);
});

test("locate-dby.mjs：dby-write 与 dby-charter 两份拷贝逐字一致（四个包必须逐字一致，先钉已落地的两份）", async () => {
  const w = await readFile(path.join(DBY_WRITE_SCRIPTS, "lib/locate-dby.mjs"), "utf8");
  const c = await readFile(path.join(DBY_CHARTER_SCRIPTS, "lib/locate-dby.mjs"), "utf8");
  assert.equal(w, c);
});

// ── (b) 软链安装：skills 整棵目录被软链到别处，仍按真实路径解析成功 ──────────────────────────
test("locateDbyLib：skills 目录是软链时，按真实路径解析仍成功", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "dby-locate-symlink-"));
  const link = path.join(tmp, "skills");
  try {
    await symlink(path.join(REPO_ROOT, "skills"), link, "dir");
    const { locateDbyLib } = await importLocate(DBY_WRITE_SCRIPTS); // 模块本身从哪导入无所谓，只有 fromUrl 走软链
    const fromUrl = pathToFileURL(path.join(link, "dby-write/scripts/write.mjs")).href;
    // realpathSync 把软链解回真实仓库路径，落点应与 (a) 完全一致
    assert.equal(locateDbyLib(fromUrl), DBY_API_LIB);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

/** 把 dby-write 单独拷到一个干净的 tmp 目录（只带 write.mjs 与它自己的 locate-dby.mjs，
 *  刻意不带 dby-api），模拟「用户只装了 dby-write」。 */
async function isolateWriteOnly() {
  const tmp = await mkdtemp(path.join(tmpdir(), "dby-locate-isolated-"));
  const scriptsDir = path.join(tmp, "scripts");
  await mkdir(path.join(scriptsDir, "lib"), { recursive: true });
  await writeFile(path.join(scriptsDir, "write.mjs"), await readFile(path.join(DBY_WRITE_SCRIPTS, "write.mjs")));
  await writeFile(
    path.join(scriptsDir, "lib/locate-dby.mjs"),
    await readFile(path.join(DBY_WRITE_SCRIPTS, "lib/locate-dby.mjs"))
  );
  return { tmp, scriptsDir };
}

// ── (c) 没装 dby-api → 退出码 3，stderr 指明 MISSING_DBY_API，且不尝试自己拼请求 ──────────────
test("locateDbyLib：只装 dby-write 没装 dby-api → 退出码 3 且 stderr 含 MISSING_DBY_API", async () => {
  const { tmp, scriptsDir } = await isolateWriteOnly();
  try {
    const r = await runNode(path.join(scriptsDir, "write.mjs"), ["prep"], {
      env: { DOUBAOYA_API_KEY: TEST_KEY } // 不设 DBY_CLI，也没有 dby-api 兄弟目录
    });
    assert.equal(r.code, 3, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /MISSING_DBY_API/);
    assert.match(r.stderr, /dby-update|DBY_CLI/); // 指引安装方式
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ── (d) 设 DBY_CLI 指向真实 dby.mjs → 即使布局被隔离也能定位并真的打到 request() ────────────
test("locateDbyLib：设 DBY_CLI 指向真实 dby.mjs 后，隔离布局下仍能定位并发出请求", async () => {
  const { tmp, scriptsDir } = await isolateWriteOnly();
  // 本地 mock 对 401 的分类不需要真 key/真上游：只要证明请求真的经由 dby-api 的 request() 发出去了
  // （能收到并正确分类 401），就说明 DBY_CLI 定位成功——不是卡在 MISSING_DBY_API 上。
  const mock = await startMock({ "GET /api/ip-profile": { status: 401, json: fail("UNAUTHORIZED", "无效密钥") } });
  try {
    const r = await runNode(path.join(scriptsDir, "write.mjs"), ["prep"], {
      env: { DOUBAOYA_API_KEY: TEST_KEY, DOUBAOYA_BASE_URL: mock.url, DBY_CLI: DBY_API_ENTRY }
    });
    // 401 对齐 dby-cli 契约 EXIT.AUTH=4（write.mjs 任务 4.1 同批已把 api() 的退出码对齐到这个值）。
    assert.equal(r.code, 4, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /MISSING_DBY_API/);
    assert.match(r.stderr, /密钥无效或缺失|UNAUTHORIZED/);
    assert.equal(mock.hits.length, 1, "确实打到了 mock，不是本地短路");
  } finally {
    await mock.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
