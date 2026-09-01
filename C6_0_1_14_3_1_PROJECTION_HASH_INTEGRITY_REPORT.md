# C6.0.1.14.3.1 — Strict Projection Row Hash Rebinding, Nested Semantic Integrity Preflight & Clean Re-freeze Evaluation

Date: 2026-09-01 (JST). Publication boundary: source, tests, schemas, documentation, and aggregate-only acceptance. Source media, Gold subtitles, review WAV, caches, candidate text, workspaces, and Gold-linked row details remain `LOCAL_ONLY`.

## Executive conclusion

**The evaluation-integrity patch passed.** All 84 source Workspace Audio Rows were valid before projection; all 84 stale strict Projection Row hashes were reproduced, removed, and rebound in the correct hash domain. The new pre-Gold recursive preflight verified 10 artifacts, 18 outer hashes, and every hashable nested row with zero failures. Final A/B were independently rebuilt from exact caches, achieved byte and semantic parity, and were re-frozen before the first Gold read.

A4–A7 are now legally scorable: each has zero integrity failures. The new official A7 result is Missing Playback Audible **5/6** and Hallucination Playback Audible **1/1**. Missing inventory remains 6/6, but one component has no final target overlap and only incidental 5.95% physical/playback overlap. Therefore the authoritative route is `HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR`, with C6.0.1.14.4 as the next bounded step. `GO_C6_0_1_15_REGION_RANKER_RECALIBRATION` is not authorized; C6.0.2 remains `HOLD`.

Machine subtitles remain unchanged: 161 cues, zero text/timing/presentation mutations, and byte-identical ASS/SRT/VTT against the accepted C6.0.1.14.3 package. Detector and ASR execution was exact-cache-only (18/18 and 44/44), with zero cache miss, inference, model load, provider start, or acceptance network use.

## Required report register (1–108)

|   # | Topic                                | Evidence-backed result                                                                                                                                                                                              |
| --: | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Executive Conclusion                 | Projection, nested, and evaluation integrity all pass. Official A7 is Missing Audible 5/6 and Hallucination Audible 1/1; route `HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR`.                                     |
|   2 | Branch                               | `codex/c6-0-1-14-3-1-projection-hash-integrity`.                                                                                                                                                                    |
|   3 | Baseline                             | `82b81a41bcaaff351ef7adfb5dcc8d02f7356b67`, the clean remote C6.0.1.14.3 baseline.                                                                                                                                  |
|   4 | C6.0.1.14.3 Replay                   | Passed. Machine cue count 161; detector 18/18 and ASR 44/44 exact-cache hits; planner/delivery structure reproduced.                                                                                                |
|   5 | Goals                                | Rebind strict projected row hashes after field removal, recursively preflight nested hashes before Gold, rebuild A0–A7 and independent Final A/B, then cleanly re-freeze/evaluate.                                  |
|   6 | Non-goals                            | No planner, child, bundle, target, region, audio/playback interval, detector/ASR evidence, subtitle, ranker/OOF, human-trial, Skill 2/3, or C6.0.2 change.                                                          |
|   7 | Why Planner Was Not Modified         | Planner feasibility, monotonicity, 24-bundle/60-second constraints, and Phase A coverage already passed; the confirmed defect was strictly in projection hash-domain handling.                                      |
|   8 | Why Detector/ASR Were Not Run        | The required 18 detector and 44 ASR results were already frozen and exact-cache-addressable. Any miss would fail closed; fresh model authorization was absent.                                                      |
|   9 | Baseline Hash Failure Reproduction   | Reproduced exactly: 84 valid source rows, 84 strict projected rows with stale reused hashes, 0/84 projected hash-valid, and 599/599 valid playback rows.                                                            |
|  10 | Source Workspace Audio Row Count     | 84.                                                                                                                                                                                                                 |
|  11 | Source Row Hash Validity             | 84/84 valid before projection.                                                                                                                                                                                      |
|  12 | Strict Projection Row Count          | 84 official projected audio rows.                                                                                                                                                                                   |
|  13 | Stale Projection Hash Count          | 84 before repair; 0 after repair.                                                                                                                                                                                   |
|  14 | Playback Row Hash Validity           | 599/599 valid before repair and preserved after repair.                                                                                                                                                             |
|  15 | `HASH_DOMAIN_CHANGED_WITHOUT_REHASH` | Confirmed root cause: `nativeSourceInterval` was removed while the source-row `semanticHash` was retained. WAV/PCM/playback bytes were not corrupt.                                                                 |
|  16 | Canonical Serializer Identity        | `stableMachineQualityJson+SHA-256`.                                                                                                                                                                                 |
|  17 | Semantic Hash Helper Identity        | `hashed141/assertHash141`; no second JSON/SHA implementation was introduced.                                                                                                                                        |
|  18 | Source Hash Domain                   | `SOURCE_WORKSPACE_AUDIO_ROW`.                                                                                                                                                                                       |
|  19 | Projection Hash Domain               | `STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW`.                                                                                                                                                                     |
|  20 | Projection Rebinding Algorithm       | Assert source hash → project fields → remove old hash → canonical projected hash → strict schema parse → assert projected hash.                                                                                     |
|  21 | Source Row Verification              | Fail-closed verification occurs before projection; invalid source rows cannot be repaired by projection.                                                                                                            |
|  22 | Strict Projection Rehash             | 84/84 rows were rehashed from their actual strict object shape; source and projected hashes differ for all 84.                                                                                                      |
|  23 | Projection Schema Validation         | 84/84 projected rows strictly parsed and passed recomputed-hash verification; no debug fields were added to strict rows.                                                                                            |
|  24 | Hash-rebinding Ledger                | 84 entries; source/projected/schema/ledger-entry validity all 84/84; failures 0; ledger hash `c07cbb6a219ca557a21801fb521de8afb06ffd44c9c4bb1383b0c905fa0467d9`.                                                    |
|  25 | Removed Field Inventory              | `nativeSourceInterval` removed in 84/84 projected audio rows; old `semanticHash` is removed from each hash payload.                                                                                                 |
|  26 | Source→Projection Hash Mapping       | 84 domain changes, 84 rebound rows, 0 accidental source/projected hash equalities; mappings live only in the sidecar ledger.                                                                                        |
|  27 | Nested Preflight Scope               | 10 bound artifacts; 18/18 outer hashes; projection set/variants, audio, playback, target, region, safety, child, bundle, obligation, planner, ledger, atom, and continuity types inspected.                         |
|  28 | Audio Row Preflight                  | 656 nested audio rows across A0–A7 verified; the official A7 hard gate is 84/84.                                                                                                                                    |
|  29 | Playback Row Preflight               | 4,702 nested playback rows across A0–A7 verified; the official A7 hard gate is 599/599.                                                                                                                             |
|  30 | Target Row Preflight                 | 333/333 review-target rows verified.                                                                                                                                                                                |
|  31 | Region Row Preflight                 | 84/84 review-region rows verified.                                                                                                                                                                                  |
|  32 | Bundle/Child Preflight               | 787/787 bundle rows, 150/150 selectable-child rows, 24/24 safety-target rows, and 1,390/1,390 hierarchical atoms verified.                                                                                          |
|  33 | Continuity/Planner Preflight         | 24 continuity rows were truthfully recorded as `NOT_APPLICABLE_NO_ROW_HASH`; 24/24 Phase A obligation rows and 1/1 planner certificate verified.                                                                    |
|  34 | Outer-vs-Nested Integrity            | Outer validity cannot mask a stale nested row. Runtime outer-valid/nested-invalid count is 0; the negative regression test rejects this construction.                                                               |
|  35 | Pre-Gold Failure Count               | 0; unknown hashable row count 0; `goldReadAttempted: false` during preflight.                                                                                                                                       |
|  36 | Projection Change Audit              | Passed; hash `9d38c4ca7e1ae4ed1ce7aa4385f79fbc1d8c55264b65a67280a345642c969938`.                                                                                                                                    |
|  37 | Expected Hash Changes                | 84 projected audio-row hashes, four A4–A7 variant hashes, one projection outer hash, and downstream freeze/evaluation/route/validation hashes changed.                                                              |
|  38 | Unexpected Semantic Changes          | 0; forbidden change list empty and row counts conserved.                                                                                                                                                            |
|  39 | WAV Byte Parity                      | 84/84 official WAVs playable and hash-verified; PCM, duration, mapping, and Final A/B audio SHA parity all pass.                                                                                                    |
|  40 | Interval Parity                      | Target, region, audio, source mapping, and playback interval parity all pass; no interval changed.                                                                                                                  |
|  41 | Planner Parity                       | Preserved; deterministic native set-cover branch-and-bound remains `FEASIBLE`, complete, and witness-verified.                                                                                                      |
|  42 | Phase A Obligation Parity            | 24 obligations, 104 atomic intervals, 2,640,993 native samples / 55.0206875 seconds, 100% coverage, 0 drops, 0 regressions.                                                                                         |
|  43 | Detector Replay                      | Expected 18, exact hits 18, misses 0.                                                                                                                                                                               |
|  44 | ASR Replay                           | Expected 44, exact hits 44, misses 0.                                                                                                                                                                               |
|  45 | New Inference Count                  | 0.                                                                                                                                                                                                                  |
|  46 | Model Load Count                     | 0; provider process starts 0.                                                                                                                                                                                       |
|  47 | Final A                              | Built independently; freeze hash `77cf797836e8eb59056a33f51729dba864e7205d26840eacace09ea1577495a8`; preflight ran before freeze.                                                                                   |
|  48 | Final B                              | Built independently; freeze hash `c173f72b528d25a2bbec09d5d6fd98b1307f85e67a2c1c33c54f9c598f24f202`; preflight ran before freeze.                                                                                   |
|  49 | Final A/B Parity                     | Passed: 814 files, 55 semantic artifacts, 740 audio files, 7 protected files; byte, semantic, audio SHA, canonical, and normalized-freeze parity true.                                                              |
|  50 | Machine Re-freeze                    | Passed; two pre-freeze preflights; refreeze hash `eb29798fb48419fbbfcb841010d95743cc4e9f4805493a6a10e9b55db129331e`.                                                                                                |
|  51 | Gold Access Audit                    | Machine-stage Gold path and previous-Gold-derived reads 0; evaluator Gold input 1 only after freeze; runtime Gold input 0.                                                                                          |
|  52 | Freeze Before Gold                   | True. Final A completed `2026-09-01T08:13:21.131Z`, Final B `2026-09-01T08:13:35.723Z`, first Gold read `2026-09-01T08:26:20.193Z`.                                                                                 |
|  53 | A0 Result                            | Integrity pass, failures 0; Missing Audible 4/6; Hallucination Audible 1/1.                                                                                                                                         |
|  54 | A1 Result                            | Integrity pass, failures 0; Missing Audible 5/6; Hallucination Audible 1/1.                                                                                                                                         |
|  55 | A2 Result                            | Integrity pass, failures 0; Missing Audible 4/6; Hallucination Audible 1/1.                                                                                                                                         |
|  56 | A3 Result                            | Integrity pass, failures 0; Missing Audible 5/6; Hallucination Audible 1/1.                                                                                                                                         |
|  57 | A4 Integrity                         | Passed; integrity failure count 0, so A4 is legally scorable.                                                                                                                                                       |
|  58 | A4 Quality                           | Missing Audible 5/6; Hallucination Audible 1/1.                                                                                                                                                                     |
|  59 | A5 Integrity                         | Passed; integrity failure count 0, so A5 is legally scorable.                                                                                                                                                       |
|  60 | A5 Quality                           | Missing Audible 5/6; Hallucination Audible 1/1.                                                                                                                                                                     |
|  61 | A6 Integrity                         | Passed; integrity failure count 0, so A6 is legally scorable.                                                                                                                                                       |
|  62 | A6 Quality                           | Missing Audible 5/6; Hallucination Audible 1/1.                                                                                                                                                                     |
|  63 | A7 Integrity                         | Passed; integrity failure count 0, so the official Final is legally scorable.                                                                                                                                       |
|  64 | A7 Quality                           | Missing Audible 5/6; Hallucination Audible 1/1. Full queue 837.900681 seconds / 93.0990% of episode.                                                                                                                |
|  65 | Final Missing Target Recall          | 4/6 at the frozen audible threshold. One additional component has majority target overlap, while the remaining blocker has no target overlap.                                                                       |
|  66 | Final Missing Physical Audio Recall  | 5/6. The remaining component has only incidental 0.208999-second / 5.9544% overlap, below audible.                                                                                                                  |
|  67 | Final Missing Playback Any-overlap   | 6/6 (`> 0`), including the incidental 5.9544% overlap; this is not an audible-resolution claim.                                                                                                                     |
|  68 | Final Missing Playback Audible       | 5/6 (`>= 0.80`), the official route metric.                                                                                                                                                                         |
|  69 | Final Missing Playback Full          | 5/6 (`>= 0.95`).                                                                                                                                                                                                    |
|  70 | Final Missing Lexical Recall         | 2/6 localized lexical coverage.                                                                                                                                                                                     |
|  71 | Final Hallucination Target Recall    | 1/1.                                                                                                                                                                                                                |
|  72 | Final Hallucination Audio Recall     | 1/1.                                                                                                                                                                                                                |
|  73 | Final Hallucination Audible Recall   | 1/1.                                                                                                                                                                                                                |
|  74 | Per-component Best Stage             | Four Missing components are already full at baseline/final; one selection-only component reaches full at A1 and is restored at A7; the remaining component never reaches audible. Hallucination is full through A7. |
|  75 | Per-component Final Status           | Five Missing components are `FULL`; one is `PARTIAL` at 5.9544% and diagnosed `HIERARCHICAL_CHILD_SELECTION_MISS` / review-audio omission downstream. Hallucination is `FULL`.                                      |
|  76 | Final Route Decision                 | `HOLD_FOR_HIERARCHICAL_TARGET_SELECTION_REPAIR`. Production stays `needs-review`, `finalizationMethod: none`; C6.0.2 `HOLD`.                                                                                        |
|  77 | Route Blockers                       | `HIERARCHICAL_TARGET_SELECTION` and `MISSING_DIALOGUE_PLAYBACK_COVERAGE`; integrity blockers are cleared.                                                                                                           |
|  78 | Route Advisories                     | Repair only remaining inventory-to-target selection continuity in C6.0.1.14.4; do not reopen this integrity patch, rerun models, relax thresholds, or tune from Gold.                                               |
|  79 | C6.0.1.15 Readiness                  | Not ready because official Missing Audible is 5/6 rather than 6/6.                                                                                                                                                  |
|  80 | Potential C6.0.1.14.4 Need           | Required: `Remaining Inventory-to-Target Coverage Selection Repair`.                                                                                                                                                |
|  81 | Machine Text Mutation                | 0; canonical text hash `e117fd080a71b244bc39086c82a4972c9335f7c64cef07cc2df1bfbbcd992e05`.                                                                                                                          |
|  82 | Machine Timing Mutation              | 0; canonical timing hash `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`.                                                                                                                        |
|  83 | Presentation Mutation                | 0; presentation hash `ddb9c9f5f97acb7bc5c87925983da6d64d12e1a825025f736744f32aeec13d98`.                                                                                                                            |
|  84 | ASS/SRT/VTT Parity                   | Passed byte-for-byte against authoritative C6.0.1.14.3 and between Final A/B, including best-effort forms.                                                                                                          |
|  85 | Runtime Gold Input                   | 0 throughout baseline, rebuild, ledger, preflight, Final A/B, and re-freeze; evaluator-only input count 1 after freeze.                                                                                             |
|  86 | Dataset Hardcoding                   | 0 new C6.0.1.14.3.1 production/machine-source occurrences of series identity, Gold IDs/text/hash, component intervals, 5.95%, or expected 5/6.                                                                      |
|  87 | Network                              | `networkUsedForAcceptance: false`; no model/subtitle/cloud network access. Git push is tracked separately.                                                                                                          |
|  88 | Source Read-only                     | Passed before/after identity: SHA `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`, size 847,774,958, mtime and inode unchanged.                                                                  |
|  89 | Gold Read-only                       | Passed before/after identity: SHA `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`, size 17,094, mtime and inode unchanged.                                                                       |
|  90 | Shareable Audit                      | Passed strict schema; absolute paths 0, secrets 0, raw dialogue/audio fields 0, source/Gold intervals 0, broken references 0.                                                                                       |
|  91 | Unit Tests                           | 147 files; 1,259 passed, 2 skipped. Non-E2E: 117 files; 1,190 passed, 1 skipped.                                                                                                                                    |
|  92 | E2E                                  | 30 files; 69 passed, 1 skipped.                                                                                                                                                                                     |
|  93 | UI Tests                             | 6 files; 59 passed.                                                                                                                                                                                                 |
|  94 | Browser Tests                        | Real in-app browser 12/12; console errors 0; local WAV playback completed without saving a decision; 430px viewport had no horizontal overflow.                                                                     |
|  95 | Targeted Tests                       | Existing C6.0.1.14.3 suite 41/41; C6.0.1.14.3.1 unit/E2E suite 13/13.                                                                                                                                               |
|  96 | Cross-version Regressions            | 98 files; 752 passed, covering C5.19 through C6.0.1.14.3.1.                                                                                                                                                         |
|  97 | Schema Count                         | 526 generated schemas; upstream artifact validation 43 instances, plus C6.0.1.14.3.1 acceptance 10/10.                                                                                                              |
|  98 | Skill Validation                     | `quick_validate.py` passed: `Skill is valid!`. Skill 2/3 source unchanged.                                                                                                                                          |
|  99 | Engineering Gate                     | PASS: offline npm ci, schema generation, typecheck, lint, format, build, unit, E2E, UI, browser, targeted, cross-version, and Skill validation.                                                                     |
| 100 | Projection Hash Gate                 | PASS: 84/84 source valid, 84/84 projected valid after rebind, stale count 0.                                                                                                                                        |
| 101 | Nested Integrity Gate                | PASS: 0 nested failures, 0 unknown hashable rows, outer-valid/nested-invalid runtime count 0.                                                                                                                       |
| 102 | Evaluation Integrity Gate            | PASS: A0–A7 integrity failures 0; all stages scorable.                                                                                                                                                              |
| 103 | Full Queue Coverage Gate             | FAIL only on quality: Missing Audible 5/6. Machine delivery itself is 333/333 target/audio/playback mappings and 84/84 WAVs.                                                                                        |
| 104 | Remaining Risks                      | One inventory-supported Missing component is absent from final target selection; incidental audio overlap must not be mistaken for an audible recovery. Subtitle quality remains `needs-review`.                    |
| 105 | Next-stage Recommendation            | Create C6.0.1.14.4 for remaining inventory-to-target coverage selection repair. Do not rerun detector/ASR, modify evidence, or start C6.0.1.15/C6.0.2.                                                              |
| 106 | Commits                              | Core chain: `4232a28`, `0c088be`, `dd37e24`, `1e45f5e`, `a04d9b9`, `faa1b4c`, `e65057e`; evaluation acceptance: `edb893f`; documentation acceptance is this report's commit.                                        |
| 107 | Remote HEAD                          | Resolved after the documentation commit is pushed; the delivery response records local/upstream/GitHub parity.                                                                                                      |
| 108 | Output Paths                         | Authoritative Machine/Gold attempt uses suffix `-20260901-6`; final validation uses safe-allocated suffix `-20260901-7`. See the output register below.                                                             |

## Per-component final-stage summary

Identifiers are intentionally normalized to M1–M6/H1 in this shareable report; Gold-linked row identities remain local-only.

| Component | Inventory                  | Target   | Physical audio  | Playback        | Lexical | Final status | Diagnosis                                                                     |
| --------- | -------------------------- | -------- | --------------- | --------------- | ------- | ------------ | ----------------------------------------------------------------------------- |
| M1        | FULL                       | FULL     | FULL            | FULL            | AUDIBLE | FULL         | Baseline already covered                                                      |
| M2        | FULL                       | FULL     | FULL            | FULL            | NONE    | FULL         | Playback covered; lexical evidence incomplete                                 |
| M3        | FULL                       | AUDIBLE  | FULL            | FULL            | AUDIBLE | FULL         | Baseline already covered                                                      |
| M4        | FULL                       | NONE     | PARTIAL 5.9544% | PARTIAL 5.9544% | NONE    | PARTIAL      | Hierarchical child selection miss; downstream review-audio omission           |
| M5        | FULL                       | MAJORITY | FULL            | FULL            | NONE    | FULL         | Phase A coverage preserved/restored despite sub-audible direct target overlap |
| M6        | FULL                       | FULL     | FULL            | FULL            | NONE    | FULL         | Baseline already covered                                                      |
| H1        | PARTIAL inventory evidence | FULL     | FULL            | FULL            | NONE    | FULL         | Hallucination review target/audio/playback preserved                          |

The final selection-miss diagnosis count is 1. Two Missing components have direct target coverage below the 0.80 target threshold, but one of those still has full physical/playback coverage through preserved Phase A context; only M4 remains non-audible. Final review-audio omission count is therefore 1.

## ALL_MANDATORY diagnostic

The frozen `ALL_MANDATORY` subset contains 23 REQUIRED items, 13 REQUIRED regions, and 235.195354 seconds of unique machine audio. Its official Missing Audible result is 1/6 and Hallucination Audible is 0/1. This remains a diagnostic of ranking/review burden, not a substitute for the Full Queue gate. No ranker retraining, new OOF, priority promotion, or threshold relaxation occurred.

## Questions Q1–Q18

**Q1. Were the 84 C6.0.1.14.3 errors corrupt physical WAVs?** No. They were strict Projection Rows whose hash domain changed after `nativeSourceInterval` was removed without recomputing `semanticHash`. WAV SHA/PCM/duration/playability all pass.

**Q2. Why can the Source Workspace Audio Row keep its hash while the Strict Projection Row needs a new one?** The source object shape is unchanged and remains in `SOURCE_WORKSPACE_AUDIO_ROW`. The strict projection is a different serialized object in `STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW`, so its hash must bind that projected shape.

**Q3. Why is reusing the old hash after deleting `nativeSourceInterval` wrong?** A semantic hash proves the exact canonical payload. Deleting a field changes that payload; retaining the old digest makes the row claim integrity for an object it no longer contains.

**Q4. What are the two hash domains?** Source: `SOURCE_WORKSPACE_AUDIO_ROW`. Projection: `STRICT_C601143_COVERAGE_AUDIO_PROJECTION_ROW`.

**Q5. Do all strict Projection Audio Rows pass after repair?** Yes, 84/84 official rows pass canonical recomputation, strict schema parse, and post-parse hash assertion; stale count is 0.

**Q6. Were the 599 Playback Rows unnecessarily changed?** No. Their existing hashes were already correct and remain 599/599 valid; playback rows and intervals are byte/semantic equivalent in the change audit.

**Q7. Why is an outer Projection hash insufficient?** The outer hash can be recomputed around a nested row that still carries a stale self-hash. Consumers that trust row-level provenance would then receive internally contradictory evidence. The preflight independently recomputes every required nested hash.

**Q8. What did pre-Gold nested integrity check, and were there failures?** It checked projection set/variants, 656 audio rows, 4,702 playback rows, 333 targets, 84 regions, 24 safety targets, 150 children, 787 bundles, 24 obligations, one planner certificate, 84 ledger rows, and 1,390 atoms. Twenty-four continuity rows were correctly marked N/A because they have no independent row hash. Failures: 0.

**Q9. Did the repair change planner, obligations, children, bundles, or intervals?** No. Planner, Phase A obligations, child units, target bundles, target/region/audio/playback intervals, and WAV bytes all retain semantic parity.

**Q10. Were detector and ASR cache-only with zero inference?** Yes: detector 18/18, ASR 44/44, misses 0, new inference 0, model loads 0, provider starts 0.

**Q11. Are Final A/B WAV, playback, and Machine Subtitle outputs consistent?** Yes. Final A/B byte/semantic/audio/canonical parity passes; all 84 official WAVs verify; ASS/SRT/VTT are byte-identical.

**Q12. Was Gold first read after the new Machine Re-freeze?** Yes. Both Final freezes completed by `08:13:35.723Z`; Gold first read was `08:26:20.193Z`.

**Q13. Did A4–A7 change from `INTEGRITY_FAILED` to legally scorable?** Yes. Each now has integrity failure count 0 and an official 5/6 Missing, 1/1 Hallucination result.

**Q14. What is the new official Final Missing Playback Audible Recall?** **5/6 (83.3333%)**, produced only by the corrected projection → preflight → re-freeze → isolated Gold evaluation path.

**Q15. Is Final Hallucination Playback Audible still 1/1?** Yes, **1/1 (100%)**.

**Q16. If Missing is below 6/6, what is the earliest failing layer?** **Target selection.** Inventory is 6/6; the remaining component has no final target overlap, and physical/playback evidence reaches only incidental 5.9544% overlap downstream.

**Q17. Is `GO_C6_0_1_15_REGION_RANKER_RECALIBRATION` reached?** No. Official Missing Audible is 5/6, so the GO gate remains closed.

**Q18. What is the exact next step?** **C6.0.1.14.4 — Remaining Inventory-to-Target Coverage Selection Repair.** Evaluation integrity is repaired and must not be reopened absent new evidence.

## Output register

All directories are outside the Git repository and remain local-only under the configured output root.

- Baseline: `carnation-c6-0-1-14-3-1-baseline-20260901-6`
- Transition audit: `carnation-c6-0-1-14-3-1-transition-audit-20260901-6`
- Obligations: `carnation-c6-0-1-14-3-1-obligations-20260901-6`
- Hierarchical children: `carnation-c6-0-1-14-3-1-hierarchical-children-20260901-6`
- Target bundles: `carnation-c6-0-1-14-3-1-target-bundles-20260901-6`
- Final planner: `carnation-c6-0-1-14-3-1-final-planner-20260901-6`
- Review package: `carnation-c6-0-1-14-3-1-review-package-20260901-6`
- Hash rebinding/change audit: `carnation-c6-0-1-14-3-1-hash-rebinding-20260901-6`
- Nested preflight: `carnation-c6-0-1-14-3-1-nested-preflight-20260901-6`
- Final A: `carnation-c6-0-1-14-3-1-final-a-20260901-6`
- Final B: `carnation-c6-0-1-14-3-1-final-b-20260901-6`
- Re-freeze: `carnation-c6-0-1-14-3-1-refreeze-20260901-6`
- Evaluation: `carnation-c6-0-1-14-3-1-evaluation-20260901-6`
- Code/browser/Skill evidence: `carnation-c6-0-1-14-3-1-validation-20260901-6`
- Final C6.0.1.14.3 and C6.0.1.14.3.1 validation: `carnation-c6-0-1-14-3-1-validation-20260901-7`

## Reproducibility and privacy

Node `v24.19.0` and npm `11.18.0` were used. Code validation did not execute real ASR, Gold evaluation, or ranker training; the isolated evaluator performed the only post-freeze Gold read. The local browser audit created no human decision or trial. Its sole temporary side effect was an empty, zero-byte session SQLite file in Final A; that file contained no session data, was removed, and the independent Final A/B byte check was rerun to pass.

The committed tree contains no source video, Gold subtitle, review WAV, detector/ASR cache, full candidate text, local output, model, runtime, private absolute path, credential, `.env`, or session database. The aggregate-only acceptance files passed the shareable audit.
