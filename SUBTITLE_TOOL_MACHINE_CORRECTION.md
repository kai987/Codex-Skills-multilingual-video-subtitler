# 独立机器纠错候选稿 v1

本入口解决“旧原件不可改”被错误扩大为“任何新稿都不能改错”的问题。旧 `frozen-local-asr-insertion-v1`、正常 `primary-minimal`、人工复核稿和原始证据均不改变。新的候选文件允许有记录的整条替换、拆分、调时及漏句插入；它不是自动认可的终稿。

## 使用

运行环境沿用 Node.js 24 和已有本地 Whisper，不安装或切换模型。先完成 `npm run build:subtitle-tool`。

```sh
npm run subtitle-tool:correct -- prepare \
  --previous-run /path/to/frozen-local-asr-run \
  --plan /path/to/machine-correction-plan.json \
  --output-root /path/to/new-output

npm run subtitle-tool:correct -- execute \
  --run /path/to/machine-correction-XXXXXX --authorize-local-asr

npm run subtitle-tool:correct -- assemble --run /path/to/machine-correction-XXXXXX
npm run subtitle-tool:correct -- verify --run /path/to/machine-correction-XXXXXX

# 可选：决策冻结之后，才显式读取人工稿比较；不回写识别或决策。
npm run subtitle-tool:correct -- evaluate \
  --run /path/to/machine-correction-XXXXXX --reference /path/to/human-reviewed.ass
```

`prepare` 当前适配已校验的 `frozen-local-asr-execution-v1` 产物，不假装接受任意字幕作为同等证据。它验证旧决策、基线、模型及运行时身份，并从已有 PCM 请求片段重建音频；不读取人工参考正文或重新提取整片音频。不存在可验证来源时拒绝运行。

计划格式见 [开发案例](scripts/plans/carnation-correction-development-v1.json)。`baselineIds` 明确指定整条被替换的旧记录，空数组只用于新插入。`start/end` 是允许候选出现的源时间区域，不是强制输出时间；粗时间旧条目可以与区域相交，不会被按区域裁掉一部分。目标之外的基线对象必须完整保留。

## 有界执行和时间证据

- 每次计划最多 4 个目标，各做 0.5 秒、1 秒上下文的两次识别；最多 8 请求，单次不超过 30 秒，总计不超过 120 秒。没有质量重试、技术自动重试或无限补跑。
- 保持日语、空 prompt、原有模型与运行时、VAD 关闭和独立进程。新增 `--output-json-full --max-len 64 --split-on-word` 获取实际 token 信息，不开启历史仲裁、CTC、MFA、Reazon 或说话人模型。
- Whisper 原生 token 时间仍是实验性机器估计，不称为真实声学时间。必须逐项保留和验证词表、正文重建、时间单调性、父段及请求范围；缺失、零时长、非法 token 和跨边界 token 不能被丢掉后冒充完整证据。
- 连续 token 组按真实间隙或已有标点分句，不按字符均分时间。不把整段时间硬裁至目标区间。
- 两种上下文须正文一致（仅忽略空白），自然分句也一致，逐个边界差不超过 0.35 秒；选择较窄请求的真实边界，不取平均。相同模型的重复一致不是独立模型投票，更不保证字词正确。
- 替换另需与旧文字相关，并防止大幅丢失正文、邻句碰撞、候选互相冲突及重复风险。所有门槛在本次识别前固定；拒绝的原因也保存。

每次请求先持久化预约，再启动进程。成功、失败及原始文件均保留。重复执行已完成的运行只检查缓存，不产生推理；已预约但没有结果的请求停止，绝不悄悄消耗新预算。Ctrl+C 只终止当前入口自己的进程。异常退出遗留锁不会自动抢占。

新执行和首次组装要求代码身份与准备阶段一致。已冻结结果的后续验证可使用更新代码，但必须重算并逐项复现全部候选、决策、变更与 views；`verificationCodeIdenticalToExecution` 明确显示是否使用了相同源码，不能将验证时版本冒充实际推理版本。

## 交付和验收边界

`candidate/subtitle.corrected.machine-candidate.ass/srt/vtt` 是独立可播放稿；三个格式从磁盘重读对账。`changes.json` 记录旧/新条目，`decisions.json` 解释应用与拒绝，`views.json` 保留请求时间证据，`decision-freeze.json` 绑定产物；`verify` 重放纯机器决策并检查旧文件未改。

统计分别报告：旧基线文件修改数（必须为零）和新候选中的实际改动，不再用“全部 mutation=0”衡量纠错成功。

人工稿比较只在冻结后通过 `evaluate` 运行。全文编辑距离和目标区域诊断不等于听音认证的 CER；只有唯一、整条、正文完全匹配的条目才报告时间差，其余不伪造对齐。计划来自已知问题，是开发案例而非盲测或未见过的测试集。

无论结果如何，仍为 `needs-review / finalizationMethod: none / humanValidated: false / machineOnlyReleaseAuthorized: false`。这批输入继承旧 partial 不完整性，不宣称整集所有漏句已恢复。模型、完整源媒体、人工稿均不打包进新产物；运行记录可能含本地路径，不能原样公开。
