# `theme.json` — the 公众号 theme contract (authoritative)

A **theme** lets you replicate a reference 公众号 article's typography/layout style
without touching the renderer. It is a declarative JSON map of:

- a small **palette** of colors,
- **page**-level base typography,
- per-**element** inline-style templates (+ optional decorative HTML), and
- whole-article **decorations**.

The renderer (`scripts/render-wechat-html.mjs`) applies a theme **deterministically**.
Authoring a theme (from a reference URL or a text description) is a separate,
LLM-assisted step done by other nodes — this document defines only the **schema**,
the **validator** (`scripts/validate-theme.mjs`), and how the renderer **applies** a theme.

> **Why inline styles?** 公众号's draft editor strips `<style>`/`<head>`, class-based
> CSS, and external stylesheets. So every element must carry its own inline
> `style="…"`. A theme is just a bank of those inline-style strings. Keep it
> **mobile-first** (≈16px body, generous line-height and 段间距).

---

## 1. Top-level shape

```jsonc
{
  "meta":        { "name": "杂志风", "source": "url|description|handcrafted", "notes": "" },
  "palette":     { "text": "#3f3f3f", "heading": "#1a1a1a", "accent": "#b23a48", "accent2": "#c98a2b", "muted": "#8a8a8a", "bgSoft": "#f7f4ef", "border": "#e6e2da", "link": "#b23a48" },
  "page":        { "fontFamily": "-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif", "fontSize": "16px", "lineHeight": "1.8", "letterSpacing": "0.03em", "color": "{{text}}" },
  "elements":    { /* per-tag templates, see §4 */ },
  "decorations": { "articleWrap": { "before": "<section style='…'>", "after": "</section>" }, "sectionDivider": "<section style='…'></section>" }
}
```

Only these five top-level keys are allowed: `meta`, `palette`, `page`, `elements`,
`decorations`. Any other top-level key is a **hard error**.

**Everything is OPTIONAL.** A theme is deep-merged **over** the built-in default
theme, so a partial theme (e.g. only `palette` + `elements.h2`) renders fine —
every field you omit falls back to the neutral default.

---

## 2. Palette-token interpolation (`{{key}}`)

Any `{{key}}` inside **any** style or HTML string resolves from the `palette`
(and then from `page`). This keeps themes DRY and maps directly to what a
style-extraction step produces (a palette + a handful of templates).

- Resolution order: **palette first**, then **page** (so `page.color` may be
  `"{{text}}"`), then all element/decoration strings resolve against
  `palette ∪ page`.
- **Unknown token** (`{{nope}}` with no matching palette/page key) → left
  **as-is** in the output and a **warning** is emitted (renderer → stderr;
  validator → warnings list). It is *not* a hard error.
- Standard palette keys: `text`, `heading`, `accent`, `accent2`, `muted`,
  `bgSoft`, `border`, `link`. You may add extra keys — they become usable
  `{{tokens}}` too (the validator warns they're non-standard but allows them).
- Page keys usable as tokens: `fontFamily`, `fontSize`, `lineHeight`,
  `letterSpacing`, `color`.

Palette **values** must look like colors: `#rgb` / `#rgba` / `#rrggbb` /
`#rrggbbaa`, `rgb()/rgba()/hsl()/hsla()`, a common CSS named color, or a
`{{token}}`. Anything else is a hard error.

---

## 3. `page` — base typography wrapper

The renderer emits one wrapper `<section style="…">` around the whole fragment;
its style is built **deterministically** from `page`:

```
font-family:{fontFamily};font-size:{fontSize};line-height:{lineHeight};[letter-spacing:{letterSpacing};]color:{color};max-width:100%;word-break:break-word;
```

- `letter-spacing` is emitted **only if** `page.letterSpacing` is set.
- `max-width:100%;word-break:break-word;` are **always appended** as mobile-first
  safety constraints (a 公众号 body must never exceed viewport width or overflow on
  long unbroken tokens). They are not configurable.
- Children inherit this typography; per-element styles override as needed.

---

## 4. `elements` — per-tag templates

Keyed by tag. Recognized tags:
`h1 h2 h3 h4 p blockquote ul ol li img hr strong em del a code pre`.

`elements` is **deep-merged per tag** (theme wins field-by-field), so overriding
`elements.h2.style` keeps the default `elements.p.style`, etc.

Each element object supports:

| Field         | Applies to        | Meaning |
|---------------|-------------------|---------|
| `style`       | all except `hr`   | The element's inline CSS (`style="…"`). Must **not** contain `<`/`>` (that's markup — use the wrap/html fields). |
| `wrapBefore`  | block elements    | Raw HTML injected **immediately before** the element's opening tag (decorative bars, spacers). |
| `wrapAfter`   | block elements    | Raw HTML injected **immediately after** the element's closing tag. |
| `marker`      | `li`              | A custom bullet string prepended inside each `<li>` (e.g. `"▸ "`). |
| `figureStyle` | `img`             | If set (or `captionStyle` is set), the `<img>` is wrapped in `<figure style="…">`. |
| `captionStyle`| `img`             | If set, the image's alt text is emitted as `<figcaption style="…">` inside the figure. |
| `html`        | `hr` **only**     | Replaces the plain `<hr>` **entirely** (a decorative divider `<section>…</section>`). |

Notes:

- **`hr` is special**: it has no `style`, only `html`. Whenever a Markdown
  horizontal rule (`---`, `***`, `___`) is seen, the renderer emits
  `elements.hr.html` verbatim (after token interpolation). The default is a plain
  hairline `<hr>`; a theme can swap in an ornamental divider.
- **`wrapBefore`/`wrapAfter`** fire for the block elements the walker produces:
  `h1`–`h4`, `p`, `ul`, `ol`, `blockquote`, `pre`. Use them for section bars,
  accent underlines, decorative spacers, etc.
- **`img` figure/caption**: when `figureStyle`/`captionStyle` are set, an image
  `![alt](src)` renders as
  `<figure style="…"><img … /><figcaption style="…">alt</figcaption></figure>`.
  With neither set (the default), a bare `<img>` is emitted.
- **`li.marker`** prepends its string inside each list item (the native list
  bullet still applies unless your `ul/ol/li` style suppresses it).

### Element example

```jsonc
"elements": {
  "h2": {
    "style": "font-size:20px;font-weight:800;color:{{heading}};margin:30px 0 14px;",
    "wrapBefore": "<section style='width:32px;height:4px;background:{{accent}};margin:0 0 8px;'></section>"
  },
  "blockquote": {
    "style": "margin:0 0 18px;padding:14px 18px;background:{{bgSoft}};border-left:4px solid {{accent}};color:{{muted}};"
  },
  "li": { "style": "margin:0 0 8px;color:{{text}};", "marker": "▸ " },
  "img": {
    "style": "max-width:100%;display:block;margin:16px auto;border-radius:10px;",
    "figureStyle": "margin:20px 0;text-align:center;",
    "captionStyle": "font-size:13px;color:{{muted}};margin-top:8px;"
  },
  "hr": { "html": "<section style='height:1px;background:{{border}};margin:28px 0;'></section>" }
}
```

---

## 5. `decorations`

| Field                  | Meaning |
|------------------------|---------|
| `articleWrap.before`   | Raw HTML injected **before** the whole rendered fragment (outermost wrap open). |
| `articleWrap.after`    | Raw HTML injected **after** the whole rendered fragment (outermost wrap close). |
| `sectionDivider`       | A named decorative divider snippet (available for callers; not auto-injected by the Markdown walker). |

`articleWrap` wraps the **entire** article — e.g. a card background or a padded
frame around everything.

---

## 6. Hard rules (enforced by `validate-theme.mjs`)

The validator rejects (non-zero exit) any theme that:

1. Is not a JSON object, or has an unknown top-level key.
2. Has a `palette` value that doesn't look like a color.
3. Has a non-string where a string is required (`style`, `page.*`, etc.).
4. Has a `style` string containing `<` or `>` (markup belongs in `wrapBefore` /
   `wrapAfter` / `hr.html`, not in a style attribute).
5. Contains, in **any** string, unsafe content:
   - `<script>` / `<style>` — 公众号 strips these and they're unsafe;
   - `class=` / `id=` — 公众号 discards class-based styling;
   - inline event handlers (`onclick=` …) or `javascript:` URIs;
   - **`src=`** — a theme must **never inject or rewrite an image src**. Image
     `src` values are kept **verbatim** by the renderer, and the downstream
     `preprocess-and-publish.mjs` stage uploads local images and swaps srcs.
     Injecting `src=` in a theme breaks that composition boundary.

Warnings (allowed, non-fatal): non-standard palette/page keys, unrecognized
element tags, and unknown `{{tokens}}`.

---

## 7. Composition boundary (critical, unchanged)

- **Image `src` stays verbatim** — local paths, `http(s)`, `mmbiz` — the renderer
  never rewrites it; `preprocess-and-publish.mjs` uploads local images later.
  Themes therefore must not touch image srcs (see rule 5).
- **Inline styles only** — no `class`, no `<style>`, no `<head>`. Mobile-first.

---

## 8. How a theme is applied (renderer contract)

`renderWechatHtml(markdown, { title, theme })` (in
`scripts/render-wechat-html.mjs`):

1. Deep-merges `theme` over the built-in `DEFAULT_THEME` (which itself follows
   this schema — the defaults are dogfooded).
2. Resolves `{{tokens}}` (palette → page → everything else).
3. Builds the page wrapper style (§3), walks the Markdown, and for each element
   pulls `style` / `wrapBefore` / `wrapAfter` / `marker` / `hr.html` /
   `img.figure*` from the resolved theme.
4. Applies `decorations.articleWrap` around the whole fragment.

With **no** `theme`, output is **byte-identical** to the historical neutral
renderer (backward compatible).

CLI:

```bash
node scripts/render-wechat-html.mjs --md article.md --title "标题" --theme themes/my-theme.json
node scripts/validate-theme.mjs themes/my-theme.json
node scripts/pipeline.mjs --md article.md --title "标题" --theme themes/my-theme.json   # --theme ignored with --html
```
