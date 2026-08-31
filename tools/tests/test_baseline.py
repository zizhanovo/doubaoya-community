"""baseline.py 的行为钉子：哈希复用与稳定性（4.1）、稳定序列化（4.2）、
比对与「基线不可比」（4.3）、接受退步必须附理由（4.4）、not_run 不覆盖历史（4.5）。

🔴 全程不碰模型、不碰子进程——基线是纯文件逻辑。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location("bl", _TOOLS / "baseline.py")
bl = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(bl)


def _entry(skill="p1", kind="triggers", h="aaaaaaaaaaaa", runner="claude", model="sonnet",
           grader_runner=None, grader_model=None, results=None, date="2026-08-30", rounds=3):
    e = {"skill": skill, "kind": kind, "hash": h, "runner": runner, "model": model,
         "rounds": rounds, "date": date, "results": results or {}}
    if kind == "cases":
        e["grader_runner"] = grader_runner or "pi"
        e["grader_model"] = grader_model or "sonnet"
    if kind == "none":
        for k in ("runner", "model"):
            e.pop(k)
    return e


# ---------------------------------------------------------------- 4.1 哈希：复用且稳定

def test_哈希函数就是盖戳那一个_不新造():
    import sys
    # baseline 是 from stamp_versions import 来的同一个函数对象，不是长得像的复制品
    assert bl.compute_skill_hash is sys.modules["stamp_versions"].compute_skill_hash

def test_哈希_内容不变则稳定_改一字节则变(tmp_path):
    d = tmp_path / "p1"
    d.mkdir()
    (d / "SKILL.md").write_text("---\nname: p1\n---\n正文", encoding="utf-8")
    (d / "evals").mkdir()
    (d / "evals" / "triggers.jsonl").write_text('{"q":"x","expect":true}\n', encoding="utf-8")
    h1 = bl.compute_skill_hash(d)
    h2 = bl.compute_skill_hash(d)
    assert h1 == h2  # 内容不变，重复计算稳定
    (d / "SKILL.md").write_text("---\nname: p1\n---\n正文!", encoding="utf-8")  # 改一个字节
    assert bl.compute_skill_hash(d) != h1


# ---------------------------------------------------------------- 4.2 稳定序列化

def test_序列化_同样结果两次写出字节一致(tmp_path):
    path = tmp_path / "evals" / "baseline.json"
    entries = [_entry("z-pkg"), _entry("a-pkg"), _entry("m-pkg", kind="cases")]
    data = {"schema": 1, "entries": list(entries)}
    assert bl.save(data, path) is True
    first = path.read_bytes()
    # 第二次：条目顺序打乱也必须写出同样的字节（diff 为空），且不真的碰文件
    assert bl.save({"schema": 1, "entries": list(reversed(entries))}, path) is False
    assert path.read_bytes() == first


def test_序列化_按包名排序():
    text = bl.dumps({"entries": [_entry("zz"), _entry("aa")]})
    assert text.index('"aa"') < text.index('"zz"')
    assert text.endswith("\n")


def test_load_坏文件宁炸不清史(tmp_path):
    path = tmp_path / "baseline.json"
    path.write_text("{烂掉的", encoding="utf-8")
    with pytest.raises(SystemExit):
        bl.load(path)  # 返回空基线会让下一次写入静默清掉全部历史


# ---------------------------------------------------------------- 4.3 比对

def test_比对_基线通过本次失败判退步():
    data = {"schema": 1, "entries": [_entry(results={"q1": "pass", "q2": "pass"})]}
    cmp = bl.compare(data, _entry(results={"q1": "pass", "q2": "fail"}))
    assert cmp["status"] == "ok"
    assert cmp["regressions"] == ["q2"] and cmp["improvements"] == []


def test_比对_flaky与unclear不构成退步():
    data = {"schema": 1, "entries": [_entry(results={"q1": "pass", "q2": "pass", "q3": "pass"})]}
    cmp = bl.compare(data, _entry(results={"q1": "flaky", "q2": "unclear", "q3": "not_run"}))
    assert cmp["regressions"] == []  # 退步只认「基线 pass、本次 fail」


def test_比对_本次新增通过计改进():
    data = {"schema": 1, "entries": [_entry(results={"q1": "fail"})]}
    cmp = bl.compare(data, _entry(results={"q1": "pass", "q2": "pass"}))
    assert cmp["regressions"] == [] and cmp["improvements"] == ["q1", "q2"]


@pytest.mark.parametrize("差异", [
    {"model": "opus"},                       # 模型不同
    {"runner": "codex"},                     # runner 不同
])
def test_比对_身份不一致报不可比而非退步(差异):
    old = _entry(results={"q1": "pass"})
    new = dict(_entry(results={"q1": "fail"}), **差异)  # 本次全挂，但尺子换了
    cmp = bl.compare({"schema": 1, "entries": [old]}, new)
    assert cmp["status"] == "incomparable"
    assert "regressions" not in cmp and "improvements" not in cmp  # 不输出退步或改进结论


def test_比对_cases的grader也进身份():
    old = _entry(kind="cases", results={"c1": "pass"})
    new = _entry(kind="cases", grader_runner="claude", results={"c1": "fail"})
    cmp = bl.compare({"schema": 1, "entries": [old]}, new)
    assert cmp["status"] == "incomparable"  # grader 换了也是换尺子


def test_比对_基线全空是new不是退步():
    assert bl.compare({"schema": 1, "entries": []}, _entry())["status"] == "new"


# ---------------------------------------------------------------- 4.4 接受退步必须附理由

@pytest.mark.parametrize("烂理由", [None, "", "   "])
def test_接受退步_不带理由被拒绝(烂理由):
    with pytest.raises(SystemExit):
        bl.accept(_entry(), ["q1"], 烂理由, "2026-08-31")


def test_接受退步_理由与条目一并写入且随diff可见(tmp_path):
    path = tmp_path / "baseline.json"
    e = _entry(results={"q1": "fail"})
    bl.accept(e, ["q1"], "上游 API 改版，下版修", "2026-08-31")
    bl.save({"schema": 1, "entries": [e]}, path)
    text = path.read_text(encoding="utf-8")
    assert "上游 API 改版，下版修" in text and '"q1"' in text  # 理由留痕，diff 可回溯


# ---------------------------------------------------------------- 4.5 not_run 不覆盖历史

def test_未跑_全员not_run不改写条目():
    old = _entry(results={"q1": "pass", "q2": "fail"})
    data = {"schema": 1, "entries": [old]}
    changed = bl.upsert(data, _entry(h="bbbbbbbbbbbb",
                                     results={"q1": "not_run", "q2": "not_run"}))
    assert changed is False
    assert data["entries"][0] is old  # 条目原样，哈希也没被顶上去（未跑 ≠ 有结论）


def test_未跑_首见的包也不入册():
    data = {"schema": 1, "entries": []}
    assert bl.upsert(data, _entry(results={"q1": "not_run"})) is False
    assert data["entries"] == []  # 入册即向 CI 作证「有结论」，而实际上没有


def test_同内容_缺席用例保留历史结果():
    # costly 用例这次没选入（results 里没有 c2）——同哈希，历史结果作数
    old = _entry(kind="cases", results={"c1": "pass", "c2": "pass"})
    data = {"schema": 1, "entries": [old]}
    bl.upsert(data, _entry(kind="cases", results={"c1": "fail"}))
    assert data["entries"][0]["results"] == {"c1": "fail", "c2": "pass"}


def test_换内容_历史结果不搬运():
    # 哈希变了：旧结果量的是旧内容，搬过来是伪造证据
    old = _entry(kind="cases", results={"c1": "pass", "c2": "pass"})
    data = {"schema": 1, "entries": [old]}
    bl.upsert(data, _entry(kind="cases", h="bbbbbbbbbbbb", results={"c1": "pass"}))
    assert data["entries"][0]["results"] == {"c1": "pass"}


def test_结果没变_不刷日期():
    old = _entry(results={"q1": "pass"}, date="2026-08-01")
    data = {"schema": 1, "entries": [old]}
    assert bl.upsert(data, _entry(results={"q1": "pass"}, date="2026-08-31")) is False
    assert data["entries"][0]["date"] == "2026-08-01"  # 无变化不产生 diff 噪声


def test_接受记录随条目延续():
    old = _entry(results={"q1": "fail"})
    old["accepted_regressions"] = [{"case": "q1", "reason": "已知", "date": "2026-08-01"}]
    data = {"schema": 1, "entries": [old]}
    bl.upsert(data, _entry(h="bbbbbbbbbbbb", results={"q1": "fail", "q2": "pass"}))
    assert data["entries"][0]["accepted_regressions"][0]["reason"] == "已知"


# ---------------------------------------------------------------- 基线洞（unusable 不构成证据）
# 实测背景（2026-08-31）：首版 --establish 大并发（8 并发 729 次调用）撞限流，把
# dby-charter 判出 14/18 unusable；单独重跑 18/18 稳定、零不可用——洞是限流产物。
# 而 CI 旧实现只查「(skill, hash) 有没有记录」、比对只认「基线 pass、本次 fail」：
# 有洞的条目既放行又永远比不出退步——看着覆盖了，其实没有。以下钉死三件事：
# 洞有唯一定义且可见、同内容的瞬时洞被历史回填、洞不覆盖同内容的有效历史。

def test_unusable_cases_列出洞且排序稳定():
    e = _entry(results={"b": "unusable", "a": "unusable", "c": "pass", "d": "flaky"})
    assert bl.unusable_cases(e) == ["a", "b"]  # flaky 不是洞：答案拿到了，只是不稳定
    assert bl.unusable_cases(_entry(results={"c": "pass"})) == []
    assert bl.unusable_cases(_entry(results=None)) == []


def test_同内容_瞬时unusable被历史结果回填_不污染干净基线():
    # 同哈希：历史 pass 是对同一份内容的有效测量，本次的 unusable（限流产物）
    # 不许把它覆盖掉——回填后与历史一致，条目一字不动、不刷日期。
    old = _entry(results={"q1": "pass", "q2": "pass"})
    data = {"schema": 1, "entries": [old]}
    assert bl.upsert(data, _entry(results={"q1": "pass", "q2": "unusable"})) is False
    assert data["entries"][0]["results"] == {"q1": "pass", "q2": "pass"}


def test_换内容_unusable原样写入_洞在基线里可见不算证据():
    # 哈希变了：旧结果量的是旧内容，不可回填；洞随条目写入（diff 可见），
    # 由 release_gate（exit 2）与 check_baseline（CI 拦发版）负责挡住——
    # 写入是为了可见与可审计，不等于把洞当作有效证据。
    old = _entry(results={"q1": "pass"})
    data = {"schema": 1, "entries": [old]}
    assert bl.upsert(data, _entry(h="bbbbbbbbbbbb", results={"q1": "unusable"})) is True
    assert data["entries"][0]["results"] == {"q1": "unusable"}
    assert bl.unusable_cases(data["entries"][0]) == ["q1"]
