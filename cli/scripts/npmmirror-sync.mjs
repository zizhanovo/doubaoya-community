#!/usr/bin/env node
// npmmirror-sync.mjs — 发布后让 npmmirror 同步，并轮询到「版本可见且 integrity 与 npmjs 一致」才算发布完成
// （dby-cli-rebuild design「Risks」第一条 / tasks 6.8）。publish-npm.yml 在 npm publish 之后跑它。
//
// 为什么必须做：安装器与 `dby skills update` 只认服务端公布的确切版本，镜像没同步时境内用户会被
// 明确拒绝（不降级）——所以「发出去了」不等于「发布完成」，要等 npmmirror 真的能装到同一个 tarball。
//
// 步骤：
//   1. 问 npmjs：@doubaoya/cli@<版本> 可见，取 dist.integrity（发布的事实源；刚发布时可能要等几秒）；
//   2. PUT npmmirror 的同步接口（cnpmcore：/-/package/<包名>/syncs）触发同步；
//   3. 轮询 npmmirror 的 packument，直到该版本出现且 integrity 与 npmjs 相同；超时 → 退出码 1。
// integrity 不一致立即失败（不是「再等等」能好的问题）。
//
// 用法：node cli/scripts/npmmirror-sync.mjs --version <版本> [--timeout-min 30] [--interval-s 20] [--dry-run]
//   --dry-run：只打印将要请求的地址，不发任何请求。
//   环境变量 DBY_REGISTRY_NPMJS / DBY_REGISTRY_NPMMIRROR / DBY_NPMMIRROR_SYNC 只给测试用（指向本机假服务）。
// 🔴 未知参数直接报错。

import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "@doubaoya/cli";
const ENC = NAME.replace("/", "%2f");

function parseArgs(argv) {
  const o = { version: null, timeoutMin: 30, intervalS: 20, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (argv[i + 1] === undefined) throw new Error(`${a} 需要一个值`);
      return argv[++i];
    };
    if (a === "--version") o.version = v();
    else if (a === "--timeout-min") o.timeoutMin = Number(v());
    else if (a === "--interval-s") o.intervalS = Number(v());
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`未知参数 ${a}`);
  }
  if (!o.version) throw new Error("缺 --version");
  if (!(o.timeoutMin > 0) || !(o.intervalS > 0)) throw new Error("--timeout-min / --interval-s 要正数");
  return o;
}

export function endpoints(env = process.env) {
  const npmjs = (env.DBY_REGISTRY_NPMJS || "https://registry.npmjs.org").replace(/\/+$/, "");
  const mirror = (env.DBY_REGISTRY_NPMMIRROR || "https://registry.npmmirror.com").replace(/\/+$/, "");
  const sync = (env.DBY_NPMMIRROR_SYNC || "https://registry-direct.npmmirror.com").replace(/\/+$/, "");
  return {
    npmjs: `${npmjs}/${ENC}`,
    mirror: `${mirror}/${ENC}`,
    trigger: `${sync}/-/package/${NAME}/syncs`
  };
}

async function integrityAt(url, version) {
  const res = await fetch(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  const doc = await res.json();
  return doc?.versions?.[version]?.dist?.integrity ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function syncAndWait({ version, timeoutMin, intervalS }, env = process.env, log = (s) => process.stdout.write(`${s}\n`)) {
  const ep = endpoints(env);
  const deadline = Date.now() + timeoutMin * 60_000;
  let expected = null;
  while (!expected) {
    try {
      expected = await integrityAt(ep.npmjs, version);
    } catch (err) {
      log(`npmjs 查询失败，稍后重试：${err.message}`);
    }
    if (expected) break;
    if (Date.now() > deadline) throw new Error(`npmjs 上 ${timeoutMin} 分钟内都看不到 ${NAME}@${version}——发布本身可能没成功。`);
    await sleep(intervalS * 1000);
  }
  log(`npmjs：${NAME}@${version} integrity=${expected}`);

  const res = await fetch(ep.trigger, { method: "PUT", signal: AbortSignal.timeout(15_000) });
  const body = await res.text();
  log(`已触发 npmmirror 同步（HTTP ${res.status}）：${body.slice(0, 200)}`);

  for (;;) {
    let got = null;
    try {
      got = await integrityAt(ep.mirror, version);
    } catch (err) {
      log(`npmmirror 查询失败，稍后重试：${err.message}`);
    }
    if (got && got !== expected) throw new Error(`npmmirror 上 ${NAME}@${version} 的 integrity 是 ${got}，npmjs 是 ${expected}——两源不一致，安装器会拒装。`);
    if (got === expected) {
      log(`✅ npmmirror 已同步 ${NAME}@${version}，integrity 与 npmjs 一致。发布完成。`);
      return { version, integrity: expected };
    }
    if (Date.now() > deadline) throw new Error(`npmmirror ${timeoutMin} 分钟内没同步到 ${NAME}@${version}——境内用户暂时装不上（安装器会明确拒绝而不是降级）。请手动再触发：curl -X PUT ${ep.trigger}`);
    log(`npmmirror 还没有 ${version}，${intervalS}s 后再查…`);
    await sleep(intervalS * 1000);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.dryRun) {
      const ep = endpoints();
      process.stdout.write(
        [
          `dry-run（不发请求）：${NAME}@${opts.version}`,
          `  1. GET ${ep.npmjs} → versions["${opts.version}"].dist.integrity`,
          `  2. PUT ${ep.trigger}`,
          `  3. 每 ${opts.intervalS}s GET ${ep.mirror}，直到同一版本的 integrity 相同（最多 ${opts.timeoutMin} 分钟）`
        ].join("\n") + "\n"
      );
    } else {
      await syncAndWait(opts);
    }
  } catch (err) {
    process.stderr.write(`npmmirror-sync 失败：${err.message}\n`);
    process.exitCode = 1;
  }
}
