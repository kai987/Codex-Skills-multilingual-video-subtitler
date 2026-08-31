import { describe, expect, it } from "vitest";
import type { ScoreTrack142 } from "@mvl/shared";
import { fixture143 } from "./fixtures/c601143-fixture.js";
import {
  candidateFixture142 as candidate,
  native142,
  source142,
} from "./fixtures/c601142-fixture.js";
import { posteriorValleys143 } from "../packages/video-subtitler/src/review/c601143-hierarchical-clusters.js";
import {
  makeTargetBundle143,
  pruneDominatedBundles143,
} from "../packages/video-subtitler/src/review/c601143-target-bundles.js";
import {
  hash141,
  hashed141,
  required141,
  union141,
} from "../packages/video-subtitler/src/review/c601141-policy.js";

describe("C6.0.1.14.3 hierarchical native units", () => {
  it("uses a verified silence boundary as a hard split and preserves every atomic sample", () => {
    const f = fixture143([candidate("wide", 20, 26)], [0], {
      verifiedSilencePoints: [
        { atSample: 22 * 48000, evidenceHash: "a".repeat(64) },
      ],
    });
    expect(f.hierarchy.children.length).toBeGreaterThan(1);
    expect(f.hierarchy.boundaries).toContainEqual(
      expect.objectContaining({
        atSample: 22 * 48000,
        kind: "VERIFIED_SILENCE",
        hard: true,
      }),
    );
    expect(
      union141(f.hierarchy.children.flatMap((c) => c.nativeIntervalUnion)),
    ).toEqual(union141(f.hierarchy.atoms.map((a) => a.nativeInterval)));
  });
  it.each([
    ["sceneSamples", "SCENE"],
    ["speakerSamples", "SPEAKER"],
  ] as const)(
    "uses a %s soft boundary to split an oversized child",
    (key, kind) => {
      const f = fixture143([candidate("wide", 20, 26)], [0], {
        [key]: [22 * 48000],
      });
      expect(f.hierarchy.children.length).toBeGreaterThan(1);
      expect(f.hierarchy.boundaries.some((b) => b.kind === kind)).toBe(true);
    },
  );
  it("keeps an unsplittable oversized child audit-only instead of inventing a midpoint", () => {
    const f = fixture143([candidate("wide", 20, 26)], [0]);
    expect(f.hierarchy.children.some((c) => c.unsplittableLargeChild)).toBe(
      true,
    );
  });
  it("isolates invalid timebase evidence and never selects it", () => {
    const f = fixture143(
      [
        candidate("good", 20, 21),
        candidate("bad", 21, 22, { verifiedTimebase: false }),
      ],
      [0],
    );
    expect(
      f.hierarchy.boundaries.some(
        (b) => b.kind === "TIMEBASE_TRANSITION" && b.hard,
      ),
    ).toBe(true);
    expect(
      f.hierarchy.children.some((c) => !c.verifiedTimebase && !c.eligible),
    ).toBe(true);
  });
  it("extracts valleys only from verified probability score tracks", () => {
    const track = {
      semanticHash: "b".repeat(64),
      scoreSha256: "c".repeat(64),
      scoreKind: "PROBABILITY",
      auditThreshold: 0.2,
      frameCount: 5,
      frameOffsetSamples16k: 0,
      frameHopSamples16k: 160,
      maximumNativeSample: 4800,
      timeMapping: {
        sourceSampleRate: 48000,
        outputSampleRate: 16000,
        numerator: 3,
        denominator: 1,
        sourceStartSample: 0,
        frameOffsetSamples16k: 0,
        frameHopSamples16k: 160,
        measuredImpulsePeakDelaySamples: 0,
        mappingStatus: "VERIFIED_INTEGER_RATIONAL",
      },
    } satisfies ScoreTrack142;
    const rows = posteriorValleys143(
      [
        {
          track,
          values: [0.8, 0.1, 0.05, 0.1, 0.8],
          byteHashVerified: true,
        },
      ],
      48000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "POSTERIOR_VALLEY",
      hard: false,
      atSample: 960,
    });
  });
});

describe("C6.0.1.14.3 target bundles and dominance", () => {
  it("materializes one-slot single and multi-child bundles with exact speech core", () => {
    const f = fixture143(),
      single = required141(
        f.bundles.candidates.find((b) => b.childUnitIds.length === 1),
      ),
      multi = required141(
        f.bundles.candidates.find((b) => b.childUnitIds.length === 2),
      );
    expect(single.targetSlotCost).toBe(1);
    expect(multi.targetSlotCost).toBe(1);
    expect(multi.coreUnionSeconds).toBeCloseTo(2);
    expect(multi.internalSilenceSeconds).toBeCloseTo(0.4);
    expect(multi.nativeIntervalUnion).toHaveLength(2);
    expect(
      (multi.reviewEnvelope.endSample - multi.reviewEnvelope.startSample) /
        48000,
    ).toBeCloseTo(2.4);
  });
  it("records cue-covered internal gaps without counting them as speech", () => {
    const f = fixture143(undefined, undefined, {
        finalCueMasks: [native142(21, 21.4)],
      }),
      multi = required141(
        f.bundles.candidates.find((b) => b.childUnitIds.length === 2),
      );
    expect(multi.cueCoveredGapIntervals).toEqual([native142(21, 21.4)]);
    expect(multi.coreUnionSeconds).toBeCloseTo(2);
  });
  it("rejects a bundle over twelve seconds and a bundle crossing a strong scene boundary", () => {
    const far = fixture143(
      [candidate("a", 20, 21), candidate("b", 31.5, 32.5)],
      [0],
    );
    const over = makeTargetBundle143({
      ...far,
      children: far.hierarchy.children,
      immutableAudioIntervals: [],
      cueMasks: [],
    });
    expect(over.eligible).toBe(false);
    expect(over.rejectionReasons).toContain("BUNDLE_ENVELOPE_OVER_12_SECONDS");
    const scene = fixture143(undefined, undefined, {
        sceneSamples: [21.2 * 48000],
      }),
      b = required141(
        scene.bundles.candidates.find((x) => x.childUnitIds.length === 2),
      );
    expect(b.rejectionReasons).toContain(
      "STRONG_SCENE_OR_SOURCE_DISCONTINUITY",
    );
  });
  it("refuses a foreign-source child", () => {
    const f = fixture143(),
      child = required141(f.hierarchy.children[0]);
    expect(() =>
      makeTargetBundle143({
        ...f,
        children: [
          {
            ...child,
            sourceIdentity: { ...source142, sourceMediaSha256: "d".repeat(64) },
          },
        ],
        immutableAudioIntervals: [],
        cueMasks: [],
      }),
    ).toThrow();
  });
  it("deduplicates the candidate universe and emits a complete dominance ledger", () => {
    const f = fixture143(),
      ids = f.bundles.candidates.map((b) => b.bundleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      f.dominance.retainedBundleIds.length + f.dominance.entries.length,
    ).toBe(f.bundles.summary.eligibleCount);
  });
  it("prunes only a strictly cheaper same-child duplicate and never a diversity-losing alternative", () => {
    const f = fixture143(),
      base = required141(f.bundles.candidates.find((b) => b.eligible));
    const expensive = hashed141({
      ...base,
      bundleId: "expensive",
      incrementalFullQueueAudioSeconds:
        base.incrementalFullQueueAudioSeconds + 1,
    });
    const bundles = hashed141({
      ...f.bundles,
      candidates: [base, expensive],
      summary: {
        ...f.bundles.summary,
        candidateCount: 2,
        eligibleCount: 2,
        rejectedCount: 0,
      },
    });
    const d = pruneDominatedBundles143({ bundles, policy: f.policy });
    expect(d.entries).toContainEqual(
      expect.objectContaining({ dominatedBundleId: "expensive" }),
    );
    const diverse = hashed141({
      ...expensive,
      bundleId: "diverse",
      detectorFamilies: [...expensive.detectorFamilies, "WEBRTC" as const],
    });
    const b2 = hashed141({ ...bundles, candidates: [base, diverse] });
    expect(
      pruneDominatedBundles143({ bundles: b2, policy: f.policy }).entries,
    ).toHaveLength(0);
  });
  it("uses deterministic bundle IDs under child permutation", () => {
    const f = fixture143(),
      children = f.hierarchy.children.slice(0, 2);
    const a = makeTargetBundle143({
        ...f,
        children,
        immutableAudioIntervals: [],
        cueMasks: [],
      }),
      b = makeTargetBundle143({
        ...f,
        children: [...children].reverse(),
        immutableAudioIntervals: [],
        cueMasks: [],
      });
    expect(a.bundleId).toBe(b.bundleId);
    expect(hash141(a)).toBe(hash141(b));
  });
});
