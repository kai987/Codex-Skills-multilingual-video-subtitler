import test from "node:test";
import assert from "node:assert/strict";
import {
  planIslands,
  compareIslands,
} from "../scripts/lib/acoustic-islands.mjs";
const span = (cut) => ({
  start: cut - 0.1,
  end: cut + 0.1,
  cut,
  cropEdgeLimited: false,
});
const fixture = () => ({
  activity: [
    { start: 10, end: 11 },
    { start: 12, end: 13 },
    { start: 14, end: 15 },
  ],
  quietSpans: [span(11.5), span(13.5), span(15.5)],
});
const targets = [{ sourceStart: 10.5, sourceEnd: 15 }];
test("unbounded first activity is deferred; later islands keep both acoustic cuts", () => {
  const p = planIslands(fixture(), targets);
  assert.equal(p.deferred[0].reason, "NO_TWO_SIDED_ACOUSTIC_CUT");
  assert.deepEqual(
    p.selected.map((r) => [r.start, r.end]),
    [
      [11.5, 13.5],
      [13.5, 15.5],
    ],
  );
  assert(p.selected.every((r) => r.lexicalPrompt === null));
});
test("text and record names do not influence acoustic crop choice", () => {
  assert.deepEqual(
    planIslands(fixture(), targets),
    planIslands(
      fixture(),
      targets.map((r) => ({ ...r, text: "秘密の正解", recordId: "unrelated" })),
    ),
  );
});
test("crop crossing another speech island is not selected", () => {
  const f = fixture();
  f.quietSpans = [span(9), span(15.5)];
  assert.equal(planIslands(f, targets).selected.length, 0);
});
test("crop-edge quiet spans do not become boundaries", () => {
  const f = fixture();
  f.quietSpans.forEach((s) => {
    s.cropEdgeLimited = true;
  });
  assert.equal(planIslands(f, targets).selected.length, 0);
});
test("per-window and total request budgets never silently expand", () => {
  const f = {
    activity: [{ start: 10, end: 20 }],
    quietSpans: [span(9), span(21)],
  };
  assert.equal(
    planIslands(f, [{ sourceStart: 10, sourceEnd: 20 }]).selected.length,
    0,
  );
});
test("overlapping/invalid activities are rejected", () => {
  const f = fixture();
  f.activity[1].start = 10.5;
  assert.throws(() => planIslands(f, targets), /INVALID_ACTIVITY/u);
});
function comparison(
  textA,
  textB,
  baseline = [
    { recordId: "r", sourceStart: 10, sourceEnd: 16, text: "あれすまん" },
  ],
) {
  const plan = {
    selected: [
      { id: "a", start: 11, end: 12, activity: { start: 11.2, end: 11.8 } },
    ],
  };
  const views = [
    { targetId: "a", backend: "whisper", text: textA },
    { targetId: "a", backend: "kotoba", text: textB },
  ];
  return compareIslands(plan, views, baseline)[0];
}
test("paired fragment match records substring provenance, not replacement authority", () => {
  const r = comparison("すまん", "すまん。");
  assert.equal(r.status, "PAIRED_LOCAL_TEXT_EVIDENCE");
  assert.equal(r.associations[0].matches[0].relation, "substring-only");
  assert.equal(r.subtitleMutationAuthorized, false);
  assert.equal(r.boundaryValidated, false);
});
test("kanji/kana, lexical disagreements and empty recognition are not coerced", () => {
  for (const texts of [
    ["何か", "なんか"],
    ["あれ", "それ"],
    ["", ""],
  ])
    assert.equal(comparison(...texts).status, "LOCAL_TEXT_CONFLICT_OR_EMPTY");
});
test("repeated lexical matches remain ambiguous", () => {
  const r = comparison("あれ", "あれ", [{ recordId: "r", text: "あれあれ" }]);
  assert.equal(r.associations[0].matches[0].uniqueInRecord, false);
});
test("duplicate backend or absent paired evidence is rejected", () => {
  assert.throws(
    () =>
      compareIslands(
        { selected: [{ id: "a" }] },
        [{ targetId: "a", backend: "whisper", text: "a" }],
        [],
      ),
    /ONE_VIEW/u,
  );
});
