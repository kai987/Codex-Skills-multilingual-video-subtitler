# Frozen Local-ASR Recovery & Conservative Machine Integration

## Outcome — bounded experiment completed, not a subtitle-quality release

The authorized frozen ten windows were recognized once each with the same hashed
Whisper CLI/model and historical effective decoding contract. Twelve raw records
were preserved. Exactly one record was fully core-owned and passed the
insertion-only machine gates: the candidate contains **156 cues**, preserving all
155 existing B records. The other eleven records remain evidence, not subtitles.

The raw evidence and machine integration decisions were frozen before reference
body access. The historical reference did not supply candidate text or influence
acceptance. Resume reused all ten checkpoints with **zero additional ASR**.

| Measure                                                      |          Frozen B strict | Frozen B representation-recovered |  Local-ASR candidate |
| ------------------------------------------------------------ | -----------------------: | --------------------------------: | -------------------: |
| Timed cues                                                   |                      138 |                               155 |                  156 |
| Existing text/raw/mapped timing mutations in this experiment |                        0 |                                 0 |                    0 |
| New local insertions                                         |                        0 |                                 0 |                    1 |
| New local records withheld                                   |                        — |                                 — |                   11 |
| Old raw-invalid records still excluded                       |                        3 |                                 3 |                    3 |
| New overlap pairs introduced                                 |                        — |                                 — |                    0 |
| Existing positive-overlap pairs                              | Not separately recounted |                                23 |        23, unchanged |
| ASS/SRT/VTT validation                                       |   Frozen bundle verified |              Re-read and verified | Re-read and verified |
| Exact-visible reference distance                             |                     1159 |                              1049 |                 1043 |
| Whitespace-only reference distance                           |                     1028 |                               919 |                  913 |
| Localization P0/P1/P2                                        |           Not recomputed |                         9 / 2 / 6 |            7 / 2 / 7 |
| Localization regions                                         |           Not recomputed |                                10 |                    9 |

“No new overlap” is not a claim that the inherited B timeline is overlap-free.
The 23 inherited pairs were not repaired, deleted, or retimed. There are zero
zero/negative-duration cues in the new serialized candidate. P2 increased: this
is not a blanket quality improvement or an acoustic correctness measurement.

## Execution and identities

| Execution measure                                |                            Observed value |
| ------------------------------------------------ | ----------------------------------------: |
| Planned / executed primary windows               |                                   10 / 10 |
| Primary audio                                    |                   47.11 s, 753760 samples |
| Longest request                                  |                   7.06 s; hard limit 30 s |
| SUCCESS_NONEMPTY                                 |                                         7 |
| SUCCESS_TIMING_INVALID (also nonempty)           |                                         3 |
| SUCCESS_EMPTY                                    |                                         0 |
| Technical failures / retries                     |                                     0 / 0 |
| Total dispatches / requested audio               |                              10 / 47.11 s |
| Retry requested audio                            |                                       0 s |
| Window WAVs / observed provider process starts   |                                   10 / 10 |
| Model load count                                 | UNKNOWN; not inferred from process starts |
| First reservation to last persisted result       |                                  32.153 s |
| Completed checkpoint reuse on subsequent execute |                        10 hits; new ASR 0 |

All ten processes exited successfully. A timing-invalid result is a successful
provider call containing invalid evidence, **not** a technical failure eligible
for retry. Seven plus three above equals ten nonempty responses; these categories
are disjoint. Global retry policy allows at most one technical retry (11 total
dispatches and at most 54.17 seconds for this frozen plan), but none was used.

- BASE_SHA: `1b6de01612c12de5ecafaa746c54c776e20ce72b`.
- Implementation: `477dfdc9e5876222da71b7117969b069ad79fb20`.
- Branch: `codex/subtitle-tool-bounded-asr-local-recovery-integration`.
- Model SHA-256: `d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1`.
- Runtime SHA-256: `e25f8bab12a19e4df44d8889f35944a89816d7dfb01c0f8e5de4727fb0939924`.
- Source PCM SHA-256: `6bd772cda01d11929bdb153a412330d88c6c7761fe8dd1bd9f35e52da7a47644`.
- Source media identity: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`.
- Recovery identity: `77a1cc067d042276bd8c91b591484630e12e179871e49beacf538bad3e8a1b7b`.
- Frozen plan SHA-256: `02e71ab9297d59abca28e9d984a97cef20de5fa7e3d930cb1583811a5483ff91`.

All 37 saved request WAVs were authenticated against the historical journal and
PCM hashes. Their nonoverlapping cores reconstructed the exact original PCM hash;
context samples were not concatenated twice. Only the ten requested slices were
written as new WAVs and re-read. No source-media decoding or new full-source WAV
was needed. Saved WAVs, model, and runtime were verified again after the run.

The explicit argv matches the historical adapter: model, file, Japanese,
four threads, SRT output, output prefix, suppress-NST, no-prints. No prompt, VAD,
token-timestamp, context, or new decoding flag was added. A model symlink in an
isolated directory without a Core ML encoder preserves the Core ML-off contract.
The current help options section exactly matches the saved section. Same-hash
defaults are best-of 5, beam-size 5, temperature 0, increment 0.2, fallback enabled,
max-context -1, flash attention on, processors 1. These defaults are distinguished
from explicit argv; no historical argv was invented. Historical transitive
dynamic-library byte identities were not recorded and cannot be proven now.

## Machine gates and result accounting

The exclusive primary decision counts are: INSERTED_SAFE_GAP 1,
EVIDENCE_ONLY_CORE_BOUNDARY 8, BLOCKED_INVALID_TIMING 3. All reasons, including
secondary reasons, remain in the private decision records: conflict with existing
B 4, repetition risk 2, serialization blocked 3. These secondary counts overlap
and must not be added to the twelve-record denominator.

Whole segment containment is required, with equality allowed. Context-only or
core-crossing segments are not cropped. This segment-only runtime contract does
not request trusted token evidence; merely attaching token-like metadata cannot
authorize substring projection. Raw/mapped invalid times are never repaired by
serialization. The existing representation-safe centisecond projection is reused
only for eligible representation issues, followed by neighbor overlap checks.
Local-local collisions exclude all members; equal-start ties and immediate
temporal-neighbor exact duplicates are rejected. No reference score is a gate.

Baseline order, text, raw clocks, mapped provenance and projected output clocks
are preserved; no existing record is replaced, split, merged or deleted. A staged
ASS/SRT/VTT triple is parsed and checked before its directory is atomically
published. The export map binds output order to original/local IDs and decisions.

## Reference evaluation — diagnostic only

| Side / policy               |    M |   S |   D |   I |    N | Machine length | Distance | Edit ratio |
| --------------------------- | ---: | --: | --: | --: | ---: | -------------: | -------: | ---------: |
| Before / exact-visible-v1   | 1428 | 391 | 468 | 190 | 2287 |           2009 |     1049 |   0.458679 |
| After / exact-visible-v1    | 1434 | 391 | 462 | 190 | 2287 |           2015 |     1043 |   0.456056 |
| Before / whitespace-only-v1 | 1415 | 352 | 386 | 181 | 2153 |           1948 |      919 |   0.426846 |
| After / whitespace-only-v1  | 1421 | 352 | 380 | 181 | 2153 |           1954 |      913 |   0.424059 |

The name remains `DELIVERABLE_TO_HISTORICAL_REFERENCE`, not CER. Stream and edit
path hashes are recorded in private JSON. Localization uses unchanged
`reference-guided-missing-localization-v1`: deletion association from the full raw
machine stream, temporal coverage from the deliverable stream. The historical
before result was reproduced (9/2/6, ten regions). Recomputed plans are diagnostic
only and do not authorize another window. Reference completeness and acoustic
correctness were not reverified. No listening review was required or performed.

## Freeze and reproducibility

| Boundary                | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Execution freeze        | `804ceb4692ebe4db9016e1f0990c77e15d00795d1746a8bba37517a1f3bd5724` |
| Raw freeze              | `057402d5845934eca3a93666b1d70e1782835b299bcc36a1e67ddc4ca1faf456` |
| Machine decision freeze | `8b96bea14fa69100e0d219d6884c896c05e811696fc42680d663b757f901b183` |
| Results freeze          | `e274006e8354dc7116c10971df893bbfacc78f04ca9e40231a7ad4f011684d78` |

The phase-1 recovery read is an explicit machine-file allowlist pinned to the
accepted freeze. Whole-bundle verification (which reads embedded reference text)
is deliberately deferred until raw and decision freezes pass. Phase-1 tests deny
reference-bearing reads; the provider receives only a slice WAV and model path.
An interrupted reservation is fail-closed, not an automatic repeat. All completed
files and journal hashes are verified on resume; corruption never launches
replacement inference. The execution module's code hashes are pinned in the run.

Actual verified commands, with private run path replaced by `<run>`:

```sh
node scripts/subtitle-tool-bounded-local-asr-recovery.mjs execute --run <run> --resume --authorize-frozen-local-asr
node scripts/subtitle-tool-bounded-local-asr-recovery.mjs integrate --run <run>
node scripts/subtitle-tool-bounded-local-asr-recovery.mjs evaluate --run <run>
node scripts/subtitle-tool-bounded-local-asr-recovery.mjs verify --run <run>
```

The initial private run was created by the exported `prepare()` API with the
explicit authorization file and flag, before invoking execute. `prepare()`
performs identity checks and saves the frozen WAV/manifest set, not inference.
Exact preparation parameters and local paths are in the private reproduction
guide. The npm alias is `experiment:subtitle-tool:bounded-local-asr-recovery`.
Product defaults and Skill 2/3 were not changed.

## Validation and limits

- Full workspace TypeScript typecheck: passed (`tsc -b --pretty false`).
- Standalone build: passed (`tsc -b packages/video-subtitler/tsconfig.json`).
- ESLint and Prettier on all changed JS/MJS/JSON files: passed; diff check passed.
- Related Node suite: **108 passed, 0 failed, 0 skipped**, including 27 new neutral tests.
- Related Vitest unit/E2E: **47 passed, 0 failed, 0 skipped**, three files.
- Real candidate triple, freeze hashes and integration recomputation: passed.
- Post-evaluation execute: **ten checkpoint hits, zero new ASR**; verify passed.

The first Vitest attempt failed four environment preconditions because npm was
not version 11. With npm 11, two tests exposed macOS `/var` symlink paths. Running
with Node 24, npm 11 and `TMPDIR=/private/tmp` passed all 47 tests; no product
guard was relaxed. The Node suite includes generate/resume/recover/edited export,
bounded A/B, timestamp, representation recovery, content/reference review and CSV
regressions. No unrelated full research suite, new VAD, whole-media ASR, alternate
model, extraction, external search, acoustic listening acceptance, or CER was run.

## Final gates and privacy

`LOCAL_ASR_EXECUTION_COMPLETE`, `LOCAL_ASR_RAW_EVIDENCE_FROZEN`,
`MACHINE_INTEGRATION_EVALUATED`, `LOCAL_ASR_RECOVERY_CANDIDATE_READY`.

`FULL_TIMED_EXPORT_STILL_BLOCKED`; `qualityStatus=needs-review`;
`finalizationMethod=none`; `CER=NOT_MEASURED`; `humanValidated=false`;
`referenceIsValidatedGold=false`; `machineOnlyReleaseAuthorized=false`;
`productDefaultChanged=false`.

Whole-media ASR, new VAD dispatch/inference, source extraction, external reference
search, reference text used as prompt, existing subtitle text/raw/mapped timing
mutations: **all zero**. This experiment is complete; no additional window,
replacement, threshold relaxation or subsequent experiment was authorized.

Private output is **PRIVATE / NOT FOR PUBLIC DISTRIBUTION**. Raw SRT, audio,
reference text, subtitle bodies, logs, models and private absolute paths are not
committed. This public report contains only redacted identities and measurements.
