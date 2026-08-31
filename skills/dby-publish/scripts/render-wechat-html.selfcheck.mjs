#!/usr/bin/env node
// render-wechat-html.selfcheck.mjs —— renderWechatHtml 的可运行自检（零框架 assert）。
// 跑法：node scripts/render-wechat-html.selfcheck.mjs   （exit 0 = 全绿）
//
// 为什么存在（design.md D10，2026-08-31）：渲染是**确定性行为**，此前由执行层 agent 用例
// publish-render-preserves-content 覆盖——同一批判据（无 <style>/class=、链接与本地图 src
// 原样保留、h2 渲染）在这里免费秒级零抖动地钉住；agent 层只留「选对渲染脚本、把用户
// 正文原样送进去」的编排用例，不再重复这些渲染判据。
import assert from "node:assert/strict";
import { renderWechatHtml } from "./render-wechat-html.mjs";

const md = [
  "这段正文里有个**加粗**词，还有一个链接：[官网](https://example.com/tea)。",
  "",
  "## 选购建议",
  "",
  "- 半糖更好喝",
  "- 记得加珍珠",
  "",
  "![奶茶配图](/tmp/demo-tea.png)",
].join("\n");

const html = renderWechatHtml(md, { title: "秋天的第一杯奶茶" });

// 公众号会剥 <style>/<head>/class 式 CSS——渲染器必须全内联，产出里不许出现这两样
assert.ok(!/<style\b/i.test(html), "产出里出现了 <style>（公众号会剥掉，样式必须内联）");
assert.ok(!/\bclass\s*=/i.test(html), "产出里出现了 class=（公众号剥 class，样式必须内联）");
assert.ok(/<h2\s+style="/.test(html), "h2 没有带内联样式渲染出来");

// 组合边界：链接 href 与图片 src **原样保留**（本地图片的预上传由下游 preprocess 负责）
assert.ok(html.includes("https://example.com/tea"), "链接 href 没有原样保留");
assert.ok(html.includes("/tmp/demo-tea.png"), "本地图片 src 没有原样保留（下游预上传找不到它）");

// 内容不丢：标题、加粗、列表项都在
assert.ok(html.includes("秋天的第一杯奶茶"), "--title 标题没进产出");
assert.ok(/<strong[^>]*>加粗<\/strong>/.test(html), "加粗没有渲染成 <strong>");
assert.ok(html.includes("半糖更好喝") && html.includes("记得加珍珠"), "列表项内容丢了");

// 破坏演练：证明断言不是恒真——渲染器若把 markdown 原样吐回，上面 <h2 与 <strong 就会红。
assert.ok(!html.includes("## 选购建议"), "markdown 标题语法原样漏进了产出");

process.stdout.write("  ✅ render-wechat-html 10/10\n");
