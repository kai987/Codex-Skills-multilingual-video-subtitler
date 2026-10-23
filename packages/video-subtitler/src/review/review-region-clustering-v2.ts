import {
  c60113ReviewRegionsV2Schema,
  type C60113ReviewItemV3,
  type C60113ReviewPolicy,
  type C60113ReviewRegionV2,
  type C60113ReviewRegionsV2,
} from "@mvl/shared";

import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  c60113ArtifactHeader,
  uniqueC60113,
  withC60113SemanticHash,
} from "./c60113-policy.js";
import {
  c60113IncrementalAudioSeconds,
  c60113IntervalOverlap,
  c60113UniqueAudioSeconds,
} from "./review-playback-timeline.js";
import type { C60112ReviewRegion } from "./review-region-clustering.js";

function categories(item: C60113ReviewItemV3): string[] {
  return uniqueC60113(
    item.itemTypes.map((type) => {
      if (type.startsWith("TEXT_")) return "TEXT";
      if (type.startsWith("TIMING_")) return "TIMING";
      if (type === "MISSING_SPEECH_RISK") return "MISSING";
      if (type.includes("OVERLAP") || type.includes("SPEAKER"))
        return "OVERLAP";
      if (type.includes("LOCALIZATION") || type.includes("LINEAGE"))
        return "LOCALIZATION";
      return "GENERAL";
    }),
  );
}

function shares(left: readonly string[], right: readonly string[]): boolean {
  const known = new Set(left);
  return right.some((entry) => known.has(entry));
}

function contextFor(
  items: readonly C60113ReviewItemV3[],
  policy: C60113ReviewPolicy,
  duration: number,
) {
  return {
    start: Math.max(
      0,
      Math.min(...items.map((item) => item.coreInterval.start)) -
        policy.regionMerge.preContextSeconds,
    ),
    end: Math.min(
      duration,
      Math.max(...items.map((item) => item.coreInterval.end)) +
        policy.regionMerge.postContextSeconds,
    ),
  };
}

function mergeReason(
  group: readonly C60113ReviewItemV3[],
  item: C60113ReviewItemV3,
  policy: C60113ReviewPolicy,
  duration: number,
): string | null {
  const sceneIds = uniqueC60113(group.flatMap((member) => member.sceneIds));
  const speakerIds = uniqueC60113(
    group.flatMap((member) => member.speakerGroupIds),
  );
  if (
    sceneIds.length > 0 &&
    item.sceneIds.length > 0 &&
    !shares(sceneIds, item.sceneIds)
  )
    return null;
  if (
    speakerIds.length > 0 &&
    item.speakerGroupIds.length > 0 &&
    !shares(speakerIds, item.speakerGroupIds)
  )
    return null;
  if (
    !shares(group.flatMap(categories), categories(item)) &&
    !shares(
      group.flatMap((member) => member.eventIds),
      item.eventIds,
    ) &&
    !shares(
      group.flatMap((member) => member.finalCueIds),
      item.finalCueIds,
    )
  )
    return null;
  const start = Math.min(
    ...group.map((member) => member.coreInterval.start),
    item.coreInterval.start,
  );
  const end = Math.max(
    ...group.map((member) => member.coreInterval.end),
    item.coreInterval.end,
  );
  if (end - start > policy.regionMerge.maximumCoreSeconds) return null;
  const oldContext = contextFor(group, policy, duration);
  const newContext = contextFor([item], policy, duration);
  const overlapRatio =
    c60113IntervalOverlap(oldContext, newContext) /
    Math.min(
      oldContext.end - oldContext.start,
      newContext.end - newContext.start,
    );
  const gap =
    item.coreInterval.start -
    Math.max(...group.map((member) => member.coreInterval.end));
  const incremental = c60113IncrementalAudioSeconds(newContext, [oldContext]);
  if (incremental > policy.regionMerge.maximumIncrementalSeconds) return null;
  if (gap <= policy.regionMerge.maximumGapSeconds)
    return "CATEGORY_SCENE_SPEAKER_COMPATIBLE_CONTINUOUS_CORE";
  return overlapRatio >= policy.regionMerge.minimumContextOverlapRatio
    ? "OVERLAPPING_CONTEXT_LOW_INCREMENTAL_PLAYBACK_COST"
    : null;
}

function finalizeRegion(
  items: C60113ReviewItemV3[],
  input: {
    policy: C60113ReviewPolicy;
    sourceDurationSeconds: number;
    mergeReasons: string[];
    legacyRegion?: C60112ReviewRegion;
  },
): C60113ReviewRegionV2 {
  const itemIds = items.map((item) => item.reviewItemId).toSorted();
  const contextInterval =
    input.legacyRegion === undefined
      ? contextFor(items, input.policy, input.sourceDurationSeconds)
      : {
          start: input.legacyRegion.contextStart,
          end: input.legacyRegion.contextEnd,
        };
  const mandatoryReasons = uniqueC60113(
    items.flatMap((item) => item.mandatoryReasons),
  );
  const max = items.toSorted(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      a.reviewItemId.localeCompare(b.reviewItemId),
  )[0];
  if (max === undefined) throw new Error("C60113_EMPTY_REGION");
  return withC60113SemanticHash({
    regionId:
      input.legacyRegion?.regionId ??
      `review-region-v2-${machineQualitySemanticHash(itemIds).slice(0, 20)}`,
    reviewItemIds: itemIds,
    eventIds: uniqueC60113(items.flatMap((item) => item.eventIds)),
    finalCueIds: uniqueC60113(items.flatMap((item) => item.finalCueIds)),
    sourceInterval: {
      start: Math.min(...items.map((item) => item.coreInterval.start)),
      end: Math.max(...items.map((item) => item.coreInterval.end)),
    },
    contextInterval,
    contextStart: contextInterval.start,
    contextEnd: contextInterval.end,
    coreIntervals: items.map((item) => ({
      reviewItemId: item.reviewItemId,
      ...item.coreInterval,
    })),
    maxPriority: { tier: max.priorityTier, score: max.priorityScore },
    aggregateReasons: [
      ...new Set(items.flatMap((item) => item.reviewReasons)),
    ].toSorted(),
    itemTypes: [...new Set(items.flatMap((item) => item.itemTypes))].toSorted(),
    requiredLevel:
      mandatoryReasons.length > 0
        ? ("REQUIRED" as const)
        : items.some((item) => item.requiredLevel === "RECOMMENDED")
          ? ("RECOMMENDED" as const)
          : ("INFORMATIONAL" as const),
    mandatoryReasons,
    independentEvidenceFamilies: [
      ...new Set(items.flatMap((item) => item.independentEvidenceFamilies)),
    ].toSorted(),
    sceneIds: uniqueC60113(items.flatMap((item) => item.sceneIds)),
    speakerGroupIds: uniqueC60113(
      items.flatMap((item) => item.speakerGroupIds),
    ),
    mergeReasons: uniqueC60113(input.mergeReasons),
  });
}

export function clusterC60113ReviewRegions(input: {
  items: readonly C60113ReviewItemV3[];
  itemsHash: string;
  policy: C60113ReviewPolicy;
  sourceDurationSeconds: number;
  legacyRegions?: readonly C60112ReviewRegion[];
}): C60113ReviewRegionsV2 {
  if (
    !Number.isFinite(input.sourceDurationSeconds) ||
    input.sourceDurationSeconds <= 0
  )
    throw new Error("C60113_SOURCE_DURATION_REQUIRED");
  for (const item of input.items) {
    if (
      item.coreInterval.end > input.sourceDurationSeconds ||
      item.sourceInterval.end > input.sourceDurationSeconds
    )
      throw new Error(`C60113_ITEM_OUTSIDE_SOURCE:${item.reviewItemId}`);
  }
  let regions: C60113ReviewRegionV2[];
  if (input.legacyRegions !== undefined) {
    const byId = new Map(input.items.map((item) => [item.reviewItemId, item]));
    const seen = new Set<string>();
    regions = input.legacyRegions.map((legacyRegion) => {
      const members = legacyRegion.reviewItemIds.map((id) => {
        const item = byId.get(id);
        if (item === undefined || seen.has(id))
          throw new Error(`C60113_LEGACY_REGION_MEMBERSHIP_INVALID:${id}`);
        seen.add(id);
        return item;
      });
      return finalizeRegion(members, {
        ...input,
        legacyRegion,
        mergeReasons: ["LEGACY_REGION_PARTITION_RETAINED_FOR_ABLATION"],
      });
    });
    if (seen.size !== input.items.length)
      throw new Error("C60113_LEGACY_REGION_MISSING_ITEM");
  } else {
    const groups: { items: C60113ReviewItemV3[]; reasons: string[] }[] = [];
    for (const item of [...input.items].toSorted(
      (a, b) =>
        a.coreInterval.start - b.coreInterval.start ||
        a.reviewItemId.localeCompare(b.reviewItemId),
    )) {
      const last = groups.at(-1);
      const reason =
        last === undefined
          ? null
          : mergeReason(
              last.items,
              item,
              input.policy,
              input.sourceDurationSeconds,
            );
      if (last !== undefined && reason !== null) {
        last.items.push(item);
        last.reasons.push(reason);
      } else
        groups.push({
          items: [item],
          reasons: ["LOCAL_CORE_WITH_BOUNDED_CONTEXT"],
        });
    }
    regions = groups.map((group) =>
      finalizeRegion(group.items, { ...input, mergeReasons: group.reasons }),
    );
  }
  const intervals = regions.map((region) => region.contextInterval);
  const clipSumSeconds = intervals.reduce(
    (sum, value) => sum + value.end - value.start,
    0,
  );
  const uniqueUnionSeconds = c60113UniqueAudioSeconds(intervals);
  return c60113ReviewRegionsV2Schema.parse(
    withC60113SemanticHash({
      ...c60113ArtifactHeader(input.policy),
      artifactType: "c6-0-1-13-machine-review-regions-v2",
      itemsHash: input.itemsHash,
      sourceDurationSeconds: input.sourceDurationSeconds,
      regions,
      summary: {
        itemCount: input.items.length,
        regionCount: regions.length,
        requiredRegionCount: regions.filter(
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
}
