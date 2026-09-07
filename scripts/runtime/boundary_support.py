"""One fixed, conditional open-suffix alignment and bounded RMS transition method.

No recognition decode. Unknown suffix is neither silence nor target occupancy.
All calculations can be replayed from full log probabilities and original PCM.
"""
import math
import numpy as np


def open_suffix(logp, ids, blank, anchors, prefix_count, anchor_band_frames=10):
    frames = len(logp)
    labels = [blank]
    for token in ids:
        labels.extend([token, blank])
    states = len(labels)
    # Subtract an unconstrained scalar acoustic baseline, never decode its IDs.
    # This makes completion scores comparable without assigning suffix frames.
    relative = logp - logp.max(axis=1, keepdims=True)
    dp = np.full((frames, states), -np.inf)
    back = np.full((frames, states), -1, dtype=np.int32)

    def allowed(f, s):
        if s % 2 == 0:
            return True
        i = s // 2
        if i >= prefix_count:
            return True
        a = anchors[i]
        return a['startFrame'] - anchor_band_frames <= f < a['endFrameExclusive'] + anchor_band_frames

    dp[0, 0] = relative[0, blank]
    if allowed(0, 1):
        dp[0, 1] = relative[0, ids[0]]
    for f in range(1, frames):
        for s in range(states):
            if not allowed(f, s):
                continue
            candidates = [(dp[f-1, s], s)]
            if s:
                candidates.append((dp[f-1, s-1], s-1))
            if s >= 2 and s % 2 and labels[s] != labels[s-2]:
                candidates.append((dp[f-1, s-2], s-2))
            score, prev = max(candidates, key=lambda x: x[0])
            dp[f, s] = score + relative[f, labels[s]]
            back[f, s] = prev
    terminal = states - 2
    scores = dp[:, terminal]
    if not np.isfinite(scores).any():
        return {'status': 'NO_VALID_PREFIX_ANCHORED_PATH', 'alternatives': [], 'tokenSpans': [], 'statePath': []}
    # All near-optimal separated completion locations are retained, not just best.
    best = float(scores.max())
    eligible = np.flatnonzero(scores >= best - 2.0).tolist()
    clusters = []
    for f in eligible:
        if not clusters or f - clusters[-1][-1] > 6:
            clusters.append([])
        clusters[-1].append(f)

    def recover(end):
        state = terminal
        selected = [0] * (end + 1)
        for f in range(end, -1, -1):
            selected[f] = state
            if f:
                state = int(back[f, state])
                if state < 0:
                    raise ValueError('BROKEN_PATH')
        spans = []
        for i, token in enumerate(ids):
            occupied = [f for f, s in enumerate(selected) if s == 2*i+1]
            if not occupied:
                raise ValueError('INCOMPLETE_TARGET_PATH')
            p = logp[occupied, token]
            spans.append({'targetIndex': i, 'tokenId': token, 'startFrame': occupied[0],
                          'endFrameExclusive': occupied[-1]+1, 'meanPosterior': float(np.exp(p).mean()),
                          'meanLogPosterior': float(p.mean()), 'minLogPosterior': float(p.min())})
        return selected, spans
    alternatives = []
    for cluster in clusters:
        end = max(cluster, key=lambda f: (scores[f], -f))
        selected, spans = recover(end)
        alternatives.append({'completionFrameExclusive': end+1, 'relativePathScore': float(scores[end]),
                             'tokenSpans': spans, 'statePath': selected,
                             'unassignedSuffixFrames': [end+1, frames]})
    chosen = max(alternatives, key=lambda a: (a['relativePathScore'], -a['completionFrameExclusive']))
    return {'status': 'OCCURRENCE_AMBIGUOUS' if len(alternatives) > 1 else 'CONDITIONAL_PATH_AVAILABLE',
            'alternatives': alternatives, 'tokenSpans': chosen['tokenSpans'], 'statePath': chosen['statePath'],
            'completionScores': [float(x) if math.isfinite(x) else None for x in scores],
            'unassignedSuffixFrames': chosen['unassignedSuffixFrames']}


def rms_transition(audio, rate, anchor_seconds):
    # 20 ms disjoint PCM cells; first sustained 6 dB drop after the label anchor.
    hop = round(rate * .02)
    levels = [float(20*np.log10(max(1e-9, np.sqrt(np.mean(audio[i:i+hop]**2)))))
              for i in range(0, len(audio)-hop+1, hop)]
    anchor = int(math.ceil(anchor_seconds/.02))
    candidates = []
    for i in range(max(6, anchor), min(len(levels)-6, anchor+41)):
        before, after = levels[i-6:i], levels[i:i+6]
        if max(after) <= float(np.median(before))-6 and float(np.median(before)) > -60:
            candidates.append({'frame': i, 'seconds': i*.02, 'dropDb': float(np.median(before)-max(after)),
                               'supportFrames': [i-6, i+6]})
    return {'method': 'RMS_SUSTAINED_DROP_20MS_6DB_120MS_SEARCH800MS_V1',
            'levelsDb': levels, 'candidates': candidates,
            'selected': candidates[0] if candidates else None,
            'interpretation': 'ACOUSTIC_STATE_CHANGE_NOT_SPEECH_END_TRUTH'}
