# C6.0.1.18.2 isolated native observation

This is a macOS arm64 diagnostic patch, not an ASR replacement or production
runtime. It does not register a new provider or change any default profile.
The exact upstream commit, patch digest, compiler, options, dependency archives
and hashes are in `build-manifest.json`. Upstream source is not vendored.

Apply `native-trace.patch` to a separate checkout of sherpa-onnx commit
`1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911` (v1.13.6). Use CMake Release,
Python bindings on, Python 3.13 executable/include/library explicitly pinned,
and the options in the manifest. Build only `_sherpa_onnx`, with two jobs.
Do not run `cmake --install` against a global or existing Python environment.
The build uses the pinned upstream dependency manifests and verified archives;
do not substitute newer versions. CommonCrypto SHA-256 makes this patch
platform-specific.

Stage the original Python package's `.py` files with the new native extension
and its pinned ORT dylib in a new isolated directory. B and T must use that
same directory and byte-identical files. Select it only in child-process
`PYTHONPATH`; do not modify the original site-packages. Native module identity
is checked before recognizer creation. Dynamic library inspection should use
the platform loader APIs: `DYLD_PRINT_LIBRARIES` did not survive the sandbox
launcher in this experiment.

The native patch observes existing buffers/variables at waveform acceptance,
the existing GetFrames return, existing encoder calls, packed greedy decoding,
the existing argmax/append branch, actual context-update return, context
removal, and final SetResult. It adds no inference or stateful getter calls.
Each request has a 4,096-event buffer. Overflow, missing end, or failed flush
is not a complete trace. No tensor payload is exported, only hashes,
dimensions, descriptive statistics and existing token decisions.

The coordinator requires a collision-safe local output directory containing
the selection, model/runtime identity, build identity and zeroed ledger.
These private input records follow the fields consumed by `scripts/run-c601182.mjs`.
Run the worker's `--preflight` first: it imports the native module and exercises
only a neutral native trace buffer, without a recognizer or model.
Then, after offline tests and explicit bounded authorization:

```sh
node scripts/run-c601182.mjs "$RUN_ROOT" freeze
node scripts/run-c601182.mjs "$RUN_ROOT" execute
node scripts/analyze-c601182.mjs "$RUN_ROOT"
node scripts/analyze-c601182.mjs "$RUN_ROOT"
```

`RUN_ROOT` must name that prepared local directory. These commands are not a
request to repeat the completed experiment. Execution is single-use and fails
closed on previous attempts, changed identities, successful-output retries,
budget violations or worker failure. A failed execution requires explicit
reconciliation; there is deliberately no automatic retry command. Analysis
checks the result freeze and must produce byte-identical summaries on replay.

The model processes deny network access and deny home-directory content reads
except the fixed runtime, model and selected audio directories. Full responses,
native traces, runtime paths, audio, models and build binaries stay local.
The postflight import inspection is not a record of the already-exited model
processes. This distinction and the remaining diagnostic limits are in the report.
