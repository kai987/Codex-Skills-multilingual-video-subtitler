/* global structuredClone */
import test from "node:test";
import assert from "node:assert/strict";
import {
  planSpeechRegions,
  planSpeechProbes,
  decideSpeechProbe,
  assembleSpeechProposals,
} from "../scripts/lib/speech-support-policy.mjs";
const row = (id, s, e, text = "短い音声") => ({
  recordId: id,
  sourceStart: s,
  sourceEnd: e,
  text,
  issues: [],
});
test("planner selects long sparse cues and gaps without any lexical blacklist or reference", () => {
  const rows = [
    row("a", 0, 20, "短い文"),
    row("b", 22, 23),
    row("c", 25, 40, "別の文"),
  ];
  const copy = structuredClone(rows),
    p = planSpeechRegions(rows, 50);
  assert.equal(p.length, 4);
  assert.deepEqual(rows, copy);
  assert.deepEqual(
    p.map((r) => r.kind),
    ["long-sparse-cue", "long-sparse-cue", "subtitle-gap", "subtitle-gap"],
  );
  assert(p.reduce((s, r) => s + r.cropEnd - r.cropStart, 0) <= 120);
  assert.throws(
    () => planSpeechRegions([row("bad", 1, 1)], 50),
    /INVALID_BASELINE/u,
  );
});
const region = {
  id: "region-1",
  start: 0,
  end: 20,
  cropStart: 0,
  cropEnd: 20.5,
  recordIds: ["old"],
  kind: "long-sparse-cue",
};
const vad = {
  rawUnit: "CENTISECONDS",
  inputFrames: 328000,
  sampleRate: 16000,
  rawIntervals: [{ start: 700, end: 750 }],
};
test("VAD centiseconds mapped exactly once and no-speech is not deletion evidence", () => {
  const a = planSpeechProbes(region, vad, 30);
  assert.equal(a.probe.start, 6);
  assert.equal(a.probe.end, 8.5);
  assert.equal(a.probe.speechStart, 7);
  const no = planSpeechProbes(region, { ...vad, rawIntervals: [] }, 30);
  assert.equal(no.probe, null);
  assert.equal(no.finding, "LOW_DETECTOR_SUPPORT");
  assert.throws(
    () => planSpeechProbes(region, { ...vad, rawUnit: "SECONDS" }, 30),
    /VAD_UNIT/u,
  );
  assert.throws(
    () => planSpeechProbes(region, { ...vad, inputFrames: 1 }, 30),
    /VAD_FRAMES/u,
  );
  assert.throws(
    () =>
      planSpeechProbes(
        region,
        { ...vad, rawIntervals: [{ start: 700, end: 3000 }] },
        30,
      ),
    /INVALID_VAD/u,
  );
});
test("all unexamined detected activity stays explicit", () => {
  const a = planSpeechProbes(
    region,
    {
      ...vad,
      rawIntervals: [
        { start: 700, end: 750 },
        { start: 1000, end: 1200 },
      ],
    },
    30,
  );
  assert.equal(a.probe.coversAllDetectedActivity, false);
  assert.equal(a.deferredIntervals.length, 1);
});
const probe = planSpeechProbes(region, vad, 30).probe;
const views = () => [
  {
    backend: "whisper",
    unresolvedCount: 0,
    records: [row("w", 7.02, 7.5, "ああ")],
  },
  {
    backend: "kotoba",
    unresolvedCount: 0,
    records: [row("k", 7.04, 7.48, "ああ")],
  },
];
test("only whole supported short text creates a separate proposal", () => {
  const old = [row("old", 0, 20), row("keep", 22, 23)],
    v = views();
  const d = decideSpeechProbe(probe, old, v);
  assert.equal(d.status, "CANDIDATE");
  const next = assembleSpeechProposals(old, [d]);
  assert.equal(next.length, 2);
  assert.deepEqual(next[1], old[1]);
  assert.equal(next[0].sourceStart, 7.02);
  assert.equal(d.acousticTimingVerified, false);
});
for (const [reason, change] of [
  [
    "TEXT_DISAGREEMENT_OR_NOT_SHORT",
    (v) => {
      v[1].records[0].text = "うん";
    },
  ],
  [
    "TWO_BACKENDS_REQUIRED",
    (v) => {
      v[1].backend = "whisper";
    },
  ],
  [
    "UNSUPPORTED_CROP_EDGE_TIMING",
    (v) => {
      v[0].records[0].sourceStart = 6;
    },
  ],
  [
    "TIMING_DISAGREEMENT",
    (v) => {
      v[1].records[0].sourceStart = 7.45;
    },
  ],
  [
    "NOT_ONE_VALID_WHOLE_CUE",
    (v) => {
      v[1].records = [];
    },
  ],
  [
    "NOT_ONE_VALID_WHOLE_CUE",
    (v) => {
      v[1].unresolvedCount = 1;
    },
  ],
])
  test(`reject ${reason}`, () => {
    const v = views();
    change(v);
    assert.equal(
      decideSpeechProbe(probe, [row("old", 0, 20)], v).reason,
      reason,
    );
  });
test("retain legitimate repeated short responses and collisions", () => {
  const old = [row("a", 7, 7.6, "ああ"), row("b", 9, 9.6, "ああ")];
  assert.equal(
    decideSpeechProbe(
      { ...probe, kind: "subtitle-gap", recordIds: [] },
      old,
      views(),
    ).reason,
    "NEIGHBOR_COLLISION",
  );
  assert.deepEqual(assembleSpeechProposals(old, []), old);
  assert.equal(
    decideSpeechProbe(
      { ...probe, coversAllDetectedActivity: false },
      [row("old", 0, 20)],
      views(),
    ).reason,
    "UNEXAMINED_ACTIVITY_IN_OLD_CUE",
  );
});
