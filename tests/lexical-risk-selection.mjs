/* global structuredClone */
import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenRisk,
  associateTokenEvidence,
  selectLexicalRisks,
} from "../scripts/lib/lexical-risk-selection.mjs";
const token = (text, p, id = 1) => ({ text, p, id });
const records = [
  { id: "a", start: 2, end: 4, text: "明日の予定です" },
  { id: "b", start: 6, end: 8, text: "少し待ってください" },
];
const risks = (xs) =>
  xs.map((minProbability) => ({
    minProbability,
    lowTokens: [],
    lexicalTokenCount: 1,
  }));
test("special and punctuation token scores cannot trigger lexical risk", () => {
  assert.equal(
    tokenRisk([token("[_BEG_]", 0, 50365), token("。", 0), token("予定", 0.8)])
      .minProbability,
    0.8,
  );
});
test("invalid or missing lexical probabilities fail, not zero risk", () => {
  for (const ts of [
    [],
    [token("。", 0.1)],
    [token("予定", NaN)],
    [token("予定", 1.1)],
  ])
    assert.throws(() => tokenRisk(ts));
});
test("raw binding requires unique complete text and local envelope", () => {
  const row = { localStart: 2, localEnd: 4, text: "予定です" };
  const seg = {
    offsets: { from: 2000, to: 4000 },
    text: " 予定です",
    tokens: [token("予定", 0.2)],
  };
  assert.equal(associateTokenEvidence(row, [seg]).minProbability, 0.2);
  assert.throws(() => associateTokenEvidence(row, [seg, seg]));
  assert.throws(() => associateTokenEvidence({ ...row, text: "予定" }, [seg]));
  assert.throws(() => associateTokenEvidence({ ...row, localEnd: 4.1 }, [seg]));
});
test("one lowest probability target; all deferred records retained; deterministic", () => {
  const frozen = structuredClone(records),
    r = selectLexicalRisks(records, risks([0.4, 0.2]), 10);
  assert.equal(r.selected[0].recordId, "b");
  assert.equal(r.ranked.length, 2);
  assert.equal(r.ranked[1].status, "deferred-target-limit");
  assert.deepEqual(records, frozen);
  assert.deepEqual(r, selectLexicalRisks(records, risks([0.4, 0.2]), 10));
});
test("high confidence wrong words are not pretended detectable", () => {
  assert.equal(
    selectLexicalRisks(records, risks([0.9, 0.6]), 10).selected.length,
    0,
  );
});
test("overlapping baseline records close whole; too long does not get clipped", () => {
  const rows = [
    { id: "a", start: 0, end: 10, text: "長い発言です" },
    { id: "b", start: 9, end: 20, text: "続く発言です" },
  ];
  const result = selectLexicalRisks(rows, risks([0.1, 0.8]), 20);
  assert.equal(result.selected.length, 0);
  assert.equal(result.ranked[0].status, "deferred-window-limit");
  assert.deepEqual(result.ranked[0].target.recordIds, ["a", "b"]);
});
test("music excluded and tie breaks by time", () => {
  assert.equal(
    selectLexicalRisks(records, risks([0.2, 0.2]), 10).selected[0].recordId,
    "a",
  );
  assert.equal(
    selectLexicalRisks(
      [{ ...records[0], style: "music" }, records[1]],
      risks([0.1, 0.2]),
      10,
    ).selected[0].recordId,
    "b",
  );
});
test("bad duration, duplicate ids, missing scores fail", () => {
  assert.throws(() => selectLexicalRisks(records, risks([0.2]), 10));
  assert.throws(() =>
    selectLexicalRisks([records[0], records[0]], risks([0.2, 0.2]), 10),
  );
  assert.throws(() => selectLexicalRisks(records, risks([0.2, 0.2]), NaN));
});
