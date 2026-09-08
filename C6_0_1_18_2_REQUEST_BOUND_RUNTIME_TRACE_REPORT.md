# C6.0.1.18.2 — Request-bound Feature/Encoder/Decoder Runtime Trace

## 结论与范围

2026-09-09（JST）完成一次固定两单元、三臂原生观测实验。主要出口为
**B — FULL_TRAVERSAL_LOW_EMISSION_OBSERVED**。

H0→H、H→B、B→T 的原始 text、tokens、timestamps、状态和其他已有解码字段
均完全一致，未临时增加容差。S 的历史短输出仍为 13 字符，C 为 90 字符；
这是输出数量，不是正确字符数量。B/T 非扰动检查只覆盖本次两个输入。

S 确实生成 1,245 个特征帧，encoder 返回 310 个有效帧，decoder 连续访问
0–309：297 次 blank、0 次 unk、13 次词汇追加。第 1–219 帧全部无词汇追加。
不是简单跳帧、提前结束或追加后导出删字。该结果定位了本次低发射行为，
没有独立分离模型、前端数值分布和配置影响，不是“模型完全正常”或“模型普遍无能”的结论。

未修接入、未改解码、未调参、未运行质量评价，未产生新字幕。

## 基线、材料与保护

- 独立分支：`codex/c6-0-1-18-2-request-bound-runtime-trace`。
- 唯一基线：`a516c468aade47e0f0a7d3367fffd676a5d54bb9`。
- 检查了 Skill、包配置和锁文件、.18/.18.1 正式报告、原 worker、旧计划/响应、
  runtime-contract/observability-gaps、固定 native 源码和原环境身份。
- `C6_0_1_18_1_INDEPENDENT_REVIEW_AND_NEXT_STEP.md` 和
  `C6_0_1_18_1_INDEPENDENT_AUDIT_SUMMARY.json` 在实际检查范围中未找到，**未读**。
- 复用既有保护清单：25,974 个旧文件哈希未变，旧工作树 HEAD/status/staged/unstaged
  未变；另核对 .18.1 源码/产物、原运行时和四个模型文件。最终数量在本地
  `protection-verification.json`。保护检查只哈希人工稿，没有解析正文。
- 没有修改 .14.6 草稿、G11、人工权威稿、默认 profile、Skill 2/3 或旧实验结果。
  没有全局安装或替换原 wheel、native library、Python 环境、模型缓存。

## 冻结、任务和预算

首次模型启动前生成 `experiment-manifest.json`，冻结输入、模型、Python/native
文件、worker、探针 patch、配置、预算及停止条件。完成后 `result-freeze.json`
冻结六份响应、请求、TXT、进程日志及两份 trace；离线分析不修改这些文件。

| 项目                                      |      实际 |                  上限 |
| ----------------------------------------- | --------: | --------------------: |
| 正式 unit×arm / 识别尝试 / 前向           | 6 / 6 / 6 |             6 / 8 / 8 |
| Provider 启动 / 成功模型加载              |     3 / 3 |      5 次启动，含失败 |
| 执行失败 / 重试                           |     0 / 0 | 最多 2 次执行失败重试 |
| 含 padding 预约输入                       | 123.57 秒 |                240 秒 |
| 最大单请求                                |  28.74 秒 |                 32 秒 |
| 其他 ASR、CTC/MFA、VAD、speaker、分离推理 |    全部 0 |                     0 |

每臂按旧计划相对顺序 **C → S**，每请求新 stream，每臂复用一个 recognizer。
三臂各两个前向、一次加载、41.19 秒；无 warm-up。完整 PCM 共 112.77 秒，
双侧各 0.9 秒 padding 合计 10.8 秒。所有 123.57 秒都完成 accept_waveform
并进入 decode。只有 T 的 41.19 秒有原生 encoder 入口记录；H/B 的 82.38 秒
有包装层 forward-start 和成功响应，不能冒充原生 encoder 内部实测。

原生预检、三个错误库/缺探针/错误哈希负例、后验导入检查均无 recognizer、
模型加载或推理。最初构建失败、导入缺失可选导出失败均发生在正式冻结前，
不是执行失败重试。失败日志完整保留。达到六任务终点后没有追加推理。

## 三个独立可比性结论

| 单元                  | historicalReproduction H0→H | controlledBuildReproduction H→B | traceOutputInvariance B→T |
| --------------------- | --------------------------- | ------------------------------- | ------------------------- |
| C `unit-0c064a012bf8` | 全字段一致                  | 全字段一致                      | 全字段一致                |
| S `unit-9f12c20deaa8` | 全字段一致                  | 全字段一致                      | 全字段一致                |

包括原始时间点数值及数量，不只是 normalized 文本。wall time、RSS 和独立
诊断事件不参与行为等价判定。六个状态均为 SUCCESS_NONEMPTY。
这里只重放两单元隔离顺序，没有追加原先完整 12 请求序列。

## 真实原生构建与加载身份

- 固定 sherpa-onnx v1.13.6 源 commit：`1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911`。
- 原 native SHA-256：`4307213897c81ced0f263a91ef119185972ed75df72efbdb04a338e2a6d36665`。
- B/T 同一 native SHA-256：`fa5bde7198d9ef8427943d4319a26cb59d9d5bbdca486b8b9561d99ca8646fb3`。
- 原生 build ID：`c601182-native-probe-v1-1cb484af`。
- 原/新 ORT 1.27.1 dylib SHA-256 相同：`a02e26ab11a8265a6a43491e3e99ee0880e19fe51a7eebecc27a28d673f879c5`。
- Apple clang 21.0.0、CMake 4.3.4、arm64 Release、Python 3.13.14、NumPy 2.2.2。
  Python metadata 仍为原 package 的 1.13.6，不能代替 native hash。
- 模型 snapshot revision：`291488c8151be24d7da4bf7af26e533fad96e407`；
  snapshot hash：`607e2d9a4e6af5deba39fde5dc0e5f8726c569fdc734552b32d95fc5c6052cf3`。
  encoder/decoder/joiner/tokens 四个 SHA 保存在冻结清单，前后复核不变。
- CPU、1 thread、greedy_search、blank penalty 0、16 kHz、feature dim 80；
  同一日语模型，无新增语言参数。B/T 只切换观测分支与独立日志，不重编译。

原生 start/end、实际 GetFrames 返回值、RunEncoder 输入输出、原有 argmax
和 append 分支、实际 context-update 返回、context 移除和 SetResult 均有请求绑定
事件。探针只读已有缓冲，未新增 GetFrames、encoder、decoder、joiner 或 argmax
调用。两条 trace 均无溢出、缺序号或缺结束记录。所有绑定字段保持一致，
T 的 modelInstance 复用、streamId 分别为 1/2，初始化 context 每次重新建立。

已知构建差异：原 wheel 与自编译 extension 哈希不同；新库加入日志与 CommonCrypto
摘要代码，使用记录的本地工具链、Release 选项、pybind11 3.0.0、kaldi-native-fbank
1.22.3。TTS/speaker 的默认编译导出保留以兼容原 Python 包，**未运行这些模型**。
原 wheel 完整编译选项和工具链未知，不能声称二进制等价。ORT 文件相同不证明所有
运行时行为在所有输入上等价。完整固定依赖来源、版本、归档哈希见
`patches/c601182/build-manifest.json`；只获取源码/构建依赖，没有下载模型。

**加载可见性限制：** B/T 正式 worker 在模型创建前记录真实 native 路径、哈希和
原生 probe 身份。H 使用冻结的原解释器、原 worker 和原包搜索路径。三臂尝试设置的
DYLD_PRINT_LIBRARIES 未传到 Python，stderr 均为空，故没有模型进程当时的完整
依赖库加载清单。事后使用同一 sandbox/环境、不创建模型的导入进程，通过 dyld API
实测 H 原库和 B/T 控制库及对应 ORT 的路径/哈希，结果一致；这是**等价启动的后验
导入核验，不是对已退出模型进程的追溯观测**。路径只保存在 local-only 产物。

## 请求链实测

| 单元 | 原生样本数（含 pad） | 实际 feature shape | encoder capacity / 有效长度 | 实访范围      | blank / unk / lexical |
| ---- | -------------------: | ------------------ | --------------------------- | ------------- | --------------------- |
| C    |               459840 | [2874,80]          | [1,717,512] / 717           | 0–716，717 次 | 627 / 0 / 90          |
| S    |               199200 | [1245,80]          | [1,310,512] / 310           | 0–309，310 次 | 297 / 0 / 13          |

输入/特征/encoder float tensor 均为 float32。feature length tensor 在现有转换前后
均为 int64，C 2874→2874、S 1245→1245；encoder 返回 int64 717/310，传给 decoder
一致。容量与有效长度分开记录，在这两个单例恰好相等。模型图实测输入 x 为
[-1,-1,80]、x_lens 为 int64[-1]；输出 [-1,-1,512] 和 int64[-1]。
这些 metadata 是 T 的新观测，不回填成 H0 的观测。

无负长度、超容量、漏帧、重复、顺序错误或 batch 映射混淆。原生输入 SHA 与冻结的
padded float32 SHA 一致；feature hash 与 encoder 输入 hash 一致。
2874/1245 的旧公式预期单独放在 expected，以上 observed 均来自实际原生对象。

blankId=0、unkId=5222、vocabSize=5224、contextSize=2。每帧一次现有 argmax，
两个分类 ID 不混淆；visited=blank+unk+lexical，lexical=append=context-update 次数。

| 单元/等 encoder 帧区段 | visited | blank | unk | lexical |
| ---------------------- | ------: | ----: | --: | ------: |
| C 前 [0,239)           |     239 |   202 |   0 |      37 |
| C 中 [239,478)         |     239 |   199 |   0 |      40 |
| C 后 [478,717)         |     239 |   226 |   0 |      13 |
| S 前 [0,103)           |     103 |   102 |   0 |       1 |
| S 中 [103,206)         |     103 |   103 |   0 |       0 |
| S 后 [206,310)         |     104 |    92 |   0 |      12 |

最长无词汇发射：C 帧 482–578，共 97 帧；S 帧 1–219，共 219 帧。
这是 decoder emission 索引，不是语音/静音或声学词区间。S 第 0 帧已有一次追加，
随后长 blank 区间没有隐藏的词汇追加；前部追加保留到最终结果。

## 数值摘要与内容保留

特征和 encoder 有效区域全部有限：C 229920/367104 个值，S 99600/158720 个值。
NaN=Inf=0，三个区段 zero ratio 都为 0；各区段 std 均非零，无全常量/全零现象。

| 缓冲      | 前/中/后 mean               | 前/中/后 std                | 全部区段 min～max |
| --------- | --------------------------- | --------------------------- | ----------------- |
| C feature | -6.6072 / -5.3165 / -6.0976 | 4.4292 / 2.7781 / 3.8164    | -15.9424～4.4984  |
| S feature | -6.9978 / -4.9864 / -8.9956 | 5.2036 / 2.7952 / 5.3373    | -15.9424～4.6172  |
| C encoder | 0.00602 / 0.00849 / 0.02268 | 0.50654 / 0.56183 / 0.57645 | -3.6533～4.2161   |
| S encoder | 0.02670 / 0.01195 / 0.01755 | 0.43472 / 0.42211 / 0.52852 | -2.4672～2.8697   |

精确逐区段 min/max/mean/std/zeroRatio 和完整小端 float32 hash 留在 trace/摘要。
未发现上述明确数值异常，但没有独立正确特征基准，不能单凭有限值/长度排除
缩放或前端契约问题。实测前端 low_freq=20、high_freq=-400、dither=0、
normalize_samples=true、snip_edges=false、preemphasis≈0.97、FFT 向 2 次幂取整。

初始化 [-1,0] 为两个 synthetic context token；C 92→90、S 15→13 的移除只去掉
它们，不是删除识别内容。全部 90/13 个实际 append 与 context-update 返回对账，
ID→tokens.txt 符号→native result→Python response→持久化 JSON/TXT 全部保留。
固定源码的 BPE 前导符转空格/CJK 空格规则用于离线核验，不作为生产文字修正。
本次 emitted symbols 不涉及未支持的 byte-fallback 转换，转换后文本精确一致。
原生 emission 时间由既有 10 ms×subsampling 的 float32 换算保留，不重解释成词区间。

## 验证、交付与仍未执行的下一步

typecheck、lint、format check、TypeScript build、既有前端 build 均通过。
首次完整离线回归：unit 136 文件、1444 passed/1 skipped；E2E 48 文件、
105 passed/1 skipped。E2E 从 unit 中排除后单跑，未重复计数。全部计划外模型
opt-in 关闭；skipped 是原有可选真实集成测试。新增 20 个中性 trace/预算负例通过。
原生无模型 buffer 预检和三个错误库负例通过；两份真实 trace schema/链路验证通过。
相同冻结结果的离线二次分析必须字节一致，不算第二次独立模型实验。

正式执行前的两次构建/导入问题已保留：Python 自动发现选到了 3.14，且 inline
thread_local 出现重复初始化符号；显式固定 Python 3.13 并改为单定义后解决。
关闭可选导出导致原包导入缺 GenerationConfig；恢复默认编译导出后预检通过。
这些都在首次模型启动前解决，正式六任务没有失败或重试。最终完整检查和保护
结果详见本地 validation.json；日志不因失败被隐藏。

补丁文件的原始 unified-diff 空白上下文行会触发外层 `git diff --check` 的
trailing-whitespace 提示；保留其冻结字节，不为消除提示重写已执行补丁。
固定源码上的 `git apply --reverse --check` 已通过；其余提交文件的 whitespace
检查单独执行。这不是构建或测试失败，也不隐藏该检查提示。

local-only 产物根目录名：`reazon-runtime-trace-c6-0-1-18-2-20260909-5UuSJ5`。
入口为 OUTPUT_INDEX.md；应查看两份 native trace、三臂响应、behavior-parity、
request-chain-summary、冻结清单和账本，不应寻找新字幕。只提交最小原生 patch、
诊断调度/验证代码、通用测试和脱敏报告，不提交对白、trace、音频、权重或二进制。

仍保持 needs-review、finalizationMethod=none、humanValidated=false、
defaultPromotionAuthorized=false、machineOnlyReleaseAuthorized=false、
HELDOUT_VALIDATION_NOT_RUN、directListening=false。历史指标为
INHERITED_METRICS_NOT_REEVALUATED；没有新 CER、oracle 或 Gold 输入。

下一步最小验证建议：仅对固定 S 的相同 PCM，比较官方 Reazon 前端契约/特征与
当前 sherpa 前端的实际数值等价性，以缩小“前端/配置还是模型选择”的未分离因素。
**本轮未执行**，不自动换模型、调整解码或运行另一轮音频实验。
