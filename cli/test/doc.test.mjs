// doc.test.mjs — dby-cli-unification 任务 3.3：`dby doc` 每条子命令至少一条用例，
// 核 put 缺 --base → USAGE(2)、mock 返回 409 VERSION_CONFLICT → BUSINESS(3)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, envFor, ok, fail } from "./helpers.mjs";

const DOC_PATH = "/api/ip-profile/p1/documents/positioning";

function docRoutes(extra = {}) {
  return {
    "GET /api/ip-profile/p1/documents": ok({
      documents: [{ docKey: "positioning", version: 1, updatedBy: "user", updatedAt: "2026-08-01T00:00:00.000Z" }]
    }),
    "GET /api/ip-profile/p1/documents/positioning": ok({
      docKey: "positioning",
      content: { oneLiner: "帮工程师把副业写成资产" },
      version: 1,
      updatedBy: "user",
      updatedAt: "2026-08-01T00:00:00.000Z"
    }),
    "PATCH /api/ip-profile/p1/documents/positioning": (req, url, body) =>
      ok({ docKey: "positioning", content: body.patch ?? body, version: 2, updatedBy: "agent" }),
    "PUT /api/ip-profile/p1/documents/positioning": (req, url, body) => {
      if (body.baseVersion !== 1) {
        return { status: 409, json: fail("VERSION_CONFLICT", "该文档已是版本 1，你基于的是别的版本。") };
      }
      return ok({ docKey: "positioning", content: body.content, version: 2, updatedBy: "agent" });
    },
    "GET /api/ip-profile/p1/documents/positioning/revisions": ok({
      docKey: "positioning",
      revisions: [{ version: 1, updatedBy: "user", summary: "初始写入", createdAt: "2026-08-01T00:00:00.000Z" }]
    }),
    "GET /api/ip-profile/p1/documents/positioning/revisions/1": ok({
      docKey: "positioning",
      version: 1,
      content: { oneLiner: "帮工程师把副业写成资产" },
      updatedBy: "user",
      summary: "初始写入",
      createdAt: "2026-08-01T00:00:00.000Z"
    }),
    "POST /api/ip-profile/p1/documents/positioning/restore": (req, url, body) => {
      if (body.baseVersion !== 1) {
        return { status: 409, json: fail("VERSION_CONFLICT", "该文档已是版本 1，你基于的是别的版本。") };
      }
      return ok({
        docKey: "positioning",
        content: { oneLiner: "帮工程师把副业写成资产" },
        version: 2,
        updatedBy: "agent",
        summary: `回滚到版本 ${body.version} 的内容`
      });
    },
    ...extra
  };
}

test("doc list：GET .../documents", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(["doc", "list", "p1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.documents.length, 1);
    assert.deepEqual(
      mock.hits.map((h) => `${h.method} ${h.path}`),
      ["GET /api/ip-profile/p1/documents"]
    );
  } finally {
    await mock.close();
  }
});

test("doc get：GET .../documents/:docKey", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(["doc", "get", "p1", "positioning"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.version, 1);
    assert.deepEqual(data.content, { oneLiner: "帮工程师把副业写成资产" });
    assert.deepEqual(
      mock.hits.map((h) => `${h.method} ${h.path}`),
      ["GET " + DOC_PATH]
    );
  } finally {
    await mock.close();
  }
});

test("doc patch：不带 --base，body 原样整体当 patch 发出", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "patch", "p1", "positioning", "--body", '{"oneLiner":"新一句话"}'],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const hit = mock.hits.find((h) => h.method === "PATCH");
    assert.deepEqual(hit.body, { oneLiner: "新一句话" });
  } finally {
    await mock.close();
  }
});

test("doc patch：带 --base，body 包成 {baseVersion, patch}", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "patch", "p1", "positioning", "--body", '{"oneLiner":"新一句话"}', "--base", "1"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const hit = mock.hits.find((h) => h.method === "PATCH");
    assert.deepEqual(hit.body, { baseVersion: 1, patch: { oneLiner: "新一句话" } });
  } finally {
    await mock.close();
  }
});

test("doc put：缺 --base → USAGE(2)，零命中", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "put", "p1", "positioning", "--body", '{"oneLiner":"x"}'],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 2, r.stderr);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("doc put：带正确 --base，body 包成 {baseVersion, content}，退出码 0", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "put", "p1", "positioning", "--body", '{"oneLiner":"新一句话"}', "--base", "1"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const hit = mock.hits.find((h) => h.method === "PUT");
    assert.deepEqual(hit.body, { baseVersion: 1, content: { oneLiner: "新一句话" } });
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.version, 2);
  } finally {
    await mock.close();
  }
});

test("doc put：--base 对不上，mock 返回 409 VERSION_CONFLICT → 退出码 3（BUSINESS）", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "put", "p1", "positioning", "--body", '{"oneLiner":"x"}', "--base", "0"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 3, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.error.code, "VERSION_CONFLICT");
    assert.match(out.error.remediation, /先.*get.*version/);
  } finally {
    await mock.close();
  }
});

test("doc revisions：GET .../revisions", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(["doc", "revisions", "p1", "positioning"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.revisions.length, 1);
  } finally {
    await mock.close();
  }
});

test("doc revision：GET .../revisions/:version", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(["doc", "revision", "p1", "positioning", "1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.version, 1);
    assert.deepEqual(
      mock.hits.map((h) => `${h.method} ${h.path}`),
      [`GET ${DOC_PATH}/revisions/1`]
    );
  } finally {
    await mock.close();
  }
});

test("doc restore：缺 --to 或 --base → USAGE(2)，零命中", async () => {
  const mock = await startMock(docRoutes());
  try {
    const noTo = await runCli(["doc", "restore", "p1", "positioning", "--base", "1"], { env: envFor(mock) });
    assert.equal(noTo.code, 2, noTo.stderr);
    const noBase = await runCli(["doc", "restore", "p1", "positioning", "--to", "1"], { env: envFor(mock) });
    assert.equal(noBase.code, 2, noBase.stderr);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("doc restore：--to 与 --base 都给，body 为 {version, baseVersion}，退出码 0", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "restore", "p1", "positioning", "--to", "1", "--base", "1"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const hit = mock.hits.find((h) => h.method === "POST");
    assert.deepEqual(hit.body, { version: 1, baseVersion: 1 });
  } finally {
    await mock.close();
  }
});

test("doc restore：--base 对不上 → 409 映射成退出码 3", async () => {
  const mock = await startMock(docRoutes());
  try {
    const r = await runCli(
      ["doc", "restore", "p1", "positioning", "--to", "1", "--base", "0"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 3, r.stderr);
  } finally {
    await mock.close();
  }
});
