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
  --finalization review-fallback
```

If evidence is insufficient, `review-fallback` writes honest `.best-effort.*` files, a strict `subtitle-package.needs-review.json`, an offline review page, bounded local audio clips, and candidate suggestions without changing visible cue text. Apply a downloaded review file only after a hash/fingerprint preflight:

```bash
npm run subtitle-finalize -- \
  --task "/path/to/task-output" \
  --human-reviewed-subtitle "/path/to/human-reviewed.ass" \
  --resolutions "/path/to/human-review-resolutions.json" \
  --dry-run
```

Automatic, human, and mixed validation share `.final.*` and `subtitle-package.final.json`. The package remains compatible with the strict grammar-report v1 input contract; finalization status, decisions, quality-gate metrics, and correction feedback live in separate strict sidecars.

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
