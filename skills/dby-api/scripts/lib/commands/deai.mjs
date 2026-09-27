// deai.mjs — `dby deai scan` / `dby deai baseline`（移植自 skills/dby-deai/scripts/deai.py，design D5）。
//
// 去 AI 味体检：把「一眼 AI」的位置和密度找出来，交给人和模型判断该不该改。纯本地、不联网。
//
// 🔴 不输出 AI 率分数，也不给及格判定（spec「单一运行时」）。检测器把老舍《林海》判 99.9% AI、
//    把美国宪法判「likely entirely by AI」，OpenAI 自家分类器因真阳性率 26% 下架。分数会把注意力
//    从「哪一句该改」引到「数字降没降」。cli/test/deai.test.mjs 钉住输出里没有任何分数类字段。
//
// 移植纪律（逐字段对拍见 cli/scripts/parity/deai-parity.mjs）：
//   · 长度一律按 Unicode 码点算（Python len），不按 UTF-16 码元；
//   · `\s` 换成 Python 的 Unicode 空白类，`\d` 换成 \p{Nd}（Python 3 的 \d 认全角数字）；
//   · round() 照 Python 语义（精确二进制值上的四舍六入五成双），不是 Math.round；
//   · 读文件照 Python 文本模式做换行归一（\r\n、\r → \n）。
// 词表的唯一数据源是 ../data/deai-lexicon.json。

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";

const LEXICON = JSON.parse(readFileSync(new URL("../data/deai-lexicon.json", import.meta.url), "utf8"));

// ── Python 语义的小工具 ─────────────────────────────────────────────────────
// Python str.isspace() 的全集（= re 的 \s）。与 JS \s 的差别：Python 多 \x1c-\x1f、\x85，JS 多 \ufeff。
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS = `[${PY_WS}]`;
const NWS = `[^${PY_WS}]`;
const WS_SET = new Set(
  [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]
    .map((c) => String.fromCharCode(c))
);
for (let c = 0x2000; c <= 0x200a; c++) WS_SET.add(String.fromCharCode(c));

/** Python 的 `\s` → Python 空白类；只替换类外的 `\s`（词表里的 pattern 都是这种）。 */
const pyRe = (source, flags = "gu") => new RegExp(source.replace(/\\s/g, WS), flags);

const cpLen = (s) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};
const cpSlice = (s, n) => {
  let out = "";
  let i = 0;
  for (const ch of s) {
    if (i++ >= n) break;
    out += ch;
  }
  return out;
};

function stripChars(s, chars, { left = true, right = true } = {}) {
  const has = typeof chars === "string" ? (ch) => chars.includes(ch) : (ch) => WS_SET.has(ch);
  const arr = [...s];
  let a = 0;
  let b = arr.length;
  if (left) while (a < b && has(arr[a])) a++;
  if (right) while (b > a && has(arr[b - 1])) b--;
  return arr.slice(a, b).join("");
}
const pyStrip = (s, chars) => stripChars(s, chars ?? null);

/** Python str.splitlines()：认它那一整套行边界，末尾的空行不单独成一项。 */
function pySplitlines(s) {
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

const countOf = (s, needle) => s.split(needle).length - 1; // 与 str.count 同为不重叠计数

/**
 * Python round(x, nd)：在 x 的**精确**二进制值上四舍六入五成双。
 * toFixed(100) 对本脚本出现的量级是精确十进制展开（规范要求按精确值取最近），据此判断是不是真平局。
 */
export function pyRound(x, nd) {
  if (!Number.isFinite(x) || x === 0) return x;
  const neg = x < 0;
  const [intPart, frac] = Math.abs(x).toFixed(100).split(".");
  const keep = frac.slice(0, nd);
  const rest = frac.slice(nd);
  let up;
  if (rest[0] > "5") up = true;
  else if (rest[0] < "5") up = false;
  else if (/[1-9]/.test(rest.slice(1))) up = true;
  else {
    const last = nd > 0 ? keep[nd - 1] : intPart[intPart.length - 1];
    up = Number(last) % 2 === 1;
  }
  let digits = BigInt(intPart + keep);
  if (up) digits += 1n;
  const str = digits.toString().padStart(nd + 1, "0");
  const value = Number(nd > 0 ? `${str.slice(0, -nd)}.${str.slice(-nd)}` : str);
  return neg ? -value : value;
}

/** Python 打印 float 的样子：整数值带 `.0`（human 文本要和原脚本逐字一致）。 */
const pyf = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── 正则（与 deai.py 同名同义）──────────────────────────────────────────────
const ITEM = `[^，。！？；、和与${PY_WS}\\p{Nd}]{2,10}`;
const TRICOLON = new RegExp(`${ITEM}、${ITEM}(?:、|和|与|以及)${ITEM}`, "gu");
const CONDITIONAL_BRIDGE = pyRe("如果说[^，。！？；\\n]{1,30}[，,]\\s*(?:那么|则|就)");
const FAKE_RANGE = pyRe("从[^，。！？；\\n]{1,16}到[^，。！？；\\n]{1,16}[，,]?\\s*(?:无不|都|均|统统|全都)");
const CONTRAST = LEXICON.contrast.map(({ pattern, label }) => [pyRe(pattern), label]);

const SENTENCE = /[^。！？!?；;…\n]+[。！？!?；;…]*/gu;
const CODE_FENCE = /```[\s\S]*?```/gu;
const URL_RE = new RegExp(`https?://${NWS}+`, "gu");
const BOLD = /\*\*[^*\n]+\*\*/gu;
const LIST_LINE = new RegExp(`^${WS}*(?:[-*+]|\\p{Nd}+[.、)])${WS}+`, "u");
const HEADING = new RegExp(`^${WS}*#{1,6}${WS}+`, "u");
const DIGIT = /\p{Nd}/gu;
const PARA_SPLIT = new RegExp(`\\n${WS}*\\n`, "u");
const ALL_WS = new RegExp(`${WS}+`, "gu");
const QUOTE_MARK = /[「」“”《》"]/u;

/** 代码块和 URL 不是文风，扫描前剔掉（URL 里的 % 会把「百分比」凭空撑大）。 */
const stripNoise = (text) => text.replace(CODE_FENCE, "\n").replace(URL_RE, " ");

export function splitSentences(text) {
  return [...text.matchAll(SENTENCE)].map((m) => pyStrip(m[0])).filter(Boolean);
}

export function splitParagraphs(text) {
  return text.split(PARA_SPLIT).map((p) => pyStrip(p)).filter(Boolean);
}

/** 逐句找命中，返回句号 + 片段——报告要能让人直接翻到那一句。 */
function locate(sentences, re) {
  const hits = [];
  sentences.forEach((sentence, i) => {
    for (const m of sentence.matchAll(re)) hits.push({ 句: i + 1, 命中: m[0], 片段: cpSlice(sentence, 60) });
  });
  return hits;
}

function wordHits(sentences, words) {
  const sorted = [...words].sort((a, b) => cpLen(b) - cpLen(a)); // 稳定排序 = Python sorted(reverse=True)
  return locate(sentences, new RegExp(sorted.map(escapeRe).join("|"), "gu"));
}

/** 标题行不是开头，跳过它——否则「# 标题」会把首句挡住。 */
function firstBody(paragraphs) {
  return paragraphs.find((p) => !HEADING.test(p)) ?? "";
}

/** 每段最后一句都在总结本段——单段不算，成片才算。 */
function closerParagraphs(paragraphs) {
  const hits = [];
  paragraphs.forEach((paragraph, i) => {
    if (HEADING.test(paragraph) || cpLen(paragraph) < 30) return;
    const sentences = splitSentences(paragraph);
    if (!sentences.length) return;
    const last = sentences[sentences.length - 1];
    const head = stripChars(last, "*_> ", { right: false });
    if (LEXICON.closer.some((w) => head.startsWith(w))) {
      hits.push({ 段: i + 1, 命中: cpSlice(last, 40), 片段: cpSlice(last, 60) });
    }
  });
  return hits;
}

/** 同一个标题生成器批量产出的小标题：三个以上共享同一个模子。 */
function symmetricHeadings(lines) {
  const titles = lines
    .filter((line) => HEADING.test(line))
    .map((line) => pyStrip(pyStrip(line.replace(HEADING, "")), "*"))
    .filter((x) => cpLen(x) >= 3);
  if (titles.length < 3) return [];
  for (const take of [(s) => cpSlice(s, 2), (s) => [...s].slice(-2).join("")]) {
    const groups = new Map();
    for (const title of titles) {
      const k = take(title);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(title);
    }
    for (const members of groups.values()) if (members.length >= 3) return members;
  }
  return [];
}

/** 空洞候选：够长，却没有一个数字、引语或书名。只是候选，不是判决。 */
function hollowParagraphs(paragraphs) {
  const hits = [];
  paragraphs.forEach((paragraph, i) => {
    const n = cpLen(paragraph);
    if (HEADING.test(paragraph) || LIST_LINE.test(paragraph) || n < 60) return;
    if (/\p{Nd}/u.test(paragraph) || QUOTE_MARK.test(paragraph)) return;
    hits.push({ 段: i + 1, 命中: `${n} 字无数字无引语`, 片段: cpSlice(paragraph, 60) });
  });
  return hits;
}

/** 连续同长句（只看 ≥floor 字的句子——「行吧。」「知道了。」天然一样长，那不是 AI 味）。 */
function evenLengthRuns(sentences, tolerance = 3, floor = 12) {
  let runs = [];
  let current = [];
  sentences.forEach((sentence, i) => {
    const index = i + 1;
    const length = cpLen(sentence);
    if (length < floor) {
      current = [];
      return;
    }
    const lens = current.map((x) => x[1]);
    if (current.length && Math.max(...lens, length) - Math.min(...lens, length) <= tolerance) {
      current.push([index, length]);
    } else {
      current = [[index, length]];
    }
    if (current.length >= 3) {
      const all = current.map((x) => x[1]);
      runs = runs.filter((r) => r.起句 !== current[0][0]);
      runs.push({
        起句: current[0][0], 止句: current[current.length - 1][0],
        句数: current.length, 字数区间: [Math.min(...all), Math.max(...all)]
      });
    }
  });
  return runs;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** statistics.pstdev（整数输入）：方差按精确整数算，最后一步开方。 */
function pstdev(xs) {
  const n = xs.length;
  let s = 0;
  let s2 = 0;
  for (const x of xs) {
    s += x;
    s2 += x * x;
  }
  return Math.sqrt((n * s2 - s * s) / (n * n));
}

/** 体检本体。输出键名与 deai.py --json 逐字段一致（对拍脚本钉住）。**纯函数**。 */
export function scan(text, exempt = new Set()) {
  const body = stripNoise(text);
  const sentences = splitSentences(body);
  const paragraphs = splitParagraphs(body);
  const lines = pySplitlines(body);
  const plain = body.replace(ALL_WS, "");
  const plainLen = cpLen(plain);
  const scale = Math.max(plainLen, 1) / 1000; // 每千字密度的分母

  const lengths = sentences.map(cpLen);
  const contrast = [];
  for (const [re, label] of CONTRAST) {
    for (const hit of locate(sentences, re)) contrast.push({ ...hit, 句式: label });
  }

  const tail = paragraphs.length ? paragraphs[paragraphs.length - 1] : "";
  const first = firstBody(paragraphs);

  const report = {
    字数: plainLen,
    句数: sentences.length,
    段数: paragraphs.length,
    句长: {
      均值: lengths.length ? pyRound(mean(lengths), 1) : 0,
      标准差: lengths.length > 1 ? pyRound(pstdev(lengths), 1) : 0,
      最短: lengths.length ? Math.min(...lengths) : 0,
      最长: lengths.length ? Math.max(...lengths) : 0
    },
    连续同长句: evenLengthRuns(sentences),
    套话连接词: wordHits(sentences, LEXICON.cliche),
    公文腔: wordHits(sentences, LEXICON.jargon),
    通胀大词: wordHits(sentences, LEXICON.inflated),
    否定式对比: contrast,
    三段式并列: locate(sentences, TRICOLON),
    虚假范围: locate(sentences, FAKE_RANGE),
    程式化过渡: [...wordHits(sentences, LEXICON.transition), ...locate(sentences, CONDITIONAL_BRIDGE)],
    每段收束: closerParagraphs(paragraphs),
    对称小标题: symmetricHeadings(lines),
    空洞候选段: hollowParagraphs(paragraphs),
    首段预告: LEXICON.forecast.filter((w) => first.startsWith(w)),
    公式化开头: LEXICON.opening.filter((w) => first.startsWith(w)),
    结尾升华: LEXICON.ending.filter((w) => tail.includes(w)),
    标点: {
      破折号: countOf(body, "——"),
      全角冒号: countOf(body, "：")
    },
    格式: {
      加粗: (body.match(BOLD) ?? []).length,
      清单行: lines.filter((l) => LIST_LINE.test(l)).length,
      小标题: lines.filter((l) => HEADING.test(l)).length,
      总行数: lines.filter((l) => pyStrip(l)).length
    },
    具体度: {
      数字字符: (body.match(DIGIT) ?? []).length,
      第一人称: countOf(body, "我"),
      百分比: countOf(body, "%") + countOf(body, "％")
    }
  };

  if (exempt.size) {
    let dropped = 0;
    for (const key of ["套话连接词", "公文腔", "通胀大词", "程式化过渡"]) {
      const kept = report[key].filter((h) => !exempt.has(h.命中));
      dropped += report[key].length - kept.length;
      report[key] = kept;
    }
    for (const key of ["结尾升华", "首段预告"]) {
      const kept = report[key].filter((w) => !exempt.has(w));
      dropped += report[key].length - kept.length;
      report[key] = kept;
    }
    report.已豁免 = dropped;
  }

  const perK = (n) => pyRound(n / scale, 1);
  report.每千字 = {
    套话连接词: perK(report.套话连接词.length),
    公文腔: perK(report.公文腔.length),
    通胀大词: perK(report.通胀大词.length),
    否定式对比: perK(contrast.length),
    三段式并列: perK(report.三段式并列.length),
    程式化过渡: perK(report.程式化过渡.length),
    破折号: perK(report.标点.破折号),
    数字字符: perK(report.具体度.数字字符)
  };
  return report;
}

export const BASELINE_KEYS = ["套话连接词", "公文腔", "通胀大词", "否定式对比", "三段式并列", "程式化过渡", "破折号"];

/** 把作者的范文压成一条基线：他自己平时就这么写，那就是他的常态（唯一诚实的阈值来源）。**纯函数**。 */
export function makeBaseline(reports) {
  const total = reports.reduce((a, r) => a + r.字数, 0) || 1;
  const perK = {};
  for (const key of BASELINE_KEYS) {
    const weighted = reports.reduce((a, r) => a + r.每千字[key] * r.字数, 0);
    perK[key] = pyRound(weighted / total, 2);
  }
  return {
    样本篇数: reports.length,
    总字数: total,
    每千字: perK,
    句长: {
      均值: pyRound(reports.reduce((a, r) => a + r.句长.均值 * r.字数, 0) / total, 1),
      标准差: pyRound(reports.reduce((a, r) => a + r.句长.标准差 * r.字数, 0) / total, 1)
    }
  };
}

/** 从 deai-偏好.md 的「## 豁免」一节读用户否掉过的词，一行一个 `- 词`。**纯函数**。 */
export function parseExempt(text) {
  // Python 的 ^/$（re.M）只认 \n；JS 的 m 旗还认 \r/\u2028，所以这里手写行首行尾。
  const BOL = "(?:^|(?<=\\n))";
  const EOL = "(?=\\n|(?![\\s\\S]))";
  const section = new RegExp(`${BOL}##+${WS}*豁免[\\s\\S]*?${EOL}([\\s\\S]*?)(?=${BOL}##+${WS}|(?![\\s\\S]))`, "u").exec(text);
  if (!section) return new Set();
  const item = new RegExp(`${BOL}${WS}*[-*]${WS}+([^\\n]+?)${WS}*${EOL}`, "gu");
  return new Set([...section[1].matchAll(item)].map((m) => pyStrip(pyStrip(m[1]), "「」`")));
}

// ── human 文本（与 deai.py 的 render 逐字一致）──────────────────────────────
function renderBaseline(report, baseline) {
  const out = [`### 对照作者基线（${baseline.样本篇数} 篇 / ${baseline.总字数} 字）`];
  let flagged = false;
  for (const key of BASELINE_KEYS) {
    const mine = report.每千字[key];
    const base = baseline.每千字[key];
    if (mine <= Math.max(base * 2, base + 1.0)) continue;
    flagged = true;
    const ratio = base ? `${pyRound(mine / base, 1).toFixed(1)}×` : "基线为 0";
    out.push(`- **${key}** 每千字 ${pyf(mine)}，你平时 ${pyf(base)}（${ratio}）`);
  }
  if (!flagged) out.push("- 各族密度都在你平时的范围内。");
  const bl = baseline.句长;
  out.push(
    `- 句长 均值 ${fmtMean(report, "均值")} / 标准差 ${fmtMean(report, "标准差")}，你平时 ${pyf(bl.均值)} / ${pyf(bl.标准差)}` +
      "（标准差明显低于平时 = 节奏被抹平了）"
  );
  out.push("");
  return out.join("\n");
}

/** 句长均值/标准差在 Python 里有时是 int 0（没有句子 / 只有一句），有时是 float。 */
function fmtMean(report, key) {
  const isFloat = key === "均值" ? report.句数 > 0 : report.句数 > 1;
  const v = report.句长[key];
  return isFloat ? pyf(v) : String(v);
}

export function render(report, baseline = null) {
  const out = [];
  const add = (s) => out.push(s);
  add(`## 体检：${report.字数} 字 / ${report.句数} 句 / ${report.段数} 段`);
  const length = report.句长;
  add(
    `句长 均值 ${fmtMean(report, "均值")} · 标准差 ${fmtMean(report, "标准差")} · 区间 ${length.最短}–${length.最长}` +
      "（无中文实证阈值，改写前后对照着看）"
  );
  add("");
  if (baseline) add(renderBaseline(report, baseline));

  const section = (title, hits, perK = null, limit = 8) => {
    if (!hits.length) return;
    let head = `### ${title}：${hits.length} 处`;
    if (perK !== null) head += `（每千字 ${pyf(perK)}）`;
    add(head);
    for (const hit of hits.slice(0, limit)) {
      if (hit && typeof hit === "object" && "句" in hit) add(`- 第 ${hit.句} 句 · 「${hit.句式 || hit.命中}」 · ${hit.片段}`);
      else add(`- ${pyDictRepr(hit)}`);
    }
    if (hits.length > limit) add(`- …另有 ${hits.length - limit} 处`);
    add("");
  };

  const per = report.每千字;
  section("套话连接词", report.套话连接词, per.套话连接词);
  section("公文腔", report.公文腔, per.公文腔);
  section("通胀大词", report.通胀大词, per.通胀大词);
  section("否定式对比句", report.否定式对比, per.否定式对比);
  section("三段式并列", report.三段式并列, per.三段式并列);
  section("虚假范围", report.虚假范围);
  section("程式化过渡句", report.程式化过渡, per.程式化过渡);
  section("每段都在收束", report.每段收束);
  section("空洞候选段（够长但没有数字与引语，要不要补事实由你判断）", report.空洞候选段);
  if (report.对称小标题.length) {
    add(`### 对称小标题：${report.对称小标题.length} 个共享同一个模子`);
    for (const title of report.对称小标题.slice(0, 6)) add(`- ${title}`);
    add("");
  }

  const runs = report.连续同长句;
  if (runs.length) {
    add(`### 连续同长句：${runs.length} 段`);
    for (const run of runs.slice(0, 6)) {
      add(`- 第 ${run.起句}–${run.止句} 句连着 ${run.句数} 句都是 ${run.字数区间[0]}–${run.字数区间[1]} 字`);
    }
    add("");
  }

  if (report.已豁免) add(`（已按 deai-偏好.md 豁免 ${report.已豁免} 处）\n`);
  if (report.首段预告.length) add(`### 首段预告全文：以「${report.首段预告[0]}」起句\n`);
  if (report.公式化开头.length) add(`### 公式化开头：首段以「${report.公式化开头[0]}」起句\n`);
  if (report.结尾升华.length) add(`### 结尾升华：末段命中 ${report.结尾升华.join("、")}\n`);

  const punct = report.标点;
  const fmt = report.格式;
  const solid = report.具体度;
  add(`### 标点与格式\n- 破折号 ${punct.破折号}（每千字 ${pyf(per.破折号)}）· 全角冒号 ${punct.全角冒号}`);
  add(`- 加粗 ${fmt.加粗} · 清单行 ${fmt.清单行}/${fmt.总行数} · 小标题 ${fmt.小标题}`);
  add(`### 具体度\n- 数字字符 ${solid.数字字符}（每千字 ${pyf(per.数字字符)}）· 百分比 ${solid.百分比} · 「我」${solid.第一人称} 次`);
  add("");
  add("以上是位置和密度，不是判决。逐条对 `references/病灶清单.md` 的豁免例过一遍再决定改不改；本脚本不给 AI 率分数。");
  return out.join("\n");
}

/** 「每段收束」「空洞候选段」的条目是带「段」键的 dict，Python 直接 f"- {hit}" 打出 repr。 */
function pyStrRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u.test(ch) || (/\p{Zs}/u.test(ch) && ch !== " ")) {
      if (cp < 0x100) out += `\\x${cp.toString(16).padStart(2, "0")}`;
      else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, "0")}`;
      else out += `\\U${cp.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + quote;
}

function pyDictRepr(v) {
  if (typeof v === "string") return pyStrRepr(v);
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(pyDictRepr).join(", ")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${pyDictRepr(k)}: ${pyDictRepr(x)}`).join(", ")}}`;
  return String(v);
}

// ── 输入 ────────────────────────────────────────────────────────────────────
/** 照 Python 文本模式读：UTF-8、换行归一。`-` 读 stdin。 */
export function readText(file) {
  let raw;
  try {
    raw = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  } catch (e) {
    throw new DbyError("FILE_UNREADABLE", `读不到文件 ${file}：${e.code ?? e.message}`, { exit: EXIT.USAGE });
  }
  return raw.replace(/\r\n?/g, "\n");
}

/** 基线文件：接受 `dby deai baseline --out` 写的裸基线，也接受整份 `--json` 信封（顺手剥掉）。 */
function loadBaseline(file) {
  let obj;
  try {
    obj = JSON.parse(readText(file));
  } catch (e) {
    if (e instanceof DbyError) throw e;
    throw new DbyError("BASELINE_INVALID", `基线文件不是合法 JSON：${file}`, { exit: EXIT.USAGE });
  }
  if (obj && obj.ok === true && obj.data) obj = obj.data.baseline ?? obj.data;
  if (!obj || typeof obj !== "object" || !obj.每千字 || !obj.句长) {
    throw new DbyError("BASELINE_INVALID", `基线文件缺「每千字」或「句长」：${file}`, {
      exit: EXIT.USAGE,
      remediation: "用 `dby deai baseline 范文1.md 范文2.md --out 基线.json` 重新生成。"
    });
  }
  return obj;
}

export function deaiScan({ file, baseline, profile } = {}) {
  if (!file) {
    throw new DbyError("USAGE", "缺少 --file（稿件路径；给 - 从 stdin 读）。", { exit: EXIT.USAGE });
  }
  const exempt = profile ? parseExempt(readText(profile)) : new Set();
  const report = scan(readText(file), exempt);
  const base = baseline ? loadBaseline(baseline) : null;
  if (base) report.基线 = base; // 与 deai.py --json 同形：基线原样挂上，对照判断交给读的人
  return { data: report, human: render(report, base) };
}

export function deaiBaseline(files, { out } = {}) {
  if (!files?.length) throw new DbyError("USAGE", "至少给一篇范文。", { exit: EXIT.USAGE });
  const baseline = makeBaseline(files.map((f) => scan(readText(f))));
  let outPath = null;
  if (out) {
    outPath = path.resolve(out);
    writeFileSync(outPath, JSON.stringify(baseline, null, 2) + "\n");
  }
  const human = outPath
    ? `基线已写入 ${outPath}（${baseline.样本篇数} 篇 / ${baseline.总字数} 字）。之后 \`dby deai scan --file 稿件.md --baseline ${outPath}\`。`
    : JSON.stringify(baseline, null, 2);
  return { data: { baseline, out: outPath }, human };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "deai", name: "scan",
    summary: "去 AI 味体检：命中位置与每千字密度（纯本地；不给 AI 率分数、不给及格判定）",
    args: [],
    flags: {
      file: { value: true, summary: "稿件路径（必填；- 从 stdin 读）" },
      baseline: { value: true, summary: "作者基线 JSON（dby deai baseline 产出），拿作者自己的常态当尺子" },
      profile: { value: true, summary: "deai-偏好.md：读「## 豁免」一节，跳过用户否掉过的词" }
    },
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { flags }) => deaiScan({ file: flags.file, baseline: flags.baseline, profile: flags.profile })
  },
  {
    group: "deai", name: "baseline",
    summary: "把作者范文压成他自己的基线（纯本地）；--out 落成文件给 scan --baseline 用",
    args: [{ name: "files", required: true, variadic: true }],
    flags: {
      out: { value: true, summary: "基线写到这个文件（裸基线 JSON）" }
    },
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { args, flags }) => deaiBaseline(args.files, { out: flags.out })
  }
];
