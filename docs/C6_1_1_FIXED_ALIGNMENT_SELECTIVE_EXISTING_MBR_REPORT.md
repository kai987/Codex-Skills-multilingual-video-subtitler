# C6.1.1 Fixed-Alignment Selective Existing-Candidate MBR Acceptance Report

本报告仅读取指定A/B运行与验收产物；不打开原始Gold、源音视频，不重新训练、推理或改写机器输出。来源SHA及产物边界列于§138/151/152与附录。

关键口径：主收益=实际assembled shadow的唯一固定组联合编辑收益；precision/harm=proposal反事实案例计数。旧全片匹配时间指标仅作诊断。UNKNOWN/NOT_APPLICABLE说明缺失或不适用证据，不是通过。

## 总览

工程验收证据通过；质量路由：SELECTIVE_MBR_NOT_SUPPORTED。

报告中的 S2 仅为已记录 OOF 的描述性 Active Profile，不在报告阶段再次优化；`route.selectedProfile=null`，Strong/Promising profiles 均为空，S2 未获路由批准。Active 仅表示达到可评价选择数门槛，不表示质量成功。

C6.1.1 仅为已知开发基准的校准可行性研究，不是未见集验证。生产仍为 needs-review / finalizationMethod=none，machineOnlyReleaseAuthorized=false，C6.0.2 HOLD。

| Profile | requested/applied | correct/wrong/neutral | precision                | harm                     | fixed changed/mapped | joint norm gain | norm CER      | material | negative/unknown active folds |
| ------- | ----------------- | --------------------- | ------------------------ | ------------------------ | -------------------- | --------------- | ------------- | -------- | ----------------------------- |
| S0      | 0/0               | 0/0/0                 | UNKNOWN / NOT_APPLICABLE | UNKNOWN / NOT_APPLICABLE | 0/0                  | 0               | 0.6015625     | 77       | 0/0                           |
| S1      | 99/99             | 22/20/12              | 0.4074074074074074       | 0.37037037037037035      | 52/34                | 13              | 0.58251953125 | 78       | 0/5                           |
| S2      | 6/6               | 1/3/1                 | 0.2                      | 0.6                      | 4/3                  | -12             | 0.60400390625 | 80       | 0/1                           |
| S3      | 5/5               | 0/3/0                 | 0                        | 1                        | 5/3                  | -9              | 0.60400390625 | 78       | 0/1                           |
| S4      | 6/6               | 0/4/0                 | 0                        | 1                        | 5/3                  | -12             | 0.60546875    | 79       | 0/1                           |
| S5      | 0/0               | 0/0/0                 | UNKNOWN / NOT_APPLICABLE | UNKNOWN / NOT_APPLICABLE | 0/0                  | 0               | 0.6015625     | 77       | 0/0                           |
| S6      | 0/0               | 0/0/0                 | UNKNOWN / NOT_APPLICABLE | UNKNOWN / NOT_APPLICABLE | 0/0                  | 0               | 0.6015625     | 77       | 0/0                           |
| S7      | 0/0               | 0/0/0                 | UNKNOWN / NOT_APPLICABLE | UNKNOWN / NOT_APPLICABLE | 0/0                  | 0               | 0.6015625     | 77       | 0/0                           |

### 统计分母与验收边界补充

以下计数已从本次冻结后的机器/评价产物逐条复核；没有重读原始 Gold，没有修改 JSON 产物或选择策略。

| 统计范围                     | 分母与结果                                                                           | 解释                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 旧 P6 event 评价             | 全部 199 events 中 38 可评价；99 changed events 中仅 17 可评价，另有 94 changed cues | changed-only 为改善/回退/中性/unknown=8/6/3/82，旧 changed coverage=17/99=17.17%；38/99 是错误分母组合。 |
| S1 全部固定组                | 61 组；42 可评价，19 unknown；改善/回退/中性为 14/14/14                              | 14 个中性组包含 8 个未修改组。                                                                           |
| S1 changed-only 固定组       | 52 changed groups；改善/回退/中性/unknown 为 14/14/6/18                              | 34/52=65.38% 可评价；全图覆盖 42/61=68.85% 是另一分母。                                                  |
| S1 独立 legacy proposal 标签 | 99 个实际选择，54 可评价、45 unknown；正确/错误/中性为 22/20/12                      | 这是单 proposal 反事实，不是固定组数量；未用 H2 标签替代 S1 标签。                                       |
| H2 全部账本记录              | 199 行；改善/回退/中性/unknown 为 21/31/24/123                                       | 包含 56 个结构阻塞和 2 个无替代候选记录，合计 58 行均不可评价。                                          |
| H2 eligible alternatives     | 141 项；改善/回退/中性/unknown 为 21/31/24/65                                        | 仅此行用于说明 eligible proposal 标签分布；123 不是这 141 项的 unknown 数。                              |

旧 event 交集直接由 `carnation-c6-1-quality-evaluation-20260830/a/c6-1-consensus-quality-evaluation.json` 的 P6 `eventResults` 按 `changed && outcome !== UNEVALUABLE` 计数得到 17；该文件 SHA-256 为 `8af1bc4af3b6fccf0c31c89e257fe47e50294c95d2b612d1d34ec8e25a13af4b`，与本次 baseline 的 `officialArtifactHashes.quality` 完全一致。旧 38 个总体可评价 events 中，其余 21 个是未修改的中性 events。旧 changed event coverage 17/99 与新 changed fixed-group coverage 34/52 的统计单位不同，不能把数值差当作同单位的覆盖率改善幅度。

主收益只取 assembled shadow 的唯一固定组联合结果：S1 normalized gain=+13，而单 proposal 反事实收益之和为 +27；S2 联合 gain=-12，而单 proposal 和为 -10。它们不可互换。Oracle 的 proposal +62 / best-existing +134 仅覆盖相同的 38/61 个 exact 固定组，另 23 组 unknown，`entireFixedMapExact=false`，不是全片可实现上限。

S2 选择 6 项，其中 5 可评价（正确/错误/中性=1/3/1）、1 unknown。其唯一 active fold 为 outer-1，联合收益为 null；其余 4 folds 均零选择、收益 0。因此“已知负收益 fold=0”不等于所有 fold 非负已获证明。S5–S7 零选择且 inactive，也不能作为成功证据。

风险的 0 detected 与已证实无风险不同：141 个 eligible proposals 的 edge-truncation / incomplete-speech 证据均为 UNKNOWN。CTC 方向在全部 199 行中为 27 known / 172 unknown，在 141 eligible 行中为 27 known / 114 unknown。完整 evaluation 仍是 LOCAL_ONLY；可分享边界仅为经过验收的 aggregate summary JSON，不包含原始 Gold、字幕正文或音频。

## 1. Executive Conclusion

工程验收证据通过；质量路由：SELECTIVE_MBR_NOT_SUPPORTED。

报告中的 S2 仅为已记录 OOF 的描述性 Active Profile，不在报告阶段再次优化；`route.selectedProfile=null`，Strong/Promising profiles 均为空，S2 未获路由批准。Active 仅表示达到可评价选择数门槛，不表示质量成功。

C6.1.1 仅为已知开发基准的校准可行性研究，不是未见集验证。生产仍为 needs-review / finalizationMethod=none，machineOnlyReleaseAuthorized=false，C6.0.2 HOLD。

## 2. Branch

codex/c6-1-1-fixed-alignment-selective-existing-mbr

## 3. Baseline

```json
{
  "acceptanceCommit": "2e9dbf4c909afd159e3aabc3ac876180cbd188ef",
  "baselineBranch": "codex/c6-1-multi-asr-confusion-network-mbr-investigation",
  "baselineHash": "78fb1057a5e020690ecf0089514349c0f3f8009f9f349e8501038e11dd220beb",
  "baselineMetrics": {
    "exactCer": 0.6601049868766404,
    "normalizedCer": 0.6015625,
    "coverage": 0.96484375,
    "missing": 6,
    "hallucination": 1,
    "materialErrors": 77,
    "cueCount": 161,
    "severeTiming": 53,
    "startMae": 1.6091082275459374,
    "endMae": 1.6078355157481543,
    "boundaryP95": 5.384999999999991,
    "medianIoU": 0.5824665676077242,
    "overlap": 37
  }
}
```

## 4. C6.1 Replay

```json
{
  "passed": true,
  "candidateCounts": {
    "inputCandidateCount": 1496,
    "includedCandidateCount": 832,
    "normalizedDuplicateCount": 424,
    "pronunciationEquivalentCount": 0,
    "hardRejectedCount": 2,
    "unlocalizableCandidateCount": 238,
    "unsupportedProvenanceCount": 0,
    "unaccountedCandidateCount": 0,
    "canonicalEventCount": 199,
    "multiHypothesisEventCount": 182,
    "multiProviderEventCount": 173,
    "whisperOnlyMultiHypothesisEventCount": 9,
    "singleHypothesisControlCount": 17,
    "unlocalizableEventCount": 0,
    "whisperInputCount": 1008,
    "reazonInputCount": 327,
    "currentInputCount": 161,
    "includedWhisperCount": 446,
    "includedReazonCount": 225,
    "correlationGroupCount": 551,
    "trustedPronunciationCount": 684,
    "currentControlCount": 161,
    "realAsrCandidateCount": 671
  },
  "pairwiseCount": 1518,
  "checks": [
    {
      "name": "acceptance-commit",
      "passed": true,
      "observed": "\"2e9dbf4c909afd159e3aabc3ac876180cbd188ef\"",
      "expected": "\"2e9dbf4c909afd159e3aabc3ac876180cbd188ef\""
    },
    {
      "name": "acceptance-branch",
      "passed": true,
      "observed": "\"codex/c6-1-multi-asr-confusion-network-mbr-investigation\"",
      "expected": "\"codex/c6-1-multi-asr-confusion-network-mbr-investigation\""
    },
    {
      "name": "complete-dual-machine-freeze",
      "passed": true,
      "observed": "\"4cec0a7304c0e027d7bd5c820097dac89becaa68f6c5e5b5c926456fe2ee2991\"",
      "expected": "\"4cec0a7304c0e027d7bd5c820097dac89becaa68f6c5e5b5c926456fe2ee2991\""
    },
    {
      "name": "candidate-universe-rebuilt",
      "passed": true,
      "observed": "\"2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a\"",
      "expected": "\"2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a\""
    },
    {
      "name": "reverse-input-universe-parity",
      "passed": true,
      "observed": "\"2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a\"",
      "expected": "\"2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a\""
    },
    {
      "name": "official-runtime-policy",
      "passed": true,
      "observed": "\"c6.1-consensus-investigation-v1\"",
      "expected": "\"c6.1-consensus-investigation-v1\""
    },
    {
      "name": "recomputed-inputCandidateCount",
      "passed": true,
      "observed": "1496",
      "expected": "1496"
    },
    {
      "name": "recomputed-includedCandidateCount",
      "passed": true,
      "observed": "832",
      "expected": "832"
    },
    {
      "name": "recomputed-currentControlCount",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "name": "recomputed-realAsrCandidateCount",
      "passed": true,
      "observed": "671",
      "expected": "671"
    },
    {
      "name": "recomputed-includedWhisperCount",
      "passed": true,
      "observed": "446",
      "expected": "446"
    },
    {
      "name": "recomputed-includedReazonCount",
      "passed": true,
      "observed": "225",
      "expected": "225"
    },
    {
      "name": "recomputed-normalizedDuplicateCount",
      "passed": true,
      "observed": "424",
      "expected": "424"
    },
    {
      "name": "recomputed-hardRejectedCount",
      "passed": true,
      "observed": "2",
      "expected": "2"
    },
    {
      "name": "recomputed-unaccountedCandidateCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "recomputed-canonicalEventCount",
      "passed": true,
      "observed": "199",
      "expected": "199"
    },
    {
      "name": "recomputed-multiHypothesisEventCount",
      "passed": true,
      "observed": "182",
      "expected": "182"
    },
    {
      "name": "recomputed-multiProviderEventCount",
      "passed": true,
      "observed": "173",
      "expected": "173"
    },
    {
      "name": "baseline-cue-count",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "name": "canonical-text",
      "passed": true,
      "observed": "\"2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9\"",
      "expected": "\"2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9\""
    },
    {
      "name": "canonical-timing",
      "passed": true,
      "observed": "\"e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936\"",
      "expected": "\"e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936\""
    },
    {
      "name": "pairwise-count",
      "passed": true,
      "observed": "1518",
      "expected": "1518"
    },
    {
      "name": "prior-engineering-validation",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "name": "prior-validation-checks",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "name": "legacy-evaluable-event-count",
      "passed": true,
      "observed": "38",
      "expected": "38"
    },
    {
      "name": "legacy-p6-changes",
      "passed": true,
      "observed": "99",
      "expected": "99"
    },
    {
      "name": "legacy-p6-outcomes",
      "passed": true,
      "observed": "[8,6,24]",
      "expected": "[8,6,24]"
    },
    {
      "name": "p0-quality",
      "passed": true,
      "observed": "[0.6015625,0.96484375,6,1,77,53]",
      "expected": "[0.6015625,0.96484375,6,1,77,53]"
    },
    {
      "name": "p6-quality",
      "passed": true,
      "observed": "[0.58251953125,0.96484375,6,0,78]",
      "expected": "[0.58251953125,0.96484375,6,0,78]"
    },
    {
      "name": "legacy-oracle-errors",
      "passed": true,
      "observed": "[210,107,103,90]",
      "expected": "[210,107,103,90]"
    },
    {
      "name": "source-identity",
      "passed": true,
      "observed": "\"294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43\"",
      "expected": "\"294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43\""
    },
    {
      "name": "production-file:subtitle-package.json",
      "passed": true,
      "observed": "\"b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e\"",
      "expected": "\"b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e\""
    },
    {
      "name": "production-file:subtitle-package.needs-review.json",
      "passed": true,
      "observed": "\"b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e\"",
      "expected": "\"b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e\""
    },
    {
      "name": "production-file:subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].ass",
      "passed": true,
      "observed": "\"594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7\"",
      "expected": "\"594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7\""
    },
    {
      "name": "production-file:subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.ass",
      "passed": true,
      "observed": "\"a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03\"",
      "expected": "\"a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03\""
    },
    {
      "name": "production-file:subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.srt",
      "passed": true,
      "observed": "\"4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01\"",
      "expected": "\"4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01\""
    },
    {
      "name": "production-file:subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.vtt",
      "passed": true,
      "observed": "\"249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7\"",
      "expected": "\"249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7\""
    },
    {
      "name": "production-file:subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].srt",
      "passed": true,
      "observed": "\"faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd\"",
      "expected": "\"faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd\""
    },
    {
      "name": "production-file:subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].vtt",
      "passed": true,
      "observed": "\"107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a\"",
      "expected": "\"107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a\""
    }
  ]
}
```

## 5. Product Route Preservation

主产品继续 C6.0.1.12 Review Assistance；本次只生成既有候选的研究影子，不授予自动发布权限。

## 6. Research Scope

Gold前冻结机器候选、风险、特征、fold与policy；Gold仅进入固定配对评价和训练折校准。报告不访问原始Gold。

## 7. Goals

在固定组覆盖率充足的前提下，检验少量可解释既有候选切换是否获得正联合收益、低错误率且不降低全片质量。

## 8. Non-goals

不生成Novel token/span文本，不修改生产文本/时间，不新增ASR/CTC/pyannote，不进行未见集成功或C6.0.2发布声明。

## 9. Why Novel Paths Are Disabled

```json
{
  "existingCandidateOnly": true,
  "novelApplicationAllowed": false,
  "currentIsProviderVote": false,
  "basis": "C6.1没有证明Novel路径改善，C6.1.1只校准整候选切换。"
}
```

## 10. Legacy Evaluation Coverage

```json
{
  "evaluableEvents": 38,
  "totalEvents": 199,
  "ratio": 0.19095477386934673,
  "unit": "EVENT"
}
```

## 11. Fixed Alignment Design

```json
{
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
```

## 12. Baseline Mapping Freeze

```json
{
  "fixedMapHash": "62149d7673e829687bcb7af404dc87f4b70ec0ab51269dee531d61bae603841b",
  "mappingSemanticHash": "78e7220141a1f41258000a668d3c4613f99961919a5f16e926807f0b06a891c3",
  "mappingPolicyHash": "637a48d9ab98070bb1f33184d8abbb72f036f44073ca3b0a47b5f160cc521f67",
  "baselineCueHash": "b38b1625b3fa6449c48b354767b7adb4f5f9102ac48aafb90d182522db3593b1",
  "baselineTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
}
```

## 13. Mapping Status Counts

```json
{
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
}
```

## 14. Changed Group Count

```json
[
  {
    "profile": "S0",
    "changedGroups": 0
  },
  {
    "profile": "S1",
    "changedGroups": 52
  },
  {
    "profile": "S2",
    "changedGroups": 4
  },
  {
    "profile": "S3",
    "changedGroups": 5
  },
  {
    "profile": "S4",
    "changedGroups": 5
  },
  {
    "profile": "S5",
    "changedGroups": 0
  },
  {
    "profile": "S6",
    "changedGroups": 0
  },
  {
    "profile": "S7",
    "changedGroups": 0
  }
]
```

## 15. Fixed Mapped Changed Groups

```json
[
  {
    "profile": "S0",
    "fixedMappedChangedGroups": 0
  },
  {
    "profile": "S1",
    "fixedMappedChangedGroups": 34
  },
  {
    "profile": "S2",
    "fixedMappedChangedGroups": 3
  },
  {
    "profile": "S3",
    "fixedMappedChangedGroups": 3
  },
  {
    "profile": "S4",
    "fixedMappedChangedGroups": 3
  },
  {
    "profile": "S5",
    "fixedMappedChangedGroups": 0
  },
  {
    "profile": "S6",
    "fixedMappedChangedGroups": 0
  },
  {
    "profile": "S7",
    "fixedMappedChangedGroups": 0
  }
]
```

## 16. Ambiguous Groups

```json
{
  "count": 15,
  "groups": [
    {
      "groupId": "c611-group-3cc32e5a94821d1c2f3d",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    },
    {
      "groupId": "c611-group-f8e9a6be64b7b4c83816",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    },
    {
      "groupId": "c611-group-3a631d6fbf7279e3eac4",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    },
    {
      "groupId": "c611-group-4ddd55a1a6820bca94b3",
      "reasons": [
        "TEMPORAL_COMPONENT_DURATION_LIMIT",
        "TEMPORAL_BRIDGE_GAP_LIMIT"
      ]
    },
    {
      "groupId": "c611-group-bfc02e1b11fd47840ea7",
      "reasons": [
        "TEMPORAL_COMPONENT_CUE_LIMIT",
        "TEMPORAL_COMPONENT_DURATION_LIMIT"
      ]
    },
    {
      "groupId": "c611-group-c2de891d661745cbeb09",
      "reasons": [
        "TEMPORAL_COMPONENT_DURATION_LIMIT",
        "TEMPORAL_BRIDGE_GAP_LIMIT"
      ]
    },
    {
      "groupId": "c611-group-8434d2748c5234945ef8",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    },
    {
      "groupId": "c611-group-5d49af954ef3084eaba3",
      "reasons": ["TEMPORAL_BRIDGE_GAP_LIMIT"]
    },
    {
      "groupId": "c611-group-d04fac4f96e92bc24bbb",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    },
    {
      "groupId": "c611-group-a73cb5754f8d7e891d53",
      "reasons": [
        "TEMPORAL_BRIDGE_GAP_LIMIT",
        "INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"
      ]
    },
    {
      "groupId": "c611-group-d5f06761c47601ae4d5b",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    },
    {
      "groupId": "c611-group-fe6f437fbabda8f54f07",
      "reasons": [
        "TEMPORAL_COMPONENT_DURATION_LIMIT",
        "TEMPORAL_BRIDGE_GAP_LIMIT"
      ]
    },
    {
      "groupId": "c611-group-10fcedd15a5cedab2b75",
      "reasons": [
        "TEMPORAL_COMPONENT_DURATION_LIMIT",
        "TEMPORAL_BRIDGE_GAP_LIMIT"
      ]
    },
    {
      "groupId": "c611-group-e3d7408ccfc8c1c8707a",
      "reasons": ["TEMPORAL_COMPONENT_CUE_LIMIT"]
    },
    {
      "groupId": "c611-group-ade2d1f1ce7c275faeb6",
      "reasons": ["INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE"]
    }
  ]
}
```

## 17. Unmapped Groups

```json
{
  "groups": 4,
  "unmappedGoldCueCount": 22
}
```

## 18. Structure-incompatible Groups

```json
0
```

## 19. Fixed Evaluation Coverage

```json
{
  "totalFixedGroupCoverage": 0.6885245901639344,
  "profiles": [
    {
      "profile": "S0",
      "changedGroupCoverage": null
    },
    {
      "profile": "S1",
      "changedGroupCoverage": 0.6538461538461539
    },
    {
      "profile": "S2",
      "changedGroupCoverage": 0.75
    },
    {
      "profile": "S3",
      "changedGroupCoverage": 0.6
    },
    {
      "profile": "S4",
      "changedGroupCoverage": 0.6
    },
    {
      "profile": "S5",
      "changedGroupCoverage": null
    },
    {
      "profile": "S6",
      "changedGroupCoverage": null
    },
    {
      "profile": "S7",
      "changedGroupCoverage": null
    }
  ],
  "warning": "总固定组覆盖率与Changed Group覆盖率分开报告；零changed分母为null。"
}
```

## 20. Legacy vs Fixed Evaluation

```json
{
  "oldUnit": "EVENT",
  "old": {
    "evaluable": 38,
    "changed": 99,
    "improved": 8,
    "regressed": 6,
    "neutral": 24,
    "unevaluable": 161,
    "renderedChangedCues": 94
  },
  "newUnit": "UNIQUE_FIXED_CUE_GROUP",
  "newS1": {
    "totalCueGroups": 61,
    "changedCueGroups": 52,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 34,
    "evaluableGroups": 42,
    "improvedGroups": 14,
    "regressedGroups": 14,
    "neutralGroups": 14,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": 0.6538461538461539,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 733,
    "shadowNormalizedError": 591,
    "exactGain": 34,
    "normalizedGain": 13,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.568217054263566,
    "shadowNormalizedCer": 0.506426735218509
  },
  "warning": "EVENT与CUE_GROUP的分母不同，不能把计数差直接当作新增错误数。"
}
```

## 21. Candidate Universe Replay

```json
{
  "candidateUniverseHash": "2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a",
  "counts": {
    "inputCandidateCount": 1496,
    "includedCandidateCount": 832,
    "normalizedDuplicateCount": 424,
    "pronunciationEquivalentCount": 0,
    "hardRejectedCount": 2,
    "unlocalizableCandidateCount": 238,
    "unsupportedProvenanceCount": 0,
    "unaccountedCandidateCount": 0,
    "canonicalEventCount": 199,
    "multiHypothesisEventCount": 182,
    "multiProviderEventCount": 173,
    "whisperOnlyMultiHypothesisEventCount": 9,
    "singleHypothesisControlCount": 17,
    "unlocalizableEventCount": 0,
    "whisperInputCount": 1008,
    "reazonInputCount": 327,
    "currentInputCount": 161,
    "includedWhisperCount": 446,
    "includedReazonCount": 225,
    "correlationGroupCount": 551,
    "trustedPronunciationCount": 684,
    "currentControlCount": 161,
    "realAsrCandidateCount": 671
  }
}
```

## 22. Existing-candidate Eligibility

```json
{
  "BLOCKED_STRUCTURAL": 56,
  "ELIGIBLE": 141,
  "NO_ALTERNATIVE": 2
}
```

## 23. Proposal Generation

```json
{
  "primaryVariant": "H2",
  "policyHash": "8da12fe7a09c9ed7952497c8006b14c0fb3b6ca923ea4d85616f734e53ab4c33",
  "proposalHash": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c",
  "runtimeGoldInputCount": 0,
  "generator": "每event至多一项预先冻结H2 proposal；Gold不选择替代候选。"
}
```

## 24. Proposed Alternative Count

```json
{
  "proposed": 141,
  "eligible": 141
}
```

## 25. Proposal Provider Distribution

```json
{
  "REAZON": 79,
  "WHISPER": 62
}
```

## 26. Proposal Role Distribution

```json
{
  "HISTORICAL_MACHINE_CANDIDATE": 12,
  "PRIMARY_WHISPER": 5,
  "REAZON_CORE_CONTEXT": 19,
  "REAZON_CORE_EXACT": 60,
  "WHISPER_CORE_CONTEXT": 10,
  "WHISPER_CORE_EXACT": 28,
  "WHISPER_CORE_PROJECTED": 1,
  "WHISPER_RE_ASR_CANDIDATES": 6
}
```

## 27. Legacy Candidate MBR Risk

```json
{
  "known": 832,
  "unknown": 0,
  "mean": 0.4671855540802333,
  "minimum": 0,
  "maximum": 1
}
```

## 28. Provider-balanced MBR

```json
{
  "known": 832,
  "unknown": 0,
  "mean": 0.4707382115815102,
  "minimum": 0,
  "maximum": 1
}
```

## 29. Hierarchical MBR

```json
{
  "known": 832,
  "unknown": 0,
  "mean": 0.47058930354445605,
  "minimum": 0,
  "maximum": 1
}
```

## 30. Correlation Audit

```json
{
  "schemaVersion": "1.0.0",
  "policyVersion": "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
  "runtimeGoldInputCount": 0,
  "semanticHash": "d9fbbace50f82edbc5fa5f17e893c8e486e50f9138830d62123a5d2681a4547a",
  "artifactType": "machine-c6-1-1-candidate-correlation-audit",
  "correlationGroupsHash": "21105f9c7457688746ac533cb927013bd5fb7d56af0c51b952af4baf6361a2b7",
  "legacy": {
    "totalGroups": 551,
    "singletonGroups": 433,
    "singletonRate": 0.7858439201451906,
    "groupsByProvider": {
      "WHISPER": 378,
      "REAZON": 173
    },
    "candidatesPerGroup": [
      {
        "groupId": "REAZON_CORE_FAMILY:0321452b61f8c02182cac654",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:0352f374330d2c6fed86c886",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:04d4aa7e6964363c4dd5a31b",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:05be11f5b40db5553e31c3d1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:0689363d57c0258462fca579",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:0887346e6dfc3b96e65a2b38",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:0b85222a06c3acc7704f6bf6",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:0ccd7c77a2ebe8171fd05801",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:0d079c759edd35519cf95677",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:12364968257c179e008264ef",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:1275e677fcf71f259651fafd",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:14705df93bde23949bfc2955",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:1600fbba3ba1560626dc1592",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:1befe4d1f84165bafd07a8e1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:1c7b06395ab96e3b987bdf4a",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:1d0709ae0e92a06b975c1eca",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:1fb416b844bc4af6a8865d27",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:207bdc58872b98a8409cc208",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:22751158b5820e366cdfeea1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:27056b210af2db13ea24293f",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:2c86ee079226a20c34237a08",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:2ca82d4785f75aab1c9884a4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:2e87a3b4e555ecc83b31b22e",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:306552beff3169320ecc1bfd",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:31289f7806f184940243a92f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:3218b33d7eddbc7123c29947",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:33247146d82bfcbe28ba11b9",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:35ec5310f7f6aea981b49f60",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:3675a8093a616d2dacb0580e",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:36b8de49151517b585d7679a",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:3a2fad90b57604e41560a25f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:3eaa27e005c7b7b0d40ff69e",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:43b9feeb70c1943216973efc",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:43c2d3f6b9a2691b9ceff254",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:44c484b56a127a093229587e",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:44d200a1ce8d8da7c0a5d7f1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:477e98118faa093d894c530d",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:4a460b7f9b26f607cb675c1f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:4dcc4c9bdaeb0b246cb94e4e",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:54843829989dccee618fc7a8",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:54864d2da02476f1ec32b40b",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:55016c3022bf8715d61c8a7d",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:55bce40d5cbfca85d0af9151",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5614e11acc6982890cb49a6f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:564b341bcac8e2937ce8cdb3",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5691367561b99a639a9833c2",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:588af37f972ec3b6acca273f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:595604125171c622e76fee4b",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5b0929d8eb759dcad4b9c175",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5eca23b1e6cac6f44e02e23a",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5f18499a99f33d9af18d5d31",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5f65ff53bf7b65b8cbf1d3a9",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:5f8efcb295ee4ae03c75d994",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:60da73dad3d35e1c6b326a61",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6200c91a61f8843b3f3368b4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:63d8a3ce14486a1cd81660b9",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:64d5d04f7e075cbebea921e6",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:682ee2eb21804bf07b9da5d6",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6914e377a5dabf99d42813ba",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6a2da5fd46fddd343f927d42",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6a5198997b9f5a0784fecdcf",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6c6adeadf8135f63c8dbbc79",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6cb0ad0d403c36bdcc9a7298",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6d2b77c4a22bf87f357dda60",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6e97d3e91a4d76861c239132",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6ef1dee11ca51ab86e23bc04",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:6f22b6757155910134bfc869",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:713f7dfdd03c7cad4ceb6332",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:72abb16e3c29c7f508a789ec",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7415d2f95ff6497e131e44ff",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:74223d127c59124e2571cce8",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:756b067715d6806dc88b3374",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:75a89b3327de5fcfd7c546e1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7871e8494f2b64907ff6067c",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:797a605cd930973f8b6176e2",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7aecac0244171f7ce7706fdc",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7aed25d3a1cb50125f4545ce",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7bddcb4d3589335e9a3f0333",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7cd9097dfcb92cb04af029b2",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:7f76fa5f975dd9791a778650",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:806691b80c79f6650936147c",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:81af0e67ea38052323f3a232",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:829785c11c25969a4dc7cd12",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8673173ac3da6d0e57c6c3b4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8774a2084bee30045bd589b9",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:88a0fae662fef9720ead31e2",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8ac99733c741eb5aa264617e",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8ae55469694aacd1bb6b4901",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8c827397b492caf31a92f76f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8d033444e7105b5fb7f73cd3",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8ed04658b8ae70874c9459cf",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8f0b3c910e937e5db4e0dc9d",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8f7aa4ce9b8369952b181831",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:8f7e720fa19445755fab8b45",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:91901be68e0e7a9e28206be1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:94398f7152f76da6978bf1fe",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:94d5b6a52f41f6cd747d4ba5",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:9849131c04e869d24e64eb0e",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:98b3d1ad2401590a80a20112",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:9a03d26d94f659a4e58fe68c",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:9a45f306caca36bc474a3ac2",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:9b1b74dbb524190410ebad80",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:9e528001b0d87e92b78e2038",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a1db63fcfbc1cad5a9c6ca77",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a322f805ac6122677204ddfc",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a3ed2c3961092b4ea0b0ac57",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a4863ef2e457bafd10b65f81",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a4bbeb4addcb8e9f9e63af82",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a6fed200eba60f14368d21e7",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a87f08b3ad08948d63f59451",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:a9bb6a920e60b42639674f7c",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:abd8dbf43a747144ce4c81a5",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:acc8679ec0b8b771622627a1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ae5945ce2fd44b734a3e17a4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:aee7cc6aa9fba2b88cd04609",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:afc1e8eedcbb6b99e5a587e1",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:b02debe16d88d680a5884dfd",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:b05eb600485564835d503d55",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:b0ebd8ac2496a2e38c8cb23f",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:b5c22d3e286edf6a2cb79a84",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:b6ca5e2bf74a25fda921c1c4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:b9fe3083ddba470d3bd59265",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:bb13543d45826c4b6fdcb50c",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:bcfe41b19a0aeea9f3bc2d0d",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:bd0ecc6efc8ad5a243b895b4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c1312cac54abcef86be92ebd",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c182cb1612b73f03b2d5b321",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c2558bbee1c63b7bd20906b8",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c579e6359bbd7ba7dd16aca1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c6e8d67adf314bfc939f766f",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c7117d552385decbfef9aead",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:c7a8dc4eeee8aafa7af1aedb",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ca3bdd2d6f3c24a55254aeb5",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:cd94e5f6c5aa55c9a0c5c4a3",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ce705d1bfb9211ce59ef8162",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:cebb1dcb46f49c0df4dd7415",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d177a6d4a148891ae58f51f0",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d17922d0dd81ee408eb05438",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d193531de0474d2b4aa11b44",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d391d70e00d980fd9f700e4b",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d73de0a5b00fd2d186cf80f4",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d83d06baafd09286aa63af53",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d949fbc23d7e8d4e040c3ac7",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d985a91899c0301c41fb2887",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d9aba30e15b1fb89c16120ba",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:d9f8ea359353a60d69380334",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:da7e14cacf69dc0c3db0d10c",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:dbf767d2a6769552d825bc44",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:df64dcfdf8362346bd78b30c",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e49ca35bd55cbb215c085016",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e4f05f8466a5ec61f3f27585",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e69b5d064e68b970c51d5966",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e6def1f367a4661f616b9b87",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e73629ea233dbf046fee0f12",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e7dc2e3a805fa065200d9755",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e84f310bb4f4cf110dd7bf0f",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:e8f748374050cd12a71d8151",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ea4626b0619d34abb7b272b3",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:eda7b211a0f5c364d4e3db2a",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:eebf3260027f7b1e63bc575c",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ef65868bff3ae6c03bf02912",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:f05aa5bd9b097778d0ef74fb",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:f123081974334b5a6feb438b",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:f5812a25f8328cd27cbe2f14",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:f708e7fa1a6b48ec21ee16cb",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:f78831b67b5de2d5b816403b",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:f9ef22743af2eb7bc8e328bc",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:fba93a429874a3731c39567b",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:fc28a453a5421dd10dfa402d",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:fcd67cd8aef2d8a1739b356d",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:fea8e387255fbec1d1050e2b",
        "count": 2
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ff969053ab33227312e99bd1",
        "count": 1
      },
      {
        "groupId": "REAZON_CORE_FAMILY:ffc0ec72035342afa9a7b345",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:01d5d33610c2bcce67943c94",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:035726c67656efbbe1af15f6",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:044968c3a6b35ad942fec740",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:047219b2bb6b46abfc5d1b7d",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:060f345c8433c11dba02d7ac",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:0d7ce6f056523b4ee60f026e",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:0ea0e3aebda5ee15ebaabf75",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:0ea5b831a6cba0c30be7b298",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:1064801a9fe683d5b6056dd5",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:12567e0d37e7dcf7a4534f54",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:12fe5c4969b76cb33285e340",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:13729de32ce97d92844e76c9",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:14f61b22222bf56f7e228026",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:15ef13b4c799f2df3ffcf447",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:19077ed34d9f7ad871981774",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:1b31e3fba547c5ecefa60e89",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:1df241138a6d49de12bf9abc",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:212d23374bc29449f9987e33",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:24143923bee413d7d89fb818",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:24fb031dfa02f538ce8cf2ef",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:2586abd49a8f9798cce4def7",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:2ce219aa8e41267acab96375",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:2e9d548201606a1647cd215e",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:317a9febdfd9964333e8eeb4",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:32b08a3b41c6dc83e791ef8b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:34690e6ee3d32fa4f8b6b135",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:35d9cdb9e38b13ba7ef31de0",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:36d1d80e7bfbe012e2124e00",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:374e5e40d9114e1c2b498571",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:3909733761676f73c28334c4",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:3a5267def70987921eacf312",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:3c4bfe825bc3eb199452f60b",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:3ed979f9210dd12f68ad148b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:41ee63b1e11e79f1304e5791",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:42cf399251bed6e8c5e13804",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:44ef1e22f227e628021adfbe",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:46be100712770843ee215644",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:46c69c98fd66de99649059b9",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:498a68db9e2e4b7cceb91de3",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:49aecdf5ba1bbba58624650c",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:4ac4b4f606a0a18180e04030",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:4e017cf5c58273e20f0ec126",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:56097839c3ef5a646a4aee40",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:561b46417f44eca53536bd5b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:567c3201e02f321917e2e95b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:570b89b75df61f7745a71109",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:58c43b7043e665e57a9f40d9",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:5a4d67b577a0c0dfa3fa1b27",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:5a7dbd658c0498eec565d4a1",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:5c823d44ab174b24d5ff976c",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:5c8e8038ab4e30b8af36ba64",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:63179230ec2adaabbc7d66d8",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:65209459eef92d05c8788ab6",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:65fd65d63b92497b9993145f",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:68afd383bd9aa6d6705a0d08",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:68b5cb23cb78148bbc568d21",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:6ad34597c52f66d3dc452038",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:6b9531914aee2a83787c7297",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:6cb60c211bff387968d100e2",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:6fd91f525a59bfe4941a3bf3",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:712d77197c6570e3d5e9f396",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:726e8c353085f789ef3a8390",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:73403d50f92e4b2fd0aaaab0",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:742620ac449c4a929572ed3b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:7660760e509fab67dbf1a2c4",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:767294756d028aef13f565ad",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:77bd1a630dd1a743c5ed4b2d",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:7a9fd20c82d1fd84b7bedb11",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:7b3aa7f9296a8fe9b893a02f",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:7e3f08cc61d34bfde19b8335",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:7f8e4799675030267c85807b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:80262df5d1702c7170b6e2cd",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:8035179ba25490dfbcdf105d",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:8889f688ec3fe86bbffe7b4b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:89f627efba1ba649d863f913",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:8ccef218b0d2a0be0ea68aae",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:8cec30795184b9dade5c62f8",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:8e49f209516adf18789e0804",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:8e9fefc4d5c202d0e1db964a",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:91659192608c2707dacd5e63",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:95032b89be4958a7410f99d4",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:986bb864b08ac862363b3420",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:9a80846bf744d1ffbda1cbd0",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:9b470e22bc6747983133da6b",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:9be2c80cde45736f692d01d3",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:a20ff3528cc9deef89f2bb4b",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:a24772334dbd5a09a95d115f",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:a3f0f1fe6911bf75ab82decc",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:a4d29d032af7dd808953ab30",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:a69fd58cf5f40e468e4e921a",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:b16ca3312630c64a4dd6f080",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:b425a318ab266939fd7bd543",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:ba8651038040e255527e26ea",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:bed14b000d178e2d11272fbb",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:c08cd1d585a53215c5cfaaf2",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:c2d52c8345dd7954901ca69a",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:c3892c743bdfe9ed1991453c",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:c5db4ec5077a17e70dd29f41",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:c66d4ad6fdaf06e516c4ccaa",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:caf03db74b90e3a0282bb30c",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:cb5ab4fe5cf160f356785653",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:cb6dd689462fb9846d0e2b05",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:ce9b238b6bcd2e17d80c355f",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:cf723a9442aebe8a6f03ef89",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:d11c2627ac7d9b541799afcd",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:d349d5aff40eb01635ad7ff2",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:d686a07464ca095a5c3556e1",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:d784c40febdb25ca5065bee3",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:d9f3d822c787e8f67be3205f",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:e0ae78a912a1d041cde91344",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:e82ee21213c07793105558cb",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:eafc6f87c4b9e2da2bd25a4e",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:ecf71dca0c56cf18e61ace24",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:ef57c28b7f3bd72d3ff0313c",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:f1323c75b9372c1c7cda9279",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:f23fc3a53e99c06efa3e750f",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:f4680fa2c77ece5383efc20d",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:f481df72c530a0ea92f65788",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:f7916d2c1a7d5df8d6e44b72",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:fba759bdea41741cbadc1c79",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:fbe8be047870957d981282aa",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:fbfbfcb2c18ef2d2be4dd9f2",
        "count": 2
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:fe59bb2d99340f786f61fe7b",
        "count": 1
      },
      {
        "groupId": "WHISPER_CORE_WINDOW_FAMILY:fff74dd0e45131290ae83b52",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0120cf9a36dc64741c9b51b4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0126be8b6db575bc39a7d971",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:01332abf9feb21d23afcaeb0",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:02600ae60c0585d11a9db6c4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0551464cb6672ef74a8f6c77",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:081c0a5ba78f170ca3256491",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:09ece5cc0ad39324b2fef739",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0a3ff604e7f039bf7cb6ab3d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0bc1850b7908278bcf947c3f",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0c7633e4bbd062aeb84b3c98",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0c9f3ae72988fe05aa9cb5c0",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0d13f63d32492bf6b12f5fb3",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0d36c82215ad54be144dc277",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0ecc5f12eea64f5af779849a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0ef49b5958b7c746ad21f2c7",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:0fa4e577b3ec598fdddd69b9",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:101a3243f2493469bb21d167",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:10dd837cad46bd8d87b9927d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:11170557d3fcf852127ad418",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:11a2cb2e415328e8ca877111",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:1350e744ba5603e1bef901c2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:166a4b3f8191b889bf5f860d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:17db056fdffe9c902f789b7e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:1ea09c528c3c9e1786fcc9e3",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:20a8ff454df0f128ea8b1dda",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:22ac4e5ea1307dc9e15ca44f",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:24047de5fdee28621fc89878",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:245cb73acfa5a477d167be6d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:25723064030d1f2df1593eb4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:264a86f9fd3ad0085b525422",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:27eb6e59d924f5b5270b3af0",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:2be3628c33bcf90e6a8cd63a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:2d37d54ca1a048bbe80555d4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:2e80b66d5ec8e254e5ed33bb",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:2f70773f7c5d388ec1c95f3e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:3079170eff05e3cfe5da02a5",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:315747b54126df9281d2b01c",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:31591733e7683228f5e161a6",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:31f547ef29dbb15a5d6a7972",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:332493295a07f52e43ef1e52",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:346cbdbceb993835933240ca",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:34e93d24c69b64824355e43c",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:36a1018aeeb75ab4c3da1fde",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:39e61b4cede574908f327a53",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:3af63fcaea792c700835e816",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:3b34cd1d51be28badc941a21",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:3ee5d12825250023fcbd2537",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:44a8d513797f27b4d06e0431",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:45485c3d0937d332dea2408b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4736fa098cfdd9a0a5f25f57",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4a63423ee6459d8bb5d9dc11",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4bf5f4acbc34cd02ca35f7e3",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4c093fcdb0488d738336eda7",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4c7a4ead59936d4b021d79b9",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4cc23c06097a17c5a609f520",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4d40f60e6efa4dd436746c96",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:4e24e379b9d99be0a49e51a6",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:502de914e261b5862eac658a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5144b7ba07c4844bb116f39b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:51bdc32af263cb417bf569ca",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:53e909b7afa7f3db49de9f16",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:54cf25e2404570b4accbda51",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:54e57f0cee442b05a50361ee",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:57911bf8bae9f31118968646",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5800a4c07791ba7f73c76a82",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:58d48f45b86d0b12103205b7",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:59f2e6f3dceab06876ffed04",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5a427a6c2e66cc40b6a2f866",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5b31fa27850337d335acc8ed",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5c389a21c3b76c6600d8e3e2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5d2c5b68f6ac4d20105532fe",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5db64ddaaaa36d45a37df8a4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5df9d1d56f422673c498a31e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:5ef4a49a4db322e8a56ccf64",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:60d45f80856d26ff2a247094",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:61292c36b346dc1039586c62",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:62c33b94cc0a88aa220dce10",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:636cbb746c8a98b06fb0740c",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:63a93cb7cf39f078d2938a7b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:645a1fde77b97ab4d257f9b7",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:65be9098cce3ad162762f676",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:65c813f8af2f743f1ed3e062",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:65c84300d3717618ab13ad8e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:66e44b7679028b14c3e8ba31",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:67a20718d31b630470550747",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:6938ab295847bfad31207733",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:698795d7464319bce0c9f8bc",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:6fab75e199e89bd7dadaa486",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:7080a29497969d406077508c",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:70b07f1e912feccb8aac65c0",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:7494498d97d5d5bb1a162dc4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:74e8a65636a3dc63713bb826",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:7590c9c4f7fe0685e74e5576",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:761e93ed2f44ff74e837b66f",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:76cbfcaab3ae31caa55a2d34",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:76ea1eeb27342b64a4b646f9",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:786917eed2d3f754ebe5aa40",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:799d843b07035c06e6763670",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:79e936dac069993ba194a767",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:7ca451eb3de6b9c529876177",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:7df56a8430e796458ec5eb61",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8087ef9b4bbf24da58428255",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:80e4982ec5576ef834e5be9b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:83c1fdfbd65ca1c0157bfec5",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8481ff8648911c66911facff",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:84e2c40e874e1119055428bf",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:856e7bb20851500240c69b97",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:89229cda3c5f97d6c1d34304",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:897d0cf1ca0af2fec846edf2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:89f67b1d8bdf8827bc6bf78f",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8a4c2a774f27f3fc1128a9ce",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8aa2f91006b5295460597622",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8bb49e416944a6f2019c2c05",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8dff3271887dc88a589c7b95",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8e286698435338cdc7c5c9c4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8eaeace339f82bbebeaa24fe",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:8f986e72497544af2239b56a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:945788bdb8fdaa8dfc93362e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:947f3f934120f37b5802dd23",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:948c82b5f0079dcba4d1cf15",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:97514befe481ca8d9b2cc53b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:97b39e4bf523dbea150530d1",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:981cb1ed9d2bc5d105ebc6fb",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:9932ffef84f9bdd83bd371c2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:9bab2254bae3189102ba783e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:9ebced5f8f46bdc62fe856f1",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:9f63b4772a8cf083aa47f23b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:a0e6f14d03928c68591cf478",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:a384a8867acc037517d42189",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:a7ffccd6b35d107b249f1015",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:a86c355d673edb4637b7bc55",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:a8bd66c8e8b01d66a1f158b6",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:a98915531bc55446f3041349",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:aaef4a67d01204aeafba55a5",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ac29f85d81dd739c25c25d57",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:acb79a076547cc2749ce4a22",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ad36dda65df5bb5ec465564d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ae810652088988aefa8f2464",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:af7faa7c07b5df049c52bc56",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:afeeb2455d098382a3f03382",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:b1f8d242142ca5796b53e977",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:b20adcf828b4f522b61f10ba",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:b2350d524677e2c950f8dfa2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:b3dea315ede64fe057e56de8",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:b63f8cc3b5b1ca9bca388575",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:b766676ee3c5805f0d5b186c",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ba086186390a27df25ebc3a2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ba481b49a0f36e4d5b990514",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:bb3e9c6cb3038511dcaccc97",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:bc9f8d05a00b2cc362352a7f",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:bef38bf036ecefb367f6290e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:bf7e5b8bf634b2d1b181fd92",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c0365446bd845d4acd78d8ca",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c1c99ccae49cc8a6f0779c35",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c274fb931dc3ad9ff4c9d4d9",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c2d8cd590a6ea1f7891f5e68",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c303217d403096589e84c64b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c3063dfc8924272e76adb1e1",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c3171041b44fb85aa033610c",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c3b32adfba8ff66259db6cea",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c3d427032e6082ceb1296a6a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c4b45d138704676132279735",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c79ce54bf9cd3d036e4e7754",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c9b425e41aa0552d63a741c2",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:c9d7f81ddb002524775331d5",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ca3b20c9895c6a2c3d4574b1",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ca48ca78218c1fa1918d801a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:cbf03635b32be69587738738",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:cd15c1de7ad4dd06d75c1008",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:cd5497983830ec20c986682d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:cdd506ceb8eeb9bc34ad645b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ce16e67cee6a282ac1be3dff",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:cecdf5c45653291e0c5af20d",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ced942d04ab417e8b73513e5",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:cefdd94a8b9a396579135422",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d028f5209cc2809938c1b2aa",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d114d529432434bf7d3e1778",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d2f9698dc85d20650e87430e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d573e6b2f4615b7773284f46",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d5e339d38ee3cba5fae6b256",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d7bafcdbffe52e6c16ae0fcf",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d81c27003bc656a9c6477834",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d8bfb9a125ac6c2fff875891",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d93d94bd4610a9a1e77538ba",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:d9aaab693a2dd19dc4b36962",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:da1eeed6dc5dd1ce942379b8",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:dd80807f226e353bb542544e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e0a9de5080915ab8b3b07406",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e0b28cada50c16400f1fab4e",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e0f7fb4fa5ec6443b70fadbd",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e3d4f3cb78c9c0a6b7b6a1bc",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e41c78e80704255eff935159",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e41ccc975a79d58b85c4786b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e6c17d50f77f74e69a9286d8",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e8374b8f035e4ec56ec04a99",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:e9697c01dcffcc57b3072734",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ec43d9ccca12e1e4d59010fa",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ecf2b827456058412bd13640",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ecf514f3cba6ea169e1749d0",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ee6de30dc15da09c00b388ca",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:eea691f57ce9a26eaa873824",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f12bce6dad3f9bd4d85fbb7b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f3064d425edc80fa59c15cc8",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f361dcba4ccbf7c86d8444b4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f37d4c77bf09d3de25f53912",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f4c3069d19dec1e4ae3c35b8",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f6242d86b573996e8d7b436a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f6e51f7376e0e95eb9e978ad",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:f80f93bf7cd3b9b764c778b4",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:fa16b9bbe13fb4e17e5609ac",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:fbd6102484c96c8276134ef7",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:fc0d42d7c268a0167681e21b",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:fc7145e07e7aa4bbab400f8a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:fced46a8d07c2e422d66072a",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:fe81a0c31105698e304e8973",
        "count": 1
      },
      {
        "groupId": "WHISPER_PRIMARY_FAMILY:ffc1e7d4819031e6d59e11db",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:139e40110bfeb745c5ec81d5",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:1a373ff6e19208f3083528c7",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:233042fc02ea1d035825de5f",
        "count": 2
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:2b10e26f8c4f401321fc3caf",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:2d80a4d0290340093b39fbd0",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:33ac2d3d61da946d0e1ac8ad",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:37519faaaf61f0946c338544",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:3f752188c77a4315c30a392b",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:41772d805d352abb97bfa18e",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:453059e2166d96b2b3fcc067",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:6d0df308c0da0d609d73aa30",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:6d6a1fb00ab879d1eb8fed32",
        "count": 2
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:6d976b115a1c238be59096bb",
        "count": 2
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:75838af45cadf3ef0c73dfcc",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:7735f9c1f9f77d18be92763e",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:7752648a1f2535929bcb216a",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:7c82c39e4b753eb0b25ce662",
        "count": 3
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:82e3e1e85ed4c8fb192edf5e",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:85632478bcaed5f98fb21073",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:88c5c4c6e273048a75217774",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:8a8d5e007a8fb6e7a2501b9b",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:8cf9a0f38d13ce1efc4fba64",
        "count": 3
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:8e0b9ea44095ceb93c855a07",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:901061fbbb532ed65e9a69fa",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:94468f263d471b5c079f935a",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:9ef5bb2a3a5fce5e38c7dbde",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:a3bf165be1cdc00c57f79f52",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:ab87a7f1aea00e7d43769e11",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:adcae3c9acc9bde4795be633",
        "count": 2
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:bd7b725c66660a0a72b9d4f6",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:d23ea8121c0d142138c99f7d",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:d52a66469c2c6d62258c6685",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:ea482915b748c48092b17e8f",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:eaab68cd3d98eb7ef31325fd",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:f2e59b66359fd7729c7efd89",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:f7a1dd56ba99f86c0f9a7a7a",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:f80d92c77983008b51ba2311",
        "count": 1
      },
      {
        "groupId": "WHISPER_RE_ASR_FAMILY:fdc2caec9e8215febfc761fd",
        "count": 2
      }
    ],
    "sameAudioDifferentRequestGroups": 61,
    "sameModelSameCoreSplitGroups": 0,
    "exactContextSeparatedGroups": 0,
    "duplicateTextAcrossGroups": 16,
    "divergentTextWithinGroup": 118
  },
  "legacyAllIncludedGroupCount": 712,
  "legacyAllIncludedSingletonCount": 594,
  "legacyAllIncludedSingletonRate": 0.8342696629213483,
  "hierarchical": {
    "totalGroups": 610,
    "singletonGroups": 549,
    "singletonRate": 0.9,
    "groupsByProvider": {
      "WHISPER": 387,
      "REAZON": 223
    },
    "candidatesPerGroup": [
      {
        "groupId": "core:004d898f5d2dd3dc4d17c69e30d53fc25f353319e87423ed7036e01f2cf1275e",
        "count": 1
      },
      {
        "groupId": "core:011bd38f083fa176539e27789d6df54a5f3376a53e2e3614e09cabc4ff57eb67",
        "count": 1
      },
      {
        "groupId": "core:01bcab2758e44821cfd9e4179b955cc2e144a22b787de9b6748cf8bd1c462fbc",
        "count": 1
      },
      {
        "groupId": "core:01c0fa406a55c028a96bf1b6e1ad812e04483e353d1a34610667126151af57e0",
        "count": 1
      },
      {
        "groupId": "core:02515e2724f04d16e34bed8414897221f0bd3dff9622b3791909e39102687b95",
        "count": 1
      },
      {
        "groupId": "core:025e1aaa93ab1377af4a5a19a7f4341eb4e1b2eab39979faba079380c76ba199",
        "count": 1
      },
      {
        "groupId": "core:02958790dec949c1b3c4fa308e1cc926be9aa8eff75109513b0e447fe32d3320",
        "count": 1
      },
      {
        "groupId": "core:02a05ba6ce6503c1039f2e570ee3823fcde5c5a1c919ef74ff608c44c923ffdc",
        "count": 2
      },
      {
        "groupId": "core:02e2d1cf4850162046498796b7f95862571a69c28a30843ff7ece7ea6141b2de",
        "count": 1
      },
      {
        "groupId": "core:02f573b757a3eaf2162dec0360761ed542f6a1e1dbdb49606704bc17e11bb4c3",
        "count": 1
      },
      {
        "groupId": "core:03774ae401fe99aa580d2c15a37a7e1e21579e1fe279c1a2773f98231bdb6e39",
        "count": 2
      },
      {
        "groupId": "core:0413ec47966f9516b4d70bac7e1c86576e3b7613767c3bd42fec8fffe6edf21a",
        "count": 1
      },
      {
        "groupId": "core:0440e59bdb8589843b8840780d9abee2112c6a248899d244d91f5bf0fcc1288b",
        "count": 1
      },
      {
        "groupId": "core:045e6a932dd228a532c65d02abd37aed54249b190ef13efa0c69d4f4f5965dbc",
        "count": 1
      },
      {
        "groupId": "core:055936a460bdd4c369f59b03d948d657e2322a64463e8318885b7fd6a5b8d3c3",
        "count": 1
      },
      {
        "groupId": "core:05e8078bd259d6605208a1c481dc9ed3aa8ec6b1b091c665a83338e20f26936e",
        "count": 1
      },
      {
        "groupId": "core:0621208b6df435219463095b5e1652fea581343a39b93e846fb2912228bb1059",
        "count": 1
      },
      {
        "groupId": "core:06f00909210713784560789d1ce55e168e005b38421545248f0c52a13c140394",
        "count": 1
      },
      {
        "groupId": "core:0742ef5f86e3a9d42e650ace9099b7d7b009c09f744f96e3c05f497eb19941f4",
        "count": 1
      },
      {
        "groupId": "core:0778df36e5085055dbedfe7a247fa5c3b8de7804629fa9b05b6f385f21615425",
        "count": 2
      },
      {
        "groupId": "core:07e8ce0203eb15ddda007a9b560c05595f0b6b49e4ce2996aa4c588be1aeeed0",
        "count": 1
      },
      {
        "groupId": "core:083bc4e17f59bba1513ffed48abf4f12d76fa121f659e24944809c865c4f7b3a",
        "count": 2
      },
      {
        "groupId": "core:088d5db2579400efdfd6cc0cf21d5f8e3760bd16d2b84a489f141415a0430525",
        "count": 1
      },
      {
        "groupId": "core:09427000e7b84d4122edb5c373e90c2da30a320347db7a6d62fc7e4bd0c05eaa",
        "count": 1
      },
      {
        "groupId": "core:09a1aec4faaf56e793e9656b23ba29cc8443ee1bb9841c976862493521650348",
        "count": 1
      },
      {
        "groupId": "core:0a24dbdd24302133a3fc39ae5d486f9a3f5ee42acceeaa5f068ef3834da3c8f3",
        "count": 1
      },
      {
        "groupId": "core:0aafbfe70cb878cfa88944e19a26bca7a83e94bdf824f2d2aa2f664a3910ab9a",
        "count": 1
      },
      {
        "groupId": "core:0ad616846160f07cd0f20a8e3c7e7893f125f540eab39650d18f84800aa1b08c",
        "count": 1
      },
      {
        "groupId": "core:0b3724845f338bf44d2d031f7f679d57e98c80f18ad9e13b908fb220240adcb6",
        "count": 1
      },
      {
        "groupId": "core:0bd351db650551256674b9d6a3f6a9a051c4af3d7433774f38f3de82294d8507",
        "count": 1
      },
      {
        "groupId": "core:0d5a5d6c2d52d0fc9d29adb4dd4b2f26649145537521cd8948a1a85757bbb8da",
        "count": 1
      },
      {
        "groupId": "core:0d7b0cf8679340a89966ee642adf56b9223cec98778bbac7595d9348946a745b",
        "count": 2
      },
      {
        "groupId": "core:0e15be7650fbe92ad83428a17cda1396a5de0f4de7ab385319a742dd98d806b4",
        "count": 1
      },
      {
        "groupId": "core:0e22a4a26f45ae4bc371ec6f685f8451a37227ae6b03d4529b99607e76ce0865",
        "count": 1
      },
      {
        "groupId": "core:0f4171755523b54048cf9bf79b6891971c51af84b65ee66432c1d5d1f5856f96",
        "count": 1
      },
      {
        "groupId": "core:0f95f4baa7f1bf1b15f4afe7a47bb2dbca7db49f49e0b3e91b562f0b317b2708",
        "count": 1
      },
      {
        "groupId": "core:100ebb61da8f80ca31ba1a5c5ad5dc0f0b96e10fe67f22578939ab73e5ad8664",
        "count": 1
      },
      {
        "groupId": "core:10a958944f95ef5f444cee1506d947b23b4407683288c09f8cb59db70479f1ef",
        "count": 1
      },
      {
        "groupId": "core:10c29b38e4bd546df39c7de11bdceaa88de1927de823040fe6fb852b05d67db4",
        "count": 1
      },
      {
        "groupId": "core:10cc7d73bbc9f4946d3e287f81f419a336f9a6f82c6ea65d9e0fb50fa5d85d4d",
        "count": 1
      },
      {
        "groupId": "core:117828cf93e5adbe075cb2aec18f34acbf5ae05cbbce849794c53f8902df31b8",
        "count": 1
      },
      {
        "groupId": "core:122ae0ce44361a5ceeffd69015b928aff1c95cc1353caa87358f4ecb9eba0f72",
        "count": 1
      },
      {
        "groupId": "core:12868fbb5c618a3fec11e953f9895c9ee26c777fe557437e9ed123540ed716b7",
        "count": 1
      },
      {
        "groupId": "core:1305739c48f666aaba5dc428537f1dcfaa04e4fa95f726d8b515f21b7d7630b4",
        "count": 1
      },
      {
        "groupId": "core:14c82d564a35b44adf43294926bbc1ad725cd10f8883eab756be61e7591eb761",
        "count": 1
      },
      {
        "groupId": "core:16ba7da8ebb3f26cc8a693befd1c215fd8fbeec4e8dd325417d4a2e19ebfb533",
        "count": 1
      },
      {
        "groupId": "core:16ea72fcb253a128d88064e6af2c683df16d18795ba8861d4650405cf560e3fb",
        "count": 1
      },
      {
        "groupId": "core:172397117d0f6ebcb69f8a2796483657b617ff1619f60de88b7add05e6c91c78",
        "count": 1
      },
      {
        "groupId": "core:178f678ddcd0c4ca715df7bf291fcbd6119c7b2341b22bc86a64e04bc82db339",
        "count": 1
      },
      {
        "groupId": "core:182371687c5f1a804aeff03d3348036762552bdbb43ee89a6bd53b63979aa202",
        "count": 1
      },
      {
        "groupId": "core:18312d7606a7848a578d446dfd64bf4c2709670e7796db6bfb1d41ac4b89d918",
        "count": 1
      },
      {
        "groupId": "core:18cb071258e654257645ee1a87a2a3ab956229fc08400e80ea584748853d489b",
        "count": 2
      },
      {
        "groupId": "core:19c640e5fc3255ec8e594664b56b5f7c2ddc282d3772fd37389c4ec72d64ed47",
        "count": 1
      },
      {
        "groupId": "core:1a629e55dcf10a39995d93f0d9f75986835897c561ddb6b7f9780536546563ce",
        "count": 1
      },
      {
        "groupId": "core:1acbbf78d263abf53b9f8adfb450b17d9eda5dddc564a5cd69eed574b26b4946",
        "count": 1
      },
      {
        "groupId": "core:1b78f4625508e560d3fc8dc4674e7189f3b6ab4fdde5d3554446c49fcfcc72aa",
        "count": 1
      },
      {
        "groupId": "core:1c6114bf652f842f195e5a75ae9896247e8409ca3d2bf9cc60e7be8647ce10ee",
        "count": 1
      },
      {
        "groupId": "core:1c8c7ccd2f491084575d472f6cc986f9e011c533abb27433b89decae866eda5b",
        "count": 1
      },
      {
        "groupId": "core:1dfd7c729d8a3b69a58415288291d7efdbd18905e8be8456d5763e3b3bb72118",
        "count": 1
      },
      {
        "groupId": "core:1dffa938a70a2e2648e57c70daaa793d87531c62a0b0ffa13a7cfabcfa70c451",
        "count": 1
      },
      {
        "groupId": "core:1e2e64b6870dfb80d66dc0f92423a0ae6a36735b3fdbcfb7b933074f57f83959",
        "count": 1
      },
      {
        "groupId": "core:1e3495669ca3e84c28b3638f3cf6d316298d03d3937bc910dc0da033e3b988fb",
        "count": 2
      },
      {
        "groupId": "core:1ec7ded935218f2bdcf7467a2dcc2de30f47d4d0b1c96439e78fba733a6c189e",
        "count": 1
      },
      {
        "groupId": "core:1f9303ff74a941c25f0b3c7761bbf6d14f86c0d14060eda255b1064812de5f1f",
        "count": 1
      },
      {
        "groupId": "core:1fde6222fce4d3edbbdc0eed290b749c9bdb786a7e39f1fbc428402b3cfcb236",
        "count": 1
      },
      {
        "groupId": "core:1ffb27811ed1b6ee7901936a1966f4a03cae7ec28adf9397c1ef1c6e4767b53b",
        "count": 1
      },
      {
        "groupId": "core:203e4a9820702297b1bba679a2d7d7d79ab2bd5736cbb8e78747e4dd9df3830e",
        "count": 1
      },
      {
        "groupId": "core:204a97b8927014f45a2225da41ed6ad953fd2486186bec530789fec01913057e",
        "count": 1
      },
      {
        "groupId": "core:20f806f980a590ab2e84ec090f2b463b5fc85dddee2858847ed1a65b08cbca59",
        "count": 2
      },
      {
        "groupId": "core:2172d46db4248cd2afe68e20ea9c522ef15a0d714cf5a57407635d2f14d71d56",
        "count": 1
      },
      {
        "groupId": "core:228cf1d030dc315a5f6a28ff49d68a885aaa43b86e4e3dc806f64e11a1d328dc",
        "count": 1
      },
      {
        "groupId": "core:236ce461ff263fd8f0e3aa8bc4acff487584e593883e86c76f44d09ce2d5f617",
        "count": 1
      },
      {
        "groupId": "core:23a49dbeafaafe05b8cb76d4d51dd78bf94383d372a517e9bd2d7d5f624a0c97",
        "count": 1
      },
      {
        "groupId": "core:23adeb08ef97531bad364e12da0c53a71d0b247dd1b7a72ee9da9e5bf7884915",
        "count": 2
      },
      {
        "groupId": "core:23f28402fe7e5a0e93d0ee3e0100a78ce771ec6a6b1c74e3bb70ed3735133c47",
        "count": 2
      },
      {
        "groupId": "core:2406bd2b578d0d56ea4c29e1aa04c57e8e09dbda6395395d66a5d287c3d24fd0",
        "count": 1
      },
      {
        "groupId": "core:2414bc971aef7d21cb9caf2eed39ba506a447e8c239af014afbb5ff33f858793",
        "count": 1
      },
      {
        "groupId": "core:250ad43cbc572b118716aab810da81c20cd921e93e3e20b8391d56c0e4d1571e",
        "count": 1
      },
      {
        "groupId": "core:25e7bcc0eec1e3d33a29ee2c6578f569714a662f8846599e6cc3a71c4a641c61",
        "count": 1
      },
      {
        "groupId": "core:25e8ef7502fa55506692b8a37733ae0149270fd04ecf3524eff07e560bec5341",
        "count": 1
      },
      {
        "groupId": "core:292a73a43f74f8e237a90c87c46b0b97da4bc51ccc3901107a5ef9cb7cedd764",
        "count": 1
      },
      {
        "groupId": "core:2a1354381d23245bc0b927d2410f5c0366fc7ff252b398e6cf486bccd3f9bb0f",
        "count": 1
      },
      {
        "groupId": "core:2a178e2e0026cc80dc496e0f9f870a0bc038d0fe797d44c471cb22f53de571f3",
        "count": 1
      },
      {
        "groupId": "core:2abe0205fe888349c1c7b5b3e0c65b7832cd6cec9ddab430007e191152a6e4c1",
        "count": 1
      },
      {
        "groupId": "core:2bc5238046c7e6e8ca1c30e5c9a8d6e566fd2a105adf1d5029ac6ae71ac07958",
        "count": 2
      },
      {
        "groupId": "core:2c1df03d04f118ddbe048856cc6607ba75de65323fa0474f87569cf5c755e2b7",
        "count": 1
      },
      {
        "groupId": "core:2cdfc122a9d205f8a77fc8f6c485c145c03c805ff640ead1fd24bbc3979f8a9b",
        "count": 1
      },
      {
        "groupId": "core:2cfca83605fc1fdb87683b21c3a967232af5d4c335b6b522205bddb20d1c5a9b",
        "count": 1
      },
      {
        "groupId": "core:2d08d8e6b16821efae8bf540feba5958fdfe1ff475620af7d93b781b246dadf5",
        "count": 1
      },
      {
        "groupId": "core:2df0e37aaec33f8f5f362eaf437a0d543c025b1fa364453d8ca9e029d4cd40b3",
        "count": 2
      },
      {
        "groupId": "core:2e16ba8064f0d175c49c9d47cc944f585db8489601bb74752c09fc5fcdd1b12b",
        "count": 1
      },
      {
        "groupId": "core:2e3cc569dbcd38b61363151538938fb7ebfb20994256c10347a47e5faa540b9a",
        "count": 2
      },
      {
        "groupId": "core:2e4b190de545d9cdc9ac7797bea3ecd3457748902592cd4c07cebfb47919cc3d",
        "count": 1
      },
      {
        "groupId": "core:303cb236ab827e1c7bcdaeab057d799dfde366e94818d5e939df5552b16b3303",
        "count": 1
      },
      {
        "groupId": "core:30cbe65a9a0c2f68ee8a0fd7e4595bb469b35d6e8c2a1eb6ffb1c5cd297d5e0e",
        "count": 1
      },
      {
        "groupId": "core:30ed2aa087c945d98f90bd9cfe0b3b4c425e2a7eed58aefbc247cc4f6704096c",
        "count": 1
      },
      {
        "groupId": "core:312a53a08c022a6d9bb8d303dd495b25f431b6dae7abbd630277dd1c2505f1f9",
        "count": 1
      },
      {
        "groupId": "core:315a395a30ca3425ea9bb1ef45e8a6be1c85c8cb91057b435910eeb133133fcf",
        "count": 2
      },
      {
        "groupId": "core:315e226145ea9b357ed06948501b4e96d94f4d6e0e6caaa57356aa089feafa59",
        "count": 1
      },
      {
        "groupId": "core:316c9da4fbab5e39f3dd1f938b1571ba4fcf4dde45e04a8ccbf87e38711adaab",
        "count": 1
      },
      {
        "groupId": "core:32d99e407f13340683a6338be5b560016c8d7ad0ae180442274a1c4a197ff41c",
        "count": 1
      },
      {
        "groupId": "core:34026891283b160158427701d167b5ea5bb35ed442f3bb2c1cd67ca7a81934db",
        "count": 1
      },
      {
        "groupId": "core:3417d6ab630113cd7015ae7e3c9cc58241aec7c399226e35cf5a94ce4b1ef01b",
        "count": 1
      },
      {
        "groupId": "core:34326356bb8335d74fbc6422335bc04f67330c463e954509d92bca10d7dd5f3a",
        "count": 1
      },
      {
        "groupId": "core:345d8bd4000c081cb364f201f1eb1db29da71f0b664aa6419122abe2c9c20cbb",
        "count": 1
      },
      {
        "groupId": "core:348829208549b27f89a9f52df7ca2c8ac745cfb3f7122288ad3c4442101d9a4d",
        "count": 1
      },
      {
        "groupId": "core:350bc7cd5196d4f1fe4dbca8fb6d52d113afd6ab79c54fd9eac589653d706b5d",
        "count": 1
      },
      {
        "groupId": "core:357d8fb5a68f6c5c5ab0b21627eb286c9cb4920d7bf14f5757f3be1bd0011ff2",
        "count": 2
      },
      {
        "groupId": "core:36742dd16284b63a5063265348d415cd800872eb04a4326f34a9d3208332656f",
        "count": 1
      },
      {
        "groupId": "core:36fb217211d57b98df92d35a578b2b3451f28ffdb49e81a009d8664053c41c24",
        "count": 1
      },
      {
        "groupId": "core:374628609a03f43df801b88dbd5a87892c175aeeb68d8b2762eb3279aedf82e1",
        "count": 1
      },
      {
        "groupId": "core:379d3e9eabb9d0d33e17821ef4a12b31fa6361fdd713da99f6d7b4bda3c29426",
        "count": 1
      },
      {
        "groupId": "core:380d5071f4dcc756ce26ca5691273571717b87aa474fcedd1bac7a8190750dd0",
        "count": 1
      },
      {
        "groupId": "core:382ce73be261adcd5acfc9da3643e58a658f0c2a1bc60240bdcd01b876f384f5",
        "count": 1
      },
      {
        "groupId": "core:386ea8fa02ff83a081cd0ee4993110dab3bb38d2d91cf8b4b7652eb3976e65c0",
        "count": 1
      },
      {
        "groupId": "core:387619c7d6b6b70a94c34d2aba28cb039170bea888b11dcb877440e5462cb099",
        "count": 1
      },
      {
        "groupId": "core:387fbd22d38e0b85f4faf513e052cbc1370f2f87cd834c982420dcd8003276ec",
        "count": 1
      },
      {
        "groupId": "core:38f6c65b8a7ee63351bef5b32ca2fb3d394f5dce14b02359ffc2f640b39658d1",
        "count": 1
      },
      {
        "groupId": "core:3934dd3955899f41473d990cbc2fa4ba7b071dd74660a5f438c3bfe4e63169aa",
        "count": 2
      },
      {
        "groupId": "core:39cee3f94e8bc795d83c1c1013c3f7427d3b84e4d83b771535360926b552aa73",
        "count": 1
      },
      {
        "groupId": "core:39e9185911eff1fad5807a2720b373f4f6d85c124cd1ce29c4a5630000bb4a67",
        "count": 1
      },
      {
        "groupId": "core:3a31ce5911ff4572d05df323cc3f3aee21d5e2cf31874b5a73adce402c2b935a",
        "count": 1
      },
      {
        "groupId": "core:3a4de75719be7d36969ad49684ce85411d7494f3ba5b81533c2f123c51d33567",
        "count": 1
      },
      {
        "groupId": "core:3adc8a4f2295f580dd4293323614bf30530221206aab1ad4df695e1218f66bab",
        "count": 2
      },
      {
        "groupId": "core:3b00a2f540c65275e64c1d11d5c646926cd309505760fbe66ee687dadd077e8c",
        "count": 1
      },
      {
        "groupId": "core:3b0ef0ade312ce38a5b9f45bbf6fd4e7c4aca85f1258f79a9cd9954e4edc95e3",
        "count": 1
      },
      {
        "groupId": "core:3bb1227767494830a512c67efe91d6e8c27da86998f901c20bdfa6216dcd55d3",
        "count": 1
      },
      {
        "groupId": "core:3bdef46b07179649ce9d272a56a0606c1726ad5cfb39bbacb238b2e1eefbd864",
        "count": 1
      },
      {
        "groupId": "core:3d1e9a02566609236ed9feecbcc513025ce9b30eda00332b4660695c55886366",
        "count": 2
      },
      {
        "groupId": "core:3e2368ac8b7da1a35eea827e75de0b90fa1cb0ba6ddc2189972aebe903a11924",
        "count": 1
      },
      {
        "groupId": "core:3e3ac99059ad9ddc45d9bce39d4d1a8d3f95832aa120fc9baf79e53cba1668d3",
        "count": 1
      },
      {
        "groupId": "core:3e81ad1ec9287b018f9c748644d3b4ad1ac6ec0514403e90597f3542c0af1c36",
        "count": 1
      },
      {
        "groupId": "core:3f95edddcc3cb298cf05ee9a1195d2360be0e33df5d983b0c49d8f88646821c8",
        "count": 1
      },
      {
        "groupId": "core:4008f7cd4b57cb76d162813c0500088b645aacf4808ed139820b50ddf75755c8",
        "count": 1
      },
      {
        "groupId": "core:402ca8cea869e488c08a19dfa316961214fc9956fa6fb3d932025ef22cb7bce4",
        "count": 1
      },
      {
        "groupId": "core:403d8809945f91de2672e10dd495b92bde0c82fd6d8a8f8f2bf0740cbb2b9e51",
        "count": 1
      },
      {
        "groupId": "core:40820a7844d30ccb5765f744054cb6bfc8499c9644a14e805a42f02dfa96d39a",
        "count": 1
      },
      {
        "groupId": "core:40a25cba383c3e5da823d770d0344c5f001cae0f916de82729c7bcd2f3afa36c",
        "count": 1
      },
      {
        "groupId": "core:40b38f1393eced2de42f84c2da8387a67fb5f790503e300764daf2a853a4ef78",
        "count": 1
      },
      {
        "groupId": "core:4113e514f59c7ec4c757c9363261b15fd86535758d8b45dd9ce1380b88d1db39",
        "count": 1
      },
      {
        "groupId": "core:413223ac6609bde240e77750c2e581dafa5077239e73d7a515dfcbb6d54bc3b3",
        "count": 1
      },
      {
        "groupId": "core:4190f6aafbb61c06950fd5037ca8f4eaf96e2cb52953c98313ed3a443a358278",
        "count": 1
      },
      {
        "groupId": "core:42f19e6e5b59c38692b8c7e0a14536dad50bc5a9c4b9fb96be7dcbd6afc7f1b8",
        "count": 1
      },
      {
        "groupId": "core:431a7fb35ad2df3488305d2174af226ba028e81418ed8565aa8a1451f70cdfb5",
        "count": 1
      },
      {
        "groupId": "core:440b990ec9e6ae85c5362c28d1860d5235a476536083418d95cdbaaef2db89ff",
        "count": 1
      },
      {
        "groupId": "core:44767186268435536060b8773f51065c9ed86a0c374ba0d4543fadcacf4b06c2",
        "count": 1
      },
      {
        "groupId": "core:44e9fb237d016ddac4d2e84068a07efd191dd54718da2150791a49058b5afb8d",
        "count": 1
      },
      {
        "groupId": "core:4549495569e0783993471108867798dc5497ea1d8d6b6f9ece184db24321d452",
        "count": 1
      },
      {
        "groupId": "core:457274f048fb70cda1a76a54260d731622bc19a7afb125efa9ce0d12043d7210",
        "count": 1
      },
      {
        "groupId": "core:45a327666ac2495d581a40b1311896edd5f286d6d01f04c52c937460de8cee9a",
        "count": 1
      },
      {
        "groupId": "core:45bb61021c16c52a170fdc5ef28fadf2d349b4bc7cdf8bc6e4fae4e1cdb0c239",
        "count": 1
      },
      {
        "groupId": "core:46cdb39bc04707fc3b8be3a54872e8a4df35f8c712568001773de5e9b47b3787",
        "count": 1
      },
      {
        "groupId": "core:47461f3e913d4750eabfc36a5b4eca6917e3f23fe824be110af4b57175c9d531",
        "count": 1
      },
      {
        "groupId": "core:47ac507cf4a048588d9b3fc415d8b8e21f04df4f51f19c4374f640104ae60d52",
        "count": 1
      },
      {
        "groupId": "core:4988bbde884190a7688be08403354c703e20fb0509eefc9f436edea25edf315d",
        "count": 1
      },
      {
        "groupId": "core:49c2bac46b68f8f3afd51f48765b2b0e406db4c1b5dcbb9ff1c8c9ba6b0ca9d8",
        "count": 1
      },
      {
        "groupId": "core:4a83e69e3ea9fc608e90fe8abb9749ad4b98d5a0fff8a6d96bebc16907f3f80e",
        "count": 1
      },
      {
        "groupId": "core:4b17dc01210177afef15057364af0db326f01b9cf1bbbcaa8cf9fdca57b4eda5",
        "count": 1
      },
      {
        "groupId": "core:4c1e182285c03e4729b5c69b4d0ec10266dcc5425140eeaa171708a468b02beb",
        "count": 1
      },
      {
        "groupId": "core:4c352166f01d4a7926b1d96b429a75b9dc7386bce7999c77cc61721ed1a1a28c",
        "count": 1
      },
      {
        "groupId": "core:4cdaf60d1e81745467e9f53dce953eeb6897821afedce8c045c56adfdb77391f",
        "count": 1
      },
      {
        "groupId": "core:4d00c6f3be1c172032577aa811029a8dbdd123a5ca338948ae7768e54aff31a0",
        "count": 1
      },
      {
        "groupId": "core:4da521430437eb076e3c87b3821a39581af3aac1728e4fe5ba292147b45be1e9",
        "count": 1
      },
      {
        "groupId": "core:4dd39f2a6696a34e973fa57ed26b974abb0aaa64d958e2e571a08aba0604c17b",
        "count": 1
      },
      {
        "groupId": "core:4e221b2b7aed29d86d0d69b103df21fe1895db44bb6357ca913f2314390a1956",
        "count": 1
      },
      {
        "groupId": "core:4e4091f00c7b61aeac11009d3ce66042a1b98544d83ec59313ee72182fe0bbeb",
        "count": 1
      },
      {
        "groupId": "core:4f01ce275d281f30b40c2d09e3f5a6e8de565b8ff5bac5bb5220299501bcf5dc",
        "count": 1
      },
      {
        "groupId": "core:4f1d715398bff6482c2c6ea42cd7e6db0f48704c3699712c7ce3aad9c722b9f3",
        "count": 1
      },
      {
        "groupId": "core:4f7bb239c9de7b6f42fb71d192e3e24ad67652dadb529357c84e083f0453ed5f",
        "count": 1
      },
      {
        "groupId": "core:4f913a059587c3cd879713c055a4dd10d82bf75e1ede24f6e4f7ce60017b8322",
        "count": 2
      },
      {
        "groupId": "core:4f9a686732d5980091a323210005371fa5c64293a991f00bf4c2f11a8c7ff96a",
        "count": 1
      },
      {
        "groupId": "core:4fa9e82b3db9cf4523f51415b2cca3a80d669d31ab61be87ba221f874328bcec",
        "count": 2
      },
      {
        "groupId": "core:4fe9fcbb3697c5faef5094307efe4b17b2f05b0ef78a87b8a15621cc4e46b7bd",
        "count": 1
      },
      {
        "groupId": "core:500115c1d32407f31d79a973a619ad0d0c68d5c9836389b326bee0aea2a61ec4",
        "count": 1
      },
      {
        "groupId": "core:508e6ae22b9a1d92665a549f94ba1f4cf9bebae9a40c254537f41c1a8a90936a",
        "count": 1
      },
      {
        "groupId": "core:50a6a28cb4d9cadb72abd38d5d1cfad0c7cf840b2047d7a29e25a505b4bd2e91",
        "count": 2
      },
      {
        "groupId": "core:50c89a732c29046d034f78a81614f7ce66d10c081353582137d088835e6f6073",
        "count": 1
      },
      {
        "groupId": "core:50da7fe180e5e8c755bfd01c5a31d689938c591634cf72c23767114cb41ed831",
        "count": 1
      },
      {
        "groupId": "core:52bce509b8a960f90ace4a5972c81055adeb23c49e92534593eed0f2f4589550",
        "count": 1
      },
      {
        "groupId": "core:533ebfc68a7f88aaeb244fede33d0d0d5cf18910b95dcf53430361eed56827ed",
        "count": 1
      },
      {
        "groupId": "core:534c2632754ae8b40c0c778937e8ba5d5a42b48f1109f7375493046578d35a0e",
        "count": 1
      },
      {
        "groupId": "core:53e70d9a544f207568a929cbe005519fd774981abd719bb7317e2da71a8ff9c2",
        "count": 1
      },
      {
        "groupId": "core:53f3178aeba5a7376bfc8e171cd3ad602e7d3d68e8b7aebb3955b16f98c43404",
        "count": 1
      },
      {
        "groupId": "core:53fa56970ce5a8ce19c5b8c4cf5e9c04cfe9ac053bc27c6b2212204ff0a4e099",
        "count": 1
      },
      {
        "groupId": "core:5440434394a962996f12d7f8982e2368e50c8a5b6ae0b93fa6867174403750da",
        "count": 1
      },
      {
        "groupId": "core:547f51647d48fff1588b1c408468f36cfcbe051ff324ab894cd777129b14939d",
        "count": 1
      },
      {
        "groupId": "core:5480f7d5d1516f08c09065a774dcfb34c189bae3dfaf06d7582d0a042e2ad31a",
        "count": 2
      },
      {
        "groupId": "core:54d1049a6463d9847d07ab4b942033b98d8eb9b5ccba2afd8014616d430b7b42",
        "count": 1
      },
      {
        "groupId": "core:54d13a1e231ce3c67e0267d845d71dc0b2182dc1ed4ceb26f028c0fac85abcfc",
        "count": 1
      },
      {
        "groupId": "core:54d40763366463309a9f61409fee64d2090016e91391338436f3d35ef73a0aef",
        "count": 1
      },
      {
        "groupId": "core:565140b572bc0f3bcd1400148903938270b9bb3ca993e8e90aadcb401d0680f9",
        "count": 1
      },
      {
        "groupId": "core:567858eee7ff540cf717fb47c77fbb9ebeb54ad6d5753ac4d4e5545ef536669d",
        "count": 1
      },
      {
        "groupId": "core:56d9de59d0e3c614cdcc9bee7a496fdb112a08bbc4f46bda4a2ab9770c1f2939",
        "count": 1
      },
      {
        "groupId": "core:56e26b22f41e5415dba99c739dea64e6c905bf6e51243a4b52c77c0b0cdc7eac",
        "count": 2
      },
      {
        "groupId": "core:56f1c0c212baf3c97652350d66ce981bc8dfcf339374f0d70ac148d9bfa7087b",
        "count": 1
      },
      {
        "groupId": "core:570c805d6cdba0029fe544ebea242d4089560100aa1e6028bc04ecd2e0ef287e",
        "count": 1
      },
      {
        "groupId": "core:57133d0cdb09cebddfa700691b42481ca1f89a4654d02df3fb2d9fd874715218",
        "count": 1
      },
      {
        "groupId": "core:577df170560b2b556e3306257c98576a9780d7733c027a529bbfaf94ef24c4db",
        "count": 1
      },
      {
        "groupId": "core:57a406c9a86d2a310dbd497204e37f7eec3edf03fda57ec098941f273a144f7d",
        "count": 1
      },
      {
        "groupId": "core:57c7ad74295a7b48c0379f431920bf0ba38d69e0b703abfaa0376e05e4bd8733",
        "count": 1
      },
      {
        "groupId": "core:5803ae129337538a79ece59e62c2fe81623c6b81d98b6bbd215d4aad897a9f0d",
        "count": 1
      },
      {
        "groupId": "core:5866076e93bdd7b2c5c951ddb10334376f3c360767911b7ed60d25d3ecc30280",
        "count": 1
      },
      {
        "groupId": "core:5887179637cb102d136608c86df07f59dadb2b7f2493a438e4465cf7cc3eaab7",
        "count": 2
      },
      {
        "groupId": "core:5889abcbb0faf16963b28481317279670a873a4cd57a10b99227e0bb732c6e79",
        "count": 1
      },
      {
        "groupId": "core:58af815c058ed47cd849c378fe9d57919388876395168c6b2a2482a64bbbf36b",
        "count": 1
      },
      {
        "groupId": "core:5993caf4384da2678ba6432577bbd40e36285b248cefca706b50afe1c59f9483",
        "count": 1
      },
      {
        "groupId": "core:5a5929674569873f5f8f334ae3768793609cb3b7c5a84ecfba94d11a19bd558b",
        "count": 1
      },
      {
        "groupId": "core:5ac949fdbcbbddb0c2ef69931baf84fb848149eb6fd9fed4935436d129e23483",
        "count": 1
      },
      {
        "groupId": "core:5b9b5b6a1a9cfc17cca3682c819b8c03cdcf6a62191031c3102411f9ab757b1a",
        "count": 1
      },
      {
        "groupId": "core:5bc1eb44d0a35723a43ef99cd3e5befca3ca1ce68597f72e4a11dd8b15b76b27",
        "count": 1
      },
      {
        "groupId": "core:5bda3e9fbe00016fa7331b071f769f38e2245ca0964e220c04e40c736851d3f8",
        "count": 1
      },
      {
        "groupId": "core:5c575b25c096346eb6ab860093e31256487d8a1156e72397acb564b04cd38ea8",
        "count": 1
      },
      {
        "groupId": "core:5ca2b12208e97531a00f3a8ce48ba01dbc949e351e2949736c0db8ba167d3cc6",
        "count": 1
      },
      {
        "groupId": "core:5d9c5137fe84f46533a343fd2b2602b37525fd7b647b89ad8695d6a2eccf071e",
        "count": 1
      },
      {
        "groupId": "core:5dc3207a6c3392a376d062cd68be26b22344bfb6a84cae1bbc67ac60951cafab",
        "count": 1
      },
      {
        "groupId": "core:5ddbaeff5b8c8435c0bde9c8a52e9cdb1ee318b7a02bee9c8d3ff6d0a21e065e",
        "count": 1
      },
      {
        "groupId": "core:5e42854a111496a2bcf2ec94272c19ecc53bcf9225dfd65b9f2b01f90f0f722e",
        "count": 1
      },
      {
        "groupId": "core:5e64f2bff5d0f39ac82ac46ef9c97969d5dedf890dd56c0f62d4b9baace2233c",
        "count": 1
      },
      {
        "groupId": "core:5f9ee424e453bdb00d5a613ad7b17c2cdff18ed2d03bde9ed5259e85c9285ef0",
        "count": 1
      },
      {
        "groupId": "core:60f7e49c7e5005d24ad04e1ce17ea2037acc966878a240187145186830538ad9",
        "count": 1
      },
      {
        "groupId": "core:61f134affa3f122448657b477175364a2989eb3c7b1914c25892efac21429514",
        "count": 1
      },
      {
        "groupId": "core:620e5a9b8cbbc2d9220a6f09343c424e815f6be1d205f8391e52d0fa5054f0cb",
        "count": 1
      },
      {
        "groupId": "core:640b59e711dd7500f3cc2450547dfb591104dc29f60239b88952e80ecbf22595",
        "count": 1
      },
      {
        "groupId": "core:6428db5c37de32d6c70ad76d2f4015cfdabda0efcb2183664d1b3da79ece3d59",
        "count": 1
      },
      {
        "groupId": "core:64886edb9e7a2b34da4696b56c42c561894418188f8b0d59e7b39eeaae1019a2",
        "count": 1
      },
      {
        "groupId": "core:648d4f3c4bdb6ec9eb04a0c72900a52ad728a36208c6db7480084b3d9dcdba10",
        "count": 1
      },
      {
        "groupId": "core:64b3b24c4a2e75d3bdc525769a34eaa69adc152e79028ae8bb40682042b274a4",
        "count": 1
      },
      {
        "groupId": "core:64bd865bc1499a47bc6dee7c7300e503802d8ea6ebac9c96cf283d5208b8a466",
        "count": 1
      },
      {
        "groupId": "core:658ebde9e622880bdbbf087632ed910494e22bdf3cd07388456921960aab072e",
        "count": 1
      },
      {
        "groupId": "core:65b07657d5738e5c1c27ee0f0cb6135b74d682be53fddb06db6a5da7f58695d0",
        "count": 1
      },
      {
        "groupId": "core:65b171ba32ff90f00dac8b3908d4ad9e9ccc9f3f397e96c84ab528ad60c88b86",
        "count": 1
      },
      {
        "groupId": "core:65b63246c8e000dbbcee2fc038c392870065f492d25487a7be9c2153c950b2c8",
        "count": 1
      },
      {
        "groupId": "core:65ba5a248789a30314151d29a2ad1f20f7a5946e75f56e69329352ecd3a24d6a",
        "count": 1
      },
      {
        "groupId": "core:66234c67003e0adfbfb424d39b33fa7ac6f932e2b7c153f6f5ef28266a41ea71",
        "count": 1
      },
      {
        "groupId": "core:662df106cc83abdb96276d25bbcce27754ec1ceae0e1a50efadab3d99fffab29",
        "count": 1
      },
      {
        "groupId": "core:670917fac29e7bf18c0575bbc55f880c6b24c3afa51e07d30720d5fe369754aa",
        "count": 1
      },
      {
        "groupId": "core:672e235537ca67beec467b28188d75a4b4476475238a5a004cd198046c28d5ec",
        "count": 1
      },
      {
        "groupId": "core:67449f69f9144239e5a622599cb59bd8ccd4a3542e22599f053f5a9bdfdcacc3",
        "count": 1
      },
      {
        "groupId": "core:674cfe8b109bea7cd99627dd3328e5df6a5519af505000e29def2f66b9005859",
        "count": 1
      },
      {
        "groupId": "core:6896f3df3032bf33ca0a30b31dbd670d11714f0511b0cd0a248e7750da2ce82a",
        "count": 1
      },
      {
        "groupId": "core:68a6a729e3f5eae2e45e3183a6de471ebd1c9c8c5e5756e328e63488e8ac42d7",
        "count": 1
      },
      {
        "groupId": "core:68de4b425c315ec65ac603d10a8cc1d4819d7a05f2714f581694dc349fbd26ce",
        "count": 1
      },
      {
        "groupId": "core:68f013396698e7f0af989dbdcde8770f63896dd7e39970a599393284897dabc2",
        "count": 1
      },
      {
        "groupId": "core:6902a0aefd7302bc363b63b630bbbde1fd4e2d11d7641b946d671c36d34eb9f8",
        "count": 1
      },
      {
        "groupId": "core:6a2ca1f6304ff1651625d6628d7010c3a799014a2df4621aa41816acabc888f5",
        "count": 2
      },
      {
        "groupId": "core:6a63d0bdbe6adf9f5cb034d2f8b0909cb9bafa919e8a37304e43fc02524b5299",
        "count": 1
      },
      {
        "groupId": "core:6c10e6bed94d6bc0084b0ed9400639e4021de13663d27cc371863eaa8cb14be5",
        "count": 1
      },
      {
        "groupId": "core:6ca336f8455ff9964f269aa1283eb9cf18d314a4102c9df4344d55486e6285ac",
        "count": 1
      },
      {
        "groupId": "core:6cbd92d6b8033a4987c745100ed73a25d3bf0f9ff165685679ec79982bcd753b",
        "count": 1
      },
      {
        "groupId": "core:6d403c40a66b80311ca3204f4438f9b1e2383a0a30c8bc142afec2555db670e5",
        "count": 1
      },
      {
        "groupId": "core:6d9b081fa5e0a065e9b6cbef6d98650ae304cc9443f64cd8e047ee2b7dc38c09",
        "count": 1
      },
      {
        "groupId": "core:6de2fb9fb306ddfa6efea6d8c942f91835251e51d384c474e1b56d34c3cd1ea9",
        "count": 1
      },
      {
        "groupId": "core:6e8f5c78172c5134dd62e598b3f4deefd40f7bc6dc35b35ab02a3f251c8603d2",
        "count": 1
      },
      {
        "groupId": "core:6eea32caa1f290e8dce2410f05401c90cc284077535ca4956e323ea3f40936e5",
        "count": 1
      },
      {
        "groupId": "core:6fdb5527ba1484408a5e71f623c0fd7185efb649bece06c5c9f31d3c46d2ed70",
        "count": 1
      },
      {
        "groupId": "core:6fe4b58a0e10f9a944720fcbdf245193bd96a5a411ec1ffe9e6b7c7179c4ab77",
        "count": 1
      },
      {
        "groupId": "core:700c30c62429f03c4ece6af292784992f59ff6577c73c3a90bea54c92ed6d8b3",
        "count": 1
      },
      {
        "groupId": "core:714dbddf4ae3295f0e64583f2287f85f5100257dee746c073bd57152135a8669",
        "count": 1
      },
      {
        "groupId": "core:716b8a99864ae9066f3f8df603a029d9d76de331d3cdcc1204f0252e7436de07",
        "count": 2
      },
      {
        "groupId": "core:718d25a0b9a471ae6ae4b5dc6c29d7bbc5241f4dfe70c9da608b60e36a8bc00d",
        "count": 1
      },
      {
        "groupId": "core:723aaf8a8fd25a4ad6ef0e37397ba2b36d2d42a66caf0e3bb18a152e07450385",
        "count": 1
      },
      {
        "groupId": "core:723e0782a255adc59aed4060126b2fac4e1d397b345c3a181df50cfe36b7fd67",
        "count": 1
      },
      {
        "groupId": "core:7270f7f9256074c3ab3eaeea1f3505de7376e9f4409924dff1ef874ca8420212",
        "count": 1
      },
      {
        "groupId": "core:728e86424f8485fc415874581dc1c67c5f7e48e5e6b784965565818e85342822",
        "count": 1
      },
      {
        "groupId": "core:7291398e0c20c38e636a5378bf2b7cbc94674db2c3da97e145bc1f2ee77d3b24",
        "count": 1
      },
      {
        "groupId": "core:72dc86ba237ea1e154a502b02d7b8f91ceedf5da38aedbe6d44e2c355e033a3b",
        "count": 1
      },
      {
        "groupId": "core:73a3589ead0ad9604de145f4ed7f5b24141ebaa116df4d7055e3fdf80a5c7095",
        "count": 1
      },
      {
        "groupId": "core:73aec1c1b8a9fb3bf315e8b761ee66d30092044abdf930b75f5e39ade79ea2d1",
        "count": 2
      },
      {
        "groupId": "core:7418a20c8f6c43718f24d956406cfda9720060823568ede77b5f0924282f0123",
        "count": 1
      },
      {
        "groupId": "core:74668e12218b23f68ed0ceea1d606fbbf8faf16814b37886326cd285fec302bd",
        "count": 2
      },
      {
        "groupId": "core:746c4f3f15b9383138e0f3c5fa2847276dca168cc6a9bb94079b3122cc47c40f",
        "count": 1
      },
      {
        "groupId": "core:74cc641cfc59c169302733ee40a385c4393016be31fd8f3a0c19396e8653ed74",
        "count": 1
      },
      {
        "groupId": "core:74e0c7772202f154319be6489415f304dd8a68ce5d312f0693a55d626ce9a60e",
        "count": 1
      },
      {
        "groupId": "core:757f96eaed35859b6a3016572b1fb7ba8a876ec486bd47999a2f7e034689ae66",
        "count": 1
      },
      {
        "groupId": "core:75cae8c84cbcdad3bf089661c9966238488b9e3bf35ece47d573a0e7938a54ad",
        "count": 1
      },
      {
        "groupId": "core:75e84a68262d004bf9951694b321c0d2d31ae14a46117eee21e8e9edfe1bf372",
        "count": 1
      },
      {
        "groupId": "core:7610da30b7aba951b6cf5639c1077c90faaf74bacc2cfafbe86373f019935e51",
        "count": 1
      },
      {
        "groupId": "core:766e6e501cbc4c9e9996e8202aa660dcd854aca1fccfa81000f3a92940418a90",
        "count": 1
      },
      {
        "groupId": "core:76e776b9def77969f74b9275f035c10626f1a3423688042e961d1444cba36fd4",
        "count": 1
      },
      {
        "groupId": "core:77a6c6302e8e71298476702df661c599f589af87edb83f7f4de089446c67565b",
        "count": 1
      },
      {
        "groupId": "core:77ea15e839cfd7536577015ac11565f20ad3e4603d7a310a417a6096283ca919",
        "count": 1
      },
      {
        "groupId": "core:7802a8f251cd8166c4fae73d644987406eba7e138a6a54d0e2f80e62461f9b45",
        "count": 1
      },
      {
        "groupId": "core:7811d0e67d380c0c059da00fd2586c388e660542151fb5e8e69f9570763d3838",
        "count": 1
      },
      {
        "groupId": "core:781b4f0673a6af0443e275ca96aaba4dd084f19146e100ca72ac1cea1bb76533",
        "count": 1
      },
      {
        "groupId": "core:783e05ba17d5dab4c6f53aab5a942b4bf75bc2a39a0d7c84864d470aef3ddd24",
        "count": 2
      },
      {
        "groupId": "core:79409c587bac1fe1fda974f8c16d34303e451408f2067f44127a8660e743bd7d",
        "count": 1
      },
      {
        "groupId": "core:796c7cada2035abe31e8adae38e3306f8db3c88d8cc2bcb759459191f276007f",
        "count": 1
      },
      {
        "groupId": "core:7981748e88d6c0f794ebf660e52d458934c42482f46c303ccb00732c0f147dcf",
        "count": 2
      },
      {
        "groupId": "core:7ac315bd9e5b323789e8b010cf669718f28112fc661b47879a877a7da2e5929f",
        "count": 1
      },
      {
        "groupId": "core:7b1239b47577a408489dfa1f40f2028472c044620c6f9210a61445eba9ca085b",
        "count": 1
      },
      {
        "groupId": "core:7b5530c6a4530eada62a4bdf5ff62d1091b98853847fbbed9545e4e147740791",
        "count": 2
      },
      {
        "groupId": "core:7c088a1ba3f9ac3c3317d33c03cec8bf79c7a480b890d66e72ddbf6e635ded0f",
        "count": 2
      },
      {
        "groupId": "core:7c57beafcf17c3a5992997ac7b4256ba661167aa715537316c0e7a6b3676c09d",
        "count": 1
      },
      {
        "groupId": "core:7d77bdc77ca06880e264610a3b30f8f23a7f31eb7d41485266be265ef7500167",
        "count": 1
      },
      {
        "groupId": "core:7d88a4c9b5ec660fc1642884f1ecee6db225d9fe07f8a9b5b89c57e00e852e00",
        "count": 1
      },
      {
        "groupId": "core:7de8f2dffa5300e618c603517acd04bc5d0b3e6fb7a71d2db6fe3eb303348b90",
        "count": 1
      },
      {
        "groupId": "core:7f315c03a454c715972643d0a950236a0e796f2dcb8dc9ca50bafa8348b35fe0",
        "count": 2
      },
      {
        "groupId": "core:7f70807213c838ae427e4e929e803a4df24917e0cbb62ee1954f17ebea308339",
        "count": 1
      },
      {
        "groupId": "core:7fcf46fa06b09bab284db2356fbbeb5be25a39aecd5a8b9e892768c544d4464a",
        "count": 1
      },
      {
        "groupId": "core:80695ba23d6dc740e042f958544ea5f1114c5bf31b23d4bbc4a337df1f16b5bd",
        "count": 1
      },
      {
        "groupId": "core:807e7d6d203045e6d3b521ddba16473ff545214fc80140a5cf34b9917dac485e",
        "count": 1
      },
      {
        "groupId": "core:80ae871a947f174a75a012d0c115fc9022e3d92f2d75da3a24596a37cd67360b",
        "count": 1
      },
      {
        "groupId": "core:8195fb7b9c2c5e161252420bf8b9d93c9fd4631ef171d431ff1bbc880cdcbb00",
        "count": 2
      },
      {
        "groupId": "core:821e82191e6377f38f626c8ba6aeea569d5c3d865a9dce234fc9c19f7fc50a96",
        "count": 1
      },
      {
        "groupId": "core:82b618e097603608a08be16bd365ac4330466e0a381a285c1ccfbe9ec40d53f2",
        "count": 1
      },
      {
        "groupId": "core:82df8b14d1b5b03cdeba30ba4379e882c08f4bb328eb3babbe74b9ab45f4f1d6",
        "count": 1
      },
      {
        "groupId": "core:83d4c98b65c8dd51f3dd5f6e464767fdbeece9bb3d9567b7a3444ddd01216020",
        "count": 1
      },
      {
        "groupId": "core:841fab52353a464e7c5f4cf5a579fe9c45df518254af5f0fa7980246f1feb0a9",
        "count": 1
      },
      {
        "groupId": "core:84a7fe97ca85a6c8e9d6530349923fd052e8df9a9b125a043cb9aa2e604c7501",
        "count": 1
      },
      {
        "groupId": "core:84dffc75844d6393c20caeac6d84e54b90790dbcaeb0876dabe8a290ce05b98e",
        "count": 1
      },
      {
        "groupId": "core:84febfaf2bf0854c6f12eb2d7d46960355edd0f49cd7ef931a1e04d647af582b",
        "count": 1
      },
      {
        "groupId": "core:852e68913efa403d6d33560e47c5be16fde5f9424f444d800a4de5575496b9c7",
        "count": 1
      },
      {
        "groupId": "core:85e322ca8ea5edc54e3515a054b6eb78e0154be0a1022662268988af84582420",
        "count": 1
      },
      {
        "groupId": "core:8649726b81ad651ef024aa8f7f8e2f82086befbf083d20ab2557c2597794270b",
        "count": 1
      },
      {
        "groupId": "core:8654426823a1f8f807dee11c79ee3d4400d2c1ec8662f88b016f0b32499bfa81",
        "count": 1
      },
      {
        "groupId": "core:86ea27cba0e7930ff2509a0a86000e608fe708594d1d75985b8f88b87fac54af",
        "count": 1
      },
      {
        "groupId": "core:86fe2c8a926621f3404d4d992890efff9b90421a7cee85f39e09e64bad436996",
        "count": 1
      },
      {
        "groupId": "core:871a36f43368af6318fbeba80262a872a3e982a329fdde257408119f139b5eaa",
        "count": 1
      },
      {
        "groupId": "core:87951fff97aff9aa18967aec54b04240fd4a0823fb7cc4e192aef72f53716e87",
        "count": 1
      },
      {
        "groupId": "core:87c7ffc584adc28f6878c2deea39cf6da18ea771059c7ebb805d6e0b12b6df01",
        "count": 1
      },
      {
        "groupId": "core:88869733abb74c050f985db05daea228298a25d54037c96d2474b3c99555edce",
        "count": 2
      },
      {
        "groupId": "core:88a3f457d779d4fb6362941a98784037f0045bb3acef0528f7dc9aaf81590919",
        "count": 1
      },
      {
        "groupId": "core:891abea9a3d09013719ad4e7cce80ef4c30362fcb1bc81922ff5097c6c0a32fe",
        "count": 2
      },
      {
        "groupId": "core:893029e87b5606c82fab9524a8bb93a25cde51ab40dbe7ca78a771d3aebddcf8",
        "count": 2
      },
      {
        "groupId": "core:894a36874359f785371a9bbe83640bd0d889971dcfb77d4d3ba5ba09eb0cb6e1",
        "count": 1
      },
      {
        "groupId": "core:897accf79a38ee3f41e3f07cbd8631924a02ea31475c08eb1deee32897965ea1",
        "count": 1
      },
      {
        "groupId": "core:89a5d77bdf23fc883d42a9bf7c98608c24e342e16ed351dca7ccfaf7bdeb3384",
        "count": 1
      },
      {
        "groupId": "core:89acf4ba01c1c60851cc1f3d902500be9a72595c64b07a9b24d8d8448ca7a68a",
        "count": 1
      },
      {
        "groupId": "core:89c1301f9996610cc57e09f55533e165610b83d4fc17d09b87808eea6ef6667b",
        "count": 2
      },
      {
        "groupId": "core:89cc70fda11ef13921f5ccb0d1b32b21bef746fb8991c8a4eacd40913989168f",
        "count": 1
      },
      {
        "groupId": "core:89f4c166c4060e866c9936098757e88ad45f75420288009b2bef4fc731b5be9f",
        "count": 1
      },
      {
        "groupId": "core:8a47a49db4cff46c9c428f1da164909674014bfdeafa7415912bfb4c569380ab",
        "count": 1
      },
      {
        "groupId": "core:8a589b865ee75edfacc36715849192b3d99e20eba8581b60ae40dcd03cdc394b",
        "count": 1
      },
      {
        "groupId": "core:8b3afbeb0932e572ced3964b435e0b99135237175f64093c06812c2dd33323cd",
        "count": 1
      },
      {
        "groupId": "core:8b8cbc2fdec2177b3fcb512cc199d89d9fdaba5c7a5ba93772ef68691e2ae069",
        "count": 1
      },
      {
        "groupId": "core:8b95a88cd8ea4f3acc786c0078a1349a3455b3d68faf746bc5a445464b1fed12",
        "count": 1
      },
      {
        "groupId": "core:8c2360cfcf6dc21b71ebb24b03712e730003e945b3e301a50650e67dd0e2839c",
        "count": 1
      },
      {
        "groupId": "core:8cee7389df78cc37d8e82a2d033d36585b179c55e56c4ea3bbe965734d8f35b7",
        "count": 1
      },
      {
        "groupId": "core:8d43e8d6a1ec63d2fc6b96d9a798138ed2c35e1210684d25cbc2a5a5254efdbc",
        "count": 1
      },
      {
        "groupId": "core:8d588b4c02ce37f9f0c7b7312f4475527701f4e2f64e98e09515e0e8f5d6fa57",
        "count": 1
      },
      {
        "groupId": "core:8d9ff7608c0e9a0241983458089d95274e7c40ca12a1e5917a60ea52dc505d36",
        "count": 1
      },
      {
        "groupId": "core:8da1aff2de0b8ff4a53c11849403dcc3a2f720bca7288a157a6c29723ab9b9f7",
        "count": 1
      },
      {
        "groupId": "core:8dd40f6d08e694fb5ea8de0fa530a9a48dd6aeccf7eb7f0ea921095cec9e3c98",
        "count": 1
      },
      {
        "groupId": "core:8df565310de99e3333bc783b530df9e01887fba3abf1451218a23be106d22ea1",
        "count": 1
      },
      {
        "groupId": "core:8e01b70592e2147e8b20ef41a3ab1c7e1f2814ac753f96ca43560a4c859dc20b",
        "count": 1
      },
      {
        "groupId": "core:8f09721a33c0164cdf55132ef28baa878105f2435763fc2877d0476f21bc1cfc",
        "count": 1
      },
      {
        "groupId": "core:8f41314b129d173e09976d8b1085c56cccad9a93dd736394f3177de0cd385f7a",
        "count": 1
      },
      {
        "groupId": "core:8f6623ee76e4e9cd156d8aa64935026e70fca267b31cc5afae46f28757fb33b3",
        "count": 1
      },
      {
        "groupId": "core:8f94097c6946a946aaea6fb2e14f8dd36b32440195e3feaa531ca90994ef5ce0",
        "count": 1
      },
      {
        "groupId": "core:8f9e4dbba2534210400af362594d743ac5b43facb6e0fe6b13d792eaf97d365c",
        "count": 1
      },
      {
        "groupId": "core:907d09073b450f36a0204f6f5905781e11fb783d96fe56b796207c314a995c35",
        "count": 1
      },
      {
        "groupId": "core:9148cd0687f8dce46df36eef1ad9fcda7078890d8a537221ce832951a89244b2",
        "count": 1
      },
      {
        "groupId": "core:916f734bc4ac3ccba2f54424b721e849e843e38c0137a288c7b1f4efa9f38a5c",
        "count": 1
      },
      {
        "groupId": "core:9236ffc2d0ebf485a9b992d06d8a18557a1ef8217191d8ed3fcce4c0277bd771",
        "count": 1
      },
      {
        "groupId": "core:924f68ad98433bd040a9572e6fa0edf2350ea32344a395d7f9efc5bee9830e79",
        "count": 1
      },
      {
        "groupId": "core:925d5ff07b7ae587327f2be37e91202085fb989e016833c4d976e5e96f83a916",
        "count": 1
      },
      {
        "groupId": "core:938b5ca7406cfd070bdb0015536865257d24db83742c91286d71c31bd39e87e4",
        "count": 1
      },
      {
        "groupId": "core:940ef096f356381853d244255e52e6a018c5d14c45d107543f6155e0a86ba9dc",
        "count": 1
      },
      {
        "groupId": "core:94a719d1e7c2dba8fcdf69da1d232adcfe6749cba3a3372d003a070321a1f261",
        "count": 1
      },
      {
        "groupId": "core:94ed9ab0abec58c3f780b7fbbbec9f29cbe202f8e8eaddd94c40ed8da7e07b53",
        "count": 1
      },
      {
        "groupId": "core:95071ddfb02064606a40c61f095a5741179f72b0ca50f5c4117a68ce80f5d4f9",
        "count": 1
      },
      {
        "groupId": "core:9530d7e9a9d722875ab7836e03abf381a9ff4c078cbc229e5a3599160e701450",
        "count": 1
      },
      {
        "groupId": "core:954af4c9b74e2f1ec01698e8683805147151c6877aaed9765a94af145027ea7a",
        "count": 1
      },
      {
        "groupId": "core:95612cf01978dd1e3bfe39ef44c486f8dca29ed232d65e1a0d1a4bbe1daff151",
        "count": 1
      },
      {
        "groupId": "core:95bc64bbdacee83cec8967e290dc905b5d8b1fe49cfa3dd1010a02597d1c46f0",
        "count": 1
      },
      {
        "groupId": "core:95f0d8f88eec91ec357fe02197095ace63114c941501ab52f4f5d7f7a3d8d97a",
        "count": 1
      },
      {
        "groupId": "core:95fe776a380cdf6f6ecee5a03168bf4101b26c159e626c7986de38dcaa81ba6d",
        "count": 1
      },
      {
        "groupId": "core:966b593042079f737ce1240bc48e571d9df8d183c62be51740dd48d4d10ac3a1",
        "count": 1
      },
      {
        "groupId": "core:9703f68618cd318ea1d76fd14f629fdf3428e8fa308534b8c8faf71fec9b5f45",
        "count": 1
      },
      {
        "groupId": "core:973e70757a9c54b6551570c2346b0eebc91dbe1cfce3d4f947f59015c200b86c",
        "count": 1
      },
      {
        "groupId": "core:977f37fe7b0e2bc72298c574e0c9afd02d10e2c7ba61ea5d0a9d09402d8283b6",
        "count": 1
      },
      {
        "groupId": "core:97cd64ce7ea1c9f542ce1cc69dffca962398fdec92f8af050af4f0093882cca9",
        "count": 1
      },
      {
        "groupId": "core:98253dc6be13da3aba018738679207ee65c20b34ca28c3ad77079d556a12065d",
        "count": 1
      },
      {
        "groupId": "core:98b3886256ddb1ed70d28b67f6a018e04e46b904f56acce24b7b486cd1f4f54e",
        "count": 1
      },
      {
        "groupId": "core:98e33f2134bec779f51bcb31d59f36e3714f4b4d119a8832f42f31c14c429776",
        "count": 1
      },
      {
        "groupId": "core:9984579564831909efa0c53e4a3301ceae7ec98b1b369e7a2283cc92dc590d32",
        "count": 1
      },
      {
        "groupId": "core:99fade93e78584d9d33c0be5ea856c48c8064b09f3d6e4d341598c40084977a7",
        "count": 1
      },
      {
        "groupId": "core:9a3a0c42af4f6a4cff63453f378e1c5fd7e73f331959309d151ee2f6d1b54910",
        "count": 1
      },
      {
        "groupId": "core:9a7234bbd6ba5af5133f75f888bcf2184ca78c63090b6274f33ee81f7b097078",
        "count": 2
      },
      {
        "groupId": "core:9ae83fb5ab9681e499bff13dc6308e1f4c4cf745b76f936444f5aab07760fb1a",
        "count": 2
      },
      {
        "groupId": "core:9c3ef6fcc5ce641a1456e6c7bae48bc4e43f92b9a41738b3be1e3a893dd520b4",
        "count": 1
      },
      {
        "groupId": "core:9cf7397e471e3239ecc85ed1311815b0bd87d8f39ca3e68800131e0cdca5e3a6",
        "count": 1
      },
      {
        "groupId": "core:9d38070a7f3c812f11863f480837d1128ba43c6beb8438be86a59c453f853bdc",
        "count": 1
      },
      {
        "groupId": "core:9e66c6618fd4255a4b8642fdb08f377e0934fb809767503d81cf760b9ba26c67",
        "count": 1
      },
      {
        "groupId": "core:9fe4a2039a21466900f4b3d36186960bbdead2ec812d3ec943eeabc072135908",
        "count": 1
      },
      {
        "groupId": "core:a0075fc3df0fc9ba8ae70585d29ba434bc8bda8cbf051040ed06b9158114d093",
        "count": 1
      },
      {
        "groupId": "core:a0076ea93be0fcb40c27bef01b4c1665fb036dc054c61e1ef2ad3b619cca8567",
        "count": 1
      },
      {
        "groupId": "core:a0ac220dd19239448c526fa13009f48506f773814f7a82eec520a4382358ccca",
        "count": 1
      },
      {
        "groupId": "core:a0e3408254c2b449c04a75e8197ef79d6b2c883b766167137e92374dd7fa2146",
        "count": 1
      },
      {
        "groupId": "core:a0e67caef3fb403fc9c0566161704af36d7a5abad3434dc9b1649e0b63ce84be",
        "count": 1
      },
      {
        "groupId": "core:a1b070d2610c5e1a2b3a82423e6953eaee8d644c7243fc92c201d8f6cdda03f9",
        "count": 1
      },
      {
        "groupId": "core:a1bc905e871d799f186277e9cdef1cc68b5aa4aa0ecff232881a434ddafb88bb",
        "count": 1
      },
      {
        "groupId": "core:a20f03d4e9a0b3db3c9572d3c8618eeb0b74ce56ef3596bcb45af45e5023e03c",
        "count": 2
      },
      {
        "groupId": "core:a231870710a3bbb0a0a3d2b6bcf3fb4fbf8d8174a450bf012a0b9b2617958d22",
        "count": 1
      },
      {
        "groupId": "core:a2364cdd043e70280a86a5d7abccc923865d0f468079a38bccec3322700ea686",
        "count": 1
      },
      {
        "groupId": "core:a23dbef38b0fe88d6de0539960886ce598fb2f032a2e4ee4776fc3b221775758",
        "count": 2
      },
      {
        "groupId": "core:a24504501ba3e68a7aa438b9997f84b104d6c356f4dddaa7aabc19405deb703b",
        "count": 1
      },
      {
        "groupId": "core:a27decbb2949da4d59090ec16ae73b14dd17f2f1915271522f13cee29f8a440e",
        "count": 1
      },
      {
        "groupId": "core:a471696b5647672f5e4312e58a89aa13b184079f8b3a5fc2acd39d93f2c1f85a",
        "count": 1
      },
      {
        "groupId": "core:a522cb18a76d686e0f2c55bf7d9169dda53d3c1131b4dbc4bfc29e795326975f",
        "count": 1
      },
      {
        "groupId": "core:a62c13596577ee7f0932fb4ea859a05012812b7ca5f5b63011b94aa3fe6b28ed",
        "count": 1
      },
      {
        "groupId": "core:a66d9c3915d1bb80ea8898a797fa1c87f79bb46d92082b70c20b5647cde1ffdf",
        "count": 1
      },
      {
        "groupId": "core:a677f723cf9f711bd691da8e8e71433950febeba2f9b0b8d9033df2a45fa01ec",
        "count": 1
      },
      {
        "groupId": "core:a6c8e8ae23c9156b6cfff5322d16161bd4fa5225558f03a8371b550435801d20",
        "count": 1
      },
      {
        "groupId": "core:a7c808032d31a5d9c6f960f8fc1a2c37d62ce15ea9fa6a48a5bf5107b2aae14c",
        "count": 1
      },
      {
        "groupId": "core:a81233c3c940ae861cb9fb983079316767b22864a2d63bea7c81afa03166eb08",
        "count": 1
      },
      {
        "groupId": "core:a89b3b05b33175e18bdf60a27cf6c16dc934d4c0d614bef92df5b09c15913643",
        "count": 2
      },
      {
        "groupId": "core:a8af42abbcf6b255f9c6c8109251c6b06c117e6c1bf799b97fe45c2930d0d78d",
        "count": 1
      },
      {
        "groupId": "core:a8c94f79446d6e5fcedfbdaeb797aa11d4deb5c1beef2a1baccad80a8a988bd2",
        "count": 1
      },
      {
        "groupId": "core:aa4d8798778e9de4a50552527ad454780802c111294437a1c01655fbc7d6109c",
        "count": 2
      },
      {
        "groupId": "core:aa6b93ee853fb119035165b2cf4ea53cc053ce43eb20b787bd754174aeb2041a",
        "count": 1
      },
      {
        "groupId": "core:aaacc0df47aa66a5e5ead904ce1afa877db885b592b5d82d7c0af0c0c301090b",
        "count": 1
      },
      {
        "groupId": "core:ab4ee3748437ad07376cb33638f5d6e50a08d5e089814a692441c1de01378d29",
        "count": 1
      },
      {
        "groupId": "core:abae99585eae69d4317383a71879327eaa300ed71df09878a8e8a96142a7cfc0",
        "count": 1
      },
      {
        "groupId": "core:abc70f61997134ce9dabcbec74f4c0484af626c82b2d27e6d5d03e75775ce159",
        "count": 1
      },
      {
        "groupId": "core:abeeab1e19f685d01c38bdb85c97945589049b126b125e3086577039dec437ef",
        "count": 1
      },
      {
        "groupId": "core:add57d57f7401b6b0b7b755d5eb8e8f2666bd0585a277df5ce1b309688d9416f",
        "count": 1
      },
      {
        "groupId": "core:ae2f6b9fb4ad5880c8d956505ba3acf83d3beddb0d05e8e4e490e2768a1e815b",
        "count": 1
      },
      {
        "groupId": "core:aecd1cdf9100655c99f484bf88b2775417fea0ac17376aa65bc3ed7816b1e281",
        "count": 1
      },
      {
        "groupId": "core:af0dafd980fd8ae48aee622d06807ac94c221cdc0157e2761615330a60f99821",
        "count": 1
      },
      {
        "groupId": "core:afb213bfe42e4bfe1d48fde0e2415f8ae41b4db24f92025487be0e76d2d52d08",
        "count": 1
      },
      {
        "groupId": "core:b048f4e36e2dcc5a183c8f97fc71a49ebaf704f735ae2a30df1e35710f551436",
        "count": 1
      },
      {
        "groupId": "core:b08541da1a4b5440470d03afe714fb239fb02cc3331247d44743d6627d733c99",
        "count": 1
      },
      {
        "groupId": "core:b2124ec22ec2fdad82888a1e840f88fb0712ac4230855f25bb6e98256be5a8ad",
        "count": 1
      },
      {
        "groupId": "core:b22e05c64717fdcafc7e9e5edc66401fc57075d0ce7e52b3848871ea2e143bd1",
        "count": 1
      },
      {
        "groupId": "core:b24ff8040ee9695fe1f66a031aa29a9caded52b8d1dddb356a33e985897b2e4e",
        "count": 1
      },
      {
        "groupId": "core:b2af15a2bcf0de3098859242de340c808a8be2e28e30a00339ce6df22a28e20e",
        "count": 1
      },
      {
        "groupId": "core:b31930300bcc93b70fc0e9c18861a4813385a7c18b751e3f2b5917ba80a1285c",
        "count": 1
      },
      {
        "groupId": "core:b38b5105633b2c9fda543b1c1d99ce8b6e441978efcd78188b4bf5de814dd80e",
        "count": 1
      },
      {
        "groupId": "core:b394bb2ad193e9a3bfa585023666f066bbf51c4c9eb4ef867cfaed7e82e75123",
        "count": 1
      },
      {
        "groupId": "core:b4442a4c215127165ebbb8f7ba6c280e3d29298cc11753c81e8ec14d7201a28c",
        "count": 1
      },
      {
        "groupId": "core:b46f310164f62f2ab692fb01f0cc96164202c7c50c96ae3894f8c678fe97a6ac",
        "count": 1
      },
      {
        "groupId": "core:b474fe5654022e56f133f3a8295dfbdadc5618952fcd867bc29e6a135ea7099e",
        "count": 1
      },
      {
        "groupId": "core:b48eecd1711e8beb6b0d5bb612f1cb8f79861b762b337989e81776e81f0e7373",
        "count": 1
      },
      {
        "groupId": "core:b492005f6eb57b537a05dff038839ca1f84a979fd9f46b6d31e28ef8969c4d1f",
        "count": 1
      },
      {
        "groupId": "core:b4d53c37af73388225cb2b76c86418845a6f2650f4e2ce8fe5f34ac30346cc81",
        "count": 1
      },
      {
        "groupId": "core:b628dc7174fe7c2a0cfbbad668210416a2eaf31c491737769acf93d528c0066f",
        "count": 1
      },
      {
        "groupId": "core:b635cf4117f55f76de380ac9f1877eb95dda08273870f8b06c27ba07fbfdfaf6",
        "count": 1
      },
      {
        "groupId": "core:b68bf31b95763f2a7aba8d1d77cba300e81150dfbf88b6ced0d8d63c5464b7ad",
        "count": 1
      },
      {
        "groupId": "core:b822d34ab69d0bbe226554d99766e3ca2347432cebf27fb627500ae6299d702b",
        "count": 1
      },
      {
        "groupId": "core:b89223a27455fe46439151b0601983678f15324bd9fb599b84319a8d98f29bfc",
        "count": 1
      },
      {
        "groupId": "core:b93b3c5ae148e091834ebc6b015c38d3775b1e9aa10edb1bbbbb2426e85efb50",
        "count": 2
      },
      {
        "groupId": "core:b96852dceb214e2ae8c187a4091fd73b5d06ad3920623e7177a8f9ef84cd5133",
        "count": 1
      },
      {
        "groupId": "core:ba0c58c7d962474b86111df15dfc90322e612cb14981c3d18869c02d1e85fa0c",
        "count": 1
      },
      {
        "groupId": "core:bacee6a1164abc4c8ea4b3ab392393e68804cb9e87c6894581054df25950598b",
        "count": 1
      },
      {
        "groupId": "core:bb22e4a6912ddd489335499994bcc0648abbd7f6412a5bd79685f5c5135b9565",
        "count": 1
      },
      {
        "groupId": "core:bbca596e9775a4aeff5254afbb9a33879ef3ad37ca7ad00b92124b8f6f81d143",
        "count": 2
      },
      {
        "groupId": "core:bc62206fbc11a81160e90a1a4976f9b8bda7257abdcd271c7e3871bf77d0416c",
        "count": 1
      },
      {
        "groupId": "core:bce50f40cba19ac693a54af3708e52f1b9c08680a694df169b213f4ebb518106",
        "count": 1
      },
      {
        "groupId": "core:bd8b0e293521e99b5dc3ce93a58cd3f3ce423a14c15f912312e57d60b32d1187",
        "count": 1
      },
      {
        "groupId": "core:be1475688780bfe759523e6410ac8d7ce7283a787d619196b6fb51596ac4ec0d",
        "count": 1
      },
      {
        "groupId": "core:bec82efcbc252192e8f1f8c9e48aa841c2b9942cd7b582e92b1dbd29fd60ab37",
        "count": 1
      },
      {
        "groupId": "core:beef640a571cd145d52d93ccce668c43210a8c8884c9908d73c47ba687003be4",
        "count": 1
      },
      {
        "groupId": "core:bf1b9ad0d0e6927db39a53060a5151ea4fb3f2c339158f6dc713cc1c6227f667",
        "count": 1
      },
      {
        "groupId": "core:bf2515c2f3208be5071c031de349243c4a84b7e533c2cb2a581e5cceb4b642f8",
        "count": 2
      },
      {
        "groupId": "core:bf8e42262b5718650b4ceebdfa4e3ee68a44ea3abc539b94a76bf8e41113dfcb",
        "count": 1
      },
      {
        "groupId": "core:bfcf93c56799682834d060ef3ebc49a34902e3af3eb8b6413713dc19755c7556",
        "count": 1
      },
      {
        "groupId": "core:bfd9557833e1860b95bd63bb2e9639035672fb0b01e50e20055ce6f59166b016",
        "count": 1
      },
      {
        "groupId": "core:c0813f4615c6b1de248a9d359a1219222f22d610e47100aad5d277e4d2fecb5c",
        "count": 1
      },
      {
        "groupId": "core:c09569c9e4fddc6288dc7ccbf059f9c568c2d1f3d9725d348568b907a33ca36b",
        "count": 1
      },
      {
        "groupId": "core:c0c363f151f91ccda5f254d59afe39931a6a4bae9b068007c48cd26c1130956e",
        "count": 1
      },
      {
        "groupId": "core:c2658d3914802e9588ef7a135398c0652b1d8eb0579a7a97be57a208673350cc",
        "count": 1
      },
      {
        "groupId": "core:c27a68b4502c8f402bc2227fa7ae16f9030463f7a64fc773cec16ab29fd57d42",
        "count": 1
      },
      {
        "groupId": "core:c2af21b0bc7c978d2f77e8c221ae1016ce3c7bb096510ec7b4de493e1124f92f",
        "count": 1
      },
      {
        "groupId": "core:c2b167f5fb2d89114bdbfa4cf88aa3d4a768600ec78027ff16cf42283d9b4180",
        "count": 1
      },
      {
        "groupId": "core:c2df514ccf5f4359bad2a1eede48581fef6c69176c6f6aefb48f0a40addbcffd",
        "count": 1
      },
      {
        "groupId": "core:c2f201e789617e7ca68228b13683fa85a5db2671cfc950995e5b54be074dea69",
        "count": 1
      },
      {
        "groupId": "core:c2fe941ba3d311f72c83d9a2cd4396f8aefafcdc315bdeca2dd13bd6bcbd6b3f",
        "count": 1
      },
      {
        "groupId": "core:c3d16710ee1118ba40fdfbcfc49a651e877934888ea776d3647449e1c2129726",
        "count": 1
      },
      {
        "groupId": "core:c3ec14fc58e7a75f2449146d96be28d5abcf7a5f7d7f81e6042cd110b01d3efa",
        "count": 1
      },
      {
        "groupId": "core:c3ed0f98f75eb4222e9c7123d1cdc84eac993eb7e4bdc7e6a0f522bc7c7d9105",
        "count": 1
      },
      {
        "groupId": "core:c459b3cc3c324fa913505aab812bed92fae5cc5e6768d52ce9994e8c15178979",
        "count": 1
      },
      {
        "groupId": "core:c511eea3d5670e864a309b628b0a99d8eb162213a668ea17a62df4b9cf339ec3",
        "count": 2
      },
      {
        "groupId": "core:c524e4aed96ee36ced39f7fed77d33643e803666ec41a7f081cf737d1d2d02e6",
        "count": 1
      },
      {
        "groupId": "core:c566d91ce0975e3dd28ef695aee2696aed394d3f213dd0521224f2353871b076",
        "count": 2
      },
      {
        "groupId": "core:c5ed066fccc4c4826d370e29331d420afa7a2ad5b16e2ea558971a0e9aa5fe4e",
        "count": 1
      },
      {
        "groupId": "core:c774caf425220ad2eb5637da3ac0e489164efad5e63d481e83ccc08a94c487c7",
        "count": 1
      },
      {
        "groupId": "core:c7b1af4c7e308f80480f68dac5ece7e5d8058047a3d70c3af6033e55ec30721e",
        "count": 1
      },
      {
        "groupId": "core:c7d6020bdf09d1605b1b0bd407b52eacf3dd77e27c4eba2c75f9242d03f7dfa3",
        "count": 1
      },
      {
        "groupId": "core:c915f8c8cee279b8808385754850b0e0269e38a298e2f92f35fb7d25c5fe2585",
        "count": 1
      },
      {
        "groupId": "core:c925aab91ad4a1b365834e854095c0eecdf5188d78cba9a637f26c732d18ff11",
        "count": 1
      },
      {
        "groupId": "core:ca160c9f07ee87cae295951deff3c8faf0a0e696af95f4d6949e8f06fce61357",
        "count": 1
      },
      {
        "groupId": "core:ca16dd9cc62907587fcfc2ef1845774a9e8dc6e81a44c1f68509219192143328",
        "count": 1
      },
      {
        "groupId": "core:ca2f2a1d65fff8d283f6c317f18cd66b1b417349b02186b4b6e46f48be532e25",
        "count": 1
      },
      {
        "groupId": "core:ca93c248b81bf3f5c8b4e7ec1b28a7ff66d8912c77cd62837b1bc1c34f982479",
        "count": 1
      },
      {
        "groupId": "core:cabcc588ed30ab3ca157d479ae2c4bcfda1dffecdae55d501ebb053ff0224a8e",
        "count": 1
      },
      {
        "groupId": "core:cba12d681bc601afe22e3443721a2a5b5aef8509f51ddf1002fc54e6018564d6",
        "count": 1
      },
      {
        "groupId": "core:cbb2920a9bee0540efc46e18a85b04710d53d7afe94d60bb6af39a36611e7d2e",
        "count": 2
      },
      {
        "groupId": "core:cc1cc4ae8e5b33d30b0cfd5140e074e2a4c00767ff79d88a03b898a5247f7ba7",
        "count": 1
      },
      {
        "groupId": "core:cc9a0dd68a59bbaec29920999fea2061931697dc428870e6852278876b23dbdb",
        "count": 2
      },
      {
        "groupId": "core:cd6825c0a1026f21fd46cd3d969a7c6df06d24212b0011f468589e85f86b8b9c",
        "count": 1
      },
      {
        "groupId": "core:cdd956552c7e19fa0347876ea142f02691343e5d747b2d4478e05cd11e2a1ba0",
        "count": 1
      },
      {
        "groupId": "core:cde2205585313b22e04e435e95962effcbd4e0c0eca839971844afdd4f631197",
        "count": 2
      },
      {
        "groupId": "core:ce638b472126339aee88abb07909f67e143b627eed3613b95d0c325095eb2bfa",
        "count": 1
      },
      {
        "groupId": "core:ce9bc4cc59aafd3f5060b65a02f2342b55f8484fe5312d0fd5d11aed9df1bc8b",
        "count": 1
      },
      {
        "groupId": "core:cec4ce78327a2079f76889c5018367407c17f1bd7df3a7a0c6cf0c904993e64e",
        "count": 1
      },
      {
        "groupId": "core:ced4f2a2ec2a8760facb926daccabb010a7cac13c41acf76432e959b2ce39700",
        "count": 1
      },
      {
        "groupId": "core:cee6f6108c805b6fc9085ff122831d316aae4360c7effe96ef35f993458d0178",
        "count": 1
      },
      {
        "groupId": "core:d04881680bdacc2d4efe4c87d1a220485562de2049731474ae179e61ce9fe2f1",
        "count": 1
      },
      {
        "groupId": "core:d068082648fb18a8456b4ad0ded1c31ed04eb18dc6d2e4df6fba2d98ee0f24b8",
        "count": 1
      },
      {
        "groupId": "core:d0ad059f7d765a41f6b9d89e22640f6edd4ab6e89a5bd0d195f57539a0a935dc",
        "count": 1
      },
      {
        "groupId": "core:d164def9b9c6a42337c042dd7c2d4108c54e3ce8eaa5bf72bb4f783920a2721c",
        "count": 1
      },
      {
        "groupId": "core:d17b6460739b3c83f02aa49ab33b5c71690667483cb61d7a115b097103dc503c",
        "count": 1
      },
      {
        "groupId": "core:d220e663e65484aaa4edbde0c84f17d548f6c5b08f6bd88f3673cf05fe1ed42f",
        "count": 1
      },
      {
        "groupId": "core:d2359c4cea7f3eec54032e5de3b779bf31f95eac4860e50ac92be465a6597682",
        "count": 1
      },
      {
        "groupId": "core:d2b600b3c54b771f53d373ffdcf403d0c4fc7ca72e0c022a92c058abced7d682",
        "count": 1
      },
      {
        "groupId": "core:d316b792f4fca495a9969fb12fff692a48cc4af6323b635dfd6811640aadd627",
        "count": 1
      },
      {
        "groupId": "core:d68c91d5e8939ddcb38fbce794d29f8b8b3c475aa2e58013bc93fa17d6d01891",
        "count": 1
      },
      {
        "groupId": "core:d7bf2e24be6d3c3c45c491c30aada153b2560c0aee777c101c765efce2dbf8ec",
        "count": 1
      },
      {
        "groupId": "core:d855ce39f12528d513e6e4ae6aa78fd5c4e88c9beac6a1bcd756fafb68b151c9",
        "count": 1
      },
      {
        "groupId": "core:d8aa61920574ebc2ad1c8e30cf9526900c690407a0db6021db6689a7d599e93f",
        "count": 1
      },
      {
        "groupId": "core:d8e75f5af1687f7767090cf7766cde12e7220779ac84a617cd7e285424721a78",
        "count": 1
      },
      {
        "groupId": "core:d97d3d7b5226162aae6508696306ad02bab3152806db7f1a8d9973cc076a4cc7",
        "count": 1
      },
      {
        "groupId": "core:d98362ced536455ae3f89f5d8a3dcea385954e0fe63dfe91be67cf527f082046",
        "count": 1
      },
      {
        "groupId": "core:da383edc5a4044713d84b3088439c5cb3073d04cf5d89e9d4c5aaa8d3a8737ea",
        "count": 1
      },
      {
        "groupId": "core:da6d28e9849563778a965edfa5994357f1698500efddde1a638c951839872112",
        "count": 1
      },
      {
        "groupId": "core:db49558065338057e45275b8c23b45cd6cbd4c7cf8df5085bcf7c60a39867590",
        "count": 1
      },
      {
        "groupId": "core:db5d405fedfc14bd2dbb97293af7fc48d9c36f164189465d2a65e9f248acc748",
        "count": 1
      },
      {
        "groupId": "core:db619be1078a519383a033f5f993614b2343d44bb28215fa24d2640eb82b534b",
        "count": 1
      },
      {
        "groupId": "core:db7fdc25e40255186f616ea4b1236aeec38edc4cccf0b8b23af0ff233600c596",
        "count": 1
      },
      {
        "groupId": "core:dbfb572511f9e0419dd53db279cbd113184df28173b2aea8e8ab5da12db8e0ce",
        "count": 1
      },
      {
        "groupId": "core:dc2d53f080d0775fbee12b6da27fb157fc6456c5608ed3e2e7e743fc63a41d4d",
        "count": 1
      },
      {
        "groupId": "core:dd147bacf64e39139885ff0ee4756d66938d84c99a015e9dec968a7409bf406b",
        "count": 1
      },
      {
        "groupId": "core:dd1c4d3246f559f6980be20d1ee10cbd3cca04c93ff4935b13a1162b92293c98",
        "count": 1
      },
      {
        "groupId": "core:ddb154a2924da6476bed76e203948d34ab25d2ede215ac07fe6a163a15bac729",
        "count": 1
      },
      {
        "groupId": "core:ddc4acee8089200857bfeb0c58f3eb34fd4fdaba306079f7f3590b4d911f7361",
        "count": 1
      },
      {
        "groupId": "core:dddfedcc42f42f810ba72dc9e08cefb74f6bf0c481d49c8f1a0f08aec2e49a80",
        "count": 1
      },
      {
        "groupId": "core:de2f7d07dad1a631e182c0a5c8553e71b7a5e3f30b8164837ce755de00cf3536",
        "count": 1
      },
      {
        "groupId": "core:de41819653915643c59be34d35feaf85b3d8d92ba753491dc321ca675af238c3",
        "count": 1
      },
      {
        "groupId": "core:df1930694673c79c78fa372768d0da0c1948da5301756f03c830183a126c50c8",
        "count": 1
      },
      {
        "groupId": "core:dfd34e7982f135b618e2f4e4439475ec3e7a16e6b372930c341e6cacda38de36",
        "count": 1
      },
      {
        "groupId": "core:e03d11131723d587c73ef31c9bf2b64fc32f9f89bbc4ad45a87003bd3cce2230",
        "count": 1
      },
      {
        "groupId": "core:e0433bfb6a47775fbc044d9251aade5882835e3ad61aad977fb36bc28715ad7c",
        "count": 2
      },
      {
        "groupId": "core:e082b8cf612cb12d9b9721d7e1c157af848df8afa92754076b04be6789be0194",
        "count": 1
      },
      {
        "groupId": "core:e0e2a219163d1d9af282b2d9fdd710e86650d99f9b8ba6c9933e23cadd473863",
        "count": 1
      },
      {
        "groupId": "core:e22636b674f1c09c7192fdc314fb055dd7f261da00364699b92fff4fc1c1cf90",
        "count": 1
      },
      {
        "groupId": "core:e2e4994b1dbba44d8ecb61494370b9222a4eb882a8789771849bced92f20b3d7",
        "count": 1
      },
      {
        "groupId": "core:e448d966fad912395009c9d7327b57aef13b5acd7afa2d0d38b647ffa549e2d7",
        "count": 1
      },
      {
        "groupId": "core:e4d1efcd8e2d70b13a786cc504bbeda728ac902acb09ed9bd6a1d22727acb551",
        "count": 1
      },
      {
        "groupId": "core:e4e8e7c40f33c42600b416d173b01097089e96bce20aeece95cd860ebdb11bac",
        "count": 1
      },
      {
        "groupId": "core:e58dc5440e804bcd0438fbb86184a2b27c2e7340d659f3b22859ddcd5287a914",
        "count": 1
      },
      {
        "groupId": "core:e5f763dfc7064e12de9ec0663c064e10d891f694788f63dcdab1c5314f98aa89",
        "count": 1
      },
      {
        "groupId": "core:e620b34c3cea92ea5e58ab2f2aabefb3600373798e6695d8b6a5d91ae2b9446e",
        "count": 1
      },
      {
        "groupId": "core:e64f86caff1808f97d717b5cc80e41add4a2171d0dfc88316185fbb1c37f5741",
        "count": 1
      },
      {
        "groupId": "core:e6afd3f1d1c7a209e6405abe872a34e9ab725a1180bbddf9f07a7e004ee95cb5",
        "count": 1
      },
      {
        "groupId": "core:e6d30c88fe3dac00bd19019055bddae5bfd4c3db5e48a5ff0b78c4acc3447c09",
        "count": 1
      },
      {
        "groupId": "core:e775fe125e4c1d74a3e5b31c8492559f93be460aeaae91261b1791cbd46aa696",
        "count": 1
      },
      {
        "groupId": "core:e7ad0fe19934bce374e8bf1b278183fc6ce28ffe6416188f20559eefdf5a958e",
        "count": 1
      },
      {
        "groupId": "core:e7d000f721345897e88b274f08fb20b6c0f6c79d0c6eda50435cd9eee683c757",
        "count": 1
      },
      {
        "groupId": "core:e7e542f9cd45c4a3946c77a1ae9db10665674d2eab864fa23a3190d90f3b54c9",
        "count": 1
      },
      {
        "groupId": "core:e83c7a1e63ca7c11506dc7208992d81d90cc7abb02af4d58c70f691f194e3ffd",
        "count": 1
      },
      {
        "groupId": "core:e8ae47f24ce163d61184449f00c358133fe9cbdbf5b15022840b86b5234d3f66",
        "count": 1
      },
      {
        "groupId": "core:e8e48283d54e81084548361098e613a38705ca59f2aea7bbbb22917a809a7280",
        "count": 1
      },
      {
        "groupId": "core:e909664789b87adb489850fc458e0f76a1994385a43412f61f59a1958040934e",
        "count": 1
      },
      {
        "groupId": "core:e9e93d6e6f7401b15b0caf1a3e3013ddfb6f79e1b3bff85fb1c18e7e3667a50f",
        "count": 1
      },
      {
        "groupId": "core:ec1c0b70da46a964c7e6efe7912c959b44319fdaa8e624fa3d3bf330ec9ed375",
        "count": 1
      },
      {
        "groupId": "core:ec755a71f97a19beeb8775ce3bf9f8b73c5078055e0a0c4e05c827c04c7fb17b",
        "count": 1
      },
      {
        "groupId": "core:ecc63b77ba21854ca8f814f795223ae11f26d2ec734e79ca7cae9ee05c8663ce",
        "count": 1
      },
      {
        "groupId": "core:eeb0cf42b90a0e3f48bf225e90c66baacf8c050061379701b1290d5c10d8dd99",
        "count": 1
      },
      {
        "groupId": "core:ef39b12e51f911289add8016ba2de401dfb36c5ab3dac2bb3c74af350a766e8e",
        "count": 1
      },
      {
        "groupId": "core:f0c1c408aecb6a2b663fe08b520c002c23cfb20387a815beb4b88f39f5f95dd0",
        "count": 1
      },
      {
        "groupId": "core:f10ffcd3a35a219427374f7c75e2826ca31a9bafb66b809a64def2d445d1584f",
        "count": 1
      },
      {
        "groupId": "core:f133bc01f8d6a5f50ecee735461633501e7f637e3117440ff710591f5378815d",
        "count": 1
      },
      {
        "groupId": "core:f1827a6d1a90b18f8a1167a11f3d59f65082b9b7ba2bd4eeb3546abfcbff97db",
        "count": 2
      },
      {
        "groupId": "core:f1ea872552f8b6daf94b5305d494c52a507a15942f406112161d6b074712acd2",
        "count": 1
      },
      {
        "groupId": "core:f2ab793497b37b81ecf2a9509ad704274128b734838ff8c914ac78c5c52ded8d",
        "count": 1
      },
      {
        "groupId": "core:f311dcd8de75b7751f5a04b2b3a9798e0648fdcb510bbce4a7a5a77f14149e5e",
        "count": 1
      },
      {
        "groupId": "core:f3694bff2df22bd2dfa7e387b5decdf91277e462c31f054f7cf14c5e8db338eb",
        "count": 1
      },
      {
        "groupId": "core:f38d6e0bc3be57a35581d19e78cb14991b48270a47c2c868dd96cab10dab2d7e",
        "count": 1
      },
      {
        "groupId": "core:f45d997269e2b7242d0396c4436fb17d9d24490abdfa544665aa4b38e48f21bc",
        "count": 1
      },
      {
        "groupId": "core:f48ee730bf3fbba86ccb770013ee29362788725fdc4dde2b2242d6ef0552907f",
        "count": 1
      },
      {
        "groupId": "core:f4a8b39299fd3b1c7b038979790d4cc5f885c67da0b64663b1dfc95b63447499",
        "count": 1
      },
      {
        "groupId": "core:f4ddbc8b3d866454edd694b40ff93955ebc275efc66853ef0c8e56c2a4193fae",
        "count": 1
      },
      {
        "groupId": "core:f53461c5ed4f0b1c41aeeed69eaabd08e521626b72915de52f0fce38d81fd92e",
        "count": 1
      },
      {
        "groupId": "core:f5a1086bf4e595a8140f5185d9bb406a2be16c9f1095874880950168676b5b72",
        "count": 1
      },
      {
        "groupId": "core:f5c193f6f38addc965076b7ab5e692829c14ed99cd793ee932422d6bb9e973d7",
        "count": 1
      },
      {
        "groupId": "core:f5fe3786ae52bdf48d6257bdb636086f8b2dad2207f99f1592b51e7a614e040d",
        "count": 1
      },
      {
        "groupId": "core:f651224b4d504a67a049206778a3bd38a7bdfe8c14570c5853cf274571e08259",
        "count": 1
      },
      {
        "groupId": "core:f6c742bf2148898cc33c142bbc3ee2e0f172db59deff3084f196082d386ce606",
        "count": 1
      },
      {
        "groupId": "core:f6d9322890cd39555cee7ce55624e1417b109912a819e00a00644e030eb6c88f",
        "count": 1
      },
      {
        "groupId": "core:f6e5368e48e491bad0552a54fd3ff7cf1e9e7dc7a299e2d93b59f9856a1dd631",
        "count": 2
      },
      {
        "groupId": "core:f7bff4f6f5d6ad5e281cda84ceee3238edaae5d22210ee5a87b2ce95055799c6",
        "count": 2
      },
      {
        "groupId": "core:f85851c9cb426e8a1cc135c4297407f66bb0452a20def0fab306c42991c74187",
        "count": 2
      },
      {
        "groupId": "core:f885b63923c216bd3c30ec970b30a6562f1dbc811944728265d63541df79a6bf",
        "count": 1
      },
      {
        "groupId": "core:f89757e0737c0b9fc1ec2e395e31fc848da008cb294bd68a5a4c90b853df14d6",
        "count": 1
      },
      {
        "groupId": "core:f8b114250d0245d26512e61b0f27518e2c599ab8b7634fafe81399e4fc457744",
        "count": 1
      },
      {
        "groupId": "core:f8ea7a77b1256fda29636dabb47a7da5ae28efdd1090d5b0f40b714de13c21ca",
        "count": 2
      },
      {
        "groupId": "core:f8ef8bb9c9f298232ebe32dae1745d81b44da08df8977dd07ab6bb1d6bf2cce9",
        "count": 1
      },
      {
        "groupId": "core:f8fefe24af1d23a0b41644c0c3008cd0e14bfba11cb758e4c7a906cc79286e03",
        "count": 1
      },
      {
        "groupId": "core:fa66c1a7f3e259a7d2552ff065ad8354c2b6d7ed276c39327a43a35aeeea90be",
        "count": 1
      },
      {
        "groupId": "core:fa8d5fea5a1882d8d68636bd688a2eca9a85e3dbd44507177e45cb1b74aaf8cc",
        "count": 2
      },
      {
        "groupId": "core:fb3e4a5d9f349f52b53850bc169baa1e095e7678722a7b837ed69dc73798856a",
        "count": 1
      },
      {
        "groupId": "core:fb403ebc2863c8ec9e3d85a985ac1afdc2b75a3373f7afb443270cf4cd4e2b7c",
        "count": 1
      },
      {
        "groupId": "core:fb8c69683d37568e4b4acbe503be9bc45f8423aee5bd7ffd606b98d016a8d919",
        "count": 1
      },
      {
        "groupId": "core:fbcbb152d65dfa2c5761796357732c42bd2cb59dc083021a22b57d001e5e9ae4",
        "count": 1
      },
      {
        "groupId": "core:fc3a3c43b2e2de6f1b73fe938cae83908bbcca25cacda0c781b4620c338e3f01",
        "count": 2
      },
      {
        "groupId": "core:fc8e409d15bd70ad99b31d28f75cedf959ea64c67127cab0a33fd434c1e9d427",
        "count": 1
      },
      {
        "groupId": "core:fd3ae285ed3067e1d4ed57f3839cd2726adc75f5d626577798258e047408392b",
        "count": 1
      },
      {
        "groupId": "core:fd450fa4c5bc711c6d1fd64046b8f2a0c044fad2148bbb3e4fb91c19180f7f69",
        "count": 1
      },
      {
        "groupId": "core:fe014d6cdadc39d7483363d333961c76f4ec94be199c065e2e1c9b6415c1f5b2",
        "count": 1
      },
      {
        "groupId": "core:fe28816048cbe508ae2cd4c5e2b6f931fdd0a6d9a49a82c59c8f20ffb3a0f74e",
        "count": 1
      },
      {
        "groupId": "core:fe56a760cf738c1ad7a400a39573ffa0872d9fe5189456f49edd7dfe8a0ad5d4",
        "count": 1
      },
      {
        "groupId": "core:fe58ce973d8e0108da094df9c739eaa47406a81ab4ac4f1d1a8f76582dc612e8",
        "count": 1
      },
      {
        "groupId": "core:fe868f582b987e9f58be0eb17504dde41366bc987e58e107619e475c9449ee7d",
        "count": 1
      },
      {
        "groupId": "core:fe92f8067193a01738e0f565e2cf0b4e31577dfd6be742212ec7bf59419cdc4d",
        "count": 2
      },
      {
        "groupId": "core:fe9d85fe81c741581775f93fc68bf539a0e8b19c13d4869b2130dced24e29bb0",
        "count": 1
      },
      {
        "groupId": "core:fea3362fe808ad3df3949d2ef86ed5aee01bb0a565c48b0300079ce6d6d39a7b",
        "count": 1
      },
      {
        "groupId": "core:febd813bbb799221f8606207cc75c5a198396d775113c9137bb8ded01fa943b0",
        "count": 1
      },
      {
        "groupId": "core:fecef21e80651cb557461196531e9847fc96bdb262027863bbaf73064494bb71",
        "count": 1
      },
      {
        "groupId": "core:ff6d629718b3fc0979a5f419b7915be980df5aede735d9be2e561eb13ae40ab1",
        "count": 1
      }
    ],
    "sameAudioDifferentRequestGroups": 61,
    "sameModelSameCoreSplitGroups": 0,
    "exactContextSeparatedGroups": 0,
    "duplicateTextAcrossGroups": 16,
    "divergentTextWithinGroup": 61
  },
  "includedAsrCandidateCount": 671,
  "currentControlCount": 161,
  "unknownCoreIdentityCount": 465,
  "unknownDecodeConfigurationCount": 645,
  "unknownPromptPolicyCount": 491,
  "reconciledSameCoreSplitGroupCount": 0,
  "reasons": [
    "ASR_ONLY_CORRELATION_DENOMINATOR_CURRENT_EXCLUDED",
    "CORE_GROUP_IS_NOT_AN_INDEPENDENT_MODEL",
    "DISTINCT_REQUEST_INTERVAL_DECODE_PROMPT_OBSERVATIONS_PRESERVED",
    "UNKNOWN_IDENTITIES_ARE_NOT_MERGED"
  ]
}
```

## 31. Correlation Group Count

```json
{
  "legacyAsr": 551,
  "legacyIncludingCurrent": 712,
  "hierarchical": 610
}
```

## 32. Singleton Group Count

```json
{
  "legacyAsr": 433,
  "legacyIncludingCurrent": 594,
  "hierarchical": 549
}
```

## 33. Singleton Rate

```json
{
  "legacyAsr": 0.7858439201451906,
  "legacyIncludingCurrent": 0.8342696629213483,
  "hierarchical": 0.9
}
```

## 34. Same-audio Split Groups

```json
{
  "reconciled": 0,
  "sameAudioDifferentRequest": 61,
  "unknownCoreIdentity": 465
}
```

## 35. Hierarchical Group Policy

```json
{
  "correlationPolicyHash": "96a7fb4a8743989455dcaafeb430f8da469d33038fcea9920093fc5e95dd340b",
  "currentIndependentVoteCount": 0,
  "rules": "provider→model/core→observation层级；未知core/decode/prompt保留unknown，不能伪造独立性。"
}
```

## 36. Current-preservation Contract

```json
{
  "policyHash": "bd795413f6bbb3faccfd653d38b6de28ef94985a3f72b86e35b4e5ea68e6bd27",
  "productionMutationAllowed": false,
  "rules": "KEEP_CURRENT是保留基线，不是第三个ASR provider票；结构/来源不能证明安全时保留或review。"
}
```

## 37. Raw MBR Margin

```json
{
  "known": 141,
  "unknown": 58,
  "mean": 0.05106913734721237,
  "minimum": -0.6527777777777778,
  "maximum": 1,
  "positiveCount": 86,
  "interpretation": "MBR风险差，不是识别置信度。"
}
```

## 38. Hierarchical MBR Margin

```json
{
  "known": 141,
  "unknown": 58,
  "mean": 0.20543610151055844,
  "minimum": -0.14285714285714285,
  "maximum": 1,
  "positiveCount": 105,
  "interpretation": "MBR风险差，不是识别置信度。"
}
```

## 39. Runner-up Margin

```json
{
  "known": 118,
  "unknown": 81,
  "mean": 0.11849172170859644,
  "minimum": 0,
  "maximum": 1,
  "positiveCount": 36,
  "interpretation": "MBR风险差，不是识别置信度。"
}
```

## 40. Length Ratio

```json
{
  "known": 141,
  "unknown": 58,
  "mean": 0.8669372188879515,
  "minimum": 0.07142857142857142,
  "maximum": 3.75
}
```

## 41. Contraction Risk

```json
{
  "MILD_CONTRACTION_RISK": 46,
  "NO_CONTRACTION_RISK": 47,
  "STRONG_CONTRACTION_RISK": 48,
  "UNSUPPORTED_DELETION_RISK": 135
}
```

## 42. Completeness Risk

```json
{
  "UNKNOWN": 199
}
```

其中 141 个 eligible proposals 的 completeness 状态同样全部 UNKNOWN，`incompleteSpeech=null`；0 个 INCOMPLETE_SPEECH_RISK detected 不构成“已证实没有不完整语音”的证据。

## 43. Request-edge Risk

```json
{
  "known": 0,
  "unknown": 199,
  "mean": null,
  "minimum": null,
  "maximum": null
}
```

141 个 eligible proposals 的 request-edge、左右边界 pinned 和 decoder truncation 证据全部未知；0 个 EDGE_TRUNCATION_RISK detected 不能解读为 141 项均已通过边界风险检查。

## 44. Hallucination Risk

```json
{
  "known": 120,
  "unknown": 79,
  "mean": 0.012124999999999993,
  "minimum": 0,
  "maximum": 0.6
}
```

## 45. CTC Evidence

```json
{
  "knownDirections": 27,
  "unknownDirections": 172,
  "usefulSupport": 2,
  "harmfulSupport": 1,
  "usefulVeto": 4,
  "harmfulVeto": 3,
  "interpretation": "DIRECTION_VS_COUNTERFACTUAL_ASSOCIATION_NOT_CAUSAL_PROOF"
}
```

## 46. Machine Feature Table

```json
{
  "rows": 199,
  "featureHash": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
  "names": [
    "rawMbrMargin",
    "hierarchicalMbrMargin",
    "runnerUpMargin",
    "providerCode",
    "candidateRoleCode",
    "providerSupportCount",
    "correlationSupportCount",
    "whisperStability",
    "reazonStability",
    "crossModelAgreement",
    "ctcDirection",
    "ctcMargin",
    "tokenSupportCoverage",
    "decoderTruncationRisk",
    "hallucinationRisk",
    "requestEdgeRisk",
    "speechCompleteness",
    "characterLengthRatio",
    "tokenLengthRatio",
    "normalizedLcsCoverage",
    "deletedCharacterRatio",
    "insertedCharacterRatio",
    "prefixRetention",
    "suffixRetention",
    "longestDeletedSpanRatio",
    "longestInsertedSpanRatio",
    "eventDuration",
    "charactersPerSecond",
    "normalizedDistance",
    "spanApplicationSafe"
  ]
}
```

## 47. Feature Count

```json
30
```

## 48. Gold-free Feature Audit

```json
{
  "rawTextFeatureCount": 0,
  "goldFeatureCount": 0,
  "datasetSpecificFeatureCount": 0,
  "runtimeGoldInputCount": 0
}
```

## 49. Feature Freeze

```json
{
  "frozenAt": "2026-08-30T16:22:55.199Z",
  "featureSchemaHash": "aac060f81a71d4acd052f12260cf8fe25032f7e4f28ae56d11da8513cd3f0000",
  "featureTableHash": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
  "sourceCodeAggregateHash": "91c11a60854673abee2da7bc930e04529d17c2abd7784c81c70a322ac3e7276d",
  "runtimeNodeVersion": "24.19.0",
  "sharedSourceEntry": "packages/shared/src/index.ts",
  "runtimeSourceExecutionVerified": true,
  "machineAggregateHash": "b2bc9059016077fed71ece3947088a2f8adcc6949e60148a1346f6095f14c782",
  "freezeHash": "72e8ba96f1d26b1b142d785e10d9c47ec1a507dee216517b6d744818c71a804d"
}
```

## 50. Gold Label Barrier

```json
{
  "machineFrozenAt": "2026-08-30T16:22:55.199Z",
  "goldFirstReadAt": "2026-08-30T16:23:42.248Z",
  "ordered": true,
  "machineArtifactsFrozenBeforeGold": true
}
```

## 51. SWITCH_IMPROVES Count

§51–54 保留原始 artifact 的全部 199 行标签计数；eligible-only 分母为 141，对应 21/31/24/65，另 58 个非 eligible 记录全部 unknown。详见总览的分母表。

```json
21
```

## 52. SWITCH_REGRESSES Count

```json
31
```

## 53. SWITCH_NEUTRAL Count

```json
24
```

## 54. SWITCH_UNEVALUABLE Count

```json
123
```

## 55. Proposal Oracle Gain

```json
{
  "exactGroups": 38,
  "searchLimitGroups": 0,
  "unevaluableGroups": 23,
  "assemblyErrorGroups": 0,
  "entireFixedMapExact": false,
  "exactGroupCoverage": 0.6229508196721312,
  "baselineExactError": 673,
  "baselineNormalizedError": 533,
  "bestExactError": 607,
  "bestNormalizedError": 471,
  "exactGain": 66,
  "normalizedGain": 62,
  "goldExactGraphemeCount": 1136,
  "goldNormalizedGraphemeCount": 1027,
  "baselineExactCer": 0.5924295774647887,
  "baselineNormalizedCer": 0.5189873417721519,
  "bestExactCer": 0.534330985915493,
  "bestNormalizedCer": 0.45861733203505356,
  "searchedCombinations": 527,
  "validCombinations": 527,
  "rejectedCombinations": 0,
  "errorAggregation": "UNIQUE_EXACT_FIXED_GROUPS_ONLY"
}
```

## 56. Best Existing Candidate Oracle Gain

```json
{
  "exactGroups": 38,
  "searchLimitGroups": 0,
  "unevaluableGroups": 23,
  "assemblyErrorGroups": 0,
  "entireFixedMapExact": false,
  "exactGroupCoverage": 0.6229508196721312,
  "baselineExactError": 673,
  "baselineNormalizedError": 533,
  "bestExactError": 527,
  "bestNormalizedError": 399,
  "exactGain": 146,
  "normalizedGain": 134,
  "goldExactGraphemeCount": 1136,
  "goldNormalizedGraphemeCount": 1027,
  "baselineExactCer": 0.5924295774647887,
  "baselineNormalizedCer": 0.5189873417721519,
  "bestExactCer": 0.4639084507042254,
  "bestNormalizedCer": 0.3885102239532619,
  "searchedCombinations": 10822,
  "validCombinations": 10822,
  "rejectedCombinations": 0,
  "errorAggregation": "UNIQUE_EXACT_FIXED_GROUPS_ONLY"
}
```

## 57. Proposal Oracle Coverage

```json
{
  "commonExactGroups": 38,
  "proposalGain": 62,
  "candidateGain": 134,
  "missedCandidateGain": 72,
  "ratio": 0.4626865671641791
}
```

## 58. Fold Design

```json
{
  "construction": "SOURCE_AUDIO_OVERLAP_NEIGHBOR_SHARED_CUE_CONTIGUOUS_GROUPS",
  "adaptation": "NO_LABEL_BASED_REPARTITION",
  "groups": 29,
  "requestedFoldCount": 5,
  "foldCount": 5,
  "folds": [
    {
      "foldId": "outer-1",
      "groups": 9,
      "events": 32
    },
    {
      "foldId": "outer-2",
      "groups": 2,
      "events": 37
    },
    {
      "foldId": "outer-3",
      "groups": 3,
      "events": 41
    },
    {
      "foldId": "outer-4",
      "groups": 8,
      "events": 50
    },
    {
      "foldId": "outer-5",
      "groups": 7,
      "events": 39
    }
  ]
}
```

## 59. Fold Freeze

```json
{
  "hash": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc",
  "frozenBeforeLabels": true,
  "status": "READY"
}
```

## 60. Leakage Audit

```json
{
  "audio": 0,
  "event": 0,
  "cue": 0,
  "fixedGroupCrossFoldCount": 0,
  "trainTestIntersections": 0,
  "testLabelInputToPredictionCount": 0,
  "fullDataPredictionCount": 0
}
```

## 61. S0 KEEP_ALL_CURRENT

```json
{
  "requested": {
    "profileId": "S0",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 0,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "SAFE_NULL_BASELINE",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "c907f6f4ffac0f4a0637b4fdb7f03bd1b9f194b026fddafa12251fa968fcd429"
  },
  "actualApplied": {
    "profileId": "S0",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 0,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "SAFE_NULL_BASELINE",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "c907f6f4ffac0f4a0637b4fdb7f03bd1b9f194b026fddafa12251fa968fcd429"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 0,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 0,
    "evaluableGroups": 42,
    "improvedGroups": 0,
    "regressedGroups": 0,
    "neutralGroups": 42,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": null,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 767,
    "shadowNormalizedError": 604,
    "exactGain": 0,
    "normalizedGain": 0,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.5945736434108527,
    "shadowNormalizedCer": 0.517566409597258
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 62. S1 Legacy Candidate MBR

```json
{
  "requested": {
    "profileId": "S1",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 12,
    "eligibleProposalCount": 99,
    "evaluableProposalCount": 54,
    "selectedCount": 99,
    "evaluableSelectedCount": 54,
    "selectedUnevaluableCount": 45,
    "correctSwitchCount": 22,
    "wrongSwitchCount": 20,
    "neutralSwitchCount": 12,
    "blockedCount": 0,
    "abstainCount": 0,
    "precision": 0.4074074074074074,
    "harmRate": 0.37037037037037035,
    "selectiveCoverage": 1,
    "allEligibleCoverage": 1,
    "rawSelectedOverEvaluableRatio": 1.8333333333333333,
    "normalizedEditGain": 27,
    "exactEditGain": 46,
    "oracleAvailableGain": 82,
    "oracleCaptureRate": 0.32926829268292684,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 9,
    "minimumActiveSelected": 5,
    "modelClass": "LEGACY_NONSELECTIVE_CONTROL",
    "wilson": {
      "lower": 0.2867821208591458,
      "upper": 0.5403315065650943,
      "confidenceLevel": 0.95,
      "n": 54
    },
    "semanticHash": "3c8ff1b0264389ee97e6d539657afd9aacde4bff5eb0d6872df3f097322b4424"
  },
  "actualApplied": {
    "profileId": "S1",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 12,
    "eligibleProposalCount": 99,
    "evaluableProposalCount": 54,
    "selectedCount": 99,
    "evaluableSelectedCount": 54,
    "selectedUnevaluableCount": 45,
    "correctSwitchCount": 22,
    "wrongSwitchCount": 20,
    "neutralSwitchCount": 12,
    "blockedCount": 0,
    "abstainCount": 0,
    "precision": 0.4074074074074074,
    "harmRate": 0.37037037037037035,
    "selectiveCoverage": 1,
    "allEligibleCoverage": 1,
    "rawSelectedOverEvaluableRatio": 1.8333333333333333,
    "normalizedEditGain": 27,
    "exactEditGain": 46,
    "oracleAvailableGain": 82,
    "oracleCaptureRate": 0.32926829268292684,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 9,
    "minimumActiveSelected": 5,
    "modelClass": "LEGACY_NONSELECTIVE_CONTROL",
    "wilson": {
      "lower": 0.2867821208591458,
      "upper": 0.5403315065650943,
      "confidenceLevel": 0.95,
      "n": 54
    },
    "semanticHash": "3c8ff1b0264389ee97e6d539657afd9aacde4bff5eb0d6872df3f097322b4424"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 52,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 34,
    "evaluableGroups": 42,
    "improvedGroups": 14,
    "regressedGroups": 14,
    "neutralGroups": 14,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": 0.6538461538461539,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 733,
    "shadowNormalizedError": 591,
    "exactGain": 34,
    "normalizedGain": 13,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.568217054263566,
    "shadowNormalizedCer": 0.506426735218509
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 63. S2 Raw-margin Selective

```json
{
  "requested": {
    "profileId": "S2",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 6,
    "evaluableSelectedCount": 5,
    "selectedUnevaluableCount": 1,
    "correctSwitchCount": 1,
    "wrongSwitchCount": 3,
    "neutralSwitchCount": 1,
    "blockedCount": 56,
    "abstainCount": 115,
    "precision": 0.2,
    "harmRate": 0.6,
    "selectiveCoverage": 0.06578947368421052,
    "allEligibleCoverage": 0.0425531914893617,
    "rawSelectedOverEvaluableRatio": 0.07894736842105263,
    "normalizedEditGain": -10,
    "exactEditGain": -6,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": -0.14492753623188406,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 3,
    "minimumActiveSelected": 5,
    "modelClass": "ACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": 0.03622410863243014,
      "upper": 0.6244653702374747,
      "confidenceLevel": 0.95,
      "n": 5
    },
    "semanticHash": "415554eedda227ae57cbefe18471040dda131ba27fc5431f03ba6794ca076121"
  },
  "actualApplied": {
    "profileId": "S2",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 6,
    "evaluableSelectedCount": 5,
    "selectedUnevaluableCount": 1,
    "correctSwitchCount": 1,
    "wrongSwitchCount": 3,
    "neutralSwitchCount": 1,
    "blockedCount": 56,
    "abstainCount": 115,
    "precision": 0.2,
    "harmRate": 0.6,
    "selectiveCoverage": 0.06578947368421052,
    "allEligibleCoverage": 0.0425531914893617,
    "rawSelectedOverEvaluableRatio": 0.07894736842105263,
    "normalizedEditGain": -10,
    "exactEditGain": -6,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": -0.14492753623188406,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 3,
    "minimumActiveSelected": 5,
    "modelClass": "ACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": 0.03622410863243014,
      "upper": 0.6244653702374747,
      "confidenceLevel": 0.95,
      "n": 5
    },
    "semanticHash": "415554eedda227ae57cbefe18471040dda131ba27fc5431f03ba6794ca076121"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 4,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 3,
    "evaluableGroups": 42,
    "improvedGroups": 1,
    "regressedGroups": 2,
    "neutralGroups": 39,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": 0.75,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 775,
    "shadowNormalizedError": 616,
    "exactGain": -8,
    "normalizedGain": -12,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.6007751937984496,
    "shadowNormalizedCer": 0.5278491859468724
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 64. S3 Hierarchical Selective

```json
{
  "requested": {
    "profileId": "S3",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 5,
    "evaluableSelectedCount": 3,
    "selectedUnevaluableCount": 2,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 3,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 115,
    "precision": 0,
    "harmRate": 1,
    "selectiveCoverage": 0.039473684210526314,
    "allEligibleCoverage": 0.03546099290780142,
    "rawSelectedOverEvaluableRatio": 0.06578947368421052,
    "normalizedEditGain": -9,
    "exactEditGain": -11,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": -0.13043478260869565,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 3,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": 5.551115123125783e-17,
      "upper": 0.5614970317550454,
      "confidenceLevel": 0.95,
      "n": 3
    },
    "semanticHash": "a555e8bbd4943f08b1470f9468ef080c5e7465409fd2e8433319ae6b140720bd"
  },
  "actualApplied": {
    "profileId": "S3",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 5,
    "evaluableSelectedCount": 3,
    "selectedUnevaluableCount": 2,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 3,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 115,
    "precision": 0,
    "harmRate": 1,
    "selectiveCoverage": 0.039473684210526314,
    "allEligibleCoverage": 0.03546099290780142,
    "rawSelectedOverEvaluableRatio": 0.06578947368421052,
    "normalizedEditGain": -9,
    "exactEditGain": -11,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": -0.13043478260869565,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 3,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": 5.551115123125783e-17,
      "upper": 0.5614970317550454,
      "confidenceLevel": 0.95,
      "n": 3
    },
    "semanticHash": "a555e8bbd4943f08b1470f9468ef080c5e7465409fd2e8433319ae6b140720bd"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 5,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 3,
    "evaluableGroups": 42,
    "improvedGroups": 0,
    "regressedGroups": 3,
    "neutralGroups": 39,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": 0.6,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 778,
    "shadowNormalizedError": 613,
    "exactGain": -11,
    "normalizedGain": -9,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.6031007751937985,
    "shadowNormalizedCer": 0.5252784918594687
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 65. S4 Current-preservation

```json
{
  "requested": {
    "profileId": "S4",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 6,
    "evaluableSelectedCount": 4,
    "selectedUnevaluableCount": 2,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 4,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 115,
    "precision": 0,
    "harmRate": 1,
    "selectiveCoverage": 0.05263157894736842,
    "allEligibleCoverage": 0.0425531914893617,
    "rawSelectedOverEvaluableRatio": 0.07894736842105263,
    "normalizedEditGain": -12,
    "exactEditGain": -12,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": -0.17391304347826086,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 4,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": 0,
      "upper": 0.4898908364545973,
      "confidenceLevel": 0.95,
      "n": 4
    },
    "semanticHash": "8c13899b2456f937c3f5bc78eef3aa2880ca927753a9d3546685c9053402e675"
  },
  "actualApplied": {
    "profileId": "S4",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 6,
    "evaluableSelectedCount": 4,
    "selectedUnevaluableCount": 2,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 4,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 115,
    "precision": 0,
    "harmRate": 1,
    "selectiveCoverage": 0.05263157894736842,
    "allEligibleCoverage": 0.0425531914893617,
    "rawSelectedOverEvaluableRatio": 0.07894736842105263,
    "normalizedEditGain": -12,
    "exactEditGain": -12,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": -0.17391304347826086,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 4,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": 0,
      "upper": 0.4898908364545973,
      "confidenceLevel": 0.95,
      "n": 4
    },
    "semanticHash": "8c13899b2456f937c3f5bc78eef3aa2880ca927753a9d3546685c9053402e675"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 5,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 3,
    "evaluableGroups": 42,
    "improvedGroups": 0,
    "regressedGroups": 3,
    "neutralGroups": 39,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": 0.6,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 779,
    "shadowNormalizedError": 616,
    "exactGain": -12,
    "normalizedGain": -12,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.603875968992248,
    "shadowNormalizedCer": 0.5278491859468724
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 66. S5 Deletion/Completeness-aware

```json
{
  "requested": {
    "profileId": "S5",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 141,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "b0ff4fa21558f4e76e6bbb0b1c77a94dc3cdc68126bfbd2e2c1d4f5aa329ebf3"
  },
  "actualApplied": {
    "profileId": "S5",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 141,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "b0ff4fa21558f4e76e6bbb0b1c77a94dc3cdc68126bfbd2e2c1d4f5aa329ebf3"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 0,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 0,
    "evaluableGroups": 42,
    "improvedGroups": 0,
    "regressedGroups": 0,
    "neutralGroups": 42,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": null,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 767,
    "shadowNormalizedError": 604,
    "exactGain": 0,
    "normalizedGain": 0,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.5945736434108527,
    "shadowNormalizedCer": 0.517566409597258
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 67. S6 Full Machine Evidence

```json
{
  "requested": {
    "profileId": "S6",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 141,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "c40a9e6b5691d2da87e253b08d1027b3c2c6ebd0e12eaa6a14b203ef7129cf54"
  },
  "actualApplied": {
    "profileId": "S6",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 141,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "c40a9e6b5691d2da87e253b08d1027b3c2c6ebd0e12eaa6a14b203ef7129cf54"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 0,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 0,
    "evaluableGroups": 42,
    "improvedGroups": 0,
    "regressedGroups": 0,
    "neutralGroups": 42,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": null,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 767,
    "shadowNormalizedError": 604,
    "exactGain": 0,
    "normalizedGain": 0,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.5945736434108527,
    "shadowNormalizedCer": 0.517566409597258
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 68. S7 Conservative Rule

```json
{
  "requested": {
    "profileId": "S7",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 141,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "1954aefe7bfc4c3ce2aaace4dd15b33798b82b99373f53fe9ad707a2f6d7e545"
  },
  "actualApplied": {
    "profileId": "S7",
    "foldId": null,
    "metricUnit": "FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL",
    "sharedEvaluationGroupCount": 17,
    "eligibleProposalCount": 141,
    "evaluableProposalCount": 76,
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "selectedUnevaluableCount": 0,
    "correctSwitchCount": 0,
    "wrongSwitchCount": 0,
    "neutralSwitchCount": 0,
    "blockedCount": 56,
    "abstainCount": 141,
    "precision": null,
    "harmRate": null,
    "selectiveCoverage": 0,
    "allEligibleCoverage": 0,
    "rawSelectedOverEvaluableRatio": 0,
    "normalizedEditGain": 0,
    "exactEditGain": 0,
    "oracleAvailableGain": 69,
    "oracleCaptureRate": 0,
    "candidateOracleAvailableGain": null,
    "candidateOracleCaptureRate": null,
    "catastrophicDeletionRegressionCount": 0,
    "minimumActiveSelected": 5,
    "modelClass": "INACTIVE_SELECTIVE_MODEL",
    "wilson": {
      "lower": null,
      "upper": null,
      "confidenceLevel": 0.95,
      "n": 0
    },
    "semanticHash": "1954aefe7bfc4c3ce2aaace4dd15b33798b82b99373f53fe9ad707a2f6d7e545"
  },
  "fixed": {
    "totalCueGroups": 61,
    "changedCueGroups": 0,
    "stableMappedGroups": 42,
    "ambiguousGroups": 15,
    "unmappedGroups": 4,
    "structureIncompatibleGroups": 0,
    "fixedMappedChangedGroupCount": 0,
    "evaluableGroups": 42,
    "improvedGroups": 0,
    "regressedGroups": 0,
    "neutralGroups": 42,
    "unevaluableGroups": 19,
    "fixedEvaluationCoverage": 0.6885245901639344,
    "changedGroupCoverage": null,
    "baselineExactError": 767,
    "baselineNormalizedError": 604,
    "shadowExactError": 767,
    "shadowNormalizedError": 604,
    "exactGain": 0,
    "normalizedGain": 0,
    "goldExactGraphemeCount": 1290,
    "goldNormalizedGraphemeCount": 1167,
    "baselineExactCer": 0.5945736434108527,
    "baselineNormalizedCer": 0.517566409597258,
    "shadowExactCer": 0.5945736434108527,
    "shadowNormalizedCer": 0.517566409597258
  },
  "blockedRequestedEventIds": [],
  "authority": "precision按proposal案例；editgain只取fixed唯一组，不相加counterfactual收益。"
}
```

## 69. Best Active Profile

```json
{
  "recordedOofBestActiveProfile": "S2",
  "routeSelectedProfile": null,
  "reportActiveProfile": "S2",
  "routeConfirmedStrong": false
}
```

## 70. Null Baseline

```json
{
  "profile": "S0",
  "applied": 0,
  "fixedGain": 0,
  "classification": "SAFE_NULL_BASELINE",
  "statement": "零选择/零错误只证明null基线，不是active成功。"
}
```

## 71. OOF Selected Count

```json
6
```

## 72. OOF Correct Switches

```json
1
```

## 73. OOF Wrong Switches

```json
3
```

## 74. OOF Neutral Switches

```json
1
```

## 75. OOF Abstentions

```json
115
```

## 76. OOF Precision

```json
0.2
```

## 77. Precision Wilson Interval

```json
{
  "lower": 0.03622410863243014,
  "upper": 0.6244653702374747,
  "confidenceLevel": 0.95,
  "n": 5
}
```

## 78. OOF Harm Rate

```json
0.6
```

## 79. OOF Selective Coverage

```json
0.06578947368421052
```

## 80. OOF Exact Gain

```json
-8
```

## 81. OOF Normalized Gain

```json
-12
```

## 82. Proposal Oracle Capture

```json
{
  "numeratorUniqueGroupGain": -12,
  "denominatorExactOracleGain": 62,
  "rate": -0.1935483870967742,
  "groupCount": 38,
  "denominatorAuthority": "SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY"
}
```

## 83. Candidate Oracle Capture

```json
{
  "numeratorUniqueGroupGain": -12,
  "denominatorExactOracleGain": 134,
  "rate": -0.08955223880597014,
  "groupCount": 38,
  "denominatorAuthority": "SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY"
}
```

## 84. Fold 1 Result

```json
[
  {
    "profile": "S0",
    "foldId": "outer-1",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S1",
    "foldId": "outer-1",
    "selectedCount": 17,
    "evaluableSelectedCount": 12,
    "normalizedGain": null
  },
  {
    "profile": "S2",
    "foldId": "outer-1",
    "selectedCount": 6,
    "evaluableSelectedCount": 5,
    "normalizedGain": null
  },
  {
    "profile": "S3",
    "foldId": "outer-1",
    "selectedCount": 5,
    "evaluableSelectedCount": 3,
    "normalizedGain": null
  },
  {
    "profile": "S4",
    "foldId": "outer-1",
    "selectedCount": 6,
    "evaluableSelectedCount": 4,
    "normalizedGain": null
  },
  {
    "profile": "S5",
    "foldId": "outer-1",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S6",
    "foldId": "outer-1",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S7",
    "foldId": "outer-1",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  }
]
```

## 85. Fold 2 Result

```json
[
  {
    "profile": "S0",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S1",
    "foldId": "outer-2",
    "selectedCount": 12,
    "evaluableSelectedCount": 4,
    "normalizedGain": null
  },
  {
    "profile": "S2",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S3",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S4",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S5",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S6",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S7",
    "foldId": "outer-2",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  }
]
```

## 86. Fold 3 Result

```json
[
  {
    "profile": "S0",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S1",
    "foldId": "outer-3",
    "selectedCount": 20,
    "evaluableSelectedCount": 12,
    "normalizedGain": null
  },
  {
    "profile": "S2",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S3",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S4",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S5",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S6",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S7",
    "foldId": "outer-3",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  }
]
```

## 87. Fold 4 Result

```json
[
  {
    "profile": "S0",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S1",
    "foldId": "outer-4",
    "selectedCount": 27,
    "evaluableSelectedCount": 17,
    "normalizedGain": null
  },
  {
    "profile": "S2",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S3",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S4",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S5",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S6",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S7",
    "foldId": "outer-4",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  }
]
```

## 88. Fold 5 Result

```json
[
  {
    "profile": "S0",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S1",
    "foldId": "outer-5",
    "selectedCount": 23,
    "evaluableSelectedCount": 9,
    "normalizedGain": null
  },
  {
    "profile": "S2",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S3",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S4",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S5",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S6",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  },
  {
    "profile": "S7",
    "foldId": "outer-5",
    "selectedCount": 0,
    "evaluableSelectedCount": 0,
    "normalizedGain": 0
  }
]
```

## 89. Negative-gain Fold Count

```json
0
```

这里仅计已知负收益 active folds。S2 同时有 1 个 unknown active fold：outer-1 选择 6 项、5 项可评价，存在 1 项不可评价使 fold 联合收益为 null；其余 4 folds 零选择、收益为 0。不能据此宣称所有 folds 非负。

## 90. Active-selection Fold Count

```json
1
```

## 91. OOF Shadow Cue Count

```json
{
  "metric": "cueCount",
  "selectedActive": 161,
  "profiles": [
    {
      "profile": "S0",
      "value": 161
    },
    {
      "profile": "S1",
      "value": 161
    },
    {
      "profile": "S2",
      "value": 161
    },
    {
      "profile": "S3",
      "value": 161
    },
    {
      "profile": "S4",
      "value": 161
    },
    {
      "profile": "S5",
      "value": 161
    },
    {
      "profile": "S6",
      "value": 161
    },
    {
      "profile": "S7",
      "value": 161
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 92. OOF Exact CER

```json
{
  "metric": "exactCer",
  "selectedActive": 0.6614173228346457,
  "profiles": [
    {
      "profile": "S0",
      "value": 0.6601049868766404
    },
    {
      "profile": "S1",
      "value": 0.626421697287839
    },
    {
      "profile": "S2",
      "value": 0.6614173228346457
    },
    {
      "profile": "S3",
      "value": 0.6627296587926509
    },
    {
      "profile": "S4",
      "value": 0.663167104111986
    },
    {
      "profile": "S5",
      "value": 0.6601049868766404
    },
    {
      "profile": "S6",
      "value": 0.6601049868766404
    },
    {
      "profile": "S7",
      "value": 0.6601049868766404
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 93. OOF Normalized CER

```json
{
  "metric": "normalizedCer",
  "selectedActive": 0.60400390625,
  "profiles": [
    {
      "profile": "S0",
      "value": 0.6015625
    },
    {
      "profile": "S1",
      "value": 0.58251953125
    },
    {
      "profile": "S2",
      "value": 0.60400390625
    },
    {
      "profile": "S3",
      "value": 0.60400390625
    },
    {
      "profile": "S4",
      "value": 0.60546875
    },
    {
      "profile": "S5",
      "value": 0.6015625
    },
    {
      "profile": "S6",
      "value": 0.6015625
    },
    {
      "profile": "S7",
      "value": 0.6015625
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 94. OOF Coverage

```json
{
  "metric": "coverage",
  "selectedActive": 0.96484375,
  "profiles": [
    {
      "profile": "S0",
      "value": 0.96484375
    },
    {
      "profile": "S1",
      "value": 0.96484375
    },
    {
      "profile": "S2",
      "value": 0.96484375
    },
    {
      "profile": "S3",
      "value": 0.96484375
    },
    {
      "profile": "S4",
      "value": 0.96484375
    },
    {
      "profile": "S5",
      "value": 0.96484375
    },
    {
      "profile": "S6",
      "value": 0.96484375
    },
    {
      "profile": "S7",
      "value": 0.96484375
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 95. OOF Missing

```json
{
  "metric": "missing",
  "selectedActive": 6,
  "profiles": [
    {
      "profile": "S0",
      "value": 6
    },
    {
      "profile": "S1",
      "value": 6
    },
    {
      "profile": "S2",
      "value": 6
    },
    {
      "profile": "S3",
      "value": 6
    },
    {
      "profile": "S4",
      "value": 6
    },
    {
      "profile": "S5",
      "value": 6
    },
    {
      "profile": "S6",
      "value": 6
    },
    {
      "profile": "S7",
      "value": 6
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 96. OOF Hallucination

```json
{
  "metric": "hallucination",
  "selectedActive": 1,
  "profiles": [
    {
      "profile": "S0",
      "value": 1
    },
    {
      "profile": "S1",
      "value": 0
    },
    {
      "profile": "S2",
      "value": 1
    },
    {
      "profile": "S3",
      "value": 1
    },
    {
      "profile": "S4",
      "value": 1
    },
    {
      "profile": "S5",
      "value": 1
    },
    {
      "profile": "S6",
      "value": 1
    },
    {
      "profile": "S7",
      "value": 1
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 97. OOF Material Errors

```json
{
  "metric": "materialErrors",
  "selectedActive": 80,
  "profiles": [
    {
      "profile": "S0",
      "value": 77
    },
    {
      "profile": "S1",
      "value": 78
    },
    {
      "profile": "S2",
      "value": 80
    },
    {
      "profile": "S3",
      "value": 78
    },
    {
      "profile": "S4",
      "value": 79
    },
    {
      "profile": "S5",
      "value": 77
    },
    {
      "profile": "S6",
      "value": 77
    },
    {
      "profile": "S7",
      "value": 77
    }
  ],
  "authority": "旧全片质量比较，仅作配套guard；fixed唯一组收益是主评价。"
}
```

## 98. OOF Severe Timing

```json
{
  "metric": "severeTiming",
  "selectedActive": 53,
  "profiles": [
    {
      "profile": "S0",
      "value": 53
    },
    {
      "profile": "S1",
      "value": 53
    },
    {
      "profile": "S2",
      "value": 53
    },
    {
      "profile": "S3",
      "value": 53
    },
    {
      "profile": "S4",
      "value": 53
    },
    {
      "profile": "S5",
      "value": 53
    },
    {
      "profile": "S6",
      "value": 53
    },
    {
      "profile": "S7",
      "value": 53
    }
  ],
  "authority": "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
}
```

## 99. OOF Start MAE

```json
{
  "metric": "startMae",
  "selectedActive": 1.6091082275459374,
  "profiles": [
    {
      "profile": "S0",
      "value": 1.6091082275459374
    },
    {
      "profile": "S1",
      "value": 1.543605190550169
    },
    {
      "profile": "S2",
      "value": 1.6091082275459374
    },
    {
      "profile": "S3",
      "value": 1.6091082275459374
    },
    {
      "profile": "S4",
      "value": 1.6091082275459374
    },
    {
      "profile": "S5",
      "value": 1.6091082275459374
    },
    {
      "profile": "S6",
      "value": 1.6091082275459374
    },
    {
      "profile": "S7",
      "value": 1.6091082275459374
    }
  ],
  "authority": "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
}
```

## 100. OOF End MAE

```json
{
  "metric": "endMae",
  "selectedActive": 1.6078355157481543,
  "profiles": [
    {
      "profile": "S0",
      "value": 1.6078355157481543
    },
    {
      "profile": "S1",
      "value": 1.559781589513644
    },
    {
      "profile": "S2",
      "value": 1.6078355157481543
    },
    {
      "profile": "S3",
      "value": 1.6078355157481543
    },
    {
      "profile": "S4",
      "value": 1.6078355157481543
    },
    {
      "profile": "S5",
      "value": 1.6078355157481543
    },
    {
      "profile": "S6",
      "value": 1.6078355157481543
    },
    {
      "profile": "S7",
      "value": 1.6078355157481543
    }
  ],
  "authority": "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
}
```

## 101. OOF P95

```json
{
  "metric": "boundaryP95",
  "selectedActive": 5.384999999999991,
  "profiles": [
    {
      "profile": "S0",
      "value": 5.384999999999991
    },
    {
      "profile": "S1",
      "value": 5.384999999999991
    },
    {
      "profile": "S2",
      "value": 5.384999999999991
    },
    {
      "profile": "S3",
      "value": 5.384999999999991
    },
    {
      "profile": "S4",
      "value": 5.384999999999991
    },
    {
      "profile": "S5",
      "value": 5.384999999999991
    },
    {
      "profile": "S6",
      "value": 5.384999999999991
    },
    {
      "profile": "S7",
      "value": 5.384999999999991
    }
  ],
  "authority": "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
}
```

## 102. OOF IoU

```json
{
  "metric": "medianIoU",
  "selectedActive": 0.5824665676077242,
  "profiles": [
    {
      "profile": "S0",
      "value": 0.5824665676077242
    },
    {
      "profile": "S1",
      "value": 0.5824665676077242
    },
    {
      "profile": "S2",
      "value": 0.5824665676077242
    },
    {
      "profile": "S3",
      "value": 0.5824665676077242
    },
    {
      "profile": "S4",
      "value": 0.5824665676077242
    },
    {
      "profile": "S5",
      "value": 0.5824665676077242
    },
    {
      "profile": "S6",
      "value": 0.5824665676077242
    },
    {
      "profile": "S7",
      "value": 0.5824665676077242
    }
  ],
  "authority": "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
}
```

## 103. OOF Overlap

```json
{
  "metric": "overlap",
  "selectedActive": 37,
  "profiles": [
    {
      "profile": "S0",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S1",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S2",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S3",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S4",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S5",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S6",
      "value": 37,
      "allPairOverlap": 48
    },
    {
      "profile": "S7",
      "value": 37,
      "allPairOverlap": 48
    }
  ],
  "authority": "旧全片匹配诊断；canonical timing完全不变，因此不是声学时间修复。"
}
```

## 104. Provider Switch Distribution

```json
{
  "active": {
    "REAZON": 4,
    "WHISPER": 2
  },
  "legacyS1": {
    "REAZON": 87,
    "WHISPER": 12
  }
}
```

## 105. Whisper Proposal Improvements

```json
7
```

## 106. Whisper Proposal Regressions

```json
14
```

## 107. Reazon Proposal Improvements

```json
14
```

## 108. Reazon Proposal Regressions

```json
17
```

## 109. Length Bias

```json
{
  "improved": {
    "known": 21,
    "unknown": 0,
    "mean": 0.7283306689613405,
    "minimum": 0.16666666666666666,
    "maximum": 1.8333333333333333
  },
  "regressed": {
    "known": 31,
    "unknown": 0,
    "mean": 0.9387503644866899,
    "minimum": 0.14285714285714285,
    "maximum": 3.75
  },
  "allProposals": {
    "known": 141,
    "unknown": 58,
    "mean": 0.8669372188879515,
    "minimum": 0.07142857142857142,
    "maximum": 3.75
  },
  "interpretation": "proposal层描述性相关；更短可能删幻觉，也可能删真对白，不据长度单独判好坏。"
}
```

## 110. Improved Length Ratio

```json
{
  "known": 21,
  "unknown": 0,
  "mean": 0.7283306689613405,
  "minimum": 0.16666666666666666,
  "maximum": 1.8333333333333333
}
```

## 111. Regressed Length Ratio

```json
{
  "known": 31,
  "unknown": 0,
  "mean": 0.9387503644866899,
  "minimum": 0.14285714285714285,
  "maximum": 3.75
}
```

## 112. Strong Contraction Count

```json
48
```

## 113. Strong Contraction Improvements

```json
10
```

## 114. Strong Contraction Regressions

```json
13
```

## 115. Catastrophic Deletion Regressions

```json
3
```

## 116. CTC Support Utility

```json
{
  "useful": 2,
  "harmful": 1,
  "interpretation": "DIRECTION_VS_COUNTERFACTUAL_ASSOCIATION_NOT_CAUSAL_PROOF"
}
```

## 117. CTC Veto Utility

```json
{
  "useful": 4,
  "harmful": 3,
  "interpretation": "DIRECTION_VS_COUNTERFACTUAL_ASSOCIATION_NOT_CAUSAL_PROOF"
}
```

## 118. Correlation-control Utility

```json
{
  "correlationAudit": "d9fbbace50f82edbc5fa5f17e893c8e486e50f9138830d62123a5d2681a4547a",
  "reconciledSameCoreSplitGroupCount": 0,
  "diagnosticCandidateAgreement": {
    "H0:DIFFERENT_FROM_H2": 67,
    "H0:SAME_AS_H2": 132,
    "H1:DIFFERENT_FROM_H2": 66,
    "H1:SAME_AS_H2": 133,
    "H2:SAME_AS_H2": 199
  },
  "causalUtility": "UNKNOWN：没有将同候选、同Gate仅替换correlation一项的独立Gold对照，不能把总差异归因于单因素。"
}
```

## 119. Hierarchical MBR Utility

```json
{
  "profiles": [
    {
      "profile": "S1",
      "actualSelected": 99,
      "wrong": 20,
      "fixedGain": 13
    },
    {
      "profile": "S2",
      "actualSelected": 6,
      "wrong": 3,
      "fixedGain": -12
    },
    {
      "profile": "S3",
      "actualSelected": 5,
      "wrong": 3,
      "fixedGain": -9
    }
  ],
  "oracleCeiling": {
    "commonExactGroups": 38,
    "proposalGain": 62,
    "candidateGain": 134,
    "missedCandidateGain": 72,
    "ratio": 0.4626865671641791
  },
  "causalClaim": false
}
```

## 120. Proposal Generator Errors

```json
{
  "regressingFrozenProposals": 31,
  "unit": "PROPOSAL_COUNTERFACTUAL",
  "notUniqueCausalCount": true
}
```

## 121. Gate Errors

```json
3
```

## 122. Provider Weight Errors

```json
{
  "providerOutcomes": [
    {
      "provider": "WHISPER",
      "proposals": 62,
      "outcomes": {
        "SWITCH_IMPROVES": 7,
        "SWITCH_NEUTRAL": 11,
        "SWITCH_REGRESSES": 14,
        "SWITCH_UNEVALUABLE": 30
      }
    },
    {
      "provider": "REAZON",
      "proposals": 79,
      "outcomes": {
        "SWITCH_IMPROVES": 14,
        "SWITCH_NEUTRAL": 13,
        "SWITCH_REGRESSES": 17,
        "SWITCH_UNEVALUABLE": 35
      }
    }
  ],
  "causalProviderWeightErrorCount": "UNKNOWN：来源分布和回退相关不能证明provider权重是唯一原因。"
}
```

## 123. Contraction Errors

```json
3
```

## 124. Edge/Completeness Errors

```json
{
  "WRONG_SWITCH_WITH_UNSUPPORTED_DELETION_RISK": 3
}
```

## 125. Unknown Attribution

```json
{
  "unavailableLabels": 123,
  "attributionAvailable": true,
  "limitations": [
    "CASE_OUTCOMES_ARE_FROZEN_SINGLE_PROPOSAL_COUNTERFACTUALS_NOT_ADDITIVE_GROUP_GAINS",
    "ACTUAL_APPLIED_COUNTS_REQUIRE_EXPLICIT_RENDERER_EVENT_RECEIPTS",
    "RISK_STRATA_OVERLAP_AND_MUST_NOT_BE_SUMMED",
    "CTC_ABLATION_CAN_CHANGE_TRAINING_AND_THRESHOLDS_NOT_UNIQUE_CTC_CAUSATION",
    "UNMATCHED_CANDIDATE_LABEL_IS_UNKNOWN_NOT_NEUTRAL",
    "KNOWN_BENCHMARK_ONLY_NO_UNSEEN_GENERALIZATION_CLAIM"
  ]
}
```

## 126. Review Suggestion Sidecar

```json
{
  "artifact": "machine-c6-1-1-selective-mbr-review-suggestions",
  "semanticHash": "828e1d699370b72334d3e0f0dff4b95e2feef15558d77bca020c6994333e3805",
  "rowCount": 199,
  "profile": "S6",
  "usage": "REVIEW_ASSISTANCE_ONLY",
  "humanApprovalRequired": true,
  "scoreAuthority": "BENCHMARK_OOF_TRAIN_LABEL_DERIVED_NOT_BLIND_NEW_MODEL"
}
```

## 127. Review Workspace Compatibility

```json
{
  "regression": [
    {
      "name": "targeted",
      "exitCode": 0,
      "passed": 1008,
      "skipped": 1,
      "failed": 0,
      "durationMs": 48500,
      "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
    }
  ],
  "requirement": "C6.0.1.12 Review build/serve/session/correction/human apply仍属独立回归；未逐子项记录时不能单靠targeted总数宣称每项覆盖。"
}
```

## 128. Novel Legal Path Application Count

```json
0
```

## 129. Expected Novel Application Count = 0

```json
{
  "expected": 0,
  "observed": 0,
  "contract": "STRICT_SCHEMA_REQUIRES_ZERO_NOVEL_APPLICATIONS"
}
```

## 130. Production Text Mutation

```json
0
```

## 131. Production Timing Mutation

```json
{
  "productionTimingMutation": 0,
  "allShadowTimingParity": true,
  "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
}
```

## 132. Production ASS Parity

```json
{
  "productionUnchanged": true,
  "files": [
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].ass",
      "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7",
      "size": 15311
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.ass",
      "sha256": "a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03",
      "size": 15311
    }
  ]
}
```

## 133. Production SRT Parity

```json
{
  "productionUnchanged": true,
  "files": [
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.srt",
      "sha256": "4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01",
      "size": 11956
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].srt",
      "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd",
      "size": 11956
    }
  ]
}
```

## 134. Production VTT Parity

```json
{
  "productionUnchanged": true,
  "files": [
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.vtt",
      "sha256": "249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7",
      "size": 19530
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].vtt",
      "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a",
      "size": 19530
    }
  ]
}
```

## 135. OOF Shadow ASS

```json
[
  {
    "profile": "S0",
    "files": [
      {
        "relativePath": "s0/subtitle.c6-1-s0-shadow.ass",
        "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7",
        "size": 15311
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S1",
    "files": [
      {
        "relativePath": "s1/subtitle.c6-1-s1-shadow.ass",
        "sha256": "0c6e44829386db9c5f84ebc044c1a49e85d8ed2d9e37de26515eb6a8fb16c1a0",
        "size": 14421
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S2",
    "files": [
      {
        "relativePath": "s2/subtitle.c6-1-s2-shadow.ass",
        "sha256": "8036e6155018ce3cc0bb86b9606e15e07cbad6c3a7afb6bc404d431e4f5f83bb",
        "size": 15254
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S3",
    "files": [
      {
        "relativePath": "s3/subtitle.c6-1-s3-shadow.ass",
        "sha256": "1fef418cdfd25ed904036838bd0ed876421ae10c439131cee46c6b62e2a497d6",
        "size": 15300
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S4",
    "files": [
      {
        "relativePath": "s4/subtitle.c6-1-s4-shadow.ass",
        "sha256": "fd54b384ad9c3e52f602a8989d40b8321125607587b16276917c8c5c03c772ad",
        "size": 15288
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S5",
    "files": [
      {
        "relativePath": "s5/subtitle.c6-1-s5-shadow.ass",
        "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7",
        "size": 15311
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S6",
    "files": [
      {
        "relativePath": "s6/subtitle.c6-1-s6-shadow.ass",
        "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7",
        "size": 15311
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S7",
    "files": [
      {
        "relativePath": "s7/subtitle.c6-1-s7-shadow.ass",
        "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7",
        "size": 15311
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  }
]
```

## 136. OOF Shadow SRT

```json
[
  {
    "profile": "S0",
    "files": [
      {
        "relativePath": "s0/subtitle.c6-1-s0-shadow.srt",
        "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd",
        "size": 11956
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S1",
    "files": [
      {
        "relativePath": "s1/subtitle.c6-1-s1-shadow.srt",
        "sha256": "ce34cf1126bcc8d279a8be8fa8f0b7855291ca648d13e3bd83e1d871aac744ae",
        "size": 11070
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S2",
    "files": [
      {
        "relativePath": "s2/subtitle.c6-1-s2-shadow.srt",
        "sha256": "54dd5b1485490f9e1e4f7d9d105e804ce769ddd97cfaa7570fc23db2d0516b08",
        "size": 11900
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S3",
    "files": [
      {
        "relativePath": "s3/subtitle.c6-1-s3-shadow.srt",
        "sha256": "878d322d877056e1397f15f1279115337cafa65437376478a37fe520c7e974e4",
        "size": 11945
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S4",
    "files": [
      {
        "relativePath": "s4/subtitle.c6-1-s4-shadow.srt",
        "sha256": "5b568c27de1a29012be43524102d81ace2adfe2bfc0762048b636b2fcb6d3a06",
        "size": 11933
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S5",
    "files": [
      {
        "relativePath": "s5/subtitle.c6-1-s5-shadow.srt",
        "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd",
        "size": 11956
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S6",
    "files": [
      {
        "relativePath": "s6/subtitle.c6-1-s6-shadow.srt",
        "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd",
        "size": 11956
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S7",
    "files": [
      {
        "relativePath": "s7/subtitle.c6-1-s7-shadow.srt",
        "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd",
        "size": 11956
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  }
]
```

## 137. OOF Shadow VTT

```json
[
  {
    "profile": "S0",
    "files": [
      {
        "relativePath": "s0/subtitle.c6-1-s0-shadow.vtt",
        "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a",
        "size": 19530
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S1",
    "files": [
      {
        "relativePath": "s1/subtitle.c6-1-s1-shadow.vtt",
        "sha256": "418793eb65c8c1b8ca79d8972374742d6903ed7787dd0c5c857f90da5600c94f",
        "size": 18644
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S2",
    "files": [
      {
        "relativePath": "s2/subtitle.c6-1-s2-shadow.vtt",
        "sha256": "f4e65faf95ca703d170dbf27c6d9069d3515c84034ed45e7061fc3e8233d526d",
        "size": 19474
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S3",
    "files": [
      {
        "relativePath": "s3/subtitle.c6-1-s3-shadow.vtt",
        "sha256": "338990e4bfa6794daf7df993d091846942133713a5290bb6c4f44d0c9fe3f916",
        "size": 19519
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S4",
    "files": [
      {
        "relativePath": "s4/subtitle.c6-1-s4-shadow.vtt",
        "sha256": "53de8a77205fcac1b2342ab44aa9e74b667efc71d92c0aa5d0cef4975d3d1f49",
        "size": 19507
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S5",
    "files": [
      {
        "relativePath": "s5/subtitle.c6-1-s5-shadow.vtt",
        "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a",
        "size": 19530
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S6",
    "files": [
      {
        "relativePath": "s6/subtitle.c6-1-s6-shadow.vtt",
        "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a",
        "size": 19530
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  },
  {
    "profile": "S7",
    "files": [
      {
        "relativePath": "s7/subtitle.c6-1-s7-shadow.vtt",
        "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a",
        "size": 19530
      }
    ],
    "role": "RESEARCH_SHADOW_ONLY"
  }
]
```

## 138. A/B Reproducibility

```json
{
  "readArtifacts": [
    {
      "artifact": "c6-1-1-baseline",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "78fb1057a5e020690ecf0089514349c0f3f8009f9f349e8501038e11dd220beb",
      "sha256": "6bff449c472ffb98c68cfa2ae67f518d157268a503d66538d38757f4dc506be5"
    },
    {
      "artifact": "c6-1-1-machine-feature-freeze",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "72e8ba96f1d26b1b142d785e10d9c47ec1a507dee216517b6d744818c71a804d",
      "sha256": "7870c08a70e0729580660235a91661c8cc431d15784466de5d4bfe3b02b70306"
    },
    {
      "artifact": "c6-1-1-policy-freeze",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
      "sha256": "899876ec6d948f051d63b2a1b864af4c957ca7b911e3ebac1cba313085bbf917"
    },
    {
      "artifact": "c6-1-1-calibration-policy",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "fbcb6772158e56a3f54490785bdc3df4cc3b5e856cf62bae620554a85c938509",
      "sha256": "1e260353bd256ea51ebec853ace40ac4426dd368870e60378ecc37917c237b27"
    },
    {
      "artifact": "c6-1-1-calibration-folds",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc",
      "sha256": "9d82010859345bcdee1af5bbaf98da8c7eca0f61c472986a527b9c1175d7d35d"
    },
    {
      "artifact": "machine-selective-existing-candidate-proposals",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c",
      "sha256": "cfebb567ded94e7e51f134d0e88d6d147f3b2f32905cf071f7fb5c2b1fd36bad"
    },
    {
      "artifact": "machine-selective-mbr-features",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
      "sha256": "f4fc3fe8abcb4062288a0032076a88942de3a714e1548657f0811d673e1d1063"
    },
    {
      "artifact": "machine-existing-candidate-completeness-risk",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "702db2161f395ea41f4907bab8ce4d3025bdc2aa4054c948ce04f7da82279995",
      "sha256": "47a7bc51d8c1d251ae7ef71895327dd98a004c9be446288d511e9eae3b83f0ed"
    },
    {
      "artifact": "machine-c6-1-1-candidate-correlation-audit",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "d9fbbace50f82edbc5fa5f17e893c8e486e50f9138830d62123a5d2681a4547a",
      "sha256": "4ecc3f7dc68169e6c4490bcb9c1ddc73ad7296bfdd9764dfcb8ad58f27a687ba"
    },
    {
      "artifact": "machine-c6-1-1-hierarchical-correlation-groups",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "21105f9c7457688746ac533cb927013bd5fb7d56af0c51b952af4baf6361a2b7",
      "sha256": "26c24886c563dc2ec6d5774e5e1efef5af11afaeb52385fae54ba879c7bccc36"
    },
    {
      "artifact": "machine-existing-candidate-mbr-risk-ledger",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "8f605ec2d8e24c25abc05897a1da33f7d761e9e26188a3bb8da3f87c9cf6d353",
      "sha256": "2da48cdf4c005d5dd1a458f8682f464c11e7819a8375093e4bad212e2428bec5"
    },
    {
      "artifact": "c6-1-1-legacy-p6-control",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "216585b4d879300172740557bc0f6f49558371eb119803bea4ca03237610716b",
      "sha256": "96b4ee6864ca9c42ab42728314ff75ff303bb71eb8a03fdb109d7214500d9ade"
    },
    {
      "artifact": "c6-1-1-fixed-baseline-alignment-map",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "62149d7673e829687bcb7af404dc87f4b70ec0ab51269dee531d61bae603841b",
      "sha256": "449f907669751ac666ac2c85f5df45cab3c3ca45ca8af677762145ecac584bcc"
    },
    {
      "artifact": "gold-selective-existing-candidate-labels",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "1bb80f38bc3294b075dc6f80e24a6a05fdcc16eef48d20c4c87e883da6d8b73b",
      "sha256": "95fac663f1dae6e82718664071d2bdbd454cd4c7edf0dc88cc380fd0fc0d4e29"
    },
    {
      "artifact": "gold-legacy-p6-labels",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "a85eabe6ef9cabc418998c1ba4968efdaf6ea90e56c6348cde2d869ef7ab6280",
      "sha256": "7291d2c931c3e3e34e32ba918926e9135ed555e2eeca3fd2375b2212dc78b0b7"
    },
    {
      "artifact": "c6-1-1-out-of-fold-selective-decisions",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "8d8db60e1dae4d503e3c72412e5ec7b9be896ea7a4adef41edc1b0786d8aac78",
      "sha256": "dc4f5c754f363f4ef7a9d2b335be412872f1f5a4f1de1ab0e029a5110e7e83b6"
    },
    {
      "artifact": "c6-1-1-selective-profile-results",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "5ae2eaf2ab70b5c0518ee5485456e9f5c1d89ee60b83fa6dffbb5b858308b89d",
      "sha256": "5751f0e7e5957436244de8eac4c6be034b974e4d0175b7e43b1a04f6fcc6fdd5"
    },
    {
      "artifact": "c6-1-1-grouped-existing-candidate-oracles",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "30edd8a23bbf77b680378ed26d3dae73acd806a58ff743ab340eb8230dfea763",
      "sha256": "196b23e91e03c23915300e311149a41e05b1bd988a0dd5aba02c7e7863b5953d"
    },
    {
      "artifact": "c6-1-1-shadow-manifest",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "727361b514672dc6d9d2942f3d3b4c3e3f0f811276f6635e142e69faa84cfa43",
      "sha256": "8af56b8a3bbfe8f5ad844dd1b56c94c72c6b1ed1dda3594433f5f7ae51a218ba"
    },
    {
      "artifact": "c6-1-1-route-decision",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03",
      "sha256": "a701385041571838eb352b52ca5983afae409bf8ffea740e0c6aa4252cf31ba2"
    },
    {
      "artifact": "c6-1-1-selective-mbr-freeze",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "2eeb7c854b36054f7a6e7ccc2b23ab10491532573ecaa0d4e291df3ed42515aa",
      "sha256": "98883ada3479dcd493cf8b4033b46437d5aefb6934dba6254f3668fdff8647b4"
    },
    {
      "artifact": "c6-1-1-read-only-proof",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "5ae6fe83926889cd9aebedb7e2754991fabe86d5bdbb738ab49c7f7d2fe2f6f2",
      "sha256": "e3d62d8f563059f3a99e056db6faec90946b697f8558f8bfedebb09c7a1f3cd6"
    },
    {
      "artifact": "c6-1-1-selective-mbr-error-attribution",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "caabc4fd02ead91a5522f16f05469ae24adb6aa58cacd121cd119921a6b4a9f2",
      "sha256": "04c2b17a69381f5702af512fe7482b6e4d47bcb778d1521f75697ff250fd26a8"
    },
    {
      "artifact": "machine-c6-1-1-selective-mbr-review-suggestions",
      "semanticParity": true,
      "byteParity": true,
      "semanticHash": "828e1d699370b72334d3e0f0dff4b95e2feef15558d77bca020c6994333e3805",
      "sha256": "4a23505f7d2ae559e30b876126055c65d661de693a1ea321c1178d888bc85915"
    }
  ],
  "allReadArtifactSemanticAndByteParity": true,
  "validatorMachine": true,
  "validatorEvaluation": true,
  "validatorOutput": true
}
```

## 139. Fixed Coverage Gate

```json
[
  {
    "profile": "S0",
    "coverage": null,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S1",
    "coverage": 0.6538461538461539,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S2",
    "coverage": 0.75,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S3",
    "coverage": 0.6,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S4",
    "coverage": 0.6,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S5",
    "coverage": null,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S6",
    "coverage": null,
    "strong": false,
    "promising": false
  },
  {
    "profile": "S7",
    "coverage": null,
    "strong": false,
    "promising": false
  }
]
```

## 140. Strong Support Gate

```json
{
  "strongProfiles": [],
  "activeProfile": {
    "profileId": "S2",
    "activeCandidate": true,
    "minimumEvaluableSelected": 5,
    "fixedChangedGroupCoverage": 0.75,
    "jointNormalizedGain": -12,
    "jointExactGain": -8,
    "negativeActiveFoldCount": 0,
    "unknownActiveFoldCount": 1,
    "strongPassed": false,
    "promisingPassed": false,
    "strongChecks": [
      {
        "code": "ENGINEERING_VALID",
        "passed": true,
        "observed": "true",
        "expected": "true"
      },
      {
        "code": "SELECTIVE_PROFILE_ONLY",
        "passed": true,
        "observed": "S2",
        "expected": "S2-S7, never null or legacy control"
      },
      {
        "code": "FIXED_CHANGED_GROUP_COVERAGE",
        "passed": false,
        "observed": "0.75",
        "expected": ">=0.8"
      },
      {
        "code": "MINIMUM_EVALUABLE_SELECTION",
        "passed": true,
        "observed": "5",
        "expected": ">=5"
      },
      {
        "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
        "passed": false,
        "observed": "-12",
        "expected": ">0; never proposal counterfactual sum"
      },
      {
        "code": "MATERIAL_NON_REGRESSION",
        "passed": false,
        "observed": "80",
        "expected": "<=77"
      },
      {
        "code": "ZERO_WRONG_SWITCHES",
        "passed": false,
        "observed": "3",
        "expected": "0"
      },
      {
        "code": "ZERO_CATASTROPHIC_DELETION",
        "passed": false,
        "observed": "3",
        "expected": "0"
      },
      {
        "code": "NORMALIZED_CER_IMPROVES",
        "passed": false,
        "observed": "0.60400390625",
        "expected": "<0.6015625"
      },
      {
        "code": "HALLUCINATION_NON_REGRESSION",
        "passed": true,
        "observed": "1",
        "expected": "<=1"
      },
      {
        "code": "MISSING_NON_REGRESSION",
        "passed": true,
        "observed": "6",
        "expected": "<=6"
      },
      {
        "code": "COVERAGE_NON_REGRESSION",
        "passed": true,
        "observed": "0.96484375",
        "expected": ">=0.96484375"
      },
      {
        "code": "NO_NEGATIVE_ACTIVE_FOLD",
        "passed": true,
        "observed": "0",
        "expected": "0"
      },
      {
        "code": "ACTIVE_FOLD_GAIN_KNOWN",
        "passed": false,
        "observed": "1",
        "expected": "0 unknown active fold gains"
      }
    ],
    "promisingChecks": [
      {
        "code": "ENGINEERING_VALID",
        "passed": true,
        "observed": "true",
        "expected": "true"
      },
      {
        "code": "SELECTIVE_PROFILE_ONLY",
        "passed": true,
        "observed": "S2",
        "expected": "S2-S7, never null or legacy control"
      },
      {
        "code": "FIXED_CHANGED_GROUP_COVERAGE",
        "passed": false,
        "observed": "0.75",
        "expected": ">=0.8"
      },
      {
        "code": "MINIMUM_EVALUABLE_SELECTION",
        "passed": true,
        "observed": "5",
        "expected": ">=5"
      },
      {
        "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
        "passed": false,
        "observed": "-12",
        "expected": ">0; never proposal counterfactual sum"
      },
      {
        "code": "MATERIAL_NON_REGRESSION",
        "passed": false,
        "observed": "80",
        "expected": "<=77"
      },
      {
        "code": "PROMISING_PRECISION",
        "passed": false,
        "observed": "0.2",
        "expected": ">=0.85"
      },
      {
        "code": "PROMISING_HARM",
        "passed": false,
        "observed": "0.6",
        "expected": "<=0.1"
      }
    ]
  },
  "gate": {
    "minimumFixedCoverage": 0.8,
    "minimumSelected": 5,
    "minimumSelectedFraction": 0.05,
    "maximumWrong": 0,
    "maximumCatastrophicDeletion": 0,
    "requirePositiveGain": true,
    "requireBaselineQualityNonRegression": true,
    "maximumNegativeActiveFolds": 0
  }
}
```

## 141. Promising Gate

```json
{
  "promisingProfiles": [],
  "gate": {
    "minimumFixedCoverage": 0.8,
    "minimumPrecision": 0.85,
    "maximumHarm": 0.1,
    "maximumMaterialErrorIncrease": 0
  }
}
```

## 142. Route Decision

```json
{
  "schemaVersion": "1.0.0",
  "policyVersion": "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
  "semanticHash": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03",
  "artifactType": "c6-1-1-route-decision",
  "policyHash": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
  "baselineHash": "78fb1057a5e020690ecf0089514349c0f3f8009f9f349e8501038e11dd220beb",
  "evidenceHash": "9ad42eb7ffcd8c7a33f7e1415f6fcfeb30a5a2f7e9eaf7bc7ffd627ec4234b9d",
  "outcome": "SELECTIVE_MBR_NOT_SUPPORTED",
  "nextRoute": "STOP_AUTOMATIC_CONSENSUS_DECODER_EXPANSION",
  "engineeringPassed": true,
  "engineeringChecks": [
    {
      "code": "FROZEN_POLICY_HASH",
      "passed": true,
      "observed": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
      "expected": "valid self hash"
    },
    {
      "code": "ALL_EIGHT_PROFILES_ONCE",
      "passed": true,
      "observed": "[\"S0\",\"S1\",\"S2\",\"S3\",\"S4\",\"S5\",\"S6\",\"S7\"]",
      "expected": "S0-S7 once each"
    },
    {
      "code": "UNIQUE_EXPECTED_FOLDS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "unique frozen fold IDs"
    },
    {
      "code": "baselineReplayPassed",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "fixedMappingValid",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "featureFreezeValid",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "foldFreezeValid",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "goldBarrierValid",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "oofIsolationValid",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "candidateProvenanceValid",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "aBDeterministic",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "productionFilesUnchanged",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "productionTextMutation",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "code": "productionTimingMutation",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "code": "unsupportedTokenCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "code": "unsupportedAdjacencyCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "code": "missingProvenanceCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "code": "novelApplicationCount",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "code": "sourceReadOnly",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "goldReadOnly",
      "passed": true,
      "observed": "true",
      "expected": "true"
    },
    {
      "code": "S0:METRIC_IDENTITY",
      "passed": true,
      "observed": "c907f6f4ffac0f4a0637b4fdb7f03bd1b9f194b026fddafa12251fa968fcd429",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S0:COUNTS",
      "passed": true,
      "observed": "0",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S0:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[0,0]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S0:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S0:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S0:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S1:METRIC_IDENTITY",
      "passed": true,
      "observed": "3c8ff1b0264389ee97e6d539657afd9aacde4bff5eb0d6872df3f097322b4424",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S1:COUNTS",
      "passed": true,
      "observed": "54",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S1:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[34,52]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S1:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S1:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":17,\"evaluableSelectedCount\":12,\"normalizedGain\":null},{\"foldId\":\"outer-2\",\"selectedCount\":12,\"evaluableSelectedCount\":4,\"normalizedGain\":null},{\"foldId\":\"outer-3\",\"selectedCount\":20,\"evaluableSelectedCount\":12,\"normalizedGain\":null},{\"foldId\":\"outer-4\",\"selectedCount\":27,\"evaluableSelectedCount\":17,\"normalizedGain\":null},{\"foldId\":\"outer-5\",\"selectedCount\":23,\"evaluableSelectedCount\":9,\"normalizedGain\":null}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S1:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S2:METRIC_IDENTITY",
      "passed": true,
      "observed": "415554eedda227ae57cbefe18471040dda131ba27fc5431f03ba6794ca076121",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S2:COUNTS",
      "passed": true,
      "observed": "5",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S2:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[3,4]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S2:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S2:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":6,\"evaluableSelectedCount\":5,\"normalizedGain\":null},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S2:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S3:METRIC_IDENTITY",
      "passed": true,
      "observed": "a555e8bbd4943f08b1470f9468ef080c5e7465409fd2e8433319ae6b140720bd",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S3:COUNTS",
      "passed": true,
      "observed": "3",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S3:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[3,5]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S3:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S3:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":5,\"evaluableSelectedCount\":3,\"normalizedGain\":null},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S3:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S4:METRIC_IDENTITY",
      "passed": true,
      "observed": "8c13899b2456f937c3f5bc78eef3aa2880ca927753a9d3546685c9053402e675",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S4:COUNTS",
      "passed": true,
      "observed": "4",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S4:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[3,5]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S4:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S4:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":6,\"evaluableSelectedCount\":4,\"normalizedGain\":null},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S4:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S5:METRIC_IDENTITY",
      "passed": true,
      "observed": "b0ff4fa21558f4e76e6bbb0b1c77a94dc3cdc68126bfbd2e2c1d4f5aa329ebf3",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S5:COUNTS",
      "passed": true,
      "observed": "0",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S5:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[0,0]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S5:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S5:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S5:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S6:METRIC_IDENTITY",
      "passed": true,
      "observed": "c40a9e6b5691d2da87e253b08d1027b3c2c6ebd0e12eaa6a14b203ef7129cf54",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S6:COUNTS",
      "passed": true,
      "observed": "0",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S6:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[0,0]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S6:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S6:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S6:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "code": "S7:METRIC_IDENTITY",
      "passed": true,
      "observed": "1954aefe7bfc4c3ce2aaace4dd15b33798b82b99373f53fe9ad707a2f6d7e545",
      "expected": "valid pooled profile metrics identity"
    },
    {
      "code": "S7:COUNTS",
      "passed": true,
      "observed": "0",
      "expected": "consistent unique proposal outcome counts"
    },
    {
      "code": "S7:CHANGED_GROUP_COUNTS",
      "passed": true,
      "observed": "[0,0]",
      "expected": "mapped <= changed"
    },
    {
      "code": "S7:FOLD_COMPLETENESS",
      "passed": true,
      "observed": "[\"outer-1\",\"outer-2\",\"outer-3\",\"outer-4\",\"outer-5\"]",
      "expected": "all and only frozen folds"
    },
    {
      "code": "S7:FOLD_SELECTION_COUNTS",
      "passed": true,
      "observed": "[{\"foldId\":\"outer-1\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-2\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-3\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-4\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0},{\"foldId\":\"outer-5\",\"selectedCount\":0,\"evaluableSelectedCount\":0,\"normalizedGain\":0}]",
      "expected": "fold selection counts conserve pooled selection"
    },
    {
      "code": "S7:CUE_COUNT_PARITY",
      "passed": true,
      "observed": "161",
      "expected": "161"
    }
  ],
  "profiles": [
    {
      "profileId": "S0",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": null,
      "jointNormalizedGain": 0,
      "jointExactGain": 0,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 0,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": false,
          "observed": "S0",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.6015625",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": true,
          "observed": "0",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": false,
          "observed": "S0",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "null",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "null",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S1",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": 0.6538461538461539,
      "jointNormalizedGain": 13,
      "jointExactGain": 34,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 5,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": false,
          "observed": "S1",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.6538461538461539",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": true,
          "observed": "54",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": true,
          "observed": "13",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "78",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": false,
          "observed": "20",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": false,
          "observed": "9",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": true,
          "observed": "0.58251953125",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "0",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": false,
          "observed": "5",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": false,
          "observed": "S1",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.6538461538461539",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": true,
          "observed": "54",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": true,
          "observed": "13",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "78",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "0.4074074074074074",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "0.37037037037037035",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S2",
      "activeCandidate": true,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": 0.75,
      "jointNormalizedGain": -12,
      "jointExactGain": -8,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 1,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S2",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.75",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": true,
          "observed": "5",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "-12",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "80",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": false,
          "observed": "3",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": false,
          "observed": "3",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.60400390625",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": false,
          "observed": "1",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S2",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.75",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": true,
          "observed": "5",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "-12",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "80",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "0.2",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "0.6",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S3",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": 0.6,
      "jointNormalizedGain": -9,
      "jointExactGain": -11,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 1,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S3",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.6",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "3",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "-9",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "78",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": false,
          "observed": "3",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": false,
          "observed": "3",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.60400390625",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": false,
          "observed": "1",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S3",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.6",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "3",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "-9",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "78",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "0",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "1",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S4",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": 0.6,
      "jointNormalizedGain": -12,
      "jointExactGain": -12,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 1,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S4",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.6",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "4",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "-12",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "79",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": false,
          "observed": "4",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": false,
          "observed": "4",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.60546875",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": false,
          "observed": "1",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S4",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "0.6",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "4",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "-12",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": false,
          "observed": "79",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "0",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "1",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S5",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": null,
      "jointNormalizedGain": 0,
      "jointExactGain": 0,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 0,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S5",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.6015625",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": true,
          "observed": "0",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S5",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "null",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "null",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S6",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": null,
      "jointNormalizedGain": 0,
      "jointExactGain": 0,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 0,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S6",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.6015625",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": true,
          "observed": "0",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S6",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "null",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "null",
          "expected": "<=0.1"
        }
      ]
    },
    {
      "profileId": "S7",
      "activeCandidate": false,
      "minimumEvaluableSelected": 5,
      "fixedChangedGroupCoverage": null,
      "jointNormalizedGain": 0,
      "jointExactGain": 0,
      "negativeActiveFoldCount": 0,
      "unknownActiveFoldCount": 0,
      "strongPassed": false,
      "promisingPassed": false,
      "strongChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S7",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "ZERO_WRONG_SWITCHES",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ZERO_CATASTROPHIC_DELETION",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "NORMALIZED_CER_IMPROVES",
          "passed": false,
          "observed": "0.6015625",
          "expected": "<0.6015625"
        },
        {
          "code": "HALLUCINATION_NON_REGRESSION",
          "passed": true,
          "observed": "1",
          "expected": "<=1"
        },
        {
          "code": "MISSING_NON_REGRESSION",
          "passed": true,
          "observed": "6",
          "expected": "<=6"
        },
        {
          "code": "COVERAGE_NON_REGRESSION",
          "passed": true,
          "observed": "0.96484375",
          "expected": ">=0.96484375"
        },
        {
          "code": "NO_NEGATIVE_ACTIVE_FOLD",
          "passed": true,
          "observed": "0",
          "expected": "0"
        },
        {
          "code": "ACTIVE_FOLD_GAIN_KNOWN",
          "passed": true,
          "observed": "0",
          "expected": "0 unknown active fold gains"
        }
      ],
      "promisingChecks": [
        {
          "code": "ENGINEERING_VALID",
          "passed": true,
          "observed": "true",
          "expected": "true"
        },
        {
          "code": "SELECTIVE_PROFILE_ONLY",
          "passed": true,
          "observed": "S7",
          "expected": "S2-S7, never null or legacy control"
        },
        {
          "code": "FIXED_CHANGED_GROUP_COVERAGE",
          "passed": false,
          "observed": "null",
          "expected": ">=0.8"
        },
        {
          "code": "MINIMUM_EVALUABLE_SELECTION",
          "passed": false,
          "observed": "0",
          "expected": ">=5"
        },
        {
          "code": "POSITIVE_JOINT_UNIQUE_GROUP_GAIN",
          "passed": false,
          "observed": "0",
          "expected": ">0; never proposal counterfactual sum"
        },
        {
          "code": "MATERIAL_NON_REGRESSION",
          "passed": true,
          "observed": "77",
          "expected": "<=77"
        },
        {
          "code": "PROMISING_PRECISION",
          "passed": false,
          "observed": "null",
          "expected": ">=0.85"
        },
        {
          "code": "PROMISING_HARM",
          "passed": false,
          "observed": "null",
          "expected": "<=0.1"
        }
      ]
    }
  ],
  "selectedProfile": null,
  "strongProfiles": [],
  "promisingProfiles": [],
  "futureModelTrainingAuthorized": false,
  "reasons": [
    "SELECTIVE_MBR_NOT_SUPPORTED",
    "OOF_JOINT_GROUP_AUTHORITY",
    "KNOWN_BENCHMARK_ONLY",
    "PRODUCTION_REMAINS_FROZEN"
  ],
  "benchmarkStatus": "KNOWN_DEVELOPMENT_BENCHMARK_CALIBRATION_FEASIBILITY_NOT_UNSEEN_VALIDATION",
  "metricAuthority": "ACTUAL_JOINT_SHADOW_UNIQUE_FIXED_GROUP_GAIN_NOT_PROPOSAL_SUM",
  "productionStatus": "needs-review",
  "finalizationMethod": "none",
  "machineOnlyReleaseAuthorized": false,
  "c602Status": "HOLD"
}
```

## 143. Frozen Model Created?

```json
{
  "status": "UNAVAILABLE",
  "created": false,
  "profileId": null,
  "modelHash": null,
  "threshold": null,
  "reason": "ROUTE_GATE_NOT_PASSED_NO_FULL_DATA_MODEL_CREATED",
  "restriction": "POST_EVALUATION_EXPLORATORY_FUTURE_PROSPECTIVE_SHADOW_ONLY",
  "noOofMetricsRewritten": true
}
```

## 144. C6.1.2 Recommendation

STOP_AUTOMATIC_CONSENSUS_DECODER_EXPANSION

## 145. C6.0.2 Status

HOLD；无论研究工程验收或校准结果如何，C6.0.2未授权。

## 146. Production Status

```json
{
  "productionStatus": "needs-review",
  "finalizationMethod": "none"
}
```

## 147. Machine Release Authorized

```json
false
```

## 148. Runtime Gold Input

```json
{
  "machine": 0,
  "proposal": 0,
  "feature": 0,
  "postFreezeEvaluation": "Gold仅在固定评价/训练折校准可见，不是机器推理输入。"
}
```

## 149. Dataset Hardcoding

```json
{
  "rawTextFeatureCount": 0,
  "datasetSpecificFeatureCount": 0,
  "validatorChecks": [],
  "limitation": "编译/运行扫描证据与字段计数分开；没有扫描记录不宣称仓库级零硬编码。"
}
```

## 150. Network

```json
{
  "machineNetworkUsed": false,
  "acceptanceProofNetworkUsed": false,
  "freshAsrInferences": 0
}
```

## 151. Source Read-only

```json
{
  "sourceReadOnly": true,
  "before": {
    "size": 847774958,
    "mtimeMs": 1784692412273.1868,
    "sha256": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43"
  },
  "after": {
    "size": 847774958,
    "mtimeMs": 1784692412273.1868,
    "sha256": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43"
  },
  "reportReopenedRawSource": false
}
```

## 152. Gold Read-only

```json
{
  "goldReadOnly": true,
  "before": {
    "size": 17094,
    "mtimeMs": 1787570451152.2112,
    "sha256": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e"
  },
  "after": {
    "size": 17094,
    "mtimeMs": 1787570451152.2112,
    "sha256": "a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e"
  },
  "reportReopenedRawGold": false
}
```

## 153. Shareable Audit

```json
{
  "validatorChecks": [],
  "reportPolicy": "仅指标/ID/hash/相对产物名；不输出Gold文本、候选文本、源音视频或私有绝对路径。没有外部shareable检查时不冒称全产物扫描通过。"
}
```

## 154. C5.19 Regression

```json
[
  {
    "name": "targeted",
    "exitCode": 0,
    "passed": 1008,
    "skipped": 1,
    "failed": 0,
    "durationMs": 48500,
    "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
  }
]
```

## 155. C6 Investigation Regression

```json
[
  {
    "name": "targeted",
    "exitCode": 0,
    "passed": 1008,
    "skipped": 1,
    "failed": 0,
    "durationMs": 48500,
    "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
  }
]
```

## 156. C6 Protected Regression

```json
[
  {
    "name": "targeted",
    "exitCode": 0,
    "passed": 1008,
    "skipped": 1,
    "failed": 0,
    "durationMs": 48500,
    "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
  }
]
```

## 157. C6.0.1–C6.0.1.12 Regressions

```json
[
  {
    "name": "targeted",
    "exitCode": 0,
    "passed": 1008,
    "skipped": 1,
    "failed": 0,
    "durationMs": 48500,
    "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
  }
]
```

## 158. C6.1 Regression

```json
[
  {
    "name": "targeted",
    "exitCode": 0,
    "passed": 1008,
    "skipped": 1,
    "failed": 0,
    "durationMs": 48500,
    "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
  }
]
```

## 159. Unit Tests

```json
[
  {
    "name": "unit",
    "exitCode": 0,
    "passed": 1133,
    "skipped": 2,
    "failed": 0,
    "durationMs": 58454,
    "logSha256": "d0a74eb0aa8467ec711cdc9860520b82d07585f6a62e7cf7b968b432ca5de9b0"
  }
]
```

## 160. E2E Tests

```json
[
  {
    "name": "e2e",
    "exitCode": 0,
    "passed": 49,
    "skipped": 1,
    "failed": 0,
    "durationMs": 12887,
    "logSha256": "a1b0c54f11b36bb776eab8ba865e51effe82c9e5387e098318db60a811baf7ab"
  }
]
```

## 161. Targeted Tests

```json
[
  {
    "name": "targeted",
    "exitCode": 0,
    "passed": 1008,
    "skipped": 1,
    "failed": 0,
    "durationMs": 48500,
    "logSha256": "b0311297d4b57937ce1c47429b5f7f4a318116242ecf56275e4c3110f3688cca"
  }
]
```

## 162. Schema Count

```json
{
  "registeredC611Schemas": 28,
  "generatedSchemas": 371,
  "validatedInstances": 86,
  "generation": [
    {
      "name": "generate:schemas",
      "exitCode": 0,
      "passed": null,
      "skipped": null,
      "failed": null,
      "durationMs": 1979,
      "logSha256": "5707702fe48c92c32b557d3ed1f9d4ec3181cd7247db700676108e0f274bd14a"
    }
  ]
}
```

## 163. Skill Validation

```json
[
  {
    "name": "skill",
    "exitCode": 0,
    "passed": null,
    "skipped": null,
    "failed": null,
    "durationMs": 78,
    "logSha256": "ea18e0c9df7dcc72c5f7051458866f76a9009122396aa8bf8e6260adf35798a4"
  }
]
```

## 164. Skill2/3

```json
true
```

## 165. Remaining Risks

```json
{
  "benchmark": "已知开发基准，不是unseen验证",
  "groupCoverage": 0.6885245901639344,
  "crossFoldGroups": 0,
  "oracleIncomplete": [
    {
      "groupId": "c611-group-21bcaf103f39e743f3ec",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-3cc32e5a94821d1c2f3d",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-f8e9a6be64b7b4c83816",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-3a631d6fbf7279e3eac4",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-4ddd55a1a6820bca94b3",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-bfc02e1b11fd47840ea7",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-c2de891d661745cbeb09",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-8434d2748c5234945ef8",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-5d49af954ef3084eaba3",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-c8d1a5b04767311a2856",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-475f6284e481d185d05d",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-be9d160c676044046a6e",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-d04fac4f96e92bc24bbb",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-a73cb5754f8d7e891d53",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-fa17955776542ca3cdf7",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-d5f06761c47601ae4d5b",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-fe6f437fbabda8f54f07",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-10fcedd15a5cedab2b75",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-e3d7408ccfc8c1c8707a",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-90205ade3fb8a1ac495d",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-26554a03e32a8b09a22a",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-ade2d1f1ce7c275faeb6",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    },
    {
      "groupId": "c611-group-7c43932447c40de8e01a",
      "proposal": "UNEVALUABLE",
      "existing": "UNEVALUABLE"
    }
  ],
  "activeWrong": 3,
  "activeNeutral": 1,
  "missingEvidence": false,
  "timingClaimAllowed": false
}
```

## 166. Commits

Git 检查点说明：前 5 个源码提交已推送；`carnation-c6-1-1-validation-20260831/git-source-receipt.json` 记录的检查时刻为 `2026-08-30T16:43:22.973Z`，local/remote HEAD 均为 `20f31f340297865d657d6ac99646b826f5a0e665`，`remoteVerified=true`、`worktreeClean=false`。这是源码交付检查点，不是包含本报告的最终验收提交。本报告生成/补充时工作区仍 dirty；第 6 个验收提交自身 SHA 无法自包含。最终 acceptance SHA、推送后 remote HEAD 和 clean 状态，以后续独立的 `carnation-c6-1-1-validation-20260831/git-delivery-receipt.json` 及最终回复为准；本段不预先声称该最终回执已经存在或验证通过。

```json
{
  "sourceCommits": {
    "fixedAlignment": "5ace4cfd1a8fb78a7205c500861faf77bf3e9fde",
    "hierarchical": "889630ac2850cdc01cc0e57a8a55cea974f7bf2f",
    "preservation": "4058b734074a42e8a2cb41a24314a453b6f073ad",
    "calibration": "a05c07a0fea87dfc9ac578d95a49529f49d27a34",
    "shadow": "20f31f340297865d657d6ac99646b826f5a0e665"
  },
  "acceptanceCommit": "文档无法自包含其未来提交SHA；最终回复/独立Git交付回执给出。"
}
```

## 167. Remote HEAD

20f31f340297865d657d6ac99646b826f5a0e665

上述为已核实的 5 个源码提交检查点 HEAD；最终第 6 个验收提交的 remote HEAD 见 §166 所述后续独立交付回执。

## 168. Output Paths

```json
{
  "finalA": "carnation-c6-1-1-final-a-20260831",
  "finalB": "carnation-c6-1-1-final-b-20260831",
  "machine": "<final-A-or-B>/machine/",
  "evaluation": "<final-A-or-B>/evaluation/",
  "shadow": "<final-A-or-B>/shadow/s0–s7/",
  "validation": "acceptance",
  "regression": "c6-1-1-regression-evidence.json",
  "report": "docs/C6_1_1_FIXED_ALIGNMENT_SELECTIVE_EXISTING_MBR_REPORT.md"
}
```

## 附录 A：最终回复 1–150 项完整清单

| #   | 最终交付字段                            | 结果 / 证据边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Branch                                  | codex/c6-1-1-fixed-alignment-selective-existing-mbr                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | Baseline                                | 2e9dbf4c909afd159e3aabc3ac876180cbd188ef                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Fixed Alignment Commit                  | 5ace4cfd1a8fb78a7205c500861faf77bf3e9fde                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | Hierarchical MBR Commit                 | 889630ac2850cdc01cc0e57a8a55cea974f7bf2f                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | Preservation/Risk Commit                | 4058b734074a42e8a2cb41a24314a453b6f073ad                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | Calibration Commit                      | a05c07a0fea87dfc9ac578d95a49529f49d27a34                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7   | Shadow/Evaluation Commit                | 20f31f340297865d657d6ac99646b826f5a0e665                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | Acceptance Commit                       | UNKNOWN：未提供对应Git交付回执；验收文档不自包含自身未来SHA。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9   | Remote HEAD                             | 20f31f340297865d657d6ac99646b826f5a0e665                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | Policy Version                          | c6.1.1-fixed-alignment-selective-existing-mbr-v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | Policy Hash                             | 05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 12  | C6.1 Replay Passed                      | true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Baseline Machine Cue Count              | 161                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | Canonical Event Count                   | 199                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 15  | Multi-hypothesis Event Count            | 182                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 16  | Input Candidate Count                   | 1496                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 17  | Included Real ASR Candidate Count       | 671                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 18  | Whisper Candidate Count                 | 446                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 19  | Reazon Candidate Count                  | 225                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 20  | Legacy Event-level Evaluable Count      | 38/199 总体可评价；其中 changed∩evaluable=17，旧 changed coverage=17/99                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 21  | Baseline Cue Group Count                | 61                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 22  | Changed Cue Group Count                 | {"legacyS1":52,"active":4}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 23  | Fixed One-to-one Mappings               | 11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 24  | Fixed One-to-many Mappings              | 11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 25  | Fixed Many-to-one Mappings              | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 26  | Fixed Many-to-many Mappings             | 19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 27  | Ambiguous Mappings                      | 15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 28  | No Mappings                             | 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 29  | Structure-incompatible Mappings         | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 30  | Fixed Changed-group Evaluation Coverage | {"legacyS1":0.6538461538461539,"active":0.75}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 31  | Evaluation Coverage Gate Passed         | false                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 32  | Legacy P6 Changed Events                | 99                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 33  | Fixed-evaluable P6 Changed Groups       | 34                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 34  | Fixed P6 Improved                       | 14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 35  | Fixed P6 Regressed                      | 14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 36  | Fixed P6 Neutral                        | changed-only 6；全部可评价固定组 neutral=14，包含 8 个未修改组                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 37  | Fixed P6 Net Edit Gain                  | 13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 38  | Legacy Correlation Group Count          | {"legacyAsr":551,"legacyIncludingCurrent":712,"hierarchical":610}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 39  | Legacy Singleton Group Count            | {"legacyAsr":433,"legacyIncludingCurrent":594,"hierarchical":549}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 40  | Legacy Singleton Rate                   | {"legacyAsr":0.7858439201451906,"legacyIncludingCurrent":0.8342696629213483,"hierarchical":0.9}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 41  | Hierarchical Correlation Group Count    | 610                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 42  | Hierarchical Singleton Count            | 549                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 43  | Same-audio Split Groups Reconciled      | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 44  | Correlation Audit Passed                | {"hashVerified":true,"includedAsrAccounted":true,"unknownCoreIdentity":465}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 45  | Eligible Proposal Events                | 141                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 46  | Proposed Alternative Count              | 141                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 47  | Proposed Whisper Count                  | 62                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 48  | Proposed Reazon Count                   | 79                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 49  | Structurally Blocked Proposal Count     | 56                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 50  | Raw MBR Positive-margin Count           | 86                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 51  | Hierarchical MBR Positive-margin Count  | 105                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 52  | Strong Contraction Proposal Count       | 48                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 53  | Edge-truncation Proposal Count          | 0 detected / 141 eligible unknown；不是已证实无风险                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 54  | Incomplete-speech Proposal Count        | 0 detected / 141 eligible unknown；不是已证实无风险                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 55  | Feature Count                           | 30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 56  | Raw-text Feature Count                  | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 57  | Gold Feature Count                      | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 58  | Dataset-specific Feature Count          | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 59  | Feature Freeze Before Gold              | true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 60  | SWITCH_IMPROVES Labels                  | 21                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 61  | SWITCH_REGRESSES Labels                 | 31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 62  | SWITCH_NEUTRAL Labels                   | 24                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 63  | SWITCH_UNEVALUABLE Labels               | 全部 199 行中 123；eligible 141 行中 65；另 58 个非 eligible 记录均 unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 64  | Proposal Oracle Gain                    | {"exactGroups":38,"searchLimitGroups":0,"unevaluableGroups":23,"assemblyErrorGroups":0,"entireFixedMapExact":false,"exactGroupCoverage":0.6229508196721312,"baselineExactError":673,"baselineNormalizedError":533,"bestExactError":607,"bestNormalizedError":471,"exactGain":66,"normalizedGain":62,"goldExactGraphemeCount":1136,"goldNormalizedGraphemeCount":1027,"baselineExactCer":0.5924295774647887,"baselineNormalizedCer":0.5189873417721519,"bestExactCer":0.534330985915493,"bestNormalizedCer":0.45861733203505356,"searchedCombinations":527,"validCombinations":527,"rejectedCombinations":0,"errorAggregation":"UNIQUE_EXACT_FIXED_GROUPS_ONLY"}                                                                                                                                                                                                                                                                                                                                                                                                           |
| 65  | Best Existing Candidate Oracle Gain     | {"exactGroups":38,"searchLimitGroups":0,"unevaluableGroups":23,"assemblyErrorGroups":0,"entireFixedMapExact":false,"exactGroupCoverage":0.6229508196721312,"baselineExactError":673,"baselineNormalizedError":533,"bestExactError":527,"bestNormalizedError":399,"exactGain":146,"normalizedGain":134,"goldExactGraphemeCount":1136,"goldNormalizedGraphemeCount":1027,"baselineExactCer":0.5924295774647887,"baselineNormalizedCer":0.5189873417721519,"bestExactCer":0.4639084507042254,"bestNormalizedCer":0.3885102239532619,"searchedCombinations":10822,"validCombinations":10822,"rejectedCombinations":0,"errorAggregation":"UNIQUE_EXACT_FIXED_GROUPS_ONLY"}                                                                                                                                                                                                                                                                                                                                                                                                     |
| 66  | Proposal Oracle Capture Ceiling         | {"commonExactGroups":38,"proposalGain":62,"candidateGain":134,"missedCandidateGain":72,"ratio":0.4626865671641791}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 67  | Fold Count                              | 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 68  | Folds Frozen Before Labels              | true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 69  | Audio Leakage Count                     | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 70  | Event Leakage Count                     | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 71  | S0 Selected                             | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 72  | S0 Gain                                 | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 73  | S1 Selected                             | 99                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 74  | S1 Correct                              | 22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 75  | S1 Wrong                                | 20                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 76  | S1 Gain                                 | 13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 77  | S2 Selected                             | 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 78  | S2 Correct                              | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 79  | S2 Wrong                                | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 80  | S2 Gain                                 | -12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 81  | S3 Selected                             | 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 82  | S3 Correct                              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 83  | S3 Wrong                                | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 84  | S3 Gain                                 | -9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 85  | S4 Selected                             | 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 86  | S4 Correct                              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 87  | S4 Wrong                                | 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 88  | S4 Gain                                 | -12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 89  | S5 Selected                             | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 90  | S5 Correct                              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 91  | S5 Wrong                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 92  | S5 Gain                                 | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 93  | S6 Selected                             | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 94  | S6 Correct                              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 95  | S6 Wrong                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 96  | S6 Gain                                 | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 97  | S7 Selected                             | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 98  | S7 Correct                              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 99  | S7 Wrong                                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 100 | S7 Gain                                 | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 101 | Best Active Profile                     | S2，仅 OOF 描述性比较；route.selectedProfile=null，未获支持                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 102 | OOF Selected Count                      | 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 103 | OOF Correct Switches                    | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 104 | OOF Wrong Switches                      | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 105 | OOF Neutral Switches                    | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 106 | OOF Abstentions                         | 115 显式 ABSTAIN_REVIEW；另有 22 KEEP_CURRENT、56 BLOCKED_STRUCTURAL、6 SELECT，合计 199                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 107 | OOF Precision                           | 0.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 108 | OOF Wilson Lower                        | 0.03622410863243014                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 109 | OOF Wilson Upper                        | 0.6244653702374747                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 110 | OOF Harm Rate                           | 0.6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 111 | OOF Selective Coverage                  | 0.06578947368421052                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 112 | OOF Exact Edit Gain                     | -8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 113 | OOF Normalized Edit Gain                | -12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 114 | Proposal Oracle Capture                 | {"numeratorUniqueGroupGain":-12,"denominatorExactOracleGain":62,"rate":-0.1935483870967742,"groupCount":38,"denominatorAuthority":"SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 115 | Candidate Oracle Capture                | {"numeratorUniqueGroupGain":-12,"denominatorExactOracleGain":134,"rate":-0.08955223880597014,"groupCount":38,"denominatorAuthority":"SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 116 | Negative-gain Fold Count                | 0 已知负收益 active folds / 1 unknown active fold；其余 4 folds 零选择，不能证明全部 fold 非负                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 117 | Catastrophic Deletion Regression Count  | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 118 | OOF Exact CER                           | 0.6614173228346457                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 119 | OOF Normalized CER                      | 0.60400390625                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 120 | OOF Coverage                            | 0.96484375                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 121 | OOF Missing                             | 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 122 | OOF Hallucination                       | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 123 | OOF Material Errors                     | 80                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 124 | OOF Severe Timing                       | 53                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 125 | OOF Start MAE                           | 1.6091082275459374                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 126 | OOF End MAE                             | 1.6078355157481543                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 127 | OOF P95                                 | 5.384999999999991                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 128 | OOF IoU                                 | 0.5824665676077242                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 129 | OOF Overlap                             | {"adjacentPairLegacyMetric":37,"allOverlapPairs":48,"timingUnchanged":true}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 130 | Selected Whisper Count                  | 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 131 | Selected Reazon Count                   | 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 132 | Mean Improved Length Ratio              | 0.7283306689613405                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 133 | Mean Regressed Length Ratio             | 0.9387503644866899                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 134 | CTC Useful Support Count                | 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 135 | CTC Harmful Support Count               | 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 136 | Correlation-control Utility             | {"correlationAudit":"d9fbbace50f82edbc5fa5f17e893c8e486e50f9138830d62123a5d2681a4547a","reconciledSameCoreSplitGroupCount":0,"diagnosticCandidateAgreement":{"H0:DIFFERENT_FROM_H2":67,"H0:SAME_AS_H2":132,"H1:DIFFERENT_FROM_H2":66,"H1:SAME_AS_H2":133,"H2:SAME_AS_H2":199},"causalUtility":"UNKNOWN：没有将同候选、同Gate仅替换correlation一项的独立Gold对照，不能把总差异归因于单因素。"}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 137 | Proposal Generator Error Count          | 31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 138 | Selection Gate Error Count              | 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 139 | Novel Legal Path Application Count      | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 140 | Production Text Mutation                | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 141 | Production Timing Mutation              | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 142 | Production ASS/SRT/VTT Parity           | {"proof":true,"assFiles":2,"srtFiles":2,"vttFiles":2}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 143 | A/B Parity                              | {"reportReadArtifacts":true,"validationMachine":true,"evaluation":true,"output":true}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 144 | Strong Support Gate                     | []                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 145 | Promising Gate                          | []                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 146 | Route Decision                          | SELECTIVE_MBR_NOT_SUPPORTED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 147 | C6.1.2 GO/HOLD                          | STOP_AUTOMATIC_CONSENSUS_DECODER_EXPANSION                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 148 | C6.0.2 GO/HOLD                          | HOLD                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 149 | Tests / Report / Output Paths           | {"checks":[{"name":"generate:schemas","exitCode":0,"passed":null,"skipped":null,"failed":null},{"name":"typecheck","exitCode":0,"passed":null,"skipped":null,"failed":null},{"name":"lint","exitCode":0,"passed":null,"skipped":null,"failed":null},{"name":"format:check","exitCode":0,"passed":null,"skipped":null,"failed":null},{"name":"build","exitCode":0,"passed":null,"skipped":null,"failed":null},{"name":"unit","exitCode":0,"passed":1133,"skipped":2,"failed":0},{"name":"e2e","exitCode":0,"passed":49,"skipped":1,"failed":0},{"name":"targeted","exitCode":0,"passed":1008,"skipped":1,"failed":0},{"name":"skill","exitCode":0,"passed":null,"skipped":null,"failed":null}],"paths":{"finalA":"carnation-c6-1-1-final-a-20260831","finalB":"carnation-c6-1-1-final-b-20260831","machine":"<final-A-or-B>/machine/","evaluation":"<final-A-or-B>/evaluation/","shadow":"<final-A-or-B>/shadow/s0–s7/","validation":"acceptance","regression":"c6-1-1-regression-evidence.json","report":"docs/C6_1_1_FIXED_ALIGNMENT_SELECTIVE_EXISTING_MBR_REPORT.md"}} |
| 150 | Worktree Status                         | 源码检查点及报告生成时 dirty（false）；最终第 6 个验收提交后的 clean 状态以独立 git-delivery-receipt.json 和最终回复为准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 附录 B：Q1–Q20

### Q1

旧口径在全部 199 events 中有 38 可评价；99 changed events（94 changed cues）与可评价集合的真实交集为 17，所以旧 changed event coverage=17/99=17.17%，不是 38/99。新固定图稳定映射 42/61 groups=68.85%；S1 changed-only 为 34/52=65.38%；描述性 S2 为 3/4=75%。Event、全图固定组和 changed-only 固定组的分母不同，不能直接相减或宣称同单位同比提高；交集来源与字节哈希见总览补充。

### Q2

旧38只代表具备可用event→Gold匹配的子集，不代表其余无错误。本次P0建立一次mapping 78e7220141a1f41258000a668d3c4613f99961919a5f16e926807f0b06a891c3，全部profile复用，profileRematchingAllowed=false。本报告不为旧38伪造未保存的细分阻塞原因。

### Q3

S1 复现旧 P6 后，52 个 changed-only 固定组中 improved=14、regressed=14、neutral=6、unevaluable=18；可评价比例为 34/52=65.38%。全部 61 个固定组的原始汇总仍为 14/14/14/19，其中 neutral=14 包含 8 个未修改组，unknown=19 包含 1 个未修改组。normalized joint gain=+13；独立 legacy proposal 层的 22/20/12（54 可评价、45 unknown）是另一计数单位，不与固定组结果混用。

### Q4

旧 changed-only 结果为 8 improved / 6 regressed / 3 neutral / 82 unknown，以 99 个 changed events 为分母；总体 neutral=24 另含 21 个未修改 events。新 changed-only 为 14/14/6/18，以 52 个固定 cue groups 为分母。新评价明确揭示局部回退，不能用较低全片 CER 掩盖；由于 event 与 fixed-group 单位不同，不能把 14 对 6 直接解读为真实回退风险的低估倍数。

### Q5

S1实际应用Provider分布 {"REAZON":87,"WHISPER":12}；H2 eligible proposal分布 {"REAZON":79,"WHISPER":62}。选择占比与各provider错误分层是偏置诊断，不等同于证明某provider天然优越。

### Q6

Legacy ASR-only groups=551, singleton=433, rate=0.7858439201451906；包括CURRENT的旧组数=712, singleton rate=0.8342696629213483。同core重合并=0；未知core=465，不能补造。

### Q7

H2 Proposal Oracle {"exactGroups":38,"searchLimitGroups":0,"unevaluableGroups":23,"assemblyErrorGroups":0,"entireFixedMapExact":false,"exactGroupCoverage":0.6229508196721312,"baselineExactError":673,"baselineNormalizedError":533,"bestExactError":607,"bestNormalizedError":471,"exactGain":66,"normalizedGain":62,"goldExactGraphemeCount":1136,"goldNormalizedGraphemeCount":1027,"baselineExactCer":0.5924295774647887,"baselineNormalizedCer":0.5189873417721519,"bestExactCer":0.534330985915493,"bestNormalizedCer":0.45861733203505356,"searchedCombinations":527,"validCombinations":527,"rejectedCombinations":0,"errorAggregation":"UNIQUE_EXACT_FIXED_GROUPS_ONLY"}；与best-existing共同精确组差额 {"commonExactGroups":38,"proposalGain":62,"candidateGain":134,"missedCandidateGain":72,"ratio":0.4626865671641791}。S1/S2/S3的实际切换与收益见§119。没有同Gate仅换correlation的独立对照时，孤立的hierarchical因果增益为UNKNOWN。

### Q8

改善proposal长度比 {"known":21,"unknown":0,"mean":0.7283306689613405,"minimum":0.16666666666666666,"maximum":1.8333333333333333}；回退proposal长度比 {"known":31,"unknown":0,"mean":0.9387503644866899,"minimum":0.14285714285714285,"maximum":3.75}。强收缩结果 {"SWITCH_IMPROVES":10,"SWITCH_NEUTRAL":2,"SWITCH_REGRESSES":13,"SWITCH_UNEVALUABLE":23}。描述缩短倾向，不把更短一概判错或判好。

### Q9

S1–S4实际切换/错误/联合收益：[{"profile":"S1","selected":99,"wrong":20,"gain":13},{"profile":"S2","selected":6,"wrong":3,"gain":-12},{"profile":"S3","selected":5,"wrong":3,"gain":-9},{"profile":"S4","selected":6,"wrong":4,"gain":-12}]。样本有限且多个策略因素不同，不作统计显著性或唯一因果声明。

### Q10

S4–S6 catastrophic deletion：[{"profile":"S4","catastrophic":4,"wrong":4},{"profile":"S5","catastrophic":0,"wrong":0},{"profile":"S6","catastrophic":0,"wrong":0}]。计数来自预冻结删除风险+评价标签；不是人工证实全部删除内容为真实对白。

### Q11

冻结 alternatives=141，eligible=141；这一 eligible 子集的 Gold 后验 improve/regress/neutral/unevaluable=21/31/24/65。全部账本为 199 行，标签为 21/31/24/123；多出的 58 unknown 来自 56 个结构阻塞和 2 个无替代候选记录，不属于 eligible alternatives。未知保持未知。

### Q12

共同精确固定组上的Proposal与Best Existing Oracle：{"commonExactGroups":38,"proposalGain":62,"candidateGain":134,"missedCandidateGain":72,"ratio":0.4626865671641791}。Active capture：proposal={"numeratorUniqueGroupGain":-12,"denominatorExactOracleGain":62,"rate":-0.1935483870967742,"groupCount":38,"denominatorAuthority":"SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY"}，candidate={"numeratorUniqueGroupGain":-12,"denominatorExactOracleGain":134,"rate":-0.08955223880597014,"groupCount":38,"denominatorAuthority":"SAME_EXACT_ORACLE_FIXED_GROUPS_ONLY"}。余量同时区分候选生成未覆盖和Gate未捕获；组搜索未知时不宣称完整上限。

### Q13

记录的描述性最佳 Active Profile=S2，实际应用=6，请求=6，renderer blocked=0；但 `route.selectedProfile=null`，Strong/Promising profiles 均为空。S2 达到选择数门槛不代表质量通过，正式路由仍为 SELECTIVE_MBR_NOT_SUPPORTED。

### Q14

correct/wrong/neutral=1/3/1，selected unevaluable=1。

### Q15

precision=0.2，harm=0.6，selective coverage=0.06578947368421052，联合normalized gain=-12，Wilson={"lower":0.03622410863243014,"upper":0.6244653702374747,"confidenceLevel":0.95,"n":5}。联合收益不是单proposal反事实收益之和。

其中 selective coverage=5/76，仅在 76 个可评价 eligible proposals 上计数；6/141=4.26% 是全部 eligible 的选择比例。S2 决策账本为 6 SELECT、22 KEEP_CURRENT（含 2 个无 alternative）、56 BLOCKED_STRUCTURAL、115 ABSTAIN_REVIEW，总计 199。outer-1 的 6 个选择含 1 个 unknown，所以该 fold gain=null；0 个已知负收益 folds 不能替代对 unknown fold 的证明。

### Q16

Active全片 material=80（P0=77）；hallucination=1, missing=6, coverage=0.96484375。实际gate检查=[{"code":"FIXED_CHANGED_GROUP_COVERAGE","passed":false,"observed":"0.75","expected":">=0.8"},{"code":"MATERIAL_NON_REGRESSION","passed":false,"observed":"80","expected":"<=77"},{"code":"HALLUCINATION_NON_REGRESSION","passed":true,"observed":"1","expected":"<=1"},{"code":"MISSING_NON_REGRESSION","passed":true,"observed":"6","expected":"<=6"},{"code":"COVERAGE_NON_REGRESSION","passed":true,"observed":"0.96484375","expected":">=0.96484375"}]。

### Q17

CTC方向与proposal后验的关联：有效支持=2、有效否决=4、错误支持=1、错误否决=3。已知方向=27, unknown=172。这四项不是CTC独立因果效应；S6/S5配对变化={"comparison":"S6_VS_S5_PAIRED_PROFILE_ABLATION","available":true,"pairedCaseCount":199,"selectionChangedCount":0,"ctcKnownSelectionChangedCount":0,"ctcUnknownSelectionChangedCount":0,"switchedOn":{"caseCount":0,"requestedSwitchCount":0,"requestedCorrectCount":0,"requestedWrongCount":0,"requestedNeutralCount":0,"requestedUnknownCount":0,"actualAppliedCount":0,"actualAppliedCorrectCount":0,"actualAppliedWrongCount":0,"actualAppliedNeutralCount":0,"actualAppliedUnknownCount":0,"rendererBlockedCount":0,"applicationUnknownCount":0,"notSelectedImprovingProposalCount":0},"switchedOff":{"caseCount":0,"requestedSwitchCount":0,"requestedCorrectCount":0,"requestedWrongCount":0,"requestedNeutralCount":0,"requestedUnknownCount":0,"actualAppliedCount":0,"actualAppliedCorrectCount":0,"actualAppliedWrongCount":0,"actualAppliedNeutralCount":0,"actualAppliedUnknownCount":0,"rendererBlockedCount":0,"applicationUnknownCount":0,"notSelectedImprovingProposalCount":0},"changedSelectedCandidateCount":0,"uniquelyCausedByCtcClaim":false}。

27 known / 172 unknown 使用全部 199 行分母；限制在 141 个 eligible proposals 后为 27 known / 114 unknown。S5/S6 都是零选择且 inactive，因此 selectionChangedCount=0 不构成 CTC 提高选择质量的实证。

### Q18

结果=SELECTIVE_MBR_NOT_SUPPORTED；Strong profiles=[]；完整工程证据确认=true。只有路由实际给出SUPPORTED才可用该结论。

这是已知开发基准上的工程验收与校准研究结论，不是未见集盲测或跨集泛化证明。机器候选在本轮 Gold 评价前冻结，不能把这种输入隔离表述成该长期使用基准从未被开发者见过。

### Q19

失败/不足类别以真实route SELECTIVE_MBR_NOT_SUPPORTED及reasons ["SELECTIVE_MBR_NOT_SUPPORTED","OOF_JOINT_GROUP_AUTHORITY","KNOWN_BENCHMARK_ONLY","PRODUCTION_REMAINS_FROZEN"]为准。Proposal剩余上限见Q12；Gate错误与覆盖见Q14/Q15。不把selected=0包装为成功。

### Q20

下一步明确选择：STOP_AUTOMATIC_CONSENSUS_DECODER_EXPANSION。future model created=false；若只有review方向，候选仅作C6.0.1.12人工辅助。即使允许prospective shadow，也不是生产发布或C6.0.2 GO。

## 附录 C：Fold 联合结果

| Fold    | Profile | actual selected | evaluable selected | joint normalized gain    |
| ------- | ------- | --------------- | ------------------ | ------------------------ |
| outer-1 | S0      | 0               | 0                  | 0                        |
| outer-2 | S0      | 0               | 0                  | 0                        |
| outer-3 | S0      | 0               | 0                  | 0                        |
| outer-4 | S0      | 0               | 0                  | 0                        |
| outer-5 | S0      | 0               | 0                  | 0                        |
| outer-1 | S1      | 17              | 12                 | UNKNOWN / NOT_APPLICABLE |
| outer-2 | S1      | 12              | 4                  | UNKNOWN / NOT_APPLICABLE |
| outer-3 | S1      | 20              | 12                 | UNKNOWN / NOT_APPLICABLE |
| outer-4 | S1      | 27              | 17                 | UNKNOWN / NOT_APPLICABLE |
| outer-5 | S1      | 23              | 9                  | UNKNOWN / NOT_APPLICABLE |
| outer-1 | S2      | 6               | 5                  | UNKNOWN / NOT_APPLICABLE |
| outer-2 | S2      | 0               | 0                  | 0                        |
| outer-3 | S2      | 0               | 0                  | 0                        |
| outer-4 | S2      | 0               | 0                  | 0                        |
| outer-5 | S2      | 0               | 0                  | 0                        |
| outer-1 | S3      | 5               | 3                  | UNKNOWN / NOT_APPLICABLE |
| outer-2 | S3      | 0               | 0                  | 0                        |
| outer-3 | S3      | 0               | 0                  | 0                        |
| outer-4 | S3      | 0               | 0                  | 0                        |
| outer-5 | S3      | 0               | 0                  | 0                        |
| outer-1 | S4      | 6               | 4                  | UNKNOWN / NOT_APPLICABLE |
| outer-2 | S4      | 0               | 0                  | 0                        |
| outer-3 | S4      | 0               | 0                  | 0                        |
| outer-4 | S4      | 0               | 0                  | 0                        |
| outer-5 | S4      | 0               | 0                  | 0                        |
| outer-1 | S5      | 0               | 0                  | 0                        |
| outer-2 | S5      | 0               | 0                  | 0                        |
| outer-3 | S5      | 0               | 0                  | 0                        |
| outer-4 | S5      | 0               | 0                  | 0                        |
| outer-5 | S5      | 0               | 0                  | 0                        |
| outer-1 | S6      | 0               | 0                  | 0                        |
| outer-2 | S6      | 0               | 0                  | 0                        |
| outer-3 | S6      | 0               | 0                  | 0                        |
| outer-4 | S6      | 0               | 0                  | 0                        |
| outer-5 | S6      | 0               | 0                  | 0                        |
| outer-1 | S7      | 0               | 0                  | 0                        |
| outer-2 | S7      | 0               | 0                  | 0                        |
| outer-3 | S7      | 0               | 0                  | 0                        |
| outer-4 | S7      | 0               | 0                  | 0                        |
| outer-5 | S7      | 0               | 0                  | 0                        |

## 附录 D：只读与可分享边界

```json
{
  "source": true,
  "gold": true,
  "production": true,
  "runtimeCode": true,
  "validatorRawSourceRechecked": false,
  "validatorRawGoldRechecked": false,
  "authority": "模型运行后记录的前后fingerprint与严格只读证明；报告不重新打开原音视频/Gold。"
}
```

```json
{
  "schemaVersion": "1.0.0",
  "policyVersion": "c6.1.1-fixed-alignment-selective-existing-mbr-v1",
  "semanticHash": "d57ca5e70b58d9770be6f75d9cbe9ddcc30257297cc6b0eac929f349002df1fc",
  "artifactType": "c6-1-1-shareable-summary",
  "privacy": "SANITIZED_AGGREGATES_ONLY",
  "machineFreezeHash": "72e8ba96f1d26b1b142d785e10d9c47ec1a507dee216517b6d744818c71a804d",
  "profileResultsHash": "5ae2eaf2ab70b5c0518ee5485456e9f5c1d89ee60b83fa6dffbb5b858308b89d",
  "routeHash": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03",
  "readOnlyProofHash": "5ae6fe83926889cd9aebedb7e2754991fabe86d5bdbb738ab49c7f7d2fe2f6f2",
  "baseline": {
    "exactCer": 0.6601049868766404,
    "normalizedCer": 0.6015625,
    "coverage": 0.96484375,
    "missing": 6,
    "hallucination": 1,
    "materialErrors": 77,
    "cueCount": 161,
    "severeTiming": 53,
    "startMae": 1.6091082275459374,
    "endMae": 1.6078355157481543,
    "boundaryP95": 5.384999999999991,
    "medianIoU": 0.5824665676077242,
    "overlap": 37
  },
  "profiles": [
    {
      "profileId": "S0",
      "selected": 0,
      "evaluableSelected": 0,
      "correct": 0,
      "wrong": 0,
      "neutral": 0,
      "unknown": 0,
      "precision": null,
      "harm": null,
      "fixedCoverage": null,
      "jointNormalizedGain": 0,
      "metrics": {
        "exactCer": 0.6601049868766404,
        "normalizedCer": 0.6015625,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 77,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S1",
      "selected": 99,
      "evaluableSelected": 54,
      "correct": 22,
      "wrong": 20,
      "neutral": 12,
      "unknown": 45,
      "precision": 0.4074074074074074,
      "harm": 0.37037037037037035,
      "fixedCoverage": 0.6538461538461539,
      "jointNormalizedGain": 13,
      "metrics": {
        "exactCer": 0.626421697287839,
        "normalizedCer": 0.58251953125,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 0,
        "materialErrors": 78,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.543605190550169,
        "endMae": 1.559781589513644,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "00d6dbb5bbc486e82545c3a6804977835a03bd78b5420802057a667d3202c203",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S2",
      "selected": 6,
      "evaluableSelected": 5,
      "correct": 1,
      "wrong": 3,
      "neutral": 1,
      "unknown": 1,
      "precision": 0.2,
      "harm": 0.6,
      "fixedCoverage": 0.75,
      "jointNormalizedGain": -12,
      "metrics": {
        "exactCer": 0.6614173228346457,
        "normalizedCer": 0.60400390625,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 80,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "ac7b0181048a49cef96297b22411037600675b5f46fbcdf8be6eb292d4b82a47",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S3",
      "selected": 5,
      "evaluableSelected": 3,
      "correct": 0,
      "wrong": 3,
      "neutral": 0,
      "unknown": 2,
      "precision": 0,
      "harm": 1,
      "fixedCoverage": 0.6,
      "jointNormalizedGain": -9,
      "metrics": {
        "exactCer": 0.6627296587926509,
        "normalizedCer": 0.60400390625,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 78,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "b8ca5bf1464916ea02d6a72bc48625916763821ed410550eea362b0e73ae872a",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S4",
      "selected": 6,
      "evaluableSelected": 4,
      "correct": 0,
      "wrong": 4,
      "neutral": 0,
      "unknown": 2,
      "precision": 0,
      "harm": 1,
      "fixedCoverage": 0.6,
      "jointNormalizedGain": -12,
      "metrics": {
        "exactCer": 0.663167104111986,
        "normalizedCer": 0.60546875,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 79,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "2645d2d679db95eae3a9e4565bcb82f6b97631299d90853227aa61a4c0dbe72e",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S5",
      "selected": 0,
      "evaluableSelected": 0,
      "correct": 0,
      "wrong": 0,
      "neutral": 0,
      "unknown": 0,
      "precision": null,
      "harm": null,
      "fixedCoverage": null,
      "jointNormalizedGain": 0,
      "metrics": {
        "exactCer": 0.6601049868766404,
        "normalizedCer": 0.6015625,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 77,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S6",
      "selected": 0,
      "evaluableSelected": 0,
      "correct": 0,
      "wrong": 0,
      "neutral": 0,
      "unknown": 0,
      "precision": null,
      "harm": null,
      "fixedCoverage": null,
      "jointNormalizedGain": 0,
      "metrics": {
        "exactCer": 0.6601049868766404,
        "normalizedCer": 0.6015625,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 77,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "profileId": "S7",
      "selected": 0,
      "evaluableSelected": 0,
      "correct": 0,
      "wrong": 0,
      "neutral": 0,
      "unknown": 0,
      "precision": null,
      "harm": null,
      "fixedCoverage": null,
      "jointNormalizedGain": 0,
      "metrics": {
        "exactCer": 0.6601049868766404,
        "normalizedCer": 0.6015625,
        "coverage": 0.96484375,
        "missing": 6,
        "hallucination": 1,
        "materialErrors": 77,
        "cueCount": 161,
        "severeTiming": 53,
        "startMae": 1.6091082275459374,
        "endMae": 1.6078355157481543,
        "boundaryP95": 5.384999999999991,
        "medianIoU": 0.5824665676077242,
        "overlap": 37
      },
      "canonicalTextHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
      "canonicalTimingHash": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    }
  ],
  "route": "SELECTIVE_MBR_NOT_SUPPORTED",
  "frozenModelCreated": false,
  "sourceReadOnly": true,
  "goldReadOnly": true,
  "productionUnchanged": true,
  "rawTextIncluded": false,
  "audioIncluded": false,
  "absolutePathsIncluded": false,
  "freshAsrInferences": 0,
  "freshCtcInferences": 0,
  "networkUsed": false,
  "productionStatus": "needs-review",
  "finalizationMethod": "none",
  "machineOnlyReleaseAuthorized": false,
  "c602Status": "HOLD"
}
```

## 附录 E：报告来源身份

```json
{
  "aArtifacts": [
    {
      "name": "c6-1-1-baseline",
      "relativePath": "machine/c6-1-1-baseline.json",
      "semanticHash": "78fb1057a5e020690ecf0089514349c0f3f8009f9f349e8501038e11dd220beb",
      "sha256": "6bff449c472ffb98c68cfa2ae67f518d157268a503d66538d38757f4dc506be5"
    },
    {
      "name": "c6-1-1-machine-feature-freeze",
      "relativePath": "machine/c6-1-1-machine-feature-freeze.json",
      "semanticHash": "72e8ba96f1d26b1b142d785e10d9c47ec1a507dee216517b6d744818c71a804d",
      "sha256": "7870c08a70e0729580660235a91661c8cc431d15784466de5d4bfe3b02b70306"
    },
    {
      "name": "c6-1-1-policy-freeze",
      "relativePath": "machine/c6-1-1-policy-freeze.json",
      "semanticHash": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
      "sha256": "899876ec6d948f051d63b2a1b864af4c957ca7b911e3ebac1cba313085bbf917"
    },
    {
      "name": "c6-1-1-calibration-policy",
      "relativePath": "machine/c6-1-1-calibration-policy.json",
      "semanticHash": "fbcb6772158e56a3f54490785bdc3df4cc3b5e856cf62bae620554a85c938509",
      "sha256": "1e260353bd256ea51ebec853ace40ac4426dd368870e60378ecc37917c237b27"
    },
    {
      "name": "c6-1-1-calibration-folds",
      "relativePath": "machine/c6-1-1-calibration-folds.json",
      "semanticHash": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc",
      "sha256": "9d82010859345bcdee1af5bbaf98da8c7eca0f61c472986a527b9c1175d7d35d"
    },
    {
      "name": "machine-selective-existing-candidate-proposals",
      "relativePath": "machine/machine-selective-existing-candidate-proposals.json",
      "semanticHash": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c",
      "sha256": "cfebb567ded94e7e51f134d0e88d6d147f3b2f32905cf071f7fb5c2b1fd36bad"
    },
    {
      "name": "machine-selective-mbr-features",
      "relativePath": "machine/machine-selective-mbr-features.json",
      "semanticHash": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
      "sha256": "f4fc3fe8abcb4062288a0032076a88942de3a714e1548657f0811d673e1d1063"
    },
    {
      "name": "machine-existing-candidate-completeness-risk",
      "relativePath": "machine/machine-existing-candidate-completeness-risk.json",
      "semanticHash": "702db2161f395ea41f4907bab8ce4d3025bdc2aa4054c948ce04f7da82279995",
      "sha256": "47a7bc51d8c1d251ae7ef71895327dd98a004c9be446288d511e9eae3b83f0ed"
    },
    {
      "name": "machine-c6-1-1-candidate-correlation-audit",
      "relativePath": "machine/machine-c6-1-1-candidate-correlation-audit.json",
      "semanticHash": "d9fbbace50f82edbc5fa5f17e893c8e486e50f9138830d62123a5d2681a4547a",
      "sha256": "4ecc3f7dc68169e6c4490bcb9c1ddc73ad7296bfdd9764dfcb8ad58f27a687ba"
    },
    {
      "name": "machine-c6-1-1-hierarchical-correlation-groups",
      "relativePath": "machine/machine-c6-1-1-hierarchical-correlation-groups.json",
      "semanticHash": "21105f9c7457688746ac533cb927013bd5fb7d56af0c51b952af4baf6361a2b7",
      "sha256": "26c24886c563dc2ec6d5774e5e1efef5af11afaeb52385fae54ba879c7bccc36"
    },
    {
      "name": "machine-existing-candidate-mbr-risk-ledger",
      "relativePath": "machine/machine-existing-candidate-mbr-risk-ledger.json",
      "semanticHash": "8f605ec2d8e24c25abc05897a1da33f7d761e9e26188a3bb8da3f87c9cf6d353",
      "sha256": "2da48cdf4c005d5dd1a458f8682f464c11e7819a8375093e4bad212e2428bec5"
    },
    {
      "name": "c6-1-1-legacy-p6-control",
      "relativePath": "machine/c6-1-1-legacy-p6-control.json",
      "semanticHash": "216585b4d879300172740557bc0f6f49558371eb119803bea4ca03237610716b",
      "sha256": "96b4ee6864ca9c42ab42728314ff75ff303bb71eb8a03fdb109d7214500d9ade"
    },
    {
      "name": "c6-1-1-fixed-baseline-alignment-map",
      "relativePath": "evaluation/c6-1-1-fixed-baseline-alignment-map.json",
      "semanticHash": "62149d7673e829687bcb7af404dc87f4b70ec0ab51269dee531d61bae603841b",
      "sha256": "449f907669751ac666ac2c85f5df45cab3c3ca45ca8af677762145ecac584bcc"
    },
    {
      "name": "gold-selective-existing-candidate-labels",
      "relativePath": "evaluation/gold-selective-existing-candidate-labels.json",
      "semanticHash": "1bb80f38bc3294b075dc6f80e24a6a05fdcc16eef48d20c4c87e883da6d8b73b",
      "sha256": "95fac663f1dae6e82718664071d2bdbd454cd4c7edf0dc88cc380fd0fc0d4e29"
    },
    {
      "name": "gold-legacy-p6-labels",
      "relativePath": "evaluation/gold-legacy-p6-labels.json",
      "semanticHash": "a85eabe6ef9cabc418998c1ba4968efdaf6ea90e56c6348cde2d869ef7ab6280",
      "sha256": "7291d2c931c3e3e34e32ba918926e9135ed555e2eeca3fd2375b2212dc78b0b7"
    },
    {
      "name": "c6-1-1-out-of-fold-selective-decisions",
      "relativePath": "evaluation/c6-1-1-out-of-fold-selective-decisions.json",
      "semanticHash": "8d8db60e1dae4d503e3c72412e5ec7b9be896ea7a4adef41edc1b0786d8aac78",
      "sha256": "dc4f5c754f363f4ef7a9d2b335be412872f1f5a4f1de1ab0e029a5110e7e83b6"
    },
    {
      "name": "c6-1-1-selective-profile-results",
      "relativePath": "evaluation/c6-1-1-selective-profile-results.json",
      "semanticHash": "5ae2eaf2ab70b5c0518ee5485456e9f5c1d89ee60b83fa6dffbb5b858308b89d",
      "sha256": "5751f0e7e5957436244de8eac4c6be034b974e4d0175b7e43b1a04f6fcc6fdd5"
    },
    {
      "name": "c6-1-1-grouped-existing-candidate-oracles",
      "relativePath": "evaluation/c6-1-1-grouped-existing-candidate-oracles.json",
      "semanticHash": "30edd8a23bbf77b680378ed26d3dae73acd806a58ff743ab340eb8230dfea763",
      "sha256": "196b23e91e03c23915300e311149a41e05b1bd988a0dd5aba02c7e7863b5953d"
    },
    {
      "name": "c6-1-1-shadow-manifest",
      "relativePath": "shadow/c6-1-1-shadow-manifest.json",
      "semanticHash": "727361b514672dc6d9d2942f3d3b4c3e3f0f811276f6635e142e69faa84cfa43",
      "sha256": "8af56b8a3bbfe8f5ad844dd1b56c94c72c6b1ed1dda3594433f5f7ae51a218ba"
    },
    {
      "name": "c6-1-1-route-decision",
      "relativePath": "evaluation/c6-1-1-route-decision.json",
      "semanticHash": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03",
      "sha256": "a701385041571838eb352b52ca5983afae409bf8ffea740e0c6aa4252cf31ba2"
    },
    {
      "name": "c6-1-1-selective-mbr-freeze",
      "relativePath": "evaluation/c6-1-1-selective-mbr-freeze.json",
      "semanticHash": "2eeb7c854b36054f7a6e7ccc2b23ab10491532573ecaa0d4e291df3ed42515aa",
      "sha256": "98883ada3479dcd493cf8b4033b46437d5aefb6934dba6254f3668fdff8647b4"
    },
    {
      "name": "c6-1-1-read-only-proof",
      "relativePath": "evaluation/c6-1-1-read-only-proof.json",
      "semanticHash": "5ae6fe83926889cd9aebedb7e2754991fabe86d5bdbb738ab49c7f7d2fe2f6f2",
      "sha256": "e3d62d8f563059f3a99e056db6faec90946b697f8558f8bfedebb09c7a1f3cd6"
    },
    {
      "name": "c6-1-1-selective-mbr-error-attribution",
      "relativePath": "evaluation/c6-1-1-selective-mbr-error-attribution.json",
      "semanticHash": "caabc4fd02ead91a5522f16f05469ae24adb6aa58cacd121cd119921a6b4a9f2",
      "sha256": "04c2b17a69381f5702af512fe7482b6e4d47bcb778d1521f75697ff250fd26a8"
    },
    {
      "name": "machine-c6-1-1-selective-mbr-review-suggestions",
      "relativePath": "evaluation/machine-c6-1-1-selective-mbr-review-suggestions.json",
      "semanticHash": "828e1d699370b72334d3e0f0dff4b95e2feef15558d77bca020c6994333e3805",
      "sha256": "4a23505f7d2ae559e30b876126055c65d661de693a1ea321c1178d888bc85915"
    },
    {
      "name": "c6-1-1-shareable-summary",
      "relativePath": "shareable/c6-1-1-shareable-summary.json",
      "semanticHash": "d57ca5e70b58d9770be6f75d9cbe9ddcc30257297cc6b0eac929f349002df1fc",
      "sha256": "707de55d6e7a5fbd0ed36116f93483468b8f152501191ea7f2740cd639940603"
    }
  ],
  "bArtifacts": [
    {
      "name": "c6-1-1-baseline",
      "relativePath": "machine/c6-1-1-baseline.json",
      "semanticHash": "78fb1057a5e020690ecf0089514349c0f3f8009f9f349e8501038e11dd220beb",
      "sha256": "6bff449c472ffb98c68cfa2ae67f518d157268a503d66538d38757f4dc506be5"
    },
    {
      "name": "c6-1-1-machine-feature-freeze",
      "relativePath": "machine/c6-1-1-machine-feature-freeze.json",
      "semanticHash": "72e8ba96f1d26b1b142d785e10d9c47ec1a507dee216517b6d744818c71a804d",
      "sha256": "7870c08a70e0729580660235a91661c8cc431d15784466de5d4bfe3b02b70306"
    },
    {
      "name": "c6-1-1-policy-freeze",
      "relativePath": "machine/c6-1-1-policy-freeze.json",
      "semanticHash": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
      "sha256": "899876ec6d948f051d63b2a1b864af4c957ca7b911e3ebac1cba313085bbf917"
    },
    {
      "name": "c6-1-1-calibration-policy",
      "relativePath": "machine/c6-1-1-calibration-policy.json",
      "semanticHash": "fbcb6772158e56a3f54490785bdc3df4cc3b5e856cf62bae620554a85c938509",
      "sha256": "1e260353bd256ea51ebec853ace40ac4426dd368870e60378ecc37917c237b27"
    },
    {
      "name": "c6-1-1-calibration-folds",
      "relativePath": "machine/c6-1-1-calibration-folds.json",
      "semanticHash": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc",
      "sha256": "9d82010859345bcdee1af5bbaf98da8c7eca0f61c472986a527b9c1175d7d35d"
    },
    {
      "name": "machine-selective-existing-candidate-proposals",
      "relativePath": "machine/machine-selective-existing-candidate-proposals.json",
      "semanticHash": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c",
      "sha256": "cfebb567ded94e7e51f134d0e88d6d147f3b2f32905cf071f7fb5c2b1fd36bad"
    },
    {
      "name": "machine-selective-mbr-features",
      "relativePath": "machine/machine-selective-mbr-features.json",
      "semanticHash": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
      "sha256": "f4fc3fe8abcb4062288a0032076a88942de3a714e1548657f0811d673e1d1063"
    },
    {
      "name": "machine-existing-candidate-completeness-risk",
      "relativePath": "machine/machine-existing-candidate-completeness-risk.json",
      "semanticHash": "702db2161f395ea41f4907bab8ce4d3025bdc2aa4054c948ce04f7da82279995",
      "sha256": "47a7bc51d8c1d251ae7ef71895327dd98a004c9be446288d511e9eae3b83f0ed"
    },
    {
      "name": "machine-c6-1-1-candidate-correlation-audit",
      "relativePath": "machine/machine-c6-1-1-candidate-correlation-audit.json",
      "semanticHash": "d9fbbace50f82edbc5fa5f17e893c8e486e50f9138830d62123a5d2681a4547a",
      "sha256": "4ecc3f7dc68169e6c4490bcb9c1ddc73ad7296bfdd9764dfcb8ad58f27a687ba"
    },
    {
      "name": "machine-c6-1-1-hierarchical-correlation-groups",
      "relativePath": "machine/machine-c6-1-1-hierarchical-correlation-groups.json",
      "semanticHash": "21105f9c7457688746ac533cb927013bd5fb7d56af0c51b952af4baf6361a2b7",
      "sha256": "26c24886c563dc2ec6d5774e5e1efef5af11afaeb52385fae54ba879c7bccc36"
    },
    {
      "name": "machine-existing-candidate-mbr-risk-ledger",
      "relativePath": "machine/machine-existing-candidate-mbr-risk-ledger.json",
      "semanticHash": "8f605ec2d8e24c25abc05897a1da33f7d761e9e26188a3bb8da3f87c9cf6d353",
      "sha256": "2da48cdf4c005d5dd1a458f8682f464c11e7819a8375093e4bad212e2428bec5"
    },
    {
      "name": "c6-1-1-legacy-p6-control",
      "relativePath": "machine/c6-1-1-legacy-p6-control.json",
      "semanticHash": "216585b4d879300172740557bc0f6f49558371eb119803bea4ca03237610716b",
      "sha256": "96b4ee6864ca9c42ab42728314ff75ff303bb71eb8a03fdb109d7214500d9ade"
    },
    {
      "name": "c6-1-1-fixed-baseline-alignment-map",
      "relativePath": "evaluation/c6-1-1-fixed-baseline-alignment-map.json",
      "semanticHash": "62149d7673e829687bcb7af404dc87f4b70ec0ab51269dee531d61bae603841b",
      "sha256": "449f907669751ac666ac2c85f5df45cab3c3ca45ca8af677762145ecac584bcc"
    },
    {
      "name": "gold-selective-existing-candidate-labels",
      "relativePath": "evaluation/gold-selective-existing-candidate-labels.json",
      "semanticHash": "1bb80f38bc3294b075dc6f80e24a6a05fdcc16eef48d20c4c87e883da6d8b73b",
      "sha256": "95fac663f1dae6e82718664071d2bdbd454cd4c7edf0dc88cc380fd0fc0d4e29"
    },
    {
      "name": "gold-legacy-p6-labels",
      "relativePath": "evaluation/gold-legacy-p6-labels.json",
      "semanticHash": "a85eabe6ef9cabc418998c1ba4968efdaf6ea90e56c6348cde2d869ef7ab6280",
      "sha256": "7291d2c931c3e3e34e32ba918926e9135ed555e2eeca3fd2375b2212dc78b0b7"
    },
    {
      "name": "c6-1-1-out-of-fold-selective-decisions",
      "relativePath": "evaluation/c6-1-1-out-of-fold-selective-decisions.json",
      "semanticHash": "8d8db60e1dae4d503e3c72412e5ec7b9be896ea7a4adef41edc1b0786d8aac78",
      "sha256": "dc4f5c754f363f4ef7a9d2b335be412872f1f5a4f1de1ab0e029a5110e7e83b6"
    },
    {
      "name": "c6-1-1-selective-profile-results",
      "relativePath": "evaluation/c6-1-1-selective-profile-results.json",
      "semanticHash": "5ae2eaf2ab70b5c0518ee5485456e9f5c1d89ee60b83fa6dffbb5b858308b89d",
      "sha256": "5751f0e7e5957436244de8eac4c6be034b974e4d0175b7e43b1a04f6fcc6fdd5"
    },
    {
      "name": "c6-1-1-grouped-existing-candidate-oracles",
      "relativePath": "evaluation/c6-1-1-grouped-existing-candidate-oracles.json",
      "semanticHash": "30edd8a23bbf77b680378ed26d3dae73acd806a58ff743ab340eb8230dfea763",
      "sha256": "196b23e91e03c23915300e311149a41e05b1bd988a0dd5aba02c7e7863b5953d"
    },
    {
      "name": "c6-1-1-shadow-manifest",
      "relativePath": "shadow/c6-1-1-shadow-manifest.json",
      "semanticHash": "727361b514672dc6d9d2942f3d3b4c3e3f0f811276f6635e142e69faa84cfa43",
      "sha256": "8af56b8a3bbfe8f5ad844dd1b56c94c72c6b1ed1dda3594433f5f7ae51a218ba"
    },
    {
      "name": "c6-1-1-route-decision",
      "relativePath": "evaluation/c6-1-1-route-decision.json",
      "semanticHash": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03",
      "sha256": "a701385041571838eb352b52ca5983afae409bf8ffea740e0c6aa4252cf31ba2"
    },
    {
      "name": "c6-1-1-selective-mbr-freeze",
      "relativePath": "evaluation/c6-1-1-selective-mbr-freeze.json",
      "semanticHash": "2eeb7c854b36054f7a6e7ccc2b23ab10491532573ecaa0d4e291df3ed42515aa",
      "sha256": "98883ada3479dcd493cf8b4033b46437d5aefb6934dba6254f3668fdff8647b4"
    },
    {
      "name": "c6-1-1-read-only-proof",
      "relativePath": "evaluation/c6-1-1-read-only-proof.json",
      "semanticHash": "5ae6fe83926889cd9aebedb7e2754991fabe86d5bdbb738ab49c7f7d2fe2f6f2",
      "sha256": "e3d62d8f563059f3a99e056db6faec90946b697f8558f8bfedebb09c7a1f3cd6"
    },
    {
      "name": "c6-1-1-selective-mbr-error-attribution",
      "relativePath": "evaluation/c6-1-1-selective-mbr-error-attribution.json",
      "semanticHash": "caabc4fd02ead91a5522f16f05469ae24adb6aa58cacd121cd119921a6b4a9f2",
      "sha256": "04c2b17a69381f5702af512fe7482b6e4d47bcb778d1521f75697ff250fd26a8"
    },
    {
      "name": "machine-c6-1-1-selective-mbr-review-suggestions",
      "relativePath": "evaluation/machine-c6-1-1-selective-mbr-review-suggestions.json",
      "semanticHash": "828e1d699370b72334d3e0f0dff4b95e2feef15558d77bca020c6994333e3805",
      "sha256": "4a23505f7d2ae559e30b876126055c65d661de693a1ea321c1178d888bc85915"
    },
    {
      "name": "c6-1-1-shareable-summary",
      "relativePath": "shareable/c6-1-1-shareable-summary.json",
      "semanticHash": "d57ca5e70b58d9770be6f75d9cbe9ddcc30257297cc6b0eac929f349002df1fc",
      "sha256": "707de55d6e7a5fbd0ed36116f93483468b8f152501191ea7f2740cd639940603"
    }
  ],
  "validationHash": "9c2283b8710c6fc0d4c96e16b3cef373ba8242a4ad365fe06f4da98fe3c5e451",
  "regressionHash": "5da0108241eae3b1302943d8bbae9709fbde662d4abfc501dee40e47cdea80c8",
  "reportGenerator": "scripts/report-c6-1-1-selective-mbr.ts",
  "rawGoldReadByReport": false
}
```
