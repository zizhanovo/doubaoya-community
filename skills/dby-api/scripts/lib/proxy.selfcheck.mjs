#!/usr/bin/env node
// proxy.selfcheck.mjs — 代理出网的行为断言。`node scripts/lib/proxy.selfcheck.mjs`
//
// 分两层验（判据见 openspec/changes/request-layer-proxy-support/design.md 第 5 条）：
//   · 纯函数层：代理发现、NO_PROXY、loopback 豁免、socks 报错、凭据不外泄——全覆盖。
//   · 握手层：用 node:net 起一个假代理（只绑 127.0.0.1），断言它收到的 CONNECT 行逐字
//     正确，并断言「TLS 握手完成」这条分界线真的决定了失败被判成哪一类。
// 零依赖签不出自签证书，所以不做 TLS 之后的正常收发——那段与直连路径是同一份代码。

import assert from "node:assert/strict";
import net from "node:net";
import { resolveProxy, requestViaProxy } from "./proxy.mjs";
import { classifyFetchError } from "./http.mjs";

const TARGET = "https://doubaoya.com/api/health";

// ───────────────────────── 一、代理发现 ─────────────────────────

// 1.1 查找顺序：https 目标先看 HTTPS_PROXY，http 目标先看 HTTP_PROXY，都回落 ALL_PROXY。
{
  const p = resolveProxy(TARGET, { HTTPS_PROXY: "http://proxy.corp:8080" });
  assert.equal(p.host, "proxy.corp");
  assert.equal(p.port, 8080);
  assert.equal(p.source, "HTTPS_PROXY");

  assert.equal(resolveProxy(TARGET, { HTTP_PROXY: "http://only-http:3128" }), null,
    "https 目标不该去读 HTTP_PROXY");
  assert.equal(resolveProxy("http://example.com/x", { HTTP_PROXY: "http://p:3128" }).port, 3128);
  assert.equal(resolveProxy(TARGET, { ALL_PROXY: "http://fallback:1080" }).host, "fallback");

  // 大小写同时存在：顺序固定、可重现（大写在前）。
  const both = resolveProxy(TARGET, { HTTPS_PROXY: "http://upper:1", https_proxy: "http://lower:2" });
  assert.equal(both.port, 1, "同名大小写都在时必须给出确定的选择");

  // 不带 scheme 的写法也认（curl 认，用户就会这么写）。
  assert.equal(resolveProxy(TARGET, { HTTPS_PROXY: "proxy.corp:8080" }).protocol, "http:");
  // 没配任何变量 = 直连，这是安全阀。
  assert.equal(resolveProxy(TARGET, {}), null);
}

// 1.2 NO_PROXY
{
  const env = (no) => ({ HTTPS_PROXY: "http://proxy.corp:8080", NO_PROXY: no });
  assert.equal(resolveProxy(TARGET, env("doubaoya.com")), null, "精确主机应豁免");
  assert.equal(resolveProxy(TARGET, env("*")), null, "* 应全豁免");
  assert.equal(resolveProxy("https://api.doubaoya.com/x", env(".doubaoya.com")), null, "子域应豁免");
  assert.equal(resolveProxy("https://api.doubaoya.com/x", env("doubaoya.com")), null,
    "不带点的条目同样匹配子域");
  assert.ok(resolveProxy(TARGET, env("other.com")), "不相干的条目不该豁免");
  assert.ok(resolveProxy(TARGET, env("notdoubaoya.com")), "后缀匹配不许匹配到不同的域");
  // 条目带端口：端口对不上就不算命中。
  assert.equal(resolveProxy("https://doubaoya.com:8443/x", env("doubaoya.com:8443")), null);
  assert.ok(resolveProxy("https://doubaoya.com:8443/x", env("doubaoya.com:9999")));
  assert.equal(resolveProxy(TARGET, env("doubaoya.com:443")), null, "默认端口也要能被匹配上");
  // 小写变量名同样生效。
  assert.equal(resolveProxy(TARGET, { HTTPS_PROXY: "http://p:1", no_proxy: "doubaoya.com" }), null);
}

// 1.3 loopback 硬豁免（不依赖用户配 NO_PROXY）——本地开发基址不许被代理劫走。
{
  const env = { HTTP_PROXY: "http://proxy.corp:8080", HTTPS_PROXY: "http://proxy.corp:8080" };
  for (const url of [
    "http://127.0.0.1:3000/api/health",
    "http://localhost:3000/api/health",
    "https://[::1]:3000/api/health",
    "http://127.9.9.9:3000/x"
  ]) {
    assert.equal(resolveProxy(url, env), null, `${url} 应硬豁免`);
  }
  // 反例：别把包含 localhost 字样的真实域名也豁免了。
  assert.ok(resolveProxy("https://notlocalhost.com/x", env));
}

// 1.4 socks 必须显式报错，且**不许**回落直连（回落 = 把这次报障原样重演）。
{
  for (const scheme of ["socks5", "socks5h", "socks4"]) {
    let thrown = null;
    try {
      resolveProxy(TARGET, { ALL_PROXY: `${scheme}://127.0.0.1:1080` });
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, `${scheme} 必须抛错而不是返回 null（返回 null 就是偷偷改走直连）`);
    assert.equal(thrown.code, "PROXY_UNSUPPORTED");
    assert.match(thrown.remediation, /http 代理端口/);
  }
  // 但 NO_PROXY 命中时压根不该走代理，也就不该因为协议不支持而报错。
  assert.equal(
    resolveProxy(TARGET, { ALL_PROXY: "socks5://127.0.0.1:1080", NO_PROXY: "doubaoya.com" }),
    null
  );
}

// 1.5 凭据只进 Proxy-Authorization，绝不进任何可打印字段。
{
  const p = resolveProxy(TARGET, { HTTPS_PROXY: "http://alice:s3cret@proxy.corp:8080" });
  assert.equal(p.auth.username, "alice");
  assert.doesNotMatch(p.display, /alice|s3cret/);
  assert.equal(p.display, "http://proxy.corp:8080");
}

// ───────────────────────── 二、握手层（假代理） ─────────────────────────

/** 起一个只绑 127.0.0.1 的假代理。handler 拿到首个请求文本，自己决定怎么回。 */
function fakeProxy(handler) {
  return new Promise((resolve, reject) => {
    const seen = [];
    const server = net.createServer((sock) => {
      sock.once("data", (buf) => {
        seen.push(buf.toString("utf8"));
        handler(sock, buf.toString("utf8"));
      });
      sock.on("error", () => {});
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, seen, close: () => server.close() });
    });
  });
}

/** 跑一次经代理的请求，返回被 classifyFetchError 判过的错误（成功则抛）。 */
async function failVia(proxyEnvValue, url = TARGET, timeoutMs = 5000) {
  const proxy = resolveProxy(url, { HTTPS_PROXY: proxyEnvValue, HTTP_PROXY: proxyEnvValue });
  try {
    await requestViaProxy(proxy, url, { method: "GET", headers: {}, timeoutMs });
  } catch (err) {
    return classifyFetchError(err, { billable: true, timeoutMs });
  }
  throw new Error("预期失败，却成功了");
}

let skipped = 0;
let realRoundTrip = false;
try {
  // 2.1 / 3.1 CONNECT 请求行与头逐字正确，凭据以 Basic 形式带上。
  {
    let tunnelBytes = null;
    const proxy = await fakeProxy((sock) => {
      sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // 隧道建成后客户端在**同一条 socket 上**发的第一段字节：TLS ClientHello（0x16 起头）。
      // 收得到就证明 tls.connect 真的用了隧道，而不是另开了一条到目标的连接。
      sock.once("data", (buf) => {
        tunnelBytes = buf;
        sock.destroy();
      });
    });
    const e = await failVia(`http://alice:s3cret@127.0.0.1:${proxy.port}`);
    proxy.close();

    assert.ok(tunnelBytes && tunnelBytes[0] === 0x16,
      "TLS 握手必须发生在隧道内——收不到 ClientHello 说明请求根本没走代理");

    const req = proxy.seen[0];
    assert.match(req, /^CONNECT doubaoya\.com:443 HTTP\/1\.1\r\n/, "CONNECT 请求行必须逐字正确");
    assert.match(req, /\r\nHost: doubaoya\.com:443\r\n/);
    const expected = `Basic ${Buffer.from("alice:s3cret").toString("base64")}`;
    assert.ok(req.includes(`Proxy-Authorization: ${expected}`), "带凭据时必须发 Proxy-Authorization");

    // 3.2 分界线：代理回了 200 但 TLS 握手没成 ⇒ 应用数据一个字节都没发出去，
    //     必须判成「连接从未建立」（重试安全），不许因为"隧道通了"就按可能已计费处理。
    assert.equal(e.code, "CONNECT_FAILED", "TLS 握手完成之前的失败必须判成连接从未建立");
    assert.match(e.remediation, /没有扣点/);
    // 3.5 失败路径的错误文本不许出现凭据的任何片段。
    for (const field of [e.message, e.remediation]) {
      assert.doesNotMatch(field, /alice|s3cret/, "凭据不许进错误输出");
    }
  }

  // 3.3 连不上代理本身。
  {
    const dead = await fakeProxy(() => {});
    const port = dead.port;
    dead.close();                                   // 端口随即无人监听
    const e = await failVia(`http://127.0.0.1:${port}`);
    assert.equal(e.code, "CONNECT_FAILED");
    assert.match(e.remediation, /没有扣点/);
  }

  // 3.4 代理拒绝 CONNECT：判成连接从未建立，且错误里带上代理返回的状态码。
  for (const status of [403, 407]) {
    const proxy = await fakeProxy((sock) => sock.end(`HTTP/1.1 ${status} Nope\r\n\r\n`));
    const e = await failVia(`http://127.0.0.1:${proxy.port}`);
    proxy.close();
    assert.equal(e.code, "CONNECT_FAILED");
    assert.match(e.message, new RegExp(String(status)), "错误里要带上代理返回的状态码");
  }

  // 2.5 超时语义与直连一致：代理收下连接却一直不回，必须落进 TIMEOUT 而不是 CONNECT_FAILED
  //     （超时 ≠ 本地已知失败，那条红线在代理路径上同样成立）。
  {
    const proxy = await fakeProxy(() => {});        // 收下就装死
    const e = await failVia(`http://127.0.0.1:${proxy.port}`, TARGET, 300);
    proxy.close();
    assert.equal(e.code, "TIMEOUT");
    assert.match(e.remediation, /别立刻重试/);
  }

  // 2.4 http:// 目标走绝对 URI 形式（不是路径），并且响应能被正常收成信封。
  {
    const proxy = await fakeProxy((sock) => {
      const bodyText = JSON.stringify({ success: true, data: { ok: 1 } });
      sock.end(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
          `Content-Length: ${Buffer.byteLength(bodyText)}\r\n\r\n${bodyText}`
      );
    });
    const url = "http://example.com/api/health";
    const p = resolveProxy(url, { HTTP_PROXY: `http://127.0.0.1:${proxy.port}` });
    const res = await requestViaProxy(p, url, { method: "GET", headers: {}, timeoutMs: 5000 });
    proxy.close();

    assert.match(proxy.seen[0], /^GET http:\/\/example\.com\/api\/health HTTP\/1\.1\r\n/,
      "走代理的 http 请求，请求行里必须是完整 URL");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, data: { ok: 1 } });
  }

  // ── 三、真实往返（可选）──
  // 上面那条 ClientHello 断言证明了 TLS 走隧道，但**TLS 之后的 HTTP 请求有没有走同一条
  // socket**，零依赖签不出证书就验不了——而那正是实现时真踩到的坑（`agent: false` 会让
  // Node 新建默认 Agent 并静默忽略 createConnection，请求改走直连明文）。
  // 所以：手上有真代理时就跑一次真实往返把这个缺口补上，没有就如实说明它没被验。
  if (process.env.DBY_SELFCHECK_PROXY) {
    const { request } = await import("./http.mjs");
    const saved = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = process.env.DBY_SELFCHECK_PROXY;
    try {
      const data = await request({ baseUrl: "https://doubaoya.com" }, "GET", "/api/skills/gpt-image-gen", {
        auth: "none"
      });
      assert.equal(data.slug, "gpt-image-gen", "经真代理拿回的应当是同一条能力的详情");
      realRoundTrip = true;
    } finally {
      if (saved === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = saved;
    }
  }
} catch (err) {
  // 受限环境里可能连 127.0.0.1 都不许监听。那种情况如实跳过并说明，**不算过**。
  if (err && (err.code === "EPERM" || err.code === "EACCES" || err.code === "EADDRNOTAVAIL")) {
    skipped += 1;
    console.warn(`⚠️ 握手层断言被跳过（本机不允许监听 127.0.0.1：${err.code}），纯函数层仍已全验`);
  } else {
    throw err;
  }
}

if (skipped) {
  console.log("ok proxy.selfcheck: 纯函数层全过；握手层因环境限制跳过");
} else if (realRoundTrip) {
  console.log("ok proxy.selfcheck: 全过，含经真代理到生产的一次真实往返");
} else {
  console.log(
    "ok proxy.selfcheck: 代理发现 / NO_PROXY / 豁免 / socks 报错 / CONNECT 握手 / 分类分界线 全过\n" +
      "   ⚠️ 未验：TLS 之后的 HTTP 请求是否走同一条 socket（零依赖签不出证书）。" +
      "有真代理时用 DBY_SELFCHECK_PROXY=http://主机:端口 再跑一次即可补上。"
  );
}
