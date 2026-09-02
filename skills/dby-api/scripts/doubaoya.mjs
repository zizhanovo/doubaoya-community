#!/usr/bin/env node
// 都爆鸭 · doubaoya — zero-dependency reference client (Node 18+)
//
// 用法:
//   node doubaoya.mjs list [--skills|--apis]        拉能力清单（默认两个集合都拉）
//   node doubaoya.mjs search <query>                按关键词搜（两个集合都搜）
//   node doubaoya.mjs describe <ref>                看单条能力的入参/出参/调用路径
//   node doubaoya.mjs invoke <ref> '<json-body>' [--raw]   调一条能力（默认剥掉响应里与 items/content 重复的 raw，--raw 保留）
//   node doubaoya.mjs selfcheck                     离线自检（不联网、不需要 key）
//
// <ref> 三种写法，都行：
//   xiaohongshu-viral-notes        裸 slug —— 先查 skills，查不到再在 apis 里按 slug 找
//   trend/trending-hub-keyword     platform/slug —— 直指 apis 集合
//   api.trend.hotSpotKeyword       operationKey —— 在两个集合的清单里反查 slug
//
// 🔴 平台有**两个不相交的能力集合**，走两条不同的路由，彼此不回落：
//      产品化 Skill  → POST /api/skills/<slug>/invoke
//      平台数据能力  → POST /api/apis/<platform>/<slug>/call        ← 数量上的大头
//    所以本脚本 invoke 时**不自己拼路径**：先 describe 拿到该能力的
//    `execution.target`，照它给的 method + path 打。硬拼 /api/skills/ 会让
//    八成的能力必然 404 —— 这个脚本以前就是那么写的。
//
// 钥匙从环境变量读: DOUBAOYA_API_KEY
//   去 https://doubaoya.com → 登录 → 密钥中心 → 生成密钥
//   发现接口（list/search/describe）不需要 key；invoke 需要。
//
// 🔴 本脚本绝不打印 key 的任何一部分——连前缀都不行。报错里只说「已设置 / 没设置」。

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASE_URL = "https://doubaoya.com";

// 🔴 客户端超时必须晚于服务端，否则用户被扣点却拿不到服务端超时那条「已退款」响应。
//   - Node 全局 fetch（undici）不传 signal 时，等待响应头的实际上限是 ~300s——两条
//     互证的判据，不是"默认是 300s"这句话本身：
//     ①源码常量：`node_modules/undici/lib/dispatcher/client.js:262`
//       `this[kHeadersTimeout] = headersTimeout != null ? headersTimeout : 300e3`
//       （undici 7.29.0）；
//     ②端到端实测：起一个故意不发响应头的本地 http server，用全局 fetch 打它，
//       Node v22.22.3 下 elapsed_s=301.1 才失败，err.name=TypeError，
//       err.cause.code=UND_ERR_HEADERS_TIMEOUT（"Headers Timeout Error"）。
//       这个 code 也是将来排障「用户说超时了但我们日志没记录」时的判据。
//     比服务端还先掐线。
//   - 服务端目前可达能力里最长的超时预算是 skill.search.doubaoWeb 的 360s
//     （主仓 apps/api/.../invocation/routes.ts 的 OPERATION_TIMEOUT_MS；
//     skill.ai.seedreamLite 420s 更长，但它已下架 availability.status=hidden，不可达，不用照它抬）。
//   - 生产 nginx proxy_read_timeout=480s 是外墙，客户端墙超过它没有意义（nginx 会先 504）。
//   ⇒ 450s：> 360s 留 90s 余量，且在 480s 之内留 30s 余量。
//   ⚠️ 别拿"成功样本"反推这个数字——本仓已在生图超时链上吃过两次同一个错（拿被自己墙
//   截断的样本去推下一堵墙）。450s 是从链路上下两端的硬预算倒推的，不是从耗时分布估的。
const CLIENT_TIMEOUT_MS = 450_000;

function getKey({ required = true } = {}) {
  const key = process.env.DOUBAOYA_API_KEY;
  if (!key && required) {
    fail(
      "缺少 DOUBAOYA_API_KEY。去 https://doubaoya.com → 登录 → 密钥中心 → 生成密钥，" +
        "然后 `export DOUBAOYA_API_KEY=dyh_...`"
    );
  }
  return key;
}

// 🔴 只说「设没设」，**一个字符的密钥内容都不许进日志**——这些输出会被原样贴进 issue /
//    群里 / 转述给 agent。前缀看着人畜无害，但它就是密钥的一部分，没有例外。
function keyPresence() {
  return process.env.DOUBAOYA_API_KEY ? "已设置" : "没设置";
}

function fail(message, code = "") {
  console.error(code ? `[${code}] ${message}` : message);
  process.exit(1);
}

/**
 * fetch 因 `AbortSignal.timeout()` 触发而失败时，err.name 是 "TimeoutError"（DOMException，
 * Node 18+ 实测行为）。这类失败必须和普通网络错误分开措辞：调用可能已经打到了服务端、
 * 服务端可能仍在处理甚至已经计费/扣点——本地只是等不到响应头。
 * 🔴 别建议无脑重试：本仓红线「超时类永不重试」——上游可能已出图/已计费，重试=付两次钱。
 */
function describeFetchError(err) {
  if (err?.name === "TimeoutError") {
    return (
      `本地等待响应超过 ${CLIENT_TIMEOUT_MS / 1000}s，已放弃等待。这次调用服务端可能仍在` +
      "进行、也可能已经计费——不是「本地已知失败」。别立刻重试（上游若已出结果或已计费，" +
      "重试=再付一次）；先等一会儿用 doubaoya.com 后台或调用记录确认这次到底有没有成功/扣点，" +
      "确认失败后再决定要不要重试。"
    );
  }
  return `网络请求失败: ${err.message}`;
}

/**
 * 一条能力对象 → 它的完整调用路径。目录是单一事实源：`execution.target` 由服务端算好，
 * 通用能力给 /api/skills/<slug>/invoke 或 /api/apis/<platform>/<slug>/call，专用路由给自己的
 * 真实签名（方法可能是 PUT/GET）。下架/维护中的能力 mode=unavailable 且**没有 target**。
 * 纯函数，selfcheck 直接打它。
 */
export function resolveTarget(capability) {
  const execution = capability?.execution;
  if (!execution) return { error: "这条能力没有 execution 字段，无法确定调用路径（目录返回结构可能变了）" };
  if (execution.mode === "unavailable" || !execution.target) {
    const note = capability.availability?.note;
    return {
      error:
        `该能力当前不可调用（execution.mode=${execution.mode ?? "?"}）` +
        (note ? `：${note}` : "：维护中或已下架") +
        "。换一条能力，或如实告诉用户这个能力暂时用不了。"
    };
  }
  const { method, path } = execution.target;
  if (!method || !path) return { error: "execution.target 缺 method/path，无法发请求" };
  return { method, path, mode: execution.mode };
}

/** operationKey 形如 `api.trend.hotSpotKeyword` / `skill.wechat.hotSearch` / `tool.content.parseDetail`：带点、不带斜杠。 */
export function isOperationKey(ref) {
  return typeof ref === "string" && /^[a-z]+(\.[A-Za-z0-9]+)+$/.test(ref.trim()) && !ref.includes("/");
}

/** 在两个集合的清单里按 operationKey 反查；同一 key 在两个集合各有一条时全部返回（已知有一处撞名）。 */
export function matchByOperationKey(skillItems, apiItems, key) {
  return [...(skillItems ?? []), ...(apiItems ?? [])].filter((item) => item.operationKey === key);
}

/** 响应 data 里 `raw` 是上游原样回包，和 items/content 重复；默认剥掉，`--raw` 才保留。纯函数，不改入参。 */
export function stripRaw(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (!("raw" in data) || !("items" in data || "content" in data)) return data;
  const { raw: _raw, ...rest } = data;
  return rest;
}

/** 计费标签：unitPrice 是 0 / priceClass 是 free ⇒ 免费；否则 N点。清单里没这两个字段就标「?」（价格去 describe 看）。 */
export function priceLabel(item) {
  const price = item?.unitPrice;
  if (price === 0 || item?.priceClass === "free") return "免费";
  if (typeof price === "number") return `${price}点`;
  return "?";
}

/** `platform/slug` → {platform, slug}；裸 `slug` → {slug}。多于一个斜杠视为非法。 */
export function parseRef(ref) {
  if (typeof ref !== "string" || !ref.trim()) return { error: "ref 不能为空" };
  const parts = ref.trim().split("/");
  if (parts.length === 1) return { slug: parts[0] };
  if (parts.length === 2 && parts[0] && parts[1]) return { platform: parts[0], slug: parts[1] };
  return { error: `ref 形如 <slug> 或 <platform>/<slug>，收到: ${ref}` };
}

/** 在 apis 清单里按裸 slug 找。同名跨平台是可能的（如多个平台都有 search-work），所以返回全部命中。 */
export function matchApisBySlug(items, slug) {
  return (items ?? []).filter((item) => item.slug === slug);
}

async function request(method, path, body, { auth = "required" } = {}) {
  const key = getKey({ required: auth === "required" });
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS)
    });
  } catch (err) {
    fail(describeFetchError(err));
  }

  let env;
  try {
    env = await res.json();
  } catch {
    fail(`返回不是合法 JSON (HTTP ${res.status})`);
  }

  if (!env || env.success !== true) {
    const code = env?.error?.code ?? `HTTP_${res.status}`;
    const msg = env?.error?.message ?? "未知错误";
    if (code === "MISSING_API_KEY" || code === "UNAUTHORIZED") {
      fail(
        `${msg}（DOUBAOYA_API_KEY ${keyPresence()}）。请在 doubaoya.com 密钥中心撤销并重新生成，再更新 DOUBAOYA_API_KEY。`,
        code
      );
    }
    fail(msg, code);
  }

  // notice / noResult 是成功信封上的可选字段，走 stderr 免得污染 stdout 的 JSON。
  if (env.notice) console.error(`[notice] ${env.notice}`);
  if (env.noResult) console.error(`[${env.noResult.code}] ${env.noResult.message}`);
  return env.data;
}

/** 软失败版 GET：404 返回 null 而不是退出——ref 解析要靠它在两个集合之间试。 */
async function tryGet(path) {
  const key = getKey({ required: false });
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) });
  } catch (err) {
    fail(describeFetchError(err));
  }
  if (res.status === 404) return null;
  let env;
  try {
    env = await res.json();
  } catch {
    fail(`返回不是合法 JSON (HTTP ${res.status})`);
  }
  if (!env || env.success !== true) fail(env?.error?.message ?? "未知错误", env?.error?.code ?? `HTTP_${res.status}`);
  return env.data;
}

/** operationKey → 能力对象：两份清单反查到 slug，再拉详情（清单项不带 inputContract）。 */
async function resolveByOperationKey(key) {
  const [skills, apis] = await Promise.all([
    request("GET", "/api/skills", undefined, { auth: "optional" }),
    request("GET", "/api/apis", undefined, { auth: "optional" })
  ]);
  const hits = matchByOperationKey(skills.items, apis.items, key);
  if (hits.length > 1) {
    fail(
      `「${key}」在两个集合里各有一条，请改用详情端点尾段点名：` +
        hits.map((item) => (item.platform ? `${item.platform}/${item.slug}` : item.slug)).join(" / "),
      "AMBIGUOUS_REF"
    );
  }
  if (hits.length === 1) {
    const hit = hits[0];
    const detail = await tryGet(
      hit.platform
        ? `/api/apis/${encodeURIComponent(hit.platform)}/${encodeURIComponent(hit.slug)}`
        : `/api/skills/${encodeURIComponent(hit.slug)}`
    );
    if (detail) return detail;
  }
  return null;
}

/** ref → 能力对象。operationKey 反查两份清单；裸 slug 先查 skills，再查 apis；都没有就报「两个集合都查过了」。 */
async function resolveCapability(ref) {
  if (isOperationKey(ref)) {
    const byKey = await resolveByOperationKey(ref.trim());
    if (byKey) return byKey;
    fail(
      `两个集合的清单里都没有 operationKey「${ref.trim()}」。跑 \`node doubaoya.mjs list\` 看全部，或 \`search <关键词>\` 按意图找；也可能它已经下架了。`,
      "NOT_FOUND"
    );
  }
  const parsed = parseRef(ref);
  if (parsed.error) fail(parsed.error);

  if (parsed.platform) {
    const api = await tryGet(`/api/apis/${encodeURIComponent(parsed.platform)}/${encodeURIComponent(parsed.slug)}`);
    if (api) return api;
    fail(
      `apis 集合里没有 ${parsed.platform}/${parsed.slug}。跑 \`node doubaoya.mjs list --apis\` 看全部，` +
        "或 `search <关键词>` 按意图找。",
      "ENDPOINT_NOT_FOUND"
    );
  }

  const skill = await tryGet(`/api/skills/${encodeURIComponent(parsed.slug)}`);
  if (skill) return skill;

  const apis = await request("GET", "/api/apis", undefined, { auth: "optional" });
  const hits = matchApisBySlug(apis.items, parsed.slug);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    fail(
      `「${parsed.slug}」在多个平台下都有，请写全 <platform>/<slug>：` +
        hits.map((item) => `${item.platform}/${item.slug}`).join(" / "),
      "AMBIGUOUS_REF"
    );
  }
  fail(
    `两个集合都查过了（operationKey 与 slug 都查过），没有「${parsed.slug}」这条能力。\n` +
      "  · 它可能是**技能包目录名**而不是调用 slug（如 trending-hub / content-parse / image-gen 都不是）\n" +
      "  · 跑 `node doubaoya.mjs search <关键词>` 按意图找，或 `list` 看全部\n" +
      "  · 也可能它已经下架了",
    "NOT_FOUND"
  );
}

function callPath(item) {
  const target = resolveTarget(item);
  return target.error ? "（不可调用）" : `${target.method} ${target.path}`;
}

function printRows(items) {
  for (const item of items ?? []) {
    const ref = item.platform ? `${item.platform}/${item.slug}` : item.slug;
    console.log(`${ref.padEnd(44)} ${callPath(item).padEnd(58)} ${priceLabel(item).padEnd(6)} ${item.title ?? ""}`);
  }
}

function parseBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    fail("入参不是合法 JSON。示例: '{\"keyword\":\"美食\"}'");
  }
}

// ── 稿件面 (draft-review) ──────────────────────────────────────────────────
// 对接主仓 apps/api/src/modules/drafts/routes.ts（design: draft-review-workbench）。
// 全部端点免费、不进 catalog、不扣点，同一把 DOUBAOYA_API_KEY，鉴权与错误处理复用上面的 request()。
const DRAFT_MAX_REASON_CHARS = 300;
const DRAFT_MAX_TAG_CHARS = 40;

function draftAllIndexes(haystack, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return out;
    out.push(i);
    from = i + 1;
  }
}

function draftCommonSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function draftCommonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * 本地版锚点定位——镜像主仓 packages/draft-text/src/locate.ts 的 locateQuote。
 * 🔴 两处是独立实现，服务端才是唯一执行者（design D3）；这里只为了在发请求之前提前说「会被拒」，
 * 行为必须与服务端一致，改一处要连带看另一处。
 */
export function draftLocateQuote(body, anchor) {
  const exact = anchor?.exact;
  if (typeof exact !== "string" || exact.length === 0) return { status: "unlocated" };
  const hits = draftAllIndexes(body, exact);
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
    const score = draftCommonSuffixLength(before, prefix) + draftCommonPrefixLength(after, suffix);
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

function draftPreview(s) {
  const arr = [...s];
  return arr.length > 24 ? `${arr.slice(0, 24).join("")}…` : s;
}

/** 形状校验（不定位）：镜像服务端 validateChangeInputs 的顺序与错误码。 */
function draftValidateChangeInputs(changes) {
  const errors = [];
  const valid = [];
  const seen = new Set();
  (changes ?? []).forEach((c, index) => {
    const a = c?.anchor;
    if (!a || typeof a !== "object" || typeof a.exact !== "string" || a.exact.length === 0) {
      errors.push({ index, code: "ANCHOR_INVALID", message: `第 ${index + 1} 条缺锚点：anchor.exact 必须是非空字符串` });
      return;
    }
    const anchor = { exact: a.exact, prefix: typeof a.prefix === "string" ? a.prefix : undefined, suffix: typeof a.suffix === "string" ? a.suffix : undefined };
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
function draftPlaceChanges(bodyMd, valid) {
  const placed = [];
  const errors = [];
  for (const c of valid) {
    const r = draftLocateQuote(bodyMd, c.anchor);
    if (r.status === "unlocated") {
      errors.push({ index: c.index, code: "ANCHOR_NOT_FOUND", message: `第 ${c.index + 1} 条锚点未命中：基准版里找不到「${draftPreview(c.anchor.exact)}」` });
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
 * index/code/message 形状打印（design D3：任一条未命中 / 不唯一 / 缺理由 / 重叠 → 整单拒收）。
 * 真正的应用仍只在服务端算一次（design 全文的「派生只在一处算」），这里只做「提前告诉你会被拒」。
 */
export function draftPrecheckChanges(bodyMd, changes) {
  const { errors: shapeErrors, valid } = draftValidateChangeInputs(changes);
  const placeErrors = draftPlaceChanges(bodyMd, valid);
  return [...shapeErrors, ...placeErrors].sort((a, b) => a.index - b.index);
}

function printChangeErrors(errors) {
  for (const e of errors) console.error(`[${e.code}] 第 ${e.index + 1} 条: ${e.message}`);
}

async function readStdin() {
  return await new Promise((resolve) => {
    let buf = "";
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
}

function draftJsonArg(args, positionalIndex) {
  return args.includes("--stdin") ? readStdin() : Promise.resolve(args[positionalIndex]);
}

async function draftCommand(sub, args) {
  switch (sub) {
    case "create": {
      const raw = await draftJsonArg(args, 0);
      if (!raw) fail("用法: node doubaoya.mjs draft create '<json>' | --stdin  字段: title, bodyMd, author?, projectId?, summary?");
      const data = await request("POST", "/api/drafts", parseBody(raw));
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "get": {
      const id = args[0];
      if (!id) fail("用法: node doubaoya.mjs draft get <id>");
      const data = await request("GET", `/api/drafts/${encodeURIComponent(id)}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "version": {
      const [id, v] = args;
      if (!id || !v) fail("用法: node doubaoya.mjs draft version <id> <version>");
      const data = await request("GET", `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(v)}`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "review-packet": {
      const id = args[0];
      if (!id) fail("用法: node doubaoya.mjs draft review-packet <id>");
      const data = await request("GET", `/api/drafts/${encodeURIComponent(id)}/review-packet`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "precheck": {
      const raw = await draftJsonArg(args, 0);
      if (!raw) fail("用法: node doubaoya.mjs draft precheck '<json>' | --stdin  字段: bodyMd（基准版正文）, changes[]（不联网、不需要 key）");
      const body = parseBody(raw);
      if (typeof body.bodyMd !== "string") fail("precheck 需要 bodyMd（基准版正文字符串）");
      if (!Array.isArray(body.changes)) fail("precheck 需要 changes[]（改动清单）");
      const errors = draftPrecheckChanges(body.bodyMd, body.changes);
      if (errors.length > 0) {
        printChangeErrors(errors);
        fail(`预检未通过：${errors.length} 处问题，未发送任何请求`, "CHANGES_INVALID");
      }
      console.log(`precheck ok: ${body.changes.length} 条改动全部可定位、互不重叠、理由齐全`);
      break;
    }
    case "submit": {
      const id = args[0];
      if (!id) fail("用法: node doubaoya.mjs draft submit <id> '<json>' | --stdin  字段: baseVersion, author?, summary?, addresses?, changes[] 或 bodyMd");
      const raw = await draftJsonArg(args, 1);
      if (!raw) fail("用法: node doubaoya.mjs draft submit <id> '<json>' | --stdin");
      const body = parseBody(raw);
      if (!Number.isInteger(body.baseVersion)) fail("submit 需要 baseVersion（整数）：你基于哪一版改的");
      if (Array.isArray(body.changes)) {
        // 🔴 先本地预检再发请求：清单整单拒收是服务端的既有行为（design D3），
        //   本地拦下只是让 agent 少挨一次 422、少读一遍 SKILL 就知道该改哪一条。
        const base = await request("GET", `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(body.baseVersion)}`);
        const errors = draftPrecheckChanges(base.bodyMd, body.changes);
        if (errors.length > 0) {
          printChangeErrors(errors);
          fail(`本地预检未通过：${errors.length} 处问题，服务端会整单拒收——已提前拦下，未发送写请求`, "CHANGES_INVALID");
        }
      }
      const data = await request("POST", `/api/drafts/${encodeURIComponent(id)}/versions`, body);
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    case "comment": {
      const id = args[0];
      if (!id) fail("用法: node doubaoya.mjs draft comment <id> '<json>' | --stdin  字段: body, author?, parentId?（回复）或 version?+anchor?（新评论）");
      const raw = await draftJsonArg(args, 1);
      if (!raw) fail("用法: node doubaoya.mjs draft comment <id> '<json>' | --stdin");
      const data = await request("POST", `/api/drafts/${encodeURIComponent(id)}/comments`, parseBody(raw));
      console.log(JSON.stringify(data, null, 2));
      break;
    }
    default:
      fail("用法: node doubaoya.mjs draft <create|get|version|review-packet|submit|comment|precheck> ...  跑不带子命令的 draft 看这行");
  }
}

function matchesQuery(item, query) {
  const haystack = [item.slug, item.platform, item.title, item.summary, ...(item.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

const USAGE = [
  "都爆鸭 · doubaoya client",
  "",
  "  node doubaoya.mjs list [--skills|--apis]        拉能力清单（默认两个集合都拉）",
  "  node doubaoya.mjs search <query>                按关键词搜（两个集合都搜）",
  "  node doubaoya.mjs describe <ref>                看单条能力的入参/出参/调用路径",
  "  node doubaoya.mjs invoke <ref> '<json-body>' [--raw]   调一条能力（默认剥掉与 items/content 重复的 raw）",
  "  node doubaoya.mjs selfcheck                     离线自检",
  "",
  "  list / search 每行：ref  调用路径  计费（免费 / N点）  标题",
  "  <ref> = <slug> 或 <platform>/<slug> 或 operationKey，例:",
  "    node doubaoya.mjs invoke xiaohongshu-viral-notes '{\"keyword\":\"减脂早餐\"}'",
  "    node doubaoya.mjs invoke trend/trending-hub-keyword '{\"platforms\":[2,5,8]}'",
  "    node doubaoya.mjs describe api.trend.hotSpotKeyword",
  "",
  "稿件面（draft-review，全部免费、不进 catalog）:",
  "  node doubaoya.mjs draft create '<json>' | --stdin        建稿，字段 title/bodyMd/author?/projectId?/summary?",
  "  node doubaoya.mjs draft get <id>                         稿件 + 版本清单 + 待处理评论数",
  "  node doubaoya.mjs draft version <id> <v>                 读某版正文 + 改动清单 + 裁决",
  "  node doubaoya.mjs draft review-packet <id>                agent 唯一要读的入口：最新版 + 待处理评论 + 新拒绝 + 星标",
  "  node doubaoya.mjs draft precheck '<json>' | --stdin       离线预检 changes[]（不联网、不需要 key），字段 bodyMd/changes",
  "  node doubaoya.mjs draft submit <id> '<json>' | --stdin    交新版，changes[] 会先本地预检再发；字段见调用方包的 api-contract.md",
  "  node doubaoya.mjs draft comment <id> '<json>' | --stdin   划词评论 / 回复，字段 body/author?/parentId? 或 version?+anchor?",
  "",
  "钥匙: export DOUBAOYA_API_KEY=dyh_...  (doubaoya.com → 密钥中心 → 生成密钥)"
].join("\n");

/** 离线自检：把 ref 解析与 target 解析这两处非平凡逻辑钉住，不联网、不需要 key。 */
function selfcheck() {
  const assert = (condition, label) => {
    if (!condition) {
      console.error(`selfcheck FAILED: ${label}`);
      process.exit(1);
    }
  };

  assert(parseRef("cn-last30days").slug === "cn-last30days", "裸 slug");
  assert(parseRef("cn-last30days").platform === undefined, "裸 slug 不该有 platform");
  const pair = parseRef("trend/trending-hub-keyword");
  assert(pair.platform === "trend" && pair.slug === "trending-hub-keyword", "platform/slug");
  assert(parseRef("a/b/c").error, "三段 ref 必须报错");
  assert(parseRef("").error, "空 ref 必须报错");

  const generic = { execution: { mode: "generic", target: { method: "POST", path: "/api/apis/trend/hot-keywords/call" } } };
  assert(resolveTarget(generic).path === "/api/apis/trend/hot-keywords/call", "generic 取 target.path");
  const dedicated = { execution: { mode: "dedicated", target: { method: "PUT", path: "/api/ip-profile/:id/charter" } } };
  assert(resolveTarget(dedicated).method === "PUT", "dedicated 必须沿用它自己的 method，不能一律 POST");
  const down = { execution: { mode: "unavailable" }, availability: { status: "hidden" } };
  assert(resolveTarget(down).error, "unavailable 必须挡下，不能拼路径硬打");
  assert(resolveTarget({}).error, "缺 execution 必须报错");

  const items = [
    { platform: "douyin", slug: "search-work" },
    { platform: "xiaohongshu", slug: "search-work" },
    { platform: "trend", slug: "hot-keywords" }
  ];
  assert(matchApisBySlug(items, "hot-keywords").length === 1, "唯一命中");
  assert(matchApisBySlug(items, "search-work").length === 2, "跨平台同名必须全返回，好让调用方要求写全 ref");
  assert(matchApisBySlug(items, "nope").length === 0, "查无");

  assert(isOperationKey("api.trend.hotSpotKeyword"), "operationKey 形状");
  assert(isOperationKey("skill.wechat.hotSearch"), "skill 侧 operationKey");
  assert(!isOperationKey("trend/trending-hub-keyword"), "platform/slug 不是 operationKey");
  assert(!isOperationKey("cn-last30days"), "裸 slug 不是 operationKey");
  const skillItems = [{ slug: "content-safety-check", operationKey: "tool.contentSafety.checkWords" }];
  const apiItems = [
    { platform: "trend", slug: "trending-hub-keyword", operationKey: "api.trend.hotSpotKeyword" },
    { platform: "tool", slug: "content-safety", operationKey: "tool.contentSafety.checkWords" }
  ];
  assert(matchByOperationKey(skillItems, apiItems, "api.trend.hotSpotKeyword").length === 1, "operationKey 唯一命中");
  assert(matchByOperationKey(skillItems, apiItems, "tool.contentSafety.checkWords").length === 2, "撞名的 operationKey 两条都要返回");
  assert(matchByOperationKey(skillItems, apiItems, "api.nope").length === 0, "operationKey 查无");

  const withRaw = { total: 1, items: [{ id: 1 }], raw: { upstream: "…" } };
  const stripped = stripRaw(withRaw);
  assert(!("raw" in stripped) && stripped.items.length === 1 && stripped.total === 1, "有 items 时剥掉 raw、其余原样");
  assert("raw" in withRaw, "stripRaw 不改入参");
  assert(!("raw" in stripRaw({ content: "x", raw: {} })), "有 content 时剥掉 raw");
  assert("raw" in stripRaw({ raw: {}, other: 1 }), "没有 items/content 时 raw 不动（它可能就是唯一内容）");
  assert(stripRaw(null) === null && Array.isArray(stripRaw([1])), "非对象原样返回");

  const fakePrice = 1 + 2; // 构造值，不是任何能力的真实价格
  assert(priceLabel({ unitPrice: fakePrice, priceClass: "standardData" }) === `${fakePrice}点`, "计费标签");
  assert(priceLabel({ unitPrice: 0, priceClass: "free" }) === "免费", "免费标签");
  assert(priceLabel({}) === "?", "清单缺价格字段时标 ?");

  // ── 稿件面：本地预检（draftPrecheckChanges / draftLocateQuote），镜像服务端 apply-changes.ts。
  const draftBody = "开头一句。中间这句要改一改。结尾一句。中间这句要改一改。再来一句。";
  assert(draftLocateQuote(draftBody, { exact: "开头一句" }).status === "located", "唯一命中 → located");
  assert(draftLocateQuote(draftBody, { exact: "不存在的句子" }).status === "unlocated", "零命中 → unlocated");
  assert(draftLocateQuote(draftBody, { exact: "中间这句要改一改" }).status === "ambiguous", "命中两处且无前后文 → ambiguous");
  const disambiguated = draftLocateQuote(draftBody, { exact: "中间这句要改一改", prefix: "结尾一句。" });
  assert(disambiguated.status === "located", "带 prefix 消歧后应能唯一定位");

  const okChanges = [{ anchor: { exact: "开头一句" }, replacement: "开场一句", reason: "更顺口" }];
  assert(draftPrecheckChanges(draftBody, okChanges).length === 0, "干净清单预检应无错误");

  const notFound = draftPrecheckChanges(draftBody, [{ anchor: { exact: "查无此句" }, replacement: "x", reason: "y" }]);
  assert(notFound.length === 1 && notFound[0].code === "ANCHOR_NOT_FOUND", "零命中必须报 ANCHOR_NOT_FOUND");

  const ambiguous = draftPrecheckChanges(draftBody, [{ anchor: { exact: "中间这句要改一改" }, replacement: "x", reason: "y" }]);
  assert(ambiguous.length === 1 && ambiguous[0].code === "ANCHOR_AMBIGUOUS", "命中多处且不可消歧必须报 ANCHOR_AMBIGUOUS");

  const noReason = draftPrecheckChanges(draftBody, [{ anchor: { exact: "开头一句" }, replacement: "x" }]);
  assert(noReason.length === 1 && noReason[0].code === "REASON_MISSING", "缺理由必须报 REASON_MISSING");

  const overlapBody = "abcdefgh";
  const overlapping = draftPrecheckChanges(overlapBody, [
    { anchor: { exact: "abcd" }, replacement: "x", reason: "y" },
    { anchor: { exact: "cdef" }, replacement: "z", reason: "w" }
  ]);
  assert(overlapping.length === 1 && overlapping[0].code === "OVERLAP", "范围重叠必须报 OVERLAP");

  // 🔴 本条即任务要求的「示例正文提交含重复锚点的清单，必须被本地拦下」：
  //    两条改动锚点 + 替换内容完全相同 → DUPLICATE，且不得静默通过。
  const dup = { anchor: { exact: "开头一句" }, replacement: "开场一句", reason: "更顺口" };
  const duplicateAnchors = draftPrecheckChanges(draftBody, [dup, { ...dup }]);
  assert(duplicateAnchors.length === 1 && duplicateAnchors[0].code === "DUPLICATE" && duplicateAnchors[0].index === 1, "重复锚点必须报 DUPLICATE 且指向第二条");
  assert(draftChangeId(dup.anchor, dup.replacement) === draftChangeId({ ...dup.anchor }, dup.replacement), "changeId 对同一锚点+替换必须稳定");

  console.log("selfcheck ok: parseRef / resolveTarget / matchApisBySlug / isOperationKey / matchByOperationKey / stripRaw / priceLabel / draftLocateQuote / draftPrecheckChanges");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "invoke": {
      const keepRaw = rest.includes("--raw");
      const args = rest.filter((a) => a !== "--raw");
      const ref = args[0];
      if (!ref) fail("用法: node doubaoya.mjs invoke <ref> '<json-body>' [--raw]");
      getKey(); // invoke 必须有 key，早失败早报错
      const capability = await resolveCapability(ref);
      const target = resolveTarget(capability);
      if (target.error) fail(target.error, "CAPABILITY_UNAVAILABLE");
      const data = await request(target.method, target.path, parseBody(args[1]));
      console.log(JSON.stringify(keepRaw ? data : stripRaw(data), null, 2));
      break;
    }
    case "list": {
      const wantSkills = !rest.includes("--apis");
      const wantApis = !rest.includes("--skills");
      if (wantSkills) {
        const data = await request("GET", "/api/skills", undefined, { auth: "optional" });
        console.log(`# 产品化 Skill（${data.total ?? (data.items ?? []).length} 条）`);
        printRows(data.items);
      }
      if (wantApis) {
        if (wantSkills) console.log("");
        const data = await request("GET", "/api/apis", undefined, { auth: "optional" });
        console.log(`# 平台数据能力（${data.total ?? (data.items ?? []).length} 条）`);
        printRows(data.items);
      }
      break;
    }
    case "search": {
      const query = rest.join(" ");
      if (!query) fail("用法: node doubaoya.mjs search <query>");
      // skills 侧有服务端打分的搜索接口；apis 侧没有，本地按 slug/title/summary/tags 过滤。
      const skills = await request("GET", `/api/skills/search?query=${encodeURIComponent(query)}`, undefined, {
        auth: "optional"
      });
      const apis = await request("GET", "/api/apis", undefined, { auth: "optional" });
      const apiHits = (apis.items ?? []).filter((item) => matchesQuery(item, query));
      console.log(`# 产品化 Skill 命中 ${(skills.items ?? []).length} 条`);
      printRows(skills.items);
      console.log(`\n# 平台数据能力命中 ${apiHits.length} 条`);
      printRows(apiHits);
      if (!(skills.items ?? []).length && !apiHits.length) {
        console.error("两个集合都没搜到。换个词，或跑 `list` 通览。");
      }
      break;
    }
    case "describe": {
      const ref = rest[0];
      if (!ref) fail("用法: node doubaoya.mjs describe <ref>");
      const capability = await resolveCapability(ref);
      const target = resolveTarget(capability);
      console.error(target.error ? `[调用路径] ${target.error}` : `[调用路径] ${target.method} ${target.path}`);
      console.log(JSON.stringify(capability, null, 2));
      break;
    }
    case "draft": {
      const [sub, ...args] = rest;
      if (!sub) fail("用法: node doubaoya.mjs draft <create|get|version|review-packet|precheck|submit|comment> ...  完整字段见 USAGE（不带参数跑一次本脚本）");
      await draftCommand(sub, args);
      break;
    }
    case "selfcheck":
      selfcheck();
      break;
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

// 🔴 入口守卫：两边都先 realpathSync 落到同一条真路径再比。
//    `import.meta.url` 是 ESM loader **解过软链**的真路径，`process.argv[1]` 原样保留调用时
//    给的那条路径；而软链正是 skills CLI 装出来的常态形态（`.claude/skills/<name>` →
//    `.agents/skills/<name>`）。拿字面串比 ⇒ 经绝对软链路径调用时两串不等 ⇒ main() 一步都不进、
//    退出码 0、stdout 零字节：用户看到的不是报错，是**什么都没发生**——最难查的失败形态。
//    `pathToFileURL` 只治编码、不解软链——光换成它不算修好（同族里正有这么一种伪修对写法）。
//    skill 包各自独立安装、不能跨包 import，所以这段在每个入口脚本里各留一份，改一处要全改。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false; // node -e / REPL / 管道喂进来：本来就没有主脚本，安静退场是对的
  const selfPath = fileURLToPath(import.meta.url);
  const href = (p) => {
    try {
      return pathToFileURL(realpathSync(p)).href;
    } catch {
      return null;
    }
  };
  const called = href(argv1);
  const here = href(selfPath);
  if (called && here) return called === here;
  // realpath 解不开（路径当场被删、权限不足……）：**绝不静默**。先退回未解软链的字面比较，
  // 还判不出来就吭一声——宁可多打一行提示，也不要再来一次「零输出、退出码 0」。
  if (argv1 === selfPath) return true;
  console.error(
    `提示：解析不出 ${argv1} 的真实路径，没法确认是不是在直接跑本脚本；` +
      `如果你就是在直接跑它，换成绝对路径重试。`
  );
  return false;
}

// 被 import 时（selfcheck 复用这些纯函数）不跑 main。
if (isMainModule()) {
  main();
}
