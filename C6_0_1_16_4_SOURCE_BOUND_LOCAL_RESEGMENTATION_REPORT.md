# C6.0.1.16.4 — Source-bound Local Resegmentation & Text/Timing Recovery

Date: 2026-09-08 JST. Known-development, local research experiment.

## Outcome

**Engineering passed; development text gain; QUALITY_TRADEOFF_HOLD.**

The new opt-in operation actually reaches exported subtitles: one source-bound
group replaces two old machine cues with four new cues. T2 has 102 cues versus
T0's 100. Normalized CER decreases from 0.47119140625 to 0.46728515625 (eight
fewer edits). This is not a timing-quality pass: end MAE, boundary P95 and severe
boundary groups worsen, and mean IoU falls. Exact deletions increase by four.
The 98 unaffected exported cues remain exactly unchanged, including context
inside the research envelopes. No default promotion or machine-only release.

All variants retain `needs-review`, `finalizationMethod: none`,
`humanValidated: false`, `defaultPromotionAuthorized: false`, and
`machineOnlyReleaseAuthorized: false`. Alignment success does not establish
correct wording, exact repeat counts, speaker identity or a validated final.

## Base and protected scope

Exact base: `81ee21c2f3ac6a07477dc0adae8a1dbf6ce58744`.
Independent branch: `codex/c6-0-1-16-4-source-bound-local-resegmentation`.
Pre-alignment code/test freeze: `588b599fd8ff93bd0d1f49653457064b0ce43cae`.

Read the .16.1, .16.2, .16.2.1 and .16.3 reports, actual matched replay,
complete Whisper JSON consumer, existing CTC worker, model/runtime manifests,
package configuration and existing evidence. The named Skill supplied the
source-priority, evidence-semantics, preservation and finalization constraints.
Its new opt-in section documents this separately authorized experiment, not a
default strategy change.

A private protection snapshot covers **10,164 files**: the dirty .14.6 worktree,
.16/.16.1/.16.2/.16.2.1/.16.3 sources and outputs, original media, existing
request/audio inputs and human reference. HEAD/status/staged/unstaged state and
file hashes verified unchanged after execution. No stash, switch, pull, reset,
clean, old staging, force-push or planner migration. Skill 2/3 sources, existing
human canonical text/timing, old reports and caches were not modified.

This remains `PRIMARY_ONLY_MATCHED_PROFILE`, with historical
`HISTORICAL_TITLE_PROMPTED_EVIDENCE`; it is not full historical-pipeline
reproduction or fresh title-free whole-film recognition. The original Primary
identity is `23d71937da4afb640c5dcdc0921557a87b45ce4ed8af2a6b5475f648f0e9e074`.
T0 reparses and executes the old frozen acoustic-policy baseline, then exactly
matches .16.3 S0 ASS/SRT/VTT bytes. No output snapshot is substituted for execution.

## Source units, group closure and actual hook

Old occurrence cores are selection seeds, **not acoustic hard boundaries**.
The existing larger W2 physical WAV is the immutable read envelope. Preparation
uses complete consecutive original Whisper parents intersecting the seed;
it never chooses an agreeing substring, splices requests or rewrites the stored
transcript. Complete raw JSON, control/Unicode handling, zero-duration lexical
records and source-global mapping reuse the .16.3 consumer. Native and aligned
proposals bind the same complete selected source hash in every case.

The initial group maps occurrence/dedup lineage to the actual post-dedup cues.
Before alignment, all stage cue hashes and initial/eligible/protected lists are
frozen. Eligible neighbors must be wholly inside W2 on the same verified Primary
source-global timeline, with compatible language/style/speaker fields and no
intervening incompatible cue. Different request chunks are not automatically
treated as media discontinuities. These checks do not establish speaker truth.
Later absorption requires the complete selected original-parent scope to cover
the eligible neighbor; a shifted interval collision alone cannot absorb it.

| Group   | Initial / eligible neighbors            | Native outcome                                                        | Aligned outcome                                                                                 |
| ------- | --------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| case-01 | 1 initial cue; 2 eligible neighbors     | Abstain: final lexical edge has zero time; materialization incomplete | Abstain: relocated interval meets a neighbor whose complete source scope is not included        |
| case-02 | 1 initial cue; no eligible neighbors    | Abstain: protected preceding cue conflict                             | Abstain: protected preceding cue conflict remains                                               |
| case-03 | 1 initial cue; 1 eligible following cue | Abstain: last lexical edge lacks native interval                      | Apply: include the predeclared following cue by complete source-parent scope; **2 old → 4 new** |

Detailed real cue IDs, full protected lists, physical bounds, source character
spans, timings and inclusion reasons are in local `source-groups.json` and
`patches/`. Removed dedup occurrences remain diagnostic lineage, not assumed
speech truth. Empty region deletion is unavailable. Invalid/unrepresentable W2
does not fall back to W1. W1 whole-window differences remain risk metadata;
Reazon points remain window-level diagnostics without intervals, lexical votes
or a disagreement veto. All three cases retain lexical/repetition uncertainty.

`REPLACE_SOURCE_BOUND_UTTERANCE_GROUP` executes **after cross-cue dedup and before
intra-cue repetition repair**, as an exclusive optional sixth replay argument.
It binds the whole input stage, every old cue/hash, occurrence/request identity,
candidate request/character span, timing evidence, new cues and protected
neighbors. The whole patch set validates before mutation; stale membership,
physical escape and conflicts fail closed. Overlapping transactions are both
blocked rather than silently merged. Reapplying an already materialized patch is
idempotent. New IDs bind group/source/mode/unit boundaries, not an old cue label.

Applied groups bypass destructive intra-cue repair and downstream semantic
merge/split. They act as scoped barriers while unaffected blocks use the old
segmenter. Display-only layout still runs; frozen lexical order and exact approved
boundaries survive all three exports. Parent splits must also be Japanese word
boundaries; otherwise complete adjacent parents merge. There is no character-time
ratio, equal-duration split, container-time substitution or mechanical overlap
clipping. New materialization uses the existing two-line/16-character layout
contract and 12-second ordinary-cue cap. Feature-off and disabled paths retain
the old behavior exactly.

## Installed aligner and execution accounting

One backend was selected before Gold: installed
`reazon-research/japanese-wav2vec2-large-rs35kh`, revision
`2162c9edb97f362f7623d6b3a2e417458e879bca`.

| Identity                       | Value                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Model snapshot SHA-256         | `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd` |
| Weights SHA-256                | `cc0228dfe1d939e541624c78911eafc7041698e1b2f4853de8a6364fb4557364` |
| Runtime identity               | `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60` |
| Device / precision             | CPU / float32, 8 threads                                           |
| Python / torch / transformers  | 3.12.14 / 2.13.0 / 5.16.1                                          |
| NumPy / soundfile              | 2.5.2 / 0.14.0                                                     |
| Frame stride / receptive field | 320 / 400 samples at 16 kHz                                        |

All installed model-file hashes were checked before preparation and again before
loading. Runtime package metadata was inspected without importing/loading a
model; actual ready-handshake versions subsequently matched. No installation,
download, global upgrade, MFA, new VAD/speaker/separation model or cloud request.

| Request    | Original physical WAV seconds | Status                              |
| ---------- | ----------------------------: | ----------------------------------- |
| case-01 W1 |                             5 | Complete conditional symbol mapping |
| case-01 W2 |                             8 | Complete conditional symbol mapping |
| case-02 W1 |                             8 | Complete conditional symbol mapping |
| case-02 W2 |                            11 | Complete conditional symbol mapping |
| case-03 W1 |                             7 | Complete conditional symbol mapping |
| case-03 W2 |                            10 | Complete conditional symbol mapping |

Totals: **6 logical tasks, 6 attempts, 6 acoustic forwards, 1 model-load attempt,
1 successful load, 1 provider process, 49 seconds, 0 padding, 0 failures,
0 retries**. Budget: 6 normal tasks, at most 8 attempts and 180 seconds including
padding, each task at most 30 seconds. The two failure-retry slots were unused;
low scores or different wording did not trigger retries. All new Whisper/Reazon
ASR requests, inference, model loads and provider starts are **zero**. A/B
generation used persisted alignment only, with zero model activity.

The new alignment-only worker reuses deterministic float64 CTC Viterbi but does
not run greedy/beam ASR decoding. It aligns the complete supplied window text,
not the old core. Only documented non-spoken punctuation/spacing is omitted from
the alignment target; original text remains preserved. Token pieces must
reconstruct that target exactly, including multi-character tokenizer pieces.
Unknown/unmapped symbols fail; no kana/kanji substitution, G2P dictionary, wildcard
or inferred member duration is introduced.

Intervals use verified convolution frame-cell coordinates with one source offset.
The 20 ms frame-cell ownership convention is frozen; the 25 ms receptive field
is separately recorded, not presented as exact phonetic onset/end. Complete
token-to-source-character mappings and frame indices are persisted. One-frame
spans and weak posterior tokens remain visible. Neither path score nor successful
alignment is used as an independent lexical vote.

Evidence is `ALIGNER_ESTIMATED_INTERVAL`, conditional on the supplied machine
transcript. Native evidence is `STORED_ASR_INTERVAL_ESTIMATE`. Reazon provides
points only. In particular, the short final unit in case-03 remains acoustically
uncertain despite successful forced alignment; this experiment does not assert
that its full lexical form or subtitle boundaries are correct.

Request starts and forward starts are durably journaled; original responses,
diagnostics and result hashes persist before the next request. The runner refuses
an existing execution directory: interrupted/failed evidence must be inspected,
not silently retried. No interrupted or recovery attempt occurred here.

## Four controls and two freezes

One formal predeclared plan/configuration was used, with T2 as the main research
candidate; no post-Gold best-case mixture or policy tuning.

- T0-baseline: actual .16.3 baseline reexecution and byte comparison.
- T1-native-group: same new group/source policy using stored native timing only;
  all three groups abstain, so actual exports equal T0.
- T2-aligned-group: same complete source candidates using new conditional timing;
  case-03 applies, the others abstain.
- T2-application-disabled: identical aligned evidence/proposals with application
  disabled; text, time, style, cue structure and export bytes equal T0.

There are **zero common applied native/aligned groups**. Case-03 changes the
application set; its outcome is the combined effect of admissibility, text,
timing and grouping, not a pure timing improvement. Partial rejected native
`newCues` are diagnostics, not a different selected source candidate. The separate
validation receipt verifies the identical complete source hashes explicitly.

Preparation froze sources, physical WAV hashes, six complete transcripts,
neighbor lists, W2 rule, alignment capabilities/configuration, requests/budget,
generation/evaluation implementation hashes and the unchanged evaluation policy.
Fourteen provider-shaped synthetic tests passed before model loading, including
real isolated CLI generation into all formats. Synthetic fixtures are not real
acoustic observations.

UTC timestamps: pre-alignment plan `2026-09-07T17:47:28.229Z`; machine A/B freeze
`2026-09-07T17:48:24.289Z`; first evaluation-reference read
`2026-09-07T17:49:23.814Z`. Local date is September 8 JST. Both independent
generators have **32 byte-identical non-clock payloads**. Clock manifests are
separately hashed. Raw alignment, full mapping, patches, exports and stage traces
are included in the second freeze.

Generation uses Node 24 filesystem permissions allowing only repository code,
exact machine input files and the new output directory; child/addon access is
denied. macOS sandbox separately denies network. The alignment process denies
network and private Documents/Downloads reads except repository and the six
explicit WAVs. Evaluation is a separate post-freeze process. The generator has
no Gold argument. No human text, timing, dictionary or episode answer was used
for selecting or modifying this plan. Historical developer exposure is explicit.

## Frozen evaluation and tradeoffs

Existing .16 metric/normalization policy, complete reference including OP/lyrics:
192 cues, normalized N=2,048, exact N=2,257. Scores use actual reparsed ASS/SRT/VTT,
not proposed/internal cues. SRT/VTT timing is shown below.

| Metric                           |            T0 |     T1 native |    T2 aligned |   T2 disabled |
| -------------------------------- | ------------: | ------------: | ------------: | ------------: |
| Cue count                        |           100 |           100 |           102 |           100 |
| Normalized S/D/I                 |   599/212/154 |   599/212/154 |   591/212/154 |   599/212/154 |
| Normalized distance              |           965 |           965 |           957 |           965 |
| Normalized CER                   | 0.47119140625 | 0.47119140625 | 0.46728515625 | 0.47119140625 |
| Exact S/D/I                      |   730/266/195 |   730/266/195 |   719/270/195 |   730/266/195 |
| Exact distance                   |          1191 |          1191 |          1184 |          1191 |
| Exact CER                        |   0.527691626 |   0.527691626 |   0.524590164 |   0.527691626 |
| Non-deletion coverage proxy      |   0.896484375 |   0.896484375 |   0.896484375 |   0.896484375 |
| Start MAE, seconds               |      1.357887 |      1.357887 |      1.351782 |      1.357887 |
| End MAE, seconds                 |      0.849566 |      0.849566 |      0.905400 |      0.849566 |
| Boundary P95, seconds            |         3.060 |         3.060 |         3.395 |         3.060 |
| Mean IoU                         |      0.728674 |      0.728674 |      0.707465 |      0.728674 |
| Severe boundary groups           |             8 |             8 |             9 |             8 |
| Matched timing groups            |            53 |            53 |            55 |            53 |
| Matched reference cues / 192     |           108 |           108 |           109 |           108 |
| Unmatched reference / hypothesis |         84/35 |         84/35 |         83/34 |         84/35 |
| Presentation-overflow cues       |            23 |            23 |            22 |            23 |
| Total overlap pairs              |             0 |             0 |             0 |             0 |

ASS has the same text metrics; its centisecond representation gives T2 start/end
MAE 1.351091/0.905273, P95 3.390 and mean IoU 0.707411. These format effects do
not change the conclusion. The eight-edit normalized improvement is S -8,
D/I unchanged; it is not eight independently confirmed repaired spoken characters.
Exact S -11, D +4, I unchanged. Exact deletion increase and worse timing retain
the quality HOLD even though text CER improves. Non-deletion coverage is not
accuracy; insertion diagnostics are not confirmed hallucinations; total overlaps
are not proven erroneous overlaps.

Actual differences: one atomic group, two removed export IDs, four added IDs,
net +2 cues. The legacy `exportChangedGroups=0` field counts changed retained
IDs, so it does not mean zero group mutation. The new validation receipt reports
`actualGroupChanges=1` separately. T1 and disabled have zero differences.

Timing views are kept separate:

1. Full-output matching: 53 → 55 timing-eligible groups, with changed denominators.
2. Same fixed reference-content support: all **52 unchanged identity/support
   groups have zero start/end deltas**. The changed case's old reference group
   has no equal-content counterpart and is `TIMING_EFFECT_NOT_COMPARABLE`.
   There is no demonstrated same-support timing gain.
3. Matching-set effect: one old group removed/regrouped, three added/regrouped.
   Aggregate start-MAE reduction cannot be attributed to boundary precision.

Local reference ranges use the predeclared W2 envelopes, independent of changed
cue boundaries. All three contain a crossing reference cue and retain
`REFERENCE_BOUNDARY_AMBIGUITY`; exact local metrics are null. Complete
intersecting-cue diagnostics are non-additive context, never proportional cuts.
Source text variants still disagree with parts of the reviewed wording, and the
new short tail does not recover its full reference duration. Reference checks
are not direct listening; no acoustic/human confirmation is claimed.

No unedited neighbor is lost or altered: all 98 untouched export cue objects
match T0 exactly. The one eligible neighbor was explicitly absorbed into the
transaction, not silently dropped. No new total overlap appears, but true repeat
count and extra-content correctness remain unverified. R0 was not rerun; its
older metrics remain inherited comparison only. This known episode is not an
unseen/held-out validation (`HELDOUT_VALIDATION_NOT_RUN`).

## Integrity and validation

| Identity             | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| Pre-alignment freeze | `5e6887046e8fb54b1d6cf536ac7b54b4c7cf40edb4467b77ca6351bca76e3fb0` |
| Alignment plan       | `3a9b9482ef4a8063e53fbb2a4b1ae1f088edcc588596d90d348d00d9d4657956` |
| Alignment freeze     | `de756e3feb3ea6832380ade2c1a61cfae0729f04b59527a96d97ff703f3d1ed4` |
| Generation freeze    | `f081047b5b6160cde493610d3fd875b16e2efce048ca2fb5b11a225cb1f3607b` |
| T2 text              | `aadd3e060e89a83ffa8fcd38e5b760561d9d706cb0aececf6e2d54fb6747c81a` |
| T2 timing            | `537d2d066f9c20da2cfc9daabbd85d125aa4cffd111d578160a8f9676d5bd5af` |
| T2 presentation      | `e78cc286ecdd15986ad6e901636e812dd591f960ec346f1cfb8a5387615ae75a` |
| T2 ASS               | `3e69b76f7c64a1529e7b741a68a9acdf728db18bab3cd3e1b05a927b3df0121f` |
| T2 SRT               | `f5a610287db589c518c26a423850f4e9375197f95cb1132d39ff48ce3325a054` |
| T2 VTT               | `bdf27bea24ce392caa349d1d94acfbe8a0936a3d00365dcbef096cad826cf59e` |

Full suite: **168 files, 1,414 passed, 2 skipped**, at two workers. The two optional
real-model tests were disabled and are not passes. New focused subset: **14
passed**, including atomic/idempotent replacement, old-core expansion, actual
provider-shaped complete mapping, missing/zero-time edges, stale identities,
protected neighbors, overlapping groups, strict schemas and isolated A/B
ASS/SRT/VTT export reachability. They are included in the full count.

Strict Zod plus independent AJV2020 validation passed for **23 documents**:
three groups, six alignment envelopes, six patches and eight subtitle packages.
Frozen payload/clock/metadata hashes, event-derived execution counts, disabled
parity, .16.3 baseline bytes, 98 unaffected exports and all applied lexical order
and boundaries passed. Typecheck/lint/format/build and separate E2E command
receipts are delivered under `validation/commands.json` and the corresponding
logs; all five commands passed. Separate E2E: **40 files, 89 passed, 1 skipped**
(a subset of the full suite, not additional unique passes). Final command outcomes
are also recorded in the delivery receipt.

No generation policy, source candidate, model setting, threshold or subtitle was
modified after first Gold read. The additional post-freeze validation command
only audits frozen outputs and records the stricter `QUALITY_TRADEOFF_HOLD`;
it does not overwrite the evaluator's text-gain result or reselect a candidate.

## Reproduction and local output

Use pinned Node 24/npm 11 and the existing lockfile. No new dependencies.
The following documents the interfaces, **not authorization to spend another
alignment budget**. All destinations must be new; an existing execution is
inspection-only until its ledger is reconciled.

```sh
npm ci --offline --ignore-scripts
npm run build
npm run quality:source-group:prepare -- <old-acoustic-run> <stored-token-run> <installed-runtime-manifest> <installed-model-manifest> <new-output>
npm run quality:source-group:align -- <new-output>
npm run quality:source-group:generate -- <new-output>
npm run quality:source-group:evaluate -- <new-output> <evaluation-only-reviewed-ass>
node scripts/validate-c601164.mjs <new-output>
npm run test:c601164 -- --maxWorkers=2
```

Authoritative local folder:
`machine-quality-c6-0-1-16-4-20260908-experiment-01` under the original workspace's
`output/`. Main new ASS: **`run-a/T2-aligned-group/machine-candidate.ass`**, with
SRT/VTT and strict needs-review package beside it. Both independent runs contain
all four controls, full stage traces, mutation journals and state hashes.
`evaluation/metrics.json`, `group-diff.csv`, `changes.md`, `validation.json` and
`OUTPUT_INDEX.md` document the actual artifacts.

Raw responses, private paths, source WAVs, full reference evaluation and output
subtitles remain local-only, not public-shareable and not committed. Public
changes are focused source/runtime code, neutral tests, Skill documentation and
this sanitized report. The final local receipt binds this report's final commit
and matching local/upstream/remote identities without self-referential Git hashes.

The smallest next direction is a separately authorized investigation of
**conditional CTC boundary truncation and weak terminal spans**, using these
existing aligned outputs first. It must not equate forced alignability with
lexical correctness or silently expand the audio window. No next model run,
ASR round, parameter search, full-film decode or automatic promotion is started.
