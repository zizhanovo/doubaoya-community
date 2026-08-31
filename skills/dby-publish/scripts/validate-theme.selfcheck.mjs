#!/usr/bin/env node
// validate-theme.selfcheck.mjs —— validate-theme.mjs 的可运行自检（零框架 assert）。
// 跑法：node scripts/validate-theme.selfcheck.mjs   （exit 0 = 全绿）
//
// 为什么存在（design.md D10，2026-08-31）：主题安全校验是**确定性行为**，此前却由
// 执行层的 agent 用例覆盖（publish-theme-unsafe-flagged / publish-theme-valid-passes）——
// 拿 3 轮沙箱 agent 会话测一个纯函数，贵且抖。下沉到脚本层后，agent 层不再重复。
import assert from "node:assert/strict";
import { validateTheme } from "./validate-theme.mjs";

const VALID = {
  palette: { accent: "#2f9e44", text: "#333333", heading: "#222222" },
  elements: {
    h1: { style: "color:{{heading}};font-weight:700;" },
    h2: { style: "color:{{accent}};border-left:4px solid {{accent}};padding-left:8px;" },
  },
};
const r0 = validateTheme(VALID);
assert.equal(r0.errors.length, 0, `合规主题不应报错：${r0.errors}`);

// 每一类不安全模式都必须被硬拦（error，不是 warning）。逐条来自 validate-theme.mjs 的
// UNSAFE_PATTERNS——公众号会剥掉或静默毁版的那几类。
const unsafeComponents = [
  ['<div onclick="doSomething()">点</div>', /onX=|inline event/i],       // 内联事件
  ["<script>alert(1)</script>", /<script>/i],                             // 脚本注入
  ['<style>.x{color:red}</style>', /<style>/i],                           // style 块
  ['<div class="promo">点</div>', /class=/i],                             // class 依赖
  ['<img src="https://x/y.png">', /src=/i],                               // 图片 src 注入
  ['<a href="javascript:alert(1)">点</a>', /javascript:/i],               // javascript: URI
  ['<div style="--px:#cc0000;color:#111">点</div>', /custom property/i],  // CSS 变量声明
  ['<div style="background:url(data:image/png;base64,AAAA)">点</div>', /data:/i], // url(data:)
];
for (const [snippet, expectRe] of unsafeComponents) {
  const theme = { ...VALID, components: { promo: snippet } };
  const { errors } = validateTheme(theme);
  assert.ok(errors.length >= 1, `不安全片段未被拦截：${snippet}`);
  assert.ok(errors.some((e) => expectRe.test(e)),
    `报错没点名模式（${expectRe}）：${errors.join(" | ")}`);
}

// 破坏演练：证明断言不是恒真——合规主题若也被拦，上面第一条就会红。
process.stdout.write(`  ✅ validate-theme ${1 + unsafeComponents.length}/${1 + unsafeComponents.length}\n`);
