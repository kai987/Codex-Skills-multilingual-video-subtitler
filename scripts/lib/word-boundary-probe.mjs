import assert from "node:assert/strict";
export const wordBoundaryPolicy = Object.freeze({
  version: "mfa-word-boundary-probe-v1",
  maximumRequests: 2,
  maximumSeconds: 20,
  retries: 0,
  stabilitySeconds: 0.12,
  edgeSeconds: 0.08,
  automaticMutation: false,
});
export function alignmentWords(analysis, text) {
  const item = analysis.items[0];
  assert(item && analysis.items.length === 1);
  assert.equal(
    item.morphemes.map((m) => m.surface).join(""),
    text,
    "TOKENIZER_TEXT_LOSS",
  );
  const words = item.morphemes
    .filter((m) => !/^[\s\p{P}\p{S}]+$/u.test(m.surface))
    .map((m) => m.surface);
  assert(
    words.length && item.unresolvedOov.length === 0,
    "UNRESOLVED_PRONUNCIATION",
  );
  return words;
}
export function boundaryWindows(target, baseline, duration, offset = 0) {
  const cues = target.coreRecordIds.map((id) =>
    baseline.find((r) => r.recordId === id),
  );
  assert(cues.length && cues.every(Boolean));
  const start = Math.max(
    offset,
    Math.min(...cues.map((c) => c.sourceStart)) - 0.5,
  );
  const end = Math.min(
    duration,
    Math.max(...cues.map((c) => c.sourceEnd)) + 0.5,
  );
  const rows = [
    { id: "narrow", start, end },
    { id: "wide", start: target.start, end: target.end },
  ].map((r) => ({
    ...r,
    start: Math.round(r.start * 16000) / 16000,
    end: Math.round(r.end * 16000) / 16000,
    frames: Math.round((r.end - r.start) * 16000),
  }));
  assert(rows.every((r) => r.frames > 0 && r.frames <= 8 * 16000));
  assert(rows.reduce((s, r) => s + r.frames, 0) <= 20 * 16000);
  assert(
    rows[1].start <= rows[0].start && rows[1].end >= rows[0].end,
    "WINDOWS_NOT_NESTED",
  );
  return {
    text: cues.map((c) => c.text).join(""),
    recordIds: cues.map((c) => c.recordId),
    windows: rows,
  };
}
const silent = (s) => ["", "sil", "sp", "<eps>"].includes(s.trim());
export function inspectWordAlignment(raw, window, words) {
  const blockers = [],
    lexical = raw.words.filter((w) => !silent(w.label));
  const duration = window.frames / 16000;
  const valid = (t) =>
    Array.isArray(t) &&
    t.every(
      (x, i) =>
        Number.isFinite(x.start) &&
        Number.isFinite(x.end) &&
        x.start >= 0 &&
        x.end > x.start &&
        x.end <= duration + 0.000001 &&
        (!i || x.start >= t[i - 1].end - 0.000001),
    );
  if (!valid(raw.words) || !valid(raw.phones))
    blockers.push("INVALID_TIER_INTERVALS");
  if (
    lexical.length !== words.length ||
    lexical.some((w, i) => w.label !== words[i])
  )
    blockers.push("WORD_SEQUENCE_MISMATCH");
  if (
    [...lexical, ...raw.phones].some((x) =>
      /^(?:spn|<unk>|unk)$/u.test(x.label),
    )
  )
    blockers.push("UNKNOWN_PHONE_OR_WORD");
  if (!raw.phones.some((p) => !silent(p.label)))
    blockers.push("NO_PHONE_TIER_SUPPORT");
  const intervals = lexical.map((w) => {
    const phones = raw.phones.filter(
      (p) => !silent(p.label) && p.start < w.end && p.end > w.start,
    );
    const covered = phones.reduce(
      (s, p) =>
        s + Math.max(0, Math.min(p.end, w.end) - Math.max(p.start, w.start)),
      0,
    );
    if (!phones.length || covered / (w.end - w.start) < 0.8)
      blockers.push("INCOMPLETE_WORD_PHONE_COVERAGE");
    return {
      ...w,
      sourceStart: window.start + w.start,
      sourceEnd: window.start + w.end,
      phoneCount: phones.length,
      phoneCoverage: covered / (w.end - w.start),
    };
  });
  if (
    lexical.length &&
    (lexical[0].start <= 0.08 || lexical.at(-1).end >= duration - 0.08)
  )
    blockers.push("CROP_EDGE_PINNED");
  return {
    id: window.id,
    intervals,
    blockers: [...new Set(blockers)],
    semantics:
      "transcript-conditioned MFA word/phone intervals; not CTC emission spans",
  };
}
export function compareWordAlignments(results) {
  assert.equal(results.length, 2);
  const [a, b] = results,
    blockers = [...a.blockers, ...b.blockers];
  if (a.intervals.length !== b.intervals.length)
    blockers.push("WINDOW_WORD_COUNT_CONFLICT");
  const comparisons = a.intervals.map((x, i) => {
    const y = b.intervals[i];
    if (!y || x.label !== y.label) {
      blockers.push("WINDOW_WORD_SEQUENCE_CONFLICT");
      return { word: x.label, comparable: false };
    }
    const startDelta = Math.abs(x.sourceStart - y.sourceStart),
      endDelta = Math.abs(x.sourceEnd - y.sourceEnd);
    if (startDelta > 0.120000001 || endDelta > 0.120000001)
      blockers.push("WORD_BOUNDARY_WINDOW_UNSTABLE");
    return {
      word: x.label,
      comparable: true,
      startDelta,
      endDelta,
      narrow: [x.sourceStart, x.sourceEnd],
      wide: [y.sourceStart, y.sourceEnd],
    };
  });
  return {
    status: blockers.length
      ? "UNRESOLVED"
      : "STABLE_CONDITIONAL_WORD_INTERVALS",
    comparisons,
    blockers: [...new Set(blockers)],
    independentLexicalVerification: false,
    displayBoundaryValidated: false,
    subtitleMutationAuthorized: false,
    note: "Same-model two-window stability is not independent timing truth. No text or timing writeback.",
  };
}
