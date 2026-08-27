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
} from "../lib/capability.mjs";

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
