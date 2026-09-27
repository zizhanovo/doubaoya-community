// image.mjs — `dby image gen|edit|plan|crops`（dby-cli-rebuild design D4：生图改走子命令）。
//
// gen/edit 自 skills/dby-image/scripts/gen.mjs 搬入，那份脚本把生图路上的坑全做成了代码，这里逐条保留：
//   · 客户端超时 > 服务端 240s → INVOKE_TIMEOUT_MS(450s)；
//   · 超时绝不重试（重试 = 为同一张图付两次钱）→ 本命令与请求层都零重试；
//   · 返回是内联 base64 → 解码落盘，扩展名按信封 mime 定；
//   · `n` 按份数计费却只回一张、size/background/outputFormat 是死参数 → 不暴露、不发送；
//   · modelName 是真参数 → --model，本地白名单先挡拼错的名字；
//   · 参考图上限 3 张 → 超限直接 USAGE，让用户自己挑；本地图片自动转 data: URI；
//   · 比例只能靠 prompt → 出图后从字节里量真实宽高回报；
//   · 落盘失败先兜底写 tmpdir 再报错（费已扣、不许重试，图不能随进程蒸发）。
// 与 1.x 的差异：计费调用套确认协议（`image gen` 与 `api invoke` 同路，登记为 composite），
//   不带 --confirm 停在 confirmation_required（退出码 6），一个请求都不发。
// plan/crops 是本地命令（kind=local）：plan 只出配图方案不改文件；crops 用 macOS sips 落出封面三种裁切视角。

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { request, INVOKE_TIMEOUT_MS } from "../http.mjs";
import { billable } from "../confirm.mjs";
import { getKey } from "../context.mjs";
import { planFigures } from "../plan-figures-core.mjs";

const SLUG = "gpt-image-gen";
const MAX_REFS = 3;
// 可选模型：调用方的选择，不传就用服务端默认。选择指引见 dby-image 的 references/api-contract.md。
export const IMAGE_MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"];

const usage = (msg) => new DbyError("USAGE", msg, { exit: EXIT.USAGE });

export function sniffMime(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}

/** 从字节里量真实宽高（比例只能靠 prompt 控制，出图后必须核实）。 */
export function measure(buf) {
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
    if (!buf.length) throw usage(`参考图是空文件：${abs}`);
    const mime = sniffMime(buf);
    if (!mime) throw usage(`参考图不是 png/jpeg/webp（按字节判定，改扩展名没用）：${abs}`);
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100) return s.replace(/\s+/g, "");
  throw usage(`参考图无法解析（不是 data:/URL，也找不到本地文件）：${s}`);
}

const INVOKE_HINTS = {
  INSUFFICIENT_CREDITS: "点数不足。让用户到 doubaoya.com 账户页查看余额与点数获取方式。不要重试。",
  CAPABILITY_UNAVAILABLE: "能力不可用。不要重试，如实告知用户。",
  TIMEOUT: "🔴 不要重试。这次可能已经扣费、图可能已经生成。如实告诉用户，由他决定是否再来一次。"
};

export async function imageGen(ctx, { words, refs = [], out, model, requireRef = false }) {
  const prompt = (words ?? []).join(" ").trim();
  if (!prompt) throw usage('需要画面描述：dby image gen "画面描述" [--ref 图] [--out 文件] [--model 模型]');
  if (requireRef && refs.length === 0) throw usage("image edit 至少要一张 --ref 参考图（要文生图用 image gen）。");
  if (model && !IMAGE_MODELS.includes(model)) {
    throw usage(`不支持的模型 ${model}。可选：${IMAGE_MODELS.join(" / ")}。不确定就别传——默认那档适合大多数请求。`);
  }
  if (refs.length > MAX_REFS) {
    throw usage(`参考图 ${refs.length} 张，超过上限 ${MAX_REFS} 张。请让用户自己挑保留哪 ${MAX_REFS} 张，别替他选。`);
  }
  getKey(ctx); // 早失败：没 key 不进确认、不读参考图

  // 只发这几个字段。其余入参要么无效（size）、要么是死参数、要么按份数计费却只回一张（n）。
  const body = { prompt };
  if (model) body.modelName = model;
  if (refs.length === 1) body.referenceImage = await resolveRef(refs[0]);
  else if (refs.length > 1) body.images = await Promise.all(refs.map(resolveRef));

  billable(ctx, [
    {
      action: refs.length ? "改图（图生图）" : "出图（文生图）",
      ref: `skill.ai.imageGen（/api/skills/${SLUG}/invoke）`,
      title: prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt,
      price: "按模型计价（dby api describe gpt-image-gen 看单价）",
      method: "POST",
      path: `/api/skills/${SLUG}/invoke`
    }
  ]);

  process.stderr.write(
    `出图中…（通常 1–2 分钟，最长 4 分钟，别打断、别重试）${refs.length ? ` 参考图 ${refs.length} 张` : ""}${model ? ` 模型 ${model}` : ""}\n`
  );
  const t0 = Date.now();
  let env;
  try {
    // 🔴 故意没有重试：服务端超时会退款，客户端放弃不会——重试就是为同一张图付两次钱。
    env = await request(ctx, "POST", `/api/skills/${SLUG}/invoke`, {
      body,
      timeoutMs: INVOKE_TIMEOUT_MS,
      billable: true,
      withEnvelope: true
    });
  } catch (e) {
    if (e instanceof DbyError && INVOKE_HINTS[e.code]) e.remediation = INVOKE_HINTS[e.code];
    throw e;
  }
  const img = (env.data?.images || [])[0];
  if (!img?.b64) {
    throw new DbyError("NO_IMAGE_DATA", "调用成功但没有图像数据。", {
      exit: EXIT.BUSINESS,
      remediation: "如实告诉用户这次拿不到图，别编一个地址；是否再试由用户决定（可能已扣费）。"
    });
  }
  const buf = Buffer.from(img.b64, "base64");
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[img.mime] || "png";
  const file = path.resolve(out || `doubaoya-image.${ext}`);
  try {
    await writeFile(file, buf);
  } catch (e) {
    // 🔴 费已扣、图只在内存里、又不许重试：先兜底写 tmpdir，再报错让用户去捡。
    const fallback = path.join(os.tmpdir(), `doubaoya-image-${Date.now()}.${ext}`);
    let saved = null;
    try {
      await writeFile(fallback, buf);
      saved = fallback;
    } catch {
      saved = null;
    }
    const err = new DbyError("WRITE_FAILED", `落盘失败：${file} —— ${e.message}`, {
      exit: EXIT.GENERAL,
      remediation: saved
        ? `🔴 这次已经扣费、图已经生成，别重试。已兜底写到：${saved}，去把它捡回来（或换个能写的路径用 --out 重新指定）。`
        : "🔴 这次已扣费但图没能保住（兜底写入也失败），图像数据已随进程退出丢失。如实告诉用户。"
    });
    err.data = { fallbackFile: saved };
    throw err;
  }
  const { w, h } = measure(buf);
  const data = {
    file,
    bytes: buf.length,
    mime: img.mime ?? null,
    width: w,
    height: h,
    ratio: w && h ? Number((w / h).toFixed(3)) : null,
    elapsedMs: Date.now() - t0,
    // 🔴 AI 生成内容的法定显式标识：交付这张图时必须转达给用户（请求层已 warn 一份到 stderr）。
    aigcLabel: env.aigc?.generated && env.aigc?.label ? env.aigc.label : null
  };
  const human = [
    file,
    `✅ ${(buf.length / 1024) | 0}KB  实测 ${w}x${h}  比例 ${data.ratio ?? "?"}  耗时 ${(data.elapsedMs / 1000) | 0}s`,
    ...(data.aigcLabel ? [`🏷  ${data.aigcLabel} —— 交付这张图时把这句转达给用户。`] : []),
    "下一步：读回这张图做验收（dby-image 的 references/visual-review.md），别直接交付。"
  ].join("\n");
  return { data, human };
}

export async function imagePlan(ctx, { md, maxFigures, minChars }) {
  if (!md) throw usage("需要 --md <文章.md>。");
  let markdown;
  try {
    markdown = await readFile(path.resolve(md), "utf8");
  } catch (e) {
    throw usage(`读不到 Markdown：${path.resolve(md)}（${e.message}）`);
  }
  const opts = {};
  if (maxFigures != null) opts.maxFigures = Number(maxFigures);
  if (minChars != null) opts.minChars = Number(minChars);
  const plan = planFigures(markdown, opts);
  const { figures, meta } = plan;
  const lines = [
    `🦆 配图自动布局方案 — ${path.basename(md)}`,
    `   小节数 ${meta.sectionCount} · 正文总字数 ${meta.totalBodyChars} · 有资格 ${meta.eligibleCount} · 上限 ${meta.maxFigures} · 阈值 ${meta.minChars} 字`
  ];
  if (!figures.length) lines.push("   （没有达到阈值的小节，本文不自动配图。）");
  figures.forEach((f, i) => lines.push(`   ${i + 1}. [h2 末尾] 《${f.anchor.value}》（${f.chars} 字）`, `      画面：${f.prompt}`));
  return { data: plan, human: lines.join("\n") };
}

function hasSips() {
  try {
    execFileSync("sips", ["--help"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function imageCrops(ctx, { file }) {
  if (!existsSync(file)) throw usage(`文件不存在：${file}`);
  if (!hasSips()) {
    throw new DbyError("SIPS_UNAVAILABLE", "读宽高与裁切需要 macOS 自带的 sips，本机没有。", {
      exit: EXIT.BUSINESS,
      remediation: "非 macOS 请用 ImageMagick 按 2.35:1 正中与其中正中 1:1 自行 -crop，再读图验收。"
    });
  }
  const o = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  const w = +(/pixelWidth:\s*(\d+)/.exec(o) || [])[1];
  const h = +(/pixelHeight:\s*(\d+)/.exec(o) || [])[1];
  if (!w || !h) throw new DbyError("SIZE_UNREADABLE", `读不到 ${file} 的宽高。`, { exit: EXIT.BUSINESS });
  const w235 = w / h >= 2.35 ? Math.round(h * 2.35) : w;
  const h235 = w / h >= 2.35 ? h : Math.round(w / 2.35);
  const x235 = Math.floor((w - w235) / 2);
  const y235 = Math.floor((h - h235) / 2);
  const s = Math.min(w235, h235);
  const x1 = x235 + Math.floor((w235 - s) / 2);
  const y1 = y235 + Math.floor((h235 - s) / 2);
  const ext = path.extname(file);
  const stem = path.join(path.dirname(file), path.basename(file, ext));
  const out235 = `${stem}.crop-235${ext}`;
  const out1x1 = `${stem}.crop-1x1${ext}`;
  const outThumb = `${stem}.thumb360${ext}`;
  const sips = (args) => execFileSync("sips", args, { stdio: ["ignore", "ignore", "inherit"] });
  sips(["-c", String(h235), String(w235), "--cropOffset", String(y235), String(x235), file, "--out", out235]);
  sips(["-c", String(s), String(s), "--cropOffset", String(y1 - y235), String(x1 - x235), out235, "--out", out1x1]);
  sips(["--resampleWidth", "360", out235, "--out", outThumb]);
  const data = {
    source: { file: path.resolve(file), width: w, height: h },
    crop235: { file: path.resolve(out235), x: x235, y: y235, width: w235, height: h235 },
    crop1x1: { file: path.resolve(out1x1), x: x1, y: y1, width: s, height: s },
    thumb360: { file: path.resolve(outThumb) }
  };
  return { data, human: [out235, out1x1, outThumb].join("\n") };
}

const genFlags = {
  ref: { value: true, multiple: true, summary: "参考图（本地文件 / URL / data:），最多 3 张" },
  out: { value: true, summary: "输出文件（默认 doubaoya-image.<按 mime>）" },
  model: { value: true, summary: `模型：${IMAGE_MODELS.join(" / ")}（不传用服务端默认）` }
};
const genRoutes = [{ method: "POST", path: "/api/skills/:slug/invoke" }];

export const commands = [
  {
    group: "image", name: "gen", kind: "composite",
    summary: "出一张图（文生图；带 --ref 即图生图）。慢操作 1–4 分钟，超时绝不重试；计费，--confirm 放行",
    args: [{ name: "prompt", required: true, variadic: true }],
    flags: genFlags,
    routes: genRoutes,
    billable: true, destructive: false, composite: true,
    run: (ctx, { args, flags }) => imageGen(ctx, { words: args.prompt, refs: flags.ref ?? [], out: flags.out, model: flags.model })
  },
  {
    group: "image", name: "edit", aliasOf: "image gen", // = gen 且至少一张 --ref；同一条路由

    summary: "改图：在参考图基础上改（至少一张 --ref）。慢操作、计费，--confirm 放行",
    args: [{ name: "prompt", required: true, variadic: true }],
    flags: genFlags,
    routes: genRoutes,
    billable: true, destructive: false, composite: true,
    run: (ctx, { args, flags }) =>
      imageGen(ctx, { words: args.prompt, refs: flags.ref ?? [], out: flags.out, model: flags.model, requireRef: true })
  },
  {
    group: "image", name: "plan", kind: "local",
    summary: "配图位置规划：按 h2 小节字数确定性地给出在哪配图、画面建议（不改文件、不联网）",
    args: [],
    flags: {
      md: { value: true, summary: "文章 Markdown（必填）" },
      "max-figures": { value: true, summary: "张数上限（缺省按总字数分档 3/4/5）" },
      "min-chars": { value: true, summary: "小节最少有效字数才配图（默认 160）" }
    },
    routes: [],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => imagePlan(ctx, flags)
  },
  {
    group: "image", name: "crops", kind: "local",
    summary: "公众号封面裁切模拟：落出 2.35:1、正中 1:1、360px 缩略三张供验收（macOS sips，不联网）",
    args: [{ name: "file", required: true }],
    flags: {},
    routes: [],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args }) => imageCrops(ctx, { file: args.file })
  }
];
