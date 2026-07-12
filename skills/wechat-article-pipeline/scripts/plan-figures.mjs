#!/usr/bin/env node
// plan-figures.mjs — 都爆鸭 · 公众号配图「自动布局」规划器（确定性规则，零依赖、不接 LLM）
// -----------------------------------------------------------------------------
// 输入一篇 Markdown，**用确定性规则**决定「在哪些 h2 小节末尾配图」+「每张画面建议」。
// 取代旧的「逐 h2 让用户手选锚点」——用户不再手动分段。工作台点「自动配图」调它出方案，
// 再逐个用 IP 参考图生成、自动摆好。产出的锚点结构与 pipeline.mjs 的 afterHeading 注入
// 完全对齐（design-config.images[].anchor），**无需改动发布链路**。
//
// 规则（全部确定性、可复现）：
//   1. 把正文按 h2（##）切成小节；小节前的引言不配图（没有 h2 锚点）。
//   2. 统计每个小节的「正文有效字数」：剥掉标题/代码块/图片/HTML/列表与引用前缀/链接语法后
//      的可见字符数（中文按字计）。
//   3. 有效字数 ≥ minChars（默认 160）的小节才「有资格」配图。
//   4. 张数上限 maxFigures：未显式指定时按总正文字数分档——<1800→3、1800–3000→4、>3000→5
//      （与 SKILL.md 的配图密度一致）。
//   5. 有资格的小节数超过上限时，取「有效字数最大」的前 maxFigures 个，再按**文档顺序**还原，
//      让配图大致均匀铺开、优先落在信息量大的小节。
//   6. 每张画面建议由「小节标题 + 首句精简」拼成（不接 LLM，纯字符串规则）。
//
// 用法（CLI，打印方案，便于验证）：
//   node plan-figures.mjs --md <文章.md> [--max-figures N] [--min-chars N] [--json]
//
// 用法（import）：
//   import { planFigures } from "./plan-figures.mjs";
//   const { figures, meta } = planFigures(markdown, { maxFigures, minChars });
//   // figures[i] = { anchor:{type:"afterHeading", value}, prompt, chars, firstSentence }
// -----------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_MIN_CHARS = 160;
const FIRST_SENTENCE_MAX = 40;

// h2 判定与取文本（与 pipeline.injectImagesAfterHeadings 的 h2Text 对齐）
function h2Text(line) {
  const m = line.match(/^ {0,3}##(?!#)\s+(.+?)\s*#*\s*$/);
  return m ? m[1].trim() : null;
}
function isH1or2(line) {
  return /^ {0,3}#{1,2}(?!#)\s+/.test(line);
}

// 一行正文 → 可见文本（剥常见 Markdown 语法），用于计数与取首句
function lineToVisibleText(raw) {
  let s = raw;
  // 去列表/引用/待办前缀
  s = s.replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+|>\s?)+/, "");
  // 图片 ![alt](url) → 丢弃（配图不算正文）
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // 链接 [text](url) → 保留 text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // 行内代码 `code` → 保留内容
  s = s.replace(/`([^`]*)`/g, "$1");
  // 强调/加粗/删除线标记
  s = s.replace(/[*_~]{1,3}/g, "");
  // 裸 HTML 标签
  s = s.replace(/<[^>]+>/g, "");
  return s.trim();
}

// 把一个小节的正文行数组 → { chars, firstSentence }
function summarizeBody(bodyLines) {
  let inFence = false;
  let chars = 0;
  let firstSentence = "";
  const visibleParts = [];
  for (const raw of bodyLines) {
    const t = raw.trim();
    if (/^(```|~~~)/.test(t)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isH1or2(raw)) continue; // 保险：不把子标题算进来（h3+ 也不算正文字）
    if (/^ {0,3}#{3,6}\s+/.test(raw)) continue; // h3-h6 标题不计字
    const vis = lineToVisibleText(raw);
    if (!vis) continue;
    // 计可见字符（去内部空白，中文/英文都按字符数）
    chars += vis.replace(/\s+/g, "").length;
    visibleParts.push(vis);
  }
  const joined = visibleParts.join(" ");
  if (joined) {
    const m = joined.match(/^(.+?[。！？!?.])/);
    let fs = (m ? m[1] : joined).trim();
    if (fs.length > FIRST_SENTENCE_MAX) fs = fs.slice(0, FIRST_SENTENCE_MAX).trim() + "…";
    firstSentence = fs;
  }
  return { chars, firstSentence };
}

// 按总字数分档给默认张数上限（与 SKILL.md 配图密度一致）
function defaultMaxFigures(totalChars) {
  if (totalChars < 1800) return 3;
  if (totalChars <= 3000) return 4;
  return 5;
}

// 画面建议（确定性拼接，不接 LLM）
function buildFigurePrompt(title, firstSentence) {
  const base = `示意配图：${title}`;
  return firstSentence ? `${base}——${firstSentence}` : base;
}

/**
 * 规划配图布局。
 * @param {string} markdown
 * @param {object} [opts]
 * @param {number} [opts.maxFigures] 张数上限；缺省按总字数分档
 * @param {number} [opts.minChars]   小节最少有效字数才配图（默认 160）
 * @returns {{ figures: Array, meta: object }}
 */
export function planFigures(markdown, opts = {}) {
  const minChars = Number.isFinite(opts.minChars) ? opts.minChars : DEFAULT_MIN_CHARS;
  const lines = String(markdown == null ? "" : markdown).replace(/\r\n?/g, "\n").split("\n");

  // 切小节：只收 h2 小节（首个 h2 之前的引言不配图）
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const h2 = h2Text(line);
    if (h2 != null) {
      cur = { title: h2, body: [] };
      sections.push(cur);
      continue;
    }
    if (isH1or2(line)) {
      // 撞到 h1：结束当前小节的归属（h1 内容不计入某个 h2）
      cur = null;
      continue;
    }
    if (cur) cur.body.push(line);
  }

  const analyzed = sections.map((s, idx) => {
    const { chars, firstSentence } = summarizeBody(s.body);
    return { order: idx, title: s.title, chars, firstSentence };
  });

  const totalBodyChars = analyzed.reduce((a, s) => a + s.chars, 0);
  const maxFigures = Number.isFinite(opts.maxFigures) ? opts.maxFigures : defaultMaxFigures(totalBodyChars);

  const eligible = analyzed.filter((s) => s.chars >= minChars);
  // 超上限：按字数降序取前 N，再按文档顺序还原
  const chosen = eligible
    .slice()
    .sort((a, b) => b.chars - a.chars || a.order - b.order)
    .slice(0, Math.max(0, maxFigures))
    .sort((a, b) => a.order - b.order);

  const figures = chosen.map((s) => ({
    anchor: { type: "afterHeading", value: s.title },
    prompt: buildFigurePrompt(s.title, s.firstSentence),
    chars: s.chars,
    firstSentence: s.firstSentence,
  }));

  return {
    figures,
    meta: {
      totalBodyChars,
      sectionCount: analyzed.length,
      eligibleCount: eligible.length,
      maxFigures,
      minChars,
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  const BOOL = new Set(["json", "help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") {
      out.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    let key = a.slice(2);
    let val;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (BOOL.has(key)) {
      out[camel(key)] = true;
      continue;
    }
    if (val === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`参数 --${key} 缺少取值。`);
      val = next;
      i++;
    }
    out[camel(key)] = val;
  }
  return out;
}
function camel(flag) {
  return flag.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

const HELP = `plan-figures.mjs — 都爆鸭 · 配图自动布局规划器（确定性规则，不接 LLM）

用法:
  node plan-figures.mjs --md <文章.md> [--max-figures N] [--min-chars N] [--json]

选项:
  --md <file>        文章 Markdown 源（必填）
  --max-figures <N>  张数上限（缺省按总字数分档：<1800→3、1800–3000→4、>3000→5）
  --min-chars <N>    小节最少有效字数才配图（默认 160）
  --json             以 JSON 打印完整方案
  -h, --help         显示帮助
`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`\n❌ ${e.message}\n\n${HELP}`);
    process.exit(1);
  }
  if (args.help || !args.md) {
    process.stdout.write(HELP);
    return;
  }
  const mdPath = path.resolve(args.md);
  let markdown;
  try {
    markdown = await readFile(mdPath, "utf8");
  } catch (e) {
    process.stderr.write(`\n❌ 读不到 Markdown: ${mdPath}\n`);
    process.exit(1);
  }
  const opts = {};
  if (args.maxFigures != null) opts.maxFigures = Number(args.maxFigures);
  if (args.minChars != null) opts.minChars = Number(args.minChars);
  const plan = planFigures(markdown, opts);

  if (args.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    return;
  }
  const { figures, meta } = plan;
  process.stdout.write(
    `\n🦆 配图自动布局方案 — ${path.basename(mdPath)}\n` +
      `   小节数 ${meta.sectionCount} · 正文总字数 ${meta.totalBodyChars} · ` +
      `有资格 ${meta.eligibleCount} · 上限 ${meta.maxFigures} · 阈值 ${meta.minChars} 字\n\n`
  );
  if (!figures.length) {
    process.stdout.write("   （没有达到阈值的小节，本文不自动配图。）\n\n");
    return;
  }
  figures.forEach((f, i) => {
    process.stdout.write(
      `   ${i + 1}. [h2 末尾] 《${f.anchor.value}》（${f.chars} 字）\n` +
        `      画面：${f.prompt}\n`
    );
  });
  process.stdout.write("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => {
    process.stderr.write(`\n❌ ${e && e.stack ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
