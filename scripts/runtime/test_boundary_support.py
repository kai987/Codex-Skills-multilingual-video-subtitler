"""Synthetic behavior tests; no model load or real acoustic claims."""
import unittest
import numpy as np
from boundary_support import open_suffix, rms_transition


class BoundaryTests(unittest.TestCase):
    def test_later_repeat_not_unconditionally_assigned(self):
        p = np.full((60, 3), -9.0)
        p[:, 0] = -.01
        p[5:8, 1], p[5:8, 0] = -.01, -9
        p[15:18, 2], p[15:18, 0] = -.01, -9
        p[40:43, 2], p[40:43, 0] = -.01, -9
        r = open_suffix(p, [1, 2], 0, [{'startFrame':5,'endFrameExclusive':8},{'startFrame':15,'endFrameExclusive':18}], 1)
        self.assertLess(r['tokenSpans'][-1]['startFrame'], 30)
        self.assertLess(r['unassignedSuffixFrames'][0], 40)

    def test_one_frame_peak_is_not_pcm_end(self):
        audio = np.ones(16000, dtype=np.float32)*.5
        audio[12800:] = 0
        r = rms_transition(audio, 16000, .4)
        self.assertAlmostEqual(r['selected']['seconds'], .8)

    def test_continuous_energy_has_no_known_end(self):
        self.assertIsNone(rms_transition(np.ones(16000),16000,.4)['selected'])

    def test_prefix_cannot_relocate_to_late_repeat(self):
        p=np.full((80,3),-9.0);p[:,0]=-.01
        p[50:53,1]=-.01;p[50:53,0]=-9
        p[60:63,2]=-.01;p[60:63,0]=-9
        r=open_suffix(p,[1,2],0,[{'startFrame':5,'endFrameExclusive':8},{'startFrame':15,'endFrameExclusive':18}],1)
        self.assertLess(r['tokenSpans'][0]['startFrame'],18)


if __name__=='__main__':
    unittest.main()
