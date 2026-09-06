// cli.mjs — 命令面组装与统一收尾：契约（输出信封 / 退出码 / 确认协议）在这里合拢
// （替代旧版基于 commander 的 main.mjs，见 design D2）。各命令只返回 { data, human }，
// 成功/失败/确认三种终态的呈现全部走 output.mjs 的唯一出口；解析全部走 argv.mjs，
// 命令表全部来自 registry.mjs——这三处职责分开，改命令不用碰这个文件。

import { makeContext } from "./context.mjs";
import { EXIT, DbyError, ConfirmationRequired } from "./errors.mjs";
import { emitSuccess, emitFailure, emitConfirmation } from "./output.mjs";
import { resolveCommand, parseArgs, commandUsage, groupUsage, topLevelUsage } from "./argv.mjs";
import { ALL_COMMANDS, GROUPS } from "./registry.mjs";
import { readVersion } from "./version.mjs";

function printHelp(target) {
  if (target.level === "top") {
    return topLevelUsage(GROUPS, ALL_COMMANDS.filter((c) => c.group === null));
  }
  if (target.level === "group") {
    return groupUsage(target.group, target.commandsInGroup);
  }
  return commandUsage(target.command);
}

/** CLI 主入口。返回退出码（bin 里赋给 process.exitCode，避免截断 stdout）。 */
export async function runCli(argv = process.argv) {
  const args = argv.slice(2);

  // --version 是独立终态：直接打版本号，不走信封（与 doctor.test.mjs 的基线一致）。
  if (args[0] === "--version") {
    process.stdout.write(`${readVersion()}\n`);
    return EXIT.OK;
  }

  // 兜底 ctx：解析半途失败（USAGE/未预期异常）时仍要能按契约 emit，
  // 全局 flags 从原始 argv 尽力而为地读（不依赖已经失败的那次解析）。
  const fallbackCtx = () =>
    makeContext({
      flags: { json: args.includes("--json"), color: !args.includes("--no-color") },
      argv: args
    });

  try {
    const resolved = resolveCommand(args, { commands: ALL_COMMANDS, groups: GROUPS });
    if (resolved.helpTarget) {
      process.stdout.write(`${printHelp(resolved.helpTarget)}\n`);
      return EXIT.OK;
    }

    const { command, rest } = resolved;
    const parsed = parseArgs(command, rest);
    if (parsed.helpRequested) {
      process.stdout.write(`${commandUsage(command)}\n`);
      return EXIT.OK;
    }

    const ctx = makeContext({ flags: parsed.flags, argv: args });
    const { data, human } = await command.run(ctx, { args: parsed.args, flags: parsed.flags });
    emitSuccess(ctx, data, human);
    return EXIT.OK;
  } catch (err) {
    if (err instanceof ConfirmationRequired) {
      emitConfirmation(fallbackCtx(), err);
      return EXIT.CONFIRM;
    }
    if (err instanceof DbyError) {
      emitFailure(fallbackCtx(), err);
      return err.exit;
    }
    // 未预期异常：一般错误（1），栈进 stderr 方便报障。
    process.stderr.write(`未预期的错误：${err?.stack || err?.message || err}\n`);
    const ctx = fallbackCtx();
    if (ctx.json) emitFailure(ctx, new DbyError("UNEXPECTED", String(err?.message ?? err), { exit: EXIT.GENERAL }));
    return EXIT.GENERAL;
  }
}
