/** Post-hoc reference diagnostics, not speech detection or a provider request. */
import { identity } from "./content-review-plan.mjs";
import { decimal, add } from "./bounded-diagnostics.mjs";
const plus = (a, b) => {
  const q = add(decimal(a), decimal(b));
  return Number(q.n) / Number(q.d);
};
const minus = (a, b) => plus(a, -b);
import {
  textStream,
  textRules,
  compareStreams,
  referenceFlags,
} from "./historical-reference-text.mjs";
export const localizationPolicy = Object.freeze({
  version: "reference-guided-missing-localization-v1",
  alignmentPolicy: "exact-visible-v1",
  lowCoverage: 0.25,
  mismatchShare: 0.5,
  mergeGap: 0.5,
  context: 1,
  maxRequest: 30,
  maxWindows: 12,
  maxSeconds: 180,
  postHoc: true,
  calibratedPrecisionRecall: false,
});
const valid = (s, e) =>
  Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s;
export function coverage(start, end, records) {
  if (!valid(start, end))
    return { recordIds: [], unionSeconds: null, ratio: null };
  const overlapping = records.filter(
    (r) =>
      valid(r.sourceStart, r.sourceEnd) &&
      r.sourceStart < end &&
      r.sourceEnd > start,
  );
  const spans = overlapping
    .map((r) => [Math.max(start, r.sourceStart), Math.min(end, r.sourceEnd)])
    .sort((a, b) => a[0] - b[0]);
  let seconds = 0,
    edge = start;
  for (const [s, e] of spans) {
    seconds = plus(seconds, Math.max(0, minus(e, Math.max(s, edge))));
    edge = Math.max(edge, e);
  }
  return {
    recordIds: overlapping.map((r) => r.recordId),
    unionSeconds: seconds,
    ratio: Math.min(1, seconds / minus(end, start)),
  };
}
export function localize(reference, recovered, fullEdit, bounds) {
  if (
    fullEdit.status !== "COMPUTED" ||
    fullEdit.policy !== localizationPolicy.alignmentPolicy
  )
    throw Error("LOCALIZATION_ALIGNMENT_UNAVAILABLE");
  const counts = new Map(reference.map((r) => [r.refId, { M: 0, S: 0, D: 0 }]));
  for (const e of fullEdit.edits)
    if (e.reference) {
      const c = counts.get(e.reference.recordId);
      if (!c || !["M", "S", "D"].includes(e.op))
        throw Error("REFERENCE_PROVENANCE_CONFLICT");
      c[e.op]++;
    }
  const rows = reference.map((r) => {
    const chars = Array.from(r.visibleText ?? ""),
      length = chars.length,
      nonWhitespace = chars.filter((c) => !/^\s$/u.test(c)).length,
      c = counts.get(r.refId);
    if (c.M + c.S + c.D !== length)
      throw Error("REFERENCE_CODEPOINT_ACCOUNTING");
    const locatable =
      r.parseStatus === "PARSED" &&
      valid(r.start, r.end) &&
      r.start >= bounds.start &&
      r.end <= bounds.end;
    const cov = coverage(locatable ? r.start : null, r.end, recovered),
      ratio = cov.ratio,
      deletion = length ? c.D / length : null,
      changed = length ? (c.S + c.D) / length : null;
    let priority = null;
    if (ratio !== null) {
      if (nonWhitespace >= 2 && ratio === 0 && deletion >= 0.5) priority = "P0";
      else if (nonWhitespace >= 4 && ratio < 0.25 && deletion >= 0.6)
        priority = "P1";
      else if (nonWhitespace >= 6 && ratio >= 0.25 && deletion >= 0.75)
        priority = "P2";
    }
    const reasons = [];
    if (ratio === null) reasons.push("UNLOCATABLE");
    else if (ratio === 0) reasons.push("NO_TIMED_B_COVERAGE");
    else if (ratio < 0.25) reasons.push("LOW_TIMED_B_COVERAGE");
    if (deletion !== null && deletion >= 0.5)
      reasons.push("REFERENCE_DELETION_HEAVY");
    if (ratio !== null && ratio >= 0.25 && changed >= 0.5)
      reasons.push("CONTENT_MISMATCH_HEAVY");
    return {
      referenceId: r.refId,
      start: r.start,
      end: r.end,
      duration: valid(r.start, r.end) ? minus(r.end, r.start) : null,
      style: r.style,
      visibleTextLength: length,
      nonWhitespaceLength: nonWhitespace,
      overlappingRecordIds: cov.recordIds,
      overlapUnionSeconds: cov.unionSeconds,
      temporalCoverageRatio: ratio,
      matchCount: c.M,
      substitutionCount: c.S,
      deletionCount: c.D,
      referenceDeletionShare: deletion,
      referenceChangedShare: changed,
      timingRisk: locatable
        ? "REFERENCE_TIMING_NOT_ACOUSTICALLY_REVERIFIED"
        : "UNLOCATABLE",
      localizationClass:
        ratio === null
          ? "UNLOCATABLE"
          : priority === "P2"
            ? "CONTENT_MISMATCH_CANDIDATE"
            : priority
              ? "POTENTIAL_MISSING_DIALOGUE"
              : "DIAGNOSTIC_ONLY",
      priority,
      reasonCodes: reasons,
      editPathIsTimeAlignment: false,
      repeatedTextAlignmentMayBeAmbiguous: true,
    };
  });
  const candidates = rows
    .filter((r) => r.priority === "P0" || r.priority === "P1")
    .sort(
      (a, b) => a.start - b.start || a.referenceId.localeCompare(b.referenceId),
    );
  const groups = [];
  for (const r of candidates) {
    const last = groups.at(-1);
    if (last && minus(r.start, last.sourceEnd) <= 0.5) {
      last.sourceEnd = Math.max(last.sourceEnd, r.end);
      last.rows.push(r);
    } else groups.push({ sourceStart: r.start, sourceEnd: r.end, rows: [r] });
  }
  const regions = groups.map((g) => {
    const ids = g.rows.map((r) => r.referenceId),
      cov = coverage(g.sourceStart, g.sourceEnd, recovered);
    return {
      regionId: "region-" + identity(ids).slice(0, 24),
      sourceStart: g.sourceStart,
      sourceEnd: g.sourceEnd,
      priority: g.rows.some((r) => r.priority === "P0") ? "P0" : "P1",
      p0ReferenceCount: g.rows.filter((r) => r.priority === "P0").length,
      referenceIds: ids,
      referenceTexts: ids.map(
        (id) => reference.find((r) => r.refId === id).visibleText,
      ),
      referenceTextUse: "DIAGNOSTIC_DISPLAY_ONLY_NEVER_PROMPT",
      overlappingRecordIds: cov.recordIds,
      temporalCoverageRatio: cov.ratio,
      overlapUnionSeconds: cov.unionSeconds,
      deletionCodepoints: g.rows.reduce((n, r) => n + r.deletionCount, 0),
      reasonCodes: [...new Set(g.rows.flatMap((r) => r.reasonCodes))],
    };
  });
  return {
    policy: localizationPolicy,
    ...referenceFlags,
    rows,
    candidates,
    regions,
    plan: planWindows(regions, reference, recovered, bounds),
  };
}
export function planWindows(regions, reference, recovered, bounds) {
  if (!valid(bounds.start, bounds.end)) throw Error("UNKNOWN_SOURCE_GEOMETRY");
  const saved = [
    ...new Set(
      [
        ...reference.flatMap((r) => [r.start, r.end]),
        ...recovered.flatMap((r) => [r.sourceStart, r.sourceEnd]),
      ].filter(
        (x) => Number.isFinite(x) && x >= bounds.start && x <= bounds.end,
      ),
    ),
  ].sort((a, b) => a - b);
  const referenceEdges = [
    ...new Set(
      reference.flatMap((r) => [r.start, r.end]).filter(Number.isFinite),
    ),
  ].sort((a, b) => a - b);
  const rank = (a, b) =>
    b.p0ReferenceCount - a.p0ReferenceCount ||
    b.deletionCodepoints - a.deletionCodepoints ||
    a.temporalCoverageRatio - b.temporalCoverageRatio ||
    a.sourceStart - b.sourceStart ||
    a.regionId.localeCompare(b.regionId);
  const windows = [],
    deferred = [];
  for (const r of [...regions].sort(rank)) {
    let cursor = r.sourceStart,
      index = 0;
    const pieces = [];
    while (cursor < r.sourceEnd) {
      const requestStart = Math.max(bounds.start, minus(cursor, 1)),
        maxEnd = plus(requestStart, 30);
      let end = r.sourceEnd;
      if (Math.min(bounds.end, plus(end, 1)) > maxEnd) {
        const limit = minus(maxEnd, 1),
          choose = (edges) =>
            edges.filter((x) => x > cursor && x <= limit).at(-1);
        end = choose(referenceEdges) ?? choose(saved);
        if (end === undefined) {
          deferred.push({
            regionId: r.regionId,
            coreStart: cursor,
            coreEnd: r.sourceEnd,
            status: "deferred",
            reason: "NO_SAVED_LEGAL_SPLIT_BOUNDARY",
          });
          break;
        }
      }
      const requestEnd = Math.min(bounds.end, plus(end, 1)),
        seconds = minus(requestEnd, requestStart);
      pieces.push({
        windowId: r.regionId + "-window-" + String(++index).padStart(3, "0"),
        regionId: r.regionId,
        priority: r.priority,
        referenceIds: r.referenceIds,
        coreStart: cursor,
        coreEnd: end,
        requestStart,
        requestEnd,
        seconds,
        prompt: null,
        referenceTextUsedAsPrompt: false,
        executionAuthorized: false,
      });
      cursor = end;
    }
    for (const w of pieces) {
      const used = windows.reduce((n, x) => plus(n, x.seconds), 0);
      if (
        windows.length < 12 &&
        plus(used, w.seconds) <= 180 &&
        w.seconds <= 30
      )
        windows.push({ ...w, status: "scheduled" });
      else
        deferred.push({
          ...w,
          status: "deferred",
          reason:
            windows.length >= 12 ? "WINDOW_BUDGET" : "AUDIO_SECONDS_BUDGET",
        });
    }
  }
  return {
    policy: localizationPolicy.version,
    plannedOnly: true,
    LOCAL_ASR_EXECUTED: false,
    referenceGuidedPostHoc: true,
    selectionUsesA: false,
    limits: { windows: 12, seconds: 180, requestSeconds: 30 },
    scheduled: windows,
    deferred,
    plannedWindows: windows.length,
    plannedSeconds: windows.reduce((n, w) => plus(n, w.seconds), 0),
  };
}
export function deliverableComparison(strict, recovered, reference) {
  const R = textStream(reference, "R"),
    out = [];
  for (const [side, records] of Object.entries({ strict, recovered }))
    for (const policy of textRules.policies) {
      const { edits, ...row } = compareStreams(
        R,
        textStream(records, side),
        policy,
      );
      out.push({ side, ...row, editPathHash: identity(edits) });
    }
  return {
    comparisonKind: "DELIVERABLE_TO_HISTORICAL_REFERENCE",
    ...referenceFlags,
    postHoc: true,
    CER: "NOT_MEASURED",
    rows: out,
  };
}
