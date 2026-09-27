// registry.mjs — 命令表的汇总点（design D2）。各组的 `commands` 数组来自 commands/*.mjs，
// 这里只做拼接与分组元信息，不重复定义任何命令、也不做校验。
//
// 同一份 ALL_COMMANDS 同时驱动三件事：argv.mjs 的解析与 --help、`dby routes --json`
// （主仓路由对账闸消费）。新增一条命令只需要去对应 commands/<group>.mjs 里加一条，
// 这个文件不用再改；新增一个组才需要在下面补一行 import + 一条 GROUP_SUMMARY。

import { commands as apiCommands } from "./commands/api.mjs";
import { commands as writeCommands } from "./commands/write.mjs";
import { commands as charterCommands } from "./commands/charter.mjs";
import { commands as doctorCommands } from "./commands/doctor.mjs";
import { commands as draftCommands } from "./commands/draft.mjs";
import { commands as articleCommands } from "./commands/article.mjs";
import { commands as retroCommands } from "./commands/retro.mjs";
import { commands as profileCommands } from "./commands/profile.mjs";
import { commands as docCommands } from "./commands/doc.mjs";
import { commands as materialCommands } from "./commands/material.mjs";
import { commands as inspCommands } from "./commands/insp.mjs";
import { commands as wechatCommands } from "./commands/wechat.mjs";
import { commands as taskCommands } from "./commands/task.mjs";
import { commands as usageCommands } from "./commands/usage.mjs";
import { commands as uploadCommands } from "./commands/upload.mjs";
import { commands as whoamiCommands } from "./commands/whoami.mjs";
import { commands as bannedCommands } from "./commands/banned.mjs";
import { commands as routesCommands } from "./commands/routes.mjs";
import { commands as authCommands } from "./commands/auth.mjs";
import { commands as imageCommands } from "./commands/image.mjs";
import { commands as pipelineCommands } from "./commands/pipeline.mjs";
import { commands as fetchArticleCommands } from "./commands/fetch-article.mjs";
import { commands as renderCommands } from "./commands/render.mjs";
import { commands as deaiCommands } from "./commands/deai.mjs";
import { commands as rewriteCommands } from "./commands/rewrite.mjs";
import { commands as feedbackCommands } from "./commands/feedback.mjs";

/**
 * 命令三分类（dby-cli-rebuild design D8 / spec「子命令分三类并由对账闸核对」）：
 *   route     恰好打一条服务端路由；
 *   composite 打多条路由（或像 doctor/login 那样联网但路由另有归属，见各自注释），必须显式登记；
 *   local     不发出任何 doubaoya 请求（cli/test/local-no-network.test.mjs 用「收到请求即记一笔」的桩钉住）。
 * 命令可以显式写 `kind`；没写时按旧字段推导：composite:true → composite，有路由 → route，没有 → local。
 *
 * 第四种 `alias`（写 `aliasOf: "<主命令全名>"` 即是）：同一条（组）服务端路由的另一种调用面——参数形状或
 * 本地输出加工不同，但打的路由与主命令**完全相同**（cli/test/routes-contract.test.mjs 钉住）。
 * 对账闸要求「同一路由至多一条 route 命令」，所以 alias 不作为独立条目进 `dby routes --json`，
 * 而是挂在主命令的 `aliases` 里（见 commands/routes.mjs）。
 */
export function commandKind(c) {
  if (c.aliasOf) return "alias";
  if (c.kind) return c.kind;
  if (c.composite) return "composite";
  return (c.routes ?? []).length > 0 ? "route" : "local";
}

const RAW_COMMANDS = [
  ...apiCommands,
  ...writeCommands,
  ...charterCommands,
  ...doctorCommands,
  ...draftCommands,
  ...articleCommands,
  ...retroCommands,
  ...profileCommands,
  ...docCommands,
  ...materialCommands,
  ...inspCommands,
  ...wechatCommands,
  ...pipelineCommands,
  ...fetchArticleCommands,
  ...taskCommands,
  ...usageCommands,
  ...uploadCommands,
  ...whoamiCommands,
  ...bannedCommands,
  ...routesCommands,
  ...authCommands,
  ...imageCommands,
  ...renderCommands,
  ...deaiCommands,
  ...rewriteCommands,
  ...feedbackCommands
];

export const ALL_COMMANDS = RAW_COMMANDS.map((c) => ({ ...c, kind: commandKind(c) }));

// 组的一句话摘要（顶层 --help 用）。只有出现在某条命令里的 group 才会被列出——
// 还没实现的组（对应 commands/*.mjs 导出空数组）不会出现在 GROUPS 里，help 不列空组。
const GROUP_SUMMARY = {
  api: "能力目录：发现（免费）与调用（按能力计费）",
  write: "公众号写作主干取数（全部免费路由）",
  charter: "号章程读写（免费路由；PUT 是全量替换）",
  draft: "稿件面：建稿/取稿/提交新版/评论（全部免费）",
  article: "文章中心（读）",
  retro: "复盘（读）",
  profile: "IP 档案与范文",
  doc: "文档",
  material: "素材库",
  insp: "灵感库（读）",
  wechat: "公众号：渲染/选题/复盘/发布/主题",
  task: "任务清单（读）",
  usage: "用量明细与分析",
  upload: "媒体上传",
  banned: "违禁词检测（多平台扇出）",
  image: "生图 / 改图（慢、计费）与配图规划、封面裁切（本地）",
  deai: "去 AI 味体检（纯本地，不给分数）",
  rewrite: "多平台改写规则（纯本地）",
  feedback: "反馈：拼载荷 / 用户过目后提交（纯本地，端点未配置时落本地文件）"
};

export const GROUPS = [...new Set(ALL_COMMANDS.map((c) => c.group).filter((g) => g !== null))].map((name) => ({
  name,
  summary: GROUP_SUMMARY[name] ?? ""
}));
