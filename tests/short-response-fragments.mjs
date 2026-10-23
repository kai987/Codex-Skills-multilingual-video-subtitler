import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFragmentFeedback } from "../scripts/evaluate-short-response-fragments.mjs";

function fixture() {
  const base = (id) => ({
    id,
    audioHash: id.repeat(64).slice(0, 64),
    speechTruth: true,
    wholeReference: null,
    target: { start: 2, end: 3 },
    playback: { start: 1, end: 4 },
    relationLabel: "continuation",
    interjectionTypeTruth: null,
    backends: [{ backend: "whisper", status: "not-run" }],
  });
  const first = base("a"),
    second = base("b"),
    old = base("c");
  old.wholeReference = { text: "ああ", start: 2, end: 3 };
  first.backends = [
    {
      backend: "whisper",
      status: "executed",
      records: [
        { start: 0, end: 1, text: "ありがとうございます" },
        { start: 4, end: 5, text: "カードのお返しです" },
      ],
    },
  ];
  return {
    readiness: { rows: [first, second, old] },
    baseline: [
      {
        id: "cue",
        start: 1,
        end: 4,
        text: "有難う御座います カードのお返しです",
      },
    ],
    feedback: {
      version: "short-response-fragment-feedback-v1",
      parentFreezeHash: "f".repeat(64),
      source: "explicit-user-clip-list-in-current-conversation",
      annotations: [
        {
          id: "a",
          audioHash: first.audioHash,
          rawText: "ありがとうございます カードの",
          kind: "heard-fragment",
        },
        {
          id: "b",
          audioHash: second.audioHash,
          rawText: "语气词",
          kind: "interjection-type-only",
        },
      ],
    },
  };
}
const run = (f) =>
  evaluateFragmentFeedback(f.readiness, f.baseline, f.feedback, "f".repeat(64));

test("user text preserved; fragments and type-only labels never create whole intervals", () => {
  const f = fixture(),
    before = globalThis.structuredClone(f),
    r = run(f);
  assert.deepEqual(f, before);
  assert.equal(r.summary.lexicalFragments, 1);
  assert.equal(r.summary.typeOnly, 1);
  assert.equal(r.rows[0].suppliedText, "ありがとうございます カードの");
  assert(
    r.rows.every(
      (x) => x.confirmedInterval === null && !x.completeUtteranceConfirmed,
    ),
  );
  assert.equal(r.summary.previousCompleteUtteranceLabelsPreserved, 1);
  assert.equal(r.summary.newCompleteUtteranceLabels, 0);
  assert.equal(r.summary.subtitleMutations, 0);
});
test("surface presence across segments is not target localization or accuracy", () => {
  const r = run(fixture()).rows[0].localAsr[0];
  assert.equal(r.literalFragmentPresent, true);
  assert.equal(r.targetTimingVerified, false);
  assert.equal(r.targetTextCorrect, null);
  assert.deepEqual(
    r.components.map((c) => c.matchingRecordIndexes),
    [[0], [1]],
  );
});
test("orthography is not silently converted or counted as recognition error", () => {
  const r = run(fixture()).rows[0].baseline;
  assert.equal(r.literalFragmentPresent, false);
  assert.equal(r.targetTextCorrect, null);
});
test("type-only is not a Japanese transcript; unrun is not empty decoding", () => {
  const r = run(fixture()).rows[1];
  assert.equal(r.lexicalFragment, null);
  assert.equal(r.speechType, "interjection");
  assert.equal(r.baseline.status, "not-scorable-type-only");
  assert.equal(r.localAsr[0].status, "not-run");
});
test("stale parent or wrong waveform fails closed", () => {
  let f = fixture();
  f.feedback.parentFreezeHash = "e".repeat(64);
  assert.throws(() => run(f), /STALE_FEEDBACK/);
  f = fixture();
  f.feedback.annotations[0].audioHash = "a".repeat(63);
  assert.throws(() => run(f), /WRONG_AUDIO/);
});
test("duplicate, missing and foreign rows do not shrink or enlarge cohort", () => {
  let f = fixture();
  f.feedback.annotations.pop();
  assert.throws(() => run(f), /COHORT_MISMATCH/);
  f = fixture();
  f.feedback.annotations[1] = f.feedback.annotations[0];
  assert.throws(() => run(f), /COHORT_MISMATCH/);
  f = fixture();
  f.feedback.annotations[1].id = "foreign";
  assert.throws(() => run(f), /COHORT_MISMATCH/);
});
test("invented timing or unknown fields are rejected", () => {
  const f = fixture();
  f.feedback.annotations[0].start = 2;
  assert.throws(() => run(f), /UNKNOWN_OR_MISSING_FIELDS/);
});
test("empty, unknown-kind and prose labels cannot become lexical truth", () => {
  let f = fixture();
  f.feedback.annotations[0].rawText = " ";
  assert.throws(() => run(f), /EMPTY_FEEDBACK/);
  f = fixture();
  f.feedback.annotations[0].kind = "whole-sentence";
  assert.throws(() => run(f), /UNKNOWN_KIND/);
  f = fixture();
  f.feedback.annotations[1].kind = "heard-fragment";
  assert.throws(() => run(f), /JAPANESE_FRAGMENT_REQUIRED/);
});
