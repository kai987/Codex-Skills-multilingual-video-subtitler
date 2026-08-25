import { z } from "zod";

import {
  assEventPresentationOverrideSchema,
  overlapRelationshipSchema,
  vttCuePresentationSettingSchema,
} from "./presentation-resolution-schemas.js";
import { languageTagSchema } from "./language.js";
import { schemaVersionSchema } from "./schemas.js";
import {
  timestampCoordinateSystemSchema,
  timestampIntegrityIntervalSchema,
  timestampMappingMethodSchema,
  tokenTimelineStatusSchema,
} from "./timestamp-evidence-integrity-schemas.js";

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
    parentSegmentId: z.string().min(1).optional(),
    rawStart: z.number().nonnegative().optional(),
    rawEnd: z.number().nonnegative().optional(),
    rawCoordinateSystem: timestampCoordinateSystemSchema.optional(),
    mappedStart: z.number().nonnegative().nullable().optional(),
    mappedEnd: z.number().nonnegative().nullable().optional(),
    mappedCoordinateSystem: timestampCoordinateSystemSchema.optional(),
    mappingMethod: timestampMappingMethodSchema.optional(),
    mappingVersion: z.string().min(1).optional(),
    mappingConfidence: z.number().min(0).max(1).optional(),
    textUsable: z.boolean().optional(),
    timingUsable: z.boolean().optional(),
    tokenTimelineStatus: tokenTimelineStatusSchema.optional(),
    tokenTimelineTrustScore: z.number().min(0).max(1).optional(),
    quarantineReasons: z.array(z.string().min(1)).optional(),
    specialToken: z.boolean().optional(),
    boundaryClamped: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.end >= value.start, {
    message: "Token end must be at or after start.",
  })
  .superRefine((value, context) => {
    if (
      value.timingUsable === true &&
      (value.mappedStart === null ||
        value.mappedStart === undefined ||
        value.mappedEnd === null ||
        value.mappedEnd === undefined ||
        value.mappedCoordinateSystem !== "original-media-global" ||
        !value.tokenTimelineStatus?.startsWith("trusted"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["timingUsable"],
        message:
          "A timing-usable token requires trusted mapped original-media-global timestamps.",
      });
    }
  });

export const overlapAcousticSegmentSchema = z
  .object({
    segmentId: z.string().min(1),
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    confidence: z.number().min(0).max(1).nullable(),
    tokenIds: z.array(z.string().min(1)),
    rawStart: z.number().nonnegative().optional(),
    rawEnd: z.number().positive().optional(),
    rawCoordinateSystem: timestampCoordinateSystemSchema.optional(),
    mappedCoordinateSystem: timestampCoordinateSystemSchema.optional(),
    timingUsable: z.boolean().optional(),
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
    runtimeCapabilityRef: z.string().min(1).optional(),
    responseSchemaVersion: z.string().min(1).optional(),
    rawTokens: z
      .array(
        z
          .object({
            tokenId: z.string().min(1),
            parentSegmentId: z.string().min(1),
            text: z.string(),
            special: z.boolean(),
            start: z.number().nonnegative(),
            end: z.number().nonnegative(),
            coordinateSystem: timestampCoordinateSystemSchema,
          })
          .strict(),
      )
      .optional(),
    mappedTokens: z
      .array(
        z
          .object({
            tokenId: z.string().min(1),
            parentSegmentId: z.string().min(1),
            text: z.string(),
            start: z.number().nonnegative(),
            end: z.number().nonnegative(),
            coordinateSystem: z.literal("original-media-global"),
            mappingMethod: z.literal("official-mapped-token-getter"),
            timingUsable: z.boolean(),
          })
          .strict(),
      )
      .optional(),
    rawText: z.string(),
    segments: z.array(overlapAcousticSegmentSchema),
    tokens: z.array(overlapAcousticTokenSchema),
    speechIntervals: z.array(overlapAcousticIntervalSchema),
    timestampIntegrityRef: z.string().min(1).nullable().optional(),
    decodedSegmentIntervals: z
      .array(timestampIntegrityIntervalSchema)
      .optional(),
    mappedTrustedTokenIntervals: z
      .array(timestampIntegrityIntervalSchema)
      .optional(),
    rawVadIntervals: z.array(timestampIntegrityIntervalSchema).optional(),
    sourceCueIntervals: z.array(timestampIntegrityIntervalSchema).optional(),
    metrics: z
      .object({
        durationSeconds: z.number().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
        tokenCount: z.number().int().nonnegative(),
        speechIntervalCount: z.number().int().nonnegative(),
        tokenTimestampsRequested: z.boolean(),
        tokenTimestampsReturned: z.boolean().optional(),
        trustedTokenTimestampsAvailable: z.boolean().optional(),
        trustedTokenTimestampsUsed: z.boolean().optional(),
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
    source: z.enum([
      "token",
      "segment",
      "speech",
      "vad",
      "source",
      "trusted-mapped-token",
      "trusted-no-vad-token",
      "decoded-segment",
      "raw-vad",
      "source-cue",
      "pause",
      "legacy-token-untrusted",
    ]),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    evidenceId: z.string().min(1).optional(),
    timingUsable: z.boolean().optional(),
    timestampTrustStatus: tokenTimelineStatusSchema.optional(),
    timingTrustScore: z.number().min(0).max(1).optional(),
    alignmentScore: z.number().min(0).max(1).optional(),
    parentSegmentContainmentPassed: z.boolean().optional(),
    profileConsensusScore: z.number().min(0).max(1).optional(),
    boundaryConfidence: z.number().min(0).max(1).optional(),
    neighborIntrusionRatio: z.number().min(0).max(1).optional(),
    containmentScore: z.number().min(0).max(1).optional(),
    sourceTypeSupportCount: z.number().int().nonnegative().optional(),
    evidenceLineageId: z.string().min(1).optional(),
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
    trustedMatchedTokenIds: z.array(z.string().min(1)).optional(),
    quarantinedMatchedTokenIds: z.array(z.string().min(1)).optional(),
    individuallyTrustedMatchedTokenIds: z.array(z.string().min(1)).optional(),
    individuallyQuarantinedMatchedTokenIds: z
      .array(z.string().min(1))
      .optional(),
    lexicalOnlySequenceTokenIds: z.array(z.string().min(1)).optional(),
    sequenceTimingUsable: z.boolean().optional(),
    sequenceTimingEvidenceIds: z.array(z.string().min(1)).optional(),
    sequenceQuarantineReasons: z.array(z.string().min(1)).optional(),
    sequenceParentSegmentIds: z.array(z.string().min(1)).optional(),
    trustedMappedTokenEvidenceIds: z.array(z.string().min(1)).optional(),
    trustedRawVadEvidenceIds: z.array(z.string().min(1)).optional(),
    decodedSegmentEvidenceIds: z.array(z.string().min(1)).optional(),
    timingEvidenceLineageIds: z.array(z.string().min(1)).optional(),
    trustedTimingEvidenceIds: z.array(z.string().min(1)).optional(),
    lexicalOnlyEvidenceIds: z.array(z.string().min(1)).optional(),
    trustedTimingProfileSupportCount: z.number().int().nonnegative().optional(),
    trustedTimingSourceTypeCount: z.number().int().nonnegative().optional(),
    trustedTimingModelSupportCount: z.number().int().nonnegative().optional(),
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
  .strict()
  .superRefine((value, context) => {
    const individuallyQuarantined = new Set(
      value.individuallyQuarantinedMatchedTokenIds ?? [],
    );
    if (
      (value.trustedMappedTokenEvidenceIds ?? []).some((id) =>
        individuallyQuarantined.has(id),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["trustedMappedTokenEvidenceIds"],
        message:
          "Individually quarantined tokens cannot enter timing evidence.",
      });
    }
    if (
      value.sequenceTimingUsable === true &&
      ((value.sequenceTimingEvidenceIds?.length ?? 0) === 0 ||
        (value.sequenceParentSegmentIds?.length ?? 0) !== 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sequenceTimingUsable"],
        message:
          "A timing-usable selected sequence must have evidence and exactly one parent segment.",
      });
    }
  });

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
    rawVadBoundaryRelation: z
      .enum([
        "pause-supported",
        "continuous-speech-island",
        "conflicting",
        "unavailable",
      ])
      .optional(),
    rawVadProfileSupportCount: z.number().int().nonnegative().optional(),
    rawVadBoundaryEvidenceIds: z.array(z.string().min(1)).optional(),
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
    boundarySource: z.enum([
      "token",
      "speech",
      "vad",
      "source",
      "pause",
      "trusted-mapped-token",
      "trusted-no-vad-token",
      "decoded-segment",
      "raw-vad",
      "source-cue",
    ]),
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
    bestHypothesis: z
      .enum([
        "ordered-no-overlap",
        "rapid-turn-taking",
        "nested-background-foreground",
        "true-simultaneous-speech",
        "same-utterance-alternative",
      ])
      .optional(),
    bestHypothesisScore: z.number().min(0).max(1).optional(),
    runnerUpHypothesis: z
      .enum([
        "ordered-no-overlap",
        "rapid-turn-taking",
        "nested-background-foreground",
        "true-simultaneous-speech",
        "same-utterance-alternative",
      ])
      .nullable()
      .optional(),
    runnerUpHypothesisScore: z.number().min(0).max(1).nullable().optional(),
    decisionMargin: z.number().min(0).max(1).optional(),
    scoreCalibrationStatus: z
      .enum(["uncalibrated-heuristic", "holdout-calibrated"])
      .optional(),
    timestampIntegrityGateFailures: z.array(z.string().min(1)).optional(),
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
    resolutionVersion: z.enum(["C5.15", "C5.15.1", "C5.16"]),
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
        minimumDecisionMargin: z.number().min(0).max(1).optional(),
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
        trustedTokenCount: z.number().int().nonnegative().optional(),
        quarantinedTokenCount: z.number().int().nonnegative().optional(),
        untrustedTokenUsedForTimingCount: z.literal(0).optional(),
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
