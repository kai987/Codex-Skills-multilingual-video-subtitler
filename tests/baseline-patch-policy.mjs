import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baselinePatchHash,
  projectBaselinePatches,
  proposeBaselinePatch,
  validateBaselinePatchProposal,
} from "../scripts/lib/baseline-patch-policy.mjs";

const sourceHash = "a".repeat(64),
  donorEvidenceHash = "b".repeat(64);
const repeated = "機械出力が同じ文章を何度も繰り返します";
const cue = (recordId, sourceStart, sourceEnd, text = repeated) => ({
  recordId,
  sourceStart,
  sourceEnd,
  text,
  parseStatus: "PARSED",
  issues: sourceStart === sourceEnd ? ["ZERO_DURATION"] : [],
  rawBlock: `${recordId}\n${text}`,
  extra: { preserve: true },
});
function fixture(offset = 0, prefix = "") {
  const id = (value) => `${prefix}${value}`;
  const baseline = [
    cue(id("protected-left"), 8 + offset, 10.5 + offset, "正常な前の文章"),
    cue(id("edge"), 10.5 + offset, 11.5 + offset, `冒頭${repeated}`),
    cue(id("zero"), 11.5 + offset, 11.5 + offset),
    ...Array.from({ length: 6 }, (_, index) =>
      cue(
        id(`loop-${index}`),
        11.5 + index / 10 + offset,
        11.6 + index / 10 + offset,
      ),
    ),
    cue(id("loop-tail"), 12.1 + offset, 20 + offset),
    cue(id("protected-right"), 20 + offset, 24 + offset, "正常な次の文章"),
    cue(
      id("unresolved-zero"),
      25 + offset,
      25 + offset,
      "失ってはいけない未解決の文章",
    ),
  ];
  const donorRecords = [
    cue(id("donor-head"), 10 + offset, 10.75 + offset, "切られた語尾"),
    cue(id("donor-a"), 10.75 + offset, 14 + offset, "新しい候補の文章"),
    cue(id("donor-b"), 15 + offset, 20 + offset, "候補の最後の文章"),
  ];
  return {
    baseline,
    donorRecords,
    window: { start: 10 + offset, end: 20 + offset },
    sourceHash,
    donorSourceHash: sourceHash,
    donorEvidenceHash,
  };
}
function proposed(input = fixture()) {
  const result = proposeBaselinePatch(input);
  assert.equal(result.status, "PROPOSED", JSON.stringify(result));
  return result.proposal;
}
function project(
  input,
  proposals,
  selection = proposals.map((p) => p.patchId),
  options = {},
) {
  return projectBaselinePatches(input.baseline, proposals, selection, {
    sourceHash,
    ...options,
  });
}
function rebind(proposal) {
  const bound = { ...proposal };
  delete bound.patchId;
  return { ...bound, patchId: `baseline-patch-${baselinePatchHash(bound)}` };
}

test("whole-cue proposal excludes a clipped donor head and retains the crossing original", () => {
  const input = fixture(),
    proposal = proposed(input);
  assert.ok(!proposal.targetRecordIds.includes("protected-left"));
  assert.deepEqual(proposal.replacementRecords, input.donorRecords.slice(1));
  assert.ok(
    proposal.excludedDonors[0].reasons.includes(
      "OVERLAPS_PROTECTED_BASELINE_CUE",
    ),
  );
  assert.ok(
    proposal.excludedDonors[0].reasons.includes(
      "LEFT_CROP_BOUNDARY_POSSIBLY_TRUNCATED",
    ),
  );
  assert.equal(validateBaselinePatchProposal(proposal).valid, true);
});

test("proposal records boundary and crop uncertainty without acoustic or timing claims", () => {
  const proposal = proposed();
  assert.equal(proposal.boundaryDifferences.startSeconds, 0.25);
  assert.ok(
    proposal.uncertainties.includes(
      "ENVELOPE_BOUNDARY_DIFFERENCE_NOT_REALIGNED",
    ),
  );
  assert.ok(
    proposal.uncertainties.includes("DONOR_TAIL_TOUCHES_CROP_BOUNDARY"),
  );
  assert.ok(
    proposal.uncertainties.includes(
      "DONOR_INTERNAL_GAPS_NOT_ACOUSTICALLY_VERIFIED",
    ),
  );
  assert.equal(proposal.automaticApplication, false);
  assert.equal(proposal.acousticTimingVerified, false);
  assert.equal(proposal.timingRepairClaimed, false);
  assert.equal(proposal.referenceUsed, false);
});

test("zero-duration substitution is accounted in before records, never called timing repair", () => {
  const input = fixture(),
    proposal = proposed(input),
    result = project(input, [proposal]);
  assert.deepEqual(proposal.invalidBeforeRecordIds, ["zero"]);
  assert.ok(
    proposal.uncertainties.includes(
      "INVALID_BASELINE_RECORD_SUBSTITUTED_NOT_TIMING_REPAIRED",
    ),
  );
  assert.ok(
    result.changes[0].beforeRecords.some(
      (record) => record.recordId === "zero",
    ),
  );
  assert.equal(result.changes[0].timingRepairClaimed, false);
  assert.deepEqual(result.records.at(-1), input.baseline.at(-1));
});

test("empty selection is an identity copy retaining every field, text and invalid time", () => {
  const input = fixture();
  input.baseline.push(
    cue("nonfinite", NaN, Infinity, "不明な時間も原文を保存"),
  );
  const result = projectBaselinePatches(input.baseline, [], []);
  assert.equal(result.status, "IDENTITY");
  assert.deepEqual(result.records, input.baseline);
  assert.notEqual(result.records, input.baseline);
  assert.equal(result.protectedCount, input.baseline.length);
  assert.equal(result.protectedHash, baselinePatchHash(input.baseline));
  result.records[0].extra.preserve = false;
  assert.equal(input.baseline[0].extra.preserve, true);
});

test("preview preserves protected hashes and baseline ordering without mutating input", () => {
  const input = fixture(),
    before = globalThis.structuredClone(input),
    proposal = proposed(input);
  const result = project(input, [proposal]);
  assert.equal(result.status, "PROJECTED");
  assert.deepEqual(input, before);
  assert.deepEqual(
    result.records.map((r) => r.recordId),
    [
      "protected-left",
      "donor-a",
      "donor-b",
      "protected-right",
      "unresolved-zero",
    ],
  );
  const protectedRecords = input.baseline.filter(
    (r) => !proposal.targetRecordIds.includes(r.recordId),
  );
  assert.equal(result.protectedHash, baselinePatchHash(protectedRecords));
  assert.equal(result.protectedCount, 3);
  result.records[1].extra.preserve = false;
  assert.equal(proposal.replacementRecords[0].extra.preserve, true);
});

test("a normal window is unchanged and receives no patch", () => {
  const input = fixture();
  input.baseline = [cue("normal", 11, 19, "普段の正常な会話です")];
  assert.deepEqual(proposeBaselinePatch(input).reasons, [
    "NO_EXTREME_MACHINE_REPETITION",
  ]);
});

test("many genuine repeated short replies are never enough for a patch", () => {
  const input = fixture();
  input.baseline = Array.from({ length: 12 }, (_, i) =>
    cue(`genuine-${i}`, 11 + i / 10, 11.1 + i / 10, "はい"),
  );
  assert.equal(proposeBaselinePatch(input).status, "ABSTAIN");
});

test("long repeated dialogue with normal durations is not an extreme loop", () => {
  const input = fixture();
  input.baseline = Array.from({ length: 8 }, (_, i) =>
    cue(`genuine-${i}`, 11 + i, 12 + i),
  );
  assert.equal(proposeBaselinePatch(input).status, "ABSTAIN");
});

test("a normal sentence added to a pathological window is protected", () => {
  const input = fixture();
  input.baseline[1].text = "ここは無関係の正常な文章";
  assert.deepEqual(proposeBaselinePatch(input).reasons, [
    "TARGET_INCLUDES_NONANOMALOUS_RECORD",
  ]);
});

test("an extreme intra-cue loop can only produce a review suggestion", () => {
  const input = fixture();
  input.baseline = [cue("single-loop", 11, 20, "繰り返す文章".repeat(16))];
  input.donorRecords = [cue("single-donor", 11, 20, "別の候補文章")];
  assert.equal(proposed(input).suggestionOnly, true);
});

test("source and evidence hashes are mandatory and source mismatch abstains", () => {
  const input = fixture();
  assert.equal(
    proposeBaselinePatch({ ...input, donorSourceHash: "c".repeat(64) }).status,
    "ABSTAIN",
  );
  assert.equal(
    proposeBaselinePatch({ ...input, donorEvidenceHash: "" }).status,
    "ABSTAIN",
  );
  assert.equal(
    proposeBaselinePatch({
      ...input,
      baseline: { records: input.baseline, sourceHash: "c".repeat(64) },
    }).status,
    "ABSTAIN",
  );
});

test("invalid zero-duration donor is never silently dropped", () => {
  const input = fixture();
  input.donorRecords[1].sourceEnd = input.donorRecords[1].sourceStart;
  assert.deepEqual(proposeBaselinePatch(input).reasons, [
    "INVALID_OR_UNORDERED_DONOR_RECORDS",
  ]);
});

test("donor cues must have safe nonempty text and a valid parse", () => {
  for (const text of ["", "  ", "危険\u0000文字"]) {
    const input = fixture();
    input.donorRecords[1].text = text;
    assert.equal(proposeBaselinePatch(input).status, "ABSTAIN");
  }
  const input = fixture();
  input.donorRecords[1].parseStatus = "FAILED";
  assert.equal(proposeBaselinePatch(input).status, "ABSTAIN");
});

test("unordered or overlapping donor cues are rejected without sorting", () => {
  const input = fixture();
  input.donorRecords.reverse();
  assert.equal(proposeBaselinePatch(input).status, "ABSTAIN");
  const overlapping = fixture();
  overlapping.donorRecords[2].sourceStart = 13;
  assert.equal(proposeBaselinePatch(overlapping).status, "ABSTAIN");
});

test("large envelope gaps abstain instead of inventing timings", () => {
  const input = fixture();
  input.donorRecords[1].sourceStart = 11;
  assert.deepEqual(proposeBaselinePatch(input).reasons, [
    "DONOR_ENVELOPE_COVERAGE_INSUFFICIENT",
  ]);
});

test("protected neighboring overlap excludes the donor and prevents unsafe projection", () => {
  const input = fixture();
  input.baseline.at(-2).sourceStart = 19;
  const result = proposeBaselinePatch(input);
  assert.equal(result.status, "ABSTAIN");
  assert.ok(
    result.excludedDonors.some(
      (record) =>
        record.recordId === "donor-b" &&
        record.reasons.includes("OVERLAPS_PROTECTED_BASELINE_CUE"),
    ),
  );
});

test("changed protected metadata invalidates the bound full baseline", () => {
  const input = fixture(),
    proposal = proposed(input);
  input.baseline[0].extra.preserve = false;
  const result = project(input, [proposal]);
  assert.deepEqual(result.reasons, ["STALE_BASELINE_HASH"]);
  assert.deepEqual(result.records, input.baseline);
  assert.deepEqual(result.changes, []);
});

test("tampered target text, replacement timing, flags and foreign IDs are rejected", () => {
  const input = fixture(),
    original = proposed(input);
  for (const edit of [
    (p) => {
      p.beforeRecords[0].text = "改変";
    },
    (p) => {
      p.replacementRecords[0].sourceStart = 9;
    },
    (p) => {
      p.automaticApplication = true;
    },
    (p) => {
      p.targetRecordIds[0] = "foreign";
    },
    (p) => {
      p.targetRecordIds[1] = p.targetRecordIds[0];
    },
  ]) {
    const proposal = globalThis.structuredClone(original);
    edit(proposal);
    assert.equal(project(input, [proposal]).status, "REJECTED");
  }
});

test("rehashed foreign targets and policy changes still fail full policy replay", () => {
  const input = fixture(),
    original = proposed(input);
  const foreign = rebind({ ...original, targetRecordIds: ["foreign"] });
  assert.equal(project(input, [foreign]).status, "REJECTED");
  const policyChange = rebind({ ...original, uncertainties: [] });
  assert.deepEqual(project(input, [policyChange]).reasons, [
    "PROPOSAL_POLICY_REPLAY_MISMATCH",
  ]);
});

test("beforeHash is checked against live whole raw records independently", () => {
  const input = fixture(),
    original = proposed(input),
    changed = globalThis.structuredClone(original);
  changed.beforeRecords[0].extra.preserve = false;
  changed.beforeHash = baselinePatchHash(changed.beforeRecords);
  assert.deepEqual(project(input, [rebind(changed)]).reasons, [
    "STALE_BEFORE_HASH",
  ]);
});

test("competing proposals fail atomically, preserving original zero-duration records", () => {
  const input = fixture(),
    first = proposed(input);
  const second = proposed({ ...input, donorEvidenceHash: "c".repeat(64) });
  const result = project(input, [first, second]);
  assert.deepEqual(result.reasons, ["PATCH_TARGET_CONFLICT"]);
  assert.deepEqual(result.records, input.baseline);
  assert.deepEqual(result.changes, []);
});

test("missing, duplicate, ambiguous and unauthorized selections reject atomically", () => {
  const input = fixture(),
    proposal = proposed(input);
  for (const [proposals, selected] of [
    [[proposal], ["missing"]],
    [[proposal], [proposal.patchId, proposal.patchId]],
    [[proposal, proposal], [proposal.patchId]],
  ])
    assert.equal(project(input, proposals, selected).status, "REJECTED");
  assert.equal(
    project(input, [proposal], undefined, { mode: "apply" }).status,
    "REJECTED",
  );
  assert.equal(
    projectBaselinePatches(input.baseline, [proposal], [proposal.patchId])
      .status,
    "REJECTED",
  );
});

test("projection validates source identity, including wrapper/source option disagreement", () => {
  const input = fixture(),
    proposal = proposed(input);
  assert.equal(
    project(input, [proposal], undefined, { sourceHash: "c".repeat(64) })
      .status,
    "REJECTED",
  );
  assert.equal(
    projectBaselinePatches(
      { records: input.baseline, sourceHash: "c".repeat(64) },
      [proposal],
      [proposal.patchId],
      { sourceHash },
    ).status,
    "REJECTED",
  );
  assert.equal(
    projectBaselinePatches(
      { records: input.baseline, sourceHash },
      [proposal],
      [proposal.patchId],
    ).status,
    "PROJECTED",
  );
});

test("disjoint patches project in original order even if selection is reversed", () => {
  const first = fixture(),
    second = fixture(30, "second-");
  const baseline = [...first.baseline, ...second.baseline];
  const a = proposed({ ...first, baseline }),
    b = proposed({ ...second, baseline });
  const result = project({ baseline }, [a, b], [b.patchId, a.patchId]);
  assert.equal(result.status, "PROJECTED");
  assert.deepEqual(
    result.changes.map((change) => change.patchId),
    [a.patchId, b.patchId],
  );
  assert.equal(result.records[0].recordId, "protected-left");
  assert.equal(result.records[5].recordId, "second-protected-left");
});

test("complete-record hashing distinguishes null/nonfinite and binds extra metadata", () => {
  assert.notEqual(
    baselinePatchHash({ time: null }),
    baselinePatchHash({ time: NaN }),
  );
  assert.notEqual(
    baselinePatchHash({ time: Infinity }),
    baselinePatchHash({ time: -Infinity }),
  );
  assert.equal(
    baselinePatchHash({ a: 1, b: 2 }),
    baselinePatchHash({ b: 2, a: 1 }),
  );
  const input = fixture(),
    proposal = proposed(input);
  proposal.replacementRecords[0].extra.newField = "bound";
  assert.equal(validateBaselinePatchProposal(proposal).valid, false);
});

test("legacy invalid records outside the target survive a valid preview unchanged", () => {
  const input = fixture();
  input.baseline.push(
    cue("reversed", 40, 39, "逆転しても消さない"),
    cue("unknown-time", null, null, "時刻不明の文章"),
  );
  const result = project(input, [proposed(input)]);
  assert.equal(result.status, "PROJECTED");
  assert.deepEqual(result.records.slice(-2), input.baseline.slice(-2));
});

test("duplicate identities and noncontiguous in-window records abstain", () => {
  const input = fixture();
  input.baseline[2].recordId = input.baseline[1].recordId;
  assert.equal(proposeBaselinePatch(input).status, "ABSTAIN");
  const foreign = fixture();
  foreign.baseline.splice(4, 0, cue("foreign-time", 40, 41, "別区間"));
  assert.deepEqual(proposeBaselinePatch(foreign).reasons, [
    "TARGETS_NOT_CONTIGUOUS",
  ]);
});
