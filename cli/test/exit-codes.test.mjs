// exit-codes.test.mjs — spec「输出信封与退出码沿用既有契约」的退出码范围一半（tasks 2.5）：
// 命令表里**每一条**命令都真起进程跑一遍，退出码必须落在 0–6，非 0 时 stdout 必须是单个信封。
//
// 跑法：必填位置参数一律填占位值，服务端桩对任何请求回 500（鉴权、业务、网络各类失败路径都会
// 被走到一部分），超时压到 3 秒。命令多，用有限并发。
// 🔴 元断言：跑到的命令数必须等于命令表条数，且 > 30（防命令表退化成空集时本测试空转变绿）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_COMMANDS } from "../src/registry.mjs";
import { runCli, startMock } from "./helpers.mjs";

const nameOf = (c) => (c.group ? `${c.group} ${c.name}` : c.name);

function argvFor(c) {
  const head = c.group ? [c.group, c.name] : [c.name];
  const positionals = (c.args ?? []).filter((a) => a.required).map(() => "x");
  return [...head, ...positionals, "--json"];
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

test("每条命令的退出码都在 0–6，失败时 stdout 仍是单个 JSON 信封", async () => {
  const mock = await startMock(
    new Proxy({}, { get: () => () => ({ status: 500, json: { success: false, error: { code: "BOOM", message: "桩" } } }) })
  );
  try {
    const home = mkdtempSync(path.join(tmpdir(), "dby-exit-home-"));
    // 🔴 cwd 也放进临时目录：`skills install` 这类命令默认写当前目录（scope=project），在 cli/ 里跑会往仓里落文件。
    const cwd = mkdtempSync(path.join(tmpdir(), "dby-exit-cwd-"));
    const results = await pool(ALL_COMMANDS, 8, async (c) => {
      const argv = argvFor(c);
      const r = await runCli(argv, {
        env: {
          DOUBAOYA_BASE_URL: mock.url,
          DOUBAOYA_API_KEY: "dyh_test_key_never_real",
          DOUBAOYA_TIMEOUT_MS: "3000",
          DBY_LOGIN_TIME_SCALE: "0.001",
          HOME: home
        },
        cwd
      });
      return { name: nameOf(c), argv, ...r };
    });
    assert.equal(results.length, ALL_COMMANDS.length);
    assert.ok(results.length > 30, `只跑到 ${results.length} 条命令——命令表可能退化了`);
    const bad = [];
    for (const r of results) {
      if (!(Number.isInteger(r.code) && r.code >= 0 && r.code <= 6)) {
        bad.push(`${r.name}：退出码 ${r.code}（argv: ${r.argv.join(" ")}）\n    stderr: ${r.stderr.slice(0, 300)}`);
        continue;
      }
      if (r.code !== 0) {
        try {
          const env = JSON.parse(r.stdout);
          if (env.ok !== false) bad.push(`${r.name}：退出码 ${r.code} 但信封 ok=${env.ok}`);
        } catch {
          bad.push(`${r.name}：退出码 ${r.code} 但 stdout 不是单个 JSON：${JSON.stringify(r.stdout.slice(0, 200))}`);
        }
      }
    }
    assert.deepEqual(bad, [], `退出码契约被破坏：\n${bad.join("\n")}`);
  } finally {
    await mock.close();
  }
});
