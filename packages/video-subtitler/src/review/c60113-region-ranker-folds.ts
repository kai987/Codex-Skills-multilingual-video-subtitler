import {
  c60113RankerFoldsSchema,
  c60113RankerMachineFreezeSchema,
  type C60113RankerFolds,
  type C60113RankerMachineFreeze,
  type C60113RegionFeatures,
} from "@mvl/shared";
import {
  assertC60113FeatureHash,
  C60113_CALIBRATION_POLICY,
  c60113Hash,
  c60113HashPayload,
  c60113IntersectionSeconds,
  c60113IntervalUnion,
  c60113Require,
} from "./c60113-region-features.js";

const NEIGHBORHOOD_SECONDS = 1.5;
const STRUCTURAL_NEIGHBORHOOD_SECONDS = 30;

export function buildC60113RankerFolds(input: {
  features: C60113RegionFeatures;
  generatedAt: string;
}): C60113RankerFolds {
  assertC60113FeatureHash(input.features);
  const rows = [...input.features.regions].sort(
    (a, b) =>
      a.contextInterval.start - b.contextInterval.start ||
      a.regionId.localeCompare(b.regionId),
  );
  const parents = rows.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parents[cursor] !== cursor) cursor = c60113Require(parents[cursor]);
    return cursor;
  };
  rows.forEach((left, i) =>
    rows.slice(i + 1).forEach((right, offset) => {
      const gap = right.contextInterval.start - left.contextInterval.end;
      const sharedStructural =
        left.sceneIds.some((id) => right.sceneIds.includes(id)) ||
        left.speakerGroupIds.some((id) => right.speakerGroupIds.includes(id));
      if (
        gap <= NEIGHBORHOOD_SECONDS ||
        (sharedStructural && gap <= STRUCTURAL_NEIGHBORHOOD_SECONDS)
      )
        parents[find(i + offset + 1)] = find(i);
    }),
  );
  const byGroup = new Map<number, typeof rows>();
  rows.forEach((row, i) => {
    const key = find(i);
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  });
  const groups = [...byGroup.values()]
    .map((members) => {
      const regionIds = members.map((row) => row.regionId).sort();
      return {
        groupId: `calibration-group-${c60113Hash(regionIds).slice(0, 16)}`,
        regionIds,
        timelineRange: {
          start: Math.min(...members.map((row) => row.contextInterval.start)),
          end: Math.max(...members.map((row) => row.contextInterval.end)),
        },
        audioIntervalUnion: c60113IntervalUnion(
          members.map((row) => row.contextInterval),
        ),
      };
    })
    .sort(
      (a, b) =>
        a.timelineRange.start - b.timelineRange.start ||
        a.groupId.localeCompare(b.groupId),
    );
  const foldCount = Math.min(5, groups.length);
  const groupedFolds: (typeof groups)[] = Array.from(
    { length: foldCount },
    () => [],
  );
  // Contiguous machine-only partition. Labels cannot alter boundaries or fold count.
  groups.forEach((group, index) =>
    c60113Require(
      groupedFolds[
        Math.min(foldCount - 1, Math.floor((index * foldCount) / groups.length))
      ],
    ).push(group),
  );
  const folds = groupedFolds.map((members, index) => ({
    foldId: `fold-${index + 1}`,
    regionIds: members.flatMap((group) => group.regionIds),
    groupIds: members.map((group) => group.groupId),
    timelineRanges: members.map((group) => group.timelineRange),
    audioIntervalUnion: c60113IntervalUnion(
      members.flatMap((group) => group.audioIntervalUnion),
    ),
  }));
  let crossFoldAudioOverlapCount = 0;
  folds.forEach((fold, i) =>
    folds.slice(i + 1).forEach((other) =>
      fold.audioIntervalUnion.forEach((left) =>
        other.audioIntervalUnion.forEach((right) => {
          if (c60113IntersectionSeconds(left, right) > 0)
            crossFoldAudioOverlapCount++;
        }),
      ),
    ),
  );
  if (crossFoldAudioOverlapCount !== 0)
    throw new Error("CALIBRATION_FOLD_AUDIO_LEAKAGE");
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "c6-0-1-13-review-ranker-folds" as const,
    machineFeaturesHash: input.features.semanticHash,
    frozenBeforeLabels: true as const,
    construction: "CONTIGUOUS_AUDIO_CONNECTED_GROUPS_V1" as const,
    neighborhoodSeconds: NEIGHBORHOOD_SECONDS,
    requestedFoldCount: 5 as const,
    actualFoldCount: foldCount,
    reason:
      foldCount === 5
        ? "FIVE_CONTIGUOUS_MACHINE_ONLY_GROUPED_FOLDS"
        : "FEWER_THAN_FIVE_AUDIO_INDEPENDENT_MACHINE_GROUPS_NO_LABEL_BASED_REPARTITION",
    groups,
    folds,
    crossFoldAudioOverlapCount,
  };
  return c60113RankerFoldsSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

export function createC60113RankerMachineFreeze(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  artifactHashes: Record<string, string>;
  generatedAt: string;
}): C60113RankerMachineFreeze {
  assertC60113FeatureHash(input.features);
  c60113RankerFoldsSchema.parse(input.folds);
  if (
    input.folds.machineFeaturesHash !== input.features.semanticHash ||
    c60113HashPayload(input.folds) !== input.folds.semanticHash
  )
    throw new Error("STALE_FOLD_FREEZE");
  const payload = {
    schemaVersion: "1.0.0" as const,
    policyVersion: C60113_CALIBRATION_POLICY,
    artifactType: "c6-0-1-13-review-ranker-machine-freeze" as const,
    machineFeaturesHash: input.features.semanticHash,
    foldsHash: input.folds.semanticHash,
    artifactHashes: input.artifactHashes,
    goldInputCount: 0 as const,
    frozenBeforeLabels: true as const,
  };
  return c60113RankerMachineFreezeSchema.parse({
    ...payload,
    generatedAt: input.generatedAt,
    semanticHash: c60113Hash(payload),
  });
}

export function assertC60113MachineFreeze(input: {
  features: C60113RegionFeatures;
  folds: C60113RankerFolds;
  machineFreeze: C60113RankerMachineFreeze;
}): void {
  assertC60113FeatureHash(input.features);
  c60113RankerFoldsSchema.parse(input.folds);
  c60113RankerMachineFreezeSchema.parse(input.machineFreeze);
  if (
    c60113HashPayload(input.folds) !== input.folds.semanticHash ||
    c60113HashPayload(input.machineFreeze) !==
      input.machineFreeze.semanticHash ||
    input.machineFreeze.machineFeaturesHash !== input.features.semanticHash ||
    input.machineFreeze.foldsHash !== input.folds.semanticHash ||
    input.folds.machineFeaturesHash !== input.features.semanticHash
  )
    throw new Error("GOLD_BARRIER_MACHINE_FREEZE_MISMATCH");
  const assigned = input.folds.folds.flatMap((fold) => fold.regionIds).sort();
  if (
    JSON.stringify(assigned) !==
    JSON.stringify(input.features.regions.map((row) => row.regionId).sort())
  )
    throw new Error("FOLD_REGION_COVERAGE_MISMATCH");
  for (const [i, fold] of input.folds.folds.entries())
    for (const other of input.folds.folds.slice(i + 1)) {
      if (
        fold.audioIntervalUnion.some((left) =>
          other.audioIntervalUnion.some(
            (right) => c60113IntersectionSeconds(left, right) > 0,
          ),
        )
      )
        throw new Error("CALIBRATION_FOLD_AUDIO_LEAKAGE");
    }
}
