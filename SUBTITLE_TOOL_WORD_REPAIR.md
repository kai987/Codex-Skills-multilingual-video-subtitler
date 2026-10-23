# Frozen benchmark and local word repair

This opt-in standalone development/review route reuses frozen ASR, CTC, PCM and
series-memory artifacts. It has no inference, model loading, runtime installation,
cloud call, automatic text mutation, or protected-finalization path.

## Development order

1. Freeze 24 complete temporal subtitle components before proposal generation.
   Include complete original machine and historical-reference records, not clipped
   sentence fragments. Selection is reference-assisted development, not blind gold.
   Components may be up to 90 seconds for listening only; ASR budgets do not change.
2. Generate bounded word-span proposals only for the frozen request's target Cue
   IDs. Reject unrelated transcripts even when windows overlap. Proposals are not
   votes or approvals. The existing C5.19 memory supplies separately labeled prior
   vocabulary and approximate reading/surface suggestions. Never invent an observed
   wrong-form mapping. Approximate matching does not prove acoustic correctness.
3. Show start and end CTC diagnostics independently. Stable dual windows from the
   same CTC model do not independently verify text or authorize timing mutation.
4. Listen, explicitly select/edit text, separately edit timing, save, reload, then
   export independent ASS/SRT/VTT candidates with action history and evaluations.

## Commands

Use the owning checkout, Node 24, and existing built workspace dependencies.

```sh
npm run subtitle-tool:word-repair -- prepare scripts/plans/carnation-word-repair-development-v1.json
npm run subtitle-tool:word-repair -- verify /absolute/path/to/word-repair-run
npm run subtitle-tool:word-repair -- serve /absolute/path/to/word-repair-run
npm run subtitle-tool:word-repair -- apply /absolute/path/to/word-repair-run /absolute/path/to/actions.json
npm run subtitle-tool:word-repair -- export /absolute/path/to/word-repair-run
npm run test:subtitle-tool:word-repair
```

`prepare` requires explicit SHA-256 bindings for the historical reference, baseline,
PCM, memory and comparison freeze. The checked-in Carnation config is local/private,
not a portable/shareable package. It is not a command to rerun recognition.
Each preparation and each export uses a fresh directory.

`serve` binds only to `127.0.0.1`, uses an ephemeral token, checks Host/Origin, limits
request bodies, allowlists assets and serializes revision-checked requests. Do not
expose its token URL publicly. A disk-reloaded action file is validated against its
workspace hash and review version. Candidate acceptance also checks the existing
shared review-action registry and candidate evidence binding.

The page preserves drafts in other fields when saving one field. Unsaved drafts
block export. Browser reload/closure does not save drafts; use the explicit save
buttons first. Saved actions survive restart. JSON backup/restore is workspace-bound.
Every successful save keeps a content-addressed action-history snapshot. KEEP means
keep the current state, not undo earlier edits. Restore a prior action snapshot to
undo changes. A previously edited Cue cannot accept a stale whole-text candidate;
merge further word changes explicitly with the text editor.

## Timing and missing dialogue

New timing must be inside the complete review component and source duration, be
positive and representable on the common 0.01-second ASS/SRT/VTT grid, and must not
increase existing neighbor overlap. Existing overlaps are retained, not silently
resolved. Missing dialogue has no fabricated text/time: save explicit text and
explicit timing; incomplete insertions block export. Splits, merges and deletion
are deliberately outside this small workbench.

## Acceptance boundary

`benchmark.json` is frozen before candidates. `workspace-freeze.json` binds the
workspace, benchmark and audio clips. Evaluation counts whole-unit improvements,
regressions and unchanged units against the historical reference using whitespace-
only edit distance, not a quality claim from aggregate CER. It is not an independent
timing evaluation or newly certified gold. Prior-assisted or human changes are
never reported as machine-only gain. Benchmark coverage does not cover all dialogue.

Exports include original records plus only explicit accepted edits/insertions, an
action provenance ledger and per-unit evaluation. Canonical sources, historical
outputs and human reference files are not overwritten. Export format parity and
tests do not establish subtitle quality: status stays `needs-review`,
`humanValidated: false`, `finalizationMethod: none`.

The current set has only one exact-text control and one surface-equivalent control.
Do not present it as balanced or a generalization test. Add independently reviewed
controls or another episode before making general quality claims. Synthetic UI
tests belong in separate copies and are never human-review evidence.

## Original-baseline local patch route

This separate CLI route preserves the original full raw baseline, including invalid
records, and proposes whole-cue group substitutions only for severe repetition
anomalies. It reuses frozen bounded requests and the action-history store above; it
does not extend the original workbench UI or its word-edit action contract. The
normal `generate/resume` path and the packaged minimal runtime are unchanged.

```sh
npm run subtitle-tool:word-repair -- prepare-patch scripts/plans/super-no-ura-baseline-patch-v1.json
npm run subtitle-tool:word-repair -- verify-patch /absolute/path/to/baseline-patch-run
npm run subtitle-tool:word-repair -- preview-patch /absolute/path/to/baseline-patch-run --export-partial
npm run evaluate:subtitle-tool:baseline-patch -- /absolute/path/to/baseline-patch-run /absolute/path/to/preview-export /absolute/path/to/reference.ass
npm run test:subtitle-tool:baseline-patch
```

The local/private config binds `baselineTask`, `baselineManifestHash`,
`baselineRawHash`, `evidenceRoot`, `evidenceFreezeHash`, and `outputRoot`; it has no
reference path. Preparation verifies saved PCM, raw SRT, source identity, request
range, time mapping and evidence hashes without accessing source media or models.
Each prepare/export creates a new directory. Do not edit frozen workspace files.

`preview-patch` projects proposals into a copy without accepting them or changing
`actions.json`. Listen to the copied source-bound audio and inspect the complete
before/after records in `workspace.json` and `patch-export.json`. Audio starts at
clip time zero; subtitles retain source-global times. The four-cue example is one
indivisible proposal, not verified timing or a mechanism for editing words from a
reference. Cropped heads, unsafe neighboring overlap, stale hashes, conflicting
patches and repeated donor loops are rejected. Normal controls abstain.

After actual review, copy `accept-actions.template.json` to your own action file.
It initially has `acknowledgedUncertainties: false` and is not an approval. Keep its
workspace/evidence/patch bindings, explicitly acknowledge uncertainties and supply
a nonempty reason for `ACCEPT_PATCH`, or choose `KEEP_ORIGINAL`. Then:

```sh
npm run subtitle-tool:word-repair -- apply-patch /absolute/path/to/baseline-patch-run /absolute/path/to/reviewed-actions.json --export-partial
npm run subtitle-tool:word-repair -- undo-patch /absolute/path/to/baseline-patch-run SHA256_OF_PRIOR_ACTION_SNAPSHOT --export-partial
```

An action file is a complete patch-selection snapshot, not an incremental edit
list. Unlike the older word-edit workbench's KEEP behavior, `KEEP_ORIGINAL` here
means this patch is not selected relative to the immutable original baseline.
Undo uses the SHA-256 filename in `action-history/`, validates it against the
workspace and creates another independent export; older exports/history survive.
The initial empty snapshot restores all original records. A stale or foreign
action file fails closed. Acceptance is a recorded user decision, not automatic
acoustic certification or authorization for machine-only release.

Full JSON and text always retain unresolved records. Without `--export-partial`,
any unresolved record prevents subtitle export for that side; with the flag, only
the representable subset is serialized and every omission is listed. Baseline and
candidate ASS/SRT/VTT are verified from disk. Replacing an invalid original with a
candidate does not independently repair that original's timing.

Evaluation verifies the complete machine freeze, replays the patch, verifies all
declared subtitle files and their exact content, and only then reads the reference.
It refuses full-text scoring if a saved record is outside the source timeline or
otherwise cannot be assigned to it; source-local zero-duration text is included.
It reports full saved-text scores and actual serialized-subset scores separately,
using the same reference window/denominator. Existing evaluation directories are
not overwritten. The current case is previously exposed development evidence,
not a blind test or human listening result. See
the real-run report（历史报告 SUBTITLE_TOOL_BASELINE_PATCH_REPORT.md，未随核心源码发布）.
