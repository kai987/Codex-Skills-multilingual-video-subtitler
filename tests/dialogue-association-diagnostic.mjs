/* global structuredClone */
import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseDialogueAssociation as diagnose } from "../scripts/lib/dialogue-association-diagnostic.mjs";
const row = (id, start, end, text) => ({ id, start, end, text });
function fixture(text = "今日の予定です") {
  const baseline = [
    row("prev", 0, 2, "前の発言です"),
    row("target", 2, 4, text),
    row("next", 4, 6, "次の発言です"),
  ];
  const target = { id: "t", start: 2, end: 4, recordIds: ["target"] };
  const views = ["a", "b"].map((id, i) => ({
    id,
    targetId: "t",
    start: 1,
    end: 5,
    audioHash: "a".repeat(64),
    rawHash: id.repeat(64),
    modelHash: String(i + 1).repeat(64),
    records: [row(id, 2, 4, text)],
  }));
  return { baseline, target, views };
}
const run = (f) => diagnose(f.baseline, f.target, f.views);
test("agreed short whole raw group is explained, never accepted", () => {
  const f = fixture(),
    r = run(f);
  assert(r.flags.includes("AGREED_SHORT_RAW_GROUP"));
  assert.equal(r.originalDecision.status, "ABSTAIN");
  assert.equal(r.subtitleMutations, 0);
  assert.equal(r.automaticPromotionAllowed, false);
  assert.equal(r.timingVerified, false);
});
test("complete context closure reports missing leading/trailing baseline material", () => {
  const r = run(fixture());
  assert.deepEqual(r.context.partialContextIds, ["prev", "next"]);
  assert.equal(r.context.start, 0);
  assert.equal(r.context.end, 6);
});
test("neighbor absorption and containment are not false full agreement", () => {
  const f = fixture();
  f.views[0].records = [row("a", 1, 4, "前の発言です今日の予定です")];
  const r = run(f);
  assert(r.flags.includes("NEIGHBOR_BOUNDARY_CONFLICT"));
  assert(r.flags.includes("CONTAINMENT_NOT_COMPLETE_AGREEMENT"));
  assert.equal(r.relations[0].substringTimingAvailable, false);
});
test("lexical disagreement is not normalized away", () => {
  const f = fixture();
  f.views[1].records[0].text = "明日の予定です";
  assert(run(f).flags.includes("NO_EXACT_OR_CONTAINED_GROUP_TEXT"));
});
test("repeated baseline anchors are ambiguous despite one occurrence per view", () => {
  const f = fixture();
  f.baseline[0].text = f.baseline[1].text;
  const r = run(f);
  assert(r.flags.includes("REPEATED_ANCHOR_AMBIGUITY"));
  assert.equal(
    r.anchors.find((a) => a.recordId === "target").status,
    "AMBIGUOUS_REPEAT",
  );
});
test("repeated donor anchors and very short anchors cannot establish ownership", () => {
  const f = fixture();
  f.views[0].records[0].text += "今日の予定です";
  assert(run(f).flags.includes("REPEATED_ANCHOR_AMBIGUITY"));
  assert.equal(
    run(fixture("はい")).anchors.find((a) => a.recordId === "target").status,
    "TOO_SHORT",
  );
});
test("matching text cannot erase coverage and neighbor blockers", () => {
  const f = fixture("明日は朝から図書館に行って勉強する予定です");
  for (const v of f.views) v.records = [row(v.id, 1, 3, f.baseline[1].text)];
  const g = run(f).viewGroups[0].groups[0];
  assert(g.blockers.includes("INSUFFICIENT_TARGET_COVERAGE"));
  assert(g.blockers.includes("PROTECTED_NEIGHBOR_OVERLAP"));
});
test("valid long group preserves existing unchanged decision", () => {
  const r = run(fixture("明日は朝から図書館に行って勉強する予定です"));
  assert.equal(r.originalDecision.reason, "TEXT_UNCHANGED");
  assert.equal(r.viewGroups[0].groups[0].blockers.length, 0);
});
test("damaged identities, same model, invalid timing and duplicate ids fail closed", () => {
  for (const mutate of [
    (f) => (f.views[1].audioHash = "c".repeat(64)),
    (f) => (f.views[1].modelHash = f.views[0].modelHash),
    (f) => (f.views[0].records[0].end = NaN),
    (f) => f.views[0].records.push(f.views[0].records[0]),
    (f) => (f.target.recordIds = ["prev"]),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f));
  }
});
test("empty view remains missing evidence, not silence", () => {
  const f = fixture();
  f.views[1].records = [];
  assert(run(f).flags.includes("EMPTY_VIEW_NOT_SILENCE"));
});
test("diagnostics are deterministic and input records untouched", () => {
  const f = fixture(),
    before = structuredClone(f);
  assert.deepEqual(run(f), run(f));
  assert.deepEqual(f, before);
});
test("music and content risk remain blockers", () => {
  const f = fixture("♪歌の音声なので通常の発話と扱いません");
  assert(run(f).viewGroups[0].groups[0].blockers.includes("MUSIC"));
});
