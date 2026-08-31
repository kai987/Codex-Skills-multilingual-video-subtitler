import { describe, expect, it } from "vitest";
import { c61211GeneratedSchemas, c61211PolicySchema } from "@mvl/shared";
import { c61211Fixture } from "./helpers/c61211-fixture.js";
import {
  inventoryC61211,
  orderedC61211Groups,
  candidateC61211Block,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/component-inventory.js";
import {
  C61211_POLICY,
  C61211_POLICY_HASH,
  C61211_PARTITION_POLICY,
  C61211_COVERAGE_POLICY,
  C61211_ROUTE_POLICY,
  hash,
  c61211Artifact,
  validateC61211Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
describe("C6.1.2.1.1 pre-text inventory and immutable policy", () => {
  it("freezes all three policies and registers distinct strict schemas", () => {
    const value = c61211PolicySchema.parse(
      c61211Artifact("c6-1-2-1-1-policy-freeze", {
        serializedDefinition: JSON.stringify(C61211_POLICY),
        definitionHash: C61211_POLICY_HASH,
        partitionPolicyHash: hash(C61211_PARTITION_POLICY),
        coveragePolicyHash: hash(C61211_COVERAGE_POLICY),
        routePolicyHash: hash(C61211_ROUTE_POLICY),
        frozenBeforeGoldText: true,
        primaryEvaluator: C61211_POLICY.primaryEvaluator,
      }),
    );
    expect(() => validateC61211Artifact(value)).not.toThrow();
    expect(() =>
      validateC61211Artifact({ ...value, policyHash: "0".repeat(64) }),
    ).toThrow();
    expect(() =>
      validateC61211Artifact({ ...value, text: "forbidden" }),
    ).toThrow();
    expect(c61211GeneratedSchemas.length).toBeGreaterThanOrEqual(28);
    expect(new Set(c61211GeneratedSchemas.map(([name]) => name)).size).toBe(
      c61211GeneratedSchemas.length,
    );
  });
  it("never changes already bounded E2 components", () => {
    const f = c61211Fixture(),
      graph = f.graph(),
      inventory = inventoryC61211(f.input, graph);
    expect(inventory.rows.filter((r) => r.alreadyBounded)).toHaveLength(10);
    expect(inventory.rows.filter((r) => r.attempted)).toHaveLength(0);
    expect(inventory.e2Edges).toEqual(graph.edgeLedger.rows);
    expect(() => validateC61211Artifact(inventory)).not.toThrow();
  });
  it("orders atomic groups by original cue indexes instead of input file order", () => {
    const f = c61211Fixture();
    expect(
      orderedC61211Groups({
        ...f.input,
        groups: [...f.input.groups].reverse(),
      }).map((g) => g.cueIds[0]),
    ).toEqual(f.input.baselineCueOrder);
  });
  it("enumerates a legal block without losing candidate and fold eligibility", () => {
    const f = c61211Fixture(),
      graph = f.graph(),
      parent = graph.map.groups[0]!;
    const block = candidateC61211Block(
      f.input,
      graph,
      parent,
      parent.machineGroupIds,
      parent.goldCueIds,
      "D1_CONSERVATIVE_MONOTONIC",
    );
    expect(block.shadowEvaluationEligible).toBe(true);
    expect(block.oofTrainingEligible).toBe(true);
    expect(block.minimumNodeRetainedOverlapRatio).toBe(1);
    expect(block.cutEdgeIds).toEqual([]);
    expect(block.machineCueIds).toEqual(parent.machineCueIds);
  });
  it("rejects Gold text even if supplied by an untyped caller", () => {
    const f = c61211Fixture();
    expect(() =>
      inventoryC61211({
        ...f.input,
        goldTiming: f.input.goldTiming.map((c) => ({ ...c, text: "illegal" })),
      }),
    ).toThrow();
  });
  it("preserves low-coverage and isolated vertices, without nearest-time binding", () => {
    const f = c61211Fixture();
    const i = inventoryC61211({
      ...f.input,
      goldTiming: [
        { id: "low", start: 2.9, end: 6 },
        { id: "isolated", start: 201, end: 202 },
      ],
    });
    expect(i.rows.filter((r) => r.pureLowCoverage)).toHaveLength(1);
    expect(i.rows.filter((r) => !r.machineGroupIds.length)).toHaveLength(1);
    expect(i.rows.flatMap((r) => r.goldCueIds)).toHaveLength(2);
  });
  it("uses independent interval unions, not overlapping edge sums", () => {
    const f = c61211Fixture();
    f.input.goldTiming = [
      { id: "one", start: 1, end: 3 },
      { id: "two", start: 1, end: 3 },
    ];
    const graph = inventoryC61211(f.input),
      parentGraph = f.graph(f.input.goldTiming);
    const parent = parentGraph.map.groups.find(
      (g) => g.goldCueIds.length === 2,
    )!;
    const block = candidateC61211Block(
      f.input,
      parentGraph,
      parent,
      parent.machineGroupIds,
      parent.goldCueIds,
      "D1_CONSERVATIVE_MONOTONIC",
    );
    expect(graph.e2Edges).toHaveLength(2);
    expect(
      block.nodeRetainedOverlap.find((n) => n.side === "MACHINE")
        ?.originalSeconds,
    ).toBe(2);
    expect(block.machineCoveredRatio).toBe(1);
    expect(block.goldCoveredRatio).toBe(1);
  });
});
