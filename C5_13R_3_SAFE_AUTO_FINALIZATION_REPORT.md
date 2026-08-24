# C5.13R.3 Safe Auto Finalization 开发报告

- 版本：**C5.13R.3 — Safe Auto Finalization, Review Fallback & Feedback Loop**
- 开发分支：`codex/c5-13r-3-safe-auto-finalization`
- 基线：`agent/publish-core-runtime` @ `04f6aa27280043dd53e29937277221b4d8ec06e7`
- 运行环境：Node.js `v24.18.0`、npm `11.18.0`、macOS
- 日期：2026-08-24

## 1. 原问题根因

旧运行时把候选仲裁、winner 去重、残句修复、时间修复、日文词形规范化、文本完整性修复、重复修复、分句和最终字幕修复串成多个可修改 cue 的阶段。每个阶段本身有局部规则，但不存在“先聚合全部候选，再为每个 cue 只作一次最终决定”的统一边界。因此，后续阶段可能在不知道前一阶段完整证据的情况下再次改变同一 cue，形成结构性的 last-writer-wins 风险。

C5.13R.2.1 人工复核进一步证明：`BROAD_WINDOW_ASSOCIATION` 只表示宽窗口中存在词汇关联，并不能证明候选属于目标 cue。宽窗口候选如果先写入 machine-review draft，再用 `requiresHumanReview` 标注，实际已经发生了不可接受的“先改正文、后提示复核”。

旧系统还只有 `final-review-queue.json` 导出，没有正式的 resolutions 导入、stale hash 校验、确定性 cue ID、统一的人机终稿命名或 correction feedback 闭环。

## 2. 旧自动改写路径

调查到的生成路径为：

```text
resolveCompetingHypotheses
→ deduplicateTopScoreWinners
→ repairTopScoreFragments
→ repairTopScoreWinnerTiming
→ normalizeJapaneseLexicalForm
→ post-normalization deduplication
→ segmentation
→ text-integrity repair
→ intra-cue repetition repair
→ final-subtitle repair
→ presentation
→ final integrity
→ SRT/VTT/ASS serialization
```

其中 winner/timing/text repair/normalization/deduplication/segmentation/final repair 都可能改变文本或 cue 结构；时间修复主要改变时间轴；presentation 应只做显示规范化，但旧架构没有一个统一终稿器来证明 suggestion-only 候选没有通过后续阶段间接进入正文。

## 3. 新工作流

新增的通用工作流为：

```text
machine subtitle-package.json
→ project to strict v1 cues
→ load generic or legacy candidate evidence
→ merge equivalent candidates and independent evidence
→ one deterministic CueDecision per overlapping cue group
→ mutation safety gate
→ apply eligible automatic decision once
→ final integrity + SRT/VTT/ASS round trip + semantic parity
→ pass: unified .final.* + subtitle-package.final.json
→ fail: .best-effort.* + subtitle-package.needs-review.json
→ optional review fallback
→ hash-checked human resolutions
→ same final quality gate
→ unified .final.* + correction-feedback.json
```

原机器草稿不覆盖；新终稿器是下游独立阶段，因此也可对旧任务做无需 ASR 的离线 replay。

## 4. 自动终稿与审核回退

- `auto`：尝试自动终稿；失败时只写 best-effort 与诊断，不强制创建审核页面。
- `review-fallback`（默认）：先尝试自动终稿；只有失败时生成 review package、静态页面和本地音频。
- `human`：始终生成审核包，用于严格校对或 Gold Set；没有 resolutions 时不能标记 validated。

人工审核不是生产必经步骤。自动证据充足且所有质量门为零阻塞时，人工决定数量保持 `0`，直接输出 `auto-validated`。

## 5. 修改文件清单

核心实现：

- `packages/shared/src/finalization-schemas.ts`
- `packages/transcription-core/src/finalization.ts`
- `packages/video-subtitler/src/finalization-support.ts`
- `packages/video-subtitler/src/finalization.ts`
- `packages/video-subtitler/src/review.ts`
- `packages/video-subtitler/src/burn.ts`
- `packages/video-subtitler/src/workflow.ts`
- `apps/cli/src/index.ts`
- 各 package `src/index.ts` 导出

契约和文档：

- `scripts/generate-schemas.ts`
- `schemas/subtitle-finalization-report.schema.json`
- `schemas/subtitle-review-package.schema.json`
- `schemas/human-review-resolutions.schema.json`
- `schemas/correction-feedback.schema.json`
- `.agents/skills/multilingual-video-subtitler/SKILL.md`
- `.agents/skills/multilingual-video-subtitler/scripts/run.mjs`
- `.agents/skills/multilingual-video-subtitler/agents/openai.yaml`
- `README.md`
- `package.json`

测试：

- `tests/finalization-safety.test.ts`
- `tests/finalization-human.test.ts`
- `tests/e2e/finalization-flow.test.ts`

## 6. 新增 Schema

Zod 是唯一类型源，`npm run generate:schemas` 生成 69 份 JSON Schema，其中本轮新增 4 份：

1. `subtitle-finalization-report.schema.json`
2. `subtitle-review-package.schema.json`
3. `human-review-resolutions.schema.json`
4. `correction-feedback.schema.json`

共享对象均为 strict object。现有 `subtitle-package.schema.json` 和 `SubtitleCue` v1 未增加任何 finalization 字段。

## 7. 自动文本修改门

集中阈值位于 `DEFAULT_FINALIZATION_THRESHOLDS`：

| 指标                      |      阈值 |
| ------------------------- | --------: |
| association score         | `>= 0.82` |
| association margin        | `>= 0.12` |
| independent requests      |    `>= 2` |
| existing cue preservation | `>= 0.85` |
| candidate coverage        | `>= 0.90` |
| content omission          | `<= 0.15` |
| content addition          | `<= 0.15` |
| neighbor intrusion        | `<= 0.05` |
| local speech coverage     | `>= 0.80` |

这些值是保守的自动写入阈值，不是模型准确率声明。它们选择了“宁可送审，不错误截短完整句”的方向，并由单元测试固定。未来应使用 Gold Set 校准，而不是为提高自动率直接放宽。

`BROAD_WINDOW_ASSOCIATION`、`AMBIGUOUS_ASSOCIATION`、`UNASSOCIATED`、局部区间缺失、直接声学支持缺失、partial fragment、timing unresolved、独立 request 不足、语言/幻觉/重复/presentation QA 失败都强制 suggestion-only。

严格子串会同时记录：

```text
STRICT_SUBSTRING_REPLACEMENT_BLOCKED
CONTENT_OMISSION_RISK
INCOMPLETE_SEMANTIC_COVERAGE
```

覆盖率使用字符级 LCS 与本地区间证据，明确写 `coverageMethod: heuristic`、`semanticSimilarity: null`；没有伪造跨语言语义分数。

## 8. 每 cue 单一机器决策

候选先按标准化文本、区间、目标 cue、association type 和 action 合并。等价候选的 request/profile/evidence 去重合并，同一 request 的重复副本只计一次独立支持。随后构建目标 cue 有交集的连通组，每组只输出一个 `CueDecision`。

排序依次考虑：可自动执行、定位强度、score、margin、独立支持、保留率和稳定 candidate ID。输入顺序改变不会改变 winner。其他候选和等价别名保存在 `alternativeCandidateIds`。如果多个互斥 proposal 争用 cue，统一决定降为 `REVIEW_ONLY` 并记录 `MULTI_DECISION_CONFLICT`，不存在逐次覆盖。

## 9. 自动质量门

质量门在最终 machine/human decision 之后执行：

1. cue 非负、正时长、顺序正确且不越界；
2. 无非法重叠与未解决相邻重复；
3. 最多两行、每行最多 16 Unicode code point；
4. SRT、VTT、ASS 都能重新解析；
5. 三种格式 cue 数、可见文本和允许精度内的时间一致；
6. 无 unresolved mandatory review、unsafe mutation、multi-decision、substring violation；
7. 原视频在运行前后 size、mtime、SHA-256 不变。

如果自动词汇修改后质量门失败，词汇修改会被回滚为 `REVIEW_ONLY`，记录 `AUTO_MUTATION_ROLLED_BACK`，再对保守输出重新运行质量门。

## 10. Blocking 与 warning

Blocking 示例：弱定位 candidate、base package needs review、非法时间、越界、非法 overlap、重复、格式回读失败、格式语义不一致、stale resolution、源视频变化。

Warning 示例：artifact-only 模式无法重新读取源视频时记录 `SOURCE_MEDIA_UNAVAILABLE_FOR_READ_ONLY_VERIFICATION`。这不会伪装成已经验证源视频，只表明终稿文本门仍可离线运行。

`subtitle-finalization-report.json` 分别保存 blocking/warning findings 和 code 列表。

## 11. Review package 格式

`subtitle-review-package.json` 保存：版本、生成策略、源 fingerprint、base package/cue/evidence hash、review items 和汇总。每个 item 包含当前/前后 cue、唯一机器决定、所有候选、定位、覆盖率、证据、blocker、允许操作和相对音频路径。

本地页面位于 `review/index.html`，不使用外部 API、数据库、API key 或后端。页面支持窄屏、音频播放/循环、前后项，以及 space、`l`、方向键、`a`、`k`、`u` 快捷键。浏览器只下载 JSON，不尝试写本地文件。

音频使用 FFmpeg argument array、`shell: false`，默认前后各 1.5 秒，单项上限 30 秒，16 kHz mono PCM WAV。单项失败只写 `audioError`，不终止整个审核包。

## 12. Resolutions 格式

支持：`KEEP`、`ACCEPT_SUGGESTION`、`EDIT_TEXT`、`REJECT_SUGGESTION`、`SPLIT_CUE`、`MERGE_CUES`、`EDIT_TIMING`、`DELETE_CUE`、`MARK_UNRESOLVED`。

- ACCEPT 必须引用 review package 中现存 candidate ID。
- EDIT_TEXT 必须非空。
- SPLIT 至少两段，按序、不重叠、不得离开审核区间。
- MERGE 只允许当前 cue 序列中相邻且未被其他操作占用的 cue。
- DELETE 必须有 reviewer notes。
- MARK_UNRESOLVED 保持阻塞。

Split/Merge cue ID 来自 base cue hash、review ID、action、part/cue 序列的 SHA-256 前缀，不使用随机 UUID。

## 13. Correction feedback 格式

只有实际改变文本、时间或 cue 结构的人工操作才生成 feedback。记录 media identity、局部音频区间、machine/corrected text、机器决定、被选/备选候选、合法 error types、reading/terminology/dialect hints、证据和 notes。

`feedbackId` 由 source fingerprint 与 resolution 确定性生成；重复导入不会制造不同 ID。共享 JSON 不包含绝对路径。代码没有把 feedback 自动应用到其他视频、没有全局字符串替换，也没有把它用作 Whisper target sentence。

## 14. Stale review 检测

导入前逐项比对：

```text
reviewVersion
inputEvidenceHash
baseSubtitlePackageHash
baseCueHash
sourceFingerprint
reviewId
candidateId
cueId
decision uniqueness
action conflicts
```

任何不一致立即抛出 `InputError`，无跳过 hash 的危险开关。`--dry-run` 执行相同验证和终稿计算，但不写 final artifacts。

## 15. 自动终稿条件

仅当 blocking finding、unresolved、unsafe mutation、multi-decision、substring violation、format parity error 均为 0，且 final integrity、serialization round-trip、format semantic parity 均通过时，状态才是：

```text
status: auto-validated
finalizationMethod: automatic
humanDecisionCount: 0
```

输出统一 `.final.srt/.vtt/.ass` 和 `subtitle-package.final.json`。

## 16. 人工或混合终稿条件

所有 mandatory items 被有效 resolutions 解决后，human cues 回到同一质量门。没有自动修改时为 `human-validated/human`；同时含安全自动决定和人工决定时为 `mixed-validated/mixed`。两者使用与自动终稿相同的 `.final.*` 公共文件名。

## 17. Skill 2 v1 兼容证明

Skill 2 只读 checkout：`codex/publish-core-runtime`。检查结果：

- `packages/shared/src/schemas.ts` 与 Skill 1 对应文件 `cmp` 完全相同；
- `packages/grammar-report-core/src/input.ts` 与 Skill 1 对应文件 `cmp` 完全相同；
- 本轮没有修改旧 `subtitlePackageSchema`；
- 聚焦 E2E 用严格 Zod schema 解析 final package，并调用相同输入模块重建句子；
- 真实 `subtitle-package.needs-review.json` 经实际 `npm run grammar-report -- --analysis-provider mock` 成功读取，152 cues 重建为 118 sentences。

Skill 2 和 Skill 3 checkout 的 `git status` 均保持 clean；没有安装、编辑或提交任何文件。

## 18. CLI 示例

```bash
# 新视频，默认自动优先 + 审核回退
npm run subtitle -- --input "/path/video.mkv" --finalization review-fallback

# 旧任务，无需重跑 ASR
npm run subtitle-finalize -- --task "/path/task" --finalization auto

# 显式审核
npm run subtitle-review -- --task "/path/task"

# 人工修订预检
npm run subtitle-finalize -- --task "/path/task" \
  --resolutions "/path/human-review-resolutions.json" --dry-run

# Skill wrapper 等价入口
node .agents/skills/multilingual-video-subtitler/scripts/run.mjs finalize \
  --task "/path/task" --finalization review-fallback
```

CLI JSON 汇总包含 machine/automatic/safe mutation/suggestion/blocking/unresolved/review/human/final cue counts、method、status 和路径。

## 19. 单元测试结果

实际命令：

```bash
PATH=<Node-24>/bin:$PATH npx --yes npm@11.18.0 test
```

结果：3 个测试文件、33 个测试，全部通过。覆盖弱定位、局部区间缺失、partial/substring、neighbor intrusion、独立 request 去重、timing-only、完全重复、单一决策、顺序稳定、stale hash、各人工 action、确定性 ID、feedback、完整性 finding 审核物化和 burn 拒绝。

## 20. 集成测试结果

实际命令：

```bash
PATH=<Node-24>/bin:$PATH npx --yes npm@11.18.0 run test:e2e
```

结果：1 个 E2E 文件、7 个测试，全部通过。完整覆盖 machine package → auto final、best-effort、review fallback、完整性 finding → review decision、human mode、burn guard、human correction → unified final → Skill 2 input，以及重复运行 output hash 一致。

## 21. Fixture 回归结果

合成 fixture 验证：

- 自动通过生成 `auto-validated`，人工决定 0；
- 一个 Broad Window blocker 即生成 needs-review，正文不变；
- `auto` 不生成 review page；
- `review-fallback` 生成 strict review package；
- `human` 始终生成 review；
- 人工 EDIT_TEXT 后生成 `human-validated` unified final；
- 相同输入重复运行 cue/output hash 相同；
- 草稿文件内容保持不变；
- SRT/VTT/ASS 全部重新解析且 cue 数一致。

## 22. 真实素材/离线 replay

使用已有 C5.13R.2.1 artifact 和用户本地《カーネーション》第 1 集视频；没有重新运行 ASR、没有访问字幕网站、没有调用模型或 API。

输入：152 cues、124 legacy contradiction candidates。按 target cue 聚合后形成 45 个候选审核决策；终稿完整性门禁又将相邻重复问题物化为审核决策，最终共有 46 个 suggestion-only 决策，覆盖 49 个唯一 cue。

| 指标                                  |                      实际值 |
| ------------------------------------- | --------------------------: |
| BROAD_WINDOW_ASSOCIATION 自动可见修改 |                           0 |
| AMBIGUOUS_ASSOCIATION 自动可见修改    |                           0 |
| LOCAL_INTERVAL_MISSING 自动可见修改   |                           0 |
| 完整 cue 被片段替换                   |                           0 |
| 每 cue 多重最终决策                   |                           0 |
| 自动解决 cue                          |                           0 |
| suggestion-only                       |                          46 |
| blocking findings                     |                          49 |
| auto-validated                        | 否，诚实输出 `needs-review` |
| 最终 cue                              |                         152 |
| format parity errors                  |                           0 |
| review audio                          |             46 成功、0 失败 |

额外 3 个 blocking findings 是旧字幕中仍存在的相邻重复，另有 1 个全局 `BASE_PACKAGE_NEEDS_REVIEW`。原草稿 package 与 replay 副本 `cmp` 相同；核心 `{id,start,end,text,style,speaker}` 哈希在 draft/best-effort 间完全相同，文本变化数为 0。

## 23. 自动率与审核率指标

真实 replay：

- `automaticCueRate = 0`；
- `manualReviewCueRate = 49 / 152 = 0.3223684211`；
- `unsafeMutationCount = 0`；
- `characterCorrectionRate = 0`；
- `timingCorrectionRate = 0`；
- `formatParityErrorCount = 0`。

这是旧 evidence 以 Broad Window/缺局部区间为主的结果，不代表未来一般素材的自动率，也不声称达到 95%/98% 长期目标。门禁没有为展示自动终稿而降低。

## 24. 未完成、失败或跳过项

- 没有新增 ASR 模型、音素强制对齐、说话人分离、模型训练或 LLM 自由改写；这是明确的本轮非目标。
- 真实 replay 没有人工提交 46 项 resolutions，因此没有伪造 human-validated 真实终稿，也没有烧录 needs-review 字幕。
- npm install 报告 5 个既有依赖审计项（1 moderate、4 high）。未运行破坏性 `npm audit fix`；依赖审计升级不属于本轮，且全部功能门禁通过。
- 最初两个一次性 `tsx -e` 兼容探针分别因 CJS top-level await 和 workspace package export 方式失败；随后改用实际 `grammar-report` CLI 完成同一输入路径验证并成功。产品测试没有跳过。
- artifact-only 模式没有源视频时只能记录不可验证 warning；带显式源视频的真实 replay 已完整验证只读性。

## 25. C5.14/C5.15 建议

1. 建立人工纠错 Gold Set，按定位类型、场景、方言和错误类别校准当前保守阈值。
2. 增加 token/phoneme 局部对齐器，使更多 `PROBABLE_TARGET` 获得直接声学支持。
3. 引入剧集级、source-fingerprint-scoped 的角色名/术语记忆，只作为候选证据，不做全局替换。
4. 增加第二独立 ASR backend，提升独立支持，而不是复制同一 request。
5. 为 simultaneous speech 增加显式可接受 overlap 分类，避免把合法双说话人显示与非法 overlap 混为一类。
6. 用 correction feedback 建立离线阈值评估和回归 dashboard，但不自动污染生产字幕。

## 26. 源视频只读验证

真实视频运行前后：

```text
size:   847,774,958 bytes
mtime:  1784692412 (stat seconds)
SHA-256: 294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43
sourceReadOnlyVerified: true
```

FFmpeg 只用 `-i` 读取源视频；审核 WAV 写入任务目录。外部命令由 `NodeProcessRunner` 使用 `spawn(executable, args)`、`shell: false`。源视频没有被覆盖，且 finalizer 在 review 音频生成后再次验证 fingerprint；若变化则拒绝写 validated output。

## 27. 验证命令与输出路径

实际执行并通过：

```text
npx --yes npm@11.18.0 install
  → Node 24.18.0 / npm 11.18.0，198 packages audited
npm run generate:schemas
  → 69 schemas
npm run typecheck
  → passed
npm run lint
  → passed
npm run build
  → tsc + Vite passed，21 modules transformed
npm run format:check
  → all matched
npm test
  → 3 files, 33 tests passed
npm run test:e2e
  → 1 file, 7 tests passed
python3 <skill-creator>/scripts/quick_validate.py <skill>
  → Skill is valid!
```

真实 replay 根目录：

```text
/Users/paulasmith/Documents/Codex-Skills/output/
  carnation-reference-guided-c5-13r-3-safe-auto-finalization-20260824/
```

其中包括：

```text
subtitle-<stem>.best-effort.srt
subtitle-<stem>.best-effort.vtt
subtitle-<stem>.best-effort.ass
subtitle-package.needs-review.json
subtitle-finalization-report.json
subtitle-review-package.json
review/index.html
review/data/subtitle-review-package.json
review/assets/review.css
review/assets/review.js
audio/review/*.wav (46)
offline-replay-summary.json
```

开发报告：`C5_13R_3_SAFE_AUTO_FINALIZATION_REPORT.md`。
