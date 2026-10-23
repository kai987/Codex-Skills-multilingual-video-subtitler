import { describe, it, expect } from "vitest";
import {
  characterAlignment,
  evaluateQuality,
} from "../packages/video-subtitler/src/machine-quality/experimental-metrics.js";
const cue = (id: string, text: string, start = 0, end = 1) => ({
  id,
  text,
  start,
  end,
});
describe("C60116 fixed evaluator direction and denominator", () => {
  it("counts hypothesis omissions as D and extra characters as I", () => {
    expect(characterAlignment("abc", "ac")).toMatchObject({
      S: 0,
      D: 1,
      I: 0,
      N: 3,
    });
    expect(characterAlignment("ac", "abc")).toMatchObject({
      S: 0,
      D: 0,
      I: 1,
      N: 2,
    });
    expect(characterAlignment("ab", "ax")).toMatchObject({
      S: 1,
      D: 0,
      I: 0,
      N: 2,
    });
  });
  it("does not call empty output perfect or empty reference zero CER", () => {
    expect(evaluateQuality([], [cue("r", "abc")]).normalized).toMatchObject({
      D: 3,
      CER: 1,
    });
    expect(characterAlignment("", "abc")).toMatchObject({ I: 3, CER: null });
  });
  it("matches split and merged text without timestamps or sequence-number pairing", () => {
    const a = evaluateQuality(
      [cue("a", "abc", 100, 101), cue("b", "def", 101, 102)],
      [cue("r", "abcdef", 0, 2)],
    );
    expect(a.normalized.CER).toBe(0);
    expect(a.structure.splits).toBe(1);
    expect(a.timing.startMAE).toBe(100);
    expect(a.timing.severeBoundaryGroups).toBe(1);
    const b = evaluateQuality(
      [cue("a", "abcdef", 0, 2)],
      [cue("r1", "abc"), cue("r2", "def", 1, 2)],
    );
    expect(b.structure.merges).toBe(1);
  });
  it("reports missing/extra spans rather than deriving them from cue counts", () => {
    const e = evaluateQuality([cue("a", "abxy")], [cue("r", "abcdef")]);
    expect(e.normalized.N).toBe(6);
    expect(e.normalized.D).toBe(2);
    expect(e.coverage.missingReferenceSpans.length).toBeGreaterThan(0);
  });
  it("counts nested overlap pairs, without calling them hallucinations", () => {
    const e = evaluateQuality(
      [
        cue("a", "hello", 0, 10),
        cue("b", "hello", 1, 2),
        cue("c", "yes", 4, 5),
      ],
      [cue("r", "helloyes", 0, 10)],
    );
    expect(e.structure.overlaps).toHaveLength(2);
    expect(e.structure.exactTextOverlapPairs).toBe(1);
    expect(e.coverage.confirmedHallucination).toBeNull();
  });
  it("removes display breaks but preserves lexical substitutions", () => {
    const e = evaluateQuality([cue("a", "あ\nか")], [cue("r", "あお")]);
    expect(e.exact.S).toBe(1);
    expect(e.normalized.S).toBe(1);
  });
});
