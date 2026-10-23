/** Explicit human-review import. No inference, timing estimation or global dedup. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reviewPayload } from "./residual-review.mjs";
import { tuple } from "./reference-assisted-patches.mjs";
export const targetHash = (r) =>
  createHash("sha256")
    .update(JSON.stringify(tuple(r)))
    .digest("hex");

export function validateSubmittedReview(manifest, labels, records, submission) {
  assert.equal(labels.version, "residual-listening-labels-v1");
  assert.equal(labels.packageId, manifest.packageId, "STALE_REVIEW_PACKAGE");
  assert.equal(
    labels.baselineHash,
    manifest.baselineHash,
    "STALE_BASELINE_HASH",
  );
  assert.equal(submission.authority, "explicit-user-confirmed-submission");
  assert(
    submission.quote?.trim() && submission.reviewer?.trim(),
    "MISSING_SUBMISSION_CONFIRMATION",
  );
  assert(
    !labels.reviewer || labels.reviewer === submission.reviewer,
    "REVIEWER_CONFLICT",
  );
  assert.equal(labels.items.length, manifest.items.length, "INCOMPLETE_REVIEW");
  assert.equal(
    new Set(labels.items.map((r) => r.id)).size,
    labels.items.length,
    "DUPLICATE_REVIEW_ITEM",
  );
  const values = {};
  for (const r of labels.items) {
    const m = manifest.items.find((x) => x.id === r.id);
    assert(m, "FOREIGN_REVIEW_ITEM");
    for (const key of ["originalCue", "currentCue", "targetHash"])
      assert.equal(r[key], m[key], "STALE_REVIEW_TARGET");
    assert.equal(
      targetHash(records[r.currentCue - 1]),
      r.targetHash,
      "CHANGED_REVIEW_TARGET",
    );
    assert.equal(r.heard, true, "UNHEARD_TARGET");
    values[r.id] = r;
  }
  const effective = reviewPayload(manifest, submission.reviewer, values);
  assert.equal(
    effective.status,
    "submitted-for-validation",
    "INCOMPLETE_REVIEW",
  );
  assert(
    effective.items.every((r) => r.status === "reviewed"),
    "UNRESOLVED_REVIEW",
  );
  return effective;
}

export function applyAdjudicatedReview(
  records,
  effective,
  specs,
  requiredConfirmations,
) {
  assert.equal(specs.length, effective.items.length, "INCOMPLETE_ADJUDICATION");
  assert.equal(
    new Set(specs.map((s) => s.id)).size,
    specs.length,
    "DUPLICATE_ADJUDICATION",
  );
  const consumed = new Set(),
    additions = [],
    ledger = [];
  for (const s of specs) {
    const label = effective.items.find((r) => r.id === s.id);
    assert(label?.status === "reviewed", "UNREVIEWED_TARGET");
    assert.equal(label.decision, s.expectedDecision, "CHANGED_DECISION");
    assert.equal(label.text, s.expectedText, "CHANGED_REVIEW_TEXT");
    assert(
      ["remove-reviewed-target", "replace-target-text"].includes(s.action),
      "UNSUPPORTED_ACTION",
    );
    const index = label.currentCue - 1,
      before = records[index];
    assert.equal(targetHash(before), label.targetHash, "CHANGED_REVIEW_TARGET");
    assert(!consumed.has(index), "REUSED_TARGET");
    consumed.add(index);
    const support = (s.preserveNeighbors ?? []).map(
      ({ index: n, expected }) => {
        assert.deepEqual(
          tuple(records[n]),
          expected,
          "CHANGED_CONTEXT_NEIGHBOR",
        );
        return { index: n, expected };
      },
    );
    let after = null;
    if (s.action === "replace-target-text") {
      assert(
        s.text?.trim() && !/[\r\n{}<>\\]/u.test(s.text),
        "UNSAFE_REPLACEMENT_TEXT",
      );
      assert(
        label.text.split(/\r?\n/u).includes(s.text),
        "TEXT_NOT_EXPLICITLY_REVIEWED",
      );
      after = { ...before, text: s.text };
      delete after.originalIndex;
      additions.push(after);
    }
    assert(s.reason?.trim(), "MISSING_REASON");
    ledger.push({
      id: s.id,
      action: s.action,
      before: tuple(before),
      after: after ? tuple(after) : null,
      userDecision: label.decision,
      userContextText: label.text,
      reason: s.reason,
      preserveNeighbors: support,
      timingAuthority:
        "existing-baseline-timing-retained; not newly human-verified",
      reviewer: effective.reviewer,
    });
  }
  for (const row of ledger)
    for (const neighbor of row.preserveNeighbors)
      assert(
        !consumed.has(neighbor.index),
        "CONTEXT_NEIGHBOR_WOULD_BE_CHANGED",
      );
  const retained = records
    .map((r, i) => ({ ...r, originalIndex: i }))
    .filter((r) => !consumed.has(r.originalIndex));
  const result = [...retained, ...additions].sort((a, b) => a.start - b.start);
  assert(result.length > 0, "EMPTY_OUTPUT");
  for (const c of requiredConfirmations)
    assert.equal(
      result.filter((r) => targetHash(r) === targetHash(c)).length,
      1,
      "LOST_HUMAN_CONFIRMATION",
    );
  return { result, retained, additions, ledger, consumed: [...consumed] };
}
