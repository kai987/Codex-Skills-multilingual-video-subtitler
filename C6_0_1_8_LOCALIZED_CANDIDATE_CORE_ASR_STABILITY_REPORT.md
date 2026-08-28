# C6.0.1.8 Localized Candidate Comparability & Core-Span ASR Stability Validation

Date: 2026-08-29

Policy: `c6.0.1.8-core-span-asr-stability-v1`

Policy SHA-256: `8b02fce3f4f2d6a573c9951178d96540a5878103dccf272681f1fd12a7c0fc02`

## Executive conclusion

C6.0.1.8 engineering acceptance and diagnostic acceptance passed. The implementation replays the exact C6.0.1.7 machine baseline, derives machine-only acoustic core spans, projects the inherited and 36 genuine C6.0.1.7 Fresh request-level candidates onto the same local intervals, evaluates localized comparability, performs post-freeze many-to-many Gold alignment, and produces a deterministic pipeline-versus-ASR route decision. It does not change canonical text, canonical timing, presentation, or the rendered ASS/SRT/VTT files.

The decisive result is `RECOMMEND_SECOND_ASR_ENSEMBLE` with `MEDIUM` confidence and the explicit recommendation `STOP_SINGLE_WHISPER_RULE_EXPANSION`. All 12 selected events are at least partially core-comparable, but none is `CORE_TEXT_CONSISTENT`. The stability distribution is 4 lexical core disagreements, 2 hallucination disagreements, 2 adjacent-utterance contaminations, and 4 partial-core agreements. The Gold-isolated diagnosis contains 0 proven pipeline-correct candidates, 0 stable-wrong Whisper cores, 5 lexical-instability diagnoses, 1 hallucination-instability diagnosis, 4 localization blockers, and 2 reference-alignment blockers.

Local many-to-many alignment raises Gold-evaluable coverage from 5/12 in C6.0.1.7 to 10/12. The remaining two cases lack a Gold cue inside the frozen local margin. The oracle finds a lower-error candidate on 4 of the 7 baseline-wrong, current-error-comparable events, reducing aggregate error from 107 to 96 across the eight current-error-comparable events. None of those oracle winners is exactly correct, so this is not a proven safe final-pipeline application opportunity.

The optional C6.0.1.8 Core Fresh run was correctly not executed. All 12 events already had three genuine, prompt-free C6.0.1.7 Fresh windows with usable global timing evidence, and another run of the same model family would not add independent evidence. C6.0.1.8 therefore added 0 requests, 0 inference, 0 cache hits, 0 model loads, and 0 process starts; stability changed on 0 events.

Final quality is intentionally unchanged: exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, 6 missing, 1 hallucination, 77 material errors, 53 severe timing errors, start/end MAE `1.6091082275459374 / 1.6078355157481543 s`, P95 boundary error `5.384999999999991 s`, median IoU `0.5824665676077242`, and overlap 48. Production remains `needs-review`, `finalizationMethod = none`, and `machineReleaseAuthorized = false`. The strict C6.0.2 gate remains failed.

## Branch, baseline, and development-set status

- Branch: `codex/c6-0-1-8-core-span-asr-stability`.
- Exact base: `a41e00a447b22d6423b8dd614ce7ad9c7877f0d8` from accepted C6.0.1.7.
- Official machine baseline: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-final-a-20260829`.
- Genuine Fresh input: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-fresh-reasr-generation-20260829`.
- Gold input SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; read only after the machine freeze and unchanged after evaluation.
- Source media SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`; size `847774958` bytes; read-only verification passed.
- Carnation remains a known development set. This delivery establishes engineering correctness and a development-set diagnosis; it does not establish unseen-series quality or authorize release.
- Runtime Gold input count: 0. Dataset-hardcoding findings: 0. Network use: false. Source and Gold read-only checks: passed.

The goals were to make candidates from different Re-ASR windows comparable on one acoustic core, retain ambiguity instead of coercing a projection, recover local Gold evaluability without leaking Gold into machine stages, and decide whether the next bottleneck is final-pipeline application or the single-ASR evidence ceiling.

The non-goals were to change subtitle text or timing, alter VAD/CTC/speaker/association/assembly rules, run full-episode ASR, rerun pyannote, add a second ASR in this version, use online subtitle search, use network inference, tune to Carnation strings, relax release thresholds, modify Skill 2/3, or authorize C6.0.2.

## C6.0.1.7 replay and Fresh input inventory

The baseline replay reproduced the C6.0.1.7 canonical and rendered hashes exactly. The imported Fresh inventory contains 12 selected events and 36 genuine prompt-free request windows: `FRESH_A`, `FRESH_B`, and `FRESH_C` for every event. The source C6.0.1.7 artifact retained 28 transcript candidates after its own filtering; C6.0.1.8 deliberately treats all 36 request-level outputs as projection inputs so empty or weak evidence remains explicit rather than disappearing.

Full-window transcripts are not directly comparable because the three requests use different margins. A longer request can contain preceding or following speech, partial neighboring utterances, and grouped words whose children straddle the event boundary. Comparing the full strings would therefore conflate core lexical instability with context length. C6.0.1.8 compares only text supported inside a fixed machine-derived core interval and separately retains `preCoreText`, `postCoreText`, coverage, boundary ambiguity, and unprojectable evidence.

## Core acoustic spans and neighboring-event handling

Core spans are derived before Gold from canonical event timing, trusted token evidence, source-global VAD boundaries, request-local-to-global transforms, and conservative margins. Gold never defines or moves a core span. Neighboring-event evidence is retained and marked; it is not merged into the core merely to increase apparent agreement. Overlap remains explicit, and no selected event was forced through an overlap-ambiguous span.

| Core-span result        | Count |
| ----------------------- | ----: |
| Selected / emitted      | 12/12 |
| `VERIFIED`              |     0 |
| `VERIFIED_WITH_CAUTION` |     8 |
| `AMBIGUOUS`             |     4 |
| `UNAVAILABLE`           |     0 |
| Overlap ambiguity       |     0 |
| Fresh-token fallback    |     2 |

The absence of `VERIFIED` spans is intentional: uncertain boundaries are not upgraded merely because a usable interval can be emitted. Eight spans have enough evidence for cautious localization and four preserve explicit ambiguity.

## Token-to-core projection and grouped-word mapping

Projection operates in source-global time. Grouped words retain child token IDs and child intervals; only verified children support exact projection. Untimed evidence remains `UNTIMED_UNPROJECTABLE`. A candidate can carry a non-empty core projection while still being `CROSS_EVENT_AMBIGUOUS`, and a cross-event candidate with no defensible core content remains unprojectable.

| Projection result           | Count |
| --------------------------- | ----: |
| Events / candidates         | 12/64 |
| Core-projectable candidates |    49 |
| Unprojectable candidates    |    15 |
| `EXACT_TOKEN_PROJECTED`     |     6 |
| `PARTIAL_TOKEN_PROJECTED`   |    24 |
| `CONTEXT_ONLY_EXCESS`       |     4 |
| `UNTIMED_UNPROJECTABLE`     |     5 |
| `CROSS_EVENT_AMBIGUOUS`     |    25 |
| `OVERLAP_AMBIGUOUS`         |     0 |
| No core content             |     0 |
| Grouped tokens retained     |   184 |

`Core-projectable` means a non-empty `coreProjectedText`; it is 49, not the sum of every status that can sometimes carry core text. The 15 unprojectable candidates comprise context-only, untimed, and cross-event cases for which no defensible core text remains. Full-window text and core-projected text are both retained with separate normalized hashes.

## Localized comparability and ASR stability

Eight events are fully core-comparable and four are partially comparable. None is unlocalizable, context-only comparable, or overlap ambiguous. Thus all 12 pass the engineering comparability milestone, but partial comparability is not promoted to stable lexical agreement.

| Comparability class     | Count |
| ----------------------- | ----: |
| Fully core-comparable   |     8 |
| Partially comparable    |     4 |
| Context-only comparable |     0 |
| Unlocalizable           |     0 |
| Overlap ambiguous       |     0 |

| Stability class                    | Count |
| ---------------------------------- | ----: |
| `CORE_TEXT_CONSISTENT`             |     0 |
| `CONTEXT_ONLY_DIFFERENCE`          |     0 |
| `LEXICAL_CORE_DISAGREEMENT`        |     4 |
| `HALLUCINATION_DISAGREEMENT`       |     2 |
| `ADJACENT_UTTERANCE_CONTAMINATION` |     2 |
| `SPEAKER_CONTENT_MIX`              |     0 |
| `PARTIAL_CORE_AGREEMENT`           |     4 |
| `UNLOCALIZABLE` / `UNEVALUABLE`    |   0/0 |

The original five formal C6.0.1.7 `WHISPER_WINDOW_INSTABILITY` events refine as follows:

| Event                  | Core-scale classification          |
| ---------------------- | ---------------------------------- |
| `canonical-event-0002` | `HALLUCINATION_DISAGREEMENT`       |
| `canonical-event-0009` | `PARTIAL_CORE_AGREEMENT`           |
| `canonical-event-0011` | `PARTIAL_CORE_AGREEMENT`           |
| `canonical-event-0048` | `ADJACENT_UTTERANCE_CONTAMINATION` |
| `canonical-event-0191` | `PARTIAL_CORE_AGREEMENT`           |

Accordingly, among those five there are 0 pure context-only differences, 0 exact lexical-core-disagreement classifications, 1 hallucination disagreement, 1 adjacent-utterance contamination, and 3 partial agreements. Projection improves causal specificity, but with 0 `CORE_TEXT_CONSISTENT` events it does not demonstrate a significant stability increase.

## Gold-isolated local evaluation

The machine output and all machine-only evidence are frozen before Gold is opened. The evaluator then uses a fixed local margin and monotonic many-to-many alignment. One machine event may align to multiple consecutive Gold cues, and multiple machine events may align to one Gold cue; both cardinalities are recorded rather than flattened into false one-to-one errors.

| Local evaluation result                | Count |
| -------------------------------------- | ----: |
| Events                                 |    12 |
| C6.0.1.7 evaluable before              |     5 |
| C6.0.1.8 evaluable after               |    10 |
| Newly evaluable                        |     5 |
| `EVALUABLE_EXACT_LOCAL`                |     3 |
| `EVALUABLE_MONOTONIC_LOCAL`            |     3 |
| `EVALUABLE_WITH_AMBIGUITY`             |     4 |
| Remaining unevaluable                  |     2 |
| `UNEVALUABLE_INSUFFICIENT_REFERENCE`   |     2 |
| Unevaluable overlap / mapping conflict |   0/0 |
| One machine to many Gold               |     5 |
| Many machine to one Gold               |     2 |

The two remaining blockers are `canonical-event-0001` and `canonical-event-0068`: neither has a local Gold cue inside the frozen evaluation margin. The evaluator does not widen the margin after seeing Gold.

## Optional Core Fresh verification and runtime identity

The decision is `NOT_REQUIRED_EXISTING_FRESH_SUFFICIENT`. Every selected event already has three genuine, prompt-free C6.0.1.7 Fresh requests, usable global timing evidence exists, and a new request would use the same model family. A same-model rerun would not resolve the causal question that C6.0.1.8 is designed to answer.

| Resource                      | Identity / result                                                  |
| ----------------------------- | ------------------------------------------------------------------ |
| Whisper large-v3 model        | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |
| whisper.cpp-mvl binary        | `b5985816a5d38cf498e0f74bbf82ce5d965d2685042f20f57a1385ba4e7de10f` |
| Verified runtime patch series | `9ae5969381786395c6219d360344eeff0be0ab6083c8c359e32b29b3a586fc97` |
| Device                        | Metal                                                              |
| C6.0.1.7 reused requests      | 36                                                                 |
| C6.0.1.8 selected / planned   | 0 / 0                                                              |
| Requests / inference          | 0 / 0                                                              |
| Cache hits / model loads      | 0 / 0                                                              |
| Process starts / candidates   | 0 / 0                                                              |
| Stability changes             | 0                                                                  |
| Verification semantic hash    | `06be21e6842a624c38f98010361314c6ac93006fe32e30bf35d05e1e95446ede` |

## Candidate Oracle V2 and metric direction

Oracle error is a character-error count and lower is better. Across the eight events with both a current-final core error and at least one evaluable candidate, current-final error totals 107 and oracle error totals 96, an improvement of 11 on 4 events. Existing-pool candidates win 2 events and C6.0.1.7 Fresh candidates win 2; C6.0.1.8 Core Fresh wins 0 because that run was not required.

Source-specific minima have different coverage and must not be compared without a shared denominator. Existing-pool candidates cover 5 events and total 53. C6.0.1.7 Fresh candidates cover 10 events and total 119. On the five events covered by both pools, existing totals 53 and Fresh totals 54, so `Fresh - Existing = +1`: Fresh is one error unit worse on that matched subset. Core-verification totals and deltas are not applicable.

There are 10 locally Gold-evaluable events, 8 with a current-final error value, and 7 whose current-final error is greater than zero. Four of those 7 have a lower-error oracle candidate, but all four oracle errors remain nonzero. Therefore the strict `PIPELINE_CORRECT_CANDIDATE_EXISTS` count is 0, even though limited nonzero-error ranking opportunity exists.

## Final diagnosis and route decision

| Diagnosis                           | Count |
| ----------------------------------- | ----: |
| `PIPELINE_CORRECT_CANDIDATE_EXISTS` |     0 |
| `CONTEXT_DIFFERENCE_ONLY`           |     0 |
| `ASR_CORE_STABLE_CORRECT`           |     0 |
| `ASR_CORE_STABLE_WRONG`             |     0 |
| `ASR_CORE_LEXICALLY_UNSTABLE`       |     5 |
| `ASR_HALLUCINATION_UNSTABLE`        |     1 |
| `CANDIDATE_APPLICATION_BLOCKED`     |     0 |
| `LOCALIZATION_BLOCKED`              |     4 |
| `REFERENCE_ALIGNMENT_BLOCKED`       |     2 |
| `UNEVALUABLE`                       |     0 |

The six ASR-limited diagnoses include one event whose current final core is already correct; among the seven demonstrably baseline-wrong current-error-comparable events, 4 are lexical-instability errors, 1 is hallucination-instability error, and 2 remain localization-blocked. This distinction prevents an already-correct but unstable event from being counted as a remaining subtitle error.

The route artifact records:

- Decision: `RECOMMEND_SECOND_ASR_ENSEMBLE`.
- Confidence: `MEDIUM`.
- Recommendation: `STOP_SINGLE_WHISPER_RULE_EXPANSION`.
- Supporting counts: local evaluable 10, core-comparable 12, pipeline-limited 0, ASR-limited diagnoses 6, localization-blocked 4, reference-blocked 2, oracle-improved 4.
- Blockers: strict C6.0.2 remains false; 4 localization-blocked diagnoses; 2 reference-alignment-blocked diagnoses.
- Route semantic hash: `ed7e38eabcfa1526862089306115b2a4da9f765c183a8d6c52006aea739ad848`.

This is not authorization to implement or invoke a second ASR in C6.0.1.8. It is the evidence-backed next-stage direction. A C6.0.1.9 version that only adds more single-Whisper rules is not recommended.

## Final quality, hashes, Shadow A/B, and safety

| Metric                      |             Baseline |                Final |
| --------------------------- | -------------------: | -------------------: |
| Cue count                   |                  161 |                  161 |
| Exact CER                   | `0.6601049868766404` | `0.6601049868766404` |
| Normalized CER              |          `0.6015625` |          `0.6015625` |
| Coverage                    |         `0.96484375` |         `0.96484375` |
| Missing                     |                    6 |                    6 |
| Hallucination               |                    1 |                    1 |
| Material errors             |                   77 |                   77 |
| Severe timing errors        |                   53 |                   53 |
| Start MAE, seconds          | `1.6091082275459374` | `1.6091082275459374` |
| End MAE, seconds            | `1.6078355157481543` | `1.6078355157481543` |
| P95 boundary error, seconds |  `5.384999999999991` |  `5.384999999999991` |
| Median temporal IoU         | `0.5824665676077242` | `0.5824665676077242` |
| Overlap pairs               |                   48 |                   48 |

| Artifact         | Baseline / Final SHA-256                                           | Changed |
| ---------------- | ------------------------------------------------------------------ | ------- |
| Canonical text   | `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e` | no      |
| Canonical timing | `b4c5eaae50284455e502aa2bdcae38a3dd4df9c4622397af86e3790463d00e86` | no      |
| Presentation     | `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7` | no      |
| ASS              | `f46039ec15cf1306da86babcd23d8dc769e1cdb9167cc2f0b51af930bce45981` | no      |
| SRT              | `ec2fe7c76ac235151965d728466d8592650f86b38b16e48500b4b6bf83723083` | no      |
| VTT              | `00a5936b752ba155b3e410b42c9b7a5e9d4969b441d5179494144a631983933f` | no      |

Canonical text, canonical timing, and presentation mutation counts are all 0. Final A and Final B both remain `needs-review`, `finalizationMethod = none`, and release unauthorized. Their diagnostic semantic parity is true for canonical text, timing, presentation, core span, projection, comparability, stability, local Gold evaluation, oracle, and route decision. Final A/B freeze hashes differ only because their shareable summaries identify separate A/B stages:

- Final A: `31520f8894108071584f1f8c9b68aaee8c998691f521b1e6f807baf33d81818f`.
- Final B: `00c65a4bee0102404cc3a1dfc89282bda6c735960265ac6afee02a5542277641`.

Unsafe finalization escapes are 0. Each Shareable manifest contains one validated artifact. Final A and Final B both report absolute-path leaks 0, prohibited secrets 0, and broken relative references 0.

## Quality gate, validation, regressions, and Skill integrity

Engineering, core-comparability, local-evaluation, ASR-stability-decision, Gold-isolation, A/B parity, canonical-preservation, safety, source/Gold read-only, dataset-hardcoding, schema, and Shareable checks passed. The strict C6.0.2 quality gate failed because normalized CER, material errors, severe timing errors, both MAEs, P95, and overlap remain above their frozen limits.

- Strict JSON Schemas generated: 251, including 13 new C6.0.1.8 contracts.
- Typecheck, lint, formatting check, and build: passed. Build: 21 modules, JS `205.06 kB`, gzip `64.94 kB`.
- Unit: 91 files; 696 passed, 2 skipped.
- E2E: 21 files; 40 passed, 1 skipped.
- Targeted/cross-version: 42 files; 190/190 passed.
- Regressions covered: C5.19, C6 Investigation, C6 Protected, and C6.0.1 through C6.0.1.7.
- Skill validation: `Skill is valid!`.
- Skill 2 (`multilingual-grammar-report-generator`) and Skill 3 (`multilingual-grammar-learning-site-builder`) were not modified.

The validation artifact is bound to implementation commit `cc8504951473edbc89a24af0c8a5ae18454aaf23`. The report-only acceptance commit does not alter executable code or real artifacts.

## Required report matrix (1–118)

|   # | Required topic                                 | Recorded result                                                                                   |
| --: | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
|   1 | Executive Conclusion                           | Engineering and diagnosis passed; route is second ASR/ensemble, release held.                     |
|   2 | Branch                                         | `codex/c6-0-1-8-core-span-asr-stability`.                                                         |
|   3 | Baseline                                       | C6.0.1.7 Final A at base `a41e00a447b22d6423b8dd614ce7ad9c7877f0d8`.                              |
|   4 | Development-set Status                         | Known Carnation development set; no unseen generalization claim.                                  |
|   5 | Goals                                          | Localize, compare, evaluate, and route.                                                           |
|   6 | Non-goals                                      | No subtitle mutation, new ASR, network, threshold relaxation, or Skill 2/3 change.                |
|   7 | C6.0.1.7 Replay                                | Passed with exact canonical/rendered hashes.                                                      |
|   8 | Fresh Input Inventory                          | 12 events, 36 genuine request-level Fresh inputs; 28 retained source candidates.                  |
|   9 | Why Full-window Transcripts Are Not Comparable | Request margins include different neighboring speech.                                             |
|  10 | Core Acoustic Span Design                      | Machine-only, source-global, conservative, pre-Gold.                                              |
|  11 | Core Span Evidence                             | Canonical timing, trusted tokens, VAD, request transforms, fixed margins.                         |
|  12 | Core Span Status                               | 0 verified, 8 caution, 4 ambiguous, 0 unavailable.                                                |
|  13 | Neighboring Event Handling                     | Retained outside core and marked, never silently merged.                                          |
|  14 | Overlap Handling                               | Explicit ambiguity; selected overlap-ambiguous count 0.                                           |
|  15 | Token-to-Core Projection                       | 64 candidates projected with explicit status.                                                     |
|  16 | Grouped-word Mapping                           | 184 grouped tokens with child identity/interval retention.                                        |
|  17 | Untimed Evidence                               | 5 untimed/unprojectable.                                                                          |
|  18 | Projection Coverage                            | 49 core-projectable, 15 unprojectable.                                                            |
|  19 | Full Text vs Core Text                         | Both retained and separately hashed.                                                              |
|  20 | Candidate Comparability                        | 8 full, 4 partial.                                                                                |
|  21 | Comparable Events                              | 8.                                                                                                |
|  22 | Partially Comparable                           | 4.                                                                                                |
|  23 | Unlocalizable                                  | 0.                                                                                                |
|  24 | Stability Taxonomy                             | Nine strict classes implemented and schema-validated.                                             |
|  25 | Core Text Consistent                           | 0.                                                                                                |
|  26 | Context-only Difference                        | 0.                                                                                                |
|  27 | Lexical Core Disagreement                      | 4.                                                                                                |
|  28 | Hallucination Disagreement                     | 2.                                                                                                |
|  29 | Adjacent Utterance Contamination               | 2.                                                                                                |
|  30 | Speaker Mix                                    | 0.                                                                                                |
|  31 | Partial Agreement                              | 4.                                                                                                |
|  32 | Local Gold Evaluation Design                   | Post-freeze fixed-margin local evaluator.                                                         |
|  33 | Gold Isolation                                 | Passed; runtime Gold input 0.                                                                     |
|  34 | Local Monotonic Alignment                      | 3 exact monotonic-local cases plus monotonic ordering checks.                                     |
|  35 | Many-to-many Evaluation                        | One-to-many 5; many-to-one 2.                                                                     |
|  36 | Evaluable Events Before                        | 5.                                                                                                |
|  37 | Evaluable Events After                         | 10.                                                                                               |
|  38 | Remaining Unevaluable                          | 2.                                                                                                |
|  39 | Unevaluable Reasons                            | Both insufficient local reference; overlap/mapping conflict 0.                                    |
|  40 | C6.0.1.7 Fresh Core Results                    | 36 request-level inputs localized; none yields stable-core agreement.                             |
|  41 | Optional C6.0.1.8 Core Fresh Verification      | Not required; existing evidence sufficient.                                                       |
|  42 | Fresh Verification Requests                    | 0 selected/planned/actual.                                                                        |
|  43 | Core Stability Before                          | Five formal window-instability cases plus seven unevaluable cases.                                |
|  44 | Core Stability After                           | 0 consistent; more precise taxonomy, local evaluability 10/12.                                    |
|  45 | Candidate Oracle V2                            | 8 current-error-comparable events; 107 to 96.                                                     |
|  46 | Oracle Metric Direction                        | Lower character-error count is better.                                                            |
|  47 | Existing Pool Core Oracle                      | 53 across 5 available/shared events.                                                              |
|  48 | Fresh Pool Core Oracle                         | 119 across 10 available; 54 across the 5 shared events.                                           |
|  49 | Core Verification Oracle                       | Not applicable; verification not run.                                                             |
|  50 | Oracle Improvement/Regression                  | Overall improvement 11; shared Fresh vs old delta +1, a regression.                               |
|  51 | Baseline-wrong Event Count                     | 7 current-error-comparable events have error > 0.                                                 |
|  52 | Pipeline Correct Candidate Exists              | 0 exact-correct candidate opportunities.                                                          |
|  53 | Context Difference Only                        | 0.                                                                                                |
|  54 | ASR Core Stable Correct                        | 0.                                                                                                |
|  55 | ASR Core Stable Wrong                          | 0.                                                                                                |
|  56 | ASR Core Lexically Unstable                    | 5 diagnoses; 4 are baseline-wrong.                                                                |
|  57 | ASR Hallucination Unstable                     | 1.                                                                                                |
|  58 | Candidate Application Blocked                  | 0.                                                                                                |
|  59 | Localization Blocked                           | 4 diagnoses; 2 are current-error-comparable baseline errors.                                      |
|  60 | Evaluation Blocked                             | 2 reference-alignment blockers.                                                                   |
|  61 | Pipeline Opportunity Count                     | 0 strict exact-correct opportunities; 4 nonzero-error oracle improvements.                        |
|  62 | Stable Wrong Count                             | 0.                                                                                                |
|  63 | Lexical Instability Count                      | 5 diagnoses; 4 remaining baseline errors.                                                         |
|  64 | Hallucination Instability Count                | 1.                                                                                                |
|  65 | Insufficient Count                             | 6 total localization/reference blockers.                                                          |
|  66 | Pipeline-vs-ASR Route Decision                 | `RECOMMEND_SECOND_ASR_ENSEMBLE`.                                                                  |
|  67 | Recommendation Confidence                      | `MEDIUM`.                                                                                         |
|  68 | Supporting Counts                              | Comparable 12; evaluable 10; pipeline 0; ASR 6; localization 4; reference 2.                      |
|  69 | Second ASR Recommendation                      | Yes; next-stage recommendation only.                                                              |
|  70 | Final Exact CER                                | `0.6601049868766404`.                                                                             |
|  71 | Final Normalized CER                           | `0.6015625`.                                                                                      |
|  72 | Coverage                                       | `0.96484375`.                                                                                     |
|  73 | Missing                                        | 6.                                                                                                |
|  74 | Hallucination                                  | 1.                                                                                                |
|  75 | Material Errors                                | 77.                                                                                               |
|  76 | Severe Timing                                  | 53.                                                                                               |
|  77 | Start MAE                                      | `1.6091082275459374 s`.                                                                           |
|  78 | End MAE                                        | `1.6078355157481543 s`.                                                                           |
|  79 | P95                                            | `5.384999999999991 s`.                                                                            |
|  80 | IoU                                            | `0.5824665676077242`.                                                                             |
|  81 | Overlap                                        | 48.                                                                                               |
|  82 | Final Text Mutations                           | 0.                                                                                                |
|  83 | Final Timing Mutations                         | 0.                                                                                                |
|  84 | Shadow Outcome                                 | A/B both `needs-review`, `finalizationMethod = none`; semantic parity true.                       |
|  85 | Unsafe Escape                                  | 0.                                                                                                |
|  86 | Production Status                              | `needs-review`.                                                                                   |
|  87 | C6.0.2 Gate                                    | Failed.                                                                                           |
|  88 | Next-stage Recommendation                      | Second independent ASR/ensemble evidence; stop single-Whisper rule expansion.                     |
|  89 | Gold Runtime Input                             | 0.                                                                                                |
|  90 | Dataset Hardcoding                             | 0.                                                                                                |
|  91 | Network                                        | Not used.                                                                                         |
|  92 | Source Read-only                               | Passed.                                                                                           |
|  93 | Gold Read-only                                 | Passed.                                                                                           |
|  94 | Shareable                                      | A/B each 1 validated artifact; leak/secret/broken-reference counts all 0.                         |
|  95 | C5.19 Regression                               | Passed in full/targeted suites.                                                                   |
|  96 | C6 Investigation Regression                    | Passed.                                                                                           |
|  97 | C6 Protected Regression                        | Passed.                                                                                           |
|  98 | C6.0.1 Regression                              | Passed.                                                                                           |
|  99 | C6.0.1.1 Regression                            | Passed.                                                                                           |
| 100 | C6.0.1.2 Regression                            | Passed.                                                                                           |
| 101 | C6.0.1.3 Regression                            | Passed.                                                                                           |
| 102 | C6.0.1.4 Regression                            | Passed.                                                                                           |
| 103 | C6.0.1.5 Regression                            | Passed.                                                                                           |
| 104 | C6.0.1.6 Regression                            | Passed.                                                                                           |
| 105 | C6.0.1.7 Regression                            | Passed.                                                                                           |
| 106 | Unit Tests                                     | 91 files; 696 passed, 2 skipped.                                                                  |
| 107 | E2E                                            | 21 files; 40 passed, 1 skipped.                                                                   |
| 108 | Targeted Tests                                 | 42 files; 190/190 passed.                                                                         |
| 109 | Schemas                                        | 251 generated; strict validation passed.                                                          |
| 110 | Skill Validation                               | `Skill is valid!`.                                                                                |
| 111 | Skill2/3                                       | Not modified.                                                                                     |
| 112 | Engineering Milestone                          | Passed.                                                                                           |
| 113 | Diagnostic Milestone                           | Passed.                                                                                           |
| 114 | Route Decision                                 | `RECOMMEND_SECOND_ASR_ENSEMBLE`, `MEDIUM`.                                                        |
| 115 | Remaining Risks                                | Known-set only, no safe mutation, 6 blockers, quality gate failed, no unseen validation.          |
| 116 | Commits                                        | Five implementation commits below; report is in the acceptance commit.                            |
| 117 | Remote HEAD                                    | Verified after the report commit is pushed; exact SHA is reported in the final delivery response. |
| 118 | Output Paths                                   | Eleven accepted paths listed below.                                                               |

## Required Q1–Q16 answers

1. **Q1 — Context-only among the five formal C6.0.1.7 window-instability events:** 0 exact `CONTEXT_ONLY_DIFFERENCE` classifications.
2. **Q2 — True lexical-core disagreement among those five:** 0 exact `LEXICAL_CORE_DISAGREEMENT` classifications. Three are `PARTIAL_CORE_AGREEMENT`, so they are not silently counted as pure lexical disagreement.
3. **Q3 — Hallucination disagreement among those five:** 1 (`canonical-event-0002`).
4. **Q4 — Did stability significantly improve after core projection?** No. Projection made the cause more specific, but `CORE_TEXT_CONSISTENT = 0`; the evidence does not support a significant stability gain.
5. **Q5 — C6.0.1.7 unevaluable events recovered by local many-to-many Gold alignment:** 5 of 7, raising evaluability from 5 to 10.
6. **Q6 — Remaining blockers:** 2 `UNEVALUABLE_INSUFFICIENT_REFERENCE` cases, each with no Gold cue in the fixed local margin. Overlap and mapping-conflict blockers are 0.
7. **Q7 — Correct or clearly better machine core candidates on baseline-wrong events:** 0 exactly correct; 4 of 7 have a lower-error candidate, but every winning error remains nonzero.
8. **Q8 — Multiwindow-stable but stably wrong Whisper cores:** 0.
9. **Q9 — Baseline-wrong events that remain lexically unstable on the same core:** 4. The taxonomy contains 5 lexical-instability diagnoses, but one is already correct and is not counted as a remaining error.
10. **Q10 — Fresh instability that is actually adjacent-utterance contamination:** 1 of the original five (`canonical-event-0048`); 2 across all 12 selected events.
11. **Q11 — Does the oracle show a clear final-pipeline application opportunity?** No strict opportunity: exact correct candidate count is 0. It shows 4 limited lower-error ranking opportunities, insufficient for a safe canonical application claim.
12. **Q12 — Did optional Core Fresh verification change the stability diagnosis?** No; it was not required and produced 0 requests/inference, so changed count is 0.
13. **Q13 — Current remaining pipeline vs single-ASR errors:** strict pipeline opportunity 0; among demonstrably baseline-wrong comparable events, single-ASR lexical/hallucination instability accounts for 5 (4 + 1), while 2 additional errors remain localization-blocked. The broader diagnosis table has 6 ASR-limited entries because one unstable event is already correct.
14. **Q14 — Final technical route:** `RECOMMEND_SECOND_ASR_ENSEMBLE`.
15. **Q15 — Is a C6.0.1.9 single-Whisper rule version worthwhile?** No. `STOP_SINGLE_WHISPER_RULE_EXPANSION`.
16. **Q16 — Strict C6.0.2 gate:** No; it remains failed and release remains unauthorized.

## Commits and remote state

Implementation commits before this report:

1. `ee930e1` — `feat: add machine-only acoustic core spans and token projection`
2. `68f62b8` — `feat: add localized candidate comparability and ASR stability taxonomy`
3. `090c7d8` — `feat: add Gold-isolated local core alignment evaluator`
4. `5250dd0` — `feat: add bounded core fresh verification and oracle v2`
5. `cc85049` — `feat: add final pipeline-vs-ASR route decision`

The acceptance commit is the commit containing this report. A Git commit cannot include its own final SHA without changing that SHA; the final delivery response records the exact acceptance and verified remote SHA after push.

## Accepted real output paths

1. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-baseline-20260829`
2. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-core-span-20260829`
3. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-core-projection-20260829`
4. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-comparability-20260829`
5. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-stability-20260829`
6. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-local-evaluation-20260829`
7. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-core-fresh-verification-20260829`
8. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-final-diagnosis-20260829`
9. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-final-a-20260829`
10. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-final-b-20260829`
11. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-8-validation-20260829`
