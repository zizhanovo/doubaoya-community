#!/usr/bin/env node
// validate-theme.mjs
// -----------------------------------------------------------------------------
// Zero-dependency validator for a 公众号 theme.json (see ../themes/THEME-SCHEMA.md).
//
// It enforces the schema shape AND the 公众号 safety rules a theme must obey:
//   * 公众号 strips <style>/<head>/class-based CSS — a theme that injects
//     <script>/<style>/class= is unsafe and rejected.
//   * The renderer keeps every image src verbatim (the downstream publish stage
//     uploads local images) — a theme that injects an image src (tries to rewrite
//     images) breaks that composition boundary and is rejected.
//
// CLI:
//   node validate-theme.mjs <theme.json>
//     → prints errors/warnings; exit 0 if valid, non-zero on hard errors.
//
// API:
//   import { validateTheme } from './validate-theme.mjs'
//   const { errors, warnings } = validateTheme(themeObj)   // errors.length===0 => valid
// -----------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const TOP_LEVEL_KEYS = new Set(['meta', 'palette', 'page', 'elements', 'decorations', 'components', 'tokens']);

// ⚠️⚠️ 社区仓独有硬闸（engine-2 拒收）——从主仓 re-sync/mirror 时必须保留本块 ⚠️⚠️
// 主仓（doubaoyahub）渲染器支持 engine 2，故主仓版本的 validateTheme **没有**这道闸；
// 本仓渲染器是 engine 1：不认识 meta.engine:2 / tokens 三层 / 带点号 token（渲染时
// 点号 token 原样留在 HTML 里，静默毁版）。所以 engine-2 主题在这里必须硬拦（error
// 而非 warning），指路服务端编译版。冲掉本块（ENGINE2_HINT 与它的三处 errors.push）
// = engine-2 主题重新静默烂 HTML 进草稿箱——selfcheck-remote-theme.mjs 第 5 项守着它，
// re-sync 后跑一遍自检即可发现。
const ENGINE2_HINT =
  '此主题为 engine 2，本机渲染器（engine 1）不认识它，渲染会把 {{ref.xxx}} 原样留在正文里。' +
  '需要服务端编译版：配置 DOUBAOYA_API_KEY 后由流水线自动拉取，或 GET /api/wechat/theme?format=compiled。';
const PALETTE_KEYS = new Set(['text', 'heading', 'accent', 'accent2', 'muted', 'bgSoft', 'border', 'link']);
// NOTE: this list only decides whether an `elements.<tag>` key gets a
// "not a recognized tag" WARNING — it is not part of the safety boundary
// (that's UNSAFE_PATTERNS below). h5/h6 and table/th/td joined it when the
// renderer stopped collapsing h5/h6 into h4 and gained GFM table support.
const ELEMENT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li', 'img', 'hr',
  'strong', 'em', 'del', 'a', 'code', 'pre', 'table', 'th', 'td',
]);
const PAGE_KEYS = new Set(['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'color']);

// A CSS color-ish value: #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba()/hsl()/hsla(),
// a common CSS named color, `transparent`, `currentColor`, or a {{token}}.
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/;
const TOKEN_RE = /^\{\{\s*[\w.-]+\s*\}\}$/;
const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'inherit', 'black', 'white', 'red', 'green', 'blue',
  'gray', 'grey', 'silver', 'gold', 'orange', 'yellow', 'purple', 'pink', 'brown',
  'navy', 'teal', 'olive', 'maroon', 'lime', 'aqua', 'cyan', 'magenta', 'beige',
  'ivory', 'coral', 'salmon', 'khaki', 'crimson', 'indigo', 'violet', 'tan',
]);

// Unsafe substrings that must never appear in ANY theme string.
// <script/<style/class=/id= are stripped-or-dangerous in 公众号; src= means the
// theme is trying to inject/rewrite an image, which violates the src-verbatim
// composition boundary.
const UNSAFE_PATTERNS = [
  { re: /<\s*script\b/i, label: '<script>' },
  { re: /<\s*style\b/i, label: '<style>' },
  { re: /\bclass\s*=/i, label: 'class=' },
  { re: /\bsrc\s*=/i, label: 'src= (image-src injection/rewrite)' },
  { re: /javascript:/i, label: 'javascript: URI' },
  { re: /\son\w+\s*=/i, label: 'inline event handler (onX=)' },
  // v2 新增 —— 这两条写下去在本地预览完全正常、发到公众号却会**静默毁版**：
  // 1) `--x:` 声明必被剥离，且写在首位会连带吃掉紧随其后的声明（矩阵 §3 实测
  //    `--px:#cc0000;color:#111111` 两条一起消失）。
  // 2) `url(data:…)` 会让**整个元素连同样式**被剥离，只剩裸文本（矩阵 §8）——
  //    比 <img src="data:"> 只剥 src 更狠。
  // 边界：这两条只管**主题字符串**。正文里的 <img src="data:…"> 不在扫描范围
  // （255 篇盘点无此类样本、内置主题也不产它，加了是投机）。
  { re: /(^|[;{"'\s])--[\w-]+\s*:/, label: 'CSS custom property declaration' },
  { re: /url\(\s*['"]?\s*data:/i, label: 'data: URI in url() (element gets stripped entirely)' },
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function looksLikeColor(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return HEX_RE.test(s) || FUNC_RE.test(s) || TOKEN_RE.test(s) || NAMED_COLORS.has(s.toLowerCase());
}

// Collect every {{token}} used across all string values.
function collectTokens(node, acc) {
  if (typeof node === 'string') {
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(node))) acc.add(m[1]);
  } else if (Array.isArray(node)) {
    for (const n of node) collectTokens(n, acc);
  } else if (isPlainObject(node)) {
    for (const k of Object.keys(node)) collectTokens(node[k], acc);
  }
}

// Walk every string value, calling fn(str, pathStr).
function walkStrings(node, pathStr, fn) {
  if (typeof node === 'string') fn(node, pathStr);
  else if (Array.isArray(node)) node.forEach((n, idx) => walkStrings(n, `${pathStr}[${idx}]`, fn));
  else if (isPlainObject(node)) {
    for (const k of Object.keys(node)) walkStrings(node[k], pathStr ? `${pathStr}.${k}` : k, fn);
  }
}

/**
 * Validate a theme object.
 * @returns {{ errors: string[], warnings: string[] }} errors.length === 0 => valid.
 */
export function validateTheme(theme) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(theme)) {
    errors.push('theme must be a JSON object (got ' + (Array.isArray(theme) ? 'array' : typeof theme) + ').');
    return { errors, warnings };
  }

  // 1. Top-level keys.
  for (const k of Object.keys(theme)) {
    if (!TOP_LEVEL_KEYS.has(k)) {
      errors.push(`unknown top-level key "${k}". Allowed: ${[...TOP_LEVEL_KEYS].join(', ')}.`);
    }
  }

  // 1b. meta.engine / meta.extends（v2）。engine 缺省 = 1（存量主题一个字都不用改）。
  const BASE_TEMPLATE_IDS = ['base-17@1'];   // 与 src/base-templates.mjs 同步；
                                             // 这里刻意**不 import** —— 本文件要能整份 mirror 到社区仓。
  const PAIR_ROLES = new Set(['body', 'large', 'mark', 'decor']);
  if (isPlainObject(theme.meta)) {
    const engine = theme.meta.engine;
    if (engine !== undefined && engine !== 1 && engine !== 2) {
      errors.push(`meta.engine 只能是 1 或 2（缺省 1），得到 ${JSON.stringify(engine)}。`);
    }
    if (engine === 2) {
      errors.push(`meta.engine === 2：${ENGINE2_HINT}`);
    }
    if (theme.meta.extends !== undefined) {
      if (engine !== 2) {
        errors.push('meta.extends 只有 meta.engine === 2 时才有意义。');
      } else if (!BASE_TEMPLATE_IDS.includes(theme.meta.extends)) {
        errors.push(`meta.extends ${JSON.stringify(theme.meta.extends)} 不是内置基线模板。可选：${BASE_TEMPLATE_IDS.join(', ')}。`);
      }
    }
  }

  // 1c. tokens 三层结构（v2）。带 tokens 的主题本机渲染不了 → 硬拦；后面的形状检查
  // 照跑，让报错更具体。
  if (theme.tokens !== undefined) {
    errors.push(`存在 top-level "tokens"：${ENGINE2_HINT}`);
    if (!isPlainObject(theme.tokens)) {
      errors.push('tokens must be an object.');
    } else {
      for (const k of Object.keys(theme.tokens)) {
        if (!['ref', 'sys', 'cmp', 'pairs'].includes(k)) {
          errors.push(`tokens.${k} is not a recognized token layer (ref, sys, cmp, pairs).`);
        }
      }
      const walkLayer = (layer, node, path) => {
        if (!isPlainObject(node)) return;
        for (const [k, v] of Object.entries(node)) {
          const p = `${path}.${k}`;
          if (typeof v === 'string') continue;
          if (isPlainObject(v) && typeof v.value === 'string') {
            if (layer === 'ref') errors.push(`${p}: tokens.ref 只接受字符串字面量。`);
            if (v.darkPolicy !== undefined && v.darkPolicy !== 'adapt' && v.darkPolicy !== 'lock') {
              errors.push(`${p}.darkPolicy 只能是 "adapt" 或 "lock"。`);
            }
            if (v.area !== undefined && v.area !== 'inline' && v.area !== 'block') {
              errors.push(`${p}.area 只能是 "inline" 或 "block"。`);
            }
            if (v.escapeHatch !== undefined && typeof v.escapeHatch !== 'boolean') {
              errors.push(`${p}.escapeHatch 必须是布尔值。`);
            }
            continue;
          }
          if (isPlainObject(v)) { walkLayer(layer, v, p); continue; }
          errors.push(`${p} must be a string or a token object with a string "value".`);
        }
      };
      for (const layer of ['ref', 'sys', 'cmp']) {
        if (theme.tokens[layer] !== undefined) {
          if (!isPlainObject(theme.tokens[layer])) errors.push(`tokens.${layer} must be an object.`);
          else walkLayer(layer, theme.tokens[layer], `tokens.${layer}`);
        }
      }
      if (theme.tokens.pairs !== undefined) {
        if (!Array.isArray(theme.tokens.pairs)) {
          errors.push('tokens.pairs must be an array of { fg, bg, role } objects.');
        } else {
          theme.tokens.pairs.forEach((p, i) => {
            if (!isPlainObject(p)) { errors.push(`tokens.pairs[${i}] must be an object.`); return; }
            for (const side of ['fg', 'bg']) {
              if (typeof p[side] !== 'string') errors.push(`tokens.pairs[${i}].${side} must be a token path string.`);
            }
            if (!PAIR_ROLES.has(p.role)) {
              errors.push(`tokens.pairs[${i}].role must be one of: ${[...PAIR_ROLES].join(', ')}.`);
            }
          });
        }
      }
    }
  }

  // 2. palette.
  if (theme.palette !== undefined) {
    if (!isPlainObject(theme.palette)) {
      errors.push('palette must be an object of color values.');
    } else {
      for (const [k, v] of Object.entries(theme.palette)) {
        if (!PALETTE_KEYS.has(k)) warnings.push(`palette.${k} is not a standard palette key (still usable as a {{${k}}} token).`);
        if (!looksLikeColor(v)) {
          errors.push(`palette.${k} = ${JSON.stringify(v)} does not look like a color (#hex, rgb()/hsl(), named, or {{token}}).`);
        }
      }
    }
  }

  // 3. page.
  if (theme.page !== undefined) {
    if (!isPlainObject(theme.page)) errors.push('page must be an object.');
    else {
      for (const k of Object.keys(theme.page)) {
        if (!PAGE_KEYS.has(k)) warnings.push(`page.${k} is not a recognized page key (${[...PAGE_KEYS].join(', ')}).`);
        if (typeof theme.page[k] !== 'string') errors.push(`page.${k} must be a string.`);
      }
    }
  }

  // 4. elements.
  if (theme.elements !== undefined) {
    if (!isPlainObject(theme.elements)) errors.push('elements must be an object keyed by tag.');
    else {
      for (const [tag, def] of Object.entries(theme.elements)) {
        if (!ELEMENT_TAGS.has(tag)) warnings.push(`elements.${tag} is not a recognized tag (ignored by the renderer).`);
        if (!isPlainObject(def)) {
          errors.push(`elements.${tag} must be an object.`);
          continue;
        }
        for (const [field, val] of Object.entries(def)) {
          if (typeof val !== 'string') {
            errors.push(`elements.${tag}.${field} must be a string.`);
            continue;
          }
          // `style` fields are inline CSS — they must not contain raw markup.
          if (field === 'style' && /[<>]/.test(val)) {
            errors.push(`elements.${tag}.style looks broken: a style string must not contain < or > (put markup in wrapBefore/wrapAfter/html).`);
          }
        }
      }
    }
  }

  // 5. decorations.
  if (theme.decorations !== undefined && !isPlainObject(theme.decorations)) {
    errors.push('decorations must be an object.');
  }

  // 5b. components (component-layer template overrides). Each value must be an
  // inline-HTML string; the safety scan (step 6) covers script/class/id/src.
  if (theme.components !== undefined) {
    if (!isPlainObject(theme.components)) {
      errors.push('components must be an object keyed by component name.');
    } else {
      for (const [name, val] of Object.entries(theme.components)) {
        if (typeof val !== 'string') errors.push(`components.${name} must be an inline-HTML string.`);
      }
    }
  }

  // 6. Safety scan across ALL string values (公众号 constraints + src-verbatim).
  // Also scan a CSS-comment-stripped copy of each string: a real CSS tokenizer
  // removes /* ... */ before it ever looks for `--x:` or `url(data:` — so
  // `--/**/px:` and `url(/**/data:` are indistinguishable from the unescaped
  // form once 公众号 actually renders them, even though the raw regex misses
  // the split form. The scan must see what the renderer sees.
  walkStrings(theme, '', (str, where) => {
    const scrubbed = str.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const { re, label } of UNSAFE_PATTERNS) {
      if (re.test(str) || re.test(scrubbed)) {
        errors.push(`unsafe content at ${where || '(root)'}: contains ${label}. Themes must not inject scripts/styles/classes or rewrite image srcs.`);
      }
    }
  });

  // 7. Unknown-token warnings: any {{token}} not resolvable from palette/page keys.
  const knownTokens = new Set([...PALETTE_KEYS, ...PAGE_KEYS]);
  if (isPlainObject(theme.palette)) for (const k of Object.keys(theme.palette)) knownTokens.add(k);
  if (isPlainObject(theme.page)) for (const k of Object.keys(theme.page)) knownTokens.add(k);
  // v2：tokens 的点号路径也是已知 token（任意深度）。
  const addTokenPaths = (node, prefix) => {
    if (!isPlainObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const p = `${prefix}.${k}`;
      if (typeof v === 'string' || (isPlainObject(v) && typeof v.value === 'string')) knownTokens.add(p);
      else if (isPlainObject(v)) addTokenPaths(v, p);
    }
  };
  if (isPlainObject(theme.tokens)) {
    for (const layer of ['ref', 'sys', 'cmp']) addTokenPaths(theme.tokens[layer], layer);
  }
  const used = new Set();
  collectTokens(theme, used);
  for (const tok of used) {
    // 带点号的 token（{{ref.xxx}} 等）本机渲染器的替换正则（[\w-]）根本不匹配，
    // 会原样落进正文 —— engine-2 专属写法，硬拦。
    if (tok.includes('.')) {
      errors.push(`{{${tok}}} 是带点号的 token：${ENGINE2_HINT}`);
      continue;
    }
    if (!knownTokens.has(tok)) {
      warnings.push(`{{${tok}}} is used but not defined in palette/page — it will be left as-is at render time.`);
    }
  }

  return { errors, warnings };
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
const HELP = `validate-theme.mjs — zero-dep 公众号 theme.json validator

Usage:
  node validate-theme.mjs <theme.json>

Exit code 0 if valid; non-zero if there are hard errors.
See ../themes/THEME-SCHEMA.md for the contract.
`;

async function main() {
  const file = process.argv[2];
  if (!file || file === '-h' || file === '--help') {
    process.stdout.write(HELP);
    process.exit(file ? 0 : 1);
  }

  let raw;
  try {
    raw = await readFile(path.resolve(file), 'utf8');
  } catch (e) {
    process.stderr.write(`❌ cannot read ${file}: ${e.message}\n`);
    process.exit(2);
  }

  let theme;
  try {
    theme = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`❌ ${file} is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }

  const { errors, warnings } = validateTheme(theme);
  for (const w of warnings) process.stdout.write(`⚠️  ${w}\n`);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`❌ ${e}\n`);
    process.stderr.write(`\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s).\n`);
    process.exit(1);
  }
  process.stdout.write(`✅ ${file} is a valid theme (${warnings.length} warning(s)).\n`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(2);
  });
}
