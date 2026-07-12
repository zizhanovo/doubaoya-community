#!/usr/bin/env node
// gen-image.mjs — 都爆鸭 · 公众号封面/配图 AI 生图（走口令调 doubaoya 生图接口）
// -----------------------------------------------------------------------------
// 把一段 prompt 交给 doubaoya.com 的生图口令接口（**同步**返回，单张 10–60s），
// 拿回一张 jpeg 存到本地。密钥只在 doubaoya 服务端，skill 端只需口令（DOUBAOYA_API_KEY），
// 每张扣点数（约 ¥0.30 上游成本）。封面（1536x1024）和正文配图（1024x1024）共用它，只是
// --size 不同。产出的本地 jpeg 路径可以直接：
//   * 作为封面喂给 pipeline.mjs 的 --cover（走 thumb 上传）；
//   * 或以 <img src="本地路径"> 落进 Markdown/HTML 正文，由 preprocess-and-publish.mjs
//     走 image 上传——**不改动任何发布链路契约**。
//
// 生图契约（doubaoya 口令接口，密钥只在服务端）：
//   POST {DOUBAOYA_API_BASE}/api/skills/gpt-image-gen/invoke   （默认 https://doubaoya.com）
//   Authorization: Bearer $DOUBAOYA_API_KEY   （skill 发布本就用的这枚口令）
//   body: { prompt, size }
//   resp: { success, data: { images: [{ b64, mime }] } }（b64 无 data: 前缀）
//   说明：上游生图密钥、model、background/n 等都收在 doubaoya 服务端，skill 端不再接触。
//
// env:
//   DOUBAOYA_API_KEY  （必填）doubaoya 口令（Bearer）。缺失时报清晰错误，不崩栈。绝不打印、绝不落文件。
//   DOUBAOYA_API_BASE （可选）默认 https://doubaoya.com
//
// 零依赖（Node ≥18 内置 fetch）。
//
// 用法（CLI）:
//   node gen-image.mjs --prompt "画面描述…" --out cover.jpg --size 1536x1024 --cover-guard
//   node gen-image.mjs --prompt "画面描述…" --out fig1.jpg --size 1024x1024 --style flat-illustration
//
// 用法（import）:
//   import { generateImage, COVER_GUARD, buildPrompt } from "./gen-image.mjs";
//   await generateImage({ prompt, size:"1536x1024", out:"cover.jpg", styleId:"magazine-editorial", coverGuard:true });
// -----------------------------------------------------------------------------

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, "..");
const STYLES_INDEX = path.join(SKILL_ROOT, "assets", "styles", "index.json");

const DEFAULT_BASE = "https://doubaoya.com";
const IMAGE_GEN_INVOKE_PATH = "/api/skills/gpt-image-gen/invoke";

// 封面护栏：公众号封面会把 1536x1024 居中裁成约 2.35:1 的宽幅，靠这句提示把主体压在
// 水平中带、上下留氛围背景，避免关键内容被上下裁掉。
export const COVER_GUARD =
  "Composition: keep the main subject and any text within the central horizontal band; " +
  "leave calm atmospheric background at the top and bottom edges. The image will be " +
  "center-cropped to a wide 2.35:1 banner, so nothing important should touch the top or bottom edge.";

export const SIZE_COVER = "1536x1024";
export const SIZE_FIGURE = "1024x1024";

// 从图片首字节嗅探 MIME（够用即可：png/jpeg/gif/webp，兜底 png）。
function sniffImageMime(buf) {
  if (!buf || buf.length < 4) return "image/png";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return "image/webp";
  return "image/png";
}

/**
 * 把「参考图入参」归一成生图接口 referenceImage 能吃的字符串：
 *   - data: URL          → 原样返回
 *   - http(s):// URL     → 原样返回（服务端自行拉取）
 *   - 本地文件路径        → 读盘 → 嗅探 MIME → 返回 data:<mime>;base64,<...>
 *   - 裸 base64（较长）   → 去空白后原样返回
 * 空/未提供 → 返回 null（调用方据此决定是否走 edit）。
 * 这是「本地图路径 → data:/base64」的小工具，供工作台与 CLI 共用。
 * @param {string|null|undefined} ref
 * @returns {Promise<string|null>}
 */
export async function resolveReferenceImage(ref) {
  if (ref == null) return null;
  const s = String(ref).trim();
  if (!s) return null;
  if (/^data:image\//i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s;
  const abs = path.resolve(s);
  if (existsSync(abs)) {
    const buf = await readFile(abs);
    if (!buf.length) throw new Error(`参考图为空文件：${abs}`);
    return `data:${sniffImageMime(buf)};base64,${buf.toString("base64")}`;
  }
  // 裸 base64（无 data: 前缀、看起来不像路径）：只接受较长的纯 base64 串
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100) {
    return s.replace(/\s+/g, "");
  }
  throw new Error(`参考图无法解析（既不是 data:/URL，也找不到本地文件）：${s}`);
}

// 读风格预设库（单一事实源）。找不到/坏了返回空表，不影响裸 prompt 生图。
async function loadStyles() {
  try {
    const raw = await readFile(STYLES_INDEX, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json.styles) ? json.styles : [];
  } catch {
    return [];
  }
}

async function resolveStyleFragment(styleId) {
  if (!styleId) return "";
  const styles = await loadStyles();
  const hit = styles.find((s) => s.id === styleId);
  if (!hit) {
    const ids = styles.map((s) => s.id).join(", ");
    throw new Error(`未知风格 id=${styleId}。可选：${ids || "(风格库为空)"}`);
  }
  return hit.promptFragment || "";
}

// 把「场景 concept」+「风格片段」+（封面时）护栏拼成最终 prompt。
export function buildPrompt({ prompt, styleFragment = "", coverGuard = false }) {
  const parts = [String(prompt || "").trim()];
  if (styleFragment) parts.push(`Style: ${styleFragment.trim()}`);
  if (coverGuard) parts.push(COVER_GUARD);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * 生一张图并写到本地。返回 { out, bytes }。
 * @param {object} o
 * @param {string} o.prompt      画面/概念描述（必填）
 * @param {string} o.out         输出 jpeg 路径（必填）
 * @param {string} [o.size]      默认 1024x1024；封面用 1536x1024
 * @param {string} [o.quality]   low|medium|high，默认 medium
 * @param {string} [o.styleId]   风格库里的 id，追加其 promptFragment
 * @param {string} [o.styleFragment] 直接给风格片段（优先于 styleId）
 * @param {boolean}[o.coverGuard] 追加封面护栏（封面时置 true）
 * @param {string} [o.referenceImage] 参考图（本地路径 / URL / data: / 裸 base64）。
 *                 提供时走 operation:"edit" 条件化生成，保留参考图里的 IP 形象；不传时文生图，行为不变。
 */
export async function generateImage(o) {
  const { prompt, out } = o;
  if (!prompt || !String(prompt).trim()) throw new Error("generateImage: 缺少 prompt。");
  if (!out) throw new Error("generateImage: 缺少 out 输出路径。");

  const key = process.env.DOUBAOYA_API_KEY;
  if (!key) {
    throw new Error(
      "缺少环境变量 DOUBAOYA_API_KEY（doubaoya 口令，Bearer）。\n" +
        "  该口令只从环境读，绝不入库/打印。用它调 doubaoya 生图接口，扣点数，无需额外密钥。设置后重试：\n" +
        '    export DOUBAOYA_API_KEY="你的doubaoya口令"\n' +
        "  可选：DOUBAOYA_API_BASE（默认 https://doubaoya.com）。"
    );
  }

  const base = (process.env.DOUBAOYA_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  const size = o.size || SIZE_FIGURE;

  const styleFragment =
    o.styleFragment != null ? o.styleFragment : await resolveStyleFragment(o.styleId);
  const finalPrompt = buildPrompt({ prompt, styleFragment, coverGuard: o.coverGuard });

  // 参考图条件化：提供 referenceImage 时走 edit（保留 IP 形象），否则文生图（行为不变）。
  const reqBody = { prompt: finalPrompt, size };
  if (o.referenceImage != null && String(o.referenceImage).trim() !== "") {
    const ref = await resolveReferenceImage(o.referenceImage);
    if (ref) {
      reqBody.operation = "edit";
      reqBody.referenceImage = ref;
    }
  }

  let res;
  try {
    res = await fetch(`${base}${IMAGE_GEN_INVOKE_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    throw new Error(`生图请求发送失败（无法连接 ${base}）：${e.message}`);
  }

  const j = await res.json().catch(() => null);

  if (!res.ok || !j || j.success === false) {
    const err = j && j.error ? `${j.error.code}：${j.error.message}` : `HTTP ${res.status}`;
    throw new Error(`生图失败（doubaoya 口令接口）：${err}`);
  }

  const img0 = j.data && Array.isArray(j.data.images) ? j.data.images[0] : null;
  let bytes;
  if (img0 && img0.b64) {
    bytes = Buffer.from(img0.b64, "base64");
  } else {
    throw new Error("生图返回为空（data.images[0].b64 缺失）。");
  }

  const outAbs = path.resolve(out);
  await writeFile(outAbs, bytes);
  return { out: outAbs, bytes: bytes.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  const BOOL = new Set(["cover-guard", "help"]);
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
    let val;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    if (BOOL.has(key)) {
      out[camel(key)] = true;
      continue;
    }
    if (val === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`参数 --${key} 缺少取值。`);
      }
      val = next;
      i++;
    }
    out[camel(key)] = val;
  }
  return out;
}
function camel(flag) {
  return flag.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

const HELP = `gen-image.mjs — 都爆鸭 · 公众号封面/配图生图

用法:
  node gen-image.mjs --prompt "画面描述" --out <file.jpg> [选项]

必填:
  --prompt <str>     画面/概念描述（可中英混排）
  --out <file>       输出 jpeg 路径

选项:
  --size <WxH>       默认 1024x1024；封面用 1536x1024
  --style <id>       风格库 assets/styles/index.json 里的 id，追加其 promptFragment
  --reference-image <path|url|data:>  IP 参考图；提供时走 edit 条件化生成，保留参考图里的 IP 形象
  --cover-guard      追加封面护栏（把主体压水平中带、上下留白，防 2.35:1 裁切；封面时加）
  --quality <lvl>    low|medium|high，默认 medium
  -h, --help         显示帮助

环境:
  DOUBAOYA_API_KEY   （必填）doubaoya 口令（Bearer），只从环境读，绝不打印/落文件。
                     走口令调 doubaoya 生图接口、扣点数、无需额外密钥（上游密钥只在服务端）。
  DOUBAOYA_API_BASE  （可选）默认 https://doubaoya.com

约 ¥0.30/张。返回后本地路径可直接喂 pipeline.mjs 的 --cover，或以 <img src=本地路径> 放进正文。
`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
  if (args.help || (!args.prompt && !args.out)) {
    process.stdout.write(HELP);
    return;
  }
  if (!args.prompt) {
    process.stderr.write("\n❌ 缺少 --prompt。\n");
    process.exit(1);
  }
  if (!args.out) {
    process.stderr.write("\n❌ 缺少 --out。\n");
    process.exit(1);
  }
  try {
    const t0 = Date.now();
    const { out, bytes } = await generateImage({
      prompt: args.prompt,
      out: args.out,
      size: args.size,
      quality: args.quality,
      styleId: args.style,
      referenceImage: args.referenceImage,
      coverGuard: Boolean(args.coverGuard),
    });
    const kb = (bytes / 1024).toFixed(0);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(`✅ 生图完成 → ${out}（${kb} KB，${secs}s）\n`);
  } catch (e) {
    process.stderr.write(`\n❌ ${e.message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
