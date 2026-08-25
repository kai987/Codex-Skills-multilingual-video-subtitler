# C5.17 Canonical Transcript-Constrained Forced Alignment 开发报告

## 结论先行

C5.17 的源码、严格 Schema、CLI、独立 Cache、Mock E2E、审核页面和安全门已经实现并通过完整 Node 回归。真实输入上的 `evidence-dp + observe` 回放也已完成：只分析 7 个 unresolved Component / 16 个 Cue，生成 7 个完整审核音频，Canonical 文本、Canonical 时间均未修改。

本机没有 `micromamba`、`mamba`、`conda` 或现成 MFA 环境。按照本任务明确的供应链约束，未自动安装 Miniforge、未修改 shell profile，也未伪造 MFA Runtime/模型身份。因此真实 MFA `hybrid + enforce` Fresh、全命中 Cache Replay、MFA Observe 和 C5.17 Shareable Audit 尚未执行。当前诚实状态仍为 `needs-review` / `finalizationMethod: none`。

## 1. 分支与基线

- 仓库：`https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- 开发分支：`codex/c5-17-canonical-transcript-forced-alignment`
- 固定基线分支：`codex/c5-16-1-runtime-stabilization`
- 固定基线 commit：`9932b161b7fd17aa90b64e6110dabc1c746044fc`
- 未修改、未重写、未 force-push C5.16.1。
- 本报告不能自嵌最终 commit SHA（嵌入会改变 commit 本身）；最终交付 SHA 以 Git 日志和最终回复为准。

## 2. 问题定义与技术选择

C5.16.1 已经把 Decoded Segment、可信 Mapped Token 和 Raw VAD 放进各自经过验证的时间坐标，但这些证据仍不等于“完整人工句子属于哪个声音 occurrence”。Mapped Token 可能缺词或只有局部词形；Raw VAD 只表示语音活动，不提供词汇归属；Decoded Segment 可能覆盖多个相邻说话轮次。将三者直接等同于完整句界会重现错误的跨 Cue 归属。

选择 MFA 的原因是它以给定 transcript 和音频为输入，输出 word/phone 时间；这与“人工文本只作为待对齐文本”的目标一致。MFA 官方文档同时说明单文件 alignment 不执行 speaker adaptation，适合本轮短窗口和未知角色场景。官方文档：

- [MFA alignment workflows / single-file alignment](https://montreal-forced-aligner.readthedocs.io/en/latest/user_guide/workflows/alignment.html)
- [Japanese MFA acoustic model v3.0.0](https://mfa-models.readthedocs.io/en/latest/acoustic/Japanese/Japanese%20MFA%20acoustic%20model%20v3_0_0.html)
- [Japanese MFA dictionary v3.0.0](https://mfa-models.readthedocs.io/en/latest/dictionary/Japanese/Japanese%20MFA%20dictionary%20v3_0_0.html)
- [Japanese (Katakana) MFA G2P model v3.0.0](<https://mfa-models.readthedocs.io/en/latest/g2p/Japanese/Japanese%20(Katakana)%20MFA%20G2P%20model%20v3_0_0.html>)

没有采用 TorchAudio Forced Align，因为该 API 已进入弃用/移除路径，而且本任务要求固定 MFA 3.4.2；实现中没有引入 CTC、WhisperX、MFA-HF 或新的自由转写后端。

## 3. 实际源码实现

### 3.1 Canonical 与 Alignment 文本

- `canonicalText` 始终逐字来自人工复核 strict v1 Cue。
- `alignmentText` 单独执行 NFKC、全角空白折叠、显示换行移除、ASS/HTML 显示标签移除和句读点分离。
- 规范化结果从不写回 Cue。
- Sudachi helper 现在按 morpheme 输出 `surface`、`normalizedSurface`、`dictionaryForm`、`reading`、`partOfSpeech`、`isOov`、Unicode code-point `startCharacter/endCharacter`。
- Reading 优先级固定为：已确认 Terminology → Sudachi dictionary → 官方 MFA G2P → Kana literal → unresolved。
- 未解析的关键 OOV 可继续进入对齐尝试，但 `CRITICAL_OOV_READING_UNRESOLVED` 会阻断自动 timing eligibility。
- `あきまへん`、`せえへん`、`なっちゃる`、`さかわしい` 等方言表面形不标准语化。

### 3.2 MFA Runtime 与能力门

- 固定 MFA：`3.4.2`。
- 固定模型目标：
  - Acoustic：`japanese_mfa` `3.0.0`
  - Dictionary：`japanese_mfa` `3.0.0`
  - G2P：`japanese_katakana_mfa` `3.0.0`
- 三类模型只接受 `officialSource: MontrealCorpusTools`，记录 basename、version、size、SHA-256、license、citation 和 metadata SHA-256。
- Runtime manifest 记录 Python、Kalpy、Kaldi、Pynini、SudachiPy、praatio、Conda explicit-spec SHA、平台、架构和网络状态，不保存本机绝对路径。
- 实际 probe 代码运行 `mfa version`、两个单文件命令的 `--help`、三类 `mfa model inspect` 和 Python 包版本探针；未知 MFA 4.x、缺少 word/phone 输出、缺少 G2P 参数或模型元数据时 fail closed。
- JSON 只有在 sample probe 同时证明 word/phone tier 时才会选用，否则固定用 MFA 环境内的 praatio 解析 long TextGrid。
- `spawn`/runner 使用参数数组和 `shell: false`；alignment 默认离线。

### 3.3 有界 Alignment、Evidence-DP 与 Cache

- 目标限定为 blocking overlap components，硬上限 7 Component / 16 Cue。
- 每 Cue 只有 Narrow `±0.50s` 和 Expanded `±1.00s` 两次尝试；每 Cue 上限 2，总 attempt 上限 40、验收配置 32，并发上限 2、验收配置 1。
- 优先复用并重新校验 C5.16.1 完整 component WAV；缺失时只提取局部 16 kHz mono PCM WAV。
- Evidence-DP 在时间单调约束下匹配 Canonical surface/reading 与既有 trusted mapped-token/decoded-segment 单元；gap 可以表示 ASR 漏词/多词。Raw VAD 仅作为边界证据，不按字符、reading 长度或 phone 数量平均分配时间。
- 独立 cache request type 为 `canonical-forced-alignment`。Key 包含音频/窗口、Canonical/Alignment/Reading hash、backend、runtime explicit spec、三模型 hash、命令/配置、parser、Anti-Forcing 和 Joint-Assignment policy；排除任务、输出、临时路径和生成时间。

### 3.4 Anti-Forcing 与 Component 联合仲裁

MFA 即使 transcript 错误也可能给出表面完整的时间，所以“有输出”从不等于可信。每个 Cue 计算 transcript/reading/phone coverage、OOV、window edge pinning、Narrow/Expanded stability、phone duration、silence intrusion、Mapped Token/Raw VAD/Decoded Segment/Evidence-DP/source prior agreement、neighbor intrusion 和 duplicate occurrence overlap。

每个 Component 一次性比较 `ordered-no-overlap`、`rapid-turn-taking`、`nested-background-foreground`、`same-occurrence-alternative`、`partial-alignment` 和 `unresolved`。分数明确标记为 `uncalibrated-heuristic`，不是概率。三 Cue Component 也一次联合处理。MFA 不作为 speaker、foreground/background 或 simultaneous-speech 证据。

不同 Cue 的候选如果文本/reading 相同且 word/phone/时间高重合，会生成确定性的 `acousticOccurrenceId` 冲突，标记 `DUPLICATE_ACOUSTIC_OCCURRENCE_ASSIGNMENT` 并保持 unresolved。两个“おはよう”只有存在两个可分离且有序的 occurrence 才能分别接受。

### 3.5 Timing-only 原子修复

只有稳定双窗口、完整 coverage、无关键 OOV/edge pinning/重复 occurrence、与 Evidence-DP 不严重冲突、Mapped Token 与 Raw VAD/Pause 分别支持边界、neighbor intrusion 和 decision margin 通过、单边变化不超过 0.50 秒、修复后至少 0.40 秒且不产生新非法 overlap 时，才生成 timing-only mutation。

Mutation ledger 记录 before/after、delta、MFA/Token/VAD lineage，并固定 `textChanged: false`。Component 中任一 Cue 失败会整体回滚。`observe` 永不应用 mutation 或关闭 blocker。Midpoint、字符比例、Reading 比例、Phone-count 比例和为消除 overlap 而直接截断 Cue 均没有实现入口。

## 4. 新增和更新 Artifact

新增严格 Artifact：

1. `forced-alignment-runtime-capability.json`
2. `subtitle-canonical-alignment-input.json`
3. `subtitle-canonical-forced-alignment.json`
4. `forced-alignment-cache-manifest.json`
5. `c5-17-forced-alignment-replay-summary.json`

同时扩展：

- `subtitle-overlap-acoustic-resolution.json`
- `subtitle-presentation-resolution.json`
- `subtitle-finalization-report.json`
- `subtitle-review-package.json`
- `review/index.html`
- C5.16.1 shareable allowlist/manifest

总 JSON Schema 数从 77 增至 83；新增 6 个 Schema，全部由 Zod 生成。

## 5. 本机 MFA Runtime 调查结果

执行命令：

```text
npm run prepare:mfa-runtime -- \
  --mfa-version 3.4.2 \
  --create-runtime \
  --fetch-mfa-models
```

真实结果：失败，错误为 `UserActionRequiredError`；依次探测 `micromamba`、`mamba`、`conda`，检测结果为空。本机也没有可复用的 `mfa` 或 `~/.cache/mvl/mfa-runtime`。

因此以下内容没有执行、没有伪造：

- 本机 `mfa version` 与 `align_one/align_one_legacy --help` probe
- Apple Silicon MFA 3.4.2 实际短片开销
- Conda explicit spec 与 runtime identity
- 模型下载、实际 archive SHA/size、`mfa model inspect`
- JSON/TextGrid 实际输出样本、OOV/likelihood stderr 行为
- Hybrid Fresh 32 attempts
- 全命中 Cache Replay
- MFA Observe 对照

官方资料支持 `japanese_katakana_mfa` 3.0.0 为 Katakana 输出的官方日语 G2P 候选，但本报告不会把文档调查替代为本机 `mfa model inspect` 验证。

## 6. 真实输入 Evidence-DP Observe

主输出：

`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-canonical-transcript-forced-alignment-evidence-dp-observe-20260826`

输入：

- C5.16.1 task：`carnation-reference-guided-c5-16-1-runtime-stabilized-standard-20260826`
- 源视频：847,774,958 bytes；SHA-256 `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`
- 人工 ASS：17,094 bytes；SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`

汇总：

- backend：`evidence-dp`
- mode/run kind：`observe`
- 7 Component / 16 Cue
- Evidence-DP 有边界候选：10 Cue
- MFA attempts/process/success/failure/cache hit：`0/0/0/0/0`
- runtime identity：`null`（没有伪造）
- unresolved：7 Component
- timing mutation：0
- Canonical text mutation：0
- untrusted forced-alignment timing use：0
- duplicate occurrence assigned：0
- Whole-media ASR / Whisper / OpenAI / online subtitle lookup：全部 0
- review：7 item，7/7 音频生成成功且完整覆盖 Component
- wall clock：2.668798375 秒
- final：`needs-review` / `none`

本次真实回放没有 Sudachi/MFA 隔离 Python，因此 fallback 只能确定 Kana literal；17 个 Han/OOV 单元按事实保持 unresolved。Mock/单元测试已验证 Sudachi morpheme offset、Kanji reading、Terminology 和方言路径，但这些不冒充本次真实 Sudachi 输出。

## 7. 七组 Component 逐项结果

下表中 Narrow/Expanded 是将原 Cue `±0.50s/±1.00s` 裁到已验证 Component WAV 的搜索范围。`DP` 为既有 C5.16.1 证据得出的候选边界；它没有单独用于 mutation。MFA word/phone 均为“未运行”。所有组的 Best/Runner-up/Margin 均为 `unresolved 0.75` / `partial-alignment 0.15` / `0.60`；这只是未校准启发式分数。

| Component | Cue / 原时间 / Canonical → Alignment / Reading / OOV                                                                                                                                     | Narrow / Expanded                                                                                                               | Evidence-DP                                                                                                                   | 既有证据（Mapped/VAD/Segment）        | 最终结果                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1         | 19 `59.140–60.400` `糸子 おはよう` → 同文；reading null；OOV `糸子`。20 `60.300–60.880` `おはよう` → 同文；reading `おはよう`；OOV 0                                                     | 19 `58.640–60.900` / `58.140–61.400`；20 `59.800–61.380` / `59.300–61.880`                                                      | 19 `60.230–60.890`, coverage .50, score .75；20 `58.820–60.860`, coverage 1, score 1                                          | 19 `0/2/3`；20 `1/2/2`                | 无 MFA 双窗口；重复问候 occurrence 唯一性不能证明；unresolved；0 mutation；1 review item     |
| 2         | 88 `402.050–410.370` `ソーリャ! ソーリャ!` → `ソーリャ ! ソーリャ !`；reading `そーりゃそーりゃ`。89 `403.750–407.550` `あ 来ない早き`；reading null；OOV `来/早`                        | 88 `401.550–410.870` / `401.050–411.370`；89 `403.250–408.050` / `402.750–408.550`                                              | 两 Cue 均无边界，coverage/score 0                                                                                             | 两 Cue `0/0/0`                        | 无 MFA、关键 OOV、DP 无词汇路径；unresolved；0 mutation；1 review item                       |
| 3         | 97 `436.040–439.000` `あきまへんって。` → `あきまへんって 。`；reading `あきまへんって`。98 `438.730–440.850` `アホか!調子乗んな!` → `アホか ! 調子乗んな !`；reading null；OOV `調子乗` | 97 `435.540–439.500` / `435.040–440.000`；98 `438.230–441.350` / `437.730–441.850`                                              | 97 `437.110–442.020`, coverage 1, score 1；98 `435.720–440.490`, coverage .50, score .75                                      | 97 `1/3/2`；98 `0/3/1`                | DP 边界超出或跨邻居且无 MFA 独立支持；unresolved；0 mutation；1 review item                  |
| 4         | 140 `688.310–690.270` OOV `水茄子`；141 `690.160–695.140` OOV `上手`；142 `690.670–695.610` 显示换行只在 Alignment 移除，OOV `奥/水茄子/今日店/買`                                       | 140 `687.810–690.770` / `687.310–691.270`；141 `689.660–695.640` / `689.160–696.140`；142 `690.170–696.110` / `689.670–696.610` | 140 `692.330–692.760` cov .333 score .667；141 `692.270–694.950` cov .50 score .588；142 `690.710–695.010` cov .25 score .447 | 140 `3/3/0`；141 `2/5/0`；142 `0/4/0` | 三 Cue 一次联合；低 coverage/关键 OOV/无 MFA；原子 gate 失败，整组 0 mutation；1 review item |
| 5         | 145 `701.460–703.340` `ええって歩よ`，OOV `歩`；146 `702.690–705.340` `お 泰蔵 よかったね`，OOV `泰蔵`                                                                                   | 145 `700.960–703.840` / `700.460–704.340`；146 `702.190–705.840` / `701.690–706.340`                                            | 145 `701.820–704.800` cov .667 score .746；146 `702.280–705.430` cov .667 score .683                                          | 145 `1/3/1`；146 `1/3/2`              | 候选彼此高重叠、低 coverage/关键 OOV、无 MFA；unresolved；0 mutation；1 review item          |
| 6         | 163 `772.510–776.310` 显示换行只在 Alignment 移除，OOV `目刺/大`；164 `775.860–777.210` `さかわしい!` → `さかわしい !`，reading `さかわしい`                                             | 163 `772.010–776.810` / `771.510–777.310`；164 `775.360–777.710` / `774.860–778.210`                                            | 163 `772.490–776.070` cov .60 score .543；164 无边界                                                                          | 163 `2/5/1`；164 `1/2/0`              | 方言表面形保留；无稳定 MFA 双窗口；unresolved；0 mutation；1 review item                     |
| 7         | 174 `808.530–811.860` `堪忍`，OOV；175 `809.480–810.560` `罰だぞ。` → `罰だぞ 。`，OOV `罰`；176 `810.090–811.160` `堪忍!` → `堪忍 !`，OOV `堪忍`                                        | 174 `808.030–812.360` / `807.530–812.860`；175 `808.980–811.060` / `808.480–811.560`；176 `809.590–811.660` / `809.090–812.160` | 三 Cue 均无边界                                                                                                               | 174 `0/2/0`；175 `0/2/0`；176 `0/2/0` | 三 Cue 联合；短 Cue/重复 `堪忍` occurrence 不能证明；unresolved；0 mutation；1 review item   |

所有 Cue 还共同带有 `ALIGNMENT_WINDOW_PAIR_INCOMPLETE`、MFA coverage 不可用和 Anti-Forcing disagreement blocker；有 Han OOV 的 Cue 额外带 `CRITICAL_OOV_READING_UNRESOLVED`。这正是没有 MFA Runtime 时的 fail-closed 行为。

## 8. Hash、Parity 与只读验证

- Canonical cue hash：`8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`
- Canonical timing hash：`510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`
- C5.17 presentation cue hash：`9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`
- C5.16.1 presentation cue hash：`9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`；二者完全一致。C5.17 forced-alignment blocker/evidence 只进入审计字段，不污染展示 Cue hash。
- Canonical input semantic hash（去 generatedAt）：`26e3b7ae73fc056273a09918bd541db995ff7a89309964ef30f3197846ddc183`
- Alignment semantic hash（去 generatedAt）：`3ebb06886481ac03e389e08dbf1f071f1138d3ff3e04f29dc26083ea948b049c`
- Component decision hash：`6922b45700694f504de6296f922cb311071e7ad78b1254401d8d46c0c1026914`
- C5.16.1 与 C5.17 `id/text/start/end/style/speaker` 192-Cue 投影 hash 均为 `e8eec956458d9de206f86fd58440f50f3003c2b9d86a75c28b6ef429bebb6769`，`cmp` 完全一致。
- SRT/VTT/ASS serialization round-trip：通过。
- Format semantic parity：通过。
- Canonical parity：通过。
- Presentation parity：通过。
- 源视频回放前后 size、mtime、SHA 完全一致。
- 人工 ASS 回放前后 size、mtime、SHA 完全一致。

## 9. Fresh、Cache、Observe 与 Shareable

### Fresh MFA

未运行。MFA manager/runtime 缺失，所以没有 attempt、per-attempt wall clock、实际 OOV、stable/edge-pinned 统计可报告。

### Cache Replay

未运行。没有 Fresh MFA cache，因此不能声称 32/32 命中或 hash 一致。代码和测试已验证 key 身份字段、输出路径排除、cache hit 不调用 executor，以及跨 fresh/cache 的确定性契约。

### Observe

真实 `evidence-dp` Observe 已运行。Artifact 生成，Canonical timing 0 变更，blocker 关闭数 0，7 个 Component 全部 unresolved。

### Forced-alignment Cache

真实 observe 因 backend 不调用 MFA，manifest 为 entry/hit/miss/process `0/0/0/0`，legacy ASR cache hit 为 0。它与 C5.16 ASR cache 独立。

### Shareable

代码已把 4 个 C5.17 Artifact 加入严格 allowlist，并保留 basename/version/size/hash/license/runtime identity，路径消毒和 secret scan 会 fail closed。真实 C5.17 shareable 没有生成，因为 `forced-alignment-runtime-capability.json` 不存在；生成器明确拒绝无已验证 Runtime 的 C5.17 shareable。因而真实 C5.17 Shareable Audit 标记为“未执行”，不冒充通过。C5.16.1 原有 shareable 回归仍通过完整测试。

## 10. Skill 2 / Skill 3 兼容

- Skill 2 只读仓库：`codex/publish-core-runtime` @ `1af10bd8a7057c573959f39a745436fa837127ea`，运行前后 clean。
- 使用 C5.17 strict v1 `subtitle-package.needs-review.json` 执行真实 Host prepare（不调用模型），成功重建 106 sentences。
- 复制自通过基线且文本/时间完全一致的 `grammar-report.json`：106 sentences / 106 grammar points。
- Skill 3 只读仓库：`codex/publish-core-runtime` @ `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8`，运行前后 clean。
- 使用该 106/106 report 真实构建静态站点成功；生成 `index.html`、hashed JS/CSS、manifest 和 report data。
- Forced Alignment、Reading、Phone、MFA Runtime 字段均只在 sidecar，不进入 strict v1 Cue。

## 11. 测试、Schema 与命令

执行并通过：

```text
npx --yes npm@11.18.0 install
npm run generate:schemas
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
npm run test:e2e
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler
```

结果：

- Node `24.19.0`
- npm `11.18.0`
- TypeScript：通过
- ESLint：通过
- Build：通过（含 Skill 3 template Vite build）
- Prettier：通过
- `npm test`：19 files，320 passed，1 optional real-MFA test skipped
- `npm run test:e2e`：6 files，23 passed，1 optional real-MFA test skipped
- 可选真实测试入口：`MVL_MFA_INTEGRATION_TEST=1`
- JSON Schema：83
- Skill validation：`Skill is valid!`

覆盖范围包括 Canonical/Alignment 分离、newline/tag/punctuation/空白、Sudachi offset、Kanji/Kana/Terminology/OOV/方言、Evidence-DP gap 与确定性、JSON/TextGrid parser fail-closed、window stability/edge pinning、Anti-Forcing、duplicate occurrence、三 Cue joint assignment、原子 rollback、timing gate、observe、runtime/version/model/network probe、explicit-spec raw-byte hash、独立 cache key/hit，以及 Mock finalization。

## 12. 修改文件

- Skill/CLI/package：`.agents/skills/multilingual-video-subtitler/SKILL.md`、`apps/cli/src/index.ts`、`package.json`、`package-lock.json`、`packages/video-subtitler/package.json`
- Shared/Schema：`packages/shared/src/forced-alignment-schemas.ts`、`finalization-schemas.ts`、`overlap-acoustic-resolution-schemas.ts`、`presentation-resolution-schemas.ts`、`shareable-artifact-schemas.ts`、`index.ts`、6 个新增 JSON Schema 和 5 个更新 JSON Schema
- Core：`packages/transcription-core/src/canonical-forced-alignment.ts`、`presentation-resolution.ts`、`index.ts`、`packages/grammar-report-core/src/readings.ts`
- Video finalization：`packages/video-subtitler/src/canonical-forced-alignment.ts`、`forced-alignment-cache.ts`、`mfa-output.ts`、`mfa-runtime.ts`、`sudachi-analysis.ts`、`finalization.ts`、`review.ts`、`shareable-artifacts.ts`、`index.ts`
- Scripts：`prepare-mfa-runtime.ts`、`verify-c5-17-mfa-runtime.ts`、`replay-c5-17-forced-alignment.ts`、`validate-c5-17-runs.ts`、`parse-mfa-output.py`、`sudachi-readings.py`、`generate-schemas.ts`
- Tests：`tests/c5-17-canonical-forced-alignment.test.ts`、`tests/e2e/c5-17-forced-alignment-flow.test.ts`
- 报告：`C5_17_CANONICAL_TRANSCRIPT_FORCED_ALIGNMENT_REPORT.md`

## 13. 依赖 Advisory

`npm audit --json` 真实结果为 5 个 transitive vulnerability：1 moderate、4 high、0 critical。包为 `brace-expansion`、`fast-uri`、`nanoid`、`postcss`、`undici`，均显示 fix available。本轮遵守要求，没有执行 `npm audit fix --force`，也没有为 C5.17 引入这些 advisory 的直接依赖。

## 14. 未解决问题与 C5.18 建议

未解决：

1. 用户需显式安装 micromamba/mamba/conda 之一；之后才能准备隔离 MFA 3.4.2 Runtime。
2. 必须在该环境内完成真实 CLI capability probe、官方模型 inspect/hash、32-attempt Fresh、只读全命中 Cache Replay、MFA Observe、跨运行 validator 和 shareable audit。
3. 在完成上述运行前，7 个 Component / 7 个 review item 必须保留，不能根据本次 DP 候选调轴。
4. 本次 fallback 的 17 个 OOV 不能视为 Sudachi/MFA G2P 的最终 OOV 结果。

C5.18 建议：先完成 C5.17 真实 MFA acceptance 并积累人工确认的 boundary Gold Set，再用该 Gold Set 校准 best-score/margin/coverage 阈值；不要在本轮 Runtime 尚未建立时增加新 backend 或降低 Anti-Forcing 门槛。

## 15. 输出路径

- 主真实 Evidence-DP Observe（含 7 个 review WAV）：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-canonical-transcript-forced-alignment-evidence-dp-observe-20260826`
- 早期无 review-audio 诊断回放：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-17-evidence-dp-observe-20260826`
- Skill 2 临时兼容输出：`/tmp/mvl-c5-17-skill2-compat.w1TiIi`
- Skill 3 临时兼容输出：`/tmp/mvl-c5-17-skill3-compat.5IioPP`
- MFA Fresh/Cache/Observe/Shareable 输出：未生成。
