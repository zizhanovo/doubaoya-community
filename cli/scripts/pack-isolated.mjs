#!/usr/bin/env node
// pack-isolated.mjs — 在一份临时副本里 `npm pack`，拿到与发布逐字节相同的 tarball，
// 但不碰工作树（prepack 会往 cli/ 里拷 skills/ 与 LICENSE、postpack 再删；多个测试 / 检查
// 同时在真 cli/ 里 pack 会互相删掉对方的拷贝）。
//
// 副本的形状与仓库一致（<tmp>/cli + <tmp>/skills + <tmp>/LICENSE），所以跑的就是真 prepack。
// 消费方：cli/test（安装矩阵、exports）、cli/scripts/prepublish-check.mjs、tools/clawhub_publish.py。
//
// 用法：node scripts/pack-isolated.mjs <输出目录> [--extract]
//   stdout 打一行 JSON：{ tarball, filename, integrity, shasum, version, files[], extracted? }
//   --extract：再把 tarball 解到 <输出目录>/extract（内容在 extract/package/ 下）。

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..");
// 包源里参与打包的东西（files 白名单之外的不会进包，但 prepack 脚本本身要在）。
const CLI_ENTRIES = ["bin", "src", "scripts", "package.json", "CHANGELOG.md", "README.md"];

export function packIsolated(destDir, { extract = false, cliRoot = CLI_ROOT, repoRoot = REPO_ROOT } = {}) {
  mkdirSync(destDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "dby-pack-src-"));
  try {
    const cli = path.join(work, "cli");
    mkdirSync(cli);
    for (const entry of CLI_ENTRIES) {
      const from = path.join(cliRoot, entry);
      if (existsSync(from)) cpSync(from, path.join(cli, entry), { recursive: true });
    }
    cpSync(path.join(repoRoot, "skills"), path.join(work, "skills"), { recursive: true });
    cpSync(path.join(repoRoot, "LICENSE"), path.join(work, "LICENSE"));
    const env = {
      ...process.env,
      npm_config_cache: path.join(work, ".npm-cache"),
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false"
    };
    const out = execFileSync("npm", ["pack", "--json", "--pack-destination", destDir], { cwd: cli, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const meta = JSON.parse(out)[0];
    const tarball = path.join(destDir, meta.filename);
    const bytes = readFileSync(tarball);
    const result = {
      tarball,
      filename: meta.filename,
      version: meta.version,
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      shasum: createHash("sha1").update(bytes).digest("hex"),
      files: meta.files.map((f) => f.path).sort()
    };
    if (extract) {
      const to = path.join(destDir, "extract");
      rmSync(to, { recursive: true, force: true });
      mkdirSync(to, { recursive: true });
      execFileSync("tar", ["-xzf", tarball, "-C", to]);
      result.extracted = path.join(to, "package");
    }
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dest = process.argv[2];
  if (!dest || dest.startsWith("--")) {
    process.stderr.write("用法：node scripts/pack-isolated.mjs <输出目录> [--extract]\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(packIsolated(path.resolve(dest), { extract: process.argv.includes("--extract") })) + "\n");
}
