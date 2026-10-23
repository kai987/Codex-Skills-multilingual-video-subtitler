import test from "node:test";
import assert from "node:assert/strict";
import {
  planSoftProbes,
  decideSoftProbe,
  assembleSoftProbes,
} from "../scripts/lib/soft-speech-probes.mjs";
const r = {
  id: "r1",
  kind: "long-sparse-cue",
  start: 0,
  end: 25,
  cropStart: 0,
  cropEnd: 25.5,
  recordIds: ["old"],
};
const a = { regionId: "r1", intervals: [], finding: "LOW_DETECTOR_SUPPORT" };
const raw = () => ({
  sampleRate: 16000,
  inputFrames: 408000,
  probabilities: Array.from({ length: 797 }, (_, i) =>
    i === 150 ? 0.1 : 0.01,
  ),
});
test("negative VAD still schedules ASR without changing detector threshold", () => {
  const [p] = planSoftProbes([r], [a], [raw()], 30);
  assert.equal(p.peak.score, 0.1);
  assert.equal(p.frames, 128000);
  assert.equal(p.fullOriginalRegionCovered, false);
  assert.equal(p.peak.subtitleTimestamp, false);
  assert.equal(p.selection, "posterior-peak-without-positive-threshold");
});
test("crossing activity retained whole rather than clipped to subtitle gap", () => {
  const [p] = planSoftProbes(
    [{ ...r, kind: "subtitle-gap", start: 8, end: 12 }],
    [{ ...a, intervals: [{ start: 7.5, end: 8.5 }] }],
    [raw()],
    30,
  );
  assert.equal(p.start, 6.5);
  assert.equal(p.end, 9.5);
});
test("source offset, tail clamping and exact request budget", () => {
  const v = raw();
  v.probabilities.fill(0);
  v.probabilities[796] = 1;
  const [p] = planSoftProbes(
    [{ ...r, start: 10, end: 35, cropStart: 10, cropEnd: 35.5 }],
    [a],
    [v],
    35.5,
    10,
  );
  assert.equal(p.end, 35.5);
  assert.equal(p.start, 27.5);
  assert.throws(
    () =>
      planSoftProbes(
        Array(5).fill(r),
        Array(5).fill(a),
        Array(5).fill(raw()),
        40,
      ),
    /INPUT/u,
  );
  assert.throws(
    () => planSoftProbes([r], [a], [{ ...raw(), probabilities: [1] }], 30),
    /GEOMETRY/u,
  );
  assert.throws(
    () =>
      planSoftProbes(
        [r],
        [a],
        [{ ...raw(), probabilities: Array(797).fill(NaN) }],
        30,
      ),
    /GEOMETRY/u,
  );
});
const row = (id, s, e, text = "ああ") => ({
  recordId: id,
  sourceStart: s,
  sourceEnd: e,
  text,
  issues: [],
});
const probe = {
  id: "p",
  kind: "subtitle-gap",
  regionStart: 5,
  regionEnd: 8,
  start: 4,
  end: 9,
};
const views = () => [
  { backend: "whisper", unresolvedCount: 0, records: [row("w", 6, 6.5)] },
  { backend: "kotoba", unresolvedCount: 0, records: [row("k", 6.02, 6.5)] },
];
test("paired whole cues may fill a gap without positive VAD", () => {
  const old = [row("old", 1, 2)],
    d = decideSoftProbe(probe, old, views());
  assert.equal(d.status, "CANDIDATE");
  assert.equal(d.acousticTimingVerified, false);
  const candidate = assembleSoftProbes(old, [d]);
  assert.equal(candidate.length, 2);
  assert.deepEqual(candidate[0], old[0]);
});
test("partial long-cue evidence can never erase the unseen rest", () => {
  const old = [row("old", 0, 25, "長い元の文")],
    d = decideSoftProbe({ ...probe, kind: "long-sparse-cue" }, old, views());
  assert.equal(d.status, "REVIEW_CANDIDATE");
  assert.equal(d.reason, "PARTIAL_LONG_CUE_DIAGNOSTIC_ONLY");
  assert.deepEqual(assembleSoftProbes(old, [d]), old);
});
for (const [reason, change] of [
  [
    "CROSS_MODEL_TEXT_CONFLICT",
    (v) => {
      v[1].records[0].text = "ええ";
    },
  ],
  [
    "CROSS_MODEL_TIMING_CONFLICT",
    (v) => {
      v[1].records[0].sourceEnd = 7;
    },
  ],
  [
    "DONOR_TOUCHES_CROP_EDGE",
    (v) => {
      v[0].records[0].sourceStart = 4;
    },
  ],
  [
    "TWO_VALID_NONEMPTY_BACKENDS_REQUIRED",
    (v) => {
      v[1].records = [];
    },
  ],
  [
    "INVALID_OR_OVERLAPPING_DONOR",
    (v) => {
      v[0].records[0].sourceEnd = NaN;
    },
  ],
])
  test(reason, () => {
    const v = views();
    change(v);
    assert.equal(decideSoftProbe(probe, [], v).reason, reason);
  });
test("cross-boundary, neighbor collision, true repeated utterances and competing insertions", () => {
  assert.equal(
    decideSoftProbe({ ...probe, regionStart: 6.2 }, [], views()).status,
    "REVIEW_CANDIDATE",
  );
  const old = [row("a", 6, 6.5), row("b", 7, 7.5)];
  const d = decideSoftProbe(probe, old, views());
  assert.equal(d.reason, "EXISTING_DIALOGUE_COLLISION");
  assert.deepEqual(assembleSoftProbes(old, [d]), old);
  const accepted = decideSoftProbe(probe, [], views());
  assert.throws(
    () => assembleSoftProbes([], [accepted, accepted]),
    /COLLISION/u,
  );
});
