import test from "node:test";
import assert from "node:assert/strict";
import {
  planShortResponseDisplay as plan,
  renderDisplayPreview,
} from "../scripts/lib/short-response-display.mjs";
const fixture = () => ({
  sourceWindow: { start: 10, end: 15 },
  activityWindow: { start: 10, end: 15 },
  originalTarget: { start: 11, end: 11.2 },
  anchor: { start: 12.04, end: 12.065 },
  donor: { start: 11.8, end: 13, text: "ああ" },
  greedyText: "ああ。",
  vadIntervals: [
    { start: 10.5, end: 11.5 },
    { start: 12, end: 12.2 },
  ],
  baseline: [
    { id: "previous", start: 10, end: 11.4, text: "前句" },
    { id: "next", start: 14, end: 15, text: "次句" },
  ],
});
test("separates immutable acoustic interval, emission and reading hold", () => {
  const f = fixture(),
    original = globalThis.structuredClone(f),
    r = plan(f);
  assert.deepEqual(r.acousticActivity, { start: 12, end: 12.2 });
  assert.deepEqual(r.displayInterval, { start: 12, end: 12.8 });
  assert.equal(r.trailingHold.durationSeconds, 0.6);
  assert.equal(r.verifiedUtteranceInterval, null);
  assert.equal(r.primarySubtitleMutationAuthorized, false);
  assert.equal(r.humanValidated, false);
  assert.deepEqual(r.blockers, ["UTTERANCE_BOUNDARIES_NOT_VERIFIED"]);
  assert.deepEqual(f, original);
});
test("next cue caps only reading hold and reports preference shortfall", () => {
  const f = fixture();
  f.baseline[1].start = 12.5;
  const r = plan(f);
  assert.equal(r.displayInterval.end, 12.42);
  assert.equal(r.preferredDurationMet, false);
  assert.equal(r.acousticActivity.end, 12.2);
});
test("unsubtitled following VAD activity also stops display hold", () => {
  const f = fixture();
  f.vadIntervals.push({ start: 12.5, end: 13 });
  assert.equal(plan(f).displayInterval.end, 12.42);
});
test("context end caps hold without extending to unseen audio", () => {
  const f = fixture();
  f.activityWindow.end = 12.5;
  assert.equal(plan(f).displayInterval.end, 12.5);
});
test("600 ms hold cap does not stretch a 25 ms activity to 800 ms", () => {
  const f = fixture();
  f.anchor = { start: 12.005, end: 12.02 };
  f.vadIntervals[1].end = 12.025;
  const r = plan(f);
  assert.equal(r.displayInterval.end, 12.625);
  assert.equal(r.preferredDurationMet, false);
});
test("small previous or following gap blocks rather than trimming acoustic support", () => {
  for (const side of ["previous", "next"]) {
    const f = fixture();
    if (side === "previous") f.baseline[0].end = 11.95;
    else f.baseline[1].start = 12.25;
    assert.equal(plan(f).displayInterval, null);
    assert(plan(f).blockers.includes("INSUFFICIENT_NEIGHBOR_GAP"));
  }
});
test("existing equal or different cue cannot receive a duplicate preview", () => {
  for (const text of ["ああ", "別の句"]) {
    const f = fixture();
    f.baseline.push({ id: "overlap", start: 12.05, end: 12.3, text });
    assert.equal(renderDisplayPreview(f), null);
  }
});
test("censored activity or inconsistent text never gets a preview", () => {
  const f = fixture();
  f.activityWindow.end = 12.2;
  assert.equal(plan(f).displayInterval, null);
  const g = fixture();
  g.greedyText = "いいえ";
  assert.equal(plan(g).displayInterval, null);
});
test("long activity and unsafe/long/non-Japanese text stay out of short-word route", () => {
  const f = fixture();
  f.vadIntervals[1].end = 13;
  assert.equal(plan(f).displayInterval, null);
  for (const text of ["ありがとうございます", "あ\nあ", "{あ}", "yes"]) {
    const g = fixture();
    g.donor.text = text;
    g.greedyText = text;
    assert.equal(plan(g).displayInterval, null);
  }
});
test("quantization never rounds display across source or neighbor limits", () => {
  const f = fixture();
  f.vadIntervals[1] = { start: 12.0004, end: 12.2004 };
  f.baseline[1].start = 12.5004;
  const r = plan(f);
  assert.deepEqual(r.displayInterval, { start: 12, end: 12.42 });
  assert(r.displayInterval.end + 0.08 <= f.baseline[1].start);
});
test("preview is exactly one source-global cue, not a whole-file replacement", () => {
  assert.equal(
    renderDisplayPreview(fixture()),
    "1\n00:00:12,000 --> 00:00:12,800\nああ\n",
  );
});
test("unknown reference fields and invalid coordinates fail closed", () => {
  assert.throws(() => plan({ ...fixture(), reference: "gold" }));
  const f = fixture();
  f.anchor.start = Number.NaN;
  assert.throws(() => plan(f));
});
