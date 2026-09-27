// doc.mjs — `dby doc list|get|patch|put|revisions|revision|restore`
// （dby-cli-unification 任务 3.3）。对接主仓 apps/api/src/modules/ip-profile/document-routes.ts
// 的统一文档模型：docKey 是档案下的一份具名文档（如 positioning/audience/…）。全部免费、
// 不进 catalog、不扣点；创建/修改类免费写入不套确认协议（design.md D2/D5、spec「副作用命令走
// 确认协议」——章程/文档改动明确排除在外）。
//
// 🔴 乐观锁分级（同主仓 document-routes.ts 的注释口径）：
//   PATCH（Merge Patch，只动传的键）不强制 baseVersion；PUT（全量替换）与 restore（回滚）
//   强制要求，本地先挡（USAGE 2），别等服务端 400 才发现漏传。
//   PUT/restore 撞版本（409 VERSION_CONFLICT）时，lib/http.mjs 的 upstreamError 已把非 5xx
//   上游错误统一映射成 BUSINESS(3)——这里只需要补一条 hints，指路「先 get 拿最新版本再重试」。
//
// ponytail：PUT 只支持结构化 --body/--file（JSON），不支持主仓 `markdown` 字段那种原文整段
// 提交；agent 侧目前都是结构化改字段，真出现要交 Markdown 原文的需求再加 --markdown-file。

import { readFile } from "node:fs/promises";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";

const VERSION_CONFLICT_HINT = {
  VERSION_CONFLICT: "版本已变，先 `dby doc get <id> <docKey>` 拿最新 version，把改动重新应用后再提交。"
};

/** patch/put 用：JSON 载荷，--body 与 --file 二选一。 */
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

/** --base/--to 之类的版本号 flag：必填、必须是整数，否则 USAGE(2)。 */
function requireVersionFlag(flags, key, flagName, hint) {
  const raw = flags[key];
  if (raw === undefined) {
    throw new DbyError("USAGE", `需要 --${flagName} <version>（${hint}）。`, { exit: EXIT.USAGE });
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new DbyError("USAGE", `--${flagName} 必须是整数版本号，收到「${raw}」。`, { exit: EXIT.USAGE });
  }
  return n;
}

export async function docList(ctx, id) {
  const data = await request(ctx, "GET", `/api/ip-profile/${encodeURIComponent(id)}/documents`, {});
  const items = data.documents ?? [];
  const human = items
    .map((d) => `${d.docKey}\tv${d.version}\t${d.updatedBy ?? "-"}\t${d.updatedAt ?? "-"}`)
    .join("\n");
  return { data, human };
}

export async function docGet(ctx, id, docKey) {
  const data = await request(
    ctx, "GET",
    `/api/ip-profile/${encodeURIComponent(id)}/documents/${encodeURIComponent(docKey)}`,
    {}
  );
  const human = `# ${docKey}  v${data.version}  ${data.updatedBy ?? "-"}\n${JSON.stringify(data.content, null, 2)}`;
  return { data, human };
}

export async function docPatch(ctx, id, docKey, flags) {
  const patch = await readJsonBody(flags);
  const body = flags.base !== undefined ? { baseVersion: Number(flags.base), patch } : patch;
  const data = await request(
    ctx, "PATCH",
    `/api/ip-profile/${encodeURIComponent(id)}/documents/${encodeURIComponent(docKey)}`,
    { body, hints: VERSION_CONFLICT_HINT }
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function docPut(ctx, id, docKey, flags) {
  const baseVersion = requireVersionFlag(flags, "base", "base", "先 `dby doc get` 拿到的当前 version");
  const content = await readJsonBody(flags);
  const data = await request(
    ctx, "PUT",
    `/api/ip-profile/${encodeURIComponent(id)}/documents/${encodeURIComponent(docKey)}`,
    { body: { baseVersion, content }, hints: VERSION_CONFLICT_HINT }
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function docRevisions(ctx, id, docKey) {
  const data = await request(
    ctx, "GET",
    `/api/ip-profile/${encodeURIComponent(id)}/documents/${encodeURIComponent(docKey)}/revisions`,
    {}
  );
  const items = data.revisions ?? [];
  const human = items.length
    ? items.map((r) => `v${r.version}\t${r.updatedBy ?? "-"}\t${r.summary ?? ""}\t${r.createdAt ?? ""}`).join("\n")
    : "# 还没有历史版本";
  return { data, human };
}

export async function docRevision(ctx, id, docKey, version) {
  const data = await request(
    ctx, "GET",
    `/api/ip-profile/${encodeURIComponent(id)}/documents/${encodeURIComponent(docKey)}/revisions/${encodeURIComponent(version)}`,
    {}
  );
  return { data, human: JSON.stringify(data.content, null, 2) };
}

export async function docRestore(ctx, id, docKey, flags) {
  const target = requireVersionFlag(flags, "to", "to", "要回到的历史版本号");
  const baseVersion = requireVersionFlag(flags, "base", "base", "当前基准版本号，防并发覆盖");
  const data = await request(
    ctx, "POST",
    `/api/ip-profile/${encodeURIComponent(id)}/documents/${encodeURIComponent(docKey)}/restore`,
    { body: { version: target, baseVersion }, hints: VERSION_CONFLICT_HINT }
  );
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "doc", name: "list",
    summary: "列出该档案下全部文档（含未写过的，version=0）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/ip-profile/:id/documents" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => docList(ctx, args.id)
  },
  {
    group: "doc", name: "get",
    summary: "读一份文档（未写过时 content:null、version:0，不是 404）",
    args: [{ name: "id", required: true }, { name: "docKey", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/ip-profile/:id/documents/:docKey" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => docGet(ctx, args.id, args.docKey)
  },
  {
    group: "doc", name: "patch",
    summary: "Merge Patch 定点改字段，--body/--file 二选一给要改的键；--base 可选乐观锁",
    args: [{ name: "id", required: true }, { name: "docKey", required: true }],
    flags: {
      body: { value: true, summary: "JSON 字符串（只需给要改的键）" },
      file: { value: true, summary: "JSON 文件路径，与 --body 二选一" },
      base: { value: true, summary: "可选：基于的版本号，撞了返回 409/退出码 3" }
    },
    routes: [{ method: "PATCH", path: "/api/ip-profile/:id/documents/:docKey" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => docPatch(ctx, args.id, args.docKey, flags)
  },
  {
    group: "doc", name: "put",
    summary: "全量替换整份文档，必须带 --base <version>；--body/--file 二选一给完整内容",
    args: [{ name: "id", required: true }, { name: "docKey", required: true }],
    flags: {
      body: { value: true, summary: "JSON 字符串（完整文档）" },
      file: { value: true, summary: "JSON 文件路径，与 --body 二选一" },
      base: { value: true, summary: "必填：先 `dby doc get` 拿到的当前 version" }
    },
    routes: [{ method: "PUT", path: "/api/ip-profile/:id/documents/:docKey" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => docPut(ctx, args.id, args.docKey, flags)
  },
  {
    group: "doc", name: "revisions",
    summary: "历史版本清单（倒序，不含正文）",
    args: [{ name: "id", required: true }, { name: "docKey", required: true }], flags: {},
    routes: [{ method: "GET", path: "/api/ip-profile/:id/documents/:docKey/revisions" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => docRevisions(ctx, args.id, args.docKey)
  },
  {
    group: "doc", name: "revision",
    summary: "取某一历史版本的完整内容",
    args: [
      { name: "id", required: true },
      { name: "docKey", required: true },
      { name: "version", required: true }
    ],
    flags: {},
    routes: [{ method: "GET", path: "/api/ip-profile/:id/documents/:docKey/revisions/:version" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => docRevision(ctx, args.id, args.docKey, args.version)
  },
  {
    group: "doc", name: "restore",
    summary: "回滚到某一历史版本（= 一次新写入，版本号继续递增）；--to 与 --base 都必填",
    args: [{ name: "id", required: true }, { name: "docKey", required: true }],
    flags: {
      to: { value: true, summary: "必填：要回到的历史版本号" },
      base: { value: true, summary: "必填：当前基准版本号，防并发覆盖" }
    },
    routes: [{ method: "POST", path: "/api/ip-profile/:id/documents/:docKey/restore" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => docRestore(ctx, args.id, args.docKey, flags)
  }
];
