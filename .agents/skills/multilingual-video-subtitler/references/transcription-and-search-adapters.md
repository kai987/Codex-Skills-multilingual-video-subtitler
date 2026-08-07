# Transcription and search adapters

## Adapter precedence

Apply this order only when transcription is needed:

1. An adapter explicitly named by the user or injected by the caller.
2. In `auto`, a configured local `whisper.cpp` executable and GGML model.
3. In `auto`, OpenAI only when local resolution fails and `OPENAI_API_KEY` is configured.

An explicit `whisper-cpp` selection must fail with `MISSING_DEPENDENCY` when local configuration is incomplete. For a missing explicitly requested official model, run acquisition preflight first: only when network use is permitted and the user has authorized or requested installation, check disk space, download with resume support, and verify the published checksum. If acquisition is not permitted, fails, or the model is still absent when adapter resolution begins, fail with `MISSING_DEPENDENCY` regardless of whether the provider was explicitly set; never replace that model silently. An explicit `openai` selection must not use a local model. `--timestamp-strategy` and an explicit local model path override automatic defaults.

## Local whisper.cpp configuration

Discover `whisper-cli` from `--whisper-cpp-path`, `WHISPER_CPP_PATH`, or `PATH`. Discover models from `--local-transcription-model`, `WHISPER_MODEL_PATH`, `--local-transcription-model-directory`, `WHISPER_MODEL_DIRECTORY`, `models/whisper/`, then `~/.cache/whisper.cpp/`.

When `ggml-silero-v6.2.0.bin` is beside the transcription model or in `~/.cache/whisper.cpp/`, enable whisper.cpp VAD and non-speech-token suppression automatically. `WHISPER_VAD_MODEL_PATH` or `--whisper-vad-model` can select an explicit VAD model. Pass only confirmed names—not instruction prose or prior transcripts—as the Whisper initial prompt, because Whisper treats that value as preceding text rather than an instruction.

Use the sensitive dialogue VAD profile (`0.35` threshold, 100 ms minimum speech, 150 ms minimum silence, 250 ms speech padding, and 0.25 s overlap) so quiet dialogue under music is less likely to be discarded. Cache this profile separately from older/default-VAD results. If the opening still has gaps, compare a short opening-only diagnostic without VAD. When that diagnostic recovers real dialogue, replace only the affected interval with the no-VAD result and keep the stable VAD pass elsewhere. Do not apply no-VAD globally when quiet later chunks echo the initial prompt or hallucinate speech. For every hybrid result, write and schema-validate `subtitle-<stem>/transcription-refinement.json`; its fixed record contains the base VAD pass, no-VAD replacement purposes and intervals, model, corrections record, music interval, and thought interval.

Use the adaptive planner described in [adaptive-transcription.md](adaptive-transcription.md) instead of choosing from memory and duration alone. Use at most eight logical CPU threads and leave two logical cores free. Record the selected adapter, strategy, capability, model, Core ML state, timestamp strategy, measured/estimated runtime, and rationale without recording credentials.

An explicit user model always overrides these recommendations. When an explicitly requested official GGML model is absent, check free disk space, download it from the official whisper.cpp model repository with resume support, verify its published checksum, and retain it in the local model cache. The full `ggml-large-v3.bin` is accuracy-oriented and needs about 3.1 GB on disk plus substantially more working memory than its quantized counterpart.

## OpenSubtitles

Use `https://api.opensubtitles.com/api/v1`, not the legacy `.org` HTML search page. Configure:

- `OPENSUBTITLES_API_KEY` (required)
- `OPENSUBTITLES_USER_AGENT` (recommended application identity)
- `OPENSUBTITLES_BEARER_TOKEN` (optional authenticated quota)

Send the API key and bearer token only in headers. Limit downloads per search, validate returned download hosts, accept only HTTPS, and never persist temporary download URLs or authorization values.

When no OpenSubtitles API key exists, a future/public-page lookup may be attempted only where automated access and download are permitted. Do not solve or bypass Cloudflare challenges, logins, CAPTCHA, or robots exclusions. The current `.com` pages present Cloudflare challenges to non-browser requests and the legacy `.org` robots rules exclude automated download paths, so record the unavailable web source and continue to another provider or local transcription.

## ASSRT

Use `https://api.assrt.net/v1/sub/search` and `/v1/sub/detail`. Configure:

- `ASSRT_TOKEN` (required personal API token)
- `ASSRT_USER_AGENT` (optional application identity)

Send the token as `Authorization: Bearer …`, never in a query string. Keep requests under the documented shared token/IP rate limit. Detail download links are temporary: download immediately, validate the ASSRT host, and persist only the subtitle, stable source attribution, and scoring evidence. Keep ASSRT attribution required by its personal-use API terms.

Without `ASSRT_TOKEN`, enable the `ASSRT public web` adapter by default. Search only public result/detail pages, wait between requests, inspect at most a small bounded result set, and follow at most three HTTPS redirects restricted to `assrt.net` hosts. Accept direct SRT/VTT/ASS/SSA files and bounded ZIP/RAR archives; extract in memory, reject encrypted/oversized/unsupported archives, prefer the requested episode and language, and validate the selected subtitle parser before scoring. Do not access account pages or bypass CAPTCHA. Set `SUBTITLE_WEB_FALLBACK=0` or pass `--no-web-subtitle-fallback` to disable this behavior.

Use this lookup order per provider: configured official API, otherwise permitted public web fallback. Continue to local offline transcription only when no integrity-valid original-language API/web subtitle is available. A `needs-review` original subtitle may be emitted instead of transcribing, but it must not be burned until validated.
