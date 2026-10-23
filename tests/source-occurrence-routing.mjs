import test from "node:test";
import assert from "node:assert/strict";
import {
  routeSourceOccurrence,
  sourceOccurrenceInputs,
} from "../scripts/lib/source-occurrence-routing.mjs";

function fixture() {
  return {
    probe: { id: "test", start: 10, end: 18, targetStart: 13, targetEnd: 14 },
    baseline: [],
    observation: { id: "test", sourceIntervals: [{ start: 12.8, end: 14.3 }] },
    views: ["whisper", "kotoba"].map((backend) => ({
      backend,
      targetId: "test",
      records: [{ start: 12.5, end: 14.1, text: "そうか" }],
    })),
  };
}
test("paired local text is reusable but neither ASR nor VAD becomes subtitle timing", () => {
  const x = fixture(),
    before = JSON.parse(JSON.stringify(x)),
    r = routeSourceOccurrence(x);
  assert.equal(r.route, "text-consensus-boundaries-unverified");
  assert.equal(r.alignmentText, "そうか");
  assert.equal(r.components[0].subtitleInterval, null);
  assert.deepEqual(r.requests, []);
  assert.deepEqual(r.insertions, []);
  assert.deepEqual(x, before);
});
test("context consensus before target cannot become target transcript", () => {
  const x = fixture();
  x.views.forEach(
    (v) => (v.records = [{ start: 10, end: 12, text: "そうか" }]),
  );
  const r = routeSourceOccurrence(x);
  assert.equal(r.route, "missing-backend-evidence");
  assert.equal(r.alignmentText, null);
});
test("one target across two separated activities is not one occurrence", () => {
  const x = fixture();
  x.observation.sourceIntervals = [
    { start: 12.8, end: 13.2 },
    { start: 13.8, end: 14.3 },
  ];
  const r = routeSourceOccurrence(x);
  assert.equal(r.route, "multiple-target-activities");
  assert.equal(r.alignmentText, null);
  assert.equal(r.components.length, 2);
  assert.ok(
    r.components.every((c) =>
      c.blockers.includes("SEGMENT_SPANS_MULTIPLE_ACTIVITIES"),
    ),
  );
});
test("multi-component donor cannot supply the entire transcript to the target", () => {
  const x = fixture();
  x.observation.sourceIntervals.push({ start: 15, end: 16 });
  x.views.forEach((v) => (v.records[0].end = 16));
  const r = routeSourceOccurrence(x);
  assert.equal(r.route, "cross-component-localization");
  assert.equal(r.alignmentText, null);
  assert.equal(r.components[1].targetOverlap, false);
});
test("one backend extra reply stays mixed context, not single consensus", () => {
  const x = fixture();
  x.views[0].records = [
    { start: 12, end: 13.5, text: "そうか" },
    { start: 13.5, end: 14.5, text: "はい" },
  ];
  const r = routeSourceOccurrence(x);
  assert.equal(r.route, "mixed-context-localization");
  assert.equal(r.alignmentText, null);
  assert.equal(r.donors.length, 3);
});
test("unrun is not a text rejection; unsupported is not nonspeech truth", () => {
  const x = fixture();
  x.views = [];
  assert.equal(routeSourceOccurrence(x).route, "asr-not-run");
  x.observation.sourceIntervals = [];
  assert.equal(routeSourceOccurrence(x).route, "target-activity-unsupported");
});
test("spelling conflicts remain explicit even for single component", () => {
  const x = fixture();
  x.views[1].records[0].text = "そうだ";
  const r = routeSourceOccurrence(x);
  assert.equal(r.route, "text-conflict");
  assert.equal(r.alignmentText, null);
});
test("crop-edge consensus keeps text but not times", () => {
  const x = fixture();
  x.views.forEach((v) => (v.records[0].start = 10));
  const r = routeSourceOccurrence(x);
  assert.equal(r.alignmentText, "そうか");
  assert.ok(r.components[0].blockers.includes("CROP_EDGE_TIMING"));
  assert.equal(r.components[0].subtitleInterval, null);
});
test("existing context prevents duplicate insertion and is not erased", () => {
  const x = fixture();
  x.baseline = [{ id: "b", start: 11, end: 12, text: "そうか" }];
  const r = routeSourceOccurrence(x);
  assert.equal(r.route, "existing-context-review");
  assert.equal(r.alignmentText, null);
  assert.equal(r.donors[0].baselineLinks[0].timingOverlap, false);
});
test("a distant repeated word cannot silently link another occurrence", () => {
  const x = fixture();
  x.baseline = [{ id: "b", start: 25, end: 26, text: "そうか" }];
  assert.equal(
    routeSourceOccurrence(x).route,
    "text-consensus-boundaries-unverified",
  );
});
test("reject reference fields, foreign ids, duplicate backend and bad timebase", () => {
  const x = fixture();
  assert.throws(
    () => routeSourceOccurrence({ ...x, labels: [] }),
    /MACHINE_EVIDENCE/,
  );
  const y = fixture();
  y.views[1].backend = "whisper";
  assert.throws(() => routeSourceOccurrence(y), /BACKENDS/);
  const z = fixture();
  z.observation.id = "other";
  assert.throws(() => routeSourceOccurrence(z), /TARGET_ID/);
  const w = fixture();
  w.observation.sourceIntervals = [{ start: 0.2, end: 0.7 }];
  assert.throws(() => routeSourceOccurrence(w), /SOURCE_ACTIVITY/);
});
test("reject unsorted and overlapping activity rather than merging distinct evidence", () => {
  const x = fixture();
  x.observation.sourceIntervals.push({ start: 14, end: 15 });
  assert.throws(() => routeSourceOccurrence(x), /SOURCE_ACTIVITY/);
});
test("endpoint contact is not acoustic overlap", () => {
  const x = fixture();
  x.views[0].records[0].end = 12.8;
  assert.equal(routeSourceOccurrence(x).route, "missing-backend-evidence");
});

test("frozen plan adapter retains deferred and unsupported inventories without swallowing missing views", () => {
  const x = fixture();
  const p = {
    probes: [x.probe],
    baseline: x.baseline,
    referenceUsed: false,
    labelsUsed: false,
    selected: {
      deferred: [{ ...x.probe, id: "deferred" }],
      unsupportedRetainedIds: ["unsupported"],
    },
    vadObservations: [
      x.observation,
      { ...x.observation, id: "deferred" },
      { id: "unsupported", sourceIntervals: [] },
    ],
  };
  const inputs = sourceOccurrenceInputs(p, x.views);
  assert.equal(inputs.length, 2);
  assert.equal(routeSourceOccurrence(inputs[1]).route, "asr-not-run");
  assert.throws(() => sourceOccurrenceInputs(p, []), /MISSING_EXECUTED_VIEW/);
  assert.throws(
    () => sourceOccurrenceInputs({ ...p, labelsUsed: true }, x.views),
    /REFERENCE_INPUT/,
  );
  assert.throws(
    () =>
      sourceOccurrenceInputs(
        { ...p, vadObservations: p.vadObservations.slice(0, 2) },
        x.views,
      ),
    /INCOMPLETE_ACTIVITY/,
  );
});
