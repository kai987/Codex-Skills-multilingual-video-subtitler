# C6.0.1.14.5.2 Product Scorability & Playback Realization Report

## Executive conclusion

C6.0.1.14.5.2 replay-only engineering acceptance **passed**. The one 3 ms boundary-only orphan is retained for audit but is no longer product-binding-required; all 1,050 playback-scoped candidates have an explicit outcome; all six missing-dialogue components now have determinate Product outcomes; formal Product Recall is therefore numeric at **2/6 (0.3333333333)** instead of `null`.

This is not subtitle product acceptance. Four components still fail the Product contract: one has no eligible Target, one has no effective Realization, and two fail the coverage threshold. The truthful route remains `HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR`, production remains `needs-review`, `finalizationMethod` remains `none`, and C6.0.2 remains `HOLD`.

The run was Gold-isolated and replay-only: Detector replay was 18/18, ASR replay was 44/44, and new inference, model loads, provider starts, Planner changes, canonical text changes, canonical timing changes, presentation changes, geometry changes, and network use were all zero.

Raw output directories are `LOCAL_ONLY`. Only the aggregate shareable summary passed the shareable audit; this report does not reclassify raw evaluation artifacts as publicly shareable.

## Branch, baseline, scope, and policy

- Branch: `codex/c6-0-1-14-5-2-product-scorability-playback-realization`
- Baseline branch: `codex/c6-0-1-14-5-1-full-unit-registry-review-binding`
- Baseline SHA: `a4924ca3ba47e7632abdd9a4dcbb53ae6042f928`
- Policy: `c6.0.1.14.5.2-product-scorability-playback-realization-v1`
- Policy hash: `5863fd936ac1d92ee33ab909186f23fd19a33b43cd23763201caf4e5d98696dd`
- Execution policy: `REPLAY_ONLY_PRODUCT_SCORABILITY_AND_PLAYBACK_REALIZATION`
- Physical container and Review Playback envelope are distinct evidence objects. The former proves a verified local WAV container; only the selected frozen Playback Segment union proves what the reviewer can actually hear.
- Planner selection, queue ranking, source-native geometry, subtitles, model/runtime code, Skill 2, and Skill 3 were intentionally outside scope.

The Planner was not modified because the reproduced failures were eligibility, evidence-envelope, and evaluation-ontology failures downstream of a frozen plan. Changing optimization would have confounded the diagnosis. Detector/ASR were not run because the authorized task was cache replay only and the required evidence was already frozen. Geometry was frozen to make this a semantic and measurement repair rather than an unreviewed subtitle mutation.

## Numbered acceptance record (1–167)

### 1–40: baseline, orphan reconciliation, and candidate inventory

|   # | Required item                            | Result                                                                                                                                                                                     |
| --: | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Executive Conclusion                     | Engineering acceptance passed; Product acceptance did not pass. Formal Product Recall is 2/6; route is a coverage-repair HOLD.                                                             |
|   2 | Branch                                   | `codex/c6-0-1-14-5-2-product-scorability-playback-realization`                                                                                                                             |
|   3 | Baseline                                 | `a4924ca3ba47e7632abdd9a4dcbb53ae6042f928`                                                                                                                                                 |
|   4 | C6.0.1.14.5.1 Replay                     | Passed from the frozen C6.0.1.14.5.1 state; no model path was constructed.                                                                                                                 |
|   5 | Goals                                    | Reconcile the degenerate orphan, enumerate playback-scoped realizations, complete Gold-free witness connectivity, and make Product outcomes determinate.                                   |
|   6 | Non-goals                                | No subtitle, Planner, ranker, model, threshold-relaxation, Skill 2, or Skill 3 modification.                                                                                               |
|   7 | Why Planner Was Not Modified             | The frozen selection was preserved; the defects were downstream evidence semantics and evaluation ontology.                                                                                |
|   8 | Why Detector/ASR Were Not Run            | Replay-only policy; 18 Detector and 44 ASR reads were satisfied entirely from cache.                                                                                                       |
|   9 | Why Geometry Was Frozen                  | To isolate metadata/evidence repairs; Target, Region, Audio, Playback, text, timing, and presentation geometry stayed unchanged.                                                           |
|  10 | Formal Product Recall Baseline           | `NOT_SCORABLE`, recall `null`.                                                                                                                                                             |
|  11 | Scorable/Unscorable Baseline             | 1 determinate Scorable failure, 5 `NOT_SCORABLE`, 0 pass, 0 integrity failure.                                                                                                             |
|  12 | Degenerate Orphan Audit                  | Passed over 106 audited speech Targets.                                                                                                                                                    |
|  13 | Orphan Target Count                      | 53                                                                                                                                                                                         |
|  14 | Sub-minimum Orphan Count                 | 8                                                                                                                                                                                          |
|  15 | Boundary-contact-only Count              | 1                                                                                                                                                                                          |
|  16 | Degenerate Sliver Count                  | 1                                                                                                                                                                                          |
|  17 | Product-required Degenerate Count Before | 1                                                                                                                                                                                          |
|  18 | Product-required Degenerate Count After  | 0                                                                                                                                                                                          |
|  19 | Audit Retention                          | 1/1 retained with lineage.                                                                                                                                                                 |
|  20 | Geometry Preservation                    | 0 Target interval changes; 0 expansion, deletion, movement, or fake binding.                                                                                                               |
|  21 | Binding-required Target Count Before     | 106                                                                                                                                                                                        |
|  22 | Binding-required Target Count After      | 105                                                                                                                                                                                        |
|  23 | Required Target Bound Count              | 105                                                                                                                                                                                        |
|  24 | Required Target Unbound Count            | 0                                                                                                                                                                                          |
|  25 | Physical WAV Container Semantics         | Verified physical extraction container; 84/84 current Audio rows playable and hash-verified. It is not proof of the actually played span.                                                  |
|  26 | Playback Segment Semantics               | Frozen source-global playable spans; 601 segments with Audio, Target, and Unit coverage ratios all 1.0.                                                                                    |
|  27 | Review Playback Envelope                 | Union envelope of the selected Playback Segment set; maximum 12 s and maximum 3 s context on either side.                                                                                  |
|  28 | Machine Anchor Intervals                 | Exact source-native intersections; minimum 0.2 s and minimum per-Unit anchor ratio 0.10.                                                                                                   |
|  29 | Target-scoped Candidate Count            | 472                                                                                                                                                                                        |
|  30 | Region-scoped Candidate Count            | 472                                                                                                                                                                                        |
|  31 | Multi-target Candidate Count             | 106                                                                                                                                                                                        |
|  32 | Total Realization Candidate Count        | 1,050                                                                                                                                                                                      |
|  33 | Candidate Enumeration Completeness       | Complete; 1,050 search-complete, 0 search-incomplete.                                                                                                                                      |
|  34 | Accepted Candidate Count                 | 112                                                                                                                                                                                        |
|  35 | Rejected Candidate Count                 | 938                                                                                                                                                                                        |
|  36 | Rejection Reason Distribution            | Anchor below 0.2 s: 620; Unit Playback below 0.95: 469; no bound Playback: 309; left context over 3 s: 157; right context over 3 s: 101; anchor ratio below 0.10: 38. Reasons may overlap. |
|  37 | Silent Rejection Count                   | 0                                                                                                                                                                                          |
|  38 | Playback Set Search Completeness         | Exact and complete for 1,050/1,050 candidates; no incomplete search.                                                                                                                       |
|  39 | V1 Inherited Realizations                | 37 accepted from 732 aggregate candidates; V1 retained only the aggregate rejection count of 695.                                                                                          |
|  40 | V2 Inherited Realizations                | 112 accepted from 1,050 fully enumerated candidates.                                                                                                                                       |

### 41–86: realization, witness, determinacy, projections, and evaluation stages

|   # | Required item                     | Result                                                                                                                                                  |
| --: | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  41 | Newly Accepted Realizations       | 60 V2 signatures not accepted by V1.                                                                                                                    |
|  42 | Removed Realizations              | 23 V1 signatures no longer accepted; 6 signatures retained.                                                                                             |
|  43 | Envelope-semantic Changes         | 112 accepted V2 Realizations separate physical container from Playback envelope; 100 changed Playback segment set.                                      |
|  44 | Physical Geometry Changes         | 0                                                                                                                                                       |
|  45 | Effective Realization Registry V2 | 72 effective Realizations versus 35 in V1.                                                                                                              |
|  46 | Realization Deduplication         | 47 equivalent rows deduplicated; 65 preferred inherited and 7 preferred Planner origins remain.                                                         |
|  47 | Witness Connectivity V1           | 54 witness groups.                                                                                                                                      |
|  48 | Witness Connectivity V2           | 418 witness groups from 2,556 evaluated pairs.                                                                                                          |
|  49 | Shared Region Connections         | 282                                                                                                                                                     |
|  50 | Shared Audio Connections          | 282                                                                                                                                                     |
|  51 | Continuous Playback Connections   | 282                                                                                                                                                     |
|  52 | Source-adjacent Unit Connections  | 208, only with shared provenance.                                                                                                                       |
|  53 | Shared Parent/Lineage Connections | 1,552                                                                                                                                                   |
|  54 | Witness Group Count               | 418: 241 single-Unit candidates and 177 multi-Unit candidates.                                                                                          |
|  55 | Witness Search Completeness       | Complete; time-proximity-only connections = 0.                                                                                                          |
|  56 | Determinacy Policy                | Complete graph absence becomes a determinate Scorable failure; `NOT_SCORABLE` is reserved for incomplete infrastructure.                                |
|  57 | Global Completeness Preconditions | All 13 registry, binding, candidate, witness, manifest, and nested-integrity flags are true.                                                            |
|  58 | Scorable Pass Semantics           | One complete witness satisfies Unit→Gold, machine anchor, Playback→Unit, Playback→Gold, Audio, Playback, source, envelope, and context constraints.     |
|  59 | Scorable Fail Semantics           | A complete machine graph proves the earliest absent/threshold layer.                                                                                    |
|  60 | Not Scorable Semantics            | Only incomplete registry, enumeration/search, mapping, artifact, or source identity infrastructure.                                                     |
|  61 | Integrity Failed Semantics        | Hash/schema/Gold barrier or contradictory-evidence failure; none occurred.                                                                              |
|  62 | Determinate Outcome Count         | 6/6                                                                                                                                                     |
|  63 | Indeterminate Outcome Count       | 0                                                                                                                                                       |
|  64 | Formal Recall Eligibility         | Eligible and numeric after Gold mapping.                                                                                                                |
|  65 | Review Targets V9                 | 328                                                                                                                                                     |
|  66 | Review Items V11                  | 198; required Items 23.                                                                                                                                 |
|  67 | Review Regions V10                | 84; required Regions 13.                                                                                                                                |
|  68 | Audio Manifest V10                | 84/84 planned, present, playable, and hash-verified; extraction failures 0.                                                                             |
|  69 | Playback Timeline V9              | 601 segments; full-queue unique Audio 838.411681 s.                                                                                                     |
|  70 | Target Interval Parity            | 328 before/after; mutation 0.                                                                                                                           |
|  71 | Region Interval Parity            | 84 before/after; mutation 0.                                                                                                                            |
|  72 | Audio Interval Parity             | 84 before/after; mutation 0.                                                                                                                            |
|  73 | Playback Interval Parity          | 601 before/after; mutation 0.                                                                                                                           |
|  74 | WAV Byte Parity                   | 252 copied WAV instances verified across Final/Review copies; unexpected mutations 0.                                                                   |
|  75 | Projection Hash Rebinding         | 5 projection rows rebound; stale hash count 0.                                                                                                          |
|  76 | Nested Preflight                  | 5,877 nested rows verified; integrity failures 0.                                                                                                       |
|  77 | Machine Freeze                    | Final A `e7fe812d495bde6237c1598570f2cbf092e224f18f1c525c343464f7d561c896`; Final B `30269bc5dfa1bd0246af2e49b473d210e95da61be408d694bc1a659a0c13551e`. |
|  78 | Gold First Read                   | Freeze completed `2026-09-02T14:31:59.347Z`; first Gold read `2026-09-02T14:41:24.970Z`; freeze-before-Gold true.                                       |
|  79 | S0 Official Baseline              | `NOT_SCORABLE`; recall `null`; 0 pass, 1 fail, 5 Not Scorable.                                                                                          |
|  80 | S1 Degenerate Eligibility         | `SCORABLE`; 0/6; six determinate failures.                                                                                                              |
|  81 | S2 Candidate Enumeration          | `SCORABLE`; 0/6; enumeration complete.                                                                                                                  |
|  82 | S3 Inherited Realization V2       | `SCORABLE`; 2/6.                                                                                                                                        |
|  83 | S4 Witness Connectivity V2        | `SCORABLE`; 2/6.                                                                                                                                        |
|  84 | S5 Determinate Scorability        | `SCORABLE`; 2/6.                                                                                                                                        |
|  85 | S6 Final Full Queue               | `SCORABLE`; 2/6.                                                                                                                                        |
|  86 | S7 True ALL_MANDATORY             | `SCORABLE`; 1/6; not copied from Full Queue.                                                                                                            |

### 87–141: final evaluation, mandatory plan, parity, and safety

|   # | Required item                        | Result                                                                                                                                                          |
| --: | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  87 | Final Scorable Pass Count            | 2                                                                                                                                                               |
|  88 | Final Scorable Fail Count            | 4                                                                                                                                                               |
|  89 | Final Not Scorable Count             | 0                                                                                                                                                               |
|  90 | Final Integrity Failed Count         | 0                                                                                                                                                               |
|  91 | Formal Product Recall Status         | `SCORABLE`                                                                                                                                                      |
|  92 | Formal Product Recall                | 2/6 = 0.3333333333                                                                                                                                              |
|  93 | Scorable-subset Recall               | Diagnostic 2/6 = 0.3333333333; identical only because all six are determinate.                                                                                  |
|  94 | Target-Core Recall                   | 4/6 = 0.6666666667                                                                                                                                              |
|  95 | Ordinary Physical Audio Recall       | 5/6 = 0.8333333333                                                                                                                                              |
|  96 | Ordinary Playback Any-overlap        | 6/6 = 1.0                                                                                                                                                       |
|  97 | Ordinary Playback Audible            | 5/6 = 0.8333333333                                                                                                                                              |
|  98 | Ordinary Playback Full               | 5/6 = 0.8333333333                                                                                                                                              |
|  99 | Product Contract Recall              | 2/6 = 0.3333333333; this is the formal recall, not ordinary Playback 5/6.                                                                                       |
| 100 | Hallucination Target Recall          | 1/1                                                                                                                                                             |
| 101 | Hallucination Audio Recall           | 1/1                                                                                                                                                             |
| 102 | Hallucination Playback Recall        | 1/1                                                                                                                                                             |
| 103 | Per-component Matching Units         | Listed in the component table below.                                                                                                                            |
| 104 | Per-component Target Bindings        | Listed in the component table below.                                                                                                                            |
| 105 | Per-component Realization V1         | Listed in the component table below.                                                                                                                            |
| 106 | Per-component Realization V2         | Listed in the component table below.                                                                                                                            |
| 107 | Per-component Playback Witness       | Listed in the component table below.                                                                                                                            |
| 108 | Per-component Determinacy            | All six are `DETERMINATE` and `SCORABLE`; outcomes are listed below.                                                                                            |
| 109 | Inventory-absent Failures            | 0                                                                                                                                                               |
| 110 | Target-absent Failures               | 1 (`0098`)                                                                                                                                                      |
| 111 | Realization-absent Failures          | 1 (`0073`)                                                                                                                                                      |
| 112 | Audio-absent Failures                | 0                                                                                                                                                               |
| 113 | Playback-absent Failures             | 0                                                                                                                                                               |
| 114 | Contract-threshold Failures          | 2 (`0097`, `0099`)                                                                                                                                              |
| 115 | Remaining Not Scorable Components    | 0                                                                                                                                                               |
| 116 | Region Playback Closure Contribution | 2 components recovered (`0074`, `0137`).                                                                                                                        |
| 117 | Mandatory Items                      | 93                                                                                                                                                              |
| 118 | Mandatory Regions                    | 13                                                                                                                                                              |
| 119 | Mandatory Targets                    | 153                                                                                                                                                             |
| 120 | Mandatory Audio                      | 13                                                                                                                                                              |
| 121 | Mandatory Playback                   | 239 segments                                                                                                                                                    |
| 122 | Mandatory Unique Audio               | 235.195354 s                                                                                                                                                    |
| 123 | Mandatory Product Recall             | 1/6 = 0.1666666667                                                                                                                                              |
| 124 | Mandatory Ordinary Recall            | Audible 1/6 = 0.1666666667; Target Core 2/6.                                                                                                                    |
| 125 | Ranker Not Retrained                 | True.                                                                                                                                                           |
| 126 | No OOF                               | No new OOF run.                                                                                                                                                 |
| 127 | Detector Replay                      | 18 expected, 18 hits, 0 misses.                                                                                                                                 |
| 128 | ASR Replay                           | 44 expected, 44 hits, 0 misses.                                                                                                                                 |
| 129 | New Inference Count                  | 0; model loads 0; provider starts 0.                                                                                                                            |
| 130 | Planner Parity                       | Passed; no Planner code or selected-plan mutation.                                                                                                              |
| 131 | Machine Text Parity                  | Mutation 0; hash `e117fd080a71b244bc39086c82a4972c9335f7c64cef07cc2df1bfbbcd992e05`.                                                                            |
| 132 | Machine Timing Parity                | Mutation 0; hash `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`.                                                                            |
| 133 | Presentation Parity                  | Mutation 0; hash `ddb9c9f5f97acb7bc5c87925983da6d64d12e1a825025f736744f32aeec13d98`.                                                                            |
| 134 | ASS/SRT/VTT Parity                   | 161 cues in each format; Final A/B subtitle parity passed.                                                                                                      |
| 135 | Final A/B Parity                     | 22 compared artifacts; semantic, geometry, WAV hash, and subtitle parity all true; mismatches 0.                                                                |
| 136 | Runtime Gold Input                   | Machine stages 0; post-freeze evaluation 1; Gold-derived data never entered Final A/B machine artifacts.                                                        |
| 137 | Dataset Hardcoding                   | None; policies and schemas are generic and source identities are artifact-bound.                                                                                |
| 138 | Network                              | False.                                                                                                                                                          |
| 139 | Source Read-only                     | Before/after SHA `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`, size 847,774,958, mtime 1784692412273.1868 ms, inode 333451799; unchanged. |
| 140 | Gold Read-only                       | Before/after SHA `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`, size 17,094, mtime 1787591357580.2017 ms, inode 347819177; unchanged.      |
| 141 | Shareable Audit                      | Aggregate-only file audited; absolute paths 0, secrets 0, Gold leaks 0, broken references 0; passed.                                                            |

### 142–167: tests, gates, route, commits, and outputs

|   # | Required item               | Result                                                                                                                                                                                              |
| --: | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 142 | Unit Tests                  | 155 files passed; 1,310 passed, 2 skipped.                                                                                                                                                          |
| 143 | E2E                         | 34 files passed; 80 passed, 1 skipped.                                                                                                                                                              |
| 144 | UI Tests                    | 7 explicit UI files, 60/60.                                                                                                                                                                         |
| 145 | Browser Tests               | Real Chrome, 12/12 assertions; WAV reached `readyState=4`; console errors 0; no decision/session persisted.                                                                                         |
| 146 | Targeted Tests              | C6.0.1.14.5.2 14/14; C6.0.1.14.5.1 regression 11/11.                                                                                                                                                |
| 147 | Cross-version Regressions   | C5.19 through C6.0.1.14.5.1: 104 files, 789/789.                                                                                                                                                    |
| 148 | Schema Count                | 634 generated JSON Schemas.                                                                                                                                                                         |
| 149 | Artifact Validation         | 28/28 artifact schemas; final validation 24/24 checks.                                                                                                                                              |
| 150 | Skill Validation            | `Skill is valid!`; Skill 2/3 source not modified.                                                                                                                                                   |
| 151 | Engineering Gate            | Passed.                                                                                                                                                                                             |
| 152 | Degenerate Eligibility Gate | Passed.                                                                                                                                                                                             |
| 153 | Candidate Enumeration Gate  | Passed.                                                                                                                                                                                             |
| 154 | Inherited Playback Gate     | Passed.                                                                                                                                                                                             |
| 155 | Determinacy Gate            | Passed.                                                                                                                                                                                             |
| 156 | Evaluation Integrity Gate   | Passed.                                                                                                                                                                                             |
| 157 | Product Quality Gate        | Failed: 2/6 Product recall and remaining Target/Realization/threshold gaps.                                                                                                                         |
| 158 | Route Decision              | `HOLD_FOR_REMAINING_INVENTORY_TO_TARGET_COVERAGE_REPAIR`.                                                                                                                                           |
| 159 | C6.0.1.14.6 Need            | Yes: repair remaining Inventory→Target/Realization coverage without changing frozen subtitle geometry.                                                                                              |
| 160 | C6.0.1.15 Readiness         | Not ready; do not start Region Ranker recalibration while the earlier coverage layer fails.                                                                                                         |
| 161 | C6.0.2 Status               | `HOLD`.                                                                                                                                                                                             |
| 162 | Human Trial Status          | Not run; browser QA is engineering acceptance, not a human subtitle trial.                                                                                                                          |
| 163 | Remaining Risks             | One Target-absent, one Realization-absent, two threshold failures; npm install also reports 1 moderate and 4 high dependency advisories not changed by this scoped task.                            |
| 164 | Next-stage Recommendation   | Fix remaining Inventory-to-Target coverage first, then rebuild the replay-only evidence graph and repeat isolated evaluation. Do not relax thresholds or redesign the safety budget yet.            |
| 165 | Commits                     | `4829ca0` contracts; `d17d17d` orphan reconciliation; `7ff3d16` playback Realizations; `c07c571` determinacy; `8c6f151` witness/acceptance flow; this report is the separate acceptance-doc commit. |
| 166 | Remote HEAD                 | Filled by the final push receipt; the final response records local/upstream/GitHub equality.                                                                                                        |
| 167 | Output Paths                | Listed in the immutable output-path section below.                                                                                                                                                  |

## Per-component final diagnosis

| Component | Units | Target bindings |  V1 |  V2 | Effective | Witness groups | Selected Playback | Unit→Gold | Target→Gold | Physical Audio→Gold | Playback→Gold | Product outcome                    |
| --------- | ----: | --------------: | --: | --: | --------: | -------------: | ----------------: | --------: | ----------: | ------------------: | ------------: | ---------------------------------- |
| `0073`    |     2 |               8 |   2 |   0 |         0 |              0 |                 0 |  1.000000 |    1.000000 |            0.000000 |      0.000000 | `SCORABLE_FAIL_REALIZATION_ABSENT` |
| `0074`    |     4 |               1 |   0 |   9 |         5 |             21 |                 2 |  0.929530 |    1.000000 |            1.000000 |      0.999727 | `SCORABLE_PASS_PRODUCT_CONTRACT`   |
| `0097`    |    14 |               1 |   0 |  13 |         7 |             43 |                 1 |  0.296833 |    0.895928 |            1.000000 |      0.895928 | `SCORABLE_FAIL_CONTRACT_THRESHOLD` |
| `0098`    |     7 |               0 |   0 |   0 |         0 |              0 |                 0 |  1.000000 |    0.000000 |            0.000000 |      0.000000 | `SCORABLE_FAIL_TARGET_ABSENT`      |
| `0099`    |     5 |               1 |   0 |   5 |         4 |             44 |                 1 |  0.630808 |    0.630808 |            1.000000 |      0.630808 | `SCORABLE_FAIL_CONTRACT_THRESHOLD` |
| `0137`    |     2 |               1 |   0 |   9 |         5 |             21 |                 2 |  0.905835 |    0.975194 |            1.000000 |      0.975194 | `SCORABLE_PASS_PRODUCT_CONTRACT`   |

All six rows are `DETERMINATE` and `SCORABLE`. A complete machine graph proving the absence of a Target or Realization is a determinate Product failure, not missing evaluation infrastructure.

## Candidate rejection ledger

Candidate conservation is exact: 1,050 = 112 accepted + 938 rejected. Rejection reasons are multi-valued, so their sum can exceed 938.

| Reason                                        | Count |
| --------------------------------------------- | ----: |
| `NO_TARGET_UNIT_BINDING`                      |     0 |
| `ZERO_MACHINE_ANCHOR_OVERLAP`                 |     0 |
| `MACHINE_ANCHOR_BELOW_SECONDS`                |   620 |
| `MACHINE_ANCHOR_BELOW_RATIO`                  |    38 |
| `NO_PHYSICAL_AUDIO`                           |     0 |
| `WAV_NOT_VERIFIED`                            |     0 |
| `NO_BOUND_PLAYBACK_SEGMENT`                   |   309 |
| `PLAYBACK_UNIT_COVERAGE_BELOW_0_95`           |   469 |
| `REVIEW_PLAYBACK_ENVELOPE_EXCEEDS_12_SECONDS` |     0 |
| `LEFT_CONTEXT_EXCEEDS_3_SECONDS`              |   157 |
| `RIGHT_CONTEXT_EXCEEDS_3_SECONDS`             |   101 |
| `SOURCE_IDENTITY_MISMATCH`                    |     0 |
| `PLAYBACK_CHAIN_DISCONNECTED`                 |     0 |
| `PLAYBACK_SET_SEARCH_INCOMPLETE`              |     0 |
| `DUPLICATE_DOMINATED_CANDIDATE`               |     0 |
| `UNKNOWN`                                     |     0 |

The V1 artifact stored 37 accepted Realizations and only an aggregate 695-rejection count. It cannot truthfully attribute that historical aggregate to one exact cause. C6.0.1.14.5.2 therefore does not invent a V1 envelope/context subtotal: it records every new candidate and every rejection reason. The measurable outcome is 60 newly accepted V2 signatures, 112 accepted rows with physical-container/Playback-envelope separation, and 100 changed Playback segment sets.

## Q1–Q24

### Q1. Why did the only Required Unbound Target have no positive-duration Unit overlap?

`review-target-53811f320f5fa0e635500fa7` spans only 144 samples (0.003 s), from sample 37,532,256 to 37,532,400. It touches two Unit boundaries but its positive Unit overlap is exactly 0 samples.

### Q2. Was it a degenerate boundary sliver or a valid independent speech core?

It was a `DEGENERATE_ORPHAN_BOUNDARY_SLIVER`: unresolved localization, below the versioned 5,760-sample minimum, no independent localized speech core, and only boundary contact.

### Q3. Was the Target and audit lineage retained while removing the Product binding requirement?

Yes. It remains in all 328 Targets with lineage and `AUDIT_ONLY_BOUNDARY_RESIDUE`, while its binding requirement changes from `UNIT_BINDING_REQUIRED` to `UNIT_BINDING_OPTIONAL_AUDIT_ONLY`.

### Q4. Was the Target expanded, deleted, or moved?

No. Geometry mutation, deletion, expansion, movement, and fake binding counts are all 0.

### Q5. What is the difference between a Physical WAV Container and a Review Playback Envelope?

The Physical WAV Container proves a verified local extraction and may include surrounding Region context. The Review Playback Envelope is the union envelope of the exact frozen Playback Segments the reviewer can hear. Product coverage uses the latter, not the whole WAV.

### Q6. How many C6.0.1.14.5.1 candidates were rejected because the whole WAV was treated as the envelope or exceeded context?

V1 recorded 695 rejected candidates only as an aggregate and did not preserve per-candidate reasons, so an exact envelope/context-only subtotal is not recoverable and is not fabricated. That missing auditability is itself the reproduced defect. The V2 ledger provides exact reason counts for all 1,050 candidates.

### Q7. How many candidates newly became legal with frozen Playback Segment unions?

60 V2 realization signatures were newly accepted. V2 accepts 112 total candidates, compared with 37 in V1; 6 signatures are retained and 23 V1 signatures are no longer accepted.

### Q8. Does any Realization still use a whole WAV as a substitute for actual Playback?

No. Every accepted V2 Realization has verified Playback Segment IDs, Playback intervals, and a separately stored physical container. The 112 changed-envelope rows prove that separation.

### Q9. Does the candidate ledger preserve every acceptance/rejection reason?

Yes. It has 1,050 rows, complete conservation, exact per-row reasons, and complete search status.

### Q10. Is any silent rejection left?

No; silent/unknown rejection count is 0.

### Q11. How many Target-, Region-, and multi-Target Region-scoped candidates were generated?

472 Target-scoped, 472 Region-scoped, and 106 multi-Target Region-scoped. Accepted counts are 46, 52, and 14 respectively.

### Q12. Which Gold-free relations did Witness Group V2 add?

Shared physical Audio, shared Review Region, continuous Playback chain, source-adjacent Units only when provenance is shared, and shared parent-speech-island or machine-evidence lineage.

### Q13. Was unrelated time proximity used to connect witnesses?

No. `timeProximityOnlyConnectionCount` is 0.

### Q14. Why is a proven missing Target a Scorable failure instead of `NOT_SCORABLE`?

Because the Full Registry and binding enumeration are complete. The absence is a measured Product outcome (`SCORABLE_FAIL_TARGET_ABSENT`), not missing evaluation infrastructure.

### Q15. Are all six missing components now determinate PASS or FAIL?

Yes: 2 pass and 4 fail, with 0 `NOT_SCORABLE` and 0 `INTEGRITY_FAILED`.

### Q16. Did formal Product Recall change from `null` to a number?

Yes, from `NOT_SCORABLE`/`null` to `SCORABLE`/2 of 6.

### Q17. What is the new formal Product Contract Recall?

2/6 = 0.3333333333. It is not the ordinary Playback value.

### Q18. What are Ordinary Playback Audible Recall and Product Contract Recall, and why do they differ?

Ordinary Playback Audible Recall is 5/6; Product Contract Recall is 2/6. Audible overlap alone does not prove Unit→Gold coverage, eligible Target binding, an accepted machine-anchored Realization, and every Product threshold.

### Q19. Did Region-scoped Playback Segment unions recover components whose Target/WAV existed but Playback witness was too narrow?

Yes. Two components, `0074` and `0137`, are recovered by playback-scoped inherited V2 evidence; the evaluation records both region-closure and inherited-V2 recovery counts as 2.

### Q20. Does ALL_MANDATORY remain the true frozen subset, and what are its Item/Region/Audio values?

Yes. It contains 93 Items, 13 Regions, 153 Targets, 13 Audio files, 239 Playback segments, and 235.195354 unique Audio seconds. `fullQueueCopy` is false.

### Q21. Are any missing components still `NOT_SCORABLE` or `INTEGRITY_FAILED`?

No; both counts are 0.

### Q22. What is the earliest remaining failure layer?

`FINALINVENTORYTARGETCOVERAGE`. At component level, the remaining earliest outcomes are one Target absence, one Realization absence, and two contract-threshold failures; evaluation infrastructure passes.

### Q23. Is `GO_C6_0_1_15_REGION_RANKER_RECALIBRATION` reached?

No. Product Quality and final Inventory/Target/physical coverage gates still fail.

### Q24. What exact next category is required?

`Remaining Inventory-to-Target Coverage`. Degenerate eligibility, candidate enumeration, inherited Playback realization, multi-Unit witness, Review Audio integrity, safety budgets, and evaluation integrity already pass.

## Validation and browser acceptance

The validated toolchain was Node 24.18.0 with npm 11.6.2. `npm ci`, schema generation, typecheck, lint, format check, build, unit, E2E, explicit UI, targeted, cross-version, artifact, and Skill validation all passed.

Real Chrome acceptance produced 12/12 assertions:

1. document title and Review shell loaded;
2. document reached `complete`;
3. all 198 queue cards hydrated;
4. CRITICAL filter reduced the queue to 18;
5. ALL restored all 198 cards;
6. one Audio element was present;
7. the target playback control was visible and enabled;
8. a real WAV reached `readyState=4`;
9. the played WAV exposed a 33.4 s duration;
10. media error was `null`;
11. page console errors were 0 and there was no horizontal overflow at 1920×929;
12. `/api/session` remained `not-started` with no persisted decision.

The UI continues to identify its reused C6.0.1.12 transaction/Audio and C6.0.1.14.3 delivery subsystems. Those labels describe preserved delivery contracts, not the C6.0.1.14.5.2 evidence policy; changing them without a contract migration would be misleading.

## Immutable output paths

- Baseline: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-baseline-20260902-2`
- Orphan audit: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-orphan-audit-20260902-2`
- Realization candidates: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-realization-candidates-20260902-2`
- Inherited realizations: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-inherited-realizations-20260902-2`
- Effective realizations: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-effective-realizations-20260902-2`
- Witness groups: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-witness-groups-20260902-2`
- Determinacy: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-determinacy-20260902-2`
- Review package: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-review-package-20260902-2`
- Final A: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-final-a-20260902-2`
- Final B: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-final-b-20260902-2`
- Evaluation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-evaluation-20260902-2`
- Validation: `/Users/paulasmith/Documents/Codex-Skills/output/carnation-c6-0-1-14-5-2-validation-20260902-2`

## Final disposition

C6.0.1.14.5.2 real replay-only engineering acceptance is **passed**. Formal scorability is repaired and measurable, but Product Recall is only 2/6. This run does not authorize automatic subtitle finalization, a human-trial claim, C6.0.1.15 Region Ranker recalibration, or C6.0.2 release. Continue with the narrowly scoped remaining Inventory-to-Target coverage repair while preserving `needs-review` and `finalizationMethod: none`.
