# 用户专属 skill 模板

复制下面这份骨架去写你自己的 SKILL.md。示例流程用的是真实存在的 `dby` 命令名（逐字对过
`dby routes --json`），改业务措辞时命令名本身别改；
失败处置、终态阶梯、计费红线的完整说明见 [`compose.md`](compose.md)，这里只放骨架。

**不用拷任何脚本，也别猜 `dby-api` 装在哪**：骨架里那段「调用 dby」原样照抄（与官方各包
SKILL.md 里的是同一段，一个字别改），之后每步直接写 `dby <组> <命令>`。`dby` 是独立的 npm 包
`@doubaoya/cli`，没全局装时那段约定会用 npx 拉确切版本——你的 skill 因此不依赖自己被装在哪个
目录，正文里也不用硬编码任何一条绝对路径。

---

```markdown
---
name: <你的 skill 名字，小写连字符>
description: >-
  一句话说清楚"什么时候用你"——写用户会说的原话（触发词），不是功能清单。
  例：「帮我把这周记的东西整理成一篇选题周报」。
compatibility: >-
  只需要 Node ≥22（经 `dby` 命令运行：全局安装的 dby 或 npx 拉取确切版本 @doubaoya/cli，零依赖）；
  联网命令需要凭证（`dby login` 或环境变量 DOUBAOYA_API_KEY）。
---

# <你的 skill 名字>

## 什么时候用我

一两句话，用用户会说的原话；不确定该不该接的场景写清楚"不做什么"。

## 调用 dby

1. 先跑 `node -v`：没有 Node 或主版本低于 22 就停下，请用户先装 Node 22+；此时不跑任何 npm / npx。
2. `dby --version` 输出正好是 `2.0.0-next.0` 时，直接 `dby <组> <命令>`。
3. 否则 `npx -y --fetch-timeout=15000 @doubaoya/cli@2.0.0-next.0 <组> <命令>`；registry 不可达就加 `--registry=https://registry.npmmirror.com` 重试同一版本，仍失败就停下报告，不换版本。
4. 退出码 4（没有凭证）→ 请用户跑 `dby login`；计费命令超时不重试。

## 步骤

下面每步一条命令；参数看 `dby <组> <命令> --help`，失败处置的退出码对照见 `compose.md`。

### 第 1 步 · 取材：拉这周记下的东西

\`\`\`bash
dby insp list --since 7
\`\`\`

失败：4 → 请用户跑 `dby login`（或设 `DOUBAOYA_API_KEY`）；3 → 说明灵感库为空，如实告诉用户，不虚构。

### 第 2 步 · 选题：按拿到的素材出候选

\`\`\`bash
dby write topics
\`\`\`

失败：3（`no_account`）→ 先引导用户去 `charter put` 立最小章程再回来。

### 第 3 步 · 落一份素材卡（可选，用户确认要存才做）

\`\`\`bash
dby material add --file 卡面.json   # 卡面字段看 `dby material add --help`
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

## 附录：旧模板（1.x）的兼容说明

旧模板里指向 dby-api 包内 scripts/dby.mjs 的写法（把引导壳拷进自己 skill 的 `scripts/`、再经它转发）
在 3.0.0 前仍经过渡壳可用，那份壳留档在同目录 [`dby-shim.mjs`](dby-shim.mjs)；新写的 skill 不需要它，
按上面的骨架放调用约定段、直接写 `dby <组> <命令>` 即可。
