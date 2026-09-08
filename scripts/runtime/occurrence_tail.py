"""Fixed-transcript, exact-onset CTC replay. No neural imports or decoding.

Completeness: best path for EVERY declared exact onset and completion frame,
not every latent CTC path. Onsets are never pruned by another onset's score.
"""
import math
import numpy as np

POLICY = {
    'version': 'c6011642-exact-onset-tail-v1',
    'originalBandSeconds': .5, 'wideBandSeconds': 1.,
    'prefixBandFrames': 10, 'maxFrames': 1600, 'maxTokens': 128,
    'maxCells': 40000000, 'completionBand': 2.,
    'minimumTokenPeak': .1, 'minimumMedianPeak': .2,
    'minimumMedianLogOddsBlank': math.log(2.), 'maximumInternalGapSeconds': .4,
    'minimumPrefixCoverage': .75, 'onsetClusterGapSeconds': .12,
    'stabilitySeconds': .12, 'maximumTailSearchSeconds': 1.5,
    'pcmCellSeconds': .02, 'dropDb': 6., 'holdCells': 6,
    'minimumLevelDb': -60., 'minimumSpectralCosine': .95,
    'minimumContinuousFraction': .9,
}


def _table(logp, ids, blank, anchors, prefix, onset=None):
    labels = [blank]
    for x in ids:
        labels.extend([x, blank])
    fcount, states = len(logp), len(labels)
    relative = logp - logp.max(axis=1, keepdims=True)
    dp = np.full((fcount, states), -np.inf)
    back = np.full((fcount, states), -1, dtype=np.int16)
    # Reference implementation used by small exhaustive tests and prefix pass.
    def allowed(f, s):
        if not s % 2:
            return True
        i = s // 2
        if i < prefix:
            return anchors[i]['startFrame']-POLICY['prefixBandFrames'] <= f < anchors[i]['endFrameExclusive']+POLICY['prefixBandFrames']
        return True
    dp[0, 0] = relative[0, blank]
    if allowed(0, 1) and (prefix or onset in (None, 0)):
        dp[0, 1] = relative[0, ids[0]]
    for f in range(1, fcount):
        for s in range(states):
            if not allowed(f, s):
                continue
            choices = [(dp[f-1, s], s)]
            if s:
                choices.append((dp[f-1, s-1], s-1))
            if s >= 2 and s % 2 and labels[s] != labels[s-2]:
                choices.append((dp[f-1, s-2], s-2))
            if s == 2*prefix+1 and onset is not None:
                choices = [c for c in choices if (f > onset and c[1] == s) or (f == onset and c[1] != s)]
            if choices:
                score, prev = max(choices, key=lambda c: c[0])
                dp[f, s] = score + relative[f, labels[s]]
                back[f, s] = prev
    return dp, back, labels


def onset_paths(logp, ids, blank, anchors, prefix, first_onset=0):
    """Reuse the prefix DP, then solve each exact first-target-entry separately."""
    fcount = len(logp)
    states = 2*len(ids)+1
    cells = fcount*states + (fcount-first_onset)*(fcount-first_onset+1)//2*(2*(len(ids)-prefix)-1)
    if fcount > POLICY['maxFrames'] or len(ids) > POLICY['maxTokens'] or cells > POLICY['maxCells']:
        return {'status': 'SEARCH_INCOMPLETE', 'estimatedCells': cells, 'paths': [], 'dpOnsets': 0}
    if not 0 <= prefix < len(ids) or len(anchors) != len(ids):
        raise ValueError('INVALID_TARGET_PREFIX')
    pd, pb, labels = _table(logp, ids, blank, anchors, len(ids))
    rel = logp-logp.max(axis=1, keepdims=True)
    first_state, terminal = 2*prefix+1, states-2
    rows = []
    for onset in range(first_onset, fcount):
        pred = []
        if onset == 0 and prefix == 0:
            pred = [(0., -1)]
        elif onset:
            pred = [(pd[onset-1, first_state-1], first_state-1)]
            if prefix and ids[prefix] != ids[prefix-1]:
                pred.append((pd[onset-1, first_state-2], first_state-2))
        if not pred or not math.isfinite(max(x[0] for x in pred)):
            continue
        score, prev = max(pred, key=lambda x:x[0])
        prefix_path = []
        if onset:
            state = prev
            prefix_path = [0]*onset
            for f in range(onset-1, -1, -1):
                prefix_path[f] = state
                if f:
                    state = int(pb[f, state])
        count = terminal-first_state+1
        d = np.full((fcount-onset, count), -np.inf)
        b = np.full(d.shape, -1, dtype=np.int16)
        d[0, 0] = score+rel[onset, ids[prefix]]
        for k in range(1, len(d)):
            for s in range(count):
                absolute = s+first_state
                choices = [(d[k-1, s], s)]
                if s:
                    choices.append((d[k-1, s-1], s-1))
                if s >= 2 and absolute % 2 and labels[absolute] != labels[absolute-2]:
                    choices.append((d[k-1, s-2], s-2))
                val, predecessor = max(choices, key=lambda x:x[0])
                d[k, s] = val+rel[onset+k, labels[absolute]]
                b[k, s] = predecessor
        scores = d[:, -1]
        if not np.isfinite(scores).any():
            continue
        best = int(np.argmax(scores))
        state = count-1
        target_path = [0]*(best+1)
        for k in range(best, -1, -1):
            target_path[k] = state+first_state
            if k:
                state = int(b[k, state])
        selected = prefix_path+target_path
        spans = []
        for i, token in enumerate(ids):
            occupied = np.flatnonzero(np.array(selected) == 2*i+1)
            if not len(occupied):
                raise ValueError('INCOMPLETE_BACKTRACE')
            peak_frame = int(occupied[np.argmax(logp[occupied, token])])
            spans.append({'targetIndex': i, 'tokenId': token, 'startFrame': int(occupied[0]),
                          'endFrameExclusive': int(occupied[-1])+1,
                          'peakPosterior': float(np.exp(logp[peak_frame, token])),
                          'peakLogOddsBlank': float(logp[peak_frame, token]-logp[peak_frame, blank]),
                          'meanPosterior': float(np.exp(logp[occupied, token]).mean())})
        rows.append({'onsetFrame': onset, 'completionFrameExclusive': onset+best+1,
                     'relativePathScore': float(scores[best]),
                     'normalizedRelativeScore': float(scores[best]/(onset+best+1)),
                     'completionScores': [float(x) if math.isfinite(x) else None for x in scores],
                     'completionScoreOffset': onset,
                     'alternativeCompletionFrames': (np.flatnonzero(scores >= scores[best]-POLICY['completionBand'])+onset+1).tolist(),
                     'tokenSpans': spans, 'statePath': selected,
                     'unknownSuffixFrames': [onset+best+1, fcount]})
    return {'status': 'COMPLETE_DECLARED_ONSET_COMPLETION_DOMAINS', 'estimatedCells': cells,
            'paths': rows, 'dpOnsets': fcount-first_onset}


def support(row, prefix, dt):
    spans = row['tokenSpans'][prefix:]
    peaks = [s['peakPosterior'] for s in spans]
    odds = [s['peakLogOddsBlank'] for s in spans]
    gaps = [(b['startFrame']-a['endFrameExclusive'])*dt for a,b in zip(spans,spans[1:])]
    old = row['tokenSpans'][:prefix]
    coverage = sum(s['peakPosterior'] >= POLICY['minimumTokenPeak'] for s in old)/len(old) if old else 1.
    reasons = []
    if min(peaks) < POLICY['minimumTokenPeak'] or np.median(peaks) < POLICY['minimumMedianPeak']:
        reasons.append('ABSOLUTE_TARGET_SUPPORT_INSUFFICIENT')
    if np.median(odds) < POLICY['minimumMedianLogOddsBlank']:
        reasons.append('TARGET_NOT_DISTINGUISHED_FROM_BLANK')
    if max(gaps, default=0) > POLICY['maximumInternalGapSeconds']:
        reasons.append('UNEXPLAINED_INTERNAL_GAP')
    if coverage < POLICY['minimumPrefixCoverage']:
        reasons.append('PREFIX_SUPPORT_INSUFFICIENT')
    return {'supported': not reasons, 'reasons': reasons, 'tokenPeakPosteriors': peaks,
            'medianPeakPosterior': float(np.median(peaks)), 'medianLogOddsBlank': float(np.median(odds)),
            'prefixCoverage': coverage, 'maximumInternalGapSeconds': max(gaps,default=0),
            'singleFrameRatio': sum(s['endFrameExclusive']-s['startFrame']==1 for s in spans)/len(spans)}


def hypothesis(rows, lo, hi, prefix, dt):
    candidates = [r for r in rows if lo <= r['onsetFrame'] <= hi]
    supported = [r for r in candidates if r['support']['supported']]
    # Equal-token-count target peak log support prevents comparing raw sums
    # over differently sized open paths. Normalized path cost is a tie-break;
    # neither score is calibrated, and peak selection has an optimism bias.
    chosen = max(supported or candidates, key=lambda r:(
        float(np.mean(np.log(np.maximum(r['support']['tokenPeakPosteriors'],1e-300)))),
        r['normalizedRelativeScore'],-r['onsetFrame']), default=None)
    clusters = []
    for r in supported:
        if not clusters or (r['onsetFrame']-clusters[-1][-1])*dt > POLICY['onsetClusterGapSeconds']:
            clusters.append([])
        clusters[-1].append(r['onsetFrame'])
    return {'domainFrames': [lo,hi], 'finitePathCount': len(candidates), 'supportedPathCount': len(supported),
            'supportedOnsetClusters': clusters, 'chosenOnsetFrame': chosen['onsetFrame'] if chosen else None,
            'bestPath': chosen, 'status': 'CONDITIONAL_SUPPORT' if supported else 'H_UNSUPPORTED'}


def prior_dependence(main, wide):
    a, b = main['bestPath'], wide['bestPath']
    return bool(a and b and main['supportedPathCount'] and
                not main['domainFrames'][0] <= b['onsetFrame'] <= main['domainFrames'][1])


def pcm_candidates(audio, rate, start, label_end, stop):
    """One RMS plus spectral-continuity method; retains ALL transition candidates.

    Spectral cosine is a deterministic attribution heuristic, never speaker or
    voice identity. A clear synthetic sustain may pass; ambiguous mixtures abstain.
    """
    dt = POLICY['pcmCellSeconds']; hop = round(rate*dt); hold = POLICY['holdCells']
    cells = np.asarray(audio[:len(audio)//hop*hop]).reshape(-1,hop)
    levels = 20*np.log10(np.maximum(1e-9,np.sqrt(np.mean(cells**2,axis=1))))
    power = np.abs(np.fft.rfft(cells*np.hanning(hop)))**2
    norms = np.linalg.norm(power,axis=1)
    spectra = power/np.maximum(norms[:,None],1e-20)
    a, e = max(0,int(start/dt)), min(len(cells),math.ceil(label_end/dt))
    seed = spectra[a:e].mean(axis=0) if e>a else np.zeros(spectra.shape[1])
    seed /= max(float(np.linalg.norm(seed)),1e-20)
    continuity = spectra@seed
    stop = min(stop,len(audio)/rate,label_end+POLICY['maximumTailSearchSeconds'])
    seed_level = float(np.median(levels[a:e])) if e>a else -180.
    values = []
    for i in range(max(hold,e),min(len(cells)-hold+1,math.floor(stop/dt)+1)):
        if i*dt >= stop:
            continue
        before, after = levels[i-hold:i], levels[i:i+hold]
        drop = float(np.median(before)-max(after))
        if drop < POLICY['dropDb'] or np.median(before) < POLICY['minimumLevelDb']:
            continue
        tail = slice(e,i)
        continuous = float(np.mean((continuity[tail] >= POLICY['minimumSpectralCosine']) &
                                  (levels[tail] >= seed_level-POLICY['dropDb']))) if i>e else 0.
        reasons = []
        if continuous < POLICY['minimumContinuousFraction']:
            reasons.append('TAIL_NOT_SEPARABLE_FROM_BACKGROUND_OR_NEXT_SPEECH')
        values.append({'endSeconds': i*dt, 'dropDb': drop, 'continuousTailFraction': continuous,
                       'postChangeObservedSeconds': hold*dt, 'heuristicSupported': not reasons,
                       'reasons': reasons})
    admissible = [c for c in values if c['heuristicSupported']]
    # Adjacent cells of one physical drop form a range, not spurious many ends.
    clusters = []
    for c in admissible:
        if not clusters or c['endSeconds']-clusters[-1][-1]['endSeconds'] > dt*1.01:
            clusters.append([])
        clusters[-1].append(c)
    unique = clusters[0] if len(clusters)==1 else []
    return {'method': 'RMS_DROP_WITH_SPECTRAL_CONTINUITY_V1', 'searchSeconds': [label_end,stop],
            'levelsDb': levels.tolist(), 'spectralContinuity': continuity.tolist(),
            'candidates': values, 'supportedClusters': clusters,
            'candidateEndRange': [min(c['endSeconds'] for c in values),max(c['endSeconds'] for c in values)] if values else None,
            'selectedEndSeconds': unique[0]['endSeconds'] if unique else None,
            'status': 'HEURISTIC_TAIL_CANDIDATE' if unique else 'MULTIPLE_PLAUSIBLE_ENDS' if len(clusters)>1 else
                      'TAIL_NOT_SEPARABLE_FROM_BACKGROUND_OR_NEXT_SPEECH' if values else 'RIGHT_CENSORED_OR_END_UNOBSERVED',
            'acousticTruthConfirmed': False}
