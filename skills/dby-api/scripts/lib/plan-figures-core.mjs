// plan-figures-core.mjs — 公众号配图「自动布局」规划器（确定性规则，零依赖、不接 LLM）。
// 自 skills/dby-image/scripts/plan-figures.mjs 原样搬入（dby-cli-rebuild design D4 → `dby image plan`，
// kind=local）；规则说明见原文件头注释，函数体一字未改。只出方案，不改文件。

const DEFAULT_MIN_CHARS = 160;
const FIRST_SENTENCE_MAX = 40;

// h2 判定与取文本（与 dby-publish 流水线的 h2 语义一致：ATX 二级标题，容忍行尾 #）
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
