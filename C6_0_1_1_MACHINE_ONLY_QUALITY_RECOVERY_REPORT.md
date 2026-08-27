# C6.0.1.1 Machine-only Subtitle Quality Recovery

## 1. Executive Conclusion

C6.0.1.1 infrastructure acceptance passed, but the quality-recovery milestone did not. The work reproduced the frozen C6.0.1 baseline, traced the machine-only survival funnel, evaluated raw and final machine output behind the Gold barrier, ran Coverage/Timing/Full ablations, executed bounded real MFA/CTC/Speaker evidence, generated independent Final A/B outputs, and preserved all production safety gates.

The best coverage candidate was materially more complete: Full Recovery reached 157 cues, normalized CER `0.61669921875`, Gold text coverage `0.9609375`, and 7 missing-dialogue findings. It was not safe to select because material text errors rose from 39 to 75 and severe timing errors rose from 40 to 53. The frozen regression guard therefore selected the 51-cue legacy baseline for Final A/B. Production remains `needs-review`, `finalizationMethod = none`, `machineOnlyReleaseAuthorized = false`, and the next step is **HOLD C6.0.2**.

This is a successful root-cause/infrastructure delivery, not a successful automatic-finalization or subtitle-quality release.

## 2. Branch

`codex/c6-0-1-1-machine-quality-recovery`

## 3. Baseline

Development base: `f2e4edfbbb72257119ab1493f88046eb32ca717f`.

Source media: 847,774,958 bytes, SHA-256 `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`.

Evaluation-only Gold: 17,094 bytes, 192 cues, SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`.

## 4. Development-set Status

Carnation episode 1 is development-known. It is valid for runtime-blind, Gold-isolated diagnosis and acceptance; it is not an unseen benchmark. Gold was first read only after machine-output freeze and was never passed to generation, recovery, ranking, alignment, memory, or finalization.

## 5. Non-goals

This work does not use Gold to fill text or move cue boundaries, add Carnation-specific terminology, relax safety thresholds, authorize zero-touch release, change Skill 2/3, or begin C6.0.2. It also does not claim that a resolved speaker relationship automatically resolves a subtitle overlap.

## 6. C6.0.1 Baseline Replay

Baseline replay passed: the legacy configuration reproduced 51 cues and the expected canonical text, timing, and presentation hashes. It used 203 ASR requests, 203 inferences, 203 process starts/model loads, 0 cache hits, 2 broad primary requests, and 201 narrow recovery requests.

## 7. Runtime Identity

- Executable: `/opt/homebrew/bin/whisper-cli`
- whisper.cpp: `1.9.1`
- Executable SHA-256: `e25f8bab12a19e4df44d8889f35944a89816d7dfb01c0f8e5de4727fb0939924`
- Model: `large-v3`
- Model snapshot SHA-256: `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`
- Device: Apple M1 Pro / Metal
- Execution mode: process

## 8. Whisper Version Audit

Intended and actual versions both equal `1.9.1`. The baseline output identity reproduced under this runtime. Runtime compatibility and request-level execution evidence are verified.

## 9. 203 Request/Load Audit

The 203 baseline requests represent 69 unique audio intervals and 134 duplicate intervals. They processed 6,915.01 seconds of audio, including 4,010 duplicate seconds, in 1,341.4597 seconds of transcription time. The current process-per-request path reloads the model 203 times. No runtime optimization was applied because a one-load replacement was not proven semantically identical in this acceptance scope.

## 10. Machine Generation Architecture

The audited path is local media extraction -> coarse Whisper chunks -> machine utterances -> candidates -> atomic clusters -> winners -> deduplication -> fragment repair -> normalization -> segmentation -> final integrity -> presentation/finalization. Recovery requests and bounded acoustic evidence operate only on machine-derived inputs. Gold evaluation is a separate, post-freeze process.

## 11. Survival Funnel

The baseline funnel has eight explicitly audited transitions. It explains why 318 raw/canonical units and 203 ASR calls do not imply 318 final cues: the main pipeline rejects, clusters, deduplicates, merges, and quarantines most units.

## 12. Stage Counts

| Stage                            | Input | Output | Drop |
| -------------------------------- | ----: | -----: | ---: |
| canonical -> candidate           |   318 |    229 |   89 |
| candidate -> cluster             |   229 |    148 |   81 |
| cluster -> winner                |   148 |    148 |    0 |
| winner deduplication             |   148 |    121 |   27 |
| fragment repair                  |   121 |    114 |    7 |
| post-normalization deduplication |   114 |    108 |    6 |
| segmentation                     |   108 |    110 |    0 |
| final integrity                  |    78 |     51 |   27 |

The dominant machine-unit loss stage is `canonical-to-candidate` with 89 dropped units.

## 13. Character Survival

Baseline raw ASR contains 5,160 exact characters; the final baseline contains 856. Full Recovery contains 2,173 package characters (2,171 under evaluator exact-text normalization), a net package increase of 1,317 characters over baseline. This net increase is reported as a delta, not fabricated as exact causal recovery lineage.

## 14. Temporal Survival

The baseline speech-gap audit found 34 speech intervals totaling 859.221458 seconds, of which final cues covered 363.311946 seconds (`0.4228385394`). Full Recovery covered 586.811735 seconds (`0.6829574951`). Gold-relative temporal coverage is a separate evaluation metric and reached 1.0 for Full Recovery.

## 15. Rejection Reasons

The concrete baseline reasons are candidate evidence rejection (89), clustering/noncompetitive evidence (81), duplicate or prefix winner (27), fragment merged into neighbor (7), post-normalization duplicate (6), and final-integrity quarantine (27). Unknown rejection count is zero in Full Recovery.

## 16. Gold Loss Attribution

Gold attribution is evaluation-only. Baseline raw ASR had 0 missing Gold groups, while final baseline had 59; therefore all 59 are classified as `detected-then-filtered`. Exact stage-level Gold causality is left at zero where historical lineage is insufficient. Machine-unit drops are reported separately and are not mislabeled as Gold-causal loss.

## 17. Never Detected Speech

Baseline never-detected Gold loss count is `0`. Full Recovery raw ASR still has 5 never-detected Gold groups.

## 18. Detected Then Filtered

Baseline detected-then-filtered Gold loss count is `59`. Full Recovery reduces this to `2`, while retaining 5 raw-ASR misses for a total of 7 final missing-dialogue findings.

## 19. Association Loss

Baseline candidate-to-cluster drops 81 machine units; cluster-to-winner drops 0. Full Recovery candidate-to-cluster drops 182 because it creates a larger candidate pool. These are machine lineage counts, not exact Gold-loss claims.

## 20. Dedup Loss

Baseline winner deduplication drops 27 units and post-normalization deduplication drops 6. Full Recovery drops 21 and 1 respectively. The validator classifies `winner-deduplication` as deduplication loss rather than association loss.

## 21. Merge Loss

Baseline fragment repair drops/merges 7 units; Full Recovery drops/merges 10. No exact Gold count is assigned without exact surviving lineage.

## 22. Finalization Loss

Baseline final integrity quarantines 27 machine units. Full Recovery segmentation drops 2 and final integrity drops 4. The fail-closed quarantine is retained.

## 23. Raw ASR Quality

Baseline raw ASR: 318 cues, 5,160 exact characters, exact CER `2.2003499562554683`, normalized CER `2.27392578125`, Gold text coverage `1.0`, missing dialogue `0`, hallucination `33`, material text errors `166`, severe timing errors `51`, timing P95 `3.96 s`, and median timing IoU `0.5800`.

Full-profile raw ASR: 169 cues, exact CER `0.5831146106736658`, normalized CER `0.5166015625`, Gold coverage `0.97216796875`, missing dialogue `5`, material text errors `63`, and severe timing errors `37`.

## 24. Final Machine Quality

Baseline final: 51 cues, 856 exact characters, exact CER `0.8665791776027997`, normalized CER `0.85400390625`, Gold coverage `0.65185546875`, missing dialogue `59`, hallucination `0`, material text errors `39`, severe timing errors `40`, start/end MAE `3.1262/2.9830 s`, and P95 `7.57 s`.

## 25. Raw-vs-final Difference

The baseline pipeline improves raw hallucination/text noise but loses coverage: cue count -267, normalized CER -1.4199, Gold coverage -0.3481, missing dialogue +59, material errors -127, and severe timing errors -11. The primary problem is therefore mixed: raw Whisper has severe loop/hallucination errors, while the downstream funnel removes real dialogue along with noise.

## 26. ASR Chunking

Legacy generation uses two very broad chunks (0-480 s and 480-900 s), followed by 201 narrow recoveries. Full-profile generation uses 30-second target chunks and prompt isolation. Shorter chunks improve raw recognition/coverage but are not sufficient to make the selected final subtitle safe.

## 27. Duration/Text Density

The baseline repeatedly processes overlapping windows: 6,915.01 seconds of request audio for an approximately 15-minute episode. Duplicate audio accounts for 4,010 seconds. High request volume therefore does not represent independent dialogue evidence or guaranteed text survival.

## 28. VAD Audit

Legacy Whisper VAD mode is off. The original media timeline is preserved, and a separate machine speech-gap audit is available. Full recovery combines coverage and VAD-derived gap evidence, but no VAD-only boundary is treated as trusted token timing.

## 29. Token Timestamp Audit

Baseline has 1 primary accepted cue and 0 primary cues with token timestamps. Of 201 recovery attempts, 101 contain tokens, but all 3,491 tokens are unmapped to a verified global timeline. Trusted mapped-token count is `0`.

## 30. Token Timestamp Recovery

Token timestamp evidence was not restored. `trustedForCanonicalTiming = false`; the reason is `no-verified-mapped-token-timeline-in-current-run`. The implementation fails closed instead of promoting local timestamps with an unverified offset.

## 31. Local/Global Timestamp Mapping

Decoded segment time, mapped-token time, and VAD time remain distinct evidence types. No local-to-global mapping was accepted without verified containment and boundary semantics; consequently usable mapped-token count remains zero.

## 32. Speech Coverage Gap

Baseline: 63 gaps, 34 speech intervals, 859.221458 speech seconds, 363.311946 covered seconds. Full: 54 gaps and 586.811735 covered seconds. Coverage-gap evidence is machine-only.

## 33. Missing Dialogue Recovery

Legacy recovery records 67 units, 201 requests, 4 recovered units, and 63 unresolved units. Full records 39 recovery units, 7 recovered, 32 unresolved, and 70 cache hits from the previously executed full-profile ASR evidence. Gold missing dialogue falls from 59 to 7 in Full Recovery, but Final A/B safely retain 59 because Full fails regression guards.

## 34. Recovery Hallucination Guard

Legacy recovery used adjacent unverified machine text in 195/201 attempts and is marked contaminated. Full disables unverified adjacent/refinement/cross-chunk prompt text: adjacent prompt count `0`, unverified prompt count `0`, prompt isolation passed. Full hallucination count is 1, within the frozen maximum of 2.

## 35. Segmentation Recovery

Natural segmentation increases baseline normalized units from 108 to 110 without inventing a negative drop. Full reaches 157 final cues, but count alone is not a quality criterion and is never compared to 192 as an acceptance shortcut.

## 36. MFA Machine Integration

Real MFA evidence was executed against seven bounded overlap components / sixteen cues. It produced 32 attempts/processes, 28 successful alignments and 4 failures, 16 cue evidence records, 7 stable and 7 unstable windows, 0 automatic subtitle-overlap resolutions, and 0 canonical text/timing mutations.

## 37. MFA Runtime Count

MFA integration: 32 inferences, 32 loads, 0 cache hits. Runtime identity: `bffcf0f5e1204f4e7337ba96e780ce515d3b4bb74a6c43ab2bb6ba908d10750e`. Evidence is verified but observe-only because no safe mutation passed.

## 38. CTC Machine Integration

Real local CTC executed on the same bounded sixteen cues. It produced 32 path-success attempts; 5 windows were stable but edge-pinned. No subtitle overlap was safely resolved, and canonical text/timing mutations remained zero.

## 39. CTC Runtime Count

CTC integration: 32 inferences, 1 model load, 0 cache hits, 16 usable cue evidence records. Runtime identity: `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`; model snapshot SHA-256 `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`; device CPU.

## 40. Speaker Integration

Real speaker diarization executed for seven components / sixteen cues. Four speaker relationships were resolved and three remained unresolved. These are speaker relationships only; subtitle overlap resolved count remains zero and no canonical mutation occurred.

## 41. Speaker Runtime Count

Speaker integration: 14 inferences, 1 load, 0 cache hits, 7 component evidence records, 4 applied relationship decisions. Runtime identity: `3c188505fcc51dfd8b10b07de9dcafc93b5668201be1d95676a6c458c1118976`.

## 42. Overlap Recovery

The bounded overlap precursor made 21 Whisper requests/inferences/loads for seven components. Full candidate presentation contains 40 machine overlap pairs in 20 blocking components; acoustic analysis resolved 0 subtitle overlaps. Selected Final A/B contain 0 machine overlap pairs. Gold has 9 overlap cases, so overlap preservation is not recovered.

## 43. Separation

Seven components were eligible for inspection, but separation trigger count, requests, inference, loads, cache hits, text mutations, and timing mutations are all zero. The experimental separation resource was not used to change output.

## 44. Machine-only Memory

Initial entries `0`; final entries `0`; human-derived entries `0`; same-cue leak `0`; future-cue leak `0`. Final A/B memory hash is `48ddbe1550b20e77ef7ecbe284313f5f0478e327ed70d63ee00bebeebf3c18d9`.

## 45. Recognition Error Attribution

Whisper is responsible for substantial raw looping/hallucination and lexical error. The downstream pipeline is independently responsible for the 59 baseline detected-then-filtered missing groups. Neither subsystem alone explains the outcome.

## 46. Timing Error Attribution

Raw baseline P95 is 3.96 s, while final baseline P95 is 7.57 s; downstream association/finalization therefore worsens boundary error. Full-profile raw recognition and expanded coverage improve median IoU, but weak token mapping and unresolved alignment evidence leave Full P95 at 6.8685 s and severe timing errors at 53.

## 47. Quality Recovery Policy

Policy version: `c6.0.1.1-machine-quality-recovery-v1`. Canonical policy-content hash after excluding run/time envelope: `41df65505953acaa46446442e99d1f6c59241f3d9e3e4128b6bec85452070207`. Final A/B configuration hash: `fc1d90cfe540f1ce95b09c7e949edf1226a733b9b8dd2ff713e2f4c8500c77bb`.

Milestone thresholds are normalized CER <= 0.65, coverage >= 0.80, missing <= 35, material text <= 30, start/end MAE <= 1.75 s, P95 <= 4.5 s, severe timing <= 25, and hallucination <= 2.

## 48. Observe Mode

Observe emits all diagnostics without changing baseline text/timing/presentation. Its 51 cues, metrics, and canonical hashes exactly match Baseline.

## 49. Enforce Mode

Enforce permits only machine-evidence mutations allowed by the frozen profile. It does not override regression guards, production review gating, Gold isolation, or unknown-evidence fail-closed behavior.

## 50. Ablation Baseline

Legacy Baseline: 51 cues; normalized CER `0.8540`; coverage `0.6519`; missing 59; material 39; severe timing 40; P95 `7.57 s`; hallucination 0; P1 138. Regression guard passed only because it is the comparison baseline.

## 51. Coverage-only

Coverage: 98 cues; 117 ASR requests/inferences/loads; exact CER `0.7122`; normalized CER `0.6787`; coverage `0.8179`; missing 29; material 63; severe timing 43; P95 `6.481 s`; hallucination 1. It improves coverage but fails text and timing regression guards.

## 52. Timestamp-only

Timing: 82 cues; 225 requests, 182 inferences, 225 process/model loads; exact CER `0.6824`; normalized CER `0.6475`; coverage `0.8447`; missing 24; material 54; severe timing 49; P95 `7.302 s`; hallucination 0. Trusted mapped-token timing remains unavailable, so the profile is not selected.

## 53. MFA

MFA ablation evidence is real and verified, but applies 0 subtitle mutations and resolves 0 overlap components. It cannot by itself improve the Gold metrics.

## 54. CTC

CTC evidence is real and verified, but applies 0 subtitle mutations and leaves all seven review components unresolved. It cannot be counted as an automatic timing recovery.

## 55. Speaker

Speaker evidence resolves 4/7 relationships while resolving 0/7 subtitle overlaps. Relationship evidence is retained for review and is not converted into a cue deletion, merge, or time edit.

## 56. Memory

The machine-only memory ablation remains empty. It proves isolation/leak guards but provides no recognition improvement on this episode.

## 57. Full Recovery

Full: 157 cues; exact CER `0.6701662292`; normalized CER `0.61669921875`; coverage `0.9609375`; missing 7; hallucination 1; material 75; severe timing 53; start/end MAE `1.8148/1.8710 s`; P95 `6.8685 s`; median IoU `0.58247`; P1 136. Integrated MFA/CTC/Speaker execution totals 78 inferences and 34 loads; the separate overlap precursor adds 21 Whisper inferences/loads. Full is a Pareto tradeoff, not an acceptable winner.

## 58. Candidate Selection

The deterministic metric ranking would prefer Timing before Full, but every non-baseline recovery candidate fails the frozen guard for worse material text and timing defects. The selector therefore chooses Baseline before ranking. This prevents improved coverage from purchasing unsafe text/timing regressions.

## 59. Final A

Final A independently regenerated the selected legacy configuration with a fresh output, cache, and memory store: 203 requests/inferences/loads, 0 cache hits, freeze hash `312ddeff4acd1cffb6179b1ca470cffa4912120de56f213388cf548072bf0be2`, and shadow outcome `REVIEW_REQUIRED`.

## 60. Final B

Final B independently regenerated the same selected configuration: 203 requests/inferences/loads, 0 cache hits, freeze hash `74146d8d6664b3ee3f0813c3c6f4e31bd5f8814ae2412c205fdde158cef65749`, and shadow outcome `REVIEW_REQUIRED`.

## 61. A/B Reproducibility

Text exact parity, timing exact parity, presentation exact parity, recovery-decision parity, Gold metric parity, and shadow-outcome parity all passed. Barrier semantic hash: `b31109899e2df400abad84a0cb4c8d47f5814ac896f6efdb08cd6a3962bf4156`. Evaluation made 0 model inferences and 0 mutations; output hashes remained unchanged after Gold.

## 62. Cue Count

Baseline/Observe/Coverage/Timing/Full/Final A/Final B cue counts are `51 / 51 / 98 / 82 / 157 / 51 / 51`.

## 63. Character Count

Exact machine characters are Baseline 856, Coverage evaluator 1,302 (package 1,304), Timing evaluator 1,291 (package 1,297), Full evaluator 2,171 (package 2,173), and Final A/B 856 each. Raw baseline ASR has 5,160.

## 64. Exact CER

Baseline `0.8665791776`; Coverage `0.7121609799`; Timing `0.6824146982`; Full `0.6701662292`; Final A/B `0.8665791776 / 0.8665791776`.

## 65. Normalized CER

Baseline `0.85400390625`; Coverage `0.6787109375`; Timing `0.6474609375`; Full `0.61669921875`; Final A/B `0.85400390625 / 0.85400390625`.

## 66. Gold Coverage

Baseline `0.65185546875`; Coverage `0.81787109375`; Timing `0.8447265625`; Full `0.9609375`; Final A/B `0.65185546875`.

## 67. Machine-supported Text

Baseline/Final `1.0`; Coverage `0.9964444444`; Timing `1.0`; Full `0.9978980557`. The one Full hallucination candidate prevents a perfect Full machine-supported ratio.

## 68. Missing Dialogue

Baseline 59; Coverage 29; Timing 24; Full 7; Final A/B 59. The Full improvement is real but not selected because other safety metrics regress.

## 69. Hallucination

Baseline 0; Coverage 1; Timing 0; Full 1; Final A/B 0. Coverage recovery did not create a large hallucination increase.

## 70. Material Text Errors

Baseline 39; Coverage 63; Timing 54; Full 75; Final A/B 39. This is the main reason high-coverage candidates are unsafe.

## 71. Severe Timing Errors

Baseline 40; Coverage 43; Timing 49; Full 53; Final A/B 40. Recovery did not meet the maximum of 25.

## 72. Start MAE

Baseline `3.1262 s`; Coverage `2.2305 s`; Timing `2.2627 s`; Full `1.8148 s`; Final A/B `3.1262 s`. Full narrowly misses the `1.75 s` milestone.

## 73. End MAE

Baseline `2.9830 s`; Coverage `1.8083 s`; Timing `2.1989 s`; Full `1.8710 s`; Final A/B `2.9830 s`. No recovery profile meets `1.75 s`.

## 74. Timing P95

Baseline `7.57 s`; Coverage `6.481 s`; Timing `7.302 s`; Full `6.868542 s`; Final A/B `7.57 s`. Full improves baseline by approximately `0.7015 s`, but remains far above the `4.5 s` milestone.

## 75. Timing IoU

Median IoU: Baseline `0.5386666667`; Coverage `0.5217391304`; Timing `0.5340782123`; Full `0.5824665676`; Final A/B `0.5386666667`.

## 76. Overlap Preservation

Gold overlap count is 9. Baseline and selected Final A/B preserve 0 machine overlap pairs. Full creates 40 overlap pairs but leaves 20 components blocking and resolves 0, so they cannot be treated as safely preserved dialogue.

## 77. P0/P1/P2

Baseline/Final: P0 `0`, P1 `138`, P2 `7`. Coverage: `0/136/41`; Timing: `0/127/25`; Full: `0/136/67`. P0 remains zero, but no recovery profile improves the full P1/P2 safety picture enough to pass selection.

## 78. Baseline Comparison

Full improves normalized CER by `0.2373`, coverage by `0.3091`, missing dialogue by 52, start MAE by `1.3114 s`, end MAE by `1.1120 s`, and P95 by `0.7015 s`. It worsens material text errors by 36, severe timing errors by 13, hallucination by 1, and introduces 40 unresolved overlap pairs.

## 79. Milestone

`qualityRecoveryMilestonePassed = false`. Only hallucination meets the full selected-output milestone. Eight quality checks fail for Final A/B: normalized CER, coverage, missing dialogue, material text, start MAE, end MAE, P95, and severe timing.

## 80. Stretch Target

Stretch target also failed. No selected result reaches normalized CER <= 0.50, coverage >= 0.90, start/end MAE <= 1.0 s, P95 <= 2.5 s, and missing dialogue <= 20 simultaneously.

## 81. Shadow Outcome

Final A/B shadow outcome is `REVIEW_REQUIRED`. Full candidate also remains `REVIEW_REQUIRED`. Review withholding is the intended behavior under unresolved high-risk evidence.

## 82. Unsafe Escape

Unsafe finalization escape count is zero. Gold mutation count is zero; evaluator inference count is zero; both output hashes are unchanged after Gold.

## 83. Production Release Gate

Production is `needs-review`, `finalizationMethod = none`, `machineOnlyReleaseAuthorized = false`. No recovery result bypasses the C6.0 protected-finalization contract.

## 84. C6.0.1 Regression

Gold isolation, dual freeze, evaluator replay, A/B parity, and output immutability remain passing. C6.0.1 safety behavior is preserved.

## 85. C6.0 Protected Regression

Protected human and machine-negative-control semantics remain fail-closed. No threshold was lowered and no production review count was disguised as automatic resolution.

## 86. C5.19 Regression

C5.19 terminology/memory contracts remain compatible. No human-derived series memory was used; source-specific terminology was not hardcoded.

## 87. Skill 2

Skill 2 was not modified. Compatibility remains expected-gated.

## 88. Skill 3

Skill 3 was not modified. Compatibility remains expected-gated.

## 89. Schemas

Generated schema count is 164: the 149 prior schemas plus 15 strict C6.0.1.1 schemas covering policy, runtime, funnel, retention, gaps, recovery, timestamps, MFA/CTC/Speaker, ablations, Gold loss, comparison, and validation.

## 90. Unit Tests

Final full unit run under Node `v24.18.0` / npm `11.18.0`: 62 files; 591 passed, 2 skipped. Typecheck, lint, format check, build, and schema generation pass.

## 91. E2E

Final explicit E2E run: 14 files; 33 passed, 1 skipped. The dedicated C6.0.1.1 E2E freezes machine output before Gold, writes all quality sidecars, validates replay/mutation isolation, and retains `needs-review/none`.

## 92. Targeted Tests

Comprehensive targeted C5.19/C6.0/C6.0.1/C6.0.1.1 and quality/runtime suites: 31 files, 107 passed. The additional C5.18 Speaker evidence/runtime/E2E selection passed 23 with 1 intentional skip. Dedicated C6.0.1.1 E2E: 1 passed. Skill validation: `Skill is valid!`.

## 93. Input Read-only

Source video and Gold SHA-256 identities are unchanged. Gold `readOnlyVerified = true`; source read-only verification passed. Generation runtime Gold/human-derived input count is zero.

## 94. Network

Generation/evaluation network use, cloud inference, online subtitle search, and web subtitle fallback are all zero/false.

## 95. Shareable

Shareable audit passed: 1 artifact, 0 absolute-path leaks, 0 secrets, 0 Gold-text leaks, and 0 broken relative references. The shareable summary contains identities/metrics, not Gold subtitle content.

## 96. Dataset-overfit Audit

Generic production quality modules contain no `カーネーション`, `水茄子`, or cue-specific timestamps. Dataset-specific hardcoding count is `0`. Source/Gold SHA constants occur only in the explicit benchmark/evaluator harness where identity pinning is required.

## 97. Remaining Quality Risks

The largest risks are raw Whisper loops and lexical errors, unsafe filtering of detected dialogue, untrusted token-to-global timing, broad final boundary errors, unresolved overlap, high material text errors, process-per-request cost, one development-known episode only, and no proof of unseen generalization.

## 98. GO/HOLD C6.0.2

**HOLD_FOR_MORE_QUALITY_RECOVERY.** Infrastructure is ready, but the selected quality remains essentially the C6.0.1 baseline and the milestone is false. Do not spend the real unseen-episode budget yet.

## 99. C6.0.2 Requirements

Before C6.0.2, improve raw Japanese recognition without prompt contamination, preserve dialogue through candidate/cluster/dedup/final-integrity stages, restore verified mapped-token timing, reduce material/severe timing defects without sacrificing coverage, and pass the frozen milestone with A/B reproducibility, zero Gold runtime use, and zero safety regressions.

## 100. Commits

The audit-friendly commit chain begins with `2eea093` (diagnostics), continues through funnel/Gold attribution/prompt isolation/ranking/coverage/timing/integration/test commits, reaches `f13236f` (bounded machine acoustic evidence), `d38ea5f` (acceptance-gap tests), and `cec50c0` (loss-stage classification). The acceptance/report commit is the commit containing this document.

## 101. Remote HEAD

Remote HEAD is verified after the acceptance commit is pushed. The final delivery response records exact Local HEAD == Remote HEAD equality and clean worktree status.

## 102. Real Output Paths

- Baseline: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-quality-baseline-20260827`
- Observe: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-quality-observe-20260827`
- Coverage: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-coverage-recovery-20260827`
- Timing: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-timing-recovery-20260827`
- Full core: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-full-recovery-core-20260827`
- Full integrated: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-full-recovery-20260827`
- Final A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-final-a-20260827`
- Final B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-final-b-20260827`
- Final A evaluation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-final-a-evaluation-20260827`
- Final B evaluation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-final-b-evaluation-20260827`
- Dual-freeze barrier: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-final-ab-barrier-20260827.json`
- Validation/shareable: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-1-quality-validation-20260827`

## Core Questions

### Q1. Why did 203 ASR requests produce only 51 cues?

Only two requests were primary broad generation; 201 were overlapping recovery requests, 134 request intervals were duplicates, and 195 recoveries were contaminated by the same unverified adjacent machine text. The eight-stage funnel then dropped 89 + 81 + 27 + 7 + 6 + 27 machine units at audited rejection/quarantine stages. Request count is therefore not equivalent to surviving cue count.

### Q2. Where were the 59 missing dialogue groups lost?

They were mainly lost after ASR. Raw baseline ASR has 0 missing Gold groups; final baseline has 59. They are `detected-then-filtered`. Historical lineage cannot safely attribute each Gold group to Association, Filter, Merge, or Finalization, so only machine-unit drops are reported for those stages.

### Q3. What are raw and final CER?

Baseline raw exact/normalized CER: `2.2003499563 / 2.27392578125`. Baseline final: `0.8665791776 / 0.85400390625`. Full final: `0.6701662292 / 0.61669921875`. Selected Final A/B equal baseline final.

### Q4. Is the main text problem Whisper or downstream?

Both. Whisper raw output contains heavy loops, hallucinations, and lexical error. Downstream filtering removes all 59 baseline missing groups that raw ASR had detected. Quality recovery needs both better raw recognition and higher-precision survival decisions.

### Q5. Why is token timestamp evidence absent?

The accepted primary cue has no token time, recovery tokens are only local, and no verified mapping connects 3,491 recovered tokens to the original global timeline. The system correctly rejects `extractionStart + localTime` as insufficient without verified containment semantics.

### Q6. Why were MFA/CTC/Speaker zero in the original machine-only route?

The legacy Video-only path never invoked the later targeted C5 integration runners. C6.0.1.1 wires bounded real evidence into Full Recovery, where MFA/CTC/Speaker execute 32/32/14 inferences respectively, without pretending their observe-only results mutate canonical subtitles.

### Q7. How much did C5.17-C5.19 integration improve the result?

The Full candidate improves coverage and missing-dialogue metrics substantially, but the real MFA/CTC/Speaker evidence itself applies zero canonical text/timing mutations; Speaker adds four relationship resolutions only. Full still fails text/timing regression guards, so the safe selected result does not improve over baseline.

### Q8. Why does timing P95 move from 7.57 s to 6.8685 s?

Shorter isolated chunks and expanded coverage add better localized machine segments, lowering P95 by about 0.7015 s. Untrusted token mapping, unresolved boundary evidence, and newly covered difficult dialogue keep P95 well above the 4.5 s milestone and increase severe timing findings.

### Q9. Did missing dialogue fall without a large hallucination increase?

Yes in Full: missing dialogue falls 59 -> 7 while hallucination rises only 0 -> 1. However material text errors rise 39 -> 75 and severe timing errors 40 -> 53, so this is a Pareto tradeoff and not a safe winner.

### Q10. Should a real unseen episode be consumed for C6.0.2 now?

No. The quality milestone is false and the selected A/B output is still the legacy baseline. The correct decision is `HOLD_FOR_MORE_QUALITY_RECOVERY` while preserving all C6 safety architecture.
