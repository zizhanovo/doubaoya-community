#!/usr/bin/env node
// bin/dby.mjs — cli/ 已退成开发夹具（design D3）：真正的实现在 skills/dby-api/scripts/。
// 本文件只给维护者 `npm link` 用，装不进用户的 skills 目录，因此不需要 dby.mjs 那道
// realpath 入口守卫（转发到的是 lib/cli.mjs 的 runCli，不是需要防软链误判的那个入口脚本）。
import { runCli } from "../../skills/dby-api/scripts/lib/cli.mjs";

process.exitCode = await runCli(process.argv);
