## Purpose

规定本仓库 `skills/` 下每个 skill 的目录名与 frontmatter `name` 必须遵守的命名契约，以及改名、合并、下架一个 skill 时对可发现性（触发词）与可认领性（哈希闭集）的保全要求。

## ADDED Requirements

### Requirement: 统一前缀
`skills/` 下每个目录名 MUST 与其 `SKILL.md` frontmatter `name` 相同，且 MUST 是 `dby` 或形如 `dby-<kebab>`。主入口 MUST 是唯一无连字符的 `dby`。

#### Scenario: 合规目录名
- **WHEN** 校验器扫描 `skills/dby-publish/SKILL.md` 且其 `name: dby-publish`
- **THEN** 命名闸通过

#### Scenario: 非法前缀
- **WHEN** `skills/` 下出现 `wechat-foo/` 或 `foo/` 目录
- **THEN** `tools/validate_community.py` 以非零退出并指出该目录名不满足 `dby` / `dby-*`

#### Scenario: 目录名与 name 不一致
- **WHEN** `skills/dby-theme/SKILL.md` 的 `name` 为 `wechat-theme-studio`
- **THEN** 校验器报错

### Requirement: 在架集合
改动完成后，在架 skill MUST 恰为：`dby`、`dby-update`、`dby-charter`、`dby-api`、`dby-gateway`、`dby-publish`、`dby-theme`、`dby-rewrite`、`dby-banned-words`（共 9 个）。

#### Scenario: 清单一致
- **WHEN** 读取 `skills/` 目录、`versions.json`、`tools/clawhub.json`、README 技能清单
- **THEN** 四处的 slug 集合完全相同，均为上述 9 个

### Requirement: 改名保全触发词
一个 slug 被改名或合并时，其旧 `description` 中的每个触发词 MUST 仍能在某个在架包的 `description` 中被找到（口径只看 `description`，不看正文 / README / references）。

#### Scenario: 合并后触发词不丢
- **WHEN** `wechat-draft-publish` 并入 `dby-publish`
- **THEN** 「存公众号草稿 / 公众号草稿箱 / 代发公众号草稿箱 / addDraft / draft/add」每个词都出现在 `dby-publish` 的 description 中

#### Scenario: 身份词仍在场
- **WHEN** 用户对 agent 说「doubaoya」「都爆鸭」「本鸭」「DOUBAOYA_API_KEY」
- **THEN** `dby-api` 的 description 以这些身份词开头，保证旧宿主截断时最先丢的不是身份

### Requirement: 哈希闭集保全
改名 / 合并 / 下架不得让任何历史上发布过的 slug 的哈希从 `known-hashes.json` 闭集中消失；新 slug 的当前哈希 MUST 进入闭集。

#### Scenario: 老包仍可被认领
- **WHEN** 用户机上装着改名前的 `wechat-rewrite@815e4a5c25ee`
- **THEN** `known-hashes.json` 的 `skills["wechat-rewrite"]` 仍包含 `815e4a5c25ee`，对账器判其为"我们发的历史版"

### Requirement: 内部引用零悬空
任何在架 skill 的 SKILL.md、references、脚本、路由表（`wechat-routing.json`）、`docs/`、工具与测试中 MUST NOT 出现指向已下架 slug 的路径或 skill 指针。

#### Scenario: 路由表指针
- **WHEN** `validate_routing_skill_pointers` 扫描路由表
- **THEN** 所有 `primary_skill` / `candidate_skills` 都是在架 slug

#### Scenario: 全仓 grep
- **WHEN** 在仓库内（排除 `.git`、`known-hashes.json`、`openspec/`、`docs/superpowers/` 历史设计稿）grep 七个老 slug
- **THEN** 零命中

### Requirement: description 预算
合并后每个包的 `description` MUST ≤ 1024 字符（Python `len`，汉字计 1），全仓 description 合计 MUST ≤ 8000 字符。

#### Scenario: 合并包不超限
- **WHEN** `dby-publish` 吸收两包触发词后
- **THEN** `validate_description_budget` 通过

### Requirement: 运行时版本戳随 slug 更新
每个在架包的 `.version` MUST 为 `doubaoya-skill/<新 slug>@<hash>`，脚本上报的 User-Agent 随之变化；旧 slug 不再出现在任何 `.version` 中。

#### Scenario: 盖戳后一致
- **WHEN** 运行 `tools/stamp_versions.py`
- **THEN** `skills/dby-rewrite/.version` 形如 `doubaoya-skill/dby-rewrite@…`，且 `versions.json` 与之一致
