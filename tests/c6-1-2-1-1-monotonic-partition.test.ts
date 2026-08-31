import { describe, expect, it } from "vitest";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import type { C61211Objective } from "@mvl/shared";
import {
  c61211Fixture,
  c61211Geometry,
  c61211WeakChain,
} from "./helpers/c61211-fixture.js";
import {
  partitionC61211,
  compareC61211Objectives,
  solveC61211Component,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import {
  auditC61211Conservation,
  auditC61211Cuts,
  auditC61211Residuals,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-audits.js";
import {
  hash,
  validateC61211Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
describe("C6.1.2.1.1 exact constrained monotone partition", () => {
  it("partitions twelve machine cues and seven Gold cues into two safe blocks", () => {
    const f = c61211WeakChain(),
      p = partitionC61211(f.input);
    expect(p.graph.map.groups).toHaveLength(1);
    expect(p.graph.map.groups[0]?.reasons).toContain(
      "TEMPORAL_COMPONENT_CUE_LIMIT",
    );
    expect(p.map.components[0]?.status).toBe("FULLY_PARTITIONED");
    expect(p.map.blocks.filter((b) => b.shadowEvaluationEligible)).toHaveLength(
      2,
    );
    expect(
      p.map.blocks.every((b) => b.machineCueCount <= 8 && b.goldCueCount <= 8),
    ).toBe(true);
    const audit = auditC61211Conservation(f.input, p.map, p.graph),
      cut = auditC61211Cuts(p.map, p.graph);
    expect(audit.passed).toBe(true);
    expect(cut.rows).toHaveLength(1);
    expect(cut.independentCutOverlapSeconds).toBeCloseTo(0.05);
    expect(cut.rows[0]?.strongBridge).toBe(false);
    expect(
      p.map.components[0]?.minimumNodeRetainedOverlapRatio,
    ).toBeGreaterThanOrEqual(0.8);
    for (const value of [
      p.map,
      p.candidates,
      cut,
      audit,
      auditC61211Residuals(p.map),
    ])
      expect(() => validateC61211Artifact(value)).not.toThrow();
  });
  it("never cuts a Gold cue strongly linked to both atomic machine groups", () => {
    const f = c61211Geometry(
      Array.from({ length: 12 }, () => ({ start: 0, end: 2 })),
      [{ start: 0, end: 2 }],
    );
    const groups = f.input.groups.slice(0, 2).map((g, i) => ({
      ...g,
      cueIds: f.input.baselineCueOrder.slice(i * 6, i * 6 + 6),
      eventIds: f.universe.events.slice(i * 6, i * 6 + 6).map((e) => e.eventId),
    }));
    f.input.groups = groups;
    c612Defined(f.input.folds.folds[0]).groupIds = groups.map((g) => g.groupId);
    const p = partitionC61211(f.input);
    expect(p.map.components[0]?.status).toBe("UNSPLITTABLE_STRONG_BRIDGE");
    expect(p.map.blocks.filter((b) => b.shadowEvaluationEligible)).toHaveLength(
      0,
    );
    expect(auditC61211Cuts(p.map, p.graph).rows).toHaveLength(0);
    expect(auditC61211Conservation(f.input, p.map, p.graph).passed).toBe(true);
  });
  it("recovers a safe left block while conserving a low-coverage right residual", () => {
    const f = c61211Geometry(
      [
        { start: 0, end: 2 },
        { start: 2, end: 7 },
      ],
      [
        { start: 0, end: 2.01 },
        { start: 6.5, end: 7 },
      ],
    );
    const p = partitionC61211(f.input),
      residual = auditC61211Residuals(p.map);
    expect(p.map.components[0]?.status).toBe(
      "PARTIALLY_PARTITIONED_WITH_RESIDUAL",
    );
    expect(p.map.blocks.filter((b) => b.shadowEvaluationEligible)).toHaveLength(
      1,
    );
    expect(residual.rows).toHaveLength(1);
    expect(residual.rows[0]?.residualMachineGroupIds).toHaveLength(1);
    expect(residual.rows[0]?.residualGoldCueIds).toHaveLength(1);
    expect(auditC61211Conservation(f.input, p.map, p.graph).passed).toBe(true);
  });
  it("never force-binds Gold-only vertices and keeps machine-only vertices", () => {
    const f = c61211Geometry([{ start: 0, end: 2 }], [{ start: 5, end: 7 }]),
      p = partitionC61211(f.input);
    expect(p.map.blocks.map((b) => b.assignmentCategory).sort()).toEqual([
      "GOLD_ONLY",
      "MACHINE_ONLY",
    ]);
    expect(auditC61211Conservation(f.input, p.map, p.graph).passed).toBe(true);
  });
  it("rejects a connected cross-fold parent without repartitioning folds", () => {
    const f = c61211Geometry(
      [
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ],
      [{ start: 0, end: 4 }],
    );
    f.input.folds.folds = f.input.groups.map((g, i) => ({
      ...c612Defined(f.input.folds.folds[0]),
      foldId: "cross-" + String(i),
      groupIds: [g.groupId],
      eventIds: g.eventIds,
    }));
    const before = hash(f.input.folds),
      p = partitionC61211(f.input);
    expect(p.map.components[0]?.status).toBe("CROSS_FOLD_BLOCKED");
    expect(
      p.map.blocks.every(
        (b) => !b.oofTrainingEligible && !b.shadowEvaluationEligible,
      ),
    ).toBe(true);
    expect(hash(f.input.folds)).toBe(before);
  });
  it("keeps single-machine single-Gold low coverage explicitly unpartitionable", () => {
    const f = c61211Geometry([{ start: 0, end: 2 }], [{ start: 1.9, end: 6 }]),
      p = partitionC61211(f.input);
    expect(p.map.blocks[0]?.reasons).toContain("UNPARTITIONABLE_LOW_COVERAGE");
  });
  it("D0 is a no-cut lower bound and D2 remains separately labelled diagnostic", () => {
    const f = c61211WeakChain(),
      d0 = partitionC61211(f.input, "D0_NO_CUT"),
      d1 = partitionC61211(f.input),
      d2 = partitionC61211(f.input, "D2_RELAXED_DIAGNOSTIC_ONLY");
    expect(
      d0.map.blocks.filter((b) => b.shadowEvaluationEligible),
    ).toHaveLength(0);
    expect(auditC61211Cuts(d0.map, d0.graph).rows).toHaveLength(0);
    expect(
      d1.map.blocks.filter((b) => b.shadowEvaluationEligible),
    ).toHaveLength(2);
    expect(d2.map.mode).toBe("D2_RELAXED_DIAGNOSTIC_ONLY");
    expect(d2.map.semanticHash).not.toBe(d1.map.semanticHash);
  });
  it("retains bounded components exactly and does not split them to inflate counts", () => {
    const f = c61211Fixture(),
      p = partitionC61211(f.input);
    expect(
      p.map.components.every(
        (c) =>
          c.status === "ALREADY_BOUNDED" && c.partitionBlockIds.length === 1,
      ),
    ).toBe(true);
    for (const group of p.graph.map.groups)
      expect(
        p.map.blocks.find((b) => b.parentE2SupergroupId === group.supergroupId)
          ?.machineCueIds,
      ).toEqual(group.machineCueIds);
  });
  it("is deterministic for reversed machine, Gold and candidate enumeration", () => {
    const f = c61211WeakChain(),
      p = partitionC61211(f.input);
    const reversed = partitionC61211({
      ...f.input,
      groups: [...f.input.groups].reverse(),
      goldTiming: [...f.input.goldTiming].reverse(),
      candidateReachableMachineGroupIds: [
        ...f.input.candidateReachableMachineGroupIds,
      ].reverse(),
    });
    expect(reversed.map).toEqual(p.map);
    expect(reversed.candidates).toEqual(p.candidates);
    const parent = c612Defined(p.graph.map.groups[0]);
    const reversedSolution = solveC61211Component(
      f.input,
      p.graph,
      parent,
      p.candidates.rows.map((r) => r.block).reverse(),
      p.map.mode,
    );
    expect(reversedSolution.component).toEqual(p.map.components[0]);
    const edgePermutation = {
      ...p.graph,
      edgeLedger: {
        ...p.graph.edgeLedger,
        rows: [...p.graph.edgeLedger.rows].reverse(),
      },
    };
    expect(
      solveC61211Component(
        f.input,
        edgePermutation,
        parent,
        p.candidates.rows.map((r) => r.block).reverse(),
        p.map.mode,
      ).component,
    ).toEqual(p.map.components[0]);
  });
  it("is invariant to Gold text changes by rejecting text at its DTO boundary", () => {
    const f = c61211WeakChain(),
      a = partitionC61211(f.input);
    const textA = f.input.goldTiming.map((c) => ({ ...c, text: "one" })),
      textB = textA.map((c) => ({ ...c, text: "entirely changed" }));
    const timing = (rows: typeof textA) =>
      rows.map(({ id, start, end }) => ({ id, start, end }));
    expect(
      partitionC61211({ ...f.input, goldTiming: timing(textA) }).map
        .semanticHash,
    ).toBe(a.map.semanticHash);
    expect(
      partitionC61211({ ...f.input, goldTiming: timing(textB) }).map
        .semanticHash,
    ).toBe(a.map.semanticHash);
    expect(() => partitionC61211({ ...f.input, goldTiming: textA })).toThrow();
  });
  it("recomputes partitions after timing changes instead of text-based rematching", () => {
    const f = c61211WeakChain(),
      a = partitionC61211(f.input);
    const changed = partitionC61211({
      ...f.input,
      goldTiming: f.input.goldTiming.map((g, i) => ({
        ...g,
        end: g.end + (i === 0 ? 0.2 : 0),
      })),
    });
    expect(changed.map.semanticHash).not.toBe(a.map.semanticHash);
  });
  it.each(["machineGroupIds", "machineCueIds", "goldCueIds"] as const)(
    "detects duplicated and missing %s",
    (key) => {
      const f = c61211WeakChain(),
        p = partitionC61211(f.input),
        bad = structuredClone(p.map);
      const first = c612Defined(bad.blocks[0]),
        second = c612Defined(bad.blocks[1]);
      const id = c612Defined(first[key][0]);
      second[key].push(id);
      expect(auditC61211Conservation(f.input, bad, p.graph).passed).toBe(false);
      second[key].pop();
      first[key].shift();
      expect(auditC61211Conservation(f.input, bad, p.graph).passed).toBe(false);
    },
  );
  it("detects an unaccounted internal edge", () => {
    const f = c61211WeakChain(),
      p = partitionC61211(f.input),
      bad = structuredClone(p.map);
    c612Defined(bad.blocks[0]).retainedEdgeIds.shift();
    expect(
      auditC61211Conservation(f.input, bad, p.graph).unaccountedEdgeCount,
    ).toBe(1);
  });
  it("detects reversed or overlapping Gold allocation ranges", () => {
    const f = c61211WeakChain(),
      p = partitionC61211(f.input),
      bad = structuredClone(p.map);
    c612Defined(c612Defined(bad.blocks[1]).goldIndexRange).start = 0;
    expect(
      auditC61211Conservation(f.input, bad, p.graph).nonMonotonicPartitionCount,
    ).toBe(1);
  });
  const baseline: C61211Objective = {
    retainedOverlapSeconds: 10,
    candidateReachableMachineGroups: 4,
    productionCueCount: 5,
    interventionReachableGoldCues: 4,
    discardedOverlapSeconds: 0.1,
    residualBilateralNodes: 2,
    blockCount: 2,
    deterministicPathHash: "b".repeat(64),
  };
  it.each([
    ["retainedOverlapSeconds", 11],
    ["candidateReachableMachineGroups", 5],
    ["productionCueCount", 6],
    ["interventionReachableGoldCues", 5],
    ["discardedOverlapSeconds", 0],
    ["residualBilateralNodes", 1],
    ["blockCount", 1],
    ["deterministicPathHash", "a".repeat(64)],
  ] as const)("honors lexicographic objective %s", (key, value) => {
    const candidate = { ...baseline, [key]: value };
    expect(compareC61211Objectives(candidate, baseline)).toBeLessThan(0);
    expect(compareC61211Objectives(baseline, candidate)).toBeGreaterThan(0);
    const worseEarlier = { ...candidate, retainedOverlapSeconds: 9 };
    if (key !== "retainedOverlapSeconds")
      expect(compareC61211Objectives(worseEarlier, baseline)).toBeGreaterThan(
        0,
      );
  });
});
