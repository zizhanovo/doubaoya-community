#!/usr/bin/env node
// pipeline.mjs — 都爆鸭 · 公众号图文流水线（编排者）
// -----------------------------------------------------------------------------
// 把一篇【已经写好】的 Markdown/HTML 走一串**确定性的机械步骤**，最终存入你自己
// 公众号的**草稿箱**。本流水线**不代写正文**（正文由 agent 依 SKILL.md 撰写）；它只
// 自动化后续的确定性运维步骤：加载身份上下文 → whoami 校验目标账号 → 前置检查 →
// md→HTML 渲染 → 本地图片预上传 → 封面 → 保存草稿 → 回报。
//
// 组合关系（不重复造轮子）：
//   * 账号解析      ← ./account-verify.mjs         (resolveAccountKey)
//   * md→公众号 HTML ← ./render-wechat-html.mjs      (renderWechatHtml)
//   * 图片预上传+存草稿 ← ./preprocess-and-publish.mjs (子进程，vendored)
//
// 硬规则（在代码里强制）：
//   1. 只存草稿绝不群发：绝不接受/转发任何群发参数（--mass-send/--broadcast…直接报错）。
//   2. 发布前必 whoami：第 2 步账号校验必须成功，第 5 步保存草稿才会跑。
//   3. 绝不打印 API key。
//
// 单一事实源：9 步 SOP 与硬规则同时声明在同目录 ../pipeline.json，SKILL.md 与本文件
// 都以它为准。
//
// 用法见 --help。零依赖（Node ≥18 内置 + 全局 fetch）。
// -----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveAccountKey } from "./account-verify.mjs";
import { renderWechatHtml } from "./render-wechat-html.mjs";
import { validateTheme } from "./validate-theme.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");
const VENDORED_PUBLISH = path.join(__dirname, "preprocess-and-publish.mjs");
const DEFAULT_BASE_URL = "https://doubaoya.com";
export const DEFAULT_MARKDOWN_THEME = "themes/benya-clean.json";

export const BUILTIN_CONFIG = {
  targetAccount: null,
  publicAccountName: null,
  appid: null,
  author: "",
  digestTemplate: "",
  coverDir: "",
  coverFallback: "doubaoya",
  ipProfile: "profiles/example-ip.json",
  mdTheme: DEFAULT_MARKDOWN_THEME,
  draftsDir: "",
};

// ---------------------------------------------------------------------------
// 参数解析 —— 白名单式；未知 flag 一律报错（尤其拦截任何"群发"意图）
// ---------------------------------------------------------------------------
const VALUE_FLAGS = new Set([
  "md",
  "html",
  "title",
  "account",
  "appid",
  "cover",
  "digest",
  "config",
  "profile",
  "theme",
  "design",
  "output-processed-html",
  "base-url",
]);
const BOOL_FLAGS = new Set(["dry-run", "help"]);
// 任何带这些意图的 flag 都视为"群发"，直接拒绝并解释本流水线只存草稿。
const MASS_SEND_RE = /(mass[-_]?send|publish[-_]?all|broadcast|send[-_]?all|群发|群發|push[-_]?all|massend)/i;

class ArgError extends Error {}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") {
      out.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    let key = a.slice(2);
    let inlineVal;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      inlineVal = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (MASS_SEND_RE.test(key)) {
      throw new ArgError(
        `拒绝参数 --${key}：本流水线**只存草稿、绝不群发**。这里没有任何群发/推送路径，` +
          `请去公众号后台亲手确认后再手动群发。`
      );
    }
    if (BOOL_FLAGS.has(key)) {
      out[key === "dry-run" ? "dryRun" : key] = true;
      continue;
    }
    if (VALUE_FLAGS.has(key)) {
      let val = inlineVal;
      if (val === undefined) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new ArgError(`参数 --${key} 缺少取值。`);
        }
        val = next;
        i++;
      }
      out[camel(key)] = val;
      continue;
    }
    throw new ArgError(
      `未知参数 --${key}。可用参数：` +
        `--md --html --title --account --appid --cover --digest --config --profile --theme --design ` +
        `--output-processed-html --base-url --dry-run --help。` +
        `（注意：本流水线只存草稿，不存在任何群发参数。）`
    );
  }
  return out;
}

function camel(flag) {
  return flag.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

const HELP = `pipeline.mjs — 都爆鸭 · 公众号图文流水线（只存草稿，绝不群发）

用法:
  node pipeline.mjs (--md <a.md> | --html <a.html>) --title <标题> [选项]

输入（二选一，必填其一）:
  --md <file>                 Markdown 文件，渲染成公众号内联样式 HTML 后发布
  --html <file>               已经排好版的公众号 HTML，直接发布（跳过渲染）

必填:
  --title <str>               文章标题

选项:
  --account <email|phone>     目标 doubaoya.com 账号（本机多条 key 时用它挑对账号）
  --appid <wxid>              目标公众号 authorizerAppid（绑定多个公众号时指定其一）
  --cover <path>              本地封面图；不传则走都爆鸭兜底封面
  --digest <str>              摘要
  --config <path>             配置文件（默认 ./config.json，没有则用内置默认）
  --profile <path>            IP/身份 profile（默认取 config.ipProfile）
  --theme <path>              显式覆盖 Markdown 主题（默认 themes/benya-clean.json）
  --theme neutral             显式使用中性渲染器，不套项目主题
  --design <json>             设计工作台产出的 design-config.json：套主题 + 设封面 + 按 h2
                              锚点注入配图。由 scripts/design-studio.mjs 生成。显式 --theme/
                              --cover 与 --design 冲突时命令行优先并告警。
  --output-processed-html <p> 渲染出的 HTML 落地路径（默认写临时文件）
  --base-url <url>            API 基址（默认 $DOUBAOYA_BASE_URL 或 https://doubaoya.com）
  --dry-run                   只渲染+校验+扫描本地图，**不发布**
  -h, --help                  显示帮助

硬规则:
  · 只存草稿绝不群发（不接受任何 --mass-send/--broadcast/群发 参数）
  · 发布前必 whoami 校验目标账号（校验不过就停）
  · 绝不打印 API key

鉴权: DOUBAOYA_API_KEY 由 account-verify 从 env/~/.doubaoya/Keychain 解析，仅在内存中传给子进程。
`;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function step(n, title) {
  process.stdout.write(`\n── 步骤 ${n}/9 · ${title} ${"─".repeat(Math.max(2, 40 - title.length))}\n`);
}
function info(msg) {
  process.stdout.write(`   ${msg}\n`);
}
function warn(msg) {
  process.stdout.write(`   ⚠️  ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function readJsonMaybe(p) {
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 解析 Markdown 主题路径：显式 --theme 优先，其次 config.mdTheme，最后项目默认主题。
// 返回绝对路径；"neutral" → null（显式退回中性渲染器）；"default" → 项目默认主题。
export function resolveMarkdownThemePath({
  cliTheme,
  configuredTheme,
  configHasTheme = false,
  cwd = process.cwd(),
  configDir = cwd,
  skillRoot = SKILL_ROOT,
} = {}) {
  const fromCli = typeof cliTheme === "string" && cliTheme.length > 0;
  const fromConfig = configHasTheme && typeof configuredTheme === "string" && configuredTheme.length > 0;
  let ref = fromCli ? cliTheme : fromConfig ? configuredTheme : DEFAULT_MARKDOWN_THEME;
  // 早期示例配置曾把 "default" 当占位符；现在它表示项目默认主题。
  if (ref === "default") return path.resolve(skillRoot, DEFAULT_MARKDOWN_THEME);
  if (ref === "neutral") return null;
  if (path.isAbsolute(ref)) return ref;
  return path.resolve(fromCli ? cwd : fromConfig ? configDir : skillRoot, ref);
}

// design-config 的 images[]：把选定的本地配图按 h2 锚点注入 Markdown 源。
// 每个 inject = { anchor:"<h2 文本>", src:"<本地路径>", alt?:"<图注>" }。
// afterHeading 语义：插在该 h2 小节**末尾**（下一个同级/更高级标题之前）。找不到锚点 →
// 追加文末并通过 onWarn 告警。返回注入后的 markdown（不改原串）。
export function injectImagesAfterHeadings(markdown, injects, onWarn = () => {}) {
  if (!Array.isArray(injects) || injects.length === 0) return String(markdown);
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const isH1or2 = (s) => /^ {0,3}#{1,2}(?!#)\s+/.test(s);
  const h2Text = (s) => {
    const m = s.match(/^ {0,3}##(?!#)\s+(.+?)\s*#*\s*$/);
    return m ? m[1].trim() : null;
  };
  const appended = [];
  for (const inj of injects) {
    if (!inj || !inj.src) continue;
    const imgLine = `<img src="${inj.src}"${inj.alt ? ` alt="${String(inj.alt).replace(/"/g, "&quot;")}"` : ""} />`;
    let hi = -1;
    for (let i = 0; i < lines.length; i++) {
      if (h2Text(lines[i]) === String(inj.anchor).trim()) { hi = i; break; }
    }
    if (hi === -1) {
      onWarn(`配图锚点未找到 h2「${inj.anchor}」，已把配图追加到文末。`);
      appended.push("", imgLine);
      continue;
    }
    let end = lines.length;
    for (let j = hi + 1; j < lines.length; j++) {
      if (isH1or2(lines[j])) { end = j; break; }
    }
    lines.splice(end, 0, "", imgLine, "");
  }
  if (appended.length) lines.push(...appended);
  return lines.join("\n");
}

// 草稿源文件可以保留 frontmatter 和文件标题；发布正文不携带这两层元数据。
export function normalizeDraftMarkdown(markdown) {
  const lines = String(markdown).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");

  if (lines[0]?.trim() === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing !== -1) lines.splice(0, closing + 1);
  }

  while (lines[0]?.trim() === "") lines.shift();
  if (/^ {0,3}#(?!#)\s+/.test(lines[0] || "")) {
    lines.shift();
  } else if (lines.length > 1 && /^ {0,3}=+\s*$/.test(lines[1])) {
    lines.splice(0, 2);
  }
  while (lines[0]?.trim() === "") lines.shift();

  return lines.join("\n");
}

// 公众号后台已经单独承载文章标题，正文渲染不注入或保留重复 H1。
export function renderMarkdownForDraft(markdown, theme) {
  return renderWechatHtml(normalizeDraftMarkdown(markdown), { theme });
}

// GET 一个 doubaoya API（带 key），返回 { ok, data, code, message }。key 绝不打印。
async function apiGet(url, key) {
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, code: "NETWORK_ERROR", message: `无法连接 ${url}（${e.message}）` };
  }
  let text = "";
  try {
    text = await res.text();
  } catch {}
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, code: `HTTP_${res.status}`, message: text || res.statusText };
  }
  if (env.success !== true) {
    const err = env.error || {};
    return { ok: false, code: err.code || `HTTP_${res.status}`, message: err.message || "请求未成功" };
  }
  return { ok: true, data: env.data || {} };
}

// 从各种可能的 /api/skills 响应形状里找 slug 列表。
function extractSkillSlugs(data) {
  const cand = Array.isArray(data)
    ? data
    : data.skills || data.items || data.list || data.results || [];
  const slugs = [];
  for (const s of Array.isArray(cand) ? cand : []) {
    if (typeof s === "string") slugs.push(s);
    else if (s && typeof s.slug === "string") slugs.push(s.slug);
    else if (s && typeof s.name === "string") slugs.push(s.name);
  }
  return slugs;
}

// 把子进程跑完，边流式输出边捕获 stdout 文本（供回报解析）。
function runChild(argsArr, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VENDORED_PUBLISH, ...argsArr], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let captured = "";
    child.stdout.on("data", (b) => {
      const s = b.toString();
      captured += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (b) => process.stderr.write(b.toString()));
    child.on("close", (code) => resolve({ code, out: captured }));
    child.on("error", (e) => resolve({ code: 1, out: captured, error: e }));
  });
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ArgError) fail(e.message);
    throw e;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const mdPath = args.md;
  const htmlPath = args.html;
  if (!mdPath && !htmlPath) fail("必须指定 --md <文件> 或 --html <文件> 其一。");
  if (mdPath && htmlPath) fail("--md 与 --html 只能二选一。");
  if (htmlPath && args.theme) {
    warn("--html 已是排好版的 HTML，--theme 被忽略（主题只在 --md 渲染时生效）。");
  }
  const title = args.title;
  if (!title) fail("缺少 --title <标题>。");

  const baseUrl =
    (args.baseUrl && args.baseUrl.replace(/\/+$/, "")) ||
    (process.env.DOUBAOYA_BASE_URL && process.env.DOUBAOYA_BASE_URL.replace(/\/+$/, "")) ||
    DEFAULT_BASE_URL;

  // ===== 步骤 1：加载配置 + 身份上下文 =====================================
  step(1, "加载配置 + 身份上下文");
  const configPath = args.config
    ? path.resolve(args.config)
    : path.join(process.cwd(), "config.json");
  let config = { ...BUILTIN_CONFIG };
  const loaded = await readJsonMaybe(configPath);
  const configHasTheme = Boolean(
    loaded && Object.prototype.hasOwnProperty.call(loaded, "mdTheme")
  );
  if (loaded) {
    config = { ...BUILTIN_CONFIG, ...loaded };
    info(`配置: ${configPath}`);
  } else {
    info(`配置: 未找到 ${configPath}，使用内置默认值。`);
  }

  // design-config（设计工作台产出）：套主题 + 设封面 + 按 h2 锚点注入配图。
  // 相对路径（sourceMarkdown/assets.path）都相对 design-config 文件所在目录解析。
  let design = null;
  let designDir = null;
  let designThemeCli = null; // 折算成 resolveMarkdownThemePath 的 cliTheme 入口（绝对路径/neutral/default）
  let designCoverPath = null; // 折算成 --cover 的本地路径（绝对）
  let designInjects = []; // [{ anchor, src, alt }]
  if (args.design) {
    const designPath = path.resolve(args.design);
    design = await readJsonMaybe(designPath);
    if (!design) fail(`读不到/解析不了 design-config：${designPath}（需为合法 JSON）。`);
    designDir = path.dirname(designPath);
    info(`设计配置: ${designPath}`);
    // 主题
    const tid = design.theme && typeof design.theme.id === "string" ? design.theme.id.trim() : "";
    if (tid) {
      if (tid === "neutral" || tid === "default") designThemeCli = tid;
      else if (/^[a-z0-9][a-z0-9._-]*$/i.test(tid)) designThemeCli = path.resolve(SKILL_ROOT, "themes", `${tid}.json`);
      else warn(`design.theme.id「${tid}」格式非法，已忽略。`);
      if (designThemeCli) info(`设计 · 主题: ${tid}`);
    }
    // 封面
    const covId = design.cover && design.cover.selectedAssetId;
    if (covId) {
      const asset = design.assets && design.assets[covId];
      if (asset && asset.path) {
        designCoverPath = path.resolve(designDir, asset.path);
        info(`设计 · 封面: ${covId} → ${asset.path}`);
      } else {
        warn(`design.cover.selectedAssetId=${covId} 在 assets 里没有 path，封面将走兜底。`);
      }
    }
    // 配图（按 anchor 注入）
    for (const im of Array.isArray(design.images) ? design.images : []) {
      const sel = im && im.selectedAssetId;
      if (!sel) continue;
      const asset = design.assets && design.assets[sel];
      const anchorVal = im.anchor && im.anchor.value;
      if (!asset || !asset.path || !anchorVal) {
        warn(`设计 · 配图 ${sel || "(空)"} 缺 path 或锚点，已跳过。`);
        continue;
      }
      designInjects.push({ anchor: anchorVal, src: path.resolve(designDir, asset.path), alt: asset.prompt || "" });
    }
    if (designInjects.length) info(`设计 · 配图: ${designInjects.length} 张待按 h2 锚点注入`);
  }

  // profile 路径：--profile 优先，否则 config.ipProfile（相对 skill 目录解析）
  const profileRef = args.profile || config.ipProfile;
  let profile = null;
  if (profileRef) {
    const profilePath = path.isAbsolute(profileRef)
      ? profileRef
      : path.resolve(args.profile ? process.cwd() : SKILL_ROOT, profileRef);
    profile = await readJsonMaybe(profilePath);
    if (profile) info(`身份 profile: ${profilePath}`);
    else warn(`身份 profile 读取失败: ${profilePath}（继续，但缺少身份上下文）`);
  }
  if (profile) {
    // 回显身份上下文——这是"名字被误读成通用名词"问题的通用修法：先加载并回显身份，
    // 下游内容判断才不会把账号名/IP 名当成同名的通用名词。
    info(`身份 · 名称: ${profile.displayName || profile.slug || "(未命名)"}`);
    if (Array.isArray(profile.aliases) && profile.aliases.length)
      info(`身份 · 别名: ${profile.aliases.join(" / ")}`);
    if (profile.isNot) info(`身份 · 消歧(isNot): ${profile.isNot}`);
    if (profile.tone) info(`身份 · 语气: ${profile.tone}`);
  } else {
    warn("未加载到身份 profile —— 建议在 config.json 里配置 ipProfile，避免账号名被误读为通用名词。");
  }
  info("（流水线不代写正文；正文由 agent 依 SKILL.md 撰写。）");

  // ===== 步骤 2：whoami 校验账号 ==========================================
  step(2, "whoami 校验目标账号");
  const targetAccount = args.account || config.targetAccount || undefined;
  let resolved;
  try {
    resolved = await resolveAccountKey({ account: targetAccount, baseUrl });
  } catch (e) {
    fail(`账号校验失败：${e.message}`);
  }
  const apiKey = resolved.key; // 仅内存中，绝不打印
  info(`已解析账号: ${resolved.account.email}（ID ${resolved.account.id}）`);
  info(`来源: ${resolved.source}   authVia: ${JSON.stringify(resolved.authVia)}`);
  info("（API key 已解析，仅在内存中传给子进程，不打印。）");
  const whoamiOk = true; // 硬门：到这里说明第 2 步成功，才允许后续保存草稿

  // ===== 步骤 3：草稿前置检查（skills + status）===========================
  step(3, "草稿前置检查 (skills + status)");
  // 3a. /api/skills → 断言 wechat-draft-publish 存在
  const skillsRes = await apiGet(`${baseUrl}/api/skills`, apiKey);
  if (skillsRes.ok) {
    const slugs = extractSkillSlugs(skillsRes.data);
    if (slugs.includes("wechat-draft-publish")) {
      info("发现能力 slug=wechat-draft-publish ✔（发现走 /api/skills，执行走 /api/wechat/status + /publish）");
    } else {
      warn(`/api/skills 里没找到 slug=wechat-draft-publish（现有 ${slugs.length} 项）。继续，但请确认服务端已上线该能力。`);
    }
  } else {
    warn(`/api/skills 查询失败（${skillsRes.code}: ${skillsRes.message}）。继续，跳过该断言。`);
  }

  // 3b. /api/wechat/status → 确认目标账号拥有公众号 + 解析 appid + 昵称
  const statusRes = await apiGet(`${baseUrl}/api/wechat/status`, apiKey);
  if (!statusRes.ok) {
    fail(`公众号状态查询失败（${statusRes.code}: ${statusRes.message}）。请先在 doubaoya.com 绑定公众号。`);
  }
  const accounts = statusRes.data.accounts || [];
  if (accounts.length === 0) {
    fail("目标账号没有已绑定的公众号。请先去 doubaoya.com → 公众号 页面绑定，再回来发草稿。");
  }
  const wantAppid = args.appid || config.appid || null;
  let chosen;
  if (wantAppid) {
    chosen = accounts.find((a) => a.authorizerAppid === wantAppid);
    if (!chosen) {
      fail(
        `指定的 appid=${wantAppid} 不在该账号已绑定的公众号里。已绑定：` +
          accounts.map((a) => `${a.nickname || "(未命名)"}(${a.authorizerAppid})`).join("、")
      );
    }
    info(`目标公众号: ${chosen.nickname || "(未命名)"}（${chosen.authorizerAppid}）`);
  } else if (accounts.length === 1) {
    chosen = accounts[0];
    info(`自动选用唯一绑定的公众号: ${chosen.nickname || "(未命名)"}（${chosen.authorizerAppid}）`);
  } else {
    process.stderr.write("   绑定了多个公众号，请用 --appid 指定其一：\n");
    for (const a of accounts) {
      process.stderr.write(`     - ${a.nickname || "(未命名)"}  (authorizerAppid: ${a.authorizerAppid})\n`);
    }
    fail("检测到多个公众号且未指定 --appid，已停止。");
  }
  // publicAccountName 断言
  if (config.publicAccountName) {
    if ((chosen.nickname || "") === config.publicAccountName) {
      info(`昵称匹配 config.publicAccountName ✔（${config.publicAccountName}）`);
    } else {
      warn(
        `config.publicAccountName=「${config.publicAccountName}」与解析到的公众号昵称「${chosen.nickname || "(未命名)"}」不一致，请确认没发错号。`
      );
    }
  }
  const nickname = chosen.nickname || "(已绑定公众号)";
  const appid = chosen.authorizerAppid;

  // ===== 步骤 4/5：md→HTML 渲染 ==========================================
  step(4, mdPath ? "md→HTML 渲染" : "使用已排版 HTML（跳过渲染）");
  let processedHtmlPath;
  if (mdPath) {
    const resolvedMd = path.resolve(mdPath);
    let mdContent;
    try {
      mdContent = await readFile(resolvedMd, "utf8");
    } catch (e) {
      fail(`读不到 Markdown 文件 ${resolvedMd}（${e.message}）`);
    }
    // 项目默认主题：显式 --theme 优先，其次 config.mdTheme，最后项目默认主题。
    // "neutral" 是唯一显式退回中性渲染器的标记。
    // --design 的主题作为 cliTheme 入口生效；显式 --theme 冲突时命令行优先并告警。
    let effectiveCliTheme = args.theme;
    if (designThemeCli) {
      if (args.theme) warn("--theme 与 --design 的主题冲突：命令行 --theme 优先，忽略设计主题。");
      else effectiveCliTheme = designThemeCli;
    }
    let theme;
    const themePath = resolveMarkdownThemePath({
      cliTheme: effectiveCliTheme,
      configuredTheme: config.mdTheme,
      configHasTheme,
      configDir: path.dirname(configPath),
    });
    if (themePath) {
      const themeObj = await readJsonMaybe(themePath);
      if (!themeObj) fail(`读不到/解析不了主题文件 ${themePath}（需为合法 JSON）。`);
      const { errors, warnings } = validateTheme(themeObj);
      for (const w of warnings) warn(`主题告警: ${w}`);
      if (errors.length) {
        fail(`主题校验失败（${errors.length} 个错误）:\n` + errors.map((e) => `   ❌ ${e}`).join("\n"));
      }
      theme = themeObj;
      info(`已加载主题: ${themePath}（${themeObj.meta && themeObj.meta.name ? themeObj.meta.name : "未命名"}）`);
    } else {
      info("已显式使用中性渲染器（未套项目主题）。");
    }
    // 设计配置的配图：渲染前按 h2 锚点注入到 Markdown 源。
    if (designInjects.length) {
      mdContent = injectImagesAfterHeadings(mdContent, designInjects, (m) => warn(m));
      info(`已按设计配置注入 ${designInjects.length} 张配图到 Markdown 源（h2 锚点）。`);
    }
    const html = renderMarkdownForDraft(mdContent, theme);
    processedHtmlPath = args.outputProcessedHtml
      ? path.resolve(args.outputProcessedHtml)
      : path.join(os.tmpdir(), `${path.basename(resolvedMd, path.extname(resolvedMd))}.wechat.html`);
    await writeFile(processedHtmlPath, html, "utf8");
    info(`已渲染公众号内联样式 HTML → ${processedHtmlPath}`);
  } else {
    processedHtmlPath = path.resolve(htmlPath);
    if (!existsSync(processedHtmlPath)) fail(`--html 文件不存在: ${processedHtmlPath}`);
    info(`直接使用已排版 HTML: ${processedHtmlPath}`);
  }

  // 封面解析（本地文件才作为 thumb 上传）。--design 提供封面时作为默认；显式 --cover 冲突时命令行优先并告警。
  let coverPath = args.cover || null;
  if (designCoverPath) {
    if (args.cover) warn("--cover 与 --design 的封面冲突：命令行 --cover 优先，忽略设计封面。");
    else coverPath = designCoverPath;
  }
  if (!coverPath && config.coverDir) {
    // config.coverDir 只是目录约定；未显式给封面时不擅自挑图，交由兜底。
    coverPath = null;
  }
  const coverIsLocal = coverPath && existsSync(path.resolve(coverPath));

  // ===== dry-run：渲染+校验+扫描本地图，绝不发布 =========================
  if (args.dryRun) {
    step(5, "DRY-RUN · 扫描本地图片（不发布）");
    const childArgs = ["--html", processedHtmlPath, "--title", title, "--dry-run"];
    if (coverPath) childArgs.push("--cover", coverPath);
    const { out } = await runChild(childArgs, {
      ...process.env,
      DOUBAOYA_BASE_URL: baseUrl,
    });
    const localCount = (out.match(/本地\s*(\d+)\s*张需要预上传/) || [])[1] || "?";

    step(9, "DRY-RUN 回报");
    process.stdout.write(
      "\n══════════ DRY-RUN 回报（未发布任何内容）══════════\n" +
        `  标题:        ${title}\n` +
        `  公众号:      ${nickname}（${appid}）\n` +
        `  账号:        ${resolved.account.email}\n` +
        `  身份:        ${(profile && (profile.displayName || profile.slug)) || "(未加载)"}\n` +
        `  待预上传本地图: ${localCount} 张\n` +
        `  封面:        ${coverIsLocal ? `已就绪本地封面 ${coverPath}` : `无本地封面 → 走都爆鸭兜底（${config.coverFallback}）`}\n` +
        `  whoami 校验: 通过\n` +
        `  前置检查:    通过\n` +
        "  群发:        否（本流水线只存草稿；dry-run 更是什么都不发）\n" +
        "════════════════════════════════════════════════\n"
    );
    return;
  }

  // ===== 步骤 5：图片预上传 + 保存草稿（子进程）=========================
  if (!whoamiOk) fail("内部错误：whoami 未通过却走到了发布步骤，已中止。"); // 冗余硬门
  step(5, "图片预上传 + 保存草稿（vendored preprocess-and-publish）");
  const childArgs = ["--html", processedHtmlPath, "--title", title, "--appid", appid];
  if (coverIsLocal) childArgs.push("--cover", path.resolve(coverPath));
  const digest = args.digest || config.digestTemplate || null;
  if (digest) childArgs.push("--digest", digest);

  const { code, out } = await runChild(childArgs, {
    ...process.env,
    DOUBAOYA_API_KEY: apiKey, // 仅内存 → 子进程 env，不打印
    DOUBAOYA_BASE_URL: baseUrl,
  });
  if (code !== 0) fail(`保存草稿子进程失败（退出码 ${code}）。`);

  // 解析子进程输出用于回报
  const mediaId = (out.match(/mediaId：\s*(\S+)/) || [])[1] || "(见上方子进程输出)";
  const imgCount = (out.match(/预上传本地图片：\s*(\d+)/) || [])[1] || "?";
  const withCover = /含封面/.test(out) || coverIsLocal;

  // ===== 步骤 9：验证回报 ================================================
  step(9, "验证回报");
  process.stdout.write(
    "\n══════════ 完成 · 已存入公众号草稿箱 ══════════\n" +
      `  标题:        ${title}\n` +
      `  公众号:      ${nickname}（${appid}）\n` +
      `  账号:        ${resolved.account.email}\n` +
      `  身份:        ${(profile && (profile.displayName || profile.slug)) || "(未加载)"}\n` +
      `  正文图上传数: ${imgCount} 张\n` +
      `  封面:        ${withCover ? "已上传本地封面" : `走都爆鸭兜底（${config.coverFallback}）`}\n` +
      `  mediaId:     ${mediaId}\n` +
      "  群发:        否（本流水线只存草稿）\n" +
      "  下一步:      去公众号后台亲眼确认草稿，再手动群发。\n" +
      "══════════════════════════════════════════════\n"
  );
}

// 仅作为脚本运行时执行 main；被 import 时不跑。
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
}
