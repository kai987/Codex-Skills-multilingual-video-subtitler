import test from "node:test";
import assert from "node:assert/strict";
import {
  leadingCtcPolicy,
  leadingCtcRequest,
  greedyEmissions,
  inspectLeadingCtc,
} from "../scripts/lib/leading-ctc-observation.mjs";

const copy = (value) => globalThis.structuredClone(value);

function planFixture() {
  return {
    request: {
      id: "stored-context",
      start: 10,
      end: 14,
      frames: 64000,
      audioHash: "a".repeat(64),
      targetSegmentIndex: 1,
      segments: [
        { text: "前。", originalInterval: { start: 10, end: 11 } },
        { text: "あ、それ は", originalInterval: { start: 11, end: 13 } },
        { text: "あ", originalInterval: { start: 13, end: 14 } },
      ],
    },
    prefix: {
      requestId: "stored-context",
      text: "あ",
      conditionalMfaInterval: { start: 11, end: 11.2 },
    },
  };
}

function observationFixture() {
  const { request, prefix } = planFixture();
  const q = leadingCtcRequest(request, prefix);
  const ready = {
    convKernel: [400],
    convStride: [320],
    totalStrideSamples: 320,
    receptiveFieldSamples: 400,
    blankTokenId: 0,
  };
  const vocabulary = { "<pad>": 0, 前: 1, あ: 2, それ: 3, は: 4 };
  const frameTokenIds = Array(199).fill(0);
  for (const [index, id] of [
    [20, 1],
    [50, 2],
    [51, 2],
    [80, 3],
    [100, 4],
    [170, 2],
  ])
    frameTokenIds[index] = id;
  const observation = {
    requestId: q.id,
    blankTokenId: 0,
    frameTokenIds,
    collapsedTokenIds: [1, 2, 3, 4, 2],
  };
  const tokens = ["前", "あ", "それ", "は", "あ"];
  const starts = [0.4, 1, 1.6, 2, 3.4];
  const raw = {
    type: "result",
    requestId: q.id,
    target: { targetText: q.targetText },
    pathStatus: "success",
    frameCountVerified: true,
    predictedFrameCount: frameTokenIds.length,
    blockers: [],
    greedyText: "前あそれはあ",
    meanTokenPosterior: 0.8,
    minimumTokenPosterior: 0.6,
    tokenSpans: tokens.map((token, i) => ({
      token,
      targetIndex: i,
      startMediaGlobal: q.start + starts[i],
      endMediaGlobal: q.start + starts[i] + 0.025,
      startSecondsLocal: starts[i],
      endSecondsLocal: starts[i] + 0.025,
      meanPosterior: 0.8,
    })),
  };
  return { q, raw, observation, ready, vocabulary };
}
const inspect = (f) =>
  inspectLeadingCtc(f.q, f.raw, f.observation, f.ready, f.vocabulary);

test("request keeps the complete stored audio and every text segment unchanged", () => {
  const input = planFixture(),
    before = copy(input);
  const q = leadingCtcRequest(input.request, input.prefix);
  assert.equal(q.start, 10);
  assert.equal(q.end, 14);
  assert.equal(q.frames, 64000);
  assert.equal(q.wavHash, input.request.audioHash);
  assert.deepEqual(q.records, [
    { start: 10, end: 11, text: "前。" },
    { start: 11, end: 13, text: "あ、それ は" },
    { start: 13, end: 14, text: "あ" },
  ]);
  assert.equal(q.targetText, "前あそれはあ");
  assert.equal(q.focus.characterStart, 1);
  assert.equal(q.focus.characterEnd, 2);
  assert.deepEqual(input, before);
});

test("single-request policy has an eight-second hard ceiling and no retries", () => {
  assert.equal(leadingCtcPolicy.maxRequests, 1);
  assert.equal(leadingCtcPolicy.maxWindowSeconds, 8);
  assert.equal(leadingCtcPolicy.maxSeconds, 8);
  assert.equal(leadingCtcPolicy.retries, 0);
  assert.equal(leadingCtcPolicy.subtitleMutationAuthorized, false);
  for (const patch of [
    { end: 18.1, frames: 129600 },
    { frames: 63999 },
    { frames: 0 },
  ]) {
    const { request, prefix } = planFixture();
    Object.assign(request, patch);
    assert.throws(() => leadingCtcRequest(request, prefix), /WINDOW_BUDGET/);
  }
});

test("prefix request identity, exact normalized text, and source interval are bound", () => {
  for (const patch of [
    { requestId: "different" },
    { text: "ん" },
    { text: "" },
    { conditionalMfaInterval: { start: 9, end: 10 } },
    { conditionalMfaInterval: { start: 11.2, end: 11 } },
  ]) {
    const { request, prefix } = planFixture();
    assert.throws(() => leadingCtcRequest(request, { ...prefix, ...patch }));
  }
});

test("rejects negative source coordinates, out-of-crop segments, and reordered context", () => {
  const negative = planFixture();
  negative.request.start -= 11;
  negative.request.end -= 11;
  for (const segment of negative.request.segments) {
    segment.originalInterval.start -= 11;
    segment.originalInterval.end -= 11;
  }
  negative.prefix.conditionalMfaInterval = { start: 0, end: 0.2 };
  assert.throws(() => leadingCtcRequest(negative.request, negative.prefix));
  for (const mutate of [
    (r) => {
      r.segments[0].originalInterval.start = 9;
    },
    (r) => {
      r.segments.reverse();
    },
  ]) {
    const { request, prefix } = planFixture();
    mutate(request);
    assert.throws(
      () => leadingCtcRequest(request, prefix),
      /COMPLETE_CONTEXT_REQUIRED/,
    );
  }
});

test("greedy collapse merges consecutive repeat frames, retaining repeat tokens separated by blank", () => {
  const f = observationFixture();
  let emissions = greedyEmissions(f.q, f.observation, f.ready, f.vocabulary);
  assert.deepEqual(
    emissions.map((e) => e.tokenId),
    [1, 2, 3, 4, 2],
  );
  assert.equal(emissions[1].startFrame, 50);
  assert.equal(emissions[1].endFrameExclusive, 52);
  f.observation.frameTokenIds[53] = 2;
  f.observation.collapsedTokenIds = [1, 2, 2, 3, 4, 2];
  emissions = greedyEmissions(f.q, f.observation, f.ready, f.vocabulary);
  assert.deepEqual(
    emissions.map((e) => e.tokenId),
    [1, 2, 2, 3, 4, 2],
  );
  assert.equal(emissions[2].startFrame, 53);
});

test("source times derive from convolution stride and receptive support with offset once", () => {
  const f = observationFixture();
  const emissions = greedyEmissions(f.q, f.observation, f.ready, f.vocabulary);
  assert.equal(emissions[1].start, 11);
  assert.equal(emissions[1].end, 11.045);
  assert.equal(emissions[4].start, 13.4);
  assert.equal(emissions[4].end, 13.425);
  assert(emissions.every((e) => e.start >= f.q.start && e.end <= f.q.end));
});

test("rejects unknown IDs, tampered collapse, and mismatched request identity", () => {
  for (const mutate of [
    (f) => {
      f.observation.frameTokenIds[1] = 999;
    },
    (f) => {
      f.observation.collapsedTokenIds = [1, 2];
    },
    (f) => {
      f.observation.requestId = "other";
    },
  ]) {
    const f = observationFixture();
    mutate(f);
    assert.throws(() =>
      greedyEmissions(f.q, f.observation, f.ready, f.vocabulary),
    );
  }
});

test("rejects ambiguous vocabulary IDs instead of silently changing decoded text", () => {
  const f = observationFixture();
  f.vocabulary.別 = 2;
  assert.throws(() =>
    greedyEmissions(f.q, f.observation, f.ready, f.vocabulary),
  );
});

test("rejects frame geometry, stride metadata, receptive width, and forward-length tampering", () => {
  for (const mutate of [
    (f) => {
      f.observation.frameTokenIds.pop();
    },
    (f) => {
      f.ready.totalStrideSamples = 321;
    },
    (f) => {
      f.ready.receptiveFieldSamples = 401;
    },
    (f) => {
      f.raw.predictedFrameCount = 1;
    },
  ]) {
    const f = observationFixture();
    mutate(f);
    assert.throws(() => inspect(f));
  }
});

test("local leading support does not conflate later identical token or authorize subtitle mutation", () => {
  const f = observationFixture(),
    before = copy(f);
  const result = inspect(f);
  assert.equal(result.exactLocalGreedyMatches.length, 1);
  assert.equal(result.exactLocalGreedyMatches[0].start, 11);
  assert.equal(result.greedyEmissions.filter((e) => e.text === "あ").length, 2);
  assert.deepEqual(result.conditionalFocusEmission, { start: 11, end: 11.025 });
  assert.equal(result.evidenceFamilies.newCtc, 1);
  assert.equal(result.evidenceFamilies.greedyAndForcedIndependent, false);
  assert.equal(result.subtitleInterval, null);
  assert.equal(result.subtitleMutations, 0);
  assert.equal(result.finalizationMethod, "none");
  assert.equal(result.qualityStatus, "needs-review");
  assert(result.blockers.includes("UTTERANCE_BOUNDARIES_NOT_VERIFIED"));
  assert.deepEqual(f, before);
});

test("later identical greedy token cannot stand in for missing leading occurrence", () => {
  const f = observationFixture();
  f.observation.frameTokenIds[50] = 0;
  f.observation.frameTokenIds[51] = 0;
  f.observation.collapsedTokenIds = [1, 3, 4, 2];
  f.raw.greedyText = "前それはあ";
  const result = inspect(f);
  assert.equal(result.exactLocalGreedyMatches.length, 0);
  assert.equal(result.localGreedyEmissions.length, 0);
  assert.equal(
    result.interpretation,
    "no-exact-local-decoding-support-retain-unresolved",
  );
  assert(
    result.blockers.includes(
      "NO_EXACT_LOCAL_GREEDY_MATCH_NOT_PROOF_OF_ABSENCE",
    ),
  );
  assert.equal(result.subtitleInterval, null);
});

test("a merged token spanning the prefix boundary cannot provide artificial prefix time", () => {
  const f = observationFixture();
  f.raw.tokenSpans[0].token = "前あ";
  f.raw.tokenSpans.splice(1, 1);
  f.raw.tokenSpans.forEach((span, index) => {
    span.targetIndex = index;
  });
  const result = inspect(f);
  assert.equal(result.conditionalFocusEmission, null);
  assert(result.blockers.includes("FOCUS_NOT_ISOLATED_BY_TOKEN"));
});

test("unusable forced alignment cannot supply conditional focus even if greedy remains available", () => {
  for (const mutate of [
    (f) => {
      f.raw.frameCountVerified = false;
    },
    (f) => {
      f.raw.pathStatus = "failed";
    },
    (f) => {
      f.raw.tokenSpans[1].token = "ん";
    },
  ]) {
    const f = observationFixture();
    mutate(f);
    const result = inspect(f);
    assert.equal(result.conditionalFocusEmission, null);
    assert.equal(result.subtitleInterval, null);
    assert.equal(result.subtitleMutations, 0);
  }
});

test("conditional token coordinates cannot acquire the source offset twice", () => {
  const f = observationFixture();
  f.raw.tokenSpans[1].startMediaGlobal += f.q.start;
  f.raw.tokenSpans[1].endMediaGlobal += f.q.start;
  assert.throws(() => inspect(f), /SPAN_TIMEBASE/);
});

test("a forced worker error stays unavailable without discarding separately saved greedy frames", () => {
  const f = observationFixture();
  f.raw = { type: "error", requestId: f.q.id, code: "ALIGNMENT_FAILED" };
  const result = inspect(f);
  assert.equal(result.conditional.status, "worker-error");
  assert.equal(result.conditionalFocusEmission, null);
  assert.equal(result.greedyEmissions.length, 5);
  assert.equal(result.subtitleMutations, 0);
});

test("blank-token identity must match the runtime contract", () => {
  const f = observationFixture();
  f.observation.blankTokenId = 2;
  assert.throws(() => inspect(f), /BLANK_TOKEN_BINDING/);
});
