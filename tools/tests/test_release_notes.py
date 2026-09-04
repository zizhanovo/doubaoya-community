"""release_notes 的行为钉子：build_notes 的产出 + main() 的退出码契约。"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

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


# ---------------------------------------------------------------- 退出码契约
#
# 🔴 .github/workflows/release.yml **只吞 3**，其余非零一律让这步红。这几条钉的就是
#    「哪些情况算 3」——判错的代价是单向的：真失败被判成 3 ⇒ 绿灯 + 没有 Release，
#    没有任何人会去看。所以这里跑真脚本、真 git 仓库，不 mock。

_RN = Path(__file__).resolve().parents[1] / "release_notes.py"


def _run(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(_RN), *args], cwd=cwd,
                          capture_output=True, text=True)


def _commit(repo: Path, name: str, text: str, tag: str) -> None:
    (repo / name).write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", name], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", tag], cwd=repo, check=True)
    subprocess.run(["git", "tag", tag], cwd=repo, check=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """三个 tag：老的没有 index.json，中间那个有且合法，最后那个 index.json 是坏 JSON。"""
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)
    _commit(tmp_path, "README.md", "x", "release-20200101-0000")
    idx = {"productVersion": "1.0.0",
           "skills": {"a": {"status": "active", "displayName": "甲",
                            "versions": [{"version": "1.0.0", "hash": "h0", "changelog": "零"}]}}}
    _commit(tmp_path, "index.json", json.dumps(idx, ensure_ascii=False), "release-20200102-0000")
    _commit(tmp_path, "index.json", "{ 这不是 JSON", "release-20200103-0000")
    return tmp_path


def test_退出码_正常生成为0(repo):
    res = _run(repo, "release-20200102-0000")
    assert res.returncode == 0
    assert res.stdout.startswith("v1.0.0：")


def test_退出码_tag上没有index_json才是可跳过的3(repo):
    assert _run(repo, "release-20200101-0000").returncode == 3


def test_退出码_tag不存在是真失败不是跳过(repo):
    """打错 tag 名曾经也返回 3 —— 工作流会把它当成「这 tag 太老」静默跳过。"""
    res = _run(repo, "release-20200104-9999")
    assert res.returncode != 3 and res.returncode != 0
    assert "不是有效的 git ref" in res.stderr


def test_退出码_index_json坏掉是真失败不是跳过(repo):
    """曾经 except JSONDecodeError: return None，与「文件不存在」同路 ⇒ 一样被判 3。"""
    res = _run(repo, "release-20200103-0000")
    assert res.returncode != 3 and res.returncode != 0


def test_退出码_用法错为2(repo):
    assert _run(repo).returncode == 2
