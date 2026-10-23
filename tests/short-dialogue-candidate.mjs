/* global structuredClone */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decideShortDialogue,
  buildShortDialogueCandidate,
} from "../scripts/lib/short-dialogue-candidate.mjs";
const row = (id, start, end, text) => ({ id, start, end, text });
function fixture() {
  const baseline = [
    row("prev", 0, 2, "前の話をします"),
    row("target", 3, 5, "昨日は学校に行きました"),
    row("next", 6, 8, "次の話をします"),
  ];
  const target = { id: "t", start: 3, end: 5, recordIds: ["target"] };
  const views = ["a", "b"].map((id, i) => ({
    id,
    targetId: "t",
    start: 0,
    end: 9,
    audioHash: "a".repeat(64),
    rawHash: id.repeat(64),
    modelHash: String(i + 1).repeat(64),
    records: [
      row(`${id}-prev`, 0, 2, baseline[0].text),
      row(`${id}-target`, 3.1, 4.9, "今日は学校に行きました"),
      row(`${id}-next`, 6, 8, baseline[2].text),
    ],
  }));
  return { baseline, target, views, duration: 9 };
}
const run = (f) =>
  decideShortDialogue(f.baseline, f.target, f.views, f.duration);
test("anchored complete short pair proposes text only and retains every original field", () => {
  const f = fixture();
  f.baseline[1].extra = { provenance: "kept" };
  const r = run(f);
  assert.equal(r.status, "CANDIDATE");
  assert.deepEqual(r.replacement, {
    ...f.baseline[1],
    text: "今日は学校に行きました",
  });
  assert.equal(r.timingVerified, false);
});
test("missing, weak or reordered neighbor anchors block replacement", () => {
  for (const mutate of [
    (f) => f.views[0].records.shift(),
    (f) => (f.baseline[0].text = "はい"),
    (f) => (f.views[0].records[0].text = "別の話です"),
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(run(f).status, "ABSTAIN");
  }
});
test("lexical conflict and contained-only phrase do not form full pair", () => {
  const f = fixture();
  f.views[1].records[1].text = "明日は学校に行きました";
  assert.equal(run(f).status, "ABSTAIN");
  f.views[1].records[1].text = "今日は学校に行きましたね";
  assert.equal(run(f).status, "ABSTAIN");
});
test("donor crossing protected neighbor is rejected", () => {
  const f = fixture();
  f.views[0].records[1].start = 1.9;
  f.views[0].records[0].end = 1.8;
  assert.equal(run(f).status, "ABSTAIN");
});
test("crop edges rejected except actual source edge; arbitrary first cue not a source boundary", () => {
  const f = fixture();
  for (const v of f.views) {
    v.start = 3;
    v.records = v.records.slice(1);
    v.records[0].start = 3;
  }
  assert.equal(run(f).status, "ABSTAIN");
  const g = fixture();
  g.baseline.shift();
  for (const v of g.views) v.records.shift();
  assert.equal(run(g).reason, "UNANCHORED_SOURCE_EDGE");
});
test("source start exception still requires full following text in both views", () => {
  const f = fixture();
  f.baseline.shift();
  f.baseline[0].start = 0;
  f.target.start = 0;
  for (const v of f.views) {
    v.records.shift();
    v.records[0].start = 0;
  }
  assert.equal(run(f).status, "CANDIDATE");
  f.views[0].records.pop();
  assert.equal(run(f).status, "ABSTAIN");
});
test("repeated donor and repeated baseline words remain protected", () => {
  const f = fixture();
  f.views[0].records.push(row("repeat", 8, 9, "今日は学校に行きました"));
  assert.equal(run(f).reason, "REPEATED_DONOR_TEXT");
  const g = fixture();
  g.baseline[0].text = g.baseline[1].text;
  assert.equal(run(g).reason, "REPEATED_BASELINE_TEXT");
});
test("model timing disagreement is not retimed to appear consistent", () => {
  const f = fixture();
  f.views[0].records[1].start = 3;
  f.views[1].records[1].start = 3.3;
  assert.equal(run(f).reason, "DONOR_BOUNDARY_DISAGREEMENT");
});
test("coverage and excessive changes fail closed", () => {
  const f = fixture();
  for (const v of f.views) v.records[1].end = 4;
  assert.equal(run(f).status, "ABSTAIN");
  const g = fixture();
  for (const v of g.views) v.records[1].text = "全然違う内容でした";
  assert.equal(run(g).reason, "EXCESSIVE_TEXT_CHANGE");
});
test("tiny interjections, music and unchanged text do not create candidates", () => {
  const f = fixture();
  f.baseline[1].text = "ああ";
  assert.equal(run(f).reason, "OUTSIDE_SHORT_CUE_SCOPE");
  const g = fixture();
  g.baseline[1].style = "music";
  assert.equal(run(g).status, "ABSTAIN");
  const h = fixture();
  for (const v of h.views) v.records[1].text = h.baseline[1].text;
  assert.equal(run(h).reason, "TEXT_UNCHANGED");
});
test("bad timing and mismatched physical/model identities fail", () => {
  for (const mutate of [
    (f) => (f.views[1].audioHash = "c".repeat(64)),
    (f) => (f.views[1].modelHash = f.views[0].modelHash),
    (f) => (f.views[0].records[1].end = NaN),
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => run(f));
  }
});
test("shadow assembler never promotes, reorders or mutates inputs", () => {
  const f = fixture(),
    before = structuredClone(f);
  const r = buildShortDialogueCandidate(
    f.baseline,
    [f.target],
    f.views,
    f.duration,
  );
  assert.equal(r.changedCues, 1);
  assert.equal(r.automaticPromotionAllowed, false);
  assert.deepEqual(r.preferredOutputs, []);
  assert.deepEqual(f, before);
  assert.deepEqual(
    r.candidate.map((x) => [x.id, x.start, x.end]),
    f.baseline.map((x) => [x.id, x.start, x.end]),
  );
  assert.deepEqual(r.candidate[0], f.baseline[0]);
});
test("conflicting transactions reject both; target order cannot choose winner", () => {
  const f = fixture(),
    t2 = { ...f.target, id: "t2" },
    vs = [
      ...f.views,
      ...f.views.map((v) => ({ ...v, id: v.id + "2", targetId: "t2" })),
    ];
  for (const ts of [
    [f.target, t2],
    [t2, f.target],
  ]) {
    const r = buildShortDialogueCandidate(f.baseline, ts, vs, 9);
    assert.equal(r.changedCues, 0);
    assert.deepEqual(r.candidate, f.baseline);
  }
});
