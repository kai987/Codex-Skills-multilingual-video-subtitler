import importlib.util
import pathlib
import sys
import unittest

RUNTIME = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "runtime"
sys.path.insert(0, str(RUNTIME))
spec = importlib.util.spec_from_file_location("word_probe", RUNTIME / "local_word_timing_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class WordTimingAudit(unittest.TestCase):
    target = {"id": "synthetic", "start": 100, "frames": 64000}

    def result(self, words, text="ああ", start=0, end=4):
        return probe.audit({"segments": [{"start": start, "end": end, "text": text, "words": words}]}, self.target)

    def test_preserve_and_offset_once_without_authorizing(self):
        word = {"word": "ああ", "start": 1.2, "end": 1.8, "probability": 0.9}
        row = self.result([word])["words"][0]
        self.assertEqual(row["raw"], word)
        self.assertEqual((row["sourceStart"], row["sourceEnd"]), (101.2, 101.8))
        self.assertTrue(row["structurallyUsable"])
        self.assertFalse(row["timingQualityVerified"])
        self.assertFalse(row["subtitleMutationAuthorized"])

    def test_zero_and_overrun_not_clamped(self):
        for start, end in [(1, 1), (-0.01, 1), (2, 4.01)]:
            row = self.result([{"word": "ああ", "start": start, "end": end}])["words"][0]
            self.assertIn("INVALID_LOCAL_INTERVAL", row["issues"])
            self.assertEqual(row["raw"]["end"], end)

    def test_non_monotonic(self):
        rows = self.result([{"word": "あ", "start": 1, "end": 2},
                            {"word": "あ", "start": 1.9, "end": 2.5}])["words"]
        self.assertIn("NON_MONOTONIC_WORDS", rows[1]["issues"])

    def test_parent_containment(self):
        row = self.result([{"word": "ああ", "start": 1, "end": 2}], start=1.5)["words"][0]
        self.assertIn("OUTSIDE_PARENT_SEGMENT", row["issues"])

    def test_crop_edge(self):
        row = self.result([{"word": "ああ", "start": 0, "end": 1}])["words"][0]
        self.assertIn("CROP_EDGE_WORD", row["issues"])

    def test_text_mismatch(self):
        row = self.result([{"word": "あ", "start": 1, "end": 2}])["words"][0]
        self.assertIn("WORD_TEXT_ACCOUNTING_MISMATCH", row["issues"])

    def test_empty_not_nonspeech(self):
        result = self.result([])
        self.assertTrue(result["missingWords"])
        self.assertEqual(result["status"], "needs-review")

    def test_native_numpy_and_json_roundtrip_match(self):
        import json
        import numpy as np
        raw = {"segments": [{"start": 0, "end": 4, "text": "ああ", "words": [
            {"word": "ああ", "start": np.float64(1.2), "end": np.float64(1.8)}]}]}
        native = probe.audit(raw, self.target)
        self.assertTrue(native["words"][0]["structurallyUsable"])
        self.assertEqual(native, probe.audit(json.loads(json.dumps(raw)), self.target))

    def test_boolean_is_not_timestamp(self):
        row = self.result([{"word": "ああ", "start": True, "end": 2}])["words"][0]
        self.assertIn("INVALID_LOCAL_INTERVAL", row["issues"])


if __name__ == "__main__":
    unittest.main()
