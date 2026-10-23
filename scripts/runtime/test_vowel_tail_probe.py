"""Neutral controls: no reference or real target thresholds."""
import unittest
import numpy as np
from vowel_tail_probe import analyze


def tone(end=1.5, frequency=300):
    t = np.arange(48000) / 16000
    return np.where(t < end, .4 * np.sin(2 * np.pi * frequency * t), 0)


class TailProbeTests(unittest.TestCase):
    def test_non_vocal_tone_can_pass_but_never_authorizes_speech(self):
        r = analyze(tone(), 16000, [.4, .52], 66.93)
        self.assertAlmostEqual(r["sourceSelectedEnd"], 68.43)
        self.assertFalse(r["speechIdentityEstablished"])
        self.assertFalse(r["subtitleMutationAuthorized"])

    def test_silence_abstains(self):
        self.assertIsNone(analyze(np.zeros(48000), 16000, [.4, .52], 0)["sourceSelectedEnd"])

    def test_no_drop_abstains(self):
        self.assertIsNone(analyze(tone(3), 16000, [.4, .52], 0)["sourceSelectedEnd"])

    def test_background_switch_abstains(self):
        audio = tone(.7)
        audio[11200:] = tone(1.5, 1300)[11200:]
        r = analyze(audio, 16000, [.4, .52], 0)
        self.assertTrue(r["candidates"])
        self.assertIsNone(r["sourceSelectedEnd"])

    def test_mixture_abstains(self):
        audio = tone()
        audio[11200:] += tone(1.5, 1300)[11200:]
        self.assertIsNone(analyze(audio, 16000, [.4, .52], 0)["sourceSelectedEnd"])

    def test_bad_seed_and_rate_fail(self):
        for rate, seed in [(8000, [.4, .52]), (16000, [1, .5]), (16000, [0, 3]), (16000, [0, float("nan")])]:
            with self.assertRaises(ValueError):
                analyze(tone(), rate, seed, 0)

    def test_pcm_not_mutated(self):
        audio = tone()
        before = audio.copy()
        analyze(audio, 16000, [.4, .52], 0)
        np.testing.assert_array_equal(audio, before)


if __name__ == "__main__":
    unittest.main()
