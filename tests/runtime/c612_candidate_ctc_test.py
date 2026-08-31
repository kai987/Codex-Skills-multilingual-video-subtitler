"""Toy-logit tests; no from_pretrained, model weights, audio input or network."""
import pathlib
import sys
import types
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts" / "runtime"))
from c612_candidate_ctc_worker import target_occupancy
from independent_ctc_discriminator_worker import torch, score_target


class ToyTokenizer:
    unk_token_id = 3

    def __call__(self, text, add_special_tokens=False):
        return types.SimpleNamespace(input_ids=[{"a": 1, "b": 2}.get(c, 3) for c in text])


class C612CtcTest(unittest.TestCase):
    def probabilities(self, rows):
        return torch.log_softmax(torch.tensor(rows, dtype=torch.float32), dim=-1)

    def test_complete_ordered_target(self):
        values = self.probabilities([[0, 9, 0, 0], [0, 9, 0, 0], [9, 0, 0, 0], [0, 0, 9, 0]])
        result = target_occupancy(values, [1, 2], 0, 2)
        self.assertEqual([r["index"] for r in result], [0, 1])
        self.assertGreater(result[0]["posterior"], 0.99)
        self.assertLessEqual(result[-1]["end"], 2)
        self.assertNotIn("text", result[0])

    def test_wrong_target_is_not_forced_certainty(self):
        values = self.probabilities([[0, 10, 0, 0]] * 8)
        result = target_occupancy(values, [2], 0, 1)
        self.assertLess(result[0]["posterior"], 0.01)

    def test_empty_and_too_long_targets(self):
        values = self.probabilities([[0, 1, 2, 0]])
        self.assertEqual(target_occupancy(values, [], 0, 1), [])
        self.assertEqual(target_occupancy(values, [1, 2], 0, 1), [])

    def test_repeated_tokens_need_blank_separation(self):
        values = self.probabilities([[0, 9, 0, 0], [9, 0, 0, 0], [0, 9, 0, 0]])
        result = target_occupancy(values, [1, 1], 0, 1.5)
        self.assertEqual(len(result), 2)
        self.assertLessEqual(result[0]["end"], result[1]["start"])

    def test_unscorable_target_keeps_loss_null(self):
        values = self.probabilities([[0, 9, 0, 0]] * 8)
        result = score_target(values, ToyTokenizer(), [{"type": "DISPLAY", "text": "z"}], 0, 0.95)
        self.assertIsNone(result["nllPerTargetToken"])
        self.assertIn("UNSCORABLE_LOW_COVERAGE", result["blockers"])

    def test_same_audio_correct_target_has_lower_ctc_loss(self):
        values = self.probabilities([[0, 9, 0, 0]] * 8)
        a = score_target(values, ToyTokenizer(), [{"type": "DISPLAY", "text": "a"}], 0, 0.95)
        b = score_target(values, ToyTokenizer(), [{"type": "DISPLAY", "text": "b"}], 0, 0.95)
        self.assertLess(a["nllPerTargetToken"], b["nllPerTargetToken"])


if __name__ == "__main__":
    unittest.main()
