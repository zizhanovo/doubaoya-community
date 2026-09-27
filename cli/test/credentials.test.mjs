// credentials.test.mjs — tasks 2.7 / spec dby-cli-auth「凭证解析只有一套顺序」「凭证文件与 key 不外泄」。
// 四种情形：只有 env、只有凭证文件、两者都有（env 优先）、两者皆无（退出码 4，不发请求，提到 dby login）；
// 外加：凭证文件权限宽于 0600 时 stderr 警告且命令照常执行。每条都断言任何输出流里没有完整 key。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, startMock, ok } from "./helpers.mjs";

const ENV_KEY = "dyh_EnvKey1234567890abcdef";
const FILE_KEY = "dyh_FileKey0987654321zyxwv";

function homeWithCredentials(apiKey, { mode = 0o600, baseUrl } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "dby-cred-"));
  const dir = path.join(home, ".doubaoya");
  mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, "credentials");
  writeFileSync(file, JSON.stringify({ apiKey, keyPrefix: apiKey.slice(0, 8), ...(baseUrl ? { baseUrl } : {}) }));
  chmodSync(file, mode);
  return { home, file };
}

async function whoamiMock() {
  const seen = [];
  const mock = await startMock({
    "GET /api/agent/whoami": (req) => {
      seen.push(req.headers.authorization);
      return ok({ user: { id: "u1", email: "a@b.c" }, authVia: "apiKey" });
    },
    "GET /api/drafts": (req) => {
      seen.push(req.headers.authorization);
      return ok({ items: [] });
    }
  });
  return { mock, seen };
}

function assertNoFullKey(r) {
  const all = r.stdout + r.stderr;
  for (const k of [ENV_KEY, FILE_KEY]) assert.ok(!all.includes(k), `🔴 输出里出现了完整 key：${k.slice(0, 8)}…`);
}

test("只有环境变量：用 env 的 key，keySource=env，只显示前缀", async () => {
  const { mock, seen } = await whoamiMock();
  try {
    const home = mkdtempSync(path.join(tmpdir(), "dby-cred-empty-"));
    const r = await runCli(["whoami", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: ENV_KEY } });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.keySource, "env");
    assert.equal(data.keyPrefix, `${ENV_KEY.slice(0, 8)}…`);
    assert.deepEqual(seen, [`Bearer ${ENV_KEY}`]);
    assertNoFullKey(r);
  } finally {
    await mock.close();
  }
});

test("只有凭证文件：用文件里的 key，keySource=credentials", async () => {
  const { mock, seen } = await whoamiMock();
  try {
    const { home } = homeWithCredentials(FILE_KEY);
    const r = await runCli(["whoami", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.keySource, "credentials");
    assert.equal(data.keyPrefix, `${FILE_KEY.slice(0, 8)}…`);
    assert.deepEqual(seen, [`Bearer ${FILE_KEY}`]);
    assert.equal(r.stderr, "", "0600 的凭证文件不该有任何警告");
    assertNoFullKey(r);
  } finally {
    await mock.close();
  }
});

test("两者都有：环境变量优先", async () => {
  const { mock, seen } = await whoamiMock();
  try {
    const { home } = homeWithCredentials(FILE_KEY);
    const r = await runCli(["whoami", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: ENV_KEY } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.keySource, "env");
    assert.deepEqual(seen, [`Bearer ${ENV_KEY}`]);
    assertNoFullKey(r);
  } finally {
    await mock.close();
  }
});

test("两者皆无：退出码 4、不发请求、remediation 同时给出 dby login 与环境变量", async () => {
  const { mock, seen } = await whoamiMock();
  try {
    const home = mkdtempSync(path.join(tmpdir(), "dby-cred-none-"));
    const r = await runCli(["draft", "list", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 4, r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.error.code, "MISSING_API_KEY");
    assert.match(env.error.remediation, /dby login/);
    assert.match(env.error.remediation, /DOUBAOYA_API_KEY/);
    assert.deepEqual(seen, [], "没有 key 时不该发出任何请求");
  } finally {
    await mock.close();
  }
});

test("凭证文件 0644：stderr 警告并给出 chmod 600，命令照常执行", async () => {
  const { mock } = await whoamiMock();
  try {
    const { home, file } = homeWithCredentials(FILE_KEY, { mode: 0o644 });
    const r = await runCli(["whoami", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /0644/);
    assert.match(r.stderr, /chmod 600/);
    assert.ok(r.stderr.includes(file));
    assertNoFullKey(r);
    // local 命令同样提醒（「运行任一命令」）
    const r2 = await runCli(["routes", "--json"], { env: { HOME: home } });
    assert.equal(r2.code, 0);
    assert.match(r2.stderr, /chmod 600/);
  } finally {
    await mock.close();
  }
});

test("凭证文件里的 key 被网页吊销：退出码 4，remediation 指向重新 dby login", async () => {
  const mock = await startMock({
    "GET /api/agent/whoami": { status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "key 已吊销" } } }
  });
  try {
    const { home } = homeWithCredentials(FILE_KEY);
    const r = await runCli(["whoami", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: mock.url } });
    assert.equal(r.code, 4);
    assert.match(JSON.parse(r.stdout).error.remediation, /dby login/);
    assertNoFullKey(r);
  } finally {
    await mock.close();
  }
});
