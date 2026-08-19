---
name: dby-update
description: |
  都爆鸭（doubaoya / 本鸭）skill 对账更新器。用户说「更新本鸭」「更新都爆鸭」「升级 doubaoya skill」
  「把本鸭更新到最新版」「检查本鸭更新」或输入 /dby-update 时使用。
  把本机这套本鸭 skill 对账成官方仓库 zizhanovo/doubaoya-community 的当前全集——
  归档上游已下架的、装上新增的、刷新其余的，并在结束后自检能不能正常用。
  按内容哈希认包：只碰本鸭发布过的，别人家的、以及你自己改过的都一个字不动；
  下架的是移进归档目录而不是删除。也不动你本地的 config.json / 创作 DNA / 产出文件。
  Reconciles the locally installed doubaoya (本鸭) skills to the upstream set: archives retired ones,
  installs new ones, refreshes the rest, then self-checks. Use when the user asks to update or upgrade doubaoya skills.
  Trigger: /dby-update, 更新本鸭, 更新都爆鸭, 升级 doubaoya skill, 检查本鸭更新.
version: 3.0.0
---

# dby-update：把本鸭对账到最新

用户已明确要求更新都爆鸭（本鸭）。直接执行，不再做第二次文字确认；宿主若要 Shell 权限，由用户在宿主权限窗口里决定。

## 这个 skill 干的是「对账」，不是「更新」

让本机这套本鸭 skill **等于**上游当前全集：

- **归档**上游已经下架的（否则它们会永久停在被砍前的旧契约上，调用必然报错）
- **装上**新增的
- **刷新**其余的

> ⚠️ 别用 `npx skills update`：它只更新「已经装了的」，**永远删不掉上游已下架的那些**。
> 老用户机器上常见几十个早就砍掉的平台垂类 skill，`update` 一辈子摸不到它们。

### 怎么判断「这包是不是本鸭发的」

**看内容哈希，不看它当初用什么名字装的。** 上游 `known-hashes.json` 是一份闭集，
记着本鸭发布过的每一个 slug 的每一版内容哈希。于是有三态：

| 状态 | 判据 | 处置 |
| --- | --- | --- |
| 当前版 | 哈希 = 上游当前版 | 保留 / 刷新 |
| 我们的旧版 | 哈希命中闭集里某个历史版 | 可归档、可替换 |
| **你动过手** | slug 是本鸭的，但哈希谁都不命中 | 🔴 **跳过并列进报告，一个字都不动**，连刷新都不给（刷新会盖掉你的改动） |
| 别人家的 | slug 根本不在闭集里 | 不碰 |

这样改名（本仓早期叫 `redfox-community`）、`source` 字段缺失、别家有同名包，都不会判错。

### 删除一律做成「归档」

要下架的包**移进 `~/.doubaoya/archive/<时间戳>/`，不做 `rm`**，同目录留一份 `manifest.json`
写明每个包原来在哪、怎么移回去。多一个目录的成本，换「删错了还能捞回来」。

## 执行步骤

### 1. 找到对账脚本

按顺序找第一个存在的：

```
~/.claude/skills/dby-update/scripts/reconcile.mjs
~/.agents/skills/dby-update/scripts/reconcile.mjs
./.claude/skills/dby-update/scripts/reconcile.mjs
./.agents/skills/dby-update/scripts/reconcile.mjs
```

**找不到**说明本机装的是旧版 dby-update（还没有对账能力）。先跑一次下面这条把自己升级上来，然后**重新找一遍**：

```bash
npx -y skills add zizhanovo/doubaoya-community -g --all
```

### 2. 先看清单

```bash
node <上一步找到的路径> --dry-run
```

它会联网取上游全集与历史闭集，然后打印**要归档哪些、要装哪些、要刷新几个、以及哪些因为你动过手而不碰**，
这一步一个字都不会改。把这份清单**原样转述给用户**——尤其是「要归档」那几个的名字，
以及「你改过的」那几个（那是在告诉用户：这些我认出来你动过，所以不动它们）。

### 3. 确认后执行

用户看过清单、认可了，再跑：

```bash
node <路径> --yes
```

脚本会自己完成：归档 → 拉齐全集 → 复核 → 自检（skill 有没有落盘、`DOUBAOYA_API_KEY` 在不在、
doubaoya.com 连不连得通），最后打印一份结果，并告诉用户归档放在哪。

**退出码**：`0` 全通过；`3` 对账做完了但自检有项没过；`1` 用户取消；`2` 需要确认但当前不是交互终端；`4` 出错。

### 4. 转述结果

- 全通过 → 告诉用户归档了几个、装了几个、现在共几个、归档目录在哪，并提醒**新建一次对话**才能读到新能力。
  如果有「你改过的」那一类，**必须单独说一句**，别让用户以为它们被漏掉了。
- 自检有 ❌ → **明确说卡在哪一步**（是 skill 没落盘、还是没配钥匙、还是连不上服务），把脚本给的那句处理建议一起带上。别笼统说「失败了」。

## 常用参数

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只看清单，绝不执行 |
| `--yes` | 跳过确认直接执行（**只在用户已经看过清单之后用**） |
| `--verbose` | 连「别人家的」和「你改过的」一起列名字 |
| `--scope auto\|global\|project` | 默认 `auto`：哪儿装了本鸭就对哪儿。当初带 `-g` 装的就是 `global` |
| `--project-dir <目录>` | 项目级安装在别的目录时指定 |
| `--json` | 机器可读输出 |
| `--self-check` | 离线自检脚本自身（不联网） |

## 边界

- **只碰本鸭发过的包**，判据是上面那张三态表（内容哈希命中闭集）。
  **别人家的、以及你自己动过手的，一个字都不动。**
- **要下架的包是移进归档目录，不是删掉**，随时能按 `manifest.json` 移回来。
- **不动你的本地数据 / 配置**：`wechat-article-pipeline` 的 `config.json`、`ip-profile` 的创作 DNA、
  封面 / 草稿等产出文件都不受影响——对账只覆盖 skill 目录里受版本管理的那些文件。
- 不创建后台任务、定时任务或 Agent Hook。
- 用户只问「有什么更新 / 现在什么版本 / 要不要更」→ **先回答，不执行**（`--dry-run` 正好用来回答这个）。
  明确要实际同步时才跑第 3 步。
- 只想更新某一个 skill：`npx -y skills update <skill 名> -g`，只碰点名那个（但它不会做对账）。

## 语言

用户用中文就用中文回复，用英文就用英文回复。
