import { z } from "zod";
import {
  c6121FileSchema,
  c6121GoldTimingCueSchema,
  c6121EdgeSchema,
  c6121SupergroupSchema,
  c6121GroupScoreSchema,
  c6121FoldMetricSchema,
  c6121ProfileMetricSchema,
  c6121CandidateRowSchema,
  c6121ModelsSchema,
  c6121ThresholdsSchema,
  c6121RankingsSchema,
  c6121DecisionsSchema,
  c6121ConfigurationsSchema,
  c6121TrainingParitySchema,
  c6121QaSchema,
  c6121ReadOnlySchema,
} from "./c6-1-2-1-evaluation-recovery-schemas.js";

export const C61211_VERSION =
  "c6.1.2.1.1-constrained-monotonic-partition-reachable-evaluation-v1" as const;
const id = z.string().min(1),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
const num = z.number(),
  count = num.int().nonnegative(),
  ratio = num.min(0).max(1);
const ids = z.array(id),
  interval = z.object({ start: num, end: num }).strict();
const range = z.object({ start: count, end: count }).strict();
const check = z
  .object({
    name: id,
    passed: z.boolean(),
    observed: z.string(),
    expected: z.string(),
  })
  .strict();
const fraction = z
  .object({
    numerator: num.nonnegative(),
    denominator: num.nonnegative(),
    ratio: ratio.nullable(),
  })
  .strict();
const reasonCounts = z.array(z.object({ reason: id, count }).strict());
export const c61211ModeSchema = z.enum([
  "D0_NO_CUT",
  "D1_CONSERVATIVE_MONOTONIC",
  "D2_RELAXED_DIAGNOSTIC_ONLY",
]);
export type C61211Mode = z.infer<typeof c61211ModeSchema>;
const header = {
  schemaVersion: true,
  artifactType: true,
  policyVersion: true,
  policyHash: true,
  semanticHash: true,
} as const;
export function c61211ArtifactSchema<
  const N extends string,
  S extends z.ZodRawShape,
>(name: N, shape: S) {
  return z
    .object({
      schemaVersion: z.literal("1.0.0"),
      artifactType: z.literal(name),
      policyVersion: z.literal(C61211_VERSION),
      policyHash: sha,
      semanticHash: sha,
      ...shape,
    })
    .strict();
}
const art = c61211ArtifactSchema;
export const c61211PolicySchema = art("c6-1-2-1-1-policy-freeze", {
  serializedDefinition: id,
  definitionHash: sha,
  partitionPolicyHash: sha,
  coveragePolicyHash: sha,
  routePolicyHash: sha,
  frozenBeforeGoldText: z.literal(true),
  primaryEvaluator: z.literal(
    "E3_CONSTRAINED_MONOTONIC_PARTITIONED_SUPERGROUP",
  ),
});
export const c61211BaselineSchema = art(
  "c6-1-2-1-1-baseline-freeze-verification",
  {
    machineFrozenAt: z.iso.datetime(),
    baselineCommit: id,
    baselinePolicyHash: sha,
    baselineAHash: sha,
    baselineBHash: sha,
    originalMachineFreezeHash: sha,
    originalRerankingFreezeHash: sha,
    files: z.array(c6121FileSchema),
    inputAggregateHash: sha,
    checks: z.array(check),
    passed: z.boolean(),
    rawGoldReadCount: z.literal(0),
    productionTextHash: sha,
    productionTimingHash: sha,
    productionPresentationHash: sha,
    baselineReplayHashes: z.array(
      z.object({ name: id, semanticHash: sha }).strict(),
    ),
  },
);
export const c61211TimingSchema = art("c6-1-2-1-1-gold-timing-barrier", {
  machineFrozenAt: z.iso.datetime(),
  goldTimingFirstReadAt: z.iso.datetime(),
  baselineFreezeHash: sha,
  goldTimingHash: sha,
  goldByteHash: sha,
  goldFile: c6121FileSchema,
  rows: z.array(c6121GoldTimingCueSchema),
  rawGoldTextReadCount: z.literal(0),
  parser: z.literal("ASS_PREFIX_ONLY_NO_DIALOGUE_TEXT_DECODE"),
});
export const c61211FreezeSchema = art("c6-1-2-1-1-partition-freeze", {
  partitionFrozenAt: z.iso.datetime(),
  baselineFreezeHash: sha,
  timingBarrierHash: sha,
  partitionMapHash: sha,
  frozenFiles: z.array(z.object({ relativePath: id, sha256: sha }).strict()),
  policyDefinitionHash: sha,
  rawGoldTextReadCount: z.literal(0),
});
export const c61211TextBarrierSchema = art(
  "c6-1-2-1-1-gold-text-scoring-barrier",
  {
    partitionFrozenAt: z.iso.datetime(),
    goldTextFirstReadAt: z.iso.datetime(),
    partitionFreezeHash: sha,
    partitionMapHash: sha,
    goldTimingHash: sha,
    goldByteHash: sha,
    goldTextScoringInputCount: count,
    machineRuntimeRawGoldInputCount: z.literal(0),
    partitionBuilderGoldTextInputCount: z.literal(0),
    predictionStageRawGoldInputCount: z.literal(0),
  },
);
export const c61211InventorySchema = art(
  "c6-1-2-1-1-oversized-component-inventory",
  {
    e2MapHash: sha,
    edgeLedgerHash: sha,
    goldTimingHash: sha,
    rows: z.array(
      z
        .object({
          parentE2SupergroupId: id,
          machineGroupIds: ids,
          machineCueIds: ids,
          goldCueIds: ids,
          edgeIds: ids,
          bilateral: z.boolean(),
          alreadyBounded: z.boolean(),
          attempted: z.boolean(),
          oversized: z.boolean(),
          pureLowCoverage: z.boolean(),
          durationSeconds: num.nonnegative(),
          machineCueCount: count,
          goldCueCount: count,
          frozenFoldIds: ids,
          reasons: ids,
          semanticHash: sha,
        })
        .strict(),
    ),
    e2Edges: z.array(c6121EdgeSchema),
    reasonCounts,
    goldTextUsedForPartitionCount: z.literal(0),
  },
);
export const c61211BlockSchema = z
  .object({
    ...c6121SupergroupSchema.omit({
      supergroupId: true,
      semanticHash: true,
      structuralStatus: true,
    }).shape,
    partitionBlockId: id,
    parentE2SupergroupId: id,
    machineIndexRange: range.nullable(),
    goldIndexRange: range.nullable(),
    retainedEdgeIds: ids,
    cutEdgeIds: ids,
    minimumNodeRetainedOverlapRatio: ratio,
    discardedOverlapSeconds: num.nonnegative(),
    componentDiscardedOverlapRatio: ratio,
    structuralStatus: z.enum([
      "STRUCTURALLY_VALID",
      "STRUCTURE_INCOMPATIBLE",
      "RESIDUAL_UNPARTITIONED",
      "GOLD_ONLY_UNREACHABLE",
      "MACHINE_ONLY_NO_GOLD_BINDING",
    ]),
    assignmentCategory: z.enum([
      "PARTITIONED_EVALUABLE_BLOCK",
      "PARTITIONED_CANDIDATE_LABEL_INELIGIBLE_BLOCK",
      "RESIDUAL_UNPARTITIONED",
      "GOLD_ONLY",
      "MACHINE_ONLY",
    ]),
    nodeRetainedOverlap: z.array(
      z
        .object({
          nodeId: id,
          side: z.enum(["MACHINE", "GOLD"]),
          retainedSeconds: num.nonnegative(),
          originalSeconds: num.nonnegative(),
          ratio,
        })
        .strict(),
    ),
    semanticHash: sha,
  })
  .strict();
export type C61211Block = z.infer<typeof c61211BlockSchema>;
export const c61211CandidatesSchema = art(
  "c6-1-2-1-1-partition-candidate-blocks",
  {
    mode: c61211ModeSchema,
    inventoryHash: sha,
    rows: z.array(
      z
        .object({
          block: c61211BlockSchema,
          valid: z.boolean(),
          rejectionReasons: ids,
        })
        .strict(),
    ),
    candidateBlockCount: count,
    validCandidateBlockCount: count,
    goldTextUsedForPartitionCount: z.literal(0),
  },
);
export const c61211ObjectiveSchema = z
  .object({
    retainedOverlapSeconds: num.nonnegative(),
    candidateReachableMachineGroups: count,
    productionCueCount: count,
    interventionReachableGoldCues: count,
    discardedOverlapSeconds: num.nonnegative(),
    residualBilateralNodes: count,
    blockCount: count,
    deterministicPathHash: sha,
  })
  .strict();
export type C61211Objective = z.infer<typeof c61211ObjectiveSchema>;
export const c61211PartitionStatusSchema = z.enum([
  "ALREADY_BOUNDED",
  "FULLY_PARTITIONED",
  "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
  "UNSPLITTABLE_STRONG_BRIDGE",
  "UNSPLITTABLE_COVERAGE",
  "UNSPLITTABLE_CUE_LIMIT",
  "UNSPLITTABLE_DURATION_LIMIT",
  "UNSPLITTABLE_GAP_LIMIT",
  "CROSS_FOLD_BLOCKED",
  "NO_VALID_MONOTONIC_PARTITION",
  "GOLD_ONLY_UNREACHABLE",
  "MACHINE_ONLY_NO_GOLD_BINDING",
]);
export const c61211MapSchema = art("c6-1-2-1-1-partitioned-supergroup-map", {
  mode: c61211ModeSchema,
  e2MapHash: sha,
  inventoryHash: sha,
  candidateBlocksHash: sha,
  machineMappingHash: sha,
  foldHash: sha,
  goldTimingHash: sha,
  edgeLedgerHash: sha,
  baselineCueOrder: ids,
  goldCueOrder: ids,
  blocks: z.array(c61211BlockSchema),
  components: z.array(
    z
      .object({
        parentE2SupergroupId: id,
        status: c61211PartitionStatusSchema,
        partitionBlockIds: ids,
        residualBlockIds: ids,
        originalEdgeSeconds: num.nonnegative(),
        cutOverlapSeconds: num.nonnegative(),
        componentDiscardedOverlapRatio: ratio,
        minimumNodeRetainedOverlapRatio: ratio,
        objective: c61211ObjectiveSchema,
        visitedStates: count,
        solver: z.literal("EXACT_MONOTONE_INTERVAL_DAG_ENUMERATION"),
        optimalityProven: z.literal(true),
        reasons: ids,
      })
      .strict(),
  ),
  goldTextUsedForPartitionCount: z.literal(0),
  profileRematchingCount: z.literal(0),
});
export type C61211Map = z.infer<typeof c61211MapSchema>;
export const c61211CutsSchema = art("c6-1-2-1-1-cut-edge-ledger", {
  mode: c61211ModeSchema,
  partitionMapHash: sha,
  rows: z.array(
    z
      .object({
        edgeId: id,
        parentComponentId: id,
        machineGroupId: id,
        goldCueId: id,
        sourceBlockId: id,
        targetBlockId: id,
        overlapIntervals: z.array(interval),
        overlapSeconds: num.nonnegative(),
        machineIntersectionRatio: ratio,
        goldIntersectionRatio: ratio,
        weakBridgeStrength: ratio,
        strongBridge: z.boolean(),
        cutAllowed: z.boolean(),
        cutReasons: ids,
        semanticHash: sha,
      })
      .strict(),
  ),
  independentCutOverlapSeconds: num.nonnegative(),
  unsafeCutCount: count,
  strongBridgeCutCount: count,
});
export const c61211ResidualsSchema = art("c6-1-2-1-1-partition-residuals", {
  mode: c61211ModeSchema,
  partitionMapHash: sha,
  rows: z.array(
    z
      .object({
        residualBlockId: id,
        parentE2SupergroupId: id,
        residualMachineGroupIds: ids,
        residualProductionCueIds: ids,
        residualGoldCueIds: ids,
        residualEdgeIds: ids,
        residualReasons: ids,
        potentiallyRecoverableWithRelaxedPolicy: z.boolean(),
        semanticHash: sha,
      })
      .strict(),
  ),
});
export const c61211ConservationSchema = art(
  "c6-1-2-1-1-partition-conservation-audit",
  {
    mode: c61211ModeSchema,
    partitionMapHash: sha,
    duplicatedMachineGroupCount: count,
    missingMachineGroupCount: count,
    extraMachineGroupCount: count,
    duplicatedProductionCueCount: count,
    missingProductionCueCount: count,
    extraProductionCueCount: count,
    duplicatedGoldCueCount: count,
    missingGoldCueCount: count,
    extraGoldCueCount: count,
    unaccountedEdgeCount: count,
    multiplyAccountedEdgeCount: count,
    unsafeCutCount: count,
    strongBridgeCutCount: count,
    nonMonotonicPartitionCount: count,
    crossFoldPartitionCount: count,
    retainedOverlapViolationCount: count,
    cutLossViolationCount: count,
    goldTextUsedForPartitionCount: z.literal(0),
    profileRematchingCount: z.literal(0),
    passed: z.boolean(),
  },
);
export type C61211Conservation = z.infer<typeof c61211ConservationSchema>;
export const c61211ScopeSchema = art("c6-1-2-1-1-reachable-scope", {
  e2MapHash: sha,
  candidateSetHash: sha,
  scopeDefinitionHash: sha,
  globalGoldCueIds: ids,
  interventionReachableGoldCueIds: ids,
  goldOnlyUnreachableCueIds: ids,
  allMachineGroupIds: ids,
  candidateReachableMachineGroupIds: ids,
  allProductionCueIds: ids,
  candidateReachableProductionCueIds: ids,
  candidateReachableEventIds: ids,
  frozenCandidateEventIds: ids,
  allCandidateIds: ids,
  topKCandidateIds: ids,
  rawGoldTextIncluded: z.literal(false),
});
export type C61211Scope = z.infer<typeof c61211ScopeSchema>;
export const c61211CoverageMetricsSchema = z
  .object({
    allMachineGroupCoverage: fraction,
    productionCueCoverage: fraction,
    globalGoldCueCoverage: fraction,
    interventionReachableGoldCueCoverage: fraction,
    candidateReachableMachineGroupCoverage: fraction,
    candidateReachableProductionCueCoverage: fraction,
    candidateEventLabelCoverage: fraction,
    candidateLabelCoverage: fraction,
    topKCandidateLabelCoverage: fraction,
    machineDurationCoverage: fraction,
    globalGoldDurationCoverage: fraction,
    reachableGoldDurationCoverage: fraction,
    globalGoldCharacterCoverage: fraction.nullable(),
  })
  .strict();
export type C61211CoverageMetrics = z.infer<typeof c61211CoverageMetricsSchema>;
export const c61211CoverageSchema = art("c6-1-2-1-1-reachable-coverage-audit", {
  mode: c61211ModeSchema,
  partitionMapHash: sha,
  reachableScopeHash: sha,
  coverage: c61211CoverageMetricsSchema,
  evaluableMachineGroupIds: ids,
  evaluableProductionCueIds: ids,
  evaluableGoldCueIds: ids,
  evaluableEventIds: ids,
  evaluableCandidateIds: ids,
  globalGoldCoverageIsDiagnosticOnly: z.literal(true),
});
export const c61211GateSchema = art("c6-1-2-1-1-coverage-gate-v2", {
  partitionMapHash: sha,
  coverageAuditHash: sha,
  checks: z.array(check),
  passed: z.boolean(),
  profileSelectionUsed: z.literal(false),
  globalGoldCoverageUsed: z.literal(false),
  primaryMode: z.literal("D1_CONSERVATIVE_MONOTONIC"),
});
export const c61211ScoreSchema = c6121GroupScoreSchema
  .omit({ supergroupId: true })
  .extend({ partitionBlockId: id })
  .strict();
export const c61211ProfileSchema = c6121ProfileMetricSchema
  .omit({
    supergroupMapHash: true,
    changedSupergroups: true,
    evaluableChangedSupergroups: true,
    changedSupergroupCoverage: true,
    zeroSelectionChangedCoverage: true,
    groups: true,
  })
  .extend({
    partitionMapHash: sha,
    selectedCount: count,
    changedBlocks: count,
    evaluableChangedBlocks: count,
    changedBlockCoverage: fraction,
    groups: z.array(c61211ScoreSchema),
    safeProfileEligible: z.boolean(),
  })
  .strict();
export type C61211Profile = z.infer<typeof c61211ProfileSchema>;
const evaluations = {
  partitionMapHash: sha,
  scoringAdapterHash: sha,
  profiles: z.array(c61211ProfileSchema),
};
export const c61211FrozenEvaluationSchema = art(
  "c6-1-2-1-1-frozen-decision-reevaluation",
  evaluations,
);
export const c61211OofEvaluationSchema = art(
  "c6-1-2-1-1-oof-profile-evaluation",
  evaluations,
);
export const c61211ProfileLabelsSchema = art(
  "gold-c6-1-2-1-1-partition-profile-labels",
  evaluations,
);
export const c61211ProfileEvidenceSchema = art(
  "c6-1-2-1-1-profile-evidence-coverage",
  {
    partitionMapHash: sha,
    rows: z.array(
      z
        .object({
          profileId: id,
          track: c61211ProfileSchema.shape.track,
          selectedCount: count,
          changedBlockCoverage: fraction,
          changedMachineGroupCoverage: fraction,
          selectionPrecision: ratio.nullable(),
          harmRate: ratio.nullable(),
          passed: z.boolean(),
          safeProfileEligible: z.boolean(),
        })
        .strict(),
    ),
    evaluatorGateInput: z.literal(false),
  },
);
export const c61211CandidateRowSchema = c6121CandidateRowSchema
  .omit({ supergroupId: true })
  .extend({ partitionBlockId: id.nullable() })
  .strict();
export const c61211LabelsSchema = art(
  "gold-c6-1-2-1-1-partition-candidate-labels",
  {
    partitionMapHash: sha,
    scoringAdapterHash: sha,
    goldByteHash: sha,
    labels: z.array(c61211CandidateRowSchema),
    rawGoldTextIncluded: z.literal(false),
    labelsFedToRuntimeInference: z.literal(false),
  },
);
export type C61211Labels = z.infer<typeof c61211LabelsSchema>;
export const c61211StabilitySchema = art("c6-1-2-1-1-label-stability-audit", {
  oldEvaluableCandidateLabels: count,
  newEvaluableCandidateLabels: count,
  newlyRecoveredCandidateLabels: count,
  previouslyEvaluableNowLost: count,
  commonEvaluableCount: count,
  stillUnevaluableCandidateLabels: count,
  exactLabelAgreementCount: count,
  normalizedGainDirectionAgreementCount: count,
  exactGainDirectionAgreementCount: count,
  materialDirectionAgreementCount: count,
  catastrophicAgreementCount: count,
  rows: z.array(
    z
      .object({
        candidateId: id,
        eventId: id,
        oldSupergroupId: id.nullable(),
        partitionBlockId: id.nullable(),
        oldEligible: z.boolean(),
        newEligible: z.boolean(),
        oldLabelClass: id,
        newLabelClass: id,
        exactLabelAgreement: z.boolean().nullable(),
        normalizedGainDirectionAgreement: z.boolean().nullable(),
        exactGainDirectionAgreement: z.boolean().nullable(),
        materialDirectionAgreement: z.boolean().nullable(),
        catastrophicAgreement: z.boolean().nullable(),
      })
      .strict(),
  ),
});
export const c61211TrainingSchema = art(
  "c6-1-2-1-1-training-contract-parity",
  c6121TrainingParitySchema.omit(header).shape,
);
export const c61211ModelsSchema = art("c6-1-2-1-1-oof-retrain-models", {
  ...c6121ModelsSchema.omit({ ...header, supergroupMapHash: true }).shape,
  partitionMapHash: sha,
});
export const c61211ThresholdsSchema = art("c6-1-2-1-1-oof-retrain-thresholds", {
  ...c6121ThresholdsSchema.omit({ ...header, supergroupMapHash: true }).shape,
  partitionMapHash: sha,
});
export const c61211RankingsSchema = art("c6-1-2-1-1-oof-rankings", {
  ...c6121RankingsSchema.omit({ ...header, supergroupMapHash: true }).shape,
  partitionMapHash: sha,
});
export const c61211DecisionsSchema = art("c6-1-2-1-1-oof-decisions", {
  ...c6121DecisionsSchema.omit({ ...header, supergroupMapHash: true }).shape,
  partitionMapHash: sha,
});
export const c61211ConfigurationsSchema = art("c6-1-2-1-1-oof-configurations", {
  ...c6121ConfigurationsSchema.omit({ ...header, supergroupMapHash: true })
    .shape,
  partitionMapHash: sha,
});
const comparison = z
  .object({
    profileId: id,
    track: c61211ProfileSchema.shape.track,
    parentE2SupergroupId: id,
    fullyEvaluatedPartition: z.boolean(),
    partitionBlockIds: ids,
    whole: c6121GroupScoreSchema,
    partitionExactGain: num.nullable(),
    partitionNormalizedGain: num.nullable(),
    partitionMaterialDelta: num.nullable(),
    partitionCatastrophic: z.boolean().nullable(),
    normalizedDirectionAgreement: z.boolean().nullable(),
    exactDirectionAgreement: z.boolean().nullable(),
    materialDirectionAgreement: z.boolean().nullable(),
    catastrophicAgreement: z.boolean().nullable(),
  })
  .strict();
export const c61211WholeSchema = art(
  "c6-1-2-1-1-whole-component-diagnostic-evaluation",
  {
    evaluator: z.literal("E4_WHOLE_COMPONENT_PROFILE_SCORE_ONLY"),
    partitionMapHash: sha,
    rows: z.array(comparison),
    eligibleForTraining: z.literal(false),
    eligibleForSafeProfile: z.literal(false),
    eligibleForRoute: z.literal(false),
    globalQuality: z.array(
      z
        .object({
          profileId: id,
          track: c61211ProfileSchema.shape.track,
          goldCueCount: count,
          normalizedGoldCharacters: count,
          exactError: count,
          normalizedError: count,
          normalizedCer: num.nonnegative(),
          goldOnlyMissingCharacters: count,
        })
        .strict(),
    ),
  },
);
export const c61211BiasSchema = art("c6-1-2-1-1-partition-bias-audit", {
  partitionMapHash: sha,
  wholeDiagnosticHash: sha,
  cutEdgeCount: count,
  cutOverlapSeconds: num.nonnegative(),
  maximumComponentDiscardedOverlapRatio: ratio,
  labelDirectionDisagreementCount: count,
  comparedProfileComponents: count,
  gainDirectionAgreementCount: count,
  gainDirectionDisagreementCount: count,
  incomparableCount: count,
  materialDirectionDisagreementCount: count,
  catastrophicDisagreementCount: count,
  disagreementComponentIds: ids,
  checks: z.array(check),
  passed: z.boolean(),
  wholeComponentScoresUsedForRoute: z.literal(false),
});
export const c61211SensitivitySchema = art("c6-1-2-1-1-evaluator-sensitivity", {
  rows: z.array(
    z
      .object({
        evaluator: z.enum(["E0", "E1", "E2", "E3", "E4"]),
        profileId: id,
        track: id,
        changedUnits: count,
        improved: count,
        regressed: count,
        neutral: count,
        unknown: count,
        normalizedJointGain: num.nullable(),
        materialDelta: num.nullable(),
        catastrophic: count,
        folds: z.array(c6121FoldMetricSchema),
        diagnosticOnly: z.boolean(),
      })
      .strict(),
  ),
  coverageRows: z.array(
    z
      .object({
        evaluator: z.enum(["E0", "E1", "E2", "E3", "E4"]),
        machineGroupCoverage: fraction,
        productionCueCoverage: fraction,
        globalGoldCoverage: fraction,
        reachableGoldCoverage: fraction,
        candidateEventLabelCoverage: fraction.nullable(),
        topKCandidateLabelCoverage: fraction.nullable(),
      })
      .strict(),
  ),
  primaryEvaluator: z.literal("E3"),
});
export const c61211AttributionSchema = art(
  "c6-1-2-1-1-coverage-recovery-attribution",
  {
    rows: z.array(
      z
        .object({
          parentE2SupergroupId: id,
          reasons: ids,
          status: c61211PartitionStatusSchema,
          recoveredMachineGroupIds: ids,
          recoveredProductionCueIds: ids,
          recoveredGoldCueIds: ids,
          newlyEvaluableCandidateIds: ids,
          directionChangedCandidateIds: ids,
        })
        .strict(),
    ),
  },
);
export const c61211CompletenessSchema = art(
  "c6-1-2-1-1-completeness-diagnosis-v2",
  {
    nonUnknownCompletenessCoverage: fraction,
    blockedSelectionOccurrences: count,
    blockedUniqueCandidates: count,
    blockedCandidateIds: ids,
    catastrophicCandidatesBlocked: count,
    safeCandidatesBlocked: count,
    safeCandidateFalseBlockRate: fraction,
    gatedZeroSelectionProfiles: ids,
    nonGatedPositiveUnsafeProfiles: ids,
    nonGatedNegativeGainProfiles: ids,
    diagnosticMainBlocker: z.boolean(),
    coverageQualifiedMainBlocker: z.boolean(),
    noThresholdChange: z.literal(true),
    reasons: ids,
  },
);
export const c61211RouteSchema = art("c6-1-2-1-1-route-decision", {
  route: z.enum([
    "GO_C6_1_3_FROZEN_TOP_K_RERANKER_PROSPECTIVE_SHADOW",
    "GO_C6_1_2_2_ACOUSTIC_COMPLETENESS_CALIBRATION",
    "STOP_EXISTING_CANDIDATE_AUTOMATIC_RERANKING",
    "EVALUATION_PARTITION_UNRECOVERABLE_WITHOUT_UNSAFE_CUTS",
    "C6_1_2_1_1_ENGINEERING_INVALID",
  ]),
  engineeringGate: z.boolean(),
  evaluationCoverageGate: z.boolean(),
  partitionBiasGate: z.boolean(),
  rerankerStrongSupportGate: z.boolean(),
  safeProfileCandidates: ids,
  selectedSafeProfile: id.nullable(),
  descriptiveBestFrozenProfile: id.nullable(),
  descriptiveBestRetrainedProfile: id.nullable(),
  profileChecks: z.array(
    z
      .object({ profileId: id, checks: z.array(check), passed: z.boolean() })
      .strict(),
  ),
  reasons: ids,
  c6122: z.enum(["GO", "HOLD"]),
  c613: z.enum(["GO", "HOLD"]),
  productionStatus: z.literal("needs-review"),
  finalizationMethod: z.literal("none"),
  productionMutation: z.literal(0),
  primaryMode: z.literal("D1_CONSERVATIVE_MONOTONIC"),
  relaxedDiagnosticUsedForRoute: z.literal(false),
});
export type C61211Route = z.infer<typeof c61211RouteSchema>;
export const c61211ShadowsSchema = art("c6-1-2-1-1-research-shadow-manifest", {
  partitionMapHash: sha,
  rows: z.array(
    z
      .object({
        profileId: id,
        track: c61211ProfileSchema.shape.track,
        relativeDirectory: id,
        selectedCandidateIds: ids,
        timingHash: sha,
        textHash: sha,
        files: z.array(z.object({ relativePath: id, sha256: sha }).strict()),
      })
      .strict(),
  ),
  productionMutation: z.literal(0),
  newCandidates: z.literal(0),
  localOnly: z.literal(true),
});
export const c61211ReadOnlySchema = art(
  "c6-1-2-1-1-read-only-proof",
  c6121ReadOnlySchema.omit(header).shape,
);
export const c61211QaSchema = art(
  "c6-1-2-1-1-regression-evidence",
  c6121QaSchema.omit(header).shape,
);
export const c61211ValidationSchema = art("c6-1-2-1-1-validation", {
  checks: z.array(check),
  passed: z.boolean(),
  checkedArtifacts: count,
  schemaCount: count,
  aBSemanticParity: z.boolean(),
  aBByteParity: z.boolean(),
  productionParity: z.boolean(),
  sourceReadOnly: z.boolean(),
  goldReadOnly: z.boolean(),
  modelExecutionCount: z.literal(0),
  networkDuringResearch: z.literal(false),
  qaEvidenceHash: sha,
  generatedAt: z.iso.datetime(),
});
export const c61211ShareableSchema = art("c6-1-2-1-1-shareable-summary", {
  baselineCommit: id,
  partitionMapHash: sha,
  reachableScopeHash: sha,
  route: c61211RouteSchema.shape.route,
  engineeringGate: z.boolean(),
  coverageGate: z.boolean(),
  productionStatus: z.literal("needs-review"),
  finalizationMethod: z.literal("none"),
  counts: z
    .object({
      productionCues: count,
      machineGroups: count,
      goldCues: count,
      evaluationBlocks: count,
      residualBlocks: count,
      cuts: count,
      strongCuts: count,
      acousticInference: z.literal(0),
      productionMutation: z.literal(0),
    })
    .strict(),
  coverage: c61211CoverageMetricsSchema,
  privacy: z.literal("AGGREGATES_AND_HASHES_ONLY"),
  containsGoldText: z.literal(false),
  containsCandidateText: z.literal(false),
  absolutePrivatePathCount: z.literal(0),
  secretCount: z.literal(0),
});
export const c61211ReportDataSchema = art("c6-1-2-1-1-report-data", {
  validationHash: sha,
  qaEvidenceHash: sha,
  reportRelativePath: id,
  sections: z
    .array(z.object({ number: count, title: id, value: z.string() }).strict())
    .length(144),
  finalFields: z
    .array(z.object({ number: count, title: id, value: z.string() }).strict())
    .length(150),
  questions: z
    .array(z.object({ number: count, answer: z.string() }).strict())
    .length(20),
  rawGoldTextIncluded: z.literal(false),
});
export const c61211DeliverySchema = art("c6-1-2-1-1-delivery-receipt", {
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
  route: c61211RouteSchema.shape.route,
});
export const c61211GeneratedSchemas: readonly (readonly [
  string,
  z.ZodObject,
])[] = [
  c61211PolicySchema,
  c61211BaselineSchema,
  c61211TimingSchema,
  c61211FreezeSchema,
  c61211TextBarrierSchema,
  c61211InventorySchema,
  c61211CandidatesSchema,
  c61211MapSchema,
  c61211CutsSchema,
  c61211ResidualsSchema,
  c61211ConservationSchema,
  c61211ScopeSchema,
  c61211CoverageSchema,
  c61211GateSchema,
  c61211ProfileEvidenceSchema,
  c61211LabelsSchema,
  c61211StabilitySchema,
  c61211FrozenEvaluationSchema,
  c61211OofEvaluationSchema,
  c61211ProfileLabelsSchema,
  c61211TrainingSchema,
  c61211ModelsSchema,
  c61211ThresholdsSchema,
  c61211RankingsSchema,
  c61211DecisionsSchema,
  c61211ConfigurationsSchema,
  c61211WholeSchema,
  c61211BiasSchema,
  c61211SensitivitySchema,
  c61211AttributionSchema,
  c61211CompletenessSchema,
  c61211RouteSchema,
  c61211ShadowsSchema,
  c61211ReadOnlySchema,
  c61211QaSchema,
  c61211ValidationSchema,
  c61211ShareableSchema,
  c61211ReportDataSchema,
  c61211DeliverySchema,
].map((schema) => [schema.shape.artifactType.value, schema] as const);
