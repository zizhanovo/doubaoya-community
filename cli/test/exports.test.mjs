// exports.test.mjs — tasks 2.3 / spec「外部 import 请求层」：
// 真 `npm pack` 出 tarball、装进一个临时项目，从外部 import 内部模块必须 ERR_PACKAGE_PATH_NOT_EXPORTED；
// 同时顺带核对装出来的 bin 能跑、`dby --version --json` 与 package.json 一致（tasks 2.4）。
// 全程离线：装的是本地 tarball，包零依赖，npm 不需要访问 registry。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(CLI_ROOT, "package.json"), "utf8"));

test("pack 后安装：内部模块不可 import，bin 可用且版本一致", { timeout: 180_000 }, () => {
  const work = mkdtempSync(path.join(tmpdir(), "dby-pack-"));
  const npmEnv = { ...process.env, npm_config_cache: path.join(work, ".npm-cache"), npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false" };
  const packed = execFileSync("npm", ["pack", "--json", "--pack-destination", work], { cwd: CLI_ROOT, env: npmEnv, encoding: "utf8" });
  const tarball = path.join(work, JSON.parse(packed)[0].filename);

  const proj = path.join(work, "proj");
  execFileSync("mkdir", ["-p", proj]);
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "probe", version: "0.0.0", private: true, type: "module" }));
  execFileSync("npm", ["install", "--offline", "--no-save", tarball], { cwd: proj, env: npmEnv, stdio: "pipe" });

  const probe = spawnSync(process.execPath, ["-e", 'import("@doubaoya/cli/src/http.mjs").then(()=>console.log("IMPORTED"),e=>{console.log(e.code);})'], {
    cwd: proj,
    encoding: "utf8"
  });
  assert.equal(probe.stdout.trim(), "ERR_PACKAGE_PATH_NOT_EXPORTED", probe.stderr);

  const ver = spawnSync(path.join(proj, "node_modules", ".bin", "dby"), ["--version", "--json"], { cwd: proj, encoding: "utf8", env: { PATH: process.env.PATH, HOME: work } });
  assert.equal(ver.status, 0, ver.stderr);
  assert.deepEqual(JSON.parse(ver.stdout), { ok: true, data: { version: pkg.version } });
});
