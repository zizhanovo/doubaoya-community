// login.test.mjs — tasks 2.8（客户端部分）/ spec dby-cli-auth「设备码登录」「登出即吊销」。
// 对着本地假服务端跑（字段约定见 src/device-contract.mjs）；对真主仓 api 的契约测试留到集成阶段。
// 覆盖：批准、拒绝、过期、非 TTY 两步走（pending → --continue）、slow_down 后间隔增加、
//       离线登出（退出码 5 且文件已删）、网页吊销后退出码 4、logout 只用文件里的 key 且不碰 env。
// DBY_LOGIN_TIME_SCALE=0.01：5 秒间隔 → 50ms，非 TTY 100 秒上限 → 1 秒。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, startMock, ok } from "./helpers.mjs";

const NEW_KEY = "dyh_NewLoginKey1234567890abc";
const SCALE = "0.01";

const credFile = (home) => path.join(home, ".doubaoya", "credentials");
const pendingFile = (home) => path.join(home, ".doubaoya", "login-pending.json");
const freshHome = () => mkdtempSync(path.join(tmpdir(), "dby-login-"));

/**
 * 可编排的假设备码服务端。script：每次 token 轮询依次取出的应答（数组耗尽后重复最后一个）。
 * 应答写法："pending" | "slow_down" | "access_denied" | "expired_token" | "grant"。
 */
async function deviceServer(initialScript, { verificationUri = "https://doubaoya.com/cli/activate" } = {}) {
  let script = initialScript;
  const polls = [];
  const state = { starts: 0, logoutAuth: [], logoutBodies: [] };
  let i = 0;
  const setScript = (next) => {
    script = next;
    i = 0;
  };
  const mock = await startMock({
    "POST /api/cli/device/start": (req, url, body) => {
      state.starts += 1;
      state.startBody = body;
      return ok({ deviceCode: `dev-${state.starts}`, userCode: "ABCD-EFGH", verificationUri, expiresIn: 600, interval: 5 });
    },
    "POST /api/cli/device/token": (req, url, body) => {
      polls.push({ at: Date.now(), deviceCode: body?.deviceCode });
      const step = script[Math.min(i++, script.length - 1)];
      // 形状照主仓 apps/api/src/modules/cli/routes.ts：成功 {apiKey, key:{id,name,prefix}, user:{id,email}}；
      // 失败是信封 error.code，slow_down 带 extra.interval（服务端的新间隔秒数）。
      if (step === "grant") {
        return {
          status: 200,
          json: ok({ apiKey: NEW_KEY, key: { id: "k1", name: "dby login", prefix: NEW_KEY.slice(0, 8) }, user: { id: "u1", email: "me@example.com" } })
        };
      }
      const code = step === "pending" ? "authorization_pending" : typeof step === "object" ? step.code : step;
      const extra = typeof step === "object" && step.interval ? { interval: step.interval } : undefined;
      return { status: 400, json: { success: false, error: { code, message: code, ...(extra ? { extra } : {}) } } };
    },
    "GET /api/agent/whoami": (req) =>
      req.headers.authorization === `Bearer ${NEW_KEY}` && !state.revoked
        ? ok({ user: { id: "u1", email: "me@example.com" }, authVia: "apiKey" })
        : { status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "无效" } } },
    "POST /api/cli/logout": (req, url, body) => {
      state.logoutAuth.push(req.headers.authorization);
      state.logoutBodies.push(body);
      state.revoked = true;
      return ok({ revoked: true, key: { id: "k1", prefix: NEW_KEY.slice(0, 8) } });
    }
  });
  return { mock, polls, state, setScript };
}

const env = (mock, home, extra = {}) => ({ HOME: home, DOUBAOYA_BASE_URL: mock.url, DBY_LOGIN_TIME_SCALE: SCALE, ...extra });

function assertNoKey(r) {
  assert.ok(!(r.stdout + r.stderr).includes(NEW_KEY), "🔴 完整 key 出现在输出里");
}

test("批准：写入 0600 凭证文件（目录 0700），输出账号标识与前缀、不含完整 key，网址不含码", async () => {
  const { mock, state } = await deviceServer(["pending", "pending", "grant"]);
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: env(mock, home) });
    assert.equal(r.code, 0, r.stderr);
    const { data } = JSON.parse(r.stdout);
    assert.equal(data.status, "logged_in");
    assert.equal(data.user.email, "me@example.com");
    assert.equal(data.keyPrefix, NEW_KEY.slice(0, 8));
    assert.match(r.stderr, /ABCD-EFGH/, "用户码要打给人看");
    assert.match(r.stderr, /https:\/\/doubaoya\.com\/cli\/activate/);
    const printedUrl = r.stderr.match(/https?:\/\/[A-Za-z0-9./:?=&_-]+/)[0];
    assert.equal(printedUrl, "https://doubaoya.com/cli/activate", "确认网址不许带码");
    assertNoKey(r);
    assert.equal(statSync(credFile(home)).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(credFile(home))).mode & 0o777, 0o700);
    assert.equal(JSON.parse(readFileSync(credFile(home), "utf8")).apiKey, NEW_KEY);
    assert.equal(existsSync(pendingFile(home)), false, "成功后轮询状态文件要清掉");
    assert.deepEqual(state.startBody, {}, "发起请求不带任何自报描述字段");
    // 登录后 whoami 走凭证文件
    const w = await runCli(["whoami", "--json"], { env: env(mock, home) });
    assert.equal(w.code, 0, w.stderr);
    assert.equal(JSON.parse(w.stdout).data.keySource, "credentials");
    assertNoKey(w);
  } finally {
    await mock.close();
  }
});

test("拒绝：退出码 4，不写凭证文件", async () => {
  const { mock } = await deviceServer(["pending", "access_denied"]);
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: env(mock, home) });
    assert.equal(r.code, 4, r.stderr);
    assert.equal(JSON.parse(r.stdout).error.code, "LOGIN_DENIED");
    assert.equal(existsSync(credFile(home)), false);
    assert.equal(existsSync(pendingFile(home)), false);
  } finally {
    await mock.close();
  }
});

test("过期：--continue 得到过期错误并提示重新 dby login", async () => {
  const { mock, setScript } = await deviceServer(["pending"]);
  try {
    const home = freshHome();
    // 第一步：非 TTY 等到上限返回 pending（这段时间里没人确认）
    const first = await runCli(["login", "--json"], { env: env(mock, home) });
    assert.equal(first.code, 3, first.stderr);
    // 第二步：续跑时服务端判过期（10 分钟到了）
    setScript(["expired_token"]);
    const r = await runCli(["login", "--continue", "--json"], { env: env(mock, home) });
    assert.equal(r.code, 4, r.stderr);
    const e = JSON.parse(r.stdout).error;
    assert.equal(e.code, "LOGIN_EXPIRED");
    assert.match(e.remediation, /dby login/);
    assert.equal(existsSync(credFile(home)), false);
    assert.equal(existsSync(pendingFile(home)), false);
  } finally {
    await mock.close();
  }
});

test("非 TTY 两步走：约 100 秒（缩放后 1 秒）内返回 pending（退出码 3，带用户码与网址），--continue 续跑到批准", async () => {
  const { mock, polls, state, setScript } = await deviceServer(["pending"]);
  const home = freshHome();
  try {
    const t0 = Date.now();
    const r = await runCli(["login", "--json"], { env: env(mock, home) });
    const elapsed = Date.now() - t0;
    assert.equal(r.code, 3, r.stderr);
    const envl = JSON.parse(r.stdout);
    assert.equal(envl.error.code, "LOGIN_PENDING");
    assert.equal(envl.data.status, "pending");
    assert.equal(envl.data.userCode, "ABCD-EFGH");
    assert.match(envl.error.remediation, /dby login --continue/);
    assert.ok(elapsed < 5000, `非 TTY 等太久了：${elapsed}ms`);
    assert.ok(polls.length >= 2, "上限内应当轮询了多次");
    assert.equal(statSync(pendingFile(home)).mode & 0o777, 0o600, "轮询状态文件含设备码，同样 0600");

    setScript(["pending", "grant"]);
    const before = polls.length;
    const r2 = await runCli(["login", "--continue", "--json"], { env: env(mock, home) });
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(state.starts, 1, "--continue 不该重新发起");
    assert.ok(polls.slice(before).every((p) => p.deviceCode === "dev-1"), "续跑用的是第一次拿到的设备码");
    assert.equal(JSON.parse(readFileSync(credFile(home), "utf8")).apiKey, NEW_KEY);
  } finally {
    await mock.close();
  }
});

test("--continue 没有进行中的登录：退出码 3，提示先 dby login", async () => {
  const { mock } = await deviceServer(["grant"]);
  try {
    const r = await runCli(["login", "--continue", "--json"], { env: env(mock, freshHome()) });
    assert.equal(r.code, 3);
    assert.equal(JSON.parse(r.stdout).error.code, "LOGIN_NOT_STARTED");
  } finally {
    await mock.close();
  }
});

test("slow_down：之后的轮询间隔增加 5 秒（缩放后 +50ms）", async () => {
  const { mock, polls } = await deviceServer(["pending", "pending", "slow_down", "pending", "grant"]);
  try {
    const r = await runCli(["login", "--json"], { env: env(mock, freshHome()) });
    assert.equal(r.code, 0, r.stderr);
    const gaps = polls.slice(1).map((p, i) => p.at - polls[i].at);
    // gaps[0],gaps[1] 在 slow_down 之前（间隔 5s→50ms）；gaps[2],gaps[3] 在之后（10s→100ms）
    const before = Math.max(gaps[0], gaps[1]);
    const after = Math.min(gaps[2], gaps[3]);
    assert.ok(after >= 95, `slow_down 之后间隔应 ≥100ms 量级，实际 ${gaps.join("/")}ms`);
    assert.ok(after > before + 25, `slow_down 前后间隔没有拉开：${gaps.join("/")}ms`);
  } finally {
    await mock.close();
  }
});

test("slow_down 带 extra.interval：以服务端给的间隔为准（不是自己加 5 秒）", async () => {
  const { mock, polls } = await deviceServer(["pending", { code: "slow_down", interval: 20 }, "pending", "grant"]);
  try {
    const r = await runCli(["login", "--json"], { env: env(mock, freshHome()) });
    assert.equal(r.code, 0, r.stderr);
    const gaps = polls.slice(1).map((p, i) => p.at - polls[i].at);
    // gaps[0] 在 slow_down 之前（5s→50ms）；gaps[1]、gaps[2] 在之后：服务端说 20s → 200ms（自己加 5 秒只会是 100ms）
    assert.ok(Math.min(gaps[1], gaps[2]) >= 190, `应按服务端的 20 秒（缩放后 200ms）轮询，实际 ${gaps.join("/")}ms`);
  } finally {
    await mock.close();
  }
});

test("invalid_grant（码不存在或已兑换）：终止失败，退出码 4，提示重新 dby login，清掉轮询状态", async () => {
  const { mock, polls } = await deviceServer(["pending", "invalid_grant", "grant"]);
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: env(mock, home) });
    assert.equal(r.code, 4, r.stderr);
    const e = JSON.parse(r.stdout).error;
    assert.equal(e.code, "LOGIN_INVALID_GRANT");
    assert.match(e.remediation, /dby login/);
    assert.equal(polls.length, 2, "invalid_grant 之后不许再轮询");
    assert.equal(existsSync(credFile(home)), false);
    assert.equal(existsSync(pendingFile(home)), false);
  } finally {
    await mock.close();
  }
});

test("登出：只用凭证文件里的 key 请求吊销（不碰 env）、body 不带 key 标识、删除文件，退出码 0", async () => {
  const { mock, state } = await deviceServer(["grant"]);
  try {
    const home = freshHome();
    assert.equal((await runCli(["login", "--json"], { env: env(mock, home) })).code, 0);
    const r = await runCli(["logout", "--json"], { env: env(mock, home, { DOUBAOYA_API_KEY: "dyh_EnvKeyMustNotBeRevoked99" }) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.status, "revoked");
    assert.deepEqual(state.logoutAuth, [`Bearer ${NEW_KEY}`], "吊销请求必须用文件里的那把，不是环境变量里的");
    assert.ok(state.logoutBodies.every((b) => b === undefined || Object.keys(b).length === 0), "吊销请求 body 不带任何 key 标识");
    assert.equal(existsSync(credFile(home)), false);
    assertNoKey(r);
    // 网页已吊销 → 之后任何需要鉴权的命令退出码 4（这里文件也删了，所以是缺 key 的 4）
    const w = await runCli(["whoami", "--json"], { env: env(mock, home) });
    assert.equal(w.code, 4);
  } finally {
    await mock.close();
  }
});

test("网页上吊销后：whoami 退出码 4，remediation 提示重新 dby login", async () => {
  const { mock, state } = await deviceServer(["grant"]);
  try {
    const home = freshHome();
    assert.equal((await runCli(["login", "--json"], { env: env(mock, home) })).code, 0);
    state.revoked = true; // 模拟用户在密钥中心提示条上点了吊销
    const w = await runCli(["whoami", "--json"], { env: env(mock, home) });
    assert.equal(w.code, 4);
    assert.match(JSON.parse(w.stdout).error.remediation, /dby login/);
  } finally {
    await mock.close();
  }
});

test("离线登出：本地文件照样删除，退出码 5，指引到网页手动撤销", async () => {
  const { mock } = await deviceServer(["grant"]);
  const home = freshHome();
  assert.equal((await runCli(["login", "--json"], { env: env(mock, home) })).code, 0);
  const deadUrl = mock.url;
  await mock.close(); // 服务端不可达
  const r = await runCli(["logout", "--json"], { env: { HOME: home, DOUBAOYA_BASE_URL: deadUrl } });
  assert.equal(r.code, 5, r.stderr);
  const e = JSON.parse(r.stdout).error;
  assert.equal(e.code, "LOGOUT_NOT_REVOKED");
  assert.match(e.remediation, /密钥中心/);
  assert.equal(existsSync(credFile(home)), false, "离线也要删本地文件");
  assertNoKey(r);
});

test("没登录过就 logout：退出码 0，说明不碰环境变量", async () => {
  const r = await runCli(["logout", "--json"], { env: { HOME: freshHome(), DOUBAOYA_API_KEY: "dyh_EnvOnly1234567890" } });
  assert.equal(r.code, 0);
  const { data } = JSON.parse(r.stdout);
  assert.equal(data.status, "not_logged_in");
  assert.equal(data.envKeyPresent, true);
});

// ── 自动开浏览器（best-effort，BROWSER → 平台默认；非 TTY 不拉）──

test("openBrowser：BROWSER 覆盖优先，URL 作唯一参数；平台默认 darwin→open / 其它→xdg-open；spawn 同步抛错不算失败", async () => {
  const { openBrowser } = await import("../src/commands/auth.mjs");
  const calls = [];
  const fakeSpawn = (cmd, args) => {
    calls.push([cmd, args]);
    return { on() {} };
  };
  assert.equal(openBrowser("https://x.example", { env: { BROWSER: "/custom/browser" }, spawnFn: fakeSpawn }), "/custom/browser");
  assert.deepEqual(calls.at(-1), ["/custom/browser", ["https://x.example"]]);
  assert.equal(openBrowser("https://x.example", { env: {}, platform: "darwin", spawnFn: fakeSpawn }), "open");
  assert.equal(openBrowser("https://x.example", { env: {}, platform: "linux", spawnFn: fakeSpawn }), "xdg-open");
  assert.equal(openBrowser("https://x.example", { env: {}, platform: "win32", spawnFn: fakeSpawn }), "cmd");
  assert.deepEqual(calls.at(-1), ["cmd", ["/c", "start", "", "https://x.example"]]);
  const throwing = () => {
    throw new Error("sync spawn failure");
  };
  assert.equal(openBrowser("https://x.example", { env: {}, spawnFn: throwing }), null);
});

test("非 TTY（agent 调用）不拉浏览器：BROWSER 指到标记脚本也不会被调用", async () => {
  const { mock } = await deviceServer(["grant"]);
  try {
    const home = freshHome();
    const marker = path.join(home, "browser-called");
    const script = path.join(home, "fake-browser.sh");
    const { writeFileSync, chmodSync } = await import("node:fs");
    writeFileSync(script, `#!/bin/sh\necho "$1" > "${marker}"\n`);
    chmodSync(script, 0o755);
    const r = await runCli(["login", "--json"], { env: env(mock, home, { BROWSER: script }) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(existsSync(marker), false, "agent/非交互场景不该拉浏览器");
    assertNoKey(r);
  } finally {
    await mock.close();
  }
});

// ── 回环授权 + 并行竞速（dby-login-loopback 4.3）──────────────────────────────
// runCli 的子进程不是 TTY，竞速路径用 DBY_LOGIN_FORCE_RACE=1 触发——它完整模拟交互终端
// （含 openBrowser 放行），单测里用 BROWSER=/bin/false 中和，不真弹浏览器。「浏览器」由 mock 的 loopback/start 处理器
// fire-and-forget 地回打 CLI 的本机监听来模拟。服务端 PKCE 反例（只持 code 换不出 key）钉在
// 主仓 loopback.postgres.test.ts 的真库里——这里钉的是客户端形状：verifier 与 challenge 对得上。

const LOOP_KEY = "dyh_LoopWinnerKey1234567890abcdef";

import { createHash } from "node:crypto";

function sha256b64u(s) {
  return createHash("sha256").update(s, "utf8").digest("base64url");
}

/**
 * 竞速假服务端。loopback ∈ grant（回调正确 code）| deny | invalid_token（兑换被拒）|
 * start_fail | late（设备码赢后才回调——应被静默丢弃）。cbDelayMs 控制回调时机。
 */
async function raceServer({ loopback = "grant", deviceScript = ["pending"], cbDelayMs = 120 } = {}) {
  const state = { loopbackStarts: [], loopbackTokens: [], pkceShapeOk: null, probes: [] };
  const mock = await startMock({
    "POST /api/cli/device/start": () => ok({ deviceCode: "dev-race", userCode: "RACE-CODE", verificationUri: "https://doubaoya.com/cli/activate", expiresIn: 600, interval: 5 }),
    "POST /api/cli/device/token": (req, url, body) => {
      state.devicePolls = (state.devicePolls ?? 0) + 1;
      const step = deviceScript[Math.min(state.devicePolls - 1, deviceScript.length - 1)];
      if (step === "grant") {
        return { status: 200, json: ok({ apiKey: NEW_KEY, key: { id: "k1", name: "dby login", prefix: NEW_KEY.slice(0, 8) }, user: { id: "u1", email: "me@example.com" } }) };
      }
      const code = step === "pending" ? "authorization_pending" : step;
      return { status: 400, json: { success: false, error: { code, message: code } } };
    },
    "POST /api/cli/loopback/start": (req, url, body) => {
      state.loopbackStarts.push(body);
      if (loopback === "start_fail") return { status: 500, json: { success: false, error: { code: "INTERNAL", message: "x" } } };
      const { port, state: cbState } = body;
      // 模拟浏览器（fire-and-forget）：先打三个坏探针（错 state / 非 GET / 异路径），
      // CLI 都必须忽略并继续等待；再按需回调。
      const base = `http://127.0.0.1:${port}/cb`;
      const probe = (u, init) => fetch(u, init).then((r) => state.probes.push(r.status)).catch(() => state.probes.push(0));
      (async () => {
        await probe(`${base}?code=evil&state=WRONG`);
        await probe(`${base}?code=evil&state=${encodeURIComponent(cbState)}`, { method: "POST" });
        await probe(`http://127.0.0.1:${port}/other?state=${encodeURIComponent(cbState)}`);
        if (loopback === "deny") {
          await probe(`${base}?error=access_denied&state=${encodeURIComponent(cbState)}`);
          return;
        }
        await new Promise((r) => setTimeout(r, cbDelayMs));
        await probe(`${base}?code=dyc_race_code&state=${encodeURIComponent(cbState)}`);
      })();
      return ok({ authorizeUrl: `https://doubaoya.com/cli/authorize?d=dyl_${"0".repeat(64)}`, expiresIn: 600 });
    },
    "POST /api/cli/loopback/token": (req, url, body) => {
      state.loopbackTokens.push(body);
      if (loopback === "invalid_token") return { status: 400, json: { success: false, error: { code: "invalid_grant", message: "x" } } };
      const started = state.loopbackStarts.at(-1);
      state.pkceShapeOk = Boolean(
        started && typeof body?.codeVerifier === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(body.codeVerifier) &&
        sha256b64u(body.codeVerifier) === started.codeChallenge
      );
      return { status: 200, json: ok({ apiKey: LOOP_KEY, key: { id: "k2", name: "dby login（loopback）", prefix: LOOP_KEY.slice(0, 8) }, user: { id: "u1", email: "me@example.com" } }) };
    },
    "GET /api/agent/whoami": (req) =>
      [NEW_KEY, LOOP_KEY].includes(req.headers.authorization?.slice(7))
        ? ok({ user: { id: "u1", email: "me@example.com" }, authVia: "apiKey" })
        : { status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "无效" } } },
    "POST /api/cli/logout": (req) => {
      state.logouts = state.logouts ?? [];
      state.logouts.push(req.headers.authorization?.slice(7));
      return ok({ revoked: true, key: { id: "kx", prefix: "dyh_…" } });
    }
  });
  return { mock, state };
}

const raceEnv = (mock, home, extra = {}) => ({ HOME: home, DOUBAOYA_BASE_URL: mock.url, DBY_LOGIN_TIME_SCALE: SCALE, DBY_LOGIN_FORCE_RACE: "1", BROWSER: "/bin/false", ...extra });

test("竞速全链：坏探针忽略、PKCE 形状正确、回环赢、备用码在终端、凭证落盘", async () => {
  const { mock, state } = await raceServer({ loopback: "grant", deviceScript: ["pending"] });
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: raceEnv(mock, home) });
    assert.equal(r.code, 0, r.stderr);
    const creds = JSON.parse(readFileSync(credFile(home), "utf8"));
    assert.equal(creds.apiKey, LOOP_KEY);
    assert.match(r.stderr, /备用路径/);
    assert.match(r.stderr, /RACE-CODE/);
    assert.equal(state.pkceShapeOk, true, "verifier 的 S256 必须等于 start 上送的 challenge");
    assert.deepEqual(state.probes.slice(0, 3), [404, 404, 404], "错 state / 非 GET / 异路径都不应答");
    assert.ok(state.devicePolls >= 1, "设备码链在并行轮询");
    assert.equal((state.logouts ?? []).length, 0, "没有第二把 key 需要吊销");
    assertNoKey(r);
  } finally {
    await mock.close();
  }
}, 30_000);

test("拒绝即止：error=access_denied 回调 → 退出码 4、不写凭证、不走另一条、不吊销", async () => {
  const { mock, state } = await raceServer({ loopback: "deny", deviceScript: ["pending"] });
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: raceEnv(mock, home) });
    assert.equal(r.code, 4, r.stderr);
    assert.equal(JSON.parse(r.stdout).error.code, "LOGIN_DENIED");
    assert.equal(existsSync(credFile(home)), false);
    assert.equal((state.logouts ?? []).length, 0);
  } finally {
    await mock.close();
  }
}, 30_000);

test("回环兑换失败不是终态：设备码兜底完成登录", async () => {
  const { mock, state } = await raceServer({ loopback: "invalid_token", deviceScript: ["pending", "pending", "grant"] });
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: raceEnv(mock, home) });
    assert.equal(r.code, 0, r.stderr);
    const creds = JSON.parse(readFileSync(credFile(home), "utf8"));
    assert.equal(creds.apiKey, NEW_KEY, "设备码侧兑现");
    assert.ok(state.loopbackTokens.length >= 1, "回环确实先试过并失败");
  } finally {
    await mock.close();
  }
}, 30_000);

test("单链 start 失败另一条单独继续：loopback/start 500 → 设备码完成", async () => {
  const { mock, state } = await raceServer({ loopback: "start_fail", deviceScript: ["pending", "grant"] });
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: raceEnv(mock, home) });
    assert.equal(r.code, 0, r.stderr);
    const creds = JSON.parse(readFileSync(credFile(home), "utf8"));
    assert.equal(creds.apiKey, NEW_KEY);
    assert.equal(state.loopbackTokens.length, 0);
  } finally {
    await mock.close();
  }
}, 30_000);

test("设备码赢后迟到的回环回调被静默丢弃：不兑换、不产生第二把 key", async () => {
  const { mock, state } = await raceServer({ loopback: "late", deviceScript: ["pending", "grant"], cbDelayMs: 250 });
  try {
    const home = freshHome();
    const r = await runCli(["login", "--json"], { env: raceEnv(mock, home) });
    assert.equal(r.code, 0, r.stderr);
    const creds = JSON.parse(readFileSync(credFile(home), "utf8"));
    assert.equal(creds.apiKey, NEW_KEY);
    assert.equal(state.loopbackTokens.length, 0, "迟到回调不再兑换");
    assert.equal((state.logouts ?? []).length, 0);
  } finally {
    await mock.close();
  }
}, 30_000);

test("--device 跳过回环：loopback/start 从未被调用", async () => {
  const { mock, state } = await raceServer({ loopback: "grant", deviceScript: ["pending", "grant"] });
  try {
    const home = freshHome();
    const r = await runCli(["login", "--device", "--json"], { env: raceEnv(mock, home) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(state.loopbackStarts.length, 0);
    const creds = JSON.parse(readFileSync(credFile(home), "utf8"));
    assert.equal(creds.apiKey, NEW_KEY);
  } finally {
    await mock.close();
  }
}, 30_000);
