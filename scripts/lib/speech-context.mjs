/** Source-only, bounded context comparison. Never a subtitle mutation policy. */
import assert from "node:assert/strict";
import { normalizeSpeech } from "./speech-support-policy.mjs";
export const contextPolicy = Object.freeze({
  version: "speech-context-v1",
  maximumTargets: 4,
  maximumRequests: 8,
  maximumRequestSeconds: 8,
  maximumTotalSeconds: 64,
  retries: 0,
  contextSeconds: 1,
  precedingCueGapSeconds: 0.3,
  automaticMutation: false,
});
const overlaps = (a, b) => a.sourceStart < b.end && a.sourceEnd > b.start;
export function planContexts(probes, baseline, duration, offset = 0) {
  assert(Number.isFinite(duration) && duration > offset && offset >= 0);
  assert(probes.length <= contextPolicy.maximumTargets);
  const rows = [...baseline].sort(
    (a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd,
  );
  const seen = new Set();
  for (const r of rows) {
    assert(!seen.has(r.recordId));
    seen.add(r.recordId);
    assert(
      Number.isFinite(r.sourceStart) &&
        Number.isFinite(r.sourceEnd) &&
        r.sourceEnd > r.sourceStart,
    );
  }
  const selected = [],
    deferred = [];
  for (const p of probes) {
    assert(
      Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start,
    );
    const core = rows.filter((r) => overlaps(r, p));
    if (!core.length) {
      deferred.push({ id: p.id, reason: "NO_MACHINE_CUE_CONTEXT" });
      continue;
    }
    // One preceding near-contiguous machine cue, not an unlimited closure chain.
    const previous = rows
      .filter((r) => r.sourceEnd <= core[0].sourceStart && !core.includes(r))
      .at(-1);
    if (
      previous &&
      core[0].sourceStart - previous.sourceEnd <=
        contextPolicy.precedingCueGapSeconds
    )
      core.unshift(previous);
    const start =
      Math.round(
        Math.max(
          offset,
          Math.min(p.start, ...core.map((r) => r.sourceStart)) - 1,
        ) * 16000,
      ) / 16000;
    const end =
      Math.round(
        Math.min(
          duration,
          Math.max(p.end, ...core.map((r) => r.sourceEnd)) + 1,
        ) * 16000,
      ) / 16000;
    const frames = Math.round((end - start) * 16000);
    if (frames > 8 * 16000) {
      deferred.push({
        id: p.id,
        reason: "COMPLETE_MACHINE_CONTEXT_EXCEEDS_WINDOW_BUDGET",
        requiredStart: start,
        requiredEnd: end,
      });
      continue;
    }
    if (
      selected.reduce((s, r) => s + 2 * r.frames, 0) + 2 * frames >
      64 * 16000
    ) {
      deferred.push({ id: p.id, reason: "TOTAL_AUDIO_BUDGET" });
      continue;
    }
    selected.push({
      id: p.id,
      start,
      end,
      frames,
      shortStart: p.start,
      shortEnd: p.end,
      coreRecordIds: core.map((r) => r.recordId),
      contextOnlyPartialRecordIds: rows
        .filter(
          (r) =>
            overlaps(r, { start, end }) &&
            (r.sourceStart < start || r.sourceEnd > end),
        )
        .map((r) => r.recordId),
      coverageClaim:
        "complete selected machine cues; not verified complete acoustic utterance",
    });
  }
  return { selected, deferred };
}
export function compareContexts(probe, oldViews, newViews, baseline) {
  const byModel = ["whisper", "kotoba"].map((backend) => {
    const old = oldViews.find(
      (v) => v.backend === backend && v.targetId === probe.id,
    );
    const current = newViews.find(
      (v) => v.backend === backend && v.targetId === probe.id,
    );
    assert(old && current);
    const text = normalizeSpeech(current.records.map((r) => r.text).join(""));
    const oldText = normalizeSpeech(old.records.map((r) => r.text).join(""));
    const valid =
      current.unresolvedCount === 0 &&
      current.records.length > 0 &&
      current.records.every(
        (r, i) =>
          Number.isFinite(r.sourceStart) &&
          Number.isFinite(r.sourceEnd) &&
          r.sourceStart >= probe.start &&
          r.sourceEnd <= probe.end &&
          r.sourceEnd > r.sourceStart &&
          (!i || r.sourceStart >= current.records[i - 1].sourceEnd),
      );
    return {
      backend,
      normalizedText: text,
      shortText: oldText,
      shortTextRetained: !!oldText && text.includes(oldText),
      valid,
      cropEdgePinned: current.records.some(
        (r) =>
          r.sourceStart <= probe.start + 0.08 ||
          r.sourceEnd >= probe.end - 0.08,
      ),
      overlapsExistingCue: current.records.some((r) =>
        baseline.some(
          (b) => b.sourceStart < r.sourceEnd && b.sourceEnd > r.sourceStart,
        ),
      ),
    };
  });
  return {
    targetId: probe.id,
    byModel,
    wholeContextTextAgreement:
      byModel.every((v) => v.valid && v.normalizedText) &&
      byModel[0].normalizedText === byModel[1].normalizedText,
    bothRetainShortText: byModel.every((v) => v.shortTextRetained),
    sourceAssociation: byModel.some((v) => v.overlapsExistingCue)
      ? "EXISTING_CUE_REGION_NOT_NEW_DIALOGUE"
      : "UNRESOLVED_OCCURRENCE",
    status: "DIAGNOSTIC_ONLY",
    acousticTimingVerified: false,
    automaticMutation: false,
  };
}
