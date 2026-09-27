// article.mjs — `dby article list|get`（文章中心：本地草稿/已存草稿箱/已发布，只读）。
// design: dby-cli-unification 任务 3.2、D9（六组放宽之一：requireUserBySessionOrApiKey）。
// 对接主仓 apps/api/src/modules/articles/routes.ts；免费、不进 catalog、不扣点。

import { request } from "../http.mjs";

export async function articleList(ctx, { appid, status, search, page, pageSize } = {}) {
  const q = new URLSearchParams();
  if (appid) q.set("appid", appid);
  if (status) q.set("status", status);
  if (search) q.set("search", search);
  if (page !== undefined) q.set("page", String(page));
  if (pageSize !== undefined) q.set("pageSize", String(pageSize));
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/articles${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function articleGet(ctx, id) {
  const data = await request(ctx, "GET", `/api/articles/${encodeURIComponent(id)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "article", name: "list",
    summary: "文章中心清单（本地草稿/已存草稿箱/已发布），支持筛选与分页",
    args: [],
    flags: {
      appid: { value: true, summary: "按公众号 appid 过滤" },
      status: { value: true, summary: "all | draft | published，缺省 all" },
      search: { value: true, summary: "标题模糊搜索" },
      page: { value: true, summary: "页码，从 1 开始，缺省 1" },
      "page-size": { value: true, summary: "每页条数，1-50，缺省 20" }
    },
    routes: [{ method: "GET", path: "/api/articles" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) =>
      articleList(ctx, { appid: flags.appid, status: flags.status, search: flags.search, page: flags.page, pageSize: flags.pageSize })
  },
  {
    group: "article", name: "get",
    summary: "单篇文章 + 最新正文快照",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/articles/:id" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => articleGet(ctx, args.id)
  }
];
