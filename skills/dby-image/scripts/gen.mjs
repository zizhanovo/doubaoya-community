#!/usr/bin/env node
// gen.mjs — 都爆鸭 · 出一张图（文生图 / 图生图）
// -----------------------------------------------------------------------------
// 这个脚本存在的理由：生图这条路上有一串「不写代码就得用文字反复叮嘱」的坑。
// 每一条在这里都做成了代码，于是调用方**物理上犯不了**，SKILL.md 也就不必再教：
//
//   · 客户端超时必须 > 服务端 240s        → 内置 300s，不读默认值
//   · 超时之后绝不重试（重试=付两次钱）   → 全脚本零重试逻辑，超时即退出并说明
//   · 返回是内联 base64，不是图片 URL     → 内置解码落盘
//   · 扩展名要按 mime 定，不能写死        → 文生图 jpeg / 改图 png，按 mime 落
//   · `n` 按份数计费却只回一张            → 不暴露该参数，传不进去
//   · `size`/`background`/`outputFormat`/`modelName` 是死参数 → 同上，不发送
//   · 参考图上限 3 张，超了服务端静默丢弃  → 超限直接报错，让用户自己挑
//   · 本地图片要转 data: URI 才能当参考图  → 自动识别路径并读盘编码
//   · 比例只能靠 prompt，且必须核实        → 出图后从字节里量真实宽高并打印
//
// env:
//   DOUBAOYA_API_KEY  （必填）doubaoya 密钥。**绝不打印、绝不落文件。**
//   DOUBAOYA_BASE_URL （可选）默认 https://doubaoya.com
//
// 零依赖（Node ≥18 内置 fetch）。
//
// 用法:
//   node scripts/gen.mjs "一只鸭子在写稿，宽幅横版 16:9 比例"
//   node scripts/gen.mjs "把围巾换成黄色，其余保持不变" --ref ./old.jpg
//   node scripts/gen.mjs "把左边的狗放进右边的场景" --ref a.png --ref b.png
//   node scripts/gen.mjs --describe          # 拉生产实时契约，与本包的认知对账
// -----------------------------------------------------------------------------

import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

const BASE = process.env.DOUBAOYA_BASE_URL || "https://doubaoya.com";
const KEY = process.env.DOUBAOYA_API_KEY;
const SLUG = "gpt-image-gen";

// 服务端处理上限 240s。客户端必须**大于**它：服务端超时会退款，客户端提前放弃不会。
const TIMEOUT_MS = 300_000;
const MAX_REFS = 3;

// 本包认为在架的入参字段。--describe 拿它跟生产实时契约对账；对不上就是本包过期了。
const EXPECTED_FIELDS = [
  "background", "imageUrl", "images", "modelName", "n",
  "operation", "outputFormat", "prompt", "quality", "referenceImage", "size"
];

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function sniffMime(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}

/** 从字节里量真实宽高。比例只能靠 prompt 控制，所以出图后必须核实，不能靠目测。 */
function measure(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m))
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } else if (buf.subarray(0, 8).toString("binary") === "\x89PNG\r\n\x1a\n") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  return { w: null, h: null };
}

/** 参考图归一：data:/http(s) 原样；本地路径读盘转 data:；裸 base64 去空白。 */
async function resolveRef(ref) {
  const s = String(ref).trim();
  if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s)) return s;
  const abs = path.resolve(s);
  if (existsSync(abs)) {
    const buf = await readFile(abs);
    if (!buf.length) die(`参考图是空文件：${abs}`);
    const mime = sniffMime(buf);
    if (!mime) die(`参考图不是 png/jpeg/webp（按字节判定，改扩展名没用）：${abs}`);
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100)
    return s.replace(/\s+/g, "");
  die(`参考图无法解析（不是 data:/URL，也找不到本地文件）：${s}`);
}

async function describe() {
  const r = await fetch(`${BASE}/api/skills/${SLUG}`, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(30_000)
  });
  const j = await r.json();
  if (!j.success) die(`拉契约失败：${JSON.stringify(j.error)}`);
  const props = j.data?.inputContract?.jsonSchema?.properties || {};
  const live = Object.keys(props).sort();
  const expected = [...EXPECTED_FIELDS].sort();
  console.log(`单价 ${j.data.unitPrice} 点／次   必填 ${JSON.stringify(j.data.inputContract.jsonSchema.required)}`);
  console.log(`生产字段(${live.length})：${live.join(" ")}`);
  const added = live.filter((k) => !expected.includes(k));
  const gone = expected.filter((k) => !live.includes(k));
  if (!added.length && !gone.length) return console.log("✅ 与本包认知一致");
  console.log(`🔴 对不上 —— 以生产为准，并去改 references/api-contract.md：`);
  if (added.length) console.log(`   生产多出：${added.join(" ")}`);
  if (gone.length) console.log(`   生产没有：${gone.join(" ")}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  if (!KEY) die("缺 DOUBAOYA_API_KEY。去 doubaoya.com → 密钥中心生成，export 后再跑。");
  if (argv.includes("--describe")) return describe();

  const refs = [];
  let out = null;
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ref") refs.push(argv[++i]);
    else if (argv[i] === "--out") out = argv[++i];
    else words.push(argv[i]);
  }
  const prompt = words.join(" ").trim();
  if (!prompt) die('用法：node scripts/gen.mjs "画面描述" [--ref 图] [--out 文件]');

  if (refs.length > MAX_REFS)
    die(`参考图 ${refs.length} 张，超过上限 ${MAX_REFS} 张。\n` +
        `服务端会静默丢掉多余的 —— 请让用户自己挑保留哪 ${MAX_REFS} 张，别替他选。`);

  // 只发这两个字段。其余入参要么无效（size）、要么是死参数
  // （background/outputFormat/modelName）、要么会按份数计费却只回一张（n）。
  const body = { prompt };
  if (refs.length === 1) body.referenceImage = await resolveRef(refs[0]);
  else if (refs.length > 1) body.images = await Promise.all(refs.map(resolveRef));

  console.error(`出图中…（通常 1–2 分钟，最长 4 分钟，别打断）${refs.length ? ` 参考图 ${refs.length} 张` : ""}`);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}/api/skills/${SLUG}/invoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    // 🔴 这里**故意没有重试**。服务端超时会退款，客户端放弃不会 ——
    //    重试就是为同一张图付两次钱。
    die(`请求未完成（${((Date.now() - t0) / 1000) | 0}s）：${e.message}\n` +
        `🔴 不要重试。这次可能已经扣费、图可能已经生成。如实告诉用户，由他决定是否再来一次。`);
  }

  const j = await res.json();
  if (!j.success) {
    const { code, message } = j.error || {};
    const hint = {
      INSUFFICIENT_CREDITS: "点数不足。让用户到 doubaoya.com 账户页查看余额与点数获取方式。不要重试。",
      CAPABILITY_UNAVAILABLE: "能力不可用。不要重试，如实告知用户。"
    }[code] || "看 message 改入参。";
    die(`失败 [${res.status} ${code}] ${message}\n${hint}`);
  }

  // 🔴「你安装的 skill 有更新」。服务端按 User-Agent 判，挂在**成功**信封上。
  // 读它不是可选的：SKILL.md 承诺「原样转达给用户」，而这条链断过两次 ——
  // 2026-08-21 实测服务端三条专用路由压根没挂（主仓 0563fa5 改成钩子统一注入），
  // 下游 dby-publish 17 个脚本读它 0 次（社区仓 3537e22 补上）。
  // 挂了没人读 == 没挂。走 stderr，免得污染 stdout 的 JSON（样板：dby-api/scripts/doubaoya.mjs）。
  if (j.notice) console.error(`[notice] ${j.notice}`);

  const img = (j.data?.images || [])[0];
  if (!img?.b64) die("调用成功但没有图像数据。如实告诉用户拿不到图，别编一个地址。");

  const buf = Buffer.from(img.b64, "base64");
  const ext = { "image/jpeg": "jpg", "image/png": "png" }[img.mime] || "png";
  const file = out || `doubaoya-image.${ext}`;

  // 🔴 落盘失败也不能让 buf 随进程蒸发：此时费已经扣了（上面 j.success 已确认），
  //    图像数据只在内存里，SKILL.md 的红线又不许重试——用户会停在这一步什么都拿不到。
  //    先兜底写到 tmpdir，再报错，让用户至少能去捡。
  try {
    await writeFile(file, buf);
  } catch (e) {
    const fallback = path.join(os.tmpdir(), `doubaoya-image-${Date.now()}.${ext}`);
    try {
      await writeFile(fallback, buf);
      die(`落盘失败：${file} —— ${e.message}\n` +
          `🔴 这次已经扣费，图已经生成，别重试。已兜底写到：${fallback}\n` +
          `去把它捡回来（或换个能写的路径用 --out 重新指定）。`);
    } catch (e2) {
      die(`落盘失败：${file} —— ${e.message}\n` +
          `兜底写入 ${fallback} 也失败：${e2.message}\n` +
          `🔴 这次已扣费但图没能保住，图像数据已随进程退出丢失，没有文件可捡。如实告诉用户。`);
    }
  }

  const { w, h } = measure(buf);
  const ratio = w && h ? (w / h).toFixed(3) : "?";
  console.log(`${path.resolve(file)}`);
  console.error(`✅ ${(buf.length / 1024) | 0}KB  实测 ${w}x${h}  比例 ${ratio}  耗时 ${((Date.now() - t0) / 1000) | 0}s`);
  console.error(`下一步：读回这张图做验收（references/visual-review.md），别直接交付。`);
}

main().catch((e) => die(`未预期的错误：${e.stack || e.message}`));
