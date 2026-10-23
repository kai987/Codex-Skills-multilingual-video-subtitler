/** Machine-only review routing. Cue coverage is not lexical completeness. */
import assert from "node:assert/strict";
import { routeSourceOccurrence } from "./source-occurrence-routing.mjs";

export const contextRoutingPolicy = Object.freeze({
  version: "recovery-context-routing-v1",
  mode: "observe-only",
  inferenceBudget: 0,
  subtitleMutationAuthorized: false,
  retention: "all-targets-and-all-hypotheses",
  geometryMeaning: "review-purpose-not-confirmed-utterance-role",
});
const overlaps = (a, b) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-8;
const projection = (r) => ({ id: r.id, start: r.start, end: r.end });
// Source addition may yield 636.5300000000001 for a 636.53 endpoint.
// Only machine floating-point noise is clipped; raw evidence stays immutable.
export function boundActivityToCrop(intervals, crop) {
  return intervals.map(({ start, end }) => {
    assert(
      Number.isFinite(start) && Number.isFinite(end) && end > start,
      "INVALID_SOURCE_ACTIVITY",
    );
    assert(
      start >= crop.start - 1e-8 && end <= crop.end + 1e-8,
      "ACTIVITY_OUTSIDE_CROP",
    );
    return { start: Math.max(start, crop.start), end: Math.min(end, crop.end) };
  });
}
function keys(value, expected) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "OBJECT_REQUIRED",
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...expected].sort(),
    "MACHINE_FIELDS_ONLY",
  );
}

export function planContextRecovery(input) {
  keys(input, ["baseline", "targets"]);
  assert(
    Array.isArray(input.baseline) && Array.isArray(input.targets),
    "ARRAY_REQUIRED",
  );
  assert(input.targets.length > 0, "TARGETS_REQUIRED");
  for (const c of input.baseline) keys(c, ["id", "start", "end", "text"]);
  for (const t of input.targets) {
    keys(t, ["probe", "observation", "views"]);
    keys(t.probe, ["id", "start", "end", "targetStart", "targetEnd"]);
  }
  assert.equal(
    new Set(input.targets.map((t) => t.probe.id)).size,
    input.targets.length,
    "DUPLICATE_TARGET",
  );
  const rows = input.targets.map((t) => {
    keys(t, ["probe", "observation", "views"]);
    keys(t.probe, ["id", "start", "end", "targetStart", "targetEnd"]);
    keys(t.observation, ["id", "sourceIntervals"]);
    for (const a of t.observation.sourceIntervals) keys(a, ["start", "end"]);
    for (const v of t.views) {
      keys(v, ["targetId", "backend", "records"]);
      for (const r of v.records) keys(r, ["start", "end", "text"]);
    }
    const occurrence = routeSourceOccurrence({
      baseline: input.baseline,
      ...t,
    });
    const target = occurrence.target;
    const nearby = input.baseline.filter((c) => overlaps(c, occurrence.crop));
    const hosts = nearby.filter((c) => overlaps(c, target));
    const left = nearby
      .filter((c) => c.end <= target.start + 1e-8)
      .sort((a, b) => b.end - a.end || a.id.localeCompare(b.id))[0];
    const right = nearby
      .filter((c) => c.start >= target.end - 1e-8)
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))[0];
    const targetActivities = occurrence.components.filter(
      (a) => a.targetOverlap,
    );
    // A component crossing a cue edge supports a continuation hypothesis only.
    const boundaryLinks = nearby.filter(
      (c) => !hosts.includes(c) && targetActivities.some((a) => overlaps(a, c)),
    );
    const geometry =
      hosts.length > 1
        ? "multiple-existing-cue-overlap"
        : hosts.length === 1
          ? "inside-existing-cue"
          : left && right
            ? "between-existing-cues"
            : boundaryLinks.length
              ? "activity-crosses-cue-boundary"
              : "uncovered";
    const route = !targetActivities.length
      ? "retain-unsupported-review"
      : geometry === "multiple-existing-cue-overlap"
        ? "overlapping-cues-association-review"
        : geometry === "inside-existing-cue"
          ? "inside-existing-cue-review"
          : geometry === "between-existing-cues"
            ? "between-cues-association-review"
            : geometry === "activity-crosses-cue-boundary"
              ? "cue-boundary-continuation-review"
              : occurrence.route === "text-consensus-boundaries-unverified"
                ? "possible-new-utterance-review"
                : t.views.length
                  ? "uncovered-mixed-context-review"
                  : "uncovered-unlocalized-review";
    const warnings = [
      ...new Set(occurrence.components.flatMap((c) => c.blockers)),
    ];
    warnings.push("NO_WORD_LEVEL_OCCURRENCE_PROOF");
    if (hosts.length)
      warnings.push("CUE_OCCUPANCY_DOES_NOT_EXCLUDE_MISSING_INTERJECTION");
    if (geometry === "between-existing-cues")
      warnings.push("GAP_IS_NOT_CONFIRMED_MISSING_UTTERANCE");
    if (boundaryLinks.length) warnings.push("VAD_EDGE_IS_NOT_SUBTITLE_EDGE");
    const linked = occurrence.donors.filter((d) => d.baselineLinks.length);
    const unlinked = occurrence.donors.filter((d) => !d.baselineLinks.length);
    return {
      id: occurrence.id,
      target,
      crop: occurrence.crop,
      route,
      baselineGeometry: {
        kind: geometry,
        hosts: hosts.map(projection),
        preceding: left ? projection(left) : null,
        following: right ? projection(right) : null,
        activityBoundaryLinks: boundaryLinks.map(projection),
      },
      asrStatus: t.views.length ? "executed" : "not-run",
      originalOccurrenceRoute: occurrence.route,
      occurrence,
      existingTextHypothesisIds: linked.map((d) => d.id),
      unresolvedOtherHypothesisIds: unlinked.map((d) => d.id),
      // Retain extra replies even when a majority of the crop matches the baseline.
      warnings,
      reviewRequired: true,
      retained: true,
      safeToInsert: false,
      confirmedMissingUtterance: false,
      textComplete: null,
      requests: [],
      insertions: [],
      deletions: [],
      timingChanges: [],
      subtitleMutationAuthorized: false,
    };
  });
  return {
    policy: contextRoutingPolicy,
    rows,
    counts: Object.fromEntries(
      [...new Set(rows.map((r) => r.route))]
        .sort()
        .map((route) => [route, rows.filter((r) => r.route === route).length]),
    ),
    targets: rows.length,
    retained: rows.length,
    dropped: 0,
    labelsUsed: false,
    referenceUsed: false,
    newInference: 0,
    modelLoads: 0,
    textMutations: 0,
    timingMutations: 0,
    newUtteranceInsertions: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
