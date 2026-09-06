// draft-cmds.test.mjs — dby-cli-unification 任务 3.1：draft 组新增七条子命令
// （list/versions/decide/merge/comments/star/link）逐条核 mock 命中形状 + stdout 信封 + 退出码。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

const DRAFT_ID = "draft_1";

test("draft list：GET /api/drafts，--project 透传为 projectId 查询参数", async () => {
  const mock = await startMock({
    "GET /api/drafts": ok({ drafts: [{ id: DRAFT_ID, title: "稿子一" }] })
  });
  try {
    const r = await runCli(["draft", "list", "--project", "p1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "GET");
    assert.equal(mock.hits[0].path, "/api/drafts");
    assert.equal(mock.hits[0].query, "?projectId=p1");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.drafts[0].id, DRAFT_ID);
  } finally {
    await mock.close();
  }
});

test("draft list：不带 --project 也能直接跑，不带查询串", async () => {
  const mock = await startMock({ "GET /api/drafts": ok({ drafts: [] }) });
  try {
    const r = await runCli(["draft", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "");
  } finally {
    await mock.close();
  }
});

test("draft versions：GET /api/drafts/:id/versions", async () => {
  const mock = await startMock({
    [`GET /api/drafts/${DRAFT_ID}/versions`]: ok({ versions: [{ version: 1 }, { version: 2 }] })
  });
  try {
    const r = await runCli(["draft", "versions", DRAFT_ID], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, `/api/drafts/${DRAFT_ID}/versions`);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.data.versions.length, 2);
  } finally {
    await mock.close();
  }
});

test("draft decide：PUT .../decisions，--body 原样透传为请求体", async () => {
  const mock = await startMock({
    [`PUT /api/drafts/${DRAFT_ID}/versions/2/decisions`]: (req, url, body) => ok({ decisions: body.decisions })
  });
  try {
    const payload = '{"decisions":[{"changeId":"c1","decision":"accept"}]}';
    const r = await runCli(["draft", "decide", DRAFT_ID, "2", "--body", payload], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "PUT");
    assert.deepEqual(mock.hits[0].body, { decisions: [{ changeId: "c1", decision: "accept" }] });
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.data.decisions[0].changeId, "c1");
  } finally {
    await mock.close();
  }
});

test("draft decide：--body 与 --file 同给 → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const r = await runCli(
      ["draft", "decide", DRAFT_ID, "2", "--body", "{}", "--file", "/tmp/doesnotmatter.json"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("draft decide：--body 与 --file 都不给 → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const r = await runCli(["draft", "decide", DRAFT_ID, "2"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("draft merge：POST .../merge，--base 映射为 body.baseVersion", async () => {
  const mock = await startMock({
    [`POST /api/drafts/${DRAFT_ID}/versions/2/merge`]: (req, url, body) => ok({ created: true, baseVersion: body.baseVersion })
  });
  try {
    const r = await runCli(["draft", "merge", DRAFT_ID, "2", "--base", "3"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.deepEqual(mock.hits[0].body, { baseVersion: 3 });
    assert.equal(JSON.parse(r.stdout).data.baseVersion, 3);
  } finally {
    await mock.close();
  }
});

test("draft merge：缺 --base → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const r = await runCli(["draft", "merge", DRAFT_ID, "2"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("draft comments：GET .../comments，--version/--status 透传为查询参数", async () => {
  const mock = await startMock({
    [`GET /api/drafts/${DRAFT_ID}/comments`]: ok({ version: 2, comments: [] })
  });
  try {
    const r = await runCli(["draft", "comments", DRAFT_ID, "--version", "2", "--status", "open"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].query, "?version=2&status=open");
  } finally {
    await mock.close();
  }
});

test("draft star --on：需要 --note，body.starred=true 且带 note", async () => {
  const mock = await startMock({
    [`PUT /api/drafts/${DRAFT_ID}/versions/2/star`]: (req, url, body) => ok({ version: { starred: body.starred }, card: null })
  });
  try {
    const r = await runCli(["draft", "star", DRAFT_ID, "2", "--on", "--note", "这版好"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.deepEqual(mock.hits[0].body, { starred: true, note: "这版好" });
  } finally {
    await mock.close();
  }
});

test("draft star --on 缺 --note → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const r = await runCli(["draft", "star", DRAFT_ID, "2", "--on"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("draft star --off：body.starred=false，不需要 --note", async () => {
  const mock = await startMock({
    [`PUT /api/drafts/${DRAFT_ID}/versions/2/star`]: (req, url, body) => ok({ version: { starred: body.starred }, card: null })
  });
  try {
    const r = await runCli(["draft", "star", DRAFT_ID, "2", "--off"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.deepEqual(mock.hits[0].body, { starred: false });
  } finally {
    await mock.close();
  }
});

test("draft star：--on 与 --off 都不给、或都给 → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const none = await runCli(["draft", "star", DRAFT_ID, "2"], { env: envFor(mock) });
    assert.equal(none.code, 2);
    const both = await runCli(["draft", "star", DRAFT_ID, "2", "--on", "--off", "--note", "x"], { env: envFor(mock) });
    assert.equal(both.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("draft link：POST .../link-article，--article 必填映射为 body.articleId，--version 透传", async () => {
  const mock = await startMock({
    [`POST /api/drafts/${DRAFT_ID}/link-article`]: (req, url, body) => ok({ draft: { id: DRAFT_ID, articleId: body.articleId } })
  });
  try {
    const r = await runCli(["draft", "link", DRAFT_ID, "--article", "art_1", "--version", "2"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.deepEqual(mock.hits[0].body, { articleId: "art_1", version: 2 });
  } finally {
    await mock.close();
  }
});

test("draft link：缺 --article → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const r = await runCli(["draft", "link", DRAFT_ID], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});
