# C6.0.1.16.4.2 fixed protocol

This is the final zero-new-model experiment on one pre-existing conflict tail.
It is opt-in, development-known, not a default subtitle strategy or release.
The old boundary implementation is immutable. All six new-model/audio counters
must remain zero. Reading NPZ is offline evidence use, not a model cache hit.

## Identity and exact-onset search

Select the first source-ordered terminal target with the old machine risk
NEIGHBOR_OR_OCCURRENCE_CONFLICT. Verify its lineage, hash and token mapping.
Original onset is a prior from the old mapped first token, not acoustic truth.
The primary domain is that onset +/- 0.5 s; the single wider sensitivity is
+/- 1 s. A no-position-prior diagnostic keeps prefix order and observations.
These predeclared engineering bands are not inferred from Gold or old end error.
There is no target-end anchor. All other 101 ends, all starts/text/styles and
identities remain protected.

Enumerate every feasible exact target onset in the saved window. Prefix tokens
retain the old ten-frame uncertainty band. Solve ordered CTC states separately
for every onset and retain every completion score. Keep one best path per
onset/completion DP state; persist the chosen full path and all completion
scores for each onset. No global best-minus-band pruning precedes occurrence
partition. Completeness refers to best scalar-score paths in each declared
exact-onset/completion domain, not all latent paths. Internal alternative paths
with inferior scalar score can remain unexamined; this does not support a claim
that no possible original occurrence exists. Limits: 1,600 frames, 128 tokens,
40 million estimated state updates; limit failure means SEARCH_INCOMPLETE.

The path score subtracts the per-frame maximum scalar without decoding its
vocabulary ID. Unassigned suffix is unknown and unscored. Raw accumulated
scores are retained for reproducibility, not directly compared as evidence
across different-length paths. Within each onset, scalar DP chooses its best
completion; hypothesis summaries rank the fixed-count target mean log peak
posterior, then normalized relative path cost. Peak maximization has an
optimism bias; normalized costs can favor long blank-heavy paths. No cross-
window probability comparison or calibrated correctness probability is claimed.

Additional support requires every target token peak >= 0.1, median peak >= 0.2,
median token-versus-blank log odds >= log(2), no inter-token gap > 0.4 s and
prefix peak coverage >= 0.75. Those uncalibrated heuristics can abstain on a
finite path. Single-frame ratio is diagnostic, not a rejection criterion.
Supported onset clusters separated by > 0.12 s remain distinct. A wider-prior
winner outside the primary domain flags PRIOR_DOMINATED without erasing the
original hypothesis. No-prior displacement alone does not refute the original.

## One tail method, separate from label support

Use 20 ms PCM RMS cells and one additional deterministic feature: cosine of
normalized Hann-window FFT power relative to the target's own PCM spectrum.
Enumerate all sustained 6 dB transitions with six before/after cells, minimum
pre-level -60 dB. Search starts at each hypothesis's own label end, within the
existing physical audio and at most 1.5 s later. Supported later-onset barriers
and protected neighbor starts bound search but are never candidate answers.

At least 90 percent of the intervening tail cells must retain spectral cosine

> = 0.95 and level within 6 dB of the target seed. Retain competing drops;
> adjacent cells describe one transition range, not separate occurrence identities.
> Only one supported transition cluster may propose its earliest observed drop.
> This is a continuity heuristic, not source separation, speaker identity or
> proof of human vocal termination. Mixture/background contradictions abstain.
> No midpoint, lowest-energy selection, fixed duration addition, blank allocation,
> window-end substitution or next.start clipping is permitted.

W+4 remains the representative; W+2 checks the same H_ORIGINAL's onset and
candidate within 0.12 s. W0 censoring cannot veto new observed extended audio.
Candidate ranges come from actual original/wide candidates, not that tolerance;
they are not confidence intervals. One unsupported candidate is not certainty.
Application needs original support, one stable original cluster, no prior
domination, an identifiable stable tail and a successful old atomic transaction.
New proposals and journals use c6011642 versions. The old transaction's private
carrier is never represented as a new scientific result from the old protocol.

## Freeze and independent evaluation

Freeze this code/configuration, target/input hashes, neutral tests and evaluation
rule before solving real evidence. Freeze hypotheses/proposals and actual
I0/I1/I2 A/B exports before the evaluator reads Gold. I0 really reexecutes the
old source and boundary consumers. I1 computes but does not apply; I2 differs
only by the end-application switch. All serialize canonical objects through
existing formatters, never patch ASS. No post-result method search is allowed.

Keep the official full-reference evaluator unchanged. Reuse I0's fixed matches
for paired end/IoU metrics. Separately enumerate adjacent 1-3 reference-cue
spans intersecting the frozen W+4 envelope, with normalized edit similarity at
least 0.25 or containment. Retain spelling/partial/merge alternatives and
monotonic constraints from neighboring fixed matches. This bounded heuristic
is not exhaustive occurrence identification: report REFERENCE_OCCURRENCE_UNRESOLVED
and exclude the target from confirmed gain absent independent confirmation.
Never select the best alternative to improve official scores.

Neutral tests include weaker-original/stronger-later, later-only, noise-only,
finite unsupported paths, single-frame/long-tail, background, overlap, censoring,
prior dependence and an exhaustive tiny CTC oracle. They prove software behavior
only. audioConfirmed=false, listener=null, HELDOUT_VALIDATION_NOT_RUN. If no
identifiable end exists, stop with NOT_IDENTIFIABLE_BY_THIS_PROTOCOL_ON_FROZEN_EVIDENCE;
do not claim absence of speech, universal impossibility or a bad reference.
