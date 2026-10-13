// auth.mjs — `dby login` / `dby logout`（spec dby-cli-auth「设备码登录」「登出即吊销」，design D9）。
//
// login：向服务端要一对（设备码、用户码），打印**用户码**与**不含码**的确认网址，让用户在已登录的
//   网页上手动输入并批准；交互终端下 best-effort 自动打开该确认页（BROWSER 可覆盖，拉不起来退回手动）；
//   CLI 按 RFC 8628 轮询换 key，写进 ~/.doubaoya/credentials（0600）。
//   · TTY：阻塞到批准 / 拒绝 / 过期为止。
//   · 非 TTY（agent 调用）：单次命令最多等约 100 秒，没等到就以 LOGIN_PENDING（退出码 3，业务态）
//     返回用户码与网址；之后 `dby login --continue` 接着轮询。轮询状态存 ~/.doubaoya/login-pending.json（0600）。
// logout：先请求服务端吊销**凭证文件里那一把** key，再删文件；服务端不可达时照样删文件并以退出码 5
//   明说「服务端未吊销」。环境变量里的 key 一概不碰。
//
// 🔴 key 明文只在内存里走到凭证文件；任何输出都只有前缀。
// 字段约定全部在 ../device-contract.mjs。
// 测试旋钮：DBY_LOGIN_TIME_SCALE（默认 1）同比缩放所有等待（轮询间隔、非 TTY 的 100 秒上限），
//   只为让契约测试不必真等 5 秒；生产不设它。

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { warn } from "../output.mjs";
import {
  credentialsPath,
  deleteCredentials,
  doubaoyaDir,
  keyPrefixOf,
  readCredentials,
  writeCredentials,
  writeJsonPrivate
} from "../credentials.mjs";
import {
  DEVICE_START_PATH,
  DEVICE_TOKEN_PATH,
  LOGOUT_PATH,
  LOOPBACK_START_PATH,
  LOOPBACK_TOKEN_PATH,
  POLL,
  SLOW_DOWN_STEP_SECONDS,
  loopbackStartRequestBody,
  loopbackTokenRequestBody,
  parseLoopbackStart,
  parseLoopbackToken,
  parseLogout,
  parseStart,
  parseToken,
  tokenRequestBody
} from "../device-contract.mjs";

/** 非 TTY 下单次 `dby login` 最多等多久（毫秒，未缩放）。agent 的单条命令一般有 2 分钟左右的时限。 */
export const NON_TTY_WAIT_MS = 100_000;

const pendingPath = () => path.join(doubaoyaDir(), "login-pending.json");

function timeScale() {
  const v = Number(process.env.DBY_LOGIN_TIME_SCALE);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPending() {
  const file = pendingPath();
  if (!existsSync(file)) return null;
  try {
    const p = JSON.parse(readFileSync(file, "utf8"));
    return typeof p?.deviceCode === "string" ? p : null;
  } catch {
    return null;
  }
}

const clearPending = () => rmSync(pendingPath(), { force: true });

function instructions(p, openedWith) {
  const head = openedWith
    ? `已尝试打开浏览器（${openedWith}）；没弹出来的话，手动打开 ${p.verificationUri}`
    : `在**已登录 doubaoya.com** 的浏览器里打开 ${p.verificationUri}`;
  return (
    `${head}，手动输入：${p.userCode}\n` +
    `（${Math.max(0, Math.round((Date.parse(p.expiresAt) - Date.now()) / 60000))} 分钟内有效；只在你自己刚运行 dby login 时批准。）`
  );
}

/**
 * best-effort 拉起浏览器打开确认页（D9 允许的形态：CLI 自己打开**不带码**的固定页）。
 * 顺序：BROWSER 环境变量（社区惯例的覆盖口）→ 平台默认（darwin: open / win32: cmd /c start / 其它: xdg-open）。
 * 拉不起来（无此命令、无显示环境）不算登录失败——降级为 instructions 里的「手动打开」。
 * 返回值是尝试用的命令名（给提示语用），不是成功与否的承诺：spawn 的 ENOENT 走异步 error 事件。
 */
export function openBrowser(url, { env = process.env, platform = process.platform, spawnFn = spawn } = {}) {
  const browser = (env.BROWSER ?? "").trim();
  let command;
  let args;
  if (browser) {
    command = browser;
    args = [url];
  } else if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    spawnFn(command, args, { stdio: "ignore" }).on("error", () => {});
    return command;
  } catch {
    return null;
  }
}

function pendingError(p) {
  const err = new DbyError("LOGIN_PENDING", `等待网页确认中：请在 ${p.verificationUri} 手动输入 ${p.userCode}。`, {
    exit: EXIT.BUSINESS,
    remediation:
      `把确认网址 ${p.verificationUri} 和用户码 ${p.userCode} 原样告诉用户，请他在已登录 doubaoya.com 的浏览器里手动输入并批准` +
      "（只在他自己刚让你运行 dby login 时批准）；他说批准了之后运行 `dby login --continue`。"
  });
  err.data = { status: "pending", userCode: p.userCode, verificationUri: p.verificationUri, expiresAt: p.expiresAt };
  return err;
}

/** 轮询到有结论或到点。返回 { apiKey, keyPrefix }；拒绝 / 过期 / 到点抛 DbyError。 */
async function poll(ctx, p, { maxWaitMs }) {
  const scale = timeScale();
  const started = Date.now();
  const pollCtx = { ...ctx, baseUrl: p.baseUrl };
  let interval = p.interval;
  for (;;) {
    await sleep(interval * 1000 * scale);
    if (Date.now() >= Date.parse(p.expiresAt)) {
      clearPending();
      throw new DbyError("LOGIN_EXPIRED", "设备码已过期（10 分钟内没有在网页上确认）。", {
        exit: EXIT.AUTH,
        remediation: "重新运行 `dby login` 拿一个新码。"
      });
    }
    const { status, body } = await request(pollCtx, "POST", DEVICE_TOKEN_PATH, {
      auth: "none",
      body: tokenRequestBody(p.deviceCode),
      raw: true
    });
    const r = parseToken(status, body);
    if (r.kind === "granted") return r;
    if (r.kind === "poll") {
      if (r.error === POLL.PENDING) {
        // 继续等
      } else if (r.error === POLL.SLOW_DOWN) {
        // 以服务端给的新间隔为准（它按行记着 intervalSec）；没给才按 RFC 8628 §3.5 自己加 5 秒。
        interval = r.interval ?? interval + SLOW_DOWN_STEP_SECONDS;
        writeJsonPrivate(pendingPath(), { ...p, interval });
      } else if (r.error === POLL.DENIED) {
        clearPending();
        throw new DbyError("LOGIN_DENIED", "网页上拒绝了这次登录。", {
          exit: EXIT.AUTH,
          remediation: "没有写入任何凭证。确实是你本人要登录的话，重新运行 `dby login`。"
        });
      } else if (r.error === POLL.EXPIRED) {
        clearPending();
        throw new DbyError("LOGIN_EXPIRED", "设备码已过期。", {
          exit: EXIT.AUTH,
          remediation: "重新运行 `dby login` 拿一个新码。"
        });
      } else if (r.error === POLL.INVALID_GRANT) {
        // 码不存在或已经兑换过一次（例如另一个终端的 --continue 已经拿走了 key）：终止，不再轮询。
        clearPending();
        throw new DbyError("LOGIN_INVALID_GRANT", "这个设备码无效或已经兑换过。", {
          exit: EXIT.AUTH,
          remediation: "重新运行 `dby login` 拿一个新码；如果另一个终端刚登录成功，那边的凭证已经写好，不必再登。"
        });
      }
    } else {
      throw new DbyError(
        "LOGIN_UNEXPECTED_RESPONSE",
        `换取 key 时服务端应答不符合约定（HTTP ${status}${r.code ? `，${r.code}` : ""}）。`,
        { exit: status >= 500 ? EXIT.GENERAL : EXIT.BUSINESS, remediation: "稍后重试 `dby login --continue`；持续失败请反馈。" }
      );
    }
    if (Date.now() - started >= maxWaitMs) throw pendingError(p);
  }
}

async function finish(ctx, p, granted) {
  writeCredentials({ apiKey: granted.apiKey, keyPrefix: granted.keyPrefix, baseUrl: p.baseUrl });
  clearPending();
  const keyPrefix = granted.keyPrefix ?? keyPrefixOf(granted.apiKey);
  // 服务端 token 应答自带 user；老外形没有时再问一次 whoami。账号标识只是回显，拿不到不影响已写入的凭证。
  let user = granted.user?.id || granted.user?.email ? granted.user : null;
  if (!user) {
    try {
      const who = await request({ ...ctx, baseUrl: p.baseUrl, key: granted.apiKey, keySource: "credentials" }, "GET", "/api/agent/whoami", {});
      user = who?.user ?? null;
    } catch {
      // 同上：只影响回显
    }
  }
  if (process.env.DOUBAOYA_API_KEY) {
    warn(ctx, "注意：当前环境变量 DOUBAOYA_API_KEY 已设置，它优先于刚写入的凭证文件；要用新登录的 key 请先 unset 它。");
  }
  const data = { status: "logged_in", user, keyPrefix, keySource: "credentials", credentialsPath: credentialsPath() };
  return { data, human: `已登录：${user?.email ?? user?.id ?? "(账号标识未取到)"}（key ${keyPrefix}，已存到 ${credentialsPath()}）` };
}

// ── 回环授权（openspec/changes/dby-login-loopback v3，design D1/D2/D5）──────────
//
// PKCE（S256）：verifier 只留在本进程内存，challenge 随 start 上送；截获 code 的一方
// （本机进程、被复制的 URL）没有 verifier 换不出 key。监听硬化见 startLoopbackListener。

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

/** RFC 7636 §4.1：43–128 位 base64url。32 字节 → 恰 43 位。 */
function makeVerifier() {
  return base64Url(randomBytes(32));
}

function s256(verifier) {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

/**
 * 本机回环监听：bind 127.0.0.1:0（系统分配端口）、只应答 GET /cb、state 不匹配忽略续等
 * （不退出不兑换——伪造回调打不断登录）、首个有效回调即关。拒绝以 error=access_denied 到达。
 * 返回 { port, wait, close }；wait 是「等到一次有效回调」的 promise（{code} 或 {error}）。
 */
function startLoopbackListener(state) {
  return new Promise((resolveListener) => {
    let settled = false;
    let waitResolve;
    const wait = new Promise((r) => {
      waitResolve = r;
    });
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/cb" || url.searchParams.get("state") !== state) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><meta charset="utf-8"><title>已收到</title>' +
          '<body style="font-family:system-ui;padding:2rem;line-height:1.8">已收到，回到终端看结果；这个页面可以关掉。</body>'
      );
      if (!settled) {
        settled = true;
        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        waitResolve(error ? { error } : { code });
        server.close();
      }
    });
    server.on("error", () => {
      if (!settled) {
        settled = true;
        waitResolve({ error: "listener_failed" });
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolveListener({ port: server.address().port, wait, close: () => server.close() });
    });
  });
}

/**
 * 回环链（竞速的一方）。终态只有 granted / denied；start 失败、监听失败、兑换失败都是
 * 「本链死了」——竞速的另一条（设备码）继续，不算整体失败（spec「单链失败不拖垮另一条」）。
 */
async function runLoopback(ctx, { shouldStop }) {
  const verifier = makeVerifier();
  const state = randomBytes(16).toString("hex");
  const listener = await startLoopbackListener(state);
  try {
    const { status, body } = await request(ctx, "POST", LOOPBACK_START_PATH, {
      auth: "none",
      body: loopbackStartRequestBody(listener.port, state, s256(verifier)),
      raw: true
    });
    const started = status >= 200 && status < 300 ? parseLoopbackStart(body) : null;
    if (!started) return { kind: "dead", reason: `loopback/start HTTP ${status}` };
    if (ctx.interactive || process.env.DBY_LOGIN_FORCE_RACE === "1") openBrowser(started.authorizeUrl);
    const callback = await Promise.race([listener.wait, shouldStop.then(() => ({ stopped: true }))]);
    if (!callback || callback.stopped) return { kind: "cancelled" };
    if (callback.error === "access_denied") return { kind: "denied" };
    if (!callback.code) return { kind: "dead", reason: "回环回调缺 code" };
    const { status: tokenStatus, body: tokenBody } = await request(ctx, "POST", LOOPBACK_TOKEN_PATH, {
      auth: "none",
      body: loopbackTokenRequestBody(callback.code, verifier),
      raw: true
    });
    const r = parseLoopbackToken(tokenStatus, tokenBody);
    if (r.kind === "granted") return { kind: "granted", granted: r };
    // 兑换失败（code 过期 / verifier 不过）不是整体终态：设备码那边还活着。
    return { kind: "dead", reason: r.kind === "expired" ? "code 已过期（60 秒内未兑换）" : "code 兑换被拒" };
  } finally {
    listener.close();
  }
}

/** 设备码链（竞速的一方）：复用 deviceLogin 的 start/poll 骨架，把抛错映射成终态。 */
async function runDeviceRace(ctx, { shouldStop, isStopped }) {
  const maxWaitMs = Number.POSITIVE_INFINITY;
  const { status, body } = await request(ctx, "POST", DEVICE_START_PATH, { auth: "none", body: {}, raw: true });
  const started = status >= 200 && status < 300 ? parseStart(body) : null;
  if (!started) return { kind: "dead", reason: `device/start HTTP ${status}` };
  const p = {
    deviceCode: started.deviceCode,
    userCode: started.userCode,
    verificationUri: started.verificationUri,
    interval: started.interval,
    expiresAt: new Date(Date.now() + started.expiresIn * 1000).toISOString(),
    baseUrl: ctx.baseUrl
  };
  writeJsonPrivate(pendingPath(), p); // 设备码链照旧写 pending：--continue 语义不因竞速改变
  process.stderr.write(
    `备用路径：也可以在已登录 doubaoya.com 的浏览器打开 ${p.verificationUri}，输入 ${p.userCode}（10 分钟内有效）。\n`
  );
  try {
    const granted = await pollWithStop(ctx, p, { maxWaitMs, shouldStop, isStopped });
    if (granted.stopped) return { kind: "cancelled", granted: granted.value }; // 败方已发的 key 带回给竞速层吊销
    return { kind: "granted", granted: granted.value };
  } catch (e) {
    if (e instanceof DbyError && e.code === "LOGIN_DENIED") return { kind: "denied" };
    return { kind: "dead", reason: e.message, error: e };
  }
}

/** poll() 的竞速变体：每轮先看 shouldStop，停了就放弃（已兑现的 key 会作为 cancelled+value 带回）。 */
async function pollWithStop(ctx, p, { maxWaitMs, shouldStop, isStopped }) {
  const scale = timeScale();
  const started = Date.now();
  const pollCtx = { ...ctx, baseUrl: p.baseUrl };
  let interval = p.interval;
  for (;;) {
    await Promise.race([sleep(interval * 1000 * scale), shouldStop.then(() => ({}))]);
    if (isStopped()) return { stopped: true };
    if (Date.now() >= Date.parse(p.expiresAt)) {
      clearPending();
      throw new DbyError("LOGIN_EXPIRED", "设备码已过期（10 分钟内没有在网页上确认）。", {
        exit: EXIT.AUTH,
        remediation: "重新运行 `dby login` 拿一个新码。"
      });
    }
    const { status, body } = await request(pollCtx, "POST", DEVICE_TOKEN_PATH, {
      auth: "none",
      body: tokenRequestBody(p.deviceCode),
      raw: true
    });
    const r = parseToken(status, body);
    if (r.kind === "granted") {
      if (isStopped()) return { stopped: true, value: r }; // 败方已发 key：带回去吊销
      return { value: r };
    }
    if (r.kind === "poll") {
      if (r.error === POLL.PENDING) {
        // 继续等
      } else if (r.error === POLL.SLOW_DOWN) {
        interval = r.interval ?? interval + SLOW_DOWN_STEP_SECONDS;
        writeJsonPrivate(pendingPath(), { ...p, interval });
      } else if (r.error === POLL.DENIED) {
        clearPending();
        throw new DbyError("LOGIN_DENIED", "网页上拒绝了这次登录。", {
          exit: EXIT.AUTH,
          remediation: "没有写入任何凭证。确实是你本人要登录的话，重新运行 `dby login`。"
        });
      } else if (r.error === POLL.EXPIRED) {
        clearPending();
        throw new DbyError("LOGIN_EXPIRED", "设备码已过期。", { exit: EXIT.AUTH, remediation: "重新运行 `dby login` 拿一个新码。" });
      } else if (r.error === POLL.INVALID_GRANT) {
        clearPending();
        throw new DbyError("LOGIN_INVALID_GRANT", "这个设备码无效或已经兑换过。", {
          exit: EXIT.AUTH,
          remediation: "重新运行 `dby login` 拿一个新码；如果另一个终端刚登录成功，那边的凭证已经写好，不必再登。"
        });
      }
    } else {
      throw new DbyError(
        "LOGIN_UNEXPECTED_RESPONSE",
        `换取 key 时服务端应答不符合约定（HTTP ${status}${r.code ? `，${r.code}` : ""}）。`,
        { exit: status >= 500 ? EXIT.GENERAL : EXIT.BUSINESS, remediation: "稍后重试 `dby login --continue`；持续失败请反馈。" }
      );
    }
    if (Date.now() - started >= maxWaitMs) throw pendingError(p);
  }
}

/** 已不需要的那把 key（竞速败方）：请服务端吊销。失败只警告——凭证文件里写的不是它。 */
async function revokeLoserKey(ctx, apiKey, source) {
  try {
    await request({ ...ctx, key: apiKey, keySource: "credentials" }, "POST", LOGOUT_PATH, {});
    process.stderr.write(`竞速的另一条链（${source}）也兑现了一把 key，已替你吊销，不会留在账号里。\n`);
  } catch {
    warn(ctx, `竞速的另一条链（${source}）兑现了一把 key 但没能自动吊销；请到密钥中心检查并手动撤销多余的那把。`);
  }
}

/**
 * 并行竞速（design D5 v3）：两条链同时起——浏览器弹回环授权页，终端同时打出备用设备码。
 * 终态：任一条 granted（另一条取消，败方已发的 key 立即吊销）／任一条 denied（即止，不走另一条）／
 * 两条都 dead（报设备码侧的错误，它是用户看得懂的那条）。没有超时定时器：链各自 10 分钟 TTL 到点自死。
 */
async function raceLogin(ctx) {
  let stop;
  let stoppedFlag = false; // 🔴 轮询循环里不许 await shouldStop（未停时它永不 resolve，会把循环挂死）：查标志位。
  const shouldStop = new Promise((r) => {
    stop = r;
  });
  const stopped = () => stoppedFlag;
  const stopNow = () => {
    stoppedFlag = true;
    stop(true);
  };
  const states = { loopback: null, device: null };
  const loopbackPromise = runLoopback(ctx, { shouldStop }).then((outcome) => {
    states.loopback = outcome;
    return outcome;
  });
  const devicePromise = runDeviceRace(ctx, { shouldStop, isStopped: stopped }).then((outcome) => {
    states.device = outcome;
    return outcome;
  });

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const check = () => {
      if (settled) return;
      const lo = states.loopback;
      const dv = states.device;
      if (lo?.kind === "granted" || dv?.kind === "granted") {
        settled = true;
        stopNow();
        resolve({ kind: "ok", winner: lo?.kind === "granted" ? "loopback" : "device" });
      } else if (lo?.kind === "denied" || dv?.kind === "denied") {
        settled = true;
        stopNow();
        resolve({ kind: "denied" });
      } else if (lo?.kind === "dead" && dv?.kind === "dead") {
        settled = true;
        resolve({ kind: "all_dead" });
      }
    };
    loopbackPromise.then(check);
    devicePromise.then(check);
  });

  if (outcome.kind === "ok") {
    const winner = outcome.winner === "loopback" ? await loopbackPromise : await devicePromise;
    // 🔴 等「已经停不下来的在飞请求」走完（监听已关、轮询已停，至多一个在飞的 HTTP 应答）：
    //    败方若已兑现 key，必须吊销——不留一把无人知晓的 active key 在账号上。
    const loser = outcome.winner === "loopback" ? await devicePromise : await loopbackPromise;
    if (loser?.kind === "granted" && loser.granted?.apiKey && loser.granted.apiKey !== winner.granted.apiKey) {
      await revokeLoserKey(ctx, loser.granted.apiKey, outcome.winner === "loopback" ? "设备码" : "回环");
    }
    if (loser?.kind === "cancelled" && loser.granted?.apiKey) {
      await revokeLoserKey(ctx, loser.granted.apiKey, outcome.winner === "loopback" ? "设备码" : "回环");
    }
    return finish(ctx, { baseUrl: ctx.baseUrl }, winner.granted);
  }
  if (outcome.kind === "denied") {
    throw new DbyError("LOGIN_DENIED", "网页上拒绝了这次登录。", {
      exit: EXIT.AUTH,
      remediation: "没有写入任何凭证。确实是你本人要登录的话，重新运行 `dby login`。"
    });
  }
  await Promise.allSettled([loopbackPromise, devicePromise]);
  const device = states.device;
  const loopback = states.loopback;
  if (device?.error) throw device.error;
  throw new DbyError(
    "LOGIN_FAILED",
    `两条登录路径都没走通（回环：${loopback?.reason ?? "未启动"}；设备码：${device?.reason ?? "未启动"}）。`,
    { exit: EXIT.AUTH, remediation: "重新运行 `dby login`；持续失败请反馈。" }
  );
}

export async function login(ctx, { continueLogin = false, deviceOnly = false } = {}) {
  // 交互终端的默认路径是并行竞速（回环 + 设备码备用，design D5 v3）；非 TTY（agent）、
  // --continue 与显式 --device 走纯设备码——老路径的输出、退出码、pending 文件一字不动。
  // DBY_LOGIN_FORCE_RACE=1 是测试旋钮：完整模拟交互终端（runCli 的子进程不是 TTY）——
  // 既切竞速路径，也放行 openBrowser（BROWSER 可注入/中和，单测里用 BROWSER=/bin/false）。
  const forceRace = process.env.DBY_LOGIN_FORCE_RACE === "1";
  const race = (ctx.interactive || forceRace) && !deviceOnly && !continueLogin;
  return race ? raceLogin(ctx) : deviceLogin(ctx, { continueLogin });
}

/** 纯设备码路径（原 login 主体，行为与回环改造前逐字节同义）。 */
async function deviceLogin(ctx, { continueLogin }) {
  const maxWaitMs = ctx.interactive ? Number.POSITIVE_INFINITY : NON_TTY_WAIT_MS * timeScale();
  let p;
  if (continueLogin) {
    p = readPending();
    if (!p) {
      throw new DbyError("LOGIN_NOT_STARTED", "没有进行中的登录可以继续。", {
        exit: EXIT.BUSINESS,
        remediation: "先运行 `dby login`。"
      });
    }
  } else {
    const { status, body } = await request(ctx, "POST", DEVICE_START_PATH, { auth: "none", body: {}, raw: true });
    const started = status >= 200 && status < 300 ? parseStart(body) : null;
    if (!started) {
      throw new DbyError("LOGIN_START_FAILED", `发起登录失败（HTTP ${status}）。`, {
        exit: status >= 500 ? EXIT.GENERAL : EXIT.BUSINESS,
        remediation: "稍后重试 `dby login`；也可以改用环境变量：doubaoya.com → 密钥中心生成密钥后 export DOUBAOYA_API_KEY=dyh_...。"
      });
    }
    p = {
      deviceCode: started.deviceCode,
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      interval: started.interval,
      expiresAt: new Date(Date.now() + started.expiresIn * 1000).toISOString(),
      baseUrl: ctx.baseUrl
    };
    writeJsonPrivate(pendingPath(), p);
  }
  // 用户码与网址永远走 stderr（人要看见）；JSON 模式下 LOGIN_PENDING 信封里也带着。
  // 浏览器只在交互终端拉起（agent/非 TTY 场景由 agent 转述网址，机器上多半也没有浏览器）。
  const openedWith = ctx.interactive ? openBrowser(p.verificationUri) : null;
  process.stderr.write(`${instructions(p, openedWith)}\n`);
  const granted = await poll(ctx, p, { maxWaitMs });
  return finish(ctx, p, granted);
}

export async function logout(ctx) {
  const creds = readCredentials();
  if (!creds?.apiKey) {
    const data = { status: "not_logged_in", envKeyPresent: !!process.env.DOUBAOYA_API_KEY };
    return {
      data,
      human:
        "本机没有 dby login 存下的凭证，无需登出。" +
        (data.envKeyPresent ? "环境变量 DOUBAOYA_API_KEY 不归 dby 管，logout 不碰它。" : "")
    };
  }
  const keyPrefix = creds.keyPrefix ?? keyPrefixOf(creds.apiKey);
  // 🔴 只用凭证文件里的那一把，绝不用环境变量里的（spec：logout MUST NOT 触碰环境变量里的 key）。
  const fileCtx = { ...ctx, key: creds.apiKey, keySource: "credentials", baseUrl: process.env.DOUBAOYA_BASE_URL || creds.baseUrl || ctx.baseUrl };
  let failure = null;
  let status = "revoked";
  try {
    const res = parseLogout(await request(fileCtx, "POST", LOGOUT_PATH, {}));
    // revoked:false = 服务端找到了这把 key 但它已不是 active（并发吊销的窄窗口）；本地照删。
    if (res.revoked === false) status = "already_invalid";
  } catch (e) {
    if (e instanceof DbyError && e.exit === EXIT.AUTH) status = "already_invalid"; // 网页上早吊销了：本地删掉即可
    else failure = e;
  }
  deleteCredentials(); // 无论服务端结果如何，本地文件都删（spec「离线登出」）
  if (failure) {
    throw new DbyError(
      "LOGOUT_NOT_REVOKED",
      `本地凭证已删除，但服务端没有确认吊销（${failure.code ?? "ERROR"}：${failure.message}）。`,
      {
        exit: failure instanceof DbyError ? failure.exit : EXIT.GENERAL,
        remediation: `服务端未吊销：请到 https://doubaoya.com → 密钥中心手动撤销前缀为 ${keyPrefix} 的那把 key。`
      }
    );
  }
  const data = { status, keyPrefix, credentialsRemoved: true };
  return {
    data,
    human: status === "revoked" ? `已登出：服务端已吊销 key ${keyPrefix}，本地凭证已删除。` : `本地凭证已删除（key ${keyPrefix} 在服务端早已失效）。`
  };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: null, name: "login", kind: "composite",
    summary: "登录：交互终端并行竞速（浏览器一键批准的回环授权 + 备用设备码），key 存到 ~/.doubaoya/credentials",
    args: [],
    flags: {
      continue: { summary: "继续上一次未完成的登录轮询（非交互环境两步走的第二步）" },
      device: { summary: "跳过回环授权，只用设备码（老流程）" }
    },
    // 设备码与回环端点都在主仓对账闸的排除清单里（免鉴权 / 凭 code+verifier 兑换）；
    // composite 只要求路径真实存在（主仓 COMPOSITE_COMMANDS 登记了 login）。
    routes: [
      { method: "POST", path: DEVICE_START_PATH },
      { method: "POST", path: DEVICE_TOKEN_PATH },
      { method: "POST", path: LOOPBACK_START_PATH },
      { method: "POST", path: LOOPBACK_TOKEN_PATH }
    ],
    billable: false, destructive: false, composite: true,
    run: (ctx, { flags }) => login(ctx, { continueLogin: !!flags.continue, deviceOnly: !!flags.device })
  },
  {
    group: null, name: "logout", kind: "route",
    summary: "登出：请服务端吊销本机凭证文件里的那把 key，再删除文件（不碰环境变量）",
    args: [], flags: {},
    routes: [{ method: "POST", path: LOGOUT_PATH }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => logout(ctx)
  }
];
