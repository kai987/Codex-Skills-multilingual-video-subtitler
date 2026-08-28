# C6.0.1.4 VAD Global Timebase, Acoustic Text Variant Verification & Ambiguous Event Targeted Re-ASR

Date: 2026-08-28  
Policy: `c6.0.1.4-vad-timebase-acoustic-text-variant-reasr-v1`  
Policy file SHA-256: `883e12b4c50767f498650fe997a1f62fe2d4c030f982fbbc75ca4ae686c633d7`  
Policy semantic hash: `23231d406ebcac177401d68f3a66dc1790f9fe74698d51f280b27cccdc9ce2be`

This report separates engineering acceptance from subtitle-quality acceptance. Carnation episode 1 is a known development set. Runtime generation read no Gold and froze independent A/B outputs before the read-only Gold evaluator ran. All paths below describe real local artifacts; no network or cloud inference was used.

## 1. Executive Conclusion

C6.0.1.4 engineering acceptance passed. Sample-accurate VAD lineage, request timeline v2, global token mapping v2, the Gold-isolated Oracle, CTC acoustic verification, bounded targeted re-ASR, immutable A/B freeze, reproducibility, schemas, and regressions all passed. VAD timebase and token-timeline recovery passed, but selector, pool, text precision, and timing recovery did not. The release decision is `HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY`; production remains `needs-review`, `finalizationMethod = none`, and `machineOnlyReleaseAuthorized = false`.

## 2. Branch

Branch: `codex/c6-0-1-4-vad-timebase-text-variant-reasr`. Base: `7bcad5e7a5655366f57f69568cdbd11b419efcd3` from `codex/c6-0-1-3-candidate-association-canonical-assembly`.

## 3. Baseline

The machine baseline is `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-baseline-20260828`; its isolated evaluation is `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-baseline-evaluation-20260828`. Source size stayed `847774958` bytes and SHA-256 stayed `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`.

## 4. Development-set Status

This is a known development episode with a 192-cue human-reviewed Gold subtitle. It is suitable for diagnosis and gate calibration, but it is not evidence of unseen-series generalization.

## 5. Goals

The goals were to recover provable VAD-derived global time, diagnose candidate-pool limits after freeze, acoustically compare real machine variants, re-ASR only machine-detected ambiguous events, and preserve fail-closed finalization.

## 6. Non-goals

The run did not expand global recall, rerun full-episode MFA/speaker/separation, change the Whisper decoding algorithm, add overlap trimming rules, use candidate text as a prompt, use Gold at runtime, loosen safety gates, modify Skill 2/3, or authorize machine-only release.

## 7. C6.0.1.3 Replay

V0 replay passed and reproduced the C6.0.1.3 final: 161 cues, normalized CER `0.6015625`, coverage `0.96484375`, missing 6, hallucination 1, material errors 76, severe timing errors 53, and overlap 48.

## 8. Raw ASR Baseline

Raw ASR had 169 cues, exact CER `0.5831146106736658`, normalized CER `0.5166015625`, coverage `0.97216796875`, missing 5, hallucination 2, material errors 63, severe timing errors 37, start MAE `1.3203134328358284 s`, end MAE `1.3926641791044845 s`, P95 `6.470000000000027 s`, and median IoU `0.6761133603238165`.

## 9. Final Baseline

The frozen pre-C6.0.1.4 final had 161 cues, exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, missing 6, hallucination 1, material errors 76, severe timing errors 53, start MAE `1.6315951789222625 s`, end MAE `1.6488576592810873 s`, P95 `6.439999999999998 s`, median IoU `0.5800000000000054`, and overlap 48.

## 10. Remaining Root Causes

The remaining quality loss is dominated by raw ASR text defects and association defects, not silent candidate loss. The old timeline also had 35 quarantined VAD requests and 373 ambiguous-time-base tokens; those timeline defects are fixed in this iteration, while text and timing quality remain unchanged.

## 11. VAD Architecture Audit

The patched whisper.cpp v1.9.3 runtime exposes mapped token and raw VAD boundaries while creating a fresh Whisper state for each MVL request. Patch SHA-256 is `9ae5969381786395c6219d360344eeff0be0ab6083c8c359e32b29b3a586fc97`; verification proved the pinned source, repeat-application rejection, and wrong-commit rejection without changing decoding or VAD algorithms.

## 12. Existing VAD Timebase Failure

The legacy artifact knew decoder-local time but did not persist the VAD child-to-parent sample mapping. C6.0.1.3 correctly quarantined all 35 such requests rather than computing `requestStart + localTokenTime` from an unproved coordinate system.

## 13. Fresh Sample Mapping

Fresh source-global extraction rebuilt all 35 VAD request lineages. The resulting artifact contains 174 VAD segments, 209 parent/child transforms, 35 fresh request records, mapping coverage `1`, and guessed offset count `0`.

## 14. VAD Segment Identity

Every segment records source/media hash, request and parent identity, parent/output sample rates and counts, provider and normalized VAD boundaries, global source samples, extraction and resampling identities, provider coordinate system, mapping reasons, and a semantic hash. Twelve bounded provider frame overruns were explicitly normalized within the frozen 800-sample tolerance; none was guessed.

## 15. Parent/Child Sample Transform

Transforms use integer sample endpoints and rational conversion metadata. The canonical source is 16 kHz with `14400160` samples; each transform records child start/end samples, child count, rounding policy, FFmpeg metadata, verification reasons, and artifact hashes.

## 16. Nested Recovery Transform

The chain is source media → extracted request → VAD segment/recovery window → decoder-local sample → source-global sample. Parent transform hashes are carried into every mapped token, so a nested result cannot be trusted without the complete chain.

## 17. FFmpeg Seek Audit

All 35 fresh VAD extraction entries record input seek placement, exact start/end sample, duration, `atrim`, `asetpts`, resampling, padding, WAV sample count, command identity, audio SHA-256, and cache status. Source extraction was read-only and guessed offsets were zero.

## 18. Resampling Audit

The source and output rate are 16 kHz. The transform still persists numerator/denominator `16000/16000`, `identity-integer` rounding, one resampling identity, actual WAV sample counts, and zero padding instead of silently assuming scale 1.

## 19. Request Timeline V2

`asr-request-timeline-contract-v2.json` contains 117 requests: 117 verified, 0 quarantined, 0 ambiguous, 0 unavailable, and 35 fresh VAD requests. Token time bases are 82 `original-audio-local` and 35 `mapped-original-audio-local`; prompts and guessed offsets are both zero.

## 20. Token Mapping V2

The v2 timeline maps integer decoder-local samples through verified request transforms to source-global samples and converts to seconds only at the edge. It contains 1,914 observations: 694 `TRUSTED`, 166 `ASSOCIATION_PENDING`, 575 `UNTRUSTED`, and 479 `UNMAPPED`.

## 21. Trusted Tokens Before

Baseline trusted mapped tokens: 235.

## 22. Trusted Tokens After

Final trusted mapped tokens: 694, an increase of 459. The new artifact reports 694 fresh-recovered trusted tokens and does not relabel pending or invalid observations merely to reach the milestone.

## 23. Ambiguous Tokens Before

Baseline ambiguous-time-base tokens: 373.

## 24. Ambiguous Tokens After

Final ambiguous-time-base tokens: 0. This is a fresh-evidence timeline rather than a one-to-one mutation of legacy token objects; all 373 legacy ambiguous cases are eliminated as a category, while unrelated failures remain fail-closed.

## 25. Quarantined Requests Before

Baseline quarantined VAD requests: 35 of 117.

## 26. Quarantined Requests After

Final request timeline: 117 verified and 0 quarantined. VAD request recovery is 35/35, sample-mapping coverage is 1, and stale-lineage/guessed-offset counts are zero.

## 27. Candidate Oracle Design

The Oracle evaluates all real machine variants for each reliably aligned multi-variant event only after machine output freeze. It measures current selected distance, best-existing distance, regret, and a fail-closed class without changing runtime decisions.

## 28. Oracle Gold Isolation

The Gold SHA-256 is `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`. It was read only after the A/B barrier; `runtimeGoldInputCount = 0`, Gold text was not persisted to shareable artifacts, and output hashes stayed frozen.

## 29. Evaluable Oracle Events

Of 19 multi-variant events, 10 were evaluable and 9 were `ASSOCIATION_AMBIGUOUS`/unevaluable. The evaluator did not force an Event↔Gold match.

## 30. Selector Errors

Existing-pool Oracle found 2 selector errors: `canonical-event-0045` and `canonical-event-0054`.

## 31. Pool Insufficient Events

Existing-pool Oracle found 5 pool-insufficient events. Material-error attribution maps 4 final material defects to `POOL_INSUFFICIENT`; the counts use different denominators and therefore must not be conflated.

## 32. Selected Already Oracle

Selected-already-Oracle count: 3.

## 33. Oracle Gap

Across 10 evaluable events, selected mean normalized distance is `0.6939937839937839`; best-existing mean distance is `0.48414529914529914`. The theoretical existing-pool gain is `0.20984848484848487`.

## 34. Selector Regret

Total selector regret is `2.0984848484848486`, or `0.20984848484848487` per evaluable event. It is diagnostic only and was not used to tune runtime thresholds.

## 35. Multi-variant Event Count

Final event inventory: 199 events, 19 multi-variant and 180 single-variant.

## 36. Acoustic Verification Architecture

The verifier performs pronunciation projection, hard validity checks, pairwise CTC evidence, length/prefix guards, window-edge checks, and dominance relations. Resolver stages then consider independent support, trusted-token conflict, decoder evidence, and a final restricted orthographic tie-break; no magic aggregate score is used.

## 37. CTC Runtime

Runtime identity is `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`; model snapshot is `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`; device is CPU. The first V3/V5 evidence generation performed 42 + 18 CTC inferences; independent final A/B each replayed 111/111 cache hits with 0 inference and 0 model loads.

## 38. Pronunciation Projection

SudachiPy runtime identity is `6cfaef2f1d68e74fe4a595feb9dc80ef7db94fea2152ce673ae9c19da5e5376b`. There are 63 Sudachi-reading projections and 5 display-text fallbacks; human-derived pronunciation entries and canonical text mutation are zero.

## 39. Scorable Variants

CTC-scorable variant count: 67.

## 40. Unscorable Variants

CTC-unscorable variant count: 0; projection-failure count is also 0.

## 41. Length Bias Audit

Length-bias audit passed. Short candidates cannot win solely because they contain fewer units or occupy a small aligned span.

## 42. Prefix Bias Audit

Prefix-bias audit passed. Pairwise evidence records 11 edge-pinned variants and blocks prefix/suffix shortcuts from becoming a clear winner.

## 43. Acoustic Dominance

One multi-variant event reached a clear winner through pairwise CTC acoustic dominance. Across all pair relations there were 13 strong-dominance, 18 weak-dominance, and 185 incomparable relations; only event-level decisive evidence may select.

## 44. Independent Evidence

Twenty-one decisions had maximum independent-support count greater than one. This evidence is supportive, but it did not break the two post-hoc selector-error cases because their independent families tied or remained correlated.

## 45. Correlated Evidence

Windows from one request family are not treated as independent votes. Request-family lineage and stability are persisted so repeated/overlapping windows cannot manufacture consensus.

## 46. Trusted Token Support

Fifty-six decisions had non-zero trusted-token support. Trusted tokens materially improved timebase sidecar coverage, but both known selector-error events had zero token support for all competing variants.

## 47. Decoder Evidence

Decoder selection and hallucination evidence remains an explanatory fallback, not an acoustic override. In both known selector-error events the inherited decoder score favored the wrong current representative, demonstrating why it cannot be the sole selector.

## 48. Window Edge

Edge-pinned count is 11. These variants remain ambiguous rather than being promoted by deceptively low partial-window CTC cost.

## 49. Linguistic Tie-break

The linguistic tie-break ran once, only after acoustic equivalence, for an orthographic-only same-reading ambiguity. It did not override an acoustic conflict.

## 50. Variant Decision Policy

The policy produced 199 explainable decisions, zero forced winners, zero magic weighted scores, zero hard-invalid selections, and explicit reasons for every ambiguous event.

## 51. Clear Winners

Clear winner count: 182, comprising 180 preserved single-real-variant events and 2 resolved multi-variant events.

## 52. Ambiguous Winners

Ambiguous variant count: 17. These are unresolved decisions, not hidden winners.

## 53. Existing Variant Replacements

Existing variant replacement count: 0. Acoustic evidence did not meet the complete replacement contract.

## 54. Replacement Safety

Proposed, accepted, rejected, free-rewrite, weak-evidence replacement, canonical text mutation, canonical timing mutation, and presentation mutation counts are all 0.

## 55. Pool Sufficiency Runtime Proxy

The machine-only proxy reports sufficient 1, ambiguous 18, insufficient 0, and unknown 180. It is intentionally conservative and is not the Gold Oracle.

## 56. Re-ASR Trigger Policy

Only machine-detected ambiguous multi-variant events with pool ambiguity are eligible. There were 17 eligible and 12 triggered events; single-variant and already-clear events were not indiscriminately rerun.

## 57. Re-ASR Budget

The frozen budget is at most 3 requests per event and 36 per episode. Exactly 36 requests were used, and 5 eligible events were not triggered after the episode budget was exhausted.

## 58. Source-global Extraction

Each targeted request records an exact source-global sample interval, 16 kHz output count, audio SHA-256, cache identity, lineage, and window type. It never derives a window from Gold timing.

## 59. Prompt Isolation

Prompt isolation passed: prompt-present count 0, candidate-text prompt leaks 0, human-memory leaks 0, Gold runtime inputs 0, and network use false.

## 60. Verification Windows

Each triggered event uses bounded `exact`, `small-context`, and `expanded-context` source-global windows, subject to the three-request limit.

## 61. Verification Correlation

All three windows share a request-family identity. Stability is based on normalized outputs across that family rather than counting every window as an independent vote.

## 62. Re-ASR Requests

Final request count: 36. The first V5 generation executed 36 real inferences; final A/B independently replayed 36/36 cache hits with 0 inference and 0 model loads.

## 63. Re-ASR Stability

Stable-result events: 7; unstable-result events: 5.

## 64. New Candidates

Targeted re-ASR produced 25 new machine candidates with complete request and token lineage.

## 65. New Candidates Selected

Selected new candidate count: 0. No new text cleared the full acoustic and safety contract.

## 66. Unresolved After Re-ASR

Unresolved after re-ASR: 12 triggered events. The system retained the prior canonical text and required review.

## 67. Re-ASR Gold Post-hoc Attribution

After freeze, Gold attribution found improved pool 2, no change 4, worsened 0, created hallucination 0, and unevaluable 6. The improvement is diagnostic; it did not retroactively mutate runtime output.

## 68. Timing Replacement

The replacement contract proposed no timing changes. Fresh token evidence was persisted, but no cue passed the complete conservative text/timing replacement path.

## 69. Timing Eligible Cues

Trusted cue count is 69 and timing-eligible cue count is 59, up from baseline 16 and 8 respectively.

## 70. Timing Mutation

Canonical timing mutations: 0. Presentation timing mutations: 0.

## 71. Overlap Effect

Rendered overlap stayed 48. No overlap trim or unsupported boundary clipping was introduced.

## 72. MFA Usage

MFA request count: 0. No event met the frozen text-stable timing-only eligibility rule.

## 73. Speaker Usage

Speaker request count: 0. C6.0.1.4 did not rerun pyannote or use speaker evidence to force a text decision.

## 74. Separation Usage

Separation request count: 0. No genuinely eligible multi-speaker resolution request was authorized.

## 75. Ablation V0

V0 reproduced the 161-cue baseline, trusted 235, ambiguous 373, and all baseline quality metrics.

## 76. Ablation V1

V1 recovered trusted tokens to 694 and ambiguous timebase to 0 while quality metrics stayed exactly unchanged. The official successful V1 is a 35/35 cache replay of earlier real source-global generation; it is not mislabeled as a fresh inference run.

## 77. Ablation V2

V2 is the post-freeze Gold-only Oracle and has no runtime quality metrics by design. It evaluated 19 multi-variant events without changing any frozen output.

## 78. Ablation V3

V3 observe mode executed real CTC verification during the first evidence generation (43 requests, 42 inference, 1 cache hit). The rematerialized official artifact preserves its semantics and shows the same 161-cue quality.

## 79. Ablation V4

V4 enforced the resolver with 43/43 CTC cache hits. It resolved no unsafe replacement and preserved the baseline output.

## 80. Ablation V5

V5 extended acoustic verification to 111 requests (18 additional CTC inferences in first generation) and executed 36/36 targeted re-ASR requests. Twenty-five candidates were added, zero selected, and quality remained unchanged.

## 81. Ablation V6

V6 enabled trusted-token timing eligibility but accepted no timing mutation. It preserved 694 trusted tokens, 0 ambiguous timebase tokens, and baseline subtitle metrics.

## 82. Ablation V7

V7 evaluated bounded MFA/speaker/separation eligibility; all provider request counts stayed 0 and the subtitle remained unchanged.

## 83. Full Candidate

The full candidate combines all C6.0.1.4 enforce modes. It has 161 cues, trusted 694, ambiguous 0, canonical mutation 0, and the baseline text/timing quality metrics.

## 84. Selection Policy

Policy modes are VAD enforce, variant enforce, and targeted re-ASR enforce. Safety thresholds are unchanged: coverage ≥ 0.90, missing ≤ 15, hallucination ≤ 2, material ≤ 45, severe timing ≤ 30, normalized CER ≤ 0.55, MAEs ≤ 1.2 s, P95 ≤ 3.5 s, overlap ≤ 20, trusted ≥ 500, and ambiguous ≤ 100.

## 85. Final A

Final A is `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-final-a-20260828`; freeze hash `0c0882aa31b842a3e063431014ea086f38f19cef46903aa9a06d3ba740a294e1`; input hash `c0224cebc3231052b8ed8511076e143f5bd49f837c8bf1e34fa850c2c6e95aa4`.

## 86. Final B

Final B is `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-final-b-20260828`; freeze hash `14bf673305fcacd7dc5fc3ad206e4b65eaa1d857ab1ee6c2c82e3127f5938fee`; input hash `e77f76c406a15e1e9c858e45a4e0fb95626906794b9a7333a5ee764a747343b8`.

## 87. A/B Reproducibility

Text, events, variant decisions, re-ASR triggers, VAD timebase, and shadow outcome parity are all true. Canonical text hash is `2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9`, timing hash `fdcac6c8f48825dfa39ebaa6878963253f834dfbf8b324c05487ef2d2498d9ea`, presentation hash `e77a969ca322d1717e209c52b80f4b1b57b5aa31f5e8ccccf329df165717c359`, and ASS/SRT/VTT hashes are identical. A/B used distinct output directories, distinct caches, and distinct empty memory stores; both cache inventories have content hash `0b698c4829963b66c794747870fd28e5f7c91a060bef74c02a3d7ce5e262366c`.

## 88. Exact CER

Raw `0.5831146106736658`; baseline final and C6.0.1.4 final `0.6601049868766404`.

## 89. Normalized CER

Raw `0.5166015625`; baseline final and C6.0.1.4 final `0.6015625`. The `≤ 0.55` gate failed.

## 90. Coverage

Raw `0.97216796875`; baseline final and candidate `0.96484375`. Coverage gate passed.

## 91. Missing

Raw 5; baseline final and candidate 6. Missing gate passed.

## 92. Hallucination

Raw 2; baseline final and candidate 1. Hallucination gate passed and re-ASR created no post-hoc hallucination.

## 93. Material Errors

Raw 63; baseline final and candidate 76. The `≤ 45` gate failed.

## 94. Severe Timing

Raw 37; baseline final and candidate 53. The `≤ 30` gate failed.

## 95. Start MAE

Raw `1.3203134328358284 s`; baseline final and candidate `1.6315951789222625 s`. The `≤ 1.2 s` gate failed.

## 96. End MAE

Raw `1.3926641791044845 s`; baseline final and candidate `1.6488576592810873 s`. The `≤ 1.2 s` gate failed.

## 97. P95

Raw `6.470000000000027 s`; baseline final and candidate `6.439999999999998 s`. The `≤ 3.5 s` gate failed.

## 98. IoU

Raw median temporal IoU `0.6761133603238165`; baseline final and candidate `0.5800000000000054`.

## 99. Overlap

Baseline final and candidate rendered overlap pair count: 48. The `≤ 20` gate failed.

## 100. Raw→Final Gap

The final remains worse than raw by `0.0849609375` normalized CER, 13 material errors, 16 severe timing errors, `0.3112817460864341 s` start MAE, and `0.2561934801766028 s` end MAE. C6.0.1.4 did not conceal this regression behind improved sidecar evidence.

## 101. Material Error Attribution

Of 76 final material errors: `RAW_ASR_ORIGIN` 50, `SELECTOR_ERROR` 2, `POOL_INSUFFICIENT` 4, `ASSOCIATION_ERROR` 19, `ORTHOGRAPHIC_AMBIGUITY` 0, `HALLUCINATION` 0, and `UNKNOWN` 1.

## 102. Timing Error Attribution

The evaluator records 53 severe boundary-threshold violations. No categorical post-hoc timing-attribution artifact was fabricated; the hard facts are timing mutation 0, unchanged MAE/P95/IoU/overlap, 59 eligible cues, 86 token monotonicity failures, 16 containment failures, and 142 missing-local-time observations.

## 103. Candidate Oracle vs Selected

The existing-pool Oracle improves mean normalized event distance from `0.6939937839937839` to `0.48414529914529914` on 10 evaluable events, but only 2 are selector errors; 5 are pool-insufficient and 9 of 19 total events are association-ambiguous.

## 104. Oracle vs Re-ASR Pool

With targeted re-ASR candidates, Oracle normalized error falls further to `0.44995726495726485`, with theoretical gain `0.24403651903651907`. Two events gain a better candidate, but runtime safely selects none.

## 105. Production Status

Production status is `needs-review`; `finalizationMethod = none`; machine release is not authorized.

## 106. Shadow Outcome

Final A/B shadow outcome is `REVIEW_REQUIRED`, with reason codes `UNKNOWN_SIGNAL_FAIL_CLOSED`, `CURRENT_OUTPUT_DEFECT_EVIDENCE_REQUIRES_REVIEW`, and `CRITICAL_MACHINE_EVIDENCE_INCOMPLETE`.

## 107. Unsafe Escape

Unsafe finalization escape count: 0. Failed quality gates cannot be overridden by the engineering pass.

## 108. Gold Runtime Isolation

Runtime Gold input count is 0 in manifests, re-ASR, audits, and validation. The dual-freeze barrier semantic hash is `d2120e21e804f22ebf5f371a88015795355bcd581bf5b7b0170dd8674844fa02`.

## 109. Dataset Hardcoding Audit

Production TypeScript hardcoding findings: 0. Gold hashes, cue text, event IDs, and target metrics are not embedded in selector/re-ASR runtime code.

## 110. Network

Network used: false for VAD, CTC, re-ASR, Oracle runtime isolation, and final A/B generation.

## 111. Source Read-only

Source before/after size and SHA-256 are identical; `sourceReadOnlyVerified = true`.

## 112. Gold Read-only

Gold before/after SHA-256 is `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; evaluator reports `goldReadOnlyVerified = true`.

## 113. Shareable

Shareable audit passed: absolute path leaks 0, secrets 0, Gold text leaks 0, raw private audio 0, and broken relative references 0. The shareable summary reports only relative artifact references.

## 114. C5.19 Regression

`tests/c5-19-series-memory.test.ts` and `tests/e2e/c5-19-series-memory-flow.test.ts` pass. C5.19 series-memory behavior is unchanged.

## 115. C6 Investigation Regression

The full unit suite and `tests/e2e/c6-0-investigation-flow.test.ts` pass, including blocker ontology, root-cause graph, risk, freshness, review disposition, human authority, and baseline preservation tests.

## 116. C6 Protected Regression

`tests/c6-0-protected-finalization.test.ts`, the protected schema tests, and `tests/e2e/c6-0-protected-finalization-flow.test.ts` pass. Protected finalization remains fail-closed.

## 117. C6.0.1 Regression

`tests/c6-0-1-blind-acceptance.test.ts` and `tests/e2e/c6-0-1-gold-isolated-evaluation-flow.test.ts` pass. Dual blind generation and Gold-isolated evaluation remain enforced.

## 118. C6.0.1.1 Regression

`tests/c6-0-1-1-machine-quality-recovery.test.ts` and its E2E flow pass.

## 119. C6.0.1.2 Regression

`tests/e2e/c6-0-1-2-candidate-timeline-flow.test.ts` passes. Candidate timeline contracts remain compatible.

## 120. C6.0.1.3 Regression

`tests/c6-0-1-3-candidate-association-assembly.test.ts` and its E2E flow pass. Candidate conservation, association ledger, and canonical non-degradation are preserved.

## 121. Tests

Using Node `24.19.0` and npm `11.18.0`: typecheck, lint, format check, build, and Whisper patch verification pass; unit tests are 77 files passed, 635 passed and 2 skipped; E2E is 17 files passed, 36 passed and 1 skipped; focused C5.19/C6/C6.0.1–C6.0.1.4 regression bundle is 15 files and 92 tests passed.

## 122. Schemas

Schema generation produced 202 JSON Schemas. All C6.0.1.4 source artifacts and all evaluation/validation artifacts parse their strict schemas; 13 C6.0.1.4 schema contracts were added and generated.

## 123. Skill Validation

`quick_validate.py` reports `Skill is valid!` for `.agents/skills/multilingual-video-subtitler`.

## 124. Skill 2

`multilingual-grammar-report-generator` has no diff from base `7bcad5e7a5655366f57f69568cdbd11b419efcd3`.

## 125. Skill 3

`multilingual-grammar-learning-site-builder` has no diff from the same base.

## 126. Quality Milestone

Passed: coverage, missing, hallucination, trusted-token, ambiguous-timebase, Gold isolation, hardcoding, unsafe-escape, reproducibility, VAD timebase recovery, token timeline recovery, and coverage guard. Failed: selector recovery, pool recovery, material precision, normalized CER, severe timing, both MAEs, P95, overlap, overall precision recovery, and timing recovery.

## 127. C6.0.2 Readiness

Not ready. The decision is `HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY`, not `GO_C6_0_2`.

## 128. Remaining Risks

The largest known risks are 50 raw-ASR-origin material errors, 19 association errors, 5 Oracle pool-insufficient events, 17 unresolved multi-variant events, 12 unresolved post-re-ASR events, 53 severe timing errors, 48 overlaps, 479 unmapped tokens, and no unseen episode validation.

## 129. Commits

Core contracts and all three workstreams: `7927a04`; tests: `96d69a9`; runner integration: `cd30a54`; hash/runtime guards: `1d57d3b`, `10f91bc`, `027690c`, `af8a6b6`, `54eca88`, `a1c9dfd`; blind identities/audits: `c673879`, `9298c16`; Gold-isolated Oracle: `6097131`; quality validation: `cbfc948`; static acceptance hardening: `84c8948`. The documentation acceptance commit is the commit containing this report; its non-self-referential SHA is supplied by the final delivery response.

## 130. Remote HEAD

The delivery procedure requires local HEAD and `origin/codex/c6-0-1-4-vad-timebase-text-variant-reasr` to be identical after the report commit is pushed. The exact resulting SHA is intentionally reported outside this self-referential file and verified immediately before final response.

## 131. Output Paths

Official outputs: baseline `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-baseline-20260828`; V1 `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-vad-timebase-20260828`; V3 `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-variant-observe-20260828`; V4 `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-variant-enforce-20260828`; V5 `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-targeted-reasr-20260828`; V6 `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-trusted-token-timing-20260828`; V7 `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-eligible-provider-gate-20260828`; full `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-full-candidate-20260828`; final A/B as listed above; Oracle `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-oracle-evaluation-20260828`; original validation `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-validation-20260828`; immutable post-fix validation `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-4-final-validation-20260828`.

# Core Questions Q1–Q12

## Q1. How many of the 373 ambiguous-time-base tokens were recovered?

The fresh v2 timeline eliminates all 373 legacy ambiguous-time-base cases as a category (`373 → 0`) and produces 694 fresh trusted mapped tokens. Because the decoder was rerun and the observation universe changed from 970 to 1,914, this is not represented as a one-to-one mutation of the old token objects.

## Q2. Why are remaining tokens still unmappable?

No token remains `AMBIGUOUS_TIME_BASE`. The remaining failures are different classes: 479 `UNMAPPED`, 575 `UNTRUSTED`, and 166 `ASSOCIATION_PENDING`, including 142 missing-local-time observations, 86 monotonicity failures, 16 containment failures, unassigned cue/event lineage, or insufficient token probability. They remain fail-closed.

## Q3. How much better could the current candidate pool theoretically be?

On the 10 evaluable multi-variant events, perfect selection from the existing pool could reduce normalized event distance from `0.6939937839937839` to `0.48414529914529914`, a theoretical gain of `0.20984848484848487`. With re-ASR candidates the Oracle floor is `0.44995726495726485`, gain `0.24403651903651907`.

## Q4. Is the main problem selector error or absence of the correct variant?

It is mostly not selector error. The 19-event Oracle finds 2 selector errors, 5 pool-insufficient events, 9 association-ambiguous events, and 3 already-correct selections; across all 76 material errors, 50 originate in raw ASR and 19 in association, versus only 2 selector errors.

## Q5. How accurate was CTC on known selector-error cases post hoc?

Automatic correct selection was `0/2`: both cases remained safely ambiguous. CTC did surface a strong relation favoring the Oracle candidate in one case (`canonical-event-0054`) but could not establish global dominance over every competitor; the other case remained incomparable/weak. The useful-signal rate is therefore `1/2`, but resolved-selector accuracy is `0/2`.

## Q6. Which evidence helped correct variant selection most?

CTC supplied the only direct post-hoc useful signal on the two selector-error cases, but it was insufficient for a safe winner. Independent ASR support tied, trusted-token support was zero for both cases, and decoder confidence favored the wrong existing representative. Re-ASR improved the theoretical pool in 2 events, but no new candidate passed final selection. The correct conclusion is that no single evidence source is yet sufficient.

## Q7. How many events triggered targeted re-ASR?

Twelve of 17 eligible events triggered bounded targeted re-ASR.

## Q8. How many better new candidates did targeted re-ASR produce?

It produced 25 new candidates; Gold post-hoc analysis found a better theoretical candidate in 2 events. Runtime selected 0 because neither cleared the machine-only replacement contract.

## Q9. Did targeted re-ASR increase hallucination?

No. Runtime final hallucination stayed at 1, Gold post-hoc `createdHallucinationCount` is 0, and no re-ASR candidate was selected.

## Q10. Did trusted-token growth improve timing?

No; it improved sidecar evidence only in this run. Trusted tokens increased `235 → 694`, trusted cues `16 → 69`, and timing-eligible cues `8 → 59`, but start/end MAE, P95, IoU, severe timing, and overlap were unchanged because accepted timing mutations were zero.

## Q11. How are the 76 material errors attributed?

Raw ASR origin 50; selector error 2; pool insufficient 4; association 19; orthography 0; hallucination 0; unknown 1.

## Q12. Is the system ready for C6.0.2 unseen validation?

No. Recall/safety guardrails pass, but text precision and timing precision do not. Material errors 76, normalized CER `0.6015625`, severe timing 53, MAEs above 1.6 s, P95 `6.44 s`, and overlap 48 require `HOLD_FOR_MORE_ACOUSTIC_TEXT_RECOVERY` before unseen validation.
