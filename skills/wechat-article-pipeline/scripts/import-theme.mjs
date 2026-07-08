#!/usr/bin/env node
// import-theme.mjs
// -----------------------------------------------------------------------------
// Zero-dependency THEME-FORMAT IMPORTER for the 都爆鸭 (doubaoya) community
// `wechat-article-pipeline` skill. It converts open-source community theme
// formats into our `theme.json` contract (see ../themes/THEME-SCHEMA.md), so
// users can bring their own themes from the two most common ecosystems:
//
//   * wewrite-yaml  — oaker-io/wewrite `toolkit/themes/*.yaml`  (MIT)
//                     a `colors:` map + a literal `base_css: |` stylesheet.
//   * doocs-css     — doocs/md `theme-css/*.css`                 (WTFPL)
//                     a color-agnostic CSS stylesheet driven by CSS variables
//                     (`var(--md-primary-color)` = accent). doocs grace/simple
//                     are DIFFS over default.css — pass `--base default.css`.
//
// The output ALWAYS obeys THEME-SCHEMA.md and passes `validate-theme.mjs`:
//   inline-style only; no class=/id=/<script>/<style>/event-handlers; never
//   emits an image `src=` (themes carry no images); palette values are colors.
//
//   Runtime: Node >= 18. Node builtins ONLY. No npm deps, no YAML/CSS library.
//
// CLI:
//   node import-theme.mjs --from <file> [--format wewrite-yaml|doocs-css|auto]
//        --out <theme.json> [--name <display name>] [--base <doocs default.css>]
//        [--accent <#hex>]        (doocs-css only; the accent to synthesize)
//
// Examples:
//   node import-theme.mjs --from wewrite_theme_sspai.yaml --out ../themes/wewrite-sspai.json
//   node import-theme.mjs --from doocs_theme-css_default.css --out ../themes/doocs-classic.json --accent '#2d6da3'
//   node import-theme.mjs --from doocs_theme-css_grace.css --base doocs_theme-css_default.css \
//        --out ../themes/doocs-grace.json --accent '#6a4c93'
//
// API:
//   import { importWewriteYaml, importDoocsCss } from './import-theme.mjs'
// -----------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// -----------------------------------------------------------------------------
// Small color helpers (pure). Mirror wewrite's learn_theme.py primitives.
// -----------------------------------------------------------------------------
function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  let s = hex.trim().toLowerCase();
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return '#' + s;
}

function hexToRgb(hex) {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

// HSL lightness helpers (preserve hue+sat; only move L). Standard HSL.
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

// Set lightness of a hex, preserving hue+sat. Returns a #rrggbb string.
function adjustLightness(hex, targetL) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  hsl.l = Math.max(0, Math.min(1, targetL));
  return rgbToHex(hslToRgb(hsl));
}

function lightnessOf(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return rgbToHsl(rgb).l;
}

// A tint of a hex color at alpha `a` (0..1), emitted as rgba() — used to
// resolve doocs `color-mix(in srgb, <c> N%, transparent)`.
function rgbaTint(hex, a) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const round = (v) => Math.round(v);
  return `rgba(${round(rgb.r)}, ${round(rgb.g)}, ${round(rgb.b)}, ${a})`;
}

// -----------------------------------------------------------------------------
// Focused YAML parser for wewrite's known shape:
//   name:/description: scalars, a `colors:` map, an optional `darkmode:` map
//   (top-level OR nested under colors — the warm-editorial / professional-clean
//   quirk), and a `base_css: |` literal block scalar.
// This is NOT a general YAML parser; it deliberately understands only that shape
// and errors clearly on anything it cannot make sense of.
// -----------------------------------------------------------------------------
function stripQuotes(v) {
  if (typeof v !== 'string') return v;
  let s = v.trim();
  // strip a trailing line comment when the value is not quoted
  if (!(s.startsWith('"') || s.startsWith("'"))) {
    const hash = s.indexOf(' #');
    if (hash >= 0) s = s.slice(0, hash).trim();
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

export function parseWewriteYaml(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const result = { name: '', description: '', colors: {}, darkmode: {}, base_css: '' };
  let i = 0;
  let sawKey = false;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) { i++; continue; }

    // top-level key (no indentation)
    if (indentOf(line) === 0) {
      const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) { i++; continue; }
      const key = m[1];
      const rawVal = m[2];
      sawKey = true;

      if (key === 'base_css') {
        // block scalar: `|`, `|-`, `|+` or (tolerated) empty
        i++;
        const blockLines = [];
        let blockIndent = null;
        while (i < lines.length) {
          const l = lines[i];
          if (l.trim() === '') { blockLines.push(''); i++; continue; }
          if (indentOf(l) === 0) break; // dedent to top-level => block ended
          if (blockIndent === null) blockIndent = indentOf(l);
          blockLines.push(l.slice(blockIndent));
          i++;
        }
        // trim trailing blank lines
        while (blockLines.length && blockLines[blockLines.length - 1] === '') blockLines.pop();
        result.base_css = blockLines.join('\n');
        continue;
      }

      if (key === 'colors' || key === 'darkmode') {
        i++;
        const map = {};
        while (i < lines.length) {
          const l = lines[i];
          if (l.trim() === '') { i++; continue; }
          if (indentOf(l) === 0) break; // dedent => map ended
          const childIndent = indentOf(l);
          const mm = l.match(/^\s*([A-Za-z_][\w-]*):\s*(.*)$/);
          if (!mm) { i++; continue; }
          const k2 = mm[1];
          const v2 = mm[2];
          // Nested darkmode block under colors (warm-editorial / professional-clean quirk).
          if (k2 === 'darkmode' && stripQuotes(v2) === '') {
            i++;
            const dmap = {};
            while (i < lines.length) {
              const l3 = lines[i];
              if (l3.trim() === '') { i++; continue; }
              if (indentOf(l3) <= childIndent) break;
              const m3 = l3.match(/^\s*([A-Za-z_][\w-]*):\s*(.*)$/);
              if (m3) dmap[m3[1]] = stripQuotes(m3[2]);
              i++;
            }
            if (key === 'colors') result.darkmode = dmap;
            continue;
          }
          map[k2] = stripQuotes(v2);
          i++;
        }
        if (key === 'colors') result.colors = { ...map, ...result.colors };
        else result.darkmode = map;
        continue;
      }

      // plain scalar
      result[key] = stripQuotes(rawVal);
      i++;
      continue;
    }

    i++;
  }

  if (!sawKey) throw new Error('not a wewrite YAML: no top-level keys found.');
  if (!result.base_css) throw new Error('not a wewrite YAML: missing a `base_css: |` block.');
  return result;
}

// -----------------------------------------------------------------------------
// Minimal CSS parser: string -> { selector: {prop: value, ...}, ... }
// Splits comma selector lists into one entry per selector (last write wins for
// a repeated prop). Strips /* comments */. Good enough for the well-formed
// wewrite base_css and doocs theme CSS we ingest.
// -----------------------------------------------------------------------------
export function parseCss(text) {
  const clean = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = {};
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(clean))) {
    const selectorList = m[1].trim();
    const body = m[2];
    const decls = {};
    for (const part of body.split(';')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const prop = part.slice(0, idx).trim().toLowerCase();
      let val = part.slice(idx + 1).trim();
      if (!prop || val === '') continue;
      val = val.replace(/\s*!important\s*$/i, '').trim();
      decls[prop] = val;
    }
    if (!Object.keys(decls).length) continue;
    for (const sel of selectorList.split(',')) {
      const s = sel.trim();
      if (!s) continue;
      rules[s] = { ...(rules[s] || {}), ...decls };
    }
  }
  return rules;
}

// The renderer emits `style="..."` with double quotes, so any `"` inside a CSS
// value (e.g. a "Segoe UI" font stack) would break the attribute. Normalize to
// single quotes everywhere we emit CSS.
function sanitizeCss(s) {
  return String(s).replace(/"/g, "'");
}

// Serialize a decls object to an inline-style string in insertion order,
// skipping any prop in `drop` and any empty value.
function declsToStyle(decls, drop = new Set()) {
  const parts = [];
  for (const [prop, val] of Object.entries(decls)) {
    if (drop.has(prop)) continue;
    if (val == null || String(val).trim() === '') continue;
    parts.push(`${prop}:${sanitizeCss(val)};`);
  }
  return parts.join('');
}

// Build the `hr.html` decorative divider from an hr decls dict (values already
// resolved/tokenized). Reconstructs a 公众号-safe <section> hairline.
function buildHrHtml(decls) {
  let margin = decls.margin || '24px 0';
  const width = decls.width ? `width:${decls.width};` : '';
  if (width && !/auto/.test(margin)) {
    const parts = margin.split(/\s+/);
    if (parts.length === 2) margin = `${parts[0]} auto`;
  }
  let body;
  if (decls.background && /gradient/i.test(decls.background)) {
    body = `height:1px;border:none;background:${decls.background};`;
  } else if (decls.background && decls.background !== 'transparent' && !decls['border-top'] && !decls['border-bottom']) {
    body = `height:${decls.height || '2px'};border:none;background:${decls.background};`;
  } else if (decls['border-bottom'] && !decls['border-top']) {
    body = `border:none;border-bottom:${decls['border-bottom']};height:${decls.height && decls.height !== '0' ? decls.height : '0'};`;
  } else {
    const bt = decls['border-top'];
    const safeBt = bt && !/scale|transform/i.test(bt) ? bt : '1px solid {{border}}';
    body = `border:none;border-top:${safeBt};`;
  }
  return `<section style="${body}${width}margin:${margin};"></section>`;
}

// -----------------------------------------------------------------------------
// wewrite-yaml -> theme.json
// -----------------------------------------------------------------------------
export function importWewriteYaml(text, opts = {}) {
  const parsed = parseWewriteYaml(text);
  const colors = parsed.colors || {};
  const css = parseCss(parsed.base_css);

  const displayName = opts.name || parsed.name || 'imported';
  const warnings = [];

  // --- palette ---
  const headingColor = normalizeHex((css.h1 && css.h1.color) || '') || '#1a1a1a';
  const linkColor = normalizeHex((css.a && css.a.color) || '') || colors.primary || '#576b95';
  const bg = normalizeHex(colors.background || (css.body && css.body.background) || '') || '#ffffff';

  const palette = {};
  const put = (k, v) => { const n = normalizeHex(v); if (n) palette[k] = n; };
  put('text', colors.text);
  put('heading', headingColor);
  put('accent', colors.primary);
  put('accent2', colors.secondary);
  put('muted', colors.text_light);
  put('bgSoft', colors.quote_bg);
  put('border', colors.quote_border);
  put('link', linkColor);
  if (colors.code_bg) put('codeBg', colors.code_bg);
  if (colors.code_color) put('codeColor', colors.code_color);
  const bgIsWhite = ['#ffffff', '#fff'].includes(bg.toLowerCase());
  if (!bgIsWhite) put('pageBg', bg);

  // --- tokenization map: each DISTINCT hex -> exactly one {{token}} (priority) ---
  const priority = [
    ['accent', colors.primary],
    ['accent2', colors.secondary],
    ['text', colors.text],
    ['muted', colors.text_light],
    ['bgSoft', colors.quote_bg],
    ['border', colors.quote_border],
    ['codeBg', colors.code_bg],
    ['codeColor', colors.code_color],
    ['pageBg', bgIsWhite ? null : bg],
    ['heading', headingColor],
    ['link', linkColor],
  ];
  const hexToToken = new Map();
  for (const [token, raw] of priority) {
    const n = normalizeHex(raw || '');
    if (!n) continue;
    if (!hexToToken.has(n)) hexToToken.set(n, `{{${token}}}`);
  }
  const tokenize = (val) =>
    String(val).replace(/#[0-9a-fA-F]{3,6}\b/g, (hx) => {
      const n = normalizeHex(hx);
      return (n && hexToToken.get(n)) || hx;
    });
  const tokenizeDecls = (decls) => {
    const out = {};
    for (const [p, v] of Object.entries(decls)) out[p] = tokenize(v);
    return out;
  };

  // --- page (from body) ---
  const body = css.body || {};
  const page = {
    fontFamily: body['font-family'] ? sanitizeCss(body['font-family']) : undefined,
    fontSize: body['font-size'] || '16px',
    lineHeight: body['line-height'] || '1.75',
    color: '{{text}}',
  };
  if (body['letter-spacing'] && body['letter-spacing'] !== '0' && body['letter-spacing'] !== '0px') {
    page.letterSpacing = body['letter-spacing'];
  }
  for (const k of Object.keys(page)) if (page[k] === undefined) delete page[k];

  // --- elements ---
  const elements = {};
  const simpleTags = ['h1', 'h2', 'h3', 'h4', 'p', 'strong', 'em', 'code', 'blockquote', 'ul', 'ol', 'li', 'img'];
  const dropCommon = new Set(['word-wrap', 'word-break']);
  for (const tag of simpleTags) {
    if (!css[tag]) continue;
    const style = declsToStyle(tokenizeDecls(css[tag]), dropCommon);
    if (style) elements[tag] = { style };
  }

  // pre: merge `pre code` font-family (our renderer emits <pre><code> with the
  // code unstyled, so the mono font must live on <pre>).
  if (css.pre) {
    const preDecls = { ...css.pre };
    const preCode = css['pre code'] || css['pre>code'];
    if (preCode && preCode['font-family'] && !preDecls['font-family']) {
      preDecls['font-family'] = preCode['font-family'];
    }
    if (!preDecls['white-space']) preDecls['white-space'] = 'pre-wrap';
    if (!preDecls['word-break']) preDecls['word-break'] = 'break-all';
    const style = declsToStyle(tokenizeDecls(preDecls));
    if (style) elements.pre = { style };
  }

  // a
  if (css.a) elements.a = { style: declsToStyle(tokenizeDecls(css.a), dropCommon) };

  // img: keep as bare <img>; add a caption figure only if the theme centers it.
  // (wewrite themes have no caption styling, so leave figure/caption unset.)

  // hr -> html
  if (css.hr) elements.hr = { html: buildHrHtml(tokenizeDecls(css.hr)) };

  // Log dropped selectors we don't model (tables).
  for (const sel of ['table', 'thead', 'th', 'td', 'tr']) {
    if (css[sel]) warnings.push(`skipped unsupported selector "${sel}" (our schema has no table tag).`);
  }

  // --- decorations: wrap the article in a card iff the source has a page bg ---
  const decorations = {};
  if (!bgIsWhite) {
    decorations.articleWrap = {
      before: `<section style="background:{{pageBg}};padding:24px 20px;">`,
      after: `</section>`,
    };
  }

  const theme = {
    meta: {
      name: displayName,
      source: `https://github.com/oaker-io/wewrite (MIT) — theme "${parsed.name || displayName}"`,
      notes:
        `${parsed.description ? parsed.description + ' ' : ''}` +
        `Ported from oaker-io/wewrite by import-theme.mjs (wewrite-yaml). ` +
        `MIT License, Copyright (c) 2026 OpenClaw. See themes/LICENSE-wewrite and themes/CREDITS.md.`,
    },
    palette,
    page,
    elements,
  };
  if (Object.keys(decorations).length) theme.decorations = decorations;
  return { theme, warnings };
}

// -----------------------------------------------------------------------------
// doocs-css -> theme.json
//   doocs themes are color-agnostic (accent = --md-primary-color). grace/simple
//   are DIFFS over default.css, so pass the default via `baseCss`.
// -----------------------------------------------------------------------------
const DOOCS_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif";
const DOOCS_MONO = "'Fira Code', Menlo, Consolas, Monaco, 'Courier New', monospace";

export function importDoocsCss(text, opts = {}) {
  const baseCss = opts.baseCss ? parseCss(opts.baseCss) : {};
  const diffCss = parseCss(text);
  // Cascade: default first, per-prop override by the theme's own rules.
  const css = {};
  for (const [sel, decls] of Object.entries(baseCss)) css[sel] = { ...decls };
  for (const [sel, decls] of Object.entries(diffCss)) css[sel] = { ...(css[sel] || {}), ...decls };

  const displayName = opts.name || 'doocs';
  const accent = normalizeHex(opts.accent || '#2d6da3') || '#2d6da3';
  const accent2 = adjustLightness(accent, Math.min(lightnessOf(accent) + 0.12, 0.9));
  const warnings = [];

  const palette = {
    text: '#3f3f3f',
    heading: '#1a1a1a',
    accent,
    accent2,
    muted: '#8a8a8a',
    bgSoft: '#f7f4ef',
    border: '#e6e2da',
    link: '#576b95',
  };

  const accentRgb = hexToRgb(accent);
  const textRgb = hexToRgb(palette.text);

  // Resolve a doocs CSS value: CSS-vars -> our {{tokens}}, calc() -> px,
  // color-mix() -> rgba() tint, WeChat-blue link -> {{link}}.
  const resolveVal = (val, { isHeading }) => {
    let v = String(val);
    // color-mix() FIRST — it wraps the var() we would otherwise rewrite, so we
    // must compute the tint before the plain var() substitutions below.
    v = v.replace(/color-mix\(\s*in srgb,\s*var\(--md-primary-color\)\s*([\d.]+)%\s*,\s*transparent\s*\)/gi,
      (_m, pct) => rgbaTint(accent, +(parseFloat(pct) / 100).toFixed(3)));
    v = v.replace(/color-mix\(\s*in srgb,\s*hsl\(var\(--foreground\)\)\s*([\d.]+)%\s*,\s*transparent\s*\)/gi,
      (_m, pct) => rgbaTint(palette.text, +(parseFloat(pct) / 100).toFixed(3)));
    // any other color-mix we can't model -> a safe hairline color
    v = v.replace(/color-mix\([^)]*\)/gi, '{{border}}');
    v = v.replace(/var\(--md-primary-color\)/g, '{{accent}}');
    v = v.replace(/var\(--blockquote-background\)/g, '{{bgSoft}}');
    v = v.replace(/hsl\(var\(--foreground\)\)/g, isHeading ? '{{heading}}' : '{{text}}');
    v = v.replace(/calc\(\s*var\(--md-font-size\)\s*\*\s*([\d.]+)\s*\)/g, (_m, k) => Math.round(16 * parseFloat(k)) + 'px');
    v = v.replace(/var\(--md-font-size\)/g, '16px');
    v = v.replace(/#576b95/gi, '{{link}}');
    return v;
  };

  const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4']);
  const dropProps = new Set([
    'display', 'transform', 'transform-origin', '-webkit-transform', '-webkit-transform-origin',
    'border-style', 'border-width', 'border-color', '-webkit-box-orient', '-webkit-line-clamp',
  ]);

  const styleFromDecls = (sel, decls, { keepDisplay = false } = {}) => {
    const isHeading = HEADINGS.has(sel);
    const parts = [];
    for (const [prop, raw] of Object.entries(decls)) {
      if (prop === 'display' && keepDisplay) {
        // keep only non-table displays
        if (/table/i.test(raw)) continue;
        parts.push(`${prop}:${sanitizeCss(resolveVal(raw, { isHeading }))};`);
        continue;
      }
      if (dropProps.has(prop)) continue;
      const v = resolveVal(raw, { isHeading });
      if (v != null && v.trim() !== '') parts.push(`${prop}:${sanitizeCss(v)};`);
    }
    return parts.join('');
  };

  const elements = {};

  // Headings h1..h4
  for (const tag of ['h1', 'h2', 'h3', 'h4']) {
    if (!css[tag]) continue;
    let style = styleFromDecls(tag, css[tag]);
    if (tag === 'h2') {
      // doocs signature: solid-accent block with white text. Ensure it reads
      // reliably in 公众号 (vertical padding + rounded corners).
      if (!/border-radius/.test(style)) style += 'border-radius:4px;';
      if (/padding:\s*0\s/.test(style) || !/padding/.test(style)) {
        style = style.replace(/padding:[^;]*;/, '') + 'padding:6px 14px;';
      }
    }
    if (style) elements[tag] = { style };
  }

  // p (+ hoist letter-spacing to page)
  let pageLetter = null;
  if (css.p) {
    const pDecls = { ...css.p };
    if (pDecls['letter-spacing']) { pageLetter = pDecls['letter-spacing']; delete pDecls['letter-spacing']; }
    const style = styleFromDecls('p', pDecls);
    if (style) elements.p = { style };
  }

  // blockquote
  if (css.blockquote) elements.blockquote = { style: styleFromDecls('blockquote', css.blockquote) };

  // lists
  for (const tag of ['ul', 'ol']) if (css[tag]) elements[tag] = { style: styleFromDecls(tag, css[tag]) };
  if (css.li) {
    // doocs sets li{display:block} which kills the native bullet — drop it.
    const liDecls = { ...css.li };
    delete liDecls.display;
    elements.li = { style: styleFromDecls('li', liDecls) };
  }

  // strong / em
  if (css.strong) elements.strong = { style: styleFromDecls('strong', css.strong) };
  if (css.em) elements.em = { style: styleFromDecls('em', css.em) };

  // inline code (.codespan) -> our code; add a mono font-family fallback.
  const codeSel = css['.codespan'] || css.code;
  if (codeSel) {
    const cDecls = { ...codeSel };
    if (!cDecls['font-family']) cDecls['font-family'] = DOOCS_MONO;
    elements.code = { style: styleFromDecls('code', cDecls) };
  }

  // pre (pre.code__pre / .hljs.code__pre). doocs relies on a highlight theme for
  // bg/color; inject 公众号-safe fallbacks so a bare <pre><code> still reads.
  const preSel = css['pre.code__pre'] || css['.hljs.code__pre'] || css.pre;
  if (preSel) {
    const pDecls = { ...preSel };
    delete pDecls.padding; // often `0 !important`
    if (!pDecls['background']) pDecls['background'] = '#f6f6f6';
    if (!pDecls['color']) pDecls['color'] = '{{text}}';
    if (!pDecls['font-family']) pDecls['font-family'] = DOOCS_MONO;
    if (!pDecls['font-size']) pDecls['font-size'] = '90%';
    if (!pDecls['white-space']) pDecls['white-space'] = 'pre-wrap';
    if (!pDecls['word-break']) pDecls['word-break'] = 'break-all';
    pDecls['padding'] = '14px 16px';
    elements.pre = { style: styleFromDecls('pre', pDecls) };
  }

  // links
  if (css.a) elements.a = { style: styleFromDecls('a', css.a) };

  // img (+ figure/caption from doocs figure/figcaption)
  if (css.img) {
    const imgDecls = { ...css.img };
    const img = { style: styleFromDecls('img', imgDecls, { keepDisplay: true }) };
    const figcap = css.figcaption || css['.md-figcaption'];
    if (css.figure) img.figureStyle = 'text-align:center;margin:1.5em 0;';
    if (figcap) img.captionStyle = styleFromDecls('figcaption', figcap) || 'text-align:center;font-size:0.8em;color:{{muted}};';
    elements.img = img;
  }

  // hr -> html
  if (css.hr) {
    const hrDecls = {};
    for (const [p, v] of Object.entries(css.hr)) hrDecls[p] = resolveVal(v, { isHeading: false });
    elements.hr = { html: buildHrHtml(hrDecls) };
  }

  const page = {
    fontFamily: DOOCS_SANS,
    fontSize: '16px',
    lineHeight: '1.75',
    letterSpacing: pageLetter || '0.1em',
    color: '{{text}}',
  };

  const theme = {
    meta: {
      name: displayName,
      source: `https://github.com/doocs/md (WTFPL) — theme "${opts.themeKey || displayName}"`,
      notes:
        `Layout/typography ported from doocs/md by import-theme.mjs (doocs-css). ` +
        `doocs is color-agnostic; accent "${accent}" chosen for this port. ` +
        `WTFPL, Copyright (C) 2025 Doocs <admin@doocs.org>. See themes/CREDITS.md.`,
    },
    palette,
    page,
    elements,
  };
  return { theme, warnings };
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--from') args.from = argv[++k];
    else if (a === '--out') args.out = argv[++k];
    else if (a === '--format') args.format = argv[++k];
    else if (a === '--name') args.name = argv[++k];
    else if (a === '--base') args.base = argv[++k];
    else if (a === '--accent') args.accent = argv[++k];
    else if (a === '--theme-key') args.themeKey = argv[++k];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = `import-theme.mjs — zero-dep community-theme -> theme.json importer

Usage:
  node import-theme.mjs --from <file> [--format wewrite-yaml|doocs-css|auto] \\
       --out <theme.json> [--name <display name>] [--base <doocs default.css>] [--accent <#hex>]

Formats:
  wewrite-yaml   oaker-io/wewrite toolkit/themes/*.yaml (MIT)  — colors map + base_css stylesheet
  doocs-css      doocs/md theme-css/*.css (WTFPL)             — CSS-var-driven; grace/simple are
                 diffs over default.css, so pass --base <default.css> and an --accent to synthesize.
  auto (default) .yaml/.yml => wewrite-yaml, .css => doocs-css.

The output always obeys ../themes/THEME-SCHEMA.md and passes validate-theme.mjs.
`;

function detectFormat(file, explicit) {
  if (explicit && explicit !== 'auto') return explicit;
  const ext = path.extname(file).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') return 'wewrite-yaml';
  if (ext === '.css') return 'doocs-css';
  throw new Error(`cannot auto-detect format for "${file}" (use --format wewrite-yaml|doocs-css).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.from) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }
  if (!args.out) {
    process.stderr.write('❌ --out <theme.json> is required.\n');
    process.exit(1);
  }

  let raw;
  try {
    raw = await readFile(path.resolve(args.from), 'utf8');
  } catch (e) {
    process.stderr.write(`❌ cannot read ${args.from}: ${e.message}\n`);
    process.exit(2);
  }

  let format;
  try {
    format = detectFormat(args.from, args.format);
  } catch (e) {
    process.stderr.write(`❌ ${e.message}\n`);
    process.exit(1);
  }

  let result;
  try {
    if (format === 'wewrite-yaml') {
      result = importWewriteYaml(raw, { name: args.name });
    } else if (format === 'doocs-css') {
      let baseCss;
      if (args.base) baseCss = await readFile(path.resolve(args.base), 'utf8');
      result = importDoocsCss(raw, {
        name: args.name,
        baseCss,
        accent: args.accent,
        themeKey: args.themeKey || args.name,
      });
    } else {
      throw new Error(`unknown format "${format}".`);
    }
  } catch (e) {
    process.stderr.write(`❌ import failed: ${e.message}\n`);
    process.exit(1);
  }

  for (const w of result.warnings || []) process.stderr.write(`⚠️  ${w}\n`);

  const json = JSON.stringify(result.theme, null, 2) + '\n';
  await writeFile(path.resolve(args.out), json, 'utf8');
  process.stdout.write(`✅ wrote ${args.out} (format: ${format}).\n`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(2);
  });
}
