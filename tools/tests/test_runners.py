"""runners.py 的行为钉子：命令模板、返回值提取、三值域校验（design.md D2）。

🔴 全部 mock 子进程，绝不真调模型——真跑要花钱，那是主线程拿到许可后的事。
"""
from __future__ import annotations

import importlib.util
import subprocess as real_subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

_SPEC = importlib.util.spec_from_file_location("rn", Path(__file__).resolve().parents[1] / "runners.py")
rn = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(rn)

VALID = {"pass", "fail", "unclear"}


def _fake_run(stdout, returncode=0):
    def run(cmd, **kw):
        return SimpleNamespace(returncode=returncode, stdout=stdout, stderr="")
    return run


# ---------------------------------------------------------------- 命令模板（任务 2.9）

def test_claude_命令行拼装():
    assert rn.RUNNERS["claude"]["build"]("sonnet", "P") == ["claude", "-p", "--model", "sonnet", "P"]


def test_codex_命令行拼装():
    assert rn.RUNNERS["codex"]["build"]("gpt-5", "P") == ["codex", "exec", "-m", "gpt-5", "--ephemeral", "P"]


def test_pi_命令行拼装_带与不带provider():
    assert rn.RUNNERS["pi"]["build"]("m1", "P", "google") == [
        "pi", "-p", "--no-session", "--mode", "json", "--provider", "google", "--model", "m1", "P"]
    assert rn.RUNNERS["pi"]["build"]("m1", "P") == [
        "pi", "-p", "--no-session", "--mode", "json", "--model", "m1", "P"]


def test_model为None_命令行里不出现模型参数():
    # 🔴 实测（2026-08-31）：`pi --model sonnet` 被解析到无 key 的 amazon-bedrock
    #    直接报错；不传 --model 才用得上 pi 自己的可用默认。None = 不下发模型参数。
    assert rn.RUNNERS["pi"]["build"](None, "P") == ["pi", "-p", "--no-session", "--mode", "json", "P"]
    assert rn.RUNNERS["claude"]["build"](None, "P") == ["claude", "-p", "P"]
    assert rn.RUNNERS["codex"]["build"](None, "P") == ["codex", "exec", "--ephemeral", "P"]


def test_默认模型按后端解析_不跨后端串用():
    # sonnet 只是 claude 的可靠默认；pi/codex 为 None（用 CLI 自己的默认）。
    assert rn.DEFAULT_MODELS == {"claude": "sonnet", "codex": None, "pi": None}


def test_ask_model为None时_pi命令行无model参数(monkeypatch):
    seen = {}

    def run(cmd, **kw):
        seen["cmd"] = cmd
        return SimpleNamespace(returncode=0, stdout=_pi_jsonl(answer="pass"), stderr="")

    monkeypatch.setattr(rn.subprocess, "run", run)
    assert rn.ask("pi", "p", None, VALID) == "pass"
    assert "--model" not in seen["cmd"]


# ---------------------------------------------------------------- 返回值提取与校验

def test_自由文本_噪声行不算答案(monkeypatch):
    # trigger_bench 原教训：CLI 往 stdout 混诊断行，纯噪声必须判 None，不编造。
    noise = "Client.listTools() called but server does not advertise tools capability\nreturning empty list"
    monkeypatch.setattr(rn.subprocess, "run", _fake_run(noise))
    assert rn.ask("claude", "p", "m", VALID) is None


def test_自由文本_噪声后仍能捞到取值域内的词(monkeypatch):
    monkeypatch.setattr(rn.subprocess, "run", _fake_run("一些解释\npass\n[diag] something"))
    assert rn.ask("claude", "p", "m", VALID) == "pass"


def test_自由文本_域外词不算答案(monkeypatch):
    # 「ok」「yes」这类不在取值域里的词一律不算——宁可不可用，不可错认。
    monkeypatch.setattr(rn.subprocess, "run", _fake_run("ok"))
    assert rn.ask("claude", "p", "m", VALID) is None


def test_大小写与围饰字符容忍(monkeypatch):
    monkeypatch.setattr(rn.subprocess, "run", _fake_run("`PASS`。"))
    assert rn.ask("codex", "p", "m", VALID) == "pass"


# ---- pi 的实测 fixture（2026-08-31 真机探针，不是手编的形状）----
# 探针 1：`pi -p --no-session --mode json "只回答一个词，不要任何解释：pass"`
# 输出是 JSONL 事件流；thinking_end 事件的 "content" 字段装的是**思考过程**，
# message_end/turn_end 的 message 里带实际 provider/model。answer 参数化最终答案，
# thinking 参数化思考内容——用于构造「思考内容恰好是合法 token」的对抗用例。
def _pi_jsonl(answer="pass", thinking='The user asks to answer with only one word: "pass".',
              with_text=True):
    import json as _json
    blocks = [{"type": "thinking", "thinking": thinking, "thinkingSignature": "reasoning_content"}]
    if with_text:
        blocks.append({"type": "text", "text": answer})
    msg = {"role": "assistant", "content": blocks, "api": "openai-completions",
           "provider": "deepseek", "model": "deepseek-v4-flash",
           "usage": {}, "stopReason": "stop"}
    events = [
        {"type": "message_update", "assistantMessageEvent":
            {"type": "thinking_delta", "contentIndex": 0, "delta": thinking[:4]}},
        {"type": "message_update", "assistantMessageEvent":
            {"type": "thinking_end", "contentIndex": 0, "content": thinking}},
        {"type": "message_update", "assistantMessageEvent":
            {"type": "text_end", "contentIndex": 1, "content": answer}},
        {"type": "message_end", "message": msg},
        {"type": "turn_end", "message": msg, "toolResults": []},
        {"type": "agent_end", "messages": []},
        {"type": "agent_settled"},
    ]
    return "\n".join(_json.dumps(e, ensure_ascii=False) for e in events) + "\n"


# 探针 2：`pi -p --no-session --mode json --model sonnet "…"` 的失败输出——
# `sonnet` 被 pi 解析到 amazon-bedrock provider，本机无该 provider 的 key，
# stdout 是非 JSON 的纯文本报错。
PI_NO_KEY_ERROR = ("No API key found for amazon-bedrock.\n"
                   "Use /login to log into a provider via OAuth or API key. See: https://pi.dev/docs\n")


def test_pi_实测事件流_取最终text块():
    assert rn.RUNNERS["pi"]["extract"](_pi_jsonl(answer="fail"), VALID) == "fail"


def test_pi_thinking内容不会被误当作答案():
    # 🔴 对抗用例：思考内容恰好是合法 token（"fail"），最终回答是 "pass"。
    #    旧实现按 "content" 这个 key 名深度捞，会把 thinking_end 的思考内容混进
    #    候选池——这次能对全靠取值域校验运气好。新实现只认最终 assistant 消息里
    #    type=="text" 的块，任何情况下都不许把思考当答案。
    out = _pi_jsonl(answer="pass", thinking="fail")
    assert rn.RUNNERS["pi"]["extract"](out, VALID) == "pass"


def test_pi_只有thinking没有text块_返回None不编造():
    # 模型只输出了思考、没有正文：即使思考内容是合法 token 也不算答案。
    out = _pi_jsonl(thinking="pass", with_text=False)
    assert rn.RUNNERS["pi"]["extract"](out, VALID) is None


def test_pi_非JSON报错输出_返回None不编造(monkeypatch):
    # 探针 2 的实测输出：模型别名被解析到无 key 的 provider，stdout 是纯文本报错。
    assert rn.RUNNERS["pi"]["extract"](PI_NO_KEY_ERROR, VALID) is None
    monkeypatch.setattr(rn.subprocess, "run", _fake_run(PI_NO_KEY_ERROR))
    assert rn.ask("pi", "p", None, VALID) is None


def test_pi_意外形状不编造():
    # 结构化通道也可能返回意外形状（design.md D2 明说校验不许因此取消）。
    assert rn.RUNNERS["pi"]["extract"]('{"foo": "bar"}', VALID) is None
    assert rn.RUNNERS["pi"]["extract"]("完全不是 JSON 的噪声", VALID) is None


def test_三个runner_mock同义返回_判定一致(monkeypatch):
    # 2.9 验收：判定逻辑与后端无关——同样语义的返回，三个 runner 判定一致。
    by_bin = {"claude": "pass", "codex": "pass", "pi": _pi_jsonl(answer="pass")}

    def run(cmd, **kw):
        return SimpleNamespace(returncode=0, stdout=by_bin[cmd[0]], stderr="")

    monkeypatch.setattr(rn.subprocess, "run", run)
    assert [rn.ask(r, "p", "m", VALID) for r in ("claude", "codex", "pi")] == ["pass"] * 3


# ---------------------------------------------------------------- 失败语义

def test_非零退出码_重试耗尽返回None(monkeypatch):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        return SimpleNamespace(returncode=1, stdout="pass", stderr="")

    monkeypatch.setattr(rn.subprocess, "run", run)
    assert rn.ask("claude", "p", "m", VALID, tries=2) is None
    assert len(calls) == 2


def test_超时_重试耗尽返回None(monkeypatch):
    def run(cmd, **kw):
        raise real_subprocess.TimeoutExpired(cmd=cmd, timeout=1)

    monkeypatch.setattr(rn.subprocess, "run", run)
    assert rn.ask("claude", "p", "m", VALID) is None


# ---------------------------------------------------------------- 实际模型身份（design.md D4）

def test_pi_meta回报实际provider与model(monkeypatch):
    # 探针 1 实测：message_end 的 message 里带实际 provider/model——
    # 请求的是「不指定」（None），实际跑的是 deepseek/deepseek-v4-flash，基线要记后者。
    monkeypatch.setattr(rn.subprocess, "run", _fake_run(_pi_jsonl(answer="pass")))
    meta = {}
    assert rn.ask("pi", "p", None, VALID, meta=meta) == "pass"
    assert meta == {"provider": "deepseek", "model": "deepseek-v4-flash", "source": "reported"}


def test_claude_meta退回请求值并标明来源(monkeypatch):
    # claude 的自由文本输出拿不到实际模型 ID，只能记请求别名，source 必须标 requested——
    # 两种来源可区分是 D4 的底线（换了尺子要能被发现）。
    monkeypatch.setattr(rn.subprocess, "run", _fake_run("pass"))
    meta = {}
    assert rn.ask("claude", "p", "sonnet", VALID, meta=meta) == "pass"
    assert meta == {"provider": None, "model": "sonnet", "source": "requested"}


def test_找不到CLI_退出码2(monkeypatch):
    def run(cmd, **kw):
        raise FileNotFoundError(cmd[0])

    monkeypatch.setattr(rn.subprocess, "run", run)
    with pytest.raises(SystemExit) as e:
        rn.ask("pi", "p", "m", VALID)
    assert e.value.code == 2
