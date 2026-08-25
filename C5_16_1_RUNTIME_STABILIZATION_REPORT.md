# C5.16.1 Runtime Boundary Tolerance, Worker State Isolation & Shareable Artifacts

## 1. 结论与版本身份

C5.16.1 已在分支 `codex/c5-16-1-runtime-stabilization` 完成。开发严格基于 C5.16 commit `96a49e328184fbdfd45c412a4a5da1c8bb103fe6`，没有基于 `main`，也没有修改或重写 C5.16 分支。

本轮只稳定了四条运行时证据链：

1. 对 Raw VAD 的 10–30 ms 音频末端量化/填充误差进行有界规范化；
2. 用逐请求 fresh `whisper_state` 消除 persistent worker 的 VAD/no-VAD 状态污染风险；
3. 将 stock/patched A/B 的 grouped-word 与 individual-token 可观察性分开命名；
4. 保留 local-only 调试产物，并另行生成严格、无绝对路径、无秘密信息的 shareable 副本。

没有引入 forced alignment、G2P、CTC、diarization、source separation、新 ASR 模型、在线字幕搜索或 OpenAI 调用。人工复核文字和 cue 时间均未修改，整集 ASR 为 0。

## 2. 源码调查与根因

### 2.1 Raw VAD 边界

C5.16 用 nominal extraction interval 判断 Raw VAD containment。真实 WAV 由采样帧构成，实际时长可能比 nominal 端点短或长约 0.2–1.2 ms；whisper.cpp Raw VAD getter 又以 centisecond 输出，所以末端可能落在 WAV 边界外 10–30 ms。此前这 7 个 interval 被统一隔离，丢失了本可安全使用的 boundary evidence。

C5.16.1 现在：

- 以 WAV frame count / sample rate 为实际时长主值，并用 ffprobe 交叉检查；
- 同时保存 nominal、actual、raw、normalized、delta、reason、health status 和 trust score；
- 默认容差 0.05 秒，CLI/Schema 硬上限 0.10 秒；
- 仅将小幅末端越界规范化到合法边界；开始端和原始值不被覆盖；
- 非有限值、反向区间、较大越界和 containment 失败继续 timing-unusable；
- evidence 坐标规范化不计入 subtitle timing mutation。

### 2.2 Persistent worker 状态

C5.16 的 profile-major 排序可以避免已知的 VAD→no-VAD 残留，但排序不是硬隔离。上游 v1.9.3 的长期 `whisper_context` 内部可保留上一请求的 VAD 映射状态；同一 context 交错执行时，后续 no-VAD 请求可能读取 stale mapping。

C5.16.1 的补丁保留单 server process 和单模型加载，但每个 MVL inference request 都创建并释放独立 `whisper_state`。Capability handshake 必须返回：

```text
request_state_isolation = fresh-whisper-state-per-mvl-request
```

客户端在每次请求前验证 reset proof，记录 worker/context generation 和 isolation action。缺少证明时 `require-safe` 直接 fail closed，或只能采用显式记录的 restart/mode segregation；不会静默继续。正确性因此不依赖 standard/profile-major 请求顺序。

### 2.3 A/B 可观察性

Stock v1.9.3 server 的 JSON 提供 UTF-8 grouped `words`，没有可比较的 individual raw token 对象。旧字段名 `rawTokenParityPassed` 容易被误读为 individual-token parity。

新 artifact 保留旧字段用于解析兼容，同时新增：

- `rawGroupedWordParityPassed`；
- `rawGroupedWordComparablePairCount`；
- `individualRawTokenParityStatus`；
- `individualRawTokenComparablePairCount`；
- nullable `individualRawTokenParityPassed`。

本次真实结果为 grouped-word `21/21`，individual raw token 为 `not-observable-on-stock-server`，没有伪称可比较。

### 2.4 Shareable 产物

Local-only replay summary 继续保留绝对 task/subtitle/report 路径以便调试。Shareable generator 不修改本地原件，而是从七项 allowlist 构建严格副本；execution summary 使用专用 strict schema，移除 local-only 路径并以 task identity、relative internal artifacts 和 external-file hashes 表达引用。Manifest 记录 source/shareable hash、Schema、替换/脱敏/泄漏计数。

## 3. whisper.cpp Patch 与构建

| 项目                          | 值                                                                   |
| ----------------------------- | -------------------------------------------------------------------- |
| Upstream                      | `ggml-org/whisper.cpp` `v1.9.3`                                      |
| Commit                        | `371b5a7561823ab2bb32142d2751e35e7534727b`                           |
| Source tree                   | `3d7ce4f956997cfa325c7556533aba5604278463`                           |
| Patch ID                      | `mvl-mapped-token-raw-vad-json-v1+request-state-isolation-v1`        |
| Patch-series SHA-256          | `78922c97975e76e19613d6fe2e61d7e96ae1b992df4a07ae8d77a31181f81df7`   |
| Serializer patch SHA-256      | `bba39640e7005a1fdeb62c549d04ba76b6fc0d8aedae43daf9c9de1ab10a735d`   |
| State-isolation patch SHA-256 | `0d0df33cae2d273c856db5cfbd63e3e8732be44f1d5ffda481817ea4662eb2ae`   |
| Modified upstream files       | `examples/server/server.cpp`, `include/whisper.h`, `src/whisper.cpp` |
| Decode/VAD algorithm changed  | `false`                                                              |
| Build ID                      | `fe6a169c2af395cfdb8b7e81`                                           |
| Build flags hash              | `efc09a962f99940f6984f53da6c693a82b530bd58bec7f8a9097ca91ada66678`   |
| Stock binary SHA-256          | `faec032ea76cd40b7b40e2f71c336d8192259e2fc4e03dd611a9e186f00f214c`   |
| Patched binary SHA-256        | `483916a177cd930ca9d767010d458cbe1d644d4934a55e579778ce0ce6436870`   |
| Runtime capability hash       | `6f715743ea0126e702ede141196fe4883f5ed8d2be4fff427b6c6c51323bb909`   |

Patch verifier 在正确 commit 上通过，错误 commit 被 pinned-source guard 拒绝，重复应用被识别为 already-applied。补丁未修改 decode 参数、VAD threshold 或模型推理逻辑。

## 4. 实际 WAV duration

测量方法均为 `wav-frame-count/sample-rate+ffprobe-cross-check`，ffprobe cross-check delta 为 0。

| Component              | Nominal s | Actual WAV s | Actual − nominal s |
| ---------------------- | --------: | -----------: | -----------------: |
| `def4f9e5f20a6a24af59` |  4.740000 |    4.7398125 |         -0.0001875 |
| `69e8f46141f7d9276a87` |  6.330000 |    6.3293125 |         -0.0006875 |
| `5475b241d7d856b45194` |  6.880000 |    6.8796875 |         -0.0003125 |
| `eef08480bdcbc8f48776` |  7.700000 |    7.7000000 |                 ~0 |
| `de9815d25ae4c3a8e718` |  7.810000 |    7.8111875 |         +0.0011875 |
| `8ff7342e69430b941161` | 10.300000 |   10.3010000 |         +0.0010000 |
| `5e6df4ca8c77b3a51802` | 11.320000 |   11.3203125 |         +0.0003125 |

## 5. 七个 Raw VAD 边界项

表中 local 秒数保留 raw 与 normalized；所有 7 项都仅修正末端。

| Component / profile | Nominal / actual s     | Raw local   | Normalized local |  Delta | Trust |
| ------------------- | ---------------------- | ----------- | ---------------- | -----: | ----: |
| `5e6d…` current VAD | 11.320000 / 11.3203125 | 10.47–11.33 | 10.47–11.32      | 0.01 s |  0.97 |
| `5e6d…` extra VAD   | 11.320000 / 11.3203125 | 10.29–11.33 | 10.29–11.32      | 0.01 s |  0.97 |
| `69e8…` extra VAD   | 6.330000 / 6.3293125   | 0.00–6.34   | 0.00–6.33        | 0.01 s |  0.97 |
| `def4…` current VAD | 4.740000 / 4.7398125   | 1.38–4.77   | 1.38–4.74        | 0.03 s |  0.91 |
| `def4…` extra VAD   | 4.740000 / 4.7398125   | 1.23–4.77   | 1.23–4.74        | 0.03 s |  0.91 |
| `eef0…` current VAD | 7.700000 / 7.7000000   | 6.76–7.71   | 6.76–7.70        | 0.01 s |  0.97 |
| `eef0…` extra VAD   | 7.700000 / 7.7000000   | 6.61–7.71   | 6.61–7.70        | 0.01 s |  0.97 |

离线 replay 和三运行交叉验收的最终统计：

| Raw VAD 指标                        |            值 |
| ----------------------------------- | ------------: |
| Total                               |            30 |
| Fully trusted，无规范化             |            23 |
| Trusted with boundary normalization |             7 |
| Invalid / large out-of-range        |             0 |
| Maximum automatic delta             |        0.03 s |
| Default / hard maximum tolerance    | 0.05 / 0.10 s |

原始 30 个区间全部保留。规范化后的 7 项进入可信 boundary evidence，但没有变成字幕 timing mutation。

## 6. Worker isolation 与真实运行

### 6.1 Standard-order fresh

顺序为 no-VAD → current-sensitive-VAD → extra-sensitive-VAD。

| 指标                                          |                                                                 值 |
| --------------------------------------------- | -----------------------------------------------------------------: |
| Component / cue / WAV                         |                                                         7 / 16 / 7 |
| Profile attempts                              |                                                                 21 |
| ASR / cache hit                               |                                                             21 / 0 |
| Worker start / model load                     |                                                              1 / 1 |
| Initialization / transcription / worker total |                                 2.756457 / 31.588287 / 34.344744 s |
| Per-request state reset                       |                                                                 21 |
| Unsafe / prevented transition                 |                                                              0 / 0 |
| Restart / mode-segregated worker              |                                                              0 / 0 |
| Fallback process                              |                                                                  0 |
| Request order hash                            | `f2879d11fabd537550cc3b5055f94ca628f5cb9e4de20ee1beac9ed2428bab2e` |
| Whole-media ASR                               |                                                                  0 |

### 6.2 Adversarial-order fresh

请求故意交错并包含 7 次 VAD→no-VAD 潜在危险转换。没有使用 cache。

| 指标                                          |                                                                 值 |
| --------------------------------------------- | -----------------------------------------------------------------: |
| Profile attempts                              |                                                                 21 |
| ASR / cache hit                               |                                                             21 / 0 |
| Worker start / model load                     |                                                              1 / 1 |
| Initialization / transcription / worker total |                                 2.789262 / 30.302706 / 33.091969 s |
| Per-request state reset                       |                                                                 21 |
| Potential / prevented / silent unsafe         |                                                          7 / 7 / 0 |
| Restart / mode-segregated worker              |                                                              0 / 0 |
| Fallback process                              |                                                                  0 |
| Request order hash                            | `73d95b002fe01d88fd4a34b1d6c97aabc75108afdc1c6f2a9dd084c97720a021` |
| Request-order independence                    |                                                             `true` |

### 6.3 Clean-process spot check

对同一 component 的一个 no-VAD 和一个 current-sensitive-VAD 请求分别启用独立 process/context。两项都与 persistent adversarial 结果在 normalized text、decoded segment、grouped raw word、mapped token 和 raw VAD 上一致。每个 spot check 都是 worker start 1、model load 1。

完整 standard/adversarial 21 对的结果：

- normalized text `21/21`；
- decoded segment `21/21`；
- grouped raw word `21/21`；
- mapped-token semantic parity `21/21`；
- raw-VAD semantic parity `21/21`；
- request configuration `21/21`；
- `requestOrderIndependencePassed = true`；
- `cleanProcessParityPassed = true`；
- verification hash `bf06f04b48b632c12da34eee136ee65287c12174afd4588b247c4e0dc18a7ffa`。

## 7. Stock / patched A/B

A/B 改为每一对 stock/patched 请求各用 fresh process，避免 shared-state 污染比较。双方使用相同 pinned source、build flags、large-v3、Silero VAD、WAV、profile、language、无 prompt。

| 指标                              | 结果                                                |
| --------------------------------- | --------------------------------------------------- |
| Pairs / fresh requests            | 21 / 42                                             |
| Text parity                       | 21/21                                               |
| Decoded segment parity            | 21/21                                               |
| Grouped raw-word parity           | 21/21                                               |
| Language / config / prompt parity | 21/21                                               |
| Individual raw-token parity       | `not-observable-on-stock-server`；0 comparable pair |
| Stock / patched mapped token      | 0 / 375                                             |
| Stock / patched Raw VAD           | 0 / 30                                              |
| Stock / patched worker starts     | 21 / 21                                             |
| Stock / patched model loads       | 21 / 21                                             |
| Stock / patched wall time         | 54.433646 / 54.601499 s                             |
| Stock / patched peak RSS          | 3,924,574,208 / 3,678,208,000 bytes                 |
| Stock / patched response bytes    | 47,857 / 273,459                                    |
| Accepted                          | `true`，0 failure                                   |

逐 profile patched mapped token / Raw VAD：no-VAD `139/0`，current VAD `124/17`，extra VAD `112/13`。

## 8. Cache identity 与 replay

新增固定 cache identity：

```text
rawVadBoundaryPolicyVersion = c5.16.1-vad-boundary-normalization-v1
workerStateIsolationPolicyVersion = c5.16.1-worker-state-isolation-v1
```

旧 C5.16 timing cache 不能满足 C5.16.1 fresh/adversarial runtime-state 验收。本次使用新 cache `/Users/paulasmith/.cache/mvl/asr/carnation-c5-16-1-state-isolated-final3-20260826`。最终 cache replay 为 21/21 hit、ASR 0、worker start 0、model load 0、worker seconds 0，并与两个 fresh run 共享相同 canonical/output/presentation hash。

## 9. Shareable artifacts 与审计

每个最终 output 的 `shareable/` 包含 7 个数据 artifact 和一个 manifest：

1. `subtitle-finalization-report.json`；
2. `subtitle-presentation-resolution.json`；
3. `subtitle-overlap-acoustic-resolution.json`；
4. `subtitle-timestamp-evidence-integrity.json`；
5. `whisper-runtime-capability.json`；
6. `c5-16-stock-patched-runtime-ab.json`；
7. `execution-summary.json`；
8. `shareable-artifact-manifest.json`（manifest 本身）。

Standard、adversarial、cache 和 offline 四个 shareable 目录均单独执行严格 audit：

| 指标                | 每目录结果 |
| ------------------- | ---------: |
| Artifact validation |        7/7 |
| Absolute path leak  |          0 |
| Prohibited secret   |          0 |
| Secret redaction    |          0 |
| Validation passed   |     `true` |

最终所选 artifacts 原本已使用 relative/basename/hash 表达，因此 manifest 的 `pathReplacementCount = 0`；local replay summary 的绝对调试路径没有被复制进 shareable execution schema。跨 artifact ID/hash 保持一致，shareable 副本仍通过原始或专用 strict schema。

## 10. 七组 overlap 重新分类

Raw VAD 只证明 speech island/boundary，不证明 speaker 或 foreground/background；本轮没有借小边界容差强行关闭 blocker。

| 时间            | Cue 数 | Best / runner-up / margin                          | 最终                                                            |
| --------------- | -----: | -------------------------------------------------- | --------------------------------------------------------------- |
| 59.140–60.880   |      2 | rapid-turn `0.45` / ordered `0.30` / `0.15`        | unresolved；一侧 mapped sequence 可用但 neighbor intrusion 仍在 |
| 402.050–410.370 |      2 | nested background `0.35` / ordered `0.25` / `0.10` | unresolved；两侧缺少可信 lexical localization                   |
| 436.040–440.850 |      2 | rapid-turn `0.60` / ordered `0.55` / `0.05`        | unresolved；证据不对称且 margin 不足                            |
| 688.310–695.610 |      3 | ordered `0.25` / rapid-turn `0.15` / `0.10`        | unresolved；第三 cue 对齐置信度极低                             |
| 701.460–705.340 |      2 | rapid-turn `0.60` / ordered `0.55` / `0.05`        | unresolved；低置信度/neighbor intrusion                         |
| 772.510–777.210 |      2 | rapid-turn `0.60` / ordered `0.55` / `0.05`        | unresolved；第二 cue profile/timing support 不足                |
| 808.530–811.860 |      3 | nested background `0.35` / ordered `0.25` / `0.10` | unresolved；三条 cue 均缺少安全 localization                    |

七组均 `recommendedAction = review`、`safeAutomaticAction = none`、timing mutation 0。Review items 保持 C5.16 的 `7 → 7`。

## 11. 字幕与证据结果

| 指标                                  | 值                |
| ------------------------------------- | ----------------- |
| Cue count                             | 192               |
| Canonical text mutation               | 0                 |
| Canonical timing mutation             | 0                 |
| Unsafe visible mutation               | 0                 |
| Midpoint / character-ratio repair     | 0 / 0             |
| Whole-media ASR / network / OpenAI    | 0 / false / false |
| Mapped lexical token                  | 363               |
| Trusted / quarantined mapped token    | 266 / 97          |
| Untrusted token used for timing       | 0                 |
| Decoded segment mislabeled as Raw VAD | 0                 |
| Review audio coverage                 | 7/7               |
| Final status                          | `needs-review`    |
| Finalization method                   | `none`            |

Hashes：

- canonical cue: `8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`；
- canonical timing: `510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`；
- presentation cue: `9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`；
- semantic output: `340a01e4a5843640f58e93c4c2758d88258aaeaaf154b1715fa2d11651b4ec41`。

SRT/VTT/ASS serialization round-trip、format semantic parity、canonical parity 和 presentation parity 全部为 `true`，format parity error 为 0。Best-effort 文件 SHA-256：ASS `936ba3c0675bcfb3913f5d05fa5e1e5db88ccc07792b38fd81bdc7aa11412320`，SRT `fc4a3ed5d6338f1c02706ec443544312a5517916d54fcb42671a20e604a12edb`，VTT `53c14e2032f13c9ff4d2ff117be5d998d7192ca9fb7e400b01a33f20789eb76c`。

## 12. Schema、代码与新增命令

生成后的 JSON Schema 总数为 77（C5.16 基线 76）。新增 `shareable-artifact-manifest.schema.json`，并扩展 Raw VAD health、WAV duration provenance、worker state metrics、cache identity、runtime capability、A/B semantics 等 strict schemas。

新增命令：

```text
npm run replay:c5-16-1-runtime-stabilization -- ...
npm run replay:c5-16-1-offline-evidence -- ...
npm run emit:c5-16-1-shareable-artifacts -- ...
npm run verify:c5-16-1-worker-state-isolation -- ...
npm run audit:shareable-artifacts -- --input <output>/shareable
npm run validate:c5-16-1-runs -- --standard <task> --adversarial <task> --cache-replay <task>
```

主要修改文件：

```text
.agents/skills/multilingual-video-subtitler/SKILL.md
README.md
apps/cli/src/index.ts
package.json
packages/shared/src/index.ts
packages/shared/src/mvl-whisper-server-response-schemas.ts
packages/shared/src/overlap-acoustic-resolution-schemas.ts
packages/shared/src/presentation-resolution-schemas.ts
packages/shared/src/shareable-artifact-schemas.ts
packages/shared/src/timestamp-evidence-integrity-schemas.ts
packages/shared/src/transcription-schemas.ts
packages/transcription-core/src/asr-cache.ts
packages/transcription-core/src/overlap-acoustic-resolution.ts
packages/transcription-core/src/timestamp-evidence-integrity.ts
packages/transcription-core/src/worker.ts
packages/video-subtitler/src/finalization.ts
packages/video-subtitler/src/index.ts
packages/video-subtitler/src/overlap-acoustic.ts
packages/video-subtitler/src/shareable-artifacts.ts
patches/whisper.cpp/v1.9.3/0002-mvl-request-state-reset.patch
patches/whisper.cpp/v1.9.3/PATCH_NOTES.md
patches/whisper.cpp/v1.9.3/upstream-manifest.json
schemas/*.schema.json（11 个受影响，其中 1 个新增）
scripts/audit-shareable-artifacts.ts
scripts/build-whisper-runtime.ts
scripts/compare-c5-16-whisper-runtimes.ts
scripts/emit-c5-16-1-shareable-artifacts.ts
scripts/generate-schemas.ts
scripts/replay-c5-15-overlap.ts
scripts/replay-c5-16-1-offline-evidence.ts
scripts/replay-c5-16-1-runtime-stabilization.ts
scripts/validate-c5-16-1-runs.ts
scripts/verify-c5-16-1-worker-state-isolation.ts
scripts/verify-whisper-runtime-patch.ts
scripts/whisper-runtime-common.ts
tests/c5-15-overlap-acoustic.test.ts
tests/c5-16-mapped-token-raw-vad.test.ts
tests/c5-16-1-runtime-stabilization.test.ts
tests/e2e/c5-16-1-runtime-stabilization-flow.test.ts
```

## 13. 验证与兼容

Node 使用 `v24.18.0`；所有 npm 工作流均由 `npx --yes npm@11.18.0` 固定执行。

最终通过：

- install：198 packages audited；
- Schema generation：77；
- typecheck、ESLint、build、Prettier：passed；
- full Vitest：17 files、251 tests passed；
- dedicated E2E：5 files、19 tests passed；
- whisper runtime patch verifier：passed；
- Skill quick validation：`Skill is valid!`；
- four shareable audits：passed；
- cross-run validator：`accepted = true`。

Skill 2 只读仓库 `codex/publish-core-runtime` / `1af10bd8a7057c573959f39a745436fa837127ea`：typecheck 和 build 通过；外部 `grammarReportSchema.parse` 严格解析通过，106 sentences、106 grammar points、schema `1.0.0`。

Skill 3 只读仓库 `codex/publish-core-runtime` / `fea8ae8d67baa14ca98f6c4239d7fb0a7083e1b8`：typecheck 通过，1/1 test 通过；以同一 grammar report 构建静态站点成功，产物 404 KiB，并用 `cmp` 验证复制后的 report 字节一致。两个仓库最终 `git status --short` 均为空。

依赖 advisory：`npm audit` 报告 0 critical、4 high、1 moderate，均为 transitive dependency：`brace-expansion`、`fast-uri`、`nanoid`、`postcss`、`undici`。存在上游可用修复，但本轮没有执行 `npm audit fix --force`，避免超出 runtime-stabilization 范围并破坏锁文件兼容。安装还提示 esbuild/fsevents install scripts 未纳入 allowScripts；现有 build 和测试仍全部通过。

## 14. 输入只读验证

| 输入         |        Size | SHA-256                                                            | 前后                 |
| ------------ | ----------: | ------------------------------------------------------------------ | -------------------- |
| 源视频       | 847,774,958 | `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43` | size/hash/mtime 一致 |
| 人工复核 ASS |      17,094 | `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e` | size/hash/mtime 一致 |

`sourceReadOnlyVerified = true`。没有替换 `/opt/homebrew/bin` 下程序；模型、视频、WAV、cache、上游源码、build 目录和二进制都不进入 Git。

## 15. 实际命令

除常规 install/build/test 外，关键真实命令为：

```bash
npx --yes npm@11.18.0 run replay:c5-16-1-offline-evidence -- <C5.16 source/artifact arguments>
npx --yes npm@11.18.0 run replay:c5-16-1-runtime-stabilization -- <standard fresh arguments>
npx --yes npm@11.18.0 run replay:c5-16-1-runtime-stabilization -- <adversarial fresh arguments>
npx --yes npm@11.18.0 run replay:c5-16-1-runtime-stabilization -- <cache replay arguments>
npx --yes npm@11.18.0 run verify:c5-16-1-worker-state-isolation -- --standard <standard> --adversarial <adversarial> --whisper-server-path <patched> --runtime-capability-manifest <manifest> --model <large-v3> --vad-model <silero>
npx --yes npm@11.18.0 run audit:shareable-artifacts -- --input <task>/shareable
npx --yes npm@11.18.0 run validate:c5-16-1-runs -- --standard <standard> --adversarial <adversarial> --cache-replay <cache>
```

构建、测试和校验命令：

```bash
npx --yes npm@11.18.0 install
npx --yes npm@11.18.0 run generate:schemas
npx --yes npm@11.18.0 run typecheck
npx --yes npm@11.18.0 run lint
npx --yes npm@11.18.0 run build
npx --yes npm@11.18.0 run format:check
npx --yes npm@11.18.0 test
npx --yes npm@11.18.0 run test:e2e
npx --yes npm@11.18.0 run verify:whisper-runtime-patch
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/multilingual-video-subtitler
```

## 16. 失败、修正与跳过项

没有跳过真实 standard、adversarial、clean-process、cache、A/B、shareable 或 Skill 2/3 验收。

开发期间保留了 collision-safe 失败目录，未覆盖调试证据：

- `*-pre-state-patch-failed-*`：证明仅靠排序不能保证对抗顺序安全，促成 upstream fresh-state patch；
- `*-stock-patched-runtime-ab-shared-state-failed-*`：shared-state A/B 被废弃，改为 fresh process per request；
- `*-pre-semantic-hash-failed-*`：output hash 错误包含请求数组顺序，随后改为排序后的语义视图；
- `*-pre-request-config-hash-failed-*`：hash 仍包含 request-order-only 配置，随后移除非语义顺序字段；
- `*-pre-rebuild-hash-failed-*`：命中了旧 dist，重建后重新 fresh 运行；
- 两个早期 standard failed attempt：在完成 runtime patch/证据链前保留，未冒充最终产物。

最终门禁第一次 lint 暴露 3 个 forbidden non-null assertion，修复为空 manifest fail-closed guard；第二次 typecheck 暴露 verifier 缺少 `InputError` import，补齐后全部通过。兼容验证第一次命令也暴露未导出环境变量、Skill 3 依赖未安装和站点路径假设错误；修正验证命令并安装锁定依赖后，两个只读仓库均通过且保持干净。这些失败均未被删除或描述为成功。

## 17. 未解决问题与 C5.17 建议

七组 overlap 仍需要人工听审或更强的精确文本到音频对齐；Raw VAD 不能推断 speaker、foreground/background 或同声关系。因此最终保持 `needs-review` / `finalizationMethod: none`，没有生成虚假的自动终稿。

C5.17 若继续 forced alignment，应以本轮已隔离的 decoded segment、verified mapped token、normalized Raw VAD 和 human-reviewed cue 四类证据为输入，逐 cue 建立可审计的 Japanese text-to-audio alignment。它不能把 Raw VAD 当作 speaker evidence，也不能绕过本轮 worker isolation、cache identity、health gate 或 shareable audit。

## 18. 最终输出路径

- Standard fresh：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-16-1-runtime-stabilized-standard-20260826`
- Adversarial fresh：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-16-1-runtime-stabilized-adversarial-20260826`
- Cache replay：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-16-1-runtime-stabilized-cache-replay-20260826`
- Offline evidence：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-16-1-offline-evidence-20260826`
- Stock/patched A/B：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-16-1-stock-patched-runtime-ab-20260826`
- New ASR cache：`/Users/paulasmith/.cache/mvl/asr/carnation-c5-16-1-state-isolated-final3-20260826`
- Runtime build：`/Users/paulasmith/.cache/mvl/whisper-runtime-c5-16-1/371b5a7561823ab2bb32142d2751e35e7534727b/fe6a169c2af395cfdb8b7e81`

最终原则：小于等于 50 ms 的可解释边界量化误差保留 raw 并安全规范化；更大或结构非法的区间继续隔离；worker 状态用逐请求 fresh state 硬隔离；stock 看不到 individual token 时如实标记不可比较；local-only 调试信息与 shareable 副本明确分离；任何情况下不修改人工文字、人工时间，也不运行整集 ASR。
