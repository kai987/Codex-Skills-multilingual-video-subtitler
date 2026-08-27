# C6.0.1.2 Machine Candidate Precision & Global Timeline Recovery

Date: 2026-08-28
Policy: `c6.0.1.2-candidate-precision-global-timeline-v1`

This report records the completed engineering acceptance and the separate subtitle-quality decision. The Carnation episode 1 Gold subtitle was used only by the post-generation evaluator. It was not supplied to generation, candidate selection, timing recovery, machine memory, or finalization.

## 1. Executive Conclusion

C6.0.1.2 engineering acceptance passed: implementation, strict schemas, offline cache replay, ablations, independent Final A/B reproduction, Gold-isolation audit, dataset-hardcoding audit, shareable audit, and the complete validation suite all passed. Subtitle quality remains `HOLD`; production remains `needs-review`, `finalizationMethod = none`, and `machineOnlyReleaseAuthorized = false`.

## 2. Branch

Branch: `codex/c6-0-1-2-candidate-precision-global-timeline`. Base: `f8ce1dd89af46fa69e8d705ae45c23af38ea9676`. The real blind artifacts bind the implementation commit `a2c6e2b29b620613cb36212dea4524bb95fe3d6b`.

## 3. Baseline

The comparison baseline is a newly reproduced full C6.0.1.1 machine-only run, not a copied metric table. It used the same source media, exact portable ASR cache, reference-free configuration, offline network policy, empty machine memory, and no human-derived runtime input.

## 4. Full Recovery Baseline

V0 produced 157 cues: exact CER `0.6701662292213474`, normalized CER `0.61669921875`, Gold coverage `0.9609375`, missing `7`, hallucination `1`, material text errors `75`, severe timing errors `53`, start MAE `1.8147762193144426 s`, end MAE `1.870955326600303 s`, P95 boundary error `6.868542000000048 s`, median temporal IoU `0.5824665676077242`, and `52` rendered overlap pairs.

## 5. Development-set Status

This is a known development-set evaluation of Carnation episode 1. Gold cue count is `192`. No episode 2/3 Gold or other unseen Gold was accessed. The result measures this development example only and is not an unseen-generalization claim.

## 6. Non-goals

This iteration did not authorize machine-only production release, modify Gold, tune thresholds to reduce review counts, run online subtitle search, use cloud inference, alter Skill 2/3, or claim that candidate-layer duplicate collapse automatically resolves subtitle overlap.

## 7. Main Quality Problem

The dominant defensible structural loss remains candidate association and clustering: the generation survival funnel drops `166` of `365` entries at `candidate-to-cluster`. Later stages also remove `17` winner duplicate/prefix entries, merge `11` fragments, remove `1` post-normalization duplicate, quarantine `3` segmentation results, and quarantine `4` final-integrity results. Gold can identify resulting defects after generation, but it was not used to choose candidates.

## 8. Raw vs Final Regression

Raw ASR had 169 cues, normalized CER `0.5166015625`, coverage `0.97216796875`, material errors `63`, and severe timing errors `37`. Final A has 156 cues, normalized CER `0.6201171875`, coverage `0.9462890625`, material errors `74`, and severe timing errors `53`. Thus the legacy downstream path still introduces a substantial raw-to-final regression; C6.0.1.2 did not recover it.

## 9. Candidate Architecture

The implementation adds acoustic event families, evidence-correlation groups, cross-window consensus, a per-request media-coordinate contract, a trusted global token timeline, cue-level timeline evidence, timing non-degradation, lexical conservation, overlap event classification, run audit, workflow integration, CLI flags, validation, and strict artifacts.

## 10. Acoustic Event Family

An acoustic event family groups candidates only when temporal and lexical evidence support a shared underlying event. It retains request, window, profile, correlation-group, independent-evidence, candidate, representative, and speaker-hypothesis lineage; it does not equate text similarity with independent acoustic support.

## 11. Family Metrics

The final run grouped `236` input candidates into `216` families: `196` singleton families and `20` two-candidate families. All `216` were stable. The family layer collapsed `20` duplicate candidates and marked `5` correlated duplicates. There were `91` distinct correlation groups and `5` distinct independent-evidence group identities; `15` families had two independent supports.

## 12. Ambiguous Families

Ambiguous family count: `0`. This means the configured family criteria produced no internally ambiguous family on this run; it does not mean all final subtitle content is correct.

## 13. Multi-speaker Families

Multi-speaker family count: `0`; every family had zero speaker hypotheses in this run. No speaker model evidence was produced by this C6.0.1.2 execution.

## 14. Duplicate Event Families

Twenty two-candidate families collapsed one duplicate candidate each, reducing the candidate layer from `236` to `216`. This is a candidate-layer result. It must not be reported as twenty rendered subtitle overlaps removed.

## 15. Cross-window Consensus

Consensus ranks alternatives by acoustic-family stability, independent support, correlation-aware evidence, temporal agreement, lexical agreement, and deterministic tie-breaking. Correlated window/profile observations cannot masquerade as multiple independent votes.

## 16. Evidence Correlation

Evidence is correlated by source profile, request scope, time scope, and cache lineage. Fifteen families have two independent supports; the other `201` have one. Correlation is retained as provenance rather than discarded after scoring.

## 17. Consensus Metrics

All `216` decisions were `CONSENSUS_ACCEPT`; `216` were stable, `216` emitted one representative, and `20` allowed a candidate mutation. Confidence was high for `15` and medium for `201`; independent support was two for `15` and one for `201`. No ambiguous decision was auto-promoted.

## 18. Prefix Collapse

The new lexical-conservation gate performed zero prefix collapses, zero deletions, and zero merges. The legacy survival funnel still records `17` earlier `duplicate-or-prefix-winner` losses, so this iteration does not claim to have reconstructed those historical losses.

## 19. Longer Candidate Preservation

When a longer candidate is not contradicted by localized acoustic evidence, the new gate preserves its content and blocks unsupported shortening. On this data, all `1900` source characters survived the new lexical gate, but no unsafe lexical proposal occurred for the gate to reject.

## 20. Request Timeline Contract

The run audited `117` ASR requests: `82` verified, `35` quarantined, and `0` unavailable. Verified contract coverage is `82/117 = 0.7008547008547008`. All `35` quarantined requests used VAD and carry `vad-remapping-not-proven`; all `82` verified requests used original-audio local coordinates without VAD.

## 21. FFmpeg Seek Semantics

All `117` requests used input seek before input (`input-seek-before-i`). The contract records requested/extracted intervals, input seek, output trim, sample count, sample rate, content identity, and cache lineage instead of inferring coordinates from a filename.

## 22. Local Decoder Time

All decoder chunks start at local time zero, and FFmpeg output time origin is zero. The extracted PCM is treated as a standalone local coordinate system; local timestamps are never assumed to be media-global without a verified offset.

## 23. Global Media Mapping

For the `82` verified non-VAD requests, global time is `verified extraction start + decoder-local time`. The `35` VAD requests are quarantined because the post-VAD coordinate remap is not proven. Fail-closed mapping prevents plausible but unsupported global timestamps.

## 24. Raw Token Count

The current artifacts contain `970` raw token observations, of which `886` are lexical tokens. This is the current C6.0.1.2 evidence universe and must not be conflated with the legacy `3491` token observations discussed in prior diagnostics.

## 25. Mapped Token Count

Mapped token count: `235`. All mapped tokens satisfy the current request contract and segment/request containment checks.

## 26. Trusted Token Count

Trusted mapped token count: `235`; rejected/untrusted count: `735`. Trusted evidence came from `17` requests. Request coverage is `0.28205128205128205`; candidate-cue token coverage is `0.5882352941176471`.

## 27. Mapping Failure Reasons

Failures were: ambiguous time base `373`, segment-containment failure `179`, out-of-request `127`, and invalid token time `56`. The largest single cause is ambiguous time base. The `373` VAD tokens are quarantined, not silently converted.

## 28. Trusted Cue Coverage

At the current pre-final cue layer, `16/149` cues have trusted tokens (`0.10738255033557047`) and only `8/149` are timing-eligible (`0.053691275167785234`). The separate `0.5882352941176471` timeline cue coverage uses the token-bearing candidate-cue domain; the denominators are intentionally not merged.

## 29. Cue Timeline Evidence

The cue artifact binds trusted token IDs, request IDs, source coordinate systems, boundary proposals, coverage, and rejection reasons for all `149` evaluated cues. Sixteen had trusted-token evidence and eight produced eligible boundary proposals.

## 30. Timing Evidence Priority

Only verified mapped-token evidence was eligible in this run. MFA and CTC integrations were unavailable and applied zero changes; weaker or unavailable evidence cannot override current timing. Existing boundaries remain unchanged unless localized evidence passes coverage and non-degradation gates.

## 31. Timing Non-Degradation

The timing gate evaluated `149` cues and recorded `0` timing-regression escapes. It checks minimum duration, local ordering, overlap non-increase, excessive expansion, weak coverage, and trusted provenance before mutation.

## 32. Timing Mutation Proposals

Eight timing proposals were evaluated: six accepted and two rejected; `141` cues remained unchanged. Total accepted boundary movement was `6.315667000000133 s`. One proposal triggered the expansion-rejection counter and two triggered weak-evidence rejection; counters can overlap.

## 33. Timing Accepted

Accepted cues: `canonical-00036`, `recovery-unit-0006-recovered-002`, `recovery-unit-0006-recovered-003`, `recovery-unit-0006-recovered-004`, `canonical-00073`, and `recovery-unit-0034-recovered-002`. All six cite trusted-token coverage and timing non-degradation; no MFA/CTC evidence was applied.

## 34. Timing Rejected

Rejected cues: `canonical-00130` and `canonical-00157`. Both retain their original boundaries with reason `timing-non-degradation-or-coverage-gate-rejected`.

## 35. Boundary Expansion Rejection

Expansion-rejected count: `1`; weak-evidence-rejected count: `2`. The gate does not expand a cue simply to cover a broad or uncertain token span.

## 36. Lexical Conservation

The lexical gate evaluated `149` input and `149` output cues through `133` grouped preservation decisions. Source, consensus, and final character counts are all `1900`.

## 37. Lexical Mutations

Lexical mutation count: `0`; presentation-only mutation count: `0`; evidence-supported mutation count: `0`; before/after text is identical at this gate.

## 38. Unsupported Deletions

Deletion count, truncation count, lexical-loss count, and unsupported-mutation-rejected count are all `0`. No unsupported deletion proposal occurred in this dataset slice, so this is preservation evidence rather than proof of broad recall recovery.

## 39. Unsupported Merge Prevention

New lexical-gate merge count: `0`. The earlier legacy fragment-repair stage still merged `11` fragments, so the current gate did not retroactively undo those merges.

## 40. Cross-speaker Merge Prevention

Cross-speaker mutation count and cross-speaker rejection count are `0` because current-run speaker evidence is unavailable. No cross-speaker merge is claimed as detected or resolved.

## 41. Spurious Overlap Analysis

Two scopes are reported separately. The pre-final machine classifier inspected `18` raw/candidate overlap pairs; the rendered Gold evaluator counted `52` V0 and `49` Final A/B overlaps. These counts have different stages and cannot be substituted for one another.

## 42. Duplicate-event Overlap

The pre-final classifier found `0` proven duplicate-event overlap pairs and automatically resolved `0`. Candidate-family duplicate collapse therefore cannot be used as evidence that any rendered overlap pair was a duplicate event.

## 43. True Multi-speaker Overlap

Concurrent or multi-speaker overlap count: `0` in the current classifier. Because speaker evidence was unavailable, this is not evidence that the episode contains no overlapping speakers.

## 44. Unknown Overlap

Unknown overlap count: `17`; rapid-turn padding/boundary-collision count: `1`. Unknown cases remain review-required and are not auto-resolved.

## 45. MFA Usage

MFA integration status: `unavailable`; current-run runtime identity `null`, inference `0`, loads `0`, cache hits `0`, candidates `0`, applied `0`, text mutations `0`, and timing mutations `0`.

## 46. CTC Usage

CTC integration status: `unavailable`; current-run runtime identity `null`, inference `0`, loads `0`, cache hits `0`, candidates `0`, applied `0`, text mutations `0`, and timing mutations `0`.

## 47. Speaker Usage

Speaker integration status: `unavailable`; current-run inference `0`, model loads `0`, cache hits `0`, candidates `0`, applied `0`, text mutations `0`, and timing mutations `0`.

## 48. Separation

Source separation was not executed and applied zero changes. No separation-backed text, timing, speaker, or overlap claim is made.

## 49. Hallucination Regression

Hallucination candidates changed from V0 `1` to Final A/B `2`, a regression of `+1`. The absolute gate (`<= 2`) passes, but the direction does not support a quality-improvement claim.

## 50. Coverage Guard

Final coverage `0.9462890625` passes the `>= 0.9` safety gate, but regresses by `-0.0146484375` from V0 and by `-0.02587890625` from raw ASR.

## 51. Missing Dialogue

Missing dialogue candidates changed from V0 `7` to Final `9` (`+2`). Raw ASR had `5`; therefore recall remains worse after the downstream pipeline.

## 52. Material Text Errors

Material text errors changed from V0 `75` to Final `74` (`-1`) but fail the required `<= 45` gate. Raw ASR had `63`, so Final is `+11` worse than raw.

## 53. Severe Timing Errors

Severe timing errors stayed at `53` from V0 through V5/Final and fail the required `<= 30` gate. Raw ASR had `37`; the `+16` regression already exists before the C6.0.1.2 stages.

## 54. Exact CER

Exact CER changed from V0 `0.6701662292213474` to Final `0.6771653543307087` (`+0.006999125109361293`, worse). Raw ASR was `0.5831146106736658`.

## 55. Normalized CER

Normalized CER changed from V0 `0.61669921875` to Final `0.6201171875` (`+0.00341796875`, worse) and fails the `<= 0.55` gate. Raw ASR was `0.5166015625`.

## 56. Start MAE

Start MAE improved from V0 `1.8147762193144426 s` to Final `1.764667572474024 s` (`-0.0501086468404186 s`) but fails the `<= 1.2 s` gate. Raw ASR was `1.3203134328358284 s`.

## 57. End MAE

End MAE regressed from V0 `1.870955326600303 s` to Final `1.894287250610067 s` (`+0.023331924009764027 s`) and fails the `<= 1.2 s` gate. Raw ASR was `1.3926641791044845 s`.

## 58. P95

P95 boundary error improved from V0 `6.868542000000048 s` to Final `6.760999999999967 s` (`-0.1075420000000804 s`) but fails the `<= 3.5 s` gate. Raw ASR was `6.470000000000027 s`.

## 59. IoU

Median temporal IoU changed from V0 `0.5824665676077242` to Final `0.5699999999999932` (`-0.012466567607731016`, worse). Raw ASR was `0.6761133603238165`.

## 60. Machine Overlap Count

Rendered overlap pairs improved from V0 `52` to Final `49` (`-3`) but fail the `<= 20` gate. Raw ASR and the pre-final classifier each expose `18` pairs at their respective stages.

## 61. Ablation V0

V0 Full C6.0.1.1 baseline: 157 cues, normalized CER `0.61669921875`, coverage `0.9609375`, missing `7`, hallucination `1`, material `75`, severe timing `53`, overlaps `52`. Freeze hash: `3c4ef3ebfde97c67302286932d4b7ec12f9c85a65afc1e6cdcd4fe26be20a62f`.

## 62. V1

V1 acoustic-family observe is output-identical to V0 on all quality metrics. Freeze hash: `134f79f1ab91dd0c33105aa0aa9995a49d56e9230a093e28e1cc35bc2a0fa243`.

## 63. V2

V2 cross-window consensus changes the rendered result to 156 cues, normalized CER `0.6201171875`, coverage `0.9462890625`, missing `9`, hallucination `2`, material `74`, severe timing `53`, and overlaps `49`. Freeze hash: `7fe15668645c41d4daed460d078642f86f2e592d88b9062410e6881fa1af6633`.

## 64. V3

V3 global-timeline observe plus lexical gate is metric-identical to V2. It adds auditable trusted/quarantined timing evidence without changing the rendered metrics. Freeze hash: `f80684533a83fc1bd9df988208727a642605b637fcb9c273ad274ef1239ee445`.

## 65. V4

V4 timing non-degradation full candidate is metric-identical to V2/V3. It accepts six localized boundary changes and rejects two, but downstream rendered evaluation remains unchanged. Freeze hash: `350b51c505df8ad97bb5aef447db8331f08338178b2807a956f874eddc1d07c2`.

## 66. V5

V5 reuses only current machine-produced targeted-provider evidence; MFA/CTC/speaker remain unavailable. Metrics equal V2-V4. Final A freeze hash: `361b3ce769a5b606d785b85c571357ac6bb4da0553c9ea9e7666c3d6256a18e2`.

## 67. Full Candidate

The full candidate is structurally richer and safer to audit, but its rendered quality metrics equal V2 and do not meet the GO contract. Architecture acceptance is not treated as subtitle-quality acceptance.

## 68. Selection Policy

Policy version: `c6.0.1.2-candidate-precision-global-timeline-v1`. Final A policy semantic hash is `5ee1b4df328a8c3eb45317be3b142ac7b86ac7f808872c510dde9e64c2a75e7b`; Final B is `1ca92537bf339099bd22bf7056a0a6d19d6d47a43636de27d1c1c1d0ccfd8bdc`. They intentionally differ because the policy artifact binds run-specific artifact hashes; the underlying semantic outputs are identical.

## 69. Final A

Final A completed in `40.485 s` with `117/117` portable cache hits, `0` misses, `117` migrations, `0` ASR inference requests, `0` model loads, and `0` worker starts. It produced 156 cues and `REVIEW_REQUIRED`. Freeze hash: `361b3ce769a5b606d785b85c571357ac6bb4da0553c9ea9e7666c3d6256a18e2`.

## 70. Final B

Final B independently reproduced the same machine subtitle, quality metrics, evidence semantics, and shadow outcome with the same offline exact-cache conditions. Its run-specific freeze hash is `1153217b3a86ce8854afa710a251fd90b2f97b380f8fe08e0ce8b09b5f7ff36b`.

## 71. A/B Reproducibility

Exact A/B hashes: raw transcription `47f154679dc87fee9b42dc854497c40d5df93f9c5c1e6d70e444f3a7a5506393`; canonical ASR `76c519038243476e1a9dcc202811ccc0a4a5c61a70ac14a4d4a4332fbe2a6cf4`; subtitle-package file `fe416c32898a8624352ce9d1069ed99a98b07a8d1ca702ba86b888e558b7b9d6`. Critical semantic hashes match: machine package `cf7c74365a7c0bba7e35c7a10e4d2563f04ed12ac4efe30729a1295e513b3dda`, canonical text `49f5e06b032fb5b93aa1e9933a1258133fca2b9db46efc0b32f3feed73d6d28e`, canonical timing `7d91225e85b15a48cd78148b0180d80e6e181f28ad82e405d593aa1a62199b0f`, and presentation `44f47e667dcbe0c553ec4967eded58e380511c4778d7ad72c21e3525399a9b30`. Family, consensus, contract, timeline, overlap, metrics, and shadow outcome also match exactly. SRT/ASS/VTT hashes are `649823fe2b9f39c69878d24e0213fc11c345628d8e634198c2e99623e8a5fdf7`, `092043b68bb6ea60dbf72755c6f643f991c76dc2b8b243a62b14bd8cd3a1960b`, and `113265b19c441e2e05be770c3082042af1a4c05304c14b043aa7f9423b5c662a`.

## 72. Shadow Outcome

Both runs report `shadowMachineOutcome = REVIEW_REQUIRED`, production status `needs-review`, and production finalization method `none`. There are `149` positive current-output defect evidence items. Unknown-signal-zero, defect-zero, critical-evidence coverage, and no-unresolved-high-risk checks remain false.

## 73. Unsafe Escape

Unsafe finalization escape count: `0`. No failed or unknown quality condition was converted into a machine-only final result.

## 74. Production Release Gate

Production release remains closed. Quality gates pass for coverage, missing count, hallucination count, trusted tokens, A/B parity, Gold isolation, and production safety; they fail for material errors, severe timing, start MAE, end MAE, P95, normalized CER, and overlap count.

## 75. C6.0.1 Regression

The C6.0.1 blind-acceptance unit and Gold-isolated E2E regressions pass. Runtime Gold input count remains zero, no new human-derived provenance appears, and fail-closed release behavior is preserved.

## 76. C6.0.1.1 Regression

The C6.0.1.1 machine-quality-recovery unit and E2E regressions pass. Existing quality artifacts remain schema-valid, and the C6.0.1.2 additions do not weaken the prior review boundary.

## 77. C6 Protected Regression

Protected-finalization unit/E2E plus baseline-preservation and risk-policy regressions pass. Protected text/timing authority is not inferred from machine consensus.

## 78. C5.19 Regression

C5.19 series-memory unit/E2E regressions pass. This run starts with empty machine memory and does not import series-specific human terminology, pronunciation, or correction memory.

## 79. Gold Runtime Isolation

Runtime Gold input count is `0`; unseen Gold access count is `0`; all human artifact classes report `used = false`, `inputCount = 0`. Generation arguments contain no Gold/reference/human-subtitle flag. Provenance audit passed with 15 nodes: 14 machine, 1 generic, 0 human-derived, 0 unknown, and no known human identity matches.

## 80. Dataset Hardcoding Audit

Final production-source hardcoding findings: `0`. The validator scans production runtime roots for the development title, known Gold phrases/identity, and human cue/timing identity fields and fails closed on any match. An earlier validation exposed a production Gold SHA and an inconsistent hardcoding count; the runtime and validator were fixed, Final A/B were rerun, and pre-fix outputs were preserved with `pre-hardcoding-fix-20260828` names. Two earlier fail-closed diagnostics also remain preserved: failed exact-portable import and failed policy-schema validation.

## 81. Tests

Final Node `v24.19.0` / npm `11.19.0` results: schema generation passed; typecheck passed; lint passed; Prettier check passed; build passed; full Vitest `72/72` files, `604` passed and `2` skipped; E2E `15/15` files, `34` passed and `1` skipped; targeted C6.0.1.2 plus core-regression suite `20/20` files, `83/83` passed. The post-suite validator rerun produced the same semantic hash `8210a805884a30f60520b9f0df15d4117c4370d195fc0576ff18b1eb7d16cf63` as the official validation.

## 82. Schemas

Schema generation produced `176` JSON Schemas. C6.0.1.2 adds 12 strict contracts: request timeline, acoustic families, cross-window consensus, global token timeline, cue timeline evidence, timing non-degradation, lexical conservation, overlap classification, quality policy, ablation, quality comparison, and validation. Unknown fields are rejected by the shared runtime schemas.

## 83. Skill Validation

`multilingual-video-subtitler` quick validation passed (`Skill is valid!`). The skill constraints shaped the implementation: preserve the source, use local/offline Whisper evidence, keep Gold out of runtime, validate artifacts, and fail closed when evidence is incomplete.

## 84. Skill 2

Skill 2 (`multilingual-grammar-report-generator`) was not modified. The branch diff contains no Skill 2 path.

## 85. Skill 3

Skill 3 (`multilingual-grammar-learning-site-builder`) was not modified. The branch diff contains no Skill 3 path.

## 86. Network

Network policy was off; network used `false`; online subtitle search used `false`; cloud inference count `0`. All generation and validation inputs were local.

## 87. Source Read-only

Source media size: `847774958` bytes. SHA-256 before, after, and final recheck: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`. Source read-only verification passed.

## 88. Gold Read-only

Gold size/cue identity was recorded only in evaluation. Gold cue count: `192`; SHA-256 before, after evaluation, and final recheck: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`. No full Gold text is copied into this report or shareable artifacts.

## 89. Shareable

Shareable audit passed for one summary artifact: absolute-path leaks `0`, secrets `0`, Gold-text leaks `0`, raw-private-audio files `0`, and broken relative references `0`. The shareable summary includes identities and aggregate metrics, not private source paths or alignment excerpts.

## 90. Quality Milestone

The achieved milestone is auditable candidate precision architecture and recovery of `235` trusted global token observations with deterministic A/B parity and safe rejection. It is not a subtitle-quality GO milestone.

## 91. C6.0.2 Readiness

Decision: not ready for C6.0.2 production release. A next quality iteration can build on the verified contracts, but must reduce candidate-to-cluster loss, improve localized recall, expand trustworthy timing coverage, and show net gains without worsening CER, coverage, missing dialogue, hallucination, end MAE, or IoU.

## 92. Remaining Risks

Open risks: material errors `74`, severe timing errors `53`, normalized CER `0.6201171875`, rendered overlaps `49`, missing dialogue `9`, hallucinations `2`, only `8/149` timing-eligible cues, `373` ambiguous-time-base tokens, `17` unknown pre-final overlaps, and unavailable current-run MFA/CTC/speaker/separation evidence.

## 93. Commits

Implementation commits: `388c076` acoustic families/consensus; `fdc7464` global token timeline; `c9d1eef` lexical/timing gates; `7e4db28` workflow integration; `e0b6208` exact portable-cache import; `a4ff0fc` artifact-bound policy; `a2c6e2b` removal of dataset-specific Gold identity. The acceptance-report commit is the commit containing this document; its non-self-referential SHA is recorded in the delivery response and remote Git history.

## 94. Remote HEAD

Acceptance requires local HEAD, `origin/codex/c6-0-1-2-candidate-precision-global-timeline`, and the clean working tree to agree after push. The exact post-push SHA is intentionally reported outside the commit content to avoid a self-referential hash.

## 95. Output Paths

Official generation outputs:

- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-full-baseline-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-family-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-consensus-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-global-timeline-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-full-candidate-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-a-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-b-20260827`

Official evaluations:

- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-full-baseline-evaluation-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-family-evaluation-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-consensus-evaluation-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-global-timeline-evaluation-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-full-candidate-evaluation-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-a-evaluation-20260827`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-b-evaluation-20260827`

Official validation:

- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-validation-20260827.json`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-validation-artifacts-20260827`

Preserved fail-closed history:

- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-full-baseline-failed-portable-import-pre-fix-20260828`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-full-baseline-failed-policy-schema-pre-fix-20260828`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-a-pre-hardcoding-fix-20260828`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-a-evaluation-pre-hardcoding-fix-20260828`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-b-pre-hardcoding-fix-20260828`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-final-b-evaluation-pre-hardcoding-fix-20260828`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-validation-pre-hardcoding-fix-20260828.json`
- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-2-validation-artifacts-pre-hardcoding-fix-20260828`

## Required Questions Q1-Q10

### Q1. How many duplicated candidates were actually collapsed?

At the candidate-family layer, `20` duplicate candidates were collapsed (`236 -> 216`). In the 157-cue V0 rendered output, only `3` cue IDs directly match selected representatives from multi-candidate families. In the 156-cue Final output, downstream splitting yields `6` rendered cues matching those representatives. Therefore the defensible answer is 20 candidate duplicates, not 20 rendered subtitle cues.

### Q2. How many of the reported overlaps were duplicate events?

Zero of the `18` pre-final classified overlap pairs were proven duplicate events: `0` duplicate, `1` rapid-turn/boundary collision, `0` proven concurrent multi-speaker, and `17` unknown. The prompt's historical `40` overlaps and the reproduced V0 evaluator's `52` rendered overlaps cannot truthfully be relabeled as duplicates because they are different-stage counts without duplicate-event proof.

### Q3. Did candidate precision improve final subtitle quality?

It reduced candidate count `236 -> 216`, rendered cues `157 -> 156`, material errors `75 -> 74`, overlaps `52 -> 49`, start MAE by `0.0501086468404186 s`, and P95 by `0.1075420000000804 s`. However normalized CER, coverage, missing dialogue, hallucination, end MAE, and IoU worsened, while severe timing stayed `53`. This is not a clean or sufficient quality win.

### Q4. Why were the legacy 3491 tokens not trusted?

The legacy token universe lacked an auditable per-request mapping from extracted audio and decoder-local coordinates back to source-media time, especially across VAD/cache origins. The correct fail-closed decision was zero trusted global mappings from that legacy set, rather than guessing offsets.

### Q5. What did the new global timeline recover?

It audited the current `970` token observations and recovered `235` trusted mapped tokens from `17` requests. These counts describe the current C6.0.1.2 artifacts, not the legacy 3491-token universe.

### Q6. What is the largest token-mapping failure cause?

`ambiguous-time-base`, affecting `373` tokens. Those are predominantly VAD-derived observations whose post-VAD remapping is not proven.

### Q7. What is the primary defensible source of material text loss?

The strongest structural evidence is `candidate-to-cluster`, which drops `166/365` candidate entries. Winner deduplication (`17`) and fragment merges (`11`) are secondary recorded losses. The new lexical gate made zero deletions/merges and cannot assign each Gold error to one source, so the report does not overclaim per-cue causality.

### Q8. Where did the severe timing regression occur?

Raw ASR has `37` severe timing errors and V0 already has `53`; V1-V5/Final remain at `53`. Therefore the `+16` regression exists in the legacy raw-to-canonical/downstream assembly path before the new C6.0.1.2 stages. The new global-timeline/timing gate neither caused nor repaired the aggregate regression; exact per-cue legacy attribution remains unresolved.

### Q9. What improved and what regressed versus V0?

Improved: material errors `-1`, overlap pairs `-3`, start MAE `-0.0501086468404186 s`, P95 `-0.1075420000000804 s`. Unchanged: severe timing `0`. Regressed: normalized CER `+0.00341796875`, exact CER `+0.006999125109361293`, coverage `-0.0146484375`, missing `+2`, hallucination `+1`, end MAE `+0.023331924009764027 s`, and IoU `-0.012466567607731016`.

### Q10. GO or HOLD?

`HOLD`. Trusted-token recovery, A/B reproducibility, Gold isolation, production safety, coverage, missing-count, and hallucination-count gates pass; material errors, severe timing, start/end MAE, P95, normalized CER, and overlap gates fail. Production remains review-only.
