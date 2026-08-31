#!/usr/bin/env node
// preprocess-and-publish.selfcheck.mjs —— 本地图片判定/提取（isLocalImageSrc、extractImgSrcs）
// 的可运行自检（零框架 assert）。跑法：node scripts/preprocess-and-publish.selfcheck.mjs
//
// 为什么存在（design.md D10，2026-08-31）：「哪些图是本地的要预上传、哪些是外链不用管」
// 是**确定性分类**，此前由执行层 agent 用例 publish-local-image-scan-dry 覆盖——
// 拿 3 轮沙箱 agent 会话测一个纯函数，贵且抖。下沉后 agent 层不再重复这批判据；
// --dry-run 的 CLI 行为另由 tools/tests/test_publish_scripts.py 钉住。
import assert from "node:assert/strict";
import { extractImgSrcs, isLocalImageSrc } from "./preprocess-and-publish.mjs";

// —— 外链/已托管：不需要预上传 ——
for (const s of [
  "https://cdn.example.com/remote.jpg",
  "http://example.com/a.png",
  "data:image/png;base64,AAAA",
  "https://mmbiz.qpic.cn/mmbiz_png/x",   // 已是公众号图床
]) assert.equal(isLocalImageSrc(s), false, `误判为本地：${s}`);

// —— 本地：必须预上传（服务端读不到本机文件）——
for (const s of [
  "/opt/demo/local-photo.png",
  "./relative.png",
  "../up.png",
  "file:///opt/demo/x.png",
  "bare-relative.png",
]) assert.equal(isLocalImageSrc(s), true, `漏判本地图片：${s}（发布后会变死图）`);

// 空值不炸、不误判
assert.equal(isLocalImageSrc(""), false);
assert.equal(isLocalImageSrc(null), false);

// —— extractImgSrcs：保序、去重、单双引号都认 ——
const html = '<h1>今日推荐</h1><p>正文。</p>' +
  '<img src="https://cdn.example.com/remote.jpg" />' +
  "<img src='/opt/demo/local-photo.png' />" +
  '<img src="https://cdn.example.com/remote.jpg" />';   // 重复
const srcs = extractImgSrcs(html);
assert.deepEqual(srcs, ["https://cdn.example.com/remote.jpg", "/opt/demo/local-photo.png"],
  `提取结果不对：${JSON.stringify(srcs)}`);
assert.deepEqual(srcs.filter(isLocalImageSrc), ["/opt/demo/local-photo.png"],
  "本地/外链分类与提取的组合结果不对");

process.stdout.write("  ✅ preprocess-and-publish（本地图判定/提取） 13/13\n");
