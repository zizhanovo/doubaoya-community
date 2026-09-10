// http-envelope.test.mjs — request() 的 withEnvelope 选项：信封顶层 detailUrl 只有这样才拿得到（dby-publish 的在线预览链接靠它）。
import test from "node:test";
import assert from "node:assert/strict";
import { startMock, ok } from "./helpers.mjs";
import { request } from "../../skills/dby-api/scripts/lib/http.mjs";
import { makeContext } from "../../skills/dby-api/scripts/lib/context.mjs";

test("withEnvelope:true 返回 {data, detailUrl, notice, noResult, aigc}；默认仍只返回 data", async () => {
  const mock = await startMock({
    "POST /api/wechat/render": ok({ html: "<p>x</p>" }, { detailUrl: "https://doubaoya.com/p/1", notice: "有更新" })
  });
  try {
    const ctx = makeContext({ env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: "dyh_test" }, stdoutIsTTY: false });
    const full = await request(ctx, "POST", "/api/wechat/render", { body: { markdown: "x" }, withEnvelope: true });
    assert.deepEqual(full, {
      data: { html: "<p>x</p>" },
      detailUrl: "https://doubaoya.com/p/1",
      notice: "有更新",
      noResult: null,
      aigc: null
    });
    const bare = await request(ctx, "POST", "/api/wechat/render", { body: { markdown: "x" } });
    assert.deepEqual(bare, { html: "<p>x</p>" });
    assert.equal(mock.hits.length, 2);
  } finally { await mock.close(); }
});

// 🔴 AI 生成内容的法定显式标识。服务端把它挂在信封顶层，正是因为「98.6% 的调用来自
// agent，只在网页写一行等于对绝大多数路径没有标识」——而在 2026-09-10 之前本请求层
// 把它丢了（withEnvelope 只挑四个字段），全仓 grep `aigc` 命中 0 次。挂了没人读 == 没挂。
// 这条用例钉住「它必须被透传出来」，别再让它在转发的时候消失一次。
test("生成类能力的 aigc 标识必须透传出来，不能在请求层被丢掉", async () => {
  const marker = { generated: true, label: "本内容由人工智能生成" };
  const mock = await startMock({
    "POST /api/skills/gpt-image-gen/invoke": ok({ images: [{ b64: "iVBOR", mime: "image/png" }] }, { aigc: marker })
  });
  try {
    const ctx = makeContext({ env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: "dyh_test" }, stdoutIsTTY: false });
    const full = await request(ctx, "POST", "/api/skills/gpt-image-gen/invoke", {
      body: { prompt: "x" },
      withEnvelope: true,
      billable: true
    });
    assert.deepEqual(full.aigc, marker, "aigc 必须原样出现在 withEnvelope 的返回里");
  } finally { await mock.close(); }
});
