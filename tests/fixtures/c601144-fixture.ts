import type { Candidate142 } from "@mvl/shared";
import { fixture143 } from "./c601143-fixture.js";
import { source142 } from "./c601142-fixture.js";
import { planFinalSafety143 } from "../../packages/video-subtitler/src/review/c601143-final-planner.js";
import { policy144 } from "../../packages/video-subtitler/src/review/c601144-policy.js";
import {
  buildAtomUtility144,
  buildBundleUtility144,
  buildChildUtility144,
  buildPropagationLedger144,
} from "../../packages/video-subtitler/src/review/c601144-utility.js";
import {
  bindOptionalLedger144,
  buildOptionalLedger144,
  buildPlanComparison144,
  buildSafetyTargetsV4,
  planUtilityAware144,
  runForcedInclusion144,
} from "../../packages/video-subtitler/src/review/c601144-planner.js";
import { hash141 } from "../../packages/video-subtitler/src/review/c601141-policy.js";

export function fixture144(
  parts?: Candidate142[],
  mandatoryIndices?: number[],
  sourceOverride = source142,
) {
  const base = fixture143(parts, mandatoryIndices, {}, sourceOverride),
    legacy = planFinalSafety143(base),
    policy = policy144(),
    atoms = buildAtomUtility144({
      policy,
      hierarchy: base.hierarchy,
      lexicalArtifactHash: hash141([]),
      textCandidates: [],
    }),
    children = buildChildUtility144({
      policy,
      hierarchy: base.hierarchy,
      atoms,
    }),
    bundles = buildBundleUtility144({
      policy,
      hierarchy: base.hierarchy,
      bundles: base.bundles,
      children,
    }),
    planned = planUtilityAware144({
      policy,
      legacyPolicy: base.policy,
      obligations: base.obligations,
      hierarchy: base.hierarchy,
      bundles: base.bundles,
      dominance: base.dominance,
      childUtility: children,
      bundleUtility: bundles,
      legacyPlanner: legacy.certificate,
    }),
    forced = runForcedInclusion144({
      policy,
      obligations: base.obligations,
      hierarchy: base.hierarchy,
      bundles: base.bundles,
      dominance: base.dominance,
      childUtility: children,
      bundleUtility: bundles,
      baselinePlanner: legacy.certificate,
      productionPlanner: planned.certificate,
    }),
    optional = buildOptionalLedger144({
      policy,
      hierarchy: base.hierarchy,
      bundles: base.bundles,
      childUtility: children,
      bundleUtility: bundles,
      forced,
      baselinePlanner: legacy.certificate,
      productionPlanner: planned.certificate,
    }),
    planner = bindOptionalLedger144(planned.certificate, optional),
    propagation = buildPropagationLedger144({
      policy,
      hierarchy: base.hierarchy,
      atoms,
      children,
      bundles,
      selectedBundleIds: planner.selectedBundleIds,
      plannerCertificateHash: planner.semanticHash,
    }),
    comparison = buildPlanComparison144({
      policy,
      hierarchy: base.hierarchy,
      childUtility: children,
      oldPlanner: legacy.certificate,
      newPlanner: planner,
    });
  const atomHashes = new Map(
    atoms.rows.map((row) => [row.atomId, row.semanticHash]),
  );
  const safety = buildSafetyTargetsV4({
    policy,
    hierarchy: base.hierarchy,
    atomUtilityHashesById: atomHashes,
    childUtility: children,
    bundleUtility: bundles,
    planner,
    selected: planned.selected,
    oldTargetIds: legacy.certificate.selectedBundleIds,
  });
  return {
    ...base,
    utilityPolicy: policy,
    legacy: legacy.certificate,
    atoms,
    children,
    bundleUtility: bundles,
    planned,
    forced,
    optional,
    planner,
    propagation,
    comparison,
    safety,
  };
}
