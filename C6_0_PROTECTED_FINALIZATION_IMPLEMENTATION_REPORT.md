# C6.0 Protected Finalization Implementation Report

## 1. Executive Conclusion

C6.0 Protected Finalization acceptance passed. A verified human-reviewed baseline can be finalized through protected baseline-preservation risk semantics. Machine-only zero-touch acceptance did not pass and is not authorized by this release.

## 2. Branch

Implementation branch: `codex/c6-0-protected-finalization-risk-engine`.

## 3. Baseline

The implementation starts from investigation commit `4deed6efdf509f56b5f5c76a1607ae8ef4adf431`; its parent is `678c33a26fe1255e8b087001bee32886592e7ddd`.

## 4. Investigation Provenance

The production policy is derived from the committed C6.0 Investigation artifacts and report, including the independent Run A and Run B semantic inventories. The policy stores both baseline commits, the investigation version, the investigation semantic hashes, an ontology hash, and a root-cause-graph hash.

## 5. Goals

The release adds source-controlled risk semantics, exact finding classification, freshness/supersession checks, root-risk deduplication, human authority verification, baseline preservation, advisory review projection, protected finalization, strict artifacts, deterministic replay, and fail-closed validation.

## 6. Non-goals

It does not add or rerun ASR, Whisper, MFA, pyannote, CTC, separation, subtitle lookup, OpenAI, or any network model. It does not lower thresholds, rewrite canonical text/timing, reduce Review count as an optimization target, or authorize machine-only release.

## 7. Legacy Compatibility

The existing finalization implementation remains the complete execution path when the C6 option is omitted or set to `legacy`. No C6 policy text is shown in the legacy Review UI, and legacy artifacts are not renamed or reinterpreted.

## 8. CLI Modes

`--c6-finalization-policy` accepts exactly `legacy`, `protected-observe`, and `protected-enforce`. Help text states that enforce requires a verified human-reviewed baseline and that machine-only zero-touch is not authorized.

## 9. Default Mode

The option defaults to `legacy`. The explicit Legacy run and the Default-no-flag run have matching status, method, cue/timing/presentation identities, Review count, output names, and final-package absence.

## 10. Production Risk Policy

`c6-0-protected-risk-policy.json` is strict, source-controlled, exact-code-only, deterministic, and hash-verified. It contains 87 entries and does not use prefixes, substrings, finding messages, or runtime count reduction to classify a signal.

## 11. Policy Hash

Policy version: `c6.0-protected-finalization-risk-v1`. Policy hash: `b0638365275692de0f620b90af431530a03c4633e1c0509c0563c8a4b1c5545b`. Ontology hash: `e5d8c68e4c3a808f1c84fb967b1c3be3db7d4b36394fe5e305b34d34b0c8fabb`. Root graph hash: `9ba81e5412a59c325cc64e53211784e39920044782dd84cff5e0681a349c63d7`.

## 12. Policy Coverage

The real sample produced 70 distinct observed codes; 70/70 are covered and the unknown observed count is 0. The policy contains 17 `FINAL_BLOCKER`, 51 `MUTATION_GUARD`, 2 `REVIEW_ADVISORY`, 14 `DIAGNOSTIC_ONLY`, 2 `CONTEXT_DEPENDENT`, and 1 `SUPERSEDED` entries.

## 13. Unknown Fail Closed

Unknown lookup returns no policy entry, `unknownSignalsFailClosed` is true, and enforce converts an unknown observation into a final blocker. The validator's `unknownFailClosed` result is true.

## 14. Finding Scope

Policy scope counts are: automatic-mutation-safety 41, delivery-integrity 17, diagnostic-only 7, evidence-availability 8, evidence-consistency 10, format-compatibility 3, and review-routing 1.

## 15. Evidence Polarity

Policy polarity counts are: absence-of-support 42, contradictory-evidence 10, execution-diagnostic 14, format-advisory 3, positive-risk-evidence 17, and preservation-support 1. Absence of support is not treated as proof that the current output is defective.

## 16. FINAL_BLOCKER

Final blockers are reserved for positive current-output, authority, integrity, policy, freshness, or release-gate failures. The verified human run has 0 effective protected final blockers; the machine-only control has 2 and is rejected.

## 17. MUTATION_GUARD

Mutation guards prohibit unsupported automatic changes without asserting that the preserved human baseline is bad. The real human assessment contains 52 effective mutation-guard signal instances; the policy has 51 mutation-guard code definitions.

## 18. REVIEW_ADVISORY

Review advisories remain visible and actionable but do not block an otherwise eligible protected human-baseline release. The sample has 3 advisory signal instances and 6 advisory Review Items; those are different aggregation levels.

## 19. DIAGNOSTIC_ONLY

Fourteen diagnostic code definitions remain diagnostic, and the real assessment contains 14 effective diagnostic signal instances. They report execution or observation facts and cannot independently authorize or block a release.

## 20. CONTEXT_DEPENDENT

The two context-dependent codes are evaluated from verified authority, integrity, positive-risk, and preservation context. Context resolution is explicit in the effective findings rather than hidden in message text.

## 21. SUPERSEDED

`CTC_TARGET_UNREPRESENTABLE` is the one supersedable code. Two same-cue occurrences are superseded by verified C5.19 pronunciation-projection evidence; the original historical signals remain in the artifact.

## 22. Forced Alignment Meta Finding

`FORCED_ALIGNMENT_COMPONENT_UNRESOLVED` means a safe repair was not proven. For unchanged, verified-human preservation it is a mutation guard; it becomes blocking only when separate positive output or integrity evidence requires that result.

## 23. Overlap Context Finding

`ILLEGAL_SUBTITLE_OVERLAP` is not globally relabeled as legal. For this unchanged verified-human output it is an advisory because no positive defect is proven; the seven Review artifacts and unresolved overlap history remain available.

## 24. Freshness Engine

Freshness matches cue identity, canonical hash, timing hash, semantic subject, C5.19 lineage, and later evidence hash. Its real summary is 2 assessed, 0 current, 2 superseded, and 0 failed.

## 25. CTC_TARGET_UNREPRESENTABLE

The two affected cues are `human-reviewed-0140-2bd637f9d14d` and `human-reviewed-0142-8086b5bbb5e8`. C5.19 made both targets encodable without canonical text or timing mutation, so their old availability signals are superseded rather than deleted.

## 26. Root Cause Dedup

Seventy observed codes reduce to 10 root-risk families for the human sample. Derived and meta findings remain linked to member signal IDs so deduplication does not erase provenance or reduce safety checks by counting alone.

## 27. Current Output Risk

The human sample has 0 positive current-output defect-evidence signals. Six component risks remain `UNKNOWN`; one is `LOW_RISK` due to positive preservation evidence. Neither state claims acoustic ground truth.

## 28. Mutation Risk

All seven proposed overlap mutations remain `HIGH` risk and unavailable for safe automatic application. The protected result is produced by preserving verified human output, not by inventing a repair.

## 29. Baseline Preservation

Observe reports `eligible=true`, `applied=false`. Enforce A and B report `eligible=true`, `applied=true`. The negative control reports both false. All human-path checks pass with canonical text mutation 0 and canonical timing mutation 0.

## 30. Human Authority

Authority type is `user-confirmed-human-reviewed`. The ASS has SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`, size 17,094 bytes, and 192 cues; text and timing authority are both true.

## 31. Authority Verification

Human-file read-only, source-video read-only, coverage, lineage, cue hash, timing hash, source identity, and serialized-baseline checks all pass. Authority semantic hash: `bec55148effd940af0f97c8bbf86b53f4bf5885d50d9916c8dec234264b9a75a`.

## 32. Machine-only Release Gate

`machineOnlyReleaseAuthorized=false` is enforced by the strict policy and result schemas. No machine-only control path can create a final package or final subtitle names.

## 33. Blind Acceptance Requirement

The negative control records `blindAcceptanceRequired=true`, includes `MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED`, remains `needs-review` / `none`, and creates no final package.

## 34. Risk Assessment Sidecar

`subtitle-finalization-risk-assessment.json` records the policy, source identity, legacy state, authority, freshness, signal assessments, effective findings, root risks, component risks, preservation result, aggregate summary, protected outcome, and semantic hash under a strict schema.

## 35. Review Effective Disposition

`subtitle-review-effective-disposition.json` preserves all seven original Review object identities. Its protected projection is 0 mandatory, 6 advisory, and 1 preservation-supported; it does not delete or rewrite the legacy Review package.

## 36. Final-safe-with-advisories

The human path resolves to `FINAL_SAFE_WITH_ADVISORIES`. This means the verified human baseline is release-safe while non-mandatory advice remains; it does not mean machine transcription or overlap correction was accepted.

## 37. Legacy Findings Preservation

The final report retains 14 legacy blocking findings, 14 unresolved findings, and 7 Review Items as historical audit evidence. The protected sidecar separately records 0 effective protected final blockers.

## 38. Protected Gate

The protected gate passes only when human authority, policy integrity, freshness integrity, baseline preservation, current-output risk, mutation count, serialization, presentation, and Review Delivery checks all pass.

## 39. Integrity Gate

Source read-only, human ASS read-only, final-integrity, serialization round trip, SRT/VTT/ASS semantic parity, canonical parity, presentation parity, and Review Delivery integrity all pass.

## 40. Positive Risk Gate

Positive current-output defect evidence count is 0 for Observe and both human Enforce runs. Any such evidence would block enforce rather than being demoted by advisory logic.

## 41. Unknown Gate

Unknown observed count is 0 in all real inputs. The source policy still fails closed for any future unmapped code, and the unit test exercises that behavior.

## 42. Policy Integrity Gate

The policy is reparsed through the strict schema and its content hash must equal the committed policy hash. A tampering test changes one rationale and correctly produces `HUMAN_REVIEW_REQUIRED`.

## 43. Freshness Integrity Gate

The later C5.19 audit semantic hash, replay provenance, cue/timing hashes, target encodability, semantic subject, and evidence lineage all match. Validator result: `freshnessIntegrityPassed=true`.

## 44. ASS

Protected Enforce A/B emit a final ASS with identical bytes and semantic content. Enforce A SHA-256: `936ba3c0675bcfb3913f5d05fa5e1e5db88ccc07792b38fd81bdc7aa11412320`.

## 45. VTT

Protected Enforce A/B emit a final VTT with identical bytes and semantic content. Enforce A SHA-256: `53c14e2032f13c9ff4d2ff117be5d998d7192ca9fb7e400b01a33f20789eb76c`.

## 46. SRT

Protected Enforce A/B emit a final SRT with identical bytes and semantic content. Enforce A SHA-256: `fc4a3ed5d6338f1c02706ec443544312a5517916d54fcb42671a20e604a12edb`.

## 47. Presentation

Presentation hash is unchanged at `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`. Canonical text and timing mutation counts in the presentation artifact are both 0.

## 48. Component 1

`overlap-acoustic-8ff7342e69430b941161` covers cues 0140-0142. Current risk is `UNKNOWN`, speaker relationship is unresolved, subtitle overlap is unresolved, and its protected disposition is advisory.

## 49. Component 2

`overlap-acoustic-def4f9e5f20a6a24af59` covers cues 0019-0020. Current risk is `UNKNOWN`, speaker relationship is unresolved, subtitle overlap is unresolved, and its protected disposition is advisory.

## 50. Component 3

`overlap-acoustic-5e6df4ca8c77b3a51802` covers cues 0088-0089. Current risk is `UNKNOWN`, speaker relationship is unresolved, subtitle overlap is unresolved, and its protected disposition is advisory.

## 51. Component 4

`overlap-acoustic-de9815d25ae4c3a8e718` covers cues 0097-0098. The component has speaker relationship resolved and `CTC_LEGAL_OVERLAP_DELETED` preservation evidence, so current risk is `LOW_RISK` and disposition is preservation-supported. Subtitle overlap resolved remains false; no subtitle mutation is claimed.

## 52. Component 5

`overlap-acoustic-eef08480bdcbc8f48776` covers cues 0163-0164. Current risk is `UNKNOWN`, speaker relationship is unresolved, subtitle overlap is unresolved, and its protected disposition is advisory.

## 53. Component 6

`overlap-acoustic-5475b241d7d856b45194` covers cues 0145-0146. Current risk is `UNKNOWN`, speaker relationship is unresolved, subtitle overlap is unresolved, and its protected disposition is advisory.

## 54. Component 7

`overlap-acoustic-69e8f46141f7d9276a87` covers cues 0174-0176. Current risk is `UNKNOWN`, speaker relationship is unresolved, subtitle overlap is unresolved, and its protected disposition is advisory.

## 55. Legacy Run

The explicit Legacy output is `needs-review`, method `none`, Review 7, with no final package. It retains the inherited C5.19 shareable set and does not add C6 claims.

## 56. Default-no-flag Run

The no-flag output has exact semantic parity with explicit Legacy: `legacyDefaultParity=true`. It is `needs-review` / `none`, Review 7, and has no final package.

## 57. Protected Observe

Observe is `needs-review` / `none`, Review 7, and has no final package. Its sidecar outcome is `FINAL_SAFE_WITH_ADVISORIES`, with 14 legacy blockers, 0 protected final blockers, 0 mandatory reviews, 6 advisories, and 1 preservation-supported item.

## 58. Protected Enforce A

Enforce A verifies the user-confirmed human authority and emits `human-validated` / `human`, `.final.srt`, `.final.vtt`, `.final.ass`, and `subtitle-package.final.json`. The strict final package SHA-256 is `143618b7f8c9ae279a47c1bea72571b0b5d8453091ebe75b41d96c6d96e1a4c6`.

## 59. Protected Enforce B

Enforce B independently reaches the same outcome, status, method, risk/freshness/root/review hashes, canonical identities, and final subtitle bytes as Enforce A.

## 60. Machine Negative Control

The authority-negative control yields `MACHINE_ONLY_NOT_AUTHORIZED`, 2 effective protected final blockers, 7 mandatory Review Items, `needs-review` / `none`, and no final package.

## 61. Determinism

Enforce A/B semantic parity is true. Shared hashes include freshness `fffb07a0c26ebf2ad18241bf9a0a45e3a4d8cd8bd512c9af26f9a55fa62649d4`, root risk `b351c61789293a4950259a5997a5d2f22712e583b63f00de9f73d1a9d5bfcf4e`, risk assessment `dfd882893ec1ea2ed16b4768cc42a77b8d4610580d555df61e9a0c58c708c0a5`, and review disposition `c39fb43317263b823809619183c4d6eaa5a91d4e9b9b67517426c0d5f3ef84e3`.

## 62. Canonical Hash

All six runs preserve canonical cue hash `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`; canonical text mutation count is 0.

## 63. Timing Hash

All six runs preserve canonical timing hash `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`; canonical timing mutation count is 0.

## 64. Presentation Hash

Legacy, Default, Observe, Enforce A/B, and Negative Control all preserve `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`.

## 65. Review Items

Legacy Review Item count and protected Review artifact count both remain 7. The Review objects and local audio remain available after protected human finalization.

## 66. Effective Mandatory Review

The verified human result has 0 effective mandatory Review Items. The machine negative control has 7, demonstrating that advisory semantics are authority-dependent rather than a blanket demotion.

## 67. Advisories

The verified human result contains 6 advisory Review Items and 1 preservation-supported item. Speaker relationship resolved count is 1; subtitle overlap resolved count is 0.

## 68. Review Delivery

Review Delivery Integrity passes with 7/7 physical, referenced, and playable WAVs and no mismatches, missing references, or broken page links. `deliveryVersion=C5.17.2` denotes the reused, already-validated Review Delivery subsystem; it does not label the C6.0 risk-engine version.

## 69. Shareable

Legacy and Default retain 41/41 passing C5.19 shareable artifacts. Observe, Enforce A/B, and Negative Control each contain 14/14 passing C6.0 shareable artifacts, including central validation; every audit has absolute-path leak 0, prohibited-secret count 0, and broken-relative-reference count 0.

## 70. Skill 2

Read-only compatibility repo HEAD `1af10bd8a7057c573959f39a745436fa837127ea` passed typecheck and build. It parsed the Protected Enforce final strict v1 package at 192 cues and, through its deterministic test-only mock adapter, produced the required 106-sentence / 106-grammar-point compatibility report. This is contract/E2E evidence, not a claimed user-facing model analysis.

## 71. Skill 3

Read-only compatibility repo HEAD `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8` passed typecheck, 1/1 test, build, and real site generation. Input and generated-site copies of `grammar-report.json` share SHA-256 `9f30e0ad768744864743cec812a25b5974bc3bf1839e60ea9030a06f0894defc`; both compatibility repositories remain clean.

## 72. Tests

Node 24/npm 11 validation passed: 49 test files, 562 passed, and 2 intentional existing skips. Typecheck, ESLint, Prettier check, production build, and Skill quick validation also pass.

## 73. E2E

Full E2E passed 12 files with 30 passed and 1 intentional existing skip. C5.19 targeted passed 32/32, C6 Investigation targeted passed 10/10, and C6 Protected targeted passed 36/36, including the real C5.19-like human and authority-negative flows.

## 74. Schema

Schema generation emits 137 strict JSON Schemas. C6.0 Protected adds exactly eight: policy, authority, freshness, baseline preservation, risk assessment, review disposition, replay summary, and cross-run validation. `SubtitleCue` and the Skill 2 strict v1 package remain unchanged.

## 75. Input Read-only

The human ASS remains `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e` (17,094 bytes). The source video remains `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` (847,774,958 bytes). Cross-run validation reports `inputReadOnlyVerified=true`.

## 76. Network

Every C6 replay summary records `networkUsed=false`. No online subtitle lookup, provider API, model download, or web request occurred.

## 77. Model Execution

Every C6 replay records model inference count 0 and model load count 0, with all Whisper, MFA, speaker, CTC, separation, OpenAI, online-search, and whole-media-ASR execution counters at 0. Historical upstream counters retained in the copied C5.19 report are provenance, not C6 execution.

## 78. Legacy Regression

Production diff review shows that only `finalization.ts` and the CLI changed among `finalization.ts`, `finalization-support.ts`, `review.ts`, and CLI. The new finalization branch is entered only for a non-legacy C6 mode; support and legacy Review code are unchanged.

## 79. Threshold Audit

No CTC, MFA, speaker, overlap, or presentation threshold file changed from the investigation baseline. C6 decisions come from audited risk semantics and authority/integrity gates, not relaxed evidence thresholds.

## 80. Unsafe CLI Audit

Source and generated help contain no C6 bypass, force-release, blind-accept, or unsafe override. Invalid modes are rejected by the CLI choice schema, and machine-only enforce is fail-closed.

## 81. Remaining Machine-only Gap

C6.0 has no calibrated blind-acceptance evidence capable of proving a machine-only baseline safe. Therefore `machineOnlyReleaseAuthorized=false` remains a deliberate product and safety boundary.

## 82. C6.0.1 Requirements

C6.0.1 must investigate machine-only blind acceptance independently: define positive and negative release evidence, calibrated unseen-sample evaluation, authority-free integrity requirements, false-accept bounds, fail-closed unknown behavior, and a separate rollout gate. It must not inherit human-baseline preservation as machine authority.

## 83. Whether C6.0.1 Can Start

GO for C6.0.1 Investigation/Acceptance work because the protected policy, integrity, replay, and negative-control infrastructure now pass. NO-GO for machine-only default release until that separate evidence and acceptance gate passes.

## 84. Commits

Risk engine: `88a500d2039d8a65e3f186b57dc3725a00ab80d5` (`feat: add C6.0 protected finalization risk engine`). Integration: `43350c849899278c87460108be122211b286d8ea` (`feat: integrate protected finalization and advisory review`). Acceptance: the commit containing this report, titled `docs: record C6.0 protected finalization acceptance`; its resolved SHA is reported in the final handoff to avoid a self-referential commit hash.

## 85. Remote HEAD

The required remote ref is `refs/heads/codex/c6-0-protected-finalization-risk-engine`. Post-commit push verification must show this ref equal to the acceptance commit; the resolved value is recorded in the final handoff.

## 86. Output Paths

- Legacy: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-legacy-20260827`
- Default: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-default-20260827`
- Observe: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-observe-20260827`
- Enforce A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-enforce-a-20260827`
- Enforce B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-enforce-b-20260827`
- Negative Control: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-authority-negative-control-20260827`
- Validation: `/Users/paulasmith/Documents/Codex-Skills/output/c6-0-protected-finalization-validation-20260827.json`
- Skill 2 compatibility: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-enforce-a-20260827/skill2-protected-final-compatibility-readonly`
- Skill 3 compatibility: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c6-0-protected-enforce-a-20260827/skill3-protected-final-compatibility-readonly`
