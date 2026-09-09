# 独立字幕工具 v1 候选版 — 交付报告

## 结论

**CANDIDATE_NOT_READY_REAL_MEDIA_INTEGRITY_FAILED**。产品入口已实现，模拟 ASR 的完整音视频链路通过；真实旧素材整片请求成功返回，但原始结果有 16 条零时长 Cue，真实机器草稿导出被完整性门正确阻止。不能宣称真实媒体验收或字幕质量通过。

`NEW_SOURCE_END_TO_END_TEST=NOT_RUN`；内容质量 `NOT_MEASURED`。真实输出没有被修时、删条目或人工稿补齐，也没有因语义/时间错误再次识别。

## 基线与复用

基线 `035aed330044d3fddba662ff57a826875e52bc20`，新分支 `codex/subtitle-tool-v1-product-convergence`。独立 worktree，不切换或提交旧分支工作。

直接复用：WhisperCppTranscriptionAdapter、原有字幕 parser/formatter、SubtitleCue schema、G11 的四个业务函数。薄封装：本地配置、doctor、完整音轨提取、可取消子进程、任务状态/证据检查点、机器草稿导出、候选包。

Primary 最小路径直接将完整请求的原始段级结果映射一次至源时间线，不调用 legacy dedup/repair。G11 调用已有 overlap-required 跨 Cue 去重、source-preserving Cue 内策略、声学语义分段与排版；没有改变旧算法和阈值。新入口未接入任何 scripts/c601*、benchmark evidence contract、旧实验目录、参考字幕或 Gold。旧 subtitle/finalize/review 和 root build 保留兼容。

明确暂停：Reazon、CTC/MFA、speaker、尾音支线、复杂仲裁、审核覆盖与研究 planner。仅补充 Skill 1 仓库版和共享版的机器草稿权限说明；未修改 Skill 2/3。

## 用户入口与独立交付

`npm run subtitle-tool --` 是唯一产品入口，提供 configure / doctor / generate / status / resume。Node 24、npm 11.18.0；`npm ci && npm run build:subtitle-tool` 不构建语法站点。首次配置本地 model/runtime 后，generate 只需 input 与 output-root。

默认明确本地 Whisper、primary-minimal、空 prompt、无参考读取/搜索、无云端回退、无 VAD/Core ML 自动发现。可显式保存 G11 偏好或从完整证据零 ASR 导出 G11。编辑通过外部字幕编辑器另存 edited 副本；不伪造人工确认。

候选包由 `npm run package:subtitle-tool -- /path/output-root` 生成，含六个字幕依赖 workspace 的源码、固定锁文件、入口和文档；不包含模型、字体、媒体、人工稿、运行缓存、node_modules 或输出目录。包自身裁剪 workspace 锁条目，不改仓库锁定依赖或旧 workspace 版本。候选包仅承诺新入口，旧高级 CLI 仍在完整仓库。

## 真实整片验收

使用此前明确授权的旧《カーネーション》第1话，非新样本；不读取相邻字幕或人工稿。冻结时选定本地已有 large-v3-q5_0 GGML、whisper-cli、日语、4 线程、无 prompt/VAD/Core ML；计划一份完整音轨、两个 profile 共享证据。只有模型真正执行失败才允许最多一次重试，累计预算不超过初始完整计划两倍。

实际提取/请求音频 900.010688 秒（界面显示 900.011 秒）。完整音轨仅发出 **1** 次本地 ASR 请求，模型进程成功，**0** 重试、**0** ASR 缓存命中；未使用旧识别结果。日志确认 Apple M1 Pro / Metal 后端；`--no-prints` 没有输出可独立计数的模型初始化记录，因此模型加载日志计数为 **UNKNOWN**，不能把缺失日志记为真实零加载；只有一次模型进程启动。

原始 SRT 102 条，其中 16 条 start=end。零时长项集中在原输出 274.24 秒和 306.16 秒处。最后一条结束于 899.86 秒，完整请求并非只识别片头。后段有明显重复假设，作为质量风险保留；没有计算 CER 或借用人工正确答案。

原始文件 SHA-256：`0964236e7cd69237642fbfbee92ee7ead6de21ecd7f568e77cfa3f7f760908ec`。

- 输入 SHA-256：`294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`。
- 模型 SHA-256：`d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1`。
- Runtime SHA-256：`e25f8bab12a19e4df44d8889f35944a89816d7dfb01c0f8e5de4727fb0939924`。
- 请求实际耗时约 188.675 秒；全局音轨索引 1，容器 origin=0，audioOffset=0。
- 后续 G11 resume 复用了成功请求原始检查点 1 次、推理 0 次，重新确认同样 16 条非法时间；未产生真实 G11 字幕。

真实状态：executionStatus=failed、artifactIntegrity=failed、qualityStatus=needs-review、finalizationMethod=none、humanValidated=false、machineOnlyReleaseAuthorized=false。由于 Primary 原始时间非法，两个 profile 的真实导出比较均 **BLOCKED_BY_RAW_TIMING_INTEGRITY**，不能用删 Cue、clamp、字数分时或换模型重跑伪装通过。

详细媒体/模型/runtime hashes、冻结参数与完整日志仅留在本轮本地验收目录；不复制私人路径到默认配置或可分享源码。

## 工程验收与未完成条件

定向构建通过；新增单元/端到端测试首轮 24 项通过。覆盖单音轨音频/视频、Unicode/空格、多音轨全局索引、缺失工具/模型/输入、无音轨、损坏媒体、不可写输出、同名任务隔离、空识别、执行失败重试、成功语义错误不重试、身份变化、半写缓存、取消恢复、运行锁、跨格式一致性、编辑副本保留和两 profile 共享证据。模型相关故障测试全部使用 stub，不额外调用真实模型。

完整检查已通过 typecheck、lint、format、定向 build；新增严格 JSON Schema 对真实任务对象和伪造授权字段做验证。完整单元测试 1,462 项通过 / 1 项跳过；E2E 112 项通过 / 1 项跳过。跳过模型集成测试不是通过，也未重跑真实模型。

精简候选目录已在干净目录完成 10 步验证：npm ci、定向 build、完整合成媒体准备、help/configure/doctor/generate/status/G11 resume/重复 resume；单次 stub ASR 共享给两 profile，完整检查点命中 2 次、三格式各两套。这证明独立入口和媒体处理链路，不冒充真实识别验收。

保护机制复核旧文件 25,974 个均未变；旧基线 worktree 保持原提交。工程通过不等于这份真实媒体已通过，候选状态必须保持上述未通过结论。Local/Upstream/Remote 的最终 SHA 在交付回复及包内 PACKAGE_CONTENTS.json 的 sourceCommit 中记录。

## 边界与下一步

原始证据不变，机器草稿导出与正式发布授权分离。内容 warning 不自动升级为发布失败；无效时间属于技术错误，必须阻止非法格式导出。本轮没有发布 npm、创建公开 Release、上线服务或修改受保护旧工作。

若要继续真实端到端验收，需要用户另行授权新的完整媒体/识别配置及一次新请求；本轮不会自行使用剩余预算寻找更好结果。新素材未提供、旧整片时间错误与未知准确率应分别记录。
