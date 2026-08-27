// timeout.test.mjs — spec「超时不自动重试」：退出码 5、remediation 指引核实计费、请求只发一次。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, catalogRoutes, envFor } from "./helpers.mjs";

test("Scenario: 计费调用超时 —— 不发第二次请求，退出码 5，remediation 含核实指引", async () => {
  const mock = await startMock(catalogRoutes({
    "POST /api/apis/trend/trending-hub-keyword/call": "HANG" // 永不响应
  }));
  try {
    const r = await runCli(
      ["api", "invoke", "trend/trending-hub-keyword", "{}", "--confirm"],
      { env: envFor(mock, { DOUBAOYA_TIMEOUT_MS: "400" }) }
    );
    assert.equal(r.code, 5);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "TIMEOUT");
    assert.match(parsed.error.message, /可能仍在进行|可能已经/);
    assert.match(parsed.error.remediation, /核实/);
    assert.match(parsed.error.remediation, /计费|扣点/);
    assert.match(parsed.error.remediation, /别立刻重试|不要自动重试/);
    // 🔴 红线本体：那条计费 POST 只发了一次，没有任何自动重试
    const posts = mock.hits.filter((h) => h.method === "POST");
    assert.equal(posts.length, 1, `计费请求必须恰好一次：${JSON.stringify(posts)}`);
  } finally {
    await mock.close();
  }
});

test("免费路由超时同样退出码 5 且不重试（write review）", async () => {
  const mock = await startMock({ "GET /api/wechat/review": "HANG" });
  try {
    const r = await runCli(["write", "review"], { env: envFor(mock, { DOUBAOYA_TIMEOUT_MS: "400" }) });
    assert.equal(r.code, 5);
    assert.equal(JSON.parse(r.stdout).error.code, "TIMEOUT");
    assert.equal(mock.hits.filter((h) => h.path === "/api/wechat/review").length, 1, "不自动重试");
  } finally {
    await mock.close();
  }
});

test("网络连不上（非超时）也是退出码 5，code 是 NETWORK_ERROR", async () => {
  // 指向一个立刻拒绝连接的端口
  const dead = await startMock({});
  const url = dead.url;
  await dead.close();
  const r = await runCli(["api", "list"], { env: { DOUBAOYA_BASE_URL: url } });
  assert.equal(r.code, 5);
  assert.equal(JSON.parse(r.stdout).error.code, "NETWORK_ERROR");
});
