// article.test.mjs — dby-cli-unification 任务 3.2：article 组（list/get）与 retro 单条命令
// （二者都住在主仓 apps/api/src/modules/articles/ 目录下，故合并在一个测试文件）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

test("article list：GET /api/articles，筛选与分页 flag 透传为查询参数", async () => {
  const mock = await startMock({
    "GET /api/articles": ok({ articles: [{ id: "a1" }], pagination: { page: 2, pageSize: 10, total: 1 } })
  });
  try {
    const r = await runCli(
      ["article", "list", "--appid", "wx1", "--status", "published", "--search", "关键词", "--page", "2", "--page-size", "10"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/articles");
    const params = new URLSearchParams(mock.hits[0].query);
    assert.equal(params.get("appid"), "wx1");
    assert.equal(params.get("status"), "published");
    assert.equal(params.get("search"), "关键词");
    assert.equal(params.get("page"), "2");
    assert.equal(params.get("pageSize"), "10");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.articles[0].id, "a1");
  } finally {
    await mock.close();
  }
});

test("article list：不带任何 flag 也能直接跑，不带查询串", async () => {
  const mock = await startMock({ "GET /api/articles": ok({ articles: [] }) });
  try {
    const r = await runCli(["article", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "");
  } finally {
    await mock.close();
  }
});

test("article get：GET /api/articles/:id", async () => {
  const mock = await startMock({
    "GET /api/articles/a1": ok({ article: { id: "a1" }, body: null })
  });
  try {
    const r = await runCli(["article", "get", "a1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/articles/a1");
    assert.equal(JSON.parse(r.stdout).data.article.id, "a1");
  } finally {
    await mock.close();
  }
});

test("retro：GET /api/retro，--appid/--limit 透传为查询参数", async () => {
  const mock = await startMock({ "GET /api/retro": ok({ articles: [] }) });
  try {
    const r = await runCli(["retro", "--appid", "wx1", "--limit", "10"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/retro");
    const params = new URLSearchParams(mock.hits[0].query);
    assert.equal(params.get("appid"), "wx1");
    assert.equal(params.get("limit"), "10");
  } finally {
    await mock.close();
  }
});

test("retro：无参数也能直接跑（单级命令，非 `retro list`）", async () => {
  const mock = await startMock({ "GET /api/retro": ok({ articles: [] }) });
  try {
    const r = await runCli(["retro"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "");
    assert.equal(JSON.parse(r.stdout).ok, true);
  } finally {
    await mock.close();
  }
});
