"""dby-write 的写作规则必须跟着「本篇目标」与「手里的素材形态」走，而不是一套无条件的增长公式。

## 这道闸守的是什么

2026-08-25 之前，写作规则把**增长型公众号文的公式**写成了无条件必经：
标题必须「好奇缺口 / 颠覆认知 二选一」、留言是流程的一步、首句「不铺垫」。
结果实操教程也被推成营销腔 —— 最尖锐的自证是：一篇**真实已发布**的开发者教程
《开发将 Markdown 一键发布到微信公众号草稿工具的经验分享》，按旧规则会被判不通过，
因为它既不是好奇缺口也不是颠覆认知。

## 🔴 更隐蔽的那一半：伪场景是**绕过**红线一的，不是违反它

红线一原本只管「细节、数字、品牌事实不许生成」。而这类句子 ——

    「报告写到一半，要分析一份表格……刚准备继续，发现内置积分不够了」

**不含任何可核对的具体事实**（没有日期、没有数字、没有品牌承诺），
它靠**把具体性全部抽掉**合法通过了那条红线。而它正是 AI 腔最重的来源。
所以红线一必须有第二款，第 9 步自检必须把「场景」也纳入核对范围。

## ⚠️ 这道闸能做什么、不能做什么（诚实边界，别让它看起来能做到它做不到的事）

**能**：检查规则文本的存在性与一致性 —— 条件句是否真的绑定了目标、红线是否含两款、
三处判据的措辞是否一致、被证伪的旧表述是否已清除。

**不能**：检查 agent 是否**遵守**这些规则。规则是给 agent 读的散文，
遵守与否只能端到端观察，而单次观察不构成证据（本仓已实证：同一状态跑三次，
盲测结果会变）。⇒ 这道闸绿了只说明「规则写对了」，**不说明「AI 味下降了」**。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "skills" / "dby-write"


def _skill() -> str:
    return (PKG / "SKILL.md").read_text(encoding="utf-8")


def _refs() -> dict[str, str]:
    return {p.name: p.read_text(encoding="utf-8") for p in sorted((PKG / "references").glob("*.md"))}


def test_包在场() -> None:
    """🔴 元断言：包或 references 消失时，下面每条都会因为读到空串而误绿。"""
    assert (PKG / "SKILL.md").is_file(), "dby-write/SKILL.md 不在了"
    refs = _refs()
    assert len(refs) >= 6, f"references/ 只有 {len(refs)} 份，多半是路径解析退化了"
    assert len(_skill()) > 3000, "SKILL.md 太短，读到的可能不是真内容"


def test_缺口项绑定本篇目标而不是无条件() -> None:
    """本 change 的枢纽：缺口从「所有文章都要」收窄到「增长型才要」。

    🔴 判据必须同时满足两侧，只验一侧无法区分「规则跟着目标走」与「缺口项被整个删掉」：
      ① 条件句里同时出现目标与豁免（常青不强制）
      ② 缺口这个要求**仍然存在**（没有被删干净）
    """
    s = _skill()
    line = next((l for l in s.split("\n") if l.startswith("| 缺口 ")), None)
    assert line, "第 3 步自检表里找不到「缺口」那一行"

    assert "常青" in line, (
        "缺口项没有绑定本篇目标 —— 它仍然是无条件的。\n"
        "        真实反例：一篇已发布的开发者教程标题零悬念零颠覆，无条件的缺口项会把它判死。"
    )
    assert "不强制" in line or "不要求" in line, "常青档没有写明豁免"
    assert "好奇缺口" in line and "颠覆认知" in line, (
        "缺口这个要求本身消失了 —— 那不是收窄，是删除。\n"
        "        增长型（涨粉/变现）仍然需要它。"
    )


def test_常青豁免的是手段不是目标() -> None:
    """最可能的误读：把「常青不强制缺口」读成「常青不用管点开率」。"""
    s = _skill()
    assert "手段" in s and "目标" in s, "没有写明放宽的是手段不是目标"
    tbl = s[s.index("| 检查项 "):s.index("→ 标题写法清单")]
    for item in ("受众匹配", "搜索适配"):
        row = next((l for l in tbl.split("\n") if l.startswith(f"| {item} ")), None)
        assert row, f"自检表里找不到「{item}」"
        assert "常青" in row, (
            f"「{item}」这一项没有为常青档明确保留 —— 放宽缺口时很容易把它顺手一起放宽，"
            "而它正是防「谁都不点的老实标题」的那道防线"
        )


def test_素材形态是对材料的陈述不是对类别的归类() -> None:
    """2026-08-25 判据随搬迁改过：五取值的判别下沉 goals.md，主体只留 A/B 分野与指针。

    🔴 两头都要钉 —— 只核主体会漏掉「内容在搬家途中丢了」，只核 references 会漏掉
    「主体没留指针 ⇒ 能力被藏起来」。
    """
    s, refs = _skill(), _refs()
    assert "素材形态" in s, "第 3 步声明行没有「素材形态」"
    assert "A 组" in s and "B 组" in s, "主体没写清 A/B 分野 —— 那是每次都要判的"
    assert "goals.md" in s, "主体没留取判别的指针 ⇒ 五取值等于被藏了"
    g = refs["goals.md"]
    for v in ("可复现步骤", "带转折的真实经历", "并列多项", "可核实的具体事件", "被访者原话"):
        assert v in g, f"goals.md 里缺素材形态取值：{v}（搬迁途中丢了）"
    assert "谎报" in g or "谎报" in s, "没有写明自陈可以谎报、由素材单兜底"


def test_锚点处置阶梯三级有序且排除生成场景() -> None:
    """业内遇到素材缺口只有三种反应，没有第四种。

    2026-08-25 判据随搬迁改过：阶梯全文下沉 materials.md，主体留「停下」这个必经判断 + 指针。
    """
    s, refs = _skill(), _refs()
    assert "锚点" in s and "停下" in s, "主体没留「A 组拿不到锚点就停下」这个必经判断"
    assert "materials.md" in s, "主体没留取处置阶梯的指针 ⇒ 阶梯等于被藏了"
    seg = refs["materials.md"]
    # material-bank：阶梯升四档，「查素材库」排第一（免费零打扰，且查到也要向用户核实新鲜度）
    for k in ("先查素材库", "向用户要", "不需要第一人称", "改方向"):
        assert k in seg, f"materials.md 的处置阶梯缺一级：{k}"
    assert seg.index("先查素材库") < seg.index("向用户要"), "查素材库必须排在问用户之前（免费零打扰先行）"
    assert "还作数吗" in seg, "查到卡没有要求向用户核实新鲜度 —— 卡是快照，直接用会把过期事实写进正文"
    assert "不在这三条里" in seg or "不在选项" in seg, (
        "没有明确排除「先写个通用场景过渡」—— 那正是要堵的出口"
    )
    assert "三句话" in seg, "「向用户要」没有给可回答的具体问法，退化成了「请补充素材」"


def test_红线一是判据而不是枚举() -> None:
    """🔴 设计改过一次，这条断言跟着改了 —— 原方案是「补第二款」，实际正解是**枚举换判据**。

    伪场景之所以能绕过旧红线一，不是因为少了一款，是因为旧表述**枚举**了
    「细节/案例/数字/品牌事实」而漏掉了「场景」。补一款是把同一条判据讲两遍；
    换成判据（每一样具体东西都要能指出来源）一条讲完，更短也更准。
    """
    s, refs = _skill(), _refs()
    seg = s[s.index("### 红线一"):s.index("### 红线二")]

    # 🔴 判据必须钉在**那条枚举句**上，不能钉在整段上。
    #    2026-08-25 实测：把「场景」从枚举句里删掉（退回旧的枚举式，正是本 change 要修的病），
    #    而整段里「场景最容易漏」那句仍在 ⇒ `"场景" in seg` 照样为真 ⇒ **闸放行了**。
    #    断言在判，判的位置却不对 —— 收窄到承载判据的那一行。
    rule = next((l for l in seg.split("\n") if "每一样都必须能指回素材单" in l), None)
    assert rule, "红线一找不到那条「每一样都必须能指回素材单」的判据句"
    assert "场景" in rule, (
        "判据句里没有「第一人称场景」—— 伪场景正是从这个缺口漏的。\n"
        "        ⚠️ 别被下方「场景最容易漏」那句迷惑：那是补充说明，不是判据本身。"
    )
    assert "来源" in seg, "红线一没有落在「能不能指出来源」这个判据上"
    assert "不误伤" in seg, "没写不误伤边界 —— 没有它，这条会被读成「禁止一切场景描写」"
    assert "第二款" not in seg, (
        "红线一里还留着「第二款」的说法 —— 判据化之后不该再有两款之分，"
        "留着会让人以为有两条不同的规则"
    )
    assert "积分不够" in refs["materials.md"], "伪场景反例在搬迁途中丢了"


def test_自检把场景纳入来源核对() -> None:
    """场景最容易漏：它不含数字或品牌名，看着没什么可核对的就被跳过。"""
    s = _skill()
    row = next((l for l in s.split("\n") if "事实来源核对" in l), None)
    assert row, "第 9 步找不到「事实来源核对」"
    assert "场景" in row, "核对范围里没有「场景」—— 伪场景正是从这个缺口漏过去的"


def test_留言是可选的() -> None:
    s = _skill()
    seg = s[s.index("### 第 8 步"):s.index("### 第 9 步")]
    assert "可选" in seg, "留言仍被写成必经步骤"


def test_不铺垫已重定义为禁教科书式交代() -> None:
    craft = _refs()["craft.md"]
    assert "教科书" in craft, "「不铺垫」没有重定义 —— 按字面执行会与真实写法冲突"
    assert "在当今" in craft, "没有给出被禁的那类开头的具体例子"


def test_三处判据措辞一致() -> None:
    """🔴 素材形态、红线一第二款、首句钩住是**同一条判据的三次应用**。

    不显式点出来，三处会各自漂移 —— 本仓已实证「一份真相手抄多处」必然漂。
    """
    craft = _refs()["craft.md"]
    assert "同一条判据" in craft or "同一条" in craft, (
        "craft.md 没有点明它与红线一第二款、素材形态是同一条判据"
    )
    assert "可核对" in craft, "统一判据的措辞（可核对 vs 对谁都成立）不在"


def test_被证伪的旧表述已清除() -> None:
    """改了三份而另五份留着旧话，等于没改。"""
    docs = {"SKILL.md": _skill(), **_refs()}
    stale = []
    for name, t in docs.items():
        # 无条件的「二选一」：出现了但附近没有目标词
        for m in re.finditer(r"二选一", t):
            ctx = t[max(0, m.start() - 60):m.end() + 20]
            if not re.search(r"目标|涨粉|变现|常青", ctx):
                stale.append(f"{name}: 无条件的「二选一」")
        if re.search(r"留言.{0,12}必[须要]|必[须要].{0,12}留言", t):
            stale.append(f"{name}: 留言仍写成必做")
        if "不铺垫" in t:
            stale.append(f"{name}: 「不铺垫」字面表述未重定义")
    assert not stale, "旧表述残留：\n  " + "\n  ".join(stale)


def test_营销腔范例已换掉() -> None:
    docs = {"SKILL.md": _skill(), **_refs()}
    for name, t in docs.items():
        assert "你的死工资正在拖垮你" not in t, (
            f"{name} 仍拿营销腔标题当正面范例 —— 它本身就是要治的那种腔调"
        )


# ─────────────────────────────────────────────────────────────
# genre 手艺层（genre-craft-references）：六份体裁文件 + 字面替换路由
#
# 🔴 诚实边界：下面这几条只能保证「文件在、指针在、编的数字不在」，
#    **不能保证 agent 真去读**（按需读取无法在文本层强制），
#    也不能保证内容写得好（那需要真实产出对比）。别把绿灯读成后两者。
#
# ⚠️ 读中文文件名别用 `git ls-files | grep 中文` —— git 默认把非 ASCII 路径
#    输出成八进制转义（\345…），grep -c 会得 0 而文件其实在（实测踩过）。
#    统一用 pathlib.glob，不经 shell 转义。
# ─────────────────────────────────────────────────────────────

GENRE_DIR = PKG / "references" / "genre"

# 🔴 与 SKILL.md 第 3 步、goals.md 取值表同一套值。文件名必须逐字等于取值（设计 D7：
#    路由是字面替换 —— 声明近义改写 → file-not-found 响亮卡住；查表方案则静默错路由）。
MATERIAL_FORMS = (
    "可复现步骤", "并列多项", "可核实的具体事件",
    "待解释的现象或机制", "带转折的真实经历", "被访者原话",
)
GENRE_SECTIONS = ("这类文章长什么样", "动笔前必须有什么", "开头与结尾", "写砸的样子", "容易串到哪去")


def _genres() -> dict[str, str]:
    return {p.stem: p.read_text(encoding="utf-8") for p in GENRE_DIR.glob("*.md")}


def test_genre_六份都在且五节齐全() -> None:
    g = _genres()
    assert len(g) >= 6, f"genre/ 只扫到 {len(g)} 份，多半是目录解析退化了"  # 元断言防空跑
    for form in MATERIAL_FORMS:
        assert form in g, f"缺 references/genre/{form}.md —— 声明这个形态的 agent 会在第 5 步撞 file-not-found"
        body = g[form]
        assert len(body) > 800, f"{form}.md 太短（{len(body)} 字符），像是占位不是内容"
        for sec in GENRE_SECTIONS:
            assert f"## {sec}" in body, f"{form}.md 缺「{sec}」一节 —— 五节骨架统一了空缺才会显形"


def test_genre_双向路由_形态与文件一一对应() -> None:
    """🔴 只查一边会漏掉「多出一份没人指向的死文件」—— 一份没有形态指向它的文件与不存在等价。"""
    files = {p.stem for p in GENRE_DIR.glob("*.md")}
    forms = set(MATERIAL_FORMS)
    assert forms - files == set(), f"有形态没有文件：{sorted(forms - files)}"
    assert files - forms == set(), f"有文件没有形态指向它（死文件）：{sorted(files - forms)}"
    # 防本文件的常量自己漂：六个取值必须同时出现在 goals.md 的取值表里
    g = _refs()["goals.md"]
    for form in MATERIAL_FORMS:
        assert form in g, f"goals.md 取值表里没有「{form}」—— 三处取值（本常量 / SKILL.md / goals.md）漂了"
    assert "六取值" in g, "goals.md 的取值表标题没跟着改成六取值"


def test_genre_路由指针是字面模式且前置不可绕() -> None:
    s = _skill()
    assert "references/genre/<你声明的素材形态>.md" in s, (
        "主干没有字面替换路由 —— 六份 genre 文件等于被藏了（产物没进它唯一的入口）"
    )
    assert "没读不列提纲" in s, "第 5 步缺不可绕前置（设计 D9：分支文件不配硬闸等于白建）"
    assert "改声明" in s, "缺时序改判（第 4 步收完素材发现与声明不符 → 改声明，不许将错就错）"
    # 🔴 字面替换的完整性：主体不许内联任何一份的具体路径（那是对照表复活的第一步）
    for form in MATERIAL_FORMS:
        assert f"genre/{form}" not in s, f"主体出现了具体路径 genre/{form} —— 对照表在复活"
    # 第 3 步取值与 goals.md 六项逐项一致
    for form in MATERIAL_FORMS:
        assert form in s, f"SKILL.md 第 3 步取值缺「{form}」—— 与 goals.md 漂了"


def test_genre_不许出现无依据的效果数字() -> None:
    """调研两路独立印证：不存在带样本量的体裁效果数据 ⇒ 任何「N% / N 倍」都是编的。"""
    bad = []
    for form, body in _genres().items():
        for m in re.finditer(r"[0-9]+(?:\.[0-9]+)?%|[0-9]+ ?倍", body):
            bad.append(f"{form}.md: …{body[max(0, m.start()-20):m.end()+10]}…")
    assert not bad, "genre 文件出现效果数字（调研实证这类数据不存在，出现即编造）：\n  " + "\n  ".join(bad)


# ─────────────────────────────────────────────────────────────
# 素材库（material-bank）：接线与格式一致性
#
# 🔴 诚实边界：这几条只保证「表里有素材库层、阶梯先查库、提议句在主体、
#    文档示例的字段没漂」。**不保证 agent 真去查库**（按需读取无法在文本层强制），
#    不保证卡的内容质量，也不保证服务端行为（那在主仓 materials.routes.test.ts）。
# ─────────────────────────────────────────────────────────────

# 与主仓 materials.ts 的 validateCard 同一套字段。两处硬编码是刻意的（跨仓无法互读）：
# 服务端对不认识的字段/形态直接 400，是响的；本闸钉住文档示例不悄悄发明新字段。
CARD_FIELDS = {"proof", "kind", "event", "evidence", "forms", "label", "articleId"}
EVENT_FIELDS = {"time", "place", "outcome"}


def test_素材库层在素材表且提议句在主体() -> None:
    s = _skill()
    assert "素材库" in s, "第 4 步素材表没有素材库层 —— 服务端建好了但写作路径看不见（存了没人读）"
    assert "prep 已带索引" in s, "素材表没说明索引已随 prep 在场 —— agent 会以为要现取而永远想不起来"
    assert "确认才写" in s and "一次即止" in s and "连拒两次" in s, (
        "提议存卡的约束句不在主体 —— 约束要在 agent 不觉得自己需要指导时生效，住 references 等于不存在"
    )
    assert "七层" in s, "A 组停下判据没跟着素材表从六层改成七层 —— 层数漂了"


def test_素材卡文档示例字段与服务端契约一致() -> None:
    """materials.md / review-mode.md 里的 save 示例 JSON 不许发明服务端不认识的字段。"""
    import json as _json

    refs = _refs()
    found = 0
    for name in ("materials.md", "review-mode.md"):
        for m in re.finditer(r"material save '(\{.*?\})'", refs[name], re.S):
            found += 1
            card = _json.loads(m.group(1))
            extra = set(card) - CARD_FIELDS
            assert not extra, f"{name} 的 save 示例含服务端不认识的字段 {extra} —— 服务端会 400"
            assert set(card["event"]) == EVENT_FIELDS, f"{name} 示例的 event 三要素漂了：{set(card['event'])}"
            assert "proof" in card and "evidence" in card and "forms" in card, f"{name} 示例缺必填字段"
    assert found >= 2, f"只解析到 {found} 个 save 示例 —— 正则多半退化了（元断言防空跑）"


def test_素材单与阶梯接上了素材卡() -> None:
    seg = _refs()["materials.md"]
    assert "素材卡 #" in seg, "素材单出处枚举没有「素材卡 #id」—— 卡进正文就绕开了红线一的来源核对"
    assert "不用于任何模型训练" in seg, "skill 文档缺「不训练」承诺 —— 它是用户敢填素材层的信任前提"
    assert "material list" in seg and "material get" in seg, "阶梯没给查库的具体命令 —— 会退化成「建议查一下」"


def test_反馈卡措辞纪律在场() -> None:
    rm = _refs()["review-mode.md"]
    assert "相关不是因果" in rm, "反馈卡没标「相关非因果」—— 单篇归因会被当成规律"
    assert "仅供参考" in rm, "样本 < 5 的降级措辞缺失（与四象限基准同一条纪律）"
    assert "这个号自己的历史归因" in rm or "自己的历史归因" in rm, "没写明是本号历史归因、非普适规律"
    tp = _refs()["topic.md"]
    assert "不是普适规律" in tp, "选题侧没有反馈卡的措辞纪律 —— 读取端少一半"
