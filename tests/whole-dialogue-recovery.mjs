import test from "node:test";
import assert from "node:assert/strict";
import {
  closeDialogueTarget,
  recoverWholeDialogue,
} from "../scripts/lib/whole-dialogue-recovery.mjs";

const h = (c) => c.repeat(64);
function fixture() {
  const baseline = [
    { id: "prior", start: 7, end: 9, text: "先に行っていてください" },
    { id: "left", start: 10, end: 12, text: "今日は駅前のお店で待っています" },
    { id: "right", start: 11.8, end: 14, text: "お店で待っていますからね" },
    { id: "next", start: 15, end: 17, text: "それではあとで会いましょう" },
  ];
  const targets = [
    closeDialogueTarget(baseline, { id: "t1", start: 10, end: 14 }),
  ];
  const views = ["a", "b"].map((id) => ({
    id,
    targetId: "t1",
    start: 6,
    end: 18,
    audioHash: h("1"),
    modelHash: h(id),
    rawHash: h("2"),
    records: [
      {
        id: `${id}-whole`,
        start: 10.1,
        end: 13.9,
        text: "今日は駅前のお店で待っていますからね",
      },
    ],
  }));
  return { baseline, targets, views };
}
const run = ({ baseline, targets, views }) =>
  recoverWholeDialogue(baseline, targets, views);
test("whole donor repair preserves original envelope, neighbors and input bytes", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    r = run(f);
  assert.equal(r.changedTargets, 1);
  assert.equal(r.candidate.length, 3);
  assert.deepEqual(r.candidate[1], {
    id: "t1-whole-dialogue",
    start: 10,
    end: 14,
    text: "今日は駅前のお店で待っていますからね",
  });
  assert.deepEqual(r.candidate[0], f.baseline[0]);
  assert.deepEqual(r.candidate[2], f.baseline[3]);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.timingRepairs, 0);
  assert.equal(r.automaticPromotionAllowed, false);
});
test("lexical disagreement cannot be normalized into agreement", () => {
  const f = fixture();
  f.views[1].records[0].text = "今日は駅前のお店で走っていますからね";
  assert.equal(run(f).changedTargets, 0);
});
test("same model is not a paired model configuration", () => {
  const f = fixture();
  f.views[1].modelHash = f.views[0].modelHash;
  assert.equal(
    run(f).decisions[0].reason,
    "TWO_BOUND_MODEL_CONFIGURATIONS_REQUIRED",
  );
});
test("audio or physical window mismatch blocks association", () => {
  for (const change of [
    (f) => (f.views[1].audioHash = h("3")),
    (f) => f.views[1].start++,
  ]) {
    const f = fixture();
    change(f);
    assert.equal(run(f).decisions[0].reason, "MATCHED_PHYSICAL_AUDIO_REQUIRED");
  }
});
test("whole-record closure includes overlapping successor", () => {
  const f = fixture();
  f.baseline.push({
    id: "intrusion",
    start: 13,
    end: 15,
    text: "別の発話です",
  });
  assert.throws(() => run(f), /TARGET_NOT_CLOSED/);
  const target = closeDialogueTarget(f.baseline, f.targets[0]);
  assert.equal(target.end, 15);
  assert(target.recordIds.includes("intrusion"));
});
test("donor crossing a protected neighbor is never clipped", () => {
  const f = fixture();
  f.views[0].records[0].start = 8.5;
  assert.equal(run(f).changedTargets, 0);
});
test("partial coverage and invalid/nonmonotonic segments are rejected", () => {
  for (const change of [
    (f) => (f.views[1].records[0].end = 11),
    (f) => (f.views[1].records[0].end = 30),
    (f) =>
      f.views[1].records.push({
        id: "bad",
        start: 11,
        end: 12,
        text: "別の文",
      }),
  ]) {
    const f = fixture();
    change(f);
    assert.equal(run(f).changedTargets, 0);
  }
});
test("music and embedded decoder loops cannot enter donor selection", () => {
  for (const text of [
    "♪今日は駅前のお店で待っていますからね♪",
    "ああああああ今日は駅前のお店で待っていますからね",
  ]) {
    const f = fixture();
    f.views.forEach((v) => (v.records[0].text = text));
    assert.equal(run(f).changedTargets, 0);
  }
});
test("crop-edge evidence stays timing-unverified; never copies donor timestamp", () => {
  const f = fixture();
  f.views.forEach((v) => (v.start = 10.1));
  assert.equal(run(f).changedTargets, 0); // Request does not contain complete baseline.
  f.views.forEach((v) => {
    v.start = 10;
    v.records[0].start = 10;
  });
  const r = run(f);
  assert.equal(r.decisions[0].cropEdgeObserved, true);
  assert.equal(r.decisions[0].timingVerified, false);
});
test("nonoverlapping real repeat outside target is retained", () => {
  const f = fixture();
  f.baseline[3].text = f.views[0].records[0].text;
  assert.deepEqual(run(f).candidate.at(-1), f.baseline.at(-1));
});
test("conflicting target transactions reject all members", () => {
  const f = fixture();
  f.targets.push({ ...f.targets[0], id: "t2" });
  f.views.push(
    ...f.views.map((v) => ({ ...v, id: v.id + "2", targetId: "t2" })),
  );
  const r = run(f);
  assert.equal(r.changedTargets, 0);
  assert(r.decisions.every((d) => d.reason === "TARGET_TRANSACTION_CONFLICT"));
});
test("foreign long text replacement fails similarity guard", () => {
  const f = fixture();
  f.views.forEach(
    (v) =>
      (v.records[0].text = "明日の午後から新しい映画の撮影を始めるそうです"),
  );
  assert.equal(run(f).changedTargets, 0);
});
