# 改写清单也能存进稿件（可选）

> B/C 档交付「改了什么」之后才读；A 档（体检）不产出改动，不适用本节。

## 1. 「改了什么」也是一份 `changes[]`

SKILL.md 模式 B 第 4 条要求的「改了什么」（`第 7 句：删「值得注意的是」`）本来就是逐条动作，
拆成 `changes[]` 只是换个形状——这份契约与 `dby-rewrite`（`references/draft/draft-changes.md`）、
`dby-write` 模式 C（`references/review-turn.md`）共用，稿件面（`dby-api` 的 `draft` 系列命令）
认的就是这一种：

```json
{"anchor": {"exact": "原文里这一句，原样摘录"},
 "replacement": "改写后对应的说法（整句删除则传空串）",
 "reason": "一句话：为什么这么改",
 "tag": "技法名或留空"}
```

- `anchor.exact` 必须是**原文**中逐字能找到的一段（`draft submit` 会本地预检锚点唯一命中）。
- `reason` 落到具体判据，不写「更自然」这类空话：例「删套话连接词——`改法.md` §4」
  「依据缺失，标记不删——`改法.md` §8 例外」。
- `tag` 从 `references/改法.md` 已经点名的动作里取（删开头段、删结尾段、删收束句、删套话连接词、
  删免责句、形容词换事实、通胀大词换量级、模糊归因标记、三项砍两项、拆「不是A而是B」、
  禁破折号、句长调整……），对不上就留空（`tag: null`），不要现造词。

**结构审读的发现不进 `changes[]`。** SKILL.md 红线写明「结构问题只标不改」——「不是文风问题」
那一栏的产出仍然只写进报告，不拆成锚点改动；`changes[]` 只装词面 / 句式 / 骨架三层里**真的动了手**的那些。

**依据区间表上标记但没删的句子也不进 `changes[]`。** 那些是「留在原地并标记」，正文没变，
不构成一条改动——真要动它，只能是作者自己回复之后的下一轮。

模式 C（加人味）嵌入的内容，`changes[]` 的 `reason` 要写清素材来源是用户给的（例「用户索料：具体时间与场景」），
不许写成本包自己想出来的理由——四不纪律（不加事实、不编细节、不改立场、不改程度）同样约束这份清单。

## 2. 提交是可选项，红线不因为多了这份清单而松动

**改不改由用户定**这条红线不变：`changes[]` 只是把已经拿到用户认可的那版改写换个形状，
**不是自动提交的理由**。交付改写成品 + 文字版「改了什么」之后，问一次：

> 要不要把这版改写存进稿件（方便逐条采纳/拒绝、留评论）？

用户没给稿件 id、说不用、或不回应 → 到此为止，不主动再提第二次。用户确认了才调脚本：

```bash
D=~/.claude/skills/dby-api/scripts/doubaoya.mjs

# 没有稿件 id：先建稿（bodyMd 用原文，author 标明来源）
node "$D" draft create '{"title":"<标题或首句>","bodyMd":"<原文>","author":"dby-deai"}'
#   → 记下返回的 draft.id 与 version.version（新建稿件是第 1 版）

# 已有稿件 id：提交这版改写
node "$D" draft submit <id> '{"baseVersion":<原文版本号>,"author":"dby-deai","changes":[...]}'
```

`submit` 会先本地预检 `changes[]`（锚点在 `baseVersion` 正文里能不能唯一定位、有没有重叠、
理由齐不齐全），预检不过会指出第几条哪里错（`ANCHOR_NOT_FOUND` / `ANCHOR_AMBIGUOUS` /
`REASON_MISSING` / `OVERLAP` / `DUPLICATE`），按提示改锚点或理由，不改清单就重交没有意义。
提交冲突（409 `VERSION_CONFLICT`）说明有人抢先改过，重新 `draft get <id>` 拿最新版本号再交。

`draft` 完整子命令与字段见 `dby-api` 自己的 `scripts/doubaoya.mjs`（不带子命令跑一次能看到 USAGE）；
本包不复述鉴权与信封，那些在 `dby-gateway/references/protocol.md`。
