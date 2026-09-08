import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  auditWave,
  auditExit,
  assertExactIds,
  contractComparison,
  evidenceField,
  expectedLengths,
  futureTraceSchema,
  outputStatistics,
  publicCoverage,
  tokenTableContract,
  verifyTextChain,
  AUDIT_ZERO_EXECUTION,
} from "../packages/video-subtitler/src/machine-quality/reazon-runtime-audit.js";

export function neutralWave(samples = [-32768, -1, 0, 1, 32767]) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(s, 44 + i * 2));
  return b;
}
describe("offline Reazon artifact audit", () => {
  it("cannot conceal invalid UTF8 bytes behind replacement-character decoding", () => {
    expect(
      verifyTextChain("\ufffd", "\ufffd", Buffer.from([255])).utf8Matches,
    ).toBe(false);
  });
  it("never labels a confirmed static conflict as no conflict", () => {
    expect(auditExit(["blank-id"], false)).toBe(
      "STATIC_RUNTIME_CONTRACT_VIOLATION_CONFIRMED",
    );
    expect(auditExit([], true)).toBe("AUDIT_BLOCKED_BY_MISSING_ARTIFACTS");
    expect(auditExit([], false)).toBe(
      "NO_STATIC_VIOLATION_FOUND_INTERNAL_TRACE_MISSING",
    );
  });
  it("accepts twelve unique bindings and any response order only when explicitly checked", () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(i));
    expect(() => assertExactIds(ids, ids)).not.toThrow();
    expect(() => assertExactIds(ids, ids.slice(1))).toThrow();
    expect(() => assertExactIds(ids, [...ids.slice(1), "1"])).toThrow();
    expect(() => assertExactIds(["a", "a"], ["a", "b"])).toThrow();
  });
  it("reconstructs exact LE float32 scaling and both padding sides", () => {
    const b = neutralWave(),
      w = auditWave(b),
      padded = Buffer.alloc((5 + 28800) * 4);
    [-1, -1 / 32768, 0, 1 / 32768, 32767 / 32768].forEach((s, i) =>
      padded.writeFloatLE(s, (i + 14400) * 4),
    );
    expect(w.decodedFloat32Hash).toBe(
      createHash("sha256").update(padded).digest("hex"),
    );
    expect(w.paddingSamplesPerSide).toBe(14400);
    expect(w.sampleCount).toBe(5);
    expect(w.peak).toBe(1);
    expect(w.energyIsSpeechDetection).toBe(false);
  });
  it("rejects wrong rate, width, length and truncated PCM", () => {
    for (const offset of [24, 32, 34, 40]) {
      const b = neutralWave();
      b[offset] = 0;
      expect(() => auditWave(b)).toThrow();
    }
    expect(() => auditWave(neutralWave().subarray(0, 46))).toThrow();
  });
  it("does not mutate source buffers", () => {
    const b = neutralWave(),
      old = Buffer.from(b);
    auditWave(b);
    expect(b).toEqual(old);
  });
  it("retains Unicode, repeated words and every whitespace byte", () => {
    const s = "  中立中立。\r\n🙂 ";
    expect(verifyTextChain(s, s, s).utf8Matches).toBe(true);
    expect(verifyTextChain(s, s.trim(), s.trim()).jsonMatches).toBe(false);
  });
  it("point mismatch, nonfinite, decreasing and outside points do not trim text", () => {
    const r = {
      text: "entire neutral output",
      tokens: ["entire"],
      timestamps: [0, 12, 11, NaN, Infinity, -2, 31],
    };
    const s = outputStatistics(r, 10, 100);
    expect(s.text).toBe(r.text);
    expect(s.cardinalityMatches).toBe(false);
    expect(s.nonFinitePoints).toBe(2);
    expect(s.nonMonotonicGaps).toBe(1);
    expect(s.outOfPaddedBounds).toBe(3);
    expect(s.automaticBugOrSpeechClassification).toBeNull();
  });
  it("zero first point and long gap are not speech/bug classifications", () => {
    const s = outputStatistics(
      { text: "ab", tokens: ["a", "b"], timestamps: [0, 9] },
      10,
      100,
    );
    expect(s.coordinates[0]).toEqual({
      padded: 0,
      originalLocal: -0.9,
      sourceGlobal: 99.1,
    });
    expect(s.gaps).toEqual([9]);
    expect(s.text).toBe("ab");
    expect(s.automaticBugOrSpeechClassification).toBeNull();
  });
  it("empty emission arrays retain empty status without invented bounds", () => {
    const s = outputStatistics({ text: "", tokens: [], timestamps: [] }, 1, 0);
    expect(s.firstPoint).toBeNull();
    expect(s.maximumGap).toBeNull();
  });
  it("expected feature counts never populate observed encoder lengths", () => {
    const r = expectedLengths(448000, "a".repeat(40));
    expect(r.expectedFeatureFrames).toBe(2800);
    expect(r.observedFeatureFrames).toBeNull();
    expect(r.observedEncoderLength).toBeNull();
    expect(r.expectedEncoderLength).toBeNull();
    expect(() => expectedLengths(80, "master")).toThrow();
  });
  it("rounding follows the pinned flush formula", () => {
    expect(expectedLengths(79, "a".repeat(40)).expectedFeatureFrames).toBe(0);
    expect(expectedLengths(80, "a".repeat(40)).expectedFeatureFrames).toBe(1);
  });
  it("reports duplicate token IDs, nonzero blank and vocab mismatch", () => {
    const t = tokenTableContract("<blk> 1\n<unk> 2\na 2\n", 2);
    expect(t.uniqueIds).toBe(false);
    expect(t.blankCompatibleWithPinnedDecoder).toBe(false);
    expect(t.vocabCompatible).toBe(false);
  });
  it("missing metadata and multi-character tokens are not filled from guesses", () => {
    const t = tokenTableContract("<blk> 0\n<unk> 1\nneutral 2\n", null);
    expect(t.contiguous).toBe(true);
    expect(t.vocabCompatible).toBeNull();
    expect(t.allSingleCodePoint).toBe(false);
  });
  it("static known incompatibility is distinct from unknown symbolic dimensions", () => {
    expect(contractComparison(80, 64, "fixed").status).toBe("CONFLICT");
    expect(contractComparison(80, null, "fixed").status).toBe("UNKNOWN");
    expect(contractComparison(80, "symbolic:F", "fixed").status).toBe(
      "UNKNOWN",
    );
    expect(contractComparison("int64", "float32", "fixed").status).toBe(
      "CONFLICT",
    );
  });
  it("unavailable evidence cannot contain a synthetic observed number", () => {
    expect(() =>
      evidenceField.parse({
        level: "UNVERIFIED_OR_UNAVAILABLE",
        value: 42,
        source: "none",
      }),
    ).toThrow();
  });
  it("rejects fabricated real historical traces in future templates", () => {
    expect(() =>
      futureTraceSchema.parse({
        kind: "OBSERVED_IN_SAVED_ARTIFACT",
        requestId: "real",
      }),
    ).toThrow();
  });
  it("publication uses an allowlist with no private text/paths", () => {
    const s = outputStatistics(
      { text: "private /Users/neutral/secret", tokens: [], timestamps: [0, 9] },
      10,
      100,
    );
    const published = JSON.stringify(publicCoverage([s]));
    expect(published).not.toContain("private");
    expect(published).not.toContain("/Users");
    expect(published).not.toContain("sourceGlobal");
  });
  it("all model counters remain zero; descriptors do not claim native coverage", () => {
    expect(Object.values(AUDIT_ZERO_EXECUTION)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
