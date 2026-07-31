#!/usr/bin/env python3
"""词级 ASR + 校对稿 → SRT / ASS（含 karaoke 逐字高亮）字幕；可按 EDL 重映射到成片时间轴。

- 校对稿传播：proofread.json 里 status=="confirmed" 的句子用 corrected 文本 difflib
  对齐到原始字级时间戳（equal 继承原时间、replace 按块内位置继承、insert 零宽锚定、
  delete 只推进锚点），其余时间段保持原始 ASR——只纠错不改写、忠于音频。
- 聚合/样式/强调词全读 ../references/rules.json（caption_group_rule / caption_styles /
  power_words），不硬编码。
- karaoke：字幕块内每个有时长的字各出一条 Dialogue（当前字持续期 = 本字 start →
  下一字 start），当前字 highlight 色、power word 字 strong 色、其余主色；只换色
  不缩放字体（缩放会整行重排抖动）。
- --edl：把源时间轴词流重映射到成片时间轴（按 clip 顺序累加），并可产出溯源
  source_map.json。带 cuts 的 clip 请先按保留区间展开成子段再传入。

用法:
    python3 make_captions.py --asr words.json [--proofread proofread.json] \
        [--edl edl.json] --format srt|ass [--style karaoke] \
        [--source-map-out source_map.json] [--rules rules.json] [--out captions.srt]
"""
import argparse
import difflib
import json
import os
import re
import sys

PUNCT = "。！？?!，,"


def default_rules_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "references", "rules.json")


def load_rules(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def unwrap_edl(doc):
    """兼容 snap_breath.py --apply 的输出信封：回写后的 EDL 在 edl 子键下，
    顶层 clips 是吸附报告行（无 id / 无 selection_reason / 坐标未吸附）。直传
    edl_snapped.json 也能取到正确的 EDL，不必手工拆子对象。"""
    if isinstance(doc, dict):
        inner = doc.get("edl")
        if isinstance(inner, dict) and isinstance(inner.get("clips"), list):
            return inner
    return doc


def load_edl_clips(path: str) -> list:
    with open(path, encoding="utf-8") as f:
        return unwrap_edl(json.load(f)).get("clips") or []


def fmt_srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def fmt_ass_time(t: float) -> str:
    cs = int(round(t * 100))
    return "%d:%02d:%02d.%02d" % (cs // 360000, cs // 6000 % 60, cs // 100 % 60, cs % 100)


def sentence_src_chars(sent: dict, chars: list) -> list:
    """取落在句子 [start,end] 时间范围内的 ASR 字符（按字符中点判断）。"""
    s0, e0 = float(sent["start"]), float(sent["end"])
    return [c for c in chars
            if s0 - 0.021 <= (float(c["start"]) + float(c["end"])) / 2 <= e0 + 0.021]


def explode_token_times(src_chars: list) -> list:
    """ASR token 可能是多字符（如 "Hello"）。按 token 时长均分到每个字符，
    保证与 difflib 的字符级 opcodes 一一对应。返回 [(ch, start, end)]。"""
    units = []
    for c in src_chars:
        txt = str(c["text"])
        if not txt:
            continue
        st, en = float(c["start"]), float(c["end"])
        step = (en - st) / len(txt)
        for k, ch in enumerate(txt):
            units.append((ch, st + k * step, st + (k + 1) * step))
    return units


def align_texts(src: str, dst: str, src_times: list) -> list:
    """把 dst 每个字符对齐到 src 的时间戳。src_times: [(start,end)] 与 src 等长。
    返回 [(start, end, inserted)]，与 dst 等长。"""
    out = []
    anchor = src_times[0][0] if src_times else 0.0  # 句首插入锚点
    sm = difflib.SequenceMatcher(a=src, b=dst, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(j2 - j1):
                st, en = src_times[i1 + k]
                out.append((st, en, False))
        elif tag == "replace":
            n_src = i2 - i1
            for k in range(j2 - j1):
                st, en = src_times[i1 + min(k, n_src - 1)]
                out.append((st, en, False))
        elif tag == "insert":
            for _ in range(j2 - j1):
                out.append((anchor, anchor, True))
        if i2 > i1:
            anchor = src_times[i2 - 1][1]
    return out


def align_sentence(sent: dict, chars: list) -> list:
    """把一个校对句的 corrected 文本对齐到字级时间。返回 [{"c","start","end","inserted"}]。"""
    original = str(sent.get("original", ""))
    corrected = str(sent.get("corrected") or original)
    src_chars = sentence_src_chars(sent, chars)
    if not src_chars:
        s0 = round(float(sent.get("start", 0)), 3)
        return [{"c": ch, "start": s0, "end": s0, "inserted": True} for ch in corrected]
    units = explode_token_times(src_chars)
    src_text = "".join(u[0] for u in units)
    src_times = [(round(u[1], 3), round(u[2], 3)) for u in units]
    if original == src_text:
        orig_times = src_times
    else:
        orig_times = [(t[0], t[1]) for t in align_texts(src_text, original, src_times)]
    aligned = align_texts(original, corrected, orig_times)
    return [{"c": ch, "start": round(t[0], 3), "end": round(t[1], 3), "inserted": bool(t[2])}
            for ch, t in zip(corrected, aligned)]


def effective_chars(chars: list, doc) -> list:
    """生效字符流：confirmed 校对句用 corrected 对齐字符替换该时间段的原始 ASR 字符，
    其余保持原始。返回 [{"c","start","end","inserted"}]。"""
    norm = [{"c": str(c["text"]), "start": round(float(c["start"]), 3),
             "end": round(float(c["end"]), 3), "inserted": False} for c in chars]
    if not isinstance(doc, dict) or not isinstance(doc.get("sentences"), list):
        return norm
    conf = [s for s in doc["sentences"]
            if isinstance(s, dict) and s.get("status") == "confirmed"]
    if not conf:
        return norm
    conf.sort(key=lambda s: float(s.get("start", 0)))
    out = []
    i, n = 0, len(chars)

    def mid(c):
        return (float(c["start"]) + float(c["end"])) / 2

    for s in conf:
        try:
            s0, e0 = float(s["start"]), float(s["end"])
        except (KeyError, TypeError, ValueError):
            continue
        while i < n and mid(chars[i]) < s0 - 0.021:
            out.append(norm[i])
            i += 1
        out.extend(align_sentence(s, chars))
        while i < n and mid(chars[i]) <= e0 + 0.021:
            i += 1
    while i < n:
        out.append(norm[i])
        i += 1
    return out


def group_sentences(norm_chars: list, group_rule: dict) -> list:
    """归一化字符 [{"c","start","end","inserted"}] -> 语句。聚合规则读 caption_group_rule：
    间隔 > gap_flush_s 换块；累计字数 >= max_chars_flush，或 >= punct_flush_min_chars
    且当前字是标点时换块。inserted（不占时间）字符不参与间隔判断。"""
    gap_flush = float(group_rule["gap_flush_s"])
    max_chars = int(group_rule["max_chars_flush"])
    punct_min = int(group_rule["punct_flush_min_chars"])
    sentences = []
    current = []

    def flush():
        if not current:
            return
        text = "".join(c["c"] for c in current).strip()
        if text:
            timed = [c for c in current if not c.get("inserted")] or current
            sentences.append({
                "start": round(timed[0]["start"], 3),
                "end": round(timed[-1]["end"], 3),
                "text": text,
                "chars": [{"c": c["c"], "start": round(c["start"], 3),
                           "end": round(c["end"], 3)} for c in current],
            })
        current.clear()

    previous = None
    for c in norm_chars:
        if previous is not None and not c.get("inserted") and (c["start"] - previous["end"] > gap_flush):
            flush()
        current.append(c)
        text = "".join(x["c"] for x in current)
        if len(text) >= max_chars or (len(text) >= punct_min and c["c"] in PUNCT):
            flush()
        if not c.get("inserted"):
            previous = c
    flush()
    return sentences


def caption_blocks(eff: list, group_rule: dict) -> list:
    """生效字符流 → 字幕块 [{"text","start","end","chars"}]。chars 与 text 同步维护
    （karaoke 逐字高亮用；chars 里 end<=start 的为插入标点等零宽字符，不作时间锚）。"""
    blocks = []
    for s in group_sentences(eff, group_rule):
        b = {"text": s["text"], "start": s["start"], "end": s["end"],
             "chars": list(s["chars"])}
        # 纯标点块并入前块，避免零时长字幕
        if blocks and all(ch in PUNCT for ch in b["text"]):
            blocks[-1]["text"] += b["text"]
            blocks[-1]["chars"] += b["chars"]
            blocks[-1]["end"] = max(blocks[-1]["end"], b["end"])
        else:
            # 块首标点跟随前块，字幕不以标点开头
            if blocks:
                lead = ""
                while b["text"] and b["text"][0] in PUNCT:
                    lead += b["text"][0]
                    b["text"] = b["text"][1:]
                    if b["chars"]:
                        blocks[-1]["chars"].append(b["chars"].pop(0))
                if lead:
                    blocks[-1]["text"] += lead
            blocks.append(b)
    return blocks


def remap_words(eff: list, clips: list) -> tuple:
    """按 EDL 把源时间轴生效字符流映射到成片时间轴（clip 定义顺序顺拼）。
    返回 (mapped_eff, source_map)。带 cuts 的 clip 请先展开为保留区间子段。"""
    out, source_map, cursor = [], [], 0.0
    for c in clips:
        s, e = float(c["source_start"]), float(c["source_end"])
        dur = e - s
        shift = cursor - s
        for w in eff:
            m = (float(w["start"]) + float(w["end"])) / 2
            if s - 0.021 <= m <= e + 0.021:
                out.append({"c": w["c"],
                            "start": round(float(w["start"]) + shift, 3),
                            "end": round(float(w["end"]) + shift, 3),
                            "inserted": bool(w.get("inserted"))})
        source_map.append({"id": str(c.get("id", "")),
                           "source_start": round(s, 3), "source_end": round(e, 3),
                           "final_start": round(cursor, 3), "final_end": round(cursor + dur, 3),
                           "selection_reason": str(c.get("selection_reason", "")),
                           "selling_point": str(c.get("selling_point", ""))})
        cursor += dur
    return out, source_map


def power_word_spans(text: str, rules: dict) -> list:
    """按 rules.json power_words（声明式）在 text 上找强调词区间 [(i,j))。"""
    pw = rules.get("power_words") or {}
    pats = [p for p in pw.get("regex_patterns", []) if isinstance(p, str)]
    words = [w for w in pw.get("words", []) if isinstance(w, str) and w]
    if words:
        pats.append("|".join(re.escape(w) for w in words))
    spans = []
    for p in pats:
        try:
            for m in re.finditer(p, text):
                if m.end() > m.start():
                    spans.append((m.start(), m.end()))
        except re.error:
            continue
    return spans


def get_caption_style(rules: dict, name: str = ""):
    """返回 (style_dict|None, resolved_name)。name 为空取 default_style。"""
    doc = rules.get("caption_styles") or {}
    name = name or str(doc.get("default_style") or "default")
    st = (doc.get("styles") or {}).get(name)
    if not isinstance(st, dict):
        return None, name
    return dict(st), name


def ass_header_for(style: dict, play_res) -> str:
    try:
        rx, ry = int(play_res[0]), int(play_res[1])
    except (TypeError, ValueError, IndexError):
        rx, ry = 1080, 1920
    return ("[Script Info]\n"
            "ScriptType: v4.00+\n"
            "PlayResX: %s\n"
            "PlayResY: %s\n"
            "\n"
            "[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
            "Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\n"
            "Style: Default,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n"
            "\n"
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            % (rx, ry, style["font"], style["font_size"], style["primary_color"],
               style["outline_color"], style["back_color"], style["bold"], style["outline"],
               style["shadow"], style["alignment"], style["margin_l"], style["margin_r"],
               style["margin_v"]))


def wrap_lines(text: str, max_chars: int) -> str:
    if not max_chars or max_chars <= 0 or len(text) <= max_chars:
        return text
    return "\\N".join(text[i:i + max_chars] for i in range(0, len(text), max_chars))


def ass_dialogue(start: float, end: float, text: str) -> str:
    return "Dialogue: 0,%s,%s,Default,,0,0,0,,%s\n" % (
        fmt_ass_time(start), fmt_ass_time(end), text.replace("\n", " "))


def karaoke_markup(tokens: list, cur_idx: int, strong_idx: set, style: dict,
                   max_chars: int) -> str:
    """块内全文，当前字 highlight 色、power word 字 strong 色、其余主色。
    只换色不缩放字体（缩放会整行重排抖动）。颜色变化处才发 \\c 标签。"""
    base = style["primary_color"]
    primary = base + "&"
    hi = (style.get("highlight_color") or base) + "&"
    strong = (style.get("strong_color") or base) + "&"
    parts = []
    cur_color = primary
    count = 0
    for i, tok in enumerate(tokens):
        col = hi if i == cur_idx else (strong if i in strong_idx else primary)
        txt = str(tok["c"]).replace("\n", " ")
        if max_chars and count and count % max_chars == 0:
            parts.append("\\N")
        if col != cur_color:
            parts.append("{\\c%s}" % col)
            cur_color = col
        parts.append(txt)
        count += len(txt)
    return "".join(parts)


def ass_render(blocks: list, style: dict, play_res, rules: dict) -> str:
    lines = [ass_header_for(style, play_res)]
    max_chars = int(style.get("max_chars_per_line") or 0)
    if not style.get("karaoke"):
        for b in blocks:
            lines.append(ass_dialogue(b["start"], b["end"],
                                      wrap_lines(b["text"].replace("\n", " "), max_chars)))
        return "".join(lines)
    # karaoke：块内每个有时长的字各出一条 Dialogue（当前字持续期 = 本字 start → 下一字 start）
    for b in blocks:
        tokens = b.get("chars") or []
        if not tokens:
            lines.append(ass_dialogue(b["start"], b["end"], b["text"]))
            continue
        tok_text = "".join(str(t["c"]) for t in tokens)
        # power word 字符区间 → token 下标（token 可能多字符，如英文词）
        spans = power_word_spans(tok_text, rules)
        strong_idx = set()
        pos = 0
        for i, t in enumerate(tokens):
            tlen = len(str(t["c"]))
            for (a, z) in spans:
                if pos < z and a < pos + tlen:
                    strong_idx.add(i)
                    break
            pos += tlen
        timed = [i for i, t in enumerate(tokens) if t["end"] - t["start"] > 0.0005]
        if not timed:
            lines.append(ass_dialogue(b["start"], b["end"], b["text"]))
            continue
        for k, i in enumerate(timed):
            st = tokens[i]["start"]
            en = tokens[timed[k + 1]]["start"] if k + 1 < len(timed) else b["end"]
            if en - st < 0.001:
                en = st + 0.001
            lines.append(ass_dialogue(st, en,
                                      karaoke_markup(tokens, i, strong_idx, style, max_chars)))
    return "".join(lines)


def srt_render(blocks: list) -> str:
    parts = []
    for i, b in enumerate(blocks):
        parts.append("%d\n%s --> %s\n%s\n" % (
            i + 1, fmt_srt_time(b["start"]), fmt_srt_time(b["end"]), b["text"]))
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="词级 ASR + 校对稿 → SRT/ASS 字幕（规则读 rules.json）")
    ap.add_argument("--asr", required=True, help="词级 ASR JSON 路径（segments 词流，源时间轴）")
    ap.add_argument("--proofread", default=None, help="校对稿 JSON（status=confirmed 的句子生效）")
    ap.add_argument("--edl", default=None, help="EDL JSON：给了就重映射到成片时间轴")
    ap.add_argument("--format", default="srt", choices=["srt", "ass"])
    ap.add_argument("--style", default="", help="ASS 样式名（rules.json caption_styles.styles，缺省 default_style）")
    ap.add_argument("--source-map-out", default=None, help="溯源 source_map.json 输出路径（需配 --edl）")
    ap.add_argument("--rules", default=default_rules_path(), help="rules.json 路径")
    ap.add_argument("--out", default=None, help="字幕输出路径（缺省打到 stdout）")
    args = ap.parse_args()

    rules = load_rules(args.rules)
    with open(args.asr, encoding="utf-8") as f:
        chars = json.load(f).get("segments") or []
    if not chars:
        sys.stderr.write("[error] NO_ASR: 词级 JSON 里 segments 为空\n")
        return 1
    doc = None
    if args.proofread:
        with open(args.proofread, encoding="utf-8") as f:
            doc = json.load(f)
    eff = effective_chars(chars, doc)

    if args.edl:
        clips = load_edl_clips(args.edl)
        eff, source_map = remap_words(eff, clips)
        if args.source_map_out:
            with open(args.source_map_out, "w", encoding="utf-8") as f:
                json.dump(source_map, f, ensure_ascii=False, indent=2)
            sys.stderr.write("[ok] 溯源映射 → %s（%d 段）\n" % (args.source_map_out, len(source_map)))
    elif args.source_map_out:
        sys.stderr.write("[error] --source-map-out 需要配合 --edl 使用\n")
        return 1

    blocks = caption_blocks(eff, rules["caption_group_rule"])
    if args.format == "ass":
        style, resolved = get_caption_style(rules, args.style)
        if style is None:
            sys.stderr.write("[error] UNKNOWN_STYLE: %s（可选: %s，见 rules.json caption_styles）\n"
                             % (resolved,
                                "/".join(sorted((rules.get("caption_styles") or {}).get("styles") or {}))))
            return 1
        play_res = (rules.get("caption_styles") or {}).get("play_res") or [1080, 1920]
        content = ass_render(blocks, style, play_res, rules)
    else:
        content = srt_render(blocks)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(content)
        sys.stderr.write("[ok] %d 个字幕块 → %s\n" % (len(blocks), args.out))
    else:
        sys.stdout.write(content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
