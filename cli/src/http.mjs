// http.mjs — 公共请求层：鉴权、超时、错误分类、信封拆解。三包旧脚本各写一遍的，收敛到这里。
//
// 🔴 超时红线（沿用 doubaoya.mjs，写进契约防止被幂等教条覆盖）：
//   超时 ≠ 本地已知失败 —— 调用可能已打到服务端、可能仍在处理甚至已计费。
//   计费类请求超时**绝不自动重试**；报错必须指引「先核实是否已计费/已执行」。
//
// 计费调用的客户端墙 450s：> 服务端最长超时预算 360s 留 90s 余量，
// 且 < 生产 nginx proxy_read_timeout 480s 留 30s（判据全文见 skills/dby-api/scripts/doubaoya.mjs）。

import { getKey, keyPresence } from "./context.mjs";
import { EXIT, DbyError, upstreamError } from "./errors.mjs";
import { warn } from "./output.mjs";

export const DEFAULT_TIMEOUT_MS = 60_000;   // 免费读写路由（write/charter 旧脚本同值）
export const INVOKE_TIMEOUT_MS = 450_000;   // 计费 invoke（doubaoya.mjs 同值，判据见上）

/** fetch 层错误 → DbyError。TimeoutError 与普通网络错误必须分开措辞（红线）。 */
export function classifyFetchError(err, { billable = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (err?.name === "TimeoutError") {
    return new DbyError(
      "TIMEOUT",
      `本地等待响应超过 ${timeoutMs / 1000}s，已放弃等待。这次调用服务端可能仍在进行、也可能已经执行/计费——不是「本地已知失败」。`,
      {
        exit: EXIT.NETWORK,
        remediation: billable
          ? "别立刻重试（上游若已出结果或已计费，重试=再付一次）。先去 doubaoya.com 后台或调用记录核实这次到底有没有成功/扣点，确认失败后再决定要不要重试。"
          : "先核实这次请求是否已在服务端执行（免费只读路由重试无计费风险，但写操作要先确认没生效）。"
      }
    );
  }
  return new DbyError("NETWORK_ERROR", `网络请求失败：${err.message}`, {
    exit: EXIT.NETWORK,
    remediation: "检查网络与 https://doubaoya.com 的可达性后重试。"
  });
}

/**
 * 一次请求，返回信封里的 data。
 *   auth: "required" | "optional" | "none"
 *   soft: 失败不抛，返回 { __soft: "原因" }（prep 的降级阶梯用）
 *   notFoundNull: 404 时返回 null 而不是抛（ref 在两个集合之间试探用）
 *   billable: 只影响超时 remediation 的措辞与红线提示
 *   hints: 上游错误码 → remediation 的补充表（调用点最了解自己的错误码）
 * 🔴 无 body 的请求不加 Content-Type —— 服务端对带该头却空 body 的请求直接 BAD_REQUEST，
 *    而它看起来很像「没权限」（write.mjs 踩过）。
 */
export async function request(ctx, method, path, {
  body,
  auth = "required",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  billable = false,
  soft = false,
  notFoundNull = false,
  hints = {}
} = {}) {
  const key = getKey(ctx, { required: auth === "required" });
  const headers = {};
  if (key && auth !== "none") headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const t = ctx.timeoutOverride ?? timeoutMs;
  let res;
  try {
    res = await fetch(`${ctx.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(t)
    });
  } catch (err) {
    const e = classifyFetchError(err, { billable, timeoutMs: t });
    if (soft) return { __soft: e.message };
    throw e; // 🔴 不重试。计费类尤其不许——这里没有任何重试路径，就是契约本体。
  }

  if (notFoundNull && res.status === 404) return null;

  let env;
  try {
    env = await res.json();
  } catch {
    const e = new DbyError(`HTTP_${res.status}`, `返回不是合法 JSON (HTTP ${res.status})`, { exit: EXIT.GENERAL });
    if (soft) return { __soft: e.message };
    throw e;
  }

  if (!env || env.success !== true) {
    const e = upstreamError(res.status, env?.error?.code, env?.error?.message, {
      keySet: !!ctx.key,
      hints
    });
    if (soft && e.exit !== EXIT.AUTH) return { __soft: `[${e.code}] ${e.message}` }; // 401 不许被降级吞掉
    throw e;
  }

  // 信封上的可选字段走 stderr，免得污染 stdout 的数据通道。
  // notice =「你安装的 skill 有更新」类提示，SKILL.md 承诺原样转达 —— 这条链断过，别再断。
  if (env.notice) warn(ctx, `[notice] ${env.notice}`);
  if (env.noResult) warn(ctx, `[${env.noResult.code}] ${env.noResult.message}`);
  return env.data;
}

export { keyPresence };
