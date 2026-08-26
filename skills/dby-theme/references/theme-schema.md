# themeJson 结构（速查）

> 真要动手写 / 改 themeJson 的字段时读它。只换配色的话，改 `palette` 八个键就够，不必读。

top-level 键以 [`scripts/validate-theme.mjs`](../scripts/validate-theme.mjs) 的 `TOP_LEVEL_KEYS` 为准，生成后先跑它。最常用的几段:

```jsonc
{
  "meta":     { "name": "暖橘编辑", "source": "description", "notes": "" },
  "palette":  { "text":"#33302b","heading":"#1f1c18","accent":"#d2691e","accent2":"#a8501a",
                "muted":"#a09a90","bgSoft":"#fbf1e7","border":"#ece3d8","link":"#a8501a" },
  "page":     { "fontFamily":"…,'PingFang SC',sans-serif","fontSize":"16px","lineHeight":"1.8",
                "letterSpacing":"0.01em","color":"{{text}}" },
  "elements": { /* 每个标签一套 inline-style 模板,见下 */ },
  "decorations": { "articleWrap": { "before":"", "after":"" }, "sectionDivider":"…" }
}
```

- **`{{token}}` 插值**:任何 style/HTML 字符串里的 `{{key}}` 先从 palette、再从 page 取值。改配色只动 palette。
- **`elements` 支持的标签**:`h1 h2 h3 h4 p blockquote ul ol li img hr strong em del a code pre`,按标签深合并（覆盖 h2 不影响 p）。
- **每个 element 字段**:`style`(inline CSS,不含 `<`/`>`)、`wrapBefore`/`wrapAfter`(块级元素前后注入的 HTML——**但装饰别做成空块,见红线 1**)、`li.marker`(自定义项目符号)、`img.figureStyle`/`captionStyle`(图注)、**`hr` 只有 `html`**(整条替换成装饰分割线,如居中短色线)。
- **标题装饰的正确姿势**（守红线 1）:色条 / 竖条 / 下划线用 `border-left` / `border-bottom` / `padding` **写进标题自己的 `style`**,别用空 `wrapBefore` 块。参照 `benya-clean` 与本 skill 的 `themes/theme.example.json`。
- **`decorations.articleWrap` 留空**（守红线 2）。

> 主题契约的权威文档在 `dby-publish/themes/THEME-SCHEMA.md`（若已装）。本 skill 的 §themeJson 结构 + `theme.example.json` 足够独立完成一次改主题。

---

## 微信编辑器官方兼容清单（写 style 时对照）

依据微信《公众平台编辑器插件开发规范》（`docs/research/dby-theme/01`），违反的会被编辑器删结构、或在手机端 / Dark Mode 下走样。
校验器 `scripts/validate-theme.mjs` 对前四条打 **warning**（不算硬错，服务端不拒）。

| 别写 | 后果 | 改成 |
|---|---|---|
| `position:absolute/fixed`、`transform` 挪结构 | 被过滤；Dark Mode 算法按 DOM 顺序着色，错位文字配错底色 | 顺着文档流排 |
| `text-align:start/end` | iOS 与安卓一边居中一边居左 | `left/center/right` |
| `line-height:0`、容器 `height:0` | 文字叠成一行 / 手机端整段不可见 | 删掉 |
| 容器固定 `width:586px` 这种像素宽 | 宽屏居左留白、窄屏溢出 | `max-width:100%` 或百分比 |
| `page.fontFamily` 自定义字体栈 | 同一页映射到不同版本字体，iOS 17+ 字号字距不一 | 用官方默认栈（`theme.example.json` 那句），别再加别的家族 |
| 文字底下铺 `linear-gradient` | Dark Mode 先把渐变压成纯色再变换；纯装饰渐变（下面没字）不受影响 | 文字用纯色底，渐变只做分割线 / 色条 |
| `<pre>` 包普通段落 | `white-space:pre` 手机端横向截断 | `<p>` / `<section>` |
| 同名标签嵌套 >15 层 | 编辑器直接删 | 扁平化 |

Dark Mode 只调「看不清」的文字 / 背景对比度，彩色不动；正文黑底 `#191919`——透明底 PNG 里的黑字会消失。

## 可读性基线（用户没指定时的默认）

正文 15–16px、行高 1.75–1.8、正文色 `#3f3f3f`/`#444`（别纯黑）、全篇 ≤3 种颜色（主色 + 深灰正文 + 浅灰辅助 `#e5e5e5` 级）；
标题 22–24 / 18 / 16px 加粗。来源：`docs/research/dby-theme/02`、`03`。
