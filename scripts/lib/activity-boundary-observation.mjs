import assert from "node:assert/strict";

// Diagnostics only. Activity scores cannot establish lexical utterance boundaries.
export const boundaryObservationPolicy = Object.freeze({
  version: "activity-boundary-observation-v1",
  sampleRate: 16000,
  scoreFrameSamples: 512,
  threshold: 0.5,
  requiredQuietSeconds: 0.1,
  rawRoundingToleranceSeconds: 0.032,
  canMutate: false,
});

export function observeActivityBoundary(target, raw) {
  const p = boundaryObservationPolicy;
  assert.equal(raw.id, target.id, "RESPONSE_ID");
  assert.equal(
    raw.frames,
    target.endFrame - target.firstFrame,
    "FRAME_IDENTITY",
  );
  assert(Number.isInteger(raw.frames) && raw.frames > 0, "FRAME_COUNT");
  assert(Number.isFinite(target.start) && target.start >= 0, "SOURCE_START");
  const duration = raw.frames / p.sampleRate;
  assert(
    Math.abs(target.end - target.start - duration) < 1e-7,
    "SOURCE_DURATION",
  );
  if (raw.vad == null)
    return { id: target.id, status: "NO_ACTIVITY_EVIDENCE", canMutate: false };
  const v = raw.vad;
  assert.equal(v.sampleRate, p.sampleRate, "SAMPLE_RATE");
  assert.equal(v.inputFrames, raw.frames, "VAD_FRAME_IDENTITY");
  assert.equal(v.rawUnit, "CENTISECONDS", "RAW_UNIT");
  assert.equal(
    v.probabilities.length,
    Math.ceil(raw.frames / p.scoreFrameSamples),
    "SCORE_GRID",
  );
  assert(
    v.probabilities.every((x) => Number.isFinite(x) && x >= 0 && x <= 1),
    "INVALID_SCORE",
  );
  const intervals = v.rawIntervals.map((x, i) => {
    const start = x.start / 100,
      end = x.end / 100;
    assert(
      Number.isFinite(start) &&
        Number.isFinite(end) &&
        start >= 0 &&
        end > start,
      "INVALID_INTERVAL",
    );
    assert(
      start < duration &&
        end <= duration + p.rawRoundingToleranceSeconds + 1e-8,
      "INTERVAL_OUTSIDE_CROP",
    );
    assert(!i || start >= v.rawIntervals[i - 1].end / 100, "INTERVAL_ORDER");
    return { start: target.start + start, end: target.start + end };
  });
  const scores = v.probabilities;
  const durationOf = (i) =>
    Math.min(p.scoreFrameSamples, raw.frames - i * p.scoreFrameSamples) /
    p.sampleRate;
  let leadingQuiet = 0,
    trailingQuiet = 0;
  for (let i = 0; i < scores.length && scores[i] < p.threshold; i++)
    leadingQuiet += durationOf(i);
  for (let i = scores.length - 1; i >= 0 && scores[i] < p.threshold; i--)
    trailingQuiet += durationOf(i);
  const anyActivity = scores.some((x) => x >= p.threshold);
  const side = (quiet, endpointScore, edgeTouch) => ({
    status: !anyActivity
      ? "NO_DETECTED_ACTIVITY_NOT_PROOF_OF_SILENCE"
      : endpointScore >= p.threshold
        ? "ACTIVE_AT_CROP_EDGE"
        : quiet + 1e-8 < p.requiredQuietSeconds
          ? "INSUFFICIENT_QUIET_CONTEXT"
          : edgeTouch
            ? "SEGMENT_SCORE_EDGE_CONFLICT"
            : "QUIET_CONTEXT_OBSERVED",
    quietSeconds: quiet,
    endpointScore,
    rawIntervalTouchesEdge: edgeTouch,
  });
  const left = side(
    leadingQuiet,
    scores[0],
    intervals.some(
      (r) => r.start - target.start <= p.rawRoundingToleranceSeconds,
    ),
  );
  const right = side(
    trailingQuiet,
    scores.at(-1),
    intervals.some((r) => target.end - r.end <= p.rawRoundingToleranceSeconds),
  );
  return {
    id: target.id,
    sourceWindow: { start: target.start, end: target.end },
    status:
      left.status === "QUIET_CONTEXT_OBSERVED" &&
      right.status === "QUIET_CONTEXT_OBSERVED"
        ? "ACTIVITY_WINDOW_BOUNDED_NOT_LEXICALLY_VERIFIED"
        : "INCOMPLETE_BOUNDARY_OBSERVATION",
    left,
    right,
    rawSourceIntervals: intervals,
    needsLeftContext: [
      "ACTIVE_AT_CROP_EDGE",
      "INSUFFICIENT_QUIET_CONTEXT",
      "SEGMENT_SCORE_EDGE_CONFLICT",
    ].includes(left.status),
    needsRightContext: [
      "ACTIVE_AT_CROP_EDGE",
      "INSUFFICIENT_QUIET_CONTEXT",
      "SEGMENT_SCORE_EDGE_CONFLICT",
    ].includes(right.status),
    canMutate: false,
    utteranceBoundaryVerified: false,
    meaning:
      "Observed activity context only; neither score silence nor raw segment ends prove target speech boundaries.",
  };
}
