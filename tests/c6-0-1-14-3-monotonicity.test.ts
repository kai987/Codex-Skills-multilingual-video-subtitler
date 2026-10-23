import { describe, it, expect } from "vitest";
import {
  policy143Schema,
  obligations143Schema,
  bundle143Schema,
} from "@mvl/shared";
import { fixture143 } from "./fixtures/c601143-fixture.js";
import {
  hash141,
  hashed141,
  required141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";
import {
  validateCrossStageCoverageMonotonicity,
  assertMonotonicity143,
  buildContinuity143,
} from "../packages/video-subtitler/src/review/c601143-monotonicity.js";
import {
  mappedNativeInterval143,
  assertReplayOnly143,
} from "../packages/video-subtitler/src/review/c601143-policy.js";
import { planFinalSafety143 } from "../packages/video-subtitler/src/review/c601143-final-planner.js";
describe("C6.0.1.14.3 native obligation continuity", () => {
  it("freezes strict replay-only policy and rejects Gold/threshold additions", () => {
    const f = fixture143();
    expect(() =>
      policy143Schema.parse({ ...f.policy, goldText: "forbidden" }),
    ).toThrow();
    expect(() =>
      policy143Schema.parse({ ...f.policy, maximumSpeechCoreUnionSeconds: 61 }),
    ).toThrow();
    expect(() => assertReplayOnly143("fresh")).toThrow();
    expect(() =>
      assertReplayOnly143("replay-only", {
        inferenceCount: 1,
        modelLoadCount: 0,
        providerProcessStartCount: 0,
        cacheMissCount: 0,
      }),
    ).toThrow();
  });
  it("allows changed target IDs when actual native core coverage is complete", () => {
    const f = fixture143(),
      result = planFinalSafety143(f),
      proof = validateCrossStageCoverageMonotonicity({
        ...f,
        selected: result.selected,
      });
    expect(proof.monotonicity.monotonicityPassed).toBe(true);
    expect(proof.monotonicity.exactTargetRetainedCount).toBe(0);
    expect(proof.monotonicity.equivalentBundleReplacementCount).toBeGreaterThan(
      0,
    );
  });
  it("rejects one actual native sample of dropped speech", () => {
    const f = fixture143(),
      b = required141(
        f.bundles.candidates.find(
          (b) => b.obligationIds.length && b.childUnitIds.length === 1,
        ),
      );
    const first = required141(b.nativeIntervalUnion[0]);
    const reduced = hashed141({
      ...b,
      atomicNativeIntervals: [{ ...first, startSample: first.startSample + 1 }],
      nativeIntervalUnion: [{ ...first, startSample: first.startSample + 1 }],
    });
    const selected = f.bundles.candidates.filter(
      (c) =>
        c.childUnitIds.length === 1 &&
        c.obligationIds.length &&
        c.bundleId !== b.bundleId,
    );
    const proof = validateCrossStageCoverageMonotonicity({
      policy: f.policy,
      obligations: f.obligations,
      selected: [...selected, reduced],
    }).monotonicity;
    expect(proof.uncoveredNativeSamples).toBe(1);
    expect(() => assertMonotonicity143(proof)).toThrow(/MONOTONICITY/u);
  });
  it("does not use a review envelope or padding to cover missing core", () => {
    const f = fixture143(),
      first = required141(
        f.bundles.candidates.find(
          (b) => b.childUnitIds.length === 1 && b.obligationIds.length,
        ),
      );
    const changed = hashed141({
      ...first,
      reviewEnvelope: { startSample: 0, endSample: 2400 * 48000 },
      predictedAudioIntervals: [{ startSample: 0, endSample: 2400 * 48000 }],
    });
    const proof = validateCrossStageCoverageMonotonicity({
      policy: f.policy,
      obligations: f.obligations,
      selected: [changed],
    }).monotonicity;
    expect(proof.monotonicityPassed).toBe(false);
  });
  it("rejects invented bundle atoms even with internally consistent hashes", () => {
    const f = fixture143(),
      b = required141(f.bundles.candidates.find((c) => c.eligible));
    const invented = hashed141({
      ...b,
      atomicNativeIntervals: [{ startSample: 0, endSample: 48000 }],
      nativeIntervalUnion: [{ startSample: 0, endSample: 48000 }],
    });
    expect(() =>
      validateCrossStageCoverageMonotonicity({ ...f, selected: [invented] }),
    ).toThrow(/UNSUPPORTED_CORE/u);
  });
  it("rejects mixed source identities", () => {
    const f = fixture143(),
      b = required141(f.bundles.candidates.find((c) => c.eligible));
    const foreign = hashed141({
      ...b,
      sourceIdentity: {
        ...b.sourceIdentity,
        sourceMediaSha256: "b".repeat(64),
      },
    });
    expect(() =>
      validateCrossStageCoverageMonotonicity({ ...f, selected: [foreign] }),
    ).toThrow(/SOURCE_IDENTITY/u);
  });
  it("records new evidence and all rejected children without calling them covered", () => {
    const f = fixture143(),
      selected = planFinalSafety143(f).selected,
      ledger = buildContinuity143({ ...f, selected }).ledger;
    expect(ledger.candidateDecisions).toHaveLength(f.hierarchy.children.length);
    expect(
      ledger.entries.every((e) => e.coverageRatio === 1 && !e.regression),
    ).toBe(true);
  });
  it("normalizes proven fractional resampling but never integer sample loss", () => {
    expect(
      mappedNativeInterval143({
        outputInterval: { startSample: 1, endSample: 5 },
        sourceStartSample: 0,
        numerator: 3,
        denominator: 2,
        verified: true,
        declaredNativeInterval: { startSample: 1, endSample: 8 },
      }),
    ).toEqual({ startSample: 2, endSample: 8 });
    expect(() =>
      mappedNativeInterval143({
        outputInterval: { startSample: 1, endSample: 5 },
        sourceStartSample: 0,
        numerator: 3,
        denominator: 1,
        verified: true,
        declaredNativeInterval: { startSample: 4, endSample: 15 },
      }),
    ).toThrow();
    expect(() =>
      mappedNativeInterval143({
        outputInterval: { startSample: 1, endSample: 5 },
        sourceStartSample: 0,
        numerator: 3,
        denominator: 2,
        verified: false,
        declaredNativeInterval: { startSample: 2, endSample: 8 },
      }),
    ).toThrow();
  });
  it("uses deduplicated native unions, not double-counted obligation atoms", () => {
    const f = fixture143();
    expect(f.obligations.totalNativeSamples).toBe(96000);
    expect(f.obligations.semanticCoverageHash).toBe(
      hash141({
        source: f.obligations.sourceIdentity,
        nativeIntervalUnion: f.obligations.nativeIntervalUnion,
      }),
    );
    expect(() =>
      obligations143Schema.parse({ ...f.obligations, goldInterval: [0, 1] }),
    ).toThrow();
    expect(() =>
      bundle143Schema.parse({
        ...required141(f.bundles.candidates[0]),
        resolved: true,
      }),
    ).toThrow();
  });
});
