"""index.json 与四个兼容视图。

🔴 过渡期内 versions.json / known-hashes.json / renames.json / tools/clawhub.json 是**生成物**，
装在用户机器上的老对账器还在按 raw URL 读它们——形状一个字段都不许变，内容必须与索引一致。
这里锁三件事：① 生成物与磁盘上的文件逐字段相同；② 生成物的形状仍是老形状；
③ 索引自身的不变量（versions[].hash ⊆ knownHashes、active 条目的 versions[0].hash == .version）。
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import skill_index  # noqa: E402

INDEX = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
HASH = re.compile(r"^[0-9a-f]{12}$")


def _dirty_skills() -> set[str]:
    """工作树里内容有未提交改动的包（.version 自身不算）——它们的当前哈希还没进 git 历史。"""
    out = subprocess.run(
        ["git", "status", "--porcelain", "--", "skills/"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    dirty = set()
    for line in out.splitlines():
        parts = line[3:].strip().strip('"').split("/")
        if len(parts) >= 2 and parts[0] == "skills" and parts[-1] != ".version":
            dirty.add(parts[1])
    return dirty


def test_self_check() -> None:
    skill_index.self_check()


def test_元断言_索引不是空的() -> None:
    active = skill_index.active_entries(INDEX)
    assert len(active) >= 8, f"只有 {len(active)} 个 active 条目，扫描面八成退化了"
    assert len(INDEX["skills"]) >= 50


@pytest.mark.parametrize("relative", skill_index.VIEW_PATHS)
def test_视图与磁盘文件逐字段一致(relative: str) -> None:
    expected = skill_index.derive_views(INDEX)[relative]
    actual = json.loads((ROOT / relative).read_text(encoding="utf-8"))
    assert actual == expected, (
        f"{relative} 与 index.json 漂了：{skill_index.view_drift(INDEX, ROOT).get(relative)}。"
        "旧文件是生成物，改 index.json 再跑 tools/stamp_versions.py && tools/build_known_hashes.py"
    )


def test_视图形状仍是老形状() -> None:
    """老对账器读的键名与值类型一个都不能变（reconcile.mjs 做的是 knownHashes[name].includes(hash)）。"""
    views = skill_index.derive_views(INDEX)
    versions = views["versions.json"]
    assert set(versions) == {"generatedAt", "ref", "skills"}
    assert all(re.fullmatch(rf"doubaoya-skill/{re.escape(s)}@[0-9a-f]{{12}}", v) for s, v in versions["skills"].items())
    known = views["known-hashes.json"]
    assert set(known) == {"generatedAt", "skills", "retiredEndpoints", "retiredTriggerWords", "versionLog"}
    assert all(isinstance(h, str) and HASH.match(h) for arr in known["skills"].values() for h in arr)
    assert all(set(e) == {"hash", "version", "date", "subject"} for log in known["versionLog"].values() for e in log)
    renames = views["renames.json"]
    assert set(renames) == {"schema_version", "_readme", "renames"} and renames["schema_version"] == 1
    assert all(set(e) == {"to", "userFiles"} for e in renames["renames"].values())
    clawhub = views["tools/clawhub.json"]
    assert set(clawhub) == {"schema_version", "_readme", "owner", "skills"} and clawhub["schema_version"] == 1
    assert all(set(e) == {"displayName", "topics"} for e in clawhub["skills"].values())
    assert set(clawhub["skills"]) == set(versions["skills"]), "两个视图的 active 集合必须相同"


def test_versions_里的哈希都在_knownHashes_里() -> None:
    dirty = _dirty_skills()
    checked, drift = 0, []
    for slug, entry in INDEX["skills"].items():
        if slug in dirty:
            continue
        for v in entry["versions"]:
            checked += 1
            if v["hash"] not in entry["knownHashes"]:
                drift.append(f"{slug}:{v['hash']}")
    assert checked >= 5, f"只检查了 {checked} 条盖过戳的版本（{len(dirty)} 个包在途）——判别力不够，先提交在途改动"
    assert not drift, "盖过戳的版本不在历史闭集里（内容没 git add 就跑了生成器？）：" + ", ".join(drift[:5])


def test_active_条目的当前版等于_version_文件() -> None:
    for slug, entry in skill_index.active_entries(INDEX).items():
        stamp = (ROOT / "skills" / slug / ".version").read_text(encoding="utf-8").strip()
        assert entry["versions"], f"{slug} 是 active 却没有任何盖过戳的版本"
        assert stamp == f"doubaoya-skill/{slug}@{entry['versions'][0]['hash']}", slug
        head = entry["versions"][0]
        assert set(head) == set(skill_index.VERSION_KEYS), sorted(head)
        assert head["changelogSource"] in skill_index.CHANGELOG_SOURCES
        assert head["changelog"].strip(), f"{slug} 的当前版 changelog 是空的"


def test_改名条目指向在架的_active() -> None:
    for slug, entry in INDEX["skills"].items():
        if entry["status"] in skill_index.REDIRECT_STATUSES:
            target = INDEX["skills"].get(entry["redirectTo"])
            assert target and target["status"] == "active", f"{slug} 的 redirectTo 没指向在架包"


def test_bootstrap_从旧文件迁出的索引能原样生成回四个旧文件(tmp_path: Path) -> None:
    """回滚路径：删掉 index.json、由旧文件重建，生成的视图必须与旧文件逐字段相同（generatedAt 除外）。"""
    for relative in skill_index.VIEW_PATHS:
        dest = tmp_path / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text((ROOT / relative).read_text(encoding="utf-8"), encoding="utf-8")
    for slug in skill_index.active_entries(INDEX):
        skill = tmp_path / "skills" / slug
        skill.mkdir(parents=True)
        skill.joinpath("SKILL.md").write_text((ROOT / "skills" / slug / "SKILL.md").read_text(encoding="utf-8"), encoding="utf-8")
    rebuilt = skill_index.bootstrap_from_legacy(tmp_path)
    views = skill_index.derive_views(rebuilt)
    for relative in skill_index.VIEW_PATHS:
        actual = json.loads((tmp_path / relative).read_text(encoding="utf-8"))
        actual.pop("generatedAt", None)
        expected = views[relative]
        expected.pop("generatedAt", None)
        assert actual == expected, relative
