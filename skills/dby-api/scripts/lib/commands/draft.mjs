// draft.mjs — `dby draft create|get|list|version|versions|review-packet|precheck|submit|
// decide|merge|comment|comments|star|link`（迁移自旧 skills/dby-api/scripts/doubaoya.mjs 的
// 稿件面；design: draft-review-workbench、dby-cli-unification 任务 3.1）。
// 对接主仓 apps/api/src/modules/drafts/routes.ts；全部端点免费、不进 catalog、不扣点，
// 同一把 DOUBAOYA_API_KEY，鉴权与错误处理复用 lib/http.mjs。
//
// 与旧脚本的退出码语义差异：旧脚本一律 exit 1；这里按 dby-cli 契约重映射——
// 入参形状错 → USAGE(2)，precheck/submit 本地预检不过 → CHANGES_INVALID 业务态(3)。
// ponytail：旧脚本的 `--stdin`（从标准输入读 JSON）未迁移，正文一律走位置参数；
// 升级路径 = 有真实需求时在 argv.mjs 里加一种「读 stdin 的位置参数」标记。
//
// decide 的 JSON body 走 --body/--file（二选一，都给/都不给 → USAGE）而不是位置参数——
// decisions[] 常常比 create/submit 的整篇正文更适合从文件读（agent 批量裁决时先落盘）。

import { readFileSync } from "node:fs";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { draftPrecheckChanges } from "../draft-core.mjs";

function parseBody(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new DbyError("USAGE", "入参不是合法 JSON。", { exit: EXIT.USAGE });
  }
}

/** --body '<json>' 与 --file <path> 二选一，解出 JSON 对象。都给/都不给 → USAGE(2)。 */
function bodyFromFlags(flags) {
  if (flags.body !== undefined && flags.file !== undefined) {
    throw new DbyError("USAGE", "--body 与 --file 二选一，不能同时给。", { exit: EXIT.USAGE });
  }
  if (flags.file !== undefined) {
    let raw;
    try {
      raw = readFileSync(flags.file, "utf8");
    } catch (err) {
      throw new DbyError("USAGE", `读取 --file ${flags.file} 失败：${err.message}`, { exit: EXIT.USAGE });
    }
    return parseBody(raw);
  }
  if (flags.body !== undefined) return parseBody(flags.body);
  throw new DbyError("USAGE", "缺少入参：给 --body '<json>' 或 --file <path>。", { exit: EXIT.USAGE });
}

function printableErrors(errors) {
  return errors.map((e) => `[${e.code}] 第 ${e.index + 1} 条: ${e.message}`).join("\n");
}

export async function draftCreate(ctx, bodyRaw) {
  const data = await request(ctx, "POST", "/api/drafts", { body: parseBody(bodyRaw) });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftGet(ctx, id) {
  const data = await request(ctx, "GET", `/api/drafts/${encodeURIComponent(id)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftVersion(ctx, id, version) {
  const data = await request(ctx, "GET", `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftReviewPacket(ctx, id) {
  const data = await request(ctx, "GET", `/api/drafts/${encodeURIComponent(id)}/review-packet`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

/** 纯本地：不联网、不需要 key（不走 request()，getKey 也不会被触发）。 */
export function draftPrecheck(bodyRaw) {
  const body = parseBody(bodyRaw);
  if (typeof body.bodyMd !== "string") {
    throw new DbyError("USAGE", "precheck 需要 bodyMd（基准版正文字符串）。", { exit: EXIT.USAGE });
  }
  if (!Array.isArray(body.changes)) {
    throw new DbyError("USAGE", "precheck 需要 changes[]（改动清单）。", { exit: EXIT.USAGE });
  }
  const errors = draftPrecheckChanges(body.bodyMd, body.changes);
  if (errors.length > 0) {
    throw new DbyError(
      "CHANGES_INVALID",
      `预检未通过：${errors.length} 处问题，未发送任何请求。\n${printableErrors(errors)}`,
      { exit: EXIT.BUSINESS }
    );
  }
  const human = `precheck ok: ${body.changes.length} 条改动全部可定位、互不重叠、理由齐全`;
  return { data: { ok: true, count: body.changes.length }, human };
}

export async function draftSubmit(ctx, id, bodyRaw) {
  const body = parseBody(bodyRaw);
  if (!Number.isInteger(body.baseVersion)) {
    throw new DbyError("USAGE", "submit 需要 baseVersion（整数）：你基于哪一版改的。", { exit: EXIT.USAGE });
  }
  if (Array.isArray(body.changes)) {
    // 🔴 先本地预检再发请求：清单整单拒收是服务端的既有行为，本地拦下只是少挨一次 422、
    //   少读一遍 SKILL 就知道该改哪一条。这一步会多打一条 GET（读基准版正文）。
    const base = await request(ctx, "GET", `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(body.baseVersion)}`, {});
    const errors = draftPrecheckChanges(base.bodyMd, body.changes);
    if (errors.length > 0) {
      throw new DbyError(
        "CHANGES_INVALID",
        `本地预检未通过：${errors.length} 处问题，服务端会整单拒收，已提前拦下，未发送写请求。\n${printableErrors(errors)}`,
        { exit: EXIT.BUSINESS }
      );
    }
  }
  const data = await request(ctx, "POST", `/api/drafts/${encodeURIComponent(id)}/versions`, { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftComment(ctx, id, bodyRaw) {
  const data = await request(ctx, "POST", `/api/drafts/${encodeURIComponent(id)}/comments`, { body: parseBody(bodyRaw) });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftList(ctx, { project } = {}) {
  const q = new URLSearchParams();
  if (project) q.set("projectId", project);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/drafts${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftVersions(ctx, id) {
  const data = await request(ctx, "GET", `/api/drafts/${encodeURIComponent(id)}/versions`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftDecide(ctx, id, version, flags) {
  const body = bodyFromFlags(flags);
  if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
    throw new DbyError("USAGE", "decide 需要 decisions[]（[{changeId, decision: accept|reject, note?}]）。", { exit: EXIT.USAGE });
  }
  const data = await request(
    ctx, "PUT",
    `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/decisions`,
    { body }
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftMerge(ctx, id, version, base) {
  if (!/^\d+$/.test(String(base ?? ""))) {
    throw new DbyError("USAGE", "merge 需要 --base <baseVersion>（整数）：合并基于当前最新版。", { exit: EXIT.USAGE });
  }
  const data = await request(
    ctx, "POST",
    `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/merge`,
    { body: { baseVersion: Number(base) } }
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftComments(ctx, id, { version, status } = {}) {
  const q = new URLSearchParams();
  if (version !== undefined) q.set("version", String(version));
  if (status) q.set("status", status);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/drafts/${encodeURIComponent(id)}/comments${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftStar(ctx, id, version, { on, off, note } = {}) {
  if (!!on === !!off) {
    throw new DbyError("USAGE", "star 需要且只能给 --on 或 --off 其中一个。", { exit: EXIT.USAGE });
  }
  let body;
  if (on) {
    if (!note || !note.trim()) {
      throw new DbyError("USAGE", "--on 需要 --note：这版好在哪（一句话，≤80 字）。", { exit: EXIT.USAGE });
    }
    body = { starred: true, note: note.trim() };
  } else {
    body = { starred: false };
  }
  const data = await request(
    ctx, "PUT",
    `/api/drafts/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/star`,
    { body }
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function draftLink(ctx, id, { article, version } = {}) {
  if (!article) {
    throw new DbyError("USAGE", "link 需要 --article <文章 id>。", { exit: EXIT.USAGE });
  }
  const body = { articleId: article };
  if (version !== undefined) body.version = Number(version);
  const data = await request(ctx, "POST", `/api/drafts/${encodeURIComponent(id)}/link-article`, { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "draft", name: "create",
    summary: "建稿，字段 title/bodyMd/author?/projectId?/summary?",
    args: [{ name: "json", required: true }], flags: {},
    routes: [{ method: "POST", path: "/api/drafts" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftCreate(ctx, args.json)
  },
  {
    group: "draft", name: "get",
    summary: "稿件 + 版本清单 + 待处理评论数",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/drafts/:id" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftGet(ctx, args.id)
  },
  {
    group: "draft", name: "version",
    summary: "读某版正文 + 改动清单 + 裁决",
    args: [{ name: "id", required: true }, { name: "version", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/drafts/:id/versions/:v" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftVersion(ctx, args.id, args.version)
  },
  {
    group: "draft", name: "review-packet",
    summary: "agent 唯一要读的入口：最新版 + 待处理评论 + 新拒绝 + 星标",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/drafts/:id/review-packet" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftReviewPacket(ctx, args.id)
  },
  {
    group: "draft", name: "precheck",
    summary: "离线预检 changes[]（不联网、不需要 key），字段 bodyMd/changes",
    args: [{ name: "json", required: true }], flags: {},
    routes: [], billable: false, destructive: false, composite: true,
    run: (ctx, { args }) => draftPrecheck(args.json)
  },
  {
    group: "draft", name: "submit",
    summary: "交新版，changes[] 会先本地预检再发；字段见调用方包的 api-contract.md",
    args: [{ name: "id", required: true }, { name: "json", required: true }], flags: {},
    routes: [{ method: "POST", path: "/api/drafts/:id/versions" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftSubmit(ctx, args.id, args.json)
  },
  {
    group: "draft", name: "comment",
    summary: "划词评论 / 回复，字段 body/author?/parentId? 或 version?+anchor?",
    args: [{ name: "id", required: true }, { name: "json", required: true }], flags: {},
    routes: [{ method: "POST", path: "/api/drafts/:id/comments" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftComment(ctx, args.id, args.json)
  },
  {
    group: "draft", name: "list",
    summary: "本人全部稿件清单（head 版摘要 + 血缘条数），可用 --project 过滤",
    args: [],
    flags: { project: { value: true, summary: "按 IP 档案 id 过滤（projectId）" } },
    routes: [{ method: "GET", path: "/api/drafts" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => draftList(ctx, { project: flags.project })
  },
  {
    group: "draft", name: "versions",
    summary: "某稿件的全部版本清单（不含正文，读某一版正文用 `draft version`）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/drafts/:id/versions" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => draftVersions(ctx, args.id)
  },
  {
    group: "draft", name: "decide",
    summary: "对某版改动清单逐处裁决（批量 upsert），--body/--file 二选一给 {decisions:[{changeId,decision,note?}]}",
    args: [{ name: "id", required: true }, { name: "version", required: true }],
    flags: {
      body: { value: true, summary: "内联 JSON：{decisions:[{changeId,decision,note?}]}" },
      file: { value: true, summary: "从文件读取同上 JSON（与 --body 二选一）" }
    },
    routes: [{ method: "PUT", path: "/api/drafts/:id/versions/:v/decisions" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => draftDecide(ctx, args.id, args.version, flags)
  },
  {
    group: "draft", name: "merge",
    summary: "按裁决把某版改动合并进 head，--base 必填=当前最新版本号（防并发覆盖）",
    args: [{ name: "id", required: true }, { name: "version", required: true }],
    flags: { base: { value: true, summary: "当前最新版本号（baseVersion）" } },
    routes: [{ method: "POST", path: "/api/drafts/:id/versions/:v/merge" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => draftMerge(ctx, args.id, args.version, flags.base)
  },
  {
    group: "draft", name: "comments",
    summary: "线程化评论（含对指定版本的定位），可用 --version/--status 过滤",
    args: [{ name: "id", required: true }],
    flags: {
      version: { value: true, summary: "读哪一版的定位，缺省=当前 head" },
      status: { value: true, summary: "open | addressed" }
    },
    routes: [{ method: "GET", path: "/api/drafts/:id/comments" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => draftComments(ctx, args.id, flags)
  },
  {
    group: "draft", name: "star",
    summary: "星标某版并写反馈卡（--on 需要 --note）或取消星标（--off），二选一必给",
    args: [{ name: "id", required: true }, { name: "version", required: true }],
    flags: {
      on: { summary: "星标（需要 --note）" },
      off: { summary: "取消星标" },
      note: { value: true, summary: "这版好在哪，一句话 ≤80 字（配合 --on）" }
    },
    routes: [{ method: "PUT", path: "/api/drafts/:id/versions/:v/star" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => draftStar(ctx, args.id, args.version, flags)
  },
  {
    group: "draft", name: "link",
    summary: "把稿件关联到已发布文章，--article 必填",
    args: [{ name: "id", required: true }],
    flags: {
      article: { value: true, summary: "文章 id（articleId）" },
      version: { value: true, summary: "关联哪一版，缺省=当前 head" }
    },
    routes: [{ method: "POST", path: "/api/drafts/:id/link-article" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => draftLink(ctx, args.id, flags)
  }
];
