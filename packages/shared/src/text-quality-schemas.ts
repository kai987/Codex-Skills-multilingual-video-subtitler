import { z } from "zod";

import { subtitleCueSchema } from "./schemas.js";
import {
  acousticSceneLabelSchema,
  transcriptionIntervalSchema,
} from "./transcription-schemas.js";

const versionSchema = z.literal("1.0.0");
const timestampSchema = z.iso.datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const stringArraySchema = z.array(z.string().min(1));

export const textIntegrityModeSchema = z.enum(["off", "observe", "enforce"]);
export type TextIntegrityMode = z.infer<typeof textIntegrityModeSchema>;

export const cueSegmentationModeSchema = z.enum([
  "acoustic-semantic",
  "token-only",
  "legacy",
]);
export type CueSegmentationMode = z.infer<typeof cueSegmentationModeSchema>;

export const artifactHypothesisResolutionModeSchema = z.enum([
  "top-score",
  "conservative",
  "balanced",
]);
export type ArtifactHypothesisResolutionMode = z.infer<
  typeof artifactHypothesisResolutionModeSchema
>;

export const runtimeHypothesisResolutionModeSchema = z.literal("top-score");
export type RuntimeHypothesisResolutionMode = z.infer<
  typeof runtimeHypothesisResolutionModeSchema
>;

/** @deprecated Use runtimeHypothesisResolutionModeSchema for new execution. */
export const hypothesisResolutionModeSchema =
  artifactHypothesisResolutionModeSchema;
/** @deprecated This type includes legacy artifact/CLI values. */
export type HypothesisResolutionMode = ArtifactHypothesisResolutionMode;

export const japaneseNormalizationModeSchema = z.enum(["off", "top-score"]);
export type JapaneseNormalizationMode = z.infer<
  typeof japaneseNormalizationModeSchema
>;

export const japaneseTextAnalyzerModeSchema = z.enum([
  "auto",
  "intl-segmenter",
  "external",
]);
export type JapaneseTextAnalyzerMode = z.infer<
  typeof japaneseTextAnalyzerModeSchema
>;

export const lyricsValidationModeSchema = z.enum(["conservative", "balanced"]);
export type LyricsValidationMode = z.infer<typeof lyricsValidationModeSchema>;

export const japaneseTextSegmentSchema = z
  .object({
    text: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    wordLike: z.boolean(),
  })
  .strict()
  .refine((segment) => segment.end > segment.start, {
    message: "Japanese segment end must be after start.",
  });

export const japaneseTextAnalysisSchema = z
  .object({
    normalizedText: z.string(),
    lexicalCharacterCount: z.number().int().nonnegative(),
    segments: z.array(japaneseTextSegmentSchema),
    singleCharacter: z.boolean(),
    standaloneInterjectionLikelihood: z.number().min(0).max(1),
    startsMidWord: z.boolean(),
    endsMidWord: z.boolean(),
    likelyIncompleteClause: z.boolean(),
    sentenceEndingConfidence: z.number().min(0).max(1),
    evidence: stringArraySchema,
  })
  .strict();

export type JapaneseTextAnalysis = z.infer<typeof japaneseTextAnalysisSchema>;

export const japaneseBoundaryAnalysisSchema = z
  .object({
    boundarySplitsWord: z.boolean(),
    concatenatedTextFormsStableTokenization: z.boolean(),
    likelyContinuation: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidence: stringArraySchema,
  })
  .strict();

export type JapaneseBoundaryAnalysis = z.infer<
  typeof japaneseBoundaryAnalysisSchema
>;

export const japaneseTextAnalysisArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        analyzer: japaneseTextAnalyzerModeSchema,
        locale: z.literal("ja"),
        implementation: z.string().min(1),
      })
      .strict(),
    cues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          sourceCueIds: stringArraySchema,
          analysis: japaneseTextAnalysisSchema,
          previousBoundary: japaneseBoundaryAnalysisSchema.nullable(),
          nextBoundary: japaneseBoundaryAnalysisSchema.nullable(),
        })
        .strict(),
    ),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type JapaneseTextAnalysisArtifact = z.infer<
  typeof japaneseTextAnalysisArtifactSchema
>;

export const cueCandidateEvidenceSchema = z
  .object({
    cueId: z.string().min(1),
    interval: transcriptionIntervalSchema,
    text: z.string().min(1),
    sourceCueIds: stringArraySchema,
    sourceRequestIds: z.array(z.string().min(1)),
    sourceProfileIds: z.array(z.string().min(1)),
    referenceAnchorIds: z.array(z.string().min(1)),
    referenceUnitIds: z.array(z.string().min(1)),
    recoveryUnitId: z.string().min(1).nullable(),
    sceneId: z.string().min(1).nullable(),
    sceneLabel: acousticSceneLabelSchema.nullable(),
    acousticSupport: z.number().min(0).max(1),
    independentSupportCount: z.number().int().nonnegative().optional(),
    profileConsensus: z.number().min(0).max(1),
    speechCoverage: z.number().min(0).max(1),
    tokenTimingQuality: z.number().min(0).max(1),
    japaneseTextCompleteness: z.number().min(0).max(1),
    terminologySupport: z.number().min(0).max(1),
    referenceTimingSupport: z.number().min(0).max(1),
    referenceSemanticSupport: z.number().min(0).max(1).nullable(),
    repetitionRisk: z.number().min(0).max(1),
    hallucinationRisk: z.number().min(0).max(1),
    fragmentRisk: z.number().min(0).max(1),
    totalScore: z.number().min(0).max(1),
    selectionScore: z.number().min(0).max(1).optional(),
    provenancePriority: z.number().min(0).max(1).optional(),
    selectionEligible: z.boolean().optional(),
    hardBlockReasons: z.array(z.string().min(1)).optional(),
    reasons: stringArraySchema,
  })
  .strict();

export type CueCandidateEvidence = z.infer<typeof cueCandidateEvidenceSchema>;

export const cueCandidateEvidenceArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: artifactHypothesisResolutionModeSchema,
        runtimeMode: runtimeHypothesisResolutionModeSchema.optional(),
        conservativeSelectionMargin: z.number().min(0).max(1).optional(),
        balancedSelectionMargin: z.number().min(0).max(1).optional(),
        scoreGapReviewThreshold: z.number().min(0).max(1).optional(),
      })
      .strict(),
    candidates: z.array(cueCandidateEvidenceSchema),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type CueCandidateEvidenceArtifact = z.infer<
  typeof cueCandidateEvidenceArtifactSchema
>;

export const hypothesisClusterReasonSchema = z.enum([
  "temporal-overlap",
  "near-duplicate-text",
  "same-reference-unit",
  "same-recovery-unit",
  "mixed",
]);

export const hypothesisClusterSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    candidateCueIds: stringArraySchema,
    referenceAnchorIds: z.array(z.string().min(1)),
    sourceRequestIds: z.array(z.string().min(1)),
    clusterReason: hypothesisClusterReasonSchema,
    evidence: stringArraySchema,
    atomic: z.boolean().optional(),
    medoidCueId: z.string().min(1).optional(),
    sourceLegacyClusterIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type HypothesisCluster = z.infer<typeof hypothesisClusterSchema>;

export const hypothesisClustersArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        maximumBoundaryDistanceSeconds: z.number().nonnegative(),
        minimumNearDuplicateSimilarity: z.number().min(0).max(1),
        clusteringMethod: z
          .enum(["connected-components", "constrained-medoid"])
          .optional(),
        maximumAtomicSpanSeconds: z.number().positive().optional(),
      })
      .strict(),
    clusters: z.array(hypothesisClusterSchema),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type HypothesisClustersArtifact = z.infer<
  typeof hypothesisClustersArtifactSchema
>;

export const hypothesisResolutionDecisionSchema = z.enum([
  "accept-one",
  "merge-compatible-parts",
  "refine-again",
  "review-unresolved",
]);

export const hypothesisResolutionArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: artifactHypothesisResolutionModeSchema,
        runtimeMode: runtimeHypothesisResolutionModeSchema.optional(),
        selectionMargin: z.number().min(0).max(1).nullable(),
        scoreGapReviewThreshold: z.number().min(0).max(1).optional(),
      })
      .strict(),
    resolutions: z.array(
      z
        .object({
          clusterId: z.string().min(1),
          candidateCueIds: stringArraySchema,
          selectedCueIds: z.array(z.string().min(1)),
          rejectedCueIds: z.array(z.string().min(1)),
          decision: hypothesisResolutionDecisionSchema,
          winningMargin: z.number().min(0).max(1).nullable(),
          winnerCueId: z.string().min(1).nullable().optional(),
          winnerScore: z.number().min(0).max(1).nullable().optional(),
          runnerUpCueId: z.string().min(1).nullable().optional(),
          runnerUpScore: z.number().min(0).max(1).nullable().optional(),
          scoreGap: z.number().min(0).max(1).nullable().optional(),
          reviewRecommended: z.boolean().optional(),
          reviewReasons: z.array(z.string().min(1)).optional(),
          tieBreakApplied: z.boolean().optional(),
          tieBreakReasons: z.array(z.string().min(1)).optional(),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    unresolvedIntervals: z.array(
      transcriptionIntervalSchema.safeExtend({
        clusterId: z.string().min(1),
        candidateCueIds: stringArraySchema,
        reasons: stringArraySchema,
      }),
    ),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type HypothesisResolutionArtifact = z.infer<
  typeof hypothesisResolutionArtifactSchema
>;

export const cueSegmentationPlanArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: cueSegmentationModeSchema,
        maximumLines: z.number().int().positive(),
        maximumCharactersPerLine: z.number().int().positive(),
        maximumCueDurationSeconds: z.number().positive(),
        maximumCharactersPerSecond: z.number().positive(),
        allowCharacterRatioFallback: z.boolean(),
      })
      .strict(),
    entries: z.array(
      z
        .object({
          id: z.string().min(1),
          sourceCueIds: stringArraySchema,
          outputCueIds: stringArraySchema,
          originalInterval: transcriptionIntervalSchema,
          outputIntervals: z.array(transcriptionIntervalSchema),
          decision: z.enum(["preserved", "merged", "split", "unresolved"]),
          method: z.enum([
            "token",
            "pause",
            "speech-interval",
            "japanese-semantic",
            "reference-anchor",
            "character-ratio",
            "preserved",
          ]),
          characterRatioFallback: z.boolean(),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        inputCueCount: z.number().int().nonnegative(),
        outputCueCount: z.number().int().nonnegative(),
        mergedCueCount: z.number().int().nonnegative(),
        splitCueCount: z.number().int().nonnegative(),
        unresolvedCueCount: z.number().int().nonnegative(),
        characterFallbackSegmentationCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type CueSegmentationPlanArtifact = z.infer<
  typeof cueSegmentationPlanArtifactSchema
>;

export const finalTextIntegrityCodeSchema = z.enum([
  "FINAL_SINGLE_CHARACTER_FRAGMENT",
  "FINAL_EXTREME_SHORT_DURATION",
  "FINAL_INCOMPLETE_MORPHEME",
  "FINAL_INCOMPLETE_CLAUSE",
  "FINAL_TEXT_BOUNDARY_BREAK",
  "FINAL_COMPETING_HYPOTHESES",
  "FINAL_NEAR_DUPLICATE_SEMANTIC_CUE",
  "FINAL_UNSUPPORTED_CONTENT_WORD",
  "FINAL_INVALID_JAPANESE_FRAGMENT",
  "FINAL_LYRICS_HALLUCINATION",
  "FINAL_LYRICS_INCOMPLETE_LINE",
  "FINAL_REFERENCE_SEMANTIC_CONFLICT",
  "FINAL_VISUAL_LINE_WORD_BREAK",
  "SEGMENTATION_UNRESOLVED",
]);

export type FinalTextIntegrityCode = z.infer<
  typeof finalTextIntegrityCodeSchema
>;

export const textIntegrityCategorySchema = z.enum([
  "fragment",
  "text",
  "hypothesis",
  "lyrics",
  "segmentation",
  "semantic",
  "presentation",
]);

export const finalTextIntegrityFindingSchema = z
  .object({
    id: z.string().min(1),
    code: finalTextIntegrityCodeSchema,
    severity: z.enum(["hard", "warning"]),
    category: textIntegrityCategorySchema,
    interval: transcriptionIntervalSchema,
    cueIds: z.array(z.string().min(1)),
    sourceCueIds: z.array(z.string().min(1)),
    sourceRequestIds: z.array(z.string().min(1)),
    referenceAnchorIds: z.array(z.string().min(1)),
    reasons: stringArraySchema,
  })
  .strict();

export type FinalTextIntegrityFinding = z.infer<
  typeof finalTextIntegrityFindingSchema
>;

export const finalTextIntegrityArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: textIntegrityModeSchema,
        ordinaryHardMinimumDurationSeconds: z.number().positive(),
        ordinaryWarningMinimumDurationSeconds: z.number().positive(),
        singleCharacterMinimumDurationSeconds: z.number().positive(),
      })
      .strict(),
    validationStatus: z.enum(["passed", "needs-review"]),
    candidateCueCount: z.number().int().nonnegative(),
    finalCueCount: z.number().int().nonnegative(),
    quarantinedCueIds: z.array(z.string().min(1)),
    findings: z.array(finalTextIntegrityFindingSchema),
    metrics: z
      .object({
        singleCharacterFragmentCount: z.number().int().nonnegative(),
        extremeShortDurationCueCount: z.number().int().nonnegative(),
        incompleteMorphemeCount: z.number().int().nonnegative(),
        incompleteClauseCount: z.number().int().nonnegative(),
        boundarySplitCount: z.number().int().nonnegative(),
        competingHypothesesFinalCount: z.number().int().nonnegative(),
        nearDuplicateSemanticCueCount: z.number().int().nonnegative(),
        lyricsHallucinationCount: z.number().int().nonnegative(),
        lyricsIncompleteLineCount: z.number().int().nonnegative(),
        segmentationUnresolvedCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type FinalTextIntegrityArtifact = z.infer<
  typeof finalTextIntegrityArtifactSchema
>;

export const textIntegrityRepairStrategySchema = z.enum([
  "runner-up-text-donor",
  "deduplicated-text-donor",
  "merge-previous",
  "merge-next",
  "merge-three-way",
  "restore-pre-segmentation",
  "expand-duration",
]);

export const textIntegrityRepairArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    outputHash: sha256Schema,
    configuration: z
      .object({
        maximumRepairRounds: z.number().int().min(1).max(2),
        characterRatioTimingAllowed: z.literal(false),
      })
      .strict(),
    rounds: z.array(
      z
        .object({
          round: z.number().int().min(1).max(2),
          inputHash: sha256Schema,
          outputHash: sha256Schema,
          candidateFindingCount: z.number().int().nonnegative(),
          repairAttemptCount: z.number().int().nonnegative(),
          successfulRepairCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    repairs: z.array(
      z
        .object({
          id: z.string().min(1),
          round: z.number().int().min(1).max(2),
          sourceFindingCodes: z.array(finalTextIntegrityCodeSchema).min(1),
          sourceCueIds: stringArraySchema,
          sourceClusterIds: stringArraySchema,
          repairStrategy: textIntegrityRepairStrategySchema,
          beforeText: z.string(),
          afterText: z.string().min(1),
          beforeInterval: transcriptionIntervalSchema,
          afterInterval: transcriptionIntervalSchema,
          textDonorCueId: z.string().min(1).nullable(),
          timingDonorCueId: z.string().min(1).nullable(),
          originalWinnerCueId: z.string().min(1).nullable(),
          winnerScore: z.number().min(0).max(1).nullable(),
          textDonorScore: z.number().min(0).max(1).nullable(),
          evidence: stringArraySchema,
          result: z.enum(["repaired", "rejected", "still-hard-blocked"]),
        })
        .strict(),
    ),
    summary: z
      .object({
        candidateFindingCount: z.number().int().nonnegative(),
        repairAttemptCount: z.number().int().nonnegative(),
        successfulRepairCount: z.number().int().nonnegative(),
        failedRepairCount: z.number().int().nonnegative(),
        restoredCueCount: z.number().int().nonnegative(),
        replacedByRunnerUpCount: z.number().int().nonnegative(),
        restoredPreSegmentationCueCount: z.number().int().nonnegative(),
        mergedWithPreviousCount: z.number().int().nonnegative(),
        mergedWithNextCount: z.number().int().nonnegative(),
        threeWayMergeCount: z.number().int().nonnegative(),
        durationExpansionCount: z.number().int().nonnegative(),
        stillHardBlockedCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type TextIntegrityRepairArtifact = z.infer<
  typeof textIntegrityRepairArtifactSchema
>;

export const intraCueRepetitionRelationshipSchema = z.enum([
  "exact-duplicate",
  "near-duplicate",
  "kana-kanji-equivalent",
  "containment-alternative",
  "true-spoken-repetition",
  "unresolved",
]);

const intraCueRepeatedSpanSchema = z
  .object({
    text: z.string().min(1),
    normalizedText: z.string().min(1),
    sourceCueIds: stringArraySchema,
    interval: transcriptionIntervalSchema.nullable(),
  })
  .strict();

export const intraCueRepetitionRepairArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    outputHash: sha256Schema,
    records: z.array(
      z
        .object({
          cueId: z.string().min(1),
          sourceCueIds: stringArraySchema,
          detectedRepeatedSpans: z.array(intraCueRepeatedSpanSchema),
          normalizedSpans: stringArraySchema,
          readingEvidence: stringArraySchema,
          relationship: intraCueRepetitionRelationshipSchema,
          keptSpan: intraCueRepeatedSpanSchema,
          removedSpans: z.array(intraCueRepeatedSpanSchema),
          preservedTail: z.array(intraCueRepeatedSpanSchema),
          selectedReason: z.string().min(1),
          audioRepetitionEvidence: stringArraySchema,
          reviewRecommended: z.boolean(),
          outputCueIds: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        inputCueCount: z.number().int().nonnegative(),
        outputCueCount: z.number().int().nonnegative(),
        detectedCueCount: z.number().int().nonnegative(),
        repairedCueCount: z.number().int().nonnegative(),
        trueSpokenRepetitionCount: z.number().int().nonnegative(),
        removedSpanCount: z.number().int().nonnegative(),
        preservedTailCount: z.number().int().nonnegative(),
        japaneseSpacesRemoved: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type IntraCueRepetitionRepairArtifact = z.infer<
  typeof intraCueRepetitionRepairArtifactSchema
>;

export const finalSubtitleRepairArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    outputHash: sha256Schema,
    repairs: z.array(
      z
        .object({
          id: z.string().min(1),
          findingCode: z.enum([
            "CROSS_CUE_EXACT_DUPLICATE",
            "CROSS_CUE_SENTENCE_LOOP",
            "CROSS_CUE_LONG_PHRASE_LOOP",
            "SUBTITLE_OVERLAP",
            "UNSUPPORTED_LONG_CUE",
          ]),
          strategy: z.enum([
            "overlap-deduplicated",
            "overlap-alternative-selected",
            "overlap-trimmed",
            "overlap-merged",
            "long-cue-split",
            "supported-long-cue",
            "loop-boundary-trimmed",
            "loop-duplicate-block-removed",
            "unresolved",
          ]),
          sourceCueIds: stringArraySchema,
          outputCueIds: stringArraySchema,
          beforeInterval: transcriptionIntervalSchema,
          afterIntervals: z.array(transcriptionIntervalSchema),
          evidence: stringArraySchema,
          result: z.enum(["repaired", "supported", "unresolved"]),
        })
        .strict(),
    ),
    supportedLongCueIds: stringArraySchema,
    summary: z
      .object({
        overlapFindingCount: z.number().int().nonnegative(),
        overlapDeduplicatedCount: z.number().int().nonnegative(),
        overlapTrimmedCount: z.number().int().nonnegative(),
        overlapMergedCount: z.number().int().nonnegative(),
        overlapUnresolvedCount: z.number().int().nonnegative(),
        longCueSplitCount: z.number().int().nonnegative(),
        supportedLongCueCount: z.number().int().nonnegative(),
        loopBoundaryTrimCount: z.number().int().nonnegative(),
        loopDuplicateBlockRemovedCount: z.number().int().nonnegative(),
        restoredCueCount: z.number().int().nonnegative(),
        quarantinedAfterRepairCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type FinalSubtitleRepairArtifact = z.infer<
  typeof finalSubtitleRepairArtifactSchema
>;

export const coverageRecoveryModeSchema = z.enum(["off", "auto", "deep"]);
export type CoverageRecoveryMode = z.infer<typeof coverageRecoveryModeSchema>;

export const coverageRecoveryPrioritySchema = z.enum([
  "P0",
  "P1",
  "P2",
  "P3",
  "P4",
]);

export const coverageRecoveryPlanArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: coverageRecoveryModeSchema,
        maximumRounds: z.number().int().min(1).max(2),
        maximumWindowSeconds: z.number().positive().max(20),
        ordinaryReviewOnlyDoesNotTriggerAsr: z.literal(true),
      })
      .strict(),
    units: z.array(
      z
        .object({
          id: z.string().min(1),
          round: z.number().int().min(1).max(2),
          priority: coverageRecoveryPrioritySchema,
          interval: transcriptionIntervalSchema,
          anchorIds: stringArraySchema,
          sourceCueIds: stringArraySchema,
          triggerCodes: stringArraySchema,
          route: z.enum([
            "sensitive-vad",
            "extra-sensitive-vad",
            "vad-and-no-vad",
            "no-vad-large-v3",
            "narration-context",
            "lyrics-pipeline",
            "review-only",
          ]),
          shouldRunAsr: z.boolean(),
          evidence: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        unitCount: z.number().int().nonnegative(),
        automaticRequestCount: z.number().int().nonnegative(),
        reviewOnlyCount: z.number().int().nonnegative(),
        priorityCounts: z.record(
          coverageRecoveryPrioritySchema,
          z.number().int().nonnegative(),
        ),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type CoverageRecoveryPlanArtifact = z.infer<
  typeof coverageRecoveryPlanArtifactSchema
>;

export const coverageRecoveryResultsArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    planInputHash: sha256Schema,
    roundsCompleted: z.number().int().min(0).max(2),
    results: z.array(
      z
        .object({
          unitId: z.string().min(1),
          requestIds: stringArraySchema,
          cacheHitCount: z.number().int().nonnegative(),
          candidateCueIds: stringArraySchema,
          acceptedCueIds: stringArraySchema,
          decision: z.enum(["accepted", "rejected", "review-only", "not-run"]),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        requestCount: z.number().int().nonnegative(),
        cacheHitCount: z.number().int().nonnegative(),
        acceptedCandidateCount: z.number().int().nonnegative(),
        rejectedCandidateCount: z.number().int().nonnegative(),
        rejectedHallucinationCount: z.number().int().nonnegative().optional(),
        rejectedNoAudibleSpeechCount: z.number().int().nonnegative().optional(),
        workerStartCount: z.number().int().nonnegative(),
        modelLoadCount: z.number().int().nonnegative(),
        fallbackProcessCount: z.number().int().nonnegative(),
      })
      .strict(),
    stopReason: z.enum([
      "disabled",
      "no-recovery-units",
      "no-new-accepted-candidates",
      "coverage-did-not-improve",
      "maximum-rounds-reached",
      "completed",
      "pending-execution",
    ]),
  })
  .strict();

export type CoverageRecoveryResultsArtifact = z.infer<
  typeof coverageRecoveryResultsArtifactSchema
>;

export const lyricsTextValidityArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: lyricsValidationModeSchema,
        maximumAdjacentGapSeconds: z.number().nonnegative(),
      })
      .strict(),
    sequences: z.array(
      z
        .object({
          id: z.string().min(1),
          interval: transcriptionIntervalSchema,
          cueIds: stringArraySchema,
          combinedNormalizedText: z.string(),
          validity: z.enum([
            "valid",
            "hallucination",
            "incomplete",
            "unresolved",
          ]),
          independentSupportCount: z.number().int().nonnegative(),
          referenceOriginalConflict: z.boolean(),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type LyricsTextValidityArtifact = z.infer<
  typeof lyricsTextValidityArtifactSchema
>;

export const referenceOriginalLyricsResolutionArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        trustedReferenceOriginalOutranksLyricsAsr: z.literal(true),
        minimumClassifierConfidence: z.number().min(0).max(1),
      })
      .strict(),
    addedCueIds: z.array(z.string().min(1)),
    replacedCueIds: z.array(z.string().min(1)),
    removedConflictingCueIds: z.array(z.string().min(1)),
    conflicts: z.array(
      z
        .object({
          id: z.string().min(1),
          interval: transcriptionIntervalSchema,
          referenceAnchorIds: stringArraySchema,
          referenceCueIds: stringArraySchema,
          conflictingAsrCueIds: z.array(z.string().min(1)),
          selectedCueIds: z.array(z.string().min(1)),
          decision: z.enum([
            "reference-original-selected",
            "existing-equivalent-kept",
            "review-unresolved",
          ]),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type ReferenceOriginalLyricsResolutionArtifact = z.infer<
  typeof referenceOriginalLyricsResolutionArtifactSchema
>;

export const japaneseTerminologyCategorySchema = z.enum([
  "person",
  "place",
  "festival",
  "occupation",
  "dialect",
  "other",
]);

export const japaneseTerminologyEntrySchema = z
  .object({
    canonical: z.string().min(1),
    variants: z.array(z.string().min(1)),
    readings: z.array(z.string().min(1)),
    category: japaneseTerminologyCategorySchema,
    source: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type JapaneseTerminologyEntry = z.infer<
  typeof japaneseTerminologyEntrySchema
>;

export const terminologyEvidenceArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        globalReplacementEnabled: z.literal(false),
      })
      .strict(),
    entries: z.array(japaneseTerminologyEntrySchema),
    cueEvidence: z.array(
      z
        .object({
          cueId: z.string().min(1),
          matchedCanonicalTerms: z.array(z.string().min(1)),
          supportScore: z.number().min(0).max(1),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type TerminologyEvidenceArtifact = z.infer<
  typeof terminologyEvidenceArtifactSchema
>;

export const semanticCandidateValidationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: z.enum(["off", "auto", "on"]),
        onlineApiAllowed: z.literal(false),
      })
      .strict(),
    method: z.enum([
      "local-model",
      "local-translation",
      "heuristic",
      "unavailable",
    ]),
    results: z.array(
      z
        .object({
          candidateCueId: z.string().min(1),
          referenceAnchorIds: z.array(z.string().min(1)),
          semanticSimilarity: z.number().min(0).max(1).nullable(),
          entityAgreement: z.number().min(0).max(1).nullable(),
          numberAgreement: z.boolean().nullable(),
          polarityConflict: z.boolean(),
          relationConflict: z.boolean(),
          evidence: stringArraySchema,
        })
        .strict(),
    ),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type SemanticCandidateValidationArtifact = z.infer<
  typeof semanticCandidateValidationArtifactSchema
>;

export const anchorTextCoverageLevelSchema = z.enum([
  "temporal-covered",
  "valid-text-covered",
  "verified-text-covered",
  "active-review",
  "uncovered",
]);

export const anchorTextValiditySchema = z.enum([
  "valid",
  "fragment",
  "incomplete",
  "competing",
  "semantic-conflict",
  "lyrics-hallucination",
  "unsupported",
  "unresolved",
]);

export const anchorTextCoverageArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    referenceSha256: sha256Schema,
    generatedSubtitleSha256: sha256Schema,
    configuration: z
      .object({
        minimumTemporalCoverageRatio: z.number().min(0).max(1),
        verifiedRequiresIndependentEvidence: z.literal(true),
      })
      .strict(),
    anchors: z.array(
      z
        .object({
          anchorId: z.string().min(1),
          generatedCueIds: z.array(z.string().min(1)),
          level: anchorTextCoverageLevelSchema,
          temporalCoverage: z.boolean(),
          validTextCoverage: z.boolean(),
          verifiedTextCoverage: z.boolean(),
          textValidity: anchorTextValiditySchema,
          supportingEvidence: stringArraySchema,
          blockingFindingIds: z.array(z.string().min(1)),
          activeReview: z.boolean(),
        })
        .strict(),
    ),
    summary: z
      .object({
        expectedAnchors: z.number().int().nonnegative(),
        temporalCovered: z.number().int().nonnegative(),
        validTextCovered: z.number().int().nonnegative(),
        verifiedTextCovered: z.number().int().nonnegative(),
        activeReview: z.number().int().nonnegative(),
        uncovered: z.number().int().nonnegative(),
        dialogue: z
          .object({
            temporalRecall: z.number().min(0).max(1).nullable(),
            validTextRecall: z.number().min(0).max(1).nullable(),
            verifiedTextRecall: z.number().min(0).max(1).nullable(),
          })
          .strict(),
        narration: z
          .object({
            temporalRecall: z.number().min(0).max(1).nullable(),
            validTextRecall: z.number().min(0).max(1).nullable(),
            verifiedTextRecall: z.number().min(0).max(1).nullable(),
          })
          .strict(),
        lyrics: z
          .object({
            temporalRecall: z.number().min(0).max(1).nullable(),
            validTextRecall: z.number().min(0).max(1).nullable(),
            verifiedTextRecall: z.number().min(0).max(1).nullable(),
          })
          .strict(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type AnchorTextCoverageArtifact = z.infer<
  typeof anchorTextCoverageArtifactSchema
>;

export const japaneseTerminologyFileSchema = z
  .object({
    entries: z.array(japaneseTerminologyEntrySchema),
  })
  .strict();

export type JapaneseTerminologyFile = z.infer<
  typeof japaneseTerminologyFileSchema
>;

export const candidateAtomizationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        maximumAtomicSpanSeconds: z.number().positive(),
        maximumDialoguePauseSeconds: z.number().nonnegative(),
        characterRatioSplittingAllowed: z.literal(false),
      })
      .strict(),
    sourceCandidateCount: z.number().int().nonnegative(),
    atomizedCandidateCount: z.number().int().nonnegative(),
    entries: z.array(
      z
        .object({
          sourceCueId: z.string().min(1),
          sourceInterval: transcriptionIntervalSchema,
          outputCueIds: stringArraySchema,
          decision: z.enum(["preserved", "split", "compound"]),
          boundarySources: z.array(
            z.enum([
              "token",
              "speech-interval",
              "reference-anchor",
              "semantic",
              "recovery-unit",
              "none",
            ]),
          ),
          referenceAnchorIds: z.array(z.string().min(1)),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    atoms: z.array(subtitleCueSchema),
    summary: z
      .object({
        preservedCandidateCount: z.number().int().nonnegative(),
        splitSourceCandidateCount: z.number().int().nonnegative(),
        compoundCandidateCount: z.number().int().nonnegative(),
        characterRatioSplitCount: z.literal(0),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type CandidateAtomizationArtifact = z.infer<
  typeof candidateAtomizationArtifactSchema
>;

export const atomicHypothesisClusterSchema = z
  .object({
    id: z.string().min(1),
    interval: transcriptionIntervalSchema,
    candidateCueIds: stringArraySchema,
    medoidCueId: z.string().min(1),
    referenceAnchorIds: z.array(z.string().min(1)),
    referenceUnitIds: z.array(z.string().min(1)),
    sourceRequestIds: z.array(z.string().min(1)),
    clusterReason: z.enum([
      "singleton",
      "temporal-medoid",
      "reference-anchor",
      "near-duplicate-text",
      "mixed",
    ]),
    sourceLegacyClusterIds: z.array(z.string().min(1)),
    evidence: stringArraySchema,
  })
  .strict();

export type AtomicHypothesisCluster = z.infer<
  typeof atomicHypothesisClusterSchema
>;

export const atomicHypothesisClustersArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        method: z.literal("constrained-medoid"),
        maximumBoundaryDistanceSeconds: z.number().nonnegative(),
        minimumTemporalOverlapRatio: z.number().min(0).max(1),
        maximumAtomicSpanSeconds: z.number().positive(),
        majorityCompatibilityRatio: z.number().min(0.5).max(1),
        sharedReferenceUnitAloneConnectsCandidates: z.literal(false),
      })
      .strict(),
    clusters: z.array(atomicHypothesisClusterSchema),
    summary: z
      .object({
        candidateCount: z.number().int().nonnegative(),
        atomicClusterCount: z.number().int().nonnegative(),
        singletonClusterCount: z.number().int().nonnegative(),
        splitLegacyClusterCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type AtomicHypothesisClustersArtifact = z.infer<
  typeof atomicHypothesisClustersArtifactSchema
>;

export const topScoreResolutionRecordSchema = z
  .object({
    clusterId: z.string().min(1),
    candidateCueIds: stringArraySchema,
    winnerCueId: z.string().min(1).nullable(),
    winnerScore: z.number().min(0).max(1).nullable(),
    runnerUpCueId: z.string().min(1).nullable(),
    runnerUpScore: z.number().min(0).max(1).nullable(),
    scoreGap: z.number().min(0).max(1).nullable(),
    rejectedCueIds: z.array(z.string().min(1)),
    hardBlockReasons: z.array(z.string().min(1)),
    reviewRecommended: z.boolean(),
    reviewReasons: z.array(z.string().min(1)),
    tieBreakApplied: z.boolean(),
    tieBreakReasons: z.array(z.string().min(1)),
  })
  .strict();

export type TopScoreResolutionRecord = z.infer<
  typeof topScoreResolutionRecordSchema
>;

export const topScoreResolutionArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        mode: runtimeHypothesisResolutionModeSchema,
        scoreGapReviewThreshold: z.number().min(0).max(1),
        deterministicTieBreakOrder: stringArraySchema,
      })
      .strict(),
    resolutions: z.array(topScoreResolutionRecordSchema),
    summary: z
      .object({
        atomicClusterCount: z.number().int().nonnegative(),
        winnerCount: z.number().int().nonnegative(),
        noWinnerCount: z.number().int().nonnegative(),
        lowScoreGapWinnerCount: z.number().int().nonnegative(),
        reviewRecommendedWinnerCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type TopScoreResolutionArtifact = z.infer<
  typeof topScoreResolutionArtifactSchema
>;

export const topScoreWinnersArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    winnerCount: z.number().int().nonnegative(),
    winners: z.array(subtitleCueSchema),
    records: z.array(topScoreResolutionRecordSchema),
  })
  .strict();

export type TopScoreWinnersArtifact = z.infer<
  typeof topScoreWinnersArtifactSchema
>;

export const winnerDeduplicationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    stage: z.enum(["pre-normalization", "post-normalization"]),
    inputWinnerCount: z.number().int().nonnegative(),
    outputWinnerCount: z.number().int().nonnegative(),
    records: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum([
            "exact",
            "normalized-exact",
            "punctuation-only-difference",
            "spacing-only-difference",
            "same-source",
            "same-reference-anchor",
            "same-recovery-unit",
            "near-duplicate",
            "prefix-duplicate",
            "suffix-duplicate",
            "kana-kanji-equivalent",
            "normalized-form-equivalent",
            "trusted-reference-original-lyrics",
          ]),
          keptCueId: z.string().min(1),
          removedCueIds: stringArraySchema,
          timingDonorCueId: z.string().min(1).nullable(),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        removedCount: z.number().int().nonnegative(),
        prefixDuplicateCount: z.number().int().nonnegative(),
        timingDonorCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type WinnerDeduplicationArtifact = z.infer<
  typeof winnerDeduplicationArtifactSchema
>;

export const fragmentRepairArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    configuration: z
      .object({
        dialogueMaximumGapSeconds: z.number().nonnegative(),
        rapidDialogueMaximumGapSeconds: z.number().nonnegative(),
        narrationMaximumGapSeconds: z.number().nonnegative(),
        previousWinnerPreferred: z.literal(true),
      })
      .strict(),
    inputWinnerCount: z.number().int().nonnegative(),
    outputWinnerCount: z.number().int().nonnegative(),
    repairs: z.array(
      z
        .object({
          id: z.string().min(1),
          repairType: z.enum([
            "merge-previous",
            "merge-next",
            "merge-three",
            "prefix-superseded",
            "suffix-superseded",
          ]),
          sourceWinnerIds: stringArraySchema,
          rawSourceTexts: stringArraySchema,
          outputCueId: z.string().min(1),
          mergedText: z.string().min(1),
          mergeEvidence: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        repairCount: z.number().int().nonnegative(),
        fragmentMergeCount: z.number().int().nonnegative(),
        mergedWithPreviousCount: z.number().int().nonnegative(),
        mergedWithNextCount: z.number().int().nonnegative(),
        prefixSupersededCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type FragmentRepairArtifact = z.infer<
  typeof fragmentRepairArtifactSchema
>;

export const winnerTimingRepairArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    characterRatioTimingAllowed: z.literal(false),
    repairs: z.array(
      z
        .object({
          id: z.string().min(1),
          textWinnerCueId: z.string().min(1),
          timingDonorCueId: z.string().min(1).nullable(),
          before: transcriptionIntervalSchema,
          after: transcriptionIntervalSchema,
          timingRepairMethod: z.enum([
            "winner-token",
            "equivalent-candidate-token",
            "speech-boundary",
            "speech-interval",
            "reference-anchor",
            "recovery-target",
            "equivalent-candidate-interval",
            "unchanged",
          ]),
          textChanged: z.literal(false),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    summary: z
      .object({
        repairCount: z.number().int().nonnegative(),
        timingDonorCount: z.number().int().nonnegative(),
        unresolvedTimingCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type WinnerTimingRepairArtifact = z.infer<
  typeof winnerTimingRepairArtifactSchema
>;

export const japaneseLexicalNormalizationArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    terminologySha256: sha256Schema.nullable(),
    configuration: z
      .object({
        mode: japaneseNormalizationModeSchema,
        globalReplacementEnabled: z.literal(false),
        dialectPreservationEnabled: z.literal(true),
      })
      .strict(),
    cues: z.array(
      z
        .object({
          cueId: z.string().min(1),
          rawText: z.string(),
          repairedText: z.string(),
          normalizedText: z.string(),
          changed: z.boolean(),
          selectionScore: z.number(),
          replacements: z.array(
            z
              .object({
                original: z.string().min(1),
                replacement: z.string().min(1),
                category: z.string().min(1),
                confidence: z.number().min(0).max(1),
                evidence: stringArraySchema,
              })
              .strict(),
          ),
          reviewRecommended: z.boolean(),
          reasons: stringArraySchema,
          candidateForms: z.array(z.string().min(1)).default([]),
          candidateScores: z
            .array(
              z
                .object({
                  text: z.string().min(1),
                  score: z.number(),
                  evidence: stringArraySchema,
                })
                .strict(),
            )
            .default([]),
          readingEvidence: stringArraySchema.default([]),
          sameClusterSupport: stringArraySchema.default([]),
          properNounEvidence: stringArraySchema.default([]),
          dialectProtection: stringArraySchema.default([]),
          selectedReason: z.string().min(1).default("original-stable-fallback"),
        })
        .strict(),
    ),
    summary: z
      .object({
        changedCueCount: z.number().int().nonnegative(),
        kanaToKanjiCount: z.number().int().nonnegative(),
        katakanaNormalizationCount: z.number().int().nonnegative(),
        properNounRepairCount: z.number().int().nonnegative(),
        terminologyRepairCount: z.number().int().nonnegative(),
        dialectPreservedCount: z.number().int().nonnegative(),
      })
      .strict(),
    fallback: z.string().min(1).nullable(),
  })
  .strict();

export type JapaneseLexicalNormalizationArtifact = z.infer<
  typeof japaneseLexicalNormalizationArtifactSchema
>;

export const lineLayoutIntegrityArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    findings: z.array(
      z.discriminatedUnion("code", [
        z
          .object({
            id: z.string().min(1),
            code: z.literal("FINAL_VISUAL_LINE_WORD_BREAK"),
            cueId: z.string().min(1),
            lineBoundaryIndex: z.number().int().positive(),
            left: z.string(),
            right: z.string(),
            reasons: stringArraySchema,
          })
          .strict(),
        z
          .object({
            id: z.string().min(1),
            code: z.enum([
              "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
              "FINAL_CUE_EXCEEDS_TWO_LINES",
              "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
            ]),
            cueId: z.string().min(1),
            lineIndex: z.number().int().nonnegative().nullable(),
            observed: z.number().int().nonnegative(),
            maximum: z.number().int().positive(),
            reasons: stringArraySchema,
          })
          .strict(),
      ]),
    ),
    visualLineWordBreakCount: z.number().int().nonnegative(),
    lineTooLongCount: z.number().int().nonnegative().default(0),
    tooManyLinesCount: z.number().int().nonnegative().default(0),
    unresolvedCapacityCount: z.number().int().nonnegative().default(0),
    validationStatus: z.enum(["passed", "needs-review"]),
  })
  .strict();

export type LineLayoutIntegrityArtifact = z.infer<
  typeof lineLayoutIntegrityArtifactSchema
>;

export const presentationConstraintIntegrityArtifactSchema = z
  .object({
    schemaVersion: versionSchema,
    generatedAt: timestampSchema,
    inputHash: sha256Schema,
    cueCount: z.number().int().nonnegative(),
    maximumLines: z.number().int().positive(),
    maximumCharactersPerLine: z.number().int().positive(),
    lineTooLongCount: z.number().int().nonnegative(),
    tooManyLinesCount: z.number().int().nonnegative(),
    unresolvedCapacityCount: z.number().int().nonnegative(),
    musicPositionViolationCount: z.number().int().nonnegative(),
    musicItalicViolationCount: z.number().int().nonnegative(),
    fontSizeViolationCount: z.number().int().nonnegative(),
    findings: z.array(
      z
        .object({
          id: z.string().min(1),
          code: z.enum([
            "FINAL_LINE_EXCEEDS_CHARACTER_LIMIT",
            "FINAL_CUE_EXCEEDS_TWO_LINES",
            "FINAL_UNRESOLVED_PRESENTATION_CAPACITY",
            "FINAL_MUSIC_POSITION_VIOLATION",
            "FINAL_MUSIC_ITALIC_VIOLATION",
            "FINAL_ASS_FONT_SIZE_VIOLATION",
          ]),
          cueId: z.string().min(1).nullable(),
          reasons: stringArraySchema,
        })
        .strict(),
    ),
    validationStatus: z.enum(["passed", "needs-review"]),
  })
  .strict();

export type PresentationConstraintIntegrityArtifact = z.infer<
  typeof presentationConstraintIntegrityArtifactSchema
>;

export const textQualityCueCollectionSchema = z
  .object({
    cues: z.array(subtitleCueSchema),
  })
  .strict();
