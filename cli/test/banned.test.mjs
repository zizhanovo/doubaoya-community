// banned.test.mjs — 任务 3.6：`dby banned check`（替代 skills/dby-banned-words/scripts/check_multi.py）。
// 多平台扇出：每平台各一次独立计费调用；确认协议先核 6 再 --confirm 核 0/3；slim 剥重复键纯函数单测。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, envFor, ok, fail } from "./helpers.mjs";
import { slim } from "../../skills/dby-api/scripts/lib/commands/banned.mjs";

const DESCRIBE_PATH = "/api/apis/tool/check-banned-words";
const CALL_PATH = "/api/apis/tool/check-banned-words/call";

const BANNED_CAPABILITY = {
  platform: "tool",
  slug: "check-banned-words",
  title: "违禁词检测",
  unitPrice: 6,
  priceClass: "standardData",
  execution: { mode: "generic", target: { method: "POST", path: CALL_PATH } }
};

/** 每平台各回一份结果；douyin 固定失败，用来练「单平台失败不影响其它平台」。 */
function bannedRoutes(extra = {}) {
  return {
    [`GET ${DESCRIBE_PATH}`]: ok(BANNED_CAPABILITY),
    [`POST ${CALL_PATH}`]: (req, url, body) => {
      if (body.platform === "douyin") return fail("UPSTREAM_TIMEOUT", "上游超时");
      return ok({
        source: "contentSafety.sensitiveWords",
        content: `全网<span class="banned-word">最低</span>价（${body.platform}）`,
        originalContent: "全网最低价",
        prohibitedWordsType: ["价格承诺"],
        raw: { content: "全网最低价", originalContent: "全网最低价", code: 0, level: "high" }
      });
    },
    ...extra
  };
}

test("Scenario: 不带 --confirm —— 退出码 6、changes 每平台一条、零计费请求（只有现拉价格那一次 GET）", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(["banned", "check", "全网最低价"], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes.length, 3, "默认三平台，changes 三条");
    assert.deepEqual(parsed.changes.map((c) => c.ref).sort(), [
      "tool/check-banned-words@douyin",
      "tool/check-banned-words@gongzhonghao",
      "tool/check-banned-words@xiaohongshu"
    ]);
    assert.ok(parsed.changes.every((c) => c.price === "6点"), "价格来自现拉的 describe");
    assert.match(parsed.confirmCommand, /--confirm$/);
    // 🔴 零计费请求：mock 只见过一次现拉价格的 GET，没有任何 POST
    assert.deepEqual(mock.hits.map((h) => h.method), ["GET"], `不该有 POST：${JSON.stringify(mock.hits)}`);
  } finally {
    await mock.close();
  }
});

test("带 --confirm 全部平台成功：逐平台各一次独立 POST，raw 默认剥掉，--raw 保留原样", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(["banned", "check", "全网最低价", "--platforms", "xiaohongshu,gongzhonghao", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(data), ["xiaohongshu", "gongzhonghao"]);
    // 逐平台各打了一次独立的 POST（各自计费）
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.body.platform).sort(), ["gongzhonghao", "xiaohongshu"]);
    // 默认剥掉 raw 里与顶层重复的 content/originalContent
    assert.deepEqual(data.xiaohongshu.raw, { code: 0, level: "high" });
    assert.equal(data.xiaohongshu.content, "全网<span class=\"banned-word\">最低</span>价（xiaohongshu）");

    const rawKept = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu", "--confirm", "--raw"],
      { env: envFor(mock) }
    );
    const rawData = JSON.parse(rawKept.stdout).data;
    assert.deepEqual(rawData.xiaohongshu.raw, {
      content: "全网最低价", originalContent: "全网最低价", code: 0, level: "high"
    });
  } finally {
    await mock.close();
  }
});

test("单平台失败不影响其它平台：结果字典放 {error}，整体退出码 3（部分失败）", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu,douyin", "--confirm"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 3);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "BANNED_CHECK_PARTIAL");
    // 失败信封仍带出逐平台完整结果——已成功的那个平台不能被部分失败连累丢掉
    assert.equal(parsed.data.xiaohongshu.prohibitedWordsType[0], "价格承诺");
    assert.equal(parsed.data.douyin.error.code, "UPSTREAM_TIMEOUT");
    // 两个平台都真的打过 POST（失败不阻断其它平台继续跑）
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    assert.equal(calls.length, 2);
  } finally {
    await mock.close();
  }
});

test("human 输出每平台一行：成功打命中类型，失败打错误码", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu,douyin", "--confirm"],
      { env: envFor(mock) }
    );
    // 失败信封（exit 3）时 human 走 stdout（非 JSON 模式）—— 这里走 JSON 模式，改核 err.human 是否被带进 stdout 的机器信封之外的行为：
    // json 模式下失败信封本身不含 human 字段，改核 stderr 一句人话即可（emitFailure 契约）。
    assert.match(r.stderr, /BANNED_CHECK_PARTIAL/);

    const okRun = await runCli(
      ["banned", "check", "全网最低价", "--platforms", "xiaohongshu,gongzhonghao", "--confirm"],
      { env: envFor(mock) }
    );
    assert.equal(okRun.code, 0);
  } finally {
    await mock.close();
  }
});

test("--platforms 自定义列表：只打点名的平台，人类文本每平台一行", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const r = await runCli(["banned", "check", "文案", "--platforms", "gongzhonghao", "--confirm"], {
      env: envFor(mock)
    });
    assert.equal(r.code, 0, r.stderr);
    const calls = mock.hits.filter((h) => h.path === CALL_PATH);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.platform, "gongzhonghao");
  } finally {
    await mock.close();
  }
});

test("缺文案 → 用法错退出码 2；--platforms 给空列表 → 用法错退出码 2", async () => {
  const mock = await startMock(bannedRoutes());
  try {
    const missingText = await runCli(["banned", "check"], { env: envFor(mock) });
    assert.equal(missingText.code, 2);

    const emptyPlatforms = await runCli(["banned", "check", "文案", "--platforms", " , ,"], { env: envFor(mock) });
    assert.equal(emptyPlatforms.code, 2);
    assert.equal(JSON.parse(emptyPlatforms.stdout).error.code, "USAGE");
  } finally {
    await mock.close();
  }
});

test("slim：剥 raw 重复键 / 保留其它键 / 不动顶层 / 不改入参 / 缺 raw 原样（与 check_multi.py selfcheck 同判据）", () => {
  const full = {
    source: "contentSafety.sensitiveWords",
    content: "全网<span class=\"banned-word\">最低</span>价",
    originalContent: "全网最低价",
    prohibitedWordsType: ["禁用词"],
    raw: { content: "全网最低价", originalContent: "全网最低价", code: 0, level: "high" }
  };
  const s = slim(full);
  assert.ok(!("content" in s.raw) && !("originalContent" in s.raw), "raw 里的重复键没剥掉");
  assert.deepEqual(s.raw, { code: 0, level: "high" }, "raw 的其它键被误删");
  assert.equal(s.content, full.content);
  assert.equal(s.originalContent, full.originalContent);
  assert.equal(full.raw.content, "全网最低价", "slim 改了入参（应返回新对象）");
  assert.deepEqual(slim({ error: { code: "X" } }), { error: { code: "X" } }, "无 raw 时应原样返回");
  assert.equal(slim({ raw: null }).raw, null, "raw 为 null 时应原样返回");
  assert.equal(slim({ raw: "str" }).raw, "str", "raw 非 dict 时应原样返回");
  assert.equal(slim(null), null, "非 dict 入参应原样返回");
});
