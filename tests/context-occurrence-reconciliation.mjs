import test from "node:test";
import assert from "node:assert/strict";
import {
  observationCoverage,
  reconcileContextOccurrences,
} from "../scripts/lib/context-occurrence-reconciliation.mjs";
import {
  sharedWordCore,
  summarizeContextWords,
} from "../scripts/lib/context-word-alignment.mjs";

function fixture() {
  const request = (id, start, end, words, segments) => ({
    id,
    start,
    end,
    frames: Math.round((end - start) * 16000),
    words,
    targetSegmentIndex: 1,
    segments: segments.map(([wordStart, wordEnd, from, to]) => ({
      wordStart,
      wordEnd,
      words: words.slice(wordStart, wordEnd),
      text: words.slice(wordStart, wordEnd).join(""),
      originalInterval: { start: from, end: to },
    })),
  });
  const requests = [
    request(
      "narrow",
      100,
      112,
      ["前文", "あ", "それ", "は", "カード", "あ"],
      [
        [0, 1, 100, 102],
        [1, 5, 102, 106.8],
        [5, 6, 106.8, 108.2],
      ],
    ),
    request(
      "wide",
      98,
      114,
      ["前文", "それ", "は", "カード", "ありがとう", "ござい", "ます"],
      [
        [0, 1, 100, 102],
        [1, 4, 102, 106.8],
        [4, 7, 106.8, 111],
      ],
    ),
  ];
  const times = [
    [
      [100, 101],
      [102.1, 102.38],
      [103, 103.5],
      [103.5, 104],
      [104, 106],
      [106.05, 106.08],
    ],
    [
      [100, 101],
      [103, 103.5],
      [103.5, 104],
      [104, 106],
      [109.6, 110.08],
      [110.08, 110.34],
      [110.34, 110.58],
    ],
  ];
  const raws = requests.map((r, i) => {
    const words = r.words.map((label, n) => ({
      label,
      start: times[i][n][0] - r.start,
      end: times[i][n][1] - r.start,
    }));
    return {
      fileInterval: { start: 0, end: r.end - r.start },
      words,
      phones: words.map((word) => ({ ...word, label: "a" })),
    };
  });
  return {
    requests,
    alignment: summarizeContextWords(requests, raws, sharedWordCore(requests)),
    sourceAudioHash: "a".repeat(64),
    anchoredInput: {
      sourceWindow: { start: 103, end: 111 },
      activityWindow: { start: 103, end: 111 },
      originalTarget: { start: 106.98, end: 107.24 },
      anchor: { start: 107.78, end: 107.805 },
      donor: { start: 107.04, end: 109.24, text: "ああ" },
      greedyText: "ああ。",
      vadIntervals: [
        { start: 103.3, end: 107.28 },
        { start: 107.76, end: 107.96 },
      ],
      baseline: [
        { id: "previous", start: 103, end: 106.8, text: "それはカード" },
      ],
    },
  };
}

test("observation coverage distinguishes outside, partial, and covered without absence inference", () => {
  const window = { start: 10, end: 20 };
  assert.equal(
    observationCoverage(window, { start: 5, end: 10 }),
    "outside-observation-window",
  );
  assert.equal(observationCoverage(window, { start: 9, end: 11 }), "partial");
  assert.equal(observationCoverage(window, { start: 10, end: 20 }), "covered");
  assert.throws(
    () => observationCoverage(window, { start: 15, end: 14 }),
    /INVALID_INTERVAL/,
  );
});

test("leading and following repeated あ remain distinct from the anchored ああ", () => {
  const input = fixture(),
    before = globalThis.structuredClone(input);
  const result = reconcileContextOccurrences(input);
  assert.equal(result.prefixes.length, 1);
  assert.equal(result.prefixes[0].text, "あ");
  assert.equal(
    result.prefixes[0].independentObservationCoverage,
    "outside-observation-window",
  );
  assert.equal(result.prefixes[0].absenceCanReject, false);
  assert.equal(result.prefixes[0].externalAnchorAtSamePosition, false);
  assert.equal(
    result.prefixes[0].otherContextViews[0].windowCoverage,
    "covered",
  );
  assert.equal(
    result.prefixes[0].otherContextViews[0].meaning,
    "transcript-difference-not-acoustic-rejection",
  );
  const trailing = result.followingCandidates.find(
    (r) => r.requestId === "narrow",
  );
  assert.equal(trailing.text, "あ");
  assert.notEqual(trailing.id, result.prefixes[0].id);
  assert.equal(trailing.exactText, false);
  assert.equal(trailing.textDifference, "preserved-not-normalized-away");
  assert.equal(result.anchoredResponse.text, "ああ");
  assert.deepEqual(input, before);
});

test("disjoint conditioned MFA position cannot donate timing to an overlapping ASR envelope", () => {
  const result = reconcileContextOccurrences(fixture());
  const trailing = result.followingCandidates.find(
    (r) => r.requestId === "narrow",
  );
  assert.equal(trailing.asrContainsAnchor, true);
  assert.equal(trailing.alignmentContainsAnchor, false);
  assert.equal(
    trailing.route,
    "asr-envelope-overlap-alignment-position-conflict",
  );
  assert.equal(trailing.timingUsableForAnchoredResponse, false);
  assert.equal(trailing.subtitleInterval, null);
});

test("later thanks remain a complete conflicting candidate, not automatic acceptance or character split", () => {
  const result = reconcileContextOccurrences(fixture());
  const thanks = result.followingCandidates.find((r) => r.requestId === "wide");
  assert.equal(thanks.text, "ありがとうございます");
  assert.deepEqual(thanks.conditionalMfaInterval, {
    start: 109.6,
    end: 110.58,
  });
  assert.equal(thanks.asrContainsAnchor, true);
  assert.equal(thanks.alignmentContainsAnchor, false);
  assert.equal(thanks.timingUsableForAnchoredResponse, false);
  assert.equal(thanks.subtitleInterval, null);
});

test("preserves inherited context-edge warnings and keeps all writes unauthorized", () => {
  const result = reconcileContextOccurrences(fixture());
  assert(
    result.inheritedContextWarnings[0].blockers.includes("CROP_EDGE_PINNED"),
  );
  assert.equal(result.newInference, 0);
  assert.equal(result.subtitleMutations, 0);
  assert.equal(result.automaticReplacementAllowed, false);
  assert.equal(result.finalizationMethod, "none");
  assert.equal(result.qualityStatus, "needs-review");
  assert.equal(result.anchoredResponse.subtitleMutationAuthorized, false);
  assert.equal(
    result.anchoredResponse.displayPreview.primarySubtitleMutationAuthorized,
    false,
  );
  assert.equal(
    result.anchoredResponse.displayPreview.verifiedUtteranceInterval,
    null,
  );
});

test("same-source CTC emission and greedy are explicitly one-family evidence", () => {
  const result = reconcileContextOccurrences(fixture());
  assert.match(result.anchoredResponse.evidenceMeaning.ctc, /one-model-family/);
  assert.match(
    result.anchoredResponse.evidenceMeaning.ctc,
    /not two independent votes/,
  );
});

test("existing baseline collision suppresses display preview regardless of text equality", () => {
  for (const text of ["ああ", "別の発話"]) {
    const input = fixture();
    input.anchoredInput.baseline.push({
      id: "collision",
      start: 107.7,
      end: 108,
      text,
    });
    const result = reconcileContextOccurrences(input);
    assert.equal(result.anchoredResponse.route, "existing-cue-review");
    assert.equal(result.anchoredResponse.displayPreview.displayInterval, null);
    assert.equal(
      result.anchoredResponse.displayPreview.route,
      "no-display-preview",
    );
  }
});

test("rejects mismatched request IDs and aligned word labels", () => {
  const wrongId = fixture();
  wrongId.alignment.full[0].id = "other";
  assert.throws(
    () => reconcileContextOccurrences(wrongId),
    /ALIGNMENT_REQUEST_BINDING/,
  );
  const wrongWord = fixture();
  wrongWord.alignment.full[0].intervals[1].label = "ん";
  assert.throws(
    () => reconcileContextOccurrences(wrongWord),
    /WORD_SEQUENCE_MISMATCH/,
  );
});

test("rejects segments with mismatched word slices", () => {
  const input = fixture();
  input.requests[0].segments[2].words = ["ん"];
  assert.throws(
    () => reconcileContextOccurrences(input),
    /SEGMENT_WORD_BINDING/,
  );
});

test("rejects reordered, duplicated, or missing segment partitions", () => {
  for (const mutate of [
    (r) => r.segments.push(globalThis.structuredClone(r.segments[2])),
    (r) => {
      r.segments = [r.segments[0], r.segments[2], r.segments[1]];
      r.targetSegmentIndex = 2;
    },
    (r) => r.segments.splice(2, 1),
  ]) {
    const input = fixture();
    mutate(input.requests[0]);
    assert.throws(() => reconcileContextOccurrences(input));
  }
});

test("rejects foreign, invalid, or reversed word timing", () => {
  for (const patch of [
    { sourceStart: 0, sourceEnd: 0.3 },
    { sourceStart: 104, sourceEnd: 103 },
    { sourceStart: Number.NaN, sourceEnd: 103 },
    { sourceStart: 100.5, sourceEnd: 100.9 },
  ]) {
    const input = fixture();
    Object.assign(input.alignment.full[0].intervals[1], patch);
    assert.throws(
      () => reconcileContextOccurrences(input),
      /INVALID_WORD_TIMEBASE/,
    );
  }
});

test("rejects malformed source identity and reference fields", () => {
  const input = fixture();
  assert.throws(
    () => reconcileContextOccurrences({ ...input, sourceAudioHash: "wrong" }),
    /SOURCE_IDENTITY_REQUIRED/,
  );
  assert.throws(
    () => reconcileContextOccurrences({ ...input, referenceText: "ああ" }),
    /MACHINE_FIELDS_ONLY/,
  );
});

test("rejects duplicate requests and invalid target indices before association", () => {
  const duplicate = fixture();
  duplicate.requests[1].id = duplicate.requests[0].id;
  assert.throws(
    () => reconcileContextOccurrences(duplicate),
    /REQUEST_IDENTITY_MISMATCH/,
  );
  for (const index of [-1, 1.5, 3]) {
    const input = fixture();
    input.requests[0].targetSegmentIndex = index;
    assert.throws(
      () => reconcileContextOccurrences(input),
      /INVALID_TARGET_SEGMENT/,
    );
  }
});

test("rebinds core comparison rather than trusting a forged summary", () => {
  const input = fixture();
  input.alignment.coreComparison.subtitleMutationAuthorized = true;
  assert.throws(
    () => reconcileContextOccurrences(input),
    /CORE_COMPARISON_BINDING/,
  );
});
