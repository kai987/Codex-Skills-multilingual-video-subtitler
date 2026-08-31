# C6.0.1.14.1 Multi-view Speech Inventory Recovery — Acceptance Report

## 结论

工程验收通过，覆盖恢复仅部分成功：正式 Full Queue 的 Missing Audible 从 **3/6→4/6**，Hallucination 保持 **1/1**；额外唯一审核音频为 **19.2225 秒**。不能进入 C6.0.1.15。

当前路线为 `HOLD_FOR_MACHINE_SPEECH_DETECTION_MODEL_CEILING`，同时保留独立的 `SAFETY_RESERVE_SELECTION_INCOMPLETE` 阻塞。一个 Missing 在全部本次 detector/view 中都没有直接重叠，另一个只有部分 Pyannote 支撑但未被选择进审核音频。没有为追求 6/6 调阈值、补目标或补推理。

生产状态仍为 `needs-review`，`finalizationMethod=none`，`machineOnlyReleaseAuthorized=false`，C6.0.2 `HOLD`。本次没有人工终审，没有未见集人类试验，也没有测得的人类时间节省。

本报告只给聚合结果、匿名组件和哈希。原始音频、ASR 文本、源时间区间、Gold-linked 诊断和运行绝对路径保留在 local-only output，不随 Git 提交。

## 冻结、失败尝试及非算法修复

| 对象               | 时间（UTC）              | Semantic hash                                                      |
| ------------------ | ------------------------ | ------------------------------------------------------------------ |
| Final A            | 2026-08-31T11:23:03.280Z | `245b4d32c971ddd3cdfe1d56dfe36d1cea4a940952d67a6cff28cd0ffa8e6806` |
| Final B            | 2026-08-31T11:24:07.468Z | `04071232c7f568a659d6ede10588c2e9a1596167a1be3d1d313b698c518fa2ec` |
| 成功的隔离评估首读 | 2026-08-31T11:31:20.471Z | `b79311513bdb57604fb4d1bbe8c6edf4c0af8945845092d891b175a07168d428` |

每套 Final 冻结 377 个文件引用，包括真实 WAV、缓存证据、模型/运行时身份、全部 A0–A9 projection 和代码快照。两套机器内容字节一致；它们各自的冻结时间与冻结哈希不同是预期行为。

必须保留以下历史，不能删掉后把过程写成一次无失败运行：

- Speech Fresh 首次启动时出现 `DYLD_LIBGGML_RPATH_NOT_FOUND`。它发生在模型加载和 dispatch 前：provider start=1、model load=0、inference=0、ticket=0。仅补上已有动态库目录的子进程环境，未改变模型算法；随后完成10次真实检测。
- Whisper 继承的 worker 发送1个100ms合成静音 warmup transport。运行时产生9帧、90ms spectrogram，按已有短输入 guard 在 encoder/decoder 前返回。它不消耗源音频 ASR inference，但应单列，不可声称总 HTTP 数只有32。依据是当时观察到的 stderr 及 pinned runtime guard；没有另行伪造 warmup stderr 文件。
- 首次隔离 evaluator 已读取 Gold/labels，随后因默认 root 查找只扫描直接子目录，未定位到嵌套的旧评估文件而停止。第一次读取的精确时刻未落盘，只能界定在 **11:27:51.748Z–11:30:47.448Z**，这仍晚于两套冻结。随后根据已绑定的 SHA 显式提供旧评估路径。成功 audit 的 `firstGoldReadAt` 是**成功那次尝试**的首读，不是整个任务最早读取。详情保存在 `c6-0-1-14-1-evaluation-attempt-history.local-only.json`。
- 真实 Schema 校验首次失败：Zod exporter 对固定两项 Provider tuple 漏出 `minItems/maxItems`，AJV strict mode拒绝编译。这不是模型或 Gold 结果问题。修复只补 JSON Schema 两项长度约束，并加严格编译/负例及验收审计。机器 producer、Zod 契约、policy值、模型、目标、匹配规则和已冻结结果全部未改。
- **当前全代码不与最早全代码快照字节一致。** 五个 validation-only 路径（4旧+1新）由独立 manifest 逐文件绑定；1,131 个其他既有文件保持不变。原 policy schema 的副本及前后哈希保留，并验证除两个长度约束外 JSON 语义不变。禁止通过该路径接受任何机器运行源码变化。没有重建/覆盖 Final，也没有在此修复后重新计算 Gold 评估。

原代码快照：`5d42f0c8eaf2f4fafc57a3c7118347df57a530582dba32bc964f0bde0df5a490`。
验收代码快照：`ef6a83a5dbc7928d57c142334196cbe651f7a9b49c4d2865250d908b38f618fd`。
validation-only manifest byte hash：`170c5beeeb6c5212c8505a5278a3c3c9debf660cdd78c7ebaa8dcf83e38d12dc`。

Gold 前的12项代码检查完整保留；非算法修复后重新完成另一套12项检查。验收同时绑定两套日志，既不回填旧日志，也不把后跑的测试伪称为 Gold 前完成。

## 实际模型身份与音频视图

源媒体 SHA：`294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`；847,774,958 bytes。完整 size/mtime/inode read-only证明保存在冻结审计中。

| Detector | Model                                    | Device / network | Model snapshot hash                                                | Runtime identity hash                                              |
| -------- | ---------------------------------------- | ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| SILERO   | silero-v6.2.0-ggml-vad-only              | cpu / offline    | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` | `7fea7a84b6ba99c60377d8af3284120a5e0307b22fe473b2ed0f626dcf3b9af3` |
| PYANNOTE | pyannote/speaker-diarization-community-1 | cpu / offline    | `05e910b0a8e5ae578fab80258d5705c3886243306a54c39daa70785bd0842c03` | `3f56e408012b85a43d0af01cd6183488c1cd42720a3e1ac26c8b93720cba3d4b` |

两种检测器共用的 worker byte SHA：`a3680acc86dbed147b721a7945933f236cd8da57045d9558816f8421e2d1c584`。
Silero binary SHA：`a10282d325f0922cc6a444a1bed05576c4472bc557ceb6577a0f22d7b06bee6a`。
Pyannote runtime binary SHA：`ee3c4103b97e32a98e98cfad7f6ca4d09b2ab2dc16f3d28e18b54a4a0244efe0`。

Silero 使用 Python3.13.14 / NumPy2.5.2 / pinned whisper.cpp1.9.3 VAD C API。Pyannote 使用 pyannote.audio4.0.7、torch/torchaudio2.11.0、NumPy2.5.2、SciPy1.18.1、SoundFile0.14.0、Python3.13.14；CPU4线程。

| Local ASR          | Composite model snapshot hash                                      | Runtime identity hash                                              |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| whisper-large-v3   | `ff4a287dc5a887b797f29d5ba2858cc555f5abbb263c5fccdfe6f394917e1e40` | `189e04ec9249745050c40d8a2aa4609c8cf380397a27b213a8682434bcc0d33e` |
| reazonspeech-k2-v2 | `fef5476b9b75596716c32351bc31aa378fdfd5b98edb54a7daf621e04f73df1a` | `012c097ee66dd3a4576b7c1b9a059ea1a70f72511d3e9ea5fd812a440be87244` |

Whisper large-v3 单模型文件 SHA：`64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`；pinned runtime Metal ON、CoreML OFF，binary SHA：`e2b62f6d45dc3badc49e0b2a8a468a9914f5e018c3692c1fbe6190c443b0b2c2`。Reazon 使用 sherpa-onnx1.13.6 CPU1线程 FP32、snapshot revision `291488c8151be24d7da4bf7af26e533fad96e407`。Composite identity 与单文件 SHA 是不同口径。

| View              | Deduplication       | WAV SHA-256                                                        | PCM SHA-256                                                        |
| ----------------- | ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| NATIVE_MONO       | 唯一 PCM            | `41c9f378c0320cb2466cdfdad420ad52f33940d2983ca6ea5e7fb86ac3d4002c` | `4703100a80f290291cc70ca26c2b19cffc75ebb7f5ba965aeba73adae100fbb6` |
| LEFT              | 唯一 PCM            | `5f245cdafa240745b5f26c81414434c1349de232bf334b8e9b8eff2b9ad34aa9` | `718e65ed982dad7b65afbfeb931e09674b07daa98a33d6bc66806fd0bf6f2dfa` |
| RIGHT             | 唯一 PCM            | `22f3f8fa1b47aa1c651eb6ec4c749dabe1e7e302167d9a3b468cbaddaf7473c1` | `aa9f846357976014b3ae92a6fa381e42130f0e68b0647e5f7238d0f8967bfd0c` |
| CENTER_OR_MID     | 重复 native，不推理 | `41c9f378c0320cb2466cdfdad420ad52f33940d2983ca6ea5e7fb86ac3d4002c` | `4703100a80f290291cc70ca26c2b19cffc75ebb7f5ba965aeba73adae100fbb6` |
| VOICE_BAND_CENTER | 唯一 PCM            | `eff24490ee3fc93f39504157a8d9f3e867436e9d5bdc9c5d39611236d1fa67c2` | `16f4616b4da95e4f4ebd0cd29a4ccd20fb28dfd6afda423d9d0274f72fa33033` |

映射检查 hash：`7d685f271f1758a2bc1bfa9d583fc16ff787629a50e68a9e61b04a9b748d4898`。
所有 view 使用源样本坐标，不能以16k输出样本直接冒充48k源样本。

## 固定策略与执行账本

Policy version：`c6.0.1.14.1-multiview-speech-inventory-v1`。
Policy hash：`2025dba8db2fed2ccbb40f0a7a727441b9e2abd3a61de4536936942a1e8ee318`。

Silero sensitive-v2：threshold0.35、minSpeech160ms、minSilence100ms；extra-sensitive-v1：0.20、96ms、80ms。两者pad/overlap=0、最长12秒。Fingerprint min clip0.3秒、RMS0.002、NCC0.995、margin0.035、residual0.11、second-peak exclusion0.1秒、spectral peak0.35、lag-one0.9995。所有值在 Gold 前固定。

| 阶段                    | 源推理                  | Cache hit  | Model loads | Provider starts |
| ----------------------- | ----------------------- | ---------- | ----------- | --------------- |
| Detector Fresh成功运行  | 10（Silero8+Pyannote2） | 0          | 2           | 2               |
| Detector首个加载前失败  | 0                       | 0          | 0           | 1               |
| Detector Replay         | 0                       | 10/10      | 0           | 0               |
| Local ASR Fresh         | 32（24exact+8context）  | 0          | 2           | 2               |
| Local ASR Replay        | 0                       | 32/32      | 0           | 0               |
| Final A                 | 0                       | 42/42      | 0           | 0               |
| Final B                 | 0                       | 42/42      | 0           | 0               |
| Evaluation / validation | 0                       | 不调用模型 | 0           | 0               |

Speech Fresh/Replay evidence hash：`f6f93f2271308dfc0de9f33a1120bdc4244f7b08b0808fd482bf6a54d573ca66`。
ASR Fresh/Replay evidence hash：`313a9f20cacf5820918cca878c25e6bef0e513009b8d78526e9aab655547e3f9`。
Final A/B machine evidence hash：`7bf0bf4e9913e34cf3d3584eccc3e168c171f8e42e81929e6fac9ce878671c09`。
Safety target semantic hash：`41ee327de452691beea4e30a51be5af2b02e8f950a1f932026fe4b990c153fd0`。

## 真实覆盖：区分检测、目标、音频和词汇

阈值保持旧评估定义：any为严格大于0，majority≥0.5，audible≥0.8，full≥0.95。item lineage/member命中不是可听覆盖，parent min/max不是语音区间。以下分母始终为同一组6个Missing；任何层的不足都没有被排除出分母。

| Ablation | Speech any | Speech audible | Speech full | Target audible | Physical audible | Playback audible | Playback full | Lexical audible |
| -------- | ---------- | -------------- | ----------- | -------------- | ---------------- | ---------------- | ------------- | --------------- |
| A0       | 3/6        | 3/6            | 2/6         | 3/6            | 3/6              | 3/6              | 3/6           | 1/6             |
| A1       | 0/6        | 0/6            | 0/6         | 3/6            | 3/6              | 3/6              | 3/6           | 0/6             |
| A2       | 4/6        | 4/6            | 2/6         | 3/6            | 3/6              | 3/6              | 3/6           | 1/6             |
| A3       | 4/6        | 4/6            | 3/6         | 3/6            | 3/6              | 3/6              | 3/6           | 1/6             |
| A4       | 4/6        | 4/6            | 3/6         | 3/6            | 3/6              | 3/6              | 3/6           | 1/6             |
| A5       | 5/6        | 4/6            | 2/6         | 3/6            | 3/6              | 3/6              | 3/6           | 1/6             |
| A6       | 5/6        | 4/6            | 3/6         | 3/6            | 3/6              | 3/6              | 3/6           | 1/6             |
| A7       | 5/6        | 4/6            | 3/6         | 4/6            | 4/6              | 4/6              | 4/6           | 1/6             |
| A8       | 5/6        | 4/6            | 3/6         | 4/6            | 4/6              | 4/6              | 4/6           | 2/6             |
| A9       | 5/6        | 4/6            | 3/6         | 4/6            | 4/6              | 4/6              | 4/6           | 2/6             |

A1是fingerprint-only检测/词汇层，A2–A5保留旧证据并分别加入指定 detector。A0–A6保留旧物理审核交付，不能靠分析时合成音频拿新增播放覆盖。A7才加入 Gold 前已选的 Safety Targets与真实音频；A8加入有限局部ASR；A9为正式交付。Ablation没有选择或调整生产policy。

以下C1–C6仅为本报告匿名行序，不是可进入机器源码的Gold ID。精确组件身份与原子区间只保存在local-only evaluator artifact。

| 组件 | Existing speech | Fingerprint | Silero native | Silero all views | Pyannote | Inventory | New safety target | Playback | Lexical | 诊断                                      |
| ---- | --------------- | ----------- | ------------- | ---------------- | -------- | --------- | ----------------- | -------- | ------- | ----------------------------------------- |
| C1   | 0.00%           | 0.00%       | 100.00%       | 100.00%          | 88.12%   | 100.00%   | 88.12%            | 100.00%  | 88.12%  | RECOVERED_BY_MULTI_DETECTOR_SPEECH        |
| C2   | 100.00%         | 0.00%       | 92.95%        | 92.95%           | 94.41%   | 100.00%   | 0.00%             | 100.00%  | 0.00%   | AUDIBLE_WITHOUT_LEXICAL_EVIDENCE          |
| C3   | 89.59%          | 0.00%       | 0.00%         | 64.48%           | 64.14%   | 89.59%    | 0.00%             | 100.00%  | 89.59%  | RECOVERED_WITH_LOCALIZED_LEXICAL_EVIDENCE |
| C4   | 0.00%           | 0.00%       | 0.00%         | 0.00%            | 0.00%    | 0.00%     | 0.00%             | 0.00%    | 0.00%   | SPEECH_DETECTOR_MISS                      |
| C5   | 0.00%           | 0.00%       | 0.00%         | 0.00%            | 63.08%   | 63.08%    | 0.00%             | 0.00%    | 0.00%   | SAFETY_TARGET_SELECTION_MISS              |
| C6   | 100.00%         | 0.00%       | 100.00%       | 100.00%          | 82.23%   | 100.00%   | 0.00%             | 100.00%  | 0.00%   | AUDIBLE_WITHOUT_LEXICAL_EVIDENCE          |

C1新增恢复的因果链是：机器检测支撑→冻结Safety Target→真实WAV→实际播放段。C5的约63%检测重叠不够自动代表全句，也没有被选入播放队列。C4为本配置的全检测缺失，不能直接推断为普遍模型上限或确定音乐/混音根因。

## 九种真实播放计划与负担

| Plan                           | Actual unique seconds | Missing audible | Hallucination audible |
| ------------------------------ | --------------------- | --------------- | --------------------- |
| UNIQUE_AUDIO_10_PERCENT        | 89.102375             | 1/6             | 0/1                   |
| UNIQUE_AUDIO_20_PERCENT        | 179.017979            | 1/6             | 0/1                   |
| UNIQUE_AUDIO_30_PERCENT        | 269.912604            | 1/6             | 1/1                   |
| UNIQUE_AUDIO_40_PERCENT        | 359.011979            | 1/6             | 1/1                   |
| UNIQUE_AUDIO_50_PERCENT        | 449.878090            | 1/6             | 1/1                   |
| ALL_MANDATORY                  | 235.195354            | 1/6             | 0/1                   |
| FULL_QUEUE                     | 824.353806            | 4/6             | 1/1                   |
| FULL_QUEUE_CONSERVATIVE_SPEECH | 817.921618            | 4/6             | 1/1                   |
| FULL_QUEUE_WITH_SAFETY_RESERVE | 824.353806            | 4/6             | 1/1                   |

旧队列805.131306秒，新队列824.353806秒，增量19.2225秒；当前完整审核已占整集91.59385%。24个新Target的union只有28.022875秒；并未用整集catch-all获得覆盖。23个Target不与**已知Gold Missing**重叠、合计23.78625秒，只能作为潜在负担proxy，不是已证实的非语音/误报真值。

`mandatoryTargetCount=316` 是兼容音频合同中的audio-required全队列计数，**不是**Required-ranked Item计数。真正REQUIRED Item仍为23、mandatory计划仍为235.195354秒。Items总计198；full计划绑定187，另外11个未能可靠定位的Item仍在full UI中可见而不获音频覆盖信用。

## 工程、Schema与质量验收

两轮均实际执行 `npm ci --offline`、schema generation、typecheck、lint、format、build、完整test、non-E2E unit、E2E、targeted、cross-version及UI检查。后一轮结果：

| 检查                                                  | 结果                                         |
| ----------------------------------------------------- | -------------------------------------------- |
| npm ci / generate / typecheck / lint / format / build | PASS                                         |
| Complete test suite                                   | 1,123 passed /2 skipped，131 files           |
| Non-E2E unit                                          | 1,066 passed /1 skipped，104 files           |
| E2E                                                   | 57 passed /1 skipped，27 files               |
| C6.0.1.14.1 targeted                                  | 78/78                                        |
| Cross-version                                         | 616/616，82 files                            |
| Review UI automated                                   | 46/46                                        |
| Real browser read-only acceptance                     | 26/26，0 console error/warn，session始终null |
| New schema strict compilation                         | 31/31                                        |
| Generated schemas                                     | 421 total（+31）                             |
| Real artifact Zod + JSON Schema validation            | 68 instances PASS；validation自身另校验      |
| Final engineering checks                              | 46/46                                        |
| Skill quick_validate                                  | PASS                                         |

新增strict tuple负例覆盖空、少项、倒序、额外Provider；冻结后审计负例拒绝runtime路径变化。没有为了使AJV通过而关掉strict mode。真实浏览器检查了9种计划、不同预算下队列、筛选、新旧Target播放、速度、停止、导航、候选复制不保存、明确Add new cue入口与HTTP206。没有把自动化fixture或播放点击当作人类复核。

Canonical 161 Cues及7个保护文件字节保持。质量指标因此只读复用**经过源/Gold/机器包哈希绑定的旧评估**，没有伪称重新转写质量提升：

- exact CER=0.6601049869，normalized CER=0.6015625，Gold text coverage=0.96484375；
- Missing=6，Hallucination=1，Material text errors=77，Severe timing errors=53；
- start MAE=1.609108228秒，end MAE=1.607835516秒，boundary p95=5.385秒，median timing IoU=0.582466568；
- machine overlap pairs=48（只读重新计数）。

Validation semantic hash：`d817985b494318743ff2357270679821fcc662fc7a874d07ccad8e193647dcdf`。
Speech evaluation semantic hash：`2a4818b8ccb72fc3c5d9779fd28907d73aae03e61e3ac3149d61c45ad019344b`。
Shareable summary semantic hash：`63842af19b0244f679bd918b42bf4602a8ed213faff0bb4a01f70b4022ab6186`。

## 147项验收追踪

| #   | 验收项                              | 真实结果与边界                                                                                                                                                                         |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Executive Conclusion                | 工程验收 PASS（46/46）；正式 Missing Audible 4/6、Hallucination 1/1，覆盖门槛未通过。生产仍为 needs-review / finalizationMethod=none。                                                 |
| 2   | Branch                              | codex/c6-0-1-14-1-speech-inventory-recovery。                                                                                                                                          |
| 3   | Baseline                            | d42f7b3fed8b811efbe11d163cbec1a38eeb519a；只读复用已经完成的 C6.0.1.14 产物。                                                                                                          |
| 4   | C6.0.1.14 Replay                    | 旧 Final A/B 均 99/99 哈希通过；161 Cue、292 Target、174 Item、60 Region/WAV、494 Playback Segment。                                                                                   |
| 5   | Goals                               | 恢复独立的 source-native speech inventory、可追溯历史音频、有限局部 ASR 和真实审核播放覆盖。                                                                                           |
| 6   | Non-goals                           | 不更改 Canonical 文本、时间、排版；不训练 Ranker；不启动 C6.0.1.15、human trial 或 C6.0.2；不修改 Skill 2/3。                                                                          |
| 7   | Why C6.0.1.15 Is Still Blocked      | 两个不同阻塞仍存在：匿名 C4 没有直接语音检测重叠；C5 有部分 Pyannote 重叠，但未被预算选择成可听 Target。                                                                               |
| 8   | Authorization Boundary              | Speech detector 上限 12 次；局部 ASR 上限 32 次。Fresh 分阶段显式授权；重放与验收没有新模型推理。                                                                                      |
| 9   | Whole-media Speech Detection vs ASR | 全源检测只返回 speech activity；本轮 whole-media ASR=0。旧 64 份有效局部探测结果、66 次历史尝试仅作为旧阶段事实，不算本轮新执行。                                                      |
| 10  | Source Audio Stream Identity        | 源音频 stream=1、48 kHz、stereo、timebase=1/1000、PTS origin=0；媒体时长 900.01 秒。源身份见下方哈希与 local-only audit。                                                              |
| 11  | Audio View Design                   | 计划/实际 5 个视图：native mono、left、right、center/mid、voice-band center；4 份唯一 PCM。                                                                                            |
| 12  | View Deduplication                  | Center/mid 与 native mono 的 PCM 完全相同；保留映射记录，但不重复安排模型推理。                                                                                                        |
| 13  | View Time Mapping                   | 每视图 16 kHz mono、14,400,171 frames；48,000/16,000 整数有理映射，原点为 0；末端限制在源媒体边界内。                                                                                  |
| 14  | View Transform Tests                | 5 个变换的合成脉冲/重采样检查通过；3 秒源生成 48,000 帧；每视图 3 个脉冲的峰值延迟均为 0；变换失败=0。                                                                                 |
| 15  | Legacy Quarantine Baseline          | 剩余隔离 lineage 1,694；旧阶段 929 原验证 +139 sample-chain 验证=1,068，不冒充本轮新恢复。                                                                                             |
| 16  | Physical Legacy Audio Availability  | 发现 60 个保留音频候选。保留文件存在不等于其 source-global 位置已证实。                                                                                                                |
| 17  | Fingerprint Candidate Count         | 全源匹配实际搜索 35 份唯一 clip，合计 897.9995625 秒；未超过冻结的 256 clips /900 秒预算。                                                                                             |
| 18  | Exact PCM Recovery                  | 本轮真实 exact PCM 恢复=0；合成 exact 控制通过。                                                                                                                                       |
| 19  | Sample-chain Recovery               | 本轮真实 sample-chain 新恢复=0；旧阶段 139 条保留为旧基线。                                                                                                                            |
| 20  | Unique Fingerprint Recovery         | 唯一近似指纹恢复 199 个 lineage entry；其中 43 条有可用局部语音/词汇边界。不能把 199 个 parent entry 都算成 Speech。                                                                   |
| 21  | Ambiguous Fingerprints              | 真实 fingerprint ambiguous=0；重复音频负例能拒绝并产生歧义状态。                                                                                                                       |
| 22  | Missing Audio Bytes                 | 526 个 lineage entry 没有保留音频字节；另外 506 条为 FROZEN_FINGERPRINT_BUDGET_OR_FORMAT_DEFERRED。没有单独的 Extraction Config Unresolved 计数，不能把这 506 条全部算成提取配置错误。 |
| 23  | Fingerprint Threshold Freeze        | 阈值在 Gold 前固定：NCC≥0.995、second-locus margin≥0.035、normalized residual≤0.11；完整参数及 policy hash 见下文。                                                                    |
| 24  | Fingerprint False-match Controls    | 真实 Python 实现的 exact、duplicate、gain、silent、tone 合成控制通过；exact/增益位置误差为 0；不使用 Gold 搜索窗口。                                                                   |
| 25  | Silero Runtime Identity             | Silero v6.2.0 ggml VAD-only，CPU，offline；model/runtime/binary/worker 哈希见 Runtime Identity 表。                                                                                    |
| 26  | Silero View/Profile Runs            | Silero 计划/完成 8 次：4 个唯一视图 ×2 个冻结 profile。                                                                                                                                |
| 27  | Silero Model Loads                  | Silero 成功运行 model load=1；另有一次加载前动态库启动失败，未加载模型、未推理，单独记账。                                                                                             |
| 28  | Silero Speech Intervals             | Silero 原始 interval 1,043：native 264，非 native 779；这些是请求输出记录数，不是独立语句数。                                                                                          |
| 29  | Pyannote Runtime Identity           | Pyannote community-1，CPU，offline；anonymous speech union，不保留人物身份；实际 Runtime Identity 见下文。                                                                             |
| 30  | Pyannote Runs                       | Pyannote 计划/完成 2 次：native 与 voice-band；model load=1、成功 provider start=1。                                                                                                   |
| 31  | Pyannote Speech Intervals           | Pyannote 原始 interval=428（220+208）。standard/exclusive track 不重复计独立 detector。                                                                                                |
| 32  | Detector Correlation                | Silero 全部 view/profile 只属于一个相关 family；Pyannote 两种 track/两视图属于一个 family；旧 Whisper token/VAD/指纹共用 LEGACY_WHISPER family。                                       |
| 33  | Multi-view Support                  | 主分类 MULTI_VIEW_SPEECH_POSITIVE=446；另按 Silero 至少两个视图直接支撑计 823 个原子区间，两者口径不同。                                                                               |
| 34  | Multi-detector Support              | Silero/Pyannote 同时支撑 589 个原子区间；满足至少 80ms 独立重叠并进入 MULTI_DETECTOR_CONFIRMED 主分类的为 317。                                                                        |
| 35  | Fresh Speech Sweep                  | Fresh detector=10/12、cache hit=0、model loads=2、成功 provider starts=2；再加首次加载前失败的 provider start=1。隐式 retry=0。                                                        |
| 36  | Speech Sweep Cache Replay           | Speech Replay 10/10 exact cache hit；miss/inference/model load/provider start=0；语义哈希与 Fresh 相同。                                                                               |
| 37  | Source-global Speech Inventory V4   | Inventory V4：1,644 observation、1,440 atomic island；native speech union=595.894625 秒。                                                                                              |
| 38  | Inventory Interval Count            | 1,440−145=1,295 个额外区间记录；边界分区口径变了，不能称为新增 1,295 段对白。                                                                                                          |
| 39  | Multi-detector Count                | MULTI_DETECTOR_CONFIRMED 主分类=317。                                                                                                                                                  |
| 40  | Fingerprint-recovered Count         | LEGACY_FINGERPRINT_CONFIRMED 主分类=40；输入 fingerprint speech observation=43。                                                                                                       |
| 41  | Multi-view Count                    | MULTI_VIEW_SPEECH_POSITIVE 主分类=446；不把多视图重复算独立模型票。                                                                                                                    |
| 42  | Single-detector Count               | 仅一个现代 detector 支撑的区间=767（Silero-only 442、Pyannote-only 325）；SINGLE_DETECTOR_HIGH_RECALL 主分类仅 1。                                                                     |
| 43  | Detector Disagreement Count         | Detector 支撑不对称（Silero XOR Pyannote）=767；这不是强反证。strongContradiction=0，相关性膨胀=0。                                                                                    |
| 44  | Timebase-unverified Count           | Timebase-unverified=0；未把 parent min/max envelope 当成语音。                                                                                                                         |
| 45  | Cue Coverage Subtraction            | 按真实 source-native 样本边界减去 Final Cue 覆盖，保留部分交叠信息。                                                                                                                   |
| 46  | Existing Target Subtraction         | 再减去旧 292 个经过物理绑定的 Review Target；不使用 parent cue envelope 代替实际区间。                                                                                                 |
| 47  | Uncovered Speech Candidates         | Uncovered=208，union=75.3261041667 秒；主分类 multi-detector 27、fingerprint 3、multi-view 116、Pyannote-only 37、low-support 25。                                                     |
| 48  | Safety-reserve Policy               | Gold 前固定：最多 24 Targets、60 秒 union、单 Target≤12 秒、最小 0.12 秒，按强度及 60 秒分箱的时间多样性选择。                                                                         |
| 49  | Safety-reserve Target Count         | 实际 24 Targets：strong speech 20、possible speech 4，全部 RECOMMENDED；没有提升为 REQUIRED。                                                                                          |
| 50  | Target Union Seconds                | 新 Target union=28.022875 秒，预算通过。                                                                                                                                               |
| 51  | Timeline Diversity                  | 覆盖 15 个全源分箱中的 13 个；排序只用机器证据及固定时间分箱，不读取 Gold。                                                                                                            |
| 52  | Overflow Candidates                 | 66 个 eligible candidate 因预算未选，118 个仅审计；24+66+118=208。                                                                                                                     |
| 53  | Whole-episode Catch-all Guard       | Catch-all=0。完整队列接近全片是旧基线已有的高负担，不隐去最终 91.59385% 的占比。                                                                                                       |
| 54  | Local ASR Authorization             | ASR Fresh 显式授权；12 个 exact target 和 4 个 context target 在执行前已冻结。                                                                                                         |
| 55  | ASR Probe Target Count              | 12 个 Target，每个执行 Whisper 与 Reazon exact。                                                                                                                                       |
| 56  | Whisper Exact Requests              | Whisper exact：计划 12，实际 12。                                                                                                                                                      |
| 57  | Reazon Exact Requests               | Reazon exact：计划 12，实际 12。                                                                                                                                                       |
| 58  | Context Escalations                 | Context target=4，每 Provider 4 请求，共 8；Whisper 4 可投影，Reazon 4 因 point timestamps 不能提供可信 span 而拒绝投影。                                                              |
| 59  | Total ASR Requests                  | 32 个 source-audio ASR 请求（24 exact+8 context），32 个 consumed inference；另有 1 个非源音频 warmup transport，详见异常记账。                                                        |
| 60  | Hidden Retry Count                  | Hidden retry=0；没有失败后补跑、自动 fallback 或用剩余预算补目标。                                                                                                                     |
| 61  | ASR Fresh Inference                 | Fresh ASR 32/32 有落盘结果；cache hit=0；Whisper/Reazon 各 load/start=1。                                                                                                              |
| 62  | ASR Cache Replay                    | ASR Replay 32/32 hit；miss/inference/model load/provider start=0。                                                                                                                     |
| 63  | Empty Outputs                       | Whisper empty=0，Reazon empty=0；未被 ASR 选择的 12 个 Target 记为未解析，不伪装成 both-empty。                                                                                        |
| 64  | Persistence Failures                | 持久化失败=0；写 dispatch ticket 后才推理，失败也消耗预算，不回收 ticket。                                                                                                             |
| 65  | Localized Lexical Evidence          | 新 localized Whisper=16、Reazon=12；另外保留 43 个 fingerprint 历史词汇候选与 24 个旧 probe target。                                                                                   |
| 66  | Cross-model Agreement               | 严格跨模型词面 agreement=0；不因此自动造句。                                                                                                                                           |
| 67  | Pronunciation Agreement             | Pronunciation agreement=1。                                                                                                                                                            |
| 68  | Single-model Candidates             | Single-model-only Target=0（两家在所选 12 Targets 都有非空输出）；不是说没有各自的候选。                                                                                               |
| 69  | ASR Disagreement                    | Cross-model disagreement Target=11；另有 12 个未选择 ASR 的 Target 保持 unresolved。                                                                                                   |
| 70  | Lexical Advisory                    | 可听但无局部词汇的两个 Missing 是 advisory，不是自动插入许可；词汇候选可用性也不是正确率证明。                                                                                         |
| 71  | Missing Evidence V4                 | Missing V4=24 行：ASR_DISAGREEMENT 11、SPEECH_INVENTORY_STRONG 11、SPEECH_INVENTORY_SAFETY_RESERVE 2；strongMissing=0。                                                                |
| 72  | Review Targets V3                   | Targets V3：292→316，新增 24，旧 Target 删除=0。                                                                                                                                       |
| 73  | Review Items V5                     | Items V5：174→198，新增 24；REQUIRED 保持 23。full plan 绑定 187 Items，另 11 个 unresolved Item 继续在 UI 可见。                                                                      |
| 74  | Review Regions V4                   | Regions V4：60→75；新 Region=15；14 个 disjoint Item 导致 17 次区域拆分；75/75 Region 覆盖全部 Target。                                                                                |
| 75  | Physical Audio Manifest V4          | Audio Manifest V4：75 计划/75 实际/75 可播放/75 哈希验证；提取失败=0，24/24 新 Target、316/316 全 Target 物理绑定。                                                                    |
| 76  | Playback Timeline V3                | Playback V3：576 Segments、576/576 Audio Mapping、316/316 Target Mapping；9 个冻结计划。                                                                                               |
| 77  | Baseline Full Queue Seconds         | 旧 full queue unique audio=805.1313055556 秒。                                                                                                                                         |
| 78  | Final Full Queue Seconds            | 新 full safety queue unique audio=824.3538055556 秒。                                                                                                                                  |
| 79  | Incremental Unique Audio            | 增量 unique audio=19.2225 秒；clip duration sum=1,016.117875 秒，不混用总和与去重 union。                                                                                              |
| 80  | New Region Count                    | 15 个新 Region，Final A/B 各独立重建同样的 75 份真实 WAV。                                                                                                                             |
| 81  | Safety-reserve False Positives      | 没有已验证的 true false-positive 数。23 个新 Target 未与已知 Gold Missing 重叠，是 burden proxy，而不是 23 个已证实误报。                                                              |
| 82  | Audio Seconds per Recovered Missing | 新增 1 个 Missing 达到 audible 门槛；增量成本=19.2225 秒/个，不是测得的人类耗时。                                                                                                      |
| 83  | Machine Freeze                      | Final A/B 各冻结 377 个文件引用；完成时间和哈希见 Freeze 表。两套机器内容字节一致，冻结文件自身时间戳不同。                                                                            |
| 84  | Gold First Read                     | 成功 evaluator 首读为 2026-08-31T11:31:20.471Z；此前一次路径查找失败已读 Gold，其时间仅能界定在 11:27:51.748Z–11:30:47.448Z；均晚于 A/B 冻结。                                         |
| 85  | A0 Baseline                         | A0：speech any/audible/full=3/3/2（分母 6），正式播放 audible/full=3/3。                                                                                                               |
| 86  | A1 Fingerprint                      | A1：fingerprint-only speech 与 lexical 对六个 Missing 的直接重叠=0；旧审核音频不变，播放仍 3/6。                                                                                       |
| 87  | A2 Silero Native                    | A2：Existing+native sensitive，speech=4/4/2；播放仍 3/6。                                                                                                                              |
| 88  | A3 Silero Profiles                  | A3：Existing+native 双 profile，speech=4/4/3；播放仍 3/6。                                                                                                                             |
| 89  | A4 Silero Multi-view                | A4：Existing+Silero 多视图，speech=4/4/3；相对 native 没有再增加原先缺失的 Missing 数；播放仍 3/6。                                                                                    |
| 90  | A5 Pyannote                         | A5：Existing+Pyannote，speech=5/4/2；包含 C5 的部分独立支撑，但旧播放仍 3/6。                                                                                                          |
| 91  | A6 Combined Inventory               | A6：合并 Inventory，speech=5/4/3；旧 Review Delivery 保留，播放仍 3/6。                                                                                                                |
| 92  | A7 Safety Targets                   | A7：加入冻结 Safety Targets 和物理音频后，播放 audible/full 提高为 4/6。                                                                                                               |
| 93  | A8 Local ASR                        | A8：加入局部 ASR 后，localized lexical any/audible=2/6；播放仍 4/6。                                                                                                                   |
| 94  | A9 Final Review Package             | A9：正式 9-plan Final Review Package；Missing audible/full=4/6，Hallucination audible=1/1。                                                                                            |
| 95  | Missing Speech Inventory Recall     | Machine speech any=5/6、majority=5/6、audible=4/6、full=3/6；不得把 any 当作 audible。                                                                                                 |
| 96  | Missing Target Recall               | Direct target any/audible=4/6、full=2/6。                                                                                                                                              |
| 97  | Missing Physical Audio Recall       | Physical audio any/audible/full=4/6。                                                                                                                                                  |
| 98  | Missing Playback Audible Recall     | 正式 FULL_QUEUE_WITH_SAFETY_RESERVE 的 ≥0.80 可听覆盖=4/6。                                                                                                                            |
| 99  | Missing Playback Full Recall        | 同计划 ≥0.95 full coverage=4/6。                                                                                                                                                       |
| 100 | Missing Lexical Recall              | Localized lexical any/audible=2/6、full=0/6；这里评估的是候选区间可用性，不证明词面正确。                                                                                              |
| 101 | Hallucination Playback Recall       | Hallucination Playback Audible=1/1，保持基线值。                                                                                                                                       |
| 102 | Component 1 Diagnosis               | C1：旧 speech=0；native Silero=100%、Pyannote=88.12%；新 Safety Target 支撑后物理/播放=100%，词汇区间=88.12%，是本轮新增恢复。                                                         |
| 103 | Component 2 Diagnosis               | C2：已有可听覆盖保持 100%，新 detector 补充支撑；localized lexical=0，保留人工核对。                                                                                                   |
| 104 | Component 3 Diagnosis               | C3：旧覆盖已存在；native Silero=0、多视图=64.48%、Pyannote=64.14%，最终 Inventory=89.59%、播放=100%；不是本轮新增 Missing 恢复。                                                       |
| 105 | Component 4 Diagnosis               | C4：所有已验证旧证据、指纹、Silero view/profile、Pyannote 都无直接重叠；Target/WAV/Playback 均为 0，属于本配置下 detector miss。                                                       |
| 106 | Component 5 Diagnosis               | C5：Silero=0、Pyannote=63.08%；Inventory 有 majority overlap，但没有选择成 Safety Target，物理/播放为 0；属于 selection miss。                                                         |
| 107 | Component 6 Diagnosis               | C6：旧可听覆盖保持 100%；localized lexical=0，保留人工核对。                                                                                                                           |
| 108 | Fingerprint Contribution            | 真实新 fingerprint 对六个 Missing 的直接恢复=0。原三个 miss 是否对应未能映射的保留历史字节仍未知，不能由没有恢复反推字节不存在。                                                       |
| 109 | Silero Contribution                 | Silero native 为原三个 miss 中的 C1 新增直接覆盖；全部 Silero view/profile 对该组三个 miss 总共仍只新增 1 个。                                                                         |
| 110 | Pyannote Contribution               | Pyannote 为 C1 提供独立佐证，并独立检测到 Silero 没有的 C5 片段；后者尚未成为可听审核恢复。                                                                                            |
| 111 | Multi-view Contribution             | 多视图对已覆盖的 C3 提供额外局部支撑；在本次六个 Missing 上，相对 native 的额外新 miss 恢复=0。                                                                                        |
| 112 | Local ASR Contribution              | 新 ASR 使局部词汇区间可用的 Missing 从 1/6→2/6；没有增加可听数、没有自动修改字幕。                                                                                                     |
| 113 | False-positive Burden               | 未与已知 Missing 重叠的 Target proxy：23 个、23.78625 秒。完整审核队列为全片 91.59385%，没有人类效率提升结论。                                                                         |
| 114 | Ranker Not Retrained                | rankerRetrained=false；R3 权重/排序未重新拟合；new OOF run=false。                                                                                                                     |
| 115 | Mandatory Queue Diagnostic          | ALL_MANDATORY=235.195354 秒，Missing 1/6、Hallucination 0/1；只作 Ranker 诊断，不单独阻止 Full Queue Gate。                                                                            |
| 116 | Full Queue Gate                     | Full Queue Gate=false：Missing 未达到 6/6；不允许通过扩大 denominator、降低阈值或隐藏 unresolved 来通过。                                                                              |
| 117 | Engineering Gate                    | 最终工程检查 46/46 PASS，含两轮代码日志绑定、缓存、WAV、A/B、只读、浏览器和严格 Schema。                                                                                               |
| 118 | Evaluation Integrity                | 10 个 ablation 的 interval-integrity failures=0；保留旧 component 匹配与分母；source/Gold identity 前后一致。                                                                          |
| 119 | Route Decision                      | HOLD_FOR_MACHINE_SPEECH_DETECTION_MODEL_CEILING。                                                                                                                                      |
| 120 | Route Blockers                      | 同时记录 MACHINE_SPEECH_DETECTION_MISS（C4）与 SAFETY_RESERVE_SELECTION_INCOMPLETE（C5），不把二者都归咎于模型。                                                                       |
| 121 | Route Advisories                    | 两个可听但缺词汇的 Missing、mandatory 子集召回、历史字节不可归属是独立 advisory；不伪造解决状态。                                                                                      |
| 122 | Machine Text Parity                 | Canonical text mutation=0；语义哈希 e117fd080a71b244bc39086c82a4972c9335f7c64cef07cc2df1bfbbcd992e05。                                                                                 |
| 123 | Machine Timing Parity               | Canonical timing mutation=0；哈希 e85d580e2846701617cc7c4b75501d8e44210abd2c2b76152962b6df9a995936。                                                                                   |
| 124 | ASS/SRT/VTT Parity                  | Presentation mutation=0；哈希 ddb9c9f5f97acb7bc5c87925983da6d64d12e1a825025f736744f32aeec13d98；正常/Best-effort ASS/SRT/VTT 与 JSON 共 7 文件字节保持。                               |
| 125 | Final A/B Parity                    | Final A/B 机器产物字节一致，各 10 detector+32 ASR cache hits；两套新推理/load/start=0。当前验收代码与最早全代码快照有已审计的 validation-only 差异，不能称全代码完全未变。             |
| 126 | Whole-media ASR Guard               | 本轮整集 ASR=0；只允许全源 speech activity，不调用整集转录。                                                                                                                           |
| 127 | Runtime Gold Input                  | runtimeGoldInputCountBeforeFreeze=0；机器侧始终不接收 Gold，只有冻结后 evaluator 读取。两次 evaluator 尝试的首读区别在异常账本说明。                                                   |
| 128 | Dataset Hardcoding                  | 发布前检查 81 个变更文件，没有真实片名、Gold component ID/Gold SHA 或用户绝对路径进入新增生产/测试代码。                                                                               |
| 129 | Network                             | 检测、指纹、局部 ASR 与评估均离线；无模型下载、无新模型安装；Git push/remote HEAD 查询单独作为授权网络活动记录。                                                                       |
| 130 | Source Read-only                    | Source SHA/size/mtime/inode before==after；完整 identity 保存在 local-only freezes/audit。                                                                                             |
| 131 | Gold Read-only                      | Gold SHA/size/mtime/inode before==after；不把 Gold 文本或身份路径写入生产代码。                                                                                                        |
| 132 | Shareable Audit                     | Aggregate-only shareable 审计 PASS：absolute path、secret、raw dialogue/audio、source/Gold interval、broken reference 均为 0；原始 output 不因此变成可公开数据。                       |
| 133 | Unit Tests                          | 完整 npm test：1,123 passed /2 skipped；独立 non-E2E unit：1,066 passed /1 skipped；均真实重跑。                                                                                       |
| 134 | E2E                                 | E2E：57 passed /1 skipped，27 个文件。                                                                                                                                                 |
| 135 | UI Tests                            | UI 自动测试 46/46；真实浏览器只读检查 26/26、控制台 error/warn=0、HTTP Range=206、session before/after=null。                                                                          |
| 136 | Targeted Tests                      | C6.0.1.14.1 targeted=78/78；包含真实无模型指纹控制、预算/重试负例、严格 Schema 及冻结后 validation-only 变更拒绝测试。                                                                 |
| 137 | Cross-version Regressions           | C5.19/C6 版本回归=616/616、82 个文件；没有 Skill 2/3 源码变化。                                                                                                                        |
| 138 | Schema Count                        | Schema 总数 421（基线 390、新增 31）；31 个新 Schema 全部严格编译；68 份真实实例双重校验通过，validation 自身另作 JSON Schema 校验。                                                   |
| 139 | Skill Validation                    | Skill 1 quick_validate PASS；只增加本版本的授权/冻结/回放说明与参考文档，不变更 Skill 2/3。                                                                                            |
| 140 | C6.0.1.15 Readiness                 | C6.0.1.15 readiness=false；没有启动 Region Ranker Recalibration。                                                                                                                      |
| 141 | C6.0.2 Status                       | C6.0.2=HOLD；machineOnlyReleaseAuthorized=false。                                                                                                                                      |
| 142 | Human Trial Status                  | humanTrialStarted=false；没有保存人工决策、没有创建真实 session，没有宣称实际人类时间收益。                                                                                            |
| 143 | Remaining Risks                     | 已知样本不代表未见集泛化；缺字节/不可映射历史证据仍不可归属；候选词汇弱、覆盖仍漏 2 个、完整审核负担已接近全片。                                                                       |
| 144 | Next-stage Recommendation           | 下一阶段需分别处理 Detector Model Ceiling 与 Safety Target Selection；尚无证据把 C4 的根因具体判为音乐/混音，因此不直接宣称需要 source separation。不得按本集 Gold 时间补目标。        |
| 145 | Commits                             | 六个范围明确的代码提交见 Commit 表；本报告/Skill 说明使用单独 docs acceptance 提交。                                                                                                   |
| 146 | Remote HEAD                         | 最终文档提交的确切 SHA、upstream/remote equality 与 clean worktree 由 git-delivery-verification.local-only.json 和最终回复记录；不在自引用报告中伪造自身 commit SHA。                  |
| 147 | Output Paths                        | 本轮 15 个 output 目录见 Output Boundary 表；Final A/B 为正式机器结果；早期失败目录只作审计历史，不覆盖旧产物。                                                                        |

## Q1–Q24

| 问题 | 回答                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1   | 原三个 miss 中，可由已验证历史 source mapping 归属的恢复数为 0；未映射 clip 是否包含这些片段仍未知。不能把“0 个确认”说成“0 份历史音频存在”。                                                                 |
| Q2   | 全体隔离 entry：exact PCM=0、sample-chain=0、unique approximate fingerprint=199；其中可作语音/词汇观察的为 43。该恢复对原三个 Missing 的可确认直接贡献为 0。                                                 |
| Q3   | 全体隔离 entry 有 526 个缺字节、0 个实际 ambiguous、463 个低支持、506 个因冻结预算或格式条件而 deferred。Extraction Config Unresolved 未单独计数；它们与原三个 miss 的逐一归属仍无法证明，不能编造分类计数。 |
| Q4   | Native Silero 对原三个 miss 新覆盖 1 个（C1）。                                                                                                                                                              |
| Q5   | 相对 native，多视图对原三个 miss 再新增 0 个；它对本来已覆盖的 C3 提供约 64.48% 的局部检测支撑。                                                                                                             |
| Q6   | 是。C5 有约 63.08% Pyannote overlap，而所有 Silero 视图为 0；但没有进入可听队列，不能称为最终恢复。                                                                                                          |
| Q7   | 它们共享模型和错误模式，相关性分组为一个 SILERO family。多视图提升稳健性，不能变成多份独立模型同意。                                                                                                         |
| Q8   | 按本版原子分区记录为 1,440−145=1,295；这不是新增 1,295 句。新清单总 union 为 595.894625 秒。                                                                                                                 |
| Q9   | 208 个、75.3261041667 秒，来自 Final Cue 与旧 Target 的真实区间减法。                                                                                                                                        |
| Q10  | 24 个 Target，union 28.022875 秒；strong 20、possible 4，全部非 mandatory。                                                                                                                                  |
| Q11  | 没有。Catch-all=0，新 union 低于 60 秒。仍公开 full queue 已达全片 91.59%。                                                                                                                                  |
| Q12  | 32 个源音频 ASR 请求，严格≤32；另有 1 个非源 warmup HTTP transport，0 次 warmup encoder/decoder，不能把 32 说成总 HTTP 请求数。                                                                              |
| Q13  | 没有隐藏 ASR 重试、落盘失败后补跑或 Gold 后 Backfill。另有加载前启动失败、评估文件查找重试及 validation-only Schema 修复，均不消耗源推理且单独审计。                                                         |
| Q14  | 词面 agreement 0、发音 agreement 1、single-model-only 0、disagreement 11、both-empty 0；另 12 个 Target 未被 ASR 选择。                                                                                      |
| Q15  | Direct speech any/majority overlap 为 5/6；按≥0.8为4/6，≥0.95为3/6。                                                                                                                                         |
| Q16  | Physical Review Audio audible=4/6，实际 Playback audible=4/6；全部已建立的316个Target物理绑定成功与“六个Gold Missing全覆盖”是两个不同命题。                                                                  |
| Q17  | 没有，只从3/6到4/6，不是6/6。                                                                                                                                                                                |
| Q18  | 是，1/1。                                                                                                                                                                                                    |
| Q19  | C1 是本轮新增可听恢复：native/多视图 Silero + Pyannote 独立支撑 + Safety Target/真实音频。Fingerprint 没有新增确认恢复；C5 仅 Pyannote 检测到局部而未可听。                                                  |
| Q20  | C4 在全部本次冻结 detector/view/profile 中为0直接 overlap，是本配置下的真正 detection miss；这不证明所有可能模型都无法检测。                                                                                 |
| Q21  | 只新增恢复1个，增量 unique review audio=19.2225秒，因此19.2225秒/个。不是人类实际审阅用时。                                                                                                                  |
| Q22  | 后续 Ranker 可优先安排有真实可听音频但词汇未定的人工核对，所以 lexical incomplete 本身只是 advisory；前提仍是 Full Queue 的 Missing/Hallucination 全覆盖及工程/完整性门槛通过。                              |
| Q23  | 没有达到 GO_C6_0_1_15_REGION_RANKER_RECALIBRATION。                                                                                                                                                          |
| Q24  | 主阻塞是 C4 的 Detector Model Ceiling，另有 C5 的 Safety Target Selection。不是已建立Target的WAV/Playback断链；legacy归属仍未知，音乐/混音等具体声学根因尚未证明，不能直接宣称 source-separation 路线成立。  |

## Output Boundary

本轮输出根为用户 `Codex-Skills` 工作区的 `output/`，不是本源码检出目录下的 `output/`；只使用下列15个目录。原始数据均为本地研究产物。可公开分享的边界仅为validation目录下经过严格allowlist审计的aggregate-only summary，而不是整个output树。

| 阶段                 | 目录                                                  |
| -------------------- | ----------------------------------------------------- |
| baseline             | `carnation-c6-0-1-14-1-baseline-20260831`             |
| audio-views          | `carnation-c6-0-1-14-1-audio-views-20260831`          |
| legacy-fingerprint   | `carnation-c6-0-1-14-1-legacy-fingerprint-20260831`   |
| speech-sweeps-fresh  | `carnation-c6-0-1-14-1-speech-sweeps-fresh-20260831`  |
| speech-sweeps-replay | `carnation-c6-0-1-14-1-speech-sweeps-replay-20260831` |
| speech-inventory-v4  | `carnation-c6-0-1-14-1-speech-inventory-v4-20260831`  |
| safety-targets       | `carnation-c6-0-1-14-1-safety-targets-20260831`       |
| local-asr-fresh      | `carnation-c6-0-1-14-1-local-asr-fresh-20260831`      |
| local-asr-replay     | `carnation-c6-0-1-14-1-local-asr-replay-20260831`     |
| missing-evidence-v4  | `carnation-c6-0-1-14-1-missing-evidence-v4-20260831`  |
| review-package-v4    | `carnation-c6-0-1-14-1-review-package-v4-20260831`    |
| speech-evaluation    | `carnation-c6-0-1-14-1-speech-evaluation-20260831`    |
| final-a              | `carnation-c6-0-1-14-1-final-a-20260831`              |
| final-b              | `carnation-c6-0-1-14-1-final-b-20260831`              |
| validation           | `carnation-c6-0-1-14-1-validation-20260831`           |

正式查看入口为Final A/B各自的 `review-workspace/index.html`，需用repo自带的localhost review server，以保持冻结验证、音频Range请求及交易边界。原始review-package阶段选定目录为 `review-workspace-2`，早期失败尝试保留但不作为Final交付。Git不包含这15个output、音视频、模型、运行时安装、缓存、会话库或凭据。

关键本地验收文件：

- `validation/c6-0-1-14-1-validation.json`
- `validation/c6-0-1-14-1-browser-read-only-acceptance.local-only.json`
- `validation/code-checks/c6-0-1-14-1-code-validation.json`（Gold前）
- `validation/code-checks-schema-remediation/c6-0-1-14-1-code-validation.json`（非算法修复后）
- `validation/schema-remediation/validation-only-remediation.local-only.json`
- `speech-evaluation/c6-0-1-14-1-evaluation-attempt-history.local-only.json`
- `speech-evaluation/c6-0-1-14-1-post-freeze-evaluation-audit.local-only.json`
- `validation/git-delivery-verification.local-only.json`（文档提交并push后记录最终SHA）

以上阶段缩写分别对应表中完整目录，未声称这些短路径位于源码仓库中。

## Commits 与复现边界

| Commit | SHA                                        | Scope                                                                         |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------- |
| 1      | `2bcd7a223b4d5dfce68d37b310675dbbe82a8e7a` | feat: add source audio views and legacy fingerprint reconciliation            |
| 2      | `94308ecd637fee2e9a76f03d287fc2850cb7c631` | feat: add bounded multi-view whole-media speech activity sweeps               |
| 3      | `dfaca2986eb67ec323f65e7da34553da45643a71` | feat: build source-global speech inventory and missing safety-reserve targets |
| 4      | `029508e3f989fba460ed3bab65dea06f4ee866a3` | feat: add bounded local ASR probes for recovered speech targets               |
| 5      | `499853df6b3c1d1c54e1e4e5e2bde4c19effdf90` | feat: integrate recovered speech into review audio and playback               |
| 6      | `19a1cc7ac4687e2baec125ccb80a3ad47a660a7c` | feat: add direct speech-inventory evaluation and route decision               |

验收文档与Skill说明使用独立提交：`docs: record C6.0.1.14.1 speech-inventory acceptance`。自身SHA不能在同一提交里自引用；最终文档SHA、Upstream SHA、GitHub branch SHA和clean worktree以交付审计及最终回复为准。

本轮Schema导出修复后的现有代码适用于新运行的正常严格冻结；复验本轮历史Final时须同时提供其validation-only manifest、Gold前code-validation和修复后acceptance-code-validation。不得去覆盖历史Final、删除历史失败，或通过编辑原freeze来假装全代码从未变化。

下一步仅建议另行授权的检测缺失调查及通用Safety Target选择修复；本轮不启动新的模型实验、Ranker校准、source separation或人工试验。
