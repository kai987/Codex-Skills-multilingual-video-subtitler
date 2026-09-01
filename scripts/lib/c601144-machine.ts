import {
  buildAtomUtility144,
  buildBundleUtility144,
  buildChildUtility144,
  buildPropagationLedger144,
  auditLegacyPriority144,
} from "../../packages/video-subtitler/src/review/c601144-utility.js";
import { policy144 } from "../../packages/video-subtitler/src/review/c601144-policy.js";
import {
  bindOptionalLedger144,
  buildOptionalLedger144,
  buildPlanComparison144,
  buildSafetyTargetsV4,
  planUtilityAware144,
  runForcedInclusion144,
} from "../../packages/video-subtitler/src/review/c601144-planner.js";
import type { Inputs144 } from "./c601144-input.js";

export function buildMachine144(input: Inputs144) {
  const policy = policy144();
  const pathology = auditLegacyPriority144({
    policy,
    candidates: input.baseline.uncovered.candidates,
    hierarchy: input.hierarchy,
    bundles: input.bundles,
    planner: input.planner,
  });
  const atoms = buildAtomUtility144({
    policy,
    hierarchy: input.hierarchy,
    lexicalArtifactHash: input.baseline.lexical.semanticHash,
    textCandidates: input.textCandidates,
  });
  const children = buildChildUtility144({
    policy,
    hierarchy: input.hierarchy,
    atoms,
  });
  const bundles = buildBundleUtility144({
    policy,
    hierarchy: input.hierarchy,
    bundles: input.bundles,
    children,
  });
  const planned = planUtilityAware144({
    policy,
    legacyPolicy: input.previousPolicy,
    obligations: input.obligations,
    hierarchy: input.hierarchy,
    bundles: input.bundles,
    dominance: input.dominance,
    childUtility: children,
    bundleUtility: bundles,
    legacyPlanner: input.planner,
  });
  const forced = runForcedInclusion144({
    policy,
    obligations: input.obligations,
    hierarchy: input.hierarchy,
    bundles: input.bundles,
    dominance: input.dominance,
    childUtility: children,
    bundleUtility: bundles,
    baselinePlanner: input.planner,
    productionPlanner: planned.certificate,
  });
  const optional = buildOptionalLedger144({
    policy,
    hierarchy: input.hierarchy,
    bundles: input.bundles,
    childUtility: children,
    bundleUtility: bundles,
    forced,
    baselinePlanner: input.planner,
    productionPlanner: planned.certificate,
  });
  const planner = bindOptionalLedger144(planned.certificate, optional);
  const propagation = buildPropagationLedger144({
    policy,
    hierarchy: input.hierarchy,
    atoms,
    children,
    bundles,
    selectedBundleIds: planner.selectedBundleIds,
    plannerCertificateHash: planner.semanticHash,
  });
  const comparison = buildPlanComparison144({
    policy,
    hierarchy: input.hierarchy,
    childUtility: children,
    oldPlanner: input.planner,
    newPlanner: planner,
  });
  const atomHashes = new Map(
    atoms.rows.map((row) => [row.atomId, row.semanticHash]),
  );
  const safety = buildSafetyTargetsV4({
    policy,
    hierarchy: input.hierarchy,
    atomUtilityHashesById: atomHashes,
    childUtility: children,
    bundleUtility: bundles,
    planner,
    selected: planned.selected,
    oldTargetIds: input.planner.selectedBundleIds,
  });
  return {
    policy,
    pathology,
    atoms,
    children,
    bundles,
    propagation,
    forced,
    optional,
    planner,
    comparison,
    safety,
    selected: planned.selected,
  };
}

export type Machine144 = ReturnType<typeof buildMachine144>;
