import test from "node:test";
import assert from "node:assert/strict";
import { closeDialogueTarget } from "../scripts/lib/whole-dialogue-recovery.mjs";
import { recoverBaselinePrefixes } from "../scripts/lib/dialogue-prefix-recovery.mjs";
const h = (c) => c.repeat(64);
function fixture() {
  const text = "明日は駅前の図書館で本を返してから帰ります";
  const baseline = [
    { id: "prior", start: 7, end: 9, text: "先に行ってください" },
    { id: "prefix1", start: 10, end: 11.5, text: "明日は" },
    { id: "prefix2", start: 11.5, end: 11.8, text: "明日は" },
    { id: "owner", start: 11, end: 14, text },
    { id: "next", start: 16, end: 18, text: "別の台詞です" },
  ];
  const targets = [
    closeDialogueTarget(baseline, { id: "t", start: 10, end: 14 }),
  ];
  const sourceRows = baseline.map((r) => ({
    recordId: r.id,
    sourceStart: r.start,
    sourceEnd: r.end,
    text: r.text,
    chunkIndex: r.id === "owner" ? 2 : 1,
    requestId: r.id === "owner" ? "chunk2" : "chunk1",
    issues: [],
  }));
  const views = ["a", "b"].map((id) => ({
    id,
    targetId: "t",
    start: 8,
    end: 15,
    modelHash: h(id),
    audioHash: h("1"),
    rawHash: h("2"),
    records: [
      {
        id: id + "-donor",
        start: 10.1,
        end: 14.2,
        text: id === "a" ? "あ、" + text : text,
      },
    ],
  }));
  return { baseline, targets, views, sourceRows };
}
const run = (f) =>
  recoverBaselinePrefixes(f.baseline, f.targets, f.views, f.sourceRows);
test("retains literal whole baseline owner; removes only independently corroborated seam prefixes", () => {
  const f = fixture(),
    original = JSON.stringify(f),
    r = run(f);
  assert.equal(r.changedTargets, 1);
  assert.equal(r.removedPrefixRecords, 2);
  assert.equal(r.candidate.length, 3);
  assert.equal(r.candidate[1].text, f.baseline[3].text);
  assert.equal(r.candidate[1].start, 10);
  assert.equal(r.candidate[1].end, 14);
  assert.deepEqual(r.candidate[0], f.baseline[0]);
  assert.deepEqual(r.candidate.at(-1), f.baseline.at(-1));
  assert.equal(JSON.stringify(f), original);
  assert.equal(r.decisions[0].timingVerified, false);
  assert.equal(r.decisions[0].unresolvedContext, true);
  assert.deepEqual(r.preferredOutputs, []);
});
test("an unpunctuated arbitrary substring cannot support a complete owner", () => {
  const f = fixture();
  f.views[0].records[0].text = "あ" + f.baseline[3].text;
  assert.equal(run(f).changedTargets, 0);
});
test("an extra spoken repetition blocks removal", () => {
  const f = fixture();
  f.views[0].records.unshift({
    id: "repeat",
    start: 9.8,
    end: 10.1,
    text: "明日は",
  });
  assert.equal(
    run(f).decisions[0].reason,
    "REPEAT_REMAINS_IN_ACOUSTIC_EVIDENCE",
  );
});
test("separate nonoverlapping occurrences are not duplicates", () => {
  const f = fixture();
  f.baseline[1].end = 10.5;
  f.sourceRows[1].sourceEnd = 10.5;
  assert.equal(run(f).changedTargets, 0);
});
test("same-chunk prefixes cannot be removed", () => {
  const f = fixture();
  f.sourceRows[3].chunkIndex = 1;
  assert.equal(run(f).decisions[0].reason, "NOT_ADJACENT_REQUEST_PREFIXES");
});
test("same model or mismatched physical audio does not provide cross-configuration evidence", () => {
  for (const change of [
    (f) => (f.views[1].modelHash = f.views[0].modelHash),
    (f) => (f.views[1].audioHash = h("3")),
  ]) {
    const f = fixture();
    change(f);
    assert.equal(run(f).changedTargets, 0);
  }
});
test("conflicting wording cannot be used as support", () => {
  const f = fixture();
  f.views[1].records[0].text = f.views[1].records[0].text.replace(
    "図書館",
    "映画館",
  );
  assert.equal(run(f).changedTargets, 0);
});
test("invalid timestamps, music and decoder loops fail closed", () => {
  for (const change of [
    (f) => (f.views[0].records[0].end = 99),
    (f) => (f.views[0].records[0].style = "music"),
    (f) =>
      f.views[0].records.push({
        id: "loop",
        start: 14.2,
        end: 14.8,
        text: "んんんんんんんん",
      }),
  ]) {
    const f = fixture();
    change(f);
    assert.equal(run(f).changedTargets, 0);
  }
});
test("stale baseline, duplicate IDs and missing raw source are rejected", () => {
  const f = fixture();
  f.sourceRows[3].text += "。";
  assert.throws(() => run(f), /RAW_BASELINE_BINDING/);
  const g = fixture();
  g.baseline[0].id = "owner";
  assert.throws(() => run(g), /DUPLICATE_BASELINE_ID/);
});
test("a non-prefix fragment cannot be thrown away", () => {
  const f = fixture();
  f.baseline[1].text = "別の言葉";
  f.sourceRows[1].text = "別の言葉";
  assert.equal(run(f).changedTargets, 0);
});

test("conflicting transactions reject both, regardless of target order", () => {
  const f = fixture();
  f.targets.push({ ...f.targets[0], id: "second" });
  f.views.push(
    ...f.views.map((v) => ({ ...v, id: v.id + "-second", targetId: "second" })),
  );
  const r = run(f);
  assert.equal(r.changedTargets, 0);
  assert(r.decisions.every((d) => d.reason === "TRANSACTION_CONFLICT"));
});

test("long baseline-owned 8-15 character text is not treated as a new 16-character donor", () => {
  const f = fixture(),
    text = "明日は図書館に行きます";
  f.baseline[3].text = text;
  f.sourceRows[3].text = text;
  f.views.forEach((v) => (v.records[0].text = text));
  assert.equal(run(f).changedTargets, 1);
});

test("a second owner occurrence is ambiguous, not extra supporting votes", () => {
  const f = fixture();
  f.views[0].records = [
    { id: "one", start: 10, end: 12, text: f.baseline[3].text },
    { id: "two", start: 12, end: 14, text: f.baseline[3].text },
  ];
  assert.equal(run(f).changedTargets, 0);
});
