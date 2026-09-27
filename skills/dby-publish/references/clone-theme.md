# 复刻参考排版风格 → 可复用主题

> 只在用户说「排版长得像某个号」「照这篇的风格排」「按这段描述写一套主题」时读它。

想让排版长得像某个你欣赏的公众号，或某种描述得出的风格？把它一次性**萃取成一个 `theme.json`**，
之后**永久复用**（每次渲染只需 `--theme my-theme.json`）。主题契约的**权威是服务端校验**：
`dby preview --theme-file my-theme.json` 不合法会返回 400 并列出问题——生成后先预览一次。
走流水线时 `dby wechat pipeline --theme <path>` 同样把整套主题交服务端校验并渲染。

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
> 要挑那几个就看 `dby wechat theme-list` 的 `builtin`，或直接用 `dby-theme`
> ——它本来就是「列出来再挑」的形态，不写死名字。

### 路径 A：复刻一篇公众号文章的排版（给 URL）

流程 = **抓取（带样式指纹）→ 你（LLM）按指纹手写主题 → 服务端校验 + 渲染预览 → 精修**。
CLI 没有自动萃取主题的命令：把指纹翻译成主题 JSON 这一步由你来做——这正是相对纯启发式工具的优势所在。

> 抓取器的样式指纹思路参考了 [oaker-io/wewrite](https://github.com/oaker-io/wewrite)（MIT © 2026 OpenClaw）的 `analyze_styles()`。

1. **抓取参考正文**（一次性风格学习，抓的是一篇**公开**文章、不登录、不批量）：
   ```bash
   dby wechat fetch-article --url "https://mp.weixin.qq.com/s/..." --out ref.html
   ```
   它提取正文 `#js_content`，**保留所有 inline `style="…"`**（这些内联样式就是我们要分析的数据），
   去掉 `<script>/<style>/注释`，并给出**样式指纹**：各标签数量、出现最多的**颜色**、用到的**字号**。
   > 若该链接被反爬/已过期而抓不到，会明确提示你：在浏览器里打开文章、查看源码，把正文 HTML
   > 贴进本地文件来分析。

2. **按指纹手写主题 JSON**：复制一份现成主题（如 `themes/benya-clean.json`）做基底，照指纹填：
   `palette.text` / `muted` 取正文与浅字色，**主色 `accent`** 取 strong / 标题里反复出现的非灰色（大字号处权重更高），
   背景 / 字号·行高·字距 / 引用边框与底色 / 代码色 / 圆角照 ref.html 里反复出现的内联样式填，其余用 `{{token}}` 注色。
   > 信号弱时（135/秀米 导出把色写在 `span` 而非 `p` 上等）先回落中性默认，交给下一步精修。

3. **你（LLM）对着参考精修**（启发式看不到的东西由你补齐）：
   按下面的 CHECKLIST 逐项核对 `my-theme.json`，**修正主色、规整脏值（`2em`→具体行高、把色从 span 归到 `text` 等）、
   补上装饰分割线 / 标题处理**：
   - **标题 h1–h3**：色条 / 背景块 / 是否居中 / 字号 / 字重 / 字色（→ `elements.h1..h3.style`，装饰写在标题自身的 style 里）。
   - **正文 `p`**：`font-size` / `line-height` / `color` / `letter-spacing` / 段间距 `margin`（→ `elements.p.style` 与 `page`）。
   - **引用 `blockquote`**：左边框 / 背景 / 字色（→ `elements.blockquote.style`）。
   - **列表 marker**：项目符号样式（→ `elements.li.marker` + `ul/ol/li.style`）。
   - **图片**：圆角 / 阴影 / 居中 / 图注（→ `elements.img.style` + `figureStyle` / `captionStyle`）。
   - **强调 / 链接色**：`strong` / `em` / `a` 的处理与主色（→ `elements.strong/em/a` + `palette.accent`/`link`）。
   - **调色板**：核对 **3–5 个颜色**是否合理（`text/heading/accent/accent2/muted/bgSoft/border/link`）；
     高频装饰色常被误当主色——对照指纹「出现最多的颜色」改回真正的主色。
   - **分隔装饰**：文中的花式分割线 → `elements.hr.html`；命名分隔片段 → `decorations.sectionDivider`。

4. **服务端校验 + 渲染预览**（每改一版重跑一次）：
   ```bash
   dby preview --file a.md --title "标题" --theme-file my-theme.json   # 不合法返回 400 并列出问题
   # 满意后进流水线： dby wechat pipeline --md a.md --title "标题" --theme my-theme.json --confirm
   ```

> **诚实预期**：公众号编辑器（秀米 / 135 等）导出的 HTML **很吵**——满是一次性的内联样式。
> 指纹只给出大致配色骨架；把它调到「像」靠的是第 3 步你的**精修**。
> 只保留**反复出现的那套规律**，别把每一处 one-off 样式都当成主题。

### 路径 B：从一段文字风格描述直接写主题

不需要参考文章：**你（agent）按描述的调性直接照 schema 填 `theme.json`**，再校验、渲染。
例：「性冷淡杂志风」→ 低饱和 `palette`、细 `border`/hairline `hr`、充裕留白（大 `margin`/`line-height`）、
克制近 small-caps 的标题（大字距、非高饱和色）。同样用 `dby preview --theme-file` 校验并看效果。
起步同样建议**复制** `themes/benya-clean.json`（默认/推荐）/ `magazine.json`（杂志风）/ `minimal.json`（极简）/ `knowledge.json`（知识卡片）之一再改。

一切以服务端校验为准（`dby preview --theme-file` 跑一次，别照文档记）；可用主题 id 见 `dby wechat theme-list`。
