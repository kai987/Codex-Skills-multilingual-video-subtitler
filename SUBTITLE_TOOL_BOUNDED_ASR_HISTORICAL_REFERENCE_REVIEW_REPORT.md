# Historical Human-Reviewed Reference Comparison & Review Usability Patch

## Outcome and limits

Implementation and real **offline** acceptance passed. The new private artifact is `REFERENCE_ASSISTED_HANDOFF_READY` and `RAW_REFERENCE_COMPARISON_READY`, while content evaluation remains **AWAITING_HUMAN_REVIEW**. All 53 current items remain NOT_PERFORMED / referenceUse NOT_DECLARED. There is no automatic A/B winner, new human certification or subtitle release.

The requested browser smoke was attempted on an isolated relocated `file://` copy. The browser URL policy rejected navigation before rendering. No alternate browser, localhost server, security-setting change or indirect execution was used. Browser rendering, details interaction, audio playback and console inspection are therefore **not verified**. This limitation is not hidden behind successful static/file checks.

## Source and scope

- Repository: `kai987/Codex-Skills-multilingual-video-subtitler`.
- Required base: `76f0b8b19b9ae4efb3460f717edc84125cf7bacf`.
- Previous implementation: `7fc06d3540bbb4f33a0546bfe883cb32abb4a90f`.
- Independent branch: `codex/subtitle-tool-bounded-asr-historical-reference-review`.
- New implementation commit: `2b707c847b398935470fe779faac1305e071f87e`.
- This report is a separate documentation commit. Its containing commit is the documentation SHA, not the implementation SHA. Final local/upstream/remote equality is recorded after push in the private receipt and final response; a commit cannot contain its own literal SHA.

The base worktree was clean and its remote branch matched the requested base. A new worktree/branch was created without switching, pulling, stashing, resetting, cleaning or modifying another worktree. Changes are confined to the opt-in content-review CLI, its pure evidence/parser/comparison/CSV/static-page modules, neutral tests and documentation. Existing ASR/VAD, timing recovery, assembly/deduplication, G11, formatter, model configuration, package lock, defaults and Skill 1/2/3 files were not modified. Skill 1's preservation and release boundaries were retained; no transcription workflow was invoked.

## Input availability and provenance

The named small supplemental pack and independent-review Markdown file were not available in the attachment/Downloads locations checked. Rather than invent their contents, the explicitly named old C5.13R.3 archive was used as the permitted fallback. Only the original ASS and three necessary provenance JSON members were extracted; no historical review audio was imported. The original saved experiment JSON supplied the machine source binding.

A local `REFERENCE_INPUTS.json` was generated from these extracted original bytes under the documented strict inventory schema. It is **a byte inventory, not a newly supplied human signature or approval**. CR-01/CR-02 were verified in actual source and tested; the absent independent review was not represented as newly read. The older report's no-reference/no-review execution history remains unchanged.

| Binding                           | SHA-256 / observed value                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| Selected original ASS             | `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e` |
| ASS bytes / Dialogue records      | 17,094 / 192                                                       |
| Original human base package bytes | `3ef7f6eb20aa9167e140a1eac257b0535749c19722570dc8f6a761840666c167` |
| Historical finalization report    | `6312e0d19a8b3f3b4f7e98eb076885a8144343ab8ef35db3727236832b1d77ec` |
| Historical review package         | `fccb0422349e1c39b4551b9e870bef2a7d08ac4edbf9963da193ba368d1f69d3` |
| Original experiment bytes         | `eb212ae685de1ddd050b8a01c4cca7cacc9587bbe526d2795950d51f5696ffea` |
| Saved source media identity       | `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` |
| Saved source PCM identity         | `6bd772cda01d11929bdb153a412330d88c6c7761fe8dd1bd9f35e52da7a47644` |
| Original experiment plan          | `7d41fe15439ab133c78355ebe647cdd6c98638f023c48dcd39220dac482bf912` |
| Parent listening bundle           | `cb5c5380919f2c2a4373b68d3c2a8354e91867b42d0d13fbef52d27552c541b5` |
| Parent code/output ZIP            | `a8914b76602e17bb6eda839a83c03e824f230138369d1d413e14c36dbc48b56d` |

The ASS bytes match the local inventory and historical finalization's source hash/size. Both finalization and review-package base hashes match the actual base JSON bytes. **192/192** records match historical base visible text, timing and style under the legacy import cleaner used only for binding. The review media SHA equals the saved experiment source SHA; experiment bytes, plan, PCM and offset match the frozen parent. Filename suffixes, dates, sizes and record counts alone do not choose a reference. No real-media hash blacklist appears in runtime logic.

These are **saved identity checks**, not a new source-video read, not a full 192-record listening pass, and not verification of current acoustic truth. Historical authority remains `user-confirmed-human-review`. Historical package `ready` is reported separately from finalization **needs-review / none** and its **33 additional review items**. Those 33 items are not current progress.

Reference flags remain: `historical-human-reviewed-reference`, completeness/acoustic correctness `NOT_REVERIFIED`, `referenceIsValidatedGold=false`, `currentReviewCompletedByReferenceImport=false`.

## ASS handling and immutable parent projection

The original ASS is stored unchanged, including sections, comments, order, style and override syntax. Observed counts are **Default182 / Music10**. One Format-bound clock repair is recorded only in memory: source line 54, End `0:01:57,35` → `0:01:57.35` (117.35 seconds). No global comma replacement or text editing occurred. The parser preserves raw line and raw-to-visible code-point spans; unparseable or uncertain text remains explicit rather than silently discarded.

The canonical import cleaner is used solely to verify historical cue correspondence. Full-string diagnostics instead retain literal visible whitespace, line breaks and punctuation; ASS `\N`/`\n` become newline and `\h` becomes space, with known overrides removed. Unknown drawing/interpretation makes the comparison non-computable rather than losing text unnoticed.

**181 parent files** (raw, plans, items and audio maps/WAVs) were copied and compared byte-for-byte. The original main 48 items remain **12 stratified + 36 seam**, with the same five targeted items. IDs, intervals, sample bounds, candidate memberships, reasons and order are unchanged. Reference associations live in a separate map; they use only source-time overlap, distinguish evaluation/context-only, keep long records whole and never reapply chunk offsets. No per-item numerical CER is produced.

| Preserved measurement                                           |              Observed |
| --------------------------------------------------------------- | --------------------: |
| A raw / raw-invalid / strict retained                           |         102 / 16 / 86 |
| B raw / raw-invalid / serialized-only invalid / strict retained |    158 / 3 / 17 / 138 |
| B unresolved total / longest raw text code points               |              20 / 438 |
| Copied listening WAVs                                           |                    53 |
| Copied WAV bytes                                                |            16,624,052 |
| Summed PCM samples / seconds                                    | 8,310,860 / 519.42875 |
| New listening clip generations                                  |                     0 |

Every copied WAV was reread for structure, frames, WAV/PCM hashes and comparison to the old file; copy inodes differ, proving ordinary copies rather than hardlinks. There was no header rewrite, resampling, synthesis or reslicing. Before/after protection inventories of **1,427 files/symlink records** matched exactly, covering original experiment/diagnostics/current parent outputs, old CSVs/summaries/freezes/WAVs, the parent ZIP, old C5 archive and resolved inputs.

## Actual full raw-to-reference computation

A uses all 102 raw records in response order. B uses all 158 in frozen chunk/request order, including invalid times, overlap/context repetitions and the 438-character record. R uses all 192 original Dialogue records including Music. Records join with the empty string; display repetition across 53 items does not inflate the input. Each code point carries record ID and local position.

| Machine / reference | Policy             |    M |   S |    D |   I |    N | Machine length | Distance | rawReferenceEditRatio |
| ------------------- | ------------------ | ---: | --: | ---: | --: | ---: | -------------: | -------: | --------------------: |
| A / R               | exact-visible-v1   |  466 | 649 | 1172 |  37 | 2287 |           1152 |     1858 |    0.8124180148666376 |
| A / R               | whitespace-only-v1 |  462 | 644 | 1047 |  45 | 2153 |           1151 |     1736 |    0.8063167673014399 |
| B / R               | exact-visible-v1   | 1449 | 442 |  396 | 581 | 2287 |           2472 |     1419 |    0.6204634892872759 |
| B / R               | whitespace-only-v1 | 1437 | 398 |  318 | 575 | 2153 |           2410 |     1291 |    0.5996284254528564 |

Direction is R→machine; deterministic reverse traceback priority is match → substitution → deletion → insertion. All four calculations passed M+S+D=N, M+S+I=machine length and S+D+I=distance. An independent two-row distance implementation reproduced every real distance, reconstructed both full streams from the stored edit paths and checked every provenance position. Neutral exhaustive short-string combinations also exercise optimality, ties, emoji and combining marks.

Stream SHA-256: R `ac428f525eda432579b6468702d2329fb3cf718588a447538675884a29cecf63`; A `034f5f712dcf18e8c50d3c7f49c60d2ed247c3e9d61ebd2ce85a0739e0b4741d`; B `7952305ffc49b1e29c6f089925e1211aa9ad880c31ecac7fa26f19b5d34dd991`.

`whitespace-only-v1` removes only its fixed Unicode White_Space set; it does not apply NFKC, case, punctuation, kana, dialect or repetition normalization. The DP cap is 25,000,000 cells and did not truncate this input. Empty reference, incomplete text and cap excess have tested null NOT_COMPUTABLE results; ratios above 1 are not capped.

These are **post-hoc FULL_RAW_TO_HISTORICAL_REFERENCE diagnostics**, not acoustic error categories, assembled subtitle CER, an automatic B-win verdict or quality approval. The reference is not revalidated Gold, B contains raw request overlap, and repeated-text edit locations can be ambiguous. No `1-ratio` accuracy, acceptance threshold, statistical significance or production CER replacement is reported.

## CSV, Japanese guide and actual review state

CR-01 is fixed: invalid CSV/rows → **1**; valid unfinished → **2**; valid completed → **0**. Invalid readable bytes receive an immutable annotation snapshot and validation report. Unknown columns remain warnings. All-UNJUDGEABLE completion may exit 0 without providing judgeable quality evidence. v1 columns remain unchanged; the v2 reference CSV adds referenceUse. Completed rows require a non-NOT_DECLARED reference declaration in addition to existing listening/date/interval/paired-criteria/notes checks. Reviewer name is still optional.

CR-02 is fixed through a self-contained Japanese generated guide: schema-derived enums/columns, source vs player seconds, timezone, quoting/formula cautions, exits, unjudgeable handling, and listen → notes → A/B → optional R order. Static HTML uses native audio and initially closed A/B/R details, escaped text and local links only. **697 relative HTML references**, zero broken links and zero script tags were checked from disk. These are static checks, not the blocked browser smoke.

| Group      | Planned | NOT_PERFORMED | IN_PROGRESS | REVIEWED | UNJUDGEABLE | Invalid/missing |
| ---------- | ------: | ------------: | ----------: | -------: | ----------: | --------------: |
| Stratified |      12 |            12 |           0 |        0 |           0 |               0 |
| Seam       |      36 |            36 |           0 |        0 |           0 |               0 |
| Targeted   |       5 |             5 |           0 |        0 |           0 |               0 |

All paired comparison denominators are **0**. Declared-listened and content-judgeable sample unions are both **0**. `referenceUse=NOT_DECLARED` remains in all 53 rows. No actual listened/time/reviewer/verdict values were synthesized. New CSV hash: `67332d1370e852621477929c3dcd81845071b5341c066adc62d9fd6b6f240b98`; old CSV unchanged: `991d968b537e06db8540a864ca90095441cb7bd0103e590cf1194866551cb9d2`.

## Operations and current validation

Construction consumed one distinct historical ASS, three historical provenance JSONs, one experiment and one byte index, parsed once and computed four policy/side comparisons; its materialization counters describe that construction scope. Verify, summarize and reuse intentionally reread/recompute. The six principal CLI receipts recorded respectively 5/4/2/2/2/2 ASS read calls and 12/9/6/6/6/6 historical-provenance JSON read calls (attach/reuse/portable verify/summary/summary reuse/verify), including integrity rereads. Thus reference reads are explicitly **not zero**. Two explicit summaries read the new initial annotation CSV; both still contain zero reviewed rows. The final ZIP verifier is an additional separately logged reread, not a new construction.

Production CLI child-process/HTTP/fetch capabilities were denied by a local guard. All observed prohibited process/network attempts were 0. New ASR requests/inference, VAD dispatch/inference, model loads, provider starts, source extraction, ASR audio windows, external reference search, subtitle text/timing mutations and listening clip generation were **0**. Product defaults were unchanged. Source/model absolute paths inside saved metadata were not followed.

Current final validation ran on implementation `2b707c8`, **Node v24.19.0 / npm 11.18.0**, with the unchanged lockfile:

| Command                                                                                                                                                                                 | Result                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `npm run typecheck`                                                                                                                                                                     | exit 0                                 |
| `npm run lint`                                                                                                                                                                          | exit 0                                 |
| `npm run format:check`                                                                                                                                                                  | exit 0                                 |
| `npm run build:subtitle-tool`                                                                                                                                                           | exit 0                                 |
| `node --test tests/historical-reference-review.mjs tests/bounded-content-review.mjs tests/bounded-timestamp-diagnostics.mjs tests/bounded-longform-flow.mjs`                            | 58 passed; 0 failed/skipped            |
| `node node_modules/vitest/vitest.mjs run tests/bounded-longform.test.ts tests/subtitle-tool.test.ts tests/subtitle-recovery.test.ts tests/e2e/subtitle-recovery.test.ts --maxWorkers=2` | 72 passed in 4 files; 0 failed/skipped |

**130 distinct test executions passed** in the final run. This is not the old inherited 116 total. Neutral tests cover provenance mismatches, same-size wrong references/renames, comma/Format handling, Music, uncertain drawing, Unicode/control/whitespace semantics, full-text order and optimal edit reconstruction, CSV validity and union semantics, mutable/deleted CSV preservation, immutable summary identity, safe paths/symlinks, ordinary copies, corrupt reuse refusal, concurrency/cancellation and injected write-failure cleanup with process/network denial. New bundle/index/freeze schema validation is exercised by tests and real commands. No real-model suite or FFmpeg-launching E2E was run.

Real `attach-reference`, `verify`, identical attach reuse and relocated verify all exited **0**. Initial summarize and summary reuse exited **2** with valid untouched annotations. No old prepare/ASR rerun was performed. Independent artifact checks and ZIP CRC/extraction/byte comparisons passed. Final ZIP-extracted bundle verification also passed independently of original input paths.

## Private delivery and final authority

- New bundle: `bundle-dbcfc2fffb1433f3e1afbe4d5b2941a4e9abb0aae5b5b6ee22c7aa8abbc3ceea`.
- New initial summary: `summary-3a973b324f2ac76ddd23f0dedd9084ab0b7b6fa63e05fb76898c3ac2fd792748`.
- Private output folder: `subtitle-tool-historical-reference-20260910-sA6qCB`.
- ZIP: `PRIVATE-bounded-historical-reference-review-2b707c8-20260910.zip`, **14,936,223 bytes**.
- ZIP SHA-256: `256477f7b6cefbecf6b288ade3f96a441d899e8aac1dc4f9d0aa9daec94cf14d`.

The ZIP contains the new reference bundle, initial summary, private guide and validation receipts; not the full video, all 37 request WAVs, models, credentials, dependencies, other runs or nested archives. Original provenance bytes may contain private local metadata; **PRIVATE / NOT FOR PUBLIC DISTRIBUTION** is intentional, not a claim of publicly sanitized shareability. Only source/tests/sanitized documentation are committed and pushed. No PR, tag, release, npm publication or default-branch merge is created.

Final gate remains **fullTimedExport blocked / qualityStatus needs-review / CER NOT_MEASURED / humanValidated false / finalizationMethod none / machineOnlyReleaseAuthorized false**. The software task stops at this handoff. Actual listening and review remain the user's work; the policy-blocked browser smoke is explicitly outstanding, without triggering any new ASR experiment or automatic annotation.
