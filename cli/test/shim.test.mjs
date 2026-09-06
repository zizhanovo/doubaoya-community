// shim.test.mjs — 任务 4.x：`scripts/dby.mjs` 引导壳（规格 dby-cli-coverage「装好即可达」）。
// 壳本身不实现 CLI，只做「找到真身 → 原样转发 argv → 透传退出码」；这里既核行为
// （对拍真身输出、退出码透传、缺 dby-api 时的失败形态、DBY_CLI 兜底），也核四份拷贝
// （加上用户模板附录那份）没有漂移——同族见 cli/test/locate.test.mjs 对 locate-dby.mjs 的对拍。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CLI_BIN, REPO_ROOT, runNode } from "./helpers.mjs";

const SKILLS = path.join(REPO_ROOT, "skills");
const SHIM_PATHS = [
  "dby-write/scripts/dby.mjs",
  "dby-charter/scripts/dby.mjs",
  "dby-publish/scripts/dby.mjs",
  "dby-banned-words/scripts/dby.mjs",
];
// 用户专属 skill 模板的附录抄的是同一份壳，落在 references/ 而不是 scripts/ 是为了不撞见
// dby-api 自己的「选路层正文不许出现驼峰标识符」闸（见 tools/validate_community.py 的
// validate_cli_shims_identical 注释）——但既然贴的是同一份壳，也该跟其余四份一样钉住。
const TEMPLATE_APPENDIX_SHIM = "dby-api/references/dby-shim.mjs";

// (a) 通过 dby-write 的壳拿到与真身逐字节相同的 stdout（routes --json 是最省事的探针：
//     不联网、不需要 key，输出又足够大，能真的证明「转发」而不是碰巧两边都打印了空字符串）。
test("shim：经 dby-write 的 scripts/dby.mjs 调 routes --json，stdout 与真身逐字节相同", async () => {
  const shim = path.join(SKILLS, "dby-write/scripts/dby.mjs");
  const viaShim = await runNode(shim, ["routes", "--json"]);
  const viaReal = await runNode(CLI_BIN, ["routes", "--json"]);
  assert.equal(viaShim.code, 0, viaShim.stderr);
  assert.equal(viaReal.code, 0, viaReal.stderr);
  assert.equal(viaShim.stdout, viaReal.stdout);
});

// (b) 退出码透传：未知命令在真身里是 USAGE（退出码 2），经壳转发必须原样带回来，不能被
//     子进程边界吞掉或改写成别的值（比如 1）。
test("shim：dby-charter 的 scripts/dby.mjs 转发未知命令，退出码透传为 2", async () => {
  const shim = path.join(SKILLS, "dby-charter/scripts/dby.mjs");
  const r = await runNode(shim, ["nosuch"]);
  assert.equal(r.code, 2, `stdout=${r.stdout} stderr=${r.stderr}`);
});

// (c) 把 dby-banned-words 单独拷到一个没有 dby-api 的 tmp 目录（模拟「用户只装了这一个包」），
//     壳必须自己报清楚缺什么，而不是尝试自己拼一份请求——那正是「装好即可达」要防的另一半：
//     没装全时**明确失败**，不能吞成看似成功的空输出。
async function isolateBannedWordsOnly() {
  const tmp = await mkdtemp(path.join(tmpdir(), "dby-shim-isolated-"));
  const scriptsDir = path.join(tmp, "dby-banned-words", "scripts");
  await mkdir(scriptsDir, { recursive: true });
  await copyFile(
    path.join(SKILLS, "dby-banned-words/scripts/dby.mjs"),
    path.join(scriptsDir, "dby.mjs")
  );
  return { tmp, shim: path.join(scriptsDir, "dby.mjs") };
}

test("shim：只装 dby-banned-words 没装 dby-api → 退出码 3 且 stderr 含 MISSING_DBY_API", async () => {
  const { tmp, shim } = await isolateBannedWordsOnly();
  try {
    const r = await runNode(shim, ["routes", "--json"]);
    assert.equal(r.code, 3, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /MISSING_DBY_API/);
    assert.match(r.stderr, /dby-update|DBY_CLI/); // 指引安装方式
    assert.equal(r.stdout, "", "找不到真身时不该有 stdout——没有半份结果可给");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// (d) 同样隔离的布局下，设 DBY_CLI 指向真身 → 兜底生效，能真的转发成功（不是卡在
//     MISSING_DBY_API 上侥幸没炸）。
test("shim：隔离布局下设 DBY_CLI 指向真身，转发成功且不报 MISSING_DBY_API", async () => {
  const { tmp, shim } = await isolateBannedWordsOnly();
  try {
    const r = await runNode(shim, ["routes", "--json"], { env: { DBY_CLI: CLI_BIN } });
    assert.equal(r.code, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /MISSING_DBY_API/);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.ok, true);
    assert.ok(payload.data.commands.length >= 30, "拿到的应该是真身的完整命令表，不是空壳");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// (e) 四份包壳 + 用户模板附录那份，逐字节相同——改一处没同步到别处，这条测试先红。
test("shim：四个包的 scripts/dby.mjs 与用户模板附录的 dby-shim.mjs 逐字节相同", async () => {
  const allPaths = [...SHIM_PATHS, TEMPLATE_APPENDIX_SHIM];
  const buffers = await Promise.all(allPaths.map((p) => readFile(path.join(SKILLS, p))));
  const [first, ...rest] = buffers;
  allPaths.slice(1).forEach((p, i) => {
    assert.ok(rest[i].equals(first), `${p} 与 ${allPaths[0]} 不再逐字节相同`);
  });
});
