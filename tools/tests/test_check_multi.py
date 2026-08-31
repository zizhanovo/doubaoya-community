"""dby-banned-words/scripts/check_multi.py 的脚本层判据（design.md D10 第一层，tasks 3b.2）。

为什么这些判据在**脚本层**而不是 agent 执行层：它们全是确定性行为，
拿 3 轮沙箱 agent 会话去测是用最贵、最抖的手段测最确定的东西（D10 的原话）。
这里全部 mock 掉 HTTP（罐头响应取自 2026-08-31 真实采样，见
tools/tests/fixtures/claude_stream_dby_banned_words.jsonl 里 check_multi.py 的真实输出），
不联网、不计费、不调模型。

🔴 分工边界（写断言前先读过脚本源码，别再凭想象写）：
  · 「检出」本体在**服务端**（上游词库 + 子串匹配），脚本只是逐平台代发请求并透传信封。
    所以脚本层钉的是**透传不失真**；真检出效果只能靠 agent 执行层的端到端用例
    （打 tools.txt 里的脚本真实输出）兜底。
  · 「安全改写建议」接口**不返回**（SKILL.md 接口契约明写），脚本输出里也没有——
    改写只能由 agent 给，所以它留在 agent 层，这里钉「脚本确实不产改写字段」。
  · 「语境豁免」是 SKILL.md 指派给 agent 的判断（上游按子串匹配、不看语境），
    脚本对命中**原样透传、不做任何语境过滤**——这里钉住这一点，豁免判断留在 agent 层。
"""
from __future__ import annotations

import importlib.util
import io
import json
import re
import subprocess
import sys
import urllib.error
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "skills" / "dby-banned-words" / "scripts" / "check_multi.py"
_SPEC = importlib.util.spec_from_file_location("cm", _SCRIPT)
cm = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(cm)


# ---------------------------------------------------------------- 罐头响应（真实采样）

def _sampled_data(original="全网最低价，效果立竿见影"):
    """2026-08-31 真实采样的 data 块（fixture 里 check_multi.py 的真实输出，逐字对齐）。

    🔴 命中词的真实粒度就在这里：上游把「全网最低价」拆成**两个** span——
    「全网」（sensitive-word）与「最低」（banned-word），原短语只在 originalContent 里。
    第二轮真跑 5/5 全抖的直接导火索之一就是断言写成 grep '全网最低价' 去打命中词清单。"""
    return {
        "source": "contentSafety.sensitiveWords",
        "content": '<span class="sensitive-word">全网</span><span class="banned-word">最低</span>价，效果立竿见影',
        "originalContent": original,
        "prohibitedWordsType": ["禁用词", "敏感词"],
        "raw": {"content": original, "originalContent": original,
                "prohibitedWordsType": ["禁用词", "敏感词"]},
    }


class _FakeResp:
    def __init__(self, body: dict):
        self._raw = json.dumps(body, ensure_ascii=False).encode("utf-8")

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _mock_api(monkeypatch, handler):
    """handler(platform, content) -> 信封 dict 或抛异常。顺带记录每次请求的载荷。"""
    calls = []

    def fake_urlopen(req, timeout=None):
        payload = json.loads(req.data.decode("utf-8"))
        calls.append(payload)
        body = handler(payload["platform"], payload["content"])
        return _FakeResp(body)

    monkeypatch.setattr(cm.urllib.request, "urlopen", fake_urlopen)
    return calls


def _envelope(data):
    return {"success": True, "requestId": "req_test", "data": data, "error": None}


def _run_main(monkeypatch, capsys, argv):
    monkeypatch.setattr(sys, "argv", ["check_multi.py"] + argv)
    monkeypatch.setenv("DOUBAOYA_API_KEY", "dyh_test_fake")
    cm._NOTICES_SEEN.clear()  # 模块级去重集，跨测试要清
    cm.main()
    return capsys.readouterr()


# ---------------------------------------------------------------- 违禁词检出（透传不失真）

def test_检出结果透传_五字段齐全且原文完整(monkeypatch, capsys):
    _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["全网最低价，效果立竿见影"])
    out = json.loads(cap.out)
    d = out["xiaohongshu"]
    # SKILL.md 接口契约：data 就这五个字段，脚本不增不减（--raw 之外只剥 raw 的重复键）
    assert set(d.keys()) == {"source", "content", "originalContent", "prohibitedWordsType", "raw"}
    assert d["prohibitedWordsType"] == ["禁用词", "敏感词"]     # 命中类别原样透传
    assert d["originalContent"] == "全网最低价，效果立竿见影"    # 原短语完整保留在 originalContent


def test_零命中同样透传_不被脚本改写成有命中(monkeypatch, capsys):
    clean = {"source": "contentSafety.sensitiveWords", "content": "普通句子",
             "originalContent": "普通句子", "prohibitedWordsType": [], "raw": {}}
    _mock_api(monkeypatch, lambda p, c: _envelope(dict(clean)))
    cap = _run_main(monkeypatch, capsys, ["普通句子"])
    out = json.loads(cap.out)
    for platform in cm.DEFAULT_PLATFORMS:
        assert out[platform]["prohibitedWordsType"] == []
        assert out[platform]["content"] == out[platform]["originalContent"]


# ---------------------------------------------------------------- 三平台逐项比对

def test_默认三平台逐项各发一次请求(monkeypatch, capsys):
    calls = _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["全网最低价"])
    # 每个平台一次独立调用（一次一计费），顺序与 DEFAULT_PLATFORMS 一致
    assert [c["platform"] for c in calls] == ["xiaohongshu", "douyin", "gongzhonghao"]
    # 文案原样进请求体——agent 层「参数拼没拼对」的机器基准
    assert all(c["content"] == "全网最低价" for c in calls)
    out = json.loads(cap.out)
    assert set(out.keys()) == {"xiaohongshu", "douyin", "gongzhonghao"}


def test_platforms参数只发指定平台(monkeypatch, capsys):
    calls = _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["文案", "--platforms", "xiaohongshu,douyin"])
    assert [c["platform"] for c in calls] == ["xiaohongshu", "douyin"]
    assert set(json.loads(cap.out).keys()) == {"xiaohongshu", "douyin"}


def test_单平台失败不影响其它平台(monkeypatch, capsys):
    def handler(platform, content):
        if platform == "douyin":
            raise urllib.error.HTTPError(
                cm.API_URL, 502, "Bad Gateway", None,
                io.BytesIO(json.dumps({"success": False, "error": {
                    "code": "PROVIDER_FAILED", "message": "上游抖动"}}).encode("utf-8")))
        return _envelope(_sampled_data())

    calls = []

    def fake_urlopen_raising(req, timeout=None):
        payload = json.loads(req.data.decode("utf-8"))
        calls.append(payload)
        body = handler(payload["platform"], payload["content"])
        return _FakeResp(body)

    monkeypatch.setattr(cm.urllib.request, "urlopen", fake_urlopen_raising)
    cap = _run_main(monkeypatch, capsys, ["文案"])
    out = json.loads(cap.out)
    assert out["douyin"]["error"]["code"] == "PROVIDER_FAILED"          # 失败平台记 error
    assert out["xiaohongshu"]["prohibitedWordsType"] == ["禁用词", "敏感词"]  # 其余照常
    assert out["gongzhonghao"]["prohibitedWordsType"] == ["禁用词", "敏感词"]
    assert len(calls) == 3  # 失败不打断扇出，三个平台都发了


# ---------------------------------------------------------------- 命中词的真实粒度（D10 的账）

SPAN_RE = re.compile(r'<span class="([a-z-]+)">([^<]+)</span>')


def test_命中词粒度_span逐词拆分_原短语只在originalContent(monkeypatch, capsys):
    """🔴 D10 实测证据的脚本层钉子：上游把「全网最低价」拆成「全网」+「最低」两个 span，
    **不存在**「全网最低价」这个整体命中词。命中词清单 = content 里的 span 内容；
    任何『grep 整个原短语去打命中词清单』的断言都注定挂——它只能去打 originalContent
    （agent 层对应打 tools.txt 里的脚本输出）。后人想把断言改回整短语粒度，先看这条。"""
    _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["全网最低价，效果立竿见影"])
    d = json.loads(cap.out)["xiaohongshu"]
    hits = SPAN_RE.findall(d["content"])
    assert hits == [("sensitive-word", "全网"), ("banned-word", "最低")]
    assert "全网最低价" not in [w for _, w in hits]   # 整短语不是命中词
    assert "全网最低价" in d["originalContent"]        # 它只完整存在于原文字段


# ---------------------------------------------------------------- 安全改写建议（不属于脚本）

def test_脚本输出不含改写建议字段_改写只能由agent给(monkeypatch, capsys):
    """SKILL.md 接口契约明写：接口不返回「风险等级 / 命中词清单 / 替换建议」。
    脚本层能钉的只有「确实没有这些字段」；改写建议因此**只能**留在 agent 执行层测。"""
    _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["全网最低价"])
    out = json.loads(cap.out)
    for d in out.values():
        for absent in ("suggestion", "rewrite", "advice", "level", "riskLevel", "hitWords"):
            assert absent not in d


# ---------------------------------------------------------------- 语境豁免（脚本不做，原样透传）

def test_语境命中原样透传_脚本不做豁免过滤(monkeypatch, capsys):
    """上游按子串匹配不看语境：「最后一步」会命中「最后」。脚本对这类命中**原样透传**、
    不做任何语境过滤——「流程提示保留不改」是 SKILL.md 指派给 agent 的判断，
    所以豁免判断只能留在 agent 执行层测；脚本层钉住『脚本不擅自替 agent 过滤』。"""
    data = {
        "source": "contentSafety.sensitiveWords",
        "content": '<span class="sensitive-word">最后</span>一步啦，请您核对收货地址',
        "originalContent": "最后一步啦，请您核对收货地址",
        "prohibitedWordsType": ["敏感词"],
        "raw": {},
    }
    _mock_api(monkeypatch, lambda p, c: _envelope(dict(data)))
    cap = _run_main(monkeypatch, capsys, ["最后一步啦，请您核对收货地址"])
    d = json.loads(cap.out)["gongzhonghao"]
    assert d["content"] == data["content"]                # 命中标注一字未动
    assert d["prohibitedWordsType"] == ["敏感词"]          # 类别未被脚本抹掉


# ---------------------------------------------------------------- slim / --raw / notice / 缺 key

def test_默认剥raw重复键_raw旗标保留(monkeypatch, capsys):
    _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["文案", "--platforms", "xiaohongshu"])
    d = json.loads(cap.out)["xiaohongshu"]
    assert "content" not in d["raw"] and "originalContent" not in d["raw"]
    assert d["raw"]["prohibitedWordsType"] == ["禁用词", "敏感词"]  # 其它键保留

    _mock_api(monkeypatch, lambda p, c: _envelope(_sampled_data()))
    cap = _run_main(monkeypatch, capsys, ["文案", "--platforms", "xiaohongshu", "--raw"])
    d = json.loads(cap.out)["xiaohongshu"]
    assert d["raw"]["content"] == "全网最低价，效果立竿见影"  # --raw 原样保留


def test_notice走stderr且跨平台去重只提示一次(monkeypatch, capsys):
    def handler(p, c):
        env = _envelope(_sampled_data())
        env["notice"] = "你安装的 skill 有更新"
        return env
    _mock_api(monkeypatch, handler)
    cap = _run_main(monkeypatch, capsys, ["文案"])
    json.loads(cap.out)                                     # stdout 仍是纯 JSON，未被污染
    assert cap.err.count("你安装的 skill 有更新") == 1       # 三平台同 notice 只提示一次


def test_缺key_退出1并指引_不发任何请求():
    p = subprocess.run([sys.executable, str(_SCRIPT), "文案"],
                       capture_output=True, text=True, timeout=30,
                       env={"PATH": "/usr/bin:/bin"})
    assert p.returncode == 1
    assert "DOUBAOYA_API_KEY" in p.stderr


def test_selfcheck_离线自检退出0():
    """把脚本自带的 --selfcheck 接进测试套（同 test_reconcile_selfcheck 的约定）：
    自带断言没人跑 == 不存在。"""
    p = subprocess.run([sys.executable, str(_SCRIPT), "--selfcheck"],
                       capture_output=True, text=True, timeout=30)
    assert p.returncode == 0, p.stderr
    assert "selfcheck ok" in p.stdout
