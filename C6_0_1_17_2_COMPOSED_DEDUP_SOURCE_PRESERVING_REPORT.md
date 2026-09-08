# C6.0.1.17.2 Composed Deduplication Guards & Source-preserving Assembly

## Outcome and separate gates

Engineering acceptance passed for the fixed five-view matrix. G11 matches P0's
complete normalized character sequence in **12/12 units**, not merely its CER.
Relative to G10 (the unchanged .17.1 P2), only one known C1 low-risk unit changes:
normalized edit distance -8, exact -9. The other eleven exports are byte-identical
to G10 in ASS/SRT/VTT. There is no new recognition, acoustic verification, or
independent confirmation.

- Engineering Gate: PASS.
- Known-development recovery: KNOWN_DEVELOPMENT_ASSEMBLY_RECOVERY_ONLY.
- Normalized source non-degradation: NORMALIZED_SOURCE_NONDEGRADATION_RECOVERED,
  per-unit sequence equality and CER non-degradation, 12/12.
- Exact non-degradation versus P0: **fails in one D1 unit** (+3 edits); no claim
  of universal exact-text equality or comprehensive superiority.
- Quality/promotion: QUALITY_TRADEOFF_HOLD. One existing overflowing line and
  unresolved repetitions remain; C1 timing/structure is not equivalent to P0.
  The new G11-vs-G10 text change does not increase reference-relative insertions.
- Retain needs-review, finalizationMethod=none, humanValidated=false,
  defaultPromotionAuthorized=false, machineOnlyReleaseAuthorized=false.
- Both D1 and former C1 are KNOWN_DEVELOPMENT_RECHECK.
  HELDOUT_VALIDATION_NOT_RUN; BENCHMARK_REFERENCE_SEGMENTED=true;
  UNSEGMENTED_END_TO_END_VALIDATION=NOT_RUN.

This is assembly non-degradation recovery on known prepared clips, **not an
increase in raw ASR recognition accuracy**. No default is changed or merged.
The .14.6/.15/C6.0.2 and stopped tail branches are not reopened.

## Baseline, scope, protection, and readings

Unique baseline: `49760ce269408dd3311059ce056e8f11e4d70974`.
Branch: `codex/c6-0-1-17-2-composed-dedup-source-preserving`.
Implementation commit before formal replay:
`ed5699e654303ec0327347fd56471578765d6a87`.

Read-only checks first confirmed the original uncommitted .14.6 worktree,
staged/unstaged state, worktree inventory and baseline object. A new independent
worktree was created at that exact commit. No switch, pull, stash, reset,
clean, old-change commit, forced push, or old-output edit occurred.
The existing protection mechanism was reused to snapshot worktree states and
hash 21,148 relevant historical source/evidence/reference/subtitle/media files,
now including .17.1. No historical caches or weights were copied for protection.
Final verification confirms protected HEAD/status/staged/unstaged content and
files unchanged, including the human-authoritative ASS. Skill 2/3 unchanged.

Read the available Skill, package/lock metadata, official .17.1 report,
matched replay, winner deduplication, intra-cue policy branches, and actual
.17/.17.1 preparation, freezing, evidence projection, generation, export,
evaluation and validation entry points.
`C6_0_1_17_1_INDEPENDENT_REVIEW_AND_NEXT_STEP.md` and
`C6_0_1_17_1_INDEPENDENT_AUDIT_SUMMARY.json` were not found in inspected
Documents/Downloads/source/output locations. They were not read or cited as
evidence. The official report and frozen real artifacts supply the checks.

Only an opt-in profile adapter, deterministic export/coordinator wrappers,
evaluation/diagnostic accounting and neutral tests were added.
No deduplicator, detector, confidence threshold, winner ordering, speech model,
aligner, dictionary, planner, UI, segmentation or layout algorithm was modified.
The post-score lineage audit adds reporting only; it does not change frozen
generator/evaluator bytes or scores.

## Fixed evidence and zero execution

The original dataset, model-input and evidence freezes were recomputed before
replay, including the sealed reference's integrity hash. The coordinator checks
the existing preflight credential and neutral manifest, not a new preparation
Gate. All 12 response hashes, result hashes, prompt/decode/model/runtime identities,
raw-to-machine segment projections, audio hashes, offsets and unit lists match.
No clip is filtered by success or score. Evaluation rechecks exact reference
manifest identity and closure against the complete sealed reference.

Frozen old identities (SHA-256):

- dataset-freeze: `cf6cbddc97f5e0b278313a352a2e605d2680f2f8ce2410ce910908aa7c0b0d3f`
- model-input-freeze: `48f780c2d8d98a80fc8a2b234061685e9a4a344e8ddbb1183033c28181e88680`
- evidence-freeze: `927dd42f4565ee49c1a0ead70c3c1d6b29757b65cde66004d9d88659a3323347`
- Whisper model: `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`
- historical binary: `939c82ebcd37d6699e38ad539b337eb63d2d58cc307f65887ec358c05ec43942`

Historical large-v3/Metal, Japanese, prompt-free, no VAD/context, temperature 0,
no fallback, beam/best-of 5, eight threads, CoreML off, embedded tokenizer remain
provenance only. No model file was loaded or executable started for this replay.
Original FRESH_PROMPT_FREE and execution timestamps are preserved. Current use
is VERIFIED_EVIDENCE_REPLAY, not fresh inference or a new ASR cache hit.

| This round counter  | Actual |
| ------------------- | -----: |
| newASRRequests      |      0 |
| newModelInference   |      0 |
| newAcousticForwards |      0 |
| newModelLoads       |      0 |
| newProviderStarts   |      0 |
| newAudioWindows     |      0 |

Twelve existing machine JSON inputs are copied byte-for-byte into a new
allowlist-only input directory. Model weights, audio, Gold, full audit reports,
reference boundaries, N, strata, error labels and correct-answer text are not
readable by the subtitle child. Runtime Node permissions prohibit other file
reads, child processes and native addons; sandbox-exec denies network access.
The inherited negative isolation test actually probes denied file, child,
addon and network access. Imported module definitions do not execute providers.
No data preparation, recropping, new VAD or free decoding of stored logits.

The coordinator hashes the sealed reference before generation for identity;
the independent evaluator hashes then parses it after output freeze.
These are not claimed as zero whole-task reference accesses. Reference-assisted
clipping happened in .17.1. No-generation-Gold does not make this an unsegmented
or unseen benchmark. Full reference and original C1 were already exposed.

## Five fixed profiles and fallbacks

| Profile            | Inter-cue policy | Intra-cue policy  | Identity                   |
| ------------------ | ---------------- | ----------------- | -------------------------- |
| P0-primary-minimal | bypass assembly  | bypass assembly   | old P0                     |
| G00-legacy         | legacy           | legacy            | old P1/off                 |
| G10-cross-guard    | overlap-required | legacy            | old P2                     |
| G01-intra-guard    | legacy           | source-preserving | intra-only                 |
| G11-composed       | overlap-required | source-preserving | predeclared main candidate |

The adapter maps interCuePolicy to freshProfile.deduplication and intraCuePolicy
to the existing repair boolean. acoustic/stored/groups are explicitly undefined.
Auditing replayPrimaryAssembly confirms that without those hooks repair=true
only changes repetitionPolicy and its trace operation label, not another repair.

Order remains Primary mapping -> cross-cue dedup -> intra-cue processing ->
existing acoustic-semantic segmentation -> existing presegmented layout ->
actual ASS/SRT/VTT. P0 retains its genuine minimal path. There is no copying of
P0 text or historical output into a generator and no post-Gold per-unit selection.

G11 minus intra = G10; G11 minus cross = G01; both disabled = G00.
The existing >0.1 s non-lyric overlap prerequisite, 0.8 s adjacency search,
text relationship predicates, ranking, timing donors and trusted-lyrics exception
are unchanged. Overlap alone is not sufficient duplicate evidence.
Source-preserving retains the current intra-stage input, not an earlier raw
version. Existing typography and evidence-backed branches remain active.

## Freeze, A/B, lineage and export checks

Input/config/implementation freeze: 2026-09-08T12:22:41.744Z.
Both run trees and pre-score actual export diffs sealed:
2026-09-08T12:22:56.246Z.
Evaluator first reference filesystem-read marker:
2026-09-08T12:23:17.266Z.

One formal matrix was used. Each run has 12 x 5 real exports and 444 files.
A/B are byte-identical for all non-clock output; actual start/end clocks are
separate, never fabricated. 216 historical ASS/SRT/VTT comparisons
(12 units x 3 controls x 3 formats x 2 runs) passed. P0/G00/G10 reproduce old
P0/P1/P2 exactly, including punctuation, times, styles and serialization.
120 strict package validations and format roundtrips passed.

The inherited package envelope uses status=ready for bundle availability,
not quality approval: primarySubtitle.validationStatus=needs-review and every
generation-state.json retains needs-review, finalizationMethod=none and false
human/release/promotion flags. The established package contract is not changed.

48 pre-intra pairs (12 x 2 inter-policy pairs x A/B) match at Primary and
cross-cue input/output; the first policy evidence difference starts at the
intra stage. No undeclared hooks appear. Most policy trace differences do not
change cue content. Zero repeated source request imports and zero duplicate
final cue IDs occur. Idempotent same-request import remains covered by tests.

The existing traces retain full stage inputs/outputs, operation reasons, hashes,
request/occurrence evidence, semantic segmentation plans and exact ID/interval
bindings. Some late per-operation direct request lists are empty; they are not
filled from Gold. A supplementary deterministic traversal of recorded stage
relations recovers source ancestry for every final cue (zero unknown ancestry).
It is explicitly post-score bookkeeping, not new evidence or selection.

Pre-score reparsed export diffs agree with the evaluator's independent diff.
The single new change has one removed and one added _ID_, because legacy
intra-dedup renames the cue and segmentation hashes that identity. It represents
one changed output cue, not two new utterances or repeated stage character gains.

## Text metrics

Each row below is normalized S/D/I/N; micro=sum(S+D+I)/sum(N).
Exact retains NFC text and removes only display line breaks; normalized uses
the unchanged NFKC/punctuation/separator/whitespace/lowercase policy.
All reference and emitted text, including unmatched content, is scored.
D1 N=559, C1 N=317; exact N=624/335. No full-episode denominator is used.

| Partition/profile | Normalized S/D/I/N | Distance | Micro CER | Macro CER | Exact S/D/I/N | Distance |
| ----------------- | ------------------ | -------: | --------: | --------: | ------------- | -------: |
| D1 P0             | 109/31/28/559      |      168 |  30.0537% |  25.9607% | 131/49/49/624 |      229 |
| D1 G00            | 106/53/21/559      |      180 |  32.2004% |  27.4728% | 123/84/36/624 |      243 |
| D1 G10            | 109/31/28/559      |      168 |  30.0537% |  25.9607% | 124/61/47/624 |      232 |
| D1 G01            | 106/53/21/559      |      180 |  32.2004% |  27.4728% | 123/84/36/624 |      243 |
| D1 G11            | 109/31/28/559      |      168 |  30.0537% |  25.9607% | 124/61/47/624 |      232 |
| C1 P0             | 50/4/14/317        |       68 |  21.4511% |  26.2898% | 58/9/21/335   |       88 |
| C1 G00            | 50/12/14/317       |       76 |  23.9748% |  28.6708% | 58/18/19/335  |       95 |
| C1 G10            | 50/12/14/317       |       76 |  23.9748% |  28.6708% | 58/18/19/335  |       95 |
| C1 G01            | 50/4/14/317        |       68 |  21.4511% |  26.2898% | 58/9/19/335   |       86 |
| C1 G11            | 50/4/14/317        |       68 |  21.4511% |  26.2898% | 58/9/19/335   |       86 |

### All units, without silent exclusions

Columns contain S/D/I; N is shared across the five cells in a row.
G11 and P0 normalized sequences are identical in every row.

| Partition/unit suffix | Stratum      |   N | P0      | G00      | G10     | G01      | G11     |
| --------------------- | ------------ | --: | ------- | -------- | ------- | -------- | ------- |
| D1 5d0adff9148f       | coverage     | 143 | 24/4/19 | 23/18/14 | 24/4/19 | 23/18/14 | 24/4/19 |
| D1 8d29a93e2476       | coverage     | 115 | 18/2/5  | 16/10/3  | 18/2/5  | 16/10/3  | 18/2/5  |
| D1 2ac9cd84ea00       | machine-risk |  92 | 11/1/2  | 11/1/2   | 11/1/2  | 11/1/2   | 11/1/2  |
| D1 81e6c6fc8b2a       | machine-risk |  81 | 11/12/1 | 11/12/1  | 11/12/1 | 11/12/1  | 11/12/1 |
| D1 8123367d8b04       | low-risk     |  25 | 0/0/0   | 0/0/0    | 0/0/0   | 0/0/0    | 0/0/0   |
| D1 74764bd9218b       | low-risk     | 103 | 45/12/1 | 45/12/1  | 45/12/1 | 45/12/1  | 45/12/1 |
| C1 c2b027da9b33       | coverage     |  30 | 6/0/3   | 6/0/3    | 6/0/3   | 6/0/3    | 6/0/3   |
| C1 0c064a012bf8       | coverage     |  88 | 7/2/5   | 7/2/5    | 7/2/5   | 7/2/5    | 7/2/5   |
| C1 9c450a7730d4       | machine-risk |   2 | 0/0/1   | 0/0/1    | 0/0/1   | 0/0/1    | 0/0/1   |
| C1 b03b376c32f0       | machine-risk |  81 | 22/1/5  | 22/1/5   | 22/1/5  | 22/1/5   | 22/1/5  |
| C1 f36144e8465c       | low-risk     |  60 | 10/1/0  | 10/1/0   | 10/1/0  | 10/1/0   | 10/1/0  |
| C1 9f12c20deaa8       | low-risk     |  56 | 5/0/0   | 5/8/0    | 5/8/0   | 5/0/0    | 5/0/0   |

Exact distances in the same P0/G00/G10/G01/G11 order:

| Unit suffix  | Exact distances        |
| ------------ | ---------------------- |
| 5d0adff9148f | 78 / 84 / 78 / 84 / 78 |
| 8d29a93e2476 | 36 / 41 / 36 / 41 / 36 |
| 2ac9cd84ea00 | 19 / 19 / 19 / 19 / 19 |
| 81e6c6fc8b2a | 32 / 35 / 35 / 35 / 35 |
| 8123367d8b04 | 1 / 1 / 1 / 1 / 1      |
| 74764bd9218b | 63 / 63 / 63 / 63 / 63 |
| c2b027da9b33 | 10 / 9 / 9 / 9 / 9     |
| 0c064a012bf8 | 18 / 17 / 17 / 17 / 17 |
| 9c450a7730d4 | 1 / 1 / 1 / 1 / 1      |
| b03b376c32f0 | 36 / 36 / 36 / 36 / 36 |
| f36144e8465c | 13 / 13 / 13 / 13 / 13 |
| 9f12c20deaa8 | 10 / 19 / 19 / 10 / 10 |

All per-unit exact/normalized S/D/I/N, sequence hashes, cue counts, three-format
metrics, strata micro/macro, insertion/missing spans and matching groups are
preserved in local evaluation JSON and per-unit-metrics.csv.
The one exact regression versus P0 is inherited presentation/assembly behavior,
not a new G11-vs-G10 regression; no post-score attempt was made to repair it.

### Factorial effects

Negative differences reduce edit distance. These are deterministic workflow
contrasts, not statistical interaction significance or acoustic causality.

| Effect          | D1 normalized / exact | C1 normalized / exact |
| --------------- | --------------------- | --------------------- |
| E10-E00         | -12 / -11             | 0 / 0                 |
| E11-E01         | -12 / -11             | 0 / 0                 |
| E01-E00         | 0 / 0                 | -8 / -9               |
| E11-E10         | 0 / 0                 | -8 / -9               |
| E11-E00         | -12 / -11             | -8 / -9               |
| E11-E(P0)       | 0 / +3                | 0 / -2                |
| E11-E10-E01+E00 | 0 / 0                 | 0 / 0                 |

Interactions are zero per unit as well as in the aggregates. Cross protection
retains five additional winner occurrences in the two D1 coverage units; intra
protection retains a repeated lexical span in one different C1 unit.
This disjoint observed effect does not prove general additivity of these stages.

G11 versus G10 changes only unit-9f12c20deaa8's first cue, local 0–2.88 s:
one expression previously emitted once is now retained twice, on two lines.
Source start is 77.49 s; no time is changed. Original source and private
before/after text are in the mutation journal, not embedded in public code.
The intra-stage reason is ABSTAIN_UNRESOLVED_REPETITION_POSSIBLE_DECODER_LOOP;
removed spans go 1->0, trueSpokenRepetitionCount stays 0. No new I appears in
normalized or exact scoring versus G10. No other added output wording exists.

Versus G00, D1 retains +3 S/+7 I while reducing D by 22; exact I increases by 11.
This existing cross-guard tradeoff remains disclosed despite net distance gain.
D reduction is not independently verified speech recovery; I is not confirmed
hallucination count. A neutral known-loop fixture shows source preservation
can retain wrong repetition and the evaluator can expose insertion harm.

## Sequence, timing, structure and presentation

G11/P0 normalized sequence parity is 12/12; none are merely tied but different,
better or worse normalized sequences. Exact sequence equality is only 8/12:
81e6c6fc8b2a, 74764bd9218b, c2b027da9b33 and 0c064a012bf8 differ in surface form.
Normalized equality does not imply punctuation, cue structure, timing or format
byte equality. Exact C1 aggregate improves by two edits relative to P0 while D1
is three worse; these must not cancel into a misleading global PASS.

| Split/profile | Cues | Timing groups | Matched ref/output | Unmatched ref/output | Start/end MAE s | P95 s |    IoU | Severe |
| ------------- | ---: | ------------: | ------------------ | -------------------- | --------------- | ----: | -----: | -----: |
| D1 P0/G10/G11 |   57 |            40 | 45/45              | 14/12                | .56175/.28650   |  1.07 | .72462 |      2 |
| D1 G00/G01    |   52 |            35 | 43/41              | 16/11                | .68629/.33029   |  1.74 | .70715 |      2 |
| C1 P0         |   21 |            17 | 24/19              | 2/2                  | .10118/.97000   |  3.63 | .81603 |      3 |
| C1 G00/G10    |   20 |            17 | 23/19              | 3/1                  | .32706/.97000   |  3.63 | .77584 |      4 |
| C1 G01/G11    |   20 |            17 | 24/19              | 2/1                  | .23882/.97000   |  3.63 | .80350 |      4 |

G11 versus G10 direct-ID fixed support: D1 40 unchanged groups, C1 16 unchanged
groups and one changed matching group. All fixed start/end error deltas are zero.
P0 IDs use a different namespace from assembly IDs: the evaluator's zero
direct-ID support there is an identity limitation, not all timing changing.
Post-score traversal of real stage ancestry binds 40 D1 and 16 C1 P0/G11 groups,
again all zero deltas. One C1 group remains unpaired. Versus G00, ancestry binds
30 D1 groups, with 5 before/10 after unpaired, and 16 C1 with 1/1 unpaired.
No pairing is invented from Gold text or nearest timestamps.

The C1 aggregate MAE change comes from a changed text-matching support set;
it is not evidence of acoustic boundary refinement. G11 retains worse C1
start MAE and severe-group count than P0. The benchmark reference is interval
closure authority, not phoneme boundary truth.

| Split/profile | Lines >16 | Cues >2 lines | Adjacent normalized equal pairs | Intra-repeat detector hits |
| ------------- | --------: | ------------: | ------------------------------: | -------------------------: |
| D1 P0         |        11 |             0 |                               3 |                          0 |
| D1 G00/G01    |         0 |             0 |                               0 |                          0 |
| D1 G10/G11    |         0 |             0 |                               3 |                          0 |
| C1 P0         |        10 |             0 |                               0 |                          1 |
| C1 G00/G10    |         1 |             0 |                               0 |                          0 |
| C1 G01/G11    |         1 |             0 |                               0 |                          1 |

All cells have zero empty cues, invalid duration and positive-duration overlap
pairs. Total overlap is not erroneous overlap; identical text or different
occurrence IDs do not confirm independent speech. The one retained intra repeat
is uncertain even though the sealed reference supports its text. The unchanged
2x16/presegmented layout preserves normalized lexical order; one long line is
reported rather than deleted or split using invented timing. No layout limit,
exception, time boundary or segmentation policy was tuned.

## Tests and reproducibility

Existing dependencies were copied with workspace-relative links; package-lock,
runtime and model installation unchanged. Node 24.19.0 was used.
Typecheck, full lint, format-check, TypeScript build and Vite production build
passed. Full bounded unit suite: **1,487 passed, 2 skipped**, 179 files.
Explicit E2E: **101 passed, 1 skipped**, 46 files, already included in that
full count. New tests: 17; focused new+inherited isolation run: 18 passed.
No optional real-model tests were enabled and skips are not passes.
Unchanged timeouts/assertions and --maxWorkers=2 were used.

Neutral tests cover direct policy mapping, fallback cells, pre-intra parity,
serial protection, request idempotence/conflicts, forbidden hooks/Gold,
overlap-not-sufficient, current-input versus stale-raw preservation,
uncertain decoder loops with insertion harm, multilingual typography,
trusted lyrics, tied-score/different-text detection, factorial/micro accounting,
actual-export versus stage counts, real three-format exports and OS/runtime
isolation. Existing source-preserving/default-profile regression tests remain.

Initial authoring had a missing function brace and test lint typing issues;
they were fixed before matrix freeze. Focused tests then passed. Full recorded
checks have no failed test/retry and no historical timeout was changed.
Post-score additions are report/source-ancestry diagnostics only, with a separate
validation receipt; the frozen matrix and evaluator are unchanged.

Use existing Node 24 and a collision-safe new output destination:

```sh
npm run typecheck
npm run test:c601172 -- --maxWorkers=2
npm run c601172:replay -- "$MVL_OLD17_1_RUN" "$MVL_OUTPUT_PARENT"
# Replay prints the newly allocated directory; assign that path to MVL_RUN.
npm run c601172:evaluate -- "$MVL_RUN" "$MVL_SEALED_REFERENCE_MANIFEST"
npm run c601172:validate -- "$MVL_RUN"
node scripts/audit-c601172.mjs "$MVL_RUN"
npm test -- --maxWorkers=2
npm run test:e2e -- --maxWorkers=2
```

The replay accepts only an existing .17.1 run and output parent, never a Gold
argument. It verifies old freezes and machine provenance and executes pure
assembly under isolation. The evaluator separately receives the hash-bound
reference manifest after generation freeze. No command above invokes ASR.
Existing destinations reject overwrites; evaluation and diagnostics are one-shot.

Local output directory:
`machine-quality-c6-0-1-17-2-20260908-TbER11`.
Open OUTPUT_INDEX.md for all 12 G11 ASS/SRT/VTT links, source offsets and existing
audio. The only new text change is under
`run-a/unit-9f12c20deaa8/G11-composed/machine-candidate.ass`.
The clips are discontinuous and **not** stitched into full-video production
subtitles. Audio, Gold, responses, full subtitles, private paths and raw manifests
remain local-only. Only generic code/tests and this sanitized report are committed.
Delivery SHA/upstream/remote and final protection receipts are external artifacts;
this report does not self-reference its not-yet-created final commit.

## Stop

Formal scoring is complete. No retuning, new model, sample, boundary work,
loop detector or per-unit winner selection follows it.
The observed result meets normalized source non-degradation on this known set,
but does not certify complete quality. A future separately authorized phase
could seek recognition/candidate evidence that truly exceeds Primary; it is
not executed here.
