# 独立字幕工具 v1 候选版

## 低置信词元局部双模型比较（开发入口，非默认）

同じ対象の前後レコードを含む範囲拡張比較は `node scripts/run-whole-context-comparison.mjs prepare FROZEN_LEXICAL_COMPARISON OUTPUT_PARENT`、明示実行は `execute ROOT --authorize-local-asr`、読み取り検証は `verify ROOT`。最大3窓・6要求・90秒、再試行なし。今回6要求／39.84秒では採用0、元字幕不変。判定の部分グループ競合・浮動小数の偽重複とモデル欠落を分離した 上下文比較報告（历史报告 SUBTITLE_TOOL_WHOLE_CONTEXT_COMPARISON_REPORT.md，未随核心源码发布） を参照。デフォルト変更なし。

短文専用の独立候補は `node scripts/replay-short-dialogue-candidate.mjs create FROZEN_COMPARISON OUTPUT_PARENT`、検証は `verify ROOT`。6–15文字の単一字幕に、同一音声の双モデル全文一致・一意な前後文・反復保護・元区間内の donor を要求し、元時刻を保持する。追加推論・標準生成への接続・自動採用なし。今回の1件は「ごはん→ご飯」の表記差のみで、意味の改善は未確認。詳細とソース端例外・時刻未検証の制約は 短文候補報告（历史报告 SUBTITLE_TOOL_SHORT_DIALOGUE_SHADOW_REPORT.md，未随核心源码发布） を参照。

保存済みの比較結果は `node scripts/audit-dialogue-association.mjs create FROZEN_COMPARISON OUTPUT_PARENT` で発話帰属の阻害要因を別出力に診断できる。`verify AUDIT_ROOT` はハッシュと決定を再計算する。短い raw group、隣接字幕への時間重複、全文不一致、部分包含、反復アンカー、前後文の収録不足を区別するだけで、推論・字幕修正・閾値緩和は行わない。実データ3箇所の結果と制約は 発話対応づけ診断（历史报告 SUBTITLE_TOOL_DIALOGUE_ASSOCIATION_REPORT.md，未随核心源码发布） を参照。

`node scripts/run-lexical-risk-comparison.mjs prepare SPEC_JSON OUTPUT_PARENT` 从成功 bounded 任务的原始 JSON 词元概率选择目标，不读参考；随后 `execute ROOT --authorize-local-asr` 才执行本地 large-v3/Kotoba，`verify ROOT` 只读回放。最多 3 目标、6 请求、90 秒、零重试；模型与解释器必须已存在。低概率只是未校准的风险信号，不是错词证明，高置信错词仍会漏检。参考评价另用 `scripts/evaluate-lexical-risk-comparison.mjs`，不得进入生成。

首轮 SaSLaW 开发回归实际为 6 请求/24.6 秒，3 个目标均保留原稿，CER 15.38% 未改善；短 donor、邻句归属及词义冲突仍阻塞安全应用。未放宽原整句策略的 16 字门槛，也未接入默认生成。详情与复现命令见 局部词语比较报告（历史报告 SUBTITLE_TOOL_LEXICAL_RISK_COMPARISON_REPORT.md，未随核心源码发布）。

## 现有证据批量回放与修复收益评价

受限的整句 donor + 上下文正文支持路线已接入正常日语 bounded 生成：默认以 **shadow（独立候选，不替换推荐稿）** 方式复用本轮接缝证据，零新增请求。在 `DEFAULT_DELIVERY.md` 中查看 Context candidate；`--no-context-seams` 可单独关闭，`--no-refine-seams` 则不生成接缝证据，两条路线均跳过。旧任务 `resume/status` 不补跑。旁路失败不丢弃旧策略可用稿，也不重试模型。

正常入口的离线回放：`npm run subtitle-tool -- replay-seam-context --evidence FROZEN_SEAM_RUN --output-root NEW_OUTPUT_PARENT`。只需既有接缝运行，不再依赖实验 batch、局部 VAD、人工标注或 CTC 历史链。原始证据和历史字幕只读。该入口与正常生成使用同一个 adapter，交付完整 ASS/SRT/VTT、决策、来源冻结和重算校验；不推断子串时间。

早期实验入口 `node scripts/replay-seam-context-text.mjs create FROZEN_BATCH_ROOT NEW_OUTPUT_PARENT` 仍保留，随后 `verify RUN_ROOT`，候选冻结后才 `evaluate RUN_ROOT REFERENCE_ASS`。单个已知接缝真实回归取得 8 个字符编辑错误减少，但不是通用终稿能力，详见 上下文正文恢复报告（历史报告 SUBTITLE_TOOL_SEAM_CONTEXT_TEXT_REPORT.md，未随核心源码发布）。**接入默认候选交付不等于默认采用新规则**：尚缺独立真实样本验证，推荐稿仍沿用原整句策略，所有结果仍为 needs-review。接入验收和本轮剩余差异清单见 接入报告（历史报告 SUBTITLE_TOOL_CONTEXT_DELIVERY_INTEGRATION_REPORT.md，未随核心源码发布）。

`node scripts/replay-frozen-candidates.mjs create SPEC_JSON NEW_OUTPUT_PARENT` 只读验证既有接缝、局部恢复和 VAD 证据，使用原决策规则在独立整集副本中组装可应用插入；不会调用模型，也不会把已进入当前基线的接缝修复重复计入收益。`verify RUN_ROOT` 重新验证来源、逐项决策和 ASS/SRT/VTT 对账。候选冻结后，使用 `node scripts/evaluate-short-response-benchmark.mjs --batch RUN_ROOT FROZEN_BENCHMARK_ROOT REFERENCE_ASS` 评价；标注不进入生成。历史短回应零插入评测模式继续保留，新模式区分正确、错插、时间失败及无法评分，不把语音阳性等同于确认漏句。此入口尚未接入默认生成。真实 8 目标回放、零新增收益和限制见 批量回放报告（历史报告 SUBTITLE_TOOL_FROZEN_CANDIDATE_GAIN_REPORT.md，未随核心源码发布）。

## 语音支持检查（独立验证入口）

`experiment:subtitle-tool:vad-local-recovery` 提供冻结三态候选的局部 ASR 验证：`prepare SPEC OUTPUT_PARENT`、`run ROOT --authorize-local`、`finish ROOT`（仅离线）、`verify ROOT`。最多 4 目标/8 请求/64 秒，零重试，只可向单独的完整候选稿新增通过检查的短句，不替换旧 cue。`scripts/evaluate-vad-local-recovery.mjs ROOT REFERENCE_ASS` 仅在候选冻结后评价。首次真实运行 8 次/39.2 秒、0 写回、CER 未变；不是默认功能或质量验收，详见 局部恢复报告（历史报告 SUBTITLE_TOOL_VAD_LOCAL_RECOVERY_REPORT.md，未随核心源码发布）。

冻结 VAD 结果可用 `review:subtitle-tool:vad-triage -- replay FROZEN_VAD_ROOT NEW_OUTPUT_PARENT` 离线生成三态复核清单，`verify TRIAGE_ROOT` 校验原始证据链和派生结果。目标覆盖 ≥50% 为充分支持，>0 且 <50% 为部分支持，0 为未支持；只分组排序，所有候选保留，不自动删除、补词或派发模型。无效/缺失证据报错，不归为未支持。此入口未接入默认生成，已有 16 段仅用于开发回归，不是独立验证；详见 三态复核报告（历史报告 SUBTITLE_TOOL_VAD_TRIAGE_REPORT.md，未随核心源码发布）。

已标注短片段可用 `experiment:subtitle-tool:listening-vad` 做显式本地校准：`prepare LISTENING_ROOT LOCAL_SPEC OUTPUT_PARENT`、`run RUN_ROOT --authorize-local`、`verify RUN_ROOT`、`evaluate RUN_ROOT ANNOTATION_DIRECTORY`。只复用现有 Silero CPU 运行时，最多 16 次/60 秒/零重试，零 ASR；先冻结机器结果再读取标签。固定规则看目标区间的 VAD 覆盖，不把上下文阳性或整段概率峰值作为目标阳性；未达到一半覆盖不等于非语音。该入口不接入默认删除/补词，不推断语气词是否应出字幕；参考辅助标签不能称为盲测。当前 16 段结果与限制见 短片段 VAD 验证（历史报告 SUBTITLE_TOOL_LISTENING_VAD_VALIDATION_REPORT.md，未随核心源码发布）。

新增 `experiment:subtitle-tool:speech-support`，对机器选择的长稀疏 cue 与字幕间隙做有界检测，并在满足完整短语音条件时允许双模型局部验证。此次真实运行只完成 4 次 VAD，未触发 ASR，字幕准确率未变化，**不能把 detector-negative 当作静音或删除许可**。未将此策略加入默认自动写回。结果与命令见 语音支持报告（历史报告 SUBTITLE_TOOL_SPEECH_SUPPORT_REPORT.md，未随核心源码发布）。

## 默认有界生成与接缝复核

### 默认内容异常纠错（2026-09-30）

新增默认 `pcm-zero-and-replacement-v1` 保护：新 bounded 计划显式绑定此版本，主识别与局部重识别在调用前检查完整请求 PCM；仅当全部采样严格为零才跳过，保存样本范围、音频及切片哈希，不伪造 ASR 空响应。非零但低音量不跳过，也不推断语音/音乐类别。已经预约的局部窗口即使跳过也不回补预算。旧计划没有此版本字段时不追溯转换。

候选需通过逐条原文及出现次数核对、原时间区间覆盖核对：未标记为退化/套话的原文无法在同时间候选中找到、真实重复次数减少、超过 10 ms 的丢失区间仍含非零采样，均为 `regression-hold`。含信号不等于有对白，所以这是保守复核门槛，不是漏词真值；标记为异常的旧词也不能凭空豁免时间覆盖。候选内连续 ≥2 秒严格全零挂屏同样 HOLD，不自动截断或按能量分词。逐条变化和候选保留在 `*.regression.json` / `*.candidate-records.json`，拒绝候选不替换底稿。

`resume` 只读继承冻结纠错 HOLD；无字幕输出时退出 2，不能以空文本“无风险”冒充交付成功。新计划全零块单独记为已验证跳过，零 ASR、无字幕；这与非零音频返回空识别（仍 partial）不同。新保护不等于字幕准确率验收。报告见 默认音频与替换保护（历史报告 SUBTITLE_TOOL_AUDIO_REPLACEMENT_GUARD_REPORT.md，未随核心源码发布）。

新建 bounded `generate` 现在执行「每块检测 → 有限局部重识别 → 候选及全文复查 → 未解决则 HOLD」。`content-safety-gate-v3` 在下述 v2 规则基础上增加整句连续循环和请求级整句低多样性：相邻同句至少 6 条、40 秒窗口内持续至少 10 秒，或同一请求同句至少 6 条且占比 ≥80%。风险不是幻觉真值；正常少量试音句、跨较长间隔的重复题干及已标记歌曲不按整句循环自动删改。

新生成任务每个成功块完成后检查原始映射记录（含跨块连续重复），对严重解码循环及模板套话等可重试风险，将对应请求的同一音频范围分成两个独立短请求，各 ≤15 秒。每任务仅一轮，最多 4 个目标 / 8 次请求 / 120 秒，技术失败零重试；开始前持久化预约，取消、失败、无改善或耗尽后均不递归执行。若使用了内容纠错预算，本任务跳过后续接缝推理，不能把两份 8 请求预算叠加。原有主识别规划 64 块 / 1 次技术重试限制不变。

原始成功响应不覆盖；局部新证据、请求参数、哈希、检查和延后目标写入 `default-content-recovery/`。只有候选非空、时间与三格式往返合法、全文内容检查不再命中风险且没有失败/延后目标时，才可作为独立机器修订草稿推荐；这不是声学正确性或内容完整性认证，始终 `needs-review`。时间未解决或原任务 partial 不通过该路线自动洗成完整稿。预算内仍未解决时推荐列表为空，CLI 退出 2，原稿和候选只供检查。

`--no-recover-content` 只关闭新纠错推理，不关闭检查或 HOLD；`--no-refine-seams` 只关闭接缝推理。要禁止两类额外推理须同时使用两个选项。`status` 只读核验纠错冻结证据；`resume/audit/recover` 不补跑纠错、不续充预算。显式 `--strategy single` 不获得这轮局部重试，识别结束后的异常检查仍使 CLI 退出 2。旧文件不追溯改写；本变更没有为 N1 历史产物重新运行模型。

当前 v3 保留 `content-safety-gate-v2` 的检查：请求级短词低多样性、连续短词循环、异常长句重复和特定结束语套话；句中连续假名退化、超过12秒且不足1字/秒的普通对白、日语任务中30秒内至少3次重复的1–3字母词、时间重叠的包含型片段，均触发 **HOLD**。语言由调用方显式传递；未声明日语时不套用短拉丁词规则。已标记的歌曲不套用普通对白规则或长对白重复规则，非重叠真实重复不按重叠片段处理。这不是静音/幻觉真值，也不授权删除真实重复或语气词。新建 bounded `generate` 在推荐前重新检查实际候选；风险未解决或检查不可用时，`preferredOutputs=[]`、CLI 退出 2，原稿仍在 `inspectableOutputs`。未发现这些模式也不代表质量通过。历史任务和原始证据不改写；`audit-content` 的 v3 sidecar 增加请求级风险，但该离线命令不自动派发新识别。

显式离线隔离预览：`node scripts/subtitle-tool-content-safety.mjs FROZEN_SUBTITLE_STEM RAW_BOUNDED_TASK NEW_OUTPUT_ROOT`。输入目录须有 `freeze.json.files` 绑定三种格式，且原任务音频源偏移为 0；不满足时拒绝，不猜时间。输出完整保留稿、`risk-isolated.PARTIAL-PREVIEW`、逐条 `omissions.json`、带源时间的音频复核页及哈希冻结。**部分预览可能遗漏真实对白/歌曲，不是修复全文，不提升为推荐稿**；正文恢复需另有音频证据，VAD 阴性或参考为空均不能关闭风险。

显式听审校准入口：`npm run review:subtitle-tool:audio-listening -- prepare FROZEN_OBSERVER NEW_OUTPUT_PARENT`，从冻结观察器另建本地播放/标注包。最多 8 个已排序目标及 8 个哈希抽样候补，总音频不超过 60 秒；候补最多 30 秒。同一已知剧集的候补不称为独立留出集。页面不展示参考、邻近字幕、候选等级或分组，标注目标声音与发话关系，导出 JSON；`evaluate LISTENING_ROOT LABELS_JSON` 严格校验清单/音频身份、重复项及声音/关系一致性，另建评价目录。待听审与不确定不是阴性标签；此入口不读 Gold、不调用模型、不修改默认生成、不写回字幕。页面关闭前须导出，本地文件交互需用户确认；初始状态仅为 awaiting-listening-labels，不能称为校准成功。

默认日语 bounded 交付还会生成 `AUDIO_COVERAGE_OBSERVATION.md/json`，检查源音频活动与推荐 SRT 的覆盖关系。只读已保存且哈希绑定的 16 kHz mono PCM：20 ms 能量帧、固定 -40 dBFS 低能量界、至少 160 ms 间隔，寻找无 cue 的有声区间及长文本 cue 内的多个短活动。**它不是 VAD，音乐/音效也会命中，低能量不证明没有语音；不补词、不拆字幕、不改时间。**

试听 v2 按结构证据分级：完整的短活动优先；跨 cue 的可能连续尾音/起音、长连续活动碎片降级。长 cue 内相对同 cue 其他活动更短的独立活动单独列出。先平衡无 cue/长 cue 内两类（各最多 4 段），不足时补满；同级按源时间分层，最多 8 段、累计 60 秒。不触发 ASR、VAD、对齐或外部请求。完整候选和延后项保留，降级不等于无语音；每个候选记录父活动、关联 cue、优先级理由，声音类别仍为 unknown。当前排序质量尚未通过验证，试听包不应被当作最可能出错位置，也不能自动转为模型任务。扫描最多 1800 秒；音频读取有上限，缺少有效源绑定或时间非法时标 unavailable。关闭接缝推理不会关闭零模型观察，旧任务不会通过 resume 获得新推理预算。

开发仓库可用 `npm run audit:subtitle-tool:audio-coverage -- replay TASK PREFERRED_SRT NEW_OUTPUT_ROOT` 离线另建观察目录。原始 SRT 需匹配任务检查点；接缝候选需通过冻结链绑定同一音频与基线计划，不能拿其他视频的同长度 SRT 充当当前稿。`verify FROZEN_OUTPUT_ROOT` 只验哈希。`scripts/evaluate-audio-coverage.mjs FROZEN_OUTPUT_ROOT REFERENCE_ASS` 是独立冻结后评价入口，不进入默认生成或运行包。

日语 bounded `generate` 的交付阶段默认增加**短回应观察清单**：`SHORT_RESPONSE_OBSERVATION.md/json`，入口在 `DEFAULT_DELIVERY.md`。检查实际推荐 SRT 中比较长度不超过 8 字的日语短句，列出前后句、超过 2 秒的短文本跨度和重叠 cue。只做观察，不读人工稿、不加载模型、不替换文本或时间，也不把同系列模型一致当作正确性依据。`--no-refine-seams` 关闭的是接缝推理，不关闭这个零推理检查。旧任务 `resume/status/recover` 不自动补做；非日语跳过，缺少/非法推荐 SRT 明确记为 unavailable，而非零风险。

清单不等于错误列表；长句内短回应和未生成字幕的漏词可能无法发现。取消检查仍按取消退出。原始映射记录与推荐 SRT 分开统计，避免把旧底稿风险当成当前交付。开发仓库可用 `npm run audit:subtitle-tool:short-responses -- MAPPED_RECORDS_JSON PREFERRED_SRT NEW_OUTPUT_ROOT` 对明确指定的旧机器产物离线观察，另建冻结输出目录，不修改历史任务；人工参考只能交给独立的 `scripts/evaluate-short-response-observation.mjs` 冻结后评价入口。

新建 `generate` 默认 bounded；完整日语基线成功后，自动复核最多 4 个接缝（额外最多 8 次本地请求 / 120 秒音频，零重试），只应用通过的文字合并并保留原组外侧时间。推荐稿见 `DEFAULT_DELIVERY.md`，原稿不覆盖。`--no-refine-seams` 可关闭；`--strategy single` 使用旧整片入口。局部/部分结果等不合格基线跳过。resume 不自动补跑接缝阶段。文字一致不等于时间已经修准，始终 needs-review。命令、预算与真实结果见 [接缝复核说明](SUBTITLE_TOOL_SEAM_REFINEMENT.md)。

歌曲的网上检索属于 Codex Skill 的参考辅助流程，不是本地 CLI 的联网能力。先核对曲名和发行版本；只有用户提供或允许完整使用的歌词才能填入。用源音频证据对齐，不按字数分配时间；无法验证者保留待对齐。歌词辅助稿与纯机器稿分别交付，不能混入 machine-only 评分。详见 Skill 的 `references/song-lyrics.md`。

## 显式有界生成与内容异常检查（候选）

普通 `generate` / `resume` 取得成功原始响应后，会额外生成独立的 `content-audits/content-audit-*/CONTENT_AUDIT.md` 和 JSON，并在终端返回路径。检查零/非法时长、极短显示、异常阅读速度、长区间、相邻重复及共有子串循环。它只发出风险警告，不证明幻觉、不删除真实重复、不更改正文或时间；没有警告也不代表准确。历史 task.json 的 `contentQuality=NOT_MEASURED` 仍然表示没有声学质量测量，不被这个启发式报告改写。

内容审计 v2 增加跨两条相邻字幕的短语循环检测（至少 8 字核心、共至少 3 次非重叠出现）；字符位置只用于找重复，不生成词级时间。正常的两次同句、短回应和真实重复不自动删除。

每次审计同时交付 `recovery-plan.json`：从全部机器警告合并源时间区域，再规划每窗最多 30 秒、默认最多 8 窗 / 240 秒的局部候选范围。它**只生成计划，不启动模型，也不授予推理权限**。预算未覆盖区域明确为 `deferred-budget` / 部分覆盖；零时长仅保留点位，无法定位者单列。已有候选区间按并集计算，擦到原字幕边缘不算全段覆盖；有候选也不等于已修复。正文、时间、原任务均保持不变。计划不使用人工稿；错词若没有机器风险信号，仍可能漏检，不能宣称覆盖了全部转写错误。

对旧任务可以完全离线检查；此命令不访问历史视频、模型或人工字幕：

```sh
npm run subtitle-tool -- audit-content --task /path/old-task --output-root /path/new-audit
```

有界分块现在默认启用，也可显式指定：

```sh
npm run subtitle-tool -- generate --strategy bounded --input /path/movie.mkv --output-root /path/new-tasks
npm run subtitle-tool -- generate --strategy bounded --input /path/movie.mkv --output-root /path/local-check --start 400 --end 450 --export-partial
npm run subtitle-tool -- status --task /path/subtitle-bounded-XXXXXX
npm run subtitle-tool -- resume --task /path/subtitle-bounded-XXXXXX --export-partial
npm run subtitle-tool -- audit-timing --task /path/subtitle-bounded-XXXXXX --output-root /path/separate-audits
```

复用已有 25 秒优选核心、单请求不超过 30 秒、两侧各最多 0.3 秒上下文的规划。当前使用确定性硬切边界，没有新增 VAD 模型；每块独立 CLI 进程，不使用参考稿或 prompt。正常计划最多 64 块、原始音频覆盖加上下文不超过 1.1 倍；每个任务总计最多一次主识别技术失败重试。原始成功响应不重跑或覆盖；新建任务另有上节限定的内容纠错候选预算，resume 不获得此预算。超过主规划预算的长视频会拒绝规划，而不是悄悄扩大预算。

`--start/--end` 是相对容器起点的源视频时间，需成对给出，输出仍保留源视频绝对位置。局部范围不代表整片完整交付；将局部字幕加载到原视频才是对应时间。只支持 `primary-minimal`，不自动应用旧研究恢复或 G11。

每个请求保存输入片段、调用参数、stdout/stderr、退出状态、原始 SRT 与哈希。运行时声明支持时保存原始 JSON sidecar，但 token 时间语义标为 `NOT_VALIDATED`，不冒充已经完成词级对齐。`mapped-records.json`、全文、时间问题与边界别名账本保留全部来源；合法子集只有显式 `--export-partial` 才在异常情况下导出。

有界任务使用独立严格的 `bounded-plan.json` / `bounded-task.json`，不篡改旧任务合同。status 仅验证本地证据；resume 核验输入、模型、软件身份及预算，复用成功块。`recover` 仍是旧任务的纯离线路线，不会因遇到 bounded 任务而启动识别。格式检查通过、局部文本改善或异常警告减少，均不代表人工终稿、整片质量通过或自动替换旧字幕。

分块接缝的 `BOUNDARY_AMBIGUITY` 会作为 `additionalWarnings` 单独交付，不能因文本启发式警告为零就忽略接缝风险。两侧候选保持原样供复核，不自动删句。针对本轮代码的离线/mock 验证：`npm run test:subtitle-tool:bounded-product`；真实受控结果与限制见 `SUBTITLE_TOOL_BOUNDED_QUALITY_REPORT.md`。

`audit-timing` 仅检查已完成/部分完成的 bounded 检查点，验证已存文件（含 PCM）的哈希、请求绑定、JSON/SRT 对应与源时间映射；不访问外部源视频/模型、不调用运行时、不读取人工稿。独立输出目录不能位于原任务内。它检查零时长、倒置、越界、长首词及接缝共同词项，但始终不改文、不改时、不删重。文件/映射有效与声学时间可信是不同结论。`--output-json-full` 在已核对的 whisper.cpp 1.9.1 中会启用普通词元时间后处理；旧合同 `timestamp=segment` 描述字幕导出的时间层级，而不是关闭了词元计算。`t_dtw=-1` 表示 DTW 不可用，普通词元时间仍可能存在。详见 `SUBTITLE_TOOL_STORED_TIMING_SEAM_REPORT.md`。

## v1.0.1：全文、部分字幕与外部修订

成功请求的时间异常不再只返回失败。新任务保存完整原始记录、全文、时间异常及索引，状态为 partial；旧失败任务只产生独立恢复视图，旧 task.json 和错误不变。

```sh
npm run subtitle-tool -- recover --task "/path/task"
npm run subtitle-tool -- recover --task "/path/task" --export-partial
npm run subtitle-tool -- recover --task "/readonly/task" --output-root "/writable/recovered"
npm run subtitle-tool -- validate-edited --task "/path/task" --input "/path/edited.srt" --timebase source
```

命令直接返回恢复目录和 OUTPUT_INDEX.md。默认只交付 transcript.full.txt、raw-records.json、timing-issues.json 和 TIMING_ISSUES.md。无法提取正文的原块保留在 unparsed-blocks.json（如有）；不将异常说明混入识别正文。

`recover` 现在也附带与 generate 相同的内容审计及恢复计划，并通过 `deliveryIndex` 返回新的 `DELIVERY_INDEX-*.md`，把部分字幕与未解决内容风险放在同一入口。原 `outputIndex` 和严格 `recovery.json` 合同不变，不给旧哈希目录追加或改写文件。导出时间合法的字幕不再跳过内容风险提示，但此命令仍不识别、不删重、不改词。

只有 `--export-partial` 才写出 `subtitles/primary-minimal.partial.ass/srt/vtt` 和 export-map.json。这些文件没有包含未解决记录，因此不完整；未解决正文仍在全文和原始记录中。没有合法条目就不创建空字幕。合法重叠/重复/长行不自动删除；文字或时间不能安全往返的条目保留为未解决。既有百分之一秒精度可能使极短区间坍缩，本工具不补时长。

重复 recover 按 task/raw 哈希及恢复版本、导出策略复用经过重新验证的目录。目录被改动则拒绝覆盖，请另存用户副本；如需新修订可指定新的 output-root。并发命令使用独立排他锁，取消只清理本次未提交临时目录；异常断电残留锁需要用户确认没有运行中的恢复操作后手动处理，不自动抢锁。

成功 raw checkpoint 的确定性时间阻塞走纯离线恢复，不进入模型预检、ffprobe 或转写。再次 resume 只提示实际异常数和恢复索引，不会产生新时间。恢复不要求旧视频/模型/可执行程序存在，不跟随 task.json 中的历史绝对路径；现场再核验为 NOT_RUN_SOURCE_UNAVAILABLE（没有探测可用性），只使用已保存并绑定成功请求的时长/offset/hash。原始文件或任务绑定损坏是技术错误，不以新识别掩盖。

partial 副本的时间已是 source；从 raw-primary.srt 另存的文件使用 `--timebase audio`，只加一次 offset。默认 source，无法猜测用户声明错误；只有可观测的越界/非法区间会拒绝，范围内的错误时间基不能被当作已验证声学对齐。

validate-edited 支持 SRT/VTT/ASS；原文件只读，合法输出另放 `user-edited-*/subtitles/subtitle.user-edited.*`。ASS 样式按已有 parser 的可见文字投影转换，不承诺样式无损；不读取相邻字幕。逐条、同顺序、同正文（只允许显示换行差异）的全量对应，才报告 ALL_RECORDS_IN_ORDER_TEXT_PRESERVED。删词、改标点/宽度、合并或拆分报告 USER_CONTENT_CHANGED / SOURCE_COMPLETENESS_UNPROVEN，但仍可交付格式合法的用户副本。把 partial 另存一次不能证明遗漏内容已恢复。

退出码：0 是该完整操作/检查成功（例如格式且全量文字对账通过的修订检查）；2 是已交付可取回记录，但完整定时交付或源文字对账仍未完成；1 是身份、编码、权限或 I/O 技术故障。status 是只读查询，查询成功退出 0；它分别显示历史 task 和可信恢复视图，外部 output-root 结果由恢复命令直接返回，不修改只读归档建立索引。

无论修订检查是否退出 0，acousticCorrectness=NOT_VERIFIED、humanValidated=false、finalizationMethod=none、machineOnlyReleaseAuthorized=false。原始机器文字可能有幻觉，保全记录不代表文字正确或发话真实。恢复成功不改变完整机器字幕验收失败的历史结论。

这是本地字幕草稿工具，不是识别准确率认证或正式公开 Release。输出始终需要复核；正常导出不要求 Gold、人工参考稿或历史实验目录。

## 安装

本轮环境：Node.js 24、npm 11.18.0；版本不升级。自行安装 FFmpeg/ffprobe、whisper.cpp 的 `whisper-cli` 及兼容 GGML 模型。工具不会自动下载模型、安装系统组件或发送音频到云端。模型路径须由用户配置，不随候选包提供。

解压候选包进入根目录，或在本仓库使用：

```sh
npm ci
npm run build:subtitle-tool
npm run subtitle-tool
npm run subtitle-tool -- configure --model "/path/model.bin" --runtime "/path/whisper-cli" --language ja
npm run subtitle-tool -- doctor
```

默认配置位于用户主目录下 `.config/subtitle-tool/config.json`。可用 `--config /path/config.json` 隔离配置。模型/运行时必须是本地文件；首次配置和 doctor 均不加载模型、不识别音频。

源码仓库仍保留旧 CLI 和 root build；定向 build 只构建字幕依赖闭包。精简候选包只承诺新 `subtitle-tool` 入口，不包含语法报告或站点构建产品。

## 日常使用

doctor 可加 `--output-root /path/subtitles` 检查写权限；不创建目录。不指定时检查当前工作目录。

```sh
npm run subtitle-tool -- doctor --input "/path/日本語 動画.mkv"
npm run subtitle-tool -- generate --input "/path/日本語 動画.mkv" --output-root "/path/subtitles"
npm run subtitle-tool -- status --task "/path/subtitles/subtitle-XXXXXX"
npm run subtitle-tool -- resume --task "/path/subtitles/subtitle-XXXXXX"
npm run subtitle-tool -- resume --task "/path/subtitles/subtitle-XXXXXX" --profile g11
```

音频文件使用同一入口。每次 generate 创建唯一目录，绝不覆盖同名旧任务。多音轨输入必须通过 `--audio-track N` 指定 **容器全局 stream index**，而不是“第 N 条音轨”。doctor 会列出合法音轨；单音轨自动选择。

默认 `primary-minimal` 保留原始 Primary 文本和真实段级时间，仅统一格式时间精度，不清除可疑文本。G11 显式选择时依次调用已有跨 Cue overlap-required 去重、intra-cue source-preserving、声学语义分句与排版业务函数，算法和阈值均未调整。可以在 configure 中主动保存 G11 偏好；日语以外应使用 primary-minimal。

G11 需明确使用 `--strategy single --profile g11`，或对旧 single 任务 `resume --profile g11`；bounded 不支持 G11。G11 与 single Primary 共享同一份识别证据，后者的 resume 切换不会再次调用 ASR。G11 的合并、去重和排版变化均记录在 assembly JSON 中，文本序列变化必须人工检查。

## 查看和修改

打开任务内 `OUTPUT_INDEX.md`，用已有外部字幕编辑器查看 `.machine-draft.ass`、`.srt` 或 `.vtt`，对照源媒体开头、中间和结尾试听。无需另建 Web 审核平台。

编辑前另存为 `edited.ass` 或 `edited.srt`，不要修改 `raw-primary.srt`、`primary-evidence.json` 或机器草稿原件。工具保留编辑副本；如果检测到机器草稿原件已被外部修改，拒绝覆盖。编辑器的另存/导出由用户控制，本工具不自动将其认定为 humanValidated，也不将更正回灌为下一次识别提示。

## 状态、取消和恢复

`task.json` 是严格、原子写入的本地检查点：输入/模型/可执行程序 SHA-256、配置、音轨、时基、预算、每次实际请求、输出 hash 和错误均在其中。

- executionStatus：queued / running / completed / failed / cancelled / partial。
- artifactIntegrity：pending / passed / failed，表示技术交付检查。
- qualityStatus：始终 needs-review；contentQuality 为 NOT_MEASURED。
- finalizationMethod=none、humanValidated=false、machineOnlyReleaseAuthorized=false。

因此 completed + passed + needs-review 是合法机器草稿状态，不是人工终稿，也不绕过旧 protected finalization。

Ctrl+C 会终止本次入口拥有的子进程，保留已完成音频和证据检查点。resume 校验输入、模型、运行时和配置；身份变化必须创建新任务。resume 不因文本差、时间异常或导出故障重跑成功识别，也不启动新建 bounded 任务专属的局部内容纠错。旧 single 路线失败请求最多重试一次，跨 resume 累计最多两次完整请求，累计音频预约不超过首次规划的两倍。预算耗尽会停止。

意外断电或 SIGKILL 可能留下 `.run-lock`。确认旧进程已结束后使用 `resume --recover-lock`；工具只在锁 PID 已不存在时移除旧锁。禁止并发运行同一任务。没有全局 kill 或自动清理历史目录的命令。

完整音轨一次识别；不是按参考稿切片。提取为单声道 16 kHz PCM，保留音频内部时间间隔，独立记录容器起点与音轨偏移；原始 SRT 保留，偏移只加一次。缓存身份绑定音频、模型、运行时、语言、空 prompt、解码参数、提取参数与时基。完整证据存在时重新组装/导出为零 ASR。

## 输出与限制

清理时只选择 task.json 的 ownedFiles 中确实不再需要的文件移到废纸篓，先备份 edited 副本。工具不会自动递归删除任务目录、旧 output 或共享模型。卸载仅移除本次候选安装目录和自己指定的配置文件；保留外部模型与源媒体。

任务内包含原始机器 SRT、Primary 证据、三个格式草稿、组装 trace、manifest、日志与索引；本地 manifest/日志可能含绝对路径，不应原样公开。候选源码 ZIP 不带这些私人运行数据。

允许保留并警告重叠、单模型识别错误、超长行、方言错误与空识别结果。空识别仅表示“成功请求返回空文本”，不是已验证无语音。不会为凑 2×16 排版而删除文字、按字数造时或裁切真实时间。全部格式使用同一组百分之一秒量化时间，并从磁盘重读检查文本/时间一致性。

单个完整请求在中断时无法从模型内部继续；恢复只能在有限预算内重做该未完成请求。长媒体消耗、首次依赖安装、外部编辑器能力和本地硬件仍是限制。本轮没有自动翻译、烧录、说话人识别或质量保证。

暂停且不接入正常运行：Reazon、CTC/MFA、旧尾音诊断、复杂仲裁、review/coverage/budget research planner、Gold 评价与 scripts/c601* 协调器。正常入口不打开参考字幕、不读取相邻字幕正文、不从标题构造 prompt；已有 API key 不触发云端回退。

## 显式局部声学验证（非默认路径）

`scripts/subtitle-tool-local-acoustic-check.mjs` 只用于已获授权的三个局部目标：一个长起点、两个分块接缝。根据已冻结机器记录规划 2 次条件 CTC 与 4 次无 prompt Whisper 请求，最多累计 120 秒、单次 30 秒、零重试。已有执行预约的任务不能再次 `run`；`freeze` 只重读证据，不调用模型。

```sh
npm run experiment:subtitle-tool:local-acoustic -- prepare /path/spec.json /path/new-output
npm run experiment:subtitle-tool:local-acoustic -- run /path/new-output/local-acoustic-XXXXXX
npm run experiment:subtitle-tool:local-acoustic -- freeze /path/new-output/local-acoustic-XXXXXX
node scripts/evaluate-local-acoustic-check.mjs /path/new-output/local-acoustic-XXXXXX /path/reference.ass
npm run test:subtitle-tool:local-acoustic
```

spec 包含三个 `targets`（`id`、`kind: timing|seam`、已完成 bounded `task` 路径与 `recordIds`）及本地 `ctc.python`、`ctc.model`。使用已有 CPU CTC 运行时，不安装、不下载、不改对齐算法。该研究命令不属于精简独立运行包的承诺接口。

原任务不修改。四份局部 ASR 候选分别导出 ASS/SRT/VTT，使用源视频全局时间，不能顺序拼接为全片；无效时间只保存证据并阻止导出。CTC 只报告条件时间候选，不生成自动修订字幕。双窗口一致和高 posterior 都不代表字幕显示起止点已验证。机器证据必须先冻结，再进行可选参考比较；比较不回写机器结果。结果仍为 `needs-review`。

本次真实结果与边界限制见 局部声学验证报告（历史报告 SUBTITLE_TOOL_LOCAL_ACOUSTIC_CHECK_REPORT.md，未随核心源码发布）。

## 冻结证据的核心拼接候选（离线、非默认路径）

`core-splice` 读取上节已经冻结的证据和原 bounded 任务，校验哈希、请求身份、局部与全局时间映射后，只生成独立候选副本。零模型调用，不要求原模型仍在磁盘上，不读取人工稿来选择候选。

```sh
npm run experiment:subtitle-tool:core-splice -- /path/local-acoustic-XXXXXX /path/new-output
npm run evaluate:subtitle-tool:core-splice -- /path/new-output/core-splice-XXXXXX /path/reference.ass
npm run test:subtitle-tool:core-splice
```

仅当完整 donor cues 覆盖原相邻重叠目标、保留两侧文字锚点，并得到另一窗口的唯一文本支持时提出拼接。使用旧目标的外边界，记录内部切分点变化，不按字数造时，不把局部窗口整段覆盖回原稿。支持视图中的子串只证明文字一致，不提供子串时间。短句、竞争候选、越界、支持间隔过大或身份损坏会拒绝修订或报错。

输出每个原比较窗口的 baseline/candidate ASS、SRT、VTT 与已有局部音频副本；不是整集字幕。未涉及记录的完整结构必须不变。机器结果先冻结，可选评价随后才读取参考稿；同一评价目录拒绝覆盖。结果始终是 `needs-review`，不是自动改稿授权或已验证声学对齐，也不接入默认 generate/resume 或精简运行包。

本次结果及限制见 核心拼接报告（历史报告 SUBTITLE_TOOL_CORE_SPLICE_REPORT.md，未随核心源码发布）。

## 保留原始整集底稿的局部补丁（离线、显式预览）

新增 `subtitle-tool:word-repair` 的 `prepare-patch`、`verify-patch`、`preview-patch`、`apply-patch` 和 `undo-patch` 子命令。它以最初任务保存的全部原始记录为底稿，仅对严重重复异常提出完整 donor cue 替换；不把较新的 bounded 结果整体升级为底稿。不修改默认 `generate/resume`，不新增模型调用，也不纳入精简运行包的承诺接口。

预览不保存接受动作；明确接受并确认已列出的不确定性后，才能生成独立审核修订副本。复用现有动作快照存储，支持恢复旧快照；无关记录逐字段保留。无效时间仍留在完整 JSON/全文，只有显式 `--export-partial` 才导出合法子集，不能称为完整定时字幕。

命令、撤销语义及冻结后评价见 [局部修订说明](SUBTITLE_TOOL_WORD_REPAIR.md#original-baseline-local-patch-route)；本次真实结果及退化项见 原始底稿补丁报告（历史报告 SUBTITLE_TOOL_BASELINE_PATCH_REPORT.md，未随核心源码发布）。人工参考只用于机器候选冻结后的评价，不作为候选选择依据，状态仍为 `needs-review`。
