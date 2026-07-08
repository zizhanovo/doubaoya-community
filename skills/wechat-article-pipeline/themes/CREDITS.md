# Theme credits & attribution

Several themes in this folder are **ported / derived** from open-source projects
by `scripts/import-theme.mjs` (see it for the exact field mapping). We keep the
originals' credit and license here. The converted `theme.json` files are our own
derivative works under this repo's license, but the upstream notices below are
retained as required (MIT) or as goodwill (WTFPL).

---

## doocs/md — WTFPL

- Source: <https://github.com/doocs/md> — `packages/shared/src/configs/theme-css/*.css`
- License: **WTFPL** (Do What The Fuck You Want To Public License), Copyright (C) 2025 Doocs <admin@doocs.org>
- WTFPL imposes **no** attribution requirement; this credit is goodwill.

doocs themes are color-agnostic (typography/layout only; the accent is a single
user-picked CSS variable). Our port flattens their CSS-variable stylesheet into
inline-style templates and synthesizes a tasteful accent per theme.

Themes ported from doocs/md:

| our theme file | doocs source | notes |
|---|---|---|
| `doocs-classic.json` | `default.css` (经典) | canonical mdnice/doocs look: centered accent-underlined h1, solid-accent h2 block, accent left-bar h3. Accent `#2d6da3`. |
| `doocs-grace.json` | `grace.css` (优雅, originally contributed by **@brzhang**) | default + soft shadows, rounded h2, dashed h3 underline, gradient hr. Accent `#6a4c93`. |
| `doocs-simple.json` | `simple.css` (简洁, originally contributed by **@okooo5km**) | asymmetric-radius h2 (`8px 24px`), tinted bordered h3, hairline borders. Accent `#2f9e8f`. |

`grace`/`simple` are diffs over `default.css` upstream; the importer resolves
them against default first (`--base default.css`), then flattens.

---

## oaker-io/wewrite — MIT (attribution REQUIRED)

- Source: <https://github.com/oaker-io/wewrite> — `toolkit/themes/*.yaml`
- License: **MIT**, Copyright (c) 2026 OpenClaw
- The full MIT license text is retained verbatim in [`LICENSE-wewrite`](./LICENSE-wewrite).

wewrite theme YAML is a `colors:` palette map + a literal `base_css` stylesheet.
Our port parses that YAML, maps `colors → palette`, flattens `base_css` per-tag
rules into our inline-style templates, and re-tokenizes literal hex back to
`{{palette}}` tokens so each theme stays recolorable.

Themes ported from wewrite:

| our theme file | wewrite source theme | one-line look |
|---|---|---|
| `wewrite-sspai.json` | `sspai` | 少数派: warm-white bg, red accent, 文艺清爽 |
| `wewrite-github.json` | `github` | white bg, GitHub blue, mono code — dev/technical |
| `wewrite-minimal-gold.json` | `minimal-gold` | white bg, restrained gold hairlines — premium |
| `wewrite-newspaper.json` | `newspaper` | cream bg, deep-brown serif — longform/op-ed |
| `wewrite-ink.json` | `ink` (水墨) | rice-paper bg, ink-grey serif, airy — cultural |
| `wewrite-warm-editorial.json` | `warm-editorial` | white bg, amber — lifestyle/culture |
| `wewrite-professional-clean.json` | `professional-clean` | blue, neutral, safe corporate default |

The MIT copyright notice + permission text above and in `LICENSE-wewrite` cover
these seven themes. Because the port is a derivative of wewrite's theme data, the
notice is retained as MIT requires.

> Theme names such as `sspai` / `github` are stylistic tributes authored under
> OpenClaw's MIT — they are original homages, not copied assets. No Typora-origin
> themes are included in this batch.
