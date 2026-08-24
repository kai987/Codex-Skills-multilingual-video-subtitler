# C5.15 Targeted Acoustic Overlap Resolution 开发报告

日期：2026-08-25

版本：`C5.15 — Targeted Acoustic Overlap Resolution`

中文名称：局部声学重叠证据恢复与安全时间对齐

## 1. 开发分支和基线 commit

- 目标仓库：`https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- 开发分支：`codex/c5-15-targeted-acoustic-overlap-resolution`
- 基线分支：`codex/c5-14-presentation-safe-auto-resolution`
- 基线 commit：`4f108499660c3f1289e64e5fda759c9786068b03`
- 开发前 `HEAD` 与上述基线完全一致，工作树 clean；没有基于 `main`、C5.13R.3 或更早版本重建。
- C5.14 目录、源视频和人工复核 ASS 均以只读输入使用；C5.15 写入独立 collision-safe 目录。

## 2. C5.14 的 7 个 unresolved component

C5.14 输入为 192 个 canonical cue，9 条 overlap edge 合并为 7 个 connected component、16 个 cue；7 组均为 `unresolved` / blocking。

|  组 | Cue                                                                                                              | 原时间（秒）                                      | 正确 union（秒） |
| --: | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- |
|   1 | 19 `糸子 おはよう`；20 `おはよう`                                                                                | 59.140–60.400；60.300–60.880                      | 59.140–60.880    |
|   2 | 88 `ソーリャ! ソーリャ!`；89 `あ 来ない早き`                                                                     | 402.050–410.370；403.750–407.550                  | 402.050–410.370  |
|   3 | 97 `あきまへんって。`；98 `アホか!調子乗んな!`                                                                   | 436.040–439.000；438.730–440.850                  | 436.040–440.850  |
|   4 | 140 `うまいわ この水茄子`；141 `上手につけたらいいよ`；142 `奥さん あんたんとこの水茄子\n今日店で買うたんですよ` | 688.310–690.270；690.160–695.140；690.670–695.610 | 688.310–695.610  |
|   5 | 145 `ええって歩よ`；146 `お 泰蔵 よかったね`                                                                     | 701.460–703.340；702.690–705.340                  | 701.460–705.340  |
|   6 | 163 `うちの目刺しもっと\n大きいやつにしてよ`；164 `さかわしい!`                                                  | 772.510–776.310；775.860–777.210                  | 772.510–777.210  |
|   7 | 174 `堪忍`；175 `罰だぞ。`；176 `堪忍!`                                                                          | 808.530–811.860；809.480–810.560；810.090–811.160 | 808.530–811.860  |

## 3. Review union interval bug 根因和修复

C5.14 按 cue 排序后使用 `first.start` 和 `last.end`。这把“最后一个 cue 的结束”错误当作 component 最大结束；嵌套 cue 中最后一个 cue 可能更早结束。真实 C5.14 因而把组 2 写成 402.05–407.55、组 7 写成 808.53–811.16。

C5.15 集中使用 `reviewComponentUnionInterval()`：

```ts
start = Math.min(...targets.map((cue) => cue.start));
end = Math.max(...targets.map((cue) => cue.end));
```

同一 union 现在驱动 `item.interval`、`currentStart/currentEnd`、页面显示、音频请求、SPLIT 范围、MERGE 范围、correction-feedback interval、review version/stale evidence。测试覆盖普通两 cue、完整嵌套、三 cue、起点/终点裁剪和超过软上限的 component。

C5.14 旧 WAV 并非全部完整：组 2 旧目标区间只到 407.55，1.5 秒 context 后 WAV 为 8.500313 秒、推算结束 409.05，仍短于 union 结束 410.37；组 7 的旧 WAV 因 context 偶然覆盖真实结束，但 review interval 本身仍错误。C5.15 用显式 coverage 字段验证后为 7/7。

## 4. SRT overlap 状态修复

C5.14 的单一字段只检查“非 blocking overlap decision”，因此 7 组全部 blocking 时得到 `srtOverlapRenderingMayVary=false`，即使实际 SRT 仍包含重叠。

C5.15 使用序列化 cue 的真实 overlap，并拆成：

- `serializedSrtContainsOverlap=true`
- `legalSrtOverlapRenderingMayVary=false`
- `unresolvedSrtOverlapPresent=true`
- deprecated `srtOverlapRenderingMayVary=true`，严格等于 contains

检测使用“到当前位置为止的最大历史结束时间”，因此不会漏掉完全嵌套且跨过相邻 cue 的 overlap。无 overlap、legal、unresolved、mixed、nested 及真实 SRT serialization 都有测试。

## 5. 修改文件清单

文档、入口与回放：

- `.agents/skills/multilingual-video-subtitler/SKILL.md`
- `README.md`
- `apps/cli/src/index.ts`
- `package.json`
- `scripts/replay-c5-15-overlap.ts`（新增）
- `C5_15_TARGETED_ACOUSTIC_OVERLAP_RESOLUTION_REPORT.md`（新增）

共享 contract / Schema：

- `packages/shared/src/overlap-acoustic-resolution-schemas.ts`（新增）
- `packages/shared/src/presentation-resolution-schemas.ts`
- `packages/shared/src/finalization-schemas.ts`
- `packages/shared/src/transcription-schemas.ts`
- `packages/shared/src/index.ts`
- `scripts/generate-schemas.ts`
- `schemas/subtitle-overlap-acoustic-resolution.schema.json`（新增生成物）
- `schemas/subtitle-presentation-resolution.schema.json`
- `schemas/subtitle-finalization-report.schema.json`
- `schemas/subtitle-review-package.schema.json`
- `schemas/asr-cache-manifest.schema.json`
- `schemas/portable-asr-cache-entry-v2.schema.json`

核心运行代码：

- `packages/transcription-core/src/overlap-acoustic-resolution.ts`（新增）
- `packages/transcription-core/src/overlap-classification.ts`
- `packages/transcription-core/src/presentation-resolution.ts`
- `packages/transcription-core/src/asr-cache.ts`
- `packages/transcription-core/src/worker.ts`
- `packages/transcription-core/src/index.ts`
- `packages/video-subtitler/src/overlap-acoustic.ts`（新增）
- `packages/video-subtitler/src/review.ts`
- `packages/video-subtitler/src/finalization.ts`
- `packages/video-subtitler/src/finalization-support.ts`
- `packages/video-subtitler/src/index.ts`

测试：

- `tests/c5-15-review-srt.test.ts`（新增，14 项）
- `tests/c5-15-overlap-acoustic.test.ts`（新增，38 项）
- `tests/e2e/c5-15-overlap-flow.test.ts`（新增，1 项综合 E2E）

## 6. 新增/修改 Schema

新增唯一长期公共 artifact：

```text
subtitle-overlap-acoustic-resolution.json
artifactType: subtitle-overlap-acoustic-resolution
resolutionVersion: C5.15
```

其 Zod contract 及 JSON Schema 均 strict，包含 source fingerprint、configuration、21 个 profile attempt、component 联合决定、alignment、counterfactual、timing mutation ledger 与 summary。原 presentation/review/finalization/cache Schema 仅做向后兼容扩展：C5.14 artifact 仍可解析；旧 review 音频字段使用默认值。生成 Schema 总数由 70 增至 71。

## 7. 局部音频提取策略

只从 C5.14 presentation 中选择 `relationship=unresolved && blocking=true` 的 7 组。每组使用：

- union：component 所有 cue 的 `min(start)` 至 `max(end)`；
- extraction：union 前后各 1.5 秒，并裁到 0–900.01 秒媒体边界；
- 软上限 20 秒、硬上限 30 秒；
- FFmpeg 参数：16 kHz、mono、PCM s16le WAV；
- 输出路径为 subtitle directory 下的相对 `audio/overlap/<component-id>.wav`。

本次 7 个窗口都短于 20 秒，未拆窗。提取 7/7，`audioFullyCoversComponent=7/7`。没有扫描其他 cue、21 个 layout 项或 5 个 repetition 组。

## 8. 音轨选择

真实命令显式使用 ffprobe 全局 stream index `--audio-track 1`。源文件只有一个合理 AAC 音轨；实现仍遵循显式参数 → 单一合理音轨自动选择，否则多音轨明确失败，不猜测。

## 9. ASR profile 计划

每组固定最多三种 prompt-free profile：

1. `current-sensitive-vad` / `sensitive-v2`
2. `no-vad`
3. `extra-sensitive-vad` / `extra-sensitive-v1`

7 × 3 = 21 个 attempt，等于默认上限且低于绝对 28。配置超过 28 会直接失败；8 个三-profile component 在默认 21 上限下也会被拒绝。所有 profile 都使用同一 `large-v3` 模型；profile support 与 model support 分开计数。

## 10. Prompt isolation 证明

运行路径把 Whisper `prompt` 设为 `undefined`。21/21 attempt 均记录：

```text
targetCueTextUsedAsPrompt = false
referenceTranslationUsedAsPrompt = false
humanReviewedSentenceUsedAsPrompt = false
promptSha256 = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

该 hash 是空输入 SHA-256。人工 cue 只在 ASR 完成后进入离线 alignment；缓存 identity 也只保存 prompt hash，没有目标句、翻译或人工修订句。

## 11. Portable cache 扩展

`AsrCacheRequestType`、Zod enum、entry 和 manifest 新增 `overlap-evidence`。identity 包含：音频 SHA、extraction interval、由 decode-config hash 覆盖的 target union、16 kHz/mono/PCM、model/hash/family、Core ML 状态、whisper.cpp version、profile/VAD on-off、token timestamp、language、空 prompt hash 与 decode configuration。

identity 不含 output directory、component decision ID、presentation version 或最终文件名。真实 replay 的 21 个 cache key 全命中后，ASR execution、worker start、model load 均为 0。`overlapAcousticEvidenceForHash()` 仅在计算语义输入/输出 hash 时排除 `generatedAt`、`cacheHit` 和请求/命中计数，written artifact 仍完整保留审计 provenance；真实与缓存运行因此得到相同语义 hashes。

## 12. Worker / model / Core ML 运行情况

- whisper.cpp：1.9.1，`/opt/homebrew/bin/whisper-cli`
- 模型：`ggml-large-v3.bin`
- 模型 SHA-256：`64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`
- VAD：Silero v6.2.0
- topology：persistent whisper-server；21 个兼容请求共用一个 batch key
- 未缓存：worker 1、model load 1、warm-up 1、fallback 0
- Core ML：`COREML=0`，未编译，因此 `coreml auto` 诚实降级到同一 GGML 模型的本地非 Core ML 路径；artifact 中 21/21 attempt 为 `coreML=false`
- whisper.cpp 实际日志显示 Apple M1 Pro Metal backend 已加载并 `use gpu=1`；现有 execution metrics enum 把所有非 Core ML 路径记为 `backend=cpu`，报告同时保留两者，避免把结构化兼容标签误称为未使用 Metal
- token/full JSON：本地 `--help` 支持 `--output-json-full`，真实 21 个 attempt 均请求 token timestamp，实际产生 token/segment/speech interval

## 13. Cue-to-acoustic alignment 算法

流程在 ASR 后执行：NFKC、标点/空白规范化、片假名转平假名、内建已确认读音、字符 bigram/LCS、token sequence、segment surface、时间覆盖、profile consensus、boundary support 与 neighbor intrusion 联合评分。配置集中为：

```text
surface/readings              0.30
token coverage                0.20
temporal coverage             0.15
profile consensus             0.15
boundary support              0.20
neighbor intrusion penalty    0.20
minimum alignment confidence  0.72
minimum boundary confidence   0.72
minimum independent profiles  2
```

所有 token/segment/speech/VAD 时间从 extraction-local 加 offset 后 clamp 到 extraction interval，写成媒体全局秒。Whisper 尾部 segment 若 clamp 后为空会被丢弃，避免 0-duration artifact；模型文件 hash 改为 stream 计算，支持 >2 GiB 模型。

C5.14 人工 ASS 导入后的 canonical cue 不带旧机器 token/speech/source-request provenance；16 个目标 cue 仅保留人工 authority 与 ASS layer/name/style。C5.15 不把旧候选重新写入 cue，而是在新 sidecar 中恢复本轮局部证据。

## 14. Reading unavailable 时的处理

内建 analyzer 只对假名和已确认短 lexeme 生成读音。无法可靠解析的汉字 OOV 明确写：

```text
readingAvailable = false
normalizedReading = null
readingAlignmentScore = null
blocker += READING_UNAVAILABLE
```

不调用 LLM、在线词典或剧情推断猜读音；surface evidence 仍可参与，但自动分类能力降低。

## 15. Component counterfactual 算法

2–3 cue 以整个有序 component 联合分配，不逐 cue 贪心取最近文本。每组统一比较：

```text
ordered-no-overlap
rapid-turn-taking
nested-background-foreground
true-simultaneous-speech
same-utterance-alternative
```

保存每个假设的 score、evidence IDs 和 blockers。C5.14 的 `selectTrustedOverlapBoundary` 只读取 cue 自带 token/speech/source evidence，并面向单 edge；不能直接承担本轮 post-ASR 多 profile、三 cue 联合问题。C5.15 复用了其“只信任实际边界、不使用 midpoint”的原则，但从 matched intervals 选择左右实际边界，并对完整 component 一次验证。

## 16. 关系分类规则

沿用并扩展现有 `OverlapRelationship`，没有建立平行类型系统。新增 `nested-background-speech`，合法集合包含 rapid turn、true simultaneous、crowd call + dialogue、nested background、authoritative legal overlap，以及已安全 timing 修复的 boundary error。

- rapid turn：小 overlap、两 cue 局部支持、顺序一致、无同句/持续同时证据；
- boundary error：两 cue 可信 alignment + 实际左右边界 + 全部 timing safety gate；
- crowd/dialogue、nested、simultaneous：至少两个 profile 支持局部重叠，不把 authority 或单 mono 混合输出当多说话人证明；
- same occurrence：仅 suggestion-only，不自动删人工 cue；
- 任何冲突、低 confidence、单 profile 或缺边界：`unresolved`。

分类器不包含 7 组真实台词、cue 编号或时间硬编码。

## 17. Timing-only 安全门

集中配置：最大单边调整 0.50 秒、修复后最短 0.40 秒、最大 neighbor intrusion 0.15、alignment/boundary confidence 均至少 0.72、至少 2 个独立 profile。边界来源只允许 token、speech、VAD、可信 source 或 pause。

禁止并通过测试验证：overlap midpoint、字符比例、时长比例、平均分割。每条 mutation ledger 含 before/after、delta、boundary source、evidence IDs 和固定 `textChanged=false`。

## 18. Component 原子应用和回滚

C5.14 已把 edge 合并为 component decision，并且多-edge component 不执行旧单-edge timing repair；C5.15 进一步允许三 cue joint proposal，但先为整组生成 proposed map，再统一验证 adjustment、最短时长、外部 neighbor、新 overlap、剩余 overlap 和 monotonic consistency。任何一项失败即返回空 mutation ledger，并加 `component-atomic-rollback`，没有 edge-by-edge last-writer-wins。

## 19. 7 组逐项真实运行结果

下表 ASR 按 `current-sensitive-vad | no-vad | extra-sensitive-vad` 排列；alignment 为各 cue `confidence / profile support / boundary confidence`；counterfactual 顺序为 `[ordered, rapid, nested, simultaneous, alternative]`。每组都有 3 attempts、1 个 component-level 最终决定、完整 review WAV，且 before=after、无 presentation override。

|  组 | extraction / WAV               | 三 profile raw text                                                                                                        | 关键 token/speech evidence 与 cue alignment                                                                                                                                      | Counterfactual / 最终决定                                                                    |
| --: | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
|   1 | 57.640–62.380；4.740s；full    | `おはよう / おはよう / ママがあんたや` \| `おはようさん / おはよう / なんて` \| `おはようさん / おはよう / ママがあんたや` | Cue19 `0.681/3/0.194`，neighbor intrusion；Cue20 `0.792/3/0`；matched intervals 跨 58.58–62.26，不能得到可信分界                                                                 | `[.30,.45,0,.20,0]`；`unresolved`，confidence .45，blocking                                  |
|   2 | 400.550–411.870；11.320s；full | `お兄ちゃんの音` \| `大豆お兄ちゃんの音` \| `お兄ちゃんの音`                                                               | 三 profile speech 只在 410.84–411.87，目标两 cue 均无 lexical match；Cue88 `.131/0/0`，Cue89 `.103/0/0` 且 reading unavailable                                                   | `[.25,.15,.35,0,0]`；`unresolved`，confidence .35，blocking；不能把时间嵌套猜成 crowd/nested |
|   3 | 434.540–442.350；7.810s；full  | `…あきまへんって…` \| `…飽きまへんって / アホか!調子乗んな! / 何しに行くの?` \| `…開きまへんって / 痛っ`                   | Cue97 token 435.74–439.37，`.749/3/0`；Cue98 仅 no-VAD speech 437.19–442.02，`.541/1/.400`，有 intrusion/OOV                                                                     | `[.30,.45,0,.20,0]`；`unresolved`，confidence .45，blocking                                  |
|   4 | 686.810–697.110；10.300s；full | 三组均识别 `うまいわこの水ナス`，随后 `おっさん/あんたんとこの水ナス…`，后半措辞略有冲突                                   | Cue140 `.771/3/.328`，Cue141 `.756/3/.289`，Cue142 `.597/3/.211`；matched spans 分别约 688.21–689.85、693.41–695.61、690.71–695.61，三 cue 联合边界不足且 reading 均 unavailable | `[.25,.15,0,0,0]`；`unresolved`，confidence .25，blocking；三 cue 无冲突 mutation            |
|   5 | 699.960–706.840；6.880s；full  | `2人ともよかったね` \| `ええってある方 / よかったね / お気に入り` \| `ええって / よかったね`                               | Cue145 `.613/2/0`，Cue146 `.658/3/0`；matched spans 699.96–705.10 有 neighbor intrusion，缺可信边界，两个 reading unavailable                                                    | `[.30,.45,0,.20,0]`；`unresolved`，confidence .45，blocking                                  |
|   6 | 771.010–778.710；7.700s；full  | 三组均近似识别“目刺し更大”和后续 `やがなし/やがらしい`                                                                     | Cue163 `.759/3/0`，token 772.09–776.07；Cue164 `.486/2/.033`，token 775.97–776.81；第二 cue 低 confidence，边界不可信                                                            | `[.55,.60,0,0,0]`；`unresolved`，confidence .60，blocking；未为漂亮结果降低阈值              |
|   7 | 807.030–813.360；6.330s；full  | `までばまでくらー 抜粋やろ` \| `まではまでごらんまえバッシャーだろ` \| `までばまでくらいん バシアロー`                     | 三 cue 均无可靠 lexical localization；confidence `.117/.080/.108`，profile support 0，reading unavailable，整段 speech 807.03–813.36 无可用分界                                  | `[.25,.15,.35,0,0]`；`unresolved`，confidence .35，blocking                                  |

每组 artifact 的 `acousticEvidenceIds` 均包含 1 个 component evidence ID 和 3 个 attempt ID；“所有决定都有 evidence”不等于“证据足够自动关闭”。

## 20. 所有 timing before/after

真实运行没有任何 timing mutation，16 个目标 cue 全部 before=after：

```text
19  59.140–60.400 -> 59.140–60.400
20  60.300–60.880 -> 60.300–60.880
88  402.050–410.370 -> 402.050–410.370
89  403.750–407.550 -> 403.750–407.550
97  436.040–439.000 -> 436.040–439.000
98  438.730–440.850 -> 438.730–440.850
140 688.310–690.270 -> 688.310–690.270
141 690.160–695.140 -> 690.160–695.140
142 690.670–695.610 -> 690.670–695.610
145 701.460–703.340 -> 701.460–703.340
146 702.690–705.340 -> 702.690–705.340
163 772.510–776.310 -> 772.510–776.310
164 775.860–777.210 -> 775.860–777.210
174 808.530–811.860 -> 808.530–811.860
175 809.480–810.560 -> 809.480–810.560
176 810.090–811.160 -> 810.090–811.160
```

`automaticTimingMutationDecisionCount=0`、`midpointRepairCount=0`、`characterRatioRepairCount=0`、canonical text mutation=0。

## 21. Canonical text hash

```text
baseCueHash      8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83
outputCueHash    8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83
cue count        192 -> 192
text mutations   0
```

两者相等；旧机器候选重新写入数 0、全 cue fragment replacement 0。

## 22. Canonical timing hash

对按 cue 顺序的 `{id,start,end}` 数组使用项目 `stableStringify + SHA-256`：

```text
510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02
```

C5.15 timing mutation 为 0，因此与 C5.14 人工基线 timing 相同。

## 23. Presentation hash

```text
presentationCueHash  9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de
inputEvidenceHash    bb309fc1b9a93d820eb7afaf19c4bbbb7d5d5325b53ed0bcd103c332cce6ef2b
outputHash           2a6c717291dae9bf2465c44f31fde09e4f434d714a13d40d16fd551911cad323
```

presentation cue hash 保持 C5.14 值，因为没有 timing 或 display override 新变化；sidecar 已升级为 `resolutionVersion=C5.15` 并保存 acoustic provenance。未缓存与 cache replay 的三项语义 hash 全部一致。

输出文件 SHA-256 在两次运行中也一致：

```text
SRT      fc4a3ed5d6338f1c02706ec443544312a5517916d54fcb42671a20e604a12edb
VTT      53c14e2032f13c9ff4d2ff117be5d998d7192ca9fb7e400b01a33f20789eb76c
ASS      936ba3c0675bcfb3913f5d05fa5e1e5db88ccc07792b38fd81bdc7aa11412320
package  31654d2c96ad97ed05a8d8066c2cb99f6444424c46b121694e4ead15ade26c7d
```

## 24. Review items 前后变化

- C5.14：7 items / 7 WAV，但组 2、7 的 review interval 错误；组 2 WAV 实际未覆盖完整 union。
- C5.15：仍为 7 items / 7 WAV，因为 7 组声学证据都不足；`audioCoverageFailureCount=0`，7/7 `audioFullyCoversComponent=true`。
- 组 2 interval 修正 402.05–407.55 → 402.05–410.37；组 7 修正 808.53–811.16 → 808.53–811.86。
- review package 新增 component union、requested/extracted interval、duration、SHA-256、context、coverage；页面显示同一 union，只生成剩余 unresolved 组。

## 25. SRT/VTT/ASS parity

最终质量门：

```text
serializationRoundTripPassed = true
formatSemanticParityPassed   = true
canonicalParityPassed        = true
presentationParityPassed     = true
formatParityErrorCount       = 0
```

SRT/VTT/ASS 都保留 192 条 canonical 文本语义。SRT 仍含 unresolved overlap，因此 warning 正确；没有把 unresolved 伪装成 legal，也没有生成 presentation separation override。

## 26. Skill 2 兼容结果

在只读 Skill 2 仓库 `codex/publish-core-runtime` / `1af10bd8a7057c573959f39a745436fa837127ea` 中，以 deterministic `mock` analyzer 重建：

```bash
npm run grammar-report -- \
  --input "<C5.15>/subtitle-package.needs-review.json" \
  --output "<C5.15>/skill2-compatibility" \
  --analysis-provider mock \
  --overwrite
```

结果：strict v1 package 解析通过，192 个输入 cue ID 被 106 sentences 引用且 unique/missing/unknown 为 192/0/0；106 sentences / 106 grammar points。presentation/acoustic sidecar 未进入 Skill 2 cue。

Skill 2 前后 clean、HEAD 不变。Skill 3 只读仓库 `codex/publish-core-runtime` / `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8` 未执行写操作，前后 clean、HEAD 不变。

## 27. 未缓存真实运行指标

实际本地 `large-v3` 未缓存运行：

| 指标                                   |                实际值 |
| -------------------------------------- | --------------------: |
| target components / cues               |                7 / 16 |
| extracted / fully covered audio        |                 7 / 7 |
| profile attempts                       |                    21 |
| executed overlap ASR requests          |                    21 |
| cache hits                             |                     0 |
| worker starts / model loads / warm-ups |             1 / 1 / 1 |
| fallback process                       |                     0 |
| whole-media ASR                        |                     0 |
| network / OpenAI / online subtitle     |     false / false / 0 |
| initialization / model load            | 2.181901s / 2.173515s |
| local transcription                    |            27.306393s |
| worker total                           |            29.488294s |
| stage wall-clock                       |            33.054383s |
| canonical text / timing mutation       |                 0 / 0 |

## 28. 缓存 replay 指标

使用相同视频、ASS、模型、音轨、profile、union、cache identity 以 `asr-cache-mode=read` 回放：

```text
profile attempts    21
ASR execution       0
cache hits          21
worker starts       0
model loads         0
warm-ups            0
fallback            0
stage wall-clock    3.183117s
outputHash          2a6c717291dae9bf2465c44f31fde09e4f434d714a13d40d16fd551911cad323
inputEvidenceHash   bb309fc1b9a93d820eb7afaf19c4bbbb7d5d5325b53ed0bcd103c332cce6ef2b
```

与未缓存运行的 canonical、presentation、input/output semantic hash 及 SRT/VTT/ASS/package 文件 hash 一致。

## 29. 源视频只读结果

前后完全一致：

```text
path    /Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv
size    847774958
mtimeMs 1784692412273.1868
SHA-256 294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43
verified true
```

## 30. 人工 ASS 只读结果

前后完全一致：

```text
path    /Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-2-1-contradiction-audit-20260823/C-draft/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/machine-review-draft-contradiction-audited/machine-review-draft-contradiction-audited.ass
size    17094
mtimeMs 1787570451152.2112
SHA-256 a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e
verified true
```

## 31. 单元测试结果

Node `v24.19.0`，规定质量门显式由 npm `11.18.0` 执行。

```text
npx vitest run tests/*.test.ts
9 files / 142 tests passed

npx --yes npm@11.18.0 test
12 files / 152 tests passed
```

新增 53 项：review/SRT 14、acoustic 38、综合 mock E2E 1。覆盖任务列出的 union/audio、SRT flags、profiles/cache/prompt、alignment/OOV、7 类关系、token/speech/VAD boundary、所有 timing veto、三 cue 原子回滚及 observe mode。

## 32. E2E 结果

```text
npx --yes npm@11.18.0 run test:e2e
3 files / 10 tests passed
```

新 C5.15 mock E2E 构建 7 组：可信 fixture 中安全关闭 boundary、rapid turn、crowd/dialogue、nested、simultaneous 和三 cue；只保留 1 个不足证据 review item。验证 canonical text mutation 0、cue count 不变、strict Skill 2 package、SRT/VTT/ASS canonical/presentation parity。真实样本没有借用 mock 结果，仍为 7 unresolved。

## 33. Schema 总数

```text
npx --yes npm@11.18.0 run generate:schemas
Generated 71 JSON Schemas
```

Zod strict parse、生成 JSON Schema 和相关回归测试均通过。

## 34. Skill quick validation

```text
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler

Skill is valid!
```

## 35. 未解决问题

- 真实 7 组均仍需人工复核；没有为了 4–5 组目标降低阈值。
- mono Whisper 对同时说话/背景前景分离的证明能力有限；组 2、7 尤其缺 lexical localization。
- 多个含汉字方言/专名 cue 没有可确认 reading，按规则保留 `null`。
- structured execution backend 旧 enum 只有 coreml/cpu；本次非 Core ML 路径标记 cpu，但 whisper.cpp 日志确认实际启用了 Metal。未来可在兼容升级中增加独立 acceleration 字段。
- 最终状态因此为 `needs-review` / `finalizationMethod=none`，blocking finding 7、review item 7；不能生成 human-validated final。

## 36. 未执行的模型/API

```text
whole-media ASR            0
OpenAI/API calls           0
online subtitle search     0
network model service      0
browser automation         0
diarization/source split   0
old machine candidate reinsertion 0
```

只执行了用户允许的本地 whisper.cpp `large-v3` + Silero VAD 的 7 个 bounded component。

## 37. 依赖 advisory、失败项和跳过项

`npx --yes npm@11.18.0 install` 成功：198 packages audited；保留现有 5 个 advisory（1 moderate、4 high），并提示 esbuild/fsevents install scripts 尚未进入 allowScripts。未执行 `npm audit fix --force` 或扩大范围升级。

所有规定 gate 最终通过，0 test failure / 0 skipped。开发中真实记录并修复：

1. 第一次真实运行在读取 3.095 GB 模型 hash 时触发 Node `File size > 2GiB`；改为 streaming SHA-256，并保留失败输出目录。
2. 第二次运行的一个 no-VAD 尾部 segment 超出 clip，clamp 后成为零时长并被 strict Schema 拒绝；worker 现在在 chunk clamp 后丢弃空 segment，并加回归测试。
3. 探索性 `npm test -- --runInBand` 失败，因为 Vitest 不支持 Jest 的 `--runInBand`；规定的 `npm test` 随后真实通过。
4. 两个探索性 `tsx -e` timing-hash one-liner 分别因 CJS top-level await、workspace package export 失败；改用无依赖 Node stable-hash one-liner成功。这两项不是产品 gate。

Core ML 因本机 whisper.cpp `COREML=0` 被跳过；`coreml auto` 按要求使用相同本地 GGML 模型的受支持 Metal/CPU 路径，没有 API fallback。

## 38. C5.16 后续建议

保持 C5.15 阈值不变，优先让人工 reviewer 在 7 段完整 WAV 上标注：每个 cue 的真实 speech onset/offset、foreground/background/chant、是否同一 occurrence。C5.16 可引入本地 diarization/source-separation 或人工 boundary sidecar，再把它们作为新独立 evidence source；不要继续对同一 mono large-v3 输出增加 profile 数量来伪造独立性。另可向 execution metrics 增加 `acceleration=metal|coreml|cpu`，避免 legacy backend 标签歧义。

## 39. 所有输出路径与实际命令

最终未缓存输出：

```text
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-20260825
```

最终 cache replay：

```text
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-cache-replay-final-v3-20260825
```

portable cache：

```text
/Users/paulasmith/.cache/mvl/c5-15-overlap-final-v3-20260825
```

保留的诊断/审计快照：

```text
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-model-hash-failed-20260825
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-one-profile-parse-failed-20260825
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-cache-replay-20260825
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-cache-replay-v2-20260825
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-15-targeted-acoustic-overlap-resolution-pre-semantic-hash-normalization-20260825
```

最终 artifact 位于未缓存输出的 subtitle directory：

```text
subtitle-overlap-acoustic-resolution.json
overlap-whisper-execution-metrics.json
overlap-asr-cache-manifest.json
subtitle-presentation-resolution.json
subtitle-finalization-report.json
subtitle-review-package.json
review/index.html
subtitle-<stem>.best-effort.srt
subtitle-<stem>.best-effort.vtt
subtitle-<stem>.best-effort.ass
subtitle-package.needs-review.json
```

真实 run 与 cache replay 使用同一命令参数；第二次把 output 改为 replay 目录并把 cache mode 改为 `read`：

```bash
npm run replay:c5-15-overlap -- \
  --task "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-14-presentation-safe-auto-resolution-20260825" \
  --human-reviewed-subtitle "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-2-1-contradiction-audit-20260823/C-draft/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/machine-review-draft-contradiction-audited/machine-review-draft-contradiction-audited.ass" \
  --source-video "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv" \
  --output "<C5.15 output>" \
  --audio-track 1 \
  --overlap-acoustic-resolution enforce \
  --presentation-resolution enforce \
  --overlap-resolution conservative \
  --overlap-context-seconds 1.5 \
  --overlap-max-window-seconds 20 \
  --max-overlap-asr-requests 21 \
  --whisper-cpp-path "/opt/homebrew/bin/whisper-cli" \
  --local-transcription-model "/Users/paulasmith/.cache/whisper.cpp/ggml-large-v3.bin" \
  --whisper-vad-model "/Users/paulasmith/.cache/whisper.cpp/ggml-silero-v6.2.0.bin" \
  --coreml auto \
  --whisper-execution-mode persistent \
  --asr-cache-dir "/Users/paulasmith/.cache/mvl/c5-15-overlap-final-v3-20260825" \
  --asr-cache-mode read-write
```

全部规定质量门：

```bash
npx --yes npm@11.18.0 install
npx --yes npm@11.18.0 run generate:schemas
npx --yes npm@11.18.0 run typecheck
npx --yes npm@11.18.0 run lint
npx --yes npm@11.18.0 run build
npx --yes npm@11.18.0 run format:check
npx --yes npm@11.18.0 test
npx --yes npm@11.18.0 run test:e2e
npx vitest run tests/*.test.ts
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler
```

## 最终结论

C5.15 已完成真实源码、strict Schema、CLI、bounded local ASR、portable cache、post-ASR alignment、component-level conservative classification、atomic timing safety、review union/audio 修复、SRT flags、mock E2E、真实未缓存运行、缓存回放和 Skill 2 兼容验证。

真实证据没有达到自动修复或合法 overlap 的门槛，因此最终诚实保持：192 cue、人工文字 0 修改、时间 0 修改、7 个 unresolved review item、`needs-review`。这符合本轮“证据不足时不猜测”的首要安全目标。
