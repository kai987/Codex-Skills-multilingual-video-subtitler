# C6.0.1.9 Independent Japanese ASR Baseline & Cross-Model Complementarity Validation

Date: 2026-08-29

Policy: `c6.0.1.9-independent-asr-complementarity-v1`

Policy SHA-256: `cb09afe6d60dac89dbea76896b0b52de49348016e44e85a8166ef58369762db7`

## Executive conclusion

C6.0.1.9 engineering acceptance and development-set complementarity diagnosis passed. A pinned, local ReazonSpeech K2 V2 runtime performed 48 genuine offline CPU inferences over a machine-frozen set of 12 C6.0.1.8 targets and 12 machine-only low-risk controls. Each event received one `CORE_EXACT` and one `CORE_CONTEXT` request. Gold was unavailable to diagnostic selection, extraction, ASR, normalization, stability analysis, cross-model comparison, and CTC observation; runtime Gold input is 0.

The result is `SECOND_ASR_COMPLEMENTARITY_CONFIRMED` and the next-stage route is `GO_C6_0_1_10_CROSS_MODEL_ARBITRATION` with `MEDIUM` confidence. Across 22 Gold-evaluable target/control events, adding Reazon candidates reduced the Whisper-only oracle error from 275 to 253: an absolute gain of 22, relative gain of 8%, and 7 improved events. Two of the 9 evaluable baseline-wrong target events gained a lower-error candidate unavailable in the frozen Whisper pool. One control event had a Reazon-only correct candidate. This is independent information gain, but it is not a safe direct-replacement policy.

The safety evidence is equally important. Reazon was lexically unstable between exact and context windows on 9/24 events, although it produced no empty output and no hallucination-instability classification. Blindly selecting Reazon would regress 4/12 low-risk controls. The correlated Reazon-family CTC verifier chose the Gold-posthoc better candidate only 3 of 7 times when it made a decisive preference (42.86%); it is useful only as a weak, calibrated feature, not an independent vote or winner.

Production is intentionally unchanged: 161 cues, exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, 6 missing, 1 hallucination, 77 material errors, 53 severe timing errors, start/end MAE `1.6091082275459374 / 1.6078355157481543 s`, P95 `5.384999999999991 s`, median IoU `0.5824665676077242`, and overlap 48. Canonical text mutation and timing mutation are both 0. Production remains `needs-review`, `finalizationMethod = none`, and `machineReleaseAuthorized = false`; C6.0.2 remains held.

## Branch, baseline, and development-set status

- Branch: `codex/c6-0-1-9-independent-asr-complementarity`.
- Exact base: `3a43a891696a433d6defdd5c2ac4830ef2a2572c` on `codex/c6-0-1-8-core-span-asr-stability`.
- Baseline replay: passed; C6.0.1.8 canonical, presentation, ASS, SRT, and VTT identities were reproduced.
- Source media SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`; read-only verification passed.
- Gold SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; first used only after the machine freeze and remained read-only.
- Machine diagnostic selection semantic hash: `6e4da4d2338728fbafb7f6fcc9af92c78fed15d28f9554c8fb2e14b9ed19dd3c`.
- Machine freeze hash: `501c4fc9aff0d8c5f38885457c8347504a53bd864c18b04c854b2750f844aa6b`.
- Carnation is a known development set. This result supports the next engineering experiment; it does not establish unseen-series quality or production release readiness.

The goal was to determine whether an ASR model architecturally independent of Whisper contributes useful Japanese text candidates on the same localized acoustic evidence. The non-goals were to modify Whisper rules, add timing or overlap heuristics, use Gold or human memory during runtime, use online/cloud ASR, build a production ensemble, mutate canonical output, or authorize C6.0.2.

Single-Whisper expansion stopped because C6.0.1.8 found persistent lexical and hallucination instability across same-core Whisper windows and no exactly correct pipeline candidate on the selected errors. Another Whisper window would add correlated evidence rather than answer the independent-information question.

## Independent ASR selection, runtime, and offline acceptance

The second-ASR provider is `reazonspeech-k2-v2`, model ID `reazon-research/reazonspeech-k2-v2`, a Zipformer character RNN-T. The exact official model revision is `291488c8151be24d7da4bf7af26e533fad96e407`. A direct `sherpa-onnx` adapter was used because it can freeze and verify the exact official ONNX files instead of resolving an unpinned snapshot internally.

| Runtime item                             | Accepted value                                                     |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Adapter                                  | `DIRECT_SHERPA_ONNX_OFFICIAL_REAZON_FP32`                          |
| Model snapshot                           | `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3` |
| Runtime identity                         | `d0f332c33d2a3151ee3ee5c3a4602f3cec13df3828b787fd0dd634e58d9f0d64` |
| Adapter source SHA-256                   | `bea411b3fa8509f5cfec00d1d254d0d85e8842b5d254fb2b2c94c8e989e9d2dc` |
| Runtime                                  | Python `3.13.14`, `sherpa-onnx 1.13.6`                             |
| Host                                     | Darwin `25.6.0`, arm64, Apple M1 Pro                               |
| Precision / device / threads             | FP32 / CPU / 1                                                     |
| Decoder                                  | greedy search, 16 kHz, 80 features                                 |
| Padding / maximum padded duration        | 0.9 s per edge / 30 s                                              |
| Hotwords / contextual bias / external LM | false / false / false                                              |

| Pinned file                   |     Bytes | SHA-256                                                            |
| ----------------------------- | --------: | ------------------------------------------------------------------ |
| `encoder-epoch-99-avg-1.onnx` | 592347848 | `ecdb0b771e16104aaf8e579cb3c1e32fbd589eb641c5946d82b615bd366c5f96` |
| `decoder-epoch-99-avg-1.onnx` |  11767836 | `58b18211ae06265466bfa17172dab574df94f76c8bcb61a3640c28ba860e4124` |
| `joiner-epoch-99-avg-1.onnx`  |  10720115 | `d38a81d1191c9ed6de6a1719503692e07e3e973e2364adde0abae5eaaded1174` |
| `tokens.txt`                  |     45754 | `2c3ac659818a48a0c04010e0593bbc4d7c8a24a054340b01131499c05fd52def` |

One explicitly permitted bootstrap used the network to acquire the official runtime/model. Before acceptance, every required file was complete, hashed, and frozen. The actual acceptance run was offline and local: network false, remote API false, Gold input 0. The provider scrubbed common token variables and forced offline mode in the persistent worker.

Fresh runtime performance was: model load `1.1427564589539543 s`, total inference `18.763497080421075 s`, mean `0.39090618917543907 s`, p50 `0.3590876250527799 s`, p95 `0.7430213330080733 s`, RTF `0.07976392866336289`, and peak RSS `977207296` bytes.

## Diagnostic set, candidate contract, and stability

The pre-Gold set contains the 12 frozen C6.0.1.8 targets and 12 deterministic machine-only controls. Controls were selected from low-risk, core-localizable machine evidence; Gold did not select or reorder them. The 24 event IDs were frozen before any local Gold evaluation.

Audio extraction used the verified source hash, 16 kHz mono WAV identities, exact source-global intervals, explicit extraction-configuration hashes, and the provider's padded 30-second limit. No source media was modified. Every event produced a `CORE_EXACT` request and a conservatively expanded `CORE_CONTEXT` request.

| Fresh candidate measure                          |     Result |
| ------------------------------------------------ | ---------: |
| Planned / actual requests                        |    48 / 48 |
| Core exact / context                             |    24 / 24 |
| Fresh inference / cache hits                     |     48 / 0 |
| Model loads / worker starts                      |      1 / 1 |
| Successful / failed / empty                      | 48 / 0 / 0 |
| Candidates                                       |         48 |
| Evidence complete / incomplete                   |     48 / 0 |
| Point-timestamp evidence available / unavailable |     48 / 0 |
| Character intervals claimed                      |          0 |

The candidate contract retains display text, normalized lexical text, pronunciation projection, request and audio identity, source interval, diagnostics, point-timestamp availability, cache identity, inference/cache state, and semantic hash. Point timestamps are never promoted to character intervals. Exact display, normalized lexical, and pronunciation forms remain separate representations.

| Reazon exact/context stability        |           Count |
| ------------------------------------- | --------------: |
| `REAZON_CORE_STABLE`                  |               4 |
| `REAZON_CONTEXT_EXTENSION_ONLY`       |              11 |
| `REAZON_LEXICALLY_UNSTABLE`           |               9 |
| `REAZON_HALLUCINATION_UNSTABLE`       |               0 |
| `REAZON_EMPTY_UNSTABLE`               |               0 |
| Uncomparable                          |               0 |
| Stable or context-extension-only rate | 15/24 = `0.625` |

The optional second Fresh determinism spot-check was not run: count 0, exact match 0, normalized match 0, disagreement 0. Determinism for delivery was instead verified through two exact-cache A/B replays; it is not misreported as a second Fresh inference run.

## Cross-model comparison and CTC observe arbitration

Cross-model comparison uses only each Reazon `CORE_EXACT` candidate against the frozen same-event Whisper pool. `CORE_CONTEXT` is stability/context evidence, not a replacement candidate when reliable character intervals are unavailable. The normalization layers keep exact spelling, punctuation-insensitive lexical form, pronunciation projection, and hallucination indicators distinct.

| Machine-only comparison class | Count |
| ----------------------------- | ----: |
| Events                        |    24 |
| Exact agreement               |     1 |
| Normalized agreement          |     3 |
| Pronunciation agreement       |     0 |
| Orthography-only difference   |     6 |
| Lexical disagreement          |    12 |
| Whisper hallucination risk    |     2 |
| Reazon hallucination risk     |     0 |
| Both low support              |     0 |
| Reazon empty / Whisper empty  | 0 / 0 |
| Uncomparable                  |     0 |

The existing Japanese wav2vec2 CTC is a Reazon-family acoustic verifier, so its artifact carries `DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE`. It never becomes a majority vote, production winner, or canonical mutation authority.

| CTC observe result          |                                                                                                                       Fresh observation |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------: |
| Eligible events             |                                                                                                                                      14 |
| Favors Whisper              |                                                                                                                                       3 |
| Favors Reazon               |                                                                                                                                       5 |
| Ambiguous                   |                                                                                                                                       4 |
| Unscorable                  |                                                                                                                                       2 |
| CTC inference / model loads |                                                                                                                                  28 / 1 |
| Runtime / model snapshot    | `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60` / `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd` |

The exact CTC runtime identity is `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`; model snapshot is `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`. In the Gold-posthoc evaluable decisive subset, CTC preferred the lower-error model 3 times and the higher-error model 4 times, an accuracy of `3/7 = 0.42857142857142855`. Four evaluable cases were ambiguous and one was Gold-unscorable. Final A/B replayed all 28 CTC results from cache with 0 CTC inference and 0 model loads.

## Gold-isolated complementarity, union oracle, and controls

Gold evaluation starts only after the machine freeze. It uses fixed local mappings and records Gold text only in the private evaluation phase; machine artifacts and the shareable summary contain no full Gold text.

| Gold-local measure                         | Result |
| ------------------------------------------ | -----: |
| Target evaluable / unevaluable             | 10 / 2 |
| Target baseline-wrong                      |      9 |
| Control evaluable                          |     12 |
| Disagreement evaluable                     |     13 |
| Aggregate Reazon-better                    |      3 |
| Aggregate Whisper-better                   |      4 |
| Reazon-only correct / Whisper-only correct |  1 / 2 |
| Both equivalent                            |      0 |
| Both wrong                                 |     19 |

The exact 24-event taxonomy is:

| Taxonomy                     | Count |
| ---------------------------- | ----: |
| `BOTH_CORRECT_OR_EQUIVALENT` |     0 |
| `WHISPER_ONLY_BETTER`        |     0 |
| `REAZON_ONLY_BETTER`         |     0 |
| `WHISPER_ONLY_CORRECT`       |     2 |
| `REAZON_ONLY_CORRECT`        |     1 |
| `BOTH_WRONG_REAZON_BETTER`   |     3 |
| `BOTH_WRONG_WHISPER_BETTER`  |     4 |
| `BOTH_WRONG_SIMILAR`         |     4 |
| `BOTH_WRONG_DIFFERENT`       |     2 |
| `ORTHOGRAPHY_ONLY`           |     5 |
| `WHISPER_HALLUCINATION_ONLY` |     1 |
| `REAZON_HALLUCINATION_ONLY`  |     0 |
| `BOTH_HALLUCINATE`           |     0 |
| `UNEVALUABLE`                |     2 |

The aggregate “better” counts include the more specific both-wrong and only-correct categories; they are not the same as the literal `WHISPER_ONLY_BETTER` and `REAZON_ONLY_BETTER` taxonomy rows.

| Oracle / control measure                              |                      Result |
| ----------------------------------------------------- | --------------------------: |
| Whisper-only oracle error                             |                         275 |
| Whisper + Reazon union error                          |                         253 |
| Absolute / relative gain                              |                 22 / `0.08` |
| Improved events                                       |                        7/22 |
| Reazon-only information-gain events                   |                           7 |
| Complementarity rate                                  | `7/22 = 0.3181818181818182` |
| Improved baseline-wrong targets                       |        2/9 (`0002`, `0108`) |
| Controls: Reazon better / Whisper better / equivalent |                   5 / 4 / 3 |
| Controls: Reazon hallucination / empty                |                       0 / 0 |
| Blind-Reazon control regressions                      |                           4 |

This confirms candidate-pool complementarity while rejecting direct replacement. Reazon adds useful information in 7 evaluable events, but 4 controls demonstrate that “different” cannot be treated as “better.” C6.0.1.10 must learn a conservative, abstaining arbitration policy from machine-local evidence and validate it without production mutation.

## Shadow A/B, production preservation, and Shareable audit

Final A and Final B each replayed 48/48 exact Reazon result-cache entries and 28/28 CTC cache entries with 0 inference, 0 model load, 0 worker start, and no network. Both produced machine semantic payload hash `fb001331784bf404dd7111c1592842a48cc4cf54737e7985b7dc43753ead2cda`. Diagnostic set, candidates, stability, comparison, CTC arbitration, shadow state, route decision, production text, and production timing have A/B parity.

The shadow artifact deliberately sets `winnerSelectionPolicyImplemented = false`, `productionMutationAllowed = false`, and all winner IDs to null. Canonical text and timing mutation counts are 0.

| Production identity | Baseline and Final semantic SHA-256                                | Raw file SHA-256 where applicable                                  |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Canonical text      | `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e` | n/a                                                                |
| Canonical timing    | `b4c5eaae50284455e502aa2bdcae38a3dd4df9c4622397af86e3790463d00e86` | n/a                                                                |
| Presentation        | `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7` | n/a                                                                |
| ASS                 | `f46039ec15cf1306da86babcd23d8dc769e1cdb9167cc2f0b51af930bce45981` | `594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7` |
| SRT                 | `ec2fe7c76ac235151965d728466d8592650f86b38b16e48500b4b6bf83723083` | `faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd` |
| VTT                 | `00a5936b752ba155b3e410b42c9b7a5e9d4969b441d5179494144a631983933f` | `107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a` |

ASS/SRT/VTT semantic and byte parity with the C6.0.1.8 baseline are all true. The Shareable audit passed 4/4: absolute private path leak 0, full Gold text 0, raw private audio 0, secret 0. The accepted validation artifact passed 17/17 checks. A post-fix validation recheck bound to `ffe9d832f1b9e97eac92994c60d9353d08264fd9` also passed 17/17; its temporary copy was removed after verification.

## Tests, schemas, regressions, and Skill integrity

- Typecheck, lint, Prettier check, and build: passed. Vite built 21 modules; JS `205.06 kB`, gzip `64.94 kB`.
- Unit suite: 72 files passed; 664 tests passed, 1 intentionally skipped.
- E2E suite: 22 files passed; 41 tests passed, 1 intentionally skipped.
- Dedicated C6.0.1.9 unit + E2E recheck: 2 files, 6/6 passed.
- Targeted C5.19/C6 regression suite: 45 files, 199/199 passed.
- Targeted coverage includes C5.19, C6 Investigation, C6 Protected, and C6.0.1 through C6.0.1.8.
- JSON Schemas: 264 generated; strict artifact validation passed.
- Skill validation: `Skill is valid!` for both the repository Skill and the installed workspace Skill entrypoint.
- Skill 2 (`multilingual-grammar-report-generator`) and Skill 3 (`multilingual-grammar-learning-site-builder`) were not modified.

## Required report matrix (1–121)

|   # | Required topic                       | Recorded result                                                                                                        |
| --: | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
|   1 | Executive Conclusion                 | Engineering and complementarity diagnosis passed; C6.0.1.10 recommended; production held.                              |
|   2 | Branch                               | `codex/c6-0-1-9-independent-asr-complementarity`.                                                                      |
|   3 | Baseline                             | C6.0.1.8 at `3a43a891696a433d6defdd5c2ac4830ef2a2572c`.                                                                |
|   4 | Development-set Status               | Known Carnation development set; no unseen generalization claim.                                                       |
|   5 | Goals                                | Test whether independent Japanese ASR adds useful same-core candidates.                                                |
|   6 | Non-goals                            | No production mutation, ensemble winner, new Whisper/timing/overlap rule, cloud ASR, or C6.0.2.                        |
|   7 | Why Single-Whisper Expansion Stopped | Same-core Whisper instability and no exact-correct pipeline opportunity in C6.0.1.8.                                   |
|   8 | Second-ASR Selection                 | ReazonSpeech K2 V2.                                                                                                    |
|   9 | ReazonSpeech K2 Architecture         | Zipformer character RNN-T.                                                                                             |
|  10 | Runtime Adapter                      | Direct official Reazon FP32 ONNX through `sherpa-onnx`.                                                                |
|  11 | Model Revision                       | `291488c8151be24d7da4bf7af26e533fad96e407`.                                                                            |
|  12 | Model File Hashes                    | Encoder/decoder/joiner/tokens hashes listed above; all pinned and verified.                                            |
|  13 | Precision                            | FP32.                                                                                                                  |
|  14 | Device                               | CPU, Apple M1 Pro, one thread.                                                                                         |
|  15 | Runtime Identity                     | `d0f332c33d2a3151ee3ee5c3a4602f3cec13df3828b787fd0dd634e58d9f0d64`.                                                    |
|  16 | Bootstrap                            | One permitted network bootstrap; files complete and frozen before acceptance.                                          |
|  17 | Offline Acceptance                   | Local-only, network false, remote API false, Gold input 0.                                                             |
|  18 | Diagnostic Target Set                | 12 C6.0.1.8 events.                                                                                                    |
|  19 | Machine-only Control Set             | 12 deterministic low-risk events.                                                                                      |
|  20 | Control Freeze                       | Frozen with targets before Gold; semantic hash `6e4da4d…9dd3c`.                                                        |
|  21 | Core Exact Policy                    | Same frozen local core; candidate comparison source.                                                                   |
|  22 | Core Context Policy                  | Conservative context expansion; stability/context only.                                                                |
|  23 | Audio Extraction                     | 16 kHz local WAV, source-global intervals, source/audio/config identities.                                             |
|  24 | Duration Limits                      | 30 s after 0.9 s padding per side; fail closed above limit.                                                            |
|  25 | Fresh Request Count                  | 48.                                                                                                                    |
|  26 | Actual Inference Count               | 48.                                                                                                                    |
|  27 | Cache Hits                           | 0 during Fresh.                                                                                                        |
|  28 | Model Loads                          | 1 during Fresh.                                                                                                        |
|  29 | Runtime                              | Load 1.143 s; inference 18.763 s; RTF 0.07976; peak RSS 977207296.                                                     |
|  30 | Second-ASR Candidate Contract        | Identity, text views, diagnostics, timestamp availability, cache/inference state, semantic hash.                       |
|  31 | Timestamp Availability               | Point timestamps 48/48; character intervals 0/48.                                                                      |
|  32 | Exact Text                           | Raw display text retained separately.                                                                                  |
|  33 | Normalized Text                      | Lexical normalization retained separately.                                                                             |
|  34 | Pronunciation Projection             | Separate Japanese pronunciation view; no orthographic rewriting.                                                       |
|  35 | Reazon Core Exact                    | 24 candidates; cross-model candidate source.                                                                           |
|  36 | Reazon Context                       | 24 candidates; stability/context evidence.                                                                             |
|  37 | Reazon Stability                     | 4 stable, 11 context-only, 9 lexical unstable, 0 hallucination/empty.                                                  |
|  38 | Cross-model Normalization            | Exact, normalized, pronunciation, and risk signals remain distinct.                                                    |
|  39 | Exact Agreement                      | 1.                                                                                                                     |
|  40 | Normalized Agreement                 | 3.                                                                                                                     |
|  41 | Pronunciation Agreement              | 0.                                                                                                                     |
|  42 | Orthography-only Difference          | 6 machine comparison events; 5 post-Gold taxonomy events.                                                              |
|  43 | Lexical Disagreement                 | 12.                                                                                                                    |
|  44 | Whisper Hallucination Risk           | 2.                                                                                                                     |
|  45 | Reazon Hallucination Risk            | 0.                                                                                                                     |
|  46 | Reazon Empty                         | 0.                                                                                                                     |
|  47 | Cross-model Comparison               | 24/24 comparable; semantic hash `c1e8310d…07a58`.                                                                      |
|  48 | CTC Arbitration Design               | Observe-only acoustic verifier, never a winner or independent vote.                                                    |
|  49 | Evidence Correlation Warning         | `DATA_FAMILY_CORRELATED_NOT_AN_INDEPENDENT_VOTE`.                                                                      |
|  50 | CTC Favors Whisper                   | 3.                                                                                                                     |
|  51 | CTC Favors Reazon                    | 5.                                                                                                                     |
|  52 | CTC Ambiguous                        | 4.                                                                                                                     |
|  53 | CTC Arbitration Accuracy             | 3/7 = `0.42857142857142855`; 4 wrong decisive preferences.                                                             |
|  54 | Gold Local Evaluation                | Post-freeze fixed local evaluation only.                                                                               |
|  55 | Target Evaluable Count               | 10/12.                                                                                                                 |
|  56 | Control Evaluable Count              | 12/12.                                                                                                                 |
|  57 | Both Correct/Equivalent              | 0.                                                                                                                     |
|  58 | Whisper-only Better                  | Aggregate clearly better 4; exact taxonomy `WHISPER_ONLY_BETTER` 0.                                                    |
|  59 | Reazon-only Better                   | Aggregate clearly better 3; exact taxonomy `REAZON_ONLY_BETTER` 0.                                                     |
|  60 | Whisper-only Correct                 | 2.                                                                                                                     |
|  61 | Reazon-only Correct                  | 1.                                                                                                                     |
|  62 | Both Wrong Similar                   | 4.                                                                                                                     |
|  63 | Both Wrong Different                 | 2.                                                                                                                     |
|  64 | Hallucination Asymmetry              | Whisper-only 1; Reazon-only 0; both 0.                                                                                 |
|  65 | Whisper-only Oracle                  | Error 275 over 22 evaluable events.                                                                                    |
|  66 | Union Oracle                         | Error 253 over the same 22 events.                                                                                     |
|  67 | Complementarity Gain                 | 22 absolute, 8% relative.                                                                                              |
|  68 | Union Improved Event Count           | 7 overall; 2 baseline-wrong targets.                                                                                   |
|  69 | Complementarity Rate                 | `7/22 = 0.3181818181818182`.                                                                                           |
|  70 | Control Regression                   | 12 evaluable; Reazon 5 better, 4 worse, 3 equivalent.                                                                  |
|  71 | Blind Reazon Counterfactual          | 4 potential regressions.                                                                                               |
|  72 | Second-ASR Stability Rate            | `15/24 = 0.625`.                                                                                                       |
|  73 | Fresh Determinism Spot-check         | Optional and not run: count/matches/disagreement all 0.                                                                |
|  74 | Shadow Ensemble Candidate            | No winner policy; all winner IDs null; ambiguity retained.                                                             |
|  75 | Production Final Mutation            | Text 0, timing 0, presentation 0.                                                                                      |
|  76 | Exact CER                            | Baseline/final `0.6601049868766404`.                                                                                   |
|  77 | Normalized CER                       | Baseline/final `0.6015625`.                                                                                            |
|  78 | Coverage                             | Baseline/final `0.96484375`.                                                                                           |
|  79 | Missing                              | Baseline/final 6.                                                                                                      |
|  80 | Hallucination                        | Baseline/final 1.                                                                                                      |
|  81 | Material Errors                      | Baseline/final 77.                                                                                                     |
|  82 | Severe Timing                        | Baseline/final 53.                                                                                                     |
|  83 | Start MAE                            | Baseline/final `1.6091082275459374 s`.                                                                                 |
|  84 | End MAE                              | Baseline/final `1.6078355157481543 s`.                                                                                 |
|  85 | P95                                  | Baseline/final `5.384999999999991 s`.                                                                                  |
|  86 | IoU                                  | Baseline/final median `0.5824665676077242`.                                                                            |
|  87 | Overlap                              | Baseline/final 48.                                                                                                     |
|  88 | Production Status                    | `needs-review`; `finalizationMethod = none`.                                                                           |
|  89 | Machine Release Gate                 | Closed; `machineReleaseAuthorized = false`; C6.0.2 false.                                                              |
|  90 | Gold Runtime Isolation               | Passed; runtime Gold input 0.                                                                                          |
|  91 | Dataset Hardcoding                   | 0 findings; no Carnation hotwords or human memory.                                                                     |
|  92 | Network                              | Bootstrap true; acceptance/Fresh/Final A/B network false.                                                              |
|  93 | Source Read-only                     | Passed; SHA unchanged.                                                                                                 |
|  94 | Gold Read-only                       | Passed; SHA unchanged and read post-freeze.                                                                            |
|  95 | Shareable                            | 4/4 privacy/safety checks passed.                                                                                      |
|  96 | C5.19 Regression                     | Passed.                                                                                                                |
|  97 | C6 Investigation Regression          | Passed.                                                                                                                |
|  98 | C6 Protected Regression              | Passed.                                                                                                                |
|  99 | C6.0.1 Regression                    | Passed.                                                                                                                |
| 100 | C6.0.1.1 Regression                  | Passed.                                                                                                                |
| 101 | C6.0.1.2 Regression                  | Passed.                                                                                                                |
| 102 | C6.0.1.3 Regression                  | Passed.                                                                                                                |
| 103 | C6.0.1.4 Regression                  | Passed.                                                                                                                |
| 104 | C6.0.1.5 Regression                  | Passed.                                                                                                                |
| 105 | C6.0.1.6 Regression                  | Passed.                                                                                                                |
| 106 | C6.0.1.7 Regression                  | Passed.                                                                                                                |
| 107 | C6.0.1.8 Regression                  | Passed.                                                                                                                |
| 108 | Unit Tests                           | 72 files; 664 passed, 1 skipped.                                                                                       |
| 109 | E2E                                  | 22 files; 41 passed, 1 skipped.                                                                                        |
| 110 | Targeted Tests                       | 45 files; 199/199 passed; dedicated C6.0.1.9 6/6.                                                                      |
| 111 | Schemas                              | 264 generated and validated.                                                                                           |
| 112 | Skill Validation                     | Repository and installed Skill both report `Skill is valid!`.                                                          |
| 113 | Skill2/3                             | Not modified.                                                                                                          |
| 114 | Complementarity Engineering Gate     | Passed: real provider, pinned model, 48 Fresh, contracts, comparison, CTC, Gold, oracle, controls, route.              |
| 115 | Complementarity Diagnostic Result    | `SECOND_ASR_COMPLEMENTARITY_CONFIRMED`.                                                                                |
| 116 | Route Decision                       | `GO_C6_0_1_10_CROSS_MODEL_ARBITRATION`.                                                                                |
| 117 | Route Confidence                     | `MEDIUM`.                                                                                                              |
| 118 | Remaining Risks                      | Known set; 9 lexical instabilities; 4 control regressions; CTC 42.86%; point timestamps only; no safe arbitration yet. |
| 119 | Commits                              | Five implementation/acceptance-prep commits listed below; report is in its own acceptance commit.                      |
| 120 | Remote HEAD                          | Verified after the report commit is pushed; exact SHA is supplied in final delivery.                                   |
| 121 | Output Paths                         | Fourteen accepted real output paths listed below.                                                                      |

## Required Q1–Q16 answers

1. **Q1 — Target events with better Reazon text absent from the Whisper pool:** 2 of the 9 evaluable baseline-wrong targets: `canonical-event-0002` and `canonical-event-0108`.
2. **Q2 — Target events where Reazon alone is correct/equivalent and every Whisper candidate is wrong:** 0. The one `REAZON_ONLY_CORRECT` event is a control (`canonical-event-0076`), not one of the 12 targets.
3. **Q3 — Target events where Whisper is clearly better than Reazon:** 4 (`0009`, `0011`, `0048`, `0136`) by lower local Gold error or Whisper-only correctness.
4. **Q4 — Target events where both ASRs are wrong with different error patterns:** 2 exact `BOTH_WRONG_DIFFERENT` cases (`0003`, `0191`). More specific asymmetric both-wrong categories are reported separately.
5. **Q5 — Events with actual pronunciation agreement but orthographic difference:** 0 exact pronunciation-agreement events. The 6 machine `ORTHOGRAPHY_ONLY_DIFFERENCE` classifications are similarity classes, not proof of exact pronunciation equality.
6. **Q6 — Reazon exact/context stability:** 4 stable, 11 context-extension-only, 9 lexically unstable, 0 hallucination-unstable, 0 empty-unstable, 0 uncomparable; stable rate `0.625`. Lexical instability exists; hallucination/empty instability did not occur.
7. **Q7 — Whisper-only versus union oracle error:** 275 to 253, down 22 error units or 8%.
8. **Q8 — Baseline-wrong events improved by the union oracle:** 7/22 evaluable events overall; specifically 2/9 baseline-wrong target events. The other 5 improvements are controls.
9. **Q9 — Potential regressions on low-risk controls:** 4/12 if Reazon were selected blindly.
10. **Q10 — CTC probability of preferring the Gold-posthoc better candidate:** 3/7 = `42.857%` among decisive evaluable preferences. It was wrong 4/7; ambiguous and unscorable cases are excluded from that denominator.
11. **Q11 — Is CTC valuable enough for C6.0.1.10 arbitration evidence?** Only as a weak, correlated, calibrated feature with abstention. It is not accurate or independent enough to be a vote or winner by itself.
12. **Q12 — Does Reazon add independent information?** Yes, but selectively: 7 union improvements and 22 error units of gain demonstrate non-duplicate information. It also shares many errors, so complementarity is confirmed rather than universal superiority.
13. **Q13 — Are Reazon hallucination/empty/instability risks acceptable?** Empty and hallucination risk were acceptable in this run (0 each), but 9/24 lexical instability and 4/12 control regressions require guarded arbitration.
14. **Q14 — Is C6.0.1.10 worthwhile?** Yes: `GO_C6_0_1_10_CROSS_MODEL_ARBITRATION` with `MEDIUM` confidence.
15. **Q15 — Should Reazon be rejected now and replaced with another ASR?** No. Complementarity is sufficient to keep it as a candidate ensemble member. Rejection is not supported by this evidence.
16. **Q16 — Current production state:** Yes, it must remain `needs-review`, `finalizationMethod = none`, and `machineOnlyReleaseAuthorized = false`. C6.0.2 remains held.

## Commits and remote state

Implementation and acceptance-preparation commits before this report:

1. `53b0744` — `feat: add independent Japanese ASR provider and pinned Reazon runtime`
2. `f5d0ab7` — `feat: add independent ASR complementarity pipeline`
3. `ee713ae` — `feat: add exact-cache A B complementarity replay`
4. `db63d16` — `feat: add union oracle control regression and validation`
5. `ffe9d83` — `test: complete C6.0.1.9 acceptance coverage`

The acceptance commit is the commit containing this report. A Git commit cannot embed its own final SHA without changing that SHA; the final delivery response records the exact acceptance commit and verified remote SHA after push.

## Accepted real output paths

1. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-baseline-20260829`
2. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-diagnostic-set-20260829`
3. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-second-asr-runtime-20260829`
4. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-reazon-core-exact-20260829`
5. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-reazon-context-20260829`
6. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-cross-model-comparison-20260829`
7. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-ctc-arbitration-20260829`
8. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-complementarity-evaluation-20260829`
9. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-union-oracle-20260829`
10. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-control-evaluation-20260829`
11. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-route-decision-20260829`
12. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-final-a-20260829`
13. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-final-b-20260829`
14. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-9-validation-20260829`

## Official references

- ReazonSpeech K2 V2 model files: <https://huggingface.co/reazon-research/reazonspeech-k2-v2/tree/main>
- ReazonSpeech K2 runtime documentation: <https://github.com/reazon-research/ReazonSpeech/tree/master/pkg/k2-asr>
- sherpa-onnx offline recognition documentation: <https://k2-fsa.github.io/sherpa/onnx/index.html>
