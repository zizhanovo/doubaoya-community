// profile.test.mjs — dby-cli-unification 任务 3.3：`dby profile` 每条子命令至少一条用例，
// destructive 两条命令（delete/sample-rm）各核「不带 --confirm 退出码 6 且零命中」与
// 「带 --confirm 命中一次」。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

const FIXTURE_PROFILE = { id: "p1", isDefault: true, name: "测试号" };

function profileRoutes(extra = {}) {
  return {
    "GET /api/ip-profiles": ok({ profiles: [FIXTURE_PROFILE] }),
    "GET /api/ip-profile": ok({ profile: FIXTURE_PROFILE }),
    "POST /api/ip-profile": (req, url, body) => ok({ profile: { id: "new1", ...body } }),
    "PUT /api/ip-profile/p1": (req, url, body) => ok({ profile: { id: "p1", ...body } }),
    "DELETE /api/ip-profile/p1": ok({ deleted: true, id: "p1" }),
    "GET /api/ip-profile/wechat-history": ok({ articles: [{ title: "历史图文一", url: "https://x/1" }] }),
    "POST /api/ip-profile/p1/samples": (req, url, body) =>
      ok({ sample: { id: "s_new", ...body }, dnaSampleCount: 1 }),
    "GET /api/ip-profile/p1/samples": ok({
      samples: [{ id: "s1", title: "范文一", wordCount: 120, content: "正文" }],
      dnaSampleCount: 1
    }),
    "DELETE /api/ip-profile/p1/samples/s1": ok({ deleted: true, id: "s1", dnaSampleCount: 0 }),
    ...extra
  };
}

test("profile list：GET /api/ip-profiles，退出码 0", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(["profile", "list"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.deepEqual(data.profiles, [FIXTURE_PROFILE]);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "GET");
    assert.equal(mock.hits[0].path, "/api/ip-profiles");
  } finally {
    await mock.close();
  }
});

test("profile get：打 GET /api/ip-profile（默认档案），不带 :id", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(["profile", "get"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.deepEqual(data.profile, FIXTURE_PROFILE);
    assert.deepEqual(
      mock.hits.map((h) => `${h.method} ${h.path}`),
      ["GET /api/ip-profile"]
    );
  } finally {
    await mock.close();
  }
});

test("profile create：--body 原样 POST /api/ip-profile", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(["profile", "create", "--body", '{"name":"新号"}'], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const post = mock.hits.find((h) => h.method === "POST" && h.path === "/api/ip-profile");
    assert.ok(post, "必须真的 POST 了");
    assert.deepEqual(post.body, { name: "新号" });
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.profile.name, "新号");
  } finally {
    await mock.close();
  }
});

test("profile create：--body 与 --file 同给 → USAGE(2)", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(
      ["profile", "create", "--body", "{}", "--file", "/nonexistent.json"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 2, r.stderr);
    assert.equal(mock.hits.length, 0, "参数错在发请求之前就该拦下");
  } finally {
    await mock.close();
  }
});

test("profile update：PUT /api/ip-profile/:id 带 --body", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(["profile", "update", "p1", "--body", '{"name":"改名"}'], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const put = mock.hits.find((h) => h.method === "PUT");
    assert.equal(put.path, "/api/ip-profile/p1");
    assert.deepEqual(put.body, { name: "改名" });
  } finally {
    await mock.close();
  }
});

test("profile wechat-history：--appid 拼进 query，--count 一并透传", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(
      ["profile", "wechat-history", "--appid", "wx1", "--count", "3"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const hit = mock.hits[0];
    assert.equal(hit.path, "/api/ip-profile/wechat-history");
    const q = new URLSearchParams(hit.query);
    assert.equal(q.get("authorizerAppid"), "wx1");
    assert.equal(q.get("count"), "3");
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.articles.length, 1);
  } finally {
    await mock.close();
  }
});

test("profile wechat-history：缺 --appid → USAGE(2)，零命中", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(["profile", "wechat-history"], { env: envFor(mock) });
    assert.equal(r.code, 2, r.stderr);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("profile sample-add：正文走 --body（纯文本非 JSON），title/source-url 一并带上", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(
      ["profile", "sample-add", "p1", "--title", "标题一", "--source-url", "https://src", "--body", "范文正文"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 0, r.stderr);
    const post = mock.hits.find((h) => h.path === "/api/ip-profile/p1/samples");
    assert.deepEqual(post.body, { content: "范文正文", title: "标题一", sourceUrl: "https://src" });
  } finally {
    await mock.close();
  }
});

test("profile sample-list：GET /api/ip-profile/:id/samples", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const r = await runCli(["profile", "sample-list", "p1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.samples.length, 1);
  } finally {
    await mock.close();
  }
});

test("profile delete：不带 --confirm 退出码 6，零 DELETE 命中；带 --confirm 命中一次", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const blocked = await runCli(["profile", "delete", "p1"], { env: envFor(mock) });
    assert.equal(blocked.code, 6, blocked.stderr);
    const blockedOut = JSON.parse(blocked.stdout);
    assert.equal(blockedOut.status, "confirmation_required");
    assert.equal(mock.hits.filter((h) => h.method === "DELETE").length, 0, "未确认前不许有 DELETE");

    const confirmed = await runCli(["profile", "delete", "p1", "--confirm"], { env: envFor(mock) });
    assert.equal(confirmed.code, 0, confirmed.stderr);
    const deletes = mock.hits.filter((h) => h.method === "DELETE" && h.path === "/api/ip-profile/p1");
    assert.equal(deletes.length, 1);
  } finally {
    await mock.close();
  }
});

test("profile sample-rm：不带 --confirm 退出码 6，零命中；带 --confirm 命中一次", async () => {
  const mock = await startMock(profileRoutes());
  try {
    const blocked = await runCli(["profile", "sample-rm", "p1", "s1"], { env: envFor(mock) });
    assert.equal(blocked.code, 6, blocked.stderr);
    assert.equal(mock.hits.filter((h) => h.method === "DELETE").length, 0);

    const confirmed = await runCli(["profile", "sample-rm", "p1", "s1", "--confirm"], { env: envFor(mock) });
    assert.equal(confirmed.code, 0, confirmed.stderr);
    const deletes = mock.hits.filter(
      (h) => h.method === "DELETE" && h.path === "/api/ip-profile/p1/samples/s1"
    );
    assert.equal(deletes.length, 1);
  } finally {
    await mock.close();
  }
});
