# 用户专属 skill 模板

复制下面这份骨架去写你自己的 SKILL.md。示例流程用的是真实存在的 `dby` 命令名（逐字对过
`node skills/dby-api/scripts/dby.mjs routes --json`），改业务措辞时命令名本身别改；
失败处置、终态阶梯、计费红线的完整说明见 [`compose.md`](compose.md)，这里只放骨架。

**别猜 `dby-api` 装在哪**：把本文档末尾附录那份 `scripts/dby.mjs` 引导壳原样拷进你自己 skill 的
`scripts/` 下（与 `dby-write`/`dby-charter`/`dby-publish`/`dby-banned-words` 四个官方包用的是
同一份文件，字节相同）。壳会自己找到装在同一 skills 根下的 `dby-api`，找不到就退出码 3 并告诉
用户去跑 `dby-update`——你的 skill 因此也不用关心自己被装在用户级目录还是某个项目目录下的
`.claude/skills`，也不用关心宿主用的是不是这个目录名，更不用在正文里硬编码任何一条绝对路径。

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

`$SKILL_DIR` = 本包目录（宿主加载本 SKILL.md 时给出的目录，你已经把附录那份壳拷进了
`$SKILL_DIR/scripts/dby.mjs`），下面每步一条命令；参数看
`node "$SKILL_DIR/scripts/dby.mjs" <组> <命令> --help`，失败处置的退出码对照见 `compose.md`。

### 第 1 步 · 取材：拉这周记下的东西

\`\`\`bash
node "$SKILL_DIR/scripts/dby.mjs" insp list --since 7
\`\`\`

失败：4 → 先核 `DOUBAOYA_API_KEY` 是否已设；3 → 说明灵感库为空，如实告诉用户，不虚构。

### 第 2 步 · 选题：按拿到的素材出候选

\`\`\`bash
node "$SKILL_DIR/scripts/dby.mjs" write topics
\`\`\`

失败：3（`no_account`）→ 先引导用户去 `charter put` 立最小章程再回来。

### 第 3 步 · 落一份素材卡（可选，用户确认要存才做）

\`\`\`bash
node "$SKILL_DIR/scripts/dby.mjs" material add --file 卡面.json   # 卡面字段看 `node "$SKILL_DIR/scripts/dby.mjs" material add --help`
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

---

## 附录：`scripts/dby.mjs` 引导壳（原样拷贝，别改）

与 `dby-write`/`dby-charter`/`dby-publish`/`dby-banned-words` 四个官方包里的 `scripts/dby.mjs`
逐字节相同的一份放在同目录 [`dby-shim.mjs`](dby-shim.mjs)——直接把那个文件拷成你自己 skill 的
`scripts/dby.mjs`，不用改一个字，也不用知道 `dby-api` 装在哪；它会自己按同一 skills 根找过去。
（源码没有贴进本文档：本包正文不许出现能力入参那类驼峰标识符，而引导壳用到的都是 Node
内置模块的接口名字，贴进来会被同一道闸误判，所以改放一份真实文件，你还能直接 `cp` 它。）
