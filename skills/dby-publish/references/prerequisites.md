# 前置条件（分层：不是每一步都要绑公众号）

> 想知道「我这一步到底要不要密钥 / 要不要绑号」时读它。

统一前置：**Node ≥ 18**（内置 `fetch`），零外部依赖。除此之外**按你要做的事分三层**——
只想看排版效果、写/换主题、规划配图位置的用户，**没有密钥、没绑公众号也能干活**：

| 想做的事 | 除 Node 外还需要 | 怎么跑 |
|---|---|---|
| md → 公众号内联样式 HTML（本地出稿 / 看排版效果，**无在线链接**） | 无 | `node scripts/render-wechat-html.mjs --md a.md --theme themes/benya-clean.json --out a.html` |
| 校主题 / 写主题 / 导入外部主题格式 | 无 | `scripts/validate-theme.mjs`、`scripts/import-theme.mjs`、`scripts/extract-theme.mjs --html ref.html` |
| 复刻某篇**公开**文章的排版 | 公网（**不要密钥**） | `scripts/fetch-article.mjs --url …`、`scripts/extract-theme.mjs --url …` |
| 配图自动布局规划（确定性规则，不接 LLM） | 无 | `node scripts/plan-figures.mjs --md a.md` |
| 起本地设计工作台：实时预览、换肤、自动配图排位、存 `design-config` | 无（**只有页面里点「生成」才要密钥**） | `node scripts/design-studio.mjs --md a.md --title "标题"` |
| AI 生封面 / 生配图 | 一条 **`DOUBAOYA_API_KEY`**（**花钱**，现价现拉） | `scripts/gen-image.mjs`，或工作台里点生成 |
| 用你在 doubaoya.com 设置的**默认排版**渲染 | 一条 **`DOUBAOYA_API_KEY`** | 跑 `pipeline.mjs` 时**不写 `--theme`** 即可（渲染在平台做，主题也在平台套；失败中止不回退） |
| **只渲染拿在线预览链接**（`--render-only`，**不绑号也行**） | 一条 **`DOUBAOYA_API_KEY`**（渲染免费） | `node scripts/pipeline.mjs --md a.md --title "标题" --render-only` |
| **跑 `pipeline.mjs`（含 `--dry-run`）** | **密钥 + 已在 doubaoya.com 绑定公众号** | `node scripts/pipeline.mjs --md a.md --title "标题" --dry-run` |
| 本地图预上传 / 存草稿 | 同上（**存草稿花钱**，失败自动退回） | `pipeline.mjs`、`scripts/publish_draft.py` |

> ⚠️ **`--dry-run` 不是免密钥预览，也不是免绑号预览**。它虽然什么都不发，但 whoami 校验账号
> 与草稿前置检查（`GET /api/wechat/status`）都排在它**前面**：没有密钥会停在「本地没有可用的
> `DOUBAOYA_API_KEY`」，有密钥但没绑号会停在「目标账号没有已绑定的公众号」。
> 🔴 **这是刻意的**：`--dry-run` 的语义是「发布前彩排」，它**故意**包含账号校验与前置检查
> ——那正是它的价值（发布前确认目标账号没搞错）。
>
> **有密钥、还没绑号、只想先看这篇排出来什么样** → 用 **`--render-only`**：跳过草稿前置检查，
> 渲染完直接给你 `doubaoya.com` 的在线预览链接，全程不碰公众号、不写任何用户资产。
> 纯本地不要密钥的那条路（`render-wechat-html.mjs`、设计工作台）仍然在，代价是**拿不到在线链接**。
> 🔴 但那两条**都不产生在线预览链接**——在线链接只有走平台渲染（即 `pipeline.mjs`）才有。
> 注意单跑渲染器时 `--title` 会往正文顶部插一个 `<h1>`（本地预览用），那份产物别拿去发布——见[正文不要写标题](#-正文不要写标题)。

绑好号、配好密钥之后，发布前先跑一次 `--dry-run`，确认身份上下文、目标账号、公众号、本地图扫描都对，再正式存草稿。
