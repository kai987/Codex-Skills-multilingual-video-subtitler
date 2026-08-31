import {
  c6121MapSchema,
  c6121LabelsSchema,
  type C61211Map,
  type C61211Block,
  type C61211Labels,
  type C6121Supergroup,
} from "@mvl/shared";
import { c6121Artifact, hash } from "../evaluation-recovery/c6121-policy.js";

/** Transient adapter for the unchanged joint edit-distance scorer and trainer.
 * It has its own honest legacy-contract hash; it is NEVER persisted as E2 and
 * cannot replace the original E2 map. New artifacts bind both hashes explicitly. */
export function scoringC61211Group(b: C61211Block): C6121Supergroup {
  const body: Omit<C6121Supergroup, "semanticHash"> = {
    supergroupId: b.partitionBlockId,
    machineGroupIds: b.machineGroupIds,
    machineCueIds: b.machineCueIds,
    machineEventIds: b.machineEventIds,
    goldCueIds: b.goldCueIds,
    edgeIds: b.retainedEdgeIds,
    foldId: b.foldId,
    frozenFoldIds: b.frozenFoldIds,
    machineSourceInterval: b.machineSourceInterval,
    goldSourceInterval: b.goldSourceInterval,
    totalSourceInterval: b.totalSourceInterval,
    machineCoveredRatio: b.machineCoveredRatio,
    goldCoveredRatio: b.goldCoveredRatio,
    machineCueCount: b.machineCueCount,
    goldCueCount: b.goldCueCount,
    machineGroupCount: b.machineGroupCount,
    maximumMachineGapSeconds: b.maximumMachineGapSeconds,
    maximumGoldGapSeconds: b.maximumGoldGapSeconds,
    durationSeconds: b.durationSeconds,
    structuralStatus: !b.machineGroupIds.length
      ? "NO_MACHINE_MAPPING"
      : !b.goldCueIds.length
        ? "NO_GOLD_MAPPING"
        : !b.shadowEvaluationEligible
          ? "STRUCTURE_INCOMPATIBLE"
          : b.machineCueCount === 1
            ? b.goldCueCount === 1
              ? "FIXED_ONE_TO_ONE"
              : "FIXED_ONE_TO_MANY"
            : b.goldCueCount === 1
              ? "FIXED_MANY_TO_ONE"
              : "FIXED_MANY_TO_MANY",
    shadowEvaluationEligible: b.shadowEvaluationEligible,
    candidateLabelEligible: b.candidateLabelEligible,
    oofTrainingEligible: b.oofTrainingEligible,
    candidateEligibleEventIds: b.candidateEligibleEventIds,
    candidateAmbiguousEventIds: b.candidateAmbiguousEventIds,
    reasons: b.reasons,
  };
  return { ...body, semanticHash: hash(body) };
}
export function scoringC61211Adapter(map: C61211Map) {
  return c6121MapSchema.parse(
    c6121Artifact("c6-1-2-1-evaluator-supergroup-map", {
      machineMappingHash: map.machineMappingHash,
      foldHash: map.foldHash,
      goldTimingHash: map.goldTimingHash,
      edgeLedgerHash: map.edgeLedgerHash,
      baselineCueOrder: map.baselineCueOrder,
      goldCueOrder: map.goldCueOrder,
      groups: map.blocks.map(scoringC61211Group),
      unmappedGoldCueIds: map.blocks
        .filter((b) => b.assignmentCategory === "GOLD_ONLY")
        .flatMap((b) => b.goldCueIds),
      goldTextUsedForGroupingCount: 0,
      profileRematchingCount: 0,
    }),
  );
}
export function trainingC61211Labels(labels: C61211Labels) {
  return c6121LabelsSchema.parse(
    c6121Artifact("gold-c6-1-2-1-supergroup-candidate-labels", {
      supergroupMapHash: labels.scoringAdapterHash,
      goldByteHash: labels.goldByteHash,
      labels: labels.labels.map(({ partitionBlockId, ...row }) => ({
        ...row,
        supergroupId: partitionBlockId,
      })),
      rawGoldTextIncluded: false,
      labelsFedToRuntimeInference: false,
    }),
  );
}
