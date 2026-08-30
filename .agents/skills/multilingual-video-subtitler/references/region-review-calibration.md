# C6.0.1.13 region-first review calibration

This is a machine-review and evaluation mode, not another ASR or canonical-repair pass. Reuse the current machine-only package, queue, candidate bundles, source-global VAD mapping, localized acoustic evidence, and scene evidence. Source media may be read to extract review WAV audio. Never invoke Whisper, Reazon, CTC, MFA, or speaker inference merely to build or evaluate the review queue.

## Evidence and required review

Preserve five separate missing-speech states: `SPEECH_GAP_OBSERVED`, `MISSING_DIALOGUE_POSSIBLE`, `MISSING_DIALOGUE_STRONG`, `MISSING_DIALOGUE_CONTRADICTED`, and `MISSING_DIALOGUE_UNRESOLVED`. A VAD gap alone is not proof of omitted dialogue. Strong missing requires validated source-global uncovered speech, independently localized lexical content, another independent supporting family, and no strong music/lyrics/noise contradiction. A gap already covered by canonical cues cannot become strong missing.

Deduplicate shared roots and same-provider evidence before counting families. Mapped VAD, raw VAD, and speech-incomplete signals from one lineage are not three independent votes. Missing CTC/token/provider evidence is uncertainty, not positive error evidence. Preserve provenance and uncertainty even when a legacy missing-risk label is downgraded. Do not delete low-priority items to improve a metric.

REQUIRED review is separate from the display score: strong missing, strong hallucination, independently supported severe timing/overlap, or structural corruption may require review. Display scores are explanations, never calibrated probabilities. Region aggregation must consider independent families, distinct affected cues/events, actionable candidates, and listening cost rather than only the highest item score.

## Audio burden and ordering

Use half-open source-global intervals. Report clip-duration sum, unique interval union, duplicate context, and order-dependent incremental audio separately. Budget percentages refer to the full episode duration, not the sum of overlapping clips. Provide 10/20/30/40/50 percent, fixed-second comparisons, ALL_MANDATORY, and FULL_QUEUE. ALL_MANDATORY may exceed a listening budget; never waive it silently.

Region selection recomputes marginal machine-risk coverage and incremental unique audio after each choice, with a fixed versioned per-region review overhead. Non-overlapping playback segments retain Region-to-segment and Item-to-region mappings. The workspace defaults to Regions with nested Items; it can skip already played source intervals and report played/remaining unique audio.

## Freeze and calibration boundary

1. Rebuild the old baseline and verify machine package, source identity, candidate/audio hashes, and the prior freeze.
2. Freeze new missing evidence, family graph, items, regions, priorities, playback plans, structural features, workspace, and policy.
3. Construct contiguous time-blocked groups before reading labels. Audio overlap and nearby shared scene/speaker structure must not cross train/test folds. Do not use random splits or repartition after seeing labels.
4. Only then run the separate Gold evaluator. Reuse complete canonical-lineage labels and unique error-component IDs, including errors absent the queue. Gold cannot change the machine features, required rules, grouping, or same-version policy.
5. Fit each OOF model's imputer, scaler, class weights, and coefficients on its training fold only. Raw dialogue, embeddings/ngrams, identities, proper nouns, absolute source-time predictors, and Gold-derived features are prohibited. Keep unknown, unavailable, and observed zero distinct.
6. Report chronological, legacy, missing-calibrated deterministic, risk-density, and linear OOF comparisons at equal unique-audio budgets. Show per-fold negative results and missing/hallucination misses. Full-data fitting is only for a future deployment ranker after OOF gates; it is not an Episode 1 prospective result.

Preserve the deterministic `REGION_RISK_DENSITY_V3` fallback when learned ranking is unsupported. A fallback freeze does not imply that trial-readiness or quality gates passed. Keep `needs-review`, `finalizationMethod: none`, `machineOnlyReleaseAuthorized: false`, and `c602Status: HOLD`.

## Workspace and future human trial

Reuse `review:serve`, the nine explicit human decisions, append-only corrections/audit, frozen-base validation, and the crash-releasing SQLite transaction lock. New region metadata is bound inside the complete frozen workspace. The old C6.0.1.12 envelope is a reused delivery subsystem contract, not the version of the C6.0.1.13 evidence policy.

`USE_AS_EDITING_BASE` copies one candidate into the manual-edit field; it is not a decision, does not merge candidates, and never applies text. Record editing-base identity, edit distance, selected budget, region rank, listening progress, decision latency, and playback count in optional strict instrumentation metadata. Preserve old correction records and reject stale package/ranker identities.

Follow `REAL_HUMAN_TRIAL_PROTOCOL_V2.md` for an unseen episode. Require Gold and previous human subtitles to be unavailable and the reviewer to declare no prior exposure. A known exposed episode must fail eligibility. Synthetic trial events can validate init/start/pause/resume/complete/export and crash recovery, but cannot establish real human time or efficiency.

Active review time requires a visible, focused page and recent interaction or actual audio playback. Apply the versioned idle threshold; do not call wall-clock session duration active time. Track source-global played intervals and repeated playback separately. Trial packages include a deployment-only ranker, frozen machine workspace/audio, and blank local state, never calibration labels, Gold paths/hashes/text, previous human subtitles, reviewer notes, or private event history.

## Acceptance

Validate strict schemas and semantic hashes; compare independently rebuilt A/B machine artifacts, audio hashes, and unchanged ASS/SRT/VTT bytes. Recheck source and Gold size/hash/mtime. Run full regression, browser workflow/security checks, and a synthetic unseen-fixture trial. Keep engineering acceptance, ranking effectiveness, burden safety, and prospective readiness as separate conclusions. Shareable summaries contain only aggregates, hashes, and sanitized status, not full dialogue, audio, local paths, credentials, or reviewer events.
