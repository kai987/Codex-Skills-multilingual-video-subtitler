# C6.0.1.18 Same-unit ASR Candidate Gain & Frozen-assembly Comparison

## Outcome

The fixed Reazon configuration provides **small selective whole-unit information
gain, not an overall improvement**. Normalized comparison improves two units,
regresses ten and ties none. Micro CER increases from 236/876 (26.9406%) for
Whisper Primary to 665/876 (75.9132%) for Reazon. The whole-unit oracle reduces
only three edits, from 236 to 233; it is not a machine selector.

Route: `SELECTIVE_COMPLEMENTARITY_ON_KNOWN_UNITS`, with a substantial aggregate
error tradeoff. One C1 coverage unit improves by two normalized edits while
both hypotheses remain nonexact. A short C1 risk unit with N=2 improves by one
edit to normalized reference-exact. Thus the benefit is not confined to one
unit, but it is tiny and concentrated: 2/3 of oracle gain comes from one unit.
Exact comparison improves only one unit, ties one and regresses ten.
There is no demonstrated broad advantage and no reason to replace Primary.

W0 reproduces the frozen raw Primary text in all twelve units. W1 really
re-executes G11 and reproduces the old ASS/SRT/VTT bytes in all 72 comparisons
(12 units x 3 formats x A/B). W0/W1 normalized sequences remain equal in 12/12.
The playable baseline subtitles have **not improved** in this experiment.

`AUTOMATIC_CROSS_MODEL_SELECTION=NOT_IMPLEMENTED`;
`FINAL_SUBTITLE_APPLICATION=NOT_IMPLEMENTED`.
Retain `needs-review`, `finalizationMethod=none`, `humanValidated=false`,
`defaultPromotionAuthorized=false`, `machineOnlyReleaseAuthorized=false`.

## Frozen baseline, scope and protected work

Unique baseline: `48b6dcb180690a0cb29d1da8af68a74c18b4fe13`.
Research branch: `codex/c6-0-1-18-same-unit-asr-gain-frozen-assembly`.
The independent worktree was created after read-only HEAD/status/staged and
unstaged diff/worktree checks. The original .14.6 draft was not imported or
committed. A reused private protection inventory records 23,784 historical
source/evidence/media/reference files and old worktree/index identities.
No switch, pull, stash, reset, clean, forced push or old-output overwrite.

The actual Skill, package/lock metadata, .17.1/.17.2 reports, matched replay,
Primary response projection, Reazon provider/worker, model ledger, reference
closure/preflight, character evaluator and generation isolation were read.
All existing source files except package.json script registrations are unchanged.
In particular G11, its dependencies, the old Reazon worker/provider and default
production duration limit remain byte-identical to the baseline. Skill 2/3 are
unchanged. No deduplication, timing, text repair, layout or default profile tuning.

G11 remains `interCuePolicy=overlap-required`,
`intraCuePolicy=source-preserving`; acoustic/stored/groups hooks are disabled.
The same twelve .17.1 complete units are used: D1=6 and C1=6, with two units
per coverage/machine-risk/low-risk stratum. No recropping, expansion or reselection.
Both partitions are `KNOWN_DEVELOPMENT_RECHECK`.
`BENCHMARK_REFERENCE_SEGMENTED=true`, `HELDOUT_VALIDATION=NOT_RUN`,
`UNSEGMENTED_END_TO_END_VALIDATION=NOT_RUN`.

## Audio, runtime and execution integrity

The old dataset/model-input/evidence/generation freezes and closure credential
were verified before recognition. Each original mono PCM16 16-kHz WAV is copied
without transformation, and WAV hash, PCM data hash, sample count, bit depth,
duration, source offset and old Whisper request/response identities are checked.
This is a comparison of two fixed recognition systems on identical original PCM,
not a pure neural-architecture experiment with identical internal preprocessing.
Whisper's existing fixed preprocessing/decode identity remains historical evidence;
it was not re-executed or changed.

Reazon uses the installed official FP32 snapshot, CPU, greedy_search, one thread,
16-kHz input, feature_dim=80 and the unchanged 0.9-second zero padding on each side.
The opt-in request schema and worker explicitly require a 32-second padded limit,
while rejecting raw audio over 30 seconds. The original worker still defaults
to a 30-second padded limit. Nothing was truncated, split, resampled or repadded.
All twelve actual float32 padded input hashes and sample counts match independently
computed values. Maximum raw duration=29.70 s; maximum padded duration=31.50 s.

- Model: reazon-research/reazonspeech-k2-v2, revision
  `291488c8151be24d7da4bf7af26e533fad96e407`.
- Snapshot SHA-256: `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`.
- Execution identity including model/runtime/host/policy/frozen implementation:
  `be3cf4114024e4bb249e0774b6cea2db28e52c7bb597054a6e3280986c8af6eb`.
- Apple M1 Pro, arm64, Darwin 25.6.0; Python 3.13.14, sherpa-onnx 1.13.6,
  NumPy 2.2.2. The four model/token files, executable and 839 runtime package
  files were identity-checked without a neural forward during preflight.

| Counter                                              |                  Actual |
| ---------------------------------------------------- | ----------------------: |
| Logical complete-unit tasks                          |                      12 |
| Fresh recognition attempts / acoustic forwards       |                 12 / 12 |
| Model load attempts / successes                      |                   1 / 1 |
| Successful worker starts                             |                       1 |
| Earlier pre-load startup failure                     |                       1 |
| Total provider start attempts including that failure |                       2 |
| Recognition failures / recognition retries           |                   0 / 0 |
| Successful nonempty / successful empty               |                  12 / 0 |
| Fresh-result cache hits                              |                       0 |
| Raw / padding / decoded seconds                      | 258.39 / 21.60 / 279.99 |
| New Whisper / other neural-model inference           |                   0 / 0 |

The initial sandbox denied Python realpath before model import/loading/recognition.
Its directory and ledger remain intact. Only directory-metadata permission and
the allowlisted runtime working directory were repaired. The request-plan bytes
are identical before and after this startup remediation (semantic hash
`7d3675d7c49481f5cb496ccc3f94557f3d63eb06a9475d33013c72bf8544573e`).
Metadata/runtime-import-only probes are not neural-model loads; both failed
probes and successful isolation checks are distinguished from recognition.
The final actual probe denied reference-content reads and network connections.
No model download, environment upgrade, cloud call or user-audio upload occurred.
An offline dependency installation used the existing cache; npm 10 emitted an
engine warning, but execution/tests used existing Node 24.19.0. Lockfile unchanged.

The model sees neutral WAV paths and fixed parameters, not title, names, Primary
text, reference text, reference boundaries, N or oracle results. Prompt/hotwords
are `NOT_SUPPORTED/NOT_SENT`, not fabricated disabled decoder parameters.
A new recognizer stream is created for each unit. Raw completed responses are
fresh; W0 evidence and A/B R0 consumption are verified stored evidence replay,
not additional inference or a second fresh experiment. No different-window old
Reazon response was used.

## Full-text ingestion and freeze order

The opt-in worker retains result.text without strip, token filtering or rewriting.
It preserves separate original token and timestamp arrays rather than zipped
pairs. Success-empty, execution failure, incomplete response and unavailable
provider are distinct; failed output is never scored as an empty hypothesis.
The full R0 transcript.txt equals the persisted successful response text exactly.
rawResponseComplete describes persistence, not recognition completeness.

All twelve arrays have equal cardinality; their points are finite, monotone and
within padded decode duration. Twenty-one points fall in padding; none causes
text deletion. These are emission points, not verified word spans. No characters
are assigned manufactured durations, no Whisper boundaries are borrowed, and R0
has no ASS/SRT/VTT. Timing capability cannot block full-unit text scoring.

Input/code freeze: 2026-09-08T14:28:34.644Z.
Responses, execution ledger, W0/W1/R0 and A/B generation freeze:
2026-09-08T14:30:24.117Z.
Formal evaluator's first reference filesystem read:
2026-09-08T14:30:40.755Z.
One formal reference scoring process; no post-score model/config/sample change.

The coordinator performed pre-model sealed-reference **hash-only** identity
checks and reused the prior closure credential. Human-reference preparation and
historical evaluation happened previously. This is not a claim that the project
or coordinator never accessed reference files. Generation has an exact Node
file allowlist, no subprocess/addon permission and OS network denial. The model
has narrower OS content access to runtime/model/audio only, with no reference
directory access. Local raw evidence and evaluation-only records are not Git data.

## Complete paired text comparison

All twelve units are evaluable: no missing/failed units and no denominator
reduction. Normalized N remains D1=559, C1=317; exact N=624/335. The evaluator
checks these against the frozen historical reference aggregates, not generator
constants. Whole-output text is scored against the same complete reference.
Exact NFC/display-linebreak and normalized NFKC/punctuation/space/lowercase
handling and the character edit implementation are unchanged.

| Partition/mode | W0 S/D/I/N    | R0 S/D/I/N    | W0 micro/macro CER  | R0 micro/macro CER  | R0-W0 edits | Oracle gain |
| -------------- | ------------- | ------------- | ------------------- | ------------------- | ----------: | ----------: |
| D1 normalized  | 109/31/28/559 | 19/480/3/559  | 30.0537% / 25.9607% | 89.8032% / 84.0777% |        +334 |           0 |
| C1 normalized  | 50/4/14/317   | 25/123/15/317 | 21.4511% / 26.2898% | 51.4196% / 47.4976% |         +95 |           3 |
| D1 exact       | 131/49/49/624 | 21/544/2/624  | 36.6987% / 31.5788% | 90.8654% / 85.0982% |        +338 |           0 |
| C1 exact       | 58/9/21/335   | 26/140/14/335 | 26.2687% / 27.3881% | 53.7313% / 54.0080% |         +92 |           3 |

Aggregate normalized W0=159/35/42/876, R0=44/603/18/876;
micro CER=26.9406% vs 75.9132%, macro=26.1252% vs 65.7876%.
Aggregate exact W0=189/58/70/959, R0=47/684/16/959;
micro CER=33.0553% vs 77.8936%, macro=29.4835% vs 69.5531%.
Normalized improves/regresses/ties=2/10/0; exact=1/10/1. Empty=0.

Every stratum has worse Reazon normalized micro CER. C1 risk macro happens to
improve while micro regresses because the N=2 unit receives half that stratum's
macro weight. It contributes one oracle edit, not a large population benefit.
Per-unit and all stratum S/D/I/N, output lengths, statuses, both normalizations,
raw-to-normalized text and reference-relative categories are in local CSV/JSON.
They are not copied into public source or used to select a generated output.

The Reazon responses themselves contain very short texts in several long units;
this experiment's adapter does not trim them downstream. Large deletion counts
dominate aggregate error. These are reference-relative observations, not a
confirmed diagnosis of a backend cause or a judgment about all Reazon models.
Reference-inconsistent insertion is not automatically hallucination; reduction
in D is not independent acoustic proof of recovered speech. Prepared reference
intervals are closure authority, not phonetic truth.

The normalized whole-unit oracle is 233/876 (26.5982%), a diagnostic gain of
3/876 = 0.3425 percentage points. It is not local-word splicing and does not
demonstrate machine selection. Exact oracle gain=3/959. No oracle-selected
transcript or subtitle is exported. Only a future authorized experiment could
try selection/application; this small result does not justify building one now.

## Validation, delivery and reproduction

Typecheck, lint, format-check, TypeScript build and Vite build passed.
Full bounded unit suite: 1,508 passed, 2 skipped, 181 files.
Explicit E2E: 103 passed, 1 skipped, 47 files, already included in the full count.
New focused tests: 21 passed; adding inherited actual isolation test yields 22.
No opt-in real-model tests were enabled and skips are not passes.
Final protection recheck passed for all 23,784 files and old HEAD/status/staged/
unstaged identities, including the original human ASS and source media.
All 24 W1 packages pass the existing schema/format roundtrip validation; A/B
bytes match. W0 raw and historical P0 projection match all twelve units.
72 old G11 format comparisons pass. The old G11 Exact/timing/one-line-overflow
limitations remain unchanged; no display or timing repair was attempted.
Initial authoring syntax/lint errors were fixed before formal recognition.

Current completed output name: `machine-quality-c6-0-1-18-20260908-wfyzlO`.
Earlier failed startup record: `machine-quality-c6-0-1-18-20260908-wRO28d`.
The completed OUTPUT_INDEX.md links same-unit WAV, frozen W0, playable W1 and
complete R0 source/transcript. The independent B tree is the exact replay.
Detailed metrics and oracle diagnostics live under evaluation/. The startup
remediation receipt and supplemental point/input binding audit remain local-only.

These real entry points require existing Node 24, built workspace dependencies,
the original frozen runs, and a collision-safe output parent:

```sh
npm run typecheck
npm run test:c60118 -- --maxWorkers=2
npm run c60118:prepare-preflight -- "$MVL_17_1" "$MVL_17_2" "$MVL_RUNTIME_CONFIG" "$MVL_OUTPUT_PARENT"
# The preceding command prints MVL_RUN. Do not re-execute this completed run.
npm run c60118:execute-second-asr -- "$MVL_RUN"
npm run c60118:replay-frozen-assembly -- "$MVL_RUN"
npm run c60118:evaluate-candidates -- "$MVL_RUN" "$MVL_SEALED_REFERENCE_MANIFEST"
npm run c60118:validate-delivery -- "$MVL_RUN"
```

Runtime config supplies existing reazonPython/reazonModel, expectedMetadata
(the frozen historical python/sherpa/numpy JSON string) and identityFiles
({path,sha256} for pinned installed runtime files). Model execution rejects
changed freeze/code/runtime/audio credentials, unresolved prior attempts and
implicit startup restarts. Responses completed under the exact plan can be
replayed before generation freeze; successful recognition is never quality-retried.
Validation/evaluation destinations use exclusive writes and refuse overwrites.
Only generic code/tests and this aggregate report are pushed on the new branch.

## Stop and smallest next direction

The formal experiment is complete. No additional ASR, third model, alignment,
sample, arbitration, vote or default promotion follows the result.
The smallest useful next task would be a separately authorized **no-new-inference
audit of existing Reazon input/decode artifacts and backend capability**, to
explain the severe long-unit deletion pattern before considering any selector.
This investigation and independent-source validation are not performed here.
