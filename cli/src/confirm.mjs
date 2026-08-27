// confirm.mjs — 确认协议中间件（spec:「计费与不可逆操作的协议化确认」，设计 D3 参照 arcjet）。
// 计费 / 不可逆的命令默认不执行：给 changes 清单 + 可原样重放的 confirmCommand，退出码 6；
// `--confirm` 放行。只读命令不套（零摩擦）。

import { ConfirmationRequired } from "./errors.mjs";

/** shell 单参转义：安全字符集直出，其余单引号包裹。confirmCommand 必须可直接复制执行。 */
export function shellQuote(token) {
  if (/^[A-Za-z0-9@%+=:,.\/_-]+$/.test(token)) return token;
  return `'${String(token).replace(/'/g, `'\\''`)}'`;
}

/** 由本次调用的原始参数拼出重放命令：原样保留全部 token，追加（去重后的）--confirm。 */
export function buildConfirmCommand(argv) {
  const tokens = (argv ?? []).filter((t) => t !== "--confirm");
  return ["dby", ...tokens, "--confirm"].map(shellQuote).join(" ");
}

/**
 * billable 闸：带 --confirm 直接放行；否则抛 ConfirmationRequired（主流程转成
 * {ok:false, status:"confirmation_required", changes, confirmCommand} + 退出码 6）。
 * changes 每条：{ action, ref?, title?, price?, method?, path? } —— agent 拿它向用户转述清单。
 */
export function billable(ctx, changes) {
  if (ctx.confirm) return;
  throw new ConfirmationRequired(changes, buildConfirmCommand(ctx.argv));
}
