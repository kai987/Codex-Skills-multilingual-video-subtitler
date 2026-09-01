import { parseArgs } from "node:util";
import { loadInputs144 } from "./lib/c601144-input.js";
import { buildMachine144 } from "./lib/c601144-machine.js";
import { required141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
import { policy144 } from "../packages/video-subtitler/src/review/c601144-policy.js";
import {
  buildAtomUtility144,
  buildBundleUtility144,
  buildChildUtility144,
  buildPropagationLedger144,
} from "../packages/video-subtitler/src/review/c601144-utility.js";

const { values } = parseArgs({
  strict: true,
  options: {
    "previous-state": { type: "string" },
    "utilities-only": { type: "boolean", default: false },
  },
});
const input = await loadInputs144(
  required141(values["previous-state"], "--previous-state required"),
);
if (values["utilities-only"]) {
  const policy = policy144(),
    atoms = buildAtomUtility144({
      policy,
      hierarchy: input.hierarchy,
      lexicalArtifactHash: input.baseline.lexical.semanticHash,
      textCandidates: input.textCandidates,
    }),
    children = buildChildUtility144({
      policy,
      hierarchy: input.hierarchy,
      atoms,
    }),
    bundles = buildBundleUtility144({
      policy,
      hierarchy: input.hierarchy,
      bundles: input.bundles,
      children,
    }),
    propagation = buildPropagationLedger144({
      policy,
      hierarchy: input.hierarchy,
      atoms,
      children,
      bundles,
    }),
    geometry = new Map(
      input.hierarchy.children.map((child) => [child.childUnitId, child]),
    ),
    optional = children.rows.filter(
      (row) =>
        row.utilityEligibility &&
        !required141(geometry.get(row.childUnitId)).obligationIds.length,
    );
  console.log(
    JSON.stringify(
      {
        atoms: {
          rows: atoms.rowCount,
          positive: atoms.positiveEvidenceAtomCount,
          nonzero: atoms.nonzeroSpeechUtilityCount,
          tiers: atoms.tierCounts,
        },
        children: {
          rows: children.rowCount,
          eligible: children.eligibleChildCount,
          nonzero: children.nonzeroEligibleChildUtilityCount,
          optional: optional.length,
          optionalTierCounts: Object.groupBy(
            optional,
            (row) => row.highestSpeechEvidenceTier,
          ),
        },
        bundles: {
          rows: bundles.rowCount,
          eligible: bundles.eligibleBundleCount,
          nonzero: bundles.nonzeroEligibleBundleUtilityCount,
        },
        propagation: {
          rows: propagation.entries.length,
          evidenceToAtomDrops: propagation.droppedBetweenEvidenceAndAtom,
          atomToChildDrops: propagation.droppedBetweenAtomAndChild,
          childToBundleDrops: propagation.droppedBetweenChildAndBundle,
        },
      },
      (_key: string, value: unknown) =>
        Array.isArray(value) ? value.length : value,
      2,
    ),
  );
  process.exit(0);
}
const machine = buildMachine144(input);
console.log(
  JSON.stringify(
    {
      pathology: {
        candidateCount: machine.pathology.candidateCount,
        candidatePriorityNonzeroCount:
          machine.pathology.candidatePriorityNonzeroCount,
        positiveSpeechCandidateCount:
          machine.pathology.positiveSpeechCandidateCount,
        atomCount: machine.pathology.atomCount,
        positiveEvidenceAtomCount: machine.pathology.positiveEvidenceAtomCount,
        atomMachinePriorityNonzeroCount:
          machine.pathology.atomMachinePriorityNonzeroCount,
        childCount: machine.pathology.childCount,
        eligibleChildCount: machine.pathology.eligibleChildCount,
        eligibleChildMachinePriorityNonzeroCount:
          machine.pathology.eligibleChildMachinePriorityNonzeroCount,
        bundleCount: machine.pathology.bundleCount,
        eligibleBundleCount: machine.pathology.eligibleBundleCount,
        eligibleBundleMachinePriorityNonzeroCount:
          machine.pathology.eligibleBundleMachinePriorityNonzeroCount,
        selectedBundleMachinePrioritySum:
          machine.pathology.selectedBundleMachinePrioritySum,
        roots: machine.pathology.rootCauseClassifications,
      },
      atom: {
        rows: machine.atoms.rowCount,
        positive: machine.atoms.positiveEvidenceAtomCount,
        nonzero: machine.atoms.nonzeroSpeechUtilityCount,
        zero: machine.atoms.positiveEvidenceZeroUtilityCount,
        tiers: machine.atoms.tierCounts,
      },
      child: {
        rows: machine.children.rowCount,
        eligible: machine.children.eligibleChildCount,
        nonzero: machine.children.nonzeroEligibleChildUtilityCount,
        zero: machine.children.eligibleChildZeroUtilityCount,
      },
      bundle: {
        rows: machine.bundles.rowCount,
        eligible: machine.bundles.eligibleBundleCount,
        nonzero: machine.bundles.nonzeroEligibleBundleUtilityCount,
        zero: machine.bundles.eligibleOptionalBundleZeroUtilityCount,
      },
      planner: {
        selectedBundles: machine.planner.activeBundleCount,
        selectedChildren: machine.planner.selectedChildIds.length,
        selectedOptional: machine.planner.selectedOptionalChildIds.length,
        oldObjective: machine.planner.oldPlanObjectiveVector,
        objective: machine.planner.finalObjectiveVector,
        explored: machine.planner.exploredStateCount,
        pruned: machine.planner.prunedStateCount,
        complete: machine.planner.searchComplete,
        coreSeconds: machine.planner.coreUnionSeconds,
        audioSeconds: machine.planner.predictedFullQueueSeconds,
        episodeRatio: machine.planner.predictedFullQueueEpisodeRatio,
        tiers: machine.planner.selectedTierCounts,
      },
      forced: {
        evaluated: machine.forced.evaluatedCount,
        feasible: machine.forced.feasibleCount,
        infeasible: machine.forced.infeasibleCount,
        incomplete: machine.forced.searchIncompleteCount,
      },
      optional: {
        count: machine.optional.optionalChildCount,
        highTier: machine.optional.highTierOptionalChildCount,
        selected: machine.optional.selectedOptionalChildCount,
        remainingHighUtility:
          machine.optional.remainingHighUtilityUnselectedCount,
      },
      planChanges: {
        retainedBundles: machine.comparison.retainedBundleIds.length,
        removedBundles: machine.comparison.removedBundleIds.length,
        addedBundles: machine.comparison.addedBundleIds.length,
        retainedChildren: machine.comparison.retainedChildIds.length,
        removedChildren: machine.comparison.removedChildIds.length,
        addedChildren: machine.comparison.addedChildIds.length,
      },
      safety: {
        count: machine.safety.activeTargetCount,
        coreSeconds: machine.safety.speechCoreUnionSeconds,
      },
    },
    null,
    2,
  ),
);
