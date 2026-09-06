#!/usr/bin/env node
// doubaoya.mjs — 上一代入口的转发壳（design D3；spec:「旧入口过渡一个大版本」）。
// 真正的实现已经搬到同目录的 dby.mjs + lib/**；本文件只做「旧动词 → 新命令」的映射后
// 转发，不再自己拼 HTTP 请求、不再自己解析信封——那些逻辑现在只有一份，在 lib/http.mjs。
// 下一个大版本删除本文件，届时旧 SKILL.md/文档里的调用点也该全部改完。
//
// 映射表：
//   list [--skills|--apis]           → api list [--skills|--apis]
//   search <query>                   → api search <query>
//   describe <ref>                   → api describe <ref>
//   invoke <ref> [json] [--raw]      → api invoke <ref> [json] --confirm [--raw]
//     （旧脚本本来就直接执行、没有确认协议；这里补 --confirm 是为了保持那个行为，
//      不是新加的摩擦——调用方不用跟着改。）
//   draft <sub> ...                  → draft <sub> ...        （子命令名 1:1，未变）
//   inspirations [--since N] [--ids] → insp list [--since N] [--ids]
//   selfcheck                        → 提示改跑 `cd cli && node --test`（断言已搬进 cli/test/*.mjs）
//   其余未知动词                      → 原样交给新入口，走它的用法错契约（退出码 2）

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCli } from "./lib/cli.mjs";

const DEPRECATION_NOTICE =
  "doubaoya.mjs 已弃用，下一个大版本删除，请改用同目录的 dby.mjs（用法见 `node dby.mjs --help`）。";

function mapLegacyArgs(rawArgs) {
  const [cmd, ...rest] = rawArgs;
  switch (cmd) {
    case "list":
      return ["api", "list", ...rest];
    case "search":
      return ["api", "search", ...rest];
    case "describe":
      return ["api", "describe", ...rest];
    case "invoke": {
      const keepRaw = rest.includes("--raw");
      const args = rest.filter((a) => a !== "--raw");
      return ["api", "invoke", ...args, "--confirm", ...(keepRaw ? ["--raw"] : [])];
    }
    case "draft":
      return ["draft", ...rest];
    case "inspirations":
      return ["insp", "list", ...rest];
    default:
      return rawArgs; // 未知动词原样交给新入口报 USAGE——「用法错」这条契约不因转发而变。
  }
}

// 🔴 与 dby.mjs 完全同一份入口守卫实现（同族，改一处要全改，见 dby.mjs 顶部注释）。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const selfPath = fileURLToPath(import.meta.url);
  const href = (p) => {
    try {
      return pathToFileURL(realpathSync(p)).href;
    } catch {
      return null;
    }
  };
  const called = href(argv1);
  const here = href(selfPath);
  if (called && here) return called === here;
  if (argv1 === selfPath) return true;
  console.error(
    `提示：解析不出 ${argv1} 的真实路径，没法确认是不是在直接跑本脚本；` +
      `如果你就是在直接跑它，换成绝对路径重试。`
  );
  return false;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  console.error(DEPRECATION_NOTICE);

  if (rawArgs[0] === "selfcheck") {
    console.error(
      "selfcheck 已经退役：断言搬进了 cli/test/*.mjs（api-parity.test.mjs / draft-pure.test.mjs 等），跑 `cd cli && node --test`。"
    );
    process.exitCode = 0;
    return;
  }

  process.exitCode = await runCli(["node", "dby.mjs", ...mapLegacyArgs(rawArgs)]);
}

if (isMainModule()) {
  await main();
}
