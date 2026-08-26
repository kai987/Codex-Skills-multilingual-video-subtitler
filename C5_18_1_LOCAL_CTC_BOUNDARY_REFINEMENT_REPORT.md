# C5.18.1 Local CTC Boundary Refinement 真实模型验收报告

结论：**C5.18.1 real-model acceptance passed**。本结论表示局部日语 CTC 强制对齐运行时、证据合同、Fresh / Observe / Cache Replay、缓存与跨运行语义一致性均通过验收；它不表示 7 个待复核字幕重叠已经自动解决。最终字幕继续保持 `needs-review`、`finalizationMethod: none`、Review Item 7 → 7。

本次只在 C5.18 已确认的 7 个 Review Component、16 个 cue 上运行局部 CTC。Canonical 文本、Canonical 时间、Speaker 算法和 Skill 2/3 均未被修改；没有重新运行 pyannote、MFA、Whisper 或 whole-media ASR。

## 1. 验收范围

C5.18.1 的目标是验证“已知 Canonical 文本能否在窄局部音频中获得足够稳定的 CTC 边界证据”，并以 fail-closed 门禁决定是否允许时间调整。它不是新的字幕转写阶段，也不以降低 Review 数量作为验收条件。

## 2. 仓库与分支

- 仓库：`https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- 分支：`codex/c5-18-1-local-ctc-boundary-refinement`
- C5.18 基线：`31f6bcdbde09649c3b100a40908acc55517b536e`
- 功能提交：`0c04716bae757c27625d0674629ed1c884e3e5c2`

## 3. C5.18 基线状态

C5.18 已通过真实 Speaker Evidence 验收，但只解析了 1 个 Component 的 Speaker Relationship；字幕 overlap resolved 仍为 0，Review Item 仍为 7。C5.18.1 继承这条安全边界。

## 4. 非目标

本阶段不重写 Canonical 文本、不重新识别对白、不放宽 Review 门禁、不重新运行 pyannote、不修改 Speaker 算法、不修改 Skill 2/3，也不开始 C5.19 或 C6.0。

## 5. 为什么使用 CTC

CTC 路径允许将用户人工复核后的 Canonical 文本作为固定目标，在局部声学帧上寻找单调 token 路径。这样能把“识别出什么文本”和“该文本位于哪里”分开，同时禁止模型的 greedy 输出改写字幕。

## 6. CTC 模型选择

真实模型为 `reazon-research/japanese-wav2vec2-large-rs35kh`。它面向日语 wav2vec2 CTC，对本项目日语目标语言比通用英文模型更匹配。

## 7. 固定模型 Revision

模型 revision 固定为 `2162c9edb97f362f7623d6b3a2e417458e879bca`，不使用漂移的默认分支。

## 8. 模型 Snapshot Hash

完整 Snapshot 含 9 个文件，SHA-256 为 `47f29c9f9e4175e058ce87287a75e43cacd2d11e810e21098ab898d77a2a43dd`。

## 9. 模型许可

Snapshot 元数据记录许可为 Apache-2.0。报告只记录许可身份，不把模型文件复制进 Shareable Artifact。

## 10. Runtime Identity

CTC Runtime Identity Hash 为 `4826687aaae95dd1931833e578c9260b5fb2b952f45ccafe4b5a1d6ed9a6da60`；Runtime Lock Hash 为 `30945ff934d384e12380561eb0fb799268b5a66c7754082157e84771b9c04ff6`。

## 11. Runtime 软件栈

真实环境为 Python 3.12.14、torch 2.13.0、transformers 5.16.1、huggingface_hub 1.28.0、safetensors 0.8.0、numpy 2.5.2、soundfile 0.14.0。

## 12. Processor 与模型类

运行时加载 `Wav2Vec2CTCTokenizer`、`Wav2Vec2Processor` 和 `Wav2Vec2ForCTC`，并把 tokenizer、processor、model identity 纳入 capability 与 cache identity。

## 13. Tokenizer Identity

词表大小为 3004；blank token id 为 0，pad token id 为 3002，unknown token id 为 0。目标编码中的 unknown/special token 会显式进入 blocker，而不会被静默删除。

## 14. 音频规格

所有 CTC 请求使用 16 kHz 单声道局部音频。运行时没有对整集媒体执行 CTC。

## 15. Frame Mapping

卷积 kernel 为 `[10,3,3,3,3,2,2]`，stride 为 `[5,2,2,2,2,2,2]`。总 stride 为 320 samples，即 20 ms；receptive field 为 400 samples，即 25 ms。

## 16. Frame Count 验证

每个成功请求均通过 iterated-valid-convolution 公式验证 predicted/logits/expected frame count。28 个成功直接路径的 worker request 与 frame mapping 均验证通过。

## 17. 本地 Viterbi 实现

对齐算法为 repo-local `mvl-ctc-viterbi-v1`，显式处理 blank、重复 label、前向回溯和 token span。运行时未依赖 `torchaudio.functional.forced_align`。

## 18. DP 单元测试

单元测试覆盖 blank/self-loop、重复 token、不可达路径、帧区间换算、窗口边缘、cache identity 和确定性回放，确保 DP 语义不是由真实样本偶然通过。

## 19. CPU 与 MPS Probe

CPU 和 MPS 均完成 capability probe，token path identity 一致；但两者最大边界差为 2.36 秒，超过 40 ms 验收阈值。因此 `deviceRequested: auto` 安全回退到 CPU，最终真实运行 `deviceUsed: cpu`。

## 20. 推理网络边界

模型准备与 Snapshot 下载和推理解耦。三套最终 Artifact 均记录 `networkUsedDuringInference: false`，推理阶段不依赖网络。

## 21. Canonical 文本作为唯一 Target

CTC target 由人工复核后的 Canonical cue 文本派生，只进行 NFC、显示换行移除、非口语标点移除和空白折叠。Greedy decode 不能成为字幕文本来源。

## 22. 文本完整性

16 个 cue 的 `canonicalTextMutationCount` 为 0、`lexicalCharacterDeletionCount` 为 0。目标规范化可审计，禁止为了让 tokenizer 接受而删除词汇字符。

## 23. Target 可编码性

16 个 cue 中 14 个可完整编码，2 个不可编码；总 unknown token 2、special token 2。不可编码的两个 cue 在窄/扩展窗口两次尝试中均 fail closed，形成 4 个不可对齐 attempt。

## 24. 局部窗口策略

每个 cue 运行 narrow 与 expanded 两个局部窗口，共 16 × 2 = 32 个直接请求。narrow context 为 0.5 秒，双窗口允许的边界差上限为 0.12 秒。

## 25. Fresh 直接推理

Fresh Run ID 为 `c5-18-1-3527d151-3dc4-4f59-9c0d-1b21a6d8405b`，直接 CTC 请求 32、真实 inference 32、cache hit 0、model load 1。

## 26. 路径成功率

32 个直接 attempt 中 28 个 `pathStatus: success`，对应 14 个可编码 cue 的窄/扩展双窗口；其余 4 个只因两个 cue 的 target 不可表示而拒绝。

## 27. 双窗口稳定性

start stable cue 为 9，end stable cue 为 7，start/end 同时稳定的完整边界 cue 为 7。仅“双窗口接近”仍不足以通过最终 timing gate。

## 28. Window Edge Guard

1 个 cue 的 attempt 被识别为窗口边缘 pinned。边缘贴靠会削弱边界可信度并进入 blocker，不能直接变成时间修改。

## 29. CTC 质量分数

28 个成功直接 attempt 的 mean token posterior 平均为 0.158568，范围约 0.00001858–0.819627；minimum-token posterior 平均为 0.021928。normalized path log score 平均为 -0.178488，范围 -0.967947–-0.060130。

## 30. Blank 与跨度诊断

blank frame ratio 平均为 0.972144，范围 0.896552–0.995816；target span/window ratio 平均为 0.323281，范围 0.072788–0.826042。这些量只作为未校准诊断，不能单独授权 timing mutation。

## 31. 分数校准状态

Artifact 明确记录 `scoreCalibrationStatus: uncalibrated-ctc-score`。实现没有把缺少校准的数据伪装成概率门禁，也没有为追求自动解决而临时调整阈值。

## 32. Greedy Decode 边界

32 个直接 attempt 的 greedy normalized similarity 平均为 0.158977，范围 0–0.875。Greedy 文本始终为 diagnostic only；`greedyTextMutationCount: 0`。

## 33. 禁止 Token Ratio 修补

`tokenRatioRepairCount: 0`、`forbiddenTimingHeuristicUseCount: 0`。没有按字符比例、token 比例或时长比例猜测字幕边界。

## 34. Duplicate Occurrence Guard

检测到 1 个 duplicate occurrence conflict，影响 `overlap-acoustic-def4f9e5f20a6a24af59` 的两个 cue。系统保留歧义，不把同一句声学出现错误分配给多个字幕。

## 35. Component Joint Assignment

Joint assignment 使用 `component-monotonic-atomic-v1`。7 个 Component 中只有 `overlap-acoustic-5e6df4ca8c77b3a51802` 获得单调、无新增非法重叠的 joint assignment；其余 6 个被明确 blocker 拒绝。

## 36. Legal Existing Overlap Guard

`overlap-acoustic-de9815d25ae4c3a8e718` 的候选会删除既有合法 overlap，因此以 `CTC_LEGAL_OVERLAP_DELETED` 拒绝。Speaker Relationship 已知并不能绕过这条字幕时间门禁。

## 37. New Illegal Overlap Guard

多个 Component 的候选会制造新的非法 overlap，统一以 `CTC_NEW_ILLEGAL_OVERLAP` 拒绝。系统没有用局部 CTC 结果破坏邻接 cue 的时序约束。

## 38. 原子 Component 语义

时间提案以 Component 为原子单位验证：任一 cue 缺少安全证据、次序不单调、破坏合法 overlap 或引入非法 overlap，整个 Component 回滚。不存在“只改容易的一半”后留下不一致状态。

## 39. Timing Materialization

实现包含真实 timing-only materialization 路径，并验证 cue identity、原始时间、最大改变量、邻居关系、文本不变和序列化 parity。由于本次没有 Component 通过全部门禁，该路径正确地产生 0 个 mutation。

## 40. MFA 交叉证据

原始数值层面，4 个 cue 的 10 个可比较边界中有 5 个在 120 ms 内接近 MFA；但相关 MFA 记录并非 `mfaValid`，没有合格 clean evidence id，因此可准入的独立 MFA lexical side 为 0。

## 41. Mapped Token 交叉证据

Mapped-token 时间提供 14 个可比较 side，但在门限内的准入 agreement 为 0/14。C5.18.1 没有把旧映射 token 的存在误写成对 CTC 边界的确认。

## 42. Evidence-DP 交叉证据

Evidence-DP 有 18 个可比较 side，仅 1 个数值接近；它不属于独立 lexical alignment family，因此不能单独满足 side-specific lexical consensus。

## 43. Raw VAD 交叉证据

本次 cue comparison 中可用于边界准入的 raw VAD side 为 0。实现没有从缺失的 VAD 边界推导支持，也没有重跑 VAD。

## 44. Speaker 交叉证据

16 个 cue 中 speaker non-contradictory 2、contradictory 14。C5.18 的 Speaker Evidence 只描述局部说话人关系，不自动提供 lexical start/end。

## 45. Speaker 与字幕解决状态

Speaker Relationship resolved Component 为 1，但 Subtitle overlap resolved Component 为 0。该差异被保留在 replay summary、finalization、Review UI 和本报告中，禁止混写。

## 46. Side-specific Consensus

开始边界和结束边界分别要求独立 lexical evidence consensus；仅 CTC 双窗口稳定、仅 Speaker 一致或仅非 lexical evidence 接近，都不足以授权一侧时间修改。

## 47. Source Separation 触发范围

Source separation 只对 4 个证据不足的 Component 触发，不对整集运行，也不覆盖已有直接 CTC 证据。其模式为 experimental observe-only。

## 48. Source Separation Runtime

模型为 `speechbrain/sepformer-whamr16k`，revision `21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5`，Snapshot Hash `9bd6e618ffe019ffe87c868b0aa9057aac25fb7df6b89d02f328286fb6fe48c5`，Runtime Identity Hash `5ba41832cf28670c8951a10ce01174dbb018cb1e6d6b95268eed4b394e179d0f`。

## 49. Source Separation 域警告

SepFormer 模型训练语言/域为 English WHAMR，而目标是日语电视对白，`domainMatched: false`。该跨域事实在 Artifact 中显式告警，不能被省略或伪装为日语专用模型。

## 50. Source Separation 质量结果

4 个触发 Component 全部因 `SEPARATION_RECONSTRUCTION_ERROR_HIGH` 标记为 `unreliable`，没有一个成为 timing actionable。系统没有为了获得候选而忽略重建误差。

## 51. Separated-stream CTC

Fresh 对分离流执行 18 个局部 CTC attempt，真实 inference 18；这些结果只用于诊断与交叉检查。它们没有修改文本或时间，Shareable 中也不包含 raw separated WAV。

## 52. Component 1

`overlap-acoustic-5475b241d7d856b45194`：2 个 cue，完整稳定边界 1；joint assignment 因新增非法 overlap 拒绝；separation 已触发但不可靠；timing mutation 0，Review 保留。

## 53. Component 2

`overlap-acoustic-5e6df4ca8c77b3a51802`：2 个 cue，完整稳定边界 1；是唯一 joint assignment resolved Component，但仍缺少 side-specific 独立 lexical support 且 Speaker 证据矛盾；timing mutation 0，Review 保留。

## 54. Component 3

`overlap-acoustic-69e8f46141f7d9276a87`：3 个 cue，完整稳定边界 1；joint assignment 非单调并引入非法 overlap；timing mutation 0，Review 保留。

## 55. Component 4

`overlap-acoustic-8ff7342e69430b941161`：3 个 cue，完整稳定边界 1，其中 2 个 cue target 不可表示；joint candidate 缺失且非单调；separation 不可靠；timing mutation 0，Review 保留。

## 56. Component 5

`overlap-acoustic-de9815d25ae4c3a8e718`：2 个 cue，两个完整边界均稳定，也是唯一 Speaker Relationship resolved Component；joint 候选会删除合法 overlap，故 timing mutation 0，Review 保留。

## 57. Component 6

`overlap-acoustic-def4f9e5f20a6a24af59`：2 个 cue，完整稳定边界 0，并存在 1 个 duplicate occurrence conflict；joint 候选还会引入非法 overlap；separation 不可靠；timing mutation 0，Review 保留。

## 58. Component 7

`overlap-acoustic-eef08480bdcbc8f48776`：2 个 cue，完整稳定边界 1，另有 1 个窗口边缘 pinned attempt；joint assignment 非单调并引入非法 overlap；separation 不可靠；timing mutation 0，Review 保留。

## 59. 七个 Component 汇总

| 指标                              | 真实结果 |
| --------------------------------- | -------: |
| Target Component / cue            |   7 / 16 |
| 完整边界稳定 cue                  |        7 |
| Joint assignment resolved         |        1 |
| Timing actionable cue / Component |    0 / 0 |
| Timing mutation cue / Component   |    0 / 0 |
| Speaker Relationship resolved     |        1 |
| Subtitle overlap resolved         |        0 |
| Review Item                       |    7 → 7 |

## 60. Canonical 与 Presentation 不变性

- Canonical/output cue hash：`8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`
- Timing hash：`510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`
- Presentation cue hash：`9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`

## 61. Fresh 完整计数

Fresh 的直接 CTC 为 32 inference；separation 为 4 inference；separated-stream CTC 为 18 inference。CTC cache manifest 合计 50 request、0 hit、50 miss、50 write、50 inference、1 次 CTC model load。

## 62. Observe 完整计数

Observe 对相同 50 个 CTC 请求全部只读命中：50/50 hit、0 inference、0 model load；4 个 separation 请求也为 4/4 hit、0 inference、0 model load。Observe 没有 timing mutation。

## 63. Cache Replay 完整计数

Cache Replay 同样为 CTC 50/50 hit、0 inference、0 model load；separation 4/4 hit、0 inference、0 model load。它没有启动真实模型 worker，且输出语义与 Fresh 一致。

## 64. Fresh / Observe / Cache 语义一致性

三套共同哈希：alignment input `6aa39e6e2df697d3209f690f92353878a6407fd20b67bca823b89891ba09cd55`；CTC evidence `a671c2f13e178a97d77b92c32915101086fca92d83afaa8dde4f374912fa3ae4`；joint assignment `f3ea4cb6b71ab2478b46cfb6c138b37010b324332fc9c0b3994a5135170ce3f5`；separation `3ed9cca6086a8519063f842d7c6e4a90c7c462811a9cc5b9709105657efbf9fe`；component decision `df475b90d2d3bdbb5495ee07f25d713f4995566a81b76be4e68425e958999499`；mutation `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。

## 65. Review Delivery

Fresh / Observe / Cache 的 Review Delivery Integrity 均 passed，7 个 item 的音频均为 physical、referenced、playable，broken reference 为 0。`deliveryVersion: C5.17.2` 仅表示复用已验证的 Review Delivery 子系统合同，不代表 C5.18.1 CTC Evidence 版本。

## 66. Shareable Audit

三套 Shareable 均通过 30 个 Artifact 验证；absolute path leak 0、secret 0、broken relative reference 0。CTC capability、证据、cache manifest、finalization 与 Review 资料均以相对引用交付，原始模型、缓存音频和分离 WAV 不进入 Shareable。

## 67. 输入只读与兼容性

三套 replay 均记录 source/human subtitle read-only verified。Skill 2 compatibility 生成 106 sentence 与 106 grammar point；Skill 3 typecheck、1 个测试和 build 通过；两个兼容仓库前后 HEAD 与 clean 状态不变。

## 68. 自动化测试与 Schema

最终代码验收通过：Schema 生成 108 个；typecheck、lint、format、build 均 passed；unit 484 passed、2 skipped；E2E 26 passed、1 skipped；C5.18.1 targeted 65 passed；Python worker AST syntax passed。跳过项为显式 opt-in 的外部真实 runtime/fixture 路径，不被写成已执行。

## 69. 最终输出目录

- Fresh：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-1-local-ctc-boundary-fresh-v4-20260827`
- Observe：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-1-local-ctc-boundary-observe-v4-20260827`
- Cache Replay：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-1-local-ctc-boundary-cache-replay-v4-20260827`

v4 是本报告的唯一权威验收集；此前 v2/v3 只属于实现过程中的中间运行，不作为最终验收依据。

## 70. 最终结论与下一阶段边界

**C5.18.1 real-model acceptance passed**：真实模型、固定 Snapshot、CPU 安全回退、局部 CTC、缓存复放、跨运行 parity、Review Delivery、Shareable Audit、Schema 和测试均通过。最终字幕仍为 `needs-review` / `none`，7 个 Review Item 全部保留，Canonical 文本/时间修改均为 0。

C5.19 可以在不篡改这 7 个 unresolved Component 的前提下开始独立、受约束的下一阶段调查；当前证据不支持直接进入 C6.0，也不支持宣称字幕自动终稿完成。
