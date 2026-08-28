# C6.0.1.6 Acoustic Risk Calibration, Span-level Text Repair & Joint Boundary Refinement

Date: 2026-08-29

Policy: `c6.0.1.6-acoustic-risk-span-text-joint-boundary-v1`

Policy SHA-256: `19d1204df7542865b91f3c617f393ad5232f2086787bab557a77c5da21ac8642`

This report records the real Carnation development-set acceptance for C6.0.1.6. Generation remained Gold-isolated and network-free. The engineering gate passed, but the subtitle-quality milestone and strict C6.0.2 gate did not pass. The correct outcome is `HOLD_FOR_MORE_PIPELINE_RECOVERY`, with production still `needs-review`, `finalizationMethod = none`, and machine release unauthorized.

## Executive conclusion

C6.0.1.6 corrected the C6.0.1.5 edge-risk definition, preserved explicit decoder-evidence availability, replaced a single audit status with multi-label correlated risk facts, added risk-driven bounded re-ASR scheduling, established Event -> Final Cue -> Unicode text-span lineage, added middle-span repair, and implemented independent partial and joint boundary refinement. Strict schemas, Gold isolation, A/B parity, Shareable audits, and all engineering regressions passed.

The corrected request-edge artifact contains 229 candidate/request records: 20 strong, 40 weak, and 169 no-risk. This replaces the invalid inference that 178 of 180 single-variant events were edge-truncated merely because a candidate touched its own event interval. All 274 candidates now have explicit decoder-evidence records; this includes 169/169 Primary, 54/54 Recovery, and 51/51 re-ASR candidates. Fields that the provider did not retain remain `unknown` or `unsupported`, never a fabricated zero.

The new risk policy classified 14 events as KEEP, 11 VERIFY, 155 RE_ASR, and 0 REVIEW. The frozen episode budget still selected only 12 events and planned 36 requests. This acceptance is a verified cache replay, not new inference: 8 selected events had 24 replayable requests and 24 cache hits, 4 selected events were unavailable, and model inference/model load remained 0. The replayable intersection contained 15 historical raw-re-ASR candidates and one historical pool winner, but no safe canonical text replacement.

Text-span lineage mapped 161 of 199 events to modifiable final-cue spans (`0.8074074074074075` final-cue text coverage). Two span repairs were proposed and both were correctly rejected by strict safety gates, so text mutation, CER gain, and material-error gain were all 0. Partial refinement could apply 15 boundary mutations and joint refinement 8 more in the enforced candidate, but Gold-isolated evaluation showed no severe/P95/overlap improvement and reduced median IoU from `0.5824665676077242` to `0.5699999999999932`. Final A/B therefore keep partial and joint refinement in observe mode and apply no canonical timing mutation.

Final quality is unchanged from the official C6.0.1.5 baseline: 161 cues, exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, missing 6, hallucination 1, material errors 77, severe timing errors 53, start/end MAE `1.6091082275459374 / 1.6078355157481543 s`, P95 `5.384999999999991 s`, median IoU `0.5824665676077242`, and overlap 48. The ceiling evaluator assigns 34 material errors to re-ASR-recoverable work, 40 to association remaining, 3 unknown, and 0 to `CURRENT_WHISPER_CONSISTENTLY_WRONG`; therefore it does not yet justify an ASR ensemble as the immediate next production step.

## Branch, baseline, and development-set status

- Branch: `codex/c6-0-1-6-acoustic-risk-span-text-joint-boundary`.
- Exact base: `1f1260de698b805775898feeac830370c8d378f8` from `codex/c6-0-1-5-evidence-to-canonical-raw-asr-recovery`.
- Source media: `/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv`.
- Source size: `847774958` bytes; before/after SHA-256 `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`; read-only verification passed.
- Gold: the human-reviewed 192-cue ASS, used only after output freeze; before/after SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; read-only verification passed.
- Runtime Gold input count: 0. Dataset-hardcoding findings: 0. Candidate-text prompt leaks: 0. Network use: false.
- This episode is a known development set. It can validate engineering behavior and diagnose quality limits, but cannot establish unseen-series generalization.
- Goals: correct request-edge risk; preserve decoder evidence; use correlated multi-label risk and bounded re-ASR; create deterministic span lineage; allow safe span text repair; independently refine start/end/both boundaries; jointly evaluate adjacent boundaries; diagnose the remaining ASR ceiling.
- Non-goals: rewriting association or VAD timebase, adding a CTC provider or second ASR, expanding global recall, using Gold at runtime, tuning Carnation-specific thresholds, forcing mutations, authorizing machine release, or modifying Skill 2/3.

## Runtime and model identity

| Resource                 | Snapshot / runtime identity                                        | Version / device            |
| ------------------------ | ------------------------------------------------------------------ | --------------------------- |
| Whisper large-v3         | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` | model snapshot              |
| whisper.cpp-mvl          | `e2b62f6d45dc3badc49e0b2a8a468a9914f5e018c3692c1fbe6190c443b0b2c2` | `1.9.3+9ae596938178`, Metal |
| Silero VAD 6.2.0         | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` | model snapshot              |
| Reazon Japanese Wav2Vec2 | `cc0228dfe1d939e541624c78911eafc7041698e1b2f4853de8a6364fb4557364` | model snapshot              |
| Reazon CTC runtime       | `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60` | `C5.18.1`, CPU              |
| Sudachi projection       | `30b2a6bf9706029b609327ca5db722cd458239df96efc87e1f8e37beed49db2e` | `0.6.11+python-3.12`, CPU   |
| FFmpeg                   | `2ce81b92499c1b6b96eb060c69723114bd0da13f1bfbd9da26dee24d099e644a` | `8.1.2`, CPU                |

## Baseline replay and corrected acoustic risk

V0 reproduced the official C6.0.1.5 final quality and hashes. The old single-variant audit had 180 single-variant events, 180 suspicious, 180 re-ASR-eligible, 178 `EDGE_TRUNCATED`, and 2 `INCOMPLETE_SPEECH_SPAN`. Its edge test compared a candidate with an event interval often defined by that same candidate. Candidate-at-event-edge was therefore circular and was not evidence of request-window truncation.

The new contract traces each candidate to `requestId`, source-global request interval, candidate interval, left/right request-edge distance, speech continuation, trusted tokens, CTC, decoder fields, and independent windows. Near-request-edge alone is insufficient. A strong classification requires request-edge proximity plus independent continuation/completeness evidence.

| Edge metric                      | Candidate/request records | Event aggregate |
| -------------------------------- | ------------------------: | --------------: |
| Strong request-edge risk         |                        20 |              19 |
| Weak request-edge risk           |                        40 |              29 |
| Any request-edge risk            |                        60 |              48 |
| No risk                          |                       169 |             132 |
| Unknown                          |                         0 |               0 |
| Missing request interval         |                         0 |               0 |
| Legacy event-edge classification |                         0 |               0 |

The mandatory final count uses the candidate/request-record denominator: strong 20 and weak 40. Event-level risk correlation uses 19 strong and 29 weak events because one event can have multiple request records.

## Decoder evidence and multi-label risk

Decoder-evidence coverage is explicit rather than numeric-zero imputation:

| Candidate family | Records | Available evidence records | Coverage |
| ---------------- | ------: | -------------------------: | -------: |
| Primary          |     169 |                        169 |      1.0 |
| Recovery         |      54 |                         54 |      1.0 |
| Targeted re-ASR  |      25 |                         25 |      1.0 |
| Raw re-ASR       |      26 |                         26 |      1.0 |
| All              |     274 |                        274 |      1.0 |

An available evidence record may still contain explicitly unknown provider fields. For example, a Primary candidate can retain token count and request-edge distance while average log probability remains `unknown` and language probability remains `unsupported`. This is intentional and prevents missing evidence from becoming false confidence.

| Risk fact                         | Active | Strong | Weak | Unknown |
| --------------------------------- | -----: | -----: | ---: | ------: |
| requestEdgeRisk (event aggregate) |     48 |     19 |   29 |       0 |
| ctcWeak                           |    107 |      0 |  107 |       0 |
| ctcUnscorable                     |      2 |      0 |    0 |       2 |
| tokenWeak                         |    151 |    139 |   12 |       0 |
| speechIncomplete                  |      2 |      2 |    0 |       0 |
| decoderWeak                       |      4 |      1 |    3 |       0 |
| decoderUnknown                    |      0 |      0 |    0 |       0 |
| independentWindowDisagreement     |     12 |      7 |    5 |       0 |
| associationAmbiguity              |      7 |      0 |    7 |       0 |
| overlapRisk                       |      7 |      0 |    7 |       0 |
| durationTextAnomaly               |     10 |      7 |    3 |       0 |

Risk facts are correlated by evidence family. One strong fact or two independent weak correlation groups can recommend RE_ASR; correlated weak facts do not double-count as independent evidence. Stable ranking uses risk strength, independent groups, evidence gain, and deterministic tie-breaks, not event ID as the primary rank.

| Decision                           | Count |
| ---------------------------------- | ----: |
| Multi-risk events                  |   133 |
| KEEP                               |    14 |
| VERIFY                             |    11 |
| RE_ASR                             |   155 |
| REVIEW                             |     0 |
| Strong-risk events                 |   145 |
| Events with independent weak risks |    34 |

## Re-ASR priority, budget, and execution honesty

The baseline made 180 events eligible and selected 12. C6.0.1.6 makes 155 events eligible, still selects 12, exhausts 143 eligible events, and plans 36 requests. Eligibility is no longer a uniform 180/180 audit status, but the current token/CTC risk distribution remains broad.

Final A/B execution mode is `verified-cache-replay`:

| Metric                                               | C6.0.1.6 policy-selected result |
| ---------------------------------------------------- | ------------------------------: |
| Eligible events                                      |                             155 |
| Budget-selected events                               |                              12 |
| Planned requests                                     |                              36 |
| Replayable selected events                           |                               8 |
| Replayed requests / cache hits                       |                         24 / 24 |
| Unavailable selected events                          |                               4 |
| New inference / model loads                          |                           0 / 0 |
| Historical new candidates in replayable intersection |                              15 |
| Historical pool winners in intersection              |                               1 |
| Safe canonical replacements                          |                               0 |
| Final quality gain per replayed request              |                               0 |

The retained C6.0.1.5 historical recovery artifact reports 36/36 cache hits, 26 candidates, runtime proxy improvement count 48, and 2 pool winners across its own different 12-event selection. Those figures are historical context and are not misreported as the new policy's execution. No claim of fresh C6.0.1.6 inference is made.

## Event-to-Final Cue and text-span lineage

The inherited ID-derived Event -> Final Cue lineage covers `0.9777777777777777` of events with no time-nearest identity fallback: 199 events, 161 final cues, 87 exact one-to-one, 75 one-to-many, 21 many-to-one, 8 dropped, 8 unresolved, and 161 covered final cues.

The new Event -> Final Cue -> Text Span lineage uses Unicode code-point half-open ranges and explicit normalization/split/merge derivation. Production mapping does not use fuzzy substring guesses.

| Span-lineage metric             |        Count / ratio |
| ------------------------------- | -------------------: |
| Events                          |                  199 |
| Span-mapped / modifiable events |            161 / 161 |
| Exact spans                     |                   57 |
| Normalized exact spans          |                   30 |
| Split-derived spans             |                   53 |
| Merge-derived spans             |                   21 |
| Ambiguous spans                 |                    4 |
| Unresolved spans                |                   34 |
| Final-cue text coverage         | `0.8074074074074075` |

## Span-level text repair

Middle-span replacement is independent of timing replacement and never falls back to whole-cue free rewrite. Each proposal must have deterministic lineage, candidate provenance, punctuation/layout safety, no hallucination increase, and text non-degradation. ASS, SRT, and VTT are rendered from the same accepted canonical mutation.

Two proposals were generated; 0 accepted, 2 rejected, 0 applied, 0 changed spans, 0 changed final cues, and 0 replacement characters. This is a successful fail-closed result, not a quality improvement. Exact CER, normalized CER, and material errors therefore changed by 0.

## Partial and joint boundary refinement

Partial timing evaluates START_ONLY, END_ONLY, and BOTH independently. Joint refinement evaluates adjacent cue pairs as a unit, preserves evidence-supported real overlap, requires explicit evidence before treating overlap as accidental, prevents overlap increases, and applies proposals sequentially against current neighbors.

| Final A/B observe metric           | Eligible / proposals | Applied |
| ---------------------------------- | -------------------: | ------: |
| Start-only                         |                    7 |       0 |
| End-only                           |                   10 |       0 |
| Both                               |                    2 |       0 |
| Partial total                      |         17 proposals |       0 |
| Joint pairs / proposals            |             103 / 11 |       0 |
| Joint ambiguous / review           |              37 / 55 |     n/a |
| Proven real overlap preserved      |                    0 |     n/a |
| Proven accidental overlap resolved |                    0 |       0 |

The V6 enforced candidate applied 15 partial mutations (6 start-only, 7 end-only, 2 both). V7/Full additionally applied 8 joint mutations. Gold-isolated evaluation showed no improvement in severe timing, P95, or overlap; start MAE slightly worsened, end MAE changed only marginally, and IoU fell to 0.57. Final A/B therefore observe but do not apply these mutations.

## Stage-wise ablation and Final A/B

| Run     | Modes / purpose                      | Applied boundary mutations | Exact / normalized CER             | Material | Start / end MAE       |       P95 |        IoU | Overlap |
| ------- | ------------------------------------ | -------------------------: | ---------------------------------- | -------: | --------------------- | --------: | ---------: | ------: |
| V0      | all off, baseline replay             |                          0 | `0.660105 / 0.6015625`             |       77 | `1.609108 / 1.607836` |   `5.385` | `0.582467` |      48 |
| V1      | edge risk observe                    |                          0 | not re-scored; canonical unchanged |       77 | unchanged             | unchanged |  unchanged |      48 |
| V2      | risk/decoder observe                 |                          0 | not re-scored; canonical unchanged |       77 | unchanged             | unchanged |  unchanged |      48 |
| V3      | risk + priority enforce              |                          0 | not re-scored; canonical unchanged |       77 | unchanged             | unchanged |  unchanged |      48 |
| V4      | span lineage/repair observe          |                          0 | not re-scored; canonical unchanged |       77 | unchanged             | unchanged |  unchanged |      48 |
| V5      | span repair enforce                  |                          0 | not re-scored; canonical unchanged |       77 | unchanged             | unchanged |  unchanged |      48 |
| V6      | partial timing enforce               |                         15 | `0.660105 / 0.6015625`             |       77 | `1.610639 / 1.607007` |   `5.385` |     `0.57` |      48 |
| V7      | partial + joint enforce              |                         23 | `0.660105 / 0.6015625`             |       77 | `1.610062 / 1.607715` |   `5.385` |     `0.57` |      48 |
| Full    | all enforce                          |                         23 | `0.660105 / 0.6015625`             |       77 | `1.610062 / 1.607715` |   `5.385` |     `0.57` |      48 |
| Final A | risk/span enforce; boundary observe  |                          0 | `0.660105 / 0.6015625`             |       77 | `1.609108 / 1.607836` |   `5.385` | `0.582467` |      48 |
| Final B | independent replay of Final A policy |                          0 | `0.660105 / 0.6015625`             |       77 | `1.609108 / 1.607836` |   `5.385` | `0.582467` |      48 |

Final A freeze: `8e8bb66f70d90f3c367b3cd4c7bf7a063e483957a33611b4037622aa6feb488a`.

Final B freeze: `6c91480ee35fab2b5e78ad96fb6d3d170807b50fa71ba567a08b5b896c1779c5`.

All 12 required A/B parity fields are true: text, timing, presentation, risk vector, re-ASR priority, decoder evidence, span lineage, repair proposals, timing proposals, joint boundary, mutation, and shadow outcome.

## Final hashes and rendered output

No final canonical or rendered content changed relative to the C6.0.1.5 baseline:

| Artifact         | Baseline / Final SHA-256                                           | Changed |
| ---------------- | ------------------------------------------------------------------ | ------- |
| Canonical text   | `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e` | no      |
| Canonical timing | `b4c5eaae50284455e502aa2bdcae38a3dd4df9c4622397af86e3790463d00e86` | no      |
| Presentation     | `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7` | no      |
| ASS              | `f46039ec15cf1306da86babcd23d8dc769e1cdb9167cc2f0b51af930bce45981` | no      |
| SRT              | `ec2fe7c76ac235151965d728466d8592650f86b38b16e48500b4b6bf83723083` | no      |
| VTT              | `00a5936b752ba155b3e410b42c9b7a5e9d4969b441d5179494144a631983933f` | no      |

Canonical text mutations: 0. Canonical timing mutations: 0. Text-hash-changing material delta: 0. Matching-induced material delta: 0.

## ASR ceiling evaluation and next-stage decision

| Ceiling class                      |       Material errors |
| ---------------------------------- | --------------------: |
| Pipeline-decision recoverable      |                     0 |
| Existing-variant recoverable       |                     0 |
| Re-ASR recoverable                 |                    34 |
| Current Whisper consistently wrong |                     0 |
| Association remaining              |                    40 |
| Span-lineage blocked               |                     0 |
| Unknown                            |                     3 |
| Aggregate re-ASR potential         | `0.44155844155844154` |

The evaluator recommends `CONTINUE_PIPELINE_RECOVERY`, not `RECOMMEND_ASR_ENSEMBLE_NEXT`. The dominant diagnosed blockers are association (40) and budget/unexecuted re-ASR potential (34), while the strict consistently-wrong class is 0. These classes are diagnostic and must not be summed into a guarantee of 74 safe repairs.

The realistic pipeline milestone failed: normalized CER is above 0.58, material errors above 65, severe timing above 45, both MAEs above 1.5 s, P95 above 5 s, and overlap above 40. The strict C6.0.2 gate also failed: material errors, normalized CER, severe timing, both MAEs, P95, and overlap miss their frozen thresholds. Outcome: `HOLD_FOR_MORE_PIPELINE_RECOVERY`.

## Gold isolation, safety, reproducibility, and Shareable delivery

- Generation used the source and verified machine cache only. Runtime Gold input count is 0; network use is false.
- Source and Gold before/after hashes are identical. Gold was read only by isolated evaluators after output freeze.
- Unsafe finalization escapes: 0. Production remains `needs-review`; `finalizationMethod = none`; `machineReleaseAuthorized = false`.
- Final A/B use separate output identities and empty machine-memory stores. All requested semantic and output parity checks are true.
- All 12 generation outputs have a strict `c6-0-1-6-summary.json`, standard `shareable-artifact-manifest.json`, and audit. Across all 12: validation passed, absolute-path leak 0, prohibited-secret count 0, and broken-relative-reference count 0.
- The Full, Final A, and Final B Shareable artifacts were independently re-audited after the final freeze and passed.
- Shareable data excludes full Gold text, raw private audio, source absolute paths, and secrets.

## Tests, schemas, regressions, and Skill compatibility

- `npm run generate:schemas`: passed; 229 strict JSON Schemas generated.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`: passed.
- Unit suite: 87 files passed; 682 passed, 2 skipped.
- E2E suite: 19 files passed; 38 passed, 1 skipped.
- Targeted C6.0.1.6: 6 files, 27/27 passed.
- Explicit C5.19 through C6.0.1.5 regression selection: 38 files, 176/176 passed.
- C5.19, C6 Investigation, C6 Protected, C6.0.1, C6.0.1.1, C6.0.1.2, C6.0.1.3, C6.0.1.4, and C6.0.1.5 are also covered by the full unit/E2E suites.
- `quick_validate.py` reports `Skill is valid!` for `multilingual-video-subtitler`.
- Skill 2 (`multilingual-grammar-report-generator`) and Skill 3 (`multilingual-grammar-learning-site-builder`) were not modified.

## Requirement index 1-116

|   # | Required topic                   | Result                                                                                           |
| --: | -------------------------------- | ------------------------------------------------------------------------------------------------ |
|   1 | Executive Conclusion             | Engineering PASS; quality HOLD.                                                                  |
|   2 | Branch                           | `codex/c6-0-1-6-acoustic-risk-span-text-joint-boundary`.                                         |
|   3 | Baseline                         | Exact base `1f1260de`; official C6.0.1.5 Final B replay.                                         |
|   4 | Development-set Status           | Known Carnation development set; not unseen generalization evidence.                             |
|   5 | Goals                            | Risk calibration, evidence preservation, span repair, partial/joint timing, ceiling diagnosis.   |
|   6 | Non-goals                        | No association/VAD rewrite, second ASR, Gold runtime use, forced release, or Skill 2/3 change.   |
|   7 | C6.0.1.5 Replay                  | Passed with 161 cues and identical official baseline metrics/hashes.                             |
|   8 | Baseline Quality                 | CER `0.660105/0.6015625`; material 77; severe 53; P95 `5.385`; overlap 48.                       |
|   9 | Edge Risk Bug                    | Candidate-to-event edge was circular for single-variant events.                                  |
|  10 | Event Edge vs Request Edge       | Request identity and source-global request interval now required.                                |
|  11 | Corrected Edge Metrics           | 229 records: strong 20, weak 40, none 169, unknown 0.                                            |
|  12 | Risk Vector                      | Fifteen explicit facts with severity, evidence IDs, reasons, and correlation groups.             |
|  13 | Risk Correlation                 | Strong or independent weak families count; correlated facts do not double-count.                 |
|  14 | KEEP/VERIFY/RE_ASR/REVIEW        | 14 / 11 / 155 / 0.                                                                               |
|  15 | Re-ASR Priority                  | Evidence-gain ranking; event ID is not primary.                                                  |
|  16 | Re-ASR Budget                    | 12 events, 36 planned requests, no expansion over C6.0.1.5.                                      |
|  17 | Decoder Evidence Recovery        | 274/274 records available; missing fields remain explicit.                                       |
|  18 | Primary Decoder Coverage         | 169/169, 1.0.                                                                                    |
|  19 | Recovery Decoder Coverage        | 54/54, 1.0.                                                                                      |
|  20 | Re-ASR Decoder Coverage          | 51/51, 1.0.                                                                                      |
|  21 | CTC Risk                         | 107 weak plus 2 unscorable; frozen threshold retained.                                           |
|  22 | Token Risk                       | 151 active: 139 strong, 12 weak.                                                                 |
|  23 | Speech Completeness              | 2 strong incomplete events.                                                                      |
|  24 | Independent Window Support       | 12 disagreements: 7 strong, 5 weak.                                                              |
|  25 | Single-Variant Audit Before      | 180 suspicious/eligible; 178 edge-truncated.                                                     |
|  26 | Single-Variant Audit After       | Multi-label facts; no overriding single status.                                                  |
|  27 | Eligible Events Before           | 180.                                                                                             |
|  28 | Eligible Events After            | 155.                                                                                             |
|  29 | Triggered Events                 | 12 budget-selected.                                                                              |
|  30 | Re-ASR Efficiency                | 24 replayed cache requests, 15 historical candidates, 1 pool winner, 0 final gain.               |
|  31 | Event -> Final Cue Lineage       | Coverage `0.9777777777777777`; time-nearest identity 0.                                          |
|  32 | Event -> Final Text Span Lineage | Unicode code-point half-open ranges with explicit derivation.                                    |
|  33 | Span Mapping Coverage            | 161 mapped/modifiable; ratio `0.8074074074074075`.                                               |
|  34 | Ambiguous Spans                  | 4 ambiguous; 34 unresolved.                                                                      |
|  35 | Span Repair Proposals            | 2.                                                                                               |
|  36 | Span Repair Applied              | 0; both proposals safely rejected.                                                               |
|  37 | Text Changed Cues                | 0.                                                                                               |
|  38 | Partial Timing                   | Start/end/both independently evaluated.                                                          |
|  39 | Start-only                       | Final observe 7 eligible/0 applied; enforced candidate 6 applied.                                |
|  40 | End-only                         | Final observe 10/0; enforced candidate 7 applied.                                                |
|  41 | Both                             | Final observe 2/0; enforced candidate 2 applied.                                                 |
|  42 | Timing Proposal Acceptance       | Final 17/0; enforced candidate applied 15 but quality regressed.                                 |
|  43 | Joint Boundary Pairs             | 103 pairs; 11 proposals.                                                                         |
|  44 | Joint Boundary Applied           | Final 0; enforced candidate 8.                                                                   |
|  45 | Real Overlap Preserved           | 0 proven real-overlap cases; no unproven claim.                                                  |
|  46 | Accidental Overlap Resolved      | 0 in Final; no quality-metric overlap reduction in enforced candidate.                           |
|  47 | ASS/SRT/VTT Changes              | None in Final A/B; all three hashes unchanged.                                                   |
|  48 | Ablation V0                      | All off; official baseline reproduced.                                                           |
|  49 | V1                               | Request-edge risk observe.                                                                       |
|  50 | V2                               | Risk and decoder observe.                                                                        |
|  51 | V3                               | Risk/priority enforce.                                                                           |
|  52 | V4                               | Span lineage/repair observe.                                                                     |
|  53 | V5                               | Span repair enforce; no safe mutation.                                                           |
|  54 | V6                               | Partial enforce; 15 applied, no quality gain.                                                    |
|  55 | V7                               | Partial + joint enforce; 23 applied, IoU worse.                                                  |
|  56 | Full Candidate                   | All enforce; same metrics as V7.                                                                 |
|  57 | Final A                          | Risk/span enforce; boundary observe; frozen.                                                     |
|  58 | Final B                          | Independent replay of Final A policy; frozen.                                                    |
|  59 | A/B Parity                       | All 12 requested parity fields true.                                                             |
|  60 | Exact CER                        | Baseline/final `0.6601049868766404`.                                                             |
|  61 | Normalized CER                   | Baseline/final `0.6015625`.                                                                      |
|  62 | Coverage                         | Baseline/final `0.96484375`.                                                                     |
|  63 | Missing                          | Baseline/final 6.                                                                                |
|  64 | Hallucination                    | Baseline/final 1.                                                                                |
|  65 | Material Errors                  | Baseline/final 77.                                                                               |
|  66 | Text-hash-changing Error Delta   | 0.                                                                                               |
|  67 | Matching-induced Error Delta     | 0 in Final A/B.                                                                                  |
|  68 | Severe Timing                    | Baseline/final 53.                                                                               |
|  69 | Start MAE                        | Baseline/final `1.6091082275459374 s`.                                                           |
|  70 | End MAE                          | Baseline/final `1.6078355157481543 s`.                                                           |
|  71 | P95                              | Baseline/final `5.384999999999991 s`.                                                            |
|  72 | IoU                              | Baseline/final `0.5824665676077242`.                                                             |
|  73 | Overlap                          | Baseline/final 48.                                                                               |
|  74 | Re-ASR Requests                  | 36 planned; 24 replayable under selected-policy/cache intersection.                              |
|  75 | New Candidates                   | 15 historical candidates in replayable intersection.                                             |
|  76 | Safe Replacements                | 1 historical pool winner; 0 safe canonical replacements.                                         |
|  77 | Decoder Evidence Use             | Explicit evidence record used for all 274 candidates.                                            |
|  78 | CTC Evidence Use                 | 107 weak facts retained rather than hidden by edge status.                                       |
|  79 | Token Evidence Use               | 151 weak/strong token facts; correlated independently.                                           |
|  80 | Acoustic Risk Precision/Recall   | No fabricated binary score: Gold-isolated evaluator lacks a per-event acoustic-risk truth label. |
|  81 | ASR Ceiling Evaluation           | 77 material errors classified; strict evaluator-only artifact.                                   |
|  82 | Pipeline Recoverable             | 0 decision-recoverable under strict ceiling taxonomy.                                            |
|  83 | Existing Variant Recoverable     | 0.                                                                                               |
|  84 | Re-ASR Recoverable               | 34.                                                                                              |
|  85 | Whisper Consistently Wrong       | 0 under the strict multi-window definition.                                                      |
|  86 | Unknown Ceiling Cases            | 3.                                                                                               |
|  87 | Next-stage Recommendation        | `CONTINUE_PIPELINE_RECOVERY`.                                                                    |
|  88 | Production Status                | `needs-review`; `finalizationMethod = none`.                                                     |
|  89 | Shadow Outcome                   | Final A/B shadow parity true.                                                                    |
|  90 | Unsafe Escape                    | 0.                                                                                               |
|  91 | Gold Isolation                   | Runtime Gold input 0; post-freeze evaluator only.                                                |
|  92 | Dataset Hardcoding               | 0 findings.                                                                                      |
|  93 | Network                          | Generation network use false.                                                                    |
|  94 | Source Read-only                 | Passed; size/hash unchanged.                                                                     |
|  95 | Gold Read-only                   | Passed; hash unchanged.                                                                          |
|  96 | Shareable                        | 12/12 passed; paths/secrets/broken refs all 0.                                                   |
|  97 | C5.19 Regression                 | Passed.                                                                                          |
|  98 | C6 Investigation Regression      | Passed.                                                                                          |
|  99 | C6 Protected Regression          | Passed.                                                                                          |
| 100 | C6.0.1 Regression                | Passed.                                                                                          |
| 101 | C6.0.1.1 Regression              | Passed.                                                                                          |
| 102 | C6.0.1.2 Regression              | Passed.                                                                                          |
| 103 | C6.0.1.3 Regression              | Passed.                                                                                          |
| 104 | C6.0.1.4 Regression              | Passed.                                                                                          |
| 105 | C6.0.1.5 Regression              | Passed.                                                                                          |
| 106 | Tests                            | Unit 682 passed; E2E 38 passed; targeted 27 passed.                                              |
| 107 | Schemas                          | 229 generated strict schemas.                                                                    |
| 108 | Skill Validation                 | `Skill is valid!`.                                                                               |
| 109 | Skill 2/3                        | Not modified.                                                                                    |
| 110 | Quality Milestone                | Failed.                                                                                          |
| 111 | C6.0.2 Readiness                 | Strict gate failed; HOLD.                                                                        |
| 112 | ASR Ensemble Recommendation      | Not yet; strict ceiling says continue pipeline recovery.                                         |
| 113 | Remaining Risks                  | 40 association, 34 re-ASR-recoverable, 3 unknown; timing/overlap and unseen generalization.      |
| 114 | Commits                          | Five implementation commits plus this acceptance documentation commit.                           |
| 115 | Remote HEAD                      | Verified after push; exact SHA supplied in final handoff.                                        |
| 116 | Output Paths                     | Listed below.                                                                                    |

## Q1-Q15

**Q1. Why were 178/180 C6.0.1.5 single variants marked `EDGE_TRUNCATED`?**

The old audit compared a candidate to an Event interval that, for a single-variant event, was often defined by that candidate. Touching the self-defined event edge was then treated as truncation. Event edge is not ASR request edge, so the test was circular and over-classified 178 events.

**Q2. After using real ASR request edges, how many strong/weak edge risks remain?**

Across 229 candidate/request records: 20 strong and 40 weak. At event aggregate: 19 strong and 29 weak events, 48 with any edge risk.

**Q3. How much Primary decoder evidence was recovered?**

169/169 Primary candidates have explicit decoder-evidence records, coverage 1.0. Unknown or provider-unsupported subfields remain explicit rather than becoming zero. Recovery is 54/54 and re-ASR is 51/51.

**Q4. After multi-label risk, how many events are genuinely worth re-ASR?**

155 meet the frozen risk rule, but the bounded scheduler selects only the top 12 events (36 planned requests). The broad eligible count is driven mainly by token and CTC weakness, not the old uniform edge status.

**Q5. With the same or smaller budget, did it hit more true-error events?**

Not demonstrated. The policy selected 12 events, but only 8 had 24 verified cached requests; 4 selected events were unavailable without new inference. The intersection produced 15 historical candidates and one historical pool winner, but 0 safe canonical replacements and 0 quality gain. Gold-isolated evidence does not support a claim that it hit more true errors than C6.0.1.5.

**Q6. How much Event -> Final Text Span lineage is modifiable?**

161 of 199 events are span-mapped and modifiable; final-cue text coverage is `0.8074074074074075`. There are 57 exact, 30 normalized-exact, 53 split-derived, and 21 merge-derived spans.

**Q7. Was span-level Text Repair applied for the first time?**

No. Two proposals were produced, both failed strict safety/non-degradation gates, and 0 were applied.

**Q8. How much did Text Repair improve CER/material errors?**

0. Canonical text did not change, exact/normalized CER did not change, and material errors remained 77.

**Q9. Did start-only/end-only refinement materially increase safe timing mutations?**

It increased candidate mutations in the enforced ablation: 6 start-only, 7 end-only, and 2 both, 15 total. It did not increase production-safe mutations because Gold-isolated metrics did not improve and IoU worsened. Final A/B therefore applied 0.

**Q10. How many accidental overlaps were resolved and real overlaps preserved?**

0/0 under the strict evidence labels. Of 103 adjacent pairs, 11 proposals were evaluated, 37 remained ambiguous, and 55 remained review. The enforced candidate applied 8 pair changes but overlap count stayed 48, so no accidental-overlap resolution is claimed.

**Q11. Did Final P95/MAE/severe timing clearly improve?**

No. Final A/B intentionally preserve the baseline: P95 `5.385 s`, start/end MAE `1.609108 / 1.607836 s`, severe timing 53. The enforced boundary candidate slightly worsened start MAE and IoU while leaving P95/severe/overlap unchanged.

**Q12. How many remaining material errors are `CURRENT_WHISPER_CONSISTENTLY_WRONG`?**

0 under the strict definition requiring multiple evaluated Whisper windows with consistent wrong text. This is not proof that Whisper is perfect; it means the available evidence does not yet isolate that class.

**Q13. How much pipeline-recoverable space remains?**

The ceiling artifact identifies 34 re-ASR-recoverable cases, 40 association-remaining cases, and 3 unknown. These are different mechanisms and do not guarantee 74 safe repairs. Strict decision-recoverable/existing-variant/span-blocked counts are 0.

**Q14. Should rules stop now and the project switch to a second ASR/ensemble?**

Not yet as the immediate production path. Aggregate quality is poor, but the strict diagnosis assigns 40 errors to association and 34 to unexecuted/budgeted re-ASR potential, while consistently-wrong Whisper errors are 0. Continue evidence-backed pipeline recovery; do not add broad if/else rules. Reconsider an ensemble after those diagnosed paths are exhausted with real multi-window evidence.

**Q15. Does it pass the strict C6.0.2 gate and merit unseen validation?**

No. Material errors, normalized CER, severe timing, both MAEs, P95, and overlap fail the frozen gate. Outcome is `HOLD_FOR_MORE_PIPELINE_RECOVERY`; production remains review-only.

## Commits

- `bb5ce9bf66329609b4d8354a6e4cf94f1fb9d89b` — `fix: calibrate request-edge acoustic risk and preserve decoder evidence`
- `4cb9b8fc045da91c4c3cb748fe1812a8c8c321f9` — `feat: add multi-label risk and risk-driven re-ASR prioritization`
- `53077b573dfb9889d0b05c0d8555a6c8fe43ffe1` — `feat: add event-to-final text span lineage and span repair`
- `f073fa4b1f3812b0225206b2df95c66db983583d` — `feat: add partial and joint boundary refinement`
- `6e660140a92c80469a8f7bac7be7a0fc03c17222` — `feat: add ASR ceiling evaluation and integrate C6.0.1.6`
- Acceptance documentation: `docs: record C6.0.1.6 quality acceptance`; exact SHA is supplied by the final handoff because a commit cannot contain its own SHA.

## Real output paths

- Baseline/V0: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-baseline-20260828`
- Edge risk/V1: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-edge-risk-20260828`
- Risk vector/V2: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-risk-vector-20260828`
- Decoder evidence: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-decoder-evidence-20260828`
- Re-ASR priority/V3: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-reasr-priority-20260828`
- Span lineage/V4: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-span-lineage-20260828`
- Span repair/V5: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-span-repair-20260828`
- Partial timing/V6: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-partial-timing-20260828`
- Joint boundary/V7: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-joint-boundary-20260828`
- Full: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-full-candidate-20260828`
- Final A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-final-a-20260828`
- Final B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-final-b-20260828`
- Validation/ceiling: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-6-validation-20260828`
- Gold-isolated evaluations: sibling directories named `carnation-c6-0-1-6-{baseline,partial-timing,joint-boundary,full-candidate,final-a,final-b}-evaluation-20260828`.

## Final decision

- Engineering gate: **PASS**.
- Risk calibration / decoder evidence / span-lineage engineering: **PASS**.
- Span repair / partial timing / joint boundary safety architecture: **PASS**, but no production quality gain.
- Final A/B parity: **PASS**.
- Gold isolation / safety / Shareable / regressions / Skill validation: **PASS**.
- Pipeline quality milestone: **FAIL**.
- Strict C6.0.2 gate: **FAIL**.
- Outcome: **`HOLD_FOR_MORE_PIPELINE_RECOVERY`**.
- Production: **`needs-review` / `finalizationMethod = none` / `machineReleaseAuthorized = false`**.
