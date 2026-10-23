import test from "node:test";
import assert from "node:assert/strict";
import {
  planContexts,
  compareContexts,
} from "../scripts/lib/speech-context.mjs";
const cue = (id, start, end, text = "テスト") => ({
  recordId: id,
  sourceStart: start,
  sourceEnd: end,
  text,
  issues: [],
});
test("complete selected cues and one preceding neighbor; no reference or fixed video times", () => {
  const baseline = [
    cue("a", 5, 7),
    cue("b", 7, 9),
    cue("c", 9, 11),
    cue("d", 17, 19),
  ];
  const result = planContexts([{ id: "x", start: 10, end: 12 }], baseline, 30);
  assert.deepEqual(result.selected[0].coreRecordIds, ["b", "c"]);
  assert.equal(result.selected[0].start, 6);
  assert.equal(result.selected[0].end, 13);
  assert.deepEqual(result.selected[0].contextOnlyPartialRecordIds, ["a"]);
  assert.equal(result.selected[0].frames, 112000);
});
test("long contexts deferred, never truncated and called complete", () => {
  const r = planContexts(
    [{ id: "x", start: 2, end: 10 }],
    [cue("long", 0, 25)],
    30,
  );
  assert.equal(r.selected.length, 0);
  assert.match(r.deferred[0].reason, /EXCEEDS/u);
});
test("source offset and tail clip only context, preserve whole selected cue", () => {
  const r = planContexts(
    [{ id: "x", start: 4, end: 6 }],
    [cue("a", 3, 6)],
    6.5,
    3,
  ).selected[0];
  assert.equal(r.start, 3);
  assert.equal(r.end, 6.5);
});
test("empty regions and malformed identities fail or remain deferred", () => {
  assert.equal(
    planContexts([{ id: "x", start: 1, end: 2 }], [], 4).deferred[0].reason,
    "NO_MACHINE_CUE_CONTEXT",
  );
  assert.throws(() => planContexts([{ id: "x", start: NaN, end: 2 }], [], 4));
  assert.throws(() => planContexts([], [cue("a", 1, 2), cue("a", 2, 3)], 4));
});
const probe = { id: "x", start: 5, end: 13 };
const views = (text, start = 7, end = 10) =>
  ["whisper", "kotoba"].map((backend) => ({
    targetId: "x",
    backend,
    unresolvedCount: 0,
    records: [cue(backend, start, end, text)],
  }));
test("matching context containing short result is evidence, not new dialogue or automatic mutation", () => {
  const r = compareContexts(probe, views("短い文"), views("前の文短い文"), [
    cue("base", 7, 10),
  ]);
  assert(r.wholeContextTextAgreement && r.bothRetainShortText);
  assert.equal(r.sourceAssociation, "EXISTING_CUE_REGION_NOT_NEW_DIALOGUE");
  assert.equal(r.automaticMutation, false);
  assert.equal(r.acousticTimingVerified, false);
});
test("context conflicts, shifted strings and crop edge remain explicit", () => {
  const fresh = views("別の文", 5, 13);
  fresh[1].records[0].text = "また別の文";
  const r = compareContexts(probe, views("短い文"), fresh, []);
  assert.equal(r.wholeContextTextAgreement, false);
  assert.equal(r.bothRetainShortText, false);
  assert(r.byModel.every((v) => v.cropEdgePinned));
  assert.equal(r.status, "DIAGNOSTIC_ONLY");
});
test("invalid donors cannot form agreement", () => {
  const fresh = views("短い文", 8, 7);
  assert.equal(
    compareContexts(probe, views("短い文"), fresh, [])
      .wholeContextTextAgreement,
    false,
  );
});
