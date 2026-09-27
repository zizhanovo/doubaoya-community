// confirm.test.mjs — spec「计费与不可逆操作的协议化确认」两个 Scenario + 只读零摩擦。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, catalogRoutes, envFor, FIXTURE_INVOKE_RESULT } from "./helpers.mjs";
import { shellQuote, buildConfirmCommand } from "../src/confirm.mjs";

test("Scenario: 不带 --confirm 调计费命令 —— 退出码 6、无服务端副作用、confirmCommand 可原样重放", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const body = '{"platforms":[2,5]}';
    const r = await runCli(["api", "invoke", "trend/trending-hub-keyword", body], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes.length, 1);
    assert.equal(parsed.changes[0].ref, "trend/trending-hub-keyword");
    assert.equal(parsed.changes[0].price, "3点");
    assert.match(parsed.confirmCommand, /--confirm$/);
    // 🔴 无副作用：mock 只见过发现类 GET，没有任何 POST
    assert.ok(mock.hits.every((h) => h.method === "GET"), `不该有写请求：${JSON.stringify(mock.hits)}`);

    // confirmCommand 可直接复制执行：把它按 shell 规则拆回 argv 重放（去掉开头的 dby）
    const tokens = parsed.confirmCommand.match(/'(?:[^']|'\\'')*'|\S+/g)
      .map((t) => (t.startsWith("'") ? t.slice(1, -1).replaceAll(`'\\''`, "'") : t));
    assert.equal(tokens[0], "dby");
    const replay = await runCli(tokens.slice(1), { env: envFor(mock) });
    assert.equal(replay.code, 0, replay.stderr);
    const replayed = JSON.parse(replay.stdout);
    assert.equal(replayed.ok, true);
    // 服务端真的收到了 POST，且入参就是当初那份
    const post = mock.hits.find((h) => h.method === "POST");
    assert.ok(post, "重放后必须有真实 POST");
    assert.deepEqual(post.body, { platforms: [2, 5] });
  } finally {
    await mock.close();
  }
});

test("Scenario: 带 --confirm —— 真实执行并返回 ok:true 与结果数据（raw 默认剥掉）", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(
      ["api", "invoke", "trend/trending-hub-keyword", "{}", "--confirm"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    const { raw: _raw, ...expected } = FIXTURE_INVOKE_RESULT;
    assert.deepEqual(parsed.data, expected, "默认剥掉与 items 重复的 raw");
  } finally {
    await mock.close();
  }
});

test("--raw 保留上游原样回包", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(
      ["api", "invoke", "trend/trending-hub-keyword", "{}", "--confirm", "--raw"],
      { env: envFor(mock) }
    );
    assert.deepEqual(JSON.parse(r.stdout).data, FIXTURE_INVOKE_RESULT);
  } finally {
    await mock.close();
  }
});

test("只读命令 MUST NOT 要求确认：免费能力 invoke 与发现类命令直接执行", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    // 免费能力：不带 --confirm 也直接执行（只读不套）
    const free = await runCli(["api", "invoke", "wechat-render", "{}"], { env: envFor(mock) });
    assert.equal(free.code, 0, free.stderr);
    assert.equal(JSON.parse(free.stdout).ok, true);
    // 发现类
    for (const args of [["api", "list"], ["api", "search", "热点"], ["api", "describe", "trend/trending-hub-keyword"]]) {
      const r = await runCli(args, { env: envFor(mock) });
      assert.equal(r.code, 0, `${args.join(" ")}：${r.stderr}`);
    }
  } finally {
    await mock.close();
  }
});

test("shellQuote / buildConfirmCommand：中文与引号安全，重复 --confirm 不叠加", () => {
  assert.equal(shellQuote("trend/trending-hub-keyword"), "trend/trending-hub-keyword");
  assert.equal(shellQuote('{"k":"美 食"}'), `'{"k":"美 食"}'`);
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  const cmd = buildConfirmCommand(["api", "invoke", "x", '{"a":1}', "--confirm"]);
  assert.equal(cmd, `dby api invoke x '{"a":1}' --confirm`);
});
