"""release_gate.py 的行为钉子（tasks 5.1 + 4.3/4.4/4.5 在门层面的落地）：
无退步放行且基线无变化、退步阻断、接受必须附理由、身份不一致报不可比、
执行层未跑不改写基线。

🔴 两个判定器（trigger_bench / case_bench）一律 mock 成罐头结果，绝不真跑——
   真跑要模型要钱，那是主线程拿到许可后的事。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location("rg", _TOOLS / "release_gate.py")
rg = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(rg)

# gate fixture 会把两个判定器入口整个 mock 掉；测「下发了什么命令行」时
# 需要把真实的转发函数装回去、只 mock 更底层的 _run_bench。
_REAL_RUN_TRIGGER_BENCH = rg.run_trigger_bench
_REAL_RUN_CASE_BENCH = rg.run_case_bench


# ---------------------------------------------------------------- 造仓与罐头结果

def _mk_tree(tmp_path, packages):
    """tmp 下造假 skills/ 树。packages: {slug: {"triggers": bool, "cases": bool}}"""
    skills = tmp_path / "skills"
    for slug, spec in packages.items():
        d = skills / slug
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text(f"---\nname: {slug}\ndescription: y\n---\n", encoding="utf-8")
        (d / "evals").mkdir()
        if spec.get("triggers"):
            (d / "evals" / "triggers.jsonl").write_text('{"q":"话术A","expect":true}\n',
                                                        encoding="utf-8")
        if spec.get("cases"):
            (d / "evals" / "cases.jsonl").write_text(
                '{"id":"c1","prompt":"x","assertions":[{"kind":"check","cmd":"true"}]}\n',
                encoding="utf-8")
    return skills


def _trig_json(owner="p1", failed=False):
    rec = {"owner": owner, "q": "话术A", "expect": True, "line": 1, "picks": [owner] * 3}
    if failed:
        rec["failed"] = True
    return {"rounds": 3, "stable": [rec], "flaky": [], "unusable": []}


def _case_json(owner="p1", verdict="pass"):
    return {"rounds": 3, "results": [
        {"owner": owner, "id": "c1", "bucket": "stable", "verdict": verdict, "verdicts": [verdict] * 3}]}


@pytest.fixture
def gate(tmp_path, monkeypatch):
    """标准布景：一个包、触发层 + 执行层判据都有，两个判定器都 mock 成全过。
    返回可再改 mock 的小容器。

    🔴 脚本层（run_script_layer）必须 stub 成全绿：真实现会子进程跑
    `pytest tools/tests`，在测试里不 stub 就是 pytest 套 pytest 的无限递归。
    脚本层自身的行为（先行、失败即中止、不烧模型）有专门的测试组钉（见 3b.5 一节）。"""
    skills = _mk_tree(tmp_path, {"p1": {"triggers": True, "cases": True}})
    bpath = tmp_path / "evals" / "baseline.json"
    monkeypatch.setattr(rg, "SKILLS", skills)
    monkeypatch.setattr(rg, "BASELINE_PATH", bpath)
    box = type("Box", (), {})()
    box.bpath = bpath
    box.trig = (0, _trig_json())
    box.case = (0, _case_json())
    box.script_layer = 0
    box.calls = []  # 记录三层的调用顺序，供时序断言用
    monkeypatch.setattr(rg, "run_script_layer",
                        lambda: box.calls.append("script") or box.script_layer)
    monkeypatch.setattr(rg, "run_trigger_bench",
                        lambda a, s: box.calls.append("trigger") or box.trig)
    monkeypatch.setattr(rg, "run_case_bench",
                        lambda a, s: box.calls.append("case") or box.case)
    return box


# ---------------------------------------------------------------- 5.1 主流程

def test_establish建立基线_含两类条目(gate, capsys):
    assert rg.main(["--establish"]) == 0
    data = json.loads(gate.bpath.read_text(encoding="utf-8"))
    kinds = {(e["skill"], e["kind"]) for e in data["entries"]}
    assert kinds == {("p1", "triggers"), ("p1", "cases")}
    assert "--establish" in capsys.readouterr().out


def test_无改动的仓_输出无退步且基线文件无变化(gate, capsys):
    assert rg.main(["--establish"]) == 0
    before = gate.bpath.read_bytes()
    capsys.readouterr()
    assert rg.main([]) == 0  # 同样的罐头结果再跑一遍 = 无改动的仓
    out = capsys.readouterr().out
    assert "无退步" in out
    assert gate.bpath.read_bytes() == before  # 字节一致，diff 为空


def test_有改进_无退步且基线更新(gate, capsys):
    gate.case = (0, _case_json(verdict="fail"))
    assert rg.main(["--establish"]) == 0
    gate.case = (0, _case_json(verdict="pass"))  # 本次修好了
    capsys.readouterr()
    assert rg.main([]) == 0
    assert "无退步" in capsys.readouterr().out
    data = json.loads(gate.bpath.read_text(encoding="utf-8"))
    cases = next(e for e in data["entries"] if e["kind"] == "cases")
    assert cases["results"]["c1"] == "pass"  # 基线更新为本次结果


# ---------------------------------------------------------------- 4.4 退步阻断与显式接受

def test_退步_默认阻止放行且基线不动(gate, capsys):
    assert rg.main(["--establish"]) == 0
    before = gate.bpath.read_bytes()
    gate.case = (0, _case_json(verdict="fail"))  # 基线 pass、本次稳定 fail
    capsys.readouterr()
    assert rg.main([]) == 1
    out = capsys.readouterr().out
    assert "退步" in out and "p1" in out and "c1" in out  # 逐条列出退步用例
    assert gate.bpath.read_bytes() == before  # 阻止时基线一字不动


def test_接受退步_不带理由被拒绝且不跑判定(gate, monkeypatch, capsys):
    def boom(*a):
        raise AssertionError("理由没给就不该烧模型")
    monkeypatch.setattr(rg, "run_trigger_bench", boom)
    monkeypatch.setattr(rg, "run_case_bench", boom)
    assert rg.main(["--accept-regression", "p1:c1"]) == 1
    assert "理由" in capsys.readouterr().err


def test_接受退步_带理由放行且理由在基线diff中可见(gate, capsys):
    assert rg.main(["--establish"]) == 0
    gate.case = (0, _case_json(verdict="fail"))
    capsys.readouterr()
    assert rg.main(["--accept-regression", "p1:c1",
                    "--reason", "上游接口临时降级，下版修"]) == 0
    text = gate.bpath.read_text(encoding="utf-8")
    assert "上游接口临时降级，下版修" in text  # 理由与被接受条目一并写入基线
    assert "显式接受" in capsys.readouterr().out


def test_接受了不存在的退步_拦下(gate, capsys):
    assert rg.main(["--establish"]) == 0
    capsys.readouterr()
    assert rg.main(["--accept-regression", "p1:不存在", "--reason", "x"]) == 1
    assert "不是本次退步条目" in capsys.readouterr().err


# ---------------------------------------------------------------- 4.3 基线不可比

def test_换模型_报基线不可比而非退步(gate, capsys):
    assert rg.main(["--establish"]) == 0
    before = gate.bpath.read_bytes()
    gate.case = (0, _case_json(verdict="fail"))  # 即便本次全挂
    gate.trig = (0, _trig_json(failed=True))
    capsys.readouterr()
    assert rg.main(["--model", "opus"]) == 1  # 尺子换了
    out = capsys.readouterr().out
    assert "基线不可比" in out and "重建基线" in out
    assert "退步（基线通过" not in out  # 不输出退步结论
    assert gate.bpath.read_bytes() == before


# ---------------------------------------------------------------- 4.5 执行层未跑

def test_执行层未跑_基线条目未被改写且不放行(gate, capsys):
    assert rg.main(["--establish"]) == 0
    before = gate.bpath.read_bytes()
    gate.case = (2, None)  # 缺 DOUBAOYA_API_KEY / 沙箱：case_bench 退出码 2
    capsys.readouterr()
    assert rg.main([]) == 2  # 跑不了 ≠ 通过
    err = capsys.readouterr().err
    assert "未跑" in err
    data = json.loads(gate.bpath.read_text(encoding="utf-8"))
    cases = next(e for e in data["entries"] if e["kind"] == "cases")
    assert cases["results"]["c1"] == "pass"  # 历史结果原样，没被改写成任何东西
    assert gate.bpath.read_bytes() == before


def test_触发层不可用_中止不产生结论(gate, capsys):
    gate.trig = (2, None)
    assert rg.main([]) == 2
    assert "跑不了 ≠ 通过" in capsys.readouterr().err


# ---------------------------------------------------------------- 稳定性规则在门层面

def test_少于3轮_不构成放行依据不更新基线(gate, capsys):
    assert rg.main(["--establish"]) == 0
    before = gate.bpath.read_bytes()
    gate.case = (0, _case_json(verdict="fail"))
    capsys.readouterr()
    assert rg.main(["--rounds", "1"]) == 1
    assert "不构成放行依据" in capsys.readouterr().out
    assert gate.bpath.read_bytes() == before


def test_establish也拒绝少于3轮(gate, capsys):
    assert rg.main(["--establish", "--rounds", "1"]) == 1
    assert not gate.bpath.exists()


# ---------------------------------------------------------------- 模型默认按后端解析（实测教训）

def test_不传grader_model_下发给判定器的命令行没有模型参数(gate, monkeypatch):
    """🔴 实测（2026-08-31）：`pi --model sonnet` 被解析到无 key 的 amazon-bedrock，
    每次 grader 调用都拿到非 JSON 报错、被计为不可用，整批判定白跑。
    所以默认（grader=pi）时不许把任何模型别名串下去——命令行里就不该有 --grader-model。"""
    seen = {}

    def fake_bench(script, extra):
        seen[script] = extra
        return (0, _trig_json() if "trigger" in script else _case_json())

    monkeypatch.setattr(rg, "run_trigger_bench", _REAL_RUN_TRIGGER_BENCH)
    monkeypatch.setattr(rg, "run_case_bench", _REAL_RUN_CASE_BENCH)
    monkeypatch.setattr(rg, "_run_bench", fake_bench)
    assert rg.main(["--establish"]) == 0
    case_extra = seen["case_bench.py"]
    assert "--grader-model" not in case_extra          # pi 用自己的默认（实测唯一可用形态）
    assert "sonnet" not in case_extra[case_extra.index("--grader-runner"):]  # 别名没串给 grader
    # executor/盲测默认仍是 claude/sonnet（对 claude 这个默认是对的，保持）
    assert seen["trigger_bench.py"][seen["trigger_bench.py"].index("--model") + 1] == "sonnet"


def test_显式传grader_model_才会下发(gate, monkeypatch):
    seen = {}

    def fake_bench(script, extra):
        seen[script] = extra
        return (0, _trig_json() if "trigger" in script else _case_json())

    monkeypatch.setattr(rg, "run_trigger_bench", _REAL_RUN_TRIGGER_BENCH)
    monkeypatch.setattr(rg, "run_case_bench", _REAL_RUN_CASE_BENCH)
    monkeypatch.setattr(rg, "_run_bench", fake_bench)
    assert rg.main(["--establish", "--grader-model", "deepseek-v4"]) == 0
    extra = seen["case_bench.py"]
    assert extra[extra.index("--grader-model") + 1] == "deepseek-v4"


# ---------------------------------------------------------------- D4：基线记实际模型，来源可区分

def test_基线条目_实测模型与请求模型可区分(gate, capsys):
    """D4 的全部意义是「换了尺子要能被发现」。pi 在 JSON 里回报实际 provider/model
    （实测：不传 --model 时为 deepseek/deepseek-v4-flash），基线记实际值并标
    model_source=reported；claude 拿不到实际值，退回记请求别名并标 requested——
    两种来源用字段区分，不许混在一个字段里看不出差别。"""
    cjson = _case_json()
    cjson["executor"] = {"runner": "claude", "model": "sonnet", "model_source": "requested"}
    cjson["grader"] = {"runner": "pi", "model": "deepseek-v4-flash", "provider": "deepseek",
                       "model_source": "reported", "model_requested": None}
    gate.case = (0, cjson)
    assert rg.main(["--establish"]) == 0
    data = json.loads(gate.bpath.read_text(encoding="utf-8"))
    cases = next(e for e in data["entries"] if e["kind"] == "cases")
    # grader：实测值 + 来源标记 + 实际 provider
    assert cases["grader_model"] == "deepseek-v4-flash"
    assert cases["grader_model_source"] == "reported"
    assert cases["grader_provider"] == "deepseek"
    # executor：只有请求值，如实标 requested
    assert cases["model"] == "sonnet" and cases["model_source"] == "requested"
    # 触发层（claude）：同样只有请求值
    trig = next(e for e in data["entries"] if e["kind"] == "triggers")
    assert trig["model"] == "sonnet" and trig["model_source"] == "requested"


def test_基线grader实际模型变了_报不可比而非退步(gate, capsys):
    """尺子换了（pi 的默认模型漂移）必须被发现——这正是记实际模型的目的。"""
    cjson = _case_json()
    cjson["grader"] = {"runner": "pi", "model": "deepseek-v4-flash", "provider": "deepseek",
                       "model_source": "reported"}
    gate.case = (0, cjson)
    assert rg.main(["--establish"]) == 0
    cjson2 = _case_json(verdict="fail")  # 即便本次全挂
    cjson2["grader"] = {"runner": "pi", "model": "deepseek-v5", "provider": "deepseek",
                        "model_source": "reported"}
    gate.case = (0, cjson2)
    capsys.readouterr()
    assert rg.main([]) == 1
    out = capsys.readouterr().out
    assert "基线不可比" in out
    assert "退步（基线通过" not in out


def test_dry_不调判定器且报告覆盖(gate, monkeypatch, capsys):
    def boom(*a):
        raise AssertionError("--dry 不许调判定器")
    monkeypatch.setattr(rg, "run_trigger_bench", boom)
    monkeypatch.setattr(rg, "run_case_bench", boom)
    assert rg.main(["--dry"]) == 0
    out = capsys.readouterr().out
    assert "--dry" in out and "无记录" in out  # 还没建基线，报无记录


# ---------------------------------------------------------------- 3b.5 脚本层先行（design.md D10）

def test_脚本层失败_在任何模型调用之前中止(gate, monkeypatch, capsys):
    """🔴 D10 的钱包钉子：脚本层红 ⇒ 触发层/执行层（要烧模型的那两层）一步都不许启动。
    两个判定器换成「跑到即炸」的哨兵——脚本层没挡住时这条测试当场红。"""
    gate.script_layer = 1
    monkeypatch.setattr(rg, "run_trigger_bench",
                        lambda a, s: pytest.fail("脚本层失败后不许调触发层（烧模型）"))
    monkeypatch.setattr(rg, "run_case_bench",
                        lambda a, s: pytest.fail("脚本层失败后不许调执行层（烧模型）"))
    assert rg.main([]) == 1
    assert not gate.bpath.exists()  # 基线一字不动


def test_脚本层不可用_同样在模型调用之前中止且退出码2(gate, monkeypatch):
    """跑不了 ≠ 通过（与 D7 同一条原则）：脚本层前置缺失（如没有 node）时 exit 2，不放行。"""
    gate.script_layer = 2
    monkeypatch.setattr(rg, "run_trigger_bench",
                        lambda a, s: pytest.fail("脚本层不可用后不许调触发层"))
    assert rg.main([]) == 2


def test_脚本层先于触发层与执行层执行(gate):
    assert rg.main([]) == 0
    assert gate.calls[0] == "script"
    assert gate.calls == ["script", "trigger", "case"]


def test_establish同样受脚本层门管(gate, monkeypatch):
    """把已坏的确定性行为锁进首版基线是最糟的起点——--establish 不豁免脚本层。"""
    gate.script_layer = 1
    monkeypatch.setattr(rg, "run_trigger_bench",
                        lambda a, s: pytest.fail("脚本层失败后 --establish 也不许跑判定"))
    assert rg.main(["--establish"]) == 1
    assert not gate.bpath.exists()


def test_dry不跑脚本层也不调判定器(gate, capsys):
    """--dry 是纯离线覆盖视图，连脚本层都不跑（它要起 pytest 子进程，--dry 应零开销）。"""
    assert rg.main(["--dry"]) == 0
    assert gate.calls == []


def test_真实现_脚本层pytest失败即返回1且不跑selfcheck(monkeypatch, tmp_path, capsys):
    """钉真实现（不经 fixture 的 stub）：pytest 子进程非零 ⇒ 直接 1，
    连 selfcheck 都不再跑（列表由 SKILLS glob 得来，这里指到空树即可佐证未触碰）。"""
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        from types import SimpleNamespace
        return SimpleNamespace(returncode=1, stdout="", stderr="")

    monkeypatch.setattr(rg.subprocess, "run", fake_run)
    monkeypatch.setattr(rg, "SKILLS", tmp_path)  # 空树：没有 selfcheck 可跑
    assert rg.run_script_layer() == 1
    assert len(calls) == 1 and "pytest" in " ".join(map(str, calls[0]))


def test_真实现_selfcheck失败即返回1并点名文件(monkeypatch, tmp_path, capsys):
    sc = tmp_path / "skills" / "p1" / "scripts" / "boom.selfcheck.mjs"
    sc.parent.mkdir(parents=True)
    sc.write_text("process.exit(3)\n", encoding="utf-8")
    monkeypatch.setattr(rg, "ROOT", tmp_path)
    monkeypatch.setattr(rg, "SKILLS", tmp_path / "skills")

    from types import SimpleNamespace

    def fake_run(cmd, **kw):
        # 注意不能用「路径里含 pytest」来分流——pytest 的 tmp_path 本身就带 pytest 字样
        if list(map(str, cmd[:3]))[1:] == ["-m", "pytest"]:
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        return SimpleNamespace(returncode=3, stdout="", stderr="boom")

    monkeypatch.setattr(rg.subprocess, "run", fake_run)
    assert rg.run_script_layer() == 1
    err = capsys.readouterr().err
    assert "boom.selfcheck.mjs" in err and "不烧模型调用" in err


# ---------------------------------------------------------------- 基线洞的封堵（design.md D4b）
# 实测背景（2026-08-31）：首版 --establish（243 条 × 3 轮 = 729 次调用、8 并发）撞限流，
# dby-charter 被判出 14/18 unusable；单独重跑 18/18 稳定、零不可用。旧行为：洞随条目
# 静默写入基线，CI 只查存在性照样放行，比对又永远比不出退步——话术无声失去监控。

def test_establish_有洞条目点名并exit2_洞写入基线可见(gate, capsys):
    tj = _trig_json()
    tj["stable"] = []
    tj["unusable"] = [{"owner": "p1", "q": "话术A", "expect": True, "line": 1,
                       "picks": [None, "p1", "p1"]}]
    gate.trig = (0, tj)
    assert rg.main(["--establish"]) == 2  # 有洞 ⇒ 未产生完整结论，不算「基线已建好」
    err = capsys.readouterr().err
    assert "unusable" in err and "p1" in err and "话术A" in err  # 点名到包和话术
    assert "重跑" in err  # 提示重跑，不静默
    data = json.loads(gate.bpath.read_text(encoding="utf-8"))
    trig = next(e for e in data["entries"] if e["kind"] == "triggers")
    assert trig["results"]["话术A"] == "unusable"  # 洞随条目写入，diff 可见可审计
    cases = next(e for e in data["entries"] if e["kind"] == "cases")
    assert cases["results"]["c1"] == "pass"  # 干净的执行层条目照常入册


def test_同哈希重跑_瞬时unusable被历史回填_不打红也不改基线(gate, capsys):
    assert rg.main(["--establish"]) == 0  # 干净首版
    before = gate.bpath.read_bytes()
    tj = _trig_json()
    tj["stable"] = []
    tj["unusable"] = [{"owner": "p1", "q": "话术A", "expect": True, "line": 1,
                       "picks": [None, "p1", "p1"]}]
    gate.trig = (0, tj)
    capsys.readouterr()
    # 同内容重跑撞了一次限流：历史 pass 回填瞬时洞 ⇒ 无洞、无退步、基线字节不变。
    assert rg.main([]) == 0
    assert "无退步" in capsys.readouterr().out
    assert gate.bpath.read_bytes() == before
