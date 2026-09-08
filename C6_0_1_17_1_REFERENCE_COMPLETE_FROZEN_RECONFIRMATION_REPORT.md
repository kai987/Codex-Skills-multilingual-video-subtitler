# C6.0.1.17.1 Reference-complete Evaluation Units & Frozen Repair Reconfirmation

## Outcome

Data readiness passed: D1 and C1 each have six reference-complete units,
three strata represented twice, and normalized reference denominators of
559 and 317 respectively. This fixes the evaluation-range problem; it does
not establish acoustic truth or product quality.

Frozen P2 improves normalized edit distance in two **known D1** units, but
increases substitution/insertion counts: **QUALITY_TRADEOFF_HOLD**.
On C1, P2 is unchanged from P1 and worse than minimal P0:
**ENGINEERING_PASS_NO_QUALITY_GAIN**. There is no multi-unit fixed-policy
benefit on C1, no external validation, and no promotion authorization.

No generation algorithm, threshold, decoder, model, ranking, dictionary,
reference text or old result was changed. Evaluation completed once; no
quality-driven reselection or inference followed it.

## Baseline, protection and readings

Baseline: `43f736f206937ad9253a0bd913d0aeceeb4541b1`.
New branch: `codex/c6-0-1-17-1-reference-complete-frozen-reconfirmation`.
An independent worktree was created only after read-only HEAD, status, diff,
staged diff and worktree inspection. The dirty .14.6 Planner worktree was
not imported. A private snapshot protects 18,407 files and old worktree
HEAD/status/staged/unstaged states, including original media, human ASS,
.16/.17 code and outputs. No stash/reset/clean/switch/pull or force-push.

Read the actual Skill and relevant local-adapter/media instructions,
package/lock metadata, .17 report, representative selection/evaluation,
matched replay, deduplication, generator and evaluator implementation.
`C6_0_1_17_INDEPENDENT_REVIEW_AND_NEXT_STEP.md` and
`C6_0_1_17_INDEPENDENT_AUDIT_SUMMARY.json` were not found in the inspected
source, Downloads or current output locations. They were **not read** and
are not cited as evidence. The official report and real artifacts were used.

## Reference-complete preparation and its limits

The same original media hash and audio stream 1 were verified: source-native
48,000 Hz, zero origin. Full user-supplied human ASS was parsed using the
existing .17 parser. Its one decimal-comma timestamp normalization is
explicitly recorded; the original file was never edited. Parser row count
must equal all Dialogue rows; invalid durations/nonfinite coordinates or
out-of-media reference intervals abort. All styles remain in the denominator,
including lyrics and title-like annotations. No reference text correction,
content-type exclusion, hypothesis-based cropping or proportional slicing.

Reference endpoints are conservatively enclosed on the native sample grid.
Only arithmetic error under 1e-7 native sample is snapped to an integer;
that is not a tolerance for real overlap. Positive-duration intersection
is strict; endpoint contact alone does not intersect. Overlapping/touching
rows and gaps too small for both 0.10-second engineering margins form one
indivisible component. There are 95 components. One component is 87.77 s
before margins, so it cannot enter the <=30-second recognizer.

The frozen selection uses old machine windows and their center anchors.
The nearest whole component is selected, then nearest neighboring components
intersecting the seed window are added while total physical duration remains
<=30 seconds (stable left tie-break). Bounds include fixed 0.10-second
margins, snap outward to the shared native/16k grid, and are rechecked against
**all** full-reference rows after expansion. Any newly intersected partial
row rejects the proposal rather than being ignored. Long components are
excluded intact, never split to fit. Audio is cropped on native samples
before resampling; every actual mono PCM16 16k sample count is checked.

References establish **interval closure**, not phonetic timing truth:
`referenceTextAuthority = user-provided human review, not revalidated`;
`referenceContentScope = all .17 styles`; `acousticBoundaryConfirmed=false`.
No listening-based reclassification occurred. Title-like material, annotation,
uncertain transcription and imperfect human times may remain reference risks;
this round does not certify which individual lines are acoustically correct.

## Old windows, new partitions and selection bias

The old .17 data and results are unchanged: five D and six C windows cross
reference boundaries, one precise D unit has normalized N=21, and precise
C has N=0. Only old `clip-8d9b2e629d38` is interval-complete unchanged.
The other eleven cannot become complete by relabeling the existing WAV.
The new measurement changes physical audio scope; its CER is not subtracted
from the old approximate CER as an algorithm improvement.

D1 uses six rebuilt old machine regions (one former D and five former C),
explicitly **known remeasurement**. The remaining six old seeds retain
quota-filled records, not score-based exclusions. C1 seeds come from other
old machine-candidate windows, excluding old physical windows and tail
targets both before and after closure. Selected units cannot share a
component or positive audio/context overlap, even within one partition.
Multi-label units retain coverage plus risk/control metadata but count once
under the primary stratum.

| Partition | Units | Coverage / risk / low risk |   Normalized N |        Exact N | Physical seconds |
| --------- | ----: | -------------------------- | -------------: | -------------: | ---------------: |
| D1        |     6 | 2 / 2 / 2                  |            559 |            624 |           164.03 |
| C1        |     6 | 2 / 2 / 2                  |            317 |            335 |            94.36 |
| H1        |     0 | not run                    | not applicable | not applicable |                0 |

Candidate accounting is per stratum proposal, not unique underlying groups:

| Partition/stratum | Candidate proposals | Selected | Quota filled | Duplicate/context | Old-audio exposure | Oversize |
| ----------------- | ------------------: | -------: | -----------: | ----------------: | -----------------: | -------: |
| D1 coverage       |                   4 |        2 |            2 |                 0 |                  0 |        0 |
| D1 risk           |                   4 |        2 |            2 |                 0 |                  0 |        0 |
| D1 low risk       |                   4 |        2 |            2 |                 0 |                  0 |        0 |
| C1 coverage       |                  61 |        2 |           26 |                13 |                 13 |        7 |
| C1 risk           |                  28 |        2 |            0 |                13 |                  6 |        7 |
| C1 low risk       |                  33 |        2 |           10 |                14 |                  7 |        0 |

No invalid-reference, closure-failure or empty-reference rejection occurred
in this actual selection. Seven risk proposals hit the same oversized
component, not seven independent long components. The oversized content is
absent from this benchmark, a real selection limitation. C1 includes a
1.62-second risk-seed unit with N=2: its **seed-window** risk label is not a
claim that the shortened unit retains all difficult content. Units range
1.62–29.70 seconds. Coverage labels inherit machine selection, not guaranteed
uniform temporal balance; C1 coverage examples are early in the episode.
This small set cannot represent all fast/overlapping dialogue or all media.

The full episode reference has been exposed in development. C1 is only
`SAME_EPISODE_FIXED_POLICY_CHECK`, never a new blind/unseen-episode test.
No eligible second source/reference pair was placed in scope:
`HELDOUT_VALIDATION_NOT_RUN`. No network subtitle search was performed.

## Data gate and reference access separation

Readiness requires each D1/C1 partition to have 4–6 complete units, at least
one per stratum, normalized N>=200, nonoverlapping component/audio identity,
valid WAV/native mapping, <=30 seconds per request and total budget validity.
These are minimum engineering denominators, not statistical sufficiency.

The preflight completed at `2026-09-08T10:34:46.796Z`, before model execution
started at `2026-09-08T10:38:47.824Z`. The preparation gate and neutral
manifest are hash-bound in the model-input freeze. The actual model entry
reads/validates that freeze, gate status, manifest hash and repair identity
before any attempt. Independent validate-dataset was also run before model
startup and verified the full preflight freeze; the final coordinator adds
an explicit direct full-preflight hash check before launch.

Preflight SHA-256:
`266dad5fb945afd6faf7a23f6b76a741ed90cdc420b104f3742232b394672500`.
Frozen repair identity:
`8ac91d498c7de3b304d1dba8cbc57d1a94a4f4d69f5957635297bb41cbca6393`.
It was established at `2026-09-08T10:34:41.725Z`, before reference preparation.

Data preparation reads the complete reference once and seals an evaluation-only
manifest. The strict generation manifest contains only neutral IDs, audio path
and hash, sample count/rate, duration, one source offset and frozen identity.
No reference text, cue count, sentence boundaries, N, answer labels or review
instructions are passed into model or subtitle workers. The coordinating
preflight hash check is not a model input.

Actual reference accesses are separated: `dataPreparationReferenceReads=1`,
`generationReferenceReads=0`, `evaluationReferenceReads=1` for the single
scoring process. Later dataset/closure validation also reads evaluation-only
records; these are not hidden as zero total reference access. Thus:
`BENCHMARK_REFERENCE_SEGMENTED=true` and
`UNSEGMENTED_END_TO_END_VALIDATION=NOT_RUN`.

Those counters count parsed reference views, not raw filesystem syscalls.
The evaluator first hashes the sealed reference manifest during freeze
verification and then parses it: two reference-file reads in that scoring
process. Its `evaluationReferenceFirstRead` timestamp is the parse-stage
marker, not the preceding integrity-hash read. Both occur after generation
freeze. Separate manual/validation reads are not asserted to be zero or
included in a fabricated end-to-end access total.

Model execution has OS network denial and document/download read denial with
explicit machine-path exceptions; an actual probe verified evaluator-file
read denial. Pure subtitle workers additionally retain the existing Node
exact-input file allowlist, no child-process permission and no addon
permission. Model execution and pure replay have different authority.
The model adapter requires a local model symlink, incompatible with restricted
Node fs.symlink permissions; it therefore runs under the OS sandbox, not a
claimed Node subprocess sandbox. No reference is copied into its allowed repo
or audio/evidence directories. The original strict global OS read-deny probe
aborted before an attempt, and its policy record is retained.

## Frozen model and real execution

Whisper model SHA-256:
`64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`.
Binary SHA-256:
`939c82ebcd37d6699e38ad539b337eb63d2d58cc307f65887ec358c05ec43942`.
The tokenizer is embedded in that same large-v3 model. The .17 runtime
descriptor is unchanged: Metal-enabled runtime, CoreML off, Japanese,
temperature 0, no fallback, beam/best-of 5, eight threads, max-context 0,
token timestamps requested, no prompt/title/hotwords/VAD/translation.
Separate CLI processes prevent previous-request decoder context.
The inherited empty-stdout helpHash is not capability evidence.

| Counter                                             |      Actual |
| --------------------------------------------------- | ----------: |
| Formal Primary requests                             |          12 |
| Reserved execution attempts                         |     13 / 18 |
| Actual acoustic forwards                            |          12 |
| Provider starts / model loads                       |     12 / 12 |
| Pre-provider failures / explicit retries            |       1 / 1 |
| Exact-cache hits                                    |           0 |
| Actual physical model audio                         |    258.39 s |
| Reserved physical audio including failed attempt    |    287.52 s |
| Conservative charged 30-second blocks incl. failure | 390 / 600 s |
| New Reazon / other neural models                    |       0 / 0 |

The first reserved request failed at fs.symlink, before a provider process
or acoustic forward. Its failure/reservation remains; the same audio/config
was explicitly retried after changing only the execution wrapper. The
decoder, model, data list and P2 were unchanged. This was an execution
compatibility fix, not a quality retry. No response of a changed old audio
scope was reused. AUX is `NOT_RERUN_THIS_EXPERIMENT`. No downloads, dependency
upgrades, cloud requests, extra models or budget repurposing.

## Frozen generation and real export

495 baseline files (runtime/Skill/lock and relevant old scripts) are pinned
byte-for-byte. The original `generate-c60117.mjs` runs unchanged for all new
units and variants. Only P2's outer folder is renamed; its internal legacy
variant label remains documented. The chain is the same .17
MATCHED_AVAILABLE_PROFILE, including unchanged potentially lossy stages and
lyric exception. P2's only difference is the pre-existing
`requireTemporalOverlap=true` behavior (>0.1-second ordinary overlap).
No source-preserving rewrite, new ordering or threshold was added.

All four variants share each unit's newly recognized Primary evidence.
Default export is clip-local; source mapping is one documented offset.
P2-off and P1 packages and ASS/SRT/VTT are byte-identical. Independent A/B
replays each produce 300 files, byte-identical. Old .17 evidence was separately
replayed through the unchanged generator: all 300 files match the old exports.
This compatibility replay performs zero inference and does not serve as new
unit evidence. No subtitles were manually patched.

All A/B output was frozen at `2026-09-08T10:43:13.536Z`. The sole evaluator
read began at `2026-09-08T10:43:37.280Z`, after freeze. Every score reparses
actual ASS/SRT/VTT. The full physical-unit reference text is compared against
the entire emitted text, including unmatched output. `scoreScopeStatus` is
REFERENCE_COMPLETE independently of `exact` versus `normalized` text mode.

## Text results

Micro CER is sum(S+D+I)/sum(N); macro is the unweighted mean of unit CERs.
Exact uses .17 NFC/display-line-break handling; normalized uses .17 NFKC,
punctuation/separator/whitespace removal and lowercase. All formats, per-unit
rows and stratum totals remain in evaluation JSON; no failed/empty unit is
silently removed from a denominator.

| Split / variant  | Normalized S/D/I/N | Distance | Micro / macro CER  | Exact S/D/I/N | Distance | Micro / macro CER  |
| ---------------- | ------------------ | -------: | ------------------ | ------------- | -------: | ------------------ |
| D1 P0            | 109/31/28/559      |      168 | 30.0537 / 25.9607% | 131/49/49/624 |      229 | 36.6987 / 31.5788% |
| D1 P1 = off      | 106/53/21/559      |      180 | 32.2004 / 27.4728% | 123/84/36/624 |      243 | 38.9423 / 33.3587% |
| D1 P2            | 109/31/28/559      |      168 | 30.0537 / 25.9607% | 124/61/47/624 |      232 | 37.1795 / 32.1165% |
| C1 P0            | 50/4/14/317        |       68 | 21.4511 / 26.2898% | 58/9/21/335   |       88 | 26.2687 / 27.3881% |
| C1 P1 = P2 = off | 50/12/14/317       |       76 | 23.9748 / 28.6708% | 58/18/19/335  |       95 | 28.3582 / 29.0867% |

D1 P2 improves two nonoverlapping coverage units: edit distance -8 and -4,
respectively; it retains three and two additional cues. No other unit changes
versus P1. These are both known examples, not independent confirmation.
Normalized D1 substitutions increase by 3 and insertions by 7 while deletions
decrease by 22. Exact insertions increase by 11. P2 ties P0 normalized but
remains worse than P0 exact. These tradeoffs prevent quality acceptance.

C1 has zero beneficial or regressed units versus P1. Its unchanged low-risk
stratum remains worse than P0 (normalized 24/116 versus 16/116 errors).
This is inherited processing loss, not a new P2 regression; it was not repaired
or automatically labeled a new bug. P2 is not superior to minimal Primary.
No class shows new P2-over-P1 degradation in total CER, but the D1 S/I
tradeoffs are still explicit. I is not confirmed hallucination count, D
reduction is not independently verified speech recovery, and 1-D/N is not
called character accuracy.

## Timing, structure and presentation

The frozen text-aligned evaluator is reference-relative, not acoustic boundary
verification. Fixed matching-support groups have zero P2-P1 start/end deltas
(31 D1, 17 C1); D1 adds nine changed matching groups, C1 none. Aggregate
timing change is therefore not a newly optimized acoustic boundary claim.

| Split / variant  | Groups | Start / end MAE s | P95 s | Mean IoU | Unmatched ref / output | Severe groups |
| ---------------- | -----: | ----------------- | ----: | -------: | ---------------------- | ------------: |
| D1 P0 = P2       |     40 | 0.56175 / 0.28650 |  1.07 |  0.72462 | 14 / 12                |             2 |
| D1 P1 = off      |     35 | 0.68629 / 0.33029 |  1.74 |  0.70715 | 16 / 11                |             2 |
| C1 P0            |     17 | 0.10118 / 0.97000 |  3.63 |  0.81603 | 2 / 2                  |             3 |
| C1 P1 = P2 = off |     17 | 0.32706 / 0.97000 |  3.63 |  0.77584 | 3 / 1                  |             4 |

All variants have zero positive-duration output overlap pairs and zero
over-two-line cues. Overlong rendered lines: P0=21, P1=P2=off=1. The unchanged
remaining overflow is disclosed, not fixed under this frozen experiment.
P2 retains three adjacent equal-text pairs versus P1's zero; acoustic occurrence
identity was not independently verified. More cues or fewer deletion edits
do not by themselves prove fewer missing dialogues. Actual before/after cues,
added/removed/modified IDs, source evidence, frozen trigger and stage-trace
links are retained in each unit's mutation journal.

## Validation and reproducibility

The initial full suite passed 1,469 tests with two skipped; E2E passed 100
with one skipped. An additional denominator-floor test was then added.
Initial lint found type-style/non-null assertion issues in new preparation
code only. They were repaired with interfaces and checked indexing; preparation
replay reproduces the frozen selected units and full ledger exactly.
Final typecheck, lint, format-check and build passed. The default-concurrency
final full suite had six historical test timeouts (no assertion failure),
retained in its original log. A full rerun with `--maxWorkers=2`, unchanged
assertions and unchanged timeouts, passed **1,470 tests, two skipped, zero
failed** across 177 files. Final explicit E2E passed **100, one skipped**
across 45 files; these tests are included in the full suite, not additional.
The new focused tests number 19. Final and bounded logs remain separate.
Skipped opt-in model tests are not counted as passes. No test invoked a new
model. The neutral test set includes real CLI preflight rejection.

48 A packages passed strict existing package schemas and all format
roundtrips; B counterparts are identical. Old-evidence parity is 300/300.
Dataset validation rechecks freezes and actual WAV metadata. Source protection
verification passed for all 18,407 files and old staged/unstaged states.
Toolchain: Node 24.19.0 for execution/checks;
offline ignore-scripts npm installation used existing cache only. Initial
shell Node 23/npm 10 emitted engine warnings; no runtime upgrade was performed.

Use an existing Node 24 runtime. These are actual entry points, not pseudocode
script names; each new run/output destination must be collision-free:

```sh
npm run c601171:prepare-reference-complete-units -- "$MVL_PREP_CONFIG" "$MVL_RUN"
npm run c601171:validate-dataset -- "$MVL_RUN"
npm run c601171:generate-primary -- "$MVL_RUN"
npm run c601171:generate-frozen-variants -- "$MVL_RUN"
npm run c601171:evaluate -- "$MVL_RUN"
npm run c601171:validate-delivery -- "$MVL_RUN" "$MVL_OLD17_RUN"
node scripts/audit-c601171.mjs "$MVL_RUN" "$MVL_OLD17_RUN"
```

Preparation config fields: `oldRun`, `media`, `reference`, `ffmpeg`, `ffprobe`,
`whisper`, `whisperModel`. It is private data-preparation input, never a model
or pure-generation config. The gate cannot be disabled by omission. A failed
execution may explicitly use `--retry-execution-failure`, with identical
identity, a retained failure record and the fixed retry budget; successful
requests never become quality retries. This completed experiment must not be
restarted. H1 is unsupported unless a future independently authorized pair is
properly prepared; no empty H1 success directory is created.

Local output directory name: `machine-quality-c6-0-1-17-1-20260908-run-01`.
`OUTPUT_INDEX.md` gives all 12 media ranges/offsets and P2 ASS/SRT/VTT/audio
links. P2 lives under `run-a/<unit-id>/P2-frozen-overlap-required/` with its
independent counterpart under `run-b/`. These are complete evaluation-unit
subtitles, **not** a stitched full-episode final subtitle. Local raw evidence,
audio, references, private configs and old artifacts are not committed.

## Acceptance boundary

Data readiness and frozen-strategy integrity passed. The scientific outcome
is evaluation-validity recovery plus limited known-case gain with tradeoffs,
not general subtitle-quality improvement. C1 provides no new P2 gain and P0
remains better there. External validation is NOT_RUN, defaults unchanged.
Retain `needs-review`, `finalizationMethod=none`, `humanValidated=false`,
`defaultPromotionAuthorized=false`, `machineOnlyReleaseAuthorized=false`.
Do not add more samples, models, arbitration, threshold tuning or tail work.
