"""case_bench.py 的行为钉子：加载校验、grader 三值域、check 退出码、逐条归因、
多轮稳定性、costly 门、覆盖状态报告（tasks.md 2.2–2.8）。

🔴 全部 mock 掉模型与 agent 调用，绝不真跑——真跑要花钱，那是主线程拿到许可后的事。
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_SPEC = importlib.util.spec_from_file_location("cb", Path(__file__).resolve().parents[1] / "case_bench.py")
cb = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cb)


# ---------------------------------------------------------------- 造仓工具

def _mk_tree(tmp_path, packages):
    """在 tmp 下造一个假 skills/ 树。packages: {slug: {"triggers": bool, "cases": [dict]|None}}"""
    skills = tmp_path / "skills"
    for slug, spec in packages.items():
        d = skills / slug
        (d).mkdir(parents=True)
        (d / "SKILL.md").write_text("---\nname: x\ndescription: y\n---\n", encoding="utf-8")
        if spec.get("triggers"):
            (d / "evals").mkdir(exist_ok=True)
            (d / "evals" / "triggers.jsonl").write_text('{"q":"x","expect":true}\n', encoding="utf-8")
        if spec.get("cases") is not None:
            (d / "evals").mkdir(exist_ok=True)
            lines = "\n".join(json.dumps(c, ensure_ascii=False) for c in spec["cases"])
            (d / "evals" / "cases.jsonl").write_text(lines + "\n", encoding="utf-8")
    return skills


def _case(cid="c1", costly=False, n_assert=1):
    return {"id": cid, "prompt": "做点什么", "costly": costly,
            "assertions": [{"kind": "check", "cmd": "true"}] * n_assert}


def _no_model_calls(monkeypatch):
    """--dry 与未跑路径绝不许碰模型：任何子进程/后端调用直接炸。"""
    def boom(*a, **kw):
        raise AssertionError("这条路径不许调用模型/子进程")
    monkeypatch.setattr(cb.subprocess, "run", boom)
    monkeypatch.setattr(cb.runners, "ask", boom)


def _sandbox_ok(monkeypatch):
    """真跑路径的测试都 stub 掉沙箱可用性检查——测试环境不保证装了 codex，
    检查本身有专门的测试钉（见「D8 沙箱」一节）。"""
    monkeypatch.setattr(cb, "ensure_sandbox_available", lambda: None)


# 2026-08-31 真实采样的 `claude -p --verbose --output-format stream-json` 事件流
# （prompt「用 dby-banned-words 检查这段文案：…」，经 codex sandbox 真跑一次采得）。
# D9 的提取器全部拿它钉住，不再反复真跑。
#
# ⚠️ 已脱敏，别按「采样就该原样保留」把这些补回来：原始采样的 init 事件是采样机的
#    环境全量转储（家目录路径、socket、已装 skill 全表、各 MCP 授权态），hook 事件带
#    绝对路径 —— 这是个公开仓库。提取器只认 init 的形状，所以 init 压成最小形状、
#    hook 事件删除、沙箱工作目录换成 /tmp/stream-sample。工具调用与 result 原样未动。
STREAM_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "claude_stream_dby_banned_words.jsonl"


def _stream(final="最终回答", skill=None, is_error=False, extra_tool=None):
    """构造一段最小的 stream-json stdout（形状对齐真实采样，见 STREAM_FIXTURE）。"""
    lines = [{"type": "system", "subtype": "init"}]
    if skill:
        lines.append({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Skill", "input": {"skill": skill, "args": "x"}}]}})
    if extra_tool:
        lines.append({"type": "assistant", "message": {"content": [extra_tool]}})
    lines.append({"type": "result", "subtype": "success", "is_error": is_error,
                  "result": final})
    return "\n".join(json.dumps(x, ensure_ascii=False) for x in lines)


# ---------------------------------------------------------------- 2.2 加载与 --dry

def test_加载_costly可省略默认false(tmp_path):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [{"id": "a", "prompt": "x",
                                                   "assertions": [{"kind": "assert", "text": "t"}]}]}})
    cases = cb.load_cases("p1", skills)
    assert len(cases) == 1 and cases[0]["costly"] is False


@pytest.mark.parametrize("bad", [
    {"id": "a", "prompt": "x", "assertions": []},                                # 空断言
    {"id": "a", "prompt": "x"},                                                  # 缺断言
    {"prompt": "x", "assertions": [{"kind": "check", "cmd": "true"}]},           # 缺 id
    {"id": "a", "prompt": "x", "assertions": [{"kind": "verify", "cmd": "t"}]},  # 非法 kind
    {"id": "a", "prompt": "x", "assertions": [{"kind": "check"}]},               # check 缺 cmd
    {"id": "a", "prompt": "x", "costly": "yes",
     "assertions": [{"kind": "check", "cmd": "true"}]},                          # costly 非 bool
])
def test_加载_非法格式在加载期就炸(tmp_path, bad):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [bad]}})
    with pytest.raises(SystemExit):
        cb.load_cases("p1", skills)


def test_加载_id重复报错(tmp_path):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("dup"), _case("dup")]}})
    with pytest.raises(SystemExit):
        cb.load_cases("p1", skills)


def test_dry模式_列出全部用例且不调模型(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("alpha"), _case("beta", costly=True)]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    _no_model_calls(monkeypatch)
    assert cb.main(["--dry"]) == 0
    out = capsys.readouterr().out
    assert "alpha" in out and "beta" in out and "--dry" in out


# ---------------------------------------------------------------- 2.3 grader 三值域

def test_grader_噪声行判为不可用而非pass(monkeypatch):
    # 与 trigger_bench 同一条教训：诊断行混进 stdout，照单全收会把噪声记成判定。
    noise = "Client.listTools() called but server does not advertise tools capability"
    monkeypatch.setattr(cb.runners.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout=noise, stderr=""))
    assert cb.grade_assert("产出", "陈述", "claude", "m") is None


def test_grader_只认三值域(monkeypatch):
    monkeypatch.setattr(cb.runners.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout="成立", stderr=""))
    assert cb.grade_assert("产出", "陈述", "claude", "m") is None  # 「成立」不在域内，不翻译不编造
    monkeypatch.setattr(cb.runners.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout="unclear", stderr=""))
    assert cb.grade_assert("产出", "陈述", "claude", "m") == "unclear"


# ---------------------------------------------------------------- 2.4 check 退出码

def test_check_退出码0为pass(tmp_path):
    assert cb.run_check("exit 0", tmp_path) == "pass"


def test_check_非零退出码为fail(tmp_path):
    assert cb.run_check("exit 3", tmp_path) == "fail"


def test_check_在指定目录执行(tmp_path):
    (tmp_path / "output.txt").write_text("有料", encoding="utf-8")
    assert cb.run_check("grep -q 有料 output.txt", tmp_path) == "pass"


# ---------------------------------------------------------------- 2.5 逐条归因

def _r(result, kind="check"):
    return {"kind": kind, "desc": "d", "result": result}


def test_整例判定_优先级():
    assert cb.case_verdict([_r("pass")] * 4) == "pass"
    assert cb.case_verdict([_r("pass"), _r("unclear")]) == "unclear"
    assert cb.case_verdict([_r("fail"), _r("unclear"), _r(None)]) == "fail"  # fail 是实锤，最优先
    assert cb.case_verdict([_r("pass"), _r(None)]) == "unusable"
    assert cb.case_verdict(None) == "unusable"


def test_四条断言一条不成立_逐条列出并指明是哪条(capsys):
    detail = [_r("pass"), _r("pass"), _r("fail"), _r("pass")]
    rec = cb.aggregate_rounds({"owner": "p1", "id": "x4"}, [detail])
    assert rec["verdict"] == "fail"
    cb.print_case_detail(rec)
    out = capsys.readouterr().out.splitlines()
    body = [ln for ln in out if "断言#" in ln]
    assert len(body) == 4
    assert "fail" in body[2] and "pass" in body[0]  # 第 3 条被点名


def test_unclear与fail分开计数(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("cf"), _case("cu")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    by_id = {"cf": "fail", "cu": "unclear"}
    monkeypatch.setattr(cb, "run_case_once", lambda case, *a: [_r(by_id[case["id"]])])
    assert cb.main([]) == 0
    out = capsys.readouterr().out
    assert "fail 1" in out and "unclear 1" in out and "pass 0" in out


# ---------------------------------------------------------------- 2.6 多轮与稳定性

def test_跨轮不一致落入抖动_不计通过失败(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("jitter")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    seq = iter(["pass", "fail", "pass"])  # 注入式抖动
    monkeypatch.setattr(cb, "run_case_once", lambda *a: [_r(next(seq))])
    assert cb.main(["--rounds", "3", "--workers", "1"]) == 0
    out = capsys.readouterr().out
    assert "抖动 1 条" in out and "jitter" in out
    assert "pass 0" in out and "fail 0" in out  # 抖动不计入任何一档


def test_单轮可跑但标明不构成放行依据(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("solo")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    monkeypatch.setattr(cb, "run_case_once", lambda *a: [_r("pass")])
    assert cb.main(["--rounds", "1"]) == 0
    assert "不构成放行依据" in capsys.readouterr().out


# ---------------------------------------------------------------- 2.7 costly 门

def test_costly默认跳过且列入已跳过(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("cheap"), _case("burn", costly=True)]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    ran = []
    monkeypatch.setattr(cb, "run_case_once", lambda case, *a: ran.append(case["id"]) or [_r("pass")])
    assert cb.main(["--rounds", "1"]) == 0
    out = capsys.readouterr().out
    assert "已跳过" in out and "burn" in out.split("已跳过")[1]  # 不静默省略
    assert set(ran) == {"cheap"}


def test_include_costly才真跑(tmp_path, monkeypatch):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("burn", costly=True)]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    ran = []
    monkeypatch.setattr(cb, "run_case_once", lambda case, *a: ran.append(case["id"]) or [_r("pass")])
    assert cb.main(["--rounds", "1", "--include-costly"]) == 0
    assert ran == ["burn"]


# ---------------------------------------------------------------- 模型默认按后端解析（实测教训）

def test_默认模型按后端解析_grader不串用sonnet(tmp_path, monkeypatch):
    """🔴 实测（2026-08-31）：`pi --model sonnet` 被解析到无 key 的 amazon-bedrock，
    输出非 JSON 报错。默认（grader=pi）时 grader_model 必须解析为 None
    （= 不给 pi 传 --model，用它自己的可用默认），executor（claude）保持 sonnet。"""
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("c1")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    seen = {}
    monkeypatch.setattr(cb, "run_case_once",
                        lambda case, *a: (seen.setdefault("a", a), [_r("pass")])[1])
    assert cb.main(["--rounds", "1"]) == 0
    exec_runner, exec_model, grader_runner, grader_model = seen["a"][:4]
    assert (exec_runner, exec_model) == ("claude", "sonnet")  # claude 的别名默认是对的，保持
    assert (grader_runner, grader_model) == ("pi", None)      # pi 不许接过 claude 的别名


# ---------------------------------------------------------------- 2.8 覆盖状态报告

def test_缺判据的包进缺口清单(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {
        "p-full": {"triggers": True, "cases": [_case()]},
        "p-naked": {},  # 两类判据都没有——等价于「临时移走 evals 目录」
    })
    monkeypatch.setattr(cb, "SKILLS", skills)
    _no_model_calls(monkeypatch)
    assert cb.main(["--dry", "--skills", "p-full"]) == 0
    out = capsys.readouterr().out
    assert "缺口" in out
    gap = out.split("缺口")[1]
    assert "p-naked" in gap and "triggers.jsonl" in gap and "cases.jsonl" in gap


def test_有外部后果缺执行层判据_单独列出且整体不得全部通过(tmp_path, monkeypatch, capsys):
    # dby-update 在 EXTERNAL_CONSEQUENCE 表里（会写用户磁盘），只有触发层没有执行层。
    skills = _mk_tree(tmp_path, {
        "dby-update": {"triggers": True},
        "p1": {"cases": [_case()]},
    })
    monkeypatch.setattr(cb, "SKILLS", skills)
    _no_model_calls(monkeypatch)
    assert cb.main(["--dry"]) == 0
    out = capsys.readouterr().out
    assert "有外部后果但缺执行层判据" in out
    assert "dby-update" in out.split("有外部后果但缺执行层判据")[1]
    assert "整体判定不得报告为全部通过" in out


# ---------------------------------------------------------------- D7 缺密钥标未跑

def test_缺密钥_标未跑不标通过(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("needs-key")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.delenv("DOUBAOYA_API_KEY", raising=False)
    _sandbox_ok(monkeypatch)
    monkeypatch.setattr(cb, "run_case_once",
                        lambda *a: pytest.fail("缺密钥时不许执行用例"))
    assert cb.main([]) == 2  # 跑不了 ≠ 通过，退出码走「前置不可用」
    out = capsys.readouterr().out
    assert "未跑" in out and "needs-key" in out


# ---------------------------------------------------------------- 2.10 trigger_bench 默认行为不变

def test_trigger_bench_默认runner仍是claude():
    spec = importlib.util.spec_from_file_location(
        "tb", Path(__file__).resolve().parents[1] / "trigger_bench.py")
    tb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tb)
    import inspect
    assert inspect.signature(tb.ask).parameters["runner"].default == "claude"


def test_trigger_bench_dry_默认与pi_runner都能跑():
    import subprocess
    tb = Path(__file__).resolve().parents[1] / "trigger_bench.py"
    for extra in ([], ["--runner", "pi"]):
        p = subprocess.run([sys.executable, str(tb), "--dry"] + extra,
                           capture_output=True, text=True, timeout=60)
        assert p.returncode == 0, p.stderr
        assert "--dry" in p.stdout


# ---------------------------------------------------------------- 2.11 D8 沙箱

def test_沙箱包裹_命令以codex_sandbox开头():
    wrapped = cb.sandbox_wrap(["claude", "-p", "--model", "sonnet", "P"])
    assert wrapped[:2] == ["codex", "sandbox"]
    assert 'sandbox_mode="workspace-write"' in wrapped
    assert wrapped[wrapped.index("--") + 1:] == ["claude", "-p", "--model", "sonnet", "P"]


def test_沙箱必须放开网络否则executor拿不到凭证也连不上api():
    """2026-08-31 实测：默认 workspace-write 会同时挡住网络与 Keychain，
    claude 起来就是 `Not logged in · Please run /login`，5/5 用例全判不可用。
    加 network_access=true 后网络与 Keychain 一并放开，executor 才跑得通。
    这条测试钉住那个配置，别被后人当成冗余删掉。"""
    wrapped = cb.sandbox_wrap(["claude", "-p", "P"])
    assert "sandbox_workspace_write.network_access=true" in wrapped


def test_executor实际下发的命令经过沙箱且带跳权限开关(tmp_path, monkeypatch):
    seen = {}
    stream = _stream(final="ok", skill="p1")

    def fake_run(cmd, **kw):
        seen["cmd"], seen["cwd"] = cmd, kw.get("cwd")
        return SimpleNamespace(returncode=0, stdout=stream, stderr="")

    monkeypatch.setattr(cb.subprocess, "run", fake_run)
    assert cb.execute_prompt("P", "claude", "sonnet", tmp_path, "p1") == ("ok", True, "")
    cmd = seen["cmd"]
    assert cmd[:2] == ["codex", "sandbox"]                      # 一律经沙箱（D8）
    assert 'sandbox_mode="workspace-write"' in cmd              # 默认 read-only，必须显式放宽
    assert "--dangerously-skip-permissions" in cmd              # 正当性来自外层沙箱
    # D9：executor 必须走 stream-json 事件流（--verbose 是 -p + stream-json 的配套旗标）
    assert "--output-format" in cmd and "stream-json" in cmd and "--verbose" in cmd
    assert seen["cwd"] == str(tmp_path)                         # 产物落在临时目录


def test_沙箱缺失_拒绝执行不降级裸跑(monkeypatch):
    monkeypatch.setattr(cb.shutil, "which", lambda name: None)  # codex 未装
    with pytest.raises(SystemExit) as e:
        cb.ensure_sandbox_available()
    assert e.value.code == 2


def test_非macOS_拒绝执行(monkeypatch):
    monkeypatch.setattr(cb.sys, "platform", "linux")
    with pytest.raises(SystemExit) as e:
        cb.ensure_sandbox_available()
    assert e.value.code == 2


def test_main真跑路径_沙箱不可用直接退出不跑用例(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("c1")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    monkeypatch.setattr(cb.shutil, "which", lambda name: None)
    monkeypatch.setattr(cb, "run_case_once",
                        lambda *a: pytest.fail("沙箱不可用时不许执行用例"))
    with pytest.raises(SystemExit) as e:
        cb.main([])
    assert e.value.code == 2


# ---------------------------------------------------------------- 3.6 D9 stream-json 与 skill 调用验证
# 全部钉在 2026-08-31 的真实采样 fixture 上（STREAM_FIXTURE），不真跑模型。
# 背景（design.md D9）：首轮真跑里裸 `-p` 的判据分不清「skill 跑了但干得不好」和
# 「skill 压根没跑」——145 个 skill 候选集里隐式路由不中，而 prompt 自带平台词的
# 用例靠裸模型复述问题就 grep 全绿（假绿）。所以只认事件流里的工具调用这个机器事实。

def _fixture_stdout():
    return STREAM_FIXTURE.read_text(encoding="utf-8")


def test_fixture_真实事件流_能取出最终文本():
    events = cb.parse_stream_events(_fixture_stdout())
    text = cb.stream_final_text(events)
    assert text is not None
    # 真实采样里 skill 真的跑了：最终文本是三平台比对表，不是裸模型散文
    assert "小红书" in text and "抖音" in text and "公众号" in text
    # 与 result 事件的 result 字段逐字一致（output.txt 的契约来源）
    raw = next(e for e in events if e.get("type") == "result")
    assert text == raw["result"]


def test_fixture_真实事件流_本包skill被调用判True_他包判False():
    events = cb.parse_stream_events(_fixture_stdout())
    # 实测形状：{"name":"Skill","input":{"skill":"dby-banned-words","args":"…"}}
    assert cb.stream_skill_invoked(events, "dby-banned-words") is True
    assert cb.stream_skill_invoked(events, "dby-publish") is False


def test_skill调用判定_也认工具input里的skills路径():
    """agent 对「用 <slug> 的某某脚本跑一下」类 prompt 可能不走 Skill 工具而直接
    Bash 执行本包脚本（真实采样里 Skill 调起后接的就是这种 Bash 命令）——
    路径段 skills/<slug>/ 同样是机器事实，算被调用。"""
    tool = {"type": "tool_use", "name": "Bash",
            "input": {"command": "node .claude/skills/dby-image/scripts/gen.mjs x"}}
    events = cb.parse_stream_events(_stream(extra_tool=tool))
    assert cb.stream_skill_invoked(events, "dby-image") is True
    assert cb.stream_skill_invoked(events, "dby-publish") is False


def test_skill调用判定_不认输出措辞只认工具调用():
    """D9 明确否决「靠输出特征文案判断」——最终文本里写满了包名也不算调用。"""
    events = cb.parse_stream_events(_stream(final="我用 dby-banned-words 查过了（并没有）"))
    assert cb.stream_skill_invoked(events, "dby-banned-words") is False


def test_executor_解析事件流_返回最终文本与调用事实(tmp_path, monkeypatch):
    monkeypatch.setattr(cb.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0,
                                                         stdout=_fixture_stdout(), stderr=""))
    res = cb.execute_prompt("P", "claude", "sonnet", tmp_path, "dby-banned-words")
    assert res is not None
    text, invoked, tools = res
    assert invoked is True and "小红书" in text
    # D10：工具结果同段返回——脚本 stdout 的机器事实在 tools 里，不在最终摘要里
    assert "originalContent" in tools


def test_executor_stdout不是事件流_判不可用不编造(tmp_path, monkeypatch):
    # 裸文本（旧 -p 形态或 CLI 异常输出）没有 result 事件 ⇒ 拿不到可信产出，返回 None
    monkeypatch.setattr(cb.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(returncode=0, stdout="ok", stderr=""))
    assert cb.execute_prompt("P", "claude", "sonnet", tmp_path, "p1") is None


def test_executor_result事件带is_error_判不可用(tmp_path, monkeypatch):
    monkeypatch.setattr(cb.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(
                            returncode=0, stdout=_stream(is_error=True, skill="p1"), stderr=""))
    assert cb.execute_prompt("P", "claude", "sonnet", tmp_path, "p1") is None


def test_skill未被调用_整轮判unusable而非pass(tmp_path, monkeypatch):
    """D9 的核心钉子：未调用 ⇒ unusable，绝不走到「断言通过」。
    构造全 true 的 check 断言——若哨兵失效、断言被照常执行，这条会错判成 pass。"""
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("ghost", n_assert=2)]}})
    monkeypatch.setattr(cb, "execute_prompt",
                        lambda prompt, runner, model, workdir, slug: ("裸模型的散文", False, ""))
    detail = cb.run_case_once(_case("ghost", n_assert=2) | {"owner": "p1"},
                              "claude", "sonnet", "pi", None, None, skills)
    assert detail == cb.SKILL_NOT_INVOKED
    assert cb.case_verdict(detail) == "unusable"


def test_skill未被调用_聚合与报告点明原因(capsys):
    rec = cb.aggregate_rounds({"owner": "p1", "id": "ghost"},
                              [cb.SKILL_NOT_INVOKED, cb.SKILL_NOT_INVOKED])
    assert rec["bucket"] == "unusable"
    cb.print_case_detail(rec)
    assert "skill 未被调用" in capsys.readouterr().out


def test_main_skill未被调用的用例列入不可用并点名D9(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("ghost")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    monkeypatch.setattr(cb, "run_case_once", lambda *a: cb.SKILL_NOT_INVOKED)
    assert cb.main(["--rounds", "1"]) == 0
    out = capsys.readouterr().out
    assert "不可用 1 条" in out and "pass 0" in out          # 绝不算通过
    assert "skill 未被调用" in out                            # 原因要点名，可读可追


def test_非claude_executor_整批拒绝不烧模型调用(tmp_path, monkeypatch, capsys):
    """验证 skill 调用只实测了 claude 的 stream-json 形状；其余后端没采样过
    事件流，跑了也无法履行 D9 的「必须验证」——拒绝而不是假定调用了。"""
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("c1")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "x")
    _sandbox_ok(monkeypatch)
    monkeypatch.setattr(cb, "run_case_once",
                        lambda *a: pytest.fail("非 claude executor 不许跑用例"))
    assert cb.main(["--runner", "pi"]) == 2
    assert "只支持 claude" in capsys.readouterr().err


def test_非claude_executor_dry仍可自检(tmp_path, monkeypatch, capsys):
    skills = _mk_tree(tmp_path, {"p1": {"cases": [_case("c1")]}})
    monkeypatch.setattr(cb, "SKILLS", skills)
    _no_model_calls(monkeypatch)
    assert cb.main(["--dry", "--runner", "pi"]) == 0


# ---------------------------------------------------------------- 3b.1 D10 工具结果落 tools.txt
# 背景（design.md D10，2026-08-31 第二轮真跑）：断言打 agent 的自由文本总结 ⇒ 5/5 全抖。
# 实测同一采样里最终文本 267 字符（摘要）、工具结果 2851 字符（脚本真实输出）；
# 原短语「全网最低价」在工具结果里**有**、最终文本里**没有**（agent 表格按脚本的
# span 粒度把命中词写成「全网、最低」）。所以工具结果必须单独落 tools.txt 供 check 打。


def test_fixture_工具结果与最终文本分道_D10的实测证据():
    """真实采样 fixture 复现 D10 的账：脚本输出只在工具结果里，摘要里没有。"""
    events = cb.parse_stream_events(_fixture_stdout())
    tools = cb.stream_tool_results(events)
    text = cb.stream_final_text(events)
    # 脚本真实输出（check_multi.py 的 JSON）只在工具结果里
    assert "originalContent" in tools and "全网最低价" in tools
    # 最终文本是摘要：原短语没有，命中词被写成脚本 span 粒度的「全网、最低」
    assert "全网最低价" not in text
    assert "全网" in text and "最低" in text
    # 工具结果不混进最终文本、最终文本不混进工具结果
    assert text not in tools


def test_tool_result_content为块数组也能收():
    """tool_result 的 content 通用形状是内容块数组，不总是字符串（fixture 里是字符串）。"""
    ev = {"type": "user", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "t1",
         "content": [{"type": "text", "text": "块数组里的脚本输出"}]}]}}
    assert "块数组里的脚本输出" in cb.stream_tool_results([ev])


def test_run_case_once_落盘tools_txt_check能打到脚本输出(tmp_path, monkeypatch):
    """契约钉子：check 断言的 cwd 里必须同时有 output.txt（最终文本）与 tools.txt
    （工具结果），且脚本输出只出现在 tools.txt——grep 原短语打 tools.txt 才 pass。"""
    skills = _mk_tree(tmp_path, {"p1": {"cases": []}})
    monkeypatch.setattr(cb, "execute_prompt",
                        lambda prompt, runner, model, workdir, slug:
                        ("摘要：命中 全网、最低", True, '{"originalContent": "全网最低价"}'))
    case = {"id": "t", "prompt": "x", "costly": False, "owner": "p1",
            "assertions": [
                {"kind": "check", "cmd": "grep -q 全网最低价 tools.txt"},      # 机器输出：有
                {"kind": "check", "cmd": "grep -q 全网最低价 output.txt"},     # 摘要：没有（D10 教训）
                {"kind": "check", "cmd": "grep -q 摘要 output.txt"},           # 最终文本仍在 output.txt
            ]}
    detail = cb.run_case_once(case, "claude", "sonnet", "pi", None, None, skills)
    assert [r["result"] for r in detail] == ["pass", "fail", "pass"]


def test_grader材料_含工具结果段与最终回答段():
    prompt = cb.build_grader_prompt("最终回答文本", "陈述", tools="工具结果文本")
    assert "工具结果文本" in prompt and "最终回答文本" in prompt
    assert prompt.index("工具结果文本") < prompt.index("最终回答文本")
    # 不带 tools 时保持单段形态（grader 兼容无工具调用的用例）
    assert "工具结果开始" not in cb.build_grader_prompt("只有回答", "陈述")
