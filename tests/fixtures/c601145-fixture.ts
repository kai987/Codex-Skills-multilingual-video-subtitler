import { fixture144 } from "./c601144-fixture.js";
import { policy145 } from "../../packages/video-subtitler/src/review/c601145-policy.js";
import { buildCoverageUnits145 } from "../../packages/video-subtitler/src/review/c601145-coverage-units.js";
import { buildUnitUtility145 } from "../../packages/video-subtitler/src/review/c601145-unit-utility.js";
import { auditSegmentation145 } from "../../packages/video-subtitler/src/review/c601145-segmentation-audit.js";
import { buildContractPolicy145 } from "../../packages/video-subtitler/src/review/c601145-review-safety-contract.js";
import { buildRealizations145 } from "../../packages/video-subtitler/src/review/c601145-unit-realizations.js";
import {
  buildSafetyTargetsV5,
  planUnitAware145,
} from "../../packages/video-subtitler/src/review/c601145-unit-aware-planner.js";
import { buildContractLedger145 } from "../../packages/video-subtitler/src/review/c601145-contract-ledger.js";

export function fixture145() {
  const base = fixture144(),
    policy = policy145(),
    units = buildCoverageUnits145({
      policy,
      hierarchy: base.hierarchy,
      obligationsHash: base.obligations.semanticHash,
      existingTargetIntervals: [],
      existingPlaybackIntervals: [],
    }),
    utility = buildUnitUtility145({
      policy,
      units,
      atomUtility: base.atoms,
    }),
    segmentation = auditSegmentation145({
      policy,
      hierarchy: base.hierarchy,
      atoms: base.atoms,
      children: base.children,
      bundles: base.bundleUtility,
      planner: base.planner,
      units,
    }),
    contractPolicy = buildContractPolicy145({
      policy,
      sourceIdentity: base.hierarchy.sourceIdentity,
    }),
    realizationBuild = buildRealizations145({
      policy,
      units,
      contractPolicy,
      bundles: base.bundles,
      bundleDominance: base.dominance,
    }),
    planned = planUnitAware145({
      policy,
      obligations: base.obligations,
      hierarchy: base.hierarchy,
      bundles: base.bundles,
      dominance: base.dominance,
      units,
      unitUtility: utility,
      realizations: realizationBuild.realizations,
      realizationDominance: realizationBuild.dominance,
      oldPlanner: base.legacy,
    }),
    ledger = buildContractLedger145({
      policy,
      units,
      unitUtility: utility,
      realizations: realizationBuild.realizations,
      realizationDominance: realizationBuild.dominance,
      planner: planned.certificate,
      contractPolicyHash: contractPolicy.semanticHash,
    }),
    safety = buildSafetyTargetsV5({
      policy,
      units,
      unitUtility: utility,
      realizations: realizationBuild.realizations,
      planner: planned.certificate,
      selected: planned.selected,
      contractLedgerHash: ledger.semanticHash,
      sourceSafetyTargetsHash: base.safety.semanticHash,
    });
  return {
    ...base,
    policy145: policy,
    units145: units,
    unitUtility145: utility,
    segmentation145: segmentation,
    contractPolicy145: contractPolicy,
    realizations145: realizationBuild.realizations,
    realizationDominance145: realizationBuild.dominance,
    planner145: planned.certificate,
    selected145: planned.selected,
    ledger145: ledger,
    safety145: safety,
  };
}
