# C6.1.2.1 Gold-Isolated Evaluation Coverage Recovery

This report is generated from independent, schema-validated offline A/B artifacts. Engineering acceptance is separate from evaluator coverage and reranker safety. Production remains needs-review with finalizationMethod none.

## 验收摘要与统计口径

工程验收 **24/24 passed**；最终 QA **14/14 passed**。正式路线为 `EVALUATION_COVERAGE_STILL_INSUFFICIENT`，C6.1.2.2 与 C6.1.3 均为 HOLD。本轮未修改模型类别、特征、候选、Fold 或阈值网格，未执行新的声学模型，也未改动生产字幕。

| 指标                             | 最终结果                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| Machine Group Coverage           | 67/113，59.29%（E0 为 20/113，17.70%）                                    |
| Production Cue Coverage          | 83/161，51.55%                                                            |
| Gold Cue Coverage                | 105/192，54.69%                                                           |
| Candidate Event Coverage         | 75/141，53.19%                                                            |
| Candidate Label Coverage         | 全部冻结 rank rows：273/1146，23.82%；Top-K feature rows：268/519，51.64% |
| 冻结 L1 的联合归一化增益         | -9；14 improved / 18 regressed / 7 neutral / 17 unknown                   |
| 重训后描述性最优非零选择 Profile | L2，联合归一化增益 -3，仍非安全收益                                       |
| Selected Safe Profile            | null                                                                      |
| L4–L8                            | 均为零选择；precision/harm 为 null，不视作安全获益                        |
| Production ASS/SRT/VTT           | 两个原始目录内的 standard 与 best-effort 共 12 个文件均保持字节一致       |

图共有 79 个组件：54 个同时有 Machine 和 Gold，3 个仅有 Machine，22 个仅有 Gold。其中 40 个固定可评，14 个双侧组件不可评；No Mapping 共 25 个，不能把 22 个 Gold-only 组件误记为 Ambiguous。四种形状按 Machine Cue / Gold Cue 数量计：全部双侧组件为 14 / 10 / 2 / 28；其中固定可评的 `FIXED_ONE_TO_ONE`、`FIXED_ONE_TO_MANY`、`FIXED_MANY_TO_ONE`、`FIXED_MANY_TO_MANY` 分别为 11 / 9 / 1 / 19。下文第 21–24 节采用固定可评口径。

新恢复 48 个 Machine Groups，同时 1 个原先可评组不再可评，故净覆盖增加 47 组。新恢复 200 个候选标签、丢失 33 个原可评标签：106 + 200 - 33 = 273。73 个共同可评标签全部保持增益方向一致。原 L1 的 4 个灾难性删除案例在 E2 下仍全部成立，扩大覆盖后共识别出 6 个灾难性删除 Supergroups。

零分母统计继续保持 null；仅用于零选择效用/门控的 `zeroSelectionChangedCoverage` 为 0。1870 个 completeness-blocked 计数是 Profile/Event/Candidate 阻断出现次数，不是 1870 个唯一候选；唯一可评安全候选中 56/58 被阻断。后者不允许绕过 Coverage Gate，也不授权降低 completeness 阈值。

### 验收迭代留痕

首轮 `qa/` 有一处格式检查失败。`qa-final/` 在 10 核默认并发下有两项既有 C6.0.1.12 多进程 CLI 测试达到原有 5 秒超时；其日志全部保留。最终 `qa-acceptance/` 仅使用 `VITEST_MAX_WORKERS=2`，未改断言、超时、测试集合或跳过项：完整测试集 1291 passed / 2 skipped，单独 E2E 62 passed / 1 skipped，C6.1 / C6.1.1 / C6.1.2 / C6.1.2.1 targeted 分别为 113 / 197 / 69 / 89 passed，历史 targeted 1166 passed / 1 skipped，toy-logit CTC 单测 6 passed。跳过项均为既有 opt-in 真实 Speaker/MFA 集成测试。

最初的 `initial-a` / `initial-b` 产物保留为诊断历史。最终 A/B 重新独立运行后，语义差异仅涉及上述 No Mapping/Ambiguous 汇总修正；图、边、标签、模型、评分、覆盖率、阈值和影子字幕均未改变。最终两套产物的 74 个原始文件逐一匹配；之后新增的 route 与 aggregate-only shareable summary 也一致。共 98 个 JSON Artifact 通过独立严格验证；456 个 JSON Schema 中新增 36 个。

### 本地输出索引

以下路径相对于本地 `Codex-Skills/output/`；完整研究输出未提交 GitHub，只有 `shareable/` 中的统计与哈希摘要可分享。

- `carnation-c6-1-2-1-final-a-20260901/`
- `carnation-c6-1-2-1-final-b-20260901/`
- `carnation-c6-1-2-1-validation-20260901/qa-acceptance/`
- `carnation-c6-1-2-1-validation-20260901/acceptance/`：验收、结构化报告和推送后交付凭证。
- `carnation-c6-1-2-1-initial-a-20260901/`、`carnation-c6-1-2-1-initial-b-20260901/`：仅诊断历史，不作为最终验收输入。

文档提交自身的最终 SHA、远程 HEAD 和 clean/0/0 状态记录在推送后的 `c6-1-2-1-delivery-receipt.json` 与最终回复中，避免在提交内容内伪造自引用 SHA。

## 1. Executive Conclusion

```json
{
  "route": "EVALUATION_COVERAGE_STILL_INSUFFICIENT",
  "engineeringGate": true,
  "evaluationCoverageGate": false,
  "strongSupportGate": false,
  "production": "needs-review / finalizationMethod none",
  "automaticRelease": false
}
```

## 2. Branch

codex/c6-1-2-1-evaluation-supergroup-rebinding

## 3. Baseline

```json
{
  "acceptedCommit": "d7667e30aac250b5f36ffd38f70637f858e0aff5",
  "generationSourceCommit": "02f0b38198587c06ba4fbb386b6e99c309cc12c7"
}
```

## 4. C6.1.2 Replay

```json
{
  "baselinePassed": true,
  "baselineChecks": [
    {
      "name": "productionCueCount",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "name": "canonicalEventCount",
      "passed": true,
      "observed": "199",
      "expected": "199"
    },
    {
      "name": "eligibleEventCount",
      "passed": true,
      "observed": "141",
      "expected": "141"
    },
    {
      "name": "inputCandidateCount",
      "passed": true,
      "observed": "1496",
      "expected": "1496"
    },
    {
      "name": "includedCandidateCount",
      "passed": true,
      "observed": "832",
      "expected": "832"
    },
    {
      "name": "topKCandidateCount",
      "passed": true,
      "observed": "519",
      "expected": "519"
    },
    {
      "name": "frozenMachineGroupCount",
      "passed": true,
      "observed": "113",
      "expected": "113"
    },
    {
      "name": "stableGoldBindingCount",
      "passed": true,
      "observed": "20",
      "expected": "20"
    },
    {
      "name": "goldBindingAmbiguousCount",
      "passed": true,
      "observed": "90",
      "expected": "90"
    },
    {
      "name": "noMappingCount",
      "passed": true,
      "observed": "3",
      "expected": "3"
    }
  ],
  "exactE0ReplayPassed": true
}
```

## 5. Goals

Recover evaluator coverage without changing candidates, evidence, features, folds, model classes, threshold grids or production.

## 6. Non-goals

No acoustic model execution, candidate generation, production application, timing/cue changes, new features, profile tuning, or Skill 2/3 work.

## 7. Why Evaluation Coverage Collapsed

C6.1.2 binds Gold to individually frozen machine groups and rejects any Gold cue claimed by multiple groups, while C6.1.1 used temporal bipartite components. This is a changed evaluation unit/eligibility rule, not evidence that ASR accuracy collapsed. E2 restores connected evaluation units without changing those machine groups.

## 8. E0 Legacy Evaluator

```json
{
  "stable": 20,
  "ambiguous": 90,
  "noMapping": 3,
  "coverage": {
    "numerator": 20,
    "denominator": 113,
    "ratio": 0.17699115044247787
  },
  "exactReplayChecks": [
    {
      "name": "exact-legacy-bindings",
      "passed": true,
      "observed": "0b935e574ee4ea6b89d9958c326456162ecda5866fe4673698906aeb1abfbcb3",
      "expected": "0b935e574ee4ea6b89d9958c326456162ecda5866fe4673698906aeb1abfbcb3"
    },
    {
      "name": "exact-legacy-candidate-labels",
      "passed": true,
      "observed": "c9988b381ad433259d5ba19223a6d1a190147718c4b156ed1e7f0aaaa17975c5",
      "expected": "c9988b381ad433259d5ba19223a6d1a190147718c4b156ed1e7f0aaaa17975c5"
    },
    {
      "name": "legacy-replay:c6-1-2-cv-results",
      "passed": true,
      "observed": "b1b39b160ef72fb84bfd1140aa733a848e01663ca43cef75e8a27204cea0110d",
      "expected": "b1b39b160ef72fb84bfd1140aa733a848e01663ca43cef75e8a27204cea0110d"
    },
    {
      "name": "legacy-replay:c6-1-2-failure-attribution",
      "passed": true,
      "observed": "4b93b0db0cd5f541a98258b6357e9f9f910b8d0df443accc05690ea69a54460e",
      "expected": "4b93b0db0cd5f541a98258b6357e9f9f910b8d0df443accc05690ea69a54460e"
    },
    {
      "name": "legacy-replay:gold-c6-1-2-contraction-evaluation",
      "passed": true,
      "observed": "ea025712fb6f75a09ea8c144f764c30f1313387a9d1f8a437cc2d272be0c4f9a",
      "expected": "ea025712fb6f75a09ea8c144f764c30f1313387a9d1f8a437cc2d272be0c4f9a"
    },
    {
      "name": "legacy-replay:c6-1-2-feature-ablations",
      "passed": true,
      "observed": "5f255e7d41969be4e7e188d7d91d1b6c0ef21d62dce040ba46fc8145e89e1dac",
      "expected": "5f255e7d41969be4e7e188d7d91d1b6c0ef21d62dce040ba46fc8145e89e1dac"
    },
    {
      "name": "legacy-replay:gold-c6-1-2-group-configuration-labels",
      "passed": true,
      "observed": "ac282f105cdf1d016978485a3c843e1d866c993fb516bff776ca791579bee726",
      "expected": "ac282f105cdf1d016978485a3c843e1d866c993fb516bff776ca791579bee726"
    },
    {
      "name": "legacy-replay:c6-1-2-retrieval-evaluation",
      "passed": true,
      "observed": "65accf4a042b49e902ad14c40e123f4b1a9e3ccf137e82af2ed9442346d00d5e",
      "expected": "65accf4a042b49e902ad14c40e123f4b1a9e3ccf137e82af2ed9442346d00d5e"
    }
  ]
}
```

## 9. E1 Historical Bipartite Evaluator

```json
{
  "role": "Historical cross-check only, not used to choose the favorable evaluator",
  "summary": {
    "totalCueGroups": 61,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "oneToOne": 11,
    "oneToMany": 11,
    "manyToOne": 1,
    "manyToMany": 19,
    "assignedMachineCueCount": 161,
    "assignedGoldCueCount": 170,
    "unmappedGoldCueCount": 22
  },
  "historicalStructureParity": true,
  "policy": {
    "mappingPolicyVersion": "c6.1.1-time-connected-fixed-groups-v1",
    "algorithm": "BASELINE_TEMPORAL_BIPARTITE_COMPONENTS",
    "minimumMachineCoveredRatio": 0.5,
    "minimumGoldCoveredRatio": 0.5,
    "maxMachineCues": 8,
    "maxGoldCues": 8,
    "maxGroupDurationSeconds": 24,
    "maxWithinSideGapSeconds": 2,
    "profileRematchingAllowed": false,
    "exactView": "NFC_GRAPHEME_CONCATENATED_CUES",
    "normalizedView": "C61_NFKC_CASE_PUNCTUATION_WHITESPACE_INSENSITIVE_GRAPHEMES"
  }
}
```

## 10. E2 Frozen Machine-group Supergroup Evaluator

```json
{
  "primaryEvaluator": "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
  "mapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "machineMappingHash": "bef963fda4de875a1e9c29c486a3d13e4f776cbe59511b8ef9d3e4d1429bd720",
  "policyHash": "103658a16801bc0baad7b57686d563044815b0a2a0b3654acc07bcc3cbefd77b"
}
```

## 11. Gold Timing-only Barrier

```json
{
  "schemaVersion": "1.0.0",
  "artifactType": "c6-1-2-1-gold-timing-read-barrier",
  "policyVersion": "c6.1.2.1-gold-isolated-supergroup-evaluation-v1",
  "policyHash": "103658a16801bc0baad7b57686d563044815b0a2a0b3654acc07bcc3cbefd77b",
  "semanticHash": "5f1d4d303ef9605b46b6db6ae7aad53a8e9011bad22d0ef2ae0b5c5ab461a950",
  "machineFrozenAt": "2026-08-31T18:24:15.272Z",
  "goldTimingFirstReadAt": "2026-08-31T18:24:17.666Z",
  "baselineFreezeHash": "cbbd96c236636a93879c8a9b7de7d41e340a3891774829064c3000b72fd94be7",
  "goldTimingCueCount": 192,
  "goldTimingHash": "270cb93fab829ea77bb0dccd51e399acf5df4d16d7927e46be68d739811448cb",
  "goldByteHash": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
  "goldBytes": 17094,
  "goldMtimeMs": 1787570451152.2112,
  "goldInode": 346133940,
  "parser": "ASS_PREFIX_ONLY_NO_DIALOGUE_TEXT_DECODE",
  "rawGoldTextReadCount": 0,
  "goldFileBytesScannedForTimingAndHash": true,
  "machineArtifactsMutatedAfterTimingRead": false
}
```

## 12. Gold Text Scoring Barrier

```json
{
  "schemaVersion": "1.0.0",
  "artifactType": "c6-1-2-1-gold-text-scoring-barrier",
  "policyVersion": "c6.1.2.1-gold-isolated-supergroup-evaluation-v1",
  "policyHash": "103658a16801bc0baad7b57686d563044815b0a2a0b3654acc07bcc3cbefd77b",
  "semanticHash": "75ca23285900972ee112ba5df352bd0c52f9c12b9419529f02ac0f3ebcc7669c",
  "supergroupFrozenAt": "2026-08-31T18:24:17.824Z",
  "goldTextFirstReadAt": "2026-08-31T18:24:20.480Z",
  "baselineFreezeHash": "cbbd96c236636a93879c8a9b7de7d41e340a3891774829064c3000b72fd94be7",
  "timingBarrierHash": "5f1d4d303ef9605b46b6db6ae7aad53a8e9011bad22d0ef2ae0b5c5ab461a950",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "goldTimingHash": "270cb93fab829ea77bb0dccd51e399acf5df4d16d7927e46be68d739811448cb",
  "goldByteHash": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
  "goldTextScoringInputCount": 192,
  "machineRuntimeRawGoldInputCount": 0,
  "predictionStageRawGoldInputCount": 0
}
```

## 13. Machine Freeze Integrity

```json
{
  "files": 944,
  "inputAggregateHash": "fbb9043f51854c7169a34ff813e08fb7025a600df66797683c0ed04ef4d32281",
  "machineFreezeHashes": [
    "5096fbcb89c09621e65f9f8ac16f844546c29717bd850cf921b3309a65391da2",
    "3543333a183a8403e9b12d8c61c966f4fca4b00649d48a4123727cbaad36d522"
  ],
  "rerankingFreezeHashes": [
    "d9aff3ea48c37513791bffedd42a426e412d24ea19ac6f9fdd0b8c3619ff252c",
    "e1b6db73e52035f66c742e70e2ea437420054e681c300331faa27f5b78c2832b"
  ],
  "productionTextHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
  "productionTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
}
```

## 14. Bipartite Graph Design

Left vertices are the unchanged C6.1.2 machine groups; right vertices are Gold timing DTOs. Connected components are evaluator-only. Isolated Gold vertices remain explicit NO_MACHINE_MAPPING components. Folds are inherited, never recomputed.

## 15. Edge Rule

```json
{
  "edge": "STRICT_POSITIVE_TEMPORAL_OVERLAP_OF_ACTUAL_PRODUCTION_CUES",
  "groupHullEdgesAllowed": false,
  "toleranceSeconds": 0,
  "structure": {
    "mappingPolicyVersion": "c6.1.1-time-connected-fixed-groups-v1",
    "algorithm": "BASELINE_TEMPORAL_BIPARTITE_COMPONENTS",
    "minimumMachineCoveredRatio": 0.5,
    "minimumGoldCoveredRatio": 0.5,
    "maxMachineCues": 8,
    "maxGoldCues": 8,
    "maxGroupDurationSeconds": 24,
    "maxWithinSideGapSeconds": 2,
    "profileRematchingAllowed": false,
    "exactView": "NFC_GRAPHEME_CONCATENATED_CUES",
    "normalizedView": "C61_NFKC_CASE_PUNCTUATION_WHITESPACE_INSENSITIVE_GRAPHEMES"
  }
}
```

## 16. Edge Count

229

## 17. Connected Component Count

79

## 18. Gold-connected Component Count

54

## 19. No-Gold Component Count

3

## 20. Supergroup Count

79

## 21. One-to-one Count

11

## 22. One-to-many Count

9

## 23. Many-to-one Count

1

## 24. Many-to-many Count

19

## 25. Cross-fold Count

0

## 26. Structure-incompatible Count

0

## 27. Duration-limit Count

6

## 28. Gap-limit Count

6

## 29. Cue-limit Count

3

## 30. Machine Group Coverage

```json
{
  "numerator": 67,
  "denominator": 113,
  "ratio": 0.5929203539823009
}
```

## 31. Production Cue Coverage

```json
{
  "numerator": 83,
  "denominator": 161,
  "ratio": 0.515527950310559
}
```

## 32. Gold Cue Coverage

```json
{
  "numerator": 105,
  "denominator": 192,
  "ratio": 0.546875
}
```

## 33. Machine Duration Coverage

```json
{
  "numerator": 300.4249165,
  "denominator": 616.2371369631184,
  "ratio": 0.48751511143993315
}
```

## 34. Gold Duration Coverage

```json
{
  "numerator": 290.5000000000001,
  "denominator": 596.8700000000014,
  "ratio": 0.48670564779600156
}
```

## 35. Candidate Event Label Coverage

```json
{
  "numerator": 75,
  "denominator": 141,
  "ratio": 0.5319148936170213
}
```

## 36. Candidate Label Coverage

```json
{
  "rankedPool": {
    "numerator": 273,
    "denominator": 1146,
    "ratio": 0.23821989528795812
  },
  "topK": {
    "numerator": 268,
    "denominator": 519,
    "ratio": 0.5163776493256262
  }
}
```

## 37. E0 Stable Bindings

20

## 38. E0 Ambiguous

90

## 39. E0 No Mapping

3

## 40. E0 Coverage

```json
{
  "numerator": 20,
  "denominator": 113,
  "ratio": 0.17699115044247787
}
```

## 41. E1 Stable Bindings

42

## 42. E1 Ambiguous

15

## 43. E1 No Mapping

4

## 44. E1 Coverage

```json
{
  "evaluableSupergroupCoverage": {
    "numerator": 42,
    "denominator": 61,
    "ratio": 0.6885245901639344
  },
  "evaluableMachineGroupCoverage": {
    "numerator": 68,
    "denominator": 113,
    "ratio": 0.6017699115044248
  },
  "evaluableProductionCueCoverage": {
    "numerator": 85,
    "denominator": 161,
    "ratio": 0.5279503105590062
  },
  "evaluableGoldCueCoverage": {
    "numerator": 109,
    "denominator": 192,
    "ratio": 0.5677083333333334
  },
  "evaluableMachineDurationCoverage": {
    "numerator": 311.34991649999995,
    "denominator": 616.2371369631184,
    "ratio": 0.5052436762158886
  },
  "evaluableGoldDurationCoverage": {
    "numerator": 301.98000000000013,
    "denominator": 596.8700000000014,
    "ratio": 0.5059393167691447
  },
  "candidateEventLabelCoverage": {
    "numerator": 75,
    "denominator": 141,
    "ratio": 0.5319148936170213
  },
  "candidateLabelCoverage": {
    "numerator": 278,
    "denominator": 1146,
    "ratio": 0.2425828970331588
  },
  "topKCandidateLabelCoverage": {
    "numerator": 273,
    "denominator": 519,
    "ratio": 0.5260115606936416
  },
  "evaluableGoldCharacterCoverage": {
    "numerator": 1167,
    "denominator": 2048,
    "ratio": 0.56982421875
  }
}
```

## 45. E2 Stable Bindings

40

## 46. E2 Ambiguous

14

## 47. E2 No Mapping

```json
{
  "total": 25,
  "machineOnly": 3,
  "goldOnly": 22
}
```

## 48. E2 Coverage

```json
{
  "evaluableSupergroupCoverage": {
    "numerator": 40,
    "denominator": 79,
    "ratio": 0.5063291139240507
  },
  "evaluableMachineGroupCoverage": {
    "numerator": 67,
    "denominator": 113,
    "ratio": 0.5929203539823009
  },
  "evaluableProductionCueCoverage": {
    "numerator": 83,
    "denominator": 161,
    "ratio": 0.515527950310559
  },
  "evaluableGoldCueCoverage": {
    "numerator": 105,
    "denominator": 192,
    "ratio": 0.546875
  },
  "evaluableMachineDurationCoverage": {
    "numerator": 300.4249165,
    "denominator": 616.2371369631184,
    "ratio": 0.48751511143993315
  },
  "evaluableGoldDurationCoverage": {
    "numerator": 290.5000000000001,
    "denominator": 596.8700000000014,
    "ratio": 0.48670564779600156
  },
  "candidateEventLabelCoverage": {
    "numerator": 75,
    "denominator": 141,
    "ratio": 0.5319148936170213
  },
  "candidateLabelCoverage": {
    "numerator": 273,
    "denominator": 1146,
    "ratio": 0.23821989528795812
  },
  "topKCandidateLabelCoverage": {
    "numerator": 268,
    "denominator": 519,
    "ratio": 0.5163776493256262
  },
  "evaluableGoldCharacterCoverage": {
    "numerator": 1111,
    "denominator": 2048,
    "ratio": 0.54248046875
  }
}
```

## 49. Recovered Machine Groups

```json
{
  "count": 48,
  "ids": [
    "c612-group:6e85538659256f81ac7b2742",
    "c612-group:eca063dac9eee6742122b88d",
    "c612-group:cbd4ab5bc47670d8bc714d28",
    "c612-group:ecd134db042b3442c096da76",
    "c612-group:dd10d09c4d0c4b5df49dbce3",
    "c612-group:292f31f12a80e326b9a7d0e0",
    "c612-group:0a14d14a7b5f914ea4ef15c6",
    "c612-group:ad345f8c05221e93898c6fb6",
    "c612-group:162cb970c1be65d9e1e8c16c",
    "c612-group:cf9a996378988989755cd543",
    "c612-group:292eb2403e085139baab7f37",
    "c612-group:b39e8a1590c269c74fd86a80",
    "c612-group:25ab33e136c74609bed8b9db",
    "c612-group:cf57d084b9824c08748db915",
    "c612-group:19736378bff4de09dfd6a2ad",
    "c612-group:5f6a5fc710262bfb11ed1124",
    "c612-group:6e6eb42a730aede86117b5c4",
    "c612-group:b89dd89041c4cc91e3ebe561",
    "c612-group:0e889dcc8a91643d08c96950",
    "c612-group:53c365ac7fc37483fa7e7dee",
    "c612-group:aa211e79bbe8ed827d18618c",
    "c612-group:960f740af278a11e3fe344f6",
    "c612-group:876bfe7a93e6fe788be34cc7",
    "c612-group:0eed16278c5bbd3c74761a8c",
    "c612-group:9c2cefc3e839b75a3ce690c4",
    "c612-group:8c33bfd20697fb431bdbf30e",
    "c612-group:7f91f6552dc3b92fece082ce",
    "c612-group:d3fcbc5adb6470a188f6eb72",
    "c612-group:652e3cabe152c12e6fa27920",
    "c612-group:fcd640a3bbd8f1f0519131d0",
    "c612-group:5454591882305e59c64ee39d",
    "c612-group:f9bedb4ae185ffcb6277b3db",
    "c612-group:f3ad8581b87dff4b5e27b5f8",
    "c612-group:86eff08ac0199d947c8b427f",
    "c612-group:4c25c30f5a4bf7b966deb1b7",
    "c612-group:8d776d3e8dfe0a7ee12871dd",
    "c612-group:eb2a1020c431b03553356133",
    "c612-group:eae146227b80590fa6f218c3",
    "c612-group:d1345e762b1eb9ee485ece30",
    "c612-group:cfa3cec034cf14e3cdd1b4f4",
    "c612-group:66a882ff19857c67cbec32d7",
    "c612-group:7c6bd9260cb854c00d618d9d",
    "c612-group:c1befaa03744901308881e8b",
    "c612-group:8f787dc0b98907eb277e9159",
    "c612-group:d7db125a1e4984260bd4aa5d",
    "c612-group:9eb629e0033e43b00d9cddd9",
    "c612-group:962b774b2af00dc348667d1b",
    "c612-group:0e0786c8fd6759a001677c2b"
  ]
}
```

## 50. Recovered Gold Cues

```json
{
  "count": 75,
  "ids": [
    "gold-0002",
    "gold-0003",
    "gold-0004",
    "gold-0005",
    "gold-0006",
    "gold-0011",
    "gold-0012",
    "gold-0013",
    "gold-0014",
    "gold-0015",
    "gold-0016",
    "gold-0017",
    "gold-0018",
    "gold-0019",
    "gold-0020",
    "gold-0021",
    "gold-0022",
    "gold-0023",
    "gold-0024",
    "gold-0025",
    "gold-0033",
    "gold-0034",
    "gold-0035",
    "gold-0036",
    "gold-0037",
    "gold-0038",
    "gold-0050",
    "gold-0051",
    "gold-0069",
    "gold-0070",
    "gold-0071",
    "gold-0072",
    "gold-0073",
    "gold-0074",
    "gold-0075",
    "gold-0076",
    "gold-0080",
    "gold-0081",
    "gold-0082",
    "gold-0088",
    "gold-0089",
    "gold-0090",
    "gold-0096",
    "gold-0097",
    "gold-0098",
    "gold-0099",
    "gold-0100",
    "gold-0101",
    "gold-0102",
    "gold-0112",
    "gold-0140",
    "gold-0141",
    "gold-0142",
    "gold-0143",
    "gold-0145",
    "gold-0146",
    "gold-0147",
    "gold-0148",
    "gold-0149",
    "gold-0150",
    "gold-0151",
    "gold-0152",
    "gold-0153",
    "gold-0160",
    "gold-0161",
    "gold-0162",
    "gold-0163",
    "gold-0164",
    "gold-0165",
    "gold-0166",
    "gold-0167",
    "gold-0168",
    "gold-0169",
    "gold-0177",
    "gold-0178"
  ]
}
```

## 51. Gold-spanning-multiple-groups Recovered

```json
{
  "affectedMachineGroups": 78,
  "affectedGoldCues": 48,
  "affectedConnectedComponents": 22,
  "recoveredMachineGroups": 42
}
```

## 52. Still Ambiguous Reasons

```json
[
  {
    "reason": "CANDIDATE_LABEL_AMBIGUOUS",
    "count": 14
  },
  {
    "reason": "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "count": 22
  },
  {
    "reason": "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "count": 10
  },
  {
    "reason": "NO_GOLD_MAPPING",
    "count": 3
  },
  {
    "reason": "NO_MACHINE_MAPPING",
    "count": 22
  },
  {
    "reason": "TEMPORAL_BRIDGE_GAP_LIMIT",
    "count": 6
  },
  {
    "reason": "TEMPORAL_COMPONENT_CUE_LIMIT",
    "count": 3
  },
  {
    "reason": "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "count": 6
  }
]
```

## 53. Shadow Evaluation Eligibility

```json
{
  "count": 40,
  "rule": "Fixed cue structure plus timing policy; independent from event lineage eligibility"
}
```

## 54. Candidate Label Eligibility

```json
{
  "count": 40,
  "rule": "Unique supergroup and machine-group ownership, exact legal original span, no cross-supergroup application"
}
```

## 55. OOF Training Eligibility

```json
{
  "count": 40,
  "rule": "Candidate eligibility plus a single unchanged outer fold and computable Gold score"
}
```

## 56. Newly Evaluable Candidate Labels

200

## 57. Lost Candidate Labels

33

## 58. Label Agreement

```json
{
  "common": 73,
  "exactSemanticAgreement": 73,
  "definition": "classification, normalized gain direction, exact gain direction and catastrophic flag all agree",
  "gainDirectionAgreement": 73
}
```

## 59. Label Direction Disagreement

```json
{
  "count": 0,
  "rows": []
}
```

## 60. Evaluator Sensitivity

```json
{
  "schemaVersion": "1.0.0",
  "artifactType": "c6-1-2-1-evaluator-sensitivity",
  "policyVersion": "c6.1.2.1-gold-isolated-supergroup-evaluation-v1",
  "policyHash": "103658a16801bc0baad7b57686d563044815b0a2a0b3654acc07bcc3cbefd77b",
  "semanticHash": "e3d3223a0c190430b40aae79dc89e13fba4da5107cd31d2ca094c5e87a357644",
  "comparisons": [
    {
      "profileId": "L0",
      "mode": "E0",
      "improved": 6,
      "regressed": 6,
      "neutral": 7,
      "unknown": 91,
      "normalizedJointGain": 3,
      "materialDelta": 1,
      "catastrophicDeletionCount": 4,
      "precision": 0.5,
      "harm": 0.3157894736842105,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 23,
          "evaluated": 5,
          "improved": 1,
          "regressed": 3,
          "neutral": 1,
          "unknown": 18,
          "normalizedJointGain": -2
        },
        {
          "foldId": "outer-2",
          "changed": 8,
          "evaluated": 1,
          "improved": 1,
          "regressed": 0,
          "neutral": 0,
          "unknown": 7,
          "normalizedJointGain": 9
        },
        {
          "foldId": "outer-3",
          "changed": 22,
          "evaluated": 2,
          "improved": 1,
          "regressed": 0,
          "neutral": 1,
          "unknown": 20,
          "normalizedJointGain": 2
        },
        {
          "foldId": "outer-4",
          "changed": 29,
          "evaluated": 4,
          "improved": 1,
          "regressed": 2,
          "neutral": 1,
          "unknown": 25,
          "normalizedJointGain": -10
        },
        {
          "foldId": "outer-5",
          "changed": 28,
          "evaluated": 7,
          "improved": 2,
          "regressed": 1,
          "neutral": 4,
          "unknown": 21,
          "normalizedJointGain": 4
        }
      ]
    },
    {
      "profileId": "L1",
      "mode": "E0",
      "improved": 7,
      "regressed": 6,
      "neutral": 6,
      "unknown": 91,
      "normalizedJointGain": 11,
      "materialDelta": 1,
      "catastrophicDeletionCount": 4,
      "precision": 0.5384615384615384,
      "harm": 0.3157894736842105,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 23,
          "evaluated": 5,
          "improved": 1,
          "regressed": 3,
          "neutral": 1,
          "unknown": 18,
          "normalizedJointGain": -6
        },
        {
          "foldId": "outer-2",
          "changed": 8,
          "evaluated": 1,
          "improved": 1,
          "regressed": 0,
          "neutral": 0,
          "unknown": 7,
          "normalizedJointGain": 9
        },
        {
          "foldId": "outer-3",
          "changed": 22,
          "evaluated": 2,
          "improved": 1,
          "regressed": 1,
          "neutral": 0,
          "unknown": 20,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 29,
          "evaluated": 4,
          "improved": 1,
          "regressed": 1,
          "neutral": 2,
          "unknown": 25,
          "normalizedJointGain": -2
        },
        {
          "foldId": "outer-5",
          "changed": 28,
          "evaluated": 7,
          "improved": 3,
          "regressed": 1,
          "neutral": 3,
          "unknown": 21,
          "normalizedJointGain": 10
        }
      ]
    },
    {
      "profileId": "L2",
      "mode": "E0",
      "improved": 2,
      "regressed": 3,
      "neutral": 9,
      "unknown": 69,
      "normalizedJointGain": -8,
      "materialDelta": 1,
      "catastrophicDeletionCount": 1,
      "precision": 0.4,
      "harm": 0.21428571428571427,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 19,
          "evaluated": 3,
          "improved": 1,
          "regressed": 1,
          "neutral": 1,
          "unknown": 16,
          "normalizedJointGain": -3
        },
        {
          "foldId": "outer-2",
          "changed": 7,
          "evaluated": 1,
          "improved": 0,
          "regressed": 1,
          "neutral": 0,
          "unknown": 6,
          "normalizedJointGain": -5
        },
        {
          "foldId": "outer-3",
          "changed": 14,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 14,
          "normalizedJointGain": null
        },
        {
          "foldId": "outer-4",
          "changed": 25,
          "evaluated": 3,
          "improved": 1,
          "regressed": 0,
          "neutral": 2,
          "unknown": 22,
          "normalizedJointGain": 1
        },
        {
          "foldId": "outer-5",
          "changed": 18,
          "evaluated": 7,
          "improved": 0,
          "regressed": 1,
          "neutral": 6,
          "unknown": 11,
          "normalizedJointGain": -1
        }
      ]
    },
    {
      "profileId": "L3",
      "mode": "E0",
      "improved": 1,
      "regressed": 4,
      "neutral": 9,
      "unknown": 70,
      "normalizedJointGain": -14,
      "materialDelta": 2,
      "catastrophicDeletionCount": 2,
      "precision": 0.2,
      "harm": 0.2857142857142857,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 21,
          "evaluated": 4,
          "improved": 1,
          "regressed": 2,
          "neutral": 1,
          "unknown": 17,
          "normalizedJointGain": -4
        },
        {
          "foldId": "outer-2",
          "changed": 7,
          "evaluated": 1,
          "improved": 0,
          "regressed": 1,
          "neutral": 0,
          "unknown": 6,
          "normalizedJointGain": -4
        },
        {
          "foldId": "outer-3",
          "changed": 16,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 16,
          "normalizedJointGain": null
        },
        {
          "foldId": "outer-4",
          "changed": 22,
          "evaluated": 2,
          "improved": 0,
          "regressed": 1,
          "neutral": 1,
          "unknown": 20,
          "normalizedJointGain": -6
        },
        {
          "foldId": "outer-5",
          "changed": 18,
          "evaluated": 7,
          "improved": 0,
          "regressed": 0,
          "neutral": 7,
          "unknown": 11,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L4",
      "mode": "E0",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L5",
      "mode": "E0",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L6",
      "mode": "E0",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L7",
      "mode": "E0",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L8",
      "mode": "E0",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L0",
      "mode": "E1",
      "improved": 12,
      "regressed": 19,
      "neutral": 8,
      "unknown": 18,
      "normalizedJointGain": -84,
      "materialDelta": 4,
      "catastrophicDeletionCount": 6,
      "precision": 0.3870967741935484,
      "harm": 0.48717948717948717,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 13,
          "evaluated": 9,
          "improved": 1,
          "regressed": 7,
          "neutral": 1,
          "unknown": 4,
          "normalizedJointGain": -29
        },
        {
          "foldId": "outer-2",
          "changed": 5,
          "evaluated": 3,
          "improved": 2,
          "regressed": 1,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": 5
        },
        {
          "foldId": "outer-3",
          "changed": 12,
          "evaluated": 9,
          "improved": 4,
          "regressed": 3,
          "neutral": 2,
          "unknown": 3,
          "normalizedJointGain": -42
        },
        {
          "foldId": "outer-4",
          "changed": 14,
          "evaluated": 9,
          "improved": 3,
          "regressed": 5,
          "neutral": 1,
          "unknown": 5,
          "normalizedJointGain": -14
        },
        {
          "foldId": "outer-5",
          "changed": 13,
          "evaluated": 9,
          "improved": 2,
          "regressed": 3,
          "neutral": 4,
          "unknown": 4,
          "normalizedJointGain": -4
        }
      ]
    },
    {
      "profileId": "L1",
      "mode": "E1",
      "improved": 14,
      "regressed": 18,
      "neutral": 7,
      "unknown": 19,
      "normalizedJointGain": -8,
      "materialDelta": 2,
      "catastrophicDeletionCount": 6,
      "precision": 0.4375,
      "harm": 0.46153846153846156,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 13,
          "evaluated": 9,
          "improved": 1,
          "regressed": 7,
          "neutral": 1,
          "unknown": 4,
          "normalizedJointGain": -30
        },
        {
          "foldId": "outer-2",
          "changed": 5,
          "evaluated": 3,
          "improved": 2,
          "regressed": 1,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": -3
        },
        {
          "foldId": "outer-3",
          "changed": 13,
          "evaluated": 9,
          "improved": 3,
          "regressed": 6,
          "neutral": 0,
          "unknown": 4,
          "normalizedJointGain": -9
        },
        {
          "foldId": "outer-4",
          "changed": 14,
          "evaluated": 9,
          "improved": 4,
          "regressed": 2,
          "neutral": 3,
          "unknown": 5,
          "normalizedJointGain": 9
        },
        {
          "foldId": "outer-5",
          "changed": 13,
          "evaluated": 9,
          "improved": 4,
          "regressed": 2,
          "neutral": 3,
          "unknown": 4,
          "normalizedJointGain": 25
        }
      ]
    },
    {
      "profileId": "L2",
      "mode": "E1",
      "improved": 9,
      "regressed": 11,
      "neutral": 12,
      "unknown": 17,
      "normalizedJointGain": -34,
      "materialDelta": 2,
      "catastrophicDeletionCount": 2,
      "precision": 0.45,
      "harm": 0.34375,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 10,
          "evaluated": 7,
          "improved": 1,
          "regressed": 5,
          "neutral": 1,
          "unknown": 3,
          "normalizedJointGain": -27
        },
        {
          "foldId": "outer-2",
          "changed": 4,
          "evaluated": 2,
          "improved": 2,
          "regressed": 0,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": 7
        },
        {
          "foldId": "outer-3",
          "changed": 10,
          "evaluated": 6,
          "improved": 2,
          "regressed": 4,
          "neutral": 0,
          "unknown": 4,
          "normalizedJointGain": -27
        },
        {
          "foldId": "outer-4",
          "changed": 13,
          "evaluated": 8,
          "improved": 4,
          "regressed": 1,
          "neutral": 3,
          "unknown": 5,
          "normalizedJointGain": 14
        },
        {
          "foldId": "outer-5",
          "changed": 12,
          "evaluated": 9,
          "improved": 0,
          "regressed": 1,
          "neutral": 8,
          "unknown": 3,
          "normalizedJointGain": -1
        }
      ]
    },
    {
      "profileId": "L3",
      "mode": "E1",
      "improved": 8,
      "regressed": 11,
      "neutral": 13,
      "unknown": 16,
      "normalizedJointGain": -65,
      "materialDelta": 4,
      "catastrophicDeletionCount": 2,
      "precision": 0.42105263157894735,
      "harm": 0.34375,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 11,
          "evaluated": 8,
          "improved": 1,
          "regressed": 6,
          "neutral": 1,
          "unknown": 3,
          "normalizedJointGain": -28
        },
        {
          "foldId": "outer-2",
          "changed": 4,
          "evaluated": 2,
          "improved": 2,
          "regressed": 0,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": 7
        },
        {
          "foldId": "outer-3",
          "changed": 9,
          "evaluated": 6,
          "improved": 1,
          "regressed": 4,
          "neutral": 1,
          "unknown": 3,
          "normalizedJointGain": -52
        },
        {
          "foldId": "outer-4",
          "changed": 12,
          "evaluated": 7,
          "improved": 4,
          "regressed": 1,
          "neutral": 2,
          "unknown": 5,
          "normalizedJointGain": 8
        },
        {
          "foldId": "outer-5",
          "changed": 12,
          "evaluated": 9,
          "improved": 0,
          "regressed": 0,
          "neutral": 9,
          "unknown": 3,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L4",
      "mode": "E1",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L5",
      "mode": "E1",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L6",
      "mode": "E1",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L7",
      "mode": "E1",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L8",
      "mode": "E1",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L0",
      "mode": "E2",
      "improved": 12,
      "regressed": 19,
      "neutral": 8,
      "unknown": 17,
      "normalizedJointGain": -73,
      "materialDelta": 4,
      "catastrophicDeletionCount": 6,
      "precision": 0.3870967741935484,
      "harm": 0.48717948717948717,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 13,
          "evaluated": 9,
          "improved": 1,
          "regressed": 7,
          "neutral": 1,
          "unknown": 4,
          "normalizedJointGain": -29
        },
        {
          "foldId": "outer-2",
          "changed": 5,
          "evaluated": 3,
          "improved": 2,
          "regressed": 1,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": 5
        },
        {
          "foldId": "outer-3",
          "changed": 11,
          "evaluated": 8,
          "improved": 4,
          "regressed": 2,
          "neutral": 2,
          "unknown": 3,
          "normalizedJointGain": -26
        },
        {
          "foldId": "outer-4",
          "changed": 14,
          "evaluated": 9,
          "improved": 3,
          "regressed": 5,
          "neutral": 1,
          "unknown": 5,
          "normalizedJointGain": -14
        },
        {
          "foldId": "outer-5",
          "changed": 13,
          "evaluated": 10,
          "improved": 2,
          "regressed": 4,
          "neutral": 4,
          "unknown": 3,
          "normalizedJointGain": -9
        }
      ]
    },
    {
      "profileId": "L1",
      "mode": "E2",
      "improved": 14,
      "regressed": 18,
      "neutral": 7,
      "unknown": 17,
      "normalizedJointGain": -9,
      "materialDelta": 2,
      "catastrophicDeletionCount": 6,
      "precision": 0.4375,
      "harm": 0.46153846153846156,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 13,
          "evaluated": 9,
          "improved": 1,
          "regressed": 7,
          "neutral": 1,
          "unknown": 4,
          "normalizedJointGain": -30
        },
        {
          "foldId": "outer-2",
          "changed": 5,
          "evaluated": 3,
          "improved": 2,
          "regressed": 1,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": -3
        },
        {
          "foldId": "outer-3",
          "changed": 11,
          "evaluated": 8,
          "improved": 3,
          "regressed": 5,
          "neutral": 0,
          "unknown": 3,
          "normalizedJointGain": -5
        },
        {
          "foldId": "outer-4",
          "changed": 14,
          "evaluated": 9,
          "improved": 4,
          "regressed": 2,
          "neutral": 3,
          "unknown": 5,
          "normalizedJointGain": 9
        },
        {
          "foldId": "outer-5",
          "changed": 13,
          "evaluated": 10,
          "improved": 4,
          "regressed": 3,
          "neutral": 3,
          "unknown": 3,
          "normalizedJointGain": 20
        }
      ]
    },
    {
      "profileId": "L2",
      "mode": "E2",
      "improved": 9,
      "regressed": 10,
      "neutral": 12,
      "unknown": 16,
      "normalizedJointGain": -28,
      "materialDelta": 2,
      "catastrophicDeletionCount": 2,
      "precision": 0.47368421052631576,
      "harm": 0.3225806451612903,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 10,
          "evaluated": 7,
          "improved": 1,
          "regressed": 5,
          "neutral": 1,
          "unknown": 3,
          "normalizedJointGain": -27
        },
        {
          "foldId": "outer-2",
          "changed": 4,
          "evaluated": 2,
          "improved": 2,
          "regressed": 0,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": 7
        },
        {
          "foldId": "outer-3",
          "changed": 8,
          "evaluated": 5,
          "improved": 2,
          "regressed": 3,
          "neutral": 0,
          "unknown": 3,
          "normalizedJointGain": -21
        },
        {
          "foldId": "outer-4",
          "changed": 13,
          "evaluated": 8,
          "improved": 4,
          "regressed": 1,
          "neutral": 3,
          "unknown": 5,
          "normalizedJointGain": 14
        },
        {
          "foldId": "outer-5",
          "changed": 12,
          "evaluated": 9,
          "improved": 0,
          "regressed": 1,
          "neutral": 8,
          "unknown": 3,
          "normalizedJointGain": -1
        }
      ]
    },
    {
      "profileId": "L3",
      "mode": "E2",
      "improved": 8,
      "regressed": 10,
      "neutral": 13,
      "unknown": 16,
      "normalizedJointGain": -54,
      "materialDelta": 4,
      "catastrophicDeletionCount": 2,
      "precision": 0.4444444444444444,
      "harm": 0.3225806451612903,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 11,
          "evaluated": 8,
          "improved": 1,
          "regressed": 6,
          "neutral": 1,
          "unknown": 3,
          "normalizedJointGain": -28
        },
        {
          "foldId": "outer-2",
          "changed": 4,
          "evaluated": 2,
          "improved": 2,
          "regressed": 0,
          "neutral": 0,
          "unknown": 2,
          "normalizedJointGain": 7
        },
        {
          "foldId": "outer-3",
          "changed": 8,
          "evaluated": 5,
          "improved": 1,
          "regressed": 3,
          "neutral": 1,
          "unknown": 3,
          "normalizedJointGain": -41
        },
        {
          "foldId": "outer-4",
          "changed": 12,
          "evaluated": 7,
          "improved": 4,
          "regressed": 1,
          "neutral": 2,
          "unknown": 5,
          "normalizedJointGain": 8
        },
        {
          "foldId": "outer-5",
          "changed": 12,
          "evaluated": 9,
          "improved": 0,
          "regressed": 0,
          "neutral": 9,
          "unknown": 3,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L4",
      "mode": "E2",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L5",
      "mode": "E2",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L6",
      "mode": "E2",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L7",
      "mode": "E2",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    },
    {
      "profileId": "L8",
      "mode": "E2",
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0,
      "materialDelta": 0,
      "catastrophicDeletionCount": 0,
      "precision": null,
      "harm": null,
      "folds": [
        {
          "foldId": "outer-1",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-2",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-3",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-4",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        },
        {
          "foldId": "outer-5",
          "changed": 0,
          "evaluated": 0,
          "improved": 0,
          "regressed": 0,
          "neutral": 0,
          "unknown": 0,
          "normalizedJointGain": 0
        }
      ]
    }
  ],
  "directionDisagreements": [],
  "frozenL1CatastrophicTrace": [
    {
      "machineGroupId": "c612-group:d0b0f836fb8a7d780a3ce89d",
      "supergroupId": "c6121-supergroup:6c3fdd1edbd7d03b5c97cea4",
      "outcome": "STILL_CATASTROPHIC",
      "reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
    },
    {
      "machineGroupId": "c612-group:867dbec6cab2942bf65b6f83",
      "supergroupId": "c6121-supergroup:1531bd28f1164a31267cf755",
      "outcome": "STILL_CATASTROPHIC",
      "reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
    },
    {
      "machineGroupId": "c612-group:b56920c6f718b2830ac86e94",
      "supergroupId": "c6121-supergroup:ce35ac459fddb2d25aa3bbda",
      "outcome": "STILL_CATASTROPHIC",
      "reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
    },
    {
      "machineGroupId": "c612-group:596b77a22b8cf1a8d7dd5e13",
      "supergroupId": "c6121-supergroup:adf154d765af0e1c3c7bd0f3",
      "outcome": "STILL_CATASTROPHIC",
      "reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
    }
  ]
}
```

## 61. Frozen L0 Evaluation

```json
{
  "profileId": "L0",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 56,
  "evaluableChangedSupergroups": 39,
  "changedMachineGroups": 110,
  "improved": 12,
  "regressed": 19,
  "neutral": 8,
  "unknown": 17,
  "selectionPrecision": 0.3870967741935484,
  "harmRate": 0.48717948717948717,
  "exactJointGain": -54,
  "normalizedJointGain": -73,
  "materialDelta": 4,
  "legacyMaterialDelta": 4,
  "catastrophicDeletionCount": 6,
  "changedSupergroupCoverage": {
    "numerator": 39,
    "denominator": 56,
    "ratio": 0.6964285714285714
  },
  "changedMachineGroupCoverage": {
    "numerator": 65,
    "denominator": 110,
    "ratio": 0.5909090909090909
  },
  "zeroSelectionChangedCoverage": 0.6964285714285714,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 4,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 30,
    "denominator": 75,
    "ratio": 0.4
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 13,
      "evaluated": 9,
      "improved": 1,
      "regressed": 7,
      "neutral": 1,
      "unknown": 4,
      "normalizedJointGain": -29
    },
    {
      "foldId": "outer-2",
      "changed": 5,
      "evaluated": 3,
      "improved": 2,
      "regressed": 1,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": 5
    },
    {
      "foldId": "outer-3",
      "changed": 11,
      "evaluated": 8,
      "improved": 4,
      "regressed": 2,
      "neutral": 2,
      "unknown": 3,
      "normalizedJointGain": -26
    },
    {
      "foldId": "outer-4",
      "changed": 14,
      "evaluated": 9,
      "improved": 3,
      "regressed": 5,
      "neutral": 1,
      "unknown": 5,
      "normalizedJointGain": -14
    },
    {
      "foldId": "outer-5",
      "changed": 13,
      "evaluated": 10,
      "improved": 2,
      "regressed": 4,
      "neutral": 4,
      "unknown": 3,
      "normalizedJointGain": -9
    }
  ]
}
```

## 62. Frozen L1 Evaluation

```json
{
  "profileId": "L1",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 56,
  "evaluableChangedSupergroups": 39,
  "changedMachineGroups": 110,
  "improved": 14,
  "regressed": 18,
  "neutral": 7,
  "unknown": 17,
  "selectionPrecision": 0.4375,
  "harmRate": 0.46153846153846156,
  "exactJointGain": 18,
  "normalizedJointGain": -9,
  "materialDelta": 2,
  "legacyMaterialDelta": 2,
  "catastrophicDeletionCount": 6,
  "changedSupergroupCoverage": {
    "numerator": 39,
    "denominator": 56,
    "ratio": 0.6964285714285714
  },
  "changedMachineGroupCoverage": {
    "numerator": 65,
    "denominator": 110,
    "ratio": 0.5909090909090909
  },
  "zeroSelectionChangedCoverage": 0.6964285714285714,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 3,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 34,
    "denominator": 75,
    "ratio": 0.4533333333333333
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 13,
      "evaluated": 9,
      "improved": 1,
      "regressed": 7,
      "neutral": 1,
      "unknown": 4,
      "normalizedJointGain": -30
    },
    {
      "foldId": "outer-2",
      "changed": 5,
      "evaluated": 3,
      "improved": 2,
      "regressed": 1,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": -3
    },
    {
      "foldId": "outer-3",
      "changed": 11,
      "evaluated": 8,
      "improved": 3,
      "regressed": 5,
      "neutral": 0,
      "unknown": 3,
      "normalizedJointGain": -5
    },
    {
      "foldId": "outer-4",
      "changed": 14,
      "evaluated": 9,
      "improved": 4,
      "regressed": 2,
      "neutral": 3,
      "unknown": 5,
      "normalizedJointGain": 9
    },
    {
      "foldId": "outer-5",
      "changed": 13,
      "evaluated": 10,
      "improved": 4,
      "regressed": 3,
      "neutral": 3,
      "unknown": 3,
      "normalizedJointGain": 20
    }
  ]
}
```

## 63. Frozen L2 Evaluation

```json
{
  "profileId": "L2",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 47,
  "evaluableChangedSupergroups": 31,
  "changedMachineGroups": 83,
  "improved": 9,
  "regressed": 10,
  "neutral": 12,
  "unknown": 16,
  "selectionPrecision": 0.47368421052631576,
  "harmRate": 0.3225806451612903,
  "exactJointGain": -15,
  "normalizedJointGain": -28,
  "materialDelta": 2,
  "legacyMaterialDelta": 2,
  "catastrophicDeletionCount": 2,
  "changedSupergroupCoverage": {
    "numerator": 31,
    "denominator": 47,
    "ratio": 0.6595744680851063
  },
  "changedMachineGroupCoverage": {
    "numerator": 53,
    "denominator": 83,
    "ratio": 0.6385542168674698
  },
  "zeroSelectionChangedCoverage": 0.6595744680851063,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 3,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 39,
    "denominator": 75,
    "ratio": 0.52
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 10,
      "evaluated": 7,
      "improved": 1,
      "regressed": 5,
      "neutral": 1,
      "unknown": 3,
      "normalizedJointGain": -27
    },
    {
      "foldId": "outer-2",
      "changed": 4,
      "evaluated": 2,
      "improved": 2,
      "regressed": 0,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": 7
    },
    {
      "foldId": "outer-3",
      "changed": 8,
      "evaluated": 5,
      "improved": 2,
      "regressed": 3,
      "neutral": 0,
      "unknown": 3,
      "normalizedJointGain": -21
    },
    {
      "foldId": "outer-4",
      "changed": 13,
      "evaluated": 8,
      "improved": 4,
      "regressed": 1,
      "neutral": 3,
      "unknown": 5,
      "normalizedJointGain": 14
    },
    {
      "foldId": "outer-5",
      "changed": 12,
      "evaluated": 9,
      "improved": 0,
      "regressed": 1,
      "neutral": 8,
      "unknown": 3,
      "normalizedJointGain": -1
    }
  ]
}
```

## 64. Frozen L3 Evaluation

```json
{
  "profileId": "L3",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 47,
  "evaluableChangedSupergroups": 31,
  "changedMachineGroups": 84,
  "improved": 8,
  "regressed": 10,
  "neutral": 13,
  "unknown": 16,
  "selectionPrecision": 0.4444444444444444,
  "harmRate": 0.3225806451612903,
  "exactJointGain": -41,
  "normalizedJointGain": -54,
  "materialDelta": 4,
  "legacyMaterialDelta": 4,
  "catastrophicDeletionCount": 2,
  "changedSupergroupCoverage": {
    "numerator": 31,
    "denominator": 47,
    "ratio": 0.6595744680851063
  },
  "changedMachineGroupCoverage": {
    "numerator": 56,
    "denominator": 84,
    "ratio": 0.6666666666666666
  },
  "zeroSelectionChangedCoverage": 0.6595744680851063,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 2,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 38,
    "denominator": 75,
    "ratio": 0.5066666666666667
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 11,
      "evaluated": 8,
      "improved": 1,
      "regressed": 6,
      "neutral": 1,
      "unknown": 3,
      "normalizedJointGain": -28
    },
    {
      "foldId": "outer-2",
      "changed": 4,
      "evaluated": 2,
      "improved": 2,
      "regressed": 0,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": 7
    },
    {
      "foldId": "outer-3",
      "changed": 8,
      "evaluated": 5,
      "improved": 1,
      "regressed": 3,
      "neutral": 1,
      "unknown": 3,
      "normalizedJointGain": -41
    },
    {
      "foldId": "outer-4",
      "changed": 12,
      "evaluated": 7,
      "improved": 4,
      "regressed": 1,
      "neutral": 2,
      "unknown": 5,
      "normalizedJointGain": 8
    },
    {
      "foldId": "outer-5",
      "changed": 12,
      "evaluated": 9,
      "improved": 0,
      "regressed": 0,
      "neutral": 9,
      "unknown": 3,
      "normalizedJointGain": 0
    }
  ]
}
```

## 65. Frozen L4 Evaluation

```json
{
  "profileId": "L4",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 38,
    "denominator": 75,
    "ratio": 0.5066666666666667
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 66. Frozen L5 Evaluation

```json
{
  "profileId": "L5",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 38,
    "denominator": 75,
    "ratio": 0.5066666666666667
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 67. Frozen L6 Evaluation

```json
{
  "profileId": "L6",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 38,
    "denominator": 75,
    "ratio": 0.5066666666666667
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 68. Frozen L7 Evaluation

```json
{
  "profileId": "L7",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 40,
    "denominator": 75,
    "ratio": 0.5333333333333333
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 69. Frozen L8 Evaluation

```json
{
  "profileId": "L8",
  "track": "FROZEN_DECISION_REEVALUATION",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 35,
    "denominator": 75,
    "ratio": 0.4666666666666667
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 70. Frozen Decision Best Descriptive Profile

```json
{
  "descriptiveOnly": true,
  "profile": "L1",
  "safeSelection": false
}
```

## 71. Frozen Decision Improved

```json
{
  "profile": "L1",
  "value": 14,
  "descriptiveOnly": true
}
```

## 72. Frozen Decision Regressed

```json
{
  "profile": "L1",
  "value": 18,
  "descriptiveOnly": true
}
```

## 73. Frozen Decision Neutral

```json
{
  "profile": "L1",
  "value": 7,
  "descriptiveOnly": true
}
```

## 74. Frozen Decision Unknown

```json
{
  "profile": "L1",
  "value": 17,
  "descriptiveOnly": true
}
```

## 75. Frozen Decision Precision

```json
{
  "profile": "L1",
  "value": 0.4375,
  "descriptiveOnly": true
}
```

## 76. Frozen Decision Harm

```json
{
  "profile": "L1",
  "value": 0.46153846153846156,
  "descriptiveOnly": true
}
```

## 77. Frozen Decision Joint Gain

```json
{
  "profile": "L1",
  "value": -9,
  "descriptiveOnly": true
}
```

## 78. Frozen Decision Material Delta

```json
{
  "profile": "L1",
  "value": 2,
  "descriptiveOnly": true
}
```

## 79. Frozen Decision Catastrophic Count

```json
{
  "profile": "L1",
  "value": 6,
  "descriptiveOnly": true
}
```

## 80. Same-feature OOF Retrain Design

```json
{
  "trainingContract": "PRESERVE_FROZEN_MACHINE_GROUP_ID_WEIGHTING_ONLY_NUMERIC_OUTCOMES_CHANGE",
  "design": "Unchanged runC612Oof, nested train-only threshold fitting and group assembler; separate child receives no Gold path. Numeric labels change, not model classes or feature definitions. Original machine-group IDs retain the existing training weights.",
  "codeHash": "2601f5e42958b444758885b6ea3dda6da38b1b360f7cd1e1474f8a68d6a15cd9"
}
```

## 81. Feature Hash Parity

```json
{
  "parity": true,
  "hash": "4910227791331e7380c9a3e558effc9aa876ef86e655f93c4e8c1715f492b235"
}
```

## 82. Fold Hash Parity

```json
{
  "parity": true,
  "hash": "ee7eb733e04bff203f37bc769fac0d7e4badc854e2888d2c84538aa3ac94d29c"
}
```

## 83. Profile Definition Parity

```json
{
  "parity": true,
  "hash": "dc3ff568660d95591d3abde3e69c09971dcfabc09444a2b33c7f078b21232a48"
}
```

## 84. Threshold Grid Parity

```json
{
  "parity": true,
  "hash": "774671a76f008ce64d935f1b50ea0492d23085ba54cb04cde471cd5d313fe1e9"
}
```

## 85. OOF L0

```json
{
  "profileId": "L0",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 56,
  "evaluableChangedSupergroups": 39,
  "changedMachineGroups": 110,
  "improved": 12,
  "regressed": 19,
  "neutral": 8,
  "unknown": 17,
  "selectionPrecision": 0.3870967741935484,
  "harmRate": 0.48717948717948717,
  "exactJointGain": -54,
  "normalizedJointGain": -73,
  "materialDelta": 4,
  "legacyMaterialDelta": 4,
  "catastrophicDeletionCount": 6,
  "changedSupergroupCoverage": {
    "numerator": 39,
    "denominator": 56,
    "ratio": 0.6964285714285714
  },
  "changedMachineGroupCoverage": {
    "numerator": 65,
    "denominator": 110,
    "ratio": 0.5909090909090909
  },
  "zeroSelectionChangedCoverage": 0.6964285714285714,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 4,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 30,
    "denominator": 75,
    "ratio": 0.4
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 13,
      "evaluated": 9,
      "improved": 1,
      "regressed": 7,
      "neutral": 1,
      "unknown": 4,
      "normalizedJointGain": -29
    },
    {
      "foldId": "outer-2",
      "changed": 5,
      "evaluated": 3,
      "improved": 2,
      "regressed": 1,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": 5
    },
    {
      "foldId": "outer-3",
      "changed": 11,
      "evaluated": 8,
      "improved": 4,
      "regressed": 2,
      "neutral": 2,
      "unknown": 3,
      "normalizedJointGain": -26
    },
    {
      "foldId": "outer-4",
      "changed": 14,
      "evaluated": 9,
      "improved": 3,
      "regressed": 5,
      "neutral": 1,
      "unknown": 5,
      "normalizedJointGain": -14
    },
    {
      "foldId": "outer-5",
      "changed": 13,
      "evaluated": 10,
      "improved": 2,
      "regressed": 4,
      "neutral": 4,
      "unknown": 3,
      "normalizedJointGain": -9
    }
  ]
}
```

## 86. OOF L1

```json
{
  "profileId": "L1",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 56,
  "evaluableChangedSupergroups": 39,
  "changedMachineGroups": 110,
  "improved": 14,
  "regressed": 18,
  "neutral": 7,
  "unknown": 17,
  "selectionPrecision": 0.4375,
  "harmRate": 0.46153846153846156,
  "exactJointGain": 18,
  "normalizedJointGain": -9,
  "materialDelta": 2,
  "legacyMaterialDelta": 2,
  "catastrophicDeletionCount": 6,
  "changedSupergroupCoverage": {
    "numerator": 39,
    "denominator": 56,
    "ratio": 0.6964285714285714
  },
  "changedMachineGroupCoverage": {
    "numerator": 65,
    "denominator": 110,
    "ratio": 0.5909090909090909
  },
  "zeroSelectionChangedCoverage": 0.6964285714285714,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 3,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 34,
    "denominator": 75,
    "ratio": 0.4533333333333333
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 13,
      "evaluated": 9,
      "improved": 1,
      "regressed": 7,
      "neutral": 1,
      "unknown": 4,
      "normalizedJointGain": -30
    },
    {
      "foldId": "outer-2",
      "changed": 5,
      "evaluated": 3,
      "improved": 2,
      "regressed": 1,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": -3
    },
    {
      "foldId": "outer-3",
      "changed": 11,
      "evaluated": 8,
      "improved": 3,
      "regressed": 5,
      "neutral": 0,
      "unknown": 3,
      "normalizedJointGain": -5
    },
    {
      "foldId": "outer-4",
      "changed": 14,
      "evaluated": 9,
      "improved": 4,
      "regressed": 2,
      "neutral": 3,
      "unknown": 5,
      "normalizedJointGain": 9
    },
    {
      "foldId": "outer-5",
      "changed": 13,
      "evaluated": 10,
      "improved": 4,
      "regressed": 3,
      "neutral": 3,
      "unknown": 3,
      "normalizedJointGain": 20
    }
  ]
}
```

## 87. OOF L2

```json
{
  "profileId": "L2",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 35,
  "evaluableChangedSupergroups": 24,
  "changedMachineGroups": 47,
  "improved": 9,
  "regressed": 9,
  "neutral": 6,
  "unknown": 11,
  "selectionPrecision": 0.5,
  "harmRate": 0.375,
  "exactJointGain": 3,
  "normalizedJointGain": -3,
  "materialDelta": 1,
  "legacyMaterialDelta": 1,
  "catastrophicDeletionCount": 3,
  "changedSupergroupCoverage": {
    "numerator": 24,
    "denominator": 35,
    "ratio": 0.6857142857142857
  },
  "changedMachineGroupCoverage": {
    "numerator": 32,
    "denominator": 47,
    "ratio": 0.6808510638297872
  },
  "zeroSelectionChangedCoverage": 0.6857142857142857,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 1,
  "unknownGainFoldCount": 5,
  "top1Accuracy": {
    "numerator": 40,
    "denominator": 75,
    "ratio": 0.5333333333333333
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 13,
      "evaluated": 9,
      "improved": 1,
      "regressed": 7,
      "neutral": 1,
      "unknown": 4,
      "normalizedJointGain": -28
    },
    {
      "foldId": "outer-2",
      "changed": 4,
      "evaluated": 2,
      "improved": 2,
      "regressed": 0,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": 12
    },
    {
      "foldId": "outer-3",
      "changed": 8,
      "evaluated": 6,
      "improved": 4,
      "regressed": 1,
      "neutral": 1,
      "unknown": 2,
      "normalizedJointGain": 12
    },
    {
      "foldId": "outer-4",
      "changed": 2,
      "evaluated": 1,
      "improved": 1,
      "regressed": 0,
      "neutral": 0,
      "unknown": 1,
      "normalizedJointGain": 1
    },
    {
      "foldId": "outer-5",
      "changed": 8,
      "evaluated": 6,
      "improved": 1,
      "regressed": 1,
      "neutral": 4,
      "unknown": 2,
      "normalizedJointGain": 0
    }
  ]
}
```

## 88. OOF L3

```json
{
  "profileId": "L3",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 24,
  "evaluableChangedSupergroups": 15,
  "changedMachineGroups": 33,
  "improved": 5,
  "regressed": 8,
  "neutral": 2,
  "unknown": 9,
  "selectionPrecision": 0.38461538461538464,
  "harmRate": 0.5333333333333333,
  "exactJointGain": -21,
  "normalizedJointGain": -29,
  "materialDelta": 3,
  "legacyMaterialDelta": 3,
  "catastrophicDeletionCount": 3,
  "changedSupergroupCoverage": {
    "numerator": 15,
    "denominator": 24,
    "ratio": 0.625
  },
  "changedMachineGroupCoverage": {
    "numerator": 22,
    "denominator": 33,
    "ratio": 0.6666666666666666
  },
  "zeroSelectionChangedCoverage": 0.625,
  "activeFoldCount": 5,
  "negativeGainFoldCount": 2,
  "unknownGainFoldCount": 4,
  "top1Accuracy": {
    "numerator": 33,
    "denominator": 75,
    "ratio": 0.44
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 13,
      "evaluated": 9,
      "improved": 1,
      "regressed": 7,
      "neutral": 1,
      "unknown": 4,
      "normalizedJointGain": -38
    },
    {
      "foldId": "outer-2",
      "changed": 4,
      "evaluated": 2,
      "improved": 2,
      "regressed": 0,
      "neutral": 0,
      "unknown": 2,
      "normalizedJointGain": 10
    },
    {
      "foldId": "outer-3",
      "changed": 3,
      "evaluated": 2,
      "improved": 1,
      "regressed": 1,
      "neutral": 0,
      "unknown": 1,
      "normalizedJointGain": -2
    },
    {
      "foldId": "outer-4",
      "changed": 1,
      "evaluated": 1,
      "improved": 1,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 1
    },
    {
      "foldId": "outer-5",
      "changed": 3,
      "evaluated": 1,
      "improved": 0,
      "regressed": 0,
      "neutral": 1,
      "unknown": 2,
      "normalizedJointGain": 0
    }
  ]
}
```

## 89. OOF L4

```json
{
  "profileId": "L4",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 33,
    "denominator": 75,
    "ratio": 0.44
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 90. OOF L5

```json
{
  "profileId": "L5",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 33,
    "denominator": 75,
    "ratio": 0.44
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 91. OOF L6

```json
{
  "profileId": "L6",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 33,
    "denominator": 75,
    "ratio": 0.44
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 92. OOF L7

```json
{
  "profileId": "L7",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 33,
    "denominator": 75,
    "ratio": 0.44
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 93. OOF L8

```json
{
  "profileId": "L8",
  "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
  "supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
  "changedSupergroups": 0,
  "evaluableChangedSupergroups": 0,
  "changedMachineGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "selectionPrecision": null,
  "harmRate": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "legacyMaterialDelta": 0,
  "catastrophicDeletionCount": 0,
  "changedSupergroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "changedMachineGroupCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "zeroSelectionChangedCoverage": 0,
  "activeFoldCount": 0,
  "negativeGainFoldCount": 0,
  "unknownGainFoldCount": 0,
  "top1Accuracy": {
    "numerator": 34,
    "denominator": 75,
    "ratio": 0.4533333333333333
  },
  "folds": [
    {
      "foldId": "outer-1",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-2",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-3",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-4",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    },
    {
      "foldId": "outer-5",
      "changed": 0,
      "evaluated": 0,
      "improved": 0,
      "regressed": 0,
      "neutral": 0,
      "unknown": 0,
      "normalizedJointGain": 0
    }
  ]
}
```

## 94. Selected Safe Profile

```json
{
  "selectedSafeProfile": null,
  "safeCandidates": [],
  "rule": {
    "catastrophicDeletionCount": 0,
    "minimumPrecision": 0.85,
    "maximumHarmRate": 0.1,
    "minimumNormalizedJointGainExclusive": 0,
    "maximumMaterialDelta": 0,
    "minimumActiveFolds": 3,
    "maximumNegativeGainFolds": 0,
    "minimumEvaluableChanges": 5,
    "minimumChangedCoverage": 0.8
  },
  "order": [
    "HARM_ASC",
    "PRECISION_DESC",
    "CATASTROPHIC_ASC",
    "GAIN_DESC",
    "MATERIAL_ASC",
    "ACTIVE_FOLDS_DESC",
    "PROFILE_ID_ASC"
  ]
}
```

## 95. Evaluated Changed Supergroups

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 96. Active Fold Count

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 97. Negative-gain Fold Count

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 98. Unknown-gain Fold Count

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 99. Precision

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 100. Harm Rate

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 101. Exact Joint Gain

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 102. Normalized Joint Gain

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 103. Material Delta

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 104. Catastrophic Deletion

```json
{
  "selectedSafeProfile": null,
  "value": null,
  "note": "No qualifying safe profile; null is not zero risk"
}
```

## 105. Completeness Coverage

```json
{
  "numerator": 138,
  "denominator": 519,
  "ratio": 0.2658959537572254
}
```

## 106. Completeness-blocked Selections

```json
{
  "count": 1870,
  "unit": "profile/event/candidate blocked occurrences",
  "zeroSelectionProfilesWithCompletenessBlockedTopProposals": [
    "L4",
    "L5",
    "L6",
    "L7",
    "L8"
  ]
}
```

## 107. Safe-candidate False Blocks

```json
{
  "count": 56,
  "rate": {
    "numerator": 56,
    "denominator": 58,
    "ratio": 0.9655172413793104
  }
}
```

## 108. Is Completeness Main Blocker?

```json
{
  "diagnostic": false,
  "coverageQualified": false,
  "noThresholdChange": true,
  "reasons": [
    "BLOCKED_CANDIDATE_COUNT_IS_PROFILE_EVENT_CANDIDATE_OCCURRENCES",
    "SAFE_FALSE_BLOCK_RATE_USES_UNIQUE_EVALUABLE_CANDIDATES",
    "COVERAGE_GATE_NOT_MET_DIAGNOSIS_CANNOT_AUTHORIZE_ROUTE"
  ]
}
```

## 109. Evaluation Coverage Gate

```json
{
  "passed": false,
  "checks": [
    {
      "name": "evaluableMachineGroupCoverage",
      "passed": false,
      "observed": "{\"numerator\":67,\"denominator\":113,\"ratio\":0.5929203539823009}",
      "expected": ">=0.80 with nonzero denominator"
    },
    {
      "name": "evaluableProductionCueCoverage",
      "passed": false,
      "observed": "{\"numerator\":83,\"denominator\":161,\"ratio\":0.515527950310559}",
      "expected": ">=0.80 with nonzero denominator"
    },
    {
      "name": "evaluableGoldCueCoverage",
      "passed": false,
      "observed": "{\"numerator\":105,\"denominator\":192,\"ratio\":0.546875}",
      "expected": ">=0.80 with nonzero denominator"
    },
    {
      "name": "candidateEventLabelCoverage",
      "passed": false,
      "observed": "{\"numerator\":75,\"denominator\":141,\"ratio\":0.5319148936170213}",
      "expected": ">=0.80 with nonzero denominator"
    },
    {
      "name": "primary-L6-changedSupergroupCoverage",
      "passed": false,
      "observed": "{\"numerator\":0,\"denominator\":0,\"ratio\":null}",
      "expected": ">=0.80; zero selection utility coverage=0"
    },
    {
      "name": "primary-L6-changedMachineGroupCoverage",
      "passed": false,
      "observed": "{\"numerator\":0,\"denominator\":0,\"ratio\":null}",
      "expected": ">=0.80; zero selection utility coverage=0"
    },
    {
      "name": "crossFoldComponentCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "goldTextUsedForGroupingCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "profileRematchingCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    }
  ]
}
```

## 110. Reranker Strong Support Gate

```json
{
  "passed": false,
  "checks": [
    {
      "name": "predeclared-safe-profile",
      "passed": false,
      "observed": "null",
      "expected": "non-null fixed safety rule winner"
    },
    {
      "name": "unknown-gain-folds",
      "passed": false,
      "observed": "null",
      "expected": "0"
    },
    {
      "name": "production-mutation",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "independent-a-b-parity",
      "passed": true,
      "observed": "true",
      "expected": "true"
    }
  ]
}
```

## 111. Route Decision

EVALUATION_COVERAGE_STILL_INSUFFICIENT

## 112. C6.1.2.2 Recommendation

HOLD

## 113. C6.1.3 Recommendation

HOLD

## 114. Production Text Mutation

0

## 115. Production Timing Mutation

0

## 116. Production Cue Mutation

0

## 117. Production ASS Parity

```json
{
  "passed": true,
  "files": [
    {
      "role": "production-0/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].ass",
      "bytes": 15311,
      "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7"
    },
    {
      "role": "production-0/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.ass",
      "bytes": 15311,
      "sha256": "a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03"
    },
    {
      "role": "production-1/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].ass",
      "bytes": 15311,
      "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7"
    },
    {
      "role": "production-1/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.ass",
      "bytes": 15311,
      "sha256": "a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03"
    }
  ],
  "scope": "Both original production directories; standard and best-effort files are preserved, not silently conflated with A/B"
}
```

## 118. Production SRT Parity

```json
{
  "passed": true,
  "files": [
    {
      "role": "production-0/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.srt",
      "bytes": 11956,
      "sha256": "4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01"
    },
    {
      "role": "production-0/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].srt",
      "bytes": 11956,
      "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd"
    },
    {
      "role": "production-1/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.srt",
      "bytes": 11956,
      "sha256": "4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01"
    },
    {
      "role": "production-1/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].srt",
      "bytes": 11956,
      "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd"
    }
  ],
  "scope": "Both original production directories; standard and best-effort files are preserved, not silently conflated with A/B"
}
```

## 119. Production VTT Parity

```json
{
  "passed": true,
  "files": [
    {
      "role": "production-0/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.vtt",
      "bytes": 19530,
      "sha256": "249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7"
    },
    {
      "role": "production-0/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].vtt",
      "bytes": 19530,
      "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a"
    },
    {
      "role": "production-1/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.vtt",
      "bytes": 19530,
      "sha256": "249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7"
    },
    {
      "role": "production-1/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].vtt",
      "bytes": 19530,
      "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a"
    }
  ],
  "scope": "Both original production directories; standard and best-effort files are preserved, not silently conflated with A/B"
}
```

## 120. A/B Parity

```json
{
  "semantic": true,
  "shadowBytes": true,
  "sourceAndGoldInputsSharedReadOnly": true,
  "clocksMayDiffer": true
}
```

## 121. Machine Runtime Gold Input

```json
{
  "machineRuntimeRawGoldInputCount": 0,
  "predictionStageRawGoldInputCount": 0
}
```

## 122. Gold Timing Inputs

192

## 123. Gold Text Inputs

192

## 124. Numeric Training Labels

```json
{
  "uniqueEligibleFrozenFeatureRows": 268,
  "outerFolds": 5,
  "modelProfiles": 9,
  "outerModels": 45
}
```

## 125. Outer Test Label Leakage

0

## 126. Dataset Hardcoding

No episode-specific transcript, Gold timestamp, candidate winner, recovered-group list, per-event threshold or profile-specific Gold matching is embedded in machine/prediction source. Baseline numeric assertions identify the user-pinned acceptance input only. Synthetic test text is explicitly synthetic.

## 127. Network

false

## 128. ASR Inference

```json
{
  "inference": 0,
  "modelLoad": 0,
  "speakerInference": 0,
  "mfaProcess": 0
}
```

## 129. CTC Inference

```json
{
  "inference": 0,
  "modelLoad": 0,
  "reusedFrozenEvidenceOnly": true
}
```

## 130. Source Read-only

```json
{
  "before": {
    "bytes": 847774958,
    "sha256": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43",
    "mtimeMs": 1784692412273.1868,
    "inode": 333451799
  },
  "after": {
    "bytes": 847774958,
    "sha256": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43",
    "mtimeMs": 1784692412273.1868,
    "inode": 333451799
  },
  "passed": true
}
```

## 131. Gold Read-only

```json
{
  "before": {
    "bytes": 17094,
    "sha256": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
    "mtimeMs": 1787570451152.2112,
    "inode": 346133940
  },
  "after": {
    "bytes": 17094,
    "sha256": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
    "mtimeMs": 1787570451152.2112,
    "inode": 346133940
  },
  "passed": true
}
```

## 132. Shareable Audit

Both aggregate-only shareable summaries passed strict schema and privacy checks: raw Gold text=0, full candidate text=0, raw audio=0, private paths=0, secrets=0. Full research outputs remain local-only.

## 133. C6.1 Regression

```json
{
  "stage": "c6-1-targeted",
  "passed": true,
  "tests": 113,
  "failed": 0,
  "skipped": 0,
  "skipReasons": [],
  "logHash": "c6421beb6676e3bb94aa0155480f15296d420acd69c35c174af0d436c5ed6755"
}
```

## 134. C6.1.1 Regression

```json
{
  "stage": "c6-1-1-targeted",
  "passed": true,
  "tests": 197,
  "failed": 0,
  "skipped": 0,
  "skipReasons": [],
  "logHash": "d63af122816fff92f6e956578546359b05899e26bdcb3008edbe252cf180b766"
}
```

## 135. C6.1.2 Regression

```json
{
  "stage": "c6-1-2-targeted",
  "passed": true,
  "tests": 69,
  "failed": 0,
  "skipped": 0,
  "skipReasons": [],
  "logHash": "d56097068e8f62ff94bbaa13175d7202ae67cb120da8b3925e8c3cca4c44ece8"
}
```

## 136. Unit Tests

```json
{
  "stage": "unit",
  "passed": true,
  "tests": 1291,
  "failed": 0,
  "skipped": 2,
  "skipReasons": [
    "C5.18 local speaker runtime runs real Community-1 inference only when explicitly enabled: existing optional real-model test disabled; no acoustic inference authorized",
    "C5.17 optional real MFA integration runs one bounded real align_one attempt and parses word/phone tiers: existing optional real-model test disabled; no acoustic inference authorized"
  ],
  "logHash": "ddb6cccdeb50ceb2e8c10b4922b6ede333093427a96890b32ab54b4d26410788"
}
```

## 137. E2E Tests

```json
{
  "stage": "e2e",
  "passed": true,
  "tests": 62,
  "failed": 0,
  "skipped": 1,
  "skipReasons": [
    "C5.17 optional real MFA integration runs one bounded real align_one attempt and parses word/phone tiers: existing optional real-model test disabled; no acoustic inference authorized"
  ],
  "logHash": "8cff03c0d73fe9130765600594d79eb70f19be5b7a35ebca823b5faf7f119447"
}
```

## 138. Targeted Tests

```json
{
  "stage": "c6-1-2-1-targeted",
  "passed": true,
  "tests": 89,
  "failed": 0,
  "skipped": 0,
  "skipReasons": [],
  "logHash": "1f598c9f200a04332486fe7331b6ef43fb5f731f5b6d7e82bd1277a823c7ac3b"
}
```

## 139. Schema Count

```json
{
  "all": 456,
  "new": 36,
  "generatedAndStrict": true
}
```

## 140. Artifact Validation

```json
{
  "artifacts": 98,
  "engineeringChecks": [
    {
      "name": "A:frozen-input-snapshot",
      "passed": true,
      "observed": "944 byte/metadata snapshots unchanged",
      "expected": "independently verified"
    },
    {
      "name": "A:timing-and-text-read-barriers",
      "passed": true,
      "observed": "machine freeze <= timing-only read <= persisted map freeze <= text scoring; DTO rejects text",
      "expected": "independently verified"
    },
    {
      "name": "A:graph-structure-determinism-and-fold-safety",
      "passed": true,
      "observed": "229 exact edges; no cross-fold group used",
      "expected": "independently verified"
    },
    {
      "name": "A:E0-exact-numeric-replay-and-E1-historical-policy",
      "passed": true,
      "observed": "all original E0 replay payloads equal; E1 exact structural replay",
      "expected": "independently verified"
    },
    {
      "name": "A:same-feature-same-profile-OOF-independent-retraining",
      "passed": true,
      "observed": "45 exact models, thresholds, rankings and configurations; no Gold path in trainer",
      "expected": "independently verified"
    },
    {
      "name": "A:joint-metrics-unknowns-folds-and-shadow-reconstruction",
      "passed": true,
      "observed": "18 profile results; original whole-candidate assembly; exact ASS/SRT/VTT bytes; no timing/cue edits",
      "expected": "independently verified"
    },
    {
      "name": "A:E0-E1-E2-mode-counts-and-error-unit-sensitivity",
      "passed": true,
      "observed": "isolated vertices are no-mapping; 27 profile-mode comparisons and catastrophic trace independently rebuilt",
      "expected": "independently verified"
    },
    {
      "name": "A:coverage-recovery-completeness-and-live-read-only",
      "passed": true,
      "observed": "all denominators rebuilt; source and Gold byte/mtime equality; production original files unchanged",
      "expected": "independently verified"
    },
    {
      "name": "A:strict-Zod-JSON-Schema-and-semantic-hash-validation",
      "passed": true,
      "observed": "47",
      "expected": "independently verified"
    },
    {
      "name": "A:original-C612-strict-artifact-regression",
      "passed": true,
      "observed": "138",
      "expected": "independently verified"
    },
    {
      "name": "B:frozen-input-snapshot",
      "passed": true,
      "observed": "944 byte/metadata snapshots unchanged",
      "expected": "independently verified"
    },
    {
      "name": "B:timing-and-text-read-barriers",
      "passed": true,
      "observed": "machine freeze <= timing-only read <= persisted map freeze <= text scoring; DTO rejects text",
      "expected": "independently verified"
    },
    {
      "name": "B:graph-structure-determinism-and-fold-safety",
      "passed": true,
      "observed": "229 exact edges; no cross-fold group used",
      "expected": "independently verified"
    },
    {
      "name": "B:E0-exact-numeric-replay-and-E1-historical-policy",
      "passed": true,
      "observed": "all original E0 replay payloads equal; E1 exact structural replay",
      "expected": "independently verified"
    },
    {
      "name": "B:same-feature-same-profile-OOF-independent-retraining",
      "passed": true,
      "observed": "45 exact models, thresholds, rankings and configurations; no Gold path in trainer",
      "expected": "independently verified"
    },
    {
      "name": "B:joint-metrics-unknowns-folds-and-shadow-reconstruction",
      "passed": true,
      "observed": "18 profile results; original whole-candidate assembly; exact ASS/SRT/VTT bytes; no timing/cue edits",
      "expected": "independently verified"
    },
    {
      "name": "B:E0-E1-E2-mode-counts-and-error-unit-sensitivity",
      "passed": true,
      "observed": "isolated vertices are no-mapping; 27 profile-mode comparisons and catastrophic trace independently rebuilt",
      "expected": "independently verified"
    },
    {
      "name": "B:coverage-recovery-completeness-and-live-read-only",
      "passed": true,
      "observed": "all denominators rebuilt; source and Gold byte/mtime equality; production original files unchanged",
      "expected": "independently verified"
    },
    {
      "name": "B:strict-Zod-JSON-Schema-and-semantic-hash-validation",
      "passed": true,
      "observed": "47",
      "expected": "independently verified"
    },
    {
      "name": "B:original-C612-strict-artifact-regression",
      "passed": true,
      "observed": "138",
      "expected": "independently verified"
    },
    {
      "name": "independent-A-B-semantic-and-byte-parity",
      "passed": true,
      "observed": "74 file pairs; 36 exact shadow byte pairs",
      "expected": "same semantics except run clocks"
    },
    {
      "name": "full-QA-and-source-freeze",
      "passed": true,
      "observed": "14 stages passed; source 52e9444b588d7769e449d2722cb37baa986ffd87f7448dfcf43ccc8e2d164e64",
      "expected": "full regression without real acoustic opt-ins"
    },
    {
      "name": "strict-schema-generation-and-Skill2-3-isolation",
      "passed": true,
      "observed": "456 generated schemas; no Skill2/3 diff",
      "expected": "strict and unchanged"
    },
    {
      "name": "route-and-aggregate-only-shareable-audit",
      "passed": true,
      "observed": "identical final routes; no private paths, secrets, Gold/candidate text or audio",
      "expected": "safe aggregate summaries only"
    }
  ],
  "passed": true
}
```

## 141. Skill Validation

```json
{
  "stage": "skill",
  "passed": true,
  "tests": null,
  "failed": null,
  "skipped": null,
  "skipReasons": [],
  "logHash": "db349825903d66adffea3ecf1bd8e1803043e8a71cf1a051235dabc5371f5bb0"
}
```

## 142. Skill2/3

Unchanged: both grammar skills, their runtime packages and the learning-site app have an empty diff against the pinned baseline.

## 143. Engineering Gate

```json
{
  "passed": true,
  "qa": true,
  "artifactAcceptance": true
}
```

## 144. Remaining Risks

This remains a known-development-benchmark evaluator study, not an independent prospective quality trial. Enlarged error units can change gains; error-unit sensitivity, missing coverage and unknown folds remain explicit. No model/profile/threshold was tuned after E2 outcomes. A zero-selection L6 does not provide changed-group coverage or safe-gain evidence.

## 145. Next Route

```json
{
  "route": "EVALUATION_COVERAGE_STILL_INSUFFICIENT",
  "c6122": "HOLD",
  "c613": "HOLD",
  "productionApply": false
}
```

## 146. Commits

```json
{
  "implementationCommits": [
    {
      "role": "bipartite-graph",
      "sha": "4ab7dbd825a51d0eb8d8c1f9045015cd28ebad2c",
      "subject": "feat: add Gold timing-only bipartite evaluator supergroups"
    },
    {
      "role": "supergroup",
      "sha": "961cf68dae2c041eac180a3f7654f2afef4a1fa9",
      "subject": "feat: add constrained supergroup integrity and coverage audits"
    },
    {
      "role": "label-rebinding",
      "sha": "2a0f17d85badc2e5e22967363b08a770194a5917",
      "subject": "feat: rebind candidate and profile labels to frozen evaluator supergroups"
    },
    {
      "role": "OOF-reevaluation",
      "sha": "66007fa76e6eb830ceb093021c662ab314e24519",
      "subject": "feat: add frozen-decision and same-profile OOF re-evaluation"
    },
    {
      "role": "validation",
      "sha": "23212af350679b1103ef0cba11b6c2950b91c07f",
      "subject": "feat: add evaluator sensitivity, route gates, and deterministic validation"
    }
  ],
  "documentAcceptanceCommit": "The commit adding this report; its exact SHA is recorded in the post-push delivery receipt and final response."
}
```

## 147. Remote HEAD

The post-push delivery receipt records and checks local HEAD == upstream HEAD and 0/0 divergence. This report is generated before its own document commit; it does not invent a self-referential SHA.

## 148. Output Paths

```json
{
  "finalA": "carnation-c6-1-2-1-final-a-20260901",
  "finalB": "carnation-c6-1-2-1-final-b-20260901",
  "validation": "acceptance",
  "qa": "qa-acceptance",
  "outputPolicy": "Full outputs local research only; shareable subdirectories aggregate-only"
}
```

## 149. Worktree Status

The report is the only expected post-QA documentation change. The post-commit/post-push delivery receipt must verify a clean worktree; output files are outside the source checkout.

## Required Q1–Q20

### Q1

E0 changed the error unit from C6.1.1 temporal components to individually frozen machine groups and rejected shared Gold ownership. Exact legacy replay confirms the drop; this is evaluation coverage, not a measured ASR quality collapse.

### Q2

Affected machine groups=78, Gold cues=48, connected components=22; recovered machine groups=42.

### Q3

E2 total=79; stable one-to-one=11, one-to-many=9, many-to-one=1, many-to-many=19. Isolated Gold vertices remain explicit.

### Q4

{
"machineGroupCoverage": {
"numerator": 67,
"denominator": 113,
"ratio": 0.5929203539823009
},
"productionCueCoverage": {
"numerator": 83,
"denominator": 161,
"ratio": 0.515527950310559
},
"goldCueCoverage": {
"numerator": 105,
"denominator": 192,
"ratio": 0.546875
},
"candidateLabelCoverage": {
"numerator": 273,
"denominator": 1146,
"ratio": 0.23821989528795812
},
"topKCandidateLabelCoverage": {
"numerator": 268,
"denominator": 519,
"ratio": 0.5163776493256262
}
}

### Q5

{
"allMainCoveragePassed": false,
"requiredChecks": [
{
"name": "evaluableMachineGroupCoverage",
"passed": false,
"observed": "{\"numerator\":67,\"denominator\":113,\"ratio\":0.5929203539823009}",
"expected": ">=0.80 with nonzero denominator"
},
{
"name": "evaluableProductionCueCoverage",
"passed": false,
"observed": "{\"numerator\":83,\"denominator\":161,\"ratio\":0.515527950310559}",
"expected": ">=0.80 with nonzero denominator"
},
{
"name": "evaluableGoldCueCoverage",
"passed": false,
"observed": "{\"numerator\":105,\"denominator\":192,\"ratio\":0.546875}",
"expected": ">=0.80 with nonzero denominator"
},
{
"name": "candidateEventLabelCoverage",
"passed": false,
"observed": "{\"numerator\":75,\"denominator\":141,\"ratio\":0.5319148936170213}",
"expected": ">=0.80 with nonzero denominator"
},
{
"name": "primary-L6-changedSupergroupCoverage",
"passed": false,
"observed": "{\"numerator\":0,\"denominator\":0,\"ratio\":null}",
"expected": ">=0.80; zero selection utility coverage=0"
},
{
"name": "primary-L6-changedMachineGroupCoverage",
"passed": false,
"observed": "{\"numerator\":0,\"denominator\":0,\"ratio\":null}",
"expected": ">=0.80; zero selection utility coverage=0"
},
{
"name": "crossFoldComponentCount",
"passed": true,
"observed": "0",
"expected": "0"
},
{
"name": "goldTextUsedForGroupingCount",
"passed": true,
"observed": "0",
"expected": "0"
},
{
"name": "profileRematchingCount",
"passed": true,
"observed": "0",
"expected": "0"
}
]
}

### Q6

Cross-fold components=0; every such component is excluded from scoring/labels/training; folds were not rebuilt.

### Q7

Gold text grouping usage=0; edge construction and component formation receive timing DTOs only. The persisted map freeze precedes the first text read.

### Q8

Common=73; exact semantic agreement=73; gain-direction agreement=73; gain-direction changes=0; broader classification/exact-direction/catastrophic disagreements=0.

### Q9

{
"profileId": "L1",
"track": "FROZEN_DECISION_REEVALUATION",
"supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
"changedSupergroups": 56,
"evaluableChangedSupergroups": 39,
"changedMachineGroups": 110,
"improved": 14,
"regressed": 18,
"neutral": 7,
"unknown": 17,
"selectionPrecision": 0.4375,
"harmRate": 0.46153846153846156,
"exactJointGain": 18,
"normalizedJointGain": -9,
"materialDelta": 2,
"legacyMaterialDelta": 2,
"catastrophicDeletionCount": 6,
"changedSupergroupCoverage": {
"numerator": 39,
"denominator": 56,
"ratio": 0.6964285714285714
},
"changedMachineGroupCoverage": {
"numerator": 65,
"denominator": 110,
"ratio": 0.5909090909090909
},
"zeroSelectionChangedCoverage": 0.6964285714285714,
"activeFoldCount": 5,
"negativeGainFoldCount": 3,
"unknownGainFoldCount": 5,
"top1Accuracy": {
"numerator": 34,
"denominator": 75,
"ratio": 0.4533333333333333
},
"folds": [
{
"foldId": "outer-1",
"changed": 13,
"evaluated": 9,
"improved": 1,
"regressed": 7,
"neutral": 1,
"unknown": 4,
"normalizedJointGain": -30
},
{
"foldId": "outer-2",
"changed": 5,
"evaluated": 3,
"improved": 2,
"regressed": 1,
"neutral": 0,
"unknown": 2,
"normalizedJointGain": -3
},
{
"foldId": "outer-3",
"changed": 11,
"evaluated": 8,
"improved": 3,
"regressed": 5,
"neutral": 0,
"unknown": 3,
"normalizedJointGain": -5
},
{
"foldId": "outer-4",
"changed": 14,
"evaluated": 9,
"improved": 4,
"regressed": 2,
"neutral": 3,
"unknown": 5,
"normalizedJointGain": 9
},
{
"foldId": "outer-5",
"changed": 13,
"evaluated": 10,
"improved": 4,
"regressed": 3,
"neutral": 3,
"unknown": 3,
"normalizedJointGain": 20
}
]
}

### Q10

[
{
"machineGroupId": "c612-group:d0b0f836fb8a7d780a3ce89d",
"supergroupId": "c6121-supergroup:6c3fdd1edbd7d03b5c97cea4",
"outcome": "STILL_CATASTROPHIC",
"reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
},
{
"machineGroupId": "c612-group:867dbec6cab2942bf65b6f83",
"supergroupId": "c6121-supergroup:1531bd28f1164a31267cf755",
"outcome": "STILL_CATASTROPHIC",
"reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
},
{
"machineGroupId": "c612-group:b56920c6f718b2830ac86e94",
"supergroupId": "c6121-supergroup:ce35ac459fddb2d25aa3bbda",
"outcome": "STILL_CATASTROPHIC",
"reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
},
{
"machineGroupId": "c612-group:596b77a22b8cf1a8d7dd5e13",
"supergroupId": "c6121-supergroup:adf154d765af0e1c3c7bd0f3",
"outcome": "STILL_CATASTROPHIC",
"reason": "SAME_FROZEN_L1_SHADOW_JOINT_SUPERGROUP_REEVALUATION"
}
]

### Q11

{
"selectedSafeProfile": null,
"descriptiveHighestJointGainProfile": "L2",
"caveat": "Highest observed joint gain is descriptive only, not safety qualification. Features, folds, profiles, grid and training code are unchanged."
}

### Q12

{
"safeProfile": null,
"descriptiveHighestJointGainProfile": {
"profileId": "L2",
"track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
"supergroupMapHash": "e9b2607be6565b9fcfc5bf9e35ccd9059f87a2b91e6752924d2eebc41b2c6c68",
"changedSupergroups": 35,
"evaluableChangedSupergroups": 24,
"changedMachineGroups": 47,
"improved": 9,
"regressed": 9,
"neutral": 6,
"unknown": 11,
"selectionPrecision": 0.5,
"harmRate": 0.375,
"exactJointGain": 3,
"normalizedJointGain": -3,
"materialDelta": 1,
"legacyMaterialDelta": 1,
"catastrophicDeletionCount": 3,
"changedSupergroupCoverage": {
"numerator": 24,
"denominator": 35,
"ratio": 0.6857142857142857
},
"changedMachineGroupCoverage": {
"numerator": 32,
"denominator": 47,
"ratio": 0.6808510638297872
},
"zeroSelectionChangedCoverage": 0.6857142857142857,
"activeFoldCount": 5,
"negativeGainFoldCount": 1,
"unknownGainFoldCount": 5,
"top1Accuracy": {
"numerator": 40,
"denominator": 75,
"ratio": 0.5333333333333333
},
"folds": [
{
"foldId": "outer-1",
"changed": 13,
"evaluated": 9,
"improved": 1,
"regressed": 7,
"neutral": 1,
"unknown": 4,
"normalizedJointGain": -28
},
{
"foldId": "outer-2",
"changed": 4,
"evaluated": 2,
"improved": 2,
"regressed": 0,
"neutral": 0,
"unknown": 2,
"normalizedJointGain": 12
},
{
"foldId": "outer-3",
"changed": 8,
"evaluated": 6,
"improved": 4,
"regressed": 1,
"neutral": 1,
"unknown": 2,
"normalizedJointGain": 12
},
{
"foldId": "outer-4",
"changed": 2,
"evaluated": 1,
"improved": 1,
"regressed": 0,
"neutral": 0,
"unknown": 1,
"normalizedJointGain": 1
},
{
"foldId": "outer-5",
"changed": 8,
"evaluated": 6,
"improved": 1,
"regressed": 1,
"neutral": 4,
"unknown": 2,
"normalizedJointGain": 0
}
]
}
}

### Q13

{
"safeProfile": null,
"safeActiveFolds": null,
"descriptiveProfile": "L2",
"descriptiveActiveFolds": 5,
"qualifiesForThreeActiveFolds": false
}

### Q14

{
"safeProfile": null,
"safeNegativeFolds": null,
"safeUnknownFolds": null,
"descriptiveProfile": "L2",
"descriptiveNegativeFolds": 1,
"descriptiveUnknownFolds": 5
}

### Q15

Coverage gate=false; strong support=false; safe profile=null.

### Q16

{
"diagnosticCompletenessBlocker": false,
"coverageQualified": false,
"nonUnknown": {
"numerator": 138,
"denominator": 519,
"ratio": 0.2658959537572254
},
"positiveButUnsafeUngatedProfiles": 0
}

### Q17

C6.1.2.2=HOLD; chosen route=EVALUATION_COVERAGE_STILL_INSUFFICIENT. Coverage insufficiency has priority over completeness or automatic-reranking conclusions.

### Q18

C6.1.3=HOLD; no production application is authorized.

### Q19

ASR/CTC/speaker/MFA execution=0; production mutation=0; Gold text grouping=0; profile rematching=0; A/B=true.

### Q20

EVALUATION_COVERAGE_STILL_INSUFFICIENT
