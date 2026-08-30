import { z } from "zod";
import {
  c60113RegionPriorityEntrySchema,
  c60113MissingClassificationSchema,
} from "./c6-0-1-13-review-rank-schemas.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const ratio = z.number().min(0).max(1);
const interval = z
  .object({ start: z.number().nonnegative(), end: z.number().positive() })
  .strict()
  .refine((v) => v.end > v.start);
const header = {
  schemaVersion: z.literal("1.0.0"),
  policyVersion: z.literal("c6.0.1.13-region-burden-calibration-v1"),
  generatedAt: z.iso.datetime(),
};

/** Closed vocabulary: identity, text and absolute source position cannot become predictors. */
export const c60113FeatureNames = [
  "missingSeverity",
  "hallucinationStrength",
  "timingStrength",
  "crossModelConflictStrength",
  "whisperInstability",
  "reazonInstability",
  "acousticMargin",
  "acousticScorability",
  "speechCompleteness",
  "requestEdgeRisk",
  "localizationQuality",
  "independentFamilyCount",
  "correlatedEvidenceCount",
  "affectedCueCount",
  "affectedEventCount",
  "candidateActionableCount",
  "orphanCount",
  "coreDurationSeconds",
  "contextDurationSeconds",
  "chronologicalIncrementalAudioSeconds",
  "neighborContextOverlapSeconds",
  "sceneCount",
  "speakerGroupCount",
  "positiveEvidenceStrength",
] as const;
export const c60113FeatureNameSchema = z.enum(c60113FeatureNames);
export const c60113FeatureValueSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("OBSERVED"), value: z.number() }).strict(),
  z.object({ status: z.literal("UNKNOWN"), value: z.null() }).strict(),
  z.object({ status: z.literal("UNAVAILABLE"), value: z.null() }).strict(),
]);
const featureRow = z
  .object({
    regionId: z.string().min(1),
    itemIds: z.array(z.string()),
    sourceInterval: interval,
    contextInterval: interval,
    sceneIds: z.array(z.string()),
    speakerGroupIds: z.array(z.string()),
    mandatory: z.boolean(),
    legacyItemPriority: z.number(),
    legacyRegionPriority: z.number(),
    missingCalibratedPriority: z.number(),
    deterministicRiskUtility: z.number().nonnegative(),
    crossModelDisagreement: z.boolean(),
    selectorEvidence: c60113RegionPriorityEntrySchema.nullable(),
    values: z.record(c60113FeatureNameSchema, c60113FeatureValueSchema),
    semanticHash: hash,
  })
  .strict();
export const c60113RegionFeaturesSchema = z
  .object({
    ...header,
    artifactType: z.literal("machine-review-region-features"),
    featureSchemaVersion: z.literal("c60113-structural-features-v1"),
    featureNames: z.array(c60113FeatureNameSchema),
    policyHash: hash,
    goldInputCount: z.literal(0),
    rawTextFeatureCount: z.literal(0),
    identityPredictorCount: z.literal(0),
    absoluteTimePredictorCount: z.literal(0),
    regions: z.array(featureRow),
    semanticHash: hash,
  })
  .strict();
const foldGroup = z
  .object({
    groupId: z.string(),
    regionIds: z.array(z.string()).min(1),
    timelineRange: interval,
    audioIntervalUnion: z.array(interval),
  })
  .strict();
export const c60113RankerFoldsSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-review-ranker-folds"),
    machineFeaturesHash: hash,
    frozenBeforeLabels: z.literal(true),
    construction: z.literal("CONTIGUOUS_AUDIO_CONNECTED_GROUPS_V1"),
    neighborhoodSeconds: z.number().nonnegative(),
    requestedFoldCount: z.literal(5),
    actualFoldCount: count,
    reason: z.string(),
    groups: z.array(foldGroup),
    folds: z.array(
      z
        .object({
          foldId: z.string(),
          regionIds: z.array(z.string()).min(1),
          groupIds: z.array(z.string()).min(1),
          timelineRanges: z.array(interval),
          audioIntervalUnion: z.array(interval),
        })
        .strict(),
    ),
    crossFoldAudioOverlapCount: count,
    semanticHash: hash,
  })
  .strict();
export const c60113RankerMachineFreezeSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-review-ranker-machine-freeze"),
    machineFeaturesHash: hash,
    foldsHash: hash,
    artifactHashes: z.record(z.string().min(1), hash),
    goldInputCount: z.literal(0),
    frozenBeforeLabels: z.literal(true),
    semanticHash: hash,
  })
  .strict();
export const c60113GoldLabelSchema = z.enum([
  "MATERIAL_TEXT_ERROR",
  "SEVERE_TIMING_ERROR",
  "HALLUCINATION",
  "MISSING_DIALOGUE",
  "OVERLAP_ERROR",
  "CLEAN_OR_MINOR",
]);
const errorComponent = z
  .object({
    errorComponentId: z.string(),
    labels: z.array(c60113GoldLabelSchema),
    coveredRegionIds: z.array(z.string()),
    coveredItemIds: z.array(z.string()),
    sourceInterval: interval.nullable(),
    foldId: z.string().nullable(),
  })
  .strict();
export const c60113RegionLabelsSchema = z
  .object({
    ...header,
    artifactType: z.literal("gold-review-region-labels"),
    use: z.literal("EVALUATION_CALIBRATION_ONLY"),
    datasetRole: z.literal("REVIEW_RANKER_CALIBRATION_DATASET"),
    machineFreezeHash: hash,
    machineFeaturesHash: hash,
    foldsHash: hash,
    sourceEvaluationHash: hash,
    regions: z.array(
      z
        .object({
          regionId: z.string(),
          labels: z.array(c60113GoldLabelSchema),
          errorComponentIds: z.array(z.string()),
          majorError: z.boolean(),
        })
        .strict(),
    ),
    errorComponents: z.array(errorComponent),
    unassignedErrorComponentCount: count,
    semanticHash: hash,
  })
  .strict();
export const c60113RankerNameSchema = z.enum([
  "R0_CURRENT_ITEM_PRIORITY",
  "R1_CURRENT_REGION_MAX",
  "R2_MISSING_CALIBRATED_DETERMINISTIC",
  "R3_REGION_RISK_DENSITY_V3",
  "R4_LINEAR_OOF_REGION_RANKER",
  "R0_CHRONOLOGICAL",
  "C60112_R3_FULL_EVIDENCE_RANK",
  "C60112_R2_DISAGREEMENT_ONLY",
]);
const preprocessing = z
  .object({
    featureNames: z.array(z.string()),
    medians: z.array(z.number()),
    means: z.array(z.number()),
    scales: z.array(z.number().positive()),
    fittedRegionIds: z.array(z.string()),
    missingValueEncoding: z.literal(
      "MEDIAN_PLUS_SEPARATE_UNKNOWN_UNAVAILABLE_INDICATORS",
    ),
  })
  .strict();
const model = z
  .object({
    modelType: z.literal("L2_LOGISTIC_REGRESSION"),
    preprocessing,
    coefficients: z.array(z.number()),
    intercept: z.number(),
    positiveClassWeight: z.number().positive(),
    negativeClassWeight: z.number().positive(),
    l2: z.number().positive(),
    iterations: count,
    classificationThreshold: ratio,
    trainingStatus: z.enum([
      "FITTED",
      "SINGLE_CLASS_CONSTANT",
      "NO_TRAINING_DATA",
    ]),
  })
  .strict();
export const c60113RankerOofSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-review-ranker-oof"),
    machineFreezeHash: hash,
    machineFeaturesHash: hash,
    foldsHash: hash,
    labelsHash: hash,
    scoreMeaning: z.literal("RANKING_SCORE_NOT_CALIBRATED_PROBABILITY"),
    predictions: z.array(
      z
        .object({
          regionId: z.string(),
          outerFold: z.string(),
          modelType: z.literal("L2_LOGISTIC_REGRESSION"),
          machineFeaturesHash: hash,
          rankingScore: ratio,
          rank: count,
          selectedAtBudgets: z.array(z.string()),
          semanticHash: hash,
        })
        .strict(),
    ),
    models: z.array(
      z
        .object({
          outerFold: z.string(),
          trainRegionIds: z.array(z.string()),
          testRegionIds: z.array(z.string()),
          model,
        })
        .strict(),
    ),
    formalMetricsOofOnly: z.literal(true),
    semanticHash: hash,
  })
  .strict();
const metric = z
  .object({
    budget: z.string(),
    budgetSeconds: z.number().nonnegative(),
    selectedRegionIds: z.array(z.string()),
    selectedRegionCount: count,
    selectedItemCount: count,
    clipSumSeconds: z.number().nonnegative(),
    uniqueUnionSeconds: z.number().nonnegative(),
    duplicateContextSeconds: z.number().nonnegative(),
    incrementalUniqueSeconds: z.array(z.number().nonnegative()),
    materialRecall: ratio,
    severeTimingRecall: ratio,
    hallucinationRecall: ratio,
    missingDialogueRecall: ratio,
    reviewPrecision: ratio,
    residualErrorRate: ratio,
    coveredErrorComponentIds: z.array(z.string()),
    totalMaterialErrors: count,
    totalSevereTimingErrors: count,
    totalHallucinations: count,
    totalMissingDialogue: count,
  })
  .strict();
export const c60113RegionRankingEvaluationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-region-ranking-evaluation"),
    machineFreezeHash: hash,
    labelsHash: hash,
    oofHash: hash,
    episodeDurationSeconds: z.number().positive(),
    formalLearnedMetricsOofOnly: z.literal(true),
    rankings: z.array(
      z
        .object({
          ranker: c60113RankerNameSchema,
          pooled: z.array(metric),
          folds: z.array(
            z
              .object({
                foldId: z.string(),
                hasMajorPositive: z.boolean(),
                metrics: z.array(metric),
                gainAt30VersusLegacy: z.number(),
                negativeGain: z.boolean(),
              })
              .strict(),
          ),
          meanMaterialTimingRecall: ratio,
          negativeFoldCount: count,
        })
        .strict(),
    ),
    selectedRanker: c60113RankerNameSchema,
    rankingResult: z.enum([
      "REGION_RANKER_STRONG_PASS",
      "REGION_RANKER_PROMISING",
      "REGION_RANKER_WEAK",
      "REGION_RANKER_UNSUPPORTED",
    ]),
    burdenResult: z.enum([
      "REVIEW_BURDEN_STRONG_REDUCTION",
      "REVIEW_BURDEN_PROMISING_REDUCTION",
      "REVIEW_BURDEN_NO_MEANINGFUL_REDUCTION",
      "REVIEW_BURDEN_REDUCTION_UNSAFE",
    ]),
    requiredUniqueAudioRatio: ratio,
    requiredSafetyRecall: z
      .object({ hallucination: ratio, missingDialogue: ratio })
      .strict(),
    learnedFreezeEligible: z.boolean(),
    selectionReasons: z.array(z.string()),
    missedSafetyComponents: z.array(
      z
        .object({
          errorComponentId: z.string(),
          labels: z.array(c60113GoldLabelSchema),
          coveredRegionIds: z.array(z.string()),
          reason: z.string(),
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
export const c60113RegionRankerFreezeSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-region-ranker-freeze"),
    rankerType: z.enum(["L2_LOGISTIC_REGRESSION", "REGION_RISK_DENSITY_V3"]),
    featureSchemaVersion: z.literal("c60113-structural-features-v1"),
    featureNames: z.array(c60113FeatureNameSchema),
    model: model.nullable(),
    rankingPolicy: z.literal("c6.0.1.13-region-burden-calibration-v1"),
    mandatoryPolicy: z.literal("POSITIVE_SAFETY_EVIDENCE_ONLY"),
    burdenSelectionPolicy: z.literal(
      "MARGINAL_UNIQUE_AUDIO_GREEDY_FIXED_OVERHEAD_V1",
    ),
    fixedReviewOverheadSeconds: z.number().positive(),
    trainingDatasetHash: hash.nullable(),
    foldsHash: hash,
    oofHash: hash,
    evaluationHash: hash,
    use: z.literal("FUTURE_UNREVIEWED_EPISODES_ONLY"),
    episodeOneProspectiveClaim: z.literal(false),
    reason: z.string(),
    semanticHash: hash,
  })
  .strict();
export const c60113DataQualityAuditSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-data-quality-audit"),
    machineFeaturesHash: hash,
    foldsHash: hash,
    labelsHash: hash,
    checks: z.array(
      z.object({ checkId: z.string(), passed: z.boolean(), count }).strict(),
    ),
    featureAvailability: z.array(
      z
        .object({
          featureName: c60113FeatureNameSchema,
          observedCount: count,
          trueZeroCount: count,
          unknownCount: count,
          unavailableCount: count,
        })
        .strict(),
    ),
    foldClassBalance: z.array(
      z
        .object({
          foldId: z.string(),
          positiveCount: count,
          negativeCount: count,
          noMajorPositive: z.boolean(),
        })
        .strict(),
    ),
    passed: z.boolean(),
    semanticHash: hash,
  })
  .strict();

export type C60113RegionFeatures = z.infer<typeof c60113RegionFeaturesSchema>;
export type C60113FeatureName = (typeof c60113FeatureNames)[number];
export type C60113FeatureValue = z.infer<typeof c60113FeatureValueSchema>;
export type C60113RankerFolds = z.infer<typeof c60113RankerFoldsSchema>;
export type C60113RankerMachineFreeze = z.infer<
  typeof c60113RankerMachineFreezeSchema
>;
export type C60113RegionLabels = z.infer<typeof c60113RegionLabelsSchema>;
export type C60113RankerOof = z.infer<typeof c60113RankerOofSchema>;
export type C60113RegionRankingEvaluation = z.infer<
  typeof c60113RegionRankingEvaluationSchema
>;
export type C60113RegionRankerFreeze = z.infer<
  typeof c60113RegionRankerFreezeSchema
>;
export type C60113DataQualityAudit = z.infer<
  typeof c60113DataQualityAuditSchema
>;
export type C60113RankingName = z.infer<typeof c60113RankerNameSchema>;

/** Deployable parameters contain no training-row identity, label or evaluation hash. */
export const c60113DeploymentRankerSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    deploymentVersion: z.literal("c6.0.1.13-region-ranker-deployment-v1"),
    rankerType: z.enum(["L2_LOGISTIC_REGRESSION", "REGION_RISK_DENSITY_V3"]),
    featureSchemaVersion: z.literal("c60113-structural-features-v1"),
    featureNames: z.array(c60113FeatureNameSchema),
    rankingPolicy: z.literal("c6.0.1.13-region-burden-calibration-v1"),
    mandatoryPolicy: z.literal("POSITIVE_SAFETY_EVIDENCE_ONLY"),
    burdenSelectionPolicy: z.literal(
      "MARGINAL_UNIQUE_AUDIO_GREEDY_FIXED_OVERHEAD_V1",
    ),
    fixedReviewOverheadSeconds: z.literal(8),
    model: z
      .object({
        coefficients: z.array(z.number()).length(c60113FeatureNames.length * 3),
        intercept: z.number(),
        preprocessing: z
          .object({
            featureNames: z
              .array(z.string())
              .length(c60113FeatureNames.length * 3),
            medians: z.array(z.number()).length(c60113FeatureNames.length),
            means: z.array(z.number()).length(c60113FeatureNames.length * 3),
            scales: z
              .array(z.number().positive())
              .length(c60113FeatureNames.length * 3),
            missingValueEncoding: z.literal(
              "MEDIAN_PLUS_SEPARATE_UNKNOWN_UNAVAILABLE_INDICATORS",
            ),
          })
          .strict(),
      })
      .strict()
      .nullable(),
    semanticHash: hash,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedNames = c60113FeatureNames.flatMap((name) => [
      name,
      `${name}__unknown`,
      `${name}__unavailable`,
    ]);
    if (
      JSON.stringify(value.featureNames) !== JSON.stringify(c60113FeatureNames)
    )
      context.addIssue({
        code: "custom",
        message: "Deployment feature order changed",
      });
    if (
      (value.rankerType === "L2_LOGISTIC_REGRESSION") !==
      (value.model !== null)
    )
      context.addIssue({
        code: "custom",
        message: "Deployment model/ranker type mismatch",
      });
    if (
      value.model &&
      JSON.stringify(value.model.preprocessing.featureNames) !==
        JSON.stringify(expectedNames)
    )
      context.addIssue({
        code: "custom",
        message: "Deployment expanded feature order changed",
      });
  });
export type C60113DeploymentRanker = z.infer<
  typeof c60113DeploymentRankerSchema
>;

export const c60113PostFreezeEvaluationAuditSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-post-freeze-evaluation-audit"),
    machineFreezeHash: hash,
    ablationFreezeHash: hash,
    machineFeaturesHash: hash,
    foldsHash: hash,
    firstGoldReadAt: z.iso.datetime(),
    frozenMachineFilesVerifiedBeforeGoldRead: z.literal(true),
    frozenMachineFileCount: count,
    frozenMachineFilesUnchanged: z.boolean(),
    sourceIdentityBefore: z
      .object({
        sha256: hash,
        size: count,
        mtimeMs: z.number().nonnegative(),
        inode: count,
      })
      .strict(),
    sourceIdentityAfter: z
      .object({
        sha256: hash,
        size: count,
        mtimeMs: z.number().nonnegative(),
        inode: count,
      })
      .strict(),
    goldIdentityBefore: z
      .object({
        sha256: hash,
        size: count,
        mtimeMs: z.number().nonnegative(),
        inode: count,
      })
      .strict(),
    goldIdentityAfter: z
      .object({
        sha256: hash,
        size: count,
        mtimeMs: z.number().nonnegative(),
        inode: count,
      })
      .strict(),
    qualityEvaluationSha256: hash,
    goldEvaluationSha256: hash,
    upstreamEvaluationFilesUnchanged: z.boolean(),
    sourceReadOnly: z.boolean(),
    goldReadOnly: z.boolean(),
    runtimeGoldInputCount: z.literal(0),
    evaluatorGoldInputCount: z.literal(1),
    asrInferenceCount: z.literal(0),
    networkUsed: z.literal(false),
    candidateFixabilityReevaluated: z.literal(false),
    evaluatedStages: z
      .array(z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]))
      .length(8),
    semanticHash: hash,
  })
  .strict();
export const c60113AblationEvaluationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-ablation-evaluation"),
    ablationFreezeHash: hash,
    sourceQualityEvaluationHash: hash,
    sameUniqueErrorDenominator: z.literal(true),
    uniqueErrorComponentCount: count,
    stages: z
      .array(
        z
          .object({
            stage: z.enum(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]),
            featuresHash: hash,
            foldsHash: hash,
            machineFreezeHash: hash,
            labelsHash: hash,
            selectionSource: z.enum([
              "NATIVE_LEGACY_R3_STATIC_ORDER",
              "FROZEN_NATIVE_MACHINE_BURDEN_PLANS",
              "HELD_OUT_OOF_SCORES",
              "SELECTED_OOF_OR_DETERMINISTIC_NOT_FUTURE_IN_SAMPLE",
            ]),
            learnedEvaluationSourceFreezeHash: hash.nullable(),
            itemCount: count,
            regionCount: count,
            requiredItemCount: count,
            requiredRegionCount: count,
            metrics: z.array(metric),
            foldMetrics: z.array(
              z
                .object({ foldId: z.string(), metrics: z.array(metric) })
                .strict(),
            ),
            foldMetricBasis: z.enum([
              "GLOBAL_PLAN_PROJECTED_TO_FOLD",
              "FOLD_LOCAL_UNIQUE_AUDIO_BUDGET",
            ]),
            uniqueErrorComponentCount: count,
          })
          .strict(),
      )
      .length(8),
    semanticHash: hash,
  })
  .strict();
export type C60113AblationEvaluation = z.infer<
  typeof c60113AblationEvaluationSchema
>;

export const c60113MissingEvidenceEvaluationSchema = z
  .object({
    ...header,
    artifactType: z.literal("c6-0-1-13-missing-evidence-evaluation"),
    machineFreezeHash: hash,
    missingEvidenceHash: hash,
    labelsHash: hash,
    evaluationOnly: z.literal(true),
    classificationChangedByGold: z.literal(false),
    denominatorMeaning: z.literal(
      "DISTINCT_GAPS_AND_DISTINCT_LEGACY_ITEMS_REPORTED_SEPARATELY",
    ),
    totalGoldMissingComponents: count,
    legacyMissingItemCount: count,
    deduplicatedGapCount: count,
    legacyTruePositiveItemCount: count,
    legacyFalsePositiveItemCount: count,
    legacyItemPrecision: ratio.nullable(),
    anyGapCapturedMissingComponentCount: count,
    anyGapRecall: ratio,
    strongCapturedMissingComponentCount: count,
    strongRecall: ratio,
    classifications: z.array(
      z
        .object({
          classification: c60113MissingClassificationSchema,
          gapCount: count,
          truePositiveGapCount: count,
          falsePositiveGapCount: count,
          precisionIfTreatedAsMissing: ratio.nullable(),
          capturedMissingComponentIds: z.array(z.string()),
          recall: ratio,
        })
        .strict(),
    ),
    components: z.array(
      z
        .object({
          errorComponentId: z.string(),
          sourceInterval: interval.nullable(),
          capturedByAnyGap: z.boolean(),
          capturedByStrong: z.boolean(),
          gapIds: z.array(z.string()),
          legacyItemIds: z.array(z.string()),
          classifications: z.array(c60113MissingClassificationSchema),
          evidenceGapReason: z.string(),
        })
        .strict(),
    ),
    semanticHash: hash,
  })
  .strict();
