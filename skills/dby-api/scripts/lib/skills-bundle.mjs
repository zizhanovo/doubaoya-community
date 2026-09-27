// skills-bundle.mjs — 随包 skills 的「内容口径」唯一实现（dby-cli-rebuild design D1 / D11）。
//
// 三处共用同一份判据，不许各写一套：
//   · cli/scripts/prepack-skills.mjs：打包时从仓库 skills/ 拷哪些文件（SKILL.md + references/**）；
//   · `dby skills install|update|status|migrate`：装什么、怎么判「用户改过」；
//   · cli/scripts/prepublish-check.mjs：包内 skill 与仓库镜像的内容哈希对账。
//
// 内容哈希与 tools/stamp_versions.py 的 compute_skill_hash 同口径：按相对路径排序，逐个喂
// 「posix 相对路径 + 文件字节」进 sha256，取前 12 位；任何一段以「.」开头的路径（.dby/origin.json、
// .version、.DS_Store）与 __pycache__ 不计入。所以装进去的 `.dby/origin.json` 不改变包的哈希。

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** 包里只有说明书：SKILL.md 与 references/**（spec「skill 不带脚本」）。 */
export function isBundledPath(rel) {
  const parts = rel.split("/");
  if (parts.some((p) => p.startsWith(".") || p === "__pycache__")) return false;
  return rel === "SKILL.md" || parts[0] === "references";
}

/** 目录下全部计入哈希的文件（posix 相对路径，已排序）。filter 为真时只收 isBundledPath 的那部分。 */
export function listSkillFiles(dir, { bundledOnly = false } = {}) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      if (name.startsWith(".") || name === "__pycache__") continue;
      const childAbs = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = statSync(childAbs);
      if (st.isDirectory()) walk(childAbs, childRel);
      else if (st.isFile() && (!bundledOnly || isBundledPath(childRel))) out.push(childRel);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  // 与 Python 的 sorted(key=posix 相对路径) 同序：按 UTF-16 码元比较在 BMP 内与码点序一致。
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function hashFiles(dir, files) {
  const digest = createHash("sha256");
  for (const rel of files) {
    digest.update(Buffer.from(rel, "utf8"));
    digest.update(readFileSync(path.join(dir, rel)));
  }
  return digest.digest("hex").slice(0, 12);
}

/** 已装目录的内容哈希（除点开头路径外全部文件，含用户自己加的文件）。 */
export function treeHash(dir) {
  return hashFiles(dir, listSkillFiles(dir));
}

/** 仓库 / 包里某个 skill 只按「会被打包的那部分」算的哈希（镜像对账口径）。 */
export function bundledHash(dir) {
  return hashFiles(dir, listSkillFiles(dir, { bundledOnly: true }));
}

/** frontmatter 里的某个单行字段（version 之类）；没有返回 null。 */
export function frontmatterField(text, key) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  for (const line of text.slice(4, end).split("\n")) {
    if (line.startsWith(`${key}:`)) return line.slice(key.length + 1).trim() || null;
  }
  return null;
}

/** 读一个 skills 源目录（包内 skills/ 或仓库 skills/）：[{ slug, dir, files, hash, version }]。 */
export function readBundle(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root)
    .filter((slug) => !slug.startsWith(".") && existsSync(path.join(root, slug, "SKILL.md")))
    .sort()
    .map((slug) => {
      const dir = path.join(root, slug);
      const files = listSkillFiles(dir, { bundledOnly: true });
      const text = readFileSync(path.join(dir, "SKILL.md"), "utf8");
      return { slug, dir, files, hash: hashFiles(dir, files), version: frontmatterField(text, "version") };
    });
}

/** lstat 不跟随软链；不存在返回 null。 */
export function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}
