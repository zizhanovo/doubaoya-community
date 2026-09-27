// usage.mjs — `dby usage summary|balance|logs|log|log-rm|analytics`：用量明细与分析。
// design: dby-cli-unification 任务 3.2、D9（六组放宽之一，含一并放宽的删除 log-rm）。
// 对接主仓 apps/api/src/modules/billing/routes.ts 与 modules/invocation/result-routes.ts；
// 全部免费路由，计费口径零变化；除 log-rm 外全部只读、不套确认协议。

import { request } from "../http.mjs";
import { billable } from "../confirm.mjs";

export async function usageSummary(ctx) {
  const data = await request(ctx, "GET", "/api/usage/summary", {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// 余额与流水概览挂在 /api/billing/summary（agent 常问「我还剩多少点」，语义上归 usage 组）。
export async function usageBalance(ctx) {
  const data = await request(ctx, "GET", "/api/billing/summary", {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function usageLogs(ctx, { q, status, range, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (range) params.set("range", range);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  const data = await request(ctx, "GET", `/api/usage/logs${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function usageLog(ctx, requestId) {
  const data = await request(ctx, "GET", `/api/usage/logs/${encodeURIComponent(requestId)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

/** 删除一条调用结果记录：不可逆，走确认协议（spec:「副作用命令走确认协议」）。 */
export async function usageLogRm(ctx, requestId) {
  billable(ctx, [{ action: "delete", ref: requestId, title: "一条调用结果记录（输入/输出/产物）" }]);
  const data = await request(ctx, "DELETE", `/api/usage/logs/${encodeURIComponent(requestId)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function usageAnalytics(ctx, { range } = {}) {
  const q = new URLSearchParams();
  if (range) q.set("range", range);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/usage/analytics${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "usage", name: "summary",
    summary: "调用数/成功数/已耗点数三个聚合数字",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/usage/summary" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => usageSummary(ctx)
  },
  {
    group: "usage", name: "balance",
    summary: "点数余额与近 30 天流水概览",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/billing/summary" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => usageBalance(ctx)
  },
  {
    group: "usage", name: "logs",
    summary: "调用记录清单，可按关键词/状态/时间范围筛选、分页",
    args: [],
    flags: {
      q: { value: true, summary: "按 operationKey 模糊搜索" },
      status: { value: true, summary: "调用状态过滤（success | pending | failed 等）" },
      range: { value: true, summary: "7d | 30d | 90d | all" },
      limit: { value: true, summary: "每页条数" },
      offset: { value: true, summary: "偏移量" }
    },
    routes: [{ method: "GET", path: "/api/usage/logs" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => usageLogs(ctx, flags)
  },
  {
    group: "usage", name: "log",
    summary: "单条调用的完整输入输出与产物",
    args: [{ name: "requestId", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/usage/logs/:requestId" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => usageLog(ctx, args.requestId)
  },
  {
    group: "usage", name: "log-rm",
    summary: "删除一条调用结果记录（不可逆），默认停在确认态，--confirm 放行",
    args: [{ name: "requestId", required: true }], flags: {},
    routes: [{ method: "DELETE", path: "/api/usage/logs/:requestId" }],
    billable: false, destructive: true, composite: false,
    run: (ctx, { args }) => usageLogRm(ctx, args.requestId)
  },
  {
    group: "usage", name: "analytics",
    summary: "按天聚合的调用量/成功率/延迟/耗点趋势，--range 只接受 7d|30d|90d",
    args: [],
    flags: { range: { value: true, summary: "7d | 30d | 90d，缺省 30d" } },
    routes: [{ method: "GET", path: "/api/usage/analytics" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => usageAnalytics(ctx, { range: flags.range })
  }
];
