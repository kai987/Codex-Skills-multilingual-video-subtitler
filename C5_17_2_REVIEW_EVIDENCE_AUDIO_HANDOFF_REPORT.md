# C5.17.2 — Review Evidence Reconciliation & Audio Handoff

本报告记录 C5.17.2「审核证据校准、音频交付与跨产物一致性修复」的真实源码修改、C5.17.1 基线复现、两次离线回放、审计、回归和只读兼容验证。所有验收数字均来自本地 Artifact、物理文件或命令输出；未重新运行 MFA、Whisper、Sudachi、G2P 或整集 ASR，也未调用 FFmpeg、OpenAI 或在线字幕搜索。

## 1. 开发分支和基线 commit

- 仓库：`https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- 基线分支：`codex/c5-17-1-mfa-runtime-alignment-semantics`
- 基线 commit：`47e31709e86bd76d0e0d4424223440210eb0ff2d`
- 开发分支：`codex/c5-17-2-review-evidence-audio-handoff`
- `git merge-base HEAD 47e31709...`：`47e31709e86bd76d0e0d4424223440210eb0ff2d`
- 未基于 `main` 开发，未修改或重写 C5.17.1 分支。

## 2. C5.17.1 三个 Review 交付问题

直接读取 C5.17.1 Fresh 的真实 Review Package、Review/Overlap WAV、Forced Alignment、Overlap Acoustic 和 Timestamp Integrity Artifact 后复现：

| 问题                          | C5.17.1 真实结果                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| WAV 存在但 Package 不引用     | 物理 Review WAV `7`，`audioClipCount=0`，`audioFailureCount=7`，`audioCoverageFailureCount=7`                                      |
| Mapped Token 复制 Evidence-DP | 16 个 Cue projection 中，`evidenceDpBoundary != null` 为 11，`mappedTokenBoundary != null` 为 11，逐值相同且无独立 lineage 为 `11` |
| Raw VAD 未交付                | 16 个 Cue projection 的 `rawVadBoundary` 全为 `null`；Review Package 没有 Component Raw VAD 数组                                   |

旧 Finalization Report 的 `reviewAudioCoverageFailureCount=7`，最终状态为 `needs-review`，`finalizationMethod=none`。

## 3. 物理 WAV 与 Package 不一致的根因

C5.17.1 回放先用递归 `cp(sourceTask, outputTask, { preserveTimestamps: true })` 复制父任务，因此 `audio/review/*.wav` 和 `audio/overlap/*.wav` 被继承到 Fresh 目录。随后 Review Builder 收到 `generateAudio=false`；C5.17.1 回放 CLI 中该值来自 `!values["no-review-audio"]`，实际 Package 明确进入了 false 分支。旧实现只有“调用 FFmpeg 新生成”或直接写入 `AUDIO_GENERATION_NOT_REQUESTED` 两条路径，不会发现、验证或复用已经存在的 WAV。

因此：这 7 个 Review WAV 不是 C5.17.1 强制对齐阶段新生成的；它们是随来源任务递归继承的已有文件。旧 `c5-17-forced-alignment-replay-summary.json` 没有持久化 `--no-review-audio` 参数本身，但 Package 的 7 个 `AUDIO_GENERATION_NOT_REQUESTED` 和基线源码的唯一 false 分支可以确定 `generateAudio=false`。

旧页面仅把非空 `audioClipPath` 直接放入 `<audio src>`，相对基准是 `review/index.html`；字段为 `null` 时只渲染错误文本，所以物理文件虽然存在，页面仍是 0/7 可播放。

## 4. 7 个 Review WAV 的原路径、大小和 SHA

共同原目录：

`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-fresh-20260826/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/audio/review`

| Review WAV                        |    字节 | SHA-256                                                            |
| --------------------------------- | ------: | ------------------------------------------------------------------ |
| `review-292cf969a432fbddbffc.wav` | 151,752 | `59be766eb77e88b9949e7eef58af09ae56fd69b3e37456a4b5999b3aec3cfbc1` |
| `review-4edc6c32f76083bd2a55.wav` | 362,328 | `c4cb270e82ef79573e09833a45da460ad2c9335e8e5506f544bf26fdd738d46b` |
| `review-525458408b2864f2fff2.wav` | 250,036 | `c3a1f75ce614e67b2fbeba65fc713b0299f1681a9c64c05e9ba2dfd4d155fe28` |
| `review-0646501fe49b1b5d0a31.wav` | 329,710 | `f600564e7a9e3f82083a1a12d80f00ec58876e1fae069ff4fc9e2435f31969be` |
| `review-ca4841c6308c7e927da6.wav` | 220,228 | `e4ee96d94408bce9d35a88dc010e77f982ec0f3999890e8c362b3f62ac48ff65` |
| `review-5c6637656cf727da89f1.wav` | 246,478 | `c16d32ae84d73a67bd3f03e103fb3bd594c73122d1e7a5efb6e387b737752640` |
| `review-cf2efc651b4b47143dde.wav` | 202,616 | `641fd265e3db437030efdeb4011085cdab67f9426a308c02377576fb671c87b2` |

## 5. 对应 Overlap WAV 的大小和 SHA

共同原目录与 Review WAV 相同任务下的 `audio/overlap`：

| Component / Overlap WAV                     |    字节 | SHA-256                                                            |
| ------------------------------------------- | ------: | ------------------------------------------------------------------ |
| `overlap-acoustic-def4f9e5f20a6a24af59.wav` | 151,752 | `59be766eb77e88b9949e7eef58af09ae56fd69b3e37456a4b5999b3aec3cfbc1` |
| `overlap-acoustic-5e6df4ca8c77b3a51802.wav` | 362,328 | `c4cb270e82ef79573e09833a45da460ad2c9335e8e5506f544bf26fdd738d46b` |
| `overlap-acoustic-de9815d25ae4c3a8e718.wav` | 250,036 | `c3a1f75ce614e67b2fbeba65fc713b0299f1681a9c64c05e9ba2dfd4d155fe28` |
| `overlap-acoustic-8ff7342e69430b941161.wav` | 329,710 | `f600564e7a9e3f82083a1a12d80f00ec58876e1fae069ff4fc9e2435f31969be` |
| `overlap-acoustic-5475b241d7d856b45194.wav` | 220,228 | `e4ee96d94408bce9d35a88dc010e77f982ec0f3999890e8c362b3f62ac48ff65` |
| `overlap-acoustic-eef08480bdcbc8f48776.wav` | 246,478 | `c16d32ae84d73a67bd3f03e103fb3bd594c73122d1e7a5efb6e387b737752640` |
| `overlap-acoustic-69e8f46141f7d9276a87.wav` | 202,616 | `641fd265e3db437030efdeb4011085cdab67f9426a308c02377576fb671c87b2` |

## 6. Review/Overlap WAV 匹配结果

7/7 Review WAV 与同一 Component 的 Overlap WAV 在字节数和 SHA-256 上完全一致；C5.17.2 目标 Review WAV 与两者也一致。匹配不是按文件名猜测，而是先通过 `subtitle-overlap-acoustic-resolution.json` 的 `componentId`、`audioPath`、Hash、提取区间、Component union 和 lineage 建立关系，再验证物理 WAV。

| Review ID                     | Component ID                            | 提取窗口        | Component union | SHA/大小匹配 | Coverage |
| ----------------------------- | --------------------------------------- | --------------- | --------------- | ------------ | -------- |
| `review-292cf969a432fbddbffc` | `overlap-acoustic-def4f9e5f20a6a24af59` | 57.640–62.380   | 59.140–60.880   | true         | true     |
| `review-4edc6c32f76083bd2a55` | `overlap-acoustic-5e6df4ca8c77b3a51802` | 400.550–411.870 | 402.050–410.370 | true         | true     |
| `review-525458408b2864f2fff2` | `overlap-acoustic-de9815d25ae4c3a8e718` | 434.540–442.350 | 436.040–440.850 | true         | true     |
| `review-0646501fe49b1b5d0a31` | `overlap-acoustic-8ff7342e69430b941161` | 686.810–697.110 | 688.310–695.610 | true         | true     |
| `review-ca4841c6308c7e927da6` | `overlap-acoustic-5475b241d7d856b45194` | 699.960–706.840 | 701.460–705.340 | true         | true     |
| `review-5c6637656cf727da89f1` | `overlap-acoustic-eef08480bdcbc8f48776` | 771.010–778.710 | 772.510–777.210 | true         | true     |
| `review-cf2efc651b4b47143dde` | `overlap-acoustic-69e8f46141f7d9276a87` | 807.030–813.360 | 808.530–811.860 | true         | true     |

## 7. Audio Source Resolver

新增集中模块 `packages/video-subtitler/src/review-audio.ts`，实现：

- `auto | generate | reuse-only | off` 四种模式；
- RIFF chunk 级 WAV 解析与 PCM 16 kHz/mono/16-bit 校验；
- 现有 Review、来源 Review、Artifact 指定 Overlap、源视频生成的集中选择；
- SHA、实际帧数时长、Component coverage、来源 Artifact/Component/lineage 的完整 provenance；
- 临时文件到原子 rename，硬链接失败安全回退 copy；
- 拒绝绝对符号链接和任务外路径；
- `off` 使用明确的 `AUDIO_DISABLED_BY_USER`，不再使用含义模糊的 `AUDIO_GENERATION_NOT_REQUESTED`。

## 8. Audio Source 优先级

实际实现的确定性顺序：目标输出中已验证 Review WAV → 来源任务中已验证 Review WAV → 由 Overlap Artifact 明确绑定的目标/来源 Overlap WAV → 仅 `auto/generate` 允许的 FFmpeg 生成。`generate` 强制重新提取；`reuse-only` 在没有可验证来源时 fail closed；`off` 完全禁用。

真实验收使用 `reuse-only`。结果为：`inherited-verified-review-audio=7`、`reused-overlap-audio=0`、`generated-from-source-video=0`。每个来源 Review WAV 又通过对应 Overlap Artifact 的相同 SHA 和 Component provenance 获得验证。

## 9. WAV Metadata 验证

验证方法为代码直接读取 RIFF/WAVE `fmt ` 与 `data` chunk，不仅信任 JSON duration。7 个 WAV 均为 PCM signed 16-bit little-endian、16,000 Hz、单声道。

| Review ID |  Frames | 实际时长（秒） | Rate/Channels/Bits | 状态      |
| --------- | ------: | -------------: | ------------------ | --------- |
| `292c...` |  75,837 |      4.7398125 | 16000 / 1 / 16     | validated |
| `4edc...` | 181,125 |     11.3203125 | 16000 / 1 / 16     | validated |
| `5254...` | 124,979 |      7.8111875 | 16000 / 1 / 16     | validated |
| `0646...` | 164,816 |     10.3010000 | 16000 / 1 / 16     | validated |
| `ca48...` | 110,075 |      6.8796875 | 16000 / 1 / 16     | validated |
| `5c66...` | 123,200 |      7.7000000 | 16000 / 1 / 16     | validated |
| `cf2e...` | 101,269 |      6.3293125 | 16000 / 1 / 16     | validated |

`reviewAudioMetadataFailureCount=0`。

## 10. Audio Coverage 验证

每个 WAV 的 `audioExtractedInterval.start <= componentUnion.start` 且 `audioExtractedInterval.end >= componentUnion.end`，按 1 ms 容差验证。7 个项目实际前后 context 都是 1.5 秒；未假设二者必须相等，而是分别持久化 `audioContextBeforeSeconds` 和 `audioContextAfterSeconds`。

结果：7/7 完整覆盖，`reviewAudioCoverageFailureCount=0`，Finalization Report 的同名指标也是 0。

## 11. Audio Handoff 策略

C5.17.2 创建全新 collision-safe 目录，删除复制过来的目标 `audio/review` 后再执行真正 handoff。7 个来源 WAV 经过验证后原子复制到新任务的 `subtitle-.../audio/review/`，`audioHandoffMethod=copy`。未使用跨任务绝对符号链接；实现支持同文件系统 hardlink，并在失败时回退 copy，但本次真实交付明确记录为 copy。来源任务和输入媒体保持只读。

## 12. Review Version 升级

新版本：`review-v2-caef76fd551e9c690a9eb720`。

身份输入增加 Audio SHA、source、提取区间、coverage、validation status、Evidence Reconciliation Hash 和 Delivery Integrity Policy Version。音频或证据变化会改变 Review Version，因此引用旧 C5.17.1 Review Version 的 Human Resolutions 会被 stale-review 校验拒绝，不会静默迁移。

## 13. Evidence Lineage Reconciliation

新增 `packages/video-subtitler/src/review-evidence.ts`。它同时读取并验证：

- `subtitle-canonical-forced-alignment.json`；
- `subtitle-overlap-acoustic-resolution.json`；
- `subtitle-timestamp-evidence-integrity.json`；
- `subtitle-presentation-resolution.json`；
- `subtitle-canonical-pronunciation.json`。

统一的严格 `ReviewBoundaryEvidence` 保存 evidence ID、lineage ID、source type、cue/pair/component scope、Cue/Component 身份、interval、side support、timing usability、信任与对齐分数、neighbor intrusion、profile/attempt/parent segment、来源 Artifact 类型/Hash/Object ID、blocker 和 notes。7/7 Review Item 的 `evidenceSourceResolutionStatus=resolved`，Reconciliation Hash 为 `b77a6cd6e1ef059d2611b9ce4c7aa7d3daeaa04870dfaa629bfcd5d950533e39`。

## 14. mappedTokenBoundary 修复

旧代码直接把 `canonical.evidenceDp.startBoundary/endBoundary` 同时写入 `evidenceDpBoundary` 和 `mappedTokenBoundary`，导致 11 个复制错误。

新实现仅从 Overlap Artifact 中 `timingUsable=true`、可信 timestamp status、具备 evidence ID/lineage ID 且通过 containment 的 `trusted-mapped-token` 或 `trusted-no-vad-token` matched interval 建立代表区间。排序依次考虑 timing trust、alignment、profile consensus、boundary confidence、较低 neighbor intrusion、source support count 和稳定 evidence ID；先按 lineage 去重，不按 attempt ID 决胜。

真实结果：可信 Mapped Token lineage `12`（8 mapped-token + 4 no-VAD token），legacy `mappedTokenBoundary` 非空 `8`，`mappedTokenBoundaryCopiedFromEvidenceDpCount: 11 → 0`。数值偶然相同只有在独立 lineage 下才允许。

## 15. Raw VAD Component Evidence

真实 Raw VAD 位于 Overlap Artifact 的 `attempts[].rawVadIntervals`，其健康/规范化语义由 Timestamp Integrity 的 `attempts[].rawVadEvaluations` 提供。新 Package 将通过健康门的 Raw VAD 作为 `scope=component` 的 `componentRawVadIntervals[]` 交付，保留 raw/normalized interval、health、trust、normalization delta、profile、attempt 和 lineage。

真实唯一 Raw VAD lineage 数为 `30`。由于上游没有把这些 Component speech islands 明确归属给某一 Cue 的 start/end，16 个 legacy `rawVadBoundary` 仍合法保持 `null`；这是防止伪造 Cue-specific 边界的预期结果，不是证据丢失。

## 16. Decoded Segment Evidence

Decoded Segment 来自 Overlap Attempt 的 `decodedSegmentIntervals`/`segments` 和 matched interval lineage，类型固定为 `decoded-segment`，不会映射为 Raw VAD。真实唯一 lineage 为 `68`，`decodedSegmentMislabelledAsRawVadCount=0`。页面同时呈现 Cue-specific decoded track 和 Component acoustic track，并保留 attempt/profile/parent segment 身份。

## 17. Source Cue Prior 语义

人工基线原时间以 `source-cue-prior` 保存，`scope=cue`、`acousticEvidence=false`。它用于显示当前人工时间和比较候选，不计入独立声学支持，不授权文本或时间修改。16 个目标 Cue 都有一个 source-cue-prior lineage。

## 18. Legacy Projection 规则

保留 `mfaNarrowBoundary`、`mfaExpandedBoundary`、`evidenceDpBoundary`、`mappedTokenBoundary` 和 `rawVadBoundary` 以兼容旧消费者，但它们只是新结构的确定性 projection：

- Evidence-DP 只投影 Evidence-DP；
- Mapped Token 只投影受信 token lineage；
- Raw VAD 只有上游明确 Cue-side 归属时才投影，否则为 `null`；
- Decoded Segment 永不投影为 Raw VAD；
- Source Cue Prior 不投影为声学证据。

旧 C5.17.1 Package 和 Finalization Report 仍可由 optional/default 字段解析。

## 19. Review Page Timeline

本地静态页面升级为 CSP 约束下的本地 HTML/CSS/JS，不使用 CDN、远程脚本、远程字体或服务端。Timeline 显示 Human Original、MFA Narrow、MFA Expanded、Forced Alignment Selected、Evidence-DP、Mapped Token、Decoded Segment、Raw VAD、Component Union 和 Audio Extraction Window；每条 track 展示来源、interval、trust/usable、blocker 和 evidence ID。

Cue Evidence 和 Component Acoustic Evidence 分区显示，并明确展示 Audio source/SHA/coverage/validation、Evidence resolution status、Mapped Token 可用性、Raw VAD/Decoded Segment 数量、Review blocker、Anti-Forcing blocker 与 duplicate occurrence conflict。机器证据及 Raw VAD/Token 不识别说话人的免责声明已加入。

交互包括播放/暂停、Component loop、Cue loop、Evidence interval loop、空格、`L`、左右方向键。循环到终点后回到选定 loop start，而不是错误回到 0。

## 20. Media-global / Audio-local 换算

页面统一使用：

```text
audioLocalTime = mediaGlobalTime - audioExtractedInterval.start
```

Component、Cue 和 Evidence 的 seek/loop 都经过同一转换和边界 clamp。页面不会把 400 秒等媒体全局时间直接写入 11 秒 WAV 的 `currentTime`。单元测试覆盖整个 Component、Cue 和任意 Evidence 起止点的转换。

## 21. Review Delivery Integrity Gate

新增严格 Artifact `subtitle-review-delivery-integrity.json`，`deliveryVersion=C5.17.2`、policy `c5.17.2-review-delivery-integrity-v1`。逐 Item 检查物理文件、相对/任务内路径、expected/actual SHA、WAV metadata、Component coverage、root/data package、所有 Evidence 来源、legacy projection、页面 Audio/Evidence 可解析性。

真实结果：7 passed、0 failed、全局 failures 为空；`reviewDeliveryIntegrityPassed=true`，Semantic Hash 为 `cd9ee64f9b61e94e0e4d799c32098c3b88546104d6268f3acb55304e90e94361`。

Gate 失败只阻止宣称 Review Package 已完成交付，不把字幕改为 rejected，也不改变 Cue。E2E 注入了 Package null、missing audio、hash/coverage/evidence/root-data corruption，均 fail closed。

## 22. Root/data Package 一致性

`subtitle-review-package.json` 与 `review/data/subtitle-review-package.json` 进行字节和语义校验；本次 `cmp` 为 true，`rootReviewDataMismatchCount=0`。页面只读取本地 data 副本，Integrity Artifact 证明它与根 Package 同步。

## 23. Finalization Metric 一致性

Review Summary 从 Item 重新计算，Finalization Report 再与 Summary 对齐。真实值：

- `reviewItemCount=7`；
- `reviewAudioPhysicalFileCount=7`；
- `reviewAudioReferencedCount=7`；
- `reviewAudioPlayableCount=7`；
- `reviewAudioCoverageFailureCount=0`；
- `rootReviewDataMismatchCount=0`；
- `finalizationReviewMetricMismatchCount=0`；
- `reviewPageBrokenAudioReferenceCount=0`；
- `reviewDeliveryIntegrityPassed=true`。

## 24. Shareable 元数据策略

Allowlist 新增 `subtitle-review-delivery-integrity.json` 和 `c5-17-2-review-delivery-replay-summary.json`，但不复制 Review Package 或 WAV。Shareable Delivery Item 将 `audioClipPath` 设为 `null`，保存 `audioIncludedInShareable=false`、文件名、SHA 和时长，因此不会产生指向未复制版权音频的坏链接。Artifact 内所有路径为 shareable-relative 或已清除。

## 25. 修改文件清单

最终提交包含 30 个文件（29 个源码/Schema/测试文件加本报告）：

```text
.agents/skills/multilingual-video-subtitler/SKILL.md
apps/cli/src/index.ts
package.json
packages/shared/src/c5-17-2-schemas.ts
packages/shared/src/finalization-schemas.ts
packages/shared/src/index.ts
packages/shared/src/shareable-artifact-schemas.ts
packages/video-subtitler/src/finalization.ts
packages/video-subtitler/src/index.ts
packages/video-subtitler/src/review-audio.ts
packages/video-subtitler/src/review-delivery.ts
packages/video-subtitler/src/review-evidence.ts
packages/video-subtitler/src/review.ts
packages/video-subtitler/src/shareable-artifacts.ts
schemas/c5-17-2-review-delivery-replay-summary.schema.json
schemas/shareable-artifact-manifest.schema.json
schemas/subtitle-finalization-report.schema.json
schemas/subtitle-review-delivery-integrity.schema.json
schemas/subtitle-review-package.schema.json
scripts/audit-review-delivery-integrity.ts
scripts/generate-schemas.ts
scripts/replay-c5-17-2-review-delivery.ts
scripts/validate-c5-17-2-review-delivery.ts
tests/c5-15-review-srt.test.ts
tests/c5-17-2-review-audio.test.ts
tests/c5-17-2-review-evidence.test.ts
tests/c5-17-2-review-page.test.ts
tests/e2e/c5-17-2-review-delivery-flow.test.ts
tests/e2e/finalization-flow.test.ts
C5_17_2_REVIEW_EVIDENCE_AUDIO_HANDOFF_REPORT.md
```

未包含 output、WAV、视频、模型、缓存、MFA 环境或二进制。

## 26. Schema 变化

扩展：

- `subtitle-review-package.schema.json`：Audio provenance/metadata、统一 Evidence、Reconciliation、Review v2 summary；新字段均有 optional/default，保留旧 Artifact 解析能力。
- `subtitle-finalization-report.schema.json`：Review Delivery 指标与 quality gate/path。
- `shareable-artifact-manifest.schema.json`：C5.17.2 policy。

新增：

- `subtitle-review-delivery-integrity.schema.json`；
- `c5-17-2-review-delivery-replay-summary.schema.json`。

`npm run generate:schemas` 真实生成并验证 `90` 个 JSON Schema（基线 88）。所有新 Zod 对象使用 `.strict()`；未扩展 strict Skill 2 v1 Cue。

## 27. 测试结果

实际命令：

```bash
npx --yes npm@11.18.0 install
npm run generate:schemas
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/multilingual-video-subtitler
```

结果：Node `v24.19.0`、npm `11.18.0`；安装为 up-to-date、审计 198 packages；Schema 90；typecheck/lint/build/format 全通过；24 个测试文件通过，`380 passed | 1 skipped`（共 381）。新增 C5.17.2 规格为 Audio 16、Evidence 14、Page 6，共 36 个单元规格；另有真实 fixture E2E 1 个及既有回归调整。

Skill 校验：系统 Python 运行 `Skill is valid!`。首次尝试 bundled Python 时因环境没有 `yaml` 模块得到 `ModuleNotFoundError: yaml`；这是校验运行时依赖问题，不是 Skill 内容失败，随后使用系统 Python 完整通过。

## 28. E2E 结果

实际命令 `npm run test:e2e`：7 个文件通过，`24 passed | 1 skipped`（共 25）。跳过项是既有 `C5.17 optional real MFA integration`，因为本轮明确不得重跑 MFA 且未设置 `MVL_MFA_INTEGRATION_TEST=1`；C5.17.2 真实 Fresh fixture E2E 已执行而未跳过。

C5.17.2 E2E 验证旧 7 Item/空 Audio Package 到新 Package/Page/Integrity 的修复，以及 root/data mismatch、missing audio、hash mismatch、coverage/evidence corruption 的 fail-closed 行为；Canonical Cue 保持不变。

## 29. 真实 Offline Replay 指标

实际命令（路径按真实值）：

```bash
npm run replay:c5-17-2-review-delivery -- \
  --task "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-fresh-20260826" \
  --output "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826" \
  --source-video "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv" \
  --human-reviewed-subtitle "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-2-1-contradiction-audit-20260823/C-draft/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/machine-review-draft-contradiction-audited/machine-review-draft-contradiction-audited.ass" \
  --review-audio-mode reuse-only \
  --review-evidence-reconciliation enforce \
  --review-delivery-integrity enforce \
  --review-page-timeline true
```

真实指标：Cue 192；Review Item 7；物理/引用/可播放 `7/7/7`；Audio failure/coverage/hash/metadata `0/0/0/0`；Mapped Token/Raw VAD/Decoded `12/30/68`；复制 Evidence-DP `0`；未解析引用 `0`；Delivery passed `true`。

执行计数：MFA 0、Whisper 0、Sudachi 0、G2P 0、FFmpeg 0、Whole-media ASR 0、OpenAI 0、Online subtitle lookup 0。

## 30. 幂等性结果

对同一 Fresh 输入执行第二次 collision-safe replay 到 `...20260826-01`，然后运行：

```bash
npm run validate:c5-17-2-review-delivery -- \
  --first "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826" \
  --second "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826-01"
```

9 项全部为 true：Review Package semantic identity、Finalization semantic hash、Evidence Reconciliation hash、Delivery Integrity semantic hash、Canonical Cue hash、Canonical Timing hash、Presentation hash、Review Page assets hash、Review Audio hashes。

稳定 Hash：Review Package `bf383217e1fb6e5d09b2dc892fca0a0e7b043dab8814d0c72cc11642cbd10329`；Finalization `7128fb344ebc77e5ef0c880076a12db51ad3e2327f3d93e0091557cb2c81f606`；Evidence `b77a6cd6e1ef059d2611b9ce4c7aa7d3daeaa04870dfaa629bfcd5d950533e39`；Delivery `cd9ee64f9b61e94e0e4d799c32098c3b88546104d6268f3acb55304e90e94361`；Page assets `6c5d2f382e0f017ee8df342300ad141de4fd8e93e2292868a7ad14b27d4ac2ce`。

## 31. Review Audio 前后对比

| 指标             | C5.17.1 | C5.17.2 |
| ---------------- | ------: | ------: |
| Physical         |       7 |       7 |
| Referenced       |       0 |       7 |
| Playable         |       0 |       7 |
| Failure          |       7 |       0 |
| Coverage failure |       7 |       0 |
| Hash mismatch    |  未记录 |       0 |
| Metadata failure |  未记录 |       0 |
| Reused existing  |  不支持 |       7 |
| Reused overlap   |  不支持 |       0 |
| Generated        |       0 |       0 |

## 32. Review Evidence 前后对比

| 指标                                 |          C5.17.1 |                                  C5.17.2 |
| ------------------------------------ | ---------------: | ---------------------------------------: |
| Mapped Token copied from Evidence-DP |               11 |                                        0 |
| Trusted mapped/no-VAD token lineage  |       未独立交付 |                                       12 |
| Trusted Raw VAD lineage              |           未交付 |                                       30 |
| Decoded Segment lineage              | 未按统一结构交付 |                                       68 |
| Legacy Raw VAD Cue boundary          |                0 | 0（无明确 Cue-side 归属，正确保持 null） |
| Unresolved Evidence reference        |         不可审计 |                                        0 |
| Decoded mislabeled as Raw VAD        |         不可审计 |                                        0 |

## 33. Review 页面可播放结果

7/7 Item 均生成 `<audio controls>` 的有效相对引用；Delivery Gate 逐项确认实际文件、Hash、metadata、coverage 和页面解析。`reviewPageBrokenAudioReferenceCount=0`，`reviewPageAudioReferencesResolvable=true`，`reviewPageEvidenceReferencesResolvable=true`。页面资产是 `review/index.html`、`review/assets/review.css`、`review/assets/review.js` 和 `review/data/subtitle-review-package.json`，不依赖网络。

## 34. Canonical/Timing/Presentation Hash

| 身份                    | Before                                                             | After | 不变 |
| ----------------------- | ------------------------------------------------------------------ | ----- | ---- |
| Canonical strict-v1 Cue | `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83` | 同左  | true |
| Canonical Timing        | `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02` | 同左  | true |
| Presentation Cue        | `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de` | 同左  | true |
| Presentation Artifact   | `7ba2058662d21b3de386d5ec0085636f108ee3a8bf0902affdd96d299308efbf` | 同左  | true |

Cue creation=0、deletion=0、text mutation=0、timing mutation=0；Finalization Report 的 `baseCueHash` 与 `outputCueHash` 完全一致。

## 35. Final Status

`finalStatus=needs-review`、`finalizationMethod=none`、Review Item=7、未关闭任何 7 个 unresolved overlap/forced-alignment blocker。Delivery Integrity 通过不等于字幕内容自动通过；本轮只修复审核交付。

## 36. Skill 2/3 兼容

只读仓库：

- Skill 2：`/Users/paulasmith/Documents/Codex-Skills-grammar-report-generator-compat-readonly`，branch `codex/publish-core-runtime`，commit `1af10bd8a7057c573959f39a745436fa837127ea`。
- Skill 3：`/Users/paulasmith/Documents/Codex-Skills-grammar-learning-site-builder-compat-readonly`，branch `codex/publish-core-runtime`，commit `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8`。

Skill 2 的 typecheck/build 通过；以最终 `subtitle-package.needs-review.json` 和 `--analysis-provider mock` 真实生成 `106 sentences / 106 grammar points`，语言 `ja=104, zh=2`。Skill 3 的 typecheck、1/1 测试、Vite build 和 `build-learning-site` 全通过。两个仓库前后 `git status` 都 clean，未提交任何修改。

## 37. 输入只读结果

Replay Summary 对源视频和人工 ASS 保存 size/mtime/SHA before/after，并全部 `verified=true`：

| 输入     |        Size |            mtimeMs | SHA-256                                                            | 前后     |
| -------- | ----------: | -----------------: | ------------------------------------------------------------------ | -------- |
| 源 MKV   | 847,774,958 | 1784692412273.1868 | `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` | 完全一致 |
| 人工 ASS |      17,094 | 1787570451152.2112 | `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e` | 完全一致 |

C5.17.1 Fresh 关键 Artifact before/after 也一致：Review Package `caabf700...14fc`、Finalization `957e6130...dea`、Forced Alignment `e92c2cde...859`、Overlap `8982222d...882`、Timestamp `25186903...8b1`、Presentation `7ba20586...fbf`、Pronunciation `a3bac085...793`、needs-review Package `31654d2c...c7d`。`sourceTaskCriticalArtifactsReadOnly=true`。

## 38. Shareable Audit

实际命令：

```bash
npm run audit:review-delivery-integrity -- --task "<first-output>"
npm run audit:shareable-artifacts -- --input "<first-output>/shareable"
```

结果：Review Delivery audit passed；Shareable `artifactCount=18`、`validationPassedCount=18`、absolute path leak `0`、prohibited secret `0`、broken relative reference `0`、path replacement `0`、secret redaction `0`。Shareable 内 WAV 数量 0，Review Package 数量 0；7 个音频条目的 `audioClipPath=null` 且 `audioIncludedInShareable=false`。

## 39. 依赖 Advisory

`npm audit` 报告 5 个传递依赖漏洞：1 moderate、4 high、0 critical；涉及 `brace-expansion`、`fast-uri`、`nanoid`、`postcss`、`undici`，均不是直接依赖。本轮未执行 `npm audit fix` 或 `--force`，避免超出 C5.17.2 范围和产生未审计升级。npm 还提示现有 `metrics-registry` env config 将在下一主版本停止支持；当前固定 npm 11.18.0 不受影响。安装阶段还提示 esbuild/fsevents lifecycle allow-scripts 状态，构建实际通过。

## 40. 未解决问题

- 7 个真实对白重叠 Component 仍需人工审核；本轮没有也不应通过交付修复关闭它们。
- Raw VAD 没有明确 Cue-side 归属，因此 legacy `rawVadBoundary` 保持 null；完整的 30 条 Component-level evidence 已可见。
- 可选真实 MFA integration test 因本轮禁止重新运行 MFA 而跳过。
- 5 个 npm 传递依赖 advisory 需要单独依赖升级任务评估。
- 首次 bundled-Python Skill 校验缺少 PyYAML；系统 Python 校验已通过。
- 调试中产生的失败/旧回放目录已可恢复地移到 `~/.Trash`，最终命名的两次输出均为重新生成并通过审计的版本。

## 41. 是否可以进入 C5.18

可以。C5.17.2 的进入条件已经满足：7/7 音频真实可播、Evidence lineage 已校准、跨产物 Gate 通过、Canonical/Timing/Presentation 不变、两次回放幂等、Shareable 安全、Skill 2/3 兼容。C5.18 必须继续把 Mapped Token/Raw VAD 视为 timing/speech-activity 证据而非说话人证据，并保留当前 7 个 unresolved 人工审核项。

## 42. 所有输出路径

- 开发仓库：`/Users/paulasmith/Documents/Codex-Skills-multilingual-video-subtitler-c5-13r-3`
- 报告：`/Users/paulasmith/Documents/Codex-Skills-multilingual-video-subtitler-c5-13r-3/C5_17_2_REVIEW_EVIDENCE_AUDIO_HANDOFF_REPORT.md`
- C5.17.1 只读输入：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-1-mfa-runtime-alignment-semantics-metadata-verified-fresh-20260826`
- 第一次最终回放：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826`
- 第二次幂等回放：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826-01`
- 第一次回放摘要：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826/c5-17-2-review-delivery-replay-summary.json`
- 第一次 Shareable：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-2-review-evidence-audio-handoff-20260826/shareable`
- Review Package：第一次回放的 `subtitle-.../subtitle-review-package.json`
- Review Page：第一次回放的 `subtitle-.../review/index.html`
- Delivery Integrity：第一次回放的 `subtitle-.../subtitle-review-delivery-integrity.json`
- Finalization Report：第一次回放的 `subtitle-.../subtitle-finalization-report.json`
- Review WAV：第一次回放的 `subtitle-.../audio/review/*.wav`
- 临时兼容验证：`/tmp/mvl-c5172-compat.dxvitr`（非交付、非仓库内容）

最终 C5.17.2 输出、Review Audio、Evidence 和 Delivery 结果均来自真实文件与 Artifact 验证，没有伪造证据，也没有修改人工文字或时间。
