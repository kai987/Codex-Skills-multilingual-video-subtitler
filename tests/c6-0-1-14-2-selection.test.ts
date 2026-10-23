import { describe, it, expect } from "vitest";
import { policy142Schema, safety142Schema } from "@mvl/shared";
import {
  policy142,
  assertBudget142,
} from "../packages/video-subtitler/src/review/c601142-policy.js";
import {
  clusterCandidates142,
  selectSafety142,
  marginalUtility142,
  insertionDensity142,
  supersession142,
} from "../packages/video-subtitler/src/review/c601142-selection.js";
import { hashed141 } from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  candidateFixture142 as candidate,
  uncoveredFixture142,
  oldSafetyFixture142,
  native142,
} from "./fixtures/c601142-fixture.js";
const policy = policy142();
const noBoundaries = {
  cueMasks: [],
  existingTargetMasks: [],
  sceneSamples: [],
  speakerSamples: [],
};
function setup(
  candidates: ReturnType<typeof candidate>[],
  old = oldSafetyFixture142(),
  boundaries: Parameters<
    typeof clusterCandidates142
  >[0]["boundaries"] = noBoundaries,
  speech = candidates.map((c) => c.nativeInterval),
) {
  const uncovered = uncoveredFixture142(candidates);
  const clusters = clusterCandidates142({
    uncovered,
    oldSafety: old,
    policy,
    boundaries,
    speechIntervals: speech,
  });
  return {
    clusters,
    oldSafety: old,
    policy,
    variant: "SELECTION_REPAIR_ONLY" as const,
  };
}
describe("C6.0.1.14.2 source-native safety selection", () => {
  it("keeps the policy strict and fixed without Gold or transcript inputs", () => {
    expect(() =>
      policy142Schema.parse({ ...policy, gold: "forbidden" }),
    ).toThrow();
    expect(() =>
      policy142Schema.parse({
        ...policy,
        selection: { ...policy.selection, maximumTargets: 48 },
      }),
    ).toThrow();
  });
  it("merges adjacent fragments before consuming slots and preserves lineage", () => {
    const parts = Array.from({ length: 20 }, (_, i) =>
      candidate(String(i), 8 + i * 0.2, 8 + (i + 1) * 0.2),
    );
    const result = setup(parts, oldSafetyFixture142(parts));
    const selected = selectSafety142(result);
    expect(selected.targets).toHaveLength(1);
    expect(selected.targets[0]?.atomicNativeIntervals).toHaveLength(20);
    expect(
      supersession142(result.oldSafety, selected, policy).summary.releasedSlots,
    ).toBe(19);
    expect(selected.summary.oldCoveragePreserved).toBe(true);
  });
  it("retains a supported internal gap as envelope, not target-core speech", () => {
    const parts = [candidate("x", 8, 9), candidate("y", 9.2, 10)];
    const result = setup(parts, oldSafetyFixture142(), noBoundaries, [
      native142(8, 10),
    ]);
    expect(result.clusters.clusters).toHaveLength(1);
    expect(result.clusters.clusters[0]?.uncoveredSpeechSeconds).toBeCloseTo(
      1.8,
    );
    expect(result.clusters.clusters[0]?.internalSilenceSeconds).toBeCloseTo(
      0.2,
    );
    expect(result.clusters.clusters[0]?.targetCoreUnion).toHaveLength(2);
  });
  it("does not bridge real detector silence", () => {
    expect(
      setup([candidate("x", 8, 9), candidate("y", 9.2, 10)]).clusters.clusters,
    ).toHaveLength(2);
  });
  for (const key of ["sceneSamples", "speakerSamples"] as const)
    it(`does not merge across ${key}`, () => {
      expect(
        setup(
          [candidate("x", 8, 9), candidate("y", 9, 10)],
          oldSafetyFixture142(),
          { ...noBoundaries, [key]: [9 * 48000] },
        ).clusters.clusters,
      ).toHaveLength(2);
    });
  for (const key of ["cueMasks", "existingTargetMasks"] as const)
    it(`rejects an atom crossing ${key}`, () => {
      expect(() =>
        setup([candidate("x", 8, 10)], oldSafetyFixture142(), {
          ...noBoundaries,
          [key]: [native142(9, 9.1)],
        }),
      ).toThrow(/PROTECTED_MASK/u);
    });
  it("does not join incompatible detector-exclusive strata", () => {
    const y = candidate("y", 9, 10, {
      independentFamilies: ["WEBRTC"],
      detectorFamilies: ["WEBRTC"],
      evidenceStratum: "WEBRTC_EXCLUSIVE",
      evidenceClass: "WEBRTC_EXCLUSIVE_SPEECH_CANDIDATE",
    });
    expect(setup([candidate("x", 8, 9), y]).clusters.clusters).toHaveLength(2);
  });
  it("rejects low support and invalid timebases from selection", () => {
    const result = selectSafety142(
      setup([
        candidate("bad", 8, 9, { verifiedTimebase: false }),
        candidate("low", 70, 71, {
          evidenceClass: "LOW_SUPPORT_VIEW_SPECIFIC",
        }),
      ]),
    );
    expect(result.targets).toHaveLength(0);
    expect(result.audit.map((a) => a.status)).toEqual([
      "INVALID_TIMEBASE",
      "LOW_SUPPORT_AUDIT_ONLY",
    ]);
  });
  it("reserves up to four exclusive novelty slots without requiring four distinct families", () => {
    const parts = Array.from({ length: 8 }, (_, i) =>
      candidate(String(i), 20 + i * 70, 21 + i * 70),
    );
    const selected = selectSafety142(setup(parts));
    expect(selected.summary.reservedExclusiveSelectedCount).toBe(4);
    expect(
      selected.targets.filter((t) => t.selectionStage === "EXCLUSIVE_RESERVE"),
    ).toHaveLength(4);
  });
  it("returns unused exclusive slots instead of forcing noise", () => {
    const result = selectSafety142(setup([candidate("x", 20, 21)]));
    expect(result.summary.unusedReservedSlotsReturned).toBe(3);
    expect(result.summary.targetCount).toBe(1);
  });
  it("recomputes marginal novelty after selection", () => {
    const result = setup([
      candidate("a", 20, 21),
      candidate("b", 23, 24),
      candidate("c", 100, 101),
    ]);
    const [a, b, c] = result.clusters.clusters;
    if (!a || !b || !c) throw new Error("fixture");
    expect(marginalUtility142(b, [a], policy, 48000).utility).toBeLessThan(
      marginalUtility142(b, [], policy, 48000).utility,
    );
    expect(marginalUtility142(c, [a], policy, 48000).utility).toBeGreaterThan(
      marginalUtility142(b, [a], policy, 48000).utility,
    );
  });
  it("does not let one preserved dense window reject every distant target", () => {
    const preserved = [0, 2, 4, 6].map((s, i) =>
      candidate(String(i), s, s + 0.5),
    );
    const result = selectSafety142(
      setup(
        [...preserved, candidate("distant", 100, 101)],
        oldSafetyFixture142(preserved),
      ),
    );
    expect(
      result.targets.some((t) =>
        t.memberCandidateIds.includes("candidate-distant"),
      ),
    ).toBe(true);
    expect(result.summary.densityOverrideCount).toBe(1);
    expect(
      insertionDensity142(
        { reviewEnvelope: native142(100, 101) },
        preserved.map((c) => ({ reviewEnvelope: c.nativeInterval })),
        48000,
      ),
    ).toBe(1);
  });
  it("enforces three new targets per fifteen-second sliding window", () => {
    const selected = selectSafety142(
      setup(
        [20, 23, 26, 29, 32].map((s, i) => candidate(String(i), s, s + 0.5)),
      ),
    );
    expect(selected.targets).toHaveLength(3);
    expect(selected.summary.densityRejectedCount).toBe(2);
    expect(selected.summary.densityOverrideCount).toBe(0);
  });
  it("enforces 24 slots without doubling the target cap", () => {
    const selected = selectSafety142(
      setup(
        Array.from({ length: 30 }, (_, i) =>
          candidate(String(i), 20 + i * 65, 21 + i * 65),
        ),
      ),
    );
    expect(selected.targets).toHaveLength(24);
  });
  it("enforces the independent 60-second atomic union budget", () => {
    const selected = selectSafety142(
      setup(
        Array.from({ length: 20 }, (_, i) =>
          candidate(String(i), 20 + i * 65, 26 + i * 65),
        ),
      ),
    );
    expect(selected.summary.targetUnionSeconds).toBe(60);
    expect(selected.targets).toHaveLength(10);
  });
  it("keeps decisions invariant under input permutation while binding exact input provenance", () => {
    const parts = [
      candidate("a", 20, 21),
      candidate("b", 100, 101),
      candidate("c", 170, 171),
    ];
    const forward = selectSafety142(setup(parts));
    const reverse = selectSafety142(setup([...parts].reverse()));
    expect(forward.targets).toEqual(reverse.targets);
    expect(forward.decisionTrace).toEqual(reverse.decisionTrace);
    // The artifact also binds the exact serialized upstream inventory. Its
    // provenance hash must not silently discard an upstream byte-order change.
    expect(forward.clustersHash).not.toBe(reverse.clustersHash);
  });
  it("keeps all targets review-only and rejects a fake resolved/canonical field", () => {
    const selected = selectSafety142(setup([candidate("a", 20, 21)]));
    expect(selected.targets[0]?.requiredLevel).toBe("RECOMMENDED");
    expect(() =>
      safety142Schema.parse(hashed141({ ...selected, resolved: true })),
    ).toThrow();
  });
  it.each([
    ["DETECTOR", 8, true],
    ["DETECTOR", 9, false],
    ["ASR", 12, true],
    ["ASR", 13, false],
  ] as const)("%s permits budget %s only when %s", (kind, count, allowed) => {
    if (allowed) expect(() => assertBudget142(kind, count)).not.toThrow();
    else expect(() => assertBudget142(kind, count)).toThrow(/BUDGET/u);
  });
});
