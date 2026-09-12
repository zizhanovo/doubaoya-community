"""sync_releases.build_title / first_clause 的行为钉子。

标题是 Releases 页上唯一一行、也是多数人唯一会读的一行——它漂了，
正文写得再准也没人看见。这里钉的四条都是实测踩过的形状。
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("si", Path(__file__).resolve().parents[1] / "sync_releases.py")
si = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(si)


def _idx(**skills):
    return {"skills": skills}


def test_title_has_no_package_semver():
    """标题里只能有一个版本号——前缀的整体号。包自己的 semver 不进标题。

    回归的是实测那条：「v4.2.0：都爆鸭 · 新媒体数据总入口 4.5.0——只认 http(s)」，
    一个标题两个号，读的人要先分辨哪个是这一版。
    """
    idx = _idx(a={"status": "active", "displayName": "甲包", "versions": [
        {"version": "4.5.0", "ref": "r1", "hash": "h1", "changelog": "把一件正经事说清楚，细节在后面"},
        {"version": "4.4.0", "ref": "r0", "hash": "h0", "changelog": "零"}]})
    title = si.build_title(idx, "r1", si.packages_of(idx, "r1"), "v4.2.0")
    assert title.startswith("v4.2.0：")
    assert "4.5.0" not in title


def test_first_clause_truncates_long_lead_instead_of_falling_to_fragments():
    """第一段超长时截断它自己，不能跳到后面的碎片去。

    实测 dby-api 4.5.0：主线 42 字刚过 limit 被跳过，标题取到了第三段
    「只认 http(s)」——一个协议校验细节冒充了整版主题。
    """
    text = ("只能走代理出网的机器（受管企业网、CI 容器、agent 沙箱）现在不用改环境就能用："
            "请求层按 HTTP(S)_PROXY / ALL_PROXY 走代理、遵守 NO_PROXY，只认 http(s)，"
            "socks 显式报错不静默回落。没配代理时行为一字不变")
    got = si.first_clause(text)
    assert got.startswith("只能走代理出网的机器")
    assert "只认 http" not in got


def test_first_clause_still_skips_too_short_fragments():
    """太短的碎片仍要跳过——否则 dby-feedback 会得到「首版——三类反馈…」双破折号标题。"""
    assert si.first_clause("首版——三类反馈现场成文，端点不通就落本地") == "三类反馈现场成文"


def test_first_clause_drops_dangling_paren_but_keeps_closed_one():
    """切分/截断劈开括号时剥掉半拉的；闭合的 http(s) 原样留着。"""
    assert si.first_clause("出图改按模型分档计价（三档，按 modelName 选") == "出图改按模型分档计价"
    assert si.first_clause("代理只认 http(s)，socks 显式报错") == "代理只认 http(s)"


def test_first_clause_drops_examples_before_truncating():
    """放不下时先扔括号里的举例，扔完够长就不该再出现省略号。"""
    got = si.first_clause("只能走代理出网的机器（受管企业网、CI 容器、agent 沙箱）现在不用改环境就能用：请求层按 ALL_PROXY 走代理")
    assert got == "只能走代理出网的机器现在不用改环境就能用"
