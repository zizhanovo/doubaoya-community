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
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


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


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    versions = stamp_all(root / "skills", root / "versions.json")
    print(f"stamped {len(versions)} skills -> versions.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
