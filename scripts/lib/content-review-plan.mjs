/** Pure planning only. Stored timestamps are localization hints, not acoustic truth. */
import { createHash } from "node:crypto";
import { decimal } from "./bounded-diagnostics.mjs";
export const hash = (b) => createHash("sha256").update(b).digest("hex");
export const json = (v) => JSON.stringify(v, null, 2) + "\n";
export const identity = (v) => hash(json(v));
export const policy = Object.freeze({
  version: "frozen-content-listening-v1",
  evaluation: "ceil-start-ceil-end-half-open-decimal-rational",
  playback: "floor-start-ceil-end-physical-clip-only",
  contextSeconds: 1,
  maxTargeted: 8,
  maxTargetedSeconds: 32,
  maxClips: 56,
  maxPlaybackSeconds: 600,
  aPointClusterMaxSpanSeconds: 1,
  aPointPaddingSeconds: 2,
  targetOrder: "B-invalid-request-then-A-invalid-start-cluster",
});
export const gates = Object.freeze({
  fullTimedExport: "blocked",
  qualityStatus: "needs-review",
  contentEvaluationStatus: "AWAITING_HUMAN_REVIEW",
  CER: "NOT_MEASURED",
  humanValidated: false,
  finalizationMethod: "none",
  machineOnlyReleaseAuthorized: false,
  productDefaultChanged: false,
});
export const counters = Object.freeze(
  Object.fromEntries(
    [
      "newASRRequests",
      "newASRInference",
      "newVADDispatches",
      "newVADInference",
      "newModelLoads",
      "newProviderStarts",
      "newSourceMediaExtractions",
      "newASRAudioWindows",
      "newExternalReferenceSearches",
      "subtitleTextMutations",
      "subtitleTimingMutations",
    ].map((k) => [k, 0]),
  ),
);
const sub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const floor = ({ n, d }) => (n >= 0n ? n / d : -((-n + d - 1n) / d));
const ceil = (v) => -floor({ n: -v.n, d: v.d });
export function sampleAt(
  seconds,
  offset,
  rate,
  rounding = "ceil",
  padding = 0,
) {
  let v = sub(decimal(seconds), decimal(offset));
  v = sub(v, decimal(-padding));
  v = { n: v.n * BigInt(rate), d: v.d };
  const result = Number(rounding === "ceil" ? ceil(v) : floor(v));
  if (!Number.isSafeInteger(result)) throw Error("UNSAFE_SAMPLE_INDEX");
  return result;
}
export function bounds(item, m) {
  if (
    !Number.isFinite(item.start) ||
    !Number.isFinite(item.end) ||
    item.end <= item.start
  )
    throw Error("INVALID_REVIEW_INTERVAL");
  const rate = m.pcm.sampleRate,
    clamp = (n) => Math.max(0, Math.min(m.pcm.frames, n));
  const es = sampleAt(item.start, m.audioOffset, rate),
    ee = sampleAt(item.end, m.audioOffset, rate);
  const ps = clamp(sampleAt(item.start, m.audioOffset, rate, "floor", -1));
  const pe = clamp(sampleAt(item.end, m.audioOffset, rate, "ceil", 1));
  if (es < 0 || ee > m.pcm.frames || ee <= es || pe <= ps)
    throw Error("REVIEW_OUTSIDE_PCM");
  return {
    evaluationStart: item.start,
    evaluationEnd: item.end,
    evaluationStartSample: es,
    evaluationEndSample: ee,
    playbackStartSample: ps,
    playbackEndSample: pe,
    playbackStart: m.audioOffset + ps / rate,
    playbackEnd: m.audioOffset + pe / rate,
    evaluationStartInClipSample: es - ps,
    evaluationEndInClipSample: ee - ps,
    evaluationStartRoundingDeltaSeconds: m.audioOffset + es / rate - item.start,
    evaluationEndRoundingDeltaSeconds: m.audioOffset + ee / rate - item.end,
    frames: pe - ps,
    seconds: (pe - ps) / rate,
  };
}
export function unionSamples(intervals) {
  let end = -Infinity,
    total = 0;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (b > a) {
      total += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
  }
  return total;
}
export function planTargets(main, records, diagnostics, m) {
  const targets = [],
    excluded = [],
    indexed = [];
  const candidate = (reason, rows, start, end) => ({
    kind: "targeted",
    start,
    end,
    status: "NOT_PERFORMED",
    reason,
    recordIds: rows.map((r) => r.recordId),
    requestIds: [...new Set(rows.map((r) => r.requestId))],
  });
  const candidates = [];
  const bGroups = new Map();
  for (const d of diagnostics.B)
    if (d.rawIssues.length || d.mappedIssues.length) {
      const rows = bGroups.get(d.requestId) || [];
      rows.push(d);
      bGroups.set(d.requestId, rows);
    }
  for (const rows of bGroups.values())
    candidates.push(
      candidate(
        "B_RAW_INVALID_FULL_REQUEST",
        rows,
        rows[0].geometry.requestStart.seconds,
        rows[0].geometry.requestEnd.seconds,
      ),
    );
  const a = diagnostics.A.filter(
    (d) => d.rawIssues.length || d.mappedIssues.length,
  );
  const locatable = a
    .filter(
      (d) =>
        Number.isFinite(d.mapped.start?.seconds) &&
        d.mapped.start.seconds >= m.audioOffset &&
        d.mapped.start.seconds < m.sourceEnd,
    )
    .sort((x, y) => x.mapped.start.seconds - y.mapped.start.seconds);
  for (let i = 0; i < locatable.length;) {
    const first = locatable[i].mapped.start.seconds,
      rows = [locatable[i++]];
    while (
      i < locatable.length &&
      locatable[i].mapped.start.seconds - first <= 1
    )
      rows.push(locatable[i++]);
    candidates.push(
      candidate(
        "A_INVALID_START_LOCALIZATION_HINT_ONLY",
        rows,
        Math.max(m.audioOffset, first - 2),
        Math.min(m.sourceEnd, rows.at(-1).mapped.start.seconds + 2),
      ),
    );
  }
  for (const d of a.filter((d) => !locatable.includes(d)))
    excluded.push({
      recordIds: [d.recordId],
      reason: "UNLOCATABLE_FROM_STORED_TIMING",
    });
  let seconds = main.items.reduce((sum, i) => sum + bounds(i, m).seconds, 0);
  for (const t of candidates) {
    const b = bounds(t, m);
    if (
      targets.length >= policy.maxTargeted ||
      b.seconds > policy.maxTargetedSeconds ||
      seconds + b.seconds > policy.maxPlaybackSeconds
    ) {
      excluded.push({ ...t, reasonExcluded: "FROZEN_PLAYBACK_BUDGET" });
      continue;
    }
    t.reviewId = "target-" + identity(t).slice(0, 24);
    targets.push(t);
    seconds += b.seconds;
  }
  if (main.items.length + targets.length > 56 || seconds > 600)
    throw Error("LISTENING_BUDGET_EXCEEDED");
  for (const side of ["A", "B"])
    for (const d of diagnostics[side]) {
      const record = records[side].find((r) => r.recordId === d.recordId);
      if (
        d.serializedIssues.length ||
        d.rawIssues.length ||
        d.mappedIssues.length ||
        Array.from(record.text).length > 160
      )
        indexed.push({
          side,
          recordId: d.recordId,
          rawIssues: d.rawIssues,
          mappedIssues: d.mappedIssues,
          serializedIssues: d.serializedIssues,
          longTextCodePoints: Array.from(record.text).length,
          reviewIds: [...main.items, ...targets]
            .filter(
              (i) =>
                i.recordIds?.includes(d.recordId) ||
                hint(record, d, i) !== "UNLOCATED",
            )
            .map((i) => i.reviewId),
          note: "Index only; no additional audio or issue verdict. Full request retained.",
        });
    }
  return {
    policy,
    items: targets,
    excluded,
    indexed,
    plannedPlaybackSecondsSum: seconds,
  };
}
export function hint(record, d, item) {
  const s = d.mapped.start?.seconds,
    e = d.mapped.end?.seconds;
  if (
    !d.rawIssues.length &&
    !d.mappedIssues.length &&
    s < item.end &&
    e > item.start
  )
    return "TIME_OVERLAP_HINT";
  if (
    (d.rawIssues.length || d.mappedIssues.length) &&
    Number.isFinite(s) &&
    s >= item.start &&
    s < item.end
  )
    return "POINT_HINT";
  if (
    record.requestId !== "A-historical-full" &&
    d.geometry.requestStart.seconds < item.end &&
    d.geometry.requestEnd.seconds > item.start
  )
    return "REQUEST_CONTEXT_ONLY";
  return "UNLOCATED";
}
