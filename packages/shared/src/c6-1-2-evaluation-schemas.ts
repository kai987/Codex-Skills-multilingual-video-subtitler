import { z } from "zod";
import {
  c612Artifact as art,
  c612Id as id,
  c612Hash as sha,
  c612Count as count,
  c612Number as num,
  c612Ratio as ratio,
  c612File as file,
  c612Check as check,
  c612Retrieval as retrieval,
  c612MappingStatus,
} from "./c6-1-2-top-k-reranking-schemas.js";
const local = {
  evaluationOnly: z.literal(true),
  privacy: z.literal("LOCAL_ONLY"),
  machineFreezeHash: sha,
};
export const c612OutcomeSchema = z.enum([
  "IMPROVED",
  "REGRESSED",
  "NEUTRAL",
  "UNEVALUABLE",
]);
export const c612CandidateLabelSchema = z
  .object({
    candidateId: id,
    eventId: id,
    groupId: id.nullable(),
    foldId: id.nullable(),
    current: z.boolean(),
    eligible: z.boolean(),
    reasons: z.array(id),
    baselineExactError: count.nullable(),
    candidateExactError: count.nullable(),
    baselineNormalizedError: count.nullable(),
    candidateNormalizedError: count.nullable(),
    normalizedGain: num.nullable(),
    exactGain: num.nullable(),
    materialDelta: num.nullable(),
    catastrophicDeletion: z.boolean().nullable(),
    classification: c612OutcomeSchema,
    labelClass: z.enum([
      "ORACLE_BEST",
      "IMPROVES_CURRENT",
      "EQUIVALENT_TO_CURRENT",
      "REGRESSES_FROM_CURRENT",
      "CATASTROPHIC_REGRESSION",
      "UNEVALUABLE",
    ]),
    labelRole: z.literal("DIAGNOSTIC_LOCAL_COUNTERFACTUAL"),
    topKProfiles: z.array(retrieval),
    oracleRank: count.nullable(),
  })
  .strict();
export const c612CandidateLabelsSchema = art(
  "gold-c6-1-2-top-k-candidate-labels",
  {
    ...local,
    mappingHash: sha,
    goldBindingHash: sha,
    goldIdentityHash: sha,
    labels: z.array(c612CandidateLabelSchema),
    rawGoldTextIncluded: z.literal(false),
    labelsFedToRuntimeInference: z.literal(false),
  },
);
export const c612GoldBindingRowSchema = z
  .object({
    groupId: id,
    goldCueIds: z.array(id),
    status: c612MappingStatus,
    reasons: z.array(id),
    machineCoveredRatio: ratio,
    goldCoveredRatio: ratio,
    baselineExactError: count.nullable(),
    baselineNormalizedError: count.nullable(),
    goldCharacterCount: count.nullable(),
    baselineMaterial: count.nullable(),
  })
  .strict();
export const c612GroupLabelsSchema = art("gold-c6-1-2-fixed-group-labels", {
  ...local,
  mappingHash: sha,
  goldIdentityHash: sha,
  goldBindingHash: sha,
  goldFirstReadAt: z.iso.datetime(),
  rows: z.array(c612GoldBindingRowSchema),
  unmappedGoldCueIds: z.array(id),
  profileRematchingCount: z.literal(0),
});
export const c612ModelSchema = z
  .object({
    modelId: id,
    profileId: id,
    outerFoldId: id,
    algorithm: z.enum([
      "PAIRWISE_LOGISTIC",
      "LISTWISE_SOFTMAX",
      "FIXED_BASELINE",
    ]),
    featureNames: z.array(id),
    enabled: z.array(z.boolean()),
    means: z.array(num),
    scales: z.array(num.positive()),
    weights: z.array(num),
    intercept: num,
    regularization: num,
    iterations: count,
    trainingEventIds: z.array(id),
    trainingGroupIds: z.array(id),
    trainingCandidateIds: z.array(id),
    trainingLabelHash: sha,
    trainingFeatureHash: sha,
    modelHash: sha,
    outerTestLabelRead: z.literal(false),
    missingFlagCount: count,
  })
  .strict();
export const c612ModelsSchema = art("machine-c6-1-2-reranker-models", {
  featureHash: sha,
  foldHash: sha,
  profilesFrozenBeforeGold: z.literal(true),
  supervisedTrainingAfterGoldLabels: z.literal(true),
  models: z.array(c612ModelSchema),
  runtimeRawGoldInputCount: z.literal(0),
  rawTextFeatureCount: z.literal(0),
});
export const c612ThresholdSchema = z
  .object({
    profileId: id,
    outerFoldId: id,
    threshold: num.nullable(),
    status: z.enum([
      "TRAIN_ONLY_CALIBRATED",
      "ABSTAIN_ALL_NO_SAFE_TRAIN_THRESHOLD",
      "NO_SWITCH_THRESHOLD",
    ]),
    trainingFoldIds: z.array(id),
    innerPredictionHash: sha,
    candidateThresholds: z.array(
      z
        .object({
          threshold: num,
          selected: count,
          improved: count,
          regressed: count,
          neutral: count,
          precision: ratio.nullable(),
          harm: ratio.nullable(),
          normalizedGain: num.nullable(),
        })
        .strict(),
    ),
    outerTestLabelsUsed: z.literal(false),
  })
  .strict();
export const c612ThresholdsSchema = art("machine-c6-1-2-thresholds", {
  policyHash: sha,
  foldHash: sha,
  rows: z.array(c612ThresholdSchema),
});
export const c612RankedCandidateSchema = z
  .object({
    candidateId: id,
    score: num,
    rank: count,
    current: z.boolean(),
    gateEligible: z.boolean(),
    gateReasons: z.array(id),
  })
  .strict();
export const c612RankingSchema = z
  .object({
    profileId: id,
    eventId: id,
    foldId: id,
    modelHash: sha,
    currentCandidateId: id,
    ranked: z.array(c612RankedCandidateSchema),
    proposedCandidateId: id,
    selectedCandidateId: id,
    marginOverCurrent: num,
    abstained: z.boolean(),
    reasons: z.array(id),
    testLabelUsed: z.literal(false),
  })
  .strict();
export const c612RankingsSchema = art("c6-1-2-oof-candidate-rankings", {
  featureHash: sha,
  foldHash: sha,
  modelsHash: sha,
  rows: z.array(c612RankingSchema),
  testLabelInputToPredictionCount: z.literal(0),
});
export const c612DecisionsSchema = art("machine-c6-1-2-reranker-decisions", {
  rankingHash: sha,
  rows: z.array(c612RankingSchema),
  productionWriteAuthorized: z.literal(false),
});
export const c612SelectionSchema = z
  .object({ eventId: id, candidateId: id })
  .strict();
export const c612ConfigurationSchema = z
  .object({
    profileId: id,
    foldId: id,
    groupId: id,
    configurationId: id,
    kind: z.enum([
      "CURRENT_ALL",
      "SINGLE_EVENT",
      "TOP1_COMBINED",
      "BOUNDED_BEAM",
    ]),
    selections: z.array(c612SelectionSchema).max(2),
    aggregateScore: num,
    baselineScore: num,
    eligible: z.boolean(),
    reasons: z.array(id),
    outputTextHash: sha,
    outputTimingHash: sha,
  })
  .strict();
export const c612ConfigurationsSchema = art(
  "machine-c6-1-2-group-shadow-configurations",
  {
    rankingsHash: sha,
    mappingHash: sha,
    rows: z.array(c612ConfigurationSchema),
    maximumPerGroupProfile: z.literal(16),
    maximumChangedEvents: z.literal(2),
    goldUsed: z.literal(false),
  },
);
export const c612GroupDecisionSchema = z
  .object({
    profileId: id,
    foldId: id,
    groupId: id,
    configurationId: id,
    selections: z.array(c612SelectionSchema).max(2),
    changed: z.boolean(),
    reasons: z.array(id),
  })
  .strict();
export const c612GroupDecisionsSchema = art("c6-1-2-oof-group-decisions", {
  configurationsHash: sha,
  rows: z.array(c612GroupDecisionSchema),
  goldUsed: z.literal(false),
});
export const c612GroupEvaluationSchema = z
  .object({
    profileId: id,
    foldId: id.nullable(),
    groupId: id,
    changed: z.boolean(),
    evaluated: z.boolean(),
    selectedEvents: count,
    exactGain: num.nullable(),
    normalizedGain: num.nullable(),
    materialDelta: num.nullable(),
    catastrophicDeletion: z.boolean().nullable(),
    classification: c612OutcomeSchema,
    reasons: z.array(id),
  })
  .strict();
export const c612MetricsSchema = z
  .object({
    profileId: id,
    foldId: id.nullable(),
    eligibleEvents: count,
    evaluatedRankings: count,
    top1Accuracy: ratio.nullable(),
    top1OracleHitRate: ratio.nullable(),
    mrr: ratio.nullable(),
    ndcg4: ratio.nullable(),
    selectedEvents: count,
    selectedGroups: count,
    evaluatedChangedGroups: count,
    improved: count,
    regressed: count,
    neutral: count,
    unknown: count,
    precision: ratio.nullable(),
    harm: ratio.nullable(),
    coverage: ratio.nullable(),
    eventSelectionCoverage: ratio.nullable(),
    allGroupEvaluationCoverage: ratio.nullable(),
    changedGroupEvaluationCoverage: ratio.nullable(),
    selectedGroupEvaluationCoverage: ratio.nullable(),
    exactJointGain: num.nullable(),
    normalizedJointGain: num.nullable(),
    materialDelta: num.nullable(),
    catastrophicDeletions: count,
    activeFolds: count,
    negativeGainFolds: count,
    unknownGainFolds: count,
    oracleCapture: num.nullable(),
    top1OracleCapture: num.nullable(),
    top1FullPoolOracleCapture: num.nullable(),
    candidateOracleCapture: ratio.nullable(),
    localTop1PositiveGain: num,
    localTopKOracleGain: num,
    localFullExistingOracleGain: num,
    localOracleUnit: z.literal("EVENT_COUNTERFACTUAL_DIAGNOSTIC_NOT_JOINT"),
    eligibleGroupCount: count,
  })
  .strict();
export const c612CvSchema = art("c6-1-2-cv-results", {
  ...local,
  foldHash: sha,
  mappingHash: sha,
  rankingsHash: sha,
  groupDecisionsHash: sha,
  profiles: z.array(c612MetricsSchema),
  folds: z.array(c612MetricsSchema),
  groupResults: z.array(c612GroupEvaluationSchema),
  metricAuthority: z.literal("UNIQUE_FIXED_CUE_GROUP_JOINT_ASSEMBLED_SHADOW"),
  eventCounterfactualSumIsJointGain: z.literal(false),
  bestGoldFreeProfile: id,
  bestProfileSelectedBeforeGold: z.literal(true),
  bestObservedProfilePostHoc: id.nullable(),
});
export const c612FailureSchema = art("c6-1-2-failure-attribution", {
  ...local,
  rows: z.array(
    z
      .object({
        profileId: id,
        eventId: id,
        category: z.enum([
          "RETRIEVAL_FAILURE",
          "RERANKING_FAILURE",
          "APPLICATION_GATE_FAILURE",
          "EVALUATION_UNAVAILABLE",
          "NO_ERROR_TO_RECOVER",
          "RECOVERED",
        ]),
        oracleCandidateId: id.nullable(),
        proposedCandidateId: id,
        selectedCandidateId: id,
        reason: id,
      })
      .strict(),
  ),
});
export const c612ShadowProfileSchema = z
  .object({
    profileId: id,
    subtitlePackagePath: id,
    assPath: id,
    srtPath: id,
    vttPath: id,
    canonicalTextHash: sha,
    canonicalTimingHash: sha,
    presentationHash: sha,
    cueCount: count,
    appliedEventIds: z.array(id),
    localOnly: z.literal(true),
    finalizationMethod: z.literal("none"),
  })
  .strict();
export const c612ShadowSchema = art("machine-c6-1-2-shadow-output", {
  decisionHash: sha,
  profiles: z.array(c612ShadowProfileSchema),
  productionTextMutation: z.literal(0),
  productionTimingMutation: z.literal(0),
  productionCueCountMutation: z.literal(0),
  oofArtifactsCreatedAfterTrainLabels: z.literal(true),
});
export const c612ApplicationSchema = art(
  "machine-c6-1-2-shadow-application-ledger",
  {
    rows: z.array(
      z
        .object({
          profileId: id,
          eventId: id,
          candidateId: id,
          status: z.enum(["APPLIED_SHADOW_ONLY", "KEPT_CURRENT", "BLOCKED"]),
          reasons: z.array(id),
        })
        .strict(),
    ),
    novelApplicationCount: z.literal(0),
    productionMutationCount: z.literal(0),
  },
);
export const c612ProvenanceSchema = art("machine-c6-1-2-shadow-provenance", {
  universeHash: sha,
  rows: z.array(
    z
      .object({
        profileId: id,
        eventId: id,
        candidateId: id,
        candidateTextHash: sha,
        provenanceHash: sha,
        originalWholeCandidate: z.literal(true),
      })
      .strict(),
  ),
  novelCandidateCount: z.literal(0),
});
export const c612RetrievalMetricsSchema = art("c6-1-2-retrieval-evaluation", {
  ...local,
  profiles: z.array(
    z
      .object({
        profile: retrieval,
        evaluableEvents: count,
        oracleImprovementEvents: count,
        recall1: ratio.nullable(),
        recall2: ratio.nullable(),
        recall3: ratio.nullable(),
        recall4: ratio.nullable(),
        mrr: ratio.nullable(),
        ndcg4: ratio.nullable(),
        topKOracleGain: num,
        fullExistingOracleGain: num,
        oracleCapture: ratio.nullable(),
      })
      .strict(),
  ),
  rows: z.array(
    z
      .object({
        profile: retrieval,
        eventId: id,
        oracleCandidateId: id.nullable(),
        h2Rank: count.nullable(),
        rawRank: count.nullable(),
        retrievedRank: count.nullable(),
        currentError: count.nullable(),
        oracleError: count.nullable(),
        topKOracleError: count.nullable(),
        reason: id,
      })
      .strict(),
  ),
});
export const c612ContractionEvaluationSchema = art(
  "gold-c6-1-2-contraction-evaluation",
  {
    ...local,
    rows: z.array(
      z
        .object({
          candidateId: id,
          eventId: id,
          priorStrong: z.boolean(),
          strong: z.boolean(),
          machineClass: id,
          goldClass: z.enum([
            "TRUE_HALLUCINATION_REMOVAL",
            "VALID_SHORTENING",
            "LEADING_DIALOGUE_DELETION",
            "TRAILING_DIALOGUE_DELETION",
            "INTERNAL_DIALOGUE_DELETION",
            "TEXT_SUBSTITUTION_NOT_CONTRACTION",
            "UNEVALUABLE",
          ]),
          normalizedGain: num.nullable(),
          blocked: z.boolean(),
          catastrophic: z.boolean().nullable(),
        })
        .strict(),
    ),
    utilities: z.array(
      z
        .object({
          feature: id,
          scorableCount: count,
          positiveCount: count,
          negativeCount: count,
          correctDirection: count,
          wrongDirection: count,
          auc: ratio.nullable(),
          precisionBlocked: ratio.nullable(),
          catastrophicRecall: ratio.nullable(),
          safeFalseBlockRate: ratio.nullable(),
        })
        .strict(),
    ),
    causalClaim: z.literal(false),
  },
);
export const c612AblationsSchema = art("c6-1-2-feature-ablations", {
  ...local,
  profiles: z.array(c612MetricsSchema),
  comparisons: z.array(
    z
      .object({
        left: id,
        right: id,
        changedFamily: id,
        normalizedJointGainDifference: num.nullable(),
        top1AccuracyDifference: num.nullable(),
        catastrophicDifference: num,
        causal: z.literal(false),
      })
      .strict(),
  ),
});
export const c612RouteSchema = art("c6-1-2-route-decision", {
  ...local,
  engineeringPassed: z.boolean(),
  strongSupportPassed: z.boolean(),
  checks: z.array(check),
  route: z.enum([
    "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW",
    "TOP_K_RETRIEVAL_CONFIRMED_RERANKING_NOT_SUPPORTED",
    "EXISTING_CANDIDATE_POOL_INSUFFICIENT",
    "EVALUATION_COVERAGE_INSUFFICIENT",
    "C6_1_2_ENGINEERING_INVALID",
  ]),
  c613: z.enum(["GO", "HOLD"]),
  selectedProfile: id,
  productionStatus: z.literal("needs-review"),
  finalizationMethod: z.literal("none"),
  machineOnlyReleaseAuthorized: z.literal(false),
  reasons: z.array(id),
});
export const c612ValidationSchema = art("c6-1-2-validation", {
  checks: z.array(check),
  passed: z.boolean(),
  files: z.array(file),
  fileScope: z.literal("FINAL_A_TREE"),
  schemaCount: count,
  validatedArtifactCount: count,
  regressionEvidenceHash: sha,
  sourceCodeAggregateHash: sha,
  productionParity: z.boolean(),
  semanticParity: z.boolean(),
  regressionPassed: z.boolean(),
  rawGoldRuntimeInputCount: z.literal(0),
  networkUsed: z.literal(false),
});
export const c612RerankingFreezeSchema = art("c6-1-2-reranking-freeze", {
  frozenAt: z.iso.datetime(),
  machineFreezeHash: sha,
  files: z.array(file),
  fileAggregateHash: sha,
  modelHash: sha,
  rankingHash: sha,
  groupDecisionHash: sha,
  rawGoldReadByTrainingProcess: z.literal(false),
  outerTestLabelsUsedByPrediction: z.literal(false),
});
export const c612GroupConfigurationLabelsSchema = art(
  "gold-c6-1-2-group-configuration-labels",
  {
    ...local,
    goldBindingHash: sha,
    configurationHash: sha,
    rows: z.array(
      z
        .object({
          configurationId: id,
          groupId: id,
          profileId: id,
          eligible: z.boolean(),
          exactGain: num.nullable(),
          normalizedGain: num.nullable(),
          materialDelta: num.nullable(),
          catastrophicDeletion: z.boolean().nullable(),
          labelRole: z.literal("GROUP_JOINT_COUNTERFACTUAL"),
        })
        .strict(),
    ),
  },
);
export const c612LegacyMaterialSchema = art(
  "c6-1-2-fixed-legacy-material-evaluation",
  {
    ...local,
    alignmentFrozenOnce: z.literal(true),
    baselineAlignmentHash: sha,
    baselineMaterialErrors: count,
    baselineExpectedParity: z.boolean(),
    profiles: z.array(
      z
        .object({
          profileId: id,
          materialErrors: count,
          materialDelta: num,
          fixedMatching: z.literal(true),
        })
        .strict(),
    ),
    legacyOnlyNotTrainingLabels: z.literal(true),
  },
);
export const c612ProfileFreezeSchema = art("c6-1-2-reranker-profile-freeze", {
  profileHash: sha,
  policyHash: sha,
  profiles: z.array(
    z
      .object({
        id,
        algorithm: z.enum([
          "PAIRWISE_LOGISTIC",
          "LISTWISE_SOFTMAX",
          "FIXED_BASELINE",
        ]),
        retrieval: z.union([z.literal(0), z.literal(1), z.literal(3)]),
        enabled: z.array(z.boolean()),
        completenessGate: z.boolean(),
        contractionGate: z.boolean(),
        correlationBalanced: z.boolean(),
        abstention: z.boolean(),
      })
      .strict(),
  ),
  primaryProfile: z.literal("L6"),
  supervisedModelsFitAfterTrainLabels: z.literal(true),
});
export const C612_QA_STAGES = [
  "generate:schemas",
  "typecheck",
  "lint",
  "format:check",
  "build",
  "unit",
  "e2e",
  "c6-1-targeted",
  "c6-1-1-targeted",
  "c6-1-2-targeted",
  "historical-targeted",
  "python-ctc-unit",
  "skill",
  "c6-1-1-independent-acceptance",
] as const;
export const c612RegressionSchema = art("c6-1-2-regression-evidence", {
  sourceCodeAggregateHash: sha,
  sourceUnchangedDuringChecks: z.literal(true),
  freshModelInferenceAllowed: z.literal(false),
  rawGoldRead: z.literal(false),
  checks: z.array(
    z
      .object({
        stage: z.enum(C612_QA_STAGES),
        command: id,
        exitCode: z.number().int(),
        durationMs: count,
        logRelativePath: id,
        logSha256: sha,
        tests: z
          .object({ passed: count, failed: count, skipped: count })
          .strict()
          .nullable(),
        skipReasons: z.array(id),
      })
      .strict(),
  ),
});
export const c612ReadOnlySchema = art("c6-1-2-read-only-proof", {
  sourceMediaHashBefore: sha,
  sourceMediaHashAfter: sha,
  sourceBytes: count,
  goldHashBefore: sha,
  goldHashAfter: sha,
  goldBytes: count,
  sourceReadOnly: z.literal(true),
  goldReadOnly: z.literal(true),
  productionFiles: z.array(file),
  productionUnchanged: z.literal(true),
  rawGoldOpenedByVerifier: z.literal(false),
});
export const c612ShareableSchema = art("c6-1-2-shareable-summary", {
  benchmark: z.literal("KNOWN_DEVELOPMENT_BENCHMARK"),
  route: c612RouteSchema.shape.route,
  c613: z.enum(["GO", "HOLD"]),
  engineeringPassed: z.boolean(),
  strongSupportPassed: z.boolean(),
  canonicalTextHash: sha,
  canonicalTimingHash: sha,
  productionCueCount: count,
  productionMutationCount: z.literal(0),
  asrInference: z.literal(0),
  verifierFresh: count,
  verifierCacheHits: count,
  profiles: z.array(c612MetricsSchema),
  summaryOnly: z.literal(true),
  candidateTextIncluded: z.literal(false),
  goldTextIncluded: z.literal(false),
  sourceAudioIncluded: z.literal(false),
  packagePrivacy: z.literal("FULL_OUTPUT_IS_LOCAL_RESEARCH_ONLY"),
});
export const c612ShareableAuditSchema = art("c6-1-2-shareable-audit", {
  files: z.array(file),
  checkedFiles: count,
  absolutePathLeakCount: count,
  secretCount: count,
  rawTextFieldCount: count,
  brokenRelativeReferenceCount: count,
  passed: z.boolean(),
  scope: z.literal("SHAREABLE_SUMMARY_ONLY_NOT_FULL_LOCAL_ARTIFACTS"),
});
const reportEntry = z
  .object({ index: count, title: id, value: z.string() })
  .strict();
export const c612ReportDataSchema = art("c6-1-2-report-data", {
  validationHash: sha,
  regressionHash: sha,
  machineFreezeHash: sha,
  rawGoldRead: z.literal(false),
  candidateTextReadForReport: z.literal(false),
  reportEntries: z.array(reportEntry).length(153),
  replyEntries: z.array(reportEntry).length(150),
  questions: z.array(reportEntry).length(20),
  codeCommit: id,
  acceptanceCommit: id.nullable(),
});
export type C612Label = z.infer<typeof c612CandidateLabelSchema>;
export type C612GoldBinding = z.infer<typeof c612GoldBindingRowSchema>;
export type C612Model = z.infer<typeof c612ModelSchema>;
export type C612Threshold = z.infer<typeof c612ThresholdSchema>;
export type C612Ranking = z.infer<typeof c612RankingSchema>;
export type C612Configuration = z.infer<typeof c612ConfigurationSchema>;
export type C612GroupDecision = z.infer<typeof c612GroupDecisionSchema>;
export type C612GroupEvaluation = z.infer<typeof c612GroupEvaluationSchema>;
export type C612Metrics = z.infer<typeof c612MetricsSchema>;
