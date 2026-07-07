#!/usr/bin/env node
// VENDORED from the `wechat-draft-publish` skill (scripts/preprocess-and-publish.mjs) — keep the two copies in sync.
// 都爆鸭 · 公众号草稿发布（含本地图片预处理）
//
// 服务端的 POST /api/wechat/publish 会自动把正文里的**外链图片**（http(s)/mmbiz）
// 搬运到公众号图床，但它**读不到你本机的文件**。所以当正文 HTML 里含有本地图片
// （<img src="/Users/.../x.png"> 之类）或本地封面时，必须由**客户端**先把这些本地
// 图片上传，拿回 mmbiz 图床地址，改写 HTML 后再发布。本脚本做的就是这件事：
//
//   1. 扫描 contentHtml 里所有 <img src="X">，挑出**本地**图片
//      （非 http(s)://、非 data:、非 mmbiz.qpic.cn / mmbiz.qlogo.cn）。
//   2. 逐张读文件 → base64 → POST /api/wechat/media/upload (purpose="image")
//      → 拿回 { url } → 把 HTML 里该 src 的**所有**出现替换成这个 mmbiz url。
//   3. 若指定了本地封面 → POST /api/wechat/media/upload (purpose="thumb")
//      → 拿回 { mediaId } 作为 thumbMediaId。
//   4. POST /api/wechat/publish，正文用改写后的 HTML（此时图片都是 mmbiz 外链，
//      服务端的搬运逻辑会原样放过）。
//
// 微信限制：正文图片 ≤ 1MB。超限的本机图片会先被**压缩/缩放**再上传
//   （优先用 sharp，没有则回退到 macOS 的 sips）。
//
// 零依赖（只用 Node 内置模块 + 全局 fetch，需 Node ≥ 18；sharp 为可选依赖）。
//
// 用法:
//   node preprocess-and-publish.mjs --html article.html --title "标题"
//   node preprocess-and-publish.mjs --html a.html --title "标题" --cover cover.png
//   node preprocess-and-publish.mjs --html a.html --title "标题" --appid wx123 --digest "摘要"
//   node preprocess-and-publish.mjs --html a.html --title "标题" --dry-run   # 只扫描本地图，不上传/不发布
//
// 鉴权 / 环境:
//   DOUBAOYA_API_KEY   口令（形如 dyh_…），必填。绝不打印、绝不写文件。
//   DOUBAOYA_BASE_URL  基址，默认 https://doubaoya.com

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const BASE_URL = (process.env.DOUBAOYA_BASE_URL || "https://doubaoya.com").replace(/\/+$/, "");
const STATUS_ENDPOINT = BASE_URL + "/api/wechat/status";
const UPLOAD_ENDPOINT = BASE_URL + "/api/wechat/media/upload";
const PUBLISH_ENDPOINT = BASE_URL + "/api/wechat/publish";

const ONE_MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write("[error] " + msg + "\n");
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 本地图片判定（导出以便单测 / dry-run 复用）
// ---------------------------------------------------------------------------
// 返回 true 表示这是一个需要客户端预上传的**本地**图片 src。
export function isLocalImageSrc(src) {
  if (!src) return false;
  const s = src.trim();
  if (/^https?:\/\//i.test(s)) return false;           // 外链 http(s)
  if (/^data:/i.test(s)) return false;                 // 内联 data URI
  if (/(^|\/\/|\.)mmbiz\.(qpic|qlogo)\.cn/i.test(s)) return false; // 已是公众号图床
  // 其余都当作本地：绝对路径 /、./ ../ 相对、file://、Windows 盘符、裸相对路径
  return true;
}

// 从 contentHtml 抽出所有 <img src="X"> 的唯一 src（保序）。
export function extractImgSrcs(html) {
  const re = /<img\b[^>]*?\bsrc\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = m[2];
    if (!seen.has(src)) {
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

// 把 src（可能是 file://、绝对路径、相对路径）解析成一个本地文件系统路径。
// 相对路径相对 htmlDir 解析。
function resolveLocalPath(src, htmlDir) {
  const s = src.trim();
  if (/^file:\/\//i.test(s)) {
    return fileURLToPath(s);
  }
  if (path.isAbsolute(s)) return s;
  return path.resolve(htmlDir, s);
}

// ---------------------------------------------------------------------------
// 压缩：超过 1MB 的图片先缩放/转码到 1MB 以内
// ---------------------------------------------------------------------------
async function ensureUnderLimit(buf, srcPath) {
  if (buf.length <= ONE_MB) {
    return { buf, filename: path.basename(srcPath) };
  }
  process.stderr.write(
    `[info] ${path.basename(srcPath)} 为 ${(buf.length / ONE_MB).toFixed(2)}MB，超过公众号 1MB 上限，正在压缩…\n`
  );

  // 优先 sharp（若已安装）
  try {
    const { default: sharp } = await import("sharp");
    let quality = 72;
    let width = 1600;
    for (let attempt = 0; attempt < 5; attempt++) {
      const out = await sharp(buf)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      if (out.length <= ONE_MB) {
        return { buf: out, filename: swapExt(srcPath, ".jpg") };
      }
      quality = Math.max(40, quality - 12);
      width = Math.max(800, Math.round(width * 0.85));
    }
    process.stderr.write("[warn] sharp 压缩多轮后仍略大，按最后一轮结果上传。\n");
    const out = await sharp(buf).resize({ width: 800 }).jpeg({ quality: 40 }).toBuffer();
    return { buf: out, filename: swapExt(srcPath, ".jpg") };
  } catch (err) {
    if (err && err.code !== "ERR_MODULE_NOT_FOUND" && err.code !== "MODULE_NOT_FOUND") {
      process.stderr.write(`[warn] sharp 压缩失败（${err.message}），尝试回退 sips…\n`);
    }
  }

  // 回退：macOS 的 sips
  const sipsBuf = compressWithSips(buf, srcPath);
  if (sipsBuf) {
    if (sipsBuf.length > ONE_MB) {
      process.stderr.write("[warn] sips 压缩后仍 > 1MB，仍尝试上传（服务端可能拒绝）。\n");
    }
    return { buf: sipsBuf, filename: swapExt(srcPath, ".jpg") };
  }

  die(
    `图片 ${path.basename(srcPath)} 超过 1MB 且无法压缩：未安装 sharp，且本机没有可用的 sips。\n` +
      `请先手动压缩，例如 macOS: sips -Z 1600 --setProperty formatOptions 70 in.png --out out.jpg`
  );
}

function swapExt(p, ext) {
  const base = path.basename(p, path.extname(p));
  return base + ext;
}

function compressWithSips(buf, srcPath) {
  // sips 只在 macOS 上存在；用临时文件走一遍。
  const which = spawnSync("which", ["sips"]);
  if (which.status !== 0) return null;
  const inPath = path.join(tmpdir(), `dyh-in-${Date.now()}-${path.basename(srcPath)}`);
  const outPath = path.join(tmpdir(), `dyh-out-${Date.now()}.jpg`);
  try {
    fs.writeFileSync(inPath, buf);
    const r = spawnSync("sips", [
      "-Z", "1600",
      "--setProperty", "format", "jpeg",
      "--setProperty", "formatOptions", "70",
      inPath,
      "--out", outPath,
    ]);
    if (r.status !== 0) {
      process.stderr.write(`[warn] sips 退出码 ${r.status}: ${r.stderr}\n`);
      return null;
    }
    return fs.readFileSync(outPath);
  } catch (e) {
    process.stderr.write(`[warn] sips 执行异常：${e.message}\n`);
    return null;
  } finally {
    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  }
}

// ---------------------------------------------------------------------------
// HTTP 封套：统一鉴权头 + 结构化信封解析
// ---------------------------------------------------------------------------
async function apiRequest(url, apiKey, method, payload) {
  const headers = {
    Authorization: "Bearer " + apiKey,
    "User-Agent": "doubaoya-skill/1.0",
  };
  const init = { method, headers };
  if (payload !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(payload);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return { ok: false, code: "NETWORK_ERROR", message: `无法连接 ${BASE_URL}（${e.message}）` };
  }

  let text = "";
  try { text = await res.text(); } catch {}

  let env;
  try { env = JSON.parse(text); } catch {
    return { ok: false, code: `HTTP_${res.status}`, message: text || res.statusText || "服务端返回非 JSON 内容" };
  }

  if (env.success !== true) {
    const err = env.error || {};
    return { ok: false, code: err.code || `HTTP_${res.status}`, message: err.message || "请求未成功" };
  }
  return { ok: true, data: env.data || {} };
}

// ---------------------------------------------------------------------------
// 上传一个本地文件到公众号图床
// ---------------------------------------------------------------------------
async function uploadLocal(apiKey, appid, filePath, purpose) {
  let raw;
  try {
    raw = await readFile(filePath);
  } catch (e) {
    die(`FILE_ERROR: 读不到图片文件 ${filePath}（${e.message}）`);
  }
  const { buf, filename } = await ensureUnderLimit(raw, filePath);
  const payload = {
    authorizerAppid: appid,
    dataBase64: buf.toString("base64"),
    filename,
    purpose,
  };
  const r = await apiRequest(UPLOAD_ENDPOINT, apiKey, "POST", payload);
  if (!r.ok) {
    die(`上传失败（${purpose}）${path.basename(filePath)} → ${r.code}: ${r.message}`);
  }
  return r.data; // image: { url }; thumb: { mediaId, url }
}

// ---------------------------------------------------------------------------
// 解析 appid（复用 status 接口）
// ---------------------------------------------------------------------------
async function resolveAppid(apiKey, wanted) {
  const r = await apiRequest(STATUS_ENDPOINT, apiKey, "GET");
  if (!r.ok) die(`${r.code}: ${r.message}`);
  const accounts = r.data.accounts || [];

  if (wanted) {
    const hit = accounts.find((a) => a.authorizerAppid === wanted);
    return { appid: wanted, nickname: hit ? hit.nickname || "" : "" };
  }
  if (accounts.length === 1) {
    const a = accounts[0];
    process.stderr.write(`[info] 已自动选用唯一绑定的公众号：${a.nickname || ""}（${a.authorizerAppid}）\n`);
    return { appid: a.authorizerAppid, nickname: a.nickname || "" };
  }
  if (accounts.length === 0) {
    die("NO_ACCOUNT: 没有已绑定的公众号。请先去 doubaoya.com → 公众号 页面绑定，再回来发草稿。");
  }
  process.stderr.write("[error] MULTIPLE_ACCOUNTS: 你绑定了多个公众号，请用 --appid 指定其一：\n");
  for (const a of accounts) {
    process.stderr.write(`  - ${a.nickname || "(未命名)"}  (authorizerAppid: ${a.authorizerAppid})\n`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const htmlPath = args.html || args["content-file"];
  if (!htmlPath || htmlPath === true) die("缺少 --html <正文 HTML 文件路径>");

  let html;
  try {
    html = await readFile(htmlPath, "utf-8");
  } catch (e) {
    die(`FILE_ERROR: 读不到正文文件 ${htmlPath}（${e.message}）`);
  }
  const htmlDir = path.dirname(path.resolve(htmlPath));

  // 扫描本地图片
  const allSrcs = extractImgSrcs(html);
  const localSrcs = allSrcs.filter(isLocalImageSrc);

  // ---- dry-run：只报告扫描结果，不上传/不发布/不需要口令 ----
  if (args.dryRun) {
    process.stdout.write("扫描结果：\n");
    for (const s of allSrcs) {
      process.stdout.write(`  ${isLocalImageSrc(s) ? "[本地→需预上传]" : "[外链→原样保留]"} ${s}\n`);
    }
    process.stdout.write(`\n共 ${allSrcs.length} 张图，其中本地 ${localSrcs.length} 张需要预上传。\n`);
    if (args.cover && args.cover !== true) {
      process.stdout.write(`封面：${args.cover}（${isLocalImageSrc(args.cover) ? "本地→purpose=thumb 预上传" : "外链/已是图床"}）\n`);
    }
    return;
  }

  // ---- 正式流程：需要口令 ----
  const title = args.title;
  if (!title || title === true) die("缺少 --title <标题>");

  const apiKey = process.env.DOUBAOYA_API_KEY;
  if (!apiKey) {
    die(
      "缺少环境变量 DOUBAOYA_API_KEY。\n" +
        "请前往 doubaoya.com → 登录 → 口令中心 → 生成口令，然后:\n" +
        '  export DOUBAOYA_API_KEY="dyh_你的口令"'
    );
  }

  const { appid, nickname } = await resolveAppid(apiKey, args.appid && args.appid !== true ? args.appid : undefined);

  // 逐张预上传本地正文图片，改写 HTML
  let rewritten = html;
  for (const src of localSrcs) {
    const filePath = resolveLocalPath(src, htmlDir);
    if (!fs.existsSync(filePath)) {
      die(`FILE_ERROR: 正文里引用的本地图片不存在：${src} → ${filePath}`);
    }
    process.stderr.write(`[info] 上传正文图片：${src}\n`);
    const { url } = await uploadLocal(apiKey, appid, filePath, "image");
    if (!url) die(`上传返回缺少 url：${src}`);
    rewritten = rewritten.split(src).join(url); // 替换该 src 的所有出现
    process.stderr.write(`[info]   → ${url}\n`);
  }

  // 本地封面 → thumbMediaId
  let thumbMediaId;
  const coverArg = args.cover && args.cover !== true ? args.cover : undefined;
  if (coverArg) {
    if (isLocalImageSrc(coverArg)) {
      const coverPath = resolveLocalPath(coverArg, process.cwd());
      if (!fs.existsSync(coverPath)) die(`FILE_ERROR: 封面文件不存在：${coverArg}`);
      process.stderr.write(`[info] 上传封面（thumb）：${coverArg}\n`);
      const data = await uploadLocal(apiKey, appid, coverPath, "thumb");
      thumbMediaId = data.mediaId;
      if (!thumbMediaId) die("封面上传返回缺少 mediaId");
      process.stderr.write(`[info]   → thumbMediaId=${thumbMediaId}\n`);
    } else {
      process.stderr.write(`[warn] --cover 看起来不是本地文件（${coverArg}），已忽略；如需外链封面请自行处理。\n`);
    }
  }

  // 发布草稿
  const payload = { authorizerAppid: appid, title, contentHtml: rewritten };
  if (thumbMediaId) payload.thumbMediaId = thumbMediaId;
  if (args.digest && args.digest !== true) payload.digest = args.digest;

  const r = await apiRequest(PUBLISH_ENDPOINT, apiKey, "POST", payload);
  if (!r.ok) die(`${r.code}: ${r.message}`);

  const mediaId = r.data.mediaId || "";
  process.stdout.write(
    "已存入公众号草稿箱，去公众号后台确认后手动群发。\n" +
      `  公众号：${nickname || "(已绑定公众号)"}（${appid}）\n` +
      `  标题：${title}\n` +
      `  预上传本地图片：${localSrcs.length} 张${thumbMediaId ? "（含封面）" : ""}\n` +
      `  mediaId：${mediaId}\n`
  );
}

// 仅作为脚本运行时执行 main；被 import 时只暴露纯函数（便于单测）。
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => die(e && e.stack ? e.stack : String(e)));
}
