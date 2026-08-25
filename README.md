# Multilingual Video Subtitler

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
