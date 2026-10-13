// device-contract.mjs — `dby login` / `dby logout` 与主仓设备码端点之间的**全部**字段约定，集中在这一处。
//
// 服务端由主仓 apps/api/src/modules/cli/（dby-cli-rebuild tasks 1.1/1.3）实现；字段名要微调时
// 只改本文件，login/logout 的流程代码不碰字段名。
//
//   POST /api/cli/device/start   免鉴权 → { deviceCode, userCode, verificationUri, expiresIn, interval }
//                                verificationUri **不含码**（design D9）：CLI 打印 userCode，用户在网页手动输入。
//   POST /api/cli/device/token   免鉴权，body { deviceCode }
//                                → 200 { apiKey, key: { id, name, prefix }, user: { id, email } }
//                                → 400 error.code ∈ authorization_pending | slow_down（extra.interval=服务端新间隔秒数）
//                                                 | access_denied | expired_token | invalid_grant（码不存在或已兑换）
//   POST /api/cli/logout         API key 鉴权，只吊销请求自身那把 key（body 不带任何 key 标识）
//                                → 200 { revoked: boolean, key: { id, prefix } }
//
// 以上形状以主仓 apps/api/src/modules/cli/routes.ts 为准（2026-09-27 对齐）。
//
// 两种外形都认：RFC 8628 的裸对象，以及 doubaoya 信封 { success, data } / { success:false, error:{ code } }。

export const DEVICE_START_PATH = "/api/cli/device/start";
export const DEVICE_TOKEN_PATH = "/api/cli/device/token";
export const LOGOUT_PATH = "/api/cli/logout";

/** RFC 8628：slow_down 时后续轮询间隔增加的秒数（服务端没给 extra.interval 时的兜底）。 */
export const SLOW_DOWN_STEP_SECONDS = 5;

/** 轮询状态（device/token 400 的 error 值）。 */
export const POLL = Object.freeze({
  PENDING: "authorization_pending",
  SLOW_DOWN: "slow_down",
  DENIED: "access_denied",
  EXPIRED: "expired_token",
  INVALID_GRANT: "invalid_grant"
});

// 信封外形时字段在 data 里；裸对象时就在顶层。信封上的 notice 已由请求层（http.mjs 的 raw 分支）统一转达。
const unwrap = (body) => (body && typeof body === "object" && body.data && typeof body.data === "object" ? body.data : body);

/** start 的应答 → 规整后的字段；缺关键字段返回 null（调用方报「服务端应答不符合约定」）。 */
export function parseStart(body) {
  const d = unwrap(body);
  if (!d || typeof d.deviceCode !== "string" || typeof d.userCode !== "string" || typeof d.verificationUri !== "string") {
    return null;
  }
  return {
    deviceCode: d.deviceCode,
    userCode: d.userCode,
    verificationUri: d.verificationUri,
    expiresIn: Number(d.expiresIn) > 0 ? Number(d.expiresIn) : 600,
    interval: Number(d.interval) > 0 ? Number(d.interval) : 5
  };
}

export function tokenRequestBody(deviceCode) {
  return { deviceCode };
}

const str = (v) => (typeof v === "string" && v ? v : null);

/**
 * token 的应答 → { kind: "granted", apiKey, keyPrefix, user } | { kind: "poll", error, interval } | { kind: "unknown" }。
 * error 取值见 POLL；认 `{error:"x"}` 与 `{error:{code:"x"}}` 两种写法。
 * interval：slow_down 时服务端给出的新间隔（秒），没给为 null——以服务端为准，没给才按 RFC 自己加 5 秒。
 */
export function parseToken(status, body) {
  if (status >= 200 && status < 300) {
    const d = unwrap(body);
    if (d && typeof d.apiKey === "string" && d.apiKey) {
      const user = d.user && typeof d.user === "object" ? { id: str(d.user.id), email: str(d.user.email) } : null;
      return { kind: "granted", apiKey: d.apiKey, keyPrefix: str(d.key?.prefix) ?? str(d.keyPrefix), user };
    }
    return { kind: "unknown" };
  }
  const e = body?.error;
  const code = typeof e === "string" ? e : typeof e?.code === "string" ? e.code : null;
  if (code && Object.values(POLL).includes(code)) {
    const extraInterval = Number(e?.extra?.interval ?? body?.interval);
    return { kind: "poll", error: code, interval: Number.isFinite(extraInterval) && extraInterval > 0 ? extraInterval : null };
  }
  return { kind: "unknown", status, code };
}

/** logout 的成功应答 → { revoked, keyPrefix }；外形不符时字段为 null（不影响本地删文件）。 */
export function parseLogout(body) {
  const d = unwrap(body);
  return {
    revoked: typeof d?.revoked === "boolean" ? d.revoked : null,
    keyPrefix: str(d?.key?.prefix)
  };
}

// ── 回环授权（openspec/changes/dby-login-loopback v3，RFC 8252 + PKCE）──────────
//
//   POST /api/cli/loopback/start  免鉴权，body { port, state, codeChallenge }
//                                 → { authorizeUrl, nonce, expiresIn }；URL 只带一次性 nonce
//   POST /api/cli/loopback/token  免鉴权，body { code, codeVerifier }
//                                 → 200 { apiKey, key, user }（与 device/token 同形状）
//                                 → 400 error.code ∈ expired_token | invalid_grant
//   lookup/decision 是浏览器批准页在调，CLI 不碰。

export const LOOPBACK_START_PATH = "/api/cli/loopback/start";
export const LOOPBACK_TOKEN_PATH = "/api/cli/loopback/token";

/** loopback/start 的应答 → { authorizeUrl, expiresIn }；缺关键字段返回 null。nonce 只在 URL 里，CLI 不单独需要它。 */
export function parseLoopbackStart(body) {
  const d = unwrap(body);
  if (!d || typeof d.authorizeUrl !== "string" || !d.authorizeUrl) return null;
  return { authorizeUrl: d.authorizeUrl, expiresIn: Number(d.expiresIn) > 0 ? Number(d.expiresIn) : 600 };
}

export function loopbackStartRequestBody(port, state, codeChallenge) {
  return { port, state, codeChallenge };
}

export function loopbackTokenRequestBody(code, codeVerifier) {
  return { code, codeVerifier };
}

/**
 * loopback/token 的应答 → { kind: "granted", apiKey, keyPrefix, user } | { kind: "expired" } | { kind: "invalid" }。
 * 兑换没有「继续等」的语义（code 是一次性的）：任何 400 都是终态。形状复用 parseToken 的成功分支。
 */
export function parseLoopbackToken(status, body) {
  const r = parseToken(status, body);
  if (r.kind === "granted") return r;
  if (r.kind === "poll" && r.error === POLL.EXPIRED) return { kind: "expired" };
  return { kind: "invalid" };
}
