import test from "node:test";
import assert from "node:assert/strict";
import { auditContent } from "../scripts/lib/machine-content-audit.mjs";
import { buildMachineRiskRecoveryPlan } from "../scripts/lib/machine-risk-recovery-plan.mjs";

const cue = (id, start, end, text = "確認する文です") => ({
  id,
  start,
  end,
  text,
});
function input(records, extra = {}) {
  const sourceEnd = extra.sourceEnd ?? 1000;
  return {
    records,
    audit: auditContent(records, { language: "ja", sourceEnd }),
    sourceEnd,
    binding: { sourceHash: "a".repeat(64), rawHash: "b".repeat(64) },
    ...extra,
  };
}
const plan = (records, extra = {}) =>
  buildMachineRiskRecoveryPlan(input(records, extra));

test("empty plan remains unapproved and has zero work", () => {
  const result = plan([]);
  assert.equal(result.status, "needs-review");
  assert.equal(result.machineOnlyReleaseAuthorized, false);
  assert.equal(result.newASRRequests, 0);
  assert.equal(result.automaticDispatch, false);
  assert.equal(result.retainOriginal, true);
  assert.equal(result.summary.plannedWindowCount, 0);
  assert.equal(result.summary.riskyRecordCount, 0);
});

test("long short-phrase loop is completely inventoried with bounded deferred coverage", () => {
  const records = Array.from({ length: 12 }, (_, i) =>
    cue(`r${i}`, i * 25, (i + 1) * 25, "また明日"),
  );
  const result = plan(records);
  assert.equal(result.regions.length, 1);
  const r = result.regions[0];
  assert.equal(r.priority, 0);
  assert.equal(r.recordIds.length, 12);
  assert.ok(r.riskCodes.includes("LONG_SPAN_WEAK_BOUNDARY"));
  assert.ok(r.riskCodes.includes("NEIGHBORING_EXACT_REPETITION"));
  assert.equal(result.summary.plannedWindowCount, 10);
  assert.equal(result.summary.selectedRequestCount, 8);
  assert.equal(result.summary.selectedAudioSeconds, 240);
  assert.equal(result.summary.deferredWindowCount, 2);
  assert.equal(r.selectedCoverageSeconds, 240);
  assert.equal(r.uncoveredSeconds, 60);
  assert.equal(r.selectionCoverage, "partial");
  assert.equal(r.status, "partial");
  assert.ok(result.windows.every((w) => w.end - w.start <= 30));
  assert.deepEqual(
    records.map((r) => r.text),
    Array(12).fill("また明日"),
  );
});

test("overlapping issues and cues never double-charge source audio", () => {
  const result = plan([cue("a", 0, 25), cue("b", 20, 45), cue("c", 30, 55)]);
  assert.equal(result.regions.length, 1);
  assert.equal(result.summary.totalRiskSeconds, 55);
  assert.equal(result.summary.selectedAudioSeconds, 55);
  assert.equal(result.summary.selectedCoverageSeconds, 55);
  assert.equal(result.summary.selectedRequestCount, 2);
});

test("disjoint source intervals without a shared issue are not bridged or charged as one giant gap", () => {
  const records = [cue("a", 0, 15), cue("b", 100, 115), cue("c", 200, 215)];
  const result = plan(records);
  assert.equal(result.regions.length, 3);
  assert.equal(result.summary.totalRiskSeconds, 45);
  assert.deepEqual(
    result.regions.map((r) => [r.start, r.end]),
    [
      [0, 15],
      [100, 115],
      [200, 215],
    ],
  );
});

test("one neighbor-loop warning connects small inter-cue gaps into its request envelope", () => {
  const result = plan([
    cue("a", 0, 10, "また明日"),
    cue("b", 10.02, 20, "また明日"),
    cue("c", 20.02, 29.9, "また明日"),
  ]);
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].start, 0);
  assert.equal(result.regions[0].end, 29.9);
  assert.equal(result.windows.length, 1);
  assert.equal(result.summary.selectedAudioSeconds, 29.9);
  assert.equal(result.timingMutations, 0);
  assert.match(result.policy.regionMerge, /same-issue-envelope/);
});

test("neighbor loops outrank long-span-only regions without deleting real repeated responses", () => {
  const records = [
    cue("long", 0, 20, "長い区間の内容"),
    ...[0, 1, 2].map((i) => cue(`repeat${i}`, 50 + i, 51 + i, "はい")),
  ];
  const original = globalThis.structuredClone(records);
  const result = plan(records, { budget: { maxRequests: 1 } });
  assert.equal(result.regions[0].start, 50);
  assert.equal(result.regions[0].status, "selected");
  assert.equal(result.regions[1].status, "deferred-budget");
  assert.deepEqual(records, original);
  assert.equal(result.textMutations, 0);
  assert.ok(!("repairedRecords" in result));
});

test("cross-cue phrase code is high priority", () => {
  const data = input([cue("a", 0, 10)]);
  data.audit.issues[0].code = "CROSS_CUE_PHRASE_REPETITION";
  assert.equal(buildMachineRiskRecoveryPlan(data).regions[0].priority, 0);
});

test("severe long loop outranks three ordinary short responses without deleting either", () => {
  const records = [
    ...[0, 1, 2].map((i) => cue(`answer${i}`, i, i + 1, "うん")),
    ...[0, 1, 2, 3, 4, 5].map((i) =>
      cue(`loop${i}`, 100 + i, 101 + i, "また明日"),
    ),
  ];
  const result = plan(records, { budget: { maxRequests: 1 } });
  assert.equal(result.regions[0].start, 100);
  assert.equal(result.regions[0].priority, 0);
  assert.equal(result.regions[0].status, "selected");
  assert.equal(result.regions[1].start, 0);
  assert.equal(result.regions[1].priority, 3);
  assert.equal(result.regions[1].status, "deferred-budget");
  assert.equal(result.summary.riskyRecordCount, records.length);
  assert.equal(result.textMutations, 0);
});

test("full existing evidence sorts after missing evidence within the same risk class", () => {
  const result = plan([cue("a", 0, 20), cue("b", 100, 120)], {
    budget: { maxRequests: 1 },
    evidenceWindows: [
      { id: "old", start: 0, end: 20, candidateStatus: "unverified" },
    ],
  });
  assert.equal(result.regions[0].start, 100);
  assert.equal(result.regions[0].status, "selected");
  assert.equal(result.regions[1].start, 0);
  assert.equal(result.regions[1].evidenceCoverage, "full");
  assert.equal(result.regions[1].status, "deferred-budget");
  assert.equal(result.regions[1].repairStatus, "NOT_REPAIRED_BY_PLAN");
  assert.equal(result.summary.riskyRecordCount, 2);
});

test("balanced crops avoid a tiny remainder request and retain exact source coverage", () => {
  const result = plan([cue("long", 10, 190.14)]);
  assert.equal(result.windows.length, 7);
  assert.ok(result.windows.every((w) => w.seconds > 25 && w.seconds <= 30));
  assert.equal(result.windows[0].start, 10);
  assert.equal(result.windows.at(-1).end, 190.14);
  result.windows.forEach((w, i) => {
    if (i) assert.equal(w.start, result.windows[i - 1].end);
  });
  assert.equal(result.summary.selectedAudioSeconds, 180.14);
  assert.equal(result.summary.uncoveredSeconds, 0);
  assert.equal(result.regions[0].selectionCoverage, "full");
});

test("invalid records remain point hints or unlocatable; no windows are invented", () => {
  const records = [
    cue("zero", 4, 4),
    cue("reverse", 8, 7),
    cue("too-late", 1100, 1101),
    cue("unknown", NaN, 10),
    cue("negative", -2, 3),
    cue("right-outside", 900, 1100),
  ];
  const result = plan(records);
  assert.equal(result.summary.pointRegionCount, 3);
  assert.equal(result.summary.unlocatableRecordCount, 3);
  assert.equal(result.windows.length, 0);
  assert.ok(
    result.regions.every(
      (r) =>
        r.start === r.end &&
        r.status === "locatable-point" &&
        r.selectionCoverage === "not-applicable",
    ),
  );
  assert.equal(result.summary.totalRiskSeconds, 0);
});

test("point hints can associate with an existing real interval without changing it", () => {
  const result = plan([cue("span", 10, 25), cue("point", 15, 15)]);
  assert.equal(result.regions.length, 1);
  assert.deepEqual([result.regions[0].start, result.regions[0].end], [10, 25]);
  assert.deepEqual(result.regions[0].recordIds, ["span", "point"]);
  assert.equal(result.summary.selectedAudioSeconds, 15);
  assert.equal(result.timingMutations, 0);
});

test("evidence overlap is union coverage, not repair or automatic budget subtraction", () => {
  const result = plan([cue("r", 0, 20)], {
    evidenceWindows: [
      { id: "a", start: 0, end: 8, candidateStatus: "reviewed" },
      { id: "b", start: 4, end: 12, candidateStatus: "still-risky" },
      { id: "c", start: 30, end: 40, candidateStatus: "unverified" },
    ],
  });
  const r = result.regions[0];
  assert.equal(r.evidenceCoverageSeconds, 12);
  assert.equal(r.evidenceUncoveredSeconds, 8);
  assert.equal(r.evidenceCoverage, "partial");
  assert.deepEqual(r.evidenceIds, ["a", "b"]);
  assert.equal(result.summary.selectedAudioSeconds, 20);
  assert.equal(r.repairStatus, "NOT_REPAIRED_BY_PLAN");
});

test("fully covered evidence still needs review and retains execution prohibition", () => {
  const result = plan([cue("r", 0, 20)], {
    evidenceWindows: [
      { id: "a", start: 0, end: 10, candidateStatus: "reviewed" },
      { id: "b", start: 10, end: 20, candidateStatus: "reviewed" },
    ],
  });
  assert.equal(result.regions[0].evidenceCoverage, "full");
  assert.equal(result.summary.evidenceCoverageSeconds, 20);
  assert.equal(result.newASRRequests, 0);
  assert.equal(result.automaticDispatch, false);
  assert.equal(result.status, "needs-review");
});

test("budget respects request and duration constraints with explicit deferral", () => {
  const result = plan([cue("a", 0, 35), cue("b", 40, 50)], {
    budget: { maxRequests: 3, maxAudioSeconds: 27.5, maxWindowSeconds: 30 },
  });
  assert.equal(result.summary.selectedAudioSeconds, 27.5);
  assert.equal(result.summary.selectedRequestCount, 2);
  assert.equal(result.windows[1].status, "deferred-budget");
  assert.equal(result.windows[1].reason, "AUDIO_SECONDS_BUDGET");
  assert.equal(result.regions[0].selectionCoverage, "partial");
  assert.equal(result.regions[0].uncoveredSeconds, 17.5);
  const none = plan([cue("a", 0, 15)], { budget: { maxRequests: 0 } });
  assert.equal(none.summary.selectedRequestCount, 0);
  assert.equal(none.regions[0].status, "deferred-budget");
});

test("decimal request costs at the exact budget limit are not overcharged", () => {
  const records = [
    cue("a", 0, 0.1, "長い反復文です"),
    cue("b", 0.1, 0.2, "長い反復文です"),
    cue("c", 0.2, 0.3, "長い反復文です"),
  ];
  const result = plan(records, {
    budget: { maxWindowSeconds: 0.1, maxAudioSeconds: 0.3 },
  });
  assert.equal(result.summary.selectedAudioSeconds, 0.3);
  assert.equal(result.summary.selectedRequestCount, 3);
  assert.equal(result.summary.uncoveredSeconds, 0);
});

test("decimal advances preserve an exact 0.1 plus 0.2 endpoint without extra windows", () => {
  const result = plan([cue("a", 0.1, 0.3, "長い境界テストの文です")], {
    budget: { maxWindowSeconds: 0.2, maxAudioSeconds: 0.2 },
  });
  assert.equal(result.windows.length, 1);
  assert.deepEqual(
    [result.windows[0].start, result.windows[0].end],
    [0.1, 0.3],
  );
  assert.equal(result.summary.selectedAudioSeconds, 0.2);
  assert.equal(result.regions[0].selectionCoverage, "full");
});

test("deterministic hashes bind records, audit, binding, budget and evidence without mutation", () => {
  const original = input([cue("r", 2, 30)]);
  const before = globalThis.structuredClone(original);
  const a = buildMachineRiskRecoveryPlan(original),
    b = buildMachineRiskRecoveryPlan(original);
  assert.deepEqual(a, b);
  assert.deepEqual(original, before);
  const altered = globalThis.structuredClone(original);
  altered.binding.rawHash = "c".repeat(64);
  assert.notEqual(a.planHash, buildMachineRiskRecoveryPlan(altered).planHash);
  assert.notEqual(
    a.inputHash,
    buildMachineRiskRecoveryPlan({ ...original, budget: { maxRequests: 0 } })
      .inputHash,
  );
  const changedText = globalThis.structuredClone(original);
  changedText.records[0].text += "変更";
  assert.notEqual(
    a.hashes.records,
    buildMachineRiskRecoveryPlan(changedText).hashes.records,
  );
  assert.match(a.planHash, /^[0-9a-f]{64}$/);
});

test("strict malformed input, evidence, audit associations and budgets are rejected", () => {
  const good = input([cue("r", 0, 20)]);
  const variants = [
    { ...good, sourceEnd: 0 },
    { ...good, budget: null },
    { ...good, evidenceWindows: null },
    { ...good, unexpected: true },
    { ...good, binding: { fn: () => true } },
    ...[
      { maxRequests: -1 },
      { maxRequests: 1.5 },
      { maxAudioSeconds: NaN },
      { maxWindowSeconds: 0 },
      { maxWindowSeconds: 31 },
      { typo: 1 },
    ].map((budget) => ({ ...good, budget })),
    {
      ...good,
      evidenceWindows: [
        { id: "a", start: 0, end: 0, candidateStatus: "reviewed" },
      ],
    },
    {
      ...good,
      evidenceWindows: [
        { id: "a", start: 0, end: 20, candidateStatus: "accepted" },
      ],
    },
    {
      ...good,
      evidenceWindows: [
        { id: "a", start: 0, end: 1001, candidateStatus: "reviewed" },
      ],
    },
  ];
  const stale = globalThis.structuredClone(good);
  stale.audit.issues[0].cues[0].start = 1;
  variants.push(stale);
  const badIndex = globalThis.structuredClone(good);
  badIndex.audit.issues[0].cueIndexes[0] = 3;
  variants.push(badIndex);
  const duplicate = input([cue("r", 0, 20), cue("r", 20, 40)]);
  variants.push(duplicate);
  for (const value of variants)
    assert.throws(
      () => buildMachineRiskRecoveryPlan(value),
      /MACHINE_RISK_PLAN_/,
    );
});

test("plans cannot allocate unbounded memory for tiny windows", () => {
  assert.throws(
    () => plan([cue("a", 0, 100)], { budget: { maxWindowSeconds: 0.0001 } }),
    /TOO_MANY_WINDOWS/,
  );
});
