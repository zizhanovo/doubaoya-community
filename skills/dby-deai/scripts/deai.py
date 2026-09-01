#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""去 AI 味体检：把「一眼 AI」的位置和密度找出来，交给人和模型判断该不该改。

只用标准库，不联网。用法：

    python3 deai.py 稿件.md                      # 人读的报告
    cat 稿件.md | python3 deai.py -              # 从 stdin 读
    python3 deai.py 稿件.md --json               # 机器读
    python3 deai.py --make-baseline 范文/*.md    # 从作者范文产出他自己的基线
    python3 deai.py 稿件.md --baseline 基线.json  # 拿作者基线当尺子，而不是通用阈值
    python3 deai.py 稿件.md --profile deai-偏好.md # 按沉淀下来的豁免词跳过误报
    python3 deai.py --selfcheck                  # 离线自检

🔴 本脚本**不输出 AI 率分数**。检测器把老舍《林海》判 99.9% AI、把美国宪法判「likely
entirely by AI」，OpenAI 自家分类器因真阳性率 26% 下架（依据见 docs/research/dby-deai/）。
分数会把注意力从「哪一句该改」引到「数字降没降」，那是给不可信的裁判打工。
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys

# ── 词表：每条都是「密度信号」，不是禁用词 ────────────────────────────────────
# 单个词命中不算证据——真人也说「首先」。判据是同一族在千字内反复出现（见 references/病灶清单.md）。

CLICHE = [  # 套话连接词：AI 的关节润滑剂
    "值得注意的是", "需要注意的是", "值得一提的是", "综上所述", "总而言之", "总的来说",
    "总的来看", "由此可见", "毋庸置疑", "不可否认", "众所周知", "换句话说", "在此基础上",
    "与此同时", "一方面", "另一方面", "首先", "其次", "再次", "此外", "然而", "因此",
]

JARGON = [  # 公文腔／办公室浓汤：中文语料里公文新闻占比高，模型学了个够
    "赋能", "抓手", "闭环", "底层逻辑", "顶层设计", "深度融合", "有效提升", "持续发力",
    "进一步", "切实", "大力推进", "全方位", "多维度", "系统性地", "旨在", "鉴于",
]

INFLATED = [  # 重要性通胀：把什么都说成大事
    "里程碑", "深远影响", "重新定义", "革命性", "颠覆", "划时代", "开启了新的篇章",
    "至关重要", "不可或缺", "极具", "无疑是", "堪称", "前所未有", "崭新的",
]

OPENING = [  # 公式化开头
    "在当今", "在这个", "随着", "如今", "近年来",
]

ENDING = [  # 结尾升华：每段必收束、结尾必总结
    "总之", "综上", "归根结底", "说到底", "未来可期", "让我们", "值得我们", "共勉",
    "才是真正的", "拭目以待", "任重道远",
]

TRANSITION = [  # 程式化过渡句：把两段之间的缝隙用固定说法糊住
    "一个自然的追问是", "说到这里", "回到最初的问题", "不难发现", "接下来我们",
    "让我们来看", "这就引出了", "问题来了", "值得思考的是", "换个角度看",
]

CLOSER = (  # 段末收束句的起手式：每段都要把本段总结一遍
    "因此", "所以", "可见", "由此可见", "这说明", "这就是", "归根结底",
    "总的来说", "换句话说", "这意味着",
)

FORECAST = ("本文", "下面", "接下来", "这篇文章", "我将", "我会先")  # 首段预告全文

CONTRAST = [  # 否定式对比：AI 最出名的句式口癖
    (r"不是[^，。！？；\n]{1,24}[，,]?\s*而是", "不是A，而是B"),
    (r"并非[^，。！？；\n]{1,24}[，,]?\s*而是", "并非A，而是B"),
    (r"不仅[^，。！？；\n]{1,24}[，,]?\s*(?:而且|更是|更|还|也)", "不仅A，而且B"),
    (r"与其说[^，。！？；\n]{1,24}[，,]?\s*不如说", "与其说A，不如说B"),
    (r"不只是[^，。！？；\n]{1,24}[，,]?\s*(?:而是|更是)", "不只是A，更是B"),
]

# 三段式排比：三个 2–10 字的并列项串在一起；末项常用「和 / 与 / 以及」收口
_ITEM = r"[^，。！？；、和与\s\d]{2,10}"
TRICOLON = re.compile(rf"{_ITEM}、{_ITEM}(?:、|和|与|以及){_ITEM}")

# 「如果说 A，那么 B」式过渡
CONDITIONAL_BRIDGE = re.compile(r"如果说[^，。！？；\n]{1,30}[，,]\s*(?:那么|则|就)")

# 虚假范围
FAKE_RANGE = re.compile(r"从[^，。！？；\n]{1,16}到[^，。！？；\n]{1,16}[，,]?\s*(?:无不|都|均|统统|全都)")

SENTENCE = re.compile(r"[^。！？!?；;…\n]+[。！？!?；;…]*")
CODE_FENCE = re.compile(r"```.*?```", re.S)
URL = re.compile(r"https?://\S+")
BOLD = re.compile(r"\*\*[^*\n]+\*\*")
LIST_LINE = re.compile(r"^\s*(?:[-*+]|\d+[.、)])\s+")
HEADING = re.compile(r"^\s*#{1,6}\s+")
DIGIT = re.compile(r"\d")


def _strip_noise(text: str) -> str:
    """代码块和 URL 不是文风，扫描前剔掉。

    URL 尤其要剔：转义过的链接里满是 `%`，不剔的话「百分比」这项会凭空多出几百个。
    """
    return URL.sub(" ", CODE_FENCE.sub("\n", text))


def split_sentences(text: str) -> list[str]:
    return [m.group(0).strip() for m in SENTENCE.finditer(text) if m.group(0).strip()]


def split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _locate(sentences: list[str], needle_re: re.Pattern) -> list[dict]:
    """逐句找命中，返回句号 + 片段——报告要能让人直接翻到那一句。"""
    hits = []
    for index, sentence in enumerate(sentences, 1):
        for match in needle_re.finditer(sentence):
            hits.append({"句": index, "命中": match.group(0), "片段": sentence[:60]})
    return hits


def _word_hits(sentences: list[str], words: list[str]) -> list[dict]:
    pattern = re.compile("|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)))
    return _locate(sentences, pattern)


def _first_body(paragraphs: list[str]) -> str:
    """标题行不是开头，跳过它——否则「# 标题」会把首句挡住。"""
    for paragraph in paragraphs:
        if not HEADING.match(paragraph):
            return paragraph
    return ""


def _closer_paragraphs(paragraphs: list[str]) -> list[dict]:
    """每段最后一句都在总结本段——单段不算，成片才算。"""
    hits = []
    for index, paragraph in enumerate(paragraphs, 1):
        if HEADING.match(paragraph) or len(paragraph) < 30:
            continue
        sentences = split_sentences(paragraph)
        if sentences and sentences[-1].lstrip("*_> ").startswith(CLOSER):
            hits.append({"段": index, "命中": sentences[-1][:40], "片段": sentences[-1][:60]})
    return hits


def _symmetric_headings(lines: list[str]) -> list[str]:
    """同一个标题生成器批量产出的小标题：三个以上共享同一个模子。"""
    titles = [HEADING.sub("", line).strip().strip("*") for line in lines if HEADING.match(line)]
    titles = [x for x in titles if len(x) >= 3]
    if len(titles) < 3:
        return []
    for take in (lambda s: s[:2], lambda s: s[-2:]):
        groups: dict[str, list[str]] = {}
        for title in titles:
            groups.setdefault(take(title), []).append(title)
        for shared, members in groups.items():
            if len(members) >= 3:
                return members
    return []


def _hollow_paragraphs(paragraphs: list[str]) -> list[dict]:
    """空洞候选：够长，却没有一个数字、引语或书名——「说了等于没说」的机器近似。

    只是候选，不是判决：抒情段、过渡段本来就没有这些。判断交给模型。
    """
    hits = []
    for index, paragraph in enumerate(paragraphs, 1):
        if HEADING.match(paragraph) or LIST_LINE.match(paragraph) or len(paragraph) < 60:
            continue
        if DIGIT.search(paragraph) or re.search(r"[「」“”《》\"]", paragraph):
            continue
        hits.append({"段": index, "命中": f"{len(paragraph)} 字无数字无引语", "片段": paragraph[:60]})
    return hits


def _even_length_runs(sentences: list[str], tolerance: int = 3, floor: int = 12) -> list[dict]:
    """连续同长句：句长均匀是共识特征里唯一能机械定位的那一半。

    只看 ≥floor 字的句子——「行吧。」和「知道了。」天然一样长，那不是 AI 味。
    """
    runs, current = [], []
    for index, sentence in enumerate(sentences, 1):
        length = len(sentence)
        if length < floor:
            current = []
            continue
        if current and max(max(x[1] for x in current), length) - min(min(x[1] for x in current), length) <= tolerance:
            current.append((index, length))
        else:
            current = [(index, length)]
        if len(current) >= 3:
            runs = [r for r in runs if r["起句"] != current[0][0]]
            runs.append({"起句": current[0][0], "止句": current[-1][0],
                         "句数": len(current), "字数区间": [min(x[1] for x in current), max(x[1] for x in current)]})
    return runs


def scan(text: str, exempt: frozenset = frozenset()) -> dict:
    body = _strip_noise(text)
    sentences = split_sentences(body)
    paragraphs = split_paragraphs(body)
    lines = body.splitlines()
    plain = re.sub(r"\s+", "", body)
    scale = max(len(plain), 1) / 1000  # 每千字密度的分母

    lengths = [len(s) for s in sentences]
    contrast = []
    for pattern, label in CONTRAST:
        for hit in _locate(sentences, re.compile(pattern)):
            contrast.append({**hit, "句式": label})

    tail = paragraphs[-1] if paragraphs else ""
    ending_hits = [w for w in ENDING if w in tail]

    report = {
        "字数": len(plain),
        "句数": len(sentences),
        "段数": len(paragraphs),
        "句长": {
            "均值": round(statistics.fmean(lengths), 1) if lengths else 0,
            "标准差": round(statistics.pstdev(lengths), 1) if len(lengths) > 1 else 0,
            "最短": min(lengths) if lengths else 0,
            "最长": max(lengths) if lengths else 0,
        },
        "连续同长句": _even_length_runs(sentences),
        "套话连接词": _word_hits(sentences, CLICHE),
        "公文腔": _word_hits(sentences, JARGON),
        "通胀大词": _word_hits(sentences, INFLATED),
        "否定式对比": contrast,
        "三段式并列": _locate(sentences, TRICOLON),
        "虚假范围": _locate(sentences, FAKE_RANGE),
        "程式化过渡": _word_hits(sentences, TRANSITION) + _locate(sentences, CONDITIONAL_BRIDGE),
        "每段收束": _closer_paragraphs(paragraphs),
        "对称小标题": _symmetric_headings(lines),
        "空洞候选段": _hollow_paragraphs(paragraphs),
        "首段预告": [w for w in FORECAST if _first_body(paragraphs).startswith(w)],
        "公式化开头": [w for w in OPENING if _first_body(paragraphs).startswith(w)],
        "结尾升华": ending_hits,
        "标点": {
            "破折号": body.count("——"),
            "全角冒号": body.count("："),
        },
        "格式": {
            "加粗": len(BOLD.findall(body)),
            "清单行": sum(1 for line in lines if LIST_LINE.match(line)),
            "小标题": sum(1 for line in lines if HEADING.match(line)),
            "总行数": sum(1 for line in lines if line.strip()),
        },
        "具体度": {
            "数字字符": len(DIGIT.findall(body)),
            "第一人称": body.count("我"),
            "百分比": body.count("%") + body.count("％"),
        },
    }
    if exempt:
        dropped = 0
        for key in ("套话连接词", "公文腔", "通胀大词", "程式化过渡"):
            kept = [h for h in report[key] if h["命中"] not in exempt]
            dropped += len(report[key]) - len(kept)
            report[key] = kept
        for key in ("结尾升华", "首段预告"):
            kept = [w for w in report[key] if w not in exempt]
            dropped += len(report[key]) - len(kept)
            report[key] = kept
        report["已豁免"] = dropped

    report["每千字"] = {
        "套话连接词": round(len(report["套话连接词"]) / scale, 1),
        "公文腔": round(len(report["公文腔"]) / scale, 1),
        "通胀大词": round(len(report["通胀大词"]) / scale, 1),
        "否定式对比": round(len(contrast) / scale, 1),
        "三段式并列": round(len(report["三段式并列"]) / scale, 1),
        "程式化过渡": round(len(report["程式化过渡"]) / scale, 1),
        "破折号": round(report["标点"]["破折号"] / scale, 1),
        "数字字符": round(report["具体度"]["数字字符"] / scale, 1),
    }
    return report


BASELINE_KEYS = ("套话连接词", "公文腔", "通胀大词", "否定式对比", "三段式并列", "程式化过渡", "破折号")


def make_baseline(reports: list[dict]) -> dict:
    """把作者的范文压成一条基线：他自己平时就这么写，那就是他的常态。

    这是本脚本唯一诚实的阈值来源——中文侧没有任何公开的实证阈值（见 references/病灶清单.md），
    拿通用数字卡人只会误伤。作者自己的基线没有这个问题。
    """
    total = sum(r["字数"] for r in reports) or 1
    per_k = {}
    for key in BASELINE_KEYS:
        weighted = sum(r["每千字"][key] * r["字数"] for r in reports)
        per_k[key] = round(weighted / total, 2)
    lengths = [r["句长"] for r in reports]
    return {
        "样本篇数": len(reports),
        "总字数": total,
        "每千字": per_k,
        "句长": {
            "均值": round(sum(x["均值"] * r["字数"] for x, r in zip(lengths, reports)) / total, 1),
            "标准差": round(sum(x["标准差"] * r["字数"] for x, r in zip(lengths, reports)) / total, 1),
        },
    }


def load_exempt(path: str) -> frozenset:
    """从 deai-偏好.md 的「## 豁免」一节读用户否掉过的词，一行一个 `- 词`。"""
    text = open(path, encoding="utf-8").read()
    section = re.search(r"^##+\s*豁免.*?$(.*?)(?=^##+\s|\Z)", text, re.M | re.S)
    if not section:
        return frozenset()
    return frozenset(
        m.group(1).strip().strip("「」`")
        for m in re.finditer(r"^\s*[-*]\s+(.+?)\s*$", section.group(1), re.M)
    )


def render_baseline(report: dict, baseline: dict) -> str:
    """稿件 vs 作者基线。只报**高出**的项，且不给判决。"""
    out = [f"### 对照作者基线（{baseline['样本篇数']} 篇 / {baseline['总字数']} 字）"]
    flagged = False
    for key in BASELINE_KEYS:
        mine, base = report["每千字"][key], baseline["每千字"][key]
        if mine <= max(base * 2, base + 1.0):
            continue
        flagged = True
        ratio = f"{mine / base:.1f}×" if base else "基线为 0"
        out.append(f"- **{key}** 每千字 {mine}，你平时 {base}（{ratio}）")
    if not flagged:
        out.append("- 各族密度都在你平时的范围内。")
    ml, bl = report["句长"], baseline["句长"]
    out.append(f"- 句长 均值 {ml['均值']} / 标准差 {ml['标准差']}，你平时 {bl['均值']} / {bl['标准差']}"
               "（标准差明显低于平时 = 节奏被抹平了）")
    out.append("")
    return "\n".join(out)


def render(report: dict, baseline: dict | None = None) -> str:
    out = []
    add = out.append
    add(f"## 体检：{report['字数']} 字 / {report['句数']} 句 / {report['段数']} 段")
    length = report["句长"]
    add(f"句长 均值 {length['均值']} · 标准差 {length['标准差']} · 区间 {length['最短']}–{length['最长']}"
        "（无中文实证阈值，改写前后对照着看）")
    add("")
    if baseline:
        add(render_baseline(report, baseline))

    def section(title: str, hits: list, per_k: float | None = None, limit: int = 8):
        if not hits:
            return
        head = f"### {title}：{len(hits)} 处"
        if per_k is not None:
            head += f"（每千字 {per_k}）"
        add(head)
        for hit in hits[:limit]:
            if isinstance(hit, dict) and "句" in hit:
                mark = hit.get("句式") or hit["命中"]
                add(f"- 第 {hit['句']} 句 · 「{mark}」 · {hit['片段']}")
            else:
                add(f"- {hit}")
        if len(hits) > limit:
            add(f"- …另有 {len(hits) - limit} 处")
        add("")

    per = report["每千字"]
    section("套话连接词", report["套话连接词"], per["套话连接词"])
    section("公文腔", report["公文腔"], per["公文腔"])
    section("通胀大词", report["通胀大词"], per["通胀大词"])
    section("否定式对比句", report["否定式对比"], per["否定式对比"])
    section("三段式并列", report["三段式并列"], per["三段式并列"])
    section("虚假范围", report["虚假范围"])
    section("程式化过渡句", report["程式化过渡"], per["程式化过渡"])
    section("每段都在收束", report["每段收束"])
    section("空洞候选段（够长但没有数字与引语，要不要补事实由你判断）", report["空洞候选段"])
    if report["对称小标题"]:
        add(f"### 对称小标题：{len(report['对称小标题'])} 个共享同一个模子")
        for title in report["对称小标题"][:6]:
            add(f"- {title}")
        add("")

    runs = report["连续同长句"]
    if runs:
        add(f"### 连续同长句：{len(runs)} 段")
        for run in runs[:6]:
            add(f"- 第 {run['起句']}–{run['止句']} 句连着 {run['句数']} 句都是 {run['字数区间'][0]}–{run['字数区间'][1]} 字")
        add("")

    if report.get("已豁免"):
        add(f"（已按 deai-偏好.md 豁免 {report['已豁免']} 处）\n")
    if report["首段预告"]:
        add(f"### 首段预告全文：以「{report['首段预告'][0]}」起句\n")
    if report["公式化开头"]:
        add(f"### 公式化开头：首段以「{report['公式化开头'][0]}」起句\n")
    if report["结尾升华"]:
        add(f"### 结尾升华：末段命中 {'、'.join(report['结尾升华'])}\n")

    punct, fmt, solid = report["标点"], report["格式"], report["具体度"]
    add(f"### 标点与格式\n- 破折号 {punct['破折号']}（每千字 {per['破折号']}）· 全角冒号 {punct['全角冒号']}")
    add(f"- 加粗 {fmt['加粗']} · 清单行 {fmt['清单行']}/{fmt['总行数']} · 小标题 {fmt['小标题']}")
    add(f"### 具体度\n- 数字字符 {solid['数字字符']}（每千字 {per['数字字符']}）· 百分比 {solid['百分比']} · 「我」{solid['第一人称']} 次")
    add("")
    add("以上是位置和密度，不是判决。逐条对 `references/病灶清单.md` 的豁免例过一遍再决定改不改；"
        "本脚本不给 AI 率分数。")
    return "\n".join(out)


def selfcheck() -> int:
    slop = (
        "在当今这个信息爆炸的时代，人工智能无疑是具有里程碑意义的技术。\n\n"
        "值得注意的是，它不是一个简单的工具，而是一种全新的生产力。"
        "首先，它能够赋能千行百业；其次，它重塑了底层逻辑；此外，它还带来了深远影响。"
        "从教育到医疗，从制造到金融，无不受到它的冲击。\n\n"
        "总之，未来可期，让我们拭目以待。"
    )
    human = (
        "上周三下午，我在公司楼下等了 40 分钟。\n\n"
        "那台咖啡机坏了。修的人说主板烧了，换一块 380 块。我说算了。"
        "回工位路上想起去年也是这台机器，那次是水泵。\n\n"
        "后来我们买了挂耳。"
    )
    bad, good = scan(slop), scan(human)

    assert bad["套话连接词"], "套话连接词该命中却没命中"
    assert bad["通胀大词"], "通胀大词该命中却没命中"
    assert bad["否定式对比"], "「不是A而是B」该命中却没命中"
    assert bad["虚假范围"], "「从X到Y无不」该命中却没命中"
    assert scan("需要三种能力：洞察力、表达力和执行力。")["三段式并列"], "「A、B和C」该算三段式"
    assert scan("# 标题\n\n在当今这个时代。")["公式化开头"] == ["在当今"], "标题行把首句挡住了"
    assert bad["公式化开头"] == ["在当今"], f"公式化开头判错：{bad['公式化开头']}"
    assert "未来可期" in bad["结尾升华"], "结尾升华该命中却没命中"
    assert bad["每千字"]["套话连接词"] > good["每千字"]["套话连接词"], "AI 稿的套话密度该高于人稿"

    assert not good["套话连接词"], f"人稿被误判出套话：{good['套话连接词']}"
    assert not good["否定式对比"], f"人稿被误判出对比句：{good['否定式对比']}"
    assert good["具体度"]["数字字符"] > bad["具体度"]["数字字符"], "人稿的数字该多于 AI 稿"

    # 短句不该被算进「连续同长句」——「行吧。」「知道了。」天然一样长
    chatter = scan("行吧。知道了。走吧。")
    assert not chatter["连续同长句"], f"短对话被误判为句长均匀：{chatter['连续同长句']}"

    assert bad["首段预告"] == [] and scan("本文将从三个方面展开。")["首段预告"] == ["本文"], "首段预告判错"
    assert scan("他每周三更，一更就是两年，中间搬过一次家也没断。因此，坚持本身就是一种能力。")["每段收束"], "段末收束句该命中"
    assert scan("## 不是钱的问题\n\n## 不是人的问题\n\n## 不是时间的问题\n")["对称小标题"], "对称小标题该命中"
    assert not scan("## 开头\n\n## 正文\n")["对称小标题"], "两个标题不该判成对称"
    assert bad["空洞候选段"], "AI 稿该有空洞候选段"
    assert not good["空洞候选段"], f"人稿被判成空洞：{good['空洞候选段']}"
    assert scan("如果说 A 验证了这一点，那么 B 就是佐证。")["程式化过渡"], "「如果说…那么」该命中"

    # 豁免：沉淀下来的词不再报
    assert not scan("首先，这很重要。", exempt=frozenset({"首先"}))["套话连接词"], "豁免词没生效"
    assert scan("首先，这很重要。", exempt=frozenset({"首先"}))["已豁免"] == 1, "豁免计数不对"

    # 基线：拿作者自己的常态当尺子
    line = make_baseline([good, scan(human)])
    assert line["样本篇数"] == 2 and line["总字数"] > 0, "基线聚合坏了"
    assert "套话连接词" in line["每千字"], "基线缺字段"

    # URL 里的 % 不该算成百分比
    assert scan("见 https://x.com/a%E4%BD%A0 这篇。")["具体度"]["百分比"] == 0, "URL 里的 % 被算进百分比了"

    # 空输入不许炸
    empty = scan("")
    assert empty["字数"] == 0 and empty["句长"]["均值"] == 0, "空输入没被安全处理"

    print("selfcheck ok：25 条断言全过（不联网、不需要 key）")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="去 AI 味体检：定位「一眼 AI」的位置与密度，不给分数")
    parser.add_argument("path", nargs="*", help="稿件路径；给 - 从 stdin 读。配 --make-baseline 时是范文列表")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--make-baseline", action="store_true",
                        help="把给的范文压成作者基线（JSON 打到 stdout），之后用 --baseline 当尺子")
    parser.add_argument("--baseline", metavar="基线.json",
                        help="拿作者自己的基线对照，而不是通用阈值")
    parser.add_argument("--profile", metavar="deai-偏好.md",
                        help="读「## 豁免」一节，跳过用户否掉过的词")
    parser.add_argument("--selfcheck", action="store_true", help="离线自检")
    args = parser.parse_args(argv)

    if args.selfcheck:
        return selfcheck()

    if args.make_baseline:
        if not args.path:
            parser.error("--make-baseline 要给至少一篇范文")
        reports = [scan(open(f, encoding="utf-8").read()) for f in args.path]
        print(json.dumps(make_baseline(reports), ensure_ascii=False, indent=2))
        return 0

    if not args.path:
        parser.error("给一个稿件路径，或用 - 从 stdin 读")

    exempt = load_exempt(args.profile) if args.profile else frozenset()
    text = sys.stdin.read() if args.path[0] == "-" else open(args.path[0], encoding="utf-8").read()
    report = scan(text, exempt)
    baseline = json.load(open(args.baseline, encoding="utf-8")) if args.baseline else None
    if args.json:
        if baseline:
            report["基线"] = baseline
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render(report, baseline))
    return 0


if __name__ == "__main__":
    sys.exit(main())
