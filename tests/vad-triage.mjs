import test from "node:test";
import assert from "node:assert/strict";
import { buildVadTriage } from "../scripts/subtitle-tool-vad-triage.mjs";

function fixture(fractions = [0, 0.285, 0.5, 1]) {
  return {
    policy: { targetCoverageThreshold: 0.5, subtitleMutationAuthorized: false },
    plan: {
      items: fractions.map((_, i) => ({
        id: `clip-${i + 1}`,
        cohort: "ranked",
        start: 100 + i * 3,
        end: 102 + i * 3,
        localTargetStart: 0.5,
        localTargetEnd: 1.5,
      })),
    },
    observations: fractions.map((f, i) => ({
      id: `clip-${i + 1}`,
      cohort: "ranked",
      targetCoverageFraction: f,
      targetSupported: f >= 0.5,
      anyTargetOverlap: f > 0,
      clipHasDetection: f > 0,
      subtitleMutationAuthorized: false,
    })),
  };
}
test("three states preserve all candidates and stable within-state order", () => {
  const input = fixture(),
    before = globalThis.structuredClone(input),
    r = buildVadTriage(input);
  assert.deepEqual(r.counts, { supported: 2, partial: 1, unsupported: 1 });
  assert.deepEqual(r.reviewOrder, ["clip-3", "clip-4", "clip-2", "clip-1"]);
  assert.equal(r.retainedCount, 4);
  assert.equal(r.droppedCount, 0);
  assert.deepEqual(input, before);
  assert.deepEqual(
    r.rows.map((r) => r.id),
    input.plan.items.map((r) => r.id),
  );
});
test("50 percent stays fixed; tiny positive overlap is partial, not supported", () => {
  const r = buildVadTriage(fixture([0, Number.EPSILON, 0.4999999, 0.5, 1]));
  assert.deepEqual(
    r.rows.map((r) => r.state),
    ["unsupported", "partial", "partial", "supported", "supported"],
  );
});
test("context detection and peak probability cannot promote target state", () => {
  const f = fixture([0]);
  Object.assign(f.observations[0], {
    clipHasDetection: true,
    wholeClipPeakProbability: 0.99999,
  });
  const r = buildVadTriage(f).rows[0];
  assert.equal(r.state, "unsupported");
  assert.equal(r.contextOnlyDetection, true);
  assert.equal(r.retained, true);
});
test("source coordinates preserved; no inferred word, relation or subtitle inclusion", () => {
  const r = buildVadTriage(fixture([1]));
  assert.equal(r.rows[0].targetStart, 100.5);
  assert.equal(r.rows[0].targetEnd, 101.5);
  assert.equal(r.rows[0].speechTruth, "unknown");
  assert.equal(r.rows[0].utteranceRelation, "unknown");
  assert.equal(r.rows[0].subtitleInclusion, "undecided");
  assert.equal(r.subtitleMutations, 0);
  assert.equal(r.newVadRequests, 0);
  assert.equal(r.policy.inferenceAuthorized, false);
  assert.equal(r.policy.automaticFilteringAuthorized, false);
});
test("missing, invalid and failed evidence cannot silently become unsupported", () => {
  for (const value of [undefined, null, NaN, Infinity, -0.1, 1.1, "0"]) {
    const f = fixture([0]);
    f.observations[0].targetCoverageFraction = value;
    assert.throws(() => buildVadTriage(f), /INVALID_COVERAGE/u);
  }
  const f = fixture();
  f.observations.pop();
  assert.throws(() => buildVadTriage(f), /CASE_COUNT/u);
});
test("conflicting booleans or threshold changes fail closed", () => {
  for (const override of [
    { targetSupported: true },
    { anyTargetOverlap: true },
    { clipHasDetection: undefined },
    { subtitleMutationAuthorized: true },
  ]) {
    const f = fixture([0]);
    Object.assign(f.observations[0], override);
    assert.throws(() => buildVadTriage(f));
  }
  const f = fixture();
  f.policy.targetCoverageThreshold = 0.25;
  assert.throws(() => buildVadTriage(f), /THRESHOLD_CHANGED/u);
});
test("duplicate or mismatched identities rejected", () => {
  for (const modify of [
    (f) => {
      f.observations[1].id = f.observations[0].id;
    },
    (f) => {
      f.plan.items[1].id = f.plan.items[0].id;
    },
    (f) => {
      f.observations[0].id = "clip-999";
    },
    (f) => {
      f.observations[0].cohort = "reserve";
    },
  ]) {
    const f = fixture();
    modify(f);
    assert.throws(() => buildVadTriage(f));
  }
});
test("invalid target ranges rejected rather than repaired or clamped", () => {
  for (const override of [
    { start: -1 },
    { start: NaN },
    { localTargetStart: -0.1 },
    { localTargetEnd: 0.5 },
    { localTargetEnd: 4 },
  ]) {
    const f = fixture([1]);
    Object.assign(f.plan.items[0], override);
    assert.throws(() => buildVadTriage(f));
  }
});
test("reference labels do not determine triage or change regression provenance", () => {
  const f = fixture([0.285]);
  const before = buildVadTriage(f);
  f.labels = [{ id: "clip-1", sound: "speech" }];
  f.observations[0].labelSound = "speech";
  assert.deepEqual(buildVadTriage(f), before);
  assert.equal(before.rows[0].state, "partial");
  assert.equal(
    before.validationScope,
    "existing-clips-regression-not-independent-holdout",
  );
});
