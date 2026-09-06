// profile.mjs — `dby profile list|get|create|update|delete|wechat-history|sample-add|sample-list|sample-rm`
// （dby-cli-unification 任务 3.3）。对接主仓 apps/api/src/modules/ip-profile/routes.ts；
// 全部端点免费、不进 catalog、不扣点，鉴权与错误处理复用 lib/http.mjs。
//
// 🔴 主仓没有 `GET /api/ip-profile/:id` 这条路由（只有 PUT/DELETE 认 id）——`get` 只打
//   `GET /api/ip-profile`（默认档案）；要看指定档案，先 `profile list` 拿 id 再自己挑，
//   或直接 `profile update <id>`/`delete <id>` 操作它。
// delete / sample-rm 是不可逆写：destructive:true，走确认协议（confirm.mjs）。

import { readFile } from "node:fs/promises";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { billable } from "../confirm.mjs";

/** create/update 用：JSON 载荷，--body 与 --file 二选一。 */
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

/** sample-add 用：范文正文是纯文本，不是 JSON——--body 与 --file 二选一，原样取字符串。 */
async function readTextContent(flags) {
  const hasBody = flags.body !== undefined;
  const hasFile = flags.file !== undefined;
  if (hasBody && hasFile) {
    throw new DbyError("USAGE", "--body 与 --file 只能给一个。", { exit: EXIT.USAGE });
  }
  if (!hasBody && !hasFile) {
    throw new DbyError("USAGE", "需要 --body '<正文>' 或 --file <md 路径> 之一。", { exit: EXIT.USAGE });
  }
  return hasFile ? await readFile(flags.file, "utf8") : flags.body;
}

export async function profileList(ctx) {
  const { profiles = [] } = await request(ctx, "GET", "/api/ip-profiles", {});
  const human = profiles.length
    ? profiles.map((p) => `${p.id}\t${p.isDefault ? "默认" : "    "}\t${p.name ?? ""}`).join("\n")
    : "# 一个档案都没有";
  return { data: { profiles }, human };
}

export async function profileGet(ctx) {
  const { profile } = await request(ctx, "GET", "/api/ip-profile", {});
  return { data: { profile }, human: profile ? JSON.stringify(profile, null, 2) : "# 还没有默认档案" };
}

export async function profileCreate(ctx, flags) {
  const body = await readJsonBody(flags);
  const { profile } = await request(ctx, "POST", "/api/ip-profile", { body });
  return { data: { profile }, human: JSON.stringify(profile, null, 2) };
}

export async function profileUpdate(ctx, id, flags) {
  const body = await readJsonBody(flags);
  const { profile } = await request(ctx, "PUT", `/api/ip-profile/${encodeURIComponent(id)}`, { body });
  return { data: { profile }, human: JSON.stringify(profile, null, 2) };
}

export async function profileDelete(ctx, id) {
  billable(ctx, [{ action: "delete", ref: id }]);
  const data = await request(ctx, "DELETE", `/api/ip-profile/${encodeURIComponent(id)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function profileWechatHistory(ctx, flags) {
  if (!flags.appid) {
    throw new DbyError("USAGE", "需要 --appid（已授权公众号的 authorizerAppid）。", { exit: EXIT.USAGE });
  }
  const q = new URLSearchParams();
  q.set("authorizerAppid", flags.appid);
  if (flags.count) q.set("count", String(flags.count));
  const data = await request(ctx, "GET", `/api/ip-profile/wechat-history?${q.toString()}`, {});
  const items = data.articles ?? [];
  const human = items.length
    ? `# ${items.length} 篇\n` + items.map((a) => `${a.title ?? ""}\t${a.url ?? ""}`).join("\n")
    : "# 没有拉到历史图文";
  return { data, human };
}

export async function profileSampleAdd(ctx, id, flags) {
  const content = await readTextContent(flags);
  const body = { content };
  if (flags.title) body.title = flags.title;
  if (flags.sourceUrl) body.sourceUrl = flags.sourceUrl;
  const data = await request(ctx, "POST", `/api/ip-profile/${encodeURIComponent(id)}/samples`, { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function profileSampleList(ctx, id) {
  const data = await request(ctx, "GET", `/api/ip-profile/${encodeURIComponent(id)}/samples`, {});
  const items = data.samples ?? [];
  const human = items.length
    ? items.map((s) => `${s.id}\t${s.wordCount ?? "?"}字\t${s.title ?? ""}`).join("\n")
    : "# 还没有范文";
  return { data, human };
}

export async function profileSampleRm(ctx, id, sampleId) {
  billable(ctx, [{ action: "delete", ref: sampleId }]);
  const data = await request(
    ctx, "DELETE",
    `/api/ip-profile/${encodeURIComponent(id)}/samples/${encodeURIComponent(sampleId)}`,
    {}
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "profile", name: "list",
    summary: "列出我的全部 IP 档案（id / 是否默认 / 名字）",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/ip-profiles" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => profileList(ctx)
  },
  {
    group: "profile", name: "get",
    summary: "读默认档案（无则 profile:null）；查指定档案先 `profile list` 拿 id",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/ip-profile" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => profileGet(ctx)
  },
  {
    group: "profile", name: "create",
    summary: "建档，--body/--file 二选一给 JSON（name/isDefault/personaJson/productsJson/…）",
    args: [],
    flags: {
      body: { value: true, summary: "JSON 字符串" },
      file: { value: true, summary: "JSON 文件路径，与 --body 二选一" }
    },
    routes: [{ method: "POST", path: "/api/ip-profile" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => profileCreate(ctx, flags)
  },
  {
    group: "profile", name: "update",
    summary: "改档案（部分字段），--body/--file 二选一",
    args: [{ name: "id", required: true }],
    flags: {
      body: { value: true, summary: "JSON 字符串" },
      file: { value: true, summary: "JSON 文件路径，与 --body 二选一" }
    },
    routes: [{ method: "PUT", path: "/api/ip-profile/:id" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => profileUpdate(ctx, args.id, flags)
  },
  {
    group: "profile", name: "delete",
    summary: "删档案（不可逆，级联删该档案下的范文与文档）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "DELETE", path: "/api/ip-profile/:id" }],
    billable: true, destructive: true, composite: false,
    run: (ctx, { args }) => profileDelete(ctx, args.id)
  },
  {
    group: "profile", name: "wechat-history",
    summary: "拉授权公众号的历史图文当范文候选（免费、不落库）",
    args: [],
    flags: {
      appid: { value: true, summary: "必填：已授权公众号的 authorizerAppid" },
      count: { value: true, summary: "拉取篇数，1-20，默认 5" }
    },
    routes: [{ method: "GET", path: "/api/ip-profile/wechat-history" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => profileWechatHistory(ctx, flags)
  },
  {
    group: "profile", name: "sample-add",
    summary: "录入一篇范文，正文用 --body/--file 二选一（纯文本，非 JSON）",
    args: [{ name: "id", required: true }],
    flags: {
      title: { value: true, summary: "标题（可选）" },
      "source-url": { value: true, summary: "原文链接（可选）" },
      body: { value: true, summary: "正文字符串" },
      file: { value: true, summary: "正文所在的 md/txt 文件路径，与 --body 二选一" }
    },
    routes: [{ method: "POST", path: "/api/ip-profile/:id/samples" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => profileSampleAdd(ctx, args.id, flags)
  },
  {
    group: "profile", name: "sample-list",
    summary: "列出该档案下全部范文（含正文全文）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/ip-profile/:id/samples" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => profileSampleList(ctx, args.id)
  },
  {
    group: "profile", name: "sample-rm",
    summary: "删一篇范文（不可逆）",
    args: [{ name: "id", required: true }, { name: "sampleId", required: true }], flags: {},
    routes: [{ method: "DELETE", path: "/api/ip-profile/:id/samples/:sampleId" }],
    billable: true, destructive: true, composite: false,
    run: (ctx, { args }) => profileSampleRm(ctx, args.id, args.sampleId)
  }
];
