import {
  jointFeasibility145Schema,
  type Bundles143,
  type CoverageUnits145,
  type Dominance143,
  type Hierarchy143,
  type JointFeasibility145,
  type Obligations143,
  type Planner143,
  type Planner145,
  type Policy145,
  type Realization145,
  type RealizationDominance145,
  type Realizations145,
  type UnitUtility145,
} from "@mvl/shared";
import { hashed141, required141 } from "./c601141-policy.js";
import { unique142 } from "./c601142-selection.js";
import { header145 } from "./c601145-policy.js";
import {
  plannerObjective145,
  searchUnitPlan145,
} from "./c601145-unit-aware-planner.js";

const costOf145 = (row: Realization145 | undefined) => ({
  targetSlotCost: row?.targetSlotCost ?? 0,
  speechCoreCostSamples: row?.speechCoreCostSamples ?? 0,
  predictedAudioCostSamples: row?.predictedAudioCostSamples ?? 0,
});

export function runJointFeasibility145(input: {
  policy: Policy145;
  obligations: Obligations143;
  hierarchy: Hierarchy143;
  bundles: Bundles143;
  dominance: Dominance143;
  units: CoverageUnits145;
  unitUtility: UnitUtility145;
  realizations: Realizations145;
  realizationDominance: RealizationDominance145;
  baselinePlanner: Planner143;
  productionPlanner: Planner145;
  individuallyFeasibleUnselectedHighTierChildCount: number;
}): JointFeasibility145 {
  const retained = new Set(input.realizationDominance.retainedRealizationIds),
    utilityByUnit = new Map(
      input.unitUtility.rows.map((row) => [row.coverageUnitId, row]),
    ),
    requiredUnits = input.units.units.filter((unit) => {
      const row = required141(utilityByUnit.get(unit.coverageUnitId));
      return (
        row.utilityEligibility &&
        (row.speechTier === "UNIT_TIER_5_MULTI_FAMILY_VERIFIED" ||
          row.speechTier === "UNIT_TIER_4_INDEPENDENT_EXCLUSIVE_VERIFIED" ||
          (row.speechTier === "UNIT_TIER_3_SINGLE_FAMILY_VERIFIED" &&
            (unit.existingTargetCoverage < 0.95 ||
              unit.existingPlaybackCoverage < 0.95)))
      );
    }),
    productionBundleIds = new Set(input.productionPlanner.selectedBundleIds),
    productionSelected = input.productionPlanner.selectedBundleIds.map(
      (bundleId) =>
        required141(
          input.bundles.candidates.find(
            (bundle) => bundle.bundleId === bundleId,
          ),
        ),
    ),
    productionObjective = plannerObjective145({
      selected: productionSelected,
      units: input.units,
      unitUtility: input.unitUtility,
      realizations: input.realizations,
      realizationDominance: input.realizationDominance,
      immutableAudioIntervals: input.bundles.immutableAudioIntervals,
    }).vector,
    rows = requiredUnits.flatMap((unit) =>
      (
        [
          "TARGET_CORE_LOCALIZATION_CONTRACT_V1",
          "MACHINE_ANCHORED_PLAYBACK_AUDIBILITY_CONTRACT_V1",
        ] as const
      ).map((contractType) => {
        const candidates = input.realizations.candidates
            .filter(
              (row) =>
                row.eligibility &&
                retained.has(row.realizationId) &&
                row.coverageUnitId === unit.coverageUnitId &&
                row.contractType === contractType,
            )
            .sort((a, b) => a.realizationId.localeCompare(b.realizationId)),
          satisfied = candidates.find((candidate) =>
            candidate.bundleIds.every((bundleId) =>
              productionBundleIds.has(bundleId),
            ),
          );
        let result: ReturnType<typeof searchUnitPlan145> | undefined,
          selectedRealization = satisfied;
        if (!satisfied && candidates.length) {
          result = searchUnitPlan145({
            ...input,
            seedBundleIds: input.baselinePlanner.selectedBundleIds,
            optimize: false,
            forcedCoverageUnitId: unit.coverageUnitId,
            forcedContractType: contractType,
          });
          if (result.feasible) {
            const resultIds = new Set(
              result.selected.map((bundle) => bundle.bundleId),
            );
            selectedRealization = candidates.find((candidate) =>
              candidate.bundleIds.every((bundleId) => resultIds.has(bundleId)),
            );
          }
        }
        const selectedBundles = satisfied
            ? productionSelected
            : (result?.selected ?? []),
          selectedIds = selectedBundles.map((bundle) => bundle.bundleId),
          selectedChildIds = unique142(
            selectedBundles.flatMap((bundle) => bundle.childUnitIds),
          ),
          selectedSet = new Set(selectedIds),
          status = satisfied
            ? "ALREADY_SATISFIED_BY_PRODUCTION_PLAN"
            : !candidates.length
              ? "NO_REALIZATION_SET"
              : !result?.complete
                ? "SEARCH_INCOMPLETE"
                : result.feasible
                  ? "JOINTLY_FEASIBLE"
                  : "INFEASIBLE_PROVEN",
          costs = costOf145(selectedRealization),
          objectiveDelta = result?.feasible
            ? result.objective.map(
                (value, index) => value - (productionObjective[index] ?? 0),
              )
            : [];
        return jointFeasibility145Schema.shape.rows.element.parse(
          hashed141({
            coverageUnitId: unit.coverageUnitId,
            contractType,
            realizationCandidateIds: candidates.map(
              (candidate) => candidate.realizationId,
            ),
            forcedConstraint: "AT_LEAST_ONE_REALIZATION_FOR_UNIT_CONTRACT",
            searchMethod: "DETERMINISTIC_EXACT_LEXICOGRAPHIC_MILP",
            exploredStates: result?.explored ?? 0,
            prunedStates: result?.pruned ?? 0,
            searchComplete:
              status !== "SEARCH_INCOMPLETE" && result?.complete !== false,
            feasibilityStatus: status,
            selectedRealizationId: selectedRealization?.realizationId ?? null,
            selectedBundleIds: selectedIds,
            selectedChildIds,
            counterfactualRemovedBundleIds:
              input.productionPlanner.selectedBundleIds.filter(
                (bundleId) => !selectedSet.has(bundleId),
              ),
            ...costs,
            phaseAObligationsPreserved:
              status === "ALREADY_SATISFIED_BY_PRODUCTION_PLAN" ||
              status === "JOINTLY_FEASIBLE",
            hardConstraintsPassed:
              status === "ALREADY_SATISFIED_BY_PRODUCTION_PLAN" ||
              status === "JOINTLY_FEASIBLE",
            objectiveDelta,
          }),
        );
      }),
    );
  const auditedUnitIds = new Set(rows.map((row) => row.coverageUnitId)),
    jointlyFeasibleCount = rows.filter((row) =>
      ["JOINTLY_FEASIBLE", "ALREADY_SATISFIED_BY_PRODUCTION_PLAN"].includes(
        row.feasibilityStatus,
      ),
    ).length;
  return jointFeasibility145Schema.parse(
    hashed141({
      ...header145(input.policy, input.units.sourceIdentity),
      artifactType: "machine-coverage-unit-joint-feasibility-results",
      coverageUnitsHash: input.units.semanticHash,
      unitUtilityHash: input.unitUtility.semanticHash,
      realizationCandidatesHash: input.realizations.semanticHash,
      realizationDominanceHash: input.realizationDominance.semanticHash,
      baselinePlannerHash: input.baselinePlanner.semanticHash,
      rows,
      totalEligibleUnits: input.unitUtility.eligibleUnitCount,
      auditedUnits: auditedUnitIds.size,
      unauditedUnits: input.unitUtility.eligibleUnitCount - auditedUnitIds.size,
      unauditedReasons:
        input.unitUtility.eligibleUnitCount === auditedUnitIds.size
          ? []
          : ["LOW_TIER_OR_ALREADY_SUFFICIENT_TIER_3_OUTSIDE_REQUIRED_SCOPE"],
      jointlyFeasibleCount,
      infeasibleProvenCount: rows.filter(
        (row) => row.feasibilityStatus === "INFEASIBLE_PROVEN",
      ).length,
      searchIncompleteCount: rows.filter(
        (row) => row.feasibilityStatus === "SEARCH_INCOMPLETE",
      ).length,
      noRealizationSetCount: rows.filter(
        (row) => row.feasibilityStatus === "NO_REALIZATION_SET",
      ).length,
      allRequiredAuditsComplete: rows.every(
        (row) => row.feasibilityStatus !== "SEARCH_INCOMPLETE",
      ),
      individuallyFeasibleUnselectedHighTierChildCount:
        input.individuallyFeasibleUnselectedHighTierChildCount,
      individuallyFeasibleChildDiagnosticOnly: true,
    }),
  );
}
