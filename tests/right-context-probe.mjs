import test from "node:test";
import assert from "node:assert/strict";
import { summarizeVad } from "../scripts/subtitle-tool-listening-vad.mjs";
import {
  planRightContext,
  compareRightContext,
} from "../scripts/lib/right-context-probe.mjs";
function fixture() {
  const t = {
    id: "x",
    recordId: "one",
    start: 10,
    end: 10.64,
    firstFrame: 160000,
    endFrame: 170240,
  };
  const v = {
    sampleRate: 16000,
    inputFrames: 10240,
    rawUnit: "CENTISECONDS",
    probabilities: [...Array(5).fill(0.1), ...Array(15).fill(0.9)],
    rawIntervals: [{ start: 16, end: 64 }],
  };
  return { t, r: { id: "x", frames: 10240, vad: v } };
}
test("explicit cohort survives VAD JSON persistence and exact replay", () => {
  const { r } = fixture();
  const raw = {
    ...r.vad,
    modelLoadCount: 1,
    inferencePasses: 1,
    device: "cpu",
    stateIsolation: "WHISPER_VAD_DETECT_SPEECH_RESETS_LSTM",
  };
  const item = {
    id: "x",
    cohort: "right-context-probe",
    start: 10,
    frames: r.frames,
    localTargetStart: 0.2,
    localTargetEnd: 0.5,
  };
  const observation = summarizeVad(item, raw);
  assert.deepEqual(JSON.parse(JSON.stringify(observation)), observation);
});
test("one fixed expansion preserves onset and marks known neighbors", () => {
  const { t, r } = fixture();
  const p = planRightContext(t, r, 30, [
    { recordId: "two", sourceStart: 11, sourceEnd: 13, text: "neighbor" },
  ]);
  assert.equal(p.target.start, 10);
  assert.equal(p.target.end, 12.64);
  assert.equal(p.neighbors.length, 1);
  assert.equal(t.end, 10.64);
});
test("source end bounds expansion", () => {
  const { t, r } = fixture();
  assert.equal(planRightContext(t, r, 11, []).target.end, 11);
  assert.throws(() => planRightContext(t, r, 10.64, []));
});
test("no expansion without active right edge", () => {
  const { t, r } = fixture();
  r.vad.probabilities.fill(0.1);
  assert.throws(() => planRightContext(t, r, 30, []));
});
test("over-budget expansion fails", () => {
  const { t, r } = fixture();
  t.end = 21.008;
  t.endFrame = 336128;
  r.frames = 176128;
  r.vad.inputFrames = r.frames;
  r.vad.probabilities = Array(344).fill(0.9);
  assert.throws(() => planRightContext(t, r, 30, []), /WINDOW_BUDGET/);
});
test("closed activity still cannot mutate subtitles or establish attribution", () => {
  const { t, r } = fixture();
  const p = planRightContext(t, r, 11.28, []);
  const v = {
    ...r.vad,
    inputFrames: 20480,
    probabilities: [...r.vad.probabilities, ...Array(20).fill(0.1)],
  };
  const a = compareRightContext(p, r, v);
  assert.equal(a.rightContextObserved, true);
  assert.equal(a.maximumSharedScoreDelta, 0);
  assert.equal(a.subtitleMutations, 0);
  assert.equal(a.lexicalAttributionVerified, false);
  assert.equal(a.furtherExpansionAuthorized, false);
});
test("still active remains unresolved without retry authorization", () => {
  const { t, r } = fixture();
  const p = planRightContext(t, r, 11.28, []);
  const v = {
    ...r.vad,
    inputFrames: 20480,
    probabilities: Array(40).fill(0.9),
    rawIntervals: [{ start: 0, end: 128 }],
  };
  const a = compareRightContext(p, r, v);
  assert.equal(a.rightContextObserved, false);
  assert.equal(a.furtherExpansionAuthorized, false);
});
