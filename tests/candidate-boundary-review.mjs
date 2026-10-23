import test from "node:test";
import assert from "node:assert/strict";
import { reviewCandidateBoundaries } from "../scripts/lib/candidate-boundary-review.mjs";
const target = { id: "t", start: 10, end: 14 };
const views = (a, b) => [
  { id: "v1", targetId: "t", start: 8, end: 16, records: a },
  { id: "v2", targetId: "t", start: 5, end: 19, records: b },
];
const row = (text, start = 10, end = 14) => ({ text, start, end });
test("same-model whole-text stability does not authorize boundary repair", () => {
  const result = reviewCandidateBoundaries(
    target,
    views([row("ここで待ってください")], [row("ここで待ってください")]),
  );
  assert.equal(result.links[0].relation, "whole-text-exact");
  assert.equal(result.automaticReplacementAllowed, false);
  assert.equal(result.proposedRepair, null);
});
test("contained text cannot inherit a longer sentence's parent interval", () => {
  const result = reviewCandidateBoundaries(
    target,
    views(
      [row("ここで待ってください")],
      [row("あここで待ってください次はどこへ", 9, 15)],
    ),
  );
  assert.equal(result.links[0].relation, "text-containment-only");
  assert(
    result.links[0].blockers.includes("SUBSTRING_HAS_NO_LOCALIZED_WORD_TIMES"),
  );
  assert.equal(result.links[0].proposedInterval, null);
});
test("extraction edge is preserved and rejected, never clamped into a repair", () => {
  const result = reviewCandidateBoundaries(
    target,
    views(
      [row("ここで待ってください", 8, 14)],
      [row("ここで待ってください", 10, 14)],
    ),
  );
  assert(result.links[0].blockers.includes("START_AT_EXTRACTION_EDGE"));
  assert(result.links[0].blockers.includes("PARENT_BOUNDARIES_DISAGREE"));
  assert.equal(result.views[0][0].start, 8);
});
test("separate repeated occurrences are not joined through text equality", () => {
  const result = reviewCandidateBoundaries(
    target,
    views([row("待って", 10, 11)], [row("待って", 12, 13)]),
  );
  assert.equal(result.links.length, 0);
});
test("short particles cannot establish containment of a complete sentence", () => {
  const result = reviewCandidateBoundaries(
    target,
    views([row("それは")], [row("それはカードです")]),
  );
  assert.equal(result.links.length, 0);
});
test("one broad parent matching multiple occurrences is ambiguous", () => {
  const result = reviewCandidateBoundaries(
    target,
    views(
      [row("待って", 10, 11), row("待って", 12, 13)],
      [row("待って", 9, 15)],
    ),
  );
  assert.equal(result.links.length, 2);
  assert(
    result.links.every((l) =>
      l.blockers.includes("AMBIGUOUS_OCCURRENCE_ASSOCIATION"),
    ),
  );
});
test("missing or duplicate views and invalid mapping fail closed", () => {
  assert.throws(() => reviewCandidateBoundaries(target, []));
  const v = views([row("待って")], [row("待って")]);
  assert.throws(() => reviewCandidateBoundaries(target, [v[0], v[0]]));
  assert.throws(() =>
    reviewCandidateBoundaries(
      target,
      views([row("待って", 7, 14)], [row("待って")]),
    ),
  );
});
test("context is retained without deleting trailing conflicting responses", () => {
  const v = views(
    [row("それはカードです"), row("あ", 14, 15)],
    [row("それはカードです"), row("ありがとうございます", 14, 17)],
  );
  const before = JSON.stringify(v);
  const r = reviewCandidateBoundaries(target, v);
  assert.equal(r.views.flat().length, 4);
  assert.equal(JSON.stringify(v), before);
  assert.deepEqual(r, reviewCandidateBoundaries(target, v));
});
