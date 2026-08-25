# C5.16 Verified Mapped Tokens & Raw VAD Boundary Evidence

## 1. 结论

C5.16 已在 `codex/c5-16-verified-mapped-token-raw-vad` 完成，基线为 `053513eb8a0b1bb33e83f162a2605245e55cf267`。实现、固定上游补丁、repo-local stock/patched 构建、严格 Schema、mock E2E、真实 stock/patched A/B、large-v3 fresh 运行、21/21 cache replay 和跨运行验收均已完成。

核心验收结果：

- whisper.cpp 上游固定为 `v1.9.3` / `371b5a7561823ab2bb32142d2751e35e7534727b`。
- Patch 只修改 `examples/server/server.cpp`；没有修改 whisper.cpp core、解码参数、VAD 算法或模型推理。
- patched runtime capability handshake 通过，并由 21 个 inference response 逐请求证明 mapped getter 被实际调用；10 个 response 实际返回 raw VAD 区间。
- 同源 A/B 的 21 对、42 次 fresh 请求全部通过文字、decoded segment、raw token、语言、请求配置和空 prompt parity。
- A/B patched response 输出 376 个 mapped token 和 30 个 raw VAD interval；stock 对应计数均为 0。
- 业务健康门处理 366 个 lexical mapped token：268 个可信，98 个隔离；234 个来自 VAD profile，132 个来自 no-VAD profile。
- 30 个原始 VAD interval 中 23 个通过范围/顺序检查，7 个越界或结构不合格候选被隔离；隔离证据从未参与 timing。
- `untrustedTokenUsedForTimingCount = 0`、`unknownCoordinateTokenUsedForTimingCount = 0`、`decodedSegmentMislabelledAsRawVadCount = 0`。
- 七个 component 的证据仍不足以安全关闭 blocker，故诚实保留 `7/7 unresolved`、`review items = 7`、`status = needs-review`、`finalizationMethod = none`。
- 人工确认文字修改 0，自动时间修改 0，整集 ASR 0。

## 2. 上游源码调查

### 2.1 固定身份

| 项目        | 值                                            |
| ----------- | --------------------------------------------- |
| Repository  | `ggml-org/whisper.cpp`                        |
| Remote      | `https://github.com/ggml-org/whisper.cpp.git` |
| Tag         | `v1.9.3`                                      |
| Tag object  | `7246b7311e089fe092c4abe7cfad5d0921f8be00`    |
| Commit      | `371b5a7561823ab2bb32142d2751e35e7534727b`    |
| Source tree | `3d7ce4f956997cfa325c7556533aba5604278463`    |

上述值由本地 Git 对象解析并由构建/patch verifier 复核，不是网页短 SHA。

### 2.2 API 与 stock server 行为

- `whisper_full_get_token_data(...).t0/t1` 的单位是 centiseconds；VAD 开启时，它们停留在 VAD 压缩后的局部时间线。
- `whisper_full_get_token_t0/t1(...)` 的单位同样是 centiseconds。v1.9.3 使用内部 `vad_segments` 将 token 映射回原始输入音频时间线；无 VAD 时原样返回 raw token 时间。
- `whisper_full_n_vad_segments(...)` 与 `whisper_full_get_vad_segment_t0/t1(...)` 直接读取内部 `orig_start/orig_end`，单位是 centiseconds，坐标为原始输入音频局部时间线。
- stock `examples/server/server.cpp` 不调用 mapped token getter，也不输出 raw VAD interval。
- stock `verbose_json` 的 `word.start` 来自 UTF-8 grouped word 第一个成员 token 的 `whisper_token_data.t0`；`word.end` 来自最后一个有效成员 token 的 raw `t1`。
- stock JSON 的 `tokens` 只是 token ID 数组；带文字和时间的是按 UTF-8 完整字符聚合的 `words`，不是独立 Whisper token 对象。
- C5.15.1 legacy adapter 将 stock `segment.words` 展开为 token-like lexical/timing evidence，因此它实际消费的是 grouped word，不是 individual token。
- 日文 token 可能在一个 UTF-8 code point 的字节中间切分。patched response 除了 token `text`，还输出 `textBytesHex` 与 grouped word 的 `wordBytesHex`，Schema 用字节链验证成员关系，客户端只把验证后的 grouped word 当作最小安全 lexical timing 单元，避免 `�` 和重复计数。
- 调查确认只需修改 `examples/server/server.cpp`；不需要修改 `include/whisper.h` 或 `src/whisper.cpp`。

### 2.3 Persistent context 注意事项

v1.9.3 在同一 context 先运行 VAD、再运行 no-VAD 时，mapped getter 可观察到前一次 VAD map 的残留状态。C5.16 保留单 worker/单模型加载，但固定以 profile-major 顺序执行所有 no-VAD 请求，再执行 current-sensitive VAD，最后执行 extra-sensitive VAD。单元测试锁定该顺序与共同 batch key；真实运行证明 21 请求仍只启动一个 worker。

## 3. Patch 与构建

### 3.1 Patch

| 项目                          | 值                                                                    |
| ----------------------------- | --------------------------------------------------------------------- |
| Patch ID                      | `mvl-mapped-token-raw-vad-json-v1`                                    |
| Patch file                    | `patches/whisper.cpp/v1.9.3/0001-mvl-mapped-token-raw-vad-json.patch` |
| Patch SHA-256                 | `bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d`    |
| Modified upstream files       | `examples/server/server.cpp` only                                     |
| Core inference files modified | `false`                                                               |

Patch 增加：

- `mvl_verbose_json_v1`；
- `GET /mvl/capabilities`；
- individual token raw/mapped time、UTF-8 bytes 与 getter-use proof；
- grouped word 的成员 token、raw/mapped bounds 与 UTF-8 bytes；
- whisper internal raw VAD intervals；
- 版本、上游 commit、patch identity 和坐标契约。

Patch verifier 结果：正确 commit 的 `git apply --check` 通过；错误 commit 被 pinned-source guard 主动拒绝；重复应用识别为 already-applied；manifest 文件列表与 patch 一致。

### 3.2 同源构建

Build ID：`09dcc08994c4448d07c66c61`。

| 项目         | Stock                                                              | Patched                                                            |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Binary       | `stock/bin/whisper-server`                                         | `patched/bin/whisper-server-mvl`                                   |
| SHA-256      | `d739615ae460defff06c7796a8f7ab145f810ad88efd09d57a7e37163534b86b` | `da90c5114004888473cdde9a5407a2f3e2b630f9a4900481132558447d7f8952` |
| Source       | same pinned v1.9.3                                                 | same pinned v1.9.3 + serializer patch                              |
| Build config | identical                                                          | identical                                                          |

构建环境：

- Apple clang `21.0.0`，arm64；
- CMake `4.3.4`，Unix Makefiles，Release；
- macOS/Darwin `26.6.2`；
- flags hash `efc09a962f99940f6984f53da6c693a82b530bd58bec7f8a9097ca91ada66678`；
- `WHISPER_COREML=OFF`、`GGML_METAL=ON`、`GGML_BLAS=ON`、`GGML_OPENMP=ON`；
- stock/patched linked-library lists 相同，并随 runtime 复制为可独立启动的真实文件，而非悬空 dylib symlink。

构建目录位于用户 cache 的 `~/.cache/mvl/whisper-runtime-c5-16/<commit>/<build-id>/`，未写入仓库，也未替换 `/opt/homebrew/bin` 下的任何程序。`--fetch-upstream` 复核固定 tag 后命中并验证了同一 build，返回 `reused: true`。

## 4. Patched JSON contract 与 capability handshake

严格版本为 `mvl-whisper-server-response/1.0.0`。顶层包含 `runtime`、`request`、`transcription` 和 `vad_segments`；所有对象 `.strict()`，时间必须 finite、正向且坐标明确。

每个 segment 保留原始音频局部时间、文字、individual tokens 和 grouped words。Individual token 同时保存：

- raw centiseconds/seconds；VAD 时为 `vad-processed-local`，no-VAD 时为 `original-audio-local`；
- mapped centiseconds/seconds；始终为 `original-audio-local`，method 为官方 getter；
- ID、概率、special 标志、DTW、UTF-8 bytes。

Grouped word 保存成员 token index，raw start/end 来自首尾 raw token，mapped start/end 来自首尾 mapped token，且不能混合坐标。no-VAD 下 raw/mapped 必须相等。Raw VAD 保存 `original-audio-local` interval；no-VAD 请求必须返回空数组并声明 getter 未使用。

Worker 只绑定随机可用的 `127.0.0.1` port。启动后调用一次 capability endpoint，验证：上游 commit、patch ID/SHA、binary SHA、response schema、mapped/raw-VAD getter 声明与支持格式。`require-mapped` 或 `raw-vad-policy=required` 下任一不符即 fail closed，不回退到 stock timing、不调用在线服务。

真实 runtime capability：

| 字段                                                 | 结果                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Runtime type                                         | `mvl-patched`                                                      |
| Capability hash                                      | `14b52fe6fb227142f2351888992b71725a70473391cfefaf184f2d59dfa8bbc8` |
| Endpoint strict parse                                | passed                                                             |
| Mapped getter declared / actually used               | `true / true`                                                      |
| Raw VAD getter declared / actually used              | `true / true`                                                      |
| Inference responses                                  | 21                                                                 |
| Responses with mapped tokens                         | 21                                                                 |
| Responses with raw VAD                               | 10                                                                 |
| Absolute path leak in capability/A-B/build artifacts | 0                                                                  |

Server 不能可靠自算正在运行的 binary SHA，因此 binary SHA 由客户端以 build manifest 与本地文件哈希交叉验证；未配置 manifest identity 的手工 patched build 会报告 `build-manifest-required` 并被拒绝。

## 5. Client evidence、sequence 与 cache

客户端将 `original-audio-local` 映射为：

```text
original-media-global = extractionInterval.start + originalAudioLocal
```

映射前后检查 finite、顺序、parent segment、extraction 与 media containment；仅浮点容差内规范化，禁止大范围 clamp。保存 local/global 值和 `verified-original-audio-local-offset`。

Mapped token 继续经过 C5.15.1 健康门：special/非法 UTF-8 排除、非零时长、单调性、parent/extraction containment、边界 clamp 比例与漂移检查。Sequence 层分开保存 individually trusted、individually quarantined 与 lexical-only token；timing-usable sequence 必须有证据、只有一个 parent segment、顺序有效且无大 gap。跨 segment 或混合不可信成员只保留 lexical evidence。

四类 evidence 保持分离：decoded segment、trusted mapped token、raw VAD、source cue。Raw VAD 只证明 speech island/pause/boundary，不证明说话人或同时说话。所有候选带 `evidenceLineageId`，boundary consensus 按 lineage 去重，grouped word 不会与其 individual-token sequence 重复计权。

Cache identity 新增 runtime type、binary SHA、upstream commit、patch SHA、response schema、capability hash、timestamp mapping version、token-health policy 和 raw-VAD policy。C5.15/C5.15.1 timing cache 默认拒绝；stock/patched、不同 binary、commit、patch、schema 或 capability 不能共享 timing cache。

固定版本：

- `timestampMappingVersion = c5.16-official-mapped-getter-v1`
- `tokenHealthPolicyVersion = c5.16-token-health-v1`
- `rawVadPolicyVersion = c5.16-whisper-internal-vad-getter-v1`
- response schema `mvl-whisper-server-response/1.0.0`

## 6. Stock / patched A/B

A/B 使用相同的 v1.9.3 源码、compiler、flags、large-v3 模型、Silero VAD、7 个 WAV、3 profiles、无 prompt。每端各 21 次 fresh 请求，总计 42 次；每端均为 1 worker start、1 model load。

| 指标                           |           Stock |         Patched | 结果                                             |
| ------------------------------ | --------------: | --------------: | ------------------------------------------------ |
| Request                        |              21 |              21 | 相同                                             |
| Normalized text parity         |           21/21 |           21/21 | passed                                           |
| Decoded segment parity         |           21/21 |           21/21 | passed                                           |
| Raw token parity               |           21/21 |           21/21 | passed                                           |
| Language parity                |           21/21 |           21/21 | passed                                           |
| Request config / prompt parity |           21/21 |           21/21 | passed                                           |
| Mapped token                   |               0 |             376 | expected difference                              |
| Raw VAD interval               |               0 |              30 | expected difference                              |
| Wall clock                     |     30.463912 s |     27.381684 s | patched -3.082228 s (-10.118%, single-run noise) |
| Peak RSS                       | 3,911,254,016 B | 3,928,178,688 B | +16.141 MiB (+0.433%)                            |
| Response bytes                 |          48,014 |         272,388 | +224,374 B, 5.673x                               |

序列化体积按预期增加，因为新增了 individual raw/mapped token、UTF-8 bytes、grouped membership、runtime proof 与 raw VAD。A/B 未显示推理开销；patched 在本次单样本测量中反而更快，因此不把该差值解释为稳定性能提升。

每 profile：

| Profile               | Pairs | Text/segment/raw parity | Patched mapped token | Patched raw VAD |
| --------------------- | ----: | ----------------------- | -------------------: | --------------: |
| no-VAD                |     7 | 7/7 / 7/7 / 7/7         |                  139 |               0 |
| current-sensitive VAD |     7 | 7/7 / 7/7 / 7/7         |                  125 |              17 |
| extra-sensitive VAD   |     7 | 7/7 / 7/7 / 7/7         |                  112 |              13 |

A/B artifact strict parse 与 acceptance 均通过，`accepted = true`，failure 数为 0。

## 7. Patched fresh 与 cache replay

### 7.1 Fresh

| 指标                                |                             值 |
| ----------------------------------- | -----------------------------: |
| Target components / cues / WAV      |                     7 / 16 / 7 |
| Profile attempts                    |                             21 |
| ASR request / cache hit             |                         21 / 0 |
| Whole-media ASR                     |                              0 |
| Prompt                              |                              0 |
| Worker start / model load / warm-up |                      1 / 1 / 1 |
| Fallback                            |                              0 |
| Worker time                         |                    28.502540 s |
| Full overlap phase wall clock       |                    32.307896 s |
| Core ML                             |                            off |
| Metal                               | on and observed in runtime log |

Execution artifact 的 backend 标签为 `cpu`（表示未走 Core ML adapter），whisper.cpp runtime log 同时明确显示 Metal backend 已初始化并执行。模型 SHA 为 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`，VAD 模型 SHA 为 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`。

### 7.2 Evidence health

| 指标                                      |          值 |
| ----------------------------------------- | ----------: |
| Segment-token groups / decoded segments   |     57 / 57 |
| Lexical mapped token                      |         366 |
| Mapped VAD / mapped no-VAD                |   234 / 132 |
| Trusted / quarantined mapped token        |    268 / 98 |
| Trusted token used for timing             |          73 |
| Untrusted token used for timing           |           0 |
| Unknown-coordinate token used for timing  |           0 |
| Mapped containment / monotonicity failure |       0 / 0 |
| Maximum observed drift                    |      0.01 s |
| Raw VAD emitted / trusted / rejected      | 30 / 23 / 7 |
| Decoded segment mislabeled as raw VAD     |           0 |

7 个 rejected raw VAD 候选来自 out-of-range/结构健康门，常见情形是 VAD getter 的边界略超出实际 extraction duration；它们保留在原始 cache response 和汇总审计中，但不会进入 boundary consensus。

### 7.3 Cache replay

| 指标                 |     Fresh | Replay |
| -------------------- | --------: | -----: |
| Cache hit            |      0/21 |  21/21 |
| ASR execution        |        21 |      0 |
| Worker start         |         1 |      0 |
| Model load           |         1 |      0 |
| Warm-up              |         1 |      0 |
| Fallback             |         0 |      0 |
| Total worker seconds | 28.502540 |      0 |

Fresh/replay 等值 hash：

- mapped token: `b5bc08e7a8c59607d8713c3ab5f4ba26ad02db816e1b5c9eee45565f31c9b681`
- raw VAD: `9be8e068dd428bbaa02e15a611888aa52b046397ee9daf7f452f29cf0ea85515`
- timestamp integrity: `54ec234123d6f1a404c92eeb6d4f6595e330d8b1440d3e71f29371eb4c102901`
- overlap semantic evidence: `1460e580c1faa74ef58e910a61e27d0d55e71cd6c65ddfdbf90f3f28bac78011`
- runtime capability: `14b52fe6fb227142f2351888992b71725a70473391cfefaf184f2d59dfa8bbc8`

## 8. 七组逐项重分类

表中 raw/mapped 数是 C5.16 业务 parser 保存的对象数，`VAD E/T` 是 patched response emitted / 通过健康门的 trusted 数。Stock 每个 profile 的文字、segment 和 raw token hash 均与 patched 一致，但 stock 没有 individual mapped 字段或 raw-VAD 输出。

### Component 1 — 59.140–60.880

- 原 cue：`59.140–60.400 糸子 おはよう`；`60.300–60.880 おはよう`。Extraction：`57.640–62.380`。
- no/current/extra raw/mapped：`9/9`、`13/13`、`14/14`；VAD E/T：`0/0`、`1/0`、`2/1`。可信 raw VAD：extra `57.72–58.58`。
- `おはよう` 有单一 parent 的 usable mapped sequence（3 individually trusted token、1 mapped lineage）；第一 cue 只有 decoded-segment 支持。Containment/chronology 通过，但证据不能同时定位两条 cue 的安全分界。
- Best `rapid-turn-taking 0.45`；runner-up `ordered-no-overlap 0.30`；margin `0.15`。最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

### Component 2 — 402.050–410.370

- 原 cue：`402.050–410.370 ソーリャ! ソーリャ!`；`403.750–407.550 あ 来ない早き`。Extraction：`400.550–411.870`。
- raw/mapped：`7/7`、`5/5`、`5/5`；VAD E/T：`0/0`、`1/0`、`1/0`。两个 VAD candidate 均未通过 extraction health。
- 两条 cue 都没有可用 lexical sequence、mapped boundary 或 decoded alignment；raw VAD 不能证明 speaker/foreground 关系。
- Best `nested-background-foreground 0.35`；runner-up `ordered-no-overlap 0.25`；margin `0.10`。最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

### Component 3 — 436.040–440.850

- 原 cue：`436.040–439.000 あきまへんって。`；`438.730–440.850 アホか!調子乗んな!`。Extraction：`434.540–442.350`。
- raw/mapped：`32/32`、`21/21`、`14/14`；VAD E/T：`0/0`、`3/3`、`2/2`。可信 islands：current `434.54–436.06, 436.06–438.02, 440.85–442.02`；extra `434.54–438.62, 440.70–442.24`。
- 第一 cue 有单 parent usable sequence（5 trusted token、1 mapped lineage、3 VAD、2 decoded）；第二 cue 没有 usable token sequence，只有 3 VAD 与 1 decoded。Chronology 合法，但两侧 lexical localization 不对称。
- Best `rapid-turn-taking 0.60`；runner-up `ordered-no-overlap 0.55`；margin `0.05`，低于门槛。最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

### Component 4 — 688.310–695.610

- 原 cue：`688.310–690.270 うまいわ この水茄子`；`690.160–695.140 上手につけたらいいよ`；`690.670–695.610 奥さん…今日店で買うたんですよ`。Extraction：`686.810–697.110`。
- raw/mapped：`36/36`、`40/40`、`36/36`；VAD E/T：`0/0`、`4/4`、`1/1`。Current 将 `686.81–697.11` 划为四个连续 island，extra 为单一 spanning island。
- 前两 cue 各有单 parent usable sequence；第二 cue 同时有 18 individually trusted 与 7 individually quarantined/lexical-only token，二者分开保存，隔离成员未进入 timing。第三 cue 没有 lexical/decoded localization，仅有 VAD boundary，不能证明三说话人关系。
- Best `ordered-no-overlap 0.25`；runner-up `rapid-turn-taking 0.15`；margin `0.10`。完整三-cue atomic proposal 未通过，整组回滚。最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

### Component 5 — 701.460–705.340

- 原 cue：`701.460–703.340 ええって歩よ`；`702.690–705.340 お 泰蔵 よかったね`。Extraction：`699.960–706.840`。
- raw/mapped：`12/12`、`7/7`、`5/5`；VAD E/T：`0/0`、`2/2`、`2/2`。可信 islands：current `703.20–705.40, 705.40–706.84`；extra `701.29–702.28, 703.02–706.84`。
- 两 cue 均有单 parent usable mapped sequence，但独立 profile 支持和候选分界仍不足；VAD pause 只能支持 boundary 假设，不能指定说话人。
- Best `rapid-turn-taking 0.60`；runner-up `ordered-no-overlap 0.55`；margin `0.05`。最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

### Component 6 — 772.510–777.210

- 原 cue：`772.510–776.310 うちの目刺しもっと／大きいやつにしてよ`；`775.860–777.210 さかわしい!`。Extraction：`771.010–778.710`。
- raw/mapped：`30/30`、`25/25`、`27/27`；VAD E/T：`0/0`、`4/3`、`4/3`。可信 current islands：`771.02–771.71, 773.51–774.46, 774.86–777.08`；extra：`771.01–771.92, 773.33–774.69, 774.69–777.27`。
- 两 cue 都有单 parent usable sequence；第一 cue 23 trusted token/2 mapped lineages，第二 cue 1 trusted token/1 mapped lineage。仍没有足够独立、低侵入的 atomic boundary。
- Best `rapid-turn-taking 0.60`；runner-up `ordered-no-overlap 0.55`；margin `0.05`。最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

### Component 7 — 808.530–811.860

- 原 cue：`808.530–811.860 堪忍`；`809.480–810.560 罰だぞ。`；`810.090–811.160 堪忍!`。Extraction：`807.030–813.360`。
- raw/mapped：`11/11`、`13/13`、`11/11`；VAD E/T：`0/0`、`2/2`、`1/0`。可信 current islands：`807.20–812.45, 812.45–813.10`。
- 三 cue 都没有 usable mapped lexical sequence或 decoded localization；同一 broad speech island 对三 cue 仅能证明有语音，不能证明 nested/background/simultaneous speaker 关系。
- Best `nested-background-foreground 0.35`；runner-up `ordered-no-overlap 0.25`；margin `0.10`。三-cue atomic proposal 未获证据，最终 `unresolved`、blocking；timing mutation 0，presentation override 0，review item 1。

## 9. 最终字幕、hash 与兼容

| 指标                              | 结果                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| Canonical cue count               | 192                                                                |
| Canonical text mutation           | 0                                                                  |
| Canonical timing mutation         | 0                                                                  |
| Overlap timing mutation           | 0                                                                  |
| Midpoint / character-ratio repair | 0 / 0                                                              |
| Review items before / after       | 7 / 7                                                              |
| Review WAV coverage               | 7/7，无失败                                                        |
| Status                            | `needs-review`                                                     |
| Finalization method               | `none`                                                             |
| Canonical cue hash                | `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83` |
| Canonical timing hash             | `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02` |
| Presentation cue hash             | `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de` |
| SRT/VTT max delta                 | 0 s                                                                |
| SRT/ASS max delta                 | 0 s                                                                |

Skill 2 strict v1 compatibility 为 192 cues、106 sentences、106 grammar points；runtime/mapped/VAD/presentation 字段没有写入 strict v1 cue。Skill 3 site artifact 继续可构建。两个兼容性 checkout 均位于 `codex/publish-core-runtime` 且 `git status --short` 为空，本轮未修改。

## 10. 输入只读与供应链

| 输入               |        Size | SHA-256                                                            |                   mtime | 结果              |
| ------------------ | ----------: | ------------------------------------------------------------------ | ----------------------: | ----------------- |
| Source MKV         | 847,774,958 | `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` | `1784692412273.1868 ms` | before/after 相同 |
| Human-reviewed ASS |      17,094 | `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e` | `1787570451152.2112 ms` | before/after 相同 |

没有整集 ASR、OpenAI API、在线字幕搜索、第二 ASR 模型、source separation 或 Homebrew 修改。仓库中没有 whisper.cpp 完整源码、build、binary、model、video、WAV 或 ASR cache；也没有超过 20 MiB 的新增文件。Runtime capability、A/B 与 build manifest 的绝对路径扫描为 0。

## 11. 测试与依赖

使用 Node `v24.19.0`、npm `11.18.0`：

- `npx --yes npm@11.18.0 install`：成功；198 packages。
- Schema generation：76 JSON Schemas。
- TypeScript typecheck、ESLint、production build、Prettier check：全部通过。
- Unit/full test command：15 files、207 tests passed。
- E2E：4 files、18 tests passed。
- C5.16 focused unit：30 tests passed。
- Patch verifier、fresh/cache/A-B validator：通过；源码/Schema/报告的 `git diff --check` 通过。`.patch` 文件中的 3 个单空格是 unified-diff 空白上下文 marker，由 `git apply --check` 单独验证，不是应用后源码的尾随空格。
- Skill quick validation：`Skill is valid!`

`npm audit` 报告 5 项：1 moderate、4 high、0 critical。安装还提示 `esbuild` 与 `fsevents` 的 install scripts 未被 allowScripts 覆盖。本轮没有运行 `npm audit fix`、`--force` 或自动批准脚本，避免产生超出任务范围的依赖变更。

## 12. 主要修改文件

- CLI/runtime：`apps/cli/src/index.ts`、`packages/transcription-core/src/{worker,local,asr-cache,timestamp-evidence-integrity,overlap-acoustic-resolution}.ts`。
- Workflow/finalization：`packages/video-subtitler/src/{overlap-acoustic,finalization}.ts`。
- Strict schemas：`packages/shared/src/mvl-whisper-server-response-schemas.ts` 及 overlap、timestamp、transcription、presentation schema；对应 8 个新增/更新 JSON Schema。
- Patch/build：`patches/whisper.cpp/v1.9.3/*`、`scripts/{whisper-runtime-common,verify-whisper-runtime-patch,build-whisper-runtime,compare-c5-16-whisper-runtimes}.ts`。
- Replay/validation：`scripts/{replay-c5-16-mapped-vad,validate-c5-16-runs,replay-c5-15-overlap,generate-schemas}.ts`。
- Tests：`tests/c5-16-mapped-token-raw-vad.test.ts`、`tests/e2e/c5-16-mapped-vad-flow.test.ts` 及 C5.15.1 compatibility regression。
- Commands：`package.json`。

## 13. 复现命令

为避免在共享报告中写入用户名，以下是本次实际命令的路径变量形式：

```bash
export REPO="<C5.16 checkout>"
export OUT="<Codex-Skills>/output"
export RUNTIME="$HOME/.cache/mvl/whisper-runtime-c5-16"
export MODEL="$HOME/.cache/whisper.cpp/ggml-large-v3.bin"
export VAD="$HOME/.cache/whisper.cpp/ggml-silero-v6.2.0.bin"

npx --yes npm@11.18.0 install
npm run verify:whisper-runtime-patch
npm run build:whisper-runtime -- \
  --upstream-tag v1.9.3 --fetch-upstream --output "$RUNTIME"

npm run compare:c5-16-whisper-runtimes -- \
  --stock-server "$RUNTIME/371b5a7561823ab2bb32142d2751e35e7534727b/09dcc08994c4448d07c66c61/stock/bin/whisper-server" \
  --patched-server "$RUNTIME/371b5a7561823ab2bb32142d2751e35e7534727b/09dcc08994c4448d07c66c61/patched/bin/whisper-server-mvl" \
  --runtime-manifest "$RUNTIME/371b5a7561823ab2bb32142d2751e35e7534727b/09dcc08994c4448d07c66c61/build-manifest.json" \
  --task "$OUT/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825" \
  --model "$MODEL" --vad-model "$VAD" \
  --output "$OUT/carnation-reference-guided-c5-16-stock-patched-runtime-ab-20260825/c5-16-stock-patched-runtime-ab.json"

npm run replay:c5-16-mapped-vad -- \
  --task "$OUT/carnation-reference-guided-c5-15-1-timestamp-integrity-20260825" \
  --human-reviewed-subtitle "<machine-review-draft-contradiction-audited.ass>" \
  --source-video "<Carnation source MKV>" --output "$OUT/carnation-reference-guided-c5-16-verified-mapped-token-raw-vad-20260825" \
  --audio-track 1 --whisper-cpp-path /opt/homebrew/bin/whisper-cli \
  --whisper-server-path "$RUNTIME/371b5a7561823ab2bb32142d2751e35e7534727b/09dcc08994c4448d07c66c61/patched/bin/whisper-server-mvl" \
  --timestamp-runtime-policy require-mapped --raw-vad-policy required \
  --runtime-capability-manifest "$RUNTIME/371b5a7561823ab2bb32142d2751e35e7534727b/09dcc08994c4448d07c66c61/build-manifest.json" \
  --mvl-response-schema-version mvl-whisper-server-response/1.0.0 \
  --local-transcription-model "$MODEL" --whisper-vad-model "$VAD" \
  --coreml off --whisper-execution-mode persistent \
  --overlap-acoustic-resolution enforce --timestamp-evidence-integrity enforce \
  --token-timestamp-policy mapped-only --presentation-resolution enforce \
  --overlap-resolution conservative \
  --asr-cache-dir "$HOME/.cache/mvl/asr/carnation-c5-16-20260825" \
  --asr-cache-mode read-write

# Cache replay 使用新的 collision-safe output，并把最后一项改为：
# --asr-cache-mode read

npm run validate:c5-16-runs -- \
  --fresh "$OUT/carnation-reference-guided-c5-16-verified-mapped-token-raw-vad-20260825" \
  --replay "$OUT/carnation-reference-guided-c5-16-verified-mapped-token-raw-vad-cache-replay-20260825" \
  --ab "$OUT/carnation-reference-guided-c5-16-stock-patched-runtime-ab-20260825/c5-16-stock-patched-runtime-ab.json"
```

## 14. Artifacts 与输出目录

- Fresh：`output/carnation-reference-guided-c5-16-verified-mapped-token-raw-vad-20260825/`
- Cache replay：`output/carnation-reference-guided-c5-16-verified-mapped-token-raw-vad-cache-replay-20260825/`
- A/B：`output/carnation-reference-guided-c5-16-stock-patched-runtime-ab-20260825/c5-16-stock-patched-runtime-ab.json`
- Cross-run validation：fresh 目录下 `c5-16-fresh-cache-ab-validation.json`
- Runtime capability：每个 subtitle output 下 `whisper-runtime-capability.json`
- Timestamp integrity：每个 subtitle output 下 `subtitle-timestamp-evidence-integrity.json`
- Overlap evidence：每个 subtitle output 下 `subtitle-overlap-acoustic-resolution.json`
- Review package：fresh subtitle output 下 `subtitle-review-package.json` 及 7 个覆盖完整的 review WAV。
- Build manifest：runtime cache 的 `<commit>/<build-id>/build-manifest.json`。

## 15. 未解决问题与 C5.17 建议

- 七组 component 仍缺少足够独立且局部化的词汇/边界证据；不能为减少 review item 而降低门槛。
- 30 个 upstream raw VAD interval 中有 7 个超出 extraction 或未通过结构检查；目前安全隔离。C5.17 可增加更细的 rejected-boundary audit 明细和正式的有限 padding tolerance 校准，但不应自动 clamp 大范围越界。
- v1.9.3 persistent context 的 VAD-map 生命周期应继续被 profile-major 调度保护；可向上游提出明确 reset 语义或用可选真实-runtime regression 追踪后续 release。
- Component 4/7 的三-cue 情形和 background/foreground 判断仍需要人工听审或未来新增真正的 speaker-local evidence；raw VAD 不能替代 diarization。

本轮最终原则保持：官方 mapped getter 直接调用；runtime 只声明但没有实际输出则不信任；token 未通过健康门则隔离 timing；raw VAD 只证明 speech boundary；证据不足就保持 unresolved；任何情况下不修改人工文字、不跑整集、不猜时间。
