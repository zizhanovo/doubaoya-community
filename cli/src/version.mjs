// version.mjs — 版本号单一事实源（spec「CLI 与 skills 共用一个版本号」）。
//
// 两种运行形态，同一份源码（cli/src 是事实源，skills/dby-api/scripts/lib 是它的逐字节镜像，
// 见 cli/scripts/sync-skill-lib.mjs）：
//   ① npm 包 @doubaoya/cli：读包根 package.json 的 version → UA `doubaoya-cli/<ver>`（design D10）。
//   ② 1.x 过渡期的 skill 镜像（skills/dby-api/scripts/lib/）：旁边没有 package.json，退回读
//      dby-api 包的 `.version`（形如 `doubaoya-skill/dby-api@<hash12>`，tools/stamp_versions.py 盖的），
//      它本身就是服务端旧 UA 判据要的那个串，原样当 UA 用。
// 两者都找不到（本地裸跑某个模块）时给 "unknown"，不抛错。

import { readFileSync } from "node:fs";

const PACKAGE_JSON = new URL("../package.json", import.meta.url); // src/ → 包根
const SKILL_VERSION_FILE = new URL("../../.version", import.meta.url); // lib/ → scripts/ → dby-api/.version

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
    return pkg && pkg.name === "@doubaoya/cli" && typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function readSkillStamp() {
  try {
    return readFileSync(SKILL_VERSION_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** `dby --version` 打的那个值：包版本；skill 镜像形态下是 .version 戳。 */
export function readVersion() {
  return readPackageVersion() ?? readSkillStamp() ?? "unknown";
}

/**
 * 请求头 User-Agent。npm 包形态 = `doubaoya-cli/<semver>`（服务端 CLI 更新提示分支按它判）；
 * skill 镜像形态 = `.version` 原文（服务端旧 `doubaoya-skill/<slug>@<hash>` 判据，一字不改）。
 * 🔴 不许写死：写死的 UA 会让更新提示永远不触发且完全静默（validate_user_agent_from_version）。
 */
export function userAgent() {
  const pkgVersion = readPackageVersion();
  if (pkgVersion) return `doubaoya-cli/${pkgVersion}`;
  return readSkillStamp() ?? "doubaoya-cli/unknown";
}
