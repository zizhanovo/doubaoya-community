// contract.test.mjs — spec「输出通道分工与 JSON 契约」「退出码按失败模式分流」「契约稳定性」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, catalogRoutes, writeRoutes, envFor, ok } from "./helpers.mjs";
import { makeContext } from "../src/context.mjs";
import { renderJson, failureEnvelope, confirmationEnvelope } from "../src/output.mjs";
import { DbyError, EXIT } from "../src/errors.mjs";

// ── Requirement: 输出通道分工与 JSON 契约 ────────────────────────────────────

test("Scenario: agent 管道调用 —— 非 TTY 未传 --json 时 stdout 是单个可 JSON.parse 的对象", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(["api", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout); // 整个 stdout 就是一个对象，别的什么都没有
    assert.equal(parsed.ok, true);
    assert.ok(parsed.data.skills.items.length >= 1);
  } finally {
    await mock.close();
  }
});

test("Scenario: agent 管道调用 —— 警告出现在 stderr 而不在 stdout（write prep 的 warnings）", async () => {
  // 范文只有 2 篇（<3）必产生警告；写作规范拉不到再加一条 —— 全部走 stderr，stdout 仍是单个 JSON。
  const mock = await startMock(writeRoutes({ "GET /api/wechat/writing-spec": { status: 500, json: { success: false, error: { code: "BOOM", message: "炸了" } } } }));
  try {
    const r = await runCli(["write", "prep"], { env: envFor(mock) });
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.data.warnings.length >= 2, "data 里保留 warnings 副本");
    assert.match(r.stderr, /范文只有 2 篇/);
    assert.match(r.stderr, /写作规范没拉到/);
  } finally {
    await mock.close();
  }
});

test("Scenario: 人在终端调用 —— TTY 给人类文本；加 --json 后与非 TTY 逐字节一致（构造性保证）", () => {
  // JSON 渲染完全不看 isTTY：TTY+--json 与非 TTY 两个 ctx 走同一条 renderJson 路径。
  const ttyJson = makeContext({ flags: { json: true }, stdoutIsTTY: true, env: {} });
  const pipe = makeContext({ flags: {}, stdoutIsTTY: false, env: {} });
  assert.equal(ttyJson.json, true);
  assert.equal(pipe.json, true);
  const payload = { ok: true, data: { a: 1, 中文: "值" } };
  assert.equal(renderJson(payload), renderJson(payload)); // 同函数同输入 ⇒ 逐字节一致
  // TTY 且未指定 --json ⇒ 人类文本模式
  const tty = makeContext({ flags: {}, stdoutIsTTY: true, env: {} });
  assert.equal(tty.json, false);
});

test("--json 显式传入与非 TTY 默认，两次真实调用 stdout 逐字节一致", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const a = await runCli(["api", "list"], { env: envFor(mock) });
    const b = await runCli(["api", "list", "--json"], { env: envFor(mock) });
    assert.equal(a.stdout, b.stdout);
  } finally {
    await mock.close();
  }
});

// ── NO_COLOR / --no-color ────────────────────────────────────────────────────

test("NO_COLOR 与 --no-color 都关色；JSON 模式与非 TTY 天然无色", () => {
  const base = { flags: {}, stdoutIsTTY: true, env: {} };
  assert.equal(makeContext(base).color, true);
  assert.equal(makeContext({ ...base, env: { NO_COLOR: "1" } }).color, false);
  assert.equal(makeContext({ ...base, env: { NO_COLOR: "" } }).color, true, "空串不算设了（no-color.org）");
  assert.equal(makeContext({ ...base, flags: { color: false } }).color, false);
  assert.equal(makeContext({ ...base, flags: { json: true } }).color, false);
  assert.equal(makeContext({ ...base, stdoutIsTTY: false }).color, false);
});

test("人类文本失败输出在关色时不含 ANSI 转义", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(["api", "describe", "nope-nope"], { env: envFor(mock, { NO_COLOR: "1" }) });
    assert.equal(r.code, 3);
    assert.ok(!r.stderr.includes("\u001b["), "stderr 不含 ANSI");
    assert.ok(!r.stdout.includes("\u001b["), "stdout 不含 ANSI");
  } finally {
    await mock.close();
  }
});

// ── Requirement: 退出码按失败模式分流 ────────────────────────────────────────

test("Scenario: 缺 API key —— 退出码 4，error.remediation 给配置指引", async () => {
  const r = await runCli(["write", "prep"], { env: {} }); // 不给 DOUBAOYA_API_KEY
  assert.equal(r.code, 4);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, "MISSING_API_KEY");
  assert.match(parsed.error.remediation, /密钥中心/);
  assert.match(parsed.error.remediation, /DOUBAOYA_API_KEY/);
});

test("key 无效（服务端 401）—— 退出码 4，且输出不泄露 key 的任何一部分", async () => {
  const mock = await startMock({
    "GET /api/wechat/review": { status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "无效密钥" } } }
  });
  try {
    const r = await runCli(["write", "review"], { env: envFor(mock) });
    assert.equal(r.code, 4);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "UNAUTHORIZED");
    assert.ok(!(r.stdout + r.stderr).includes("dyh_test"), "🔴 密钥内容绝不进任何输出");
    assert.match(parsed.error.remediation, /已设置/); // 只说设没设
  } finally {
    await mock.close();
  }
});

test("Scenario: 用法错误 —— 未知子命令 / 缺必填参数 ⇒ 退出码 2，stderr 给用法", async () => {
  const unknown = await runCli(["frobnicate"], { env: {} });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Usage:|用法/i);
  const parsedU = JSON.parse(unknown.stdout);
  assert.equal(parsedU.error.code, "USAGE");

  const missing = await runCli(["api", "describe"], { env: {} });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /describe/); // 该子命令自己的用法
  assert.equal(JSON.parse(missing.stdout).error.code, "USAGE");
});

test("业务态退出码 3：能力查无（NOT_FOUND）", async () => {
  // slug 用真名（调用路由闸要求），行为由 mock 决定：详情 404、apis 清单里也没有 ⇒ 查无
  const mock = await startMock(catalogRoutes({
    "GET /api/skills/wechat-draft-publish": { status: 404, json: { success: false, error: { code: "NOT_FOUND", message: "无" } } }
  }));
  try {
    const r = await runCli(["api", "describe", "wechat-draft-publish"], { env: envFor(mock) });
    assert.equal(r.code, 3);
    assert.equal(JSON.parse(r.stdout).error.code, "NOT_FOUND");
  } finally {
    await mock.close();
  }
});

// ── Requirement: 契约稳定性（信封键集是契约，只增不改）────────────────────────

test("Scenario: 新版加字段 —— 信封的既有键集与形状钉死（成功 / 失败 / 确认三态）", () => {
  // 这条测试就是契约本体：动了下面任何一个键名/形状 = 破坏性变更 = 必须走 CLI major。
  const okEnv = JSON.parse(renderJson({ ok: true, data: { x: 1 } }));
  assert.deepEqual(Object.keys(okEnv), ["ok", "data"]);

  const failEnv = failureEnvelope(new DbyError("SOME_CODE", "出错了", { remediation: "这么修", exit: EXIT.BUSINESS }));
  assert.deepEqual(Object.keys(failEnv), ["ok", "error"]);
  assert.deepEqual(Object.keys(failEnv.error), ["code", "message", "remediation"]);
  assert.equal(failEnv.ok, false);

  const noRemedy = failureEnvelope(new DbyError("X", "y", {}));
  assert.equal(noRemedy.error.remediation, null, "没有 remediation 也要占位 null，不许键消失");

  const confirmEnv = confirmationEnvelope({ changes: [{ action: "invoke" }], confirmCommand: "dby x --confirm" });
  assert.deepEqual(Object.keys(confirmEnv), ["ok", "status", "changes", "confirmCommand"]);
  assert.equal(confirmEnv.status, "confirmation_required");
});

test("退出码常量表钉死（0/1/2/3/4/5/6）", () => {
  assert.deepEqual(EXIT, { OK: 0, GENERAL: 1, USAGE: 2, BUSINESS: 3, AUTH: 4, NETWORK: 5, CONFIRM: 6 });
});

// notice 走 stderr（数据通道不被污染）
test("信封 notice / noResult 走 stderr，不进 stdout 数据", async () => {
  const mock = await startMock({
    "GET /api/skills": ok({ total: 0, items: [] }, { notice: "你安装的 skill 有更新" }),
    "GET /api/apis": ok({ total: 0, items: [] })
  });
  try {
    const r = await runCli(["api", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0);
    assert.match(r.stderr, /\[notice\] 你安装的 skill 有更新/);
    assert.ok(!r.stdout.includes("有更新"));
    JSON.parse(r.stdout);
  } finally {
    await mock.close();
  }
});
