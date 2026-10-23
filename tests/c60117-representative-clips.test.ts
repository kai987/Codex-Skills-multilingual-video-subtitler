import { describe, it, expect } from "vitest";
import {
  selectRepresentativeClips,
  reserveAttempt,
  lexicalRisk,
  singlePhysicalClip,
} from "../packages/video-subtitler/src/machine-quality/representative-clips.js";
import {
  referenceClipScope,
  aggregateTextMetrics,
  transcriptMetric,
} from "../packages/video-subtitler/src/machine-quality/representative-evaluation.js";
import { freshMatchedEvidenceSchema } from "../packages/video-subtitler/src/machine-quality/matched-replay.js";
const segments = Array.from({ length: 200 }, (_, i) => ({
  id: `synthetic-${i}`,
  start: i * 4,
  end: (i + 1) * 4,
  text: i % 30 < 5 ? "はいはい" : "おはようございます",
}));
describe("representative clip contract", () => {
  it("accepts a fresh user clip without historical case or reference inputs", () => {
    const c = singlePhysicalClip("b".repeat(64), 12, 36);
    expect(c.boundaryMethod).toBe("user-selected-physical-clip");
    expect(c.sourceIds).toEqual(["user-selected-physical-clip"]);
    expect(() => singlePhysicalClip("b".repeat(64), 12, 50)).toThrow();
  });
  it("freezes balanced deterministic disjoint strata without Gold", () => {
    const a = selectRepresentativeClips(segments, 800, [
      { start: 740, end: 790 },
    ]);
    expect(a).toEqual(
      selectRepresentativeClips(segments, 800, [{ start: 740, end: 790 }]),
    );
    expect(a.clips).toHaveLength(12);
    for (const stratum of ["coverage", "machine-risk", "low-risk"])
      for (const partition of ["D", "C"])
        expect(
          a.clips.filter(
            (c) => c.stratum === stratum && c.partition === partition,
          ),
        ).toHaveLength(2);
    for (const c of a.clips) {
      expect(c.end <= 740 || c.start >= 790).toBe(true);
      expect(
        a.clips.filter(
          (x) => x.id !== c.id && x.start < c.end + 1 && x.end > c.start - 1,
        ),
      ).toHaveLength(0);
      if (c.stratum === "low-risk") expect(c.machineRisk).toBe(0);
    }
  });
  it("does not backfill low-risk with flagged speech", () => {
    expect(
      selectRepresentativeClips(
        segments.map((s) => ({ ...s, text: "はいはい" })),
        800,
        [],
      ).clips.filter((c) => c.stratum === "low-risk"),
    ).toHaveLength(0);
  });
  it("uses machine repetition and duration, not a title dictionary", () => {
    expect(lexicalRisk("はいはい", 4)).toContain("machine-repetition");
    expect(lexicalRisk("おはよう", 2)).toEqual([]);
    expect(lexicalRisk("おはよう", 15)).toContain("abnormal-segment-duration");
  });
  it("rejects stale prompt contract and unrecognized Gold fields", () => {
    expect(
      freshMatchedEvidenceSchema.safeParse({ gold: "reference" }).success,
    ).toBe(false);
  });
  it("accounts failures and padding before execution", () => {
    expect(reserveAttempt([], 30)).toEqual({ inputSeconds: 30, retry: false });
    expect(() => reserveAttempt([], 30.01)).toThrow();
    expect(() =>
      reserveAttempt(
        Array.from({ length: 36 }, () => ({ inputSeconds: 30, retry: false })),
        1,
      ),
    ).toThrow();
    expect(() =>
      reserveAttempt(
        Array.from({ length: 4 }, () => ({ inputSeconds: 1, retry: true })),
        1,
        true,
      ),
    ).toThrow();
    expect(() =>
      reserveAttempt([{ inputSeconds: 1070, retry: false }], 20),
    ).toThrow();
  });
  it("never crops reference text or erases ambiguous clips", () => {
    const scope = referenceClipScope({ start: 10, end: 30 }, [
      { id: "r", start: 9, end: 15, text: "完全な文" },
    ]);
    expect(scope.units[0]?.text).toBe("完全な文");
    expect(scope.preciseEligible).toBe(false);
    expect(scope.boundaryCrossingIds).toEqual(["r"]);
  });
  it("weights micro CER by character denominator", () => {
    const a = transcriptMetric("甲", "乙"),
      b = transcriptMetric("abcdefghij", "abcdefghij");
    expect(aggregateTextMetrics([a, b]).microCER).toBe(1 / 11);
    expect(aggregateTextMetrics([a, b]).macroCER).toBe(0.5);
    expect(transcriptMetric("カタカナ", "カタカナ").distance).toBe(0);
  });
});
