// render.test.mjs — tasks 2.11 / spec「排版只有服务端一个事实源」：
// dby render|preview 只写文件、JSON 不带 HTML（stdout < 2KB 且不含 <section）；
// 离线退出码 5 且不生成 HTML；无凭证退出码 4 且零请求、remediation 指向 dby login。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, startMock, ok } from "./helpers.mjs";

const KEY = "dyh_test_key_never_real";
const BIG_HTML = `<section style="padding:8px">${"<p>段落</p>".repeat(2000)}</section>`;

function md() {
  const d = mkdtempSync(path.join(tmpdir(), "dby-render-"));
  const f = path.join(d, "a.md");
  writeFileSync(f, "# 标题\n\n正文\n");
  return { d, f };
}

async function renderMock() {
  const bodies = [];
  const mock = await startMock({
    "POST /api/wechat/render": (req, url, body) => {
      bodies.push(body);
      return ok({ html: BIG_HTML, themeSource: "theme:benya-clean", warnings: [] }, { detailUrl: "https://doubaoya.com/r/xyz" });
    }
  });
  return { mock, bodies };
}

for (const cmd of ["render", "preview"]) {
  test(`dby ${cmd}：HTML 写文件，stdout < 2KB 且不含 <section`, async () => {
    const { mock, bodies } = await renderMock();
    try {
      const { d, f } = md();
      const r = await runCli([cmd, "--file", f, "--theme", "benya-clean", "--json"], { env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY, HOME: d } });
      assert.equal(r.code, 0, r.stderr);
      assert.ok(Buffer.byteLength(r.stdout) < 2048, `stdout ${Buffer.byteLength(r.stdout)} 字节`);
      assert.ok(!r.stdout.includes("<section"));
      const { data } = JSON.parse(r.stdout);
      assert.equal(readFileSync(data.htmlFile, "utf8"), BIG_HTML);
      assert.equal(data.bytes, Buffer.byteLength(BIG_HTML));
      assert.match(data.sha256, /^[0-9a-f]{64}$/);
      assert.equal(data.detailUrl, "https://doubaoya.com/r/xyz");
      assert.equal(bodies[0].themeId, "benya-clean");
      if (cmd === "preview") {
        const page = readFileSync(data.previewFile, "utf8");
        assert.match(page, /width:375px/);
        assert.ok(page.includes(BIG_HTML));
      } else {
        assert.equal(data.previewFile, undefined);
      }
    } finally {
      await mock.close();
    }
  });

  test(`dby ${cmd} 离线：退出码 5，说明离线不能渲染，不生成 HTML`, async () => {
    const dead = await startMock({});
    const url = dead.url;
    await dead.close();
    const { d, f } = md();
    const r = await runCli([cmd, "--file", f, "--json"], { env: { DOUBAOYA_BASE_URL: url, DOUBAOYA_API_KEY: KEY, HOME: d } });
    assert.equal(r.code, 5, r.stderr);
    assert.match(JSON.parse(r.stdout).error.message, /离线不能渲染/);
    assert.deepEqual(readdirSync(d).filter((n) => n.endsWith(".html")), []);
  });

  test(`dby ${cmd} 无凭证：退出码 4，零请求，remediation 指向 dby login`, async () => {
    const { mock, bodies } = await renderMock();
    try {
      const { d, f } = md();
      const r = await runCli([cmd, "--file", f, "--json"], { env: { DOUBAOYA_BASE_URL: mock.url, HOME: d } });
      assert.equal(r.code, 4, r.stderr);
      assert.match(JSON.parse(r.stdout).error.remediation, /dby login/);
      assert.equal(bodies.length, 0);
      assert.equal(existsSync(path.join(d, "a.wechat.html")), false);
    } finally {
      await mock.close();
    }
  });
}

test("dby preview --theme-file：整套主题 JSON 交服务端（themeJson），本地不校验", async () => {
  const { mock, bodies } = await renderMock();
  try {
    const { d, f } = md();
    const theme = path.join(d, "t.json");
    writeFileSync(theme, JSON.stringify({ meta: { name: "自定义" }, tokens: { primary: "#ff6600" } }));
    const r = await runCli(["preview", "--file", f, "--theme-file", theme, "--json"], { env: { DOUBAOYA_BASE_URL: mock.url, DOUBAOYA_API_KEY: KEY, HOME: d } });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(bodies[0].themeJson, { meta: { name: "自定义" }, tokens: { primary: "#ff6600" } });
  } finally {
    await mock.close();
  }
});
