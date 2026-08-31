import {
  c61211InventorySchema,
  type C61211Block,
  type C61211Mode,
  type C6121Supergroup,
} from "@mvl/shared";
import {
  buildC6121Supergroups,
  type C6121GraphInput,
} from "../evaluation-recovery/frozen-group-gold-bipartite-graph.js";
import {
  duration,
  unionIntervals,
  type Interval,
} from "../top-k/c612-structural.js";
import { c612Defined } from "../top-k/c612-policy.js";
import {
  c61211Artifact,
  C61211_PARTITION_POLICY,
  c61211Rule,
  counts,
  demand,
  hash,
} from "./c61211-policy.js";
export interface C61211PartitionInput extends C6121GraphInput {
  candidateReachableMachineGroupIds: readonly string[];
}
export type C61211Graph = ReturnType<typeof buildC6121Supergroups>;
export const unique = (xs: readonly string[]) => [...new Set(xs)].sort();
export const hull = (xs: readonly Interval[]) =>
  xs.length
    ? {
        start: Math.min(...xs.map((x) => x.start)),
        end: Math.max(...xs.map((x) => x.end)),
      }
    : null;
const gap = (xs: readonly Interval[]) => {
  const intervals = unionIntervals(xs);
  return Math.max(
    0,
    ...intervals
      .slice(1)
      .map((s, i) => s.start - c612Defined(intervals[i]).end),
  );
};
const contiguous = (xs: readonly number[]) =>
  xs.every((x, i) => i === 0 || x === c612Defined(xs[i - 1]) + 1);
export function orderedC61211Groups(input: C61211PartitionInput) {
  const indexes = new Map(input.baselineCueOrder.map((id, i) => [id, i]));
  const ends = (ids: readonly string[]) =>
    ids.map((id) => c612Defined(indexes.get(id)));
  return input.groups.toSorted(
    (a, b) =>
      Math.min(...ends(a.cueIds)) - Math.min(...ends(b.cueIds)) ||
      Math.max(...ends(a.cueIds)) - Math.max(...ends(b.cueIds)) ||
      a.groupId.localeCompare(b.groupId),
  );
}
export function inventoryC61211(
  input: C61211PartitionInput,
  graph = buildC6121Supergroups(input),
) {
  const rows = graph.map.groups
    .map((parent) => {
      const bilateral =
        parent.machineGroupIds.length > 0 && parent.goldCueIds.length > 0;
      const reasons = parent.reasons;
      const body = {
        parentE2SupergroupId: parent.supergroupId,
        machineGroupIds: parent.machineGroupIds,
        machineCueIds: parent.machineCueIds,
        goldCueIds: parent.goldCueIds,
        edgeIds: parent.edgeIds,
        bilateral,
        alreadyBounded: parent.shadowEvaluationEligible,
        attempted: bilateral && !parent.shadowEvaluationEligible,
        oversized:
          bilateral &&
          reasons.some((r) =>
            [
              "TEMPORAL_COMPONENT_DURATION_LIMIT",
              "TEMPORAL_COMPONENT_CUE_LIMIT",
              "TEMPORAL_BRIDGE_GAP_LIMIT",
            ].includes(r),
          ),
        pureLowCoverage:
          bilateral &&
          parent.machineGroupCount === 1 &&
          parent.goldCueCount === 1 &&
          reasons.every((r) =>
            [
              "INSUFFICIENT_BIDIRECTIONAL_COVERAGE",
              "CANDIDATE_LABEL_AMBIGUOUS",
            ].includes(r),
          ),
        durationSeconds: parent.durationSeconds,
        machineCueCount: parent.machineCueCount,
        goldCueCount: parent.goldCueCount,
        frozenFoldIds: parent.frozenFoldIds,
        reasons,
      };
      return { ...body, semanticHash: hash(body) };
    })
    .sort((a, b) =>
      a.parentE2SupergroupId.localeCompare(b.parentE2SupergroupId),
    );
  return c61211InventorySchema.parse(
    c61211Artifact("c6-1-2-1-1-oversized-component-inventory", {
      e2MapHash: graph.map.semanticHash,
      edgeLedgerHash: graph.edgeLedger.semanticHash,
      goldTimingHash: graph.map.goldTimingHash,
      rows,
      e2Edges: graph.edgeLedger.rows,
      reasonCounts: counts(
        rows.filter((r) => r.attempted).flatMap((r) => r.reasons),
      ),
      goldTextUsedForPartitionCount: 0,
    }),
  );
}

/** One range in the machine-order x Gold-time grid. No Gold text is accepted. */
export function candidateC61211Block(
  input: C61211PartitionInput,
  graph: C61211Graph,
  parent: C6121Supergroup,
  machineGroupIds: readonly string[],
  goldCueIds: readonly string[],
  mode: C61211Mode,
): C61211Block {
  const mg = orderedC61211Groups(input).filter((g) =>
    machineGroupIds.includes(g.groupId),
  );
  const cueIds = new Set(mg.flatMap((g) => g.cueIds));
  const mc = input.baselineCueOrder
    .filter((id) => cueIds.has(id))
    .map((id) => c612Defined(input.production.cues.find((c) => c.id === id)));
  const goldOrder = input.goldTiming.toSorted(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );
  const gc = goldOrder.filter((c) => goldCueIds.includes(c.id));
  const edges = graph.edgeLedger.rows.filter((e) =>
    parent.edgeIds.includes(e.edgeId),
  );
  const internal = edges.filter(
    (e) =>
      machineGroupIds.includes(e.machineGroupId) &&
      goldCueIds.includes(e.goldCueId),
  );
  const cut = edges.filter(
    (e) =>
      machineGroupIds.includes(e.machineGroupId) !==
      goldCueIds.includes(e.goldCueId),
  );
  const covered = duration(internal.flatMap((e) => e.overlapIntervals));
  const nodeRetainedOverlap = [
    ...machineGroupIds.map((nodeId) => ({
      nodeId,
      side: "MACHINE" as const,
      original: edges.filter((e) => e.machineGroupId === nodeId),
      retained: internal.filter((e) => e.machineGroupId === nodeId),
    })),
    ...goldCueIds.map((nodeId) => ({
      nodeId,
      side: "GOLD" as const,
      original: edges.filter((e) => e.goldCueId === nodeId),
      retained: internal.filter((e) => e.goldCueId === nodeId),
    })),
  ]
    .map(({ nodeId, side, original, retained }) => {
      const originalSeconds = duration(
          original.flatMap((e) => e.overlapIntervals),
        ),
        retainedSeconds = duration(retained.flatMap((e) => e.overlapIntervals));
      return {
        nodeId,
        side,
        originalSeconds,
        retainedSeconds,
        ratio: originalSeconds
          ? Math.min(1, retainedSeconds / originalSeconds)
          : 1,
      };
    })
    .sort(
      (a, b) =>
        a.side.localeCompare(b.side) || a.nodeId.localeCompare(b.nodeId),
    );
  const nodeMin = Math.min(1, ...nodeRetainedOverlap.map((n) => n.ratio));
  const allGroupOrder = orderedC61211Groups(input).map((g) => g.groupId);
  const mi = mg.map((g) => allGroupOrder.indexOf(g.groupId)),
    gi = gc.map((c) => goldOrder.findIndex((g) => g.id === c.id));
  const folded = mg.map((g) =>
    input.folds.folds.filter((f) => f.groupIds.includes(g.groupId)),
  );
  const frozenFoldIds = unique(folded.flatMap((fs) => fs.map((f) => f.foldId)));
  const foldId =
    frozenFoldIds.length === 1 && folded.every((fs) => fs.length === 1)
      ? c612Defined(frozenFoldIds[0])
      : null;
  const machineCoveredRatio = mc.length
    ? Math.min(1, covered / Math.max(1e-9, duration(mc)))
    : 0;
  const goldCoveredRatio = gc.length
    ? Math.min(1, covered / Math.max(1e-9, duration(gc)))
    : 0;
  const total = c612Defined(hull([...mc, ...gc]));
  const policy = C61211_PARTITION_POLICY.structure,
    rule = c61211Rule(mode),
    reasons: string[] = [];
  if (!mc.length || !gc.length || !internal.length)
    reasons.push("NO_BILATERAL_STRICT_EDGE");
  if (!foldId || parent.frozenFoldIds.length > 1)
    reasons.push("CROSS_FOLD_BLOCKED");
  if ([...mc, ...gc].some((c) => c.start < 0 || c.end <= c.start))
    reasons.push("STRUCTURE_INCOMPATIBLE");
  if (!contiguous(mc.map((c) => input.baselineCueOrder.indexOf(c.id))))
    reasons.push("NONCONTIGUOUS_MACHINE_CUES");
  if (!contiguous(gi)) reasons.push("NONCONTIGUOUS_GOLD_CUES");
  if (mc.length > policy.maxMachineCues || gc.length > policy.maxGoldCues)
    reasons.push("TEMPORAL_COMPONENT_CUE_LIMIT");
  if (total.end - total.start > policy.maxGroupDurationSeconds)
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
    reasons.push("INSUFFICIENT_BIDIRECTIONAL_COVERAGE");
  if (nodeMin < rule.minimumNodeRetained)
    reasons.push("NODE_RETAINED_OVERLAP_LIMIT");
  if (
    cut.some(
      (e) =>
        e.machineIntersectionRatio >= 0.5 && e.goldIntersectionRatio >= 0.5,
    )
  )
    reasons.push("STRONG_ALIGNMENT_BRIDGE");
  if (
    cut.some(
      (e) =>
        !rule.allowCuts ||
        Math.min(e.machineIntersectionRatio, e.goldIntersectionRatio) >
          rule.maximumWeakBridge,
    )
  )
    reasons.push("UNSAFE_CUT_BRIDGE");
  const discardedOverlapSeconds = duration(
    cut.flatMap((e) => e.overlapIntervals),
  );
  const originalSeconds = duration(edges.flatMap((e) => e.overlapIntervals));
  const componentDiscardedOverlapRatio = originalSeconds
    ? Math.min(1, discardedOverlapSeconds / originalSeconds)
    : 0;
  if (componentDiscardedOverlapRatio > rule.maximumCutLoss)
    reasons.push("COMPONENT_CUT_LOSS_LIMIT");
  const eventIds = unique(mg.flatMap((g) => g.eventIds));
  const candidateEligibleEventIds = eventIds.filter((eventId) => {
    const event = input.universe.events.find((e) => e.eventId === eventId),
      span = event?.finalSpan;
    const cue = mc.find((c) => c.id === span?.finalCueId);
    const owners = input.groups.filter((g) => g.eventIds.includes(eventId));
    const ef = input.folds.folds.filter((f) => f.eventIds.includes(eventId));
    return !!(
      event &&
      span?.modifiable &&
      cue &&
      owners.length === 1 &&
      owners.every((g) => machineGroupIds.includes(g.groupId)) &&
      event.finalCueIds.every((id) => cueIds.has(id)) &&
      Array.from(cue.text).slice(span.spanStart, span.spanEnd).join("") ===
        span.spanText &&
      span.spanText === event.currentText &&
      ef.length === 1 &&
      ef[0]?.foldId === foldId
    );
  });
  const eligible = reasons.length === 0;
  const body: Omit<C61211Block, "semanticHash"> = {
    partitionBlockId:
      "c61211-block:" +
      hash({
        parent: parent.supergroupId,
        machineGroupIds: mg.map((g) => g.groupId),
        goldCueIds: gc.map((c) => c.id),
      }).slice(0, 24),
    parentE2SupergroupId: parent.supergroupId,
    machineGroupIds: mg.map((g) => g.groupId),
    machineCueIds: mc.map((c) => c.id),
    machineEventIds: eventIds,
    goldCueIds: gc.map((c) => c.id),
    edgeIds: internal.map((e) => e.edgeId).sort(),
    retainedEdgeIds: internal.map((e) => e.edgeId).sort(),
    cutEdgeIds: cut.map((e) => e.edgeId).sort(),
    foldId,
    frozenFoldIds,
    machineIndexRange: mi.length
      ? { start: Math.min(...mi), end: Math.max(...mi) }
      : null,
    goldIndexRange: gi.length
      ? { start: Math.min(...gi), end: Math.max(...gi) }
      : null,
    machineSourceInterval: hull(mc),
    goldSourceInterval: hull(gc),
    totalSourceInterval: total,
    machineCoveredRatio,
    goldCoveredRatio,
    machineCueCount: mc.length,
    goldCueCount: gc.length,
    machineGroupCount: mg.length,
    maximumMachineGapSeconds: gap(mc),
    maximumGoldGapSeconds: gap(gc),
    durationSeconds: total.end - total.start,
    minimumNodeRetainedOverlapRatio: nodeMin,
    discardedOverlapSeconds,
    componentDiscardedOverlapRatio,
    nodeRetainedOverlap,
    structuralStatus: eligible
      ? "STRUCTURALLY_VALID"
      : "STRUCTURE_INCOMPATIBLE",
    assignmentCategory: eligible
      ? candidateEligibleEventIds.length
        ? "PARTITIONED_EVALUABLE_BLOCK"
        : "PARTITIONED_CANDIDATE_LABEL_INELIGIBLE_BLOCK"
      : "RESIDUAL_UNPARTITIONED",
    shadowEvaluationEligible: eligible,
    candidateLabelEligible: eligible && candidateEligibleEventIds.length > 0,
    oofTrainingEligible:
      eligible && candidateEligibleEventIds.length > 0 && foldId !== null,
    candidateEligibleEventIds: eligible ? candidateEligibleEventIds : [],
    candidateAmbiguousEventIds: eventIds.filter(
      (id) => !candidateEligibleEventIds.includes(id),
    ),
    reasons: unique(reasons),
  };
  demand(
    body.machineGroupCount > 0 || body.goldCueCount > 0,
    "C61211_EMPTY_BLOCK",
  );
  return { ...body, semanticHash: hash(body) };
}
