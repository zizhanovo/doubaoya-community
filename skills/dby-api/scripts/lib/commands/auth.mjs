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
  POLL,
  SLOW_DOWN_STEP_SECONDS,
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

export async function login(ctx, { continueLogin = false } = {}) {
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
    summary: "设备码登录：屏幕给出一个码，你在已登录的 doubaoya.com 确认页手动输入并批准，key 存到 ~/.doubaoya/credentials",
    args: [],
    flags: { continue: { summary: "继续上一次未完成的登录轮询（非交互环境两步走的第二步）" } },
    // 设备码两条端点在主仓对账闸的排除清单里（免鉴权、凭设备码）；composite 只要求路径真实存在，
    // 不要求在排除后的集合里，所以照实列出（主仓 COMPOSITE_COMMANDS 登记了 login）。
    routes: [
      { method: "POST", path: DEVICE_START_PATH },
      { method: "POST", path: DEVICE_TOKEN_PATH }
    ],
    billable: false, destructive: false, composite: true,
    run: (ctx, { flags }) => login(ctx, { continueLogin: !!flags.continue })
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
