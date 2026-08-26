---
name: dby-update
description: >-
  都爆鸭（doubaoya / 本鸭）skill 对账更新器：把本机这套本鸭 skill 对账成官方仓库的当前全集——归档上游已下架的、
  装上新增的、刷新落后的，最后自检。按内容哈希认包，别人家的和你自己改过的一个字不动；下架的移进归档目录而不是删除。
  Reconciles the installed doubaoya skills to the upstream set, then self-checks.
  触发方式：/dby-update、更新本鸭、更新都爆鸭、升级 doubaoya skill、检查本鸭更新、把本鸭更新到最新版。
version: 3.4.2
changelog: 跑完逐项列出刷新了谁、从几到几
compatibility: >-
  需要 Node ≥ 18（`scripts/reconcile.mjs` 用全局 fetch），不装任何 npm 包。
  需要能对 GitHub / Gitee 的官方仓库发 HTTPS 请求以拉取上游全集。
---

# dby-update：把本鸭对账到最新

先 `--dry-run` 出清单，用户认可后再 `--yes`；不做清单之外的确认。Shell 权限由用户在宿主权限窗口里决定。

## 这个 skill 干的是「对账」，不是「更新」

让本机这套本鸭 skill **等于**上游当前全集：

- **归档**上游已经下架的
- **装上**新增的
- **刷新**内容哈希落后于上游当前版的，**以及内容虽是当前版、但少了一处落位的**；两者都不缺的一个都不动

> 🔴 **「内容是当前版」不等于「已经就位」。** 宿主按**自己那个目录**读 skill——Claude Code 只读
> `.claude/skills`，包只落进 `.agents/skills` 时对它**根本不存在**。
> 对账判据是「内容 **且** 落位」：本机任一受管安装目录缺落位，这个包就重装一遍补齐，计划里用 🩹 单列。

> 本机已和上游一致时结论是**无需任何操作**，一个包都不重下；想重装某个坏了的包用 `--force-refresh`。

> ⚠️ 别用 `npx skills update`：上游已改名 / 下架的包会被它**静默跳过、永远留在本机**，项目级安装它也看不见。

### 怎么判断「这包是不是本鸭发的」

**判据是 slug × 内容哈希，不看当初从哪个源装。** 上游 `index.json` 每个 slug 一条：`status`、历史哈希闭集、各版 semver + changelog：

| 状态 | 判据 | 处置 |
| --- | --- | --- |
| 当前版 | 哈希 = 索引当前版 | 保留，**不刷新**（除非 `--force-refresh`） |
| 我们的旧版 | 哈希命中闭集里某个历史版 | 刷新；索引 `status` 为 retired/renamed/merged 才归档 / 迁移 |
| **你动过手** | 有 `.dby/origin.json` 时哈希 ≠ 装时记录；没 origin 时哈希谁都不命中 | 🔴 **跳过并列进报告，一个字都不动**，连刷新都不给 |
| 别人家的 | slug 根本不在索引里 | 不碰 |
| 已固定 | 你 `--pin` 过 | 不刷新、不归档、不迁移，预检单列并带原因 |

→ origin / lock / pin、legacy 回退、Gitee 镜像：`references/index-and-lock.md`。

### 删除一律做成「归档」

要下架的包**移进 `<scope>/.doubaoya/archive/<时间戳>/`，不做 `rm`**，同目录留一份 `manifest.json`
写明每个包原来在哪、怎么移回去。

三件配套的事，**转述结果时都要带上**：

- **怎么捞回来**：脚本归档后会打印一条可粘贴的复原命令，**原样转给用户**，别只说「见 manifest」。
  移回去 skill 立刻能用，只是 skills CLI 的安装记录已清掉，想让它也认回来就重装一次。
- **归档目录对 git 隐形**：脚本在 `.doubaoya/.gitignore` 写 `*` 自忽略（已有就不动），**不改用户的 `.gitignore`**。
- 🔴 **受 git 跟踪的包一律不归档**（归档等于从工作区里删受跟踪文件）。
  脚本会跳过它们、单列一栏点名说明——**这一栏必须原样转述给用户**，由用户自己决定怎么处理。

## 改名迁移（renames.json）

→ 上游偶尔会把某个包**改名**（而不是单纯下架），这时老目录里的本地数据（比如 `dby-publish`
的 `config.json`）需要跟着搬家。**需要处理改名迁移时读 `references/rename-migration.md`**，
不需要就别读。要点三条：改名 = 索引里 `status: renamed/merged` 的条目；顺序固定是**装新包 → 搬本地数据 →
老目录归档**且逐条独立；**新目录已有同名文件时不覆盖**，只提示「冲突未覆盖」并给出老文件
在归档目录里的路径——**这一句要原样转述给用户**。

## 执行步骤

### 1. 找到对账脚本

按顺序找第一个存在的：

```
~/.claude/skills/dby-update/scripts/reconcile.mjs
~/.agents/skills/dby-update/scripts/reconcile.mjs
./.claude/skills/dby-update/scripts/reconcile.mjs
./.agents/skills/dby-update/scripts/reconcile.mjs
```

**找不到** = 本机没装或是旧版。🔴 **别自动装**：报告「本机未装对账脚本」，把下面这条命令给用户，**确认后再跑**，跑完**重新找一遍**：

```bash
npx -y skills add zizhanovo/doubaoya-community -g -s '*' -a claude-code universal -y
```

🔴 **零输出且退出码 0** ≠ 没事可做，是旧版脚本经软链（`.claude/skills/…`）调用时一步不跑：先换 `.agents` 那条真路径重跑；
仍如此就按上面那条安装命令重装（确认后跑），再重新找路径。

### 2. 先看清单（🔴 显式给 scope，别靠 auto 猜）

```bash
node <上一步找到的路径> --dry-run --scope global              # 当初带 -g 装的（最常见）
node <上一步找到的路径> --dry-run --scope project --project-dir <项目目录>
```

scope 猜错时脚本会打 ⚠️ 警告，看到就先确认 scope；不确定装在哪就两个 scope 都看一眼。
两个 scope 都打「一个本鸭 skill 都没有」= 本机没装，回到第 1 步先问用户，别把「整仓装」当对账跑。

它会联网取上游索引，打印**要归档哪些、要装哪些、要刷新哪些（逐行 `slug 旧版 → 新版 changelog`；标 `auto` 的是占位文案）、以及哪些因你动过手 / 固定而不碰**，一个字都不会改。把这份清单**原样转述给用户**——尤其是「要归档」「要刷新」「你改过的」的名字与 changelog（刷新是覆盖安装，确认的得是具体清单）。

> 🔴 **结论不高于证据。** 上游目录列表拉不到时：**本轮不做任何归档**，刷新 / 新增仍按索引进行，结论改说「按索引对账，
> **上游目录未能核对，本轮不归档**」（`--json` 里 `namesSource: "index"`、`archiveSuppressed: true`；正常是 `"contents-api"`）。
> 索引本身拉不到 → 退回旧三文件（`metaSource: "legacy"`），刷新栏没有版本号与 changelog——都照实转述。
> 🪞 GitHub 403 / 断网时自动改用 **Gitee 镜像同一 tag**（`--json` 里 `sources: {meta,names,install}` 各 `github|gitee|override`）；
> `mirrorMismatch` = 两边 tag 没推齐：退出非 0、不写盘，找维护者。

> 🧹 **旧版遗留副本**（项目根 `agent/skills/`）：执行时只把**我方发的**移进归档目录（可复原），别人的不动，不打删除命令；`--dry-run` 只报告。

### 3. 确认后执行

用户看过清单、认可了，再跑（**scope 参数和上一步给的保持一致**）：

```bash
node <路径> --yes --scope <上一步用的那个> [--project-dir <目录>]
```

脚本会自己完成：归档 → 拉齐全集 → 复核 → 自检（skill 有没有落盘、`DOUBAOYA_API_KEY` 在不在、
doubaoya.com 连不连得通），最后打印一份结果，并告诉用户归档放在哪。

**退出码**：`0` 全通过；`3` 对账做完了但自检有项没过；`1` 用户取消；`2` 需要确认但当前不是交互终端；`4` 出错。

> 📝 **项目里的 `skills-lock.json` 会被一起改，这是预期的。** 它受 git 跟踪，对账跑完 `git status` 会多出这一行；转述时说明是预期改动。

> ⚠️ **跑挂在「拉取上游」**：脚本已**自动把本轮归档按 manifest 移回原处**，只剩 skills CLI 安装记录没补——
> **重跑同一条命令即可**。clone 报 "Remote branch … not found" = tag 没打，找维护者。

> 🔁 **本轮名单含 `dby-update` 自己**：本进程跑的仍是旧代码，结尾会提示再跑一次（`--json` 里 `selfUpdated: true`）——照实转述，**再跑一次 `/dby-update`**。

> 🏷 安装源固定到 `index.json` 顶层 `ref`；缺字段按 `main` 装并提示「未固定」。发布打 tag → `references/release-ref.md`。

### 4. 转述结果

- 全通过 → **逐行转述脚本列的「↻ slug 旧 → 新 changelog」**，再说归档目录在哪、**怎么把归档捞回来**
  （复原命令原样贴），并提醒**新建一次对话**。查包版本读其 `.dby/origin.json`，别读 `skills-lock.json`（CLI 首装记录，不更新）。
  「你改过的」「已固定的」「受 git 跟踪所以没动的」「git 判不出来所以跳过的」**各单独说一句**，别让用户以为漏了。🔴 后两类别混着说：前者是「这是你自己版本化的包，要清你自己 `git rm`」，
  后者是「这台机器上的 git 没能回答我，你先修好 git 再重跑」——用户该做的事完全不同。
- 有 🩹「缺落位」栏 → 说清这几个包**内容本来就是最新的，重装只是补上缺的那处安装目录**（少一处 = 那个宿主看不见它）。
- 本机已和上游一致 → 照实转述「无需任何操作」+ 脚本那行「版本：…」，别自己补「已刷新 N 个」。
- 自检有 ❌ → **明确说卡在哪一步**（skill 没落盘 / 没配钥匙 / 连不上服务），带上脚本给的处理建议，别笼统说「失败了」。

## 常用参数

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只看清单，绝不执行 |
| `--yes` | 跳过确认直接执行（**只在用户已经看过清单之后用**） |
| `--force-refresh` | 连「已经是当前版且落位齐全」的包也重下一遍（留给「包坏了想重装」） |
| `--verbose` | 连「别人家的」和「你改过的」一起列名字 |
| `--scope auto\|global\|project` | 🔴 **每次都显式给**。默认 `auto` 是按 cwd 猜的，猜错会静默变成「整仓重装」。当初带 `-g` 装的就是 `global` |
| `--project-dir <目录>` | 项目级安装在别的目录时指定 |
| `--json` | 机器可读输出 |
| `--self-check` | 离线自检脚本自身（不联网） |
| `--pin <slug> [--reason <文>]` / `--unpin <slug>` | 固定 / 解除固定某个包（不联网，只改 `<scope>/.dby/lock.json`）；固定后对账跳过它。用户说「这个包别更」就用它 |

## 边界

- **只碰本鸭发过的包**（判据是上面那张三态表）；别人家的、你改过的一个字都不动。
- 🔴 git 探测跑不通、判不出来的包同样保守跳过；脚本把它和「受 git 跟踪」**分两栏**打出来，处置不同。
- **不动你的本地数据 / 配置**（`dby-publish` 的 `config.json`、创作 DNA、封面 / 草稿等产出）——对账只覆盖 skill 目录里受版本管理的文件。
- 不创建后台任务、定时任务或 Agent Hook。
- 用户只问「有什么更新 / 现在什么版本 / 要不要更」→ **先回答，不执行**（`--dry-run` 正好用来回答这个）。
  明确要实际同步时才跑第 3 步。
- 只想更新某一个**全局**skill：`npx -y skills update <skill 名> -g`，只碰点名那个（不做对账；项目级安装它看不见，仍走本脚本）。