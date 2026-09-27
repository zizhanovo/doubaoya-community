#!/usr/bin/env node
// bin/dby.mjs — npm 包 @doubaoya/cli 的唯一入口（design D1）。
//
// 🔴 第一件事是 Node 版本检查（spec「独立 npm 包与唯一 bin」/ tasks 2.2）：
//    低于 22 时退出码 3，**不联网、不写文件**——所以检查必须排在任何业务模块 import 之前。
//    本文件没有任何静态 import，业务代码走动态 import，
//    保证低版本 Node 上一行业务代码都不加载。
//    这里的语法也刻意保持朴素（不用 ?.、?? 之类），让老版本 Node 也能跑到这一步报错，
//    而不是在解析阶段就崩出一段看不懂的 SyntaxError（顶层 await 需要 Node ≥14.8）。
//
// 用 process.exitCode 而不是 process.exit()：让 stdout 排空，不截断 JSON。

const REQUIRED_MAJOR = 22;
const current = process.versions.node;
const major = Number(String(current).split(".")[0]);

if (!(major >= REQUIRED_MAJOR)) {
  process.stderr.write(
    "dby 需要 Node ≥" + REQUIRED_MAJOR + "，当前 " + current + "。\n" +
      "升级方式：到 https://nodejs.org 下载 22 LTS，或用 nvm/fnm 执行 `nvm install 22`；升级后重跑原命令。\n" +
      "（本次没有发出任何网络请求，也没有写任何文件。）\n"
  );
  process.exitCode = 3; // EXIT.BUSINESS：运行环境不满足，与 errors.mjs 的语义一致
} else {
  const { runCli } = await import("../src/cli.mjs");
  process.exitCode = await runCli(process.argv);
}
