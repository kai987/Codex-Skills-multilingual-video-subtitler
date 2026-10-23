import test from "node:test";
import assert from "node:assert/strict";
import {
  planContextRecovery,
  boundActivityToCrop,
} from "../scripts/lib/recovery-context-routing.mjs";

test("source endpoint rounding is bounded, genuine overruns fail", () => {
  const raw = [{ start: 636.1400000000001, end: 636.5300000000001 }];
  const crop = { start: 634.57, end: 636.53 };
  assert.equal(boundActivityToCrop(raw, crop)[0].end, 636.53);
  assert.equal(raw[0].end, 636.5300000000001);
  assert.throws(
    () => boundActivityToCrop([{ start: 635, end: 636.54 }], crop),
    /ACTIVITY_OUTSIDE_CROP/,
  );
});

function fixture() {
  return {
    baseline: [],
    targets: [
      {
        probe: {
          id: "synthetic",
          start: 10,
          end: 18,
          targetStart: 13,
          targetEnd: 14,
        },
        observation: {
          id: "synthetic",
          sourceIntervals: [{ start: 12.8, end: 14.3 }],
        },
        views: ["whisper", "kotoba"].map((backend) => ({
          backend,
          targetId: "synthetic",
          records: [{ start: 12.8, end: 14.3, text: "そうか" }],
        })),
      },
    ],
  };
}
const row = (x) => planContextRecovery(x).rows[0];
const cue = (id, start, end, text = "既存の発話") => ({ id, start, end, text });

test("unrun fragment inside a cue is reviewed, not scheduled as new dialogue", () => {
  const x = fixture();
  x.baseline = [cue("host", 11, 16)];
  x.targets[0].views = [];
  const r = row(x);
  assert.equal(r.route, "inside-existing-cue-review");
  assert.equal(r.asrStatus, "not-run");
  assert.equal(r.originalOccurrenceRoute, "asr-not-run");
  assert.equal(r.textComplete, null);
  assert.equal(r.reviewRequired, true);
  assert(
    r.warnings.includes("CUE_OCCUPANCY_DOES_NOT_EXCLUDE_MISSING_INTERJECTION"),
  );
});
test("bounded gap does not prove a separate missing utterance", () => {
  const x = fixture();
  x.baseline = [cue("left", 11, 13), cue("right", 14, 16)];
  const r = row(x);
  assert.equal(r.route, "between-cues-association-review");
  assert.equal(r.confirmedMissingUtterance, false);
  assert.equal(r.baselineGeometry.hosts.length, 0);
});
test("activity crossing a cue edge is only a continuation hypothesis", () => {
  const x = fixture();
  x.baseline = [cue("left", 11, 13)];
  const r = row(x);
  assert.equal(r.route, "cue-boundary-continuation-review");
  assert(r.warnings.includes("VAD_EDGE_IS_NOT_SUBTITLE_EDGE"));
  assert.deepEqual(r.timingChanges, []);
});
test("uncovered paired response is retained as possible new speech", () => {
  const r = row(fixture());
  assert.equal(r.route, "possible-new-utterance-review");
  assert.equal(r.occurrence.alignmentText, "そうか");
  assert.equal(r.safeToInsert, false);
});
test("distant identical words do not absorb another occurrence", () => {
  const x = fixture();
  x.baseline = [cue("distant", 40, 42, "そうか")];
  assert.equal(row(x).route, "possible-new-utterance-review");
  assert.equal(row(x).unresolvedOtherHypothesisIds.length, 2);
});
test("extra trailing interjection survives matching surrounding text", () => {
  const x = fixture();
  x.baseline = [cue("host", 11, 16, "そうか")];
  x.targets[0].views[0].records = [
    { start: 12, end: 13.5, text: "そうか" },
    { start: 13.5, end: 14.3, text: "ああ" },
  ];
  const r = row(x);
  assert.equal(r.occurrence.donors.length, 3);
  assert(r.unresolvedOtherHypothesisIds.includes("whisper:1"));
  assert.equal(r.reviewRequired, true);
  assert.deepEqual(r.deletions, []);
});
test("context-only activity remains unsupported review, not nonspeech truth", () => {
  const x = fixture();
  x.targets[0].observation.sourceIntervals = [{ start: 10, end: 11 }];
  x.targets[0].views = [];
  const r = row(x);
  assert.equal(r.route, "retain-unsupported-review");
  assert.equal(r.retained, true);
  assert.equal(r.textComplete, null);
});
test("partially supported target is retained", () => {
  const x = fixture();
  x.targets[0].observation.sourceIntervals = [{ start: 13.9, end: 14.3 }];
  assert.equal(row(x).route, "possible-new-utterance-review");
});
test("multiple host cues remain an explicit association conflict", () => {
  const x = fixture();
  x.baseline = [cue("a", 11, 13.5), cue("b", 13.5, 16)];
  assert.equal(row(x).route, "overlapping-cues-association-review");
});
test("reject annotation fields, duplicate targets, empty inventory and invalid time", () => {
  const x = fixture();
  assert.throws(
    () => planContextRecovery({ ...x, labels: [] }),
    /MACHINE_FIELDS_ONLY/,
  );
  assert.throws(
    () => planContextRecovery({ ...x, targets: [x.targets[0], x.targets[0]] }),
    /DUPLICATE_TARGET/,
  );
  assert.throws(
    () => planContextRecovery({ ...x, targets: [] }),
    /TARGETS_REQUIRED/,
  );
  assert.throws(
    () => planContextRecovery({ ...x, targets: [null] }),
    /OBJECT_REQUIRED/,
  );
  x.targets[0].probe.targetEnd = 19;
  assert.throws(() => planContextRecovery(x), /INVALID_PROBE/);
});
test("all targets retained, input immutable and mutations/inference remain zero", () => {
  const x = fixture();
  const second = JSON.parse(JSON.stringify(x.targets[0]));
  second.probe.id = second.observation.id = "other";
  second.views = [];
  x.targets.push(second);
  const before = JSON.parse(JSON.stringify(x));
  const r = planContextRecovery(x);
  assert.deepEqual(x, before);
  assert.equal(r.targets, 2);
  assert.equal(r.retained, 2);
  assert.equal(r.dropped, 0);
  assert.equal(
    r.newInference + r.modelLoads + r.textMutations + r.timingMutations,
    0,
  );
  assert(
    r.rows.every((t) => t.retained && t.reviewRequired && !t.safeToInsert),
  );
  assert(r.rows.every((t) => !t.requests.length && !t.insertions.length));
});
