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
//   * md→公众号 HTML ← **平台** POST /api/wechat/render (renderViaPlatform，本文件内)
//   * 图片预上传+存草稿 ← ./preprocess-and-publish.mjs (子进程，vendored)
//
// 硬规则（在代码里强制）：
//   1. 只存草稿绝不群发：绝不接受/转发任何群发参数（--mass-send/--broadcast…直接报错）。
//   2. 发布前必 whoami：第 2 步账号校验必须成功，第 5 步保存草稿才会跑。
//   3. 绝不打印 API key。
//   4. md→HTML **只走平台渲染**，失败一律中止，绝不回退本机渲染器。
//      本机渲染器（./render-wechat-html.mjs）仍在，但已退出流水线主干，只服务两个场景：
//      设计工作台 design-studio.mjs，以及「没有密钥、只想先看排版长什么样」。
//      🔴 那条路**不产生在线预览链接** —— 走平台才有 detailUrl，那正是它存在的理由。
//
// 单一事实源：9 步 SOP 与硬规则同时声明在同目录 ../pipeline.json，SKILL.md 与本文件
// 都以它为准。
//
// 用法见 --help。零依赖（Node ≥18 内置 + 全局 fetch）。
// -----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveAccountKey } from "./account-verify.mjs";
import { validateTheme } from "./validate-theme.mjs";
import { printArchivedConfigHint } from "./lib/archived-config-hint.mjs";
import { checkDraftLimits } from "./lib/draft-limits.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");
const VENDORED_PUBLISH = path.join(__dirname, "preprocess-and-publish.mjs");
const DEFAULT_BASE_URL = "https://doubaoya.com";
export const DEFAULT_MARKDOWN_THEME = "themes/benya-clean.json";
/** `--theme default` 指的这个 id。与 DEFAULT_MARKDOWN_THEME 的文件名同名，但走服务端那份。 */
export const DEFAULT_THEME_ID = "benya-clean";

/**
 * 主题引用分类：**裸 id 交服务端解析，路径才读本机文件**。
 *
 * 🔴 为什么裸 id 不再当路径找：包里 `themes/` 那 15 份是服务端主题的**旧副本，已经漂了**。
 *    2026-08-25 实测 `benya-clean`：包内 4282 字节（engine-1，无 meta.engine）
 *    vs 服务端 8471 字节（engine-2，extends base-17@1），`meta.name` 同为
 *    「本鸭·知识清爽」，diff 152 行。⇒ **传 --theme 与不传 --theme 拿到两种排版，而名字一样。**
 *    不传的那条路早就没有双源了（什么都不送、服务端套账号默认，见下方主流程注释），
 *    这次把显式那条路也收进同一份真相。
 *    顺带：服务端 19 个公开主题里有 4 个是 engine-2 独有的，包里结构上做不出
 *    ⇒ `--theme dark-tech` 这类到今天为止是**必然失败**的，改走 themeId 才第一次可用。
 *
 * ⚠️ **路径写法一个字不动**：自定义主题（不在服务端目录里的）仍然只能靠本机文件。
 *    包内路径也照旧读本机 —— 只是会告警说明它是旧副本。扩大来源可以，夺走既有行为不行。
 *
 * @returns {{kind:"none"}|{kind:"id",id:string}|{kind:"path"}}
 */
export function classifyThemeRef(ref) {
  if (typeof ref !== "string" || ref.length === 0) return { kind: "none" };
  if (ref === "neutral") return { kind: "id", id: "neutral" };
  if (ref === "default") return { kind: "id", id: DEFAULT_THEME_ID };
  // 带目录分隔符 / 扩展名 / 绝对路径 —— 一律当路径。
  if (ref.includes("/") || ref.includes("\\") || ref.endsWith(".json") || path.isAbsolute(ref)) {
    return { kind: "path" };
  }
  // 服务端 themeId 的字面形状；不匹配就退回按路径处理，让原有报错照常出。
  if (/^[a-z0-9][a-z0-9-]*$/i.test(ref)) return { kind: "id", id: ref };
  return { kind: "path" };
}

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
const BOOL_FLAGS = new Set(["dry-run", "render-only", "help"]);
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
      out[key === "dry-run" ? "dryRun" : key === "render-only" ? "renderOnly" : key] = true;
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
        `--output-processed-html --base-url --dry-run --render-only --help。` +
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
  --theme <id>                服务端主题 id（如 benya-clean、dark-tech）：本机不读文件，
                              交服务端解析，与不传 --theme 时是同一份真相。可用 id 见
                              GET /api/wechat/themes；未知 id 服务端返 400 并列出来。
  --theme <path>              自定义主题文件（含 / 或 .json）：本机先校验，再把整套 JSON
                              作为 themeJson 送去平台渲染。⚠️ 指到包内 themes/ 的路径是
                              服务端主题的**旧副本**（engine-1，已与服务端漂开），会告警；
                              改用裸 id 走服务端那份。
                              **不指定**（且 config 未写 mdTheme）时一个主题字段都不传，
                              由服务端套你在 doubaoya.com 排版工作室保存的默认排版 ——
                              想换默认排版去那里改，那是唯一该改它的地方。
  --theme neutral             显式要求中性排版（themeId=neutral，零品牌色）
  --theme default             项目默认主题的服务端那份（等价 --theme benya-clean）
  --design <json>             设计工作台产出的 design-config.json：套主题 + 设封面 + 按 h2
                              锚点注入配图。由 scripts/design-studio.mjs 生成。显式 --theme/
                              --cover 与 --design 冲突时命令行优先并告警。
  --output-processed-html <p> 渲染出的 HTML 落地路径（默认写临时文件）
  --base-url <url>            API 基址（默认 $DOUBAOYA_BASE_URL 或 https://doubaoya.com）
  --render-only               **只渲染，不发布**：产出 HTML + 在线预览链接就结束。
                              🔴 跳过草稿前置检查 ⇒ **不需要绑定公众号**，有密钥就能用。
                              与 --dry-run 的分工：dry-run 是「发布前彩排」，故意保留
                              账号校验与前置检查（那正是它的价值）；render-only 是
                              「我只想看看排出来什么样」，两个诉求不同，给两个入口。
  --dry-run                   只渲染+校验+扫描本地图，**不发布**（照样走平台渲染，
                              照样给你在线预览链接 —— 渲染免费且无副作用）
  -h, --help                  显示帮助

硬规则:
  · 只存草稿绝不群发（不接受任何 --mass-send/--broadcast/群发 参数）
  · 发布前必 whoami 校验目标账号（校验不过就停）
  · 绝不打印 API key
  · md→HTML 只走平台渲染（POST /api/wechat/render），失败一律中止、绝不回退本机渲染器

没有密钥、只想先看这篇排出来什么样:
  node scripts/render-wechat-html.mjs --md a.md --out a.html
  —— 纯本机，**不产生在线预览链接**（在线链接只有走平台渲染才有）。

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

// 是否显式钉了本机主题（--theme 或 config.json 里写了 mdTheme 路径）。
// 钉了就不去拉服务端编译主题——显式配置永远赢过远端默认。
export function hasExplicitLocalTheme({ cliTheme, configuredTheme, configHasTheme = false } = {}) {
  const fromCli = typeof cliTheme === "string" && cliTheme.length > 0;
  const fromConfig = configHasTheme && typeof configuredTheme === "string" && configuredTheme.length > 0;
  return fromCli || fromConfig;
}

// 平台渲染 —— **流水线唯一的 md→HTML 渲染方**（POST /api/wechat/render，免费不扣点）。
//
// 🔴 失败一律 throw，**绝不回退本机渲染器**。静默回退会产出「看起来成功、却没有预览
//    链接、排版还可能不是用户设的那套」的东西 —— 那正是本次改造要消灭的那类缺陷。
//    调用方接住之后 fail()（进程退出），不写任何 HTML 文件、不进入发布步骤。
//
// 主题：显式指定才送（整套 themeJson，或 neutral 送 themeId）；没指定就三个主题字段
//    **一个都不传**，由服务端套用户在排版工作室保存的默认排版。服务端优先级
//    themeJson > themeId > themeName > 用户默认 > 内置兜底 benya-clean，与流水线以前
//    那四级同构 —— 所以本机不再做第二遍决策，主题从此只有一个事实源。
//
// 不传 title：公众号后台单独承载标题，正文里不要第二个 H1（与 normalizeDraftMarkdown 同一意图）。
export async function renderViaPlatform({
  baseUrl,
  apiKey,
  markdown,
  themeJson = null,
  themeId = null,
  timeoutMs = 30000,
} = {}) {
  if (!apiKey) {
    throw new Error(
      "平台渲染需要 DOUBAOYA_API_KEY（在 doubaoya.com 密钥中心生成）。\n" +
        "   没有密钥、只想先看这篇排出来什么样：node scripts/render-wechat-html.mjs --md a.md\n" +
        "   —— 但那条路是纯本机的，**不产生在线预览链接**。"
    );
  }
  const body = { markdown };
  if (themeJson) body.themeJson = themeJson;
  else if (themeId) body.themeId = themeId;

  let res;
  try {
    res = await fetch(`${baseUrl}/api/wechat/render`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const why =
      e && (e.name === "TimeoutError" || e.name === "AbortError")
        ? `超时（${timeoutMs}ms）`
        : `网络错误（${e && e.message}）`;
    throw new Error(`平台渲染请求失败：${why}`);
  }

  let env = null;
  let text = "";
  try {
    text = await res.text();
  } catch {}
  try {
    env = JSON.parse(text);
  } catch {}

  if (res.status === 401) {
    throw new Error("平台渲染被拒（401）：DOUBAOYA_API_KEY 无效或缺失，请检查密钥配置。");
  }
  if (!res.ok || !env || env.success !== true) {
    const err = (env && env.error) || null;
    const code = (err && err.code) || `HTTP ${res.status}`;
    const msg = (err && err.message) || "响应无法解析";
    throw new Error(`平台渲染失败（${code}）：${msg}`);
  }
  const data = env.data || {};
  if (typeof data.html !== "string" || data.html.trim() === "") {
    throw new Error("平台渲染返回了空 HTML。");
  }
  return {
    html: data.html,
    themeSource: typeof data.themeSource === "string" ? data.themeSource : null,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
    // 这次结果在 doubaoya.com 上的详情页 —— 点开能**看见**排版效果（手机宽度沙箱预览）。
    // 流水线存在的意义之一就是把它交到用户手里。
    detailUrl: typeof env.detailUrl === "string" ? env.detailUrl : null,
    // 🔴「你安装的 skill 有更新」。服务端按 User-Agent 判，挂在成功信封上。
    // 读它不是可选的：SKILL.md 明写「原样转达给用户」，而 2026-08-21 之前
    // **本包 17 个脚本里 notice 出现次数是 0** —— 服务端老实挂上、流水线转手丢掉，
    // 于是用户永远不知道有更新。同一条链上的另一半（服务端三条专用路由传 null）
    // 同日已修；只修一半等于没修。
    notice: typeof env.notice === "string" && env.notice ? env.notice : null,
  };
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
  {
    // 微信 draft/add 字段上限，渲染 / 传图之前就拦
    const lim = checkDraftLimits({ title, digest: args.digest });
    lim.warnings.forEach(warn);
    if (lim.errors.length) fail(lim.errors.join(" "));
  }

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
    // 找不到 config.json 时，去老包（wechat-article-pipeline，已改名为 dby-publish）的
    // dby-update 对账归档目录里探一探：老版本对账器不认识改名表时会把整个老目录连同用户
    // 自建的 config.json 一起归档掉。探测不到什么都不打印，不干扰现有行为。
    printArchivedConfigHint({ pkgDir: SKILL_ROOT });
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
  // 🔴 --render-only 整段跳过：这一段唯一会拦住人的是 3b 的「没有已绑定的公众号」，
  //    而只渲染根本不碰公众号。跳过它，有密钥、没绑号的人也能拿到在线预览链接。
  //    ⚠️ 注意**不跳步骤 2**：那一步是解析密钥（resolveAccountKey），渲染本身要用它，
  //    而它并不检查绑号 —— 所以「跳过 whoami」既做不到也没必要。
  let nickname = "(未绑定)";
  let appid = "(未绑定)";
  if (args.renderOnly) {
    step(3, "草稿前置检查 —— 已跳过（--render-only 只渲染不发布，不需要绑定公众号）");
  } else {
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
  nickname = chosen.nickname || "(已绑定公众号)";
  appid = chosen.authorizerAppid;
  }   // ← 步骤 3 结束（--render-only 时整段跳过）

  // ===== 步骤 4/5：md→HTML 渲染（平台）==================================
  step(4, mdPath ? "md→HTML 渲染（平台 POST /api/wechat/render）" : "使用已排版 HTML（跳过渲染）");
  let processedHtmlPath;
  /** 这次渲染在 doubaoya.com 上的详情页；回报时交给用户点开看效果。--html 那条路没有。 */
  let renderDetailUrl = null;
  /** 服务端捎回来的「本 skill 有更新」提示，原样转达（见 renderViaPlatform 的注释）。 */
  let skillNotice = null;
  if (mdPath) {
    const resolvedMd = path.resolve(mdPath);
    let mdContent;
    try {
      mdContent = await readFile(resolvedMd, "utf8");
    } catch (e) {
      fail(`读不到 Markdown 文件 ${resolvedMd}（${e.message}）`);
    }
    // --design 的主题作为 cliTheme 入口生效；显式 --theme 冲突时命令行优先并告警。
    let effectiveCliTheme = args.theme;
    if (designThemeCli) {
      if (args.theme) warn("--theme 与 --design 的主题冲突：命令行 --theme 优先，忽略设计主题。");
      else effectiveCliTheme = designThemeCli;
    }

    // 主题只在**显式指定**时才送。没指定 → 三个主题字段一个都不传，服务端套账号默认排版。
    // 以前这里有一条本机四级优先级 + 拉服务端编译主题回来本机套用；那套整个退场了，
    // 因为服务端自己的优先级与它同构 —— 留着等于同一个决策做两遍，一漂移就是
    // 「主题双源对不上」重演。想换默认排版，去 doubaoya.com 排版工作室改，那是唯一该改它的地方。
    let themeJson = null;
    let themeId = null;
    if (
      hasExplicitLocalTheme({
        cliTheme: effectiveCliTheme,
        configuredTheme: config.mdTheme,
        configHasTheme,
      })
    ) {
      // 显式值取自 --theme，其次 config.mdTheme（与 hasExplicitLocalTheme 同构）。
      const themeRef =
        typeof effectiveCliTheme === "string" && effectiveCliTheme.length > 0
          ? effectiveCliTheme
          : config.mdTheme;
      const themeClass = classifyThemeRef(themeRef);
      if (themeClass.kind === "id") {
        // 裸 id / neutral / default → 交服务端解析，本机不读任何文件。见 classifyThemeRef。
        themeId = themeClass.id;
        info(
          themeId === "neutral"
            ? "已显式要求中性排版（themeId=neutral，零品牌色）。"
            : `主题交服务端解析：themeId=${themeId}（与不传 --theme 时同一份真相；` +
              `未知 id 服务端返 400 并指向 GET /api/wechat/themes）。`,
        );
      } else {
        const themePath = resolveMarkdownThemePath({
          cliTheme: effectiveCliTheme,
          configuredTheme: config.mdTheme,
          configHasTheme,
          configDir: path.dirname(configPath),
        });
        // classifyThemeRef 已经把 "neutral" 拦在上面，这里理论上拿不到 null；留一道防御，
        // 免得将来有人改了分类却让 readJsonMaybe(null) 去炸一个看不懂的错。
        if (themePath === null) fail("主题解析异常：既不是 id 也解析不出路径。");
        // 🔴 指到包内 themes/ 的路径 = 服务端主题的旧副本（engine-1），排版会与账号默认不一致。
        //    不夺走既有行为（照旧读本机），但必须说出来，否则「同名不同版」是静默的。
        if (path.resolve(themePath).startsWith(path.join(SKILL_ROOT, "themes") + path.sep)) {
          const bare = path.basename(themePath, ".json");
          warn(
            `主题 ${themePath} 是包内旧副本（engine-1），与服务端同名主题已漂开；` +
              `改用 --theme ${bare} 可走服务端那份（也是不传 --theme 时用的那份）。`,
          );
        }
        const themeObj = await readJsonMaybe(themePath);
        if (!themeObj) fail(`读不到/解析不了主题文件 ${themePath}（需为合法 JSON）。`);
        // 🔴 本机先校验再送：不合法的主题送到服务端只会换回一个更难读的远端 400，
        //    而本机校验的报错是逐条的。这一条写在 spec 里。
        const { errors, warnings } = validateTheme(themeObj);
        for (const w of warnings) warn(`主题告警: ${w}`);
        if (errors.length) {
          fail(`主题校验失败（${errors.length} 个错误）:\n` + errors.map((e) => `   ❌ ${e}`).join("\n"));
        }
        themeJson = themeObj;
        info(`已加载主题: ${themePath}（${themeObj.meta && themeObj.meta.name ? themeObj.meta.name : "未命名"}）`);
      }
    }
    // 设计配置的配图：渲染前按 h2 锚点注入到 Markdown 源。
    if (designInjects.length) {
      mdContent = injectImagesAfterHeadings(mdContent, designInjects, (m) => warn(m));
      info(`已按设计配置注入 ${designInjects.length} 张配图到 Markdown 源（h2 锚点）。`);
    }

    let rendered;
    try {
      rendered = await renderViaPlatform({
        baseUrl,
        apiKey,
        // 公众号后台单独承载标题：正文里剥掉 frontmatter 与首个 H1，也不传 title。
        markdown: normalizeDraftMarkdown(mdContent),
        themeJson,
        themeId,
      });
    } catch (e) {
      // 🔴 不回退本机渲染器。回退会产出没有预览链接、排版也可能不同的产物，
      //    而用户会以为那就是平台排版 —— 宁可红。
      fail(
        `${e.message}\n` +
          "   平台渲染是流水线唯一的渲染方，失败不回退本机渲染器。\n" +
          "   只想先看排版（无在线链接）：node scripts/render-wechat-html.mjs --md <你的.md>"
      );
    }
    for (const w of rendered.warnings) warn(`渲染告警: ${w}`);
    // 原样转达，一个字不改（SKILL.md 的承诺）。它不影响本次结果，也不该被当成错误。
    if (rendered.notice) skillNotice = rendered.notice;
    renderDetailUrl = rendered.detailUrl;
    processedHtmlPath = args.outputProcessedHtml
      ? path.resolve(args.outputProcessedHtml)
      : path.join(os.tmpdir(), `${path.basename(resolvedMd, path.extname(resolvedMd))}.wechat.html`);
    await writeFile(processedHtmlPath, rendered.html, "utf8");
    info(`已渲染公众号内联样式 HTML → ${processedHtmlPath}`);
    if (rendered.themeSource) info(`排版来源: ${rendered.themeSource}`);
    if (renderDetailUrl) info(`在线预览（点开就能看到排出来什么样）: ${renderDetailUrl}`);
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

  // ===== --render-only：只渲染，到此为止 =================================
  // 🔴 出口放在**封面解析之后、dry-run 之前**：封面与本地图扫描都属于「发布准备」，
  //    只渲染的人不需要。而 dry-run 分支**一个字都不动** —— 它的语义是「发布前彩排」，
  //    故意包含账号校验与前置检查，那正是它的价值。两个诉求不同，给两个入口。
  if (args.renderOnly) {
    step(9, "RENDER-ONLY 回报");
    if (!renderDetailUrl && mdPath) {
      warn("这次渲染没拿到在线预览链接（平台未回 detailUrl）——HTML 仍已产出。");
    }
    process.stdout.write(
      "\n══════════ RENDER-ONLY 回报（只渲染，未发布、未碰公众号）══════════\n" +
        `  标题:        ${title}\n` +
        `  HTML:        ${processedHtmlPath}\n` +
        (renderDetailUrl ? `  在线预览:    ${renderDetailUrl}\n` : "  在线预览:    （无：--html 直传不经平台渲染）\n") +
        (skillNotice ? `  技能更新:    ${skillNotice}\n` : "") +
        "  公众号:      未查询（--render-only 跳过草稿前置检查，不需要绑号）\n" +
        "  发布:        否（本入口不写任何用户资产）\n" +
        "  下一步:      要存进公众号草稿箱，去掉 --render-only 重跑（那时需要已绑号）。\n" +
        "════════════════════════════════════════════════\n"
    );
    return;
  }

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
        (renderDetailUrl ? `  在线预览:    ${renderDetailUrl}\n` : "") +
        (skillNotice ? `  技能更新:    ${skillNotice}\n` : "") +
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
      (renderDetailUrl ? `  在线预览:    ${renderDetailUrl}\n` : "") +
      (skillNotice ? `  技能更新:    ${skillNotice}\n` : "") +
      "  群发:        否（本流水线只存草稿）\n" +
      "  下一步:      去公众号后台亲眼确认草稿，再手动群发。\n" +
      "══════════════════════════════════════════════\n"
  );
}

// 仅作为脚本运行时执行 main；被 import 时不跑。
// 🔴 入口守卫：两边都先 realpathSync 落到同一条真路径再比。
//    `import.meta.url` 是 ESM loader **解过软链**的真路径，`process.argv[1]` 原样保留调用时
//    给的那条路径；而软链正是 skills CLI 装出来的常态形态（`.claude/skills/<name>` →
//    `.agents/skills/<name>`）。拿字面串比 ⇒ 经绝对软链路径调用时两串不等 ⇒ main() 一步都不进、
//    退出码 0、stdout 零字节：用户看到的不是报错，是**什么都没发生**——最难查的失败形态。
//    `pathToFileURL` 只治编码、不解软链——光换成它不算修好（同族里正有这么一种伪修对写法）。
//    skill 包各自独立安装、不能跨包 import，所以这段在每个入口脚本里各留一份，改一处要全改。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false; // node -e / REPL / 管道喂进来：本来就没有主脚本，安静退场是对的
  const selfPath = fileURLToPath(import.meta.url);
  const href = (p) => {
    try {
      return pathToFileURL(realpathSync(p)).href;
    } catch {
      return null;
    }
  };
  const called = href(argv1);
  const here = href(selfPath);
  if (called && here) return called === here;
  // realpath 解不开（路径当场被删、权限不足……）：**绝不静默**。先退回未解软链的字面比较，
  // 还判不出来就吭一声——宁可多打一行提示，也不要再来一次「零输出、退出码 0」。
  if (argv1 === selfPath) return true;
  console.error(
    `提示：解析不出 ${argv1} 的真实路径，没法确认是不是在直接跑本脚本；` +
      `如果你就是在直接跑它，换成绝对路径重试。`
  );
  return false;
}

if (isMainModule()) {
  main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
}
