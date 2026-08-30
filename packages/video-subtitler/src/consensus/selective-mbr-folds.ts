import {
  c611CalibrationFoldsSchema,
  c611FoldUnitSchema,
  type C611CalibrationFolds,
  type C611CalibrationPolicy,
  type C611FoldUnit,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";
import { c61Require } from "./japanese-text-representation.js";
/** Optimal contiguous partition of whole groups; never shuffles or splits a group. */
export function partitionC611Contiguous<T>(
  items: T[],
  requested: number,
  weight: (item: T) => number,
): T[][] {
  if (items.length === 0) return [];
  const k = Math.min(requested, items.length);
  const sums = [0];
  for (const item of items) sums.push((sums.at(-1) ?? 0) + weight(item));
  const target = (sums.at(-1) ?? 0) / k;
  const dp = Array.from({ length: k + 1 }, () =>
    Array.from({ length: items.length + 1 }, () => Infinity),
  );
  const previous = Array.from({ length: k + 1 }, () =>
    Array.from({ length: items.length + 1 }, () => -1),
  );
  c61Require(dp[0])[0] = 0;
  for (let count = 1; count <= k; count++)
    for (let end = count; end <= items.length; end++) {
      for (let start = count - 1; start < end; start++) {
        const value =
          c61Require(c61Require(dp[count - 1])[start]) +
          (c61Require(sums[end]) - c61Require(sums[start]) - target) ** 2;
        if (value < c61Require(c61Require(dp[count])[end]) - 1e-12) {
          c61Require(dp[count])[end] = value;
          c61Require(previous[count])[end] = start;
        }
      }
    }
  const result: T[][] = [];
  let end = items.length;
  for (let count = k; count > 0; count--) {
    const start = c61Require(c61Require(previous[count])[end]);
    result.unshift(items.slice(start, end));
    end = start;
  }
  return result;
}
function connected(a: C611FoldUnit, b: C611FoldUnit, gap: number): boolean {
  if (
    a.eventId === b.eventId ||
    a.finalCueIds.some((id) => b.finalCueIds.includes(id)) ||
    a.sharedSpanKeys.some((id) => b.sharedSpanKeys.includes(id))
  )
    return true;
  if (a.sourceAudioIdentity !== b.sourceAudioIdentity) return false;
  const ai = [a.sourceInterval, ...a.acousticIntervals, ...a.cueIntervals];
  const bi = [b.sourceInterval, ...b.acousticIntervals, ...b.cueIntervals];
  return ai.some((x) =>
    bi.some((y) => Math.max(x.start, y.start) <= Math.min(x.end, y.end) + gap),
  );
}
export function buildC611Folds(
  input: C611FoldUnit[],
  policy: C611CalibrationPolicy,
): C611CalibrationFolds {
  const units = input
    .map((x) => c611FoldUnitSchema.parse(x))
    .sort(
      (a, b) =>
        a.sourceAudioIdentity.localeCompare(b.sourceAudioIdentity) ||
        a.sourceInterval.start - b.sourceInterval.start ||
        a.eventId.localeCompare(b.eventId) ||
        a.proposalId.localeCompare(b.proposalId),
    );
  if (
    units.length === 0 ||
    new Set(units.map((x) => x.proposalId)).size !== units.length
  )
    throw new Error("C611_INVALID_FOLD_UNITS");
  for (const unit of units)
    for (const interval of [
      unit.sourceInterval,
      ...unit.acousticIntervals,
      ...unit.cueIntervals,
    ])
      if (interval.end <= interval.start)
        throw new Error("C611_INVALID_FOLD_INTERVAL");
  const parents = units.map((_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) i = c61Require(parents[i]);
    return i;
  };
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++)
      if (
        connected(
          c61Require(units[i]),
          c61Require(units[j]),
          policy.neighborGapSeconds,
        )
      )
        parents[root(j)] = root(i);
  const grouped = new Map<number, C611FoldUnit[]>();
  units.forEach((unit, i) => {
    const list = grouped.get(root(i)) ?? [];
    list.push(unit);
    grouped.set(root(i), list);
  });
  const groups = [...grouped.values()]
    .map((list) => {
      if (new Set(list.map((x) => x.sourceAudioIdentity)).size !== 1)
        throw new Error("C611_SHARED_CUE_CROSSES_AUDIO_IDENTITIES");
      const eventIds = [...new Set(list.map((x) => x.eventId))].sort();
      const proposalIds = list.map((x) => x.proposalId).sort();
      const intervals = list.flatMap((x) => [
        x.sourceInterval,
        ...x.acousticIntervals,
        ...x.cueIntervals,
      ]);
      return {
        groupId: `c611-group:${hash({ eventIds, proposalIds }).slice(0, 24)}`,
        eventIds,
        proposalIds,
        sourceAudioIdentity: c61Require(list[0]).sourceAudioIdentity,
        sourceInterval: {
          start: Math.min(...intervals.map((x) => x.start)),
          end: Math.max(...intervals.map((x) => x.end)),
        },
        foldId: "",
      };
    })
    .sort(
      (a, b) =>
        a.sourceAudioIdentity.localeCompare(b.sourceAudioIdentity) ||
        a.sourceInterval.start - b.sourceInterval.start ||
        a.groupId.localeCompare(b.groupId),
    );
  const partitions = partitionC611Contiguous(
    groups,
    policy.outerFoldCount,
    (x) => x.proposalIds.length,
  );
  const folds = partitions.map((partition, i) => {
    const foldId = `outer-${i + 1}`;
    for (const group of partition) group.foldId = foldId;
    return {
      foldId,
      groupIds: partition.map((x) => x.groupId),
      eventIds: [...new Set(partition.flatMap((x) => x.eventIds))].sort(),
      proposalIds: partition.flatMap((x) => x.proposalIds).sort(),
    };
  });
  const membership = new Map(
    folds.flatMap((f) => f.proposalIds.map((id) => [id, f.foldId] as const)),
  );
  let audioLeakageCount = 0,
    eventLeakageCount = 0,
    cueLeakageCount = 0;
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++)
      if (
        membership.get(c61Require(units[i]).proposalId) !==
        membership.get(c61Require(units[j]).proposalId)
      ) {
        if (
          connected(
            c61Require(units[i]),
            c61Require(units[j]),
            policy.neighborGapSeconds,
          )
        )
          audioLeakageCount++;
        if (c61Require(units[i]).eventId === c61Require(units[j]).eventId)
          eventLeakageCount++;
        if (
          c61Require(units[i]).finalCueIds.some((id) =>
            c61Require(units[j]).finalCueIds.includes(id),
          )
        )
          cueLeakageCount++;
      }
  const body = {
    schemaVersion: "1.0.0" as const,
    policyVersion: policy.policyVersion,
    artifactType: "c6-1-1-calibration-folds" as const,
    frozenBeforeLabels: true as const,
    policyHash: policy.semanticHash,
    unitHash: hash(units),
    units,
    requestedFoldCount: policy.outerFoldCount,
    foldCount: folds.length,
    status:
      groups.length < policy.outerFoldCount
        ? ("INSUFFICIENT_INDEPENDENT_GROUPS" as const)
        : ("READY" as const),
    groups,
    folds,
    audioLeakageCount,
    eventLeakageCount,
    cueLeakageCount,
  };
  return c611CalibrationFoldsSchema.parse({
    ...body,
    semanticHash: hash(body),
  });
}
export function verifyC611Folds(
  folds: C611CalibrationFolds,
  policy: C611CalibrationPolicy,
): void {
  const rebuilt = buildC611Folds(folds.units, policy);
  if (
    rebuilt.semanticHash !== folds.semanticHash ||
    hash(rebuilt) !== hash(folds)
  )
    throw new Error("C611_FOLD_FREEZE_MISMATCH");
}
