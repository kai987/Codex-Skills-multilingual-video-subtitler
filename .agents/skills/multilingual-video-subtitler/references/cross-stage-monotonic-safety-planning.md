# C6.0.1.14.3 cross-stage monotonic safety planning

Use this route only when the user explicitly requests C6.0.1.14.3. It repairs target selection and physical review delivery from the frozen C6.0.1.14.2 machine state; it does not acquire new detector or ASR evidence and does not modify subtitle text, timing, or presentation.

## Freeze machine obligations before selection

- Run only with `executionPolicy: replay-only`. Do not expose an authorization flag.
- Verify every prior detector and ASR request with an exact cache hit. Construct no runtime or provider, start no model process, and reject any nonzero inference, load, cache-miss, retry, backfill, or network count.
- Convert the union of every C6.0.1.14.2 Phase A target core into source-native obligations before hierarchical splitting. Deduplicate overlapping samples but preserve all origin target IDs and evidence provenance.
- Freeze the policy, obligation artifact and input byte hashes before selecting children. Gold paths, hashes, component IDs, intervals, labels, and text must not be machine inputs.

## Build auditable child units

Partition the frozen parent cores at already verified native boundaries: Phase A obligations and targets, protected cue and immutable-target masks, verified saved silence boundaries, source discontinuities, contradiction and timebase transitions. Scene, speaker, detector-family, evidence-stratum, PCM-view transitions, large gaps, and valleys from existing verified probability tracks may be soft split points. Binary decisions are not posteriors.

Keep atomic positive intervals separate from review envelopes. Require source identity, rational time mapping, positive evidence and no strong contradiction for selectable children. Prefer at most 4 seconds of core and enforce a 6-second child envelope. If a large child has no legal evidence boundary, keep it as ineligible audit evidence; never invent a midpoint or use Gold to split it. Preserve every parent-core sample in the hierarchy, including ineligible audit-only atoms.

## Bundle and plan without inflating speech

- Generate deterministic single-child and local multi-child candidates. A bundle consumes one target slot, spans no more than 12 seconds, and may bridge at most 0.75 seconds between neighboring child envelopes.
- Do not cross source discontinuities or strong scene boundaries. Record internal gaps and cue-covered gaps as context; exclude them from speech-core and obligation coverage.
- Dominance pruning must preserve exact child/core identity, independently supported evidence, diversity and priority while using no more target, audio, core, silence, or contradiction cost.
- Solve the frozen candidate universe under 24 active targets, 60 seconds of speech core and 95% unique full-queue episode burden. Optimize lexicographically: exact obligation coverage first, then independent new core, novelty/diversity, machine priority, and finally fewer bundles/core/audio/silence with source time only as the last tie-break.
- Distinguish a fully exhausted feasible or infeasible search from `SEARCH_INCOMPLETE`. Never call an incomplete search infeasible and never silently fall back to a lossy final selection.

## Deliver physical review evidence

Version review targets, items, regions, audio and playback additively. Preserve all immutable review targets and human transaction semantics. Bind frozen lexical candidates only by their original native intervals; copying candidate text into the editing box is a human action and never a canonical insertion.

Extract fresh PCM WAVs only for the new mutable review output. Every selected child core and every bundle core must be covered by an actual hashed WAV and by a segment in `C601143_FINAL_REVIEW_DELIVERY`. Playback of a child core intersects the official physical segment rather than treating an envelope as audible evidence. Report clip sum, unique union, duplicate context, internal silence and episode burden separately. The reused audio/transaction subsystem version describes that subsystem; it does not downgrade the C6.0.1.14.3 evidence contracts.

## Freeze, evaluate and route

Build independent Final A and Final B directories from read-only caches and compare machine artifacts, audio SHA values, protected subtitle bytes, ASS/SRT/VTT, and normalized freeze contents. Freeze the policy, obligations, hierarchy, bundle universe, planner certificate, continuity ledger, targets/items/regions, physical audio, playback, projections, cache accounting, code snapshot and canonical hashes before Gold.

Write and fsync a first-read receipt before even hashing Gold. Post-freeze evaluation must use direct source-global overlap with actual physical WAV and playback segments at the frozen thresholds: any `> 0`, majority `>= 0.50`, audible `>= 0.80`, full `>= 0.95`. Keep intermediate and final status separate: a component audible in Phase A but absent from the final queue is a regression, not a recovery. A GO to C6.0.1.15 requires all engineering and evaluation-integrity gates, exact Phase A coverage, 6/6 missing and 1/1 hallucination audible in the final queue, all delivery/budget/parity gates, and zero runtime Gold input. C6.0.2 remains on HOLD. Neither GO nor HOLD authorizes automatic subtitle finalization.

Recompute each row-level semantic hash from the exact strict serialized object that is frozen and passed to the evaluator. A playable and byte-hash-verified WAV does not excuse a stale metadata hash. If any projection row fails its semantic hash, mark every dependent stage and recall metric `INTEGRITY_FAILED`; numeric zeroes produced by fail-closed coverage must not be reported as measured zero recall. After Gold has been opened, document the failure and start a clean pre-Gold repair iteration instead of changing selection, projection code, schemas, or tests in place.

## C6.0.1.14.5 segmentation-invariant extension

Use a `Speech Safety Coverage Unit` as the stable source-native coverage and utility identity. Construct Units from verified positive interval union with a maximum 0.30-second merge gap, while preserving hard source-discontinuity, contradiction, and incompatible-timebase boundaries. An alternate legal Child partition must produce identical Unit identities and utilities. Atom, Child, and Bundle counts are prohibited utility features; Child and Bundle rows remain only realization choices.

Freeze the Target-Core localization contract and the machine-anchored Playback audibility contract before Gold, selecting the latter as the product contract. Enumerate single- and multi-Bundle realizations, keep strict Pareto cost alternatives, and audit every eligible Unit/contract pair with a complete exact joint-feasibility solve. A historical individually feasible unselected Child count is diagnostic only; never restore `forcedFeasibleUnselected.length === 0` or an equivalent route gate.

The exact production planner must preserve Phase A and optimize Unit/contract realization under the unchanged 24-bundle, 60-second speech-core, and 95%-episode-burden limits. It must model realized Units as the logical OR of selected retained realizations and each realization as the logical AND of its Bundles. Selection is invalid if the joint search is incomplete, a selected realization lacks its Bundles, or a selected Unit lacks complete Target-to-Audio-to-Playback provenance.

Evaluate C0-C5 only after independent Final A/B freezes and a durable first-Gold-read receipt. C0 is the unannotated prior final, C1 adds Unit annotation without changing the old plan, C2 projects the Unit-aware target plan, C3 reports direct Target-Core localization, C4 adds physical audio, and C5 is the final bound playback delivery. Keep the Target-Core metric separate from the formal machine-anchored product metric. Product success permits only a separately authorized C6.0.1.15 ranker investigation and never machine subtitle finalization.
