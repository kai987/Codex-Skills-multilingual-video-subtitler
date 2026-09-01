import { buildContractLedger145 } from "../../packages/video-subtitler/src/review/c601145-contract-ledger.js";
import { buildCoverageUnits145 } from "../../packages/video-subtitler/src/review/c601145-coverage-units.js";
import { runJointFeasibility145 } from "../../packages/video-subtitler/src/review/c601145-joint-feasibility.js";
import { policy145 } from "../../packages/video-subtitler/src/review/c601145-policy.js";
import { buildContractPolicy145 } from "../../packages/video-subtitler/src/review/c601145-review-safety-contract.js";
import { auditSegmentation145 } from "../../packages/video-subtitler/src/review/c601145-segmentation-audit.js";
import {
  buildSafetyTargetsV5,
  planUnitAware145,
} from "../../packages/video-subtitler/src/review/c601145-unit-aware-planner.js";
import { buildRealizations145 } from "../../packages/video-subtitler/src/review/c601145-unit-realizations.js";
import { buildUnitUtility145 } from "../../packages/video-subtitler/src/review/c601145-unit-utility.js";
import type { Inputs145 } from "./c601145-input.js";

export function buildMachine145(input: Inputs145) {
  const policy = policy145(),
    units = buildCoverageUnits145({
      policy,
      hierarchy: input.hierarchy,
      obligationsHash: input.obligations.semanticHash,
      existingTargetIntervals: input.existingTargetIntervals,
      existingPlaybackIntervals: input.existingPlaybackIntervals,
    }),
    unitUtility = buildUnitUtility145({
      policy,
      units,
      atomUtility: input.atomUtility,
    }),
    segmentation = auditSegmentation145({
      policy,
      hierarchy: input.hierarchy,
      atoms: input.atomUtility,
      children: input.childUtility,
      bundles: input.bundleUtility,
      planner: input.utilityPlanner,
      units,
    }),
    contractPolicy = buildContractPolicy145({
      policy,
      sourceIdentity: input.hierarchy.sourceIdentity,
    }),
    realizationBuild = buildRealizations145({
      policy,
      units,
      contractPolicy,
      bundles: input.bundles,
      bundleDominance: input.dominance,
    }),
    planned = planUnitAware145({
      policy,
      obligations: input.obligations,
      hierarchy: input.hierarchy,
      bundles: input.bundles,
      dominance: input.dominance,
      units,
      unitUtility,
      realizations: realizationBuild.realizations,
      realizationDominance: realizationBuild.dominance,
      oldPlanner: input.planner,
    }),
    individuallyFeasibleUnselectedHighTierChildCount =
      input.optionalChildLedger144.entries.filter(
        (row) =>
          !row.utilityPlannerSelected &&
          row.forcedInclusionFeasibility === "FEASIBLE" &&
          [
            "TIER_5_VERIFIED_MULTI_FAMILY_SPEECH",
            "TIER_4_VERIFIED_INDEPENDENT_EXCLUSIVE_SPEECH",
          ].includes(row.utilityTier),
      ).length,
    jointFeasibility = runJointFeasibility145({
      policy,
      obligations: input.obligations,
      hierarchy: input.hierarchy,
      bundles: input.bundles,
      dominance: input.dominance,
      units,
      unitUtility,
      realizations: realizationBuild.realizations,
      realizationDominance: realizationBuild.dominance,
      baselinePlanner: input.planner,
      productionPlanner: planned.certificate,
      individuallyFeasibleUnselectedHighTierChildCount,
    }),
    contractLedger = buildContractLedger145({
      policy,
      units,
      unitUtility,
      realizations: realizationBuild.realizations,
      realizationDominance: realizationBuild.dominance,
      planner: planned.certificate,
      contractPolicyHash: contractPolicy.semanticHash,
    }),
    safety = buildSafetyTargetsV5({
      policy,
      units,
      unitUtility,
      realizations: realizationBuild.realizations,
      planner: planned.certificate,
      selected: planned.selected,
      contractLedgerHash: contractLedger.semanticHash,
      sourceSafetyTargetsHash: input.safetyV4.semanticHash,
    });
  return {
    policy,
    segmentation,
    units,
    unitUtility,
    contractPolicy,
    realizations: realizationBuild.realizations,
    realizationDominance: realizationBuild.dominance,
    planner: planned.certificate,
    selected: planned.selected,
    jointFeasibility,
    contractLedger,
    safety,
  };
}

export type Machine145 = ReturnType<typeof buildMachine145>;
