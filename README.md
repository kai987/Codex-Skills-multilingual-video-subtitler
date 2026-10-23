# Multilingual Video Subtitler

English | [日本語](README.ja.md)

A local-first subtitle toolkit and Codex Skill for Chinese, Japanese, and English media. Generate editable machine drafts with local Whisper, export SRT/ASS/VTT, and retain evidence for timing checks and human review.

> **Development status:** this is a development/candidate project, not an accuracy-certified release. Generated subtitles require review; successful export does not mean the dialogue or timing is correct.

## Find the source code

The default `main` branch now includes the current core runtime, Codex Skill, schemas, and tests alongside this overview and the Japanese README. Generated outputs, model weights, caches, and machine-specific experiment plans are excluded.

Use `main` for the standalone CLI and the [current usage guide](STANDALONE_SUBTITLE_TOOL_V1.md). Historical development branches retain their own experiments and acceptance reports; they are not interchangeable releases. The core integration preserves the latest local bounded-generation, content-recovery, and seam-refinement modules without including private run data.

## What it does

- Transcribes local video/audio using `whisper.cpp` and a user-configured model.
- Exports editable SRT, ASS, and WebVTT machine drafts from shared evidence.
- Preserves raw responses, input/model identities, task checkpoints, and output indexes.
- Provides dependency checks, task status/resume, offline recovery, and validation of explicitly edited subtitle copies.
- Includes separate advanced workflows for subtitle extraction/search, reference-assisted evaluation, alignment evidence, and human-reviewed finalization. See the source branch documentation before using them.

The standalone CLI does **not** automatically translate, download models, search for reference subtitles, or fall back to a cloud provider. Experimental and reference-assisted workflows must not be confused with independent machine generation.

## Requirements

- Node.js `>=24 <25`.
- npm `11.x` for the standalone CLI; the repository pins `npm@11.18.0`.
- FFmpeg and ffprobe.
- A local `whisper-cli` executable and a compatible whisper.cpp GGML model.

Install the external tools and model separately. They are not bundled with this repository.

## Quick start

Clone the `main` branch:

```bash
git clone --single-branch \
  --branch main \
  https://github.com/kai987/Codex-Skills-multilingual-video-subtitler.git \
  multilingual-video-subtitler
cd multilingual-video-subtitler
npm ci
npm run build:subtitle-tool
```

Configure local paths and check dependencies:

```bash
npm run subtitle-tool -- configure \
  --model "/path/to/ggml-model.bin" \
  --runtime "/path/to/whisper-cli" \
  --language ja

npm run subtitle-tool -- doctor --input "/path/to/video.mkv"
```

`configure` and `doctor` do not load a model or run recognition. Replace all example paths with your own files; language options are `ja`, `en`, and `zh`.

Generate a draft and inspect its task:

```bash
npm run subtitle-tool -- generate \
  --input "/path/to/video.mkv" \
  --output-root "/path/to/subtitles"

npm run subtitle-tool -- status --task "/path/to/subtitles/subtitle-XXXXXX"
```

Use the actual task directory printed by `generate`. Audio files use the same entry point. For multiple audio streams, select the **container-global stream index** with `--audio-track N`; `doctor` lists the available streams.

## Outputs, review, and recovery

Each generation creates a separate task directory. Open its `OUTPUT_INDEX.md` to find the machine-draft subtitle files and saved evidence. Keep the raw files intact and save manual edits as separate copies.

Execution status, artifact integrity, and subtitle quality are separate. A task can be `completed` with integrity `passed` while quality remains `needs-review`, `humanValidated=false`, and `finalizationMethod=none`.

For a saved successful response with invalid timing, recover the full transcript without new ASR:

```bash
npm run subtitle-tool -- recover --task "/path/to/task"

# Explicitly export only the valid, incomplete subtitle subset.
npm run subtitle-tool -- recover --task "/path/to/task" --export-partial

# Check an edited copy whose times are already in source-media coordinates.
npm run subtitle-tool -- validate-edited \
  --task "/path/to/task" \
  --input "/path/to/edited.srt" \
  --timebase source
```

Partial export is not a complete subtitle delivery. Format/text-accounting checks do not certify acoustic correctness. Repeated or hallucinated text, missed speech, dialect errors, and uncertain boundaries still need source-audio review. Local logs and manifests may contain private absolute paths; inspect them before sharing.

## Documentation and development

- [日本語 README](README.ja.md)
- [Standalone installation, usage, and recovery guide](STANDALONE_SUBTITLE_TOOL_V1.md)
- [Advanced workflows](.agents/skills/multilingual-video-subtitler/references/research-workflows.md)
- [Codex Skill instructions](.agents/skills/multilingual-video-subtitler/SKILL.md)
- [Development branches](https://github.com/kai987/Codex-Skills-multilingual-video-subtitler/branches)

The source uses TypeScript/Node.js workspaces, with application entry points in `apps/`, runtime packages in `packages/`, schemas in `schemas/`, and command helpers in `scripts/`. Media, models, caches, generated `output/`, and personal review files are not prerequisites for reading or building the source and should not be committed as documentation assets.

Historical research tests additionally use Python with NumPy/SciPy for model-free numerical checks. Real-model and personal-artifact integration checks require explicit opt-in; these dependencies and private fixtures are not bundled.

### Continuous integration

[Offline CI](.github/workflows/offline-ci.yml) runs on pushes to `main`, pull requests targeting `main`, and manual dispatch. It typechecks, builds, runs unit/mock end-to-end tests, and checks bounded-generation regressions on macOS so the existing sandbox-isolation tests remain active.

Preparation installs Node/npm dependencies, NumPy/SciPy, and FFmpeg if needed—not speech models or model frameworks. Typecheck, build, and bounded regressions run inside an OS sandbox that permits local mock servers but denies external IP connections. The complete test suite retains its own isolation tests without an incompatible outer sandbox. All test stages enable offline flags, disable real-model/private-artifact tests, and receive no provider credentials. CI rejects installed model frameworks and checks that its model cache stays empty; it never downloads or restores model weights/runtime caches.

## License

[MIT](LICENSE). External tools, model weights, reference subtitles, and media have their own licenses and usage conditions.
