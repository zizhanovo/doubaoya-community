// api-parity.test.mjs — 任务 2.1：`dby api` 对拍 doubaoya.mjs。
// 纯函数层：直接 import 旧脚本（它有入口守卫，import 安全）逐函数对拍；
// 端到端：固定 fixture 打 mock，断言 CLI 的 data 字段与旧脚本纯函数推出的关键字段一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as legacy from "../../skills/dby-api/scripts/doubaoya.mjs";
import * as ours from "../src/lib/capability.mjs";
import {
  startMock, runCli, catalogRoutes, envFor,
  FIXTURE_SKILL_ITEMS, FIXTURE_API_ITEMS, FIXTURE_INVOKE_RESULT
} from "./helpers.mjs";

test("纯函数逐个对拍：parseRef / isOperationKey / resolveTarget / stripRaw / priceLabel / match*", () => {
  for (const ref of ["cn-last30days", "trend/trending-hub-keyword", "a/b/c", "", "  x  "]) {
    assert.deepEqual(ours.parseRef(ref), legacy.parseRef(ref), `parseRef(${JSON.stringify(ref)})`);
  }
  for (const ref of ["api.trend.hotSpotKeyword", "skill.wechat.hotSearch", "trend/x", "slug", "Api.X"]) {
    assert.equal(ours.isOperationKey(ref), legacy.isOperationKey(ref), `isOperationKey(${ref})`);
  }
  const caps = [
    { execution: { mode: "generic", target: { method: "POST", path: "/api/apis/trend/trending-hub-keyword/call" } } },
    { execution: { mode: "dedicated", target: { method: "PUT", path: "/api/ip-profile/:id/charter" } } },
    { execution: { mode: "unavailable" }, availability: { note: "下架了" } },
    {},
    { execution: { target: {} } }
  ];
  for (const c of caps) assert.deepEqual(ours.resolveTarget(c), legacy.resolveTarget(c));
  const datas = [
    { total: 1, items: [{ id: 1 }], raw: { u: 1 } },
    { content: "x", raw: {} },
    { raw: {}, other: 1 },
    null,
    [1, 2]
  ];
  for (const d of datas) assert.deepEqual(ours.stripRaw(d), legacy.stripRaw(d));
  const items = [
    { unitPrice: 0, priceClass: "free" }, { unitPrice: 3, priceClass: "standardData" }, {},
    ...FIXTURE_SKILL_ITEMS, ...FIXTURE_API_ITEMS
  ];
  for (const i of items) assert.equal(ours.priceLabel(i), legacy.priceLabel(i));
  const pool = [
    { platform: "douyin", slug: "search-work" },
    { platform: "xiaohongshu", slug: "search-work" },
    { platform: "trend", slug: "hot-keywords" }
  ];
  for (const s of ["search-work", "hot-keywords", "nope"]) {
    assert.deepEqual(ours.matchApisBySlug(pool, s), legacy.matchApisBySlug(pool, s));
  }
  const sk = [{ slug: "a", operationKey: "tool.x.y" }];
  const ap = [{ platform: "t", slug: "b", operationKey: "api.t.z" }, { platform: "u", slug: "c", operationKey: "tool.x.y" }];
  for (const k of ["tool.x.y", "api.t.z", "api.none"]) {
    assert.deepEqual(ours.matchByOperationKey(sk, ap, k), legacy.matchByOperationKey(sk, ap, k));
  }
});

test("dby api list：data 与 fixture 一致，且人类行的关键列可由旧脚本函数复算", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(["api", "list"], { env: envFor(mock) });
    const { data } = JSON.parse(r.stdout);
    assert.deepEqual(data.skills.items, FIXTURE_SKILL_ITEMS);
    assert.deepEqual(data.apis.items, FIXTURE_API_ITEMS);
    assert.equal(data.skills.total, 1);
    assert.equal(data.apis.total, 1);
    // 关键派生列与旧脚本推法一致（价格标签 / 调用路径）
    for (const item of data.apis.items) {
      assert.equal(ours.priceLabel(item), legacy.priceLabel(item));
      assert.deepEqual(ours.resolveTarget(item), legacy.resolveTarget(item));
    }
    // 单集合过滤
    const onlyApis = JSON.parse((await runCli(["api", "list", "--apis"], { env: envFor(mock) })).stdout);
    assert.equal(onlyApis.data.skills, undefined);
    assert.deepEqual(onlyApis.data.apis.items, FIXTURE_API_ITEMS);
  } finally {
    await mock.close();
  }
});

test("dby api search：skills 走服务端搜索、apis 本地过滤（与旧脚本同判据）", async () => {
  const mock = await startMock(catalogRoutes({
    "GET /api/skills/search": (req, url) =>
      ({ success: true, data: { items: url.searchParams.get("query") === "热点" ? [] : FIXTURE_SKILL_ITEMS } })
  }));
  try {
    const r = await runCli(["api", "search", "热点"], { env: envFor(mock) });
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.skills.items.length, 0);
    // 本地过滤判据与旧脚本一字不差：slug/platform/title/summary/tags 拼串忽略大小写
    assert.deepEqual(
      data.apis.items,
      FIXTURE_API_ITEMS.filter((i) => `${i.slug} ${i.platform} ${i.title} ${i.summary} ${(i.tags ?? []).join(" ")}`.toLowerCase().includes("热点".toLowerCase()))
    );
    assert.equal(data.apis.items[0].slug, "trending-hub-keyword");
  } finally {
    await mock.close();
  }
});

test("dby api describe：三种 ref 写法都解析到同一条能力；调用路径走 stderr", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    for (const ref of ["trend/trending-hub-keyword", "api.trend.hotSpotKeyword", "trending-hub-keyword"]) {
      const r = await runCli(["api", "describe", ref], { env: envFor(mock) });
      assert.equal(r.code, 0, `${ref}: ${r.stderr}`);
      const { data } = JSON.parse(r.stdout);
      // 裸 slug 走 apis 清单命中（清单项）；另两种走详情端点 —— 关键字段一致即为对拍通过
      assert.equal(data.slug, "trending-hub-keyword");
      assert.equal(data.platform, "trend");
      assert.equal(data.operationKey, "api.trend.hotSpotKeyword");
      assert.match(r.stderr, /\[调用路径\] POST \/api\/apis\/trend\/trending-hub-keyword\/call/);
    }
  } finally {
    await mock.close();
  }
});

test("dby api invoke：data 等于旧脚本 stripRaw 在同一响应上的结果", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(["api", "invoke", "wechat-render", "{}"], { env: envFor(mock) });
    assert.deepEqual(JSON.parse(r.stdout).data, legacy.stripRaw(FIXTURE_INVOKE_RESULT));
  } finally {
    await mock.close();
  }
});

test("跨平台撞名的裸 slug → AMBIGUOUS_REF（退出码 3），与旧脚本同语义", async () => {
  const twin = [
    { platform: "douyin", slug: "search-work", execution: { mode: "generic", target: { method: "POST", path: "/api/apis/douyin/search-work/call" } } },
    { platform: "xiaohongshu", slug: "search-work", execution: { mode: "generic", target: { method: "POST", path: "/api/apis/xiaohongshu/search-work/call" } } }
  ];
  const mock = await startMock({
    "GET /api/apis": { success: true, data: { total: 2, items: twin } }
  });
  try {
    const r = await runCli(["api", "describe", "search-work"], { env: envFor(mock) });
    assert.equal(r.code, 3);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.error.code, "AMBIGUOUS_REF");
    assert.match(parsed.error.message, /douyin\/search-work/);
  } finally {
    await mock.close();
  }
});

test("入参不是合法 JSON → 用法错（退出码 2）", async () => {
  const mock = await startMock(catalogRoutes());
  try {
    const r = await runCli(["api", "invoke", "wechat-render", "{bad"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.stdout).error.code, "USAGE");
  } finally {
    await mock.close();
  }
});
