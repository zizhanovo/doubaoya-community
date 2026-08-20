## 0. 开工纪律（每个批次、每个子代理都适用）

- [x] 0.1 在仓库根 `.WRITER` 写入本会话起止 / 持有路径；收工划掉并记录落下的 commit 与验证结果。验证：`.WRITER` 有本会话条目。
- [x] 0.2 子代理 spec 逐条带上 design D7 六条纪律（只 add 具体路径、收口三笔禁 amend、生成物走生成源、新闸两向验证、`.WRITER`、6 次稳定判据）。验证：派发 prompt 里可 grep 到这六条。
- [x] 0.3 定位主仓盲测 harness（真实反推话术 + haiku 判官），把脚本与话术集钉进主仓 `scripts/`（或记录绝对路径到 `docs/`）。验证：能在干净 shell 里跑通一轮、输出 pick 表。

## 1. 趟 ②「机制小车」：对账器学会读 rename 表（先发、空表、零风险）

- [x] 1.1 核实 `reconcile.mjs` 中 `dby-update` 自身的刷新顺序（design Open Question 1）；在 SKILL.md / 注释写明结论。验证：文档有结论。
- [x] 1.2 新增仓库根 `renames.json`，`schema_version: 1`，`renames: {}`；`tools/validate_community.py` 加闸：每个 `to` 必须是在架 slug、每个旧 slug 必须存在于 `known-hashes.json`。验证（两向）：空表通过；故意写一条 `to` 指向不存在的 slug 时打红，贴两段输出。
- [x] 1.3 `reconcile.mjs` 读取上游 `renames.json`：表缺失 / 不合法 → 提示一行继续；空表 → 行为与旧版逐条一致；有条目 → 「装新包 → 按 userFiles 搬运老目录有而新包没有的文件 → 归档老目录」，冲突不覆盖、失败不归档、受 git 跟踪只提示、输出搬运清单。验证：临时目录造假老包（`config.json` + `profiles/x.json`）+ 假上游表，`--dry-run` 与真跑各一次，文件逐字节相同、老目录进归档；二次运行无动作；空表对照跑输出 diff 为空。
- [x] 1.4 `skills/dby-update/SKILL.md` 补「改名迁移」说明（renames / userFiles 语义、两趟发布为什么）。验证：文档段落存在。
- [x] 1.5 机制小车收口三笔（禁 amend）：内容 commit → `python3 tools/stamp_versions.py` commit → `python3 tools/build_known_hashes.py` commit。验证：`git log -3` 三笔独立；`validate_community.py` + `pytest tools/tests -q` 全绿。
- [x] 1.6（社区仓已推双远端 5281cfa；主仓同步归 -12 会话）交主仓会话编排：社区仓推 → 主仓 `sync-skill-versions.mjs` 重生成两张表并提交 → api 部署。验证：线上 User-Agent 开始出现 `dby-update@<新哈希>`。
- [x] 1.7 ~~观察期~~（用户裁决跳过，见 design Risks）：改名车发布前确认 `dby-update@<新哈希>` 在近 N 天调用里的占比达到可接受水平（阈值由维护者定，写进 `.WRITER`）。验证：查询结果贴进 `.WRITER`。

## 2. 趟 ③ 前置：路由实证先绿（design D8）

- [x] 2.1 `doubaoya → dby-api` A/B：用改名后的候选表（仅 name 变、description 不变）对比当前表，harness 各跑 6 次。验证：无任何话术从「稳定命中」变为「6 次稳定全错」；结果表贴进 commit 说明。
- [x] 2.2 `dby-publish` 合并 A/B：合并后候选表上重跑"存草稿 / 推草稿箱 / 代发 / 排版发布"类话术 6 次。验证：6 次稳定命中 `dby-publish`；对照组（写稿 / 选题类）误吸 0。
- [x] 2.3 若 2.1 / 2.2 出现稳定全错：先改 description 散文边界（不是灌词）再跑；仍红则回到 design 改方案，不得带红落地。验证：最终一轮全绿输出存档。

## 3. 趟 ③ 改名车：目录改名与合并（一个 commit）

- [x] 3.1 `git mv` 五个包并改 frontmatter `name`：`doubaoya→dby-api`、`doubaoya-gateway→dby-gateway`、`wechat-theme-studio→dby-theme`、`wechat-rewrite→dby-rewrite`、`multi-banned-words→dby-banned-words`。验证：`ls skills/` 与各 frontmatter 一致。
- [x] 3.2 `git mv skills/wechat-article-pipeline skills/dby-publish`；diff 两份 `preprocess-and-publish.mjs`，把 draft-publish 独有修复并入；`git mv publish_draft.py` 进 `dby-publish/scripts/`；删除 `skills/wechat-draft-publish/`。验证：两个入口的 `--help` / 自检可跑。
- [x] 3.3 `dby-publish` description = pipeline 原文 + draft-publish 全部触发词；正文加「只存草稿不排版」直达段；**防误发红线逐字保留**（「只存草稿、绝不群发」「用户只要成稿时别自作主张跑它」「需先绑号」）。验证：`validate_description_budget` 通过；draft-publish 旧 description 每个触发词在新 description 中 grep 命中；三条红线原句在新 SKILL.md 中 grep 命中。
- [x] 3.4 删除 `skills/ai-intelligence-investigator/`；在 `docs/deleting-a-skill.md`「例外」段登记"能力随包退出、触发词不迁"，并附反事实数据（4/6 答不上、2/6 幻觉）与"知情取舍"结论。验证：目录不存在、文档有记录与数据。
- [x] 3.5 填满 `renames.json`（7 条，`wechat-article-pipeline` 的 `userFiles` 按 design D4）。验证：1.2 的闸通过。
- [x] 3.6（编排口补充，因跳过观察期）`dby-publish` 脚本入口在 `config.json` 缺失时探测 `.doubaoya/archive/*/…/wechat-article-pipeline/config.json`（同 `profiles/`、`design-config.json`），打印可粘贴的恢复命令，不自动复制。验证：临时 HOME 造归档目录跑入口，输出含恢复命令；无归档时输出不变。

## 4. 趟 ③ 改名车：引用同步与闸

- [x] 4.1 替换 `skills/**` 内全部旧 slug 引用：SKILL.md 互引、`dby-api/references/wechat-routing.json` 的 `primary_skill` / `candidate_skills`、`dby-gateway/references/capability-index.md` 与 `routing-pitfalls.md`、`dby-publish/pipeline.json`、脚本路径字面量（`selfcheck-remote-theme.mjs`、`import-theme.mjs`、`render-wechat-html.mjs`、`pipeline.mjs`、`dby-theme/themes/theme.example.json`、`dby-rewrite/scripts/rewrite.py`、`dby-charter/references/writing-dna.md`）、`skills/dby/SKILL.md` 路由表与新手引导。验证：design D5 grep 在 `skills/` 零命中；`validate_routing_skill_pointers` 通过。
- [x] 4.2 同步 `tools/clawhub.json`（slug 键、displayName 保持中文）、`.agents/plugins/marketplace.json`、`docs/skill-design-references.md`。验证：`validate_clawhub_manifest` 通过。
- [x] 4.3 `tools/validate_community.py`：slug 字面量改新名；无连字符特例集合收为 `{dby}`；`CONTRACT_FREE_SKILLS`、`ROUTING` 等常量更新。验证：校验器通过。
- [x] 4.4 `tools/tests/**` fixture 与断言改新 slug（`test_validate_community.py`、`test_entry_scripts_via_symlink.py`、`test_rewrite_platform_rules.py`、`test_build_known_hashes.py`、`test_clawhub_publish.py`）。验证：`pytest tools/tests -q` 全绿。
- [x] 4.5 按 `docs/deleting-a-skill.md` 五步走 7 个旧 slug 的触发词差集（口径 = description；investigator 例外不迁）；零命中词迁进对应新包。验证：脚本化差集 `T_old − T_new = ∅`，输出贴进 commit message。
- [x] 4.6 新增 `validate_skill_slug_prefix`（目录名 ∈ `{dby} ∪ dby-*` 且等于 frontmatter `name`）并注册进 `validate_repository`；写 `docs/naming.md`。验证（两向）：临时造 `skills/wechat-x/` 打红，删掉通过；元闸通过。
- [x] 4.7 全仓终验：design D5 grep 零命中（排除：`.git`、`openspec/`、`docs/superpowers/`、`known-hashes.json`、`docs/deleting-a-skill.md`）；校验器 + pytest 全绿。

## 5. 趟 ③ 改名车：README 与文档

- [x] 5.1 重写 `README.md`：定位语「公众号 AI 执行外脑：能取数、能查违禁词、能写进草稿箱」；安装前放「真实处境 → 你会得到」对照表（≥ 5 行，每行点名一个在架 `/dby-*`）；技能清单只列 9 个在架包、删除空分类；「更新」章节加新旧 slug 对照表、两跑说明（先升级对账器再迁移）、第一跑已归档时的复原提示、investigator 下架去向与复原命令。验证：`validate_readme` 通过；脚本解析 README 所有表格均 ≥ 1 行数据；对照表里每个 slug 在 `skills/` 存在；「更新」章节 grep 到 `ai-intelligence-investigator` 与复原命令。

## 6. 趟 ③ 改名车：收口与社区仓提交

- [x] 6.1 改名车内容为**一个 commit**（3.x + 4.x + 5.x + `renames.json`），只 add 具体路径；随后 `stamp_versions.py` 一笔、`build_known_hashes.py` 一笔，禁 amend。验证：`git log -3` 三笔独立、中文 message；每笔单独过校验器。
- [x] 6.2 闭集断言：`known-hashes.json` 含 9 个新 slug 当前哈希，且 7 个旧 slug 的全部历史哈希无删减（与改名前文件 diff）。验证：diff 输出只有新增行。
- [x] 6.3 端到端迁移自检：临时 HOME 里按旧 `versions.json` 装一套旧包（含自建 `config.json`），先跑机制小车版对账器（自更新），再跑一次，确认 7 个老目录进归档、9 个新包就位、`config.json` 落在 `dby-publish/`；再用**旧版**对账器单独跑一次模拟"跳过小车"，确认老目录进归档且复原命令可把 `config.json` 找回。验证：两条路径的输出贴进 commit 说明。
- [x] 6.4 回滚演练：在临时分支 `git revert` 改名 commit，确认 `renames.json` 同笔回到空表、校验器通过。验证：revert 后 `renames.json` 为空表且 `validate_community.py` 绿。

## 7. 趟 ③ 主仓涟漪（doubaoyahub，社区仓推后、api 部署前）——**编排口裁决归 doubaoyahub-12 会话执行，本会话不碰主仓写入面**

- [ ] 7.1 `apps/web/src/community-skills.json`：`slugToCommunityDir` 值 `wechat-draft-publish→dby-publish`、`wechat-rewrite→dby-rewrite`；`docsOnlyCommunityDir` 11 条 `doubaoya→dby-api`；`extraInstallableSkills` 三条 `dir` 改 `dby` / `dby-api` / `dby-publish` 并更新 title / summary。验证：JSON 合法；每个值在社区仓 `skills/` 真有目录。
- [ ] 7.2 `apps/web/scripts/agent-docs.selfcheck.ts` 主干断言里硬编码的三个名改新名；其它 selfcheck 中出现的旧 slug 同步。验证：主仓 grep 旧 slug（排除 `docs/releases`、`docs/research`、`docs/skill-research`、`docs/superpowers`、`skills-lock.json`、`*.generated.ts`）零命中。
- [ ] 7.3 生成物全部走生成源重跑：`sync-skill-versions.mjs`（`skill-versions.generated.ts` + `skill-known-hashes.generated.ts`）、`sync-skill-docs.mjs`（skill-docs 快照）、`docs:generate`（llms.txt / start.md）、`skills-lock.json`。验证：生成后 `git diff --stat` 只含这些生成物；无手改。
- [ ] 7.4 跑 `agent-docs.selfcheck.ts`：llms.txt / start.md 里每条 `npx skills add …/skills/<目录>` 逐个核对社区仓目录存在。验证：selfcheck 绿；6 条安装命令全部指向新目录。
- [ ] 7.5 主仓 typecheck + 相关 selfcheck + 受影响测试。验证：全绿输出。
- [ ] 7.6 主仓 commit（只 add 具体路径，生成物与源改动分笔），交主仓会话按「社区仓推 → 主仓推 → api 部署」编排。验证：`.WRITER` 记录交接。
- [ ] 7.7 部署后行级死链探针：对线上 llms.txt / start.md / skills 页每条安装命令与详情页链接逐行探测。验证：0 死链；结果贴进发布账 `docs/releases/`。

## 8. 收尾

- [ ] 8.1 ClawHub：按 `tools/clawhub.json` 预览并上架 9 个新 slug，手工下架 7 个老条目。验证：`clawhub_publish.py` 预览无漂移；老条目状态截图 / 记录。
- [ ] 8.2 与主仓 `skill-update-notice-verdict` 的次序核对：趟 ① 已落、趟 ④ 在本 change 之后。验证：`.WRITER` 与主仓 change 的 tasks 状态一致。
- [ ] 8.3 收工：`.WRITER` 划掉本会话条目，记录全部 commit、验证结果、未 push 项。验证：`.WRITER` 无持有路径。
