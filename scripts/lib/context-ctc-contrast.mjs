import assert from "node:assert/strict";

export const contextCtcPolicy = Object.freeze({
  maxTargets: 2,
  maxRequests: 4,
  maxSeconds: 24,
  maxWindowSeconds: 8,
  retries: 0,
  subtitleMutationAuthorized: false,
});
export const alignmentText = (text) =>
  text.normalize("NFC").replace(/[\p{P}\p{Z}\s]/gu, "");
const interval = (s, e) =>
  Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s;

export function planContextContrast(parent, views, ids) {
  assert.equal(parent.referenceUsed, false);
  assert.equal(parent.labelsUsed, false);
  assert(
    ids.length > 0 && ids.length <= 2 && new Set(ids).size === ids.length,
    "TARGET_BUDGET",
  );
  const requests = ids.flatMap((id) => {
    const p = parent.probes.find((p) => p.id === id);
    assert(p && /^[a-zA-Z0-9._-]+$/u.test(id), "UNKNOWN_TARGET");
    assert(
      interval(p.start, p.end) &&
        interval(p.targetStart, p.targetEnd) &&
        p.targetStart >= p.start &&
        p.targetEnd <= p.end &&
        p.frames === Math.round((p.end - p.start) * 16000),
      "TIMEBASE",
    );
    return ["whisper", "kotoba"].map((backend) => {
      const vv = views.filter(
        (v) => v.targetId === id && v.backend === backend,
      );
      assert.equal(vv.length, 1, "VIEW_IDENTITY");
      const records = vv[0].records;
      assert(
        records.length &&
          records.every(
            (r, i) =>
              interval(r.start, r.end) &&
              r.start >= p.start - 1e-6 &&
              r.end <= p.end + 1e-6 &&
              typeof r.text === "string" &&
              alignmentText(r.text) &&
              (!i || r.start >= records[i - 1].end - 1e-6),
          ),
        "INVALID_COMPLETE_VIEW",
      );
      const targetText = records.map((r) => alignmentText(r.text)).join("");
      assert(targetText.length <= 400, "TEXT_BUDGET");
      return {
        id: `${id}-${backend}`,
        targetId: id,
        backend,
        start: p.start,
        end: p.end,
        targetStart: p.targetStart,
        targetEnd: p.targetEnd,
        frames: p.frames,
        wavHash: p.wavHash,
        targetText,
        records,
        coverageCompleteness: "unverified-full-stored-window-transcript",
      };
    });
  });
  assert(
    requests.length <= 4 &&
      requests.every((r) => r.frames > 0 && r.frames <= 8 * 16000) &&
      requests.reduce((n, r) => n + r.frames, 0) <= 24 * 16000,
    "ALIGNMENT_BUDGET",
  );
  return requests;
}

export function inspectContextAlignment(q, raw) {
  assert.equal(raw.requestId, q.id, "REQUEST_BINDING");
  if (raw.type === "error")
    return {
      id: q.id,
      status: "worker-error",
      code: raw.code,
      canMutate: false,
    };
  assert.equal(raw.type, "result");
  assert.equal(raw.target.targetText, q.targetText, "TEXT_BINDING");
  const blockers = [...raw.blockers];
  if (raw.pathStatus !== "success" || !raw.frameCountVerified)
    blockers.push("UNUSABLE_ALIGNMENT");
  const spans = raw.tokenSpans;
  assert(Array.isArray(spans));
  if (spans.length && spans.map((s) => s.token).join("") !== q.targetText)
    blockers.push("TOKEN_TEXT_MISMATCH");
  for (const [i, s] of spans.entries()) {
    assert.equal(s.targetIndex, i, "TOKEN_ORDER");
    assert(
      interval(s.startMediaGlobal, s.endMediaGlobal) &&
        s.startMediaGlobal >= q.start - 1e-6 &&
        s.endMediaGlobal <= q.end + 1e-6 &&
        Math.abs(s.startMediaGlobal - q.start - s.startSecondsLocal) < 1e-6 &&
        Math.abs(s.endMediaGlobal - q.start - s.endSecondsLocal) < 1e-6,
      "SPAN_TIMEBASE",
    );
  }
  // Token pieces may be complete Japanese words/phrases, not characters.
  // Character offsets associate text only; no time is divided by text length.
  let offset = 0,
    characterOffset = 0;
  const indexed = spans.map((s) => {
    const start = characterOffset;
    characterOffset += Array.from(s.token).length;
    return { ...s, characterStart: start, characterEnd: characterOffset };
  });
  const segments =
    blockers.includes("TOKEN_TEXT_MISMATCH") ||
    raw.pathStatus !== "success" ||
    !raw.frameCountVerified
      ? []
      : q.records.map((r) => {
          const count = Array.from(alignmentText(r.text)).length;
          const start = offset,
            end = offset + count;
          const matched = indexed.filter(
            (s) => s.characterStart < end && s.characterEnd > start,
          );
          offset += count;
          assert(matched.length, "INCOMPLETE_TOKEN_MAPPING");
          if (
            matched[0].characterStart !== start ||
            matched.at(-1).characterEnd !== end
          ) {
            blockers.push("TOKEN_CROSSES_SEGMENT_BOUNDARY");
            return {
              text: r.text,
              originalAsrInterval: { start: r.start, end: r.end },
              conditionalCtcInterval: null,
              reason: "TOKEN_CROSSES_SEGMENT_BOUNDARY",
            };
          }
          return {
            text: r.text,
            originalAsrInterval: { start: r.start, end: r.end },
            conditionalCtcInterval: {
              start: matched[0].startMediaGlobal,
              end: matched.at(-1).endMediaGlobal,
            },
            minimumPosterior: Math.min(...matched.map((s) => s.meanPosterior)),
            boundaryMeaning: "conditional-token-emissions-not-utterance-extent",
          };
        });
  return {
    id: q.id,
    status: raw.pathStatus,
    segments,
    targetOverlappingTokens: spans.filter(
      (s) =>
        s.startMediaGlobal < q.targetEnd && s.endMediaGlobal > q.targetStart,
    ),
    greedyText: raw.greedyText,
    greedyDiagnosticOnly: true,
    meanTokenPosterior: raw.meanTokenPosterior,
    minimumTokenPosterior: raw.minimumTokenPosterior,
    blockers: [
      ...new Set([
        ...blockers,
        "NO_INDEPENDENT_LEXICAL_OR_BOUNDARY_VERIFICATION",
      ]),
    ],
    posteriorIsCorrectnessProbability: false,
    canMutate: false,
  };
}
