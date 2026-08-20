## Purpose

规定仓库根 README 的定位表达与结构，使读者在前三屏内看到"自己的处境被说中"与"本库能真的执行什么"，而不是一份 API 版图。

## ADDED Requirements

### Requirement: 定位语
README 标题下的第一段定位语 MUST 表达「公众号 AI 执行外脑：能取数、能查违禁词、能写进草稿箱」这一差异点，MUST NOT 以 API 或平台清单作为开场。

#### Scenario: 首屏
- **WHEN** 读者打开 README
- **THEN** 在「安装」章节之前就能读到定位语，且定位语中出现「取数」「草稿箱」「违禁词」三个能力词中的至少两个

### Requirement: 「真实处境 → 你会得到」对照表
README MUST 在安装说明之前包含一张两列对照表，左列是用户口语化的真实处境，右列是本库给出的具体产出及对应 `/dby-*` 入口；至少覆盖「选题 / 写稿 / 排版发布 / 合规 / 定位」五类处境。

#### Scenario: 表格内容
- **WHEN** 读者看对照表
- **THEN** 每一行右列都点名一个在架 skill，且该 skill 存在于 `skills/`

### Requirement: 技能清单只列在架包、无空分类
README 技能清单 MUST 与 `skills/` 目录一一对应（数量与 slug 都一致），MUST NOT 出现没有任何条目的分类表格，MUST NOT 提及已下架的 slug。

#### Scenario: 无空表
- **WHEN** 解析 README 中所有 Markdown 表格
- **THEN** 每张表至少有一行数据

#### Scenario: 计数一致
- **WHEN** README 写「技能清单（共 N 个）」
- **THEN** N 等于 `skills/` 下目录数，且 `validate_readme` 通过

### Requirement: 主入口与更新入口可见
README MUST 在安装章节紧接着说明 `/dby` 为主入口、`/dby-update` 为更新入口，并说明本次改名后老用户需运行一次 `/dby-update` 完成迁移。

#### Scenario: 迁移提示
- **WHEN** 老用户阅读「更新」章节
- **THEN** 能看到本次 slug 变更的新旧对照表、一句"先跑一次 `/dby-update` 让对账器升级，再跑一次完成改名迁移，本地配置会自动搬到新目录"，以及"若第一跑就已归档老目录，`config.json` 在归档目录里，按输出的复原命令找回"

#### Scenario: 下架包的去向
- **WHEN** 老用户想继续用 `ai-intelligence-investigator`
- **THEN** 「更新」章节说明它已下架、本地副本在归档目录里、贴出从归档 manifest 复原的一条命令
