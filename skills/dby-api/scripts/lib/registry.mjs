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

export const ALL_COMMANDS = [
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
  ...taskCommands,
  ...usageCommands,
  ...uploadCommands,
  ...whoamiCommands,
  ...bannedCommands,
  ...routesCommands
];

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
  banned: "违禁词检测（多平台扇出）"
};

export const GROUPS = [...new Set(ALL_COMMANDS.map((c) => c.group).filter((g) => g !== null))].map((name) => ({
  name,
  summary: GROUP_SUMMARY[name] ?? ""
}));
