# Multilingual Video Subtitler

## 独立字幕工具 v1 候选版

完整本地视频/音频 → 本地 Whisper → ASS/SRT/VTT 机器字幕草稿。首次配置后，仅需输入文件和输出目录；默认不搜索参考字幕、不调用云端。

阅读 [安装与日常使用](STANDALONE_SUBTITLE_TOOL_V1.md) 和 [本轮交付报告](SUBTITLE_TOOL_V1_DELIVERY_REPORT.md)。使用 `npm ci && npm run build:subtitle-tool` 定向构建，无需构建语法学习站点。

以下为保留兼容的旧高级工作流；其来源优先级和终稿授权规则不适用于新入口的机器草稿导出。

Codex Skill and TypeScript runtime for extracting, finding, generating, validating, and optionally burning Chinese, Japanese, and English subtitles.

The workflow prefers validated embedded or public subtitles, then local `whisper.cpp` transcription. OpenAI transcription is only used when explicitly selected or when the automatic provider has no usable local adapter and `OPENAI_API_KEY` is configured.

## Requirements

- Node.js `>=24 <25`
- npm `>=11` (the repository pins `npm@11.18.0`)
- FFmpeg and ffprobe
- For local transcription: `whisper-cli` plus a compatible whisper.cpp GGML model

## Install

```bash
nvm use
npx --yes npm@11.18.0 install
npm run build
```

Copy `.env.example` values into your shell or secret manager when needed. Never commit real provider credentials.

## Run

Use the Codex Skill wrapper:

```bash
node .agents/skills/multilingual-video-subtitler/scripts/run.mjs \
  --input "/path/to/video.mkv" \
  --no-online-search
```

Or run the CLI directly:

```bash
npm run subtitle -- \
  --input "/path/to/video.mkv" \
  --dialogue-language ja \
  --transcription-provider auto \
  --finalization review-fallback
```

Finalize an existing task without re-running ASR:

```bash
npm run subtitle-finalize -- \
  --task "/path/to/task-output" \
  --finalization auto
```

To make a user-confirmed human-reviewed ASS the authoritative baseline, pass it explicitly. The importer preserves its cue text, timing, speaker, and styles; disables stale machine candidates and automatic duplicate removal; records source hashes and any in-memory timestamp-separator recovery; and writes `subtitle-package.human-reviewed-base.json` with matching `.human-reviewed-base.srt`, `.vtt`, and `.ass` derivatives:

```bash
npm run subtitle-finalize -- \
  --task "/path/to/task-output" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --finalization review-fallback \
  --presentation-resolution enforce \
  --overlap-resolution conservative
```

Finalization keeps the strict v1 package cues canonical and writes display-only line breaks, repetition classifications, overlap-component decisions, and any trusted timing-only repair to `subtitle-presentation-resolution.json`. `--presentation-resolution observe` records recommendations without applying them; `off` preserves the legacy quality gate. `--overlap-resolution balanced` additionally permits only tightly bounded authoritative rapid-turn overlap and still never uses an unsupported midpoint trim.

C6.0 adds an opt-in protected finalization policy without changing the default legacy path. `protected-observe` classifies every known legacy finding with the exact-match risk policy and writes strict authority, freshness, preservation, risk, review-disposition, replay, and shareable-audit artifacts, but it cannot change finalization status or create final files. `protected-enforce` may release only a cryptographically verified, user-confirmed human-reviewed baseline whose source lineage, canonical text/timing, presentation serialization, and read-only checks all pass. Machine-only release remains forbidden and fails closed with `MACHINE_ONLY_BLIND_ACCEPTANCE_REQUIRED`.

```bash
npm run subtitle-finalize -- \
  --task "/path/to/c5-19-task" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --source-video "/path/to/source-video.mkv" \
  --c6-finalization-policy protected-observe

npm run replay:c6-0-protected-finalization -- \
  --task "/path/to/c5-19-task" \
  --output "/path/to/new-c6-task" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --source-video "/path/to/source-video.mkv" \
  --c6-finalization-policy protected-enforce
```

Protected finalization separates current-output safety from mutation safety. A preservation-supported component can explain why the accepted human baseline is safe without claiming that the underlying subtitle overlap was automatically resolved. The original legacy blocker and Review Item counts remain auditable in every protected result. Unknown finding codes and stale or incompatible upstream artifacts fail closed; no prefix or substring policy matching is used. The policy flag accepts only `legacy`, `protected-observe`, or `protected-enforce`, defaults to `legacy`, and has no unsafe bypass.

To collect bounded local acoustic evidence only for still-blocking overlap components, opt in to C5.15. It extracts each complete component union plus bounded context, runs three prompt-free local `large-v3` profiles through the shared whisper.cpp worker/cache, and aligns the already-reviewed text only after ASR. `observe` writes evidence without closing findings; `enforce` may apply an atomic timing-only repair or a serializer-only legal-overlap layout when the localized evidence passes every threshold. It never runs whole-media ASR or changes reviewed text:

```bash
npm run subtitle-finalize -- \
  --task "/path/to/task-output" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --source-video "/path/to/source-video.mkv" \
  --audio-track 1 \
  --overlap-acoustic-resolution enforce \
  --local-transcription-model "/path/to/ggml-large-v3.bin" \
  --whisper-vad-model "/path/to/ggml-silero-v6.2.0.bin" \
  --whisper-execution-mode persistent \
  --asr-cache-dir "/path/to/portable-cache"
```

The stage writes `subtitle-overlap-acoustic-resolution.json`, `overlap-whisper-execution-metrics.json`, and `overlap-asr-cache-manifest.json`. The default is `--overlap-acoustic-resolution off`; the request budget defaults to 21 and cannot exceed 28.

C5.15.1 adds a strict timestamp-evidence integrity layer. Use `--timestamp-evidence-integrity enforce` to quarantine token timing whose coordinate system cannot be proven, while retaining its text for lexical matching. With the Homebrew whisper.cpp 1.9.1 server, VAD-profile word timestamps are treated as VAD-processed local coordinates and are never added directly to the extraction offset; health-validated no-VAD tokens remain eligible. Decoded segments, trusted tokens, raw VAD intervals, and source cues are stored as distinct evidence classes in `subtitle-timestamp-evidence-integrity.json`. Cache identity includes mapping, health-policy, coordinate-system, and runtime-capability versions. Legacy overlap cache timing defaults to `reject`; `text-only` may reuse text but always quarantines its token timing.

```bash
npm run replay:c5-15-1-timestamp-integrity -- \
  --task "/path/to/c5-15-task" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --source-video "/path/to/source-video.mkv" \
  --audio-track 1 \
  --timestamp-evidence-integrity enforce \
  --token-timestamp-policy auto \
  --legacy-overlap-cache-policy reject \
  --local-transcription-model "/path/to/ggml-large-v3.bin" \
  --whisper-vad-model "/path/to/ggml-silero-v6.2.0.bin" \
  --asr-cache-dir "/path/to/c5-15-1-cache"
```

Audit a legacy C5.15 artifact with `npm run audit:c5-15-token-timestamps -- --artifact <artifact.json>`. The command reports containment, zero-duration, boundary-clamp, and maximum-drift evidence without modifying the artifact.

C5.16/C5.16.1 can use the pinned repo-local whisper.cpp v1.9.3 runtime patch to expose official mapped-token timestamps and raw VAD boundaries. C5.16.1 measures each extracted WAV from frame count, preserves every raw interval, and normalizes only an explainable boundary overrun within the configurable 50 ms default tolerance (100 ms hard maximum). Larger or structurally invalid intervals remain quarantined. The patched server creates a fresh `whisper_state` for every MVL inference request while retaining one server process and one loaded model, so correctness no longer depends on arranging no-VAD before VAD requests. Cache identity includes the raw-VAD boundary and worker-state-isolation policy versions.

C5.18 hardens every review action route through one action registry and adds bounded, local speaker-activity evidence for the seven verified C5.17.2 review WAVs. Speaker labels are anonymous and component-local. Standard diarization supplies overlap evidence, Exclusive diarization supplies mutually exclusive turns and change points, and acoustic prominence remains an uncalibrated heuristic. None of those identify a person, character, or gender. Speaker evidence alone can never change canonical text or timing.

The speaker runtime pins `pyannote/speaker-diarization-community-1` to commit `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee`, records the bundled embedding, PLDA, and segmentation identities, and runs offline after preparation. Community-1 is gated and CC BY 4.0: accept its official terms first and expose a read-capable token only through the named environment variable. The token is not accepted as a CLI value and is removed from inference-worker environments.

```bash
npm run prepare:speaker-runtime -- \
  --create-runtime \
  --fetch-speaker-models \
  --speaker-model "pyannote/speaker-diarization-community-1" \
  --model-revision "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee" \
  --hf-token-env HF_TOKEN

npm run verify:c5-18-speaker-runtime -- \
  --runtime-manifest "/path/to/speaker-runtime-manifest.json" \
  --probe-audio "/path/to/one-review.wav"

npm run replay:c5-18-speaker-evidence -- \
  --task "/path/to/c5-17-2-task" \
  --speaker-runtime-manifest "/path/to/speaker-runtime-manifest.json" \
  --speaker-evidence enforce \
  --speaker-window-mode dual \
  --speaker-device auto \
  --speaker-evidence-concurrency 1 \
  --speaker-presentation-resolution enforce \
  --asr-cache-mode read-write
```

Run Observe and read-only Cache Replay from the Fresh task, then validate all three with `npm run validate:c5-18-runs -- --fresh <task> --observe <task> --cache-replay <task>`. Acceptance requires 14/14 speaker-cache hits, zero cache-replay model loads/inferences, semantic parity, unchanged human text, and passing review/shareable integrity. Real model integration tests are opt-in with `MVL_SPEAKER_INTEGRATION_TEST=1`; normal CI never downloads the model.

C5.18.1 adds transcript-constrained local CTC alignment for only the 16 cues in those seven review components. It pins the Large Reazon Japanese Wav2Vec2 snapshot, runs one persistent offline worker, derives frame intervals from the model convolution geometry, and compares narrow and expanded windows independently on both boundary sides. CTC, greedy decoding, and candidate acoustic streams never author subtitle text. A timing-only repair needs stable dual-window CTC plus independent lexical evidence on both sides, non-contradictory speaker/neighbor evidence, a resolved joint component assignment, bounded movement, and atomic component application.

The optional SepFormer fallback is `off|observe` only. Its outputs are named Candidate Stream A/B, are cross-domain experimental evidence, cannot authorize timing, and are never copied as WAVs into shareable output. Prepare and verify the independent CTC runtime, then replay and validate with:

```bash
npm run prepare:ctc-runtime -- --create-runtime --fetch-models
npm run verify:c5-18-1-ctc-runtime -- \
  --runtime-manifest "/path/to/ctc-runtime-manifest.json" \
  --model-manifest "/path/to/ctc-model-manifest.json" \
  --probe-audio "/path/to/review.wav"
npm run replay:c5-18-1-ctc-boundary -- \
  --task "/path/to/c5-18-fresh-task" \
  --output "/path/to/new-c5-18-1-task" \
  --ctc-runtime-manifest "/path/to/ctc-runtime-manifest.json" \
  --ctc-boundary enforce \
  --ctc-device auto \
  --ctc-separation-fallback observe \
  --ctc-cache-mode read-write
npm run validate:c5-18-1-runs -- \
  --fresh "/path/to/fresh" \
  --observe "/path/to/observe" \
  --cache-replay "/path/to/cache-replay"
```

The exact cache identity covers audio frames, target/token hashes, runtime/model/tokenizer/device, CTC policy, normalization, Viterbi, and frame mapping—not task paths or timestamps. Observe and Cache Replay must read every Fresh direct/separated CTC and separation result without loading either model.

Local task artifacts retain full diagnostic paths. For sharing, generate strict relative-path copies and audit them for absolute paths and secret-like values:

```bash
npm run emit:c5-16-1-shareable-artifacts -- --task "/path/to/task-output"
npm run audit:shareable-artifacts -- --input "/path/to/task-output/shareable"
```

Use `npm run replay:c5-16-1-offline-evidence --` to migrate existing C5.16 evidence without ASR. Use `npm run replay:c5-16-1-runtime-stabilization --` for standard, adversarial, or cache-replay execution and `npm run verify:c5-16-1-worker-state-isolation --` plus `npm run validate:c5-16-1-runs --` for parity and cross-run acceptance. Stock whisper.cpp exposes grouped words rather than individual timed tokens, so A/B output calls this `rawGroupedWordParityPassed` and records individual-token parity as `not-observable-on-stock-server` instead of claiming equivalence.

Replay an existing human-reviewed task into a collision-safe sibling directory without ASR, subtitle lookup, network access, or model/API calls:

```bash
npm run replay:c5-14-presentation -- \
  --task "/path/to/c5-13r-3-task" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --source-video "/path/to/source-video.mkv"
```

The replay verifies the human ASS and optional source video before and after the run, writes `c5-14-replay-summary.json`, and creates review audio only for unresolved blocking groups.

For a collision-safe C5.15 replay that defaults to targeted enforcement and supports a second cache-only pass, use `npm run replay:c5-15-overlap --` with the same task, human subtitle, source video, model, VAD, audio-track, and cache options. The C5.14 directory and both source files remain read-only.

If evidence is insufficient, `review-fallback` writes honest `.best-effort.*` files, a strict `subtitle-package.needs-review.json`, an offline review page, bounded local audio clips, and candidate suggestions without changing visible cue text. Apply a downloaded review file only after a hash/fingerprint preflight:

```bash
npm run subtitle-finalize -- \
  --task "/path/to/task-output" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --resolutions "/path/to/human-review-resolutions.json" \
  --dry-run
```

Automatic, human, and mixed validation share `.final.*` and `subtitle-package.final.json`. The package remains compatible with the strict grammar-report v1 input contract; finalization status, canonical/presentation decisions, quality-gate metrics, and correction feedback live in separate strict sidecars.

Reference-assisted mode keeps ASR generation blind and opens the reference only for post-generation evaluation:

```bash
npm run subtitle -- \
  --input "/path/to/video.mkv" \
  --dialogue-language ja \
  --reference-subtitle "/path/reference.en.srt" \
  --reference-language en \
  --guidance-mode reference-assisted
```

See [the Skill specification](.agents/skills/multilingual-video-subtitler/SKILL.md) for source priority, adaptive Whisper/Core ML behavior, VAD/no-VAD refinement, reference isolation, Japanese integrity repair, subtitle formatting, and artifact validation.

## Repository contents

- `.agents/skills/multilingual-video-subtitler/` — Skill instructions, adapter references, and wrapper
- `apps/` — command-line entry point and workspace application code
- `packages/` — media, search, transcription, subtitle, and shared runtime packages
- `schemas/` — generated JSON Schemas for workflow artifacts
- `scripts/` — schema generation and maintenance utilities

Generated `output/`, transcription caches, media, GGML/Core ML models, dependencies, build products, tests, benchmark results, development reports, and packaged ZIP files are intentionally not included in this repository.

## Validation

C6.0.1.14 completion uses `replay:c6-0-1-14-final` with a frozen run-paths file, existing probes/cache, existing probe-audio directories, and `--stage final-a` or `final-b`. This entrypoint is read-only for probe evidence and has no ASR execution fallback. It independently materializes local Review WAVs and freezes the A0–A8 coverage projections. `evaluate:c6-0-1-14-playback` requires both freezes and successful code-validation logs before it can open Gold. See [the completion workflow](.agents/skills/multilingual-video-subtitler/references/missing-dialogue-playback-integrity.md) for exact evidence boundaries. Canonical subtitles remain `needs-review`; ranker readiness and machine-only release are separate decisions.

The [C6.0.1.14 completion report](C6_0_1_14_MISSING_LOCALIZATION_PLAYBACK_INTEGRITY_REPORT.md) records engineering and evaluation-integrity PASS with 64/64 exact cache replay and zero new inference. Quality remains `HOLD_FOR_MACHINE_SPEECH_DETECTION_REPAIR`: Full Queue missing audible coverage is 3/6 and hallucination coverage is 1/1, despite complete delivery of all 292 known machine targets. This does not authorize C6.0.1.15 or a machine-only subtitle release.

C6.0.1.14.3 is the replay-only cross-stage monotonic selection route. It freezes C6.0.1.14.2 Phase A native cores as obligations, partitions oversized audit parents into source-grounded child units, bundles nearby children without counting gaps as speech, and solves the declared candidate universe under the 24-target, 60-second core, and 95%-episode playback limits. Exact cache misses, model execution, a lost Phase A sample, incomplete planner search, or a selected child without physical WAV and official playback all fail closed. Independent Final A/B and all A0–A7 physical projections are frozen before a durable Gold first-read receipt. See [the Skill reference](.agents/skills/multilingual-video-subtitler/references/cross-stage-monotonic-safety-planning.md) and [the acceptance report](C6_0_1_14_3_MONOTONIC_SAFETY_TARGET_PLANNER_REPORT.md). The authoritative acceptance route is `HOLD_FOR_EVALUATION_INTEGRITY_REPAIR`: machine monotonicity, planning, physical WAV, playback, budget, and parity gates passed, but stale row-level audio projection semantic hashes invalidated A4–A7 Gold recall. This route never changes canonical subtitles or lifts `needs-review` / `finalizationMethod: none`.

```bash
npm run typecheck
npm run lint
npm run build
npm run format:check
npm test
npm run test:e2e
```

## License

[MIT](LICENSE)
