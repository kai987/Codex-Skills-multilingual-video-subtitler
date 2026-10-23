/** Representation only. No recognition, neighbor timing or raw/mapped writes. */
import {
  decimal,
  add,
  cmp,
  timingDiagnostics,
  diskTimes,
} from "./bounded-diagnostics.mjs";
import { formats } from "../../packages/video-subtitler/dist/standalone/bounded.js";

export const projectionPolicy = Object.freeze({
  version: "representation-grid-projection-v1",
  grid: "1/100",
  arithmetic: "exact-rational-bigint",
  adjustment: "only-out-of-bounds-edge",
  maximumEdgeDistance: "strictly-less-than-one-grid",
});
export const rat = (x) => ({
  n: BigInt(x.numerator),
  d: BigInt(x.denominator),
});
const num = (x) => Number(x.n) / Number(x.d);
const pack = (x) => ({
  numerator: String(x.n),
  denominator: String(x.d),
  seconds: num(x),
});
const neg = (x) => ({ n: -x.n, d: x.d });
const delta = (a, b) => add(a, neg(b));
const abs = (x) => ({ n: x.n < 0n ? -x.n : x.n, d: x.d });
const floor = (n, d) => (n >= 0n ? n / d : -((-n + d - 1n) / d));
const tick = (x, up) => ({
  n: up ? -floor(-x.n * 100n, x.d) : floor(x.n * 100n, x.d),
  d: 100n,
});
const allowed = new Set([
  "SERIALIZED_START_BEFORE_REQUEST",
  "SERIALIZED_END_AFTER_REQUEST",
  "SERIALIZED_OUT_OF_SOURCE_RANGE",
]);

export function projectRecord(record, chunk, manifest) {
  const t = timingDiagnostics(record, chunk, manifest);
  const base = {
    recordId: record.recordId,
    chunkId: record.chunkId,
    raw: t.raw,
    geometry: t.geometry,
    mapped: t.mapped,
    legacySerialized: t.serialized,
    rawIssues: t.rawIssues,
    mappedIssues: t.mappedIssues,
    serializedIssues: t.serializedIssues,
  };
  const fail = (reason, eligible = false) => ({
    ...base,
    eligible,
    status: "UNRECOVERED",
    reason,
    recoveredSerialized: null,
    deltas: null,
  });
  if (t.rawIssues.length || t.mappedIssues.length)
    return fail("RAW_OR_MAPPED_INVALID");
  if (!t.serializedIssues.length)
    return {
      ...base,
      eligible: false,
      status: "UNCHANGED",
      reason: null,
      recoveredSerialized: { start: t.serialized.start, end: t.serialized.end },
      deltas: null,
    };
  if (t.serializedIssues.some((x) => !allowed.has(x)))
    return fail("NOT_REPRESENTATION_ONLY");
  const ms = rat(t.mapped.start),
    me = rat(t.mapped.end),
    rs = rat(t.geometry.requestStart),
    re = rat(t.geometry.requestEnd),
    ss = rat(t.geometry.sourceStart),
    se = rat(t.geometry.sourceEnd);
  const ls = rat(t.serialized.start),
    le = rat(t.serialized.end);
  const s = cmp(ls, rs) < 0 || cmp(ls, ss) < 0 ? tick(ms, true) : ls;
  const e = cmp(le, re) > 0 || cmp(le, se) > 0 ? tick(me, false) : le;
  if (
    cmp(s, e) >= 0 ||
    cmp(s, rs) < 0 ||
    cmp(e, re) > 0 ||
    cmp(s, ss) < 0 ||
    cmp(e, se) > 0
  )
    return fail("NO_LEGAL_GRID_PAIR", true);
  if (
    cmp(abs(delta(s, ms)), decimal("0.01")) >= 0 ||
    cmp(abs(delta(e, me)), decimal("0.01")) >= 0
  )
    return fail("MOVEMENT_NOT_SUBGRID", true);
  const projected = { ...record, sourceStart: num(s), sourceEnd: num(e) };
  try {
    formatProjection([projected], manifest.language);
  } catch {
    return fail("TEXT_NOT_LOSSLESS", true);
  }
  return {
    ...base,
    eligible: true,
    status: "RECOVERED",
    reason: "REPRESENTATION_GRID_PROJECTION",
    recoveredSerialized: { start: pack(s), end: pack(e) },
    deltas: {
      startFromMapped: pack(delta(s, ms)),
      endFromMapped: pack(delta(e, me)),
      startFromLegacy: pack(delta(s, ls)),
      endFromLegacy: pack(delta(e, le)),
      durationFromLegacy: pack(delta(delta(e, s), delta(le, ls))),
    },
  };
}

// Projection objects are separate from immutable evidence records. No assemble/text cleanup.
export function formatProjection(records, language) {
  const cues = records.map((r) => ({
    id: r.recordId,
    start: r.sourceStart,
    end: r.sourceEnd,
    text: r.text,
    language,
    languages: [language],
    speaker: null,
    confidence: null,
    style: "default",
  }));
  const out = Object.fromEntries(
    Object.entries(formats).map(([f, a]) => [f, a.format(cues)]),
  );
  validateProjection(out, records);
  return out;
}
export function validateProjection(contents, records, byId = null) {
  const parsed = {};
  for (const [f, a] of Object.entries(formats)) {
    const cues = a.parse(contents[f]),
      times = diskTimes(f, contents[f]);
    if (cues.length !== records.length || times.length !== records.length)
      throw Error("PROJECTION_DISK_COUNT");
    cues.forEach((c, i) => {
      const r = records[i],
        s = times[i].start,
        e = times[i].end;
      if (
        c.text !== r.text ||
        !s ||
        !e ||
        cmp(s, decimal(r.sourceStart)) ||
        cmp(e, decimal(r.sourceEnd)) ||
        cmp(s, e) >= 0 ||
        (f === "srt" && c.sourceId !== String(i + 1)) ||
        (f === "vtt" && c.sourceId !== r.recordId)
      )
        throw Error("PROJECTION_DISK_TEXT_ORDER_TIME");
      if ((s.n * 100n) % s.d || (e.n * 100n) % e.d)
        throw Error("PROJECTION_NOT_COMMON_GRID");
      if (byId) {
        const g = byId.get(r.recordId).geometry;
        if (
          cmp(s, rat(g.requestStart)) < 0 ||
          cmp(e, rat(g.requestEnd)) > 0 ||
          cmp(s, rat(g.sourceStart)) < 0 ||
          cmp(e, rat(g.sourceEnd)) > 0
        )
          throw Error("PROJECTION_DISK_BOUNDS");
      }
    });
    parsed[f] = cues.map((c) => ({ text: c.text, start: c.start, end: c.end }));
  }
  if (
    JSON.stringify(parsed.ass) !== JSON.stringify(parsed.srt) ||
    JSON.stringify(parsed.ass) !== JSON.stringify(parsed.vtt)
  )
    throw Error("PROJECTION_FORMAT_PARITY");
  return { status: "passed", formats: 3, records: records.length };
}
