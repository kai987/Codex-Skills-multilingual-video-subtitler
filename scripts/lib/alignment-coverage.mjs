/** Offline input coverage only: machine cue times are not acoustic truth. */
import assert from "node:assert/strict";

export const coveragePolicy = Object.freeze({
  version: "alignment-input-coverage-v1",
  maximumWindowSeconds: 8,
  contextMarginSeconds: 0.5,
  inferenceRequests: 0,
  automaticMutation: false,
});
const intersects = (r, w) =>
  r.sourceStart < w.end - 1e-8 && r.sourceEnd > w.start + 1e-8;
const normalized = (text) =>
  text.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "");
const quantize = (n) => Math.round(n * 16000) / 16000;

export function auditAlignmentCoverage({
  baseline,
  recordIds,
  text,
  windows,
  views,
  viewWindow,
  offset,
  end,
}) {
  assert(
    Number.isFinite(offset) &&
      Number.isFinite(end) &&
      offset >= 0 &&
      end > offset,
    "INVALID_AUDIO_BOUNDS",
  );
  assert(Array.isArray(baseline) && baseline.length, "NO_BASELINE");
  const ids = new Set();
  for (const r of baseline) {
    assert(
      typeof r.recordId === "string" && r.recordId && !ids.has(r.recordId),
      "DUPLICATE_RECORD_ID",
    );
    ids.add(r.recordId);
    assert(typeof r.text === "string" && r.text.trim(), "EMPTY_RECORD_TEXT");
    assert(
      Number.isFinite(r.sourceStart) &&
        Number.isFinite(r.sourceEnd) &&
        r.sourceStart >= offset &&
        r.sourceEnd <= end + 1e-8 &&
        r.sourceEnd > r.sourceStart,
      "INVALID_RECORD_TIME",
    );
  }
  assert(
    recordIds.length &&
      new Set(recordIds).size === recordIds.length &&
      recordIds.every((id) => ids.has(id)),
    "INVALID_TARGET_IDS",
  );
  const rows = [...baseline].sort(
    (a, b) =>
      a.sourceStart - b.sourceStart ||
      a.sourceEnd - b.sourceEnd ||
      a.recordId.localeCompare(b.recordId),
  );
  const target = rows.filter((r) => recordIds.includes(r.recordId));
  assert.deepEqual(
    target.map((r) => r.recordId),
    recordIds,
    "TARGET_ORDER_MISMATCH",
  );
  assert.equal(target.map((r) => r.text).join(""), text, "TARGET_TEXT_CHANGED");
  const validWindow = (w) =>
    assert(
      Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.start >= offset &&
        w.end <= end + 1e-8 &&
        w.end > w.start,
      "INVALID_WINDOW",
    );
  assert(
    windows.length && new Set(windows.map((w) => w.id)).size === windows.length,
    "INVALID_WINDOWS",
  );
  validWindow(viewWindow);
  const windowAudits = windows.map((w) => {
    validWindow(w);
    const touched = rows.filter((r) => intersects(r, w));
    const omitted = touched.filter((r) => !recordIds.includes(r.recordId));
    const partial = touched.filter(
      (r) => r.sourceStart < w.start - 1e-8 || r.sourceEnd > w.end + 1e-8,
    );
    const blockers = [];
    if (omitted.length) blockers.push("INTERSECTING_CUE_TEXT_OMITTED");
    if (partial.length) blockers.push("PARTIAL_MACHINE_CUE_AT_CROP");
    if (
      target.some(
        (r) => r.sourceStart < w.start - 1e-8 || r.sourceEnd > w.end + 1e-8,
      )
    )
      blockers.push("TARGET_NOT_FULLY_COVERED");
    if (w.end - w.start > coveragePolicy.maximumWindowSeconds + 1e-8)
      blockers.push("WINDOW_BUDGET_EXCEEDED");
    // Monotonic closure; never shave text or silently widen the budget.
    let proposed = { start: w.start, end: w.end };
    const steps = [];
    for (let i = 0; i <= rows.length; i++) {
      const hits = rows.filter((r) => intersects(r, proposed));
      const next = {
        start: quantize(
          Math.max(
            offset,
            Math.min(
              proposed.start,
              ...hits.map(
                (r) => r.sourceStart - coveragePolicy.contextMarginSeconds,
              ),
            ),
          ),
        ),
        end: quantize(
          Math.min(
            end,
            Math.max(
              proposed.end,
              ...hits.map(
                (r) => r.sourceEnd + coveragePolicy.contextMarginSeconds,
              ),
            ),
          ),
        ),
      };
      if (next.start === proposed.start && next.end === proposed.end) break;
      proposed = next;
      steps.push({ ...next, recordIds: hits.map((r) => r.recordId) });
      if (next.end - next.start > coveragePolicy.maximumWindowSeconds + 1e-8)
        break;
    }
    const proposedRows = rows.filter((r) => intersects(r, proposed));
    const tooLong =
      proposed.end - proposed.start >
      coveragePolicy.maximumWindowSeconds + 1e-8;
    return {
      id: w.id,
      start: w.start,
      end: w.end,
      blockers,
      omitted: omitted.map((r) => ({
        recordId: r.recordId,
        text: r.text,
        sourceStart: r.sourceStart,
        sourceEnd: r.sourceEnd,
        overlapSeconds:
          Math.min(r.sourceEnd, w.end) - Math.max(r.sourceStart, w.start),
      })),
      partialRecordIds: partial.map((r) => r.recordId),
      contextProposal: {
        ...proposed,
        seconds: quantize(proposed.end - proposed.start),
        steps,
        status: tooLong
          ? "DEFERRED_WINDOW_BUDGET"
          : "MACHINE_CUE_COVERAGE_ONLY",
        spans: proposedRows.map((r) => ({
          recordId: r.recordId,
          role: recordIds.includes(r.recordId) ? "target" : "context",
          text: r.text,
          sourceStart: r.sourceStart,
          sourceEnd: r.sourceEnd,
        })),
        partialRecordIds: proposedRows
          .filter(
            (r) =>
              r.sourceStart < proposed.start - 1e-8 ||
              r.sourceEnd > proposed.end + 1e-8,
          )
          .map((r) => r.recordId),
        modelReady: false,
      },
    };
  });
  const donorIds = new Set();
  const donorViews = views.map((v) => {
    assert(
      typeof v.backend === "string" && !donorIds.has(v.backend),
      "DUPLICATE_BACKEND",
    );
    donorIds.add(v.backend);
    assert(v.targetId === viewWindow.id, "WRONG_DONOR_WINDOW");
    const valid =
      v.unresolvedCount === 0 &&
      Array.isArray(v.records) &&
      v.records.length > 0 &&
      v.records.every(
        (r) =>
          typeof r.text === "string" &&
          Number.isFinite(r.sourceStart) &&
          Number.isFinite(r.sourceEnd) &&
          r.sourceStart >= viewWindow.start - 1e-8 &&
          r.sourceEnd <= viewWindow.end + 1e-8 &&
          r.sourceEnd > r.sourceStart,
      );
    const donorText = valid ? v.records.map((r) => r.text).join("") : "";
    const needle = normalized(text),
      haystack = normalized(donorText);
    const start = needle ? haystack.indexOf(needle) : -1;
    const unique = start >= 0 && haystack.indexOf(needle, start + 1) < 0;
    return {
      backend: v.backend,
      valid,
      recordIds: valid ? v.records.map((r) => r.recordId) : [],
      sourceWindow: { start: viewWindow.start, end: viewWindow.end },
      originalText: donorText,
      normalizedText: haystack,
      uniqueTargetTextMatch: unique,
      // Text positions only, deliberately not token timestamps.
      normalizedPrefix: unique ? haystack.slice(0, start) : null,
      normalizedSuffix: unique ? haystack.slice(start + needle.length) : null,
      targetTimingSupported: false,
    };
  });
  const contextConflict =
    donorViews.length > 1 &&
    donorViews.every((v) => v.valid) &&
    new Set(donorViews.map((v) => v.normalizedText)).size > 1;
  const blockers = [...new Set(windowAudits.flatMap((w) => w.blockers))];
  if (donorViews.length < 2 || donorViews.some((v) => !v.valid))
    blockers.push("INSUFFICIENT_VALID_SAVED_VIEWS");
  if (contextConflict) blockers.push("SAVED_CONTEXT_TEXT_DISAGREEMENT");
  if (donorViews.some((v) => !v.uniqueTargetTextMatch))
    blockers.push("TARGET_TEXT_ASSOCIATION_UNRESOLVED");
  return {
    policy: coveragePolicy,
    status: blockers.length
      ? "BLOCKED_INPUT_COVERAGE"
      : "MACHINE_INPUT_COVERAGE_ONLY",
    target: { recordIds, text },
    windowAudits,
    donorViews,
    blockers,
    acousticCoverageVerified: false,
    modelDispatchAllowed: false,
    subtitleMutationAuthorized: false,
    reason:
      "Machine cue coverage and string containment cannot establish complete acoustic transcript or reliable boundaries.",
  };
}
