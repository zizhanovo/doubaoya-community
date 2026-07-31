from __future__ import annotations

import array
import importlib.util
import json
import math
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "snap_breath.py"
SPEC = importlib.util.spec_from_file_location("cs_snap_breath", MODULE_PATH)
assert SPEC and SPEC.loader
snap_breath = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snap_breath)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)
BRULE = RULES["breath_rule"]

# 词流：0-10s 连续（每字 0.5s），10.0→10.4 有 0.4s 气口，10.4-20.4 连续
CHARS = ([{"text": "字", "start": i * 0.5, "end": i * 0.5 + 0.5} for i in range(20)]
         + [{"text": "字", "start": 10.4 + i * 0.5, "end": 10.9 + i * 0.5} for i in range(20)])


class BoundariesTests(unittest.TestCase):
    def test_gap_detected(self):
        starts, ends = snap_breath.breath_boundaries(CHARS, BRULE)
        self.assertIn((10.4, 0.4), starts)
        self.assertIn((10.0, 0.4), ends)

    def test_media_edges_have_none_gap(self):
        starts, ends = snap_breath.breath_boundaries(CHARS, BRULE)
        self.assertEqual(starts[0], (0.0, None))
        self.assertEqual(ends[-1], (20.4, None))  # 最后一字 end，媒体终点 gap=None

    def test_empty_chars_returns_none(self):
        self.assertIsNone(snap_breath.breath_boundaries([], BRULE))


class SnapTests(unittest.TestCase):
    def snap(self, clips, energy=None):
        starts, ends = snap_breath.breath_boundaries(CHARS, BRULE)
        return snap_breath.snap_clips(clips, starts, ends, BRULE,
                                      energy=energy, energy_rule=RULES["energy_rule"])

    def test_snap_within_tolerance_applies_pads(self):
        # 入点 10.2 距气口后首字 10.4 = 0.2 <= 0.5；出点 9.8 距气口前末字 10.0 = 0.2
        rows = self.snap([{"source_start": 10.2, "source_end": 15.0}])
        row = rows[0]
        self.assertTrue(row["start_snapped"])
        self.assertAlmostEqual(row["snapped_start"], 10.4 - BRULE["pad_start_s"], places=3)
        self.assertAlmostEqual(row["gap_before_s"], 0.4, places=3)

    def test_end_snap_adds_pad_end(self):
        rows = self.snap([{"source_start": 0.0, "source_end": 9.8}])
        row = rows[0]
        self.assertTrue(row["end_snapped"])
        self.assertAlmostEqual(row["snapped_end"], 10.0 + BRULE["pad_end_s"], places=3)

    def test_no_snap_outside_tolerance(self):
        # 5.25 深处字中间，两端候选距离都 > snap_tolerance_s（除媒体边缘外无气口）
        rows = self.snap([{"source_start": 3.3, "source_end": 5.25}])
        row = rows[0]
        self.assertFalse(row["snapped"])
        self.assertEqual(row["snapped_start"], 3.3)
        self.assertEqual(row["snapped_end"], 5.25)

    def test_inverted_after_snap_gives_up(self):
        # 极短段横跨同一气口：入点吸到 10.4-pad、出点吸到 10.0+pad → 反转 → 放弃
        rows = self.snap([{"source_start": 10.2, "source_end": 10.3}])
        row = rows[0]
        self.assertFalse(row["snapped"])
        self.assertEqual(row.get("note"), "吸附后区间反转，放弃")

    def test_bad_clip_reports_error(self):
        rows = self.snap([{"source_start": "abc"}])
        self.assertIn("error", rows[0])

    def test_energy_annotation_on_snapped_gap(self):
        # 全片 20s 基本安静（P20/P50 都是 -60），只有 10.0-10.4s（窗 100-103）是高能量
        energy = {"window_ms": 100, "rms_db": [-60.0] * 100 + [-10.0] * 4 + [-60.0] * 96}
        rows = self.snap([{"source_start": 10.2, "source_end": 15.0}], energy=energy)
        # 吸附气口区间 [10.0,10.4] 中位能量高于全片 P50 → noisy
        self.assertEqual(rows[0]["start_energy"], "noisy")


class RmsTests(unittest.TestCase):
    def _pcm(self, samples):
        a = array.array("h", samples)
        return a.tobytes()

    def test_silence_hits_floor(self):
        out = snap_breath.rms_windows(self._pcm([0] * 1600), 1600)
        self.assertEqual(out, [snap_breath.FLOOR_DB])

    def test_full_scale_near_zero_db(self):
        out = snap_breath.rms_windows(self._pcm([32767, -32767] * 800), 1600)
        self.assertEqual(len(out), 1)
        self.assertAlmostEqual(out[0], 0.0, delta=0.1)

    def test_partial_window_dropped(self):
        out = snap_breath.rms_windows(self._pcm([1000] * 2000), 1600)
        self.assertEqual(len(out), 1)  # 尾部不满一窗丢弃


if __name__ == "__main__":
    unittest.main()
