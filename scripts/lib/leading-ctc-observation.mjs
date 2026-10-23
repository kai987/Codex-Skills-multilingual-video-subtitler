import assert from "node:assert/strict";
import {
  alignmentText,
  inspectContextAlignment,
} from "./context-ctc-contrast.mjs";

export const leadingCtcPolicy = Object.freeze({
  maxRequests: 1,
  maxWindowSeconds: 8,
  maxSeconds: 8,
  retries: 0,
  subtitleMutationAuthorized: false,
});
const chars = (s) => Array.from(s);

export function leadingCtcRequest(request, prefix) {
  assert.equal(prefix.requestId, request.id, "PREFIX_REQUEST_BINDING");
  assert(
    Number.isFinite(request.start) &&
      request.start >= 0 &&
      Number.isFinite(request.end) &&
      request.end > request.start,
    "SOURCE_TIMEBASE",
  );
  assert(
    typeof prefix.text === "string" && alignmentText(prefix.text).length > 0,
    "EMPTY_PREFIX",
  );
  assert(
    request.frames > 0 &&
      request.frames <= 8 * 16000 &&
      request.frames === Math.round((request.end - request.start) * 16000),
    "WINDOW_BUDGET",
  );
  const records = request.segments.map((s) => ({
    ...s.originalInterval,
    text: s.text,
  }));
  assert(
    records.every(
      (r, i) =>
        r.end > r.start &&
        r.start >= request.start - 1e-6 &&
        r.end <= request.end + 1e-6 &&
        (!i || r.start >= records[i - 1].end - 1e-6),
    ),
    "COMPLETE_CONTEXT_REQUIRED",
  );
  const target = records[request.targetSegmentIndex];
  assert(
    target && alignmentText(target.text).startsWith(alignmentText(prefix.text)),
    "PREFIX_TEXT_BINDING",
  );
  assert(
    prefix.conditionalMfaInterval.start >= request.start &&
      prefix.conditionalMfaInterval.end <= request.end &&
      prefix.conditionalMfaInterval.end > prefix.conditionalMfaInterval.start,
    "PREFIX_TIMEBASE",
  );
  const characterStart = records
    .slice(0, request.targetSegmentIndex)
    .reduce((n, r) => n + chars(alignmentText(r.text)).length, 0);
  return {
    id: request.id + "-leading-ctc",
    start: request.start,
    end: request.end,
    frames: request.frames,
    wavHash: request.audioHash,
    records,
    targetText: records.map((r) => alignmentText(r.text)).join(""),
    targetStart: prefix.conditionalMfaInterval.start,
    targetEnd: prefix.conditionalMfaInterval.end,
    focus: {
      text: prefix.text,
      characterStart,
      characterEnd: characterStart + chars(alignmentText(prefix.text)).length,
      conditionalMfaInterval: prefix.conditionalMfaInterval,
    },
    coverageCompleteness:
      "full-saved-machine-transcript-not-proof-of-completeness",
  };
}

export function greedyEmissions(q, observation, ready, vocabulary) {
  assert.equal(observation.requestId, q.id, "GREEDY_REQUEST_BINDING");
  const ids = observation.frameTokenIds;
  assert(Array.isArray(ids) && ids.length > 0, "GREEDY_FRAMES_MISSING");
  let expected = q.frames;
  for (let i = 0; i < ready.convKernel.length; i++)
    expected =
      Math.floor((expected - ready.convKernel[i]) / ready.convStride[i]) + 1;
  assert.equal(ids.length, expected, "GREEDY_FRAME_GEOMETRY");
  let stride = 1,
    receptive = 1;
  for (let i = 0; i < ready.convKernel.length; i++) {
    receptive += (ready.convKernel[i] - 1) * stride;
    stride *= ready.convStride[i];
  }
  assert.equal(stride, ready.totalStrideSamples);
  assert.equal(receptive, ready.receptiveFieldSamples);
  const tokens = new Map(
    Object.entries(vocabulary).map(([token, id]) => [id, token]),
  );
  assert.equal(
    tokens.size,
    Object.keys(vocabulary).length,
    "DUPLICATE_VOCABULARY_ID",
  );
  assert.equal(
    observation.blankTokenId,
    ready.blankTokenId,
    "BLANK_TOKEN_BINDING",
  );
  assert(
    ids.every((id) => Number.isInteger(id) && tokens.has(id)),
    "UNKNOWN_GREEDY_TOKEN",
  );
  const runs = [];
  for (let i = 0; i < ids.length;) {
    let end = i + 1;
    while (end < ids.length && ids[end] === ids[i]) end++;
    if (ids[i] !== ready.blankTokenId)
      runs.push({
        tokenId: ids[i],
        text: tokens.get(ids[i]),
        startFrame: i,
        endFrameExclusive: end,
        start: q.start + (i * stride) / 16000,
        end:
          q.start + Math.min(q.frames, (end - 1) * stride + receptive) / 16000,
        meaning: "unconditioned-argmax-emission-not-utterance-duration",
      });
    i = end;
  }
  assert.deepEqual(
    runs.map((r) => r.tokenId),
    observation.collapsedTokenIds,
    "GREEDY_COLLAPSE_MISMATCH",
  );
  return runs;
}

export function inspectLeadingCtc(q, raw, observation, ready, vocabulary) {
  const conditional = inspectContextAlignment(q, raw);
  const emissions = greedyEmissions(q, observation, ready, vocabulary);
  if (raw.type === "result")
    assert.equal(
      raw.predictedFrameCount,
      observation.frameTokenIds.length,
      "FORWARD_BINDING",
    );
  let offset = 0;
  const usable =
    raw.type === "result" &&
    raw.pathStatus === "success" &&
    raw.frameCountVerified &&
    !conditional.blockers.includes("TOKEN_TEXT_MISMATCH");
  const matched = (usable ? raw.tokenSpans : []).flatMap((s) => {
    const start = offset;
    offset += chars(s.token).length;
    return start < q.focus.characterEnd && offset > q.focus.characterStart
      ? [{ ...s, characterStart: start, characterEnd: offset }]
      : [];
  });
  const isolated =
    matched.length > 0 &&
    matched[0].characterStart === q.focus.characterStart &&
    matched.at(-1).characterEnd === q.focus.characterEnd;
  const focus = isolated
    ? { start: matched[0].startMediaGlobal, end: matched.at(-1).endMediaGlobal }
    : null;
  const mfa = q.focus.conditionalMfaInterval;
  const localGreedy = emissions.filter(
    (e) => e.start < mfa.end && e.end > mfa.start,
  );
  const sameText = localGreedy.filter(
    (e) => alignmentText(e.text) === alignmentText(q.focus.text),
  );
  const blockers = [
    "UTTERANCE_BOUNDARIES_NOT_VERIFIED",
    "SINGLE_NEW_CTC_WINDOW",
  ];
  if (!isolated) blockers.push("FOCUS_NOT_ISOLATED_BY_TOKEN");
  if (!sameText.length)
    blockers.push("NO_EXACT_LOCAL_GREEDY_MATCH_NOT_PROOF_OF_ABSENCE");
  if (
    focus &&
    !sameText.some((e) => e.start < focus.end && e.end > focus.start)
  )
    blockers.push("CONDITIONAL_AND_GREEDY_POSITION_DISAGREE");
  return {
    version: "leading-ctc-observation-v1",
    focus: q.focus,
    sourceWindow: { start: q.start, end: q.end },
    conditional,
    conditionalFocusEmission: focus,
    greedyText: raw.greedyText ?? null,
    greedyEmissions: emissions,
    localGreedyEmissions: localGreedy,
    exactLocalGreedyMatches: sameText,
    interpretation: sameText.length
      ? "independent-model-local-emission-support-not-validated-cue"
      : "no-exact-local-decoding-support-retain-unresolved",
    evidenceFamilies: { newCtc: 1, greedyAndForcedIndependent: false },
    blockers,
    subtitleInterval: null,
    subtitleMutations: 0,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
    referenceUsed: false,
  };
}
