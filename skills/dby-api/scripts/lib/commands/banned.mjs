// banned.mjs — `dby banned check`（替代 skills/dby-banned-words/scripts/check_multi.py，见该文件）。
//
// ponytail：spec「路由与子命令一一对应」要求一条子命令打一条路径，这里是明确例外——
//   多平台扇出如果拆成「一平台一条子命令」，agent 得自己写循环逐个调用，平台漏调不会报错
//   （对比：check_multi.py 本就是把三次独立调用收进一次脚本执行，为的是别漏平台）。
//   design D5 把它与 write prep 等并列钉进冻结名单，不再新增同类组合命令。
//
// 🔴 每个平台各是一次独立计费调用（非批量接口），所以 billable:true、composite:true；
//   routes 只列这一条真正会计费的路径——价格现拉走的 GET /api/apis/:platform/:slug 已经在
//   `api describe` 里登记过（同 doctor.mjs 的道理：复用别的命令已登记的路由，不重复计入对账闸）。

import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { billable } from "../confirm.mjs";
import { priceLabel } from "../capability.mjs";

const CALL_PATH = "/api/apis/tool/check-banned-words/call";
const DESCRIBE_PATH = "/api/apis/tool/check-banned-words";
const DEFAULT_PLATFORMS = ["xiaohongshu", "douyin", "gongzhonghao"];
// raw 里与顶层重复的两键；只剥这两个，其余（上游状态码等）原样保留。
const DUP_KEYS = ["content", "originalContent"];

/**
 * 上游（cozeSkill/sensitiveWordSearch）单次 `content` 的硬上限。
 *
 * 生产实证（主仓 InvocationLog，2026-09-15~18 共 15 次 PROVIDER_BUSINESS_ERROR）：上游原文
 * 「body.content 参数长度超过限制（7320字符），最大允许2000字符」。一整篇公众号文章按老用法
 * 一次发过去必然失败，而在这之前调用方只能从错误里才知道有这个数。
 *
 * 🔴 这个数与主仓 `packages/schemas` 的 CONTENT_SAFETY_MAX_CHARS 是**同一个契约的两半**：
 *    服务端拿它在扣点前 400，这里拿它切段。任何一半单独改动，长文就重新变回
 *    「扣了点、打上游、再退点」那条路。改这里必须同时看那边的注释与测试。
 * 上游按 Java String.length 计，与 JS `.length`（UTF-16 码元）同口径，所以直接比 `.length`。
 */
export const CONTENT_MAX_CHARS = 2000;

/** 句末标点：优先在句子结束处切，跨段的违禁词因此几乎不可能被切断。 */
const SENTENCE_END = new Set(["。", "！", "？", "；", "!", "?", ";"]);

/** 一个 UTF-16 码元是不是「低位代理」——落在这里就等于要把一个字符劈成两半。 */
function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 一段仍然超长的文本硬切（没有段落、也没有句末标点时的最后一档）。 */
function hardSplit(piece, max) {
  const parts = [];
  for (let i = 0; i < piece.length; ) {
    let end = Math.min(i + max, piece.length);
    // 边界正落在代理对中间（emoji 等）就退一格：宁可这一段短一个字，也不切碎字符。
    // max < 2 时退无可退，直接切（正常路径到不了——max 是 2000）。
    if (end < piece.length && isLowSurrogate(piece.charCodeAt(end))) end -= 1;
    if (end <= i) end = i + 1;
    parts.push(piece.slice(i, end));
    i = end;
  }
  return parts;
}

/** 按「原子」切：先段落（保留换行符），超长段落再按句末标点，仍超长的才硬切。 */
function atomsOf(content, max) {
  const paragraphs = [];
  let start = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") {
      paragraphs.push(content.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < content.length) paragraphs.push(content.slice(start));

  const pieces = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= max) {
      pieces.push(paragraph);
      continue;
    }
    let sentenceStart = 0;
    for (let i = 0; i < paragraph.length; i += 1) {
      if (SENTENCE_END.has(paragraph[i])) {
        pieces.push(paragraph.slice(sentenceStart, i + 1));
        sentenceStart = i + 1;
      }
    }
    if (sentenceStart < paragraph.length) pieces.push(paragraph.slice(sentenceStart));
  }
  return pieces;
}

/**
 * 把文案切成每段 ≤ max 的片段。**无损**：`chunks.join("") === content`（测试钉住）。
 *
 * 优先级是刻意的：段落 → 句末标点 → 硬切。前两档保证切点落在语义边界上，于是
 * 「一个违禁词被切成两半」只剩最后一档才可能发生（一整段没有任何标点、又超过 2000 字）。
 * 🔴 刻意**不**做重叠窗口：重叠会让同一个命中在相邻两段各报一次（用户拿到重复条目），
 *    段数还照翻倍计费。用语义边界换掉漏检，比用重叠窗口更便宜也更干净。
 */
export function chunkContent(content, max = CONTENT_MAX_CHARS) {
  if (!Number.isInteger(max) || max < 1) {
    throw new DbyError("USAGE", `max 必须是正整数：${max}`, { exit: EXIT.USAGE });
  }
  if (content.length <= max) return [content];

  const chunks = [];
  let current = "";
  for (const piece of atomsOf(content, max)) {
    for (const part of piece.length <= max ? [piece] : hardSplit(piece, max)) {
      if (current && current.length + part.length > max) {
        chunks.push(current);
        current = "";
      }
      current += part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 上游「成功但什么都没给」——`content` 与 `originalContent` 都为 null / 空串。
 *
 * 生产实证（2026-09-08 与 2026-09-20 各一笔，累计约 600 次调用里 2 次）：上游回成功信封，
 * data 却是 `{content: null, originalContent: null, prohibitedWordsType: []}`。它**不是**
 * 「零命中」——零命中的形状是拿到了正文、且与原文相等（见 SKILL.md 的判据）——所以这里必须
 * 当成「这一段没查」，否则一篇文案会以「未命中」的形式被读成合规。
 */
function isEmptyResult(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return true;
  return !data.content && !data.originalContent;
}

/**
 * 剥掉 data.raw 里与顶层重复的 content / originalContent，其余键原样保留（--raw 保留原样）。
 * 逐字移植自 check_multi.py 的 slim：raw 不是对象（缺失/null/字符串）时原样返回，不改入参。**纯函数**。
 */
export function slim(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const raw = data.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return data;
  return { ...data, raw: Object.fromEntries(Object.entries(raw).filter(([k]) => !DUP_KEYS.includes(k))) };
}

/**
 * 同一平台多段结果的合并（段数 ≥ 2 才走这里）。**纯函数**。
 *
 * 三条口径，别的都别加：
 *  ① 有段失败就**一定**带 `error`，哪怕别的段查出了命中 —— 「漏检的那一段」必须比「查到的
 *     命中」更显眼，否则一篇只扫了一半的文章会被读成合规。
 *  ② 段不全时 `content` / `originalContent` 一律 null：拼接会把失败那一段的正文悄悄接掉，
 *     而这两个字段正是用户「定位哪几个词命中」的唯一依据。宁可说「这次拿不到完整标注版」。
 *  ③ `prohibitedWordsType` 取并集、按首次出现排序去重；`segments[]` 保留每段自己的类别与
 *     错误，用户才知道命中落在第几段。
 */
export function mergeSegmentResults(segments, { keepRaw = false } = {}) {
  const failed = segments.filter((segment) => segment.error);
  const checked = segments.filter((segment) => !segment.error);

  const types = [];
  for (const segment of checked) {
    for (const type of segment.data?.prohibitedWordsType ?? []) {
      if (!types.includes(type)) types.push(type);
    }
  }
  const joined = (field) => checked.map((segment) => segment.data?.[field] ?? null).join("");

  const merged = {
    source: "contentSafety.sensitiveWords",
    content: failed.length ? null : joined("content"),
    originalContent: failed.length ? null : joined("originalContent"),
    prohibitedWordsType: types,
    segmentCount: segments.length,
    segments: segments.map((segment) => ({
      index: segment.index,
      chars: segment.chars,
      prohibitedWordsType: segment.data?.prohibitedWordsType ?? [],
      ...(segment.error ? { error: segment.error } : {})
    }))
  };
  if (keepRaw) {
    merged.raw = { segmentCount: segments.length, segments: segments.map((s) => ({ index: s.index, raw: s.data?.raw ?? null })) };
  }
  if (failed.length) {
    // 「没拿到结果」与「拿到了、没命中」必须分得开（SKILL.md 的红线）。
    merged.error = {
      code: "BANNED_SEGMENT_FAILED",
      message: `第 ${failed.map((s) => s.index).join("、")} 段没拿到结果，本次只覆盖 ${checked.length}/${segments.length} 段，不能据此判定这篇文案合规；先原样重试一次。`
    };
  }
  return merged;
}

/**
 * 确认态的计费清单：**平台 × 段数，一次调用一条**。
 * 用户要核的不是「几个平台」而是「会发生几次计费」——长文被自动分段只列一条，
 * 就等于把真实的调用次数藏起来。
 */
function billingChanges(platforms, chunks, price) {
  const multi = chunks.length > 1;
  return platforms.flatMap((platform) =>
    chunks.map((text, index) => ({
      action: "check-banned-words",
      ref: multi ? `tool/check-banned-words@${platform}#${index + 1}` : `tool/check-banned-words@${platform}`,
      title: multi
        ? `违禁词检测 · ${platform}（第 ${index + 1}/${chunks.length} 段，${text.length} 字）`
        : `违禁词检测 · ${platform}`,
      price,
      method: "POST",
      path: CALL_PATH
    }))
  );
}

/** 单平台一行 human 摘要：命中的违禁词类型，或失败原因（含「几段没跑成」）。 */
function resultLine(platform, result) {
  const segments = result?.segmentCount > 1 ? `（${result.segmentCount} 段）` : "";
  const types = Array.isArray(result?.prohibitedWordsType) ? result.prohibitedWordsType : [];
  if (result?.error) {
    const found = types.length ? `；已检出的部分命中：${types.join("、")}` : "";
    return `${platform.padEnd(14)} 失败：[${result.error.code}] ${result.error.message}${segments}${found}`;
  }
  return `${platform.padEnd(14)} ${types.length ? types.join("、") : "未命中"}${segments}`;
}

export async function bannedCheck(ctx, textParts, { platforms, raw } = {}) {
  const content = (textParts ?? []).join(" ").trim();
  if (!content) throw new DbyError("USAGE", "缺少待检测文案。", { exit: EXIT.USAGE });
  const list = (platforms ? platforms.split(",") : DEFAULT_PLATFORMS).map((p) => p.trim()).filter(Boolean);
  if (!list.length) throw new DbyError("USAGE", "--platforms 给出的平台列表是空的。", { exit: EXIT.USAGE });

  // 分段在**确认之前**算好：用户要核的是「会打几次、花几次钱」，而段数直接决定这个数。
  // 纯函数 + 同一份入参 ⇒ 回执那一趟与 --confirm 那一趟算出的段数必然一致。
  const chunks = chunkContent(content);

  // 不带 --confirm 时只做这一步现拉价格的只读请求，不打任何计费路径（退出码 6 前零计费请求）。
  let price = "?";
  if (!ctx.confirm) {
    const capability = await request(ctx, "GET", DESCRIBE_PATH, { auth: "optional", notFoundNull: true, soft: true });
    if (capability && !capability.__soft) price = priceLabel(capability);
    billable(ctx, billingChanges(list, chunks, price));
  }

  // 逐平台逐段各打一次；单个平台 / 单段失败不影响其余（与旧脚本一致）。
  const results = {};
  let anyError = false;
  for (const platform of list) {
    const segments = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const text = chunks[index];
      try {
        const data = await request(ctx, "POST", CALL_PATH, { body: { platform, content: text }, billable: true });
        const shaped = raw ? data : slim(data);
        if (isEmptyResult(shaped)) {
          // 成功但没正文 ≠ 零命中：记成没查（不是 error 形状的调用失败，但结论同样拿不到）。
          anyError = true;
          segments.push({
            index: index + 1,
            chars: text.length,
            error: {
              code: "UPSTREAM_EMPTY",
              message: "上游这次回了成功但正文为空，既不是命中也不是未命中，这一段等于没检测；原样重试一次通常就有。"
            }
          });
          continue;
        }
        segments.push({ index: index + 1, chars: text.length, data: shaped });
      } catch (e) {
        anyError = true;
        segments.push({
          index: index + 1,
          chars: text.length,
          error: { code: e.code ?? "ERROR", message: e.message }
        });
      }
    }
    // 只有一段时走原样（结果形状与分段之前逐字相同），多段才切到合并形状。
    results[platform] =
      segments.length === 1
        ? (segments[0].error ? { error: segments[0].error } : segments[0].data)
        : mergeSegmentResults(segments, { keepRaw: raw });
  }

  const human = list.map((p) => resultLine(p, results[p])).join("\n");
  if (anyError) {
    const err = new DbyError("BANNED_CHECK_PARTIAL", "部分平台或段落检测失败，见逐平台结果。", { exit: EXIT.BUSINESS });
    err.data = results; // 失败信封仍带出逐平台的完整结果，别把已经拿到的结果丢了
    err.human = human;
    throw err;
  }
  return { data: results, human };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "banned", name: "check",
    summary: "多平台违禁词检测（逐平台各计费一次；--platforms 逗号分隔，默认 xiaohongshu,douyin,gongzhonghao）",
    args: [{ name: "text", required: true, variadic: true }],
    flags: {
      platforms: { value: true, summary: "逗号分隔的平台列表" },
      raw: { summary: "保留 raw 里与顶层重复的 content/originalContent（默认剥掉）" }
    },
    // 对账闸按路由模式比：这条命令真打的是具体 slug，但服务端注册的是 :platform/:slug 那条通配路由。
    routes: [{ method: "POST", path: "/api/apis/:platform/:slug/call" }],
    billable: true, destructive: false, composite: true,
    run: (ctx, { args, flags }) => bannedCheck(ctx, args.text, { platforms: flags.platforms, raw: flags.raw })
  }
];
