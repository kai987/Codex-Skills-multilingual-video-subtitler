# Standalone Subtitle Tool — Bounded Long-form ASR A/B

Opt-in experiment, not a new product version or default strategy. The existing
generate/resume/recover/validate-edited paths and protected release rules are unchanged.
No reference discovery, Gold import, cloud fallback, alignment, speaker processing,
G11 or automatic parameter search occurs here.

## Commands

Use the locked Node 24 / npm 11 environment. Install locked dependencies with
`npm ci`, then `npm run build:subtitle-tool`.

```sh
npm run experiment:subtitle-tool:bounded-asr-ab -- plan \
  --input /path/source.mkv --baseline-task /path/old-task \
  --baseline-plan /path/acceptance-plan.local-only.json \
  --base-sha 0581c386cd316343c304999386ea4216397d37fa \
  --vad-model /path/ggml-silero-v6.2.0.bin \
  --vad-library /path/libwhisper.dylib --python /path/python3 \
  --output-root /path/experiment-output

npm run experiment:subtitle-tool:bounded-asr-ab -- run \
  --manifest /path/new-run/experiment.json --execute-b

npm run experiment:subtitle-tool:bounded-asr-ab -- report \
  --manifest /path/new-run/experiment.json --export-partial
```

`plan --dry-run` and help do not load models. `plan` performs live identity checks
and **one real Silero pass**, not zero inference. It creates a collision-safe directory,
persists `pre-vad-freeze.json` and a reservation before Silero, then freezes chunks,
individual PCM hashes, decoder defaults, code identities and review locations.
No automatic download or environment upgrade is performed. The existing VAD-only
C API adapter is reused; none of its old research orchestration is invoked.

A's complete raw SRT is copied with task/audio/media/model/runtime/hash bindings.
Its historical argv was not separately saved: effective settings are reconstructed
from the saved task, frozen product adapter and same binary's matching saved help.
This provenance is explicit, not a claim to possess a missing historical argv log.
Absent/mismatched baseline evidence blocks before B. The runner does not manufacture
an A rerun or substitute its legal partial subset.

## Fixed policy

PCM16 mono 16 kHz from the verified historical request is reused. No media re-extraction
is necessary or automatic. Integer half-open sample indexes are authoritative.
The preferred core is 25 seconds; a nearby eligible silence midpoint is preferred
within 20–29.4 seconds. Otherwise use a recorded hard cut. First/last short cores
are retained. Context is at most 300 ms per side, with each request at most 30 seconds.
Core coverage is continuous, disjoint and complete, including silence and music.

Silero threshold is 0.5. All 512-sample posterior frames are retained. Cut candidates
use at least 100 ms of consecutive below-threshold frames; segment filtering does not
remove audio. Reused adapter settings: CPU, four threads, min speech 250 ms,
min silence 100 ms, max speech 9000 seconds, no segment padding or overlap.
These are initial experimental settings, not validated optima. Raw VAD segments
remain diagnostic centiseconds; cut planning uses the explicit sample-frame grid.

Whisper uses the same model and executable identities as A, language/threads from
the saved task, `--suppress-nst`, `--no-prints`, segment SRT, empty prompt, internal
VAD off, Core ML off. The adapter's model symlink hides adjacent Core ML encoders.
Every chunk uses a separate CLI process. No prior text, tokens or decoder context
crosses requests; no unsupported `--no-context` flag is invented. Internal decoder
defaults remain the same hashed binary defaults. Dynamic library historical hashes
are unavailable and are explicitly a comparison limitation.

Boundary aliasing is restricted to adjacent overlapping inputs and intersecting
global-time records with exact visible text (whitespace-only normalization), unique
pairing and more than eight codepoints. Prefer a center in its owning core, then
farther from the input edge. Short answers, ties, conflicting or partial text stay
as `BOUNDARY_AMBIGUITY`. This is a machine rule, not acoustic confirmation. Every
alias retains its original record and points to the retained record. No arbitrary
whole-file deduplication, substring trimming or time repair is allowed.

## Budget, interruption and evidence

A new requests = 0. Frozen B has N requests (N <= 64), total planned audio <= 1.10x
the complete PCM. Actual requests <= N+1 and <=65; total requested audio <= planned+30s.
Only one global technical-failure retry is allowed, with identical parameters.
Successful bad timing, repetition, blank response or suspected incorrect text never
permits a retry. Dispatch reservations are hash-chained and fsynced before spawn.
Process logs/raw responses stay local; progress reports only chunk counts.

Repeat `run` verifies identities and reuses successful hashed raw responses. A corrupt
checkpoint, partial journal, unresolved crashed reservation or changed code/policy
fails closed. It does not clear the budget. SIGINT/SIGTERM terminate only the owned
child. A SIGKILL/power-loss lock must be inspected by the operator; this experiment
has no automatic lock-stealing or in-place VAD retry. Preserve failed directories.
If VAD failed or its transport was lost, do not call plan repeatedly to hide the
attempt; inspect the reservation/logs and obtain a new scoped execution decision.

`report` is offline and does not follow historical media/model paths. Raw local times
are checked before offset mapping, with no clamp. All records partition into retained,
alias or unresolved. Full raw text is distinct from assembled text. Format quantization
uses the same primary-minimal centisecond precision and shared parsers/formatters;
all three files are staged and disk-reparsed before directory commit. Nonpositive,
reversed, negative, out-of-window, unparsed and collapsed intervals remain unresolved.
Partial files require explicit `--export-partial`. Missing/failed chunks mean incomplete
B, never a full result. Parseable output remains `needs-review`, `finalizationMethod=none`,
`humanValidated=false`, `machineOnlyReleaseAuthorized=false`.

## Evaluation and tests

The frozen plan includes 12 uniform 15-second strata and every cut-point neighborhood.
`manual-review.csv` records NOT_PERFORMED until a real reviewer checks them. No full
authorized same-range reference has been supplied to this entry; CER/deletion/hallucination
rates are NOT_MEASURED. Repetition and input coverage are proxies, not proof of lexical
accuracy. A's wall time is historical and cannot support a stable speedup claim.

```sh
npx vitest run tests/bounded-longform.test.ts tests/subtitle-tool.test.ts \
  tests/subtitle-recovery.test.ts tests/e2e/subtitle-tool.test.ts \
  tests/e2e/subtitle-recovery.test.ts --maxWorkers=2
npm run test:bounded-asr-ab:e2e
npm run typecheck
npm run lint
npm run format:check
npm run build:subtitle-tool
```

Synthetic tests never count as the real B. Experiment JSON has a strict published
schema and runtime hash/coverage/budget checks. Output indexes, logs, raw dialogue and
PCM are private local evidence, excluded from Git. Only source, tests and sanitized
reports belong on the new experiment branch; no release, tag, default merge or package
replacement is authorized by this experiment.
