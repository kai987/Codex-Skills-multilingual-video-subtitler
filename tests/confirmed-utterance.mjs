import test from "node:test";
import assert from "node:assert/strict";
import { insertConfirmedUtterance } from "../scripts/lib/confirmed-utterance.mjs";
const base =
  "1\n00:01:04,280 --> 00:01:06,380\nまあまあ\n\n2\n00:01:14,780 --> 00:01:15,300\nああ\n";
const c = {
  authority: "explicit-human-confirmed-utterance",
  timebase: "source-global-seconds",
  reviewer: "synthetic",
  quote: "synthetic interval confirmation",
  start: 68,
  end: 69.58,
  text: "ああ",
};
const context = { start: 66.93, end: 70.63 };
test("whole utterance start is allowed before old tail-review minimum", () => {
  const r = insertConfirmedUtterance(base, c, context);
  assert.equal(r.inserted, 1);
  assert.equal(r.preserved, 2);
  assert.equal(r.insertedIndex, 2);
  assert.match(r.contents.srt, /00:01:08,000 --> 00:01:09,580\nああ/u);
  assert.equal(r.records[2].sourceStart, 74.78);
  assert.equal(r.machineIndependent, false);
});
test("repeated application cannot duplicate the same occurrence", () => {
  const r = insertConfirmedUtterance(base, c, context);
  assert.equal(
    insertConfirmedUtterance(r.contents.srt, c, context).inserted,
    0,
  );
});
test("human interval is not confused with uncertain tail bracket", () => {
  assert.throws(() =>
    insertConfirmedUtterance(
      base,
      { ...c, authority: "human-tail-bracket-v1" },
      context,
    ),
  );
});
test("overlap cannot overwrite or shift an existing cue", () => {
  assert.throws(
    () =>
      insertConfirmedUtterance(
        base,
        { ...c, start: 65, end: 68 },
        { start: 64, end: 71 },
      ),
    /OVERLAPS/,
  );
});
test("nonfinite reversed out-of-context or clip-local times fail", () => {
  for (const [start, end] of [
    [NaN, 69],
    [69, 68],
    [65, 69],
    [68, 71],
    [1, 2],
  ])
    assert.throws(() =>
      insertConfirmedUtterance(base, { ...c, start, end }, context),
    );
});
test("no silent lexical cleanup or sub-centisecond quantization", () => {
  assert.throws(() =>
    insertConfirmedUtterance(base, { ...c, text: "{ああ}" }, context),
  );
  assert.throws(() =>
    insertConfirmedUtterance(base, { ...c, end: 69.581 }, context),
  );
});
test("malformed block is not silently lost", () => {
  assert.throws(() =>
    insertConfirmedUtterance(base + "\nBAD BLOCK", c, context),
  );
});
