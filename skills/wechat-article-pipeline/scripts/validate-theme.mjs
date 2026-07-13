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

const TOP_LEVEL_KEYS = new Set(['meta', 'palette', 'page', 'elements', 'decorations', 'components']);
const PALETTE_KEYS = new Set(['text', 'heading', 'accent', 'accent2', 'muted', 'bgSoft', 'border', 'link']);
const ELEMENT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'blockquote', 'ul', 'ol', 'li', 'img', 'hr',
  'strong', 'em', 'del', 'a', 'code', 'pre',
]);
const PAGE_KEYS = new Set(['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'color']);

// A CSS color-ish value: #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba()/hsl()/hsla(),
// a common CSS named color, `transparent`, `currentColor`, or a {{token}}.
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/;
const TOKEN_RE = /^\{\{\s*[\w-]+\s*\}\}$/;
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
    const re = /\{\{\s*([\w-]+)\s*\}\}/g;
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
  walkStrings(theme, '', (str, where) => {
    for (const { re, label } of UNSAFE_PATTERNS) {
      if (re.test(str)) {
        errors.push(`unsafe content at ${where || '(root)'}: contains ${label}. Themes must not inject scripts/styles/classes or rewrite image srcs.`);
      }
    }
  });

  // 7. Unknown-token warnings: any {{token}} not resolvable from palette/page keys.
  const knownTokens = new Set([...PALETTE_KEYS, ...PAGE_KEYS]);
  if (isPlainObject(theme.palette)) for (const k of Object.keys(theme.palette)) knownTokens.add(k);
  if (isPlainObject(theme.page)) for (const k of Object.keys(theme.page)) knownTokens.add(k);
  const used = new Set();
  collectTokens(theme, used);
  for (const tok of used) {
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
