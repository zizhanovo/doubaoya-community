# 复刻参考排版风格 → 可复用主题

> 只在用户说「排版长得像某个号」「照这篇的风格排」「按这段描述写一套主题」时读它。

想让排版长得像某个你欣赏的公众号，或某种描述得出的风格？把它一次性**萃取成一个 `theme.json`**，
之后**永久复用**（每次渲染只需 `--theme my-theme.json`，见下方 CLI）。主题契约的**权威**是
[`themes/THEME-SCHEMA.md`](./themes/THEME-SCHEMA.md)（top-level 只有 `meta/palette/page/elements/decorations`）。
校验器是 `scripts/validate-theme.mjs`。本机预览用 `scripts/render-wechat-html.mjs --theme`；走流水线时 `pipeline.mjs --theme <path>` 会**先在本机校验再整套送去平台渲染**。

> **写主题是一次性的活**；产出的 `theme.json` 之后一直用。默认主题是 `themes/benya-clean.json`
> （本鸭精品「知识清爽」风，**推荐**）。不想从零写？**先看有哪些现成的，别照文档里的名字猜**：
>
> ```bash
> ls themes/*.json          # 包内自带的起手主题，挑一个最接近的复制再改
> ```
>
> 🔴 **这里刻意不列清单**：2026-08-22 实测，包内自带 **15 个**主题，而此处原先只写了 4 个
> —— 等于把用户的选择从 15 砍到 4（整个 `wewrite-*` 与 `doocs-*` 家族都被藏掉了）。
> 写死的清单只会往少了漂，而漂了没有任何地方会报错。
>
> ⚠️ **服务端的内置目录比包内更全**（实测 19 vs 15，多出 `dark-tech` 等 4 个）。
> 要挑那几个就走 API 路：`GET /api/wechat/themes` 的 `builtin`，或直接用 `dby-theme`
> ——它本来就是「列出来再挑」的形态，不写死名字。

### 路径 A：复刻一篇公众号文章的排版（给 URL）

流程 = **抓取 →（零 token 启发式）萃取草稿 → LLM 精修 → 校验 → 渲染**。
其中「萃取草稿」是一次**快速的零 token 首过**（用启发式把配色/排版扒出来），
真正把它做到「精修」的是**你（LLM）对草稿的refine**——这正是我们相对纯启发式工具的优势所在。

> **启发式萃取算法来自 [oaker-io/wewrite](https://github.com/oaker-io/wewrite)（MIT © 2026 OpenClaw）**
> 的 `analyze_styles()`，零依赖 Node 重写移植进 `scripts/extract-theme.mjs`（署名见文件头 + `meta.notes`）。

1. **抓取参考正文**（一次性风格学习，抓的是一篇**公开**文章、不登录、不批量）：
   ```bash
   node scripts/fetch-article.mjs --url "https://mp.weixin.qq.com/s/..." --out ref.html
   ```
   它提取正文 `#js_content`，**保留所有 inline `style="…"`**（这些内联样式就是我们要分析的数据），
   去掉 `<script>/<style>/注释`，并打印**风格指纹**：各标签数量、出现最多的**颜色**、用到的**字号**。
   > 若该链接被反爬/已过期而抓不到，脚本会明确提示你：在浏览器里打开文章、查看源码，把正文 HTML
   > 贴进本地文件来分析（授权步骤对任何公众号正文 HTML 都适用，不只限本抓取器）。

2. **萃取候选主题草稿**（`extract-theme.mjs`，**零 token 快速首过**）：
   ```bash
   node scripts/extract-theme.mjs --html ref.html --name "参考风格" --out my-theme.json
   #   或一步到位（内部复用 fetch-article 抓正文）：
   node scripts/extract-theme.mjs --url "https://mp.weixin.qq.com/s/..." --name "参考风格" --out my-theme.json
   ```
   它按标签分组内联样式，扒出 `text` / `text_light` / **主色 accent**（strong/section/h1-3/span 的非灰色加权计数，
   `font-size≥20px` 权重 ×5）/ 背景 / 排版（字号·行高·字距）/ 引用边框与底色 / 代码色 / 圆角，
   **盖进一套中性基底模板**（用 `{{token}}` 注色），产出一份**通过 `validate-theme.mjs`** 的 `theme.json` 草稿。
   > 信号弱时（135/秀米 导出把色写在 `span` 而非 `p` 上等）它会**回落到中性默认并告警「低置信度」**——正常，交给下一步精修。

3. **你（LLM）对着参考精修草稿**（我们的核心价值——启发式看不到的东西由你补齐）：
   按下面的 CHECKLIST 逐项核对 `my-theme.json`，**修正主色、规整脏值（`2em`→具体行高、把色从 span 归到 `text` 等）、
   补上装饰分割线 / 标题处理**：
   - **标题 h1–h3**：色条 / 背景块 / 是否居中 / 字号 / 字重 / 字色（→ `elements.h1..h3.style`，装饰条用 `wrapBefore`）。
   - **正文 `p`**：`font-size` / `line-height` / `color` / `letter-spacing` / 段间距 `margin`（→ `elements.p.style` 与 `page`）。
   - **引用 `blockquote`**：左边框 / 背景 / 字色（→ `elements.blockquote.style`）。
   - **列表 marker**：项目符号样式（→ `elements.li.marker` + `ul/ol/li.style`）。
   - **图片**：圆角 / 阴影 / 居中 / 图注（→ `elements.img.style` + `figureStyle` / `captionStyle`）。
   - **强调 / 链接色**：`strong` / `em` / `a` 的处理与主色（→ `elements.strong/em/a` + `palette.accent`/`link`）。
   - **调色板**：核对萃取出的 **3–5 个颜色**是否合理（`text/heading/accent/accent2/muted/bgSoft/border/link`）；
     启发式常把某个高频装饰色误当主色——对照抓取器指纹「出现最多的颜色」改回真正的主色。
   - **分隔装饰**：文中的花式分割线 → `elements.hr.html`；整篇卡片/边框背景 → `decorations.articleWrap`；
     命名分隔片段 → `decorations.sectionDivider`（这些启发式扒不出来，靠你补）。

4. **校验 → 渲染**：
   ```bash
   node scripts/validate-theme.mjs my-theme.json          # 有硬错误就按提示改
   node scripts/render-wechat-html.mjs --md a.md --title "标题" --theme my-theme.json
   # 或直接进流水线： node scripts/pipeline.mjs --md a.md --title "标题" --theme my-theme.json
   ```

> **诚实预期**：公众号编辑器（秀米 / 135 等）导出的 HTML **很吵**——满是一次性的内联样式。
> `extract-theme.mjs` 是**快速首过**，只保证扒出大致配色骨架；把它调到「像」靠的是第 3 步你的**精修**。
> 只保留**反复出现的那套规律**，别把每一处 one-off 样式都当成主题。

### 路径 B：从一段文字风格描述直接写主题

不需要参考文章：**你（agent）按描述的调性直接照 schema 填 `theme.json`**，再校验、渲染。
例：「性冷淡杂志风」→ 低饱和 `palette`、细 `border`/hairline `hr`、充裕留白（大 `margin`/`line-height`）、
克制近 small-caps 的标题（大字距、非高饱和色）。同样先 `validate-theme.mjs` 再 `render --theme`。
起步同样建议**复制** `themes/benya-clean.json`（默认/推荐）/ `magazine.json`（杂志风）/ `minimal.json`（极简）/ `knowledge.json`（知识卡片）之一再改。

一切以 [`themes/THEME-SCHEMA.md`](./themes/THEME-SCHEMA.md) 为准；主题索引见 [`themes/README.md`](./themes/README.md)。
