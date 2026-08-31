import {
  c61211CutsSchema,
  c61211ResidualsSchema,
  c61211ConservationSchema,
  type C61211Map,
} from "@mvl/shared";
import { duration } from "../top-k/c612-structural.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { c61211Artifact, c61211Rule, hash } from "./c61211-policy.js";
import {
  unique,
  type C61211Graph,
  type C61211PartitionInput,
} from "./component-inventory.js";

export function auditC61211Cuts(map: C61211Map, graph: C61211Graph) {
  const rule = c61211Rule(map.mode);
  const rows = graph.edgeLedger.rows
    .flatMap((edge) => {
      const source = map.blocks.find((b) =>
        b.machineGroupIds.includes(edge.machineGroupId),
      );
      const target = map.blocks.find((b) =>
        b.goldCueIds.includes(edge.goldCueId),
      );
      if (
        !source ||
        !target ||
        source.partitionBlockId === target.partitionBlockId
      )
        return [];
      const strongBridge =
        edge.machineIntersectionRatio >= 0.5 &&
        edge.goldIntersectionRatio >= 0.5;
      const weakBridgeStrength = Math.min(
        edge.machineIntersectionRatio,
        edge.goldIntersectionRatio,
      );
      const component = c612Defined(
        map.components.find(
          (c) => c.parentE2SupergroupId === source.parentE2SupergroupId,
        ),
      );
      const body = {
        edgeId: edge.edgeId,
        parentComponentId: source.parentE2SupergroupId,
        machineGroupId: edge.machineGroupId,
        goldCueId: edge.goldCueId,
        sourceBlockId: source.partitionBlockId,
        targetBlockId: target.partitionBlockId,
        overlapIntervals: edge.overlapIntervals,
        overlapSeconds: edge.overlapSeconds,
        machineIntersectionRatio: edge.machineIntersectionRatio,
        goldIntersectionRatio: edge.goldIntersectionRatio,
        weakBridgeStrength,
        strongBridge,
        cutAllowed:
          rule.allowCuts &&
          !strongBridge &&
          weakBridgeStrength <= rule.maximumWeakBridge &&
          component.componentDiscardedOverlapRatio <= rule.maximumCutLoss &&
          component.minimumNodeRetainedOverlapRatio >= rule.minimumNodeRetained,
        cutReasons: unique([
          "CUT_BRIDGE_EDGE",
          ...(!strongBridge && weakBridgeStrength <= rule.maximumWeakBridge
            ? ["WEAK_BRIDGE_WITHIN_FROZEN_POLICY"]
            : ["UNSAFE_BRIDGE"]),
          ...(!source.shadowEvaluationEligible ||
          !target.shadowEvaluationEligible
            ? ["INCIDENT_TO_EXPLICIT_RESIDUAL"]
            : []),
          ...(map.mode === "D2_RELAXED_DIAGNOSTIC_ONLY"
            ? ["DIAGNOSTIC_ONLY_NOT_ROUTE_ELIGIBLE"]
            : []),
        ]),
      };
      return [{ ...body, semanticHash: hash(body) }];
    })
    .sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  return c61211CutsSchema.parse(
    c61211Artifact("c6-1-2-1-1-cut-edge-ledger", {
      mode: map.mode,
      partitionMapHash: map.semanticHash,
      rows,
      independentCutOverlapSeconds: duration(
        rows.flatMap((r) => r.overlapIntervals),
      ),
      unsafeCutCount: rows.filter((r) => !r.cutAllowed).length,
      strongBridgeCutCount: rows.filter((r) => r.strongBridge).length,
    }),
  );
}
export function auditC61211Residuals(
  map: C61211Map,
  relaxed: C61211Map | null = null,
) {
  const recovered = new Set(
    relaxed?.blocks
      .filter((b) => b.shadowEvaluationEligible)
      .flatMap((b) => [...b.machineGroupIds, ...b.goldCueIds]) ?? [],
  );
  return c61211ResidualsSchema.parse(
    c61211Artifact("c6-1-2-1-1-partition-residuals", {
      mode: map.mode,
      partitionMapHash: map.semanticHash,
      rows: map.blocks
        .filter((b) => b.assignmentCategory === "RESIDUAL_UNPARTITIONED")
        .map((b) => {
          const body = {
            residualBlockId: b.partitionBlockId,
            parentE2SupergroupId: b.parentE2SupergroupId,
            residualMachineGroupIds: b.machineGroupIds,
            residualProductionCueIds: b.machineCueIds,
            residualGoldCueIds: b.goldCueIds,
            residualEdgeIds: b.retainedEdgeIds,
            residualReasons: b.reasons,
            potentiallyRecoverableWithRelaxedPolicy: [
              ...b.machineGroupIds,
              ...b.goldCueIds,
            ].some((id) => recovered.has(id)),
          };
          return { ...body, semanticHash: hash(body) };
        }),
    }),
  );
}
export function auditC61211Conservation(
  input: C61211PartitionInput,
  map: C61211Map,
  graph: C61211Graph,
) {
  const inventory = (
    actual: readonly string[],
    expected: readonly string[],
  ) => ({
    duplicated: actual.length - new Set(actual).size,
    missing: expected.filter((id) => !actual.includes(id)).length,
    extra: unique(actual).filter((id) => !expected.includes(id)).length,
  });
  const machine = inventory(
    map.blocks.flatMap((b) => b.machineGroupIds),
    input.groups.map((g) => g.groupId),
  );
  const cues = inventory(
    map.blocks.flatMap((b) => b.machineCueIds),
    input.baselineCueOrder,
  );
  const gold = inventory(
    map.blocks.flatMap((b) => b.goldCueIds),
    input.goldTiming.map((c) => c.id),
  );
  const cuts = auditC61211Cuts(map, graph),
    rule = c61211Rule(map.mode);
  const accounted = [
    ...map.blocks.flatMap((b) => b.retainedEdgeIds),
    ...cuts.rows.map((r) => r.edgeId),
  ];
  let unaccountedEdgeCount = graph.edgeLedger.rows.filter(
    (e) => !accounted.includes(e.edgeId),
  ).length;
  unaccountedEdgeCount += unique(accounted).filter(
    (id) => !graph.edgeLedger.rows.some((e) => e.edgeId === id),
  ).length;
  // Counting is insufficient if an internal edge is attributed to the wrong block.
  unaccountedEdgeCount += map.blocks.reduce(
    (n, b) =>
      n +
      b.retainedEdgeIds.filter((id) => {
        const e = graph.edgeLedger.rows.find((e) => e.edgeId === id);
        return (
          !e ||
          !b.machineGroupIds.includes(e.machineGroupId) ||
          !b.goldCueIds.includes(e.goldCueId)
        );
      }).length,
    0,
  );
  let nonMonotonicPartitionCount = 0,
    retainedOverlapViolationCount = 0,
    cutLossViolationCount = 0;
  for (const parent of graph.map.groups) {
    const blocks = map.blocks
      .filter(
        (b) =>
          b.parentE2SupergroupId === parent.supergroupId &&
          b.shadowEvaluationEligible,
      )
      .toSorted(
        (a, b) =>
          c612Defined(a.machineIndexRange).start -
          c612Defined(b.machineIndexRange).start,
      );
    for (let i = 1; i < blocks.length; i++) {
      const a = c612Defined(blocks[i - 1]),
        b = c612Defined(blocks[i]);
      if (
        c612Defined(a.machineIndexRange).end >=
          c612Defined(b.machineIndexRange).start ||
        c612Defined(a.goldIndexRange).end >= c612Defined(b.goldIndexRange).start
      )
        nonMonotonicPartitionCount++;
    }
    const edges = graph.edgeLedger.rows.filter((e) =>
      parent.edgeIds.includes(e.edgeId),
    );
    const cutIds = new Set(
      cuts.rows
        .filter((e) => e.parentComponentId === parent.supergroupId)
        .map((e) => e.edgeId),
    );
    const original = duration(edges.flatMap((e) => e.overlapIntervals)),
      discarded = duration(
        edges
          .filter((e) => cutIds.has(e.edgeId))
          .flatMap((e) => e.overlapIntervals),
      );
    if (original && discarded / original > rule.maximumCutLoss)
      cutLossViolationCount++;
    for (const nodeEdges of [
      ...parent.machineGroupIds.map((id) =>
        edges.filter((e) => e.machineGroupId === id),
      ),
      ...parent.goldCueIds.map((id) => edges.filter((e) => e.goldCueId === id)),
    ]) {
      const total = duration(nodeEdges.flatMap((e) => e.overlapIntervals));
      const kept = duration(
        nodeEdges
          .filter((e) => !cutIds.has(e.edgeId))
          .flatMap((e) => e.overlapIntervals),
      );
      if (total && kept / total < rule.minimumNodeRetained)
        retainedOverlapViolationCount++;
    }
  }
  const crossFoldPartitionCount = map.blocks.filter((b) => {
    if (!b.shadowEvaluationEligible) return false;
    const folds = unique(
      input.folds.folds
        .filter((f) => b.machineGroupIds.some((id) => f.groupIds.includes(id)))
        .map((f) => f.foldId),
    );
    return (
      folds.length !== 1 ||
      folds[0] !== b.foldId ||
      b.machineGroupIds.some(
        (id) => !input.folds.folds.some((f) => f.groupIds.includes(id)),
      )
    );
  }).length;
  const numbers = {
    duplicatedMachineGroupCount: machine.duplicated,
    missingMachineGroupCount: machine.missing,
    extraMachineGroupCount: machine.extra,
    duplicatedProductionCueCount: cues.duplicated,
    missingProductionCueCount: cues.missing,
    extraProductionCueCount: cues.extra,
    duplicatedGoldCueCount: gold.duplicated,
    missingGoldCueCount: gold.missing,
    extraGoldCueCount: gold.extra,
    unaccountedEdgeCount,
    multiplyAccountedEdgeCount: accounted.length - new Set(accounted).size,
    unsafeCutCount: cuts.unsafeCutCount,
    strongBridgeCutCount: cuts.strongBridgeCutCount,
    nonMonotonicPartitionCount,
    crossFoldPartitionCount,
    retainedOverlapViolationCount,
    cutLossViolationCount,
  };
  return c61211ConservationSchema.parse(
    c61211Artifact("c6-1-2-1-1-partition-conservation-audit", {
      mode: map.mode,
      partitionMapHash: map.semanticHash,
      ...numbers,
      passed: Object.values(numbers).every((n) => n === 0),
      goldTextUsedForPartitionCount: 0,
      profileRematchingCount: 0,
    }),
  );
}
