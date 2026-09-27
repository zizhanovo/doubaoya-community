// login.contract.test.mjs — tasks 2.8：`dby login` / `dby logout` 对**真**主仓 api（本地起的一份）的契约测试。
//
// 只在同时设了下面两个环境变量时运行，否则整组显式 skip 并打印原因（CI 与普通 `node --test` 默认跳过）：
//   DBY_API_BASE          本地主仓 api 的地址，如 http://127.0.0.1:48676（apps/api `npm start`，DATABASE_URL 指向下一条）
//   DBY_CONTRACT_DB_URL   同一个库的连接串（一次性容器），测试直接写库造「网页已登录的用户会话」、改过期时间
// 可选：DBY_CONTRACT_ORIGIN（默认 http://127.0.0.1:5173，须在 api 的 CORS_ORIGIN 名单里，网页侧 POST 要过 CSRF 闸）、
//       DBY_CONTRACT_SESSION_COOKIE（默认 doubaoya_session，= api 的 SESSION_COOKIE_NAME）。
//
// 网页侧动作（批准 / 拒绝 / 吊销）走真路由 /api/cli/device/decision、DELETE /api/keys/:id，带会话 cookie + Origin，
// 与浏览器同一条路；只有「造用户与会话」「把码改成已过期」「读 key 状态」直接写/读库。
// 覆盖：批准、拒绝、过期、--continue 续跑、slow_down 后间隔增加（以服务端为准）、invalid_grant（码已兑换）、
//       登出即吊销、离线登出（退出码 5 且凭证文件已删）、网页吊销后退出码 4。
// 本机跑法与一次实跑输出见 doubaoyahub docs/research/2026-09-26-wewrite/impl-B2-community.md。
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLI_BIN } from "./helpers.mjs";
import { connect, lit } from "./fixtures/pg-mini.mjs";

const API = process.env.DBY_API_BASE;
const DB_URL = process.env.DBY_CONTRACT_DB_URL;
const ORIGIN = process.env.DBY_CONTRACT_ORIGIN || "http://127.0.0.1:5173";
const COOKIE = process.env.DBY_CONTRACT_SESSION_COOKIE || "doubaoya_session";
// 5 秒间隔 → 0.5 秒；非 TTY 的 100 秒上限 → 10 秒。
const SCALE = "0.1";

const skipReason = !API || !DB_URL ? `未设置 ${[!API && "DBY_API_BASE", !DB_URL && "DBY_CONTRACT_DB_URL"].filter(Boolean).join(" 与 ")}，跳过对真服务端的登录契约测试` : false;
if (skipReason) console.log(`[login.contract] ${skipReason}`);

const credFile = (home) => path.join(home, ".doubaoya", "credentials");
const pendingFile = (home) => path.join(home, ".doubaoya", "login-pending.json");
const freshHome = () => mkdtempSync(path.join(tmpdir(), "dby-login-ct-"));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** 起 dby 子进程（stdin/stdout 都是管道 = 非 TTY）；onStderr 每来一段都回调，方便等用户码出现。 */
function startCli(argv, { home, env = {} }) {
  const child = spawn(process.execPath, [CLI_BIN, ...argv], {
    env: { PATH: process.env.PATH, HOME: home, DOUBAOYA_BASE_URL: API, DBY_LOGIN_TIME_SCALE: SCALE, ...env },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  const stderrWaiters = [];
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => {
    stderr += d;
    for (const w of [...stderrWaiters]) {
      const m = stderr.match(w.re);
      if (m) { stderrWaiters.splice(stderrWaiters.indexOf(w), 1); w.resolve(m); }
    }
  });
  const done = new Promise((resolve) => child.on("close", (code) => resolve({ code, stdout, stderr })));
  const waitStderr = (re, ms = 15_000) =>
    new Promise((resolve, reject) => {
      const m = stderr.match(re);
      if (m) return resolve(m);
      const w = { re, resolve };
      stderrWaiters.push(w);
      setTimeout(() => reject(new Error(`等 ${re} 超时；stderr=${stderr}`)), ms).unref();
    });
  return { done, waitStderr };
}

const runCli = (argv, opts) => startCli(argv, opts).done;
const USER_CODE_RE = /([A-Z0-9]{4}-[A-Z0-9]{4})/;

describe("dby login / logout × 真主仓 api（tasks 2.8）", { skip: skipReason }, () => {
  let db;
  let user;
  let sessionRaw;

  const web = async (method, p, body) => {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { Cookie: `${COOKIE}=${sessionRaw}`, Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, json: await res.json() };
  };
  const decide = async (userCode, approve) => {
    const r = await web("POST", "/api/cli/device/decision", { userCode, approve });
    assert.equal(r.status, 200, `网页侧 decision 失败：${JSON.stringify(r.json)}`);
    return r.json.data;
  };
  const row = async (userCode) =>
    (await db.query(`select status, "intervalSec", "apiKeyId" from "CliDeviceAuthorization" where "userCode" = ${lit(userCode.replace("-", ""))}`))[0];
  // 服务端按行记 intervalSec，默认 5 秒；客户端 0.1 倍速会一直撞 slow_down。非 slow_down 用例把这一行的间隔改成 0。
  const relaxInterval = (userCode) =>
    db.query(`update "CliDeviceAuthorization" set "intervalSec" = 0 where "userCode" = ${lit(userCode.replace("-", ""))}`);
  const keyStatus = async (prefix) =>
    (await db.query(`select id, status from "ApiKey" where "userId" = ${lit(user.id)} and prefix = ${lit(prefix)}`))[0];

  /** 发起一次登录并在网页上做出决定，返回 { result, userCode }。 */
  async function loginWith(home, approve) {
    const cli = startCli(["login", "--json"], { home });
    const [, userCode] = await cli.waitStderr(USER_CODE_RE);
    await relaxInterval(userCode);
    await decide(userCode, approve);
    return { result: await cli.done, userCode };
  }

  before(async () => {
    db = await connect(DB_URL);
    const tag = randomBytes(6).toString("hex");
    user = { id: `ct_${tag}`, email: `ct+${tag}@contract.test` };
    sessionRaw = `dus_ct_${randomBytes(24).toString("hex")}`;
    await db.query(
      `insert into "User" (id, email) values (${lit(user.id)}, ${lit(user.email)});
       insert into "UserSession" (id, "userId", "tokenHash", "expiresAt")
         values (${lit(`s_${tag}`)}, ${lit(user.id)}, ${lit(sha256(sessionRaw))}, now() + interval '1 hour');`
    );
    const who = await web("GET", "/api/keys");
    assert.equal(who.status, 200, `造出来的会话网页侧不认：${JSON.stringify(who.json)}`);
  });

  after(async () => {
    await db?.close();
  });

  test("批准：退出码 0，凭证 0600，前缀取自 key.prefix，账号取自应答 user，库里那把 key 归本人且 active", async () => {
    const home = freshHome();
    const { result: r, userCode } = await loginWith(home, true);
    assert.equal(r.code, 0, r.stderr);
    const data = JSON.parse(r.stdout).data;
    assert.equal(data.status, "logged_in");
    assert.equal(data.user.email, user.email);
    assert.match(r.stderr, /https:\/\/doubaoya\.com\/cli\/activate/);
    assert.ok(!r.stderr.includes(`activate?`), "确认网址不许带码");
    const cred = JSON.parse(readFileSync(credFile(home), "utf8"));
    assert.ok(!(r.stdout + r.stderr).includes(cred.apiKey), "🔴 完整 key 出现在输出里");
    assert.equal(data.keyPrefix, cred.apiKey.slice(0, data.keyPrefix.length));
    const k = await keyStatus(data.keyPrefix);
    assert.equal(k?.status, "active");
    assert.equal((await row(userCode)).apiKeyId, k.id);
    const w = await runCli(["whoami", "--json"], { home });
    assert.equal(w.code, 0, w.stderr);
    assert.equal(JSON.parse(w.stdout).data.keySource, "credentials");
  });

  test("拒绝：退出码 4（LOGIN_DENIED），不写凭证", async () => {
    const home = freshHome();
    const { result: r } = await loginWith(home, false);
    assert.equal(r.code, 4, r.stderr);
    assert.equal(JSON.parse(r.stdout).error.code, "LOGIN_DENIED");
    assert.equal(existsSync(credFile(home)), false);
    assert.equal(existsSync(pendingFile(home)), false);
  });

  test("--continue 续跑：非 TTY 先等到上限返回 pending（退出码 3），网页批准后 --continue 拿到 key", async () => {
    const home = freshHome();
    const first = await runCli(["login", "--json"], { home });
    assert.equal(first.code, 3, first.stderr);
    const pending = JSON.parse(first.stdout).error;
    assert.equal(pending.code, "LOGIN_PENDING");
    const userCode = first.stderr.match(USER_CODE_RE)[1];
    await relaxInterval(userCode);
    await decide(userCode, true);
    const r = await runCli(["login", "--continue", "--json"], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.status, "logged_in");
    assert.equal(existsSync(credFile(home)), true);
  });

  test("过期：库里把码改成已过期后 --continue → 退出码 4（LOGIN_EXPIRED），提示重新 dby login", async () => {
    const home = freshHome();
    const first = await runCli(["login", "--json"], { home });
    assert.equal(first.code, 3, first.stderr);
    const userCode = first.stderr.match(USER_CODE_RE)[1];
    await db.query(
      `update "CliDeviceAuthorization" set "expiresAt" = now() - interval '1 second', "intervalSec" = 0 where "userCode" = ${lit(userCode.replace("-", ""))}`
    );
    const r = await runCli(["login", "--continue", "--json"], { home });
    assert.equal(r.code, 4, r.stderr);
    const e = JSON.parse(r.stdout).error;
    assert.equal(e.code, "LOGIN_EXPIRED");
    assert.match(e.remediation ?? r.stderr, /dby login/);
    assert.equal(existsSync(pendingFile(home)), false);
  });

  test("slow_down：客户端轮询快于服务端间隔 → 间隔增加，且以服务端给的 extra.interval 为准", async () => {
    const home = freshHome();
    // 不放宽间隔：0.5 秒一轮必撞 slow_down。再把服务端这一行的间隔抬到 20 秒——客户端要是自己「+5」，
    // 会停在 10/15/…，与服务端的 25/30/… 对不上；两边都从 5 起步各加 5 的话这条用例分辨不出来（实测过）。
    const cli = startCli(["login", "--json"], { home });
    const [, userCode] = await cli.waitStderr(USER_CODE_RE);
    await db.query(`update "CliDeviceAuthorization" set "intervalSec" = 20 where "userCode" = ${lit(userCode.replace("-", ""))}`);
    const first = await cli.done;
    assert.equal(first.code, 3, first.stderr);
    const saved = JSON.parse(readFileSync(pendingFile(home), "utf8"));
    const server = await row(userCode);
    assert.ok(saved.interval > 20, `slow_down 后客户端间隔应大于服务端的 20 秒，实际 ${saved.interval}`);
    assert.equal(saved.interval, Number(server.intervalSec), "客户端间隔应以服务端 extra.interval 为准");
  });

  test("invalid_grant：已兑换过的设备码再 --continue → 退出码 4（LOGIN_INVALID_GRANT），不再轮询", async () => {
    const home = freshHome();
    const cli = startCli(["login", "--json"], { home });
    const [, userCode] = await cli.waitStderr(USER_CODE_RE);
    const snapshot = readFileSync(pendingFile(home), "utf8"); // 趁还在轮询时留一份设备码
    await relaxInterval(userCode);
    await decide(userCode, true);
    assert.equal((await cli.done).code, 0);
    writeFileSync(pendingFile(home), snapshot, { mode: 0o600 });
    const r = await runCli(["login", "--continue", "--json"], { home });
    assert.equal(r.code, 4, r.stderr);
    assert.equal(JSON.parse(r.stdout).error.code, "LOGIN_INVALID_GRANT");
    assert.equal(existsSync(pendingFile(home)), false);
  });

  test("登出即吊销：退出码 0，服务端那把 key 变 revoked，本地文件删除", async () => {
    const home = freshHome();
    const { result } = await loginWith(home, true);
    const prefix = JSON.parse(result.stdout).data.keyPrefix;
    const r = await runCli(["logout", "--json"], { home });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.status, "revoked");
    assert.equal(existsSync(credFile(home)), false);
    assert.equal((await keyStatus(prefix)).status, "revoked");
  });

  test("离线登出：服务端不可达 → 退出码 5，凭证文件已删，服务端 key 仍 active（提示去网页手动撤销）", async () => {
    const home = freshHome();
    const { result } = await loginWith(home, true);
    const prefix = JSON.parse(result.stdout).data.keyPrefix;
    const r = await runCli(["logout", "--json"], { home, env: { DOUBAOYA_BASE_URL: "http://127.0.0.1:9" } });
    assert.equal(r.code, 5, r.stderr);
    const e = JSON.parse(r.stdout).error;
    assert.equal(e.code, "LOGOUT_NOT_REVOKED");
    assert.match(e.remediation ?? "", new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(existsSync(credFile(home)), false);
    assert.equal((await keyStatus(prefix)).status, "active");
  });

  test("网页吊销后：whoami 退出码 4 并提示 dby login；再 logout 退出码 0（already_invalid）", async () => {
    const home = freshHome();
    const { result } = await loginWith(home, true);
    const prefix = JSON.parse(result.stdout).data.keyPrefix;
    const k = await keyStatus(prefix);
    const del = await web("DELETE", `/api/keys/${k.id}`);
    assert.equal(del.status, 200, JSON.stringify(del.json));
    const w = await runCli(["whoami", "--json"], { home });
    assert.equal(w.code, 4, w.stderr);
    assert.match(JSON.stringify(JSON.parse(w.stdout).error), /dby login/);
    const out = await runCli(["logout", "--json"], { home });
    assert.equal(out.code, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).data.status, "already_invalid");
  });
});
