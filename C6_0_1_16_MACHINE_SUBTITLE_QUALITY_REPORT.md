# C6.0.1.16 machine subtitle quality experiment

Date: 2026-09-07. Profile: `experimental/machine-quality`.

## Outcome

**QUALITY_REGRESSION_HOLD.** One real, source-backed operation reaches exported
ASS/SRT/VTT. Normalized CER improves slightly over historical B1, but insertions
increase and the candidate remains substantially worse than primary-minimal B0.
This is a measured tradeoff, not overall quality acceptance or release approval.
Independent validation is **HELDOUT_VALIDATION_NOT_RUN**.

The experiment infrastructure is implemented and exercised; it is not a new
end-to-end, title-free media-to-subtitles ASR production path. Historical B1 was
verified against its canonical freeze and rendered files, not rerun through the
entire stable pipeline. Causal evidence is limited to B2 versus the identical
scaffold with this one repair disabled. No claim is made that all historical
Raw-to-Final loss has been explained or recovered.

## Isolation and source preservation

Base: `d9fd3c0b0fd5bd3d02088140e587750f85fd13dc` (C6.0.1.14.5.2).
New branch: `codex/c6-0-1-16-machine-subtitle-quality-baseline`.
Implementation commits: `d5427ce` (evidence/evaluation) and `9740af5`
(source-occurrence repair, generation runner and regression tests).

The existing C6.0.1.14.6 dirty worktree was left in place. A private external
snapshot preserves binary working/staged diffs, untracked source copies, the
complete status and 1,639 source hashes. Its tracked/untracked source contents,
HEAD, status and staged binary diff were verified unchanged. No .14.6 work was
committed, stashed, reset, migrated or pushed. Skill 2/3 sources and legacy
generation/authority policies are unchanged.

## The single repair family

`transcription-core/src/intra-cue-repetition.ts` historically removes a repeated
span after detecting lexical repetition even when its evidence explicitly says
`no-independent-token-timestamps-for-second-utterance`. The resulting shortened
cue can subsequently absorb a distinct adjacent occurrence through deduplication.
Absence of a second token timestamp does not prove duplicate ASR text.

The opt-in repair is in
`video-subtitler/src/machine-quality/experimental-repetition-recovery.ts`.
It inverts only a recorded uncertain repetition deletion whose exact removed
text and all occurrence IDs resolve to the frozen primary request segments.
Complete lineage, absence of a foreign descendant, non-overlapping primary
occurrences and containing source bounds are required. Otherwise it abstains.
It restores original primary bytes and intervals, not a longer invented sentence,
Gold wording, a guessed duration, a character-ratio split or an alternative vote.

Real operation count: **1**. One old cue becomes two original-primary occurrence
cues (net +1 cue); this changes both text and temporal structure. The original
raw, old machine and human files remain untouched. The mutation journal preserves
old/new texts, intervals, exact source IDs and the decision reason. These local
details are intentionally not committed in this report.

The experiment does not claim that the restored repeats are all acoustically
correct: primary ASR itself can repeat incorrectly. The observed insertion
increase demonstrates why this profile must remain experimental.

## Inputs and compute

- Same frozen bundle for B0, historical B1 projection, B2 and repair-disabled.
- 30 original Primary Whisper requests; 169 raw segments; no concatenation of
  retry/recovery/second-model tracks into the primary baseline.
- 30/30 exact portable cache identities/results and physical primary WAV hashes
  independently verified at preparation. Chunk offsets reproduce all raw global
  segments. Source origin 0; source audio 48 kHz, stream 1; extracted mono 16 kHz.
- Existing `large-v3` identity, weights hash, runtime identity, decode/prompt hashes
  and request audio hashes are retained in the local machine-evidence file.
  Unavailable tokenizer identity remains null. No confidence or token time invented.
- Historical prompts reconstruct from generic instructions plus a title literally
  present in the media filename. There is no human-subtitle prompt input, but this
  is **not a pure generic-prompt fresh-ASR comparison**.
- Generation reads code/dependencies and one strict machine-evidence JSON, in a
  separate Node filesystem-permission process. Human references and correction
  caches are not permitted inputs. The independent evaluator reads the existing
  development-known reviewed ASS only after output freeze verification.
- New ASR requests/inferences/model loads/provider starts/failures/retries: **0**.
  Additional ASR budget used: **0/24 requests, 0/1,800 seconds**.
- One complete algorithm/configuration trial; subsequent runs are deterministic
  reproductions, not additional parameter trials. A filesystem-permission startup
  failure and a prompt-identity audit failure were diagnosed before final delivery;
  neither called an ASR provider or consumed inference budget.

## Unified quality results

Main scope: all 192 reference cues, including lyrics/OP. Normalized reference
length N=2,048. Exact NFC reference length N=2,257 after removing display line
breaks. One malformed ASS decimal comma is normalized syntactically in memory;
the reference file is never edited. See `C6_0_1_16_EVALUATION_AUDIT.md` for matching,
normalization, legacy metric differences and semantic-label limits.

| Metric                                        | B0 primary-minimal |       B1 stable |    B2 recovered |
| --------------------------------------------- | -----------------: | --------------: | --------------: |
| Cues                                          |                169 |             161 |             162 |
| Exact CER                                     |           0.584847 |        0.649092 |        0.643775 |
| Exact S / D / I                               |    753 / 193 / 374 | 727 / 443 / 295 | 727 / 427 / 299 |
| Normalized CER                                |           0.516602 |        0.601563 |        0.596191 |
| Normalized S / D / I                          |    605 / 175 / 278 | 569 / 410 / 253 | 569 / 397 / 255 |
| Reference character coverage (1-D/N)          |           0.914551 |        0.799805 |        0.806152 |
| Timing matched groups                         |                 86 |              63 |              63 |
| Matched reference cues / 192                  |                103 |              89 |              90 |
| Unmatched reference / machine cues for timing |            89 / 69 |        103 / 90 |        102 / 90 |
| Start MAE (s)                                 |           1.368105 |        1.477127 |        1.451952 |
| End MAE (s)                                   |           1.131860 |        1.588381 |        1.554286 |
| Boundary P95 (s)                              |              2.232 |           7.950 |           7.950 |
| Mean temporal IoU                             |           0.702815 |        0.612709 |        0.621398 |
| >2 s boundary error groups                    |                  8 |              21 |              19 |
| Exact-text overlap diagnostic pairs           |                  0 |               0 |               0 |

Repair-disabled reproduces B1's text/timing and all quality numbers exactly. B2
decreases normalized deletions by 13 but increases insertions by 2; substitutions
are unchanged. No difficult region was removed to reduce CER.

There are 61 unchanged-support timing groups with **zero boundary delta**. The
remaining matching changes explain the aggregate MAE changes; these are not
independent acoustic proof of improved boundaries. Full matches, insertion and
deletion spans, all overlap pairs, merge/split diagnostics, per-format metrics,
and one-to-many paired changes are in the local evaluation files. Default-style
reference cues cannot reliably separate dialogue from narration; they are
explicitly grouped, with lyrics/OP separate. Acoustic hallucination and illegal
overlap labels remain unknown, not guessed from reference absence.

B0 is a minimal diagnostic baseline and has 55 cues exceeding the ordinary
16-character display-line limit. B1 and B2 have 0 such cues. B0 is not presented
as a polished, production-ready subtitle. All versions parse in all three formats;
ASS timing is compared with 0.011 s tolerance and SRT/VTT with 0.0011 s tolerance.

## Separate gates

- Engineering: reproducible machine-evidence experiment; real three-format output,
  strict input/package validation, permission-isolation negative tests, source
  preservation and deterministic replay verified. Full-pipeline B1 replay is not
  claimed as part of this gate.
- Development quality: strict CER improvement, but insertions regress; **HOLD**.
- Raw text/coverage non-degradation: **FAIL**. Raw timing non-degradation: **FAIL**.
- Held-out quality: **NOT_RUN**. No verified independent media/reference pair was
  established from the available metadata. Other same-episode artifacts and
  synthetic fixtures are not independent accuracy tests. No unseen reference was
  opened and no generalization pass is claimed.
- Release: `needs-review`, `finalizationMethod: none`,
  `machineOnlyReleaseAuthorized: false`, `humanValidated: false` throughout.
  Strict v1 package container `status: ready` means files exist; its
  `primarySubtitle.validationStatus` remains `needs-review`.
- This version does not complete .14.6, authorize .15, or change C6.0.2 HOLD.

## Executed validation

Stable baseline before changes: 155 test files, 1,310 passed, 2 skipped.
Current implementation: typecheck, lint, format check and build passed; 158 test
files, 1,327 passed, 2 skipped. Separate E2E: 35 files, 83 passed, 1 skipped.
Focused quality tests: 17/17. Optional MFA/speaker integration tests were not
enabled; skips are not counted as model validation. Existing default-profile,
human-authority, review UI and historical protection tests remain in these suites.
No UI was changed and no new browser acceptance or human trial is claimed.

All four variants pass strict v1 package parsing and SRT/VTT/ASS round trips;
two independently permission-isolated generation processes produce identical
payload hashes. Preparation verifies 30/30 current cache files and physical WAV
digests without invoking a provider. A real negative test rejects a reference
file read outside the process allowlist. Source-video identity matches the
historical frozen SHA-256; input/reference and protected-tree hashes were checked.

## Commands and local delivery

Build first with the repository's Node 24/npm 11 lockfile. No new dependencies or
models were introduced.

```sh
npm ci --offline --ignore-scripts
npm run build
npm run quality:prepare -- /path/to/primary-run /path/to/stable-run /private/new-evidence.json
npm run quality:generate -- /private/new-evidence.json /path/to/new-experiment
npm run quality:evaluate -- /path/to/new-experiment/run-a /private/development-reference.ass /path/to/new-experiment/evaluation
npm run test:c60116
```

Directories and files must be new; overwrite is refused. The current importer
supports the verified no-VAD historical baseline format, not arbitrary caches.
Local delivery contains `machine-evidence.json`, `replay-validation.json`,
independent `run-a`/`run-b` manifests and outputs, stage availability, mutation
journals, and `evaluation/metrics.json`, `cue-diff.csv`, `changes.md` and validation.
The candidate to inspect is `run-a/candidate/B2-recovered/machine-candidate.ass`.
It is an experiment candidate for inspection, not a recommended replacement
of an already human-reviewed subtitle. Local evidence includes private dialogue
and paths and is not public-shareable.

## Minimum next step

Do not expand the review planner or tune a phrase blacklist. Within this same
repair family, obtain independent, generic acoustic evidence that distinguishes
real repeated calls from primary-ASR loops before allowing uncertain repetition
restoration to become default. A future title-free primary-ASR comparison needs
its own frozen, budgeted evidence plan. This run intentionally stops at one
measured configuration instead of using Gold to trim the restored phrase.
