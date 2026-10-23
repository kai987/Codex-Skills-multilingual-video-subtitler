/** Offline association, not subtitle timing. Never extend a detector to unseen audio. */
import assert from "node:assert/strict";
const valid = (r) =>
  r &&
  Number.isFinite(r.start) &&
  Number.isFinite(r.end) &&
  r.start >= 0 &&
  r.end > r.start;
const overlap = (a, b) => Math.min(a.end, b.end) > Math.max(a.start, b.start);
const contains = (a, b) => b.start >= a.start - 1e-6 && b.end <= a.end + 1e-6;
const textKey = (t) => t.normalize("NFC").replace(/[\p{P}\p{Z}\s]/gu, "");

export function reviewAnchoredActivity(input) {
  assert.deepEqual(
    Object.keys(input).sort(),
    [
      "activityWindow",
      "anchor",
      "baseline",
      "donor",
      "greedyText",
      "originalTarget",
      "sourceWindow",
      "vadIntervals",
    ].sort(),
    "MACHINE_FIELDS_ONLY",
  );
  const {
    activityWindow,
    anchor,
    baseline,
    donor,
    greedyText,
    originalTarget,
    sourceWindow,
    vadIntervals,
  } = input;
  assert(
    [activityWindow, anchor, donor, originalTarget, sourceWindow].every(valid),
    "INVALID_INTERVAL",
  );
  assert(
    contains(sourceWindow, activityWindow) &&
      contains(sourceWindow, anchor) &&
      contains(sourceWindow, donor) &&
      contains(sourceWindow, originalTarget),
    "SOURCE_WINDOW_BINDING",
  );
  assert(typeof donor.text === "string" && textKey(donor.text), "EMPTY_DONOR");
  assert(typeof greedyText === "string", "GREEDY_TEXT_REQUIRED");
  assert(
    baseline.every(
      (r) => valid(r) && typeof r.id === "string" && typeof r.text === "string",
    ),
    "INVALID_BASELINE",
  );
  assert(
    new Set(baseline.map((r) => r.id)).size === baseline.length,
    "DUPLICATE_BASELINE_ID",
  );
  assert(
    vadIntervals.every(
      (r, i) =>
        valid(r) &&
        contains(activityWindow, r) &&
        (!i || r.start >= vadIntervals[i - 1].end),
    ),
    "INVALID_ACTIVITY",
  );
  const matched = vadIntervals.filter((r) => contains(r, anchor));
  const activity = matched.length === 1 ? matched[0] : null;
  const textSupported = textKey(donor.text) === textKey(greedyText);
  const collisions = activity
    ? baseline
        .filter((r) => overlap(r, activity))
        .map((r) => ({
          id: r.id,
          text: r.text,
          start: r.start,
          end: r.end,
          sameText: textKey(r.text) === textKey(donor.text),
        }))
    : [];
  // Quantization guard is conservative; it never moves a timestamp.
  const leftCensored = activity
    ? activity.start <= activityWindow.start + 0.010000001
    : null;
  const rightCensored = activity
    ? activity.end >= activityWindow.end - 0.010000001
    : null;
  const blockers = ["UTTERANCE_BOUNDARIES_NOT_VERIFIED"];
  if (!contains(donor, anchor)) blockers.push("ANCHOR_OUTSIDE_DONOR");
  if (!textSupported) blockers.push("GREEDY_TEXT_DISAGREES");
  if (!activity) blockers.push("NO_UNIQUE_CONTAINING_ACTIVITY");
  if (leftCensored) blockers.push("ACTIVITY_START_CENSORED_BY_INPUT");
  if (rightCensored) blockers.push("ACTIVITY_END_CENSORED_BY_INPUT");
  if (collisions.length) blockers.push("EXISTING_CUE_COLLISION");
  return {
    version: "anchored-activity-review-v1",
    text: donor.text,
    originalTarget,
    emissionAnchor: anchor,
    activityWindow,
    activity,
    originalTargetContainsAnchor: contains(originalTarget, anchor),
    anchorOutsideOriginalTarget: !overlap(originalTarget, anchor),
    distinctFromOriginalTargetActivity:
      !!activity && !overlap(activity, originalTarget),
    textSupportedByGreedyDiagnostic: textSupported,
    leftCensored,
    rightCensored,
    existingCueOverlaps: collisions,
    route:
      !activity || !textSupported || !contains(donor, anchor)
        ? "unresolved-association"
        : collisions.length
          ? "existing-cue-review"
          : leftCensored || rightCensored
            ? "context-edge-boundary-review"
            : "uncovered-activity-boundary-review",
    subtitleInterval: null,
    proposedInsertions: [],
    subtitleMutationAuthorized: false,
    blockers,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    meaning:
      "CTC is an interior emission anchor; VAD is activity, not complete utterance timing",
  };
}
