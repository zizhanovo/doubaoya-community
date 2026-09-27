// material.mjs — `dby material list|get|add|rm`（迁移自 dby-write 的 write.mjs material 子命令；
// design: doubaoya-material-bank）。对接主仓 apps/api/src/modules/knowledge/materials.ts；
// 全部端点免费、不进 catalog、不扣点，鉴权与错误处理复用 lib/http.mjs。
//
// add 只负责把 --body/--file 读成 JSON 转发——卡面校验（proof/event 三要素/evidence/forms
// 的取值与长度硬闸）唯一事实源在服务端（materials.ts 的 validateCard），本文件不重复抄一份，
// 抄一份必然漂移。rm 是硬删（合规要求「不再出现」，archivedAt 不够），destructive:true 走确认协议
// （同 profile.mjs 的 delete/sample-rm 一个形状）。

import { readFile } from "node:fs/promises";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { billable } from "../confirm.mjs";

/** add 用：JSON 载荷，--body 与 --file 二选一（同 profile.mjs 的 readJsonBody）。 */
async function readJsonBody(flags) {
  const hasBody = flags.body !== undefined;
  const hasFile = flags.file !== undefined;
  if (hasBody && hasFile) {
    throw new DbyError("USAGE", "--body 与 --file 只能给一个。", { exit: EXIT.USAGE });
  }
  if (!hasBody && !hasFile) {
    throw new DbyError("USAGE", "需要 --body '<json>' 或 --file <path> 之一。", { exit: EXIT.USAGE });
  }
  const raw = hasFile ? await readFile(flags.file, "utf8") : flags.body;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new DbyError("USAGE", `入参不是合法 JSON：${e.message}`, { exit: EXIT.USAGE });
  }
}

export async function materialList(ctx, opts) {
  const q = new URLSearchParams();
  if (opts.profile) q.set("profileId", opts.profile);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/materials${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function materialGet(ctx, id) {
  const data = await request(ctx, "GET", `/api/materials/${encodeURIComponent(id)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function materialAdd(ctx, flags) {
  const body = await readJsonBody(flags);
  const data = await request(ctx, "POST", "/api/materials", { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function materialRm(ctx, id) {
  billable(ctx, [{ action: "delete", ref: id }]);
  const data = await request(ctx, "DELETE", `/api/materials/${encodeURIComponent(id)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "material", name: "list",
    summary: "素材卡索引 + 既有复盘归因快照（--profile 指定档案，默认用默认档案）",
    args: [],
    flags: { profile: { value: true, summary: "指定档案 id（默认用默认档案）" } },
    routes: [{ method: "GET", path: "/api/materials" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => materialList(ctx, { profile: flags.profile })
  },
  {
    group: "material", name: "get",
    summary: "单卡全文（proof/event 三要素/evidence/forms/label）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/materials/:id" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => materialGet(ctx, args.id)
  },
  {
    group: "material", name: "add",
    summary: "存一张蒸馏卡，--body/--file 二选一给 JSON（proof/kind/event/evidence/forms/label?/articleId?/profileId?）",
    args: [],
    flags: {
      body: { value: true, summary: "卡面 JSON 字符串" },
      file: { value: true, summary: "卡面 JSON 文件路径，与 --body 二选一" }
    },
    routes: [{ method: "POST", path: "/api/materials" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => materialAdd(ctx, flags)
  },
  {
    group: "material", name: "rm",
    summary: "硬删一张卡（不可逆，需 --confirm）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "DELETE", path: "/api/materials/:id" }],
    billable: true, destructive: true, composite: false,
    run: (ctx, { args }) => materialRm(ctx, args.id)
  }
];
