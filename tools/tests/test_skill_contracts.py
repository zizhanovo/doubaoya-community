"""SKILL.md 关键约束句契约测试（dby-cli-rebuild tasks 4.4 / spec skill-thin-layer「SKILL.md 关键句契约测试」）。

## 守什么

清单 tools/skill_contracts.json 逐条列出「某包的 SKILL.md（或它的必读 references）必须还写着这句」。
重写 SKILL.md、瘦身、搬段落进 references 时，这些句子最容易在「看起来只是措辞调整」里丢掉——
而它们恰恰是红线：不经要求不发布 / 不生图、去 AI 味只作提示、无素材不编亲历、超时不重试计费命令、
调用约定先查 Node 并用确切版本兜底。

## 诚实边界

**能**：断言句子还在指定文件里（逐字或正则）。
**不能**：断言 agent 遵守了它。这道闸绿了只说明「规则还写着」。

清单读空、条目指向不存在的包或文件，一律判失败——空清单的「零差异」不许当通过。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "tools" / "skill_contracts.json"


def load_contracts(path: Path = CONTRACTS) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def expand_cases(data: dict) -> list[tuple[str, str, dict]]:
    """(条目 id, 包名, 条目)；`@cli` 展开成 cliSkills（用到 CLI、必须带调用约定段的包）。"""
    cases: list[tuple[str, str, dict]] = []
    for entry in data.get("entries", []):
        skills: list[str] = []
        for name in entry.get("skills", []):
            skills.extend(data.get("cliSkills", []) if name == "@cli" else [name])
        for skill in skills:
            cases.append((entry["id"], skill, entry))
    return cases


def find_violation(root: Path, skill: str, entry: dict) -> str | None:
    """条目在该包成立返回 None；否则返回人话原因（给测试与破坏验证共用）。"""
    skill_dir = root / "skills" / skill
    if not (skill_dir / "SKILL.md").is_file():
        return f"条目 {entry['id']} 指向的包 skills/{skill} 不存在"
    texts = []
    for rel in entry.get("files", []):
        target = skill_dir / rel
        if not target.is_file():
            return f"条目 {entry['id']} 指向的文件 skills/{skill}/{rel} 不存在"
        texts.append(target.read_text(encoding="utf-8"))
    if not texts:
        return f"条目 {entry['id']} 没有列出要找的文件"
    if "text" in entry:
        found = any(entry["text"] in text for text in texts)
        want = f"逐字「{entry['text']}」"
    else:
        found = any(re.search(entry["regex"], text) for text in texts)
        want = f"正则 /{entry['regex']}/"
    if not found:
        return f"skills/{skill} 的 {entry.get('files')} 里找不到契约句 {entry['id']}：{want}（{entry.get('why', '')}）"
    return None


DATA = load_contracts()
CASES = expand_cases(DATA)


def test_清单不空且每条字段齐全() -> None:
    """🔴 元断言：清单空跑时下面的参数化用例会零迭代而全绿。"""
    entries = DATA.get("entries", [])
    assert len(entries) >= 9, f"契约清单只有 {len(entries)} 条——spec 列出的条目至少 9 条"
    assert len(DATA.get("cliSkills", [])) >= 8, "cliSkills 太少：用到 CLI 的包应当都在里面"
    ids = [entry.get("id") for entry in entries]
    assert len(ids) == len(set(ids)), f"条目 id 重复：{ids}"
    for entry in entries:
        assert entry.get("skills") and entry.get("files") and entry.get("why"), f"条目缺字段：{entry}"
        assert ("text" in entry) != ("regex" in entry), f"条目 {entry['id']} 必须恰好有 text 或 regex 之一"
    assert len(CASES) >= 30, f"展开后只有 {len(CASES)} 个用例——@cli 展开多半坏了"


def test_cliSkills_与调用约定闸认出的包一致() -> None:
    """清单里的 @cli 名单不许自己漂：必须等于 validate_community 按「用到 CLI」认出的那一组。"""
    import importlib.util

    spec = importlib.util.spec_from_file_location("validator_for_contracts", ROOT / "tools" / "validate_community.py")
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    using = {path.name for path in validator._skills_using_cli(ROOT, validator._dby_command_names(ROOT))}
    assert set(DATA["cliSkills"]) == using


@pytest.mark.parametrize("entry_id,skill,entry", CASES, ids=[f"{c[0]}@{c[1]}" for c in CASES])
def test_契约句仍在(entry_id: str, skill: str, entry: dict) -> None:
    violation = find_violation(ROOT, skill, entry)
    assert violation is None, violation


def test_删掉一句必红(tmp_path: Path) -> None:
    """变异：在副本里删掉 dby-write 的「无个人素材时不得编造亲历」，find_violation 必须点名。"""
    import shutil

    shutil.copytree(ROOT / "skills" / "dby-write", tmp_path / "skills" / "dby-write")
    skill_md = tmp_path / "skills" / "dby-write" / "SKILL.md"
    skill_md.write_text(skill_md.read_text(encoding="utf-8").replace("无个人素材时不得编造亲历", ""), encoding="utf-8")
    entry = next(e for e in DATA["entries"] if e["id"] == "write-no-fabricated-experience")
    violation = find_violation(tmp_path, "dby-write", entry)
    assert violation and "write-no-fabricated-experience" in violation


def test_清单为空或文件不存在必红(tmp_path: Path) -> None:
    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({"entries": [], "cliSkills": []}), encoding="utf-8")
    assert expand_cases(load_contracts(empty)) == []
    bogus = {"id": "x", "skills": ["dby-write"], "files": ["references/不存在.md"], "text": "随便", "why": "测"}
    assert "不存在" in (find_violation(ROOT, "dby-write", bogus) or "")
