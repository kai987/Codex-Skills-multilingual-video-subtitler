# C6.0.1.11 Paired Evidence & Independent Discriminator Report

## Acceptance outcome

C6.0.1.11 engineering and calibration acceptance passed. The experiment completed paired Whisper evidence, an independently pinned Japanese XLSR CTC scorer, Gold-isolated labels, grouped time-blocked nested cross-validation, feature ablations, deterministic cache replay, and unchanged Final A/B artifacts.

The calibration result is deliberately negative: `AUTOMATIC_PROVIDER_SELECTION_NOT_SUPPORTED`. The best safety-ranked ablation, M5, selected zero Reazon candidates out of fold, realized zero of 166 available Oracle error points, and therefore did not prove useful automatic provider switching. The route is `STOP_AUTOMATIC_PROVIDER_SWITCH_EXPANSION` followed by `MULTI_ASR_REVIEW_ASSISTANCE`.

Production enforcement remains `DISABLED`. Canonical text mutation is 0, Canonical timing mutation is 0, status is `needs-review`, `finalizationMethod = none`, machine-only release is false, and C6.0.2 remains `HOLD`. This acceptance proves the implementation and the negative calibration finding; it does not prove unseen production safety.

## Immutable identity and provenance

- Branch: `codex/c6-0-1-11-paired-evidence-independent-discriminator`
- Exact baseline: `e28a6265d8c8c3f2777f98964dd4ffa94a796c96`
- Policy version: `c6.0.1.11-paired-evidence-independent-discriminator-v1`
- Route/policy artifact hash: `d9cf887d128ebe2ba47307358ba7f768e80bd733bed14368eda1320b8243cb1d`
- Feature schema hash: `2956f92c08792de2b9542bdfed64843964346ca8e424fbaa1ad9b6d67a4ef948`
- Source SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- Gold SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`
- Source and Gold were re-hashed after the run and remained unchanged.
- Episode 1 is explicitly a `CALIBRATION_DATASET`, not an unseen holdout.

## Development commits

1. `c5f4f91` — `feat: complete paired Whisper core evidence for cross-model calibration`
2. `d0c0b34` — `feat: add independent Japanese acoustic-text CTC discriminator`
3. `5417b70` — `feat: build Gold-isolated cross-model calibration features and labels`
4. `cfd8abc` — `feat: add grouped time-blocked selective provider cross-validation`
5. `f57c4b5` — `feat: add feature ablations and prospective discriminator freeze`
6. Acceptance documentation: this report's commit; the final delivery response records its immutable SHA and remote parity.

## Baseline replay and evidence gap

The exact C6.0.1.10 baseline replay passed. It contained 175 holdout events, of which 149 were machine-localizable. The official replay measured 210 available Oracle error points and 0 realized gain under the disabled production profile.

The previous arbitration artifact confirmed the asymmetry that motivated this work: 148/149 events had `Whisper Stability = NOT_RUN`; only 1/149 had real `LEXICAL_CORE_DISAGREEMENT` evidence. Reazon exact/context evidence was already present for every one of the 114 disagreement events. Eight agreement/control events had exact Reazon evidence but intentionally had no context escalation, so full exact-plus-context Reazon coverage is 118/126 over the whole calibration corpus and 114/114 over the disagreement stratum.

## Paired Whisper completion

- Corpus: 126 events = 114 disagreements + 12 controls; all selected before Gold.
- CORE_EXACT: planned 126, actual 126, Fresh 126.
- CORE_CONTEXT: planned 126, actual 126, Fresh 126.
- Total Fresh Whisper inference: 252; model load 1; process start 1.
- Fresh wall clock: 363.610533958 seconds.
- Cache replay: 252/252 cache hits, inference 0, model load 0, process start 0.
- Replay wall clock: 0.283476792 seconds.
- Fresh/replay semantic parity: true.
- Paired Whisper coverage: 126/126 = 1.0.
- Prompt policy: `null-prompt-no-candidate-no-gold-v1`.
- Context policy: `symmetric-one-second-source-context-v1`.

Whisper stability V2 distribution:

| Class                            | Count |
| -------------------------------- | ----: |
| `WHISPER_CORE_STABLE`            |    17 |
| `WHISPER_CONTEXT_EXTENSION_ONLY` |    25 |
| `WHISPER_LEXICALLY_UNSTABLE`     |    72 |
| `WHISPER_HALLUCINATION_UNSTABLE` |     4 |
| `WHISPER_EMPTY_UNSTABLE`         |     0 |
| `WHISPER_PARTIAL_AGREEMENT`      |     8 |
| `WHISPER_UNCOMPARABLE`           |     0 |

Whisper model identity:

- Model: `whisper.cpp/large-v3`
- Model SHA-256: `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`
- Runtime ID: `e2b62f6d45dc3badc49e0b2a8a468a9914f5e018c3692c1fbe6190c443b0b2c2`
- Runtime binary SHA-256: `b5985816a5d38cf498e0f74bbf82ce5d965d2685042f20f57a1385ba4e7de10f`
- Runtime patch SHA-256: `9ae5969381786395c6219d360344eeff0be0ab6083c8c359e32b29b3a586fc97`
- Device/precision: Metal / `f16-metal`

## Independent Japanese acoustic discriminator

The independent verifier is `jonatasgrosman/wav2vec2-large-xlsr-53-japanese`, pinned to revision `cf031e020336460d15a417eba710bbc5bb43be9a`. It scores the Whisper and Reazon text hypotheses against the same event audio; it does not produce a third subtitle candidate and cannot become a winner or a third vote.

Pinned model/runtime identity:

- Model snapshot hash: `b79679cf3c98b21dd1b666c8050e49b87f03372127fcbfed046db9b7387c803e`
- Weight SHA-256: `4f6821dcd79770fcd4c11487c4ee5c040b3a7e1863425224014ba5ea8fbc1b67`
- Config SHA-256: `552b8c8c85c54a761899eb94b5eb3d58166e769df8e26cf515ab9da695772cd7`
- Vocabulary SHA-256: `9ffedf9c2da2617b01c4227a4db875d2dfd4e8c31fb9a13182d03c3280679ffe`
- Preprocessor SHA-256: `c403ce09975b90dff0dd8302c42d422e9de1f166cd7772df23490069893cb0cf`
- Processor SHA-256: `fdd0bf3f47b58d3e3b363a67ab9ee4f94b075d40b5b0f8c4e1c84bee532e28a2`
- Runtime ID: `a0962a8f6993b94b229403dbab4d8a1ed3e5a1a5e52e604159667ba2df4361c8`
- Worker SHA-256: `f5c614950878d36788a69119b3a9ca45e17871a916d09a07a5d3aad882f75c9c`
- Python 3.13.14; PyTorch 2.6.0; Transformers 4.57.6; scikit-learn 1.6.1; NumPy 2.2.2; SciPy 1.15.2.
- Device/precision/sample rate: CPU / FP32 / 16 kHz.
- Bootstrap network: true for the one-time pinned model acquisition; acceptance inference network: false.
- Fresh: 126/126 requests, 126 inference, load 1, process 1, 52.154023035 seconds.
- Replay: 126/126 cache hits, inference 0, load 0, process 0; semantic parity true.

The scorer uses `NORMALIZED_DISPLAY`. Pairwise margin is Whisper NLL-per-target-token minus Reazon NLL-per-target-token; a positive margin favors Reazon. It safely scored 121/126 pairs (96.031746%) and abstained on 5. Outcomes were 61 favors Whisper, 53 favors Reazon, and 7 near ties.

Gold-isolated evaluation produced 62 correct and 33 wrong non-tie preferences: accuracy 0.6526315789, AUC 0.6184615385, and margin/Gold local-error-delta correlation 0.0405938185. The prior correlated CTC had 0 correct and 1 wrong scorable preference. The independent verifier is better than that tiny one-item baseline, but its weak correlation and 33 errors are not adequate for automatic routing.

## Feature and label isolation

The machine feature table contains 29 generic numerical/binary features. It was frozen before Gold and has 0 raw-text features, 0 dataset-specific features, 0 Event-ID semantic features, 0 Gold features, 0 full-data imputation, and 0 full-data standardization. Runtime Gold input is 0.

After the machine feature and fold freezes, local Gold evaluation created labels without including the full Gold transcript:

- Reazon better: 32
- Whisper better: 67
- Equivalent: 22
- Unevaluable: 5
- Available Oracle gain: 166
- `fullGoldTextIncluded`: false

Whisper stability distributions overlapped heavily between the two directional labels. Reazon-better events contained stable 5, context-only 6, lexical-unstable 20, and hallucination-unstable 1. Whisper-better events contained stable 6, context-only 16, lexical-unstable 36, hallucination-unstable 2, and partial-agreement 7. M1 performed identically to M0, so this stability signal did not yield a practically predictive separation in the current calibration set.

## Fold construction and leakage audit

Five folds were built before labels by overlap-connected audio components followed by contiguous time blocks. No random split was used. Fold sizes were 22, 34, 20, 28, and 22. Duplicate events, train/test overlapping audio, raw-text features, dataset-specific features, Gold features, fold label inputs, and full-data preprocessing leaks were all 0. The data-quality audit passed.

Each outer fold used nested threshold calibration without consulting outer-test labels. All 126 events have out-of-fold predictions and no in-sample prediction was used as acceptance evidence.

## Feature ablations and OOF result

| Model | Feature interpretation                 | Selected | Correct | Wrong | Precision |  Harm |    Coverage | Gain | Oracle capture |
| ----- | -------------------------------------- | -------: | ------: | ----: | --------: | ----: | ----------: | ---: | -------------: |
| M0    | Existing C6.0.1.10 evidence            |        1 |       0 |     1 |         0 |     1 | 0.008771930 |   -6 |   -0.036144578 |
| M1    | M0 + paired Whisper stability          |        1 |       0 |     1 |         0 |     1 | 0.008771930 |   -6 |   -0.036144578 |
| M2    | M0 + independent acoustic evidence     |        1 |       0 |     1 |         0 |     1 | 0.008771930 |   -6 |   -0.036144578 |
| M3    | Combined old, paired, independent      |        3 |       1 |     2 | 0.3333333 | 0.667 | 0.026315789 |    1 |    0.006024096 |
| M4    | Combined without correlated legacy CTC |        2 |       1 |     1 |       0.5 |   0.5 | 0.017543860 |    7 |    0.042168675 |
| M5    | Independent verifier only              |        0 |       0 |     0 |       N/A |     0 |           0 |    0 |              0 |

M5 is the best safety-ranked feature set and uses L2 logistic regression, but it proves only safe abstention, not useful selection. Its five fold gains are all 0; negative-gain folds are 0 and zero-harm folds are 5. Aggregate precision and Wilson bounds are undefined because it selected zero candidates. The only selected-model substantive coefficient is independent margin = 0.0375485238. Whisper stability, Reazon stability, and cross-model distance coefficients are not part of M5 and are therefore not reported as if they contributed.

Error-slice evaluation confirms zero selection and zero gain in every slice: Reazon stable 10, Reazon unstable 88, Whisper stable 17, Whisper unstable 72, hallucination-risk 2, short-duration 29, and long-duration 34.

## Production parity and quality gate

Final A and Final B exactly match the baseline ASS, SRT, and VTT outputs. Production hashes remain:

- Canonical text: `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e`
- Canonical timing: `b4c5eaae50284455e502aa2bdcae38a3dd4df9c4622397af86e3790463d00e86`
- Presentation: `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7`
- Normal ASS: `594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7`
- Best-effort ASS: `a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03`
- Normal SRT: `faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd`
- Best-effort SRT: `4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01`
- Normal VTT: `107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a`
- Best-effort VTT: `249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7`

The unchanged, hash-anchored quality metrics remain below the C6.0.2 release gate:

| Metric             |       Result |
| ------------------ | -----------: |
| Exact CER          | 0.6601049869 |
| Normalized CER     |    0.6015625 |
| Coverage           |   0.96484375 |
| Missing            |            6 |
| Hallucination      |            1 |
| Material errors    |           77 |
| Severe timing      |           53 |
| Start MAE          | 1.6091082275 |
| End MAE            | 1.6078355157 |
| P95 boundary error |        5.385 |
| Median IoU         | 0.5824665676 |
| Overlap count      |           48 |

## Privacy, hardcoding, and shareability

- Runtime Gold inputs: 0.
- Dataset-specific literal/hardcoding findings in production machine source: 0.
- Inference/calibration network use: false; the pinned independent model's one-time bootstrap is recorded separately.
- Source and Gold read-only hashes: verified unchanged.
- Gold label artifact contains no full Gold transcript.
- Audited shareable surface: 13 primary artifact directories plus the `shareable/` subdirectories of Final A and Final B; 41 input files.
- Private absolute-path leaks: 0; secret leaks: 0; raw media files: 0; broken symlinks: 0.
- Full Final A/B run trees are local diagnostics, not represented as shareable bundles.
- Skill 2 and Skill 3 changed files: 0.

## Engineering verification

- Node 24 / npm 11.18.0.
- Schema generation: 299 JSON Schemas.
- Typecheck: passed.
- ESLint: passed.
- Prettier: passed.
- Build: passed.
- Full unit/integration suite: 102 files; 736 passed, 2 skipped.
- Full E2E suite: 24 files; 43 passed, 1 skipped.
- Prior C5.19 through C6.0.1.10 targeted regression: 31 files; 165/165 passed.
- C6 Investigation and Protected targeted regression: 16 files; 46/46 passed.
- C6.0.1.11 targeted tests: 6 files; 19/19 passed.
- Standalone artifact/schema validator: 21/21 passed.
- Multilingual Video Subtitler Skill validation: passed.

## Required report coverage (1–150)

|   # | Topic                                     | Recorded result                                                                           |
| --: | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
|   1 | Executive Conclusion                      | Engineering passed; automatic provider selection unsupported.                             |
|   2 | Branch                                    | `codex/c6-0-1-11-paired-evidence-independent-discriminator`                               |
|   3 | Baseline                                  | `e28a6265d8c8c3f2777f98964dd4ffa94a796c96`                                                |
|   4 | C6.0.1.10 Replay                          | Passed; 175 holdout, 149 localizable, Oracle 210, realized 0.                             |
|   5 | Goals                                     | Complete paired evidence, independent scoring, and Gold-isolated OOF calibration.         |
|   6 | Non-goals                                 | No Production mutation, third ASR, LLM judge, or timing rule.                             |
|   7 | Why Rule Calibration Failed               | Existing evidence was asymmetric and did not reliably separate provider wins.             |
|   8 | Whisper Stability Evidence Gap            | 148 `NOT_RUN`; 1 real result.                                                             |
|   9 | Holdout NOT_RUN Count                     | 148                                                                                       |
|  10 | Calibration Corpus Design                 | 126 machine-selected events.                                                              |
|  11 | Machine-only Selection                    | Gold seen at selection: false; runtime Gold input 0.                                      |
|  12 | Control Selection                         | 12 controls plus 114 disagreements.                                                       |
|  13 | Paired Whisper Architecture               | Exact and symmetric context for every corpus event.                                       |
|  14 | Whisper Core Exact                        | 126 planned/actual/Fresh.                                                                 |
|  15 | Whisper Core Context                      | 126 planned/actual/Fresh.                                                                 |
|  16 | Prompt Isolation                          | Null prompt; no current/Reazon/Gold text.                                                 |
|  17 | Whisper Fresh Inference                   | 252; load 1; 363.610533958 s.                                                             |
|  18 | Whisper Verified Cache Replay             | 252/252 hits; inference/load 0; parity true.                                              |
|  19 | Paired Whisper Coverage                   | 126/126 = 1.0.                                                                            |
|  20 | Whisper Stability V2                      | Seven-class deterministic classification.                                                 |
|  21 | Whisper Stable Count                      | 17                                                                                        |
|  22 | Whisper Context-only Count                | 25                                                                                        |
|  23 | Whisper Lexically Unstable Count          | 72                                                                                        |
|  24 | Whisper Hallucination-unstable Count      | 4                                                                                         |
|  25 | Reazon Paired Evidence                    | 118/126 overall exact+context; 114/114 disagreement events.                               |
|  26 | Symmetric Evidence Coverage               | 93.650794% overall; 100% for the disagreement stratum.                                    |
|  27 | Why Existing CTC Is Correlated            | It shares the ReazonSpeech family and cannot be an independent vote.                      |
|  28 | Independent Verifier Selection            | Pinned Japanese XLSR CTC scorer.                                                          |
|  29 | Independent Model Revision                | `cf031e020336460d15a417eba710bbc5bb43be9a`                                                |
|  30 | Independent Model Hashes                  | Snapshot/weight/config/vocab/processor recorded above.                                    |
|  31 | Runtime Identity                          | `a0962a8f6993b94b229403dbab4d8a1ed3e5a1a5e52e604159667ba2df4361c8`                        |
|  32 | Bootstrap                                 | One-time model bootstrap network true, separately audited.                                |
|  33 | Offline Acceptance                        | Inference network false; replay 126/126.                                                  |
|  34 | Candidate-conditioned CTC Design          | Scores two hypotheses; does not transcribe or vote.                                       |
|  35 | Text Representation                       | `NORMALIZED_DISPLAY`.                                                                     |
|  36 | Vocabulary Coverage                       | 121 scorable of 126; coverage 0.9603174603.                                               |
|  37 | Scorable Count                            | 121                                                                                       |
|  38 | Unscorable Count                          | 5                                                                                         |
|  39 | Independent Margin                        | Whisper NLL/token minus Reazon NLL/token.                                                 |
|  40 | Preference Accuracy                       | 0.6526315789; AUC 0.6184615385.                                                           |
|  41 | Current CTC Preference Accuracy           | 0/1 = 0.                                                                                  |
|  42 | Independent vs Current CTC                | Better on observed evidence, but not safe enough for routing.                             |
|  43 | Feature Schema                            | 29 features; hash `2956f92c...`.                                                          |
|  44 | Gold-free Feature Freeze                  | Frozen before Gold: true.                                                                 |
|  45 | No-text Feature Audit                     | Raw text, dataset-specific, Event-ID, and Gold features all 0.                            |
|  46 | Calibration Label Design                  | Local Gold error only, evaluation-only, no full transcript.                               |
|  47 | Reazon Better Count                       | 32                                                                                        |
|  48 | Whisper Better Count                      | 67                                                                                        |
|  49 | Equivalent Count                          | 22                                                                                        |
|  50 | Unevaluable Count                         | 5                                                                                         |
|  51 | Timeline Grouping                         | Overlap components followed by contiguous time blocks.                                    |
|  52 | Fold Design                               | 5 folds: 22/34/20/28/22.                                                                  |
|  53 | Leakage Audit                             | Passed; all leak counts 0.                                                                |
|  54 | Fold 1                                    | M5: selected 0, gain 0, Oracle 13.                                                        |
|  55 | Fold 2                                    | M5: selected 0, gain 0, Oracle 40.                                                        |
|  56 | Fold 3                                    | M5: selected 0, gain 0, Oracle 52.                                                        |
|  57 | Fold 4                                    | M5: selected 0, gain 0, Oracle 41.                                                        |
|  58 | Fold 5                                    | M5: selected 0, gain 0, Oracle 20.                                                        |
|  59 | Nested Threshold Calibration              | True; outer test labels excluded.                                                         |
|  60 | OOF Predictions                           | 126, all genuinely out of fold.                                                           |
|  61 | Select Reazon Count                       | 0                                                                                         |
|  62 | Correct Override                          | 0                                                                                         |
|  63 | Wrong Override                            | 0                                                                                         |
|  64 | Neutral Override                          | 0                                                                                         |
|  65 | Selective Precision                       | N/A because no selection.                                                                 |
|  66 | Wilson CI                                 | N/A / N/A.                                                                                |
|  67 | Harm Rate                                 | 0                                                                                         |
|  68 | Selective Coverage                        | 0                                                                                         |
|  69 | Realized Gain                             | 0                                                                                         |
|  70 | Available Oracle Gain                     | 166                                                                                       |
|  71 | Oracle Capture                            | 0                                                                                         |
|  72 | Fold Consistency                          | All five safely abstain, but provide no utility.                                          |
|  73 | Negative Fold Count                       | 0                                                                                         |
|  74 | M0 Baseline                               | 1 selected, 0 correct, 1 wrong, gain -6.                                                  |
|  75 | M1 Paired Whisper                         | Same as M0; paired stability did not improve selection.                                   |
|  76 | M2 Independent CTC                        | Same as M0.                                                                               |
|  77 | M3 Combined                               | 3 selected, 1 correct, 2 wrong, gain 1.                                                   |
|  78 | M4 Without Old CTC                        | 2 selected, 1 correct, 1 wrong, gain 7.                                                   |
|  79 | M5 Verifier-only                          | 0 selected, 0 harm, 0 gain.                                                               |
|  80 | Best Feature Set                          | M5 by abstention-first safety ranking.                                                    |
|  81 | Coefficient Audit                         | Selected model exposes only independent-verifier terms.                                   |
|  82 | Independent Margin Contribution           | Coefficient 0.0375485238.                                                                 |
|  83 | Whisper Stability Contribution            | N/A in M5; M1 did not improve M0.                                                         |
|  84 | Reazon Stability Contribution             | N/A in M5.                                                                                |
|  85 | Cross-model Distance Contribution         | N/A in M5.                                                                                |
|  86 | Error Slice Evaluation                    | All slices selected 0 and gained 0.                                                       |
|  87 | Reazon Stable Slice                       | 10 events, 0 selected.                                                                    |
|  88 | Reazon Unstable Slice                     | 88 events, 0 selected.                                                                    |
|  89 | Whisper Stable Slice                      | 17 events, 0 selected.                                                                    |
|  90 | Whisper Unstable Slice                    | 72 events, 0 selected.                                                                    |
|  91 | Hallucination Slice                       | 2 events, 0 selected.                                                                     |
|  92 | Duration Slice                            | Short 29; long 34; both selected 0.                                                       |
|  93 | Data Quality                              | Passed.                                                                                   |
|  94 | Duplicate/Overlap Audit                   | Duplicate 0; cross-fold audio overlap 0.                                                  |
|  95 | Calibration Result                        | `AUTOMATIC_PROVIDER_SELECTION_NOT_SUPPORTED`.                                             |
|  96 | Strong Pass?                              | False.                                                                                    |
|  97 | Promising?                                | False.                                                                                    |
|  98 | Automatic Provider Selection Unsupported? | True.                                                                                     |
|  99 | Frozen Discriminator                      | Not created.                                                                              |
| 100 | Frozen Threshold                          | Null.                                                                                     |
| 101 | Prospective Route                         | `MULTI_ASR_REVIEW_ASSISTANCE`.                                                            |
| 102 | Production Enforcement                    | `DISABLED`.                                                                               |
| 103 | Production Text Mutation                  | 0.                                                                                        |
| 104 | Production Timing Mutation                | 0.                                                                                        |
| 105 | Final Exact CER                           | 0.6601049869.                                                                             |
| 106 | Final Normalized CER                      | 0.6015625.                                                                                |
| 107 | Coverage                                  | 0.96484375.                                                                               |
| 108 | Missing                                   | 6.                                                                                        |
| 109 | Hallucination                             | 1.                                                                                        |
| 110 | Material Errors                           | 77.                                                                                       |
| 111 | Severe Timing                             | 53.                                                                                       |
| 112 | Start MAE                                 | 1.6091082275 s.                                                                           |
| 113 | End MAE                                   | 1.6078355157 s.                                                                           |
| 114 | P95                                       | 5.385 s.                                                                                  |
| 115 | IoU                                       | 0.5824665676 median.                                                                      |
| 116 | Overlap                                   | 48.                                                                                       |
| 117 | Production Status                         | `needs-review`; `finalizationMethod = none`.                                              |
| 118 | Machine Release Authorized                | False.                                                                                    |
| 119 | C6.0.2 Status                             | `HOLD`.                                                                                   |
| 120 | Runtime Gold Input                        | 0.                                                                                        |
| 121 | Dataset Hardcoding                        | 0 production findings.                                                                    |
| 122 | Network                                   | Inference false; bootstrap true and isolated.                                             |
| 123 | Source Read-only                          | Verified; SHA unchanged.                                                                  |
| 124 | Gold Read-only                            | Verified; SHA unchanged.                                                                  |
| 125 | Shareable                                 | Scoped audit passed: 15 surfaces, 41 inputs, 0 leaks/media/secrets.                       |
| 126 | C5.19 Regression                          | Passed in targeted regression set.                                                        |
| 127 | C6 Investigation Regression               | Passed.                                                                                   |
| 128 | C6 Protected Regression                   | Passed.                                                                                   |
| 129 | C6.0.1 Regression                         | Passed.                                                                                   |
| 130 | C6.0.1.1 Regression                       | Passed.                                                                                   |
| 131 | C6.0.1.2 Regression                       | Passed.                                                                                   |
| 132 | C6.0.1.3 Regression                       | Passed.                                                                                   |
| 133 | C6.0.1.4 Regression                       | Passed.                                                                                   |
| 134 | C6.0.1.5 Regression                       | Passed.                                                                                   |
| 135 | C6.0.1.6 Regression                       | Passed.                                                                                   |
| 136 | C6.0.1.7 Regression                       | Passed.                                                                                   |
| 137 | C6.0.1.8 Regression                       | Passed.                                                                                   |
| 138 | C6.0.1.9 Regression                       | Passed.                                                                                   |
| 139 | C6.0.1.10 Regression                      | Passed.                                                                                   |
| 140 | Unit Tests                                | 102 files; 736 passed, 2 skipped.                                                         |
| 141 | E2E                                       | 24 files; 43 passed, 1 skipped.                                                           |
| 142 | Targeted Tests                            | Current 19/19; prior 165/165; investigation/protected 46/46.                              |
| 143 | Schema Count                              | 299 generated.                                                                            |
| 144 | Skill Validation                          | Passed.                                                                                   |
| 145 | Skill2/3                                  | 0 changed files.                                                                          |
| 146 | Remaining Risks                           | Single reused calibration episode, weak discriminator correlation, zero useful selection. |
| 147 | Next-stage Recommendation                 | Stop automatic switching expansion; use Multi-ASR review assistance.                      |
| 148 | Commits                                   | Five implementation commits plus this documentation commit.                               |
| 149 | Remote HEAD                               | Verified equal to local after the documentation push; immutable SHA is in final response. |
| 150 | Output Paths                              | Fifteen `output/carnation-c6-0-1-11-*-20260829` directories listed below.                 |

## Required delivery ledger (1–150)

|   # | Item                                          | Result                                                                          |
| --: | --------------------------------------------- | ------------------------------------------------------------------------------- |
|   1 | Branch                                        | `codex/c6-0-1-11-paired-evidence-independent-discriminator`                     |
|   2 | Baseline                                      | `e28a6265d8c8c3f2777f98964dd4ffa94a796c96`                                      |
|   3 | Paired Whisper Commit                         | `c5f4f91`                                                                       |
|   4 | Independent Verifier Commit                   | `d0c0b34`                                                                       |
|   5 | Calibration Data Commit                       | `5417b70`                                                                       |
|   6 | Cross-validation Commit                       | `cfd8abc`                                                                       |
|   7 | Freeze/Route Commit                           | `f57c4b5`                                                                       |
|   8 | Acceptance Commit                             | This report's commit; immutable SHA in final response.                          |
|   9 | Remote HEAD                                   | Must equal item 8; verified after push in final response.                       |
|  10 | Policy Version                                | `c6.0.1.11-paired-evidence-independent-discriminator-v1`                        |
|  11 | Policy Hash                                   | `d9cf887d128ebe2ba47307358ba7f768e80bd733bed14368eda1320b8243cb1d`              |
|  12 | Baseline Replay Passed                        | Yes.                                                                            |
|  13 | Baseline Production Profile                   | `DISABLED`.                                                                     |
|  14 | Baseline Available Oracle Gain                | 210.                                                                            |
|  15 | Baseline Realized Gain                        | 0.                                                                              |
|  16 | Holdout Event Count                           | 175.                                                                            |
|  17 | Machine-localizable Count                     | 149.                                                                            |
|  18 | Baseline Whisper Stability NOT_RUN Count      | 148.                                                                            |
|  19 | Baseline Real Whisper Stability Count         | 1.                                                                              |
|  20 | Calibration Corpus Event Count                | 126.                                                                            |
|  21 | Calibration Disagreement Count                | 114.                                                                            |
|  22 | Calibration Control Count                     | 12.                                                                             |
|  23 | Whisper Core Exact Planned                    | 126.                                                                            |
|  24 | Whisper Core Exact Actual                     | 126.                                                                            |
|  25 | Whisper Core Exact Fresh                      | 126.                                                                            |
|  26 | Whisper Core Exact Cache Replay               | 126.                                                                            |
|  27 | Whisper Core Context Planned                  | 126.                                                                            |
|  28 | Whisper Core Context Actual                   | 126.                                                                            |
|  29 | Whisper Core Context Fresh                    | 126.                                                                            |
|  30 | Whisper Core Context Cache Replay             | 126.                                                                            |
|  31 | Paired Whisper Evidence Coverage              | 126/126 = 1.0.                                                                  |
|  32 | Whisper Core Stable Count                     | 17.                                                                             |
|  33 | Whisper Context-extension-only Count          | 25.                                                                             |
|  34 | Whisper Lexically Unstable Count              | 72.                                                                             |
|  35 | Whisper Hallucination-unstable Count          | 4.                                                                              |
|  36 | Whisper Partial-agreement Count               | 8.                                                                              |
|  37 | Whisper Uncomparable Count                    | 0.                                                                              |
|  38 | Reazon Paired Evidence Coverage               | 118/126 = 0.9365079365 overall; 114/114 disagreements.                          |
|  39 | Symmetric Model Evidence Coverage             | 118/126 overall; 114/114 disagreement events.                                   |
|  40 | Independent Verifier Model ID                 | `jonatasgrosman/wav2vec2-large-xlsr-53-japanese`                                |
|  41 | Independent Model Revision                    | `cf031e020336460d15a417eba710bbc5bb43be9a`                                      |
|  42 | Independent Model Weight SHA                  | `4f6821dcd79770fcd4c11487c4ee5c040b3a7e1863425224014ba5ea8fbc1b67`              |
|  43 | Independent Vocab SHA                         | `9ffedf9c2da2617b01c4227a4db875d2dfd4e8c31fb9a13182d03c3280679ffe`              |
|  44 | Independent Processor SHA                     | `fdd0bf3f47b58d3e3b363a67ab9ee4f94b075d40b5b0f8c4e1c84bee532e28a2`              |
|  45 | Torch Version                                 | 2.6.0.                                                                          |
|  46 | Transformers Version                          | 4.57.6.                                                                         |
|  47 | Device                                        | CPU.                                                                            |
|  48 | Precision                                     | FP32.                                                                           |
|  49 | Sample Rate                                   | 16,000 Hz.                                                                      |
|  50 | Verifier Requests                             | 126.                                                                            |
|  51 | Verifier Fresh Inferences                     | 126.                                                                            |
|  52 | Verifier Cache Hits                           | 126 on replay.                                                                  |
|  53 | Verifier Model Loads                          | Fresh 1; replay 0.                                                              |
|  54 | Verifier Runtime                              | Fresh 52.154023035 s; replay 0 s recorded.                                      |
|  55 | Pairwise Scorable Count                       | 121.                                                                            |
|  56 | Pairwise Unscorable Count                     | 5.                                                                              |
|  57 | Pairwise Scorable Coverage                    | 0.9603174603.                                                                   |
|  58 | Independent Favors Whisper                    | 61.                                                                             |
|  59 | Independent Favors Reazon                     | 53.                                                                             |
|  60 | Independent Near Tie                          | 7.                                                                              |
|  61 | Independent Correct Preference                | 62.                                                                             |
|  62 | Independent Wrong Preference                  | 33.                                                                             |
|  63 | Independent Preference Accuracy               | 0.6526315789.                                                                   |
|  64 | Independent Preference AUC                    | 0.6184615385.                                                                   |
|  65 | Independent Margin/Gold Delta Correlation     | 0.0405938185.                                                                   |
|  66 | Current CTC Correct Preference                | 0.                                                                              |
|  67 | Current CTC Wrong Preference                  | 1.                                                                              |
|  68 | Current CTC Accuracy                          | 0.                                                                              |
|  69 | Independent Verifier Better Than Current CTC? | Yes on observed preference evidence, with a tiny current-CTC denominator.       |
|  70 | Feature Count                                 | 29.                                                                             |
|  71 | Raw Text Feature Count                        | 0.                                                                              |
|  72 | Dataset-specific Feature Count                | 0.                                                                              |
|  73 | Gold in Machine Features Count                | 0.                                                                              |
|  74 | Reazon Better Labels                          | 32.                                                                             |
|  75 | Whisper Better Labels                         | 67.                                                                             |
|  76 | Equivalent Labels                             | 22.                                                                             |
|  77 | Unevaluable Labels                            | 5.                                                                              |
|  78 | Fold Count                                    | 5.                                                                              |
|  79 | Fold Construction Frozen Before Labels        | True.                                                                           |
|  80 | Leakage Audit Passed                          | True.                                                                           |
|  81 | Overlapping Audio Across Train/Test Count     | 0.                                                                              |
|  82 | M0 Selected Count                             | 1.                                                                              |
|  83 | M0 Correct                                    | 0.                                                                              |
|  84 | M0 Wrong                                      | 1.                                                                              |
|  85 | M0 Precision                                  | 0.                                                                              |
|  86 | M0 Gain                                       | -6.                                                                             |
|  87 | M1 Selected                                   | 1.                                                                              |
|  88 | M1 Correct                                    | 0.                                                                              |
|  89 | M1 Wrong                                      | 1.                                                                              |
|  90 | M1 Precision                                  | 0.                                                                              |
|  91 | M1 Gain                                       | -6.                                                                             |
|  92 | M2 Selected                                   | 1.                                                                              |
|  93 | M2 Correct                                    | 0.                                                                              |
|  94 | M2 Wrong                                      | 1.                                                                              |
|  95 | M2 Precision                                  | 0.                                                                              |
|  96 | M2 Gain                                       | -6.                                                                             |
|  97 | M3 Selected                                   | 3.                                                                              |
|  98 | M3 Correct                                    | 1.                                                                              |
|  99 | M3 Wrong                                      | 2.                                                                              |
| 100 | M3 Precision                                  | 0.3333333333.                                                                   |
| 101 | M3 Gain                                       | 1.                                                                              |
| 102 | M4 Selected                                   | 2.                                                                              |
| 103 | M4 Correct                                    | 1.                                                                              |
| 104 | M4 Wrong                                      | 1.                                                                              |
| 105 | M4 Precision                                  | 0.5.                                                                            |
| 106 | M4 Gain                                       | 7.                                                                              |
| 107 | Best Feature Set                              | M5, independent verifier only.                                                  |
| 108 | Best Model Type                               | `L2_LOGISTIC_REGRESSION`.                                                       |
| 109 | OOF SELECT_REAZON Count                       | 0.                                                                              |
| 110 | OOF Correct Override                          | 0.                                                                              |
| 111 | OOF Wrong Override                            | 0.                                                                              |
| 112 | OOF Neutral Override                          | 0.                                                                              |
| 113 | OOF Selective Precision                       | N/A.                                                                            |
| 114 | OOF Precision Wilson Lower                    | N/A.                                                                            |
| 115 | OOF Precision Wilson Upper                    | N/A.                                                                            |
| 116 | OOF Harm Rate                                 | 0.                                                                              |
| 117 | OOF Selective Coverage                        | 0.                                                                              |
| 118 | OOF Realized Gain                             | 0.                                                                              |
| 119 | OOF Available Oracle Gain                     | 166.                                                                            |
| 120 | OOF Oracle Capture Rate                       | 0.                                                                              |
| 121 | Fold 1 Gain                                   | 0.                                                                              |
| 122 | Fold 2 Gain                                   | 0.                                                                              |
| 123 | Fold 3 Gain                                   | 0.                                                                              |
| 124 | Fold 4 Gain                                   | 0.                                                                              |
| 125 | Fold 5 Gain                                   | 0.                                                                              |
| 126 | Negative-gain Fold Count                      | 0.                                                                              |
| 127 | Zero-harm Fold Count                          | 5.                                                                              |
| 128 | Independent Margin Coefficient                | 0.0375485238.                                                                   |
| 129 | Whisper Stability Coefficient Summary         | N/A in selected M5; M1 did not improve M0.                                      |
| 130 | Reazon Stability Coefficient Summary          | N/A in selected M5.                                                             |
| 131 | Cross-model Distance Coefficient Summary      | N/A in selected M5.                                                             |
| 132 | Data Quality Passed                           | True.                                                                           |
| 133 | Calibration Strong Pass                       | False.                                                                          |
| 134 | Calibration Promising                         | False.                                                                          |
| 135 | Automatic Provider Selection Supported?       | False.                                                                          |
| 136 | Frozen Discriminator Created?                 | False.                                                                          |
| 137 | Frozen Model Type                             | Null.                                                                           |
| 138 | Frozen Threshold                              | Null.                                                                           |
| 139 | Frozen Feature Schema Hash                    | `2956f92c08792de2b9542bdfed64843964346ca8e424fbaa1ad9b6d67a4ef948`              |
| 140 | Prospective Route Decision                    | `MULTI_ASR_REVIEW_ASSISTANCE`; stop automatic provider switching expansion.     |
| 141 | Production Canonical Text Mutation            | 0.                                                                              |
| 142 | Production Canonical Timing Mutation          | 0.                                                                              |
| 143 | Final ASS/SRT/VTT Baseline Parity             | True for Final A and Final B.                                                   |
| 144 | Production Status                             | `needs-review`; `finalizationMethod = none`.                                    |
| 145 | Machine Release Authorized                    | False.                                                                          |
| 146 | C6.0.2 GO/HOLD                                | `HOLD`.                                                                         |
| 147 | Runtime Gold / Hardcoding / Network           | 0 / 0 / inference false; bootstrap separately true.                             |
| 148 | Tests / Schemas / Regressions                 | All required checks passed; 299 schemas.                                        |
| 149 | Report / Output Paths                         | This report plus the fifteen output directories below.                          |
| 150 | Worktree Status                               | Clean after documentation commit and push; final response verifies exact state. |

## Required Q1–Q20 answers

1. **Q1 — How many C6.0.1.10 holdout events truly lacked Whisper stability evidence?** 148 of 149 were `NOT_RUN`; only 1 had a real stability result.
2. **Q2 — What is paired Whisper coverage after completion?** 126/126 = 1.0.
3. **Q3 — How many events are stable/context-only/lexically unstable/hallucination-unstable?** 17 / 25 / 72 / 4; additionally 8 partial, 0 empty, and 0 uncomparable.
4. **Q4 — Is there a genuinely predictive Whisper-stability difference between Reazon-better and Whisper-better events?** No useful separation was demonstrated. The distributions overlap heavily and M1 exactly matches M0: 1 selection, 0 correct, 1 wrong, gain -6.
5. **Q5 — How many candidate pairs can independent XLSR safely score?** 121/126; 5 abstentions.
6. **Q6 — What is pairwise preference accuracy?** 62 correct / 33 wrong = 0.6526315789, with AUC 0.6184615385.
7. **Q7 — Is it clearly better than the current ReazonSpeech-family CTC?** It is better on observed preference evidence than the old 0/1 result, but the old denominator is one and the new signal is not strong enough for routing.
8. **Q8 — Does independent acoustic margin have stable Gold-error correlation?** No. Correlation is only 0.0405938185.
9. **Q9 — How does M0 perform?** 1 selection, 0 correct, 1 wrong, precision 0, harm 1, gain -6.
10. **Q10 — Does adding paired Whisper evidence in M1 improve precision?** No; M1 is identical to M0.
11. **Q11 — Do M2/M3 improve after adding independent margin?** M2 does not; M3 finds 1 correct but also 2 wrong, precision 0.3333 and harm 0.6667, so it is unsafe.
12. **Q12 — What happens when correlated old CTC is removed in M4?** It improves relative to M3: 2 selections, 1 correct, 1 wrong, precision 0.5, gain 7, but remains unsafe.
13. **Q13 — How many Reazon candidates does the best OOF classifier select?** 0.
14. **Q14 — Correct/wrong/neutral overrides?** 0 / 0 / 0.
15. **Q15 — Precision, harm rate, selective coverage?** Precision N/A, harm 0, coverage 0.
16. **Q16 — Are five folds consistent; did one fail?** All five M5 folds consistently abstain with gain 0 and harm 0. No fold regresses, but none proves useful selection.
17. **Q17 — Does it meet `SELECTIVE_CALIBRATION_STRONG_PASS`?** No.
18. **Q18 — Should a selective discriminator be frozen for C6.0.1.12 prospective validation?** No; no discriminator or threshold was frozen.
19. **Q19 — Should automatic provider switching stop in favor of Multi-ASR Review Assistance?** Yes. The route explicitly stops automatic switching expansion and recommends review assistance.
20. **Q20 — Must Production remain needs-review / none / false / HOLD?** Yes: `needs-review`, `finalizationMethod = none`, `machineOnlyReleaseAuthorized = false`, C6.0.2 `HOLD`.

## Output directories

All paths below are repository-workspace relative and intentionally omit the private local home prefix:

1. `output/carnation-c6-0-1-11-baseline-20260829`
2. `output/carnation-c6-0-1-11-calibration-corpus-20260829`
3. `output/carnation-c6-0-1-11-paired-whisper-20260829`
4. `output/carnation-c6-0-1-11-independent-verifier-runtime-20260829`
5. `output/carnation-c6-0-1-11-independent-acoustic-scores-20260829`
6. `output/carnation-c6-0-1-11-feature-table-20260829`
7. `output/carnation-c6-0-1-11-calibration-labels-20260829`
8. `output/carnation-c6-0-1-11-folds-20260829`
9. `output/carnation-c6-0-1-11-cv-20260829`
10. `output/carnation-c6-0-1-11-feature-ablation-20260829`
11. `output/carnation-c6-0-1-11-discriminator-freeze-20260829`
12. `output/carnation-c6-0-1-11-route-decision-20260829`
13. `output/carnation-c6-0-1-11-final-a-20260829`
14. `output/carnation-c6-0-1-11-final-b-20260829`
15. `output/carnation-c6-0-1-11-validation-20260829`

## Final recommendation

Do not add another provider-selection rule or enable Production. Preserve the completed paired and independent evidence as review support, stop automatic provider-switch expansion, and design the next work around Multi-ASR Review Assistance using genuinely independent episodes. The unchanged subtitle remains a quality-gated `needs-review` artifact.
