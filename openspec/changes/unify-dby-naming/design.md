## Context

- 11 个包、三套前缀；`doubaoya`/`dby` 在 `validate_community.py` 里有"无连字符也算真 Skill"的特例闸。
- 对账器 `skills/dby-update/scripts/reconcile.mjs` 按**内容哈希**认包：命中当前版→不动，命中历史版且上游已下架→归档，认不出→不动。`known-hashes.json` 由 git 历史全量生成，所以改名前的哈希天然留在闭集里。
- `wechat-article-pipeline` 是大包（541 行 SKILL.md、15 个脚本、16 套主题），用户的 `config.json` / `profiles/` / `design-config.json` 住在包目录里；`wechat-draft-publish` 只有 2 个脚本，其中 `preprocess-and-publish.mjs` 与 pipeline 那份已分叉。
- `.version` 内容 `doubaoya-skill/<slug>@<hash>` 会作为 User-Agent 上报；主仓 doubaoyahub 用 `versions.json` 生成表。
- 校验器有十几道闸（路由指针、下架可发现性、description 预算、触发词覆盖、clawhub 清单漂移、README），改名只要漏一处就会打红——这是我们的安全网，不是障碍。

## Goals / Non-Goals

**Goals:**
- 改名本身是**一个 commit**（用户只经历一次迁移、闭集只重建一次）；但发布拆**两趟**：机制小车（对账器学会读 rename 表）先行，改名车后发。让步的是节奏，不是原子性。
- 改名对用户是零数据丢失的：本地配置随迁移搬家。
- 命名规则变成闸，以后新包进不来错前缀。

**Non-Goals:**
- 不改任何 API 端点、operationKey、信封格式。
- 不重写各包正文内容（只改引用与 frontmatter），`dby-publish` 不做功能合并以外的重构。
- 不处理 ClawHub 线上已发布条目的改名（ClawHub 侧 slug 按 owner 命名空间，老条目留着、新条目另发；只更新本地清单）。
- 不建"触发词倒排闸"（`deleting-a-skill.md` 里的 TODO 保持 TODO）。

## Decisions

### D1 合并方向：pipeline 改名为 dby-publish，draft-publish 被吸收
- 为什么：pipeline 是超集（渲染→图→封面→存草稿），draft-publish 的唯一独有物是 Python 入口 `publish_draft.py`。反向合并要搬 50 个文件。
- 做法：`git mv skills/wechat-article-pipeline skills/dby-publish`；`git mv skills/wechat-draft-publish/scripts/publish_draft.py skills/dby-publish/scripts/`；两份 `preprocess-and-publish.mjs` 先 diff，以 pipeline 版为准，把 draft-publish 版独有的修复（若有）并入后删除 draft-publish 目录。
- description：pipeline 现有 description + draft-publish 的触发词（存公众号草稿 / 公众号草稿箱 / 代发公众号草稿箱 / addDraft / draft/add），写完过 1024 预算；正文加一节「只想存草稿、不要排版」直达 `publish_draft.py`。
- 备选（否决）：保留两个包只改前缀——`deleting-a-skill.md` 里已记录同端点双壳互抢触发词的教训，不再制造新的一对。

### D2 `doubaoya` → `dby-api` 而非 `dby-data`
- 它既管取数也管 AI 生成 / 写作能力路由，"data" 窄了；"api" 对开发者直白，对普通用户 description 首句仍是中文身份词，不影响匹配。
- 特例闸：`validate_community.py` 中 `HYPHENLESS`/"无连字符真 Skill" 的集合从 `{doubaoya, dby}` 收为 `{dby}`；相关测试 fixture 同步。

### D3 下架 `ai-intelligence-investigator` 走"能力随包退出"豁免——知情取舍
- **实证代价**：主仓会话做过反事实实验——删掉它之后「查公司底细」类话术 6 次里 4 次答不上、2 次幻觉编造不存在的包；「意图缺口会变成幻觉」是有数据的，不是假设。此前批 4 压缩轮的裁决也是「investigator 留」。
- **为什么仍然移出**：定位收敛到「公众号执行外脑」后，情报调查在域外；留着它等于继续给 README 一个与主线无关的分类。**明确接受**：该意图的用户会遇到答不上或幻觉。
- **缓解**：① README「更新」章节告诉老用户它去了归档目录、贴出归档 manifest 的一条复原命令（对账器已会打印）；② 它不打任何 doubaoya 端点，`validate_retired_discoverability` 天然无要求；其 description 触发词（情报调查 / 竞品调查 / 舆情调查 / 信息核实 …）**不迁**——迁了等于承诺一个不存在的能力；③ 在 `deleting-a-skill.md`「例外」段登记，并把反事实数据一并写进去，供以后翻案时有据可查。
- 代码去向：单独 `git subtree split` 或直接归档到 `docs/retired/` 不保留——选**不保留**，git 历史就是归档（与之前删包做法一致）。

### D4 rename 表：仓库根 `renames.json`，对账器拉取
- 形状：
  ```json
  { "schema_version": 1,
    "renames": { "wechat-article-pipeline": { "to": "dby-publish",
                  "userFiles": ["config.json", "design-config.json", "profiles/", "themes/", "assets/ip/"] },
                 "wechat-draft-publish": { "to": "dby-publish", "userFiles": [] }, … } }
  ```
- `userFiles` 里的目录按"老目录有、**上游新包没有**的文件"搬（这样上游自带的 `themes/benya-clean.json` 不会被老副本覆盖，用户自建的 `themes/mine.json` 会搬过去）。
- 为什么放仓库根而不是硬编码进 `reconcile.mjs`：对账器本身也是被更新的包，硬编码会让"老对账器"不知道新改名；表随上游拉取，则**任何已学会读表的对账器**都能处理之后的每一次改名；本次改名则靠下面的两趟发布保证用户首跑时对账器已会读表。
- **机制矛盾与两趟发布**：老用户机器上首跑的是**旧对账器进程**——它把 `dby-update` 当普通包刷新，新代码要下一次运行才生效。若机制与改名同车发布，用户第一跑的执行者仍是不认识 rename 表的旧版：7 个老目录（含 `config.json` / `profiles/`）被整体归档而不是搬家——数据不丢（可复原），但"零数据丢失搬家"在第一跑就落空。因此拆两趟：
  - **机制小车**：只发「对账器读上游 `renames.json` + 搬运逻辑」，此时表内 `renames` 为空对象，零行为变化、零风险；靠主仓更新提示推动存量用户升级到新对账器。
  - **改名车**：几天后（观察 User-Agent 里 `dby-update@<新哈希>` 的占比到可接受水平）再发改名 commit + 填满 `renames.json`。
  - 备选（否决）：「自更新后 re-exec 新版继续本次对账」——新机制、进程替换风险高、跨宿主行为不一致。
- Open Question 1 仍要核实（对账器是否先刷新自己），但它不再是本次正确性的前提。
- 备选（否决）：让 `dby-publish` 首次运行时去老目录找 config——依赖老目录还在，而对账器会先归档它；且每个改名包都要加这段逻辑。

### D5 旧 slug 引用清理口径
- 必清：`skills/**`（含路由表 `wechat-routing.json`、`capability-index.md`、`routing-pitfalls.md`、脚本内路径字面量如 `selfcheck-remote-theme.mjs` / `import-theme.mjs` / `pipeline.json`）、`tools/**`、`docs/skill-design-references.md`、`docs/deleting-a-skill.md`（其中举例里的老包名换成新名或改为"某包"）、`README.md`、`.agents/plugins/marketplace.json`、`tools/clawhub.json`。
- 不清（本仓）：`known-hashes.json`（闭集，必须保留）、`docs/superpowers/**`（历史设计稿）、`openspec/`、`docs/deleting-a-skill.md`（历史教训举例，见 Risks）。
- 不清（主仓 doubaoyahub）：`docs/releases/**`（发布账）、`docs/research/**`、`docs/skill-research/**`、`docs/superpowers/**`——都是史实记录，含旧 slug 不追改；`skills-lock.json` 与两张 `*.generated.ts` 走生成源重生成，不手改。
- 验收命令写进 tasks：`grep -rn -E 'doubaoya-gateway|wechat-(article-pipeline|draft-publish|theme-studio|rewrite)|multi-banned-words|ai-intelligence-investigator' --exclude-dir=.git --exclude-dir=openspec --exclude-dir=superpowers --exclude=known-hashes.json .` 期望零行；裸 `doubaoya` 因与域名 / owner / User-Agent 前缀同词，单独按 `skills/doubaoya[^-]`、`"doubaoya"`（clawhub owner 与 marketplace plugin name 除外）核。

### D6 命名闸
- `validate_community.py` 新增 `validate_skill_slug_prefix`：目录名 ∈ `{dby} ∪ dby-*`，且等于 frontmatter `name`；注册进 `validate_repository`（仓库已有"闸定义了就必须注册"的元闸，漏注册会被拦）。
- `docs/naming.md` 写规则 + 为什么（dbskill 对照、tab 补全、身份词）。

### D7 执行方式与纪律
- 按用户要求，实现任务派 **sonnet 子代理**分批执行；主会话只做拆任务、审 diff、跑校验。每批次结束必须跑 `python3 tools/validate_community.py` 与 `python3 -m pytest tools/tests -q`，绿了才进下一批。
- 子代理 spec 里必须逐条带上这两天攒下的纪律：
  1. **只 `git add` 具体路径**，禁 `-A` / `.`；按逻辑变更拆 commit。
  2. **收口三笔顺序固定且禁 amend**：内容 commit → `stamp_versions.py` 盖戳 commit → `build_known_hashes.py` 闭集 commit。闭集从 git 历史重建，amend 会让闭集与历史错位。
  3. **生成物走生成源**：`versions.json` / `known-hashes.json` / 主仓 `*.generated.ts` / `skills-lock.json` / llms.txt 一律由脚本重生成，不手改。
  4. **新闸两向验证**：每道新增校验既要"合法输入通过"，也要"故意造坏当场打红"，两个方向都贴输出。
  5. **`.WRITER` 约定**：开工在仓库根 `.WRITER` 写入起止 / 会话 / 持有路径，收工划掉并记录落下的 commit 与验证结果；未 push 的按约定交由主仓会话统一编排 push 与 api 部署。
  6. 路由实证用主仓盲测 harness（真实反推话术 + haiku 判官），判据是「**6 次稳定全错**」，不是命中数下降；对照表必须是真实已发布状态，不用模拟表。

### D8 两处路由实证必须先绿后落
- **`doubaoya → dby-api`**：此前的盲测都是带着 `doubaoya` 这个名字跑的，候选表里名字本身有语义在场性，description 不变 ≠ 路由不变。用改名后的候选表 A/B 重跑（harness 现成，约半小时），绿了才 `git mv`。
- **`dby-publish` 合并**：当初 `wechat-draft-publish` 独立成包是给「写进用户公众号后台」设选择门槛（副作用隔离裁决）。推翻它的前提是安全性改由 SOP 承载：合并后防误发红线**逐字保留**（「只存草稿、绝不群发」「用户只要成稿时别自作主张跑它」），并用 harness 重跑"存草稿 / 推草稿箱 / 代发"类受影响话术，6 次稳定命中 `dby-publish`。
- 🔴 harness 不在任何仓库里（主仓会话 scratchpad）：实现第一步要先定位并把它钉进主仓 `scripts/`（或至少记录路径），否则"重跑"无从谈起。

## Risks / Trade-offs

- [老用户不跑 `/dby-update`，老包继续在、收不到更新] → README「更新」章节写明；老包哈希仍在闭集，任何时候跑更新都能正确迁移。
- [用户本地 `config.json` 被归档而非搬家] → D4 的顺序与"搬运失败则不归档"的规则；tasks 里加一条用临时目录的端到端自检。
- [ClawHub 上老 slug 条目仍挂着] → 本次只更新清单；上架新 slug 后由维护者在 ClawHub 下架老条目（手工，不在本 change 内）。
- [主仓 doubaoyahub 生成表过期] → `stamp_versions.py` 已有漂移提醒；完成后通知主仓跑 `sync-skill-versions.mjs`。
- [description 合并后超 1024] → 先量后写：合并前统计两包触发词字符数；超了砍散文不砍触发词。
- [`deleting-a-skill.md` 举例含老包名，改成新名会让"历史教训"失真] → 举例处保留老名但加注"（已改名为 X）"，该文件列入 D5 排除表。
- [移出 investigator 后「查公司底细」类意图答不上 / 幻觉（实测 4/6 + 2/6）] → 知情接受（D3）；README 给复原命令。
- [改名改变路由但 description 没变，没人发现] → D8 两处盲测先绿后落。
- [机制小车与改名车之间用户没升级对账器] → **2026-08-20 用户裁决：跳过观察期，趟②与趟③连发**。知情接受：未升级对账器的用户首跑时老目录（含 `config.json`）整体进归档、不搬家，按输出的复原命令手工找回；README「更新」章节必须写明这条路径。
  **2026-08-20 端到端实测（tasks 6.3）修正了这条风险的量级**：旧对账器把带 `config.json` 的 `wechat-article-pipeline` 判成 `modified`（内容哈希不命中任何版本）→ **原地不动、不归档**；第一跑只归档 7 个纯历史版包并把 `dby-update` 刷到新版，第二跑由新对账器按改名表搬走 `config.json` / `profiles/`。只有从未放过本地数据的老目录会在第一跑被归档——而它们没有数据可丢。README「先跑一次、再跑一次」的说法与实测一致。

## Migration Plan

四趟互不纠缠，次序固定：
- **趟 ①** 主仓 `skill-update-notice-verdict` 第一段（闭集同步，零风险）——先走，本 change 不碰。
- **趟 ② 机制小车**（本 change）：`renames.json`（空表）+ 对账器读表与搬运逻辑 + 自检 → 收口三笔（内容 / 盖戳 / 闭集）→ 社区仓推 → 主仓同步生成表 → api 部署。观察几天。
- **趟 ③ 改名车**（本 change）：
  1. 路由实证先绿（D8）。
  2. 一个 commit 完成全部 `git mv` / 删除 / 引用替换 / frontmatter 改名 / `dby-publish` 合并与 description / 命名闸与测试 / README 与 `docs/naming.md` / 填满 `renames.json`。
  3. 收口三笔：盖戳 → 闭集（禁 amend）。
  4. **社区仓推 → 主仓推 → api 部署**（硬次序）：主仓改 `community-skills.json` 三表、`agent-docs.selfcheck.ts`，重跑 `sync-skill-versions.mjs` / `sync-skill-docs.mjs` / `docs:generate`，selfcheck 对 llms.txt 每条安装命令逐个核；部署后跑行级死链探针。
  5. ClawHub 上架新 slug、下架老条目（手工）。
- **趟 ④** 主仓 `skill-update-notice-verdict` 第二段。
- **回滚**：改名在一个 commit 里，`git revert` 时 `renames.json` 必须在**同一笔** revert 里回到空表（否则新对账器会按表把"新包"再搬一次）；用户侧因旧哈希仍在闭集，回滚后再跑 `/dby-update` 会把新包归档、老包重装。主仓三表同理同笔回滚。

## Open Questions

1. `reconcile.mjs` 是否已保证 `dby-update` 自身先刷新、再对账其余包？实现第一步核实；若否，在本次加入该顺序（不改变 spec）。
