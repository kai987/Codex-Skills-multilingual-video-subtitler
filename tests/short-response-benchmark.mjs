import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateShortResponses,
  boundaryError,
} from "../scripts/lib/short-response-benchmark.mjs";

function fixture() {
  const rows = [
    { id: "a", cohort: "ranked", sound: "speech", fraction: 1 },
    { id: "b", cohort: "reserve", sound: "speech", fraction: 0.25 },
    { id: "c", cohort: "ranked", sound: "noise", fraction: 0 },
    { id: "d", cohort: "reserve", sound: "effect", fraction: 0 },
  ];
  return {
    manifest: {
      items: rows.map((r, i) => ({
        ...r,
        audioHash: r.id.repeat(64),
        start: 10 * i,
        end: 10 * i + 4,
        targetStart: 10 * i + 1,
        targetEnd: 10 * i + 2,
      })),
    },
    labels: rows.map((r) => ({
      ...r,
      audioHash: r.id.repeat(64),
      relation: r.sound === "speech" ? "independent" : "not-applicable",
    })),
    observations: rows.map((r) => ({
      ...r,
      targetCoverageFraction: r.fraction,
      targetSupported: r.fraction >= 0.5,
      anyTargetOverlap: r.fraction > 0,
    })),
    decisions: [
      {
        id: "a",
        status: "ABSTAIN",
        reason: "CROP_EDGE",
        donors: [],
        insertions: [],
      },
    ],
    baseline: [],
    candidate: [],
    confirmedId: "a",
    confirmation: {
      authority: "explicit-human-confirmed-utterance",
      start: 1,
      end: 3,
      text: "ああ",
    },
    extent: {
      results: [
        { id: "narrow", intervals: [{ sourceStart: 1.2, sourceEnd: 2.2 }] },
        { id: "expanded", intervals: [{ sourceStart: 1.2, sourceEnd: 2.21 }] },
      ],
    },
    tail: {
      windows: [
        {
          id: "narrow",
          status: "UNRESOLVED",
          sourceSelectedEnd: null,
          sourceCandidates: [{ sourceEnd: 2.8 }],
        },
      ],
    },
  };
}
test("speech detection is not subtitle recovery or precision without insertions", () => {
  const r = evaluateShortResponses(fixture());
  assert.deepEqual(r.groups.all.initialCandidates, {
    TP: 2,
    FP: 2,
    TN: 0,
    FN: 0,
    unscored: 0,
    precision: 0.5,
    recall: 1,
  });
  assert.equal(r.groups.all.vadSupported.recall, 0.5);
  assert.equal(r.groups.all.triageRetainedSpeechReview.recall, 1);
  assert.equal(r.summary.machineCorrectInsertions, 0);
  assert.equal(r.summary.insertionPrecision, null);
});
test("unrun cases remain unrun and human insertion stays excluded", () => {
  const r = evaluateShortResponses(fixture());
  assert.equal(r.summary.asrAttempted, 1);
  assert.equal(r.summary.asrNotRun, 3);
  assert.equal(r.summary.humanAssistedInsertionsExcluded, 1);
  assert.equal(r.rows[1].asrStatus, "not-run");
  assert.equal(r.summary.boundaryLabelsMissingForSpeech, 1);
  assert.equal(r.boundaries.scoredUtterances, 1);
  assert.equal(r.boundaries.methods.length, 2);
});
test("pending/uncertain labels cannot become negative controls", () => {
  const f = fixture();
  f.labels[3].sound = "uncertain";
  assert.equal(
    evaluateShortResponses(f).groups.all.initialCandidates.unscored,
    1,
  );
});
test("known human result cannot enter frozen machine candidate", () => {
  const f = fixture();
  f.candidate.push({ id: "human", start: 1, end: 3, text: "ああ" });
  assert.throws(() => evaluateShortResponses(f), /ZERO_INSERTION/);
});
test("false support and duplicate or missing observations fail", () => {
  for (const change of [
    (f) => f.observations.push(f.observations[0]),
    (f) => f.observations.pop(),
    (f) => {
      f.observations[1].targetSupported = true;
    },
    (f) => {
      f.labels[0].audioHash = "bad";
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => evaluateShortResponses(f));
  }
});
test("foreign or applied decisions cannot be called abstentions", () => {
  for (const patch of [
    { id: "foreign" },
    { status: "INSERTED" },
    { insertions: [{}] },
  ]) {
    const f = fixture();
    Object.assign(f.decisions[0], patch);
    assert.throws(() => evaluateShortResponses(f));
  }
});
test("boundary signs are explicit and one occurrence is not a two-sample gain", () => {
  assert.deepEqual(
    boundaryError({ start: 68.18, end: 68.8 }, { start: 68, end: 69.58 }),
    {
      startErrorSeconds: 0.18,
      endErrorSeconds: -0.78,
      durationErrorSeconds: -0.96,
    },
  );
  const r = evaluateShortResponses(fixture());
  assert.equal(r.boundaries.pcmTail[0].selectedEnd, null);
  assert.equal(r.summary.independentGeneralizationAccuracy, null);
});
test("no music label does not become a music-control test", () => {
  assert.equal(
    evaluateShortResponses(fixture()).summary.musicLabeledControls,
    0,
  );
});
test("unknown source-global confirmation cannot silently attach to a clip", () => {
  const f = fixture();
  f.confirmation.start = -1;
  assert.throws(() => evaluateShortResponses(f), /OUTSIDE_PLAYBACK/);
});

function inserted(id, record) {
  const f = fixture();
  f.mode = "candidate-gain";
  f.decisions = [
    {
      id,
      status: "CANDIDATE",
      reason: "FROZEN_MACHINE_PROPOSAL",
      insertions: [record],
    },
  ];
  f.candidate = [record];
  return f;
}
test("v2 scores a materialized known recovery without marking the whole episode validated", () => {
  const f = inserted("a", { id: "new", start: 1, end: 3, text: "ああ。" });
  const r = evaluateShortResponses(f);
  assert.equal(r.summary.machineCorrectInsertions, 1);
  assert.equal(r.summary.machineRecoveredKnownMissing, 1);
  assert.equal(r.summary.insertionPrecision, 1);
  assert.equal(r.insertionEvaluation.remainingKnownMissing, 0);
  assert.equal(r.validity.qualityStatus, "needs-review");
  assert.equal(r.summary.independentGeneralizationAccuracy, null);
});
test("v2 cannot count unmaterialized proposals or arbitrary human edits", () => {
  const f = inserted("a", { id: "new", start: 1, end: 3, text: "ああ" });
  f.candidate = [];
  assert.throws(
    () => evaluateShortResponses(f),
    /UNACCOUNTED_CANDIDATE_CHANGE/,
  );
  f.candidate = [{ id: "unclaimed-human", start: 1, end: 3, text: "ああ" }];
  assert.throws(() => evaluateShortResponses(f));
});
test("v2 separates correct words from truncated timing", () => {
  const f = inserted("a", { id: "new", start: 1, end: 1.5, text: "ああ" });
  const r = evaluateShortResponses(f).insertionEvaluation;
  assert.equal(r.correct, 0);
  assert.equal(r.timingFailed, 1);
  assert.equal(r.remainingKnownMissing, 1);
  assert.equal(r.rows[0].boundary.endErrorSeconds, -1.5);
});
test("v2 rejects wrong words and equal text at the wrong occurrence", () => {
  for (const r of [
    { id: "new", start: 1, end: 3, text: "いいえ" },
    { id: "new", start: 3.1, end: 3.9, text: "ああ" },
  ]) {
    const gain = evaluateShortResponses(inserted("a", r)).insertionEvaluation;
    assert.equal(gain.false, 1);
    assert.equal(gain.correct, 0);
  }
});
test("v2 speech label without complete text/timing remains unscored", () => {
  const r = evaluateShortResponses(
    inserted("b", { id: "new", start: 11, end: 12, text: "はい" }),
  ).insertionEvaluation;
  assert.equal(r.unscored, 1);
  assert.equal(r.scoredPrecision, null);
  assert.equal(r.scoredFraction, 0);
});
test("v2 non-speech label applies only to reviewed target, not entire context", () => {
  const r = evaluateShortResponses(
    inserted("c", { id: "new", start: 21, end: 22, text: "はい" }),
  ).insertionEvaluation;
  assert.equal(r.false, 1);
  const outside = evaluateShortResponses(
    inserted("c", { id: "new", start: 20.1, end: 20.5, text: "はい" }),
  ).insertionEvaluation;
  assert.equal(outside.unscored, 1);
});
test("v2 never treats music as verified no-vocals", () => {
  const f = inserted("c", { id: "new", start: 21, end: 22, text: "はい" });
  f.labels[2].sound = "music";
  assert.equal(evaluateShortResponses(f).insertionEvaluation.unscored, 1);
});
test("v2 still protects baseline records and blocks collisions", () => {
  const f = inserted("a", { id: "new", start: 1, end: 3, text: "ああ" });
  f.baseline = [{ id: "old", start: 10, end: 10.5, text: "ええ" }];
  f.candidate.push({ ...f.baseline[0], text: "改変" });
  assert.throws(
    () => evaluateShortResponses(f),
    /UNACCOUNTED_CANDIDATE_CHANGE/,
  );
  f.baseline[0].start = 1;
  assert.throws(() => evaluateShortResponses(f), /INSERTION_COLLISION/);
});
