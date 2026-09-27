// insp.mjs — `dby insp list|add`（list 迁移自旧 skills/dby-api/scripts/doubaoya.mjs 的
// inspirations 命令；add 是任务 3.4 新增，对接 POST /api/inspirations。灵感库，design:
// inspiration-draft-lineage）。免费、同一把 key，创建类免费写入不套确认协议。
// list 的输出裁成写作用得上的几样（id / type / 一行摘要 / 记录时间 / 去向），媒体字段不吐
// （媒体字节读取仍只认会话，见 dby-cli-unification proposal「Modified Capabilities」）。

import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { warn } from "../output.mjs";

function humanLine(it) {
  const d = new Date(it.createdAt);
  const used = it.usedInDrafts.length
    ? `  → 已进《${it.usedInDrafts[0].title}》${it.usedInDrafts.length > 1 ? ` 等 ${it.usedInDrafts.length} 篇` : ""}`
    : "";
  return `${it.id}  ${d.getMonth() + 1}/${d.getDate()}  [${it.type.replace("feed_", "")}]  ${it.summary}${it.url ? `  ${it.url}` : ""}${used}`;
}

/** 写：记一条灵感（text 或 url 至少一个，服务端 createBody 同款 refine）。 */
export async function inspAdd(ctx, { text, url } = {}) {
  if (!text && !url) {
    throw new DbyError("USAGE", "insp add 需要 --text 或 --url 至少一个。", { exit: EXIT.USAGE });
  }
  const body = {};
  if (text) body.text = text;
  if (url) body.url = url;
  const data = await request(ctx, "POST", "/api/inspirations", { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function inspList(ctx, { since, ids } = {}) {
  if (since !== undefined && !/^\d+$/.test(String(since))) {
    throw new DbyError("USAGE", "--since 要给 1-365 之间的天数。", { exit: EXIT.USAGE });
  }
  const q = new URLSearchParams();
  if (since) q.set("since", String(since));
  if (ids) q.set("ids", ids);
  q.set("limit", "100");
  const data = await request(ctx, "GET", `/api/inspirations?${q.toString()}`, {});
  const items = (data.items ?? []).map((it) => ({
    id: it.id,
    type: it.type,
    summary: String(it.content || it.title || it.url || "").replace(/\s+/g, " ").trim().slice(0, 120),
    url: it.url ?? null,
    createdAt: it.createdAt,
    usedInDrafts: (it.usedInDrafts ?? []).map((u) => ({ draftId: u.draftId, title: u.title }))
  }));
  const out = { requested: data.requested ?? null, returned: data.returned ?? items.length, items };
  if (out.requested !== null && out.returned < out.requested) {
    warn(ctx, `⚠️ 点名 ${out.requested} 条，只拿到 ${out.returned} 条：其余不是你的或已归档，如实告诉用户，别猜。`);
  }
  const lines = [];
  if (items.length === 0) {
    lines.push(since ? `# 近 ${since} 天没有记录` : "# 没有记录");
  } else {
    lines.push(`# 记录 ${items.length} 条（入素材单出处写「记录 · <id> · M/D」，建稿时这些 id 作 sourceItemIds）`);
    for (const it of items) lines.push(humanLine(it));
  }
  return { data: out, human: lines.join("\n") };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "insp", name: "list",
    summary: "读用户记下的东西；写作时入素材单，建稿带 sourceItemIds",
    args: [],
    flags: {
      since: { value: true, summary: "近 N 天（1-365）" },
      ids: { value: true, summary: "逗号分隔的 id 列表" }
    },
    routes: [{ method: "GET", path: "/api/inspirations" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => inspList(ctx, { since: flags.since, ids: flags.ids })
  },
  {
    group: "insp", name: "add",
    summary: "记一条灵感（--text 或 --url 至少一个）",
    args: [],
    flags: {
      text: { value: true, summary: "一句话" },
      url: { value: true, summary: "链接" }
    },
    routes: [{ method: "POST", path: "/api/inspirations" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => inspAdd(ctx, { text: flags.text, url: flags.url })
  }
];
