// material-insp.test.mjs — `dby material list|get|add|rm` 与 `dby insp add` 的路由/退出码/
// 确认协议核验（design: dby-cli-unification 任务 3.4）。同 confirm.test.mjs 的断言口径：
// 不带 --confirm 时零服务端命中、退出码 6；带 --confirm 后真实命中一次。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

const FIXTURE_CARD = {
  id: "ki_1",
  proof: "被拒 37 次仍能成单",
  kind: "material",
  event: { time: "2026-08", place: "线下沙龙", outcome: "当场加微信" },
  evidence: "亲历",
  forms: ["带转折的真实经历"],
  label: null,
  updatedAt: "2026-08-01T00:00:00.000Z"
};

function materialRoutes(extra = {}) {
  return {
    "GET /api/materials": ok({ profileId: "p1", materials: [{ id: "ki_1", proof: FIXTURE_CARD.proof }], reviewConclusions: [] }),
    "GET /api/materials/ki_1": ok({ card: FIXTURE_CARD }),
    "POST /api/materials": (req, url, body) => ok({ card: { ...FIXTURE_CARD, ...body }, created: true }),
    "DELETE /api/materials/ki_1": ok({ deleted: true, id: "ki_1" }),
    ...extra
  };
}

// ── material list ────────────────────────────────────────────────────────────

test("material list：打 GET /api/materials，无 --profile 时不带 query", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const r = await runCli(["material", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "GET");
    assert.equal(mock.hits[0].path, "/api/materials");
    assert.equal(mock.hits[0].query, "");
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.materials[0].id, "ki_1");
  } finally {
    await mock.close();
  }
});

test("material list --profile p1：query 带 profileId=p1", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const r = await runCli(["material", "list", "--profile", "p1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "?profileId=p1");
  } finally {
    await mock.close();
  }
});

// ── material get ─────────────────────────────────────────────────────────────

test("material get <id>：打 GET /api/materials/:id，卡面全文回传", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const r = await runCli(["material", "get", "ki_1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.deepEqual(mock.hits[0], { method: "GET", path: "/api/materials/ki_1", query: "", body: undefined });
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.data.card.proof, FIXTURE_CARD.proof);
  } finally {
    await mock.close();
  }
});

// ── material add ─────────────────────────────────────────────────────────────

test("material add --body '<json>'：POST /api/materials，body 原样透传", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const cardJson = JSON.stringify({
      proof: "被拒 37 次仍能成单",
      kind: "material",
      event: { time: "2026-08", place: "线下沙龙", outcome: "当场加微信" },
      evidence: "亲历",
      forms: ["带转折的真实经历"]
    });
    const r = await runCli(["material", "add", "--body", cardJson], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "POST");
    assert.equal(mock.hits[0].path, "/api/materials");
    assert.deepEqual(mock.hits[0].body, JSON.parse(cardJson));
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.data.created, true);
  } finally {
    await mock.close();
  }
});

test("material add --file <path>：从文件读 JSON", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "dby-material-"));
    const file = path.join(dir, "card.json");
    const card = { proof: "x", kind: "material", event: { time: "t", place: "p", outcome: "o" }, evidence: "亲历", forms: ["被访者原话"] };
    await writeFile(file, JSON.stringify(card));
    const r = await runCli(["material", "add", "--file", file], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(mock.hits[0].body, card);
  } finally {
    await mock.close();
  }
});

test("material add 两个都不给 / 两个都给：退出码 2，零命中", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const none = await runCli(["material", "add"], { env: envFor(mock) });
    assert.equal(none.code, 2);
    const both = await runCli(["material", "add", "--body", "{}", "--file", "x.json"], { env: envFor(mock) });
    assert.equal(both.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

// ── material rm（destructive，走确认协议） ────────────────────────────────────

test("material rm <id> 未带 --confirm：退出码 6，服务端零命中", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const r = await runCli(["material", "rm", "ki_1"], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes[0].action, "delete");
    assert.equal(parsed.changes[0].ref, "ki_1");
    assert.equal(mock.hits.length, 0, "不带 --confirm 不该有任何服务端命中");
  } finally {
    await mock.close();
  }
});

test("material rm <id> --confirm：真删，命中一次 DELETE", async () => {
  const mock = await startMock(materialRoutes());
  try {
    const r = await runCli(["material", "rm", "ki_1", "--confirm"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "DELETE");
    assert.equal(mock.hits[0].path, "/api/materials/ki_1");
    assert.equal(JSON.parse(r.stdout).data.deleted, true);
  } finally {
    await mock.close();
  }
});

// ── insp add ─────────────────────────────────────────────────────────────────

function inspRoutes(extra = {}) {
  return {
    "POST /api/inspirations": (req, url, body) => ok({ id: "insp_1", ...body }),
    ...extra
  };
}

test("insp add --text：POST /api/inspirations，body 只带 text", async () => {
  const mock = await startMock(inspRoutes());
  try {
    const r = await runCli(["insp", "add", "--text", "灵光一闪"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "POST");
    assert.equal(mock.hits[0].path, "/api/inspirations");
    assert.deepEqual(mock.hits[0].body, { text: "灵光一闪" });
    assert.equal(JSON.parse(r.stdout).data.id, "insp_1");
  } finally {
    await mock.close();
  }
});

test("insp add --url：body 只带 url", async () => {
  const mock = await startMock(inspRoutes());
  try {
    const r = await runCli(["insp", "add", "--url", "https://example.com/x"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(mock.hits[0].body, { url: "https://example.com/x" });
  } finally {
    await mock.close();
  }
});

test("insp add 两个都不给：退出码 2，零命中", async () => {
  const mock = await startMock(inspRoutes());
  try {
    const r = await runCli(["insp", "add"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});
