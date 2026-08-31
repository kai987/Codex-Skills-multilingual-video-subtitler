# C6.1.2 Top-K Reranking & Acoustic Completeness Report

工程验收：PASSED。研究路线：`EVALUATION_COVERAGE_INSUFFICIENT`。C6.1.3：**HOLD**。

本报告只读取已冻结的指标、ID、哈希与验收产物，不读取原始Gold字幕或候选文本。全部输出为本地研究资料；可分享审计仅覆盖聚合summary。

## 阅读摘要

C6.1.2 的实现、真实本地 CTC 证据生成、A/B 离线回放与工程验收已完成；它没有证明可以安全自动替换字幕。本轮是已知开发集上的诊断研究，不是未见样本的前瞻验证。生产仍为 `needs-review`、`finalizationMethod: none`，没有进入 C6.1.3。

- **主要阻塞是评价覆盖**：113 个冻结机器组仅有 20 个可稳定绑定 Gold（17.70%）；141 个候选事件仅 26 个可评价（18.44%）。90 个组歧义、3 个组无映射，不能按零错误处理。
- **检索有局部空间，排序未获安全支持**：13 个可评价且存在改进候选的事件中，Top-4 保留了 12 个事件的并列最优候选，Recall@4 为 92.31%；候选级 oracle gain 保留 38/42（90.48%）。这些是小覆盖集合的局部反事实诊断，不是实际组联合收益，也不能外推到整集或未见剧集。
- **声学完整性仍不足**：519 个候选中仅 138 个有非未知完整性分类（26.59%，均为部分缺失类别），359 个证据不足、22 个不可评分；没有 `VERIFIED_COMPLETE` 或 `LIKELY_COMPLETE`。296 个身份经实际 PCM 验证，223 个仍为 provisional；100% 身份覆盖不等于 100% verified。
- **预冻结 L6 零替换是回退，不是最佳策略验证**：其 Precision/Harm 和 changed-group evaluation coverage 无分母，保持 null。没有通过 Strong Gate 的“最佳可启用策略”。事后最高局部收益对照 L1 只作描述，不改换预冻结主策略。

下表的 gain/material/catastrophic 都是固定 V2 可评价组上的**实际组联合结果**；Unknown 是被选择但不可评价的组，不能视为安全。

| Profile                           | Top-1 accuracy | 选择组 | 改善/退化/中性/未知 | Normalized joint gain | Material delta | Catastrophic groups |
| --------------------------------- | -------------: | -----: | ------------------- | --------------------: | -------------: | ------------------: |
| L0 H2 对照                        |         34.62% |    110 | 6/6/7/91            |                    +3 |             +1 |                   4 |
| L1 Raw MBR 对照（事后最高收益）   |         42.31% |    110 | 7/6/6/91            |                   +11 |             +1 |                   4 |
| L2 Pairwise                       |         34.62% |     83 | 2/3/9/69            |                    -8 |             +1 |                   1 |
| L3 Listwise                       |         30.77% |     84 | 1/4/9/70            |                   -14 |             +2 |                   2 |
| L6 预冻结 abstention-first 主策略 |         30.77% |      0 | 0/0/0/0             |                     0 |              0 |                   0 |

L1 的 110 个选择组中只有 19 个可评价：Precision=7/(7+6)=53.85%，Harm=6/19=31.58%，Selective Coverage=19/19=100%；最后一项不是全体选择均可评价。L1 在 5 个折都有选择，但有 2 个负增益折、5 个含未知增益的折。按另行保留的整集 legacy 口径，其 Material Errors 从 77 增至 82；这个 +5 与固定 V2 可评价组的 +1 使用不同覆盖集合，不得混用。

候选审计也有不同统计口径：本版强收缩为 225 条；后验审计共 226 条，因为保留了 1 条仅历史版本判强、本版不再判强的记录。后验一般删除退化为前部 16/尾部 3/内部 0；其中 `catastrophic=true` 的严格子集为前部 **10**/尾部 **1**/内部 **0**。这些是候选诊断，不是 L6 已应用组的退化数量。

执行记录：真实已有目标 CTC 共 141 个请求、1 次模型加载；最终 A/B 各命中 141 个精确缓存，均为 0 inference、0 model load。整个研究 ASR inference=0，未产生新转写。模型/阈值/OOF 决策/联合指标语义一致，18 套 shadow 的 ASS/SRT/VTT/package 在 A/B 间逐字节一致；模式计数与时间屏障元数据分别保留。6 个生产文件及 canonical text/timing hashes 均未变，Skill 2/3 与原有字幕合同未改。

最新验收为 `acceptance-release-final/c6-1-2-validation.json`：33/33 通过、138 个产物通过严格校验、49 个新增 Schema（全仓生成 420 个）。完整 QA 为 `qa-console-release/c6-1-2-regression-evidence.json`，14 个阶段通过：Unit 1202 passed/2 opt-in skipped，E2E 60 passed/1 opt-in skipped，C6.1/C6.1.1/C6.1.2 专项 113/197/69 passed，历史专项 1077 passed/1 opt-in skipped，Python toy-logit CTC 6 passed。专项与全量测试存在重叠，不能相加当作独立测试总数。跳过项仅为原有、未授权启用的真实 Speaker/MFA 可选集成测试。

输出目录名保留任务开始日 `20260831`，收尾发生于 2026-09-01（JST）。本次权威输出是下列 4 个目录；具体历史记录和最终 Git 收据见 validation 目录的 `RUN_INDEX.md`：

1. `carnation-c6-1-2-acoustic-preflight-20260831`：实际 Fresh CTC 账本。
2. `carnation-c6-1-2-final-a-v2-20260831`：正式 A，冻结机器证据、OOF、评价与 shadow。
3. `carnation-c6-1-2-final-b-v2-20260831`：正式 B，精确缓存及确定性回放。
4. `carnation-c6-1-2-validation-20260831`：最新 QA、验收、报告数据、历史记录与 Git 收据。

生成源码内容由原始 Freeze hash 绑定，`02f0b38198587c06ba4fbb386b6e99c309cc12c7` 提供可重现的 Git 地址；Git 提交时间不替代机器/Gold 屏障。`d2f1a747f8809d7e745676135b19b01c30c014c9` 修正验收容器和 PCM 样本边界口径；`57442fd6eb68b7537619ae81dbb9265a6d633172` 修正报告的灾难性删除计数及措辞。两次后续修订均未改写冻结的候选、标签、模型、阈值、预测、shadow 或生产字幕。原始失败验收和报告草稿保留为历史，不作为最终验收结果。

## 1. Executive Conclusion

```json
{
  "engineering": true,
  "strongSupport": false,
  "route": "EVALUATION_COVERAGE_INSUFFICIENT",
  "c613": "HOLD",
  "benchmark": "KNOWN_DEVELOPMENT_BENCHMARK"
}
```

## 2. Branch

codex/c6-1-2-top-k-reranking-acoustic-completeness

## 3. Baseline

```json
{
  "branch": "codex/c6-1-1-fixed-alignment-selective-existing-mbr",
  "commit": "c371fd86cabc64e534da39987b786da7375a49dd"
}
```

## 4. C6.1.1 Replay

```json
{
  "passed": true,
  "checks": [
    {
      "name": "policy",
      "passed": true,
      "observed": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
      "expected": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825"
    },
    {
      "name": "proposal",
      "passed": true,
      "observed": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c",
      "expected": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c"
    },
    {
      "name": "features",
      "passed": true,
      "observed": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
      "expected": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2"
    },
    {
      "name": "folds",
      "passed": true,
      "observed": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc",
      "expected": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc"
    },
    {
      "name": "productionText",
      "passed": true,
      "observed": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
      "expected": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9"
    },
    {
      "name": "productionTiming",
      "passed": true,
      "observed": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936",
      "expected": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936"
    },
    {
      "name": "candidateUniverse",
      "passed": true,
      "observed": "2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a",
      "expected": "2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a"
    },
    {
      "name": "baselineCueCount",
      "passed": true,
      "observed": "161",
      "expected": "161"
    },
    {
      "name": "baselineEventCount",
      "passed": true,
      "observed": "199",
      "expected": "199"
    },
    {
      "name": "baselineInputCandidateCount",
      "passed": true,
      "observed": "1496",
      "expected": "1496"
    },
    {
      "name": "baselineRoute",
      "passed": true,
      "observed": "SELECTIVE_MBR_NOT_SUPPORTED",
      "expected": "SELECTIVE_MBR_NOT_SUPPORTED"
    },
    {
      "name": "frozenArtifactHash:machine/c6-1-1-policy-freeze.json",
      "passed": true,
      "observed": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825",
      "expected": "05f6c3adc5bb3fa18b8c9f7c94d57c45827f00359e30e816bd52698dddd51825"
    },
    {
      "name": "frozenArtifactHash:machine/machine-selective-existing-candidate-proposals.json",
      "passed": true,
      "observed": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c",
      "expected": "deb952d574d8848a7a282d349ca796e17a1aee36fb74963ac2c80576e2c9866c"
    },
    {
      "name": "frozenArtifactHash:machine/machine-selective-mbr-features.json",
      "passed": true,
      "observed": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2",
      "expected": "dc7a546dbcbb783d83370ab8afb6f1588da37af44c737b63c055afed961f7bc2"
    },
    {
      "name": "frozenArtifactHash:machine/c6-1-1-calibration-folds.json",
      "passed": true,
      "observed": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc",
      "expected": "8dba2f525a9b719408e2c4fb869d6ddd183cada5edb2680bfff7f6822b7474bc"
    },
    {
      "name": "frozenArtifactHash:evaluation/c6-1-1-fixed-baseline-alignment-map.json",
      "passed": true,
      "observed": "62149d7673e829687bcb7af404dc87f4b70ec0ab51269dee531d61bae603841b",
      "expected": "62149d7673e829687bcb7af404dc87f4b70ec0ab51269dee531d61bae603841b"
    },
    {
      "name": "frozenArtifactHash:evaluation/c6-1-1-out-of-fold-selective-decisions.json",
      "passed": true,
      "observed": "8d8db60e1dae4d503e3c72412e5ec7b9be896ea7a4adef41edc1b0786d8aac78",
      "expected": "8d8db60e1dae4d503e3c72412e5ec7b9be896ea7a4adef41edc1b0786d8aac78"
    },
    {
      "name": "frozenArtifactHash:evaluation/c6-1-1-route-decision.json",
      "passed": true,
      "observed": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03",
      "expected": "f5b942bbf5c74eb6409ee36a89b92851ddc8f6adcc1fdc1adb98903b85116f03"
    }
  ],
  "independentAcceptance": true
}
```

## 5. Goals

测量 Top-K 是否保留更好的既有候选，以及无测试标签输入的 OOF 排序能否在固定组联合评价中安全获益。

## 6. Non-goals

不新增 ASR、不生成转写、不引入第三 ASR/LLM/embedding、不改生产文本/时间/数量、不改 Skill2/3，不自动发布。

## 7. Research Hypothesis

分离 retrieval、correlation identity、acoustic completeness、reranking 和 application gate 的失败原因；不预设 GO。

## 8. Production Invariants

```json
{
  "canonicalText": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
  "canonicalTiming": "e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936",
  "source": "294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43",
  "productionFiles": [
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].ass",
      "sha256": "594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7",
      "size": 15311
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.ass",
      "sha256": "a33e2ad12d48b11287829ea80d08f686ca0271bbc4a69ed52a5c77838fdfbf03",
      "size": 15311
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.srt",
      "sha256": "4d13429d4c2f6a25b28d553aafe2471f5b3bc8dafde26d2c67c33226fa15de01",
      "size": 11956
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].best-effort.vtt",
      "sha256": "249d907a3b3db721471c6a80ea5d782cdabea22503eaae3a0a44453acc0173e7",
      "size": 19530
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].srt",
      "sha256": "faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd",
      "size": 11956
    },
    {
      "relativePath": "subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].vtt",
      "sha256": "107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a",
      "size": 19530
    }
  ],
  "shadowPresentation": [
    {
      "profile": "A0_H2_BASELINE",
      "hash": "437744f67f742f848a4e8be8d3a92b1d2c7012a9c4701f911b3e20b532feb43f"
    },
    {
      "profile": "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
      "hash": "5d6128f6226971640381f2a08ca3d276c485f355d4073522930c9325fd1d248e"
    },
    {
      "profile": "A2_TOP_K_PLUS_CORRELATION",
      "hash": "386ad7dbacacdc3ac807d591b3d4d90ff82a0e39cdcb5230cc1558b99e9b47a0"
    },
    {
      "profile": "A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "A5_WITHOUT_PROVIDER_IDENTITY",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "A6_WITHOUT_CTC",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "A7_WITHOUT_CONTRACTION_GATE",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "A8_ABSTENTION_FIRST_FULL",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "L0",
      "hash": "f03f96e6938d9ee08da542e4b1fc1f7b32ff32009046f68cbd1693b1c6769850"
    },
    {
      "profile": "L1",
      "hash": "9a60e425e67fddcd29ca894f27de693d14afb348ca28af9cc95ae634ea16b956"
    },
    {
      "profile": "L2",
      "hash": "1430aaa5fe0fae8779f7fec8a7426585ebc8382558efd1472981fb6968f25a67"
    },
    {
      "profile": "L3",
      "hash": "79ad0610bb15986f3459f3be7cbd56337f3917645c6e4ae1edb030ace058b236"
    },
    {
      "profile": "L4",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "L5",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "L6",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "L7",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    },
    {
      "profile": "L8",
      "hash": "8312c0983019bbc78b206d45a840940973496acbb5439021663424e678b20578"
    }
  ]
}
```

## 9. Full Candidate Rank Audit

```json
{
  "rows": 1146,
  "rankHash": "53e9bdce0a571c0f9d55400a6e70bf2c6dffd96fc84d9e006d43fe3160e4cd9b",
  "legacyRiskHash": "8f605ec2d8e24c25abc05897a1da33f7d761e9e26188a3bb8da3f87c9cf6d353",
  "excludedRows": 619
}
```

## 10. Eligible Events

141

## 11. Candidate Count

```json
{
  "input": 1496,
  "included": 832,
  "includedAsr": 671,
  "whisper": 446,
  "reazon": 225,
  "eligibleEvents": 141,
  "rankRows": 1146,
  "topKUnique": 519,
  "current": 141,
  "alternatives": 378
}
```

## 12. Oracle Candidate Rank Distribution

```json
{
  "1": 4,
  "2": 6,
  "3": 1,
  "4": 1,
  "5+": 1
}
```

## 13. Recall@1

0.38461538461538464

## 14. Recall@2

0.7692307692307693

## 15. Recall@3

0.8461538461538461

## 16. Recall@4

0.9230769230769231

## 17. MRR

0.6217948717948717

## 18. nDCG@4

0.7686364308869654

## 19. T0 H2 Top-4

```json
{
  "profile": "T0_H2_TOP4",
  "evaluableEvents": 26,
  "oracleImprovementEvents": 13,
  "recall1": 0.38461538461538464,
  "recall2": 0.7692307692307693,
  "recall3": 0.8461538461538461,
  "recall4": 0.9230769230769231,
  "mrr": 0.6217948717948717,
  "ndcg4": 0.7686364308869654,
  "topKOracleGain": 38,
  "fullExistingOracleGain": 42,
  "oracleCapture": 0.9047619047619048
}
```

## 20. T1 Raw MBR Top-4

```json
{
  "profile": "T1_RAW_MBR_TOP4",
  "evaluableEvents": 26,
  "oracleImprovementEvents": 13,
  "recall1": 0.46153846153846156,
  "recall2": 0.6923076923076923,
  "recall3": 0.7692307692307693,
  "recall4": 0.9230769230769231,
  "mrr": 0.6410256410256411,
  "ndcg4": 0.7603101726659376,
  "topKOracleGain": 38,
  "fullExistingOracleGain": 42,
  "oracleCapture": 0.9047619047619048
}
```

## 21. T2 Union Top-4

```json
{
  "profile": "T2_H2_RAW_UNION_TOP4",
  "evaluableEvents": 26,
  "oracleImprovementEvents": 13,
  "recall1": 0.38461538461538464,
  "recall2": 0.7692307692307693,
  "recall3": 0.8461538461538461,
  "recall4": 0.9230769230769231,
  "mrr": 0.6217948717948717,
  "ndcg4": 0.7682794735092339,
  "topKOracleGain": 38,
  "fullExistingOracleGain": 42,
  "oracleCapture": 0.9047619047619048
}
```

## 22. T3 Provider-diverse Top-4

```json
{
  "profile": "T3_PROVIDER_DIVERSE_CORRELATION_DEDUP_TOP4",
  "evaluableEvents": 26,
  "oracleImprovementEvents": 13,
  "recall1": 0.38461538461538464,
  "recall2": 0.7692307692307693,
  "recall3": 0.8461538461538461,
  "recall4": 0.9230769230769231,
  "mrr": 0.6217948717948717,
  "ndcg4": 0.7682794735092339,
  "topKOracleGain": 38,
  "fullExistingOracleGain": 42,
  "oracleCapture": 0.9047619047619048
}
```

## 23. Best Retrieval Profile

```json
{
  "postHocDiagnosticBest": "T1_RAW_MBR_TOP4",
  "predeclaredPrimary": "T3_PROVIDER_DIVERSE_CORRELATION_DEDUP_TOP4"
}
```

## 24. Candidate Conservation

```json
{
  "accounted": 4584,
  "expected": 4584,
  "silentDrop": 0,
  "passed": true
}
```

## 25. Provider Diversity

```json
[
  {
    "profile": "T0_H2_TOP4",
    "events": 141,
    "current": 141,
    "alternatives": 374,
    "bothProviders": 114,
    "availableBothProviders": 114,
    "duplicateObservationSlots": 0
  },
  {
    "profile": "T1_RAW_MBR_TOP4",
    "events": 141,
    "current": 141,
    "alternatives": 374,
    "bothProviders": 114,
    "availableBothProviders": 114,
    "duplicateObservationSlots": 0
  },
  {
    "profile": "T2_H2_RAW_UNION_TOP4",
    "events": 141,
    "current": 141,
    "alternatives": 374,
    "bothProviders": 114,
    "availableBothProviders": 114,
    "duplicateObservationSlots": 0
  },
  {
    "profile": "T3_PROVIDER_DIVERSE_CORRELATION_DEDUP_TOP4",
    "events": 141,
    "current": 141,
    "alternatives": 374,
    "bothProviders": 114,
    "availableBothProviders": 114,
    "duplicateObservationSlots": 0
  }
]
```

## 26. Correlation Identity Design

```json
{
  "verified": "ACTUAL_PCM_PLUS_EXPLICIT_SOURCE_REQUEST_LINEAGE",
  "provisional": "EXPLICIT_INTERVAL_NOT_PCM_VERIFIED",
  "unknownIsIndependent": false,
  "currentVote": 0,
  "observationVote": 1
}
```

## 27. Core Audio Identity

verified=实际 source PCM + 显式 request/core lineage；不是把区间或 WAV 文件名当作字节身份。历史提取 WAV 与新解码 PCM 的容器字节哈希不同，未伪称逐字节相同。

## 28. Verified Identity Coverage

```json
{
  "verified": 296,
  "verifiedCoverage": 0.5703275529865125,
  "verifiedOrProvisionalCoverage": 1
}
```

## 29. Provisional Identity

223

## 30. Unknown Identity

0

## 31. Same-audio Reconciliation

0

## 32. Duplicate Votes Prevented

0

## 33. Candidate-specific Completeness

```json
{
  "minimumTokenPosterior": 0.65,
  "minimumSupportedTokenFraction": 0.9,
  "minimumSpeechCoverage": 0.9,
  "maximumUncoveredEdgeSeconds": 0.25,
  "maximumInternalUncoveredSeconds": 0.3,
  "minimumRequestEdgeDistance": 0.04,
  "tokenToleranceSeconds": 0.06,
  "ctcAloneSelectsWinner": false
}
```

## 34. Speech Activity Coverage

```json
{
  "available": 142,
  "total": 519
}
```

## 35. Token Support Coverage

```json
{
  "available": 497,
  "total": 519
}
```

## 36. CTC Scorability

```json
{
  "SCORABLE": 497,
  "UNSCORABLE": 22
}
```

## 37. Leading Deletion Risk

```json
{
  "available": 142,
  "partialLeading": 114
}
```

## 38. Trailing Deletion Risk

```json
{
  "available": 142,
  "partialTrailing": 23
}
```

## 39. Internal Deletion Risk

```json
{
  "available": 142,
  "partialInternal": 1
}
```

## 40. Adjacent Contamination

```json
{
  "available": 0,
  "adjacent": 0
}
```

## 41. Completeness Status Distribution

```json
{
  "INSUFFICIENT_EVIDENCE": 359,
  "PARTIAL_INTERNAL": 1,
  "PARTIAL_LEADING": 114,
  "PARTIAL_TRAILING": 23,
  "UNSCORABLE": 22
}
```

## 42. Unknown Completeness Count

```json
{
  "insufficient": 359,
  "unscorable": 22,
  "nonunknownCoverage": 0.2658959537572254
}
```

## 43. Fresh Verifier Inference

```json
{
  "schemaVersion": "1.0.0",
  "artifactType": "machine-c6-1-2-acoustic-completeness-runtime",
  "policyVersion": "c6.1.2-top-k-reranking-acoustic-completeness-v1",
  "semanticHash": "8e49fdb3e20ac3a717967ea3cac1341231bb95dd43d6642d5423ab3d28550d8c",
  "mode": "BOUNDED_NON_GENERATIVE_FRESH",
  "modelId": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
  "modelRevision": "cf031e020336460d15a417eba710bbc5bb43be9a",
  "modelSnapshotHash": "b79679cf3c98b21dd1b666c8050e49b87f03372127fcbfed046db9b7387c803e",
  "runtimeIdentityHash": "eb8e649de8bf4b20efd45894d349059bdf157149795b83ad6138900ff265e175",
  "device": "cpu",
  "requestBudget": 200,
  "plannedRequests": 141,
  "actualRequests": 141,
  "freshVerifierInference": 141,
  "verifierCacheHits": 0,
  "verifierModelLoads": 1,
  "candidateScores": 519,
  "asrInference": 0,
  "asrModelLoads": 0,
  "newTranscriptCandidates": 0,
  "networkUsed": false,
  "runtimeGoldInputCount": 0
}
```

## 44. Verifier Cache Replay

```json
{
  "finalA": {
    "schemaVersion": "1.0.0",
    "artifactType": "machine-c6-1-2-acoustic-completeness-runtime",
    "policyVersion": "c6.1.2-top-k-reranking-acoustic-completeness-v1",
    "semanticHash": "71cb7bbc170337792b221272398dc0c0c1f113de4f0243b91b59cf1247089caf",
    "mode": "EXACT_CACHE_ONLY",
    "modelId": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "modelRevision": "cf031e020336460d15a417eba710bbc5bb43be9a",
    "modelSnapshotHash": "b79679cf3c98b21dd1b666c8050e49b87f03372127fcbfed046db9b7387c803e",
    "runtimeIdentityHash": "eb8e649de8bf4b20efd45894d349059bdf157149795b83ad6138900ff265e175",
    "device": "cpu",
    "requestBudget": 200,
    "plannedRequests": 141,
    "actualRequests": 141,
    "freshVerifierInference": 0,
    "verifierCacheHits": 141,
    "verifierModelLoads": 0,
    "candidateScores": 519,
    "asrInference": 0,
    "asrModelLoads": 0,
    "newTranscriptCandidates": 0,
    "networkUsed": false,
    "runtimeGoldInputCount": 0
  },
  "finalB": {
    "schemaVersion": "1.0.0",
    "artifactType": "machine-c6-1-2-acoustic-completeness-runtime",
    "policyVersion": "c6.1.2-top-k-reranking-acoustic-completeness-v1",
    "semanticHash": "67943859250705b798df0a49863de43616b831fa7e97be6b11ee428b631ceefc",
    "mode": "CACHE_REPLAY",
    "modelId": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "modelRevision": "cf031e020336460d15a417eba710bbc5bb43be9a",
    "modelSnapshotHash": "b79679cf3c98b21dd1b666c8050e49b87f03372127fcbfed046db9b7387c803e",
    "runtimeIdentityHash": "eb8e649de8bf4b20efd45894d349059bdf157149795b83ad6138900ff265e175",
    "device": "cpu",
    "requestBudget": 200,
    "plannedRequests": 141,
    "actualRequests": 141,
    "freshVerifierInference": 0,
    "verifierCacheHits": 141,
    "verifierModelLoads": 0,
    "candidateScores": 519,
    "asrInference": 0,
    "asrModelLoads": 0,
    "newTranscriptCandidates": 0,
    "networkUsed": false,
    "runtimeGoldInputCount": 0
  },
  "identity": {
    "schemaVersion": "1.0.0",
    "artifactType": "machine-c6-1-2-verifier-runtime-identity",
    "policyVersion": "c6.1.2-top-k-reranking-acoustic-completeness-v1",
    "semanticHash": "2c4a32cc9fdab7e478134b77121bce1277408945fe3c959c5c91d72d144c213c",
    "modelId": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "modelRevision": "cf031e020336460d15a417eba710bbc5bb43be9a",
    "modelSnapshotHash": "b79679cf3c98b21dd1b666c8050e49b87f03372127fcbfed046db9b7387c803e",
    "modelFiles": [
      {
        "name": "config.json",
        "sha256": "552b8c8c85c54a761899eb94b5eb3d58166e769df8e26cf515ab9da695772cd7",
        "bytes": 1567
      },
      {
        "name": "preprocessor_config.json",
        "sha256": "c403ce09975b90dff0dd8302c42d422e9de1f166cd7772df23490069893cb0cf",
        "bytes": 158
      },
      {
        "name": "vocab.json",
        "sha256": "9ffedf9c2da2617b01c4227a4db875d2dfd4e8c31fb9a13182d03c3280679ffe",
        "bytes": 29298
      },
      {
        "name": "pytorch_model.bin",
        "sha256": "4f6821dcd79770fcd4c11487c4ee5c040b3a7e1863425224014ba5ea8fbc1b67",
        "bytes": 1271531927
      },
      {
        "name": "special_tokens_map.json",
        "sha256": "bb7068de1150661a10b55f9e4b12a0e77af8bf91f5e45e1b58afaf1d0e17f675",
        "bytes": 85
      }
    ],
    "runtime": {
      "python": "3.12.14",
      "torch": "2.13.0",
      "transformers": "5.16.1",
      "numpy": "2.5.2",
      "scipy": "1.18.1",
      "device": "cpu",
      "precision": "fp32",
      "threads": 1
    },
    "workerHash": "4e0fd45d612b314c9646d4deb21d19e9288874dce3fa015b14c7c75b17cd6643",
    "importedWorkerHash": "f5c614950878d36788a69119b3a9ca45e17871a916d09a07a5d3aad882f75c9c",
    "runtimeIdentityHash": "eb8e649de8bf4b20efd45894d349059bdf157149795b83ad6138900ff265e175",
    "networkUsed": false,
    "runtimeGoldInputCount": 0
  },
  "note": "首次 141 窗口执行计入前置声学产物；最终 A/B 复用同一冻结模型/运行时/目标缓存，无模型加载。"
}
```

## 45. Strong Contraction Count

```json
{
  "priorC611": 48,
  "topKStrong": 225,
  "postHocAuditRows": 226,
  "priorOnlyNotStrong": 1,
  "priorReclassified": {
    "LEADING_DIALOGUE_DELETION": 4,
    "UNEVALUABLE": 39,
    "VALID_SHORTENING": 5
  },
  "allDeletionRegressions": {
    "leading": 16,
    "trailing": 3,
    "internal": 0
  },
  "catastrophicSubset": {
    "leading": 10,
    "trailing": 1,
    "internal": 0
  },
  "unit": "CANDIDATE_DIAGNOSTIC_NOT_APPLIED_GROUPS"
}
```

## 46. Valid Shortening Count

```json
{
  "postHocGoldValidShortening": 19,
  "acousticallySelectable": 0
}
```

## 47. Hallucination Removal Count

```json
{
  "machineVerifiedHallucinationRemoval": 0,
  "note": "Gold相似度改善不等于证实声学幻觉删除。"
}
```

## 48. Catastrophic Leading Deletion

10

## 49. Catastrophic Trailing Deletion

1

## 50. Catastrophic Internal Deletion

0

## 51. Unknown Contraction

```json
{
  "machineUnknown": 225,
  "postHocUnevaluable": 188,
  "strongPostHocUnevaluable": 187
}
```

## 52. Fixed Mapping V2

```json
{
  "machineGroups": 113,
  "machineStatus": {
    "AMBIGUOUS": 16,
    "FIXED_MANY_TO_MANY": 6,
    "FIXED_MANY_TO_ONE": 6,
    "FIXED_ONE_TO_ONE": 85
  },
  "fixedGoldBinding": {
    "AMBIGUOUS": 90,
    "FIXED_MANY_TO_MANY": 1,
    "FIXED_ONE_TO_MANY": 8,
    "FIXED_ONE_TO_ONE": 11,
    "NO_MAPPING": 3
  },
  "mappingHash": "bef963fda4de875a1e9c29c486a3d13e4f776cbe59511b8ef9d3e4d1429bd720",
  "goldBindingHash": "e7a1bee174ba12afb56a5de0ba4d80c566dcf5f9045459be9a8c2d0e78ac504a"
}
```

## 53. Mapping Recovery

```json
{
  "priorFixedGroups": 61,
  "newMachineGroups": 113,
  "evaluableGoldGroups": 20,
  "topology": "machine-first; Gold spans crossing frozen groups remain ambiguous"
}
```

## 54. Ambiguous Mapping

90

## 55. No Mapping

3

## 56. Changed-group Evaluation Coverage

```json
{
  "precision": null,
  "harm": null,
  "selectiveGroupCoverage": 0,
  "eventSelectionCoverage": 0,
  "changedGroupEvaluationCoverage": null
}
```

## 57. Feature Schema

```json
[
  "rawMbrRank",
  "hierarchicalMbrRank",
  "rawMbrRisk",
  "hierarchicalMbrRisk",
  "rawMbrMargin",
  "hierarchicalMbrMargin",
  "normalizedDistanceToCurrent",
  "pronunciationDistanceToCurrent",
  "lengthRatio",
  "lcsRatio",
  "prefixRetention",
  "suffixRetention",
  "insertionRatio",
  "deletionRatio",
  "providerWhisper",
  "providerReazon",
  "currentControl",
  "correlationGroupSize",
  "independentProviderSupport",
  "sameAudioDuplicateCount",
  "uniqueAcousticObservationCount",
  "providerWindowStability",
  "lexicalStability",
  "contextExtensionRisk",
  "hallucinationRisk",
  "candidateCtcLossPerToken",
  "relativeCtcMargin",
  "tokenSupportCoverage",
  "speechActivityCoverage",
  "leadingSpeechGap",
  "trailingSpeechGap",
  "completenessStatus",
  "edgeRisk",
  "contaminationRisk",
  "finalSpanLineageStatus",
  "cueGroupMappingStatus",
  "candidateProvenanceComplete",
  "candidateEncodingValid"
]
```

## 58. Raw-text Feature Count

0

## 59. Gold Feature Count

0

## 60. Dataset-specific Feature Count

0

## 61. Provider Identity Feature

providerWhisper/providerReazon；L7/A5固定移除这两个维度，不按测试折结果选择特征。

## 62. Acoustic Features

```json
[
  "candidateCtcLossPerToken",
  "relativeCtcMargin",
  "tokenSupportCoverage",
  "speechActivityCoverage",
  "leadingSpeechGap",
  "trailingSpeechGap",
  "completenessStatus",
  "edgeRisk",
  "contaminationRisk"
]
```

## 63. Missing Indicators

```json
{
  "flags": 38,
  "missingValues": 6211,
  "imputation": "TRAIN_ONLY_MEAN_WITH_MISSING_FLAG"
}
```

## 64. Feature Freeze

```json
{
  "featureHash": "4910227791331e7380c9a3e558effc9aa876ef86e655f93c4e8c1715f492b235",
  "machineFreezeHash": "5096fbcb89c09621e65f9f8ac16f844546c29717bd850cf921b3309a65391da2",
  "policyHash": "e52fa6ecfafe89a930e3c68578b5e0b6bb99fb175d56a25f12435f2df9102f14",
  "codeHash": "fa7b54509667b4695e43b9bb7287294f8186af9a223ec3e00ff171d04ea9b73c"
}
```

## 65. Gold Barrier

机器候选/证据/特征/固定映射/分折/模型策略先冻结；独立 evaluator 随后读取 Gold 并生成数值标签；训练进程仅使用训练折数值标签，OOF Shadow 在训练后冻结；最终 evaluator 复用固定映射。学习型 Shadow 并非在首次 Gold 读取前存在。

## 66. Candidate Labels

```json
{
  "total": 1146,
  "evaluable": 106,
  "classes": {
    "CATASTROPHIC_REGRESSION": 11,
    "EQUIVALENT_TO_CURRENT": 22,
    "IMPROVES_CURRENT": 9,
    "ORACLE_BEST": 39,
    "REGRESSES_FROM_CURRENT": 25,
    "UNEVALUABLE": 1040
  },
  "role": "local counterfactual diagnostic only"
}
```

## 67. Group Labels

```json
{
  "total": 113,
  "evaluable": 20,
  "unknown": 93,
  "fixedBindingHash": "e7a1bee174ba12afb56a5de0ba4d80c566dcf5f9045459be9a8c2d0e78ac504a"
}
```

## 68. Fold Design

```json
{
  "method": {
    "count": 5,
    "method": "CONTIGUOUS_TIME_BLOCKED_CONNECTED_AUDIO_CORRELATION_CUE_GROUPS",
    "gapSeconds": 0,
    "randomSplit": false
  },
  "folds": [
    {
      "fold": "outer-1",
      "blocks": 16,
      "groups": 24,
      "events": 32,
      "candidates": 139
    },
    {
      "fold": "outer-2",
      "blocks": 2,
      "groups": 9,
      "events": 37,
      "candidates": 165
    },
    {
      "fold": "outer-3",
      "blocks": 7,
      "groups": 22,
      "events": 39,
      "candidates": 175
    },
    {
      "fold": "outer-4",
      "blocks": 10,
      "groups": 29,
      "events": 41,
      "candidates": 195
    },
    {
      "fold": "outer-5",
      "blocks": 23,
      "groups": 29,
      "events": 34,
      "candidates": 140
    }
  ]
}
```

## 69. Audio Leakage

0

## 70. Correlation Leakage

0

## 71. L0 Result

```json
{
  "profileId": "L0",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.34615384615384615,
  "top1OracleHitRate": 0.34615384615384615,
  "mrr": 0.5717948717948718,
  "ndcg4": 0.7686364308869654,
  "selectedEvents": 126,
  "selectedGroups": 110,
  "evaluatedChangedGroups": 19,
  "improved": 6,
  "regressed": 6,
  "neutral": 7,
  "unknown": 91,
  "precision": 0.5,
  "harm": 0.3157894736842105,
  "coverage": 1,
  "eventSelectionCoverage": 0.8936170212765957,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": 0.17272727272727273,
  "selectedGroupEvaluationCoverage": 0.17272727272727273,
  "exactJointGain": 5,
  "normalizedJointGain": 3,
  "materialDelta": 1,
  "catastrophicDeletions": 4,
  "activeFolds": 5,
  "negativeGainFolds": 2,
  "unknownGainFolds": 5,
  "oracleCapture": 0.08571428571428572,
  "top1OracleCapture": 0.6578947368421053,
  "top1FullPoolOracleCapture": 0.5952380952380952,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 25,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 72. L1 Result

```json
{
  "profileId": "L1",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.4230769230769231,
  "top1OracleHitRate": 0.4230769230769231,
  "mrr": 0.6166666666666666,
  "ndcg4": 0.7603101726659376,
  "selectedEvents": 126,
  "selectedGroups": 110,
  "evaluatedChangedGroups": 19,
  "improved": 7,
  "regressed": 6,
  "neutral": 6,
  "unknown": 91,
  "precision": 0.5384615384615384,
  "harm": 0.3157894736842105,
  "coverage": 1,
  "eventSelectionCoverage": 0.8936170212765957,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": 0.17272727272727273,
  "selectedGroupEvaluationCoverage": 0.17272727272727273,
  "exactJointGain": 13,
  "normalizedJointGain": 11,
  "materialDelta": 1,
  "catastrophicDeletions": 4,
  "activeFolds": 5,
  "negativeGainFolds": 2,
  "unknownGainFolds": 5,
  "oracleCapture": 0.3142857142857143,
  "top1OracleCapture": 0.7368421052631579,
  "top1FullPoolOracleCapture": 0.6666666666666666,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 28,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 73. L2 Result

```json
{
  "profileId": "L2",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.34615384615384615,
  "top1OracleHitRate": 0.34615384615384615,
  "mrr": 0.5602564102564103,
  "ndcg4": 0.4867401797042013,
  "selectedEvents": 96,
  "selectedGroups": 83,
  "evaluatedChangedGroups": 14,
  "improved": 2,
  "regressed": 3,
  "neutral": 9,
  "unknown": 69,
  "precision": 0.4,
  "harm": 0.21428571428571427,
  "coverage": 0.7368421052631579,
  "eventSelectionCoverage": 0.6808510638297872,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": 0.1686746987951807,
  "selectedGroupEvaluationCoverage": 0.1686746987951807,
  "exactJointGain": -10,
  "normalizedJointGain": -8,
  "materialDelta": 1,
  "catastrophicDeletions": 1,
  "activeFolds": 5,
  "negativeGainFolds": 3,
  "unknownGainFolds": 5,
  "oracleCapture": -0.22857142857142856,
  "top1OracleCapture": 0.07894736842105263,
  "top1FullPoolOracleCapture": 0.07142857142857142,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 74. L3 Result

```json
{
  "profileId": "L3",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.3076923076923077,
  "top1OracleHitRate": 0.3076923076923077,
  "mrr": 0.5269230769230769,
  "ndcg4": 0.5028172905063746,
  "selectedEvents": 98,
  "selectedGroups": 84,
  "evaluatedChangedGroups": 14,
  "improved": 1,
  "regressed": 4,
  "neutral": 9,
  "unknown": 70,
  "precision": 0.2,
  "harm": 0.2857142857142857,
  "coverage": 0.7368421052631579,
  "eventSelectionCoverage": 0.6950354609929078,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": 0.16666666666666666,
  "selectedGroupEvaluationCoverage": 0.16666666666666666,
  "exactJointGain": -15,
  "normalizedJointGain": -14,
  "materialDelta": 2,
  "catastrophicDeletions": 2,
  "activeFolds": 5,
  "negativeGainFolds": 3,
  "unknownGainFolds": 5,
  "oracleCapture": -0.4,
  "top1OracleCapture": 0.07894736842105263,
  "top1FullPoolOracleCapture": 0.07142857142857142,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 75. L4 Result

```json
{
  "profileId": "L4",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.3076923076923077,
  "top1OracleHitRate": 0.3076923076923077,
  "mrr": 0.5269230769230769,
  "ndcg4": 0.5028172905063746,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0.07894736842105263,
  "top1FullPoolOracleCapture": 0.07142857142857142,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 76. L5 Result

```json
{
  "profileId": "L5",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.3076923076923077,
  "top1OracleHitRate": 0.3076923076923077,
  "mrr": 0.5269230769230769,
  "ndcg4": 0.5028172905063746,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0.07894736842105263,
  "top1FullPoolOracleCapture": 0.07142857142857142,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 77. L6 Result

```json
{
  "profileId": "L6",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.3076923076923077,
  "top1OracleHitRate": 0.3076923076923077,
  "mrr": 0.5269230769230769,
  "ndcg4": 0.5028172905063746,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0.07894736842105263,
  "top1FullPoolOracleCapture": 0.07142857142857142,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 78. L7 Result

```json
{
  "profileId": "L7",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.2692307692307692,
  "top1OracleHitRate": 0.2692307692307692,
  "mrr": 0.5205128205128206,
  "ndcg4": 0.5099624216952747,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0.07894736842105263,
  "top1FullPoolOracleCapture": 0.07142857142857142,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 79. L8 Result

```json
{
  "profileId": "L8",
  "foldId": null,
  "eligibleEvents": 141,
  "evaluatedRankings": 26,
  "top1Accuracy": 0.23076923076923078,
  "top1OracleHitRate": 0.23076923076923078,
  "mrr": 0.4878205128205128,
  "ndcg4": 0.46805058172018593,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.17699115044247787,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0.18421052631578946,
  "top1FullPoolOracleCapture": 0.16666666666666666,
  "candidateOracleCapture": 0.9047619047619048,
  "localTop1PositiveGain": 7,
  "localTopKOracleGain": 38,
  "localFullExistingOracleGain": 42,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 19
}
```

## 80. Best Gold-free Profile

```json
{
  "qualifiedBestSupportedProfile": null,
  "predeclaredPrimary": "L6",
  "postHocBestObserved": "L1",
  "warning": "后续主指标汇报预冻结L6；没有通过Strong Gate时不得称为已验证的最佳策略。事后最高收益对照仅用于描述，不替换主检验策略。"
}
```

## 81. Top-1 Accuracy

0.3076923076923077

## 82. Reranker MRR

0.5269230769230769

## 83. Reranker nDCG@4

0.5028172905063746

## 84. Changed Groups

0

## 85. Improved Groups

0

## 86. Regressed Groups

0

## 87. Neutral Groups

0

## 88. Unevaluable Groups

0

## 89. Selection Precision

```json
{
  "value": null,
  "denominator": "improved + regressed; neutral excluded"
}
```

## 90. Harm Rate

unknown（没有可评价分母或证据）

## 91. Selective Coverage

```json
{
  "value": 0,
  "denominator": "evaluable changed groups / evaluable eligible groups"
}
```

## 92. Exact Joint Gain

0

## 93. Normalized Joint Gain

0

## 94. Material Error Delta

```json
{
  "fixedGroupDelta": 0,
  "legacy77": {
    "profileId": "L6",
    "materialErrors": 77,
    "materialDelta": 0,
    "fixedMatching": true
  }
}
```

## 95. Catastrophic Deletion Regressions

0

## 96. Top-1 Oracle Capture

```json
{
  "topKDenominator": 0.07894736842105263,
  "fullPoolDenominator": 0.07142857142857142,
  "replayedH2FullPool": 0.5952380952380952,
  "caveat": "Top-1/Top-K capture 是 EVENT_COUNTERFACTUAL_DIAGNOSTIC；joint capture 使用有界配置组 oracle。C6.1.1 的 46.27% 是不同覆盖集合上的 H2/full-pool ceiling，不能据此直接宣称同比提升；同 V2 映射的 L0 另行列出。"
}
```

## 97. Candidate Oracle Capture

```json
{
  "candidateOracleCapture": 0.9047619047619048,
  "boundedGroupJointCapture": 0,
  "caveat": "Top-1/Top-K capture 是 EVENT_COUNTERFACTUAL_DIAGNOSTIC；joint capture 使用有界配置组 oracle。C6.1.1 的 46.27% 是不同覆盖集合上的 H2/full-pool ceiling，不能据此直接宣称同比提升；同 V2 映射的 L0 另行列出。"
}
```

## 98. Fold 1

```json
{
  "profileId": "L6",
  "foldId": "outer-1",
  "eligibleEvents": 26,
  "evaluatedRankings": 5,
  "top1Accuracy": 0.6,
  "top1OracleHitRate": 0.6,
  "mrr": 0.7666666666666667,
  "ndcg4": 1,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.20833333333333334,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 1,
  "top1FullPoolOracleCapture": 1,
  "candidateOracleCapture": 1,
  "localTop1PositiveGain": 3,
  "localTopKOracleGain": 3,
  "localFullExistingOracleGain": 3,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 5
}
```

## 99. Fold 2

```json
{
  "profileId": "L6",
  "foldId": "outer-2",
  "eligibleEvents": 20,
  "evaluatedRankings": 7,
  "top1Accuracy": 0,
  "top1OracleHitRate": 0,
  "mrr": 0.29047619047619044,
  "ndcg4": 0.31959682359968034,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.1111111111111111,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0,
  "top1FullPoolOracleCapture": 0,
  "candidateOracleCapture": 0.75,
  "localTop1PositiveGain": 0,
  "localTopKOracleGain": 12,
  "localFullExistingOracleGain": 16,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 1
}
```

## 100. Fold 3

```json
{
  "profileId": "L6",
  "foldId": "outer-3",
  "eligibleEvents": 28,
  "evaluatedRankings": 2,
  "top1Accuracy": 0,
  "top1OracleHitRate": 0,
  "mrr": 0.3333333333333333,
  "ndcg4": 0.5942901333997259,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.09090909090909091,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0,
  "top1FullPoolOracleCapture": 0,
  "candidateOracleCapture": 1,
  "localTop1PositiveGain": 0,
  "localTopKOracleGain": 6,
  "localFullExistingOracleGain": 6,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 2
}
```

## 101. Fold 4

```json
{
  "profileId": "L6",
  "foldId": "outer-4",
  "eligibleEvents": 36,
  "evaluatedRankings": 4,
  "top1Accuracy": 0.25,
  "top1OracleHitRate": 0.25,
  "mrr": 0.49999999999999994,
  "ndcg4": 0.5792322846421534,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.13793103448275862,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0,
  "top1FullPoolOracleCapture": 0,
  "candidateOracleCapture": 1,
  "localTop1PositiveGain": 0,
  "localTopKOracleGain": 3,
  "localFullExistingOracleGain": 3,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 4
}
```

## 102. Fold 5

```json
{
  "profileId": "L6",
  "foldId": "outer-5",
  "eligibleEvents": 31,
  "evaluatedRankings": 8,
  "top1Accuracy": 0.5,
  "top1OracleHitRate": 0.5,
  "mrr": 0.6458333333333334,
  "ndcg4": 0.47779816152509735,
  "selectedEvents": 0,
  "selectedGroups": 0,
  "evaluatedChangedGroups": 0,
  "improved": 0,
  "regressed": 0,
  "neutral": 0,
  "unknown": 0,
  "precision": null,
  "harm": null,
  "coverage": 0,
  "eventSelectionCoverage": 0,
  "allGroupEvaluationCoverage": 0.27586206896551724,
  "changedGroupEvaluationCoverage": null,
  "selectedGroupEvaluationCoverage": null,
  "exactJointGain": 0,
  "normalizedJointGain": 0,
  "materialDelta": 0,
  "catastrophicDeletions": 0,
  "activeFolds": 0,
  "negativeGainFolds": 0,
  "unknownGainFolds": 0,
  "oracleCapture": 0,
  "top1OracleCapture": 0,
  "top1FullPoolOracleCapture": 0,
  "candidateOracleCapture": 1,
  "localTop1PositiveGain": 0,
  "localTopKOracleGain": 14,
  "localFullExistingOracleGain": 14,
  "localOracleUnit": "EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT",
  "eligibleGroupCount": 7
}
```

## 103. Active Fold Count

```json
{
  "count": 0,
  "status": "NO_ACTIVE_FOLDS"
}
```

## 104. Negative-gain Fold Count

0

## 105. Unknown-gain Fold Count

0

## 106. Completeness Predictive Utility

```json
{
  "feature": "completeness",
  "scorableCount": 5,
  "positiveCount": 1,
  "negativeCount": 4,
  "correctDirection": 0,
  "wrongDirection": 0,
  "auc": 0.5,
  "precisionBlocked": 0.2,
  "catastrophicRecall": 1,
  "safeFalseBlockRate": 1
}
```

## 107. Edge Risk Utility

```json
{
  "feature": "edgeRisk",
  "scorableCount": 8,
  "positiveCount": 2,
  "negativeCount": 6,
  "correctDirection": 0,
  "wrongDirection": 0,
  "auc": 0.5,
  "precisionBlocked": 0.25,
  "catastrophicRecall": 1,
  "safeFalseBlockRate": 1
}
```

## 108. Token Support Utility

```json
{
  "feature": "tokenSupport",
  "scorableCount": 35,
  "positiveCount": 17,
  "negativeCount": 18,
  "correctDirection": 101,
  "wrongDirection": 24,
  "auc": 0.6258169934640523,
  "precisionBlocked": 0.4857142857142857,
  "catastrophicRecall": 1,
  "safeFalseBlockRate": 1
}
```

## 109. CTC Utility

```json
{
  "feature": "ctcLoss",
  "scorableCount": 35,
  "positiveCount": 17,
  "negativeCount": 18,
  "correctDirection": 232,
  "wrongDirection": 74,
  "auc": 0.7581699346405228,
  "precisionBlocked": 0.4857142857142857,
  "catastrophicRecall": 1,
  "safeFalseBlockRate": 1
}
```

## 110. Correlation Utility

```json
{
  "left": "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
  "right": "A2_TOP_K_PLUS_CORRELATION",
  "changedFamily": "CORRELATION",
  "normalizedJointGainDifference": 9,
  "top1AccuracyDifference": 0,
  "catastrophicDifference": 0,
  "causal": false
}
```

## 111. Provider Identity Ablation

```json
{
  "left": "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
  "right": "A5_WITHOUT_PROVIDER_IDENTITY",
  "changedFamily": "PROVIDER_IDENTITY",
  "normalizedJointGainDifference": 0,
  "top1AccuracyDifference": -0.03846153846153849,
  "catastrophicDifference": 0,
  "causal": false
}
```

## 112. Acoustic Evidence Ablation

```json
[
  {
    "left": "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
    "right": "A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS",
    "changedFamily": "ACOUSTIC_FEATURES_AND_GATE_NOT_SINGLE_FAMILY_CAUSAL",
    "normalizedJointGainDifference": 20,
    "top1AccuracyDifference": 0,
    "catastrophicDifference": -3,
    "causal": false
  },
  {
    "left": "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
    "right": "A6_WITHOUT_CTC",
    "changedFamily": "CTC_LOSS_FEATURES",
    "normalizedJointGainDifference": 0,
    "top1AccuracyDifference": -0.03846153846153849,
    "catastrophicDifference": 0,
    "causal": false
  }
]
```

## 113. Contraction Gate Ablation

```json
{
  "left": "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
  "right": "A7_WITHOUT_CONTRACTION_GATE",
  "changedFamily": "CONTRACTION_GATE",
  "normalizedJointGainDifference": 0,
  "top1AccuracyDifference": 0,
  "catastrophicDifference": 0,
  "causal": false
}
```

## 114. Retrieval Failure Count

1

## 115. Reranking Failure Count

11

## 116. Gate Failure Count

1

## 117. Evaluation-unavailable Count

115

## 118. Candidate Pool Sufficiency

```json
{
  "retrieval": {
    "profile": "T1_RAW_MBR_TOP4",
    "evaluableEvents": 26,
    "oracleImprovementEvents": 13,
    "recall1": 0.46153846153846156,
    "recall2": 0.6923076923076923,
    "recall3": 0.7692307692307693,
    "recall4": 0.9230769230769231,
    "mrr": 0.6410256410256411,
    "ndcg4": 0.7603101726659376,
    "topKOracleGain": 38,
    "fullExistingOracleGain": 42,
    "oracleCapture": 0.9047619047619048
  },
  "conclusion": "EVALUATION_COVERAGE_INSUFFICIENT",
  "caveat": "低覆盖或无安全选择不足以证明候选池已充分；不外推到未见剧集。"
}
```

## 119. Shadow Cue Count

```json
[
  {
    "profile": "A0_H2_BASELINE",
    "cues": 161
  },
  {
    "profile": "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
    "cues": 161
  },
  {
    "profile": "A2_TOP_K_PLUS_CORRELATION",
    "cues": 161
  },
  {
    "profile": "A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS",
    "cues": 161
  },
  {
    "profile": "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
    "cues": 161
  },
  {
    "profile": "A5_WITHOUT_PROVIDER_IDENTITY",
    "cues": 161
  },
  {
    "profile": "A6_WITHOUT_CTC",
    "cues": 161
  },
  {
    "profile": "A7_WITHOUT_CONTRACTION_GATE",
    "cues": 161
  },
  {
    "profile": "A8_ABSTENTION_FIRST_FULL",
    "cues": 161
  },
  {
    "profile": "L0",
    "cues": 161
  },
  {
    "profile": "L1",
    "cues": 161
  },
  {
    "profile": "L2",
    "cues": 161
  },
  {
    "profile": "L3",
    "cues": 161
  },
  {
    "profile": "L4",
    "cues": 161
  },
  {
    "profile": "L5",
    "cues": 161
  },
  {
    "profile": "L6",
    "cues": 161
  },
  {
    "profile": "L7",
    "cues": 161
  },
  {
    "profile": "L8",
    "cues": 161
  }
]
```

## 120. Shadow Text Changes

```json
[
  {
    "profile": "A0_H2_BASELINE",
    "appliedEvents": 126,
    "textHash": "75ba634cb8967987a211613e4d9dba996b33443ea03af01c70fa4be6a244d7d3",
    "canonicalChanged": true
  },
  {
    "profile": "A1_TOP_K_TEXT_STRUCTURAL_ONLY",
    "appliedEvents": 75,
    "textHash": "a8f6b0c890fcdaf9226d7575672d694301014e05c2655fb6f86a0fdc1e09d11f",
    "canonicalChanged": true
  },
  {
    "profile": "A2_TOP_K_PLUS_CORRELATION",
    "appliedEvents": 77,
    "textHash": "97f7318a93ae85ad9a72ae18a1afdae14d79814d448ce7cb0d73e8315e772179",
    "canonicalChanged": true
  },
  {
    "profile": "A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "A5_WITHOUT_PROVIDER_IDENTITY",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "A6_WITHOUT_CTC",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "A7_WITHOUT_CONTRACTION_GATE",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "A8_ABSTENTION_FIRST_FULL",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "L0",
    "appliedEvents": 126,
    "textHash": "9a55912dfe5e80258977d1bb376bd3c9cdcc1219562f67ee4b2e41a4024fe991",
    "canonicalChanged": true
  },
  {
    "profile": "L1",
    "appliedEvents": 126,
    "textHash": "0e4eb72ae1b66d0407c01a45061a4e640377337e91c286fa5c330bc162c1f03c",
    "canonicalChanged": true
  },
  {
    "profile": "L2",
    "appliedEvents": 96,
    "textHash": "2f4a74d73ffab493a8127848584272e13c57e74fcb6cad4081470dbda5b65797",
    "canonicalChanged": true
  },
  {
    "profile": "L3",
    "appliedEvents": 98,
    "textHash": "976820cb4b2b830dce136b3a8af6cbf9f1cb48dfc6097b88b541066acd0b8918",
    "canonicalChanged": true
  },
  {
    "profile": "L4",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "L5",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "L6",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "L7",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  },
  {
    "profile": "L8",
    "appliedEvents": 0,
    "textHash": "2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9",
    "canonicalChanged": false
  }
]
```

## 121. Production Text Mutation

0

## 122. Production Timing Mutation

0

## 123. Production ASS Parity

true

## 124. Production SRT Parity

true

## 125. Production VTT Parity

true

## 126. A/B Parity

```json
{
  "semantic": true,
  "exactShadowBytes": {
    "name": "reranking-shadow-and-evaluation-A-B",
    "passed": true,
    "observed": "model/threshold/OOF/joint metrics equal; every shadow file byte-identical",
    "expected": "verified"
  },
  "barrierTimestampsExcluded": true
}
```

## 127. Engineering Gate

true

## 128. Strong Support Gate

```json
{
  "passed": false,
  "checks": [
    {
      "name": "frozen-generation-vs-acceptance-only-source",
      "passed": true,
      "observed": "{\"frozenCodeHash\":\"fa7b54509667b4695e43b9bb7287294f8186af9a223ec3e00ff171d04ea9b73c\",\"acceptanceCodeHash\":\"bbea6279afe25fba6095258bd2f865f370c359f40fa83ac9d13f07fc3b4c84d7\",\"changedPaths\":[\"packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.ts\",\"scripts/report-c6-1-2-top-k-reranking.ts\",\"scripts/validate-c6-1-2-top-k-reranking.ts\",\"tests/c6-1-2-acceptance-contracts.test.ts\"]}",
      "expected": "verified"
    },
    {
      "name": "generation-QA-before-acceptance-repair",
      "passed": true,
      "observed": "14 generation QA stages passed; 6821b7ef906987f5097de0e5c7851a3c4be1b0a62dd87a614d415134c7ac6565",
      "expected": "verified"
    },
    {
      "name": "strict-artifact-schemas-A-B",
      "passed": true,
      "observed": "132",
      "expected": "verified"
    },
    {
      "name": "machine-freeze-A-B",
      "passed": true,
      "observed": "source/files/policy/order hashes equal; only verifier mode differs",
      "expected": "verified"
    },
    {
      "name": "baseline-replay",
      "passed": true,
      "observed": "161 cues; 199 events; 141 eligible",
      "expected": "verified"
    },
    {
      "name": "full-rank-recomputation",
      "passed": true,
      "observed": "1146",
      "expected": "verified"
    },
    {
      "name": "top-k-conservation-recomputation",
      "passed": true,
      "observed": "4584/4584",
      "expected": "verified"
    },
    {
      "name": "correlation-recomputation-no-double-votes",
      "passed": true,
      "observed": "prevented 0; double count 0",
      "expected": "verified"
    },
    {
      "name": "mapping-and-fold-recomputation",
      "passed": true,
      "observed": "113 machine groups; 5 time-blocked folds",
      "expected": "verified"
    },
    {
      "name": "feature-and-contraction-recomputation",
      "passed": true,
      "observed": "38 numeric fields plus missing flags",
      "expected": "verified"
    },
    {
      "name": "candidate-provenance-and-CTC-scope",
      "passed": true,
      "observed": "519 existing targets; no transcript generation",
      "expected": "verified"
    },
    {
      "name": "verifier-accounting",
      "passed": true,
      "observed": "fresh 141; A/B cache 141/141; ASR 0",
      "expected": "verified"
    },
    {
      "name": "verifier-runtime-manifest",
      "passed": true,
      "observed": "{\"python\":\"3.12.14\",\"torch\":\"2.13.0\",\"transformers\":\"5.16.1\",\"numpy\":\"2.5.2\",\"scipy\":\"1.18.1\",\"device\":\"cpu\",\"precision\":\"fp32\",\"threads\":1}",
      "expected": "verified"
    },
    {
      "name": "barrier-and-chronology-A",
      "passed": true,
      "observed": "machine/profile freeze < evaluator numeric labels < OOF shadow freeze",
      "expected": "verified"
    },
    {
      "name": "oof-isolation-A",
      "passed": true,
      "observed": "90 models; 2538 OOF predictions",
      "expected": "verified"
    },
    {
      "name": "linear-training-threshold-replay-A",
      "passed": true,
      "observed": "numeric-label-only replay; zero raw Gold reads",
      "expected": "verified"
    },
    {
      "name": "bounded-joint-configuration-replay-A",
      "passed": true,
      "observed": "CURRENT retained; max16 configurations/max2 changed events",
      "expected": "verified"
    },
    {
      "name": "shadow-byte-replay-and-relative-files-A",
      "passed": true,
      "observed": "18 ASS/SRT/VTT/package replays",
      "expected": "verified"
    },
    {
      "name": "metric-arithmetic-and-retrieval-A",
      "passed": true,
      "observed": "unique fixed-group joint gain; precision excludes neutral; unknown stays null",
      "expected": "verified"
    },
    {
      "name": "read-only-proof-A",
      "passed": true,
      "observed": "source/Gold/production before-after equal; validator did not reopen Gold",
      "expected": "verified"
    },
    {
      "name": "barrier-and-chronology-B",
      "passed": true,
      "observed": "machine/profile freeze < evaluator numeric labels < OOF shadow freeze",
      "expected": "verified"
    },
    {
      "name": "oof-isolation-B",
      "passed": true,
      "observed": "90 models; 2538 OOF predictions",
      "expected": "verified"
    },
    {
      "name": "linear-training-threshold-replay-B",
      "passed": true,
      "observed": "numeric-label-only replay; zero raw Gold reads",
      "expected": "verified"
    },
    {
      "name": "bounded-joint-configuration-replay-B",
      "passed": true,
      "observed": "CURRENT retained; max16 configurations/max2 changed events",
      "expected": "verified"
    },
    {
      "name": "shadow-byte-replay-and-relative-files-B",
      "passed": true,
      "observed": "18 ASS/SRT/VTT/package replays",
      "expected": "verified"
    },
    {
      "name": "metric-arithmetic-and-retrieval-B",
      "passed": true,
      "observed": "unique fixed-group joint gain; precision excludes neutral; unknown stays null",
      "expected": "verified"
    },
    {
      "name": "read-only-proof-B",
      "passed": true,
      "observed": "source/Gold/production before-after equal; validator did not reopen Gold",
      "expected": "verified"
    },
    {
      "name": "reranking-shadow-and-evaluation-A-B",
      "passed": true,
      "observed": "model/threshold/OOF/joint metrics equal; every shadow file byte-identical",
      "expected": "verified"
    },
    {
      "name": "source-and-production-live-parity",
      "passed": true,
      "observed": "canonical/timing unchanged; 6 production files byte-identical",
      "expected": "verified"
    },
    {
      "name": "full-QA-evidence-and-logs",
      "passed": true,
      "observed": "14 stages passed, immutable console logs",
      "expected": "verified"
    },
    {
      "name": "Skill2-Skill3-and-canonical-contracts-unchanged",
      "passed": true,
      "observed": "protected source and original SubtitleCue/SubtitlePackage unchanged",
      "expected": "verified"
    },
    {
      "name": "generated-JSON-schemas",
      "passed": true,
      "observed": "49",
      "expected": "verified"
    },
    {
      "name": "correlationCoverage",
      "passed": true,
      "observed": "1",
      "expected": ">=0.90"
    },
    {
      "name": "completenessCoverage",
      "passed": false,
      "observed": "0.2658959537572254",
      "expected": ">=0.90"
    },
    {
      "name": "changedGroupEvaluationCoverage",
      "passed": false,
      "observed": "unknown",
      "expected": ">=0.80 with actual selections"
    },
    {
      "name": "oracleRecall4",
      "passed": true,
      "observed": "0.9230769230769231",
      "expected": ">=0.90"
    },
    {
      "name": "normalizedJointGain",
      "passed": false,
      "observed": "0",
      "expected": ">0"
    },
    {
      "name": "materialErrors",
      "passed": true,
      "observed": "77",
      "expected": "<=77"
    },
    {
      "name": "fixedGroupMaterialDelta",
      "passed": true,
      "observed": "0",
      "expected": "<=0"
    },
    {
      "name": "catastrophicDeletions",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "precision",
      "passed": false,
      "observed": "unknown",
      "expected": ">=0.85"
    },
    {
      "name": "harm",
      "passed": false,
      "observed": "unknown",
      "expected": "<=0.10 with evaluated selections"
    },
    {
      "name": "evaluatedChangedGroups",
      "passed": false,
      "observed": "0",
      "expected": ">=5"
    },
    {
      "name": "activeFolds",
      "passed": false,
      "observed": "0",
      "expected": ">=3"
    },
    {
      "name": "negativeGainFolds",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "unknownGainFolds",
      "passed": true,
      "observed": "0",
      "expected": "0"
    },
    {
      "name": "top1FullPoolOracleCapture",
      "passed": false,
      "observed": "0.07142857142857142",
      "expected": ">0.4627 historical ceiling; mapping denominator disclosed separately"
    },
    {
      "name": "top1OracleCaptureOverReplayedH2",
      "passed": false,
      "observed": "0.07142857142857142",
      "expected": ">replayed L0 capture on identical V2 labels"
    }
  ]
}
```

## 129. Route Decision

EVALUATION_COVERAGE_INSUFFICIENT

## 130. C6.1.3 GO/HOLD

HOLD

## 131. Runtime Gold Input

```json
{
  "machineStages": 0,
  "rawGoldInTrainer": 0,
  "outerTestLabelsInPrediction": 0,
  "evaluatorRawGoldAuthorized": true,
  "numericTrainingLabelsUsed": true
}
```

## 132. Dataset Hardcoding

```json
{
  "datasetSpecificFeatures": 0,
  "baselineIdentifiers": "replay assertions only, never model features",
  "syntheticJapaneseFixtures": true
}
```

## 133. Network

false

## 134. ASR Inference

0

## 135. Verifier Inference

```json
{
  "fresh": 141,
  "modelLoads": 1,
  "finalAInference": 0,
  "finalBInference": 0
}
```

## 136. Source Read-only

true

## 137. Gold Read-only

true

## 138. Shareable Audit

```json
{
  "schemaVersion": "1.0.0",
  "artifactType": "c6-1-2-shareable-audit",
  "policyVersion": "c6.1.2-top-k-reranking-acoustic-completeness-v1",
  "semanticHash": "1e02c8f0abe217d783b5f72a147b8af921f6947d8aeced87680de2349eef5df8",
  "files": [
    {
      "relativePath": "c6-1-2-shareable-summary.json",
      "sha256": "30ced7f28a27fac70c4016f134633ac6ca3d939703e6ca344a009b2ddc9369e7",
      "size": 12935
    }
  ],
  "checkedFiles": 1,
  "absolutePathLeakCount": 0,
  "secretCount": 0,
  "rawTextFieldCount": 0,
  "brokenRelativeReferenceCount": 0,
  "passed": true,
  "scope": "SHAREABLE_SUMMARY_ONLY_NOT_FULL_LOCAL_ARTIFACTS"
}
```

## 139. C6.1 Regression

```json
[
  {
    "stage": "c6-1-targeted",
    "exitCode": 0,
    "tests": {
      "passed": 113,
      "failed": 0,
      "skipped": 0
    },
    "skipped": []
  }
]
```

## 140. C6.1.1 Regression

```json
[
  {
    "stage": "c6-1-1-targeted",
    "exitCode": 0,
    "tests": {
      "passed": 197,
      "failed": 0,
      "skipped": 0
    },
    "skipped": []
  },
  {
    "stage": "c6-1-1-independent-acceptance",
    "exitCode": 0,
    "tests": null,
    "skipped": []
  }
]
```

## 141. Unit Tests

```json
[
  {
    "stage": "unit",
    "exitCode": 0,
    "tests": {
      "passed": 1202,
      "failed": 0,
      "skipped": 2
    },
    "skipped": [
      "C5.18 local speaker runtime runs real Community-1 inference only when explicitly enabled: existing optional real-model opt-in disabled; no inference in QA",
      "C5.17 optional real MFA integration runs one bounded real align_one attempt and parses word/phone tiers: existing optional real-model opt-in disabled; no inference in QA"
    ]
  },
  {
    "stage": "python-ctc-unit",
    "exitCode": 0,
    "tests": {
      "passed": 6,
      "failed": 0,
      "skipped": 0
    },
    "skipped": []
  }
]
```

## 142. E2E Tests

```json
[
  {
    "stage": "e2e",
    "exitCode": 0,
    "tests": {
      "passed": 60,
      "failed": 0,
      "skipped": 1
    },
    "skipped": [
      "C5.17 optional real MFA integration runs one bounded real align_one attempt and parses word/phone tiers: existing optional real-model opt-in disabled; no inference in QA"
    ]
  }
]
```

## 143. Targeted Tests

```json
[
  {
    "stage": "c6-1-targeted",
    "exitCode": 0,
    "tests": {
      "passed": 113,
      "failed": 0,
      "skipped": 0
    },
    "skipped": []
  },
  {
    "stage": "c6-1-1-targeted",
    "exitCode": 0,
    "tests": {
      "passed": 197,
      "failed": 0,
      "skipped": 0
    },
    "skipped": []
  },
  {
    "stage": "c6-1-2-targeted",
    "exitCode": 0,
    "tests": {
      "passed": 69,
      "failed": 0,
      "skipped": 0
    },
    "skipped": []
  },
  {
    "stage": "historical-targeted",
    "exitCode": 0,
    "tests": {
      "passed": 1077,
      "failed": 0,
      "skipped": 1
    },
    "skipped": [
      "C5.18 local speaker runtime runs real Community-1 inference only when explicitly enabled: existing optional real-model opt-in disabled; no inference in QA"
    ]
  }
]
```

## 144. Schema Count

49

## 145. Artifact Validation

```json
{
  "artifacts": 138,
  "checks": 33,
  "total": 33,
  "validationHash": "8ed282a350fb030ccfd8490589fe503bd1dbdc399de9a4c4e3c94d44d22614ee"
}
```

## 146. Skill Validation

```json
[
  {
    "stage": "skill",
    "exitCode": 0,
    "tests": null,
    "skipped": []
  }
]
```

## 147. Skill2/3

```json
{
  "name": "Skill2-Skill3-and-canonical-contracts-unchanged",
  "passed": true,
  "observed": "protected source and original SubtitleCue/SubtitlePackage unchanged",
  "expected": "verified"
}
```

## 148. Remaining Risks

候选条件CTC不是独立转写真值；当前集已知，固定映射有Unknown；训练折数值标签与原始Gold文件严格分开；主策略不因post-hoc结果而改变；零选择不证明恢复能力。全output是本地研究资料，仅shareable摘要通过可分享审计。

## 149. Next Route

```json
{
  "route": "EVALUATION_COVERAGE_INSUFFICIENT",
  "c613": "HOLD",
  "next": "保留当前证据和固定策略，不授权C6.1.3；下一阶段需单独批准并针对当前失败类别。"
}
```

## 150. Commits

```json
{
  "codeCommit": "02f0b38198587c06ba4fbb386b6e99c309cc12c7",
  "acceptanceCommit": "57442fd6eb68b7537619ae81dbb9265a6d633172",
  "reportCommit": "the commit containing this report; final SHA is recorded in the delivery receipt and final reply"
}
```

## 151. Remote HEAD

最终推送后用 git ls-remote 独立核对；实际SHA见外部 delivery-git-receipt.json，不在报告内伪造自引用commit SHA。

## 152. Output Paths

```json
{
  "a": "carnation-c6-1-2-final-a-v2-20260831",
  "b": "carnation-c6-1-2-final-b-v2-20260831",
  "validation": "acceptance-release-final",
  "qa": "qa-console-release",
  "fresh": "carnation-c6-1-2-acoustic-preflight-20260831"
}
```

## 153. Worktree Status

Machine Freeze证明生成源码未变；验收修订另附源码哈希与完整QA。报告是独立文档提交，最终clean状态及remote/local相等检查见delivery-git-receipt.json。

## Q1–Q20

### Q1

H2 Rank 分布（可评价且有改进空间的事件）：{"1":4,"2":6,"3":1,"4":1,"5+":1}。分布对并列Oracle采用确定性的候选ID代表；Recall@K则允许任一并列Oracle命中，因此代表候选Rank的累计数不必等于Recall分子。

### Q2

T0 Recall@1/2/3/4=38.46%/76.92%/84.62%/92.31%；MRR=0.6217948717948717，nDCG@4=0.7686364308869654。

### Q3

在当前可评价集合中 full-pool oracle gain=42、Top-K gain=38；主策略失败分布={"APPLICATION_GATE_FAILURE":1,"EVALUATION_UNAVAILABLE":115,"NO_ERROR_TO_RECOVER":13,"RERANKING_FAILURE":11,"RETRIEVAL_FAILURE":1}。结论以固定映射覆盖为界，不用Unknown证明候选池充分或不足。

### Q4

事后检索对照最优=T1_RAW_MBR_TOP4，Recall@4=92.31%；预冻结运行主策略仍为T3，不按Gold切换。

### Q5

T3减T0 Recall@4=0；这是整个检索配置对照，不宣称单因素因果。

### Q6

296/519 verified，223 provisional，0 unknown。

### Q7

合并same-audio observation groups=0，阻止重复投票=0；不是把缺失身份当独立支持。

### Q8

Completeness非unknown=26.59%；requestEdgeRisk可计算=27.17%；tokenSupport可计算=95.76%。可计算不等于安全或有支持。

### Q9

旧48项：{"LEADING_DIALOGUE_DELETION":4,"UNEVALUABLE":39,"VALID_SHORTENING":5}。Gold后验有效缩短不等于声学已证实安全；机器unknown继续阻断。

### Q10

Completeness AUC=0.5，safe false-block=1；覆盖=26.59%。以这些证据判断，不以零自动应用宣称区分能力已解决。

### Q11

L0 accuracy/MRR/nDCG=0.34615384615384615/0.5717948717948718/0.7686364308869654；L2=0.34615384615384615/0.5602564102564103/0.4867401797042013；L3=0.3076923076923077/0.5269230769230769/0.5028172905063746。

### Q12

{"left":"A1_TOP_K_TEXT_STRUCTURAL_ONLY","right":"A2_TOP_K_PLUS_CORRELATION","changedFamily":"CORRELATION","normalizedJointGainDifference":9,"top1AccuracyDifference":0,"catastrophicDifference":0,"causal":false}；只报告固定ablation对照，不视为跨数据集因果证据。

### Q13

[{"left":"A1_TOP_K_TEXT_STRUCTURAL_ONLY","right":"A3_TOP_K_PLUS_ACOUSTIC_COMPLETENESS","changedFamily":"ACOUSTIC_FEATURES_AND_GATE_NOT_SINGLE_FAMILY_CAUSAL","normalizedJointGainDifference":20,"top1AccuracyDifference":0,"catastrophicDifference":-3,"causal":false},{"left":"A4_TOP_K_PLUS_CORRELATION_PLUS_COMPLETENESS","right":"A6_WITHOUT_CTC","changedFamily":"CTC_LOSS_FEATURES","normalizedJointGainDifference":0,"top1AccuracyDifference":-0.03846153846153849,"catastrophicDifference":0,"causal":false}]；包含feature与gate同时改变的对照会明确标注，不能归因给单一feature。

### Q14

冻结主策略L6的已应用、可评价组 catastrophic=0、实际选择组=0。若为零选择，只能说明安全回退，不能宣称自动修复能力已验证。

### Q15

主策略active=0/5，negative=0，unknown-gain=0；事后最优L1 active=5，不用于改换主检验策略。

### Q16

主策略improved/regressed/neutral/unknown=0/0/0/0；post-hoc最优对照=L1:7/6/6/91。

### Q17

主策略precision=unknown，harm=unknown，selective coverage=0.00%，normalized joint gain=0，fixed-group material delta=0。事后最高收益对照L1：precision=53.85%，harm=31.58%，selective coverage=100.00%，normalized joint gain=11，fixed-group material delta=1；不用于部署选择。

### Q18

Top-K分母 capture=7.89%；full-pool分母=7.14%；同V2的H2=59.52%。80%目标=未达到或unknown。Top-1/Top-K capture 是 EVENT_COUNTERFACTUAL_DIAGNOSTIC；joint capture 使用有界配置组 oracle。C6.1.1 的 46.27% 是不同覆盖集合上的 H2/full-pool ceiling，不能据此直接宣称同比提升；同 V2 映射的 L0 另行列出。

### Q19

主策略分布={"APPLICATION_GATE_FAILURE":1,"EVALUATION_UNAVAILABLE":115,"NO_ERROR_TO_RECOVER":13,"RERANKING_FAILURE":11,"RETRIEVAL_FAILURE":1}；最大未恢复类别=EVALUATION_UNAVAILABLE。

### Q20

EVALUATION_COVERAGE_INSUFFICIENT；C6.1.3 HOLD。Engineering=true；Strong=false。

## 附录：冻结模型与边界

机器候选/证据/特征/固定映射/分折/模型策略先冻结；独立 evaluator 随后读取 Gold 并生成数值标签；训练进程仅使用训练折数值标签，OOF Shadow 在训练后冻结；最终 evaluator 复用固定映射。学习型 Shadow 并非在首次 Gold 读取前存在。

Top-1/Top-K capture 是 EVENT_COUNTERFACTUAL_DIAGNOSTIC；joint capture 使用有界配置组 oracle。C6.1.1 的 46.27% 是不同覆盖集合上的 H2/full-pool ceiling，不能据此直接宣称同比提升；同 V2 映射的 L0 另行列出。

运行时身份包括Python/torch/transformers版本及worker源码；本次固定本地运行时与历史记录版本不同，已经生成新的runtime identity，未伪称相同。FFmpeg仅重读所选source，CTC不产生转写。

生成源码冻结与最终验收源码分开绑定。独立验收发现历史lattice数组容器注册缺失，以及浮点请求区间与实际PCM样本时基的校验口径不一致；仅修复校验器并新增回归测试。使用原始生成源码checkout验证原有A/B Freeze，逐文件证明检索、证据、完整性、阈值、重排、Gold evaluator及全部既有数据未改写。生成前QA与修订后QA均保留并核验，未在Gold后重建候选、重训模型或改调阈值。

报告交叉检查还区分了一般删除退化与catastrophic=true的严格子集。报告中的Catastrophic Leading/Trailing/Internal只计入已有冻结标记为true的候选；未知标记不计为已确认，候选诊断计数也不是实际应用组的退化数。收缩后验审计保留历史强收缩而本版不再判强的记录，故审计行数可以多于本版Strong Contraction数。该修订仅调整报告汇总并新增回归测试，没有改写标签或质量指标。

### frozen-generation-vs-acceptance-only-source

```json
{
  "frozenCodeHash": "fa7b54509667b4695e43b9bb7287294f8186af9a223ec3e00ff171d04ea9b73c",
  "acceptanceCodeHash": "bbea6279afe25fba6095258bd2f865f370c359f40fa83ac9d13f07fc3b4c84d7",
  "changedPaths": [
    "packages/video-subtitler/src/consensus/top-k/c612-artifact-validator.ts",
    "scripts/report-c6-1-2-top-k-reranking.ts",
    "scripts/validate-c6-1-2-top-k-reranking.ts",
    "tests/c6-1-2-acceptance-contracts.test.ts"
  ]
}
```

### generation-QA-before-acceptance-repair

14 generation QA stages passed; 6821b7ef906987f5097de0e5c7851a3c4be1b0a62dd87a614d415134c7ac6565

报告数据校验：`c06248a2613d06aa38ca6d472bbbad8874ae65a8b247a4c16378c2e6edb2ae07`。
