#!/usr/bin/env node
// gen-image.mjs — 都爆鸭 · 公众号封面/配图 AI 生图（走密钥调 doubaoya 生图接口）
// -----------------------------------------------------------------------------
// 把一段 prompt 交给 doubaoya.com 的生图密钥接口（**同步**返回，单张 10–60s），
// 拿回一张 jpeg 存到本地。密钥只在 doubaoya 服务端，skill 端只需密钥（DOUBAOYA_API_KEY），
// 每张扣点数（生图属高价档，比数据类能力贵一个量级；实时价看详情端点的点数字段，
// 别照这里的注释算钱）。封面和正文配图共用它；比例只靠 --cover-guard / prompt 控制，
// --size 无效（见 SIZE_COVER 上方注释）。产出的本地 jpeg 路径可以直接：
//   * 作为封面喂给 pipeline.mjs 的 --cover（走 thumb 上传）；
//   * 或以 <img src="本地路径"> 落进 Markdown/HTML 正文，由 preprocess-and-publish.mjs
//     走 image 上传——**不改动任何发布链路契约**。
//
// 生图契约（doubaoya 密钥接口，密钥只在服务端）：
//   POST {DOUBAOYA_API_BASE}/api/skills/gpt-image-gen/invoke   （默认 https://doubaoya.com）
//   Authorization: Bearer $DOUBAOYA_API_KEY   （skill 发布本就用的这枚密钥）
//   body: { prompt, size }
//   resp: { success, data: { images: [{ b64, mime }] } }（b64 无 data: 前缀）
//   说明：上游生图密钥、model、background/n 等都收在 doubaoya 服务端，skill 端不再接触。
//
// env:
//   DOUBAOYA_API_KEY  （必填）doubaoya 密钥（Bearer）。缺失时报清晰错误，不崩栈。绝不打印、绝不落文件。
//   DOUBAOYA_API_BASE （可选）默认 https://doubaoya.com
//
// 零依赖（Node ≥18 内置 fetch）。
//
// 用法（CLI）:
//   node gen-image.mjs --prompt "画面描述…" --out cover.jpg --cover-guard
//   node gen-image.mjs --prompt "画面描述…" --out fig1.jpg --style flat-illustration
//
// 用法（import）:
//   import { generateImage, COVER_GUARD, buildPrompt } from "./gen-image.mjs";
//   await generateImage({ prompt, out:"cover.jpg", styleId:"magazine-editorial", coverGuard:true });
// -----------------------------------------------------------------------------

import { writeFile, readFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
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
// 🔴 这里的 "Aspect ratio" 那一句是**唯一真正在控制画面比例的东西**——`size` 参数无效（见下方注释）。
// 去掉它，封面会退回默认的 1254x1254 正方形，再被微信按 2.35:1 裁掉上下大半。
export const COVER_GUARD =
  "Aspect ratio: wide landscape, 16:9. " +
  "Composition: keep the main subject and any text within the central horizontal band; " +
  "leave calm atmospheric background at the top and bottom edges. The image will be " +
  "center-cropped to a wide 2.35:1 banner, so nothing important should touch the top or bottom edge.";

// 🔴 `size` **完全无效**，上游整个忽略它。2026-08-21 受控实测（固定同一句 prompt、只变 size）：
//   不传 / 1024x1024 / 1536x1024 / 1024x1536 / 512x512 / 2048x1152 —— **七个用例全部返回 1254x1254**。
//   （更早那次「竖版精确、横版不准」是实验设计错误：当时 prompt 和 size 一起变了，
//     而 prompt 里写着「竖直的高塔、仰视构图」——是 prompt 在驱动比例。）
//
// 真正管用的是**提示词**。同样不传 size，只在描述里给比例：
//   「宽幅横版，16:9 比例」→ 1672x941（1.777）；「竖版，9:16 比例」→ 941x1672（0.563）。
//
// ⇒ 所以 COVER_GUARD 里那句比例要求**才是封面能用的唯一原因**，SIZE_COVER 一直是死参数。
// ⇒ 下面两个常量保留只为兼容既有调用签名，**不影响输出**；真要固定比例请写进 prompt。
// ponytail: 天花板 = 上游哪天开始认 size 了，这里的注释会过期；
//   升级路径 = 出图后核实宽高（generateImage 已在做），不符时打一句 warn。
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
 * @param {string} [o.size]      兼容保留，上游忽略；比例只靠 coverGuard / prompt
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
      "缺少环境变量 DOUBAOYA_API_KEY（doubaoya 密钥，Bearer）。\n" +
        "  该密钥只从环境读，绝不入库/打印。用它调 doubaoya 生图接口，扣点数，无需额外密钥。设置后重试：\n" +
        '    export DOUBAOYA_API_KEY="你的doubaoya密钥"\n' +
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

  // 🔴 客户端超时必须**显式设置**，且必须大于服务端 240 秒的处理上限。
  //
  // 这里原本一个超时都没设，靠运行时的隐式默认值恰好比 240 秒大才没出事——那是运气不是契约。
  // 运行时升级、换个部署环境、或有人加一句「保险起见」的短超时，它就掉到 240 秒以下了。
  // 而失败形态**不会报错**：服务端超时会退款，客户端提前放弃**不会**——请求照样在服务端
  // 跑完、照样扣费，调用方只看到一句「超时」。用户付了钱、图生成了、我们说超时。
  // 这种缺陷不报错，只烧钱，所以宁可写死也不依赖默认值。
  //
  // 超时之后**不重试**：重试等于为同一张图付两次钱。
  const IMAGE_GEN_TIMEOUT_MS = 300_000; // 服务端上限 240s + 60s 余量
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_GEN_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${base}${IMAGE_GEN_INVOKE_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
      signal: ac.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(
        `生图超时（等了 ${IMAGE_GEN_TIMEOUT_MS / 1000} 秒，服务端上限 240 秒）。` +
          `🔴 别自动重试：服务端可能已经出图并扣费，重试就是为同一张图付两次钱。` +
          `要不要再来一次，让用户决定。`,
      );
    }
    throw new Error(`生图请求发送失败（无法连接 ${base}）：${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const j = await res.json().catch(() => null);

  if (!res.ok || !j || j.success === false) {
    const err = j && j.error ? `${j.error.code}：${j.error.message}` : `HTTP ${res.status}`;
    throw new Error(`生图失败（doubaoya 密钥接口）：${err}`);
  }

  // 🔴「你安装的 skill 有更新」原样转达（SKILL.md 的承诺）。走 stderr，stdout 留给 JSON。
  //    这条链 2026-08-21 断过三处，每处都是静默的 —— 挂了没人读 == 没挂。
  //    闸：tools/tests/test_notice_is_consumed.py；样板：dby-api/scripts/doubaoya.mjs
  if (j.notice) console.error(`[notice] ${j.notice}`);

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
  --style <id>       风格库 assets/styles/index.json 里的 id，追加其 promptFragment
  --reference-image <path|url|data:>  IP 参考图；提供时走 edit 条件化生成，保留参考图里的 IP 形象
  --cover-guard      追加封面护栏（写入 16:9 宽幅 + 主体压水平中带、上下留白，防 2.35:1 裁切；封面时加）
                     比例只靠它 / prompt 控制，--size 上游忽略（参数保留仅为兼容）
  --quality <lvl>    low|medium|high，默认 medium
  -h, --help         显示帮助

环境:
  DOUBAOYA_API_KEY   （必填）doubaoya 密钥（Bearer），只从环境读，绝不打印/落文件。
                     走密钥调 doubaoya 生图接口、扣点数、无需额外密钥（上游密钥只在服务端）。
  DOUBAOYA_API_BASE  （可选）默认 https://doubaoya.com

每张扣点数（属高价档；实时价见详情端点）。返回后本地路径可直接喂 pipeline.mjs 的 --cover，或以 <img src=本地路径> 放进正文。
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
  main();
}
