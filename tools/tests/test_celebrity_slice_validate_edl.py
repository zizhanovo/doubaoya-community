from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "validate_edl.py"
SPEC = importlib.util.spec_from_file_location("cs_validate_edl", MODULE_PATH)
assert SPEC and SPEC.loader
validate_edl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validate_edl)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)


def make_chars(spans):
    """[(text, start, end)] -> 词级 token 流。"""
    return [{"text": t, "start": s, "end": e} for t, s, e in spans]


def clip(cid, s, e, **kw):
    base = {"id": cid, "source_start": s, "source_end": e,
            "selection_reason": "理由", "selling_point": "卖点"}
    base.update(kw)
    return base


# 连续口播 0-30s（每字 0.5s），在 10.0-10.4 处留一个 0.4s 气口（>= breath_gap_min_s 0.3）
CHARS = make_chars(
    [("字%d" % i, i * 0.5, i * 0.5 + 0.5) for i in range(20)]          # 0.0 - 10.0
    + [("字%d" % i, 10.4 + (i - 20) * 0.5, 10.4 + (i - 20) * 0.5 + 0.5)  # 10.4 - 30.4
       for i in range(20, 60)]
)


def status_of(report, name_prefix):
    for c in report["checks"]:
        if c["check"].startswith(name_prefix):
            return c["status"]
    raise AssertionError("check not found: %s" % name_prefix)


class FailChecksTests(unittest.TestCase):
    def run_checks(self, edl, chars=CHARS, video_exists=True, duration=3600.0, energy=None):
        return validate_edl.run_checks(edl, chars, RULES, video_exists, duration, energy)

    def test_empty_edl_fails(self):
        report = self.run_checks({"clips": []})
        self.assertFalse(report["pass"])
        self.assertEqual(status_of(report, "片段存在"), "fail")

    def test_all_green_pass_case(self):
        # 两段合计 55s，落在 20-120s；切点全部贴在气口/媒体边缘
        edl = {"clips": [clip("c1", 0.0, 10.0), clip("c2", 10.4, 55.4)]}
        chars = make_chars([("字%d" % i, i * 0.5, i * 0.5 + 0.5) for i in range(20)]
                           + [("字%d" % i, 10.4 + (i - 20) * 0.5, 10.9 + (i - 20) * 0.5)
                              for i in range(20, 110)])
        report = self.run_checks(edl, chars=chars)
        self.assertTrue(report["pass"], report)
        self.assertTrue(all(c["status"] == "pass" for c in report["checks"]), report)

    def test_bad_interval_fails(self):
        report = self.run_checks({"clips": [clip("c1", 8.0, 3.0)]})
        self.assertEqual(status_of(report, "时间区间合法"), "fail")
        self.assertFalse(report["pass"])

    def test_over_duration_fails(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 50.0)]}, duration=30.0)
        self.assertEqual(status_of(report, "不超出源视频时长"), "fail")

    def test_unknown_duration_warns_not_fails(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 30.0)]}, duration=None)
        self.assertEqual(status_of(report, "不超出源视频时长"), "warn")

    def test_overlap_fails(self):
        edl = {"clips": [clip("c1", 0.0, 10.0), clip("c2", 8.0, 30.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "源区间不重叠"), "fail")

    def test_illegal_cuts_fail(self):
        edl = {"clips": [clip("c1", 0.0, 30.0,
                              cuts=[{"start": 5.0, "end": 4.0, "reason": "x"}])]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "段内清洗 cuts 合法"), "fail")

    def test_out_of_range_cut_fails(self):
        edl = {"clips": [clip("c1", 10.0, 30.0,
                              cuts=[{"start": 5.0, "end": 12.0, "reason": "越界"}])]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "段内清洗 cuts 合法"), "fail")

    def test_duplicate_id_fails(self):
        edl = {"clips": [clip("c1", 0.0, 10.0), clip("c1", 10.4, 30.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "clip id 唯一"), "fail")

    def test_missing_video_fails(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 30.0)]},
                                 video_exists=False, duration=None)
        self.assertEqual(status_of(report, "源视频存在"), "fail")


class WarnChecksTests(unittest.TestCase):
    def run_checks(self, edl, chars=CHARS, energy=None):
        return validate_edl.run_checks(edl, chars, RULES, True, 3600.0, energy)

    def test_tiny_clip_warns_but_still_passes(self):
        min_clip = RULES["breath_rule"]["min_clip_s"]
        edl = {"clips": [clip("c1", 0.0, min_clip / 2), clip("c2", 10.4, 40.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "无过短碎片"), "warn")
        self.assertTrue(report["pass"])  # warn 不拉 fail

    def test_net_duration_after_cuts_warns(self):
        edl = {"clips": [clip("c1", 0.0, 3.0,
                              cuts=[{"start": 0.2, "end": 2.9, "reason": "口水"}]),
                         clip("c2", 10.4, 40.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "无过短碎片"), "warn")

    def test_off_breath_cut_warns_with_energy_note(self):
        # 出点 5.25 落在字中间（离最近气口 > snap_tolerance_s 0.5）
        edl = {"clips": [clip("c1", 0.0, 5.25), clip("c2", 10.4, 40.0)]}
        energy = {"window_ms": 100, "rms_db": [-30.0] * 600}  # 全片同能量 → mid
        report = self.run_checks(edl, energy=energy)
        self.assertEqual(status_of(report, "切点贴合气口"), "warn")
        detail = [c for c in report["checks"] if c["check"].startswith("切点贴合气口")][0]["detail"]
        self.assertIn("[能量 mid]", detail)

    def test_cut_off_char_boundary_warns(self):
        # 字边界都在 0.5 的整数倍上；cut 边界 5.23 距最近字边界 0.23 > 0.1
        edl = {"clips": [clip("c1", 0.0, 10.0,
                              cuts=[{"start": 5.23, "end": 6.0, "reason": "x"}]),
                         clip("c2", 10.4, 40.0)]}
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "cuts 贴字边界"), "warn")

    def test_silent_range_warns_on_text_verify(self):
        edl = {"clips": [clip("c1", 200.0, 230.0)]}  # 字级时间戳只铺到 30.4s
        report = self.run_checks(edl)
        self.assertEqual(status_of(report, "字级时间戳回验"), "warn")

    def test_total_duration_and_trace_fields_warn(self):
        c = clip("c1", 0.0, 10.0)
        c["selection_reason"] = ""
        report = self.run_checks({"clips": [c]})  # 总时长 10s < 20s 且缺溯源
        self.assertEqual(status_of(report, "总时长与溯源字段"), "warn")

    def test_no_asr_degrades_breath_check_to_warn(self):
        report = self.run_checks({"clips": [clip("c1", 0.0, 30.0)]}, chars=[])
        self.assertEqual(status_of(report, "切点贴合气口"), "warn")
        self.assertEqual(status_of(report, "字级时间戳回验"), "warn")


class HelperTests(unittest.TestCase):
    def test_breath_boundaries_finds_gap(self):
        starts, ends = validate_edl.breath_boundaries(CHARS, RULES["breath_rule"])
        self.assertIn((10.4, 0.4), starts)  # 气口后第一字 start
        self.assertIn((10.0, 0.4), ends)    # 气口前最后一字 end
        self.assertEqual(starts[0], (0.0, None))  # 媒体起点

    def test_clip_net_duration_subtracts_cuts(self):
        c = validate_edl.normalize_clip(
            {"id": "c1", "source_start": 0.0, "source_end": 10.0,
             "cuts": [{"start": 2.0, "end": 4.0, "reason": "x"}]})
        self.assertAlmostEqual(validate_edl.clip_net_duration(c), 8.0, places=3)

    def test_classify_energy_percentiles(self):
        data = {"window_ms": 100, "rms_db": [-60.0] * 20 + [-30.0] * 60 + [-10.0] * 20}
        rule = RULES["energy_rule"]
        # 前 2s 全是最低能量窗 → quiet；末 2s 全是最高能量窗 → noisy
        self.assertEqual(validate_edl.classify_energy(data, rule, 0.0, 1.9), "quiet")
        self.assertEqual(validate_edl.classify_energy(data, rule, 8.1, 10.0), "noisy")
        self.assertEqual(validate_edl.classify_energy(data, rule, 3.0, 6.0), "mid")


class UnwrapEdlTests(unittest.TestCase):
    """snap_breath.py --apply 的输出信封：真 EDL 在 edl 子键下，顶层 clips 是吸附报告行
    （无 id、无 cuts、坐标未吸附）。直传 edl_snapped.json 必须取到 edl 子对象。"""

    SNAPPED = {
        "clips": [{"source_start": 1.15, "source_end": 5.3, "snapped_start": 0.88,
                   "snapped_end": 5.3, "snapped": True}],
        "rule": {}, "energy_rule": None,
        "edl": {"clips": [clip("c1", 0.88, 5.3,
                               cuts=[{"start": 2.0, "end": 2.4, "reason": "口水词"}])]},
    }

    def test_unwraps_snap_breath_envelope(self):
        edl = validate_edl.unwrap_edl(self.SNAPPED)
        self.assertEqual([c["id"] for c in edl["clips"]], ["c1"])
        self.assertEqual(edl["clips"][0]["source_start"], 0.88)  # 吸附后坐标，不是 1.15

    def test_plain_edl_passes_through(self):
        plain = {"clips": [clip("c1", 0.0, 5.0)]}
        self.assertIs(validate_edl.unwrap_edl(plain), plain)

    def test_checks_see_ids_and_cuts_through_envelope(self):
        report = validate_edl.run_checks(
            validate_edl.unwrap_edl(self.SNAPPED), CHARS, RULES, True, 30.0)
        self.assertTrue(report["pass"])                     # id 不为空 → 不误报「重复 id」
        self.assertEqual(status_of(report, "clip id 唯一"), "pass")
        detail = next(c["detail"] for c in report["checks"] if c["check"].startswith("段内清洗"))
        self.assertIn("1 个 cuts", detail)                   # cuts 没被信封吞掉变成「无 cuts」


if __name__ == "__main__":
    unittest.main()
