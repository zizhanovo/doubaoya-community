#!/usr/bin/env node
// http.selfcheck.mjs — classifyFetchError 的分流断言。`node scripts/lib/http.selfcheck.mjs`
//
// 为什么值得单独一份：这段代码判的不是「报什么错」，而是「**能不能重试**」——认错一边的代价
// 是让用户为同一次生图付两次钱（错认成可重试），或让一次纯本地的连不上被当成服务端故障
// 一直卡着（错认成不可重试，2026-09-10 真实发生过）。两个方向各钉一条断言。

import assert from "node:assert/strict";
import { classifyFetchError, INVOKE_TIMEOUT_MS } from "./http.mjs";

/** 造一个 fetch 那样的错误：自身是 TypeError，真原因藏在 cause 链里。 */
function fetchFailed(cause) {
  return Object.assign(new TypeError("fetch failed"), { cause });
}

// ① 超时 → TIMEOUT，且计费时必须指引「先核实有没有扣点」，不许暗示重试。
{
  const e = classifyFetchError(Object.assign(new Error("timed out"), { name: "TimeoutError" }), {
    billable: true,
    timeoutMs: INVOKE_TIMEOUT_MS
  });
  assert.equal(e.code, "TIMEOUT");
  assert.match(e.remediation, /别立刻重试/);
}

// ② 连接从未建立 → CONNECT_FAILED，且必须明说没扣点（这句就是让调用方敢重试的依据）。
for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "CERT_HAS_EXPIRED"]) {
  const e = classifyFetchError(fetchFailed(Object.assign(new Error(code), { code })), { billable: true });
  assert.equal(e.code, "CONNECT_FAILED", `${code} 应判为连接从未建立`);
  assert.match(e.message, /请求没有发出去/);
  assert.match(e.remediation, /没有扣点/);
}

// ②b DNS 失败要多说一句代理——「curl 通、脚本不通」几乎总是它，不说破就得让人自己查一小时。
//     反过来，非 DNS 的连接失败不许夹带这段（那会把人引去改根本没问题的代理配置）。
{
  const dns = classifyFetchError(fetchFailed(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })), {});
  assert.match(dns.remediation, /HTTPS_PROXY/);
  assert.match(dns.remediation, /curl/);
  const refused = classifyFetchError(fetchFailed(Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" })), {});
  assert.doesNotMatch(refused.remediation, /HTTPS_PROXY/, "非 DNS 的连接失败不该扯代理");
}

// ③ undici 的连接超时藏在 cause 链第二层，且 name 不是 TimeoutError —— 以前正是它被
//    混进 NETWORK_ERROR 的。链要走得下去，也要认得出。
{
  const inner = Object.assign(new Error("Connect Timeout Error"), { name: "ConnectTimeoutError" });
  const e = classifyFetchError(fetchFailed(Object.assign(new Error("wrapped"), { cause: inner })), {});
  assert.equal(e.code, "CONNECT_FAILED");
}

// ④ 🔴 反向断言：连上之后才断的，**绝不许**被认成 CONNECT_FAILED —— 请求可能已经送达并
//    计费，判错这一条 = 让用户付两次钱。
for (const code of ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ETIMEDOUT"]) {
  const e = classifyFetchError(fetchFailed(Object.assign(new Error(code), { code })), { billable: true });
  assert.equal(e.code, "NETWORK_ERROR", `${code} 有歧义，必须按可能已计费处理`);
  assert.match(e.remediation, /核实有没有扣点/);
}

// ⑤ cause 自引用不能把 for 循环转死（真实世界里被包装过的错误出现过环）。
{
  const looped = new Error("loop");
  looped.cause = looped;
  const e = classifyFetchError(fetchFailed(looped), {});
  assert.equal(e.code, "NETWORK_ERROR");
}

console.log("ok http.selfcheck: 6 组分流断言全过");
