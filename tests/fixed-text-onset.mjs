import test from "node:test";
import assert from "node:assert/strict";
import {
  planFixedText,
  inspectFixedText,
} from "../scripts/lib/fixed-text-onset.mjs";
const t = {
  id: "cue-114",
  text: "ここならタバコ吸えます",
  oldStart: 10,
  oldEnd: 16,
  start: 9.5,
  end: 16.5,
  firstFrame: 152000,
  endFrame: 264000,
};
const raw = {
  id: t.id,
  language: "ja",
  frames: 112000,
  segments: [{ text: t.text, words: [{ word: t.text, start: 3, end: 6 }] }],
};
const plan = () => planFixedText(t, raw, 30);
function responses(p) {
  return p.requests.map((q) => ({
    requestId: q.id,
    type: "result",
    pathStatus: "success",
    frameCountVerified: true,
    workerRequestVerified: true,
    target: { targetText: t.text, targetEncodable: true },
    blockers: [],
    greedyText: t.text,
    meanTokenPosterior: 0.95,
    minimumTokenPosterior: 0.9,
    startPinnedToWindowEdge: false,
    endPinnedToWindowEdge: false,
    tokenSpans: [
      {
        token: t.text,
        targetIndex: 0,
        startMediaGlobal: 12.5,
        endMediaGlobal: 15.5,
        startSecondsLocal: 12.5 - q.start,
        endSecondsLocal: 15.5 - q.start,
        meanPosterior: 0.95,
      },
    ],
  }));
}
test("two windows derive from stored machine words, preserving exact text", () => {
  const p = plan();
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[1].start, 11.5);
  assert.equal(p.requests[1].end, 16.5);
  assert(p.requests.every((q) => q.targetText === t.text));
});
test("changed stored text, invalid words and excessive duration rejected", () => {
  assert.throws(
    () =>
      planFixedText(
        t,
        { ...raw, segments: [{ text: "別の話", words: [] }] },
        30,
      ),
    /STORED_TEXT_CONFLICT/,
  );
  assert.throws(
    () => planFixedText({ ...t, end: 30 }, raw, 30),
    /WINDOW_BUDGET/,
  );
  assert.throws(
    () =>
      planFixedText(
        t,
        {
          ...raw,
          segments: [
            { text: t.text, words: [{ word: t.text, start: 4, end: 3 }] },
          ],
        },
        30,
      ),
    /WORD_TIMES/,
  );
});
test("stable support remains review-only, never edits input subtitle", () => {
  const p = plan(),
    copy = globalThis.structuredClone(p),
    r = inspectFixedText(p, responses(p));
  assert.equal(r.status, "CANDIDATE_FOR_REVIEW");
  assert.equal(r.proposedStart, 12.35);
  assert.equal(r.canMutate, false);
  assert.deepEqual(p, copy);
});
for (const [name, mutate, blocker] of [
  [
    "greedy disagreement",
    (r) => {
      r[0].greedyText = "違う";
    },
    "CTC_GREEDY_TEXT_CONFLICT",
  ],
  [
    "weak posterior",
    (r) => {
      r[0].minimumTokenPosterior = 0.1;
    },
    "WEAK_CTC_SUPPORT",
  ],
  [
    "edge pinned",
    (r) => {
      r[0].startPinnedToWindowEdge = true;
    },
    "UNUSABLE_ALIGNMENT",
  ],
  [
    "context drift",
    (r) => {
      r[1].tokenSpans[0].startMediaGlobal += 0.4;
      r[1].tokenSpans[0].startSecondsLocal += 0.4;
    },
    "CONTEXT_UNSTABLE",
  ],
  [
    "end beyond protected end",
    (r) => {
      r[1].tokenSpans[0].endMediaGlobal = 16.4;
      r[1].tokenSpans[0].endSecondsLocal = 16.4 - plan().requests[1].start;
    },
    "PRESERVED_END_MAY_TRUNCATE",
  ],
])
  test(name, () => {
    const p = plan(),
      r = responses(p);
    mutate(r);
    const result = inspectFixedText(p, r);
    assert.equal(result.status, "ABSTAIN");
    assert(result.blockers.includes(blocker));
    assert.equal(result.proposedStart, null);
  });
test("duplicate and mismapped response rejected", () => {
  const p = plan(),
    r = responses(p);
  assert.throws(() => inspectFixedText(p, [r[0], r[0]]));
  r[0].tokenSpans[0].startMediaGlobal++;
  assert.throws(() => inspectFixedText(p, r), /SPAN_TIMEBASE/);
});
