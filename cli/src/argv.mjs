// argv.mjs — 手写参数解析器，替代 commander（design D2：零依赖是「装好即可达」的前提，
// 用户目录里没有 node_modules）。
//
// 支持面：两级子命令（`<组> <命令>`）与单级命令（`doctor`/`routes`/`whoami` 这类）、
// 位置参数（必填/可选/变长，变长参数必须是该命令最后一个位置参数）、
// `--flag`（布尔）、`--key value` / `--key=value`（取值）、`--help`/`-h`（任意位置，命中即
// 短路成帮助请求）。`--json`/`--no-color`/`--confirm` 是全局 flag，在命令自己的 flags 表之外
// 单独识别，任何命令都认得。
//
// 未知 flag / 缺必填位置参数 / 未知命令 → 抛 DbyError(USAGE)，退出码 2；错误信息本身就带着
// 该命令（或该组、或顶层）的用法文本——上层 emitFailure 会把这段话原样打到 stderr，不必再拼一次。

import { DbyError, EXIT } from "./errors.mjs";

const GLOBAL_BOOLEAN_FLAGS = new Set(["json", "confirm"]);

function toCamelCase(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function splitEq(token) {
  const i = token.indexOf("=");
  return i === -1 ? [token, undefined] : [token.slice(0, i), token.slice(i + 1)];
}

function argPlaceholder(a) {
  const body = a.variadic ? `${a.name}...` : a.name;
  return a.required ? `<${body}>` : `[${body}]`;
}

/** 单条命令的详细用法：位置参数占位 + flags 说明。 */
export function commandUsage(cmd) {
  const head = cmd.group ? `dby ${cmd.group} ${cmd.name}` : `dby ${cmd.name}`;
  const argsStr = (cmd.args ?? []).map(argPlaceholder).join(" ");
  const lines = [`用法: ${head}${argsStr ? ` ${argsStr}` : ""}`, "", cmd.summary ?? ""];
  const flagNames = Object.keys(cmd.flags ?? {});
  if (flagNames.length) {
    lines.push("", "flags：");
    for (const name of flagNames) {
      const spec = cmd.flags[name];
      lines.push(`  --${name}${spec.value ? " <值>" : ""}  ${spec.summary ?? ""}`);
    }
  }
  return lines.join("\n");
}

/** 组内命令清单：`dby <组> --help` 或组用错子命令时打这个。 */
export function groupUsage(group, commandsInGroup) {
  const lines = [`用法: dby ${group} <命令> [参数] [flags]`, "", "命令："];
  for (const c of commandsInGroup) lines.push(`  ${c.name.padEnd(18)} ${c.summary ?? ""}`);
  lines.push("", `跑 \`dby ${group} <命令> --help\` 看某条命令的参数。`);
  return lines.join("\n");
}

/** 顶层用法：组清单 + 单命令清单。裸 `dby` / 未知命令都打这个。 */
export function topLevelUsage(groups, singles = []) {
  const lines = ["用法: dby <组> <命令> [参数] [flags]", "", "组："];
  for (const g of groups) lines.push(`  ${g.name.padEnd(10)} ${g.summary ?? ""}`);
  if (singles.length) {
    lines.push("", "单命令：");
    for (const c of singles) lines.push(`  ${c.name.padEnd(10)} ${c.summary ?? ""}`);
  }
  lines.push("", "跑 `dby <组> --help` 看某组下的命令、`dby <组> <命令> --help` 看参数。");
  return lines.join("\n");
}

/**
 * 第一步：从 args（已去掉 node 与脚本路径）里定位目标命令。
 * 返回 `{ command, rest }`（rest 是命令名之后剩下的 token）或 `{ helpTarget }`
 * （调用方应打印对应级别的帮助文本并以退出码 0 收场）。定位不到命令时直接抛 USAGE。
 */
export function resolveCommand(args, { commands, groups }) {
  const [a0, a1] = args;

  if (a0 === undefined) {
    throw new DbyError("USAGE", `缺少命令。\n\n${topLevelUsage(groups, commands.filter((c) => c.group === null))}`, {
      exit: EXIT.USAGE
    });
  }
  if (a0 === "--help" || a0 === "-h") {
    return { helpTarget: { level: "top" } };
  }

  const single = commands.find((c) => c.group === null && c.name === a0);
  if (single) {
    if (a1 === "--help" || a1 === "-h") return { helpTarget: { level: "command", command: single } };
    return { command: single, rest: args.slice(1) };
  }

  const group = groups.find((g) => g.name === a0);
  if (!group) {
    throw new DbyError("USAGE", `未知命令：${a0}。\n\n${topLevelUsage(groups, commands.filter((c) => c.group === null))}`, {
      exit: EXIT.USAGE
    });
  }
  const commandsInGroup = commands.filter((c) => c.group === a0);
  if (a1 === undefined) {
    throw new DbyError("USAGE", `缺少子命令。\n\n${groupUsage(a0, commandsInGroup)}`, { exit: EXIT.USAGE });
  }
  if (a1 === "--help" || a1 === "-h") {
    return { helpTarget: { level: "group", group: a0, commandsInGroup } };
  }
  const cmd = commandsInGroup.find((c) => c.name === a1);
  if (!cmd) {
    throw new DbyError("USAGE", `未知子命令：${a0} ${a1}。\n\n${groupUsage(a0, commandsInGroup)}`, { exit: EXIT.USAGE });
  }
  return { command: cmd, rest: args.slice(2) };
}

/**
 * 第二步：已定位命令后，把剩余 token 拆成位置参数与 flags。
 * 返回 `{ helpRequested: true }`（命中 --help/-h，不再往下解析）或 `{ args, flags }`。
 * flags 里混着全局 flag（json/confirm/color）与命令自己的 flag（camelCase 键）——
 * makeContext 只认前三个，其余字段它不看，命令的 run() 从同一个对象里取自己的键。
 */
export function parseArgs(cmd, rest) {
  const positionals = [];
  const flags = {};

  for (let i = 0; i < rest.length; i++) {
    // 变量特意不叫 token——这是 argv 里的一段文本（如 "--json"），不是密钥；
    // 叫 token 会被 tools/validate_community.py 的密钥截断展示闸按字面误判命中。
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") return { helpRequested: true };
    if (arg.startsWith("--")) {
      const [rawName, eqValue] = splitEq(arg.slice(2));
      if (GLOBAL_BOOLEAN_FLAGS.has(rawName)) {
        flags[rawName] = true;
        continue;
      }
      if (rawName === "no-color") {
        flags.color = false;
        continue;
      }
      const spec = (cmd.flags ?? {})[rawName];
      if (!spec) {
        throw new DbyError("USAGE", `未知参数 --${rawName}。\n\n${commandUsage(cmd)}`, { exit: EXIT.USAGE });
      }
      const key = toCamelCase(rawName);
      if (spec.value) {
        const value = eqValue !== undefined ? eqValue : rest[++i];
        if (value === undefined) {
          throw new DbyError("USAGE", `--${rawName} 缺值。\n\n${commandUsage(cmd)}`, { exit: EXIT.USAGE });
        }
        flags[key] = value;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positionals.push(arg);
  }

  const argSpecs = cmd.args ?? [];
  const values = {};
  let idx = 0;
  for (const spec of argSpecs) {
    if (spec.variadic) {
      values[spec.name] = positionals.slice(idx);
      idx = positionals.length;
      if (spec.required && values[spec.name].length === 0) {
        throw new DbyError("USAGE", `缺少参数 <${spec.name}...>。\n\n${commandUsage(cmd)}`, { exit: EXIT.USAGE });
      }
      continue;
    }
    if (idx < positionals.length) {
      values[spec.name] = positionals[idx++];
    } else if (spec.required) {
      throw new DbyError("USAGE", `缺少参数 <${spec.name}>。\n\n${commandUsage(cmd)}`, { exit: EXIT.USAGE });
    } else {
      values[spec.name] = undefined;
    }
  }
  if (idx < positionals.length) {
    throw new DbyError("USAGE", `多余的参数：${positionals.slice(idx).join(" ")}。\n\n${commandUsage(cmd)}`, {
      exit: EXIT.USAGE
    });
  }

  return { args: values, flags, helpRequested: false };
}
