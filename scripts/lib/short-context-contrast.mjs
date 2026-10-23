import assert from "node:assert/strict";
export const contrastPolicy = Object.freeze({
  version: "short-context-contrast-v1",
  maximumTargets: 1,
  maximumRequests: 2,
  maximumWindowSeconds: 8,
  maximumTotalSeconds: 16,
  retries: 0,
  automaticMutation: false,
});
const norm = (s) => s.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "");
export function planContrast(islands, context, targetId) {
  const target = islands.selected.find((r) => r.id === targetId);
  assert(target && context.selected.length === 1, "ONE_TARGET_REQUIRED");
  const start = context.selected[0].start,
    end = target.end;
  assert(
    Number.isFinite(start) &&
      Number.isFinite(end) &&
      start < target.start &&
      end > start &&
      context.selected[0].end >= end,
    "SAME_TARGET_RIGHT_EDGE_REQUIRED",
  );
  const frames = Math.round((end - start) * 16000);
  assert(frames > 0 && frames <= 8 * 16000, "CONTEXT_BUDGET");
  assert(
    !islands.selected.some(
      (r) =>
        r.id !== targetId &&
        r.activity.start >= target.activity.end &&
        r.activity.start < end,
    ),
    "FOLLOWING_ACTIVITY_INCLUDED",
  );
  return {
    policy: contrastPolicy,
    targetId,
    targetCrop: { start: target.start, end: target.end },
    activity: target.activity,
    probe: { id: "left-context", start, end, frames },
    claim:
      "Same target and right edge, extra preceding audio; partial preceding utterance is allowed for diagnostic ASR, not forced alignment.",
    lexicalPrompt: null,
  };
}
export function compareContrast(shortViews, expandedViews, candidates) {
  const pair = (views) =>
    ["whisper", "kotoba"].map((backend) => {
      const v = views.filter((r) => r.backend === backend);
      assert.equal(v.length, 1, "ONE_VIEW_PER_BACKEND");
      assert(typeof v[0].text === "string");
      return { ...v[0], normalizedText: norm(v[0].text) };
    });
  const short = pair(shortViews),
    expanded = pair(expandedViews);
  const shortAgreement =
    !!short[0].normalizedText &&
    short[0].normalizedText === short[1].normalizedText;
  const expandedAgreement =
    !!expanded[0].normalizedText &&
    expanded[0].normalizedText === expanded[1].normalizedText;
  const retention = expanded.map((v, i) => ({
    backend: v.backend,
    shortText: short[i].text,
    retainedAnywhere:
      !!short[i].normalizedText &&
      v.normalizedText.includes(short[i].normalizedText),
  }));
  const candidatePresence = candidates.map((c) => ({
    ...c,
    views: expanded.map((v) => {
      const needle = norm(c.text),
        at = needle ? v.normalizedText.indexOf(needle) : -1;
      return {
        backend: v.backend,
        presentAnywhere: at >= 0,
        uniqueStringMatch:
          at >= 0 && v.normalizedText.indexOf(needle, at + 1) < 0,
        targetOccurrenceVerified: false,
      };
    }),
  }));
  const conflict =
    !shortAgreement ||
    !expandedAgreement ||
    retention.some((r) => !r.retainedAnywhere);
  return {
    short,
    expanded,
    shortAgreement,
    expandedAgreement,
    retention,
    candidatePresence,
    status: conflict
      ? "CROSS_WINDOW_LEXICAL_CONFLICT"
      : "TEXT_RETAINED_LOCATION_UNVERIFIED",
    modelAgreementSufficient: false,
    automaticReplacementAllowed: false,
    timingVerified: false,
    note: "Containment in a larger window does not localize the target; related-model agreement and confidence cannot override context conflict.",
  };
}
