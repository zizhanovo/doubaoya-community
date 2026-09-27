#!/usr/bin/env node
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
//   node preprocess-and-publish.mjs --html a.html --title "标题" --draft cmtk_xxx [--draft-version 2]
//     # 正文来自网页审稿过的稿件时带上 --draft <稿件 id>：存草稿箱成功后服务端自动把稿件
//     # 关联到发布出来的文章记录；--draft-version 指定发布稿件第几版，省略 = 最新版，
//     # 必须搭配 --draft 一起用。带了 --draft 但不属于调用者 → 422 VALIDATION_ERROR（不扣点）。
//
// 鉴权 / 环境:
//   DOUBAOYA_API_KEY   密钥（形如 dyh_…），必填。绝不打印、绝不写文件。
//   DOUBAOYA_BASE_URL  基址，默认 https://doubaoya.com

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs, { realpathSync } from "node:fs";
import { checkDraftLimits } from "./lib/draft-limits.mjs";
import { importDbyLib } from "./lib/locate-dby.mjs";

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
// HTTP：转手给 dby-api 的公共请求层（规格 dby-cli-coverage「仓内只有一份请求层」）。
// 鉴权头 / 超时 / 信封解析 / notice 转达全部收在 skills/dby-api/scripts/lib/http.mjs，
// 本文件不再自己拼 fetch、不再自己解析信封。
//
// ponytail：原先这里会带一条 skillUserAgent() 头（服务端凭包名+哈希判断「有没有新版本」），
// 共享请求层目前不发 User-Agent —— 经它转发的请求暂时失去这条更新提醒信号。
// 升级路径 = dby-api 的 lib/http.mjs 补发 UA（那份文件不在本次改动范围内，见
// openspec/changes/dby-cli-unification 任务 4.2 的包边界）。
async function apiRequest(ctx, method, apiPath, payload, { billable = false } = {}) {
  const { request } = await importDbyLib(import.meta.url, "http.mjs");
  try {
    const opts = { billable };
    if (payload !== undefined) opts.body = payload;
    const data = await request(ctx, method, apiPath, opts);
    return { ok: true, data: data || {} };
  } catch (e) {
    // DbyError 的 code/message 已经涵盖旧格式（含鉴权失败时「缺 key / key 无效」的措辞），
    // 调用点原样按 `${r.code}: ${r.message}` 拼接；本文件的退出码统一走 die()（固定 1），不变。
    return { ok: false, code: e.code || "ERROR", message: e.message || String(e) };
  }
}

// ---------------------------------------------------------------------------
// 上传一个本地文件到公众号图床
// ---------------------------------------------------------------------------
async function uploadLocal(ctx, appid, filePath, purpose) {
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
  const r = await apiRequest(ctx, "POST", "/api/wechat/media/upload", payload, { billable: true });
  if (!r.ok) {
    die(`上传失败（${purpose}）${path.basename(filePath)} → ${r.code}: ${r.message}`);
  }
  return r.data; // image: { url }; thumb: { mediaId, url }
}

// ---------------------------------------------------------------------------
// 解析 appid（复用 status 接口）
// ---------------------------------------------------------------------------
async function resolveAppid(ctx, wanted) {
  const r = await apiRequest(ctx, "GET", "/api/wechat/status");
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

  // ---- dry-run：只报告扫描结果，不上传/不发布/不需要密钥 ----
  if (args.dryRun) {
    process.stdout.write("扫描结果：\n");
    for (const s of allSrcs) {
      process.stdout.write(`  ${isLocalImageSrc(s) ? "[本地→需预上传]" : "[外链→原样保留]"} ${s}\n`);
    }
    process.stdout.write(`\n共 ${allSrcs.length} 张图，其中本地 ${localSrcs.length} 张需要预上传。\n`);
    if (args.cover && args.cover !== true) {
      process.stdout.write(`封面：${args.cover}（${isLocalImageSrc(args.cover) ? "本地→purpose=thumb 预上传" : "外链/已是图床"}）\n`);
    }
    const draftId = args.draft && args.draft !== true ? args.draft : null;
    if (draftId) {
      const draftVersion = args["draft-version"] && args["draft-version"] !== true ? args["draft-version"] : null;
      process.stdout.write(`draftId: "${draftId}"${draftVersion ? `, draftVersion: ${draftVersion}` : "（省略 = 最新版）"}\n`);
    }
    return;
  }

  // ---- 正式流程：需要密钥 ----
  const title = args.title;
  if (!title || title === true) die("缺少 --title <标题>");
  // 微信 draft/add 字段上限：花钱传图之前先拦（正文长度按上传前的 HTML 估，改写 src 后只会更短或相当）
  {
    const lim = checkDraftLimits({ title, digest: args.digest && args.digest !== true ? args.digest : undefined, contentHtml: html });
    for (const w of lim.warnings) process.stderr.write(`[warn] ${w}\n`);
    if (lim.errors.length) die("VALIDATION_ERROR: " + lim.errors.join(" "));
  }

  // 稿件面：正文来自网页审稿过的稿件时带 --draft <稿件 id>，服务端会把稿件自动关联到
  // 发布出来的文章记录。--draft-version 只在带了 --draft 时才有意义（省略 = 稿件最新版）。
  const draftId = args.draft && args.draft !== true ? args.draft : undefined;
  let draftVersion;
  if (args["draft-version"] && args["draft-version"] !== true) {
    if (!draftId) die("VALIDATION_ERROR: --draft-version 必须搭配 --draft <稿件 id> 一起用。");
    draftVersion = Number(args["draft-version"]);
    if (!Number.isInteger(draftVersion) || draftVersion <= 0) {
      die(`VALIDATION_ERROR: --draft-version 必须是正整数，收到「${args["draft-version"]}」。`);
    }
  }

  const { makeContext } = await importDbyLib(import.meta.url, "context.mjs");
  const ctx = makeContext({ env: process.env });
  if (!ctx.key) {
    die(
      "缺少环境变量 DOUBAOYA_API_KEY。\n" +
        "请前往 doubaoya.com → 登录 → 密钥中心 → 生成密钥，然后:\n" +
        '  export DOUBAOYA_API_KEY="dyh_你的密钥"'
    );
  }

  const { appid, nickname } = await resolveAppid(ctx, args.appid && args.appid !== true ? args.appid : undefined);

  // 逐张预上传本地正文图片，改写 HTML
  let rewritten = html;
  for (const src of localSrcs) {
    const filePath = resolveLocalPath(src, htmlDir);
    if (!fs.existsSync(filePath)) {
      die(`FILE_ERROR: 正文里引用的本地图片不存在：${src} → ${filePath}`);
    }
    process.stderr.write(`[info] 上传正文图片：${src}\n`);
    const { url } = await uploadLocal(ctx, appid, filePath, "image");
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
      const data = await uploadLocal(ctx, appid, coverPath, "thumb");
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
  if (draftId) payload.draftId = draftId;
  if (draftVersion) payload.draftVersion = draftVersion;

  const r = await apiRequest(ctx, "POST", "/api/wechat/publish", payload, { billable: true });
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
  main().catch((e) => die(e && e.stack ? e.stack : String(e)));
}
