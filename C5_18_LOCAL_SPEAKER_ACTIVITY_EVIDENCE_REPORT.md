# C5.18 Local Speaker Activity Evidence 开发报告

结论：Phase 0 已真实回放并独立提交；Phase 1 的源码、严格 Schema、离线运行时、缓存、审核页面和测试已实现并独立提交。官方 Community-1 模型是 gated 模型，而本机当前没有 `HF_TOKEN`，因此模型 Snapshot、真实 14 次推理、Fresh/Observe/Cache 三次回放没有执行，也没有生成或伪造 C5.18 Speaker Evidence 输出。本轮功能代码可交付，但 C5.18 真实模型验收仍为 blocked。

## 1. 开发分支和基线 commit

- 仓库：`https://github.com/kai987/Codex-Skills-multilingual-video-subtitler`
- 开发分支：`codex/c5-18-local-speaker-activity-evidence`
- 基线分支：`codex/c5-17-2-review-evidence-audio-handoff`
- 基线 commit：`0a468a1d7e786f5309e128d59dc20276bc235439`
- 没有基于 `main` 开发，也没有重写 C5.17.2 分支。

## 2. Phase 0 / Phase 1 两阶段结构

- Phase 0：统一 Review Action 语义门禁，并用 C5.17.2 离线回放验证。
- Phase 1：增加本地 Community-1 运行时、双窗口说话人证据、严格安全仲裁、缓存、Review UI、Shareable 和跨运行验证。
- 两阶段代码位于两个独立功能提交中；Phase 1 的模型授权失败不影响 Phase 0 的独立有效性。

## 3. Phase 0 Commit SHA

`d8c6390a6bb74661d610f608613845dc06c03877`，提交标题：`fix: enforce review action semantics`。

## 4. Phase 1 Commit SHA

`0fafc5b4d83b89e0c864b1849c3be78b6a606c8f`，提交标题：`feat: add C5.18 local speaker activity evidence`。

最终远端 HEAD 会是包含本报告的文档提交；由于 Git commit SHA 包含本报告自身内容，报告内部无法无悖论地预写自身所属提交 SHA。推送后的真实远端 HEAD 必须以最终交付回复和 `git ls-remote` 结果为准。

## 5. Review Action 剩余问题复现

真实 Phase 0 报告记录修复前：无候选时错误生成 ACCEPT shortcut 7 次、无效 Resolution 可下载 7 次、快捷键绕过 `allowedHumanActions` 7 次。修复后这三项均为 0。

## 6. 统一 Action Validator

按钮、快捷键、批量操作、恢复/导入状态、预览、autosave 和下载全部使用同一 action registry、candidate binding 和 strict validator。`review-action-validation-report.json` 的 policy 为 `c5.18-review-action-semantics-v1`，真实回放校验 56 个 action 组合，`validationPassed: true`。

## 7. Shortcut 修复

快捷键不再直接构造 Resolution。没有可接受 candidate 时，ACCEPT 不可用；REJECT 同样要求有效且绑定的 candidate。真实回放中 `shortcutBypassCount: 0`、`noCandidateShortcutResolutionDelta: 0`。

## 8. LocalStorage 旧状态处理

恢复状态必须匹配 review version、review item、candidate、action 和当前允许集合；stale、foreign、missing 或 unbound 状态进入 quarantine，不能影响预览、autosave 或下载。本次真实 Phase 0 输入没有旧的非法状态，因此 `quarantinedSavedActionCount: 0`；异常分支由单元测试覆盖。

## 9. 下载 Preflight

下载前重新运行与 UI 相同的语义验证。7 个没有有效 Resolution 的 review item 均被 fail-closed，真实报告为 `downloadBlockedCount: 7`，不存在无效 Resolution 下载。

## 10. Speaker Runtime 选择

主后端固定为本地 `pyannote/speaker-diarization-community-1`。禁止云端回退。Python Runtime 位于用户 cache，未写入仓库；worker 使用 JSONL 持久进程、并发 1、每个进程只加载一次 pipeline。

## 11. Model Terms/Token 处理

模型页需要用户接受条件，并通过名为 `HF_TOKEN` 的环境变量提供 read token。源码不接收 token CLI value，不打印或写入 token，并在正常推理 worker 环境中移除 token、启用 `HF_HUB_OFFLINE=1` 和 `TRANSFORMERS_OFFLINE=1`。

实际 fail-closed 命令：

```bash
env -u HF_TOKEN npm run prepare:speaker-runtime -- \
  --fetch-speaker-models \
  --speaker-model pyannote/speaker-diarization-community-1 \
  --model-revision 3533c8cf8e369892e6b79ff1bf80f7b0286a54ee \
  --hf-token-env HF_TOKEN
```

实际结果：退出并报告 `HF_TOKEN is not set`，没有切换云端、没有创建 model manifest。

## 12. Runtime Identity

- Runtime ID：`c518-9895ab91d9a22820`
- Python：`3.13.14`
- `pyannote.audio 4.0.7`
- `torch 2.11.0`
- `torchaudio 2.11.0`
- `huggingface-hub 1.28.0`
- `numpy 2.5.2`
- `scipy 1.18.1`
- `soundfile 0.14.0`
- Direct requirements SHA-256：`3c7b6d6a0c404e61cb714a964e1bd0387904c8aea78a558307c28cc3943ce36c`
- Explicit freeze SHA-256：`26443a1a887c77837cd1fe0a039300ebd1cbd12e0859d2ce1193f0decbc30668`
- Runtime identity：`3c188505fcc51dfd8b10b07de9dcafc93b5668201be1d95676a6c458c1118976`
- Runtime 大小：约 `1.0G`，仅在用户 cache 中。

## 13. Model Snapshot Identity

- 固定 repo：`pyannote/speaker-diarization-community-1`
- 固定完整 revision：`3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`
- 实现会对完整文件清单以及 bundled `embedding`、`plda`、`segmentation` 子快照记录 size/SHA-256 并计算稳定 identity。
- 当前真实 model manifest 和 model snapshot hash：**未生成**。原因是 gated 模型授权/token 缺失；不得把 revision SHA 伪称为本地 snapshot hash。

## 14. Model License/Citations

- License：CC BY 4.0。
- 官方模型页：`https://huggingface.co/pyannote/speaker-diarization-community-1`
- Runtime 源码：`https://github.com/pyannote/pyannote-audio`
- 代码中记录论文：`https://arxiv.org/abs/1911.01255` 与 `https://arxiv.org/abs/2104.04045`。

## 15. Standard/Exclusive Capability

Worker 明确读取 Community-1 的 `speaker_diarization`（Standard，可表达重叠）与 `exclusive_speaker_diarization`（Exclusive，互斥 turn/change）；任一必需输出不可用即失败。Fake persistent-worker 集成测试覆盖两种输出。由于真实模型未下载，真实 capability probe 尚未完成，不能声称已实际观察。

## 16. Confidence unavailable 处理

Community-1 worker 不伪造 segmentation 或 speaker confidence；输出显式记录 `confidenceStatus: unavailable`，capability 中对应两项均为 false。后续决策只使用可验证的区间结构、窗口稳定性、局部 lexical/acoustic lineage 和保守阈值。

## 17. Device/MPS/CPU

本机 Torch 探测：MPS built `true`、MPS available `true`、CPU available `true`。`auto` 会先尝试 MPS，验证所有 pipeline 参数/buffer 的 device，失败则记录原因并退回 CPU；显式 `mps` 失败会报错。Fake-worker 测试覆盖 auto CPU fallback 和 explicit-MPS failure。真实 pipeline device transfer、有限输出和 MPS/CPU 语义比较尚被模型授权阻塞。

## 18. 7 个 Review WAV 身份

Phase 0 再验证 7/7 Review WAV 可播放且完整覆盖 component：

| Review ID                     | Cue 数 | WAV SHA-256                                                        |
| ----------------------------- | -----: | ------------------------------------------------------------------ |
| `review-292cf969a432fbddbffc` |      2 | `59be766eb77e88b9949e7eef58af09ae56fd69b3e37456a4b5999b3aec3cfbc1` |
| `review-4edc6c32f76083bd2a55` |      2 | `c4cb270e82ef79573e09833a45da460ad2c9335e8e5506f544bf26fdd738d46b` |
| `review-525458408b2864f2fff2` |      2 | `c3a1f75ce614e67b2fbeba65fc713b0299f1681a9c64c05e9ba2dfd4d155fe28` |
| `review-0646501fe49b1b5d0a31` |      3 | `f600564e7a9e3f82083a1a12d80f00ec58876e1fae069ff4fc9e2435f31969be` |
| `review-ca4841c6308c7e927da6` |      2 | `e4ee96d94408bce9d35a88dc010e77f982ec0f3999890e8c362b3f62ac48ff65` |
| `review-5c6637656cf727da89f1` |      2 | `c16d32ae84d73a67bd3f03e103fb3bd594c73122d1e7a5efb6e387b737752640` |
| `review-cf2efc651b4b47143dde` |      3 | `641fd265e3db437030efdeb4011085cdab67f9426a308c02377576fb671c87b2` |

合计 7 component、16 cue。没有重新从整集视频提取音频。

## 19. 14 个双窗口推理

实现为每个 component 最多 Context 和 Union-only 两次，Union-only 使用 WAV frame 精确内存裁剪，不调用 FFmpeg；硬上限 14、并发 1。真实 Pipeline inference：`0`；真实 model load：`0`，因为 preparation 在 token preflight 处失败。测试中的 mock 14 请求不能当作真实推理。

## 20. Window Speaker Mapping

实现使用时间活动 overlap 的小规模最优 assignment，将 Context/Union raw label 映射为 deterministic、anonymous、component-local ID。映射和 semantic hash 对 raw label permutation 不敏感；最多 3 speaker，未映射或 margin 不足时 unresolved。

## 21. Speaker Stability

稳定性同时检查 speaker count、window mapping、activity overlap、cue assignment 和 change point。窗口 speaker 数不一致、映射不稳定或 change displacement 超阈值均 fail closed。真实 7 组稳定性结果未产生。

## 22. Overlap Speech Evidence

Standard track 用于局部 overlap interval；实现覆盖无重叠、稳定双 speaker、nested、三 speaker 和窗口冲突。Raw VAD 只表示 speech activity，不能冒充 overlap speaker evidence。真实 overlap interval 数：未观察。

## 23. Speaker Change Evidence

Exclusive track 提供互斥 turns 和 change points；双窗口 change 必须稳定。Timing proposal 使用实际 speaker change 边界，不使用 midpoint、平均值或比例切割。真实 change point 数：未观察。

## 24. Cue Speaker Assignment

assignment window 的优先级为 accepted Forced Alignment、稳定 MFA、可信 Evidence-DP、source cue prior。Speaker label 只回答局部 activity hypothesis，不识别人。真实 assignment 数：未观察。

## 25. Evidence Lineage 去重

每条 boundary/lexical/acoustic support 按 lineage ID 去重；同一 lineage 不能因在多个 artifact/window 中出现而重复计权。Raw speaker label 不进入 lineage identity 或跨运行 semantic hash。

## 26. Acoustic Prominence

只在 Exclusive 非重叠 PCM 区间上估计能量，并明确标为 `uncalibrated-heuristic`。缺少足够非重叠样本时保持 unavailable；音量不改变 speaker identity、relationship 或 timing eligibility。

## 27. Foreground/Background 限制

不输出人物身份、角色名、性别、年龄、国籍、voiceprint 或跨 component speaker link。Prominence 不是 foreground/background 真值。只有稳定 nested activity 可产生保守 presentation label，且不进入 canonical text/timing。

## 28. Component Relationship 分类

实现分类：`ordered-different-speaker-turns`、`same-speaker-boundary-overlap`、`stable-multi-speaker-overlap`、`nested-multi-speaker-activity`、`single-speaker-only` 和 conflict/unresolved。Nested 需要持续时间与覆盖结构满足更严格条件，避免把共同主说话人 overlap 误分为背景活动。

## 29. 七组逐项结果

| Review ID                     | Component source                        | 真实 Speaker 结果                 |
| ----------------------------- | --------------------------------------- | --------------------------------- |
| `review-292cf969a432fbddbffc` | `overlap-acoustic-def4f9e5f20a6a24af59` | 未推理：gated model/token blocker |
| `review-4edc6c32f76083bd2a55` | `overlap-acoustic-5e6df4ca8c77b3a51802` | 未推理：gated model/token blocker |
| `review-525458408b2864f2fff2` | `overlap-acoustic-de9815d25ae4c3a8e718` | 未推理：gated model/token blocker |
| `review-0646501fe49b1b5d0a31` | `overlap-acoustic-8ff7342e69430b941161` | 未推理：gated model/token blocker |
| `review-ca4841c6308c7e927da6` | `overlap-acoustic-5475b241d7d856b45194` | 未推理：gated model/token blocker |
| `review-5c6637656cf727da89f1` | `overlap-acoustic-eef08480bdcbc8f48776` | 未推理：gated model/token blocker |
| `review-cf2efc651b4b47143dde` | `overlap-acoustic-69e8f46141f7d9276a87` | 未推理：gated model/token blocker |

因此真实 speaker 数、overlap interval 数、change point 数、assignment 数和 component decision 均为“未观察”，而不是 0 或猜测值。

## 30. Timing-only Mutation

安全门禁要求：双窗口、speaker assignment 和 change 稳定；两侧各有局部非 Raw-VAD lexical/acoustic support；低 neighbor intrusion；边界距 change 不超过 0.25 秒；单次移动不超过 0.50 秒；修改后 cue 至少 0.40 秒；不产生新非法重叠；component 原子应用/回滚。Canonical text mutation 永远为 0。真实 timing mutation 未执行。

## 31. Presentation-only Proposal

稳定 multi-speaker overlap 或 nested activity 可产生 ASS/VTT/SRT presentation-only proposal；canonical cues 保持不变。真实 proposal 未生成。

## 32. Review Page Speaker Track

静态页面新增 anonymous Standard/Exclusive tracks、overlap、change point、cue assignment、prominence、relationship 与免责声明。播放把 media-global 区间显式转换为 clip-local；页面保持 CSP 禁网、无需 server。真实 C5.18 页面尚未物化；mock E2E 已验证页面和严格数据加载。

## 33. Review Version 更新

新 review version identity 包含 speaker evidence artifact、runtime identity、model snapshot、policy、assignment 和 relationship hash；旧 C5.17.2 human resolution 因版本不匹配必须被 stale check 拒绝。真实新 review version 尚未生成。

## 34. Fresh 指标

- 实际 Fresh run：未启动。
- Pipeline inference：0。
- Model load：0。
- Speaker/overlap/change/assignment/mutation：未观察。
- 原因：model preparation 在授权/token preflight fail closed。

## 35. Observe 对照

Observe 实现保证 timing mutation 为 0，并保留与 Fresh 可比较的 semantic/component hash。真实 Observe 未启动，不能报告 parity 通过。

## 36. Cache Replay

真实 Cache Replay 未启动，因此真实 hit 为 `0/14`（没有请求），不能声称 `14/14`。单元测试真实执行 portable cache 写入/读取，得到 14/14 mock hit、pipeline inference 0、model load 0；这只验证缓存机制，不替代模型验收。

## 37. Cache Identity

Key 包含 WAV SHA、window type、local/global interval、runtime/package identities、model/dependency hashes、device、min/max speakers 和六类 policy；不包含输出/任务目录、生成时间、token 或绝对路径。Import/read/write 通过 strict Schema，并支持 portable cache。

## 38. Review Delivery Integrity

Phase 0 真实结果：7/7 audio playable，coverage failure 0，delivery integrity passed，cue count 192，final status `needs-review`，`finalizationMethod: none`。Phase 1 replay 会重新生成并校验 integrity，但真实 replay 尚未运行。

## 39. Shareable/Privacy Audit

Shareable allowlist 已加入五个 C5.18 JSON artifact，并在三次跨运行验证完成后安全再物化 validation artifact、更新 execution/manifest identity。WAV、raw embedding、token、runtime/model cache path、临时音频和身份猜测默认排除。代码与测试检查绝对路径和 secret；真实 C5.18 shareable 尚未生成。

## 40. Canonical/Timing/Presentation Hash

Phase 0 真实回放前后保持：

- Canonical cue hash：`8ec01ef362387aa4a4b61cb7c7cb3d2d4f4932f38aff3a4b5695deedfa1ccc83`
- Canonical timing hash：`510c3f20b82ecd263cd2234057536eaddda0dc94efac599ffe72aa3fc843ec02`
- Presentation artifact hash：`7ba2058662d21b3de386d5ec0085636f108ee3a8bf0902affdd96d299308efbf`
- Baseline presentation cue hash：`9e1371375397df403bf2647cc805b8c70d6c2628eca1eb4f94dca32cc7eed4de`

没有 C5.18 Phase 1 output hash；不能用 mock hash 或基线 hash冒充。

## 41. Review items 前后变化

Phase 0：7 → 7，文本、canonical timing、presentation 均无变化；仅 action semantics/report/review-version identity 相关元数据更新。Phase 1 真实前后对比尚未产生。

## 42. Final Status

- Phase 0 artifact：`needs-review` / `finalizationMethod: none`。
- Phase 1 源码状态：implemented and tested without gated model。
- Phase 1 真实验收状态：`blocked-model-authorization`。
- 没有将 blocked 状态包装成 completed，也没有生成伪 Speaker artifact。

## 43. Skill 2/3 兼容

两个 Phase 0 输出中 Skill 2 `grammar-report.json` 均为 106 sentences，Skill 3 的 `site/index.html` 均存在；当前仓库完整 `npm run build` 也通过。Skill 2/3 独立只读仓库未修改。由于 Phase 1 replay 未运行，尚无新 C5.18 output 内的 compatibility copy。

## 44. 输入只读

- C5.17.2 task critical artifacts：Phase 0 replay 报告 `sourceTaskCriticalArtifactsReadOnly: true`。
- 源视频当前 size `847,774,958`、SHA-256 `294e5c838ec41faf59cc359c9eb49da68c9a323a2fd185b2d896fa3b94499a43`、mtime `2026-07-22T12:53:32+0900`，与任务基线一致。
- 人工 ASS 当前 size `17,094`、SHA-256 `a758701ed7c6e7ccf02ddda7646d7c46ffe4432e0f7dce0a7f6933146f6f100e`、mtime `2026-08-25T02:09:17+0900`，与任务基线一致。
- Phase 1 因 preflight 阻塞，没有读取后写回这些输入。

## 45. Unit Tests

命令：`npm test`。

实际结果：29 files passed；419 tests passed；2 skipped；421 total。跳过项是需外部真实 fixture/runtime 的可选集成路径，其中包括 `MVL_SPEAKER_INTEGRATION_TEST=1` 的真实模型 probe；核心 C5.18 定向测试为 24 passed、1 optional speaker integration skipped。

## 46. E2E

命令：`npm run test:e2e`。

实际结果：8 files passed；25 tests passed；1 skipped；26 total。新增 C5.18 mock E2E 验证 dual-window output → strict analysis artifact → anonymous local review page；该测试不是实际模型推理。

## 47. Schema 总数

命令：`npm run generate:schemas`。实际生成 99 个 JSON Schema（C5.17.2 基线为 90），包含 8 个新增 C5.18 artifact schema，并更新 review/finalization/presentation schema。

## 48. Skill Validation

命令：

```bash
python3 /Users/paulasmith/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/multilingual-video-subtitler
```

实际结果：`Skill is valid!`。此外 `npm run build`、`npm run typecheck`、`npm run lint` 和 `npm run format:check` 均通过。

## 49. 依赖 Advisory

`npm audit --json` 实际报告 5 个 transitive vulnerability：4 high、1 moderate、0 critical。涉及 `brace-expansion 5.0.7`、`fast-uri 3.1.4`、`nanoid 3.3.16`、`postcss 8.5.21`、`undici 7.28.0`；均有 patch 修复。`npm audit fix --dry-run --json` 建议分别更新至 5.0.9、3.1.6、3.3.18、8.5.26、7.29.0。它们是既有 JS dependency tree 的 transitive advisory，本轮未在未授权情况下改动 lockfile；应在独立依赖升级提交中更新并重跑完整测试。

## 50. 未解决问题

1. 用户尚未在官方模型页完成可验证授权，且环境中没有 `HF_TOKEN`。
2. 因此没有本地 model snapshot 文件/hash、真实 Standard/Exclusive capability、MPS/CPU pipeline comparison 或七组 speaker evidence。
3. Fresh/Observe/Cache、真实 14/14 cache parity、C5.18 review delivery/shareable audit 尚未运行。
4. 5 个既有 transitive npm advisory 尚待独立 patch upgrade。

## 51. 是否可以进入下一版本

不可以把 C5.18 标记为真实验收完成，也不应进入依赖真实 speaker evidence 的下一版本。可先合并 Phase 0 和 Phase 1 实现；待用户在官方页面接受条件并在本地 export read-capable `HF_TOKEN` 后，按第 11 节和 README 的命令完成 model prepare、verify、Fresh、Observe、Cache Replay 与 cross-run validation。

## 52. 所有输出路径

- Phase 0 主输出：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-review-action-hotfix-20260826`
- Phase 0 兼容回放：`/Users/paulasmith/Documents/Codex-Skills/output/carnation-reference-guided-c5-18-review-action-hotfix-from-c5-17-1-20260826`
- 本地 Python Runtime：`/Users/paulasmith/.cache/mvl/speaker-runtime/c518-9895ab91d9a22820`
- Runtime manifest：`/Users/paulasmith/.cache/mvl/speaker-runtime/c518-9895ab91d9a22820/manifests/speaker-runtime-manifest.json`
- Model manifest：未生成。
- C5.18 Fresh output：未生成。
- C5.18 Observe output：未生成。
- C5.18 Cache Replay output：未生成。
- 开发报告：仓库根目录 `C5_18_LOCAL_SPEAKER_ACTIVITY_EVIDENCE_REPORT.md`。

## 实际命令摘要

```bash
npm run generate:schemas
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
npm run test:e2e
npm audit --json
npm audit fix --dry-run --json

# Runtime 已创建；下面的 gated model fetch 在 token preflight 处按设计失败
env -u HF_TOKEN npm run prepare:speaker-runtime -- \
  --fetch-speaker-models \
  --speaker-model pyannote/speaker-diarization-community-1 \
  --model-revision 3533c8cf8e369892e6b79ff1bf80f7b0286a54ee \
  --hf-token-env HF_TOKEN
```

未执行且不得伪称已执行的命令：真实 `verify:c5-18-speaker-runtime`、Fresh、Observe、Cache Replay、`validate:c5-18-runs`、C5.18 review-delivery audit 和 C5.18 shareable audit。
