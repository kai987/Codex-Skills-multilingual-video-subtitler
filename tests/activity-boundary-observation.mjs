import test from "node:test";
import assert from "node:assert/strict";
import { observeActivityBoundary } from "../scripts/lib/activity-boundary-observation.mjs";
function fixture() {
  return {
    t: { id: "x", start: 20, end: 20.64, firstFrame: 320000, endFrame: 330240 },
    r: {
      id: "x",
      frames: 10240,
      vad: {
        sampleRate: 16000,
        inputFrames: 10240,
        rawUnit: "CENTISECONDS",
        probabilities: [
          ...Array(5).fill(0.1),
          ...Array(10).fill(0.9),
          ...Array(5).fill(0.1),
        ],
        rawIntervals: [{ start: 16, end: 48 }],
      },
    },
  };
}
test("bounded activity is not permission for lexical timing", () => {
  const { t, r } = fixture();
  const before = JSON.stringify({ t, r });
  const a = observeActivityBoundary(t, r);
  assert.equal(a.status, "ACTIVITY_WINDOW_BOUNDED_NOT_LEXICALLY_VERIFIED");
  assert.equal(a.canMutate, false);
  assert.equal(a.utteranceBoundaryVerified, false);
  assert.equal(JSON.stringify({ t, r }), before);
});
test("high final posterior and rounded raw edge are censored, not an endpoint", () => {
  const { t, r } = fixture();
  r.vad.probabilities.fill(0.95, 15);
  r.vad.rawIntervals[0].end = 65;
  const a = observeActivityBoundary(t, r);
  assert.equal(a.right.status, "ACTIVE_AT_CROP_EDGE");
  assert.equal(a.needsRightContext, true);
  assert.equal(a.rawSourceIntervals[0].end, 20.65);
});
test("less than 100ms of tail quiet does not establish closure", () => {
  const { t, r } = fixture();
  r.vad.probabilities[17] = 0.9;
  assert.equal(
    observeActivityBoundary(t, r).right.status,
    "INSUFFICIENT_QUIET_CONTEXT",
  );
});
test("raw crop-edge segment and quiet scores remain a conflict", () => {
  const { t, r } = fixture();
  r.vad.rawIntervals[0].end = 64;
  assert.equal(
    observeActivityBoundary(t, r).right.status,
    "SEGMENT_SCORE_EDGE_CONFLICT",
  );
});
test("left edge is checked independently", () => {
  const { t, r } = fixture();
  r.vad.probabilities[0] = 0.8;
  const a = observeActivityBoundary(t, r);
  assert.equal(a.needsLeftContext, true);
  assert.equal(a.needsRightContext, false);
});
test("missing VAD is not silence", () => {
  const { t, r } = fixture();
  r.vad = null;
  assert.equal(observeActivityBoundary(t, r).status, "NO_ACTIVITY_EVIDENCE");
});
test("all-low scores are not proof of silence", () => {
  const { t, r } = fixture();
  r.vad.probabilities.fill(0);
  r.vad.rawIntervals = [];
  assert.equal(
    observeActivityBoundary(t, r).right.status,
    "NO_DETECTED_ACTIVITY_NOT_PROOF_OF_SILENCE",
  );
});
test("partial final frame contributes only real audio duration", () => {
  const { t, r } = fixture();
  r.frames -= 400;
  r.vad.inputFrames = r.frames;
  t.endFrame -= 400;
  t.end -= 0.025;
  r.vad.probabilities[15] = 0.9;
  const a = observeActivityBoundary(t, r);
  assert(Math.abs(a.right.quietSeconds - 0.103) < 1e-8);
});
test("invalid clocks and responses fail closed", () => {
  for (const mutate of [
    (r) => (r.id = "other"),
    (r) => r.frames++,
    (r) => (r.vad.sampleRate = 8000),
    (r) => (r.vad.rawUnit = "SECONDS"),
    (r) => r.vad.probabilities.pop(),
    (r) => (r.vad.probabilities[0] = NaN),
    (r) => (r.vad.rawIntervals[0].end = 90),
  ]) {
    const { t, r } = fixture();
    mutate(r);
    assert.throws(() => observeActivityBoundary(t, r));
  }
});
