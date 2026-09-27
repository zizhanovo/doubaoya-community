// wechat.mjs — `dby wechat status|render|writing-spec|topics|review|publish|media-upload|
// theme-list|theme-get|theme-add|theme-update|theme-rm`（迁移/新增，design: dby-cli-unification
// 任务 3.5）。对接主仓 apps/api/src/modules/wechat/{routes,render-routes,review-routes,
// topics-routes}.ts；除 publish/media-upload 外全部免费、不进 catalog、不扣点。
//
// publish 与 media-upload 会往用户自己的公众号后台写东西（存草稿箱 / 传素材），属于
// spec「副作用命令走确认协议」里「写入用户公众号后台」那一类：标 billable:true，本地校验
// 通过后仍要 `billable(ctx, changes)` 走一遍确认协议，`--confirm` 才放行。
// theme-rm 是硬删，destructive:true，同 profile.mjs 的 delete 一个形状。
// argv.mjs 只支持两级子命令，主题相关命令因此用连字符名（theme-list/theme-get/…），
// 不再拆出第三级。

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { request } from "../http.mjs";
import { billable } from "../confirm.mjs";

// 微信 draft/add 官方字段上限（花钱传图 / 写草稿箱之前先本地拦）。口径与阈值同
// skills/dby-publish/scripts/lib/draft-limits.mjs（该文件属于 dby-publish 包，dby-api 不能
// 跨包 import——skill 各自独立安装，见 dby.mjs 入口守卫注释同一条纪律），只留硬错的那三条，
// 32~64 字的软警告不在这里重复。
// ponytail：两处常量分别维护，值改了要两边一起改；升级路径 = 有第三个包也要用时再抽公共 lib。
const TITLE_MAX = 64;
const DIGEST_MAX = 120;
const CONTENT_CHARS_MAX = 20000;
const CONTENT_BYTES_MAX = 1024 * 1024;
const codePointLen = (s) => Array.from(String(s)).length;

/** 发布前的本地硬闸：任何一条不过，不发送任何请求，直接 USAGE(2)。 */
function precheckPublishBody({ title, digest, contentHtml }) {
  const errors = [];
  const titleLen = codePointLen(title);
  if (titleLen > TITLE_MAX) errors.push(`标题 ${titleLen} 字，超过公众号上限 ${TITLE_MAX} 字符。`);
  if (digest != null) {
    const digestLen = codePointLen(digest);
    if (digestLen > DIGEST_MAX) errors.push(`摘要 ${digestLen} 字，超过公众号上限 ${DIGEST_MAX} 字（不填则默认抓正文前 54 字）。`);
  }
  const contentLen = codePointLen(contentHtml);
  const contentBytes = Buffer.byteLength(String(contentHtml), "utf8");
  if (contentLen >= CONTENT_CHARS_MAX) errors.push(`正文 ${contentLen} 字符，公众号要求少于 ${CONTENT_CHARS_MAX} 字符。`);
  if (contentBytes >= CONTENT_BYTES_MAX) errors.push(`正文 ${(contentBytes / 1024 / 1024).toFixed(2)}MB，公众号要求小于 1MB。`);
  return errors;
}

/** theme-add/theme-update 用：JSON 载荷，--body 与 --file 二选一（同 profile.mjs 的 readJsonBody）。 */
async function readJsonBody(flags) {
  const hasBody = flags.body !== undefined;
  const hasFile = flags.file !== undefined;
  if (hasBody && hasFile) {
    throw new DbyError("USAGE", "--body 与 --file 只能给一个。", { exit: EXIT.USAGE });
  }
  if (!hasBody && !hasFile) {
    throw new DbyError("USAGE", "需要 --body '<json>' 或 --file <path> 之一。", { exit: EXIT.USAGE });
  }
  const raw = hasFile ? await readFile(flags.file, "utf8") : flags.body;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new DbyError("USAGE", `入参不是合法 JSON：${e.message}`, { exit: EXIT.USAGE });
  }
}

async function readFileOrUsage(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    throw new DbyError("USAGE", `读不了 ${label}（${path}）：${e.message}`, { exit: EXIT.USAGE });
  }
}

export async function wechatStatus(ctx) {
  const data = await request(ctx, "GET", "/api/wechat/status", {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatRender(ctx, flags) {
  if (!flags.file) throw new DbyError("USAGE", "render 需要 --file <markdown 文件路径>。", { exit: EXIT.USAGE });
  const markdown = await readFileOrUsage(flags.file, "markdown 文件");
  const body = { markdown };
  if (flags.title) body.title = flags.title;
  if (flags.themeId) body.themeId = flags.themeId;
  if (flags.themeName) body.themeName = flags.themeName;
  if (flags.themeFile) {
    const raw = await readFileOrUsage(flags.themeFile, "主题 JSON 文件");
    try {
      body.themeJson = JSON.parse(raw);
    } catch (e) {
      throw new DbyError("USAGE", `${flags.themeFile} 不是合法 JSON：${e.message}`, { exit: EXIT.USAGE });
    }
  }
  // 免费路由，走 http.mjs 的默认超时（60s）——与旧 preprocess-and-publish.mjs 同档。
  const data = await request(ctx, "POST", "/api/wechat/render", { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatWritingSpec(ctx, flags) {
  const q = new URLSearchParams();
  if (flags.themeName) q.set("themeName", flags.themeName);
  if (flags.section) q.set("section", flags.section);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/wechat/writing-spec${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatTopics(ctx, flags) {
  const q = new URLSearchParams();
  if (flags.keyword) q.set("keyword", flags.keyword);
  if (flags.niche) q.set("niche", flags.niche);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/wechat/topics${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatReview(ctx, flags) {
  const q = new URLSearchParams();
  if (flags.appid) q.set("appid", flags.appid);
  const qs = q.toString();
  const data = await request(ctx, "GET", `/api/wechat/review${qs ? `?${qs}` : ""}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatPublish(ctx, flags) {
  if (!flags.appid) throw new DbyError("USAGE", "publish 需要 --appid。", { exit: EXIT.USAGE });
  if (!flags.title) throw new DbyError("USAGE", "publish 需要 --title。", { exit: EXIT.USAGE });
  if (!flags.html) throw new DbyError("USAGE", "publish 需要 --html <正文 HTML 文件路径>。", { exit: EXIT.USAGE });
  if (flags.draftVersion !== undefined && !flags.draft) {
    throw new DbyError("USAGE", "--draft-version 必须搭配 --draft <稿件 id> 一起用。", { exit: EXIT.USAGE });
  }
  const contentHtml = await readFileOrUsage(flags.html, "正文 HTML 文件");

  // 本地预检沿用 preprocess-and-publish.mjs 的口径：标题>64 / 摘要>120 / 正文≥20000 字符
  // 或≥1MB 一律硬错，未发送任何请求（花钱传图/写草稿箱之前先拦）。
  const errors = precheckPublishBody({ title: flags.title, digest: flags.digest, contentHtml });
  if (errors.length) {
    throw new DbyError("USAGE", `本地预检未通过，未发送任何请求：\n${errors.join("\n")}`, { exit: EXIT.USAGE });
  }

  const body = { authorizerAppid: flags.appid, title: flags.title, contentHtml };
  if (flags.author) body.author = flags.author;
  if (flags.digest) body.digest = flags.digest;
  if (flags.sourceUrl) body.sourceUrl = flags.sourceUrl;
  if (flags.thumbMediaId) body.thumbMediaId = flags.thumbMediaId;
  if (flags.draft) body.draftId = flags.draft;
  if (flags.draftVersion !== undefined) {
    const v = Number(flags.draftVersion);
    if (!Number.isInteger(v) || v <= 0) {
      throw new DbyError("USAGE", `--draft-version 必须是正整数，收到「${flags.draftVersion}」。`, { exit: EXIT.USAGE });
    }
    body.draftVersion = v;
  }

  billable(ctx, [{ action: "publish", ref: flags.appid, title: flags.title }]);
  const data = await request(ctx, "POST", "/api/wechat/publish", { body, billable: true });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatMediaUpload(ctx, file, flags) {
  if (!flags.appid) throw new DbyError("USAGE", "media-upload 需要 --appid。", { exit: EXIT.USAGE });
  let buf;
  try {
    buf = await readFile(file);
  } catch (e) {
    throw new DbyError("USAGE", `读不了 ${file}：${e.message}`, { exit: EXIT.USAGE });
  }
  // 本地拒 >10MB（服务端按 purpose 另有更紧的护栏：image≤1MB / thumb≤10MB，这里只做
  // 花本地 base64 编码之前的粗筛，细的界由服务端 400 回报）。
  if (buf.length > 10 * 1024 * 1024) {
    throw new DbyError("USAGE", `文件 ${(buf.length / 1024 / 1024).toFixed(2)}MB，超过本地上限 10MB。`, { exit: EXIT.USAGE });
  }
  const filename = basename(file);
  const body = { authorizerAppid: flags.appid, dataBase64: buf.toString("base64"), filename };
  if (flags.purpose) body.purpose = flags.purpose;

  billable(ctx, [{ action: "media-upload", ref: flags.appid, title: filename }]);
  const data = await request(ctx, "POST", "/api/wechat/media/upload", { body, billable: true });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatThemeList(ctx) {
  const data = await request(ctx, "GET", "/api/wechat/themes", {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatThemeGet(ctx, flags) {
  const qs = flags.compiled ? "?format=compiled" : "";
  const data = await request(ctx, "GET", `/api/wechat/theme${qs}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatThemeAdd(ctx, flags) {
  if (!flags.file) throw new DbyError("USAGE", "theme-add 需要 --file <主题 JSON 文件路径>。", { exit: EXIT.USAGE });
  const raw = await readFileOrUsage(flags.file, "主题 JSON 文件");
  let themeJson;
  try {
    themeJson = JSON.parse(raw);
  } catch (e) {
    throw new DbyError("USAGE", `${flags.file} 不是合法 JSON：${e.message}`, { exit: EXIT.USAGE });
  }
  const body = { themeJson };
  if (flags.name) body.name = flags.name;
  if (flags.default) body.isDefault = true;
  const data = await request(ctx, "POST", "/api/wechat/theme", { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatThemeUpdate(ctx, id, flags) {
  const body = await readJsonBody(flags);
  const data = await request(ctx, "PUT", `/api/wechat/theme/${encodeURIComponent(id)}`, { body });
  return { data, human: JSON.stringify(data, null, 2) };
}

export async function wechatThemeRm(ctx, id) {
  billable(ctx, [{ action: "delete", ref: id }]);
  const data = await request(ctx, "DELETE", `/api/wechat/theme/${encodeURIComponent(id)}`, {});
  return { data, human: JSON.stringify(data, null, 2) };
}

// ── 命令表 ─────────────────────────────────────────────────────────────────
export const commands = [
  {
    group: "wechat", name: "status",
    summary: "列出我授权的公众号",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/wechat/status" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => wechatStatus(ctx)
  },
  {
    group: "wechat", name: "render",
    summary: "markdown 排版成公众号 HTML，--file 必填读正文",
    args: [],
    flags: {
      file: { value: true, summary: "必填：待排版的 markdown 文件路径" },
      title: { value: true, summary: "文章标题" },
      "theme-id": { value: true, summary: "内置主题 id（见 theme-list）" },
      "theme-name": { value: true, summary: "已保存的模板名" },
      "theme-file": { value: true, summary: "整套主题 JSON 文件路径（优先级最高）" }
    },
    routes: [{ method: "POST", path: "/api/wechat/render" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatRender(ctx, flags)
  },
  {
    group: "wechat", name: "writing-spec",
    summary: "公众号写作规范（agent 写作契约，只读免费）",
    args: [],
    flags: {
      "theme-name": { value: true, summary: "按已保存模板名取（默认用你的默认主题）" },
      section: { value: true, summary: "只取被降级的那一段（家具/形态清单等闭集）" }
    },
    routes: [{ method: "GET", path: "/api/wechat/writing-spec" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatWritingSpec(ctx, flags)
  },
  {
    group: "wechat", name: "topics",
    summary: "选题候选（不传关键词/赛道则用档案默认）",
    args: [],
    flags: {
      keyword: { value: true, summary: "关键词" },
      niche: { value: true, summary: "赛道" }
    },
    routes: [{ method: "GET", path: "/api/wechat/topics" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatTopics(ctx, flags)
  },
  {
    group: "wechat", name: "review",
    summary: "复盘取数（--appid 指定授权公众号，默认用第一个已授权账号）",
    args: [],
    flags: { appid: { value: true, summary: "已授权公众号的 authorizerAppid" } },
    routes: [{ method: "GET", path: "/api/wechat/review" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatReview(ctx, flags)
  },
  {
    group: "wechat", name: "publish",
    summary: "推草稿箱（写入用户公众号后台，默认停在 confirmation_required，--confirm 放行）",
    args: [],
    flags: {
      appid: { value: true, summary: "必填：已授权公众号的 authorizerAppid" },
      title: { value: true, summary: "必填：标题（≤64 字，超出本地硬错）" },
      html: { value: true, summary: "必填：正文 HTML 文件路径（≤20000 字符且 <1MB）" },
      author: { value: true, summary: "作者" },
      digest: { value: true, summary: "摘要（≤120 字）" },
      "source-url": { value: true, summary: "阅读原文链接" },
      "thumb-media-id": { value: true, summary: "封面素材 media_id（见 media-upload --purpose thumb）" },
      draft: { value: true, summary: "稿件 id：发布成功后把该稿件关联到这条文章记录" },
      "draft-version": { value: true, summary: "稿件版本号，必须搭配 --draft；省略 = 最新版" }
    },
    routes: [{ method: "POST", path: "/api/wechat/publish" }],
    billable: true, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatPublish(ctx, flags)
  },
  {
    group: "wechat", name: "media-upload",
    summary: "上传本地图片字节到微信（写入用户公众号素材库，默认停在 confirmation_required）",
    args: [{ name: "file", required: true }],
    flags: {
      appid: { value: true, summary: "必填：已授权公众号的 authorizerAppid" },
      purpose: { value: true, summary: "image（正文图，≤1MB，默认）或 thumb（封面素材，≤10MB）" }
    },
    routes: [{ method: "POST", path: "/api/wechat/media/upload" }],
    billable: true, destructive: false, composite: false,
    run: (ctx, { args, flags }) => wechatMediaUpload(ctx, args.file, flags)
  },
  {
    group: "wechat", name: "theme-list",
    summary: "我的全部主题 + 内置主题目录",
    args: [], flags: {},
    routes: [{ method: "GET", path: "/api/wechat/themes" }],
    billable: false, destructive: false, composite: false,
    run: (ctx) => wechatThemeList(ctx)
  },
  {
    group: "wechat", name: "theme-get",
    summary: "我的默认主题；--compiled 取下游渲染器可直接消费的编译版",
    args: [],
    flags: { compiled: { summary: "取 format=compiled 编译版（无存档主题时回落内置兜底）" } },
    routes: [{ method: "GET", path: "/api/wechat/theme" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatThemeGet(ctx, flags)
  },
  {
    group: "wechat", name: "theme-add",
    summary: "新建主题，--file 必填给整套主题 JSON",
    args: [],
    flags: {
      file: { value: true, summary: "必填：主题 JSON 文件路径" },
      name: { value: true, summary: "主题名（默认「我的主题」）" },
      default: { summary: "设为默认主题" }
    },
    routes: [{ method: "POST", path: "/api/wechat/theme" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatThemeAdd(ctx, flags)
  },
  {
    group: "wechat", name: "theme-update",
    summary: "改主题（部分字段），--body/--file 二选一",
    args: [{ name: "id", required: true }],
    flags: {
      body: { value: true, summary: "JSON 字符串" },
      file: { value: true, summary: "JSON 文件路径，与 --body 二选一" }
    },
    routes: [{ method: "PUT", path: "/api/wechat/theme/:id" }],
    billable: false, destructive: false, composite: false,
    run: (ctx, { args, flags }) => wechatThemeUpdate(ctx, args.id, flags)
  },
  {
    group: "wechat", name: "theme-rm",
    summary: "删主题（不可逆，需 --confirm）",
    args: [{ name: "id", required: true }], flags: {},
    routes: [{ method: "DELETE", path: "/api/wechat/theme/:id" }],
    billable: true, destructive: true, composite: false,
    run: (ctx, { args }) => wechatThemeRm(ctx, args.id)
  }
];
