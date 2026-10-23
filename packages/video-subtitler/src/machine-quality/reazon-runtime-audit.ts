/** Pure offline audit. No provider, model, evaluator, or audio-window execution. */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { z } from "zod";

export const AUDIT_ZERO_EXECUTION = Object.freeze({
  newRecognitionAttempts: 0,
  newModelInference: 0,
  newAcousticForwards: 0,
  newModelLoads: 0,
  newProviderStarts: 0,
  newAudioWindows: 0,
});
export const evidenceLevel = z.enum([
  "OBSERVED_IN_SAVED_ARTIFACT",
  "RECOMPUTED_FROM_FROZEN_INPUT",
  "STATICALLY_DERIVED_FROM_PINNED_CODE",
  "EXPECTED_BUT_NOT_OBSERVED",
  "UNVERIFIED_OR_UNAVAILABLE",
]);
export const evidenceField = z
  .object({
    level: evidenceLevel,
    value: z.unknown(),
    source: z.string().min(1),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.level === "UNVERIFIED_OR_UNAVAILABLE" && v.value !== null)
      c.addIssue({
        code: "custom",
        message: "Unavailable values must be null",
      });
  });
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export const objectHash = (v: unknown) => sha(JSON.stringify(v));

export function auditWave(b: Buffer) {
  if (
    b.length < 44 ||
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE" ||
    b.readUInt32LE(4) + 8 !== b.length
  )
    throw Error("INVALID_WAV");
  let pcm: Buffer | null = null,
    formatSeen = false;
  for (let i = 12; i < b.length;) {
    if (i + 8 > b.length) throw Error("TRUNCATED_CHUNK");
    const size = b.readUInt32LE(i + 4),
      tag = b.toString("ascii", i, i + 4);
    if (i + 8 + size > b.length) throw Error("TRUNCATED_CHUNK");
    if (tag === "fmt ") {
      if (
        formatSeen ||
        size < 16 ||
        b.readUInt16LE(i + 8) !== 1 ||
        b.readUInt16LE(i + 10) !== 1 ||
        b.readUInt32LE(i + 12) !== 16000 ||
        b.readUInt32LE(i + 16) !== 32000 ||
        b.readUInt16LE(i + 20) !== 2 ||
        b.readUInt16LE(i + 22) !== 16
      )
        throw Error("PCM_CONTRACT");
      formatSeen = true;
    }
    if (tag === "data") {
      if (pcm) throw Error("DUPLICATE_DATA");
      pcm = b.subarray(i + 8, i + 8 + size);
    }
    i += 8 + size + (size % 2);
  }
  if (!formatSeen || !pcm?.length || pcm.length % 2)
    throw Error("PCM_CONTRACT");
  const count = pcm.length / 2,
    padded = Buffer.alloc((count + 28800) * 4);
  const parts = Array.from({ length: 3 }, () => ({
    count: 0,
    energy: 0,
    nonzero: 0,
  }));
  let peak = 0,
    saturated = 0;
  for (let i = 0; i < count; i++) {
    const s = pcm.readInt16LE(i * 2),
      f = s / 32768;
    padded.writeFloatLE(f, (i + 14400) * 4);
    peak = Math.max(peak, Math.abs(f));
    if (s === -32768 || s === 32767) saturated++;
    const p = parts[Math.min(2, Math.floor((i * 3) / count))];
    if (!p) throw Error("PARTITION");
    p.count++;
    p.energy += f * f;
    if (s !== 0) p.nonzero++;
  }
  return {
    format: 1,
    channels: 1,
    sampleRate: 16000,
    bits: 16,
    sampleCount: count,
    seconds: count / 16000,
    wavHash: sha(b),
    pcmHash: sha(pcm),
    paddingSamplesPerSide: 14400,
    paddedSampleCount: count + 28800,
    paddedSeconds: (count + 28800) / 16000,
    decodedFloat32Hash: sha(padded),
    scaling:
      "little-endian signed int16 / 32768 -> float32; no gain/resampling/crop",
    nonFiniteSamples: 0,
    peak,
    saturatedSamples: saturated,
    thirds: parts.map((p) => ({
      sampleCount: p.count,
      rms: Math.sqrt(p.energy / p.count),
      nonzero: p.nonzero,
    })),
    energyIsSpeechDetection: false,
    evidence: "RECOMPUTED_FROM_FROZEN_INPUT" as const,
  };
}

const pointNumber = z.custom<number>((x) => typeof x === "number");
export const savedResponseSchema = z
  .object({
    type: z.literal("result"),
    requestId: z.string().min(1),
    status: z.enum(["SUCCESS_NONEMPTY", "SUCCESS_EMPTY"]),
    result: z
      .object({
        text: z.string(),
        tokens: z.array(z.string()),
        timestamps: z.array(pointNumber),
      })
      .strict(),
    rawResponseComplete: z.literal(true),
    acousticForwardAttempted: z.literal(true),
    rawSampleCount: z.number().int().positive(),
    paddedSampleCount: z.number().int().positive(),
    wallSeconds: z.number().nonnegative(),
    peakRssBytes: z.number().nonnegative(),
  })
  .strict();
export type SavedResponse = z.infer<typeof savedResponseSchema>;
export const normalizedAuditText = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\p{P}\p{Z}\s]/gu, "")
    .toLowerCase();

export function outputStatistics(
  result: SavedResponse["result"],
  rawSeconds: number,
  sourceOffset: number,
) {
  const points = result.timestamps,
    finite = points.filter(Number.isFinite);
  const gaps = points
    .slice(1)
    .map((t, i) =>
      Number.isFinite(t) && Number.isFinite(points[i])
        ? t - (points[i] ?? 0)
        : null,
    );
  return {
    text: result.text,
    rawCharacters: Array.from(result.text).length,
    normalizedCharacters: Array.from(normalizedAuditText(result.text)).length,
    tokenCount: result.tokens.length,
    timestampCount: points.length,
    cardinalityMatches: result.tokens.length === points.length,
    tokensJoinEqualsText: result.tokens.join("") === result.text,
    firstPoint: points.length && Number.isFinite(points[0]) ? points[0] : null,
    lastPoint:
      points.length && Number.isFinite(points.at(-1)) ? points.at(-1) : null,
    gaps,
    maximumGap: gaps.some((g) => g !== null)
      ? Math.max(...gaps.filter((g): g is number => g !== null))
      : null,
    nonFinitePoints: points.length - finite.length,
    nonMonotonicGaps: gaps.filter((g) => g !== null && g < 0).length,
    outOfPaddedBounds: finite.filter((t) => t < 0 || t > rawSeconds + 1.8)
      .length,
    paddingPoints: finite.filter((t) => t < 0.9 || t > rawSeconds + 0.9).length,
    normalizedCharactersPerRawSecond:
      Array.from(normalizedAuditText(result.text)).length / rawSeconds,
    coordinates: points.map((p) => ({
      padded: Number.isFinite(p) ? p : null,
      originalLocal: Number.isFinite(p) ? p - 0.9 : null,
      sourceGlobal: Number.isFinite(p) ? sourceOffset + p - 0.9 : null,
    })),
    timeMeaning: "EMISSION_POINTS_NOT_WORD_INTERVALS",
    automaticBugOrSpeechClassification: null,
  };
}

export function assertExactIds(
  expected: readonly string[],
  actual: readonly string[],
) {
  if (
    new Set(expected).size !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.length !== actual.length ||
    expected.some((id) => !actual.includes(id))
  )
    throw Error("MISSING_DUPLICATE_OR_UNEXPECTED_ID");
}
export function verifyTextChain(
  text: string,
  jsonText: string,
  diskText: string | Buffer,
) {
  return {
    jsonMatches: text === jsonText,
    utf8Matches: Buffer.from(text).equals(Buffer.from(diskText)),
    rawTextHash: sha(text),
    candidateTextHash: sha(jsonText),
    fileTextHash: sha(diskText),
  };
}

/** Fixed knf NumFrames(..., flush=true), 16 kHz / 10 ms / snip_edges=false.
 * Caller must bind the pinned source. Not an invocation of a feature extractor. */
export function expectedLengths(samples: number, pinnedSource: string) {
  if (
    !Number.isSafeInteger(samples) ||
    samples <= 0 ||
    !/^[a-f0-9]{40}$/.test(pinnedSource)
  )
    throw Error("EXPECTED_LENGTH_REQUIRES_PINNED_FORMULA");
  return {
    expectedFeatureFrames: Math.floor((samples + 80) / 160),
    expectedEncoderLength: null,
    observedFeatureFrames: null,
    observedEncoderLength: null,
    evidence: "EXPECTED_BUT_NOT_OBSERVED",
    pinnedSource,
  };
}

export function tokenTableContract(
  text: string,
  declaredVocabSize: number | null,
) {
  const rows = text
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => {
      const m = /^(.*)\s+(\d+)$/u.exec(line);
      if (!m?.[1] || !m[2]) throw Error("INVALID_TOKEN_ROW");
      return { token: m[1], id: Number(m[2]) };
    });
  const ids = rows.map((r) => r.id),
    uniqueIds = new Set(ids).size === ids.length;
  const uniqueSymbols = new Set(rows.map((r) => r.token)).size === rows.length;
  const blankId = rows.find((r) => r.token === "<blk>")?.id ?? null;
  const unkId = rows.find((r) => r.token === "<unk>")?.id ?? null;
  return {
    count: rows.length,
    uniqueIds,
    uniqueSymbols,
    minimumId: Math.min(...ids),
    maximumId: Math.max(...ids),
    contiguous:
      uniqueIds &&
      Math.min(...ids) === 0 &&
      Math.max(...ids) === rows.length - 1,
    blankId,
    unkId,
    allSingleCodePoint: rows.every((r) => Array.from(r.token).length === 1),
    declaredVocabSize,
    vocabCompatible:
      declaredVocabSize === null
        ? null
        : rows.length === declaredVocabSize &&
          ids.every((i) => i < declaredVocabSize),
    blankCompatibleWithPinnedDecoder: blankId === null ? null : blankId === 0,
  };
}

export function contractComparison(
  explicit: unknown,
  modelRequired: unknown,
  source: string,
) {
  return {
    explicit,
    modelRequired,
    observed: null,
    source,
    status:
      explicit === null ||
      modelRequired === null ||
      (typeof explicit === "string" && explicit.startsWith("symbolic:")) ||
      (typeof modelRequired === "string" &&
        modelRequired.startsWith("symbolic:"))
        ? "UNKNOWN"
        : JSON.stringify(explicit) === JSON.stringify(modelRequired)
          ? "CONSISTENT_STATIC"
          : "CONFLICT",
  };
}

export const futureTraceSchema = z
  .object({
    kind: z.literal("FUTURE_TEMPLATE_NOT_EXECUTED"),
    requestId: z.literal("neutral-template"),
    actualFeatureShape: z.null(),
    actualFeatureLength: z.null(),
    actualEncoderShape: z.null(),
    actualEncoderLength: z.null(),
    traversedFrames: z.null(),
    blankCount: z.null(),
    unkCount: z.null(),
    emittedCount: z.null(),
    emissionFrameIndices: z.null(),
  })
  .strict();

/** Deliberate aggregate allowlist: never spread private records into publication. */
export function publicCoverage(
  rows: readonly ReturnType<typeof outputStatistics>[],
) {
  return {
    units: rows.length,
    normalizedCharacters: rows.reduce((n, r) => n + r.normalizedCharacters, 0),
    cardinalityMatches: rows.filter((r) => r.cardinalityMatches).length,
    tokenTextMatches: rows.filter((r) => r.tokensJoinEqualsText).length,
    nonFinitePoints: rows.reduce((n, r) => n + r.nonFinitePoints, 0),
    nonMonotonicGaps: rows.reduce((n, r) => n + r.nonMonotonicGaps, 0),
    outOfPaddedBounds: rows.reduce((n, r) => n + r.outOfPaddedBounds, 0),
    paddingPoints: rows.reduce((n, r) => n + r.paddingPoints, 0),
    historicalFirstGapOver8: rows.filter((r) => (r.gaps[0] ?? 0) > 8).length,
  };
}

export function auditExit(
  conflicts: readonly string[],
  criticalArtifactsMissing: boolean,
) {
  if (conflicts.length) return "STATIC_RUNTIME_CONTRACT_VIOLATION_CONFIRMED";
  if (criticalArtifactsMissing) return "AUDIT_BLOCKED_BY_MISSING_ARTIFACTS";
  return "NO_STATIC_VIOLATION_FOUND_INTERNAL_TRACE_MISSING";
}
