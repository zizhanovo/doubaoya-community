// api.mjs — `dby api list|search|describe|invoke`（迁移自 skills/dby-api/scripts/doubaoya.mjs）。
// 发现类（list/search/describe）免 key 免费、只读不套确认；invoke 按能力计费标签走确认协议。

import { getKey } from "../context.mjs";
import { EXIT, DbyError } from "../errors.mjs";
import { request, INVOKE_TIMEOUT_MS } from "../http.mjs";
import { billable } from "../confirm.mjs";
import { warn } from "../output.mjs";
import {
  resolveTarget, isOperationKey, matchByOperationKey, stripRaw,
  priceLabel, parseRef, matchApisBySlug, matchesQuery, callPath
} from "../capability.mjs";

/** list/search 的人类行：ref、调用路径、计费、标题（与旧脚本同款）。 */
function rows(items) {
  return (items ?? []).map((item) => {
    const ref = item.platform ? `${item.platform}/${item.slug}` : item.slug;
    return `${ref.padEnd(44)} ${callPath(item).padEnd(58)} ${priceLabel(item).padEnd(6)} ${item.title ?? ""}`;
  });
}

/** operationKey → 能力对象：两份清单反查到 slug，再拉详情（清单项不带入参契约）。 */
async function resolveByOperationKey(ctx, key) {
  const [skills, apis] = await Promise.all([
    request(ctx, "GET", "/api/skills", { auth: "optional" }),
    request(ctx, "GET", "/api/apis", { auth: "optional" })
  ]);
  const hits = matchByOperationKey(skills.items, apis.items, key);
  if (hits.length > 1) {
    throw new DbyError(
      "AMBIGUOUS_REF",
      `「${key}」在两个集合里各有一条，请改用 <platform>/<slug> 点名：` +
        hits.map((item) => (item.platform ? `${item.platform}/${item.slug}` : item.slug)).join(" / "),
      { exit: EXIT.BUSINESS }
    );
  }
  if (hits.length === 1) {
    const hit = hits[0];
    const detail = await request(
      ctx, "GET",
      hit.platform
        ? `/api/apis/${encodeURIComponent(hit.platform)}/${encodeURIComponent(hit.slug)}`
        : `/api/skills/${encodeURIComponent(hit.slug)}`,
      { auth: "optional", notFoundNull: true }
    );
    if (detail) return detail;
  }
  return null;
}

/** ref → 能力对象。operationKey 反查两份清单；裸 slug 先查 skills 再查 apis（两集合互不回落）。 */
async function resolveCapability(ctx, ref) {
  if (isOperationKey(ref)) {
    const byKey = await resolveByOperationKey(ctx, ref.trim());
    if (byKey) return byKey;
    throw new DbyError("NOT_FOUND", `两个集合的清单里都没有 operationKey「${ref.trim()}」。`, {
      exit: EXIT.BUSINESS,
      remediation: "跑 `dby api list` 看全部，或 `dby api search <关键词>` 按意图找；也可能它已经下架了。"
    });
  }
  const parsed = parseRef(ref);
  if (parsed.error) throw new DbyError("USAGE", parsed.error, { exit: EXIT.USAGE });

  if (parsed.platform) {
    const api = await request(
      ctx, "GET",
      `/api/apis/${encodeURIComponent(parsed.platform)}/${encodeURIComponent(parsed.slug)}`,
      { auth: "optional", notFoundNull: true }
    );
    if (api) return api;
    throw new DbyError("ENDPOINT_NOT_FOUND", `apis 集合里没有 ${parsed.platform}/${parsed.slug}。`, {
      exit: EXIT.BUSINESS,
      remediation: "跑 `dby api list --apis` 看全部，或 `dby api search <关键词>` 按意图找。"
    });
  }

  const skill = await request(ctx, "GET", `/api/skills/${encodeURIComponent(parsed.slug)}`, {
    auth: "optional", notFoundNull: true
  });
  if (skill) return skill;

  const apis = await request(ctx, "GET", "/api/apis", { auth: "optional" });
  const hits = matchApisBySlug(apis.items, parsed.slug);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new DbyError(
      "AMBIGUOUS_REF",
      `「${parsed.slug}」在多个平台下都有，请写全 <platform>/<slug>：` +
        hits.map((item) => `${item.platform}/${item.slug}`).join(" / "),
      { exit: EXIT.BUSINESS }
    );
  }
  throw new DbyError("NOT_FOUND", `两个集合都查过了（operationKey 与 slug 都查过），没有「${parsed.slug}」这条能力。`, {
    exit: EXIT.BUSINESS,
    remediation:
      "它可能是技能包目录名而不是调用 slug；跑 `dby api search <关键词>` 按意图找，或 `dby api list` 看全部；也可能它已经下架了。"
  });
}

export async function apiList(ctx, opts) {
  const wantSkills = !opts.apis;
  const wantApis = !opts.skills;
  const data = {};
  const lines = [];
  if (wantSkills) {
    const d = await request(ctx, "GET", "/api/skills", { auth: "optional" });
    data.skills = { total: d.total ?? (d.items ?? []).length, items: d.items ?? [] };
    lines.push(`# 产品化 Skill（${data.skills.total} 条）`, ...rows(data.skills.items));
  }
  if (wantApis) {
    const d = await request(ctx, "GET", "/api/apis", { auth: "optional" });
    data.apis = { total: d.total ?? (d.items ?? []).length, items: d.items ?? [] };
    if (wantSkills) lines.push("");
    lines.push(`# 平台数据能力（${data.apis.total} 条）`, ...rows(data.apis.items));
  }
  return { data, human: lines.join("\n") };
}

export async function apiSearch(ctx, query) {
  // skills 侧有服务端打分的搜索接口；apis 侧没有，本地按 slug/title/summary/tags 过滤。
  const skills = await request(ctx, "GET", `/api/skills/search?query=${encodeURIComponent(query)}`, {
    auth: "optional"
  });
  const apis = await request(ctx, "GET", "/api/apis", { auth: "optional" });
  const apiHits = (apis.items ?? []).filter((item) => matchesQuery(item, query));
  const data = { skills: { items: skills.items ?? [] }, apis: { items: apiHits } };
  if (!data.skills.items.length && !apiHits.length) warn(ctx, "两个集合都没搜到。换个词，或跑 `dby api list` 通览。");
  const lines = [
    `# 产品化 Skill 命中 ${data.skills.items.length} 条`, ...rows(data.skills.items),
    "", `# 平台数据能力命中 ${apiHits.length} 条`, ...rows(apiHits)
  ];
  return { data, human: lines.join("\n") };
}

export async function apiDescribe(ctx, ref) {
  const capability = await resolveCapability(ctx, ref);
  const target = resolveTarget(capability);
  warn(ctx, target.error ? `[调用路径] ${target.error}` : `[调用路径] ${target.method} ${target.path}`);
  // describe 的人类形态也给完整 JSON —— 入参规格就是要被逐字读的（入参一律现拉）。
  return { data: capability, human: JSON.stringify(capability, null, 2) };
}

export async function apiInvoke(ctx, ref, bodyRaw, opts) {
  getKey(ctx); // invoke 必须有 key，早失败早报错
  let body = {};
  if (bodyRaw) {
    try {
      body = JSON.parse(bodyRaw);
    } catch {
      throw new DbyError("USAGE", "入参不是合法 JSON。示例: '{\"keyword\":\"美食\"}'", { exit: EXIT.USAGE });
    }
  }
  const capability = await resolveCapability(ctx, ref);
  const target = resolveTarget(capability);
  if (target.error) throw new DbyError("CAPABILITY_UNAVAILABLE", target.error, { exit: EXIT.BUSINESS });

  const price = priceLabel(capability);
  // 🔴 确认协议只放过**可证明免费**的能力；标价的和标不出价的（"?"）都要 --confirm。
  //    发现/解析动作（上面的 GET）全部免费，走到这里还没有产生任何服务端副作用。
  if (price !== "免费") {
    billable(ctx, [{
      action: "invoke",
      ref: capability.platform ? `${capability.platform}/${capability.slug}` : capability.slug,
      title: capability.title ?? null,
      price,
      method: target.method,
      path: target.path
    }]);
  }

  const data = await request(ctx, target.method, target.path, {
    body,
    auth: "required",
    timeoutMs: INVOKE_TIMEOUT_MS,
    billable: price !== "免费"
  });
  const out = opts.raw ? data : stripRaw(data);
  return { data: out, human: JSON.stringify(out, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
// invoke 打哪条路由取决于目标能力落在两个集合的哪一边（generic Skill 走
// /api/skills/:slug/invoke，平台数据能力走 /api/apis/:platform/:slug/call），
// describe/invoke 解析 ref 时也可能先打 /api/skills、/api/apis 两份清单或
// /api/skills/:slug、/api/apis/:platform/:slug 两条详情 —— 四条命令天然 composite。

/** `api validate <ref> [body]`：免费预检入参（POST /api/capabilities/:operationKey/validate）。
 *  服务端只对在 schemas 包里有真 zod schema 的能力放行，没有的返回 422 CAPABILITY_VALIDATION_UNSUPPORTED——
 *  那不是「入参错」，是「这条能力没法预检」，映射成业务态 3 并在 remediation 里说清。 */
export async function apiValidate(ctx, ref, bodyRaw) {
  const capability = await resolveCapability(ctx, ref);
  const operationKey = capability?.operationKey;
  if (!operationKey) {
    throw new DbyError("NO_OPERATION_KEY", `「${ref}」的详情里没有 operationKey，无法预检。`, { exit: EXIT.BUSINESS });
  }
  let input = {};
  if (bodyRaw !== undefined) {
    try { input = JSON.parse(bodyRaw); } catch {
      throw new DbyError("USAGE", "body 不是合法 JSON。", { exit: EXIT.USAGE });
    }
  }
  const data = await request(ctx, "POST", `/api/capabilities/${encodeURIComponent(operationKey)}/validate`, {
    body: { input },
    hints: { CAPABILITY_VALIDATION_UNSUPPORTED: "这条能力没有可预检的入参规格；直接 `dby api describe` 照示例填，然后 invoke。" }
  });
  const lines = [data.valid ? "✅ 入参通过预检" : "❌ 入参未通过预检"];
  for (const issue of data.issues ?? []) lines.push(`  · ${issue.path ?? ""} ${issue.message ?? JSON.stringify(issue)}`.trimEnd());
  return { data, human: lines.join("\n") };
}

/** `api recommend <query...>`：让服务端按意图推荐能力（POST /api/skills/recommend，免费免 key）。 */
export async function apiRecommend(ctx, query, { category, limit } = {}) {
  const body = { query };
  if (category) body.category = category;
  if (limit) body.limit = Number(limit);
  const data = await request(ctx, "POST", "/api/skills/recommend", { body, auth: "optional" });
  const lines = [];
  if (data.primary) lines.push(`首选：${data.primary.slug ?? ""}  ${data.primary.title ?? ""}`.trimEnd());
  for (const c of data.candidates ?? []) lines.push(`  候选：${c.slug ?? ""}  ${c.title ?? ""}`.trimEnd());
  if (data.decisionSummary) lines.push(String(data.decisionSummary));
  return { data, human: lines.join("\n") || "（无推荐）" };
}

export const commands = [
  {
    group: "api", name: "list",
    summary: "拉能力清单（默认两个集合都拉）",
    args: [],
    flags: {
      skills: { summary: "只拉产品化 Skill 集合" },
      apis: { summary: "只拉平台数据能力集合" }
    },
    routes: [
      { method: "GET", path: "/api/skills" },
      { method: "GET", path: "/api/apis" }
    ],
    billable: false, destructive: false, composite: true,
    run: (ctx, { flags }) => apiList(ctx, { skills: flags.skills, apis: flags.apis })
  },
  {
    group: "api", name: "search",
    summary: "按关键词搜（两个集合都搜）",
    args: [{ name: "query", required: true, variadic: true }],
    flags: {},
    routes: [
      { method: "GET", path: "/api/skills/search" },
      { method: "GET", path: "/api/apis" }
    ],
    billable: false, destructive: false, composite: true,
    run: (ctx, { args }) => apiSearch(ctx, args.query.join(" "))
  },
  {
    group: "api", name: "describe",
    summary: "看单条能力的入参/出参/调用路径（入参一律现拉，别照记忆拼）",
    args: [{ name: "ref", required: true }],
    flags: {},
    routes: [
      { method: "GET", path: "/api/skills" },
      { method: "GET", path: "/api/apis" },
      { method: "GET", path: "/api/skills/:slug" },
      { method: "GET", path: "/api/apis/:platform/:slug" }
    ],
    billable: false, destructive: false, composite: true,
    run: (ctx, { args }) => apiDescribe(ctx, args.ref)
  },
  {
    group: "api", name: "invoke",
    summary: "调一条能力。计费能力默认停在 confirmation_required（退出码 6），--confirm 放行",
    args: [{ name: "ref", required: true }, { name: "body", required: false }],
    flags: { raw: { summary: "保留响应里与 items/content 重复的 raw" } },
    routes: [
      { method: "GET", path: "/api/skills" },
      { method: "GET", path: "/api/apis" },
      { method: "GET", path: "/api/skills/:slug" },
      { method: "GET", path: "/api/apis/:platform/:slug" },
      { method: "POST", path: "/api/skills/:slug/invoke" },
      { method: "POST", path: "/api/apis/:platform/:slug/call" }
    ],
    // 🔴 unitPrice 因能力而异，不能静态判「这条命令免费」——保守标 billable，闸与文档按「可能计费」处理。
    billable: true, destructive: false, composite: true,
    run: (ctx, { args, flags }) => apiInvoke(ctx, args.ref, args.body, { raw: flags.raw })
  }
  ,{
    group: "api", name: "validate",
    summary: "免费预检入参（只对有真 schema 的能力可用；422 不是入参错，是不可预检）",
    args: [{ name: "ref", required: true }, { name: "body", required: false }],
    flags: {},
    routes: [
      { method: "GET", path: "/api/skills" },
      { method: "GET", path: "/api/apis" },
      { method: "GET", path: "/api/skills/:slug" },
      { method: "GET", path: "/api/apis/:platform/:slug" },
      { method: "POST", path: "/api/capabilities/:operationKey/validate" }
    ],
    billable: false, destructive: false, composite: true,
    run: (ctx, { args }) => apiValidate(ctx, args.ref, args.body)
  },
  {
    group: "api", name: "recommend",
    summary: "按一句意图让服务端推荐能力（免费、免 key）",
    args: [{ name: "query", required: true, variadic: true }],
    flags: {
      category: { value: true, summary: "限定分类" },
      limit: { value: true, summary: "候选条数" }
    },
    routes: [{ method: "POST", path: "/api/skills/recommend" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => apiRecommend(ctx, Array.isArray(args.query) ? args.query.join(" ") : args.query, flags)
  }
];
