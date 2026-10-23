# C6.0.1.12 Real Human Trial Protocol

## Status and scope

C6.0.1.12 prepares a human-on-exception review workflow. Carnation episode 1 is a development benchmark with an already complete human Gold subtitle. It must not be used as a real human trial, and its Gold must not be converted into a review session or correction log.

The first real trial must use an unseen, previously unreviewed episode for which the reviewer has not seen a reference transcript. The trial measures workflow usefulness; it does not authorize machine-only release or C6.0.2.

## Isolation rules

1. Select an episode with no prior human correction log in this repository.
2. Record source identity and hash before any review build.
3. Run the machine review build without Gold, reference text, translation text, or human transcript.
4. Freeze policy, review items, priority, regions, candidates, audio manifest, and workspace before the reviewer opens the workspace.
5. Do not expose hidden Gold or reference-derived labels in the workspace.
6. If Gold is later produced, it may only be read by a separate post-freeze evaluator.
7. Never use post-freeze outcomes to rewrite the same frozen C6.0.1.12 policy; changes require a new version and another unseen episode.

## Trial preparation

- Verify that every review audio region is a playable 16 kHz mono PCM WAV and covers its advertised core intervals.
- Verify that the workspace has no external CDN, analytics, API, or cloud dependency.
- Start the server only on `127.0.0.1`.
- Confirm that `review-session.json`, `human-correction-log.jsonl`, and `review-audit.jsonl` do not exist before the reviewer makes the first explicit decision.
- Preserve the frozen machine draft and its cue hash read-only.
- Record the reviewer-visible policy version and review package semantic hash.
- Supply the same Review Package Freeze to serve, validate, stats, apply, and correction export. The UI and decision API must use the same verified review-data snapshot.

## Reviewer procedure

For each REQUIRED item, the reviewer listens to the local audio, checks the highlighted core interval and adjacent cues, compares evidence-labelled candidates, and records exactly one current decision:

- `KEEP_CURRENT`
- `USE_REAZON`
- `USE_WHISPER_ALTERNATE`
- `MANUAL_EDIT`
- `TIMING_EDIT`
- `ADD_NEW_CUE`
- `MARK_FALSE_POSITIVE`
- `UNRESOLVED`
- `WAIVE_REVIEW` with a written reason

`UNRESOLVED` does not complete a REQUIRED item. Undo never deletes history; it appends an audit event and restores the previous active state. A candidate decision must bind the exact candidate ID and candidate-set hash shown at decision time.

The CLI must independently recompute REQUIRED-item and region completion from the frozen review data and active decisions, and reject forged completion summaries or disallowed actions. An incomplete session may be inspected or exported but cannot be applied as a completed review. Concurrent servers must serialize writes; a crashed lock owner must not prevent safe journal recovery.

## Measurements

Measure and report these values from the real session rather than estimating them:

- total reviewed items and regions;
- REQUIRED completion and unresolved counts;
- decision counts by action;
- local audio seconds opened and replayed, if instrumented without network telemetry;
- elapsed reviewer time, only if measured with an explicit local timer;
- corrections per minute, if elapsed time is measured;
- stale-base, invalid-action, audio, and server errors;
- candidate acceptance by provider;
- manual-edit and timing-edit rates;
- undo and waiver counts;
- residual error metrics from a separate post-freeze evaluation, if Gold later becomes available.

If reviewer time is not directly measured, report `NOT_MEASURED`; do not infer it from audio duration or filesystem timestamps.

## Acceptance gates

The workflow is trial-usable only when:

- all frozen Artifact hashes verify;
- Gold input count is zero for build/workspace/session;
- all REQUIRED audio is playable;
- session resume and stale-base protection pass;
- correction and audit logs remain append-only and parseable;
- applying active decisions produces a strict SubtitlePackage plus ASS, SRT, and VTT;
- source and frozen machine draft remain unchanged;
- no secret, absolute path, or broken relative reference appears in shareable summaries.

Quality acceptance must be reported separately. A technically valid review session does not imply subtitle release readiness. Production remains `needs-review`, `finalizationMethod = none`, and `machineOnlyReleaseAuthorized = false` unless a later explicitly authorized release gate changes those values.

## Abort conditions

Stop the trial if the source hash changes, the review package hash is stale, a Gold/reference field appears in the workspace, required audio is missing, the server binds beyond loopback, correction records cannot be replayed, or the strict output package fails validation. Preserve existing logs for diagnosis; do not silently repair or rewrite them.
