# C6.0.1.17 Representative Text-error Recovery & Minimal-pipeline Comparison

## Outcome

Engineering validation passed. **Precise quality confirmation did not pass**:
11 of 12 frozen physical clips intersect a reference unit at a boundary, so
their complete-unit comparisons are approximate, not precise primary CER.
The sole precise D clip is unchanged; C has no precise eligible clip.

One opt-in occurrence-overlap deduplication guard restores four output cues
across three independent clips (one D, two C). The C approximate normalized
edit distance decreases from 234 to 220, but remains worse than minimal
Primary's 206. This is **PARTIAL_RECOVERY_STILL_WORSE_THAN_MINIMAL**, with
`PRECISE_CONFIRMATION_INCONCLUSIVE`, not multi-clip quality approval.
There is a small insertion tradeoff. No default behavior or release authority
was changed. No post-C tuning or additional model execution occurred.

## Baseline and sample design

Base commit: `1abfda259f01dbcca61b49fe46d92b6c8595400b`.
Independent branch:
`codex/c6-0-1-17-representative-text-recovery-minimal-pipeline`.
The dirty .14.6 worktree, all .16 work, original video and authoritative human
ASS were retained. A private pre-edit snapshot covered **15,633 files** and
old worktree HEAD/status/staged/unstaged states; final verification found them
unchanged. Skill 2/3 and historical default algorithms were not modified.

Selection used only historical machine Primary segments, not Gold, historical
Final subtitles, or counts of known reference errors. It enumerated 287
20–28-second windows at raw segment boundaries/gap midpoints, excludes the
union of old tail windows read from the previous machine plan, and disallows
overlap or less than one second between selected windows. Machine boundaries
are not asserted to be acoustic silence.

Seed: `c60117-independent-strata-v1`. Hashed window order is retained as the
replacement order. Four coverage windows are selected across temporal
quarters; four risk windows rank machine repetition, abnormal raw-segment
duration, high character rate and raw overlap; four controls have zero flags
under those same rules. Within each stratum, sorted stable IDs alternate D/C.
The actual risk samples triggered repetition/duration, not measured confidence
or independently detected speaker conflict.

| Stratum           |   D |   C |   H |
| ----------------- | --: | --: | --: |
| Temporal coverage |   2 |   2 |   0 |
| Machine-risk      |   2 |   2 |   0 |
| Low-risk control  |   2 |   2 |   0 |
| Total             |   6 |   6 |   0 |

Physical audio totals **296.7615 seconds**. Every clip is nonoverlapping and
20.94–27 seconds long. No separate eligible media/reference pair was placed
in scope: **HELDOUT_VALIDATION_NOT_RUN**. The episode is development-known;
C is only `IN_EPISODE_FROZEN_CONFIRMATION`, never unseen-material validation.

The first preflight retained eight clips because it accidentally omitted
touching raw boundaries; this was corrected before recognition/reference use.
Two subsequent extraction preflights caught resampler tail sample discrepancies.
Final extraction decodes from the original audio origin, resamples to 16 kHz,
then cuts on the exact integer sample grid. All failed preparations remain
local and used zero ASR. The 12-clip selection is unchanged between the latter
preparations and the successful experiment. No quality-based replacement occurred.

## Real model execution and identity

| Counter                                    |              Actual |
| ------------------------------------------ | ------------------: |
| Logical tasks / attempts / inferences      |        24 / 24 / 24 |
| Whisper / Reazon inferences                |             12 / 12 |
| Cache hits / execution failures / retries  |           0 / 0 / 0 |
| Whisper process/model starts               |             12 / 12 |
| Reazon process/model starts                |               2 / 2 |
| Total model process starts / model loads   |             14 / 14 |
| Charged model-input audio                  | 678.3615 s / 1080 s |
| Attempt limit                              |             24 / 36 |
| New VAD / CTC / MFA / speaker / separation |   0 / 0 / 0 / 0 / 0 |

Whisper is charged a full 30-second encoder block per request, not merely
physical clip duration. Reazon receives the same physical WAV plus 0.9 seconds
per side, never more than 30 seconds. Failed preparation audio is not model
input. Validation/synthetic tests and A/B generation perform no neural inference.

- Whisper: installed whisper.cpp large-v3, model SHA-256
  `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`;
  binary `939c82ebcd37d6699e38ad539b337eb63d2d58cc307f65887ec358c05ec43942`.
  Metal-enabled build, default GPU execution requested, CoreML disabled.
  Actual full JSON reports `MTL: EMBED_LIBRARY=1`, `COREML=0`; this is runtime
  capability/argument evidence, not independently sampled GPU-utilization telemetry.
  Japanese, eight threads, temperature zero, no fallback, beam/best-of five,
  max-context zero, no title/prompt/hotwords/translation/VAD. Separate CLI
  processes prevent preceding-request context carryover. The recorded helpHash
  is empty stdout (CLI help uses stderr), not capability proof; actual successful
  invocations and full model JSON supply that proof.
- Reazon: `reazon-research/reazonspeech-k2-v2`, revision
  `291488c8151be24d7da4bf7af26e533fad96e407`, fp32 CPU;
  snapshot `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`.
  All four pinned file sizes/hashes were checked. Python 3.13.14,
  sherpa-onnx 1.13.6, NumPy 2.2.2; one thread, greedy search, new stream per
  request. Worker SHA-256
  `bea411b3fa8509f5cfec00d1d254d0d85e8842b5d254fb2b2c94c8e989e9d2dc`.
- Frozen runtime descriptor hashes: Whisper
  `cc7a037213bac1204f289c155ab3206e52cbe4e58bc8e5448798ebdd233d3494`;
  Reazon `b415292e94db9432c8b3087b009c5447c835a10ff1f3cbfd61040f3242ce81d9`.

No cloud ASR, downloads, upgrades, global installs or opportunistic retries.
Source/sample/interval/audio/model/runtime/adapter/decoder/prompt/timebase
identities are bound into request keys; old title-prompted caches cannot match.
Attempts are reserved durably before execution. An interrupted reserved task
fails closed instead of silently executing again. Empty/weak output is not an
execution failure. Per-process arguments, raw JSON, raw SRT and result receipts
are retained locally. The dependency install was offline, ignore-scripts, from
existing cache; npm 10.9.2 emitted the existing npm >=11 engine warning. Node
24.19.0 ran the successful checks; no toolchain upgrade was performed.

## Same-evidence comparison and single repair

All four variants consume each clip's identical fresh Whisper evidence.
P0 executes minimal source-time mapping, ordering and real serialization.
P1 actually reexecutes the available deterministic chain:
Primary mapping → winner deduplication → intra-cue repetition handling →
semantic segmentation → layout → ASS/SRT/VTT. It is not a copied old Final.

This is **MATCHED_AVAILABLE_PROFILE**, not reproduction of the full historical
pipeline. Candidate association/competing-track Top-Score, ASR canonicalization,
reference-guided and lyric recovery, scene/speaker evidence, historical
integrity/timing recovery and enforcing quarantine are unavailable/disabled.
Fresh recognition happens upstream; the legacy replay-scope label's disabled
recognition branch refers to in-replay inference. AUX Reazon is a separate
whole-clip transcript diagnostic, not a P2 timed donor. Point timestamps never
become invented intervals or one clip-length subtitle cue.

D stage traces showed one risk clip with a two-character increase in deletion
distance precisely at `deduplicateTopScoreWinners`. Two distinct, nonoverlapping
equal-text Primary segments were collapsed by the legacy near-in-time rule.
Most other D errors already exist in P0; both models remain incomplete. The
`POOL_INSUFFICIENT` tag means neither whole-clip candidate is reference-exact,
not proof that every possible span-level donor is absent. Reference/boundary
ambiguity is separately tagged; edit counts are not acoustic hallucination labels.

Only one candidate configuration was tried: fresh P2 passes the already
implemented `requireTemporalOverlap=true` option to the real deduplicator.
It requires more than the existing 0.1-second overlap threshold; nonoverlapping
same text is retained. No threshold tuning, name dictionary, known time/ID
branch, Gold replacement or candidate selection was introduced. Other stages,
including legacy intra-cue handling, remain unchanged. P2-off independently
reexecutes P1. Defaults remain legacy; this profile is explicit opt-in.

Selection prioritized preventing D stage-traced content loss relative to P0
and protecting low-risk clips, then precise D CER, then fewer changes. Config 1
removes the two-character downstream damage, ties precise CER and preserves
controls. D baseline and the complete config-1 evaluation are both retained;
there was no second repair configuration. All final D exports match those
actually scored for config 1. No old three-case patches or inverse journal
recovery enter generation.

## Reference isolation, scoring and freeze

Physical ranges were frozen before recognition. A separate data-preparation
process subsequently read the authoritative ASS after D baseline export freeze,
and sealed D and C scopes without displaying C text. Each scope retains every
complete reference unit intersecting its physical clip. Crossing units are not
proportionally cropped or selected using the hypothesis. C data preparation is
distinct from C developer/evaluator access: its reference was not used to choose
the repair. Final code/config and A/B output hashes were frozen at
`2026-09-08T07:39:36.393Z`; the single C evaluation began at
`2026-09-08T07:39:53.610Z`. C evaluation checks frozen code identities and reserves
a one-use marker before reading C. No rerun or parameter update followed it.

Only D `clip-8d9b2e629d38` is precise eligible. The other five D clips and all six
C clips cross reference boundaries. They remain in files, task totals and
approximate metrics. C precise CER is **undefined, N=0**, never 0% or passed.
All styles, including lyrics/title-like annotation in the human reference,
remain in scope; these and imperfect human boundaries can inflate approximate
errors. No listening-based reinterpretation or reference edit was made.

Metrics reparse actual ASS/SRT/VTT. Normalized text uses NFKC, removes Unicode
punctuation/separators/whitespace, and lowercases; exact uses NFC and removes
display line breaks only. Micro is summed errors / summed N; macro is mean
clip CER. No old full-episode denominator or historical 46.7% is reused.

### Precise primary metrics

All P0/P1/P2/off: D normalized S/D/I/N = **0/6/0/21**, micro=macro
**28.5714%**; exact **0/7/0/22**, **31.8182%**. AUX normalized **0/13/0/21**,
61.9048%; exact **0/14/0/22**, 63.6364%. C has no precise denominator. H not run.

### Approximate all-clip text metrics — not precise acceptance

| Split | Variant  | Normalized S/D/I/N | Distance | Micro / macro CER   | Exact S/D/I/N  | Exact distance | Exact micro / macro |
| ----- | -------- | ------------------ | -------: | ------------------- | -------------- | -------------: | ------------------- |
| D     | P0       | 52/85/6/257        |      143 | 55.6420% / 55.4842% | 58/109/9/292   |            176 | 60.2740% / 59.0913% |
| D     | P1 = off | 52/87/6/257        |      145 | 56.4202% / 56.3614% | 59/111/6/292   |            176 | 60.2740% / 59.1558% |
| D     | P2       | 52/85/6/257        |      143 | 55.6420% / 55.4842% | 59/109/7/292   |            175 | 59.9315% / 58.8224% |
| D     | AUX      | 10/182/0/257       |      192 | 74.7082% / 76.7703% | 10/217/0/292   |            227 | 77.7397% / 78.3829% |
| C     | P0       | 81/105/20/609      |      206 | 33.8259% / 33.5267% | 104/138/37/673 |            279 | 41.4562% / 41.3097% |
| C     | P1 = off | 80/138/16/609      |      234 | 38.4236% / 37.8168% | 103/175/30/673 |            308 | 45.7652% / 45.1483% |
| C     | P2       | 79/124/17/609      |      220 | 36.1248% / 35.4711% | 101/161/33/673 |            295 | 43.8336% / 43.2512% |
| C     | AUX      | 18/481/4/609       |      503 | 82.5944% / 83.3672% | 24/542/1/673   |            567 | 84.2496% / 84.5508% |

C approximate normalized micro by stratum, P0 / P1 / P2:
coverage **25.3731 / 39.3035 / 32.3383%**;
risk **28.1915 / 28.1915 / 28.1915%**;
low-risk **46.3636 / 46.3636 / 46.3636%**.
D low-risk: **44.0678%** for all three, with the one precise clip as above.
All per-clip and exact/normalized stratum S/D/I/N and both averages are retained
in private metrics JSON and CSV. Whole-comparable-clip oracle is evaluator-only;
no oracle-picked or composited text is emitted. Since C has no comparable
precise clip, its precise oracle is also null.

## Mutations and side effects

- D: one risk clip gains one output cue / two normalized characters;
  normalized distance 21 → 19 in that boundary-ambiguous clip.
- C: two coverage clips gain three cues / 15 normalized output characters;
  respective distances 51 → 43 and 28 → 22. These are two nonoverlapping
  diagnostic benefits, but both are boundary ambiguous. Neither establishes
  precise frozen confirmation; four C clips are unchanged versus P1.
- Total: four additional cues, 17 additional normalized output characters,
  three changed clips. Four D/C low-risk controls are unchanged versus P1.
  This is not recovery of 17 independently verified spoken characters.
- Approximate C normalized deletions decrease by 14, substitutions by one,
  **insertions increase by one**. Exact C insertions increase by three; exact
  D insertions increase by one. These are explicit side effects, not hidden
  behind a lower total CER. No claim of zero hallucinations or all repetitions
  being acoustically verified is made. Existing intra-cue deletion remains
  and helps explain why P2 is still worse than P0 in C. It was not retuned.

Timing uses the existing text-aligned cue-component evaluator, not a new
acoustic alignment. The following all-clip SRT diagnostics include boundary
ambiguity; ASS is separately measured at centisecond serialization precision.

| Split / variant | Matched groups | Start MAE s | End MAE s |  P95 s | Mean IoU | Unmatched ref / hyp | Severe groups |
| --------------- | -------------: | ----------: | --------: | -----: | -------: | ------------------- | ------------: |
| D P0            |             10 |      2.3326 |    1.2086 |  6.460 |  0.70371 | 13 / 8              |             3 |
| D P1 / off      |              9 |      2.6862 |    1.3296 | 18.115 |  0.67560 | 14 / 8              |             3 |
| D P2            |             10 |      2.3326 |    1.2086 |  6.460 |  0.70371 | 13 / 8              |             3 |
| C P0            |             43 |      1.0263 |    0.4349 |  2.391 |  0.58314 | 13 / 7              |             5 |
| C P1 / off      |             40 |      1.2996 |    0.5695 |  2.790 |  0.51860 | 15 / 6              |             7 |
| C P2            |             42 |      1.2004 |    0.4373 |  2.790 |  0.55986 | 14 / 6              |             7 |

Same-support comparisons have **8 D / 36 C groups**, all start/end error
deltas zero. P2 has **2 D / 6 C changed-matching groups**. Thus aggregate timing
movement is not evidence of newly corrected acoustic boundaries. Preserved
events retain their Primary timing; no new end-alignment method ran. Reazon
timing metrics are unavailable, not zero-error or a fabricated interval score.

## Engineering validation and isolation

- Final typecheck, lint, format-check and build passed. Only changed files
  were formatted. Delivery helper additionally passed its focused lint check.
- Full Vitest: **1,451 passed, 2 skipped, 0 failed** across 175 files.
- Explicit E2E subset: **99 passed, 1 skipped, 0 failed** across 44 files;
  these are included in the full suite, not added to it.
- C6.0.1.17 neutral subset: **16 passed**. Real pyannote/MFA opt-in tests were
  explicitly disabled. Tests cover fixed selection, independent partitions,
  budgets/retries/padding, fresh schema rejection, empty outputs, stale source
  mapping, retained separate repetitions, overlapping dedup, actual exports,
  off=P1, new-clip input and reference-scope/micro-average semantics.
- Strict Zod plus independent JSON Schema/AJV checks passed for the selected
  clips/fresh payloads; 48 A packages validated, with their B counterparts
  proven byte-identical. D A/B each has 150 files; C A/B each has 150 files.
  All formats roundtrip. The scored D config and final D exports are identical.
- Model execution ran offline under OS network denial. Zero-model generation
  additionally uses Node read allowlists for exact evidence/config files and
  runtime dependencies, an isolated writable output, no subprocess permission
  and no addon permission. It cannot read evaluation folders, old journals,
  Gold or historical Final data. Actual probes verified file-read, child-process,
  addon (`ERR_DLOPEN_DISABLED`) and network denial; these are enforced controls,
  not merely assertions about omitted CLI arguments.
- A generator preflight hit Node permission-mode fsync denial. Its partial
  folder is retained; writes inside isolation now defer fsync to the parent
  freezer. This affected no ASR task and no evaluated baseline. Early lint/test
  diagnostics were corrected before final code/config freeze.
- Execution identity receipts capture the exact pre-inference code hashes.
  Later formatting, defensive type/lint guards and standalone input support
  did not rerun models. Final generation has its own separate code freeze.

Key frozen-file SHA-256 values:

```text
dataset-freeze       b1c6253455c4b8d32bd588a6f0278a6bda86d9f920b4f9e3ea3bf49334630061
pre-inference        8acede7d935824c3140626030d2c56ec4364e2875211dc94498331fa97d2a30d
D evidence           e14e44d169fdcee3f0a2c87bfc67f0e9438629354e0077ad66de2b534a503f6f
C evidence           3c8a3ee1132fc4c31416a039baa0973fd4ee0fd3b6f138f1c00444b4fe4f39e4
final code/config    71eeebe0c50f377b4345f65517728dbb320045eac2b38c0e1a639e7ab83d1351
```

## Local delivery and reproduction

Successful local run directory:
`machine-quality-c6-0-1-17-20260908-experiment-04`.
Separate evaluator directory:
`machine-quality-c6-0-1-17-20260908-evaluation-only`.
`OUTPUT_INDEX.md` links all 12 actual P2 ASS/SRT/VTT sets. Use
`d-final-a/<clip-id>/P2-one-family-recovery/` and
`c-final-a/<clip-id>/P2-one-family-recovery/`; independent B copies are retained.
These are source-global-timed clip subtitles, not a stitched full episode.
`delivery/<clip-id>/time-map.json` supplies local/global mapping;
`mutation-journal.json` contains before/after cues and actual stage trace links.
Metrics, raw model outputs, reference scopes, audio and private paths stay local.
The hidden runtime model link under audio is not redistributable model content.

Commands below are existing entry points; variables designate explicit local
files/directories, and every destination must be new. Do not rerun inference
on the completed experiment: its stop condition has been reached.

```sh
npm run c60117:prepare-dataset -- "$MVL_CONFIG" "$MVL_NEW_RUN"
npm run c60117:generate-evidence -- "$MVL_NEW_RUN" D
npm run c60117:generate-subtitles -- "$MVL_NEW_RUN" "$MVL_D_BASELINE_CONFIG"
npm run c60117:prepare-reference -- "$MVL_NEW_RUN" "$MVL_GOLD_ASS" "$MVL_EVAL_DIR"
npm run c60117:evaluate-development -- "$MVL_NEW_RUN" d-config1 "$MVL_D_REFERENCE" "$MVL_NEW_D_EVAL"
npm run c60117:generate-evidence -- "$MVL_NEW_RUN" C
npm run c60117:generate-subtitles -- "$MVL_NEW_RUN" "$MVL_FINAL_CONFIG"
node scripts/freeze-c60117.mjs "$MVL_NEW_RUN"
npm run c60117:evaluate-confirmation -- "$MVL_NEW_RUN" c-final-a "$MVL_C_REFERENCE" "$MVL_NEW_C_EVAL"
npm run c60117:validate -- "$MVL_NEW_RUN"
node scripts/deliver-c60117.mjs "$MVL_NEW_RUN" "$MVL_EVAL_DIR"
```

The development command follows config-1 generation; final generation is run
once for each d/c-final-a/b config before freeze. Preserve initial baseline,
selection and repair-plan records. The exact successful local config files and
all argument receipts are in the run/private preparation records. The scheduler
must be run with OS network denial as in this experiment; generator isolation
is installed by the scheduler automatically. Config fields are media, ffmpeg,
ffprobe, whisper/model, Reazon Python/model, machine Primary and exclusion plan.
There are no Gold/prompt fields in generator configs.

For a genuinely new local clip, `npm run c60117:prepare-clip -- CONFIG NEW_RUN`
uses explicit `media`, `audioStream` and `clip: {start,end}` plus the installed
runtime paths; it does not require historical Primary, Final, case IDs or Gold.
It supports a zero-origin source audio stream and a bounded 20–28-second clip,
failing closed otherwise. Follow generate-evidence D and generate-subtitles
with a strict `{partition,runName,repair}` config. This standalone interface was
neutral-tested; no extra real material was recognized to validate it this turn.

## Decision and smallest next direction

The old tail branch is closed. A real deterministic deletion opportunity was
found beyond it, but prompt-free two-model text quality is still insufficient,
and the precision of this physical-clip/reference design is insufficient for
the requested C confirmation. Two approximate C benefits do not override that.

Retain **needs-review**, `finalizationMethod=none`, `humanValidated=false`,
`defaultPromotionAuthorized=false`, `machineOnlyReleaseAuthorized=false`.
No auto burn-in, publication, default switch, extra ASR, CTC or next experiment.

The smallest next user-authorized direction is **boundary-safe evaluation-unit
design before spending more recognition budget**, using independent data
preparation and hypothesis-independent complete units. This addresses the
11/12 ambiguous-clip bottleneck; it is not permission to trim hypotheses to
improve scores. Only after that should general source-occurrence content
preservation be evaluated against the minimal Primary baseline. Do not add
another broad arbitrator or resume the old tail case on these results.
