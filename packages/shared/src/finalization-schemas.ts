import { z } from "zod";

import { schemaVersionSchema, subtitleCueSchema } from "./schemas.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const relativePathSchema = z
  .string()
  .min(1)
  .regex(/^(?!\/)(?![A-Za-z]:[\\/]).+/u, "Path must be relative.");

export const finalizationModeSchema = z.enum([
  "auto",
  "review-fallback",
  "human",
]);

export const finalizationStatusSchema = z.enum([
  "machine-draft",
  "auto-validated",
  "human-validated",
  "mixed-validated",
  "needs-review",
  "rejected",
]);

export const finalizationMethodSchema = z.enum([
  "none",
  "automatic",
  "human",
  "mixed",
]);

export const candidateAssociationTypeSchema = z.enum([
  "EXACT_TARGET",
  "PROBABLE_TARGET",
  "BROAD_WINDOW_ASSOCIATION",
  "AMBIGUOUS_ASSOCIATION",
  "UNASSOCIATED",
]);

export const cueDecisionActionSchema = z.enum([
  "KEEP",
  "REPLACE",
  "EXPAND",
  "SPLIT",
  "MERGE",
  "REDISTRIBUTE",
  "DELETE_HALLUCINATION",
  "TIMING_ONLY",
  "REVIEW_ONLY",
]);

export const subtitleIntervalSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((interval) => interval.end > interval.start, {
    message: "Interval end must be greater than start.",
  });

export const candidateCoverageMetricsSchema = z
  .object({
    existingCuePreservationRatio: z.number().min(0).max(1),
    candidateCoverageRatio: z.number().min(0).max(1),
    contentOmissionRatio: z.number().min(0).max(1),
    contentAdditionRatio: z.number().min(0).max(1),
    neighborCueIntrusionRatio: z.number().min(0).max(1),
    localSpeechCoverageRatio: z.number().min(0).max(1),
    coverageMethod: z.literal("heuristic"),
    semanticSimilarity: z.null(),
  })
  .strict();

export const finalizationCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    targetCueIds: z.array(z.string().min(1)).min(1),
    candidateText: z.string().min(1),
    candidateInterval: subtitleIntervalSchema,
    localInterval: subtitleIntervalSchema.nullable(),
    associationType: candidateAssociationTypeSchema,
    associationScore: z.number().min(0).max(1).nullable(),
    associationMargin: z.number().min(0).max(1).nullable(),
    sourceEvidenceIds: z.array(z.string().min(1)),
    sourceRequestIds: z.array(z.string().min(1)),
    sourceProfileIds: z.array(z.string().min(1)),
    independentSupportCount: z.number().int().nonnegative(),
    coverageMetrics: candidateCoverageMetricsSchema,
    directAcousticSupport: z.boolean(),
    partialFragment: z.boolean(),
    timingResolved: z.boolean(),
    languageIntegrityPassed: z.boolean(),
    hallucinationQaPassed: z.boolean(),
    repetitionQaPassed: z.boolean(),
    presentationQaPassed: z.boolean(),
    requestedAction: cueDecisionActionSchema,
    automaticMutationEligible: z.boolean(),
    requiresHumanReview: z.boolean(),
    blockers: z.array(z.string().min(1)),
  })
  .strict();

export const proposedCueSchema = z
  .object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    text: z.string().min(1),
  })
  .strict()
  .refine((cue) => cue.end > cue.start, {
    message: "Proposed cue end must be greater than start.",
  });

export const cueDecisionSchema = z
  .object({
    decisionId: z.string().min(1),
    targetCueIds: z.array(z.string().min(1)).min(1),
    action: cueDecisionActionSchema,
    currentText: z.string(),
    proposedText: z.string().nullable(),
    proposedCues: z.array(proposedCueSchema),
    selectedCandidateId: z.string().min(1).nullable(),
    alternativeCandidateIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
    automaticMutationEligible: z.boolean(),
    requiresHumanReview: z.boolean(),
    decisionReasons: z.array(z.string().min(1)),
  })
  .strict();

export const finalizationFindingSchema = z
  .object({
    findingId: z.string().min(1),
    severity: z.enum(["blocking", "warning"]),
    code: z.string().min(1),
    cueIds: z.array(z.string().min(1)),
    message: z.string().min(1),
  })
  .strict();

export const finalizationThresholdsSchema = z
  .object({
    minimumAssociationScore: z.number().min(0).max(1),
    minimumAssociationMargin: z.number().min(0).max(1),
    minimumIndependentSupport: z.number().int().positive(),
    minimumExistingCuePreservation: z.number().min(0).max(1),
    minimumCandidateCoverage: z.number().min(0).max(1),
    maximumContentOmission: z.number().min(0).max(1),
    maximumContentAddition: z.number().min(0).max(1),
    maximumNeighborCueIntrusion: z.number().min(0).max(1),
    minimumLocalSpeechCoverage: z.number().min(0).max(1),
  })
  .strict();

export const finalizationMetricsSchema = z
  .object({
    machineCueCount: z.number().int().nonnegative(),
    automaticDecisionCount: z.number().int().nonnegative(),
    safeAutomaticMutationCount: z.number().int().nonnegative(),
    suggestionOnlyCount: z.number().int().nonnegative(),
    blockingFindingCount: z.number().int().nonnegative(),
    unresolvedCount: z.number().int().nonnegative(),
    reviewItemCount: z.number().int().nonnegative(),
    humanDecisionCount: z.number().int().nonnegative(),
    finalCueCount: z.number().int().nonnegative(),
    unsafeMutationCount: z.number().int().nonnegative(),
    multiDecisionConflictCount: z.number().int().nonnegative(),
    substringReplacementViolationCount: z.number().int().nonnegative(),
    broadWindowVisibleMutationCount: z.number().int().nonnegative(),
    ambiguousVisibleMutationCount: z.number().int().nonnegative(),
    localIntervalMissingVisibleMutationCount: z.number().int().nonnegative(),
    fullCueFragmentReplacementCount: z.number().int().nonnegative(),
    formatParityErrorCount: z.number().int().nonnegative(),
    /** @deprecated C5.14 reports this as an alias of autoResolvedCueRate. */
    automaticCueRate: z.number().min(0).max(1),
    /** Unique final cues without a final blocking finding / final cue count. */
    nonBlockingCueRate: z.number().min(0).max(1).default(0),
    /** Unchanged baseline cues with no structural decision / final cue count. */
    passiveBaselineAcceptanceRate: z.number().min(0).max(1).default(0),
    /** Unique cues whose blocker was closed by a safe structural decision. */
    autoResolvedCueRate: z.number().min(0).max(1).default(0),
    /** Unique cues with a canonical lexical or timing mutation. */
    autoMutationCueRate: z.number().min(0).max(1).default(0),
    /** Unique cues resolved by display-only layout / final cue count. */
    presentationAutoResolvedCueRate: z.number().min(0).max(1).default(0),
    /** Unique cues preserved as intentional repetition / final cue count. */
    intentionalRepetitionResolvedCueRate: z.number().min(0).max(1).default(0),
    /** Unique cues in evidence-supported legal overlaps / final cue count. */
    legalOverlapCueRate: z.number().min(0).max(1).default(0),
    /** Cues supplied by the user-confirmed human baseline / final cue count. */
    humanBaselineCueRate: z.number().min(0).max(1).default(0),
    manualReviewCueRate: z.number().min(0).max(1),
    blockingCueRate: z.number().min(0).max(1),
    characterCorrectionRate: z.number().min(0).max(1),
    timingCorrectionRate: z.number().min(0).max(1),
    terminologyCorrectionRate: z.number().min(0).max(1),
    dialectCorrectionRate: z.number().min(0).max(1),
    hallucinationRejectionCount: z.number().int().nonnegative(),
    overlapComponentCount: z.number().int().nonnegative().default(0),
    overlapAcousticAnalyzedCount: z.number().int().nonnegative().default(0),
    overlapAcousticResolvedCount: z.number().int().nonnegative().default(0),
    overlapTimingOnlyResolvedCount: z.number().int().nonnegative().default(0),
    legalOverlapResolvedCount: z.number().int().nonnegative().default(0),
    unresolvedOverlapCount: z.number().int().nonnegative().default(0),
    overlapAsrRequestCount: z.number().int().nonnegative().default(0),
    overlapAsrCacheHitCount: z.number().int().nonnegative().default(0),
    overlapWorkerStartCount: z.number().int().nonnegative().default(0),
    overlapModelLoadCount: z.number().int().nonnegative().default(0),
    overlapWarmupCount: z.number().int().nonnegative().default(0),
    wholeMediaAsrRequestCount: z.number().int().nonnegative().default(0),
    automaticStructuralDecisionCount: z.number().int().nonnegative().default(0),
    automaticCanonicalMutationDecisionCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    automaticTimingMutationDecisionCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    reviewAudioCoverageFailureCount: z.number().int().nonnegative().default(0),
    reviewAudioPhysicalFileCount: z.number().int().nonnegative().default(0),
    reviewAudioReferencedCount: z.number().int().nonnegative().default(0),
    reviewAudioPlayableCount: z.number().int().nonnegative().default(0),
    reviewAudioReusedExistingCount: z.number().int().nonnegative().default(0),
    reviewAudioReusedOverlapCount: z.number().int().nonnegative().default(0),
    reviewAudioGeneratedCount: z.number().int().nonnegative().default(0),
    reviewAudioHashMismatchCount: z.number().int().nonnegative().default(0),
    reviewAudioMetadataFailureCount: z.number().int().nonnegative().default(0),
    mappedTokenEvidenceCount: z.number().int().nonnegative().default(0),
    rawVadEvidenceCount: z.number().int().nonnegative().default(0),
    decodedSegmentEvidenceCount: z.number().int().nonnegative().default(0),
    mappedTokenBoundaryCopiedFromEvidenceDpCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    unresolvedEvidenceReferenceCount: z.number().int().nonnegative().default(0),
    rootReviewDataMismatchCount: z.number().int().nonnegative().default(0),
    finalizationReviewMetricMismatchCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    reviewPageBrokenAudioReferenceCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    reviewDeliveryIntegrityPassed: z.boolean().default(false),
    forcedAlignmentAnalyzedCueCount: z.number().int().nonnegative().default(0),
    forcedAlignmentAttemptCount: z.number().int().nonnegative().default(0),
    forcedAlignmentCacheHitCount: z.number().int().nonnegative().default(0),
    forcedAlignmentMfaProcessCount: z.number().int().nonnegative().default(0),
    forcedAlignmentResolvedComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    forcedAlignmentUnresolvedComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    untrustedForcedAlignmentTimingUseCount: z.literal(0).default(0),
    speakerTargetComponentCount: z.number().int().nonnegative().default(0),
    speakerTargetCueCount: z.number().int().nonnegative().default(0),
    speakerInferenceCount: z.number().int().nonnegative().default(0),
    speakerCacheHitCount: z.number().int().nonnegative().default(0),
    speakerModelLoadCount: z.number().int().nonnegative().default(0),
    speakerStableComponentCount: z.number().int().nonnegative().default(0),
    speakerResolvedComponentCount: z.number().int().nonnegative().default(0),
    speakerPresentationOnlyComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    speakerTimingOnlyComponentCount: z.number().int().nonnegative().default(0),
    speakerUnresolvedComponentCount: z.number().int().nonnegative().default(0),
    duplicateSpeakerEvidenceLineageCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    speakerEvidenceDoubleCountPreventedCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    speakerConfidenceFabricatedCount: z.literal(0).default(0),
    crossComponentSpeakerLinkCount: z.literal(0).default(0),
    realPersonIdentificationCount: z.literal(0).default(0),
    rawEmbeddingInShareableCount: z.literal(0).default(0),
    forbiddenSpeakerIdentityEvidenceUseCount: z.literal(0).default(0),
    forbiddenSpeakerTimingHeuristicUseCount: z.literal(0).default(0),
    ctcTargetCueCount: z.number().int().nonnegative().default(0),
    ctcTargetEncodableCueCount: z.number().int().nonnegative().default(0),
    ctcDirectAttemptCount: z.number().int().nonnegative().default(0),
    ctcDirectInferenceCount: z.number().int().nonnegative().default(0),
    ctcDirectCacheHitCount: z.number().int().nonnegative().default(0),
    ctcModelLoadCount: z.number().int().nonnegative().default(0),
    ctcPathSuccessCount: z.number().int().nonnegative().default(0),
    ctcWindowStableCueCount: z.number().int().nonnegative().default(0),
    ctcEdgePinnedCueCount: z.number().int().nonnegative().default(0),
    ctcDuplicateOccurrenceConflictCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    ctcJointAssignmentResolvedComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    ctcTimingActionableCueCount: z.number().int().nonnegative().default(0),
    ctcTimingActionableComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    ctcTimingMutationCueCount: z.number().int().nonnegative().default(0),
    ctcTimingMutationComponentCount: z.number().int().nonnegative().default(0),
    ctcResolvedSubtitleOverlapComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    ctcGreedyTextMutationCount: z.literal(0).default(0),
    ctcTokenRatioRepairCount: z.literal(0).default(0),
    separationTriggeredComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    separationInferenceCount: z.number().int().nonnegative().default(0),
    separationCacheHitCount: z.number().int().nonnegative().default(0),
    separatedStreamCtcAttemptCount: z.number().int().nonnegative().default(0),
    speakerRelationshipResolvedComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
    subtitleOverlapResolvedComponentCount: z
      .number()
      .int()
      .nonnegative()
      .default(0),
  })
  .strict();

export const humanReviewedBaselineSchema = z
  .object({
    authority: z.literal("user-confirmed-human-review"),
    sourceFileName: z.string().min(1),
    sourceFileSha256: hashSchema,
    sourceFileSize: z.number().int().nonnegative(),
    format: z.literal("ass"),
    cueCount: z.number().int().positive(),
    cueHash: hashSchema,
    timestampNormalizationCount: z.number().int().nonnegative(),
    effectivePackagePath: relativePathSchema,
    sourceReadOnlyVerified: z.boolean(),
  })
  .strict();

export const subtitleFinalizationReportSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    reportType: z.literal("subtitle-finalization-report"),
    finalizationVersion: z.string().min(1),
    generatedAt: z.string().min(1),
    mode: finalizationModeSchema,
    status: finalizationStatusSchema,
    finalizationMethod: finalizationMethodSchema,
    baseSubtitlePackageHash: hashSchema,
    baseCueHash: hashSchema,
    inputEvidenceHash: hashSchema,
    outputCueHash: hashSchema,
    outputHash: hashSchema,
    humanReviewedBaseline: humanReviewedBaselineSchema.nullable().default(null),
    thresholds: finalizationThresholdsSchema,
    decisions: z.array(cueDecisionSchema),
    findings: z.array(finalizationFindingSchema),
    metrics: finalizationMetricsSchema,
    qualityGate: z
      .object({
        passed: z.boolean(),
        finalIntegrityPassed: z.boolean(),
        serializationRoundTripPassed: z.boolean(),
        formatSemanticParityPassed: z.boolean(),
        canonicalParityPassed: z.boolean().default(true),
        presentationParityPassed: z.boolean().default(true),
        reviewDeliveryIntegrityPassed: z.boolean().default(false),
        rollbackApplied: z.boolean(),
        sourceReadOnlyVerified: z.boolean(),
        serializedSrtContainsOverlap: z.boolean().default(false),
        legalSrtOverlapRenderingMayVary: z.boolean().default(false),
        unresolvedSrtOverlapPresent: z.boolean().default(false),
        /** @deprecated Alias of serializedSrtContainsOverlap. */
        srtOverlapRenderingMayVary: z.boolean().default(false),
        blockingCodes: z.array(z.string().min(1)),
        warningCodes: z.array(z.string().min(1)),
      })
      .strict(),
    outputPaths: z
      .object({
        srt: relativePathSchema,
        vtt: relativePathSchema,
        ass: relativePathSchema,
        subtitlePackage: relativePathSchema,
        reviewPackage: relativePathSchema.nullable(),
        reviewPage: relativePathSchema.nullable(),
        reviewDeliveryIntegrity: relativePathSchema.nullable().default(null),
        correctionFeedback: relativePathSchema.nullable(),
        presentationResolution: relativePathSchema.nullable().default(null),
        overlapAcousticResolution: relativePathSchema.nullable().default(null),
        overlapWhisperExecutionMetrics: relativePathSchema
          .nullable()
          .default(null),
        canonicalAlignmentInput: relativePathSchema.nullable().default(null),
        canonicalForcedAlignment: relativePathSchema.nullable().default(null),
        forcedAlignmentRuntimeCapability: relativePathSchema
          .nullable()
          .default(null),
        forcedAlignmentCacheManifest: relativePathSchema
          .nullable()
          .default(null),
        canonicalPronunciation: relativePathSchema.nullable().default(null),
        sudachiRuntimeCapability: relativePathSchema.nullable().default(null),
        speakerRuntimeCapability: relativePathSchema.nullable().default(null),
        localSpeakerEvidence: relativePathSchema.nullable().default(null),
        speakerEvidenceCacheManifest: relativePathSchema
          .nullable()
          .default(null),
        ctcRuntimeCapability: relativePathSchema.nullable().default(null),
        ctcAlignmentInput: relativePathSchema.nullable().default(null),
        localCtcBoundaryEvidence: relativePathSchema.nullable().default(null),
        ctcAlignmentCacheManifest: relativePathSchema.nullable().default(null),
        localSeparatedStreamEvidence: relativePathSchema
          .nullable()
          .default(null),
        reviewActionValidationReport: relativePathSchema
          .nullable()
          .default(null),
        subtitledVideo: relativePathSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const reviewCueContextSchema = z
  .object({
    cueId: z.string().min(1),
    text: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict();

export const sourceFingerprintSchema = z
  .object({
    fileName: z.string().min(1),
    size: z.number().int().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    sha256: hashSchema,
  })
  .strict();

export const reviewBoundaryEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceLineageId: z.string().min(1),
    sourceType: z.enum([
      "mfa-narrow",
      "mfa-expanded",
      "evidence-dp",
      "trusted-mapped-token",
      "trusted-no-vad-token",
      "raw-vad",
      "decoded-segment",
      "source-cue-prior",
      "forced-alignment-selected",
      "pause",
    ]),
    scope: z.enum(["cue", "pair", "component"]),
    cueIds: z.array(z.string().min(1)),
    componentId: z.string().min(1),
    interval: subtitleIntervalSchema,
    sideSupport: z.enum(["start", "end", "both", "none"]),
    timingUsable: z.boolean(),
    acousticEvidence: z.boolean().default(true),
    trustScore: z.number().min(0).max(1).nullable(),
    alignmentScore: z.number().min(0).max(1).nullable(),
    boundaryConfidence: z.number().min(0).max(1).nullable(),
    neighborIntrusionRatio: z.number().min(0).max(1).nullable(),
    profile: z.string().min(1).nullable(),
    attemptId: z.string().min(1).nullable(),
    parentSegmentId: z.string().min(1).nullable(),
    selectedBoundarySource: z.string().min(1).nullable().default(null),
    windowType: z.string().min(1).nullable().default(null),
    wordInterval: subtitleIntervalSchema.nullable().default(null),
    phoneInterval: subtitleIntervalSchema.nullable().default(null),
    startPinnedToWindowEdge: z.boolean().nullable().default(null),
    endPinnedToWindowEdge: z.boolean().nullable().default(null),
    wordCoverageRatio: z.number().min(0).max(1).nullable().default(null),
    phoneCoverageRatio: z.number().min(0).max(1).nullable().default(null),
    readingCoverageRatio: z.number().min(0).max(1).nullable().default(null),
    rawInterval: subtitleIntervalSchema.nullable().default(null),
    normalizedInterval: subtitleIntervalSchema.nullable().default(null),
    healthStatus: z.string().min(1).nullable().default(null),
    normalizationApplied: z.boolean().nullable().default(null),
    normalizationDeltaStart: z.number().nonnegative().nullable().default(null),
    normalizationDeltaEnd: z.number().nonnegative().nullable().default(null),
    sourceArtifactType: z.string().min(1),
    sourceArtifactHash: hashSchema,
    sourceObjectId: z.string().min(1),
    blockers: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  })
  .strict();

export const subtitleReviewItemSchema = z
  .object({
    reviewId: z.string().min(1),
    targetCueIds: z.array(z.string().min(1)).min(1),
    interval: subtitleIntervalSchema,
    currentText: z.string(),
    currentStart: z.number().nonnegative(),
    currentEnd: z.number().positive(),
    currentStyle: z.enum(["default", "thought", "music"]),
    currentSpeaker: z.string().min(1).nullable(),
    previousCue: reviewCueContextSchema.nullable(),
    nextCue: reviewCueContextSchema.nullable(),
    machineDecision: cueDecisionSchema,
    candidateSuggestions: z.array(finalizationCandidateSchema),
    candidateActionBindings: z
      .array(
        z
          .object({
            candidateId: z.string().min(1),
            reviewId: z.string().min(1),
            candidateEvidenceHash: hashSchema,
            reviewVersion: z.string().min(1),
            status: z.enum(["active", "stale", "revoked", "deleted"]),
          })
          .strict(),
      )
      .default([]),
    findingIds: z.array(z.string().min(1)),
    speakerEvidenceComponentId: z.string().min(1).nullable().default(null),
    ctcBoundaryEvidenceComponentId: z.string().min(1).nullable().default(null),
    blockers: z.array(z.string().min(1)),
    allowedHumanActions: z.array(
      z.enum([
        "KEEP",
        "ACCEPT_SUGGESTION",
        "EDIT_TEXT",
        "REJECT_SUGGESTION",
        "SPLIT_CUE",
        "MERGE_CUES",
        "EDIT_TIMING",
        "DELETE_CUE",
        "MARK_UNRESOLVED",
      ]),
    ),
    audioClipPath: relativePathSchema.nullable(),
    audioError: z.string().min(1).nullable(),
    audioSource: z
      .enum([
        "generated-from-source-video",
        "reused-existing-review-audio",
        "reused-overlap-audio",
        "inherited-verified-review-audio",
        "disabled-by-user",
        "unavailable",
      ])
      .default("unavailable"),
    audioValidationStatus: z
      .enum([
        "validated",
        "hash-mismatch",
        "coverage-incomplete",
        "invalid-wav",
        "source-missing",
        "disabled",
        "unavailable",
      ])
      .default("unavailable"),
    audioSourceArtifact: z.string().min(1).nullable().default(null),
    audioSourceAudioPath: relativePathSchema.nullable().default(null),
    audioSourceComponentId: z.string().min(1).nullable().default(null),
    audioSourceEvidenceLineageIds: z.array(z.string().min(1)).default([]),
    audioHandoffMethod: z
      .enum(["existing", "copy", "hardlink", "generated", "none"])
      .default("none"),
    componentUnionInterval: subtitleIntervalSchema.optional(),
    audioRequestedInterval: subtitleIntervalSchema.nullable().default(null),
    audioExtractedInterval: subtitleIntervalSchema.nullable().default(null),
    audioDurationSeconds: z.number().nonnegative().nullable().default(null),
    audioActualDurationSeconds: z
      .number()
      .nonnegative()
      .nullable()
      .default(null),
    audioSampleRate: z.number().int().positive().nullable().default(null),
    audioChannelCount: z.number().int().positive().nullable().default(null),
    audioBitsPerSample: z.number().int().positive().nullable().default(null),
    audioFrameCount: z.number().int().nonnegative().nullable().default(null),
    audioInspectionMethod: z.string().min(1).nullable().default(null),
    audioSha256: hashSchema.nullable().default(null),
    audioContextSeconds: z.number().nonnegative().default(0),
    audioContextBeforeSeconds: z.number().nonnegative().default(0),
    audioContextAfterSeconds: z.number().nonnegative().default(0),
    audioFullyCoversComponent: z.boolean().default(false),
    boundaryEvidence: z.array(reviewBoundaryEvidenceSchema).default([]),
    componentRawVadIntervals: z.array(reviewBoundaryEvidenceSchema).default([]),
    componentDecodedSegments: z.array(reviewBoundaryEvidenceSchema).default([]),
    componentMappedTokenEvidence: z
      .array(reviewBoundaryEvidenceSchema)
      .default([]),
    componentPauseEvidence: z.array(reviewBoundaryEvidenceSchema).default([]),
    evidenceReconciliationHash: hashSchema.nullable().default(null),
    evidenceSourceResolutionStatus: z
      .enum(["legacy", "resolved", "partial", "unresolved"])
      .default("legacy"),
    unresolvedEvidenceReferences: z.array(z.string().min(1)).default([]),
    forcedAlignmentEvidence: z
      .object({
        disclaimer: z.literal(
          "MFA boundaries are machine evidence, not confirmed ground truth.",
        ),
        componentId: z.string().min(1),
        cues: z.array(
          z
            .object({
              cueId: z.string().min(1),
              canonicalText: z.string().min(1),
              alignmentText: z.string().min(1),
              normalizedReading: z.string().min(1).nullable(),
              unresolvedOov: z.array(z.string().min(1)),
              originalTiming: subtitleIntervalSchema,
              suggestedTiming: subtitleIntervalSchema.nullable(),
              mfaNarrowBoundary: subtitleIntervalSchema.nullable(),
              mfaExpandedBoundary: subtitleIntervalSchema.nullable(),
              evidenceDpBoundary: subtitleIntervalSchema.nullable(),
              mappedTokenBoundary: subtitleIntervalSchema.nullable(),
              rawVadBoundary: subtitleIntervalSchema.nullable(),
              windowStabilityScore: z.number().min(0).max(1),
              wordCoverageRatio: z.number().min(0).max(1),
              phoneCoverageRatio: z.number().min(0).max(1),
              readingCoverageRatio: z.number().min(0).max(1),
              antiForcingBlockers: z.array(z.string().min(1)),
            })
            .strict(),
        ),
        bestHypothesis: z.string().min(1),
        runnerUpHypothesis: z.string().min(1),
        decisionMargin: z.number().min(0).max(1),
        duplicateOccurrenceConflictCount: z.number().int().nonnegative(),
        blocking: z.boolean(),
      })
      .strict()
      .optional(),
    requiresHumanReview: z.boolean(),
  })
  .strict();

export const subtitleReviewPackageSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    packageType: z.literal("multilingual-subtitle-review-package"),
    reviewVersion: z.string().min(1),
    generatedAt: z.string().min(1),
    sourceFingerprint: sourceFingerprintSchema,
    baseSubtitlePackagePath: relativePathSchema,
    baseSubtitlePackageHash: hashSchema,
    baseCueHash: hashSchema,
    inputEvidenceHash: hashSchema,
    evidenceReconciliationHash: hashSchema.nullable().default(null),
    evidenceReconciliationStatus: z
      .enum(["legacy", "observed", "enforced"])
      .default("legacy"),
    deliveryIntegrityPolicyVersion: z.string().min(1).nullable().default(null),
    reviewActionPolicyVersion: z.string().min(1).nullable().default(null),
    speakerEvidenceArtifactPath: relativePathSchema.nullable().default(null),
    speakerEvidenceArtifactHash: hashSchema.nullable().default(null),
    speakerRuntimeIdentityHash: hashSchema.nullable().default(null),
    speakerModelSnapshotHash: hashSchema.nullable().default(null),
    speakerEvidencePolicyVersion: z.string().min(1).nullable().default(null),
    speakerAssignmentHash: hashSchema.nullable().default(null),
    speakerRelationshipHash: hashSchema.nullable().default(null),
    ctcBoundaryEvidenceArtifactPath: relativePathSchema
      .nullable()
      .default(null),
    ctcBoundaryEvidenceArtifactHash: hashSchema.nullable().default(null),
    ctcRuntimeIdentityHash: hashSchema.nullable().default(null),
    ctcModelSnapshotHash: hashSchema.nullable().default(null),
    ctcAlignmentInputHash: hashSchema.nullable().default(null),
    ctcEvidenceHash: hashSchema.nullable().default(null),
    ctcPolicyVersion: z.string().min(1).nullable().default(null),
    ctcJointAssignmentHash: hashSchema.nullable().default(null),
    sourceSeparationEvidenceHash: hashSchema.nullable().default(null),
    items: z.array(subtitleReviewItemSchema),
    summary: z
      .object({
        itemCount: z.number().int().nonnegative(),
        mandatoryItemCount: z.number().int().nonnegative(),
        audioClipCount: z.number().int().nonnegative(),
        audioFailureCount: z.number().int().nonnegative(),
        audioCoverageFailureCount: z.number().int().nonnegative().default(0),
        audioPhysicalFileCount: z.number().int().nonnegative().default(0),
        audioReferencedCount: z.number().int().nonnegative().default(0),
        audioPlayableCount: z.number().int().nonnegative().default(0),
        audioReusedExistingCount: z.number().int().nonnegative().default(0),
        audioReusedOverlapCount: z.number().int().nonnegative().default(0),
        audioGeneratedCount: z.number().int().nonnegative().default(0),
        audioHashMismatchCount: z.number().int().nonnegative().default(0),
        audioMetadataFailureCount: z.number().int().nonnegative().default(0),
        mappedTokenEvidenceCount: z.number().int().nonnegative().default(0),
        rawVadEvidenceCount: z.number().int().nonnegative().default(0),
        decodedSegmentEvidenceCount: z.number().int().nonnegative().default(0),
        mappedTokenBoundaryCopiedFromEvidenceDpCount: z
          .number()
          .int()
          .nonnegative()
          .default(0),
        unresolvedEvidenceReferenceCount: z
          .number()
          .int()
          .nonnegative()
          .default(0),
      })
      .strict(),
  })
  .strict();

export const humanActionSchema = z.enum([
  "KEEP",
  "ACCEPT_SUGGESTION",
  "EDIT_TEXT",
  "REJECT_SUGGESTION",
  "SPLIT_CUE",
  "MERGE_CUES",
  "EDIT_TIMING",
  "DELETE_CUE",
  "MARK_UNRESOLVED",
]);

const humanSplitPartSchema = z
  .object({
    text: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .strict()
  .refine((part) => part.end > part.start, {
    message: "Split part end must be greater than start.",
  });

export const humanReviewResolutionSchema = z
  .object({
    resolutionId: z.string().min(1),
    reviewId: z.string().min(1),
    action: humanActionSchema,
    selectedCandidateId: z.string().min(1).nullable(),
    selectedCandidateEvidenceHash: hashSchema.nullable().optional(),
    correctedText: z.string().min(1).nullable(),
    start: z.number().nonnegative().nullable(),
    end: z.number().positive().nullable(),
    splitParts: z.array(humanSplitPartSchema),
    mergeCueIds: z.array(z.string().min(1)),
    reviewerNotes: z.string().min(1).nullable(),
    errorTypes: z.array(
      z.enum([
        "DIALECT_ERROR",
        "CHARACTER_NAME_ERROR",
        "DOMAIN_TERM_ERROR",
        "KANJI_SELECTION_ERROR",
        "VERB_ENDING_ERROR",
        "PARTICLE_ERROR",
        "MISSING_TEXT",
        "EXTRA_TEXT",
        "HALLUCINATION",
        "FRAGMENT_ERROR",
        "SEGMENTATION_ERROR",
        "TIMING_ERROR",
        "SPEAKER_ERROR",
        "STYLE_ERROR",
        "OTHER",
      ]),
    ),
    confirmedReading: z.string().min(1).nullable(),
    terminologyHints: z.array(z.string().min(1)),
    dialectHints: z.array(z.string().min(1)),
  })
  .strict();

export const humanReviewResolutionsSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    resolutionType: z.literal("human-review-resolutions"),
    reviewVersion: z.string().min(1),
    sourceFingerprint: sourceFingerprintSchema,
    baseSubtitlePackageHash: hashSchema,
    baseCueHash: hashSchema,
    inputEvidenceHash: hashSchema,
    resolutions: z.array(humanReviewResolutionSchema),
  })
  .strict();

export const correctionFeedbackRecordSchema = z
  .object({
    feedbackId: z.string().min(1),
    mediaIdentity: z
      .object({
        title: z.string().min(1).nullable(),
        season: z.number().int().positive().nullable(),
        episode: z.number().int().positive().nullable(),
        year: z.number().int().min(1888).max(2200).nullable(),
      })
      .strict(),
    audioInterval: subtitleIntervalSchema,
    sceneLabel: z.string().min(1).nullable(),
    speaker: z.string().min(1).nullable(),
    machineText: z.string(),
    correctedText: z.string(),
    machineDecision: cueDecisionSchema,
    selectedCandidate: finalizationCandidateSchema.nullable(),
    alternativeCandidates: z.array(finalizationCandidateSchema),
    errorTypes: humanReviewResolutionSchema.shape.errorTypes,
    confirmedReading: z.string().min(1).nullable(),
    terminologyHints: z.array(z.string().min(1)),
    dialectHints: z.array(z.string().min(1)),
    sourceEvidenceIds: z.array(z.string().min(1)),
    reviewerNotes: z.string().min(1).nullable(),
  })
  .strict();

export const correctionFeedbackSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    feedbackType: z.literal("subtitle-correction-feedback"),
    sourceFingerprintHash: hashSchema,
    records: z.array(correctionFeedbackRecordSchema),
  })
  .strict();

export const strictFinalCueSchema = subtitleCueSchema;

export type FinalizationMode = z.infer<typeof finalizationModeSchema>;
export type FinalizationStatus = z.infer<typeof finalizationStatusSchema>;
export type FinalizationMethod = z.infer<typeof finalizationMethodSchema>;
export type FinalizationCandidate = z.infer<typeof finalizationCandidateSchema>;
export type CandidateCoverageMetrics = z.infer<
  typeof candidateCoverageMetricsSchema
>;
export type CueDecision = z.infer<typeof cueDecisionSchema>;
export type FinalizationFinding = z.infer<typeof finalizationFindingSchema>;
export type FinalizationThresholds = z.infer<
  typeof finalizationThresholdsSchema
>;
export type HumanReviewedBaseline = z.infer<typeof humanReviewedBaselineSchema>;
export type SubtitleFinalizationReport = z.infer<
  typeof subtitleFinalizationReportSchema
>;
export type SubtitleReviewPackage = z.infer<typeof subtitleReviewPackageSchema>;
export type ReviewBoundaryEvidence = z.infer<
  typeof reviewBoundaryEvidenceSchema
>;
export type SourceFingerprint = z.infer<typeof sourceFingerprintSchema>;
export type HumanReviewResolutions = z.infer<
  typeof humanReviewResolutionsSchema
>;
export type CorrectionFeedback = z.infer<typeof correctionFeedbackSchema>;
export type HumanReviewResolution = z.infer<typeof humanReviewResolutionSchema>;
