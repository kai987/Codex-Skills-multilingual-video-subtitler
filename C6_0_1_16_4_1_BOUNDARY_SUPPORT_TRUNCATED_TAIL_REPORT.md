# C6.0.1.16.4.1 Boundary-support-aware Timing & Truncated-tail Handling

## Outcome

The bounded experiment is complete, with **zero end changes**. The engineering
integrity checks pass; subtitle timing quality does not improve. The result is
`GUARD_IMPROVEMENT_ONLY_NO_QUALITY_GAIN`, with insufficient boundary evidence and
unresolved censoring/occurrence risks. This is not production acceptance.

All 102 T2 cues preserve text, starts, ends, styles, speakers, IDs and order.
All 98 cues outside the approved four-cue group are unchanged. The previous
normalized edit distance of 957 is preserved, not improved.

Publication remains `needs-review`, `finalizationMethod=none`,
`humanValidated=false`, `defaultPromotionAuthorized=false`, and
`machineOnlyReleaseAuthorized=false`. `HELDOUT_VALIDATION_NOT_RUN` applies.
No manual listening validation or independent-material validation is claimed.

## Source and isolation

Base: `10c56fcbe84c48cf59724841d046e62a7fb35ddb`.
Branch: `codex/c6-0-1-16-4-1-boundary-support-truncated-tail`.
Implementation commit: `5ea6a86`.
Work was performed in an independent worktree. The dirty historical .14.6
checkout, subsequent .16 sources/outputs, source media and human reference were
covered by a pre-work snapshot of 11,897 files plus Git states. The post-run
protection comparison passed. No historical source, default algorithm, Skill 2,
Skill 3 or human authority was changed. No source media or full transcript is
included in this report or new Git changes.

The two named independent-review files were unavailable in the searched local
source/output/download locations. The existing .16.4 report, plan, applied T2,
diagnostic and source receipts were inspected instead; unavailable reviews are
not represented as having been read.

## Predeclared plan and chronology

One machine-selected previously applied group was eligible from its old weak,
single-frame and edge-risk diagnostic. W0 reproduces the prior W2 from the same
verified source track. W+2 and W+4 extend only its right edge; no padding or
replacement audio was used. W+4 is the fixed representative and W+2 tests
context stability. They are not independent-model votes.

- Plan, policy, source binding and implementation freeze: 2026-09-07 19:53:31.152 UTC.
- Evidence and independent A/B export freeze: 2026-09-07 19:54:54.496 UTC.
- First reference read by this evaluator: 2026-09-07 19:55:23.489 UTC.
- Local run date: 2026-09-08 JST. Dataset: development-known; prior developer
  exposure is acknowledged, not described as blind or held-out acceptance.

No policy, generation code, configuration or matching rule was tuned after
Gold. The evaluation limitation below is a post-evaluation disclosure, not a
replacement evaluator or a revised score.

## Runtime and actual budget

| Quantity                                               |        Actual |
| ------------------------------------------------------ | ------------: |
| Logical tasks / attempts / acoustic forwards           |     3 / 3 / 3 |
| W0 / W+2 / W+4 real input seconds                      |  10 / 12 / 14 |
| Total real input seconds                               |            36 |
| Model-load attempts / successful loads                 |         1 / 1 |
| Provider process starts                                |             1 |
| Failures / unfinished attempts / retries               |     0 / 0 / 0 |
| Padding seconds                                        |             0 |
| New ASR requests / inference / loads / provider starts | 0 / 0 / 0 / 0 |

The budget was three formal tasks, at most four attempts including one
execution-failure retry, 90 input seconds and 30 seconds per task. No additional
real task was run for validation. No new models or network downloads were used.

Pinned runtime: `c5181-bbcbea8d5a11af2e`, CPU float32, Python 3.12.14,
torch 2.13.0, transformers 5.16.1, NumPy 2.5.2, soundfile 0.14.0.
Runtime identity SHA-256:
`4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`.
Model: `reazon-research/japanese-wav2vec2-large-rs35kh`.
Revision: `2162c9edb97f362f7623d6b3a2e417458e879bca`.
Snapshot SHA-256:
`47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`.
The inherited runtime manifest's preparation-network flag describes the earlier
installation, not this offline experiment.

## Evidence and consumer behavior

The old last-three-token `meanPosterior` values and
`normalizedPathLogScore=-0.13246645057225287` are explicitly transported into
the new proposal consumer and retained beside fresh evidence. They are
conditional alignment support, not calibrated lexical correctness or a speech
end detector. Old token summaries cannot reconstruct unavailable full frames.

The fresh W0 full-window alignment exactly reproduces the old token spans,
posteriors and normalized path score; maximum frame difference is zero. Thus
the observed new risks are not attributed to an unexplained runtime shift.

Each fresh window persists all 3,003 vocabulary log-probability columns in
lossless float64 NPZ, ordered target IDs, blank ID, symbol mapping, complete
selected state path, competing completion paths/scores, input hashes, real
sample mask/count, window offsets, stride and receptive-field geometry. Shapes
are 499x3003, 599x3003 and 699x3003. Stride is 320 samples/20 ms; receptive
field is 400 samples/25 ms. Full PCM RMS cells and candidate transitions are
also persisted. These are model emissions stored without ASR decoding.

The model-free replay recalculates all three open-suffix paths and PCM results
exactly from persisted frames and audio, with zero model loads or inference.

One conditional open-suffix DP keeps prefix tokens within the predeclared
source-bound constraints and leaves unassigned suffix context unknown, never
silent. Competing completion clusters and a separate late-onset guard prevent
blindly accepting a stronger later occurrence. The single PCM method looks for
a sustained relative RMS drop; it does not allocate blanks, add a fixed tail,
clip to the next cue or select the lowest energy point.

A CTC emission cell is not the duration of a phoneme, word or utterance. In
this run every selected last-three-token tail has a single-frame ratio of 1.
A 20 ms cell, including a sharp/high posterior, cannot establish that the
remaining vocal sound ends there. RMS state change can also be music, noise or
another voice; `utteranceEndObserved` remains false. Weak posteriors, edge risk,
unavailable transitions and context instability therefore cause abstention.

## Four selected cue results

Ordinals are used here to avoid committing private source timestamps or text.
Exact frame/time bindings remain in local evidence and proposals.

| Target | Old last-three posterior values | W+4 minimum tail posterior | Actual finding                                                                     | Applied end changes |
| ------ | ------------------------------- | -------------------------: | ---------------------------------------------------------------------------------- | ------------------: |
| 1      | 0.284380 / 0.062489 / 0.023571  |                   0.014702 | Weak single-frame tail; no identifiable transition                                 |                   0 |
| 2      | 0.328748 / 0.581045 / 0.958437  |                   0.211752 | RMS transition 0.74 s after label end, but weak/narrow tail fails support criteria |                   0 |
| 3      | 0.798594 / 0.598344 / 0.124107  |                   0.095712 | RMS transition 0.26 s after label end, but weak/narrow tail fails support criteria |                   0 |
| 4      | 0.010284 / 0.002313 / 0.007287  |                   0.003873 | Original edge risk; expanded-window late locus and unstable context                |                   0 |

Target 4's W0 label end lies 0.12 s from the physical right edge: this is
censoring risk, not a measured amount of missing speech. W+2 shifts its label
end by only 0.02 s; W+4 shifts its onset and label end by approximately 2.54 s.
W+4's RMS transition is 0.22 s after that later label end. The raw conditional
path did move later; the occurrence/context guard rejected it. It is not a
human-verified identification of a later identical shout. No subtitle followed
that relocation. There was one retained completion cluster per real window;
the cross-window conflict remains even without multiple near-best clusters.

The suffix contains real additional audio but is not assigned invented text.
Neither extension proves a trustworthy original utterance end. Target 4's
original truncation question remains unresolved; targets 1–3 also lack an
accepted complete-end estimate. No end is changed merely to hide censoring.

## Exports, fixed-support comparison and formal evaluation

U0 executes the historical pipeline and byte-matches T2. U1 consumes W0;
U2 consumes W+4 with W+2 stability; off computes evidence without applying it.
All have actual ASS/SRT/VTT, strict needs-review packages and mutation journals.
Independent run-a/run-b parity passes for all variants. Off equals U0.
All eight journals contain zero changes and agree with their actual exports.

| Metric, all four variants unchanged            |            SRT/VTT result |
| ---------------------------------------------- | ------------------------: |
| Cue count                                      |                       102 |
| Normalized S / D / I / N                       |    591 / 212 / 154 / 2048 |
| Normalized edit distance / CER                 |       957 / 0.46728515625 |
| Exact S / D / I / N                            |    719 / 270 / 195 / 2257 |
| Exact edit distance / CER                      | 1184 / 0.5245901639344263 |
| Formal matched groups / matched reference cues |                  55 / 109 |
| Total / unmatched reference cues               |                  192 / 83 |
| Unmatched hypothesis cues                      |                        34 |
| Formal start MAE / end MAE, seconds            |       1.351782 / 0.905400 |
| Formal boundary P95, seconds                   |                  3.395000 |
| Formal mean IoU / severe boundary groups       |              0.707465 / 9 |
| Presentation overflow cues                     |                        22 |

The fixed-support comparison reuses U0's 55 algorithmic bindings across all
variants without rematching. Its end MAE is 0.905400 s and mean IoU 0.707465
for every variant: zero delta, zero confirmed improvement. Formal scores retain
the complete reference denominator. ASS has its existing centisecond
serialization differences; per-format actual-export metrics are retained in
`evaluation/metrics.json`, with no variant-specific change.

**Occurrence diagnostic limitation:** the predeclared supplemental detector
only enumerates exact normalized repeated reference text within the W+4
envelope. It found zero alternatives. This does not establish occurrence
uniqueness when spelling, partial-text or grouping differ. The CSV's
`ambiguous=false` means only that this narrow detector did not flag the row.
It must not be interpreted as acoustic confirmation. Broader repetition
ambiguity remains `OCCURRENCE_AMBIGUITY_HOLD`; its comprehensive alternative
enumeration is not completed in this experiment. No reference was selected for
a more favorable error, and no post-Gold rule was substituted. The last target's
formal 3.395 s end error is a reference-binding difference, not proof of a
3.395 s truncated tail. With identical exports, no matching interpretation can
establish a between-variant timing gain here.

## Validation

Typecheck, lint, full format check and build passed. Full Vitest: 1,426 passed,
2 skipped, 0 failed. The separately reported E2E subset: 90 passed, 1 skipped,
0 failed; it is not added again to the full-suite total. Optional real-model
integration tests were disabled. Four Python synthetic behavior tests passed.
The synthetic late-repeat and sustained-tail cases demonstrate software
behavior, not answers about the real source.

Initial full-suite invocation used system Python without NumPy: 14 unit and
3 E2E failures. Correcting PATH to the existing NumPy/SciPy runtime produced the
passing full runs above, without source changes or new inference. Initial
failure logs are preserved alongside final receipts. Dependency installation
was offline; the available npm 10 emitted an engine warning against the npm 11
declaration, but did not modify the lockfile. Tests ran on Node 24.19.0.

Strict Zod plus AJV validated eight proposals; eight strict subtitle packages
passed. Freeze hashes, source binding, frame checksums, actual execution ledger,
export/journal agreement, A/B parity, off parity and protected-field checks
passed. Engineering integrity is not the missing broad occurrence validation
and does not authorize timing-quality or public-release claims.

## Delivery and smallest next direction

Local run folder: `machine-quality-c6-0-1-16-4-1-20260908-experiment-01`.
Main research ASS: `run-a/U2-extended-window-boundary/machine-candidate.ass`.
Full paths are in the local delivery receipt rather than this Git report.
Raw audio, logits, transcripts, reference data and private paths remain
local-only; the run is not a public-shareable package.

The experiment establishes a guarded boundary consumer and reproducible frame
evidence, not end recovery. The smallest next direction is an independently
defined occurrence-aware complete-tail identifiability protocol on the stored
frames/PCM, validated with synthetic or independent material before any new
development-Gold comparison. Do not add models, expand windows again or loosen
thresholds under this completed plan. If the allowed evidence cannot separate
the original tail from subsequent speech, keep abstention as the capability
limit rather than relabeling it as recovery.
