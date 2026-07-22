---
name: wechat-article-pipeline
description: >-
  公众号图文流水线 · 把一篇写好的 Markdown/HTML 走确定性的机械步骤，最终存进你自己公众号的**草稿箱**
  （只存草稿、绝不群发；之后你去公众号后台确认后手动群发）。它自动化后续运维：加载身份上下文 →
  whoami 校验目标账号 → 前置检查 → md→公众号 HTML 渲染 → 本地图片预上传 → 封面 → 保存草稿 → 回报。
  当用户要写公众号、转公众号排版、推公众号草稿、重新推草稿、带封面发布到草稿箱、把文章存进公众号草稿箱、
  跑公众号图文流水线时使用。需先在 doubaoya.com 绑定自己的公众号、并有一条 DOUBAOYA_API_KEY。
  Trigger words: 写公众号 / 转公众号排版 / 推公众号草稿 / 重新推草稿 / 带封面发布到草稿箱 /
  把文章存进公众号草稿箱 / 公众号图文流水线 / wechat-article-pipeline。
version: 1.1.0
---

# 公众号图文流水线（都爆鸭）

本鸭帮你把一篇**已经写好的**图文，走一串**确定性的机械步骤**，最终存进你自己公众号的**草稿箱**——
**只存草稿，绝不群发**。存完给你 `mediaId`，你再去公众号后台亲眼确认、手动群发。

> ⚠️ **写入能力**：会写到你自己的公众号后台。所以只做「存草稿」这一步，群发的手一定在你自己。
> 走 **doubaoya.com** 一条线，鉴权用你自己的密钥 `DOUBAOYA_API_KEY`（形如 `dyh_…`）。

**分工**：正文由**你（agent）**依需求撰写；本流水线**不代写正文**，只自动化后续那些确定性的运维步骤
（校验账号、渲染、传图、存草稿）。

---

## 单一事实源：`pipeline.json`

10 步 SOP 与全部硬规则声明在 [`pipeline.json`](./pipeline.json)（`steps[]` + `hardRules[]`）。
本 SKILL.md 与编排脚本 `scripts/pipeline.mjs` **都以它为准**——改流程先改 `pipeline.json`，别在各处硬编码。

> 其中**第 6 步「引导式设计」由 agent 执行**（选风格 / 生封面 / 生配图 / 排版确认，见下方[引导式设计](#引导式设计封面--配图--排版)），
> 它把产出（`--cover` 本地封面 + Markdown 里的本地 `<img>`）喂给后面的机械步骤；`pipeline.mjs` 本身仍是渲染→传图→存草稿的确定性执行器。

### 10 步 SOP
1. **识别任务类型** — 确认是「把已写好的文章推进公众号草稿箱」。
2. **读取身份上下文** — 加载并**回显** IP/身份 profile（名称 / 别名 / `isNot` 消歧 / 语气）。
3. **whoami 校验账号** — `GET /api/agent/whoami`，把本地 key 解析成目标账号那一条（key 只在内存）。
4. **草稿前置检查** — `GET /api/skills`（断言 `wechat-draft-publish` 存在）+ `GET /api/wechat/status`（确认公众号、解析 appid/昵称）。
5. **md→HTML** — `--md` 时渲染成公众号内联样式 HTML（原样保留 `<img src>`）；`--html` 时直接用。
6. **引导式设计** — 选风格 → AI 生封面（`--cover-guard`，1536x1024）→ 生配图（1024x1024，落进 Markdown 源后回到第 5 步重渲染）→ 排版确认。引导默认，「你全权定」是逃生舱。见下方[引导式设计](#引导式设计封面--配图--排版)。
7. **图片预处理** — 扫描 `<img>`，**本地图片客户端预上传**到图床（>1MB 先压缩）并改写 HTML；外链原样保留。
8. **封面** — 本地封面作为 thumb 预上传；没有则走都爆鸭兜底封面。
9. **保存草稿** — `POST /api/wechat/publish`（draft/add）。
10. **验证回报** — 标题 / 公众号 / 正文图上传数 / 封面 / 使用风格 / mediaId / **群发：否**。

### 硬规则（`hardRules`，代码里强制）
- **只存草稿绝不群发** — 没有任何群发路径；流水线**拒绝**任何 `--mass-send`/`--broadcast`/群发 参数。
- **发布前必须 whoami 校验目标账号** — 第 3 步不过，第 8 步不跑。
- **先加载身份上下文再做内容判断**。
- **发现走 `/api/skills`，执行走 `/api/wechat/status` + `/api/wechat/publish`，不走 `/invoke`**。
- **本地图片必须客户端预上传**（服务端读不到你本机的文件）。

---

## 正文组件语法（组件层）

正文 markdown 里可直接用下面这套**组件语法**，渲染时自动套用当前排版主题的配色（主色 / 标题色 / 正文色），不用手写 HTML：

- `:::关注卡` … `:::`（别名 `:::follow`）——引导关注卡片，卡内文案可自定义（留空用默认「点击上方名片，关注我们」）。
- `> [!NOTE] 标题`、`> [!TIP]`、`> [!WARN]`——三级提示框（信息 / 贴士 / 警示）；标题可选，下面接正文。NOTE 用主题主色，TIP 绿、WARN 橙。
- `:::金句` … `:::`（别名 `:::quote-card`）——居中大字金句卡，标题色 + 浅主题底。
- `:::标题 小节标题`（别名 `:::title`）——带徽章 + 底部渐隐线的花式小标题。
- `:::分割`（别名 `:::divider`）——居中小图标 + 两侧渐隐线的花式分割线。

示例：

    :::关注卡
    点击上方名片，关注我们
    :::

    > [!TIP] 小贴士
    > 先定选题，再动笔。

    :::金句
    真正的高手，都在偷偷做时间的朋友
    :::

    :::标题 一、为什么

    :::分割

未知组件名（如 `:::xxx`）不会报错——原样输出并给出提示。组件产出的 HTML 纯内联样式、无 class / id，符合公众号红线。主题 JSON 可选加 `components` 段覆盖内置模板（进阶）。

---

## 组合结构（不重复造轮子）

`scripts/pipeline.mjs` 是编排者，它组合三个零依赖模块：

| 阶段 | 模块 | 说明 |
|------|------|------|
| 账号解析 | `scripts/account-verify.mjs` | `resolveAccountKey({account, baseUrl})`：多来源（env / `~/.doubaoya` / Keychain）候选 → 逐个 whoami → 按目标账号挑对 key，key 只在内存。多 key 指向不同账号且未指定 `--account` 时，报出各 key 对应账号并停。 |
| md→公众号 HTML | `scripts/render-wechat-html.mjs` | `renderWechatHtml(md,{title})`：零依赖内联样式渲染，**原样保留图片 src**。 |
| 封面/配图生图 | `scripts/gen-image.mjs` | `generateImage({prompt,size,out,styleId,coverGuard,referenceImage})`：零依赖，走密钥 POST doubaoya `/api/skills/gpt-image-gen/invoke`（同步返回，扣点数）。传 `referenceImage`（本地路径/URL/`data:`/裸 base64，CLI `--reference-image`）时走 `operation:"edit"` 条件化，**保留参考图里的 IP 形象**；不传则文生图。另导出 `resolveReferenceImage(ref)`（本地图 → `data:` URL 小工具）。风格库 `assets/styles/index.json`，用 env `DOUBAOYA_API_KEY`（无需额外密钥）。产出本地 jpeg → 喂 `--cover` 或以 `<img src>` 落进正文，**不碰发布契约**。由 agent 在引导式设计里调用（不由 pipeline.mjs 机械触发）。 |
| 配图自动布局 | `scripts/plan-figures.mjs` | `planFigures(markdown,{maxFigures,minChars})` → `{figures[],meta}`：**确定性规则**（不接 LLM）决定在哪些 h2 小节末尾配图 + 画面建议。按小节有效字数过阈值（默认 160）挑，张数按总字数分档（<1800→3、1800–3000→4、>3000→5）封顶。CLI `node plan-figures.mjs --md <文章> [--max-figures N] [--min-chars N] [--json]`。工作台「自动配图」调它，产出直接填 `design-config.images[]`（`afterHeading` 锚点），由现有 pipeline 注入逻辑消费，**不改发布链路**。 |
| 传图 + 存草稿 | `scripts/preprocess-and-publish.mjs` | **vendored** 自 `wechat-draft-publish` skill（两份需保持同步）。本地图预上传 + >1MB 压缩 + 存草稿（draft/add，无群发）。 |

编排者把这三步串起来，并加上身份上下文加载、前置检查、硬门与结构化回报。

---

## 引导式设计（封面 / 配图 / 排版）

第 6 步——渲染前后完成视觉设计。**引导是默认**：在下面 4 处停下来问用户；**逃生舱**：用户若说
「封面配图你全权定 / 我赶时间」，就跳过所有停顿，用 `config.defaultStyleId` 自动出一版。
生图脚本 `scripts/gen-image.mjs` 零依赖，走密钥调 doubaoya.com 生图接口、扣点数、**无需额外密钥**
（用发布本就在用的密钥 `DOUBAOYA_API_KEY`，缺失时脚本报清晰错误、不崩）。约 ¥0.30/张。

1. **选风格** — 把 `assets/styles/index.json` 的 6 个风格（`name` + `id`）和各自样图 `assets/styles/<id>.jpg`
   列给用户挑（或用户说「你定」）。6 个起手风格：`杂志编辑风(magazine-editorial)`、`极简大字(minimal-bigtype)`、
   `真实摄影感(photo-real)`、`扁平插画(flat-illustration)`、`国潮中式(guochao-chinese)`、`商务信息图(biz-infographic)`。
2. **封面** — AI 读文章提炼一个封面概念（主体 + 氛围），用选定风格生 1 张 `1536x1024`，展示给用户 →
   选 / 重生 / 自己传 / 用兜底。定了就设进 `--cover <本地jpeg>`。**封面必须加 `--cover-guard`**
   （把主体压在水平中带、上下留氛围背景，防公众号 2.35:1 居中裁切切掉关键内容）：
   ```bash
   node scripts/gen-image.mjs --prompt "<封面概念>" --style <风格id> --cover-guard \
     --size 1536x1024 --out <暂存目录>/cover.jpg
   ```
3. **配图** — 扫文章结构（一般每个 `##` 小标题下 1 张），提议张数与各自画面，逐张生成 `1024x1024`
   并以 `<img src=本地路径>` 落进 **Markdown 源**（不是渲染后的 HTML——放进源里才会被主题套上图注/圆角/间距）。
   ```bash
   node scripts/gen-image.mjs --prompt "<该段画面>" --style <风格id> \
     --size 1024x1024 --out <暂存目录>/fig1.jpg
   ```
   配图落进 Markdown 后**回到第 5 步重渲染**。这些本地图会被现有 `preprocess-and-publish.mjs` 走 `image` 上传，
   **无需改动任何发布链路**。
4. **排版** — 确认用哪套主题（默认 `config.mdTheme`，或用 `--theme` 换一套；写主题见下方「复刻参考排版风格」），
   并**确认渲染器真被调用**。

> `gen-image.mjs` 生成的本地 jpeg 路径，封面喂 `pipeline.mjs --cover`、配图以 `<img src>` 落进正文——
> 两者都不触碰微信侧发布契约。上游生图密钥只在 doubaoya 服务端，skill 端只用密钥。

### 用设计工作台（可视化替代）

不想在命令行里逐步选风格 / 生图，可起本地网页工作台一次点完，产出一个 `design-config.json`，再交给
`pipeline.mjs --design` 消费。工作台零依赖（Node 内置 http + 全局 fetch），只绑 `127.0.0.1`，只写本地产物，不发布、不提交。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
node scripts/design-studio.mjs --md <文章.md> --title "<标题>" \
     [--out <默认同目录 文章.design.json>] [--port 4599]
```

**注册卡通 IP（可选，保持全篇形象统一）**：把你的卡通 IP 形象图放进 `assets/ip/`（或页面顶部「上传 IP」），
并在 `config.json` 里把 `ipImage` 指向它。注册后，封面与配图默认走**参考图条件化生成**
（`operation:"edit"` + `referenceImage`），**保留同一形象**让全篇视觉统一；未注册则退回文生图。
见 [`assets/ip/README.md`](./assets/ip/README.md)。

页面三区：**①排版** = 主题卡片实时换肤预览（左侧 375px 手机公众号外框）；**②封面** = 选生图风格 →
生成候选（默认套用当前 IP 参考图，可再生 / 上传自己的）→ 挑一张；**③配图（自动布局）** = 点「自动配图」→
后端 `plan-figures.mjs`（确定性规则，不接 LLM）自动挑好位置（信息量大的 h2 小节末尾、张数按字数分档）→
逐张用 IP 参考图生成并**自动摆好**，用户只做「换一张 / 删除 / 整体重生」，**不手选锚点**。顶部「保存配置」
写出 `design-config.json`（含 `ip` 与自动填充的 `images[]`，过 [`schemas/design-config.schema.json`](./schemas/design-config.schema.json) 校验）。
生成的封面/配图 jpeg 落 `design-config` 同目录的 `.design/assets/`。

拿到 `design-config.json` 后进流水线（套主题 + 设封面 + 按 h2 锚点注入配图）：

```bash
node scripts/pipeline.mjs --md <文章.md> --title "<标题>" --design <文章.design.json> --dry-run
```

> `--design` 的主题 / 封面是默认值；显式 `--theme` / `--cover` 与之冲突时**命令行优先并告警**。配图按
> `afterHeading` 锚点插在对应 h2 小节末尾，找不到锚点则追加文末并告警。工作台 + `--design` 与上面的命令行
> 引导等价，二选一即可，都不触碰微信侧发布契约。

---

## 上手：配置 + 身份 profile

```bash
# 1. 复制配置模板，填你自己的值（见 config.example.README.md 逐字段说明）
cp config.example.json config.json

# 2. 复制身份 profile 模板，改成你自己账号的身份卡
cp profiles/example-ip.json profiles/my-ip.json
#   再在 config.json 里把 ipProfile 指向 profiles/my-ip.json
```

`config.json` 关键字段：`targetAccount`（多 key 时挑账号）、`appid` / `publicAccountName`（选/校验公众号）、
`ipProfile`（身份卡路径）、`coverFallback`（兜底封面标记）。`null` = 自动探测。**`config.json` 属于你个人，别提交到公共仓库。**

### 身份上下文优先（通用规律，不是某个人的故事）

一个账号名 / IP 名很可能和某个**通用名词或产品品类同名**。若不先加载身份上下文，agent 可能把这个
**专有名词误读成字面意思的通用名词**，导致选题、配图、封面全跑偏。profile 里的 **`isNot`** 就是把这条
消歧规则**外化成数据**：流水线第 2 步先读它、回显它，明确「这是账号名，不是那个通用名词」。
示例 profile（`profiles/example-ip.json`，虚构的 `示例·日常号`）演示了 schema——请照它写**你自己**账号的身份卡。
详见 [`profiles/README.md`](./profiles/README.md)。

---

## CLI 用法

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"   # 或放 ~/.doubaoya/key、Keychain（account-verify 会找）

# A. 从 Markdown 开始（渲染 → 传图 → 存草稿）
node scripts/pipeline.mjs --md article.md --title "标题" --config ./config.json

# B. 已有排好版的 HTML，直接发
node scripts/pipeline.mjs --html article.html --title "标题"

# C. 指定账号 + 公众号 + 本地封面 + 摘要
node scripts/pipeline.mjs --md a.md --title "标题" \
  --account you@example.com --appid wx0123... --cover cover.png --digest "本期摘要"

# D. 干跑：只渲染+校验+扫描本地图，什么都不发
node scripts/pipeline.mjs --md a.md --title "标题" --dry-run

# E. 起可视化设计工作台选主题/封面/配图 → 产出 design-config.json（见「用设计工作台」）
node scripts/design-studio.mjs --md a.md --title "标题"           # 网页里点完「保存配置」

# F. 用设计工作台产出的 design-config 跑流水线（套主题 + 设封面 + 按 h2 锚点注入配图）
node scripts/pipeline.mjs --md a.md --title "标题" --design a.design.json --dry-run
```

参数：`--md | --html`（二选一）、`--title`（必填）、`--account`、`--appid`、`--cover`、`--digest`、
`--config`、`--profile`、`--theme`、`--design`、`--output-processed-html`、`--base-url`、`--dry-run`、`--help`。

> **只存草稿**：本流水线**没有**任何群发参数。传 `--mass-send`/`--broadcast`/带「群发」字样的 flag 会被**直接拒绝**。

---

## 复刻参考排版风格 → 可复用主题

想让排版长得像某个你欣赏的公众号，或某种描述得出的风格？把它一次性**萃取成一个 `theme.json`**，
之后**永久复用**（每次渲染只需 `--theme my-theme.json`，见下方 CLI）。主题契约的**权威**是
[`themes/THEME-SCHEMA.md`](./themes/THEME-SCHEMA.md)（top-level 只有 `meta/palette/page/elements/decorations`）。
校验器是 `scripts/validate-theme.mjs`，套用器是 `scripts/render-wechat-html.mjs --theme`（或 `pipeline.mjs --theme`）。

> **写主题是一次性的活**；产出的 `theme.json` 之后一直用。默认主题是 `themes/benya-clean.json`
> （本鸭精品「知识清爽」风，**推荐**）。不想从零写？先从内置主题
> `themes/benya-clean.json`（默认/推荐）/ `themes/magazine.json` / `themes/minimal.json` / `themes/knowledge.json`
> 里挑一个最接近的**复制再改**。

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

---

## 前置条件

- Node **≥ 18**（内置 `fetch`），零外部依赖。
- 一个 **doubaoya.com** 账号，并已**绑定你自己的公众号**（去 doubaoya.com → 公众号 页面授权）。
- 一条 **`DOUBAOYA_API_KEY`**（doubaoya.com → 登录 → 密钥中心 → 生成）。

发布前跑一次 `--dry-run`，确认身份上下文、目标账号、公众号、本地图扫描都对，再正式存草稿。

---

## 更新本技能

```bash
npx skills update wechat-article-pipeline   # 全局安装的加 -g
```

> **最近变更**：默认 Markdown 排版主题已切为 `benya-clean`（本鸭 · 知识清爽）。想沿用旧版
> `magazine`（杂志风）的，在 `config.json` 里把 `mdTheme` 指回 `themes/magazine.json`，或渲染时加 `--theme themes/magazine.json`。
