/** Read-only, post-hoc diagnostics. No provider, filesystem or process imports. */
import {
  formats,
  serializeRecords,
} from "../../packages/video-subtitler/dist/standalone/bounded.js";

export const timingContract = Object.freeze({
  version: "request-geometry-centisecond-v1",
  rounding: "existing Math.round(sourceSeconds * 100) / 100",
  comparison: "exact rational; no epsilon",
  offset: "saved JSON decimal audioOffset; origin already included",
  rawPrecision: "SRT milliseconds",
  outputPrecision: "shared centiseconds",
  policy: "quarantine; never correct",
});
export const riskPolicy = Object.freeze({
  version: "raw-text-risk-v1",
  design: "post-hoc diagnostic, not acoustic truth",
  sameCharacter: 12,
  patternMin: 2,
  patternMax: 8,
  patternRepeats: 3,
  patternCoverage: 12,
  longText: 200,
  longSeconds: 10,
  sparseCharacters: 4,
});
const gcd = (a, b) => (b ? gcd(b, a % b) : a < 0n ? -a : a);
function q(n, d = 1n) {
  if (d <= 0n) throw Error("INVALID_DENOMINATOR");
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
export function decimal(value) {
  if (typeof value === "number" && !Number.isFinite(value))
    throw Error("NONFINITE_DECIMAL");
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(String(value));
  if (!match) throw Error("INVALID_DECIMAL");
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0),
    n = BigInt(match[2] + (match[3] ?? "")) * (match[1] ? -1n : 1n);
  return scale >= 0 ? q(n, 10n ** BigInt(scale)) : q(n * 10n ** BigInt(-scale));
}
export const add = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const cmp = (a, b) =>
  a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0;
const numeric = (a) => (a === null ? null : Number(a.n) / Number(a.d));
const exact = (a) =>
  a === null
    ? null
    : { numerator: String(a.n), denominator: String(a.d), seconds: numeric(a) };
export function clock(value) {
  if (value === null) return null;
  const m = /^(-?)(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)[,.](\d{1,3})$/u.exec(
    value.trim(),
  );
  if (!m) return null;
  return q(
    (BigInt(m[2] ?? 0) * 3600000n +
      BigInt(m[3]) * 60000n +
      BigInt(m[4]) * 1000n +
      BigInt(m[5].padEnd(3, "0"))) *
      (m[1] ? -1n : 1n),
    1000n,
  );
}
export function geometry(chunk, m) {
  if (
    ![chunk.inputStart, chunk.inputEnd, m.pcm.sampleRate, m.pcm.frames].every(
      Number.isSafeInteger,
    ) ||
    chunk.inputStart < 0 ||
    chunk.inputEnd <= chunk.inputStart ||
    chunk.inputEnd > m.pcm.frames ||
    m.pcm.sampleRate <= 0
  )
    throw Error("INVALID_REQUEST_GEOMETRY");
  const rate = BigInt(m.pcm.sampleRate),
    offset = decimal(m.audioOffset);
  return {
    start: add(offset, q(BigInt(chunk.inputStart), rate)),
    end: add(offset, q(BigInt(chunk.inputEnd), rate)),
    duration: q(BigInt(chunk.inputEnd - chunk.inputStart), rate),
    sourceStart: offset,
    sourceEnd: decimal(m.sourceEnd),
  };
}
export function serializedCheck(value, chunk, m) {
  const g = geometry(chunk, m),
    issues = [];
  let s = null,
    e = null;
  try {
    s = typeof value.start?.n === "bigint" ? value.start : decimal(value.start);
  } catch {
    issues.push("SERIALIZED_UNPARSED_TIME");
  }
  try {
    e = typeof value.end?.n === "bigint" ? value.end : decimal(value.end);
  } catch {
    issues.push("SERIALIZED_UNPARSED_TIME");
  }
  if (s && cmp(s, g.start) < 0) issues.push("SERIALIZED_START_BEFORE_REQUEST");
  if (e && cmp(e, g.end) > 0) issues.push("SERIALIZED_END_AFTER_REQUEST");
  if ((s && cmp(s, g.sourceStart) < 0) || (e && cmp(e, g.sourceEnd) > 0))
    issues.push("SERIALIZED_OUT_OF_SOURCE_RANGE");
  if (s && e && cmp(s, e) >= 0) issues.push("SERIALIZATION_COLLAPSE");
  return {
    issues: [...new Set(issues)],
    start: exact(s),
    end: exact(e),
    startMinusRequest: exact(s ? sub(s, g.start) : null),
    endMinusRequest: exact(e ? sub(e, g.end) : null),
  };
}
export function timingDiagnostics(record, chunk, m) {
  const g = geometry(chunk, m),
    s = clock(record.rawStart),
    e = clock(record.rawEnd),
    rawIssues = [],
    mappedIssues = [];
  if (!s || !e) rawIssues.push("NONFINITE_OR_UNPARSED_TIME");
  if ((s && s.n < 0n) || (e && e.n < 0n)) rawIssues.push("NEGATIVE_TIME");
  if (s && e && cmp(s, e) === 0) rawIssues.push("ZERO_DURATION");
  if (s && e && cmp(s, e) > 0) rawIssues.push("REVERSED_INTERVAL");
  if ((s && cmp(s, g.duration) > 0) || (e && cmp(e, g.duration) > 0))
    rawIssues.push("OUT_OF_REQUEST_RANGE");
  if (!record.text?.trim()) rawIssues.push("EMPTY_OR_UNPARSED_TEXT");
  const ms = s ? add(g.start, s) : null,
    me = e ? add(g.start, e) : null;
  if (
    (ms && cmp(ms, g.sourceStart) < 0) ||
    (me && cmp(me, g.sourceEnd) > 0) ||
    (ms && cmp(ms, g.sourceEnd) > 0)
  )
    mappedIssues.push("OUT_OF_SOURCE_RANGE");
  let serialized = {
    status: "NOT_ATTEMPTED_UPSTREAM_INVALID",
    issues: [],
    start: null,
    end: null,
  };
  if (!rawIssues.length && !mappedIssues.length) {
    const start = Math.round(record.sourceStart * 100) / 100,
      end = Math.round(record.sourceEnd * 100) / 100;
    serialized = {
      status: "CANDIDATE",
      ...serializedCheck({ start, end }, chunk, m),
    };
    if (!serialized.issues.includes("SERIALIZATION_COLLAPSE")) {
      try {
        serializeRecords([record], m.language);
      } catch {
        serialized.issues.push("SERIALIZATION_TEXT_OR_TIMING_LOSS");
      }
    }
  }
  return {
    recordId: record.recordId,
    requestId: record.requestId,
    chunkId: record.chunkId,
    geometry: {
      inputStart: chunk.inputStart,
      inputEnd: chunk.inputEnd,
      sampleRate: m.pcm.sampleRate,
      audioOffset: m.audioOffset,
      requestStart: exact(g.start),
      requestEnd: exact(g.end),
      sourceStart: exact(g.sourceStart),
      sourceEnd: exact(g.sourceEnd),
    },
    raw: {
      startString: record.rawStart,
      endString: record.rawEnd,
      start: exact(s),
      end: exact(e),
    },
    mapped: { start: exact(ms), end: exact(me) },
    rawIssues,
    mappedIssues,
    serializedIssues: serialized.issues,
    serialized,
  };
}
export function textRisks(record, timing, policy = riskPolicy) {
  const chars = Array.from(record.text ?? ""),
    runs = [];
  for (let i = 0; i < chars.length;) {
    let end = i + 1;
    while (end < chars.length && chars[end] === chars[i]) end++;
    runs.push({ character: chars[i], start: i, end, length: end - i });
    i = end;
  }
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a), {
    character: null,
    start: null,
    end: null,
    length: 0,
  });
  const patterns = [];
  for (let i = 0; i < chars.length;) {
    let found = null;
    for (
      let width = policy.patternMin;
      width <= policy.patternMax && i + width * 2 <= chars.length;
      width++
    ) {
      const unit = chars.slice(i, i + width);
      if (
        Array.from({ length: width - 1 }, (_, k) => k + 1).some(
          (p) => width % p === 0 && unit.every((c, j) => c === unit[j % p]),
        )
      )
        continue;
      let end = i + width;
      while (
        end + width <= chars.length &&
        unit.every((c, j) => chars[end + j] === c)
      )
        end += width;
      if (end >= i + width * 2) {
        found = {
          pattern: unit.join(""),
          width,
          start: i,
          end,
          repeats: (end - i) / width,
          coverage: end - i,
        };
        break;
      }
    }
    if (found) {
      patterns.push(found);
      i = found.end;
    } else i++;
  }
  const nonWhitespace = chars.filter((c) => !/^\s$/u.test(c)).length;
  const valid = !timing.rawIssues.some((c) => c !== "EMPTY_OR_UNPARSED_TEXT");
  const duration =
    valid && timing.raw.start && timing.raw.end
      ? timing.raw.end.seconds - timing.raw.start.seconds
      : null;
  const warnings = [];
  if (longest.length >= policy.sameCharacter)
    warnings.push("LONG_SAME_CODEPOINT_RUN");
  if (
    patterns.some(
      (p) =>
        p.repeats >= policy.patternRepeats &&
        p.coverage >= policy.patternCoverage,
    )
  )
    warnings.push("SHORT_PATTERN_REPETITION");
  if (chars.length >= policy.longText) warnings.push("EXTREME_TEXT_LENGTH");
  if (
    duration !== null &&
    duration >= policy.longSeconds &&
    nonWhitespace <= policy.sparseCharacters
  )
    warnings.push("LONG_INTERVAL_SPARSE_TEXT");
  return {
    recordId: record.recordId,
    textAvailable: record.text !== null,
    codepoints: chars.length,
    nonWhitespace,
    longest,
    patterns,
    localDuration: duration,
    charactersPerSecond: duration > 0 ? nonWhitespace / duration : null,
    rateStatus:
      duration > 0
        ? "CALCULABLE_NOT_ACOUSTICALLY_VERIFIED"
        : "NOT_CALCULABLE_INVALID_OR_UNKNOWN_RAW_TIME",
    warnings,
    mutationAllowed: false,
  };
}
/** Parse actual bytes, validate order/text/identifiers and geometry independently of formatting. */
export function diskTimes(format, content) {
  const lines = content.split(/\r?\n/u),
    times = [];
  for (const line of lines) {
    if (format === "ass" && line.startsWith("Dialogue:")) {
      const fields = line.split(",");
      times.push({ start: clock(fields[1]), end: clock(fields[2]) });
    } else if (format !== "ass" && line.includes(" --> ")) {
      const [s, e] = line.split(" --> ");
      times.push({ start: clock(s), end: clock(e.trim().split(/\s+/u)[0]) });
    }
  }
  return times;
}
export function validateDiskFormats(files, records, chunks, m) {
  const parsed = {};
  for (const [format, adapter] of Object.entries(formats)) {
    const cues = adapter.parse(files[format]),
      times = diskTimes(format, files[format]);
    if (cues.length !== records.length || times.length !== records.length)
      throw Error("DISK_RECORD_COUNT_MISMATCH");
    cues.forEach((c, i) => {
      const r = records[i],
        chunk = chunks.find((x) => x.id === r.chunkId);
      if (
        !chunk ||
        c.text !== r.text ||
        (format === "srt" && c.sourceId !== String(i + 1)) ||
        (format === "vtt" && c.sourceId !== r.recordId)
      )
        throw Error("DISK_RECORD_ORDER_TEXT_MISMATCH");
      if (
        c.start !== Math.round(r.sourceStart * 100) / 100 ||
        c.end !== Math.round(r.sourceEnd * 100) / 100
      )
        throw Error("DISK_TIME_CHANGED");
      if (serializedCheck(times[i], chunk, m).issues.length)
        throw Error("DISK_REQUEST_OR_SOURCE_BOUNDARY_FAILED");
    });
    parsed[format] = cues.map((c) => ({
      text: c.text,
      start: c.start,
      end: c.end,
    }));
  }
  if (
    JSON.stringify(parsed.srt) !== JSON.stringify(parsed.ass) ||
    JSON.stringify(parsed.srt) !== JSON.stringify(parsed.vtt)
  )
    throw Error("DISK_FORMAT_PARITY_FAILED");
  return { status: "passed", records: records.length, formats: 3 };
}
