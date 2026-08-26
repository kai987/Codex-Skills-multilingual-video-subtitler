# C5.18 Local Speaker Activity Evidence 真实模型验收报告

结论：**C5.18 real-model acceptance passed**。本结论只表示本地 Community-1 Speaker Evidence 运行时、真实 Fresh、Observe、Cache Replay、跨运行语义一致性、Review Delivery 和 Shareable Audit 已通过验收；最终字幕仍为 `needs-review`，`finalizationMethod: none`，7 个 Review Item 均保留。Speaker Relationship 解析成功 1 个 Component，但字幕 overlap 自动解决仍为 0 个，二者不得混同。

本次验收收尾只读取已经生成的真实 Artifact，并在临时副本上重新执行跨运行与 Schema 验证；**没有重新运行 pyannote，没有修改 Speaker 算法，没有修改 Canonical 文本或时间，也没有修改 Skill 2/3**。

## 1. 分支与实现历史

- 仓库：`https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- 当前分支：`codex/c5-18-local-speaker-activity-evidence`
- C5.17.2 基线：`0a468a1d7e786f5309e128d59dc20276bc235439`
- Phase 0：`d8c6390a6bb74661d610f608613845dc06c03877`，`fix: enforce review action semantics`
- Phase 1：`0fafc5b4d83b89e0c864b1849c3be78b6a606c8f`，`feat: add C5.18 local speaker activity evidence`
- 初始开发报告：`316c963b8bb6dc7e7ff823f1db5f5e7a1fa09b3d`，`docs: record C5.18 development outcome`

### 授权阻塞历史

初始验收时，`pyannote/speaker-diarization-community-1` 是 gated 模型，本机进程没有 `HF_TOKEN`，因此当时按设计 fail closed，结论为 `blocked-model-authorization`。该历史事实保留，不回写成“从未阻塞”。

随后用户完成模型条款授权并提供 read-capable token，模型 Snapshot 和 Runtime 被真实准备，Fresh / Observe / Cache Replay 三次真实运行完成。Artifact 证明 token 未被存储，准备阶段使用网络，推理阶段未使用网络。旧的 `blocked-model-authorization` 只描述最初状态，不再是 C5.18 的最终验收结论。

## 2. 真实输出目录

- Fresh：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-local-speaker-evidence-fresh-20260826`
- Observe：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-local-speaker-evidence-observe-20260826`
- Cache Replay：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-local-speaker-evidence-cache-replay-20260826`

主要验收 Artifact：

- `c5-18-speaker-evidence-replay-summary.json`
- `c5-18-fresh-cache-observe-validation.json`
- `subtitle-local-speaker-evidence.json`
- `speaker-evidence-runtime-capability.json`
- `speaker-evidence-cache-manifest.json`
- `subtitle-review-delivery-integrity.json`
- `subtitle-finalization-report.json`
- `shareable/shareable-artifact-manifest.json`

## 3. Runtime 与模型 Snapshot Identity

| 字段                        | 真实值                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Backend                     | `pyannote-community-1`                                             |
| Model repo                  | `pyannote/speaker-diarization-community-1`                         |
| Model revision              | `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`                         |
| Model Snapshot Hash         | `05e910b0a8e5ae578fab80258d5705c3886243306a54c39daa70785bd0842c03` |
| Runtime ID                  | `c518-9895ab91d9a22820`                                            |
| Runtime Identity Hash       | `3c188505fcc51dfd8b10b07de9dcafc93b5668201be1d95676a6c458c1118976` |
| Explicit freeze SHA-256     | `26443a1a887c77837cd1fe0a039300ebd1cbd12e0859d2ce1193f0decbc30668` |
| Direct requirements SHA-256 | `3c7b6d6a0c404e61cb714a964e1bd0387904c8aea78a558307c28cc3943ce36c` |
| Python                      | `3.13.14`                                                          |
| pyannote.audio              | `4.0.7`                                                            |
| torch / torchaudio          | `2.11.0` / `2.11.0`                                                |
| huggingface-hub             | `1.28.0`                                                           |
| numpy / scipy / soundfile   | `2.5.2` / `1.18.1` / `0.14.0`                                      |
| Device requested / used     | `auto` / `mps`                                                     |
| Device fallback             | 未发生                                                             |

依赖子 Snapshot：

- `embedding`：`118a893f507c72473aac89a47bcc10bcaeb5bca5e77456c7aca05d830a9dfa93`
- `plda`：`b5f79b609c47800c260bf735cd9b16f483dc27b553fc935ce754457dc98ee817`
- `segmentation`：`9549e899958c74fd2caf41c54aeabac12f2fbcfa0faa9c4bd50caace175ae054`

真实 capability：Standard diarization、Exclusive diarization 和 overlap track 均可用；所有 pipeline module 均在 MPS device，有限输出检查通过。`confidenceStatus: unavailable`，没有伪造 segmentation/speaker confidence。`mpsCpuSemanticComparable` 为 `null`，因此本报告不声称完成了 MPS/CPU 双设备一致性比较；这不影响本次已执行 MPS 真实运行的验收。

安全状态：`networkUsedDuringPreparation: true`、`networkUsedDuringInference: false`、`hfTokenStored: false`、raw speaker embedding 未持久化。

## 4. Fresh / Observe / Cache Replay 实际执行

| Run          | Run ID                                       | Mode / Cache             | Pipeline inference | Model load | Cache hit | 结果                            |
| ------------ | -------------------------------------------- | ------------------------ | -----------------: | ---------: | --------: | ------------------------------- |
| Fresh        | `c5-18-21472771-6bc1-4f52-acc4-d78cd8fd21b1` | `enforce` / `read-write` |                 14 |          1 |      0/14 | 14 miss、14 write，真实推理完成 |
| Observe      | `c5-18-abf27a83-f026-4024-96ca-0dcfc31a55c8` | `observe` / `read`       |                  0 |          0 |     14/14 | 只读复用，timing mutation 0     |
| Cache Replay | `c5-18-5f8477bc-d458-43ea-8595-0336019e6f51` | `enforce` / `read`       |                  0 |          0 |     14/14 | 未启动 worker 推理，未加载模型  |

三次运行均为 7 个 Component、16 个 cue、双窗口合计 14 个请求；whole-media Speaker inference、whole-media ASR、Whisper、MFA、OpenAI 和在线字幕请求均为 0。

## 5. Fresh / Observe / Cache 语义一致性

`c5-18-fresh-cache-observe-validation.json` 的 `validationPassed` 为 `true`。三套 Artifact 的以下哈希完全一致：

| 哈希                          | Fresh / Observe / Cache 共同值                                     |
| ----------------------------- | ------------------------------------------------------------------ |
| `speakerEvidenceSemanticHash` | `464615acdb85c0e1089986ab777d263426ee876f7dadeaa01868a295c26c9ccf` |
| `componentDecisionHash`       | `2181a04046b5da3f69578f81eee38d8530697358474265dbf833aa451b19de67` |
| `mutationHash`                | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| `outputCueHash`               | `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83` |

Parity 结果：`speakerEvidenceSemanticParity: true`、`componentDecisionParity: true`、`mutationParity: true`、`outputCueParity: true`。

## 6. Canonical、Timing 与 Presentation Hash

- Canonical cue / text hash：`8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`
- Canonical timing hash：`510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`
- Presentation cue hash：`9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`
- C5.17.2 presentation artifact 基线 hash：`7ba2058662d21b3de386d5ec0085636f108ee3a8bf0902affdd96d299308efbf`

三次 C5.18 `subtitle-presentation-resolution.json` 文件 hash 分别为：

- Fresh：`54ef3d6a1df1e5655f4d7c5bd514ca301b0f712970ec11bd13125a59b68a434f`
- Observe：`65c90039b9b7a9b4f5ccbcf99cf2e53537da6875be1c459f7bba42484c701646`
- Cache Replay：`823e9a2baccee0a46d7771a92031e8384bfc59708cbd1adc35df06527040fe07`

文件 hash 包含 run-specific `generatedAt`/运行元数据，因此不要求三者相同；真正的 presentation cue identity 在三套 Artifact 中均为 `9e137...`。三套摘要均为 192 canonical cue、192 presentation cue、21 个 layout resolution、5 个 repetition resolution、0 个 overlap resolution、0 个 timing mutation、0 个 canonical text/timing mutation、0 个 presentation-created temporal cue。

## 7. 七个 Component 的真实 Speaker 结果

| Review ID                     | Component / 时间                                        | Context → Union speaker | Speaker Relationship        | Speaker 状态                                                          | 字幕结果                                           |
| ----------------------------- | ------------------------------------------------------- | ----------------------: | --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| `review-292cf969a432fbddbffc` | `overlap-acoustic-def4f9e5f20a6a24af59` / 59.14–60.88   |                   2 → 2 | `speaker-evidence-conflict` | unresolved；activity IoU 低                                           | overlap 未解决，保留 Review                        |
| `review-4edc6c32f76083bd2a55` | `overlap-acoustic-5e6df4ca8c77b3a51802` / 402.05–410.37 |                   1 → 0 | `speaker-evidence-conflict` | unresolved；speaker count/mapping 不稳定                              | overlap 未解决，保留 Review                        |
| `review-525458408b2864f2fff2` | `overlap-acoustic-de9815d25ae4c3a8e718` / 436.04–440.85 |                   1 → 1 | `single-speaker-only`       | **relationship resolved**；双 cue assignment 为 stable single speaker | timing 不可安全执行，overlap 仍未解决，保留 Review |
| `review-0646501fe49b1b5d0a31` | `overlap-acoustic-8ff7342e69430b941161` / 688.31–695.61 |                   2 → 2 | `speaker-evidence-conflict` | unresolved；overlap interval 不稳定                                   | overlap 未解决，保留 Review                        |
| `review-ca4841c6308c7e927da6` | `overlap-acoustic-5475b241d7d856b45194` / 701.46–705.34 |                   2 → 1 | `speaker-evidence-conflict` | unresolved；speaker count/mapping 不稳定                              | overlap 未解决，保留 Review                        |
| `review-5c6637656cf727da89f1` | `overlap-acoustic-eef08480bdcbc8f48776` / 772.51–777.21 |                   2 → 1 | `speaker-evidence-conflict` | unresolved；speaker count/mapping 不稳定                              | overlap 未解决，保留 Review                        |
| `review-cf2efc651b4b47143dde` | `overlap-acoustic-69e8f46141f7d9276a87` / 808.53–811.86 |                   1 → 1 | `speaker-evidence-conflict` | unresolved；activity IoU 低                                           | overlap 未解决，保留 Review                        |

汇总：

- Speaker stable Component：1/7
- Speaker Relationship resolved：1/7
- Speaker unresolved Component：6/7
- Subtitle overlap resolved：0/7
- Subtitle overlap unresolved：7/7
- Speaker timing proposal eligible/applied：0/0
- Canonical text mutation：0
- Canonical timing mutation：0
- Review Item：7 → 7

`single-speaker-only` 只解决“该局部 Component 的说话人关系是什么”，不提供稳定 change point，也不满足字幕边界安全门禁，因此不能降低 Review 数量或声称字幕 overlap 已解决。

## 8. Review Action 与 Review Delivery

Review Action 使用 `c5.18-review-action-semantics-v1`：7 个 item、56 个 action 组合全部验证通过，invalid action、shortcut bypass、无候选 shortcut resolution、无效 Resolution 下载均为 0；7 个未解决 item 的下载继续 fail closed。

Review Delivery 结果：

- `deliveryVersion: C5.17.2`
- Item：7/7 passed
- Review Audio：7 个 physical、7 个 referenced、7/7 playable
- 复用既有 Review Audio：7；重新生成：0
- Audio hash mismatch：0
- Audio coverage / metadata failure：0 / 0
- Root/review-data、audio、evidence relative reference 均可解析；broken relative reference：0
- `reviewDeliveryIntegrityPassed: true`

这里的 `deliveryVersion: C5.17.2` 表示复用已验证的 **C5.17.2 Review Delivery 子系统合同**，不代表 C5.18 Speaker Evidence 的版本。C5.18 Speaker runtime、evidence、replay 和 validation Artifact 均使用 C5.18 自己的版本。已验证的数据合同没有因文档收尾而无必要修改。

## 9. Shareable Audit 与隐私

Fresh / Observe / Cache 三套 Shareable Audit 均为：

- Artifact validation：23/23 passed
- Absolute path leak：0
- Prohibited secret：0
- Broken relative reference：0
- Path replacement：0
- Secret redaction：0
- Audio、raw embedding、token、runtime/model cache path 均未进入 Shareable

Runtime Artifact 同时确认 `hfTokenStored: false`，真实推理阶段 `networkUsedDuringInference: false`。

## 10. Finalization 状态边界

- Final cue count：192
- Final status：`needs-review`
- Finalization method：`none`
- Review Item：7
- Safe automatic mutation：0
- Canonical text mutation：0
- Canonical timing mutation：0
- Subtitle overlap resolved：0
- Unresolved subtitle overlap：7
- Review Delivery Integrity：passed

C5.18 real-model acceptance passed 与 Subtitle finalization passed 是不同结论。本次通过的是模型运行、证据生成、缓存复放、跨运行一致性和交付完整性验收；字幕仍按保守门禁保留人工复核，不通过放宽阈值制造“自动解决”。

## 11. 本次离线验收命令与结果

本次收尾没有运行 `prepare:speaker-runtime`、`verify:c5-18-speaker-runtime` 或 `replay:c5-18-speaker-evidence`，因此没有触发 pyannote。已执行：

| 命令                                                                          | 结果                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run generate:schemas`                                                    | passed；生成 99 个 JSON Schema，仓库无生成差异                            |
| `npm run validate:c5-18-runs -- --fresh ... --observe ... --cache-replay ...` | passed；在三套真实 Artifact 的临时只读副本上验证，三套 Shareable 各 23/23 |
| `npm run typecheck`                                                           | passed                                                                    |
| `npm run lint`                                                                | passed                                                                    |
| `npm run format:check`                                                        | passed                                                                    |
| `npm run build`                                                               | passed                                                                    |
| `npm test`                                                                    | 29 files passed；419 passed、2 skipped、421 total                         |
| `npm run test:e2e`                                                            | 8 files passed；25 passed、1 skipped、26 total                            |

跳过项是显式 opt-in 的外部真实 runtime/fixture 集成路径。本次遵守“不重新运行 pyannote”的验收边界，真实模型结论来自本节之前列出的既有 Fresh / Observe / Cache Artifact，而不是 mock 测试。

## 12. 输入与兼容性

- 三套 replay summary 均为 `sourceTaskCriticalArtifactsReadOnly: true`、`sourceVideoReadOnly: true`、`humanSubtitleReadOnly: true`。
- Skill 2 compatibility：passed。
- Skill 3 compatibility：passed。
- 本次仅更新本报告，没有修改 Skill 2/3。

## 13. 最终验收结论

**C5.18 real-model acceptance passed。**

通过依据：

1. 真实 Community-1 Snapshot、Runtime Identity 和 MPS device 均已验证。
2. Fresh 完成 14 次真实 inference；Observe inference 为 0；Cache Replay 14/14 hit、0 inference、0 model load。
3. Fresh / Observe / Cache 的 Speaker semantic、Component decision、Mutation 和 Output cue identity 完全一致。
4. Canonical 文本和时间均无修改。
5. 7 个 Component 的真实 Speaker 结果完整落盘；1 个 Speaker Relationship resolved，但 0 个 subtitle overlap resolved。
6. Review Item 仍为 7，最终状态保持 `needs-review` / `none`。
7. Review Delivery 7/7 playable 且 integrity passed。
8. 三套 Shareable Audit 均为 23/23，路径、secret 和相对引用检查通过。
9. Schema、typecheck、lint、format、build、unit 和 E2E 均通过。

最初的授权阻塞已经被后续真实授权与真实运行解除；它作为历史记录保留，但不再阻止 C5.18 真实模型验收完成。
