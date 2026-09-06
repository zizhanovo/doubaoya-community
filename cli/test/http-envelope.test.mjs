// http-envelope.test.mjs — request() 的 withEnvelope 选项：信封顶层 detailUrl 只有这样才拿得到（dby-publish 的在线预览链接靠它）。
import test from "node:test";
import assert from "node:assert/strict";
import { startMock, ok } from "./helpers.mjs";
import { request } from "../../skills/dby-api/scripts/lib/http.mjs";
import { makeContext } from "../../skills/dby-api/scripts/lib/context.mjs";

test("withEnvelope:true 返回 {data, detailUrl, notice, noResult}；默认仍只返回 data", async () => {
  const mock = await startMock({
    "POST /api/wechat/render": ok({ html: "<p>x</p>" }, { detailUrl: "https://doubaoya.com/p/1", notice: "有更新" })
  });
  try {
    const ctx = makeContext({ env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: "dyh_test" }, stdoutIsTTY: false });
    const full = await request(ctx, "POST", "/api/wechat/render", { body: { markdown: "x" }, withEnvelope: true });
    assert.deepEqual(full, { data: { html: "<p>x</p>" }, detailUrl: "https://doubaoya.com/p/1", notice: "有更新", noResult: null });
    const bare = await request(ctx, "POST", "/api/wechat/render", { body: { markdown: "x" } });
    assert.deepEqual(bare, { html: "<p>x</p>" });
    assert.equal(mock.hits.length, 2);
  } finally { await mock.close(); }
});
