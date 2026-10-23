import test from "node:test";
import assert from "node:assert/strict";
import {
  planContrast,
  compareContrast,
} from "../scripts/lib/short-context-contrast.mjs";
const islands = {
  selected: [
    { id: "a", start: 11, end: 12, activity: { start: 11.2, end: 11.8 } },
    { id: "b", start: 12, end: 13, activity: { start: 12.2, end: 12.8 } },
  ],
};
test("extra preceding audio preserves the same target and right edge", () => {
  const p = planContrast(islands, { selected: [{ start: 9, end: 14 }] }, "a");
  assert.deepEqual(p.probe, {
    id: "left-context",
    start: 9,
    end: 12,
    frames: 48000,
  });
  assert.equal(p.lexicalPrompt, null);
});
test("missing target, later activity collision, wrong context and budget fail closed", () => {
  assert.throws(() =>
    planContrast(islands, { selected: [{ start: 9, end: 14 }] }, "missing"),
  );
  for (const start of [12, 0, NaN])
    assert.throws(() =>
      planContrast(islands, { selected: [{ start, end: 14 }] }, "a"),
    );
  const changed = JSON.parse(JSON.stringify(islands));
  changed.selected[1].activity.start = 11.9;
  assert.throws(
    () => planContrast(changed, { selected: [{ start: 9, end: 14 }] }, "a"),
    /FOLLOWING/u,
  );
});
const views = (a, b) => [
  { backend: "whisper", text: a },
  { backend: "kotoba", text: b },
];
test("paired short agreement cannot override a context reversal", () => {
  const r = compareContrast(
    views("終わる", "終わる"),
    views("前句あれ", "前句あれ"),
    [{ text: "あれ", recordId: "a" }],
  );
  assert.equal(r.status, "CROSS_WINDOW_LEXICAL_CONFLICT");
  assert.equal(r.shortAgreement, true);
  assert.equal(r.expandedAgreement, true);
  assert.equal(r.automaticReplacementAllowed, false);
  assert.equal(r.candidatePresence[0].views[0].targetOccurrenceVerified, false);
});
test("one backend disagreement cannot be voted away", () => {
  assert.equal(
    compareContrast(views("あれ", "あれ"), views("前句あれ", "前句終わる"), [])
      .status,
    "CROSS_WINDOW_LEXICAL_CONFLICT",
  );
});
test("retained string is not a timestamp or occurrence proof", () => {
  const r = compareContrast(
    views("あれ", "あれ？"),
    views("あれ前句あれ", "あれ前句あれ"),
    [{ text: "あれ" }],
  );
  assert.equal(r.status, "TEXT_RETAINED_LOCATION_UNVERIFIED");
  assert.equal(r.candidatePresence[0].views[0].uniqueStringMatch, false);
  assert.equal(r.timingVerified, false);
});
test("empty and missing evidence does not authorize replacement", () => {
  assert.equal(
    compareContrast(views("", ""), views("", ""), []).status,
    "CROSS_WINDOW_LEXICAL_CONFLICT",
  );
  assert.throws(() => compareContrast([], views("a", "a"), []), /ONE_VIEW/u);
});
test("lexical normalization does not force kanji/kana agreement", () => {
  assert.equal(
    compareContrast(views("何か", "なんか"), views("何か", "なんか"), [])
      .shortAgreement,
    false,
  );
});
