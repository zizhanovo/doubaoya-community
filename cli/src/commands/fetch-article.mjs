// fetch-article.mjs — `dby wechat fetch-article`：抓一篇公开的公众号文章做排版研究（kind=local）。
// 一次性研究步骤：不登录、不批量；只打用户给的那个公开网址，不发任何 doubaoya 请求。
// 文件进文件出：清洗后的正文 HTML 写文件，JSON 只回路径、字节数与样式指纹。

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT, DbyError } from "../errors.mjs";
import { cleanBody, defaultOutName, extractBody, fetchHtml, fingerprint } from "../fetch-article-core.mjs";

export async function wechatFetchArticle(ctx, { url, out }) {
  if (!url) throw new DbyError("USAGE", "需要 --url <公众号文章公开网址>。", { exit: EXIT.USAGE });
  process.stderr.write(`↓ fetching ${url}\n`);
  let page;
  try {
    page = await fetchHtml(url);
  } catch (e) {
    throw new DbyError("FETCH_FAILED", e.message, {
      exit: EXIT.NETWORK,
      remediation: "确认网址能在浏览器里打开；也可以在浏览器里「另存为」网页，再把 HTML 交给 agent 分析。"
    });
  }
  const found = extractBody(page);
  if (!found) {
    throw new DbyError("ARTICLE_BODY_NOT_FOUND", "页面里找不到文章正文（#js_content 或 .rich_media_content）。", {
      exit: EXIT.BUSINESS,
      remediation: "多半是反爬拦截页或链接已过期：在浏览器里打开文章、查看源代码或另存网页，把 HTML 存成本地文件再分析。"
    });
  }
  const cleaned = cleanBody(found.inner);
  const fp = fingerprint(cleaned);
  const outPath = path.resolve(out || defaultOutName(url));
  try {
    await writeFile(outPath, cleaned, "utf8");
  } catch (e) {
    throw new DbyError("WRITE_FAILED", `写不了 ${outPath}：${e.message}`, { exit: EXIT.GENERAL });
  }
  const data = {
    file: outPath,
    container: found.container,
    chars: cleaned.length,
    styledCount: fp.styledCount,
    imgCount: fp.imgCount,
    tags: fp.tags,
    colors: fp.colors,
    fontSizes: fp.fontSizes
  };
  const human = [
    `✅ extracted ${found.container} → ${outPath}`,
    `   ${cleaned.length} chars cleaned, ${fp.styledCount} styled element(s), ${fp.imgCount} <img>.`,
    `   tags: ${fp.tags.map(([t, n]) => `${t}:${n}`).join("  ") || "(none)"}`,
    `   colors: ${fp.colors.join("  ") || "(none found)"}`,
    `   font-sizes: ${fp.fontSizes.join("  ") || "(none found)"}`,
    "Next: 读清洗后的 HTML，提炼反复出现的内联样式，写成主题 JSON，再用 dby preview --theme-file <json> 看效果。"
  ].join("\n");
  return { data, human };
}

export const commands = [
  {
    group: "wechat", name: "fetch-article", kind: "local",
    summary: "抓一篇公开的公众号文章，清洗正文并给出样式指纹（排版研究用；不发 doubaoya 请求）",
    args: [],
    flags: {
      url: { value: true, summary: "公众号文章公开网址（必填）" },
      out: { value: true, summary: "清洗后 HTML 的输出路径（默认 <slug>.reference.html）" }
    },
    routes: [],
    billable: false, destructive: false, composite: false,
    run: (ctx, { flags }) => wechatFetchArticle(ctx, flags)
  }
];
