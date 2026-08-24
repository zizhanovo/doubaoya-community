# themeJson 结构（速查）

> 真要动手写 / 改 themeJson 的字段时读它。只换配色的话，改 `palette` 八个键就够，不必读。

top-level 五段（+ 进阶 `components`）:

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

