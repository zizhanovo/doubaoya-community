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
version: 3.0.0
changelog: 包内主题只留内置兜底 benya-clean，其余 14 个服务端旧副本删除——把 --theme 或 config.mdTheme 写成 themes/xxx.json 路径的用法会坏，改用裸 id（服务端解析，排版才与账号默认一致）
  失败/中断有恢复文档了（references/recovery.md：重跑不幂等、素材残留、退点口径）；
  拿不到 mediaId 不再宣称完成，改报「结果待确认」并非零退出。
compatibility: >-
  需要 Node ≥ 18（脚本用全局 fetch 与 AbortSignal.timeout），不装任何 npm 包；
  另有 Python 3 的等价入口 `scripts/publish_draft.py`（只用标准库，不装任何 pip 包，无本地图/无本地封面场景可用它替代 Node 入口）。
  存草稿这条路还需要环境变量 DOUBAOYA_API_KEY（形如 dyh_…，在 doubaoya.com 密钥中心生成）；需要能对 https://doubaoya.com 发 HTTPS 请求，并且用户已在 doubaoya.com 绑定自己的公众号；
  只做本地排版渲染 / 换主题时不需要密钥也不需要绑号。
  ⚠️ 正文里的本地图片若超过 1MB 需要压缩，靠可选的 sharp，缺它则回退 macOS 专有的 sips——
  所以在没装 sharp 的 Linux / 容器上，超过 1MB 的本地图会直接失败。
---

# 公众号图文流水线（都爆鸭）

把一篇**已经写好的**图文走一串确定性步骤，存进用户自己公众号的**草稿箱**，返回 `mediaId`。

正文归 `dby-write`（或用户自带）；取数、爆款样本、封面套路归 `dby-api`；合规检测归 `dby-banned-words`。
🔴 **终态纪律**：用户只要成稿就**不跑本包**——本包会写进他自己的公众号后台，是真实副作用。
终态未明先问一句，别默认往下推。

---

## 只想存草稿、不要排版

→ 正文**已是公众号风格 HTML、无本地图也无本地封面**时读 `references/draft-only.md`
（零依赖 Python 入口 `scripts/publish_draft.py`），不需要就别读。

---

## 流程声明：`pipeline.json`

10 步 SOP 与全部硬规则声明在 [`pipeline.json`](./pipeline.json)（`steps[]` + `hardRules[]`）——它是**人读的约定文档**，
`pipeline.mjs` 不读取它，改流程要两边手工同步。**「引导式设计」这一步由 agent 执行**，其余步骤 `pipeline.mjs` 机械跑完。
本文只用步骤名不用序号；`pipeline.mjs` 日志里的「步骤 N」是脚本自己的机械步序，与 SOP 编号不对应。

→ 想逐步核对这 10 步分别做什么时读 `references/sop.md`，不需要就别读。

---

## 调用都爆鸭：本 Skill 用到的三条能力

只点名能力与详情端点；入参每次调用前现拉。

| operationKey | 详情端点 | 用在第几步 |
|---|---|---|
| `skill.wechat.render` ⚠️专用 | `GET /api/skills/wechat-render` | 「md→HTML」（服务端排版那条路） |
| `skill.ai.imageGen` | `GET /api/skills/gpt-image-gen` | 「引导式设计」生封面 / 配图（`scripts/gen-image.mjs` 就是它的薄壳）。**用户单独要一张封面 / 插图、不走流水线 → `dby-image`**；流水线内的自动封面 / 配图用本包 `gen-image.mjs`，上传与排布也归本包 |
| `skill.wechat.draftPublish` ⚠️专用 | `GET /api/skills/wechat-draft-publish` | 「保存草稿」 |

请求由 `scripts/pipeline.mjs`（及它调用的 `gen-image.mjs`、`preprocess-and-publish.mjs`）代发；
绕开脚本自己拼请求时才读 `dby-gateway/references/protocol.md`（鉴权、密钥怎么拿、
先拉规格再拼参数、`execution.target`、信封格式）。
🔴 **报错码是例外，走脚本一样要读**：脚本原样抛错零解读，撞上就读该文件第 6 条
（429 按 IP 分桶，换 key、开新会话都没用，退避≤3 次且别加并发）。
🔴 两条**专用路由**的调用地址只在 `target` 里，从详情端点**推不出来**。

> **存草稿与生图都花钱、服务端排版渲染不花钱**；现价从详情响应现拉现说，花钱的两步动手前先问用户。

→ 用户要的东西**超出上面这三条**时，读 `dby-gateway/references/capability-index.md` 选路、
读 `routing-pitfalls.md` 看已知的坑；正常流程里这两份都不必读。

---

## 写正文之前

- 🔴 **正文不写标题，标题只走 `--title`**——公众号总是拿草稿 `title` 渲大标题，正文里再写就显示两次；
  `--html` 直发路径**原样**发出、没有去重，开头别放 `<h1>`。`--md` 路径兜了什么底见 `references/rendering.md`。
- 正文**不是走 `dby-write` 写的** → 先拉写作规范，读 `references/writing-spec.md`
  （`dby-write` 第 1 步已经拉过这一份，别再拉一次）。
- **不写 `--theme` 就是用你在排版工作室保存的默认排版**；md→HTML 只走平台
  `POST /api/wechat/render`（免费），**失败一律中止、绝不回退本机渲染器**。
  套哪套排版 / 老稿子重跑为什么长得不一样 / `> [!NOTE]` 提示块 → 读 `references/rendering.md`。

---

## 引导式设计（封面 / 配图 / 排版）

渲染前后完成视觉设计。**引导是默认**（4 处停下来问用户）；用户说
「封面配图你全权定 / 我赶时间」就走逃生舱，用 `config.defaultStyleId` 自动出一版。
用户已说「推」且**没提封面 / 配图**时不进四问：只提示一次「不传封面就走兜底封面」，然后直接跑。

→ 真要动手做视觉时读 `references/guided-design.md`（选风格 → 封面 → 配图 → 确认排版；
封面比例 / `--cover-guard` / 尺寸上限都在那儿与 `references/cli.md`），走逃生舱就不必读。
→ 想改成**在网页里一次点完**（可视化工作台，产出 `design-config.json` 给 `pipeline.mjs --design`）
读 `references/design-studio.md`，与命令行引导等价，二选一。

---

## CLI 用法

🔴 **防误发红线**（无论走哪个入口都成立）：**只存草稿、绝不群发**——没有任何群发路径，流水线**拒绝**任何
`--mass-send`/`--broadcast`/群发 参数；**需先绑号**（先在 doubaoya.com 把公众号授权绑定，本技能替不了你绑）；
**用户只要成稿时别自作主张跑它**。存完请用户去后台亲眼确认，群发的手永远在用户自己。

```bash
export DOUBAOYA_API_KEY="dyh_…"   # 或放 ~/.doubaoya/key、Keychain（account-verify 会找）

node scripts/pipeline.mjs --md article.md --title "标题"                 # 渲染 → 传图 → 存草稿
node scripts/pipeline.mjs --md a.md --title "标题" --render-only         # 只渲染，拿在线预览链接
node scripts/pipeline.mjs --md a.md --title "标题" --dry-run             # 发布前彩排，什么都不发
```

本机有多条 key 对应不同账号时，账号校验会停下要 `--account <账号>`，按报错列出的账号补上重跑。

🔴 **跑完只认最终回报里的 `mediaId`**——它是「已存入草稿箱」的唯一凭据，没有它就不当已存入。
存草稿失败 / 中途 Ctrl-C / 不确定草稿箱里有没有 → 读 `references/recovery.md`（重跑不幂等，会多存一份）。

→ 要指定账号 / 公众号 / 本地封面 / 摘要，或用 `--html`、`--design`、`--theme` 的完整写法时读
`references/cli.md`，不需要就别读。

---

## 冷门分支：需要时才读，不需要就别读

| 用户在说 / 你要干的事 | 读哪份 |
|---|---|
| **只看排版**（本机出稿看效果，不发） | 只读 `references/rendering.md`，其余都不读 |
| 哪个脚本干哪件事、想不走 `pipeline.mjs` 自己组合 | `references/modules.md` |
| **第一次用本包**（还没有 `config.json` / 身份卡） | `references/setup.md`（`config.json` 属于你个人、别提交） |
| **把某个公众号的排版复刻成 `theme.json`** | `references/clone-theme.md`（契约、校验器、现成主题怎么挑都在里面） |

---

## 前置条件

统一前置 **Node ≥ 18**，零外部依赖。本机渲染免密、无在线链接；平台渲染（`--render-only`）要密钥、有在线链接、不要绑号；
**`--dry-run` 与存草稿**要密钥且要绑号。
→ 逐层明细读 `references/prerequisites.md`，不需要就别读。

---

## 下一步（草稿存好之后）

草稿进箱即终点。还想往下走时：

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
