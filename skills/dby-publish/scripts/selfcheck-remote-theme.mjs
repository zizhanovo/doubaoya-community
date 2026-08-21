#!/usr/bin/env node
// selfcheck-remote-theme.mjs — 平台渲染 + engine-2 硬闸的可运行自检。
// -----------------------------------------------------------------------------
// 零框架 assert 式自检，覆盖：
//   1. 平台渲染成功 → 拿到 html/themeSource/warnings/detailUrl；**未显式指定主题时
//      请求体里三个主题字段一个都没有**（由服务端套账号默认排版）；
//   2. 401 → **抛错中止**（不回退本机渲染器）；
//   3. 网络错误 / 超时 → 抛错中止；
//   3b. 非 2xx（含接口未部署）→ 抛错中止，错误信息带上 code；
//   3c. 200 但 html 为空 → 抛错中止（"成功了但没东西"不许放过）；
//   4. 显式主题 → themeJson / themeId 正确进请求体；守门谓词 hasExplicitLocalTheme；
//   5. engine-2 主题（meta.engine:2 / top-level tokens / 带点号 token）→ validator 硬错误；
//   6. 「编译形态」fixture（engine-1 形状全字面量）走完整**本机**渲染 → HTML 零 "{{"；
//   7. 两份 validate-theme.mjs（pipeline 与 theme-studio）字节相同。
//
// 🔴 1–3c 合起来守的是一条红线：**平台渲染失败一律中止，绝不静默回退本机渲染器**。
//    回退会产出「看起来成功、却没有预览链接、排版还可能不是用户设的那套」的产物。
//    以前这几项测的是 fetchCompiledTheme 的**优雅回退**——那个函数随流水线改走平台
//    渲染一起退场了，语义正好反过来：那时回退是对的，现在回退是缺陷。
//
// 第 5 / 6 / 7 项编号**不要动**：两份 validate-theme.mjs 的注释按「第 5 项」引用它。
//
// 跑法：node scripts/selfcheck-remote-theme.mjs   （exit 0 = 全绿）
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hasExplicitLocalTheme, normalizeDraftMarkdown, renderViaPlatform } from "./pipeline.mjs";
import { renderWechatHtml } from "./render-wechat-html.mjs";
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
  // 平台渲染的成功响应信封（与 apps/api render-routes.ts 的 responseData 同形）。
  const okEnvelope = (extra = {}) =>
    JSON.stringify({
      success: true,
      requestId: "req_selfcheck",
      data: { html: "<section>正文</section>", themeSource: "userDefault:t_1", ...extra },
      error: null,
      detailUrl: "https://doubaoya.com/dashboard/usage?call=req_selfcheck",
    });

  // 读请求体的 stub（renderViaPlatform 是 POST，要看送了什么）。
  function bodyReadingStub(handler) {
    return startStub((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        req.parsedBody = (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })();
        handler(req, res);
      });
    });
  }

  // ---- 1. 成功 → 四个字段都拿到；未显式指定主题时不送任何主题字段 ----------
  {
    let seenBody = null;
    const stub = await bodyReadingStub((req, res) => {
      seenBody = req.parsedBody;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(okEnvelope({ warnings: ["未闭合的 {{ 占位符"] }));
    });
    const out = await renderViaPlatform({
      baseUrl: stub.baseUrl,
      apiKey: "dyh_test",
      markdown: "正文一段。",
    });
    stub.close();
    assert.equal(out.html, "<section>正文</section>");
    assert.equal(out.themeSource, "userDefault:t_1");
    assert.deepEqual(out.warnings, ["未闭合的 {{ 占位符"]);
    assert.equal(out.detailUrl, "https://doubaoya.com/dashboard/usage?call=req_selfcheck");
    assert.equal(stub.seen.length, 1, "只应请求一次");
    assert.equal(stub.seen[0].url, "/api/wechat/render");
    assert.equal(stub.seen[0].auth, "Bearer dyh_test");
    // 🔴 这一条是「主题只有一个事实源」的机器判据：没显式指定就一个字段都不许送，
    //    否则服务端的默认排版会被本机凭空塞进来的值盖掉。
    assert.deepEqual(Object.keys(seenBody), ["markdown"], `未指定主题时请求体只该有 markdown，实际: ${Object.keys(seenBody)}`);
    assert.ok(!("title" in seenBody), "不该送 title（公众号后台单独承载标题）");
    ok("平台渲染成功 → html/themeSource/warnings/detailUrl 齐；未指定主题时零主题字段");
  }

  // ---- 2. 401 → 抛错中止（不回退）-----------------------------------------
  {
    const stub = await bodyReadingStub((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "bad key" } }));
    });
    await assert.rejects(
      () => renderViaPlatform({ baseUrl: stub.baseUrl, apiKey: "dyh_bad", markdown: "x" }),
      (e) => e.message.includes("401") && e.message.includes("DOUBAOYA_API_KEY"),
      "401 必须抛错并提示检查密钥"
    );
    stub.close();
    ok("401 → 抛错中止（不回退本机渲染器）");
  }

  // ---- 3. 网络错误 → 抛错中止 ----------------------------------------------
  {
    // 起个 stub 拿到一个刚释放的端口，保证 connection refused。
    const stub = await startStub((_req, res) => res.end());
    const deadBase = stub.baseUrl;
    await new Promise((r) => {
      stub.close();
      setTimeout(r, 50);
    });
    await assert.rejects(
      () => renderViaPlatform({ baseUrl: deadBase, apiKey: "dyh_test", markdown: "x", timeoutMs: 2000 }),
      (e) => e.message.includes("平台渲染请求失败"),
      "网络错误必须抛错"
    );
    ok("网络错误 → 抛错中止");
  }

  // ---- 3b. 非 2xx（接口未部署 / 500）→ 抛错并带上 code ----------------------
  {
    const stub = await bodyReadingStub((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "RENDER_FAILED", message: "渲染失败" } }));
    });
    await assert.rejects(
      () => renderViaPlatform({ baseUrl: stub.baseUrl, apiKey: "dyh_test", markdown: "x" }),
      (e) => e.message.includes("RENDER_FAILED"),
      "非 2xx 必须抛错且错误信息带 code"
    );
    stub.close();

    const stub404 = await bodyReadingStub((_req, res) => {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html>not found</html>");
    });
    await assert.rejects(
      () => renderViaPlatform({ baseUrl: stub404.baseUrl, apiKey: "dyh_test", markdown: "x" }),
      (e) => e.message.includes("HTTP 404"),
      "响应不是 JSON 时也必须抛错，不能当成功"
    );
    stub404.close();
    ok("非 2xx（500 / 404 非 JSON）→ 抛错中止，带 code");
  }

  // ---- 3c. 200 但 html 为空 → 抛错（"成功了但没东西"不许放过）--------------
  {
    const stub = await bodyReadingStub((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { html: "   " }, detailUrl: null }));
    });
    await assert.rejects(
      () => renderViaPlatform({ baseUrl: stub.baseUrl, apiKey: "dyh_test", markdown: "x" }),
      (e) => e.message.includes("空 HTML"),
      "空 html 必须抛错"
    );
    stub.close();
    ok("200 但 html 为空 → 抛错中止");
  }

  // ---- 4. 显式主题 → themeJson / themeId 正确进请求体 -----------------------
  {
    assert.equal(hasExplicitLocalTheme({ cliTheme: "themes/magazine.json" }), true);
    assert.equal(hasExplicitLocalTheme({ cliTheme: "neutral" }), true);
    assert.equal(hasExplicitLocalTheme({ configuredTheme: "themes/magazine.json", configHasTheme: true }), true);
    assert.equal(hasExplicitLocalTheme({ configuredTheme: null, configHasTheme: true }), false, "mdTheme:null = 自动，不算显式");
    assert.equal(hasExplicitLocalTheme({}), false);

    let bodyA = null;
    const stubA = await bodyReadingStub((req, res) => {
      bodyA = req.parsedBody;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(okEnvelope());
    });
    await renderViaPlatform({ baseUrl: stubA.baseUrl, apiKey: "dyh_test", markdown: "x", themeJson: COMPILED_FIXTURE });
    stubA.close();
    assert.deepEqual(bodyA.themeJson, COMPILED_FIXTURE, "显式主题应整套作为 themeJson 送出");
    assert.ok(!("themeId" in bodyA), "送了 themeJson 就不该再送 themeId");

    let bodyB = null;
    const stubB = await bodyReadingStub((req, res) => {
      bodyB = req.parsedBody;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(okEnvelope());
    });
    await renderViaPlatform({ baseUrl: stubB.baseUrl, apiKey: "dyh_test", markdown: "x", themeId: "neutral" });
    stubB.close();
    assert.equal(bodyB.themeId, "neutral", "--theme neutral 应送 themeId=neutral");
    assert.ok(!("themeJson" in bodyB), "neutral 不该带 themeJson");
    ok("显式主题 → themeJson / themeId 正确进请求体");
  }

  // ---- 4b. 没有密钥 → 抛错，并指路本机渲染器（且写明它没有在线链接）--------
  {
    await assert.rejects(
      () => renderViaPlatform({ baseUrl: "http://127.0.0.1:1", apiKey: "", markdown: "x" }),
      (e) => e.message.includes("render-wechat-html.mjs") && e.message.includes("不产生在线预览链接"),
      "无密钥要抛错并指路本机渲染器，同时讲清它没有在线链接"
    );
    ok("无密钥 → 抛错并指路本机渲染器（写明无在线链接）");
  }

  // ---- 4c. 结构断言：渲染失败时不可能留下半成品 HTML ----------------------
  {
    // 想用「--base-url 指到不可达地址」来测这条是**测不到**的：base-url 同时管 whoami，
    // 流水线在第 2 步就红了，根本走不到第 4 步。所以直接钉住源码里的顺序性质：
    //   ① 写文件必须发生在 renderViaPlatform 之后（渲染没成功就没有内容可写）
    //   ② 渲染的 catch 里必须是 fail()（进程退出），不是 warn 后继续
    // 这两条一旦被后来的重构破坏，就会退回「渲染失败却留下半成品、还继续往下发」的形状。
    const src = await readFile(path.join(__dirname, "pipeline.mjs"), "utf8");
    const iRender = src.indexOf("await renderViaPlatform({");
    const iWrite = src.indexOf("await writeFile(processedHtmlPath");
    assert.ok(iRender > 0, "pipeline 必须调用 renderViaPlatform");
    assert.ok(iWrite > 0, "pipeline 必须写 processedHtmlPath");
    assert.ok(iRender < iWrite, "写 HTML 必须在平台渲染之后，否则渲染失败会留下半成品");

    const between = src.slice(iRender, iWrite);
    assert.ok(/catch \(e\) \{/.test(between), "renderViaPlatform 必须被 try/catch 包住");
    assert.ok(/fail\(/.test(between), "渲染失败必须 fail()（进程退出），不许 warn 后继续");
    assert.ok(
      !/renderWechatHtml\(/.test(src),
      "pipeline 不许再直接调用本机渲染器 —— 那就是被禁止的静默回退"
    );
    ok("结构断言：写 HTML 在渲染之后、失败即 fail()、pipeline 不碰本机渲染器");
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

  // ---- 6. 编译形态 fixture 走完整**本机**渲染 → HTML 零 "{{" ---------------
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
    // renderMarkdownForDraft 随流水线改走平台渲染一起退场；这里直接用本机渲染器，
    // 与 design-studio.mjs 的用法一致（本机渲染器保留的两个场景之一）。
    const html = renderWechatHtml(normalizeDraftMarkdown(md), { theme: COMPILED_FIXTURE });
    assert.ok(html.includes("border-left:4px solid #ff8708"), "主题样式应套上");
    assert.ok(!html.includes("{{"), "编译形态主题渲染出的 HTML 必须零 {{");
    ok("编译形态 fixture 完整渲染 → HTML 零 {{");
  }

  // ---- 7. 两份 validate-theme.mjs 字节相同 ---------------------------------
  {
    const a = await readFile(path.join(__dirname, "validate-theme.mjs"));
    const b = await readFile(path.resolve(__dirname, "../../dby-theme/scripts/validate-theme.mjs"));
    assert.ok(a.equals(b), "两份 validate-theme.mjs 必须字节相同（改一份要同步另一份）");
    ok("两份 validate-theme.mjs 字节相同");
  }

  process.stdout.write(`\n全绿：${passed} 项自检通过。\n`);
}

main().catch((e) => {
  process.stderr.write(`\n❌ 自检失败：${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
