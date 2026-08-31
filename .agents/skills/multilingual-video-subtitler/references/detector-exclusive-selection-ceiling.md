# C6.0.1.14.2 detector-exclusive selection and masked-speech ceiling

Use this route only for an explicit C6.0.1.14.2 investigation. It is review assistance, not canonical correction. Do not start C6.0.1.15, retrain R3, perform OOF training, start a human trial, run source separation, or authorize C6.0.2/C6.1. Skill 2 and Skill 3 are out of scope.

## Freeze and authorization

`run:c6-0-1-14-2-machine` accepts a strict local configuration for the hash-bound C6.0.1.14.1 state, output root, prefix/date and isolated WebRTC runtime directory. Always allocate new output directories. Never overwrite old outputs, caches, canonical text/timing, presentation or subtitle exports.

The `baseline` phase replays old detector and ASR evidence with zero inference, model loads and provider starts. Phase A `selection` reads only old machine evidence. Persist pathology, cluster, supersession and A1/A2/A3 projections before acquiring any new evidence. The deterministic `views` and `detector-plan` phases do not authorize models.

Fresh detectors require `--authorize-c6-0-1-14-2-detector-ceiling`; fresh ASR requires `--authorize-c6-0-1-14-2-local-asr`. Freeze source identity, DSP measurements/PCM, policy thresholds, runtime/model/worker identities, selection and request plan before execution. Reserve each request exclusively and durably before inference. A consumed failure occupies budget; there is no automatic retry, target substitution, device fallback or backfill.

The requested policy name is `c6.0.1.14.2-detector-exclusive-selection-masked-speech-ceiling-v1`. This implementation's frozen execution/cache identifier is `c6.0.1.14.2-safety-selection-detector-ceiling-v1`. A strict hash-bound `c6-0-1-14-2-policy-name-binding.json` records the naming alias only. Do not rewrite completed cache identities or thresholds to rename a policy.

## Phase A: recover slots, not invented speech

Cluster exact source-native atomic fragments. Preserve disjoint `targetCoreUnion` members; a min/max review envelope supplies context only. Bound envelopes to twelve seconds, enforce cue/scene/speaker/target barriers, and require genuine intervening speech evidence for merges. Never use Gold locations, old error IDs or reference subtitles to select clusters.

The safety ceiling is 24 active clusters and 60 seconds of core union. Preserve all old safety coverage through a supersession ledger; do not retain both old and replacement active entries. Reserve four slots for novel detector-exclusive evidence when available. Use marginal uncovered seconds, distinct strata/time bins, independent families, overlap and local density. Same-model views remain one family. An explicit local-density exception may preserve existing covered speech; it cannot expand the global ceiling or promote REQUIRED status.

Preserve all non-safety targets/items and the old mandatory queue/order. Safety recommendations are not verified missing dialogue. Keep overflow, audit-only, selection rejections and unresolved evidence visible.

## Phase B: measured views and native score tracks

Audit old PCM identities and amplitude-only no-ops before scheduling. Generate at most two effective deterministic views; compensate FIR delay and require impulse/sample-count controls. Reject duplicate, amplitude-only and timebase-unverified views. View transforms are DSP, not a neural source separation claim.

At most eight new detector requests are allowed: four WebRTC, two Silero and two Pyannote. WebRTC is an independent binary GMM/VAD family, not a probability-producing neural model. Use its fixed mono 16 kHz / 16-bit / 20 ms / aggressiveness-zero profile. Bootstrap only its isolated dependency runtime when explicitly authorized; do not download ASR or diarization models.

Preserve Silero frame probabilities and Pyannote pre-hard-conversion anonymous powerset speech scores in compact hash-bound tracks. Keep the original Pyannote chunk scores and their overlap projection, without speaker identity or embeddings. Store score kind, frame hop/offset/window, native rational mapping, thresholds and raw receipts. Do not count padding/merge gaps as detector-positive speech. Never infer raw VAD intervals from decoded segments.

Fixed main/audit thresholds are Silero 0.2/0.1 and Pyannote 0.5/0.25, with 0.12-second subthreshold peaks. Acoustic energy, voice-band ratio, modulation, flatness and harmonicity are corroboration/contradiction proxies, not transcripts or independent model votes. Energy alone cannot become speech. Preserve main, subthreshold, energy-only and music-contradicted classifications separately.

Build source-native Inventory V5 and subtract exact canonical/old-target masks. Select with the already frozen policy. Freeze at most four new exact local ASR targets and at most two context targets: two models each, twelve requests total. Never repeat the old 32 requests or run whole-source ASR. Use empty prompts and no VAD trimming. Exact-window text and trusted context-token spans have distinct localization semantics; Reazon point timestamps do not prove a token span. Empty/disagreeing ASR does not remove a speech-only safety target or authorize cue insertion.

## Real review delivery and independent replays

Deliver Targets V4, Items V6, Regions V5, Audio V5 and Playback V4 over the unchanged C6.0.1.12 transaction subsystem. `C601142_FINAL_FULL_QUEUE` is the official full queue; ALL_MANDATORY is diagnostic. Bind every source-global target to playable WAV bytes, frame-derived durations, hashes and exact audio-local segments. Disjoint target cores and context envelopes must remain distinguishable in UI and artifacts.

Copying a candidate only fills the human editing base. Playback, queue filtering and jumping to safety evidence never save a decision, start a session or change canonical text/timing. Retain unresolved evidence even when no audio can safely be fabricated. Real browser checks must inspect playback readiness/time progression, queue controls, console errors and unchanged session state; synthetic tests are not a human trial.

`detectors-replay`, `asr-replay`, `final-a` and `final-b` are exact-cache-only. Recompute each final independently from the readonly old/new caches. A missing cache, altered source/runtime/PCM/hash, incomplete WAV or playback binding fails closed, without constructing a provider. Compare A/B machine bytes and semantics, old outputs' metadata, protected subtitle hashes and all comparison queues.

For an incomplete final attempt before Gold, `--phase allocate-finals` creates new Final A/B and validation directories with the existing exclusive allocator; it preserves prior attempts and every inference cache. Never overwrite an incomplete final or rerun a consumed inference. The browser's zero-byte `session/workspace-mutation.sqlite` is an OS mutex, not review data: freeze may bind its empty bytes as inert provenance. Nonempty mutexes, saved session state, human correction journals and Gold paths remain forbidden.

## Gold isolation and acceptance

Freeze all A0/A1/A2/A3/B1–B8 projections and four real-audio comparisons: old baseline, selection-only, detector-only with unchanged old atomic slots, and final combined delivery. Detector-only must not borrow the slot-clustering benefit. Reusing detector receipts does not imply new inference. All physical comparisons must exist before Gold is opened.

Run full code checks, generated-schema validation, Skill validation and actual browser acceptance first. `evaluate:c6-0-1-14-2-detector-ceiling` verifies both machine freezes, current code, validation logs, browser hashes and physical WAVs, then writes and fsyncs an exclusive first-Gold-read intent before even hashing Gold. After that intent exists, machine phase execution is forbidden. Do not repair machine selection after seeing evaluation results.

Reuse the existing component identities and matching semantics: direct interval any/0.5-majority/0.8-audible/0.95-full coverage. Report speech, lexical, target, physical audio, actual playback and lineage independently. The full-queue gate needs all Missing and Hallucination components audibly covered, complete target delivery and no more than 95% of episode audio. Good lexical evidence cannot compensate for missing audio; incomplete lexical evidence cannot block genuinely audible review. Non-overlap with known missing components is only a burden proxy, not confirmed false-positive speech.

Use `validate:c6-0-1-14-2-runs` for strict artifacts, immutable old outputs, evidence/final parity, physical delivery, Gold/source readonly identities, reportable route and aggregate export. Keep raw audio, dialogue, score arrays, local paths and Gold-linked diagnostics LOCAL_ONLY. Only the strict aggregate summary and its passing shareable audit may be published. Engineering completion is separate from detection/audio efficacy and subtitle quality. Always retain `needs-review`, `finalizationMethod: none`, `machineOnlyReleaseAuthorized: false`, and C6.0.2 `HOLD`.
