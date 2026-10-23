/** Deterministic PCM and regression checks. Not a speech detector or alignment model. */
import { createHash } from "node:crypto";

export const AUDIO_GUARD_VERSION = "pcm-zero-and-replacement-v1";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const normalized = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .replace(/[\s\p{P}]/gu, "");

export function pcmEvidence(pcm, startFrame, endFrame) {
  if (
    !Number.isSafeInteger(startFrame) ||
    !Number.isSafeInteger(endFrame) ||
    startFrame < 0 ||
    endFrame <= startFrame ||
    endFrame > pcm.frames ||
    pcm.data.length !== pcm.frames * 2 ||
    !(pcm.sampleRate > 0)
  )
    throw Error("INVALID_PCM_EVIDENCE_RANGE");
  let first = null,
    last = null,
    runStart = null;
  const zeroRuns = [];
  const close = (end) => {
    // Two seconds of exact zeros is a display-risk threshold, not inferred silence.
    if (runStart !== null && end - runStart >= 2 * pcm.sampleRate)
      zeroRuns.push([runStart, end]);
    runStart = null;
  };
  for (let i = startFrame; i < endFrame; i++) {
    if (pcm.data.readInt16LE(i * 2) === 0) {
      if (runStart === null) runStart = i;
    } else {
      first ??= i;
      last = i;
      close(i);
    }
  }
  close(endFrame);
  return {
    version: AUDIO_GUARD_VERSION,
    startFrame,
    endFrame,
    sampleRate: pcm.sampleRate,
    pcmSliceHash: hash(pcm.data.subarray(startFrame * 2, endFrame * 2)),
    allSamplesExactlyZero: first === null,
    firstNonzeroFrame: first,
    lastNonzeroFrame: last,
    longZeroRuns: zeroRuns,
    speechPresence: "NOT_CLASSIFIED",
    acousticTimingVerified: false,
  };
}

function intervalEvidence(pcm, plan, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw Error("INVALID_SOURCE_INTERVAL");
  const offset = plan.effectiveRange.start - plan.firstFrame / pcm.sampleRate;
  // Do not clamp invalid source ranges into apparently valid acoustic evidence.
  return pcmEvidence(
    pcm,
    Math.round((start - offset) * pcm.sampleRate),
    Math.round((end - offset) * pcm.sampleRate),
  );
}

export function auditAudioSupport(records, pcm, plan) {
  const issues = [];
  for (const r of records) {
    try {
      const evidence = intervalEvidence(pcm, plan, r.sourceStart, r.sourceEnd);
      if (evidence.allSamplesExactlyZero || evidence.longZeroRuns.length)
        issues.push({
          recordId: r.recordId,
          code: evidence.allSamplesExactlyZero
            ? "TEXT_ON_DIGITAL_ZERO"
            : "LONG_DIGITAL_ZERO_DISPLAY",
          evidence,
        });
    } catch {
      issues.push({
        recordId: r.recordId,
        code: "AUDIO_SUPPORT_RANGE_UNVERIFIED",
      });
    }
  }
  return {
    version: AUDIO_GUARD_VERSION,
    status: issues.length ? "HOLD" : "NO_DETECTED_HIGH_RISK",
    issues,
    speechPresence: "NOT_CLASSIFIED",
    acousticTimingVerified: false,
  };
}

const unreliableCodes = new Set([
  "SENTENCE_DECODER_LOOP",
  "REQUEST_SENTENCE_LOW_DIVERSITY",
  "SHORT_TOKEN_DECODER_LOOP",
  "REQUEST_LOW_DIVERSITY",
  "SINGLE_CHARACTER_DECODER_LOOP",
  "EMBEDDED_KANA_DECODER_RUN",
  "TEMPLATE_PHRASE_REQUIRES_AUDIO",
  "REPEATED_LONG_SPAN",
]);

/** Missing suspect text is reported, not a preservation obligation; lost signal still holds. */
export function assessReplacement(before, after, pcm, plan, beforeSafety) {
  const suspectIds = new Set(
    beforeSafety.issues
      .filter((i) => unreliableCodes.has(i.code))
      .flatMap((i) => i.recordIds ?? []),
  );
  const changes = [],
    issues = [];
  const sorted = after.toSorted((a, b) => a.sourceStart - b.sourceStart);
  const phrases = new Map();
  for (const r of before.filter((r) => !suspectIds.has(r.recordId))) {
    const text = normalized(r.text);
    if (!text) continue;
    if (!phrases.has(text)) phrases.set(text, []);
    phrases.get(text).push(r);
  }
  for (const [text, rows] of phrases) {
    let end = -Infinity,
      occurrences = 0;
    for (const r of rows.toSorted((a, b) => a.sourceStart - b.sourceStart)) {
      if (r.sourceStart >= end) occurrences++;
      end = Math.max(end, r.sourceEnd);
    }
    const candidateCount = sorted
      .filter((c) =>
        rows.some(
          (r) => c.sourceStart < r.sourceEnd && c.sourceEnd > r.sourceStart,
        ),
      )
      .reduce((n, c) => n + normalized(c.text).split(text).length - 1, 0);
    if (candidateCount < occurrences)
      issues.push({
        code: "OCCURRENCE_COUNT_LOSS",
        text,
        before: occurrences,
        after: candidateCount,
      });
  }
  for (const r of before) {
    const donors = sorted.filter(
      (c) => c.sourceStart < r.sourceEnd && c.sourceEnd > r.sourceStart,
    );
    const kept = normalized(donors.map((c) => c.text).join("")).includes(
      normalized(r.text),
    );
    const change = {
      recordId: r.recordId,
      beforeText: r.text,
      candidateRecordIds: donors.map((c) => c.recordId),
      candidateText: donors.map((c) => c.text),
      textStatus: kept
        ? "retained"
        : suspectIds.has(r.recordId)
          ? "risk-text-replaced"
          : "unverified-removal",
      uncoveredIntervals: [],
    };
    if (!kept && !suspectIds.has(r.recordId))
      issues.push({ code: "UNEXPLAINED_TEXT_LOSS", recordId: r.recordId });
    let cursor = r.sourceStart;
    const uncovered = [];
    for (const c of donors) {
      if (c.sourceStart > cursor)
        uncovered.push([cursor, Math.min(c.sourceStart, r.sourceEnd)]);
      cursor = Math.max(cursor, Math.min(c.sourceEnd, r.sourceEnd));
    }
    if (cursor < r.sourceEnd) uncovered.push([cursor, r.sourceEnd]);
    for (const [start, end] of uncovered) {
      // At most 10 ms export quantization slack; never a speech-based tolerance.
      if (end - start <= 0.010001) continue;
      try {
        const evidence = intervalEvidence(pcm, plan, start, end);
        change.uncoveredIntervals.push({ start, end, evidence });
        if (!evidence.allSamplesExactlyZero)
          issues.push({
            code: "UNEXPLAINED_SIGNAL_SPAN_LOSS",
            recordId: r.recordId,
            start,
            end,
          });
      } catch {
        issues.push({
          code: "COVERAGE_RANGE_UNVERIFIED",
          recordId: r.recordId,
          start,
          end,
        });
      }
    }
    changes.push(change);
  }
  const audio = auditAudioSupport(after, pcm, plan);
  issues.push(...audio.issues);
  if (!after.length) issues.push({ code: "EMPTY_REPLACEMENT" });
  return {
    version: AUDIO_GUARD_VERSION,
    status: issues.length ? "HOLD" : "NO_DETECTED_REGRESSION",
    changes,
    additions: after
      .filter(
        (c) =>
          !before.some((r) => normalized(r.text).includes(normalized(c.text))),
      )
      .map((c) => ({
        recordId: c.recordId,
        text: c.text,
        start: c.sourceStart,
        end: c.sourceEnd,
      })),
    issues,
    audio,
    speechCoverage: "NOT_VERIFIED",
    acousticCorrectness: "NOT_VERIFIED",
  };
}
