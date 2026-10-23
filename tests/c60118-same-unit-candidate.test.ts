import { describe, it, expect } from "vitest";
import {
  completeCandidate,
  checkSameUnitDurations,
  reserveSameUnitAttempt,
  sameUnitRequestSchema,
} from "../packages/video-subtitler/src/machine-quality/same-unit-candidate.js";
import {
  compareCandidate,
  aggregateCandidates,
} from "../packages/video-subtitler/src/machine-quality/same-unit-evaluation.js";
describe("same-unit full-text and bounded candidate contract", () => {
  it("admits all twelve thirty-second units with full padding", () => {
    expect(
      checkSameUnitDurations(Array.from({ length: 12 }, () => 30))
        .paddedSeconds,
    ).toBeCloseTo(381.6);
  });
  it("preserves a 29.7-second unit without splitting", () => {
    expect(checkSameUnitDurations([29.7]).maximumPaddedSeconds).toBe(31.5);
  });
  it("rejects oversized and nonfinite raw audio", () => {
    for (const n of [30.001, NaN, Infinity, 0, -1])
      expect(() => checkSameUnitDurations([n])).toThrow();
  });
  it("requires explicit 32-second experiment contract and neutral fields", () => {
    const r = {
      type: "transcribe",
      requestId: "unit-neutral",
      audioPath: "neutral.wav",
      maximumPaddedSeconds: 32,
    };
    expect(sameUnitRequestSchema.parse(r)).toEqual(r);
    expect(() =>
      sameUnitRequestSchema.parse({ ...r, prompt: "answer" }),
    ).toThrow();
    expect(() =>
      sameUnitRequestSchema.parse({ ...r, maximumPaddedSeconds: 30 }),
    ).toThrow();
  });
  it("rejects a fifteenth attempt", () => {
    expect(() =>
      reserveSameUnitAttempt(
        Array.from({ length: 14 }, () => ({ seconds: 1, retry: false })),
        1,
        false,
        false,
      ),
    ).toThrow();
  });
  it("rejects third retry and quality retry", () => {
    expect(() =>
      reserveSameUnitAttempt(
        [
          { seconds: 1, retry: true },
          { seconds: 1, retry: true },
        ],
        1,
        true,
        true,
      ),
    ).toThrow();
    expect(() => reserveSameUnitAttempt([], 1, true, false)).toThrow();
  });
  it("retains whitespace and padding-point words", () => {
    const r = completeCandidate({
      status: "SUCCESS_NONEMPTY",
      rawResponseComplete: true,
      result: { text: "  中立。  ", tokens: ["中立"], timestamps: [-0.2] },
    });
    expect(r.text).toBe("  中立。  ");
    expect(r.timingStatus).toBe("POINT_ONLY_NOT_WORD_INTERVALS");
  });
  it("retains all text on cardinality mismatch", () => {
    const r = completeCandidate({
      status: "SUCCESS_NONEMPTY",
      rawResponseComplete: true,
      result: { text: "中立文", tokens: ["中", "立", "文"], timestamps: [1] },
    });
    expect(r.text).toBe("中立文");
    expect(r.tokenCount).toBe(3);
    expect(r.timestampCount).toBe(1);
    expect(r.timingStatus).toBe("RAW_CARDINALITY_MISMATCH");
  });
  it("permits complete text without points", () => {
    expect(
      completeCandidate({
        status: "SUCCESS_NONEMPTY",
        rawResponseComplete: true,
        result: { text: "中立" },
      }).timingStatus,
    ).toBe("RAW_CARDINALITY_UNVERIFIABLE");
  });
  it("does not reconstruct missing full text", () => {
    expect(() =>
      completeCandidate({
        status: "SUCCESS_NONEMPTY",
        rawResponseComplete: true,
        result: { tokens: ["中"] },
      }),
    ).toThrow();
  });
  it("rejects incomplete response claiming success", () => {
    expect(() =>
      completeCandidate({
        status: "SUCCESS_NONEMPTY",
        rawResponseComplete: false,
        result: { text: "中" },
      }),
    ).toThrow();
  });
  it("keeps successful empty distinct from execution failure", () => {
    expect(
      completeCandidate({
        status: "SUCCESS_EMPTY",
        rawResponseComplete: true,
        result: { text: "" },
      }).text,
    ).toBe("");
    expect(
      completeCandidate({
        status: "EXECUTION_FAILED",
        rawResponseComplete: false,
        result: null,
      }).text,
    ).toBeNull();
  });
  it("scores a legal empty hypothesis as deletions", () => {
    const r = compareCandidate("中立", "", "中立");
    expect(r.second?.D).toBe(2);
    expect(r.category).toBe("SECOND_SUCCESS_EMPTY");
  });
  it("retains missing tasks but restricts both paired denominators", () => {
    const r = aggregateCandidates([
      compareCandidate("甲", null, "甲"),
      compareCandidate("乙", "乙", "乙丙"),
    ]);
    expect(r.plannedUnits).toBe(2);
    expect(r.plannedN).toBe(3);
    expect(r.primary.N).toBe(2);
    expect(r.second.N).toBe(2);
    expect(r.pairedUnits).toBe(1);
  });
  it("records gain when both candidates remain wrong", () => {
    expect(compareCandidate("甲甲甲", "甲乙甲", "甲乙丙").category).toBe(
      "BOTH_NONEXACT_SECOND_BETTER",
    );
  });
  it("distinguishes tied same text and tied different text", () => {
    expect(compareCandidate("甲", "甲", "丙").category).toBe(
      "EQUAL_ERROR_SAME_TEXT",
    );
    expect(compareCandidate("甲", "乙", "丙").category).toBe(
      "EQUAL_ERROR_DIFFERENT_TEXT",
    );
  });
  it("keeps oracle monotone despite globally worse challenger", () => {
    const r = aggregateCandidates([
      compareCandidate("甲甲", "甲乙", "甲乙"),
      compareCandidate("丙丁戊", "甲甲甲", "丙丁戊"),
    ]);
    expect(r.delta).toBe(2);
    expect(r.oracleGain).toBe(1);
    expect(r.improved).toBe(1);
    expect(r.regressed).toBe(1);
  });
  it("retains macro/micro sensitivity and null zero denominator", () => {
    const r = aggregateCandidates([
      compareCandidate("", "甲", "甲"),
      compareCandidate("甲甲甲", "甲甲甲", "乙乙乙"),
    ]);
    expect(r.second.microCER).toBe(0.75);
    expect(r.second.macroCER).toBe(0.5);
    expect(aggregateCandidates([]).second.microCER).toBeNull();
  });
  it("reports exact and normalized independently", () => {
    expect(compareCandidate("甲。", "甲", "甲。", false).category).toBe(
      "PRIMARY_ONLY_REFERENCE_EXACT",
    );
    expect(compareCandidate("甲。", "甲", "甲。", true).category).toBe(
      "BOTH_REFERENCE_EXACT",
    );
  });
});
