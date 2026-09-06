// context.mjs — 每次调用的输出上下文：JSON/人类文本三态、颜色、鉴权、超时注入。
// 判定全部集中在这里，方便被测试直接打（TTY 状态可注入，不依赖真终端）。

import { EXIT, DbyError } from "./errors.mjs";

export const BASE_URL_DEFAULT = "https://doubaoya.com";

/**
 * 输出契约（spec:「输出通道分工与 JSON 契约」）：
 *   非 TTY 或 --json ⇒ stdout 是单个 {ok,...} JSON；TTY 且未指定 ⇒ 人类文本。
 * JSON 渲染路径完全不看 isTTY ⇒ 「TTY 加 --json 与非 TTY 逐字节一致」由构造保证。
 * NO_COLOR 按 no-color.org：设了且非空串就生效；--no-color / 非 TTY / JSON 模式同样关色。
 */
export function makeContext({
  flags = {},
  env = process.env,
  stdoutIsTTY = process.stdout.isTTY,
  argv = process.argv.slice(2)
} = {}) {
  const json = !!flags.json || !stdoutIsTTY;
  const noColorEnv = (env.NO_COLOR ?? "") !== "";
  return {
    json,
    color: flags.color !== false && !!stdoutIsTTY && !json && !noColorEnv,
    baseUrl: env.DOUBAOYA_BASE_URL || BASE_URL_DEFAULT,
    key: env.DOUBAOYA_API_KEY || null,
    // ponytail: 超时只能整体注入（测试用），不做每命令 flag；升级路径 = 需求出现时加 --timeout。
    timeoutOverride: Number(env.DOUBAOYA_TIMEOUT_MS) > 0 ? Number(env.DOUBAOYA_TIMEOUT_MS) : null,
    confirm: !!flags.confirm,
    argv
  };
}

/** 🔴 只说「设没设」——密钥内容一个字符都不进任何输出。 */
export function keyPresence(ctx) {
  return ctx.key ? "已设置" : "没设置";
}

export function getKey(ctx, { required = true } = {}) {
  if (!ctx.key && required) {
    throw new DbyError("MISSING_API_KEY", "缺少 DOUBAOYA_API_KEY。", {
      exit: EXIT.AUTH,
      remediation:
        "去 https://doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后 export DOUBAOYA_API_KEY=dyh_... 再重试。"
    });
  }
  return ctx.key;
}

const ANSI = { red: "31", yellow: "33", bold: "1", dim: "2" };

/** 人类文本模式的着色；ctx.color=false 时原样返回（NO_COLOR / --no-color / 非 TTY / JSON）。 */
export function paint(ctx, name, text) {
  if (!ctx.color || !ANSI[name]) return text;
  return `\u001b[${ANSI[name]}m${text}\u001b[0m`;
}
