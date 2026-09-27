// task.mjs — `dby task list`：点数获取清单（注册赠送/每日登录/每日调用/任务完成态，只读）。
// design: dby-cli-unification 任务 3.2。对接主仓 apps/api/src/modules/tasks/routes.ts；
// 免费、不进 catalog、不扣点，会话或 API key 均可（api-key-route-parity D9）。

import { request } from "../http.mjs";

export async function taskList(ctx) {
  const data = await request(ctx, "GET", "/api/tasks", {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "task", name: "list",
    summary: "点数获取清单：注册赠送/每日登录/每日调用/任务完成态（只读聚合）",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/tasks" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => taskList(ctx)
  }
];
