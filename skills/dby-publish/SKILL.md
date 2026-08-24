---
name: dby-publish
description: >-
  公众号图文流水线 · 终态是**排版好的公众号 HTML**或**文章进自己公众号草稿箱**时用它（只存草稿、绝不群发）。
  输入是**已写好的** Markdown/HTML，本流水线不代写正文，只做之后的确定性运维：渲染 → 图片预上传 → 封面 → 存草稿。
  ⚠️ 它会**写进用户自己的公众号后台**，用户只要成稿时别自作主张跑它。存草稿需绑号 + DOUBAOYA_API_KEY；
  只做本地渲染 / 换主题时不需要。
  Trigger words: 正文写好了怎么发 / 要排版好的公众号 HTML / 接着排版发草稿 / 写公众号 / 转公众号排版 /
  推公众号草稿 / 重新推草稿 / 带封面发布到草稿箱 / 把文章存进公众号草稿箱 / 公众号图文流水线 / dby-publish /
  存公众号草稿 / 公众号草稿箱 / 代发公众号草稿箱 / addDraft / draft/add / 图文推进公众号 / 稿子发到公众号后台。
version: 2.2.0
compatibility: >-
  需要 Node ≥ 18（脚本用全局 fetch 与 AbortSignal.timeout），不装任何 npm 包；
  另有 Python 3 的等价入口 `scripts/publish_draft.py`（只用标准库，不装任何 pip 包，无本地图/无本地封面场景可用它替代 Node 入口）。
  存草稿这条路还需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对 https://doubaoya.com 发 HTTPS 请求，并且用户已在 doubaoya.com 绑定自己的公众号；
  只做本地排版渲染 / 换主题时不需要密钥也不需要绑号。
  ⚠️ 正文里的本地图片若超过 1MB 需要压缩，靠可选的 sharp，缺它则回退 macOS 专有的 sips——
  所以在没装 sharp 的 Linux / 容器上，超过 1MB 的本地图会直接失败。
---

# 公众号图文流水线（都爆鸭）

把一篇**已经写好的**图文走一串**确定性的机械步骤**，最终存进你自己公众号的**草稿箱**——
**只存草稿，绝不群发**。存完给你 `mediaId`，你再去后台亲眼确认、手动群发。

> 📍 **接的是哪一棒**：**正文那一段归 `dby-write`**（写作主干的 owner，七步顺序只定义在它那里，
> 这里不复述——复述必漂）；取数、爆款样本、封面套路由 `dby-api` 按意图路由承接，合规检测归 `dby-banned-words`。
> **正文落地之后**再看终态：只要成稿就到那里为止；要**排版好的公众号 HTML** 或要**进自己的草稿箱**
> 才回到这里，用户没表达过后一种意图时先问一句。

**分工**：正文由 `dby-write` 写（或用户自带）；本流水线**不代写正文**，只自动化后续那些确定性的运维步骤
（校验账号、渲染、传图、存草稿）。走 **doubaoya.com** 一条线，鉴权用你自己的 `DOUBAOYA_API_KEY`。

---

## 只想存草稿、不要排版

→ 正文**已是公众号风格 HTML、无本地图也无本地封面**时读 `references/draft-only.md`
（零依赖 Python 入口 `scripts/publish_draft.py`），不需要就别读。

🔴 **防误发红线**（无论走哪个入口都成立）：**只存草稿、绝不群发**；这是一个「写入」能力，
**需先绑号**（先在 doubaoya.com 把公众号授权绑定，本技能替不了你绑）；**用户只要成稿时别自作主张跑它**——
只有用户明确要排版好的公众号 HTML 或要文章进自己的草稿箱时才回到这里。群发的手永远在用户自己。

---

## 单一事实源：`pipeline.json`

10 步 SOP 与全部硬规则声明在 [`pipeline.json`](./pipeline.json)（`steps[]` + `hardRules[]`）。
本 SKILL.md 与 `scripts/pipeline.mjs` **都以它为准**——改流程先改它，别在各处硬编码。
其中**第 6 步「引导式设计」由 agent 执行**，其余步骤 `pipeline.mjs` 机械跑完。

→ 想逐步核对这 10 步分别做什么时读 `references/sop.md`，不需要就别读。

### 硬规则（`hardRules`，代码里强制）
- **只存草稿绝不群发** — 没有任何群发路径；流水线**拒绝**任何 `--mass-send`/`--broadcast`/群发 参数。
- **发布前必须 whoami 校验目标账号** — 第 3 步不过，第 8 步不跑。
- **先加载身份上下文再做内容判断**。
- **发现走 `/api/skills`，执行走 `/api/wechat/status` + `/api/wechat/publish`，不走 `/invoke`**。
- **本地图片必须客户端预上传**（服务端读不到你本机的文件）。

---

## 调用都爆鸭：本 Skill 用到的三条能力

只点名能力与详情端点；入参每次调用前现拉。

| operationKey | 详情端点 | 用在第几步 |
|---|---|---|
| `skill.wechat.render` ⚠️专用 | `GET /api/skills/wechat-render` | 第 5 步 md→HTML（服务端排版那条路） |
| `skill.ai.imageGen` | `GET /api/skills/gpt-image-gen` | 第 6 步生封面 / 配图（`scripts/gen-image.mjs` 就是它的薄壳）。**单独要一张图、不走流水线时去 `dby-image`**——出图的等待与重试纪律全在那个包里；这里只保留流水线内的上传与排布职责 |
| `skill.wechat.draftPublish` ⚠️专用 | `GET /api/skills/wechat-draft-publish` | 第 9 步存草稿 |

⚠️ 先读 `dby-gateway/references/protocol.md` 再发请求（鉴权、密钥怎么拿、
先拉规格再拼参数、`execution.target`、信封与报错码全在那一份，本文件不再复述）。
🔴 上面三条里有两条是**专用路由**——它们的调用地址跟详情端点毫无关系，**推不出来**，
只能读 `target`（这也是本 Skill 那条硬规则「不走 `/invoke`」的由来）。

> **计价数字本文一律不写**（会静默重定价，现价在详情响应里现拉现说）。只记两件不随价格变的事：
> **存草稿与生图都花钱、服务端排版渲染不花钱**，而花钱的那两步动手前先问用户。

→ 用户要的东西**超出上面这三条**时，读 `dby-gateway/references/capability-index.md` 选路、
读 `routing-pitfalls.md` 看已知的坑；正常流程里这两份都不必读。
🔴 **别把索引表抄回本文件**：能力目录一周就变一次，抄进来的当天就开始腐烂。

---

## 写正文之前

正文由**你（agent）**撰写，下面几条决定这篇稿子在真机上长什么样——动笔前先过一遍。

### 🔴 正文不要写标题

公众号**总是**拿草稿的 `title` 字段渲文章页大标题。正文里若还有同一个标题，真机上**显示两次**。

- **写 Markdown**：正文**从第一段直接开始**，层级最高只用到 `##`。标题只走 `--title` 参数，别写进正文。
- **写好 HTML 直发**（`--html`）：别在 HTML 开头放 `<h1>`（或拿来当大标题使的 `<h2>` / 加粗大字）——
  这条路把文件**原样**发出去，没有任何东西替你去重。

→ 单独跑本机渲染器 / 想知道 `pipeline.mjs --md` 替你兜了什么底，见 `references/rendering.md`。

### 先拉一份写作规范：`GET /api/wechat/writing-spec`

→ 正文**不是走 `dby-write` 写的**时读 `references/writing-spec.md`，不需要就别读
（`dby-write` 第 1 步已经拉过这一份，别再拉一次）。

#### 排版 / 渲染的细节

记住一条就够：**不写 `--theme` 就是用你在排版工作室保存的默认排版**；md→HTML 只走平台
`POST /api/wechat/render`（免费），**失败一律中止、绝不回退本机渲染器**。
→ 要弄清套哪套排版、老稿子重跑为什么长得不一样，或要用 `> [!NOTE]` 提示块，
读 `references/rendering.md`，不需要就别读。

---


## 引导式设计（封面 / 配图 / 排版）

第 6 步——渲染前后完成视觉设计。**引导是默认**（4 处停下来问用户）；用户说
「封面配图你全权定 / 我赶时间」就走逃生舱，用 `config.defaultStyleId` 自动出一版。
🔴 **这一步花钱（生图），动手前先问用户。**

→ 真要动手做视觉时读 `references/guided-design.md`（选风格 → 封面 `1536x1024` + `--cover-guard`
→ 配图 `1024x1024` 落进 Markdown 源后回第 5 步重渲染 → 确认排版），走逃生舱就不必读。

→ 想改成**在网页里一次点完**（可视化工作台，产出 `design-config.json` 给 `pipeline.mjs --design`）
读 `references/design-studio.md`，与命令行引导等价，二选一。

---

## CLI 用法

```bash
export DOUBAOYA_API_KEY="dyh_…"   # 或放 ~/.doubaoya/key、Keychain（account-verify 会找）

node scripts/pipeline.mjs --md article.md --title "标题"                 # 渲染 → 传图 → 存草稿
node scripts/pipeline.mjs --md a.md --title "标题" --render-only         # 只渲染，拿在线预览链接
node scripts/pipeline.mjs --md a.md --title "标题" --dry-run             # 发布前彩排，什么都不发
```

→ 要指定账号 / 公众号 / 本地封面 / 摘要，或用 `--html`、`--design`、`--theme` 的完整写法时读
`references/cli.md`，不需要就别读。

---

## 冷门分支：需要时才读，不需要就别读

| 用户在说 / 你要干的事 | 读哪份 |
|---|---|
| 哪个脚本干哪件事、想不走 `pipeline.mjs` 自己组合 | `references/modules.md` |
| **第一次用本包**（还没有 `config.json` / 身份卡） | `references/setup.md` —— `config.json` 属于你个人、别提交；身份卡里的 `isNot` 是把「账号名不是那个通用名词」外化成数据，第 2 步先读它 |
| **把某个公众号的排版复刻成 `theme.json`**（给 URL 或给一段风格描述） | `references/clone-theme.md` —— 契约权威是 [`themes/THEME-SCHEMA.md`](./themes/THEME-SCHEMA.md)，校验器 `scripts/validate-theme.mjs`。包内起手主题用 `ls themes/*.json` **现看，别照文档里的名字猜**；服务端内置目录更全，要挑那几个走 `dby-theme` |

---

## 前置条件

统一前置 **Node ≥ 18**，零外部依赖。**看排版 / 写主题 / 规划配图位置**不要密钥也不要绑号；
**`--render-only`**（拿在线预览链接）要密钥、不要绑号；**`--dry-run` 与存草稿**两样都要
（`--dry-run` 故意包含账号校验，那正是它的价值）。
→ 逐层明细读 `references/prerequisites.md`，不需要就别读。

---

## 下一步（草稿存好之后）

草稿进箱，用户「要一篇能发的公众号图文」这个终态就已经达成了——**这里通常就是终点**。
**群发的手始终在用户自己**：请他去公众号后台亲眼确认草稿再手动群发。还想往下走时：

| 用户接着想要什么 | 下一步 |
|---|---|
| 攒几天数据后看这个号的发文表现 / 做体检 | `dby-api`（打账号诊断能力 `skill.wechat.accountAnalyzer`） |
| 盯自己或竞品的发文节奏 | `dby-api`（打公众号发文列表端点） |
| 把已发布的文章拉正文归档 | `dby-api` |
| 用复盘信号挖下一轮选题 | `dby-api`（挖选题 / 追热点，也从这儿拉样本开写） |
| 说不清要到哪一步 | `dby`（公众号飞轮的逐跳导航） |

---

## 更新本技能

`npx skills update dby-publish`（全局安装的加 `-g`）。变更历史见 [`README.md`](./README.md)。
