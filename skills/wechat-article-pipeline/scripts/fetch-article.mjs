#!/usr/bin/env node
/**
 * fetch-article.mjs — zero-dependency 公众号 reference-article fetcher.
 *
 * Purpose:
 *   Fetch ONE public 公众号 (mp.weixin.qq.com) article you want to STUDY the
 *   typography/layout of, extract its article body (#js_content), clean it for
 *   analysis while PRESERVING the inline style="…" attributes (those inline
 *   styles ARE the data we analyze), and print a quick style fingerprint
 *   (tag counts + the distinct colors and font-sizes seen). The cleaned HTML
 *   is then read by an agent to author a reusable theme.json
 *   (see ../themes/THEME-SCHEMA.md).
 *
 * This is a ONE-TIME style-study step. It fetches a single PUBLIC article for
 * your own study — it does NOT log in and does NOT scrape at scale.
 *
 * Zero external deps: Node >= 18 builtins + global fetch only.
 * SAFETY: fetched JS is NEVER executed; <script>/<style>/comments are stripped.
 *
 * CLI:
 *   node fetch-article.mjs --url <https://mp.weixin.qq.com/...> [--out <cleaned.html>]
 *
 *   --url <url>   (required) the public 公众号 article URL.
 *   --out <file>  where to write cleaned reference HTML.
 *                 Default: <slug-or-timestamp>.reference.html in cwd.
 *   -h, --help    show help.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
async function fetchHtml(url) {
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
function extractBody(html) {
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
function cleanBody(body) {
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
function fingerprint(html) {
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
function defaultOutName(url) {
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

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

const HELP = `fetch-article.mjs — zero-dep 公众号 reference-article fetcher (style study)

Fetch ONE public mp.weixin.qq.com article, extract its body (#js_content),
clean it while KEEPING inline style="…" attributes, and print a style
fingerprint (tag counts + distinct colors/font-sizes) to help you author a
theme.json (see ../themes/THEME-SCHEMA.md). One-time study step; no login,
no scraping at scale.

Usage:
  node fetch-article.mjs --url <https://mp.weixin.qq.com/...> [--out <cleaned.html>]

  --url <url>   (required) the public 公众号 article URL.
  --out <file>  cleaned-HTML output path. Default: <slug-or-timestamp>.reference.html
  -h, --help    show this help.
`;

function parseArgs(argv) {
  const args = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--url") args.url = argv[++k];
    else if (a === "--out") args.out = argv[++k];
    else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`❌ ${e.message}\n\n${HELP}`);
    process.exit(1);
  }

  if (args.help || !args.url) {
    process.stdout.write(HELP);
    process.exit(args.url ? 0 : args.help ? 0 : 1);
  }

  process.stderr.write(`↓ fetching ${args.url}\n`);
  let page;
  try {
    page = await fetchHtml(args.url);
  } catch (e) {
    process.stderr.write(`❌ ${e.message}\n`);
    process.exit(2);
  }

  const found = extractBody(page);
  if (!found) {
    process.stderr.write(
      "❌ couldn't find the article body (#js_content or .rich_media_content) in the page.\n" +
        "   This is usually an anti-bot interstitial or an expired link.\n" +
        "   → Open the article in your browser, View Source / Save the page, and paste its\n" +
        "     HTML into a local file to analyze instead (the theme-authoring step works from\n" +
        "     any 公众号 body HTML, not only from this fetcher).\n"
    );
    process.exit(3);
  }

  const cleaned = cleanBody(found.inner);
  const fp = fingerprint(cleaned);
  const outPath = path.resolve(args.out || defaultOutName(args.url));

  try {
    await writeFile(outPath, cleaned, "utf8");
  } catch (e) {
    process.stderr.write(`❌ cannot write ${outPath}: ${e.message}\n`);
    process.exit(2);
  }

  // Summary / fingerprint to stdout.
  const L = [];
  L.push(`✅ extracted ${found.container} → ${outPath}`);
  L.push(`   ${cleaned.length} chars cleaned, ${fp.styledCount} styled element(s), ${fp.imgCount} <img>.`);
  L.push("");
  L.push("── tag counts ──────────────────────────────");
  L.push("   " + (fp.tags.map(([tag, n]) => `${tag}:${n}`).join("  ") || "(none)"));
  L.push("");
  L.push("── distinct colors (most-used first → palette candidates) ──");
  L.push("   " + (fp.colors.length ? fp.colors.join("  ") : "(none found)"));
  L.push("");
  L.push("── distinct font-sizes ─────────────────────");
  L.push("   " + (fp.fontSizes.length ? fp.fontSizes.join("  ") : "(none found)"));
  L.push("");
  L.push("Next: read the cleaned HTML, extract the RECURRING inline-style pattern,");
  L.push("and fill a theme.json per ../themes/THEME-SCHEMA.md → validate-theme.mjs → render --theme.");
  process.stdout.write(L.join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + "\n");
    process.exit(2);
  });
}

export { extractBody, cleanBody, fingerprint };
