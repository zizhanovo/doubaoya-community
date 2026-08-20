## Why

仓库现有 11 个 skill 用了三套前缀（`dby-*` / `doubaoya*` / `wechat-*`）外加两个无前缀包，用户在 agent 里 tab 补全找不到"全家桶"，也分不清 `doubaoya` 与 `dby` 哪个是入口；README 按 doubaoya API 版图画了六个分类，其中五个表格是空的，定位没有收敛。对标 dbskill（`/dbs` + `/dbs-*` 统一前缀、"真实处境 → 你会得到"开场）后结论是：我们的差异点是**能真的取数、查违禁词、写进草稿箱**（执行），而不是 API 目录，命名与 README 都应该围绕这个收敛。

## What Changes

- **BREAKING** 全量统一 `dby-` 前缀：
  - `doubaoya` → `dby-api`
  - `doubaoya-gateway` → `dby-gateway`
  - `wechat-theme-studio` → `dby-theme`
  - `wechat-rewrite` → `dby-rewrite`
  - `multi-banned-words` → `dby-banned-words`
  - `dby` / `dby-charter` / `dby-update` 不动
- **BREAKING** 合并 `wechat-article-pipeline` + `wechat-draft-publish` → `dby-publish`：以 pipeline 为主体改名，把 draft-publish 的 Python 入口 `publish_draft.py` 与触发词并入；draft-publish 下架。
- **BREAKING** `ai-intelligence-investigator` 移出仓库（与都爆鸭无关，稀释定位），按 `docs/deleting-a-skill.md` 作为"能力随包一起退出"处理。
- 老 slug 全部走 `docs/deleting-a-skill.md` 五步 checklist：触发词零漏地迁进新包 description；旧哈希保留在 `known-hashes.json` 闭集里供对账器认领。
- `dby-update` 对账器新增 **rename 表**：老包被归档时把用户本地数据（`config.json`、`profiles/`、自定义 theme、`design-config.json`）搬到新包目录，而不是跟着老目录进归档。
- 全仓引用同步：`tools/validate_community.py` 与其测试、`tools/clawhub.json`、`.agents/plugins/marketplace.json`、`docs/*`、各 SKILL.md / references / 路由表 `wechat-routing.json` 中的互相引用、脚本内的路径字面量。
- 重建 `versions.json` / `known-hashes.json`（`tools/stamp_versions.py` + `tools/build_known_hashes.py`）。
- README 重写：定位语「公众号执行外脑：能取数、能发布」；开场用「真实处境 → 你会得到」对照表；技能清单只列在架的 9 个包；删除空分类表格。
- 新增 `docs/naming.md`：写死前缀规则，作为后续新包的准入约束，并在 `validate_community.py` 加闸（`skills/` 下目录名必须是 `dby` 或 `dby-*`）。
- **两趟发布**：第一趟「机制小车」只发对账器读 `renames.json` 的能力（表为空、零风险），靠更新提示推动存量用户升级；几天后第二趟「改名车」一个 commit 完成全部改名。原因：老用户机器上首跑的是旧对账器，它不认识 rename 表，会把老目录整体归档而不是搬家。
- **主仓 doubaoyahub 连锁改动**（与社区仓同一 change 编排）：`apps/web/src/community-skills.json` 三张映射表、`agent-docs.selfcheck.ts` 硬编码断言、`agent-guide.ts` 渲染的 llms.txt / start.md 安装命令、skill-docs 快照与 `docs:generate`、`skill-versions.generated.ts` / `skill-known-hashes.generated.ts`、部署后行级死链探针。

## Capabilities

### New Capabilities
- `skill-naming`: 仓库内 skill 的命名契约——前缀规则、主入口、改名/合并/下架时触发词与哈希闭集的保全要求。
- `skill-rename-migration`: `dby-update` 对账时对"已改名包"的处理——老目录归档、新包安装、用户本地数据跨目录搬运。
- `readme-positioning`: 仓库 README 的定位与结构契约——定位语、"处境→所得"开场、清单只列在架包、不出现空分类。

### Modified Capabilities
（项目此前未初始化 OpenSpec，没有既有 spec 可修改。）

## Impact

- **已安装用户**：机制小车落地后，改名车发布的下一次 `/dby-update` 会归档 7 个老目录、装上 7 个新目录；不跑更新的用户老包继续可用但不再收到更新。`wechat-article-pipeline/config.json` 等本地数据靠 rename 表搬运，这是唯一的数据丢失风险点；跳过机制小车直接跑到改名车的用户，数据会随老目录进归档（可复原，不搬家）。
- **`ai-intelligence-investigator` 的用户**：反事实实验已记录删掉它后「查公司底细」类意图 6 次里 4 次答不上、2 次幻觉编造不存在的包。这是**知情取舍**：该意图在「公众号执行外脑」域外，接受幻觉代价；README 迁移提示写明它去了归档、怎么复原（归档 manifest 一条命令移回）。
- **路由实证**：`doubaoya → dby-api` 与合并 `dby-publish` 都可能改变路由（候选表里名字本身有语义在场性），必须用主仓盲测 harness（真实反推话术、haiku 判官）按「6 次稳定全错才算坏」判据重跑，绿了才落。
- **代码**：`skills/` 下 8 个目录改名/合并/删除；`tools/validate_community.py`（1693 行，几十处 slug 字面量，含 `doubaoya`/`dby` 无连字符特例——改名后特例只剩 `dby`）；`tools/tests/` 全部 fixture；`skills/dby-update/scripts/reconcile.mjs`。
- **发布面**：`tools/clawhub.json`（ClawHub 上架清单）、`.agents/plugins/marketplace.json`、`versions.json` / `known-hashes.json`（主仓 `sync-skill-versions.mjs` 同步进两张生成表）。
- **主仓**（doubaoyahub）：`community-skills.json` 的 `slugToCommunityDir` 值含 `wechat-draft-publish` / `wechat-rewrite`，`docsOnlyCommunityDir` 11 条全指 `doubaoya`，`extraInstallableSkills` 三条（`dby` / `doubaoya` / `wechat-article-pipeline`）——改名后全部悬空；`agent-docs.selfcheck.ts` 主干断言硬编码这三个名；llms.txt 6 条 `npx skills add …/skills/<目录>` 命令会变 6 条死链（此前两天内已清过两次）。
- **发布次序**：与主仓 `skill-update-notice-verdict`（三值裁决）交错为四趟互不纠缠：① 该 change 第一段（闭集同步，零风险）→ ② 本 change 机制小车 → ③ 本 change 改名车（社区仓推 → 主仓推 → api 部署）→ ④ 该 change 第二段。
- **description 预算**：合并后 `dby-publish` 的 description 要容纳两包触发词且 ≤ 1024 字符；全仓总和 ≤ 8000 的闸不能破。
- **不影响**：doubaoya.com 的 API 端点与 `operationKey`（`doubaoya-skill/<slug>@<hash>` 的 User-Agent 前缀也不变，只换 slug）。
