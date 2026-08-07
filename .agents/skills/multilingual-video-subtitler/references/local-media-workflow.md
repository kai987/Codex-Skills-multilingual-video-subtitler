# Local media workflow reference

## Contents

- Supported containers
- Transport streams
- Stream selection
- Embedded subtitles
- Online search and scoring
- Audio transcription and burn-in
- Output and privacy rules

## Supported containers

Accept `.mp4`, `.mkv`, `.mov`, `.webm`, `.ts`, and `.m2ts` only after ffprobe confirms a readable container with at least one video stream. Do not treat an extension as proof that a file is valid.

## Transport streams

Inspect format, programs, streams, duration, start time, codecs, and language tags. Scan packets with FFmpeg at warning level. Record multiple programs, missing language tags, non-zero starts, timestamp-order warnings, and corrupt packet warnings.

Use direct processing when FFmpeg reads the stream without timestamp-order warnings. In `auto` mode, remux to task-local `temp/temporary-normalized.mkv` only after explicit timestamp discontinuity or non-monotonic DTS evidence. Use `-fflags +genpts`, `-map 0`, and `-c copy`. Never alter the `.ts` or `.m2ts` source.

## Stream selection

Interpret track numbers as global ffprobe stream indexes.

- Honor an explicitly selected stream.
- Select the only text subtitle automatically.
- Prefer exactly one subtitle matching a confirmed primary language.
- Prefer exactly one default subtitle among otherwise equivalent candidates.
- Stop with `USER_ACTION_REQUIRED` and list candidates when ambiguity remains.
- Never treat PGS, VobSub, DVB, or XSUB bitmap subtitles as extracted text.

## Embedded subtitles

Convert the selected text stream to temporary UTF-8 SRT with FFmpeg. Parse every cue, remove subtitle styling markup, preserve speaker labels where detectable, detect cue language, normalize ordering, and record every text or timing change in the local manifest. Generate all requested formats from the same normalized cue list.

## Online search and scoring

Run only API or public-page `SubtitleSearchAdapter` implementations enabled by the caller. Prefer configured OpenSubtitles/ASSRT JSON APIs. When credentials are absent, allow a bounded public-page fallback only where robots/access controls permit it; never bypass login, CAPTCHA, Cloudflare, or blocked download paths. Score candidates out of 100 using title (20), season/episode (25), year (5), runtime (20), release source/group (10), first/last cue boundaries (5), sampled dialogue similarity (10), and file integrity (5). Use configurable thresholds: primary `>=90`, needs-review `75–89`, reference `60–74`, rejected `<60`. An integrity-valid original-language `needs-review` candidate may be emitted before transcription but cannot be burned until validated. A translation or machine translation can never become the primary original-language subtitle, regardless of score. Contain individual source failures and fall back to local transcription.

## Audio transcription and burn-in

Extract the selected global audio stream as mono 16 kHz audio, detect silence, and emit each transcription chunk as mono 16 kHz 16-bit PCM WAV for local/cloud adapter compatibility. Select nearby split points around the target chunk duration. Record every relative chunk path, global start/end, duration, and SHA-256 in `audio-manifest.json`. Cache successful results and add chunk offsets back to every model segment. Prompt the model to transcribe only audible speech, preserve the original language and code-switching, and never translate or invent silence.

Honor any user-selected transcription adapter first. Otherwise select a configured local `whisper.cpp` adapter before considering OpenAI. For local execution, profile the device/media and use the adaptive planner linked from `SKILL.md`; explicit model paths still constrain discovery. Complete baseline quality evaluation and any targeted raw-ASR refinement before subtitle presentation normalization. Local transcription uses SRT segment timestamps. Use `gpt-4o-transcribe` for high-quality cloud text with chunk-level timing or `whisper-1` with `verbose_json` when cloud segment timing is explicitly requested. Burn subtitles only to a new task-local MKV and only after confirming the FFmpeg `subtitles` filter exists.

## Output and privacy rules

Write shareable JSON with file names and relative artifact paths. Put primary subtitle formats plus `source-info.json`, `media-identity.json`, `subtitle-search-results.json`, `processing-manifest.json`, `subtitle-package.json`, and applicable `transcription-refinement.json`/`transcription-corrections.json` records together in `subtitle-<original-video-stem>/`, using the same stem for `.srt`, `.vtt`, and `.ass`. Keep `audio/`, `temp/`, and `video/` at the task root. The task-root name may remain timestamped/collision-safe; only the subtitle child directory and primary subtitle basenames are fixed. Store the absolute selected source path only in `processing-manifest.json`. Use atomic replacement for JSON/text outputs and refuse collisions by default. Do not place API keys, authorization headers, external subtitle downloads, generated video, or audio chunks in Git.
