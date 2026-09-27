// pipeline.test.mjs — tasks 2.10：pipeline.mjs / preprocess-and-publish.mjs 原样搬为 `dby wechat pipeline`
// （composite）。对本地桩覆盖：--dry-run 彩排（渲染 + 账号校验 + 扫描本地图，零发布）、--render-only、
// 真发布不带 --confirm 停在确认态且零请求、带 --confirm 走完预上传 + 存草稿并从回报里取出 mediaId。
// 另两份纯函数 selfcheck 在 test/selfcheck/（draft-limits、preprocess-and-publish）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, startMock, ok } from "./helpers.mjs";
import { solidPng } from "./fixtures/png.mjs";

const KEY = "dyh_test_key_never_real";

function article() {
  const d = mkdtempSync(path.join(tmpdir(), "dby-pipe-"));
  const img = path.join(d, "fig.png");
  writeFileSync(img, solidPng(16, 16));
  const md = path.join(d, "a.md");
  writeFileSync(md, `---\ntitle: x\n---\n# 标题\n\n正文第一段。\n\n![图](${img})\n`);
  return { d, md, img };
}

async function wechatMock() {
  const hits = [];
  const mock = await startMock({
    "GET /api/agent/whoami": ok({ user: { id: "u1", email: "me@example.com" }, authVia: "apiKey" }),
    "GET /api/skills": ok({ items: [{ slug: "wechat-draft-publish" }] }),
    "GET /api/wechat/status": ok({ accounts: [{ nickname: "测试号", authorizerAppid: "wx123" }] }),
    "POST /api/wechat/render": (req, url, body) => {
      hits.push({ path: "render", body });
      // 渲染结果里保留本地图 src，后面的预上传要把它换成图床地址
      const src = body.markdown.match(/\]\(([^)]+)\)/)?.[1] ?? "";
      return ok({ html: `<section><p>正文第一段。</p><img src="${src}"></section>`, themeSource: "default", warnings: [] }, { detailUrl: "https://doubaoya.com/r/abc" });
    },
    "POST /api/wechat/media/upload": (req, url, body) => {
      hits.push({ path: "upload", purpose: body.purpose });
      return ok({ url: "https://mmbiz.qpic.cn/mmbiz_png/x", mediaId: "thumb_1" });
    },
    "POST /api/wechat/publish": (req, url, body) => {
      hits.push({ path: "publish", body });
      return ok({ mediaId: "MEDIA_42" });
    }
  });
  return { mock, hits };
}

const env = (mock, home) => ({ DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY, HOME: home });

test("--dry-run：渲染 + 账号校验 + 扫描本地图，不发布；JSON 只回结构化结果", async () => {
  const { mock, hits } = await wechatMock();
  try {
    const { d, md } = article();
    const r = await runCli(["wechat", "pipeline", "--md", md, "--title", "测试标题", "--dry-run", "--json"], { env: env(mock, d) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.mode, "dry-run");
    assert.equal(data.detailUrl, "https://doubaoya.com/r/abc");
    assert.equal(data.localImages, 1);
    assert.ok(!hits.some((h) => h.path === "publish" || h.path === "upload"), "dry-run 不许上传或发布");
    assert.ok(!r.stdout.includes("<section"), "stdout 不回灌 HTML");
    assert.match(r.stderr, /DRY-RUN 回报/, "流水线的人读回报在 JSON 模式下走 stderr");
    const renderBody = hits.find((h) => h.path === "render").body;
    assert.ok(!renderBody.markdown.includes("# 标题"), "正文不带 frontmatter 与首个 H1（与 1.x 一致）");
  } finally {
    await mock.close();
  }
});

test("--render-only：只渲染，给 HTML 路径与在线预览链接", async () => {
  const { mock, hits } = await wechatMock();
  try {
    const { d, md } = article();
    const out = path.join(d, "out.html");
    const r = await runCli(["wechat", "pipeline", "--md", md, "--title", "t", "--render-only", "--output-processed-html", out, "--json"], { env: env(mock, d) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.mode, "render-only");
    assert.equal(data.htmlPath, out);
    assert.deepEqual(hits.map((h) => h.path), ["render"]);
  } finally {
    await mock.close();
  }
});

test("真发布不带 --confirm：confirmation_required（退出码 6），一个请求都不发", async () => {
  const { mock, hits } = await wechatMock();
  try {
    const { d, md } = article();
    const r = await runCli(["wechat", "pipeline", "--md", md, "--title", "t", "--json"], { env: env(mock, d) });
    assert.equal(r.code, 6, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, "confirmation_required");
    assert.equal(hits.length, 0);
  } finally {
    await mock.close();
  }
});

test("--confirm：预上传本地图 → 存草稿，mediaId 进 data", async () => {
  const { mock, hits } = await wechatMock();
  try {
    const { d, md } = article();
    const r = await runCli(["wechat", "pipeline", "--md", md, "--title", "t", "--confirm", "--json"], { env: env(mock, d) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.mode, "published");
    assert.equal(data.mediaId, "MEDIA_42");
    assert.deepEqual(hits.map((h) => h.path), ["render", "upload", "publish"]);
    assert.ok(hits.at(-1).body.contentHtml.includes("https://mmbiz.qpic.cn/"), "本地图已换成图床地址");
    assert.equal(hits.at(-1).body.authorizerAppid, "wx123");
  } finally {
    await mock.close();
  }
});

test("不接受任何群发意图的参数（未知 flag 一律 USAGE）", async () => {
  const r = await runCli(["wechat", "pipeline", "--md", "a.md", "--title", "t", "--mass-send", "--json"], { env: {} });
  assert.equal(r.code, 2);
});
