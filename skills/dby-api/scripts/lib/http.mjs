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
import { resolveProxy, requestViaProxy } from "./proxy.mjs";

export const DEFAULT_TIMEOUT_MS = 60_000;   // 免费读写路由（write/charter 旧脚本同值）
export const INVOKE_TIMEOUT_MS = 450_000;   // 计费 invoke（doubaoya.mjs 同值，判据见上）

// 「连接从未建立」的判据。fetch 自身只抛 `TypeError: fetch failed`，真正的原因挂在 err.cause
// 上（可能再套一层），所以要顺着 cause 链找。
// 🔴 只收**能证明请求字节一个都没发出去**的原因。有歧义的一律不收：ECONNRESET / EPIPE /
//    UND_ERR_SOCKET / ETIMEDOUT 都可能发生在请求已经送达服务端之后，那种情况必须按
//    「可能已执行、已计费」保守处理（与超时同一条红线）。宁可少认，不可错认。
// DNS 解析失败单列：它是这里**最容易被误判成服务端故障**的一种，因为同一台机器上
// `curl` 往往还是通的——curl 读 HTTP_PROXY / HTTPS_PROXY 环境变量、由代理替它解析域名，
// 而 Node 的 fetch 默认**不读**那两个变量（Node 24+ 才有 NODE_USE_ENV_PROXY），于是自己去
// 做 getaddrinfo 并 ENOTFOUND。"curl 200 但脚本连不上"几乎总是这一条，得在报错里直接说破。
const DNS_FAILURE_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

const CONNECT_FAILED_CODES = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN",
  "ERR_PROXY_CONNECTION_FAILED",
  // TLS 握手在应用数据之前：握手没过就一定没发出请求。
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"
]);

/** 顺 cause 链找连接层失败；深度设上限，防自引用的 cause 把这里转死。 */
function connectFailureReason(err) {
  for (let e = err, depth = 0; e && depth < 8; e = e.cause, depth += 1) {
    // 代理路径由 proxy.mjs 直接盖章说明失败发生在 TLS 握手完成之前——那一侧应用数据一个
    // 字节都没发出去。判据表只有这一张，两条路径共用，所以这里认章而不是去猜底层 code。
    if (e.dbyPhase === "connect") return e.dbyReason ?? e.code ?? "连接未建立";
    // undici 的连接超时（默认 10s，**不受本层 timeoutMs 管**），name 不是 TimeoutError，
    // 所以它落不到上面那条超时分支——这正是它以前被混进 NETWORK_ERROR 的原因。
    if (e.name === "ConnectTimeoutError") return "连接超时";
    if (typeof e.code === "string" && CONNECT_FAILED_CODES.has(e.code)) return e.code;
  }
  return null;
}

/**
 * fetch 层错误 → DbyError。三类必须分开措辞（红线）：
 *   ① TimeoutError    本地等超时。请求早已发出，服务端可能仍在跑、甚至已计费 ⇒ 绝不自动重试。
 *   ② 连接从未建立     字节没发出去 ⇒ 服务端必然没收到、没执行、没扣点，重试安全且免费。
 *   ③ 其余（连上后断） 请求可能已经到达并被处理 ⇒ 与 ① 一样保守。
 *
 * ② 单独分出来的理由（2026-09-10 真实发生）：不分它，调用方只看得到一个 NETWORK_ERROR，
 * 于是一律套用「计费类失败不重试」的红线停在原地，并把一次纯粹的本机连不上转述成
 * 「都爆鸭返回了 NETWORK_ERROR」——用户跟着来问「是不是你们挂了、我是不是被扣了点」。
 * 两个问题的答案都在客户端手里，只是从没说出口。
 */
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
  const connectReason = connectFailureReason(err);
  if (connectReason) {
    return new DbyError(
      "CONNECT_FAILED",
      `连不上都爆鸭服务器（${connectReason}）——**请求没有发出去**，这不是服务端返回的错误。`,
      {
        exit: EXIT.NETWORK,
        remediation:
          "服务端没收到这次调用，**没有执行、没有扣点**，重试不会重复计费。" +
          "先确认本机能出网到 doubaoya.com：`curl -s -o /dev/null -w '%{http_code}' https://doubaoya.com/api/health` 应回 200；" +
          "容器 / 沙箱运行时常见出站域名白名单限制，那种情况重试多少次都一样，要放行域名或换个能出网的环境。" +
          (DNS_FAILURE_CODES.has(connectReason)
            ? " 🔴 这次是**域名解析**失败，而且是**直连**时失败的——本包会读 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY 自己走代理，"
              + "所以走到这一步说明本次没有用上任何代理。如果同一台机器上 `curl` 反而是通的，那就不是网络断了："
              + "多半是那几个变量没传进当前进程（agent / 容器拉起子进程时最容易丢环境变量），"
              + "或者 NO_PROXY 把 doubaoya.com 豁免掉了。先 `echo $HTTPS_PROXY $ALL_PROXY $NO_PROXY` 看一眼；"
              + "变量确实不在就 export 一个指向你 http 代理端口的 HTTPS_PROXY 再跑。"
              + "变量在、NO_PROXY 也没豁免，那就是这台机器的 DNS 真的解析不了这个域名——换 DNS 或让运维放行。"
            : " 能通之后直接重跑原命令即可。")
      }
    );
  }
  // 连上之后才断（ECONNRESET / EPIPE / socket 提前关闭…）：请求可能已经送达并被执行，
  // 所以措辞与超时同级保守，不许暗示「重试是安全的」。
  return new DbyError("NETWORK_ERROR", `网络请求中断：${err.message}`, {
    exit: EXIT.NETWORK,
    remediation: billable
      ? "连接已经建立过，这次调用可能已经打到服务端并被执行/计费——别直接重试，先去 doubaoya.com 的调用记录核实有没有扣点。"
      : "检查网络与 https://doubaoya.com 的可达性；免费只读路由可以重试，写操作先确认没生效。"
  });
}

/**
 * 一次请求，返回信封里的 data。
 *   auth: "required" | "optional" | "none"
 *   soft: 失败不抛，返回 { __soft: "原因" }（prep 的降级阶梯用）
 *   notFoundNull: 404 时返回 null 而不是抛（ref 在两个集合之间试探用）
 *   billable: 只影响超时 remediation 的措辞与红线提示
 *   hints: 上游错误码 → remediation 的补充表（调用点最了解自己的错误码）
 *   withEnvelope: 为 true 时返回 { data, detailUrl, notice, noResult } 而不是裸 data——
 *     信封顶层的 detailUrl（如公众号渲染的在线预览页）只有这样才拿得到；notice/noResult
 *     仍照样 warn 到 stderr，这里只是多给调用方一份原文。
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
  hints = {},
  withEnvelope = false
} = {}) {
  const key = getKey(ctx, { required: auth === "required" });
  const headers = {};
  if (key && auth !== "none") headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const t = ctx.timeoutOverride ?? timeoutMs;
  const url = `${ctx.baseUrl}${path}`;
  // 🔴 安全阀：没有代理变量时 resolveProxy 返回 null，下面走的就是原来那行 fetch，
  //    一个字都没变。绝大多数用户根本不进代理路径，这也是回滚成本近似为零的原因。
  //    （代理配的是 socks 这类用不了的协议时，resolveProxy 直接抛 —— 不许偷偷改走直连。）
  const proxy = resolveProxy(url, process.env);
  let res;
  try {
    res = proxy
      ? await requestViaProxy(proxy, url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          timeoutMs: t
        })
      : await fetch(url, {
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
  // 🔴 **法定标识**：AI 生成内容的显式标识，服务端挂在信封顶层。
  // 服务端当初把它从「只在网页写一行」改成挂信封，理由正是「98.6% 的调用来自 agent，
  // 只在页面标等于对绝大多数路径没有标识」——而在 2026-09-10 之前，**本请求层在这里
  // 把它丢了**（withEnvelope 只挑了 data/detailUrl/notice/noResult 四个字段），
  // 全仓 grep `aigc` 命中 0 次 ⇒ 标识挂了没人读，等于还是只有网页有。
  // 与 notice 同一句话：**挂了没人读 == 没挂**。放在这里统一转达，所有包自动生效。
  if (env.aigc?.generated && env.aigc?.label) warn(ctx, `[aigc] ${env.aigc.label}`);
  if (withEnvelope) {
    return {
      data: env.data,
      detailUrl: env.detailUrl ?? null,
      notice: env.notice ?? null,
      noResult: env.noResult ?? null,
      // 调用方要把标识转达给终端用户时读它（上面已经 warn 过一份到 stderr）。
      aigc: env.aigc ?? null
    };
  }
  return env.data;
}

export { keyPresence };
