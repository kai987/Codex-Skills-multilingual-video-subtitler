/** Frozen-target context expansion only. Never consult reference text. */
import assert from "node:assert/strict";
import { closeDialogueTarget } from "./whole-dialogue-recovery.mjs";

export const contextPolicy = Object.freeze({
  version: "baseline-envelope-context-comparison-v1",
  maximumWindows: 3,
  maximumWindowSeconds: 15,
  maximumRequests: 6,
  maximumRequestAudioSeconds: 90,
  retries: 0,
  defaultPromotion: false,
  selection: "expand-original-request-to-overlapping-whole-baseline-records",
});

export function planContextWindows(previous) {
  assert(
    Array.isArray(previous.sources) && previous.sources.length > 0,
    "SOURCES_REQUIRED",
  );
  assert(
    new Set(previous.sources.map((s) => s.id)).size === previous.sources.length,
    "DUPLICATE_SOURCE",
  );
  assert(
    Array.isArray(previous.windows) &&
      previous.windows.length > 0 &&
      previous.windows.length <= 3,
    "WINDOW_LIMIT",
  );
  assert(
    new Set(previous.windows.map((w) => w.id)).size === previous.windows.length,
    "DUPLICATE_WINDOW",
  );
  const windows = [],
    deferred = [];
  for (const w of previous.windows) {
    assert(/^[a-z0-9-]+$/u.test(w.id), "INVALID_WINDOW_ID");
    const source = previous.sources.find((s) => s.id === w.sourceId);
    assert(
      source && Number.isFinite(source.duration) && source.duration > 0,
      "INVALID_SOURCE",
    );
    assert(
      source.baseline.length &&
        source.baseline.every(
          (r, i, rows) =>
            typeof r.id === "string" &&
            typeof r.text === "string" &&
            r.text.trim() &&
            Number.isFinite(r.start) &&
            Number.isFinite(r.end) &&
            r.start >= 0 &&
            r.end > r.start &&
            r.end <= source.duration &&
            (!i || r.start >= rows[i - 1].start),
        ),
      "INVALID_BASELINE",
    );
    assert(
      new Set(source.baseline.map((r) => r.id)).size === source.baseline.length,
      "DUPLICATE_RECORD",
    );
    assert(
      Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.start >= 0 &&
        w.end > w.start &&
        w.end <= source.duration,
      "INVALID_WINDOW",
    );
    assert(
      w.target &&
        w.target.start >= w.start &&
        w.target.end <= w.end &&
        w.target.end > w.target.start,
      "INVALID_ORIGINAL_TARGET",
    );
    const original = closeDialogueTarget(source.baseline, w.target);
    assert.deepEqual(original, w.target, "ORIGINAL_TARGET_NOT_CLOSED");
    const target = closeDialogueTarget(source.baseline, {
      id: `context-${w.id}`,
      start: w.start,
      end: w.end,
    });
    const first = Math.floor(target.start * 16000 + 1e-7),
      last = Math.ceil(target.end * 16000 - 1e-7);
    const samples = last - first;
    if (
      samples > contextPolicy.maximumWindowSeconds * 16000 ||
      (windows.reduce((n, x) => n + x.samples, 0) + samples) * 2 > 90 * 16000
    ) {
      deferred.push({
        id: w.id,
        sourceId: source.id,
        reason: "WHOLE_CONTEXT_EXCEEDS_BUDGET",
        target,
      });
      continue;
    }
    windows.push({
      id: `context-${w.id}`,
      previousWindowId: w.id,
      sourceId: source.id,
      originalTarget: w.target,
      target,
      start: first / 16000,
      end: last / 16000,
      samples,
    });
  }
  return { windows, deferred };
}
