/** Compare a uniquely shared whole-word core without rewriting either transcript. */
import assert from "node:assert/strict";
import {
  inspectWordAlignment,
  compareWordAlignments,
} from "./word-boundary-probe.mjs";
export const contextWordPolicy = Object.freeze({
  version: "full-context-word-alignment-v1",
  maxRequests: 2,
  maxWindowSeconds: 15,
  maxAudioSeconds: 30,
  retries: 0,
  mode: "conditional-observe",
  subtitleMutationAuthorized: false,
});
export function sharedWordCore(requests) {
  assert.equal(requests.length, 2);
  const sequences = requests.map((r) => r.segments[r.targetSegmentIndex].words);
  let best = [];
  for (let i = 0; i < sequences[0].length; i++)
    for (let j = 0; j < sequences[1].length; j++) {
      let n = 0;
      while (
        sequences[0][i + n] !== undefined &&
        sequences[0][i + n] === sequences[1][j + n]
      )
        n++;
      if (n > best.length) best = sequences[0].slice(i, i + n);
    }
  assert(best.join("").length >= 4, "NO_SUBSTANTIVE_SHARED_WORD_CORE");
  const occurrences = (words) =>
    words.flatMap((_, i) =>
      best.every((w, k) => words[i + k] === w) ? [i] : [],
    );
  const mappings = requests.map((r) => {
    const positions = occurrences(r.words);
    assert.equal(positions.length, 1, "AMBIGUOUS_CORE_OCCURRENCE");
    const target = r.segments[r.targetSegmentIndex],
      start = positions[0];
    assert(
      start >= target.wordStart && start + best.length <= target.wordEnd,
      "CORE_OUTSIDE_TARGET_SEGMENT",
    );
    return {
      requestId: r.id,
      start,
      end: start + best.length,
      targetWords: target.words,
      omittedPrefix: target.words.slice(0, start - target.wordStart),
      omittedSuffix: target.words.slice(start + best.length - target.wordStart),
    };
  });
  return {
    words: best,
    mappings,
    meaning:
      "comparison-core-only; omitted words remain in each full alignment; not a replacement transcript",
  };
}
export function summarizeContextWords(requests, raws, core) {
  const full = requests.map((r, i) =>
    inspectWordAlignment(raws[i], r, r.words),
  );
  for (let i = 0; i < requests.length; i++)
    assert(
      Math.abs(
        raws[i].fileInterval.end -
          raws[i].fileInterval.start -
          requests[i].frames / 16000,
      ) < 0.02,
      "TEXTGRID_AUDIO_DURATION_MISMATCH",
    );
  const selected = full.map((f, i) => {
    const m = core.mappings[i];
    assert.equal(m.requestId, requests[i].id);
    return { ...f, intervals: f.intervals.slice(m.start, m.end) };
  });
  return {
    full,
    core,
    coreComparison: compareWordAlignments(selected),
    targetIntervals: full.map((f, i) => {
      const r = requests[i],
        s = r.segments[r.targetSegmentIndex],
        words = f.intervals.slice(s.wordStart, s.wordEnd);
      return {
        requestId: r.id,
        text: s.text,
        words,
        interval: words.length
          ? { start: words[0].sourceStart, end: words.at(-1).sourceEnd }
          : null,
      };
    }),
    contextTranscriptAgreement: false,
    independentLexicalVerification: false,
    automaticReplacementAllowed: false,
    qualityStatus: "needs-review",
    finalizationMethod: "none",
  };
}
