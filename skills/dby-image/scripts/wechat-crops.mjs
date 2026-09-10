#!/usr/bin/env node
// 公众号封面裁切模拟：微信不吃第二张图，只从同一张 thumb 上按 2.35:1（消息列表）与正中 1:1
// （历史消息 / 转发卡片）各裁一次；消息列表里又只是 ~360px 宽的小图。
// 本脚本把这三种「读者实际看到的样子」落成文件，供验收时读回来核（不联网、不计费、零依赖）。
//
//   node scripts/wechat-crops.mjs ./cover.jpg
//   → ./cover.crop-235.jpg   消息列表视角（2.35:1，取正中）
//   → ./cover.crop-1x1.jpg   转发卡片视角（从 2.35:1 结果再取正中 1:1）
//   → ./cover.thumb360.jpg   列表缩略图视角（2.35:1 结果缩到 360px 宽）
//
// 依据：draft/add 的 cover_info 只认 2.35_1 / 1_1 两种 ratio，且 dby-publish 目前不传裁切坐标，
// 所以微信取的一定是正中；「主体进居中正方形」是否成立，看 crop-1x1 那张即可，不用目测原图。
// ponytail: 只用 macOS 自带 sips 写文件；没有 sips 时退化为只打印裁切像素坐标（Linux 装 ImageMagick 后可自行 -crop）。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const src = process.argv[2];
if (!src) die("用法：node scripts/wechat-crops.mjs <封面文件>");
if (!existsSync(src)) die(`文件不存在：${src}`);

const { w, h } = readSize(src);
// 2.35:1 正中
const w235 = w / h >= 2.35 ? Math.round(h * 2.35) : w;
const h235 = w / h >= 2.35 ? h : Math.round(w / 2.35);
const x235 = Math.floor((w - w235) / 2), y235 = Math.floor((h - h235) / 2);
// 1:1 正中（在 2.35:1 结果之内）
const s = Math.min(w235, h235);
const x1 = x235 + Math.floor((w235 - s) / 2), y1 = y235 + Math.floor((h235 - s) / 2);

console.error(`原图 ${w}x${h}  比例 ${(w / h).toFixed(3)}`);
console.error(`2.35:1 裁区  x=${x235} y=${y235} w=${w235} h=${h235}（上下各去 ${y235}px）`);
console.error(`1:1   裁区  x=${x1} y=${y1} w=${s} h=${s}（左右各去 ${x1}px；主体与标题必须都在这块里）`);

if (!hasSips()) {
  console.error("未找到 sips（非 macOS），只给坐标；用 ImageMagick 自行 -crop 后再读图验收。");
  process.exit(0);
}

const ext = extname(src), stem = join(dirname(src), basename(src, ext));
const out235 = `${stem}.crop-235${ext}`, out1x1 = `${stem}.crop-1x1${ext}`, outThumb = `${stem}.thumb360${ext}`;
sips(["-c", String(h235), String(w235), "--cropOffset", String(y235), String(x235), src, "--out", out235]);
sips(["-c", String(s), String(s), "--cropOffset", String(y1 - y235), String(x1 - x235), out235, "--out", out1x1]);
sips(["--resampleWidth", "360", out235, "--out", outThumb]);
// stdout 只有路径，便于管道；下一步是把这三张读回来对照核对表
for (const f of [out235, out1x1, outThumb]) console.log(f);

function readSize(f) {
  if (hasSips()) {
    const o = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f], { encoding: "utf8" });
    const w = +(/pixelWidth:\s*(\d+)/.exec(o) || [])[1], h = +(/pixelHeight:\s*(\d+)/.exec(o) || [])[1];
    if (w && h) return { w, h };
  }
  die("读不到宽高：需要 macOS sips；其他平台请手动传入或安装 ImageMagick");
}
function hasSips() { try { execFileSync("sips", ["--help"], { stdio: "ignore" }); return true; } catch { return false; } }
function sips(args) { execFileSync("sips", args, { stdio: ["ignore", "ignore", "inherit"] }); }
function die(m) { console.error(m); process.exit(2); }
