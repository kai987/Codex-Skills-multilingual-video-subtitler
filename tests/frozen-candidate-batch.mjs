import test from "node:test";
import assert from "node:assert/strict";
import { replayCandidateBatch } from "../scripts/lib/frozen-candidate-batch.mjs";
import { reviewAnchoredActivity } from "../scripts/lib/anchored-activity-review.mjs";
function fixture() {
  const baseline = [
    { id: "preferred-1", start: 0, end: 1, text: "こんにちは" },
  ];
  const input = {
    sourceWindow: { start: 4, end: 8 },
    activityWindow: { start: 4, end: 8 },
    anchor: { start: 5.4, end: 5.425 },
    originalTarget: { start: 5.3, end: 5.8 },
    donor: { start: 5.2, end: 6, text: "はい" },
    greedyText: "はい",
    vadIntervals: [{ start: 5.1, end: 6.1 }],
    baseline,
  };
  return {
    seam: {
      baseline: [
        {
          recordId: "old-1",
          sourceStart: 0,
          sourceEnd: 1,
          text: "こんにちは",
          issues: [],
          order: 1,
          requestId: "original",
          chunkIndex: 0,
        },
      ],
      targets: [],
      views: [],
    },
    local: {
      baseline,
      referenceUsed: false,
      labelsUsed: false,
      probes: [
        {
          id: "clip-1",
          start: 4,
          end: 8,
          targetStart: 5.3,
          targetEnd: 5.8,
          hostIds: [],
        },
      ],
      views: [
        {
          targetId: "clip-1",
          backend: "whisper",
          records: [{ start: 5.2, end: 6, text: "はい" }],
        },
        {
          targetId: "clip-1",
          backend: "kotoba",
          records: [{ start: 5.23, end: 6.03, text: "はい" }],
        },
      ],
      vadObservations: [{ id: "clip-1", sourceIntervals: input.vadIntervals }],
    },
    refreshed: { input, after: reviewAnchoredActivity(input) },
  };
}
test("batch applies a supported insertion using unchanged established policy", () => {
  const f = fixture(),
    original = globalThis.structuredClone(f);
  const r = replayCandidateBatch(f);
  assert.equal(r.summary.newInsertions, 1);
  assert.equal(r.candidate[1].text, "はい");
  assert.deepEqual(r.candidate[0], f.local.baseline[0]);
  assert.equal(r.diagnostics[0].primaryMutationAuthorized, false);
  assert.deepEqual(f, original);
});
test("batch preserves abstentions rather than converting diagnostic support into insertion", () => {
  const f = fixture();
  f.local.views[1].records[0].text = "いいえ";
  const r = replayCandidateBatch(f);
  assert.equal(r.summary.newInsertions, 0);
  assert.equal(r.rows[0].blockingStage, "text-evidence");
  assert.deepEqual(r.candidate, r.baseline);
});
test("batch rejects a different baseline and stale diagnostic review", () => {
  const f = fixture();
  f.local.baseline[0].text = "別";
  assert.throws(
    () => replayCandidateBatch(f),
    /CURRENT_BASELINE_NOT_BOUND_TO_SEAMS/,
  );
  const g = fixture();
  g.refreshed.after.text = "別";
  assert.throws(() => replayCandidateBatch(g), /STALE_REFRESH_REVIEW/);
});
test("reference-assisted inputs cannot masquerade as machine-only", () => {
  for (const k of ["referenceUsed", "labelsUsed"]) {
    const f = fixture();
    f.local[k] = true;
    assert.throws(() => replayCandidateBatch(f));
  }
});
test("incompatible duplicate local proposals are rejected at assembly", () => {
  const f = fixture();
  f.local.probes.push({ ...f.local.probes[0], id: "clip-2" });
  f.local.views.push(
    ...f.local.views.map((v) => ({ ...v, targetId: "clip-2" })),
  );
  f.local.vadObservations.push({ ...f.local.vadObservations[0], id: "clip-2" });
  assert.throws(() => replayCandidateBatch(f), /INSERTION_COLLISION/);
});
