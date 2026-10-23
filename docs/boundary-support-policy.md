# C6.0.1.16.4.1 fixed boundary experiment

This is opt-in, development-known and end-only. Default generation is unchanged.
The source of truth for numerical settings is `BOUNDARY_POLICY`. The policy,
implementation closure and exact machine inputs are frozen before new inference.
No Gold argument is accepted by preparation, alignment or generation.

## One conditional method

Use the previous successfully applied group, ordered by source time, when its
stored diagnostic has a single-frame or weak token or an edge-risk cue. Select
at most one group. Its complete stored machine transcript is unchanged. W0 is
the previous physical W2; W+2 and W+4 extend only the right edge on the verified
source track, without padding. W+4 is the representative; W+2 is corroborative
context stability, not independent-model agreement. Missing W+4 means abstention.

The fixed open-suffix DP begins in the initial blank/first target state and
preserves target order. All tokens before the final approved cue stay within
ten frames of previous source-bound token spans. The final cue is free to align
after that prefix. Completion is allowed at every frame in the final target
state; remaining audio is NOT_ASSIGNED_CONTEXT, never declared silent. Compare
completion scores after subtracting only the per-frame maximum log probability
scalar (no vocabulary IDs decoded). Retain all separated near-best completion
clusters within two log-score units, splitting at gaps exceeding six frames.
Multiple locations mean OCCURRENCE_AMBIGUOUS. A lone stronger late path is also
rejected when the target onset shifts more than 0.5 seconds from its original
source-bound occurrence. Old timing anchors constrain identity, not true ends.

The single PCM method uses disjoint 20 ms RMS cells and the first sustained
6 dB drop over six cells relative to the preceding six-cell median, whose level
must exceed -60 dB. Search starts at the conditional label-end anchor, stops
800 ms later, and requires the entire before/after observation. No lowest-point
selection, fixed duration addition, blank allocation or midpoint is permitted.
The existing source acoustic inventory has RMS features but not this short
source-bound transition interface; this bounded method is separate and does not
load its detector/model stages. Record the feature call and all cell values.

Require minimum selected tail posterior 0.35, at most half of its last three
tokens occupying a single frame, no 0.5-second right-edge risk, no occurrence
ambiguity, and a usable PCM candidate. W+4 additionally requires W+2 label and
transition candidates within 120 ms. These are predeclared engineering criteria,
not calibrated lexical accuracy or proof of speech termination. Acoustic state
changes can be noise/music/another voice; `utteranceEndObserved` remains false.
Every result keeps lexical truth unvalidated. Frame cells, receptive envelopes,
token emissions, conditional occupancy and proposed display ends are distinct.

Validate all selected end proposals together, including protected neighbors;
apply none on conflict. No clipping to next.start, text/starts/style changes,
merging, splitting, default promotion or human authority is permitted.

## Persistence and evaluation

Persist all vocabulary log-probability columns as lossless float64 NPZ, blank
and ordered target IDs, real-sample mask, complete selected state path, competing
paths and completion scores, physical sample counts, stride/receptive geometry,
symbol mapping, model/audio identities and deterministic PCM cells. An offline
NPZ replay recalculates the same DP and RMS result without a model. Old summaries
remain FULL_FRAME_EVIDENCE_NOT_PERSISTED. Same-model full-window W0 token spans
and scores are separately compared with the historical diagnostic.

Actual U0/U1/U2/off ASS/SRT/VTT are generated in independent A/B processes. U0
executes the old pipeline and must byte-match historical T2. Off computes the
same proposals but preserves U0. Freeze all machine evidence and exports before
the independent reference evaluator runs. Preserve the official evaluator and
its full denominators. Separately reuse U0's fixed matching across all variants;
record exact repeated-reference alternatives inside the frozen W+4 envelope,
their order constraint and all timing-error ranges. Ambiguous groups cannot
establish confirmed fixed-support gain. Do not tune after Gold.

Budget: at most three formal tasks, four total attempts with one execution-failure
retry slot, 90 actual input seconds, 30 per task; no automatic retry. W0 is new
inference, never a cache hit. ASR/other neural models/network/downloads are zero.

Commands after build: `node scripts/run-c6011641.mjs prepare <previous-run>
<source-media> <new-output>`, then `execute <new-output>` and `generate
<new-output>`. Run `replay_boundary_frames.py <new-output>` with the pinned local
Python for model-free evidence validation, then the separate
`node scripts/evaluate-c6011641.mjs <new-output> <evaluation-only-reference>` and
`node scripts/validate-c6011641.mjs <new-output>`. These interfaces do not grant
permission to repeat an already consumed model budget.
