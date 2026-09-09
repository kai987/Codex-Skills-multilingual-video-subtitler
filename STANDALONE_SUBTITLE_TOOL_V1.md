# 独立字幕工具 v1 候选版

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

G11 与 Primary 共享同一份识别证据。建议先生成默认草稿，再用 resume --profile g11 比较；不会再次调用 ASR。G11 的合并、去重和排版变化均记录在 assembly JSON 中，文本序列变化必须人工检查。Primary 默认不会因此升级为 G11。

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

Ctrl+C 会终止本次入口拥有的子进程，保留已完成音频和证据检查点。resume 校验输入、模型、运行时和配置；身份变化必须创建新任务。成功识别不会因文本差、时间异常或导出故障被自动重跑。失败请求最多重试一次，跨 resume 累计最多两次完整请求，累计音频预约不超过首次规划的两倍。预算耗尽会停止。

意外断电或 SIGKILL 可能留下 `.run-lock`。确认旧进程已结束后使用 `resume --recover-lock`；工具只在锁 PID 已不存在时移除旧锁。禁止并发运行同一任务。没有全局 kill 或自动清理历史目录的命令。

完整音轨一次识别；不是按参考稿切片。提取为单声道 16 kHz PCM，保留音频内部时间间隔，独立记录容器起点与音轨偏移；原始 SRT 保留，偏移只加一次。缓存身份绑定音频、模型、运行时、语言、空 prompt、解码参数、提取参数与时基。完整证据存在时重新组装/导出为零 ASR。

## 输出与限制

清理时只选择 task.json 的 ownedFiles 中确实不再需要的文件移到废纸篓，先备份 edited 副本。工具不会自动递归删除任务目录、旧 output 或共享模型。卸载仅移除本次候选安装目录和自己指定的配置文件；保留外部模型与源媒体。

任务内包含原始机器 SRT、Primary 证据、三个格式草稿、组装 trace、manifest、日志与索引；本地 manifest/日志可能含绝对路径，不应原样公开。候选源码 ZIP 不带这些私人运行数据。

允许保留并警告重叠、单模型识别错误、超长行、方言错误与空识别结果。空识别仅表示“成功请求返回空文本”，不是已验证无语音。不会为凑 2×16 排版而删除文字、按字数造时或裁切真实时间。全部格式使用同一组百分之一秒量化时间，并从磁盘重读检查文本/时间一致性。

单个完整请求在中断时无法从模型内部继续；恢复只能在有限预算内重做该未完成请求。长媒体消耗、首次依赖安装、外部编辑器能力和本地硬件仍是限制。本轮没有自动翻译、烧录、说话人识别或质量保证。

暂停且不接入正常运行：Reazon、CTC/MFA、旧尾音诊断、复杂仲裁、review/coverage/budget research planner、Gold 评价与 scripts/c601* 协调器。正常入口不打开参考字幕、不读取相邻字幕正文、不从标题构造 prompt；已有 API key 不触发云端回退。
