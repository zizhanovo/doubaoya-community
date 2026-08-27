#!/usr/bin/env python3
"""给每个 skill 目录盖版本戳，并把语义版本与内容哈希绑进仓库根 index.json。

算一份覆盖 skills/<name>/ 目录下**除 .version 自身与点开头路径外**全部文件（文件名+内容）的
sha256 哈希，取前 12 位十六进制，写成 "doubaoya-skill/<name>@<hash>"：
  - 写进 skills/<name>/.version（脚本运行时读它塞进 User-Agent header）
  - 写进 index.json 该 slug 的 versions[0]（version 来自 frontmatter、ref、releasedAt、changelog）
  - 再从索引生成 versions.json 等四个过渡期兼容视图（见 tools/skill_index.py）

哈希变了才在 versions 头部插新条目；没变就只更新顶层 generatedAt。frontmatter 有 `changelog:`
就原文记下（changelogSource: user），没有就按 semver 档位生成占位文案（auto）并打一句警告——
只警告不阻断，盖戳的脚本不该把人卡住。

幂等：.version 自身被排除在哈希输入之外，所以重复运行、或 .version 已存在，
都不会把上一次盖的戳喂回这一次的哈希计算（不会自我引用）。

同时写顶层 `ref`（`release-YYYYMMDD-HHMM`）：dby-update 对账器拿它把安装源固定到
`zizhanovo/doubaoya-community#<ref>`。它只是声明——发布者提交后必须真的 `git tag <ref> && git push origin <ref>`，
脚本会在 ref 变化时打这句提醒。哈希一个没变就沿用上一次的 ref（别凭空造一个没人打过的 tag 名）。

跑法（本仓库根目录）：python3 tools/stamp_versions.py
发布前（push 到 GitHub 前）必须手动跑一次，否则 .version 会滞后于真实改动。
ponytail: 暂无 CI 钩子自动跑；升级路径 = push 时的 CI 步骤自动跑 + 提交。

哈希一变，主仓那份从 versions.json 生成的表就当场过期了——本脚本因此在**有实际变动时**
（且只在那时）打一句提醒，见 drift_reminder。这里只提醒不打红：盖版本戳的脚本不该把人卡住。
"""
from __future__ import annotations

import hashlib
import subprocess
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
import skill_index  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]

# 主仓那份生成表的位置。沿用 validate_community.py 的惯例：环境变量指向 catalog 的
# index.ts，生成表是它的同目录兄弟；没有环境变量就按兄弟目录找主仓。找不到 = 主仓不在场，
# 只给通用提醒（社区仓要能在没有主仓的机器上正常跑）。
CATALOG_ENV = "DOUBAOYA_CATALOG"
CATALOG_SIBLING = PurePosixPath("doubaoyahub/packages/catalog/src/index.ts")
GENERATED_TABLE_NAME = "skill-versions.generated.ts"
SYNC_COMMAND = "node apps/api/scripts/sync-skill-versions.mjs"
GENERATED_ENTRY = re.compile(r'"([^"]+)"\s*:\s*"(doubaoya-skill/[^"]+)"')
_MAX_LISTED = 5


def _list_files(skill_dir: Path) -> list[Path]:
    files = [
        path
        for path in skill_dir.rglob("*")
        if path.is_file()
        and path.name != ".version"
        and "__pycache__" not in path.relative_to(skill_dir).parts
        and not any(
            part.startswith(".") and part != ".version"
            for part in path.relative_to(skill_dir).parts
        )
    ]
    return sorted(files, key=lambda p: p.relative_to(skill_dir).as_posix())


def compute_skill_hash(skill_dir: Path) -> str:
    digest = hashlib.sha256()
    for path in _list_files(skill_dir):
        digest.update(path.relative_to(skill_dir).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()[:12]


REF_PATTERN = skill_index.REF_PATTERN


def make_ref(now: datetime) -> str:
    """安装源固定用的 release tag 名：对账器拿它拼 `owner/repo#<ref>` 去 `skills add`。
    skills CLI 底层是 `git clone --branch`，只认 branch/tag，所以固定单位是 tag，不是 commit。"""
    return now.strftime("release-%Y%m%d-%H%M")


def _warn_stderr(message: str) -> None:
    print(message, file=sys.stderr)


def _tag_exists(ref: str, root: Path) -> bool:
    """本地 git 里有没有这个 tag。不是 git 仓库 / git 不可用 ⇒ 答不了，当作已发过（沿用老行为：插新条目）。
    只有「确实在 git 仓库里、且 tag 确实不在」才判未发布——这是能实证的唯一情形。"""
    try:
        res = subprocess.run(
            ["git", "tag", "-l", ref], cwd=root, capture_output=True, text=True, check=False, timeout=10
        )
    except (OSError, subprocess.SubprocessError):
        return True
    if res.returncode != 0:
        return True
    return ref in res.stdout.split()


def stamp_all(
    skills_dir: Path,
    index_file: Path,
    *,
    now: datetime | None = None,
    warn=_warn_stderr,
) -> dict[str, str]:
    """盖戳全部包，写 .version + index.json + 四个兼容视图（视图落在 index_file 的同级目录）。

    返回 {slug: "doubaoya-skill/<slug>@<hash>"}。警告（auto changelog、骨架条目等）走 warn 回调，
    默认打到 stderr——pre-commit 把 stdout 丢掉了，stderr 才看得见。
    """
    root = index_file.parent
    skill_dirs = sorted(
        (p for p in skills_dir.iterdir() if p.is_dir() and (p / "SKILL.md").is_file()),
        key=lambda p: p.name,
    )
    index = skill_index.load_or_bootstrap(index_file)
    now = now or datetime.now(timezone.utc)

    hashes: dict[str, str] = {}
    versions: dict[str, str] = {}
    for skill_dir in skill_dirs:
        name = skill_dir.name
        hashes[name] = compute_skill_hash(skill_dir)
        versions[name] = f"doubaoya-skill/{name}@{hashes[name]}"
        (skill_dir / ".version").write_text(versions[name] + "\n", encoding="utf-8")

    skills = index["skills"]
    previous = {
        slug: entry["versions"][0]["hash"]
        for slug, entry in skills.items()
        if entry.get("status") == "active" and entry.get("versions")
    }
    changed = sorted(slug for slug, h in hashes.items() if previous.get(slug) != h)
    # 幂等：哈希一个没变就沿用上一次的 ref——否则每重跑一次就换一个 tag 名，而那个 tag 谁也没打过。
    previous_ref = index.get("ref") if REF_PATTERN.match(index.get("ref") or "") else None
    # 🔴 同一批还没打 tag 的改动反复盖戳（提交前手跑一次、钩子再跑一次）不能堆出两个版本条目：
    #    上一个 ref 的 tag 还不存在 ⇒ 那一版从没发出去过 ⇒ 沿用它的 ref，并在下面**替换**而不是插入。
    #    否则 versions[] 里留下一条谁也装不到的幽灵哈希，闭集校验当场报红（2026-08-26 实证）。
    unreleased_ref = previous_ref if (previous_ref and not _tag_exists(previous_ref, root)) else None
    ref = previous_ref if (not changed and previous_ref) else (unreleased_ref or make_ref(now))

    batch_levels = []
    for slug in changed:
        entry = skills.get(slug)
        if entry is None:
            entry = skills[slug] = skill_index.new_entry(slug)
            warn(f"⚠️  index.json 新增了 {slug} 的骨架条目：displayName 暂等于 slug，请手填 displayName / topics。")
        elif entry.get("status") != "active":
            # 目录在、索引却说它不在架：状态是人手写的事实，这里不替人改，交给 validate_community 报红。
            warn(f"⚠️  skills/{slug}/ 在架，但 index.json 里 status = {entry.get('status')!r}——请改回 active 或删目录。")
        fm = skill_index.read_frontmatter(skills_dir / slug / "SKILL.md")
        head = entry["versions"][0] if entry.get("versions") else None
        replacing = bool(unreleased_ref and head and head.get("ref") == unreleased_ref)  # 同一批未发布的戳 ⇒ 覆盖头条
        prior = (entry["versions"][1] if len(entry.get("versions", [])) > 1 else None) if replacing else head
        prior_version = prior["version"] if prior else None
        batch_levels.append(skill_index.bump_level(fm["version"], prior_version))
        if fm["changelog"]:
            changelog, source = fm["changelog"], "user"
            if prior and prior.get("changelog") == changelog and prior.get("changelogSource") == "user":
                warn(f"⚠️  {slug} 的哈希变了，但 frontmatter changelog 与上一版一字未改——用户会看到一句过期的变更说明。")
        else:
            changelog, source = skill_index.auto_changelog(fm["version"], prior_version), "auto"
            warn(
                f"⚠️  {slug} 的 frontmatter 没写 changelog:，已按 semver 档位生成占位文案"
                f"（{skill_index.bump_level(fm['version'], prior_version)}）。请在 SKILL.md 里补一句。"
            )
        record = {
            "version": fm["version"],
            "hash": hashes[slug],
            "ref": ref,
            "releasedAt": now.isoformat(),
            "changelog": changelog,
            "changelogSource": source,
        }
        if replacing:
            entry["versions"][0] = record
        else:
            entry.setdefault("versions", []).insert(0, record)

    for slug, entry in skills.items():
        if entry.get("status") == "active" and slug not in hashes:
            warn(f"⚠️  index.json 里 {slug} 是 active，但 skills/{slug}/ 不存在——下架请把 status 改成 retired/renamed/merged。")

    index["generatedAt"] = now.isoformat()
    index["ref"] = ref
    if changed:
        index["productVersion"] = skill_index.bump_product_version(index.get("productVersion"), batch_levels)
    skill_index.save_index(index, index_file)
    skill_index.write_views(index, root)
    return versions


def read_manifest_ref(versions_file: Path) -> str | None:
    """读 versions.json 顶层的 ref；文件不在、读不动、格式不对都当没有。"""
    try:
        parsed = json.loads(versions_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    ref = parsed.get("ref")
    return ref if isinstance(ref, str) and REF_PATTERN.match(ref) else None


def tag_reminder(ref: str) -> str:
    """ref 写进版本表只是声明，tag 得发布者真打出来，否则对账器 `skills add repo#<ref>` 会 clone 失败。"""
    return (
        f"🏷  安装源固定到 ref = {ref}。提交这次改动之后**必须**打 tag 并推上去，否则用户端 skills add 会找不到它：\n"
        f"    git tag {ref} && git push origin {ref}"
    )


def read_manifest_skills(versions_file: Path) -> dict[str, str]:
    """读 versions.json 里那份 skills 映射；文件不在或读不动都当空（首次盖戳）。"""
    try:
        parsed = json.loads(versions_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    skills = parsed.get("skills")
    return skills if isinstance(skills, dict) else {}


def locate_generated_table(root: Path = ROOT) -> Path | None:
    override = os.environ.get(CATALOG_ENV)
    candidate = (
        Path(override).parent / GENERATED_TABLE_NAME
        if override
        else root.parent / CATALOG_SIBLING.parent / GENERATED_TABLE_NAME
    )
    return candidate if candidate.is_file() else None


def _describe(names: list[str]) -> str:
    listed = "、".join(names[:_MAX_LISTED])
    rest = len(names) - _MAX_LISTED
    return f"{listed}（另有 {rest} 个未列出）" if rest > 0 else listed


def _read_generated_table(table: Path) -> dict[str, str] | None:
    """从主仓生成表里抠出 name -> version。读不动就返回 None（退回通用提醒，绝不崩）。"""
    try:
        return dict(GENERATED_ENTRY.findall(table.read_text(encoding="utf-8")))
    except OSError:
        return None


def drift_reminder(
    previous: dict[str, str],
    versions: dict[str, str],
    table: Path | None,
) -> str | None:
    """有 skill 哈希变动时，说清后果 + 给出同步命令。没变动就返回 None（别成为人人无视的噪音）。"""
    removed = set(previous) - set(versions)
    touched = {name for name, value in versions.items() if previous.get(name) != value}
    changed = sorted(removed | touched)
    if not changed:
        return None

    lines = [
        "",
        f"⚠️  {len(changed)} 个 skill 的哈希变了：{_describe(changed)}",
    ]
    published = _read_generated_table(table) if table is not None else None
    if published is not None:
        stale = [name for name, value in versions.items() if published.get(name) != value]
        if not stale:
            lines.append(f"    主仓的 {GENERATED_TABLE_NAME} 已经和这次结果一致，无需再同步。")
            return "\n".join(lines)
        lines.append(f"    已确认主仓的 {GENERATED_TABLE_NAME} 过期：{len(stale)} 条对不上。")
    lines += [
        f"    主仓的 {GENERATED_TABLE_NAME} 是「你的 skill 有更新」提示的唯一依据，"
        "不同步就等于已装旧版的用户永远收不到更新提醒。",
        f"    请到主仓 doubaoyahub 跑：{SYNC_COMMAND}",
        "    然后把生成的表一起提交。",
    ]
    return "\n".join(lines)


def main() -> int:
    versions_file = ROOT / "versions.json"
    index_file = ROOT / skill_index.INDEX_NAME
    previous = read_manifest_skills(versions_file)
    previous_ref = read_manifest_ref(versions_file)
    versions = stamp_all(ROOT / "skills", index_file)
    print(f"stamped {len(versions)} skills -> index.json（兼容视图：{'、'.join(skill_index.VIEW_PATHS)}）")
    reminder = drift_reminder(previous, versions, locate_generated_table())
    if reminder:
        print(reminder)
    ref = read_manifest_ref(versions_file)
    if ref and ref != previous_ref:
        print(tag_reminder(ref))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
