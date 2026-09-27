// rewrite.mjs — `dby rewrite rules`（移植自 skills/dby-rewrite/scripts/rewrite.py，design D5）。
//
// 识别目标平台（中英文别名、拼音缩写、全平台关键词），给出该平台改写规则文件的**路径**。
// 规则一平台一文件放在 skills/dby-rewrite/references/<平台>.md，agent 直接 Read 那份文件——
// JSON 信封不回灌规则全文（长正文文件进文件出）；只有人类文本模式才把全文打出来（同原脚本）。
// 纯本地、不联网（kind=local）。
//
// 🔴 references 的位置随运行形态变（resolveReferencesDir 依次试三处，相对 cli/src）：
//   ① npm 包：包根/skills/dby-rewrite/references        → src/../skills/…
//   ② 社区仓开发：仓库根/skills/dby-rewrite/references   → src/../../skills/…
//   ③ 1.x skill 镜像：src 被逐字节复制到 skills/dby-api/scripts/lib/ → lib/../../../dby-rewrite/…

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, DbyError } from "../errors.mjs";

// 别名表与平台表与 rewrite.py 逐条一致（cli/test/rewrite.test.mjs 与 `rewrite.py list` 对拍）。
export const PLATFORM_ALIAS = Object.freeze({
  公众号: "公众号",
  微信公众号: "公众号",
  视频号: "视频号",
  微信视频号: "视频号",
  抖音: "抖音",
  dy: "抖音",
  快手: "快手",
  ks: "快手",
  哔站: "哔站（B站）",
  b站: "哔站（B站）",
  bilibili: "哔站（B站）",
  哔哩哔哩: "哔站（B站）",
  小红书: "小红书",
  红书: "小红书",
  xhs: "小红书",
  知乎: "知乎",
  zhihu: "知乎"
});

export const SUPPORTED_PLATFORMS = Object.freeze(["公众号", "视频号", "抖音", "快手", "哔站（B站）", "小红书", "知乎"]);

// 规范平台名 → references/ 下的文件名。只有 B 站不一样：全角括号落进文件名会给 shell 和补全添堵。
export const PLATFORM_FILE = Object.freeze(
  Object.fromEntries(SUPPORTED_PLATFORMS.map((p) => [p, p === "哔站（B站）" ? "B站" : p]))
);

export const ALL_KEYWORDS = Object.freeze(["全部", "all", "所有"]);

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 三种运行形态下 references 目录的候选（相对 cli/src 或它的镜像 lib/）。 */
export function referencesCandidates(srcDir = SRC_DIR) {
  return [
    path.resolve(srcDir, "..", "skills", "dby-rewrite", "references"),
    path.resolve(srcDir, "..", "..", "skills", "dby-rewrite", "references"),
    path.resolve(srcDir, "..", "..", "..", "dby-rewrite", "references")
  ];
}

/** 取第一个七份规则文件齐全的候选；一个都不齐 → 一般错误（包装坏了，不是用户用错）。 */
export function resolveReferencesDir(srcDir = SRC_DIR) {
  const candidates = referencesCandidates(srcDir);
  const found = candidates.find((dir) =>
    SUPPORTED_PLATFORMS.every((p) => existsSync(path.join(dir, `${PLATFORM_FILE[p]}.md`)))
  );
  if (!found) {
    throw new DbyError("REWRITE_RULES_MISSING", "找不到改写规则文件（skills/dby-rewrite/references/）。", {
      exit: EXIT.GENERAL,
      remediation: `找过：${candidates.join("；")}。npm 包装坏了就重装 @doubaoya/cli；在社区仓里跑确认 skills/dby-rewrite/references/ 在。`
    });
  }
  return found;
}

const lookup = (t) => PLATFORM_ALIAS[t] ?? PLATFORM_ALIAS[t.toLowerCase()] ?? null;

/**
 * token（逗号或空格分隔都行）→ 去重后的规范平台名。含全平台关键词就是全部七个。
 * 与原脚本的差别：认不出的 token 不再被当成「文案」悄悄吞掉（`抖音 微博` 以前会只给抖音），
 * 而是列出来让调用方报 USAGE。**纯函数**。
 */
export function resolvePlatforms(tokens) {
  const expanded = tokens.flatMap((t) => t.split(",")).map((t) => t.trim()).filter(Boolean);
  const unknown = expanded.filter((t) => !lookup(t) && !ALL_KEYWORDS.includes(t.toLowerCase()));
  if (expanded.some((t) => ALL_KEYWORDS.includes(t.toLowerCase()))) return { platforms: [...SUPPORTED_PLATFORMS], unknown };
  const platforms = [];
  for (const t of expanded) {
    const p = lookup(t);
    if (p && !platforms.includes(p)) platforms.push(p);
  }
  return { platforms, unknown };
}

export const aliasesOf = (platform) => Object.keys(PLATFORM_ALIAS).filter((k) => PLATFORM_ALIAS[k] === platform);

function entryFor(dir, platform) {
  const file = path.join(dir, `${PLATFORM_FILE[platform]}.md`);
  const text = readFileSync(file, "utf8");
  const role = text.split("\n").find((l) => l.startsWith("# Role:"));
  return {
    platform,
    aliases: aliasesOf(platform),
    path: file,
    role: role ? role.slice("# Role:".length).trim() : null,
    bytes: Buffer.byteLength(text)
  };
}

const supportedLine = () => `支持的平台：${SUPPORTED_PLATFORMS.join("、")}；全平台关键词：${ALL_KEYWORDS.join("、")}`;

export function rewriteRules(tokens = [], { srcDir } = {}) {
  const dir = resolveReferencesDir(srcDir);
  const listMode = tokens.length === 0;
  let platforms = SUPPORTED_PLATFORMS;
  if (!listMode) {
    const r = resolvePlatforms(tokens);
    if (r.unknown.length) {
      throw new DbyError("UNKNOWN_PLATFORM", `未识别的平台：${r.unknown.join("、")}。`, {
        exit: EXIT.USAGE,
        remediation: `${supportedLine()}。不给平台参数就列出全部平台与别名。`
      });
    }
    if (!r.platforms.length) {
      throw new DbyError("UNKNOWN_PLATFORM", "没有给出任何平台。", { exit: EXIT.USAGE, remediation: supportedLine() });
    }
    platforms = r.platforms;
  }
  const entries = platforms.map((p) => entryFor(dir, p));
  const data = { referencesDir: dir, allKeywords: [...ALL_KEYWORDS], platforms: entries };

  let human;
  if (listMode) {
    human = [
      "支持的平台及别名（规则文件在下列路径，照其中 Workflow 改写）：",
      "",
      ...entries.map((e) => `${e.platform.padEnd(8, "　")} | ${e.aliases.join(", ")}\n${"".padEnd(8, "　")} | ${e.path}`),
      "",
      `全平台关键词：${ALL_KEYWORDS.join("、")}`
    ].join("\n");
  } else {
    // 人读形态同原脚本：把规则全文打出来。JSON 形态只给路径。
    human = entries
      .map((e, i) => `[${i + 1}/${entries.length}] 📌 ${e.platform}  （${e.path}）\n${"─".repeat(60)}\n${readFileSync(e.path, "utf8").trim()}`)
      .join(`\n\n${"═".repeat(60)}\n\n`);
  }
  return { data, human };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "rewrite", name: "rules",
    summary: "多平台改写规则：给平台（别名/逗号/空格/all 均可）→ 规则文件路径；不给平台 → 列出全部平台与别名（纯本地）",
    args: [{ name: "platforms", required: false, variadic: true }],
    flags: {},
    routes: [], billable: false, destructive: false, composite: false, kind: "local",
    run: (ctx, { args }) => rewriteRules(args.platforms ?? [])
  }
];
