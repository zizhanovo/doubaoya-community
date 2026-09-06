// wechat.test.mjs — `dby wechat *` 的路由/退出码/确认协议核验（design: dby-cli-unification
// 任务 3.5）。publish/media-upload 写用户公众号后台，同 confirm.test.mjs 口径：不带 --confirm
// 零服务端命中退出码 6，带 --confirm 才真打。
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock, runCli, envFor, ok } from "./helpers.mjs";

async function tmpFile(name, content) {
  const dir = await mkdtemp(path.join(tmpdir(), "dby-wechat-"));
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

function wechatRoutes(extra = {}) {
  return {
    "GET /api/wechat/status": ok({ accounts: [{ authorizerAppid: "wx1", nickname: "测试号" }], authorizationAvailable: true }),
    "POST /api/wechat/render": (req, url, body) => ok({ html: `<p>${body.markdown}</p>`, receivedTitle: body.title ?? null }),
    "GET /api/wechat/writing-spec": ok({ spec: "# 写作规范" }),
    "GET /api/wechat/topics": ok({ topics: [{ title: "选题一" }] }),
    "GET /api/wechat/review": ok({ account: { nickname: "测试号" }, lastWeek: null }),
    "POST /api/wechat/publish": (req, url, body) => ok({ mediaId: "media_1", receivedTitle: body.title }),
    "POST /api/wechat/media/upload": (req, url, body) => ok({ url: "https://mmbiz/x.jpg", receivedPurpose: body.purpose ?? "image" }),
    "GET /api/wechat/themes": ok({ themes: [], builtin: [{ id: "benya-clean" }] }),
    "GET /api/wechat/theme": (req, url) => ok(
      url.searchParams.get("format") === "compiled"
        ? { theme: { engine: "engine-1" }, themeId: "benya-clean", source: "builtin" }
        : { theme: null }
    ),
    "POST /api/wechat/theme": (req, url, body) => ok({ theme: { id: "t1", ...body } }),
    "PUT /api/wechat/theme/t1": (req, url, body) => ok({ theme: { id: "t1", ...body } }),
    "DELETE /api/wechat/theme/t1": ok({ deleted: true, id: "t1" }),
    ...extra
  };
}

// ── status ───────────────────────────────────────────────────────────────────

test("wechat status：GET /api/wechat/status", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "status"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].path, "/api/wechat/status");
    assert.equal(JSON.parse(r.stdout).data.accounts[0].authorizerAppid, "wx1");
  } finally {
    await mock.close();
  }
});

// ── render ───────────────────────────────────────────────────────────────────

test("wechat render --file：读文件成 markdown，POST /api/wechat/render", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const md = await tmpFile("a.md", "# 标题\n正文");
    const r = await runCli(["wechat", "render", "--file", md, "--title", "标题"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "POST");
    assert.deepEqual(mock.hits[0].body, { markdown: "# 标题\n正文", title: "标题" });
  } finally {
    await mock.close();
  }
});

test("wechat render --theme-file：读 JSON 文件作 themeJson", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const md = await tmpFile("a.md", "正文");
    const theme = await tmpFile("theme.json", JSON.stringify({ palette: { accent: "#FF8708" } }));
    const r = await runCli(["wechat", "render", "--file", md, "--theme-file", theme], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(mock.hits[0].body, { markdown: "正文", themeJson: { palette: { accent: "#FF8708" } } });
  } finally {
    await mock.close();
  }
});

test("wechat render 缺 --file：退出码 2，零命中", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "render", "--title", "x"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

// ── writing-spec / topics / review：query 透传 ───────────────────────────────

test("wechat writing-spec --theme-name --section：query 透传", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "writing-spec", "--theme-name", "我的模板", "--section", "hard-constraints"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "?themeName=%E6%88%91%E7%9A%84%E6%A8%A1%E6%9D%BF&section=hard-constraints");
  } finally {
    await mock.close();
  }
});

test("wechat topics --keyword --niche：query 透传", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "topics", "--keyword", "美食", "--niche", "生活"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    const q = new URLSearchParams(mock.hits[0].query);
    assert.equal(q.get("keyword"), "美食");
    assert.equal(q.get("niche"), "生活");
  } finally {
    await mock.close();
  }
});

test("wechat review --appid：query 透传", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "review", "--appid", "wx1"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "?appid=wx1");
  } finally {
    await mock.close();
  }
});

// ── publish（billable，写公众号后台） ─────────────────────────────────────────

test("wechat publish 未带 --confirm：退出码 6，零命中，changes 带 appid 与 title", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const html = await tmpFile("a.html", "<p>正文</p>");
    const r = await runCli(["wechat", "publish", "--appid", "wx1", "--title", "标题", "--html", html], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes[0].ref, "wx1");
    assert.equal(parsed.changes[0].title, "标题");
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("wechat publish --confirm：真发，命中一次 POST", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const html = await tmpFile("a.html", "<p>正文</p>");
    const r = await runCli(["wechat", "publish", "--appid", "wx1", "--title", "标题", "--html", html, "--confirm"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "POST");
    assert.equal(mock.hits[0].body.authorizerAppid, "wx1");
    assert.equal(mock.hits[0].body.contentHtml, "<p>正文</p>");
  } finally {
    await mock.close();
  }
});

test("wechat publish 标题 65 字：本地硬闸，退出码 2，零命中（不带 --confirm 也一样）", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const html = await tmpFile("a.html", "<p>正文</p>");
    const longTitle = "标".repeat(65);
    const r = await runCli(["wechat", "publish", "--appid", "wx1", "--title", longTitle, "--html", html], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("wechat publish --draft-version 不带 --draft：退出码 2，零命中", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const html = await tmpFile("a.html", "<p>正文</p>");
    const r = await runCli(
      ["wechat", "publish", "--appid", "wx1", "--title", "标题", "--html", html, "--draft-version", "2"],
      { env: envFor(mock) }
    );
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

// ── media-upload（billable，写公众号素材库） ─────────────────────────────────

test("wechat media-upload 未带 --confirm：退出码 6，零命中", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const img = await tmpFile("cover.jpg", "fake-bytes");
    const r = await runCli(["wechat", "media-upload", img, "--appid", "wx1"], { env: envFor(mock) });
    assert.equal(r.code, 6);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.status, "confirmation_required");
    assert.equal(parsed.changes[0].ref, "wx1");
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("wechat media-upload --confirm：真传，命中一次 POST，dataBase64 正确编码", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const img = await tmpFile("cover.jpg", "fake-bytes");
    const r = await runCli(["wechat", "media-upload", img, "--appid", "wx1", "--purpose", "thumb", "--confirm"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].body.authorizerAppid, "wx1");
    assert.equal(mock.hits[0].body.purpose, "thumb");
    assert.equal(Buffer.from(mock.hits[0].body.dataBase64, "base64").toString("utf8"), "fake-bytes");
  } finally {
    await mock.close();
  }
});

test("wechat media-upload 文件 >10MB：本地拒，退出码 2，零命中", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "dby-wechat-big-"));
    const big = path.join(dir, "big.jpg");
    await writeFile(big, Buffer.alloc(11 * 1024 * 1024, 1));
    const r = await runCli(["wechat", "media-upload", big, "--appid", "wx1", "--confirm"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

// ── theme-list / theme-get ───────────────────────────────────────────────────

test("wechat theme-list：GET /api/wechat/themes", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "theme-list"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].path, "/api/wechat/themes");
  } finally {
    await mock.close();
  }
});

test("wechat theme-get：无 --compiled 不带 query", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "theme-get"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "");
    assert.equal(JSON.parse(r.stdout).data.theme, null);
  } finally {
    await mock.close();
  }
});

test("wechat theme-get --compiled：query format=compiled", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "theme-get", "--compiled"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits[0].query, "?format=compiled");
    assert.equal(JSON.parse(r.stdout).data.themeId, "benya-clean");
  } finally {
    await mock.close();
  }
});

// ── theme-add / theme-update / theme-rm ──────────────────────────────────────

test("wechat theme-add --file：POST /api/wechat/theme", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const themeFile = await tmpFile("theme.json", JSON.stringify({ palette: { accent: "#FF8708" } }));
    const r = await runCli(["wechat", "theme-add", "--file", themeFile, "--name", "我的主题", "--default"], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.deepEqual(mock.hits[0].body, { themeJson: { palette: { accent: "#FF8708" } }, name: "我的主题", isDefault: true });
  } finally {
    await mock.close();
  }
});

test("wechat theme-add 缺 --file：退出码 2，零命中", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "theme-add", "--name", "x"], { env: envFor(mock) });
    assert.equal(r.code, 2);
    assert.equal(mock.hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("wechat theme-update <id> --body：PUT /api/wechat/theme/:id", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const r = await runCli(["wechat", "theme-update", "t1", "--body", '{"name":"改名"}'], { env: envFor(mock) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "PUT");
    assert.equal(mock.hits[0].path, "/api/wechat/theme/t1");
    assert.deepEqual(mock.hits[0].body, { name: "改名" });
  } finally {
    await mock.close();
  }
});

test("wechat theme-rm 未带 --confirm：退出码 6，零命中；带 --confirm 命中一次 DELETE", async () => {
  const mock = await startMock(wechatRoutes());
  try {
    const bare = await runCli(["wechat", "theme-rm", "t1"], { env: envFor(mock) });
    assert.equal(bare.code, 6);
    assert.equal(mock.hits.length, 0);

    const confirmed = await runCli(["wechat", "theme-rm", "t1", "--confirm"], { env: envFor(mock) });
    assert.equal(confirmed.code, 0, confirmed.stderr);
    assert.equal(mock.hits.length, 1);
    assert.equal(mock.hits[0].method, "DELETE");
    assert.equal(mock.hits[0].path, "/api/wechat/theme/t1");
  } finally {
    await mock.close();
  }
});
