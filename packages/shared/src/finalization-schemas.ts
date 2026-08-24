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
    automaticCueRate: z.number().min(0).max(1),
    manualReviewCueRate: z.number().min(0).max(1),
    blockingCueRate: z.number().min(0).max(1),
    characterCorrectionRate: z.number().min(0).max(1),
    timingCorrectionRate: z.number().min(0).max(1),
    terminologyCorrectionRate: z.number().min(0).max(1),
    dialectCorrectionRate: z.number().min(0).max(1),
    hallucinationRejectionCount: z.number().int().nonnegative(),
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
        rollbackApplied: z.boolean(),
        sourceReadOnlyVerified: z.boolean(),
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
        correctionFeedback: relativePathSchema.nullable(),
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
    findingIds: z.array(z.string().min(1)),
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
    items: z.array(subtitleReviewItemSchema),
    summary: z
      .object({
        itemCount: z.number().int().nonnegative(),
        mandatoryItemCount: z.number().int().nonnegative(),
        audioClipCount: z.number().int().nonnegative(),
        audioFailureCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const humanActionSchema = z.enum([
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
export type SubtitleFinalizationReport = z.infer<
  typeof subtitleFinalizationReportSchema
>;
export type SubtitleReviewPackage = z.infer<typeof subtitleReviewPackageSchema>;
export type SourceFingerprint = z.infer<typeof sourceFingerprintSchema>;
export type HumanReviewResolutions = z.infer<
  typeof humanReviewResolutionsSchema
>;
export type CorrectionFeedback = z.infer<typeof correctionFeedbackSchema>;
export type HumanReviewResolution = z.infer<typeof humanReviewResolutionSchema>;
