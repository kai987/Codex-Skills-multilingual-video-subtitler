import assert from "node:assert/strict";
import { observeActivityBoundary } from "./activity-boundary-observation.mjs";
export const rightContextPolicy = Object.freeze({
  maxRequests: 1,
  extraSeconds: 2,
  maxSeconds: 12,
  retries: 0,
  asrRequests: 0,
  subtitleMutationAuthorized: false,
});
export function planRightContext(target, raw, duration, baseline) {
  const before = observeActivityBoundary(target, raw);
  assert.equal(
    before.right?.status,
    "ACTIVE_AT_CROP_EDGE",
    "ACTIVE_RIGHT_EDGE_REQUIRED",
  );
  assert(
    Number.isFinite(duration) && duration > target.end,
    "NO_SOURCE_CONTEXT",
  );
  const endFrame = Math.min(
    Math.round(duration * 16000),
    target.endFrame + rightContextPolicy.extraSeconds * 16000,
  );
  const expanded = {
    ...target,
    endFrame,
    end: target.start + (endFrame - target.firstFrame) / 16000,
  };
  assert(
    (endFrame - target.firstFrame) / 16000 <= rightContextPolicy.maxSeconds,
    "WINDOW_BUDGET",
  );
  const neighbors = baseline
    .filter(
      (r) =>
        r.recordId !== target.recordId &&
        r.sourceStart < expanded.end &&
        r.sourceEnd > expanded.start,
    )
    .map((r) => ({
      recordId: r.recordId,
      start: r.sourceStart,
      end: r.sourceEnd,
      text: r.text,
    }));
  return {
    before,
    target: expanded,
    originalEnd: target.end,
    neighbors,
    policy: rightContextPolicy,
  };
}
export function compareRightContext(plan, oldRaw, freshVad) {
  const after = observeActivityBoundary(plan.target, {
    id: plan.target.id,
    frames: plan.target.endFrame - plan.target.firstFrame,
    vad: freshVad,
  });
  // The old final frame may have been zero-padded; compare only complete shared frames.
  const n = Math.floor(oldRaw.frames / 512);
  const delta = Math.max(
    ...oldRaw.vad.probabilities
      .slice(0, n)
      .map((x, i) => Math.abs(x - freshVad.probabilities[i])),
  );
  return {
    before: plan.before,
    after,
    sharedCompleteFrames: n,
    maximumSharedScoreDelta: delta,
    rightContextObserved: after.right.status === "QUIET_CONTEXT_OBSERVED",
    neighbors: plan.neighbors,
    lexicalAttributionVerified: false,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
    newInference: 1,
    furtherExpansionAuthorized: false,
  };
}
