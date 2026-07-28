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

function envelope(data) {
  return { success: true, requestId: "req_selfcheck", data, error: null };
}

function errorEnvelope(code, message) {
  return { success: false, requestId: "req_selfcheck", data: null, error: { code, message } };
}

function respond(scenario, slug) {
  switch (scenario) {
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
      const [status, payload] = respond(scenario, slug);
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
