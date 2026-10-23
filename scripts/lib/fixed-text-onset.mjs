import assert from "node:assert/strict";
import {
  alignmentText,
  inspectContextAlignment,
} from "./context-ctc-contrast.mjs";
export const policy = Object.freeze({
  maxTargets: 1,
  maxRequests: 2,
  maxWindowSeconds: 8,
  maxTotalSeconds: 16,
  retries: 0,
  contextPad: 1,
  maximumContextSpread: 0.12,
  maximumWhisperDifference: 0.25,
  minimumPosterior: 0.5,
  meanPosterior: 0.7,
  padding: 0.15,
  subtitleMutationAuthorized: false,
});
export function planFixedText(t, raw, duration) {
  assert.equal(raw.id, t.id);
  assert.equal(raw.language, "ja");
  assert.equal(raw.frames, t.endFrame - t.firstFrame);
  const words = raw.segments
    .flatMap((s) => s.words ?? [])
    .filter((w) => alignmentText(w.word));
  assert.equal(
    alignmentText(raw.segments.map((s) => s.text).join("")),
    alignmentText(t.text),
    "STORED_TEXT_CONFLICT",
  );
  assert.equal(
    words.map((w) => alignmentText(w.word)).join(""),
    alignmentText(t.text),
    "WORD_TEXT_COVERAGE",
  );
  assert(words.length);
  for (const [i, w] of words.entries())
    assert(
      Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.end > w.start &&
        w.start >= 0 &&
        w.end <= raw.frames / 16000 + 1e-6 &&
        (!i || w.start >= words[i - 1].end - 1e-6),
      "WORD_TIMES",
    );
  const first = t.start + words[0].start,
    last = t.start + words.at(-1).end;
  const windows = [
    [t.start, t.end],
    [
      Math.max(0, first - policy.contextPad),
      Math.min(duration, last + policy.contextPad),
    ],
  ];
  const requests = windows.map(([s, e], i) => {
    const firstFrame = Math.round(s * 16000),
      endFrame = Math.round(e * 16000),
      start = firstFrame / 16000,
      end = endFrame / 16000;
    assert(
      end > start && end - start <= policy.maxWindowSeconds,
      "WINDOW_BUDGET",
    );
    return {
      id: `fixed-${i + 1}`,
      targetId: t.id,
      start,
      end,
      firstFrame,
      endFrame,
      frames: endFrame - firstFrame,
      targetStart: first,
      targetEnd: last,
      targetText: alignmentText(t.text),
      records: [{ start: first, end: last, text: t.text }],
    };
  });
  assert(
    requests.reduce((s, r) => s + r.frames, 0) <=
      policy.maxTotalSeconds * 16000,
    "TOTAL_BUDGET",
  );
  return {
    target: t,
    storedWordStart: first,
    storedWordEnd: last,
    requests,
    policy,
  };
}
export function inspectFixedText(plan, raws) {
  assert.equal(raws.length, 2);
  assert.equal(new Set(raws.map((r) => r.requestId)).size, 2);
  const views = plan.requests.map((q) => {
    const raw = raws.find((r) => r.requestId === q.id);
    assert(raw, "MISSING_RESPONSE");
    const checked = inspectContextAlignment(q, raw);
    return {
      id: q.id,
      checked,
      encodable: raw.target?.targetEncodable === true,
      workerBound: raw.workerRequestVerified === true,
      greedyMatches: raw.greedyText === q.targetText,
      edge: raw.startPinnedToWindowEdge || raw.endPinnedToWindowEdge,
    };
  });
  const blockers = [];
  for (const v of views) {
    const c = v.checked;
    if (
      c.status !== "success" ||
      !v.encodable ||
      !v.workerBound ||
      v.edge ||
      !c.segments?.[0]?.conditionalCtcInterval
    )
      blockers.push("UNUSABLE_ALIGNMENT");
    blockers.push(
      ...(c.blockers ?? []).filter(
        (b) => b !== "NO_INDEPENDENT_LEXICAL_OR_BOUNDARY_VERIFICATION",
      ),
    );
    if (!v.greedyMatches) blockers.push("CTC_GREEDY_TEXT_CONFLICT");
    if (
      !Number.isFinite(c.minimumTokenPosterior) ||
      c.minimumTokenPosterior < policy.minimumPosterior ||
      !Number.isFinite(c.meanTokenPosterior) ||
      c.meanTokenPosterior < policy.meanPosterior
    )
      blockers.push("WEAK_CTC_SUPPORT");
  }
  const spans = views.map(
    (v) => v.checked.segments?.[0]?.conditionalCtcInterval,
  );
  let spread = null,
    whisperDifference = null,
    proposedStart = null;
  if (spans.every(Boolean)) {
    spread = Math.abs(spans[0].start - spans[1].start);
    whisperDifference = Math.max(
      ...spans.map((s) => Math.abs(s.start - plan.storedWordStart)),
    );
    if (spread > policy.maximumContextSpread) blockers.push("CONTEXT_UNSTABLE");
    if (whisperDifference > policy.maximumWhisperDifference)
      blockers.push("WHISPER_CTC_DISAGREEMENT");
    if (spans.some((s) => s.end > plan.target.oldEnd + 0.05))
      blockers.push("PRESERVED_END_MAY_TRUNCATE");
    proposedStart =
      Math.round(
        (Math.min(...spans.map((s) => s.start), plan.storedWordStart) -
          policy.padding) *
          100,
      ) / 100;
    if (
      proposedStart < plan.target.oldStart + 0.75 ||
      proposedStart >= plan.target.oldEnd - 0.5
    )
      blockers.push("UNSAFE_START_MOVE");
  }
  return {
    status: blockers.length ? "ABSTAIN" : "CANDIDATE_FOR_REVIEW",
    blockers: [...new Set(blockers)],
    views,
    onsetSpread: spread,
    whisperDifference,
    proposedStart: blockers.length ? null : proposedStart,
    unchangedText: plan.target.text,
    unchangedEnd: plan.target.oldEnd,
    canMutate: false,
    qualityStatus: "needs-review",
    timingMeaning: "conditional-token-emissions-not-complete-utterance-extent",
  };
}
