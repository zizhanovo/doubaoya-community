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
  // 403 PLAN_LIMIT_EXCEEDED 是「账号套餐权益到顶」，与钥匙、余额都无关（2026-09-09 补）：
  // 不登记的话它会落进 BUSINESS 且 remediation 为空，agent 最可能的两条歧路是「换钥匙重试」
  // 或套 402 的余额话术——两条都是错的引导。同一入参不重试，指向套餐区块。
  const planLimit =
    c === "PLAN_LIMIT_EXCEEDED"
      ? "账号套餐的权益上限到了（不是点数、不是钥匙）：把 error.extra 里的 dimension / plan / used / limit 原样告诉用户，" +
        "已有内容不受影响；要放开这一项到 extra.helpUrl（账户页套餐区块）升级套餐。同一入参不要重试。"
      : null;
  const remediation = hints[c] ?? planLimit;
  if (status >= 500) return new DbyError(c, message ?? "服务端错误", { exit: EXIT.GENERAL, remediation });
  return new DbyError(c, message ?? "未知错误", { exit: EXIT.BUSINESS, remediation });
}
