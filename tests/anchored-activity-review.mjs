import test from "node:test";
import assert from "node:assert/strict";
import { reviewAnchoredActivity } from "../scripts/lib/anchored-activity-review.mjs";
const fixture = () => ({
  sourceWindow: { start: 10, end: 16 },
  originalTarget: { start: 11, end: 12 },
  activityWindow: { start: 10, end: 14 },
  anchor: { start: 13.5, end: 13.525 },
  donor: { start: 12, end: 16, text: "ああ" },
  greedyText: "ああ。",
  vadIntervals: [
    { start: 10.5, end: 12.1 },
    { start: 13.4, end: 14 },
  ],
  baseline: [{ id: "old", start: 10, end: 11, text: "前句" }],
});
test("finds later activity without dragging it into original target", () => {
  const f = fixture(),
    before = globalThis.structuredClone(f),
    r = reviewAnchoredActivity(f);
  assert.equal(r.anchorOutsideOriginalTarget, true);
  assert.equal(r.distinctFromOriginalTargetActivity, true);
  assert.deepEqual(r.activity, { start: 13.4, end: 14 });
  assert.equal(r.rightCensored, true);
  assert.equal(r.route, "context-edge-boundary-review");
  assert.equal(r.subtitleInterval, null);
  assert.deepEqual(f, before);
});
test("interior activity still does not prove complete utterance boundaries", () => {
  const f = fixture();
  f.activityWindow.end = 15;
  const r = reviewAnchoredActivity(f);
  assert.equal(r.rightCensored, false);
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.equal(r.subtitleInterval, null);
});
test("identical existing cue prevents duplicate insertion", () => {
  const f = fixture();
  f.baseline.push({ id: "covered", start: 13.3, end: 14.1, text: "ああ" });
  const r = reviewAnchoredActivity(f);
  assert.equal(r.route, "existing-cue-review");
  assert.equal(r.existingCueOverlaps[0].sameText, true);
  assert.deepEqual(r.proposedInsertions, []);
});
test("different overlapping dialogue is still a collision", () => {
  const f = fixture();
  f.baseline.push({ id: "neighbor", start: 13.3, end: 14.1, text: "違う" });
  assert.equal(reviewAnchoredActivity(f).route, "existing-cue-review");
});
test("distant repeated word is not a duplicate at this occurrence", () => {
  const f = fixture();
  f.baseline.push({ id: "distant", start: 1, end: 2, text: "ああ" });
  assert.equal(reviewAnchoredActivity(f).existingCueOverlaps.length, 0);
});
test("endpoint contact and bridge between activities do not anchor speech", () => {
  for (const anchor of [
    { start: 12.1, end: 12.2 },
    { start: 12, end: 13.5 },
  ]) {
    const f = fixture();
    f.anchor = anchor;
    assert.equal(reviewAnchoredActivity(f).activity, null);
  }
});
test("no forced association for mismatched greedy text or donor occurrence", () => {
  const f = fixture();
  f.greedyText = "別";
  assert.equal(reviewAnchoredActivity(f).route, "unresolved-association");
  f.greedyText = "ああ";
  f.donor.end = 13;
  assert.equal(reviewAnchoredActivity(f).route, "unresolved-association");
});
test("rejects foreign coordinates, unordered activity and reference fields", () => {
  const f = fixture();
  assert.throws(() => reviewAnchoredActivity({ ...f, referenceText: "ああ" }));
  assert.throws(() =>
    reviewAnchoredActivity({ ...f, activityWindow: { start: 0, end: 14 } }),
  );
  assert.throws(() =>
    reviewAnchoredActivity({
      ...f,
      vadIntervals: [...f.vadIntervals].reverse(),
    }),
  );
});
