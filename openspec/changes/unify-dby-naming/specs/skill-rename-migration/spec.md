## Purpose

规定 `dby-update` 对账器在上游把某个 slug 改名（或合并进另一个 slug）后，如何在用户机器上完成迁移：老目录归档、新包安装，并把用户在老目录里留下的本地数据搬到新目录，避免改名导致用户配置"消失"。

## ADDED Requirements

### Requirement: 仓库发布 rename 表
仓库根 MUST 随包发布一份 rename 表（`renames.json`），声明 `旧 slug → 新 slug` 以及该旧包里属于用户本地数据的相对路径列表。对账器 MUST 从上游拉取该表，而不是硬编码。表 MAY 为空（`renames: {}`），此时对账器行为 MUST 与没有该表时完全相同。

#### Scenario: 空表（机制小车阶段）
- **WHEN** 上游 `renames.json` 的 `renames` 为空对象
- **THEN** 对账器不做任何搬运或额外归档，输出与旧版对账器逐条一致

#### Scenario: 表缺失或不可解析
- **WHEN** 上游没有 `renames.json`，或内容不是合法 JSON / `schema_version` 不认识
- **THEN** 对账器按"无 rename"继续对账，并在输出中提示一行，不中止

#### Scenario: 表内容（改名车阶段）
- **WHEN** 读取 `renames.json`
- **THEN** 至少包含 `wechat-article-pipeline → dby-publish`（本地数据：`config.json`、`design-config.json`、`profiles/*`、`themes/*`中不在上游包内的文件、`assets/ip/*`中不在上游包内的文件）、`wechat-draft-publish → dby-publish`、`wechat-theme-studio → dby-theme`、`wechat-rewrite → dby-rewrite`、`multi-banned-words → dby-banned-words`、`doubaoya → dby-api`、`doubaoya-gateway → dby-gateway`

### Requirement: 改名包的迁移顺序
对账时若老 slug 在 rename 表中、且老目录被判为"我们发的历史版"或"用户改过的我们的包"，对账器 MUST 按「装新包 → 搬本地数据 → 归档老目录」的顺序执行；任一步失败 MUST 停止并保留老目录原地不动。

#### Scenario: 正常迁移
- **WHEN** 用户机上有 `wechat-article-pipeline/`（含自建 `config.json` 与 `profiles/my-ip.json`），上游已无该 slug 且 rename 表指向 `dby-publish`
- **THEN** 对账后 `dby-publish/config.json` 与 `dby-publish/profiles/my-ip.json` 存在且内容与原文件逐字节相同；`wechat-article-pipeline/` 进入归档目录；输出里明确列出搬运了哪些文件

#### Scenario: 新包已有同名文件
- **WHEN** 搬运目标 `dby-publish/config.json` 已存在
- **THEN** 不覆盖，保留目标文件，在输出中提示冲突并给出老文件在归档目录里的路径

#### Scenario: 搬运失败
- **WHEN** 复制本地数据时发生 I/O 错误
- **THEN** 老目录不被归档，输出给出可手工执行的复制命令

### Requirement: 受 git 跟踪的老目录不动
老目录若受 git 跟踪（沿用现有判定），对账器 MUST 不归档、不搬运，只在输出中列出"需手工迁移"及对应命令。

#### Scenario: 跟踪中的包
- **WHEN** `wechat-rewrite/` 在用户项目仓里被 git 跟踪
- **THEN** 目录保持原样，输出提示用户手工处理

### Requirement: 旧对账器的退化行为可接受且可复原
不认识 rename 表的旧版对账器遇到已改名的上游时，MUST 仍按既有规则把老目录整体移进归档目录（含用户本地数据），MUST NOT 删除；归档 manifest 与复原命令 MUST 能把本地数据手工找回。

#### Scenario: 跳过机制小车的用户
- **WHEN** 用户从未升级对账器，直接在改名车发布后跑一次旧版 `/dby-update`
- **THEN** 老目录进归档、新包装上，输出打印复原命令；用户按 README 提示可把 `config.json` 从归档目录复制到新目录

### Requirement: 幂等
对同一台机器重复运行对账 MUST 不产生第二次搬运或第二份归档。

#### Scenario: 二次运行
- **WHEN** 迁移完成后再次运行 `/dby-update`
- **THEN** 输出无归档、无搬运条目
