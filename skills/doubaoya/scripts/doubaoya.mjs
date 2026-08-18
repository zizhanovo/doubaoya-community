#!/usr/bin/env node
// 都爆鸭 · doubaoya — zero-dependency reference client (Node 18+)
//
// 用法:
//   node doubaoya.mjs list [--skills|--apis]        拉能力清单（默认两个集合都拉）
//   node doubaoya.mjs search <query>                按关键词搜（两个集合都搜）
//   node doubaoya.mjs describe <ref>                看单条能力的入参/出参/调用路径
//   node doubaoya.mjs invoke <ref> '<json-body>'    调一条能力
//   node doubaoya.mjs selfcheck                     离线自检（不联网、不需要 key）
//
// <ref> 两种写法，都行：
//   xiaohongshu-viral-notes        裸 slug —— 先查 skills，查不到再在 apis 里按 slug 找
//   trend/trending-hub-keyword     platform/slug —— 直指 apis 集合
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
// 本脚本绝不打印整条 key（只在出错时露前缀）。

const BASE_URL = "https://doubaoya.com";

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

function maskKey(key) {
  return key && key.length > 8 ? `${key.slice(0, 8)}…` : "（已隐藏）";
}

function fail(message, code = "") {
  console.error(code ? `[${code}] ${message}` : message);
  process.exit(1);
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
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    fail(`网络请求失败: ${err.message}`);
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
        `${msg}（当前 key ${maskKey(getKey({ required: false }))}）。请在 doubaoya.com 密钥中心撤销并重新生成，再更新 DOUBAOYA_API_KEY。`,
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
    res = await fetch(`${BASE_URL}${path}`, { headers });
  } catch (err) {
    fail(`网络请求失败: ${err.message}`);
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

/** ref → 能力对象。裸 slug 先查 skills，再查 apis；两边都没有就报「两个集合都查过了」。 */
async function resolveCapability(ref) {
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
    `两个集合都查过了，没有「${parsed.slug}」这条能力。\n` +
      "  · 它可能是**技能包目录名**而不是调用 slug（如 trending-hub / content-parse / douyin-search 都不是）\n" +
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
    console.log(`${ref.padEnd(44)} ${callPath(item).padEnd(58)} ${item.title ?? ""}`);
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
  "  node doubaoya.mjs invoke <ref> '<json-body>'    调一条能力",
  "  node doubaoya.mjs selfcheck                     离线自检",
  "",
  "  <ref> = <slug> 或 <platform>/<slug>，例:",
  "    node doubaoya.mjs invoke xiaohongshu-viral-notes '{\"keyword\":\"减脂早餐\"}'",
  "    node doubaoya.mjs invoke trend/trending-hub-keyword '{\"platforms\":[2,5,8]}'",
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

  console.log("selfcheck ok: parseRef / resolveTarget / matchApisBySlug");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "invoke": {
      const ref = rest[0];
      if (!ref) fail("用法: node doubaoya.mjs invoke <ref> '<json-body>'");
      getKey(); // invoke 必须有 key，早失败早报错
      const capability = await resolveCapability(ref);
      const target = resolveTarget(capability);
      if (target.error) fail(target.error, "CAPABILITY_UNAVAILABLE");
      const data = await request(target.method, target.path, parseBody(rest[1]));
      console.log(JSON.stringify(data, null, 2));
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
    case "selfcheck":
      selfcheck();
      break;
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

// 被 import 时（selfcheck 复用这些纯函数）不跑 main。
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
