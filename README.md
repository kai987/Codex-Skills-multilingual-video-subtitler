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
  --transcription-provider auto
```

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
```

## License

[MIT](LICENSE)
