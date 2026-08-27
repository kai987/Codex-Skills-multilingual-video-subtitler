# C6.0.1.3 Candidate Association & Canonical Assembly Recovery

Date: 2026-08-28  
Policy: c6.0.1.3-candidate-association-canonical-assembly-v1  
Policy semantic hash: 18f526373aab51b44f02a404eae27f3a7cb46d93cc082d9f0a05a955980c3dbc

This report records engineering acceptance and the separate subtitle-quality decision. Carnation episode 1 is a known development set. Its Gold subtitle was available only to the isolated post-generation evaluator, after every machine output and stage freeze; it was never supplied to runtime association, assembly, timing, memory, or finalization.

## 1. Executive Conclusion

C6.0.1.3 engineering acceptance passed: the association ledger, event-first model, canonical assembly, transform-chain audit, non-degradation ledger, stage trace, overlap attribution, strict schemas, blind offline replay, Final A/B parity, Gold isolation, hardcoding audit, and all requested test suites passed. Subtitle-quality acceptance remains HOLD_FOR_MORE_ASSOCIATION_ASSEMBLY_RECOVERY. Production remains needs-review, finalizationMethod = none, and machineOnlyReleaseAuthorized = false.

## 2. Branch

Branch: codex/c6-0-1-3-candidate-association-canonical-assembly. Base and requested remote baseline: 8cf1ebd881d3ec6197c874e851c146dc940608df.

## 3. Baseline

The baseline is a fresh offline replay of C6.0.1.2 using the same source, exact portable ASR cache, model identity, reference-free arguments, empty machine memory, and Gold-isolated evaluator. It produced 156 final cues and exactly reproduced the C6.0.1.2 Final metrics.

## 4. Development-set Status

This is a known development example with 192 Gold cues. No episode 2, episode 3, or any other unseen Gold was opened. The outcome is therefore not an unseen-generalization result.

## 5. Goals

The iteration makes every candidate disposition auditable, associates candidates to acoustic events before choosing text, preserves one real candidate as each default canonical cue, carries explicit timeline transforms, rejects unsupported destructive operations, and locates the earliest measurable quality regression without expanding recall scope.

## 6. Non-goals

The work did not change the Whisper model, broaden dialogue recovery, tune against runtime Gold, fabricate VAD offsets, lower review thresholds, authorize machine-only release, rerun unavailable MFA/CTC/speaker/separation providers, or modify Skill 2/3.

## 7. C6.0.1.2 Replay

Replay passed. V0 reproduced 156 cues, exact CER 0.6771653543307087, normalized CER 0.6201171875, coverage 0.9462890625, missing 9, hallucination 2, material errors 74, severe timing errors 53, start MAE 1.764667572474024 s, end MAE 1.894287250610067 s, P95 6.760999999999967 s, median temporal IoU 0.5699999999999932, and 49 rendered overlap pairs.

## 8. Raw ASR Baseline

Raw ASR had 169 cues, exact CER 0.5831146106736658, normalized CER 0.5166015625, coverage 0.97216796875, missing 5, hallucination 2, material errors 63, severe timing errors 37, start MAE 1.3203134328358284 s, end MAE 1.3926641791044845 s, P95 6.470000000000027 s, and median temporal IoU 0.6761133603238165.

## 9. Final Baseline

The C6.0.1.2-compatible baseline final had 156 cues and the V0 metrics in section 7. It is intentionally separate from the 161-cue C6.0.1.3 candidate.

## 10. Raw-to-Final Regression

Before C6.0.1.3, the downstream path worsened normalized CER from 0.5166015625 to 0.6201171875, material errors from 63 to 74, severe timing errors from 37 to 53, missing dialogue from 5 to 9, and both boundary MAEs. The persisted legacy artifacts do not expose enough Gold-isolated intermediate snapshots to assign that historical first regression more narrowly without guessing.

## 11. Candidate-to-Cluster Loss

The historical 365→199 count was previously described as 166 candidates “dropped.” The new ledger proves that all 365 candidates are conserved exactly once: 199 assigned representatives, 136 duplicates, 28 ambiguous, and 2 rejected. Therefore 166 is a grouped/non-winner count, not a silent-drop count.

## 12. Candidate Association Ledger

The strict machine-candidate-association-ledger contains 365 records for 365 source candidates and 199 atomic clusters. It reports assigned 199, duplicate 136, ambiguous 28, rejected 2, quarantined 0, superseded 0, unaccounted 0, unknown reasons 0, and multiply assigned 0; candidateConservationPassed = true.

## 13. Association Reason Ontology

Every non-winner has an explicit machine reason. Duplicate-event accounts for the 136 duplicate dispositions, multiple-valid-clusters accounts for the 28 ambiguous dispositions, and hallucination-risk accounts for the 2 rejected dispositions. Hard incompatibilities are separated from deterministic tie-break evidence.

## 14. Unknown Drops

Unknown candidate drops: 0. Silent candidate drops: 0. The final system refuses to infer “dropped” merely from the arithmetic difference between candidate and cluster counts.

## 15. Gold Post-hoc Drop Attribution

Gold was applied only after output freezing. Among the 166 non-winners, 8 are attributed to association loss, 4 to text-variant loss, and 154 to no Gold-supported loss. Runtime dispositions and Gold attribution are different axes: the 28 ambiguous candidates include 8 association losses and 20 with no observed Gold loss; 4 duplicate candidates have text-variant loss.

## 16. Event-first Architecture

The runtime now builds candidate evidence and hard-compatibility relations, records every disposition, forms canonical acoustic events, and only then selects a real machine candidate for assembly. Text score alone cannot define event identity.

## 17. Canonical Events

The event artifact contains 199 events and no event without a candidate. Its semantic hash is 6b141291f3b5bdacf7fe9cdb2eb981793cd755217e4f68d08d0901654cec6858.

## 18. Event Types

Event types are 185 single utterances and 14 chant/crowd events. Rapid turn, multi-speaker overlap, background/foreground, continuation, and ambiguous event counts are all 0. Zero speaker events means no current provider evidence, not proof that the episode has no multiple speakers.

## 19. Candidate-to-Event Assignment

Assigned representative count is 199. Each assigned candidate has one event, and no candidate is assigned to multiple events. Ambiguous alternatives remain recorded rather than being silently forced into an event.

## 20. Hard Incompatibility

Temporal/event boundaries and incompatible evidence are evaluated before tie-breaking. The added dedup and fragment-repair boundary guards preserve sequential repetitions and block unsupported cross-event joining.

## 21. Tie-break Evidence

Tie-breaking uses localized temporal, lexical, family, correlation, and provenance evidence only after hard compatibility. A single aggregate association score is not allowed to override a hard incompatibility.

## 22. Ambiguous Assignment

Ambiguous candidate count is 28. These records retain their possible-cluster evidence and multiple-valid-clusters reason; they are not auto-promoted merely to maximize cue count.

## 23. Quarantine

Candidate quarantine count is 0. Timebase quarantine is separate: 35 requests remain unusable for global token mapping because their VAD remapping is unproven.

## 24. Canonical Assembly

Assembly evaluated 199 events and emitted 199 event-level output cues. It preserved 199 real winners, selected 0 synthetic variants, quarantined 0 events, and made 0 text and 0 timing mutations. Assembly semantic hash is 3a0feb0e593eba1d4160098c2a200df47810a40c1e0f4de60b6ba987b4fa2a45.

## 25. Text Variant Selection

The default source for every event is one actual machine candidate. Long-variant selection count is 0; the implementation does not manufacture a longer cue when localized evidence cannot support it.

## 26. Prefix/Suffix Shadow

Prefix/suffix shadow prevention count is 0 because no eligible proposal was made in this replay. Boundary-aware dedup tests nevertheless prove that sequential repeated utterances are retained.

## 27. Supported Text Retention

All 199 evaluated events are fully retained. Strong-supported candidate count is 49, minimum strong-text retention ratio is 1.0, and unsupported strong-text deletions are 0.

## 28. Synthetic Merge Prevention

Synthetic joins are 0, unsupported merges are 0, and synthetic-merge rejections are 0 because no synthetic proposal reached the mutation gate. The invariant is enforced by schema, implementation, and tests.

## 29. Cross-speaker Merge Prevention

Cross-speaker merge attempts and rejections are 0 because speaker evidence was unavailable. The system makes no claim that a merge is cross-speaker without provider evidence.

## 30. RAW_TO_CANONICAL_NON_DEGRADATION

The canonical non-degradation ledger evaluated 199 operations. Accepted mutations, rejected mutations, strong-text deletions, unsupported merges, unsupported time expansions, and event-coverage regressions are all 0; runtimeNonDegradationPassed = true.

## 31. Timeline Transform Chain

The transform artifact covers all 117 ASR requests and records source, parent, requested/extracted interval, local origin, offset, scale, VAD state, cache lineage, and verification status. It reports 82 verified, 35 quarantined, 0 unavailable, and 0 unverified offsets applied.

## 32. VAD Timebase

The 35 VAD requests are quarantined because persisted artifacts do not prove a post-VAD sample-to-parent coordinate mapping. The implementation refuses to flatten their local token times into media-global times.

## 33. Recovery Timebase

Recovery requests retain their parent request and extraction identities. Non-VAD recovery can use a verified parent offset; VAD recovery remains association-pending until its inner remap is proven.

## 34. Nested Clip Mapping

Nested mappings are composed along the parent chain. Offset and scale cannot be inferred from filenames or request labels, and all verified scales are 1.

## 35. Ambiguous Timebase

Ambiguous-time-base tokens remain 373, unchanged from baseline. Their dominant source is VAD-derived decoder-local evidence without a persisted VAD remap.

## 36. Trusted Global Tokens

The token universe contains 970 observations, 886 lexical tokens, and 235 trusted mapped tokens. A further 179 tokens pass request containment but are association-pending; 414 request-mappable tokens must not be mislabeled as 414 trusted tokens.

## 37. Trusted Cue Coverage

At the 149-cue timing layer, 16 cues have trusted tokens (0.10738255033557047) and 8 are timing eligible (0.053691275167785234). The separate token-bearing candidate-domain coverage is 0.5882352941176471; these denominators are intentionally kept distinct.

## 38. Timing Gate Placement

Timing evidence is evaluated as early as an auditable cue exists and again at event/cluster/merge/assembly boundaries. Later stages cannot expand or replace an interval simply because a broader cluster contains it.

## 39. Candidate-stage Timing Gate

The inherited trusted-token gate evaluated 149 cues, proposed 8 mutations, accepted 6, rejected 2, and left 141 unchanged. It applied 6 trusted-token changes, no MFA/CTC changes, and recorded zero timing-regression escapes.

## 40. Event-stage Timing Gate

Event construction retains representative intervals and event boundaries. C6.0.1.3 added no event-stage timing mutation and no event-coverage regression.

## 41. Cluster-stage Timing Gate

Cluster intervals are not defined as an unconditional union of members. Cluster-expansion proposals and accepted/rejected C6.0.1.3 mutations are 0 in this replay.

## 42. Merge-stage Timing Gate

Merge intervals require evidence continuity and pause safety. Merge-expansion proposals/rejections are 0 in C6.0.1.3, and unsupported merge count is 0.

## 43. Canonical-stage Timing Gate

Canonical assembly made 0 timing mutations. The final operation ledger therefore preserves the selected candidate intervals exactly at this layer.

## 44. Cluster Interval

Each event uses a representative interval rather than the min-start/max-end union of all alternatives. No cluster-interval expansion is attributed as an overlap root cause.

## 45. Representative Interval

Every one of the 199 assembly cues points to a real source candidate and carries that candidate's interval. Representative selection is deterministic and hash-bound.

## 46. Merge Timing

No synthetic merge or merge-driven timing expansion occurred. The implementation requires localized evidence and non-degradation checks before any future merge can alter timing.

## 47. Pause Boundary

Pause and event-boundary guards prevent deduplication or fragment repair from crossing a sequential utterance boundary. Regression tests cover repeated words that must remain separate.

## 48. Canonical Non-Degradation Ledger

The ledger semantic hash is stable across Final A/B. It records 199 evaluated retain-source operations and zero destructive mutation, rather than declaring safety from the absence of a thrown error.

## 49. High-risk Operations

High-risk accepted operations are 0, and high-risk rejected operations are 0 because no destructive text/timing proposal was attempted. The earlier timing gate separately rejected 2 of 8 localized boundary proposals, including 1 expansion counter.

## 50. Stage Quality Trace

The machine trace contains Raw ASR, Normalized, Candidate, Acoustic Family, Event Assignment, Cluster, Winner, Dedup, Fragment Repair, Canonical Assembly, Segmentation, Final Integrity, and Final Machine. Runtime trace entries contain only machine facts; Gold metrics are attached post hoc by the isolated evaluator.

## 51. First Text Regression Stage

Historically, the first measurable text regression is Raw ASR→pre-C6.0.1.3 V0 Final: normalized CER 0.5166015625→0.6201171875 and material errors 63→74. The available old artifact granularity cannot truthfully identify a narrower internal legacy stage. Within C6.0.1.3, V2 Event Association is the first output-changing stage: CER and coverage improve, while material errors increase from 74 to 76.

## 52. First Timing Regression Stage

Historically, severe timing first measurably rises Raw ASR→V0 Final, 37→53; the persisted legacy trace cannot localize it further. Within C6.0.1.3 no stage increases severe timing: V2 improves MAE/P95 and V3–V5 remain identical.

## 53. Raw CER

Raw exact CER is 0.5831146106736658 and normalized CER is 0.5166015625.

## 54. Candidate CER

The runtime Candidate trace is Gold-free and therefore has no embedded CER. The closest isolated output proxy is V1, identical to V0 at exact 0.6771653543307087 and normalized 0.6201171875; no unsupported per-unit CER is fabricated.

## 55. Event CER

V2 Event Association is the first isolated event-first output: exact CER 0.6601049868766404 and normalized CER 0.6015625.

## 56. Cluster CER

No separately rendered Gold-evaluable cluster subtitle exists. Cluster unit count is 199, and later V2–V5 outputs remain metric-identical; a distinct cluster CER is therefore unavailable, not inferred.

## 57. Assembly CER

V3 Canonical Assembly remains exact 0.6601049868766404 and normalized 0.6015625, with 0 assembly text mutations.

## 58. Final CER

Final A/B exact CER is 0.6601049868766404 and normalized CER is 0.6015625.

## 59. Coverage by Stage

Raw coverage is 0.97216796875; V0/V1 is 0.9462890625; V2 Event Association through V5 and Final is 0.96484375. Non-rendered internal stages do not receive invented Gold coverage values.

## 60. Material Errors by Stage

Raw is 63; V0/V1 is 74; V2–V5 and Final are 76. Thus event-first recovery improves recall/CER but exposes two additional material errors and does not meet precision targets.

## 61. Severe Timing by Stage

Raw is 37; V0/V1 is 53; V2–V5 and Final remain 53. No C6.0.1.3 stage worsened the aggregate severe-timing count, but none repaired it.

## 62. Overlap Root Cause

At the assembly event scope, 56 pairs are classified: ambiguous timebase 20, rapid-turn padding 3, unknown 33, event-assignment conflict 0, cluster expansion 0, merge expansion 0, true multi-speaker 0, automatically resolved 0.

## 63. Event Association Conflict

Event-assignment-conflict overlap count is 0. This does not erase the 8 post-hoc association-loss candidates; it means no rendered overlap pair was assigned that root cause.

## 64. Cluster Expansion

Cluster-expansion overlap count is 0, consistent with representative rather than union intervals.

## 65. Merge Expansion

Merge-expansion overlap count is 0, consistent with zero synthetic merges.

## 66. Ambiguous Timebase Overlap

Ambiguous-timebase accounts for 20 of 56 assembly-level overlap pairs. These remain review-required and are not “fixed” by guessed offsets.

## 67. True Multi-speaker

True multi-speaker count is 0 only because no speaker evidence was available for this blind replay. The report does not relabel unknown pairs as single-speaker.

## 68. MFA

MFA was unavailable and not executed: requests 0, model loads 0, candidates 0, applied changes 0.

## 69. CTC

CTC was unavailable and not executed: requests 0, model loads 0, candidates 0, applied changes 0.

## 70. Speaker

Speaker analysis was unavailable and not executed: requests/components 0, model loads 0, applied changes 0.

## 71. Separation

Source separation was not executed and applied zero text, timing, speaker, or overlap changes.

## 72. Ablation V0

V0 C6.0.1.2 baseline: 156 cues, normalized CER 0.6201171875, coverage 0.9462890625, missing 9, hallucination 2, material 74, severe timing 53, overlap 49. Freeze hash: cc7b240fd19f88b3643f2f34ba7c2cd3b9309ffbf9db33042651f0c4e35ee1ef.

## 73. Ablation V1

V1 association-observe is output-identical to V0 across text, timing, presentation, and all quality metrics. Freeze hash: 5c22b427dbdb45a7e49b1d8c7b791394239c113b18ae2120a9727e7746e68092.

## 74. Ablation V2

V2 Event Association produces 161 cues, normalized CER 0.6015625, coverage 0.96484375, missing 6, hallucination 1, material 76, severe timing 53, overlap 48, start MAE 1.6315951789222625 s, and end MAE 1.6488576592810873 s. Freeze hash: efa9f4feffe04c14f76ab0449a5de783383c674e1e845bf57628c400dc01426c.

## 75. Ablation V3

V3 Canonical Assembly is quality-identical to V2 and makes zero assembly text/timing mutations. Freeze hash: b6d94b65fc4a95f6c7d65055efb477e2cd457b67ad1510940f3210dcb79416e7.

## 76. Ablation V4

V4 Timeline Transform Recovery is quality-identical to V2/V3. It adds 117 explicit transform records, while refusing 35 unproven VAD mappings. Freeze hash: e1293fd9e21b5bb131d4e3230d3f3bf0e019e054633b8c52625a98500fd88efc.

## 77. Ablation V5

V5 Early Timing and Non-degradation Gates is quality-identical to V2–V4 and records safe rejection/retention evidence. Freeze hash: af3c8d70249e442270bf64fa42ef0d632619c74efd059b78d0f32b94cb2e360c.

## 78. Ablation V6

V6 Targeted Providers was not run because MFA, CTC, speaker, and separation evidence was unavailable. Status is not-run; it reuses no fabricated provider result.

## 79. Full Candidate

The full candidate equals the V2 quality metrics and carries all C6.0.1.3 artifacts. Freeze hash: fc59e8a2b62411342cc16b8f91a78169bf1435ac7b7dd8f3f79d0546cb8fe0ee. Engineering quality gates remain fail-closed.

## 80. Selection Policy

Policy version is c6.0.1.3-candidate-association-canonical-assembly-v1 and semantic hash is 18f526373aab51b44f02a404eae27f3a7cb46d93cc082d9f0a05a955980c3dbc. It requires coverage/recall, precision, timing, overlap, token, Gold-isolation, replay, and safety gates rather than selecting on CER alone.

## 81. Final A

Final A completed offline with 117/117 frozen cache hits, 0 ASR inference requests, 0 model loads, and 0 worker starts. Runtime is whisper-cli 1.9.1 with ggml-large-v3 snapshot 64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2 on Apple M1 Pro / Metal. It produced 161 evaluated final cues and REVIEW_REQUIRED.

## 82. Final B

Final B independently replayed the same 117/117 cache entries with 0 inference, 0 model loads, 0 worker starts, and REVIEW_REQUIRED. It reproduces Final A's semantic artifacts and rendered output.

## 83. A/B Reproducibility

FinalABSemanticParity = true. Exact A/B hashes match: association 3fca2f78535a669231ffc40aed8f364dcf17d770426e153708a66a8be1c004f2; events 6b141291f3b5bdacf7fe9cdb2eb981793cd755217e4f68d08d0901654cec6858; assembly 3a0feb0e593eba1d4160098c2a200df47810a40c1e0f4de60b6ba987b4fa2a45; timeline d8beb63be4e0d70bf6b84a410bdf62a72876e8ad061448323fe661b449d759b7; text/canonical cue 2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9; timing fdcac6c8f48825dfa39ebaa6878963253f834dfbf8b324c05487ef2d2498d9ea; presentation e77a969ca322d1717e209c52b80f4b1b57b5aa31f5e8ccccf329df165717c359.

## 84. Exact CER

Baseline 0.6771653543307087; Final A/B 0.6601049868766404; improvement -0.0170603674540683. Raw remains better at 0.5831146106736658.

## 85. Normalized CER

Baseline 0.6201171875; Final 0.6015625; improvement -0.0185546875. The final still fails the required <= 0.55 gate and remains worse than raw 0.5166015625.

## 86. Coverage

Baseline 0.9462890625; Final 0.96484375; improvement +0.0185546875. The coverage safety guard passes.

## 87. Missing Dialogue

Baseline 9; Final 6; improvement -3. The missing-dialogue gate passes, but Final remains one worse than Raw ASR's 5.

## 88. Hallucination

Baseline 2; Final 1; improvement -1. The hallucination gate passes.

## 89. Material Text Errors

Baseline 74; Final 76; regression +2. The precision gate fails, so the aggregate recall/CER gain is not sufficient for release.

## 90. Severe Timing

Baseline 53; Final 53; unchanged and above the <= 30 target. Timing recovery fails.

## 91. Start MAE

Baseline 1.764667572474024 s; Final 1.6315951789222625 s; improvement -0.1330723935517615 s, but still above the <= 1.2 s gate.

## 92. End MAE

Baseline 1.894287250610067 s; Final 1.6488576592810873 s; improvement -0.2454295913289797 s, but still above the <= 1.2 s gate.

## 93. P95

Baseline 6.760999999999967 s; Final 6.439999999999998 s; improvement -0.3209999999999686 s, but still above the <= 3.5 s gate.

## 94. IoU

Baseline median temporal IoU 0.5699999999999932; Final 0.5800000000000054; improvement +0.0100000000000122. Raw remains substantially better at 0.6761133603238165.

## 95. Overlap

The final rendered gate count improves 49→48 but fails the <= 20 target. Assembly root-cause scope contains 56 pairs, while the isolated evaluator also reports 37 machine overlaps versus 9 Gold overlaps under a different matching definition; these scopes are not substituted for one another.

## 96. Candidate Drop Metrics

Input 365, atomic clusters 199, grouped/non-winners 166, explicit dispositions 166, silent/unaccounted 0, unknown reason 0, multiple assignment 0. Gold post hoc finds 12 harmful losses and 154 with no observed Gold-supported loss.

## 97. Supported Retention

Strong-supported candidates 49; all 199 event outputs are retained; minimum retention ratio 1.0; unsupported strong-text deletion 0.

## 98. Trusted Token Metrics

Baseline trusted mapped tokens 235; Final 235. Request-mappable tokens are 414, comprising 235 trusted and 179 association-pending; the trusted-token growth target therefore fails.

## 99. Ambiguous Timebase Metrics

Baseline ambiguous tokens 373; Final 373. Quarantined transforms 35 and unverified offsets applied 0. The ambiguity-reduction target fails.

## 100. Shadow Outcome

Final A and B both report REVIEW_REQUIRED. The production artifact has 161 cues, 22 blockers, 122 review items, 18 unresolved overlap components, and zero unsafe mutations; review delivery is not claimed for this blind quality run.

## 101. Unsafe Escape

Unsafe finalization escape count is 0. No failed or unknown gate was converted to FINAL_CANDIDATE, and production finalizationMethod remains none.

## 102. Production Release Gate

Release remains closed. Coverage, missing, hallucination, unsupported-deletion, unknown-drop, runtime non-degradation, A/B parity, Gold isolation, cache-only, hardcoding, and safety gates pass. Material errors, severe timing, normalized CER, start/end MAE, P95, overlap, trusted-token growth, and ambiguous-token reduction fail.

## 103. C6.0.1 Regression

C6.0.1 blind-acceptance regressions pass. Runtime Gold input remains 0 and fail-closed REVIEW_REQUIRED behavior is preserved.

## 104. C6.0.1.1 Regression

C6.0.1.1 machine-quality recovery regressions pass. The C6.0.1.3 path does not weaken the prior Gold isolation or release boundary.

## 105. C6.0.1.2 Regression

C6.0.1.2 candidate precision/timeline tests and replay pass. Observe mode is non-mutating, and baseline hashes/metrics are preserved.

## 106. C6 Protected Regression

Protected-finalization tests pass. Machine association confidence is not treated as authority to overwrite protected human text/timing.

## 107. C5.19 Regression

C5.19 series-memory regressions pass. The run uses empty machine memory and no human terminology/correction memory.

## 108. Tests

Node v24/npm v11 validation passed: typecheck, lint, Prettier check, build, full unit suite 74 files with 610 passed and 2 skipped, E2E 16 files with 35 passed and 1 skipped, and targeted C5.19/C6 Investigation/Protected/C6.0.1/.1/.2/.3 suite 43 files with 125/125 passed.

## 109. Schemas

Schema generation passed with 189 generated JSON Schemas. C6.0.1.3 adds 13 strict schemas, rejects unknown fields, and validates every official generation and acceptance artifact.

## 110. Skill Validation

multilingual-video-subtitler quick validation passed: Skill is valid! The skill's source-preservation, offline evidence, artifact-validation, and fail-closed constraints directly shaped the implementation.

## 111. Skill 2

multilingual-grammar-report-generator was not modified. No Skill 2 path appears in the branch diff.

## 112. Skill 3

multilingual-grammar-learning-site-builder was not modified. No Skill 3 path appears in the branch diff.

## 113. Gold Isolation

Runtime Gold input count is 0, and unseen Gold access count is 0. Gold was opened only after V0–V6/Final freezes by the isolated evaluator; machine-stage trace, association, assembly, and policy selection contain no Gold text or timing.

## 114. Dataset Hardcoding Audit

Production dataset-hardcoding findings are 0. The audit scans runtime roots for the development title, Gold identity/text/timing markers, and human-derived shortcuts and fails closed on a match.

## 115. Network

Network policy was off and network used is false. Online subtitle search and cloud inference were not used; all 117 ASR requests were exact local cache hits.

## 116. Source Read-only

Source size is 847774958 bytes. SHA-256 before and after is 294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43; sourceReadOnlyVerified = true.

## 117. Gold Read-only

Gold size is 17094 bytes, cue count 192, and SHA-256 before/after is a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e. Timestamp normalization count is 1 in evaluation only; Gold mutation count is 0 and read-only verification passed.

## 118. Shareable

Shareable audit passed for the acceptance summary: absolute-path leak 0, secret 0, Gold-text leak 0, raw-private-audio 0, and broken relative reference 0.

## 119. Quality Milestone

Engineering milestone passed: candidate conservation, deterministic event-first association, real-candidate assembly, explicit transform quarantine, non-degradation evidence, and reproducible A/B output. Subtitle-quality milestone did not pass because material precision and timing gates remain open.

## 120. C6.0.2 Readiness

Decision: HOLD, not GO. Do not start unseen Gold validation until material errors, severe timing, MAEs/P95, overlap count, trusted-token growth, and ambiguous-timebase reduction meet the policy without harming recall or hallucination.

## 121. Remaining Risks

Remaining blockers are material errors 76, severe timing 53, normalized CER 0.6015625, start/end MAE 1.6316/1.6489 s, P95 6.44 s, rendered overlaps 48, 373 ambiguous tokens, 35 quarantined transforms, only 8/149 timing-eligible cues, 28 ambiguous candidates including 8 post-hoc association losses, and unavailable provider evidence.

## 122. Commits

Core implementation: f8a9283 (association/events/assembly/transform/non-degradation); tests: 8468a75; blind validation integration: f1ff74c; event-boundary guard: 7978fc5; evaluated-trace integrity: e2beff2; observe non-mutation: 7d16618; Gold timestamp evaluation normalization: 758865b; trusted vs association-pending token semantics: 630c9bd; shareable summary: 854a736; quality-gate cleanup: 1e51f2d. The acceptance SHA is the commit containing this report and is reported after push to avoid a self-referential hash.

## 123. Remote HEAD

Acceptance requires local HEAD, origin/codex/c6-0-1-3-candidate-association-canonical-assembly, and a clean worktree to agree. The exact pushed SHA is supplied in the delivery response.

## 124. Output Paths

Official generation outputs:

- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-baseline-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-association-observe-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-event-association-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-canonical-assembly-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-timebase-recovery-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-full-candidate-final-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-final-a-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-final-b-20260828

Official evaluation outputs:

- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-baseline-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-association-observe-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-event-association-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-canonical-assembly-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-timebase-recovery-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-full-candidate-final-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-final-a-evaluation-20260828
- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-final-b-evaluation-20260828

Official validation directory:

- /Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-3-validation-20260828

## Required Questions Q1-Q10

### Q1. Why did the 166 candidate-to-cluster candidates disappear?

They did not disappear silently. They are 136 explicit duplicates, 28 ambiguous alternatives, and 2 rejected hallucination-risk candidates, while 199 representatives were assigned. All 365 ledger records are conserved exactly once.

### Q2. How many were supported but wrongly dropped, unsupported/correctly grouped, and ambiguous?

Gold post hoc identifies 12 harmful non-winners: 8 association losses and 4 text-variant losses. It finds no Gold-supported loss for the other 154. Runtime ambiguity is a separate overlapping axis: 28 are ambiguous, of which 8 are association losses and 20 show no Gold loss. A disjoint three-way supported/unsupported/ambiguous partition would therefore be misleading.

### Q3. Did event-first association significantly reduce incorrect filtering?

It eliminated silent/unknown drops and recovered aggregate recall: coverage 0.9462890625→0.96484375, missing 9→6, hallucination 2→1, and normalized CER 0.6201171875→0.6015625. It did not fully solve incorrect filtering: 8 association losses remain and material errors worsen 74→76. The answer is engineering yes, quality only partial.

### Q4. Why did Raw ASR normalized CER 0.5166 worsen to roughly 0.62?

The legacy downstream path changed a stronger raw candidate universe into fewer canonical cues through grouping, winner selection, deduplication, fragment repair, segmentation, and integrity handling without enough localized evidence. C6.0.1.3 proves 12 harmful non-winner choices post hoc and preserves all new assembly operations, but historical artifact granularity cannot honestly assign the entire CER gap to one internal legacy operation.

### Q5. Where is the first significant text regression?

The first measurable historical regression is Raw ASR→V0 Final. A narrower old internal stage is not recoverable from persisted Gold-isolated snapshots. Within C6.0.1.3, V2 Event Association is the first output change; it improves CER/coverage but raises material errors by 2.

### Q6. Where did severe timing first rise from 37 to 53?

It is already present at Raw ASR→V0 Final and cannot be localized more narrowly with the old artifacts. No C6.0.1.3 stage increases 53 further.

### Q7. What is the main source of ambiguous timebase?

VAD-derived decoder-local token times without a persisted VAD sample-to-parent remapping. This accounts for 35 quarantined requests and 373 ambiguous tokens.

### Q8. How many trusted global tokens did the complete transform chain recover?

It verified the existing 235 trusted tokens and identified 179 additional request-contained tokens as association-pending, but recovered 0 new trusted mappings because the VAD remap is not proven. Trusted remains 235; ambiguous remains 373.

### Q9. How many bad operations did the canonical non-degradation gate stop?

At C6.0.1.3 assembly, no destructive proposal was attempted, so deletion, merge, truncation, and time-expansion rejections are all 0 and all 199 real winners are retained. The inherited early timing gate separately rejected 2 of 8 proposals, with 1 expansion-rejection counter. The report does not inflate prevented-operation counts from mere absence of mutation.

### Q10. Is the result ready for C6.0.2 unseen validation?

No. Recall is high and improves, but precision and timing remain unacceptable: material errors 76, severe timing 53, normalized CER 0.6015625, MAEs above 1.2 s, P95 6.44 s, and overlap 48. The correct decision is HOLD_FOR_MORE_ASSOCIATION_ASSEMBLY_RECOVERY.
