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
---

# 公众号图文流水线（都爆鸭）

本鸭帮你把一篇**已经写好的**图文，走一串**确定性的机械步骤**，最终存进你自己公众号的**草稿箱**——
**只存草稿，绝不群发**。存完给你 `mediaId`，你再去公众号后台亲眼确认、手动群发。

> ⚠️ **写入能力**：会写到你自己的公众号后台。所以只做「存草稿」这一步，群发的手一定在你自己。
> 走 **doubaoya.com** 一条线，鉴权用你自己的口令 `DOUBAOYA_API_KEY`（形如 `dyh_…`）。

**分工**：正文由**你（agent）**依需求撰写；本流水线**不代写正文**，只自动化后续那些确定性的运维步骤
（校验账号、渲染、传图、存草稿）。

---

## 单一事实源：`pipeline.json`

9 步 SOP 与全部硬规则声明在 [`pipeline.json`](./pipeline.json)（`steps[]` + `hardRules[]`）。
本 SKILL.md 与编排脚本 `scripts/pipeline.mjs` **都以它为准**——改流程先改 `pipeline.json`，别在各处硬编码。

### 9 步 SOP
1. **识别任务类型** — 确认是「把已写好的文章推进公众号草稿箱」。
2. **读取身份上下文** — 加载并**回显** IP/身份 profile（名称 / 别名 / `isNot` 消歧 / 语气）。
3. **whoami 校验账号** — `GET /api/agent/whoami`，把本地 key 解析成目标账号那一条（key 只在内存）。
4. **草稿前置检查** — `GET /api/skills`（断言 `wechat-draft-publish` 存在）+ `GET /api/wechat/status`（确认公众号、解析 appid/昵称）。
5. **md→HTML** — `--md` 时渲染成公众号内联样式 HTML（原样保留 `<img src>`）；`--html` 时直接用。
6. **图片预处理** — 扫描 `<img>`，**本地图片客户端预上传**到图床（>1MB 先压缩）并改写 HTML；外链原样保留。
7. **封面** — 本地封面作为 thumb 预上传；没有则走都爆鸭兜底封面。
8. **保存草稿** — `POST /api/wechat/publish`（draft/add）。
9. **验证回报** — 标题 / 公众号 / 正文图上传数 / 封面 / mediaId / **群发：否**。

### 硬规则（`hardRules`，代码里强制）
- **只存草稿绝不群发** — 没有任何群发路径；流水线**拒绝**任何 `--mass-send`/`--broadcast`/群发 参数。
- **发布前必须 whoami 校验目标账号** — 第 3 步不过，第 8 步不跑。
- **先加载身份上下文再做内容判断**。
- **发现走 `/api/skills`，执行走 `/api/wechat/status` + `/api/wechat/publish`，不走 `/invoke`**。
- **本地图片必须客户端预上传**（服务端读不到你本机的文件）。

---

## 组合结构（不重复造轮子）

`scripts/pipeline.mjs` 是编排者，它组合三个零依赖模块：

| 阶段 | 模块 | 说明 |
|------|------|------|
| 账号解析 | `scripts/account-verify.mjs` | `resolveAccountKey({account, baseUrl})`：多来源（env / `~/.doubaoya` / Keychain）候选 → 逐个 whoami → 按目标账号挑对 key，key 只在内存。多 key 指向不同账号且未指定 `--account` 时，报出各 key 对应账号并停。 |
| md→公众号 HTML | `scripts/render-wechat-html.mjs` | `renderWechatHtml(md,{title})`：零依赖内联样式渲染，**原样保留图片 src**。 |
| 传图 + 存草稿 | `scripts/preprocess-and-publish.mjs` | **vendored** 自 `wechat-draft-publish` skill（两份需保持同步）。本地图预上传 + >1MB 压缩 + 存草稿（draft/add，无群发）。 |

编排者把这三步串起来，并加上身份上下文加载、前置检查、硬门与结构化回报。

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
export DOUBAOYA_API_KEY="dyh_你的口令"   # 或放 ~/.doubaoya/key、Keychain（account-verify 会找）

# A. 从 Markdown 开始（渲染 → 传图 → 存草稿）
node scripts/pipeline.mjs --md article.md --title "标题" --config ./config.json

# B. 已有排好版的 HTML，直接发
node scripts/pipeline.mjs --html article.html --title "标题"

# C. 指定账号 + 公众号 + 本地封面 + 摘要
node scripts/pipeline.mjs --md a.md --title "标题" \
  --account you@example.com --appid wx0123... --cover cover.png --digest "本期摘要"

# D. 干跑：只渲染+校验+扫描本地图，什么都不发
node scripts/pipeline.mjs --md a.md --title "标题" --dry-run
```

参数：`--md | --html`（二选一）、`--title`（必填）、`--account`、`--appid`、`--cover`、`--digest`、
`--config`、`--profile`、`--output-processed-html`、`--base-url`、`--dry-run`、`--help`。

> **只存草稿**：本流水线**没有**任何群发参数。传 `--mass-send`/`--broadcast`/带「群发」字样的 flag 会被**直接拒绝**。

---

## 复刻参考排版风格 → 可复用主题

想让排版长得像某个你欣赏的公众号，或某种描述得出的风格？把它一次性**萃取成一个 `theme.json`**，
之后**永久复用**（每次渲染只需 `--theme my-theme.json`，见下方 CLI）。主题契约的**权威**是
[`themes/THEME-SCHEMA.md`](./themes/THEME-SCHEMA.md)（top-level 只有 `meta/palette/page/elements/decorations`）。
校验器是 `scripts/validate-theme.mjs`，套用器是 `scripts/render-wechat-html.mjs --theme`（或 `pipeline.mjs --theme`）。

> **写主题是一次性的活**；产出的 `theme.json` 之后一直用。不想从零写？先从三个内置主题
> `themes/magazine.json` / `themes/minimal.json` / `themes/knowledge.json` 里挑一个最接近的**复制再改**。

### 路径 A：复刻一篇公众号文章的排版（给 URL）

1. **抓取参考正文**（一次性风格学习，抓的是一篇**公开**文章、不登录、不批量）：
   ```bash
   node scripts/fetch-article.mjs --url "https://mp.weixin.qq.com/s/..." --out ref.html
   ```
   它提取正文 `#js_content`，**保留所有 inline `style="…"`**（这些内联样式就是我们要分析的数据），
   去掉 `<script>/<style>/注释`，并打印**风格指纹**：各标签数量、出现最多的**颜色**、用到的**字号**。
   > 若该链接被反爬/已过期而抓不到，脚本会明确提示你：在浏览器里打开文章、查看源码，把正文 HTML
   > 贴进本地文件来分析（授权步骤对任何公众号正文 HTML 都适用，不只限本抓取器）。

2. **你（agent）读 `ref.html`，按下面的 CHECKLIST 把*反复出现*的样式抄成 `theme.json`**
   （照 `themes/THEME-SCHEMA.md`；`{{token}}` 从 `palette` 取色）：

   **萃取 CHECKLIST（对着参考逐项读）**
   - **标题 h1–h3**：色条 / 背景块 / 是否居中 / 字号 / 字重 / 字色（→ `elements.h1..h3.style`，装饰条用 `wrapBefore`）。
   - **正文 `p`**：`font-size` / `line-height` / `color` / `letter-spacing` / 段间距 `margin`（→ `elements.p.style` 与 `page`）。
   - **引用 `blockquote`**：左边框 / 背景 / 字色（→ `elements.blockquote.style`）。
   - **列表 marker**：项目符号样式（→ `elements.li.marker` + `ul/ol/li.style`）。
   - **图片**：圆角 / 阴影 / 居中 / 图注（→ `elements.img.style` + `figureStyle` / `captionStyle`）。
   - **强调 / 链接色**：`strong` / `em` / `a` 的处理与主色（→ `elements.strong/em/a` + `palette.accent`/`link`）。
   - **调色板**：数出现最多的 **3–5 个颜色** → 归进 `palette`（`text/heading/accent/accent2/muted/bgSoft/border/link`）。
     抓取器指纹里"出现最多的颜色"就是候选。
   - **分隔装饰**：文中的花式分割线 → `elements.hr.html`；整篇卡片/边框背景 → `decorations.articleWrap`；
     命名分隔片段 → `decorations.sectionDivider`。

3. **校验 → 修错 → 渲染**：
   ```bash
   node scripts/validate-theme.mjs my-theme.json          # 有硬错误就按提示改
   node scripts/render-wechat-html.mjs --md a.md --title "标题" --theme my-theme.json
   # 或直接进流水线： node scripts/pipeline.mjs --md a.md --title "标题" --theme my-theme.json
   ```

> **诚实预期**：公众号编辑器（秀米 / 135 等）导出的 HTML **很吵**——满是一次性的内联样式。
> 只抄**反复出现的那套规律**，别把每一处 one-off 样式都搬进主题；抄完再**手调**几轮。

### 路径 B：从一段文字风格描述直接写主题

不需要参考文章：**你（agent）按描述的调性直接照 schema 填 `theme.json`**，再校验、渲染。
例：「性冷淡杂志风」→ 低饱和 `palette`、细 `border`/hairline `hr`、充裕留白（大 `margin`/`line-height`）、
克制近 small-caps 的标题（大字距、非高饱和色）。同样先 `validate-theme.mjs` 再 `render --theme`。
起步同样建议**复制** `themes/magazine.json`（杂志风）/ `minimal.json`（极简）/ `knowledge.json`（知识卡片）之一再改。

一切以 [`themes/THEME-SCHEMA.md`](./themes/THEME-SCHEMA.md) 为准；主题索引见 [`themes/README.md`](./themes/README.md)。

---

## 前置条件

- Node **≥ 18**（内置 `fetch`），零外部依赖。
- 一个 **doubaoya.com** 账号，并已**绑定你自己的公众号**（去 doubaoya.com → 公众号 页面授权）。
- 一条 **`DOUBAOYA_API_KEY`**（doubaoya.com → 登录 → 口令中心 → 生成）。

发布前跑一次 `--dry-run`，确认身份上下文、目标账号、公众号、本地图扫描都对，再正式存草稿。
