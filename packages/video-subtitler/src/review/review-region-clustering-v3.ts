import {
  c60113ReviewRegionsV2Schema,
  c60114ReviewRegionsV3Schema,
  type C60113EvidenceFamilyGraph,
  type C60113ReviewPolicy,
  type C60113ReviewRegionV2,
  type C60114Policy,
  type C60114SourceIdentity,
  type C60114ReviewTargets,
  type C60114ReviewItemsV4,
  type C60114ReviewRegionV3,
} from "@mvl/shared";
import {
  assertC60113Policy,
  buildC60113ReviewPolicy,
  c60113ArtifactHeader,
  withC60113SemanticHash,
} from "./c60113-policy.js";
import {
  c60114ArtifactHeader,
  c60114Id,
  c60114Union,
  c60114Coverage,
  assertC60114SourceIdentity,
  uniqueC60114,
  withC60114SemanticHash,
} from "./c60114-policy.js";
import {
  buildC60113RegionPriority,
  c60113RegionInitialUtility,
} from "./region-review-priority.js";
import { c60114LegacyPriorityProjection } from "./review-items-v4.js";

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error("C60114_REGION_LINEAGE_ROW_MISSING");
  return row;
}
const seconds = (intervals: readonly { start: number; end: number }[]) =>
  c60114Union(intervals).reduce((sum, row) => sum + row.end - row.start, 0);

/** Cluster verified atomic subjects. Broad item/gap envelopes never become targets. */
export function clusterC60114ReviewRegions(input: {
  targets: C60114ReviewTargets;
  items: C60114ReviewItemsV4;
  sourceIdentity: C60114SourceIdentity;
  policy: C60114Policy;
  evidenceFamilies: C60113EvidenceFamilyGraph;
  frozenR3Policy?: C60113ReviewPolicy;
}) {
  const r3Policy = input.frozenR3Policy ?? buildC60113ReviewPolicy();
  assertC60113Policy(r3Policy);
  if (input.evidenceFamilies.policyHash !== r3Policy.semanticHash)
    throw new Error("C60114_REGION_FROZEN_R3_POLICY_MISMATCH");
  assertC60114SourceIdentity(
    input.targets.sourceIdentity,
    input.sourceIdentity,
  );
  assertC60114SourceIdentity(input.items.sourceIdentity, input.sourceIdentity);
  const itemMap = new Map(
    input.items.items.map((item) => [item.reviewItemId, item]),
  );
  const groups: C60114ReviewTargets["targets"][] = [];
  for (const target of [...input.targets.targets].sort(
    (a, b) =>
      a.sourceInterval.start - b.sourceInterval.start ||
      a.sourceInterval.end - b.sourceInterval.end ||
      a.reviewTargetId.localeCompare(b.reviewTargetId),
  )) {
    assertC60114SourceIdentity(target.sourceIdentity, input.sourceIdentity);
    const item = requireRow(itemMap.get(target.parentReviewItemId));
    const group = groups.at(-1),
      first = group?.[0];
    const end = Math.max(
      ...(group?.map((row) => row.sourceInterval.end) ?? []),
    );
    const sceneIds = uniqueC60114(
      (group ?? []).flatMap(
        (row) => requireRow(itemMap.get(row.parentReviewItemId)).sceneIds,
      ),
    );
    const speakerIds = uniqueC60114(
      (group ?? []).flatMap(
        (row) =>
          requireRow(itemMap.get(row.parentReviewItemId)).speakerGroupIds,
      ),
    );
    const sceneConflict =
      sceneIds.length > 0 &&
      item.sceneIds.length > 0 &&
      !item.sceneIds.some((id) => sceneIds.includes(id));
    const speakerConflict =
      speakerIds.length > 0 &&
      item.speakerGroupIds.length > 0 &&
      !item.speakerGroupIds.some((id) => speakerIds.includes(id));
    if (
      group &&
      first &&
      !sceneConflict &&
      !speakerConflict &&
      target.sourceInterval.start - end <=
        input.policy.reviewRegion.maxTargetGapSeconds &&
      Math.max(end, target.sourceInterval.end) - first.sourceInterval.start <=
        input.policy.reviewRegion.maxRegionDurationSeconds
    )
      group.push(target);
    else groups.push([target]);
  }
  const provisional = groups.map((group) => {
    const sourceIntervals = c60114Union(
      group.map((target) => target.sourceInterval),
    );
    const first = requireRow(sourceIntervals[0]),
      last = requireRow(sourceIntervals.at(-1));
    const reviewItemIds = uniqueC60114(
      group.map((target) => target.parentReviewItemId),
    );
    const items = reviewItemIds.map((id) => requireRow(itemMap.get(id)));
    const requiredLevel = items.some(
      (item) => item.requiredLevel === "REQUIRED",
    )
      ? ("REQUIRED" as const)
      : items.some((item) => item.requiredLevel === "RECOMMENDED")
        ? ("RECOMMENDED" as const)
        : ("INFORMATIONAL" as const);
    const contextIntervals = [
      {
        start: Math.max(
          0,
          first.start - input.policy.reviewRegion.contextSeconds,
        ),
        end: Math.min(
          input.sourceIdentity.durationSeconds,
          last.end + input.policy.reviewRegion.contextSeconds,
        ),
      },
    ];
    return {
      regionId: c60114Id("review-region-v3", {
        source: input.sourceIdentity,
        targets: group.map((target) => target.reviewTargetId).sort(),
      }),
      reviewTargetIds: uniqueC60114(
        group.map((target) => target.reviewTargetId),
      ),
      reviewItemIds,
      sourceIntervals,
      contextIntervals,
      playbackIntervals: contextIntervals,
      targetCoverageChecks: group.map((target) => ({
        reviewTargetId: target.reviewTargetId,
        mandatoryForAudio: target.mandatoryForAudio,
        coverageRatio: c60114Coverage(target.sourceInterval, contextIntervals),
        fullyCovered:
          c60114Coverage(target.sourceInterval, contextIntervals) >= 1 - 1e-7,
      })),
      requiredLevel,
      sourceIdentity: input.sourceIdentity,
    };
  });
  const legacyItems = input.items.items.map(c60114LegacyPriorityProjection);
  const legacyItemMap = new Map(
    legacyItems.map((item) => [item.reviewItemId, item]),
  );
  const r3Regions: C60113ReviewRegionV2[] = provisional.map((region) => {
    const items = region.reviewItemIds.map((id) =>
      requireRow(legacyItemMap.get(id)),
    );
    const first = requireRow(region.sourceIntervals[0]),
      last = requireRow(region.sourceIntervals.at(-1));
    const context = requireRow(region.contextIntervals[0]);
    const strongest = requireRow(
      [...items].sort(
        (a, b) =>
          b.priorityScore - a.priorityScore ||
          a.reviewItemId.localeCompare(b.reviewItemId),
      )[0],
    );
    return withC60113SemanticHash({
      regionId: region.regionId,
      reviewItemIds: region.reviewItemIds,
      eventIds: uniqueC60114(items.flatMap((item) => item.eventIds)),
      finalCueIds: uniqueC60114(items.flatMap((item) => item.finalCueIds)),
      // Only the legacy ranker sees this source-time/cost envelope; coverage uses V3 arrays.
      sourceInterval: { start: first.start, end: last.end },
      contextInterval: context,
      contextStart: context.start,
      contextEnd: context.end,
      coreIntervals: input.targets.targets
        .filter((target) =>
          region.reviewTargetIds.includes(target.reviewTargetId),
        )
        .map((target) => ({
          reviewItemId: target.parentReviewItemId,
          ...target.sourceInterval,
        })),
      maxPriority: {
        tier: strongest.priorityTier,
        score: strongest.priorityScore,
      },
      aggregateReasons: [
        ...new Set(items.flatMap((item) => item.reviewReasons)),
      ].sort(),
      itemTypes: [...new Set(items.flatMap((item) => item.itemTypes))].sort(),
      requiredLevel: region.requiredLevel,
      mandatoryReasons: uniqueC60114(
        items.flatMap((item) => item.mandatoryReasons),
      ),
      independentEvidenceFamilies: [
        ...new Set(items.flatMap((item) => item.independentEvidenceFamilies)),
      ].sort(),
      sceneIds: uniqueC60114(items.flatMap((item) => item.sceneIds)),
      speakerGroupIds: uniqueC60114(
        items.flatMap((item) => item.speakerGroupIds),
      ),
      mergeReasons: [
        "C60114_ATOMIC_TARGET_REGION_PROJECTED_TO_UNCHANGED_R3_RANKER",
      ],
    });
  });
  const clipSumSeconds = r3Regions.reduce(
    (sum, region) => sum + region.contextEnd - region.contextStart,
    0,
  );
  const uniqueUnionSeconds = seconds(
    r3Regions.map((region) => region.contextInterval),
  );
  const r3Input = c60113ReviewRegionsV2Schema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(r3Policy),
      artifactType: "c6-0-1-13-machine-review-regions-v2",
      itemsHash: input.items.semanticHash,
      sourceDurationSeconds: input.sourceIdentity.durationSeconds,
      regions: r3Regions,
      summary: {
        itemCount: input.items.items.length,
        regionCount: r3Regions.length,
        requiredRegionCount: r3Regions.filter(
          (region) => region.requiredLevel === "REQUIRED",
        ).length,
        clipSumSeconds,
        uniqueUnionSeconds,
        duplicateContextSeconds: Math.max(
          0,
          clipSumSeconds - uniqueUnionSeconds,
        ),
      },
    }),
  );
  // Imported R3 owns all weighting, aggregation, cost and ordering. No local score formula.
  const r3 = buildC60113RegionPriority({
    items: legacyItems,
    regions: r3Input,
    evidenceFamilies: input.evidenceFamilies,
    policy: r3Policy,
  });
  const byId = new Map(provisional.map((region) => [region.regionId, region]));
  const finalized: C60114ReviewRegionV3[] = r3.regions.map((priority) => {
    const region = requireRow(byId.get(priority.regionId));
    const items = region.reviewItemIds.map((id) => requireRow(itemMap.get(id)));
    return withC60114SemanticHash({
      ...region,
      priorityMetadata: {
        rankerStatus: "RANKER_NOT_RECALIBRATED_IN_C6_0_1_14" as const,
        rankPosition: priority.rankPosition,
        inheritedItemScore: Math.max(
          ...items.map((item) => item.priorityScore),
        ),
        safetyClass: region.requiredLevel,
        legacyItemRank: Math.min(...items.map((item) => item.rankPosition)),
        r3PolicyHash: r3Policy.semanticHash,
        r3EvidenceFamiliesHash: input.evidenceFamilies.semanticHash,
        r3Ranker: "REGION_RISK_DENSITY_V3" as const,
        inputDerivation:
          "EXISTING_R3_EVIDENCE_GRAPH_AND_ATOMIC_TARGET_REGION_PROJECTION" as const,
        scoreMeaning: "EXPLAINABLE_RANKING_SCORE_NOT_PROBABILITY" as const,
        utility: c60113RegionInitialUtility({ ...priority, policy: r3Policy }),
        uniqueAudioCostSeconds: priority.estimatedUniqueAudioSeconds,
        reviewCostSeconds:
          r3Policy.marginalUtility.fixedReviewOverheadSeconds +
          Math.max(
            r3Policy.marginalUtility.minimumAudioCostSeconds,
            priority.estimatedUniqueAudioSeconds,
          ),
        rankScore: priority.rankScore,
        riskCoverageKeys: priority.riskCoverageKeys,
        actionableCoverageKeys: priority.actionableCoverageKeys,
        mandatoryReasons: priority.mandatoryReasons,
        priorityVector: priority.priorityVector,
      },
    });
  });
  const itemRegionCounts = input.items.items.map(
    (item) =>
      finalized.filter((region) =>
        region.reviewItemIds.includes(item.reviewItemId),
      ).length,
  );
  const mapped = new Set(finalized.flatMap((region) => region.reviewTargetIds));
  if (
    finalized.some((region) =>
      region.targetCoverageChecks.some(
        (check) => check.mandatoryForAudio && !check.fullyCovered,
      ),
    )
  )
    throw new Error("C60114_MANDATORY_TARGET_REGION_COVERAGE_FAILURE");
  return c60114ReviewRegionsV3Schema.parse(
    withC60114SemanticHash({
      ...c60114ArtifactHeader(input.policy, input.sourceIdentity),
      artifactType: "machine-review-regions-v3",
      targetsHash: input.targets.semanticHash,
      itemsHash: input.items.semanticHash,
      regions: finalized,
      summary: {
        regionCount: finalized.length,
        targetCount: input.targets.targets.length,
        mappedTargetCount: mapped.size,
        disjointItemCount: itemRegionCounts.filter((value) => value > 1).length,
        disjointRegionSplitCount: itemRegionCounts.reduce(
          (sum, value) => sum + Math.max(0, value - 1),
          0,
        ),
        requiredRegionCount: finalized.filter(
          (region) => region.requiredLevel === "REQUIRED",
        ).length,
        targetCoverageRatio: input.targets.targets.length
          ? mapped.size / input.targets.targets.length
          : 1,
      },
    }),
  );
}
