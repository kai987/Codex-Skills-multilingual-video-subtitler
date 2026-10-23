import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSubmittedReview,
  applyAdjudicatedReview,
  targetHash,
} from "../scripts/lib/apply-residual-review.mjs";
const records = [
  { start: 1, end: 2, text: "me" },
  { start: 2, end: 3, text: "ん" },
  { start: 5, end: 6, text: "ありがとうございました" },
];
function fixture() {
  const items = records.slice(0, 2).map((r, i) => ({
    id: `r${i}`,
    originalCue: i + 1,
    currentCue: i + 1,
    targetHash: targetHash(r),
  }));
  const manifest = { packageId: "pkg", baselineHash: "base", items };
  const labels = {
    ...manifest,
    version: "residual-listening-labels-v1",
    reviewer: "",
    status: "draft",
    items: items.map((r, i) => ({
      ...r,
      decision: i ? "vocalization" : "environment",
      text: i ? "ふ" : "",
      heard: true,
    })),
  };
  const submission = {
    authority: "explicit-user-confirmed-submission",
    quote: "可以",
    reviewer: "YUAN",
  };
  const specs = items.map((r, i) => ({
    id: r.id,
    expectedDecision: i ? "vocalization" : "environment",
    expectedText: i ? "ふ" : "",
    action: i ? "replace-target-text" : "remove-reviewed-target",
    text: i ? "ふ" : null,
    reason: "Explicit listening confirmation",
    preserveNeighbors: [
      { index: 2, expected: [5, 6, "ありがとうございました"] },
    ],
  }));
  return { manifest, labels, submission, specs };
}
test("explicit submission supplements reviewer without mutating uploaded draft", () => {
  const f = fixture(),
    before = JSON.stringify(f.labels);
  const e = validateSubmittedReview(
    f.manifest,
    f.labels,
    records,
    f.submission,
  );
  assert.equal(e.reviewer, "YUAN");
  assert.equal(e.status, "submitted-for-validation");
  assert.equal(JSON.stringify(f.labels), before);
});
test("missing confirmation and stale package are blocked", () => {
  const f = fixture();
  assert.throws(
    () =>
      validateSubmittedReview(f.manifest, f.labels, records, {
        ...f.submission,
        reviewer: "",
      }),
    /MISSING_SUBMISSION/u,
  );
  f.labels.packageId = "foreign";
  assert.throws(
    () => validateSubmittedReview(f.manifest, f.labels, records, f.submission),
    /STALE_REVIEW_PACKAGE/u,
  );
});
test("unheard, changed target, and duplicated labels are blocked", () => {
  const f = fixture();
  f.labels.items[0].heard = false;
  assert.throws(
    () => validateSubmittedReview(f.manifest, f.labels, records, f.submission),
    /UNHEARD/u,
  );
  f.labels.items[0].heard = true;
  assert.throws(
    () =>
      validateSubmittedReview(
        f.manifest,
        f.labels,
        [{ ...records[0], end: 2.1 }, ...records.slice(1)],
        f.submission,
      ),
    /CHANGED_REVIEW_TARGET/u,
  );
  f.labels.items[1] = f.labels.items[0];
  assert.throws(
    () => validateSubmittedReview(f.manifest, f.labels, records, f.submission),
    /DUPLICATE_REVIEW/u,
  );
});
test("bound removal and text repair preserve context and timing", () => {
  const f = fixture(),
    e = validateSubmittedReview(f.manifest, f.labels, records, f.submission);
  const c = applyAdjudicatedReview(records, e, f.specs, [records[2]]);
  assert.equal(c.result.length, 2);
  assert.equal(c.result[0].text, "ふ");
  assert.deepEqual([c.result[0].start, c.result[0].end], [2, 3]);
  assert.equal(c.result[1].text, records[2].text);
});
test("cannot paste entire context or unconfirmed spelling into target", () => {
  const f = fixture(),
    e = validateSubmittedReview(f.manifest, f.labels, records, f.submission);
  f.specs[1].text = "ふ\nありがとうございました";
  assert.throws(
    () => applyAdjudicatedReview(records, e, f.specs, []),
    /UNSAFE_REPLACEMENT/u,
  );
  f.specs[1].text = "ふう";
  assert.throws(
    () => applyAdjudicatedReview(records, e, f.specs, []),
    /TEXT_NOT_EXPLICITLY_REVIEWED/u,
  );
});
test("cannot alter protected confirmation or expected neighbor", () => {
  const f = fixture(),
    e = validateSubmittedReview(f.manifest, f.labels, records, f.submission);
  assert.throws(
    () => applyAdjudicatedReview(records, e, f.specs, [records[0]]),
    /LOST_HUMAN_CONFIRMATION/u,
  );
  f.specs[0].preserveNeighbors[0].expected[2] = "ありがとう";
  assert.throws(
    () => applyAdjudicatedReview(records, e, f.specs, []),
    /CHANGED_CONTEXT_NEIGHBOR/u,
  );
});
