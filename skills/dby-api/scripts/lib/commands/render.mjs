// render.mjs — `dby render` / `dby preview`（spec skill-thin-layer「排版只有服务端一个事实源」，design D6）。
//
// 两条都调服务端渲染路由 POST /api/wechat/render（按目录定价免费），**只写文件**：
//   · render：HTML 写到 --out（默认与输入同目录的 <名>.wechat.html），JSON 只回路径、字节数、sha256、
//     在线预览链接与告警——stdout 里不回灌 HTML（文件进、文件出）。
//   · preview：在 render 基础上再写一个本地 375px 宽的包裹页（<名>.preview.html），双击就能在浏览器里看手机宽度效果。
// 没有凭证 → 退出码 4（remediation 指向 dby login）；服务端不可达 → 退出码 5「离线不能渲染」；
// 🔴 两种情况都**不**退回任何本地渲染，也不生成 HTML 文件——本机渲染器不随 npm 包分发。
// 与 `wechat render`（1:1 映射路由、JSON 里带 HTML）并存：那条是 route 类，本两条登记为 composite，
// 保证「每条路由至多一条 route 类子命令」。

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { getKey } from "../context.mjs";

const usage = (msg) => new DbyError("USAGE", msg, { exit: EXIT.USAGE });

async function readText(file, label) {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    throw usage(`读不了${label}（${file}）：${e.message}`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** 375px 手机宽度包裹页：正文原样嵌进一个固定宽度的白底容器，不引任何外部资源。 */
export function previewPage({ title, html, detailUrl }) {
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)} · 公众号预览（375px）</title>`,
    "<style>body{margin:0;background:#ededed;font-family:-apple-system,BlinkMacSystemFont,sans-serif}",
    ".phone{width:375px;margin:24px auto;background:#fff;min-height:100vh;box-shadow:0 0 0 1px #ddd}",
    ".bar{width:375px;margin:0 auto;padding:8px 0;font-size:12px;color:#666}</style></head><body>",
    `<div class="bar">本地预览（375px 手机宽度）${detailUrl ? ` · <a href="${escapeHtml(detailUrl)}">在线预览</a>` : ""}</div>`,
    `<div class="phone">${html}</div>`,
    "</body></html>",
    ""
  ].join("\n");
}

async function renderToFile(ctx, flags, { withPreview }) {
  if (!flags.file) throw usage("需要 --file <markdown 文件>。");
  if (flags.theme && flags.themeFile) throw usage("--theme 与 --theme-file 只能给一个。");
  const markdown = await readText(flags.file, " markdown 文件");
  const body = { markdown };
  if (flags.title) body.title = flags.title;
  if (flags.theme) body.themeId = flags.theme;
  if (flags.themeFile) {
    const raw = await readText(flags.themeFile, "主题 JSON 文件");
    try {
      body.themeJson = JSON.parse(raw);
    } catch (e) {
      throw usage(`${flags.themeFile} 不是合法 JSON：${e.message}`);
    }
  }
  getKey(ctx); // 没凭证：退出码 4，一个请求都不发，也不生成任何文件

  let env;
  try {
    env = await request(ctx, "POST", "/api/wechat/render", { body, withEnvelope: true });
  } catch (e) {
    if (e instanceof DbyError && e.exit === EXIT.NETWORK) {
      e.message = `离线不能渲染：${e.message}`;
      e.remediation = `${e.remediation ?? ""} 排版只在服务端做（本机没有渲染器），联网后重跑。`.trim();
    }
    throw e;
  }
  const html = env.data?.html;
  if (typeof html !== "string" || html.trim() === "") {
    throw new DbyError("EMPTY_RENDER", "服务端渲染返回了空 HTML。", { exit: EXIT.GENERAL });
  }
  const input = path.resolve(flags.file);
  const stem = path.join(path.dirname(input), path.basename(input, path.extname(input)));
  const htmlFile = path.resolve(flags.out ?? `${stem}.wechat.html`);
  await writeFile(htmlFile, html, "utf8");
  const data = {
    htmlFile,
    bytes: Buffer.byteLength(html, "utf8"),
    sha256: createHash("sha256").update(html).digest("hex"),
    detailUrl: env.detailUrl ?? null,
    themeSource: typeof env.data?.themeSource === "string" ? env.data.themeSource : null,
    warnings: Array.isArray(env.data?.warnings) ? env.data.warnings : []
  };
  if (withPreview) {
    const previewFile = path.resolve(flags.previewOut ?? `${stem}.preview.html`);
    await writeFile(previewFile, previewPage({ title: flags.title ?? path.basename(input), html, detailUrl: data.detailUrl }), "utf8");
    data.previewFile = previewFile;
  }
  const human = [
    `HTML：${htmlFile}（${data.bytes} 字节）`,
    ...(data.previewFile ? [`本地预览（375px）：${data.previewFile}`] : []),
    ...(data.detailUrl ? [`在线预览：${data.detailUrl}`] : []),
    ...data.warnings.map((w) => `⚠️ ${typeof w === "string" ? w : JSON.stringify(w)}`)
  ].join("\n");
  return { data, human };
}

const flags = {
  file: { value: true, summary: "必填：待排版的 markdown 文件" },
  theme: { value: true, summary: "服务端主题 id（不传用你在排版工作室保存的默认排版）" },
  "theme-file": { value: true, summary: "整套主题 JSON 文件（交服务端校验并渲染；自定义主题预览用它）" },
  title: { value: true, summary: "文章标题" },
  out: { value: true, summary: "HTML 输出路径（默认 <输入名>.wechat.html）" }
};
const routes = [{ method: "POST", path: "/api/wechat/render" }];

export const commands = [
  {
    group: null, name: "render", kind: "composite",
    summary: "服务端排版：markdown → 公众号 HTML 文件（免费；只写文件，JSON 不含 HTML；离线退出码 5，无凭证退出码 4）",
    args: [], flags, routes,
    billable: false, destructive: false, composite: true,
    run: (ctx, a) => renderToFile(ctx, a.flags, { withPreview: false })
  },
  {
    group: null, name: "preview", kind: "composite",
    summary: "render 之外再写一个本地 375px 手机宽度预览页（免费；不回退任何本地渲染）",
    args: [],
    flags: { ...flags, "preview-out": { value: true, summary: "预览页输出路径（默认 <输入名>.preview.html）" } },
    routes,
    billable: false, destructive: false, composite: true,
    run: (ctx, a) => renderToFile(ctx, a.flags, { withPreview: true })
  }
];
