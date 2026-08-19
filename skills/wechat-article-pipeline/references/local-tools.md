# 本地工具（只在**平台能力办不到**的时候用）

> 本文件属于 `wechat-article-pipeline`。SKILL.md 管**判断与编排**（每一步用哪条都爆鸭能力、
> 何时停手）；本文件只管一件事：**那些平台能力天然办不到、必须在用户本机跑的活**。
>
> 判据只有一条：**这一步需要读写用户本机的文件吗？** 需要 → 本地脚本；不需要 → 走平台能力
> （SKILL.md 的「调用都爆鸭」那段协议）。别把本地脚本当成平台能力的替代品去用——
> 它们不是同一件事，也不该互相回落。

全部脚本 **零依赖**，只要 Node ≥ 18（用全局 `fetch` 与 `AbortSignal.timeout`），不装任何 npm 包。

---

## 1. 什么时候必须落到本地

| 场景 | 为什么平台办不到 | 用哪个 |
|---|---|---|
| 正文里有**本机图片**（`<img src=./fig1.jpg>`） | 服务端读不到你本机的文件，必须客户端先把图传上去再改写正文 | `scripts/pipeline.mjs` / `scripts/preprocess-and-publish.mjs` |
| **没有密钥、也没绑号**，只想看这篇排出来什么样 | 平台的渲染与草稿能力都要鉴权 | `scripts/render-wechat-html.mjs` |
| 要**复刻某篇文章的排版**成一份可复用主题 | 抓取 + 萃取是本地启发式，平台不提供 | `scripts/fetch-article.mjs` + `scripts/extract-theme.mjs` |
| 想**点着选**封面 / 配图 / 主题，而不是在对话里逐轮描述 | 需要一个本地网页界面 | `scripts/design-studio.mjs` |
| 正文里要用 `:::关注卡` / `> [!TIP]` 这套**组件语法** | 服务端渲染器不解析这两套语法，本地渲染器解析 | `scripts/render-wechat-html.mjs` |

**除此之外的每一步都走平台能力**：查热点、查违禁词、生图、渲染、存草稿。

---

## 2. `scripts/pipeline.mjs` —— 本地发布执行器

一条命令把「渲染 → 本地图预上传 → 封面 → 存草稿」串完，全程确定性，**没有任何群发路径**。
它的 10 步 SOP 与硬规则声明在 [`../pipeline.json`](../pipeline.json)（`steps[]` + `hardRules[]`），
脚本以它为准——**改本地执行器的流程先改 `pipeline.json`**。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"   # 或放 ~/.doubaoya/key、Keychain（account-verify 会找）

# A. 从 Markdown 开始（渲染 → 传图 → 存草稿）
node scripts/pipeline.mjs --md article.md --title "标题" --config ./config.json

# B. 已有排好版的 HTML，直接发
node scripts/pipeline.mjs --html article.html --title "标题"

# C. 指定账号 + 公众号 + 本地封面 + 摘要
node scripts/pipeline.mjs --md a.md --title "标题" \
  --account you@example.com --appid wx0123... --cover cover.png --digest "本期摘要"

# D. 干跑：只渲染 + 校验 + 扫本地图，什么都不发
node scripts/pipeline.mjs --md a.md --title "标题" --dry-run
```

参数：`--md | --html`（二选一）、`--title`（必填）、`--account`、`--appid`、`--cover`、`--digest`、
`--config`、`--profile`、`--theme`、`--design`、`--output-processed-html`、`--base-url`、`--dry-run`、`--help`。

> ⚠️ **`--dry-run` 不是免密钥预览。** 它虽然什么都不发，但校验账号与草稿前置检查排在它**前面**：
> 没密钥会停在「本地没有可用的 `DOUBAOYA_API_KEY`」，有密钥没绑号会停在「目标账号没有已绑定的公众号」。
> 只想看排版效果 → 用 `render-wechat-html.mjs` 或设计工作台（都纯本地）。

> ⚠️ 传 `--mass-send` / `--broadcast` / 任何带「群发」字样的参数，脚本会**直接拒绝**。

### 组合结构（不重复造轮子）

| 阶段 | 模块 | 说明 |
|---|---|---|
| 账号解析 | `scripts/account-verify.mjs` | 多来源（env / `~/.doubaoya` / Keychain）候选 key → 逐个校验 → 按目标账号挑对那条，key 只在内存。多 key 指向不同账号且未指定 `--account` 时，报出各 key 对应账号并停。 |
| md→公众号 HTML | `scripts/render-wechat-html.mjs` | 零依赖内联样式渲染，**原样保留图片 src**。 |
| 封面/配图生图 | `scripts/gen-image.mjs` | 走密钥调平台生图能力，产出本地 jpeg。传参考图时走条件化生成，**保留参考图里的 IP 形象**；不传则文生图。风格库 `assets/styles/index.json`。 |
| 配图自动布局 | `scripts/plan-figures.mjs` | **确定性规则**（不接 LLM）决定在哪些 h2 小节末尾配图 + 画面建议；按小节有效字数挑，张数按总字数分档。 |
| 传图 + 存草稿 | `scripts/preprocess-and-publish.mjs` | **vendored** 自 `wechat-draft-publish`（两份需保持同步）。本地图预上传 + >1MB 压缩 + 存草稿，无群发。 |

---

## 3. 配置与身份 profile

```bash
cp config.example.json config.json          # 字段说明见 config.example.README.md
cp profiles/example-ip.json profiles/my-ip.json
#   再在 config.json 里把 ipProfile 指向 profiles/my-ip.json
```

`config.json` 关键字段：`targetAccount`（多 key 时挑账号）、`appid` / `publicAccountName`（选/校验公众号）、
`ipProfile`（身份卡路径）、`coverFallback`（兜底封面标记）。`null` = 自动探测。
**`config.json` 属于你个人，别提交到公共仓库。**

### 身份上下文优先（通用规律，不是某个人的故事）

一个账号名 / IP 名很可能和某个**通用名词或产品品类同名**。不先加载身份上下文，agent 就会把这个
**专有名词误读成字面意思的通用名词**，选题、配图、封面全跑偏。profile 里的 **`isNot`** 就是把这条
消歧规则**外化成数据**：先读它、回显它，明确「这是账号名，不是那个通用名词」。
示例 profile（`profiles/example-ip.json`）只演示 schema——照它写**你自己**账号的身份卡。
详见 [`../profiles/README.md`](../profiles/README.md)。

---

## 4. 正文组件语法（只有本地渲染器解析）

正文 markdown 里可直接用这套组件语法，渲染时自动套当前主题的配色，不用手写 HTML：

- `:::关注卡` … `:::`（别名 `:::follow`）——引导关注卡片，卡内文案可自定义。
- `> [!NOTE] 标题`、`> [!TIP]`、`> [!WARN]`——三级提示框（信息 / 贴士 / 警示）。
- `:::金句` … `:::`（别名 `:::quote-card`）——居中大字金句卡。
- `:::标题 小节标题`（别名 `:::title`）——带徽章 + 底部渐隐线的花式小标题。
- `:::分割`（别名 `:::divider`）——居中小图标 + 两侧渐隐线的花式分割线。

未知组件名（如 `:::xxx`）不报错——原样输出并提示。组件产出的 HTML 纯内联样式、无 class / id，符合公众号红线。

> 🔴 **服务端渲染能力不解析这两套语法。** 正文里用了组件语法，就得走本地渲染器；
> 走平台渲染就别写组件语法。这是两条路的**真实分叉**，不是可以糊过去的细节。

---

## 5. 主题：来源、优先级、怎么写一套

渲染用哪份主题，按顺序取第一个成立的（详见 [`../themes/README.md`](../themes/README.md)）：

1. `--theme <path|neutral>`（含 `--design` 折算的主题）——显式指定，永远赢；
2. `config.json` 里显式写成路径的 `mdTheme`——钉死本机主题，不发任何请求；
3. **服务端编译主题**——你在 doubaoya.com 排版工作室设置的默认排版，服务端已编译成本机渲染器
   认识的全字面量形状。拉取带 5s 超时，**拉不到就优雅回退**：401 提示检查密钥（不中断），
   404 / 网络错误只打一句提示，不重试；
4. 项目默认主题 `themes/benya-clean.json`（本鸭 · 知识清爽，**推荐**）。

> 主题契约的**权威**是 [`../themes/THEME-SCHEMA.md`](../themes/THEME-SCHEMA.md)
> （top-level 只有 `meta/palette/page/elements/decorations`）。校验器 `scripts/validate-theme.mjs`，
> 套用器 `scripts/render-wechat-html.mjs --theme`。
> ⚠️ engine-2 主题（`meta.engine:2` / `tokens` / 带点号 token）本地校验器直接判**硬错误**——
> 这类主题只能用服务端编译版。

### 路径 A：复刻一篇公众号文章的排版（给 URL）

流程 = **抓取 →（零 token 启发式）萃取草稿 → 你（LLM）精修 → 校验 → 渲染**。
启发式只是快速首过；真正把它做到「像」的是第 3 步你的精修。

> 启发式萃取算法来自 [oaker-io/wewrite](https://github.com/oaker-io/wewrite)（MIT © 2026 OpenClaw）
> 的 `analyze_styles()`，零依赖 Node 重写移植进 `scripts/extract-theme.mjs`（署名见文件头 + `meta.notes`）。

```bash
# 1. 抓参考正文（一次性风格学习：一篇公开文章、不登录、不批量）
node scripts/fetch-article.mjs --url "https://mp.weixin.qq.com/s/..." --out ref.html

# 2. 萃取候选主题草稿（零 token 首过）
node scripts/extract-theme.mjs --html ref.html --name "参考风格" --out my-theme.json
#    或一步到位（内部复用 fetch-article）：
node scripts/extract-theme.mjs --url "https://mp.weixin.qq.com/s/..." --name "参考风格" --out my-theme.json

# 4. 校验 → 渲染
node scripts/validate-theme.mjs my-theme.json
node scripts/render-wechat-html.mjs --md a.md --title "标题" --theme my-theme.json
```

**第 3 步（你对着参考精修草稿）的 CHECKLIST** —— 启发式看不到的东西由你补齐：

- **标题 h1–h3**：色条 / 背景块 / 是否居中 / 字号 / 字重 / 字色（装饰条用 `wrapBefore`）。
- **正文 `p`**：字号 / 行高 / 字色 / 字距 / 段间距。
- **引用 `blockquote`**：左边框 / 背景 / 字色。
- **列表 marker**：项目符号样式。
- **图片**：圆角 / 阴影 / 居中 / 图注。
- **强调 / 链接色**：`strong` / `em` / `a` 的处理与主色。
- **调色板**：核对萃取出的 3–5 个颜色是否合理；启发式常把某个高频装饰色误当主色——
  对照抓取器打印的「出现最多的颜色」改回真正的主色。
- **分隔装饰**：文中的花式分割线 → `elements.hr.html`；整篇卡片/边框背景 → `decorations.articleWrap`；
  命名分隔片段 → `decorations.sectionDivider`（这些启发式扒不出来，靠你补）。

> **诚实预期**：公众号编辑器（秀米 / 135 等）导出的 HTML **很吵**——满是一次性内联样式。
> 只保留**反复出现的那套规律**，别把每一处 one-off 样式都当成主题。
> 信号弱时（把色写在 `span` 而非 `p` 上等）萃取器会回落到中性默认并告警「低置信度」——正常，交给精修。

### 路径 B：从一段文字风格描述直接写主题

不需要参考文章：**你（agent）按描述的调性直接照 schema 填 `theme.json`**，再校验、渲染。
例：「性冷淡杂志风」→ 低饱和调色板、细边框 / hairline 分割线、充裕留白、克制的大字距标题。
起步建议**复制** `themes/benya-clean.json`（默认/推荐）/ `magazine.json` / `minimal.json` /
`knowledge.json` 之一再改。

---

## 6. 设计工作台（可视化替代）

不想在对话里逐轮选风格 / 生图，可起本地网页工作台一次点完，产出一个 `design-config.json`，
再交给 `pipeline.mjs --design` 消费。工作台零依赖（Node 内置 http + 全局 fetch），
只绑 `127.0.0.1`，只写本地产物，不发布、不提交。

```bash
export DOUBAOYA_API_KEY="dyh_你的密钥"
node scripts/design-studio.mjs --md <文章.md> --title "<标题>" \
     [--out <默认同目录 文章.design.json>] [--port 4599]

# 拿到 design-config 后进流水线（套主题 + 设封面 + 按 h2 锚点注入配图）
node scripts/pipeline.mjs --md <文章.md> --title "<标题>" --design <文章.design.json> --dry-run
```

页面三区：**①排版** = 主题卡片实时换肤预览（左侧 375px 手机公众号外框）；**②封面** = 选生图风格 →
生成候选 → 挑一张；**③配图（自动布局）** = 点「自动配图」→ 后端 `plan-figures.mjs`（确定性规则，
不接 LLM）自动挑位置 → 逐张生成并自动摆好，用户只做「换一张 / 删除 / 整体重生」，**不手选锚点**。
顶部「保存配置」写出 `design-config.json`（过 [`../schemas/design-config.schema.json`](../schemas/design-config.schema.json) 校验），
生成的 jpeg 落 `design-config` 同目录的 `.design/assets/`。

**注册卡通 IP（可选，保持全篇形象统一）**：把你的卡通 IP 形象图放进 `assets/ip/`（或页面顶部「上传 IP」），
并在 `config.json` 里把 `ipImage` 指向它。注册后封面与配图默认走**参考图条件化生成**，保留同一形象；
未注册则退回文生图。见 [`../assets/ip/README.md`](../assets/ip/README.md)。

> `--design` 里的主题 / 封面是**默认值**；显式 `--theme` / `--cover` 与之冲突时**命令行优先并告警**。
> 配图按 `afterHeading` 锚点插在对应 h2 小节末尾，找不到锚点则追加文末并告警。

---

## 7. 分层前置条件：不是每一步都要绑公众号

只想看排版效果、写/换主题、规划配图位置的用户，**没有密钥、没绑公众号也能干活**：

| 想做的事 | 除 Node 外还需要 |
|---|---|
| md → 公众号内联样式 HTML（本地出稿 / 看排版效果） | 无 |
| 校主题 / 写主题 / 导入外部主题格式 | 无 |
| 复刻某篇**公开**文章的排版 | 公网（**不要密钥**） |
| 配图自动布局规划（确定性规则，不接 LLM） | 无 |
| 起本地设计工作台 | 无（**只有页面里点「生成」才要密钥**） |
| AI 生封面 / 生配图 | 一条 `DOUBAOYA_API_KEY`（扣点数） |
| 用你在 doubaoya.com 设置的**默认排版**渲染 | 一条 `DOUBAOYA_API_KEY`（拉不到会静默回退本机主题，不中断） |
| 跑 `pipeline.mjs`（**含 `--dry-run`**） | 密钥 + 已在 doubaoya.com 绑定公众号 |
| 本地图预上传 / 存草稿 | 同上 |
