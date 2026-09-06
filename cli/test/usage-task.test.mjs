// usage-task.test.mjs — dby-cli-unification 任务 3.2：usage 组六条命令 + task list + 两条
// 单级命令 upload / whoami。四组合并在一个文件：都是零依赖的账户侧读写，且都很短。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

// ── usage ────────────────────────────────────────────────────────────────────

test("usage summary：GET /api/usage/summary", async () => {
  const mock = await startMock({ "GET /api/usage/summary": ok({ totalCalls: 3, successfulCalls: 2, creditsConsumed: 9 }) });
  try {
    const r = await runCli(["usage", "summary"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/usage/summary");
    assert.equal(JSON.parse(r.stdout).data.totalCalls, 3);
  } finally {
    await mock.close();
  }
});

test("usage balance：GET /api/billing/summary", async () => {
  const mock = await startMock({ "GET /api/billing/summary": ok({ balance: 100 }) });
  try {
    const r = await runCli(["usage", "balance"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/billing/summary");
    assert.equal(JSON.parse(r.stdout).data.balance, 100);
  } finally {
    await mock.close();
  }
});

test("usage logs：GET /api/usage/logs，全部筛选 flag 透传为查询参数", async () => {
  const mock = await startMock({ "GET /api/usage/logs": ok({ items: [], total: 0, limit: 20, offset: 0 }) });
  try {
    const r = await runCli(
      ["usage", "logs", "--q", "trend", "--status", "success", "--range", "7d", "--limit", "20", "--offset", "0"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    const params = new URLSearchParams(mock.hits[0].query);
    assert.equal(params.get("q"), "trend");
    assert.equal(params.get("status"), "success");
    assert.equal(params.get("range"), "7d");
    assert.equal(params.get("limit"), "20");
    assert.equal(params.get("offset"), "0");
  } finally {
    await mock.close();
  }
});

test("usage log：GET /api/usage/logs/:requestId", async () => {
  const mock = await startMock({ "GET /api/usage/logs/req_1": ok({ invocation: { requestId: "req_1" } }) });
  try {
    const r = await runCli(["usage", "log", "req_1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/usage/logs/req_1");
  } finally {
    await mock.close();
  }
});

test("usage log-rm：不带 --confirm 停在确认态，退出码 6，零命中", async () => {
  const mock = await startMock({ "DELETE /api/usage/logs/req_1": ok({ deleted: true, requestId: "req_1" }) });
  try {
    const r = await runCli(["usage", "log-rm", "req_1"], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes[0].ref, "req_1");
    assert.equal(mock.hits.length, 0, "不带 --confirm 不许产生任何服务端副作用");
  } finally {
    await mock.close();
  }
});

test("usage log-rm：带 --confirm 真删，命中一次且方法是 DELETE", async () => {
  const mock = await startMock({ "DELETE /api/usage/logs/req_1": ok({ deleted: true, requestId: "req_1" }) });
  try {
    const r = await runCli(["usage", "log-rm", "req_1", "--confirm"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "DELETE");
    assert.equal(JSON.parse(r.stdout).data.deleted, true);
  } finally {
    await mock.close();
  }
});

test("usage analytics：GET /api/usage/analytics，--range 透传为查询参数", async () => {
  const mock = await startMock({ "GET /api/usage/analytics": ok({ range: "30d", points: [] }) });
  try {
    const r = await runCli(["usage", "analytics", "--range", "30d"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(new URLSearchParams(mock.hits[0].query).get("range"), "30d");
  } finally {
    await mock.close();
  }
});

// ── task ─────────────────────────────────────────────────────────────────────

test("task list：GET /api/tasks", async () => {
  const mock = await startMock({ "GET /api/tasks": ok({ items: [] }) });
  try {
    const r = await runCli(["task", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/tasks");
  } finally {
    await mock.close();
  }
});

// ── upload（单级命令） ─────────────────────────────────────────────────────────

test("upload：POST /api/upload，本地文件转 base64、filename 取 basename", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dby-upload-"));
  const file = path.join(dir, "pic.png");
  const pngBytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(12)]); // 假图片字节，mock 不校验内容
  writeFileSync(file, pngBytes);
  const mock = await startMock({
    "POST /api/upload": (req, url, body) =>
      ok({
        url: "https://cdn.example/x.png",
        key: "k",
        contentType: "image/png",
        size: Buffer.from(body.dataBase64, "base64").length
      })
  });
  try {
    const r = await runCli(["upload", file], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    const hit = mock.hits[0];
    assert.equal(hit.method, "POST");
    assert.equal(hit.path, "/api/upload");
    assert.equal(hit.body.filename, "pic.png");
    assert.equal(Buffer.from(hit.body.dataBase64, "base64").length, pngBytes.length);
    assert.equal(JSON.parse(r.stdout).data.size, pngBytes.length);
  } finally {
    await mock.close();
  }
});

test("upload：文件超过 2MB 本地先拒，USAGE(2)，零请求", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dby-upload-"));
  const file = path.join(dir, "big.png");
  writeFileSync(file, Buffer.alloc(2 * 1024 * 1024 + 1));
  const mock = await startMock({});
  try {
    const r = await runCli(["upload", file], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("upload：文件不存在 → USAGE(2)，零请求", async () => {
  const mock = await startMock({});
  try {
    const r = await runCli(["upload", "/nonexistent/path/x.png"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

// ── whoami（单级命令） ─────────────────────────────────────────────────────────

test("whoami：GET /api/agent/whoami", async () => {
  const mock = await startMock({ "GET /api/agent/whoami": ok({ user: { id: "u1", email: "a@b.com" }, authVia: "apiKey" }) });
  try {
    const r = await runCli(["whoami"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/agent/whoami");
    assert.equal(JSON.parse(r.stdout).data.user.id, "u1");
  } finally {
    await mock.close();
  }
});
