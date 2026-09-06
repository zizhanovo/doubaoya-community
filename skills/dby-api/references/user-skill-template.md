# 用户专属 skill 模板

复制下面这份骨架去写你自己的 SKILL.md。示例流程用的是真实存在的 `dby` 命令名（逐字对过
`node skills/dby-api/scripts/dby.mjs routes --json`），改业务措辞时命令名本身别改；
失败处置、终态阶梯、计费红线的完整说明见 [`compose.md`](compose.md)，这里只放骨架。

---

```markdown
---
name: <你的 skill 名字，小写连字符>
description: >-
  一句话说清楚"什么时候用你"——写用户会说的原话（触发词），不是功能清单。
  例：「帮我把这周记的东西整理成一篇选题周报」。
compatibility: >-
  需要 Node ≥18（走 dby-api 的 CLI，零依赖，不装 npm 包）；
  需要环境变量 DOUBAOYA_API_KEY（在 doubaoya.com 密钥中心生成）；
  需要能对 https://doubaoya.com 发 HTTPS 请求。
---

# <你的 skill 名字>

## 什么时候用我

一两句话，用用户会说的原话；不确定该不该接的场景写清楚"不做什么"。

## 步骤

`D=~/.claude/skills/dby-api/scripts/dby.mjs`，下面每步一条命令；参数看
`node "$D" <组> <命令> --help`，失败处置的退出码对照见 `compose.md`。

### 第 1 步 · 取材：拉这周记下的东西

\`\`\`bash
node "$D" insp list --since 7
\`\`\`

失败：4 → 先核 `DOUBAOYA_API_KEY` 是否已设；3 → 说明灵感库为空，如实告诉用户，不虚构。

### 第 2 步 · 选题：按拿到的素材出候选

\`\`\`bash
node "$D" write topics
\`\`\`

失败：3（`no_account`）→ 先引导用户去 `charter put` 立最小章程再回来。

### 第 3 步 · 落一份素材卡（可选，用户确认要存才做）

\`\`\`bash
node "$D" material add --file 卡面.json   # 卡面字段看 `node "$D" material add --help`
\`\`\`

这条不是 destructive，直接执行，退出码 0 即成功；不要在用户没确认卡面之前就调。

## 终态

写完之后必须问，不许推断：

> 你要这份东西到哪一步？
> ① 只要选题清单 ② 帮我写成正文 ③ 存进我的公众号草稿箱

① 到此为止。② 转 `dby-write`。③ 正文写好后走 `wechat media-upload`（先传图）→
`wechat publish`（推草稿箱）——两条都默认停在确认态，转述 `changes` 给用户看过、
用户点头后再原样加 `--confirm`；**没让用户点头就别加 `--confirm`**。

## 交付回执

\`\`\`
查阅：<读了哪份表 / 参考了哪条 compose.md 的规则>
执行：<真正调了哪些命令，含失败的>
质检：<跑了哪些检查>
跳过：<发现了但没跑的> —— 原因：<为什么不该跑>
\`\`\`
```
