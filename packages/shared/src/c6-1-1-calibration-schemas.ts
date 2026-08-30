import { z } from "zod";

const id = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
const finite = z.number();
const ratio = finite.min(0).max(1);
const interval = z
  .object({ start: finite.nonnegative(), end: finite.nonnegative() })
  .strict();
export const c611CalibrationVersion =
  "c6.1.1-fixed-alignment-selective-existing-mbr-v1" as const;
export const c611CalibrationProfileIdSchema = z.enum([
  "S0",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
]);
export const C611_CALIBRATION_FEATURE_NAMES = [
  "rawMbrMargin",
  "hierarchicalMbrMargin",
  "runnerUpMargin",
  "providerCode",
  "candidateRoleCode",
  "providerSupportCount",
  "correlationSupportCount",
  "whisperStability",
  "reazonStability",
  "crossModelAgreement",
  "ctcDirection",
  "ctcMargin",
  "tokenSupportCoverage",
  "decoderTruncationRisk",
  "hallucinationRisk",
  "requestEdgeRisk",
  "speechCompleteness",
  "characterLengthRatio",
  "tokenLengthRatio",
  "normalizedLcsCoverage",
  "deletedCharacterRatio",
  "insertedCharacterRatio",
  "prefixRetention",
  "suffixRetention",
  "longestDeletedSpanRatio",
  "longestInsertedSpanRatio",
  "eventDuration",
  "charactersPerSecond",
  "normalizedDistance",
  "spanApplicationSafe",
] as const;
export const c611CalibrationFeatureNameSchema = z.enum(
  C611_CALIBRATION_FEATURE_NAMES,
);
export const c611CalibrationPolicySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(c611CalibrationVersion),
    artifactType: z.literal("c6-1-1-calibration-policy"),
    outerFoldCount: count.min(2).max(5),
    innerFoldCount: count.min(2).max(5),
    neighborGapSeconds: finite.nonnegative(),
    foldConstruction: z.literal(
      "SOURCE_AUDIO_OVERLAP_NEIGHBOR_SHARED_CUE_CONTIGUOUS_GROUPS",
    ),
    foldAdaptation: z.literal("NO_LABEL_BASED_REPARTITION"),
    thresholdObjective: z.literal(
      "MIN_WRONG_ZERO_CATASTROPHIC_POSITIVE_GAIN_MIN_ACTIVE_THEN_COVERAGE",
    ),
    thresholdCandidates: z.literal("INNER_OOF_UNIQUE_SCORES_ONLY"),
    innerMinimumSelected: count.positive(),
    minimumSelectedFraction: ratio,
    outerMinimumSelected: count.positive(),
    l2: finite.positive(),
    learningRate: finite.positive(),
    iterations: count.positive(),
    tolerance: finite.positive(),
    singleClassPolicy: z.literal(
      "SMOOTHED_TRAIN_PRIOR_NO_ACTIVE_WITHOUT_INNER_GAIN",
    ),
    preprocessing: z.literal(
      "TRAIN_MEDIAN_TRAIN_MEAN_STD_PLUS_EXPLICIT_MISSING_FLAGS",
    ),
    preservationCosts: z.array(finite.nonnegative()).min(1),
    catastrophicDeletedRatio: ratio,
    catastrophicMinimumRegression: finite.positive(),
    ruleMarginScale: finite.positive(),
    ruleDeletionPenalty: finite.nonnegative(),
    profiles: z
      .array(
        z
          .object({
            profileId: c611CalibrationProfileIdSchema,
            name: id,
            modelType: z.enum([
              "NULL",
              "LEGACY",
              "RAW_MARGIN",
              "HIERARCHICAL_MARGIN",
              "PRESERVATION_MARGIN",
              "L2_LOGISTIC",
              "CONSERVATIVE_RULE",
            ]),
            featureNames: z.array(c611CalibrationFeatureNameSchema).max(30),
          })
          .strict(),
      )
      .length(8),
    semanticHash: sha,
  })
  .strict();
export const c611FoldUnitSchema = z
  .object({
    eventId: id,
    proposalId: id,
    sourceAudioIdentity: sha,
    sourceInterval: interval,
    acousticIntervals: z.array(interval),
    cueIntervals: z.array(interval),
    finalCueIds: z.array(id),
    sharedSpanKeys: z.array(id),
  })
  .strict();
export const c611CalibrationFoldsSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(c611CalibrationVersion),
    artifactType: z.literal("c6-1-1-calibration-folds"),
    frozenBeforeLabels: z.literal(true),
    policyHash: sha,
    unitHash: sha,
    units: z.array(c611FoldUnitSchema),
    requestedFoldCount: count.positive(),
    foldCount: count.positive(),
    status: z.enum(["READY", "INSUFFICIENT_INDEPENDENT_GROUPS"]),
    groups: z.array(
      z
        .object({
          groupId: id,
          eventIds: z.array(id),
          proposalIds: z.array(id),
          sourceAudioIdentity: sha,
          sourceInterval: interval,
          foldId: id,
        })
        .strict(),
    ),
    folds: z.array(
      z
        .object({
          foldId: id,
          groupIds: z.array(id),
          eventIds: z.array(id),
          proposalIds: z.array(id),
        })
        .strict(),
    ),
    audioLeakageCount: count,
    eventLeakageCount: count,
    cueLeakageCount: count,
    semanticHash: sha,
  })
  .strict();
export const c611CalibrationSampleSchema = z
  .object({
    proposalId: id,
    eventId: id,
    currentCandidateId: id.nullable(),
    proposedCandidateId: id.nullable(),
    eligibilityStatus: z.enum([
      "ELIGIBLE",
      "BLOCKED_STRUCTURAL",
      "NO_ALTERNATIVE",
    ]),
    values: z.record(z.string(), finite.nullable()),
    missingFlags: z.record(z.string(), z.boolean()),
    proposalHash: sha,
    featureHash: sha,
  })
  .strict();
export const c611CalibrationLabelSchema = z
  .object({
    proposalId: id,
    eventId: id,
    groupIds: z.array(id),
    groupIdentityHash: sha,
    outcome: z.enum([
      "SWITCH_IMPROVES",
      "SWITCH_REGRESSES",
      "SWITCH_NEUTRAL",
      "SWITCH_UNEVALUABLE",
    ]),
    baselineError: finite.nonnegative().nullable(),
    proposedError: finite.nonnegative().nullable(),
    exactGain: finite.nullable(),
    normalizedGain: finite.nullable(),
    semanticHash: sha,
  })
  .strict();
export const c611PreprocessColumnSchema = z
  .object({
    featureName: c611CalibrationFeatureNameSchema,
    observedCount: count,
    missingCount: count,
    imputedValue: finite,
    mean: finite,
    standardDeviation: finite.positive(),
    allMissing: z.boolean(),
  })
  .strict();
export const c611SelectiveModelSchema = z
  .object({
    profileId: c611CalibrationProfileIdSchema,
    modelType: id,
    policyHash: sha,
    trainingProposalIds: z.array(id),
    trainingEventIds: z.array(id),
    trainingDatasetHash: sha,
    featureNames: z.array(c611CalibrationFeatureNameSchema),
    preprocessing: z.array(c611PreprocessColumnSchema),
    coefficients: z.array(finite),
    intercept: finite,
    preservationCost: finite.nonnegative(),
    positiveCount: count,
    negativeCount: count,
    iterationsRun: count,
    status: z.enum([
      "FITTED",
      "SINGLE_CLASS",
      "NO_EVALUABLE_TRAINING",
      "NO_TRAINING_REQUIRED",
    ]),
    semanticHash: sha,
  })
  .strict();
export const c611DecisionSchema = z
  .object({
    profileId: c611CalibrationProfileIdSchema,
    eventId: id,
    proposalId: id,
    foldId: id,
    proposedCandidateId: id.nullable(),
    decisionScore: finite.nullable(),
    threshold: finite.nullable(),
    decision: z.enum([
      "KEEP_CURRENT",
      "SELECT_EXISTING_CANDIDATE",
      "ABSTAIN_REVIEW",
      "BLOCKED_STRUCTURAL",
      "UNEVALUABLE_FOR_CALIBRATION",
    ]),
    machineReasons: z.array(id),
    modelHash: sha,
    policyHash: sha,
    semanticHash: sha,
  })
  .strict();
export const c611ThresholdCandidateSchema = z
  .object({
    threshold: finite,
    preservationCost: finite.nonnegative(),
    selected: count,
    correct: count,
    wrong: count,
    neutral: count,
    catastrophic: count,
    normalizedGain: finite,
    exactGain: finite,
    qualified: z.boolean(),
  })
  .strict();
export const c611NestedCalibrationAuditSchema = z
  .object({
    profileId: c611CalibrationProfileIdSchema,
    outerFoldId: id,
    outerTrainingProposalIds: z.array(id),
    outerTestProposalIds: z.array(id),
    outerTrainingEventIds: z.array(id),
    outerTestEventIds: z.array(id),
    innerSplits: z.array(
      z
        .object({
          foldId: id,
          trainingProposalIds: z.array(id),
          testProposalIds: z.array(id),
          modelHash: sha,
          model: c611SelectiveModelSchema,
          preservationCost: finite.nonnegative(),
          predictions: z.array(
            z.object({ proposalId: id, score: finite.nullable() }).strict(),
          ),
        })
        .strict(),
    ),
    thresholdCandidates: z.array(c611ThresholdCandidateSchema),
    threshold: finite.nullable(),
    preservationCost: finite.nonnegative(),
    activeThresholdFound: z.boolean(),
    minimumInnerSelected: count,
    model: c611SelectiveModelSchema,
    trainTestIntersectionCount: count,
    semanticHash: sha,
  })
  .strict();
export const c611WilsonIntervalSchema = z
  .object({
    lower: ratio.nullable(),
    upper: ratio.nullable(),
    confidenceLevel: z.literal(0.95),
    n: count,
  })
  .strict();
export const c611SelectiveMetricsSchema = z
  .object({
    profileId: c611CalibrationProfileIdSchema,
    foldId: id.nullable(),
    metricUnit: z.literal("FROZEN_SINGLE_PROPOSAL_COUNTERFACTUAL"),
    sharedEvaluationGroupCount: count,
    eligibleProposalCount: count,
    evaluableProposalCount: count,
    selectedCount: count,
    evaluableSelectedCount: count,
    selectedUnevaluableCount: count,
    correctSwitchCount: count,
    wrongSwitchCount: count,
    neutralSwitchCount: count,
    blockedCount: count,
    abstainCount: count,
    precision: ratio.nullable(),
    harmRate: ratio.nullable(),
    selectiveCoverage: ratio.nullable(),
    allEligibleCoverage: ratio.nullable(),
    rawSelectedOverEvaluableRatio: finite.nonnegative().nullable(),
    normalizedEditGain: finite,
    exactEditGain: finite,
    oracleAvailableGain: finite.nonnegative(),
    oracleCaptureRate: finite.nullable(),
    candidateOracleAvailableGain: finite.nonnegative().nullable(),
    candidateOracleCaptureRate: finite.nullable(),
    catastrophicDeletionRegressionCount: count,
    minimumActiveSelected: count,
    modelClass: z.enum([
      "SAFE_NULL_BASELINE",
      "ACTIVE_SELECTIVE_MODEL",
      "INACTIVE_SELECTIVE_MODEL",
      "LEGACY_NONSELECTIVE_CONTROL",
    ]),
    wilson: c611WilsonIntervalSchema,
    semanticHash: sha,
  })
  .strict();
export const c611OofDecisionsSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    policyVersion: z.literal(c611CalibrationVersion),
    artifactType: z.literal("c6-1-1-out-of-fold-selective-decisions"),
    foldHash: sha,
    policyHash: sha,
    sampleHash: sha,
    evaluationRole: z.literal("KNOWN_BENCHMARK_NESTED_OOF_CALIBRATION"),
    decisions: z.array(c611DecisionSchema),
    calibrationAudits: z.array(c611NestedCalibrationAuditSchema),
    profileMetrics: z.array(c611SelectiveMetricsSchema),
    foldMetrics: z.array(c611SelectiveMetricsSchema),
    bestActiveProfile: c611CalibrationProfileIdSchema.nullable(),
    testLabelInputToPredictionCount: z.literal(0),
    fullDataPredictionCount: z.literal(0),
    semanticHash: sha,
  })
  .strict();
export type C611CalibrationProfileId = z.infer<
  typeof c611CalibrationProfileIdSchema
>;
export type C611CalibrationPolicy = z.infer<typeof c611CalibrationPolicySchema>;
export type C611FoldUnit = z.infer<typeof c611FoldUnitSchema>;
export type C611CalibrationFolds = z.infer<typeof c611CalibrationFoldsSchema>;
export type C611CalibrationSample = z.infer<typeof c611CalibrationSampleSchema>;
export type C611CalibrationLabel = z.infer<typeof c611CalibrationLabelSchema>;
export type C611SelectiveModel = z.infer<typeof c611SelectiveModelSchema>;
export type C611Decision = z.infer<typeof c611DecisionSchema>;
export type C611NestedCalibrationAudit = z.infer<
  typeof c611NestedCalibrationAuditSchema
>;
export type C611ThresholdCandidate = z.infer<
  typeof c611ThresholdCandidateSchema
>;
export type C611SelectiveMetrics = z.infer<typeof c611SelectiveMetricsSchema>;
export type C611OofDecisions = z.infer<typeof c611OofDecisionsSchema>;
