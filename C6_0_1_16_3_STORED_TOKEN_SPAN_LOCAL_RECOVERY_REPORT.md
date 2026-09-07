# C6.0.1.16.3 — Stored Token-span Consumption & Capability-aware Local Text Recovery

## Outcome

**ENGINEERING_PASS_NO_QUALITY_GAIN**; actual application remains **CAPABILITY_REACHABLE_EVIDENCE_INSUFFICIENT**.

The stored-token path now genuinely reaches the existing intra-cue decision hook, semantic segmentation, layout and ASS/SRT/VTT exporters. A neutral, actual-provider-shape fixture replaces one source-bound text span in all three formats. The six real Whisper windows do **not** provide admissible spans: all three real cases abstain. This is an engineering delivery, not a subtitle repair success or a release approval.

S0/S1/S2 each contain 100 cues, with identical subtitle bytes, text, timing and presentation. No real text replacement, added/deleted cue, export change group or quality gain occurred. Existing lexical errors, repetition uncertainty and display overflow remain unresolved.

## Baseline and protected scope

- Base: `114dd8a411d248486789b3a7b12c253873b5ad7b`.
- Independent branch: `codex/c6-0-1-16-3-stored-token-span-local-recovery`.
- Token consumer/hook/tests: `2c1f5fe170e93cdcc6ecdbf9082438326c4fc360`.
- Frozen replay/export/evaluation implementation: `cfb65c382029d98abb5e81a7716a7afa9c4343b1`.
- The report commit is bound externally by the local delivery receipt; this document does not claim its own future SHA.
- Private protection snapshot verified **8,486 files unchanged**, together with prior worktree HEADs, staged/unstaged diffs and untracked state. Original video, human reference, historical responses and outputs remained read-only. No .14.6 planner migration, stash/reset/clean, old-work staging or force-push occurred.
- The actual Multilingual Video Subtitler Skill was read. Its source/authority and delivery boundaries were retained: this opt-in experiment does not change the default generation path, human authority, Skill 2/3 or finalization contracts. The adapter's existing pure full-JSON parser is exported without changing its parsing behavior; the replay hook is an optional fifth argument.
- Node 24 / npm 11, original lockfile and dependencies. No runtime/model upgrade or download.

Scope is **PRIMARY_ONLY_MATCHED_PROFILE**, not full historical H1 reconstruction. Historical Primary retains `HISTORICAL_TITLE_PROMPTED_EVIDENCE`. This episode is development-known; it is not an unseen blind test.

## Verified existing inputs and runtime identity

The runner verified the old plan, Primary hash, case lineage, request hashes, all twelve persisted response/result/observation hashes, six separately persisted raw full-JSON files, audio hashes and window/source-global mapping. The actual adapter parser is called, not the previous audit's 104 filtered shadow intervals. Reading responses is **VERIFIED_RESPONSE_REPLAY**, not new inference or a model-cache hit.

| Identity                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| Historical Primary bytes         | `23d71937da4afb640c5dcdc0921557a87b45ce4ed8af2a6b5475f648f0e9e074` |
| Historical experiment plan       | `7f491413654f51a98be45bcb46bb1448a28aacdc00740f1dea11ab01fd5f7186` |
| Historical frozen evidence       | `5c7078578db5e249e923b811e924ce2618e0a6d6d81db518359a3e0056b78741` |
| New derived token evidence bytes | `c09135a1d881e78ae3444240f43ced5c8723eb08d98ef2fc647c78460306bd5b` |
| New policy object hash           | `83723607c4c2c171027245a4f4a0daf640b1c752ed4e166ffe15807aeaea03e3` |
| New generation freeze bytes      | `377da858d483088cfb265a5890f3525ff78b080e412b508188c748b12f482250` |

Inherited Whisper identity: large-v3 model `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`; whisper.cpp 1.9.1 executable `939c82ebcd37d6699e38ad539b337eb63d2d58cc307f65887ec358c05ec43942`; Metal, CoreML=false. Japanese, no prompt/hotwords, max-context=0, VAD=false, temperature=0, no-fallback, beam/best-of=5, eight threads, token timestamps requested. These are persisted run identities, not newly loaded models.

Inherited Reazon: `reazon-research/reazonspeech-k2-v2`, revision `291488c8151be24d7da4bf7af26e533fad96e407`, snapshot `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`; CPU/fp32; Python 3.13.14, sherpa-onnx 1.13.6, NumPy 2.2.2; worker `bea411b3fa8509f5cfec00d1d254d0d85e8842b5d254fb2b2c94c8e989e9d2dc`. Greedy decoding, one thread, 0.9 s padding each side. Exact installed wheel provenance remains **PARTIALLY_VERIFIED**. No installation archaeology or fabricated complete word intervals.

All five counters are **0**: newRecognitionAttempts, newInferenceCount, newModelLoads, newProviderStarts, newDecodedAudioSeconds. No media extraction, fresh windows or optional real-model tests were run.

## Complete token consumption and localization contract

`stored-token-span-local-recovery-v1` uses a new strict evidence/observation envelope while preserving the old schemas and frozen policy. Full raw response, original parent/token fields, IDs, offsets, probability/DTW metadata, parsed local/global times, status, source hash, request/occurrence mapping and token-to-character coordinates are retained. No fabricated default timestamp replaces missing data. Raw extension fields intentionally remain opaque and are retained byte-provenance-bound; the surrounding transport schema is strict.

The local whisper.cpp checkout at `f049fff95a089aa9969deb009cdd4892b3e74916` was inspected. Its multilingual 51,866 vocabulary gives EOT=50257, SOT=50258, BEG=50365 and the corresponding timestamp IDs. Control removal requires verified ID **and** expected control spelling; a lexical token beginning with a control-like prefix is not discarded. Unknown vocabulary/control identities abstain. The CLI can merge incomplete UTF-8 byte pieces into one serialized record, retaining the first ID; the consumer does not claim to recover absent original byte-token IDs. Strict UTF-8 decoding and Unicode checks reject malformed pieces without silent replacement or deletion.

All 18 parent lexical reconstructions match their original parent text exactly, before normalization or localization. That proves stored-source text fidelity, **not acoustic lexical correctness**. An outside-core parent mismatch can remain local; uncertain location cannot be silently excluded.

| Real window | Raw / adapter-parsed / transported | Target-parent records consumed | Selected lexical records (diagnostic) | Admissible |
| ----------- | ---------------------------------: | -----------------------------: | ------------------------------------: | ---------- |
| case-01 W1  |                       31 / 31 / 31 |                             31 |                                    22 | No         |
| case-01 W2  |                       51 / 51 / 51 |                             26 |                                    24 | No         |
| case-02 W1  |                       27 / 27 / 27 |                             27 |                                    20 | No         |
| case-02 W2  |                       10 / 10 / 10 |                             10 |                                     6 | No         |
| case-03 W1  |                       31 / 31 / 31 |                             31 |                                    26 | No         |
| case-03 W2  |                       36 / 36 / 36 |                             36 |                                    27 | No         |
| Total       |                **186 / 186 / 186** |                        **161** |                               **125** | **0 / 6**  |

The builder inspects the complete 186-record observation to classify parents and preserve order; 161 records belong to target-intersecting parents. The other 25 are outside-parent context, not lost transport. The 125 selected lexical records are **not** 125 validated timing intervals and are not a recovered transcript.

There are 24 verified control records, 37 zero-duration records, including 13 lexical zero-duration records. These categories overlap. One out-of-physical-window record is a retained control diagnostic, not a clamped lexical timestamp. No zero-duration lexical word or punctuation is deleted to manufacture completeness.

Internal zero/missing-time lexical records may use an **ORDER_BRACKETED_SPAN** envelope from valid preceding/following lexical anchors. Member intervals remain zero/missing; no interpolation. One such real group exists in case-03 W2, but does not rescue that window's unresolved outer boundary. Edge zero/missing times, invalid/nonmonotonic timing, cross-core tokens, disconnected selection, non-unique source binding or protected-neighbor overlap prevent application. Cross-boundary tokens are never cut.

Only an isolated full current-stage input is replaceable; arbitrary substring surgery is not implemented. Exact stage hash, request/occurrence relationship and protected neighbors are checked. Each window builds a continuous source range independently. Two distinct window/audio identities must agree under the existing normalization and have overlapping source ranges; no common-substring search manufactures support. Narrower qualified window, then stable request/span ID, selects the representative. Normalization-only differences produce KEEP, not lexical recovery.

`sourceTextComplete`, `boundarySeparable`, `timebaseValid`, `sourceSpanBindingUnique`, `crossWindowSupport` and `lexicalTruthValidated` are distinct. The last remains false. Same-model window stability is `SINGLE_FAMILY_WINDOW_SUPPORTED`, never independent-model votes or acoustic truth.

## Real decisions and provider capability

| Case    | Actual obstacle                                                                                                                                   | Decision                 | Reazon role                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- |
| case-01 | Both windows have unresolved lexical/group edges; W1 has disconnected selection; multi-occurrence/expanded target is not an isolated stage source | ABSTAIN_KEEP_STAGE_INPUT | Two WINDOW_LEVEL_DIAGNOSTIC responses; no veto/vote |
| case-02 | Both windows cross the core boundary; W1 additionally has unbracketed lexical edge                                                                | ABSTAIN_KEEP_STAGE_INPUT | Two WINDOW_LEVEL_DIAGNOSTIC responses; no veto/vote |
| case-03 | Both windows cross the core boundary; W2 has an unbracketed edge/disconnected selection despite one internal bracketed group                      | ABSTAIN_KEEP_STAGE_INPUT | Two WINDOW_LEVEL_DIAGNOSTIC responses; no veto/vote |

No real candidate satisfies all gates. Partial/disconnected proposed strings remain local diagnostics, never complete replacement sentences. Detailed token coordinates, raw strings and per-condition reasons are in the local evidence and `run-a/decisions.json`.

The new generation entry actually calls the capability checker before application. All real targets are `STRUCTURALLY_REACHABLE_OBSERVATION_INSUFFICIENT`, not provider-type-incompatible. Missing/unverified tokens and an absent implementation have separate statuses. Positive real-shape synthetic tests reach `READY_FOR_EXPERIMENTAL_APPLICATION` and write actual exported text. **Actual episode application success remains zero; successful replacement is demonstrated only by the neutral fixture.**

Reazon points are not mandatory intervals. All six existing responses remain window-level diagnostics because complete core association is not established; whole-window disagreement is neither veto nor confirmation. No Reazon words are spliced into a new sentence. Independent model vote count is zero. Existing tests still show the old frozen policy incompatible with actual Reazon TOKEN_POINTS; this new strategy does not rewrite that historical conclusion.

## S0/S1/S2, isolation and pre-reference freeze

Actual output root: `output/machine-quality-c6-0-1-16-3-20260908-experiment-01` in the original local workspace (not committed).

- `S0-legacy-policy`: truly reexecutes Primary, existing deduplicator, source-preserving repetition and old frozen acoustic decisions, then existing segmentation/layout/export. ASS/SRT/VTT exactly reproduce old E1.
- `S1-token-observe`: new raw/token parsing, candidates and decisions, with application disabled; identical subtitle bytes to S0.
- `S2-token-apply`: same new evidence/decisions, application enabled at the intra-cue hook, existing downstream stages unchanged. No admitted real span, so identical subtitle bytes.

Open **`run-a/S2-token-apply/machine-candidate.ass`** for this experiment's new machine ASS. Equivalent SRT/VTT and needs-review package are beside it. `run-b` is independently generated, not copied. All 25 non-clock payloads per run have identical A/B hashes; clock manifests differ legitimately. Stage journals separate hypothetical decisions, actual application and downstream segmentation/layout effects.

Node 24 permission mode limits filesystem input to code/dependencies and the exact machine inputs, output to the run directory, and denies child processes/addons. A test established that Node 24 alone does **not** deny network; the formal macOS runner therefore additionally uses `sandbox-exec` with network denial, verified by EPERM on a loopback connection attempt. The real generation child has no Gold argument or Gold filesystem permission. Missing platform support fails closed instead of claiming isolation.

Actual times, UTC (local run date 2026-09-08 JST): A completed `2026-09-07T15:36:44.275Z`; B `15:36:45.342Z`; dual freeze `15:36:45.381Z`; first evaluation-reference read `15:38:10.098Z`. One formal policy configuration was used. No policy or application code changed after reference read. Evaluation is a separate process and verifies frozen payload, input, metadata and clock-manifest hashes before/after reference processing.

| Shared output identity | Hash                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| Text object            | `be53fcbfe85bbf4f9414e30303317584c8c82c0d826235096abf691bbf8e3af4` |
| Timing object          | `7bf5b5c788294fb051cd3b8904ee4f0d683bdd049a9e9afb7aa733866be91ae3` |
| Presentation object    | `1b0d0fe1f509375419b06a2d06795e9a0784620aaf01456a50c9068a0f882cce` |
| ASS bytes              | `8fcb6388990733deada73d7a6cbdacd151c8239381f1cf0f58134c7038771828` |
| SRT bytes              | `14a466a05defd82a93fc9971c5f0c5235790f6e1f432009f416498dad9f07713` |
| VTT bytes              | `c20861f122d0fa52082b1964333beb8932a1501da27ad72d8e38ce23b83c3049` |

## Frozen-reference quality evaluation

Existing fixed evaluator and normalization, complete reference including OP/lyrics, actual re-parsed ASS/SRT/VTT. No denominator change or proportional reference slicing. R0 was **not rerun** here; historical Raw comparisons are inherited, not newly measured.

| Metric                                                  |                        S0 |                        S1 |                        S2 |
| ------------------------------------------------------- | ------------------------: | ------------------------: | ------------------------: |
| Cues                                                    |                       100 |                       100 |                       100 |
| Normalized S / D / I / N                                |    599 / 212 / 154 / 2048 |    599 / 212 / 154 / 2048 |    599 / 212 / 154 / 2048 |
| Normalized distance / CER                               |       965 / 0.47119140625 |       965 / 0.47119140625 |       965 / 0.47119140625 |
| Exact S / D / I / N                                     |    730 / 266 / 195 / 2257 |    730 / 266 / 195 / 2257 |    730 / 266 / 195 / 2257 |
| Exact distance / CER                                    | 1191 / 0.5276916260522818 | 1191 / 0.5276916260522818 | 1191 / 0.5276916260522818 |
| Non-deletion coverage proxy                             |               0.896484375 |               0.896484375 |               0.896484375 |
| SRT/VTT start MAE / end MAE, seconds                    |       1.357887 / 0.849566 |       1.357887 / 0.849566 |       1.357887 / 0.849566 |
| Boundary P95 / mean IoU                                 |           3.06 / 0.728674 |           3.06 / 0.728674 |           3.06 / 0.728674 |
| Severe boundary groups                                  |                         8 |                         8 |                         8 |
| Display overflow cues (>2 lines or >16 characters/line) |                        23 |                        23 |                        23 |
| Total overlap pairs                                     |                         0 |                         0 |                         0 |

All three formats have identical text metrics. ASS centisecond serialization gives start/end MAE 1.356981/0.849623 and mean IoU 0.728648; this is an unchanged format effect, not a strategy timing gain. Timing uses 53 supported groups covering 108/192 reference cues; 84 reference and 35 hypothesis cues are unmatched. The same 53 source/reference identity groups remain supported, with zero boundary deltas and no matching-set change.

Added cues=0, removed cues=0, changed export groups=0. All targeted stage texts/start/end and all exported text/timing/presentation are unchanged. No new side effects, but no correction of existing errors either. Repetition/event count remains UNKNOWN. D/I diagnostics are retained; fewer deletions would not imply the same number of correctly recovered speech characters, and insertions are not confirmed hallucinations. Non-deletion coverage is not character accuracy; total overlap is not erroneous-overlap count.

All three machine cores have **REFERENCE_BOUNDARY_AMBIGUITY**. Exact local metrics are null where reference or generated cues cross boundaries. Complete intersecting-cue diagnostics remain non-exact, non-additive context, not a justification for adjusting source boundaries. No direct listening: listener=null, audioConfirmed=false, humanValidated=false.

## Validation and reproducibility

- Typecheck, full lint, format check and build passed.
- Full suite: **166 files; 1,400 passed, 2 skipped** with `--maxWorkers=2`.
- Separate E2E: **39 files; 87 passed, 1 skipped**.
- New focused tests: 20 unit tests plus one actual-export E2E; old acoustic/capability regression subset also passed (51 total in that combined focused run). Subsets are not additional unique full-suite passes.
- Strict Zod evidence parsing and emitted JSON Schema validation passed. Original bundle schema remains unchanged.
- Initial concurrent full suite had one old .14.5 E2E exceed its existing 5,000 ms limit; 1,399 passed and two skipped. Full rerun at two workers passed, with the same test completing in 1,864 ms. No timeout threshold, test assertion or old algorithm was changed.
- Model opt-ins `MVL_MFA_INTEGRATION_TEST=0`, `MVL_SPEAKER_INTEGRATION_TEST=0`; real-model skips are not counted as passes.
- Generation input/clock/payload freeze, A/B byte parity, old-export equality, JSON schema, source binding, text/time preservation, forbidden Gold/child access and macOS network denial verified.
- Protected historical files/state: **8,486 unchanged**. Public commits contain only relevant code, neutral tests and this sanitized report; detailed responses, subtitle text, reference, media, absolute private paths and model/cache data remain local-only.

From this branch/worktree with Node 24 / npm 11 installed:

```sh
npm ci --offline --ignore-scripts
npm run typecheck
npm run lint
npm run format:check
npm run build
MVL_MFA_INTEGRATION_TEST=0 MVL_SPEAKER_INTEGRATION_TEST=0 npm test -- --maxWorkers=2
npm run test:c601163
```

Replay uses only existing response artifacts and a **new, non-existing** output directory:

```sh
npm run quality:stored-token:replay -- ../Codex-Skills/output/machine-quality-c6-0-1-16-2-20260907-experiment-01 ../Codex-Skills/output/machine-quality-c6-0-1-16-3-new-replay
```

The lower-level generation entry is `node scripts/generate-c601163.mjs <primary-json> <old-frozen-evidence-json> <new-token-evidence-json> <new-run-directory>`; the replay command supplies its filesystem/process/network sandbox. Neither generation command accepts a reference. Only after the replay-created freeze, separately run `npm run quality:stored-token:evaluate -- <new-output-directory> <evaluation-reference-ass>`. Existing output/evaluation directories are not overwritten.

## Final gates and minimal next direction

Engineering passed. Capability is reachable with real provider shapes; application evidence is insufficient for all real cases. Development quality has **no material change**. Generalization is **HELDOUT_VALIDATION_NOT_RUN**. Final state remains **needs-review / finalizationMethod=none**; defaultPromotionAuthorized=false, machineOnlyReleaseAuthorized=false, humanValidated=false.

The minimum next direction is to obtain, under a separately authorized task/budget, **a source-bound boundary observation that resolves the currently crossing lexical edges**. Merely retransmitting more of the same stored tokens does not resolve those edges. No new recognition, forced alignment, window expansion, provider change or follow-on experiment is started here.
