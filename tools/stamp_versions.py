#!/usr/bin/env python3
"""给每个 skill 目录盖版本戳。

算一份覆盖 skills/<name>/ 目录下**除 .version 自身外**全部文件（文件名+内容）的
sha256 哈希，取前 12 位十六进制，写成 "doubaoya-skill/<name>@<hash>"：
  - 写进 skills/<name>/.version（脚本运行时读它塞进 User-Agent header）
  - 汇总进仓库根 versions.json（doubaoyahub 的同步脚本读它，见该仓库
    apps/api/scripts/sync-skill-versions.mjs）

幂等：.version 自身被排除在哈希输入之外，所以重复运行、或 .version 已存在，
都不会把上一次盖的戳喂回这一次的哈希计算（不会自我引用）。

跑法（本仓库根目录）：python3 tools/stamp_versions.py
发布前（push 到 GitHub 前）必须手动跑一次，否则 .version 会滞后于真实改动。
ponytail: 暂无 CI 钩子自动跑；升级路径 = push 时的 CI 步骤自动跑 + 提交。

哈希一变，主仓那份从 versions.json 生成的表就当场过期了——本脚本因此在**有实际变动时**
（且只在那时）打一句提醒，见 drift_reminder。这里只提醒不打红：盖版本戳的脚本不该把人卡住。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

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


def stamp_all(skills_dir: Path, versions_file: Path) -> dict[str, str]:
    skill_dirs = sorted(
        (p for p in skills_dir.iterdir() if p.is_dir() and (p / "SKILL.md").is_file()),
        key=lambda p: p.name,
    )
    versions: dict[str, str] = {}
    for skill_dir in skill_dirs:
        name = skill_dir.name
        value = f"doubaoya-skill/{name}@{compute_skill_hash(skill_dir)}"
        (skill_dir / ".version").write_text(value + "\n", encoding="utf-8")
        versions[name] = value

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "skills": versions,
    }
    versions_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return versions


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
    previous = read_manifest_skills(versions_file)
    versions = stamp_all(ROOT / "skills", versions_file)
    print(f"stamped {len(versions)} skills -> versions.json")
    reminder = drift_reminder(previous, versions, locate_generated_table())
    if reminder:
        print(reminder)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
