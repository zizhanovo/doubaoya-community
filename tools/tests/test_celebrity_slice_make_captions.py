from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "make_captions.py"
SPEC = importlib.util.spec_from_file_location("cs_make_captions", MODULE_PATH)
assert SPEC and SPEC.loader
mc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mc)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)
GROUP = RULES["caption_group_rule"]


def chars_of(text, start=0.0, step=0.5):
    return [{"text": ch, "start": round(start + i * step, 3), "end": round(start + (i + 1) * step, 3)}
            for i, ch in enumerate(text)]


class TimeFormatTests(unittest.TestCase):
    def test_srt_time(self):
        self.assertEqual(mc.fmt_srt_time(3723.45), "01:02:03,450")
        self.assertEqual(mc.fmt_srt_time(0.0), "00:00:00,000")

    def test_ass_time(self):
        self.assertEqual(mc.fmt_ass_time(3723.456), "1:02:03.46")
        self.assertEqual(mc.fmt_ass_time(0.0), "0:00:00.00")


class GroupingTests(unittest.TestCase):
    def norm(self, chars):
        return [{"c": c["text"], "start": c["start"], "end": c["end"], "inserted": False}
                for c in chars]

    def test_gap_flush(self):
        a = chars_of("你好", 0.0)
        b = chars_of("再见", 2.0)  # 间隔 1.0 > gap_flush_s 0.55
        sents = mc.group_sentences(self.norm(a + b), GROUP)
        self.assertEqual([s["text"] for s in sents], ["你好", "再见"])

    def test_max_chars_flush(self):
        sents = mc.group_sentences(self.norm(chars_of("字" * 20, 0.0, 0.1)), GROUP)
        self.assertEqual(len(sents[0]["text"]), GROUP["max_chars_flush"])

    def test_punct_flush(self):
        # 标点前 9 字 >= punct_flush_min_chars(8) → 遇「，」flush
        sents = mc.group_sentences(
            self.norm(chars_of("这个面料真的不错，后半句还在继续说", 0.0, 0.1)), GROUP)
        self.assertEqual(sents[0]["text"], "这个面料真的不错，")


class ProofreadPropagationTests(unittest.TestCase):
    def test_confirmed_correction_keeps_timing(self):
        chars = chars_of("白提最怕透", 10.0)
        doc = {"sentences": [{"start": 10.0, "end": 12.5,
                              "original": "白提最怕透", "corrected": "白T最怕透",
                              "status": "confirmed"}]}
        eff = mc.effective_chars(chars, doc)
        self.assertEqual("".join(c["c"] for c in eff), "白T最怕透")
        self.assertAlmostEqual(eff[0]["start"], 10.0, places=3)   # 首字时间不变
        self.assertAlmostEqual(eff[-1]["end"], 12.5, places=3)    # 末字时间不变

    def test_pending_sentence_keeps_original(self):
        chars = chars_of("白提最怕透", 10.0)
        doc = {"sentences": [{"start": 10.0, "end": 12.5,
                              "original": "白提最怕透", "corrected": "白T最怕透",
                              "status": "pending"}]}
        eff = mc.effective_chars(chars, doc)
        self.assertEqual("".join(c["c"] for c in eff), "白提最怕透")

    def test_inserted_punct_is_zero_width(self):
        chars = chars_of("面料很薄", 0.0)
        doc = {"sentences": [{"start": 0.0, "end": 2.0,
                              "original": "面料很薄", "corrected": "面料很薄，",
                              "status": "confirmed"}]}
        eff = mc.effective_chars(chars, doc)
        self.assertTrue(eff[-1]["inserted"])
        self.assertEqual(eff[-1]["start"], eff[-1]["end"])  # 插入标点不占时间


class RemapTests(unittest.TestCase):
    def test_remap_shifts_to_final_timeline(self):
        eff = [{"c": "字", "start": 10.0 + i * 0.5, "end": 10.5 + i * 0.5, "inserted": False}
               for i in range(8)]  # 10.0 - 14.0
        clips = [{"id": "c1", "source_start": 10.0, "source_end": 12.0,
                  "selection_reason": "r", "selling_point": "s"},
                 {"id": "c2", "source_start": 12.0, "source_end": 14.0,
                  "selection_reason": "r", "selling_point": "s"}]
        mapped, source_map = mc.remap_words(eff, clips)
        self.assertAlmostEqual(mapped[0]["start"], 0.0, places=3)
        self.assertEqual(len(mapped), 8)
        self.assertEqual(source_map[1]["final_start"], 2.0)
        self.assertEqual(source_map[1]["source_start"], 12.0)


class RenderTests(unittest.TestCase):
    def blocks(self, text="好的面料自己会说话，", start=0.0):
        eff = [{"c": ch, "start": start + i * 0.3, "end": start + (i + 1) * 0.3,
                "inserted": False} for i, ch in enumerate(text)]
        return mc.caption_blocks(eff, GROUP)

    def test_srt_render_format(self):
        out = mc.srt_render(self.blocks())
        self.assertIn("1\n00:00:00,000 --> ", out)
        self.assertIn("好的面料自己会说话，", out)

    def test_ass_header_from_rules(self):
        style, name = mc.get_caption_style(RULES, "")
        self.assertEqual(name, RULES["caption_styles"]["default_style"])
        header = mc.ass_header_for(style, RULES["caption_styles"]["play_res"])
        self.assertIn("PlayResX: 1080", header)
        self.assertIn("PlayResY: 1920", header)
        self.assertIn("Style: Default,PingFang SC,72", header)

    def test_unknown_style_returns_none(self):
        style, name = mc.get_caption_style(RULES, "nope")
        self.assertIsNone(style)
        self.assertEqual(name, "nope")

    def test_static_ass_one_dialogue_per_block(self):
        style, _ = mc.get_caption_style(RULES, "default")
        blocks = self.blocks()
        out = mc.ass_render(blocks, style, RULES["caption_styles"]["play_res"], RULES)
        self.assertEqual(out.count("Dialogue:"), len(blocks))

    def test_karaoke_one_dialogue_per_timed_char(self):
        style, _ = mc.get_caption_style(RULES, "karaoke")
        blocks = self.blocks("最后三件现货")
        out = mc.ass_render(blocks, style, RULES["caption_styles"]["play_res"], RULES)
        timed = sum(1 for b in blocks for t in b["chars"] if t["end"] - t["start"] > 0.0005)
        self.assertEqual(out.count("Dialogue:"), timed)
        self.assertIn("{\\c" + style["highlight_color"] + "&}", out)   # 当前字高亮色
        self.assertIn("{\\c" + style["strong_color"] + "&}", out)      # power word（最后/现货）强调色

    def test_power_word_spans_from_rules(self):
        spans = mc.power_word_spans("今天到手价368块最后三件", RULES)
        hit = "".join("今天到手价368块最后三件"[a:z] for a, z in sorted(set(spans)))
        self.assertIn("368块", hit)
        self.assertIn("最后", hit)


class UnwrapEdlTests(unittest.TestCase):
    """snap_breath.py --apply 的输出信封：真 EDL 在 edl 子键下，顶层 clips 是吸附报告行
    （无 id / 无 selection_reason、坐标未吸附）。直传 edl_snapped.json 必须取到 edl 子对象，
    否则 source_map 的 id / 溯源字段全空、坐标退回未吸附值。"""

    SNAPPED = {
        "clips": [{"source_start": 1.15, "source_end": 5.3, "snapped_start": 0.88,
                   "snapped_end": 5.3, "snapped": True}],
        "rule": {}, "energy_rule": None,
        "edl": {"clips": [{"id": "c1", "source_start": 0.88, "source_end": 5.3,
                           "selection_reason": "痛点开头", "selling_point": "白T不透"}]},
    }

    def test_unwraps_snap_breath_envelope(self):
        clips = mc.unwrap_edl(self.SNAPPED)["clips"]
        self.assertEqual([c["id"] for c in clips], ["c1"])
        self.assertEqual(clips[0]["source_start"], 0.88)  # 吸附后坐标，不是 1.15

    def test_plain_edl_passes_through(self):
        plain = {"clips": [{"id": "c1", "source_start": 0.0, "source_end": 5.0}]}
        self.assertIs(mc.unwrap_edl(plain), plain)

    def test_source_map_keeps_traceability_through_envelope(self):
        eff = [{"c": c["text"], "start": c["start"], "end": c["end"], "inserted": False}
               for c in chars_of("白T最怕透", start=1.0)]
        _, source_map = mc.remap_words(eff, mc.unwrap_edl(self.SNAPPED)["clips"])
        self.assertEqual(source_map[0]["id"], "c1")
        self.assertEqual(source_map[0]["selling_point"], "白T不透")
        self.assertEqual(source_map[0]["source_start"], 0.88)


if __name__ == "__main__":
    unittest.main()
