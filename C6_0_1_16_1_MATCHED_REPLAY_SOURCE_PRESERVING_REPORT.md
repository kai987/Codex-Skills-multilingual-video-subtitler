# C6.0.1.16.1 matched replay and source-preserving assembly

Date: 2026-09-07. Development-known, local-only experiment.

## Outcome

**QUALITY_TRADEOFF_HOLD.** The matched replay engineering checks pass. The
source-preserving intra-cue policy reaches actual ASS/SRT/VTT and improves
development CER by five edits. Substitutions, insertions and display overflow
increase, however. No default promotion or machine-only release is authorized.
This does not complete .14.6, .15 or C6.0.2, and does not revise .16's frozen
QUALITY_REGRESSION_HOLD.

| Acceptance dimension           | Result                                              |
| ------------------------------ | --------------------------------------------------- |
| replayScope                    | PRIMARY_ONLY_MATCHED_PROFILE                        |
| matchedEvidenceVerified        | true                                                |
| historicalReproductionVerified | false                                               |
| exportMutationVerified         | true                                                |
| developmentCERGain             | normalized and exact both improve                   |
| qualityTradeoffDetected        | true                                                |
| rawNonDegradation              | CER passes; coverage proxy and combined timing fail |
| heldoutValidation              | HELDOUT_VALIDATION_NOT_RUN                          |
| defaultPromotionAuthorized     | false                                               |

## Baseline, protection and evidence boundary

Implementation base: `948dc5e56f6dd53a2c52fe899cc70c6379427567`.
New branch: `codex/c6-0-1-16-1-matched-replay-source-preserving-assembly`.
Replay implementation commit: `75977b5`. Later documentation/verification
changes do not modify its generation algorithm.

The .14.6 dirty worktree remains at `d9fd3c0`. Its 1,639 source hashes, HEAD,
status, staged binary diff, working changes and untracked source were privately
snapshotted outside Git. The .16 clean source, its previous experiment outputs,
the selected media and authoritative reviewed ASS were separately fingerprinted
(1,705 files). Before/after verification passed. No switch, stash, reset, clean,
pull, or migration of protected work occurred. Skill 2/3 are unchanged.

Read the existing .16 report, evaluation audit, importer, inverse recovery,
generator, metrics, workflow call sites and .14.6 progress boundary. The optional
.16 independent-review document was not found in the source, delivery or Downloads
filename search.

Preparation rechecked the previous import receipt and 74 protected source inputs:
30 original Primary no-VAD request results, exact portable cache identities and
physical WAV hashes, plus original manifests. It checked each raw segment list
against the original request result, not against final subtitles. The generated
payload removes stableCues, canonicalLineage, unprovenRepetition and historical
final provenance. Its SHA-256 is
`23d71937da4afb640c5dcdc0921557a87b45ce4ed8af2a6b5475f648f0e9e074`.

The evidence retains fixed model/runtime/audio/decode/prompt/timebase identities;
unavailable tokenizer identity remains null. It is explicitly
HISTORICAL_TITLE_PROMPTED_EVIDENCE, not title-free fresh-ASR acceptance.
No new cache format or model identity was invented.

Generation is a separate Node permission process: repository code/dependencies,
one strict primary-only evidence file and its new output directory are readable.
It cannot read the historical final, Gold, human corrections or deletion journal.
Evaluation opens the existing development reference only after machine freeze
verification. Developer knowledge of this episode is acknowledged.

## Actual chain and single repair

R0 maps the fixed request segments once to global source time, sorts and exports.
R1/R2/disabled execute the same selected business chain:

1. `primaryMinimal`: exact repeated-request import collapse and source time map.
2. `deduplicateTopScoreWinners`: existing cross-cue rule, unchanged.
3. `repairIntraCueHypothesisRepetition`: old policy or the opt-in main repair.
4. `buildAcousticSemanticCueSegments`: real existing merge/split decisions.
5. `layoutSubtitleCuesWithDiagnostics`: presegmented layout, no temporal splitting.
6. Existing `formatAss/formatSrt/formatVtt`, disk reread and parser checks.

Full historical candidate generation, association/Top-Score selection,
reference/lyrics branches, upstream text-integrity recovery, scene/speaker/token
dependencies, timing recovery and enforcing quarantine are unavailable or
disabled in this profile. The fixed Primary selection is not a rerun of those
stages. R1 has 101 cues, not historical H1's 161; it is **not** full historical
reproduction. No attempt was made to tune it to 161.

Pre-repair cross-cue dedup removes 14 representations under the old rule. This
unchanged stage's justification remains independently challengeable; its entire
input/output and kept/removed mappings are recorded. This run does not claim
that all those deletions are acoustically valid or repaired.

At the actual intra-cue stage, the old rule deletes four spans in three cues
without independent second-occurrence timing. The new explicit
`repetitionPolicy: source-preserving` retains that stage's current content and
bounds, records ABSTAIN and possible decoder loop, and reports zero repaired or
removed spans for those abstentions. Missing evidence is not duplicate proof.
It neither labels preserved words as acoustically true nor restores earlier Raw
over legitimate prior changes. The default remains legacy.

Fresh stage traces contain implementation/input/output hashes, full before/after
cue snapshots, counts, occurrence/request provenance, operation mappings and
actual business rationale. Timestamp-only diagnostic fields are omitted from
deterministic payload comparison; real freeze time is retained in the manifest.
Raw model intervals are provenance, not verified token alignment.

The old semantic merger also produces colliding IDs for different groups in this
restricted profile. An adapter binds each actual result to its fresh plan using
source IDs and exact intervals; it changes no text or time. An independent
execution from the unchanged .16 implementation verifies ASS/SRT byte equality
and VTT equality after **only** cue-ID substitution. VTT identifiers therefore
change, although visible content/timing/style do not. Its original unbound
exports are retained as an explicit framework-effect control.

## Frozen development results

Main denominator: all 192 reference cues, including lyrics/OP; normalized
N=2,048 and exact N=2,257. The .16 evaluator functions and normalization are
unchanged. All three real formats are reparsed, not scored from internal JSON.
Gate policy was frozen before evaluation, with zero numeric rounding tolerance.

| Metric                             |  R0 primary |   R1 legacy | R2 preserved | Repair disabled |
| ---------------------------------- | ----------: | ----------: | -----------: | --------------: |
| Cues                               |         169 |         101 |          100 |             101 |
| Exact CER                          | 0.584847142 | 0.529906956 |  0.527691626 |     0.529906956 |
| Exact S/D/I                        | 753/193/374 | 702/306/188 |  730/266/195 |     702/306/188 |
| Exact distance                     |        1320 |        1196 |         1191 |            1196 |
| Normalized CER                     | 0.516601563 | 0.473632813 |  0.471191406 |     0.473632813 |
| Normalized S/D/I                   | 605/175/278 | 573/249/148 |  599/212/154 |     573/249/148 |
| Normalized distance                |        1058 |         970 |          965 |             970 |
| Non-deletion coverage proxy, 1-D/N | 0.914550781 | 0.878417969 |  0.896484375 |     0.878417969 |
| Timing groups                      |          86 |          54 |           53 |              54 |
| Matched reference / 192            |         103 |         107 |          108 |             107 |
| Unmatched reference / hypothesis   |       89/69 |       85/35 |        84/35 |           85/35 |
| Start MAE seconds                  |    1.368105 |    1.408370 |     1.357887 |        1.408370 |
| End MAE seconds                    |    1.131860 |    0.874278 |     0.849566 |        0.874278 |
| Boundary P95 seconds               |       2.232 |       3.060 |        3.060 |           3.060 |
| Mean IoU                           |    0.702815 |    0.712273 |     0.728674 |        0.712273 |
| Severe boundary groups             |           8 |          11 |            8 |              11 |
| Presentation-overflow cues         |          55 |          21 |           23 |              21 |

The 1-D/N value is an edit-alignment non-deletion proxy, **not character accuracy**.
R2 vs R1: normalized S +26, D -37, I +6, distance -5. Those global alignment
changes cannot be interpreted as 37 proven recovered characters or six confirmed
hallucinations. Exact distance also falls by five, with S +28, D -40, I +7.
R2 improves CER over Raw, but does not preserve Raw's coverage proxy and has a
worse timing P95. These dimensions are not collapsed into a misleading Raw pass.

There are 51 unchanged-support timing groups and every boundary delta in that
cohort is zero. Aggregate timing gains are affected by changed text matching and
one downstream 2:1 merge, not proof of an acoustic timing correction.

Three local cases trace fixed machine input through legacy deletion, repaired
stage preservation, actual downstream grouping and exported files. The first
joins a neighboring cue without dropping its words; the others retain one cue.
The local diagnostics use the union of the two global-match reference sets and
are explicitly non-additive. Full local text, matched/deleted/inserted spans,
strata, 1:M/M:1 groups and export differences remain outside Git.

Historical H0/H1/H2 are copied only into the separate history/evaluation area
after generation. Their normalized S/D/I and CER remain respectively
605/175/278 (0.516601563), 569/410/253 (0.601562500), and
569/397/255 (0.596191406). They are not the starting state of any R variant.

## Acoustic evidence, repeatability and validation

The machine-side check includes all three actually affected repetition cases,
selected before reference evaluation. Only one Primary track is available:
same-window stability and cross-model agreement are not established; segment
bounds do not localize repeated words. All acoustic classifications remain UNKNOWN.
No new ASR requests, input audio seconds, model loads, provider starts, inference
failures or retries occurred (0/12 requests and 0/360 seconds used). Preparation
verified 30 cache entries; each generator reused 30 frozen results without opening
a cache/provider. The duplicate-import negative control is synthetic, not acoustic
truth. No acoustic result was secretly added to R2.

One algorithm/configuration trial was used. The initial local run exposed duplicate
internal IDs before reference evaluation; final delivery adds identity-only binding.
It is retained as diagnostic history, not scored as a separate quality configuration.
Two final independent generation processes produce 29 byte-identical payloads each.
R1 and repair-disabled match text, time, structure and all three export bytes.
The independent old-worktree control additionally bounds the adapter's effect.

Validation: typecheck, lint, format check and build pass; full suite **1,347 passed,
2 skipped** (160 files); separate E2E **84 passed, 1 skipped** (36 files);
focused **20 passed**. The first concurrent E2E run hit an unchanged historical
planner's 5-second timeout; a separate rerun passed without changing its timeout.
Optional real-model tests remain skipped, not claimed as fresh model acceptance.
Strict evidence/package parsing and stage business-artifact validation are reused.
Permission-denial, invalid/Gold/history inputs, exact import dedup, distinct repeats,
unknown truth, source-current preservation, coordinate overflow, stale attachments,
ID binding, lexical layout preservation and actual three-format parity are covered.
No UI was changed or added. No suitable independent media/reference pair was
established for this task; held-out validation is NOT_RUN, not a generalization pass.

## Reproduction and delivery

Use the pinned Node 24/npm 11 lockfile, build first. No new dependencies or models.
All destinations must be new.

```sh
npm ci --offline --ignore-scripts
npm run build
npm run quality:matched:prepare -- /private/verified-c60116-evidence.json /private/its-input-receipt.json /private/new-primary-evidence.json
npm run quality:matched:generate -- /private/new-primary-evidence.json /output/new-replay
node scripts/verify-c601161-legacy.mjs /path/to/clean-c60116-worktree /private/new-primary-evidence.json /output/new-replay/run-a /output/new-replay/independent-legacy-verification.json
npm run quality:matched:evaluate -- /output/new-replay/run-a /private/development-reviewed.ass /output/new-replay/evaluation
npm run test:c601161
```

Authoritative task folder:
`machine-quality-c6-0-1-16-1-20260907-delivery`.
New candidate: `run-a/R2-source-preserving/machine-candidate.ass` alongside SRT,
VTT and strict needs-review package. See local evaluation, stage-comparison,
causal cases, mutation journal, framework control, history and validation receipts.
This is machine-evidence-to-subtitle replay, not new video recognition.

Every research output remains needs-review, finalizationMethod=none,
machineOnlyReleaseAuthorized=false and humanValidated=false. Preserve uncertainty
and do not replace the reviewed original.

The next smallest direction is a separately frozen, bounded acoustic check of
these three repeated-span cases to distinguish real repetitions from decoder loops;
do not expand the planner or promote this policy by CER alone.
