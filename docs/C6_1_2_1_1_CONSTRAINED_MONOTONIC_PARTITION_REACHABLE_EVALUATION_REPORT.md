# C6.1.2.1.1 Constrained Monotonic Partition & Reachable Evaluation

This report is generated only from strict, independently validated offline A/B artifacts. Engineering acceptance is separate from evaluator coverage and reranker safety. Production remains `needs-review` with `finalizationMethod: none`.

## 1. Executive Conclusion

"Engineering acceptance passed. The exact D1 optimum did not meet Coverage Gate V2, so the terminal route is EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS; production remains needs-review/finalizationMethod none."

## 2. Branch

"codex/c6-1-2-1-1-monotonic-partition-reachable-evaluation"

## 3. Baseline

```json
{
  "baselineCommit": "43e3693288a73701a3ca9a5438b6aba5b2e2f43a",
  "baselineReplayPassed": true,
  "policyHash": "103658a16801bc0baad7b57686d563044815b0a2a0b3654acc07bcc3cbefd77b"
}
```

## 4. C6.1.2.1 Replay

"22 baseline replay checks passed; accepted A/B and validation inputs remained byte/mtime/inode frozen."

## 5. Goals

"Recover evaluator scope with a predeclared timing-only monotone partition, preserve global/reachable denominators, re-evaluate frozen decisions and unchanged OOF profiles, then make one terminal route decision."

## 6. Non-goals

"No new ASR/CTC/speaker/MFA inference; no new candidate, Top-K, feature, fold, profile, threshold, production subtitle, Gold cue, or Frozen Machine Group mutation."

## 7. Why E2 Coverage Remained Insufficient

"E2 kept oversized timing-connected components atomic. Fourteen bilateral components remained structurally unevaluable, suppressing machine, production, reachable-Gold, event and Top-K coverage."

## 8. Oversized Component Inventory

```json
{
  "components": 79,
  "bilateral": 54,
  "oversizedBilateral": 8,
  "attempted": 14
}
```

## 9. Structural Reason Distribution

```json
[
  {
    "reason": "CANDIDATE_LABEL_AMBIGUOUS",
    "count": 5
  },
  {
    "reason": "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "count": 7
  },
  {
    "reason": "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "count": 7
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

## 10. Machine Node Ordering

"MIN_THEN_MAX_ORIGINAL_PRODUCTION_CUE_INDEX_THEN_GROUP_ID"

## 11. Gold Node Ordering

"START_THEN_END_THEN_CUE_ID"

## 12. Monotonic Partition Design

```json
{
  "solver": "EXACT_MONOTONE_INTERVAL_DAG_ENUMERATION",
  "membership": "CONSECUTIVE_ATOMIC_MACHINE_AND_GOLD_RANGES_IN_ONE_E2_COMPONENT",
  "atomicMachine": true,
  "atomicGold": true
}
```

## 13. Candidate Block Enumeration

```json
{
  "D0": 79,
  "D1": 89,
  "D2": 92,
  "exactObjective": [
    "MAX_EVALUABLE_RETAINED_UNION_SECONDS",
    "MAX_CANDIDATE_REACHABLE_MACHINE_GROUPS",
    "MAX_PRODUCTION_CUES",
    "MAX_INTERVENTION_REACHABLE_GOLD_CUES",
    "MIN_CUT_UNION_SECONDS",
    "MIN_RESIDUAL_BILATERAL_NODES",
    "MIN_BLOCK_COUNT",
    "MIN_SEMANTIC_PATH_HASH"
  ]
}
```

## 14. Weak Bridge Definition

0.15

## 15. Strong Bridge Definition

0.5

## 16. Node Retained-overlap

```json
{
  "requiredMinimum": 0.8,
  "observedMinimum": 0.8007692307692214
}
```

## 17. Component Cut-loss

```json
{
  "allowedMaximum": 0.1,
  "observedMaximum": 0.06431793435993169
}
```

## 18. DP Objective

```json
[
  "MAX_EVALUABLE_RETAINED_UNION_SECONDS",
  "MAX_CANDIDATE_REACHABLE_MACHINE_GROUPS",
  "MAX_PRODUCTION_CUES",
  "MAX_INTERVENTION_REACHABLE_GOLD_CUES",
  "MIN_CUT_UNION_SECONDS",
  "MIN_RESIDUAL_BILATERAL_NODES",
  "MIN_BLOCK_COUNT",
  "MIN_SEMANTIC_PATH_HASH"
]
```

## 19. Full Partitions

0

## 20. Partial Partitions

6

## 21. Residual Components

```json
{
  "residualBlocks": 14,
  "reasons": [
    "CANDIDATE_LABEL_AMBIGUOUS",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "UNSPLITTABLE_GAP_LIMIT",
    "CANDIDATE_LABEL_AMBIGUOUS",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "UNSPLITTABLE_COVERAGE",
    "CANDIDATE_LABEL_AMBIGUOUS",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "UNPARTITIONABLE_LOW_COVERAGE",
    "UNSPLITTABLE_COVERAGE",
    "CANDIDATE_LABEL_AMBIGUOUS",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    "TEMPORAL_COMPONENT_CUE_LIMIT",
    "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "UNPARTITIONABLE_LOW_COVERAGE",
    "UNSPLITTABLE_COVERAGE",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "UNSPLITTABLE_COVERAGE",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "UNPARTITIONABLE_LOW_COVERAGE",
    "UNSPLITTABLE_COVERAGE",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    "TEMPORAL_COMPONENT_CUE_LIMIT",
    "CANDIDATE_LABEL_AMBIGUOUS",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "TEMPORAL_COMPONENT_CUE_LIMIT",
    "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "UNSPLITTABLE_DURATION_LIMIT",
    "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
    "UNPARTITIONABLE_LOW_COVERAGE",
    "UNSPLITTABLE_COVERAGE",
    "GOLD_CUE_CONNECTS_FROZEN_MACHINE_GROUPS",
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "TEMPORAL_COMPONENT_DURATION_LIMIT"
  ]
}
```

## 22. Unsplit Strong Bridges

0

## 23. Unsplit Low Coverage

6

## 24. Cut-edge Count

10

## 25. Cut-overlap Seconds

3.5040769230770366

## 26. Unsafe Cut Count

0

## 27. Node Conservation

```json
{
  "duplicatedMachine": 0,
  "missingMachine": 0,
  "duplicatedProduction": 0,
  "missingProduction": 0,
  "duplicatedGold": 0,
  "missingGold": 0
}
```

## 28. Edge Conservation

```json
{
  "unaccountedEdges": 0,
  "multiplyAccountedEdges": 0,
  "passed": true
}
```

## 29. D0 Result

```json
{
  "mode": "D0_NO_CUT",
  "blocks": 79,
  "evaluableBlocks": 40,
  "residualBlocks": 39,
  "statuses": {
    "ALREADY_BOUNDED": 40,
    "GOLD_ONLY_UNREACHABLE": 22,
    "MACHINE_ONLY_NO_GOLD_BINDING": 3,
    "UNSPLITTABLE_COVERAGE": 6,
    "UNSPLITTABLE_CUE_LIMIT": 1,
    "UNSPLITTABLE_DURATION_LIMIT": 3,
    "UNSPLITTABLE_GAP_LIMIT": 1,
    "UNSPLITTABLE_STRONG_BRIDGE": 3
  },
  "coverage": {
    "allMachineGroupCoverage": {
      "numerator": 67,
      "denominator": 113,
      "ratio": 0.5929203539823009
    },
    "productionCueCoverage": {
      "numerator": 83,
      "denominator": 161,
      "ratio": 0.515527950310559
    },
    "globalGoldCueCoverage": {
      "numerator": 105,
      "denominator": 192,
      "ratio": 0.546875
    },
    "interventionReachableGoldCueCoverage": {
      "numerator": 105,
      "denominator": 170,
      "ratio": 0.6176470588235294
    },
    "candidateReachableMachineGroupCoverage": {
      "numerator": 65,
      "denominator": 110,
      "ratio": 0.5909090909090909
    },
    "candidateReachableProductionCueCoverage": {
      "numerator": 81,
      "denominator": 158,
      "ratio": 0.5126582278481012
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
    "machineDurationCoverage": {
      "numerator": 300.4249165,
      "denominator": 616.2371369631184,
      "ratio": 0.48751511143993315
    },
    "globalGoldDurationCoverage": {
      "numerator": 290.5000000000001,
      "denominator": 596.8700000000014,
      "ratio": 0.48670564779600156
    },
    "reachableGoldDurationCoverage": {
      "numerator": 290.5000000000001,
      "denominator": 541.9100000000004,
      "ratio": 0.5360668745732684
    },
    "globalGoldCharacterCoverage": {
      "numerator": 1111,
      "denominator": 2048,
      "ratio": 0.54248046875
    }
  }
}
```

## 30. D1 Primary Result

```json
{
  "mode": "D1_CONSERVATIVE_MONOTONIC",
  "blocks": 89,
  "evaluableBlocks": 50,
  "residualBlocks": 39,
  "statuses": {
    "ALREADY_BOUNDED": 40,
    "GOLD_ONLY_UNREACHABLE": 22,
    "MACHINE_ONLY_NO_GOLD_BINDING": 3,
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL": 6,
    "UNSPLITTABLE_COVERAGE": 6,
    "UNSPLITTABLE_DURATION_LIMIT": 1,
    "UNSPLITTABLE_GAP_LIMIT": 1
  },
  "coverage": {
    "allMachineGroupCoverage": {
      "numerator": 80,
      "denominator": 113,
      "ratio": 0.7079646017699115
    },
    "productionCueCoverage": {
      "numerator": 101,
      "denominator": 161,
      "ratio": 0.6273291925465838
    },
    "globalGoldCueCoverage": {
      "numerator": 119,
      "denominator": 192,
      "ratio": 0.6197916666666666
    },
    "interventionReachableGoldCueCoverage": {
      "numerator": 119,
      "denominator": 170,
      "ratio": 0.7
    },
    "candidateReachableMachineGroupCoverage": {
      "numerator": 77,
      "denominator": 110,
      "ratio": 0.7
    },
    "candidateReachableProductionCueCoverage": {
      "numerator": 98,
      "denominator": 158,
      "ratio": 0.620253164556962
    },
    "candidateEventLabelCoverage": {
      "numerator": 91,
      "denominator": 141,
      "ratio": 0.6453900709219859
    },
    "candidateLabelCoverage": {
      "numerator": 331,
      "denominator": 1146,
      "ratio": 0.28883071553228623
    },
    "topKCandidateLabelCoverage": {
      "numerator": 326,
      "denominator": 519,
      "ratio": 0.628131021194605
    },
    "machineDurationCoverage": {
      "numerator": 384.0139164999995,
      "denominator": 616.2371369631184,
      "ratio": 0.6231593220630302
    },
    "globalGoldDurationCoverage": {
      "numerator": 369.3500000000005,
      "denominator": 596.8700000000014,
      "ratio": 0.6188114664834883
    },
    "reachableGoldDurationCoverage": {
      "numerator": 369.3500000000005,
      "denominator": 541.9100000000004,
      "ratio": 0.6815707405288705
    },
    "globalGoldCharacterCoverage": {
      "numerator": 1315,
      "denominator": 2048,
      "ratio": 0.64208984375
    }
  }
}
```

## 31. D2 Relaxed Diagnostic

```json
{
  "mode": "D2_RELAXED_DIAGNOSTIC_ONLY",
  "blocks": 92,
  "evaluableBlocks": 54,
  "residualBlocks": 38,
  "statuses": {
    "ALREADY_BOUNDED": 40,
    "FULLY_PARTITIONED": 1,
    "GOLD_ONLY_UNREACHABLE": 22,
    "MACHINE_ONLY_NO_GOLD_BINDING": 3,
    "PARTIALLY_PARTITIONED_WITH_RESIDUAL": 6,
    "UNSPLITTABLE_COVERAGE": 6,
    "UNSPLITTABLE_DURATION_LIMIT": 1
  },
  "coverage": {
    "allMachineGroupCoverage": {
      "numerator": 94,
      "denominator": 113,
      "ratio": 0.831858407079646
    },
    "productionCueCoverage": {
      "numerator": 115,
      "denominator": 161,
      "ratio": 0.7142857142857143
    },
    "globalGoldCueCoverage": {
      "numerator": 130,
      "denominator": 192,
      "ratio": 0.6770833333333334
    },
    "interventionReachableGoldCueCoverage": {
      "numerator": 130,
      "denominator": 170,
      "ratio": 0.7647058823529411
    },
    "candidateReachableMachineGroupCoverage": {
      "numerator": 91,
      "denominator": 110,
      "ratio": 0.8272727272727273
    },
    "candidateReachableProductionCueCoverage": {
      "numerator": 112,
      "denominator": 158,
      "ratio": 0.7088607594936709
    },
    "candidateEventLabelCoverage": {
      "numerator": 105,
      "denominator": 141,
      "ratio": 0.7446808510638298
    },
    "candidateLabelCoverage": {
      "numerator": 376,
      "denominator": 1146,
      "ratio": 0.32809773123909247
    },
    "topKCandidateLabelCoverage": {
      "numerator": 371,
      "denominator": 519,
      "ratio": 0.7148362235067437
    },
    "machineDurationCoverage": {
      "numerator": 417.25461094444415,
      "denominator": 616.2371369631184,
      "ratio": 0.677100722946882
    },
    "globalGoldDurationCoverage": {
      "numerator": 402.3400000000007,
      "denominator": 596.8700000000014,
      "ratio": 0.6740831336807006
    },
    "reachableGoldDurationCoverage": {
      "numerator": 402.3400000000007,
      "denominator": 541.9100000000004,
      "ratio": 0.7424480079718042
    },
    "globalGoldCharacterCoverage": {
      "numerator": 1436,
      "denominator": 2048,
      "ratio": 0.701171875
    }
  },
  "diagnosticOnly": true,
  "usedForRoute": false
}
```

## 32. Partition Sensitivity

```json
{
  "D0": {
    "allMachineGroupCoverage": {
      "numerator": 67,
      "denominator": 113,
      "ratio": 0.5929203539823009
    },
    "productionCueCoverage": {
      "numerator": 83,
      "denominator": 161,
      "ratio": 0.515527950310559
    },
    "globalGoldCueCoverage": {
      "numerator": 105,
      "denominator": 192,
      "ratio": 0.546875
    },
    "interventionReachableGoldCueCoverage": {
      "numerator": 105,
      "denominator": 170,
      "ratio": 0.6176470588235294
    },
    "candidateReachableMachineGroupCoverage": {
      "numerator": 65,
      "denominator": 110,
      "ratio": 0.5909090909090909
    },
    "candidateReachableProductionCueCoverage": {
      "numerator": 81,
      "denominator": 158,
      "ratio": 0.5126582278481012
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
    "machineDurationCoverage": {
      "numerator": 300.4249165,
      "denominator": 616.2371369631184,
      "ratio": 0.48751511143993315
    },
    "globalGoldDurationCoverage": {
      "numerator": 290.5000000000001,
      "denominator": 596.8700000000014,
      "ratio": 0.48670564779600156
    },
    "reachableGoldDurationCoverage": {
      "numerator": 290.5000000000001,
      "denominator": 541.9100000000004,
      "ratio": 0.5360668745732684
    },
    "globalGoldCharacterCoverage": {
      "numerator": 1111,
      "denominator": 2048,
      "ratio": 0.54248046875
    }
  },
  "D1": {
    "allMachineGroupCoverage": {
      "numerator": 80,
      "denominator": 113,
      "ratio": 0.7079646017699115
    },
    "productionCueCoverage": {
      "numerator": 101,
      "denominator": 161,
      "ratio": 0.6273291925465838
    },
    "globalGoldCueCoverage": {
      "numerator": 119,
      "denominator": 192,
      "ratio": 0.6197916666666666
    },
    "interventionReachableGoldCueCoverage": {
      "numerator": 119,
      "denominator": 170,
      "ratio": 0.7
    },
    "candidateReachableMachineGroupCoverage": {
      "numerator": 77,
      "denominator": 110,
      "ratio": 0.7
    },
    "candidateReachableProductionCueCoverage": {
      "numerator": 98,
      "denominator": 158,
      "ratio": 0.620253164556962
    },
    "candidateEventLabelCoverage": {
      "numerator": 91,
      "denominator": 141,
      "ratio": 0.6453900709219859
    },
    "candidateLabelCoverage": {
      "numerator": 331,
      "denominator": 1146,
      "ratio": 0.28883071553228623
    },
    "topKCandidateLabelCoverage": {
      "numerator": 326,
      "denominator": 519,
      "ratio": 0.628131021194605
    },
    "machineDurationCoverage": {
      "numerator": 384.0139164999995,
      "denominator": 616.2371369631184,
      "ratio": 0.6231593220630302
    },
    "globalGoldDurationCoverage": {
      "numerator": 369.3500000000005,
      "denominator": 596.8700000000014,
      "ratio": 0.6188114664834883
    },
    "reachableGoldDurationCoverage": {
      "numerator": 369.3500000000005,
      "denominator": 541.9100000000004,
      "ratio": 0.6815707405288705
    },
    "globalGoldCharacterCoverage": {
      "numerator": 1315,
      "denominator": 2048,
      "ratio": 0.64208984375
    }
  },
  "D2": {
    "allMachineGroupCoverage": {
      "numerator": 94,
      "denominator": 113,
      "ratio": 0.831858407079646
    },
    "productionCueCoverage": {
      "numerator": 115,
      "denominator": 161,
      "ratio": 0.7142857142857143
    },
    "globalGoldCueCoverage": {
      "numerator": 130,
      "denominator": 192,
      "ratio": 0.6770833333333334
    },
    "interventionReachableGoldCueCoverage": {
      "numerator": 130,
      "denominator": 170,
      "ratio": 0.7647058823529411
    },
    "candidateReachableMachineGroupCoverage": {
      "numerator": 91,
      "denominator": 110,
      "ratio": 0.8272727272727273
    },
    "candidateReachableProductionCueCoverage": {
      "numerator": 112,
      "denominator": 158,
      "ratio": 0.7088607594936709
    },
    "candidateEventLabelCoverage": {
      "numerator": 105,
      "denominator": 141,
      "ratio": 0.7446808510638298
    },
    "candidateLabelCoverage": {
      "numerator": 376,
      "denominator": 1146,
      "ratio": 0.32809773123909247
    },
    "topKCandidateLabelCoverage": {
      "numerator": 371,
      "denominator": 519,
      "ratio": 0.7148362235067437
    },
    "machineDurationCoverage": {
      "numerator": 417.25461094444415,
      "denominator": 616.2371369631184,
      "ratio": 0.677100722946882
    },
    "globalGoldDurationCoverage": {
      "numerator": 402.3400000000007,
      "denominator": 596.8700000000014,
      "ratio": 0.6740831336807006
    },
    "reachableGoldDurationCoverage": {
      "numerator": 402.3400000000007,
      "denominator": 541.9100000000004,
      "ratio": 0.7424480079718042
    },
    "globalGoldCharacterCoverage": {
      "numerator": 1436,
      "denominator": 2048,
      "ratio": 0.701171875
    }
  }
}
```

## 33. Whole-component Diagnostic

```json
{
  "evaluator": "E4_WHOLE_COMPONENT_PROFILE_SCORE_ONLY",
  "rows": 972,
  "eligibleForTraining": false,
  "eligibleForRoute": false
}
```

## 34. Partition/Whole Direction Agreement

```json
{
  "compared": 269,
  "agreement": 269,
  "disagreement": 0,
  "incomparable": 101
}
```

## 35. Global Gold Scope

```json
{
  "cues": 192,
  "definition": "ALL_GOLD_CUES_INCLUDING_GOLD_ONLY",
  "retainedInGlobalQuality": true
}
```

## 36. Reachable Gold Scope

```json
{
  "cues": 170,
  "definition": "AT_LEAST_ONE_STRICT_POSITIVE_EDGE_TO_FROZEN_MACHINE_GROUP"
}
```

## 37. Gold-only Count

22

## 38. Candidate-reachable Scope

```json
{
  "machineGroups": 110,
  "productionCues": 158,
  "events": 141
}
```

## 39. Global Gold Coverage

"119/192 (61.98%)"

## 40. Reachable Gold Coverage

"119/170 (70.00%)"

## 41. Machine Group Coverage

"80/113 (70.80%)"

## 42. Production Cue Coverage

"101/161 (62.73%)"

## 43. Candidate-reachable Machine Coverage

"77/110 (70.00%)"

## 44. Candidate Event Label Coverage

"91/141 (64.54%)"

## 45. Top-K Candidate Label Coverage

"326/519 (62.81%)"

## 46. Machine Duration Coverage

"384.0139164999995/616.2371369631184 (62.32%)"

## 47. Reachable Gold Duration Coverage

"369.3500000000005/541.9100000000004 (68.16%)"

## 48. Coverage Gate V2

```json
{
  "passed": false,
  "checks": [
    {
      "name": "allMachineGroupCoverage",
      "passed": false,
      "observed": "{\"numerator\":80,\"denominator\":113,\"ratio\":0.7079646017699115}",
      "expected": ">=0.80 with a nonzero frozen denominator"
    },
    {
      "name": "productionCueCoverage",
      "passed": false,
      "observed": "{\"numerator\":101,\"denominator\":161,\"ratio\":0.6273291925465838}",
      "expected": ">=0.80 with a nonzero frozen denominator"
    },
    {
      "name": "interventionReachableGoldCueCoverage",
      "passed": false,
      "observed": "{\"numerator\":119,\"denominator\":170,\"ratio\":0.7}",
      "expected": ">=0.80 with a nonzero frozen denominator"
    },
    {
      "name": "candidateReachableMachineGroupCoverage",
      "passed": false,
      "observed": "{\"numerator\":77,\"denominator\":110,\"ratio\":0.7}",
      "expected": ">=0.80 with a nonzero frozen denominator"
    },
    {
      "name": "candidateEventLabelCoverage",
      "passed": false,
      "observed": "{\"numerator\":91,\"denominator\":141,\"ratio\":0.6453900709219859}",
      "expected": ">=0.80 with a nonzero frozen denominator"
    },
    {
      "name": "topKCandidateLabelCoverage",
      "passed": false,
      "observed": "{\"numerator\":326,\"denominator\":519,\"ratio\":0.628131021194605}",
      "expected": ">=0.80 with a nonzero frozen denominator"
    },
    {
      "name": "crossFoldPartitionCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "duplicatedMachineGroupCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "missingMachineGroupCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "duplicatedProductionCueCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "missingProductionCueCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "duplicatedGoldCueCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "missingGoldCueCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "unaccountedEdgeCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "multiplyAccountedEdgeCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "unsafeCutCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "strongBridgeCutCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "nonMonotonicPartitionCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "retainedOverlapViolationCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "cutLossViolationCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "goldTextUsedForPartitionCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "profileRematchingCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "partitionConservationPassed",
      "passed": true,
      "observed": "true",
      "expected": "true"
    }
  ],
  "profileSelectionUsed": false,
  "globalGoldCoverageUsed": false
}
```

## 49. Why L6 Zero-selection Was Removed

"Evaluator coverage is structural and profile-independent. L6 zero-selection has null precision/harm and cannot lower or satisfy the coverage gate; it remains in profile diagnostics only."

## 50. Profile Evidence Coverage

```json
[
  {
    "profileId": "L0",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 126,
    "changedBlockCoverage": {
      "numerator": 48,
      "denominator": 65,
      "ratio": 0.7384615384615385
    },
    "changedMachineGroupCoverage": {
      "numerator": 77,
      "denominator": 110,
      "ratio": 0.7
    },
    "selectionPrecision": 0.3888888888888889,
    "harmRate": 0.4583333333333333,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L1",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 126,
    "changedBlockCoverage": {
      "numerator": 48,
      "denominator": 65,
      "ratio": 0.7384615384615385
    },
    "changedMachineGroupCoverage": {
      "numerator": 77,
      "denominator": 110,
      "ratio": 0.7
    },
    "selectionPrecision": 0.4864864864864865,
    "harmRate": 0.3958333333333333,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L2",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 96,
    "changedBlockCoverage": {
      "numerator": 38,
      "denominator": 53,
      "ratio": 0.7169811320754716
    },
    "changedMachineGroupCoverage": {
      "numerator": 61,
      "denominator": 83,
      "ratio": 0.7349397590361446
    },
    "selectionPrecision": 0.5217391304347826,
    "harmRate": 0.2894736842105263,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L3",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 98,
    "changedBlockCoverage": {
      "numerator": 38,
      "denominator": 53,
      "ratio": 0.7169811320754716
    },
    "changedMachineGroupCoverage": {
      "numerator": 63,
      "denominator": 84,
      "ratio": 0.75
    },
    "selectionPrecision": 0.5217391304347826,
    "harmRate": 0.2894736842105263,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L4",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L5",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L6",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L7",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L8",
    "track": "FROZEN_DECISION_REEVALUATION",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L0",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 126,
    "changedBlockCoverage": {
      "numerator": 48,
      "denominator": 65,
      "ratio": 0.7384615384615385
    },
    "changedMachineGroupCoverage": {
      "numerator": 77,
      "denominator": 110,
      "ratio": 0.7
    },
    "selectionPrecision": 0.3888888888888889,
    "harmRate": 0.4583333333333333,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L1",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 126,
    "changedBlockCoverage": {
      "numerator": 48,
      "denominator": 65,
      "ratio": 0.7384615384615385
    },
    "changedMachineGroupCoverage": {
      "numerator": 77,
      "denominator": 110,
      "ratio": 0.7
    },
    "selectionPrecision": 0.4864864864864865,
    "harmRate": 0.3958333333333333,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L2",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 68,
    "changedBlockCoverage": {
      "numerator": 35,
      "denominator": 44,
      "ratio": 0.7954545454545454
    },
    "changedMachineGroupCoverage": {
      "numerator": 50,
      "denominator": 61,
      "ratio": 0.819672131147541
    },
    "selectionPrecision": 0.5833333333333334,
    "harmRate": 0.2857142857142857,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L3",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 49,
    "changedBlockCoverage": {
      "numerator": 23,
      "denominator": 31,
      "ratio": 0.7419354838709677
    },
    "changedMachineGroupCoverage": {
      "numerator": 35,
      "denominator": 44,
      "ratio": 0.7954545454545454
    },
    "selectionPrecision": 0.3684210526315789,
    "harmRate": 0.5217391304347826,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L4",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L5",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L6",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L7",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  },
  {
    "profileId": "L8",
    "track": "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    "selectedCount": 0,
    "changedBlockCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "changedMachineGroupCoverage": {
      "numerator": 0,
      "denominator": 0,
      "ratio": null
    },
    "selectionPrecision": null,
    "harmRate": null,
    "passed": false,
    "safeProfileEligible": false
  }
]
```

## 51. Candidate Label Rebinding

```json
{
  "labels": 1146,
  "scoringAdapterHash": "bd843edbfa75f155f02cb3c4b4402c115d58cf18436d986d8f7fcc4153836b7c",
  "rawGoldTextIncluded": false,
  "runtimeLeakage": false
}
```

## 52. Newly Evaluable Candidate Labels

58

## 53. Lost Candidate Labels

0

## 54. Label Agreement

```json
{
  "common": 273,
  "exact": 273,
  "normalizedDirection": 273,
  "exactDirection": 273
}
```

## 55. Gain-direction Disagreement

```json
{
  "disagreement": 0,
  "reasons": []
}
```

## 56. Frozen L0 Evaluation

```json
{
  "profileId": "L0",
  "selected": 126,
  "changedBlocks": 65,
  "improved": 14,
  "regressed": 22,
  "neutral": 12,
  "unknown": 17,
  "precision": 0.3888888888888889,
  "harm": 0.4583333333333333,
  "jointGain": -91,
  "materialDelta": 5,
  "catastrophic": 6,
  "activeFolds": 5,
  "negativeFolds": 5,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 48,
    "denominator": 65,
    "ratio": 0.7384615384615385
  },
  "safeProfileEligible": false
}
```

## 57. Frozen L1 Evaluation

```json
{
  "profileId": "L1",
  "selected": 126,
  "changedBlocks": 65,
  "improved": 18,
  "regressed": 19,
  "neutral": 11,
  "unknown": 17,
  "precision": 0.4864864864864865,
  "harm": 0.3958333333333333,
  "jointGain": -2,
  "materialDelta": 2,
  "catastrophic": 6,
  "activeFolds": 5,
  "negativeFolds": 2,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 48,
    "denominator": 65,
    "ratio": 0.7384615384615385
  },
  "safeProfileEligible": false
}
```

## 58. Frozen L2 Evaluation

```json
{
  "profileId": "L2",
  "selected": 96,
  "changedBlocks": 53,
  "improved": 12,
  "regressed": 11,
  "neutral": 15,
  "unknown": 15,
  "precision": 0.5217391304347826,
  "harm": 0.2894736842105263,
  "jointGain": -22,
  "materialDelta": 2,
  "catastrophic": 2,
  "activeFolds": 5,
  "negativeFolds": 3,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 38,
    "denominator": 53,
    "ratio": 0.7169811320754716
  },
  "safeProfileEligible": false
}
```

## 59. Frozen L3 Evaluation

```json
{
  "profileId": "L3",
  "selected": 98,
  "changedBlocks": 53,
  "improved": 12,
  "regressed": 11,
  "neutral": 15,
  "unknown": 15,
  "precision": 0.5217391304347826,
  "harm": 0.2894736842105263,
  "jointGain": -47,
  "materialDelta": 4,
  "catastrophic": 2,
  "activeFolds": 5,
  "negativeFolds": 2,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 38,
    "denominator": 53,
    "ratio": 0.7169811320754716
  },
  "safeProfileEligible": false
}
```

## 60. Frozen L4 Evaluation

```json
{
  "profileId": "L4",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 61. Frozen L5 Evaluation

```json
{
  "profileId": "L5",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 62. Frozen L6 Evaluation

```json
{
  "profileId": "L6",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 63. Frozen L7 Evaluation

```json
{
  "profileId": "L7",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 64. Frozen L8 Evaluation

```json
{
  "profileId": "L8",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 65. Same-feature OOF Retrain

```json
{
  "featureHash": "4910227791331e7380c9a3e558effc9aa876ef86e655f93c4e8c1715f492b235",
  "foldHash": "ee7eb733e04bff203f37bc769fac0d7e4badc854e2888d2c84538aa3ac94d29c",
  "profileDefinitionHash": "dc3ff568660d95591d3abde3e69c09971dcfabc09444a2b33c7f078b21232a48",
  "thresholdGridHash": "774671a76f008ce64d935f1b50ea0492d23085ba54cb04cde471cd5d313fe1e9",
  "numericLabels": 326,
  "outerTestLabelInputs": 0
}
```

## 66. Feature Hash Parity

"4910227791331e7380c9a3e558effc9aa876ef86e655f93c4e8c1715f492b235"

## 67. Fold Hash Parity

"ee7eb733e04bff203f37bc769fac0d7e4badc854e2888d2c84538aa3ac94d29c"

## 68. Profile Definition Parity

"dc3ff568660d95591d3abde3e69c09971dcfabc09444a2b33c7f078b21232a48"

## 69. Threshold Grid Parity

"774671a76f008ce64d935f1b50ea0492d23085ba54cb04cde471cd5d313fe1e9"

## 70. OOF L0

```json
{
  "profileId": "L0",
  "selected": 126,
  "changedBlocks": 65,
  "improved": 14,
  "regressed": 22,
  "neutral": 12,
  "unknown": 17,
  "precision": 0.3888888888888889,
  "harm": 0.4583333333333333,
  "jointGain": -91,
  "materialDelta": 5,
  "catastrophic": 6,
  "activeFolds": 5,
  "negativeFolds": 5,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 48,
    "denominator": 65,
    "ratio": 0.7384615384615385
  },
  "safeProfileEligible": false
}
```

## 71. OOF L1

```json
{
  "profileId": "L1",
  "selected": 126,
  "changedBlocks": 65,
  "improved": 18,
  "regressed": 19,
  "neutral": 11,
  "unknown": 17,
  "precision": 0.4864864864864865,
  "harm": 0.3958333333333333,
  "jointGain": -2,
  "materialDelta": 2,
  "catastrophic": 6,
  "activeFolds": 5,
  "negativeFolds": 2,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 48,
    "denominator": 65,
    "ratio": 0.7384615384615385
  },
  "safeProfileEligible": false
}
```

## 72. OOF L2

```json
{
  "profileId": "L2",
  "selected": 68,
  "changedBlocks": 44,
  "improved": 14,
  "regressed": 10,
  "neutral": 11,
  "unknown": 9,
  "precision": 0.5833333333333334,
  "harm": 0.2857142857142857,
  "jointGain": 24,
  "materialDelta": 2,
  "catastrophic": 3,
  "activeFolds": 5,
  "negativeFolds": 1,
  "unknownFolds": 5,
  "evidenceCoverage": {
    "numerator": 35,
    "denominator": 44,
    "ratio": 0.7954545454545454
  },
  "safeProfileEligible": false
}
```

## 73. OOF L3

```json
{
  "profileId": "L3",
  "selected": 49,
  "changedBlocks": 31,
  "improved": 7,
  "regressed": 12,
  "neutral": 4,
  "unknown": 8,
  "precision": 0.3684210526315789,
  "harm": 0.5217391304347826,
  "jointGain": -39,
  "materialDelta": 2,
  "catastrophic": 3,
  "activeFolds": 5,
  "negativeFolds": 2,
  "unknownFolds": 4,
  "evidenceCoverage": {
    "numerator": 23,
    "denominator": 31,
    "ratio": 0.7419354838709677
  },
  "safeProfileEligible": false
}
```

## 74. OOF L4

```json
{
  "profileId": "L4",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 75. OOF L5

```json
{
  "profileId": "L5",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 76. OOF L6

```json
{
  "profileId": "L6",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 77. OOF L7

```json
{
  "profileId": "L7",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 78. OOF L8

```json
{
  "profileId": "L8",
  "selected": 0,
  "changedBlocks": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "jointGain": 0,
  "materialDelta": 0,
  "catastrophic": 0,
  "activeFolds": 0,
  "negativeFolds": 0,
  "unknownFolds": 0,
  "evidenceCoverage": {
    "numerator": 0,
    "denominator": 0,
    "ratio": null
  },
  "safeProfileEligible": false
}
```

## 79. Descriptive Best Profile

```json
{
  "profile": "L2",
  "metrics": {
    "profileId": "L2",
    "selected": 68,
    "changedBlocks": 44,
    "improved": 14,
    "regressed": 10,
    "neutral": 11,
    "unknown": 9,
    "precision": 0.5833333333333334,
    "harm": 0.2857142857142857,
    "jointGain": 24,
    "materialDelta": 2,
    "catastrophic": 3,
    "activeFolds": 5,
    "negativeFolds": 1,
    "unknownFolds": 5,
    "evidenceCoverage": {
      "numerator": 35,
      "denominator": 44,
      "ratio": 0.7954545454545454
    },
    "safeProfileEligible": false
  },
  "descriptiveOnly": true
}
```

## 80. Selected Safe Profile

null

## 81. Selected Count

null

## 82. Improved

null

## 83. Regressed

null

## 84. Neutral

null

## 85. Unknown

null

## 86. Precision

null

## 87. Harm Rate

null

## 88. Joint Gain

null

## 89. Material Delta

null

## 90. Catastrophic Deletion

null

## 91. Active Fold Count

null

## 92. Negative-gain Fold Count

null

## 93. Unknown-gain Fold Count

null

## 94. Profile Evidence Coverage

null

## 95. Completeness Coverage

```json
{
  "numerator": 138,
  "denominator": 519,
  "ratio": 0.2658959537572254
}
```

## 96. Completeness-blocked Candidates

```json
{
  "occurrences": 1870,
  "uniqueCandidates": 374
}
```

## 97. Safe Candidate False-blocks

```json
{
  "count": 67,
  "rate": {
    "numerator": 67,
    "denominator": 69,
    "ratio": 0.9710144927536232
  }
}
```

## 98. Completeness Main Blocker

```json
{
  "diagnostic": false,
  "coverageQualified": false,
  "reasons": [
    "OCCURRENCES_AND_UNIQUE_CANDIDATES_HAVE_SEPARATE_DENOMINATORS",
    "POSITIVE_NON_GATED_GAIN_AND_NONPOSITIVE_MATERIAL_AND_CATASTROPHIC_RISK_REQUIRED",
    "EVALUATION_COVERAGE_NOT_QUALIFIED",
    "NO_POSITIVE_NON_GATED_DELETION_RISK_PROFILE"
  ]
}
```

## 99. Partition Bias Audit

```json
{
  "passed": true,
  "cutEdges": 10,
  "cutOverlapSeconds": 3.5040769230770366,
  "maxCutLoss": 0.06431793435993169,
  "wholeUsedForRoute": false
}
```

## 100. Evaluator Sensitivity

```json
{
  "rows": {
    "count": 63,
    "note": "rows retained in validated artifact"
  },
  "coverageRows": [
    {
      "evaluator": "E0",
      "machineGroupCoverage": {
        "numerator": 20,
        "denominator": 113,
        "ratio": 0.17699115044247787
      },
      "productionCueCoverage": {
        "numerator": 27,
        "denominator": 161,
        "ratio": 0.16770186335403728
      },
      "globalGoldCoverage": {
        "numerator": 33,
        "denominator": 192,
        "ratio": 0.171875
      },
      "reachableGoldCoverage": {
        "numerator": 33,
        "denominator": 170,
        "ratio": 0.19411764705882353
      },
      "candidateEventLabelCoverage": {
        "numerator": 26,
        "denominator": 141,
        "ratio": 0.18439716312056736
      },
      "topKCandidateLabelCoverage": {
        "numerator": 103,
        "denominator": 519,
        "ratio": 0.19845857418111754
      }
    },
    {
      "evaluator": "E1",
      "machineGroupCoverage": {
        "numerator": 68,
        "denominator": 113,
        "ratio": 0.6017699115044248
      },
      "productionCueCoverage": {
        "numerator": 85,
        "denominator": 161,
        "ratio": 0.5279503105590062
      },
      "globalGoldCoverage": {
        "numerator": 109,
        "denominator": 192,
        "ratio": 0.5677083333333334
      },
      "reachableGoldCoverage": {
        "numerator": 109,
        "denominator": 170,
        "ratio": 0.6411764705882353
      },
      "candidateEventLabelCoverage": {
        "numerator": 75,
        "denominator": 141,
        "ratio": 0.5319148936170213
      },
      "topKCandidateLabelCoverage": {
        "numerator": 273,
        "denominator": 519,
        "ratio": 0.5260115606936416
      }
    },
    {
      "evaluator": "E2",
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
      "globalGoldCoverage": {
        "numerator": 105,
        "denominator": 192,
        "ratio": 0.546875
      },
      "reachableGoldCoverage": {
        "numerator": 105,
        "denominator": 170,
        "ratio": 0.6176470588235294
      },
      "candidateEventLabelCoverage": {
        "numerator": 75,
        "denominator": 141,
        "ratio": 0.5319148936170213
      },
      "topKCandidateLabelCoverage": {
        "numerator": 268,
        "denominator": 519,
        "ratio": 0.5163776493256262
      }
    },
    {
      "evaluator": "E3",
      "machineGroupCoverage": {
        "numerator": 80,
        "denominator": 113,
        "ratio": 0.7079646017699115
      },
      "productionCueCoverage": {
        "numerator": 101,
        "denominator": 161,
        "ratio": 0.6273291925465838
      },
      "globalGoldCoverage": {
        "numerator": 119,
        "denominator": 192,
        "ratio": 0.6197916666666666
      },
      "reachableGoldCoverage": {
        "numerator": 119,
        "denominator": 170,
        "ratio": 0.7
      },
      "candidateEventLabelCoverage": {
        "numerator": 91,
        "denominator": 141,
        "ratio": 0.6453900709219859
      },
      "topKCandidateLabelCoverage": {
        "numerator": 326,
        "denominator": 519,
        "ratio": 0.628131021194605
      }
    },
    {
      "evaluator": "E4",
      "machineGroupCoverage": {
        "numerator": 110,
        "denominator": 113,
        "ratio": 0.9734513274336283
      },
      "productionCueCoverage": {
        "numerator": 158,
        "denominator": 161,
        "ratio": 0.9813664596273292
      },
      "globalGoldCoverage": {
        "numerator": 170,
        "denominator": 192,
        "ratio": 0.8854166666666666
      },
      "reachableGoldCoverage": {
        "numerator": 170,
        "denominator": 170,
        "ratio": 1
      },
      "candidateEventLabelCoverage": null,
      "topKCandidateLabelCoverage": null
    }
  ],
  "primary": "E3"
}
```

## 101. Engineering Gate

true

## 102. Partition Coverage Gate

false

## 103. Reranker Strong Support Gate

false

## 104. Route Decision

```json
{
  "route": "EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS",
  "reasons": [
    "EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS",
    "D1_IS_THE_ONLY_ROUTE_EVALUATOR",
    "E4_AND_D2_ARE_DIAGNOSTIC_ONLY",
    "NO_FURTHER_EVALUATOR_LOOSENING_ITERATION",
    "EXACT_D1_PARTITION_OPTIMUM_REMAINS_BELOW_REACHABLE_COVERAGE_GATE",
    "NO_PROFILE_PASSES_ALL_PREFROZEN_SAFETY_REQUIREMENTS"
  ]
}
```

## 105. C6.1.2.2 Recommendation

"HOLD"

## 106. C6.1.3 Recommendation

"HOLD"

## 107. Stop Automatic Reranking?

false

## 108. Production Text Mutation

0

## 109. Production Timing Mutation

0

## 110. Production Cue Mutation

0

## 111. Production ASS Parity

true

## 112. Production SRT Parity

true

## 113. Production VTT Parity

true

## 114. A/B Semantic Parity

true

## 115. A/B Byte Parity

true

## 116. Gold Timing Inputs

```json
{
  "count": 192,
  "parser": "ASS_PREFIX_ONLY_NO_DIALOGUE_TEXT_DECODE",
  "dialogueDecoded": false
}
```

## 117. Gold Text Inputs

```json
{
  "count": 192,
  "stage": "post-partition scoring only",
  "rawTextInReport": false
}
```

## 118. Gold Text Used for Partition

0

## 119. Outer Test Label Leakage

0

## 120. ASR Inference

0

## 121. CTC Inference

0

## 122. Model Loads

0

## 123. Network

```json
{
  "researchNetwork": false,
  "attempted": false
}
```

## 124. Dataset Hardcoding

"No dataset-specific ID/text/path appears in partition, coverage, label, OOF or route policy; real paths are CLI inputs and redacted from shareable/report data."

## 125. Source Read-only

```json
{
  "passed": true,
  "before": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43",
  "after": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43"
}
```

## 126. Gold Read-only

```json
{
  "passed": true,
  "before": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e",
  "after": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e"
}
```

## 127. Shareable Audit

```json
{
  "privacy": "AGGREGATES_AND_HASHES_ONLY",
  "goldText": false,
  "candidateText": false,
  "absolutePaths": 0,
  "secrets": 0
}
```

## 128. C6.1 Regression

```json
{
  "stage": "c6-1-targeted",
  "command": "LOCAL_PATH_REDACTED:c6-1-targeted.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/c6-1-targeted.log",
  "logSha256": "a8fa60358ce78d7d45724d7325bc09043037425258a7f66a030e62323d6be4f1",
  "elapsedSeconds": 3.285,
  "testPassed": 113,
  "testFailed": 0,
  "testSkipped": 0,
  "skipReasons": []
}
```

## 129. C6.1.1 Regression

```json
{
  "stage": "c6-1-1-targeted",
  "command": "LOCAL_PATH_REDACTED:c6-1-1-targeted.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/c6-1-1-targeted.log",
  "logSha256": "20fe8708db3e6251296f09feb2ffdf6f368c0718c7cfa7a2f492684fa214e7d4",
  "elapsedSeconds": 8.549,
  "testPassed": 197,
  "testFailed": 0,
  "testSkipped": 0,
  "skipReasons": []
}
```

## 130. C6.1.2 Regression

```json
{
  "stage": "c6-1-2-targeted",
  "command": "LOCAL_PATH_REDACTED:c6-1-2-targeted.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/c6-1-2-targeted.log",
  "logSha256": "ecafda3fb0377c22fceb8a1eec30f242f34744ce2014e3eec4201ba120cfa742",
  "elapsedSeconds": 24.493,
  "testPassed": 69,
  "testFailed": 0,
  "testSkipped": 0,
  "skipReasons": []
}
```

## 131. C6.1.2.1 Regression

```json
{
  "stage": "c6-1-2-1-targeted",
  "command": "LOCAL_PATH_REDACTED:c6-1-2-1-targeted.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/c6-1-2-1-targeted.log",
  "logSha256": "3d4314fd008d9f07afe20bb33125511855b5b19662c65e3cd9d95cff22b31274",
  "elapsedSeconds": 14.991,
  "testPassed": 89,
  "testFailed": 0,
  "testSkipped": 0,
  "skipReasons": []
}
```

## 132. Unit Tests

```json
{
  "stage": "unit",
  "command": "LOCAL_PATH_REDACTED:unit.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/unit.log",
  "logSha256": "c19770a93a83aa648a13a614e213e5a704eb9ce496989caf9c0f2114c2ca42d8",
  "elapsedSeconds": 118.133,
  "testPassed": 1450,
  "testFailed": 0,
  "testSkipped": 2,
  "skipReasons": [
    "C5.18 local speaker runtime runs real Community-1 inference only when explicitly enabled: pre-existing optional real-model test; acoustic inference prohibited",
    "C5.17 optional real MFA integration runs one bounded real align_one attempt and parses word/phone tiers: pre-existing optional real-model test; acoustic inference prohibited"
  ]
}
```

## 133. E2E Tests

```json
{
  "stage": "e2e",
  "command": "LOCAL_PATH_REDACTED:e2e.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/e2e.log",
  "logSha256": "2bd4eafbf8c1d3795ba9c037626dcc9c04eff2141836294bf5a4cdc323915a2e",
  "elapsedSeconds": 37.763,
  "testPassed": 64,
  "testFailed": 0,
  "testSkipped": 1,
  "skipReasons": [
    "C5.17 optional real MFA integration runs one bounded real align_one attempt and parses word/phone tiers: pre-existing optional real-model test; acoustic inference prohibited"
  ]
}
```

## 134. Targeted Tests

```json
{
  "stage": "c6-1-2-1-1-targeted",
  "command": "LOCAL_PATH_REDACTED:c6-1-2-1-1-targeted.tests.json",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/c6-1-2-1-1-targeted.log",
  "logSha256": "9daeb5f8e76915ff32ee4777db6cbf62ed2f5d0dc099953862d23a6ec20ba292",
  "elapsedSeconds": 17.92,
  "testPassed": 159,
  "testFailed": 0,
  "testSkipped": 0,
  "skipReasons": []
}
```

## 135. Schema Count

495

## 136. Artifact Validation

```json
{
  "checkedArtifacts": 134,
  "validationHash": "0ae68e0f6779b2f041a99bd0dbbe122592606b5989b917f162664fb2f5da624f",
  "passed": true
}
```

## 137. Skill Validation

```json
{
  "stage": "skill",
  "command": "LOCAL_PATH_REDACTED:multilingual-video-subtitler",
  "exitCode": 0,
  "passed": true,
  "logPath": "logs/skill.log",
  "logSha256": "db349825903d66adffea3ecf1bd8e1803043e8a71cf1a051235dabc5371f5bb0",
  "elapsedSeconds": 0.04,
  "testPassed": null,
  "testFailed": null,
  "testSkipped": null,
  "skipReasons": []
}
```

## 138. Skill2/3

"Skill 2 and Skill 3 unchanged; baseline diff gate passed."

## 139. Remaining Risks

"D1 is exact and safe but remains below the predeclared >=80% reachable-coverage thresholds. D2 improves coverage but is diagnostic-only and cannot authorize a route. No safe profile can be claimed under insufficient evaluation coverage."

## 140. Terminal Research Decision

"EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS"

## 141. Commits

```json
[
  {
    "role": "implementation",
    "sha": "cb678c16b9e9fe7c9beca961315de974b770187d",
    "subject": "feat: freeze C6.1.2.1.1 component inventory and partition policies"
  },
  {
    "role": "implementation",
    "sha": "a700ed98860bf486a66e64dbdc843693a33cdd84",
    "subject": "feat: add exact monotonic partition solver and cut conservation audits"
  },
  {
    "role": "implementation",
    "sha": "c25aa44b4d7bd43a9ec0f04628992ab0500bbc12",
    "subject": "feat: separate reachable evaluator coverage from profile evidence"
  },
  {
    "role": "implementation",
    "sha": "ffa2135e7ba8d4242aa8fa7a356b1bb440ced91b",
    "subject": "feat: rebind partition labels and replay unchanged OOF profiles"
  },
  {
    "role": "implementation",
    "sha": "701867f564b02b16884623b127f67b62194c15da",
    "subject": "feat: add partition bias and terminal route acceptance gates"
  },
  {
    "role": "implementation",
    "sha": "942ea290c664d33d0c868d12a83891969a5d33f1",
    "subject": "fix: harden C6.1.2.1.1 evidence freeze and reporting"
  }
]
```

## 142. Remote HEAD

"The post-push delivery receipt records exact Local HEAD == Remote HEAD and 0/0 divergence; the report does not invent its own future commit SHA."

## 143. Output Paths

```json
{
  "finalA": "carnation-c6-1-2-1-1-final-a-20260901",
  "finalB": "carnation-c6-1-2-1-1-final-b-20260901",
  "validation": "acceptance",
  "qa": "qa-final",
  "shadows": 18,
  "localResearchOnly": true
}
```

## 144. Worktree Status

"Only this report is expected after QA. The post-commit receipt must prove a clean worktree and synchronized upstream."

## Required Q1–Q20

### Q1

D1 safely partitioned 6 of the 14 previously bilateral-unevaluable components (0 fully, 6 partially).

### Q2

D1 produced 50 evaluation blocks and 14 residual blocks.

### Q3

D1 cut 10 weak edges and 0 strong edges.

### Q4

Yes. Observed minimum node retained-overlap=0.8007692307692214; maximum component cut-loss=0.06431793435993169; D1 limits are 0.8 and 0.1.

### Q5

No. Machine duplicate/missing=0/0; Gold duplicate/missing=0/0; cross-fold=0; non-monotonic=0.

### Q6

Global Gold coverage=119/192 (61.98%); intervention-reachable Gold coverage=119/170 (70.00%).

### Q7

Gold-only cues remain real global missing-speech/error mass, so excluding them would inflate overall quality. They have no structurally reachable existing candidate, so making them block the existing-candidate reranker gate would test an intervention that this reranker cannot perform.

### Q8

E3 coverage: machine=80/113 (70.80%); production=101/161 (62.73%); reachable Gold=119/170 (70.00%); candidate event=91/141 (64.54%); Top-K candidate=326/519 (62.81%).

### Q9

No. Coverage Gate V2 passed=false; allMachineGroupCoverage, productionCueCoverage, interventionReachableGoldCueCoverage, candidateReachableMachineGroupCoverage, candidateEventLabelCoverage, topKCandidateLabelCoverage remain below 80%.

### Q10

Yes. The gate is structural, profile-independent, and excludes L6 zero-selection. L6 selected=0, precision=null, safe=false; it cannot impersonate a safe profile.

### Q11

Among 273 common labels, normalized gain direction changed for 0.

### Q12

Compared partition/whole profile-components=269; direction agreement=269; disagreement=0; incomparable=101.

### Q13

Frozen L1: improved=18, regressed=19, precision=0.4864864864864865, harm=0.3958333333333333, joint gain=-2, material delta=2, catastrophic=6.

### Q14

With identical feature/fold/profile/grid, the descriptive best retrained profile is L2. It is descriptive only.

### Q15

No. selectedSafeProfile=null because all route gates, including evaluation coverage, must pass simultaneously.

### Q16

The terminal failure is evaluation coverage: coverage=false, bias=true, engineering=true. Profile safety metrics cannot override insufficient evaluator support.

### Q17

No. Completeness diagnosticMainBlocker=false, but coverageQualifiedMainBlocker=false; insufficient evaluator coverage prevents proving it as the main blocker.

### Q18

No. C6.1.2.2=HOLD; the terminal D1 result does not justify more acoustic-completeness work.

### Q19

No. C6.1.3=HOLD; rerankerStrongSupportGate=false.

### Q20

EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS
