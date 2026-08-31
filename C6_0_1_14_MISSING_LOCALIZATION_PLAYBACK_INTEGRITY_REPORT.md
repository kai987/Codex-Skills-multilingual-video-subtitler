# C6.0.1.14 Missing Localization & Playback Integrity Report

Completion date: 2026-08-31 (Asia/Tokyo). This closes the existing C6.0.1.14 working snapshot; it is not C6.0.1.15. Engineering acceptance: **PASS**. Evaluation integrity: **PASS**. Product route: **HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR**. Full Queue missing-dialogue audible coverage is **3/6**, not 6/6. Hallucination audible coverage is **1/1**. No new model inference was performed.

This repository report contains aggregate results and pseudonymous component labels. Full component identities, source intervals, audio, source paths, and Gold-linked evaluation details remain in LOCAL_ONLY output. The aggregate-only shareable summary is a separate, explicitly audited artifact. Git delivery identity is recorded after push in a separate receipt to avoid a self-referential commit hash.

## 1. Executive Conclusion

The unfinished snapshot was preserved and completed: strict contracts, orphan filtering, root-cause routing, source-global reconciliation, guard-aware re-localization, replay-only enforcement, localized lexical/Missing V3 materialization, target-grounded review audio, playback, independent Final A/B, and direct interval evaluation are implemented and tested. The inherited 64 valid probe results replayed with 64 hits, zero misses, zero model loads, zero provider process starts, and zero fresh inference.

The engineering result does not establish subtitle-quality readiness. All 292 known machine targets have complete playable delivery, but three of six Gold missing-dialogue components lack independently verified machine speech evidence. One of these has only partial context audio. Final missing audible recall fell from the old projections' 5/6 to 3/6; hallucination recall improved from 0/1 to 1/1. This negative result is retained, not hidden or repaired with Gold-derived targets.

Final status remains `needs-review`, `finalizationMethod=none`, `machineOnlyReleaseAuthorized=false`, and `C6.0.2=HOLD`. No new human trial, ranker training, OOF run, or C6.0.1.15 work was started.

## 2. Branch / Baseline

Repository: `kai987/Codex-Skills-multilingual-video-subtitler`. Branch: `codex/c6-0-1-14-missing-localization-eval-integrity`. Starting HEAD: `3d04a3350e57670aa363c934fb6e33043886a229`. The starting checkout matched the requested branch and commit and was dirty; no checkout, reset, clean, stash, or remote overwrite was used.

Machine baseline: 161 cues, 900.01 seconds, source audio stream 1, native 48,000 Hz, container audio timebase `1/1000`, source-global seconds. Base policy version is `c6.0.1.14-missing-localization-playback-integrity-v1`, hash `b014e858e7102191620a7a573b9394c73f6a56cca0adb7e684d3cf005e3487e5`. Completion policy version is `c6.0.1.14-completion-v1`, hash `ad02582d81e2d9efec461bdf06e3455ac791b5c5487e92f1e8f5bec6775aa036`.

## 3. Dirty Snapshot Preservation

The preflight recorded seven modified tracked files and 77 untracked files. All were treated as authoritative input. Across the 1,099 inventoried source files, 1,044 remained unchanged and 55 were intentionally modified in place; zero original files disappeared. These are pre-report snapshot counts, not the count of final Git changes.

All 273 inventoried original artifacts in 17 original output directories retained identical SHA-256, size, mtime, and inode. Historical failed outputs and the original snapshot ZIP were retained. `package-lock.json` was unchanged. Final runs and repeat validation use exclusive new output directories rather than overwriting the snapshot. Evidence: `snapshot-preservation-audit.local-only.json` and `completion-preflight.local-only.json` in the completion-audit directory listed in section 83.

## 4. Existing Probe Authorization Boundary

The one-time authorization is exhausted. Only exact, read-only replay of the 64 persisted valid requests is authorized in this closure. A different target, new context window, retry, provider process, model load, or cache miss cannot trigger inference. Shadow selections are non-executable future plans. Deterministic review WAV extraction and media inspection are not model inference and were permitted.

## 5. 66 Attempts vs 64 Valid Results

Historical consumed inference attempts: **66**. Planned unique requests: **64**. Valid persisted results: **64**, consisting of 32 Whisper and 32 Reazon results. Two earlier successful computations lost their output before persistence; the separately authorized two reruns completed those original requests. The current closure consumed **0** additional attempts. A 64-row result file must not be misreported as the total historical attempt count.

## 6. Replay-only Enforcement

`c60114-existing-probe-replay.ts` verifies exact request, provider, window, audio/runtime/model identity, cache key, and result semantics without instantiating an inference adapter. Cache miss or mismatch fails closed. The inherited runtime also refuses execution under the completion replay-only guard. The replay receipt records:

| Measure                              |  Result |
| ------------------------------------ | ------: |
| Expected requests                    |      64 |
| Cache hits / misses                  |  64 / 0 |
| Fresh inference / model loads        |   0 / 0 |
| Provider worker/process starts       |       0 |
| Whisper / Reazon cache hits          | 32 / 32 |
| Semantic parity with persisted Fresh |    true |

Receipt semantic hash: `a22b27cf8bc229af17c75fdaff7d1f60d1c35c20ba2dd9d96e02a8d552f0cfaf`.

## 7. P0 UNVERIFIED-orphan Bug

Replaying the old second-loop logic against the frozen baseline reproduced **1,354 UNVERIFIED audit entries incorrectly promoted to MACHINE_DETECTION_ORPHAN**. Although the old filter was unsafe for covered entries too, the actual 197 `COVERED_BY_CUE` and 26 `COVERED_BY_TARGET` entries were already skipped by the seen-island guard, so their observed incorrect promotion counts were **0 and 0**, not 197 and 26.

The new loop accepts only genuine orphan classifications with verified source-global provenance. UNVERIFIED, covered, and contradicted audit records cannot become positive orphan-dialogue rows. Actual incorrect promotions after repair are zero for all three classes. Synthetic tests cover the covered-entry cases that the current fixture's seen-island state happened to mask.

## 8. P0 Route Root-cause Bug

Route selection now reports the first unsupported link in the evidence chain: verified machine speech/orphan/localized evidence, required source-global provenance, review localization, then physical/playback delivery. Missing audio caused by missing speech evidence is not misdiagnosed as a mere audio extraction problem. Optional unverified hints do not veto an independently verified speech path; a genuinely required unverified transform still blocks that path.

Hallucination is evaluated separately: its current-cue audio can disprove the text without requiring a missing-speech or positive lexical observation. The evaluator no longer assigns missing-dialogue-specific diagnostic flags to hallucination components.

## 9. FULL_QUEUE vs ALL_MANDATORY Gate

`FULL_QUEUE` measures whether the available review system can deliver the relevant sound at all; `ALL_MANDATORY` measures the existing ranker's prioritization. The C6.0.1.14 readiness gate uses Full Queue missing 6/6 and hallucination 1/1, together with delivery/integrity requirements. Mandatory recall is a separate diagnostic, not an additional hidden version gate. Neither good mandatory ordering nor a fully delivered machine target inventory can compensate for missing Full Queue speech coverage.

## 10. Source-global Lineage Reconciliation

All 2,762 evidence entries were audited against source identity and existing parent/sample transforms. The procedure recomputes source-global coordinates from supplied provenance; it does not guess offsets or infer speech from a parent gap. It validates media binding, sample arithmetic, bounds, monotonicity, and retained timing/acoustic quality. A coordinate that can be added arithmetically is not automatically trustworthy lexical evidence.

Reconciliation semantic hash: `b8e272d003fa5925a6e59db303fbbdc5dc9e04520ca56f30a1fb4fdc65e048a3`. Source-global inference and coordinate-guess counts are both zero.

## 11. Verified / Quarantined Transform Counts

| Status                                         | Count |
| ---------------------------------------------- | ----: |
| Previously verified transform retained         |   929 |
| Newly verified from native parent/sample chain |   139 |
| Total verified                                 | 1,068 |
| Insufficient provenance, still quarantined     | 1,694 |
| Conflicting transform                          |     0 |
| Out of source bounds                           |     0 |
| Non-monotonic mapping                          |     0 |

The original quarantine had 1,833 entries; 139 were recovered and 1,694 remain. Final speech inventory has 25 child islands and 145 global islands, 33 unresolved parents, four too-short islands, and zero parent-gap-as-speech observations. The initial snapshot expected 148 global islands; the verified reconstruction yields 145, and that actual count is used rather than forcing the expected value.

## 12. Guard-contact-only Localizer

`CORE_CLEAN_GUARD_CONTACT_ONLY` requires a clean exact core, verified mapping, and neighbor contact restricted to the extraction guard; it is not equivalent to trustworthy core-localized text. The fixed completion policy allows only 1 ms of boundary rounding and up to 50 ms guard contact. Core intrusion beyond the rounding tolerance or a token crossing the core boundary remains unresolved. Context text is not projected back to a shorter core without trusted acoustic token evidence.

Seventeen exact requests are guard-contact-only; eighteen remain core-localization-unresolved because of genuine core overlap or crossing tokens. Guard caution may support an explicitly limited comparison but cannot manufacture strict localization, independent evidence, or a strong missing classification.

## 13. Frozen Probe Selection

V1 remains frozen: 24 targets × two providers × CORE_EXACT = 48 requests, plus eight targets × two providers × CORE_CONTEXT = 16 requests. Total: 64. Selection semantic hash: `cdecaf6adb27dbacd6eddd2b41faa5904a6bfca80e4a913c24178ddcc580ac3e`. No request was substituted after viewing downstream quality or Gold.

## 14. Probe Selection V2 Shadow

The shadow considers 28 eligible machine targets and proposes 24: 18 retained, six added, and six removed. It uses verified uncovered speech, mapping quality, lexical absence, evidence independence, and time-bin diversity, not Gold labels. All proposed execution statuses remain `PROBE_NOT_RUN_AUTHORIZATION_EXHAUSTED`; executed shadow requests = **0**.

The six added targets' exact identities, source intervals, evidence families, scores, and reasons are preserved in the LOCAL_ONLY shadow artifact and `completion-metrics.local-only.json` under `counts.shadowAddedDetails`. They include later source regions underrepresented by the original selection. Shadow semantic hash: `09414ebd4f9c3cf55ead8e79fe5c8ccff5ca54e358292dfa87fdce6c2262157d`.

## 15. Context Selection V2 Shadow

Eight context targets are proposed, with four added and four removed relative to V1. Existing context results are still the only usable context evidence. No new context request, retry, audio probe extraction, or inference was executed for this plan.

## 16. Existing Probe Re-localization

| Re-localization outcome       | Requests |
| ----------------------------- | -------: |
| CORE_CLEAN_GUARD_CONTACT_ONLY |       17 |
| CORE_EXACT_ISLAND_LOCALIZED   |       13 |
| CORE_LOCALIZATION_UNRESOLVED  |       18 |
| CONTEXT_TEXT_UNPROJECTABLE    |       16 |
| Total                         |       64 |

Trusted global token projection requests/tokens: 0/0. Strict localized candidates changed from the cached classifications' 16 to 13. **Newly recovered strict localized candidates: 0.** Three Whisper candidates were downgraded because a trusted token crossed the core boundary; one also lacked a fully verified projection chain. The 17 new guard-aware classifications are not reported as 17 newly localized transcripts. Re-localization hash: `51ba877f4bd70b2a800900b2bdf0beae580d1899064e9a2b19f6fd83e0a50327`.

## 17. Localized Whisper Count

Five strict localized Whisper candidates remain, versus eight legacy cached localization claims. Five additional Whisper exact requests carry guard-only caution, but are not strict localized candidates. No Whisper process or model was started in the closure.

## 18. Localized Reazon Count

Eight strict localized Reazon candidates remain, unchanged from the inherited result classifications. Twelve Reazon exact requests carry guard-only caution. No Reazon process or model was started in the closure.

## 19. Guard-contact Support Count

Guard-contact cross-model lexical support classifications: **0**. Guard contact is recorded rather than silently discarded, but the existing pairwise evidence does not satisfy the fixed support criteria. No strong assertion is made from caution alone.

## 20. Cross-model Agreement Count

Cross-model lexical agreement: **0**. Strict cross-model localized agreement: **0**. Pronunciation agreement positives: **0**, with the reading mechanism explicitly `UNAVAILABLE`, reason `COMPLETION_EXISTING_EVIDENCE_ONLY_NO_NEW_READING_RUNTIME`. This is unmeasured pronunciation agreement, not evidence that all pronunciations disagree; no reading runtime was downloaded or started to improve the result.

## 21. Cross-model Disagreement Count

Ten target groups are `CROSS_MODEL_LEXICAL_DISAGREEMENT`, and ten Missing V3 rows retain `MISSING_DIALOGUE_ASR_DISAGREEMENT`. Contradicting candidates remain review evidence, not replacements or majority-vote truth.

## 22. Both-empty Count

Both-empty target groups: **0**. Persisted empty-output results: **0**. Missing V3 `MISSING_DIALOGUE_ASR_EMPTY` rows: **0**. No empty-result denominator was silently removed.

## 23. Context-unprojectable Count

Sixteen context requests are unprojectable. At the 24-target aggregate level, the lexical classifications are three `CONTEXT_ONLY_UNPROJECTABLE`, ten disagreement, eight localization-unresolved, and three Reazon-only-localized groups. Request and target counts are different denominators and are not interchangeable. Localized lexical artifact hash: `0a8bd8a8245372f8607f0a7c2da0655c0eb8ce721659e8b948c087388048c8d4`.

## 24. Missing Evidence V3

The final artifact contains **66** rows:

| Classification                       | Rows |
| ------------------------------------ | ---: |
| MACHINE_DETECTION_ORPHAN             |   17 |
| SPEECH_ISLAND_OBSERVED               |   21 |
| LOCALIZATION_UNRESOLVED              |   15 |
| MISSING_DIALOGUE_ASR_DISAGREEMENT    |   10 |
| MISSING_DIALOGUE_LEXICAL_POSSIBLE    |    3 |
| MISSING_DIALOGUE_CROSS_MODEL_STRONG  |    0 |
| MISSING_DIALOGUE_SINGLE_MODEL_STABLE |    0 |
| MISSING_DIALOGUE_ASR_EMPTY           |    0 |
| SOURCE_GLOBAL_LINEAGE_UNVERIFIED     |    0 |

Zero unverified-class rows in this positive/target materialization do not mean the separate quarantine has disappeared. Missing V3 semantic hash: `530cc12a6aa6d6761c2fa7c632139881e241fdd382b06ab93d4a2469f9427a0c`.

## 25. True Orphan Count

There are **17** genuine orphan entries and 17 corresponding Missing V3 orphan rows: 16 observed-speech orphans and one lexical-possible orphan. They were not promoted to automatically insertable dialogue. None overlaps the six missing Gold components sufficiently to improve their direct orphan recall; that recall remains 0/6.

## 26. UNVERIFIED Audit Count

The original orphan sweep had 1,594 entries: 1,354 unverified, 197 cue-covered, 26 target-covered, and 17 true orphans. The reconciled sweep has 1,452 entries: 1,215 unverified, 194 cue-covered, 26 target-covered, and 17 true orphans. Reconciliation removes 139 entries from the unverified category; the verified island reconstruction also changes the covered/global inventory.

The **1,215 orphan-audit unverified rows** and **1,694 source-lineage quarantine rows** are different universes. Both audits are retained; neither is coerced into Missing V3 or erased to improve metrics. Orphan sweep semantic hash: `5a617f1ccab5027187e1aff5aab6ea3d7c2750735590eab22f22cb208f8887fb`.

## 27. UNVERIFIED Incorrect-orphan Count = 0

Final UNVERIFIED-to-orphan promotions: **0**. Final cue-covered-to-orphan and target-covered-to-orphan promotions: **0/0**. The old observed UNVERIFIED error count was 1,354. Audit retention is explicitly separate from positive missing-dialogue evidence.

## 28. Review Targets

There are **292** targets associated with 163 item containers, 11 unresolved items, 41 disjoint items, and zero legacy-core fallbacks. Types: 132 current-cue text, 17 current-cue hallucination, 55 candidate source, 53 missing-speech island, 17 orphan, ten localization, and eight timing-boundary targets. Disjoint source/candidate spans are not collapsed into a guessed continuous cue interval.

Target semantic hash: `cabab3b07ddcad0aaeef02e50947288ee2b207a7f091a218854498802d4d76d9`. All 292 targets are audio-required delivery targets; this is not the same concept as mandatory-ranked review items.

## 29. Hallucination Current-Cue Target

Seventeen targets use `CURRENT_CUE_HALLUCINATION_TARGET`. The single Gold hallucination component is covered by its current cue's source interval, region, real WAV, and actual playback timeline at ratio 1.0. A remote candidate-source interval is not accepted as a substitute for listening to the allegedly hallucinated current cue.

## 30. Review Items V4

All 153 previous items were migrated and retained; 21 new items produce **174** total. There are 17 orphan items and 23 required-ranked items. Previous items deleted: zero. Canonical text/timing mutation counts: zero. Item semantic hash: `02c2290b8de5a676f3ae407d6b2b58d3f8e829d979ef6131f12410a6bdfc8678`.

## 31. Review Regions V3

There are **60** regions, 13 required-ranked regions, 17 disjoint-region splits, and 14 disjoint items at the final clustering layer. The 41 disjoint-item count in the target inventory is a different stage/definition. All **292/292** targets map to regions, including zero-cue/orphan review regions. Region semantic hash: `97932cb709c1532b5701e4bd9e054834599e2a640a1c307bfc85f682cc8953dc`.

## 32. Audio Manifest V3

Planned audio files: **60**. Actual files: **60**. Extraction failures: **0**. Playable files: **60**. Hash-verified files: **60**. Review audio is mono 16 kHz PCM WAV, extracted from the bound source audio stream with measured sample boundaries and explicit source-global transforms. Actual WAV clip-sum is **926.048125 seconds**, which includes duplicated context and is not unique playback duration.

The manifest records actual files, sample counts, duration, hash, bindings, and failures, not just requested extraction intervals. Audio semantic hash: `309a567c51838b07e5765b74ed4e84b1af0bde5db93cc48c894357e7524d732d`.

## 33. Physical Audio Coverage

Known audio-required targets have full physical delivery **292/292**; all target delivery is **292/292**. This proves the generated target inventory is playable, not that the inventory detects every missing dialogue. The evaluator separately proves (a) complete bound physical target delivery and (b) selected playback coverage after sample/timebase mapping. A deduplicated segment may legitimately use an overlapping clip even if that clip does not claim ownership of the entire target.

The final required-target completeness check uses full interval coverage within numerical tolerance, not the Gold audible threshold of 0.8. Thus all-target delivery can pass while the independent Gold missing recall remains 3/6.

## 34. Playback Timeline V2

There are **494** playback segments, **494/494** physical-audio mappings, and **292/292** target mappings. The timeline partitions real source-global intervals at relevant boundaries and deduplicates overlapping sound; it is not a list of region IDs or nominal planned intervals. Full Queue unique audible time is **805.1313055555554 seconds**. Playback semantic hash: `802f1bdad772db88d6fca1500f076034cd8a4b2cf91f1cfc96588e3483dc409f`.

## 35. FULL_QUEUE Coverage

Full Queue: missing audible **3/6 (50%)**, hallucination audible **1/1 (100%)**, required-target delivery **292/292**. Its unique playback duration is 805.131306 seconds. It fails the missing-dialogue readiness requirement; it is not a fully successful coverage recovery.

## 36. ALL_MANDATORY Coverage

All Mandatory: missing audible **1/6**, hallucination audible **0/1**, unique playback **235.195354 seconds**. This diagnostic does not change the Full Queue denominator or gate. The existing deterministic R3 selector was reused; no retraining or post-Gold priority adjustment was performed.

| Frozen plan   | Actual unique audible seconds | Missing audible | Hallucination audible |
| ------------- | ----------------------------: | --------------: | --------------------: |
| 10%           |                     89.102375 |             1/6 |                   0/1 |
| 20%           |                    179.017979 |             1/6 |                   0/1 |
| 30%           |                    269.658479 |             1/6 |                   1/1 |
| 40%           |                    359.011979 |             1/6 |                   1/1 |
| 50%           |                    449.878090 |             1/6 |                   1/1 |
| ALL_MANDATORY |                    235.195354 |             1/6 |                   0/1 |
| FULL_QUEUE    |                    805.131306 |             3/6 |                   1/1 |

## 37. Machine Freeze

Final A froze at `2026-08-30T20:00:50.533Z`; Final B at `2026-08-30T20:00:51.172Z` (both 2026-08-31 JST). Their completion policy, source lineage, selections, results, lexical evidence, Missing V3, items, targets, regions, actual audio, playback, legacy review bindings, and all nine A0–A8 machine projections were bound before evaluation.

Final A freeze hash: `9fc45bc5d797ca90eaf2a33965b8bf26b849119fd3ff067bbf87989d0c36ba44`. Final B freeze hash: `6dbc8e20f05d08f4fb2a7cef223de72180fb1209597c6111014741a69c2a3d41`. Nine-projection semantic hash: `de6f4665c1d58b5c825d5c2939fff2ce375af5d56914ceef70a87e579300be47`.

## 38. Gold First-read Barrier

Gold was accessed only after both final freezes and all nine machine projections were verified. The first evaluator attempt read Gold after the barrier, then failed an upstream-evaluation locator. Its first-read timestamp was not persisted; the retained log's mtime is only a log-completion bound, not a fabricated first-read timestamp.

The three successful evaluator processes recorded their own first Gold reads at `20:15:36.014Z`, `20:22:17.917Z`, and `20:30:38.709Z` on 2026-08-30 UTC. Those are process-local timestamps, not the first-ever Gold access in this closure. The final authoritative evaluation is the `-3` directory. The exact inherited machine-vs-Gold artifact was located by its frozen SHA `3cedfab22687d976952f3505c0119cb10754468837d29a26eb760845b754a7d7`, with source, Gold, machine-draft, and quality-evaluation bindings verified.

Two generic evaluator-only corrections followed the initial post-freeze results: separating full physical target delivery from deduplicated playback clip ownership, and excluding hallucination from missing-speech-only diagnostic flags. Five synthetic regression cases cover these fixes. No machine artifact, canonical subtitle, target, audio clip, ranker, Gold matching rule, or Gold coverage threshold was changed after Gold access. Majority/audible/full thresholds remain 0.5/0.8/0.95. Full machine hash parity was rechecked after evaluation.

## 39. Item-lineage Missing Recall

Item-lineage recall is **5/6**. It means five Gold missing components have inherited item associations; it does not prove a sound interval is present or played. Its explicit status is `NOT_A_PLAYBACK_RECALL_METRIC`. Region-membership recall by legacy region identity is 0/6 because rebuilt regions have new identities; this is also not direct interval recall.

## 40. Direct Target Missing Recall

Direct target audible recall is **3/6**. Direct region-context audible recall is also **3/6**. The latter is the meaningful interval-based region recall, distinct from legacy ID membership. Component coverage uses atomic error-interval unions, not an enclosing hull that fills silent or unsupported gaps.

## 41. Physical Audio Missing Recall

Physical WAV overlap exists for **4/6** missing components, but only **3/6** meet the audible threshold. The fourth has 1.18 seconds of sound over a 2.89-second missing component, ratio **0.4083044983**. Calling that any-overlap hit fully reviewed would overstate delivery.

## 42. Playback Audible Missing Recall

Actual playback any-overlap recall: **4/6**. Audible recall: **3/6**. Full recall: **3/6**. Official recall intersects verified playable physical audio with the selected source-global playback segments. Planned intervals, item IDs, region membership, or audio merely existing elsewhere do not substitute for this intersection.

## 43. Speech-island Missing Recall

Verified machine-speech audible recall is **3/6**. Three missing components have no overlapping independently verified speech, orphan, or localized lexical evidence. Seventeen true machine orphans exist elsewhere, but do not cover these six components. Parent gaps were never promoted to speech simply to reach 6/6.

## 44. Localized Lexical Missing Recall

Localized lexical audible recall is **1/6**. One component has 3.96 seconds of localized evidence over a 4.42-second error interval, ratio **0.8959276018**, from one independent localized family. This is an existing frozen machine candidate, not a new strict probe localization or cross-model strong result. Two other audible components are speech-only review opportunities with lexical incompleteness advisories.

## 45. Hallucination Lineage Recall

Hallucination item-lineage recall is **1/1**. Legacy region membership is 0/1, which is not a failure of the new interval-based region mapping. Direct target and direct region-context recall are both 1/1.

## 46. Hallucination Playback Audible Recall

Physical audio, playback any-overlap, audible playback, and full playback are all **1/1**, with ratio 1.0. Hallucination diagnosis is `TARGET_AND_AUDIO_COVERED`, and its final coverage flag is `FULLY_PLAYBACK_COVERED`. Positive missing-speech or lexical evidence is not required to listen for a hallucinated cue.

## 47. Lineage-only False Coverage

In the seven-component missing/hallucination subset, **two** missing components have item lineage without audible playback. Across **all 137 evaluated error components** (77 material text, 53 severe timing, six missing, one hallucination), Full Queue `LINEAGE_ONLY_FALSE_COVERAGE` findings total **16**. These two denominators are reported explicitly; the subset count must not be presented as the all-error count.

## 48. Region-only False Coverage

Final Full Queue region-membership-without-playback findings: **0**, both in the seven-component subset and across all 137 components. In the seven-component subset, target-without-audible-audio and audio-without-playback findings are **0/0**. Across all 137 errors, the evaluator records **14 TARGET_WITHOUT_AUDIO** findings and **15 PLAYBACK_OMISSION** findings; audio-without-binding and playback-omits-target findings are zero.

Here `TARGET_WITHOUT_AUDIO` is a Gold-component diagnostic: a machine target intersects part of that Gold error but its physical sound does not cover at least 80% of the entire error component. It does **not** mean 14 generated target WAV files are missing. All 292 known targets still have full target-relative delivery. The whole-error and machine-target denominators must remain distinct.

## 49. Missing Component Diagnoses

M1–M6 below refer to the six missing components in source order; exact IDs/intervals are in the LOCAL_ONLY evaluation. No Gold text is reproduced here.

| Component | Item lineage | Target ratio | Physical/playback ratio | Verified speech | Localized lexical | Root cause / secondary diagnosis                                       |
| --------- | ------------ | -----------: | ----------------------: | --------------- | ----------------- | ---------------------------------------------------------------------- |
| M1        | yes          |            0 |            0.4083044983 | no              | no                | MACHINE_SPEECH_DETECTION_MISS; secondary MACHINE_REVIEW_AUDIO_OMISSION |
| M2        | yes          |            1 |                       1 | yes             | no                | Speech-only review; LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE advisory     |
| M3        | yes          | 0.8959276018 |                       1 | yes             | one family        | Localized lexical evidence and fully playable review                   |
| M4        | yes          |            0 |                       0 | no              | no                | MACHINE_SPEECH_DETECTION_MISS; lineage-only false coverage             |
| M5        | no           |            0 |                       0 | no              | no                | MACHINE_SPEECH_DETECTION_MISS                                          |
| M6        | yes          |            1 |                       1 | yes             | no                | Speech-only review; LOCALIZED_LEXICAL_EVIDENCE_INCOMPLETE advisory     |

Primary speech-detection misses: **3**. Required-lineage primary blocks: **0**. Review-localization primary misses: **0**. Secondary audio omission: **1**. Lexical-incomplete advisories: **2**. The optional unverified hints associated with M2/M6 are not the required evidence path and do not invalidate their independently verified speech coverage.

## 50. Hallucination Diagnosis

H1 has direct target, region, physical audio, and playback ratios of 1.0, so it is fully available for review. This does not mean the hallucinated subtitle was automatically removed or accepted. Canonical text and timing remain unchanged, and no human correction was saved during browser acceptance.

## 51. Root-cause Route Decision

Authoritative decision: **`HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR`**. This is an evidence-coverage route, not a schema/runtime failure. Source lineage can be incomplete elsewhere while the first failing link for M1/M4/M5 is lack of independent speech evidence. Fully delivered known targets do not override that root cause.

## 52. Route Blockers

Three missing components lack verified machine speech/orphan/localized evidence; one also has partial-only physical/playback coverage. Full Queue missing audible recall is 3/6, below the fixed 6/6 requirement. There is no fabricated source-lineage blocker for an already valid speech path and no claim that empty lexical output alone blocks a fully audible review opportunity.

## 53. Route Advisories

Two fully audible missing components lack localized lexical candidates and remain speech-only review opportunities. Their lexical limitation is advisory; it is not incorrectly promoted to a Full Queue delivery blocker. Required-target delivery passes, but mandatory ordering remains weak and cannot authorize the next phase while Full Queue detection fails.

## 54. Ranker Not Retrained

Ranker retrained: **false**. The existing deterministic R3 scoring/selection policy is reused over the new machine evidence and regions. No weights, thresholds, learned model, or Gold-conditioned priorities were tuned. R3 evidence-projection semantic hash: `e022422c72d517fa623cd7a4b29d034e81341b8acc145eea0eb0d69c2f1bff0f`.

## 55. New OOF Not Run

New OOF run: **false**. Existing OOF/Gold region labels are read only by the post-freeze evaluator for inherited component linkage. There is no new fit, fold selection, validation split, next-episode trial, or claim of prospective generalization.

## 56. Machine Text Parity

Machine cue count: **161**. Canonical text mutation: **0**. No new missing cue was inserted, no hallucinated cue was removed, and no candidate replaced the machine text. Existing Subtitle Cue v1 and Subtitle Package v1 contracts were not modified.

## 57. Machine Timing Parity

Canonical timing mutation: **0**. Source-global evidence reconciliation and review playback transforms are separate from subtitle timing. No source-relative review adjustment writes back to the canonical subtitle timeline.

## 58. ASS / SRT / VTT Parity

The package's explicit canonical subtitle-file bindings, not filename guessing, were used for comparisons. Canonical and best-effort delivery files were protected. Final A/B and source-baseline canonical bytes are identical.

| File role                | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Canonical ASS            | `594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7` |
| Canonical SRT            | `faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd` |
| Canonical VTT            | `107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a` |
| Machine Subtitle Package | `b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e` |

## 59. A/B Parity

Final A and B independently materialized the same machine graph and review audio before Gold access. **99/99** bindings match byte-for-byte: 28 artifact bindings plus 71 protected files. Semantic comparisons also match where applicable. Freeze envelopes themselves intentionally differ by stage and completion time; their normalized payloads match. Different envelope hashes are not hidden as byte parity.

All nine projection hashes were frozen together and retained after evaluation. A0–A7 use the inherited physical WAV inventory; A8 uses the new target-grounded audio/playback delivery.

| Projection | Items | Targets | Speech islands | Strict probe lexical candidates | Regions / WAVs | Target-audio diagnostic | Full missing / hallucination | Mandatory missing / hallucination |
| ---------- | ----: | ------: | -------------: | ------------------------------: | -------------- | ----------------------- | ---------------------------- | --------------------------------- |
| A0         |   153 |     153 |              0 |                               0 | 50 / 50        | 153/153                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A1         |   153 |     153 |              0 |                               0 | 50 / 50        | 153/153                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A2         |   153 |     222 |              0 |                               0 | 50 / 50        | 212/222                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A3         |   157 |     275 |             25 |                               0 | 50 / 50        | 262/275                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A4         |   174 |     292 |            170 |                               0 | 50 / 50        | 279/292                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A5         |   174 |     292 |            170 |                               5 | 50 / 50        | 279/292                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A6         |   174 |     292 |            170 |                              13 | 50 / 50        | 279/292                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A7         |   174 |     292 |            170 |                              13 | 50 / 50        | 279/292                 | 5/6; 0/1                     | 0/6; 0/1                          |
| A8         |   174 |     292 |            170 |                              13 | 60 / 60        | 292/292                 | 3/6; 1/1                     | 1/6; 0/1                          |

The table's intermediate target-audio diagnostic uses the fixed projection threshold of 0.8; final target delivery is additionally checked at complete coverage. A0–A7 Full Queue unique time is 817.433508 seconds and mandatory time 56.280 seconds; A8 is 805.131306 and 235.195354 seconds respectively. All are direct playback evaluations, even though A0's comparison role preserves the legacy lineage diagnostic.

The missing decline from 5/6 to 3/6 is real: broad old parent-gap context incidentally included two missing components that the verified target-specific reconstruction does not fully retain. Broad context is valid audible coverage when actually played, but it is not positive localized speech evidence. The decline is a remaining quality defect, not an excuse to inflate Full Queue recall or retroactively expand targets from Gold.

## 60. No New Inference

Closure inference count: **0**. Fresh provider process starts: **0**. Model loads: **0**. The 64 reused requests and their historical 66-attempt accounting are explicitly labeled inherited. Replaying tests, JSON materialization, hashing, WAV decoding, and deterministic audio extraction do not count as new speech-model runs.

## 61. Whole-media ASR Guard

Whole-media ASR requests: **0**. No Whisper/Reazon full pass, targeted retry, pyannote, CTC, MFA, translation model, model download, or provider fallback was performed during completion. Missing cache evidence is a terminal replay error rather than an invitation to infer.

## 62. Runtime Gold Input

Runtime Gold inputs before freeze: **0**. Machine assembly, selection, re-localization, review targets/audio, and R3 projection have no Gold input. The explicitly separate evaluator reads Gold only after verifying immutable machine inputs and inherited quality bindings. Earlier historical exposure of this episode still prevents a prospective quality/generalization claim.

## 63. Dataset Hardcoding

The scoped production audit inspected 51 changed TypeScript production files and found **0** dataset-specific hardcoding findings. Real source/Gold component IDs, episode-specific timestamps, or expected Japanese answers are not used to route production behavior. Synthetic tests assert semantics and failure cases, not a hardcoded 6/6 result. Skill 2/3 and unrelated speaker algorithms were not modified.

## 64. Network

Acceptance inference/provider/search external network usage: **0**. OpenAI requests: **0**. Online subtitle searches: **0**. Dependency preparation used offline npm cache, with install scripts disabled. Browser acceptance used localhost. The explicitly requested Git push and remote-SHA verification are a separate source-delivery network operation, not acceptance inference. The report does not claim that the later Git delivery used no network.

## 65. Source Read-only

Source media SHA-256: `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`. Source size, SHA, mtime, and inode remained unchanged before/after machine runs, browser playback, and evaluation. Read-only media probing and deterministic extraction did not alter the original file. No source media is included in Git or the shareable summary.

## 66. Gold Read-only

Gold SHA-256: `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`. Gold size, SHA, mtime, and inode remained unchanged. The full source identity details and local path are restricted to private receipts. No Gold text, Gold audio, Gold component locator, or human review document was written into machine runtime inputs.

## 67. Shareable Audit

The aggregate-only shareable directory passes **15/15** checks, with a one-file allowlist: `c6-0-1-14-shareable-validation-summary.json`. Absolute/private paths, secrets, raw text/audio, Gold details, component/target IDs, sessions/SQLite, and broken relative references: **0**. Shareable summary semantic hash: `2087c16c45c20f7992ac833c6bf3f9c3f578f7456303fe5f89bebeaa8706055d`.

Full Final A/B, audio, evaluation, and audit outputs are **LOCAL_ONLY** research artifacts, not public-shareable packages. The browser server created an empty SQLite mutex file in its local workspace session area; inspection found no tables or saved review decisions. It is not a human trial and is excluded from the shareable allowlist and Git.

## 68. Unit Tests

Latest code validation used Node `v24.19.0` and `npm@11.18.0`. `typecheck`, `lint`, `format:check`, and `build` all passed. `npm test` passed **1,044 tests**, with **2 skipped**, in **124 files**. This command includes E2E files. The non-E2E portion is 998 passed, one skipped, 98 files; do not add the E2E subtotal again to claim a larger unique test count.

Offline `npm ci --ignore-scripts` completed from the existing cache, adding 186/auditing 198 packages with zero reported vulnerabilities and no lockfile change. The committed source is the same tested source; the final documentation-only pass additionally checks formatting and diff hygiene.

## 69. E2E

The explicit `npm run test:e2e` run passed **46 tests**, with **1 skipped**, across **26 files**. These overlap the full `npm test` run. No real ASR or Gold evaluation is hidden inside the code-validation command.

## 70. UI Tests

Browser acceptance passed **28/28** checks against real generated WAV delivery and the final frozen UI. Checks cover all seven plans, actual WAV decoding, continuous queue completion, play/pause cancellation, playback speed, filters, source-target/evidence panels, current-cue hallucination, zero-cue insertion entry point, next navigation, and legacy action compatibility.

An asynchronous play/cancel race was fixed before the authoritative machine freeze. The final recheck included a 10.41-second continuous queue run. Candidate edit/base paths were exercised without saving corrections; no human review session or finalization was asserted. This is functional browser QA, not measured human review time savings or a human listening quality trial.

## 71. Targeted Tests

C6.0.1.14 targeted suite: **142/142 passed**, eight files, zero skipped. It covers orphan filtering, lineage and transform failures, guard/core distinction, zero-inference cache behavior, strict contracts, disjoint targets/regions, actual audio binding, zero-cue UI paths, freeze/projection isolation, direct error unions, root-cause precedence, Full Queue versus Mandatory gates, and shareable rejection cases.

## 72. Schema Count

Generated schema inventory: **390**. C6.0.1.14 schemas: **40**, all with strict roots. Actual-artifact validations: **124** machine/evaluation artifacts plus **3** final acceptance artifacts, **127 passed** total. Negative probes rejected extra fields **124/124** and missing required fields **124/124**.

AJV uses `strict: true`, with `strictRequired: false` and `strictTuples: false` for compatibility with existing Zod-generated enum-record/propertyNames and literal-tuple schemas; this does not remove data `required` or `additionalProperties` checks. Default author-lint strict compilation accepted 374/390 and objected to 16 generated schema forms; all 390 compile under the documented compatibility options. This is not described as default AJV strict compilation passing unchanged.

The generic file-to-schema inventory also identified nine legacy telemetry/policy JSON files without standalone generated-schema mappings: three inherited policy files are checked by the existing delivery graph, and six historical preflight/status files are telemetry. They are not counted as schema-validated artifacts. Authoritative C6.0.1.14 request/cache/failure, machine, evaluation, and acceptance contracts were validated.

## 73. Cross-version Regressions

The final cross-version union passed **529 tests**, zero failed, zero skipped, across **68 files and 18 groups**. This includes the prefixed 518-test suite and an explicit 11-test/10-file C6.0.1.2 regression selection whose legacy filenames are not prefixed. No training or fresh inference was run.

| Group            | Passed |
| ---------------- | -----: |
| C5.19            |     31 |
| C6 Investigation |     36 |
| C6 Protected     |      7 |
| C6.0.1           |      8 |
| C6.0.1.1         |     11 |
| C6.0.1.2         |     11 |
| C6.0.1.3         |      5 |
| C6.0.1.4         |     22 |
| C6.0.1.5         |     18 |
| C6.0.1.6         |     26 |
| C6.0.1.7         |      5 |
| C6.0.1.8         |      7 |
| C6.0.1.9         |      8 |
| C6.0.1.10        |     11 |
| C6.0.1.11        |     18 |
| C6.0.1.12        |     87 |
| C6.0.1.13        |     76 |
| C6.0.1.14        |    142 |

An earlier concurrently loaded run timed out one C6.0.1.12 test at 5,011.797 ms against its existing five-second limit. The failed output is retained; isolated repeat runs passed without changing thresholds. The authoritative cross-version directory is the `-4` run plus the explicit C6.0.1.2 receipt.

## 74. Skill Validation

The multilingual-video-subtitler skill passed `quick_validate`. Its documentation now routes completion through the replay-only, Gold-isolated workflow and explains the two independent physical/playback proofs and hallucination-specific semantics. Existing subtitle-generation requirements and the Skill 2/3 boundaries remain intact.

## 75. Engineering Gate

**PASS, 9/9 checks**: final freezes/read-only source, canonical byte parity, machine semantic parity, strict machine delivery graph, persisted Fresh completeness, exact cache replay, Fresh/replay semantic parity, code validation, and hardcoding audit. Engineering completion is independent of the missing-dialogue quality gate.

## 76. Evaluation Integrity Gate

**PASS**, zero integrity failures, seven bound playback plans. Official recall is `PHYSICAL_PLAYABLE_AUDIO_INTERSECT_ACTUAL_PLAYBACK_AUDIBLE_0_8`; lineage metrics are explicitly non-playback metrics. Atomic error intervals, union/intersection accounting, audio/source transforms, physical file hashes, machine freeze, and inherited evaluator identities were verified. The failed locator attempt and evaluator-only corrections are retained transparently in section 38 and the provenance receipt.

## 77. Full Queue Playback Gate

**FAIL / HOLD** because missing-dialogue audible coverage is 3/6, although hallucination is 1/1 and all known machine targets are fully delivered. The final exact-target audio revision cannot be described as an across-the-board quality improvement: missing audible recall regressed by two components from the old broad-context playback projections.

## 78. ALL_MANDATORY Diagnostic

Missing 1/6 and hallucination 0/1 demonstrate prioritization weakness. This remains a diagnostic for eventual separately authorized ranker recalibration. Changing mandatory membership now would neither create missing machine speech evidence nor satisfy the Full Queue prerequisite.

## 79. C6.0.1.15 Readiness

`GO_C6_0_1_15_REGION_RANKER_RECALIBRATION` is **not reached**. No C6.0.1.15 branch, report, training, or execution was created. This closure completes the authorized C6.0.1.14 implementation and evidence reporting while honestly retaining a failed quality gate. C6.0.2 and machine-only release remain held.

## 80. Remaining Risks

The next root-cause investigation, if separately authorized, must address **source-global machine speech detection/evidence coverage for unrepresented speech**, including why verified evidence is absent where prior broad context happened to be audible. It must operate on machine evidence, not hardcoded Gold component times. It must then regenerate/freeze/evaluate under a new explicit authorization; this closure cannot add requests or widen clips after Gold.

Other limitations remain: 1,694 quarantined provenance entries, 1,215 unverified orphan-audit entries, no new strict probe localizations, no cross-model strong/guard support, unavailable pronunciation comparison, three uncovered missing components, two speech-only lexical advisories, 11 unresolved review items, and weak mandatory recall. These are not eliminated by passing schemas or by a clean Git delivery. FullQueue coverage of other text/timing errors also has the deficits recorded in section 48.

## 81. Commits

The source snapshot was split into explainable scoped commits, with explicit staged-path checks, `git diff --cached --check`, and private-output/secret exclusion. No media, model, cache, Gold, output directory, session, or environment file was staged.

| Order | SHA / identity                                                                | Scope                                                                                  |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1     | `c564ec897ef5d6042a2746768ac00389aec27094`                                    | Orphan/route policies and shared strict contracts, 53 files                            |
| 2     | `37541d07a8fe966689a73193d4832e14980cca29`                                    | Source lineage, replay-only probes, persistence, re-localization and shadow, ten files |
| 3     | `0810a14455a6000663eb62c30f88c015077c9f6e`                                    | Localized lexical, Missing V3, review items/targets, four files                        |
| 4     | `05eb18827c6084462191ac55b6b34c21642cf973`                                    | Target-grounded regions, physical audio, playback and UI, seven files                  |
| 5     | `bc8d0fbd7ce0cc32bd35bcc7ccef6271e0bd97e1`                                    | Evaluator, execution/validation scripts, exports and tests, 26 files                   |
| 6     | This report's documentation commit, `docs: record C6.0.1.14 final acceptance` | Report, README, skill and completion reference                                         |

A temporary precommit privacy scan initially matched the literal path-prefix string in a synthetic privacy-rejection test. It stopped before staging. Inspection confirmed that the literal was a detector fixture, not a private user path; only the temporary scanner was corrected to require an actual path component. The test and production privacy checks were not weakened.

## 82. Remote HEAD

Push target is the existing branch on `https://github.com/kai987/Codex-Skills-multilingual-video-subtitler.git`, using a normal non-force push. The final documentation commit cannot include its own SHA without recursion. Therefore its actual SHA and the observed **Local HEAD = Upstream HEAD = GitHub Remote HEAD** equality are recorded after push in `git-delivery-verification.local-only.json` in the completion-audit output, and in the user-facing completion response. The receipt also records all six commits, the clean worktree, and independent output protection checks. Before those observations exist, a source commit alone is not a completed remote delivery.

## 83. Output Paths

These are directory basenames under the user's external `Codex-Skills/output` root, not tracked repository paths. All full-data directories are LOCAL_ONLY. Exact local paths are preserved in private receipts and the final user response; they are deliberately not embedded in this public repository report.

| Role                                                                             | Authoritative directory basename                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Final A                                                                          | `carnation-c6-0-1-14-final-a-20260831-2`                                  |
| Final B                                                                          | `carnation-c6-0-1-14-final-b-20260831-2`                                  |
| Physical review package                                                          | `carnation-c6-0-1-14-review-package-v3-20260831-6`                        |
| Localized lexical side output                                                    | `carnation-c6-0-1-14-localized-lexical-evidence-20260831-2`               |
| Missing V3 side output                                                           | `carnation-c6-0-1-14-missing-evidence-v3-20260831-2`                      |
| A0–A8 and final direct evaluation                                                | `carnation-c6-0-1-14-playback-evaluation-20260831-3`                      |
| Full code validation                                                             | `carnation-c6-0-1-14-code-validation-20260831-5`                          |
| Cross-version prefixed regression                                                | `carnation-c6-0-1-14-cross-version-regression-20260831-4`                 |
| Preservation, schemas, browser, shareable, provenance, C6.0.1.2 and Git receipts | `carnation-c6-0-1-14-completion-audit-20260831-2`                         |
| Final engineering/evaluation validation                                          | `carnation-c6-0-1-14-validation-20260831`                                 |
| Aggregate-only shareable directory                                               | `carnation-c6-0-1-14-validation-20260831/shareable`                       |
| Inherited valid Fresh result                                                     | `carnation-c6-0-1-14-local-probes-fresh-completed-authorized-66-20260831` |
| Inherited exact Cache Replay                                                     | `carnation-c6-0-1-14-local-probes-cache-replay-authorized-66-20260831-2`  |
| Read-only inherited cache                                                        | `carnation-c6-0-1-14-local-probe-cache-completed-authorized-66-20260831`  |

The authoritative final evaluation files include `c6-0-1-14-playback-coverage-evaluation.json`, `gold-review-playback-coverage-integrity.json`, `c6-0-1-14-missing-hallucination-evaluation.json`, `c6-0-1-14-route-decision.json`, and `c6-0-1-14-post-freeze-evaluation-audit.json`. The final validation file is `c6-0-1-14-validation.json`. Preservation, metrics, cross-version totals, browser checks, source commits, shareable checks, and Gold/A-B chronology have separate receipts in the completion-audit directory.

Older failed/partial/intermediate directories are intentionally retained for audit. Their presence does not make them final acceptance inputs. The previous snapshot ZIP remains a snapshot; no new package was requested or created by this completion task.
