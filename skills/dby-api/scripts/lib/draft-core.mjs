// draft-core.mjs — 稿件面（draft-review-workbench）的纯函数层，逐函数移植自旧
// skills/dby-api/scripts/doubaoya.mjs。镜像主仓 packages/draft-text/src/locate.ts 的
// locateQuote 与 apps/api 的 apply-changes.ts validateChangeInputs/placeChanges。
//
// 🔴 服务端才是唯一执行者（design: draft-review-workbench D3）——这里只是在发请求之前提前
//    说「会被拒」，行为必须与服务端一致，改一处要连带看另一处；两边是独立实现，不共享代码。

import { createHash } from "node:crypto";

export const DRAFT_MAX_REASON_CHARS = 300;
export const DRAFT_MAX_TAG_CHARS = 40;

function allIndexes(haystack, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return out;
    out.push(i);
    from = i + 1;
  }
}

function commonSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 本地版锚点定位。命中 0 处 → unlocated；1 处 → located；≥2 处靠 prefix/suffix 消歧，
 *  消歧不出赢家（分数并列或都是 0）→ ambiguous。 */
export function draftLocateQuote(body, anchor) {
  const exact = anchor?.exact;
  if (typeof exact !== "string" || exact.length === 0) return { status: "unlocated" };
  const hits = allIndexes(body, exact);
  if (hits.length === 0) return { status: "unlocated" };
  if (hits.length === 1) return { status: "located", start: hits[0], end: hits[0] + exact.length };

  const prefix = anchor.prefix ?? "";
  const suffix = anchor.suffix ?? "";
  if (prefix.length === 0 && suffix.length === 0) return { status: "ambiguous", count: hits.length };

  let best = null;
  let tie = false;
  for (const start of hits) {
    const before = body.slice(Math.max(0, start - prefix.length), start);
    const after = body.slice(start + exact.length, start + exact.length + suffix.length);
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (best === null || score > best.score) {
      best = { start, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  if (best === null || tie || best.score === 0) return { status: "ambiguous", count: hits.length };
  return { status: "located", start: best.start, end: best.start + exact.length };
}

/** changeId：与服务端 changeIdOf 同算法（sha256 前 12 位），用于本地判重复用同一套 id 空间。 */
export function draftChangeId(anchor, replacement) {
  const h = createHash("sha256");
  h.update(JSON.stringify([anchor.prefix ?? "", anchor.exact, anchor.suffix ?? "", replacement]));
  return h.digest("hex").slice(0, 12);
}

function preview(s) {
  const arr = [...s];
  return arr.length > 24 ? `${arr.slice(0, 24).join("")}…` : s;
}

/** 形状校验（不定位）：镜像服务端 validateChangeInputs 的顺序与错误码。 */
function validateChangeInputs(changes) {
  const errors = [];
  const valid = [];
  const seen = new Set();
  (changes ?? []).forEach((c, index) => {
    const a = c?.anchor;
    if (!a || typeof a !== "object" || typeof a.exact !== "string" || a.exact.length === 0) {
      errors.push({ index, code: "ANCHOR_INVALID", message: `第 ${index + 1} 条缺锚点：anchor.exact 必须是非空字符串` });
      return;
    }
    const anchor = {
      exact: a.exact,
      prefix: typeof a.prefix === "string" ? a.prefix : undefined,
      suffix: typeof a.suffix === "string" ? a.suffix : undefined
    };
    const replacement = c.replacement === undefined || c.replacement === null ? "" : c.replacement;
    if (typeof replacement !== "string") {
      errors.push({ index, code: "REPLACEMENT_INVALID", message: `第 ${index + 1} 条 replacement 必须是字符串（删除请传空串）` });
      return;
    }
    const reason = typeof c.reason === "string" ? c.reason.trim() : "";
    if (!reason) {
      errors.push({ index, code: "REASON_MISSING", message: `第 ${index + 1} 条缺理由：每处改动都要说清为什么改` });
      return;
    }
    if ([...reason].length > DRAFT_MAX_REASON_CHARS) {
      errors.push({ index, code: "REASON_TOO_LONG", message: `第 ${index + 1} 条理由超过 ${DRAFT_MAX_REASON_CHARS} 字` });
      return;
    }
    if (c.tag !== undefined && c.tag !== null && (typeof c.tag !== "string" || [...c.tag].length > DRAFT_MAX_TAG_CHARS)) {
      errors.push({ index, code: "TAG_INVALID", message: `第 ${index + 1} 条 tag 必须是 ≤${DRAFT_MAX_TAG_CHARS} 字的字符串` });
      return;
    }
    const id = draftChangeId(anchor, replacement);
    if (seen.has(id)) {
      errors.push({ index, code: "DUPLICATE", message: `第 ${index + 1} 条与前面某条完全相同` });
      return;
    }
    seen.add(id);
    valid.push({ index, anchor, replacement, reason });
  });
  return { errors, valid };
}

/** 定位 + 重叠检测：镜像服务端 placeChanges。调用前 valid 已过形状校验。 */
function placeChanges(bodyMd, valid) {
  const placed = [];
  const errors = [];
  for (const c of valid) {
    const r = draftLocateQuote(bodyMd, c.anchor);
    if (r.status === "unlocated") {
      errors.push({ index: c.index, code: "ANCHOR_NOT_FOUND", message: `第 ${c.index + 1} 条锚点未命中：基准版里找不到「${preview(c.anchor.exact)}」` });
    } else if (r.status === "ambiguous") {
      errors.push({ index: c.index, code: "ANCHOR_AMBIGUOUS", message: `第 ${c.index + 1} 条锚点不唯一（命中 ${r.count} 处）：请加长 prefix / suffix 消歧` });
    } else {
      placed.push({ index: c.index, start: r.start, end: r.end });
    }
  }
  const sorted = [...placed].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.start < prev.end) {
      errors.push({ index: cur.index, code: "OVERLAP", message: `第 ${cur.index + 1} 条与第 ${prev.index + 1} 条范围重叠，两条改的是同一段原文` });
    }
  }
  return errors;
}

/**
 * 提交改动清单前的本地预检：不发请求，把服务端一定会拒收的问题提前挡下并按相同
 * index/code/message 形状返回（任一条未命中 / 不唯一 / 缺理由 / 重叠 → 整单拒收）。
 */
export function draftPrecheckChanges(bodyMd, changes) {
  const { errors: shapeErrors, valid } = validateChangeInputs(changes);
  const placeErrors = placeChanges(bodyMd, valid);
  return [...shapeErrors, ...placeErrors].sort((a, b) => a.index - b.index);
}
