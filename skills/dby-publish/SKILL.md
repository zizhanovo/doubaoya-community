---
name: dby-publish
description: >-
  公众号图文流水线 · 终态是**排版好的公众号 HTML**或**文章进自己公众号草稿箱**时用它（只存草稿、绝不群发）。
  输入是**已写好的** Markdown/HTML，本流水线不代写正文，只做之后的确定性运维：渲染 → 图片预上传 → 封面 → 存草稿。
  ⚠️ 它会**写进用户自己的公众号后台**，用户只要成稿时别自作主张跑它。存草稿需绑号 + DOUBAOYA_API_KEY；
  只渲染 / 换主题只要 key。
  Trigger words: 正文写好了怎么发 / 要排版好的公众号 HTML / 接着排版发草稿 / 写公众号 / 转公众号排版 /
  推公众号草稿 / 重新推草稿 / 带封面发布到草稿箱 / 把文章存进公众号草稿箱 / 公众号图文流水线 / dby-publish /
  存公众号草稿 / 公众号草稿箱 / 代发公众号草稿箱 / addDraft / draft/add / 图文推进公众号 / 稿子发到公众号后台。
version: 2.0.0-next.0
changelog: 随 @doubaoya/cli 2.0.0-next.0 统一发版，要点见 CHANGELOG.md
compatibility: >-
  只需要 Node ≥22（经 `dby` 命令运行：全局安装的 dby 或 npx 拉取确切版本 @doubaoya/cli，零依赖）；
  渲染、预览、存草稿都需要凭证（`dby login` 或环境变量 DOUBAOYA_API_KEY），存草稿还需用户已在 doubaoya.com 绑定自己的公众号。
  ⚠️ 正文里超过 1MB 的本地图需要压缩，靠可选的 sharp，缺它回退 macOS 专有的 sips——没装 sharp 的 Linux / 容器上会直接失败。
---

# 公众号图文流水线（都爆鸭）

把一篇**已经写好的**图文走一串确定性步骤，存进用户自己公众号的**草稿箱**，返回 `mediaId`。

正文归 `dby-write`（或用户自带）；取数、爆款样本、封面套路归 `dby-api`；合规检测归 `dby-banned-words`。
🔴 **终态纪律**：用户只要成稿就**不跑本包**——本包会写进他自己的公众号后台，是真实副作用。
终态未明先问一句，别默认往下推。

## 调用 dby

1. 先跑 `node -v`：没有 Node 或主版本低于 22 就停下，请用户先装 Node 22+；此时不跑任何 npm / npx。
2. `dby --version` 输出正好是 `2.0.0-next.0` 时，直接 `dby <组> <命令>`。
3. 否则 `npx -y --fetch-timeout=15000 @doubaoya/cli@2.0.0-next.0 <组> <命令>`；registry 不可达就加 `--registry=https://registry.npmmirror.com` 重试同一版本，仍失败就停下报告，不换版本。
4. 退出码 4（没有凭证）→ 请用户跑 `dby login`；计费命令超时不重试。

---

## 🔴 防误发红线（无论走哪个入口都成立）

**未经用户明确要求，不发布。** 真发布要带 `--confirm`，而 `--confirm` 只在用户明确要发这一篇之后才带；
不带就停在 confirmation_required（退出码 6），什么都不发生。`--dry-run` / `--render-only` 不发布，不需要 `--confirm`。
**只存草稿、绝不群发**——没有任何群发路径，任何群发参数都会被拒；**需先绑号**（在 doubaoya.com 授权绑定，本包替不了）。
存完请用户去后台亲眼确认，群发的手永远在用户自己。

## 主流程：`dby wechat pipeline`

```bash
dby wechat pipeline --md article.md --title "标题" --render-only   # 只渲染，拿在线预览链接（不要绑号）
dby wechat pipeline --md article.md --title "标题" --dry-run       # 发布前彩排，什么都不发
dby wechat pipeline --md article.md --title "标题" --confirm       # 渲染 → 传图 → 封面 → 存草稿
```

- 本机多条 key 对应不同账号时会停下要 `--account <账号>`，按报错列出的账号补上重跑。
- 正文来自**稿件面**（网页审稿页审过的稿）时带 `--draft <稿件 id>`（可选 `--draft-version <n>`，省略 = 最新版），
  存草稿成功后自动关联；稿件不属于你 → 422，不发布、不扣点。
- 🔴 **只认最终回报里的 `mediaId`**——没有它就不当已存入。失败 / Ctrl-C / 不确定草稿箱里有没有 → 读 `references/recovery.md`（重跑不幂等，会多存一份）。
- 指定账号 / 公众号 / 本地封面 / 摘要 / `--theme` 的完整写法 → 读 `references/cli.md`。

**只存草稿、不要排版**（正文已是公众号风格 HTML、无本地图也无本地封面）→ `dby wechat publish`，见 `references/draft-only.md`。
**已排好版的 HTML 但带本地图 / 本地封面** → `dby wechat pipeline --html article.html --title "标题" --confirm`（自动预上传本地图）。

本包用到的两条能力（详情与现价用 `dby api describe <operationKey>` 现拉）：
`skill.wechat.render`（md→HTML，免费）、`skill.wechat.draftPublish`（存草稿，计费）。
超出这两条时读 `dby-gateway/references/capability-index.md` 选路、`routing-pitfalls.md` 看已知的坑。

10 步 SOP 与硬规则声明在 [`pipeline.json`](./pipeline.json)（人读约定，CLI 不读它）；逐步核对读 `references/sop.md`。

---

## 写正文之前

- 🔴 **正文不写标题，标题只走 `--title`**——公众号拿草稿 `title` 渲大标题，正文里再写就显示两次；
  `--html` 路径**原样**发出、没有去重，开头别放 `<h1>`。`--md` 路径兜了什么底见 `references/rendering.md`。
- 正文**不是走 `dby-write` 写的** → 先 `dby wechat writing-spec` 拉写作规范，读 `references/writing-spec.md`。
- **存草稿花钱、只在成功时扣点**，失败自动退回；现价看 `dby api describe skill.wechat.draftPublish`，别照文档替用户算钱。
  `402 INSUFFICIENT_CREDITS` 提示用户到账户页查余额（点数只赠不卖），不要重试。报错码怎么办读 `dby-gateway/references/protocol.md` 第 6 条
  （429 按 IP 分桶，换 key、开新会话都没用，退避≤3 次且别加并发）。
- **不写 `--theme` 就用排版工作室保存的默认排版**；md→HTML 只走平台渲染（免费），**失败一律中止、没有本地回退**。
  套哪套排版 / 老稿子重跑为什么不一样 / `> [!NOTE]` 提示块 → 读 `references/rendering.md`。

## 封面与配图（可选，本包不出图）

需要新图且用户明确要了时交给 `dby-image`；图也可以是用户自备的。拿到**本地文件路径**后接回：
封面走 `--cover <路径>`；配图以 `<img src=本地路径>` 放进 Markdown 源对应 h2 小节末尾后重跑。
用户已说「推」且**没提封面 / 配图**时不主动张罗：只提示一次「不传封面就走兜底封面」，然后直接跑。

---

## 冷门分支：需要时才读

| 用户在说 / 你要干的事 | 读哪份 |
|---|---|
| **只看排版**（出稿看效果，不发） | 只读 `references/rendering.md` |
| 流水线由哪几段组成、想自己组合 | `references/modules.md` |
| **第一次用本包**（还没有 `config.json` / 身份卡） | `references/setup.md` |
| 这一步要不要凭证 / 要不要绑号 | `references/prerequisites.md` |
| **把某个公众号的排版复刻成 `theme.json`** | `references/clone-theme.md` |

---

## 下一步（草稿存好之后）

| 用户接着想要什么 | 下一步 |
|---|---|
| 看这个号的发文表现 / 做体检 | `dby-api`（账号诊断 `skill.wechat.accountAnalyzer`） |
| 盯自己或竞品的发文节奏 / 拉已发文章归档 | `dby-api` |
| 用复盘信号挖下一轮选题 | `dby-api` |
| 说不清要到哪一步 | `dby`（公众号飞轮的逐跳导航） |

## 更新本技能

`npx skills update dby-publish`（全局安装的加 `-g`）。变更历史见 [`README.md`](./README.md)。
