import {
  c61211CandidatesSchema,
  c61211MapSchema,
  type c61211PartitionStatusSchema,
  type C61211Block,
  type C61211Mode,
  type C61211Objective,
  type C6121Supergroup,
} from "@mvl/shared";
import type { z } from "zod";
import {
  duration,
  unionIntervals,
  type Interval,
} from "../top-k/c612-structural.js";
import { c612Defined } from "../top-k/c612-policy.js";
import { buildC6121Supergroups } from "../evaluation-recovery/frozen-group-gold-bipartite-graph.js";
import { c61211Artifact, c61211Rule, demand, hash } from "./c61211-policy.js";
import {
  inventoryC61211,
  orderedC61211Groups,
  candidateC61211Block,
  unique,
  type C61211PartitionInput,
  type C61211Graph,
} from "./component-inventory.js";

/** Negative means a wins. All eight objectives are frozen and score-free. */
export function compareC61211Objectives(
  a: C61211Objective,
  b: C61211Objective,
) {
  return (
    b.retainedOverlapSeconds - a.retainedOverlapSeconds ||
    b.candidateReachableMachineGroups - a.candidateReachableMachineGroups ||
    b.productionCueCount - a.productionCueCount ||
    b.interventionReachableGoldCues - a.interventionReachableGoldCues ||
    a.discardedOverlapSeconds - b.discardedOverlapSeconds ||
    a.residualBilateralNodes - b.residualBilateralNodes ||
    a.blockCount - b.blockCount ||
    a.deterministicPathHash.localeCompare(b.deterministicPathHash)
  );
}
interface SearchState {
  nextMachineIndex: number;
  nextGoldIndex: number;
  retainedOverlap: Interval[];
  discardedOverlap: Interval[];
  residualMachineNodes: string[];
  residualGoldNodes: string[];
  blockCount: number;
  deterministicPathHash: string;
  blocks: C61211Block[];
}
type Status = z.infer<typeof c61211PartitionStatusSchema>;
function statusWithoutSolution(
  parent: C6121Supergroup,
  candidates: readonly C61211Block[],
): Status {
  if (!parent.machineGroupIds.length) return "GOLD_ONLY_UNREACHABLE";
  if (!parent.goldCueIds.length) return "MACHINE_ONLY_NO_GOLD_BINDING";
  if (parent.frozenFoldIds.length !== 1 || !parent.foldId)
    return "CROSS_FOLD_BLOCKED";
  // Strong bridges are causal only when a range otherwise satisfies the original geometry.
  if (
    candidates.some(
      (b) =>
        b.reasons.includes("STRONG_ALIGNMENT_BRIDGE") &&
        b.reasons.every((r) =>
          [
            "STRONG_ALIGNMENT_BRIDGE",
            "UNSAFE_CUT_BRIDGE",
            "NODE_RETAINED_OVERLAP_LIMIT",
            "COMPONENT_CUT_LOSS_LIMIT",
          ].includes(r),
        ),
    )
  )
    return "UNSPLITTABLE_STRONG_BRIDGE";
  if (parent.reasons.includes("TEMPORAL_COMPONENT_CUE_LIMIT"))
    return "UNSPLITTABLE_CUE_LIMIT";
  if (parent.reasons.includes("TEMPORAL_COMPONENT_DURATION_LIMIT"))
    return "UNSPLITTABLE_DURATION_LIMIT";
  if (parent.reasons.includes("TEMPORAL_BRIDGE_GAP_LIMIT"))
    return "UNSPLITTABLE_GAP_LIMIT";
  if (parent.reasons.includes("INSUFFICIENT_BIDIRECTIONAL_COVERAGE"))
    return "UNSPLITTABLE_COVERAGE";
  return "NO_VALID_MONOTONIC_PARTITION";
}
export function enumerateC61211Blocks(
  input: C61211PartitionInput,
  graph: C61211Graph,
  parent: C6121Supergroup,
  mode: C61211Mode,
) {
  const machines = orderedC61211Groups(input).filter((g) =>
    parent.machineGroupIds.includes(g.groupId),
  );
  const gold = graph.map.goldCueOrder.filter((id) =>
    parent.goldCueIds.includes(id),
  );
  if (!machines.length || !gold.length) return [];
  if (parent.shadowEvaluationEligible)
    return [
      candidateC61211Block(
        input,
        graph,
        parent,
        machines.map((g) => g.groupId),
        gold,
        mode,
      ),
    ];
  const result: C61211Block[] = [];
  for (let a = 0; a < machines.length; a++)
    for (let b = a; b < machines.length; b++) {
      const ms = machines.slice(a, b + 1).map((g) => g.groupId);
      for (let c = 0; c < gold.length; c++)
        for (let d = c; d < gold.length; d++) {
          const gs = gold.slice(c, d + 1);
          if (
            !graph.edgeLedger.rows.some(
              (e) => ms.includes(e.machineGroupId) && gs.includes(e.goldCueId),
            )
          )
            continue;
          result.push(candidateC61211Block(input, graph, parent, ms, gs, mode));
        }
    }
  return result.sort((a, b) =>
    a.partitionBlockId.localeCompare(b.partitionBlockId),
  );
}

/** Exact exhaustive search over a finite monotone interval DAG. Unlike a greedy
 * splitter or an additive-score DP it keeps union-valued overlap and all residual
 * identities. No lossy dominance pruning: a prefix hash does not order terminal
 * SHA tie-breaks, and overlap/cut union is not an additive scalar reward. */
export function solveC61211Component(
  input: C61211PartitionInput,
  graph: C61211Graph,
  parent: C6121Supergroup,
  candidates: readonly C61211Block[],
  mode: C61211Mode,
) {
  const edges = graph.edgeLedger.rows.filter((e) =>
    parent.edgeIds.includes(e.edgeId),
  );
  const originalEdgeSeconds = duration(
      edges.flatMap((e) => e.overlapIntervals),
    ),
    rule = c61211Rule(mode);
  const valid = candidates
    .filter((b) => b.shadowEvaluationEligible)
    .toSorted(
      (a, b) =>
        c612Defined(a.machineIndexRange).start -
          c612Defined(b.machineIndexRange).start ||
        c612Defined(a.goldIndexRange).start -
          c612Defined(b.goldIndexRange).start ||
        a.partitionBlockId.localeCompare(b.partitionBlockId),
    );
  const makeState = (blocks: C61211Block[]): SearchState => {
    const ms = new Set(blocks.flatMap((b) => b.machineGroupIds)),
      gs = new Set(blocks.flatMap((b) => b.goldCueIds));
    const retainedIds = new Set(blocks.flatMap((b) => b.retainedEdgeIds)),
      cutIds = new Set(blocks.flatMap((b) => b.cutEdgeIds));
    return {
      nextMachineIndex: blocks.length
        ? c612Defined(c612Defined(blocks.at(-1)).machineIndexRange).end + 1
        : 0,
      nextGoldIndex: blocks.length
        ? c612Defined(c612Defined(blocks.at(-1)).goldIndexRange).end + 1
        : 0,
      retainedOverlap: unionIntervals(
        edges
          .filter((e) => retainedIds.has(e.edgeId))
          .flatMap((e) => e.overlapIntervals),
      ),
      discardedOverlap: unionIntervals(
        edges
          .filter((e) => cutIds.has(e.edgeId))
          .flatMap((e) => e.overlapIntervals),
      ),
      residualMachineNodes: parent.machineGroupIds.filter((id) => !ms.has(id)),
      residualGoldNodes: parent.goldCueIds.filter((id) => !gs.has(id)),
      blockCount: blocks.length,
      deterministicPathHash: hash(blocks.map((b) => b.partitionBlockId)),
      blocks,
    };
  };
  const objective = (state: SearchState): C61211Objective => ({
    retainedOverlapSeconds: duration(state.retainedOverlap),
    candidateReachableMachineGroups: unique(
      state.blocks.flatMap((b) => b.machineGroupIds),
    ).filter((id) => input.candidateReachableMachineGroupIds.includes(id))
      .length,
    productionCueCount: unique(state.blocks.flatMap((b) => b.machineCueIds))
      .length,
    interventionReachableGoldCues: unique(
      state.blocks.flatMap((b) => b.goldCueIds),
    ).length,
    discardedOverlapSeconds: duration(state.discardedOverlap),
    residualBilateralNodes:
      state.residualMachineNodes.length + state.residualGoldNodes.length,
    blockCount: state.blockCount,
    deterministicPathHash: state.deterministicPathHash,
  });
  let best = makeState([]),
    bestObjective = objective(best),
    visitedStates = 0;
  const residualRetained = (state: SearchState) => {
    const cuts = new Set(state.blocks.flatMap((b) => b.cutEdgeIds));
    const nodes = [
      ...state.residualMachineNodes.map((id) =>
        edges.filter((e) => e.machineGroupId === id),
      ),
      ...state.residualGoldNodes.map((id) =>
        edges.filter((e) => e.goldCueId === id),
      ),
    ];
    return Math.min(
      1,
      ...nodes.map((all) => {
        const total = duration(all.flatMap((e) => e.overlapIntervals));
        return total
          ? duration(
              all
                .filter((e) => !cuts.has(e.edgeId))
                .flatMap((e) => e.overlapIntervals),
            ) / total
          : 1;
      }),
    );
  };
  const visit = (state: SearchState) => {
    visitedStates++;
    const candidateObjective = objective(state);
    if (
      originalEdgeSeconds &&
      candidateObjective.discardedOverlapSeconds / originalEdgeSeconds >
        rule.maximumCutLoss
    )
      return;
    if (
      residualRetained(state) >= rule.minimumNodeRetained &&
      compareC61211Objectives(candidateObjective, bestObjective) < 0
    ) {
      best = state;
      bestObjective = candidateObjective;
    }
    for (const block of valid) {
      if (
        c612Defined(block.machineIndexRange).start < state.nextMachineIndex ||
        c612Defined(block.goldIndexRange).start < state.nextGoldIndex
      )
        continue;
      visit(makeState([...state.blocks, block]));
    }
  };
  if (parent.shadowEvaluationEligible) {
    demand(valid.length === 1, "C61211_ALREADY_BOUNDED_CHANGED");
    best = makeState([c612Defined(valid[0])]);
    bestObjective = objective(best);
    visitedStates = 1;
  } else visit(best);
  const componentDiscardedOverlapRatio = originalEdgeSeconds
    ? bestObjective.discardedOverlapSeconds / originalEdgeSeconds
    : 0;
  const selected = best.blocks.map((b) => {
    const body = { ...b, componentDiscardedOverlapRatio };
    const { semanticHash, ...content } = body;
    void semanticHash;
    return { ...content, semanticHash: hash(content) };
  });
  const status: Status = parent.shadowEvaluationEligible
    ? "ALREADY_BOUNDED"
    : best.blocks.length
      ? best.residualMachineNodes.length + best.residualGoldNodes.length
        ? "PARTIALLY_PARTITIONED_WITH_RESIDUAL"
        : "FULLY_PARTITIONED"
      : statusWithoutSolution(parent, candidates);
  const residuals: C61211Block[] = [];
  if (best.residualMachineNodes.length || best.residualGoldNodes.length) {
    const raw = candidateC61211Block(
      input,
      graph,
      parent,
      best.residualMachineNodes,
      best.residualGoldNodes,
      mode,
    );
    const { semanticHash, ...content } = raw;
    void semanticHash;
    const category = !parent.machineGroupIds.length
      ? ("GOLD_ONLY" as const)
      : !parent.goldCueIds.length
        ? ("MACHINE_ONLY" as const)
        : ("RESIDUAL_UNPARTITIONED" as const);
    const reasons = unique([
      ...parent.reasons,
      status,
      ...(parent.machineGroupCount === 1 &&
      parent.goldCueCount === 1 &&
      status === "UNSPLITTABLE_COVERAGE"
        ? ["UNPARTITIONABLE_LOW_COVERAGE"]
        : []),
    ]);
    const body: Omit<C61211Block, "semanticHash"> = {
      ...content,
      partitionBlockId: raw.partitionBlockId.replace(
        "c61211-block:",
        "c61211-residual:",
      ),
      assignmentCategory: category,
      structuralStatus:
        category === "GOLD_ONLY"
          ? "GOLD_ONLY_UNREACHABLE"
          : category === "MACHINE_ONLY"
            ? "MACHINE_ONLY_NO_GOLD_BINDING"
            : "RESIDUAL_UNPARTITIONED",
      shadowEvaluationEligible: false,
      candidateLabelEligible: false,
      oofTrainingEligible: false,
      candidateEligibleEventIds: [],
      candidateAmbiguousEventIds: raw.machineEventIds,
      componentDiscardedOverlapRatio,
      reasons,
    };
    residuals.push({ ...body, semanticHash: hash(body) });
  }
  return {
    blocks: [...selected, ...residuals],
    component: {
      parentE2SupergroupId: parent.supergroupId,
      status,
      partitionBlockIds: selected.map((b) => b.partitionBlockId),
      residualBlockIds: residuals.map((b) => b.partitionBlockId),
      originalEdgeSeconds,
      cutOverlapSeconds: bestObjective.discardedOverlapSeconds,
      componentDiscardedOverlapRatio,
      minimumNodeRetainedOverlapRatio: Math.min(
        1,
        ...[...selected, ...residuals].map(
          (b) => b.minimumNodeRetainedOverlapRatio,
        ),
      ),
      objective: bestObjective,
      visitedStates,
      solver: "EXACT_MONOTONE_INTERVAL_DAG_ENUMERATION" as const,
      optimalityProven: true as const,
      reasons: parent.shadowEvaluationEligible
        ? ["PRESERVE_ORIGINAL_E2_BOUNDED_COMPONENT"]
        : unique([status, ...parent.reasons]),
    },
  };
}
export function partitionC61211(
  input: C61211PartitionInput,
  mode: C61211Mode = "D1_CONSERVATIVE_MONOTONIC",
) {
  const graph = buildC6121Supergroups(input),
    inventory = inventoryC61211(input, graph);
  const rows = graph.map.groups
    .flatMap((parent) => enumerateC61211Blocks(input, graph, parent, mode))
    .sort((a, b) => a.partitionBlockId.localeCompare(b.partitionBlockId));
  const candidates = c61211CandidatesSchema.parse(
    c61211Artifact("c6-1-2-1-1-partition-candidate-blocks", {
      mode,
      inventoryHash: inventory.semanticHash,
      rows: rows.map((block) => ({
        block,
        valid: block.shadowEvaluationEligible,
        rejectionReasons: block.reasons,
      })),
      candidateBlockCount: rows.length,
      validCandidateBlockCount: rows.filter((b) => b.shadowEvaluationEligible)
        .length,
      goldTextUsedForPartitionCount: 0,
    }),
  );
  const solved = graph.map.groups
    .toSorted((a, b) => a.supergroupId.localeCompare(b.supergroupId))
    .map((parent) =>
      solveC61211Component(
        input,
        graph,
        parent,
        rows.filter((b) => b.parentE2SupergroupId === parent.supergroupId),
        mode,
      ),
    );
  const map = c61211MapSchema.parse(
    c61211Artifact("c6-1-2-1-1-partitioned-supergroup-map", {
      mode,
      e2MapHash: graph.map.semanticHash,
      inventoryHash: inventory.semanticHash,
      candidateBlocksHash: candidates.semanticHash,
      machineMappingHash: input.mappingHash,
      foldHash: input.folds.semanticHash,
      goldTimingHash: graph.map.goldTimingHash,
      edgeLedgerHash: graph.edgeLedger.semanticHash,
      baselineCueOrder: input.baselineCueOrder,
      goldCueOrder: graph.map.goldCueOrder,
      blocks: solved.flatMap((s) => s.blocks),
      components: solved.map((s) => s.component),
      goldTextUsedForPartitionCount: 0,
      profileRematchingCount: 0,
    }),
  );
  return { graph, inventory, candidates, map };
}
