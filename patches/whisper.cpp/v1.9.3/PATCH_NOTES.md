# MVL whisper.cpp v1.9.3 evidence serializer patch

This patch is based on the official `ggml-org/whisper.cpp` v1.9.3 release commit recorded in `upstream-manifest.json`. It changes only `examples/server/server.cpp`.

The patch adds:

- `mvl_verbose_json_v1`, a versioned response that preserves individual raw token timing and calls `whisper_full_get_token_t0()` / `whisper_full_get_token_t1()` for mapped timing;
- lowercase hexadecimal UTF-8 bytes for individual tokens and grouped words, allowing split multibyte fragments to remain lossless and membership to be verified without trusting JSON replacement characters;
- raw internal VAD intervals from `whisper_full_n_vad_segments()` and the official VAD segment getters;
- `GET /mvl/capabilities`, used by the client before accepting the runtime;
- explicit coordinate-system and getter-use evidence without returning model, audio, VAD-model, or temporary absolute paths.

It does not change model loading, decoding parameters, VAD processing, token generation, or whisper.cpp core. The build script injects the patch file SHA-256 into the patched binary through `MVL_PATCH_SHA256`; an unconfigured manual build deliberately reports `build-manifest-required` and will fail the strict client handshake.

## C5.16.1 request-state isolation patch

`0002-mvl-request-state-reset.patch` leaves `0001` unchanged and adds a fresh
`whisper_state` for every `mvl_verbose_json_v1` request while retaining the
loaded model context. It also routes the existing VAD preprocessing and all
mapped-token/raw-VAD getters through that explicit state. The two corrected
`ctx->state->vad_segments` assignments are state-ownership fixes; the patch
does not alter decoding parameters, VAD thresholds, VAD segmentation logic, or
model inference math.

The capability endpoint and each MVL response declare
`fresh-whisper-state-per-mvl-request`. Clients fail closed unless that value,
the pinned patch-series SHA-256, and the binary SHA-256 all match the runtime
manifest. The manifest records each patch hash and a SHA-256 over the ordered
concatenation of both patch files.

The complete upstream source, build directories, binaries, models, WAV files, and ASR caches are intentionally not vendored in this repository. See the upstream project for its license and source.
