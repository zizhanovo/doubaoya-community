// device-contract.mjs — `dby login` / `dby logout` 与主仓设备码端点之间的**全部**字段约定，集中在这一处。
//
// 服务端由主仓 apps/api/src/modules/cli/（dby-cli-rebuild tasks 1.1/1.3）实现；字段名要微调时
// 只改本文件，login/logout 的流程代码不碰字段名。
//
//   POST /api/cli/device/start   免鉴权 → { deviceCode, userCode, verificationUri, expiresIn, interval }
//                                verificationUri **不含码**（design D9）：CLI 打印 userCode，用户在网页手动输入。
//   POST /api/cli/device/token   免鉴权，body { deviceCode }
//                                → 200 { apiKey, keyPrefix }
//                                → 400 { error: "authorization_pending" | "slow_down" | "access_denied" | "expired_token" }
//   POST /api/cli/logout         API key 鉴权，只吊销请求自身那把 key（body 不带任何 key 标识）
//
// 两种外形都认：RFC 8628 的裸对象，以及 doubaoya 信封 { success, data } / { success:false, error:{ code } }。

export const DEVICE_START_PATH = "/api/cli/device/start";
export const DEVICE_TOKEN_PATH = "/api/cli/device/token";
export const LOGOUT_PATH = "/api/cli/logout";

/** RFC 8628：slow_down 时后续轮询间隔增加的秒数。 */
export const SLOW_DOWN_STEP_SECONDS = 5;

/** 轮询状态（device/token 400 的 error 值）。 */
export const POLL = Object.freeze({
  PENDING: "authorization_pending",
  SLOW_DOWN: "slow_down",
  DENIED: "access_denied",
  EXPIRED: "expired_token"
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

/**
 * token 的应答 → { kind: "granted", apiKey, keyPrefix } | { kind: "poll", error } | { kind: "unknown" }。
 * error 取值见 POLL；认 `{error:"x"}` 与 `{error:{code:"x"}}` 两种写法。
 */
export function parseToken(status, body) {
  if (status >= 200 && status < 300) {
    const d = unwrap(body);
    if (d && typeof d.apiKey === "string" && d.apiKey) {
      return { kind: "granted", apiKey: d.apiKey, keyPrefix: typeof d.keyPrefix === "string" ? d.keyPrefix : null };
    }
    return { kind: "unknown" };
  }
  const e = body?.error;
  const code = typeof e === "string" ? e : typeof e?.code === "string" ? e.code : null;
  if (code && Object.values(POLL).includes(code)) return { kind: "poll", error: code };
  return { kind: "unknown", status, code };
}
