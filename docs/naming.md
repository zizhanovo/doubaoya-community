# 命名规则：`dby` / `dby-*`

> 给**维护者**看的，不随包分发。`unify-dby-naming` 改名车（2026-08-20）立下的准入约束，
> 新包进不来错前缀——`tools/validate_community.py` 的 `validate_skill_slug_prefix` 会当场打红。

## 规则

- `skills/` 下每个目录名，必须落在 `{dby} ∪ dby-*` 里：要么恰好是 `dby`，要么以 `dby-` 开头。
- 目录名必须与该包 `SKILL.md` frontmatter 的 `name` 字段逐字相同（`validate_skill_inventory` 已经守这条，
  本闸只加前缀这一半新约束）。
- `dby` 是仓库里**唯一**允许无连字符的主入口——它是任务后导航的单一事实源，其余包一律 `dby-<capability>`。
- 新增包起名前先问：这个能力能不能并进已有包？（见 `docs/deleting-a-skill.md` 关于合并 vs 新建壳的教训）
  确实要新建，再套上面的前缀形状。

## 为什么

**改名前的教训**：仓库曾同时存在三套命名风格——一套用平台品牌名当前缀（如今的 `dby-api` /
`dby-gateway`）、一套用「公众号」的英文缩写当前缀（如今的 `dby-theme` / `dby-rewrite` /
`dby-publish`，后两个当时还各自拆成两个包）、一套没有前缀（如今的 `dby-banned-words`），
外加两个已经是 `dby-` 前缀的包（`dby-charter` / `dby-update`）。用户在 agent 里 tab 补全找不到
"全家桶"，也分不清哪个是入口——这不是审美问题，是**可发现性**问题（具体的改名映射见
`renames.json` 与 `docs/deleting-a-skill.md`）。

- **对标 [dbskill](https://github.com) 的 `/dbs` + `/dbs-*`**：调研外部实践（见
  `docs/skill-design-references.md`）时找到的同类命名体系用统一前缀 + 斜杠命令做身份词，
  用户记住一个前缀就能猜中全部命令族。我们的差异点是**能真的取数、查违禁词、写进草稿箱**（执行），
  不是 API 目录，命名应该围绕这一点收敛，而不是围绕各自的历史起源（`wechat` 前缀是"这个包最初
  只做公众号"的历史遗留，`doubaoya` 前缀是"平台名当包名"的另一套逻辑，两者都不该继续分裂命名空间）。
- **tab 补全**：终端里敲 `dby-` 一个 tab 就能看到全部同族能力，敲 `wechat-` 只能看到公众号相关的
  一半、敲 `doubaoya` 又只看到另一半——统一前缀让"全家桶"在一次补全里现形。
- **身份词抗截断**：`description` 有静默截断的硬上限（见 `docs/deleting-a-skill.md` 的 description
  预算一节）。身份词放在前缀位置，即使某天正文被截断，目录名本身仍然携带"这是都爆鸭家的包"这条
  身份信息——前缀是不会被截断的那一部分。
- **主入口唯一无连字符**：`dby` 保持无连字符，一是历史沿用（改名前就是这么叫的，用户已经习惯
  `dby` 这个最短形式指向导航入口），二是给"哪个是起点"一个视觉上的特殊记号——所有 `dby-*`
  都是从 `dby` 分岔出去的具体能力，`dby` 自己不是任何人的下位概念。这也是
  `tools/validate_community.py` 里"无连字符真 Skill"特例集合从 `{doubaoya, dby}` 收窄到 `{dby}`
  的原因：改名之后，无连字符只剩这一个合法例外，其余都必须至少带一个连字符。

## 两向验证（新增闸都要贴这个）

```bash
# 合法输入：当前 9 个包全部通过
python3 tools/validate_community.py    # exit 0

# 故意造坏：临时建一个不符合前缀的目录，应当打红
mkdir -p skills/wechat-x && cat > skills/wechat-x/SKILL.md <<'EOF'
---
name: wechat-x
description: 故意造坏的临时目录，用来验证 validate_skill_slug_prefix 会打红。
---
EOF
python3 tools/validate_community.py    # 期望非 0 退出，报"这些目录名不符合命名约定"
rm -rf skills/wechat-x                 # 删掉后应重新变绿
python3 tools/validate_community.py    # exit 0
```
