import { z } from "zod";

import {
  reviewDecisionTypeSchema,
  reviewItemTypeSchema,
  reviewPriorityTierSchema,
  reviewReasonSchema,
  reviewRequiredLevelSchema,
} from "./c6-0-1-12-review-assistance-schemas.js";

export const c60113PolicyVersion =
  "c6.0.1.13-region-burden-calibration-v1" as const;
export const c60113Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const c60113CountSchema = z.number().int().nonnegative();
export const c60113RatioSchema = z.number().min(0).max(1);
export const c60113IntervalSchema = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((value) => value.end > value.start, "Invalid interval order");
export const c60113MachineArtifactHeader = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal(c60113PolicyVersion),
  policyHash: c60113Sha256Schema,
  sourceTimebase: z.literal("SOURCE_GLOBAL_SECONDS"),
  runtimeGoldInputCount: z.literal(0),
} as const;

export const c60113MissingClassificationSchema = z.enum([
  "SPEECH_GAP_OBSERVED",
  "MISSING_DIALOGUE_POSSIBLE",
  "MISSING_DIALOGUE_STRONG",
  "MISSING_DIALOGUE_CONTRADICTED",
  "MISSING_DIALOGUE_UNRESOLVED",
]);
export const c60113EvidenceFamilySchema = z.enum([
  "SPEECH_ACTIVITY",
  "ASR_LEXICAL_CONTENT",
  "CUE_COVERAGE",
  "NEIGHBOR_CONTINUITY",
  "SPEAKER_ACTIVITY",
  "CROSS_MODEL_CONTENT",
  "MUSIC_LYRICS_CONTRADICTION",
  "LOCALIZATION",
  "WHISPER_STABILITY",
  "REAZON_STABILITY",
  "ACOUSTIC_ALIGNMENT",
  "DECODER",
  "TIMING_BOUNDARY",
  "HALLUCINATION",
  "OVERLAP",
  "STRUCTURAL_INTEGRITY",
]);
export const c60113MandatorySafetyClassSchema = z.enum([
  "NONE",
  "STRONG_HALLUCINATION",
  "STRONG_MISSING",
  "STRONG_TIMING",
  "STRONG_OVERLAP",
  "STRUCTURAL_CORRUPTION",
]);
export const c60113PriorityVectorSchema = z
  .object({
    mandatorySafetyClass: c60113MandatorySafetyClassSchema,
    positiveEvidenceStrength: c60113RatioSchema,
    independentEvidenceFamilyCount: c60113CountSchema,
    errorTypeSeverity: c60113RatioSchema,
    crossModelConflictStrength: c60113RatioSchema,
    hallucinationStrength: c60113RatioSchema,
    missingStrength: c60113RatioSchema,
    timingStrength: c60113RatioSchema,
    candidateActionability: c60113RatioSchema,
    localizationQuality: c60113RatioSchema.nullable(),
    estimatedReviewCost: z.number().positive(),
    sourceTime: z.number().nonnegative(),
  })
  .strict();

export const c60113EvidenceObservationSchema = z
  .object({
    evidenceId: z.string().min(1),
    rootLineageIds: z.array(z.string().min(1)).min(1),
    family: c60113EvidenceFamilySchema,
    provider: z.string().min(1).nullable(),
    correlationGroup: z.string().min(1),
    itemIds: z.array(z.string().min(1)),
    gapIds: z.array(z.string().min(1)),
    sourceInterval: c60113IntervalSchema.nullable(),
    positiveRisk: z.boolean(),
    evidenceAbsence: z.boolean(),
    contradiction: z.boolean(),
    strength: c60113RatioSchema,
    validatedSourceGlobal: z.boolean(),
    detailCode: z.string().min(1),
    semanticHash: c60113Sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceAbsence && (value.positiveRisk || value.strength !== 0)) {
      context.addIssue({
        code: "custom",
        message: "Evidence absence cannot contribute positive risk strength",
      });
    }
  });

const correlationGroupSchema = z
  .object({
    groupId: z.string().min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
    rootLineageIds: z.array(z.string().min(1)).min(1),
    families: z.array(c60113EvidenceFamilySchema).min(1),
  })
  .strict();

export const c60113EvidenceFamilyGraphSchema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-review-evidence-families"),
    evidence: z.array(c60113EvidenceObservationSchema),
    correlationGroups: z.array(correlationGroupSchema),
    summary: z
      .object({
        evidenceCount: c60113CountSchema,
        familyCount: c60113CountSchema,
        correlationGroupCount: c60113CountSchema,
        correlatedEvidenceDeduplicatedCount: c60113CountSchema,
        duplicateEvidenceInputCount: c60113CountSchema,
        evidenceAbsenceCount: c60113CountSchema,
        evidenceAbsenceRiskBoostCount: z.literal(0),
      })
      .strict(),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113MissingGapSchema = z
  .object({
    gapId: z.string().min(1),
    sourceInterval: c60113IntervalSchema,
    itemIds: z.array(z.string().min(1)),
    legacySignal: z.boolean(),
    legacyMappedClassification: z.literal("SPEECH_GAP_OBSERVED").nullable(),
    observedSpeechEvidence: z.array(z.string().min(1)),
    lexicalEvidence: z.array(z.string().min(1)),
    cueCoverageEvidence: z.array(z.string().min(1)),
    neighboringEvidence: z.array(z.string().min(1)),
    speakerEvidence: z.array(z.string().min(1)),
    contradictionEvidence: z.array(z.string().min(1)),
    evidenceFamilies: z.array(c60113EvidenceFamilySchema),
    independentFamilyCount: c60113CountSchema,
    correlatedEvidenceGroups: z.array(correlationGroupSchema),
    validatedSourceGlobal: z.boolean(),
    cueCoveredRatio: c60113RatioSchema,
    classification: c60113MissingClassificationSchema,
    reviewLevel: reviewRequiredLevelSchema,
    reasons: z.array(z.string().min(1)).min(1),
    semanticHash: c60113Sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classification === "MISSING_DIALOGUE_STRONG" &&
      (!value.validatedSourceGlobal ||
        value.observedSpeechEvidence.length === 0 ||
        value.lexicalEvidence.length === 0 ||
        value.independentFamilyCount < 3 ||
        value.contradictionEvidence.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Strong missing evidence is incomplete",
      });
    }
    if (
      value.reviewLevel === "REQUIRED" &&
      value.classification !== "MISSING_DIALOGUE_STRONG"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only strong missing is mandatory",
      });
    }
  });

export const c60113MissingSpeechEvidenceSchema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-missing-speech-evidence-v2"),
    gaps: z.array(c60113MissingGapSchema),
    summary: z
      .object({
        gapCount: c60113CountSchema,
        legacyMissingItemCount: c60113CountSchema,
        observedCount: c60113CountSchema,
        possibleCount: c60113CountSchema,
        strongCount: c60113CountSchema,
        contradictedCount: c60113CountSchema,
        unresolvedCount: c60113CountSchema,
        independentFamilyMean: z.number().nonnegative(),
        correlatedEvidenceDeduplicatedCount: c60113CountSchema,
      })
      .strict(),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113ReviewItemV3Schema = z
  .object({
    reviewItemId: z.string().min(1),
    eventIds: z.array(z.string().min(1)),
    finalCueIds: z.array(z.string().min(1)),
    itemTypes: z.array(reviewItemTypeSchema).min(1),
    sourceInterval: c60113IntervalSchema,
    coreInterval: c60113IntervalSchema,
    currentText: z.string().nullable(),
    candidateIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    reviewReasons: z.array(reviewReasonSchema).min(1),
    priorityTier: reviewPriorityTierSchema,
    priorityScore: z.number().min(0).max(100),
    displayPriorityScore: z.number().min(0).max(100),
    priorityVector: c60113PriorityVectorSchema,
    structuredRankKey: z.array(z.number()),
    rankPosition: z.number().int().positive(),
    requiredLevel: reviewRequiredLevelSchema,
    mandatoryReasons: z.array(z.string().min(1)),
    suggestedActions: z.array(reviewDecisionTypeSchema).min(1),
    sceneIds: z.array(z.string().min(1)),
    speakerGroupIds: z.array(z.string().min(1)),
    missingClassification: c60113MissingClassificationSchema.nullable(),
    missingGapIds: z.array(z.string().min(1)),
    independentEvidenceFamilies: z.array(c60113EvidenceFamilySchema),
    evidenceCorrelationGroups: z.array(z.string().min(1)),
    uncertaintyReasons: z.array(z.string().min(1)),
    legacySemanticHash: c60113Sha256Schema,
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113ScoreDistributionSchema = z
  .object({
    itemCount: c60113CountSchema,
    maxScore: z.number().min(0).max(100),
    maxScoreItemCount: c60113CountSchema,
    largestTieGroupCount: c60113CountSchema,
    uniqueScoreCount: c60113CountSchema,
    uniqueStructuredRankCount: c60113CountSchema,
    scoreEntropy: z.number().nonnegative(),
    maxScoreShare: c60113RatioSchema,
    genuineMandatoryMaxTie: z.boolean(),
    distribution: z.array(
      z.object({ score: z.number(), count: c60113CountSchema }).strict(),
    ),
  })
  .strict();

export const c60113ReviewItemsV3Schema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-review-items-v3"),
    evidenceFamiliesHash: c60113Sha256Schema,
    missingEvidenceHash: c60113Sha256Schema,
    items: z.array(c60113ReviewItemV3Schema),
    summary: z
      .object({
        itemCount: c60113CountSchema,
        requiredItemCount: c60113CountSchema,
        recommendedItemCount: c60113CountSchema,
        informationalItemCount: c60113CountSchema,
        criticalItemCount: c60113CountSchema,
        scoreDistribution: c60113ScoreDistributionSchema,
      })
      .strict(),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113ReviewRegionV2Schema = z
  .object({
    regionId: z.string().min(1),
    reviewItemIds: z.array(z.string().min(1)).min(1),
    eventIds: z.array(z.string().min(1)),
    finalCueIds: z.array(z.string().min(1)),
    sourceInterval: c60113IntervalSchema,
    contextInterval: c60113IntervalSchema,
    contextStart: z.number().nonnegative(),
    contextEnd: z.number().positive(),
    coreIntervals: z
      .array(
        z
          .object({
            reviewItemId: z.string().min(1),
            start: z.number().nonnegative(),
            end: z.number().positive(),
          })
          .strict(),
      )
      .min(1),
    maxPriority: z
      .object({
        tier: reviewPriorityTierSchema,
        score: z.number().min(0).max(100),
      })
      .strict(),
    aggregateReasons: z.array(reviewReasonSchema),
    itemTypes: z.array(reviewItemTypeSchema),
    requiredLevel: reviewRequiredLevelSchema,
    mandatoryReasons: z.array(z.string().min(1)),
    independentEvidenceFamilies: z.array(c60113EvidenceFamilySchema),
    sceneIds: z.array(z.string().min(1)),
    speakerGroupIds: z.array(z.string().min(1)),
    mergeReasons: z.array(z.string().min(1)),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113ReviewRegionsV2Schema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-review-regions-v2"),
    itemsHash: c60113Sha256Schema,
    sourceDurationSeconds: z.number().positive(),
    regions: z.array(c60113ReviewRegionV2Schema),
    summary: z
      .object({
        itemCount: c60113CountSchema,
        regionCount: c60113CountSchema,
        requiredRegionCount: c60113CountSchema,
        clipSumSeconds: z.number().nonnegative(),
        uniqueUnionSeconds: z.number().nonnegative(),
        duplicateContextSeconds: z.number().nonnegative(),
      })
      .strict(),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113RegionPriorityEntrySchema = z
  .object({
    regionId: z.string().min(1),
    itemIds: z.array(z.string().min(1)).min(1),
    sourceInterval: c60113IntervalSchema,
    contextInterval: c60113IntervalSchema,
    itemRiskSummary: z
      .object({
        uniqueAffectedCueCount: c60113CountSchema,
        uniqueEventCount: c60113CountSchema,
        independentRiskGroupCount: c60113CountSchema,
        mandatoryItemCount: c60113CountSchema,
        missingClassifications: z.array(c60113MissingClassificationSchema),
      })
      .strict(),
    independentEvidenceFamilies: z.array(c60113EvidenceFamilySchema),
    mandatoryReasons: z.array(z.string().min(1)),
    candidateActionableCount: c60113CountSchema,
    estimatedUniqueAudioSeconds: z.number().nonnegative(),
    priorityVector: c60113PriorityVectorSchema,
    rankScore: z.number().nonnegative(),
    rankPosition: z.number().int().positive(),
    riskCoverageKeys: z.array(z.string().min(1)),
    actionableCoverageKeys: z.array(z.string().min(1)),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113RegionReviewPrioritySchema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-region-review-priority"),
    ranker: z.literal("REGION_RISK_DENSITY_V3"),
    scoreMeaning: z.literal("EXPLAINABLE_RANKING_SCORE_NOT_PROBABILITY"),
    regionsHash: c60113Sha256Schema,
    regions: z.array(c60113RegionPriorityEntrySchema),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113PlaybackSegmentSchema = z
  .object({
    segmentId: z.string().min(1),
    sourceInterval: c60113IntervalSchema,
    regionIds: z.array(z.string().min(1)).min(1),
    itemIds: z.array(z.string().min(1)).min(1),
    semanticHash: c60113Sha256Schema,
  })
  .strict();
export const c60113ReviewPlaybackTimelineSchema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-review-playback-timeline"),
    regionsHash: c60113Sha256Schema,
    sourceDurationSeconds: z.number().positive(),
    segments: z.array(c60113PlaybackSegmentSchema),
    regionMappings: z.array(
      z
        .object({
          regionId: z.string().min(1),
          segmentIds: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    clipSumSeconds: z.number().nonnegative(),
    uniqueUnionSeconds: z.number().nonnegative(),
    duplicateContextSeconds: z.number().nonnegative(),
    semanticHash: c60113Sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    value.segments.forEach((segment, index) => {
      const previous = value.segments[index - 1];
      if (
        previous !== undefined &&
        previous.sourceInterval.end > segment.sourceInterval.start
      ) {
        context.addIssue({
          code: "custom",
          message: "Playback segments must be non-overlapping",
        });
      }
      if (segment.sourceInterval.end > value.sourceDurationSeconds) {
        context.addIssue({
          code: "custom",
          message: "Playback segment exceeds source duration",
        });
      }
    });
  });

export const c60113BurdenSelectionStepSchema = z
  .object({
    rankPosition: z.number().int().positive(),
    regionId: z.string().min(1),
    incrementalPlaybackSeconds: z.number().nonnegative(),
    cumulativeUniqueAudioSeconds: z.number().nonnegative(),
    marginalUtility: z.number().nonnegative(),
    utilityPerCost: z.number().nonnegative(),
    newRiskCoverageCount: c60113CountSchema,
    newActionableCoverageCount: c60113CountSchema,
    newMandatoryCoverageCount: c60113CountSchema,
    redundancyPenalty: z.number().nonnegative(),
    fixedReviewOverheadSeconds: z.number().positive(),
  })
  .strict();
export const c60113BurdenPlanSchema = z
  .object({
    planId: z.string().min(1),
    budgetSeconds: z.number().nonnegative().nullable(),
    budgetKind: z.enum([
      "EPISODE_UNIQUE_AUDIO_PERCENT",
      "FIXED_SECONDS",
      "ALL_MANDATORY",
      "FULL_QUEUE",
    ]),
    regionIds: z.array(z.string().min(1)),
    itemIds: z.array(z.string().min(1)),
    selectionSteps: z.array(c60113BurdenSelectionStepSchema),
    clipSumSeconds: z.number().nonnegative(),
    uniqueUnionSeconds: z.number().nonnegative(),
    duplicateContextSeconds: z.number().nonnegative(),
    mandatoryRegionCount: c60113CountSchema,
    unselectedMandatoryRegionIds: z.array(z.string().min(1)),
    semanticHash: c60113Sha256Schema,
  })
  .strict();
export const c60113ReviewBurdenPlansSchema = z
  .object({
    ...c60113MachineArtifactHeader,
    artifactType: z.literal("c6-0-1-13-machine-review-burden-plans"),
    regionPriorityHash: c60113Sha256Schema,
    sourceDurationSeconds: z.number().positive(),
    selectionPolicy: z.literal(
      "RECOMPUTED_MARGINAL_MACHINE_RISK_PER_UNIQUE_AUDIO_COST",
    ),
    plans: z.array(c60113BurdenPlanSchema),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export const c60113ReviewPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(c60113PolicyVersion),
    artifactType: z.literal("c6-0-1-13-review-rank-policy"),
    productRoute: z.literal("HUMAN_ON_EXCEPTION"),
    missingSpeech: z
      .object({
        minimumIndependentStrongFamilies: z.literal(3),
        maximumCoveredRatioForMissing: c60113RatioSchema,
        lexicalMinimumIntervalCoverage: c60113RatioSchema,
        strongContradictionThreshold: c60113RatioSchema,
        legacyDefault: z.literal("SPEECH_GAP_OBSERVED"),
      })
      .strict(),
    evidenceCorrelation: z
      .object({
        sharedRootIsCorrelated: z.literal(true),
        sameProviderFamilyIsCorrelated: z.literal(true),
        absenceRiskWeight: z.literal(0),
        independentBreadth: z.literal("DISTINCT_FAMILY_DISJOINT_ROOT_MATCHING"),
      })
      .strict(),
    mandatoryRules: z
      .object({
        strongEvidenceThreshold: c60113RatioSchema,
        minimumTimingFamilies: z.number().int().positive(),
        requiredSeparatedFromDisplayScore: z.literal(true),
      })
      .strict(),
    itemPriority: z
      .object({
        mainOrder: z.literal("STRUCTURED_VECTOR"),
        displayMeaning: z.literal("NOT_PROBABILITY"),
        reasonCountBoost: z.literal(0),
      })
      .strict(),
    regionMerge: z
      .object({
        maximumCoreSeconds: z.number().positive(),
        maximumGapSeconds: z.number().nonnegative(),
        minimumContextOverlapRatio: c60113RatioSchema,
        maximumIncrementalSeconds: z.number().positive(),
        preContextSeconds: z.number().nonnegative(),
        postContextSeconds: z.number().nonnegative(),
        preserveScene: z.literal(true),
        preserveSpeaker: z.literal(true),
        preserveCategory: z.literal(true),
      })
      .strict(),
    regionAggregation: z.literal("DEDUPLICATED_RISK_FAMILIES_CUES_EVENTS_COST"),
    playbackUnion: z.literal("SOURCE_GLOBAL_HALF_OPEN_SORTED_MERGED"),
    marginalUtility: z
      .object({
        riskWeight: z.number().nonnegative(),
        mandatoryWeight: z.number().nonnegative(),
        actionableWeight: z.number().nonnegative(),
        redundancyPenaltyWeight: z.number().nonnegative(),
        fixedReviewOverheadSeconds: z.number().positive(),
        minimumAudioCostSeconds: z.number().positive(),
      })
      .strict(),
    percentBudgets: z.array(z.number().int().min(1).max(100)),
    fixedSecondsBudgets: z.array(z.number().positive()),
    fallbackRanker: z.literal("REGION_RISK_DENSITY_V3"),
    goldBarrier: z
      .object({
        runtimeGoldInputAllowed: z.literal(false),
        freezeBeforeLabels: z.literal(true),
        foldsBeforeLabels: z.literal(true),
        sameVersionRetuneAllowed: z.literal(false),
      })
      .strict(),
    prospectiveTrial: z
      .object({
        priorGoldExposureDisqualifies: z.literal(true),
        realHumanEpisodeOneTrialAllowed: z.literal(false),
        instrumentationIsNotMeasuredHumanTime: z.literal(true),
      })
      .strict(),
    semanticHash: c60113Sha256Schema,
  })
  .strict();

export type C60113Interval = z.infer<typeof c60113IntervalSchema>;
export type C60113MissingClassification = z.infer<
  typeof c60113MissingClassificationSchema
>;
export type C60113EvidenceFamily = z.infer<typeof c60113EvidenceFamilySchema>;
export type C60113EvidenceObservation = z.infer<
  typeof c60113EvidenceObservationSchema
>;
export type C60113EvidenceFamilyGraph = z.infer<
  typeof c60113EvidenceFamilyGraphSchema
>;
export type C60113MissingSpeechEvidence = z.infer<
  typeof c60113MissingSpeechEvidenceSchema
>;
export type C60113MissingGap = z.infer<typeof c60113MissingGapSchema>;
export type C60113PriorityVector = z.infer<typeof c60113PriorityVectorSchema>;
export type C60113ReviewItemV3 = z.infer<typeof c60113ReviewItemV3Schema>;
export type C60113ReviewItemsV3 = z.infer<typeof c60113ReviewItemsV3Schema>;
export type C60113ReviewRegionV2 = z.infer<typeof c60113ReviewRegionV2Schema>;
export type C60113ReviewRegionsV2 = z.infer<typeof c60113ReviewRegionsV2Schema>;
export type C60113RegionPriorityEntry = z.infer<
  typeof c60113RegionPriorityEntrySchema
>;
export type C60113RegionReviewPriority = z.infer<
  typeof c60113RegionReviewPrioritySchema
>;
export type C60113ReviewPlaybackTimeline = z.infer<
  typeof c60113ReviewPlaybackTimelineSchema
>;
export type C60113BurdenPlan = z.infer<typeof c60113BurdenPlanSchema>;
export type C60113ReviewBurdenPlans = z.infer<
  typeof c60113ReviewBurdenPlansSchema
>;
export type C60113ReviewPolicy = z.infer<typeof c60113ReviewPolicySchema>;
