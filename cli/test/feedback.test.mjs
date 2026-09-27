// feedback.test.mjs — `dby feedback`：submit_feedback.py --selfcheck 的行为断言移植，外加 tasks 3.3 的三种情形：
//   ① 端点未配置 → 落本地、告知路径、退出码 0、零出网（绊线子进程钉住）；
//   ② https 端点 → 本机回环 https 桩（openssl 现造自签证书，子进程用 NODE_EXTRA_CA_CERTS 信任它）
//      收到的与过目的那份逐字节一致；无 openssl 时退化成「https 地址被接受并真的去连了」；
//      另用原脚本允许的回环 http 桩覆盖同意闸 / 二遍扫描 / 失败降级这些分支；
//   ③ 明文 http 外网（含 http://localhost.evil.com 这类前缀骗局）→ USAGE（退出码 2），零出网。
// 🔴 测试里的假密钥全部运行时拼出，不落字面量（validate_community 与本命令自己的扫描都会拦字面量）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectMachineFacts, installId, scanSecrets, entropyBitsPerChar, ENTROPY_THRESHOLD, isAllowedFeedbackUrl,
  loadEndpointConfig, feedbackPrepare, feedbackSubmit, feedbackKeep, feedbackResetId, buildPayload, commands
} from "../src/commands/feedback.mjs";

const MODULE = fileURLToPath(new URL("../src/commands/feedback.mjs", import.meta.url));
const TRIPWIRE = fileURLToPath(new URL("./fixtures/net-tripwire.mjs", import.meta.url));

const FAKE_DYH = "dyh_" + "a1b2c3".repeat(3);
const FAKE_GH = "gh" + "p_" + "A".repeat(10) + "1".repeat(12);
const FAKE_SK = "sk-" + "proj-" + "Zx9".repeat(8);
const HIGH_ENTROPY = Array.from({ length: 10 }, (_, i) =>
  String.fromCharCode(65 + ((i * 7) % 26)) + String.fromCharCode(97 + ((i * 11) % 26)) + String(i % 10) + "+/"[i % 2]
).join("");

function machine(root) {
  const pkg = path.join(root, ".claude", "skills", "dby-write", ".dby");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(pkg, "origin.json"), JSON.stringify({
    slug: "dby-write", version: "1.0.0", hash: "abcdef123456", ref: "release-20260830-0001", installedAt: "2026-08-30T00:00:00Z",
    appid: "wx-forbidden-1", author: "forbidden-author", publicAccountName: "forbidden-account",
    targetAccount: "forbidden-target", ipProfile: "forbidden-profile", articleBody: "用户的文章正文"
  }));
  mkdirSync(path.join(root, ".dby"), { recursive: true });
  writeFileSync(path.join(root, ".dby", "lock.json"), JSON.stringify({
    version: 1,
    skills: { "dby-write": { version: "1.0.0", hash: "abcdef123456", installedAt: "2026-08-30T00:00:00Z", pinned: true, pinReason: "用户手写的自由文本，可能含任何东西" } }
  }));
  return root;
}

let tmp;
let root;
let payloadPath;
let payloadText;

before(() => {
  delete process.env.DOUBAOYA_FEEDBACK_URL;
  tmp = mkdtempSync(path.join(tmpdir(), "dby-feedback-"));
  root = machine(path.join(tmp, "machine-a"));
  const report = path.join(tmp, "report.md");
  writeFileSync(report, "# 反馈：排版脚本报错\n\n## 操作序列\n1. 跑了 render 脚本，退出码 1\n");
  payloadPath = path.join(tmp, "payload.json");
  const r = feedbackPrepare({ category: "bug", report, out: payloadPath, scopeRoot: root, agent: "claude-code", command: "1:python3 render.py" });
  payloadText = readFileSync(payloadPath, "utf8");
  assert.equal(r.human, payloadText, "人读形态打的必须就是 --out 那份（逐字节）");
});

after(() => {
  delete process.env.DOUBAOYA_FEEDBACK_URL;
});

const savedFiles = (r) => (existsSync(path.join(r, ".dby", "feedback")) ? readdirSync(path.join(r, ".dby", "feedback")) : []);

/** 子进程里跑一次 submit（可挂出网绊线 / 额外 env），返回 { out, net }。 */
function submitInChild(opts, { env = {}, tripwire = false } = {}) {
  const log = path.join(mkdtempSync(path.join(tmpdir(), "dby-fb-net-")), "net.log");
  writeFileSync(log, "");
  const script =
    `const m = await import(${JSON.stringify(MODULE)});` +
    `try { const r = await m.feedbackSubmit({}, ${JSON.stringify(opts)}); process.stdout.write(JSON.stringify({ ok: true, data: r.data })); }` +
    `catch (e) { process.stdout.write(JSON.stringify({ ok: false, code: e.code, exit: e.exit, data: e.data })); }`;
  return new Promise((resolve) => {
    execFile(process.execPath, [...(tripwire ? [`--import=${TRIPWIRE}`] : []), "--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, HOME: tmp, DBY_NET_LOG: log, ...env }, timeout: 30_000
    }, (err, stdout, stderr) => {
      resolve({ out: stdout ? JSON.parse(stdout) : { crash: stderr }, net: readFileSync(log, "utf8").trim() });
    });
  });
}

test("白名单采集：禁止字段/值一个都不进待发送结构，白名单内字段采到", () => {
  const facts = collectMachineFacts(root, "claude-code", [{ exit: 1, cmd: "node reconcile.mjs --dry-run" }]);
  const flat = JSON.stringify(facts);
  for (const forbidden of ["appid", "author", "publicAccountName", "targetAccount", "ipProfile", "articleBody", "forbidden", "pinReason", "自由文本", "文章正文"]) {
    assert.ok(!flat.includes(forbidden), `禁止字段/值进了待发送结构：${forbidden}`);
  }
  assert.equal(facts.packages[0].slug, "dby-write");
  assert.equal(facts.lock["dby-write"].pinned, true);
  assert.deepEqual(Object.keys(facts), ["node", "os", "agentType", "commands", "packages", "lock"]);
  assert.match(facts.node, /^v\d+/);
});

test("安装标识：两台机器不同、同机稳定、重置后变化、32 位十六进制", () => {
  const b = path.join(tmp, "machine-b");
  mkdirSync(b);
  const a1 = installId(root);
  assert.notEqual(a1, installId(b));
  assert.equal(installId(root), a1);
  feedbackResetId({ scopeRoot: root });
  const a2 = installId(root);
  assert.notEqual(a2, a1);
  assert.match(a2, /^[0-9a-f]{32}$/);
  assert.deepEqual(scanSecrets("installId: " + a2), [], "安装标识被误报为高熵串");
});

test("凭证/高熵检测：逐类命中、给位置、不回显内容；干净文本与占位形状不误报", () => {
  assert.ok(entropyBitsPerChar(HIGH_ENTROPY) >= ENTROPY_THRESHOLD);
  for (const [sample, rule] of [[FAKE_DYH, "doubaoya-key"], [FAKE_GH, "github-token"], [FAKE_SK, "openai-style-key"], [HIGH_ENTROPY, "high-entropy"]]) {
    const found = scanSecrets("前文\n报告里夹了 " + sample + " 这么一串\n后文");
    assert.ok(found.some((h) => h.rule === rule), `${rule} 没被扫出来`);
    assert.ok(found.every((h) => !JSON.stringify(h).includes(sample)), "命中内容泄进了检测结果");
    assert.equal(found[0].line, 2);
    assert.equal(found[0].col, 7, "列号按码点算（同 Python：「报告里夹了 」6 个码点之后）");
  }
  assert.deepEqual(scanSecrets("干净的中文叙述，含一条命令 node scripts/reconcile.mjs --dry-run 与哈希 abcdef123456"), []);
  assert.deepEqual(scanSecrets("dyh_" + "z".repeat(20)), [], "占位形状（无数字）不该命中");
  // 与 Python 的有意差别：汉字紧贴密钥时这里也拦（JS \b 按 ASCII 判词界）——只多拦不少拦
  assert.ok(scanSecrets("密钥" + FAKE_DYH).some((h) => h.rule === "doubaoya-key"));
});

test("prepare：载荷字段齐、撞凭证 → 退出码 3 且不落盘、命中位置进 data", () => {
  const p = JSON.parse(payloadText);
  assert.deepEqual(Object.keys(p), ["category", "report", "machineFacts", "installId", "skillVersion"]);
  assert.deepEqual(p.machineFacts.commands, [{ exit: 1, cmd: "python3 render.py" }]);
  assert.equal(buildPayload("bug", p.report, p.machineFacts, p.installId, loadEndpointConfig().fields), payloadText, "呈现/发送两份不是同一构造");

  const dirty = path.join(tmp, "dirty.md");
  writeFileSync(dirty, "报错原文里带着 " + FAKE_DYH + "\n");
  const out = path.join(tmp, "dirty-payload.json");
  assert.throws(
    () => feedbackPrepare({ category: "bug", report: dirty, out, scopeRoot: root }),
    (e) => e.code === "SECRET_DETECTED" && e.exit === 3 && e.data.hits.length > 0 && !JSON.stringify(e.data).includes(FAKE_DYH)
  );
  assert.ok(!existsSync(out), "命中时载荷不该落盘");
});

test("prepare：--commands-file 多条、坏格式 → USAGE、category 只认三类", () => {
  const list = path.join(tmp, "cmds.txt");
  writeFileSync(list, "0:dby doctor\n\n2:dby deai scan --file a.md\n");
  const out = path.join(tmp, "p2.json");
  const report = path.join(tmp, "report.md");
  feedbackPrepare({ category: "idea", report, out, scopeRoot: root, command: "1:x", commandsFile: list });
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")).machineFacts.commands.map((c) => c.exit), [1, 0, 2]);
  assert.throws(() => feedbackPrepare({ category: "idea", report, out, scopeRoot: root, command: "x:y" }), (e) => e.exit === 2);
  assert.throws(() => feedbackPrepare({ category: "other", report, out, scopeRoot: root }), (e) => e.exit === 2);
});

test("① 端点未配置：落本地 markdown、给绝对路径、退出码 0、内容完整、零出网（绊线子进程）", async () => {
  const r0 = path.join(tmp, "machine-unconfigured");
  const { out, net } = await submitInChild({ file: payloadPath, scopeRoot: r0 }, { tripwire: true });
  assert.equal(net, "", `端点未配置时出网了：${net}`);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.data.delivered, false);
  assert.equal(out.data.reason, "endpoint_not_configured");
  assert.ok(path.isAbsolute(out.data.savedTo) && out.data.savedTo.endsWith("-bug.md"));
  const saved = readFileSync(out.data.savedTo, "utf8");
  assert.ok(saved.includes("排版脚本报错") && saved.includes("机器事实"));
  // 未配置时不需要同意（什么都不出本机）——与 spec「反馈端点未配置 → 退出码 0」一致
  assert.equal(loadEndpointConfig({}).url, null, "出厂配置的 url 应为 null");
});

test("② 回环 http 桩：未同意零请求（退出码 6，--confirm 不算）；同意后逐字节一致；事后塞凭证被二遍扫描拦", async () => {
  const received = [];
  const server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url, body, ua: req.headers["user-agent"] });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, requestId: "req_selfcheck", data: {}, error: null, notice: "自检通道" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.DOUBAOYA_FEEDBACK_URL = `http://127.0.0.1:${server.address().port}/feedback`;
  try {
    await assert.rejects(feedbackSubmit({ confirm: true }, { file: payloadPath, scopeRoot: root }), (e) => e.code === "USER_CONSENT_REQUIRED" && e.exit === 6);
    assert.deepEqual(received, [], "未同意时不该有任何请求发出");

    const ok = await feedbackSubmit({}, { file: payloadPath, userConsented: true, scopeRoot: root });
    assert.deepEqual(ok.data, { delivered: true, requestId: "req_selfcheck", notice: "自检通道" });
    assert.equal(received.length, 1);
    assert.equal(received[0].body, payloadText, "发出的与过目的不是同一份（逐字节）");
    assert.equal(received[0].path, "/feedback");
    assert.match(received[0].ua, /^doubaoya-cli\//);

    const tampered = path.join(tmp, "tampered.json");
    writeFileSync(tampered, payloadText.slice(0, -2) + FAKE_DYH + payloadText.slice(-2));
    await assert.rejects(feedbackSubmit({}, { file: tampered, userConsented: true, scopeRoot: root }), (e) => e.code === "SECRET_DETECTED" && e.exit === 3);
    assert.equal(received.length, 1, "命中后不该再发请求");
  } finally {
    delete process.env.DOUBAOYA_FEEDBACK_URL;
    await new Promise((r) => server.close(r));
  }
});

test("② 端点失败降级：不可达 → 退出码 5 落本地；端点回 success:false → 退出码 1 落本地", async () => {
  const r1 = path.join(tmp, "machine-degrade");
  process.env.DOUBAOYA_FEEDBACK_URL = "http://127.0.0.1:1/unreachable";
  try {
    await assert.rejects(feedbackSubmit({}, { file: payloadPath, userConsented: true, scopeRoot: r1 }), (e) => {
      assert.equal(e.code, "FEEDBACK_UNREACHABLE");
      assert.equal(e.exit, 5);
      assert.ok(path.isAbsolute(e.data.savedTo) && existsSync(e.data.savedTo));
      return true;
    });
  } finally {
    delete process.env.DOUBAOYA_FEEDBACK_URL;
  }
  const server = createHttpServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { code: "RATE_LIMITED", message: "慢点" } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.DOUBAOYA_FEEDBACK_URL = `http://localhost:${server.address().port}/feedback`;
  try {
    await assert.rejects(feedbackSubmit({}, { file: payloadPath, userConsented: true, scopeRoot: r1 }), (e) => e.code === "FEEDBACK_REJECTED" && e.exit === 1 && /RATE_LIMITED/.test(e.message));
  } finally {
    delete process.env.DOUBAOYA_FEEDBACK_URL;
    await new Promise((r) => server.close(r));
  }
  assert.equal(savedFiles(r1).length, 2, "两次失败都该各落一份，互不覆盖");
});

function makeCert(dir) {
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"),
      "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
    return { key: readFileSync(path.join(dir, "k.pem")), cert: readFileSync(path.join(dir, "c.pem")), certPath: path.join(dir, "c.pem") };
  } catch {
    return null;
  }
}

test("② https 端点：回环 https 桩收到的与过目的逐字节一致（无 openssl 时退化为「https 被接受且真去连了」）", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "dby-fb-tls-"));
  const tls = makeCert(dir);
  if (tls) {
    const received = [];
    const server = createHttpsServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ path: req.url, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, requestId: "req_https" }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { out } = await submitInChild(
        { file: payloadPath, userConsented: true, scopeRoot: root },
        { env: { DOUBAOYA_FEEDBACK_URL: `https://127.0.0.1:${server.address().port}/feedback`, NODE_EXTRA_CA_CERTS: tls.certPath } }
      );
      assert.equal(out.ok, true, JSON.stringify(out));
      assert.equal(out.data.requestId, "req_https");
      assert.equal(received.length, 1);
      assert.equal(received[0].body, payloadText);
    } finally {
      await new Promise((r) => server.close(r));
    }
    return;
  }
  t.diagnostic("本机没有可用的 openssl：退化为 TCP 桩，只证明 https 地址被接受并真的发起了连接");
  let connections = 0;
  const tcp = createTcpServer((s) => {
    connections++;
    s.destroy();
  });
  await new Promise((r) => tcp.listen(0, "127.0.0.1", r));
  try {
    const { out } = await submitInChild(
      { file: payloadPath, userConsented: true, scopeRoot: path.join(tmp, "machine-tls") },
      { env: { DOUBAOYA_FEEDBACK_URL: `https://127.0.0.1:${tcp.address().port}/feedback` } }
    );
    assert.equal(out.code, "FEEDBACK_UNREACHABLE");
    assert.ok(connections >= 1, "https 地址没被真正尝试连接");
  } finally {
    await new Promise((r) => tcp.close(r));
  }
});

test("③ 拒绝明文 http 外网（含前缀骗局）：退出码 2、零出网；prepare 同样拒绝", async () => {
  for (const url of ["http://example.com/feedback", "http://localhost.evil.com/x", "http://127.0.0.1.evil.com/x", "ftp://127.0.0.1/x", "not a url"]) {
    assert.equal(isAllowedFeedbackUrl(url), false, `${url} 不该放行`);
    const { out, net } = await submitInChild({ file: payloadPath, userConsented: true, scopeRoot: root }, { env: { DOUBAOYA_FEEDBACK_URL: url }, tripwire: true });
    assert.equal(net, "", `${url} 居然出网了：${net}`);
    assert.equal(out.code, "FEEDBACK_URL_INSECURE", JSON.stringify(out));
    assert.equal(out.exit, 2);
  }
  for (const url of ["https://feedback.doubaoya.com/x", "http://127.0.0.1:8080/x", "http://localhost/x", "http://[::1]:9/x"]) {
    assert.equal(isAllowedFeedbackUrl(url), true, `${url} 应放行`);
  }
  process.env.DOUBAOYA_FEEDBACK_URL = "http://example.com/feedback";
  try {
    assert.throws(() => feedbackPrepare({ category: "bug", report: path.join(tmp, "report.md"), out: path.join(tmp, "p3.json"), scopeRoot: root }), (e) => e.code === "FEEDBACK_URL_INSECURE");
  } finally {
    delete process.env.DOUBAOYA_FEEDBACK_URL;
  }
});

test("keep：只落本地、零请求；同秒多份不覆盖；非载荷文件 → USAGE", async () => {
  const r2 = path.join(tmp, "machine-keep");
  const a = feedbackKeep({ file: payloadPath, scopeRoot: r2 });
  const b = feedbackKeep({ file: payloadPath, scopeRoot: r2 });
  assert.notEqual(a.data.savedTo, b.data.savedTo);
  assert.equal(savedFiles(r2).length, 2);
  const notPayload = path.join(tmp, "反馈.md");
  writeFileSync(notPayload, "# 只是一份报告\n");
  assert.throws(() => feedbackKeep({ file: notPayload, scopeRoot: r2 }), (e) => e.code === "PAYLOAD_INVALID" && e.exit === 2);
  await assert.rejects(feedbackSubmit({}, { file: notPayload, scopeRoot: r2 }), (e) => e.code === "PAYLOAD_INVALID");
  // 载荷里被改成路径穿越的 category 不许拼进文件名
  const evil = path.join(tmp, "evil.json");
  writeFileSync(evil, JSON.stringify({ ...JSON.parse(payloadText), category: "../../../pwn" }));
  const c = feedbackKeep({ file: evil, scopeRoot: r2 });
  assert.equal(path.dirname(c.data.savedTo), path.join(r2, ".dby", "feedback"));
  assert.match(path.basename(c.data.savedTo), /-feedback\.md$/);
});

test("命令表：四条都是 local、零路由、非计费", () => {
  assert.deepEqual(commands.map((c) => `${c.group} ${c.name}`), ["feedback prepare", "feedback submit", "feedback keep", "feedback reset-id"]);
  for (const c of commands) {
    assert.equal(c.kind, "local");
    assert.deepEqual(c.routes, []);
    assert.equal(c.billable, false);
  }
});
