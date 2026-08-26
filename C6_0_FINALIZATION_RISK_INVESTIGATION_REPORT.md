# C6.0 Finalization Risk Investigation Report

## 1. Executive Conclusion

**Investigation result: GO for a guarded C6.0 implementation; NO-GO for default machine-only zero-touch release.** The current episode contains 14 blocking finalization findings, but they are seven repetitions of two meta/derived codes: `FORCED_ALIGNMENT_COMPONENT_UNRESOLVED` and `ILLEGAL_SUBTITLE_OVERLAP`. Neither code, by itself, proves that the unchanged user-confirmed baseline is defective. All seven components lack a proven safe automatic repair; zero components contain independent positive evidence that the current output is defective.

The investigation did not finalize subtitles, reduce Review Items, change thresholds, rerun a model, or modify Canonical text/timing/presentation. The accepted state remains `needs-review`, `finalizationMethod = none`, Review `7 → 7`.

Required answers:

| Question                                                                             | Answer                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1. Components with positive current-output defect evidence                          | **0 / 7**                                                                                                                                                                                                 |
| Q2. Components where automatic repair is not proven safe                             | **7 / 7**                                                                                                                                                                                                 |
| Q3. Should `FORCED_ALIGNMENT_COMPONENT_UNRESOLVED` always be a Final Blocker?        | **No.** It is an evidence-availability/meta finding; it must guard alignment-dependent mutation and become a Final Blocker only when paired with positive current-output or integrity risk.               |
| Q4. Does `ILLEGAL_SUBTITLE_OVERLAP` accurately describe all seven?                   | **No.** All seven have temporal overlap, but the evidence does not prove all are semantically illegal. The name conflates observable overlap with demonstrated defect.                                    |
| Q5. Superseded/stale Review blocker                                                  | **1 unique code**, affecting **2 cues** (`140`, `142`): `CTC_TARGET_UNREPRESENTABLE`.                                                                                                                     |
| Q6. With the human-reviewed baseline unchanged, independently mandatory human checks | **0 / 7 proven mandatory**; six remain advisory and one has preservation support. This is a counterfactual classification only; the production Review count remains seven.                                |
| Q7. Is the same policy safe for a machine-only baseline?                             | **No.** Human authority currently supplies Canonical text/timing confidence.                                                                                                                              |
| Q8. Does current data prove zero-touch?                                              | **No.** No blind-generation proof exists for this task.                                                                                                                                                   |
| Q9. Minimum P0                                                                       | Add scoped dispositions, separate output/mutation risk gates, apply freshness before gating, fail closed on unknown/integrity codes, preserve deterministic evidence lineage, and validate on blind data. |
| Q10. Enter C6.0 Implementation?                                                      | **GO with conditions**; **NO-GO** for enabling the default finalizer until blind acceptance passes.                                                                                                       |

## 2. Branch

`codex/c6-0-investigation-finalization-risk-audit`

## 3. Baseline

Base branch `codex/c5-19-series-language-memory`; base commit `feb40e68285fb56125b42bb6966dc84d1d986ab9`.

## 4. Investigation Scope

The work adds strict investigation schemas, a static/dynamic blocker inventory, ontology classification, freshness/supersession audit, root-cause graph, seven-component evidence matrix, read-only counterfactual evaluator, human-authority audit, readiness decision, deterministic Run A/B validation, tests, and this report.

## 5. Non-goals

No production finalization-policy change, Speaker/CTC/MFA algorithm change, threshold relaxation, subtitle mutation, model inference, network access, or Skill 2/3 modification was permitted or performed.

## 6. C5.19 Baseline

The input is `carnation-reference-guided-c5-19-series-memory-bootstrap-20260827`, with causal/frozen parity references. It contains 192 user-confirmed human-reviewed cues, seven Review Items, 14 blocking finalization findings, zero Canonical/timing mutations, and no `subtitle-package.final.json`.

## 7. Current Finalization Architecture

The production finalizer aggregates decision findings, forced-alignment component status, presentation overlap status, delivery/integrity checks, and review routing into one report. It currently treats every severity `blocking` finding as contributing to the final gate regardless of whether that finding describes output safety, mutation safety, evidence availability, or diagnostics.

## 8. `qualityPassed` Current Logic

`qualityPassed` requires the blocking finding count to be zero. Because the current report emits seven forced-alignment meta findings and seven overlap findings, the gate remains false even though no automatic mutation was attempted and all format parity checks passed.

## 9. Current Blocking Finding Generation

Each unresolved overlap component generates `FORCED_ALIGNMENT_COMPONENT_UNRESOLVED`; final cue quality separately emits `ILLEGAL_SUBTITLE_OVERLAP`. This produces two blocking findings per component and 14 total.

## 10. Review Package Blocker Architecture

Review items preserve detailed provider and policy blockers from Forced Alignment, CTC, Speaker, separated streams, mapped-token/VAD, overlap-acoustic, and presentation layers. Those blockers currently share a flat string list even though their semantics differ.

## 11. Seven Review Components

All seven real components were audited from the C5.19 Artifact, including exact cue IDs, intervals, text, blocker lists, evidence lineages, provider outcomes, and format assessments.

## 12. Raw Blocking Findings

Raw finalization count: **14**. Unique finalization-level blocking codes: **2**. Review Items: **7**.

## 13. Blocker Inventory

The static/dynamic inventory contains 263 relevant code-like signals: 251 declared in scanned production sources, 70 observed in current artifacts, and 193 declared-but-not-observed legacy/dead-code candidates. Static producers include relative source path, nearest producer function, line, and condition text.

## 14. Blocker Ontology

Observed signals classify as 51 `MUTATION_GUARD`, 14 `DIAGNOSTIC_ONLY`, two `REVIEW_ADVISORY`, two `CONTEXT_DEPENDENT`, and one `SUPERSEDED`; observed `UNKNOWN` count is zero. The full inventory retains 85 unobserved `UNKNOWN` candidates, which remain fail-closed until investigated.

## 15. Finding vs Review Blocker

A finalization finding is a delivery-gate output. A Review blocker can instead describe why an automatic proposal is unsafe, why a provider was unavailable, or why evidence disagrees. C6.0 must not treat those categories as interchangeable.

## 16. Positive Risk Evidence

Positive current-output risk means localized evidence that the unchanged subtitle is wrong or unsafe, not merely that a provider failed to prove a repair. No audited component meets that standard.

## 17. Absence-of-Support Evidence

MFA/CTC/Speaker availability and confidence failures mostly mean that a proposed edit lacks sufficient support. They must prevent dependent automation but do not independently condemn the human-reviewed baseline.

## 18. Mutation Guard

A mutation guard blocks an automatic text/timing action. It may coexist with a safe unchanged output. All seven components contain at least one mutation guard and none has a safe automatic action.

## 19. Current Output Risk

Six components remain `UNKNOWN` at current-output semantics because available evidence neither proves defect nor proves intent. Component 3 is `LOW` because stable single-speaker evidence plus the CTC legal-overlap preservation guard supports retaining it. No component is `HIGH`.

## 20. Proposed Mutation Risk

All seven components are `HIGH` for proposed mutation risk because a safe localized change is not established.

## 21. Baseline Preservation

The conservative action for every component is preservation. That action is not equivalent to claiming the component is semantically resolved.

## 22. Root Cause Graph

The acyclic graph reduces 70 observed codes to ten root risk families: automatic boundary mutation guard; baseline provenance diagnostic; evidence contradiction/preservation risk; observed content classification; unresolved overlap semantics; presentation/format advisory; provider/evidence availability; review-routing meta signal; safe repair not established; and stale CTC target availability.

## 23. Meta Finding

`FORCED_ALIGNMENT_COMPONENT_UNRESOLVED` is a meta finding derived from component state. It should guard dependent mutation and remain review-visible, but should not always block unchanged trusted output.

## 24. Derived Finding

`ILLEGAL_SUBTITLE_OVERLAP` is derived from temporal overlap plus unresolved policy state. It does not encode whether the overlap is intended simultaneous dialogue, a presentation limitation, or a proven timing defect.

## 25. Risk Family Dedup

Provider-specific symptoms are counted once at root-family level for readiness decisions. Raw codes remain preserved for audit and debugging.

## 26. Freshness Model

Each blocker must reference the evidence version that produced it. A later, same-cue, semantically compatible artifact may supersede an earlier availability blocker only when lineage and preservation invariants match.

## 27. Supersession Model

Supersession is explicit, traceable, and narrow. It does not erase history; it records original/later artifact references, cue IDs, old/new states, and zero Canonical/timing mutation.

## 28. `CTC_TARGET_UNREPRESENTABLE` Case

C5.19 memory pronunciation made cues `human-reviewed-0140-2bd637f9d14d` and `human-reviewed-0142-8086b5bbb5e8` encodable. The original CTC blocker is therefore superseded for those two cues. Component 4 remains timing-unresolved for independent reasons.

## 29. Human Authority Dependency

The Canonical baseline authority is `user-confirmed-human-review`. Human authority supplies both text and timing. The source ASS is verified read-only.

## 30. Gold Leakage

Using this baseline to claim machine-only quality would leak human gold into the generation/evaluation path. The investigation keeps human-baseline and machine-only conclusions separate.

## 31. Machine-only Gap

No `blind-generation-proof.json` exists in the C5.19 input. This episode cannot establish machine-only zero-touch safety.

## 32. Overlap Semantics

Temporal overlap is a measurable presentation/timing relation. It is not automatically a subtitle defect: simultaneous speech, chant, interruption, and foreground/background dialogue can be intentional.

## 33. `ILLEGAL_SUBTITLE_OVERLAP` Naming Audit

The name is overbroad for all seven cases. C6.0 should separate `TEMPORAL_OVERLAP_OBSERVED`, `OVERLAP_SEMANTICS_UNRESOLVED`, `FORMAT_OVERLAP_ADVISORY`, and positively proven `UNSAFE_SUBTITLE_OVERLAP`.

## 34. ASS Overlap

ASS retains simultaneous events and current round-trip/canonical parity passes. All seven are format-safe in the accepted ASS representation.

## 35. VTT Overlap

VTT can represent overlapping cue intervals, but player behavior and readability vary. Six components remain advisory; Component 3 has explicit preservation support.

## 36. SRT Overlap

SRT permits overlapping time ranges in files, but rendering support varies. This is a compatibility advisory, not automatic proof that the subtitle content is unsafe.

## 37. Component 1

`def4f9…`, cues 19/20, interval `59.14–60.88`, overlap `0.10 s`. Speaker result `speaker-evidence-conflict`, unstable (`SPEAKER_ACTIVITY_IOU_LOW`); no timing proposal. Current-output risk `UNKNOWN`; proposed-mutation risk `HIGH`; advisory review.

## 38. Component 2

`5e6df4…`, cues 88/89, interval `402.05–410.37`, nested overlap `3.80 s`. Speaker result `speaker-evidence-conflict`, count/mapping/activity unstable; no timing proposal. Current-output risk `UNKNOWN`; proposed-mutation risk `HIGH`; advisory review.

## 39. Component 3

`de9815…`, cues 97/98, interval `436.04–440.85`, overlap `0.27 s`. Speaker relationship is `single-speaker-only`, stable and `resolved`, but its decision margin is insufficient for timing action. CTC reports `CTC_LEGAL_OVERLAP_DELETED` for the rejected repair. Therefore **speaker relationship resolved = 1 does not mean subtitle overlap resolved**; subtitle overlap resolved remains zero. Preservation review is not independently mandatory.

## 40. Component 4

`8ff734…`, cues 140/141/142, interval `688.31–695.61`, aggregate adjacent overlap `4.58 s`. Speaker result remains conflict/unresolved. Cues 140 and 142 are now memory-assisted encodable, superseding `CTC_TARGET_UNREPRESENTABLE`; joint timing remains unsafe. Current-output risk `UNKNOWN`; advisory review.

## 41. Component 5

`5475b2…`, cues 145/146, interval `701.46–705.34`, overlap `0.65 s`. Speaker count/mapping/overlap intervals are unstable; no timing proposal. Current-output risk `UNKNOWN`; advisory review.

## 42. Component 6

`eef084…`, cues 163/164, interval `772.51–777.21`, overlap `0.45 s`. Speaker count/mapping/overlap intervals are unstable; CTC also detects non-monotonic/new-overlap/edge-pinning risks. Current-output risk `UNKNOWN`; advisory review.

## 43. Component 7

`69e8f4…`, cues 174/175/176, interval `808.53–811.86`, aggregate overlap `1.55 s`. Speaker activity IoU is low and the relationship remains conflict/unresolved. Current-output risk `UNKNOWN`; advisory review.

## 44. MFA Failure Semantics

MFA disagreement, silence intrusion, or missing side support blocks an MFA-dependent mutation. It does not independently prove the preserved baseline wrong.

## 45. CTC Failure Semantics

Unstable windows, insufficient lexical support, non-monotonic assignments, and edge pinning are mutation guards. Execution/availability diagnostics are recorded separately.

## 46. Speaker Failure Semantics

Speaker provider instability blocks speaker-dependent timing changes. A provider failure does not block unchanged output. A resolved speaker relationship is not sufficient to resolve subtitle overlap.

## 47. Neighbor Intrusion

Neighbor intrusion is contradictory localized evidence against a candidate boundary and therefore a high-risk mutation guard.

## 48. New Illegal Overlap

`CTC_NEW_ILLEGAL_OVERLAP` rejects a proposed timing action that creates a new overlap. It is not evidence that the current baseline overlap is itself defective.

## 49. Legal Overlap Deleted

`CTC_LEGAL_OVERLAP_DELETED` is preservation evidence: the proposed repair would remove an overlap that existing policy treats as legal/preservable.

## 50. Mutation Limit

Start/end mutation-limit failures guard the proposed boundary change only. They do not become Final Blockers for unchanged output.

## 51. Provider Uncertainty

Provider unavailable/unstable status is diagnostic for current output and blocking for any dependent automatic action. Contradictory positive risk remains blocking.

## 52. Preservation Evidence

Preservation evidence includes user-confirmed authority, zero Canonical/timing mutation, format parity, playable Review audio, stable Run A/B semantics, Component 3 single-speaker continuity, and rejected repairs that would create/delete unsafe overlaps.

## 53. Counterfactual Scenario A

Current policy retains 14 findings and does not finalize.

## 54. Scenario B

Excluding `MUTATION_GUARD` retains the same 14 meta/overlap findings and does not finalize.

## 55. Scenario C

Also excluding `DIAGNOSTIC_ONLY` retains the same 14 findings and does not finalize.

## 56. Scenario D

Also excluding `REVIEW_ADVISORY` retains the two context-dependent code families (14 instances) and does not finalize.

## 57. Scenario E

Blocking only positive current-output risk and canonical/delivery integrity failures retains zero current findings and would counterfactually finalize the unchanged human baseline. This simulation emits no final subtitle and is not production authorization.

## 58. Raw Blocking Count

14 finalization findings; 70 observed detailed codes across evidence/review artifacts.

## 59. Root Risk Count

10 deduplicated root risk families.

## 60. Positive Output Risk Count

0 of 7 components.

## 61. Mutation Guard Count

51 unique observed codes; 7 of 7 components lack a safe automatic repair.

## 62. Advisory Count

Two unique observed ontology codes are direct `REVIEW_ADVISORY`; component-level necessity is six advisory and one preservation-not-required.

## 63. Diagnostic Count

14 unique observed `DIAGNOSTIC_ONLY` codes.

## 64. Superseded Count

One unique code, two cue-scoped occurrences.

## 65. Unknown Count

Observed unknown: zero. Unobserved inventory candidates remain `UNKNOWN` and fail closed.

## 66. Human Review Necessity

Under the current human-reviewed-baseline preservation question, no component has independent positive evidence proving mandatory review; six remain recommended advisories and Component 3 is not required for preservation. Production remains Review 7 because this investigation does not change finalization policy.

## 67. Final-safe-with-advisories Concept

`final-safe-with-advisories` should mean canonical/delivery integrity passed, no positive current-output defect remains, unknowns fail closed, and every automatic mutation guard is respected. It must not imply machine-only quality or semantic resolution of every advisory.

## 68. Proposed Risk Taxonomy

Scopes: `current-output-safety`, `automatic-mutation-safety`, `evidence-availability`, `evidence-consistency`, `delivery-integrity`, `format-compatibility`, `diagnostic-only`. Dispositions: `FINAL_BLOCKER`, `MUTATION_GUARD`, `REVIEW_ADVISORY`, `DIAGNOSTIC_ONLY`, `CONTEXT_DEPENDENT`, `SUPERSEDED`, `UNKNOWN`.

## 69. Proposed Finding Scope Contract

Every finding should carry code, root family, scope, evidence polarity, current-output risk, proposed-mutation risk, lineage, freshness/supersession state, and disposition. Unknown code defaults to fail-closed.

## 70. Evidence Independence

Multiple profiles from one model/provider are correlated evidence, not independent votes. Independence requires distinct lineage, model/runtime/provider assumptions, or human authority.

## 71. Evidence Consensus Draft

Apply freshness first; deduplicate root causes; distinguish positive risk from absence of support; require localized independent support for mutation; retain contradictions; keep delivery/canonical integrity absolute; never infer overlap resolution from speaker resolution.

## 72. Current Human-baseline Safety

The evidence supports preserving the current human-reviewed baseline. It does not prove all overlap semantics resolved.

## 73. Machine-only Zero-touch Safety

Not established. Machine-only Canonical generation must be evaluated without access to the human baseline.

## 74. Blind Acceptance Requirement

Default release requires a pre-registered, multi-episode blind corpus with human references hidden from generation and revealed only for adjudicated evaluation.

## 75. Blind Generation Proof

Absent for this task. C6.0 Implementation must emit a strict proof recording hidden-reference isolation, source/model/runtime/policy identities, inference lineage, and post-run evaluation linkage.

## 76. Gold Evaluation Protocol

Measure Canonical text accuracy, timing, coverage, hallucination, overlap semantics, format parity, delivery integrity, review necessity, and replay determinism against adjudicated gold after generation is frozen.

## 77. Unsafe Escape Metric

`unsafeFinalizationEscapeRate = unsafe finalized outputs / all outputs with adjudicated positive current-output or integrity risk`. P0 release target: zero observed escapes with a predeclared confidence bound and explicit sample-size requirement.

## 78. False Review Metric

`unnecessaryReviewRate = review items with no adjudicated current-output defect and no actionable safe repair / all Review Items`. Track separately for human-baseline and machine-only paths; never optimize it by weakening integrity gates.

## 79. Zero-touch Readiness Gap

Missing pieces are machine-only blind evidence, production scope-aware gate implementation, unknown-code migration coverage, calibrated release thresholds, and cross-episode validation.

## 80. P0 Requirements

Implement scope-aware findings, separate current-output/mutation gates, freshness before disposition, root-family deduplication, unknown fail-closed behavior, immutable lineage, human-vs-machine policy separation, and blind acceptance tooling.

## 81. P1 Requirements

Rename/split overlap findings, add format-specific advisory policy, expose root-risk explanations in Review UI, and quantify unnecessary review without changing safety thresholds.

## 82. P2 Requirements

Calibrate provider independence, extend the blind corpus across series/genres/languages, and evaluate optional advisory auto-dismissal for trusted human baselines.

## 83. C6.0 Implementation Phases

Phase 1: contracts/migration; Phase 2: shadow-mode scoped evaluator; Phase 3: blind acceptance; Phase 4: guarded human-baseline opt-in; Phase 5: machine-only default consideration only after thresholds pass.

## 84. Go / No-Go

**GO** to a scoped implementation. **NO-GO** to default finalization release.

## 85. Go Conditions

Preserve all unknown/integrity fail-closed behavior, do not mutate the accepted baseline, retain seven Review Items during shadow validation, demonstrate deterministic counterfactuals, and pass the blind protocol before enabling finalization.

## 86. Run A

Run A produced ten strict investigation artifacts plus ten byte-identical shareable copies. Model inference/load/network/mutation counts are all zero.

## 87. Run B

Run B independently repeated the same read-only analysis and produced the same semantic hashes.

## 88. Deterministic Parity

All ten Run A/B artifact semantic hashes match. Bootstrap/causal/frozen Canonical and timing parity also passes. Shareable audits: 10/10 per run, absolute path leaks 0, secrets 0, broken relative references 0.

## 89. Tests

Node `v24.19.0`: `npm test` passed **525**, with two intentional skips, across 39 files. `npm run test:e2e` passed **28**, with one intentional skip, across 11 files. C5.19 targeted regression remains **32/32**. C6.0 targeted unit/E2E selection passed **9/9**. Typecheck, lint, format check, and build passed.

## 90. Schemas

`npm run generate:schemas` generated **129** strict JSON Schemas (120 baseline + nine C6.0 schemas). Zod and generated JSON Schema validation both passed all ten artifacts in each real run (**20/20** total); the component evidence matrix reuses the strict component-risk schema contract.

## 91. Production Diff Audit

No production finalization, Review, MFA, CTC, Speaker, overlap, subtitle serialization, or CLI finalization implementation was changed. The diff is limited to investigation schemas/export/generation, npm investigation commands, investigation-only scripts, tests, and this report.

## 92. Input Read-only

Pre/post identities match:

- video: 847,774,958 bytes; SHA-256 `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- human-reviewed ASS: 17,094 bytes; SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`
- Canonical cue hash: `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`
- timing hash: `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`
- presentation hash: `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`

## 93. Skill 2

Read-only compatibility repo HEAD `1af10bd8a7057c573959f39a745436fa837127ea` passed Node 24 typecheck/build. Its strict schemas parsed 192 cues and the unchanged report at 106 sentences / 106 grammar points. The repo remained clean.

## 94. Skill 3

Read-only compatibility repo HEAD `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8` passed typecheck, one test, build, and a real learning-site build from the Skill 2 report. The generated report copy was byte-identical; the repo remained clean.

## 95. Remaining Risks

The single episode is human-reviewed and not blind; overlap intent remains unknown for six components; static inventory includes unobserved legacy candidates; and Scenario E is only a counterfactual. None authorizes default finalization.

## 96. Suggested C6.0 Implementation Prompt Scope

Implement the P0 scope/freshness/consensus contract in shadow mode, migrate current codes without semantic loss, preserve current production output, add blind-proof and adjudication artifacts, run human-baseline and machine-only policies separately, and require zero unsafe escapes before considering default enablement.

## 97. Git Commit

Investigation tooling commit: `678c33a26fe1255e8b087001bee32886592e7ddd` (`chore: add C6.0 finalization risk investigation tooling`). This report is delivered in the subsequent documentation commit.

## 98. Remote HEAD

After delivery, `origin/codex/c6-0-investigation-finalization-risk-audit` must equal the documentation commit containing this report. The immutable SHA is reported in the final response after push verification.

## 99. Artifact Paths

- Run A: `<Codex-Skills>/output/carnation-reference-guided-c6-0-investigation-a-20260827`
- Run B: `<Codex-Skills>/output/carnation-reference-guided-c6-0-investigation-b-20260827`
- Validation entrypoint: `scripts/validate-c6-0-investigation.ts`
- Primary summary: `Run A/c6-0-investigation-summary.json`
- Component matrix: `Run A/c6-0-component-evidence-matrix.json`
- Report: `C6_0_FINALIZATION_RISK_INVESTIGATION_REPORT.md`

Final investigation status: **C6.0 risk semantics are sufficiently understood to begin a fail-closed implementation, but machine-only zero-touch default finalization is not yet accepted.**
