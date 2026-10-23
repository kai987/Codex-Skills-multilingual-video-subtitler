import assert from "node:assert/strict";
import { reviewAnchoredActivity } from "./anchored-activity-review.mjs";

// Editorial preview settings, not acoustic thresholds or release permission.
export const displayPolicy = Object.freeze({
  version: "short-response-display-preview-v1",
  preferredDurationMs: 800,
  maximumTrailingHoldMs: 600,
  neighborGapMs: 80,
  maximumTextCharacters: 4,
  maximumActivityMs: 800,
});
const floorMs = (t) => Math.floor(t * 1000 + 1e-7);
const ceilMs = (t) => Math.ceil(t * 1000 - 1e-7);

/** Keep acoustic support immutable; propose an explicitly non-acoustic display hold. */
export function planShortResponseDisplay(input) {
  const review = reviewAnchoredActivity(input);
  const result = {
    policy: displayPolicy,
    text: review.text,
    timebase: "source-global-seconds",
    acousticActivity: review.activity,
    emissionAnchor: review.emissionAnchor,
    verifiedUtteranceInterval: null,
    displayInterval: null,
    trailingHold: null,
    displayLimits: null,
    preferredDurationMet: false,
    blockers: [...review.blockers],
    route: "no-display-preview",
    primarySubtitleMutationAuthorized: false,
    humanValidated: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
  if (review.blockers.some((b) => b !== "UTTERANCE_BOUNDARIES_NOT_VERIFIED"))
    return result;
  const text = review.text.trim();
  if (
    !text ||
    /[\r\n{}<>\\]/u.test(text) ||
    [...text].length > displayPolicy.maximumTextCharacters ||
    !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)
  ) {
    result.blockers.push("NOT_SHORT_PLAIN_JAPANESE_TEXT");
    return result;
  }
  const activity = review.activity;
  const startMs = floorMs(activity.start),
    endMs = ceilMs(activity.end);
  if (endMs - startMs > displayPolicy.maximumActivityMs) {
    result.blockers.push("NOT_SHORT_ACTIVITY");
    return result;
  }
  const others = [
    ...input.baseline.map((r) => ({ ...r, kind: "subtitle" })),
    ...input.vadIntervals
      .filter((r) => r !== activity)
      .map((r, i) => ({ ...r, id: `vad-${i}`, kind: "activity" })),
  ];
  const previous = others.filter((r) => r.end <= activity.start);
  const following = others.filter((r) => r.start >= activity.end);
  const lowerMs = Math.max(
    ceilMs(input.activityWindow.start),
    ...previous.map((r) => ceilMs(r.end) + displayPolicy.neighborGapMs),
  );
  const upperMs = Math.min(
    floorMs(input.activityWindow.end),
    ...following.map((r) => floorMs(r.start) - displayPolicy.neighborGapMs),
  );
  result.displayLimits = { start: lowerMs / 1000, end: upperMs / 1000 };
  if (startMs < lowerMs || endMs > upperMs) {
    result.blockers.push("INSUFFICIENT_NEIGHBOR_GAP");
    return result;
  }
  const preferredEnd = Math.max(
    endMs,
    startMs + displayPolicy.preferredDurationMs,
  );
  const displayEnd = Math.min(
    preferredEnd,
    endMs + displayPolicy.maximumTrailingHoldMs,
    upperMs,
  );
  assert(displayEnd >= endMs && displayEnd > startMs);
  result.displayInterval = { start: startMs / 1000, end: displayEnd / 1000 };
  result.trailingHold = {
    start: activity.end,
    end: displayEnd / 1000,
    durationSeconds: (displayEnd - activity.end * 1000) / 1000,
    meaning: "readability-only; not evidence of continued speech",
  };
  result.preferredDurationMet =
    displayEnd - startMs >= displayPolicy.preferredDurationMs;
  result.route = "display-preview-only";
  return result;
}

/** Single candidate only; deliberately never assembles or edits the primary subtitles. */
export function renderDisplayPreview(input) {
  const plan = planShortResponseDisplay(input);
  if (!plan.displayInterval) return null;
  const stamp = (seconds) => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return `1\n${stamp(plan.displayInterval.start)} --> ${stamp(plan.displayInterval.end)}\n${plan.text}\n`;
}
