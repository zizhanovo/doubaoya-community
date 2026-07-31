#!/usr/bin/env python3
"""气口吸附：把 EDL 切点吸附到词级时间戳的静音谷（气口），并做 RMS 能量互证标注。

吸附规则（数值全读 ../references/rules.json 的 breath_rule/energy_rule，不硬编码）：
  入点 → 气口后第一字 start − pad_start_s；出点 → 气口前最后一字 end + pad_end_s。
  搜索窗 ±snap_tolerance_s；窗内无气口该端不动；两端都没吸到 snapped=false。
能量互证（机制来源 auto-editor：解码音频逐窗算 RMS）：吸附到的气口做
  quiet（低于全片 P{p_quiet}，可信气口）/ mid / noisy（高于 P{p_noisy}，背景音）标注。

纯逻辑（breath_boundaries/snap_clips/rms_windows/classify_energy）与 ffmpeg
子进程（compute_energy）分离，纯逻辑可离线测试。

用法:
    python3 snap_breath.py --edl edl.json --asr words.json \
        [--video source.mp4] [--energy energy.json] [--apply] \
        [--rules rules.json] [--out snapped.json]

--energy 是能量缓存路径：文件存在直接读；不存在且给了 --video 则计算后写入
（validate_edl.py 的 --energy 参数可复用同一文件）。
--apply 时输出附带 "edl"：吸附成功的 clip 坐标已回写，可直接进组合闸。
"""
import argparse
import array
import json
import math
import os
import subprocess
import sys

FLOOR_DB = -80.0
SAMPLE_RATE = 16000


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


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


def gap_energy_at(data: dict, rule: dict, t: float, gap, side: str):
    """snap 端点能量：端点 t 吸附到的气口区间做分类。
    side="start"：气口在入点前 [t-gap, t]；side="end"：气口在出点后 [t, t+gap]。
    gap=None（媒体边缘）→ 取端点外 0.3s。"""
    if gap is None:
        span = 0.3
        t0, t1 = (t - span, t) if side == "start" else (t, t + span)
    else:
        t0, t1 = (t - float(gap), t) if side == "start" else (t, t + float(gap))
    return classify_energy(data, rule, max(0.0, t0), t1)


def snap_clips(clips: list, starts: list, ends: list, rule: dict,
               energy=None, energy_rule=None) -> list:
    """把每段 (source_start, source_end) 吸附到最近气口（纯函数）。"""
    tol = float(rule["snap_tolerance_s"])
    pad_s, pad_e = float(rule["pad_start_s"]), float(rule["pad_end_s"])
    out = []
    for c in clips:
        try:
            s, e = float(c["source_start"]), float(c["source_end"])
        except (KeyError, TypeError, ValueError):
            out.append({"error": "clip 需含数字 source_start/source_end", "snapped": False})
            continue
        cand_s = min(starts, key=lambda x: abs(x[0] - s)) if starts else None
        cand_e = min(ends, key=lambda x: abs(x[0] - e)) if ends else None
        s_ok = cand_s is not None and abs(cand_s[0] - s) <= tol
        e_ok = cand_e is not None and abs(cand_e[0] - e) <= tol
        ns = max(0.0, cand_s[0] - pad_s) if s_ok else s
        ne = cand_e[0] + pad_e if e_ok else e
        note = ""
        if ns >= ne:  # 极短段两端吸到同一气口两侧会反转，放弃吸附
            ns, ne, s_ok, e_ok = s, e, False, False
            note = "吸附后区间反转，放弃"
        row = {
            "source_start": round(s, 3), "source_end": round(e, 3),
            "snapped_start": round(ns, 3), "snapped_end": round(ne, 3),
            "snapped": bool(s_ok or e_ok),
            "start_snapped": bool(s_ok), "end_snapped": bool(e_ok),
            "start_shift_s": round(ns - s, 3), "end_shift_s": round(ne - e, 3),
            "gap_before_s": cand_s[1] if s_ok else None,
            "gap_after_s": cand_e[1] if e_ok else None,
            "start_energy": (gap_energy_at(energy, energy_rule, cand_s[0], cand_s[1], "start")
                             if (energy and s_ok) else None),
            "end_energy": (gap_energy_at(energy, energy_rule, cand_e[0], cand_e[1], "end")
                           if (energy and e_ok) else None),
        }
        if note:
            row["note"] = note
        out.append(row)
    return out


def rms_windows(pcm: bytes, window_samples: int) -> list:
    """s16le mono PCM → 每满窗 RMS(dBFS) 列表（纯函数，尾部不满一窗丢弃）。"""
    samples = array.array("h")
    usable = len(pcm) - len(pcm) % 2
    samples.frombytes(pcm[:usable])
    out = []
    for w in range(len(samples) // window_samples):
        seg = samples[w * window_samples:(w + 1) * window_samples]
        acc = 0
        for v in seg:
            acc += v * v
        rms = math.sqrt(acc / window_samples)
        db = 20 * math.log10(rms / 32768.0) if rms > 0 else FLOOR_DB
        out.append(round(max(db, FLOOR_DB), 1))
    return out


def compute_energy(video: str, window_ms: int) -> dict:
    """ffmpeg 解码源音频为 s16le mono 16k 管道读入，逐窗算 RMS（外部进程封装）。"""
    win = max(1, int(SAMPLE_RATE * window_ms / 1000))
    bytes_per_win = win * 2
    cmd = ["ffmpeg", "-v", "error", "-i", str(video), "-map", "0:a:0",
           "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    rms = []
    buf = b""
    try:
        while True:
            chunk = proc.stdout.read(1024 * 512)
            if not chunk:
                break
            buf += chunk
            n_full = len(buf) // bytes_per_win
            if not n_full:
                continue
            block, buf = buf[:n_full * bytes_per_win], buf[n_full * bytes_per_win:]
            rms.extend(rms_windows(block, win))
    finally:
        proc.stdout.close()
        proc.wait()
    return {"version": 1, "window_ms": window_ms, "sample_rate": SAMPLE_RATE,
            "windows": len(rms), "rms_db": rms}


def main() -> int:
    ap = argparse.ArgumentParser(description="EDL 切点气口吸附 + RMS 能量互证（规则读 rules.json）")
    ap.add_argument("--edl", required=True, help="EDL JSON 路径")
    ap.add_argument("--asr", required=True, help="词级 ASR JSON 路径（segments 词流）")
    ap.add_argument("--video", default=None, help="源视频路径（现算能量用；有 --energy 缓存可省）")
    ap.add_argument("--energy", default=None, help="能量 JSON 缓存路径（存在则读；不存在且有 --video 则算完写入）")
    ap.add_argument("--apply", action="store_true", help="把吸附成功的坐标回写进输出的 edl 字段")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径")
    ap.add_argument("--out", default=None, help="输出路径（缺省打到 stdout）")
    args = ap.parse_args()

    with open(args.edl, encoding="utf-8") as f:
        edl = json.load(f)
    with open(args.asr, encoding="utf-8") as f:
        chars = json.load(f).get("segments") or []
    rules = load_rules(args.rules)
    brule = rules["breath_rule"]
    erule = rules["energy_rule"]

    b = breath_boundaries(chars, brule)
    if b is None:
        sys.stderr.write("[error] NO_ASR: 词级 JSON 里 segments 为空，无法找气口\n")
        return 1
    starts, ends = b

    energy = None
    if args.energy and os.path.isfile(args.energy):
        with open(args.energy, encoding="utf-8") as f:
            energy = json.load(f)
    elif args.video and os.path.isfile(args.video):
        energy = compute_energy(args.video, int(erule["window_ms"]))
        if not energy["windows"]:
            # ffmpeg 缺失 / 无音轨 / 解码失败：降级为不做能量互证，且绝不落盘空缓存
            # （空缓存会被后续运行和 validate_edl.py 当成有效结果读走，永久关掉能量互证）
            sys.stderr.write("[warn] 未解出音频能量（ffmpeg 失败或无音轨），跳过能量互证，不写缓存\n")
            energy = None
        elif args.energy:
            with open(args.energy, "w", encoding="utf-8") as f:
                json.dump(energy, f, ensure_ascii=False)
            sys.stderr.write("[ok] 能量缓存 → %s（%d 窗）\n" % (args.energy, energy["windows"]))

    clips = edl.get("clips") or []
    rows = snap_clips(clips, starts, ends, brule, energy=energy, energy_rule=erule)
    result = {"clips": rows, "rule": brule, "energy_rule": erule if energy else None}
    if args.apply:
        for c, row in zip(clips, rows):
            if row.get("snapped"):
                c["source_start"], c["source_end"] = row["snapped_start"], row["snapped_end"]
        result["edl"] = {"clips": clips}
        sys.stderr.write("[hint] 回写后的 EDL 在输出的 edl 键下\n")

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        sys.stderr.write("[ok] 吸附结果 → %s（%d 段，%d 段有吸附）\n"
                         % (args.out, len(rows), sum(1 for r in rows if r.get("snapped"))))
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
