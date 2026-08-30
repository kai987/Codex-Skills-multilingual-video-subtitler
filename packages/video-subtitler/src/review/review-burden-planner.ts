import {
  c60113ReviewBurdenPlansSchema,
  type C60113BurdenPlan,
  type C60113Interval,
  type C60113RegionPriorityEntry,
  type C60113RegionReviewPriority,
  type C60113ReviewBurdenPlans,
  type C60113ReviewPolicy,
} from "@mvl/shared";

import {
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";
import { C60113_MANDATORY_ORDER } from "./region-review-priority.js";
import {
  c60113IncrementalAudioSeconds,
  c60113UniqueAudioSeconds,
} from "./review-playback-timeline.js";

export function c60113MarginalRegionUtility(input: {
  region: C60113RegionPriorityEntry;
  selectedRegions: readonly C60113RegionPriorityEntry[];
  policy: C60113ReviewPolicy;
  rankingScore?: number;
}) {
  const coveredRisk = new Set(
    input.selectedRegions.flatMap((region) => region.riskCoverageKeys),
  );
  const coveredActionable = new Set(
    input.selectedRegions.flatMap((region) => region.actionableCoverageKeys),
  );
  const coveredMandatory = new Set(
    input.selectedRegions.flatMap((region) => region.mandatoryReasons),
  );
  const newRiskCoverageCount = input.region.riskCoverageKeys.filter(
    (key) => !coveredRisk.has(key),
  ).length;
  const newActionableCoverageCount = input.region.actionableCoverageKeys.filter(
    (key) => !coveredActionable.has(key),
  ).length;
  const newMandatoryCoverageCount = input.region.mandatoryReasons.filter(
    (key) => !coveredMandatory.has(key),
  ).length;
  const interval = input.region.contextInterval;
  const incrementalPlaybackSeconds = c60113IncrementalAudioSeconds(
    interval,
    input.selectedRegions.map((region) => region.contextInterval),
  );
  const weights = input.policy.marginalUtility;
  if (
    input.rankingScore !== undefined &&
    (!Number.isFinite(input.rankingScore) || input.rankingScore < 0)
  )
    throw new Error("C60113_INVALID_MACHINE_RANKING_SCORE");
  const riskStrength =
    input.rankingScore ??
    input.region.priorityVector.positiveEvidenceStrength *
      input.region.priorityVector.errorTypeSeverity;
  const redundancyPenalty =
    weights.redundancyPenaltyWeight *
    (input.region.riskCoverageKeys.length - newRiskCoverageCount);
  const marginalUtility = Math.max(
    0,
    newRiskCoverageCount * weights.riskWeight * riskStrength +
      newActionableCoverageCount * weights.actionableWeight +
      newMandatoryCoverageCount * weights.mandatoryWeight -
      redundancyPenalty,
  );
  return {
    incrementalPlaybackSeconds,
    marginalUtility,
    utilityPerCost:
      marginalUtility /
      (weights.fixedReviewOverheadSeconds +
        Math.max(weights.minimumAudioCostSeconds, incrementalPlaybackSeconds)),
    newRiskCoverageCount,
    newActionableCoverageCount,
    newMandatoryCoverageCount,
    redundancyPenalty,
    fixedReviewOverheadSeconds: weights.fixedReviewOverheadSeconds,
  };
}

export function selectC60113Regions(input: {
  regions: readonly C60113RegionPriorityEntry[];
  policy: C60113ReviewPolicy;
  budgetSeconds?: number | null;
  mandatoryOnly?: boolean;
  rankingScoreByRegion?: Readonly<Record<string, number>>;
  staticOrder?: readonly string[];
}): {
  regions: C60113RegionPriorityEntry[];
  selectionSteps: C60113BurdenPlan["selectionSteps"];
  uniqueUnionSeconds: number;
} {
  if (
    input.budgetSeconds !== undefined &&
    input.budgetSeconds !== null &&
    (!Number.isFinite(input.budgetSeconds) || input.budgetSeconds < 0)
  )
    throw new Error("C60113_INVALID_AUDIO_BUDGET");
  const seen = new Set<string>();
  for (const region of input.regions) {
    if (seen.has(region.regionId))
      throw new Error(`C60113_DUPLICATE_REGION:${region.regionId}`);
    seen.add(region.regionId);
    if (
      input.rankingScoreByRegion !== undefined &&
      input.rankingScoreByRegion[region.regionId] === undefined
    )
      throw new Error(`C60113_MISSING_REGION_SCORE:${region.regionId}`);
  }
  if (
    input.staticOrder !== undefined &&
    (new Set(input.staticOrder).size !== input.regions.length ||
      input.staticOrder.length !== input.regions.length ||
      input.staticOrder.some((id) => !seen.has(id)))
  )
    throw new Error("C60113_INVALID_STATIC_REGION_ORDER");
  const remaining = input.regions.filter(
    (region) => !input.mandatoryOnly || region.mandatoryReasons.length > 0,
  );
  const selected: C60113RegionPriorityEntry[] = [];
  const selectionSteps: C60113BurdenPlan["selectionSteps"] = [];
  let total = 0;
  while (remaining.length > 0) {
    const eligible = remaining
      .map((region) => ({
        region,
        value: c60113MarginalRegionUtility({
          region,
          selectedRegions: selected,
          policy: input.policy,
          ...(input.rankingScoreByRegion?.[region.regionId] === undefined
            ? {}
            : { rankingScore: input.rankingScoreByRegion[region.regionId] }),
        }),
      }))
      .filter(
        (entry) =>
          input.budgetSeconds === undefined ||
          input.budgetSeconds === null ||
          total + entry.value.incrementalPlaybackSeconds <=
            input.budgetSeconds + 1e-9,
      );
    eligible.sort((a, b) => {
      if (input.staticOrder !== undefined)
        return (
          input.staticOrder.indexOf(a.region.regionId) -
          input.staticOrder.indexOf(b.region.regionId)
        );
      return (
        C60113_MANDATORY_ORDER[b.region.priorityVector.mandatorySafetyClass] -
          C60113_MANDATORY_ORDER[
            a.region.priorityVector.mandatorySafetyClass
          ] ||
        b.value.utilityPerCost - a.value.utilityPerCost ||
        b.value.marginalUtility - a.value.marginalUtility ||
        a.region.sourceInterval.start - b.region.sourceInterval.start ||
        a.region.regionId.localeCompare(b.region.regionId)
      );
    });
    const next = eligible[0];
    if (next === undefined) break;
    selected.push(next.region);
    total = c60113UniqueAudioSeconds(
      selected.map((region) => region.contextInterval),
    );
    selectionSteps.push({
      rankPosition: selected.length,
      regionId: next.region.regionId,
      ...next.value,
      cumulativeUniqueAudioSeconds: total,
    });
    const index = remaining.findIndex(
      (region) => region.regionId === next.region.regionId,
    );
    remaining.splice(index, 1);
  }
  return { regions: selected, selectionSteps, uniqueUnionSeconds: total };
}

export function buildC60113BurdenPlans(input: {
  regionPriority: C60113RegionReviewPriority;
  sourceDurationSeconds: number;
  policy: C60113ReviewPolicy;
  staticOrder?: readonly string[];
}): C60113ReviewBurdenPlans {
  const definitions: {
    planId: string;
    budgetSeconds: number | null;
    budgetKind: C60113BurdenPlan["budgetKind"];
    mandatoryOnly?: boolean;
  }[] = [
    ...input.policy.percentBudgets.map((percent) => ({
      planId: `UNIQUE_AUDIO_${percent}_PERCENT`,
      budgetSeconds: (input.sourceDurationSeconds * percent) / 100,
      budgetKind: "EPISODE_UNIQUE_AUDIO_PERCENT" as const,
    })),
    ...input.policy.fixedSecondsBudgets.map((seconds) => ({
      planId: `UNIQUE_AUDIO_${seconds}_SECONDS`,
      budgetSeconds: seconds,
      budgetKind: "FIXED_SECONDS" as const,
    })),
    {
      planId: "ALL_MANDATORY",
      budgetSeconds: null,
      budgetKind: "ALL_MANDATORY",
      mandatoryOnly: true,
    },
    { planId: "FULL_QUEUE", budgetSeconds: null, budgetKind: "FULL_QUEUE" },
  ];
  const plans = definitions.map((definition): C60113BurdenPlan => {
    const selection = selectC60113Regions({
      regions: input.regionPriority.regions,
      policy: input.policy,
      budgetSeconds: definition.budgetSeconds,
      mandatoryOnly: definition.mandatoryOnly ?? false,
      ...(input.staticOrder === undefined
        ? {}
        : { staticOrder: input.staticOrder }),
    });
    const selectedIds = new Set(
      selection.regions.map((region) => region.regionId),
    );
    const intervals: C60113Interval[] = selection.regions.map(
      (region) => region.contextInterval,
    );
    const clipSumSeconds = intervals.reduce(
      (sum, interval) => sum + interval.end - interval.start,
      0,
    );
    return withC60113SemanticHash({
      planId: definition.planId,
      budgetSeconds: definition.budgetSeconds,
      budgetKind: definition.budgetKind,
      regionIds: selection.regions.map((region) => region.regionId),
      itemIds: uniqueC60113(
        selection.regions.flatMap((region) => region.itemIds),
      ),
      selectionSteps: selection.selectionSteps,
      clipSumSeconds,
      uniqueUnionSeconds: selection.uniqueUnionSeconds,
      duplicateContextSeconds: Math.max(
        0,
        clipSumSeconds - selection.uniqueUnionSeconds,
      ),
      mandatoryRegionCount: selection.regions.filter(
        (region) => region.mandatoryReasons.length > 0,
      ).length,
      unselectedMandatoryRegionIds: input.regionPriority.regions
        .filter(
          (region) =>
            region.mandatoryReasons.length > 0 &&
            !selectedIds.has(region.regionId),
        )
        .map((region) => region.regionId)
        .toSorted(),
    });
  });
  return c60113ReviewBurdenPlansSchema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-review-burden-plans",
      regionPriorityHash: input.regionPriority.semanticHash,
      sourceDurationSeconds: input.sourceDurationSeconds,
      selectionPolicy: "RECOMPUTED_MARGINAL_MACHINE_RISK_PER_UNIQUE_AUDIO_COST",
      plans,
    }),
  );
}
