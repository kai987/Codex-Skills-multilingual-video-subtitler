import { planner145Schema } from "@mvl/shared";
import { fixture144 } from "./c601144-fixture.js";
import {
  emptyUnitTierCounts145,
  policy145,
} from "../../packages/video-subtitler/src/review/c601145-policy.js";
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
import {
  hashed141,
  required141,
} from "../../packages/video-subtitler/src/review/c601141-policy.js";

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
    selectedRealizationIds = new Set(
      planned.certificate.selectedRealizationIds,
    );
  for (const bundle of planned.selected) {
    const alreadyCovered = [...selectedRealizationIds].some((id) =>
      required141(
        realizationBuild.realizations.candidates.find(
          (row) => row.realizationId === id,
        ),
      ).bundleIds.includes(bundle.bundleId),
    );
    if (alreadyCovered) continue;
    const explicitFixtureSelection = realizationBuild.realizations.candidates
      .filter(
        (row) => row.eligibility && row.bundleIds.includes(bundle.bundleId),
      )
      .sort(
        (left, right) =>
          left.targetSlotCost - right.targetSlotCost ||
          left.speechCoreCostSamples - right.speechCoreCostSamples ||
          left.predictedAudioCostSamples - right.predictedAudioCostSamples ||
          left.internalSilenceCostSamples - right.internalSilenceCostSamples ||
          left.realizationId.localeCompare(right.realizationId),
      )[0];
    selectedRealizationIds.add(
      required141(
        explicitFixtureSelection,
        "C601145_FIXTURE_SELECTED_BUNDLE_WITHOUT_ELIGIBLE_REALIZATION",
      ).realizationId,
    );
  }
  const selectedRealizations = [...selectedRealizationIds]
      .map((id) =>
        required141(
          realizationBuild.realizations.candidates.find(
            (row) => row.realizationId === id,
          ),
        ),
      )
      .sort((left, right) =>
        left.realizationId.localeCompare(right.realizationId),
      ),
    selectedCoverageUnitIds = [
      ...new Set(selectedRealizations.map((row) => row.coverageUnitId)),
    ].sort(),
    unitCoverageByTier = emptyUnitTierCounts145();
  for (const coverageUnitId of selectedCoverageUnitIds)
    unitCoverageByTier[
      required141(
        utility.rows.find((row) => row.coverageUnitId === coverageUnitId),
      ).speechTier
    ]++;
  const fixturePlanner = planner145Schema.parse(
      hashed141({
        ...planned.certificate,
        selectedRealizationIds: selectedRealizations.map(
          (row) => row.realizationId,
        ),
        selectedCoverageUnitIds,
        unitCoverageByTier,
      }),
    ),
    ledger = buildContractLedger145({
      policy,
      units,
      unitUtility: utility,
      realizations: realizationBuild.realizations,
      realizationDominance: realizationBuild.dominance,
      planner: fixturePlanner,
      contractPolicyHash: contractPolicy.semanticHash,
    }),
    safety = buildSafetyTargetsV5({
      policy,
      units,
      unitUtility: utility,
      realizations: realizationBuild.realizations,
      planner: fixturePlanner,
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
    planner145: fixturePlanner,
    selected145: planned.selected,
    ledger145: ledger,
    safety145: safety,
  };
}
