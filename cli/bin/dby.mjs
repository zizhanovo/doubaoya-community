#!/usr/bin/env node
// dby — 都爆鸭统一 CLI 入口。真正的组装在 src/main.mjs；这里只负责把退出码交还给进程。
// 用 process.exitCode 而不是 process.exit()：让 stdout 排空，不截断 JSON。

import { runCli } from "../src/main.mjs";

process.exitCode = await runCli(process.argv);
