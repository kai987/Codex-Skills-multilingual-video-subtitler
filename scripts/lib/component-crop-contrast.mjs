import assert from "node:assert/strict";
import {
  routeSourceOccurrence,
  sourceOccurrenceInputs,
} from "./source-occurrence-routing.mjs";
import { normalizeSpeech } from "./speech-support-policy.mjs";

export const componentCropPolicy = Object.freeze({
  version: "component-crop-contrast-v1",
  context: 0.75,
  maxTargets: 3,
  maxCrops: 4,
  maxRequests: 8,
  maxSeconds: 64,
  maxCropSeconds: 8,
  retries: 0,
  prompt: null,
  mutation: false,
});
const overlap = (a, b) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 1e-8;
export function planComponentCrops(parent, views, targetIds) {
  assert(
    targetIds.length > 0 &&
      targetIds.length <= 3 &&
      new Set(targetIds).size === targetIds.length,
    "TARGET_BUDGET",
  );
  const inputs = sourceOccurrenceInputs(parent, views);
  const crops = [];
  for (const targetId of targetIds) {
    const input = inputs.find((i) => i.probe.id === targetId);
    assert(input, "UNKNOWN_TARGET");
    const routing = routeSourceOccurrence(input);
    assert(
      [
        "mixed-context-localization",
        "multiple-target-activities",
        "cross-component-localization",
        "text-conflict",
      ].includes(routing.route),
      "NOT_TEXT_LOCALIZATION_TARGET",
    );
    for (const [index, a] of routing.components.entries()) {
      if (!a.targetOverlap) continue;
      const start = Math.max(
          input.probe.start,
          a.start - componentCropPolicy.context,
        ),
        end = Math.min(input.probe.end, a.end + componentCropPolicy.context);
      const startFrame = Math.round(start * 16000),
        endFrame = Math.round(end * 16000);
      crops.push({
        id: `${targetId}-component-${index}`,
        targetId,
        activityId: a.id,
        core: { start: a.start, end: a.end },
        start: startFrame / 16000,
        end: endFrame / 16000,
        frames: endFrame - startFrame,
        targetStart: Math.max(a.start, input.probe.targetStart),
        targetEnd: Math.min(a.end, input.probe.targetEnd),
        contextMeaning: "crop-context-not-lexical-boundaries",
        oldRoute: routing.route,
      });
    }
  }
  assert(
    crops.length > 0 &&
      crops.length <= 4 &&
      crops.every((c) => c.frames > 0 && c.frames <= 8 * 16000),
    "CROP_BUDGET",
  );
  const seconds = crops.reduce((s, c) => s + (c.frames * 2) / 16000, 0);
  assert(seconds <= 64, "AUDIO_BUDGET");
  return {
    policy: componentCropPolicy,
    targetIds,
    crops,
    requests: crops.length * 2,
    seconds,
    referenceUsed: false,
    labelsUsed: false,
  };
}

export function compareComponentCrops(plan, parent, oldViews, newViews) {
  assert(newViews.length === plan.crops.length * 2, "VIEW_COUNT");
  const rows = plan.crops.map((c) => {
    const pair = newViews.filter((v) => v.targetId === c.id);
    assert(
      pair.length === 2 &&
        new Set(pair.map((v) => v.backend)).size === 2 &&
        pair.every((v) => ["whisper", "kotoba"].includes(v.backend)),
      "PAIR_IDENTITY",
    );
    const invalid = pair.flatMap((v) =>
      v.records.flatMap((r, index) => {
        const finite = Number.isFinite(r.start) && Number.isFinite(r.end);
        return !finite ||
          r.start < c.start - 1e-6 ||
          r.end > c.end + 1e-6 ||
          r.end <= r.start ||
          typeof r.text !== "string" ||
          !r.text.trim() ||
          (index > 0 && r.start < v.records[index - 1].end - 1e-6)
          ? [{ backend: v.backend, index, reason: "INVALID_LOCAL_SEGMENT" }]
          : [];
      }),
    );
    const selected = pair.map((v) => ({
      backend: v.backend,
      records: v.records.filter((r) => overlap(r, c.core)),
    }));
    const single = selected.every((v) => v.records.length === 1);
    const texts = single
      ? selected.map((v) => normalizeSpeech(v.records[0].text))
      : [];
    const textAgreement = single && Boolean(texts[0]) && texts[0] === texts[1];
    const cropEdge = selected.some((v) =>
      v.records.some((r) => r.start <= c.start + 0.08 || r.end >= c.end - 0.08),
    );
    const hosts = parent.baseline
      .filter((b) => overlap(b, c.core))
      .map((b) => b.id);
    return {
      id: c.id,
      targetId: c.targetId,
      core: c.core,
      crop: { start: c.start, end: c.end },
      oldRoute: c.oldRoute,
      oldViews: oldViews.filter((v) => v.targetId === c.targetId),
      newViews: pair,
      selected,
      invalid,
      textAgreement,
      consensusText: invalid.length === 0 && textAgreement ? texts[0] : null,
      cropEdge,
      baselineHostIds: hosts,
      status: invalid.length
        ? "invalid-timing"
        : !single
          ? "not-single-localized-segment"
          : !textAgreement
            ? "text-conflict"
            : cropEdge
              ? "text-agreement-timing-unverified"
              : "text-agreement-needs-independent-verification",
      automaticInsertions: [],
      subtitleMutationAuthorized: false,
    };
  });
  return {
    rows,
    summary: {
      crops: rows.length,
      pairedTextAgreement: rows.filter(
        (r) => r.textAgreement && r.invalid.length === 0,
      ).length,
      invalidTiming: rows.filter((r) => r.invalid.length > 0).length,
      automaticInsertions: 0,
    },
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    referenceUsed: false,
  };
}
