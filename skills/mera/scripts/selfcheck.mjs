#!/usr/bin/env node
// Mera skill 自检 — 零依赖、无框架（Node 18+）
//
//   node scripts/selfcheck.mjs
//
// 做法：起一个本地假网关（node:http），用 DOUBAOYA_BASE_URL 指过去，
// 真的 spawn 一次 scripts/mera.mjs，断言它的 stdout / stderr / 退出码符合契约。
// 场景由「假密钥」选择（服务端读 Authorization 头当场景名），省掉额外的串场线路。

import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "mera.mjs");
const polls = new Map(); // scenario -> 已轮询次数
const seen = []; // 假网关收到的请求：{slug, body}，用来断言脚本算出的窗口参数

const lastBody = (slug) => seen.filter((entry) => entry.slug === slug).at(-1)?.body;

function envelope(data) {
  return { success: true, requestId: "req_selfcheck", data, error: null };
}

function errorEnvelope(code, message) {
  return { success: false, requestId: "req_selfcheck", data: null, error: { code, message } };
}

function searchHit(id, charStart, charEnd) {
  return {
    results: [
      {
        id,
        title: "和老王的一次对话",
        source_type: "note",
        media_type: "text",
        created_at: "2026-07-20",
        snippet: "……决定先做单机版……",
        score: 0.82,
        chunk_id: "chunk_1",
        char_start: charStart,
        char_end: charEnd
      }
    ]
  };
}

function sourceRead(body, extra) {
  return {
    id: body.source_id,
    title: "和老王的一次对话",
    origin_uri: null,
    source_type: "note",
    media_type: "text",
    created_at: "2026-07-20",
    archived_at: null,
    content: "（窗口内的原文）跟老王聊完，决定先做单机版再联网。",
    from: body.from,
    to: body.to,
    content_length: 1234,
    truncated: false,
    ...extra
  };
}

function respond(scenario, slug, body) {
  switch (scenario) {
    case "read-window": // char_start 远大于窗口余量：from = char_start - 500
      if (slug === "note-search") return [200, envelope(searchHit("src_1", 3000, 3400))];
      return [200, envelope(sourceRead(body))];

    case "read-clamp": // char_start < 500：from 必须 clamp 到 0，绝不能是负数
      if (slug === "note-search") return [200, envelope(searchHit("src_2", 120, 400))];
      return [200, envelope(sourceRead(body))];

    case "read-archived": // 按 id 直读是唯一能读到归档源的路径
      return [200, envelope(sourceRead(body, { archived_at: "2026-07-25T10:00:00Z" }))];

    case "read-truncated":
      // 服务端行为：content = full.slice(from, to) 再砍到 20000；`to` 原样回显请求值（不是实际终点）
      return [
        200,
        envelope(
          sourceRead(body, {
            content: `单机版${"x".repeat(19997)}`, // 恰好 20000 字
            truncated: true,
            content_length: 65000
          })
        )
      ];

    case "read-past-end":
      // 服务端行为：from 越过全文末尾 → full.slice(from,to) === ""，照样 200（不是 404）
      return [200, envelope(sourceRead(body, { content: "", content_length: 65000, truncated: false }))];

    case "validation":
      return [400, errorEnvelope("VALIDATION_ERROR", "q 不能为空")];

    case "provider":
      return [502, errorEnvelope("PROVIDER_FAILED", "上游临时失败，额度已退回")];

    case "thin-envelope": // success=true 但没有 data：防御式读取不许崩栈
      return [200, { success: true, requestId: "req_selfcheck" }];

    case "poll-done": {
      if (slug === "note-write") return [202, envelope({ ingestion_id: "ing_1", status: "queued" })];
      const n = (polls.get(scenario) ?? 0) + 1;
      polls.set(scenario, n);
      if (n < 2) return [200, envelope({ ingestion_id: "ing_1", status: "processing", stages: [{ stage: "parse", status: "done" }] })];
      return [
        200,
        envelope({
          ingestion_id: "ing_1",
          status: "done",
          raw_source_id: "raw_1",
          error: null,
          stages: [{ stage: "parse", status: "done" }, { stage: "extract", status: "done" }],
          disposition: {
            tier: "hot",
            outcome: "graph",
            entities: ["远程办公", "张三"],
            fact_count: 3,
            todo_count: 1,
            edge_count: 2,
            page: "p_1",
            reason: null
          }
        })
      ];
    }

    case "poll-timeout":
      if (slug === "note-write") return [202, envelope({ ingestion_id: "ing_2", status: "queued" })];
      return [200, envelope({ ingestion_id: "ing_2", status: "queued", stages: [] })];

    case "dedup":
      if (slug === "note-write") return [202, envelope({ ingestion_id: "ing_3", status: "queued" })];
      return [
        200,
        envelope({
          ingestion_id: "ing_3",
          status: "done",
          deduplicated: true,
          raw_source_id: "raw_0",
          disposition: { tier: "warm", outcome: "archived", entities: [], fact_count: 0, todo_count: 0, edge_count: 0, reason: "duplicate" }
        })
      ];

    case "ask-none": // Mera 无证据时回的是一句英文硬编码占位符
      return [
        200,
        envelope({
          answer: "I could not find any supported evidence to answer this query.",
          has_evidence: false,
          evidence_level: "none",
          evidence: { grade: "待核实", grounded_count: 0, reference_count: 0, note: null },
          citations: [],
          conversation_id: "conv_1",
          message_id: "msg_1"
        })
      ];

    case "ask-none-cn": // 同样无证据，但 Mera 换了文案（占位符正则匹配不中）——answer 不该被改写
      return [
        200,
        envelope({
          answer: "检索不到可支撑的内容。",
          has_evidence: false,
          evidence_level: "none",
          evidence: { grade: "待核实", grounded_count: 0, reference_count: 0, note: null },
          citations: [],
          conversation_id: "conv_3",
          message_id: "msg_3"
        })
      ];

    case "ask-reference": // grade 同样是「待核实」，但确实检索到了用户原文——不许当成无支撑
      return [
        200,
        envelope({
          answer: "你在几条笔记里提过远程办公，倾向是「先异步、必要时再同步」。",
          has_evidence: true,
          evidence_level: "reference",
          evidence: { grade: "待核实", grounded_count: 0, reference_count: 2, note: null },
          citations: [
            { kind: "reference", index: 1, chunk_id: "c1", raw_source_id: "r1", raw_source: { id: "r1", title: "2026-07 的一条笔记", origin_uri: null, source_type: "note" } },
            { kind: "reference", index: 2, chunk_id: "c2", raw_source_id: "r2", raw_source: { id: "r2", title: "远程办公的三点想法", origin_uri: null, source_type: "note" } }
          ],
          conversation_id: "conv_2",
          message_id: "msg_2"
        })
      ];

    case "self-null-core": // 用户从没跑过整理：200 + persona_core: null
      return [
        200,
        envelope({
          core: { persona_core: null, current_version_no: null, versions: [] },
          memories: [{ id: "m1", statement: "在做一个第二大脑", kind: "factual", memory_type: "project", recorded_at: "2026-07-01", source: {} }]
        })
      ];

    case "ingest-failed":
      if (slug === "note-write") return [202, envelope({ ingestion_id: "ing_4", status: "queued" })];
      return [200, envelope({ ingestion_id: "ing_4", status: "failed", error: "URL 抓取超时", stages: [{ stage: "fetch", status: "failed" }] })];

    default:
      return [200, envelope({ results: [] })];
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    const scenario = String(req.headers.authorization ?? "").replace(/^Bearer\s+/, "");
    const slug = (req.url ?? "").split("/").filter(Boolean).slice(-2)[0];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        parsed = {};
      }
      seen.push({ slug, body: parsed });
      const [status, payload] = respond(scenario, slug, parsed);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, DOUBAOYA_API_KEY: undefined, MERA_POLL_BACKOFF_MS: "5,5,5,5", ...env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const withKey = (scenario) => ({ DOUBAOYA_BASE_URL: base, DOUBAOYA_API_KEY: scenario });

check("缺 key → MISSING_API_KEY / exit 1 / 不回显密钥", async () => {
  const r = await run(["search", "远程办公"], { DOUBAOYA_BASE_URL: base });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^\[error\] MISSING_API_KEY: /);
  assert.equal(r.stdout.trim(), "");
});

check("VALIDATION_ERROR 信封 → [error] VALIDATION_ERROR / exit 1", async () => {
  const r = await run(["search", "随便搜"], withKey("validation"));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^\[error\] VALIDATION_ERROR: q 不能为空/);
});

check("PROVIDER_FAILED(502) → [error] PROVIDER_FAILED / exit 1", async () => {
  const r = await run(["ask", '{"query_text":"我对远程办公怎么看"}'], withKey("provider"));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^\[error\] PROVIDER_FAILED: /);
});

check("remember 轮询到 done → exit 0 + disposition 原样带出", async () => {
  const r = await run(["remember", '{"content":"今天想到一个点子"}'], withKey("poll-done"));
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.status, "done");
  assert.equal(data.remember_result, "done");
  assert.equal(data.disposition.fact_count, 3);
  assert.equal(data.disposition.todo_count, 1);
  assert.deepEqual(data.disposition.entities, ["远程办公", "张三"]);
  // 响应里没有 deduplicated 时不许合成一个 false —— 那等于替 Mera 断言「这是首次记录」
  assert.equal("deduplicated" in data, false);
});

check("remember 轮询超时 → pending，绝不假装成功", async () => {
  const r = await run(["remember", '{"content":"一段很长的东西"}'], withKey("poll-timeout"));
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.remember_result, "pending");
  assert.notEqual(data.status, "done");
  assert.match(data.remember_note, /尚未确认/);
  assert.match(r.stderr, /^\[warn\] PENDING: /);
  assert.match(r.stderr, /ing_2/); // 给出复查用的 ingestion_id
});

check("remember 命中去重 → deduplicated 标记透传", async () => {
  const r = await run(["remember", '{"content":"重复的一条"}'], withKey("dedup"));
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.deduplicated, true);
  assert.equal(data.remember_result, "done");
});

check("remember 终态 failed → exit 1 且带出失败原因", async () => {
  const r = await run(["remember", '{"url":"https://example.com/a"}'], withKey("ingest-failed"));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^\[error\] INGESTION_FAILED: URL 抓取超时/m);
  const data = JSON.parse(r.stdout);
  assert.equal(data.remember_result, "failed");
});

check("信封缺 data → 退化成空对象，不崩栈", async () => {
  const r = await run(["self"], withKey("thin-envelope"));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {});
});

check("read 显式窗口 → 原样发出，原文打到 stdout", async () => {
  const r = await run(["read", '{"source_id":"src_9","from":100,"to":900}'], withKey("read-window"));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastBody("source-read"), { source_id: "src_9", from: 100, to: 900 });
  assert.match(JSON.parse(r.stdout).content, /单机版/);
});

check("read 无位置线索 → 显式补 0/20000，不依赖服务端兜底", async () => {
  const r = await run(["read", '{"source_id":"src_9"}'], withKey("read-window"));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastBody("source-read"), { source_id: "src_9", from: 0, to: 20000 });
});

check("search → read 串联：from = char_start-500，to = char_end+1500", async () => {
  const s = await run(["search", "老王"], withKey("read-window"));
  assert.equal(s.code, 0, s.stderr);
  const hit = JSON.parse(s.stdout).results[0];
  const r = await run(
    ["read", JSON.stringify({ source_id: hit.id, char_start: hit.char_start, char_end: hit.char_end })],
    withKey("read-window")
  );
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastBody("source-read"), { source_id: "src_1", from: 2500, to: 4900 });
});

check("search → read 串联：char_start < 500 时 from clamp 到 0，绝不为负", async () => {
  const s = await run(["search", "老王"], withKey("read-clamp"));
  const hit = JSON.parse(s.stdout).results[0];
  const r = await run(
    ["read", JSON.stringify({ source_id: hit.id, char_start: hit.char_start, char_end: hit.char_end })],
    withKey("read-clamp")
  );
  assert.equal(r.code, 0, r.stderr);
  const body = lastBody("source-read");
  assert.equal(body.from, 0); // 120 - 500 = -380，必须 clamp
  assert.equal(body.to, 1900);
  assert.ok(body.from >= 0);
});

check("read 被截断 → 续读起点按实际读到的长度推进，不是回显的 to", async () => {
  // 响应里的 to 是请求原样回显（5000000）；实际只读到 20000 字。
  // 按回显 to 续读会跳空 [20000, 5000000) —— 这正是 truncated 该防住的数据丢失。
  const r = await run(["read", '{"source_id":"src_3","from":0,"to":5000000}'], withKey("read-truncated"));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^\[warn\] TRUNCATED: /);
  assert.match(r.stderr, /65000/); // 全文总长
  assert.match(r.stderr, /from=20000/); // = 0 + 实际读到的 20000
  assert.equal(/5000000/.test(r.stderr), false); // 绝不能把回显的 to 当续读起点
  const data = JSON.parse(r.stdout);
  assert.equal(data.truncated, true);
  assert.equal(data.content.length, 20000);
});

check("read 续读第二窗 → 起点是 from + 实际长度，不是常数 20000", async () => {
  const r = await run(["read", '{"source_id":"src_3","from":20000,"to":5000000}'], withKey("read-truncated"));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /from=40000/); // 20000 + 20000
});

check("read 只给 from 续读（照 TRUNCATED 告警走）→ to 补成 from+20000，不是绝对 20000", async () => {
  // 回归：WINDOW_MAX 是窗口**宽度**。写死成绝对 to 时，脚本自己 [warn] TRUNCATED 里
  // 教 agent 传的 from=20000 会算出 to=20000 → 空窗口硬错误，续读指引自相矛盾。
  const r = await run(["read", '{"source_id":"src_3","from":20000}'], withKey("read-truncated"));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastBody("source-read"), { source_id: "src_3", from: 20000, to: 40000 });
});

check("read 只给深处的 char_start（无 char_end）→ 窗口跟着 from 走，不塌成空窗口", async () => {
  const r = await run(["read", '{"source_id":"src_3","char_start":29980}'], withKey("read-truncated"));
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(lastBody("source-read"), { source_id: "src_3", from: 29480, to: 49480 });
});

check("read 窗口越过全文末尾 → [warn] EMPTY_WINDOW，不许被读成「笔记是空的」", async () => {
  const r = await run(["read", '{"source_id":"src_past","from":100000,"to":120000}'], withKey("read-past-end"));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^\[warn\] EMPTY_WINDOW: /);
  assert.match(r.stderr, /说这条笔记是空的/); // 必须明说「空窗口 ≠ 空笔记」
  assert.match(r.stderr, /全文共 65000 字/); // 给出真实全长，agent 才知道该往回调
  assert.equal(JSON.parse(r.stdout).content, "");
});

check("read 到已归档来源 → [warn] ARCHIVED，不拦截也不静默", async () => {
  const r = await run(["read", '{"source_id":"src_old","from":0,"to":900}'], withKey("read-archived"));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^\[warn\] ARCHIVED: /);
  assert.match(r.stderr, /2026-07-25/); // 带上归档时间
  assert.match(JSON.parse(r.stdout).content, /单机版/); // 数据照常给，不拦截
});

check("read 未归档 → 不打 ARCHIVED 噪音", async () => {
  const r = await run(["read", '{"source_id":"src_9","from":0,"to":900}'], withKey("read-window"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(/ARCHIVED/.test(r.stderr), false);
});

check("read 缺 source_id → 本地拦下，不浪费一次调用", async () => {
  const r = await run(["read", '{"from":0,"to":100}'], withKey("read-window"));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^\[error\] VALIDATION_ERROR: /);
});

check("ask 无证据 → 整份 stdout 里都不出现那句英文占位符", async () => {
  const r = await run(["ask", '{"query_text":"我对量子计算怎么看"}'], withKey("ask-none"));
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.no_evidence, true);
  assert.equal(data.answer, "你的笔记里没有能支撑这个问题的内容。");
  // 红线（收紧版）：读 stdout 的是 LLM agent，JSON 里任何字符串它都可能转述 ——
  // 判据下沉到**整段 stdout 文本**，不再只看 answer 字段，也不再留 answer_upstream 副本。
  assert.equal(r.stdout.includes("I could not find"), false);
  assert.equal("answer_upstream" in data, false);
  assert.match(data.answer_notice, /没有能支撑/);
  assert.match(r.stderr, /^\[warn\] NO_EVIDENCE: /);
  assert.equal(data.evidence_level, "none"); // 原字段照样透传
});

check("ask 无证据但 Mera 换了文案 → answer 原样保留，告警照打", async () => {
  const r = await run(["ask", '{"query_text":"我对合成生物学怎么看"}'], withKey("ask-none-cn"));
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.no_evidence, true);
  // 没命中那句英文占位符 => 不加工 answer（可能是真内容），但无证据的判定/告警一个不少。
  assert.equal(data.answer, "检索不到可支撑的内容。");
  assert.match(r.stderr, /^\[warn\] NO_EVIDENCE: /);
});

check("ask 有 reference 证据 → 不因 grade「待核实」被误判成无支撑", async () => {
  const r = await run(["ask", '{"query_text":"我对远程办公怎么看"}'], withKey("ask-reference"));
  assert.equal(r.code, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal("no_evidence" in data, false);
  assert.equal("answer_upstream" in data, false); // 有证据时不加工，也就没有原件副本
  assert.match(data.answer, /先异步/); // answer 原样保留
  assert.equal(data.citations.length, 2);
  assert.equal(/NO_EVIDENCE/.test(r.stderr), false);
});

check("self 无人格内核 → 提醒别脑补，数据照样透传", async () => {
  const r = await run(["self"], withKey("self-null-core"));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^\[warn\] NO_PERSONA_CORE: /);
  assert.match(r.stderr, /别脑补/);
  const data = JSON.parse(r.stdout);
  assert.equal(data.core.persona_core, null);
  assert.equal(data.memories[0].memory_type, "project");
});

check("url 模式带 title → 提醒服务端会忽略，不静默丢掉", async () => {
  const r = await run(["write", '{"url":"https://example.com/a","title":"我起的标题"}'], withKey("poll-done"));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /^\[warn\] IGNORED_FIELDS: /);
  assert.match(r.stderr, /title/);
});

check("write 缺 content/url → 本地拦下，不浪费一次调用", async () => {
  const r = await run(["write", '{"title":"只有标题"}'], withKey("poll-done"));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^\[error\] VALIDATION_ERROR: /);
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${err.message.split("\n")[0]}`);
  }
}
server.close();
console.log(failed ? `\n${failed}/${checks.length} 条自检未通过` : `\n${checks.length}/${checks.length} 条自检通过`);
process.exitCode = failed ? 1 : 0;
