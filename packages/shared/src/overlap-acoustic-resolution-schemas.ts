import { z } from "zod";

import {
  assEventPresentationOverrideSchema,
  overlapRelationshipSchema,
  vttCuePresentationSettingSchema,
} from "./presentation-resolution-schemas.js";
import { languageTagSchema } from "./language.js";
import { schemaVersionSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/]).+/u, "Path must be relative.");

export const overlapAcousticResolutionModeSchema = z.enum([
  "off",
  "observe",
  "enforce",
]);

export const overlapAcousticProfileSchema = z.enum([
  "current-sensitive-vad",
  "extra-sensitive-vad",
  "no-vad",
]);

export const overlapAcousticIntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Interval end must be greater than start.",
  });

export const overlapAcousticTokenSchema = z
  .object({
    tokenId: z.string().min(1),
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    probability: z.number().min(0).max(1).nullable(),
  })
  .strict()
  .refine((value) => value.end >= value.start, {
    message: "Token end must be at or after start.",
  });

export const overlapAcousticSegmentSchema = z
  .object({
    segmentId: z.string().min(1),
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    confidence: z.number().min(0).max(1).nullable(),
    tokenIds: z.array(z.string().min(1)),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Segment end must be greater than start.",
  });

export const overlapAcousticAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    componentId: z.string().min(1),
    profile: overlapAcousticProfileSchema,
    requestId: z.string().min(1),
    requestType: z.literal("overlap-evidence"),
    useVad: z.boolean(),
    vadProfile: z.string().min(1),
    model: z.string().min(1),
    modelHash: hashSchema,
    modelFamily: z.string().min(1),
    coreML: z.boolean(),
    whisperCppVersion: z.string().min(1),
    cacheHit: z.boolean(),
    promptSha256: hashSchema,
    targetCueTextUsedAsPrompt: z.literal(false),
    referenceTranslationUsedAsPrompt: z.literal(false),
    humanReviewedSentenceUsedAsPrompt: z.literal(false),
    rawText: z.string(),
    segments: z.array(overlapAcousticSegmentSchema),
    tokens: z.array(overlapAcousticTokenSchema),
    speechIntervals: z.array(overlapAcousticIntervalSchema),
    metrics: z
      .object({
        durationSeconds: z.number().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
        tokenCount: z.number().int().nonnegative(),
        speechIntervalCount: z.number().int().nonnegative(),
        tokenTimestampsRequested: z.boolean(),
        tokenTimestampsUsed: z.boolean(),
      })
      .strict(),
    language: languageTagSchema.nullable(),
    failure: z.string().min(1).nullable(),
  })
  .strict();

export const overlapMatchedIntervalSchema = z
  .object({
    attemptId: z.string().min(1),
    source: z.enum(["token", "segment", "speech", "vad", "source"]),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((value) => value.end > value.start, {
    message: "Matched interval end must be greater than start.",
  });

export const overlapCueAlignmentSchema = z
  .object({
    cueId: z.string().min(1),
    canonicalText: z.string().min(1),
    normalizedSurface: z.string(),
    normalizedReading: z.string().min(1).nullable(),
    readingAvailable: z.boolean(),
    surfaceAlignmentScore: z.number().min(0).max(1),
    readingAlignmentScore: z.number().min(0).max(1).nullable(),
    tokenCoverageScore: z.number().min(0).max(1),
    temporalCoverageRatio: z.number().min(0).max(1),
    localSpeechCoverageRatio: z.number().min(0).max(1),
    neighborIntrusionRatio: z.number().min(0).max(1),
    profileConsensusScore: z.number().min(0).max(1),
    boundarySupportScore: z.number().min(0).max(1),
    boundaryConfidence: z.number().min(0).max(1),
    independentProfileSupportCount: z.number().int().nonnegative(),
    independentModelSupportCount: z.number().int().nonnegative(),
    matchedAttemptIds: z.array(z.string().min(1)),
    matchedSegmentIds: z.array(z.string().min(1)),
    matchedTokenIds: z.array(z.string().min(1)),
    matchedIntervals: z.array(overlapMatchedIntervalSchema),
    alignmentMethod: z.enum([
      "surface-token-sequence",
      "reading-token-sequence",
      "surface-segment",
      "temporal-speech-only",
      "unresolved",
    ]),
    alignmentConfidence: z.number().min(0).max(1),
    blockers: z.array(z.string().min(1)),
    evidence: z.array(z.string().min(1)),
  })
  .strict();

export const overlapPairAcousticAssessmentSchema = z
  .object({
    leftCueId: z.string().min(1),
    rightCueId: z.string().min(1),
    originalOverlapSeconds: z.number().nonnegative(),
    matchedIntervalOverlapSeconds: z.number().nonnegative(),
    orderConsistent: z.boolean(),
    sameOccurrenceLikely: z.boolean(),
    simultaneousSpeechSupported: z.boolean(),
    boundaryEvidenceIds: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const overlapCounterfactualSchema = z
  .object({
    hypothesis: z.enum([
      "ordered-no-overlap",
      "rapid-turn-taking",
      "nested-background-foreground",
      "true-simultaneous-speech",
      "same-utterance-alternative",
    ]),
    score: z.number().min(0).max(1),
    evidenceIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

export const overlapAcousticTimingMutationSchema = z
  .object({
    mutationId: z.string().min(1),
    componentId: z.string().min(1),
    cueId: z.string().min(1),
    beforeStart: z.number().nonnegative(),
    beforeEnd: z.number().positive(),
    afterStart: z.number().nonnegative(),
    afterEnd: z.number().positive(),
    startDelta: z.number(),
    endDelta: z.number(),
    boundarySource: z.enum(["token", "speech", "vad", "source", "pause"]),
    evidenceIds: z.array(z.string().min(1)).min(1),
    textChanged: z.literal(false),
  })
  .strict()
  .refine(
    (value) =>
      value.beforeEnd > value.beforeStart && value.afterEnd > value.afterStart,
    { message: "Timing mutation intervals must have positive duration." },
  );

export const overlapAcousticComponentSchema = z
  .object({
    componentId: z.string().min(1),
    sourceOverlapDecisionId: z.string().min(1),
    cueIds: z.array(z.string().min(1)).min(2),
    unionInterval: overlapAcousticIntervalSchema,
    extractionInterval: overlapAcousticIntervalSchema,
    audioPath: relativePathSchema.nullable(),
    audioSha256: hashSchema.nullable(),
    audioDurationSeconds: z.number().nonnegative().nullable(),
    audioFullyCoversComponent: z.boolean(),
    profileAttemptIds: z.array(z.string().min(1)),
    cueAlignments: z.array(overlapCueAlignmentSchema),
    pairAssessments: z.array(overlapPairAcousticAssessmentSchema),
    counterfactuals: z.array(overlapCounterfactualSchema),
    finalRelationship: overlapRelationshipSchema,
    classificationConfidence: z.number().min(0).max(1),
    recommendedAction: z.enum([
      "preserve-overlap",
      "delete-duplicate",
      "select-alternative",
      "merge-fragments",
      "trim-boundary",
      "review",
    ]),
    safeAutomaticAction: z.enum([
      "none",
      "presentation-only",
      "timing-only",
      "delete-duplicate",
      "select-alternative",
      "merge-fragments",
    ]),
    timingMutations: z.array(overlapAcousticTimingMutationSchema),
    assEventOverrides: z.array(assEventPresentationOverrideSchema),
    vttCueSettings: z.array(vttCuePresentationSettingSchema),
    blocking: z.boolean(),
    reasons: z.array(z.string().min(1)),
  })
  .strict();

export const subtitleOverlapAcousticResolutionSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    artifactType: z.literal("subtitle-overlap-acoustic-resolution"),
    resolutionVersion: z.literal("C5.15"),
    generatedAt: z.iso.datetime(),
    sourceFingerprint: z
      .object({
        fileName: z.string().min(1),
        size: z.number().int().nonnegative(),
        durationSeconds: z.number().nonnegative(),
        sha256: hashSchema,
      })
      .strict(),
    baseCueHash: hashSchema,
    basePresentationResolutionHash: hashSchema,
    configuration: z
      .object({
        mode: overlapAcousticResolutionModeSchema,
        audioStreamIndex: z.number().int().nonnegative(),
        contextSeconds: z.number().nonnegative(),
        maximumWindowSeconds: z.number().positive(),
        hardMaximumWindowSeconds: z.number().positive(),
        maximumAsrRequests: z.number().int().positive().max(28),
        profiles: z.array(overlapAcousticProfileSchema).min(1).max(3),
        maximumTimingAdjustmentSeconds: z.number().nonnegative(),
        minimumPostRepairCueDurationSeconds: z.number().positive(),
        maximumNeighborIntrusionRatio: z.number().min(0).max(1),
        minimumBoundaryConfidence: z.number().min(0).max(1),
        minimumAlignmentConfidence: z.number().min(0).max(1),
        minimumIndependentProfileSupport: z.number().int().positive(),
        scoringWeights: z
          .object({
            surfaceOrReading: z.number().nonnegative(),
            tokenCoverage: z.number().nonnegative(),
            temporalCoverage: z.number().nonnegative(),
            profileConsensus: z.number().nonnegative(),
            boundarySupport: z.number().nonnegative(),
            neighborIntrusionPenalty: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    attempts: z.array(overlapAcousticAttemptSchema),
    components: z.array(overlapAcousticComponentSchema),
    summary: z
      .object({
        componentCount: z.number().int().nonnegative(),
        cueCount: z.number().int().nonnegative(),
        audioExtractedCount: z.number().int().nonnegative(),
        audioFullyCoveredCount: z.number().int().nonnegative(),
        profileAttemptCount: z.number().int().nonnegative(),
        asrRequestCount: z.number().int().nonnegative(),
        cacheHitCount: z.number().int().nonnegative(),
        resolvedCount: z.number().int().nonnegative(),
        timingOnlyResolvedCount: z.number().int().nonnegative(),
        legalOverlapResolvedCount: z.number().int().nonnegative(),
        unresolvedCount: z.number().int().nonnegative(),
        timingMutationCount: z.number().int().nonnegative(),
        canonicalTextMutationCount: z.literal(0),
        wholeMediaAsrRequestCount: z.literal(0),
        midpointRepairCount: z.literal(0),
        characterRatioRepairCount: z.literal(0),
      })
      .strict(),
  })
  .strict();

export type OverlapAcousticResolutionMode = z.infer<
  typeof overlapAcousticResolutionModeSchema
>;
export type OverlapAcousticProfile = z.infer<
  typeof overlapAcousticProfileSchema
>;
export type OverlapAcousticAttempt = z.infer<
  typeof overlapAcousticAttemptSchema
>;
export type OverlapCueAlignment = z.infer<typeof overlapCueAlignmentSchema>;
export type OverlapAcousticComponent = z.infer<
  typeof overlapAcousticComponentSchema
>;
export type SubtitleOverlapAcousticResolution = z.infer<
  typeof subtitleOverlapAcousticResolutionSchema
>;
