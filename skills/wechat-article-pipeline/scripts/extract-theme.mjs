#!/usr/bin/env node
// extract-theme.mjs
// -----------------------------------------------------------------------------
// Zero-dependency HEURISTIC theme extractor — a fast, zero-token PRE-PASS that
// turns a fetched 公众号 article body (#js_content HTML) into a *candidate*
// theme.json draft. The LLM then REFINES that draft against the reference
// (fix the accent, normalize messy values, add decorative dividers/heading
// treatments the heuristic missed). extract-theme is the first pass; the LLM
// refine is what gets it to "精修".
//
// The palette-inference algorithm (group inline styles by tag; derive
// text / text_light / primary-accent / background / typography / blockquote /
// code / border-radius, then stamp them into a neutral base template) is a
// zero-dep Node reimplementation of `analyze_styles()` from
//   oaker-io/wewrite  →  https://github.com/oaker-io/wewrite   (MIT, © 2026 OpenClaw)
// (its scripts/learn_theme.py). Credit + license retained; see themes/CREDITS.
//
// Output is a theme.json in OUR schema (see ../themes/THEME-SCHEMA.md): a filled
// `palette` + `page` + reasonable `elements` styles that inject the derived
// palette via {{tokens}}, exactly as wewrite stamps its base_css template. The
// output is guaranteed to pass `validate-theme.mjs`.
//
// Runtime: Node >= 18. Node builtins + global fetch ONLY. Zero external deps.
// SAFETY: fetched JS is NEVER executed; we only regex-scan inline style="…".
//
// CLI:
//   node extract-theme.mjs --html <cleaned-#js_content.html> [--out <draft.json>] [--name <display>]
//   node extract-theme.mjs --url  <https://mp.weixin.qq.com/...> [--out <draft.json>] [--name <display>]
//
//   --html <file>  cleaned #js_content HTML (e.g. from fetch-article.mjs --out).
//   --url  <url>   a public mp.weixin.qq.com article; fetched + body-extracted
//                  via fetch-article.mjs, then analyzed.
//   --out  <file>  where to write the candidate theme.json.
//                  Default: <name-or-timestamp>.draft-theme.json in cwd.
//   --name <str>   meta.name / display name for the draft.
//   -h, --help     show help.
// -----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Reuse the SAME body-extraction + cleaning logic fetch-article.mjs uses, so the
// #js_content parse is identical to the fetch path (single source of truth).
import { extractBody, cleanBody } from "./fetch-article.mjs";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// =============================================================================
// 1. Color utilities (ported from wewrite learn_theme.py — pure, zero-dep)
// =============================================================================

/** rgb()/rgba() → #rrggbb; pass through existing hex (lowercased); else unchanged. */
function rgbToHex(s) {
  if (typeof s !== "string") return s;
  const str = s.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(str)) return str.toLowerCase();
  const m = str.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i
  );
  if (m) {
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  return str;
}

/** Normalize a hex string to 6-digit RGB ints, or null if invalid. */
function hexToRgb(hex) {
  let s = String(hex).trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (s.length === 8) s = s.slice(0, 6); // drop alpha
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Python colorsys.rgb_to_hls / hls_to_rgb, ported (inputs/outputs in 0..1).
function rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const l = (maxc + minc) / 2;
  if (minc === maxc) return [0, l, 0];
  const rangec = maxc - minc;
  const s = l <= 0.5 ? rangec / (maxc + minc) : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, l, s];
}

function hlsToRgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const v = (hue) => {
    hue = ((hue % 1) + 1) % 1;
    if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
    if (hue < 0.5) return m2;
    if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}

/** HLS lightness (0..1) of a hex color; 0.5 for invalid input. */
function lightness(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return rgbToHls(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)[1];
}

/** True if R,G,B are all within `threshold` of each other (near-gray). */
function isGray(hex, threshold = 30) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return Math.max(...rgb) - Math.min(...rgb) <= threshold;
}

/** Return a new hex with lightness set to clamp(targetL), preserving hue+sat. */
function adjustLightness(hex, targetL) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, , s] = rgbToHls(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  const [nr, ng, nb] = hlsToRgb(h, Math.max(0, Math.min(1, targetL)), s);
  return (
    "#" +
    [nr, ng, nb]
      .map((n) => Math.round(n * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

// =============================================================================
// 2. Inline-style parsing + collection (regex scan — no DOM, no JS execution)
// =============================================================================

/** "color: red; font-size: 16px" → { color:"red", "font-size":"16px" } */
function parseInlineStyle(str) {
  const out = {};
  if (!str) return out;
  for (const decl of str.split(";")) {
    const d = decl.trim();
    const idx = d.indexOf(":");
    if (idx <= 0) continue;
    out[d.slice(0, idx).trim().toLowerCase()] = d.slice(idx + 1).trim();
  }
  return out;
}

/** "16px" → 16, else null. */
function parsePx(v) {
  if (!v) return null;
  const m = String(v).trim().match(/([\d.]+)\s*px/i);
  return m ? parseFloat(m[1]) : null;
}

/** Most frequent value of `prop` across an array of style dicts, or null. */
function mostCommon(list, prop) {
  const counts = new Map();
  for (const d of list) {
    const v = d[prop];
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

const TARGET_TAGS = new Set([
  "p", "section", "span", "strong", "em",
  "h1", "h2", "h3", "h4",
  "blockquote", "code", "pre", "img", "a",
]);

/**
 * Scan HTML, group parsed inline styles by tag name (only tags in TARGET_TAGS
 * that carry a non-empty style="…"). Returns { tag: [styleDict, …] }.
 */
function extractStyles(html) {
  const grouped = {};
  for (const t of TARGET_TAGS) grouped[t] = [];
  // Match any opening tag + its attribute run.
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    if (!TARGET_TAGS.has(tag)) continue;
    const attrs = m[2];
    const sm = attrs.match(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!sm) continue;
    const raw = sm[2] != null ? sm[2] : sm[3] || "";
    if (!raw.trim()) continue;
    const parsed = parseInlineStyle(raw);
    if (Object.keys(parsed).length) grouped[tag].push(parsed);
  }
  return grouped;
}

/** Best-effort article title (outside #js_content, so only from full-page HTML). */
function extractTitle(fullHtml) {
  const m =
    fullHtml.match(
      /<h1\b[^>]*\bclass\s*=\s*["'][^"']*\brich_media_title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i
    ) ||
    fullHtml.match(/<h1\b[^>]*\bid\s*=\s*["']activity-name["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return "";
  return m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// =============================================================================
// 3. analyze_styles() — the wewrite heuristic, ported (MAPPING.md §3 steps 2–10)
// =============================================================================

const DEFAULTS = {
  primary: "#2563eb",
  secondary: "#3b82f6",
  text: "#333333",
  text_light: "#666666",
  background: "#ffffff",
  code_bg: "#1e293b",
  code_color: "#e2e8f0",
  quote_border: "#2563eb",
  quote_bg: "#eff6ff",
  border_radius: "8px",
  font_size: "16px",
  line_height: "1.8",
  letter_spacing: "0px",
  font_family:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', " +
    "Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  p_margin: "0 0 16px 0",
};

const COLOR_IN = /(rgb[a]?\([^)]+\)|#[0-9a-fA-F]{3,8})/;

function analyzeStyles(grouped) {
  const result = { ...DEFAULTS };
  // Track which signals actually fired (for a confidence report).
  const found = {
    text: false, textLight: false, accent: false, background: false,
    typography: false, quote: false, code: false, radius: false,
  };

  const pStyles = grouped.p || [];

  // --- 3. text = most-common p color ----------------------------------------
  const rawText = mostCommon(pStyles, "color");
  if (rawText) {
    result.text = rgbToHex(rawText);
    found.text = true;
  }

  // --- 4. text_light = highest-lightness mid-gray foreground (≠ text) --------
  const allColors = [];
  for (const styles of Object.values(grouped)) {
    for (const d of styles) if (d.color) allColors.push(rgbToHex(d.color));
  }
  const tlCandidates = allColors.filter(
    (c) => isGray(c) && lightness(c) > 0.15 && lightness(c) < 0.85 && c !== result.text
  );
  if (tlCandidates.length) {
    result.text_light = tlCandidates.reduce((a, b) => (lightness(b) > lightness(a) ? b : a));
    found.textLight = true;
  }

  // --- 5. primary (accent): weighted Counter of non-gray colors -------------
  //     over {strong, section, h1, h2, h3, span}; weight ×5 when font-size≥20px.
  const accentTags = ["strong", "section", "h1", "h2", "h3", "span"];
  const accentCounter = new Map();
  for (const tag of accentTags) {
    for (const d of grouped[tag] || []) {
      if (!d.color) continue;
      const hex = rgbToHex(d.color);
      if (isGray(hex) || hex === result.text) continue;
      const fsPx = parsePx(d["font-size"]);
      const weight = fsPx != null && fsPx >= 20 ? 5 : 1;
      accentCounter.set(hex, (accentCounter.get(hex) || 0) + weight);
    }
  }
  const sortedAccents = [...accentCounter.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedAccents.length) {
    result.primary = sortedAccents[0][0];
    found.accent = true;
    result.secondary =
      sortedAccents.length >= 2
        ? sortedAccents[1][0]
        : adjustLightness(result.primary, Math.min(lightness(result.primary) + 0.1, 0.9));
  } else {
    result.secondary = adjustLightness(
      result.primary,
      Math.min(lightness(result.primary) + 0.1, 0.9)
    );
  }

  // --- 6. background: first of first-10 sections with lightness > 0.85 -------
  for (const d of (grouped.section || []).slice(0, 10)) {
    const bg = d["background-color"] || d.background;
    if (!bg) continue;
    const hex = rgbToHex(bg);
    if (lightness(hex) > 0.85) {
      result.background = hex;
      found.background = true;
      break;
    }
  }

  // --- 7. typography from p (+ font-family from span) ------------------------
  if (pStyles.length) {
    const fs = mostCommon(pStyles, "font-size");
    if (fs) { result.font_size = fs; found.typography = true; }
    const lh = mostCommon(pStyles, "line-height");
    if (lh) { result.line_height = lh; found.typography = true; }
    const ls = mostCommon(pStyles, "letter-spacing");
    if (ls) result.letter_spacing = ls;
    const mg = mostCommon(pStyles, "margin");
    if (mg) result.p_margin = mg;
  }
  const ff = mostCommon(grouped.span || [], "font-family");
  if (ff) result.font_family = ff;

  // --- 8. quote_border / quote_bg -------------------------------------------
  let bqBorder = null;
  let bqBg = null;
  // Pass 1: real blockquote elements.
  for (const d of grouped.blockquote || []) {
    const bl = d["border-left"] || d["border-left-color"];
    if (bl && !bqBorder) {
      const cm = bl.match(COLOR_IN);
      if (cm) bqBorder = rgbToHex(cm[1]);
    }
    const bg = d["background-color"] || d.background;
    if (bg && !bqBg) {
      const hex = rgbToHex(bg);
      if (hex !== "#ffffff" && hex !== "#000000" && !isGray(hex, 10)) bqBg = hex;
    }
  }
  // Pass 2 (only if no border yet): section/p, but ONLY trust a background when
  // the SAME element also carries a border-left (avoids decorative dividers).
  if (!bqBorder) {
    for (const tag of ["section", "p"]) {
      for (const d of grouped[tag] || []) {
        const bl = d["border-left"] || d["border-left-color"];
        if (!bl) continue;
        const cm = bl.match(COLOR_IN);
        if (cm && !bqBorder) bqBorder = rgbToHex(cm[1]);
        const bg = d["background-color"] || d.background;
        if (bg && !bqBg) {
          const hex = rgbToHex(bg);
          if (hex !== "#ffffff" && hex !== "#000000" && !isGray(hex, 10)) bqBg = hex;
        }
      }
    }
  }
  if (bqBorder) { result.quote_border = bqBorder; found.quote = true; }
  else result.quote_border = result.primary;
  if (bqBg) { result.quote_bg = bqBg; found.quote = true; }
  else result.quote_bg = adjustLightness(result.primary, Math.min(lightness(result.primary) + 0.35, 0.95));

  // --- 9. code_bg / code_color (pre wins by order) --------------------------
  for (const tag of ["pre", "code"]) {
    const styles = grouped[tag] || [];
    const bg = mostCommon(styles, "background-color") || mostCommon(styles, "background");
    if (bg) { result.code_bg = rgbToHex(bg); found.code = true; }
    const color = mostCommon(styles, "color");
    if (color) { result.code_color = rgbToHex(color); found.code = true; }
  }

  // --- 10. border_radius: global mode ---------------------------------------
  const radii = [];
  for (const styles of Object.values(grouped)) {
    for (const d of styles) if (d["border-radius"]) radii.push(d["border-radius"]);
  }
  if (radii.length) {
    const counts = new Map();
    for (const r of radii) counts.set(r, (counts.get(r) || 0) + 1);
    result.border_radius = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    found.radius = true;
  }

  return { analyzed: result, found };
}

// =============================================================================
// 4. Map the flat wewrite dict → OUR theme.json (MAPPING.md §2)
//    palette + page + a neutral base template with the derived palette injected
//    via {{tokens}} — exactly as wewrite stamps its base_css template.
// =============================================================================

const MONO = "Consolas, Menlo, Monaco, 'Courier New', monospace";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif";

// A CSS length value we can safely inline (px/em/rem, single or multi). Fall
// back to a safe default if the extracted value looks weird.
function safeLen(v, fallback) {
  if (!v) return fallback;
  const s = String(v).trim();
  if (/^[\d.]+(px|em|rem|%)$/.test(s)) return s;
  if (/^[\d.]+$/.test(s)) return s + "px";
  return fallback;
}
function safeRadius(v) {
  if (!v) return "8px";
  const s = String(v).trim();
  // single or multi length, all px/em/rem/% or unitless.
  if (/^([\d.]+(px|em|rem|%)?\s*){1,4}$/.test(s)) return s;
  return "8px";
}
function safeLineHeight(v) {
  if (!v) return "1.75";
  const s = String(v).trim();
  if (/^[\d.]+(px|em|rem|%)?$/.test(s)) return s;
  return "1.75";
}
function safeLetterSpacing(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "normal" || s === "0" || s === "0px" || s === "0em") return null;
  if (/^-?[\d.]+(px|em|rem)$/.test(s)) return s;
  return null;
}

function toThemeJson(analyzed, name, sourceUrl, found, lowConfidence) {
  const fontSize = safeLen(analyzed.font_size, "16px");
  const lineHeight = safeLineHeight(analyzed.line_height);
  const radius = safeRadius(analyzed.border_radius);
  const letterSpacing = safeLetterSpacing(analyzed.letter_spacing);

  // §2 palette mapping. Keep hairline `border` a light neutral (derived from
  // text_light) so dividers/code borders stay quiet; carry the real quote
  // border color as an extra {{quoteBorder}} token used only on blockquote.
  const text = analyzed.text;
  const heading = adjustLightness(text, Math.max(0.05, lightness(text) - 0.12));
  const border = adjustLightness(analyzed.text_light, 0.86);
  const palette = {
    text,
    heading,
    accent: analyzed.primary,
    accent2: analyzed.secondary,
    muted: analyzed.text_light,
    bgSoft: analyzed.quote_bg,
    border,
    link: "#576b95", // WeChat blue — link color is not reliably derivable from body styles.
    // Extra (non-standard) tokens — validator warns but allows; used below.
    quoteBorder: analyzed.quote_border,
    codeBg: analyzed.code_bg,
    codeColor: analyzed.code_color,
  };

  const page = {
    fontFamily: SANS, // extracted font-family is often noisy; keep a safe stack.
    fontSize,
    lineHeight,
    color: "{{text}}",
  };
  if (letterSpacing) page.letterSpacing = letterSpacing;

  const elements = {
    h1: { style: `font-size:24px;font-weight:700;color:{{heading}};line-height:1.4;margin:28px 0 16px;` },
    h2: {
      style:
        `font-size:20px;font-weight:700;color:{{heading}};line-height:1.4;margin:26px 0 14px;padding-left:10px;border-left:4px solid {{accent}};`,
    },
    h3: { style: `font-size:18px;font-weight:700;color:{{heading}};line-height:1.4;margin:22px 0 12px;` },
    h4: { style: `font-size:16px;font-weight:700;color:{{accent}};line-height:1.5;margin:18px 0 10px;` },
    p: { style: `margin:0 0 16px;font-size:${fontSize};line-height:${lineHeight};color:{{text}};` },
    ul: { style: `margin:0 0 16px;padding-left:24px;` },
    ol: { style: `margin:0 0 16px;padding-left:24px;` },
    li: { style: `margin:0 0 8px;line-height:${lineHeight};color:{{text}};`, marker: "" },
    blockquote: {
      style:
        `margin:0 0 16px;padding:12px 16px;border-left:4px solid {{quoteBorder}};background:{{bgSoft}};color:{{muted}};border-radius:${radius};`,
    },
    img: { style: `max-width:100%;display:block;margin:16px auto;border-radius:${radius};`, figureStyle: "", captionStyle: "" },
    hr: { html: `<hr style="border:none;border-top:1px solid {{border}};margin:24px 0;" />` },
    strong: { style: `font-weight:700;color:{{accent}};` },
    em: { style: `font-style:italic;` },
    del: { style: `text-decoration:line-through;color:{{muted}};` },
    a: { style: `color:{{link}};text-decoration:underline;word-break:break-all;` },
    code: { style: `padding:2px 6px;background:{{bgSoft}};border-radius:${radius};font-family:${MONO};font-size:14px;color:{{accent}};` },
    pre: {
      style:
        `margin:0 0 16px;padding:14px 16px;background:{{codeBg}};border-radius:${radius};overflow-x:auto;font-family:${MONO};font-size:14px;line-height:1.6;color:{{codeColor}};white-space:pre-wrap;word-break:break-all;`,
    },
  };

  const signalBits = Object.entries(found)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const notes =
    "HEURISTIC DRAFT — a zero-token first-pass palette extraction " +
    "(algorithm ported from oaker-io/wewrite analyze_styles, MIT). " +
    "REFINE THIS: verify the accent, normalize messy values, and add decorative " +
    "dividers / heading treatments the heuristic can't see. " +
    `Derived accent=${analyzed.primary}, text=${analyzed.text}, background=${analyzed.background}. ` +
    `Signals fired: ${signalBits.length ? signalBits.join(", ") : "none"}.` +
    (lowConfidence
      ? " ⚠️ LOW CONFIDENCE: little/no style signal in the article — fell back to neutral defaults; refine manually against the reference."
      : "");

  return {
    meta: {
      name: name || "萃取草稿",
      source: "url",
      notes,
    },
    palette,
    page,
    elements,
  };
}

// =============================================================================
// 5. CLI
// =============================================================================

async function fetchArticleHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": DESKTOP_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
  } catch (e) {
    throw new Error(`network error fetching the article: ${e.message}`);
  }
  if (!res.ok) throw new Error(`the server returned HTTP ${res.status} ${res.statusText}. Link may be expired/blocked.`);
  const page = await res.text();
  const found = extractBody(page); // reuse fetch-article.mjs
  if (!found) {
    throw new Error(
      "couldn't find the article body (#js_content) — likely an anti-bot interstitial or expired link.\n" +
        "   → Open it in a browser, save the page, and pass the HTML with --html instead."
    );
  }
  return { bodyHtml: cleanBody(found.inner), fullHtml: page };
}

const HELP = `extract-theme.mjs — zero-dep HEURISTIC theme extractor (zero-token PRE-PASS)

Turns a fetched 公众号 article body into a CANDIDATE theme.json draft (a derived
palette + base template) that the LLM then REFINES. Palette-inference algorithm
ported from oaker-io/wewrite (MIT). Output passes validate-theme.mjs.

Usage:
  node extract-theme.mjs --html <cleaned-#js_content.html> [--out <draft.json>] [--name <display>]
  node extract-theme.mjs --url  <https://mp.weixin.qq.com/...> [--out <draft.json>] [--name <display>]

  --html <file>  cleaned #js_content HTML (e.g. from fetch-article.mjs --out)
  --url  <url>   a public mp.weixin.qq.com article (fetched via fetch-article.mjs)
  --out  <file>  output theme.json (default: <name-or-timestamp>.draft-theme.json)
  --name <str>   meta.name / display name
  -h, --help     show this help
`;

function parseArgs(argv) {
  const args = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--html") args.html = argv[++k];
    else if (a === "--url") args.url = argv[++k];
    else if (a === "--out") args.out = argv[++k];
    else if (a === "--name") args.name = argv[++k];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function defaultOutName(name) {
  const slug = (name || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (slug) return `${slug}.draft-theme.json`;
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".draft-theme.json";
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`❌ ${e.message}\n\n${HELP}`);
    process.exit(1);
  }
  if (args.help || (!args.html && !args.url)) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }
  if (args.html && args.url) {
    process.stderr.write("❌ pass either --html or --url, not both.\n");
    process.exit(1);
  }

  let bodyHtml = "";
  let fullHtml = "";
  if (args.url) {
    process.stderr.write(`↓ fetching ${args.url}\n`);
    try {
      ({ bodyHtml, fullHtml } = await fetchArticleHtml(args.url));
    } catch (e) {
      process.stderr.write(`❌ ${e.message}\n`);
      process.exit(2);
    }
  } else {
    try {
      bodyHtml = await readFile(path.resolve(args.html), "utf8");
    } catch (e) {
      process.stderr.write(`❌ cannot read ${args.html}: ${e.message}\n`);
      process.exit(2);
    }
    fullHtml = bodyHtml; // a saved page may include the title; try either way
  }

  const grouped = extractStyles(bodyHtml);
  const styledCount = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
  const { analyzed, found } = analyzeStyles(grouped);

  // Low confidence when almost nothing was styled OR neither text nor accent fired.
  const lowConfidence = styledCount < 5 || (!found.text && !found.accent);
  if (lowConfidence) {
    process.stderr.write(
      `⚠️  low confidence: only ${styledCount} styled element(s), weak style signal.\n` +
        "   Fell back to neutral defaults where derivation failed — refine the draft manually.\n"
    );
  }

  const displayName = args.name || extractTitle(fullHtml) || "萃取草稿";
  const theme = toThemeJson(analyzed, displayName, args.url || "", found, lowConfidence);

  const outPath = path.resolve(args.out || defaultOutName(displayName));
  try {
    await writeFile(outPath, JSON.stringify(theme, null, 2) + "\n", "utf8");
  } catch (e) {
    process.stderr.write(`❌ cannot write ${outPath}: ${e.message}\n`);
    process.exit(2);
  }

  const L = [];
  L.push(`✅ candidate theme draft → ${outPath}`);
  L.push(`   ${styledCount} styled element(s) analyzed.`);
  L.push("");
  L.push("── derived palette (heuristic — VERIFY & REFINE) ──");
  L.push(`   accent(primary): ${analyzed.primary}   accent2: ${analyzed.secondary}`);
  L.push(`   text: ${analyzed.text}   text_light/muted: ${analyzed.text_light}`);
  L.push(`   background: ${analyzed.background}   quote bg/border: ${analyzed.quote_bg} / ${analyzed.quote_border}`);
  L.push(`   font-size: ${analyzed.font_size}   line-height: ${analyzed.line_height}   radius: ${analyzed.border_radius}`);
  L.push("");
  L.push("Next: this is a FIRST PASS. Refine it against the reference, then:");
  L.push(`   node scripts/validate-theme.mjs ${path.basename(outPath)}`);
  L.push(`   node scripts/render-wechat-html.mjs --md a.md --title "标题" --theme ${path.basename(outPath)}`);
  process.stdout.write(L.join("\n") + "\n");
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + "\n");
    process.exit(2);
  });
}

export { rgbToHex, lightness, isGray, adjustLightness, extractStyles, analyzeStyles, toThemeJson };
