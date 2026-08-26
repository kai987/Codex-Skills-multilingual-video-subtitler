# C5.19 Series Language Memory — Real-Data Acceptance Report

Acceptance result: **passed**. C5.19 adds deterministic, auditable Series-level terminology, proper-noun, pronunciation, acoustic-alias, dialect, and correction memory without changing Canonical text or timing. The accepted final state remains `needs-review` with `finalizationMethod: none` and seven Review Items.

## 1. Branch

`codex/c5-19-series-language-memory`.

## 2. Baseline Commit

`06e50dc2ff8f24e86d72ff3805151ed6c145bd2c` (`docs: record C5.18.1 real CTC acceptance`). The branch was created from this exact commit, not from `main` or the earlier C5.18 state.

## 3. C5.18.1 Baseline

The accepted Fresh v4 task supplied 192 Canonical cues, seven Review Items, 14/16 CTC-encodable targets, zero CTC timing actions, zero Canonical text/timing mutations, and final state `needs-review` / `none`. C5.19 did not modify the C5.18.1 runtime, algorithm, artifacts, or seven unresolved timing components.

## 4. C5.19 Goal

Provide reusable Series-level language evidence for names, terms, readings, dialect surfaces, acoustic aliases, and prior corrections. Memory is a ranking/pronunciation prior and never Ground Truth Authority.

## 5. Non-goals

No C6.0 finalization policy, new ASR, NER, embedding, dialect classifier, LLM, Speaker, MFA, Whisper, whole-media CTC, whole-media ASR, web lookup, or automatic Canonical text/timing change was implemented.

## 6. Existing `terminology.ts` Audit

The existing terminology pipeline remains the compatibility layer. Its `globalReplacementEnabled: false` invariant is retained. C5.19 extends its evidence into deterministic Series Memory candidates and rankings; it does not introduce a competing terminology-replacement pipeline. Existing `TerminologyEvidence` remains readable, Series Memory becomes the persistent/evidenced representation, and global replacement stays disabled.

## 7. Correction Feedback Audit

Strict `correction-feedback.json` remains the only automatic source for machine-wrong/human-correct pairs. C5.19 deduplicates corrections, records observed wrong forms, quarantines one-to-many ambiguity, and never performs global replacement. This baseline contains no correction-feedback artifact, so the real run correctly reports zero Correction Memory entries; the behavior is covered by unit tests.

## 8. Series Identity

Verified identity:

- `seriesKey`: `series-a4c5c45ed6f623cccad04104`
- title / normalized title: `カーネーション`
- season: `1`; year: unavailable
- media type: `series`
- source: `explicit-series-task`
- status: `verified`
- Episode number is explicitly excluded from the Series key.

The deterministic key includes normalized Series identity and prevents cross-Series reuse. Missing or conflicting identity fails closed to Episode scope.

## 9. Episode Identity

The accepted episode is `episode-8124fa8e22f2544ced5e5d8a`. Episode identity combines Series key, episode number, and source fingerprint while remaining outside the Series key itself.

## 10. Memory Scope

Supported modes are `episode`, `season`, and `series`. The acceptance run uses `series` only because explicit Series verification succeeded; C5.19 implements no global cross-Series scope.

## 11. Memory Schema

`series-language-memory.json` is strict and contains Series identity, configuration, parent hash, revision, ordered entries, conflicts, statistics, and a deterministic Memory hash. Related observations, delta, evidence, ranking, projection, CTC, causal, quality, replay, and validation artifacts also have strict schemas.

## 12. Entry Identity

Entry IDs are stable hashes of Series key, entry type, Canonical surface, and reading identity. This keeps ordering independent and distinguishes homographs with different readings.

## 13. Canonical Surface

Canonical surfaces preserve NFC text exactly as accepted. They are never rewritten from lookup keys, readings, aliases, or dialect equivalents. `canonicalPreservation` is enforced through the entry preservation policy.

## 14. Lookup Key

NFKC lookup keys are comparison-only. They improve deterministic matching without changing displayed Canonical text or dialect surface forms.

## 15. Proper-Noun Extraction

Extraction accepts verified Sudachi proper-noun POS, human correction evidence, existing terminology evidence, repeated Canonical compounds, and stable evidence. The real Memory contains two proper-noun entries.

## 16. Terminology Extraction

Repeated, sufficiently specific Canonical noun/term observations are promoted with provenance. Particles, auxiliaries, punctuation, isolated weak common nouns, and low-information candidates are rejected. The real Memory contains 65 terminology entries.

## 17. Common-Word Guard

Candidate length, POS, occurrence, source trust, and stop-class guards prevent Memory explosion. The 30-entry quality sample reports zero likely-common-word entries and zero unresolved types.

## 18. Dialect Detection

Dialect detection uses deterministic surface patterns plus provenance and recurrence. It records region/status/pattern/marker/standard-equivalent metadata without asserting an unsupported standard form.

## 19. Dialect Preservation

Dialect candidates are preserved as observed Canonical surfaces. Memory can rank an exact dialect form but cannot standardize it. Real result: five preserved dialect entries and zero standardization attempts.

## 20. Correction Memory

Correction entries require an explicit, hash-bound machine/human pair. They retain both forms and provenance and remain suggestion/ranking evidence. Real count is zero because the accepted input had no correction-feedback artifact.

## 21. Wrong Forms

Observed wrong forms are usable only when they map unambiguously to a currently present candidate. A wrong form that maps to multiple Canonical entries is quarantined; absence of a Canonical candidate cannot fabricate one.

## 22. Reading

Reading priority is human/curated, verified C5.17 pronunciation, Sudachi dictionary, verified G2P, then unresolved. Readings are stored separately in hiragana/katakana form and never overwrite Canonical text.

## 23. Pronunciation

C5.19 reuses the accepted C5.17 `subtitle-canonical-pronunciation.json`. The real Memory contains 23 pronunciation-bearing entries. No MFA or G2P process was rerun.

## 24. Acoustic Alias

Ten verified acoustic aliases were materialized with source artifact hashes, entry/evidence IDs, trust, and alias type. Aliases assist matching/alignment only and cannot alter display text.

## 25. `水茄子` Case

The real entry is `series-memory-entry-00cef15109109e79f16e7402`:

- Canonical surface: `水茄子`
- reading: `みずなす` / `ミズナス`
- phones: `mʲ i z ɨ n a s ɨ`
- acoustic alias: `みずなす`
- preservation policy: `preserve-canonical-surface`
- two occurrence IDs and evidence from Canonical, Sudachi, and MFA-dictionary artifacts.

## 26. CTC Projection

Pronunciation projection maps exact Canonical spans to verified readings in an alignment-only text. It handles repeated and overlapping terms deterministically and records span provenance and a semantic hash. Canonical text remains byte-identical.

## 27. CTC Encodability Before

The accepted C5.18.1 target audit reports 14 encodable and two unencodable cues because `茄` mapped to `<unk>`.

## 28. CTC Encodability After

Projection to `みずなす` makes 16/16 targets representable and rescues both previously unencodable cues. Canonical mutation count remains zero.

## 29. Targeted CTC Observe

Exactly four real attempts were executed once: two `水茄子` cues × narrow/expanded windows. All four were encodable and path-successful; inference count was four, cache hits zero, timing mutations zero. Runtime identity was `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`, model snapshot `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`, device `cpu`. The strict observation was reused for final Node 24 materialization, so no extra model run occurred.

## 30. Candidate Ranking

Memory evaluates only candidates already present in each current cue pool. Bootstrap/Frozen each evaluated 50 cue pools and changed ten deterministic orderings; Causal evaluated 50 and changed eight. No candidate was fabricated and no association class was promoted.

## 31. Tie-break Policy

Memory applies only inside the same association class when the base-score difference is at most `0.05`. Larger acoustic/base-score differences retain their original winner.

## 32. Acoustic Priority

Direct localized acoustic evidence outranks Memory. Real `memoryAcousticOverrideViolationCount` is zero in all runs.

## 33. Memory Trust

Trust levels are ordered from human-corrected/reviewed through validated/repeated evidence to single/candidate-only evidence. Unverified and ambiguous entries cannot drive ranking or pronunciation application.

## 34. Evidence Lineage

Every accepted observation records evidence ID, lineage ID, episode/cue/occurrence, source type, source artifact hash, observed surface/reading, time, and semantic hash. Independent source families remain distinguishable.

## 35. Conflict Handling

Conflicts are explicit data, not silent overwrite. Incompatible aliases/readings are quarantined and excluded from application. The real run reports zero active conflicts.

## 36. Alias Conflict

An alias mapping to multiple incompatible Canonical entries becomes ambiguous. Real ambiguous alias count is zero; ambiguity/quarantine behavior is unit-tested.

## 37. Reading Conflict

Incompatible readings for the same entry identity are preserved as conflicts and block application. Real conflicted-reading count is zero.

## 38. Homographs

Reading participates in identity, so identical surfaces with different readings remain separate entries. Homograph lookup does not merge or overwrite them.

## 39. Promotion

Promotion requires trusted source evidence or repeated verified occurrences. Human correction can promote once; weak candidate-only observations remain candidates. Bootstrap/Causal promoted 72 entries; Frozen promoted zero by design.

## 40. Memory Merge

Merge order is deterministic, evidence/occurrences are deduplicated, parent and revision hashes are preserved, and conflicts are explicit. Bootstrap, Causal, and Frozen converge on Memory hash `b16bc7ae8793e91917575b734a4c9b3206758125a4aaadf12282f790ed832874`.

## 41. Idempotency

Re-promoting and merging the same observations produces the identical Memory hash in all three runs. `idempotentMergePassed = 1`.

## 42. Revision Chain

Memory records parent hash and deterministic revision metadata. Frozen replay reads the accepted snapshot without adding a new learned entry.

## 43. Atomic Write

Persistent writes use a same-directory temporary file, file sync, atomic rename, and directory sync. Partial writes cannot become the active Memory snapshot.

## 44. Locking

Store writes acquire an exclusive lock with bounded retry/stale-lock handling. A concurrent writer cannot silently interleave a Memory revision.

## 45. Bootstrap

The real Bootstrap learned from the current verified Canonical/pronunciation artifacts: 192 cues, 72 candidates, 72 promoted entries, 13 pronunciation projections, four bounded CTC observations, seven Review Items retained, and no Canonical/timing mutation.

## 46. Causal Replay

The real Causal replay started empty and evaluated each cue before learning it. It produced 66 prior-cue Memory matches, the same final 72-entry Memory hash, eight ranking changes, and no same/future leak.

## 47. Same-Cue Guard

Current-cue observations are not available during that cue's ranking. `sameCueMemoryLeakCount = 0`.

## 48. Future-Cue Guard

Stable cue ordering prevents later observations from affecting earlier rankings. `futureCueMemoryLeakCount = 0`; cross-Series leak is also zero.

## 49. Frozen Replay

The Frozen replay imported the Bootstrap snapshot read-only, promoted zero entries, matched 72 Memory entries, executed zero CTC inference, retained the same Memory hash, and preserved all Canonical/final state invariants.

## 50. Counterfactual Ranking

Every ranking audit records before/after winner, base and Memory-assisted scores, association class, matched Memory evidence, and whether the expected Canonical form improved. No ungrounded “correction” is claimed.

## 51. Regression Count

Bootstrap, Causal, and Frozen each report `memoryRankingRegressionCount = 0`. Corrected count is also zero because the available candidate pools did not provide a ground-truth counterfactual correction; changed counts are evidence-only deterministic reorderings.

## 52. Dialect Preservation Result

Five dialect entries were preserved, zero standardization attempts occurred, and Canonical display surfaces remained unchanged.

## 53. Memory Entry Counts

Real Bootstrap/Frozen snapshot: 72 entries = 2 proper nouns + 65 terminology + 5 dialect + 0 correction entries. Twenty-three entries carry pronunciation and ten verified acoustic aliases; ambiguous aliases and reading conflicts are both zero.

## 54. Quality Audit

`series-memory-quality-audit.json` sampled 30 entries. Results: likely common words `0`, unresolved types `0`, conflicts `0`, manual-review suggestions `0`, `qualityPassed = true`.

## 55. False Positives

No sampled particle, auxiliary, punctuation-only, or weak single common noun polluted the active Memory. Duplicate Memory evidence and prevented double-count metrics are both zero because no duplicate was present; duplicate prevention itself is covered by replay tests.

## 56. Review UI

The static Review UI exposes Series Memory evidence, ranking, and pronunciation sidecars and displays the exact warnings “Memory is prior evidence only.” and “It does not independently prove the subtitle text.” It never presents Memory as proof or auto-resolves an item.

## 57. Review Delivery

All three runs pass Review Delivery Integrity with seven of seven WAVs playable and seven Review Items retained. `deliveryVersion = C5.17.2` identifies the reused Review Delivery subsystem contract; it does not label the C5.19 Memory version.

## 58. Shareable

Bootstrap, Causal, and Frozen each produced 41/41 schema-valid shareable JSON artifacts. All three audits report absolute-path leaks `0`, prohibited secrets `0`, and broken relative references `0`. Audio, caches, model/runtime paths, tokens, logits, tensors, and private source paths are excluded.

## 59. Canonical Hash

All runs preserve `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`; Canonical text mutation count is zero.

## 60. Timing Hash

All runs preserve `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`; timing mutation and Memory-assisted CTC timing mutation counts are zero.

## 61. Presentation Hash

All runs preserve `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`. C5.19 adds no presentation mutation.

## 62. Skill 2

Read-only compatibility repo HEAD `1af10bd8a7057c573959f39a745436fa837127ea` passed Node 24 typecheck/build. Its strict schemas parsed the C5.19 package at 192 cues and the unchanged validated report at 106 sentences / 106 grammar points. The repo remained clean.

## 63. Skill 3

Read-only compatibility repo HEAD `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8` passed typecheck, one test, build, and an actual learning-site build from the Skill 2 report. The generated site's report copy is byte-identical; the repo remained clean.

## 64. Tests

Node `v24.19.0`, npm `11.18.0`: `npm test` passed 516 tests in 33 files, with two intentional skips. C5.19 targeted unit/E2E selection passed 32/32 tests. Typecheck, lint, format check, and build passed.

## 65. E2E

`npm run test:e2e` passed 27 tests in ten files, with one intentional skip. The C5.19 E2E covers Canonical → observations → Memory → ranking → projection → Review UI → shareable-safe sidecars.

## 66. Schemas

`npm run generate:schemas` generated 120 strict JSON Schemas. All real C5.19 artifacts, Review packages, finalization reports, and shareable manifests validated.

## 67. Input Read-only

Post-run verification matched the required source identities:

- video: 847,774,958 bytes; SHA-256 `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- human-reviewed ASS: 17,094 bytes; SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`

The replay additionally checks accepted Canonical/alignment/pronunciation file hashes before and after each run.

## 68. Network

`networkUsed = false` for Bootstrap, Causal, Frozen, and targeted CTC observation. No web search, OpenAI/LLM, online dictionary, model download, or external API was used.

## 69. Remaining Problems

Seven timing/overlap Review Items remain unresolved by design. C5.19 provides prior language evidence but cannot prove subtitle timing, eliminate those Review Items, or claim automatic finalization. Correction Memory count is zero because this accepted task had no correction-feedback input, and counterfactual corrected count is zero because no demonstrably wrong current winner was available.

## 70. Whether C6.0 Investigation Can Start

Yes: C5.19 is sufficiently implemented and accepted to begin a separate **C6.0 investigation** into default finalization policy. No C6.0 implementation was started. The investigation must preserve the seven evidence-limited reviews rather than weakening gates to force zero Review Items.

## 71. Git Commits

- `91ad01f9403d03b037ef21a7a7a2747ecf445d7b` — `feat: add C5.19 series language memory`
- `e363a379bd66d692237101fd14c2fe56921fc813` — `feat: integrate series memory evidence into review workflow`
- `docs: record C5.19 real-data acceptance` — the commit containing this report.

## 72. Remote HEAD

After delivery, `origin/codex/c5-19-series-language-memory` must resolve to the acceptance-report commit containing this document. The exact immutable SHA is reported in the final delivery response after push verification.

## 73. Output Paths

- Bootstrap: `<Codex-Skills>/output/carnation-reference-guided-c5-19-series-memory-bootstrap-20260827`
- Causal Replay: `<Codex-Skills>/output/carnation-reference-guided-c5-19-series-memory-causal-replay-20260827`
- Frozen Replay: `<Codex-Skills>/output/carnation-reference-guided-c5-19-series-memory-frozen-replay-20260827`
- Memory snapshot: `Bootstrap/subtitle-*/series-language-memory.json`
- Joint validation: `Bootstrap/c5-19-run-validation.json`
- This report: `C5_19_SERIES_LANGUAGE_MEMORY_REPORT.md`

Final acceptance: C5.19 real-data acceptance passed; `Review 7 → 7`, `status = needs-review`, `finalizationMethod = none`.
