# C6.1 Multi-ASR Confusion Network / MBR Investigation

本报告严格对应用户 §233 的 156 项。数据范围是 **KNOWN_DEVELOPMENT_BENCHMARK**，不是未见剧集的泛化验收。机器产物已于 `2026-08-30T13:05:11.397Z` 双冻结；质量结论只能来自随后生成的 evaluation-only 产物。本文不包含字幕原文或 Gold 原文。

范围约定：**主图**是 P0–P9 使用的 199 个 provider-balanced-medoid 图；**全图**是主图加三种对齐消融，共 796 个图，不是 796 个独立事件。总计 21 个 Shadow Profile。Oracle 只使用通过 P0 `latticeHash` 明确选出的主图，不将补充图并入可达空间。

证据简称：`A` / `B` 分别是 `carnation-c6-1-final-a-20260830` / `carnation-c6-1-final-b-20260830`；`V` 是 `carnation-c6-1-validation-20260830`；其余目录见 §156。这些相对目录均以用户工作区 `Codex-Skills/output/` 为根。所有机器文件身份以冻结清单为准；质量数值以冻结后评估文件为准。`UNKNOWN`、不可识别和跳过的检查不等于 0 或通过。

## 1. Executive Conclusion

机器工程阶段完成：1496 条输入记录全部守恒，832 条纳入记录覆盖 199 个事件；21 套 Shadow 与 100 个冻结文件实现 A/B byte equality。全部已选非空路径的 provenance 与安全审计通过，生产文本/时间保持不变。

冻结后 A/B 评估结论一致，均为 **CONSENSUS_ORACLE_POTENTIAL_DECODER_UNSAFE**：38 个可明确映射事件上，合法组合 Oracle 比最佳现有候选仅额外减少 4 个编辑错误；实际已渲染 novel 输出没有一条被证明改善或优于全部输入候选。主 Profile 最佳是 P6 Candidate MBR：normalized CER 0.6015625 → 0.58251953125，但 material errors 77 → 78，可评估事件改善 8、回退 6，因此不满足发布/进一步前瞻部署条件。下一步仅允许 `C6.1.1_DECODER_CALIBRATION_SHADOW_ONLY`；生产仍 needs-review/none，C6.0.2 HOLD，release=false。

**Engineering Gate PASSED**：正式 validator exit 0、30/30 checks 通过、9/9 QA 阶段通过；Unit 936 passed / 2 skipped、E2E 48 passed / 1 skipped、targeted 430 passed / 0 skipped，失败均为 0。A/B 的完整 42 次 global evaluation 已独立重算，101 个机器文件与 24 个 evaluation 文件分别 byte equal。最终验收 hash 为 `fddaf4634e50929e9dd5987e9f4191cc255a5048b8be31aa43fa6695d9517da9`。工程完成不代表质量发布门通过，也不代表远端推送已发生；Git 交付身份按 §154–155 独立绑定。

## 2. Branch

`codex/c6-1-multi-asr-confusion-network-mbr-investigation`。开发工作与并行 C6.0.1.13 工作区隔离；本次只修改 Skill 1 范围。

## 3. Baseline

基线 commit：`c56ec2897d7dc64719b53163d0f71fe1023c2a9a`。使用 C6.0.1.12 官方 machine-only needs-review package，161 cues、199 canonical events；视频长度 900.01 秒。

| 身份                            | SHA-256 / semantic hash                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| Source media                    | `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` |
| Machine draft                   | `b1026b81be622475398f961658975da3c014d1157fc41c9966095f2db1d8386e` |
| Canonical text                  | `2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9` |
| Canonical timing                | `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936` |
| Official baseline semantic hash | `2180553d58ef6304648a3879d48a18e31c827ca63afbb7fa9437793f9bd134d6` |

## 4. C6.0.1.12 Replay

`A/c6-1-baseline.json` 的 `baselineReplayPassed=true`；直接复用官方 package，并核对 8 个生产交付文件的身份。未重新执行 ASR，也没有将人工稿作为机器起点。基线 inventory 记录 365 条原始候选：ASSIGNED 199、DUPLICATE 136、AMBIGUOUS 28、REJECTED 2；这些是历史 disposition，不等同于本次重新建模后的纳入状态。

冻结后 A 的 P0 精确复核：exact CER=0.6601049868766404、normalized CER=0.6015625、coverage=0.96484375、missing=6、hallucination=1、material errors=77。Overlap 存在两个明确口径：legacy evaluator 只计相邻 cue，值 37；完整两两相交为 48。对冻结 P0 的时间字段独立重算得到相同 37/48；没有修改冻结 evaluator 或字幕以消除口径差异，也不能把差异说成重叠已修复。

固定 P0 timing metrics：severeTiming=53、start MAE=1.6091082275459374 s、end MAE=1.6078355157481543 s、boundary P95=5.384999999999991 s、median IoU=0.5824665676077242。Shadow 时间戳不变；文本改变后全局匹配产生的 timing metric 差异明确标为 matching-induced，不声称真实时间轴修复。

## 5. Product Route Preservation

保留生产 `needs-review`、`finalizationMethod=none`、`machineOnlyReleaseAuthorized=false`、`C6.0.2=HOLD`。研究结果仅生成独立 Shadow，不能覆盖生产文件、降低审核阈值或等同于人工最终审核。

## 6. Research Route Definition

机器 allowlist → 候选守恒 → 三视图 → 对齐/合法图 → 冻结 Profile 解码 → 独立安全校验/Shadow 装配 → A/B 双冻结 → 独立 Gold 评估。Gold 不进入候选、对齐、权重或运行时选择；“最佳 Gold-free Profile”是冻结后报告排名，不是 Gold 驱动的运行时策略。

## 7. Goals

验证真实多 ASR 候选能否通过有来源、合法相邻关系的 Token/Span 组合，在现有候选并集之外产生可靠收益；同时区分候选选择收益、重组合潜力与实际安全交付收益。

## 8. Non-goals

不运行新 ASR、pyannote 或强制对齐模型；不修改生产 Canonical 文本、时间、分段或结构；不将理论 Oracle 最佳路径注入机器输出；不自动发布；不宣称单一已知 benchmark 的泛化能力。

## 9. Research Hypothesis

候选错误可能互补，但 Token/Span 组合只有在真实来源、合法连续性、可恢复词形及冻结后可观测收益同时成立时才有意义。多数票、候选相关性修正及 CTC 相对分数均不是校准后的正确概率。

## 10. Candidate Universe

纳入 9 类 artifact 记录来源：原始证据 365、C5 candidate pool 274、targeted re-ASR 25、fresh targeted re-ASR 28、core projection 64、独立 Reazon 48、holdout Reazon 279、paired Whisper 252、CURRENT control 161，共 1496 条。Adapter 仅读取明确机器文件 allowlist，不扫描 memory 或 Gold。

## 11. Candidate Conservation

| 状态                                     | 条数 |
| ---------------------------------------- | ---: |
| INCLUDED                                 |  832 |
| NORMALIZED_DUPLICATE                     |  424 |
| PRONUNCIATION_EQUIVALENT（独立排除状态） |    0 |
| HARD_REJECTED                            |    2 |
| UNLOCALIZABLE                            |  238 |
| UNSUPPORTED_PROVENANCE                   |    0 |
| UNACCOUNTED                              |    0 |

`832 + 424 + 0 + 2 + 238 + 0 = 1496`。读音等价但词形不同的候选不被折叠删除；状态 0 不意味着不存在同音关系。候选宇宙 hash：`2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a`。

## 12. Event Count

199 个 canonical events；不是 199 个生产 cue，也不是 796 个独立事件。实际生产 cue 数固定为 161。

## 13. Multi-hypothesis Event Count

182 个事件具有多个保留在纳入集合中的候选；同模型、同请求或重叠窗口之间仍可能相关，不能将 multi-hypothesis 当作独立证据数。进一步检查主 P7 的实际合法 n-best：75 个事件包含 novel legal path（36 个穷举完成事件、39 个近似搜索事件），可作为已发现组合条件的下界；不代表整个理论空间已被穷举，更不代表这些组合优于原候选。已选 novel path 与最终渲染 novel change 另行统计。

## 14. Multi-provider Event Count

173 个事件同时具有 Whisper 与 Reazon 纳入候选；CURRENT 不计作第三个独立 provider。

## 15. Whisper-only Event Count

9 个 Whisper-only multi-hypothesis events。它们可研究窗口差异，但不能伪装为跨模型独立共识。

## 16. Single-hypothesis Control Count

17 个 single-hypothesis control events；unlocalizable event count 为 0。候选级 UNLOCALIZABLE 仍为 238，两个粒度不能混淆。

## 17. Candidate Provider Distribution

| Provider        | 输入记录 | 纳入记录 |
| --------------- | -------: | -------: |
| Whisper         |     1008 |      446 |
| Reazon          |      327 |      225 |
| CURRENT control |      161 |      161 |
| 合计            |     1496 |      832 |

真正独立 ASR 纳入记录为 671（446 + 225）；832 包括 161 条不参与独立投票的 CURRENT 控制记录。

## 18. Candidate Correlation Groups

551 个 correlation groups；group identity 保留 provider、model/runtime、event、request/window lineage。相同原始候选在多份派生产物重复出现，不被当成新的独立投票。

## 19. Display Representation

832 个 display representation 保留原始真实候选表面形式，输出字面只能通过可审计的候选 unit/span 恢复。不能按 normalized/reading 投票结果新造汉字。

## 20. Normalized Representation

机器视图使用 NFKC、ASS 换行处理与空白折叠，保留标点和词汇差异。评估归一化使用冻结的独立 policy，不能把两个 normalizer 混为一谈。

## 21. Pronunciation Representation

候选 ledger 中 684 条记录有可信读音证据；纳入的 832 个 representation 中 429 个具备完整 reading representation。其余保持缺失，不通过文本猜读音；也不凭整句读音伪造逐汉字的 reading alignment。

## 22. Japanese Normalization Rules

不方言标准化、不任意假名互换、不删真实重复；同音异义表面形式继续独立保留。读音用于受约束对齐/距离/消融，不作为无证据的词形生成器。

## 23. Pairwise Alignment

主机器 pairwise artifact 共 1518 个完整对齐；每个对齐保留候选 identity、unit mapping、编辑操作与 weighted cost。主图非 pronunciation-aware；补充 reading 对齐的 pairwise 证据保存在对应 MSA 内。

## 24. Pairwise Alignment Failures

正式主 pairwise artifact 1518/1518 完整，无缺失失败条目。该值说明处理完整，不证明每处语义对齐正确；Gold 后错误归因另见 §106。

## 25. Multiple Sequence Alignment

796 个 MSA：199 events × 4 configurations。主配置是 provider-balanced medoid；三种补充配置分别为 CURRENT center、普通 medoid center、pronunciation-aware provider-balanced medoid。

## 26. Center Selection

中心选择与 tie-breaking 由候选语义 identity 和冻结编辑代价确定。主 medoid 对 provider 平衡，CURRENT 在存在真实 ASR 时不构成额外独立 provider 权重；插入块使用确定性最长中心。

## 27. Input-order Invariance

A/B 候选输入置换后，全部 100 个冻结机器文件 byte equal；对齐/图/profile/path/shadow 因而同时具备语义与字节一致性。所有 ProfilePath 明确绑定 event + latticeHash，不能靠数组顺序选择补充图。

## 28. Token Lattice

199 主图、597 补充图，共 796 图。节点来自真实候选单位；边只来自真实候选相邻关系；跨候选切换要求全候选无歧义的 exact-surface anchor。补充图不能悄悄扩展主图 Oracle 的空间。

## 29. Lattice Nodes

主图 7356 nodes；全图 29269 nodes。全图数字包含重复研究配置，不可解释成新增独立候选证据。

## 30. Lattice Edges

主图 8217 edges；全图 32749 edges。边附带 supporting candidate IDs 与 provider/correlation provenance。

## 31. Epsilon Edges

主图 epsilon nodes 1908、与 epsilon 相接的 edges 2960；全图分别为 7485、11698。这里 epsilon edge 的口径是至少一端为 epsilon node，不包含普通 START/END 边的额外分类。

## 32. Unsupported Edge Count

已选路径 unsupportedAdjacencyCount=0。构图只生成 observed adjacency；不能把 slot 独立获胜结果直接串接成未经图验证的输出。

## 33. Confusion Network

每个图各有一个明确 `latticeHash` 的 network；199 个主 network、796 个全配置 network。slot 的备选、epsilon、provider/correlation 支持与熵可审计。

## 34. Slot Count

主图 3691 slots；全图 14593 slots。

## 35. Ambiguous Slot Count

以 PRONUNCIATION_EQUIVALENT 或 LEXICAL_DISAGREEMENT 为 ambiguous：主图 2463，全图 9701。ROVER 的具体 abstain/tie 还受票重与 margin 影响，不能直接用这个静态计数代替解码 abstention 数。

## 36. Provider-agreement Slots

主图 exact agreement 1228、normalized agreement 0；其中具有至少两个 provider 支持的 exact/normalized agreement slots 为 798。全图分别为 exact 4892、normalized 0、跨 provider agreement 3172。

## 37. Provider-disagreement Slots

主图 lexical disagreement 2453，其中至少两个 provider 支持的 lexical disagreement 2321；全图分别为 9636、9102。这里 provider 聚合与歧义标签定义来自冻结 network，不等价于模型错误诊断。

## 38. Pronunciation-equivalent Slots

主图 10；全图 65。表面词形仍保留真实来源，不将同音候选自动判成语义一致。

## 39. Correlation Control

冻结策略为 `EQUAL_PROVIDER_THEN_EQUAL_GROUP_THEN_EQUAL_DISTINCT_HYPOTHESIS`。权重是规范化 hypothesis support，而不是模型后验概率或校准置信度。

## 40. Raw Candidate Vote

R0 使用可追溯的 distinct original sourceCandidateId raw support：1034（Whisper 636、Reazon 237、CURRENT 161）；CURRENT 在真实 ASR 存在时投票权为 0。它与 832 个纳入节点记录不同，且不把同一原始候选的 artifact 拷贝重复计票。

## 41. Provider-balanced Vote

R1 对 Whisper 与 Reazon 分配相等 provider total，再归一化候选支持，防止窗口较多的一方仅因候选数量占优。是否改善质量必须看冻结后 paired ablation，不由设计意图推定。

## 42. Correlation-aware Vote

R2 在 provider 内再对 correlation group 及 distinct hypothesis 平衡。原始与平衡票重、每个候选来源及 Profile ID 都保留在结果 artifact 中。

## 43. ROVER R0

对应 P1 SIMPLE_ROVER；正式 Shadow 修改 26 cues、实际应用 27 event spans。normalized CER=0.60009765625，可评估事件改善 3、回退 0；material errors=78，未通过主质量 gate。

## 44. ROVER R1

对应 P2 PROVIDER_BALANCED_ROVER；正式 Shadow 修改 65 cues、应用 70 event spans。normalized CER=0.59130859375，可评估事件改善 6、回退 3。

## 45. ROVER R2

对应 P3 CORRELATION_AWARE_ROVER；修改 65 cues、应用 70 event spans。normalized CER=0.59130859375，改善 6、回退 3，与本样本 P2 相同。P8 与 P9 分别改变 abstention margin 与输出模式，不应因同为 R2 而丢失 Profile 归属。

## 46. ROVER R3

补充 Profile `R3_STABILITY`；稳定度乘数范围 [0.75, 1]。修改 65 cues、应用 70 spans；normalized CER=0.59130859375，改善 6、回退 3。相对主图 R2 的可评估事件变化为 0 改善 / 0 回退，本样本未见额外效用。

## 47. ROVER R4

对应 P4 PRONUNCIATION_AWARE_ROVER，指 slot voting 的读音聚合；它不同于 `ALIGN_PRONUNCIATION_R2` 的 pronunciation-aware alignment。P4 修改 64 cues、应用 69 spans。

## 48. ROVER R5

对应 P5 ACOUSTIC_AWARE_ROVER；只复用 exact model/audio/representation/provenance identity 的已有 CTC 分数，乘数有界 [0.9, 1.1]。修改 73 cues、应用 78 spans；证据存在不等于证据有效。

## 49. Candidate-level MBR

P6 在真实完整候选中选最小加权编辑风险，不产生任意新词形。另有 MBR_GRAPHEME 与 MBR_PRONUNCIATION 消融；共 597 个 candidate-MBR results，均具有明确 Profile ID。

## 50. Lattice MBR

P7 在合法路径中搜索，另有最大 provider switches 为 0/1/2/3/无限的五组消融。共 1194 个 lattice-MBR results；所有结果保留 n-best、约束、搜索界限、候选支持与路径证据。

## 51. Exact/Approximate Status

1194 次 Lattice MBR 中，922 次 `EXACT_LATTICE_MBR`、272 次 `APPROXIMATE_LATTICE_MBR`；其中主 P7 为 151 exact、48 approximate。exact 仅指该事件冻结约束内穷举完成，不指无约束全语言空间；近似 beam/n-best 不能宣称精确 MBR。

## 52. N-best Path Count

冻结 beamWidth=64、maxPaths=128、maxPathLength=512。全 Lattice MBR 搜索 visited states 796045、beam-pruned states 88528、maxPaths truncation 0、length rejection 0。实际 n-best 路径条目共 7331：P7=1274、SWITCH_0=1017、SWITCH_1=1284、SWITCH_2=1274、SWITCH_3=1257、SWITCH_UNLIMITED=1225；单事件最大 n-best=47。

## 53. Path Complexity

provider-switch penalty=0.005、epsilon-complexity penalty=0.0001；combined grapheme weight=0.75。这些是冻结的通用研究参数，不通过本次 Gold 再调参。

## 54. Provider Switches

主 P0–P9 默认最多 2 次；消融另测 0、1、2、3、无限。报告实际已渲染变更的总数、均值、最大值时以质量 artifact 为准，不能把被阻止 proposal 的切换计入交付。

## 55. Span Consensus

主图生成 367 个连续真实候选 span alternatives。只允许精确可定位 event-to-final-cue span 装配，不全局替换、不新增未覆盖 cue、不切分/合并生产 cue。

## 56. Surface Restoration

3874 条已选非空路径均完成独立 surface/provenance 验证；unproven surface restoration=0，synthetic Kanji=0。完整候选路径优先使用其精确表面见证，避免归一化后丢失原词形。

## 57. Novel Legal Paths

主 P7 n-best 中有 569 条 novel legal paths、分布于 75 个事件；机器最终选中 novel paths 20 个 profile-event occurrences，涉及 10 个去重 event/text、10 个事件。它们只是提案层的合法新表面路径；其中严格机器 normalize 等价计数 0，并不等于评价 normalize（忽略标点/空白）等价计数也为 0。实际渲染的标点-only novel 见 §102；不能将 20 直接写成词汇质量收益。

## 58. Unsafe Paths Rejected

ROVER 输出 2189 条结果，其中 BLOCKED_UNSAFE 60、ABSTAIN_AMBIGUOUS 1046、KEEP_CURRENT 91、SINGLE_HYPOTHESIS_NO_ACTION 176、SELECT_EXISTING_CANDIDATE 808、SELECT_LEGAL_CONSENSUS_PATH 8。最终已选路径独立审计拒绝数为 0：前者是被拦截提案，后者是交付路径审计，不相矛盾。

## 59. Unsupported Tokens

最终已选路径 unsupportedTokenCount=0；没有为减少错误而放宽词源要求。

## 60. Unsupported Adjacencies

最终已选路径 unsupportedAdjacencyCount=0。即使每个 token 单独有候选来源，未被真实连续性支持的组合仍不可交付。

## 61. Cross-event Violations

crossEventTokenCount=0、nonMonotonicPathCount=0、pathCycleCount=0、providerSwitchLimitViolationCount=0。多个对齐图以 event + latticeHash 精确绑定，防止串图验证。

## 62. Provenance Coverage

3874/3874 条非空路径 provenanceComplete；共 42330 个输出 token provenance 条目，包含 source candidate span、node/edge、provider、selection method 与 evidence identity。305 条 NULL selection 不伪装为完成 provenance 的字幕。

## 63. Profile Freeze

Policy Version `c6.1-consensus-investigation-v1`；Profile Policy Hash `b616d165452fd7477cedcd47565ec22c3c5760f4a52de0b91f90f0b2723addf6`；Alignment Policy Hash `8d90f5f38ceb4f7d8a58b8f2dc013a9bed2659380bf8e0666032f9a448dd4f71`。主 P0–P9、21 套完整输出及评估 policy 均在 Gold 之前冻结。

## 64. Gold Barrier

机器 freeze hash `4cec0a7304c0e027d7bd5c820097dac89becaa68f6c5e5b5c926456fe2ee2991`，aggregate hash `d00415b4a0526967919817010e819ad853bd14553f3bb72f3d3bade142889874`，100 文件。读取 Gold 的唯一正式评估入口必须重新验证 A/B 完整性、哈希、生产文件与安全，再读取 Gold；不接受空目录、伪造 freeze 或变更文件。

正式 read-only proof 记录首次 Gold 读取 `2026-08-30T13:05:45.664Z`，晚于 freeze `2026-08-30T13:05:11.397Z` 34.267 秒。proof semantic hash=`16b39ed1310f73df0ac95bfa715a172020dd19da5f54044d9b03b1dc3dd05385`，绑定上述 machineFreezeHash；报告未读取 Gold 原文件。

## 65. Existing Candidate Oracle

只在 Gold 与 event 双向重叠均达 0.5、单一明确映射且无多个事件争用同一 Gold 的集合评估。199 events 中仅 38 EVALUABLE；152 AMBIGUOUS_GOLD_MAPPING、9 NO_GOLD_MAPPING，合计 161 不可评估。可评估集合归一化 Gold 分母 416 graphemes：current error=210，best existing candidate error=107，理论候选选择增益=103。该局部口径与全字幕 CER 不同；无映射事件不能算正确或当作 0 错误。

## 66. Legal Path Oracle

只在 199 个 P0 主图上执行合法连续性 automaton × Gold 的精确 DP，无 beam/n-best cap；Oracle 状态为 38 EXACT_LEGAL_LATTICE、161 UNAVAILABLE。38 个可评估事件的 best legal error=103，相对 current 减少 107，相对 best existing 再减少 4（分布于 3 个事件，不是 4 个事件）。该理论 Oracle **不施加机器主解码器的 maxProviderSwitches=2 上限**，但每次切换仍必须通过全候选无歧义 exact-surface anchor。因此它与机器 MBR 搜索空间不同，不能把 Oracle gain 声称为 Gold-free 可实现收益。

## 67. Unrestricted Slot Oracle

独立 slot Oracle error=90；比合法图的 103 低 13 个编辑错误。它仅作不受合法相邻约束的理论参考，不能渲染进 Shadow，更不能进入生产；差距显示舍弃连续性约束会产生虚高的理论上限。

## 68. Consensus Oracle Gain

同一 38-event / 416-grapheme 集合：current → best existing 增益 103；current → best legal 增益 107；best existing → best legal 组合专属增益 4，即 4/416=0.009615384615384616 的局部归一化误差减量。不能把 4 写成全字幕 CER 的提升，更不能将 107 都归功于 Token/Span 重组合。Oracle hash=`52a994f2d47730ee4eeab62313e7c3a077d24685befcec54dcd1b98ccb2f7114`。

## 69. P0 Baseline

P0 输出保持 161 cues；changed cues=0、199 个 assembly decisions 全为 KEEP_CURRENT。exact CER=0.6601049868766404、normalized CER=0.6015625、material=77、missing=6、hallucination=1、coverage=0.96484375。

## 70. P1 Result

R0，26 个 rendered changed cues；27 applied spans、24 unmappable、2 conflicting，其余 KEEP_CURRENT。未渲染的提案不计质量增益。

## 71. P2 Result

R1，65 个 rendered changed cues；70 applied spans、22 unmappable、2 conflicting。normalized CER=0.59130859375，改善 6、回退 3，material=78。

## 72. P3 Result

R2，65 个 rendered changed cues；70 applied spans、22 unmappable、2 conflicting。主 correlation-aware 对照。

## 73. P4 Result

R4，64 个 rendered changed cues；69 applied spans、22 unmappable、2 conflicting。与 pronunciation-aware alignment 补充对照分开。

## 74. P5 Result

R5，73 个 rendered changed cues；78 applied spans、23 unmappable、4 conflicting。实际 CTC 效用需 paired 对照。

## 75. P6 Result

Candidate MBR，94 个 rendered changed cues；99 applied spans、30 unmappable、4 conflicting、2 presentation-capacity holds。

## 76. P7 Result

Lattice MBR，89 个 rendered changed cues；93 applied spans、27 unmappable、6 conflicting、2 presentation-capacity holds。

## 77. P8 Result

Abstention-first R2，minimumMargin=0.05；65 个 changed cues、70 applied spans、22 unmappable、2 conflicting。不得把更高 margin 的设计意图直接写成更好 precision。

## 78. P9 Result

Existing-candidate-only R2；65 个 changed cues、70 applied spans、22 unmappable、2 conflicting。该 profile 是组合价值与候选并集价值的必要对照。

## 79. Best Gold-free Profile

预先规定的主 P1–P9 排名最佳是 **P6 Candidate MBR**：normalized CER 与 P7 同为 0.58251953125、material 同为 78，但 P6 可评估回退 6 少于 P7 的 7。补充 MBR_PRONUNCIATION 的 CER 更低（0.5771484375），但其角色从冻结前就是 distance ablation，不能事后升格为主 winner；material 仍为 78。选择口径固定为 `POST_HOC_REPORTING_ONLY_NOT_RUNTIME_SELECTION`，所有排名仅限已知 development benchmark。

## 80. Exact CER by Profile

以下来自 A/B byte-identical 的正式 `c6-1-consensus-quality-evaluation.json`，所有 Profile 都为 161 cues、coverage 0.96484375、missing 6。Exact 与 Normalized 分列；不能互相替代。

| Profile                 |          Exact CER | Normalized CER | Material | Hallucination |
| ----------------------- | -----------------: | -------------: | -------: | ------------: |
| P0                      | 0.6601049868766404 |      0.6015625 |       77 |             1 |
| P1 / R0                 |   0.65748031496063 |  0.60009765625 |       78 |             1 |
| P2 / R1                 | 0.6356080489938758 |  0.59130859375 |       78 |             0 |
| P3 / R2                 | 0.6356080489938758 |  0.59130859375 |       78 |             0 |
| P4 / R4                 | 0.6391076115485564 |  0.59326171875 |       78 |             0 |
| P5 / R5                 | 0.6356080489938758 |  0.58642578125 |       79 |             0 |
| P6 / Candidate MBR      |  0.626421697287839 |  0.58251953125 |       78 |             0 |
| P7 / Lattice MBR        |  0.626421697287839 |  0.58251953125 |       78 |             0 |
| P8 / Abstention-first   | 0.6356080489938758 |  0.59130859375 |       78 |             0 |
| P9 / Existing-only      | 0.6356080489938758 |  0.59130859375 |       78 |             0 |
| R3_STABILITY            | 0.6356080489938758 |  0.59130859375 |       78 |             0 |
| ALIGN_PRONUNCIATION_R2  | 0.6356080489938758 |  0.59130859375 |       78 |             0 |
| ALIGN_CENTER_CURRENT_R2 |  0.647419072615923 |   0.5966796875 |       77 |             0 |
| ALIGN_CENTER_MEDOID_R2  | 0.6487314085739283 |  0.59814453125 |       77 |             0 |
| MBR_GRAPHEME            | 0.6272965879265092 |  0.58544921875 |       78 |             0 |
| MBR_PRONUNCIATION       | 0.6220472440944882 |   0.5771484375 |       78 |             0 |
| SWITCH_0                |  0.626421697287839 |    0.580078125 |       79 |             0 |
| SWITCH_1                |  0.626421697287839 |  0.58251953125 |       78 |             0 |
| SWITCH_2                |  0.626421697287839 |  0.58251953125 |       78 |             0 |
| SWITCH_3                |  0.626421697287839 |  0.58251953125 |       78 |             0 |
| SWITCH_UNLIMITED        |  0.626421697287839 |  0.58251953125 |       78 |             0 |

Quality A/B semantic hash 均为 `b1a7ee16c49fed51ff51c0edecca7008df904f3ef6a55206bba10572a119be4c`，文件 SHA-256 均为 `8af1bc4af3b6fccf0c31c89e257fe47e50294c95d2b612d1d34ec8e25a13af4b`；直接 byte equality 已核对，独立 validator 还重新计算了 A/B 全部 42 个 Profile global evaluations，未只复用存量汇总数字。

## 81. Normalized CER by Profile

见 §80 全表。主最佳 P6 相对 P0 的 normalized CER 减量为 **39/2048=0.01904296875**（1.904296875 个百分点），但 material errors 增加；不能只报告 CER 下降。2048 是全局归一化分母，与局部 Oracle 的 416、Oracle Capture 的增益分母 107 不可混用。使用冻结 NFKC/空白/标点不敏感评估 policy，没有读取 Gold 后调参。

## 82. Material Errors by Profile

P0=77；主 P1–P9 除 P5=79 外均为 78，无一主 Profile 改善或维持 material error 基线。补充 current/medoid center 为 77、SWITCH_0=79，其余补充为 78。沿用冻结 materialMinimumCharacters=4、materialTextErrorCer=0.45，没有为过门而放宽阈值。

## 83. Coverage by Profile

全部 21 个 Profile 的全字幕 goldTextCoverageRatio=0.96484375，与 P0 相同，没有恢复额外覆盖。它与 §92 的干预覆盖率不是同一指标。

## 84. Missing by Profile

全部 Profile missing=6，与 P0 相同。没有证据表明本次修复了缺失对白；无明确 event/Gold 映射不会被误记为已恢复。

## 85. Hallucination by Profile

P0/P1 hallucination=1，其余 Profile=0。此处是冻结全字幕匹配规则下的 hallucination-candidate 数，不是逐词声学真值；下降不能抵消 material error 和局部回退。

## 86. Improved Events

主最佳 P6 改善 8 个可评估事件。完整实际渲染表如下；所有 Profile 另有 **161 个 UNEVALUABLE**，不进入 improved/regressed/neutral 的 38-event 分母。Changed 包含已渲染但 Gold 不可明确映射的事件，因此通常大于后三列之和。

| Profile                 | Changed events | Improved | Regressed | Neutral | Changed cues | Assembly blocked |
| ----------------------- | -------------: | -------: | --------: | ------: | -----------: | ---------------: |
| P0                      |              0 |        0 |         0 |      38 |            0 |                0 |
| P1                      |             27 |        3 |         0 |      35 |           26 |               26 |
| P2                      |             70 |        6 |         3 |      29 |           65 |               24 |
| P3                      |             70 |        6 |         3 |      29 |           65 |               24 |
| P4                      |             69 |        6 |         3 |      29 |           64 |               24 |
| P5                      |             78 |        8 |         4 |      26 |           73 |               27 |
| P6                      |             99 |        8 |         6 |      24 |           94 |               36 |
| P7                      |             93 |        8 |         7 |      23 |           89 |               35 |
| P8                      |             70 |        6 |         3 |      29 |           65 |               24 |
| P9                      |             70 |        6 |         3 |      29 |           65 |               24 |
| R3_STABILITY            |             70 |        6 |         3 |      29 |           65 |               24 |
| ALIGN_PRONUNCIATION_R2  |             70 |        6 |         3 |      29 |           65 |               24 |
| ALIGN_CENTER_CURRENT_R2 |             56 |        5 |         3 |      30 |           53 |               21 |
| ALIGN_CENTER_MEDOID_R2  |             57 |        4 |         3 |      31 |           53 |               21 |
| MBR_GRAPHEME            |            100 |        8 |         6 |      24 |           94 |               41 |
| MBR_PRONUNCIATION       |             95 |        7 |         4 |      27 |           91 |               39 |
| SWITCH_0                |             92 |        7 |         6 |      25 |           88 |               37 |
| SWITCH_1                |             93 |        8 |         7 |      23 |           89 |               35 |
| SWITCH_2                |             93 |        8 |         7 |      23 |           89 |               35 |
| SWITCH_3                |             93 |        8 |         7 |      23 |           89 |               35 |
| SWITCH_UNLIMITED        |             93 |        8 |         7 |      23 |           89 |               35 |

## 87. Regressed Events

P6 回退 6，P7 回退 7；同 CER 不代表同局部安全性。跨 21 个相关 Profile 的 regression occurrences 总计 88，这不是 88 个独立事件或 88 次独立实验，错误归因保持 UNKNOWN。

## 88. Neutral Events

P6 neutral=24，其中 changed-neutral=3；另有 changed-unevaluable=82。因此 99 个实际改变事件中，17 个可评估（8 improved + 6 regressed + 3 changed-neutral），82 个未知。P7 的对应数字是 18 可评估、75 changed-unevaluable。未知不等于正确、neutral 或 0 错误。

## 89. Changed Events

总 selected profile-event entries=4179（199×21）；全 Profile 实际 changed-event occurrences=1558（相关重复实验，不去重）。主最佳 P6 为 99 events / 94 cues / 36 blocked proposals。质量表只使用实际 assembly 后文本，blocked proposal 保持 current，不冒充改善。

## 90. Consensus Precision

定义为 improved events / evaluable changed events；P6=8/17=0.47058823529411764，P7=8/18=0.4444444444444444。未变化事件和 Gold 映射不明确事件不进入分母；P0 无变化，precision=null，不伪造 100%。

## 91. Consensus Harm Rate

定义为 regressed events / evaluable changed events；P6=6/17=0.35294117647058826，P7=7/18=0.3888888888888889。与 precision 同范围比较，不能只在改善子集上计算 harm。

## 92. Consensus Coverage

定义为实际发生变更且具有至少两个 distinct hypothesis 的事件数 / 182 个 multi-hypothesis events；P6=0.5384615384615384，P7=0.5054945054945055。它是干预覆盖率，不要求 Gold 可评估，也不是全字幕 goldTextCoverageRatio；不能把 199 个 canonical events 或 161 cues 随意代入。

## 93. Realized Consensus Gain

定义为可评估事件上 currentError − renderedOutputError 的总和，单位是归一化视图的编辑错误数，不是百分比：P1=6、P2/P3/P4/P8/P9/R3/reading-alignment=5、P5=8、P6=6、P7=4。补充 MBR_PRONUNCIATION=12、MBR_GRAPHEME=9、SWITCH_0=-5；负数保留为净损害。未映射事件不参与该总和。

## 94. Oracle Capture

定义为 realizedGain / legalPathOracleGain；本次分母=107。P6=6/107=0.056074766355140186（5.61%），P7=4/107=0.037383177570093455（3.74%）。Oracle 不限 switch 的上界与 max2 machine decode 不完全同空间；该比率不能当作组合专属 4-error gain 的捕获率。

## 95. Beats-all-candidate Count

所有 21 个 Profile 的 beats-all-existing-candidate count 都是 **0**。本次没有已渲染且可评估的输出被证明优于同事件全部现有候选；仅比 CURRENT 好不够。

## 96. Novel Exact-correct Count

所有 Profile 的 novel exact-correct count=0。实际渲染 novel 为 17 个相关 profile-event occurrences、7 个去重 event/text；其中 1 个是仅删除句号的 PUNCTUATION_ONLY（§102）。排除此项，评价 normalize 仍不同的 lexical-different novel 为 16 occurrences / 6 个去重 event/text；其中 11 occurrences（5 个去重 event/text）不可评估，不能算错或算对。

## 97. Novel Improved Count

所有 Profile 的 novel improved count=0。20 个 selected novel proposals → 17 个已渲染 occurrences → 0 个可评估改善，必须保留这三个层次。

## 98. Novel Regression Count

已渲染 novel 中 REGRESSED=5 个相关 profile occurrences，去重后是同一个 event/text；NEUTRAL=1，UNEVALUABLE=11。主 P7：2 novel rendered，1 regression、1 unknown、0 improvement。不能把未知 11 条写成无害或零回退证明。

## 99. Existing Candidate MBR Utility

P6 的 normalized CER 优于 P0、普通 ROVER 与 existing-only ROVER，是主 Profile 最佳；但 8 改善 / 6 回退、material 77→78，使它不满足完整质量 gate。它选择完整候选，不证明 Token/Span 重组合价值。

## 100. Lattice MBR Utility

P7 与 P6 全字幕 CER/material 相同，但相对 P6 的 38 个可评估事件是 0 改善 / 1 回退 / 37 neutral；P7 的 novel 也没有可验证改善。因此没有证据证明现有 Lattice MBR 实际优于候选级 MBR。理论组合 Oracle 有 4-error gain，不是当前 decoder 已捕获的收益。

## 101. ROVER Utility

R0→R1 的 global CER 下降 0.0087890625、hallucination 1→0，但可评估事件对比为 4 改善 / 4 回退，并非无代价提升。R1→R2 与 R2→R3 在本样本未见额外收益。2189 次真实 ROVER 解码结果都写入真实 Profile ID，不混淆 P3/P8/P9/补充对齐的 R2 结果。

## 102. Pronunciation-aware Utility

三类效应分开：读音 voting（P4 vs P3）global normalized CER 恶化 0.001953125，可评估 event 为 0 改善 / 0 回退，不能将全局变化归因成已证实同音异义错误；读音 alignment（ALIGN_PRONUNCIATION_R2 vs P3）本次质量完全相同，0 改善 / 0 回退；读音 distance（MBR_PRONUNCIATION vs MBR_GRAPHEME）CER 改善 0.00830078125，可评估 2 改善 / 1 回退，但 material 仍为 78。

因此 pronunciation-aware alignment 本次没有证实帮助，也没有定位到具体同音异义错误；距离消融有混合收益，不能推广为所有读音技术均有效。精确原因保持 UNKNOWN。

为避免把词形、空白或标点变更计作词汇恢复，另外对 **1558 条实际 APPLIED_SHADOW_ONLY 记录**执行离线归一化审计：

| 口径                                                | Profile-event 条目 | 独立 event | 评估结果                                            |
| --------------------------------------------------- | -----------------: | ---------: | --------------------------------------------------- |
| 严格机器 normalize 等价（NFKC、折叠空白、保留标点） |                  1 |          1 | UNEVALUABLE 1，IMPROVED 0                           |
| 评价 normalize 等价（NFKC、去标点/空白、小写）      |                128 |         18 | NEUTRAL 61、UNEVALUABLE 67、IMPROVED/REGRESSED 均 0 |

唯一严格机器等价改变是 `P6 / canonical-event-0033`：换行变为空格，existing-candidate 路径，审计标记 **ORTHOGRAPHY_ONLY**；其 quality 状态 UNEVALUABLE，不被计作改善。128 条评价等价变化中的唯一 novel 是 `P1 / canonical-event-0088`：只删除句号，审计标记 **PUNCTUATION_ONLY**，错误 2→2、NEUTRAL；不能称为词汇恢复或新增词汇共识收益。

因此 17 个已渲染 novel occurrences / 7 个去重 event-text 包含 1 个 punctuation-only；评价归一化仍不同的 novel 只剩 **16 occurrences / 6 个去重 event-text**，对应 5 个相关回退 occurrences（1 个独立 event-text）和 11 个 unknown occurrences（5 个独立 event-text），没有已证实改善。

这些 ORTHOGRAPHY_ONLY / PUNCTUATION_ONLY 是本报告的离线审计标签，不宣称已经写入 frozen selected-path 字段。现有 surface restoration 函数、Schema 与测试支持 `orthographyOnly`，但下游路径没有强制持久化该旗标；明确持久化分类是后续可审计性改进，不在 Gold 后改写本轮 runtime 或冻结合同。审计依据为 manifest `2ad7fc59fba9f045ed33c9977265e3efc3c50da1fbead8577132c02514b41f2e` 与 selections `d2aa79941142b7875e20e878c6f2171ef025a8e787141d50673f946ea744f149`。

## 103. Independent CTC Utility

只使用原有 exact-identity frozen score evidence；未加载模型或新推理。P5 实际 candidate support 中 EXACT_CACHE_MATCH=168 条，涉及 84 个去重 evidence IDs、覆盖 84 个事件；UNKNOWN=664 条。正式 quality `acousticEvidenceUsed=84` 采用去重 evidence-ID 口径，不是 adapter 可绑定条数。

受控 P5 vs P3：2 个可评估事件改善、1 个回退，35 neutral、161 unknown；global normalized CER 下降 0.0048828125，但 material 78→79。结论是有限且混合的相对分数效用，未通过安全质量门。2/1 是事件对照效果，不是“84 个分数中恰有 2 有用、1 有害”的因果分类；单 evidence-ID 的有用/有害数量不可识别。缓存文件未实地验证时也不声称完成 model-cache-file 校验。

计量保护：§102 的 128 条评价 normalize 等价改变全部为 NEUTRAL 或 UNEVALUABLE，未计入 IMPROVED/REGRESSED；不能将这些表面变化或 punctuation-only novel 归功于声学纠错，也不能将 168 条 support、84 个 evidence IDs 与有效词汇修复数混同。

## 104. Correlation-control Utility

Raw support 中 Whisper 636、Reazon 237，R0 确有窗口数量导致的结构性票重不平衡。Provider balancing 改善 global CER 与 hallucination，但事件级 4 改善 / 4 回退，不能称完全纠正。额外 correlation balancing（P2→P3）本次 0 改善 / 0 回退、CER 不变；设计上的去重保护仍有效，实测质量额外收益未确认。

## 105. Provider-switch Ablation

SWITCH_0/1/2/3/UNLIMITED 各 199 事件，changed cues=88/89/89/89/89。SWITCH_0 global CER=0.580078125，但 material=79、局部 realizedGain=-5；其余均为 CER=0.58251953125、material=78、realizedGain=4。增大 switch 限额没有显示额外已交付收益；主 P7 已渲染 provider switches 总数=1、均值=1/93=0.010752688172043012、最大=1。主最佳 P6 总数/均值/最大均为 0。

## 106. Alignment Error Attribution

正式 attribution 没有足够证据把任一回退确诊为 ALIGNMENT_ERROR；不能把缺少已确诊计数写成“已证明没有对齐错误”。相对 P3，CURRENT-center 可评估 0 改善 / 1 回退，medoid-center 为 0 改善 / 2 回退；两者 global material=77 但 CER 更差，说明局部与全局匹配指标有不同取舍。reading-center 没有质量变化。

## 107. Vote Error Attribution

SLOT_VOTE_ERROR、CORRELATION_DOUBLE_COUNT、PRONUNCIATION_COLLAPSE_ERROR 均无独立可确定因果证据；对应 confirmed attribution count 未形成，回退归 UNKNOWN。不能从 CER 方向自动推断为投票错误或“计数为 0 所以无问题”。

## 108. Surface Error Attribution

最终选中路径 unprovenSurfaceRestoration=0、syntheticKanji=0；这证明表面 provenance 安全，不保证真实语言内容正确。质量层没有独立证据将回退确诊为 SURFACE_RESTORATION_ERROR，不能把未识别当成没有 lexical errors。

## 109. Pool Insufficiency

38 个可评估事件中，25 个 best-existing oracle 仍有误差，23 个 best-legal oracle 仍有误差；说明池/合法可达空间并不覆盖全部答案。但这不能解释为什么某个 decoder 相对 CURRENT 回退，因此不将回退直接归因为 CANDIDATE_POOL_INSUFFICIENT；正式因果归因仍为 UNKNOWN。

## 110. Unknown Attribution

正式 `c6-1-consensus-error-attribution.json`：UNKNOWN=88 个相关 profile-event regression occurrences。没有其他已确诊 causal labels；未识别不是“其余错误类型都为 0”。不为报告完整性捏造声学、对齐或投票原因。

## 111. Shadow ASS

21 个 Profile 各生成独立 ASS，与对应 JSON/SRT/VTT 同目录。`outputRole=RESEARCH_SHADOW_OUTPUT`、`privacy=LOCAL_ONLY`；不替换生产 ASS。

## 112. Shadow SRT

21 个 Profile 各生成独立 SRT；保留 161 个 cue 的 ID、开始和结束时间。装配失败回退到 current，不隐式删 cue。

## 113. Shadow VTT

21 个 Profile 各生成独立 VTT；同 Profile 三种格式与 package 由同一已验证文本集合序列化。

## 114. Production Text Mutation

0。生产 canonicalTextHash 保持 `2955f89365c09613c75d02eff00a972feacff3a087d7ef5f9a0f6319854cf4b9`；Shadow 改动不计为生产改动。

## 115. Production Timing Mutation

0。生产 canonicalTimingHash 保持 `e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936`；21 个 Shadow 的 timingHashUnchanged 都为 true。除 P0 外的 20 个 Profile 标记 matchingInducedTimingDelta=true，表示文本变化改变了全局匹配计量，不是实际时间轴改变或修复。

## 116. Production ASS Parity

原生产 ASS SHA-256 `594389d78bea462fb11d9158e9a70c2d9746b6a1a8a3c87351268754f85ceed7`，15311 bytes；同时独立保留 best-effort ASS identity。`V/c6-1-validation.json` 的 `production-original-files` 与 `post-validation-production-files` 均 passed，确认全部 QA 后原文件 byte hash 不变。

## 117. Production SRT Parity

原生产 SRT SHA-256 `faf08a201149f7a8c40312a094ee0732d74f8ce8d6822cdd331b2bb7d0ee3ddd`，11956 bytes；正式 validator 在 QA 前后均重新计算原文件身份，byte hash 不变。

## 118. Production VTT Parity

原生产 VTT SHA-256 `107e1e2aa2e01e0b2631d576659a84c91c0c8845f579370e8a44908d103b930a`，19530 bytes；正式 validator 在 QA 前后均重新计算原文件身份，byte hash 不变。原生产 JSON/ASS/SRT/VTT 合计 8 个文件的 identity aggregate 保持 `5f5f8026d0267bbcca1e62324fe534c4cfd13caee5b0a0273027af3e5246fc54`。

## 119. A/B Reproducibility

机器冻结 payload 为 A/B 100/100 文件 byte equal、aggregate 相同；包括 21×4=84 个 Shadow 文件及机器/基线/profile manifest。独立 validator 对完整机器目录的核对为 **101/101 byte equal**，因为另计入 `c6-1-machine-freeze.json` 本身；两个计数不是冲突。独立 validator 已完成 A/B 全部 42 个 Profile global evaluations 的重算，并验证 A/B **24/24 evaluation 文件**一致（21 个 local-only 详细评估文件及 quality/attribution/route 三个摘要）。下表给出可直接展示的三个汇总身份，报告不读取或摘录 detailed local-only Gold 内容。

| A/B evaluation artifact | 相同 Semantic hash                                                 | 相同 SHA-256                                                       | Byte equal |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------- |
| Quality                 | `b1a7ee16c49fed51ff51c0edecca7008df904f3ef6a55206bba10572a119be4c` | `8af1bc4af3b6fccf0c31c89e257fe47e50294c95d2b612d1d34ec8e25a13af4b` | true       |
| Attribution             | `ea8373fc5d0d258b0682e645581576699824d10cd556b72113bbf241232f8160` | `dedbcbcd93d8b62698779a147a0a2a8bf804d94cb9cbc45acbcfab712f6679c9` | true       |
| Route                   | `fe0cd1b800a546cf6757d50319cc7e9d10fca3cf0381ec8f0aea7d2b6524e509` | `b17dbcfdbf8433ecd3f66964ebd3465cc8161f7a89acf400628a557d75c1ce71` | true       |

共用 Oracle 产物均绑定同一 machineFreezeHash。Existing-candidate Oracle semantic hash=`b3c7294e29e1e0133e61a6c058a4a1dd195ccbf0439dc0bde084907d59a219ee`，SHA-256=`22a7a95b7b4d64062a8606b3f78f82c841145ef0eb2ad852fb99452f8204880b`；Legal-path Oracle semantic hash=`52a994f2d47730ee4eeab62313e7c3a077d24685befcec54dcd1b98ccb2f7114`，SHA-256=`4ae43c22edc12a2ee421a135171a62d963be12547b678238b8394dda688d8c02`。Legal Oracle identity 与 A 阶段读取的记录一致；Oracle 共用路径不伪装为额外的两份独立存档。

## 120. Engineering Gate

**PASSED**。`V/c6-1-validation.json` 明确 `engineeringPassed=true`，30/30 checks passed；semantic hash=`fddaf4634e50929e9dd5987e9f4191cc255a5048b8be31aa43fa6695d9517da9`。机器安全审计 12 类 violation 全 0、3874 条非空路径全部通过；正式 validator 独立重装配 A/B 各 21 个 Shadow，重算全部 42 次 global evaluations 与两侧 Oracle，确认机器 101-file / evaluation 24-file parity、128 个 strict JSON instances、production/source/Gold read-only 及分享 allowlist。

`V/c6-1-regression-evidence.json` 的 `allPassed=true`，semantic hash=`82f5ffcac64bcce0ec7ea47dc253a1f7dfd29931f91f8450236344e7b7894fc6`。9 个阶段顺序执行且 exit code 均为 0；正式日志 SHA 已逐一重新计算并与该回执相符。非测试阶段的 `passed=0` 是计数字段未用于测试，不是阶段失败。

| 阶段      | 实际命令或命令入口                                                                                            | 结果                                   | 日志（相对 V）              |
| --------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------- |
| Schemas   | `npm run generate:schemas`                                                                                    | 343 definitions，27 项 C6.1 注册均存在 | `logs/schemas.log`          |
| Typecheck | `npm run typecheck`                                                                                           | passed                                 | `logs/typecheck.log`        |
| Lint      | `npm run lint`                                                                                                | passed                                 | `logs/lint.log`             |
| Format    | `npm run format:check`                                                                                        | passed                                 | `logs/format-check.log`     |
| Build     | `npm run build`                                                                                               | passed                                 | `logs/build.log`            |
| Unit      | `npm test -- --maxWorkers=4`                                                                                  | 936 passed / 2 skipped / 0 failed      | `logs/unit.log`             |
| E2E       | `npm run test:e2e -- --maxWorkers=4`                                                                          | 48 passed / 1 skipped / 0 failed       | `logs/e2e.log`              |
| Targeted  | `npm exec -- vitest run --maxWorkers=4` 加回执中的 67 个明确文件                                              | 430 passed / 0 skipped / 0 failed      | `logs/targeted.log`         |
| Skill     | `python3 skill-creator/scripts/quick_validate.py .agents/skills/multilingual-video-subtitler`（回执命令标识） | `Skill is valid!`                      | `logs/skill-validation.log` |

三个测试命令均显式带 `MVL_MFA_INTEGRATION_TEST=0 MVL_SPEAKER_INTEGRATION_TEST=0`，只禁止新的真实 MFA/Speaker 模型 opt-in；没有关闭已缓存 fixture 的正常发现。跳过数是 Vitest 实测结果，不算通过；各测试命令的覆盖集合可能重叠，936、48、430 不累加为独立用例数。工程验收不改变 §121–124 的研究风险与生产 HOLD。

## 121. Research Signal

正式 A route=`CONSENSUS_ORACLE_POTENTIAL_DECODER_UNSAFE`，strongerSignal=`NOT_CONFIRMED`，qualifyingProfiles=[]。这里 UNSAFE 指实际质量风险与 gate 未满足，不是已交付路径存在非法 token/edge；机器安全审计仍全部为 0 violation。

## 122. Route Decision

`c6-1-route-decision.json` hash=`fe0cd1b800a546cf6757d50319cc7e9d10fca3cf0381ec8f0aea7d2b6524e509`，证据绑定 quality=`b1a7ee16c49fed51ff51c0edecca7008df904f3ef6a55206bba10572a119be4c`、oracle=`52a994f2d47730ee4eeab62313e7c3a077d24685befcec54dcd1b98ccb2f7114`、safety=`ee996f1fb37bd13571957502d7fe4c2a2c59b4d66fed43ec22053936a01dc399`。没有主 Profile 满足全部质量条件，不能升级为 CONSENSUS_DECODING_GAIN_CONFIRMED。

## 123. C6.1.1 Recommendation

`C6.1.1_DECODER_CALIBRATION_SHADOW_ONLY`，c611Status=GO 只针对离线/Shadow 校准开发，不是 prospective rollout、自动终稿或生产发布。下一阶段应保留冻结基线，重点解释 material error 增加、event mapping 大量未知和 novel 回退，先形成独立可定位证据，再用新的预登记/未见样本评估；不能继续在本次 Gold 上调好后声称泛化通过。C6.0.1.12 Human-on-exception 产品路线继续保留。

## 124. C6.0.2 Status

HOLD。C6.1 investigation 与现有生产质量发布门不同，本次不授权 C6.0.2。

## 125. Runtime Gold Input

runtimeGoldInputCount=0、humanMemoryInputCount=0。Gold 只允许双完整 freeze 之后在 evaluation-only 子流程中首次读取；人工审核稿不是本次机器候选输入。独立静态审计另外核对 20 个冻结 runtime modules，runtime Gold/evaluator imports=0；这是运行时代码边界的结构证据，不取代实际 freeze/read-only proof。

## 126. Dataset Hardcoding

机器选择与归一化不使用 benchmark 原文、Gold 标签或具体 event 的答案表。20 个冻结 runtime modules 的独立 AST 审计记录 long-answer literal=0、runtime Gold/evaluator imports=0；legacy evaluator 各函数 body 与 base 保持一致。`V/c6-1-validation.json` 的 `machine-runtime-gold-isolation` 与 `post-validation-frozen-inputs` 均 passed。该静态检查有明确范围，不应扩大宣称为对所有可能硬编码方式的数学证明。

## 127. Network

机器正式运行 networkUsed=false、newAsrInferenceCount=0；未重新加载 ASR/CTC 模型，不重新运行 pyannote。对 20 个冻结 runtime modules 的 AST 审计发现 model/process/network 入口=0，支持纯离线研究架构；**这是结构证据，不是操作系统网络抓包或进程追踪**，不得冒称网络监控结果。

## 128. Source Read-only

正式 `carnation-c6-1-quality-evaluation-20260830/c6-1-read-only-proof.json` 的 sourceBefore/sourceAfter 完全相同：size=847774958 bytes，mtimeMs=1784692412273.1868，SHA-256=`294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`，sourceUnchanged=true。该 proof semantic hash=`16b39ed1310f73df0ac95bfa715a172020dd19da5f54044d9b03b1dc3dd05385`。无新模型处理或写回；正式 validator 的 `read-only-recorded-proof` 与 `post-validation-read-only` 均 passed，确认全部 QA 结束后 size、mtime、SHA 仍不变。

## 129. Gold Read-only

报告不读取 Gold 原文件、不包含原字幕；只使用冻结后评估产物的数值与 hash。正式 proof 的 goldBefore/goldAfter 完全相同：size=17094 bytes，mtimeMs=1787570451152.2112，SHA-256=`a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`，goldUnchanged=true。正式 validator 在全部 QA 后再次核对 size、mtime、SHA，`goldReadOnly=true`。第一次读取在机器双冻结之后，时间见 §64；这不允许把 Gold 再反馈给已冻结机器策略。

## 130. Shareable

机器与 Shadow 产物标记 LOCAL_ONLY，不可默认直接分享。可分享审计的唯一严格 allowlist 是 `carnation-c6-1-validation-20260830/shareable/c6-1-shareable-summary.json`，不是整套原始证据或包含文本的 evaluation-local-only 文件。正式 validator 的 `shareable-allowlist-audit` 与 `shareable-file-allowlist` 均 passed：strict Schema 通过，absolute paths=0、secrets=0、source/Gold text=0、unexpected files=0；没有复制音频、人工 notes、event 内容或字幕串。摘要 semantic hash=`110041ff40aeb6a1ad581c316da328e93fc69aa30ac86024bfb89a06b581d964`。

该摘要本身没有文件链接，因此 broken relative reference count=0 是对空引用集合的核对，不代表已检查所有 LOCAL_ONLY 目录的引用。本文只含计量、身份与算法说明，不含字幕正文或 Gold 正文。

## 131. C5.19 Regression

PASSED。实际执行 `tests/c5-19-series-memory.test.ts` 与 `tests/e2e/c5-19-series-memory-flow.test.ts`，二者均在正式 targeted 的 67/67 passed files 中，覆盖 series memory 与流程边界。

§131–146 共用证据：`V/c6-1-regression-evidence.json` 的 targeted `command` 完整列明文件，`V/logs/targeted.log` 实测 **67 files / 430 tests passed，0 skipped，exit 0**；日志 SHA=`1bcfc4436a20d73706a15bea13069c9537f12894ef546d5cbd62b8b7876c99c7`。当前日志不逐文件输出 test count，因此以下只给可验证的已执行文件范围，不虚构各版本独立用例数。

## 132. C6 Investigation Regression

PASSED。正式 targeted 包含 `tests/c6-0-blocker-ontology.test.ts`、`tests/c6-0-counterfactual-finalization.test.ts`、`tests/c6-0-evidence-freshness.test.ts`、`tests/c6-0-human-authority.test.ts`、`tests/c6-0-root-cause-graph.test.ts` 及 `tests/e2e/c6-0-investigation-flow.test.ts`；这 6 个文件均通过，覆盖只读 counterfactual、风险分离、根因图与 A/B 流程。回执与日志见 §131。

## 133. C6 Protected Regression

PASSED。正式 targeted 包含 9 个 unit 文件：`c6-0-baseline-preservation`、`c6-0-freshness`、`c6-0-human-authority-verification`、`c6-0-protected-finalization`、`c6-0-protected-schemas`、`c6-0-review-disposition`、`c6-0-risk-assessment`、`c6-0-risk-policy`、`c6-0-root-risk`（均位于 `tests/`，后缀 `.test.ts`），以及 `tests/e2e/c6-0-protected-finalization-flow.test.ts`，10 个文件全部通过。缓存 fixture discovery 未被关闭；未以绕过 human authority 或 machine-only release 门换取通过。

## 134. C6.0.1 Regression

PASSED。`tests/c6-0-1-blind-acceptance.test.ts` 与 `tests/e2e/c6-0-1-gold-isolated-evaluation-flow.test.ts` 均执行并通过，覆盖 blind acceptance 与 Gold-isolated evaluation；证据见 §131。

## 135. C6.0.1.1 Regression

PASSED。`tests/c6-0-1-1-machine-quality-recovery.test.ts` 与 `tests/e2e/c6-0-1-1-machine-quality-recovery-flow.test.ts` 均执行并通过；质量恢复的测试通过不等于真实质量 gate 自动升级。

## 136. C6.0.1.2 Regression

PASSED。`tests/e2e/c6-0-1-2-candidate-timeline-flow.test.ts` 实际执行并通过，覆盖 candidate/timeline 流程；不凭不存在的同名 unit 文件声称额外测试。

## 137. C6.0.1.3 Regression

PASSED。`tests/c6-0-1-3-candidate-association-assembly.test.ts` 与 `tests/e2e/c6-0-1-3-association-assembly-flow.test.ts` 均执行并通过，保留 candidate association 与 canonical assembly 回归。

## 138. C6.0.1.4 Regression

PASSED。`tests/c6-0-1-4-vad-timebase.test.ts`、`tests/c6-0-1-4-variant-reasr.test.ts` 与 `tests/e2e/c6-0-1-4-vad-variant-reasr-flow.test.ts` 三个文件执行并通过；本轮未为回归新增真实 Re-ASR。

## 139. C6.0.1.5 Regression

PASSED。`tests/c6-0-1-5-lineage-evidence.test.ts`、`tests/c6-0-1-5-mutation-timing.test.ts`、`tests/c6-0-1-5-recovery-coverage.test.ts` 与 `tests/e2e/c6-0-1-5-evidence-to-canonical-flow.test.ts` 四个文件执行并通过，覆盖 lineage、mutation/timing 与 coverage。

## 140. C6.0.1.6 Regression

PASSED。`tests/` 下 `c6-0-1-6-boundary-refinement`、`c6-0-1-6-ceiling-policy`、`c6-0-1-6-edge-decoder`、`c6-0-1-6-risk-priority`、`c6-0-1-6-span-lineage-repair`（后缀 `.test.ts`），及 `tests/e2e/c6-0-1-6-acoustic-span-boundary-flow.test.ts` 六个文件执行并通过。

## 141. C6.0.1.7 Regression

PASSED。`tests/c6-0-1-7-fresh-reasr-ceiling.test.ts` 与 `tests/e2e/c6-0-1-7-fresh-reasr-ceiling-flow.test.ts` 执行并通过；测试名称中的 fresh 不表示本次 investigation 进行了新真实模型推理。

## 142. C6.0.1.8 Regression

PASSED。`tests/c6-0-1-8-core-stability.test.ts` 与 `tests/e2e/c6-0-1-8-core-stability-flow.test.ts` 执行并通过，保留 localized/core-span 稳定性回归。

## 143. C6.0.1.9 Regression

PASSED。`tests/c6-0-1-9-independent-asr-provider.test.ts`、`tests/c6-0-1-9-machine-analysis.test.ts` 与 `tests/e2e/c6-0-1-9-independent-asr-complementarity-flow.test.ts` 三个文件执行并通过；没有重新运行 independent ASR。

## 144. C6.0.1.10 Regression

PASSED。`tests/c6-0-1-10-cross-model-arbitration.test.ts` 与 `tests/e2e/c6-0-1-10-cross-model-arbitration-flow.test.ts` 执行并通过，保留 abstention-first arbitration 与 safe assembly 边界。

## 145. C6.0.1.11 Regression

PASSED。`tests/` 下 `c6-0-1-11-ablation-route`、`c6-0-1-11-calibration-data`、`c6-0-1-11-independent-ctc`、`c6-0-1-11-paired-evidence`、`c6-0-1-11-selective-cv`（后缀 `.test.ts`），以及 `tests/e2e/c6-0-1-11-paired-discriminator-calibration-flow.test.ts` 六个文件执行并通过。独立 CTC 分数在本轮只按精确冻结证据复用，不将单模型复核冒称新独立 ASR。

## 146. C6.0.1.12 Regression

PASSED。`tests/` 下 `c6-0-1-12-correction-workflow`、`c6-0-1-12-freeze-dataset-integrity`、`c6-0-1-12-review-builders`、`c6-0-1-12-review-quality-route`、`c6-0-1-12-review-workspace`、`c6-0-1-12-schemas`、`c6-0-1-12-synthetic-workflow-integrity`（后缀 `.test.ts`），以及 `tests/e2e/c6-0-1-12-review-assistance-flow.test.ts` 八个文件执行并通过。§4 的 baseline replay 与这里的实际测试回归分别留证，没有用 replay 替代 regression。

## 147. Unit Tests

正式 `npm test -- --maxWorkers=4` exit 0：**116 files passed，936 tests passed，2 skipped，0 failed**。日志 `V/logs/unit.log`，SHA=`a242e2ce8dbbdac74d820e8e17a955e77ecb3769cabfbfa73864ae5d20acb593`；回执 durationMs=50822。冻结前 25/25 scoped safety/Shadow/Oracle/E2E 检查是补充证据，不替代这次全量结果。

## 148. E2E Tests

正式 `npm run test:e2e -- --maxWorkers=4` exit 0：**26 files passed，48 tests passed，1 skipped，0 failed**。日志 `V/logs/e2e.log`，SHA=`6b2b315043a374ad8db028f17c71bfc8e8632ac6c3581e587be8a0fdf3ed5bb4`；回执 durationMs=12698。

新增 synthetic E2E 4/4：完整机器链路及双冻结、空/伪造/损坏 freeze 拦截、runtime Gold contamination 拒绝、补充 graph 精确绑定。测试只用合成 Gold；验证正式读入前无 Gold read/stat、生产不变、模型与网络调用为 0。真实 MFA/Speaker opt-in 的禁用说明见 §120，不将 skipped 计为 passed。

## 149. Targeted Tests

正式 targeted exit 0：**67 files passed，430 tests passed，0 skipped，0 failed**；回执 durationMs=40220，完整 67 文件命令数组见 `V/c6-1-regression-evidence.json`，日志和 SHA 见 §131。除 §131–146 的历史回归外，执行了 `tests/c6-1-hypothesis.test.ts`、`tests/c6-1-alignment.test.ts`、`tests/c6-1-decoders.test.ts`、`tests/c6-1-quality-route.test.ts`、`tests/c6-1-safety-shadow-oracle.test.ts` 与新 C6.1 E2E；覆盖守恒、去重/来源、合法路径、surface restoration、Gold barrier、profile/graph 归属和实际渲染评估。

## 150. Schema Count

`npm run generate:schemas` exit 0，实生成 **343 个 JSON Schema definitions，其中 C6.1 registry 27 项全部存在**。日志 `V/logs/schemas.log`，SHA=`c403eaa90d0a414547c57ba3f20a60f05571d0513b107e55b24c6092255b4408`。独立 validator 另外严格解析 **128 个真实 JSON artifact instances**，并验证所有 C6.1 wrapper semantic hashes；实例数、Schema 定义数与测试用例数是不同口径。未知字段拒绝，不能用宽松 parse 冒称 strict validation。

## 151. Skill Validation

PASSED。回执中的 `quick_validate.py .agents/skills/multilingual-video-subtitler` 执行 exit 0，实际日志为 `Skill is valid!`。日志 `V/logs/skill-validation.log`，SHA=`db349825903d66adffea3ecf1bd8e1803043e8a71cf1a051235dabc5371f5bb0`；此为独立 Skill 验证阶段，不以编译结果替代。

## 152. Skill2/3

Skill 2/3 未修改。报告收尾时对 base `c56ec2897d7dc64719b53163d0f71fe1023c2a9a` 的只读 diff 与当前 status 核对：`.agents/skills/multilingual-grammar-report-generator`、`.agents/skills/multilingual-grammar-learning-site-builder`、`packages/grammar-report-core`、`packages/site-builder-core` 均无变更。共享 Schema 的新增项仅服务 C6.1，不能将 shared 文件改动说成 Skill 2/3 算法变更；交付前仍需按 §155 核对最终提交范围。

## 153. Remaining Risks

已知 benchmark 有历史开发暴露，不能证明未知节目泛化；大量候选相关且 reading coverage 不完整；272 次近似搜索不能扩称为精确空间；合法路径不代表真实语音正确；161 个事件的 Gold 映射不可用，不能当作无错误；Shadow 装配可能因 lineage、冲突、presentation capacity 回退。完整工程 QA 与单一可分享摘要审计已经通过，但主 Profile material errors 回退、novel 未证实改善和未知样本不足仍然阻断质量发布。Git 推送完成也不会改变这一质量结论。

## 154. Commits

已创建并通过本地 git log 核验的六个 implementation commits（此处不等同于已 push）：

| 提交 | 范围                                          | SHA                                        |
| ---- | --------------------------------------------- | ------------------------------------------ |
| 1    | Hypothesis universe / Japanese views          | `ce496a026d3e2304789f333cc51d77493509217e` |
| 2    | Pairwise / MSA / legal lattice                | `5e186526003313d38854ae14571e870a6380b145` |
| 3    | Correlation-aware network / ROVER             | `82f32976508966b97bb441739406ea4547929fec` |
| 4    | Candidate / lattice MBR                       | `6edca5bd6ff62eb19da0d4491683cb330264c0f4` |
| 5    | Provenance / safety / shadow                  | `03e3455ba2ed42cb13ccb0999414a9c4c8257042` |
| 6    | Gold-isolated evaluation / oracles / ablation | `f57ce0e469bd0c713c1289744ff2bfac5da40724` |

第 7 个 acceptance commit 包含本报告，不能在提交自身内容中自嵌最终 SHA；精确值见推送后独立 git delivery receipt 与最终回复。

## 155. Remote HEAD

精确 acceptance SHA、local HEAD、remote HEAD 与 worktree status 由推送后的独立回执 `carnation-c6-1-validation-20260830/c6-1-git-delivery.md` 提供。当前报告撰写阶段不预先声称 push 完成；交付时必须核对 local HEAD == remote HEAD 且 worktree clean，最终回复同时提供精确 SHA。

## 156. Output Paths。

实际输出根为用户工作区 `Codex-Skills/output/`。已逐项核对以下 **19 个目录全部实存**；§120 的正式验收回执绑定机器、评估与验证产物，不用预计目录代替完成证据。

```text
carnation-c6-1-baseline-20260830/
carnation-c6-1-hypothesis-universe-20260830/
carnation-c6-1-text-representations-20260830/
carnation-c6-1-pairwise-alignments-20260830/
carnation-c6-1-multiple-alignments-20260830/
carnation-c6-1-token-lattice-20260830/
carnation-c6-1-confusion-network-20260830/
carnation-c6-1-rover-20260830/
carnation-c6-1-mbr-20260830/
carnation-c6-1-span-consensus-20260830/
carnation-c6-1-safety-audit-20260830/
carnation-c6-1-shadow-profiles-20260830/
carnation-c6-1-existing-candidate-oracle-20260830/
carnation-c6-1-legal-path-oracle-20260830/
carnation-c6-1-ablation-20260830/
carnation-c6-1-quality-evaluation-20260830/
carnation-c6-1-final-a-20260830/
carnation-c6-1-final-b-20260830/
carnation-c6-1-validation-20260830/
```

正式报告文件：`C6_1_MULTI_ASR_CONFUSION_NETWORK_MBR_INVESTIGATION_REPORT.md`。

## Machine artifact hash receipt

| Artifact               | Semantic hash                                                      |
| ---------------------- | ------------------------------------------------------------------ |
| Hypothesis universe    | `2d5018e745502636b68da9dc594a2fb11f957e2e18ae84520b7977c633deee9a` |
| Text representations   | `ec81814d79830ed0444889fd3e5fffd325b566d7dc34ca2d97b6b5503d3423f5` |
| Pairwise alignments    | `cf1ca9a9a70268789524a57fe282b2e3f78badb51870eed5512fb06e93fc10b0` |
| Multiple alignments    | `da25af55ba3e25d2ca63dfdcfc9fbe0111d292d033e4fe7db73c97705faede95` |
| All token lattices     | `0580583e7f6fd944003f8c387fbb31ce1e68eec4a61309755449f828b829e6a6` |
| All confusion networks | `594d84c60511fa505274336da8c9a6e9bc16a5b6fe66d43ce18f1557eb2e1a0a` |
| ROVER                  | `3beef85ab0b39a79f8e47929d09461a541308d0b4b5c704e3a7a6ce5c8951caa` |
| MBR                    | `dc2c81d6c00782ef20b03f9cb6f4e2dd5aa3ea97043de688fc8b5508f3a4b77b` |
| Span consensus         | `2c61e862b2e8dfc02952d940eeefba7f17f229bce0336312966dfcc2f4613962` |
| Safety audit           | `ee996f1fb37bd13571957502d7fe4c2a2c59b4d66fed43ec22053936a01dc399` |
| Path provenance        | `fcfe9c67f8e06a9e8d9a4cdd67706978cd48f1cdfc755abd8109f98f0c7ab3a7` |
| Profile selections     | `d2aa79941142b7875e20e878c6f2171ef025a8e787141d50673f946ea744f149` |
| Shadow manifest        | `2ad7fc59fba9f045ed33c9977265e3efc3c50da1fbead8577132c02514b41f2e` |

## Q1–Q20：冻结后研究结论

### Q1. 最终真实候选及 Whisper / Reazon 数量

1496 条原始输入全部记账；832 条 INCLUDED 中有 671 条真实 ASR 候选（Whisper 446、Reazon 225），另有 161 CURRENT control。CURRENT 不是新模型、不是第三个独立 provider，不参与独立多数票。

### Q2. 真正具备 Token/Span 组合条件的 Event

182 个 multi-hypothesis events；其中主 P7 的实际合法 n-best 在 75 个事件发现 novel 路径，可作为已发现组合条件的下界。不能把 182 都当作有用组合；实际全 Profile 选中 novel 涉及 10 个事件，最终渲染且去重后仅 7 个事件。

### Q3. MSA 输入顺序不敏感性

已验证：候选置换 A/B 的 100 个机器冻结文件 byte equal，包括 MSA、lattice、network、decoder 与 Shadow。补充图通过 event + latticeHash 绑定，不靠容器顺序。

### Q4. Confusion Network 的 slot 分布

主图 3691 slots：exact agreement 1228、normalized agreement 0、pronunciation-equivalent 10、lexical disagreement 2453；按后两类合计 ambiguous=2463。全图数见 §34–38，不把补充配置重复计成独立事件。

### Q5. Raw Candidate Majority 是否受 Whisper Window 数量偏置

有结构性票重偏置风险：真实 distinct raw support 为 Whisper 636 vs Reazon 237。R0 有意保留该 raw-vote 消融；这种数量不平衡不是独立语音正确性的证据，也不能仅凭数量断言所有 R0 错误由它导致。

### Q6. Provider / Correlation 平衡是否改善

Provider-balanced 相对 raw 的 global CER 下降 0.0087890625、hallucination 1→0，但可评估事件 4 改善 / 4 回退。额外 correlation-aware 相对 provider-balanced 本次 0 改善 / 0 回退、CER 不变。因此结构性去重保护成立，质量收益混合，额外 correlation-control 收益未确认。

### Q7. Candidate MBR 是否优于 Current 与普通 ROVER

按主 Profile global CER 排名，是；P6=0.58251953125，优于 P0=0.6015625 和 R0–R5。但 material 77→78、局部 8 改善 / 6 回退，不满足全指标安全质量门，不能据此自动发布。

### Q8. Lattice MBR 是否生成优于全部输入候选的新文本

没有得到实际交付证据。所有 Profile beats-all-existing=0；P7 的已渲染 novel 没有改善，只有 1 回退、1 不可评估。只有精确合法 Oracle 显示额外 4-error 理论潜力。

### Q9. Novel Legal Path 数量与收益/回退

主 P7 n-best 有 569 条合法 novel 路径；所有 Profile 最终选中 20 occurrences，实际渲染 17 occurrences，去重为 7 个 event/text。去重后 0 改善、1 回退、1 neutral、5 unknown；其中唯一 neutral novel 只是删句号的 PUNCTUATION_ONLY。排除此项，评价归一化仍不同的 novel 为 16 occurrences / 6 个去重 event-text（1 回退、5 unknown、0 改善）。相关 occurrences 的回退数 5 不代表五个独立事件。

### Q10. Existing Candidate Oracle 理论增益

38 个可评估事件、416 个归一化 graphemes：current error 210 → best existing 107，理论减少 103 个编辑错误。这是局部集合，不是全字幕 CER 改善。

### Q11. Legal Path Oracle 额外理论增益

best existing 107 → best legal 103，额外减少 4，发生于 3 个事件。合法 Oracle 不施加机器 max2 switch 上限；必须同时披露这一搜索空间差异。

### Q12. Token/Span 是否提供候选并集之外的信息价值

理论上有小幅潜力（额外 4 个错误减量）；实际已渲染输出尚未证明这种价值被安全捕获（novel improved=0、beats-all-existing=0）。不能把 theoretical potential 写成 confirmed decoding gain。

### Q13. 哪种 Gold-free Profile 实际最好

预登记主 P1–P9 中是 P6 Candidate MBR；P7 同全局 CER 但更多局部回退。补充 MBR_PRONUNCIATION 的 CER=0.5771484375 更低，不过它是冻结前确定的 distance ablation，不可事后改成主 winner，且 material=78 仍未过门。

### Q14. 最佳 Profile 的关键质量变化

P6：normalized CER 0.6015625 → 0.58251953125；material errors 77→78；hallucination 1→0；missing 6→6；coverage 0.96484375 不变。并非各项都改善。

### Q15. 最佳 Profile 改善与损害多少事件

38 个可评估事件中 P6 改善 8、回退 6、neutral 24；另有 161 个不可评估事件。P6 实际改变 99 个 event spans，其中 82 个 changed-unknown，不得默认无害。

### Q16. Pronunciation-aware Alignment 的帮助或同音错误

真实 pronunciation-aware alignment Shadow 相对主 R2 的本次质量无变化，0 个可评估改善 / 0 回退。读音 voting 的全局 CER 略恶化，读音 MBR distance 有 2 改善 / 1 回退；三者不是同一实验。未定位到可确证的同音异义因果错误，结论不是“没有这类错误”，而是尚不可识别。

### Q17. Independent CTC 是否有帮助

复用 84 个去重 exact-cache evidence IDs；P5 vs P3 有 2 个可评估改善、1 回退，global CER 下降 0.0048828125，但 material errors 增加 1。属于混合且不足以过门的帮助，不是无条件有效；每个分数本身的有用/有害标签不可识别。

### Q18. Shadow 的 provenance、安全与生产不变

所有 3874 条非空 selected paths provenanceComplete，42330 token 条目有来源；unsupported token/adjacency、跨事件、synthetic Kanji、非单调、环路、生产文本/时间 mutation 均为 0。安全合法不等于字幕正确，未知质量不能被这些 0 掩盖。

### Q19. 研究结论属于哪一类

`CONSENSUS_ORACLE_POTENTIAL_DECODER_UNSAFE`；strongerSignal=`NOT_CONFIRMED`，qualifyingProfiles=[]。它不是 engineering-invalid，也不是 confirmed gain；生产保持 needs-review / none / release=false。

### Q20. 下一步具体路线

进入 **C6.1.1 Decoder Calibration，Shadow-only**，不进入 Frozen Prospective Shadow，不授权 C6.0.2。继续保留 C6.0.1.12 Human-on-exception 产品路线；下一轮应针对 material error 增加、novel 回退及大量不可评估 event 建立独立、可定位的证据与新预登记验证，而不是使用本次 Gold 反复调优后宣称泛化。
