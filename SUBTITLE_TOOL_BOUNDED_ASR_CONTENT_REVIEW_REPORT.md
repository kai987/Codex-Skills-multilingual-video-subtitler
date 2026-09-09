# Frozen-Evidence Content Evaluation & Listening Handoff

## Outcome

Implementation and real frozen-evidence listening preparation are complete. **LISTENING_HANDOFF_READY** coexists with **AWAITING_HUMAN_REVIEW**. No human content evaluation or A/B superiority conclusion has been manufactured. This is a private review aid, not a recovered or accepted final subtitle export.

| Layer                                                 | Result                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| CLI / annotation validator / immutable summary        | Implemented and tested                     |
| Real listening handoff                                | 53 verified WAV files, ready for human use |
| Human content evaluation                              | 0 reviewed, 53 NOT_PERFORMED               |
| A/B comparative content conclusion                    | Not available; paired denominator 0        |
| Full timed export                                     | blocked                                    |
| Quality / CER                                         | needs-review / NOT_MEASURED                |
| Finalization / humanValidated / release authorization | none / false / false                       |
| Product defaults                                      | Unchanged                                  |

## Source and provenance

- Repository: `kai987/Codex-Skills-multilingual-video-subtitler`.
- Base: `dfcc68f1b20660f0c64fd10ae081ab15a09dcaa7`.
- Prior diagnostics implementation: `93782e0e56baec74a93df69c7df033c693586842`.
- Historical inference implementation: `fcba52996989753b8b000e89e6a31d132523e584` (historical only; no inference rerun).
- New branch: `codex/subtitle-tool-bounded-asr-content-review`.
- New implementation: `7fc06d3540bbb4f33a0546bfe883cb32abb4a90f`.
- This report is a separate documentation commit. Its containing commit is the final documentation SHA, not the implementation SHA. Final local/upstream/remote equality is checked after push and recorded in the private delivery receipt and final response; a commit cannot contain its own literal SHA.

Only seven implementation files changed: the opt-in npm entry, three library modules, CLI, neutral tests and usage documentation. Existing recognition, VAD, timestamp/assembly code, lockfile, defaults and Skills 1/2/3 were not changed. No tag, release, npm publication or default-branch merge is involved.

The prompt reports that a later independent audit confirmed the previous 17 serialized-only IDs. This run preserves that statement as **user-provided provenance**, not a newly performed independent audit. The named independent review/audit files were not present in the supplied attachment location, checked repository or supplied diagnostics archive. The older report's missing-audit history is not overwritten. The existing frozen timing diagnostics were directly verified instead.

## Real immutable inputs and unchanged artifacts

Read-only `readEvidence` and `verifyRevision` validated original plan, raw collection, request ledger, original freeze and strict diagnostic revision. Historical absolute model/media paths were not followed. Real CLI operations ran with process-start and HTTP/fetch APIs explicitly denied by a local guard.

| Binding                    | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| Original plan              | `7d41fe15439ab133c78355ebe647cdd6c98638f023c48dcd39220dac482bf912` |
| Original results freeze    | `271b67751dd5c6437f45a953168ab86df1813148a9cd8f8d10d92efd5486dcc4` |
| Original raw collection    | `94269de82a2f774b98b58c55bf33a1c4bff283a54cd72ac2c2cc65268d71afd8` |
| Strict diagnostic identity | `071061a25c3ec6763ac4175146f19c9911d9c3a47d6b8ca3a36e2553be9fa88b` |
| Reconstructed source PCM   | `6bd772cda01d11929bdb153a412330d88c6c7761fe8dd1bd9f35e52da7a47644` |

Before/after inventories of **559 protected files/symlink records** matched exactly. These cover both old experiment directories, the prior diagnostics output tree, old CSVs/freezes/partials/WAVs and both earlier ZIPs. Symlinks were recorded without following them. The old ZIP SHA-256 values remain:

- Historical experiment/code ZIP: `2f4c0485b9865f0cb05695d688dad3cd8c7dfd104132b77c8df1b9227ec523de`.
- Timestamp-diagnostics code/output ZIP: `8b22159eaa86a1861ced2e1378151d27fab7547047895831f81441a7ed3bd8d4`.

Directly reread counts remain A: 102 raw, 16 raw-invalid, 86 retained; B: 158 raw, **3 raw-invalid + 17 serialized-only invalid**, 138 retained and 20 unresolved. The B 438-code-point repetition remains full text and is linked to its existing targeted request; no extra clip or correction was generated for it. No subtitle text/timing was modified to change these counts.

## Listening plan and source audio

The main plan is byte-identical to the strict revision's original-full-raw plan: **12 stratified + 36 seam = 48**, retaining cohort, IDs and original evaluation intervals. No 15-second or seam target was rounded, shifted or replaced. Five targeted cases are additional and separately counted:

- Three B raw-invalid full request spans, including the long repetition's existing request.
- Two A invalid-start clusters, grouped by fixed minimum start rather than transitive chaining, with bounded localization context.
- No targeted budget exclusions on this dataset. Other timing/text risks remain indexed without extra audio targets.

All **37/37 saved request WAVs** matched reserved WAV SHA-256, chunk PCM SHA-256, planned frames, 16 kHz, PCM16 and mono. The disjoint core partition covers exactly **14,400,171 source frames** once. Its incremental SHA-256 matches the original PCM. No complete reconstructed source WAV was written; no source media extraction, resampling, normalization, silence removal or repeated context concatenation occurred.

| Derived listening measurement         |                                                  Value |
| ------------------------------------- | -----------------------------------------------------: |
| Main / targeted / total clips         |                                            48 / 5 / 53 |
| Derived samples (summed across clips) |                                              8,310,860 |
| Summed playback seconds               |                                              519.42875 |
| Unique source seconds exported        |                                             453.580125 |
| Limits                                | 8 targeted, 32 s each targeted, 56 clips, 600 s summed |
| Request authentication                |                                           37/37 passed |
| Reread PCM sample comparison          |                    Every sample in all 53 files passed |

Clip maps preserve exact ceil/ceil evaluation support, enclosing floor/ceil playback bounds, original source seconds, rounding deltas, source chunk/local sample pieces and clip-relative evaluation positions. Source-boundary clipping affects only physical playback context, never a subtitle or saved evaluation timestamp.

Playback verification method: **WAV structure, sample count, file/PCM hashes and independent per-segment byte comparison by software**. Browser playback was **not performed**; there is no claim of human listening. The HTML uses native local audio controls. A relocated bundle was verified, with **188 files, 38 unchanged full raw request SRTs, 524 relative references, zero broken references and zero script tags**. Raw JSON, full request pages, original/strict dispositions and stored timing/text risks remain available. Empty or unlocalized candidates are explicitly not silence/missing-speech conclusions.

## Actual annotations and results

No completed real human annotations were supplied. The new mutable CSV was initialized exclusively once, and its bytes were preserved across verify, summarize and prepare reuse. Its SHA-256 is `991d968b537e06db8540a864ca90095441cb7bd0103e590cf1194866551cb9d2`.

| Group      | Planned | Not performed | In progress | Reviewed | Unjudgeable | Invalid/missing |
| ---------- | ------: | ------------: | ----------: | -------: | ----------: | --------------: |
| Stratified |      12 |            12 |           0 |        0 |           0 |               0 |
| Seam       |      36 |            36 |           0 |        0 |           0 |               0 |
| Targeted   |       5 |             5 |           0 |        0 |           0 |               0 |

All comparison and paired-criterion denominators are 0. Reviewed evaluation sample union is 0. The explicit summary read **one initial annotation CSV** and recorded zero human-declared reviewed items. This counter concerns explicitly parsed new annotation input, not historical evidence hashing. Summary exit **2** correctly means awaiting human review, not a failure to prepare the handoff.

Synthetic annotations exercised positive, negative, unjudgeable and full-completion cases only in neutral temporary fixtures. They are not in the real mutable CSV or delivered real summary. Even a valid complete synthetic CSV does not grant `humanValidated` or release authority. The software has no listening-proof claim or automatic winner.

## Zero new recognition and mutation operations

Each of the following was **0** for this task's production handoff: `newASRRequests`, `newASRInference`, `newVADDispatches`, `newVADInference`, `newModelLoads`, `newProviderStarts`, `newSourceMediaExtractions`, `newASRAudioWindows`, `newExternalReferenceSearches`, `subtitleTextMutations`, `subtitleTimingMutations`. `productDefaultChanged=false`. Derived listening WAVs are counted separately above; historical 37-request inference is not billed or reported as a new operation.

## Current validation, not inherited counts

Final validation used **Node v24.19.0 / npm 11.18.0** and the unchanged lockfile. Earlier development smoke checks are not added to these totals.

| Command                                                                                                                                                                                 | Result                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `npm run typecheck`                                                                                                                                                                     | exit 0                               |
| `npm run lint`                                                                                                                                                                          | exit 0                               |
| `npm run format:check`                                                                                                                                                                  | exit 0                               |
| `npm run build:subtitle-tool`                                                                                                                                                           | exit 0                               |
| `node --test tests/bounded-content-review.mjs tests/bounded-timestamp-diagnostics.mjs tests/bounded-longform-flow.mjs`                                                                  | 44 passed, 0 failed/skipped          |
| `node node_modules/vitest/vitest.mjs run tests/bounded-longform.test.ts tests/subtitle-tool.test.ts tests/subtitle-recovery.test.ts tests/e2e/subtitle-recovery.test.ts --maxWorkers=2` | 72 passed, 4 files, 0 failed/skipped |

**116 distinct test executions passed** in the final run: 20 new content-review tests, 15 existing diagnostics tests, 9 existing offline-flow tests and 72 focused Vitest tests. Bundle/freeze schema validation is part of new tests and every real verify. The older FFmpeg-launching `tests/e2e/subtitle-tool.test.ts`, real model tests and unrelated research suites were deliberately not run. No previous “96 passed” total is copied into this result.

Tests include independent integer-sample oracle, nonzero offset and fractional sample boundaries, cross-core context removal, hash/missing/symlink failures, no access to removed historical model/full-source paths, process denial, HTML escaping and full long text, proper CSV quoting, unknown columns, foreign/duplicate IDs, missing declarations, invalid dates, paired denominators, unjudgeable results, immutable annotation snapshots, preserved/deleted mutable CSV, relocated verification, corrupt identity refusal, cancellation and concurrent writers.

## Real commands and immutable delivery identities

The real driver invoked `node --import <local-deny-runtime-guard> scripts/subtitle-tool-bounded-content-review.mjs` with the commands below. Exact private paths and stdout/exit receipts are retained only in the private output tree. Equivalent npm usage is in [BOUNDED_CONTENT_REVIEW.md](BOUNDED_CONTENT_REVIEW.md).

| Operation                                                             | Exit | Result                                          |
| --------------------------------------------------------------------- | ---: | ----------------------------------------------- |
| `prepare --manifest … --diagnostics … --audio-root … --output-root …` |    0 | Metadata-only, 0 listening files                |
| Same prepare with `--export-listening-audio`                          |    0 | 53 verified files; LISTENING_HANDOFF_READY      |
| `verify --bundle …`                                                   |    0 | Frozen files/audio/maps passed                  |
| `summarize --bundle … --annotations … --output-root …`                |    2 | Valid initial CSV, all 53 awaiting human review |
| Identical audio prepare                                               |    0 | Reused identity; CSV unchanged                  |
| Relocated bundle verify                                               |    0 | Passed without original-path access             |

- Listening bundle: `bundle-cb5c5380919f2c2a4373b68d3c2a8354e91867b42d0d13fbef52d27552c541b5`.
- Initial summary: `summary-57852ffea38beb53ba06648e407338627d6d04d615198c722b765e6aff7f6344`.
- Start page: bundle-relative `listening-index.html`; mutable input: `review/content-review.csv`.
- Private ZIP: `PRIVATE-bounded-content-review-cb5c5380-20260910.zip`, **14,434,121 bytes**.
- ZIP SHA-256: `213903f18b9a2ba2cfe866f0d3733e607614086a6d0a8fe6ae8faca57f652f2c`.

The ZIP contains only the private listening bundle, initial immutable summary and privacy guide. `unzip -tq`, fresh extraction and recursive byte comparison passed. It excludes original video, the full 37 request WAVs, models, credentials, fonts, dependency trees and research caches. **PRIVATE / NOT FOR PUBLIC DISTRIBUTION** is prominently stated; archive validity is not subtitle-quality approval.

The scoped task stops here: the user can listen, record their own observations and explicitly summarize them. No new ASR experiment, timing repair, automatic annotation or release decision follows from this handoff.
