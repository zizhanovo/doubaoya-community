// proxy.mjs — 按环境变量走代理出网：代理发现、NO_PROXY 豁免、CONNECT 隧道。
//
// 为什么需要这一份（判据全文见 openspec/changes/request-layer-proxy-support/proposal.md）：
// 我们发的是**在别人机器上跑的 Node 脚本**，而受管企业网络、公司笔记本、CI 容器、agent
// 沙箱里「只能走代理出网」是常态——那些机器连 DNS 查询都出不去，域名由代理代查。
// curl / git / 浏览器都读 HTTP_PROXY 这套三十年的环境变量约定，所以在那些机器上一直可用；
// Node 的 fetch 明确不读（Node 24 才有 opt-in 的 NODE_USE_ENV_PROXY，覆盖不到 18–22），
// 于是自己去 getaddrinfo 并 ENOTFOUND，请求根本没发出去。用户看到的症状是
// 「同机 curl 200、脚本连不上」，指向的方向完全是错的，2026-09-10 一个用户为此报障三次。
//
// 🔴 安全阀：**没有代理变量时，这里返回 null，请求层一字不改地走原来的 fetch**。
//    绝大多数用户根本不进这份代码，回滚成本因此近似为零。
//
// 🔴 计费红线的延伸：失败发生在「TLS 握手完成之前」还是「之后」，决定用户能不能安全重试。
//    完成之前 = 应用数据一个字节都没发出去 ⇒ 服务端没收到、没执行、没扣点。
//    这份文件负责**标注**发生在哪一侧（err.dbyPhase），由 http.mjs 的 classifyFetchError
//    统一判——判据表只有一张，两条路径共用。
//
// 零依赖（Node ≥ 18）：node:http / node:https / node:tls。

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { EXIT, DbyError } from "./errors.mjs";

// 查找顺序：目标是 https 就先看 HTTPS_PROXY，是 http 就先看 HTTP_PROXY，最后都回落 ALL_PROXY。
// 同名大小写都认，大写在前——顺序固定才有可重现的行为（spec: 「大小写同时存在」）。
const HTTPS_PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
const HTTP_PROXY_VARS = ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

/**
 * 本地地址**硬豁免**，不看 NO_PROXY。
 * 理由：`DOUBAOYA_BASE_URL=http://127.0.0.1:3000` 是本地开发的常规用法，把它送进公司代理
 * 只会得到一个莫名其妙的 502，而用户根本不会想到要为本地地址配 NO_PROXY。
 */
function isLoopback(hostname) {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** NO_PROXY 的一个条目是否匹配目标。条目带端口时必须端口也对上。 */
function noProxyEntryMatches(entry, hostname, port) {
  let e = entry.trim().toLowerCase();
  if (!e) return false;
  if (e === "*") return true;

  // "host:port" —— 端口是条目的一部分，不对上就不算命中。
  const portSplit = e.lastIndexOf(":");
  if (portSplit > 0 && /^\d+$/.test(e.slice(portSplit + 1))) {
    const entryPort = e.slice(portSplit + 1);
    if (entryPort !== String(port)) return false;
    e = e.slice(0, portSplit);
  }

  e = e.replace(/^\./, "");           // ".doubaoya.com" 与 "doubaoya.com" 同义
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === e || h.endsWith(`.${e}`);
}

function noProxyMatches(hostname, port, env) {
  const raw = env.NO_PROXY ?? env.no_proxy ?? "";
  if (!raw.trim()) return false;
  return raw.split(",").some((entry) => noProxyEntryMatches(entry, hostname, port));
}

function defaultPort(protocol) {
  return protocol === "https:" ? 443 : 80;
}

/**
 * 解析出该用哪个代理。返回 null = 直连（请求层据此走原 fetch 路径）。
 * 代理协议不是 http(s) 时**抛错而不是回落直连** —— 静默回落会让用户看到一个与代理毫无
 * 关系的 ENOTFOUND，等于把这次报障原样重演一遍（spec: 「不支持的代理协议必须显式报错」）。
 */
export function resolveProxy(targetUrl, env = process.env) {
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return null; // 地址本身不合法，交给下游报它自己的错，别在这里抢答
  }

  const targetPort = target.port || defaultPort(target.protocol);
  if (isLoopback(target.hostname)) return null;
  if (noProxyMatches(target.hostname, targetPort, env)) return null;

  const vars = target.protocol === "https:" ? HTTPS_PROXY_VARS : HTTP_PROXY_VARS;
  let source = null;
  let raw = null;
  for (const name of vars) {
    const value = env[name];
    if (value && value.trim()) {
      source = name;
      raw = value.trim();
      break;
    }
  }
  if (!raw) return null;

  let parsed;
  try {
    // "proxy.corp:8080" 这种不带 scheme 的写法也认（curl 认，用户就会这么写）。
    parsed = new URL(/^[a-z0-9+.-]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    throw new DbyError("PROXY_INVALID", `${source} 的值不是一个能解析的代理地址。`, {
      exit: EXIT.USAGE,
      remediation: `把 ${source} 设成形如 http://主机:端口 的地址（需要认证就写 http://用户名:密码@主机:端口）。`
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DbyError(
      "PROXY_UNSUPPORTED",
      `${source} 配的是 ${parsed.protocol}// 代理，本包只支持 http(s) 代理。`,
      {
        exit: EXIT.USAGE,
        remediation:
          "Clash / V2Ray 一类客户端在 socks 端口之外**同时**开着一个 http 代理端口，" +
          `把 ${source} 指向那个 http 端口即可（形如 http://127.0.0.1:7890，端口号看你客户端的设置页）。` +
          "本包不会在这种情况下偷偷改走直连——那只会让你看到一个与代理无关的报错。"
      }
    );
  }

  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    port: Number(parsed.port || defaultPort(parsed.protocol)),
    // 🔴 凭据与 API key 同一条红线：只在 Proxy-Authorization 头里用，绝不进任何输出。
    auth: parsed.username
      ? { username: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) }
      : null,
    source,
    // 错误消息里只许出现这个——它**不含**凭据。
    display: `${parsed.protocol}//${parsed.hostname}:${parsed.port || defaultPort(parsed.protocol)}`
  };
}

/** 给错误盖上「这发生在 TLS 握手完成之前」的章。classifyFetchError 只认这个章，不猜 code。 */
function markConnectPhase(err, reason) {
  err.dbyPhase = "connect";
  if (reason) err.dbyReason = reason;
  return err;
}

function proxyAuthHeader(proxy) {
  if (!proxy.auth) return {};
  const raw = `${proxy.auth.username}:${proxy.auth.password}`;
  return { "Proxy-Authorization": `Basic ${Buffer.from(raw).toString("base64")}` };
}

/** 把 IncomingMessage 收成 fetch Response 的最小子集：请求层只用到 status 与 json()。 */
function collectResponse(res, resolve, reject) {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("error", reject);
  res.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8");
    resolve({
      status: res.statusCode,
      async json() {
        return JSON.parse(text);
      }
    });
  });
}

/**
 * 经代理发一次请求。返回 { status, json() }，与请求层用到的 fetch Response 子集同形，
 * 于是 http.mjs 的信封解析、notice / noResult / aigc 转达、错误分类**一行都不用改**。
 *
 * 超时语义与直连一致：整体墙（连代理 + 隧道 + TLS + 收完响应头体）用同一个 timeoutMs，
 * 超时抛出的错误 name 设成 TimeoutError，好落进 classifyFetchError 既有的那条超时分支。
 */
export function requestViaProxy(proxy, targetUrl, { method = "GET", headers = {}, body, timeoutMs }) {
  const target = new URL(targetUrl);
  const targetPort = Number(target.port || defaultPort(target.protocol));

  return new Promise((resolve, reject) => {
    let settled = false;
    let secureEstablished = false;
    const sockets = [];

    const timer = setTimeout(() => {
      const err = new Error(`本地等待响应超过 ${timeoutMs / 1000}s`);
      err.name = "TimeoutError";
      fail(err);
    }, timeoutMs);
    timer.unref?.();

    function cleanup() {
      clearTimeout(timer);
      for (const s of sockets) s.destroy?.();
    }
    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      // TLS 握手完成之前的一切失败：应用数据没发出去 ⇒ 服务端没收到、没执行、没扣点。
      reject(secureEstablished ? err : markConnectPhase(err));
    }
    function done(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    const proxyClient = proxy.protocol === "https:" ? https : http;

    // ── http:// 目标（只可能是本地开发基址，通常已被 loopback 豁免拦下）：绝对 URI 形式 ──
    if (target.protocol !== "https:") {
      const req = proxyClient.request(
        {
          host: proxy.host,
          port: proxy.port,
          method,
          path: targetUrl,                       // 走代理时请求行里是完整 URL，不是路径
          headers: { ...headers, Host: target.host, ...proxyAuthHeader(proxy) },
          agent: false
        },
        (res) => {
          secureEstablished = true;              // 响应头已到，后续失败按「连上之后」算
          collectResponse(res, done, fail);
        }
      );
      req.on("socket", (s) => sockets.push(s));
      req.on("error", fail);
      if (body !== undefined) req.write(body);
      req.end();
      return;
    }

    // ── https:// 目标：CONNECT 隧道 + 端到端 TLS ──
    // TLS 在隧道里是端到端的：代理只看得到域名和端口，**看不到 Authorization 头**，
    // 暴露面与用户现在用 curl 时完全相同。
    const connectReq = proxyClient.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: `${target.hostname}:${targetPort}`,
      headers: { Host: `${target.hostname}:${targetPort}`, ...proxyAuthHeader(proxy) },
      agent: false
    });

    connectReq.on("socket", (s) => sockets.push(s));
    connectReq.on("error", (err) => fail(err));

    connectReq.on("connect", (res, socket) => {
      sockets.push(socket);
      if (res.statusCode !== 200) {
        const err = new Error(`代理 ${proxy.display} 拒绝建立隧道（HTTP ${res.statusCode}）`);
        err.code = "ERR_PROXY_CONNECTION_FAILED";
        // 代理返回的状态码要能传到用户眼前：407 是「代理要认证」、403 是「代理不让连这个域名」，
        // 两者的下一步动作完全不同，只说一句"连不上"等于把这个信息丢了。
        err.dbyReason = `代理拒绝建立隧道 HTTP ${res.statusCode}`;
        fail(err);
        return;
      }

      const secure = tls.connect({ socket, servername: target.hostname }, () => {
        secureEstablished = true;
        // TLS 已经手动建好，剩下的只是这条加密通道上的明文 HTTP —— 所以用 http 而不是 https：
        // 让 http 模块只管协议，加密由我们自己的 TLSSocket 提供，不会再套一层 TLS。
        // 🔴 这里必须挂一个自定义 Agent 才能让 http 模块用我们这条已加密的 socket。
        // `agent: false` **不是**「不用 agent」——Node 会新建一个默认 Agent，于是
        // `createConnection` 被静默忽略，请求改走直连明文，服务端回
        // 「400 The plain HTTP request was sent to HTTPS port」。在能直连的机器上这只是报错，
        // 在只能走代理的机器上它会退化成 ENOTFOUND——也就是本变更要解决的那个症状本身。
        // 实现时真踩到了这一条，注释留着防回归。
        const agent = new http.Agent({ keepAlive: false });
        agent.createConnection = () => secure;
        const req = http.request(
          {
            agent,
            host: target.hostname,
            port: targetPort,
            method,
            path: `${target.pathname}${target.search}`,
            headers: { ...headers, Host: target.host }
          },
          (res2) => collectResponse(res2, done, fail)
        );
        req.on("error", fail);
        if (body !== undefined) req.write(body);
        req.end();
      });
      sockets.push(secure);
      secure.on("error", fail);
    });

    connectReq.end();
  });
}
