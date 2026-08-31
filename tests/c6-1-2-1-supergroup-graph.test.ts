import { describe, expect, it } from "vitest";
import { c6121GoldTimingCueSchema } from "@mvl/shared";
import { c6121Fixture } from "./helpers/c6121-fixture.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
import {
  hash,
  validateC6121Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-recovery/c6121-policy.js";
import { bindGoldToFixedGroups } from "../packages/video-subtitler/src/consensus/top-k/fixed-group-evaluation.js";
import { buildC6121Supergroups } from "../packages/video-subtitler/src/consensus/evaluation-recovery/frozen-group-gold-bipartite-graph.js";
describe("C6.1.2.1 timing-only frozen-group graph", () => {
  it("preserves one-to-one groups, exact folds and unique error units", () => {
    const f = c6121Fixture(),
      before = hash([f.frozen.mapping, f.folds]);
    const g = f.graph();
    expect(g.integrity.oneToOne).toBe(10);
    expect(g.integrity.stableCandidateLabelCount).toBe(10);
    expect(g.integrity.duplicateGoldAssignmentCount).toBe(0);
    expect(g.integrity.duplicateMachineAssignmentCount).toBe(0);
    expect(hash([f.frozen.mapping, f.folds])).toBe(before);
    for (const value of Object.values(g))
      expect(() => validateC6121Artifact(value)).not.toThrow();
  });
  it("recovers two ambiguous machine groups joined by one whole Gold cue", () => {
    const f = c6121Fixture();
    Object.assign(c612Defined(f.production.cues[1]), { start: 3, end: 5 });
    const gold = [{ id: "whole", start: 1, end: 5, text: "synthetic target" }];
    const old = bindGoldToFixedGroups(
      f.frozen.mapping.groups,
      f.production,
      gold,
    );
    expect(
      old.filter((b) =>
        b.reasons.includes("GOLD_CUE_SPANS_MULTIPLE_FROZEN_MACHINE_GROUPS"),
      ),
    ).toHaveLength(2);
    const graph = f.graph(
      gold.map(({ id, start, end }) => ({ id, start, end })),
    );
    const group = c612Defined(
      graph.map.groups.find((g) => g.goldCueIds.includes("whole")),
    );
    expect(group.structuralStatus).toBe("FIXED_MANY_TO_ONE");
    expect(group.machineGroupIds).toHaveLength(2);
    expect(group.shadowEvaluationEligible).toBe(true);
    expect(group.oofTrainingEligible).toBe(true);
  });
  it("supports reverse segmentation one machine cue to two Gold cues", () => {
    const f = c6121Fixture();
    const g = f.graph([
      { id: "g1", start: 1, end: 2 },
      { id: "g2", start: 2, end: 3 },
    ]);
    expect(g.integrity.oneToMany).toBe(1);
  });
  it("supports many-to-many without creating duplicate edges", () => {
    const f = c6121Fixture();
    Object.assign(c612Defined(f.production.cues[1]), { start: 2, end: 4 });
    const g = f.graph([
      { id: "g1", start: 1, end: 2.5 },
      { id: "g2", start: 2.5, end: 4 },
    ]);
    expect(g.integrity.manyToMany).toBe(1);
    expect(
      new Set(g.edgeLedger.rows.map((e) => e.machineGroupId + e.goldCueId))
        .size,
    ).toBe(g.edgeLedger.rows.length);
    expect(
      g.map.groups.find((s) => s.goldCueIds.length)?.machineCoveredRatio,
    ).toBe(1);
  });
  it.each([
    { start: 3, end: 4 },
    { start: 0, end: 1 },
    { start: 200, end: 201 },
  ])("never connects zero-overlap boundary or distant Gold %j", (span) => {
    const g = c6121Fixture().graph([{ id: "g", ...span }]);
    expect(g.edgeLedger.rows).toHaveLength(0);
    expect(
      g.map.groups.some((s) => s.structuralStatus === "NO_MACHINE_MAPPING"),
    ).toBe(true);
  });
  it("does not use a machine-group hull as acoustic overlap", () => {
    const f = c6121Fixture(),
      first = c612Defined(
        f.frozen.mapping.groups.find((g) => g.cueIds.includes("cue-0")),
      ),
      second = c612Defined(
        f.frozen.mapping.groups.find((g) => g.cueIds.includes("cue-1")),
      );
    first.cueIds.push(...second.cueIds);
    first.eventIds.push(...second.eventIds);
    f.frozen.mapping.groups = f.frozen.mapping.groups.filter(
      (g) => g !== second,
    );
    const g = f.graph([{ id: "gap", start: 5, end: 6 }]);
    expect(g.edgeLedger.rows).toHaveLength(0);
  });
  it("rejects raw Gold text or extra fields in the builder DTO", () => {
    const f = c6121Fixture();
    expect(
      c6121GoldTimingCueSchema.safeParse({
        id: "g",
        start: 1,
        end: 3,
        text: "forbidden",
      }).success,
    ).toBe(false);
    expect(() =>
      f.graph([{ id: "g", start: 1, end: 3, text: "forbidden" } as never]),
    ).toThrow();
  });
  it("is invariant to Gold text changes and input node enumeration", () => {
    const f = c6121Fixture(),
      a = f.graph();
    const b = buildC6121Supergroups({
      groups: [...f.frozen.mapping.groups].reverse(),
      mappingHash: f.frozen.mapping.semanticHash,
      baselineCueOrder: f.production.cues.map((c) => c.id),
      production: f.production,
      universe: f.universe,
      folds: f.folds,
      goldTiming: f.timing().reverse(),
    });
    expect(b).toEqual(a);
    expect(
      f.graph(
        f
          .timing()
          .map((c, i) => ({ ...c, end: c.end + Number(i === 0) * 0.1 })),
      ).map.semanticHash,
    ).not.toBe(a.map.semanticHash);
  });
  it("excludes connected cross-fold components without rebuilding folds", () => {
    const f = c6121Fixture();
    Object.assign(c612Defined(f.production.cues[2]), { start: 3, end: 5 });
    // cue-0 and cue-2 remain in their original separate outer folds.
    const before = hash(f.folds),
      g = f.graph([{ id: "cross", start: 1, end: 5 }]);
    expect(g.integrity.crossFoldComponentCount).toBe(1);
    const c = c612Defined(
      g.map.groups.find((g) => g.goldCueIds.includes("cross")),
    );
    expect([
      c.shadowEvaluationEligible,
      c.candidateLabelEligible,
      c.oofTrainingEligible,
    ]).toEqual([false, false, false]);
    expect(hash(f.folds)).toBe(before);
  });
  it.each([
    "TEMPORAL_COMPONENT_DURATION_LIMIT",
    "TEMPORAL_BRIDGE_GAP_LIMIT",
    "TEMPORAL_COMPONENT_CUE_LIMIT",
    "STRUCTURE_INCOMPATIBLE",
    "NONCONTIGUOUS_MACHINE_CUES",
    "NONCONTIGUOUS_GOLD_CUES",
  ])("preserves the structural blocker %s", (reason) => {
    const f = c6121Fixture();
    let timing = f.timing();
    if (reason === "TEMPORAL_COMPONENT_DURATION_LIMIT")
      timing = [{ id: "long", start: 0, end: 40 }];
    if (reason === "TEMPORAL_BRIDGE_GAP_LIMIT")
      timing = [{ id: "gap", start: 1, end: 13 }];
    if (reason === "TEMPORAL_COMPONENT_CUE_LIMIT")
      timing = Array.from({ length: 9 }, (_, i) => ({
        id: "g" + String(i),
        start: 1 + i / 5,
        end: 1.2 + i / 5,
      }));
    if (reason === "STRUCTURE_INCOMPATIBLE")
      Object.assign(c612Defined(f.production.cues[0]), { end: 1 });
    if (reason === "NONCONTIGUOUS_MACHINE_CUES") {
      Object.assign(c612Defined(f.production.cues[0]), { start: 1, end: 10 });
      Object.assign(c612Defined(f.production.cues[1]), { start: 2, end: 3 });
      Object.assign(c612Defined(f.production.cues[2]), { start: 4, end: 5 });
      timing = [{ id: "g", start: 4, end: 5 }];
    }
    if (reason === "NONCONTIGUOUS_GOLD_CUES") {
      const a = c612Defined(
          f.frozen.mapping.groups.find((g) => g.cueIds.includes("cue-0")),
        ),
        b = c612Defined(
          f.frozen.mapping.groups.find((g) => g.cueIds.includes("cue-1")),
        );
      a.cueIds.push(...b.cueIds);
      a.eventIds.push(...b.eventIds);
      f.frozen.mapping.groups = f.frozen.mapping.groups.filter((g) => g !== b);
      timing = [
        { id: "a", start: 1, end: 3 },
        { id: "middle", start: 5, end: 6 },
        { id: "b", start: 11, end: 13 },
      ];
    }
    expect(
      f.graph(timing).map.groups.some((g) => g.reasons.includes(reason)),
    ).toBe(true);
  });
  it("separates stable shadow structure from ambiguous event lineage", () => {
    const f = c6121Fixture();
    c612Defined(f.universe.events[0]).finalSpan = null;
    const g = c612Defined(
      f.graph().map.groups.find((g) => g.machineCueIds.includes("cue-0")),
    );
    expect(g.shadowEvaluationEligible).toBe(true);
    expect(g.candidateLabelEligible).toBe(false);
    expect(g.oofTrainingEligible).toBe(false);
  });
  it("rejects duplicate Gold IDs and non-partitioned machine cues", () => {
    const f = c6121Fixture();
    expect(() =>
      f.graph([c612Defined(f.timing()[0]), c612Defined(f.timing()[0])]),
    ).toThrow("DUPLICATE_GOLD_ID");
    c612Defined(f.frozen.mapping.groups[0]).cueIds.push("cue-0");
    expect(() => f.graph()).toThrow("CUE_PARTITION_INVALID");
  });
});
