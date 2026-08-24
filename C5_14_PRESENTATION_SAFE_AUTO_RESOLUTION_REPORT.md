# C5.14 Presentation-Safe Auto Resolution 开发报告

日期：2026-08-25

实现分支：`codex/c5-14-presentation-safe-auto-resolution`

基线分支：`codex/c5-13r-3-safe-auto-finalization`
基线 commit：`c23f5169700acd9c5f4aed9173fe22b0c8c6d9fd`

## 1. 结论

C5.14 已把 canonical cue 与 presentation serialization 分离，并在不重新运行 ASR、不导入旧机器候选、不修改人工 ASS、不修改源视频、不调用模型/API 的条件下完成真实离线回放。

真实结果：

- 192 条输入 canonical cue，192 条输出 canonical cue。
- canonical text mutation：0。
- canonical timing mutation：0。
- presentation-created temporal cue：0。
- 21/21 个长行由 display-only layout 解决，blocking layout：0。
- 5/5 组相邻真实重复分类为 `separate-utterance-repetition`，全部保留，blocking repetition：0。
- 9 条相邻 overlap finding 构成 7 个 graph component；7 组均缺少 speaker/token/speech/source/scene 的局部证据，因此保持 `unresolved`。
- review item：33 → 7；review audio：33 → 7，且 0 个音频生成失败。
- 最终状态诚实保持 `needs-review` / `finalizationMethod: none`，未伪装成 validated。
- strict Skill 2 v1 package 仍重建为 106 sentences / 106 grammar points，覆盖全部 192 个 cue ID。

## 2. C5.13R.3 问题根因

1. `SubtitleCue.text` 同时被当作 canonical text 和 display text。质量门直接检查 canonical 中的行数/每行字符数，导致 21 条词汇和时间均正确的人工 cue 因缺少视觉换行而 blocking。
2. 相邻重复检测只比较规范化后的文本是否相同，没有区分相同时间副本与不同时间的真实再次发声，导致 5 组人工确认重复被误报。
3. overlap 质量门逐条产生 finding，没有统一关系证据与 connected-component 决策；3-cue 链会产生多个可能冲突的审核动作。
4. 旧 `automaticCueRate = 1 - manualReviewCueRate` 实际表示未进入 review 的比例，不是自动解决率。

## 3. Canonical / Presentation 分离

`subtitle-package.needs-review.json` 继续只保存 strict v1 canonical cues。新增 `subtitle-presentation-resolution.json` 保存：

- display-only text 与 lexical hash；
- layout method、行数、每行可见字符数；
- repetition relationship 与 preserve/delete/review 建议；
- overlap graph component、证据、关系、动作与可选 timing mutation；
- ASS event override 与 VTT cue setting；
- canonical/presentation cue hash 与汇总指标。

序列化接口保持旧调用兼容，同时允许：

```ts
formatSrt(cues, { displayTextByCueId });
formatVtt(cues, { displayTextByCueId, cueSettingsByCueId });
formatAss(cues, { displayTextByCueId, eventOverridesByCueId });
```

真实 hash：

```text
baseCueHash       8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83
canonicalCueHash  8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83
presentationHash  9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de
```

`baseCueHash === canonicalCueHash`，证明本次人工基线 canonical text/timing 未改变。presentation hash 独立变化，仅表示 display override。

## 4. 修改文件清单

文档与入口：

- `.agents/skills/multilingual-video-subtitler/SKILL.md`
- `README.md`
- `apps/cli/src/index.ts`
- `package.json`

共享 contract 与 Schema：

- `packages/shared/src/presentation-resolution-schemas.ts`（新增）
- `packages/shared/src/finalization-schemas.ts`
- `packages/shared/src/index.ts`
- `schemas/subtitle-presentation-resolution.schema.json`（新增生成物）
- `schemas/subtitle-finalization-report.schema.json`
- `scripts/generate-schemas.ts`

字幕与决策核心：

- `packages/subtitle-core/src/layout.ts`
- `packages/subtitle-core/src/format.ts`
- `packages/transcription-core/src/presentation-resolution.ts`（新增）
- `packages/transcription-core/src/repetition-classification.ts`（新增）
- `packages/transcription-core/src/overlap-classification.ts`（新增）
- `packages/transcription-core/src/final-subtitle-repair.ts`
- `packages/transcription-core/src/index.ts`
- `packages/video-subtitler/src/finalization-metrics.ts`（新增）
- `packages/video-subtitler/src/finalization-support.ts`
- `packages/video-subtitler/src/finalization.ts`
- `packages/video-subtitler/src/index.ts`

离线回放与构建：

- `scripts/replay-c5-14-presentation.ts`（新增）
- `scripts/tsconfig.json`

测试：

- `tests/presentation-resolution.test.ts`（新增）
- `tests/repetition-classification.test.ts`（新增）
- `tests/overlap-classification.test.ts`（新增）
- `tests/finalization-metrics.test.ts`（新增）
- `tests/e2e/c5-14-human-baseline-flow.test.ts`（新增）
- `tests/e2e/finalization-flow.test.ts`

本报告：

- `C5_14_PRESENTATION_SAFE_AUTO_RESOLUTION_REPORT.md`

## 5. Schema 变化

新增一个长期公共 artifact，而不是创建大量版本化公共 Schema：

```text
subtitle-presentation-resolution.json
resolutionVersion: C5.14
```

其 Zod Schema 使用 `.strict()`，确定性 ID/hash，不包含绝对路径；生成的 JSON Schema 使用 draft 2020-12。`subtitle-finalization-report` 增加 presentation pointer、canonical/presentation parity、SRT overlap warning 及新指标，并为 C5.13R.3 旧报告提供默认值。生成后 Schema 总数为 70。

真实 sidecar 同时通过：

- strict Zod parse；
- 生成的 `subtitle-presentation-resolution.schema.json`（AJV 2020）验证；
- 绝对路径递归扫描：0。

## 6. Display layout 算法

算法只计算 display text，不修改 cue text/start/end/count：

1. 排除 ASS override / HTML markup 后计算每行可见字符；空格与 `♪` 计入容量。
2. 已合法的 1～2 行保持不变。
3. 只在总容量不超过 `2 × 16` 时寻找安全边界。
4. 优先已有空白、标点、助词/语义边界；多个显式空白边界优先更均衡者。
5. 使用 `analyzeJapaneseBoundary` 拒绝高置信词中切分，并执行日文禁则行首/行尾检查。
6. Music 不允许把单独的 `♪` 隔离成一行；chant 按完整重复喊声单元断行。
7. 超容量或无安全边界时保持 `unresolved`，不创建 temporal cue，不使用 character-ratio timing。
8. 唯一的两行人工稿微调只删除允许的 display whitespace；canonical text 与 lexical hash 不变。

## 7. 21 个长行逐项结果

所有项目均为 `resolved=true`、`blocking=false`、canonical/display lexical hash 相等；表中 `↵` 仅表示 display newline。

|   # | Cue                                | Canonical → Display                                                                           | 每行字符 | Method                            |
| --: | ---------------------------------- | --------------------------------------------------------------------------------------------- | -------: | --------------------------------- |
|   1 | `human-reviewed-0048-cc0cdaaba4c7` | `♪ 私が今本当に欲しいものなど ♪` → `♪ 私が今本当に↵欲しいものなど ♪`                          |      8/9 | music-decoration-aware-line-break |
|   2 | `human-reviewed-0050-d3b3858f6106` | `断じりは岸和田の年に一度のお祭りで` → `断じりは岸和田の↵年に一度のお祭りで`                  |      8/9 | particle-boundary-line-break      |
|   3 | `human-reviewed-0051-f74f6a946508` | `その日はみんな朝から 大忙しです。` → `その日はみんな朝から↵大忙しです。`                     |     10/6 | particle-boundary-line-break      |
|   4 | `human-reviewed-0068-15efe78fc868` | `なんも手使へんよって 来てしもたんやし` → `なんも手使へんよって↵来てしもたんやし`             |     10/8 | particle-boundary-line-break      |
|   5 | `human-reviewed-0069-15f10c2d3ae0` | `だよ!泰蔵ちゃん あんじょう出て行ったけ?` → `だよ!泰蔵ちゃん↵あんじょう出て行ったけ?`         |     8/12 | semantic-balanced-line-break      |
|   6 | `human-reviewed-0072-a4fc8767def7` | `今年初めて 大屋根で大工方をやります` → `今年初めて↵大屋根で大工方をやります`                 |     5/12 | semantic-balanced-line-break      |
|   7 | `human-reviewed-0105-1d8c3e505564` | `来た お母ちゃん だんじりや来てね` → `来た お母ちゃん↵だんじりや来てね`                       |      8/8 | semantic-balanced-line-break      |
|   8 | `human-reviewed-0106-07acbd969d23` | `あ あ あ あ あ 来た!どうでしょう?` → `あ あ あ あ あ↵来た!どうでしょう?`                     |     9/10 | semantic-balanced-line-break      |
|   9 | `human-reviewed-0110-e8a0979dade6` | `ソーリャ!` × 4 → 2 units + `↵` + 2 units                                                     |    10/10 | chant-unit-line-break             |
|  10 | `human-reviewed-0112-ef0c56916561` | `ソーリャ!` × 4 → 2 units + `↵` + 2 units                                                     |    10/10 | chant-unit-line-break             |
|  11 | `human-reviewed-0117-2b587f9f0fb3` | `ソーリャ!` × 4 → 2 units + `↵` + 2 units                                                     |    10/10 | chant-unit-line-break             |
|  12 | `human-reviewed-0129-26eeef9ee766` | `あほか!女は大工当たりなんかされるか!` → `あほか!↵女は大工当たりなんかされるか!`              |     4/15 | natural-punctuation-line-break    |
|  13 | `human-reviewed-0134-b07a32cded4c` | `女の子やからって 乗らせてもらえませんでした` → `女の子やからって↵乗らせてもらえませんでした` |     8/13 | particle-boundary-line-break      |
|  14 | `human-reviewed-0147-1d932a180d12` | `気ぃつけて 気ぃつけて 気ぃつけてー` → `気ぃつけて 気ぃつけて↵気ぃつけてー`                   |     11/6 | semantic-balanced-line-break      |
|  15 | `human-reviewed-0148-26080392ea6c` | `おおきに　お手をかけました おおきに` → `おおきに↵お手をかけました おおきに`                  |     4/13 | particle-boundary-line-break      |
|  16 | `human-reviewed-0150-e1ee2daf4e60` | `あんたに うちがおんぶされんとあかんねん` → `あんたに↵うちがおんぶされんとあかんねん`         |     4/15 | particle-boundary-line-break      |
|  17 | `human-reviewed-0158-2c59d0d7c122` | `お父ちゃんはいつもの呉服屋に戻ります` → `お父ちゃんはいつもの↵呉服屋に戻ります`              |     10/8 | particle-boundary-line-break      |
|  18 | `human-reviewed-0159-64faec1eba5c` | `お婆ちゃんもごちそうをこさえません` → `お婆ちゃんも↵ごちそうをこさえません`                  |     6/11 | particle-boundary-line-break      |
|  19 | `human-reviewed-0167-2f9e8f8ed792` | `こんなとこ ちょろっと開けてんのは` → `こんなとこ↵ちょろっと開けてんのは`                     |     5/11 | semantic-balanced-line-break      |
|  20 | `human-reviewed-0172-9ab9adccfc24` | 保留人工语义换行，仅 display-only 压缩 `お前 こら` → `お前こら`                               |    16/15 | semantic-balanced-line-break      |
|  21 | `human-reviewed-0183-8af10bbcbb2d` | `このカエルいじめたら うちが承知せえへんで` → `このカエルいじめたら↵うちが承知せえへんで`     |    10/10 | semantic-balanced-line-break      |

最终：`FINAL_LINE_EXCEEDS_CHARACTER_LIMIT=0`、`FINAL_CUE_EXCEEDS_TWO_LINES=0`、display lexical mismatch=0。

## 8. Repetition 分类模型

通用关系包括：

```text
confirmed-intentional-repetition
likely-intentional-repetition
call-and-response
crowd-chant
separate-utterance-repetition
duplicate-cue
same-utterance-alternative
unresolved
```

人工权威基线中，只有不同 cue、不同边界、无时间重叠、无共享 source request 的相同文本，才可作为 `separate-utterance-repetition` 保留。机器字幕仍需独立 token/speech/source/speaker/scene 证据；相同文本本身不够。相同边界或 90% 以上重叠的机器副本仍交给既有安全去重路径。

## 9. 当前 5 个重复组

|   # | 文本                |        左区间 |        右区间 |   Gap | 分类 / 动作                                                  |
| --: | ------------------- | ------------: | ------------: | ----: | ------------------------------------------------------------ |
|   1 | `今日…`             |   39.40–40.88 |   41.66–43.11 | 0.78s | separate-utterance-repetition / preserve-both / non-blocking |
|   2 | `いってらっしゃい!` |   77.59–79.09 |   79.09–80.68 | 0.00s | separate-utterance-repetition / preserve-both / non-blocking |
|   3 | `おはようさん。`    | 291.58–292.54 | 292.54–294.04 | 0.00s | separate-utterance-repetition / preserve-both / non-blocking |
|   4 | `待てー!`           | 825.96–827.39 | 828.89–830.09 | 1.50s | separate-utterance-repetition / preserve-both / non-blocking |
|   5 | `待てー!`           | 843.24–844.84 | 845.81–847.20 | 0.97s | separate-utterance-repetition / preserve-both / non-blocking |

删除数=0，文本修改数=0，时间修改数=0，blocking repetition=0。

## 10. Overlap graph

图边来自最终质量门的 9 条相邻 overlap finding，cue 为 node；使用确定性 union/find 得到 connected components。两组三 cue 链各有两条边，因此 9 条边最终形成 7 个 component。每个 component 只产生一个 `OverlapDecision` 和一个 review item，避免对同一组生成互斥动作。

## 11. Overlap 关系与证据要求

支持：exact duplicate、near duplicate、same-utterance alternative、complementary fragments、rapid turn-taking、true simultaneous speech、crowd call + dialogue、different-dialogue boundary error、legal authoritative overlap、unresolved。

- simultaneous/legal overlap 必须有不同 speaker/ASS Name/Layer、独立局部 speech/token 或明确 authoritative structure。
- crowd call + dialogue 还需通用重复喊声结构与 crowd/chant scene/provenance。
- balanced rapid-turn 受 `0.18s` 与 overlap ratio `0.15` 的集中阈值限制。
- boundary repair 必须有 token/speech/VAD/source boundary，单 cue 最大调整 `0.5s`，修复后最短时长 `0.25s`。
- 没有上述证据时保持 unresolved；人工 authority 本身不等于 simultaneous-speech 证据。
- `selectTrustedOverlapBoundary` 没有 midpoint fallback。

## 12. 当前 7 个 overlap groups 与全部 before/after 时间

本次七组只有 `same-ass-layer:0`，没有不同 speaker/Name/Layer、token boundary、speech boundary、source request 或 scene evidence。因此全部保持 unresolved；所有 after 时间等于 before。

| Group | Cue 文本                                                                | Before → After                                             | Finding edges | 结果                           |
| ----: | ----------------------------------------------------------------------- | ---------------------------------------------------------- | ------------: | ------------------------------ |
|     1 | #19 `糸子 おはよう`; #20 `おはよう`                                     | 59.14–60.40 → 59.14–60.40; 60.30–60.88 → 60.30–60.88       |             1 | unresolved / blocking / review |
|     2 | #88 `ソーリャ! ソーリャ!`; #89 `あ 来ない早き`                          | 402.05–410.37 → 同; 403.75–407.55 → 同                     |             1 | unresolved / blocking / review |
|     3 | #97 `あきまへんって。`; #98 `アホか!調子乗んな!`                        | 436.04–439.00 → 同; 438.73–440.85 → 同                     |             1 | unresolved / blocking / review |
|     4 | #140 `うまいわ この水茄子`; #141 `上手につけたらいいよ`; #142 `奥さん…` | 688.31–690.27 → 同; 690.16–695.14 → 同; 690.67–695.61 → 同 |             2 | unresolved / blocking / review |
|     5 | #145 `ええって歩よ`; #146 `お 泰蔵 よかったね`                          | 701.46–703.34 → 同; 702.69–705.34 → 同                     |             1 | unresolved / blocking / review |
|     6 | #163 `うちの目刺しもっと…`; #164 `さかわしい!`                          | 772.51–776.31 → 同; 775.86–777.21 → 同                     |             1 | unresolved / blocking / review |
|     7 | #174 `堪忍`; #175 `罰だぞ。`; #176 `堪忍!`                              | 808.53–811.86 → 同; 809.48–810.56 → 同; 810.09–811.16 → 同 |             2 | unresolved / blocking / review |

关系计数：

| Relationship                | Count |
| --------------------------- | ----: |
| exact duplicate             |     0 |
| near duplicate              |     0 |
| same utterance alternative  |     0 |
| complementary fragments     |     0 |
| rapid turn-taking           |     0 |
| true simultaneous speech    |     0 |
| crowd call + dialogue       |     0 |
| boundary error              |     0 |
| legal authoritative overlap |     0 |
| unresolved                  |     7 |

## 13. Timing-only repair

未执行。`timingMutationCount=0`，七组 `timingMutations=[]`。原因是人工 ASS 没有可局部化到对应 cue 的 token/speech/VAD/source boundary。系统没有使用 overlap midpoint，也没有为了消除数字而移动时间。

## 14. Canonical 与 presentation 验证

- 人工 ASS cue count：192；final package cue count：192。
- 人工 ASS 与 final package 按序逐条 text/start/end 完全相等。
- canonical text mutation：0；canonical timing mutation：0。
- presentation-created temporal cue：0。
- display lexical mismatch：0。
- SRT/VTT/ASS 各解析出 192 cue。
- 三格式 timing parity、canonical lexical parity、display parity 全部通过。
- 所有格式每 cue ≤2 行、每行 ≤16 可见字符。
- canonical parity gate=true；presentation parity gate=true；format parity error=0。

## 15. 质量门升级与 finding 变化

| 项目                          |   C5.13R.3 |        C5.14 |
| ----------------------------- | ---------: | -----------: |
| Blocking findings             |         35 |            7 |
| Suggestion/review decisions   |         33 |            7 |
| 长行 blocking                 |         21 |            0 |
| 重复 blocking                 |          5 |            0 |
| Overlap findings / components | 9 findings | 7 components |
| Review items                  |         33 |            7 |
| Review audio                  |         33 |            7 |
| Audio failures                |          — |            0 |

已解决 layout/repetition 转为 non-blocking informational finding；未解决 overlap 仍是 `ILLEGAL_SUBTITLE_OVERLAP`。存在七个 blocker，因此 `finalIntegrityPassed=false` 与 `qualityGate.passed=false` 是预期安全结果。

## 16. 指标定义与真实值

| Metric                                 | 定义                                                     |              真实值 |
| -------------------------------------- | -------------------------------------------------------- | ------------------: |
| `nonBlockingCueRate`                   | 未被最终 blocking finding 覆盖的唯一 cue / final cues    | 176/192 = 0.9166667 |
| `passiveBaselineAcceptanceRate`        | 原样保留且无需结构决策的 cue / final cues                | 145/192 = 0.7552083 |
| `autoResolvedCueRate`                  | 自动关闭结构 blocker 的唯一 cue / final cues             |  31/192 = 0.1614583 |
| `autoMutationCueRate`                  | canonical text 或 timing 实际修改的唯一 cue / final cues |           0/192 = 0 |
| `presentationAutoResolvedCueRate`      | display-only layout 解决的 cue / final cues              |   21/192 = 0.109375 |
| `intentionalRepetitionResolvedCueRate` | 被真实重复分类覆盖的 cue / final cues                    |  10/192 = 0.0520833 |
| `legalOverlapCueRate`                  | 有充分证据并合法化的 overlap cue / final cues            |                   0 |
| `humanBaselineCueRate`                 | 来自人工权威 baseline 的 cue / final cues                |         192/192 = 1 |
| `manualReviewCueRate`                  | 仍在最终 review 决策中的唯一 cue / final cues            |  16/192 = 0.0833333 |
| `blockingCueRate`                      | 被 blocking finding 覆盖的唯一 cue / final cues          |  16/192 = 0.0833333 |

零分母统一返回 0；所有 rate 被限制在 `[0,1]`。

## 17. `automaticCueRate` 兼容处理

属性保留并标记 deprecated。C5.14 中：

```text
automaticCueRate === autoResolvedCueRate === 0.16145833333333334
```

不再使用旧的 `1 - manualReviewCueRate`。C5.13R.3 的旧报告仍可通过 strict parser，新字段由兼容默认值补齐；已有回归测试覆盖。

## 18. CLI 与 replay

CLI 新增：

```text
--presentation-resolution off|observe|enforce   default enforce
--overlap-resolution conservative|balanced     default conservative
```

离线入口：

```bash
npm run replay:c5-14-presentation -- \
  --task "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-3-human-reviewed-baseline-20260825" \
  --human-reviewed-subtitle "/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-13r-2-1-contradiction-audit-20260823/C-draft/subtitle-カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無]/machine-review-draft-contradiction-audited/machine-review-draft-contradiction-audited.ass" \
  --source-video "/Users/paulasmith/Downloads/カーネーション 第１話「あこがれ」 - [1440-1920x1080@KFMVFR.QSV8-hevc10_icq 20_u 1][無].mkv"
```

脚本先复制到 collision-safe 新目录，再只清除新副本中的历史 review 派生物并重建。本次输出目录仅含 7 段当前审核音频，不混入旧 33 段。

## 19. Review items / audio

`subtitle-review-package.json`：

```text
itemCount          7
mandatoryItemCount 7
audioClipCount     7
audioFailureCount  0
```

每项 blockers 仅含 `ILLEGAL_SUBTITLE_OVERLAP`。21 个 layout 与 5 个 repetition 不再生成 review item 或音频。

## 20. Skill 2 / Skill 3 兼容

Skill 2 只读仓库：

```text
/Users/paulasmith/Documents/Codex-Skills-grammar-report-generator-compat-readonly
branch codex/publish-core-runtime
HEAD   1af10bd8a7057c573959f39a745436fa837127ea
```

使用 deterministic `mock` analyzer（不调用模型/API）：

```bash
npm run grammar-report -- \
  --input "<C5.14>/subtitle-package.needs-review.json" \
  --output "<C5.14>/skill2-compatibility" \
  --analysis-provider mock \
  --overwrite
```

结果：192 canonical cue IDs → 106 sentences / 106 grammar points；没有把 display newline 当成新句界。Skill 2 前后 `git status --short` 均为空，HEAD 未变。

Skill 3 只读仓库：

```text
/Users/paulasmith/Documents/Codex-Skills-grammar-learning-site-builder-compat-readonly
branch codex/publish-core-runtime
HEAD   fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8
```

未执行写操作，前后 `git status --short` 均为空，HEAD 未变。

## 21. 验证命令与实际结果

运行环境：Node `v24.19.0`，npm `11.18.0`。

```bash
npx --yes npm@11.18.0 install
npm run generate:schemas
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
npm run test:e2e
npx vitest run tests/*.test.ts
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler
```

结果：

| Gate                 | 结果                 |               文件 / 测试 | 失败 | 跳过 |
| -------------------- | -------------------- | ------------------------: | ---: | ---: |
| npm install          | passed（up to date） |      198 packages audited |    0 |    0 |
| Schema generation    | passed               |                70 schemas |    0 |    0 |
| typecheck            | passed               | strict project references |    0 |    0 |
| ESLint               | passed               |          whole repository |    0 |    0 |
| build                | passed               |         TypeScript + Vite |    0 |    0 |
| format check         | passed               |          whole repository |    0 |    0 |
| unit-only            | passed               |        7 files / 90 tests |    0 |    0 |
| all Vitest           | passed               |        9 files / 99 tests |    0 |    0 |
| E2E                  | passed               |         2 files / 9 tests |    0 |    0 |
| Skill quick validate | passed               |                   1 skill |    0 |    0 |

`npm install` 的 audit 输出保留了 5 个依赖公告（1 moderate、4 high）；本任务未执行破坏性 `npm audit fix`。这不是上述编译/测试门失败。

## 22. 新增测试覆盖

- 21 条真实长行的数据驱动 layout、Music、chant、日文禁则、均衡空白边界、无 temporal split、三格式 round trip。
- 五组真实重复、同边界机器副本、90% overlap、相同 request、独立 token occurrence、无证据 unresolved、输入顺序确定性与只读性。
- 全部 overlap relationship、三 cue connected component、authoritative evidence、无 midpoint、可信/超限 timing repair、ASS/VTT override、三格式语义。
- 新指标、零分母、旧报告兼容、deprecated alias、observe 不计作 auto resolution。
- 人工 baseline E2E：canonical/presentation 分离、只为 unresolved overlap 建 review。

## 23. 源视频与人工 ASS 只读验证

源视频 before/after：

```text
size   847774958 bytes
mtime  1784692412 seconds
inode  333451799
SHA256 294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43
```

人工 ASS before/after：

```text
size   17094 bytes
mtime  1787570451 seconds
inode  346133940
SHA256 a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e
```

两者 size/mtime/inode/hash 均未变化；报告 `sourceReadOnlyVerified=true`，人工稿 `sourceReadOnlyVerified=true`。一个 ASS 小数逗号仅在内存中规范化，源文件字节未改。

## 24. 未执行的模型、API 与网络业务

真实 replay summary 明确记录：

```text
asrExecuted              false
networkAccessed          false
modelOrApiCalled         false
machineCandidatesImported false
```

未访问字幕网站，未使用 API key，未重新运行 Whisper/ASR，未使用旧 124 个 contradiction candidates 修改正文。依赖安装命令是任务要求的构建准备，不属于字幕业务回放。

## 25. 回归安全指标

以下均为 0：

```text
BROAD_WINDOW visible mutation
AMBIGUOUS visible mutation
LOCAL_INTERVAL_MISSING visible mutation
full cue fragment replacement
multi decision conflict
unsafe mutation
format parity error
```

needs-review package 不能 burn-in；既有拒绝 burn-in E2E 继续通过。

## 26. 最终状态与未完成问题

```text
status: needs-review
finalizationMethod: none
primarySubtitle.validationStatus: needs-review
```

仍需人工处理七个 overlap component。它们没有足够局部证据，不能安全声明为 simultaneous/legal overlap，也不能执行 timing-only repair。当前 best-effort SRT/VTT/ASS 可用于逐组审核，但不得当作 validated final 或用于 burn-in。

## 27. C5.15 建议

1. 在 review UI 中允许用户为每个 component 明确选择 `legal-overlap`、speaker/Layer 或可信 timing boundary，并生成严格 resolution artifact。
2. 从人工审核动作反向沉淀 speaker/ASS Name/Layer 与 localized token/speech evidence，重新运行同一 classifier，而不是加入作品专用台词规则。
3. 为合法 overlap 增加播放器预览与 ASS/VTT 位置冲突检测；SRT 继续记录 renderer variance。
4. 在有真实 token/VAD evidence 的新 fixture 上扩展 timing-only repair replay，继续坚持最大调整量与最短 cue 时长。
5. 规划 finalization report v2，在明确迁移窗口后移除 deprecated `automaticCueRate`。

## 28. 最终输出路径

任务目录：

```text
/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-14-presentation-safe-auto-resolution-20260825
```

主要文件：

```text
<task>/c5-14-replay-summary.json
<task>/subtitle-.../subtitle-package.needs-review.json
<task>/subtitle-.../subtitle-finalization-report.json
<task>/subtitle-.../subtitle-presentation-resolution.json
<task>/subtitle-.../subtitle-review-package.json
<task>/subtitle-.../review/index.html
<task>/subtitle-.../audio/review/                 (7 WAV)
<task>/subtitle-.../subtitle-....best-effort.srt
<task>/subtitle-.../subtitle-....best-effort.vtt
<task>/subtitle-.../subtitle-....best-effort.ass
<task>/skill2-compatibility/grammar-report.json
<task>/skill2-compatibility/grammar-report.md
```

开发报告：

```text
/Users/paulasmith/Documents/Codex-Skills-multilingual-video-subtitler-c5-13r-3/C5_14_PRESENTATION_SAFE_AUTO_RESOLUTION_REPORT.md
```
