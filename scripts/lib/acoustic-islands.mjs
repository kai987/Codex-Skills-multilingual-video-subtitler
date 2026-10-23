import assert from "node:assert/strict";
export const islandPolicy = Object.freeze({
  version: "acoustic-island-association-v1",
  maximumTargets: 3,
  maximumRequests: 6,
  maximumTotalSeconds: 16,
  maximumWindowSeconds: 8,
  retries: 0,
  automaticMutation: false,
});
const norm = (s) => s.normalize("NFC").replace(/[\s\p{P}\p{S}]/gu, "");
export function planIslands(analysis, targets) {
  assert(
    targets.length &&
      targets.every(
        (r) =>
          Number.isFinite(r.sourceStart) &&
          Number.isFinite(r.sourceEnd) &&
          r.sourceEnd > r.sourceStart,
      ),
  );
  const activities = analysis.activity;
  assert(
    activities.every(
      (a, i) =>
        Number.isFinite(a.start) &&
        Number.isFinite(a.end) &&
        a.end > a.start &&
        (!i || a.start >= activities[i - 1].end),
    ),
    "INVALID_ACTIVITY",
  );
  const cuts = analysis.quietSpans.filter((s) => !s.cropEdgeLimited);
  for (const s of cuts)
    assert(
      Number.isFinite(s.start) &&
        Number.isFinite(s.end) &&
        s.start < s.cut &&
        s.cut < s.end,
      "INVALID_CUT",
    );
  const selected = [],
    deferred = [];
  for (const [i, activity] of activities.entries()) {
    if (
      !targets.some(
        (r) => r.sourceStart < activity.end && r.sourceEnd > activity.start,
      )
    )
      continue;
    const left = cuts.filter((s) => s.end <= activity.start + 1e-8).at(-1);
    const right = cuts.find((s) => s.start >= activity.end - 1e-8);
    const id = `island-${i + 1}`;
    if (!left || !right) {
      deferred.push({ id, activity, reason: "NO_TWO_SIDED_ACOUSTIC_CUT" });
      continue;
    }
    const frames = Math.round((right.cut - left.cut) * 16000);
    if (
      activities.some(
        (a, j) => j !== i && a.start < right.cut && a.end > left.cut,
      )
    ) {
      deferred.push({ id, activity, reason: "NEIGHBOR_ACTIVITY_COLLISION" });
      continue;
    }
    if (
      frames <= 0 ||
      frames > 8 * 16000 ||
      selected.length >= 3 ||
      selected.reduce((s, r) => s + r.frames * 2, 0) + frames * 2 > 16 * 16000
    ) {
      deferred.push({ id, activity, reason: "ACQUISITION_BUDGET" });
      continue;
    }
    selected.push({
      id,
      start: left.cut,
      end: right.cut,
      frames,
      activity,
      cutEvidence: { left, right },
      lexicalPrompt: null,
    });
  }
  return { policy: islandPolicy, selected, deferred };
}
export function compareIslands(plan, views, baseline) {
  return plan.selected.map((r) => {
    const pair = ["whisper", "kotoba"].map((backend) => {
      const hits = views.filter(
        (v) => v.targetId === r.id && v.backend === backend,
      );
      assert.equal(hits.length, 1, "ONE_VIEW_PER_BACKEND_REQUIRED");
      const v = hits[0];
      assert(typeof v.text === "string");
      return { ...v, normalizedText: norm(v.text) };
    });
    const agreed =
      !!pair[0].normalizedText &&
      pair[0].normalizedText === pair[1].normalizedText;
    const associations = pair.map((v) => ({
      backend: v.backend,
      matches: !v.normalizedText
        ? []
        : baseline.flatMap((b) => {
            const text = norm(b.text),
              at = text.indexOf(v.normalizedText);
            if (at < 0) return [];
            return [
              {
                recordId: b.recordId,
                sourceText: b.text,
                sourceStart: b.sourceStart,
                sourceEnd: b.sourceEnd,
                relation:
                  text === v.normalizedText
                    ? "whole-cue-text"
                    : "substring-only",
                uniqueInRecord: text.indexOf(v.normalizedText, at + 1) < 0,
              },
            ];
          }),
    }));
    return {
      targetId: r.id,
      crop: { start: r.start, end: r.end },
      activity: r.activity,
      views: pair,
      associations,
      status: agreed
        ? "PAIRED_LOCAL_TEXT_EVIDENCE"
        : "LOCAL_TEXT_CONFLICT_OR_EMPTY",
      boundaryValidated: false,
      subtitleMutationAuthorized: false,
      note: "Models share Whisper lineage; paired agreement is not independent ground truth. Crop and VAD times are not subtitle times.",
    };
  });
}
