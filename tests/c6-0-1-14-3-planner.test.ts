import { describe, it, expect } from "vitest";
import { planner143Schema } from "@mvl/shared";
import { fixture143 } from "./fixtures/c601143-fixture.js";
import { candidateFixture142 as candidate } from "./fixtures/c601142-fixture.js";
import {
  planFinalSafety143,
  nativeKnapsackBounds143,
} from "../packages/video-subtitler/src/review/c601143-final-planner.js";
import {
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
describe("C6.0.1.14.3 constrained native B&B", () => {
  it("finds and exhaustively certifies a small feasible selection", () => {
    const f = fixture143(),
      r = planFinalSafety143(f);
    expect(r.certificate.feasibilityStatus).toBe("FEASIBLE");
    expect(r.certificate.searchComplete).toBe(true);
    expect(r.certificate.feasibilityWitnessVerified).toBe(true);
    expect(r.certificate.hardConstraintResults.every((c) => c.passed)).toBe(
      true,
    );
    expect(r.certificate.activeTargetCount).toBe(2);
    expect(r.certificate.obligationCoverageRatio).toBe(1);
  });
  it("reports a bounded incomplete search, never budget infeasibility", () => {
    const r = planFinalSafety143({ ...fixture143(), stateLimit: 1 });
    expect(r.certificate.feasibilityStatus).toBe("SEARCH_INCOMPLETE");
    expect(r.certificate.searchComplete).toBe(false);
    expect(r.certificate.diagnosticReasons).toContain(
      "FINAL_PLANNER_SEARCH_INCOMPLETE",
    );
    expect(() =>
      planner143Schema.parse({
        ...r.certificate,
        feasibilityStatus: "INFEASIBLE_PROVEN",
      }),
    ).toThrow();
  });
  it("distinguishes a proven missing obligation candidate from incomplete search", () => {
    const f = fixture143();
    const dominance = hashed141({ ...f.dominance, retainedBundleIds: [] });
    const r = planFinalSafety143({ ...f, dominance });
    expect(r.certificate.feasibilityStatus).toBe("INFEASIBLE_PROVEN");
    expect(r.certificate.feasibilityWitnessVerified).toBe(false);
    expect(r.certificate.fallback).toBe("PHASE_A_SELECTION_ONLY_HOLD");
  });
  it("can bundle required children to release slots without adding gap speech", () => {
    const f = fixture143(),
      r = planFinalSafety143(f),
      bundle = required141(r.selected.find((b) => b.childUnitIds.length === 2));
    expect(bundle.coreUnionSeconds).toBeCloseTo(2);
    expect(bundle.internalSilenceSeconds).toBeCloseTo(0.4);
    expect(bundle.targetSlotCost).toBe(1);
  });
  it("keeps results deterministic under candidate permutation", () => {
    const f = fixture143(),
      a = planFinalSafety143(f);
    const bundles = hashed141({
      ...f.bundles,
      candidates: [...f.bundles.candidates].reverse(),
    });
    const dominance = hashed141({
      ...f.dominance,
      candidatesHash: bundles.semanticHash,
      retainedBundleIds: [...f.dominance.retainedBundleIds].reverse(),
    });
    const b = planFinalSafety143({ ...f, bundles, dominance });
    expect(b.selected).toEqual(a.selected);
    expect(b.certificate.objectiveVector).toEqual(
      a.certificate.objectiveVector,
    );
  });
  it("enforces physical full-queue budget independently of speech-core budget", () => {
    const f = fixture143(),
      bundles = hashed141({
        ...f.bundles,
        immutableAudioIntervals: [{ startSample: 0, endSample: 2400 * 48000 }],
        baselineUniqueAudioSeconds: 2400,
      });
    const dominance = hashed141({
      ...f.dominance,
      candidatesHash: bundles.semanticHash,
    });
    expect(
      planFinalSafety143({ ...f, bundles, dominance }).certificate
        .feasibilityStatus,
    ).toBe("INFEASIBLE_PROVEN");
  });
  it("maximizes independent new coverage before source-time ordering", () => {
    const f = fixture143(
      [
        candidate("required", 5, 6),
        candidate("later-larger", 400, 401),
        candidate("earlier-smaller", 20, 20.5),
      ],
      [0],
    );
    const r = planFinalSafety143(f);
    expect(r.certificate.objectiveVector[1]).toBe(72000);
  });
  it("uses exact native knapsack upper bounds with no invented feasible witness", () => {
    const b = nativeKnapsackBounds143([8, 11, 13], [false, false, false], 20);
    expect(required141(b.tables?.[0])[20 / b.divisor]).toBe(19 / b.divisor);
    expect(required141(b.tables?.[1])[20 / b.divisor]).toBe(13 / b.divisor);
  });
  it("does not permit an unbounded state override", () => {
    expect(() =>
      planFinalSafety143({ ...fixture143(), stateLimit: 5000001 }),
    ).toThrow(/RESOURCE_LIMIT/u);
  });
});
