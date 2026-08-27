// main.mjs — 命令面组装与统一收尾：契约（输出信封 / 退出码 / 确认协议）在这里合拢。
// 各命令只返回 { data, human }，成功/失败/确认三种终态的呈现全部走 output.mjs 的唯一出口。

import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import { makeContext } from "./context.mjs";
import { EXIT, DbyError, ConfirmationRequired } from "./errors.mjs";
import { emitSuccess, emitFailure, emitConfirmation } from "./output.mjs";
import { apiList, apiSearch, apiDescribe, apiInvoke } from "./commands/api.mjs";
import { writePrep, writeTopics, writeReview } from "./commands/write.mjs";
import { charterProfiles, charterGet, charterPut } from "./commands/charter.mjs";
import { doctor } from "./commands/doctor.mjs";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

/** 包一层：拿全局+本命令 flags 建 ctx，跑命令，emit 成功。失败与确认由 runCli 的 catch 收。 */
function wrap(fn) {
  return async function (...args) {
    const cmd = args[args.length - 1]; // commander 把 Command 对象放在参数末尾
    const ctx = makeContext({ flags: cmd.optsWithGlobals() });
    const { data, human } = await fn(ctx, ...args.slice(0, -1));
    emitSuccess(ctx, data, human);
  };
}

export function buildProgram() {
  const program = new Command();
  program
    .name("dby")
    .description("都爆鸭统一 CLI：一处鉴权、一套输出与退出码契约、计费操作协议化确认")
    .version(pkg.version)
    .option("--json", "stdout 输出单个 {ok,data,error} JSON（非 TTY 时是默认）")
    .option("--no-color", "关闭颜色（NO_COLOR 环境变量同效）")
    .exitOverride()          // 用法错不许 commander 自己 exit(1)——契约是退出码 2
    .showHelpAfterError();   // 用法错时把该子命令的用法打到 stderr（spec 场景）

  // ── dby api ────────────────────────────────────────────────────────────────
  const api = program.command("api").description("能力目录：发现（免费）与调用（按能力计费）");
  api.command("list")
    .description("拉能力清单（默认两个集合都拉）")
    .option("--skills", "只拉产品化 Skill 集合")
    .option("--apis", "只拉平台数据能力集合")
    .action(wrap((ctx, opts) => apiList(ctx, opts)));
  api.command("search <query...>")
    .description("按关键词搜（两个集合都搜）")
    .action(wrap((ctx, words) => apiSearch(ctx, words.join(" "))));
  api.command("describe <ref>")
    .description("看单条能力的入参/出参/调用路径（入参一律现拉，别照记忆拼）")
    .action(wrap((ctx, ref) => apiDescribe(ctx, ref)));
  api.command("invoke <ref> [body]")
    .description("调一条能力。计费能力默认停在 confirmation_required（退出码 6），--confirm 放行")
    .option("--raw", "保留响应里与 items/content 重复的 raw")
    .option("--confirm", "确认执行计费/不可逆操作")
    .action(wrap((ctx, ref, body, opts) => apiInvoke(ctx, ref, body, opts)));

  // ── dby write ──────────────────────────────────────────────────────────────
  const write = program.command("write").description("公众号写作主干取数（全部免费路由）");
  write.command("prep")
    .description("写前几样一次拉齐（档案/章程/范文/规范/素材索引）；warnings 走 stderr")
    .action(wrap((ctx) => writePrep(ctx)));
  write.command("topics [niche]")
    .description("选题候选（用户已经说了写什么就别调）")
    .action(wrap((ctx, niche) => writeTopics(ctx, niche)));
  write.command("review")
    .description("复盘取数 + 四象限（基准=本号历史中位数；no_account/no_articles → 退出码 3）")
    .action(wrap((ctx) => writeReview(ctx)));

  // ── dby charter ────────────────────────────────────────────────────────────
  const charter = program.command("charter").description("号章程读写（免费路由；PUT 是全量替换）");
  charter.command("profiles")
    .description("列出我的档案（id / 是否默认 / 名字）")
    .action(wrap((ctx) => charterProfiles(ctx)));
  charter.command("get")
    .description("读章程；--for-edit 输出已剥 products、可直接改再 put 的形态")
    .option("--profile <id>", "指定档案（默认用默认档案）")
    .option("--for-edit", "剥掉只读投影键 products")
    .action(wrap((ctx, opts) => charterGet(ctx, opts)));
  charter.command("put <file>")
    .description("全量替换章程（无论如何都会再剥一次 products）")
    .option("--profile <id>", "指定档案（默认用默认档案）")
    .action(wrap((ctx, file, opts) => charterPut(ctx, file, opts)));

  // ── dby doctor ─────────────────────────────────────────────────────────────
  program.command("doctor")
    .description("自诊断：key 在不在、服务通不通、key 能不能用。全过 0，有项不过 3")
    .action(wrap((ctx) => doctor(ctx, pkg.version)));

  return program;
}

/** CLI 主入口。返回退出码（bin 里赋给 process.exitCode，避免截断 stdout）。 */
export async function runCli(argv = process.argv) {
  const program = buildProgram();
  // 终态兜底的 ctx：即使 parse 半途失败也要能按契约 emit（此时全局 flags 尽力而为地读）。
  const fallbackCtx = () =>
    makeContext({ flags: { json: argv.includes("--json"), color: !argv.includes("--no-color") } });
  try {
    await program.parseAsync(argv);
    return process.exitCode ?? EXIT.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      // 显式 --help / --version 是正常终态（0）；其余 commander 错误全是用法错 → 退出码 2
      //（含裸 `dby` / 裸 `dby api`：缺子命令也是用法错，help 已打到 stderr）。
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
        return EXIT.OK;
      }
      const ctx = fallbackCtx();
      // commander 已把报错与用法打到 stderr（showHelpAfterError）；JSON 通道再补契约信封。
      if (ctx.json) {
        emitFailure(ctx, new DbyError("USAGE", err.message.trim(), {
          exit: EXIT.USAGE,
          remediation: "跑 `dby --help` 或 `dby <命令> --help` 看用法。"
        }));
      }
      return EXIT.USAGE;
    }
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
