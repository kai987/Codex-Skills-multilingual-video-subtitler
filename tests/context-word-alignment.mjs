import test from "node:test";
import assert from "node:assert/strict";
import {
  sharedWordCore,
  summarizeContextWords,
} from "../scripts/lib/context-word-alignment.mjs";
const request = (id, words, target, start = 0) => ({
  id,
  start,
  frames: 160000,
  targetSegmentIndex: 1,
  words,
  segments: [
    { words: words.slice(0, target[0]), wordStart: 0, wordEnd: target[0] },
    {
      text: words.slice(...target).join(""),
      words: words.slice(...target),
      wordStart: target[0],
      wordEnd: target[1],
    },
  ],
});
const pair = () => [
  request("a", ["前文", "あ", "それ", "は", "カード", "後文"], [1, 5]),
  request("b", ["前文", "それ", "は", "カード", "後文"], [1, 4]),
];
test("preserves leading interjection while mapping common whole words", () => {
  const p = pair(),
    before = JSON.stringify(p),
    c = sharedWordCore(p);
  assert.deepEqual(c.words, ["それ", "は", "カード"]);
  assert.deepEqual(c.mappings[0].omittedPrefix, ["あ"]);
  assert.equal(JSON.stringify(p), before);
});
test("rejects repeated core occurrences instead of picking the first", () => {
  const p = pair();
  p[0].words.push("それ", "は", "カード");
  assert.throws(() => sharedWordCore(p), /AMBIGUOUS/);
});
test("rejects no substantive common text", () => {
  assert.throws(
    () =>
      sharedWordCore([
        request("a", ["あ", "ここ"], [0, 2]),
        request("b", ["あ", "そこ"], [0, 2]),
      ]),
    /NO_SUBSTANTIVE/,
  );
});
const raw = (r) => ({
  fileInterval: { start: 0, end: 10 },
  words: r.words.map((label, i) => ({ label, start: 1 + i, end: 1.5 + i })),
  phones: r.words.map((_, i) => ({ label: "a", start: 1 + i, end: 1.5 + i })),
});
test("retains all aligned context and never authorizes subtitle mutation", () => {
  const p = pair(),
    c = sharedWordCore(p),
    s = summarizeContextWords(p, p.map(raw), c);
  assert.equal(s.full[0].intervals.length, 6);
  assert.equal(s.targetIntervals[0].words.length, 4);
  assert.equal(s.automaticReplacementAllowed, false);
  assert.equal(s.coreComparison.subtitleMutationAuthorized, false);
});
test("unknown phones and word mismatch remain blockers for the core", () => {
  const p = pair(),
    a = p.map(raw);
  a[0].phones[0].label = "spn";
  a[1].words[0].label = "wrong";
  const s = summarizeContextWords(p, a, sharedWordCore(p));
  assert(s.coreComparison.blockers.includes("UNKNOWN_PHONE_OR_WORD"));
  assert(s.coreComparison.blockers.includes("WORD_SEQUENCE_MISMATCH"));
});
test("textgrid file duration cannot silently differ from PCM", () => {
  const p = pair(),
    a = p.map(raw);
  a[0].fileInterval.end = 9;
  assert.throws(
    () => summarizeContextWords(p, a, sharedWordCore(p)),
    /DURATION/,
  );
});
