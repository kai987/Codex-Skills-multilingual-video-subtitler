import { describe, it, expect } from "vitest";
import {
  components,
  closure,
  sampleEdge,
  prepareUnits,
  dataGate,
  generationManifestSchema,
  reserveCompleteAttempt,
  type Unit,
} from "../packages/video-subtitler/src/machine-quality/reference-complete.js";
import {
  aggregateTextMetrics,
  transcriptMetric,
} from "../packages/video-subtitler/src/machine-quality/representative-evaluation.js";
const cue = (id: string, start: number, end: number) => ({
  id,
  start,
  end,
  text: "a".repeat(60),
});
describe("reference completeness before any inference", () => {
  it("rejects the last milliseconds of a full reference", () =>
    expect(closure({ start: 9.99, end: 11 }, [cue("r", 1, 10)]).complete).toBe(
      false,
    ));
  it("groups overlap, touching and insufficient double margin", () => {
    const groups = components(
      [
        cue("a", 1, 2),
        cue("b", 1.5, 3),
        cue("c", 3, 4),
        cue("d", 4.19, 5),
        cue("e", 5.5, 6),
      ],
      48000,
      10,
    );
    expect(groups.map((g) => g.cues.length)).toEqual([4, 1]);
  });
  it("checks neighbors introduced by padding", () =>
    expect(
      closure({ start: 1, end: 3.1 }, [
        cue("a", 1.2, 2.8),
        cue("b", 3, 4),
      ]).crossing.map((c) => c.id),
    ).toEqual(["b"]));
  it("uses strictly positive overlap, not endpoint contact", () => {
    expect(
      closure({ start: 2, end: 3 }, [
        cue("a", 1, 2),
        cue("b", 2, 3),
        cue("c", 3, 4),
      ]).included.map((c) => c.id),
    ).toEqual(["b"]);
    expect(
      closure({ start: 2 - 1e-8, end: 3 }, [cue("a", 1, 2)]).complete,
    ).toBe(false);
  });
  it("snaps only arithmetic roundoff", () => {
    expect(sampleEdge(0.1 + 0.2, 48000, true)).toBe(14400);
    expect(sampleEdge(0.3000001, 48000, true)).toBe(14401);
  });
  it("does not truncate oversize components", () => {
    const seed = {
      id: "seed",
      start: 1,
      end: 25,
      machineRisk: 1,
      stratum: "machine-risk" as const,
    };
    const r = prepareUnits({
      reference: [cue("r", 0, 40)],
      rate: 48000,
      duration: 60,
      old: [seed],
      candidates: [seed],
      replacementOrder: [seed.id],
      exclusions: [],
    });
    expect(r.units).toHaveLength(0);
    expect(
      r.ledger.some((l) => l.reason === "OVERSIZE_REFERENCE_COMPONENT"),
    ).toBe(true);
  });
  it("does not relabel old C audio as C1", () => {
    const seed = {
      id: "old-c",
      start: 1,
      end: 25,
      machineRisk: 0,
      stratum: "coverage" as const,
    };
    const r = prepareUnits({
      reference: [cue("r", 3, 23)],
      rate: 48000,
      duration: 60,
      old: [seed],
      candidates: [seed],
      replacementOrder: [seed.id],
      exclusions: [],
    });
    expect(r.units[0]?.referenceExposure).toBe(
      "KNOWN_OLD_D_AND_C_REMEASUREMENT",
    );
    expect(r.units.some((u) => u.partition === "C1")).toBe(false);
  });
  it("rejects illegal reference duration", () =>
    expect(() => components([cue("r", 2, 1)], 48000, 10)).toThrow());
  it("rejects duplicate reference IDs", () =>
    expect(() =>
      components([cue("r", 1, 2), cue("r", 3, 4)], 48000, 10),
    ).toThrow());
  it("rejects nonfinite reference coordinates", () =>
    expect(() => components([cue("r", 1, NaN)], 48000, 10)).toThrow());
  it("fails with no denominator; never reports readiness", () =>
    expect(dataGate([], true).status).toBe("DATA_PREFLIGHT_FAILED"));
  it("does not waive the 200-character minimum when unit and strata counts pass", () => {
    const rows = (["D1", "C1"] as const).flatMap((partition, p) =>
      Array.from(
        { length: 6 },
        (_, i) =>
          ({
            id: `u-${p}-${i}`,
            partition,
            stratum:
              (["coverage", "machine-risk", "low-risk"] as const)[i % 3] ??
              "coverage",
            start: p * 100 + i * 10,
            end: p * 100 + i * 10 + 5,
            reference: [
              cue(`r-${p}-${i}`, p * 100 + i * 10, p * 100 + i * 10 + 5),
            ],
            normalizedN: partition === "C1" ? 20 : 60,
            componentIds: [`g-${p}-${i}`],
          }) as Unit,
      ),
    );
    const gate = dataGate(rows, true);
    expect(gate.issues).toEqual([
      "C1_INSUFFICIENT_UNITS_DENOMINATOR_OR_STRATA",
    ]);
  });
  it("detects context leakage and repeated component ownership", () => {
    const u = {
      id: "unit-x",
      partition: "D1",
      stratum: "coverage",
      start: 1,
      end: 3,
      reference: [cue("r", 1, 3)],
      normalizedN: 60,
      componentIds: ["g"],
    } as Unit;
    expect(dataGate([u, { ...u, partition: "C1" }], true).issues).toContain(
      "PARTITION_OR_UNIT_LEAKAGE",
    );
  });
  it("fails missing physical audio", () =>
    expect(dataGate([], false).issues).toContain("AUDIO_MAPPING_INVALID"));
  it("strict manifest rejects reference or label fields", () => {
    const m = {
      version: "c601171-generation-v1",
      frozenRepairHash: "a".repeat(64),
      units: [],
    };
    expect(generationManifestSchema.safeParse(m).success).toBe(true);
    for (const key of [
      "reference",
      "referenceCueCount",
      "N",
      "labels",
      "sentenceBoundaries",
    ])
      expect(
        generationManifestSchema.safeParse({ ...m, [key]: [] }).success,
      ).toBe(false);
  });
  it("accounts for failures, padding, retries and ceilings", () => {
    expect(reserveCompleteAttempt([], 30)).toEqual({
      inputSeconds: 30,
      retry: false,
    });
    expect(() => reserveCompleteAttempt([], 31)).toThrow();
    expect(() => reserveCompleteAttempt([], 30, true, false)).toThrow();
    expect(() =>
      reserveCompleteAttempt(
        Array.from({ length: 18 }, () => ({ inputSeconds: 30, retry: false })),
        1,
      ),
    ).toThrow();
    expect(() =>
      reserveCompleteAttempt(
        [
          { inputSeconds: 30, retry: true },
          { inputSeconds: 30, retry: true },
        ],
        30,
        true,
        true,
      ),
    ).toThrow();
  });
  it("keeps exact/normalized distinct from scope completeness", () => {
    expect(transcriptMetric("Ａ。", "A", true).CER).toBe(0);
    expect(transcriptMetric("Ａ。", "A", false).CER).toBeGreaterThan(0);
    expect(closure({ start: 1, end: 2 }, [cue("r", 1, 2)]).complete).toBe(true);
  });
  it("uses micro sums and retains zero-reference insertions", () => {
    const a = transcriptMetric("abc", "abc"),
      b = transcriptMetric("x", "");
    expect(b.CER).toBeNull();
    const m = aggregateTextMetrics([a, b]);
    expect(m.N).toBe(3);
    expect(m.I).toBe(1);
    expect(m.microCER).toBe(1 / 3);
  });
});
