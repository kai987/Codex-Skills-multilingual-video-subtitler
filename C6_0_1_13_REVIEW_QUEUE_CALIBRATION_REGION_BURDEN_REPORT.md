# C6.0.1.13 Review Queue Calibration & Region Burden Report

Run date: 2026-08-30. Machine freeze 12:54 UTC; post-freeze evaluation generatedAt 13:00 UTC, actual first Gold read recorded separately. Engineering acceptance: PASSED (61/61 checks, 9/9 regression groups). Ranking: WEAK. Burden reduction: UNSAFE. Product route: HOLD_FOR_MISSING_EVIDENCE_REPAIR. Git delivery identity is recorded separately to avoid a self-referential commit hash.

## 1. Executive Conclusion

机器回放、冻结、5-fold OOF 与数据质量审计已完成；质量结论为 **REGION_RANKER_WEAK**，负担结论为 **REVIEW_BURDEN_REDUCTION_UNSAFE**。选择预声明的 deterministic R3 fallback，未部署 learned model。Required unique audio 虽从 659.033s 降到 56.280s，但 mandatory queue 漏掉 hallucination 1/1 与 missing dialogue 6/6，不能宣称安全减少审核负担。

本集仅用于calibration。限定validator修正后的正式工程验收为61/61 checks、9/9 regression groups通过，0 failed/0 not-run；这不改变quality failure。最终保持needs-review、finalizationMethod=none、C6.0.2 HOLD，未执行真实human trial，也未测量人工省时。验收semantic hash为`86da178e31dfc368967de5a84f4b42ea31f1575b939b0ed4aef60498a45f9672`；远程提交身份由§148–149的独立git receipt确认。

## 2. Branch

`codex/c6-0-1-13-review-rank-region-burden`。基于既有 C6.0.1.12 实现追加；没有另建产品。

## 3. Baseline

源时长 900.01s；machine draft 161 cues。上游 review freeze `873a5eaacbd25fa503850ba657fc3f0d18a694608f5e97c9fbd7a971d9273af8`；machine draft `b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e`。

## 4. C6.0.1.12 Replay

C6.0.1.12 items、priority、regions、candidates 四项重放语义 parity 均为 true。旧 strict quality evaluation 与 machine-vs-Gold evaluator 的 artifact/hash/lineage 被复用，没有重定义 Gold 匹配规则。

## 5. Goals

校准 missing-speech 证据强度、拆分相关证据、建立 region-first 唯一音频预算、完成机器特征预冻结和 OOF 排序比较，并提供下一集可复现的审核与 trial 工具。

## 6. Non-goals

不修正文案、时间轴或候选正文；不运行 ASR/pyannote/CTC；不让 Gold 进入机器输入；不承诺零接触终稿；不以本集回顾式回放充当前瞻人工实验。

## 7. Why Workspace Is Not Rebuilt

复用 C6.0.1.12 的事务、候选、音频交付与 review workspace。C6.0.1.13 增加 region/priority/budget/trial 适配层，避免改动已验证的数据合同。

## 8. Why Episode 1 Is Calibration-only

Episode 1 已被人工及 Gold 评估观察，存在既往暴露，不能提供独立 prospective/generalization 证据。全部本集数字只标记 calibration 或自动化 UI 验证。

## 9. Review Item Baseline

153 items；legacy missing-risk 59；critical 61。全部原 item ID 留作审计 lineage，没有删除低优先级问题来降低分母。

## 10. Region Baseline

原始 45 regions；新 region v2 50。旧 region baseline 在 A0 保留原 membership，不以新 region max 伪装原始队列。

## 11. Required Baseline

旧 required 63 items / 30 regions，required unique ratio 73.23%。这是需接受安全检查的 baseline，不是可随意降低的指标。

## 12. Clip-sum Audio

实际交付WAV时长和（actualClipSumSeconds）旧为939.307500s，新为954.950000s；45→50 clips使实际音频文件总时长略增。计划context时长和（plannedContextSumSeconds）旧为939.305038s、新为904.945476s。真实WAV有提取padding与采样量化，两个口径不能混用。

## 13. Unique-union Audio

旧计划source-global context interval union（plannedUnion/uniqueUnionSeconds）=830.447571s，约92.27%集长；新计划union=817.433508s。实际提取WAV区间union（extractedClipUnionSeconds）前后均约830.450196s，包含padding；预算依据计划union，不依据实际提取union。

## 14. Duplicate Context

重复计划上下文按plannedContextSum−plannedUnion计算：旧108.857466s、新87.511967s。旧baseline artifact的duplicateAudioSeconds=108.859929s是actualClipSum−plannedUnion的历史混合口径，保留原始产物但不把它作为新版plannedDuplicate指标。该差额不是已观测到的人类节省时间。

## 15. Priority Score Distribution

旧 22 个分值，熵 3.290 bits；新 56 个 display 分值，115 个结构向量 rank key，熵 4.563 bits。显示分数不是错误概率。

## 16. 100-point Saturation

旧100分共有 61/153（39.87%），导致大范围饱和。新最高72.9分仅1项；未使用随机抖动制造差异。

## 17. Missing Speech Over-trigger

旧59个 missing-risk items 中，按既有 Gold lineage 12 TP /47 FP（20.34% item precision）。多个 item 可能覆盖同一缺失组件；这与 gap 或 error-component 分母不同。

## 18. Missing Evidence V2

| Machine classification        | Distinct gaps | TP gaps | FP gaps | Precision if asserted missing | Captured missing components |
| ----------------------------- | ------------- | ------- | ------- | ----------------------------- | --------------------------- |
| SPEECH_GAP_OBSERVED           | 16            | 3       | 13      | 18.75%                        | 5                           |
| MISSING_DIALOGUE_POSSIBLE     | 5             | 0       | 5       | 0.00%                         | 0                           |
| MISSING_DIALOGUE_STRONG       | 0             | 0       | 0       | N/A                           | 0                           |
| MISSING_DIALOGUE_CONTRADICTED | 4             | 0       | 4       | 0.00%                         | 0                           |
| MISSING_DIALOGUE_UNRESOLVED   | 29            | 0       | 29      | 0.00%                         | 0                           |

54 distinct gaps 来自59 legacy items。上表是冻结后的评估，不把 OBSERVED/UNRESOLVED 重新升级成 missing assertion。

## 19. Speech Gap Observed

Gap口径为16/54 SPEECH_GAP_OBSERVED；旧59 missing-risk items的最终item分类口径则为39/59 OBSERVED。其中3个observed gap的旧item lineage覆盖5个Gold missing components。检测到语音空隙，不代表已证明可辨识且遗漏的对白。

## 20. Missing Possible

5 MISSING_DIALOGUE_POSSIBLE；0个 gap 覆盖已标记 Gold missing component。保持非 mandatory，并保留证据不足的原因。

## 21. Missing Strong

0 MISSING_DIALOGUE_STRONG，strong recall=0/6；strong precision 无正预测分母，记 N/A，而非100%。未因 Gold 结果放宽三独立证据族、lexical、coverage、timebase 或 contradiction 门槛。

## 22. Missing Contradicted

4 CONTRADICTED、29 UNRESOLVED，均未命中已标记 missing components。Contradiction 不等于自动删除人类可见问题；UNRESOLVED 也不应作为强风险加分。

## 23. Evidence Families

1229 条 evidence，14 个 family，638 个 correlation groups。226 项 evidence absence；absenceRiskBoost=0。

## 24. Evidence Correlation

591 条相关 evidence 被消除重复增益。共享 root、同 provider family 不可当作多份独立支持；missing 子域相关去重40。不存在 reason-count 简单累加。

## 25. Legacy Migration

Legacy MISSING_DIALOGUE_SUSPECTED 默认迁移为 SPEECH_GAP_OBSERVED；仅经来源、时间基准、声学/lexical/coverage等现有证据验证后才可能升级。59原item保留；54 gap去重并显式记录缺失provenance。

最终59-item互斥分类：OBSERVED39、POSSIBLE1、STRONG0、CONTRADICTED1、UNRESOLVED18。一个item可关联多个gap，因此不能把54-gap分类数量直接当成item分类数量。若只问“关联任意observed gap”的item则为40/59；其中1项还关联possible gap并最终归POSSIBLE，故最终OBSERVED答案是39/59。共有4items跨不同gap分类，未映射item=0。

## 26. Missing Gold Recall

Any-gap recall=5/6 (83.33%)；STRONG=0/6；mandatory=0/6。仍未达到6/6。

| Gold component suffix | Source seconds  | Any gap | Strong | Failure reason                                       |
| --------------------- | --------------- | ------- | ------ | ---------------------------------------------------- |
| 0073                  | 425.080–427.970 | yes     | no     | positive lexical/independence/coverage gates not met |
| 0074                  | 428.810–431.790 | yes     | no     | positive lexical/independence/coverage gates not met |
| 0097                  | 658.550–662.970 | yes     | no     | positive lexical/independence/coverage gates not met |
| 0098                  | 664.870–668.380 | yes     | no     | positive lexical/independence/coverage gates not met |
| 0099                  | 669.440–671.420 | no      | no     | no frozen item/gap lineage                           |
| 0137                  | 887.940–890.300 | yes     | no     | positive lexical/independence/coverage gates not met |

0073/0074 共享1 gap，0097/0098 共享1 gap，0137另1 gap。0099在既有机器 review item 中没有关联；不能用 Gold 补造 item。

## 27. Missing False Positives

Distinct-gap 口径：3/54 命中，51/54未命中；若把全部 gap 误作 missing assertion，precision仅5.56%。Legacy-item 口径：12/59命中，47/59未命中。错误组件口径：5/6覆盖。三个分母必须分别报告。

## 28. Priority Vector

向量含 mandatorySafetyClass、positiveEvidenceStrength、independentEvidenceFamilyCount、errorTypeSeverity、crossModelConflictStrength、hallucinationStrength、missingStrength、timingStrength、candidateActionability、localizationQuality、estimatedReviewCost、sourceTime。最后一项仅路由/确定性 tie-break，不是 learned predictor。

## 29. Required-level Semantics

Required 与 display score 解耦：只由可信 positive safety evidence / structural corruption 支持。没有“高分即 mandatory”，也没有把 UNKNOWN、证据缺失或旧风险文字当作正证据。Required减少必须另过Gold安全检查。

## 30. Saturation After

最高分占比 0.65%。仍有 44 项在低信息分4.2并列，这是同样缺少可区分证据造成，不能声称所有 ties 已消失。

## 31. Region-first Architecture

人工导航以 region 为首级，item作为细节/纠错目标。模型学习和预算选择也以 region为单位，但 error-component recall 仍用不变的Gold组件分母。

## 32. Region Clustering V2

Clustering v2 限定 source-global interval，core≤30s、gap≤0.75s、context overlap≥0.4、incremental≤12s，前后 context各1.5s；保留scene/speaker/category边界。新50regions，未无限合并成超长片段。

## 33. Playback Timeline

机器抽象 playback union 保留15 source-global segments；UI执行层按选定 region 与真实 WAV 覆盖边界拆分，避免预算外播放或丢失尾部。两个层次的 segment 数量不同但 unique seconds须一致。

## 34. Clip-sum vs Unique-union

| Queue     | Actual WAV sum s | Planned context sum s | Planned union s | Extracted WAV union s | Planned duplicate s |
| --------- | ---------------- | --------------------- | --------------- | --------------------- | ------------------- |
| C6.0.1.12 | 939.307500       | 939.305038            | 830.447571      | 830.450196            | 108.857466          |
| C6.0.1.13 | 954.950000       | 904.945476            | 817.433508      | 830.450196            | 87.511967           |

WAV sum不是预算，extracted union包含padding，不等于planned union。实际交付音频总时长增加，但计划试听union减少；两项事实同时保留。

## 35. Incremental Playback

每次加入region重新计算 selected interval union的增量。重叠上下文不重复扣预算；budget-feasible扫描允许略过放不下的region，但不超出所选context预算，也不虚报已听。

## 36. Region Risk Density

R3按新风险覆盖、强度与severity，并结合mandatory/actionable覆盖和唯一音频增量排序，不直接取item最大分。模型R4只替换risk-strength估计，仍使用相同production selector。

## 37. Fixed Review Overhead

Fixed review overhead=8s，minimum audio cost=1s。两者是预声明成本常量，不是由本集Gold拟合，也不代表已测得的人工操作时间。

## 38. Marginal Utility

边际utility：新增去重risk coverage×positive strength×severity +4×新增mandatory coverage +0.5×新增actionable coverage −0.15×redundancy；再除以8+max(1,incremental unique audio)。每步重算，所有ranker部署与评估复用同一选择器。

## 39. Burden Plans

提供unique audio 10/20/30/40/50%、90/180/270/360/450s、ALL_MANDATORY和FULL_QUEUE共12计划。百分比基于900.01s集长，不用clip-sum作分母。

| Unique budget | Used seconds | Regions | Material recall | Timing recall | Hallucination | Missing | Region precision |
| ------------- | ------------ | ------- | --------------- | ------------- | ------------- | ------- | ---------------- |
| 10%           | 87.280       | 5       | 14.29%          | 15.09%        | 0.00%         | 0.00%   | 80.00%           |
| 20%           | 178.925      | 10      | 25.97%          | 28.30%        | 0.00%         | 0.00%   | 70.00%           |
| 30%           | 267.552      | 12      | 36.36%          | 33.96%        | 100.00%       | 0.00%   | 83.33%           |
| 40%           | 358.718      | 18      | 49.35%          | 41.51%        | 100.00%       | 0.00%   | 77.78%           |
| 50%           | 449.653      | 24      | 59.74%          | 54.72%        | 100.00%       | 0.00%   | 83.33%           |

## 40. Unique Audio 10%

R3 budget=90.001s，实际 87.280s，5 regions/17 items；material=14.29%，timing=15.09%，hallucination=0.00%，missing=0.00%。这是机器预定计划的coverage评估，不是已完成试听。

## 41. Unique Audio 20%

R3 budget=180.002s，实际 178.925s，10 regions/38 items；material=25.97%，timing=28.30%，hallucination=0.00%，missing=0.00%。这是机器预定计划的coverage评估，不是已完成试听。

## 42. Unique Audio 30%

R3 budget=270.003s，实际 267.552s，12 regions/58 items；material=36.36%，timing=33.96%，hallucination=100.00%，missing=0.00%。这是机器预定计划的coverage评估，不是已完成试听。

## 43. Unique Audio 40%

R3 budget=360.004s，实际 358.718s，18 regions/71 items；material=49.35%，timing=41.51%，hallucination=100.00%，missing=0.00%。这是机器预定计划的coverage评估，不是已完成试听。

## 44. Unique Audio 50%

R3 budget=450.005s，实际 449.653s，24 regions/81 items；material=59.74%，timing=54.72%，hallucination=100.00%，missing=0.00%。这是机器预定计划的coverage评估，不是已完成试听。

## 45. All Mandatory

ALL_MANDATORY=2 regions/2 items/56.280s；material 10.39%、timing 13.21%、hall0/1、missing0/6。不能作为安全完审子集。

## 46. Required Item Reduction

Required item63→2（96.83% nominal reduction），全部153item仍在。降低标签数本身不构成成功。

## 47. Required Region Reduction

Required region30→2（93.33% nominal reduction）；45→50的新clustering边界使比较需同时看unique seconds和安全召回。

## 48. Required Unique-audio Reduction

659.033→56.280s（91.46% nominal reduction）。这是UNSAFE reduction，不能转换成人工省时结论。

## 49. Machine Region Features

24个structural features，展开72 predictors（value+UNKNOWN+UNAVAILABLE indicator）。50 regions；feature hash `d3798c30bbae93aa782ed9ffbd31268d552b7d03f253f5982f4a00ca7d43b992`。

## 50. Feature Leakage Audit

没有原始文本、Gold字符串、item/cue/event ID、episode identity或绝对source timestamp predictor。ID仅关联/审计；scene/speaker仅分组或计数。未知与不可用分开：speechCompleteness/requestEdgeRisk各50 UNKNOWN；acousticMargin50 UNAVAILABLE；candidateActionableCount50个真实0。

## 51. Gold Labels

先冻结machine artifacts/features/folds，再读取Gold；155 frozen files已验证，首Gold读取 `2026-08-30T13:02:41.713Z`。Labels hash `6cf06b293c688a818c8395ee8028a31701a11a44b0fe762b9127b4bd009b7708`。不重新搜索Gold，不用Gold创建候选。

## 52. Error Components

137唯一error components：77 material text、53 severe timing、1 hallucination、6 missing dialogue。旧evaluator defect/alignment IDs直接迁移；无review lineage的错误仍保留，不能因无可选region而从分母删除。

## 53. Fold Construction

机器-only grouping形成10个不可拆分audio-connected groups，分为5个连续time-blocked folds（13/15/8/12/2 regions）。Overlap及≤1.5s邻近上下文、邻近共享scene/speaker保护同组；在label读取前冻结，未按标签重排。Fold hash `36a2f9cf679bf84a36c075aa49312ddbb47420ba57303d26c2963383b6836ace`。

## 54. Audio Leakage Audit

cross-fold audio overlap=0。Train/test同一context音频不可两边出现；组和邻近窗口不可拆开。第5fold只有2regions，是机器分组的真实小样本限制，不为改善指标而合并/重分。

## 55. OOF Method

L2 logistic regression，固定L2=1、600 steps、class weights、train-only median imputation和scaling，数值缺失另有indicator。每region恰好1 held-out OOF score；无test preprocessing拟合、无全量训练预测充当正式指标。OOF分数标为ranking score，不是校准概率。

## 56. R0 Current Item Rank

`R0_CURRENT_ITEM_PRIORITY`；五预算material/timing平均=31.54%，negative fold=0/5。

| Unique budget | Used seconds | Regions | Material recall | Timing recall | Hallucination | Missing | Region precision |
| ------------- | ------------ | ------- | --------------- | ------------- | ------------- | ------- | ---------------- |
| 10%           | 88.975       | 6       | 9.09%           | 7.55%         | 100.00%       | 0.00%   | 66.67%           |
| 20%           | 179.408      | 9       | 16.88%          | 18.87%        | 100.00%       | 0.00%   | 66.67%           |
| 30%           | 269.821      | 14      | 33.77%          | 35.85%        | 100.00%       | 0.00%   | 71.43%           |
| 40%           | 358.641      | 19      | 41.56%          | 49.06%        | 100.00%       | 33.33%  | 73.68%           |
| 50%           | 449.634      | 22      | 48.05%          | 54.72%        | 100.00%       | 66.67%  | 81.82%           |

R0_CURRENT_ITEM_PRIORITY是把旧item分数映射到同一新region集合；原生旧region队列另见A0，不能把二者混称。

## 57. R1 Current Region Max

`R1_CURRENT_REGION_MAX`；五预算material/timing平均=32.31%，negative fold=0/5。

| Unique budget | Used seconds | Regions | Material recall | Timing recall | Hallucination | Missing | Region precision |
| ------------- | ------------ | ------- | --------------- | ------------- | ------------- | ------- | ---------------- |
| 10%           | 88.975       | 6       | 9.09%           | 7.55%         | 100.00%       | 0.00%   | 66.67%           |
| 20%           | 179.408      | 9       | 16.88%          | 18.87%        | 100.00%       | 0.00%   | 66.67%           |
| 30%           | 269.821      | 14      | 33.77%          | 35.85%        | 100.00%       | 0.00%   | 71.43%           |
| 40%           | 357.441      | 19      | 42.86%          | 50.94%        | 100.00%       | 33.33%  | 78.95%           |
| 50%           | 449.733      | 25      | 50.65%          | 56.60%        | 100.00%       | 50.00%  | 80.00%           |

旧region score通过真实旧membership映射；原生A0保留旧45regions。

## 58. R2 Missing-calibrated

`R2_MISSING_CALIBRATED_DETERMINISTIC`；五预算material/timing平均=33.27%，negative fold=4/5。

| Unique budget | Used seconds | Regions | Material recall | Timing recall | Hallucination | Missing | Region precision |
| ------------- | ------------ | ------- | --------------- | ------------- | ------------- | ------- | ---------------- |
| 10%           | 88.280       | 5       | 12.99%          | 15.09%        | 0.00%         | 33.33%  | 80.00%           |
| 20%           | 177.349      | 9       | 22.08%          | 22.64%        | 0.00%         | 33.33%  | 77.78%           |
| 30%           | 269.772      | 13      | 32.47%          | 33.96%        | 100.00%       | 33.33%  | 84.62%           |
| 40%           | 358.934      | 15      | 41.56%          | 45.28%        | 100.00%       | 33.33%  | 86.67%           |
| 50%           | 449.879      | 21      | 51.95%          | 54.72%        | 100.00%       | 33.33%  | 85.71%           |

R2来源于预冻结A1 missing-only映射，不用最终结构化display score冒充missing-only消融。

## 59. R3 Risk-density V3

`R3_REGION_RISK_DENSITY_V3`（本轮选定fallback）；五预算material/timing平均=35.93%，negative fold=1/5。本文所有fold gain比较基准均为 `C60112_R3_FULL_EVIDENCE_RANK` 在同一冻结fold、同一新region集合上的投影，使用fold-local unique-audio预算；不是原生45-region A0，也不是R0 chronological。

| Unique budget | Used seconds | Regions | Material recall | Timing recall | Hallucination | Missing | Region precision |
| ------------- | ------------ | ------- | --------------- | ------------- | ------------- | ------- | ---------------- |
| 10%           | 87.280       | 5       | 14.29%          | 15.09%        | 0.00%         | 0.00%   | 80.00%           |
| 20%           | 178.925      | 10      | 25.97%          | 28.30%        | 0.00%         | 0.00%   | 70.00%           |
| 30%           | 267.552      | 12      | 36.36%          | 33.96%        | 100.00%       | 0.00%   | 83.33%           |
| 40%           | 358.718      | 18      | 49.35%          | 41.51%        | 100.00%       | 0.00%   | 77.78%           |
| 50%           | 449.653      | 24      | 59.74%          | 54.72%        | 100.00%       | 0.00%   | 83.33%           |

## 60. R4 Linear OOF Ranker

`R4_LINEAR_OOF_REGION_RANKER`；五预算material/timing平均=37.07%，negative fold=1/5。

| Unique budget | Used seconds | Regions | Material recall | Timing recall | Hallucination | Missing | Region precision |
| ------------- | ------------ | ------- | --------------- | ------------- | ------------- | ------- | ---------------- |
| 10%           | 87.280       | 5       | 14.29%          | 15.09%        | 0.00%         | 0.00%   | 80.00%           |
| 20%           | 178.925      | 10      | 25.97%          | 28.30%        | 0.00%         | 0.00%   | 70.00%           |
| 30%           | 267.552      | 12      | 36.36%          | 33.96%        | 100.00%       | 0.00%   | 83.33%           |
| 40%           | 357.854      | 15      | 50.65%          | 45.28%        | 100.00%       | 0.00%   | 86.67%           |
| 50%           | 448.063      | 20      | 62.34%          | 58.49%        | 100.00%       | 0.00%   | 85.00%           |

R4平均有改善，但@30和@50门槛及missing safety不达标，不能冻结learned model。

## 61. Fold 1

13 regions（positive 11/negative 2），source block 12.871–87.456; 92.662–269.249s。R4 @30 unique=76.367s；material 31.58%，timing 40.00%；相对同fold的C60112_R3_FULL_EVIDENCE_RANK投影，material/timing均值差+4.035pp。

## 62. Fold 2

15 regions（positive 11/negative 4），source block 272.449–477.910; 480.910–513.910s。R4 @30 unique=68.531s；material 37.50%，timing 41.18%；相对同fold的C60112_R3_FULL_EVIDENCE_RANK投影，material/timing均值差−2.083pp。

## 63. Fold 3

8 regions（positive 7/negative 1），source block 530.910–556.850; 559.910–670.910s。R4 @30 unique=40.520s；material 35.71%，timing 33.33%；相对同fold的C60112_R3_FULL_EVIDENCE_RANK投影，material/timing均值差+16.270pp。

## 64. Fold 4

12 regions（positive 6/negative 6），source block 678.500–772.542; 774.502–858.500s。R4 @30 unique=53.064s；material 35.00%，timing 36.36%；相对同fold的C60112_R3_FULL_EVIDENCE_RANK投影，material/timing均值差+9.545pp。

## 65. Fold 5

2 regions（positive 2/negative 0），source block 872.500–883.425; 886.499–891.889s。R4 @30 unique=5.390s；material N/A（0 gold material errors），timing 0.00%；相对同fold的C60112_R3_FULL_EVIDENCE_RANK投影，material/timing均值差0.000pp。

## 66. Negative Fold Analysis

相对同fold的C60112_R3_FULL_EVIDENCE_RANK投影，选定R3的fold1–5收益为+4.035、−2.083、+12.698、+9.545、0pp；R4 OOF为+4.035、−2.083、+16.270、+9.545、0pp。二者均有fold2负收益，不能用pooled均值掩盖。Fold5 material分母0，报告为N/A（schema ratio约定1不能被当成成功样本）。没有后验改组、调权或再训练同版本追分。

## 67. Pooled OOF Results

| Ranker                              | Mean material/timing 10–50 | Negative folds | Material@30 | Timing@30 | Material@50 | Timing@50 |
| ----------------------------------- | -------------------------- | -------------- | ----------- | --------- | ----------- | --------- |
| R0_CURRENT_ITEM_PRIORITY            | 31.54%                     | 0              | 33.77%      | 35.85%    | 48.05%      | 54.72%    |
| R1_CURRENT_REGION_MAX               | 32.31%                     | 0              | 33.77%      | 35.85%    | 50.65%      | 56.60%    |
| R2_MISSING_CALIBRATED_DETERMINISTIC | 33.27%                     | 4              | 32.47%      | 33.96%    | 51.95%      | 54.72%    |
| R3_REGION_RISK_DENSITY_V3           | 35.93%                     | 1              | 36.36%      | 33.96%    | 59.74%      | 54.72%    |
| R4_LINEAR_OOF_REGION_RANKER         | 37.07%                     | 1              | 36.36%      | 33.96%    | 62.34%      | 58.49%    |
| R0_CHRONOLOGICAL                    | 30.16%                     | 2              | 25.97%      | 28.30%    | 51.95%      | 56.60%    |
| C60112_R3_FULL_EVIDENCE_RANK        | 32.31%                     | 0              | 33.77%      | 35.85%    | 50.65%      | 56.60%    |
| C60112_R2_DISAGREEMENT_ONLY         | 34.46%                     | 2              | 33.77%      | 39.62%    | 53.25%      | 56.60%    |

Native A0–A7 ablations（所有137 Gold组件分母相同）：

| Stage | Regions | Required regions | Material@30 | Timing@30 | Material@50 | Timing@50 | Missing@50 | Mandatory unique s |
| ----- | ------- | ---------------- | ----------- | --------- | ----------- | --------- | ---------- | ------------------ |
| A0    | 45      | 30               | 33.77%      | 37.74%    | 48.05%      | 54.72%    | 33.33%     | 659.033            |
| A1    | 45      | 2                | 28.57%      | 35.85%    | 50.65%      | 50.94%    | 66.67%     | 70.260             |
| A2    | 45      | 2                | 28.57%      | 37.74%    | 48.05%      | 50.94%    | 66.67%     | 70.260             |
| A3    | 45      | 2                | 32.47%      | 35.85%    | 51.95%      | 49.06%    | 66.67%     | 70.260             |
| A4    | 50      | 2                | 32.47%      | 32.08%    | 54.55%      | 54.72%    | 33.33%     | 56.280             |
| A5    | 50      | 2                | 36.36%      | 33.96%    | 59.74%      | 54.72%    | 0.00%      | 56.280             |
| A6    | 50      | 2                | 36.36%      | 33.96%    | 62.34%      | 58.49%    | 0.00%      | 56.280             |
| A7    | 50      | 2                | 36.36%      | 33.96%    | 59.74%      | 54.72%    | 0.00%      | 56.280             |

A0旧native45region；A1missing-only；A2evidence families；A3structured items；A4region v2；A5risk-density；A6held-out OOF；A7冻结选择策略（本次fallback）。A0–A5每fold用global计划投影；R4 fold比较用fold-local预算，二者基准明确分开，不混同。

## 68. Material Recall@UniqueAudio10

Material recall@10%：R4 OOF 14.29%；选定R3 14.29%；同新region旧R3 9.09%。分母77。

## 69. @20

Material recall@20%：R4 OOF 25.97%；选定R3 25.97%；同新region旧R3 16.88%。分母77。

## 70. @30

Material recall@30%：R4 OOF 36.36%；选定R3 36.36%；同新region旧R3 33.77%。分母77。

## 71. @40

Material recall@40%：R4 OOF 50.65%；选定R3 49.35%；同新region旧R3 42.86%。分母77。

## 72. @50

Material recall@50%：R4 OOF 62.34%；选定R3 59.74%；同新region旧R3 50.65%。分母77。

## 73. Timing Recall@UniqueAudio10

Severe timing recall@10%：R4 OOF 15.09%；选定R3 15.09%。分母53。

## 74. @20

Severe timing recall@20%：R4 OOF 28.30%；选定R3 28.30%。分母53。

## 75. @30

Severe timing recall@30%：R4 OOF 33.96%；选定R3 33.96%。分母53。

## 76. @40

Severe timing recall@40%：R4 OOF 45.28%；选定R3 41.51%。分母53。

## 77. @50

Severe timing recall@50%：R4 OOF 58.49%；选定R3 54.72%。分母53。

## 78. Hallucination Recall

唯一hallucination在R3/R4 @10/20未覆盖，@30/40/50覆盖；ALL_MANDATORY未覆盖。不能只挑选@50的1/1忽略mandatory safety failure。

## 79. Missing Dialogue Recall

6个missing components在R3/R4 @10–50均未覆盖，FULL_QUEUE覆盖5/6，ALL_MANDATORY覆盖0/6。证据族缺乏可独立升级为STRONG的lexical支持，成本密度又延后了长/低强度gap；本轮未利用Gold强行置顶或补造0099。

## 80. Review Precision

Region precision（选中regions中至少有1个Gold错误的比例）R3 @30=83.33%、@50=83.33%；R4 @50=85.00%。这是region precision，不是missing item precision，也不是纠错候选准确率。

## 81. Residual Error

R3 @50 residual error rate=44.53%（61/137未覆盖）；R4 @50=41.61%（57/137）。FULL_QUEUE residual=11.68%（16/137），说明仅改善排序仍无法修复无itemlineage错误。

## 82. Region-level Recall

50regions中37个至少覆盖1个Golderror；R3 @30覆盖10/37个positive regions（27.03%），@50覆盖20/37（54.05%）；R4 @50覆盖17/37（45.95%）。与error-component recall不同：一个region可含多个错误，不得重复计数Gold组件。

## 83. Candidate Actionability

机器特征candidateActionableCount在50regions均为真实0；没有把可查看但不可安全应用的partial candidate写成actionable。保留手工编辑基础与部分候选lineage，但不宣称自动纠错成功。

## 84. Score Saturation Result

100-point saturation消除；最高分1/153，score entropy 4.563。仍保留44项4.2的信息不足并列；独立证据不足是真实状态，不人为制造排序置信度。

## 85. Best Ranker

若只看10–50% material/timing平均，R4=37.07%高于R3=35.93%；但产品选择必须服从预声明安全门槛。最终部署候选为R3 deterministic fallback，不宣称learned最佳/已验证泛化。

## 86. Ranker Freeze

Freeze hash `8d0df97850a0210e337a4c4eba49e5830a0f2bc532f63284d01c648b066fc7b7`；rankerType=REGION_RISK_DENSITY_V3，model=null，trainingDatasetHash=null，future-unreviewed-episodes-only。部署导出仅允许feature names、固定政策、模型/scaler字段；丢弃trainIDs、Gold、labels与evaluation paths。

## 87. Required Unique-audio Ratio

Required unique ratio=6.25%，数值低于40/50%预算门槛，但hall/missing召回失败；比例门槛不能单独解释为strong/promising。

## 88. Strong Burden Gate

Strong ranking需要material/timing @30≥60%、@50≥80%，优于旧rank/chronological，且hall+missing@50与mandatory均100%。本轮不满足。Strong burden的≤40% ratio必须安全，不能绕过上述失败。

## 89. Promising Burden Gate

Promising ranking需要material/timing @30≥45%、@50≥65%，及全部safety条件。R4@30=36.36/33.96%、@50=62.34/58.49%，missing=0，均不足；≤50%burden ratio也不救活该结论。

## 90. Unsafe Reduction Check

结论明确为 REVIEW_BURDEN_REDUCTION_UNSAFE。A0 mandatory覆盖hall1/1、missing5/6；A1–A3因旧clustering旁带覆盖missing2/6；A4以后更窄region去掉旁带后为0/6。不得把这些旁带音频当作独立正证据，也不得隐藏安全损失。

## 91. Region-first Workspace

在已有workspace中加入region queue、item details、证据族、missing分类、budget UI。原C6.0.1.12事务锁、幂等、atomic patch、undo/finalize保护继续使用。

## 92. Budget UI

UI提供10/20/30/40/50%、ALL_MANDATORY、FULL_QUEUE；执行计划数量为4/9/11/17/23/2/48个WAV映射步骤。对应unique seconds精确等于机器budget计划，而不是直接播放整段union的任意clip。

## 93. Unique Audio Progress

实际playback按source-global已播放interval union累计；不以点击、timeupdate目标位置或seek跨度虚报完成。监听音频、复听和手工编辑时间分开。

## 94. Played Interval Tracking

记录played intervals并去重；seek、pause、切换region/plan会切分活动区间。实际浏览器已验证+0.5s source offset、暂停详情、skip/resume及预算边界行为；不是人工trial计时。

## 95. Continuous Timeline

Continuous timeline编译器沿选定region的真实WAV范围拆分，禁止预算spill和尾部丢失。最终UI asset hash为 `df9cfed1416190c0243e2516c0c4ccfdb4da0a857cefbfe4303512d626a873cd`。边界播放、等长编辑/base-copy/IME计数与session symlink保护均为machine freeze后的UI/安全修复；review-data hash仍为 `7628241742bc8ff9a36fc51a47011744061e735aa0e36838b5f0367a4affe2f3`，machine freeze仍为 `535d4ab88301b15947bf6ed492fcbd4bfc6b51ee4b199dd25fc2a8628b491f33`。没有改变features、folds、priority、Gold labels或评价结果。

## 96. Missing Speech UI

Missing UI区分 OBSERVED、POSSIBLE、STRONG、CONTRADICTED、UNRESOLVED；证据不足不显示为已确认遗漏，也不自动转为REQUIRED。

## 97. Partial Candidate Editing Base

Partial candidate只能作为明确选中的editing base；保留initialEditingCandidateId、candidateUsedAsEditingBase、editDistanceFromCandidate及原machine baseline，允许人工补全文本，不将partial候选自动整句替换。没有另行虚构textOrigin字段。

## 98. Diff Highlight

Diff highlight区分原machine text、候选base和人工变化，不隐式改变canonical。浏览器验证在隔离副本上进行。

## 99. Correction Capture V2

Correction capture v2在原humanCorrectionRecord的beforeText/afterText、decisionType、selectedCandidateId、machine/evidence hashes上追加可选reviewInstrumentation：regionRank、reviewBudget、uniqueAudioSecondsBeforeDecision、playedSecondsBeforeDecision、candidateUsedAsEditingBase、initialEditingCandidateId、editDistanceFromCandidate、decisionLatencySeconds和playbackCount。没有新增mixed-script或text-origin专用字段。隔离Episode1副本自动执行MANUAL_EDIT+undo+reload通过，正式machine包不变；自动化操作不是real-human correction数据。

## 100. Trial Instrumentation

CLI提供init/start/pause/resume/complete/validate/export/serve/package及session/hash绑定、played union、复听、edit base计数、active-time日志。本版没有专门budget-change event；reviewBudget记录于decision instrumentation。instrumentation可用不代表已有人工效益证据。

## 101. Trial Event Log

Trial events要求episode/ranker/package identity、monotonic sequence、event timestamps、state transition合法；模拟与REAL_HUMAN明确隔离。事件append-only并有hash chain/pending recovery；session根目录及任意session文件的symlink均被拒绝，包含SQLite和trial日志，防止写入预期目录之外。日志没有Gold正文或私有路径。

## 102. Active Time Definition

Active review time按focused、visible、最近有效互动的活动区间累计，heartbeat增量上限5s；playback、编辑、空闲、暂停分别记账，不把窗口打开时间直接当review time。固定8soverhead也不混入实际计时。

## 103. Idle Handling

失焦/暂停/超过60s idle阈值不计为持续active；重新互动后重新开始活动段。阈值由trial policy控制，不能评估后为缩短时间改动。

## 104. Trial Metrics

机器只生成审计/模拟计时；realHumanMeasured=false。Unique audio节省、clicks、raw/eligible/prerequisite actions、manual edits、candidate-base edits、idle等按不同口径输出。manualCharactersEntered按实际人工字符编辑累计，不是编辑前后净长度差：等长替换计入，复制candidate editing base不计入，IME composition在最终提交时只计一次。不得以模拟值推断真人加速。

## 105. Trial Package

未来trial package功能只打包机器workspace、audio、minimal部署ranker与trial config，必须实际应用冻结score/production selector并把order/plans绑定deploymentHash。没有Gold、labels、evaluation artifacts、trained episode IDs或本集测试答案。本轮只在synthetic临时包E2E中验证该流程，没有生成Episode1真实prospective trial包或真实human session；正式产物里的ranker-freeze不是已开展trial的证明。

## 106. Episode 1 Trial Eligibility

Episode1 priorGoldExposure=true、eligible=false；不能初始化为unseen realHuman evidence。隔离副本UI操作只能标为自动化测试。

## 107. Prospective Trial Readiness

运行工具链可用于之后未观察episode；正式readiness为`PROSPECTIVE_HUMAN_TRIAL_NOT_READY_RANKER`，route为`HOLD_FOR_MISSING_EVIDENCE_REPAIR`，原因是mandatory missing-dialogue recall低于1。本集ranking weak+burden unsafe，不能声称已获准大规模省时实验。下一集需独立输入与新freeze，不能把本集selected模型回放当prospective。

## 108. Human Review Time Status

HUMAN_REVIEW_TIME_NOT_MEASURED。无真实人工trial session，无人工节省分钟数，无用户纠错效率结论。

## 109. Real Human Trial Protocol V2

协议v2：选择未被reviewer/Gold暴露的新episode，先冻结machine package+deployment ranker+预算；再记录trusted人工事件、暂停/idle、unique试听与修订；结束后才进行独立Gold质量评估。保留未完成/中止trial，不把它们剔除来改善结果。

## 110. Machine Final Text Parity

Canonical text hash=`2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9`。独立validator确认machineTextMutationCount=0，final-a/b与baseline保持一致；11/11独立构建的A/B机器artifact文件byte-identical。

## 111. Machine Final Timing Parity

Canonical timing hash=`e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`。独立validator确认machineTimingMutationCount=0；本轮没有时间边界修改，没有重跑任何声学模型。

## 112. ASS/SRT/VTT Parity

Presentation hash=`a70f459da8f8513565da4a3b483646a709dafcf9ff9d96ef9065de9f6ebb5dd7`。独立validator确认原package及ASS/SRT/VTT的primary、best-effort六份导出共7/7 byte parity。三个workspace快照及独立提取A/B WAV hash一致，HTML/JS/CSS三套交付byte-identical；人工隔离测试副本不计入正式产物。

## 113. Runtime Gold Input

runtimeGoldInputCount=0；Gold仅在evaluator阶段读取，evaluatorGoldInputCount=1。155 machine frozenfiles在首次读取前已验证，并在之后再验unchanged。Gold labels不出现在machine workspace/trial package。

## 114. Dataset Hardcoding

策略没有episode title、文件名、cue/event ID、特定Gold文本或源时刻硬编码判断。固定output-prefix仅是CLI调用参数；报告中的真实hash/时段是事后审计，不是runtime decision rule。

## 115. Network

networkUsed=false，ASR inference=0；不下载新模型、不发外部API。本次只读取缓存机器证据与既有Gold evaluator产物。

## 116. Source Read-only

Source SHA-256=`294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`；size=847774958。前后sha256/size/mtimeMs/inode全部相等；不复制完整源视频进shareable包。

## 117. Gold Read-only

Gold SHA-256=`a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`；size=17094。只读校验四项identity相等，上游quality/Gold evaluation文件也未变化。报告不包含完整Gold正文。

## 118. Shareable Audit

首次真实validator检查为60 passed /1 failed，唯一失败是`baseline_audio_accounting_frozen_provenance`：新validator错误地把C6.0.1.12 freeze中完整artifact hash与artifact内部semanticHash比较。只读核对确认完整artifact hash本身匹配；随后只修正两处比较并增加反例回归，没有改变任何machine/Gold数据或排名。

首次失败的validation与trial-readiness目录完整保留为`carnation-c6-0-1-13-validation-failed-attempt-1-20260830/`与`carnation-c6-0-1-13-trial-readiness-failed-attempt-1-20260830/`。它们的FAILED状态不伪装为最终PASS。修正后第二次正式验收61/61 checks、9/9 regression groups全部通过，写入正常命名目录。

最终shareable审计为PASSED，scope明确限定为一个strict aggregate-only `shareable/review-burden-summary.json`，不是对全部历史output全文的隐私承诺。absolutePathLeak、secret、goldIdentityLeak、brokenRelativeReference、fullDialoguePayload、privateEventPayload六项计数均0。Audit semantic hash=`1488f13a89faa59b6c21886c4b6da343482df6d34850326d71300d275490492f`；summary文件SHA-256=`2ca5198f8872593139a7e7e84db569f37281d9a6596a4173dd3dca9154e99a9a`。

## 119. C5.19 Regression

本轮delivery日志：C5.19 series-memory unit 31/31，E2E flow 1/1通过。未重新跑真实模型。

## 120. C6 Investigation Regression

本轮delivery日志中的blocker-ontology、counterfactual-finalization、evidence-freshness、human-authority-verification、risk-assessment与root-cause-graph unit共11/11通过（6 files）；investigation-flow E2E 1/1通过。调查/分类逻辑未被新的review排序破坏。

## 121. C6 Protected Regression

本轮delivery日志中的baseline-preservation、freshness、human-authority、protected-finalization、protected-schemas、review-disposition、risk-policy及root-risk unit共32/32通过（8 files）；protected-finalization-flow E2E 2/2通过。人工权限、protected文本/时间及finalization gate保持。

## 122. C6.0.1 Regression

Machine-only blind acceptance unit 8/8，gold-isolated-evaluation-flow E2E 2/2通过。Runtime Gold隔离仍由独立freeze/identity审计验证。

## 123. C6.0.1.1 Regression

Machine quality recovery unit 11/11，对应E2E flow 1/1通过。

## 124. C6.0.1.2 Regression

Candidate timeline专用E2E flow 1/1通过，包含于最终全仓回归；没有把其他版本的unit数量伪装为C6.0.1.2专属测试数。

## 125. C6.0.1.3 Regression

Candidate association/assembly unit 5/5，association-assembly-flow E2E 1/1通过。

## 126. C6.0.1.4 Regression

VAD timebase与variant re-ASR unit共22/22；vad-variant-reasr-flow E2E 1/1通过。此回归使用测试夹具，不触发真实re-ASR。

## 127. C6.0.1.5 Regression

Lineage/evidence、mutation/timing、recovery/coverage unit共18/18；evidence-to-canonical-flow E2E 1/1通过。

## 128. C6.0.1.6 Regression

Boundary refinement、ceiling policy、edge decoder、risk priority、span lineage repair unit共26/26；acoustic-span-boundary-flow E2E 1/1通过。

## 129. C6.0.1.7 Regression

Fresh re-ASR ceiling unit 5/5，fresh-reasr-ceiling-flow E2E 1/1通过；测试不代表本轮运行真实ASR。

## 130. C6.0.1.8 Regression

Core stability unit 7/7，core-stability-flow E2E 1/1通过。

## 131. C6.0.1.9 Regression

Independent ASR provider及machine-analysis unit共8/8；independent-asr-complementarity-flow E2E 1/1通过。

## 132. C6.0.1.10 Regression

Cross-model arbitration unit 11/11，cross-model-arbitration-flow E2E 1/1通过。

## 133. C6.0.1.11 Regression

Ablation route、calibration data、independent CTC、paired evidence、selective CV unit共18/18；paired-discriminator-calibration-flow E2E 1/1通过。

## 134. C6.0.1.12 Regression

C6.0.1.12 correction workflow、freeze/dataset integrity、review builders、quality route、workspace、schemas、synthetic workflow integrity unit共86/86；review-assistance-flow E2E 1/1通过。原review事务功能继续复用。

## 135. Unit Tests

限定validator修正后的最终accepted重跑：unit 90 test files，855 passed、1 skipped、0 failed，success=true。命令：`npx vitest run --exclude 'tests/e2e/**' --reporter=json`。独立targeted rerun为50 files、375/375通过、0 skipped；这是重复回归子集，不与855相加作distinct-test总数。其版本分组为C5.19=31、C6 Investigation=11、C6 Protected=32、C6.0.1=8、C6.0.1.1=11、.3=5、.4=22、.5=18、.6=26、.7=5、.8=7、.9=8、.10=11、.11=18、.12=86、.13=76，共375。C6.0.1.2的专用回归入口是E2E，未虚构专属unit计数。

§119–140的版本分组均对照最终accepted testResults核对，完整日志保存在正式validation目录的`regression-logs/`。本轮ranker focused regression 12/12通过，包括native plan unique-audio失败分支和item/gap不同分母保护。唯一unit skip为`c5-18-speaker-runtime.test.ts`中的真实Community-1 inference；本轮禁止重跑真实模型，因此保留skip且不计入通过。

## 136. E2E

最终accepted E2E：26 test files，46 passed、1 skipped、0 failed，success=true。命令：`npx vitest run tests/e2e --reporter=json`。唯一skip为`c5-17-forced-alignment-flow.test.ts`中的optional real MFA integration，符合本轮不重跑模型的边界。C6.0.1.13 prospective-trial flow的2个测试使用synthetic临时数据，不是本集真实human trial。

## 137. UI Tests

最终浏览器UI审计21/21检查通过，涵盖source offset、各budget executable计划、pause/details、editing base、MANUAL_EDIT/undo/reload、unique progress、session路径保护和编辑计数。UI资产与§95最终hash绑定；自动化测试结果与人工trial效果严格分开。

## 138. Schema Count

最终delivery `npm run generate:schemas`生成351个JSON Schemas，exit 0。新增deployment、OOF/labels/features/folds/freeze、ablation、missing-evidence evaluation与post-freeze audit均为strict schemas。产物验证另由独立acceptance validator执行。

## 139. Skill Validation

Skill Creator的`quick_validate.py .agents/skills/multilingual-video-subtitler`返回`Skill is valid!`、exit 0。最终delivery typecheck、lint、format:check、build均exit 0；schema生成不被用作skill验证的替代。

## 140. Skill2/3

基于C6.0.1.12交付基线`c56ec28`，只读git diff确认Skill2（multilingual-grammar-report-generator）和Skill3（multilingual-grammar-learning-site-builder）目录没有改动。修改范围是Skill1及必要的共享schema/runtime支持。

## 141. Ranking Calibration Result

`REGION_RANKER_WEAK`。OOF方法有效、DQ10/10通过，但safe learned门槛不达标。该结论已冻结，不允许同版本看Gold后调整weights、grouping或阈值。

## 142. Burden Reduction Result

`REVIEW_BURDEN_REDUCTION_UNSAFE`。Required数量/unique秒数下降是真的；安全召回损失也是真的，必须同时披露。

## 143. Prospective Trial Result

`PROSPECTIVE_HUMAN_TRIAL_NOT_READY_RANKER` / HUMAN_REVIEW_TIME_NOT_MEASURED。realHumanSessionExecuted=false、humanReviewTimeMeasured=false、episodeOneEligibleForBlindHumanTrial=false；syntheticTrialOnly=true。Readiness semantic hash=`9b6a28b0bb32e4e0881cdc635d326a0430d2079ed4d6306066c84acb7e51617a`。未来deployment export和trial instrumentation属于技术能力，不等于本集或未见集人工验收已通过。

## 144. Product Route Decision

正式验收route=`HOLD_FOR_MISSING_EVIDENCE_REPAIR`。产品架构仍是HUMAN_ON_EXCEPTION审核辅助，保留deterministic fallback、全部153items和显式证据状态；不推进自动终稿/零接触路线。需要改进真正可独立验证的missing/hallucination证据及未关联错误覆盖，而非简单降Required。工程PASSED不覆盖该产品HOLD结论。

## 145. C6.0.2 Status

C6.0.2 HOLD。quality/release门与工程测试门分离：即使代码、schema、UI与审计通过，也不授权机器only final release。

## 146. C6.1 Research Note

C6.1可研究更可靠的正向missing/hallucination证据、跨episode排名稳定性、可辨识/不可辨识音频边界与人工纠错成本；新的假设应新版本预注册并在未观察episode独立验证。禁止把本集Gold追分当泛化。

## 147. Remaining Risks

主要风险：0STRONG missing、1个missing无itemlineage、低证据44item并列、candidate actionable全0、关键acoustic feature缺失、fold5极小、OOF部分negative gains、低cost rank延后缺失对白，以及尚未测量真实人工负担。保持完整review队列可见和不自动finalize。

## 148. Commits

本轮按独立职责提交：

| Commit                                     | 内容                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `724584d82d79f68c42e046378d081e69f1ff197c` | fix: calibrate missing-speech evidence and deduplicate review evidence families  |
| `256748bb164ade429ef6c75d208c24b44b87c6f7` | feat: add structured region priorities and unique-audio burden planning          |
| `8fad48fc22170a04e127d5718820abc21c6552e3` | feat: calibrate region rankers with gold-isolated grouped out-of-fold evaluation |
| `a7107e7133c01ce27b884778fe49a0e32bc18055` | feat: add region review workspace and prospective trial instrumentation          |
| `01c4eed7fd46c449ff9da7b70fcd1c0109e28cb8` | test: verify region burden replay and prospective trial readiness                |

最终收尾提交标题为 `test: record C6.0.1.13 review burden acceptance`，包含限定的validator hash比较修正、回归、报告与Skill文档。该提交的精确SHA由独立 `output/carnation-c6-0-1-13-validation-20260830/git-delivery-receipt.json` 记录，正文不嵌入自身提交SHA，避免自指改变commit hash。

## 149. Remote HEAD

远程分支为 `origin/codex/c6-0-1-13-review-rank-region-burden`。最终local HEAD、remote HEAD及同步核对结果以 `output/carnation-c6-0-1-13-validation-20260830/git-delivery-receipt.json` 为交付证据；只有receipt中的远程核对结果才能证明已同步，分支名称或本地commit本身不是push成功证明。

## 150. Output Paths

以下为output根目录下的本轮相对目录；不暴露用户主目录：

- `carnation-c6-0-1-13-baseline-20260830/`
- `carnation-c6-0-1-13-missing-evidence-v2-20260830/`
- `carnation-c6-0-1-13-evidence-families-20260830/`
- `carnation-c6-0-1-13-items-v3-20260830/`
- `carnation-c6-0-1-13-regions-v2-20260830/`
- `carnation-c6-0-1-13-region-priority-20260830/`
- `carnation-c6-0-1-13-playback-timeline-20260830/`
- `carnation-c6-0-1-13-burden-plans-20260830/`
- `carnation-c6-0-1-13-ranker-features-20260830/`
- `carnation-c6-0-1-13-ranker-oof-20260830/`
- `carnation-c6-0-1-13-ranker-freeze-20260830/`
- `carnation-c6-0-1-13-workspace-v2-20260830/`
- `carnation-c6-0-1-13-final-a-20260830/`
- `carnation-c6-0-1-13-final-b-20260830/`
- `carnation-c6-0-1-13-validation-20260830/`
- `carnation-c6-0-1-13-trial-readiness-20260830/`

关键评价：ranker-oof下region-ranking-evaluation、missing-evidence-evaluation、ablation-evaluation、post-freeze-evaluation-audit；future freeze独立位于ranker-freeze。正式validation包含`c6-0-1-13-validation.json`、`c6-0-1-13-review-burden-validation.json`、`c6-0-1-13-shareable-audit.json`、`shareable/review-burden-summary.json`、`regression-logs/`、`ui-acceptance-results.json`（21checks）及`ui-asset-refresh-receipt.json`；提交同步身份由同目录`git-delivery-receipt.json`记录。Burden validation semantic hash=`cc81e89e235d04d69b9cece0df0548cc3b2a398953e4d3905c24aa1ff6803f4d`。

失败历史单独保留：`carnation-c6-0-1-13-validation-failed-attempt-1-20260830/`、`carnation-c6-0-1-13-trial-readiness-failed-attempt-1-20260830/`，它们不是正式PASSED交付目录。没有本集真实trial package/session目录；synthetic测试临时目录不作为真人trial产物。
