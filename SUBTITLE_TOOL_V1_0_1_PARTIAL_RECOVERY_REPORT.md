# 独立字幕工具 v1.0.1 候选 — 部分结果恢复报告

## 结论与范围

**PARTIAL_RECOVERY_READY**；**FULL_TIMED_EXPORT_STILL_BLOCKED**。
**ASR_QUALITY_NOT_REEVALUATED**；**NEW_SOURCE_END_TO_END_TEST_NOT_RUN**。

基线 f92f9c8c20a64255264f79e4d2ae0874330006d4；新独立分支 `codex/subtitle-tool-v1-0-1-partial-result-recovery`。没有切换、拉取、清理或提交旧 worktree 的修改。没有升级 workspace 版本、发布 npm/Release、合并默认分支或切换默认生产路径。

新增独立 offline recovery 模块、recover/validate-edited 两个稳定操作及恢复 Schema；复用已有 parser、严格 SubtitleCue 和格式器。块级记账保留未知块、重复文字、重复编号、原顺序、原位置与原时间。原始无效时间与百分之一秒序列化坍缩分别分类；不补时间、不裁切、不去重、不把合法子集送入 G11、不生成伪完整 primary-evidence。

原始响应按字节保留，UTF-8 解码使用 fatal 模式。映射在原始语义校验后按已保存 offset 执行一次。三格式写入本次暂存目录并从磁盘重读，全部通过后以一次目录 rename 提交。格式失败时全文与诊断仍可用，但不交付半套字幕。

旧失败任务保持原 task.json/错误/尝试记录；新恢复目录只是绑定 taskHash、rawHash、解析版本及导出策略的恢复视图。新生成任务在成功请求后遇到可记录异常，自动保存全文和索引并置为 partial，默认不导出部分字幕。再次 resume 对确定性原始时间阻塞走离线恢复，不调用模型或 ffprobe。

## 真实离线回归

既有失败响应 SHA-256：`0964236e7cd69237642fbfbee92ee7ead6de21ecd7f568e77cfa3f7f760908ec`。它只用于本次输入身份核验，没有写入通用产品规则。

| 检查                           | 实测结果                                                 |
| ------------------------------ | -------------------------------------------------------- |
| 原始记录                       | 102，全部保留，重复记录各有独立 recordId                 |
| 未解决记录                     | 16，均保留 ZERO_DURATION 问题，未修时                    |
| 合法部分字幕                   | 86；ASS/SRT/VTT 同一集合，磁盘重读及 export-map 对账通过 |
| 完整文字                       | 与逐条原始正文顺序重建严格一致，不以 CER/字符数代替对账  |
| 默认 recover                   | 只写文字/原始记录/异常/索引，不写定时子集                |
| 重复显式 recover               | 重新验证并复用同一目录，无重复追加                       |
| partial 作为修订输入           | 格式通过，SOURCE_COMPLETENESS_UNPROVEN，退出 2           |
| 旧 task/raw/error/attempt 日志 | 前后 SHA-256 完全一致                                    |

16 条原始记录不是已经确认的 16 次真实发话。保留重复机器假设不等于承认文字正确。部分字幕未包含这 16 条，但全文和异常清单保留它们；完整自动定时交付仍未通过。

真实恢复数据单独放在本轮 `subtitle-tool-v1-0-1-offline-recovery-20260909-znsq3m/final`，不进入源码或候选 ZIP。主要文件为 transcript.full.txt、raw-records.json、timing-issues.json、TIMING_ISSUES.md、recovery.json、export-map.json、subtitles/primary-minimal.partial.ass/srt/vtt 和 OUTPUT_INDEX.md。具体机器路径仅在本地交付索引中列出。

本轮六项计数均为 **0**：newASRRequests、newModelInference、newModelLoads、newProviderStarts、newAudioExtractions、newAudioWindows。未运行 Whisper/Reazon/CTC/MFA/pyannote，没有新音频窗口、试听补时或 CER 评分。恢复和验证没有读取 Gold/人工稿；既有保护脚本只做旧文件哈希核验，不将正文用于补齐。中性 fixture/故障模拟不作为真实声学验收。

真实用户修订成功路径：**NOT_RUN_NO_USER_EDITED_INPUT**。只对中性合成文件验证一对一时间修订成功；真实数据只用 partial 另存副本做“不能冒充完整”的负例。

## 状态、退出码与可移植性

原 ASR attempt=completed；旧 task=failed / artifactIntegrity=failed。恢复视图 executionStatus=partial、recoveryIntegrity=passed、fullTimedExport=not-produced、partialSubtitle=generated（显式导出时）。原 artifactIntegrity 没有被改为 passed。

所有路径保持 qualityStatus=needs-review、finalizationMethod=none、humanValidated=false、machineOnlyReleaseAuthorized=false。修订副本分别报告 formatIntegrity、sourceTextAccounting、userEdited 与 acousticCorrectness=NOT_VERIFIED。

退出码 0：相应完整操作/查询/全量修订格式与文字对账成功；2：可取回内容已交付，但完整定时交付或源文字对账仍未完成；1：身份、编码、权限、I/O 等技术故障。status 查询成功为 0，不能把查询退出码当作完整字幕已完成。

恢复只读明确的 task.json/raw-primary.srt 和已绑定的本次恢复产物；不自动扫描 task 内历史绝对路径。源媒体/模型/可执行程序无需存在，使用 SAVED_SUCCESSFUL_TASK_METADATA；现场核验为 NOT_RUN_SOURCE_UNAVAILABLE，明确没有探测这些路径的可用性或假称现场验证。

从 partial 另存使用 `--timebase source`（默认），从 raw 另存使用 `--timebase audio`。合理删幻觉、改文字或拆并句可得到合法 user-edited 文件，但对账不确定时保留 SOURCE_COMPLETENESS_UNPROVEN / USER_CONTENT_CHANGED，不创造新的人工认证平台。ASS 样式转换只承诺已有可见文字规则；范围内的错误时间基声明无法自动识别，声学正确性不在本补丁范围内。

## 工程验证与候选交付

全量单元测试：1492 通过、1 跳过。离线 E2E：104 通过、1 跳过。定向 50 项包含在这些集合中，不重复加总。typecheck、lint、format、build:subtitle-tool 和新增严格 Schema 验证按本地 checks 收据复验。

首次全量单元运行因测试 PATH 命中缺少 NumPy 的 Python 失败；改用本机已有 Python 3.13（NumPy 2.2.2 / SciPy 1.15.2）复验通过，没有安装或升级依赖模型，没有修改旧测试算法。

本轮明确排除 3 个旧 E2E 文件：`tests/e2e/subtitle-tool.test.ts`（实际 FFmpeg 媒体生成/提取）、`tests/e2e/c6-0-protected-finalization-flow.test.ts` 和 `tests/e2e/c5-17-2-review-delivery-flow.test.ts`（既有真实人工稿/历史任务）。真实 speaker/MFA 集成开关关闭。未运行与 skip 均不算 pass。旧保护机制前后均确认 25,974 个保护文件不变；Skill 2/3 和严格 SubtitleCue 未修改。真实恢复产物及逐条记录共 207 个 Schema 校验通过，伪造人工授权和非零新增推理字段被拒绝。

候选包通过 `scripts/package-subtitle-tool.mjs` 生成，只含程序、锁定依赖信息与文档，不含真实任务、字幕、音频、模型或字体。`scripts/validate-subtitle-recovery-candidate.mjs` 已在干净安装目录完成 9 步：npm ci、定向 build、help、recover、显式 partial、重复 recover、status、resume 和 validate-edited，预期退出码全部符合。复制的旧任务仅含 task.json/raw-primary.srt，没有模型或音频；读边界拦截限制读取到干净候选目录及复制任务，Node permission 禁止子进程。恢复前后旧文件和复制件哈希一致，真实副本仍为 102 / 86 / 16。独立 validation.json 保存证据，源码包完整性不能代替字幕质量通过。

## 停止条件

完成现有识别结果的取回、异常定位、显式部分使用与独立修订检查。本轮不继续新识别、换模型、修尾音、扩大审核系统或绕过完整时间门。v1 原始真实媒体验收失败结论保留；它不否认本补丁已经实现的离线部分恢复能力。
