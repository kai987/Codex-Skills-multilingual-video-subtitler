import test from "node:test";
import assert from "node:assert/strict";
import {
  reviewPayload,
  renderResidualReview,
} from "../scripts/lib/residual-review.mjs";
const manifest = {
  packageId: "pkg",
  baselineHash: "base",
  items: [
    {
      id: "r1",
      targetHash: "target",
      originalCue: 1,
      currentCue: 2,
      start: 2,
      end: 3,
      text: "ん",
      clips: [{ file: "a.wav", start: 0, end: 6 }],
      references: [],
    },
  ],
};
test("empty/partial form is exportable draft, not false confirmation", () => {
  const p = reviewPayload(manifest, "", {});
  assert.equal(p.status, "draft");
  assert.equal(p.items[0].status, "draft");
  assert.equal(p.subtitleMutations, 0);
});
test("vocalization needs no lexical text or speaker-relationship field", () => {
  const p = reviewPayload(manifest, "YUAN", {
    r1: { heard: true, decision: "vocalization" },
  });
  assert.equal(p.items[0].status, "reviewed");
  assert.equal(p.items[0].text, "");
});
test("wrong text needs actual text, uncertain remains unresolved", () => {
  assert.equal(
    reviewPayload(manifest, "x", {
      r1: { heard: true, decision: "wrong-text" },
    }).items[0].status,
    "draft",
  );
  assert.equal(
    reviewPayload(manifest, "x", { r1: { decision: "uncertain" } }).items[0]
      .status,
    "unresolved",
  );
});
test("unknown choice or unchecked listening cannot approve a deletion", () => {
  assert.equal(
    reviewPayload(manifest, "x", { r1: { decision: "environment" } }).items[0]
      .status,
    "draft",
  );
  assert.equal(
    reviewPayload(manifest, "x", { r1: { heard: true, decision: "bogus" } })
      .items[0].status,
    "draft",
  );
});
test("export is bound to baseline and cue hashes", () => {
  const p = reviewPayload(manifest, "x", {});
  assert.equal(p.packageId, "pkg");
  assert.equal(p.baselineHash, "base");
  assert.equal(p.items[0].targetHash, "target");
});
test("page escapes text and keeps script-safe embedded data, fallback export", () => {
  const m = JSON.parse(JSON.stringify(manifest));
  m.items[0].text = "</script><img src=x>";
  const html = renderResidualReview(m);
  assert(html.includes("&lt;/script&gt;"));
  assert(html.includes("\\u003c/script>"));
  assert(html.includes('id="json"'));
  assert(html.includes('id="copy"'));
});
