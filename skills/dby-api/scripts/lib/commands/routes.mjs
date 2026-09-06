// routes.mjs — `dby routes`：离线导出命令表，主仓「路由 − 排除清单 == 子命令表」对账闸
// 消费的契约（design D6/D7）。不读 key、不联网——纯粹从 registry.mjs 的 ALL_COMMANDS 派生。
//
// 🔴 与 registry.mjs 互相 import（registry 汇总各组的 commands，routes 组本身也是一条
//    "commands"，同时又要读汇总后的 ALL_COMMANDS 来打印）。这是安全的循环 import：
//    ALL_COMMANDS 只在 run() 执行时（模块图早已跑完）被读取，不在本文件顶层访问，
//    ESM 的实时绑定保证那时它已经赋好值。改这条 import 前先想清楚这一点。
import { ALL_COMMANDS } from "../registry.mjs";

function commandName(cmd) {
  return cmd.group ? `${cmd.group} ${cmd.name}` : cmd.name;
}

/** `dby routes --json` 的 stdout 契约：字段名不能变，主仓对账闸按字面读。 */
function toCommandsOutput() {
  return ALL_COMMANDS.map((c) => ({
    name: commandName(c),
    routes: c.routes ?? [],
    billable: !!c.billable,
    destructive: !!c.destructive,
    composite: !!c.composite
  }));
}

export async function routesCommand() {
  const commands = toCommandsOutput();
  const human = commands
    .map((c) => `${c.name.padEnd(24)} ${c.routes.map((r) => `${r.method} ${r.path}`).join(", ") || "(无 HTTP 路由)"}`)
    .join("\n");
  return { data: { commands }, human };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: null, name: "routes",
    summary: "导出命令表（供主仓路由对账闸消费）：{ commands: [{ name, routes, billable, destructive, composite }] }",
    args: [], flags: {},
    routes: [], billable: false, destructive: false, composite: false,
    run: () => routesCommand()
  }
];
