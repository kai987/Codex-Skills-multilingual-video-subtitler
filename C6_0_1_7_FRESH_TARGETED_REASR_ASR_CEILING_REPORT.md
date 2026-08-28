# C6.0.1.7 Fresh Targeted Re-ASR Execution & ASR Ceiling Validation

Date: 2026-08-29

Policy: `c6.0.1.7-fresh-targeted-reasr-asr-ceiling-v1`

Policy SHA-256: `ad70d2cbc5ecea0cea6e779da26fe6cd2b6d2cfeb15e77497e02367c3f411ca8`

## Executive conclusion

C6.0.1.7 real-model engineering acceptance passed. The run corrected the meaning of Re-ASR risk, selected only events with positive or independent supporting error evidence, executed 36 genuinely Fresh Whisper requests and 28 genuinely Fresh CTC requests, replayed all of them from an isolated cache with zero inference/model load/process start, classified the observed Fresh outcomes after output freeze, and reproduced Final A/B exactly.

The quality conclusion remains deliberately conservative. Fresh Re-ASR expanded the Gold-isolated candidate-pool oracle from `0.509347670250896` to `0.5157992831541218`, an improvement of `0.006451612903225823`, but produced no candidate with enough localized evidence to propose or apply a safe canonical replacement. Canonical text mutations, canonical timing mutations, and ASS/SRT/VTT changes are all 0. Final quality is therefore unchanged: 161 cues, exact CER `0.6601049868766404`, normalized CER `0.6015625`, coverage `0.96484375`, 6 missing, 1 hallucination, 77 material errors, 53 severe timing errors, start/end MAE `1.6091082275459374 / 1.6078355157481543 s`, P95 `5.384999999999991 s`, median IoU `0.5824665676077242`, and overlap 48.

The corrected priority selected 12 events; 5 were Gold-evaluable and 4 of those 5 were genuine baseline errors, for a baseline-error hit rate of `0.8`. Four baseline-wrong events were multiwindow-unstable and seven selected events were unevaluable under the frozen localized comparison contract. This does not establish a strict `WHISPER_MULTIWINDOW_CONSISTENT_ERROR`: that count is 0. The ASR ceiling decision is consequently `INSUFFICIENT_EVIDENCE`, while the overall next-stage outcome is `HOLD_MIXED_PIPELINE_AND_ASR`. `recommendAsrEnsembleNext` remains false because the evidence does not yet isolate ASR as the sole primary ceiling.

Production remains `needs-review`, `finalizationMethod = none`, and `machineReleaseAuthorized = false`. The strict C6.0.2 quality gate failed, so unseen validation is not authorized.

## Branch, baseline, and development-set status

- Branch: `codex/c6-0-1-7-fresh-reasr-asr-ceiling-validation`.
- Exact base: `9b31914c40ef03269a28721969fad6528e327509` from C6.0.1.6.
- Official machine baseline: `carnation-c6-0-1-6-final-b-20260828`.
- Source media SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`; size `847774958` bytes; before/after read-only verification passed.
- Gold SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`; used only by isolated evaluators after output freeze; before/after read-only verification passed.
- Runtime Gold input count: 0. Candidate-text prompt leaks: 0. Human-memory leaks: 0. Dataset-hardcoding findings: 0. Network use: false.
- Carnation is a known development set. It validates engineering behavior and diagnoses current limits; it does not prove unseen-series generalization.

Goals were to distinguish missing evidence from affirmative error evidence, execute an isolated real Fresh Re-ASR budget, retain token/decoder/CTC/multiwindow evidence, compare the old and expanded pools, apply only strictly supported localized text changes, classify causal outcomes and the prior association bucket, and determine whether the remaining ceiling is pipeline, ASR, mixed, or insufficiently evidenced.

Non-goals were to alter the frozen C6.0.1.5 safe-six timing policy, change VAD or speaker algorithms, use Gold during generation, prompt Whisper with candidate or human text, force replacements, tune to Carnation-specific strings, add network inference, authorize C6.0.2, or modify Skill 2/3.

## C6.0.1.6 replay and corrected risk semantics

V0 reproduced the official C6.0.1.6/C6.0.1.5-safe-six baseline with 161 cues and identical canonical/rendered hashes. The prior C6.0.1.6 risk policy marked 155 events `RE_ASR`. C6.0.1.7 reclassifies each active fact into positive error evidence, supporting error evidence, evidence absence, positive correctness evidence, conflicting evidence, or unknown.

The important correction is that low token coverage is absence of trusted token evidence, not affirmative proof that the recognized text is wrong. `tokenWeak` therefore becomes `EVIDENCE_ABSENCE`; active `ctcWeak` and `decoderWeak` are supporting evidence rather than standalone strong error proof. Strong request-edge conflict, speech incompleteness, independent-window disagreement, token conflict, no-speech conflict, or duration/text anomaly can supply positive error evidence. Eligibility requires one strong positive fact, two independent supporting provider families, independent-window disagreement, or incomplete speech. Correlated weak facts are not double-counted.

| Risk V2 metric                               | Count |
| -------------------------------------------- | ----: |
| Events                                       |   180 |
| Old `RE_ASR` eligible                        |   155 |
| Corrected eligible                           |    46 |
| Events with positive-error evidence          |    30 |
| Events with at least two supporting families |    16 |
| Evidence-absence-only events                 |    26 |
| Budget-selected events                       |    12 |
| Selected evidence-absence-only events        |     0 |
| Planned Fresh requests                       |    36 |

Selection priority is deterministic: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, then a stable semantic tie-break. It ranks strong positive facts before independent multi-family support and never selects an absence-only event merely because token evidence is sparse.

## Fresh selection, extraction, request identity, and prompt isolation

Each of the 12 selected events receives near-exact, small-context, and expanded-context requests, for exactly 36 planned and 36 actual requests. Audio is extracted from the source in source-global time, each request uses a new request identity and the isolated namespace `c6-0-1-7-fresh-targeted-reasr-v1`, and all 36 extracted clips have distinct SHA-256 identities. No old targeted-Re-ASR result can satisfy a Fresh request.

Prompts are disabled. Candidate text, human-reviewed text, machine memory, and Gold are not accepted as runtime inputs. The official run recorded candidate-text prompt leak 0, human-memory leak 0, runtime Gold input 0, and network use false.

## Runtime and real Fresh execution

| Resource                 | Snapshot / runtime identity                                        | Version / device            |
| ------------------------ | ------------------------------------------------------------------ | --------------------------- |
| Whisper large-v3         | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` | model snapshot              |
| whisper.cpp-mvl binary   | `b5985816a5d38cf498e0f74bbf82ce5d965d2685042f20f57a1385ba4e7de10f` | `1.9.3`, Metal              |
| whisper.cpp upstream     | `371b5a7561823ab2bb32142d2751e35e7534727b`                         | `v1.9.3`                    |
| whisper.cpp patch series | `9ae5969381786395c6219d360344eeff0be0ab6083c8c359e32b29b3a586fc97` | three verified repo patches |
| Reazon CTC runtime       | `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60` | CPU                         |
| Reazon CTC model         | `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd` | model snapshot              |

The first attempted Fresh run was stopped by the retained timing-integrity guard on request 12 because an untimed grouped word carried inconsistent raw bounds. Its partial output and cache were quarantined under names containing `failed-runtime-guard-20260829`; none of those partial results was reused. The existing repo-local serializer guard patch was then verified against upstream and added to the two already required patches. This third patch nulls invalid grouped-word evidence at serialization and does not alter decoding, VAD, canonical text, or canonical timing. The official Fresh run was restarted with an empty cache namespace.

| Official Fresh execution metric          |                        Result |
| ---------------------------------------- | ----------------------------: |
| Selected events                          |                            12 |
| Planned / actual Whisper requests        |                       36 / 36 |
| Fresh Whisper inference                  |                            36 |
| Whisper cache hits                       |                             0 |
| Whisper model loads / process starts     |                         1 / 1 |
| Audio extraction / extraction-cache hits |                        36 / 0 |
| Unique audio SHA count                   |                            36 |
| Whisper transcription / wall seconds     | `45.167717291 / 46.932262875` |
| CTC requests / Fresh inference           |                       28 / 28 |
| CTC cache hits                           |                             0 |
| CTC model loads / worker starts          |                         1 / 1 |

The official Fresh generation ID is `c6017-official-20260829`. The official cache is isolated at `/Users/paulasmith/.cache/mvl/c6-0-1-7-fresh-official-20260829`.

## Fresh candidates and retained evidence

Fresh decoding produced 28 candidates. Twenty-six have complete localized evidence; two remain evidence-incomplete and are not made replaceable by default. Each candidate retains request identity, source-global window, audio SHA, token timing where trustworthy, explicit decoder availability/unknown state, CTC score and token evidence where available, and its multiwindow relationship. Missing provider facts remain unknown rather than zero.

The official Fresh pass issued 28 CTC requests because only candidates that reached the CTC verification stage were evaluated. Decoder evidence was taken from the patched runtime response; token evidence is accepted only when the token/grouped-word time contract is valid. CTC, decoder, and token weakness are supporting facts; localized disagreement or incompleteness is required to claim affirmative error evidence.

## Candidate comparison, causal evaluation, and text application

The resolver compared the inherited Primary/Recovery/current pool with the three Fresh windows for each selected event. It observed 10 Fresh multiwindow disagreements and 2 ambiguous cases; it did not observe a proven new-candidate dominance, original dominance, all-candidates-weak decision, or stable Fresh agreement. Fresh candidates ranked top-1 in 11 comparisons, but ranking alone is not sufficient for canonical replacement.

| Comparison/application metric |     Count |
| ----------------------------- | --------: |
| Compared selected events      |        12 |
| New candidate dominates       |         0 |
| Original dominates            |         0 |
| Fresh candidates agree        |         0 |
| Fresh candidates disagree     |        10 |
| All candidates weak           |         0 |
| Ambiguous                     |         2 |
| Fresh candidate top-1         |        11 |
| Runtime proxy improvements    |         0 |
| Text replacement proposals    |         0 |
| Accepted/applied replacements |     0 / 0 |
| Changed cues/spans/characters | 0 / 0 / 0 |

Gold was read only after the outputs were frozen. Five selected events were evaluable: four were baseline-wrong and one was already correct. Those four wrong events were classified as multiwindow-unstable, not safely improved or consistently wrong. Seven events were unevaluable under the frozen localized comparison contract.

| Causal metric                        |                                       Result |
| ------------------------------------ | -------------------------------------------: |
| Selected / evaluable                 |                                       12 / 5 |
| Selected Gold-error hits             |                                            4 |
| Baseline-wrong / before-correct      |                                        4 / 1 |
| Improved / no improvement / worsened |                                    0 / 0 / 0 |
| Multiwindow unstable                 |                                            4 |
| Unevaluable                          |                                            7 |
| Baseline-error hit rate              |                                        `0.8` |
| Recovery rate                        |                                          `0` |
| Safe replacement rate                |                                          `0` |
| Old pool oracle quality              |                          `0.509347670250896` |
| Fresh pool oracle quality            |                         `0.5157992831541218` |
| Oracle improvement                   |                       `0.006451612903225823` |
| Selector regret before / after       | `0.008000000000000007 / 0.01445161290322583` |

The pool-level oracle gain is a diagnostic after-freeze fact, not a runtime quality claim. There was no per-event proven safe pool improvement to apply, so the fact that the aggregate oracle improved while runtime mutations remained 0 is not attributed to a selector, span-lineage, safety-gate, or association blocker. The strict classification is insufficient localized evidence, with window instability on the evaluable baseline errors.

## Re-ASR ceiling and pipeline-versus-ASR decision

| Ceiling class                        | Count |
| ------------------------------------ | ----: |
| Untested potential                   |     0 |
| Tested improved pool                 |     0 |
| Tested no improvement                |     0 |
| Tested worsened                      |     0 |
| Tested safe replacement              |     0 |
| Tested unsafe replacement            |     0 |
| Whisper multiwindow consistent error |     0 |
| Whisper window instability           |     5 |
| Selector application blocker         |     0 |
| Span application blocker             |     0 |
| Pool insufficient                    |     0 |
| Unevaluable                          |     7 |

The ASR ceiling evaluation passed as an evidence-completeness and fail-closed milestone. Its decision is `INSUFFICIENT_EVIDENCE`; `recommendAsrEnsembleNext = false`. The overall validation outcome is `HOLD_MIXED_PIPELINE_AND_ASR`, because the run demonstrates both remaining pipeline taxonomy ambiguity and unstable/unevaluable acoustic evidence, but does not prove that current Whisper is consistently wrong on a safely localizable set.

## Association taxonomy

The inherited Gold-isolated `Association 40` bucket was re-audited without changing runtime association. All 40 are non-unique Event-to-Cue mappings under the old aggregate label; none is proven to be a true association mismatch.

| Association class            | Count |
| ---------------------------- | ----: |
| Old association-error bucket |    40 |
| True association mismatch    |     0 |
| Non-unique mapping           |    40 |
| Segmentation ambiguity       |     0 |
| Many-to-one expected         |     0 |
| One-to-many expected         |     0 |
| Event-boundary ambiguity     |     0 |
| Span-lineage ambiguity       |     0 |
| Unknown association          |     0 |

This taxonomy corrects diagnostic language only. It does not claim the 40 cases are solved and does not alter canonical data.

## Stage-wise ablation and quality

V0 through V6 and Final A/B were independently Gold-evaluated after each output freeze. Every stage retained the same 161-cue quality metrics and output hashes because no safe text or timing mutation was accepted.

| Stage   | Purpose                   | Model execution | Text/timing mutations | Exact / normalized CER | Material / severe | MAE start/end         | P95 / IoU / overlap     |
| ------- | ------------------------- | --------------- | --------------------: | ---------------------- | ----------------- | --------------------- | ----------------------- |
| V0      | Baseline replay           | no model        |                 0 / 0 | `0.660105 / 0.6015625` | `77 / 53`         | `1.609108 / 1.607836` | `5.385 / 0.582467 / 48` |
| V1      | Risk V2                   | no model        |                 0 / 0 | same                   | same              | same                  | same                    |
| V2      | Fresh selection           | no model        |                 0 / 0 | same                   | same              | same                  | same                    |
| V3      | Official Fresh generation | 36 Fresh        |                 0 / 0 | same                   | same              | same                  | same                    |
| V4      | Fresh resolver            | 36/36 replay    |                 0 / 0 | same                   | same              | same                  | same                    |
| V5      | Text application          | 36/36 replay    |                 0 / 0 | same                   | same              | same                  | same                    |
| V6      | Full candidate            | 36/36 replay    |                 0 / 0 | same                   | same              | same                  | same                    |
| Final A | Frozen policy             | 36/36 replay    |                 0 / 0 | same                   | same              | same                  | same                    |
| Final B | Independent replay        | 36/36 replay    |                 0 / 0 | same                   | same              | same                  | same                    |

Final A freeze: `63ca746578e32dd80ad0db2fe64da3ce7e96d86c95547562bb24b64cc5b8d9a8`.

Final B freeze: `821a43d0b4a1c98f7d2ef5015df1e7ba9707a43e5ba0cc0854e4e1777a8fc882`.

Final A/B parity is true for canonical text, canonical timing, presentation, Risk V2, Fresh request identities, Fresh candidates, comparison, mutation, and shadow outcome. Each replay recorded Whisper 36/36 cache hits, CTC 28/28 cache hits, Fresh inference 0, model load 0, process/worker start 0.

## Final hashes and rendered outputs

| Artifact         | Baseline / Final SHA-256                                           | Changed |
| ---------------- | ------------------------------------------------------------------ | ------- |
| Canonical text   | `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e` | no      |
| Canonical timing | `b4c5eaae50284455e502aa2bdcae38a3dd4df9c4622397af86e3790463d00e86` | no      |
| Presentation     | `a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7` | no      |
| ASS              | `f46039ec15cf1306da86babcd23d8dc769e1cdb9167cc2f0b51af930bce45981` | no      |
| SRT              | `ec2fe7c76ac235151965d728466d8592650f86b38b16e48500b4b6bf83723083` | no      |
| VTT              | `00a5936b752ba155b3e410b42c9b7a5e9d4969b441d5179494144a631983933f` | no      |

Canonical text mutation count is 0. Canonical timing mutation count is 0. The timing policy remains `frozen-c6-0-1-5-safe-six-no-new-rules`.

## Gold isolation, safety, reproducibility, and Shareable delivery

- Runtime Gold input: 0. Gold was available only to isolated evaluators after freeze, and its before/after SHA-256 is identical.
- Source and Gold were read-only. Network was not used. Dataset-hardcoding findings: 0.
- Unsafe finalization escapes: 0. Production status is `needs-review`; finalization method is `none`; machine release is false.
- Final A/B Shareable manifests each contain one validated artifact. Both have absolute-path leak 0, prohibited-secret count 0, and broken-relative-reference count 0.
- The Shareable manifest deliberately reuses the verified C6.0.1.6 Shareable summary subsystem/policy version. That subsystem version does not represent the C6.0.1.7 Fresh Evidence version, and the already validated contract was not changed without need.

## Tests, schemas, regressions, and Skill validation

- `npm run generate:schemas`: passed; 238 strict JSON Schemas generated, including 9 new C6.0.1.7 schemas.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`: passed. Build output: 21 modules, JS `205.06 kB`, gzip `64.94 kB`.
- Unit suite: 89 files passed; 688 passed, 2 skipped.
- E2E suite: 20 files passed; 39 passed, 1 skipped.
- Targeted/cross-version selection: 40 files, 182/182 passed.
- C5.19, C6 Investigation, C6 Protected, C6.0.1, C6.0.1.1, C6.0.1.2, C6.0.1.3, C6.0.1.4, C6.0.1.5, and C6.0.1.6 are covered by the full and explicit regression suites.
- `quick_validate.py` reports `Skill is valid!` for `multilingual-video-subtitler` using `/usr/local/bin/python3` with PyYAML.
- Skill 2 (`multilingual-grammar-report-generator`) and Skill 3 (`multilingual-grammar-learning-site-builder`) were not modified.

## Milestones, readiness, and remaining risks

Fresh Re-ASR engineering passed: exact budgets, actual Fresh inference, isolated request/cache identities, prompt isolation, persistent model execution, CTC verification, evidence retention, frozen replay, and Final A/B parity are all verified. ASR ceiling validation also passed as a diagnostic milestone.

The pipeline-quality milestone passes only in the narrow diagnostic sense defined by the frozen validator: the corrected selection hit rate is `0.8` and the Fresh candidate-pool oracle improved. It does not mean final subtitle quality improved. Strict C6.0.2 remains false because material errors 77 exceed 45, normalized CER `0.6015625` exceeds 0.55, severe timing 53 exceeds 30, both MAEs exceed 1.2 s, P95 exceeds 3.5 s, and overlap 48 exceeds 20.

The next-stage recommendation is to hold release and perform one evidence-design iteration that makes the seven unevaluable cases and five window-instability cases locally comparable. Do not start a second ASR/ensemble merely from the current evidence, and do not continue generic pipeline application without improving localized candidate comparability. Re-run the ceiling decision only after that evidence exists.

Remaining risks are the known development-set limitation, seven unevaluable selected events, five window-instability classifications, no proven safe text replacement, 40 non-unique association mappings, unchanged high text/timing error metrics, and the absence of unseen validation. The quarantined first Fresh attempt is retained only as failure evidence and is not an accepted artifact.

## Commits and remote state

Implementation commits before this report:

1. `4bdf22b` — `feat: correct re-ASR risk evidence semantics`
2. `3052915` — `feat: execute isolated Fresh targeted Re-ASR`
3. `d5afdba` — `feat: classify Fresh re-ASR causal outcomes`
4. `a79cd16` — `feat: apply safe Fresh candidates through frozen lineage`
5. `32806c4` — `feat: evaluate ASR ceiling with Gold-isolated taxonomy`
6. `d1c89c1` — `fix: normalize verified Whisper runtime version`

The acceptance/report commit is the commit containing this document. The branch is pushed only after final checks; the final delivery response records and verifies the exact local/remote HEAD because a commit cannot contain its own SHA without changing that SHA.

## Output paths

Accepted real outputs:

1. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-baseline-20260829`
2. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-risk-v2-20260829`
3. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-fresh-selection-20260829`
4. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-fresh-reasr-generation-20260829`
5. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-fresh-resolver-20260829`
6. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-text-application-20260829`
7. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-full-candidate-20260829`
8. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-final-a-20260829`
9. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-final-b-20260829`
10. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-ceiling-evaluation-20260829`
11. `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-validation-20260829`

Quarantined failure evidence, not accepted output:

- `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-7-fresh-reasr-generation-failed-runtime-guard-20260829`
- `/Users/paulasmith/.cache/mvl/c6-0-1-7-fresh-failed-runtime-guard-20260829`

## Requirement index 1-118

|   # | Required topic                     | Result                                                                                            |
| --: | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
|   1 | Executive Conclusion               | Real-model engineering PASS; quality/release HOLD.                                                |
|   2 | Branch                             | `codex/c6-0-1-7-fresh-reasr-asr-ceiling-validation`.                                              |
|   3 | Baseline                           | Exact base `9b31914`; official C6.0.1.6 Final B.                                                  |
|   4 | Development-set Status             | Known Carnation set; not unseen proof.                                                            |
|   5 | Goals                              | Correct risk, execute Fresh, compare/apply safely, validate ceiling.                              |
|   6 | Non-goals                          | No timing/VAD/speaker rewrite, Gold runtime use, forced release, or Skill 2/3 change.             |
|   7 | C6.0.1.6 Replay                    | Passed; 161 cues and official hashes/metrics reproduced.                                          |
|   8 | Old Risk Semantics                 | 155 old `RE_ASR` events included absence-as-risk inflation.                                       |
|   9 | Evidence Absence vs Error Evidence | Explicit V2 evidence classes; absence cannot independently trigger Re-ASR.                        |
|  10 | tokenWeak Correction               | Active `tokenWeak` is evidence absence, not positive error proof.                                 |
|  11 | CTC Risk Correction                | `ctcWeak` supports but does not alone prove an error.                                             |
|  12 | Decoder Risk Correction            | `decoderWeak` supports; missing fields stay unknown.                                              |
|  13 | Risk V2                            | Strong positive or two independent supporting families/explicit window/incomplete-speech trigger. |
|  14 | Eligibility Before                 | 155.                                                                                              |
|  15 | Eligibility After                  | 46.                                                                                               |
|  16 | Positive-error Evidence Events     | 30.                                                                                               |
|  17 | Evidence-absence-only Events       | 26.                                                                                               |
|  18 | Fresh Selection                    | Deterministic evidence-first budget selection.                                                    |
|  19 | Selection Priority                 | CRITICAL/HIGH/MEDIUM/LOW plus semantic tie-break.                                                 |
|  20 | Selected Event Count               | 12.                                                                                               |
|  21 | Fresh Audio Extraction             | 36 source-global clips, 0 extraction-cache hits.                                                  |
|  22 | Fresh Request Identity             | 36 new identities in isolated namespace.                                                          |
|  23 | Prompt Isolation                   | Passed; prompts disabled, leak counts 0.                                                          |
|  24 | Fresh Inference Count              | 36 Whisper plus 28 CTC.                                                                           |
|  25 | Cache Hits                         | Official Fresh Whisper/CTC 0/0; replay 36/36 and 28/28.                                           |
|  26 | Model Loads                        | Fresh Whisper/CTC 1/1; replay 0/0.                                                                |
|  27 | Worker Starts                      | Fresh Whisper process/CTC worker 1/1; replay 0/0.                                                 |
|  28 | Runtime                            | Whisper 1.9.3 Metal; Reazon CTC CPU; hashes recorded above.                                       |
|  29 | Fresh Candidates                   | 28.                                                                                               |
|  30 | Fresh Candidate Evidence           | 26 complete, 2 incomplete.                                                                        |
|  31 | Decoder Evidence                   | Retained with explicit availability/unknown semantics.                                            |
|  32 | Token Evidence                     | Retained only when timing integrity is valid.                                                     |
|  33 | CTC Evidence                       | 28 Fresh verifications, then 28/28 replay hits.                                                   |
|  34 | Multiwindow Stability              | 10 disagreements, 0 agreements, 2 ambiguous comparisons.                                          |
|  35 | Candidate Comparison               | 12 selected events compared under frozen localized rules.                                         |
|  36 | New Candidate Dominance            | 0.                                                                                                |
|  37 | Original Dominance                 | 0.                                                                                                |
|  38 | Window Disagreement                | 10 runtime comparisons; 5 ceiling instability classifications.                                    |
|  39 | All Candidates Weak                | 0.                                                                                                |
|  40 | Fresh Candidate Oracle             | Expanded pool evaluated only after freeze.                                                        |
|  41 | Old Pool Oracle                    | `0.509347670250896`.                                                                              |
|  42 | New Pool Oracle                    | `0.5157992831541218`.                                                                             |
|  43 | Oracle Improvement                 | `0.006451612903225823`.                                                                           |
|  44 | Selector Regret                    | Before `0.008`; after `0.01445161290322583`.                                                      |
|  45 | Text Replacement Proposals         | 0.                                                                                                |
|  46 | Text Replacement Applied           | 0.                                                                                                |
|  47 | Final Text Hash                    | `bdb9e93c39d799f2a136cb023a3de1a4d7bde904c2f0f5f13a2f3e3fbeb8c48e`.                               |
|  48 | Re-ASR Causal Taxonomy             | 12 selected; 5 evaluable; 4 unstable baseline errors; 7 unevaluable.                              |
|  49 | Untested Potential                 | 0.                                                                                                |
|  50 | Tested Improved                    | 0.                                                                                                |
|  51 | Tested No Improvement              | 0.                                                                                                |
|  52 | Tested Worse                       | 0.                                                                                                |
|  53 | Safe Replacement                   | 0.                                                                                                |
|  54 | Unsafe Replacement                 | 0.                                                                                                |
|  55 | Multiwindow Consistent Error       | 0.                                                                                                |
|  56 | Window Instability                 | 5.                                                                                                |
|  57 | Baseline Error Hit Rate            | `0.8` over 5 evaluable selected events.                                                           |
|  58 | Recovery Rate                      | 0.                                                                                                |
|  59 | Safe Replacement Rate              | 0.                                                                                                |
|  60 | Association Taxonomy               | All 40 old aggregate cases classified.                                                            |
|  61 | True Association Mismatch          | 0.                                                                                                |
|  62 | Non-unique Mapping                 | 40.                                                                                               |
|  63 | Segmentation Ambiguity             | 0.                                                                                                |
|  64 | Many-to-One                        | 0.                                                                                                |
|  65 | One-to-Many                        | 0.                                                                                                |
|  66 | Event Boundary Ambiguity           | 0.                                                                                                |
|  67 | Unknown Association                | 0; span-lineage ambiguity also 0.                                                                 |
|  68 | Pipeline-vs-ASR Decision           | `INSUFFICIENT_EVIDENCE`; overall `HOLD_MIXED_PIPELINE_AND_ASR`.                                   |
|  69 | Pipeline Primary Evidence          | 40 old association cases were non-unique mapping, not proven mismatches.                          |
|  70 | ASR Primary Evidence               | 5 window-instability cases; 0 consistently-wrong cases.                                           |
|  71 | Mixed Evidence                     | Yes; instability plus unevaluable/non-unique cases.                                               |
|  72 | ASR Ensemble Recommendation        | False for the next immediate stage.                                                               |
|  73 | Exact CER                          | Baseline/final `0.6601049868766404`.                                                              |
|  74 | Normalized CER                     | Baseline/final `0.6015625`.                                                                       |
|  75 | Coverage                           | Baseline/final `0.96484375`.                                                                      |
|  76 | Missing                            | Baseline/final 6.                                                                                 |
|  77 | Hallucination                      | Baseline/final 1.                                                                                 |
|  78 | Material Errors                    | Baseline/final 77.                                                                                |
|  79 | Severe Timing                      | Baseline/final 53.                                                                                |
|  80 | Start MAE                          | Baseline/final `1.6091082275459374 s`.                                                            |
|  81 | End MAE                            | Baseline/final `1.6078355157481543 s`.                                                            |
|  82 | P95                                | Baseline/final `5.384999999999991 s`.                                                             |
|  83 | IoU                                | Baseline/final median `0.5824665676077242`.                                                       |
|  84 | Overlap                            | Baseline/final 48.                                                                                |
|  85 | Final Text Mutations               | 0.                                                                                                |
|  86 | Final Timing Mutations             | 0.                                                                                                |
|  87 | ASS/SRT/VTT Changes                | None; all hashes unchanged.                                                                       |
|  88 | Production Status                  | `needs-review`; release unauthorized.                                                             |
|  89 | Shadow Outcome                     | Final A/B semantic parity passed.                                                                 |
|  90 | Unsafe Escape                      | 0.                                                                                                |
|  91 | Gold Isolation                     | Runtime Gold input 0; evaluator-only after freeze.                                                |
|  92 | Dataset Hardcoding                 | 0 findings.                                                                                       |
|  93 | Network                            | False.                                                                                            |
|  94 | Source Read-only                   | Passed; SHA unchanged.                                                                            |
|  95 | Gold Read-only                     | Passed; SHA unchanged.                                                                            |
|  96 | Shareable                          | Final A/B passed; no path, secret, or reference defects.                                          |
|  97 | C5.19 Regression                   | Passed.                                                                                           |
|  98 | C6 Investigation Regression        | Passed.                                                                                           |
|  99 | C6 Protected Regression            | Passed.                                                                                           |
| 100 | C6.0.1 Regression                  | Passed.                                                                                           |
| 101 | C6.0.1.1 Regression                | Passed.                                                                                           |
| 102 | C6.0.1.2 Regression                | Passed.                                                                                           |
| 103 | C6.0.1.3 Regression                | Passed.                                                                                           |
| 104 | C6.0.1.4 Regression                | Passed.                                                                                           |
| 105 | C6.0.1.5 Regression                | Passed.                                                                                           |
| 106 | C6.0.1.6 Regression                | Passed.                                                                                           |
| 107 | Tests                              | 688/690 unit, 39/40 E2E, 182/182 targeted; skips retained.                                        |
| 108 | Schemas                            | 238 generated; 9 new strict C6.0.1.7 schemas.                                                     |
| 109 | Skill Validation                   | `Skill is valid!`.                                                                                |
| 110 | Skill 2/3                          | Unchanged.                                                                                        |
| 111 | Fresh Re-ASR Milestone             | Passed.                                                                                           |
| 112 | ASR Ceiling Validation             | Passed as diagnostic/fail-closed validation.                                                      |
| 113 | C6.0.2 Readiness                   | Failed strict quality gate.                                                                       |
| 114 | Next-stage Recommendation          | Hold; improve localized comparability before deciding pipeline vs ensemble.                       |
| 115 | Remaining Risks                    | 7 unevaluable, 5 unstable, 0 safe replacements, quality unchanged, no unseen proof.               |
| 116 | Commits                            | Six implementation commits plus this acceptance commit.                                           |
| 117 | Remote HEAD                        | Verified after push and reported in final delivery.                                               |
| 118 | Output Paths                       | Eleven accepted directories plus two quarantined failure-evidence paths listed above.             |
