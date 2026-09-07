function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required evidence/index absent");
  return value;
}
import { describe, it, expect } from "vitest";
import {
  machineQualityEvidenceSchema,
  primaryMinimal,
} from "../packages/video-subtitler/src/machine-quality/experimental-profile.js";
import { recoverUnprovenRepetition } from "../packages/video-subtitler/src/machine-quality/experimental-repetition-recovery.js";
import { evidence } from "./helpers/c60116-quality-fixture.js";
describe("C60116 source-bound repetition recovery", () => {
  it("applies extraction offset once even with nonzero media start", () => {
    expect(primaryMinimal(evidence()).map((c) => [c.start, c.end])).toEqual([
      [10, 12],
      [12, 14],
    ]);
  });
  it("deduplicates an identical request, not distinct repeated utterances", () => {
    const e = evidence();
    e.primaryRequests.push(structuredClone(requireValue(e.primaryRequests[0])));
    expect(primaryMinimal(e)).toHaveLength(2);
    requireValue(requireValue(e.primaryRequests[1]).segments[0]).text =
      "different";
    expect(() => primaryMinimal(e)).toThrow(/Conflicting/u);
  });
  it("refuses VAD-local and unknown or human-answer inputs", () => {
    const e = evidence();
    expect(() =>
      machineQualityEvidenceSchema.parse({ ...e, goldPath: "answer.ass" }),
    ).toThrow();
    expect(() =>
      machineQualityEvidenceSchema.parse({
        ...e,
        primaryRequests: [{ ...e.primaryRequests[0], vadEnabled: true }],
      }),
    ).toThrow();
  });
  it("restores only original machine text/occurrence intervals, retaining true repeats", () => {
    const e = evidence(),
      before = JSON.stringify(e);
    const r = recoverUnprovenRepetition(e, true);
    expect(r.cues.map((c) => c.text)).toEqual(["走れ!走れ!", "走れ!走れ!"]);
    expect(r.cues.map((c) => c.start)).toEqual([10, 12]);
    expect(requireValue(r.journal[0]).applied).toBe(true);
    expect(JSON.stringify(e)).toBe(before);
  });
  it("does not alter disabled scaffold", () => {
    const e = evidence();
    expect(recoverUnprovenRepetition(e, false).cues).toEqual(e.stableCues);
  });
  it("abstains on insufficient source text, missing provenance, or foreign descendants", () => {
    for (const mode of ["text", "lineage", "foreign"]) {
      const e = evidence();
      if (mode === "text")
        requireValue(e.unprovenRepetition[0]).removedText = [
          "no machine evidence",
        ];
      if (mode === "lineage") e.canonicalLineage = [];
      if (mode === "foreign")
        e.stableCues.push({ ...requireValue(e.stableCues[0]), id: "another" });
      expect(
        recoverUnprovenRepetition(e, true).journal.every((j) => !j.applied),
      ).toBe(true);
    }
  });
  it("retains overlapping speakers and short calls not targeted by an operation record", () => {
    const e = evidence();
    e.unprovenRepetition = [];
    e.stableCues.push({
      ...requireValue(e.stableCues[0]),
      id: "speaker2",
      text: "あ!",
      start: 10.5,
      end: 11,
      speaker: "anonymous-local",
    });
    expect(recoverUnprovenRepetition(e, true).cues).toEqual(e.stableCues);
  });
  it("fails closed on segment offset overflow", () => {
    const e = evidence();
    requireValue(requireValue(e.primaryRequests[0]).segments[0]).end = 30;
    expect(() => primaryMinimal(e)).toThrow(/timebase/u);
  });
});
