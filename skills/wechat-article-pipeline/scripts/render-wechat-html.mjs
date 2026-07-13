#!/usr/bin/env node
// render-wechat-html.mjs
// -----------------------------------------------------------------------------
// UNIVERSAL, zero-dependency Markdown -> 公众号 (WeChat Official Account) HTML,
// now THEME-DRIVEN.
//
// This is the ZERO-DEP DEFAULT renderer for the 都爆鸭 (doubaoya) community
// `wechat-article-pipeline` skill.
//   * Runtime: Node >= 18. Uses Node builtins + global fetch ONLY.
//   * No bun, no third-party theme repos, no npm deps, no personal paths.
//
// Why 公众号 needs special HTML:
//   公众号's draft editor strips <style>/<head>, class-based CSS and external
//   stylesheets. So every element must carry its own INLINE `style="..."`.
//   We emit ONE fragment of inline-styled block elements, mobile-first
//   (comfortable line-height, ~16px body, generous 段间距), ready to paste
//   into a 公众号 draft body.
//
// Theming (see ../themes/THEME-SCHEMA.md — the authoritative contract):
//   A "theme" is a declarative JSON map of per-element inline-style templates +
//   a small palette + optional decorative HTML snippets. Any `{{token}}` inside
//   any style/html string resolves from `palette` (then `page`). A user theme is
//   DEEP-MERGED over the built-in DEFAULT_THEME (theme values win, elements merge
//   per tag), so a partial theme (e.g. only palette + h2) still renders. The
//   built-in defaults below are themselves expressed AS a theme that follows the
//   same schema — dogfooding proves the contract.
//
// Image handling (composition boundary — DO NOT CHANGE):
//   We PRESERVE every <img src> verbatim (local path / http(s) / mmbiz). We do
//   NOT rewrite or resolve images here. The downstream
//   `preprocess-and-publish.mjs` stage is responsible for uploading local
//   images and swapping srcs. Keeping this stage src-neutral is what lets the
//   two stages compose cleanly. Themes MUST NOT rewrite image srcs.
//
// CLI:
//   node render-wechat-html.mjs --md <input.md> [--out <output.html>] [--title <str>] [--theme <theme.json>]
//   node render-wechat-html.mjs --check
//
// API:
//   import { renderWechatHtml } from './render-wechat-html.mjs'
//   const html = renderWechatHtml(markdown, { title })                 // neutral defaults
//   const html = renderWechatHtml(markdown, { title, theme })          // themed
// -----------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// -----------------------------------------------------------------------------
// BUILT-IN DEFAULT THEME — neutral / theme-agnostic. No brand colors baked in.
// This is a full theme object that follows ../themes/THEME-SCHEMA.md. When no
// user theme is supplied the renderer merges an empty theme over this, so the
// output is byte-identical to the historical hardcoded renderer. Element styles
// dogfood palette `{{tokens}}`; values without a palette key stay literal.
// -----------------------------------------------------------------------------
const MONO = "Consolas, Menlo, Monaco, 'Courier New', monospace";
const BODY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif";

// -----------------------------------------------------------------------------
// COMPONENT LAYER (MVP) — built-in default component templates.
// Agents insert components with a block syntax (:::关注卡 / > [!NOTE] / :::金句 /
// :::标题 / :::分割); each template below is an inline-styled HTML string whose
// {{token}} placeholders resolve from the CURRENT theme's palette/page at render
// time, so a component automatically wears the active theme's colors.
//
// 公众号 red-line compliance (MUST hold for every template): pure inline `style`,
// NO class=, NO id=, NO <style>/<script>, and any inline <svg> is minimal — no
// id, no <defs>, no CSS selectors. A theme MAY override any of these via a
// top-level `components` map (deep-merged over these defaults; strings still pass
// validate-theme's safety scan). {{content}}/{{title}}/{{bar}}/{{bg}}/{{icon}}
// are per-render fields the walker supplies (not palette tokens).
// -----------------------------------------------------------------------------
const COMPONENT_DEFAULTS = {
  followCard:
    '<section style="margin:20px 0;padding:16px 18px;background:{{bgSoft}};border:1px solid {{accent}};border-radius:10px;text-align:center;"><p style="margin:0;font-size:15px;font-weight:600;color:{{accent}};line-height:1.6;"><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-2px;margin-right:6px;fill:{{accent}};"><path d="M12 4l7 8h-4v8H9v-8H5z"/></svg>{{content}}</p></section>',
  callout:
    '<section style="margin:18px 0;padding:12px 14px;background:{{bg}};border-left:4px solid {{bar}};border-radius:0 8px 8px 0;"><p style="margin:0 0 6px;font-size:15px;font-weight:700;color:{{bar}};line-height:1.5;"><svg viewBox="0 0 24 24" width="16" height="16" style="vertical-align:-2px;margin-right:6px;fill:{{bar}};"><path d="{{icon}}"/></svg>{{title}}</p><p style="margin:0;font-size:15px;color:{{text}};line-height:1.7;">{{content}}</p></section>',
  quoteCard:
    '<section style="margin:22px 0;padding:22px 20px;background:{{bgSoft}};border-radius:12px;text-align:center;"><svg viewBox="0 0 24 24" width="26" height="26" style="fill:{{accent}};opacity:0.5;"><path d="M7 7h5v5H8v-2h2V9H7V7zm7 0h5v5h-4v-2h2V9h-3V7z"/></svg><p style="margin:10px 0;font-size:19px;font-weight:700;color:{{heading}};line-height:1.7;">{{content}}</p><div style="width:40px;height:3px;margin:8px auto 0;background:{{accent}};border-radius:2px;"></div></section>',
  fancyTitle:
    '<section style="margin:28px 0 16px;"><p style="margin:0;font-size:20px;font-weight:800;color:{{heading}};line-height:1.5;"><span style="display:inline-block;height:24px;line-height:24px;margin-right:10px;padding:0 8px;background:{{accent}};color:#ffffff;border-radius:6px;font-size:14px;">✦</span>{{content}}</p><div style="height:3px;margin-top:8px;background:linear-gradient(90deg,{{accent}},transparent);border-radius:2px;"></div></section>',
  fancyDivider:
    '<section style="margin:26px 0;text-align:center;"><span style="display:inline-block;width:30%;height:1px;vertical-align:middle;background:linear-gradient(90deg,transparent,{{accent}});"></span><svg viewBox="0 0 24 24" width="18" height="18" style="margin:0 12px;vertical-align:middle;fill:{{accent}};"><path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.5 2.4-7.4L2 9.6h7.6z"/></svg><span style="display:inline-block;width:30%;height:1px;vertical-align:middle;background:linear-gradient(90deg,{{accent}},transparent);"></span></section>',
};

// Block-component name -> canonical key. Chinese names + English aliases both map
// here (lookup lowercases first; Chinese is unaffected by toLowerCase()).
const COMPONENT_ALIASES = {
  关注卡: 'follow', 关注: 'follow', follow: 'follow',
  金句: 'quote', 金句卡: 'quote', 'quote-card': 'quote', quote: 'quote',
  标题: 'title', title: 'title',
  分割: 'divider', 分割线: 'divider', divider: 'divider',
};

const DEFAULT_FOLLOW_COPY = '点击上方名片，关注我们，一起看更多好内容';

// Per-variant styling for GFM-alert callouts. NOTE tracks the theme accent (so it
// re-colors with the theme); TIP/WARN carry their own semantic hue + soft tint.
const CALLOUT_VARIANTS = {
  note: { icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z', label: '提示' },
  tip: { bar: '#2f9e44', bg: '#eef8f0', icon: 'M9 21h6v-1H9v1zm3-19a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z', label: '小贴士' },
  warn: { bar: '#e8830c', bg: '#fff6ea', icon: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z', label: '注意' },
};

const DEFAULT_THEME = {
  meta: { name: 'neutral', source: 'handcrafted', notes: 'Built-in zero-brand default.' },
  palette: {
    text: '#333333',
    heading: '#222222',
    accent: '#555555',
    accent2: '#555555',
    muted: '#888888',
    bgSoft: '#f7f7f7',
    border: '#e0e0e0',
    link: '#555555',
  },
  page: {
    fontFamily: BODY_FONT,
    fontSize: '16px',
    lineHeight: '1.75',
    // letterSpacing intentionally omitted (default keeps normal spacing).
    color: '{{text}}',
  },
  elements: {
    h1: { style: 'font-size:24px;font-weight:700;color:{{heading}};line-height:1.4;margin:28px 0 16px;' },
    h2: {
      style:
        'font-size:20px;font-weight:700;color:{{heading}};line-height:1.4;margin:26px 0 14px;padding-left:10px;border-left:4px solid {{accent}};',
    },
    h3: { style: 'font-size:18px;font-weight:700;color:{{heading}};line-height:1.4;margin:22px 0 12px;' },
    h4: { style: 'font-size:16px;font-weight:700;color:{{heading}};line-height:1.5;margin:18px 0 10px;' },
    p: { style: 'margin:0 0 16px;font-size:16px;line-height:1.75;color:{{text}};' },
    ul: { style: 'margin:0 0 16px;padding-left:24px;' },
    ol: { style: 'margin:0 0 16px;padding-left:24px;' },
    li: { style: 'margin:0 0 8px;line-height:1.75;color:{{text}};', marker: '' },
    blockquote: {
      style:
        'margin:0 0 16px;padding:12px 16px;border-left:4px solid {{border}};background:{{bgSoft}};color:{{muted}};border-radius:0 4px 4px 0;',
    },
    img: { style: 'max-width:100%;display:block;margin:16px auto;border-radius:8px;', figureStyle: '', captionStyle: '' },
    hr: { html: '<hr style="border:none;border-top:1px solid {{border}};margin:24px 0;" />' },
    strong: { style: 'font-weight:700;color:{{heading}};' },
    em: { style: 'font-style:italic;' },
    del: { style: 'text-decoration:line-through;color:{{muted}};' },
    a: { style: 'color:{{link}};text-decoration:underline;word-break:break-all;' },
    code: { style: `padding:2px 6px;background:#f6f6f6;border-radius:4px;font-family:${MONO};font-size:14px;color:#c7254e;` },
    pre: {
      style: `margin:0 0 16px;padding:14px 16px;background:#f6f6f6;border-radius:8px;overflow-x:auto;font-family:${MONO};font-size:14px;line-height:1.6;color:{{text}};white-space:pre-wrap;word-break:break-all;`,
    },
  },
  decorations: {
    // articleWrap.before/after wrap the WHOLE fragment. sectionDivider is a named
    // decorative divider a caller could inject; unused by the core md walker.
    articleWrap: { before: '', after: '' },
    sectionDivider: '',
  },
  // Built-in component templates (see COMPONENT_DEFAULTS). A user theme may
  // override any key; deep-merge keeps unspecified components at their defaults.
  components: COMPONENT_DEFAULTS,
};

// Fixed mobile-first safety constraints always appended to the page wrapper.
// (公众号 body should never blow past viewport width or overflow on long tokens.)
const PAGE_SAFETY = 'max-width:100%;word-break:break-word;';

// -----------------------------------------------------------------------------
// Theme merge + palette-token interpolation
// -----------------------------------------------------------------------------
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge `override` over `base`; override scalars/arrays win, objects recurse.
function deepMerge(base, override) {
  if (!isPlainObject(base)) return clone(override);
  if (!isPlainObject(override)) return override === undefined ? clone(base) : clone(override);
  const out = clone(base);
  for (const k of Object.keys(override)) {
    const ov = override[k];
    if (isPlainObject(ov) && isPlainObject(out[k])) out[k] = deepMerge(out[k], ov);
    else out[k] = clone(ov);
  }
  return out;
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlainObject(v)) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

// Replace {{key}} with vars[key]. Unknown tokens are left verbatim and recorded.
function interpolate(str, vars, warnings) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key) && typeof vars[key] === 'string') {
      return vars[key];
    }
    if (warnings && !warnings.includes(key)) warnings.push(key);
    return m; // leave as-is
  });
}

// Recursively interpolate every string value in an object/array.
function interpolateDeep(node, vars, warnings) {
  if (typeof node === 'string') return interpolate(node, vars, warnings);
  if (Array.isArray(node)) return node.map((n) => interpolateDeep(n, vars, warnings));
  if (isPlainObject(node)) {
    const o = {};
    for (const k of Object.keys(node)) o[k] = interpolateDeep(node[k], vars, warnings);
    return o;
  }
  return node;
}

// Merge a user theme over the default, then resolve all {{tokens}}.
// Returns { theme (resolved), page (wrapper style string), warnings: [unknownKeys] }.
export function resolveTheme(userTheme) {
  const warnings = [];
  const merged = deepMerge(DEFAULT_THEME, userTheme && isPlainObject(userTheme) ? userTheme : {});

  // 1. Palette resolves first (values may reference each other).
  const palette = interpolateDeep(merged.palette || {}, merged.palette || {}, warnings);
  // 2. Page resolves against the palette.
  const page = interpolateDeep(merged.page || {}, palette, warnings);
  // 3. Everything else resolves against palette ∪ page.
  const vars = { ...palette, ...page };
  const elements = interpolateDeep(merged.elements || {}, vars, warnings);
  const decorations = interpolateDeep(merged.decorations || {}, vars, warnings);

  // Build the wrapper (page-level <section>) style deterministically.
  let pageStyle = '';
  if (page.fontFamily) pageStyle += `font-family:${page.fontFamily};`;
  if (page.fontSize) pageStyle += `font-size:${page.fontSize};`;
  if (page.lineHeight) pageStyle += `line-height:${page.lineHeight};`;
  if (page.letterSpacing) pageStyle += `letter-spacing:${page.letterSpacing};`;
  if (page.color) pageStyle += `color:${page.color};`;
  pageStyle += PAGE_SAFETY;

  return { theme: { ...merged, palette, page, elements, decorations }, pageStyle, warnings };
}

// Convenience accessors against a resolved theme's elements.
function elStyle(theme, tag) {
  const e = theme.elements[tag];
  return e && typeof e.style === 'string' ? e.style : '';
}
function elWrapBefore(theme, tag) {
  const e = theme.elements[tag];
  return e && typeof e.wrapBefore === 'string' ? e.wrapBefore : '';
}
function elWrapAfter(theme, tag) {
  const e = theme.elements[tag];
  return e && typeof e.wrapAfter === 'string' ? e.wrapAfter : '';
}

// -----------------------------------------------------------------------------
// Escaping
// -----------------------------------------------------------------------------
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape only text destined for an attribute value (href/src/alt).
function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// -----------------------------------------------------------------------------
// Inline markdown -> inline HTML.
// Order matters: we protect code spans first so their contents are not further
// parsed, then handle images, links, emphasis, strike. All element styles come
// from the resolved theme `t`.
// -----------------------------------------------------------------------------
function renderInline(text, t) {
  const codeSpans = [];
  // 1. Inline code: `code` — capture, escape contents, replace later.
  let out = text.replace(/`([^`]+)`/g, (_m, code) => {
    const token = ` CODE${codeSpans.length} `;
    codeSpans.push(`<code style="${elStyle(t, 'code')}">${escapeHtml(code)}</code>`);
    return token;
  });

  // 2. Escape the remaining raw text so stray <, >, & don't break the fragment.
  out = escapeHtml(out);

  // 3. Images: ![alt](src) — PRESERVE src verbatim (no rewrite/resolve).
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, src) => {
    return renderImage(src, alt, t);
  });

  // 4. Links: [text](href). Note: 公众号 only makes whitelisted external links
  //    clickable; others are flattened to plain text. We keep href regardless.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label, href) => {
    return `<a href="${escapeAttr(href)}" style="${elStyle(t, 'a')}">${label}</a>`;
  });

  // 5. Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, `<strong style="${elStyle(t, 'strong')}">$1</strong>`);
  out = out.replace(/__([^_]+)__/g, `<strong style="${elStyle(t, 'strong')}">$1</strong>`);

  // 6. Strikethrough: ~~text~~
  out = out.replace(/~~([^~]+)~~/g, `<span style="${elStyle(t, 'del')}">$1</span>`);

  // 7. Italic: *text* or _text_ (after bold so ** already consumed).
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, `$1<em style="${elStyle(t, 'em')}">$2</em>`);
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, `$1<em style="${elStyle(t, 'em')}">$2</em>`);

  // 8. Hard line break: two trailing spaces, or a backslash, before newline.
  out = out.replace(/( {2,}|\\)\n/g, '<br />');

  // 9. Restore code spans.
  out = out.replace(/ CODE(\d+) /g, (_m, i) => codeSpans[Number(i)]);

  return out;
}

// Render an image, preserving src verbatim. When the theme sets img.captionStyle
// (or img.figureStyle), wrap it in a <figure> with the alt text as <figcaption>.
function renderImage(src, alt, t) {
  const imgEl = t.elements.img || {};
  const imgTag = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="${imgEl.style || ''}" />`;
  const figureStyle = typeof imgEl.figureStyle === 'string' ? imgEl.figureStyle : '';
  const captionStyle = typeof imgEl.captionStyle === 'string' ? imgEl.captionStyle : '';
  if (!figureStyle && !captionStyle) return imgTag;
  const cap =
    captionStyle && alt ? `<figcaption style="${captionStyle}">${escapeHtml(alt)}</figcaption>` : '';
  return `<figure style="${figureStyle}">${imgTag}${cap}</figure>`;
}

// -----------------------------------------------------------------------------
// Heuristic: is this line an already-formed HTML block we should pass through?
// Lets pre-made HTML snippets (raw <img>, <a>, <div>, <table>, <section>...)
// survive verbatim so authors can drop in ready HTML.
// -----------------------------------------------------------------------------
const HTML_BLOCK_RE =
  /^<(img|a|div|section|table|figure|iframe|video|audio|p|span|br|hr|blockquote|ul|ol|li|h[1-6]|center|font|strong|em|svg)\b/i;

function isHtmlPassthrough(line) {
  return HTML_BLOCK_RE.test(line.trim());
}

// -----------------------------------------------------------------------------
// List parsing helpers (supports one level of nesting via indentation).
// -----------------------------------------------------------------------------
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)\d+[.)]\s+(.*)$/;

function renderListItems(items, t) {
  const marker = (t.elements.li && typeof t.elements.li.marker === 'string' && t.elements.li.marker) || '';
  return items
    .map((it) => {
      let inner = renderInline(it.text, t);
      if (marker) inner = `${marker}${inner}`;
      if (it.children && it.children.length) {
        const tag = it.childOrdered ? 'ol' : 'ul';
        inner += `<${tag} style="${elStyle(t, tag)}">${renderListItems(it.children, t)}</${tag}>`;
      }
      return `<li style="${elStyle(t, 'li')}">${inner}</li>`;
    })
    .join('');
}

// Emit a block element with optional decorative wrapBefore/wrapAfter injection.
function block(t, tag, html) {
  return `${elWrapBefore(t, tag)}${html}${elWrapAfter(t, tag)}`;
}

// -----------------------------------------------------------------------------
// Component layer: fill a component template with the resolved theme palette/page
// plus per-render `fields`. Unknown {{tokens}} are left verbatim (components are
// internal/controlled, so their token set is closed; no warning bookkeeping).
// -----------------------------------------------------------------------------
function renderComponent(t, key, fields) {
  const comps = (t && t.components) || {};
  const tpl = typeof comps[key] === 'string' ? comps[key] : '';
  if (!tpl) return '';
  const vars = { ...(t.palette || {}), ...(t.page || {}), ...fields };
  return interpolate(tpl, vars, null);
}

// Render a GFM-alert callout (NOTE/TIP/WARN). `title` is the optional inline
// heading after the marker; empty -> the variant's default label.
function renderCallout(t, variant, title, body) {
  const spec = CALLOUT_VARIANTS[variant];
  if (!spec) return '';
  const p = (t && t.palette) || {};
  const bar = spec.bar || p.accent || '#555555';
  const bg = spec.bg || p.bgSoft || '#f7f7f7';
  const titleText = title && title.trim() ? title.trim() : spec.label;
  const titleHtml = renderInline(titleText, t);
  const bodyHtml = body && body.trim() ? renderInline(body, t).replace(/\n/g, '<br />') : '';
  return renderComponent(t, 'callout', { bar, bg, icon: spec.icon, title: titleHtml, content: bodyHtml });
}

// -----------------------------------------------------------------------------
// Core: markdown string -> inline-styled 公众号 HTML fragment.
// opts: { title, theme, onWarn }
// -----------------------------------------------------------------------------
export function renderWechatHtml(markdown, opts = {}) {
  const { theme: t, pageStyle, warnings } = resolveTheme(opts.theme);
  if (warnings.length) {
    if (typeof opts.onWarn === 'function') opts.onWarn(warnings);
    else if (opts.theme) {
      // Only warn when a user theme was actually supplied (default has no unknowns).
      process.stderr.write(`⚠️  theme: unknown token(s) left as-is: ${warnings.map((w) => `{{${w}}}`).join(', ')}\n`);
    }
  }

  const src = String(markdown).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out = [];
  let i = 0;

  const pushTitle = () => {
    if (opts.title) {
      out.push(block(t, 'h1', `<h1 style="${elStyle(t, 'h1')}">${renderInline(String(opts.title), t)}</h1>`));
    }
  };
  pushTitle();

  while (i < lines.length) {
    let line = lines[i];

    // Blank line — skip (block spacing handled via margins).
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block: ``` or ~~~
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w-]*)\s*$/);
    if (fence) {
      const fenceMark = fence[1][0];
      const codeLines = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fenceMark}{3,}\\s*$`).test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      out.push(block(t, 'pre', `<pre style="${elStyle(t, 'pre')}"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`));
      continue;
    }

    // Block component container: `:::组件名 [inline]` ... `:::`.
    // Backward-compatible: prose almost never starts a line with ":::", and an
    // UNKNOWN component name never consumes a block — it is emitted verbatim + a
    // warning, so pure-markdown output is unchanged.
    const dir = line.match(/^:::\s*(\S+)\s*(.*)$/);
    if (dir) {
      const rawName = dir[1];
      const inlineRest = (dir[2] || '').trim();
      const comp = COMPONENT_ALIASES[rawName.toLowerCase()] || COMPONENT_ALIASES[rawName];
      if (!comp) {
        if (typeof opts.onWarn === 'function') opts.onWarn([`未知组件 :::${rawName}`]);
        out.push(block(t, 'p', `<p style="${elStyle(t, 'p')}">${renderInline(line, t)}</p>`));
        i++;
        continue;
      }
      i++; // consume the opening ::: line
      if (comp === 'divider') {
        out.push(renderComponent(t, 'fancyDivider', {}));
        if (i < lines.length && /^:::\s*$/.test(lines[i])) i++; // tolerate a stray closer
        continue;
      }
      // Container components: collect body lines until a lone closing ":::".
      const bodyLines = [];
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
        bodyLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing :::
      const bodyRaw = bodyLines.join('\n').trim();
      if (comp === 'title') {
        const titleText = inlineRest || bodyRaw;
        out.push(renderComponent(t, 'fancyTitle', { content: renderInline(titleText, t) }));
      } else if (comp === 'follow') {
        const copy = bodyRaw || inlineRest || DEFAULT_FOLLOW_COPY;
        out.push(renderComponent(t, 'followCard', { content: renderInline(copy, t).replace(/\n/g, '<br />') }));
      } else if (comp === 'quote') {
        const quoteText = bodyRaw || inlineRest;
        out.push(renderComponent(t, 'quoteCard', { content: renderInline(quoteText, t).replace(/\n/g, '<br />') }));
      }
      continue;
    }

    // Horizontal rule: ---, ***, ___ (3+) — replaced entirely by theme hr.html.
    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      const hrHtml = (t.elements.hr && typeof t.elements.hr.html === 'string' && t.elements.hr.html) || '<hr />';
      out.push(hrHtml);
      i++;
      continue;
    }

    // ATX headings h1-h4 (h5/h6 collapse to h4 styling).
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length, 4);
      const key = `h${level}`;
      out.push(block(t, key, `<${key} style="${elStyle(t, key)}">${renderInline(h[2].trim(), t)}</${key}>`));
      i++;
      continue;
    }

    // Blockquote (collect consecutive > lines).
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      // GFM alert -> callout component. `> [!NOTE] optional title` + body lines.
      const alert = quoteLines[0] && quoteLines[0].match(/^\[!(NOTE|TIP|WARN|WARNING|CAUTION|IMPORTANT)\]\s*(.*)$/i);
      if (alert) {
        const kind = alert[1].toUpperCase();
        const variant =
          kind === 'TIP' ? 'tip' : kind === 'WARN' || kind === 'WARNING' || kind === 'CAUTION' ? 'warn' : 'note';
        const alertTitle = alert[2].trim();
        const alertBody = quoteLines.slice(1).join('\n').trim();
        out.push(renderCallout(t, variant, alertTitle, alertBody));
        continue;
      }
      const inner = quoteLines
        .join('\n')
        .split(/\n{2,}/)
        .map((para) => `<p style="${elStyle(t, 'p')}margin-bottom:8px;">${renderInline(para.trim(), t)}</p>`)
        .join('');
      out.push(block(t, 'blockquote', `<blockquote style="${elStyle(t, 'blockquote')}">${inner}</blockquote>`));
      continue;
    }

    // Lists (unordered / ordered), one level of nesting.
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const items = [];
      let cur = null;
      while (i < lines.length && (UL_RE.test(lines[i]) || OL_RE.test(lines[i]))) {
        const m = lines[i].match(UL_RE) || lines[i].match(OL_RE);
        const indent = m[1].replace(/\t/g, '    ').length;
        const childOrdered = OL_RE.test(lines[i]);
        if (indent >= 2 && cur) {
          cur.children.push({ text: m[2], children: [] });
          cur.childOrdered = childOrdered;
        } else {
          cur = { text: m[2], children: [], childOrdered: false };
          items.push(cur);
        }
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(block(t, tag, `<${tag} style="${elStyle(t, tag)}">${renderListItems(items, t)}</${tag}>`));
      continue;
    }

    // Raw HTML passthrough (pre-made snippet on its own line).
    if (isHtmlPassthrough(line)) {
      out.push(line.trim());
      i++;
      continue;
    }

    // Paragraph: gather consecutive non-blank, non-block lines.
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(```+|~~~+)/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i]) &&
      !/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(lines[i]) &&
      !/^:::\s*\S/.test(lines[i]) &&
      !isHtmlPassthrough(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) {
      out.push(block(t, 'p', `<p style="${elStyle(t, 'p')}">${renderInline(paraLines.join('\n'), t)}</p>`));
    }
  }

  // Single wrapper <section> carries base typography so children inherit it.
  let fragment = `<section style="${pageStyle}">\n${out.join('\n')}\n</section>`;

  // Optional decorative wrap around the WHOLE fragment.
  const aw = (t.decorations && t.decorations.articleWrap) || {};
  const before = typeof aw.before === 'string' ? aw.before : '';
  const after = typeof aw.after === 'string' ? aw.after : '';
  if (before || after) fragment = `${before}${fragment}${after}`;

  return fragment;
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--check') args.check = true;
    else if (a === '--md') args.md = argv[++k];
    else if (a === '--out') args.out = argv[++k];
    else if (a === '--title') args.title = argv[++k];
    else if (a === '--theme') args.theme = argv[++k];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = `render-wechat-html.mjs — zero-dep, theme-driven Markdown -> 公众号 HTML

Usage:
  node render-wechat-html.mjs --md <input.md> [--out <output.html>] [--title <str>] [--theme <theme.json>]
  node render-wechat-html.mjs --check

Options:
  --md <file>       Markdown input file (required unless --check)
  --out <file>      Output HTML file (default: <input-basename>.wechat.html)
  --title <str>     Optional H1 title prepended to the article
  --theme <file>    theme.json to apply (see ../themes/THEME-SCHEMA.md). Omit for neutral defaults.
  --check           Print "ok" + node version and exit
  -h, --help        Show this help
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) {
    console.log(`ok node ${process.version}`);
    return;
  }
  if (args.help || !args.md) {
    console.log(HELP);
    if (!args.md && !args.help) process.exitCode = 1;
    return;
  }

  const mdPath = path.resolve(args.md);
  const markdown = await readFile(mdPath, 'utf8');

  let theme;
  if (args.theme) {
    const themeRaw = await readFile(path.resolve(args.theme), 'utf8');
    theme = JSON.parse(themeRaw);
  }

  const html = renderWechatHtml(markdown, { title: args.title, theme });

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(
        path.dirname(mdPath),
        `${path.basename(mdPath, path.extname(mdPath))}.wechat.html`,
      );

  await writeFile(outPath, html, 'utf8');
  console.log(outPath);
}

// Run as CLI only when invoked directly (not when imported).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
