import { machineQualitySemanticHash } from "../machine-quality/evidence-correlation.js";
import {
  assertC60112MachineOnlyInput,
  assertC60112ReviewPolicy,
  type C60112Interval,
  type C60112PriorityTier,
  type C60112RequiredLevel,
  type C60112ReviewItem,
  type C60112ReviewItemType,
  type C60112ReviewPolicy,
  type C60112ReviewReasonCode,
} from "./c60112-policy.js";

export interface C60112RegionCoreInterval extends C60112Interval {
  reviewItemId: string;
}

export interface C60112ReviewRegion {
  regionId: string;
  reviewItemIds: string[];
  eventIds: string[];
  finalCueIds: string[];
  contextStart: number;
  contextEnd: number;
  coreIntervals: C60112RegionCoreInterval[];
  maxPriority: {
    tier: C60112PriorityTier;
    score: number;
  };
  aggregateReasons: C60112ReviewReasonCode[];
  itemTypes: C60112ReviewItemType[];
  requiredLevel: C60112RequiredLevel;
  sceneIds: string[];
  speakerGroupIds: string[];
  semanticHash: string;
}

export interface C60112ReviewRegionsArtifact {
  schemaVersion: "1.0.0";
  policyVersion: C60112ReviewPolicy["policyVersion"];
  artifactType: "c6-0-1-12-machine-review-regions";
  policyHash: string;
  sourceTimebase: "SOURCE_GLOBAL_SECONDS";
  runtimeGoldInputCount: 0;
  regions: C60112ReviewRegion[];
  summary: {
    itemCount: number;
    regionCount: number;
    mergedItemCount: number;
    requiredRegionCount: number;
    totalContextAudioSeconds: number;
  };
  semanticHash: string;
}

type RegionFamily =
  "TEXT" | "TIMING" | "MISSING" | "OVERLAP" | "LOCALIZATION" | "GENERAL";

interface MutableRegion {
  items: C60112ReviewItem[];
  coreStart: number;
  coreEnd: number;
  sceneIds: Set<string>;
  speakerGroupIds: Set<string>;
  families: Set<RegionFamily>;
}

const PRIORITY_ORDER: Readonly<Record<C60112PriorityTier, number>> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const REQUIRED_ORDER: Readonly<Record<C60112RequiredLevel, number>> = {
  REQUIRED: 3,
  RECOMMENDED: 2,
  INFORMATIONAL: 1,
};

function itemFamilies(item: C60112ReviewItem): Set<RegionFamily> {
  const families = new Set<RegionFamily>();
  for (const type of item.itemTypes) {
    if (type.startsWith("TEXT_")) families.add("TEXT");
    else if (type.startsWith("TIMING_")) families.add("TIMING");
    else if (type === "MISSING_SPEECH_RISK") families.add("MISSING");
    else if (type === "OVERLAP_RISK" || type === "MULTI_SPEAKER_RISK") {
      families.add("OVERLAP");
    } else if (
      type === "LOCALIZATION_RISK" ||
      type === "SPAN_LINEAGE_BLOCKED"
    ) {
      families.add("LOCALIZATION");
    } else {
      families.add("GENERAL");
    }
  }
  return families;
}

function sharesAny<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return [...left].some((value) => right.has(value));
}

function itemSharesIdentity(
  region: MutableRegion,
  item: C60112ReviewItem,
): boolean {
  const eventIds = new Set(item.eventIds);
  const cueIds = new Set(item.finalCueIds);
  return region.items.some(
    (member) =>
      member.eventIds.some((id) => eventIds.has(id)) ||
      member.finalCueIds.some((id) => cueIds.has(id)),
  );
}

function categoryCompatible(
  region: MutableRegion,
  item: C60112ReviewItem,
): boolean {
  const families = itemFamilies(item);
  if (sharesAny(region.families, families)) return true;
  return itemSharesIdentity(region, item);
}

function sceneCompatible(
  region: MutableRegion,
  item: C60112ReviewItem,
): boolean {
  if (region.sceneIds.size === 0 || item.sceneIds.length === 0) return true;
  return item.sceneIds.some((sceneId) => region.sceneIds.has(sceneId));
}

function speakerCompatible(
  region: MutableRegion,
  item: C60112ReviewItem,
): boolean {
  const eitherHasMultiSpeakerRisk =
    item.itemTypes.includes("MULTI_SPEAKER_RISK") ||
    region.items.some((member) =>
      member.itemTypes.includes("MULTI_SPEAKER_RISK"),
    );
  if (!eitherHasMultiSpeakerRisk) return true;
  if (region.speakerGroupIds.size === 0 || item.speakerGroupIds.length === 0) {
    return true;
  }
  return item.speakerGroupIds.some((speakerId) =>
    region.speakerGroupIds.has(speakerId),
  );
}

function mayMerge(
  region: MutableRegion,
  item: C60112ReviewItem,
  policy: C60112ReviewPolicy,
): boolean {
  const gap = item.coreInterval.start - region.coreEnd;
  const mergedDuration =
    Math.max(region.coreEnd, item.coreInterval.end) -
    Math.min(region.coreStart, item.coreInterval.start);
  return (
    gap <= policy.regionMergePolicy.maximumGapSeconds &&
    mergedDuration <= policy.regionMergePolicy.maximumCoreDurationSeconds &&
    categoryCompatible(region, item) &&
    sceneCompatible(region, item) &&
    speakerCompatible(region, item)
  );
}

function mutableRegion(item: C60112ReviewItem): MutableRegion {
  return {
    items: [item],
    coreStart: item.coreInterval.start,
    coreEnd: item.coreInterval.end,
    sceneIds: new Set(item.sceneIds),
    speakerGroupIds: new Set(item.speakerGroupIds),
    families: itemFamilies(item),
  };
}

function addItem(region: MutableRegion, item: C60112ReviewItem): void {
  region.items.push(item);
  region.coreStart = Math.min(region.coreStart, item.coreInterval.start);
  region.coreEnd = Math.max(region.coreEnd, item.coreInterval.end);
  item.sceneIds.forEach((value) => region.sceneIds.add(value));
  item.speakerGroupIds.forEach((value) => region.speakerGroupIds.add(value));
  itemFamilies(item).forEach((value) => region.families.add(value));
}

function maximumPriority(items: readonly C60112ReviewItem[]): {
  tier: C60112PriorityTier;
  score: number;
} {
  const first = items[0];
  if (first === undefined) {
    throw new Error("EMPTY_REVIEW_REGION");
  }
  return items.slice(1).reduce(
    (maximum, item) => {
      if (item.priorityScore > maximum.score) {
        return { tier: item.priorityTier, score: item.priorityScore };
      }
      if (
        item.priorityScore === maximum.score &&
        PRIORITY_ORDER[item.priorityTier] > PRIORITY_ORDER[maximum.tier]
      ) {
        return { tier: item.priorityTier, score: item.priorityScore };
      }
      return maximum;
    },
    { tier: first.priorityTier, score: first.priorityScore },
  );
}

function maximumRequiredLevel(
  items: readonly C60112ReviewItem[],
): C60112RequiredLevel {
  return items.reduce<C60112RequiredLevel>(
    (maximum, item) =>
      REQUIRED_ORDER[item.requiredLevel] > REQUIRED_ORDER[maximum]
        ? item.requiredLevel
        : maximum,
    "INFORMATIONAL",
  );
}

function finalizeRegion(
  mutable: MutableRegion,
  index: number,
  policy: C60112ReviewPolicy,
  sourceDurationSeconds: number | null,
): C60112ReviewRegion {
  const items = mutable.items.toSorted(
    (left, right) =>
      left.coreInterval.start - right.coreInterval.start ||
      left.reviewItemId.localeCompare(right.reviewItemId),
  );
  const stableIdentity = {
    reviewItemIds: items.map((item) => item.reviewItemId).toSorted(),
    coreStart: mutable.coreStart,
    coreEnd: mutable.coreEnd,
  };
  const contextStart = Math.max(
    0,
    mutable.coreStart - policy.audioContextPolicy.preContextSeconds,
  );
  const unboundedContextEnd =
    mutable.coreEnd + policy.audioContextPolicy.postContextSeconds;
  const contextEnd =
    sourceDurationSeconds === null
      ? unboundedContextEnd
      : Math.min(sourceDurationSeconds, unboundedContextEnd);
  const core = {
    regionId: `review-region-${String(index + 1).padStart(4, "0")}-${machineQualitySemanticHash(stableIdentity).slice(0, 12)}`,
    reviewItemIds: stableIdentity.reviewItemIds,
    eventIds: [...new Set(items.flatMap((item) => item.eventIds))].toSorted(),
    finalCueIds: [
      ...new Set(items.flatMap((item) => item.finalCueIds)),
    ].toSorted(),
    contextStart,
    contextEnd,
    coreIntervals: items.map((item) => ({
      reviewItemId: item.reviewItemId,
      ...item.coreInterval,
    })),
    maxPriority: maximumPriority(items),
    aggregateReasons: [
      ...new Set(items.flatMap((item) => item.reviewReasons)),
    ].toSorted(),
    itemTypes: [...new Set(items.flatMap((item) => item.itemTypes))].toSorted(),
    requiredLevel: maximumRequiredLevel(items),
    sceneIds: [...mutable.sceneIds].toSorted(),
    speakerGroupIds: [...mutable.speakerGroupIds].toSorted(),
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}

export function clusterC60112ReviewRegions(input: {
  items: readonly C60112ReviewItem[];
  policy: C60112ReviewPolicy;
  sourceDurationSeconds?: number;
}): C60112ReviewRegionsArtifact {
  assertC60112ReviewPolicy(input.policy);
  assertC60112MachineOnlyInput(input.items, "cluster-review-regions.items");
  if (
    input.sourceDurationSeconds !== undefined &&
    (!Number.isFinite(input.sourceDurationSeconds) ||
      input.sourceDurationSeconds <= 0)
  ) {
    throw new Error("INVALID_SOURCE_DURATION");
  }
  if (
    input.sourceDurationSeconds !== undefined &&
    input.items.some(
      (item) => item.coreInterval.end > (input.sourceDurationSeconds ?? 0),
    )
  ) {
    throw new Error("REVIEW_ITEM_OUTSIDE_SOURCE_DURATION");
  }
  const orderedItems = [...input.items].toSorted(
    (left, right) =>
      left.coreInterval.start - right.coreInterval.start ||
      left.coreInterval.end - right.coreInterval.end ||
      left.reviewItemId.localeCompare(right.reviewItemId),
  );
  const mutableRegions: MutableRegion[] = [];
  for (const item of orderedItems) {
    const current = mutableRegions.at(-1);
    if (current !== undefined && mayMerge(current, item, input.policy)) {
      addItem(current, item);
    } else {
      mutableRegions.push(mutableRegion(item));
    }
  }
  const sourceDurationSeconds = input.sourceDurationSeconds ?? null;
  const regions = mutableRegions.map((region, index) =>
    finalizeRegion(region, index, input.policy, sourceDurationSeconds),
  );
  const core = {
    schemaVersion: "1.0.0" as const,
    policyVersion: input.policy.policyVersion,
    artifactType: "c6-0-1-12-machine-review-regions" as const,
    policyHash: input.policy.semanticHash,
    sourceTimebase: "SOURCE_GLOBAL_SECONDS" as const,
    runtimeGoldInputCount: 0 as const,
    regions,
    summary: {
      itemCount: input.items.length,
      regionCount: regions.length,
      mergedItemCount: input.items.length - regions.length,
      requiredRegionCount: regions.filter(
        (region) => region.requiredLevel === "REQUIRED",
      ).length,
      totalContextAudioSeconds: regions.reduce(
        (sum, region) => sum + region.contextEnd - region.contextStart,
        0,
      ),
    },
  };
  return { ...core, semanticHash: machineQualitySemanticHash(core) };
}
