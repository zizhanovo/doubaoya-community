// local-no-network.test.mjs — spec「子命令分三类并由对账闸核对」的 local 一半（tasks 2.5）：
// kind=local 的命令在「任何出网尝试都记一笔并失败」的环境下运行，必须零记录。
//
// 🔴 元断言：LOCAL_INVOCATIONS 必须覆盖命令表里**每一条** local 命令——新增 local 命令却没在这里
//    登记一种跑法，本测试直接红（否则新命令天然在检查面之外，「漏检长得跟通过一模一样」）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_COMMANDS } from "../src/registry.mjs";
import { createServer } from "node:http";
import { runCli, startMock } from "./helpers.mjs";
import { solidPng } from "./fixtures/png.mjs";

const TRIPWIRE = fileURLToPath(new URL("./fixtures/net-tripwire.mjs", import.meta.url));
const nameOf = (c) => (c.group ? `${c.group} ${c.name}` : c.name);

/** 每条 local 命令的一种典型跑法。值是函数：拿到临时目录，返回 argv（可以先在目录里造输入文件）。 */
export const LOCAL_INVOCATIONS = {
  routes: () => ["routes", "--json"],
  "image plan": (dir) => {
    const md = path.join(dir, "a.md");
    writeFileSync(md, `# 标题\n\n## 第一节\n\n${"正文内容。".repeat(60)}\n\n## 第二节\n\n短。\n`);
    return ["image", "plan", "--md", md, "--json"];
  },
  "image crops": (dir) => {
    const png = path.join(dir, "cover.png");
    writeFileSync(png, solidPng(470, 300));
    return ["image", "crops", png, "--json"];
  },
  "deai scan": (dir) => {
    writeFileSync(path.join(dir, "稿.md"), "在当今这个时代，值得注意的是，它不是工具，而是生产力。\n");
    return ["deai", "scan", "--file", path.join(dir, "稿.md"), "--json"];
  },
  "deai baseline": (dir) => {
    writeFileSync(path.join(dir, "范文.md"), "上周三下午，我在楼下等了 40 分钟。\n");
    return ["deai", "baseline", path.join(dir, "范文.md"), "--out", path.join(dir, "基线.json"), "--json"];
  },
  "rewrite rules": () => ["rewrite", "rules", "小红书,抖音", "--json"],
  "feedback prepare": (dir) => {
    writeFileSync(path.join(dir, "report.md"), "# 反馈\n\n## 操作序列\n1. 跑了 dby deai scan\n");
    return ["feedback", "prepare", "--category", "bug", "--report", path.join(dir, "report.md"), "--out", path.join(dir, "payload.json"), "--scope-root", dir, "--json"];
  },
  // 端点未配置（测试 env 不带 DOUBAOYA_FEEDBACK_URL）⇒ 落本地、零出网、退出码 0
  "feedback submit": (dir) => {
    writeFileSync(path.join(dir, "payload.json"), JSON.stringify({ category: "bug", report: "# 反馈", machineFacts: {}, installId: "0".repeat(32), skillVersion: "doubaoya-cli/test" }));
    return ["feedback", "submit", "--file", path.join(dir, "payload.json"), "--scope-root", dir, "--json"];
  },
  "feedback keep": (dir) => {
    writeFileSync(path.join(dir, "payload.json"), JSON.stringify({ category: "idea", report: "# 想法", machineFacts: {}, installId: "0".repeat(32), skillVersion: "doubaoya-cli/test" }));
    return ["feedback", "keep", "--file", path.join(dir, "payload.json"), "--scope-root", dir, "--json"];
  },
  "feedback reset-id": (dir) => ["feedback", "reset-id", "--scope-root", dir, "--json"],
  // 只打用户给的那个网址（这里是测试里起的本地网页服务，绊线放行它），不打 doubaoya。
  "wechat fetch-article": (dir, { pageUrl }) => ({
    argv: ["wechat", "fetch-article", "--url", pageUrl, "--out", path.join(dir, "ref.html"), "--json"],
    allow: [new URL(pageUrl).host]
  })
};

test("元断言：每条 local 命令都登记了跑法，且确有 local 命令", () => {
  const locals = ALL_COMMANDS.filter((c) => c.kind === "local").map(nameOf).sort();
  assert.ok(locals.length > 0, "命令表里一条 local 命令都没有——分类推导八成坏了");
  assert.deepEqual(Object.keys(LOCAL_INVOCATIONS).sort(), locals, "LOCAL_INVOCATIONS 与命令表的 local 集合不一致");
});

test("每条 kind 都合法：route 恰好一条路由，local 零路由", () => {
  for (const c of ALL_COMMANDS) {
    assert.ok(["route", "composite", "local", "alias"].includes(c.kind), `${nameOf(c)} 的 kind=${c.kind} 不合法`);
    if (c.kind === "route") assert.equal((c.routes ?? []).length, 1, `${nameOf(c)} 标 route 但路由不是恰好一条`);
    if (c.kind === "local") assert.equal((c.routes ?? []).length, 0, `${nameOf(c)} 标 local 却登记了路由`);
  }
});

test("local 命令在出网绊线下运行：零出网尝试", async () => {
  // 双保险：DOUBAOYA_BASE_URL 指向一个「收到任何请求就记一笔」的桩，绊线再兜住其余一切出网。
  const hits = [];
  const mock = await startMock(new Proxy({}, { get: () => (req, url) => { hits.push(url.pathname); return { status: 500, json: {} }; } }));
  // 一个「公众号文章公开页」替身，给 fetch-article 抓。
  const page = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<html><body><div id="js_content" class="rich_media_content"><p style="color:#333;font-size:16px">正文</p></div></body></html>');
  });
  await new Promise((r) => page.listen(0, "127.0.0.1", r));
  const pageUrl = `http://127.0.0.1:${page.address().port}/s/abc`;
  try {
    const failures = [];
    for (const [name, build] of Object.entries(LOCAL_INVOCATIONS)) {
      const dir = mkdtempSync(path.join(tmpdir(), "dby-local-"));
      const log = path.join(dir, "net.log");
      writeFileSync(log, "");
      const built = build(dir, { pageUrl });
      const { argv, allow = [] } = Array.isArray(built) ? { argv: built } : built;
      const before = hits.length;
      const r = await runCli(argv, {
        env: {
          DOUBAOYA_BASE_URL: mock.url,
          DOUBAOYA_API_KEY: "dyh_test_key_never_real",
          DBY_NET_LOG: log,
          DBY_NET_ALLOW: allow.join(","),
          NODE_OPTIONS: `--import=${TRIPWIRE}`
        }
      });
      const tripped = existsSync(log) ? readFileSync(log, "utf8").trim() : "";
      if (tripped || hits.length !== before) {
        failures.push(`${name}（argv: ${argv.join(" ")}，退出码 ${r.code}）出网了：${tripped || hits.slice(before).join(", ")}`);
      }
      if (r.code < 0 || r.code > 6) failures.push(`${name} 退出码 ${r.code} 超出 0–6`);
      if (r.code === 1) failures.push(`${name} 以退出码 1 结束（本用例的输入都是合法的，不该走到一般错误）：${r.stderr.slice(0, 300)}`);
    }
    assert.deepEqual(failures, [], `local 命令偷偷联网：\n${failures.join("\n")}`);
  } finally {
    await mock.close();
    await new Promise((r) => page.close(r));
  }
});
