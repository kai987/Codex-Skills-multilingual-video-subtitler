# Standalone Subtitle Tool — Bounded Long-form ASR A/B

## 结论先行

2026-09-10（JST）完成一次冻结配置的真实 B：37/37 个窗口成功、0 次重试，完整输入音频均已送入识别。A 复用已验证的历史完整原始响应，本轮新增 A 推理为 0。

**技术指标改善，但完整字幕交付仍未通过。** A 的 16/102 条零时长记录在 B 中变为 0/158；B 仍有 3/158 条请求局部时间越界，因此只显式交付 155 条 partial，不能称为完整 machine-draft。原始字节、全部记录和异常文本均保留。A 同口径导出 86 条 partial，未用其子集替代全量 A 参与比较。

重复正文风险计数由 75 降至 14，但这不是听音确认的重复错误或幻觉数。没有读取参考稿、Gold 或人工修订；CER、漏字率、幻觉率均为 NOT_MEASURED，人工试听为 NOT_PERFORMED。不能据此宣称对白完整、整体准确率提高或正式字幕验收通过。

唯一下一步判断：**有证据支持继续验证该候选，但本轮不推荐切换产品默认策略。** 本轮到此停止，不追加推理、调参、其他模型或自动时间修复。

| 验收维度                           | 本轮结论                                      |
| ---------------------------------- | --------------------------------------------- |
| 实验执行、证据保全、预算与记录对账 | passed                                        |
| 原始时间异常比例                   | 从 15.6863% 降至 1.8987%，异常类型改变        |
| 完整格式/时间交付                  | 未通过：B 仍有 3 条请求越界                   |
| 显式 partial 三格式                | A 86 条、B 155 条，实际写盘重读通过           |
| 文本质量、对白覆盖与人工认可       | 未测量/未执行，不升级结论                     |
| 默认策略与发布授权                 | 未改变；needs-review，finalizationMethod=none |

## 基线、执行快照与身份核验

- BASE_SHA：`0581c386cd316343c304999386ea4216397d37fa`。
- 独立分支：`codex/subtitle-tool-bounded-longform-asr-ab`。
- 真实运行代码提交：`fcba52996989753b8b000e89e6a31d132523e584`；后续文档提交不改变冻结算法。
- 冻结计划哈希：`7d41fe15439ab133c78355ebe647cdd6c98638f023c48dcd39220dac482bf912`。
- 实验标识：`subtitle-tool-bounded-longform-asr-ab-20260910-k81vAc/bounded-longform-asr-ab-hud2F7`。
- 保留的失败准备快照：同一父目录下 `bounded-longform-asr-ab-BlWh3A`，详见初始化说明。

现场验证了历史 task、完整 raw、请求 PCM、媒体、模型、CLI、历史计划、日志共 8 项绑定，执行后全部哈希不变。A 确为一次成功的历史 ASR 响应，后续时间校验失败，而不是技术失败请求或本轮重新生成的结果。

| 身份                        | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| 授权源媒体                  | `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` |
| large-v3-q5_0 模型          | `d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1` |
| whisper-cli                 | `e25f8bab12a19e4df44d8889f35944a89816d7dfb01c0f8e5de4727fb0939924` |
| A 完整 raw-primary.srt      | `0964236e7cd69237642fbfbee92ee7ead6de21ecd7f568e77cfa3f7f760908ec` |
| 完整 WAV 文件               | `707aa78f5bccdfce7fde9a74da85d2e143fb1b55dae9c3dad710165558c62777` |
| WAV 内 PCM 数据，不含容器头 | `6bd772cda01d11929bdb153a412330d88c6c7761fe8dd1bd9f35e52da7a47644` |
| Silero v6.2.0 模型          | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |

固定参数：ja、4 线程、Apple M1 Pro/Metal、空 prompt、Whisper 内置 VAD 关闭、Core ML 关闭、segment SRT、suppress-nst/no-prints、primary-minimal。同一 CLI 的当前 help 选项区与历史保存内容完全一致：best-of=5、beam-size=5、temperature=0、increment=0.2、fallback 开启、max-context=-1、flash attention 开启、processors=1。每块独立 CLI 进程，不传递上一块文本、token 或解码状态；没有编造不支持的 no-context 选项。

历史 argv 未单独保存：有效调用配置来自已保存的 task、冻结的原产品适配层以及同一哈希 CLI 的历史/当前 help，而不是声称获得了不存在的原始 argv 日志。当前每个 B 请求的实际 argv 均保存在 invocation.json。

比较限制：CLI/模型/输入等主身份匹配；历史和当前日志均记录 GGML 0.15.3 与相同后端名称，但历史动态库没有保存哈希，无法证明传递依赖逐字节相同。B 是分块、跨请求隔离和边界处理的组合实验，不能单独归因于 VAD。A 是历史单次运行，不是同条件重复性能基准。

## 冻结分块与真实预算

复用音轨索引 1 的历史单声道 PCM16/16 kHz；容器 origin=0，audioOffset=0。容器标称时长 900.01 秒，PCM 权威长度为 14,400,171 样本，即 900.0106875 秒，没有从显示值反推样本数。没有重新提取音频。

策略预先冻结为 preferred core=25 秒、min core=20 秒、最大请求=30 秒、每侧 context<=0.3 秒、静音连续至少 0.1 秒、Silero threshold=0.5。Silero 使用 CPU/4 线程，保留全部 28,126 个 512-sample 概率帧。所有核心半开区间连续、互斥，联合恰好覆盖原 PCM；静音、音乐及可能被 VAD 漏检的语音都没有从输入中删除。

结果为 36 个静音候选切点、0 次 hard-cut、1 个保留的尾块。最大请求 30 秒，末尾请求 5.217375 秒。总请求 14,745,771 样本，即 921.6106875 秒（原 PCM 的约 1.024 倍）。完整输入覆盖只证明没有漏送音频，不证明没有漏识别。

| 预算/执行                  | A        | B                                       |
| -------------------------- | -------- | --------------------------------------- |
| 历史 ASR 请求              | 1        | 0                                       |
| 本轮新增 ASR 请求          | 0        | 37                                      |
| 成功计划请求               | 历史 1/1 | 37/37                                   |
| 空成功响应                 | 0        | 0/37                                    |
| 本轮技术重试               | 0        | 0                                       |
| 初次 B 检查点命中          | 不适用   | 0                                       |
| 验收恢复检查点命中         | 不适用   | 37/37；新增推理 0                       |
| 本轮请求音频秒数           | 0        | 921.6106875                             |
| 实际 CLI dispatch          | 本轮 0   | 37，串行                                |
| 可直接观测的模型 load 次数 | UNKNOWN  | UNKNOWN：no-prints 未输出完整 load 标记 |

N=37，因此本次累计上限为 38 次请求（另受 <=65 约束）、951.6106875 秒。未使用全局的一次技术重试额度。成功但内容/时间异常的请求未重试。预算与检查点写入持久化哈希链；重复调用没有清空预算。

### VAD 初始化失败与修复的完整记账

首次准备时，现有 ctypes 适配层未注册 Homebrew 动态 GGML 后端，原生进程在 `whisper_vad_init_from_file_with_params` 内断言失败，尚未到达 `MODEL_LOADED` 标记或 `backend.run`。该失败快照和原始错误尾部保留；首次旧 runner 没有保存完整 stderr，不能声称日志完整。

零模型诊断验证 `ggml_backend_load_all` 将可用设备数从 0 变为 3。随后仅在薄封装增加本地后端注册、流式进程日志和 fsync 阶段记录；未改变模型、CPU 配置、VAD 参数、切点策略或 ASR 预算。新建独立准备快照并重新冻结代码身份，没有覆盖原失败现场。

累计 VAD 启动 dispatch=2：首次初始化失败 1 次，随后成功 1 次。完成的模型初始化=1；失败启动是否产生部分模型加载为 UNKNOWN。**完整音频 VAD 推理仍只有 1 次**。新的阶段记录依次为后端注册、模型初始化、模型已加载、推理保留、推理完成。没有第二次完整 VAD 推理，也没有模型下载/更新。

## 分层 A/B 结果

| 指标                            | A：完整历史 raw           | B：全部 37 个 raw 响应     |
| ------------------------------- | ------------------------- | -------------------------- |
| 原始记录数                      | 102                       | 158                        |
| 可解析文本 Unicode codepoint 数 | 1,152                     | 2,472                      |
| 原始异常记录数/比例             | 16 / 15.6863%             | 3 / 1.8987%                |
| ZERO_DURATION                   | 16 / 15.6863%             | 0 / 0%                     |
| REVERSED_INTERVAL               | 0                         | 0                          |
| NEGATIVE_TIME                   | 0                         | 0                          |
| NONFINITE_OR_UNPARSED_TIME      | 0                         | 0                          |
| OUT_OF_REQUEST_RANGE            | 0                         | 3 / 1.8987%                |
| OUT_OF_SOURCE_RANGE             | 0                         | 0                          |
| EMPTY_OR_UNPARSED_TEXT          | 0                         | 0                          |
| SERIALIZATION_COLLAPSE          | 0                         | 0                          |
| 其他序列化文本/时间损失         | 0                         | 0                          |
| 映射后异常记录数                | 16                        | 3                          |
| 重复正文风险记录数              | 75                        | 14                         |
| 边界 alias                      | 0                         | 0                          |
| 保留的边界歧义对数              | 不适用                    | 23                         |
| 请求首尾 0.3 秒附近风险记录数   | 2                         | 58                         |
| 保留合法定时记录                | 86                        | 155                        |
| 未解决记录                      | 16                        | 3                          |
| SRT/ASS/VTT 实际导出            | 86 条 partial，各格式通过 | 155 条 partial，各格式通过 |

异常类别允许重叠，上表的“异常记录数”按记录去重，不是标签相加。可解析文本量包括标点/原有换行等 codepoint，不等于正确对白字数。重复正文风险只计与前面某条正文完全相同的后续记录，没有听音分类。首尾风险会受到 B 请求数增加影响，不是可直接比较的错误率。23 是候选记录对数，不是 23 个已确认语音事件；原文字与时间均保留，没有裁词、合并块内重复或整片去重。

### B 的三个异常去向

| 请求       | raw 局部区间（秒） | 请求长度 | 越界量   |
| ---------- | ------------------ | -------- | -------- |
| chunk-0001 | 0–29.200           | 29.196   | 0.004 秒 |
| chunk-0024 | 23.000–26.380      | 26.376   | 0.004 秒 |
| chunk-0030 | 0–30.000           | 26.856   | 3.144 秒 |

前两条数值上接近时间精度差异，但本轮没有放宽已冻结的界限；第三条也没有 clamp 到块尾。三条均保留在 raw、全文、timing-issues 和 export-map 中，不进入 partial 定时子集。时间映射只应用 inputStart/sampleRate 与 audioOffset 各一次；请求越界没有因映射后落在整片范围内而被洗白。

对账：A `102 = 86 retained + 0 alias + 16 unresolved`；B `158 = 155 retained + 0 alias + 3 unresolved`，互斥且穷尽。原始每请求 SRT、映射前记录、映射后/去重前记录、边界决策、组装后文本分别保留。组装后文本是合法定时子集，不代替完整 raw 全文。

`report --export-partial` 返回 2 是“未取得完整 B machine-draft”的明确退出状态，不是把 partial 验收误写为完整成功。三格式均通过共同百分之一秒精度的真实落盘重读；没有制造最短时长、借用下一句时间或补写台词。

## 成本、资源与质量限制

| 实测阶段                                      | 时间                               |
| --------------------------------------------- | ---------------------------------- |
| 成功准备过程（含身份核验与 VAD）              | 6.207 秒                           |
| 其中 Silero 进程                              | 3.752 秒                           |
| 其中切点规划                                  | 0.003 秒                           |
| B PCM 切片与写入                              | 0.049 秒                           |
| B 请求处理累计（含启动/模型过程及适配层开销） | 236.402 秒                         |
| B run 总墙钟（含串行启动和身份核验）          | 241.000 秒                         |
| 0 推理检查点恢复 run                          | 3.680 秒；整个 CLI 4.172 秒        |
| 离线组装/报告内部阶段                         | 0.230 秒；整个 CLI 0.698 秒        |
| 成功快照 createdAt 到结果冻结的墙钟           | 281.724 秒，含交互等待及检查点验收 |
| A 历史单次请求                                | 188.675 秒，仅历史参考             |

VAD、切点、PCM 切片、请求处理等时间属于包含关系，不能全部重复相加。首次失败初始化与人工调查耗时不包含在成功快照墙钟内，其完整耗时没有可靠计时，记 UNKNOWN。B 实测 run 比 A 历史请求长 52.325 秒；这不是受控重复测量，不能据此宣称稳定性能变化。设备可见为 Apple M1 Pro、GGML 0.15.3，Silero CPU、Whisper Metal；峰值进程内存、能耗、精确 Whisper load 次数为 UNKNOWN，不把设备 recommendedMaxWorkingSetSize 当作实际峰值。

在看到 B 输出之前，已冻结 12 个全片均匀分层的 15 秒抽查区间，以及全部 36 个切点各前后 2 秒的接缝检查。`manual-review.csv` 共 48 行待检查项，全部 NOT_PERFORMED。没有把历史局部参考当成全片参考，没有运行自动模型自评冒充人工试听。CER/S/D/I/N、漏字率、幻觉率均 NOT_MEASURED。

## 工程验证与产物

本轮运行的相关验证如下；不引用旧版本全仓历史测试数作为本轮结果。

- typecheck、全仓 lint、format:check、build:subtitle-tool：通过。
- Vitest 5 个相关文件共 79 项通过，0 skip；其中 22 项 bounded 单元测试已包括在 79 内，不重复计数。
- Node bounded 流程 E2E：9 项通过，0 skip，包括独立进程恢复、累计预算、一次技术重试、异常成功不重试、空响应、取消、半写日志、损坏检查点、并发锁、身份变更、离线报告与磁盘导出。
- Python 后端注册/持久化阶段测试：4 项通过，完全 mock，无模型/音频读取。
- 真实产物严格 JSON Schema、4 项伪造权限负例、样本全覆盖、预算链、结果冻结、原始字节、记录对账、边界决策重算、实际三格式：通过，新增推理 0。
- 真实检查点恢复：37/37 命中，新增 ASR 0。
- 8 项历史绑定文件执行后 SHA-256 不变；原产品实现、锁文件、Skill 2/3 未修改。

初次回归曾遇到 macOS `/var` 临时路径别名与既有 safePath 的冲突，日志保留在 checks-initial；将测试环境 TMPDIR 指向真实 `/private/tmp` 后重跑通过，没有放宽产品路径门禁。最终日志在 checks-final，初始与中间结果不冒充最终通过结果。未重跑所有历史研究测试，也未重跑 A、pyannote、Reazon、CTC/MFA 或任何旧研究链路。

入口、冻结策略及实际测试命令见 [实验使用说明](SUBTITLE_TOOL_BOUNDED_LONGFORM_ASR_AB.md)。本地实验目录包含 `experiment.json`、`vad.json`、`vad-phases.jsonl`、`chunks.json`、`requests.jsonl`、A/B 原始证据与全文、`comparison.json`、`results-freeze.json`、`post-run-verification.json`、`manual-review.csv`、`OUTPUT_INDEX.md` 和本报告副本。

A 字幕位于 `A/subtitles/primary-minimal.partial.{srt,ass,vtt}`；B 位于 `B/subtitles/primary-minimal.partial.{srt,ass,vtt}`。运行与恢复需保留冻结软件身份；不应在另一版算法上冒充同一 manifest 重跑。

本报告及代码可公开；本地 PCM、真实对白、原始字幕、绝对运行路径与诊断日志不属于公开分享产物，不进入 Git。没有更新既有 ZIP、发布 tag/npm/Release、合并默认分支或改变可见性。沿用现有 Skill 的原始记录保全、显式 partial 与发布权限门禁：`qualityStatus=needs-review`、`finalizationMethod=none`、`humanValidated=false`、`machineOnlyReleaseAuthorized=false`。
