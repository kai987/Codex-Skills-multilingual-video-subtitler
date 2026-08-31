import { z } from "zod";
import {
  c612CandidateLabelSchema,
  c612GoldBindingRowSchema,
  c612ModelSchema,
  c612ThresholdSchema,
  c612RankingSchema,
  c612GroupDecisionSchema,
  c612ConfigurationSchema,
} from "./c6-1-2-evaluation-schemas.js";
import { c611FixedBaselineAlignmentMapSchema } from "./c6-1-1-evaluation-schemas.js";

export const C6121_VERSION =
  "c6.1.2.1-gold-isolated-supergroup-evaluation-v1" as const;
const id = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const num = z.number();
const count = num.int().nonnegative();
const ratio = num.min(0).max(1);
const interval = z.object({ start: num, end: num }).strict();
const ids = z.array(id);
const check = z
  .object({
    name: id,
    passed: z.boolean(),
    observed: z.string(),
    expected: z.string(),
  })
  .strict();
const reasons = z.array(z.object({ reason: id, count }).strict());
export function c6121ArtifactSchema<
  const N extends string,
  S extends z.ZodRawShape,
>(name: N, shape: S) {
  return z
    .object({
      schemaVersion: z.literal("1.0.0"),
      artifactType: z.literal(name),
      policyVersion: z.literal(C6121_VERSION),
      policyHash: sha,
      semanticHash: sha,
      ...shape,
    })
    .strict();
}
const art = c6121ArtifactSchema;
export const c6121GoldTimingCueSchema = z
  .object({ id, start: num, end: num })
  .strict();
export type C6121GoldTimingCue = z.infer<typeof c6121GoldTimingCueSchema>;
export const c6121CoverageFractionSchema = z
  .object({
    numerator: num.nonnegative(),
    denominator: num.nonnegative(),
    ratio: ratio.nullable(),
  })
  .strict();
export const c6121FileSchema = z
  .object({
    role: id,
    path: id,
    bytes: count,
    sha256: sha,
    semanticHash: sha.nullable(),
    mtimeMs: num,
    inode: count,
  })
  .strict();
export const c6121BaselineSchema = art(
  "c6-1-2-1-baseline-freeze-verification",
  {
    machineFrozenAt: z.iso.datetime(),
    machineFreezeHashes: z.array(sha).length(2),
    rerankingFreezeHashes: z.array(sha).length(2),
    sourceIdentity: sha,
    generationSourceCommit: id,
    baselineCommit: id,
    files: z.array(c6121FileSchema),
    inputAggregateHash: sha,
    productionTextHash: sha,
    productionTimingHash: sha,
    checks: z.array(check),
    passed: z.boolean(),
    rawGoldReadCount: z.literal(0),
    modelExecutionCount: z.literal(0),
    networkUsed: z.literal(false),
  },
);
export const c6121TimingBarrierSchema = art(
  "c6-1-2-1-gold-timing-read-barrier",
  {
    machineFrozenAt: z.iso.datetime(),
    goldTimingFirstReadAt: z.iso.datetime(),
    baselineFreezeHash: sha,
    goldTimingCueCount: count,
    goldTimingHash: sha,
    goldByteHash: sha,
    goldBytes: count,
    goldMtimeMs: num,
    goldInode: count,
    parser: z.literal("ASS_PREFIX_ONLY_NO_DIALOGUE_TEXT_DECODE"),
    rawGoldTextReadCount: z.literal(0),
    goldFileBytesScannedForTimingAndHash: z.literal(true),
    machineArtifactsMutatedAfterTimingRead: z.literal(false),
  },
);
export const c6121TextBarrierSchema = art(
  "c6-1-2-1-gold-text-scoring-barrier",
  {
    supergroupFrozenAt: z.iso.datetime(),
    goldTextFirstReadAt: z.iso.datetime(),
    baselineFreezeHash: sha,
    timingBarrierHash: sha,
    supergroupMapHash: sha,
    goldTimingHash: sha,
    goldByteHash: sha,
    goldTextScoringInputCount: count,
    machineRuntimeRawGoldInputCount: z.literal(0),
    predictionStageRawGoldInputCount: z.literal(0),
  },
);
export const c6121EdgeSchema = z
  .object({
    edgeId: id,
    machineGroupId: id,
    machineCueIds: ids,
    goldCueId: id,
    overlapStart: num,
    overlapEnd: num,
    overlapSeconds: num.positive(),
    overlapIntervals: z.array(interval).min(1),
    machineIntersectionRatio: ratio,
    goldIntersectionRatio: ratio,
    edgeType: z.literal("STRICT_POSITIVE_TEMPORAL_OVERLAP"),
    goldTextUsed: z.literal(false),
    semanticHash: sha,
  })
  .strict();
export const c6121EdgesSchema = art("c6-1-2-1-bipartite-edge-ledger", {
  mappingHash: sha,
  foldHash: sha,
  goldTimingHash: sha,
  rows: z.array(c6121EdgeSchema),
  goldTextUsedForGroupingCount: z.literal(0),
});
export const c6121StatusSchema = z.enum([
  "FIXED_ONE_TO_ONE",
  "FIXED_ONE_TO_MANY",
  "FIXED_MANY_TO_ONE",
  "FIXED_MANY_TO_MANY",
  "CROSS_FOLD_COMPONENT",
  "STRUCTURE_INCOMPATIBLE",
  "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
  "TEMPORAL_COMPONENT_CUE_LIMIT",
  "TEMPORAL_COMPONENT_DURATION_LIMIT",
  "TEMPORAL_BRIDGE_GAP_LIMIT",
  "NONCONTIGUOUS_MACHINE_CUES",
  "NONCONTIGUOUS_GOLD_CUES",
  "NO_GOLD_MAPPING",
  "CANDIDATE_LABEL_AMBIGUOUS",
  "NO_MACHINE_MAPPING",
]);
export const c6121SupergroupSchema = z
  .object({
    supergroupId: id,
    machineGroupIds: ids,
    machineCueIds: ids,
    machineEventIds: ids,
    goldCueIds: ids,
    edgeIds: ids,
    foldId: id.nullable(),
    frozenFoldIds: ids,
    machineSourceInterval: interval.nullable(),
    goldSourceInterval: interval.nullable(),
    totalSourceInterval: interval,
    machineCoveredRatio: ratio,
    goldCoveredRatio: ratio,
    machineCueCount: count,
    goldCueCount: count,
    machineGroupCount: count,
    maximumMachineGapSeconds: num.nonnegative(),
    maximumGoldGapSeconds: num.nonnegative(),
    durationSeconds: num.nonnegative(),
    structuralStatus: c6121StatusSchema,
    shadowEvaluationEligible: z.boolean(),
    candidateLabelEligible: z.boolean(),
    oofTrainingEligible: z.boolean(),
    candidateEligibleEventIds: ids,
    candidateAmbiguousEventIds: ids,
    reasons: ids,
    semanticHash: sha,
  })
  .strict();
export type C6121Supergroup = z.infer<typeof c6121SupergroupSchema>;
export const c6121MapSchema = art("c6-1-2-1-evaluator-supergroup-map", {
  machineMappingHash: sha,
  foldHash: sha,
  goldTimingHash: sha,
  edgeLedgerHash: sha,
  baselineCueOrder: ids,
  goldCueOrder: ids,
  groups: z.array(c6121SupergroupSchema),
  unmappedGoldCueIds: ids,
  goldTextUsedForGroupingCount: z.literal(0),
  profileRematchingCount: z.literal(0),
});
export type C6121Map = z.infer<typeof c6121MapSchema>;
export const c6121IntegritySchema = art("c6-1-2-1-supergroup-integrity-audit", {
  supergroupMapHash: sha,
  machineGroupCount: count,
  goldCueCount: count,
  edgeCount: count,
  connectedComponentCount: count,
  goldConnectedComponentCount: count,
  noGoldComponentCount: count,
  crossFoldComponentCount: count,
  stableShadowEvaluationCount: count,
  stableCandidateLabelCount: count,
  oofTrainingEligibleCount: count,
  structureIncompatibleCount: count,
  durationLimitCount: count,
  gapLimitCount: count,
  cueLimitCount: count,
  noncontiguousCount: count,
  oneToOne: count,
  oneToMany: count,
  manyToOne: count,
  manyToMany: count,
  duplicateMachineAssignmentCount: count,
  duplicateGoldAssignmentCount: count,
  goldTextUsedForGroupingCount: z.literal(0),
  profileRematchingCount: z.literal(0),
  reasonCounts: reasons,
});
export const c6121CoverageSchema = z.object({
  evaluableSupergroupCoverage: c6121CoverageFractionSchema,
  evaluableMachineGroupCoverage: c6121CoverageFractionSchema,
  evaluableProductionCueCoverage: c6121CoverageFractionSchema,
  evaluableGoldCueCoverage: c6121CoverageFractionSchema,
  evaluableMachineDurationCoverage: c6121CoverageFractionSchema,
  evaluableGoldDurationCoverage: c6121CoverageFractionSchema,
  candidateEventLabelCoverage: c6121CoverageFractionSchema,
  candidateLabelCoverage: c6121CoverageFractionSchema,
  topKCandidateLabelCoverage: c6121CoverageFractionSchema,
  evaluableGoldCharacterCoverage: c6121CoverageFractionSchema.nullable(),
});
export const c6121CandidateRowSchema = z
  .object({
    candidateId: id,
    eventId: id,
    machineGroupIds: ids,
    supergroupId: id.nullable(),
    foldId: id.nullable(),
    applicationCueIds: ids,
    applicationEligible: z.boolean(),
    oofTrainingEligible: z.boolean(),
    label: c612CandidateLabelSchema,
  })
  .strict();
export const c6121LabelsSchema = art(
  "gold-c6-1-2-1-supergroup-candidate-labels",
  {
    supergroupMapHash: sha,
    goldByteHash: sha,
    labels: z.array(c6121CandidateRowSchema),
    rawGoldTextIncluded: z.literal(false),
    labelsFedToRuntimeInference: z.literal(false),
  },
);
export const c6121GroupScoreSchema = z
  .object({
    supergroupId: id,
    machineGroupIds: ids,
    goldCueIds: ids,
    foldId: id.nullable(),
    changed: z.boolean(),
    evaluated: z.boolean(),
    exactError: count.nullable(),
    normalizedError: count.nullable(),
    exactGain: num.nullable(),
    normalizedGain: num.nullable(),
    materialDelta: num.nullable(),
    legacyMaterialDelta: num.nullable(),
    catastrophicDeletion: z.boolean().nullable(),
    baselineMaterial: count.nullable(),
    baselineExactError: count.nullable(),
    baselineNormalizedError: count.nullable(),
    goldCharacterCount: count.nullable(),
    classification: z.enum(["IMPROVED", "REGRESSED", "NEUTRAL", "UNEVALUABLE"]),
    reasons: ids,
  })
  .strict();
export type C6121GroupScore = z.infer<typeof c6121GroupScoreSchema>;
export const c6121FoldMetricSchema = z
  .object({
    foldId: id,
    changed: count,
    evaluated: count,
    improved: count,
    regressed: count,
    neutral: count,
    unknown: count,
    normalizedJointGain: num.nullable(),
  })
  .strict();
export const c6121ProfileMetricSchema = z
  .object({
    profileId: id,
    track: z.enum([
      "FROZEN_DECISION_REEVALUATION",
      "SAME_FEATURE_SAME_PROFILE_OOF_RETRAIN",
    ]),
    supergroupMapHash: sha,
    changedSupergroups: count,
    evaluableChangedSupergroups: count,
    changedMachineGroups: count,
    improved: count,
    regressed: count,
    neutral: count,
    unknown: count,
    selectionPrecision: ratio.nullable(),
    harmRate: ratio.nullable(),
    exactJointGain: num.nullable(),
    normalizedJointGain: num.nullable(),
    materialDelta: num.nullable(),
    legacyMaterialDelta: num.nullable(),
    catastrophicDeletionCount: count,
    changedSupergroupCoverage: c6121CoverageFractionSchema,
    changedMachineGroupCoverage: c6121CoverageFractionSchema,
    zeroSelectionChangedCoverage: ratio,
    activeFoldCount: count,
    negativeGainFoldCount: count,
    unknownGainFoldCount: count,
    top1Accuracy: c6121CoverageFractionSchema,
    folds: z.array(c6121FoldMetricSchema),
    groups: z.array(c6121GroupScoreSchema),
  })
  .strict();
export type C6121ProfileMetric = z.infer<typeof c6121ProfileMetricSchema>;
const evaluations = {
  supergroupMapHash: sha,
  profiles: z.array(c6121ProfileMetricSchema),
};
export const c6121ProfileLabelsSchema = art(
  "gold-c6-1-2-1-supergroup-profile-labels",
  evaluations,
);
export const c6121FrozenEvaluationSchema = art(
  "c6-1-2-1-frozen-decision-reevaluation",
  evaluations,
);
export const c6121RetrainedEvaluationSchema = art(
  "c6-1-2-1-oof-retrain-profile-evaluation",
  evaluations,
);
export const c6121ModelsSchema = art("c6-1-2-1-oof-retrain-models", {
  supergroupMapHash: sha,
  featureHash: sha,
  foldHash: sha,
  profileDefinitionHash: sha,
  trainingCodeHash: sha,
  models: z.array(c612ModelSchema),
  rawGoldTextFeatureCount: z.literal(0),
  trainingNumericLabelCount: count,
  outerTestLabelInputToPredictionCount: z.literal(0),
});
export const c6121ThresholdsSchema = art("c6-1-2-1-oof-retrain-thresholds", {
  supergroupMapHash: sha,
  foldHash: sha,
  thresholdGridHash: sha,
  rows: z.array(c612ThresholdSchema),
});
export const c6121RankingsSchema = art("c6-1-2-1-oof-retrain-rankings", {
  supergroupMapHash: sha,
  featureHash: sha,
  foldHash: sha,
  modelsHash: sha,
  rows: z.array(c612RankingSchema),
  outerTestLabelInputToPredictionCount: z.literal(0),
});
export const c6121DecisionsSchema = art("c6-1-2-1-oof-retrain-decisions", {
  supergroupMapHash: sha,
  rankingHash: sha,
  configurationsHash: sha,
  rows: z.array(c612GroupDecisionSchema),
  productionMutationAllowed: z.literal(false),
});
export const c6121StabilitySchema = art("c6-1-2-1-label-stability-audit", {
  oldEvaluableCandidateLabels: count,
  newEvaluableCandidateLabels: count,
  newlyRecoveredCandidateLabels: count,
  previouslyEvaluableNowLost: count,
  stillUnevaluableCandidateLabels: count,
  commonEvaluableCount: count,
  exactLabelAgreementCount: count,
  gainDirectionAgreementCount: count,
  exactGainDirectionAgreementCount: count,
  catastrophicAgreementCount: count,
  disagreementCount: count,
  disagreementRows: z.array(
    z
      .object({
        candidateId: id,
        eventId: id,
        oldGroupId: id.nullable(),
        supergroupId: id.nullable(),
        oldClass: id,
        newClass: id,
        oldGain: num.nullable(),
        newGain: num.nullable(),
        oldExactGain: num.nullable(),
        newExactGain: num.nullable(),
        reason: id,
      })
      .strict(),
  ),
});
export const c6121E0Schema = art("c6-1-2-1-e0-legacy-replay", {
  stable: count,
  ambiguous: count,
  noMapping: count,
  groupCount: count,
  coverage: c6121CoverageFractionSchema,
  checks: z.array(check),
  passed: z.boolean(),
  bindings: z.array(c612GoldBindingRowSchema),
  candidateLabelHash: sha,
  originalQualityHash: sha,
  recomputedQualityHash: sha,
});
export const c6121E1Schema = art("c6-1-2-1-e1-historical-bipartite-replay", {
  timingOnlyMap: c611FixedBaselineAlignmentMapSchema,
  historicalStructureParity: z.boolean(),
  checks: z.array(check),
});
export const c6121CoverageAuditSchema = art(
  "c6-1-2-1-evaluation-coverage-recovery-audit",
  {
    supergroupMapHash: sha,
    coverage: c6121CoverageSchema,
    recoveredMachineGroups: ids,
    recoveredGoldCues: ids,
    goldSpanningMachineGroups: ids,
    goldSpanningGoldCues: ids,
    goldSpanningConnectedComponents: ids,
    recoveredGoldSpanningMachineGroups: ids,
    rows: z.array(
      z
        .object({
          machineGroupId: id,
          supergroupId: id,
          oldStatus: id,
          newStatus: id,
          recovered: z.boolean(),
          reasons: ids,
        })
        .strict(),
    ),
  },
);
export const c6121ModeSchema = z.object({
  mode: z.enum([
    "E0_MACHINE_GROUP_BINDING",
    "E1_BASELINE_TEMPORAL_BIPARTITE_COMPONENTS",
    "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
  ]),
  groupCount: count,
  stableCount: count,
  ambiguousCount: count,
  noMappingCount: count,
  coverage: c6121CoverageSchema,
  crossFoldCount: count,
  policyHash: sha,
  changedGroupCoverageByProfile: z.array(
    z
      .object({
        profileId: id,
        machineGroups: c6121CoverageFractionSchema,
        supergroups: c6121CoverageFractionSchema,
      })
      .strict(),
  ),
});
export const c6121ModeComparisonSchema = art(
  "c6-1-2-1-evaluation-mode-comparison",
  {
    primaryEvaluator: z.literal(
      "E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP",
    ),
    modes: z.array(c6121ModeSchema).length(3),
  },
);
export const c6121SensitivitySchema = art("c6-1-2-1-evaluator-sensitivity", {
  comparisons: z.array(
    z
      .object({
        profileId: id,
        mode: id,
        improved: count,
        regressed: count,
        neutral: count,
        unknown: count,
        normalizedJointGain: num.nullable(),
        materialDelta: num.nullable(),
        catastrophicDeletionCount: count,
        precision: ratio.nullable(),
        harm: ratio.nullable(),
        folds: z.array(c6121FoldMetricSchema),
      })
      .strict(),
  ),
  directionDisagreements: z.array(
    z
      .object({
        profileId: id,
        machineGroupId: id,
        supergroupId: id,
        sourceInterval: interval,
        oldGain: num,
        newGain: num,
        reason: id,
      })
      .strict(),
  ),
  frozenL1CatastrophicTrace: z.array(
    z
      .object({
        machineGroupId: id,
        supergroupId: id,
        outcome: z.enum([
          "STILL_CATASTROPHIC",
          "EVALUABLE_NOT_CATASTROPHIC",
          "UNEVALUABLE",
        ]),
        reason: id,
      })
      .strict(),
  ),
});
export const c6121CompletenessSchema = art(
  "c6-1-2-1-completeness-blocker-diagnosis",
  {
    nonUnknownCompletenessCoverage: c6121CoverageFractionSchema,
    candidateSelectionsBlockedByCompleteness: count,
    retrainedProfileZeroSelectionDueToCompleteness: ids,
    nonGatedProfilePositiveButUnsafeCount: count,
    catastrophicCandidatesBlocked: count,
    safeCandidatesBlocked: count,
    safeCandidateFalseBlockRate: c6121CoverageFractionSchema,
    diagnosticMainBlocker: z.boolean(),
    coverageQualifiedMainBlocker: z.boolean(),
    noThresholdChange: z.literal(true),
    reasons: ids,
  },
);
export const c6121RouteSchema = art("c6-1-2-1-route-decision", {
  route: z.enum([
    "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW",
    "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION",
    "STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING",
    "EVALUATION_COVERAGE_STILL_INSUFFICIENT",
    "C6_1_2_1_ENGINEERING_INVALID",
  ]),
  engineeringGate: z.boolean(),
  evaluationCoverageGate: z.boolean(),
  rerankerStrongSupportGate: z.boolean(),
  coverageChecks: z.array(check),
  strongSupportChecks: z.array(check),
  selectedSafeProfile: id.nullable(),
  safeProfileCandidates: ids,
  descriptiveBestFrozenProfile: id.nullable(),
  descriptiveBestRetrainedProfile: id.nullable(),
  c6122: z.enum(["GO", "HOLD"]),
  c613: z.enum(["GO", "HOLD"]),
  productionStatus: z.literal("needs-review"),
  finalizationMethod: z.literal("none"),
  productionMutation: z.literal(0),
  prospectiveShadowOnly: z.literal(true),
});
export const c6121ShadowProvenanceSchema = art(
  "c6-1-2-1-retrained-shadow-provenance",
  {
    supergroupMapHash: sha,
    rows: z.array(
      z
        .object({
          profileId: id,
          eventId: id,
          candidateId: id,
          machineGroupId: id,
          supergroupId: id,
          foldId: id,
          modelHash: sha,
          thresholdHash: sha,
          decisionReason: ids,
          sourceSpan: z
            .object({ cueId: id, start: count, end: count })
            .strict(),
          textBefore: z.string(),
          textAfter: z.string(),
        })
        .strict(),
    ),
    profiles: z.array(
      z
        .object({
          profileId: id,
          relativePath: id,
          cueCount: count,
          timingHash: sha,
          presentationHash: sha,
        })
        .strict(),
    ),
    localOnly: z.literal(true),
    newCandidateCount: z.literal(0),
    productionMutationCount: z.literal(0),
  },
);
export const c6121ValidationSchema = art("c6-1-2-1-validation", {
  checks: z.array(check),
  passed: z.boolean(),
  checkedArtifacts: count,
  schemaCount: count,
  aBSemanticParity: z.boolean(),
  aBByteParity: z.boolean(),
  productionParity: z.boolean(),
  inputReadOnly: z.boolean(),
  goldReadOnly: z.boolean(),
  sourceReadOnly: z.boolean(),
  modelExecutionCount: z.literal(0),
  networkDuringResearch: z.literal(false),
  qaEvidenceHash: sha.nullable(),
  generatedAt: z.iso.datetime(),
});
export const c6121FreezeSchema = art("c6-1-2-1-supergroup-freeze", {
  supergroupFrozenAt: z.iso.datetime(),
  baselineFreezeHash: sha,
  timingBarrierHash: sha,
  supergroupMapHash: sha,
  edgeLedgerHash: sha,
  primaryEvaluator: z.literal("E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP"),
  frozenFiles: z.array(z.object({ relativePath: id, sha256: sha }).strict()),
  rawGoldTextReadCount: z.literal(0),
});
export const c6121ReadOnlySchema = art("c6-1-2-1-read-only-proof", {
  baselineFreezeHash: sha,
  inputAggregateHashBefore: sha,
  inputAggregateHashAfter: sha,
  sourceBefore: c6121FileSchema,
  sourceAfter: c6121FileSchema,
  goldBefore: c6121FileSchema,
  goldAfter: c6121FileSchema,
  machineRuntimeRawGoldInputCount: z.literal(0),
  predictionStageRawGoldInputCount: z.literal(0),
  goldTimingEvaluatorInputCount: count,
  goldTextScoringInputCount: count,
  trainingNumericLabelCount: count,
  outerTestLabelInputToPredictionCount: z.literal(0),
  modelExecutionCount: z.literal(0),
  networkDuringResearch: z.literal(false),
  productionMutation: z.literal(0),
  passed: z.boolean(),
});
export const c6121TrainingParitySchema = art(
  "c6-1-2-1-training-contract-parity",
  {
    featureHash: sha,
    foldHash: sha,
    profileDefinitionHash: sha,
    thresholdGridHash: sha,
    trainingCodeHash: sha,
    candidateSetHash: sha,
    candidateRankHash: sha,
    correlationHash: sha,
    completenessHash: sha,
    contractionHash: sha,
    checks: z.array(check),
    passed: z.boolean(),
    onlyNumericLabelsRebound: z.literal(true),
  },
);
export const c6121PolicyFreezeSchema = art("c6-1-2-1-policy-freeze", {
  serializedDefinition: id,
  definitionHash: sha,
  primaryEvaluator: z.literal("E2_FROZEN_MACHINE_GROUP_GOLD_TIMING_SUPERGROUP"),
  frozenBeforeGoldText: z.literal(true),
});
export const c6121TimingInputSchema = art("gold-c6-1-2-1-timing-only-input", {
  timingBarrierHash: sha,
  rows: z.array(c6121GoldTimingCueSchema),
  rawGoldTextIncluded: z.literal(false),
});
export const c6121GoldCountsSchema = art(
  "gold-c6-1-2-1-evaluation-character-counts",
  {
    supergroupMapHash: sha,
    goldByteHash: sha,
    rows: z.array(
      z
        .object({
          goldCueId: id,
          exactGraphemes: count,
          normalizedGraphemes: count,
        })
        .strict(),
    ),
    rawGoldTextIncluded: z.literal(false),
    groupingInput: z.literal(false),
  },
);
export const c6121ConfigurationsSchema = art(
  "c6-1-2-1-oof-retrain-configurations",
  {
    supergroupMapHash: sha,
    rankingHash: sha,
    frozenMachineMappingHash: sha,
    originalAssemblerArtifactHash: sha,
    rows: z.array(c612ConfigurationSchema),
    goldUsed: z.literal(false),
  },
);
export const c6121DiagnosticsSchema = art("c6-1-2-1-diagnostic-mode-metrics", {
  e0: z.array(c6121ProfileMetricSchema),
  e1: z.array(c6121ProfileMetricSchema),
  e1CandidateLabels: z.array(c6121CandidateRowSchema),
  primaryEvaluatorChanged: z.literal(false),
});
export const c6121QaSchema = art("c6-1-2-1-regression-evidence", {
  checks: z.array(
    z
      .object({
        stage: id,
        command: id,
        exitCode: num.int(),
        passed: z.boolean(),
        logPath: id,
        logSha256: sha,
        elapsedSeconds: num.nonnegative(),
        testPassed: count.nullable(),
        testFailed: count.nullable(),
        testSkipped: count.nullable(),
        skipReasons: ids,
      })
      .strict(),
  ),
  sourceBeforeHash: sha,
  sourceAfterHash: sha,
  passed: z.boolean(),
  modelExecutionCount: z.literal(0),
  generatedAt: z.iso.datetime(),
});
export const c6121ShareableSchema = art("c6-1-2-1-shareable-summary", {
  baselineCommit: id,
  sourceIdentity: sha,
  supergroupMapHash: sha,
  counts: z
    .object({
      machineGroups: count,
      productionCues: count,
      goldCues: count,
      supergroups: count,
      eligibleSupergroups: count,
      crossFoldComponents: count,
      newAsrInference: z.literal(0),
      newCtcInference: z.literal(0),
      productionMutations: z.literal(0),
    })
    .strict(),
  coverage: c6121CoverageSchema,
  route: c6121RouteSchema.shape.route,
  engineeringGate: z.boolean(),
  evaluationCoverageGate: z.boolean(),
  selectedSafeProfile: id.nullable(),
  productionStatus: z.literal("needs-review"),
  finalizationMethod: z.literal("none"),
  privacy: z.literal("AGGREGATES_AND_HASHES_ONLY"),
  containsGoldText: z.literal(false),
  containsCandidateText: z.literal(false),
  absolutePrivatePathCount: z.literal(0),
  secretCount: z.literal(0),
});
export const c6121ReportDataSchema = art("c6-1-2-1-report-data", {
  validationHash: sha,
  qaEvidenceHash: sha,
  sections: z
    .array(z.object({ number: count, title: id, value: z.string() }).strict())
    .length(149),
  questions: z
    .array(z.object({ number: count, answer: z.string() }).strict())
    .length(20),
  reportRelativePath: id,
  rawGoldTextIncluded: z.literal(false),
});
export const c6121DeliverySchema = art("c6-1-2-1-delivery-receipt", {
  branch: id,
  baselineCommit: id,
  head: id,
  remoteHead: id,
  commits: z.array(z.object({ role: id, sha: id, subject: id }).strict()),
  upstreamAhead: count,
  upstreamBehind: count,
  workingTreeClean: z.boolean(),
  validationHash: sha,
  qaEvidenceHash: sha,
  reportRelativePath: id,
  outputDirectories: ids,
  route: c6121RouteSchema.shape.route,
  productionMutation: z.literal(0),
});
export type C6121Coverage = z.infer<typeof c6121CoverageSchema>;
export type C6121Labels = z.infer<typeof c6121LabelsSchema>;
export type C6121Baseline = z.infer<typeof c6121BaselineSchema>;
export type C6121Integrity = z.infer<typeof c6121IntegritySchema>;
export type C6121Route = z.infer<typeof c6121RouteSchema>;
export type C6121Completeness = z.infer<typeof c6121CompletenessSchema>;
export const c6121GeneratedSchemas: readonly (readonly [
  string,
  z.ZodObject,
])[] = [
  c6121BaselineSchema,
  c6121TimingBarrierSchema,
  c6121TextBarrierSchema,
  c6121EdgesSchema,
  c6121MapSchema,
  c6121IntegritySchema,
  c6121LabelsSchema,
  c6121ProfileLabelsSchema,
  c6121FrozenEvaluationSchema,
  c6121RetrainedEvaluationSchema,
  c6121ModelsSchema,
  c6121ThresholdsSchema,
  c6121RankingsSchema,
  c6121DecisionsSchema,
  c6121StabilitySchema,
  c6121E0Schema,
  c6121E1Schema,
  c6121CoverageAuditSchema,
  c6121ModeComparisonSchema,
  c6121SensitivitySchema,
  c6121CompletenessSchema,
  c6121RouteSchema,
  c6121ShadowProvenanceSchema,
  c6121ValidationSchema,
  c6121FreezeSchema,
  c6121ReadOnlySchema,
  c6121TrainingParitySchema,
  c6121PolicyFreezeSchema,
  c6121TimingInputSchema,
  c6121ConfigurationsSchema,
  c6121DiagnosticsSchema,
  c6121QaSchema,
  c6121ShareableSchema,
  c6121GoldCountsSchema,
  c6121ReportDataSchema,
  c6121DeliverySchema,
].map((schema) => [schema.shape.artifactType.value, schema] as const);
