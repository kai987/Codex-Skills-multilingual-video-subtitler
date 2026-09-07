# C6.0.1.16.2.1 — Timestamp Semantics & Evidence-to-Decision Reachability Audit

## Outcome and scope

Audit date: 2026-09-07. Base: `5f1c08a53045dd32121b54482820f7f27d2ec197`. Branch: `codex/c6-0-1-16-2-1-timestamp-capability-reachability`, created in an independent worktree after read-only identity and protection checks.

**Audit engineering passed; acoustic correction capability did not pass and was not changed. STOP_SAME_POLICY_REINFERENCE.**

The actual Reazon adapter emits `TOKEN_POINTS`, which the frozen localizer always marks `complete=false`. Both replacement and consistency-supported KEEP require four complete observations: two independently bound windows from each provider family. Thus these branches are structurally unreachable for the actual provider combination, even if all recognized texts were correct and identical. This is not merely three difficult audio cases.

Conclusions:

- `TIMESTAMP_MAPPING_CONSISTENT_CAPABILITY_MISMATCH`: the implemented formula agrees with the version-compatible padded-input contract; no mapping bug was proved.
- `RAW_EVIDENCE_AVAILABLE_BUT_NOT_CONSUMED`: Whisper token intervals were saved and parsed, then omitted from the experiment observation.
- `RUNTIME_TIMESTAMP_SEMANTICS_UNVERIFIED` applies narrowly to exact installed native-wheel source provenance. Overall semantics gate: `PARTIALLY_VERIFIED`, not fully verified binary behavior.
- Quality: `NOT_EVALUATED_NO_SUBTITLE_CHANGE`; publication/default promotion remains unauthorized.

This is development-known material, not a new blind evaluation. No Gold content was parsed or used, no CER was recalculated, and no scene answer, reference timing or human label determined a coordinate, filter or capability declaration. Mechanical protection hashing of the pre-existing reference is not a new reference evaluation. The named subtitler skill's preservation and non-finalization constraints were retained; no transcription workflow was initiated.

## Identity and zero-inference replay

The formal historical input is `machine-quality-c6-0-1-16-2-20260907-experiment-01`, not a ZIP-name inference or a substituted .16.1 cohort. The new final output is `timestamp-capability-audit-c6-0-1-16-2-1-20260907-final` under the local output root. Its six concentrated audit files contain private response text and paths and are **local-only, not public-shareable**.

| Identity                 | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Frozen request plan      | `7f491413654f51a98be45bcb46bb1448a28aacdc00740f1dea11ab01fd5f7186` |
| Primary evidence         | `23d71937da4afb640c5dcdc0921557a87b45ce4ed8af2a6b5475f648f0e9e074` |
| Frozen acoustic evidence | `5c7078578db5e249e923b811e924ce2618e0a6d6d81db518359a3e0056b78741` |
| Generation freeze        | `bd239d5c52cd74e39d0e14af426a6127f4e10e4e7c9f37181d8caa3e0ebc9478` |
| Stable shadow audit      | `b9d8f0601dc7825cf2dd122092972198a3cdad23c72633eefb22a17c00de395d` |

12/12 persisted responses are present and verified against their request, plan, raw-result, observation and frozen-bundle identities. Exact normalization replay: 12/12. L0 legacy decision replay: 3/3 exact. All historical A/B generation payload hashes were checked. No subtitle generation chain was rerun: this is an identity/non-mutation check, not a claim of newly generated subtitles.

Historical counts, kept separate: Whisper 6 + Reazon 6 = 12 attempts; six physical clips total 49 seconds; per-provider raw requests total 98 seconds; padded decoder inputs total 108.8 seconds. Six isolated Whisper process records plus the one Reazon ready handshake account for 7 process starts / 7 model loads (Whisper load counts inferred from its successful isolated processes). The ready handshake must not be summed six times from repeated response envelopes. Failures/retries/cache hits were zero. L0 reproduces 1 CORE_COMPARABLE, 5 CONTEXT_CONTAMINATED, 6 UNLOCALIZABLE and three ABSTAIN decisions.

New counts are all zero: inference, model load, Provider start, recognition attempt, decoded-audio seconds. Reading the cohort is `VERIFIED_RESPONSE_REPLAY`, not inference and not a new model cache hit. Audit execution used Node 24 permissions with an explicit input allowlist and no child-process, addon or network permission; no provider runtime is imported. Audio bytes were hashed for identity only, not decoded, re-extracted or altered.

## Provider → evidence → action

| Actual configured provider                     | Raw / adapter                                                                   | Experiment observation and consumer                                                                         | Missing capability                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Whisper.cpp 1.9.1, large-v3, Metal, CoreML off | Full JSON segments and estimated token intervals; adapter parses segment.tokens | SEGMENT_INTERVALS retains segment text/start/end; token intervals omitted; localizer consumes segments only | Token evidence is RAW_AVAILABLE_BUT_NOT_EXPOSED to this observation; no verified event identity or repeat count  |
| Reazon k2 v2, fp32 CPU, greedy_search          | Worker persists zipped token/emission-point pairs; provider passes them through | TOKEN_POINTS with one padding subtraction and one source offset; localizer never grants completeness        | UNSUPPORTED_BY_ACTUAL_ADAPTER: duration intervals, complete core localization, same-event identity, repeat count |

Whisper's `completeLocalization=SUPPORTED_BY_ACTUAL_ADAPTER` means it can satisfy the **existing geometric localizer predicate**, not that it proves complete speech/lexical coverage. Reazon's point fields are supported, while exact emission semantics retain the separate partial-verification qualification. Capabilities are bound to actual adapter hash, model, runtime and frozen decode config in `provider-action-matrix.json`; they are not claims about hypothetical future model features.

Identity anchors:

- Whisper adapter: `a13e9b35f00f9a3cfc6c0cb2fec52fb51d1fe5a3eecd01bc9cd18c9d1f55a2dc`; binary: `939c82ebcd37d6699e38ad539b337eb63d2d58cc307f65887ec358c05ec43942`; model: `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`.
- Reazon adapter: `eca0b11df87da9076404e4c02de2651f6221e48c014641807dd59550f4770c8e`; worker: `bea411b3fa8509f5cfec00d1d254d0d85e8842b5d254fb2b2c94c8e989e9d2dc`; model revision: `291488c8151be24d7da4bf7af26e533fad96e407`; snapshot: `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`.
- Reazon runtime metadata: Python 3.13.14, sherpa-onnx 1.13.6, numpy 2.2.2. Installed native extension hash: `4307213897c81ced0f263a91ef119185972ed75df72efbdb04a338e2a6d36665`. Metadata and bytes were read without importing the extension or loading a model.

| Branch                                       | Structural status under frozen policy                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| REPLACE_WITH_LOCALIZED_FRESH_CANDIDATE       | UNREACHABLE_PROVIDER_CAPABILITY_MISMATCH                                          |
| KEEP_STAGE_INPUT (consistency-supported)     | UNREACHABLE_PROVIDER_CAPABILITY_MISMATCH: same allComparable gate                 |
| ABSTAIN_KEEP_STAGE_INPUT                     | POTENTIALLY_REACHABLE, exercised by all three cases; not correctness confirmation |
| COLLAPSE_CONFIRMED_SAME_EVENT_REPRESENTATION | POLICY_DISABLED; also no implemented action or same-event evidence source         |
| utteranceStructure                           | DECISION_PATH_NOT_IMPLEMENTED: literal UNKNOWN                                    |

Of seven classification enum values, UNKNOWN has a reachable fallback. WHOLE_HYPOTHESIS_UNSUPPORTED_BY_NEW_ASR has an abstract branch but requires the unreachable agreement gate. REAL_REPEATED_SPEECH_SUPPORTED, SAME_EVENT_DUPLICATE_REPRESENTATION_SUPPORTED, DECODER_LOOP_SUSPECTED, ADJACENT_DISTINCT_UTTERANCES_SUPPORTED and MIXED_REPETITION_AND_LEXICAL_ERROR have no decision implementation.

All three classification UNKNOWN results therefore sit behind the structural support failure; all three utteranceStructure UNKNOWN values are unimplemented. These are two dimensions on the same three cases, not six independent acoustic failures. The audit does not determine the true repetition count.

| Case    | Complete supports W / R | allComparable | Isolated current-stage span | Additional case limitation                                                                                        |
| ------- | ----------------------- | ------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| case-01 | 1 / 0                   | false         | false                       | Multiple occurrences / expanded core; even hypothetical complete support would not authorize isolated replacement |
| case-02 | 0 / 0                   | false         | true                        | Both Whisper windows cross a core boundary                                                                        |
| case-03 | 0 / 0                   | false         | true                        | Both Whisper windows cross a core boundary                                                                        |

The new pure `checkActionCapabilities` distinguishes ACTION_VALIDATION from OBSERVATION_ONLY. It returns expected structured incompatibility, not an exception or model failure. Observation-only study may be meaningful but never implies execution authorization. The checker is available before a future request planner; it is deliberately not wired into or used to rewrite the frozen .16.2 execution plan. Unknown policies return unresolved rather than silently selecting a new strategy.

## Reazon timebase and per-point audit

The local worker physically pads 14,400 samples at 16 kHz (0.9 seconds) on each side. The provider does not remove padding; the experiment runner performs exactly:

```text
t_raw = t_padded - 0.9
t_global = window_source_start + t_raw
```

Fixed official sherpa-onnx v1.13.6 source, commit `1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911`, records the frame index at nonblank greedy emission, then converts it with frame shift and subsampling factor to seconds. See the [pinned greedy decoder](https://github.com/k2-fsa/sherpa-onnx/blob/1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911/sherpa-onnx/csrc/offline-transducer-greedy-search-decoder.cc) and [pinned transducer conversion](https://github.com/k2-fsa/sherpa-onnx/blob/1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911/sherpa-onnx/csrc/offline-recognizer-transducer-impl.h). This is an emission point relative to the accepted padded waveform, not a word onset/end or duration. It is version-compatible evidence; an exact source-to-installed-wheel build attestation is unavailable. No upstream master assumption or model probe was used.

Accordingly the following classifications are explicitly **conditional on that version-compatible contract**, not full binary-semantic verification. Original coordinates and conversions remain visible. No alternative offset was guessed and no conversion bug was confirmed. Read-only source-document network access was separate from experiment execution: no model downloads or user audio uploads.

| Point region                                        |     Count |
| --------------------------------------------------- | --------: |
| Leading padding                                     |         4 |
| Physical context before core                        |         9 |
| Physical core                                       |        51 |
| Physical context after core                         |        13 |
| Trailing padding                                    |         5 |
| Boundary contact                                    |         3 |
| Outside decoded waveform / nonfinite / nonmonotonic | 0 / 0 / 0 |
| Total zipped points                                 |        85 |

Half-open region conventions reserve all exact/roundoff boundary contacts as their own category with no implied positive duration. All three observed contacts are at decoded-input start, hence outside the unpadded physical window. Numerical tolerance is only eight scaled IEEE-754 machine epsilons for arithmetic roundoff, not an acoustic tolerance; no Gold-dependent or sample-duration tuning occurs. Whisper outside-window roundoff uses the same rule. Raw samples, padded samples and source-global seconds remain separate.

All six old Reazon observations have at least one point outside the physical window, which makes the old localizer return empty text for the entire observation. Four have core-internal points that the independent shadow can preserve; two have no strictly interior core points. These diagnostics do not recover complete transcripts:

| Reazon request | Points | Strict core points | Contiguous core fragments |
| -------------- | -----: | -----------------: | ------------------------: |
| case-01-w1     |      9 |                  4 |                         1 |
| case-01-w2     |      7 |                  0 |                         0 |
| case-02-w1     |      1 |                  0 |                         0 |
| case-02-w2     |     17 |                  2 |                         1 |
| case-03-w1     |     29 |                 27 |                         1 |
| case-03-w2     |     22 |                 18 |                         1 |

Every row retains request identity, original index, original/padded/raw/global values, flags and region. Excluded indices and fragment boundaries remain explicit; separate fragments are never concatenated into a sentence. A nonfinite, out-of-decoder or nonmonotonic conflict suppresses partial projection. Unverified semantics suppress it; partial semantics is visibly conditional. `complete=false` and `decisionEligible=false` always remain.

Six of six persisted token concatenations equal their response text after the existing trim operation. But the worker saved only `zip(tokens, timestamps)`, not the original arrays. Thus all six are `RAW_CARDINALITY_UNVERIFIABLE`: text agreement does not prove equal original array lengths. There is no clamping, automatic head/tail deletion, guessed duration, adjacent-point interval construction or character-duration allocation. Padding points do not prove fake words.

## Whisper stored evidence and geometric completeness

The frozen request really requested full JSON/token timestamps. Existing raw fields were returned and parsed, not inferred from the request flag. Local CLI source commit `f049fff95a089aa9969deb009cdd4892b3e74916` writes offsets in milliseconds from internal 10 ms ticks; the adapter divides by 1000. Source file hash: `bd7be1edc6ca295df3f638eb67e41c3422e4728dcc0ee70e0c197705f0976e36`. Full JSON token text/offset pairing is preserved, including UTF-8 token handling and special tokens. The unavailable DTW marker `t_dtw=-1` is not a negative duration interval.

| Request    | RETURNED / PARSED | TRANSPORTED / CONSUMED | Shadow core intervals |
| ---------- | ----------------: | ---------------------: | --------------------: |
| case-01-w1 |           31 / 31 |                  0 / 0 |                    16 |
| case-01-w2 |           51 / 51 |                  0 / 0 |                    22 |
| case-02-w1 |           27 / 27 |                  0 / 0 |                    15 |
| case-02-w2 |           10 / 10 |                  0 / 0 |                     4 |
| case-03-w1 |           31 / 31 |                  0 / 0 |                    24 |
| case-03-w2 |           36 / 36 |                  0 / 0 |                    23 |
| Total      |         186 / 186 |                  0 / 0 |                   104 |

There are 37 zero-duration rows, 24 special-token rows (overlapping categories), and one outside-physical-window interval. No missing/nonfinite offsets, invalid negative/reversed intervals, parent-boundary violations or within-segment start-order violations were observed. All originals remain visible. Shadow filtering accepts only positive nonspecial, valid, physically contained intervals fully inside the core; it does not claim global lexical completeness or acoustic truth. VALIDATED remains `NOT_VALIDATED_FOR_LEXICAL_COMPLETENESS_OR_EVENT_COUNT`. Parsing `tokenTimestampsUsed=true` in the adapter is not evidence that the experiment consumed those tokens.

`CONTEXT_CONTAMINATED` here specifically means `SEGMENT_CROSSES_CORE_BOUNDARY`, not proven semantic contamination from adjacent dialogue. Conversely, complete=true proves only that an inside segment exists and all intersecting segments are contained, not full speech coverage or correct words. Silence can legitimately occupy part of the core; requiring ASR to fill every instant would also be wrong. Boundary separability, coverage and lexical truth remain distinct.

## Patch boundary, tests and protection

L0 reuses the frozen schemas, exact normalization shape, localizer and decision function. L1 adds capabilities, per-point diagnostics and stored-token shadow projection only. It never enters `applyAcousticDecisions`. No default profile, threshold, production adapter, worker, original report, subtitle, audio, lockfile, Skill 2 or Skill 3 source was changed.

The old successful four-interval test remains, explicitly named `ABSTRACT_FULL_INTERVAL_DECISION_UNIT_TEST`. It proves an abstract branch for synthetic complete intervals; it cannot certify actual Reazon points. New neutral shape-faithful tests cover all-valid core points still incomplete, identical four texts still blocked, synthetic/actual capability mismatch, isolated scope, literal UNKNOWN, single padding conversion, region boundaries, no clamping/interval invention, conditional fragments, unknown cardinality, missing versus discarded Whisper tokens, geometric versus semantic contamination, no mutation and pre-execution purpose checks.

The new E2E launches only restricted Node audit test processes; an attempted child-process call is denied by Node permissions before any process starts. It does not launch an ASR process. Real artifact replay was also executed twice in separate restricted processes: identical stable hash and all five non-clock audit payload files byte-identical; actual manifest timestamps remain separate.

Validation uses Node 24 / npm 11 and sets `MVL_MFA_INTEGRATION_TEST=0`, `MVL_SPEAKER_INTEGRATION_TEST=0`. These real-model integration tests are skipped, not passed.

| Check on final implementation                   | Actual result                                                 |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Typecheck / lint / format check / build         | All passed                                                    |
| Full suite                                      | 164 files; 1,379 passed, 2 skipped                            |
| New focused suite                               | 2 files; 19 passed                                            |
| Separate E2E rerun                              | 38 files; 86 passed, 1 skipped                                |
| Existing strict bundle / observation validation | Passed; 12 exact normalized observations                      |
| Two independent real-response audits            | Stable hash identical; five non-clock payloads byte-identical |
| Historical protection                           | 6,873 files unchanged                                         |

Focused and E2E results are subsets of the full suite, not additional unique passes. The final full-suite execution was after the numerical-roundoff-only shadow patch; no production decision source changed. Implementation commits are `b08fc82` (capabilities and contract tests) and `8917ac1` (zero-inference response audit and E2E). The final documentation commit and verified Local/Upstream/Remote identity are bound by the local acceptance receipt, avoiding a self-referential commit hash inside this report.

Protected .14.6 dirty work, .16/.16.1/.16.2 worktrees, staged/unstaged/untracked state and historical artifacts: **6,873 files unchanged** in the final protection check. The pre-existing dirty work was neither staged nor committed here. Only generic audit code/tests and this redacted report are authorized for the new branch; no raw responses, scene text, private paths, audio, models, Gold or caches are committed.

| Unchanged E0/E1 identity | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Canonical text           | `be53fcbfe85bbf4f9414e30303317584c8c82c0d826235096abf691bbf8e3af4` |
| Canonical timing         | `7bf5b5c788294fb051cd3b8904ee4f0d683bdd049a9e9afb7aa733866be91ae3` |
| Presentation             | `1b0d0fe1f509375419b06a2d06795e9a0784620aaf01456a50c9068a0f882cce` |
| ASS                      | `8fcb6388990733deada73d7a6cbdacd151c8239381f1cf0f58134c7038771828` |
| SRT                      | `14a466a05defd82a93fc9971c5f0c5235790f6e1f432009f416498dad9f07713` |
| VTT                      | `c20861f122d0fa52082b1964333beb8932a1501da27ad72d8e38ce23b83c3049` |

Inherited normalized CER 0.47119140625 and S/D/I/N 599/212/154/2048 are `INHERITED_BASELINE_METRICS_NOT_REEVALUATED`, copied from the old report, not measured anew. The held quality state, needs-review and finalizationMethod=none remain unchanged.

## Reproduction and stopping decision

Build the repository, then run `npm run audit:acoustic:capability -- <existing-experiment-directory> <new-audit-directory> <semantics-metadata.json>`. The third file is the provenance object recorded under `audit-manifest.json.semantics`; it must describe the audited installed version, not an assumed newer version. Allocate an unused output directory. The command does not accept Gold or model execution arguments; missing or mismatched artifacts fail closed. For the strict execution boundary, invoke the script using Node `--permission` with read access only to the repository, approved historical input files and semantics metadata, and write access only to the new audit directory. Do not grant child-process, addon or network access. Source-file and input hashes bind the audit implementation; the local acceptance receipt binds its final commit.

| Gate                | Outcome                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Audit Engineering   | PASSED: source proof, 12 response replays, shadow diagnostics, tests, protection                           |
| Timestamp Semantics | PARTIALLY_VERIFIED; no proved conversion bug; exact wheel provenance limitation retained                   |
| Provider / Action   | Replacement and supported KEEP incompatible; abstain reachable; collapse disabled; structure unimplemented |
| Quality             | NOT_EVALUATED_NO_SUBTITLE_CHANGE                                                                           |
| Execution           | All five new-execution counters zero                                                                       |
| Publication         | Default unchanged; automatic subtitle release not authorized                                               |

**STOP_SAME_POLICY_REINFERENCE.** The minimum missing capability is a validated, source-bound **complete core-localization contract** that the actual second provider can expose and the consumer can preserve. An explicit weak-point policy would instead be a different decision experiment. Either requires separately authorized budget and controls; fixing padding labels alone is insufficient. No next model experiment, aligner, provider switch or policy relaxation was implemented or started.
