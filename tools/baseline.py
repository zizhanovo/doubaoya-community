#!/usr/bin/env python3
"""回归基线：让「这一版比上一版差了」成为可 diff 的事实，而不是靠人记。

文件位置：仓根 `evals/baseline.json`，**一份**，不每包一份（design.md D5）——
跨包看「哪些包这次没跑」一眼可见，一次 diff 看清整次发版的质量变化。
多包并行改动的合并冲突用稳定排序缓解：冲突会落在不同的行区间上。

条目键 =（skill 内容哈希 × runner 标识 × 模型标识），不用版本号（design.md D4）：
  - 版本号可以不变而内容变了（改 references 忘升版是常态），用它做键会指向错误的内容；
    内容哈希是现成的、被 known-hashes.json 与 dby-update 四态分类验证过的标识，
    🔴 直接复用 stamp_versions.compute_skill_hash，不新造一套。
  - runner 与模型一起进键：claude 判出来的和 pi 判出来的不是同一把尺子，
    混在一起比对会把「换了尺子」误读成「质量退步」。spec 要求的「不可比」
    就自然表现为「同包同类条目存在、但身份对不上」，见 compare()。
  - model / grader_model 一栏尽量记**实际用的模型**而非请求别名：pi 的 JSON 会在
    message_end 事件里回报实际 provider/model（实测 2026-08-31：不传 --model 时为
    deepseek / deepseek-v4-flash），claude/codex 拿不到实际值时退回记请求别名。
    来源由 model_source / grader_model_source 标明（"reported" = 实测值，
    "requested" = 请求值）——两种来源分字段可见，别名漂移（尺子悄悄换了）才查得出。

一个包按判据层各留一条条目（kind = triggers / cases / none）：
  triggers 的判定身份是（盲测 runner, 模型）；
  cases    的判定身份还要加上 grader（runner, 模型）——grader 换了尺子也就换了；
  none     给「两类判据都没有」的包留证据条目：质量门确实扫过这一版内容，
           缺口在判定报告里列出（spec：缺判据的包必须可见），CI 的离线校验
           只认「哈希有记录」，没有这条会把缺判据误读成「没跑质量门」。

逐用例结果的取值域见 RESULTS。规则要点：
  - 退步 = 基线 pass、本次 fail（spec 原文，flaky/unclear 都不算退步的证据）；
  - not_run（缺 DOUBAOYA_API_KEY 等前置）绝不记为通过，也绝不覆盖历史结果
    （design.md D7）——upsert() 里落实；
  - 含 unusable 的条目是**洞**，不构成有效证据（design.md D4b，2026-08-31 实测教训）：
    首版 --establish（243 条触发用例 × 3 轮、8 并发、30+ 分钟）把 dby-charter 判出
    18 条话术 14 条 unusable；单独重跑同一包 18/18 稳定、零不可用——洞是大并发撞
    限流的产物，不是包的缺陷。可怕的不是洞，是它悄无声息：CI 旧实现只查
    「(skill, hash) 有没有记录」（全文不含 unusable 字样），一条塞满 unusable 的
    条目照样放行；而比对里退步只认「基线 pass、本次 fail」，基线是 unusable 就
    永远比不出退步——那 14 条话术从此不受监控，且没有任何地方会红。
    看着覆盖了，其实没有。对策分两半：
      · 同哈希时用历史结果回填瞬时的 unusable（upsert 规则 2）——同一份内容上
        量过的数还作数，瞬时限流不许污染干净的基线；
      · 回填后仍留洞的条目**照写入**（洞在 diff 里明白可见），但 unusable_cases()
        把它标为洞：release_gate 点名并 exit 2 拒绝放行，check_baseline.py（CI）
        识别到洞即拦住发版。任何情况下不许出现「CI 放行了但有话术不受监控」。
  - 接受退步 MUST 附理由，理由与条目一并写入基线、随 diff 可见——accept() 里落实，
    这挡不住铁了心的人，但让「悄悄接受」变成留痕的动作（design.md Risks）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# 🔴 哈希必须复用盖戳那套（路径排序 + 文件名 + 内容，sha256 前 12 位），不新造：
#    known-hashes 闭集校验、dby-update 对账、CI 离线校验认的都是同一把尺子。
from stamp_versions import compute_skill_hash  # noqa: E402,F401

ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = ROOT / "evals" / "baseline.json"

SCHEMA = 1

# 逐用例结果的全部合法取值。pass/fail/unclear 与 case_bench 的稳定判定同名；
# flaky / unusable 是「稳定不下来 / 拿不到可信答案」的档，记录在案但不参与退步判定；
# 其中 unusable 还被视为**洞**（见 unusable_cases 与模块 docstring）：含洞的条目
# 不构成有效证据，release_gate 拒绝放行、CI（check_baseline.py）拦住发版。
# not_run 是「前置条件缺失，本次没跑」——绝不等于 pass，也绝不覆盖历史（D7）。
RESULTS = ("pass", "fail", "unclear", "flaky", "unusable", "not_run")

# 各 kind 的「判定身份」字段——身份不一致 ⇒ 不是同一把尺子 ⇒ 基线不可比。
IDENTITY_FIELDS = {
    "triggers": ("runner", "model"),
    "cases": ("runner", "model", "grader_runner", "grader_model"),
    "none": (),
}


def identity(entry: dict) -> tuple:
    """条目的判定身份。kind 不在表里就炸——静默容忍未知 kind 会让比对悄悄失真。"""
    return tuple(entry.get(f) for f in IDENTITY_FIELDS[entry["kind"]])


def unusable_cases(entry: dict) -> "list[str]":
    """条目里的**洞**：结果为 unusable（拿不到可信答案）的用例清单，排序稳定。

    洞的定义只在这里一处——release_gate（本地点名 + 拒绝放行）与 check_baseline
    （CI 拦发版）都复用它。为什么洞不算证据见模块 docstring 的实测教训：
    dby-charter 14/18 unusable 是 8 并发限流的产物，单独重跑 18/18 稳定；
    但基线里的 unusable 既过得了「有没有记录」的 CI 存在性检查，又永远比不出
    退步（退步只认「基线 pass、本次 fail」）——不拦住它，就是无声的监控盲区。"""
    return sorted(cid for cid, v in (entry.get("results") or {}).items() if v == "unusable")


# ---------------------------------------------------------------- 读写与稳定序列化

def load(path: Path = BASELINE_PATH) -> dict:
    """读基线；文件不存在返回空基线（首次运行的正常形态，不是错误）。"""
    if not path.exists():
        return {"schema": SCHEMA, "entries": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        # 读得动但解析不了 ⇒ 文件被改坏了。这时返回空基线会让下一次写入
        # **静默清掉全部历史**——宁可炸，让人去 git 里找回来。
        raise SystemExit(f"🔴 {path} 不是合法 JSON（{e}）——基线坏了别硬写，先从 git 恢复。")
    if not isinstance(data.get("entries"), list):
        raise SystemExit(f"🔴 {path} 缺 entries 数组——形状不对别硬写，先从 git 恢复。")
    return data


def _sort_key(e: dict) -> tuple:
    """稳定排序键：包名最前（D5——合并冲突落在不同行区间），再按 kind 与身份字段。
    None 用空串代位，triggers/none 条目没有 grader 字段也能排。"""
    return (e.get("skill") or "", e.get("kind") or "",
            *(str(e.get(f) or "") for f in ("runner", "model", "grader_runner", "grader_model")))


def dumps(data: dict) -> str:
    """稳定序列化：条目按包名排序、对象键排序、缩进固定、末尾换行。
    同样的结果两次写出必须字节一致（tasks 4.2）——否则「基线无变化」这句话
    没法用 diff 验证，发版 diff 里也会混进纯噪声行。"""
    payload = {"schema": data.get("schema", SCHEMA),
               "entries": sorted(data["entries"], key=_sort_key)}
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def save(data: dict, path: Path = BASELINE_PATH) -> bool:
    """写盘；内容与现状字节一致时不碰文件（返回 False）——
    「无退步的发版基线文件无变化」（tasks 5.1）靠这里成立。"""
    text = dumps(data)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


# ---------------------------------------------------------------- 查找与比对

def find(data: dict, skill: str, kind: str) -> "list[dict]":
    return [e for e in data["entries"] if e.get("skill") == skill and e.get("kind") == kind]


def match(data: dict, entry: dict) -> "dict | None":
    """按（包, kind, 判定身份）找同尺子的基线条目；找不到返回 None。"""
    for e in find(data, entry["skill"], entry["kind"]):
        if identity(e) == identity(entry):
            return e
    return None


def compare(data: dict, entry: dict) -> dict:
    """本次条目 vs 基线。三种结论，互斥：

    new          —— 基线里没有这个包这一层的任何条目（首次入册，不是退步也不是改进）；
    incomparable —— 有条目但 runner/模型身份对不上：**不是同一把尺子**，
                    此时 MUST NOT 输出退步或改进结论（spec「模型标识变化时基线
                    不可直接比较」），只能在当前身份下重建基线；
    ok           —— 同尺子，可比。退步 = 基线 pass、本次 fail（spec 原文；
                    本次 flaky/unclear/not_run 都不构成退步的证据——它们是
                    「定不下来 / 判不了 / 没跑」，不是「稳定失败」）。
                    改进 = 本次 pass 而基线不是 pass（含基线里没有这条用例）。
    """
    peers = find(data, entry["skill"], entry["kind"])
    if not peers:
        return {"status": "new"}
    old = match(data, entry)
    if old is None:
        return {"status": "incomparable",
                "want": identity(entry),
                "have": [identity(e) for e in peers]}
    old_r, new_r = old.get("results", {}), entry.get("results", {})
    regressions = sorted(cid for cid, v in old_r.items()
                         if v == "pass" and new_r.get(cid) == "fail")
    improvements = sorted(cid for cid, v in new_r.items()
                          if v == "pass" and old_r.get(cid) != "pass")
    return {"status": "ok", "old": old,
            "regressions": regressions, "improvements": improvements}


# ---------------------------------------------------------------- 写入规则

def upsert(data: dict, entry: dict) -> bool:
    """写入/替换一条条目，返回是否真的改了基线。规则按危险程度排：

    1. 全员 not_run ⇒ 整条不动（D7）：本次什么都没跑成，既没有新证据，
       也不许把哈希顶上去——哈希更新等于向 CI 作证「质量门对这版内容有结论」，
       而实际上没有。「跑不了 ≠ 通过」在基线侧就落在这一条。
    2. 内容没变（哈希相同）时，not_run 或本次缺席的用例保留历史结果——
       同一份内容上量过的数还作数（比如 costly 用例这次没选入）。
       内容变了（哈希不同）则不保留：旧结果量的是旧内容，搬过来是伪造证据。
    3. 哈希与逐用例结果都没变 ⇒ 不动（保留原 date）——否则每跑一次就刷一行
       日期噪声，「无退步时基线文件无变化」也不成立。
    4. 已接受退步的记录（accepted_regressions）随条目延续，除非调用方显式给了新列表。
    """
    old = match(data, entry)
    results = dict(entry.get("results", {}))
    if old is not None:
        if results and all(v == "not_run" for v in results.values()):
            return False  # 规则 1：未跑不覆盖历史
        if old.get("hash") == entry.get("hash"):
            for cid, v in old.get("results", {}).items():
                # 规则 2：同内容，历史结果作数。回填两种「本次没量到」：
                #   not_run  —— 本次没跑（如 costly 用例没选入）；
                #   unusable —— 本次跑了但拿不到可信答案。实测（2026-08-31）这多是
                #     大并发限流的瞬时产物（dby-charter 14/18 unusable，单独重跑
                #     18/18 稳定），不许让它覆盖同一份内容上已量到的有效结果。
                # 回填的是「同内容的旧有效测量」，不是把不可用洗成可用——
                # 没有历史可回填的洞会原样留在条目里，被 release_gate / CI 拦住。
                if results.get(cid, "not_run") in ("not_run", "unusable"):
                    results[cid] = v
        entry = dict(entry, results=results)
        if "accepted_regressions" not in entry and old.get("accepted_regressions"):
            entry["accepted_regressions"] = list(old["accepted_regressions"])  # 规则 4
        if (old.get("hash"), old.get("results"),
                old.get("accepted_regressions")) == (entry.get("hash"), entry.get("results"),
                                                     entry.get("accepted_regressions")):
            return False  # 规则 3：没变就不刷日期
        data["entries"][data["entries"].index(old)] = entry
        return True
    if results and all(v == "not_run" for v in results.values()):
        return False  # 首见的包全员未跑同样不入册——入册即向 CI 作证
    data["entries"].append(dict(entry, results=results))
    return True


def accept(entry: dict, case_ids: "list[str]", reason: "str | None", date: str) -> None:
    """把「显式接受的退步」写进条目。🔴 理由是硬门，不是礼貌：
    没有理由（或全空白）直接拒绝——spec 原文「接受退步 MUST 附理由」，
    这一条挡的是基线沦为橡皮图章（每次退步都无痕点过）。"""
    if not reason or not reason.strip():
        raise SystemExit("🔴 接受退步必须附理由（--reason），不带理由的接受被拒绝。")
    recs = entry.setdefault("accepted_regressions", [])
    for cid in case_ids:
        recs.append({"case": cid, "reason": reason.strip(), "date": date})
