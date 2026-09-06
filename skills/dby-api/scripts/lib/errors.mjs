// errors.mjs — 退出码契约与错误类型（spec: dby-cli「退出码按失败模式分流」）
// 🔴 退出码是 API 契约：只增不改，破坏性变更走 CLI major。

export const EXIT = Object.freeze({
  OK: 0,       // 成功
  GENERAL: 1,  // 一般错误（服务端 5xx、未预期异常）
  USAGE: 2,    // 参数 / 用法错
  BUSINESS: 3, // 业务态（no_account / 查无此能力 / doctor 有项不过 …）
  AUTH: 4,     // 鉴权失败（DOUBAOYA_API_KEY 缺失 / 无效）
  NETWORK: 5,  // 网络错误或超时
  CONFIRM: 6   // 需确认（计费 / 不可逆操作未带 --confirm）
});

/** CLI 内所有可预期失败都走它：code 进 JSON 的 error.code，exit 决定退出码，语义一一对应。 */
export class DbyError extends Error {
  constructor(code, message, { remediation = null, exit = EXIT.GENERAL } = {}) {
    super(message);
    this.name = "DbyError";
    this.code = code;
    this.remediation = remediation;
    this.exit = exit;
  }
}

/** 确认协议（spec:「计费与不可逆操作的协议化确认」）：不是错误，是一种停下等确认的终态。 */
export class ConfirmationRequired extends Error {
  constructor(changes, confirmCommand) {
    super("confirmation_required");
    this.name = "ConfirmationRequired";
    this.changes = changes;
    this.confirmCommand = confirmCommand;
  }
}

/**
 * 上游信封失败 → DbyError。401/鉴权类 → 4；5xx → 1；其余 4xx 业务态 → 3。
 * `hints` 允许调用点补每个 code 的 remediation（如 charter 的 CHARTER_INVALID）。
 * 🔴 remediation 里只说 key「已设置 / 没设置」，一个字符的密钥内容都不进输出。
 */
export function upstreamError(status, code, message, { keySet = false, hints = {} } = {}) {
  const c = code ?? `HTTP_${status}`;
  if (c === "MISSING_API_KEY" || c === "UNAUTHORIZED" || status === 401) {
    return new DbyError(c, message ?? "鉴权失败", {
      exit: EXIT.AUTH,
      remediation:
        `DOUBAOYA_API_KEY ${keySet ? "已设置" : "没设置"}。去 https://doubaoya.com → 密钥中心` +
        `${keySet ? "撤销并重新生成，再更新环境变量" : "生成密钥，然后 export DOUBAOYA_API_KEY=dyh_..."}。`
    });
  }
  const remediation = hints[c] ?? null;
  if (status >= 500) return new DbyError(c, message ?? "服务端错误", { exit: EXIT.GENERAL, remediation });
  return new DbyError(c, message ?? "未知错误", { exit: EXIT.BUSINESS, remediation });
}
