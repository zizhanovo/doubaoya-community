#!/usr/bin/env python3
"""明星切片 QA 机检：对 EDL 草稿做 12 项机械检查，输出机检清单 JSON。

fail 级 7 项（必须清零才能交付）：
  1 片段存在  2 源视频存在  3 时间区间合法  4 不超出源视频时长
  5 源区间不重叠  6 段内清洗 cuts 合法  7 clip id 唯一
warn 级 5 项（人工复核，不拦交付）：
  8 无过短碎片（含清洗后净时长）  9 切点贴合气口（附能量标注）
  10 cuts 贴字边界  11 字级时间戳回验  12 总时长与溯源字段

阈值全部读 ../references/rules.json（breath_rule/clean_rule/energy_rule），不硬编码。
纯逻辑（run_checks）与 ffprobe 探测（probe_duration）分离，纯逻辑可离线测试。

用法:
    python3 validate_edl.py --edl edl.json --asr words.json --video source.mp4 \
        [--energy energy.json] [--rules rules.json] [--out report.json]

退出码：0 = fail 清零；1 = 存在 fail 项。
"""
import argparse
import json
import math
import os
import subprocess
import sys


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def unwrap_edl(doc):
    """兼容 snap_breath.py --apply 的输出信封：回写后的 EDL 在 edl 子键下，
    顶层 clips 是吸附报告行（无 id / 无 cuts / 坐标未吸附）。直传 edl_snapped.json
    也能取到正确的 EDL，不必手工拆子对象。"""
    if isinstance(doc, dict):
        inner = doc.get("edl")
        if isinstance(inner, dict) and isinstance(inner.get("clips"), list):
            return inner
    return doc


def load_edl(path: str):
    with open(path, encoding="utf-8") as f:
        return unwrap_edl(json.load(f))


def normalize_clip(c: dict) -> dict:
    """EDL clip 归一化：数值取整到毫秒、补齐溯源字段、清洗 cuts。"""
    out = {
        "id": str(c.get("id") or c.get("clip_id") or ""),
        "source_start": round(float(c.get("source_start", 0)), 3),
        "source_end": round(float(c.get("source_end", 0)), 3),
        "selection_reason": str(c.get("selection_reason", "")),
        "selling_point": str(c.get("selling_point", "")),
        "visual_point": str(c.get("visual_point", "")),
        "risk_note": str(c.get("risk_note", "")),
    }
    if c.get("signal_level") is not None:
        try:
            lv = int(c["signal_level"])
            if 1 <= lv <= 6:
                out["signal_level"] = lv
        except (TypeError, ValueError):
            pass
    if isinstance(c.get("cuts"), list):
        cuts = []
        for x in c["cuts"]:
            if not isinstance(x, dict):
                continue
            try:
                cs, ce = round(float(x["start"]), 3), round(float(x["end"]), 3)
            except (KeyError, TypeError, ValueError):
                continue
            cuts.append({"start": cs, "end": ce, "reason": str(x.get("reason", ""))})
        cuts.sort(key=lambda x: (x["start"], x["end"]))
        if cuts:
            out["cuts"] = cuts
    return out


def check_clip_cuts(c: dict) -> list:
    """cuts 硬校验：须在 clip 区间内、end>start、互不重叠。返回错误列表。"""
    errs = []
    cuts = c.get("cuts") or []
    cid = c.get("id") or "?"
    s, e = c["source_start"], c["source_end"]
    for i, x in enumerate(cuts):
        if not x["end"] > x["start"]:
            errs.append("%s cuts[%d] 需 end > start（[%.3f,%.3f]）" % (cid, i, x["start"], x["end"]))
        if x["start"] < s - 0.001 or x["end"] > e + 0.001:
            errs.append("%s cuts[%d] [%.3f,%.3f] 越界（clip 区间 [%.3f,%.3f]）"
                        % (cid, i, x["start"], x["end"], s, e))
    for a, b in zip(cuts, cuts[1:]):
        if b["start"] < a["end"] - 0.001:
            errs.append("%s cuts 重叠：[%.3f,%.3f] ↔ [%.3f,%.3f]"
                        % (cid, a["start"], a["end"], b["start"], b["end"]))
    return errs


def clip_keep_ranges(c: dict) -> list:
    """clip 区间减去 cuts 后的保留区间 [(start,end)]（忽略非法 cut 的越界部分）。"""
    s, e = c["source_start"], c["source_end"]
    ranges = []
    cur = s
    for x in sorted(c.get("cuts") or [], key=lambda x: (x["start"], x["end"])):
        a, b = max(cur, x["start"]), min(e, x["end"])
        if b <= a:
            continue
        if a - cur > 0.01:
            ranges.append((round(cur, 3), round(a, 3)))
        cur = max(cur, b)
    if e - cur > 0.01:
        ranges.append((round(cur, 3), round(e, 3)))
    return ranges or [(round(s, 3), round(e, 3))]


def clip_net_duration(c: dict) -> float:
    return round(sum(b - a for a, b in clip_keep_ranges(c)), 3)


def breath_boundaries(chars: list, rule: dict):
    """在词级时间戳上找气口。返回 (starts, ends)，chars 为空返回 None。
    starts=[(气口后第一字 start, 气口 gap 秒|None)]（入点候选，含媒体起点）
    ends  =[(气口前最后一字 end, 气口 gap 秒|None)]（出点候选，含媒体终点）
    gap=None 表示媒体边缘（前/后没有字）。"""
    if not chars:
        return None
    min_gap = float(rule["breath_gap_min_s"])
    starts, ends = [], []
    starts.append((float(chars[0]["start"]), None))
    for prev, cur in zip(chars, chars[1:]):
        gap = float(cur["start"]) - float(prev["end"])
        if gap >= min_gap:
            ends.append((float(prev["end"]), round(gap, 3)))
            starts.append((float(cur["start"]), round(gap, 3)))
    ends.append((float(chars[-1]["end"]), None))
    return starts, ends


def _nearest_boundary_dist(t: float, cands: list):
    if not cands:
        return None
    return min(abs(x[0] - t) for x in cands)


def _range_text_raw(chars: list, s: float, e: float, tol: float) -> str:
    """词级时间戳上 [s,e]（容差 tol）区间的文本（按字符中点判断）。"""
    return "".join(c["text"] for c in chars
                   if s - tol <= (float(c["start"]) + float(c["end"])) / 2 <= e + tol).strip()


FLOOR_DB = -80.0


def _percentile(sorted_vals: list, p: float) -> float:
    if not sorted_vals:
        return FLOOR_DB
    idx = max(0, min(len(sorted_vals) - 1, int(round(p / 100.0 * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


def classify_energy(data: dict, rule: dict, t0: float, t1: float):
    """[t0,t1] 秒区间的能量分类：窗中位 RMS 与全片 P{p_quiet}/P{p_noisy} 比较。
    返回 "quiet"|"mid"|"noisy"，区间无窗返回 None。"""
    if not isinstance(data, dict):
        return None
    rms = data.get("rms_db") or []
    if not rms or t1 <= t0:
        return None
    w = float(data["window_ms"]) / 1000.0
    i0 = max(0, int(t0 / w))
    i1 = min(len(rms), max(i0 + 1, int(math.ceil(t1 / w))))
    vals = sorted(rms[i0:i1])
    if not vals:
        return None
    med = vals[len(vals) // 2]
    srt = sorted(rms)
    q = _percentile(srt, float(rule["p_quiet"]))
    n = _percentile(srt, float(rule["p_noisy"]))
    if med < q:
        return "quiet"
    if med > n:
        return "noisy"
    return "mid"


def run_checks(edl: dict, chars: list, rules: dict,
               video_exists: bool, video_duration, energy=None) -> dict:
    """12 项机检（纯逻辑）。chars=词级 token 流（空列表=无 ASR，气口类检查降级 warn）；
    video_duration=None 表示无法探测；energy=snap_breath.py 产出的能量 JSON（可选）。"""
    brule = dict(rules.get("breath_rule") or {})
    crule = dict(rules.get("clean_rule") or {})
    erule = dict(rules.get("energy_rule") or {})
    clips = [normalize_clip(c) for c in (edl.get("clips") or [])]
    checks = []

    def add(name, status, detail):
        checks.append({"check": name, "status": status, "detail": detail})

    # 1 片段存在（fail）
    if not clips:
        add("片段存在", "fail", "EDL 为空")
        return {"checks": checks, "pass": False, "total_duration": 0.0}
    add("片段存在", "pass", "共 %d 个片段" % len(clips))

    # 2 源视频存在（fail）
    add("源视频存在", "pass" if video_exists else "fail",
        "源视频可读" if video_exists else "源视频不存在或不可读（检查 --video 路径）")

    # 3 时间区间合法（fail）
    bad = [c["id"] for c in clips if not (c["source_end"] > c["source_start"] >= 0)]
    add("时间区间合法", "fail" if bad else "pass",
        ("非法区间: %s" % ", ".join(bad)) if bad
        else "所有片段 source_start < source_end 且 >= 0")

    # 4 不超出源视频时长（fail；时长探测不到降 warn 不误伤）
    if video_duration is None:
        add("不超出源视频时长", "warn", "无法探测源时长（ffprobe 失败或未提供 --video），跳过")
    else:
        over = ["%s(源 %.1fs)" % (c["id"], video_duration)
                for c in clips if c["source_end"] > video_duration + 0.05]
        add("不超出源视频时长", "fail" if over else "pass",
            ("超界片段: %s" % ", ".join(over)) if over
            else "所有片段在源时长 %.1fs 界内" % video_duration)

    # 5 源区间不重叠（fail）
    ordered = sorted(clips, key=lambda c: c["source_start"])
    overlaps = ["%s ↔ %s" % (a["id"], b["id"]) for a, b in zip(ordered, ordered[1:])
                if b["source_start"] < a["source_end"] - 0.001]
    add("源区间不重叠", "fail" if overlaps else "pass",
        ("重叠: %s" % "; ".join(overlaps)) if overlaps else "无重叠")

    # 6 段内清洗 cuts 合法（fail）
    with_cuts = [c for c in clips if c.get("cuts")]
    cut_errs = []
    for c in with_cuts:
        cut_errs.extend(check_clip_cuts(c))
    add("段内清洗 cuts 合法", "fail" if cut_errs else "pass",
        "; ".join(cut_errs) if cut_errs
        else ("%d 段共 %d 个 cuts，均在段内且互不重叠"
              % (len(with_cuts), sum(len(c["cuts"]) for c in with_cuts))
              if with_cuts else "无 cuts"))

    # 7 clip id 唯一（fail）
    ids = [c["id"] for c in clips]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    add("clip id 唯一", "fail" if dup else "pass",
        ("重复 id: %s" % ", ".join(dup)) if dup else "无重复")

    # 8 无过短碎片（warn，含清洗后净时长）
    min_clip = float(brule["min_clip_s"])
    tiny = [c["id"] for c in clips if (c["source_end"] - c["source_start"]) < min_clip]
    tiny_net = ["%s(净%.1fs)" % (c["id"], clip_net_duration(c))
                for c in with_cuts
                if c["id"] not in tiny and clip_net_duration(c) < min_clip]
    parts = []
    if tiny:
        parts.append("过短片段: %s" % ", ".join(tiny))
    if tiny_net:
        parts.append("清洗后过短: %s" % ", ".join(tiny_net))
    add("无过短碎片(≥%.1fs)" % min_clip, "warn" if parts else "pass",
        ("; ".join(parts) + "，易产生句子拼贴感") if parts
        else "所有片段（含清洗后净时长）≥ %.1fs（breath_rule.min_clip_s）" % min_clip)

    # 9 切点贴合气口（warn 不 fail：人可故意切；附能量标注）
    tol = float(brule["snap_tolerance_s"])
    b = breath_boundaries(chars, brule) if chars else None

    def energy_note(t):
        if not (isinstance(energy, dict) and energy.get("rms_db")):
            return ""
        lab = classify_energy(energy, erule, t - 0.15, t + 0.15)
        return ("[能量 %s]" % lab) if lab else ""

    if b is None:
        add("切点贴合气口(≤%.1fs)" % tol, "warn", "无字级 ASR，跳过气口检查")
    else:
        starts, ends = b
        off = []
        for c in clips:
            ds = _nearest_boundary_dist(c["source_start"], starts)
            de = _nearest_boundary_dist(c["source_end"], ends)
            p = []
            if ds is not None and ds > tol:
                p.append("入点离最近气口 %.2fs%s" % (ds, energy_note(c["source_start"])))
            if de is not None and de > tol:
                p.append("出点离最近气口 %.2fs%s" % (de, energy_note(c["source_end"])))
            if p:
                off.append("%s（%s）" % (c["id"], "、".join(p)))
        add("切点贴合气口(≤%.1fs)" % tol, "warn" if off else "pass",
            ("疑似切在字中间: %s。可用 snap_breath.py 一键吸附" % "; ".join(off)) if off
            else "所有入出点距最近气口 ≤ %.1fs（breath_rule.snap_tolerance_s）" % tol)

    # 10 cuts 贴字边界（warn）
    tolc = float(crule["cut_boundary_char_tol_s"])
    bounds = sorted({float(x["start"]) for x in chars} | {float(x["end"]) for x in chars})
    if not with_cuts:
        add("cuts 贴字边界(≤%.2fs)" % tolc, "pass", "无 cuts")
    elif not bounds:
        add("cuts 贴字边界(≤%.2fs)" % tolc, "warn", "无字级 ASR，跳过")
    else:
        off_cut = []
        for c in with_cuts:
            for x in c["cuts"]:
                for t in (x["start"], x["end"]):
                    dmin = min(abs(bv - t) for bv in bounds)
                    if dmin > tolc:
                        off_cut.append("%s cut@%.2f 离最近字边界 %.2fs" % (c["id"], t, dmin))
        add("cuts 贴字边界(≤%.2fs)" % tolc, "warn" if off_cut else "pass",
            ("; ".join(off_cut) + "。cut 边界应贴字级时间戳") if off_cut
            else "所有 cut 边界距最近字边界 ≤ %.2fs（clean_rule）" % tolc)

    # 11 字级时间戳回验（warn）
    vtol = float(brule["verify_tolerance_s"])
    if not chars:
        add("字级时间戳回验", "warn", "无字级 ASR，跳过")
    else:
        empty = [c["id"] for c in clips
                 if not _range_text_raw(chars, c["source_start"], c["source_end"], vtol)]
        add("字级时间戳回验", "warn" if empty else "pass",
            ("区间取不到任何转写文字（纯静音/越界？）: %s" % ", ".join(empty)) if empty
            else "所有片段区间都能在字级时间戳上取到非空文本（容差 %.1fs）" % vtol)

    # 12 总时长与溯源字段（warn）
    total = sum(c["source_end"] - c["source_start"] for c in clips)
    missing = [c["id"] for c in clips if not (c["selection_reason"] and c["selling_point"])]
    p12 = []
    if not (20 <= total <= 120):
        p12.append("总时长 %.1fs 超出常规切片范围 20-120s" % total)
    if missing:
        p12.append("缺 selection_reason/selling_point: %s" % ", ".join(missing))
    add("总时长与溯源字段", "warn" if p12 else "pass",
        "; ".join(p12) if p12
        else "总时长 %.1fs 合理；所有片段带 selection_reason + selling_point" % total)

    ok = all(c["status"] != "fail" for c in checks)
    return {"checks": checks, "pass": ok, "total_duration": round(total, 3)}


def probe_duration(path):
    """ffprobe 探测视频时长（秒）；失败返回 None（外部进程封装，测试不覆盖）。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True)
        return float(out.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="明星切片 QA 机检（12 项，阈值读 rules.json）")
    ap.add_argument("--edl", required=True, help="EDL JSON 路径")
    ap.add_argument("--asr", required=True, help="词级 ASR JSON 路径（segments 词流）")
    ap.add_argument("--video", default=None, help="源视频路径（探测时长与存在性）")
    ap.add_argument("--energy", default=None, help="能量 JSON（snap_breath.py 产出，可选）")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径")
    ap.add_argument("--out", default=None, help="机检清单输出路径（缺省打到 stdout）")
    args = ap.parse_args()

    edl = load_edl(args.edl)
    with open(args.asr, encoding="utf-8") as f:
        chars = json.load(f).get("segments") or []
    rules = load_rules(args.rules)
    energy = None
    if args.energy and os.path.isfile(args.energy):
        with open(args.energy, encoding="utf-8") as f:
            energy = json.load(f)

    video_exists = bool(args.video) and os.path.isfile(args.video)
    duration = probe_duration(args.video) if video_exists else None
    report = run_checks(edl, chars, rules, video_exists, duration, energy)

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        sys.stderr.write("[ok] 机检清单 → %s（pass=%s）\n" % (args.out, report["pass"]))
    else:
        print(text)
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
