# Prospective human review protocol V2

Protocol: `REAL_HUMAN_TRIAL_PROTOCOL_V2`

Runtime: C6.0.1.13 region-first review; reused C6.0.1.12 correction/delivery contract.

## Purpose and eligibility

Measure the real human effort needed to review a frozen machine subtitle draft. This protocol does not authorize automatic finalization, automatic provider selection, or further recognition. Engineering and synthetic tests do not establish human efficiency.

Choose an episode that the reviewer has not previously reviewed or inspected with Gold. Keep any Gold and prior human subtitle outside the review environment until the trial ends. The reviewer must explicitly declare all three conditions: Gold unavailable, previous human subtitle unavailable, and no prior exposure. A false declaration invalidates the trial. Carnation Episode 1 is a calibration dataset with prior Gold exposure and is not eligible; do not start a real session for it.

Do not proceed if the acceptance report routes to missing-evidence, ranker, or workspace repair. A frozen fallback ranker is not itself trial-readiness approval. When a trial is allowed with a ranking caveat, state the caveat before collecting data and retain all mandatory items.

## Freeze order

1. Produce and validate a machine-only draft and evidence package without Gold. Preserve original source media and its SHA-256, size, and modification time.
2. Build machine missing-speech evidence, independent evidence families, structured items/regions, audio timeline, burden plans, and machine features. Do not rerun ASR for this preparation step.
3. Select the previously frozen deployment ranker. Do not fit it on the trial episode or inspect the trial's Gold. Record the feature-schema, policy, and deployment hashes.
4. Freeze the complete workspace snapshot and verify every review WAV hash. Create a private trial package containing only machine evidence, review audio, the deployment-only ranker, and blank local state. Exclude calibration labels, training memberships, Gold identities, previous human subtitles, notes, and private event history.
5. Run the package/freeze validator. Only then initialize the trial and make the eligibility declarations. If any frozen input changes, abandon that trial identity and build a new package; never resume a stale session against different candidates.

## Local commands

Commands use the existing repository runtime and run only on loopback. Supply the actual frozen files; these placeholders are paths, not generated acceptance evidence.

```bash
npm run review:trial -- package --workspace /path/workspace \
  --freeze /path/workspace/c6-0-1-12-review-package-freeze.json \
  --ranker /path/c6-0-1-13-region-ranker-freeze.json \
  --machine-package /path/workspace/subtitle-package.needs-review.json \
  --region-features /path/machine-review-region-features.json \
  --output /path/new-trial-package

npm run review:trial -- init --workspace /path/new-trial-package/review-workspace \
  --freeze /path/new-trial-package/trial-manifest.json \
  --ranker /path/new-trial-package/frozen-region-ranker.json \
  --source-media /path/unseen-episode.mkv \
  --gold-unavailable --previous-human-subtitle-unavailable --reviewer-unexposed

npm run review:trial -- serve --workspace /path/new-trial-package/review-workspace \
  --freeze /path/new-trial-package/trial-manifest.json
```

Use the emitted loopback URL. The same `review:trial` command supports `start`, `pause`, `resume`, `complete`, `validate`, and `export`, always with the same workspace and freeze. `export` additionally requires a new `--output` path. Never use `--synthetic` for a real trial or remove that flag from an engineering fixture to relabel it as real.

## Review procedure

Start with the predeclared budget (10/20/30/40/50 percent unique source audio, ALL_MANDATORY, or FULL_QUEUE). Record the selected budget; percentages are of episode duration, not of overlapping clip sums. The queue defaults to Regions containing nested Items and contextual candidates. Correction instrumentation records the selected budget at decision time. A budget change does not erase prior activity; this version does not emit a dedicated budget-change trial event.

Listen to source audio before a material edit. Use the shared playback timeline to skip already listened-to intervals when appropriate. Replaying audio is allowed and counted separately. Audio seek alone is not evidence of listening. Open the specific item when deciding a cue; do not treat completion of another item in the same region as completion of all its required items.

Candidate diffs are visual aids, not authoritative text. `USE_AS_EDITING_BASE` copies one candidate to the manual-edit field; it does not select that provider, merge candidates, or commit a decision. Confirm one of the existing nine actions explicitly. A waiver needs a reason; an unresolved item remains unresolved. Incorrect missing-speech proposals may be marked false positive without deleting an existing canonical cue.

Preserve all append-only events and corrections across undo. If the browser closes or process crashes, reopen the same frozen package, let the local journal recover, validate, and resume. Do not erase idle periods, repeated playback, false starts, or superseded decisions from the audit.

## Timing and events

Active-time policy is `visible-focused-interaction-or-playback-v1`, with a 60-second idle threshold and bounded activity samples. Count active time only while the page is visible and focused and there is recent interaction or actual playback. Paused/background/idle time is not active review time. The elapsed interval from start to finish is reported separately.

Record trial start/pause/resume/completion; region and item opening; region completion; audio play/pause/seek; candidate click and use as editing base; manual-edit start; decision commit and undo. Store source-global listened intervals, never inferred intervals from the entire loaded clip. Track unique, total, and repeated audio independently.

Required measurements are total elapsed seconds, active review seconds, audio-playback seconds, unique audio played, repeated audio, region opens, decisions, candidate clicks/base edits, manual edits/characters, timing edits, new cues, false positives, unresolved items, and required completion rate. Keep correction-level rank, budget, listening progress, candidate-base identity/edit distance, latency, and playback count. No fixture result substitutes for these real human measurements.

## Completion, apply, and later Gold evaluation

Validate the session, all append-only chains, frozen identities, and required completion independently. Resolve or explicitly document every required item according to the existing completion policy; a score decrease or region playback never completes it. Export the private trial events and correction dataset before applying edits.

Run the existing `review:apply` dry validation against the same base package, freeze, review data, session, correction log, and audit log. Apply only explicit active human decisions after validation. Preserve the input machine draft; write a separate human-reviewed result with fresh ASS/SRT/VTT validation.

Only after the trial is completed and frozen may a separate evaluator access Gold. Compare quality and residual errors at the predeclared budgets and report human time honestly. Do not feed post-trial labels into this same ranker version or claim an ideal/synthetic reviewer as the observed reviewer. Retuning requires a new policy version and another unseen prospective episode.

## Privacy and abort rules

Trial events, audio, subtitles, candidate text, reviewer notes, and correction histories remain local/private. Share aggregate durations/counts, status, and cryptographic hashes only. Strip absolute paths, credentials, Gold identifiers/text, and event details from shareable summaries.

Abort and retain an auditable incomplete state on Gold exposure, stale workspace/ranker identity, corrupt audio, broken append-only history, clock/instrumentation failure, unexpected external requests, or a reviewer withdrawal. Do not silently repair the measurements or mark the trial completed. Report the reason, affected interval, and whether a new trial is necessary.
