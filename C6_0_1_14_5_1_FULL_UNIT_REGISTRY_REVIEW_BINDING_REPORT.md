# C6.0.1.14.5.1 Full Speech Evidence Unit Registry and Review Binding Report

## Executive conclusion

C6.0.1.14.5.1 engineering acceptance passed under a strict replay-only policy. The machine build registered all 42,434,917 verified-positive speech samples into 1,505 Full Registry Units, preserved the legacy 81-Unit planning projection exactly, bound the existing review delivery through positive-overlap provenance, built 37 inherited and 35 effective realizations, searched 54 witness groups, rebuilt the true ALL_MANDATORY subset, froze before Gold, and passed 20/20 artifact checks. Detector replay was 18/18, ASR replay was 44/44, and inference, model load, provider start, canonical text mutation, timing mutation, and presentation mutation were all zero.

This is not subtitle-quality acceptance and not machine release authorization. One of 106 required review targets remains deliberately unbound because its 3 ms interval has only boundary contact and no positive-duration Unit overlap. Only 1/6 Missing components is scorable, and that component is a real product-contract failure; the other 5 are explicitly NOT_SCORABLE. Formal Product Contract Recall is therefore null, not 0/6. The correct route is HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR, production remains needs-review, finalizationMethod remains none, and C6.0.2 remains HOLD.

## Frozen identities

- Branch: codex/c6-0-1-14-5-1-full-unit-registry-review-binding
- Policy: c6.0.1.14.5.1-full-unit-registry-review-binding-v1
- Policy SHA-256: bc7478ac8e3bd67fed93a0245718ee7cd85ff935b633f05a06d95a59656dcb64
- Source SHA-256: 294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43
- Gold SHA-256: a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e
- Final A Freeze: be08890d846c42fcc5c99c944781e140acd3b07cc1242d3676dcac68276dd0d5
- Final B Freeze: e2e27c8e928c2839cf4dd7d3f05520d9329308e728cbc9f26d43d73e6d464c4a
- Final A/B parity: 68ebc18ed7e2c844cc96e8e12e4182d5d413a2de29c626a669cf91aad37c3ca4
- Review JavaScript: b47a38a0ea6b9d34d7560afbf8f6ec5371cee394227af331f35dcbc9acb2cfb2
- Canonical text: e117fd080a71b244bc39086c82a4972c9335f7c64cef07cc2df1bfbbcd992e05
- Canonical timing: e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936
- Presentation: ddb9c9f5f97acb7bc5c87925983da6d64d12e1a825025f736744f32aeec13d98

## 154 required report topics

|   # | Topic                                        | Verified result                                                                                                                                    |
| --: | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Executive Conclusion                         | Engineering acceptance passed; product quality and machine release remain held.                                                                    |
|   2 | Branch                                       | codex/c6-0-1-14-5-1-full-unit-registry-review-binding.                                                                                             |
|   3 | Baseline                                     | C6.0.1.14.5 baseline state suffix -10; all input identities were frozen.                                                                           |
|   4 | C6.0.1.14.5 Replay                           | Reused 18 detector and 44 ASR cache entries; no miss or inference.                                                                                 |
|   5 | Goals                                        | Full Registry, review binding, inherited realizations, witness search, scorability, true mandatory, refreeze, isolated evaluation.                 |
|   6 | Non-goals                                    | No Planner, detector, ASR, subtitle, timing, presentation, ranker, OOF, Skill 2, or Skill 3 change.                                                |
|   7 | Why Budget Redesign Was Deferred             | Safety-budget gate passed; an earlier required Target-binding failure controls the route.                                                          |
|   8 | Why Planner Was Not Modified                 | The 81-Unit planning projection and all selected IDs/objective were already valid and remained byte/semantic equivalent.                           |
|   9 | Why Detector/ASR Were Not Run                | Policy maximum inference/model/provider counts were all zero and every required cache entry existed.                                               |
|  10 | Registry/Binding Baseline Audit              | Root causes were reproduced before remediation; baseline hash e54cc6ad5901064d256bbadfdc358728d096087ff0f07597e0aba17c6923073b.                    |
|  11 | Verified Speech Row Count                    | 4,660.                                                                                                                                             |
|  12 | Verified Speech Union                        | 42,434,917 samples / 884.0607708333333 s across 68 atomic intervals.                                                                               |
|  13 | Existing 81 Unit Coverage                    | 10,460,099 samples / 217.91872916666668 s.                                                                                                         |
|  14 | Registry Coverage Gap                        | Legacy ratio 0.24649745397169034; 31,974,818 verified samples were outside the planning registry.                                                  |
|  15 | buildCoverageUnits145 Filtering Semantics    | cueCovered and immutableTargetCovered exclusions define uncovered planning candidates, not global identity.                                        |
|  16 | Full Registry Design                         | Source-native atomic partition over every verified-positive speech sample, independent of planning eligibility.                                    |
|  17 | Coverage-state Partition                     | cue 0, immutable 0, existing-review 1,173, uncovered-planning 332, partial 0 Units.                                                                |
|  18 | Full Registry Unit Count                     | 1,505.                                                                                                                                             |
|  19 | Full Registry Union                          | 42,434,917 samples / 884.0607708333333 s.                                                                                                          |
|  20 | Registry Completeness Gate                   | PASS: ratio 1 and unregistered samples 0.                                                                                                          |
|  21 | Source Reconciliation                        | 4,660/4,660 rows mapped; unmapped 0; registered union parity true.                                                                                 |
|  22 | Planning Projection                          | Legacy 81 Units remain a separate uncovered-safety projection.                                                                                     |
|  23 | Planning Projection Parity                   | Semantic, bundle, child, realization, and objective parity are all true.                                                                           |
|  24 | Legacy Unit Compatibility                    | All 81 legacy Units have verified positive-overlap mappings.                                                                                       |
|  25 | Exact Unit Mappings                          | 14.                                                                                                                                                |
|  26 | One-to-many Mappings                         | 66.                                                                                                                                                |
|  27 | Many-to-one Mappings                         | 0.                                                                                                                                                 |
|  28 | Unresolved Unit Mappings                     | 0; selected-Unit mapping coverage 1.                                                                                                               |
|  29 | Target Binding Requirements                  | REQUIRED 106, OPTIONAL 205, NOT_APPLICABLE 17.                                                                                                     |
|  30 | Target Binding Basis                         | Source identity, verified evidence provenance, atomic target core, and positive source-native overlap; proximity alone is rejected.                |
|  31 | Required Target Count                        | 106.                                                                                                                                               |
|  32 | Required Target Bound Count                  | 105; one 3 ms boundary-only Target remains fail-closed.                                                                                            |
|  33 | Optional Target Count                        | 205.                                                                                                                                               |
|  34 | Non-speech Target Count                      | 17 NOT_APPLICABLE.                                                                                                                                 |
|  35 | Target→Unit Pair Count                       | 1,736 accepted pairs.                                                                                                                              |
|  36 | Zero-overlap Target Bindings                 | 262 candidates rejected; product-eligible accepted zero-overlap count 0.                                                                           |
|  37 | Region Bindings                              | 1,107 Region→Unit pairs.                                                                                                                           |
|  38 | Audio Bindings                               | 1,107 Audio→Unit pairs.                                                                                                                            |
|  39 | Playback Bindings                            | 1,250 Playback→Unit pairs.                                                                                                                         |
|  40 | Audio→Unit Zero-overlap                      | 0 accepted product pairs and 0 rejected rows.                                                                                                      |
|  41 | Playback→Unit Zero-overlap                   | 13,193 candidates rejected; 0 accepted product pairs.                                                                                              |
|  42 | Existing Review Delivery Graph               | Target, Region, physical Audio, Playback, Unit, and realization provenance are cross-bound and hash-rebound.                                       |
|  43 | Arbitrary Fallback Removal                   | Selected Bundle without selected Realization now fails closed; unselected fallback after repair is 0.                                              |
|  44 | Planner-selected Realization Integrity       | 24 Safety Targets bind only through the frozen 19 unique selected realization IDs.                                                                 |
|  45 | Inherited Realization Ontology               | INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION requires valid Target, physical WAV, Playback, positive Unit overlap, and matching source identity. |
|  46 | Inherited Target Realizations                | 26.                                                                                                                                                |
|  47 | Inherited Region Realizations                | 10.                                                                                                                                                |
|  48 | Inherited Realization Count                  | 37 total, including 1 multi-target realization.                                                                                                    |
|  49 | Inherited Realization Rejections             | 695 explicit rejected candidates; missing audio/playback/source mismatch/zero overlap are all 0 among accepted rows.                               |
|  50 | Effective Product Realization Registry       | 35 effective realizations from Planner-selected plus inherited evidence.                                                                           |
|  51 | Realization Deduplication                    | 1 Planner/inherited duplicate and 9 total deduplications.                                                                                          |
|  52 | Witness Group Design                         | Connected components over compatible effective realizations, bounded at 6 Units and 8 realizations per candidate.                                  |
|  53 | Witness Group Connectivity                   | Positive anchored Unit/delivery connectivity only; no Gold input.                                                                                  |
|  54 | Witness Group Count                          | 54.                                                                                                                                                |
|  55 | Single-Unit Witness                          | 26 machine candidate groups; final Gold-scored pass count 0.                                                                                       |
|  56 | Multi-Unit Witness                           | 28 machine candidate groups; final Gold-scored pass count 0.                                                                                       |
|  57 | Multi-Unit Union Coverage                    | Supported by evaluator; no component was newly recovered by a multi-Unit witness in this run.                                                      |
|  58 | Per-Unit Anchor Requirement                  | Every participating Unit must satisfy independent machine anchor overlap and coverage thresholds.                                                  |
|  59 | Per-Unit Playback Requirement                | Every participating Unit must have physical Audio and at least 0.95 Playback-to-Unit coverage.                                                     |
|  60 | Witness Search Completeness                  | true; Gold input count 0.                                                                                                                          |
|  61 | Scorability Ontology                         | Distinguishes SCORABLE_PASS/FAIL from no Target binding, no effective realization, and integrity failure.                                          |
|  62 | Scorable Components                          | 1/6.                                                                                                                                               |
|  63 | Unscorable Components                        | 5/6.                                                                                                                                               |
|  64 | Why Unscorable Is Not Numeric Zero           | Missing prerequisites make the denominator undefined; formal recall is therefore null.                                                             |
|  65 | Review Targets V8                            | 328 rows; interval mutation 0.                                                                                                                     |
|  66 | Review Items V10                             | 198 rows; rankerRetrained false and newOofRun false.                                                                                               |
|  67 | Review Regions V9                            | 84 rows; interval mutation 0.                                                                                                                      |
|  68 | Audio Manifest V9                            | 84 physical, playable, hash-verified WAVs; delivery subsystem remains the reused C6.0.1.12 audio subsystem.                                        |
|  69 | Playback Timeline V8                         | 601 segments; Audio/Target/Full-Unit coverage ratios all 1.                                                                                        |
|  70 | Geometry Parity                              | Planner, Target, Region, Audio, and Playback parity all true.                                                                                      |
|  71 | WAV Byte Parity                              | true; 84 unique WAVs and 168 A/B byte checks passed.                                                                                               |
|  72 | Target / Region Interval Parity              | Both true; no geometry mutation.                                                                                                                   |
|  73 | ALL_MANDATORY Bug                            | Previous reporting copied full-queue counts; it did not evaluate the frozen mandatory subset.                                                      |
|  74 | True Mandatory Plan                          | Uses the actual ALL_MANDATORY IDs frozen in Playback V8.                                                                                           |
|  75 | Mandatory Item Count                         | 93.                                                                                                                                                |
|  76 | Mandatory Region Count                       | 13.                                                                                                                                                |
|  77 | Mandatory Target Count                       | 153.                                                                                                                                               |
|  78 | Mandatory Audio Count                        | 13.                                                                                                                                                |
|  79 | Mandatory Playback Count                     | 239.                                                                                                                                               |
|  80 | Mandatory Unique Audio                       | 235.19535399999984 s.                                                                                                                              |
|  81 | Projection Hash Rebinding                    | 1,295/1,295 projected rows rebound; stale 0.                                                                                                       |
|  82 | Nested Preflight                             | 13,052 nested rows verified; failures 0; preGold true.                                                                                             |
|  83 | Machine Freeze                               | Final A be08890d...; Final B e2e27c8e...; Review JS hash is also frozen.                                                                           |
|  84 | Gold First Read                              | 65.116 s after Final A freeze; machine-stage Gold path/derived reads 0/0.                                                                          |
|  85 | R0 Official Baseline                         | NOT_SCORABLE; 0 scorable, 6 unscorable, formal recall null.                                                                                        |
|  86 | R1 Full Registry Annotation                  | Registry 1,505/100%; still 0 scorable because delivery is absent in this ablation.                                                                 |
|  87 | R2 Target Binding                            | 1,736 pairs; still 0 scorable without inherited realizations.                                                                                      |
|  88 | R3 Inherited Realization                     | 37 inherited/35 effective; 1 scorable fail and 5 unscorable.                                                                                       |
|  89 | R4 Single-Unit Contract                      | 1 scorable fail; no pass.                                                                                                                          |
|  90 | R5 Multi-Unit Contract                       | 1 scorable fail; no additional recovery.                                                                                                           |
|  91 | R6 Final Full Queue                          | NOT_SCORABLE; formal recall null; ordinary audible 5/6.                                                                                            |
|  92 | R7 True ALL_MANDATORY                        | NOT_SCORABLE; 93 items, 13 regions, 235.195354 s.                                                                                                  |
|  93 | Product Scorability                          | 1 scorable, 5 unscorable, 0 integrity failures.                                                                                                    |
|  94 | Product Contract Formal Recall               | NOT_SCORABLE / null.                                                                                                                               |
|  95 | Scorable-subset Recall                       | 0/1 = 0; diagnostic only.                                                                                                                          |
|  96 | Target-Core Recall                           | 4/6 = 0.6666666666666666.                                                                                                                          |
|  97 | Ordinary Physical Audio Recall               | 5/6 = 0.8333333333333334.                                                                                                                          |
|  98 | Ordinary Playback Audible Recall             | 5/6 = 0.8333333333333334.                                                                                                                          |
|  99 | Hallucination Recall                         | Target/physical/audible are all 1/1.                                                                                                               |
| 100 | Per-component Unit Mapping                   | All six have matching Full Units; only 0073 has a realized product witness.                                                                        |
| 101 | Per-component Realization Origin             | 0073 is inherited; the other five have no effective realization.                                                                                   |
| 102 | Per-component Witness Set                    | 0073 has one witness group/one effective realization; the other five have none.                                                                    |
| 103 | Mapping-unresolved Components                | 0 Full-Registry mappings unresolved; one component has no Target binding.                                                                          |
| 104 | Scorable Contract Failures                   | 1: component 0073, caused by Gold playback coverage 0.5917 and per-Unit playback 0.4562.                                                           |
| 105 | Inventory→Target Failures                    | 2/6 Missing components have inventory evidence but no final Target-core coverage.                                                                  |
| 106 | Review Audio Failures                        | 1/6 ordinary components lacks physical/audible review delivery.                                                                                    |
| 107 | Budget-infeasible Components                 | 0 proven; SAFETYBUDGETS gate passed.                                                                                                               |
| 108 | Route Priority                               | Required Target binding is the first failed gate, before scorability and product quality.                                                          |
| 109 | Why Budget Infeasibility Is or Is Not Proven | Not proven: the frozen budget is feasible; missing binding/delivery prerequisites dominate.                                                        |
| 110 | Full Queue Gate                              | FAIL_CLOSED: formal Product Recall is not scorable and required binding is incomplete.                                                             |
| 111 | ALL_MANDATORY Diagnostic                     | Correctly calculated but diagnostic until ranker recalibration; it does not authorize release.                                                     |
| 112 | Ranker Not Retrained                         | false for rankerRetrained.                                                                                                                         |
| 113 | No OOF                                       | newOofRun false.                                                                                                                                   |
| 114 | Detector Replay                              | 18 expected, 18 hits, 0 misses, 0 new inference.                                                                                                   |
| 115 | ASR Replay                                   | 44 expected, 44 hits, 0 misses, 0 new inference.                                                                                                   |
| 116 | New Inference Count                          | 0; model loads 0; provider starts 0.                                                                                                               |
| 117 | Planner Parity                               | All five planning parity checks true.                                                                                                              |
| 118 | Machine Text Parity                          | Canonical text hash unchanged; mutation 0.                                                                                                         |
| 119 | Machine Timing Parity                        | Canonical timing hash unchanged; mutation 0.                                                                                                       |
| 120 | Presentation Parity                          | Presentation hash unchanged; mutation 0.                                                                                                           |
| 121 | ASS/SRT/VTT Parity                           | true across Final A/B; no protected subtitle byte change.                                                                                          |
| 122 | Final A/B Parity                             | 19 compared artifacts; semantic/geometry/WAV/subtitle parity true, mismatches 0.                                                                   |
| 123 | Runtime Gold Input                           | 0 before freeze; 1 isolated evaluator read after durable freeze.                                                                                   |
| 124 | Dataset Hardcoding                           | None; thresholds are policy-driven and Gold is excluded from machine artifacts.                                                                    |
| 125 | Network                                      | false; all work used local artifacts and cache replay.                                                                                             |
| 126 | Source Read-only                             | true; before/after SHA, size, mtime, inode identical.                                                                                              |
| 127 | Gold Read-only                               | true; before/after SHA, size, mtime, inode identical.                                                                                              |
| 128 | Shareable Audit                              | PASS; absolute paths, secrets, raw audio refs, dialogue text, Gold content, credentials all 0.                                                     |
| 129 | Unit Tests                                   | Full suite: 1,296 passed, 2 skipped across 153 files.                                                                                              |
| 130 | E2E                                          | 74 passed, 1 skipped across 33 files.                                                                                                              |
| 131 | UI Tests                                     | 60/60 across 7 explicit UI files.                                                                                                                  |
| 132 | Browser Tests                                | 12/12 real Chrome assertions; one WAV played; page errors 0; no decision persisted.                                                                |
| 133 | Targeted Tests                               | C6.0.1.14.5 11/11 and C6.0.1.14.5.1 11/11.                                                                                                         |
| 134 | Cross-version Regressions                    | 789/789 across 104 C5.19-through-current files.                                                                                                    |
| 135 | Schema Count                                 | 606 JSON Schemas generated; strict machine-freeze schema includes reviewJavascriptHash.                                                            |
| 136 | Skill Validation                             | Skill is valid.                                                                                                                                    |
| 137 | Engineering Gate                             | PASS.                                                                                                                                              |
| 138 | Full Registry Gate                           | PASS.                                                                                                                                              |
| 139 | Binding Gate                                 | FAIL_CLOSED for 1 required unbound Target; accepted-pair integrity passes.                                                                         |
| 140 | Inherited Realization Gate                   | PASS.                                                                                                                                              |
| 141 | Witness Gate                                 | PASS for construction/search integrity; no product pass recovered.                                                                                 |
| 142 | Scorability Gate                             | FAIL: only 1/6 scorable.                                                                                                                           |
| 143 | Evaluation Integrity Gate                    | PASS; nullability, freeze barrier, identity, and witness binding verified.                                                                         |
| 144 | Product Quality Gate                         | FAIL.                                                                                                                                              |
| 145 | Route Decision                               | HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR.                                                                                                      |
| 146 | C6.0.1.15 Readiness                          | NO_GO until binding, target coverage, physical delivery, and scorability gates pass.                                                               |
| 147 | Possible C6.0.1.14.6 Need                    | Yes: a narrowly scoped Review Delivery Unit Binding/remaining delivery repair may be required.                                                     |
| 148 | C6.0.2 Status                                | HOLD.                                                                                                                                              |
| 149 | Human Trial Status                           | Not run; browser acceptance is engineering QA, not a human subtitle trial.                                                                         |
| 150 | Remaining Risks                              | One required boundary-only Target, five unscorable components, two target gaps, one audio gap, one real product failure.                           |
| 151 | Next-stage Recommendation                    | Repair the required Target binding without proximity fallback, then close remaining Target/Audio delivery and re-evaluate.                         |
| 152 | Commits                                      | 73c6f3d, 65acb5e, 9af30ff, 3397e0c, 64bf3c2, plus the documentation commit containing this report.                                                 |
| 153 | Remote HEAD                                  | Verified after push and reported in the final delivery receipt; report content cannot self-embed its own commit SHA.                               |
| 154 | Output Paths                                 | Twelve immutable -20260902-7 output roots are listed below.                                                                                        |

## 180 acceptance metrics

|   # | Metric                                          | Verified value                                                                                                         |
| --: | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
|   1 | Branch                                          | `codex/c6-0-1-14-5-1-full-unit-registry-review-binding`                                                                |
|   2 | Baseline                                        | Frozen C6.0.1.14.5 replay baseline; official outputs use suffix `-20260902-7`                                          |
|   3 | Full Registry Commit                            | `73c6f3d`                                                                                                              |
|   4 | Review Binding Commit                           | `73c6f3d`                                                                                                              |
|   5 | Inherited Realization Commit                    | `73c6f3d`                                                                                                              |
|   6 | Multi-Unit Witness Commit                       | `73c6f3d`                                                                                                              |
|   7 | ALL_MANDATORY / Scorability Commit              | `73c6f3d`                                                                                                              |
|   8 | Re-freeze / Evaluation Commit                   | `73c6f3d`; guarded Review UI refreeze correction `64bf3c2`                                                             |
|   9 | Acceptance Commit                               | The documentation commit containing this report; SHA is recorded in the delivery receipt after commit creation         |
|  10 | Remote HEAD                                     | Verified after push and recorded in the delivery receipt                                                               |
|  11 | Local / Remote Parity                           | Required and verified after push with local HEAD, upstream ref, and `git ls-remote`                                    |
|  12 | Policy Version                                  | `c6.0.1.14.5.1-full-unit-registry-review-binding-v1`                                                                   |
|  13 | Policy Hash                                     | `bc7478ac8e3bd67fed93a0245718ee7cd85ff935b633f05a06d95a59656dcb64`                                                     |
|  14 | Baseline Replay Passed                          | true                                                                                                                   |
|  15 | Machine Cue Count                               | 161                                                                                                                    |
|  16 | Detector Replay Expected                        | 18                                                                                                                     |
|  17 | Detector Replay Hits                            | 18                                                                                                                     |
|  18 | Detector Replay Misses                          | 0                                                                                                                      |
|  19 | Detector New Inference                          | 0                                                                                                                      |
|  20 | ASR Replay Expected                             | 44                                                                                                                     |
|  21 | ASR Replay Hits                                 | 44                                                                                                                     |
|  22 | ASR Replay Misses                               | 0                                                                                                                      |
|  23 | ASR New Inference                               | 0                                                                                                                      |
|  24 | Model Loads                                     | 0                                                                                                                      |
|  25 | Provider Process Starts                         | 0                                                                                                                      |
|  26 | Verified Speech Rows                            | 4,660                                                                                                                  |
|  27 | Verified Atomic Intervals                       | 68                                                                                                                     |
|  28 | Verified Union Samples                          | 42,434,917                                                                                                             |
|  29 | Verified Union Seconds                          | 884.0607708333333                                                                                                      |
|  30 | Legacy Unit Count                               | 81                                                                                                                     |
|  31 | Legacy Unit Seconds                             | 217.91872916666668                                                                                                     |
|  32 | Legacy Coverage Ratio                           | 0.24649745397169034                                                                                                    |
|  33 | Full Registry Unit Count                        | 1,505                                                                                                                  |
|  34 | Full Registry Atomic Count                      | 1,505                                                                                                                  |
|  35 | Full Registry Samples                           | 42,434,917                                                                                                             |
|  36 | Full Registry Seconds                           | 884.0607708333333                                                                                                      |
|  37 | Full Registry Coverage Ratio                    | 1                                                                                                                      |
|  38 | Unregistered Verified Samples                   | 0                                                                                                                      |
|  39 | Unregistered Expected                           | 0; PASS                                                                                                                |
|  40 | Cue-covered Units                               | 0                                                                                                                      |
|  41 | Immutable-target-covered Units                  | 0                                                                                                                      |
|  42 | Existing-review-covered Units                   | 1,173                                                                                                                  |
|  43 | Uncovered-planning Units                        | 332                                                                                                                    |
|  44 | Partial-coverage Units                          | 0                                                                                                                      |
|  45 | Exact Legacy→Full Mappings                      | 14                                                                                                                     |
|  46 | One-to-many Legacy→Full Mappings                | 66                                                                                                                     |
|  47 | Many-to-one Legacy→Full Mappings                | 0                                                                                                                      |
|  48 | Unresolved Legacy Mappings                      | 0                                                                                                                      |
|  49 | Planner-selected Mapping Coverage               | 1                                                                                                                      |
|  50 | Planning Semantic Parity                        | true                                                                                                                   |
|  51 | Planning Bundle Parity                          | true                                                                                                                   |
|  52 | Planning Child Parity                           | true                                                                                                                   |
|  53 | Planning Realization Parity                     | true                                                                                                                   |
|  54 | Planning Objective Parity                       | true                                                                                                                   |
|  55 | Review Target Count                             | 328                                                                                                                    |
|  56 | Required Target Count                           | 106                                                                                                                    |
|  57 | Optional Target Count                           | 205                                                                                                                    |
|  58 | NOT_APPLICABLE Target Count                     | 17                                                                                                                     |
|  59 | Required Target Bound                           | 105                                                                                                                    |
|  60 | Required Target Unbound                         | 1                                                                                                                      |
|  61 | Required Unbound Expected                       | 0; gate fails closed                                                                                                   |
|  62 | Accepted Target→Unit Pairs                      | 1,736                                                                                                                  |
|  63 | Rejected Zero-overlap Target Candidates         | 262                                                                                                                    |
|  64 | Accepted Product Target Zero-overlap            | 0                                                                                                                      |
|  65 | Accepted Product Target Zero-overlap Expected   | 0; PASS                                                                                                                |
|  66 | Region→Unit Pairs                               | 1,107                                                                                                                  |
|  67 | Audio→Unit Pairs                                | 1,107                                                                                                                  |
|  68 | Accepted Audio Zero-overlap                     | 0                                                                                                                      |
|  69 | Accepted Audio Zero-overlap Expected            | 0; PASS                                                                                                                |
|  70 | Playback→Unit Pairs                             | 1,250                                                                                                                  |
|  71 | Accepted Product Playback Zero-overlap          | 0; 13,193 candidates rejected                                                                                          |
|  72 | Accepted Product Playback Zero-overlap Expected | 0; PASS                                                                                                                |
|  73 | Safety Target Count                             | 24                                                                                                                     |
|  74 | Planner-selected Realization Binding            | 24 Safety Targets / 19 unique selected realizations                                                                    |
|  75 | Unselected Fallback Before Repair               | 5 fallback realizations; 13 Targets bound to unselected realizations                                                   |
|  76 | Unselected Fallback After Repair                | 0                                                                                                                      |
|  77 | Unselected Fallback Expected                    | 0; PASS                                                                                                                |
|  78 | Inherited Target Realizations                   | 26                                                                                                                     |
|  79 | Inherited Region Realizations                   | 10                                                                                                                     |
|  80 | Inherited Multi-target Realizations             | 1                                                                                                                      |
|  81 | Inherited Realization Rejections                | 695                                                                                                                    |
|  82 | Accepted Inherited Missing Audio                | 0                                                                                                                      |
|  83 | Accepted Inherited Missing Playback             | 0                                                                                                                      |
|  84 | Effective Product Realizations                  | 35                                                                                                                     |
|  85 | Planner/Inherited Duplicate Count               | 1                                                                                                                      |
|  86 | Total Realization Deduplications                | 9                                                                                                                      |
|  87 | Witness Group Count                             | 54                                                                                                                     |
|  88 | Single-Unit Candidate Groups                    | 26                                                                                                                     |
|  89 | Multi-Unit Candidate Groups                     | 28                                                                                                                     |
|  90 | Maximum Units per Candidate                     | 6                                                                                                                      |
|  91 | Witness Search Complete                         | true; Gold input count 0                                                                                               |
|  92 | Review Targets Before                           | 328                                                                                                                    |
|  93 | Review Targets After                            | 328                                                                                                                    |
|  94 | Target Interval Mutations                       | 0                                                                                                                      |
|  95 | Review Regions Before                           | 84                                                                                                                     |
|  96 | Review Regions After                            | 84                                                                                                                     |
|  97 | Region Interval Mutations                       | 0                                                                                                                      |
|  98 | Physical Review Audio Count                     | 84                                                                                                                     |
|  99 | Playable Review Audio Count                     | 84                                                                                                                     |
| 100 | WAV Hash Verified Count                         | 84                                                                                                                     |
| 101 | Unexpected WAV Byte Changes                     | 0                                                                                                                      |
| 102 | Audio Mutations                                 | 0                                                                                                                      |
| 103 | Playback Segment Count                          | 601                                                                                                                    |
| 104 | Playback Interval Mutations                     | 0                                                                                                                      |
| 105 | Playback→Audio Coverage                         | 1                                                                                                                      |
| 106 | Playback→Target Coverage                        | 1                                                                                                                      |
| 107 | Playback→Full-Unit Coverage                     | 1                                                                                                                      |
| 108 | Projection Hash Rebinding                       | 1,295/1,295; stale 0                                                                                                   |
| 109 | Nested Integrity Failures                       | 0 across 13,052 nested rows                                                                                            |
| 110 | Machine Freeze Built                            | true; A and B durable freezes created                                                                                  |
| 111 | Freeze Before Gold                              | true                                                                                                                   |
| 112 | Runtime Gold Reads Before Freeze                | path 0 / derived artifact 0                                                                                            |
| 113 | R0 Official Baseline                            | 0 scorable / 6 unscorable / formal recall null                                                                         |
| 114 | R1 Full Registry Annotation                     | 0 scorable / 6 unscorable / formal recall null                                                                         |
| 115 | R2 Target Binding                               | 0 scorable / 6 unscorable / formal recall null                                                                         |
| 116 | R3 Inherited Realization                        | 1 scorable fail / 5 unscorable                                                                                         |
| 117 | R4 Single-Unit Contract                         | 1 scorable fail / 5 unscorable                                                                                         |
| 118 | R5 Multi-Unit Contract                          | 1 scorable fail / 5 unscorable; no new multi recovery                                                                  |
| 119 | R6 Final Full Queue                             | 1 scorable fail / 5 unscorable; formal recall null                                                                     |
| 120 | R7 True ALL_MANDATORY                           | 0 scorable / 6 unscorable; formal recall null                                                                          |
| 121 | Missing Component Count                         | 6                                                                                                                      |
| 122 | Scorable Components                             | 1                                                                                                                      |
| 123 | Scorable Pass                                   | 0                                                                                                                      |
| 124 | Scorable Fail                                   | 1                                                                                                                      |
| 125 | Unscorable Components                           | 5                                                                                                                      |
| 126 | Evaluation Integrity Failures                   | 0                                                                                                                      |
| 127 | Formal Status                                   | `NOT_SCORABLE`                                                                                                         |
| 128 | Formal Product Contract Recall                  | null                                                                                                                   |
| 129 | Measured Scorable-subset Recall                 | 0/1 = 0; diagnostic only                                                                                               |
| 130 | Target-core Recall                              | 4/6                                                                                                                    |
| 131 | Ordinary Physical Audio Recall                  | 5/6                                                                                                                    |
| 132 | Ordinary Playback Any-overlap Recall            | 6/6                                                                                                                    |
| 133 | Ordinary Playback Audible Recall                | 5/6                                                                                                                    |
| 134 | Ordinary Playback Full Recall                   | 5/6                                                                                                                    |
| 135 | Hallucination Target Recall                     | 1/1                                                                                                                    |
| 136 | Hallucination Physical Audio Recall             | 1/1                                                                                                                    |
| 137 | Hallucination Playback Audible Recall           | 1/1                                                                                                                    |
| 138 | Single-Unit Product Passes                      | 0                                                                                                                      |
| 139 | Multi-Unit Product Passes                       | 0                                                                                                                      |
| 140 | Registry/Binding-stage Recovered Components     | 0                                                                                                                      |
| 141 | Inherited-stage Recovered Components            | 1 scorable component, but it fails the product contract                                                                |
| 142 | Multi-Unit-stage Recovered Components           | 0                                                                                                                      |
| 143 | Full-Registry Mapping-unresolved Components     | 0                                                                                                                      |
| 144 | Inventory-present / Target-absent Components    | 2                                                                                                                      |
| 145 | Review Audio Omission Components                | 1                                                                                                                      |
| 146 | Budget-infeasible Components Proven             | 0                                                                                                                      |
| 147 | ALL_MANDATORY Items                             | 93                                                                                                                     |
| 148 | ALL_MANDATORY Regions                           | 13                                                                                                                     |
| 149 | ALL_MANDATORY Targets                           | 153                                                                                                                    |
| 150 | ALL_MANDATORY Audio                             | 13                                                                                                                     |
| 151 | ALL_MANDATORY Playback Segments                 | 239                                                                                                                    |
| 152 | ALL_MANDATORY Unique Audio Seconds              | 235.19535399999984                                                                                                     |
| 153 | ALL_MANDATORY Formal Status                     | `NOT_SCORABLE`                                                                                                         |
| 154 | ALL_MANDATORY Formal Recall                     | null                                                                                                                   |
| 155 | ALL_MANDATORY Target-core Recall                | 2/6                                                                                                                    |
| 156 | ALL_MANDATORY Ordinary Audible Recall           | 1/6                                                                                                                    |
| 157 | ALL_MANDATORY Hallucination Recall              | 0/1                                                                                                                    |
| 158 | Ranker Retrained                                | false                                                                                                                  |
| 159 | Ranker Retrained Expected                       | false; PASS                                                                                                            |
| 160 | New OOF Run                                     | false                                                                                                                  |
| 161 | New OOF Run Expected                            | false; PASS                                                                                                            |
| 162 | Planner Modified                                | false                                                                                                                  |
| 163 | Planner Modified Expected                       | false; PASS                                                                                                            |
| 164 | Geometry Modified                               | false                                                                                                                  |
| 165 | Geometry Modified Expected                      | false; PASS                                                                                                            |
| 166 | Canonical Text Mutations                        | 0; hash `e117fd080a71b244bc39086c82a4972c9335f7c64cef07cc2df1bfbbcd992e05`                                             |
| 167 | Canonical Timing Mutations                      | 0; hash `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`                                             |
| 168 | Presentation Mutations                          | 0; hash `ddb9c9f5f97acb7bc5c87925983da6d64d12e1a825025f736744f32aeec13d98`                                             |
| 169 | Subtitle Parity                                 | true                                                                                                                   |
| 170 | Final A/B Parity                                | true; 19 artifacts compared, 0 mismatches                                                                              |
| 171 | Runtime Gold / Hardcoding / Network             | 0 pre-freeze Gold reads / none / false                                                                                 |
| 172 | Source Read-only                                | true; SHA/size/mtime/inode unchanged                                                                                   |
| 173 | Gold Read-only                                  | true; SHA/size/mtime/inode unchanged                                                                                   |
| 174 | Shareable Audit                                 | PASS; path, secret, raw audio, dialogue, Gold, credential leaks all 0                                                  |
| 175 | Unit / E2E                                      | 1,296 passed + 2 skipped / 74 passed + 1 skipped                                                                       |
| 176 | UI / Browser                                    | 60/60 explicit UI tests; 12/12 real Chrome assertions                                                                  |
| 177 | Cross-version Regressions                       | 789/789 across 104 files                                                                                               |
| 178 | Schemas / Artifact Validation / Skill           | 606 schemas; 20/20 artifact checks; Skill valid                                                                        |
| 179 | Gates / Route / Readiness                       | Engineering PASS; binding/scorability/quality FAIL_CLOSED; `HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR`; C6.0.2 HOLD |
| 180 | Report / Outputs / Worktree                     | This report plus twelve immutable `-20260902-7` output roots; clean worktree required at delivery                      |

## Component-level evaluation

| Component                                   |     Full Registry Units | Target binding | Effective realization | Final status                            | Material evidence                                                                                              |
| ------------------------------------------- | ----------------------: | -------------- | --------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `missing_dialogue_candidate-alignment-0073` | 2 matching / 1 realized | yes            | 1 inherited witness   | `SCORABLE_FAIL`                         | Unit→Gold 0.8811851; Target and physical audio 1; Playback→Gold 0.5916955; minimum per-Unit playback 0.4561738 |
| `missing_dialogue_candidate-alignment-0074` |                       4 | no             | none                  | `NOT_SCORABLE_NO_EFFECTIVE_REALIZATION` | Registry evidence exists, but no product realization                                                           |
| `missing_dialogue_candidate-alignment-0097` |                      14 | no             | none                  | `NOT_SCORABLE_NO_EFFECTIVE_REALIZATION` | Registry evidence exists, but no product realization                                                           |
| `missing_dialogue_candidate-alignment-0098` |                       7 | no             | none                  | `NOT_SCORABLE_NO_TARGET_BINDING`        | Full Registry mapping exists; Target binding prerequisite is absent                                            |
| `missing_dialogue_candidate-alignment-0099` |                       5 | no             | none                  | `NOT_SCORABLE_NO_EFFECTIVE_REALIZATION` | Registry evidence exists, but no product realization                                                           |
| `missing_dialogue_candidate-alignment-0137` |                       2 | no             | none                  | `NOT_SCORABLE_NO_EFFECTIVE_REALIZATION` | Registry evidence exists, but no product realization                                                           |

## Q1–Q26

### Q1. Why did the old registry contain only 81 Units?

The old `buildCoverageUnits145` result was intentionally a filtered uncovered-planning projection. It excluded cue-covered, immutable-target-covered, and existing-review-covered evidence. It was never a source-global identity registry, so treating its 81 Units as the full speech universe caused the coverage deficit.

### Q2. What was the exact legacy coverage?

The 81 legacy Units covered 10,460,099 of 42,434,917 verified-positive samples, or 217.91872916666668 of 884.0607708333333 seconds. The exact ratio was 0.24649745397169034.

### Q3. Does the Full Registry cover every verified-positive speech sample?

Yes. It contains 1,505 atomic Units, 42,434,917 samples, and 884.0607708333333 seconds. Coverage ratio is exactly 1 and unregistered sample count is 0.

### Q4. Why not simply remove the filters from the old 81-Unit builder?

Doing so would change the Planner candidate universe, Bundle composition, selected Realizations, and objective, violating the explicit no-Planner-change boundary. A separate Full Registry preserves source-global identity while keeping the planning projection unchanged.

### Q5. What is the relationship between the Full Registry and the planning projection?

The Full Registry is the complete source-native identity/provenance layer for all verified speech. The legacy 81 Units remain a derived uncovered-safety planning projection. Planning semantic, Bundle, Child, Realization, and objective parity are all true.

### Q6. How was legacy compatibility verified?

By source-identity-matched positive-duration overlap against Full Registry Units: 14 exact mappings, 66 one-to-many mappings, 0 many-to-one mappings, and 0 unresolved mappings. Coverage of Planner-selected Units is 1.

### Q7. How complete is Review Target binding?

There are 106 REQUIRED, 205 OPTIONAL, and 17 NOT_APPLICABLE Targets. Of the REQUIRED set, 105 are bound and 1 is deliberately unbound. The gate therefore fails closed.

### Q8. What constitutes a valid Target→Unit binding?

Matching source identity, verified evidence provenance, an atomic Target core, and positive-duration source-native overlap. Temporal proximity or boundary contact alone is insufficient.

### Q9. Were any zero-overlap pairs accepted?

No. Product-eligible accepted zero-overlap counts are 0 for Target, Audio, and Playback. The builders explicitly rejected 262 Target and 13,193 Playback zero-overlap candidates.

### Q10. Why is copying IDs insufficient for provenance repair?

An ID can be syntactically valid while pointing to the wrong interval or source. The repair independently verifies physical Audio/Playback intervals, source identity, positive overlap, Target links, and hashes; otherwise a copied ID would merely propagate stale or incorrect provenance.

### Q11. What happened to arbitrary fallback Realizations?

The baseline had 5 fallback Realizations and 13 Targets bound to unselected Realizations. The repaired policy requires the frozen selected Realization and fails closed if it is unavailable. The final unselected fallback count is 0.

### Q12. What is an inherited realization?

An `INHERITED_EXISTING_REVIEW_DELIVERY_REALIZATION` is independently reconstructed from already-delivered evidence: valid Target binding, physical hash-verified WAV, Playback, positive Full-Unit overlap, and matching source identity. It is not an arbitrary Planner fallback.

### Q13. How many inherited realizations were recovered?

There are 26 Target-level and 10 Region-level inherited realizations, plus 1 multi-target realization, for 37 total inherited rows.

### Q14. How were Planner and inherited realizations deduplicated?

By semantic identity, provenance, and the actual bound Unit/Target/Audio/Playback IDs. There was 1 Planner/inherited duplicate, 9 total deduplications, and 35 effective product realizations after deduplication.

### Q15. Why can valid review evidence still be absent from the current realization set?

Because current Planner selection represents one planning projection and can exclude already-delivered evidence outside that selection. The inherited ontology safely restores such evidence without changing the Planner.

### Q16. Did multi-Unit witness search recover a product pass?

No. The system exhaustively searched 28 multi-Unit candidate groups, but recovered no new component and no product pass. Component 0073 is scorable through a single realized inherited witness and still fails the product contract.

### Q17. What are the per-Unit witness safeguards?

Every Unit needs an independently verified machine anchor, positive overlap, matching source identity, physical Audio, and at least 0.95 Playback coverage of that Unit. A union cannot hide an unsupported member Unit.

### Q18. How did scorability change across R0–R7?

R0–R2 had 0 scorable and 6 unscorable components. R3–R6 reconstructed enough product evidence for 1 component to become a genuine `SCORABLE_FAIL`, leaving 5 unscorable. R7, the true ALL_MANDATORY subset, has 0 scorable and 6 unscorable.

### Q19. Did the work make all six Missing components scorable?

No. Only 1/6 is scorable; 5/6 remain explicitly unscorable.

### Q20. What is the correct Product Contract Recall?

The formal status is `NOT_SCORABLE` and formal recall is null. The observed 0/1 = 0 is only a diagnostic scorable-subset result and must not be reported as formal 0/6 recall.

### Q21. Why can ordinary audio coverage be high while formal recall is null?

Ordinary physical and audible coverage are both 5/6, but the product contract additionally requires valid Target binding, effective realization, per-Unit anchor and Playback thresholds, and a complete scorable denominator. Those prerequisites are missing for five components.

### Q22. Was the true ALL_MANDATORY subset rebuilt?

Yes: 93 Items, 13 Regions, 153 Targets, 13 Audio records, 239 Playback segments, and 235.19535399999984 unique audio seconds.

### Q23. Why are 198 Items, 84 Regions, and roughly 838 seconds not the mandatory result?

Those values describe the full Review queue: 198 Items, 84 Regions/Audio files, and 838.411680555555 unique audio seconds. The formal ALL_MANDATORY result must be derived only from the frozen mandatory IDs, not copied from full-queue aggregates.

### Q24. Is a safety-budget redesign now justified?

No. The Safety Budgets gate passes and no component is proven budget-infeasible. The first failed gate is required Review Target binding, so budget redesign would not address the controlling failure.

### Q25. Is subtitle release or C6.0.2 authorized?

No. Production remains `needs-review`, `finalizationMethod` remains `none`, machine-only release is not authorized, and C6.0.2 remains `HOLD`.

### Q26. What should happen next?

First repair Review Delivery Unit binding for the one boundary-only required Target without using proximity fallback. Then close remaining Target-core and physical Audio delivery gaps and repeat the isolated evaluation. Budget redesign is not the next action.

## Validation and browser acceptance

| Check                                     | Result                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Format, typecheck, lint, build            | PASS                                                                       |
| Unit tests                                | 1,296 passed, 2 skipped / 153 files                                        |
| E2E                                       | 74 passed, 1 skipped / 33 files                                            |
| Explicit UI tests                         | 60/60 / 7 files                                                            |
| C6.0.1.14.5 targeted tests                | 11/11                                                                      |
| C6.0.1.14.5.1 targeted tests              | 11/11                                                                      |
| C5.19-through-current cross-version tests | 789/789 / 104 files                                                        |
| Generated JSON Schemas                    | 606                                                                        |
| Artifact validator                        | 20/20, including `REVIEW_UI_HYDRATION_AND_AB_PARITY`                       |
| Skill validator                           | `Skill is valid!`                                                          |
| Browser hydration                         | Real Chrome, document complete, 198 queue items, no error text             |
| Browser interaction                       | CRITICAL 18 ↔ ALL 198 filter round-trip; bound Coverage card rendered      |
| Browser playback                          | One target WAV played, readyState 4, no media error                        |
| Browser safety                            | Gold absent, no auto-subtitle controls, no persisted decision or operation |
| Browser layout                            | No horizontal overflow at 1920×929; responsive CSS present                 |
| Browser console                           | 0 page errors; unrelated extension warnings excluded                       |

The Review Delivery artifact continues to use the existing delivery subsystem version. This version label describes the reused delivery contract, not the C6.0.1.14.5.1 Full Registry/Review Binding policy. The verified contract was preserved rather than renamed without a data-model change.

## Immutable output paths

- Baseline: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-baseline-20260902-7`
- Registry audit: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-registry-audit-20260902-7`
- Full Registry: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-full-registry-20260902-7`
- Unit compatibility: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-unit-compatibility-20260902-7`
- Review binding: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-review-binding-20260902-7`
- Inherited realizations: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-inherited-realizations-20260902-7`
- Witness groups: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-witness-groups-20260902-7`
- Review package: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-review-package-20260902-7`
- Final A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-final-a-20260902-7`
- Final B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-final-b-20260902-7`
- Evaluation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-evaluation-20260902-7`
- Validation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-1-validation-20260902-7`

## Final disposition

C6.0.1.14.5.1 real replay-only engineering acceptance is **passed**. Full Registry completeness, provenance integrity, replay/cache compliance, Planner preservation, artifact parity, schema validation, Review UI hydration, browser playback, and shareability checks pass. Subtitle product acceptance is **not passed**: required binding, scorability, final target coverage, physical delivery, and product quality remain fail-closed. The only truthful final state is `needs-review` with `finalizationMethod: none` and route `HOLD_FOR_REVIEW_DELIVERY_UNIT_BINDING_REPAIR`.
