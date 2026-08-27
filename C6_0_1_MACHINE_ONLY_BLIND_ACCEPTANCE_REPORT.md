# C6.0.1 Machine-only Blind Acceptance & Gold-Isolated Evaluation

## 1. Executive Conclusion

C6.0.1 real-model acceptance passed for the **development-known runtime-blind** benchmark. The generation-isolation proof, dual-output freeze, post-freeze Gold evaluation, deterministic evaluator replay, safety decision, C6.0 regression, and shareable audit all passed. Both blind runs independently produced the same 51-cue machine subtitle and the same `REVIEW_REQUIRED` shadow outcome.

This is a safety success, not a subtitle-quality or release success. Both runs expose substantial Gold-relative defects: exact CER `0.8665791776027997`, normalized CER `0.85400390625`, 59 missing-dialogue findings, 39 material text errors, 40 severe timing errors, and 138 P1 defects. The policy correctly prevented an unsafe finalization escape. `machineOnlyReleaseAuthorized` therefore remains `false`; the final recommendation is `GO_C6_0_2` for genuinely unseen multi-episode validation.

## 2. Branch

`codex/c6-0-1-machine-only-blind-acceptance`

## 3. Baseline

`5f900da58e94911f563473e9f14bfdb87d789041` (`docs: record C6.0 protected finalization acceptance`)

## 4. Scope

The implementation adds a Gold-free generation zone, input/provenance manifests, machine-only evidence coverage, fail-closed shadow finalization, output freezing, a dual-run Gold barrier, post-hoc Gold evaluation, deterministic replay, aggregate acceptance decisions, JSON Schemas, validation scripts, tests, and shareable summaries.

## 5. Non-goals

This work does not rewrite the machine subtitle after Gold inspection, authorize machine-only release, claim unseen generalization, relax review thresholds, import human-derived artifacts into generation, change Skill 2 or Skill 3, or tune generation/evaluation policy after seeing Gold.

## 6. Why C6.0.1 Exists

C6.0 protected-finalization semantics needed a causal acceptance test: first prove that generation did not see the answer, then verify whether the frozen machine policy would safely withhold weak output when compared with Gold.

## 7. Current Machine Release Gate

The production result is `needs-review`, `finalizationMethod = none`, shadow outcome `REVIEW_REQUIRED`, and `machineOnlyReleaseAuthorized = false`. A machine-only release is gated on both policy safety and later unseen generalization.

## 8. Benchmark Contamination Warning

The Carnation episode is known to the development history. It is valid for runtime-blind isolation and safety evaluation only; it must not be described as an unseen benchmark.

## 9. Runtime Blind vs Unseen Blind

Runtime blind means the concrete A/B processes had no Gold or human-derived inputs before freeze. Unseen blind additionally requires media not used during development. C6.0.1 establishes the former (`runtimeBlindAcceptancePassed = true`) but not the latter (`unseenGeneralizationPassed = false`).

## 10. Source Video

- Path: `/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv`
- File: `カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv`
- Size: `847,774,958` bytes
- SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- Read-only verification: passed; hash before and after generation is unchanged.

## 11. Human Gold

- Path: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-2-1-contradiction-audit-20260823/C-draft/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/machine-review-draft-contradiction-audited/machine-review-draft-contradiction-audited.ass`
- Artifact: `machine-review-draft-contradiction-audited.ass`
- Size: `17,094` bytes
- SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`
- Cue count: `192`
- Use: evaluation-only after the dual-freeze barrier.

## 12. Generation Zone

Runs A and B used only the source video, generic model/runtime resources, fresh isolated ASR caches, and fresh empty machine-memory stores. Generation used `reference-free`, disabled online search and web subtitle fallback, and did not receive a Gold path.

## 13. Gold Barrier

The dual-freeze barrier was created at `2026-08-27T05:44:01.592Z`, before the first Gold read. Its semantic hash is `a38325fb09810eb108c6fc5e1fcd493706405937d412b29e6784e68c1a9e1bc3`. It verifies identical runtime/configuration, distinct outputs/caches/memory stores, both runs frozen, and Gold-read authorization.

## 14. Evaluation Zone

Only after barrier creation did the evaluator read Gold. Evaluation is read-only and inference-free; it writes separate evaluation artifacts and cannot write into either frozen generation directory.

## 15. Gold Isolation Guard

The guard rejects premature Gold access, missing/invalid freeze identity, output drift, policy mismatch, and Gold identity mismatch. Final validation reports `goldIsolationPassed = true` and zero isolation violations.

## 16. Forbidden Human Artifacts

For both runs, human subtitle, canonical, timing, memory, alignment, CTC, correction-feedback, authority, and protected-final inputs all have `used = false` and `inputCount = 0`.

## 17. C5.19 Memory Isolation

No C5.19 series memory or human-derived terminology memory was imported. Each run started with an empty, non-human-derived machine store; entry count was `0`, with same-cue and future-cue leak counts both `0`.

## 18. Media Cache Isolation

No previous media-specific cache was imported. A and B used fresh, distinct cache directories and each recorded `203` misses, `0` cache hits.

## 19. Blind Workspace

A and B used distinct output directories, distinct media caches, and distinct machine-memory stores. The Gold file was outside both generation workspaces and absent from generation arguments and lineage.

## 20. Input Manifest

The frozen manifests record source identity, repository commit `ebe6adc0965d9451f9087e060fd71160440532e6`, benchmark status, allowed generic resources, model snapshot, runtime identity, empty memory state, forbidden human inputs, network policy, and exact generation arguments.

## 21. Provenance Audit

Each run reports 14 provenance nodes: 13 machine-derived, 1 generic resource, 0 human-derived, and 0 unknown. `isolationViolations` and `knownHumanIdentityMatches` are empty; both audits passed.

## 22. Blind Generation Proof

Both proofs confirm `humanSubtitleReadDuringGeneration = false`, human-derived artifact use count `0`, no prior-media cache import, empty initial machine memory, no cue-memory leakage, no online search, no network, frozen-before-Gold status, unchanged output after Gold, and zero Gold mutation.

## 23. Machine-only Pipeline

The real pipeline used local `whisper.cpp`/large-v3, reference-free Japanese generation, machine-only repair and validation stages, machine-only evidence coverage, the frozen shadow policy, and production human-gated finalization. Gold never participated in generation or shadow outcome selection.

## 24. Machine Canonical

Both runs produced 51 cues with identical identities:

- Canonical text hash: `0abe8d9fdbf4b4c60d918cb570f4f050bca88adf19133a268754136462daf6de`
- Canonical timing hash: `2101e86b9c216509dd5057905217a96bd6427d96028376a812737adc9d131452`
- Presentation hash: `2cf3f20ce11e05b006c44cb4268df3e3f1408cf5d9666883e9b6e5ec42ca9c24`

## 25. Local ASR

The generic model was `large-v3`, snapshot SHA-256 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`. Each run executed 203 local Whisper inferences and 203 model loads, with no cloud inference.

## 26. VAD

VAD evidence was present and passed as a required machine-evidence dimension. Whisper's optional VAD mode was disabled for this run; no human-derived VAD/timing material was used.

## 27. Timestamp Integrity

Machine canonical timing and presentation hashes match across A/B, and all cross-run boundary differences are zero. Token-timestamp evidence was absent and therefore classified `unknown`; the fail-closed policy prevented finalization.

## 28. MFA

MFA inference count was `0`. MFA evidence was absent/optional and classified `unknown`; no human-derived alignment was loaded.

## 29. CTC

CTC inference count was `0`. CTC evidence was absent/optional and classified `unknown`; no human-derived CTC artifact was loaded.

## 30. Speaker

Speaker inference count was `0`. Speaker evidence was absent/optional and classified `unknown`; this run does not claim speaker resolution.

## 31. Separation

Separation inference count was `0`; no source separation result was used to alter machine canonical text or timing.

## 32. Machine-only Memory

Each independent store began at zero entries, was non-human-derived, and remained isolated from the other run. Machine-memory parity across A/B passed.

## 33. Machine Evidence Coverage

There were 12 required dimensions: 11 passed, 0 failed, and 1 (`token-timestamp-evidence`) remained unknown. Across required and optional signals, the unknown-signal count was 5. Critical coverage therefore failed closed, with 45 unresolved high-risk regions.

## 34. Shadow Finalization Policy

- Version: `c6.0.1-machine-shadow-finalization-v1`
- Hash: `8757f9c80cb30c7b4076fd997a72ea041eee92f153f5b437e79e7f8a9f3d4a03`
- Semantics: unknown required evidence, positive current-output defect evidence, incomplete critical coverage, or unresolved high-risk regions require review.

The policy was fixed before Gold evaluation and was not tuned afterward.

## 35. Shadow Outcome

Both A and B returned `REVIEW_REQUIRED`; reason codes were `UNKNOWN_SIGNAL_FAIL_CLOSED`, `CURRENT_OUTPUT_DEFECT_EVIDENCE_REQUIRES_REVIEW`, and `CRITICAL_MACHINE_EVIDENCE_INCOMPLETE`.

## 36. Why Production Status Remains Needs-review

The machine evidence had 45 positive current-output defect findings, 45 unresolved high-risk regions, and incomplete critical evidence. Production therefore remains `needs-review` with `finalizationMethod = none`. The later Gold result confirms that this withholding decision was necessary.

## 37. Blind Run A

- Run ID: `c6-0-1-a-ebe6adc0965d`
- Generation: `2026-08-27T05:07:41.793Z` to `2026-08-27T05:25:23.610Z`
- Wall time: `1,061,817 ms` (17m 41.817s)
- Inference/load/cache-hit: `203 / 203 / 0`
- Machine cues: `51`
- Freeze hash: `407e481b3e2ca0280f79d437ad1b060726de00914e9787bda2eadd3e6cdc3af3`
- Frozen aggregate/output hash: `d4a71aef3bf070062f06aa1208b516812a7d519b313ac47c2a05c74501225630`

## 38. Blind Run B

- Run ID: `c6-0-1-b-ebe6adc0965d`
- Wall time: `1,055,848 ms` (17m 35.848s)
- Inference/load/cache-hit: `203 / 203 / 0`
- Machine cues: `51`
- Freeze hash: `7276c686f1dd97b88877754a5b6ff53cc92350a1d37092526079008ad6c4dffe`
- Frozen aggregate/output hash: `e3376fef5a168f9b407e03afc6152a25520ec89ea4430034e758777ddb7ddc84`

## 39. A/B Reproducibility

Canonical text, cue count, canonical timing, presentation, machine memory, risk decision, and shadow outcome all match. Cross-run CER is `0`; differing cue regions are `0`; boundary median/P95/max are all `0 s`; evaluator determinism passed.

## 40. Dual Freeze Barrier

The barrier records both freeze hashes and verifies runtime identity parity, configuration parity, distinct output directories, distinct caches, distinct memory stores, `bothFrozenBeforeGold = true`, and `goldReadAuthorized = true`.

## 41. Output Freeze

Each freeze manifest covers the package, canonical/presentation identities, final subtitle files, evidence, review material, ASR cache, policy, provenance, and aggregate file identity. Evaluation verified the C6.0 semantic aggregate and did not mutate the frozen output.

## 42. First Gold Read

First Gold read: `2026-08-27T05:48:26.367Z`, 4m 24.775s after the barrier. The first authorized evaluation attempt discovered one ASS timestamp written with a decimal comma. It failed before producing an evaluation and without changing A, B, Gold, thresholds, or generation policy. The evaluator was corrected to normalize that single timestamp in memory, the E2E guard was extended, and evaluation was rerun against the same frozen artifacts.

## 43. Gold Identity

Gold identity matched the expected 17,094-byte SHA-256 and parsed as 192 cues. `timestampNormalizationCount = 1`; normalization was evaluation-local and did not mutate the Gold file. Gold read-only verification passed.

## 44. Evaluation Policy

- Version: `c6.0.1-gold-isolated-evaluation-v1`
- Hash: `5f977ab1a5c3ba24211d9efc49740a8210e2653db7f2c928cb76d5c6b6eb77c5`
- Evaluation model inference: `0`
- Benchmark: `development-known-runtime-blind`

## 45. Evaluation Policy Freeze

The evaluation policy was frozen at `2026-08-27T05:07:38.387Z`, before A/B generation and before Gold access. No Gold-derived threshold or policy change was admitted into this acceptance run.

## 46. Global CER

Run A exact CER = Run B exact CER = `0.8665791776027997`. The high error rate confirms that the frozen machine subtitle is not release-ready.

## 47. Exact Text Metrics

For both runs: machine characters `856`, Gold characters `2,286`, edit distance `1,981`, insert operations `1,457`, delete operations `27`, substitutions `497`, CER `0.8665791776027997`.

## 48. Normalized Text Metrics

For both runs: machine characters `755`, Gold characters `2,048`, edit distance `1,749`, insert operations `1,301`, delete operations `8`, substitutions `440`, normalized CER `0.85400390625`.

## 49. Monotonic Alignment

Each run aligned 51 machine cues to 192 Gold cues through 114 monotonic groups: 47 matched, 67 unmatched Gold groups, and 0 unmatched machine groups.

## 50. Cue Segmentation

Cue counts intentionally differ (machine `51`, Gold `192`). Evaluation uses monotonic grouped alignment rather than requiring one-to-one cue segmentation; no post-Gold resegmentation was performed.

## 51. Timing Metrics

For each run, 47 groups were reliable for timing: start MAE `3.12618203030303 s`, end MAE `2.982985771760152 s`, center MAE `1.5748830190199898 s`, boundary median `2.57 s`, P90 `6.12 s`, P95 `7.57 s`, max `13.02 s`, median timing IoU `0.5386666666666665`. Ratios within 100/250/500/1000 ms were `0.0319 / 0.0957 / 0.1809 / 0.2553`.

## 52. Coverage Metrics

For each run: Gold text coverage `0.65185546875`, machine-supported text ratio `1.0`, and Gold temporal coverage `0.9451278598058696`.

## 53. Missing Dialogue

Each run has 59 missing-dialogue candidates. The generation-side recovery stage examined 67 units, recovered 4, and retained 63 for review.

## 54. Hallucination

Each run has 0 Gold-evaluated hallucination candidates. This does not offset the missing-dialogue and text/timing failures.

## 55. Material Text Errors

Each run has 39 material text errors.

## 56. Severe Timing Errors

Each run has 40 severe timing errors.

## 57. Overlap Evaluation

Machine overlap count is 0 versus Gold overlap count 9; `preservedSimultaneousContent = false`. No automatic overlap-resolution success is claimed.

## 58. Proper Nouns

The evaluator emitted 0 separately classified proper-noun mismatches for each run. This is a taxonomy count, not evidence of global lexical correctness.

## 59. Dialect

The evaluator emitted 0 separately classified dialect mismatches for each run. This likewise does not override the global text-error result.

## 60. P0 Defects

Run A/B: `0 / 0`.

## 61. P1 Defects

Run A/B: `138 / 138`.

## 62. P2 Defects

Run A/B: `7 / 7`.

## 63. Unsafe Finalization Escape

Unsafe finalization escape task count is `0`, and unsafe finalization escape defect count is `0`, because both weak outputs were correctly classified `REVIEW_REQUIRED` rather than `FINAL_CANDIDATE`.

## 64. Unnecessary Review

Unnecessary-review task count is `0`. The Gold defects demonstrate that review was necessary for both tasks.

## 65. Run A Gold Result

Evaluation semantic hash: `e9f1ef468311d0a65ae8c5e20d5130355b491fc451dcbc4ee0937174e799ace5`. Evaluation wall time `322 ms`, inference count `0`, output unchanged, Gold mutation count `0`.

## 66. Run B Gold Result

Evaluation semantic hash: `dc49a3260d4f112660fe81c21184b68b29313dac54c73c08a094274c90e95683`. Metrics match A, evaluation wall time `322 ms`, inference count `0`, output unchanged, Gold mutation count `0`.

## 67. Worst-case Decision

The aggregate decision uses the safety-worst result across both runs. Both were review-required, with no unsafe escape and no unnecessary review. Policy safety and runtime-blind acceptance pass; unseen generalization and release authorization do not.

## 68. Output Hash Before Gold

- A: `d4a71aef3bf070062f06aa1208b516812a7d519b313ac47c2a05c74501225630`
- B: `e3376fef5a168f9b407e03afc6152a25520ec89ea4430034e758777ddb7ddc84`

## 69. Output Hash After Gold

The post-Gold hashes equal their corresponding pre-Gold values exactly. `outputHashUnchangedAfterGold = true` for A and B.

## 70. Gold Mutation Audit

Gold SHA before/after is unchanged, `goldMutationCount = 0`, and `goldIdentity.readOnlyVerified = true`. Decimal-comma timestamp normalization occurred only in evaluator memory.

## 71. Model Execution

Both runs used `/opt/homebrew/bin/whisper-cli`, whisper.cpp `1.9.1`, device identity `metal-Apple-M1-Pro`, and the Apple M1 Pro Metal backend. Model snapshot SHA-256 was `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`. Each run recorded 203 loads and 203 inferences; post-hoc evaluation recorded 0.

## 72. Network

Generation network use, online subtitle search, web subtitle fallback, cloud inference, and evaluation network use were all zero/false.

## 73. Tests

- Schema generation: passed, 149 schemas.
- Typecheck, lint, format check, and build: passed.
- Unit/full test suite: 51 files passed; 568 passed, 2 skipped (570 total).
- Explicit E2E: 13 files passed; 31 passed, 1 skipped (32 total).
- C5.19 targeted: 2 files, 32/32 passed.
- C6.0 Investigation targeted: 4 files, 7/7 passed.
- C6.0 Protected targeted: 4 files, 12/12 passed.
- C6.0.1 targeted: 2 files, 6/6 passed.
- Evaluator replay: deterministic for A and B.

## 74. Schemas

New strict schemas cover blind input manifests, provenance, machine evidence coverage, shadow policy/outcome, freezes/barrier, Gold evaluation, replay, proof, aggregate decision/validation, and shareable audit. Generated schema count is 149; schema validation passed.

## 75. Shareable

Two shareable acceptance summaries were emitted. Audit: artifact count `2`, absolute-path leaks `0`, secrets `0`, Gold-text leaks `0`, broken relative references `0`, passed `true`. Full Gold text is excluded.

## 76. C6.0 Regression

`c60RegressionPassed = true`: legacy default remains unchanged, protected human enforcement remains unchanged, the machine negative control remains gated, and `machineOnlyReleaseAuthorized` remains false.

## 77. Skill 2

Compatibility is `expected-gated`; Skill 2 was not modified.

## 78. Skill 3

Compatibility is `expected-gated`; Skill 3 was not modified.

## 79. Runtime Blind Acceptance

`runtimeBlindAcceptancePassed = true`. The acceptance proves this concrete generation execution was causally Gold-isolated and reproducible.

## 80. Machine Policy Safety

`machinePolicySafetyPassed = true`. The shadow policy saw insufficient evidence/current defects and safely returned `REVIEW_REQUIRED`; unsafe escape counts are zero.

## 81. Why Release Still Not Authorized

`unseenGeneralizationPassed = false`, the episode is development-known, and objective Gold quality is poor. Therefore `machineOnlyReleaseAuthorized = false` even though runtime isolation and policy safety passed.

## 82. C6.0.2 Requirements

C6.0.2 must evaluate at least 3-5 episodes/media never used during current development. Each case must preserve the same pre-Gold dual-freeze barrier, distinct fresh caches/memory, fixed policy and thresholds, first Gold access only after freeze, deterministic replay, mutation audits, unsafe-escape accounting, and worst-case release gating.

## 83. GO / NO-GO C6.0.2

**GO C6.0.2.** `c6_0_2Required = true`; `finalRecommendation = GO_C6_0_2`. This is permission to perform unseen validation, not permission to release machine-only finalization.

## 84. Remaining Risks

Key risks are low text coverage/high CER, missing dialogue, material text errors, severe boundary error, lost overlap content, token-timestamp evidence absence, known-development benchmark bias, and lack of cross-episode/domain evidence.

## 85. Commits

- Isolation implementation: `e02e59c` — `feat: add C6.0.1 blind generation and gold isolation`
- Shadow/evaluator implementation: `ebe6adc` — `feat: add machine shadow finalization and gold evaluation`
- Acceptance/report: recorded by the commit containing this document.

## 86. Remote HEAD

Remote HEAD is verified after the acceptance commit is pushed. The final delivery response records the exact local/remote SHA equality.

## 87. Real Output Paths

- A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-machine-blind-a-20260827`
- B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-machine-blind-b-20260827`
- Evaluation A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-gold-evaluation-a-20260827`
- Evaluation B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-gold-evaluation-b-20260827`
- Combined validation/decision/shareable artifacts: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-blind-acceptance-20260827`

The combined validation semantic hash is `3e1fef2d4b4faeb9734651c00132ab189f7fdd69b5ba8891973c3ce0ff1c777b`; decision semantic hash is `5756781005a83c8f9ba67a3dd1a51ffc9e62a5ef8e25c755180d634ddf5e4eeb`.
