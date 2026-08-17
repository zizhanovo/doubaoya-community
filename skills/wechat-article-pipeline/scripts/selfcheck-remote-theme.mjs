#!/usr/bin/env node
// selfcheck-remote-theme.mjs — 服务端编译主题拉取 + engine-2 硬闸的可运行自检。
// -----------------------------------------------------------------------------
// 零框架 assert 式自检，覆盖：
//   1. 拉到编译主题 → 直接用（校验通过、dropped 告警）；
//   2. 401 → warn（提示检查密钥）+ 回退 null；
//   3. 网络错误 → 一句 info + 回退 null；
//   4. 显式 --theme / config.mdTheme 时不发请求（主流程的守门谓词）；
//   5. engine-2 主题（meta.engine:2 / top-level tokens / 带点号 token）→ validator 硬错误；
//   6. 「编译形态」fixture（engine-1 形状全字面量）走完整渲染 → HTML 零 "{{"；
//   7. 两份 validate-theme.mjs（pipeline 与 theme-studio）字节相同。
//
// 跑法：node scripts/selfcheck-remote-theme.mjs   （exit 0 = 全绿）
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchCompiledTheme, hasExplicitLocalTheme, renderMarkdownForDraft } from "./pipeline.mjs";
import { validateTheme } from "./validate-theme.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 手工构造的「编译形态」主题：engine-1 形状、全字面量、零 {{token}}。
// 与服务端契约一致：top-level ⊆ {meta,palette,page,elements,decorations}。
const COMPILED_FIXTURE = {
  meta: { name: "编译形态自检主题" },
  palette: { text: "#333333", heading: "#111111", accent: "#ff8708", muted: "#999999", bgSoft: "#fff7ef", border: "#eeeeee", link: "#ff8708", accent2: "#cc6a00" },
  page: { fontFamily: "'PingFang SC',sans-serif", fontSize: "16px", lineHeight: "1.8", letterSpacing: "0.01em", color: "#333333" },
  elements: {
    h2: { style: "font-size:19px;font-weight:700;color:#111111;border-left:4px solid #ff8708;padding-left:11px;margin:28px 0 14px;" },
    p: { style: "font-size:16px;line-height:1.8;color:#333333;margin:0 0 18px;" },
    blockquote: { style: "border-left:3px solid #ff8708;background:#fff7ef;padding:12px 16px;margin:0 0 18px;color:#666666;" },
    strong: { style: "color:#cc6a00;font-weight:700;" },
  },
  decorations: { articleWrap: { before: "", after: "" } },
};

let passed = 0;
function ok(name) {
  passed++;
  process.stdout.write(`  ✅ ${name}\n`);
}

// 可控 stub：按 handler 响应，并记录命中次数与请求。
function startStub(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() });
    });
  });
}

function collect() {
  const infos = [];
  const warns = [];
  return { infos, warns, onInfo: (m) => infos.push(m), onWarn: (m) => warns.push(m) };
}

async function main() {
  // ---- 1. 拉到编译主题 → 用远端（含 dropped 告警） -------------------------
  {
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            theme: COMPILED_FIXTURE,
            themeId: "t_1",
            themeName: "暖橘编辑",
            isDefault: true,
            source: "user",
            compiledFrom: 2,
            dropped: ["elements.h2.variant"],
          },
        })
      );
    });
    const c = collect();
    const remote = await fetchCompiledTheme({ baseUrl: stub.baseUrl, apiKey: "dyh_test", ...c });
    stub.close();
    assert.ok(remote, "应拉到编译主题");
    assert.deepEqual(remote.theme, COMPILED_FIXTURE);
    assert.equal(remote.themeName, "暖橘编辑");
    assert.equal(stub.seen.length, 1, "只应请求一次");
    assert.equal(stub.seen[0].url, "/api/wechat/theme?format=compiled");
    assert.equal(stub.seen[0].auth, "Bearer dyh_test");
    assert.ok(c.warns.some((w) => w.includes("elements.h2.variant")), "dropped 非空应 warn 列出");
    ok("拉到编译主题 → 用远端，dropped 有告警");
  }

  // ---- 2. 401 → warn 提示检查密钥 + 回退 ----------------------------------
  {
    const stub = await startStub((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "bad key" } }));
    });
    const c = collect();
    const remote = await fetchCompiledTheme({ baseUrl: stub.baseUrl, apiKey: "dyh_bad", ...c });
    stub.close();
    assert.equal(remote, null, "401 应回退 null");
    assert.ok(c.warns.some((w) => w.includes("DOUBAOYA_API_KEY") && w.includes("本次用本机主题")), "401 应 warn 提示检查密钥");
    ok("401 → warn 提示密钥 + 回退本机");
  }

  // ---- 3. 网络错误 → 一句 info + 回退 -------------------------------------
  {
    // 起个 stub 拿到一个刚释放的端口，保证 connection refused。
    const stub = await startStub((_req, res) => res.end());
    const deadBase = stub.baseUrl;
    await new Promise((r) => { stub.close(); setTimeout(r, 50); });
    const c = collect();
    const remote = await fetchCompiledTheme({ baseUrl: deadBase, apiKey: "dyh_test", timeoutMs: 2000, ...c });
    assert.equal(remote, null, "网络错误应回退 null");
    assert.equal(c.warns.length, 0, "网络错误不该 warn 刷屏");
    assert.equal(c.infos.length, 1, "网络错误只该有一句 info");
    ok("网络错误 → 一句 info + 回退本机");
  }

  // ---- 3b. 404（接口未部署）→ info + 回退 ---------------------------------
  {
    const stub = await startStub((_req, res) => {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html>not found</html>");
    });
    const c = collect();
    const remote = await fetchCompiledTheme({ baseUrl: stub.baseUrl, apiKey: "dyh_test", ...c });
    stub.close();
    assert.equal(remote, null, "404 应回退 null");
    assert.equal(c.warns.length, 0);
    assert.equal(c.infos.length, 1, "404 只该有一句 info");
    ok("404（接口未部署）→ 一句 info + 回退本机");
  }

  // ---- 3c. 远端主题过不了本地校验（保险带）→ warn + 回退 ------------------
  {
    const stub = await startStub((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { theme: { meta: { engine: 2 }, tokens: { ref: { c: "#fff" } } } } }));
    });
    const c = collect();
    const remote = await fetchCompiledTheme({ baseUrl: stub.baseUrl, apiKey: "dyh_test", ...c });
    stub.close();
    assert.equal(remote, null, "校验不过应回退 null");
    assert.ok(c.warns.some((w) => w.includes("未通过本地校验")), "应 warn 校验失败");
    ok("远端主题校验不过（保险带）→ warn + 回退本机");
  }

  // ---- 4. 显式 --theme / config.mdTheme 时不发请求 -------------------------
  {
    assert.equal(hasExplicitLocalTheme({ cliTheme: "themes/magazine.json" }), true);
    assert.equal(hasExplicitLocalTheme({ cliTheme: "neutral" }), true);
    assert.equal(hasExplicitLocalTheme({ configuredTheme: "themes/magazine.json", configHasTheme: true }), true);
    assert.equal(hasExplicitLocalTheme({ configuredTheme: null, configHasTheme: true }), false, "mdTheme:null = 自动，不算显式");
    assert.equal(hasExplicitLocalTheme({}), false);
    // 复现主流程的守门组合：谓词为真 → fetch 一次都不发。
    const stub = await startStub((_req, res) => res.end("{}"));
    if (!hasExplicitLocalTheme({ cliTheme: "themes/magazine.json" })) {
      await fetchCompiledTheme({ baseUrl: stub.baseUrl, apiKey: "dyh_test" });
    }
    stub.close();
    assert.equal(stub.seen.length, 0, "显式指定主题时不该发请求");
    ok("显式 --theme/config.mdTheme → 不发请求");
  }

  // ---- 5. engine-2 主题喂给 validator 必须 error ---------------------------
  {
    const r1 = validateTheme({ meta: { engine: 2 } });
    assert.ok(r1.errors.some((e) => e.includes("engine 2") && e.includes("format=compiled")), "meta.engine:2 必须 error 且指路编译版");
    const r2 = validateTheme({ tokens: { ref: { color: { primary: "#ff8708" } } } });
    assert.ok(r2.errors.some((e) => e.includes("tokens") && e.includes("format=compiled")), "top-level tokens 必须 error");
    const r3 = validateTheme({ elements: { h2: { style: "color:{{ref.color.primary}};" } } });
    assert.ok(r3.errors.some((e) => e.includes("ref.color.primary") && e.includes("format=compiled")), "带点号 token 必须 error");
    // 反例：正常 engine-1 主题不受影响。
    const r4 = validateTheme(COMPILED_FIXTURE);
    assert.equal(r4.errors.length, 0, `编译形态 fixture 应通过校验：${r4.errors[0] || ""}`);
    ok("engine-2 三种形态 → validator 硬错误；engine-1 不受影响");
  }

  // ---- 6. 编译形态 fixture 走完整渲染 → HTML 零 "{{" -----------------------
  {
    const md = [
      "开头一段话，**强调**一下。",
      "",
      "## 第一节",
      "",
      "> 引用一句。",
      "",
      "正文继续。",
    ].join("\n");
    const html = renderMarkdownForDraft(md, COMPILED_FIXTURE);
    assert.ok(html.includes("border-left:4px solid #ff8708"), "主题样式应套上");
    assert.ok(!html.includes("{{"), "编译形态主题渲染出的 HTML 必须零 {{");
    ok("编译形态 fixture 完整渲染 → HTML 零 {{");
  }

  // ---- 7. 两份 validate-theme.mjs 字节相同 ---------------------------------
  {
    const a = await readFile(path.join(__dirname, "validate-theme.mjs"));
    const b = await readFile(path.resolve(__dirname, "../../wechat-theme-studio/scripts/validate-theme.mjs"));
    assert.ok(a.equals(b), "两份 validate-theme.mjs 必须字节相同（改一份要同步另一份）");
    ok("两份 validate-theme.mjs 字节相同");
  }

  process.stdout.write(`\n全绿：${passed} 项自检通过。\n`);
}

main().catch((e) => {
  process.stderr.write(`\n❌ 自检失败：${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
