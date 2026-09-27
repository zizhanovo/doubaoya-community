// banned.mjs — `dby banned check`（替代 skills/dby-banned-words/scripts/check_multi.py，见该文件）。
//
// ponytail：spec「路由与子命令一一对应」要求一条子命令打一条路径，这里是明确例外——
//   多平台扇出如果拆成「一平台一条子命令」，agent 得自己写循环逐个调用，平台漏调不会报错
//   （对比：check_multi.py 本就是把三次独立调用收进一次脚本执行，为的是别漏平台）。
//   design D5 把它与 write prep 等并列钉进冻结名单，不再新增同类组合命令。
//
// 🔴 每个平台各是一次独立计费调用（非批量接口），所以 billable:true、composite:true；
//   routes 只列这一条真正会计费的路径——价格现拉走的 GET /api/apis/:platform/:slug 已经在
//   `api describe` 里登记过（同 doctor.mjs 的道理：复用别的命令已登记的路由，不重复计入对账闸）。

import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { billable } from "../confirm.mjs";
import { priceLabel } from "../capability.mjs";

const CALL_PATH = "/api/apis/tool/check-banned-words/call";
const DESCRIBE_PATH = "/api/apis/tool/check-banned-words";
const DEFAULT_PLATFORMS = ["xiaohongshu", "douyin", "gongzhonghao"];
// raw 里与顶层重复的两键；只剥这两个，其余（上游状态码等）原样保留。
const DUP_KEYS = ["content", "originalContent"];

/**
 * 剥掉 data.raw 里与顶层重复的 content / originalContent，其余键原样保留（--raw 保留原样）。
 * 逐字移植自 check_multi.py 的 slim：raw 不是对象（缺失/null/字符串）时原样返回，不改入参。**纯函数**。
 */
export function slim(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const raw = data.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return data;
  return { ...data, raw: Object.fromEntries(Object.entries(raw).filter(([k]) => !DUP_KEYS.includes(k))) };
}

/** 单平台一行 human 摘要：命中的违禁词类型，或失败原因。 */
function resultLine(platform, result) {
  if (result?.error) return `${platform.padEnd(14)} 失败：[${result.error.code}] ${result.error.message}`;
  const types = Array.isArray(result?.prohibitedWordsType) ? result.prohibitedWordsType : [];
  return `${platform.padEnd(14)} ${types.length ? types.join("、") : "未命中"}`;
}

export async function bannedCheck(ctx, textParts, { platforms, raw } = {}) {
  const content = (textParts ?? []).join(" ").trim();
  if (!content) throw new DbyError("USAGE", "缺少待检测文案。", { exit: EXIT.USAGE });
  const list = (platforms ? platforms.split(",") : DEFAULT_PLATFORMS).map((p) => p.trim()).filter(Boolean);
  if (!list.length) throw new DbyError("USAGE", "--platforms 给出的平台列表是空的。", { exit: EXIT.USAGE });

  // 不带 --confirm 时只做这一步现拉价格的只读请求，不打任何计费路径（退出码 6 前零计费请求）。
  let price = "?";
  if (!ctx.confirm) {
    const capability = await request(ctx, "GET", DESCRIBE_PATH, { auth: "optional", notFoundNull: true, soft: true });
    if (capability && !capability.__soft) price = priceLabel(capability);
    billable(ctx, list.map((platform) => ({
      action: "check-banned-words",
      ref: `tool/check-banned-words@${platform}`,
      title: `违禁词检测 · ${platform}`,
      price,
      method: "POST",
      path: CALL_PATH
    })));
  }

  // 逐平台各打一次；单平台失败不影响其它平台（结果字典里放 {error:{code,message}}，与旧脚本一致）。
  const results = {};
  let anyError = false;
  for (const platform of list) {
    try {
      const data = await request(ctx, "POST", CALL_PATH, { body: { platform, content }, billable: true });
      results[platform] = raw ? data : slim(data);
    } catch (e) {
      anyError = true;
      results[platform] = { error: { code: e.code ?? "ERROR", message: e.message } };
    }
  }

  const human = list.map((p) => resultLine(p, results[p])).join("\n");
  if (anyError) {
    const err = new DbyError("BANNED_CHECK_PARTIAL", "部分平台检测失败，见逐平台结果。", { exit: EXIT.BUSINESS });
    err.data = results; // 失败信封仍带出逐平台的完整结果，别把已经拿到的结果丢了
    err.human = human;
    throw err;
  }
  return { data: results, human };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "banned", name: "check",
    summary: "多平台违禁词检测（逐平台各计费一次；--platforms 逗号分隔，默认 xiaohongshu,douyin,gongzhonghao）",
    args: [{ name: "text", required: true, variadic: true }],
    flags: {
      platforms: { value: true, summary: "逗号分隔的平台列表" },
      raw: { summary: "保留 raw 里与顶层重复的 content/originalContent（默认剥掉）" }
    },
    // 对账闸按路由模式比：这条命令真打的是具体 slug，但服务端注册的是 :platform/:slug 那条通配路由。
    routes: [{ method: "POST", path: "/api/apis/:platform/:slug/call" }],
    billable: true, destructive: false, composite: true,
    run: (ctx, { args, flags }) => bannedCheck(ctx, args.text, { platforms: flags.platforms, raw: flags.raw })
  }
];
