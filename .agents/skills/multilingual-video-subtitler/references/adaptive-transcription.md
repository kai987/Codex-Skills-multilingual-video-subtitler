# Adaptive local transcription

## Contents

- Execution order
- Device and model profiling
- Core ML probe
- Benchmark cache
- Media profile
- Scene-aware acoustic analysis and routing
- Planner strategies
- Quality evaluation
- Hypothesis validity
- Targeted refinement
- Asymmetric arbitration
- Local consensus and human review
- Refinement interval limits
- Final-state finding lifecycle
- Canonical ASR segmentation
- Missing-dialogue targeted recovery
- Event-level review grouping
- Cache identity
- Artifacts and reporting
- Fallbacks and errors

## Execution order

Run adaptive planning only when source-priority evaluation did not produce a
reliable original-language subtitle and the selected provider is
`whisper-cpp` or `auto` with a usable local installation.

Keep this order:

```text
media/device profile
→ acoustic scene window analysis and temporal smoothing
→ scene ASR routing plan (observe or additive route)
→ raw baseline ASR
→ canonical ASR segmentation
→ multi-signal quality evaluation
→ targeted no-VAD comparison for suspicious intervals
→ targeted high-quality refinement
→ preliminary final-state review queue
→ missing-dialogue targeted recovery
→ song-region detection and prompt-free multi-window lyrics transcription
→ final canonical transcript and final-state QA
→ trusted reference-original lyrics resolution
→ candidate evidence and competing-hypothesis resolution
→ Japanese text analysis and acoustic-semantic cue segmentation
→ cross-cue lyrics validation and final text integrity
→ presentation line layout without temporal splitting
→ final cross-cue repetition and vocal-coverage integrity gate
→ event-level review grouping
→ presentation contract
→ post-presentation timing QA
→ SRT/VTT/ASS
```

Never refine already line-wrapped or punctuation-normalized presentation
text.

## Device and model profiling

Generate `device-profile.json` from measured host state. Record platform,
architecture, Apple Silicon, total/available memory, logical/physical cores,
FFmpeg/ffprobe, whisper.cpp path/version, reported Metal/Core ML build flags,
and discovered model capabilities.

Discover `whisper-cli` through the explicit CLI path,
`WHISPER_CPP_PATH`, then `PATH`. Discover models through an explicit file or
directory, `WHISPER_MODEL_PATH`, `WHISPER_MODEL_DIR`, the legacy
`WHISPER_MODEL_DIRECTORY`, `models/whisper/`, and
`~/.cache/whisper.cpp/`.

Represent each runnable model configuration as a capability. Do not encode
product modes as A/B/C conditionals. Record family, quantization, quality
tier, model SHA-256, estimated memory, explicit `cpu`/`coreml` runtime,
Core ML state, and supported roles. A failed Core ML diagnostic capability
must never be reinterpreted as a CPU capability.

Treat these current capabilities as ordinary data:

- compatibility quality: `large-v3`, Core ML off;
- preferred quality: `large-v3` with its validated Core ML encoder;
- fast baseline: `large-v3-turbo` with its validated Core ML encoder.

Keep quantized or future model families pluggable.

## Core ML probe

Do not infer Core ML from `darwin` and `arm64` alone. Distinguish:

- `unsupported-platform`;
- `not-compiled`;
- `encoder-missing`;
- `encoder-mismatch`;
- `load-failed`;
- `available`;
- `disabled-by-user`.

For every model/runtime report, preserve `status`, `deviceCapable`,
`whisperCppCompiledWithCoreML`, `encoderAvailable`, and
`runtimeValidated`. An encoder bundle can exist while the configured
whisper.cpp still reports `COREML = 0`; in that case the state is
`not-compiled`, not `available`.

Require whisper.cpp to report `COREML = 1`. Derive the expected encoder from
the GGML family after removing quantization:

```text
ggml-large-v3[-q*].bin
↔ ggml-large-v3-encoder.mlmodelc/

ggml-large-v3-turbo[-q*].bin
↔ ggml-large-v3-turbo-encoder.mlmodelc/
```

Reject a differently named encoder. Probe the matching pair with a short
representative WAV and require a successful process plus Core ML load
evidence. Do not label an unexecuted pair `available`.

For a CPU compatibility pass, expose the GGML model through a task-local
model link without the encoder directory. whisper.cpp derives the Core ML
encoder path from the model path, so this prevents accidental Core ML use
without copying the large model.

When Core ML fails under `auto`, choose the compatible CPU capability and
record the reason in `transcription-plan.json` and
`processing-manifest.json`. Respect explicit `--coreml on` by failing rather
than silently disabling it. A not-compiled explicit request returns
`COREML_NOT_COMPILED` with rebuild, `--coreml auto`, and `--coreml off`
recovery choices. Core ML absence never changes the provider to OpenAI when
the same local GGML model is CPU-runnable.

Do not automatically compile or reinstall whisper.cpp. To enable Core ML
manually, follow the current upstream steps: create the matching encoder
with `./models/generate-coreml-model.sh <model-family>`, configure with
`cmake -B build -DWHISPER_COREML=1`, and build with
`cmake --build build -j --config Release`. Confirm both
`Core ML model loaded` and `COREML = 1` on representative audio before
marking the capability available.

## Benchmark cache

Use `--benchmark auto|force|off`; default to `auto`.

Extract a 30–60 second representative mono 16 kHz WAV, preferring a detected
speech interval. Measure:

```text
RTF = processingSeconds / audioSeconds
```

Cache the result under
`~/.cache/multilingual-video-subtitler/whisper-benchmark.json` and copy the
current record to the subtitle artifact directory. Reuse only when all of
these remain equal and the cache is not expired:

- device fingerprint;
- whisper.cpp version;
- model SHA-256;
- model family and capability ID;
- Core ML on/off;
- encoder path and encoder bundle fingerprint.

`force` always reruns. `off` emits a skipped benchmark artifact and lets the
planner use conservative family/Core ML defaults. Contain an individual
candidate failure and record it instead of discarding successful candidate
measurements.

## Media profile

Generate `media-profile.json` from existing ffprobe data and lightweight
FFmpeg silence detection. Record the selected audio track, sample rate,
channels, dialogue languages, speech intervals, speech duration/ratio,
long-silence ratio, a conservative music-heavy signal, and subtitle
availability.

Use:

```text
effectiveSpeechDuration = durationSeconds × speechRatio
```

Prefer measured speech intervals over the multiplication when available.
Treat music classification as a heuristic, not proof of content type.

## Scene-aware acoustic analysis and routing

Run scene analysis after `profileMedia()` and before baseline ASR. Extract one
task-local mono 8 kHz PCM analysis WAV; do not decode the media separately for
each window. Analyze the complete timeline with defaults of 3-second windows,
1-second hops, a 2-second minimum scene duration, a 0.75 confidence threshold,
and a reserved 0.97 non-speech skip threshold. The last short window must end
at the media duration.

The built-in classifier is local and heuristic. It combines RMS, approximate
SNR, spectral flatness, spectral flux, zero-crossing rate, silence ratio, and
the existing speech-activity intervals into probabilities for speech, vocal,
music, drums, crowd, overlap, and silence. Preserve these as evidence, not
calibrated accuracy. The classifier interface accepts a future local model,
but never downloads one or calls an online audio-classification service.

Classify windows as:

- `clean-dialogue`: strong speech/vocal, low event noise and low silence;
- `quiet-dialogue`: vocal/speech evidence at low RMS;
- `noisy-dialogue`: speech/vocal plus music, drums, crowd, or overlap;
- `singing`: strong vocal and music, with conservative positional support;
- `non-speech`: very low speech/vocal with silence or instrumental music;
- `unknown`: conflicting or insufficient evidence.

Keep `proposedLabel` as the initial per-window label and `smoothedLabel` as the
post-processing label. Apply one-window jitter absorption, hysteresis for
stable singing/noisy scenes, minimum-duration absorption, and explicit
protection that converts a short high-vocal window to `unknown` rather than
absorbing it into `non-speech`. Merge adjacent smoothed windows into scene
segments without overlapping scene intervals.

`--scene-analysis off` does not run the stage. `observe` is the default: it
writes recommendations but all `actualStrategy` values remain
`legacy-baseline`. `route` is additive:

- clean dialogue retains the existing VAD baseline;
- quiet dialogue adds bounded extra-sensitive VAD evidence;
- noisy dialogue adds bounded no-VAD evidence and requires consensus;
- singing enters prompt-free multi-window lyrics analysis;
- high-vocal unknown scenes receive conservative dual evidence only when the
  selected sensitivity permits it;
- non-speech remains observational and never skips the baseline in v1.

`--scene-routing conservative|balanced|aggressive` lowers the confidence
threshold by 0, 0.10, or 0.20. It does not alter hypothesis validity,
repetition QA, recovery budgets, or final integrity. Deduplicate scene-driven
requests against quality-driven requests by overlapping interval and profile.
Carry scene ID, label, confidence bucket, routing strategy, and analysis
version into refinement/recovery cache identity.

Write `acoustic-scene-windows.json`, `acoustic-scenes.json`, and
`asr-routing-plan.json`. The analysis cache key includes the extracted-audio
SHA-256, sample rate/channels, window/hop, classifier ID/version, thresholds,
analysis version, and schema version. A stage failure writes failed artifacts
where possible and falls back to the old ASR path; it must not fail the whole
subtitle run or silently enable route behavior.

After presentation, require every clean/quiet/noisy dialogue scene to have a
dialogue cue or active review, every singing scene to have a Music cue or
`missing-lyrics` review, and every high-vocal unknown scene to have a cue or
review. A contradictory high-confidence non-speech/high-vocal label is itself
a review finding. Scene evidence cannot close or delete existing vocal
evidence.

## Planner strategies

Expose `auto`, `quality`, `fast`, and `adaptive`.

- `quality`: prefer validated `large-v3 + Core ML`, otherwise compatible
  CPU `large-v3`. Do not select Turbo unless
  `--allow-quality-fallback` is explicit.
- `fast`: prefer `large-v3-turbo`; do not refine unless `--refine` is set.
- `adaptive`: run Turbo as the full baseline and full `large-v3` only on
  selected intervals. If the Core ML quality capability is unavailable, use
  CPU `large-v3` for refinement.
- `auto`: estimate full-quality runtime from effective speech duration and
  measured RTF. Select `quality` when it fits
  `--max-full-quality-runtime-seconds`; otherwise select `adaptive` when both
  model roles are available.

If Turbo is unavailable, adaptive falls back to one quality pass. If an
explicit quality request has no full-quality model, return
`QUALITY_MODEL_UNAVAILABLE` unless quality fallback was allowed.

Write the deterministic decision and every fallback to
`transcription-plan.json`.

## Quality evaluation

Generate `transcription-quality.json`. Classify every baseline segment as
`accepted`, `needs-refinement`, or `needs-human-review`.

Combine available decoder metrics with structural evidence:

- confidence, token probability, average log probability, entropy,
  no-speech probability, and decoder fallback;
- VAD speech with empty text;
- abnormal speech/text density;
- repetition and common hallucination shapes;
- language mismatch;
- invalid, overlapping, or unexplained timing;
- conflict with a validated original-language reference;
- adjacent continuity as an auxiliary signal only.
- normalized VAD/no-VAD hypothesis similarity, edit distance, length,
  language, start/end/duration differences, segment-count difference, timing,
  empty-side, and repetition disagreement;
- duration, visible-character CPS, speech coverage, leading/trailing silence,
  maximum internal silence, and presentation-timing provenance.

Use the centralized timing QA configuration. Defaults are 8 seconds for a
long-dialogue warning, 12 seconds for high risk, 5 visible characters for the
very-short-text rule, CPS below 1 for at least 5 seconds, 1.5 seconds for
leading/trailing silence, speech ratio below 0.30, VAD/no-VAD boundary
difference above 1.25 seconds, and a 0.2-second dialogue tail. Score timestamp
anomalies from 0 to 100: 0–29 pass, 30–59 suspicious, 60–79 automatic
refinement, and 80–100 mandatory repair or human review.

`vadNoVadConflict` requires refinement only when the selected mode permits
it and the current task budget remains. In `fast` without `--refine`, or in
a cache-only or explicitly zero-inference task, preserve the conflict for review without
fresh inference. The risk thresholds above do not override these execution
bounds or clear an unresolved quality concern. Surface-only changes
in spacing, punctuation, case, full-/half-width forms, or common Japanese
orthography do not create a strong conflict. Material wording differences
and a long one-sided transcript over detected speech do.

Do not flag colloquial speech, dialect, ellipsis, incomplete dialogue, or a
character voice merely because it is not formal grammar. Never use a
translated reference as target-language reconstruction text.

## Hypothesis validity

Evaluate VAD and no-VAD independently before treating their difference as a
conflict. Classify each hypothesis as `valid`, `weak`,
`invalid-hallucination`, `invalid-empty`, `invalid-timing`, or
`invalid-language`, and preserve the supporting signals and score.

Hard-reject a hypothesis when it exhibits unsupported exact-sentence loops,
extreme repetition, long repeated phrase loops, repeated consecutive
segments, prompt echo, empty text over strong detected speech, impossible
timing, or a clear target-language mismatch. Five or more unsupported
repetitions of the same sentence or long phrase are a hard hallucination
signal. A hard-rejected branch is not a candidate for consensus and is not
itself a reason to request human review.

Keep per-hypothesis repetition separate from cross-branch disagreement:

- `vadRepetition` describes only the VAD hypothesis;
- `noVadRepetition` describes only the no-VAD hypothesis;
- `repetitionConflict` is true only when the branches differ in repetition
  behavior.

Calculate `oneSideEmpty` after whitespace and punctuation normalization. It
is true only when exactly one displayed hypothesis is empty.

## Targeted refinement

Run baseline QA before creating no-VAD work. Do not create a complete no-VAD
baseline. Transcribe only suspicious merged intervals with no-VAD, retaining at
least five seconds of context on each available side, then compare the VAD and
no-VAD text and boundaries.

Expand each uncertain interval by
`--refinement-context-seconds` (default `5`) and align to nearby speech
boundaries when practical. Merge adjacent expanded work using
`--refinement-merge-gap-seconds` (default `1.5`).

Pass confirmed titles, names, proper nouns, and adjacent accepted
original-language speech as prompt context. Keep translated references out
of the target-text prompt.

Run at most `--max-refinement-rounds` (default `2`):

1. full `large-v3` with normal context and targeted token timestamps when
   whisper.cpp reports full-JSON support;
2. full `large-v3` with wider context when the models materially disagree.

Token timestamps are experimental evidence, not sole truth. Cross-check their
range against the segment and speech/silence boundaries. Record whether the
runtime exposed them, whether they were requested, and whether they were used.
Missing support or malformed token data falls back to segment/acoustic timing
without failing the task.

Never loop until “perfect.” Never run a full second pass after Turbo unless
`--full-second-pass` was explicitly supplied.

Use `--whisper-execution-mode auto|persistent|batch|process` to select the
whisper.cpp execution topology. `auto` prefers the v1.9.1
`whisper-server` example found beside `whisper-cli`, reuses one loaded model
for compatible requests, and falls back to the established process adapter
when the server is unavailable. Explicit `persistent` fails clearly rather
than silently falling back. `batch` uses the same server transport with a
finite task-lifecycle pool; `process` retains one process/model load per
request.

Build a worker key from model hash, Core ML state, whisper.cpp version,
language, VAD model/profile, timestamp capability, prompt constraints, and
thread count. v1.9.1 accepts VAD and token-timestamp options per inference,
so compatible VAD/no-VAD requests may share one server while preserving
request-local settings. Cache hits never reach the worker. Initialize and
Core ML-warm each worker once, retry an isolated failed request once, preserve
completed cache outputs, and use process fallback only when the requested
mode permits it. Record topology and load/decode costs separately from the
Core ML backend in `whisper-execution-metrics.json`.

## Refinement interval limits

Limit an ordinary merged refinement call to
`--max-merged-refinement-seconds` (default `30`, hard maximum `45`). Split
long ranges before inference, preferring:

1. detected silence midpoints;
2. speech-island boundaries;
3. accepted cue boundaries;
4. an even bounded split only when no acoustic boundary is available.

Merge only adjacent pieces with compatible acoustic context. Do not combine
unrelated scenes merely to reduce model loads. The hard limit also applies to
later refinement rounds unless the user explicitly requests
`--full-second-pass`.

## Asymmetric arbitration

Arbitrate after validity filtering instead of treating every VAD/no-VAD
difference as a symmetric three-way conflict:

- valid VAD + invalid no-VAD: select VAD automatically;
- invalid VAD + valid no-VAD: select no-VAD automatically;
- invalid VAD + invalid no-VAD: use a valid local `large-v3` refinement, or
  request human review when no valid candidate remains;
- valid VAD + valid no-VAD: use local refinement consensus; request human
  review only when a material conflict remains unresolved.

There is no global VAD or no-VAD priority. A no-VAD tie-break bonus may be
used only when speech evidence is strong, both hypotheses are valid, their
quality scores are close, the difference is minor, and no noise or hard
failure signal is present. The default bonus is `0.04` and the maximum is
`0.05`.

Record the selected hypothesis, rejected hypotheses and reasons, quality
scores, conflict codes, and resolution status. Use
`accepted-after-refinement` when a refinement round supplied the evidence
for an automatic decision.

## Local consensus and human review

Compare refinement output only with the hypothesis text and timed segments
over the same local interval. Do not compare a 30-second refinement window
against an aggregated baseline from several minutes. Stable consensus uses
normalized text agreement, timing overlap, acoustic support, language,
model/decoder quality, and any reliable original-language reference.
Grammar naturalness alone is never evidence because dialogue may be
colloquial, elliptical, dialectal, or incomplete.

If local `large-v3` supports a valid hypothesis, select the supported timed
result and record the evidence. If both baseline hypotheses are invalid but
the refinement is valid, select the refinement. On significant disagreement,
retry within the finite round limit and bounded local interval.

After the maximum round, request human review only when:

- two or more valid candidates still materially disagree;
- every candidate is invalid;
- speech/non-speech classification remains unresolved;
- noise, music, crowd, or overlap makes the acoustic evidence genuinely
  ambiguous.

A rejected hallucination branch does not create a human-review interval
when another valid candidate is adequately supported.

When round-one text is already stable at the existing consensus threshold and
only timing evidence remains unstable, retain the selected text and run a
timing-only alignment. Prefer token timestamps, speech/silence and VAD
boundaries, neighboring accepted cues, acoustic pauses, selected hypothesis
segments, then a bounded proportional fallback. Record
`ROUND_2_SKIPPED_TEXT_ALREADY_STABLE`, `timing-only-repair-selected`,
`repairType: timing-only`, `textChanged: false`, and `asrRerun: false`.
Round two remains available for material text conflict, invalid or
hallucinated refinement, language conflict, text-integrity loss, or
insufficient local support.

## Final-state finding lifecycle

Keep diagnostic history separate from the user review queue. Findings move
through `open`, `repaired`, `resolved`, `superseded`, `informational`, and
`needs-human-review`. Rebuild review state only after final hypothesis
selection, timing repair, presentation splitting, and post-presentation QA.
Findings attached only to a rejected hypothesis remain diagnostic. A prior
overmerge that was split/replaced is superseded; a boundary disagreement
whose selected final cue passes QA is resolved.

Do not treat `automatic-refinement-not-run` itself as a review instruction.
Record one of `not-needed`, `covered-by-neighbor`,
`covered-by-parent-refinement`, `superseded`, `duplicate-work`,
`timing-only-repair-sufficient`, `budget-limit`,
`missing-acoustic-evidence`, `missing-model-capability`, or
`execution-failed`. The first six are non-review by default. The latter four
create review only when the projected final cue still has an unresolved
problem.

`buildFinalReviewQueue()` maps remaining findings to final cue IDs, omits
unmapped history unless speech evidence indicates missing dialogue, and
groups adjacent timing/presentation findings only when they share a cue,
speech island, or refinement parent and do not cross a scene boundary.
`--review-group-gap-seconds` defaults to `0.75`. Report diagnostic finding
counts, final finding counts, and unique review groups separately.

Closure is provisional until the exact serialized cue set passes final
integrity. `assertFindingClosureMatchesFinalOutput()` compares every repaired,
resolved, superseded, or informational historical concern with hard final
integrity findings. If an equivalent repetition, timing, or coverage concern
still overlaps, reopen the original finding and add
`FINDING_CLOSED_BUT_PRESENT_IN_FINAL_OUTPUT`. A replacement cue ID alone is
never proof that the underlying problem disappeared.

## Canonical ASR segmentation

Normalize raw output from the CLI, persistent server, and OpenAI adapters
before quality evaluation, VAD/no-VAD comparison, targeted refinement, or
subtitle cue generation. The canonicalizer is deterministic and shares one
central configuration across adapters. Preserve every raw segment, token
timestamp, adapter/source ID, language, confidence, acoustic boundary, and
canonical mapping in `canonical-asr-segments.json`.

Merge adjacent raw segments only when the gap is within the central limit and
speech island, scene, speaker, language, and style remain compatible. Stop at
terminal semantic boundaries and maximum utterance duration/text limits.
Split an overlong raw segment in this order: token-level pause or punctuation,
acoustic pause/VAD or scene boundary, semantic punctuation, then a bounded
proportional fallback. Record the split method and fallback reason. Never
rewrite, translate, or otherwise improve the recognized wording during this
stage.

Before merging, compare adjacent raw segments for normalized high-containment
repetition. Normalize Unicode width, whitespace, punctuation, and harmless
edge interjections without removing the semantic core. After all merges and
splits, rerun hallucination QA on each canonical utterance and on 2–6
utterance windows spanning at most 20 seconds. A core phrase of at least
eight characters with at least three occurrences, a sentence loop, or a
repeated raw-source chain makes the canonical utterance
`suspected-hallucination`. Keep the complete source mapping and repetition
evidence, but exclude that utterance from normal cue presentation.

Use `scripts/asr-segmentation-parity.ts` to compare equivalent CLI and server
runs. Report raw and canonical counts, positional normalized-text agreement,
temporal coverage, and downstream QA counts rather than assuming equality
from segment count alone.

## Missing-dialogue targeted recovery

After initial arbitration, split each remaining missing-dialogue region by
speech islands, reliable cue boundaries, raw-ASR boundaries, scene boundaries,
and silence. A dialogue recovery unit defaults to at most 10 seconds and its extracted
context WAV must remain at or below the existing 30-second cap.

Reuse the existing persistent `large-v3 + Core ML` worker and keep model
loading, VAD settings, token settings, and prompts request-local. Run the
current sensitive VAD profile, run extra-sensitive VAD only when acoustic
speech evidence exists, and run a local no-VAD profile. Prompts may contain
only confirmed names and adjacent confirmed original-language speech. A
translated subtitle or reference is never a target transcript.

Run the complete language, repetition, hallucination, timing, and acoustic QA
on each canonicalized candidate. Accept recovery only when at least two
independent valid profiles agree at the existing consensus threshold and the
chosen timing is locally supported. Preserve a sole valid candidate,
conflicting natural candidates, invalid timing, or unstable noisy speech for
review. Use `probable-non-speech` only when multiple attempts are unusable,
background noise is high, and speech evidence is weak. Store every unit,
request profile, prompt provenance, cache key/hit, hypothesis, QA result, and
decision in `missing-dialogue-recovery.json`.

## Song regions and lyrics evidence

Treat songs as a separate evidence path rather than forcing them through
dialogue VAD. A long, continuous early-programme or music-heavy interval may
become `music-with-possible-vocals` when dialogue VAD is empty, vocal/speech
coverage is strong, and multiple no-VAD recovery windows contain lyric-like
material. Detection alone never validates the words.

For each region, reuse the persistent `large-v3 + Core ML` adapter with VAD
disabled and no lexical prompt. Decode independent 15-second phrase windows,
25-second context windows with overlap, and offset 20-second windows; no
actual extracted WAV may exceed 25 seconds. Accept a lyric cue only when
time-overlapping outputs from at least two different profiles agree and
Music-cue coverage reaches the configured threshold. Repeated lyrics require
stable phrase spacing, strong vocal evidence, and multiple independent-window
support. A dense unstable loop, random suffix changes, or a single profile
remains rejected. If consensus fails, preserve the region as
`MISSING_LYRICS` and create a `missing-lyrics` review event with
`listen-and-transcribe-lyrics`.

## Final subtitle integrity gate

Run this gate after presentation and before formatting SRT, VTT, or ASS. Its
input must be the exact final cue sequence. Check identical normalized lines
inside one cue, adjacent exact duplicates, sentence and long-phrase loops in
2–6 cue/20-second windows, and repeated multi-cue blocks. A repeated block
requires a common core of at least eight characters covering at least 65% of
both compared blocks; this catches split-boundary and light prefix/suffix
variation without accepting one tiny match inside a much longer unrelated
block. Also check invalid/order/overlap timestamps, ordinary cues longer than
12 seconds, and high-confidence vocal-region coverage. Confirmed Music cues
may repeat only when the lyrics evidence explicitly supports them.

For a duplicate chain or repeated multi-cue block, keep the earliest supported
occurrence and quarantine the later duplicate portion. Quarantine the unsafe
cue for a single-cue or timestamp failure, then re-evaluate the remaining cue
sequence and write
`final-subtitle-integrity.json`, and then rebuild
`transcription-timing-findings.json` and `final-review-queue.json`. The
artifact records candidate and final metrics separately, quarantined cue IDs,
vocal coverage, missing-lyrics regions, and gate failures. A non-empty gate
failure list forces `needs-review` and blocks burn-in.

Canonical utterances rejected as `suspected-hallucination` never disappear
merely because they were excluded before presentation. Project each contiguous
repetition chain into final integrity as a hard audio-review finding, even
when it has no final cue. Likewise, do not close a broad missing-dialogue or
speech/text-mismatch finding merely because one small cue inside the interval
passes QA: final cues must cover at least half of the acoustically supported
interval. Run finding-closure consistency only after these projections.

## Event-level review grouping

Keep diagnostic findings and final review groups intact, then add a
`ReviewEvent` layer for the user-facing workload. Map every event back to all
underlying finding, group, cue, speech-island, refinement, recovery-unit, and
scene IDs.

Merge adjacent hallucination groups only when they are one continuous
same-category event within the same speech island or refinement and scene,
with no conflicting speaker/style boundary and within the central maximum
event span. Never merge across scenes merely to lower the count. Represent a
long missing-dialogue event with multiple recovery sub-intervals whose
playable duration is no more than 30 seconds. Report findings, groups, events,
unioned review-audio duration, maximum event span, and maximum playable
sub-interval separately.

Festival noise, music, crowds, cheering, PA reverberation, drums, and
overlapping speakers can make every model emit a different plausible
sentence. Mark this `suspected-hallucination`; when background noise is high
and speech evidence is weak, `probable-non-speech` is allowed. Do not force a
dialogue subtitle from either class.

If VAD reports speech-like audio but ASR produces no usable cue, complete a
diagnostic subtitle package with `status: needs-audio-transcription`, a null
primary subtitle, and the unresolved interval in
`transcription-quality.json`. Do not invent placeholder dialogue or create
empty SRT/VTT/ASS files merely to make the task look successful.

Do not claim 100% accuracy. The objective is to reduce likely errors and
full-model computation while making unresolved audio explicit.

## Japanese text completeness and candidate arbitration

Keep all baseline, scene, no-VAD, refinement, recovery, lyrics, and
reference-original candidates as evidence with request/profile/anchor/unit/
scene provenance. Cluster only candidates that represent distinct generation
evidence for the same local interval or reference/recovery unit. Score
acoustic support, independent profile consensus, speech/token timing,
Japanese completeness, terminology, reference timing/semantics, repetition,
hallucination, and fragment risk. Terminology raises support only and never
performs a global text replacement.

With conservative resolution, accept a materially different winner only when
its score margin is at least 0.12; balanced mode uses 0.08. Near-equivalent
hypotheses collapse to one supported candidate. If materially different valid
hypotheses remain inside the margin, remove every competing final candidate
for that interval and create active review. Never emit parallel alternatives
as ordinary subtitles.

Use `Intl.Segmenter("ja")` as the default zero-dependency Japanese analyzer,
with generic kana, auxiliary, particle, and boundary rules. External analyzers
are optional adapters, not required native dependencies. Merge adjacent cues
when their boundary splits a stable Japanese token or high-confidence
morpheme. Split long cues only when a Japanese semantic boundary can be paired
with token timestamps, speech islands, or a real pause. Presentation line
balancing may insert a line break but may not create a new timed cue. The
default path records zero character-ratio segmentation fallbacks.

Run cross-cue lyric validation before the final text gate. A platform
boilerplate phrase, incomplete line, or conflicting lyrics candidate can be
detected across adjacent Music cues. Trusted Japanese original lyrics outrank
conflicting lyrics-ASR candidates; English translations and romanization never
become Japanese subtitle text.

The final text gate runs before presentation with exact thresholds: below
0.25 seconds is a hard fragment, 0.25 through below 0.50 seconds is warning,
and a single-character cue requires at least 0.40 seconds plus acoustic and
interjection evidence. It also checks incomplete morphemes/clauses, broken
cue boundaries, remaining competing hypotheses, semantic near-duplicates,
unsupported content, and lyric hallucinations. Enforce mode quarantines hard
findings; observe mode records them; off is explicit user policy.

## Cache identity

Keep the existing baseline cache. Include audio hash, global interval, model
hash/family, Core ML state, prompt, VAD profile, whisper.cpp version, and
timestamp options.

For refinement additionally include expanded interval, refinement round,
context-text hash, and selected quality model. Identical inputs must reuse
the cached result.

## Artifacts and reporting

### Reference-aware phases and generic speech anchors

The public guidance modes are `reference-free`, `reference-assisted`, and
`reference-guided`. Keep their file access boundaries observable:

1. Phase A is blind generation. `reference-free` and `reference-assisted`
   cannot open, parse, hash, or use reference timing/text before this phase
   completes. Hash the serialized blind cues and canonical transcript into
   `blind-generation-proof.json`.
2. Phase B parses and classifies SRT/VTT/ASS only for assisted/guided
   evaluation. Build stable cue and anchor IDs; merge contiguous identical
   effect cues; keep overlapping visual text, character introductions,
   credits, translator notes, sound descriptions, lyric original,
   romanization, and translation tracks separate.
3. Phase C runs only for guided mode or explicit reference repair. Work units
   merge adjacent anchors separated by no more than 0.5 seconds, use default
   maxima of 10 seconds for dialogue, 16 for narration, and 25 for lyrics,
   keep at most 4 dense adjacent anchors per unit, add only 1–2 seconds of
   extraction context, and
   never place translated text in a Japanese/Chinese/English ASR prompt.

Reference-guided routing remains additive. Clean dialogue keeps ordinary VAD;
quiet dialogue uses extra-sensitive VAD plus no-VAD; noisy dialogue uses VAD
plus no-VAD and large-v3 arbitration on conflict; unknown uses VAD plus no-VAD
and review on unresolved output. It is never no-VAD-only. Japanese original
lyrics may use trusted source timing and original text directly as Music cues.
English or romanized lyrics stay prompt-free ASR targets.

Reference-free runs create Discovered Speech Anchors from independent
ordinary/extra-sensitive VAD, acoustic scene, no-VAD, token, vocal, and lyrics
evidence. High-confidence uncovered dialogue anchors enter the same bounded
recovery planner as missing-dialogue review groups. Anchor coverage is checked
after final integrity, and an uncovered high-confidence anchor must have an
active review. Do not weaken repetition or final integrity gates to increase
coverage.

Reference evaluation uses temporal overlap, boundary distance, sequence,
scene/audio evidence, and optional semantic evidence to form bipartite
connected components. This supports one-to-one, one-to-many, many-to-one,
many-to-many, unmatched-reference, and unmatched-generated mappings. When no
cross-language model is configured, record conservative local number/polarity
heuristics with unknown similarity and an explicit fallback; continue
timing/coverage evaluation. Reference evidence is strong but not
absolute: editorial translation differences are not automatically ASR
failures.

Additional strict artifacts are:

```text
blind-generation-proof.json
reference-subtitle-analysis.json
reference-cue-classification.json
reference-timeline.json
reference-transcription-plan.json
reference-cue-alignment.json
reference-semantic-validation.json
reference-coverage-integrity.json
subtitle-evaluation.json
subtitle-evaluation.md
subtitle-diff.ass
false-quarantine-report.json
discovered-speech-anchors.json
anchor-coverage-integrity.json
anchor-text-coverage.json
```

Reference cache identity includes the reference hash, parser/classifier/
timeline versions, content policy, and timing mode. Guided ASR cache identity
uses audio/model/VAD/interval/scene/prompt hashes and anchor IDs, never the
English reference sentence as a target prompt.

When adaptive local transcription runs, write applicable artifacts beside
the primary subtitles:

```text
device-profile.json
media-profile.json
whisper-benchmark.json
transcription-plan.json
canonical-asr-segments.json
transcription-quality.json
transcription-quality-pre-recovery.json
transcription-quality-pre-presentation.json
transcription-quality-post-presentation.json
transcription-refinement.json
missing-dialogue-recovery.json
lyrics-transcription.json
transcription-corrections.json
transcription-timing-repairs.json
presentation-timing.json
final-subtitle-integrity.json
transcription-timing-findings.json
final-review-queue.json
whisper-execution-metrics.json
asr-segmentation-parity.json
cue-candidate-evidence.json
hypothesis-clusters.json
hypothesis-resolution.json
japanese-text-analysis.json
cue-segmentation-plan.json
final-text-integrity.json
lyrics-text-validity.json
reference-original-lyrics-resolution.json
semantic-candidate-validation.json
terminology-evidence.json
```

Extend the existing adaptive branch of `transcription-refinement.json`; keep
the existing `hybrid-vad` branch valid. Use refinement records for
model-to-model decisions and correction records for actual final text
changes. Conflict records retain `baselineHypotheses.vad`,
`baselineHypotheses.noVad`, detailed `conflict` metrics, full-model round
output, and decision status/classification/consensus. New records may also
store per-hypothesis validity and quality, local-consensus evidence,
`selectedHypothesis`, rejected-candidate reasons, `conflictCodes`, and
`accepted-after-refinement`. Keep every new field optional so historical
adaptive and `hybrid-vad` records remain readable.

Add an optional transcription summary to `subtitle-package.json`. Keep old
packages valid and keep downstream Skill 2 tolerant of the optional field.
Report strategy, device/Core ML state, baseline model, refinement model and
rounds, accepted/refined counts, VAD/no-VAD conflicts, full-model
resolutions, suspected hallucinations, probable non-speech intervals, and
every remaining review interval. Also report automatic VAD, no-VAD, and
large-v3 selections; rejected VAD/no-VAD hallucinations; and the count of
true unresolved conflicts.

## C4 integrity rescue, recovery, and portable cache

Treat the first text/subtitle integrity evaluation as analysis, not quarantine. Run at most two text-repair rounds using same-cluster or dedup donors, adjacent semantic continuation, segmentation-parent restoration, and acoustic/token timing donors; then apply the final text gate. After word-safe layout, repair duplicate/overlap/loop/long-cue findings before the final subtitle gate. Persist `text-integrity-repair.json` and `final-subtitle-repair.json`.

## Token timestamp coordinate integrity

Treat token text and token timing as separate capabilities. Record raw token values without overwriting them and declare one of `original-audio-local`, `original-media-global`, `vad-processed-local`, `segment-relative`, or `unknown`. Only an official mapped getter, a verified raw-VAD timeline map, an explicitly declared and verified segment-relative offset, or a health-validated no-VAD original-audio-local identity may produce mapped global timing. Never align a whole token group to its parent start, stretch it to segment duration, distribute it by character/token count, or clamp a large error into apparent validity.

Use the centralized C5.15.1 defaults: 0.05 seconds for audit containment, 0.20 seconds for trust containment, 0.50 seconds for hard parent drift, 0.20 maximum zero-duration lexical ratio, 0.20 maximum extraction-boundary-clamped lexical ratio, and 0.70 minimum usable lexical ratio. Exclude special/control tokens from the lexical denominator. A timing candidate must be mapped to `original-media-global`, trusted, monotonic, parent-contained, and free of hard drift. Quarantined token text may contribute lexical similarity only. Boundary consensus deduplicates by attempt and uses timing-usable evidence; representative interval selection uses trust, score, containment, cross-profile support, boundary confidence, intrusion, source quality, and a deterministic evidence ID.

For whisper.cpp 1.9.1, the server's VAD-profile decoded segment timestamps and word timestamps are not proven to share a coordinate system. Unless the active server explicitly exposes and uses a verified mapped-token interface, classify VAD words as `vad-processed-local`, quarantine their timing, retain decoded segments separately, and allow only health-validated no-VAD words as legacy token timing. Raw VAD intervals are unavailable unless the adapter obtains them directly from a verified runtime API; never relabel decoded segments as raw VAD.

Build bounded P0–P4 coverage recovery units from final anchor text coverage and unresolved integrity evidence. Ordinary low-gap review is not an ASR trigger. Execute P0–P3 dialogue/narration work with the shared persistent worker, route singing to lyrics, feed accepted candidates through the full Atomic Top-Score chain, and stop at a fixed point or two rounds. Persist `coverage-recovery-plan.json` and `coverage-recovery-results.json`.

Use Portable ASR Cache V2 for baseline, refinement, missing-dialogue, lyrics, and coverage-recovery requests. The key contains only ASR-affecting request inputs. Search portable V2, task-local V2, then exactly recomputed legacy paths supplied by `--asr-cache-import`; validate strict schemas, hashes, identity, and migrate atomically. Never scan arbitrary JSON for approximate reuse. Persist `asr-cache-manifest.json` and `asr-cache-migration.json`.

## Fallbacks and errors

Never hide a fallback. Record source capability, destination capability, and
reason. Preserve completed profiles and diagnostics when a later pass fails.

Keep `transcription-provider` separate from local strategy:

- `openai` bypasses this planner;
- explicit `whisper-cpp` fails when local requirements are missing;
- `auto` may use the existing configured OpenAI fallback only when no usable
  local adapter exists.
