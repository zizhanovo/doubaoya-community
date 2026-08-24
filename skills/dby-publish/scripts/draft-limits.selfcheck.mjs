#!/usr/bin/env node
// draft-limits.selfcheck.mjs —— lib/draft-limits.mjs 的可运行自检（零框架 assert）。
// 跑法：node scripts/draft-limits.selfcheck.mjs   （exit 0 = 全绿）
import assert from "node:assert/strict";
import { checkDraftLimits, LIMITS } from "./lib/draft-limits.mjs";

const r0 = checkDraftLimits({ title: "正常标题", digest: "一句话摘要", contentHtml: "<p>hi</p>" });
assert.deepEqual(r0, { errors: [], warnings: [] });

const t33 = "字".repeat(33);
const r1 = checkDraftLimits({ title: t33 });
assert.equal(r1.errors.length, 0);
assert.equal(r1.warnings.length, 1, "33 字标题只警告");

const r2 = checkDraftLimits({ title: "字".repeat(65) });
assert.equal(r2.errors.length, 1, "65 字标题硬错");

// emoji 算 1 个 code point，不按 UTF-16 单元算
const r3 = checkDraftLimits({ title: "😀".repeat(32) });
assert.deepEqual(r3, { errors: [], warnings: [] });

const r4 = checkDraftLimits({ digest: "摘".repeat(121) });
assert.equal(r4.errors.length, 1, "121 字摘要硬错");
assert.equal(checkDraftLimits({ digest: "摘".repeat(120) }).errors.length, 0);

const r5 = checkDraftLimits({ contentHtml: "x".repeat(LIMITS.CONTENT_CHARS) });
assert.equal(r5.errors.length, 1, "2 万字符正文硬错");

const r6 = checkDraftLimits({ contentHtml: "字".repeat(19999) }); // 19999 字符但 ~58KB
assert.equal(r6.errors.length, 0);

const r7 = checkDraftLimits({});
assert.deepEqual(r7, { errors: [], warnings: [] });

process.stdout.write("  ✅ draft-limits 7/7\n");
