// retro.mjs — `dby retro`：复盘（已发布文章 + 指标 + 结论回流），只读聚合。
// 单条命令、无子命令名（design D9 六组放宽之一；单级命令形状同 doctor/routes/whoami 先例）。
// 对接主仓 apps/api/src/modules/articles/retro-routes.ts；免费、不进 catalog、不扣点。

import { request } from "../http.mjs";

export async function retro(ctx, { appid, limit } = {}) {
  const q = new URLSearchParams();
  if (appid) q.set("appid", appid);
  if (limit !== undefined) q.set("limit", String(limit));
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/retro${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: null, name: "retro",
    summary: "复盘：已发布文章 + 指标 + 结论回流（只读聚合），可用 --appid/--limit 过滤",
    args: [],
    flags: {
      appid: { value: true, summary: "按公众号 appid 过滤，缺省取已授权账号" },
      limit: { value: true, summary: "最多几篇，1-100，缺省 50" }
    },
    routes: [{ method: "GET", path: "/api/retro" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => retro(ctx, { appid: flags.appid, limit: flags.limit })
  }
];
