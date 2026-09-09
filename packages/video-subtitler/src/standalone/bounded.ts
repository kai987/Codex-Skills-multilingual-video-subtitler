/** Opt-in experiment only; no product generate/resume policy changes. */
import { z } from "zod";
import { subtitleCueSchema } from "@mvl/shared";
import { rawRecords, type RawRecord } from "./recovery.js";
import { assemble } from "./assembly.js";
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw Error("MISSING_BOUND_EVIDENCE");
  return value;
}
import {
  formatAss,
  formatSrt,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
} from "@mvl/subtitle-core";

export const POLICY = Object.freeze({
  version: "bounded-longform-v1",
  preferredSeconds: 25,
  minCoreSeconds: 20,
  maxRequestSeconds: 30,
  contextSeconds: 0.3,
  minSilenceSeconds: 0.1,
  shortTextCodepoints: 8,
  maxRequests: 64,
  maxRetries: 1,
  maxAudioRatio: 1.1,
});
const sample = z.number().int().nonnegative();
export const chunkSchema = z
  .object({
    id: z.string().regex(/^chunk-\d{4}$/u),
    index: sample,
    coreStart: sample,
    coreEnd: sample,
    inputStart: sample,
    inputEnd: sample,
    boundary: z.enum(["silence", "hard-cut", "tail"]),
    candidateSamples: z.array(sample),
  })
  .strict();
export type Chunk = z.infer<typeof chunkSchema>;
export function validateChunks(chunks: Chunk[], frames: number, rate: number) {
  if (
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    !Number.isSafeInteger(rate) ||
    rate <= 0 ||
    !chunks.length
  )
    throw Error("INVALID_PCM_PLAN");
  let next = 0;
  chunks.forEach((value, i) => {
    const c = chunkSchema.parse(value);
    if (
      c.index !== i ||
      c.id !== `chunk-${String(i + 1).padStart(4, "0")}` ||
      c.coreStart !== next ||
      c.coreEnd <= next ||
      c.inputStart > c.coreStart ||
      c.inputEnd < c.coreEnd ||
      c.inputEnd > frames ||
      c.inputEnd - c.inputStart > Math.floor(rate * POLICY.maxRequestSeconds) ||
      c.coreStart - c.inputStart > Math.floor(rate * POLICY.contextSeconds) ||
      c.inputEnd - c.coreEnd > Math.floor(rate * POLICY.contextSeconds)
    )
      throw Error("INVALID_CHUNK_COVERAGE_OR_BOUND");
    next = c.coreEnd;
  });
  const requestedSamples = chunks.reduce(
    (n, c) => n + c.inputEnd - c.inputStart,
    0,
  );
  if (next !== frames) throw Error("INCOMPLETE_PCM_COVERAGE");
  if (
    chunks.length > POLICY.maxRequests ||
    requestedSamples > frames * POLICY.maxAudioRatio
  )
    throw Error("PLAN_BUDGET_EXCEEDED");
  return {
    requestedSamples,
    requestedSeconds: requestedSamples / rate,
    coreCoverageSamples: next,
  };
}
export function planChunks(
  frames: number,
  rate: number,
  silence: { start: number; end: number }[],
): Chunk[] {
  if (
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    !Number.isSafeInteger(rate) ||
    rate <= 0
  )
    throw Error("INVALID_PCM");
  for (const s of silence)
    if (
      !Number.isSafeInteger(s.start) ||
      !Number.isSafeInteger(s.end) ||
      s.start < 0 ||
      s.end <= s.start ||
      s.end > frames
    )
      throw Error("INVALID_SILENCE");
  const pad = Math.floor(rate * POLICY.contextSeconds),
    max = Math.floor(rate * POLICY.maxRequestSeconds) - 2 * pad,
    result: Chunk[] = [];
  for (let start = 0; start < frames;) {
    const target = start + Math.floor(rate * POLICY.preferredSeconds);
    const lower = start + Math.floor(rate * POLICY.minCoreSeconds),
      upper = Math.min(frames, start + max);
    const candidates = silence
      .filter(
        (s) =>
          s.end - s.start >= Math.ceil(rate * POLICY.minSilenceSeconds) &&
          s.end >= lower &&
          s.start <= upper,
      )
      .map((s) =>
        Math.max(lower, Math.min(upper, Math.floor((s.start + s.end) / 2))),
      )
      .filter((n) => n >= lower && n <= upper);
    candidates.sort(
      (a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b,
    );
    const tail = frames - start <= max;
    const end = tail ? frames : (candidates[0] ?? Math.min(target, upper));
    result.push({
      id: `chunk-${String(result.length + 1).padStart(4, "0")}`,
      index: result.length,
      coreStart: start,
      coreEnd: end,
      inputStart: Math.max(0, start - pad),
      inputEnd: Math.min(frames, end + pad),
      boundary: tail ? "tail" : candidates.length ? "silence" : "hard-cut",
      candidateSamples: candidates,
    });
    start = end;
  }
  validateChunks(result, frames, rate);
  return result;
}
/** The Silero score frame grid is pinned at 512 samples by the reused VAD C API. */
export function silenceFromScores(
  scores: number[],
  frames: number,
  rate: number,
) {
  if (
    rate !== 16000 ||
    scores.length !== Math.ceil(frames / 512) ||
    scores.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
  )
    throw Error("INVALID_SILERO_SCORE_GRID");
  const gaps: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i <= scores.length; i++) {
    if (i < scores.length && (scores[i] ?? 1) < 0.5) {
      start ??= i * 512;
    } else if (start !== null) {
      gaps.push({ start, end: Math.min(frames, i * 512) });
      start = null;
    }
  }
  return gaps;
}
export interface MappedRecord extends RawRecord {
  requestId: string;
  chunkId: string;
  chunkIndex: number;
  audioGlobalStart: number | null;
  audioGlobalEnd: number | null;
}
export function mapRaw(
  content: string,
  rawHash: string,
  chunk: Chunk,
  rate: number,
  offset: number,
  sourceEnd: number,
  requestId = chunk.id,
): MappedRecord[] {
  if (
    !Number.isFinite(offset) ||
    offset < 0 ||
    !Number.isFinite(sourceEnd) ||
    sourceEnd <= offset
  )
    throw Error("INVALID_TIMEBASE");
  const duration = (chunk.inputEnd - chunk.inputStart) / rate;
  return rawRecords(content, `${requestId}:${rawHash}`).map((r) => {
    const issues: string[] = [];
    const s = r.localStart,
      e = r.localEnd;
    if (s === null || e === null) issues.push("NONFINITE_OR_UNPARSED_TIME");
    else {
      if (s < 0 || e < 0) issues.push("NEGATIVE_TIME");
      if (e === s) issues.push("ZERO_DURATION");
      if (e < s) issues.push("REVERSED_INTERVAL");
      if (s > duration || e > duration) issues.push("OUT_OF_REQUEST_RANGE");
    }
    const ags = s === null ? null : s + chunk.inputStart / rate,
      age = e === null ? null : e + chunk.inputStart / rate;
    const sourceStart = ags === null ? null : ags + offset,
      sourceFinish = age === null ? null : age + offset;
    if (
      sourceStart !== null &&
      sourceFinish !== null &&
      (sourceStart < 0 || sourceFinish > sourceEnd || sourceStart > sourceEnd)
    )
      issues.push("OUT_OF_SOURCE_RANGE");
    if (!r.text?.trim()) issues.push("EMPTY_OR_UNPARSED_TEXT");
    if (
      !issues.length &&
      sourceStart !== null &&
      sourceFinish !== null &&
      Math.round(sourceStart * 100) >= Math.round(sourceFinish * 100)
    )
      issues.push("SERIALIZATION_COLLAPSE");
    return {
      ...r,
      issues,
      sourceStart,
      sourceEnd: sourceFinish,
      audioGlobalStart: ags,
      audioGlobalEnd: age,
      requestId,
      chunkId: chunk.id,
      chunkIndex: chunk.index,
    };
  });
}
const visible = (r: MappedRecord) => r.text?.replace(/\s+/gu, " ").trim() ?? "";
export function boundaryDedup(
  records: MappedRecord[],
  chunks: Chunk[],
  rate: number,
) {
  const decisions: {
    leftId: string;
    rightId: string;
    overlap: number[];
    status: "ALIAS" | "BOUNDARY_AMBIGUITY";
    keepId: string | null;
    aliasId: string | null;
    rule: string;
  }[] = [];
  const pairs: { a: MappedRecord; b: MappedRecord; lo: number; hi: number }[] =
    [];
  for (let i = 0; i + 1 < chunks.length; i++) {
    const a = required(chunks[i]),
      b = required(chunks[i + 1]);
    const lo = Math.max(a.inputStart, b.inputStart) / rate,
      hi = Math.min(a.inputEnd, b.inputEnd) / rate;
    if (hi <= lo) continue;
    const left = records.filter(
      (r) =>
        r.chunkId === a.id &&
        !r.issues.length &&
        r.audioGlobalStart !== null &&
        r.audioGlobalEnd !== null &&
        r.audioGlobalStart < hi &&
        r.audioGlobalEnd > lo,
    );
    const right = records.filter(
      (r) =>
        r.chunkId === b.id &&
        !r.issues.length &&
        r.audioGlobalStart !== null &&
        r.audioGlobalEnd !== null &&
        r.audioGlobalStart < hi &&
        r.audioGlobalEnd > lo,
    );
    for (const x of left)
      for (const y of right)
        if (
          Math.min(required(x.audioGlobalEnd), required(y.audioGlobalEnd), hi) >
          Math.max(
            required(x.audioGlobalStart),
            required(y.audioGlobalStart),
            lo,
          )
        )
          pairs.push({ a: x, b: y, lo, hi });
  }
  const aliases = new Map<string, string>();
  for (const { a, b, lo, hi } of pairs) {
    const same = visible(a) === visible(b),
      unique = [a, b].every(
        (r) =>
          pairs.filter(
            (p) => p.a.recordId === r.recordId || p.b.recordId === r.recordId,
          ).length === 1,
      );
    let keep: MappedRecord | null = null;
    const rank = (r: MappedRecord) => {
      const c = required(chunks[r.chunkIndex]);
      const center =
        ((required(r.audioGlobalStart) + required(r.audioGlobalEnd)) * rate) /
        2;
      return [
        center >= c.coreStart && center < c.coreEnd ? 1 : 0,
        Math.min(center - c.inputStart, c.inputEnd - center),
      ];
    };
    if (
      same &&
      unique &&
      Array.from(visible(a)).length > POLICY.shortTextCodepoints
    ) {
      const ar = rank(a),
        br = rank(b);
      if (ar[0] !== br[0]) keep = required(ar[0]) > required(br[0]) ? a : b;
      else if (ar[1] !== br[1])
        keep = required(ar[1]) > required(br[1]) ? a : b;
    }
    const alias = keep ? (keep === a ? b : a) : null;
    if (alias && keep) aliases.set(alias.recordId, keep.recordId);
    decisions.push({
      leftId: a.recordId,
      rightId: b.recordId,
      overlap: [lo, hi],
      status: keep ? "ALIAS" : "BOUNDARY_AMBIGUITY",
      keepId: keep?.recordId ?? null,
      aliasId: alias?.recordId ?? null,
      rule: "adjacent-overlap-exact-whitespace-only-unique-long-text-core-center-v1",
    });
  }
  return {
    decisions,
    aliases: Object.fromEntries(aliases),
    retained: records.filter(
      (r) => !r.issues.length && !aliases.has(r.recordId),
    ),
    unresolved: records.filter((r) => r.issues.length),
  };
}
export const formats = {
  srt: { format: formatSrt, parse: parseSrt },
  vtt: { format: formatVtt, parse: parseVtt },
  ass: { format: formatAss, parse: parseAss },
};
export function serializeRecords(
  records: MappedRecord[],
  language: "ja" | "en" | "zh",
) {
  const cues = assemble(
    records.map((r) =>
      subtitleCueSchema.parse({
        id: r.recordId,
        start: Math.round(required(r.sourceStart) * 100) / 100,
        end: Math.round(required(r.sourceEnd) * 100) / 100,
        text: r.text,
        language,
        languages: [language],
        speaker: null,
        confidence: null,
      }),
    ),
    "primary-minimal",
  ).cues;
  const result = Object.fromEntries(
    Object.entries(formats).map(([f, adapter]) => [f, adapter.format(cues)]),
  );
  for (const [f, adapter] of Object.entries(formats)) {
    const parsed = adapter.parse(required(result[f]));
    if (
      parsed.length !== cues.length ||
      parsed.some(
        (c, i) =>
          c.text !== required(cues[i]).text ||
          c.start !== required(cues[i]).start ||
          c.end !== required(cues[i]).end,
      )
    )
      throw Error(`SERIALIZATION_TEXT_OR_TIMING_LOSS:${f}`);
  }
  return { cues, files: result };
}
export function reserveAttempt(
  chunks: Chunk[],
  rate: number,
  attempts: { chunkId: string; seconds: number; state: string }[],
  chunkId: string,
) {
  const c = chunks.find((x) => x.id === chunkId);
  if (!c) throw Error("UNKNOWN_CHUNK");
  const prior = attempts.filter((a) => a.chunkId === chunkId);
  if (prior.some((a) => a.state === "completed"))
    throw Error("SUCCESS_MUST_NOT_RETRY");
  if (prior.some((a) => a.state === "running"))
    throw Error("INTERRUPTED_ATTEMPT_REQUIRES_INSPECTION");
  const retries =
    attempts.length - new Set(attempts.map((a) => a.chunkId)).size;
  const seconds = (c.inputEnd - c.inputStart) / rate;
  const planned = chunks.reduce(
    (n, v) => n + (v.inputEnd - v.inputStart) / rate,
    0,
  );
  if (
    chunks.length > 64 ||
    attempts.length >= Math.min(65, chunks.length + 1) ||
    (prior.length && retries >= 1) ||
    attempts.reduce((n, a) => n + a.seconds, 0) + seconds > planned + 30 + 1e-8
  )
    throw Error("REQUEST_BUDGET_EXCEEDED");
  return { chunkId, seconds, state: "running" };
}
