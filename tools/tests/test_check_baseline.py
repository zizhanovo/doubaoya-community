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


# ---------------------------------------------------------------- 基线洞（unusable ⇒ 无结论）

def test_基线条目含unusable洞_视为无结论并拦住(tmp_path, monkeypatch, capsys):
    # 实测缺陷复现（2026-08-31）：首版 --establish 8 并发撞限流，dby-charter 的
    # 18 条话术 14 条 unusable 进了基线（单独重跑 18/18 稳定——洞是限流产物）；
    # 而旧实现全文不含 unusable 字样，只查「(skill, hash) 有没有记录」——有洞照样
    # 放行，且比对只认「基线 pass、本次 fail」，这些话术从此不受监控。现在必须拦。
    skills_dir = _mk_repo(tmp_path, monkeypatch, ["p1"], {"p1": _idx()}, [])
    h = cbl.compute_skill_hash(skills_dir / "p1")
    ent = _bent("p1", h)
    ent["results"] = {"话术A": "pass", "话术B": "unusable"}
    (tmp_path / "evals" / "baseline.json").write_text(
        json.dumps({"schema": 1, "entries": [ent]}, ensure_ascii=False), encoding="utf-8")
    assert cbl.main(["release-1"]) == 1
    err = capsys.readouterr().err
    assert "p1" in err and "unusable" in err and "话术B" in err and "中止发版" in err
    assert "话术A" not in err  # 量到了的用例不背锅，点名的是洞


def test_同哈希另一条目干净_有洞的那条仍拦住(tmp_path, monkeypatch, capsys):
    # 「部分覆盖」不算覆盖：triggers 条目干净、cases 条目有洞 ⇒ 该哈希仍无完整结论。
    # 只查「存在一条干净的」会把洞藏在兄弟条目背后——同一类「看着覆盖了其实没有」。
    skills_dir = _mk_repo(tmp_path, monkeypatch, ["p1"], {"p1": _idx()}, [])
    h = cbl.compute_skill_hash(skills_dir / "p1")
    clean = _bent("p1", h)
    holed = dict(_bent("p1", h), kind="cases", grader_runner="pi",
                 results={"c1": "unusable", "c2": "pass"})
    (tmp_path / "evals" / "baseline.json").write_text(
        json.dumps({"schema": 1, "entries": [clean, holed]}, ensure_ascii=False),
        encoding="utf-8")
    assert cbl.main(["release-1"]) == 1
    err = capsys.readouterr().err
    assert "cases:c1" in err and "中止发版" in err
