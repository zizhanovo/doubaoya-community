"""release_notes.build_notes 的行为钉子。"""
from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("rn", Path(__file__).resolve().parents[1] / "release_notes.py")
rn = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(rn)


def _idx(**skills):
    return {"skills": skills}


def test_单个变更_标题带中文名与changelog():
    prev = _idx(a={"status": "active", "displayName": "甲", "versions": [{"version": "1.0.0", "hash": "h0", "changelog": "零"}]})
    cur = _idx(a={"status": "active", "displayName": "甲", "versions": [
        {"version": "1.1.0", "hash": "h1", "changelog": "一", "changelogSource": "user"},
        {"version": "1.0.0", "hash": "h0", "changelog": "零"}]})
    title, body = rn.build_notes(cur, prev)
    assert title == "甲（a）1.1.0：一"
    assert "**甲（`a`）** 1.0.0 → 1.1.0" in body and "1.1.0：一" in body


def test_跨多版_中间各版都列_auto标注():
    prev = _idx(a={"status": "active", "versions": [{"version": "1.0.0", "hash": "h0"}]})
    cur = _idx(a={"status": "active", "versions": [
        {"version": "1.2.0", "hash": "h2", "changelog": "二", "changelogSource": "user"},
        {"version": "1.1.0", "hash": "h1", "changelog": "一", "changelogSource": "auto"},
        {"version": "1.0.0", "hash": "h0"}]})
    _, body = rn.build_notes(cur, prev)
    assert "1.2.0：二" in body and "1.1.0：一（占位文案）" in body


def test_下架与无变更():
    prev = _idx(a={"status": "active", "versions": [{"version": "1.0.0", "hash": "h0"}]}, b={"status": "active", "versions": []})
    cur = _idx(a={"status": "active", "versions": [{"version": "1.0.0", "hash": "h0"}]}, b={"status": "retired", "versions": []})
    title, body = rn.build_notes(cur, prev)
    assert "下架归档：`b`" in body
    assert title == "下架归档 1 个：b"


def test_首个tag():
    cur = _idx(a={"status": "active", "versions": [{"version": "1.0.0", "hash": "h0"}]})
    title, _ = rn.build_notes(cur, None)
    assert title == "首次盖戳发布：全集 1 个 skill"


def test_产品版本前缀走main路径():
    # build_notes 不加前缀（main 里加），这里钉 bump 规则
    import importlib.util as iu
    from pathlib import Path as P
    spec = iu.spec_from_file_location("si", P(__file__).resolve().parents[1] / "skill_index.py")
    si = iu.module_from_spec(spec); spec.loader.exec_module(si)
    assert si.bump_product_version(None, ["patch"]) == "1.0.0"
    assert si.bump_product_version("1.3.2", ["patch", "minor"]) == "1.3.3"
    assert si.bump_product_version("1.3.3", ["major", "patch"]) == "1.4.0"
