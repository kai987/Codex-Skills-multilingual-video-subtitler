# C6.0.1.16.4.2 Original-occurrence Tail Identifiability

## Result

Engineering/evidence validation passed; **GUARD_ONLY_NO_QUALITY_GAIN**.
Original and displaced onset hypotheses were separately retained, but neither
obtained sufficient support under the frozen protocol. No reliable original
tail end was identified. I0/I1/I2, independently generated in A/B, all preserve
102 cues and make **zero end changes**. This is not subtitle-quality approval.

The scoped scientific result is
`NOT_IDENTIFIABLE_BY_THIS_PROTOCOL_ON_FROZEN_EVIDENCE`, not absence of the
original speech, universal impossibility, or evidence that the human reference
is wrong. The final zero-new-model experiment on this tail is now stopped.

## Baseline, scope and protection

- Base: `6d7e50b28325ab110e2d8cffba197a8ca293a5e3`.
- Independent branch: `codex/c6-0-1-16-4-2-original-occurrence-tail-identifiability`.
- Initial implementation: `6716b66`; corrected input check:
  `4586056c14321e8d57aa2af2d6dd90e8f7c97894` (the successful experiment's code freeze).
- Old boundary algorithms, source consumers, formal evaluator, Skill 2/3 and
  runtime dependencies were not changed. New code is opt-in and separately
  versioned; its application entry reuses the existing stale-bound atomic end
  transaction without presenting its private carrier as an old scientific result.
- The private protection snapshot covered 13,738 files, eight historical source
  worktrees, their HEAD/status/staged/unstaged state, old outputs, source video,
  human draft and primary inputs. End-of-experiment verification found all
  unchanged, including the dirty .14.6 work. No stash/reset/clean/force-push.
- Only the machine-risk-selected terminal conflict target was eligible.
  No case ID, cue ID, dialogue, known time or reference ID selects it in code.

## Frozen evidence and attempt history

One scientific configuration: `c6011642-exact-onset-tail-v1`.
Experiment-01 is preserved locally with its original protocol/code freeze and
failure note. It performed W0 offline DP, then stopped at the W+2 PCM prefix
check, before final hypotheses, subtitle generation or Gold evaluation.

The definite implementation error was requiring exact equality even in the
unobserved filter tail of independently trimmed/resampled historical WAVs.
W0/W+2 differ in 11 samples beyond sample 159988 (maximum four int16 LSB);
W+2/W+4 in two samples beyond 191996 (maximum two LSB). Exact shared PCM through
the last CTC receptive field is unchanged: 159,760 and 191,760 samples.
The corrected check verifies that covered region exactly, records remaining
differences, and keeps each full WAV individually hash-bound and unmodified.
It does not rewrite, resample or substitute audio. The historical extraction
code independently trimmed/resampled cuts; the differences are consistent with
that boundary processing, not evidence of different source occurrences.

Experiment-02 has a separate freeze after this correction and two added input
regressions. Its scientific POLICY object is byte-equivalent after JSON
serialization to experiment-01. No hypothesis, threshold, PCM feature or
evaluation parameter was tuned on the real result. Two earlier neutral-fixture
failures (uninformative label/blank support and length-biased ranking) had been
fixed before the first formal freeze; their test logs are also retained locally.

Existing evidence only:

| Window | PCM samples / rate | Frames x vocabulary | Original finite paths | Displaced finite paths  | Supported paths in either domain |
| ------ | ------------------ | ------------------- | --------------------- | ----------------------- | -------------------------------- |
| W0     | 160,000 / 16 kHz   | 499 x 3003          | 42                    | 0 (outside observation) | 0                                |
| W+2    | 192,000 / 16 kHz   | 599 x 3003          | 50                    | 92                      | 0                                |
| W+4    | 224,000 / 16 kHz   | 699 x 3003          | 50                    | 192                     | 0                                |

These dimensions were verified from arrays/configuration, not hardcoded.
Full-file hashes, sample counts, masks, finite float64 log probabilities,
normalization, symbol/token IDs, blank ID, model/configuration identity,
source offsets, frame count, 320-sample stride and 400-sample receptive field
passed. Saved legacy selected paths and recomputed old `open_suffix` results
matched in all three windows.

- Model: `reazon-research/japanese-wav2vec2-large-rs35kh`.
- Revision: `2162c9edb97f362f7623d6b3a2e417458e879bca`.
- Snapshot hash: `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`.
- Historical runtime identity: `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`.

Identity metadata was checked without loading model weights. No provider
preflight, neural imports, model download, runtime upgrade, VAD, free-vocabulary
decoding or audio extraction occurred.

## Search and old global-path masking

The old consumer first prefers completions, retains near-best completion
clusters, allows the terminal target to move through the open suffix, and
only then checks occurrence displacement. Its PCM search follows that selected
label end; single-frame ratio participates in the old veto. None was rewritten.

The new DP preserves exact target onset as a separate identity dimension,
with the existing prefix order/bands. Every declared onset/completion best
scalar score is retained; a later onset cannot overwrite an earlier onset.
This is not exponential enumeration of every latent path. Inferior internal
paths within the same onset/completion are not independently support-ranked,
so the result cannot exclude every possible acoustic explanation.

All declared searches completed: 499 + 599 + 699 = 1,797 onset positions
examined. The field `offlineExactOnsetDPs` counts those examined positions,
including infeasible-prefix positions; it does not count neural inference or
necessarily 1,797 allocated DP tables. Final retained finite paths across the
unconstrained domains are 152 / 252 / 352. There were also three legacy offline
DP replays and 11 per-hypothesis PCM calculations. The failed experiment-01
additionally performed W0 offline work; final-attempt counters are not claimed
as the sum of all development/test/failure CPU work.

Old near-best results retained an original-domain onset in W0 and W+2, but
**not W+4**. The new W+4 set retains 50 original-domain finite paths separately
from 192 later-domain paths. Thus original onset candidates were masked by
the old global near-best selection, but their recovery does not establish
that they are acoustically valid occurrences.

## Support, priors and cross-window identity

Times below are offsets from the shared saved-window origin, not Gold labels.

| Window | H_ORIGINAL onset / label end | H_DISPLACED onset / label end | No-prior winner onset | Original median target peak | Original maximum internal gap |
| ------ | ---------------------------- | ----------------------------- | --------------------- | --------------------------- | ----------------------------- |
| W0     | 9.580 / 9.880 s              | unobserved                    | 9.580 s               | 0.007287                    | 0.140 s                       |
| W+2    | 9.560 / 9.900 s              | 11.900 / 11.980 s             | 9.560 s               | 0.002691                    | 0.160 s                       |
| W+4    | 9.560 / 12.420 s             | 12.120 / 12.420 s             | 12.120 s              | 0.005587                    | 2.700 s                       |

Original target peaks are all weak; median token-versus-blank log odds are
-4.893 / -5.881 / -5.178. Prefix peak coverage is 0.769 / 0.654 / 0.615.
The later W+4 path also remains weak (target peaks about 0.003873, 0.022152,
0.005587); being relatively stronger does not make it supported.

H_UNSUPPORTED is true for both evaluated domains; W0's absent later domain
means it is outside observation, not proof of no later speech. Finite scores
are not calibrated probabilities. Per-frame max-relative costs are conditional;
raw sums of unequal path lengths are not used as occurrence correctness.
Fixed-count target log-peak ranking has optimism bias, while normalized path
cost can favor long blank-heavy paths; these limitations are not concealed.

Primary +/-0.5 s and wider +/-1 s priors choose the same original onset in each
window. No `PRIOR_DOMINATED` flag is raised, but this is **not** proof of identity:
all those paths fail independent support. The no-prior W+4 diagnostic moves
later without erasing the original hypothesis. Narrow-prior false support is
covered by a neutral regression; no strong-prior success is reported here.

The original starts agree within one 20 ms frame, but W+4's retained
original-onset best completion spans a 2.7 s internal gap to later labels.
This hybrid is rejected. Therefore these windows share an original-onset
machine hypothesis, **not a confirmed same complete spoken occurrence**.
We do not compare a W+2 original end against W+4's global later end and call
that alone original-tail instability. W+2/W+4 are correlated observations,
not independent model votes.

## Tail identifiability and uncertainty

Single-frame ratio is 1 for the selected target labels, but is diagnostic
only in the new method. CTC label occupancy locates tokens; it is neither a
20 ms speech duration nor an automatic veto on a PCM-supported long tail.

The single frozen PCM method combines sustained RMS drops with spectral
continuity from each hypothesis's own target span. It searches after that
hypothesis's label end, never the globally chosen path by default. Physical
observation and next-occurrence/neighbor limits are barriers, not candidate
answers. It does not provide source separation or speaker attribution.

W0 and W+2 have no qualifying observed transition in their declared original
search domains: `RIGHT_CENSORED_OR_END_UNOBSERVED`. In W+2 this means no end
observed by this bounded search, not proof that all saved audio is truncated.
W+4 has drops at offsets 12.640, 12.660 and 12.680 s, with 7.16/8.34/9.89 dB
changes, but continuous-tail fraction is zero and all are unsupported. They
come after a rejected hybrid completion and cannot be attributed to the original
tail; background or later speech remains an explanation.

The actual diagnostic `candidateEndRange` is 12.640–12.680 s relative to the
origin (source-global values in the local JSON). It is a range of **rejected
observed transitions**, not a valid original-end interval or confidence bound.
`configuredStabilityTolerance=0.12` s is a separate engineering constant.
No average, first-drop shortcut, zero-width certainty or window-end substitute
produces a proposed end. `tailIdentifiable=false`, `proposedEnd=null`.

## Actual application, parity and evaluation

I0 executes the unchanged source and boundary replay, reproducing old U2.
I1 and I2 consume the identical new result; only application is toggled.
ASS/SRT/VTT are serialized from canonical packages, never patched old files.
Historical T0/other control files inside the source-replay provenance folders
are not the applied result: the six final I0/I1/I2 packages each have 102 cues.

A/B non-clock output hashes match. All three formats match the old U2 bytes;
all text/order/start/style/speaker/IDs and all 101 non-target ends are unchanged.
The target end also remains unchanged. Strict Zod validation covers six packages
and the new proposal, supplemented by independent AJV shape validation and
roundtrip/journal/stale-binding/atomic application tests.

Gold was first read by the separate evaluator at 2026-09-08T05:42:55.111Z,
after real hypotheses, proposals, I0/I1/I2 A/B and evaluation policy were frozen.
This episode is development-known with prior developer exposure, not blind
held-out evidence. No evaluation result was fed back into the runtime policy.

| Metric                                              | I0 = I1 = I2 (SRT/VTT)   |
| --------------------------------------------------- | ------------------------ |
| Normalized S / D / I / N                            | 591 / 212 / 154 / 2048   |
| Normalized edit distance / CER                      | 957 / 0.46728515625      |
| Exact S / D / I / N                                 | 719 / 270 / 195 / 2257   |
| Exact CER                                           | 0.5245901639344263       |
| Timing-matched groups / reference cues              | 55 / 109 of 192          |
| Start MAE / end MAE                                 | 1.351782 / 0.905400 s    |
| Boundary P95 / mean IoU                             | 3.395000 s / 0.707464606 |
| Severe boundary groups / presentation overflow cues | 9 / 22                   |

ASS is separately evaluated with its existing centisecond quantization; all
three variants are unchanged within that format too. The old full evaluator
and its limitations remain unchanged. No recognition or presentation gain.

I0-fixed bindings also show zero paired change: all 55 groups have end MAE
0.905400 s and IoU 0.707464606. Excluding the target, the remaining 54 fixed
groups have end MAE 0.859296 s and IoU 0.720565802, unchanged. The output key
`confirmedNonTarget` is this eligibility partition, not human confirmation of
every remaining match.

The supplemental predeclared local diagnostic enumerates adjacent one-to-three
reference cues with spelling/partial/merge similarity and neighbor ordering.
It retains five possible ordered correspondences. Under these alternatives,
target end error ranges 1.035–5.555 s; the unchanged formal assignment gives
3.395 s. We do not choose the smallest error or rematch using the proposed end.
This bounded enumeration is not exhaustive linguistic/acoustic identification:
`REFERENCE_OCCURRENCE_UNRESOLVED`; target excluded from confirmed gain.

## Verification, hashes and reproduction

- Neutral offline Python tests: **17 passed**, including a tiny exhaustive
  exact-onset/completion oracle for distinct and repeated labels and two PCM
  integrity regressions. The required weaker-original, later-only, noise,
  unsupported finite paths, long-tail single-frame labels, background, overlap,
  censoring, source identity and prior-dependence cases are synthetic behavior
  fixtures, not neural acoustic validation or listening.
- Typecheck, lint, format and build: passed with existing Node 24 dependencies.
- Full Vitest suite: **1,435 passed, 2 skipped, 0 failed**.
- Explicit E2E suite (also included in full suite): **91 passed, 1 skipped**.
  Skips are real pyannote and/or MFA opt-in integration, intentionally disabled;
  skipped tests are not counted as passed. Existing environment only; no update.
- Strict artifact/schema/parity validation: passed; protected files: 13,738 unchanged.
- Six counters are all zero: newASRRequests, newModelInference,
  newAcousticForwards, newModelLoads, newProviderStarts, newAudioWindows.
  Neural import/subprocess guards and sandbox network/source-read restrictions
  protect offline solving; generation uses Node read allowlists and no addon/
  child-process permission. Reading NPZ is not called a model cache hit.

Successful experiment digests:

```text
protocol-freeze 55b6fcf72846e54297f88b8b1651ba7e537cee39d63435c2b641cb6c11fc7953
evidence-freeze 1b07d7b7c64dbbd7ecc48e99d390b1d590656d508de14079fea4a82fab2b2411
generation-freeze 110dd615c46fdb268519de8b920fbc414f6bd3dffee8d43a508fa7b353cec76a
hypotheses d76c6f37be89eadba58b37ff98beffed3dea20df5342eb4ef25a67fd468fcb1d
tail-result c3c212c72af8464cd10f16a808b86eb5ac6b95d09974d430ad48aa43e63f3ab4
text aadd3e060e89a83ffa8fcd38e5b760561d9d706cb0aececf6e2d54fb6747c81a
timing 537d2d066f9c20da2cfc9daabbd85d125aa4cffd111d578160a8f9676d5bd5af
presentation e78cc286ecdd15986ad6e901636e812dd591f960ec346f1cfb8a5387615ae75a
ASS 3e69b76f7c64a1529e7b741a68a9acdf728db18bab3cd3e1b05a927b3df0121f
SRT f5a610287db589c518c26a423850f4e9375197f95cb1132d39ff48ce3325a054
VTT bdf27bea24ce392caa349d1d94acfbe8a0936a3d00365dcbef096cad826cf59e
```

Local-only output directory name:
`machine-quality-c6-0-1-16-4-2-20260908-experiment-02`.
`OUTPUT_INDEX.md` links actual ASS/SRT/VTT, hypotheses, fixed-reference metrics,
ambiguity, validation and the preserved failed attempt. No dialogue, audio,
NPZ, Gold, private paths or generated outputs are committed.

Reproduction entry points, using already installed Node/Python and existing
evidence; use a fresh destination, never overwrite an earlier attempt:

```sh
node scripts/run-c6011642.mjs prepare PREVIOUS_OUTPUT NEW_OUTPUT EXISTING_PYTHON NEUTRAL_TEST_LOG
node scripts/run-c6011642.mjs solve NEW_OUTPUT
node scripts/run-c6011642.mjs generate NEW_OUTPUT
node scripts/evaluate-c6011642.mjs NEW_OUTPUT LOCAL_GOLD_ASS
node scripts/validate-c6011642.mjs NEW_OUTPUT
```

Read the Skill and fixed protocol before use. Gold is evaluation-only, after
generation freeze. The plan binds all source/dist hashes; rebuilding with a
different toolchain or editing code requires a separate provenance record.

## Publication and stop condition

`needs-review`; `finalizationMethod=none`; `humanValidated=false`;
`defaultPromotionAuthorized=false`; `machineOnlyReleaseAuthorized=false`.
`audioConfirmed=false`; `listener=null`; `HELDOUT_VALIDATION_NOT_RUN`.

No real listening or independent unseen-material validation was performed.
This adds an occurrence-preserving diagnostic and safe abstention, not a real
subtitle timing gain. Formal evaluation is complete and this scoped experiment
has reached its stop condition. Preserve this case as regression material.
Any future user-authorized work should return to broader machine-subtitle error
categories, not another threshold/feature/window patch on this same tail. No
next task, additional model run or automatic promotion was started.
