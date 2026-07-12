#!/usr/bin/env node
// design-studio.mjs — 都爆鸭 · 公众号图文「本地设计工作台」（零依赖 · Node 内置 http）
// -----------------------------------------------------------------------------
// 起一个只绑 127.0.0.1 的本地网页工作台：左侧手机公众号实时预览，右侧三区
// （排版 / 封面 / 配图）。选好后写出一个 design-config.json，pipeline.mjs --design
// 按它跑（套主题、设封面、按 h2 锚点注入配图）。**只改本地 vault 产物，不发布、不提交。**
//
// 组合（不重复造轮子）：
//   * md→公众号 HTML ← ./render-wechat-html.mjs (renderWechatHtml，纯函数、已内联样式)
//   * 草稿正文规范化  ← ./pipeline.mjs         (normalizeDraftMarkdown，剥 frontmatter/H1)
//   * AI 生封面/配图  ← ./gen-image.mjs         (generateImage，走口令 DOUBAOYA_API_KEY)
//
// 产物目录：design-config 同目录下的 .design/assets/（生成的 jpeg）。.design/ 是产物，
// 不入库（vault 本就未跟踪；见 SKILL.md）。
//
// 用法:
//   node scripts/design-studio.mjs --md <文章.md> --title "<标题>" \
//        [--config ./config.json] [--out <design-config 路径>] [--port 4599]
//
// 端点（除 / 与静态资源外全 JSON）:
//   GET  /                      设计页（design-studio.page.html）
//   GET  /api/bootstrap         { title, markdown, themes[14], styles[6], suggestedAnchors, ip, existing }
//   GET  /api/style-sample?id=  风格样图 jpeg
//   GET  /api/asset?id=         已生成资产 jpeg
//   GET  /api/render?themeId=   { html }（正文；neutral=不套主题，default=项目默认主题）
//   POST /api/generate          { slot, styleId, prompt, anchor?, useIp?, referenceImage? } → { assetId, path, dataUrl, usedIp, ... }
//   POST /api/plan-figures      { maxFigures?, minChars? } → { figures[], meta }（确定性配图自动布局）
//   POST /api/upload-ip         { dataUrl } → { path, dataUrl }（存进 assets/ip/，设为当前 IP）
//   POST /api/upload-cover      { dataUrl } → { assetId, path, dataUrl }
//   POST /api/save              <design-config> → { ok, path }
//
// bootstrap.ip = { path, dataUrl } | null（当前 IP 参考图）。生封面/配图默认用 IP 条件化
// （useIp 默认 true）保留统一形象；配图位置由 /api/plan-figures 自动决定，用户不再手选锚点。
//
// 零依赖（Node ≥18 内置 http/fs/path/child_process/url + 全局 fetch）。绝不打印密钥。
// -----------------------------------------------------------------------------

import http from "node:http";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderWechatHtml } from "./render-wechat-html.mjs";
import { normalizeDraftMarkdown } from "./pipeline.mjs";
import { generateImage, resolveReferenceImage, SIZE_COVER, SIZE_FIGURE } from "./gen-image.mjs";
import { planFigures } from "./plan-figures.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");
const THEMES_DIR = path.join(SKILL_ROOT, "themes");
const IP_DIR = path.join(SKILL_ROOT, "assets", "ip");
const IP_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const STYLES_DIR = path.join(SKILL_ROOT, "assets", "styles");
const STYLES_INDEX = path.join(STYLES_DIR, "index.json");
const PAGE_PATH = path.join(__dirname, "design-studio.page.html");
const SCHEMA_PATH = path.join(SKILL_ROOT, "schemas", "design-config.schema.json");
const DEFAULT_PROJECT_THEME = "magazine";
const DEFAULT_PORT = 4599;

const ID_SAFE = /^[a-z0-9][a-z0-9._-]*$/i; // 防路径穿越

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
const HELP = `design-studio.mjs — 都爆鸭 · 公众号图文本地设计工作台（零依赖）

用法:
  node scripts/design-studio.mjs --md <文章.md> --title "<标题>" [选项]

必填:
  --md <file>       文章 Markdown 源（预览与配图锚点解析用）
  --title <str>     文章标题（显示在手机预览顶栏）

选项:
  --config <path>   config.json（可选，目前仅回显；主题/封面以工作台选择为准）
  --out <path>      design-config 写出路径（默认: 与 md 同目录 <名>.design.json）
  --port <n>        起始端口（默认 4599，占用则自增）
  -h, --help        显示帮助

产物: design-config 同目录下 .design/assets/ 存生成的封面/配图 jpeg。
生图走口令 DOUBAOYA_API_KEY（缺失时页面会给出清晰错误）。绝不打印密钥。
`;

function parseArgs(argv) {
  const out = { _: [] };
  const VALUE = new Set(["md", "title", "config", "out", "port"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    let key = a.slice(2);
    let val;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (!VALUE.has(key)) throw new Error(`未知参数 --${key}`);
    if (val === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`参数 --${key} 缺少取值。`);
      val = next;
      i++;
    }
    out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 极简 JSON-Schema（draft-07 子集）校验器 —— 用随附 schema 校验 save 出的 config
// 支持: $ref(#/definitions/*)、const、enum、type(含数组)、required、properties、
//       items、additionalProperties(schema)
// ---------------------------------------------------------------------------
function isPlainObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function jsType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function matchType(v, t) {
  switch (t) {
    case "object":
      return isPlainObj(v);
    case "array":
      return Array.isArray(v);
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number";
    case "integer":
      return Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "null":
      return v === null;
    default:
      return false;
  }
}
function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .reduce((acc, part) => (acc ? acc[part] : undefined), root);
}
export function validateAgainstSchema(data, schema, root = schema, at = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  if (schema.$ref) {
    const sub = resolveRef(schema.$ref, root);
    if (!sub) errors.push(`${at}: 无法解析 $ref ${schema.$ref}`);
    else validateAgainstSchema(data, sub, root, at, errors);
    return errors;
  }
  if ("const" in schema && data !== schema.const) {
    errors.push(`${at}: 期望常量 ${JSON.stringify(schema.const)}，实际 ${JSON.stringify(data)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(data)) {
    errors.push(`${at}: 值不在枚举 ${JSON.stringify(schema.enum)} 内`);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchType(data, t))) {
      errors.push(`${at}: 期望类型 ${types.join("|")}，实际 ${jsType(data)}`);
    }
  }
  if (isPlainObj(data)) {
    for (const k of schema.required || []) {
      if (!(k in data)) errors.push(`${at}: 缺少必填字段「${k}」`);
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in data) validateAgainstSchema(data[k], sub, root, `${at}.${k}`, errors);
      }
    }
    if (isPlainObj(schema.additionalProperties)) {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const [k, v] of Object.entries(data)) {
        if (!known.has(k)) validateAgainstSchema(v, schema.additionalProperties, root, `${at}.${k}`, errors);
      }
    }
  }
  if (Array.isArray(data) && schema.items) {
    data.forEach((it, i) => validateAgainstSchema(it, schema.items, root, `${at}[${i}]`, errors));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 数据加载
// ---------------------------------------------------------------------------
async function readJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}
async function readJsonMaybe(p) {
  try {
    return await readJson(p);
  } catch {
    return null;
  }
}

// 读 14 套主题的 meta → [{id,name,notes}]
async function loadThemes() {
  const files = (await readdir(THEMES_DIR)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files.sort()) {
    const t = await readJsonMaybe(path.join(THEMES_DIR, f));
    if (!t || !t.meta) continue;
    out.push({ id: f.replace(/\.json$/, ""), name: t.meta.name || f, notes: t.meta.notes || "" });
  }
  return out;
}

// 读 6 个生图风格 → [{id,name,sample(样图端点)}]
async function loadStyles() {
  const idx = await readJsonMaybe(STYLES_INDEX);
  const styles = (idx && Array.isArray(idx.styles) ? idx.styles : []).map((s) => ({
    id: s.id,
    name: s.name,
    sample: `/api/style-sample?id=${encodeURIComponent(s.id)}`,
  }));
  return styles;
}

// 解析 markdown 的 h2 → 建议配图锚点
function parseH2Anchors(markdown) {
  const anchors = [];
  const seen = new Set();
  for (const raw of String(markdown).replace(/\r\n?/g, "\n").split("\n")) {
    const m = raw.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m && !/^#/.test(m[1])) {
      const value = m[1].trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        anchors.push({ type: "afterHeading", value });
      }
    }
  }
  return anchors;
}

// 扫 assets/ip/ 里最新的一张图片（按 mtime），返回绝对路径或 null
async function newestIpImage() {
  if (!existsSync(IP_DIR)) return null;
  let best = null;
  for (const f of await readdir(IP_DIR)) {
    if (!IP_EXT.has(path.extname(f).toLowerCase())) continue;
    const abs = path.join(IP_DIR, f);
    let mtime = 0;
    try {
      mtime = statSync(abs).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) best = { abs, mtime };
  }
  return best ? best.abs : null;
}

// 把当前 IP 绝对路径 → { path(相对 SKILL_ROOT 记录用), dataUrl(缩略图) }，无 IP 返回 null
async function ipInfo(ipAbs) {
  if (!ipAbs || !existsSync(ipAbs)) return null;
  let dataUrl = null;
  try {
    dataUrl = await resolveReferenceImage(ipAbs); // 本地文件 → data:URL
  } catch {
    dataUrl = null;
  }
  return { path: path.relative(SKILL_ROOT, ipAbs), dataUrl };
}

// themeId → 主题对象（neutral=undefined 不套；default=项目默认主题）
async function resolveThemeObject(themeId) {
  if (!themeId || themeId === "neutral") return undefined;
  const id = themeId === "default" ? DEFAULT_PROJECT_THEME : themeId;
  if (!ID_SAFE.test(id)) throw new Error(`非法 themeId: ${id}`);
  const p = path.join(THEMES_DIR, `${id}.json`);
  const t = await readJsonMaybe(p);
  if (!t) throw new Error(`找不到主题 ${id}`);
  return t;
}

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  res.end(body);
}
function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, { "Content-Type": type, "Content-Length": body.length });
  res.end(body);
}
async function sendFileMaybe(res, filePath, type) {
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length });
    res.end(buf);
    return true;
  } catch {
    sendJson(res, 404, { error: "NOT_FOUND", message: `找不到 ${path.basename(filePath)}` });
    return false;
  }
}
function readBody(req, limitBytes = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// 主
// ---------------------------------------------------------------------------
async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`\n❌ ${e.message}\n\n${HELP}`);
    process.exit(1);
  }
  if (args.help || (!args.md && !args.title)) {
    process.stdout.write(HELP);
    return;
  }
  if (!args.md) {
    process.stderr.write("\n❌ 缺少 --md <文章.md>。\n");
    process.exit(1);
  }
  if (!args.title) {
    process.stderr.write("\n❌ 缺少 --title <标题>。\n");
    process.exit(1);
  }

  const mdPath = path.resolve(args.md);
  if (!existsSync(mdPath)) {
    process.stderr.write(`\n❌ 找不到 Markdown 文件: ${mdPath}\n`);
    process.exit(1);
  }
  const title = args.title;
  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(path.dirname(mdPath), `${path.basename(mdPath, path.extname(mdPath))}.design.json`);
  const designDir = path.dirname(outPath);
  const assetsDir = path.join(designDir, ".design", "assets");

  // 读入 markdown、schema、page（尽早失败）
  const markdown = await readFile(mdPath, "utf8");
  const schema = await readJsonMaybe(SCHEMA_PATH);
  if (!schema) {
    process.stderr.write(`\n❌ 读不到 schema: ${SCHEMA_PATH}\n`);
    process.exit(1);
  }
  if (!existsSync(PAGE_PATH)) {
    process.stderr.write(`\n❌ 读不到设计页: ${PAGE_PATH}\n`);
    process.exit(1);
  }

  // assetId 计数器：扫已有产物做种子，避免覆盖
  const counters = { cov: 0, fig: 0, up: 0 };
  if (existsSync(assetsDir)) {
    for (const f of await readdir(assetsDir)) {
      const m = f.match(/^(cov|fig|up)_(\d+)\.jpg$/i);
      if (m) counters[m[1].toLowerCase()] = Math.max(counters[m[1].toLowerCase()], Number(m[2]));
    }
  }
  const nextId = (kind) => `${kind}_${++counters[kind]}`;

  const styleIndex = await readJsonMaybe(STYLES_INDEX);
  const styleIds = new Set((styleIndex && styleIndex.styles ? styleIndex.styles : []).map((s) => s.id));

  // 当前 IP 参考图：优先 --config 的 ipImage（相对 SKILL_ROOT），否则 assets/ip/ 里最新一张；
  // 页面上传 IP 会覆盖它（currentIpAbs 可变）。无 IP 时封面/配图退回文生图。
  let currentIpAbs = null;
  if (args.config) {
    const cfg = await readJsonMaybe(path.resolve(args.config));
    if (cfg && typeof cfg.ipImage === "string" && cfg.ipImage.trim()) {
      const p = path.resolve(SKILL_ROOT, cfg.ipImage.trim());
      if (existsSync(p)) currentIpAbs = p;
    }
  }
  if (!currentIpAbs) currentIpAbs = await newestIpImage();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    try {
      // --- 静态：设计页 ---
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        return await sendFileMaybe(res, PAGE_PATH, "text/html; charset=utf-8");
      }

      // --- bootstrap ---
      if (req.method === "GET" && pathname === "/api/bootstrap") {
        const [themes, styles] = await Promise.all([loadThemes(), loadStyles()]);
        const existing = await readJsonMaybe(outPath);
        const ip = await ipInfo(currentIpAbs);
        return sendJson(res, 200, {
          title,
          markdown,
          sourceMarkdown: path.relative(designDir, mdPath),
          themes,
          styles,
          suggestedAnchors: parseH2Anchors(markdown),
          ip, // { path, dataUrl } | null —— 当前 IP 参考图
          existing,
        });
      }

      // --- 风格样图 ---
      if (req.method === "GET" && pathname === "/api/style-sample") {
        const id = url.searchParams.get("id") || "";
        if (!ID_SAFE.test(id) || !styleIds.has(id)) return sendJson(res, 400, { error: "BAD_ID" });
        return await sendFileMaybe(res, path.join(STYLES_DIR, `${id}.jpg`), "image/jpeg");
      }

      // --- 已生成资产 ---
      if (req.method === "GET" && pathname === "/api/asset") {
        const id = url.searchParams.get("id") || "";
        if (!/^(cov|fig|up)_\d+$/i.test(id)) return sendJson(res, 400, { error: "BAD_ID" });
        return await sendFileMaybe(res, path.join(assetsDir, `${id}.jpg`), "image/jpeg");
      }

      // --- 渲染预览 ---
      if (req.method === "GET" && pathname === "/api/render") {
        const themeId = url.searchParams.get("themeId") || "neutral";
        let theme;
        try {
          theme = await resolveThemeObject(themeId);
        } catch (e) {
          return sendJson(res, 400, { error: "BAD_THEME", message: e.message });
        }
        // 与 pipeline 一致：剥 frontmatter/首个 H1，正文标题由平台承载（不在正文渲染 H1）
        const html = renderWechatHtml(normalizeDraftMarkdown(markdown), { theme, onWarn: () => {} });
        return sendJson(res, 200, { html, themeId });
      }

      // --- 生图 ---
      if (req.method === "POST" && pathname === "/api/generate") {
        const body = await readBody(req);
        const slot = body.slot;
        if (slot !== "cover" && slot !== "figure") {
          return sendJson(res, 400, { error: "BAD_SLOT", message: "slot 必须是 cover 或 figure" });
        }
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return sendJson(res, 400, { error: "NO_PROMPT", message: "缺少 prompt" });
        const styleId = body.styleId || undefined;
        if (styleId && !styleIds.has(styleId)) {
          return sendJson(res, 400, { error: "BAD_STYLE", message: `未知风格 id=${styleId}` });
        }
        if (!process.env.DOUBAOYA_API_KEY) {
          return sendJson(res, 400, {
            error: "MISSING_KEY",
            message: "缺少环境变量 DOUBAOYA_API_KEY（doubaoya 口令）。请先 export 后重启工作台再生图。",
          });
        }
        // 参考图条件化：useIp 默认 true，用当前 IP 保留统一形象；也可透传显式 referenceImage。
        // 无 IP / useIp=false 时退回文生图（行为不变）。
        const useIp = body.useIp !== false;
        let referenceImage = null;
        if (body.referenceImage) referenceImage = body.referenceImage;
        else if (useIp && currentIpAbs) referenceImage = currentIpAbs;
        const usedIp = Boolean(referenceImage);

        const kind = slot === "cover" ? "cov" : "fig";
        const assetId = nextId(kind);
        const outFile = path.join(assetsDir, `${assetId}.jpg`);
        await mkdir(assetsDir, { recursive: true });
        try {
          const { bytes } = await generateImage({
            prompt,
            out: outFile,
            size: slot === "cover" ? SIZE_COVER : SIZE_FIGURE,
            styleId,
            referenceImage,
            coverGuard: slot === "cover",
          });
          const buf = await readFile(outFile);
          return sendJson(res, 200, {
            assetId,
            path: path.relative(designDir, outFile),
            dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
            prompt,
            styleId: styleId || null,
            usedIp,
            bytes,
          });
        } catch (e) {
          // 生成失败：回退计数，返回清晰错误（不打印密钥；generateImage 的报错本就不含密钥）
          counters[kind]--;
          return sendJson(res, 502, { error: "GEN_FAILED", message: e.message });
        }
      }

      // --- 配图自动布局方案（确定性规则，不接 LLM） ---
      if (req.method === "POST" && pathname === "/api/plan-figures") {
        const body = await readBody(req);
        const opts = {};
        if (body.maxFigures != null && Number.isFinite(Number(body.maxFigures))) opts.maxFigures = Number(body.maxFigures);
        if (body.minChars != null && Number.isFinite(Number(body.minChars))) opts.minChars = Number(body.minChars);
        const plan = planFigures(markdown, opts);
        return sendJson(res, 200, plan);
      }

      // --- 上传 IP 参考图（存进 assets/ip/，设为当前 IP） ---
      if (req.method === "POST" && pathname === "/api/upload-ip") {
        const body = await readBody(req);
        const m = String(body.dataUrl || "").match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
        if (!m) return sendJson(res, 400, { error: "BAD_DATAURL", message: "dataUrl 必须是 data:image/*;base64,…" });
        const sub = m[1].toLowerCase();
        const ext = sub === "jpeg" ? "jpg" : IP_EXT.has(`.${sub}`) ? sub : "png";
        await mkdir(IP_DIR, { recursive: true });
        const abs = path.join(IP_DIR, `uploaded-${Date.now()}.${ext}`);
        await writeFile(abs, Buffer.from(m[2], "base64"));
        currentIpAbs = abs; // 覆盖当前 IP
        const info = await ipInfo(abs);
        return sendJson(res, 200, info || { path: path.relative(SKILL_ROOT, abs), dataUrl: null });
      }

      // --- 用户自传封面 ---
      if (req.method === "POST" && pathname === "/api/upload-cover") {
        const body = await readBody(req);
        const m = String(body.dataUrl || "").match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
        if (!m) return sendJson(res, 400, { error: "BAD_DATAURL", message: "dataUrl 必须是 data:image/*;base64,…" });
        const assetId = nextId("up");
        const outFile = path.join(assetsDir, `${assetId}.jpg`);
        await mkdir(assetsDir, { recursive: true });
        const buf = Buffer.from(m[1], "base64");
        await writeFile(outFile, buf);
        return sendJson(res, 200, {
          assetId,
          path: path.relative(designDir, outFile),
          dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
          prompt: "(用户上传)",
          styleId: "uploaded",
          bytes: buf.length,
        });
      }

      // --- 保存 design-config ---
      if (req.method === "POST" && pathname === "/api/save") {
        const body = await readBody(req);
        if (!isPlainObj(body)) {
          return sendJson(res, 400, { error: "BAD_BODY", message: "请求体必须是 design-config 对象" });
        }
        const config = { ...body };
        if (!config.$schema) config.$schema = "./schemas/design-config.schema.json";
        const errors = validateAgainstSchema(config, schema, schema, "$", []);
        if (errors.length) {
          return sendJson(res, 400, { error: "SCHEMA_INVALID", errors });
        }
        await writeFile(outPath, JSON.stringify(config, null, 2) + "\n", "utf8");
        return sendJson(res, 200, { ok: true, path: outPath });
      }

      return sendJson(res, 404, { error: "NOT_FOUND", message: `无此端点 ${req.method} ${pathname}` });
    } catch (e) {
      return sendJson(res, 500, { error: "SERVER_ERROR", message: e && e.message ? e.message : String(e) });
    }
  });

  // 端口：占用则自增（自己实现，不引 get-port）
  const startPort = Number(args.port) || DEFAULT_PORT;
  const maxTries = 25;
  let port = startPort;
  const listen = () =>
    new Promise((resolve, reject) => {
      const onErr = (err) => {
        server.removeListener("listening", onOk);
        if (err.code === "EADDRINUSE" && port - startPort < maxTries) {
          port++;
          server.listen(port, "127.0.0.1");
        } else reject(err);
      };
      const onOk = () => {
        server.removeListener("error", onErr);
        resolve();
      };
      server.on("error", onErr);
      server.once("listening", onOk);
      server.listen(port, "127.0.0.1");
    });

  try {
    await listen();
  } catch (e) {
    process.stderr.write(`\n❌ 无法监听端口: ${e.message}\n`);
    process.exit(1);
  }

  const urlStr = `http://127.0.0.1:${port}/`;
  process.stderr.write(`\n🦆 设计工作台已启动: ${urlStr}\n`);
  process.stderr.write(`   文章: ${mdPath}\n`);
  process.stderr.write(`   写出: ${outPath}\n`);
  process.stderr.write(`   资产: ${assetsDir}\n`);
  process.stderr.write(`   (Ctrl-C 结束。所选配置需在网页点「保存配置」才落盘。)\n`);
  if (process.platform === "darwin") {
    try {
      spawn("open", [urlStr], { stdio: "ignore", detached: true }).unref();
    } catch {
      /* open 失败无妨，URL 已打印 */
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => {
    process.stderr.write(`\n❌ ${e && e.stack ? e.stack : String(e)}\n`);
    process.exit(1);
  });
}
