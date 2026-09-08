"""Neutral behavior fixtures only: no model, real audio, or Gold."""
import unittest
import numpy as np
from occurrence_tail import onset_paths, support, hypothesis, prior_dependence, pcm_candidates, pcm_prefix_integrity


def fixture(early=True, late=True):
    probs = np.full((100,4),.001)
    probs[:,0] = .997
    probs[5] = [.03,.96,.005,.005]
    for start, strength in [(20,.7 if early else .001),(65,.97 if late else .001)]:
        for f,t in [(start,2),(start+5,3)]:
            probs[f] = [.997,.001,.001,.001]
            probs[f,0],probs[f,t] = 1-strength-.002,strength
    anchors=[{'startFrame':5,'endFrameExclusive':6},{'startFrame':20,'endFrameExclusive':21},{'startFrame':25,'endFrameExclusive':26}]
    return np.log(probs),anchors


def solve(early=True,late=True):
    p,a=fixture(early,late);r=onset_paths(p,[1,2,3],0,a,1)
    for row in r['paths']:
        row['support']=support(row,1,.02)
    return r


def tone(end=1.5, duration=3, frequency=300):
    rate=16000;t=np.arange(round(duration*rate))/rate
    return np.where(t<end,.4*np.sin(2*np.pi*frequency*t),0).astype(np.float64)


class OccurrenceTests(unittest.TestCase):
    def test_independent_crop_tail_is_recorded_without_rewriting_pcm(self):
        a=np.zeros(100);b=np.zeros(120);b[99]=1/32768
        result=pcm_prefix_integrity(a,b,80,0,0)
        self.assertTrue(result['frameCoveredPrefixIdentical']);self.assertFalse(result['fullPrefixIdentical'])
        self.assertEqual(result['differenceIndexRange'],[99,99]);self.assertEqual(b[99],1/32768)

    def test_shared_observed_pcm_difference_fails_closed(self):
        a=np.zeros(100);b=np.zeros(120);b[79]=1/32768
        with self.assertRaisesRegex(ValueError,'SOURCE_FRAME_COVERED_PCM_MISMATCH'):
            pcm_prefix_integrity(a,b,80,0,0)
        with self.assertRaisesRegex(ValueError,'SOURCE_PCM_TIMEBASE_MISMATCH'):
            pcm_prefix_integrity(a,a,80,0,1)

    def test_weaker_early_is_preserved_beside_stronger_late(self):
        rows=solve()['paths']
        a=hypothesis(rows,15,30,1,.02);b=hypothesis(rows,55,80,1,.02)
        self.assertGreater(a['supportedPathCount'],0);self.assertGreater(b['supportedPathCount'],0)
        self.assertEqual(a['bestPath']['onsetFrame'],20);self.assertEqual(b['bestPath']['onsetFrame'],65)

    def test_late_only_cannot_force_original(self):
        a=hypothesis(solve(False,True)['paths'],15,30,1,.02)
        self.assertGreater(a['finitePathCount'],0);self.assertEqual(a['status'],'H_UNSUPPORTED')

    def test_noise_original_cannot_force_original(self):
        p,a=fixture(False,True);p[15:30]=np.log(np.full((15,4),.25))
        rows=onset_paths(p,[1,2,3],0,a,1)['paths']
        for r in rows:r['support']=support(r,1,.02)
        # Uniform labels cannot be discriminated from blank: require more than
        # a finite path, and do not interpret equal likelihood as support.
        chosen=hypothesis(rows,15,25,1,.02)
        self.assertEqual(chosen['status'],'H_UNSUPPORTED')

    def test_no_target_support_despite_finite_paths(self):
        rows=solve(False,False)['paths']
        self.assertTrue(rows);self.assertFalse(any(r['support']['supported'] for r in rows))

    def test_single_frame_labels_and_long_clear_tail(self):
        r=hypothesis(solve()['paths'],15,30,1,.02)['bestPath']
        self.assertEqual(r['support']['singleFrameRatio'],1)
        c=pcm_candidates(tone(),16000,.4,.52,2.)
        self.assertIsNotNone(c['selectedEndSeconds']);self.assertAlmostEqual(c['selectedEndSeconds'],1.5)
        self.assertGreater(c['selectedEndSeconds']-.52,.5)

    def test_label_peak_without_end_abstains(self):
        c=pcm_candidates(tone(end=3),16000,.4,.52,2.)
        self.assertIsNone(c['selectedEndSeconds'])

    def test_background_drop_not_automatically_target_end(self):
        a=tone(end=.7);b=tone(end=1.5,frequency=1300)
        a[int(.7*16000):]=b[int(.7*16000):]
        c=pcm_candidates(a,16000,.4,.52,2.)
        self.assertTrue(c['candidates']);self.assertIsNone(c['selectedEndSeconds'])

    def test_next_occurrence_is_limit_not_answer(self):
        c=pcm_candidates(tone(end=2),16000,.4,.52,1.2)
        self.assertIsNone(c['selectedEndSeconds']);self.assertEqual(c['searchSeconds'][1],1.2)

    def test_overlap_spectral_mixture_abstains(self):
        a=tone();a[int(.7*16000):]+=tone(end=2,frequency=1300)[int(.7*16000):]
        c=pcm_candidates(a,16000,.4,.52,2.2)
        self.assertIsNone(c['selectedEndSeconds'])

    def test_prior_dominated_does_not_erase_early_candidate(self):
        rows=solve()['paths'];a=hypothesis(rows,15,30,1,.02);b=hypothesis(rows,15,80,1,.02)
        self.assertTrue(prior_dependence(a,b));self.assertGreater(a['supportedPathCount'],0)

    def test_truncation_can_differ_from_narrow_label(self):
        a=tone();short=pcm_candidates(a[:16000],16000,.4,.52,1.)
        long=pcm_candidates(a,16000,.4,.52,2.)
        self.assertIsNone(short['selectedEndSeconds']);self.assertIsNotNone(long['selectedEndSeconds'])

    def test_extended_window_still_truncated(self):
        self.assertIsNone(pcm_candidates(tone(end=3),16000,.4,.52,3.)['selectedEndSeconds'])

    def test_same_text_identity_is_onset_not_string(self):
        rows=solve()['paths'];self.assertIn(20,[r['onsetFrame'] for r in rows]);self.assertIn(65,[r['onsetFrame'] for r in rows])

    def test_resource_cap_reports_search_incomplete(self):
        p,a=fixture();p=np.repeat(p,20,axis=0)
        self.assertEqual(onset_paths(p,[1,2,3],0,a,1)['status'],'SEARCH_INCOMPLETE')

    def test_small_exhaustive_onset_completion_oracle(self):
        rng=np.random.default_rng(44)
        for ids in [[1,2],[1,1]]:
            p=rng.uniform(.1,1,(7,3));p=np.log(p/p.sum(axis=1,keepdims=True));rel=p-p.max(axis=1,keepdims=True)
            anchors=[{'startFrame':0,'endFrameExclusive':7} for _ in ids]
            result=onset_paths(p,ids,0,anchors,0)
            oracle={};labels=[0,ids[0],0,ids[1],0]
            def visit(seq):
                s=seq[-1];f=len(seq)-1
                if s==3:
                    onset=seq.index(1);score=sum(rel[i,labels[x]] for i,x in enumerate(seq))
                    oracle[(onset,f)]=max(score,oracle.get((onset,f),-np.inf))
                if len(seq)==7:return
                for n in [s,s+1,s+2]:
                    if n<5 and (n-s<2 or (n%2 and labels[n]!=labels[s])):visit(seq+[n])
            visit([0]);visit([1])
            actual={(r['onsetFrame'],r['completionScoreOffset']+i):s for r in result['paths'] for i,s in enumerate(r['completionScores']) if s is not None}
            self.assertEqual(actual.keys(),oracle.keys())
            for k,v in oracle.items():self.assertAlmostEqual(actual[k],v)


if __name__=='__main__':unittest.main()
