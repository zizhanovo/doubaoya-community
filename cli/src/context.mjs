// context.mjs — 每次调用的输出上下文：JSON/人类文本三态、颜色、鉴权、超时注入。
// 判定全部集中在这里，方便被测试直接打（TTY 状态可注入，不依赖真终端）。

import { EXIT, DbyError } from "./errors.mjs";
import { resolveCredentials } from "./credentials.mjs";

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
  argv = process.argv.slice(2),
  credentials = resolveCredentials(env)
} = {}) {
  const json = !!flags.json || !stdoutIsTTY;
  const noColorEnv = (env.NO_COLOR ?? "") !== "";
  return {
    json,
    color: flags.color !== false && !!stdoutIsTTY && !json && !noColorEnv,
    interactive: !!stdoutIsTTY,
    // 站点：显式环境变量优先；否则 key 来自凭证文件时用登录时的那个站（key 属于它）；再否则生产。
    baseUrl: env.DOUBAOYA_BASE_URL || credentials.baseUrl || BASE_URL_DEFAULT,
    // 凭证只有两层，解析全在 credentials.mjs（spec dby-cli-auth「凭证解析只有一套顺序」）。
    key: credentials.key,
    keySource: credentials.keySource,
    credentialsWarning: credentials.warning,
    // ponytail: 超时只能整体注入（测试用），不做每命令 flag；升级路径 = 需求出现时加 --timeout。
    timeoutOverride: Number(env.DOUBAOYA_TIMEOUT_MS) > 0 ? Number(env.DOUBAOYA_TIMEOUT_MS) : null,
    confirm: !!flags.confirm,
    argv
  };
}

/** 🔴 只说「设没设 / 从哪来」——密钥内容一个字符都不进任何输出。 */
export function keyPresence(ctx) {
  if (!ctx.key) return "没设置";
  return ctx.keySource === "credentials" ? "已设置（来自 ~/.doubaoya/credentials）" : "已设置（来自环境变量）";
}

/** 两种拿 key 的办法，缺 key 与鉴权失败时的 remediation 共用这一句（spec：同时给出 dby login 与环境变量）。 */
export const HOW_TO_GET_KEY =
  "两种办法任选其一：① 运行 `dby login`，在已登录 doubaoya.com 的浏览器里手动输入屏幕上的码并批准；" +
  "② 去 https://doubaoya.com → 密钥中心 → 生成密钥，然后 export DOUBAOYA_API_KEY=dyh_...。";

export function getKey(ctx, { required = true } = {}) {
  if (!ctx.key && required) {
    throw new DbyError("MISSING_API_KEY", "没有可用的 API key（环境变量 DOUBAOYA_API_KEY 与 ~/.doubaoya/credentials 都没有）。", {
      exit: EXIT.AUTH,
      remediation: `${HOW_TO_GET_KEY} 然后重试。`
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
