# 命令契约（本包用到的免费命令）

> 想确认某条命令返回什么、计不计费时读它。调用方式见 SKILL.md「调用 dby」。

| dby 命令 | 做什么 | 返回里要看的字段 / 计费 |
|---|---|---|
| `dby write prep` | 第 1 步五样一次拉齐（`--json` 另带章程全文与 `samples[].content`） | `voiceSystemPrompt`、`taboos`、写作规范硬约束、素材库索引；免费 |
| `dby profile get` | 我的默认档案 | `profile`（`null` = 还没建）；免费 |
| `dby charter get` | 号章程（定位/受众/变现/北极星 + 只读投影 `products`） | `charter`；免费 |
| `dby profile sample-list <档案id>` | 范文样本（带正文） | `samples[].content`；免费 |
| `dby write articles [--q 关键词] [--id N]` | 从自己授权的号拉历史图文（最多 20 篇，带纯文本）；第 4 步往期文章走它 | 序号 / 标题 / 日期 / 链接；免费（没绑号退出码 3，跳过这层） |
| `dby write topics [赛道]` | 选题卡（已并入自己的表现信号） | `topics[]{title, angle, why, refs}`、`notice?`；免费 |
| `dby write review` | 复盘：已发文章 + 指标 + 赛道动态 | 见 `review-mode.md`；免费 |
| `dby wechat writing-spec --section <段名>` | 按段拉写作规范（见 `writing-spec.md`） | 段名写错直接 400 并列出可选值；免费 |

档案的**写入**（建档 / 改人设 / 存范文 / 删范文 / 蒸 DNA / 立章程）不在本包，走 `dby-charter`。

🔴 往期文章（当素材用）一律走 `dby write articles`；`dby article list` 是文章中心的清单（不带正文），别拿它顶替。


## 稿件面（draft-review，模式 C 用）

> `dby-api` 是选路层 Skill，正文不许带任何一条能力的入参字段（防止随目录漂移的快照契约）；
> 稿件面是**专用路由**、不进那套目录，字段形状记在这里、随本包一起演进。

命令都在 `draft` 组下（如 `dby draft create`；同一份凭证，免费、不进 catalog），子命令见下表：

| 子命令 | 干什么 |
|---|---|
| `create '<json>'` | 建稿：`{title, bodyMd, author?, projectId?, summary?, sourceItemIds?}` —— `sourceItemIds` = 素材单里出现过的记录 id（≤50，须是调用者自己的、未归档；含他人 / 已归档的整包 422「有记录不是你的或已归档」，稿件不落） |
| `get <id>` | 稿件 + 版本清单（不含正文）+ 待处理评论数 |
| `version <id> <v>` | 读某版：正文 + `changes[]` + `decisions[]` |
| `review-packet <id>` | 模式 C 唯一要读的入口：最新版正文 + 待处理评论 + 新拒绝 + 星标 |
| `precheck '<json>'` | 离线预检 `{bodyMd, changes}`，不联网不需要 key |
| `submit <id> '<json>'` | 交新版：`{baseVersion, author?, summary?, addresses?, changes, sourceItemIds?}` 或兜底 `{baseVersion, bodyMd, sourceItemIds?}`；`sourceItemIds` 语义同 create，随版本累加不删 |
| `comment <id> '<json>'` | 新评论 `{body, author?, version?, anchor:{exact,prefix?,suffix?}}` 或回复 `{body, author?, parentId}` |

`changes[]` 每条：`{anchor:{exact, prefix?, suffix?}, replacement, reason, tag?}`；`anchor.exact` 必须在
`baseVersion` 正文里恰好命中一处（命中多处用 `prefix`/`suffix` 消歧），两条改动范围不能重叠，`reason` 必填。
`submit` 收到 `changes[]` 时会先本地预检（拉 `baseVersion` 正文、逐条判定位/重叠/理由），干净才真的发写请求。

读取灵感库走 `dby insp list [--since N] [--ids a,b]`（免费、同一份凭证），返回 `items[]{id,type,summary,createdAt,usedInDrafts[]}` 与 `requested/returned`；`get <id>` 的返回多带 `sourceItems[]`（这篇用过的记录，含 `archived`）。

错误处置：409 `VERSION_CONFLICT`（`extra.headVersion` 是当前最新版，重拉 `get`/`version` 再交，别盲目重试原请求）；
422 `CHANGES_INVALID`（`extra.errors` 是 `[{index, code, message}]`，按 `index` 定位第几条改动、按 `code` 判问题类型：
`ANCHOR_NOT_FOUND` / `ANCHOR_AMBIGUOUS` / `REASON_MISSING` / `OVERLAP` / `DUPLICATE` 等）；422 `NO_DIFF`（归一化后
与基准版逐字节相同，没产生新版本，多半是重复提交）。


## 交棒给 dby-publish 的两条命令行（SKILL.md 交棒节）

用户只要成稿就到此为止，不交棒；终态未明先问一句。
② ③ 都先把成稿落盘 `.md`（正文，不含标题）再交棒。

**② 只要排版好的 HTML**（`--render-only`：渲染免费，**不需要绑公众号**，不用 `--confirm`）：
```bash
dby wechat pipeline --md 稿子.md --title "标题" --render-only
```

**③ 存进公众号草稿箱**（完整流水线，**这一步才需要已绑号**；计费，真存要带 `--confirm`，不带时只回确认清单、退出码 6）：
```bash
dby wechat pipeline --md 稿子.md --title "标题" --digest "<摘要>" --confirm
```
正文来自稿件面（用户在网页审稿台裁决过的稿，见 review-turn.md）时**必须**带上稿件 id，
服务端存草稿箱成功后会把稿件自动关联到发布记录，文章中心里这篇从「写作中」滑到「草稿箱」：
```bash
dby wechat pipeline --md 稿子.md --title "标题" --digest "<摘要>" --draft <稿件 id> [--draft-version <n>] --confirm
```

⚠️ 第 8 步的留言流水线没有地方放，随成稿交给用户手动贴。

交棒后的回执四行：**查阅 / 执行 / 质检 / 跳过**——没走的步写进「跳过」并说明原因。


## 违禁词自检的命令行（第 9 步自检第 1 项）

```bash
dby banned check "<标题+摘要+成稿>" --platforms gongzhonghao --confirm
```

🔴 平台写死一个（只查公众号，按平台计费一次，所以要 `--confirm`），标题、摘要、正文一起查。**任何终态都要跑。**
