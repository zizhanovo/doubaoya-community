#!/usr/bin/env node
// prepack-skills.mjs — npm pack/publish 前把仓库根的 skill 内容原样拷进包（design D1）。
//
// 只拷 `skills/<slug>/SKILL.md` 与 `skills/<slug>/references/**`（口径唯一实现在 src/skills-bundle.mjs，
// `dby skills install` 与 prepublish-check 的镜像哈希用的是同一份）：skill 在 2.x 里只是说明书，
// scripts/ 不进 npm 包（过渡期的 1.x 脚本仍留在仓库 skills/ 里，由旧渠道分发，第 5 组删）。
// 另把仓库根 LICENSE 拷进来（npm 只从包目录收 LICENSE）。
// `--clean`（postpack）删掉这两样拷贝，让工作树回到干净状态。
//
// 用法：node scripts/prepack-skills.mjs [--clean]

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { listSkillFiles } from "../src/skills-bundle.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(CLI_ROOT, "..");
const SRC_SKILLS = path.join(REPO_ROOT, "skills");
const OUT_SKILLS = path.join(CLI_ROOT, "skills");
const OUT_LICENSE = path.join(CLI_ROOT, "LICENSE");

export function packSkillList(srcSkills = SRC_SKILLS) {
  return readdirSync(srcSkills)
    .filter((slug) => existsSync(path.join(srcSkills, slug, "SKILL.md")))
    .sort();
}

function clean() {
  rmSync(OUT_SKILLS, { recursive: true, force: true });
  rmSync(OUT_LICENSE, { force: true });
}

function prepack() {
  clean();
  const slugs = packSkillList();
  if (slugs.length === 0) throw new Error(`在 ${SRC_SKILLS} 下一个 skill 都没找到——打包会是空的，拒绝继续。`);
  for (const slug of slugs) {
    const from = path.join(SRC_SKILLS, slug);
    const to = path.join(OUT_SKILLS, slug);
    for (const rel of listSkillFiles(from, { bundledOnly: true })) {
      mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
      cpSync(path.join(from, rel), path.join(to, rel));
    }
  }
  cpSync(path.join(REPO_ROOT, "LICENSE"), OUT_LICENSE);
  process.stderr.write(`prepack：已拷入 ${slugs.length} 个 skill（SKILL.md + references/）与 LICENSE。\n`);
}

if (process.argv.includes("--clean")) clean();
else prepack();
