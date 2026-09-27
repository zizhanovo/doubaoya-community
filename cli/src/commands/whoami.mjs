// whoami.mjs — `dby whoami`：本机这把 key 属于哪个账号、来自哪一层（env / credentials）。
// 单条命令、无子命令名。对接主仓 apps/api/src/modules/agent/routes.ts 的 GET /api/agent/whoami；免费。
// 🔴 输出只含账号标识、key 前缀与来源，不含完整 key（spec dby-cli-auth「凭证文件与 key 不外泄」）。

import { request } from "../http.mjs";
import { keyPrefixOf } from "../credentials.mjs";

export async function whoami(ctx) {
  const server = await request(ctx, "GET", "/api/agent/whoami", {});
  const data = { ...server, keySource: ctx.keySource, keyPrefix: keyPrefixOf(ctx.key) };
  const human = [
    `账号：${server?.user?.email ?? server?.user?.id ?? "(未知)"}`,
    `key：${data.keyPrefix}（来源：${ctx.keySource === "credentials" ? "~/.doubaoya/credentials" : "环境变量 DOUBAOYA_API_KEY"}）`
  ].join("\n");
  return { data, human };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: null, name: "whoami",
    summary: "本机 key 对应哪个账号：{ user: { id, email }, authVia, keySource, keyPrefix }（不含完整 key）",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/agent/whoami" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => whoami(ctx)
  }
];
