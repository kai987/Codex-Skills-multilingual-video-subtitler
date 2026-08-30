import {
  c611EvaluationCueSchema,
  c611FixedAlignmentPolicySchema,
  c611FixedBaselineAlignmentMapSchema,
  type C611EvaluationCue,
  type C611FixedAlignmentPolicy,
  type C611FixedBaselineAlignmentMap,
  type C611FixedGroup,
} from "@mvl/shared";
import { machineQualitySemanticHash as hash } from "../machine-quality/evidence-correlation.js";

/** Evaluation only. Generic policy fixed before Gold; no profile text or labels. */
export const C611_FIXED_ALIGNMENT_POLICY: C611FixedAlignmentPolicy =
  Object.freeze({
    mappingPolicyVersion: "c6.1.1-time-connected-fixed-groups-v1",
    algorithm: "BASELINE_TEMPORAL_BIPARTITE_COMPONENTS",
    minimumMachineCoveredRatio: 0.5,
    minimumGoldCoveredRatio: 0.5,
    maxMachineCues: 8,
    maxGoldCues: 8,
    maxGroupDurationSeconds: 24,
    maxWithinSideGapSeconds: 2,
    profileRematchingAllowed: false,
    exactView: "NFC_GRAPHEME_CONCATENATED_CUES",
    normalizedView:
      "C61_NFKC_CASE_PUNCTUATION_WHITESPACE_INSENSITIVE_GRAPHEMES",
  });
export const C611_EVALUATION_HEADER = {
  schemaVersion: "1.0.0" as const,
  policyVersion: "c6.1.1-fixed-alignment-selective-existing-mbr-v1" as const,
  evaluationOnly: true as const,
  privacy: "LOCAL_ONLY" as const,
};
export interface C611EventBinding {
  eventId: string;
  finalCueIds: string[];
}
export interface C611EvaluationBarrier {
  machineFreezeHash: string;
  machineFrozenAt: string;
  goldFirstReadAt: string;
}
export function c611CueViews(
  cues: readonly C611EvaluationCue[],
): C611EvaluationCue[] {
  const result = cues.map(({ id, start, end, text }) =>
    c611EvaluationCueSchema.parse({ id, start, end, text }),
  );
  if (new Set(result.map((cue) => cue.id)).size !== result.length)
    throw new Error("C611_DUPLICATE_CUE_ID");
  return result;
}
export function c611OrderedGold(
  cues: readonly C611EvaluationCue[],
): C611EvaluationCue[] {
  return c611CueViews(cues).sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
}
export function c611TimingHash(cues: readonly C611EvaluationCue[]): string {
  return hash(cues.map(({ id, start, end }) => ({ id, start, end })));
}
export function c611TextHash(cues: readonly C611EvaluationCue[]): string {
  return hash(cues.map(({ id, text }) => ({ id, text })));
}
export function c611StableMapping(
  status: C611FixedGroup["mappingStatus"],
): boolean {
  return status.startsWith("FIXED_");
}
function unionLength(
  intervals: readonly { start: number; end: number }[],
): number {
  const ordered = intervals
    .filter((c) => c.end > c.start)
    .toSorted((a, b) => a.start - b.start || a.end - b.end);
  let total = 0,
    end = -Infinity;
  for (const interval of ordered) {
    total += Math.max(0, interval.end - Math.max(interval.start, end));
    end = Math.max(end, interval.end);
  }
  return total;
}
function gap(cues: readonly C611EvaluationCue[]): number {
  let previousEnd = -Infinity,
    maximum = 0;
  for (const cue of cues.toSorted(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    if (previousEnd !== -Infinity)
      maximum = Math.max(maximum, cue.start - previousEnd);
    previousEnd = Math.max(previousEnd, cue.end);
  }
  return maximum;
}
function continuous(indexes: number[]): boolean {
  return indexes.every(
    (value, index) => index === 0 || value === (indexes[index - 1] ?? 0) + 1,
  );
}
export function c611MappingContent(
  map: Omit<
    C611FixedBaselineAlignmentMap,
    "semanticHash" | "mappingSemanticHash"
  >,
): unknown {
  return {
    baselineCueHash: map.baselineCueHash,
    baselineTimingHash: map.baselineTimingHash,
    baselineCueOrder: map.baselineCueOrder,
    goldCueHash: map.goldCueHash,
    goldCueOrder: map.goldCueOrder,
    eventBindingsHash: map.eventBindingsHash,
    mappingPolicyHash: map.mappingPolicyHash,
    groups: map.groups,
    unmappedGoldCueIds: map.unmappedGoldCueIds,
    summary: map.summary,
  };
}
export function buildC611FixedBaselineAlignmentMap(input: {
  baselineCues: readonly C611EvaluationCue[];
  goldCues: readonly C611EvaluationCue[];
  eventBindings: readonly C611EventBinding[];
  barrier: C611EvaluationBarrier;
  policy?: C611FixedAlignmentPolicy;
}): C611FixedBaselineAlignmentMap {
  const policy = c611FixedAlignmentPolicySchema.parse(
    input.policy ?? C611_FIXED_ALIGNMENT_POLICY,
  );
  if (
    !Number.isFinite(Date.parse(input.barrier.machineFrozenAt)) ||
    !Number.isFinite(Date.parse(input.barrier.goldFirstReadAt)) ||
    Date.parse(input.barrier.goldFirstReadAt) <
      Date.parse(input.barrier.machineFrozenAt)
  )
    throw new Error("C611_GOLD_PRECEDES_MACHINE_FREEZE");
  const machine = c611CueViews(input.baselineCues),
    gold = c611OrderedGold(input.goldCues);
  const bindings = input.eventBindings
    .map((row) => ({
      eventId: row.eventId,
      finalCueIds: [...new Set(row.finalCueIds)].sort(),
    }))
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
  if (new Set(bindings.map((row) => row.eventId)).size !== bindings.length)
    throw new Error("C611_DUPLICATE_EVENT_BINDING");
  const machineIds = new Set(machine.map((cue) => cue.id));
  if (
    bindings.some(
      (row) =>
        !row.eventId || row.finalCueIds.some((id) => !machineIds.has(id)),
    )
  )
    throw new Error("C611_UNKNOWN_EVENT_CUE_BINDING");
  const mEdges = machine.map((m) =>
    gold.flatMap((g, index) =>
      Math.max(m.start, g.start) < Math.min(m.end, g.end) ? [index] : [],
    ),
  );
  const gEdges = gold.map((_, index) =>
    mEdges.flatMap((edges, m) => (edges.includes(index) ? [m] : [])),
  );
  const visited = new Set<number>(),
    claimedGold = new Set<number>();
  const chronological = machine.every(
    (cue, index) =>
      index === 0 || cue.start >= (machine[index - 1]?.start ?? 0),
  );
  const groups: C611FixedGroup[] = [];
  for (let initial = 0; initial < machine.length; initial++) {
    if (visited.has(initial)) continue;
    const pending = [initial],
      ms = new Set<number>(),
      gs = new Set<number>();
    while (pending.length) {
      const m = pending.pop();
      if (m === undefined || ms.has(m)) continue;
      ms.add(m);
      visited.add(m);
      for (const g of mEdges[m] ?? []) {
        gs.add(g);
        claimedGold.add(g);
        for (const other of gEdges[g] ?? [])
          if (!ms.has(other)) pending.push(other);
      }
    }
    const mi = [...ms].sort((a, b) => a - b),
      gi = [...gs].sort((a, b) => a - b);
    const mc = mi
      .map((i) => machine[i])
      .filter((cue): cue is C611EvaluationCue => cue !== undefined);
    const gc = gi
      .map((i) => gold[i])
      .filter((cue): cue is C611EvaluationCue => cue !== undefined);
    const intersections = mc
      .flatMap((m) =>
        gc.map((g) => ({
          start: Math.max(m.start, g.start),
          end: Math.min(m.end, g.end),
        })),
      )
      .filter((i) => i.end > i.start);
    const intersected = unionLength(intersections),
      machineLength = unionLength(mc),
      goldLength = unionLength(gc);
    const machineCoveredRatio = machineLength
      ? Math.min(1, intersected / machineLength)
      : 0;
    const goldCoveredRatio = goldLength
      ? Math.min(1, intersected / goldLength)
      : 0;
    const start = Math.min(...mc.map((c) => c.start)),
      end = Math.max(start, ...mc.map((c) => c.end));
    const totalSpan =
      Math.max(...[...mc, ...gc].map((c) => c.end)) -
      Math.min(...[...mc, ...gc].map((c) => c.start));
    const reasons: string[] = [];
    let mappingStatus: C611FixedGroup["mappingStatus"];
    if (
      !chronological ||
      mc.some((c) => c.end <= c.start) ||
      gc.some((c) => c.end <= c.start) ||
      !continuous(mi) ||
      !continuous(gi)
    ) {
      mappingStatus = "STRUCTURE_INCOMPATIBLE";
      reasons.push("NON_MONOTONIC_NONCONTIGUOUS_OR_INVALID_CUE_STRUCTURE");
    } else if (!gc.length) {
      mappingStatus = "NO_BASELINE_MAPPING";
      reasons.push("NO_POSITIVE_TEMPORAL_OVERLAP");
    } else {
      if (mc.length > policy.maxMachineCues || gc.length > policy.maxGoldCues)
        reasons.push("TEMPORAL_COMPONENT_CUE_LIMIT");
      if (totalSpan > policy.maxGroupDurationSeconds)
        reasons.push("TEMPORAL_COMPONENT_DURATION_LIMIT");
      if (
        gap(mc) > policy.maxWithinSideGapSeconds ||
        gap(gc) > policy.maxWithinSideGapSeconds
      )
        reasons.push("TEMPORAL_BRIDGE_GAP_LIMIT");
      if (
        machineCoveredRatio < policy.minimumMachineCoveredRatio ||
        goldCoveredRatio < policy.minimumGoldCoveredRatio
      )
        reasons.push("INSUFFICIENT_BIDIRECTIONAL_TEMPORAL_COVERAGE");
      mappingStatus = reasons.length
        ? "AMBIGUOUS_BASELINE_MAPPING"
        : mc.length === 1
          ? gc.length === 1
            ? "FIXED_ONE_TO_ONE"
            : "FIXED_ONE_TO_MANY"
          : gc.length === 1
            ? "FIXED_MANY_TO_ONE"
            : "FIXED_MANY_TO_MANY";
    }
    const machineCueIds = mc.map((c) => c.id),
      goldCueIds = gc.map((c) => c.id);
    const body = {
      groupId: `c611-group-${hash({ machineCueIds, goldCueIds }).slice(0, 20)}`,
      machineCueIds,
      machineCueIndexes: mi,
      machineEventIds: bindings
        .filter((row) =>
          row.finalCueIds.some((id) => machineCueIds.includes(id)),
        )
        .map((row) => row.eventId),
      goldCueIds,
      goldCueIndexes: gi,
      sourceInterval: { start, end },
      baselineTextHash: c611TextHash(mc),
      baselineTimingHash: c611TimingHash(mc),
      goldTextHash: c611TextHash(gc),
      goldTimingHash: c611TimingHash(gc),
      machineCoveredRatio,
      goldCoveredRatio,
      mappingStatus,
      ambiguityReasons: reasons,
    };
    groups.push({ ...body, semanticHash: hash(body) });
  }
  const unmappedGoldCueIds = gold
    .filter((_, i) => !claimedGold.has(i))
    .map((c) => c.id);
  const numberOf = (status: C611FixedGroup["mappingStatus"]) =>
    groups.filter((g) => g.mappingStatus === status).length;
  const body = {
    ...C611_EVALUATION_HEADER,
    artifactType: "c6-1-1-fixed-baseline-alignment-map" as const,
    ...input.barrier,
    machineArtifactsFrozenBeforeGold: true as const,
    baselineCueHash: hash(machine),
    baselineTimingHash: c611TimingHash(machine),
    baselineCueOrder: machine.map((c) => c.id),
    goldCueHash: hash(gold),
    goldCueOrder: gold.map((c) => c.id),
    eventBindingsHash: hash(bindings),
    mappingPolicyVersion: policy.mappingPolicyVersion,
    mappingPolicy: policy,
    mappingPolicyHash: hash(policy),
    groups,
    unmappedGoldCueIds,
    summary: {
      totalCueGroups: groups.length,
      stableMappedGroups: groups.filter((g) =>
        c611StableMapping(g.mappingStatus),
      ).length,
      ambiguousGroups: numberOf("AMBIGUOUS_BASELINE_MAPPING"),
      unmappedGroups: numberOf("NO_BASELINE_MAPPING"),
      structureIncompatibleGroups: numberOf("STRUCTURE_INCOMPATIBLE"),
      oneToOne: numberOf("FIXED_ONE_TO_ONE"),
      oneToMany: numberOf("FIXED_ONE_TO_MANY"),
      manyToOne: numberOf("FIXED_MANY_TO_ONE"),
      manyToMany: numberOf("FIXED_MANY_TO_MANY"),
      assignedMachineCueCount: machine.length,
      assignedGoldCueCount: claimedGold.size,
      unmappedGoldCueCount: unmappedGoldCueIds.length,
    },
  };
  const mapped = {
    ...body,
    mappingSemanticHash: hash(c611MappingContent(body)),
  };
  return c611FixedBaselineAlignmentMapSchema.parse({
    ...mapped,
    semanticHash: hash(mapped),
  });
}

/** Group membership is evaluation-only. Never use it to refit pre-Gold folds. */
export function c611EventFixedGroups(
  map: C611FixedBaselineAlignmentMap,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const group of map.groups)
    for (const eventId of group.machineEventIds)
      result.set(eventId, [...(result.get(eventId) ?? []), group.groupId]);
  return result;
}
