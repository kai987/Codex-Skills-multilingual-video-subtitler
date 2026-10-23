import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const seconds = z.number().nonnegative();
const count = z.number().int().nonnegative();
const interval = z
  .object({ start: seconds, end: seconds })
  .strict()
  .refine((v) => v.end > v.start, "Empty or reversed interval");
export const c60113ReviewBudgetModeSchema = z.enum([
  "UNIQUE_AUDIO_10_PERCENT",
  "UNIQUE_AUDIO_20_PERCENT",
  "UNIQUE_AUDIO_30_PERCENT",
  "UNIQUE_AUDIO_40_PERCENT",
  "UNIQUE_AUDIO_50_PERCENT",
  "ALL_MANDATORY",
  "FULL_QUEUE",
]);
export const c60113CorrectionInstrumentationSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    regionRank: z.number().int().positive(),
    reviewBudget: c60113ReviewBudgetModeSchema,
    uniqueAudioSecondsBeforeDecision: seconds,
    playedSecondsBeforeDecision: seconds,
    candidateUsedAsEditingBase: z.boolean(),
    initialEditingCandidateId: z.string().min(1).nullable(),
    editDistanceFromCandidate: count.nullable(),
    decisionLatencySeconds: seconds,
    playbackCount: count,
  })
  .strict()
  .refine(
    (v) =>
      v.candidateUsedAsEditingBase === (v.initialEditingCandidateId !== null),
    "Editing-base identity mismatch",
  );

export const c60113WorkspaceExtensionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    workspaceMode: z.literal("REGION_FIRST_V2"),
    policyHash: hash,
    regions: z.array(
      z
        .object({
          regionId: z.string().min(1),
          itemIds: z.array(z.string().min(1)),
          rankPosition: z.number().int().positive(),
          rankScore: z.number(),
          contextInterval: interval,
          mandatoryReasons: z.array(z.string()),
          independentEvidenceFamilies: z.array(z.string()),
          candidateActionableCount: count,
          estimatedUniqueAudioSeconds: seconds,
          missingSpeechStates: z.array(
            z.enum([
              "SPEECH_GAP_OBSERVED",
              "MISSING_DIALOGUE_POSSIBLE",
              "MISSING_DIALOGUE_STRONG",
              "MISSING_DIALOGUE_CONTRADICTED",
              "MISSING_DIALOGUE_UNRESOLVED",
            ]),
          ),
        })
        .strict(),
    ),
    plans: z.array(
      z
        .object({
          planId: c60113ReviewBudgetModeSchema,
          budgetSeconds: seconds.nullable(),
          regionIds: z.array(z.string()),
          uniqueUnionSeconds: seconds,
        })
        .strict(),
    ),
    segments: z.array(
      z
        .object({
          segmentId: z.string().min(1),
          sourceInterval: interval,
          regionIds: z.array(z.string()),
          itemIds: z.array(z.string()),
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();

export const c60113TrialEventTypeSchema = z.enum([
  "TRIAL_STARTED",
  "TRIAL_PAUSED",
  "TRIAL_RESUMED",
  "REGION_OPENED",
  "REGION_COMPLETED",
  "ITEM_OPENED",
  "AUDIO_PLAYED",
  "AUDIO_PAUSED",
  "AUDIO_SEEKED",
  "CANDIDATE_CLICKED",
  "CANDIDATE_USED_AS_BASE",
  "MANUAL_EDIT_STARTED",
  "DECISION_COMMITTED",
  "DECISION_UNDONE",
  "TRIAL_COMPLETED",
  "ACTIVITY_SAMPLE",
]);
export const c60113TrialManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    trialVersion: z.literal("c6.0.1.13-prospective-trial-v1"),
    trialId: z.string().min(1),
    sourceMediaHash: hash,
    machineDraftHash: hash,
    reviewPackageHash: hash,
    workspaceExtensionHash: hash,
    rankerHash: hash,
    sourceDurationSeconds: seconds.positive(),
    requiredItemIds: z.array(z.string()),
    declarations: z
      .object({
        goldUnavailable: z.literal(true),
        previousHumanSubtitleUnavailable: z.literal(true),
        reviewerPriorExposure: z.literal(false),
      })
      .strict(),
    synthetic: z.boolean(),
    createdAt: z.iso.datetime(),
    activeTimePolicy: z
      .object({
        version: z.literal("visible-focused-interaction-or-playback-v1"),
        idleTimeoutSeconds: z.literal(60),
        maximumSampleGapSeconds: z.literal(5),
      })
      .strict(),
    semanticHash: hash,
  })
  .strict();

export const c60113TrialEventInputSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: c60113TrialEventTypeSchema,
    expectedReviewPackageHash: hash,
    expectedRankerHash: hash,
    visible: z.boolean(),
    focused: z.boolean(),
    interaction: z.boolean(),
    audioPlaying: z.boolean(),
    regionId: z.string().min(1).nullable(),
    itemId: z.string().min(1).nullable(),
    candidateId: z.string().min(1).nullable(),
    sourceInterval: interval.nullable(),
    manualCharactersEntered: count,
    decisionType: z
      .enum([
        "KEEP_CURRENT",
        "USE_REAZON",
        "USE_WHISPER_ALTERNATE",
        "MANUAL_EDIT",
        "TIMING_EDIT",
        "ADD_NEW_CUE",
        "MARK_FALSE_POSITIVE",
        "UNRESOLVED",
        "WAIVE_REVIEW",
      ])
      .nullable(),
  })
  .strict();
export const c60113TrialEventSchema = c60113TrialEventInputSchema
  .extend({
    schemaVersion: z.literal("1.0.0"),
    trialId: z.string().min(1),
    sequence: z.number().int().positive(),
    timestamp: z.iso.datetime(),
    previousEventHash: hash.nullable(),
    semanticHash: hash,
  })
  .strict();
export const c60113TrialMetricsSchema = z
  .object({
    totalElapsedSeconds: seconds,
    activeReviewSeconds: seconds,
    audioPlaybackSeconds: seconds,
    uniqueAudioPlayedSeconds: seconds,
    repeatedAudioSeconds: seconds,
    regionOpenCount: count,
    decisionCount: count,
    candidateClickCount: count,
    candidateBaseEditCount: count,
    manualEditCount: count,
    manualCharactersEntered: count,
    timingEditCount: count,
    newCueCount: count,
    falsePositiveCount: count,
    unresolvedCount: count,
    requiredCompletionRate: z.number().min(0).max(1),
    playedSourceIntervals: z.array(interval),
  })
  .strict();
export const c60113TrialStateSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    trialId: z.string().min(1),
    status: z.enum(["INITIALIZED", "ACTIVE", "PAUSED", "COMPLETED"]),
    eventCount: count,
    lastEventHash: hash.nullable(),
    metrics: c60113TrialMetricsSchema,
    realHumanSessionExecuted: z.boolean(),
    humanReviewTimeMeasured: z.boolean(),
  })
  .strict();

export const c60113TrialPackageManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    packageVersion: z.literal("c6.0.1.13-prospective-package-v1"),
    status: z.literal("AWAITING_ELIGIBILITY_DECLARATIONS"),
    machineDraftHash: hash,
    reviewPackageHash: hash,
    workspaceDataHash: hash,
    workspaceExtensionHash: hash,
    deploymentRankerHash: hash,
    machinePackagePath: z.literal("machine-subtitle-package.json"),
    reviewPackageFreezePath: z.literal("review-package-freeze.json"),
    reviewPackageFreezeFileHash: hash,
    machineFeaturesHash: hash,
    deploymentSelections: z
      .array(
        z
          .object({ planId: c60113ReviewBudgetModeSchema, selectionHash: hash })
          .strict(),
      )
      .length(7),
    reviewWorkspacePath: z.literal("review-workspace"),
    audio: z.array(
      z
        .object({
          relativePath: z
            .string()
            .regex(/^review-workspace\/audio\/[A-Za-z0-9._/-]+$/u),
          sha256: hash,
        })
        .strict(),
    ),
    inheritedSessionCount: z.literal(0),
    inheritedCorrectionCount: z.literal(0),
    inheritedPrivateEventCount: z.literal(0),
    realHumanSessionExecuted: z.literal(false),
    humanReviewTimeMeasured: z.literal(false),
    semanticHash: hash,
  })
  .strict();
export const c60113BlankReviewSessionSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    status: z.literal("NOT_STARTED"),
    reviewPackageHash: hash,
    machineDraftHash: hash,
    decisionCount: z.literal(0),
    eventCount: z.literal(0),
    realHumanSessionExecuted: z.literal(false),
  })
  .strict();

export type C60113WorkspaceExtension = z.infer<
  typeof c60113WorkspaceExtensionSchema
>;
export type C60113CorrectionInstrumentation = z.infer<
  typeof c60113CorrectionInstrumentationSchema
>;
export type C60113TrialManifest = z.infer<typeof c60113TrialManifestSchema>;
export type C60113TrialEventInput = z.infer<typeof c60113TrialEventInputSchema>;
export type C60113TrialEvent = z.infer<typeof c60113TrialEventSchema>;
export type C60113TrialState = z.infer<typeof c60113TrialStateSchema>;
