import test from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import {
  cutSearchWindow,
  inspectCuts,
} from "../scripts/lib/acoustic-cut-probe.mjs";
function fixture() {
  const data = Buffer.alloc(4 * 16000 * 2);
  for (let i = 16000; i < 32000; i++) data.writeInt16LE(8000, i * 2);
  return {
    pcm: { sampleRate: 16000, frames: 64000, data },
    raw: {
      sampleRate: 16000,
      inputFrames: 64000,
      rawUnit: "CENTISECONDS",
      probabilities: Array(125).fill(0.05),
      rawIntervals: [{ start: 100, end: 200 }],
    },
    window: { start: 10, end: 14, frames: 64000 },
    targets: [{ sourceStart: 11, sourceEnd: 12 }],
    baseline: [],
  };
}
const run = (f) => inspectCuts(f.pcm, f.raw, f.window, f.targets, f.baseline);
test("search stays local, source-global and within one 16-second VAD budget", () => {
  assert.deepEqual(cutSearchWindow([{ start: 10, end: 15 }], 0, 20), {
    start: 8,
    end: 17,
    frames: 144000,
  });
  assert.equal(cutSearchWindow([{ start: 10, end: 15 }], 9, 16).start, 9);
  assert.throws(
    () => cutSearchWindow([{ start: 0, end: 20 }], 0, 30),
    /BUDGET/u,
  );
});
test("zero energy does not map to NaN or negative infinity", () => {
  const a = run(fixture());
  assert(a.frames.every((f) => Number.isFinite(f.rmsDbfs)));
  assert.equal(a.frames[0].rmsDbfs, -120);
});
test("crop-truncated quiet spans cannot supply safe outside boundaries", () => {
  const a = run(fixture());
  assert.equal(a.pair, null);
  assert.equal(a.status, "NO_TWO_SIDED_CUT_SUPPORT");
  assert(a.quietSpans.every((s) => s.cropEdgeLimited));
});
test("interior quiet spans propose source-time cuts but never subtitle times", () => {
  const f = fixture();
  for (let i = 0; i < 64000; i++)
    if (i < 3200 || i >= 60800) f.pcm.data.writeInt16LE(8000, 2 * i);
  const a = run(f);
  assert(a.pair);
  assert.equal(a.pair.start, 10.6);
  assert.equal(a.pair.end, 12.9);
  assert.equal(a.subtitleMutationAuthorized, false);
  assert.equal(a.modelDispatchAllowed, false);
  assert.deepEqual(a.activity, [{ start: 11, end: 12 }]);
});
test("high VAD posterior vetoes low-energy candidate, not vice versa", () => {
  const f = fixture();
  f.raw.probabilities.fill(0.8);
  assert.equal(run(f).quietSpans.length, 0);
});
test("energetic music with low VAD is not labeled quiet", () => {
  const f = fixture();
  for (let i = 0; i < 64000; i++) f.pcm.data.writeInt16LE(5000, i * 2);
  assert.equal(run(f).quietSpans.length, 0);
});
test("any overlapping posterior bin must pass, avoiding frame-grid aliasing", () => {
  const f = fixture();
  f.raw.probabilities[1] = 0.9;
  const a = run(f);
  assert.equal(a.frames[1].posteriorMax, 0.9);
  assert.equal(a.frames[1].quiet, false);
});
test("short quiet fragments are not merged through speech", () => {
  const f = fixture();
  for (let i = 0; i < 64000; i++)
    f.pcm.data.writeInt16LE(i % 3200 < 1600 ? 0 : 8000, i * 2);
  assert.equal(run(f).quietSpans.length, 0);
});
test("machine cue crossing a candidate cut remains an explicit conflict", () => {
  const f = fixture();
  for (let i = 0; i < 3200; i++) f.pcm.data.writeInt16LE(8000, i * 2);
  f.baseline = [{ recordId: "neighbor", sourceStart: 10.3, sourceEnd: 10.8 }];
  assert.deepEqual(run(f).quietSpans[0].crossingMachineRecordIds, ["neighbor"]);
});
test("malformed geometry, scores, raw units and out-of-search targets fail closed", () => {
  for (const change of [
    (f) => {
      f.raw.inputFrames--;
    },
    (f) => {
      f.raw.probabilities.pop();
    },
    (f) => {
      f.raw.probabilities[0] = NaN;
    },
    (f) => {
      f.raw.rawUnit = "SECONDS";
    },
    (f) => {
      f.targets[0].sourceStart = 9;
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => run(f));
  }
});
