// whoami.mjs — `dby whoami`：本地 DOUBAOYA_API_KEY 绑定核对（这把 key 到底是哪个账号）。
// 单条命令、无子命令名（design D9 六组放宽之一；单级命令形状同 doctor/routes/retro/upload）。
// 对接主仓 apps/api/src/modules/agent/routes.ts 的 GET /api/agent/whoami；免费、不进 catalog。

import { request } from "../http.mjs";

export async function whoami(ctx) {
  const data = await request(ctx, "GET", "/api/agent/whoami", {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: null, name: "whoami",
    summary: "本地 DOUBAOYA_API_KEY 对应哪个账号：{ user: { id, email }, authVia }",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/agent/whoami" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => whoami(ctx)
  }
];
