#!/usr/bin/env node
// archived-config-hint.selfcheck.mjs —— lib/archived-config-hint.mjs 的可运行自检。
// 零框架 assert 式，覆盖：
//   1. 项目目录 .doubaoya/archive 下有归档的老包（含 config.json + profiles/x.json）
//      → 提示文本含两条可粘贴的 cp 命令，且 profiles/ 整目录搬、themes/assets 里
//        本包自带的文件不被列进去；
//   2. 全局（home）.doubaoya/archive 下有归档同样能探到；
//   3. 哪儿都没有归档 → 返回 null / printArchivedConfigHint 不写任何东西到 stderr；
//   4. 归档存在但里面没有值得提的用户数据（比如老目录已经清空）→ 同样返回 null。
//
// 跑法：node scripts/archived-config-hint.selfcheck.mjs   （exit 0 = 全绿）

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildArchivedConfigHint, detectArchivedConfig, printArchivedConfigHint } from "./lib/archived-config-hint.mjs";

let passed = 0;
function ok(name) {
  passed++;
  process.stdout.write(`  ✅ ${name}\n`);
}

/** 造一个「新包」目录（模拟改名后的 dby-publish 根），带上跟真实包一致的 themes/ 与 assets/ip/ 自带文件。 */
function makePkgDir(root) {
  const pkgDir = join(root, "pkg");
  mkdirSync(join(pkgDir, "themes"), { recursive: true });
  mkdirSync(join(pkgDir, "assets", "ip"), { recursive: true });
  writeFileSync(join(pkgDir, "themes", "benya-clean.json"), "{}");
  writeFileSync(join(pkgDir, "assets", "ip", "README.md"), "占位说明");
  return pkgDir;
}

/** 在 <doubaoyaHome>/archive/<timestamp>/<label>/wechat-article-pipeline/ 下造归档老包。 */
function makeArchivedOldPkg(doubaoyaHome, { timestamp, label, files }) {
  const oldPkgDir = join(doubaoyaHome, "archive", timestamp, label, "wechat-article-pipeline");
  mkdirSync(oldPkgDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(oldPkgDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return oldPkgDir;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "dby-archived-config-hint-"));
  try {
    // ---- 1. 项目目录归档：config.json + 用户自建 profiles/x.json + 本包自带主题重名（应被过滤） ----
    {
      const projectDir = join(tmp, "case1-project");
      const home = join(tmp, "case1-home"); // 空的，不含任何归档
      const pkgDir = makePkgDir(tmp);
      const oldPkgDir = makeArchivedOldPkg(join(projectDir, ".doubaoya"), {
        timestamp: "2026-08-15T10-00-00",
        label: "claude_skills",
        files: {
          "config.json": '{"targetAccount":"demo@example.com"}',
          "profiles/x.json": '{"slug":"demo"}',
          "themes/benya-clean.json": "{}", // 与本包自带同名 —— 不该被列进搬运项
          "themes/my-custom-theme.json": "{}", // 用户自建 —— 应被列进搬运项
        },
      });

      const found = detectArchivedConfig({ projectDir, home });
      assert.ok(found, "应探测到项目目录下的归档");
      assert.equal(found.latest.path, oldPkgDir, "latest.path 应指向归档老包目录");
      assert.equal(found.others.length, 0, "只有一份归档时 others 应为空");
      ok("探测到项目目录 .doubaoya/archive 下的归档老包");

      const text = buildArchivedConfigHint({ pkgDir, projectDir, home });
      assert.ok(text, "应生成提示文本");
      const cpLines = text.split("\n").filter((l) => l.trim().startsWith("cp "));
      assert.equal(cpLines.length, 3, `应恰好 3 条 cp 命令（config.json + profiles/ + my-custom-theme.json），实际：\n${text}`);
      assert.ok(cpLines.some((l) => l.includes("config.json") && !l.includes("-R")), "应有 config.json 的普通 cp");
      assert.ok(cpLines.some((l) => l.includes("-R") && l.includes("profiles")), "应有 profiles/ 的 cp -R");
      assert.ok(cpLines.some((l) => l.includes("my-custom-theme.json")), "应列出用户自建主题");
      assert.ok(!text.includes("themes/benya-clean.json"), "本包自带的同名主题不该被列进搬运项");
      assert.ok(text.includes(join(pkgDir, "config.json")), "cp 目的地应落在本包目录");
      ok("提示文本含 config.json + profiles/ + 用户自建主题的 cp 命令，过滤掉本包自带同名主题");
    }

    // ---- 2. 全局 home 目录归档同样能探到（且按时间戳倒序取最新，多余的只报数量） ----
    {
      const projectDir = join(tmp, "case2-project"); // 空的
      const home = join(tmp, "case2-home");
      makeArchivedOldPkg(join(home, ".doubaoya"), {
        timestamp: "2026-08-10T09-00-00",
        label: "agents_skills",
        files: { "config.json": "{}" },
      });
      const newestOldPkg = makeArchivedOldPkg(join(home, ".doubaoya"), {
        timestamp: "2026-08-18T09-00-00",
        label: "agents_skills",
        files: { "design-config.json": "{}" },
      });

      const found = detectArchivedConfig({ projectDir, home });
      assert.ok(found, "应探测到全局 home 下的归档");
      assert.equal(found.latest.path, newestOldPkg, "两份归档时应取时间戳更新的那份为 latest");
      assert.equal(found.others.length, 1, "更早的一份应计入 others 而不是丢弃");
      ok("全局 home 目录下的归档同样可探测，且按时间戳倒序取最新");
    }

    // ---- 3. 哪儿都没归档 → null，且 printArchivedConfigHint 不写任何东西 ----
    {
      const projectDir = join(tmp, "case3-project-empty");
      const home = join(tmp, "case3-home-empty");
      const pkgDir = makePkgDir(join(tmp, "case3"));
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(home, { recursive: true });

      assert.equal(detectArchivedConfig({ projectDir, home }), null, "没有任何归档时应返回 null");
      assert.equal(buildArchivedConfigHint({ pkgDir, projectDir, home }), null, "没有归档时提示文本应为 null");

      let wrote = "";
      const origWrite = process.stderr.write;
      process.stderr.write = (chunk) => {
        wrote += chunk;
        return true;
      };
      try {
        printArchivedConfigHint({ pkgDir, projectDir, home });
      } finally {
        process.stderr.write = origWrite;
      }
      assert.equal(wrote, "", "没有归档时 printArchivedConfigHint 不该写任何东西到 stderr");
      ok("没有任何归档时：探测返回 null，且不打印任何提示");
    }

    // ---- 4. 归档目录存在，但里面没有值得提的用户数据 → 同样是 null ----
    {
      const projectDir = join(tmp, "case4-project");
      const home = join(tmp, "case4-home-empty");
      const pkgDir = makePkgDir(join(tmp, "case4"));
      mkdirSync(home, { recursive: true });
      // 老包目录本身存在，但只有一个跟本包同名的主题文件——没有 config.json / design-config.json /
      // profiles/，themes/ 里那份还跟本包自带的重名，过滤完应该一无所有。
      makeArchivedOldPkg(join(projectDir, ".doubaoya"), {
        timestamp: "2026-08-05T08-00-00",
        label: "claude_skills",
        files: { "themes/benya-clean.json": "{}" },
      });

      assert.ok(detectArchivedConfig({ projectDir, home }), "老包目录存在，探测本身应命中");
      assert.equal(
        buildArchivedConfigHint({ pkgDir, projectDir, home }),
        null,
        "归档里没有值得提的用户数据时，提示文本应为 null（不该硬凑一条空提示）"
      );
      ok("归档存在但没有值得提的用户数据时，提示文本为 null");
    }

    process.stdout.write(`\n全绿：${passed} 项自检通过。\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  process.stderr.write(`\n❌ 自检失败：${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
