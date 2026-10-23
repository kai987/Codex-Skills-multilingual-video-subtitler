import test from "node:test";
import assert from "node:assert/strict";
import { auditAlignmentCoverage } from "../scripts/lib/alignment-coverage.mjs";
import { afterCoverageCheck } from "../scripts/subtitle-tool-word-boundary-guarded.mjs";
test("coverage gate rejects before preparation or model dispatch", async () => {
  let dispatched = 0;
  await assert.rejects(
    afterCoverageCheck(fixture(), () => {
      dispatched++;
    }),
    /ALIGNMENT_INPUT_COVERAGE_BLOCKED/u,
  );
  assert.equal(dispatched, 0);
});
test("clean coverage delegates only once; downstream errors are not retried", async () => {
  const f = fixture();
  f.baseline.shift();
  f.views.forEach((v) => {
    v.records[0].text = "あれ";
  });
  let dispatched = 0;
  await assert.rejects(
    afterCoverageCheck(f, () => {
      dispatched++;
      throw Error("MODEL_FAILED");
    }),
    /MODEL_FAILED/u,
  );
  assert.equal(dispatched, 1);
});
const row = (recordId, sourceStart, sourceEnd, text) => ({
  recordId,
  sourceStart,
  sourceEnd,
  text,
});
function fixture() {
  return {
    baseline: [row("p", 8, 10, "前句"), row("t", 10, 12, "あれ")],
    recordIds: ["t"],
    text: "あれ",
    windows: [
      { id: "n", start: 9.5, end: 12.5 },
      { id: "w", start: 9, end: 13 },
    ],
    views: ["a", "b"].map((backend) => ({
      backend,
      targetId: "x",
      unresolvedCount: 0,
      records: [row(backend, 9, 12, "句あれ")],
    })),
    viewWindow: { id: "x", start: 9, end: 13 },
    offset: 0,
    end: 20,
  };
}
test("both windows expose clipped omitted neighbor instead of silently aligning core text", () => {
  const a = auditAlignmentCoverage(fixture());
  assert.equal(a.status, "BLOCKED_INPUT_COVERAGE");
  assert.deepEqual(
    a.windowAudits.map((w) => w.omitted[0].overlapSeconds),
    [0.5, 1],
  );
  assert.deepEqual(a.windowAudits[0].partialRecordIds, ["p"]);
  assert.equal(a.modelDispatchAllowed, false);
  assert.deepEqual(
    a.windowAudits[0].contextProposal.spans.map((r) => [r.recordId, r.role]),
    [
      ["p", "context"],
      ["t", "target"],
    ],
  );
});
test("proposal closes cue context with margin and preserves target identity", () => {
  const a = auditAlignmentCoverage(fixture()).windowAudits[0].contextProposal;
  assert.equal(a.start, 7.5);
  assert.equal(a.end, 12.5);
  assert.equal(a.status, "MACHINE_CUE_COVERAGE_ONLY");
  assert.equal(a.modelReady, false);
});
test("continuous neighbors do not trigger unbounded expansion", () => {
  const f = fixture();
  f.baseline.unshift(row("p2", 4, 8, "さらに前"), row("p3", 0, 4, "遠い"));
  const a = auditAlignmentCoverage(f).windowAudits[0].contextProposal;
  assert.equal(a.status, "DEFERRED_WINDOW_BUDGET");
  assert(a.seconds > 8);
  assert.equal(a.modelReady, false);
  assert(a.steps.length <= f.baseline.length);
});
test("exact edge touch is not overlap; zero padding is not acoustic proof", () => {
  const f = fixture();
  f.windows = [{ id: "n", start: 10, end: 12 }];
  const a = auditAlignmentCoverage(f);
  assert.deepEqual(a.windowAudits[0].omitted, []);
  assert.equal(a.acousticCoverageVerified, false);
  assert.equal(a.subtitleMutationAuthorized, false);
});
test("saved donor prefix is text evidence only; differing context stays unresolved", () => {
  const f = fixture();
  f.views[1].records[0].text = "あれ？";
  const a = auditAlignmentCoverage(f);
  assert(a.blockers.includes("SAVED_CONTEXT_TEXT_DISAGREEMENT"));
  assert.deepEqual(
    a.donorViews.map((v) => v.normalizedPrefix),
    ["句", ""],
  );
  assert(
    a.donorViews.every(
      (v) => v.uniqueTargetTextMatch && !v.targetTimingSupported,
    ),
  );
});
test("repeated target text cannot identify an occurrence", () => {
  const f = fixture();
  f.views[0].records[0].text = "あれあれ";
  const a = auditAlignmentCoverage(f);
  assert.equal(a.donorViews[0].uniqueTargetTextMatch, false);
  assert.equal(a.donorViews[0].normalizedPrefix, null);
  assert(a.blockers.includes("TARGET_TEXT_ASSOCIATION_UNRESOLVED"));
});
test("failed/out-of-window donors never create agreement", () => {
  const f = fixture();
  f.views[0].records[0].sourceStart = 8;
  f.views[1].unresolvedCount = 1;
  const a = auditAlignmentCoverage(f);
  assert(a.blockers.includes("INSUFFICIENT_VALID_SAVED_VIEWS"));
  assert(a.donorViews.every((v) => !v.valid));
});
test("source offset remains source-global and input stays immutable", () => {
  const f = fixture();
  f.offset = 7.8;
  const before = JSON.parse(JSON.stringify(f));
  const a = auditAlignmentCoverage(f);
  assert.equal(a.windowAudits[0].contextProposal.start, 7.8);
  assert.deepEqual(f, before);
});
test("invalid time, duplicate identity, changed text and wrong donor window fail closed", () => {
  for (const change of [
    (f) => {
      f.baseline[0].sourceEnd = NaN;
    },
    (f) => {
      f.baseline[1].recordId = "p";
    },
    (f) => {
      f.text = "それ";
    },
    (f) => {
      f.views[0].targetId = "wrong";
    },
    (f) => {
      f.views[1].backend = "a";
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => auditAlignmentCoverage(f));
  }
});
test("omitted right neighbor and a truncated target are protected too", () => {
  const f = fixture();
  f.baseline.push(row("after", 12, 15, "後句"));
  const a = auditAlignmentCoverage(f);
  assert(
    a.windowAudits.every((w) => w.omitted.some((r) => r.recordId === "after")),
  );
  f.windows[0].end = 11;
  assert(
    auditAlignmentCoverage(f).windowAudits[0].blockers.includes(
      "TARGET_NOT_FULLY_COVERED",
    ),
  );
});
test("agreement and machine completeness do not authorize a model or writeback", () => {
  const f = fixture();
  f.baseline.shift();
  f.views.forEach((v) => {
    v.records[0].text = "あれ";
  });
  const a = auditAlignmentCoverage(f);
  assert.equal(a.status, "MACHINE_INPUT_COVERAGE_ONLY");
  assert.equal(a.modelDispatchAllowed, false);
  assert.equal(a.subtitleMutationAuthorized, false);
});
