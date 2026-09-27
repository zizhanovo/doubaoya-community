// fetch-article-core.mjs — 公众号参考文章抓取与样式指纹（自 skills/dby-publish/scripts/fetch-article.mjs
// 原样搬入，dby-cli-rebuild design D4：`dby wechat fetch-article`，kind=local——只抓用户指定的
// mp.weixin.qq.com 公开页，不发任何 doubaoya 请求）。抓到的 JS 永不执行；<script>/<style>/注释一律剥掉。
// 与原脚本相比只加了 export，函数体一字未改。

// A realistic desktop-browser UA — 公众号 serves the article server-rendered to
// normal browsers; a bare Node UA is more likely to be bounced.
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// -----------------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------------

/**
 * Fetch a URL as a desktop browser, following redirects. Returns the response
 * body text. Throws with a clear message on network / HTTP errors.
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": DESKTOP_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
  } catch (e) {
    throw new Error(
      `network error fetching the article: ${e.message}. Check the URL and your connection.`
    );
  }
  if (!res.ok) {
    throw new Error(
      `the server returned HTTP ${res.status} ${res.statusText}. The link may be expired or blocked.`
    );
  }
  return await res.text();
}

// -----------------------------------------------------------------------------
// Extraction — pure string/regex, no DOM, no JS execution.
// -----------------------------------------------------------------------------

/**
 * Extract the inner HTML of a <div id="js_content" ...> (or a fallback
 * container) from a full 公众号 page. Balances nested <div> so we get the whole
 * subtree, not just up to the first </div>.
 * @param {string} html full page HTML
 * @returns {{ inner: string, container: string } | null}
 */
export function extractBody(html) {
  const containers = [
    { label: "#js_content", re: /<div\b[^>]*\bid\s*=\s*["']js_content["'][^>]*>/i },
    {
      label: 'div.rich_media_content',
      re: /<div\b[^>]*\bclass\s*=\s*["'][^"']*\brich_media_content\b[^"']*["'][^>]*>/i,
    },
  ];

  for (const { label, re } of containers) {
    const open = re.exec(html);
    if (!open) continue;
    const start = open.index + open[0].length;
    const inner = sliceBalancedDiv(html, start);
    if (inner != null) return { inner, container: label };
  }
  return null;
}

/**
 * Given the index just AFTER an opening <div>, return the substring up to its
 * matching </div>, accounting for nested <div>…</div>. Returns null if the tag
 * never closes.
 * @param {string} html
 * @param {number} start index just past the opening tag
 * @returns {string | null}
 */
function sliceBalancedDiv(html, start) {
  const tagRe = /<\s*(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[1] === "/") {
      depth -= 1;
      if (depth === 0) return html.slice(start, m.index);
    } else {
      depth += 1;
    }
  }
  return null;
}

/**
 * Clean the extracted body for style analysis:
 *   - drop <script>/<style> blocks and HTML comments (unsafe / noise);
 *   - collapse runs of whitespace to single spaces;
 * while PRESERVING every inline style="…" attribute, element structure, and
 * <img> src/data-src (the inline styles + structure are what we analyze).
 * @param {string} body
 * @returns {string}
 */
export function cleanBody(body) {
  let out = body;
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  // Collapse whitespace but keep single spaces between tags/text.
  out = out.replace(/\s+/g, " ");
  // Put a newline before each opening block-ish tag so the file is skimmable
  // by a human/agent without changing any attribute data.
  out = out.replace(
    /<(section|div|p|h[1-6]|blockquote|ul|ol|li|figure|figcaption|img|hr|table|tr)\b/gi,
    "\n<$1"
  );
  return out.trim() + "\n";
}

// -----------------------------------------------------------------------------
// Fingerprint — a quick style summary to help the analyst.
// -----------------------------------------------------------------------------

/**
 * Scan cleaned HTML and summarize: element counts by tag, distinct colors, and
 * distinct font-sizes seen across inline style attributes.
 * @param {string} html
 * @returns {{ tags: Array<[string, number]>, colors: string[], fontSizes: string[], imgCount: number, styledCount: number }}
 */
export function fingerprint(html) {
  // Tag counts.
  const tagCounts = new Map();
  const tagRe = /<\s*([a-zA-Z][a-zA-Z0-9]*)\b/g;
  let t;
  while ((t = tagRe.exec(html))) {
    const tag = t[1].toLowerCase();
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }

  // Gather all inline style="…" contents.
  const styles = [];
  const styleRe = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let s;
  while ((s = styleRe.exec(html))) styles.push(s[2] != null ? s[2] : s[3] || "");

  // Colors: hex + rgb/rgba across every color-ish property.
  const colorCounts = new Map();
  const hexRe = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
  const rgbRe = /rgba?\([^)]*\)/gi;
  for (const st of styles) {
    let c;
    while ((c = hexRe.exec(st))) bump(colorCounts, c[0].toLowerCase());
    while ((c = rgbRe.exec(st))) bump(colorCounts, c[0].replace(/\s+/g, "").toLowerCase());
  }

  // Font-sizes (px/em/rem/pt).
  const sizeCounts = new Map();
  const sizeRe = /font-size\s*:\s*([0-9.]+(?:px|em|rem|pt|%))/gi;
  for (const st of styles) {
    let z;
    while ((z = sizeRe.exec(st))) bump(sizeCounts, z[1].toLowerCase());
  }

  const imgCount = tagCounts.get("img") || 0;

  return {
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]),
    colors: sortedByCount(colorCounts),
    fontSizes: sortedByCount(sizeCounts),
    imgCount,
    styledCount: styles.length,
  };
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}
function sortedByCount(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (×${n})`);
}

// -----------------------------------------------------------------------------
// Output-path helper
// -----------------------------------------------------------------------------

/**
 * Derive a default output filename from the URL, else a timestamp.
 * @param {string} url
 * @returns {string}
 */
export function defaultOutName(url) {
  let slug = "";
  try {
    const u = new URL(url);
    // 公众号 permalinks look like /s/<token> or /s?__biz=...&mid=...; use last path seg.
    const seg = u.pathname.split("/").filter(Boolean).pop() || "";
    slug = seg.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  } catch {
    /* fall through to timestamp */
  }
  if (!slug) slug = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug}.reference.html`;
}
