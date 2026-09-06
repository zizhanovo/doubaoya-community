// capability.mjs — 能力目录的纯函数层，逐函数移植自 skills/dby-api/scripts/doubaoya.mjs
//（迁移期两边并存；对拍测试钉住行为一致）。行为一个语义都不许漂。
//
// 🔴 平台有**两个不相交的能力集合**，走两条路由，彼此不回落：
//      产品化 Skill  → POST /api/skills/<slug>/invoke
//      平台数据能力  → POST /api/apis/<platform>/<slug>/call
//    所以 invoke 绝不自己拼路径：先拿到该能力的 `execution.target`，照它给的 method+path 打。

/** 一条能力对象 → 它的完整调用路径。目录是单一事实源；下架/维护中的能力没有 target。 */
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

/** operationKey 形如 `api.trend.hotSpotKeyword`：带点、不带斜杠。 */
export function isOperationKey(ref) {
  return typeof ref === "string" && /^[a-z]+(\.[A-Za-z0-9]+)+$/.test(ref.trim()) && !ref.includes("/");
}

/** 在两个集合的清单里按 operationKey 反查；撞名时全部返回（已知有一处撞名）。 */
export function matchByOperationKey(skillItems, apiItems, key) {
  return [...(skillItems ?? []), ...(apiItems ?? [])].filter((item) => item.operationKey === key);
}

/** 响应 data 里 `raw` 是上游原样回包，和 items/content 重复；默认剥掉，--raw 才保留。不改入参。 */
export function stripRaw(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (!("raw" in data) || !("items" in data || "content" in data)) return data;
  const { raw: _raw, ...rest } = data;
  return rest;
}

/** 计费标签：unitPrice 是 0 / priceClass 是 free ⇒ 免费；否则 N点；缺字段标「?」。 */
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

/** 在 apis 清单里按裸 slug 找。同名跨平台可能，返回全部命中让调用方要求写全 ref。 */
export function matchApisBySlug(items, slug) {
  return (items ?? []).filter((item) => item.slug === slug);
}

/** 本地关键词过滤（apis 侧没有服务端搜索）。 */
export function matchesQuery(item, query) {
  const haystack = [item.slug, item.platform, item.title, item.summary, ...(item.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/** list/search 的行渲染要用的调用路径列。 */
export function callPath(item) {
  const target = resolveTarget(item);
  return target.error ? "（不可调用）" : `${target.method} ${target.path}`;
}
