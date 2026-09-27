// pipeline.mjs — `dby wechat pipeline`：md → 平台渲染 → 本地图预上传 → 封面 → 存草稿箱（composite）。
//
// dby-cli-rebuild design D4：1.x 的 skills/dby-publish/scripts/pipeline.mjs 与 preprocess-and-publish.mjs
// **原样搬家**到 ../pipeline/，语义与 1.x 相同、不新增恢复能力；本文件只是 CLI 外壳：
//   · 参数由命令表解析（未知 flag 一律 USAGE——任何群发意图的参数天然进不来）；
//   · 真发布（非 --dry-run / --render-only）套确认协议：不带 --confirm 停在 confirmation_required（退出码 6），
//     一个请求都不发；--dry-run 就是「发布前彩排」；
//   · 以子进程跑搬家后的 pipeline.mjs，它的人读日志在 JSON 模式下转到 stderr（stdout 只留信封），
//     TTY 人类模式下原样打到 stdout；结束后从日志里取 mediaId / HTML 路径 / 在线预览链接组成 data。
// 后续由 dby-article-run 把它并入 `wechat publish` 并删除本命令。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, DbyError } from "../errors.mjs";
import { billable } from "../confirm.mjs";

const PIPELINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pipeline", "pipeline.mjs");

const VALUE_FLAGS = ["md", "html", "title", "account", "appid", "cover", "digest", "config", "profile", "theme", "output-processed-html", "draft", "draft-version"];

const camel = (f) => f.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** 从流水线的人读回报里抠结构化结果（回报格式见 ../pipeline/pipeline.mjs 的三种横幅）。 */
export function parsePipelineReport(out) {
  const pick = (re) => (out.match(re) || [])[1] ?? null;
  const mode = /RENDER-ONLY 回报/.test(out)
    ? "render-only"
    : /DRY-RUN 回报/.test(out)
      ? "dry-run"
      : /已存入公众号草稿箱/.test(out)
        ? "published"
        : /结果待确认/.test(out)
          ? "unconfirmed"
          : null;
  return {
    mode,
    mediaId: pick(/mediaId:\s+(\S+)/),
    htmlPath: pick(/已渲染公众号内联样式 HTML → (\S.*)$/m) ?? pick(/HTML:\s+(\S.*)$/m) ?? pick(/直接使用已排版 HTML: (\S.*)$/m),
    detailUrl: pick(/在线预览[^:：]*[:：]\s+(https?:\/\/\S+)/),
    appid: pick(/公众号:\s+.*（(wx[^）]+)）/),
    localImages: Number(pick(/正文图上传数: (\d+)/) ?? pick(/待预上传本地图: (\d+)/)) || 0
  };
}

function runPipeline(argv, { env, toStdout }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PIPELINE, ...argv], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      const s = b.toString();
      out += s;
      (toStdout ? process.stdout : process.stderr).write(s);
    });
    child.stderr.on("data", (b) => {
      const s = b.toString();
      err += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: 1, out, err: `${err}${e.message}` }));
  });
}

export async function wechatPipeline(ctx, flags) {
  if (!flags.md && !flags.html) throw new DbyError("USAGE", "必须指定 --md <文件> 或 --html <文件> 其一。", { exit: EXIT.USAGE });
  if (flags.md && flags.html) throw new DbyError("USAGE", "--md 与 --html 只能二选一。", { exit: EXIT.USAGE });
  if (!flags.title) throw new DbyError("USAGE", "缺少 --title <标题>。", { exit: EXIT.USAGE });
  if (flags.dryRun && flags.renderOnly) throw new DbyError("USAGE", "--dry-run 与 --render-only 只能二选一。", { exit: EXIT.USAGE });

  // 真发布写入用户公众号后台并计费：套确认协议（与 `wechat publish` 同一条纪律）。
  if (!flags.dryRun && !flags.renderOnly) {
    billable(ctx, [
      {
        action: "渲染并存入公众号草稿箱（含本地图预上传与封面上传）",
        title: flags.title,
        price: "按公众号发布计价（渲染免费）",
        method: "POST",
        path: "/api/wechat/publish"
      }
    ]);
  }

  const argv = [];
  for (const f of VALUE_FLAGS) {
    const v = flags[camel(f)];
    if (v !== undefined) argv.push(`--${f}`, String(v));
  }
  if (flags.dryRun) argv.push("--dry-run");
  if (flags.renderOnly) argv.push("--render-only");

  const env = { ...process.env, DOUBAOYA_BASE_URL: ctx.baseUrl };
  const { code, out, err } = await runPipeline(argv, { env, toStdout: !ctx.json });
  const report = parsePipelineReport(out);
  if (code !== 0) {
    const last = (err.match(/❌ ([^\n]+)/g) || []).pop()?.replace(/^❌ /, "") ?? `流水线退出码 ${code}`;
    const e = new DbyError("PIPELINE_FAILED", last, {
      exit: EXIT.GENERAL,
      remediation:
        report.mode === "unconfirmed"
          ? "草稿可能已存入也可能没有：先去公众号后台草稿箱按标题核对，别直接重跑（draft/add 不幂等）。"
          : "看 stderr 里流水线的逐步日志定位是哪一步停下的；渲染与校验阶段失败不会产生任何发布副作用。"
    });
    e.data = report;
    throw e;
  }
  return { data: report, human: "" }; // 人类模式下流水线自己的回报已经原样打到 stdout
}

export const commands = [
  {
    group: "wechat", name: "pipeline", kind: "composite",
    summary: "公众号图文流水线：md → 平台渲染 → 本地图预上传 → 封面 → 存草稿箱（只存草稿绝不群发；真发布要 --confirm）",
    args: [],
    flags: {
      md: { value: true, summary: "Markdown 文件（与 --html 二选一）" },
      html: { value: true, summary: "已排好版的公众号 HTML（与 --md 二选一，跳过渲染）" },
      title: { value: true, summary: "文章标题（必填）" },
      account: { value: true, summary: "目标 doubaoya 账号（本机两层凭证对应不同账号时用它挑）" },
      appid: { value: true, summary: "目标公众号 authorizerAppid（绑定多个时指定）" },
      cover: { value: true, summary: "本地封面图；不传走都爆鸭兜底封面" },
      digest: { value: true, summary: "摘要" },
      config: { value: true, summary: "配置文件（默认 ./config.json）" },
      profile: { value: true, summary: "IP/身份 profile" },
      theme: { value: true, summary: "服务端主题 id，或自定义主题 JSON 路径（交服务端校验）" },
      "output-processed-html": { value: true, summary: "渲染出的 HTML 落地路径" },
      draft: { value: true, summary: "稿件 id（存草稿成功后自动关联稿件）" },
      "draft-version": { value: true, summary: "稿件第几版（须搭配 --draft）" },
      "dry-run": { summary: "发布前彩排：渲染+账号校验+扫描本地图，不发布" },
      "render-only": { summary: "只渲染：产出 HTML 与在线预览链接，不需要绑定公众号" }
    },
    routes: [
      { method: "GET", path: "/api/agent/whoami" },
      { method: "GET", path: "/api/skills" },
      { method: "GET", path: "/api/wechat/status" },
      { method: "POST", path: "/api/wechat/render" },
      { method: "POST", path: "/api/wechat/media/upload" },
      { method: "POST", path: "/api/wechat/publish" }
    ],
    billable: true, destructive: false, composite: true,
    run: (ctx, { flags }) => wechatPipeline(ctx, flags)
  }
];
