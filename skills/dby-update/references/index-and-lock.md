# 索引（index.json）、安装记录（origin / lock）与固定（pin）

> 只在需要解释「为什么这个包被判成你改过 / 为什么没归档 / 怎么让某个包别更新 / 为什么看不到版本号」时读它。
> 普通的归档 / 新增 / 刷新用不到。

## 上游索引：一个事实源

对账器每跑先拉仓库根 `index.json`（`--json` 里 `metaSource: "index"`）。每个 slug 一条：

- `status`：`active | retired | renamed | merged`。**归档 / 迁移只看它**——`retired` 进归档单，`renamed / merged`
  按 `redirectTo` + `userFiles` 走改名迁移（见 `rename-migration.md`）。索引标 `active` 而上游目录里没有 = 索引与目录不一致，
  只出一条「联系维护者」的提示，不归档、不刷新（`--json` 里 `plan.inconsistent`）。
- `knownHashes[]`：这个 slug 发布过的每一版内容哈希（含未盖戳的中间提交），「别人家的」= slug 不在索引里。
- `versions[]`：`versions[0]` 是当前版，每条 `version / hash / ref / changelog / changelogSource`。
  预检刷新栏每行 `slug  旧semver → 新semver  changelog`；`changelogSource: auto` 的是盖戳工具替没写说明的作者生成的占位文案，
  打印时标 `［auto：作者未写，占位文案］`，转述时说清这不是作者写的。
  旧 semver 取本机 `<skill>/.dby/origin.json`；没 origin 就拿目录哈希在 `versions[]` 里找；找不到显示 `?`。
- 顶层 `ref`：安装源固定到的 release tag（`references/release-ref.md`）。

**索引拉不到（404 / 断网）**：退回 `versions.json` + `known-hashes.json` + `renames.json` 三份旧文件，
`metaSource: "legacy"`，提示里点明；三态判定、归档、改名迁移全部照旧，只是刷新栏的版本号是 `?`、changelog 显示「（无变更说明）」。
这是过渡期一趟兼容，上游发了索引之后自然走索引。

**上游目录列表拉不到（Contents API 403 限流）**：`namesSource: "index"`、`archiveSuppressed: true`。
本轮**一个都不归档**（含改名迁移里的归档老目录、旧版遗留副本归档），归档候选单列进「⏸ 本轮不归档」栏（`plan.archiveHeld`）；
刷新 / 新增照常，依据是索引本身。结论文案固定是「按索引对账，上游目录未能核对，本轮不归档」——照实转述，目录能拉到时再跑一次。
`DBY_RAW_BASE` 指定上游时 `namesSource: "override"`，名单以索引 active 为准。
有 `GITHUB_TOKEN` / `GH_TOKEN` 时只有 api.github.com 那一发带上（不进任何输出）。

## Gitee 镜像：备源，不是第二个主源

上游在 Gitee 有一份镜像（`https://gitee.com/zizhan66/doubaoya-community.git`，发布时 tag 两边都推，同 tag 内容哈希一致）。
对账器以 GitHub 为主源、Gitee 为备源，**三处各自独立回退**，`--json` 顶层 `sources: {meta, names, install}` 各取 `github | gitee | override`：

| 步骤 | 主源 | 备源（同一 ref） | 回退成功的标志 |
| --- | --- | --- | --- |
| `meta` 索引 / 旧三文件 | raw.githubusercontent.com `main` | API v5 `contents/<path>?ref=`（base64 解码） | 提示「仅镜像」，`sources.meta: "gitee"` |
| `names` 目录列表 | api.github.com Contents API | API v5 `contents/skills?ref=main` | `namesSource` 仍是 `contents-api`，`sources.names: "gitee"`，归档不压制 |
| `install` clone | `skills add zizhanovo/doubaoya-community#<ref>` | `skills add https://gitee.com/zizhan66/doubaoya-community.git#<ref>` | `sources.install: "gitee"` |

- **只有 403 / 429、网络错误、超时才换源**；404 不换（文件真不存在时两边一样，且 404 是退回旧三文件的既有信号）。
  备源也失败就落回既有降级路径（目录拉不到 ⇒ `archiveSuppressed`；索引拉不到 ⇒ legacy），不比现状更差。
- **同一 ref 才回退**：Gitee 取索引先取 `main`，取到后按其 `ref` 再取同 tag 那份复核两者 `ref` 相同；GitHub 索引已在场、只是目录要用镜像时，
  先核镜像 `main` 索引的 `ref` 与 GitHub 相同。clone 只在有 `ref` 时回退（无 ref 两边默认分支无法保证同一内容，宁可失败）。
- 🔴 **主备 `ref` 不一致 = 镜像落后或超前**：fail-closed，在拉取阶段就退出非 0，不写盘、不打清单，`--json` 只含
  `{mirrorMismatch: {github, gitee}, executed: false}`；提示「联系维护者」——这是发布时 tag 没两边都推，不是用户的问题。
- `DBY_RAW_BASE` 覆盖态是验证用的单源，不回退，`sources` 三项都是 `override`。
- Gitee 取文件只走 API v5（匿名 `/raw/` 路径 404）；镜像匿名 API 也有限流，所以只在主源失败时才碰，每轮最多 2 次请求。

## 安装记录：origin 与 lock

- **`<skill>/.dby/origin.json`**：`{slug, version, hash, ref, installedAt}`，装完 / 刷新完由对账器写。哈希按**落地的真实内容**算，
  版本号是索引里这个哈希对应的 semver（索引没这一版就是 `null`）。点目录不参与内容哈希，所以它的存在不会把包变成「你改过」。
  目录里附一份 `.gitignore`（`*`）自忽略，用户把 skill 版本化进仓库时它不冒出来。
- **`<scope 根>/.dby/lock.json`**：`{version: 1, skills: {slug: {version, hash, installedAt, pinned?, pinReason?}}}`。
  全局 scope 在 `~/.dby/lock.json`，项目 scope 在 `<项目>/.dby/lock.json`（同样自忽略）。
  每次执行完按磁盘现状**重建非 pin 字段**（有 origin 抄 origin，没有就按哈希查索引），`pinned / pinReason` 原样继承。
  lock 只是汇总；它和 origin 不一致时以 origin 为准（随目录走）。
- **「你改过」的判定**：有 origin 时，目录哈希 ≠ `origin.hash` 就是你改过——**哪怕改完的哈希恰好撞上闭集里某个历史版**
  （比如你把文件手动回退到上一版）。没 origin（老版本装的、或你删了 `.dby/`）退回闭集判定：哈希谁都不命中才算改过。
  origin 说没改、闭集却不认识这个哈希（装的那版漏盖戳）：信 origin，按「我们的旧版」照常刷新。

## 固定（pin）

用户说「这个包别更 / 我要留着这版」：

```bash
node <路径> --pin dby-write --reason "自己调过提纲" --scope global
node <路径> --unpin dby-write --scope global
```

- 不联网、不对账，只改 lock。`--scope auto` 时按「这个包装在哪」选 scope，全局和项目都装了就两边都记；固定一个没装的包会报错。
- 固定后每次对账都在 `planReconcile` 之前把它从清单里摘出：不刷新、不归档、不迁移，也不会被当成缺失重装。
  预检单列「📌 已固定、不动」栏并带 `pinReason`（`--json` 里 `plan.pinned: [{name, state, hash, reason}]`）——**转述时单独说一句**。
- `--unpin` 后 lock 里不再有 `pinned / pinReason`，下次对账恢复正常刷新（旧版本号来自 origin）。
- 固定的包上游下架了也不归档；用户真要清就先 `--unpin` 再跑。
