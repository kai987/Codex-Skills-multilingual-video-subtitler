import { describe, expect, it } from "vitest";
import { c61211Fixture } from "./helpers/c61211-fixture.js";
import { partitionC61211 } from "../packages/video-subtitler/src/consensus/evaluation-partition/monotonic-partition-solver.js";
import { auditC61211Conservation } from "../packages/video-subtitler/src/consensus/evaluation-partition/partition-audits.js";
import {
  candidateC61211Scope,
  reachableC61211Scope,
  coverageC61211,
  coverageC61211Gate,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/reachable-coverage.js";
import {
  C61211_COVERAGE_POLICY,
  hash,
  validateC61211Artifact,
} from "../packages/video-subtitler/src/consensus/evaluation-partition/c61211-policy.js";
import { c612Defined } from "../packages/video-subtitler/src/consensus/top-k/c612-policy.js";
const complete = () => {
  const f = c61211Fixture(),
    p = partitionC61211(f.input),
    scope = reachableC61211Scope(f.frozen, p.graph),
    coverage = coverageC61211(f.frozen, p.map, scope, f.input.goldTiming),
    integrity = auditC61211Conservation(f.input, p.map, p.graph);
  return { f, p, scope, coverage, integrity };
};
describe("C6.1.2.1.1 reachable scope and profile-independent coverage", () => {
  it("derives all scopes from frozen IDs, not dataset counts", () => {
    const { scope, coverage, integrity } = complete();
    expect(scope.globalGoldCueIds).toHaveLength(10);
    expect(scope.interventionReachableGoldCueIds).toHaveLength(10);
    expect(scope.candidateReachableMachineGroupIds).toHaveLength(10);
    expect(scope.candidateReachableEventIds).toHaveLength(10);
    expect(coverageC61211Gate(coverage, integrity).passed).toBe(true);
    for (const x of [scope, coverage, coverageC61211Gate(coverage, integrity)])
      expect(() => validateC61211Artifact(x)).not.toThrow();
  });
  it("does not let isolated Gold-only cues alone block the reachable gate", () => {
    const f = c61211Fixture();
    f.input.goldTiming = [
      ...f.input.goldTiming,
      ...Array.from({ length: 20 }, (_, i) => ({
        id: "unreachable-" + String(i),
        start: 200 + i,
        end: 201 + i,
      })),
    ];
    const p = partitionC61211(f.input),
      scope = reachableC61211Scope(f.frozen, p.graph),
      coverage = coverageC61211(f.frozen, p.map, scope, f.input.goldTiming);
    expect(coverage.coverage.globalGoldCueCoverage.ratio).toBeCloseTo(1 / 3);
    expect(coverage.coverage.interventionReachableGoldCueCoverage.ratio).toBe(
      1,
    );
    expect(scope.goldOnlyUnreachableCueIds).toHaveLength(20);
    expect(
      coverageC61211Gate(
        coverage,
        auditC61211Conservation(f.input, p.map, p.graph),
      ).passed,
    ).toBe(true);
  });
  it.each(C61211_COVERAGE_POLICY.gateMetrics)(
    "fails closed below 80 percent for %s",
    (key) => {
      const { coverage, integrity } = complete();
      coverage.coverage[key] = { numerator: 7, denominator: 10, ratio: 0.7 };
      expect(coverageC61211Gate(coverage, integrity).passed).toBe(false);
      coverage.coverage[key] = { numerator: 8, denominator: 10, ratio: 0.8 };
      expect(coverageC61211Gate(coverage, integrity).passed).toBe(true);
      coverage.coverage[key] = { numerator: 0, denominator: 0, ratio: null };
      expect(coverageC61211Gate(coverage, integrity).passed).toBe(false);
    },
  );
  it("has no L6, selection, precision or profile evidence in coverage gate inputs", () => {
    const { coverage, integrity } = complete(),
      gate = coverageC61211Gate(coverage, integrity);
    expect(gate.profileSelectionUsed).toBe(false);
    expect(
      gate.checks.some((c) => /L6|selection|precision/i.test(c.name)),
    ).toBe(false);
    expect(gate.passed).toBe(true);
  });
  it("rejects D2 or D0 as a route-authorizing coverage result", () => {
    const { coverage, integrity } = complete();
    for (const mode of ["D0_NO_CUT", "D2_RELAXED_DIAGNOSTIC_ONLY"] as const) {
      expect(() =>
        coverageC61211Gate({ ...coverage, mode }, { ...integrity, mode }),
      ).toThrow("C61211_ONLY_D1");
    }
  });
  it("does not enlarge candidate reachability with a CURRENT-only event", () => {
    const { f } = complete();
    const event = c612Defined(f.frozen.topK.sets[0]).eventId;
    f.frozen.topK.sets = f.frozen.topK.sets.map((s) =>
      s.eventId === event ? { ...s, alternativeIds: [] } : s,
    );
    const scope = candidateC61211Scope(f.frozen);
    expect(scope.frozenCandidateEventIds).toHaveLength(10);
    expect(scope.candidateReachableEventIds).toHaveLength(9);
    expect(scope.candidateReachableMachineGroupIds).toHaveLength(9);
  });
  it("keeps candidate scope independent of Gold timing and preserves original machine bytes", () => {
    const { f } = complete(),
      before = hash(f.frozen),
      candidate = candidateC61211Scope(f.frozen);
    partitionC61211({
      ...f.input,
      goldTiming: [{ id: "different", start: 0, end: 1 }],
    });
    expect(candidateC61211Scope(f.frozen)).toEqual(candidate);
    expect(hash(f.frozen)).toBe(before);
  });
  it.each([
    "crossFoldPartitionCount",
    "unaccountedEdgeCount",
    "unsafeCutCount",
    "duplicatedGoldCueCount",
    "nonMonotonicPartitionCount",
  ] as const)("requires zero %s", (name) => {
    const { coverage, integrity } = complete();
    integrity[name] = 1;
    expect(coverageC61211Gate(coverage, integrity).passed).toBe(false);
  });
});
