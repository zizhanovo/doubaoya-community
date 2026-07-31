from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "skills" / "celebrity-slice" / "scripts" / "asr_transcribe.py"
SPEC = importlib.util.spec_from_file_location("cs_asr_transcribe", MODULE_PATH)
assert SPEC and SPEC.loader
at = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(at)

RULES = json.loads(
    (ROOT / "skills" / "celebrity-slice" / "references" / "rules.json").read_text(encoding="utf-8")
)


class PlanChunksTests(unittest.TestCase):
    def test_covers_whole_duration(self):
        chunks = at.plan_chunks(1500.0, 600.0)
        self.assertEqual(chunks, [(0.0, 600.0), (600.0, 600.0), (1200.0, 300.0)])

    def test_short_audio_single_chunk(self):
        self.assertEqual(at.plan_chunks(30.0, 600.0), [(0.0, 30.0)])

    def test_zero_duration_empty(self):
        self.assertEqual(at.plan_chunks(0.0, 600.0), [])


class MergeWordsTests(unittest.TestCase):
    def test_offset_shift_and_sort(self):
        results = [
            (600.0, {"segments": [{"start": 1.0, "end": 2.0, "text": "后",
                                   "words": [{"start": 1.0, "end": 1.5, "text": "后"}]}]}),
            (0.0, {"segments": [{"start": 3.0, "end": 4.0, "text": "前",
                                 "words": [{"start": 3.0, "end": 3.5, "text": "前"}]}]}),
        ]
        tokens = at.merge_words(results)
        self.assertEqual([t["text"] for t in tokens], ["前", "后"])
        self.assertAlmostEqual(tokens[1]["start"], 601.0, places=3)

    def test_segment_without_words_falls_back_to_text(self):
        results = [(10.0, {"segments": [{"start": 0.5, "end": 2.0, "text": "整段"}]})]
        tokens = at.merge_words(results)
        self.assertEqual(tokens, [{"text": "整段", "start": 10.5, "end": 12.0}])


class UserAgentTests(unittest.TestCase):
    def test_falls_back_when_no_version_file(self):
        # .version 由 stamp_versions.py 在发布时生成；仓库里可能有也可能没有
        ua = at._skill_user_agent()
        self.assertTrue(ua == "doubaoya-skill/1.0" or ua.startswith("doubaoya-skill/celebrity-slice@"))


def _fake_response(payload: dict):
    body = json.dumps(payload).encode("utf-8")

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()
            return False

    return Resp(body)


class CallAsrTests(unittest.TestCase):
    def test_success_envelope_returns_data(self):
        envelope = {"success": True, "requestId": "r1",
                    "data": {"segments": [{"start": 0.0, "end": 1.0, "text": "喂",
                                           "words": [{"start": 0.0, "end": 1.0, "text": "喂"}]}]},
                    "error": None}
        with mock.patch.object(at.urllib.request, "urlopen", return_value=_fake_response(envelope)) as m:
            data = at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertEqual(len(data["segments"]), 1)
        req = m.call_args[0][0]
        self.assertEqual(req.get_header("Authorization"), "Bearer dyh_test")

    def _http_error(self, status, code, message):
        body = json.dumps({"success": False, "requestId": "r2", "data": None,
                           "error": {"code": code, "message": message}}).encode("utf-8")
        return urllib.error.HTTPError("u", status, "err", {}, io.BytesIO(body))

    def test_402_prints_credits_message(self):
        err = self._http_error(402, "INSUFFICIENT_CREDITS", "余额不足")
        stderr = io.StringIO()
        with mock.patch.object(at.urllib.request, "urlopen", side_effect=err), \
             mock.patch.object(at.sys, "stderr", stderr):
            with self.assertRaises(SystemExit):
                at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertIn("INSUFFICIENT_CREDITS", stderr.getvalue())
        self.assertIn("扣点", stderr.getvalue())

    def test_502_prints_refund_retry_message(self):
        err = self._http_error(502, "PROVIDER_FAILED", "上游失败")
        stderr = io.StringIO()
        with mock.patch.object(at.urllib.request, "urlopen", side_effect=err), \
             mock.patch.object(at.sys, "stderr", stderr):
            with self.assertRaises(SystemExit):
                at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertIn("已自动退款", stderr.getvalue())
        self.assertIn("重试", stderr.getvalue())

    def test_404_prints_not_launched_degradation(self):
        err = self._http_error(404, "NOT_FOUND", "no such api")
        stderr = io.StringIO()
        with mock.patch.object(at.urllib.request, "urlopen", side_effect=err), \
             mock.patch.object(at.sys, "stderr", stderr):
            with self.assertRaises(SystemExit):
                at.call_asr("dyh_test", at.DEFAULT_ENDPOINT, "QUJD", "zh")
        self.assertIn("待后端上线", stderr.getvalue())
        self.assertIn("whisper", stderr.getvalue())


class MissingKeyTests(unittest.TestCase):
    def test_main_exits_2_with_degradation_hint(self):
        stderr = io.StringIO()
        with mock.patch.dict(at.os.environ, {}, clear=True), \
             mock.patch.object(at.sys, "stderr", stderr), \
             mock.patch.object(at.sys, "argv", ["asr_transcribe.py", "fake.mp4"]):
            self.assertEqual(at.main(), 2)
        self.assertIn("DOUBAOYA_API_KEY", stderr.getvalue())
        self.assertIn("whisper", stderr.getvalue())  # 降级路径提示（spec §4.1）


class SrtTests(unittest.TestCase):
    def test_build_srt_groups_and_formats(self):
        tokens = [{"text": ch, "start": i * 0.3, "end": (i + 1) * 0.3}
                  for i, ch in enumerate("这个面料真的不错，后半句还在继续说")]
        srt = at.build_srt(tokens, RULES["caption_group_rule"])
        self.assertTrue(srt.startswith("1\n00:00:00,000 --> "))
        # 标点前 9 字 >= punct_flush_min_chars(8) → 「，」处独立成块
        self.assertIn("\n这个面料真的不错，\n", srt)


if __name__ == "__main__":
    unittest.main()
