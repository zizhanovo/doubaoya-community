"""dby-deai/scripts/deai.py 的脚本层判据（design.md D10 第一层，首版基线复查 6.2）。

🔴 为什么补这层（2026-08-31 首版基线的账，别删）：
  agent 用例 deai-detect-only-default 的 check 原先打 output.txt（agent 的最终文本），
  3 轮挂 2 轮——那是 D10 实锤过的失效模式：agent 摘要每次措辞都变，钉摘要就是钉沙子。
  而 deai.py 是纯本地确定性脚本（不联网、不计费、自带 --selfcheck），检测结果本来就在
  tools.txt（事件流里的工具结果）里。修法两步：agent 层的 check 改打 tools.txt；
  确定性判据（检出什么、不误报什么）按 D10 下沉到这里，免费零抖动。
  下沉后 agent 层只留「只体检不改写」「拒绝论文降 AIGC」「拒绝删 AI 声明」这类
  只有 agent 才判得了的编排与红线判断。

分工边界（写断言前读过脚本源码）：
  · 脚本只给**位置和密度**（哪一句、哪一族、每千字多少），改不改由 agent 对照
    references/病灶清单.md 判断——所以「聚簇 vs 孤证」「豁免例」留在 agent 层；
  · 脚本**不输出 AI 率分数**（docstring 红线：检测器把老舍判 99.9% AI）——这里钉住
    输出里不存在任何分数字段，agent 层对应的 check 是「回答里不许编一个分数」；
  · 脚本不改稿，「改写保护事实」是 agent 的活，脚本层只能钉「具体度指标如实统计」。
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[2] / "skills" / "dby-deai" / "scripts" / "deai.py"
_SPEC = importlib.util.spec_from_file_location("deai", _SCRIPT)
deai = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(deai)

# agent 用例 deai-detect-only-default 的原文——脚本层用同一段文本钉住：
# 那条用例改打 tools.txt 的两条 grep，是有确定性脚本行为背书的，不是碰运气。
CASE_TEXT = (
    "在当今这个信息爆炸的时代，内容创作面临前所未有的挑战。"
    "值得注意的是，优秀的创作者不是天赋异禀，而是方法得当。"
    "首先要洞察需求，其次要打磨表达，此外还要持续输出。"
    "总之，未来可期，让我们拭目以待。"
)

# agent 用例 deai-no-false-positive-on-human-text 的原文（人写的、满是具体事实）
HUMAN_TEXT = (
    "上周三下午我在公司楼下等了 40 分钟。那台咖啡机坏了，修的人说主板烧了，"
    "换一块 380 块，我说算了。回工位路上想起去年也是这台机器，那次是水泵。"
    "后来我们买了挂耳。"
)


# ---------------------------------------------------------------- AI 味模式的检出

def test_agent用例原文_套话与对比句与结尾升华全部检出():
    """deai-detect-only-default 改打 tools.txt 的两条 grep 各自的机器基准：
    「值得注意的是」在套话命中里、「不是…而是」在否定式对比里、「未来可期」在结尾升华里。"""
    r = deai.scan(CASE_TEXT)
    assert any(h["命中"] == "值得注意的是" for h in r["套话连接词"])
    assert any("不是" in h["片段"] and "而是" in h["片段"] for h in r["否定式对比"])
    assert "未来可期" in r["结尾升华"]
    assert r["公式化开头"] == ["在当今"]           # 「在当今这个…」公式化开头
    # 首先/其次/此外 三连也是套话族——密度信号，同族多处命中
    cliche_hits = {h["命中"] for h in r["套话连接词"]}
    assert {"首先", "其次", "此外"} <= cliche_hits


def test_渲染报告含检出内容_tools_txt_grep有据可依():
    """agent 跑 `python3 deai.py 稿件.md` 时 stdout 进 tools.txt——
    渲染文本里必须能 grep 到那两条 check 打的字符串（与 --json 两种形态都成立）。"""
    for extra in ([], ["--json"]):
        p = subprocess.run([sys.executable, str(_SCRIPT), "-", *extra],
                           input=CASE_TEXT, capture_output=True, text=True, timeout=30)
        assert p.returncode == 0, p.stderr
        assert "值得注意的是" in p.stdout
        assert "未来可期" in p.stdout
        # 「不是…而是」以片段形式出现（rendered 的命中行 / json 的 片段 字段）
        assert "不是天赋异禀，而是方法得当" in p.stdout


def test_json输出是合法JSON且句号可定位():
    p = subprocess.run([sys.executable, str(_SCRIPT), "-", "--json"],
                       input=CASE_TEXT, capture_output=True, text=True, timeout=30)
    r = json.loads(p.stdout)
    hit = next(h for h in r["套话连接词"] if h["命中"] == "值得注意的是")
    assert isinstance(hit["句"], int) and hit["句"] >= 1     # 报告能让人翻到那一句
    assert hit["片段"]                                        # 且带原文片段


# ---------------------------------------------------------------- 不误报人写的文本

def test_人稿不被误报_套话对比开头升华全为空():
    r = deai.scan(HUMAN_TEXT)
    assert not r["套话连接词"], r["套话连接词"]
    assert not r["否定式对比"], r["否定式对比"]
    assert not r["公式化开头"]
    assert not r["结尾升华"]
    assert not r["虚假范围"]


def test_短对话不算连续同长句():
    """「行吧。」「知道了。」天然一样长，那不是 AI 味（脚本的 floor 阈值钉住这点）。"""
    assert not deai.scan("行吧。知道了。走吧。")["连续同长句"]


def test_URL里的百分号不计入百分比():
    assert deai.scan("见 https://x.com/a%E4%BD%A0 这篇。")["具体度"]["百分比"] == 0


# ---------------------------------------------------------------- 事实保护（具体度如实统计）

def test_具体度指标如实统计_人稿数字多于AI稿():
    """脚本不改稿，「保护事实」在脚本层的可测形态是：数字/第一人称这些事实密度信号
    被如实统计——agent 改写时「逐字符不动保护区间」靠它做前后对照。"""
    human, slop = deai.scan(HUMAN_TEXT), deai.scan(CASE_TEXT)
    assert human["具体度"]["数字字符"] >= 5        # 40 / 380 都在
    assert human["具体度"]["第一人称"] >= 2        # 「我」如实计数
    assert human["具体度"]["数字字符"] > slop["具体度"]["数字字符"]


def test_输出不含任何AI率或评分字段():
    """docstring 红线：本脚本不输出 AI 率分数。agent 层的 check
    （output.txt 里不许出现「AI 味指数: 42」这类）之所以成立，前提是脚本先不给。"""
    r = deai.scan(CASE_TEXT)
    for absent in ("评分", "得分", "AI率", "AI 率", "指数", "score", "rating"):
        assert absent not in r, f"报告里冒出了分数类字段：{absent}"
    rendered = deai.render(r)
    # 渲染文本里唯一允许提到「分数」的位置是那句免责声明（明说不给分数）
    assert "不给 AI 率分数" in rendered


# ---------------------------------------------------------------- 边界与接线

def test_空输入不炸():
    r = deai.scan("")
    assert r["字数"] == 0 and r["句长"]["均值"] == 0


def test_selfcheck_离线自检退出0():
    """同 test_check_multi 的约定：自带断言没人跑 == 不存在。"""
    p = subprocess.run([sys.executable, str(_SCRIPT), "--selfcheck"],
                       capture_output=True, text=True, timeout=30)
    assert p.returncode == 0, p.stderr
    assert "selfcheck ok" in p.stdout
