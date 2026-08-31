"""check_baseline.py 的行为钉子（tasks 5.2）：CI 离线半段——
只查文件、不调模型；缺记录的包被点名并中止发版。

🔴 断言里顺带钉死「纯离线」：整个模块不 import subprocess / urllib，
   跑起来也没有任何子进程或网络调用可发起——CI 假阳性会毁掉整道闸。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location("cbl", _TOOLS / "check_baseline.py")
cbl = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cbl)


def _mk_repo(tmp_path, monkeypatch, skills, index_skills, baseline_entries):
    """tmp 下造最小仓：skills/ 目录、index.json、evals/baseline.json。"""
    skills_dir = tmp_path / "skills"
    for slug in skills:
        d = skills_dir / slug
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(f"---\nname: {slug}\n---\n{slug} 的正文", encoding="utf-8")
    (tmp_path / "index.json").write_text(
        json.dumps({"skills": index_skills}, ensure_ascii=False), encoding="utf-8")
    if baseline_entries is not None:
        (tmp_path / "evals").mkdir()
        (tmp_path / "evals" / "baseline.json").write_text(
            json.dumps({"schema": 1, "entries": baseline_entries}, ensure_ascii=False),
            encoding="utf-8")
    monkeypatch.setattr(cbl, "SKILLS", skills_dir)
    monkeypatch.setattr(cbl, "INDEX_PATH", tmp_path / "index.json")
    monkeypatch.setattr(cbl, "BASELINE_PATH", tmp_path / "evals" / "baseline.json")
    return skills_dir


def _idx(ref="release-1"):
    return {"status": "active", "versions": [{"ref": ref, "hash": "ignored"}]}


def _bent(slug, h):
    return {"skill": slug, "kind": "triggers", "hash": h,
            "runner": "claude", "model": "sonnet", "rounds": 3,
            "date": "2026-08-31", "results": {}}


# ---------------------------------------------------------------- 有记录 / 缺记录

def test_全部有记录_通过(tmp_path, monkeypatch, capsys):
    skills_dir = _mk_repo(tmp_path, monkeypatch, ["p1"], {"p1": _idx()}, [])
    h = cbl.compute_skill_hash(skills_dir / "p1")
    (tmp_path / "evals" / "baseline.json").write_text(
        json.dumps({"schema": 1, "entries": [_bent("p1", h)]}), encoding="utf-8")
    assert cbl.main(["release-1"]) == 0
    assert "离线校验通过" in capsys.readouterr().out


def test_缺记录的包_中止并指明是哪个(tmp_path, monkeypatch, capsys):
    skills_dir = _mk_repo(tmp_path, monkeypatch, ["p-ok", "p-miss"],
                          {"p-ok": _idx(), "p-miss": _idx()}, [])
    h = cbl.compute_skill_hash(skills_dir / "p-ok")
    (tmp_path / "evals" / "baseline.json").write_text(
        json.dumps({"schema": 1, "entries": [_bent("p-ok", h)]}), encoding="utf-8")
    assert cbl.main(["release-1"]) == 1
    err = capsys.readouterr().err
    assert "p-miss" in err and "无记录" in err and "中止发版" in err
    assert "p-ok" not in err  # 有记录的不背锅


def test_基线记的是旧内容_同样拦住(tmp_path, monkeypatch, capsys):
    # 包内容改了但基线没重跑：哈希对不上 ⇒ 质量门没对**这一版**产生过结论
    _mk_repo(tmp_path, monkeypatch, ["p1"], {"p1": _idx()},
             [_bent("p1", "000000000000")])
    assert cbl.main(["release-1"]) == 1
    assert "p1" in capsys.readouterr().err


def test_基线文件不存在_中止(tmp_path, monkeypatch, capsys):
    _mk_repo(tmp_path, monkeypatch, ["p1"], {"p1": _idx()}, None)
    assert cbl.main(["release-1"]) == 1
    assert "baseline.json 不存在" in capsys.readouterr().err


# ---------------------------------------------------------------- 圈定与兜底

def test_只查本次tag涉及的包(tmp_path, monkeypatch, capsys):
    # p-old 是上个 tag 发的，这次没动它——它缺记录不拦这次发版
    _mk_repo(tmp_path, monkeypatch, ["p-new", "p-old"],
             {"p-new": _idx("release-2"), "p-old": _idx("release-1")}, [])
    skills_dir = tmp_path / "skills"
    h = cbl.compute_skill_hash(skills_dir / "p-new")
    (tmp_path / "evals" / "baseline.json").write_text(
        json.dumps({"schema": 1, "entries": [_bent("p-new", h)]}), encoding="utf-8")
    assert cbl.main(["release-2"]) == 0


def test_老tag没有盖过戳的包_跳过不拦(tmp_path, monkeypatch, capsys):
    _mk_repo(tmp_path, monkeypatch, ["p1"], {"p1": _idx("release-1")}, None)
    assert cbl.main(["release-0000"]) == 0  # 早于索引/基线机制的 tag
    assert "跳过" in capsys.readouterr().out


def test_retired包不参与圈定(tmp_path, monkeypatch):
    _mk_repo(tmp_path, monkeypatch, ["p1"],
             {"p1": _idx(), "p-dead": {"status": "retired", "versions": [{"ref": "release-1"}]}},
             None)
    assert cbl.involved_skills("release-1") == ["p1"]


# ---------------------------------------------------------------- 纯离线钉子

def test_模块纯离线_不含子进程与网络调用():
    src = (_TOOLS / "check_baseline.py").read_text(encoding="utf-8")
    for banned in ("subprocess", "urllib", "requests", "socket", "http.client", "os.system"):
        assert banned not in src, f"CI 离线校验里不许出现 {banned}——不调模型、不联网是 D3 的核心"
