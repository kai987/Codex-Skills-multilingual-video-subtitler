# C6.0.1.18.1 Reazon Output Coverage & Runtime-contract Audit

## Outcome and stopping point

Primary exit: **B — `NO_STATIC_VIOLATION_FOUND_INTERNAL_TRACE_MISSING`**.
This bounded audit excludes loss in the project's saved `result.text` transport
and confirms the expected complete waveform at the recorded Python boundary.
It does **not** establish the cause of the short outputs. No demonstrated
amplitude, feature, length, decoder/context or vocabulary incompatibility was
found in the checked code. Uninspected graph fields and native execution remain
unknown; this is not a proof that the integration has no bug.

The missing decisive observation is a request-bound chain of **actual feature
length → actual encoder effective length → decoder traversed-frame and emission
accounting**. Final emission points cannot reconstruct that chain.

No recognition, acoustic forward, model load, Provider start, feature extraction,
new audio window, subtitle change, parameter change or quality evaluation was
performed. This task stops after its offline audit, validation and branch delivery.
Do not initiate another similar zero-inference audit without new evidence.

Audit date: 2026-09-09 JST (2026-09-08 UTC). Output allocator uses UTC dates.
Baseline: `8d97a4168c3e3fa96826665abf5af929f410697d`.
Branch: `codex/c6-0-1-18-1-reazon-output-runtime-contract-audit`.

## Rechecked evidence versus inherited quality

Read the actual Skill, package/lock, .18 formal report, project worker, legacy
WAV reader, coordinator/request serializer, candidate export and scoring source.
The two named independent-review files were not found in the baseline repository,
current output tree or Downloads: `C6_0_1_18_INDEPENDENT_REVIEW_AND_NEXT_STEP.md`
and `C6_0_1_18_INDEPENDENT_AUDIT_SUMMARY.json`. They are **not claimed as read**.
The user's supplied observations were hypotheses to verify against saved data.

Evidence levels are intentionally separate: saved hashes/responses are
`OBSERVED_IN_SAVED_ARTIFACT`; PCM scaling and statistics are
`RECOMPUTED_FROM_FROZEN_INPUT`; fixed-version control flow is
`STATICALLY_DERIVED_FROM_PINNED_CODE`; formula-derived frame counts are
`EXPECTED_BUT_NOT_OBSERVED`; unavailable graph/internal execution fields are
`UNVERIFIED_OR_UNAVAILABLE`. None of the latter three can populate a historical
observed tensor or frame count.

The audit joins plan/reservation/request/WAV/forward event/stdout response/saved
response/envelope/exported raw response/transcript JSON/UTF-8 text by unique unit
and request identity. Missing, duplicate or unexpected IDs fail closed. The
response order matches the plan; model/input/envelope hashes match. Both A and B
R0 exports were read without invoking the generator. Source PCM, .18 frozen WAV
hash and the whole padded float array agree for all twelve units. The same PCM
identity does not independently establish the original track's semantic
correctness: there was no new extraction or listening-based track judgment.

| Recomputed or rechecked in this audit          |            Result |
| ---------------------------------------------- | ----------------: |
| Complete units / successful saved responses    |           12 / 12 |
| Raw / padded duration                          | 258.39 / 279.99 s |
| Reazon / Primary normalized characters         |         291 / 883 |
| `result.text` = R0 JSON = UTF-8 TXT, A and B   |     12 / 12 units |
| Saved token concatenation = `result.text`      |           12 / 12 |
| Token/timestamp cardinality matches            |           12 / 12 |
| Nonfinite / decreasing / outside-padded points |         0 / 0 / 0 |
| Points in existing padding (retained)          |                21 |
| First-to-second emission gap above 8 s         |            7 / 12 |
| Padded inputs above 30 s                       |            3 / 12 |

`INHERITED_METRICS_NOT_NEW_QUALITY_EVALUATION`: the prior normalized
Primary S/D/I/N = 159/35/42/876; Reazon = 44/603/18/876; Reazon CER = 75.9132%;
whole-unit oracle gain = 3 edits. These values are quoted from the frozen formal
report, **not rescored here**. Gold/reference files were not opened for content,
and the evaluator was not run. Protected reference files were hashed only.
603 reference edit-path deletions are not 603 skipped acoustic frames. Smaller
S/I does not establish greater precision. Prior tail-text correspondence is
reference-relative, not new independent listening evidence.

## All-unit descriptive pattern

Neutral row numbers follow the frozen plan. Exact local unit IDs, all point
arrays, continuous gap distribution and source-global coordinates remain in
the local CSV; the public report contains no dialogue or private paths.
Raw and normalized Reazon character counts happen to coincide in this dataset.

| Row | Raw s | Padded s | Characters / tokens | First point s | Last point s | First gap s | Max gap s |
| --- | ----: | -------: | ------------------: | ------------: | -----------: | ----------: | --------: |
| 1   | 29.13 |    30.93 |                  11 |          0.00 |        30.52 |       28.16 |     28.16 |
| 2   | 28.29 |    30.09 |                  19 |          0.00 |        29.68 |       26.24 |     26.24 |
| 3   | 29.70 |    31.50 |                  13 |          0.04 |        31.08 |       26.76 |     26.76 |
| 4   | 25.48 |    27.28 |                   6 |          0.04 |        24.60 |       23.96 |     23.96 |
| 5   | 24.01 |    25.81 |                  28 |          0.04 |        21.64 |        1.56 |      2.92 |
| 6   | 27.42 |    29.22 |                   5 |          0.04 |        27.72 |       27.04 |     27.04 |
| 7   | 16.39 |    18.19 |                  40 |          0.00 |        14.92 |        1.28 |      1.40 |
| 8   | 26.94 |    28.74 |                  90 |          0.00 |        26.52 |        0.80 |      3.92 |
| 9   |  1.62 |     3.42 |                   2 |          0.04 |         1.24 |        1.20 |      1.20 |
| 10  | 19.91 |    21.71 |                  18 |          0.00 |        20.12 |       17.68 |     17.68 |
| 11  | 18.85 |    20.65 |                  46 |          0.08 |        19.24 |        1.12 |      7.32 |
| 12  | 10.65 |    12.45 |                  13 |          0.00 |        12.12 |        8.80 |      8.80 |

Rows 1–4, 6, 10 and 12 reproduce the historical long-first-gap pattern.
Rows 7 and 8 also start at zero but have more distributed emissions. The short
row 12 and comparatively long row 8 contradict a length-only explanation.
This is a descriptive output pattern, not measured speech coverage. Eight seconds
is the prior descriptive cutoff only: it performs no request filtering or token
deletion. Local = padded − 0.9; source-global = source offset + local. Negative
local padding points remain negative; no point is clamped, dropped or fitted.

## Waveform, frontend and length boundaries

All WAVs are RIFF PCM16, mono, 16 kHz, signed little-endian samples. Full chunk
sizes and frame counts were checked, including block alignment and byte rate.
Recomputed float32 values use int16 / 32768 exactly once, followed by 14,400
zero samples on each side. There is no extra gain, normalization, resampling,
source-offset crop, overflow or nonfinite sample introduced in this code path.
The first third of every original PCM has nonzero samples (RMS approximately
0.0223–0.0489); this excludes an all-zero prefix, **not** absence/presence of
dialogue. All original PCM and padding remain untouched.

The worker emits its array hash after `accept_waveform` returns and before
`decode_stream`. This validates the recorded complete Python array and returned
call boundary, not an instrumented C++ copy, extracted feature tensor, encoder
consumption or all-frame decoder traversal.

The fixed official Reazon wrapper's `norm_audio` only resamples and mixes
channels. Its 0.9-second padding matches this project. Its >30-second padded
warning concerns memory; the function proceeds without a clipping branch.
The project's 32-second opt-in cap is not an acoustic-quality guarantee.
[Pinned Reazon audio and transcription source](https://github.com/reazon-research/ReazonSpeech/tree/be5c4d8b82b0cd955f7a5c201ebd63776ab9b662/pkg/k2-asr/src).

For the pinned Sherpa offline transducer path: sample rate 16000 and feature
dimension 80 are explicit. Python default dither is zero. Native configuration
defaults are normalized samples, non-snipped edges, 25-ms frames, 10-ms shift,
20-Hz low cutoff, Nyquist−400-Hz high cutoff, DC removal and Povey window.
The offline stream copies preemphasis/FFT-rounding behavior from knf defaults
(0.97 / true); do not confuse the separate streaming `FeatureExtractor` class
with this actual offline path. Normalized samples are passed through; the
opposite setting would multiply by 32768, not normalize by peak.
[Pinned offline frontend](https://github.com/k2-fsa/sherpa-onnx/blob/1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911/sherpa-onnx/csrc/offline-stream.cc).

`InputFinished` flushes frames. Under pinned knf's non-snipped, flushed rule,
EXPECTED_FEATURE_FRAMES = floor((padded samples + 80) / 160). In plan order:
3093, 3009, 3150, 2728, 2581, 2922, 1819, 2874, 342, 2171, 2065, 1245.
These are **expected, not observed**. Actual feature frames, encoder output
shape/effective length and even a precise expected encoder length remain null.
No recognizer or feature extractor was instantiated to fill the gap.
[Pinned knf frame formula](https://github.com/csukuangfj/kaldi-native-fbank/blob/b09e686fe2084732ddd30d1ef80acfc0f13eaf01/kaldi-native-fbank/csrc/feature-window.cc).

## Installed identity and static compatibility limits

The .18 executable hash and all 839 previously recorded runtime files still
match. Python 3.13.14, sherpa-onnx/core 1.13.6 and NumPy 2.2.2 distribution
metadata were read without importing the recognition runtime. The venv uses
system site packages; NumPy comes from that Python installation. The installed
Python `offline_recognizer.py` byte-matches tag v1.13.6, commit
`1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911` (file SHA-256
`f862ba8b174bdd7eef6562729ac1518bf444ea4dbde12db98c92221e6065402e`).

| Installed artifact              | SHA-256                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| CPython executable              | ee3c4103b97e32a98e98cfad7f6ca4d09b2ab2dc16f3d28e18b54a4a0244efe0 |
| Sherpa CPython native extension | 4307213897c81ced0f263a91ef119185972ed75df72efbdb04a338e2a6d36665 |
| Bundled ONNX Runtime dylib      | a02e26ab11a8265a6a43491e3e99ee0880e19fe51a7eebecc27a28d673f879c5 |
| Sherpa C API dylib              | 9a8333287e0576aa6ae476b42bf9d8fd19c1178d50a05aae662c2102200adea5 |
| Sherpa C++ API dylib            | 39f139add755a817baeab2687a2afbcd60b0bdaa4a46f0e69877f9731ae109c2 |

The wheel tag is cp313/cp313/macosx_11_0_arm64. Official PyPI's matching Sherpa
wheel SHA-256 is `cdb0f9fcaae89f8acd1ee9ce5fe89e77be3aa240cdedab3f48aa7b19800d8b72`
(published 2026-08-18). This audit did not download/reinstall the wheel or prove
native reproducible-build equivalence. Static strings in the bundled ORT dylib
contain `1.27.1`; this is **binary string evidence**, not a queried API version
or a proven build provenance. No ORT Python package/parser was found in the
checked runtime, system Python, project bootstrap environments or bundled
document runtime. No tool was installed and no `InferenceSession` substituted.
[Pinned release metadata](https://pypi.org/pypi/sherpa-onnx/1.13.6/json).

All three FP32 ONNX hashes and tokens were reread. They match both the frozen
plan and official model revision `291488c8151be24d7da4bf7af26e533fad96e407`
(2024-08-01). ONNX files match LFS size/hash; tokens match the repository's Git
blob ID as well as the frozen SHA-256. This establishes a coherent file set,
not their internal execution. Snapshot hash remains
`607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`.
[Fixed model metadata](https://huggingface.co/api/models/reazon-research/reazonspeech-k2-v2/revision/291488c8151be24d7da4bf7af26e533fad96e407?blobs=true).

Tokens have 5,224 unique symbols/IDs, contiguous IDs 0–5223, blank 0 and unk 5222. They are not all single-code-point symbols. **Graph signature, initializer
shape/type, external-data description, decoder-declared vocabulary/context size,
joiner dimensions and encoder output length metadata were not available from a
saved sidecar or installed static parser. These remain unknown.** Do not infer
model-declared vocabulary size from token count. No external-data paths were
followed. Generic tests can flag explicit dimension/type/vocabulary conflicts
without presenting synthetic metadata as this model's measurements.

## Decoder and result-text boundary

The fixed source creates a new stream per request. `GetFrames` provides the
feature vector; its frame count feeds the encoder length tensor. Encoder length
types are checked/cast from declared int32/int64. The decoder receives encoder
output plus its effective length; packing determines its traversal range.
The source does not impose a last-sentence-only output rule.
[Pinned length plumbing](https://github.com/k2-fsa/sherpa-onnx/blob/1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911/sherpa-onnx/csrc/offline-recognizer-transducer-impl.h).

Greedy decoding takes one argmax per encoder frame, ignores blank/unk, updates
context after emissions and removes only the synthetic initial context from
the returned sequence. Initial context is -1 entries followed by blank 0;
context size is read from metadata. Default blank penalty is zero. None of
these implementation facts proves what happened in the unobserved execution.
There is no justification here to change beam, penalty, context or per-frame
emission behavior.
[Pinned greedy decoder](https://github.com/k2-fsa/sherpa-onnx/blob/1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911/sherpa-onnx/csrc/offline-transducer-greedy-search-decoder.cc).

The transducer source maps emission indexes with 10 ms × hardcoded factor 4;
native conversion includes CJK-space handling, but observed token joins equal
observed `result.text` for all twelve requests. The .18 worker retains text
without strip, token filtering or zip truncation. Complete JSON and UTF-8 export
are lossless. Therefore **project processing after result.text returns cannot
explain the deletion pattern in these twelve saved outputs**. No additional
text-preservation wrapper was added. Stub tests validate project control flow,
not acoustic correctness of the native decoder.

## Minimum future diagnostic, NOT EXECUTED

If separately authorized, keep exactly the existing FP32/CPU/one-thread/greedy
configuration and original WAV/padding. Use two mechanically chosen existing
requests: shortest raw input in the inherited first-gap>8 group (row 12), and
longest raw input outside it (row 8). This is a diagnostic contrast, not new
generation filtering or a Gold-selected quality optimization. No beam, gain,
penalty, crop, model or language-model changes.

Record actual configuration and request/input hashes; feature shape and effective
length immediately after extraction; encoder output shape/effective length;
decoder traversed frames and blank/unk/nonblank counts with emitted frame IDs.
Check that traversal matches the supplied valid encoder length. Capture model
graph metadata during that authorized runtime load if necessary. Numeric traces
are only a few KB per request; retain local-only linkage, no transcript/PCM upload,
no default full tensors or logits. This single length/traversal trace separates
input-length truncation from full traversal with mostly blank/unk decisions.
Neither branch can be inferred from present output points alone.

## Validation, preservation and reproducibility

The audit CLI runs under Node 24 permission mode without child-process/addon
permission, and OS network denial. It only hashes model files; static file reads
are not model loads. Historical .18 execution is separately retained: completed
12 attempts/12 forwards/1 load; initial pre-load startup failure 0 attempts/0
forwards/0 loads. New audit counters are all zero. Source retrieval and Git
transport are separate from experiment networking. No private content is sent
with fixed public repository/version queries.

Initial neutral E2E failed due Node 23 plus macOS `/var` canonical-path permission
handling; after pinning Node 24 and using canonical fixture paths it passed.
One real offline-reader startup failed before artifact processing because of
overlapping permission prefixes; a deduplicated runtime-root allowlist fixed
that reader. These were audit/test process failures, not model/provider starts.
No assertion was weakened and no timeout extended. Local receipts retain the
failures; skipped tests are not counted as passes.

The first full test invocation also encountered seven nested-sandbox failures
across six files (`sandbox_apply: Operation not permitted`). The redundant outer
test-runner sandbox was removed; existing per-test isolation and all assertions
were retained. Model opt-in remained disabled with a clean child environment.
Offline npm cache installation emitted an npm 10 engine warning; all final
execution/build/test commands use Node 24.19.0 and the lockfile is unchanged.

Final engineering results and old-work protection are bound in the external
validation/delivery receipts; they must not be inferred from .18's old totals.

| Final current-run check                                       | Result                                           |
| ------------------------------------------------------------- | ------------------------------------------------ |
| Typecheck / lint / format / TypeScript build / frontend build | All exit 0                                       |
| Full test suite, two workers                                  | 183 files; 1,529 passed, 2 skipped; 107.27 s     |
| E2E subset, two workers                                       | 48 files; 105 passed, 1 skipped; 30.72 s         |
| New audit tests included in full suite                        | 19 unit + 2 E2E passed                           |
| Saved response schema / final raw-byte text chains            | 12 schemas / 24 A/B chains passed                |
| Historical file and worktree protection                       | 25,974 files unchanged; old Git states unchanged |

E2E is already included in the full suite and is not added again to the total.
The two skipped tests are not passes; real-model opt-in remained off. The final
byte-chain supplement reads raw file bytes, avoiding invalid UTF-8 replacement
masking. It binds the final helper/code hashes to the same frozen exports; the
main audit manifest retains its original execution-time code hashes rather than
being retroactively relabeled. Both receipts are required for provenance.
The final report formatting check follows the last documentation-only edit.

Reproduce only with existing dependencies and pinned public-source snapshots:

```sh
node scripts/audit-c601181.mjs "$C18_COMPLETED" "$C18_STARTUP_FAILED" "$AUDIT_PARENT" "$PINNED_SOURCE_DIR"
./node_modules/.bin/vitest run tests/c601181-runtime-audit.test.ts tests/e2e/c601181-offline-audit.test.ts --maxWorkers=2
```

The CLI allocates a fresh directory, never writes old evidence and never imports
a provider or evaluator. The output is local-only: manifest, coverage CSV,
private chain details, runtime matrix, observability gaps, validation and index.
Only generic audit code/tests and this sanitized report belong in Git. Detailed
text, private paths, waveforms, runtime binaries and old outputs are excluded.
The final commit is identified by a post-commit external delivery receipt to
avoid a self-referential report hash.

`QUALITY_EVALUATION=NOT_RERUN`; `FINAL_SUBTITLE_CHANGE=0`; `G11_CHANGED=false`;
`DEFAULT_PROMOTION_AUTHORIZED=false`; `MACHINE_RELEASE_AUTHORIZED=false`;
`status=needs-review`; `finalizationMethod=none`.
