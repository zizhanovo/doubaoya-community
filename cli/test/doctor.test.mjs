// doctor.test.mjs — spec「版本与自诊断」：--version 输出版本；doctor 全过 0 / 有项不过 3。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

const pkg = createRequire(import.meta.url)("../package.json");

const doctorRoutes = {
  "GET /api/skills": ok({ total: 17, items: [] }),
  "GET /api/ip-profile": ok({ profile: { id: "p1" } })
};

test("dby --version 输出 package.json 里的版本", async () => {
  const r = await runCli(["--version"], { env: {} });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test("Scenario: doctor 全过 —— 退出码 0，--json 下逐项 ok:true", async () => {
  const mock = await startMock(doctorRoutes);
  try {
    const r = await runCli(["doctor", "--json"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { ok: okFlag, data } = JSON.parse(r.stdout);
    assert.equal(okFlag, true);
    assert.equal(data.version, pkg.version);
    assert.equal(data.checks.length, 3);
    for (const c of data.checks) assert.equal(c.ok, true, `${c.name}: ${c.detail}`);
  } finally {
    await mock.close();
  }
});

test("doctor 有项不过（缺 key）—— 退出码 3，逐项结果仍在 data 里", async () => {
  const mock = await startMock(doctorRoutes);
  try {
    const r = await runCli(["doctor"], { env: { DOUBAOYA_BASE_URL: mock.url } }); // 无 key
    assert.equal(r.code, 3);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "DOCTOR_FAILED");
    const byName = Object.fromEntries(parsed.data.checks.map((c) => [c.name, c]));
    assert.equal(byName.api_key.ok, false);
    assert.equal(byName.service.ok, true, "服务连通性检查不依赖 key");
    assert.equal(byName.auth.ok, false);
    // 🔴 detail 里绝不含密钥内容（本例无 key，防的是有 key 时的回显——见 contract 测试）
  } finally {
    await mock.close();
  }
});

test("doctor：key 无效时 auth 检查不过，退出码 3", async () => {
  const mock = await startMock({
    ...doctorRoutes,
    "GET /api/ip-profile": { status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "无效" } } }
  });
  try {
    const r = await runCli(["doctor"], { env: envFor(mock) });
    assert.equal(r.code, 3);
    const byName = Object.fromEntries(JSON.parse(r.stdout).data.checks.map((c) => [c.name, c]));
    assert.equal(byName.auth.ok, false);
    assert.match(byName.auth.detail, /密钥无效/);
    assert.ok(!r.stdout.includes("dyh_test"), "密钥内容绝不进输出");
  } finally {
    await mock.close();
  }
});
