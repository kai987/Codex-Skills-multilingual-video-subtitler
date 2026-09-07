# C6.0.1.16.2 — Bounded Acoustic Repetition Verification

## Outcome

`BOUNDED_VERIFICATION_COMPLETE_EVIDENCE_INCONCLUSIVE`.

The bounded experiment actually executed all 12 authorized local ASR requests on 2026-09-07. It produced new observations, but not sufficient trustworthy core-localized evidence to authorize any of the three text mutations. All three decisions are `ABSTAIN_KEEP_STAGE_INPUT`; E1 and E0 export identical subtitles. Keeping the input is not confirmation that it is correct: one retained whole hypothesis conflicts with the post-freeze reference and is absent from all four fresh window transcriptions.

Quality remains `HOLD_NO_GAIN_KNOWN_REFERENCE_CONTRADICTION_RETAINED`. The experiment does not establish precise repetition counts, correct all lexical errors, or approve production subtitles.

## Baseline and scope protection

- Exact base: `98aea57f686d1dc2fb6be723daab66d931cf5420`.
- Independent branch: `codex/c6-0-1-16-2-bounded-acoustic-repetition-validation`.
- Pre-inference implementation commit: `f8a375996419638c47a5e8a6789c44a90ae20572`.
- The original dirty .14.6 worktree, its staged/unstaged state and untracked work, .16 and .16.1 source, historical outputs, original media, and human reference were protected with a private snapshot. Post-run verification: `PROTECTED_FILES_UNCHANGED 5176`.
- No Skill 2/3 source changes, no old-output rewriting, and no changes to default legacy/source-preserving behavior. The new adapter is experimental only.
- The available .16.1 report, source, stage traces, and delivery evidence were inspected. The separately named independent-review Markdown and independent-audit JSON were not found in the checked known locations; no findings from missing documents are claimed.

The input retains the `PRIMARY_ONLY_MATCHED_PROFILE` boundary. This is not complete historical H1 reproduction, full-film title-free inference, or unseen-material validation. Historical Primary evidence remains historically produced evidence; title-free settings in the 12 new requests do not retroactively change its provenance.

Historical normalized identity checks, N=2048: R0 S/D/I=605/175/278, distance 1058; R1=573/249/148, distance 970; R2=599/212/154, distance 965. The historical five-edit R1-to-R2 improvement is not a gain from this experiment. The .16.1 `QUALITY_TRADEOFF_HOLD` is unchanged, and its 14 cross-cue deletions are not newly certified as acoustically correct.

## Machine-derived selection and new observations

Selection compares actual legacy destructive intra-cue operations with source-preserving abstentions, reconstructed from machine stage traces. Exactly three cases were found; no Gold-derived diagnostic collection was imported and no first-three truncation was used. Case IDs identify the local experiment, not branches in the generic algorithm. Exact occurrence IDs, input text, sample coordinates, neighbors and lineage stay in the local-only `cases.machine.json`.

| Machine case                                   | Trace provenance and new observation                                                                                                                                                                                                                                                                                                      | Core comparability                                                                        | Frozen machine decision and post-freeze evaluation                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| case-01, repeated-call question                | A legacy intra-cue collapse contrasts with a preserved input. The core includes both raw occurrences connected by the upstream exact-dedup lineage, including the occurrence no longer present as a separate final cue. Whisper produces repeated calls with window-dependent structure; Reazon produces different contextual utterances. | Whisper W1: `CONTEXT_CONTAMINATED`; W2: `CORE_COMPARABLE`. Reazon W1/W2: `UNLOCALIZABLE`. | Classification and utterance structure `UNKNOWN`; abstain. Reference supports repeated-call structure only, not an exact acoustic count. The related upstream collapse remains a separate unresolved diagnostic, not a repaired stage. |
| case-02, whole prompt-like hypothesis question | A legacy repeated-span collapse contrasts with a preserved input. None of four fresh whole-window transcriptions contains the old whole prompt-like hypothesis. This is a lexical-support conflict before any once-versus-many question.                                                                                                  | Whisper W1/W2: `CONTEXT_CONTAMINATED`; Reazon W1/W2: `UNLOCALIZABLE`.                     | Classification and utterance structure `UNKNOWN`; abstain. Post-freeze reference contradicts the retained whole hypothesis. Absence from new ASR is neither silence evidence nor deletion authorization.                               |
| case-03, adjacent-similar-expression question  | A legacy containment deletion contrasts with a preserved input. Narrow-window observations suggest two related but distinct clauses and a noun variant; wider windows and endings differ.                                                                                                                                                 | Whisper W1/W2: `CONTEXT_CONTAMINATED`; Reazon W1/W2: `UNLOCALIZABLE`.                     | Classification and utterance structure `UNKNOWN`; abstain. Reference supports adjacent distinct expressions and the noun variant only; full lexical correctness and exact event counts are not established.                            |

Across 12 observations: 1 `CORE_COMPARABLE`, 5 `CONTEXT_CONTAMINATED`, 6 `UNLOCALIZABLE`. Whole-window differences are not treated as localized lexical instability. Reazon supplies point timestamps, not word intervals. Initial points occur inside prepended padding, and some final points fall in trailing padding. After the single configured padding/source offset transformation, these are not valid complete physical-window localization evidence. The guard rejects them rather than clamping points or inventing word intervals. There was no additional alignment inference.

Repeated windows from one model are correlated stability observations, not independent votes. Cross-model agreement is also machine support, not acoustic truth. No direct listening was performed: listener/time are null, `audioConfirmed=false`, and `humanValidated=false`. Post-freeze reference labels are stored separately from runtime evidence and decisions. The developer was already exposed to this known sample; this is not a blind test.

## Real execution and runtime identity

The original source identity was verified against Primary evidence. Audio stream 1 uses a 48,000 Hz native timebase and zero media/audio start. Continuous original audio was trimmed using native sample boundaries, reset to local origin, and converted to mono 16 kHz PCM16 WAV. Frame counts were checked. W1 uses the machine core envelope plus 0.5 seconds on each side; W2 uses plus 2 seconds. No Gold boundaries, text-derived alignment, synthetic audio, or noncontiguous concatenation were used.

| Case    | W1 raw seconds | W2 raw seconds | Requests |
| ------- | -------------: | -------------: | -------: |
| case-01 |              5 |              8 |        4 |
| case-02 |              8 |             11 |        4 |
| case-03 |              7 |             10 |        4 |

The six WAV files contain 49 seconds in total. Across two models, requested raw audio totals 98 seconds. Reazon adds 0.9 seconds of silence to each side of each request; counting this padding gives 108.8 decoded seconds. Every individual request is under 30 seconds. W1/W2 hashes are distinct; no duplicate window was counted as extra evidence.

| Counter                               |   Whisper |    Reazon |     Total |
| ------------------------------------- | --------: | --------: | --------: |
| Planned / fresh attempts              |     6 / 6 |     6 / 6 |   12 / 12 |
| Verified request replay               |         0 |         0 |         0 |
| Raw input seconds                     |        49 |        49 |        98 |
| Decoded seconds including padding     |        49 |      59.8 |     108.8 |
| Process starts / model loads          |     6 / 6 |     1 / 1 |     7 / 7 |
| Cache hits / failures / retries       | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Measured request-wrapper wall seconds |    30.887 |     4.773 |    35.660 |

Whisper load counts are inferred from six successful isolated CLI processes, each loading its model; `--no-prints` suppresses load-duration telemetry. Reazon's single load is counted from the persistent worker ready handshake; each request creates a fresh decoding stream. Its reported model-load duration is 0.896165708 seconds and observed peak RSS is approximately 931 MB. Wrapper durations include more than decoder compute and are not total development time. A/B generation has zero model loads/inferences and does not increase the ASR replay counter.

Whisper configuration:

- Installed `whisper.cpp` 1.9.1, large-v3 model; binary SHA-256 `939c82ebcd37d6699e38ad539b337eb63d2d58cc307f65887ec358c05ec43942`.
- Model SHA-256 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`.
- Japanese transcription, no translation, no text/title prompt, no VAD, context size 0, temperature 0, no fallback, beam size 5, best-of 5, eight threads. Actual arguments are retained and checked.
- Intended backend is Metal with CoreML disabled. Raw full-JSON system information reports `COREML = 0` and `MTL : EMBED_LIBRARY = 1` plus CPU capabilities. This confirms build/runtime configuration, not independently measured per-device execution time; no GPU-only timing claim is made.
- The plan's `helpHash` covers stdout only (empty because this CLI prints help to stderr). `pre-inference-freeze.json` separately records the complete stdout-plus-stderr help hash and actual supported-flag verification; the empty stdout hash is not evidence of flag support.

Reazon configuration:

- Installed `reazon-research/reazonspeech-k2-v2`, Zipformer character RNN-T, revision `291488c8151be24d7da4bf7af26e533fad96e407`.
- Verified four-file snapshot hash `607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`; constituent file identities remain in the local manifest.
- Python 3.13.14, sherpa-onnx 1.13.6, NumPy 2.2.2, CPU fp32, one thread, greedy search; no hotword/prompt and no prior-request stream reuse.
- Worker source hash `bea411b3fa8509f5cfec00d1d254d0d85e8842b5d254fb2b2c94c8e989e9d2dc`.

No new models were downloaded, no cloud ASR was called, and no CTC/MFA/VAD/speaker/separation model or full-film inference was executed. The durable attempt ledger counts attempts before execution; the 12-attempt / 360-second cap was respected. All raw model responses and process records remain local-only.

## Frozen rules, adapter and causal controls

Before the first inference, selection, windows and audio hashes, model/runtime identities, prompt settings, budgets, decision rules and evaluation policy were frozen. The adapter binds evidence to current-stage input and provenance, never to an episode phrase or timestamp. It separates lexical support, utterance structure and core-localization status. A nonempty full-source replacement requires positive, localized support across model families and distinct windows with usable intervals; point-only streams and model failure/empty output cannot authorize deletion. No confirmed-same-event collapse was established or applied in this experiment.

One parsing verification defect was corrected after inference but before generation and the first formal reference read: raw response property order differed from strict-schema serialization order. Replay now normalizes the observation through the same strict schema before comparing its object hash. Original raw hashes and frozen evidence were unchanged; no request was retried. This was the only executable source difference from the pre-inference code snapshot, and it did not change selection, acoustic rules, or evaluation policy. No post-reference decision tuning occurred.

E0 and E1 both re-executed the actual matched assembly chain from the same Primary evidence and immutable fresh bundle. E0 verifies but does not apply acoustic decisions; E1 enables the minimal adapter. Neither copies the old R2 export as its generation input. Both abstained, so all ASS/SRT/VTT bytes match old R2. All 18 payload files in Final A match Final B; timestamp-bearing run manifests are separately recorded. This proves deterministic generation for fixed evidence, not repeat-inference determinism.

The two generated runs and evidence were frozen before the formal reference first read at `2026-09-07T12:14:45.282Z`. Generation uses a restricted read allowlist and has no Gold argument. Reference evaluation is a separate command. No reference label was fed back into this round.

## Export-based evaluation

The existing `c60116-character-alignment-v1` normalization and matching policy was retained, including lyrics/OP and the full denominator. E0/E1 are identical on every value below.

| Measure                                                 |                        E0 |                        E1 |
| ------------------------------------------------------- | ------------------------: | ------------------------: |
| Exported cues                                           |                       100 |                       100 |
| Normalized S / D / I / N                                |    599 / 212 / 154 / 2048 |    599 / 212 / 154 / 2048 |
| Normalized edit distance / CER                          |       965 / 0.47119140625 |       965 / 0.47119140625 |
| Exact S / D / I / N                                     |    730 / 266 / 195 / 2257 |    730 / 266 / 195 / 2257 |
| Exact edit distance / CER                               | 1191 / 0.5276916260522818 | 1191 / 0.5276916260522818 |
| Non-deletion character coverage proxy                   |               0.896484375 |               0.896484375 |
| Exact character recall                                  |             0.60400390625 |             0.60400390625 |
| Missing spans / insertion spans (edit-path diagnostics) |                   63 / 81 |                   63 / 81 |
| Timing matched groups                                   |                        53 |                        53 |
| Matched reference cues / total                          |                 108 / 192 |                 108 / 192 |
| Unmatched reference / hypothesis cues                   |                   84 / 35 |                   84 / 35 |
| Start / end MAE, seconds                                |       1.357887 / 0.849566 |       1.357887 / 0.849566 |
| Boundary P95, seconds / mean IoU                        |           3.06 / 0.728674 |           3.06 / 0.728674 |
| Severe boundary groups                                  |                         8 |                         8 |
| Display overflows / total overlaps                      |                    23 / 0 |                    23 / 0 |

On the same fixed set of 53 timing-support groups, all start/end error deltas are zero. Actual E0-to-E1 export differences are `exportAddedCueCount=0`, `exportRemovedCueCount=0`, and `exportChangedGroups=0`. There is no new regression relative to the identical E0 file, but unchanged output is not proof that the retained text is harmless or accurate.

All three machine cores have `REFERENCE_BOUNDARY_AMBIGUITY`; exact local CER is unavailable. Full-intersecting-cue diagnostics are provided separately and are explicitly non-exact and non-additive. Neither reference characters nor output characters were cut proportionally to time. Whole-film denominators were not reduced to these windows. Insertions are not confirmed hallucination counts, and deletion counts are not verified missing spoken characters.

The small statistics repair renames stage-array accumulations to `stageInputCueObservations` / `stageOutputCueObservations`. They are not subtitle additions/deletions. Actual export differences use their own regression-tested fields. No old report was rewritten and no CER/matching definition changed.

## Integrity hashes

| Identity                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Primary input               | `23d71937da4afb640c5dcdc0921557a87b45ce4ed8af2a6b5475f648f0e9e074` |
| Frozen request plan         | `7f491413654f51a98be45bcb46bb1448a28aacdc00740f1dea11ab01fd5f7186` |
| Immutable acoustic evidence | `5c7078578db5e249e923b811e924ce2618e0a6d6d81db518359a3e0056b78741` |
| Generation freeze           | `bd239d5c52cd74e39d0e14af426a6127f4e10e4e7c9f37181d8caa3e0ebc9478` |
| E0/E1 canonical text        | `be53fcbfe85bbf4f9414e30303317584c8c82c0d826235096abf691bbf8e3af4` |
| E0/E1 canonical timing      | `7bf5b5c788294fb051cd3b8904ee4f0d683bdd049a9e9afb7aa733866be91ae3` |
| E0/E1 presentation          | `1b0d0fe1f509375419b06a2d06795e9a0784620aaf01456a50c9068a0f882cce` |
| E0/E1 ASS bytes             | `8fcb6388990733deada73d7a6cbdacd151c8239381f1cf0f58134c7038771828` |

## Validation and gates

Node 24.19.0 / npm 11.18.0 were used for validation and execution. The initial offline dependency installation used the host's older npm and emitted engine warnings; no lockfile change or global installation followed. An npm shell-shim path error and an unformatted replay import were corrected before the accepted checks. Earlier synthetic-fixture failures were fixed before inference and are not hidden model retries.

- Typecheck, lint, format check and build: passed.
- Full test suite (unit plus E2E): 162 files, 1,360 passed, 2 skipped.
- Separate E2E rerun: 37 files, 85 passed, 1 skipped. These tests are a subset of the full suite, not additional unique passes.
- Focused bounded-acoustic coverage: 13 tests passed, included in the suite results rather than added again.
- Strict schema validation: 1 evidence bundle, 3 cases, 12 observations, 4 generated subtitle packages passed.
- Request/raw-response hashes, argument isolation, A/B frozen payload hashes and all 12 generated ASS/SRT/VTT file comparisons against old R2 passed.
- Protection snapshot: 5,176 files unchanged; source/staged/unstaged protection checks passed.

| Gate           | Result                                                  |
| -------------- | ------------------------------------------------------- |
| Execution      | `PASSED_BOUNDED_FRESH`                                  |
| Evidence       | `INCONCLUSIVE_CORE_LOCALIZATION`                        |
| Decision       | Safe abstention in all three cases; no applied mutation |
| Quality        | `HOLD_NO_GAIN_KNOWN_REFERENCE_CONTRADICTION_RETAINED`   |
| Generalization | `HELDOUT_VALIDATION_NOT_RUN`                            |
| Publication    | Not authorized                                          |

`status=needs-review`, `finalizationMethod=none`, `defaultPromotionAuthorized=false`, `machineOnlyReleaseAuthorized=false`, `humanValidated=false`.

## Local delivery and reproduction

The one formal output directory is named `machine-quality-c6-0-1-16-2-20260907-experiment-01`. Its `OUTPUT_INDEX.md` links the E1 experimental ASS and six neutral-named local audio clips. Full raw observations, occurrence lineage, decisions, reference evaluation, validation logs and freeze receipts are local-only. They contain private paths, original audio and episode-specific text, so they are **not public-shareable** and are not committed to Git. This public report deliberately omits episode answers, private absolute paths and exact scene coordinates.

The following documents the command interface; **do not execute another model experiment under this exhausted authorization**. New output directories must not already exist. A copied, identity-verified experiment can regenerate A/B only after the old generated directories are excluded from the copy; it must not overwrite this frozen delivery.

```sh
npm run build
npm run quality:acoustic:prepare -- /private/config.local-only.json /private/new-experiment
npm run quality:acoustic:execute -- /private/new-experiment
npm run quality:acoustic:replay -- /private/new-experiment
npm run quality:acoustic:evaluate -- /private/new-experiment /private/reference.ass
```

The private prepare configuration supplies `primary`, `media`, `ffmpeg`, `ffprobe`, `whisper`, `whisperModel`, `reazonPython`, and `reazonModel` paths. All models must already exist. Execution records a durable ledger and reuses only verified, successfully persisted results on a legitimate interrupted continuation; no unbudgeted retry is permitted. Ordinary generation/replay does not accept reference text. Evaluation occurs only after the generation freeze. Test commands are the repository's typecheck, lint, format check, build, unit/E2E scripts and `test:c601162`.

The bounded experiment is now stopped. The smallest next investigation is to characterize Reazon padding/point-timestamp semantics using these existing raw responses and clips, without additional inference or changing this frozen experiment. Only after a separately scoped validation could localization evidence be reconsidered; no next version was automatically started.
