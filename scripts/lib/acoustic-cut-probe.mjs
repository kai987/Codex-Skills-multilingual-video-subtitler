import assert from "node:assert/strict";

export const cutPolicy = Object.freeze({
  version: "local-acoustic-cut-probe-v1",
  maximumVadRequests: 1,
  maximumVadSeconds: 16,
  searchPaddingSeconds: 2,
  energyFrameSamples: 320,
  posteriorFrameSamples: 512,
  maximumQuietRmsDbfs: -40,
  maximumQuietPosterior: 0.2,
  minimumQuietSeconds: 0.16,
  cropEdgeGuardSeconds: 0.1,
  maximumAlignmentWindowSeconds: 8,
  asrRequests: 0,
  alignmentRequests: 0,
  retries: 0,
});
export function cutSearchWindow(windows, offset, end) {
  assert(
    windows.length &&
      Number.isFinite(offset) &&
      Number.isFinite(end) &&
      offset >= 0 &&
      end > offset,
  );
  for (const w of windows)
    assert(
      Number.isFinite(w.start) &&
        Number.isFinite(w.end) &&
        w.start >= offset &&
        w.end <= end &&
        w.end > w.start,
    );
  const start =
    Math.round(
      Math.max(offset, Math.min(...windows.map((w) => w.start)) - 2) * 16000,
    ) / 16000;
  const stop =
    Math.round(
      Math.min(end, Math.max(...windows.map((w) => w.end)) + 2) * 16000,
    ) / 16000;
  const frames = Math.round((stop - start) * 16000);
  assert(
    frames > 0 && frames <= cutPolicy.maximumVadSeconds * 16000,
    "SEARCH_BUDGET_EXCEEDED",
  );
  return { start, end: stop, frames };
}
export function inspectCuts(pcm, raw, window, targets, baseline) {
  assert(
    pcm.sampleRate === 16000 &&
      pcm.frames === window.frames &&
      pcm.data.length === pcm.frames * 2,
    "PCM_GEOMETRY",
  );
  assert(
    raw.sampleRate === 16000 &&
      raw.inputFrames === pcm.frames &&
      raw.rawUnit === "CENTISECONDS",
    "VAD_GEOMETRY",
  );
  assert(
    Array.isArray(raw.probabilities) &&
      raw.probabilities.length === Math.ceil(pcm.frames / 512) &&
      raw.probabilities.every((p) => Number.isFinite(p) && p >= 0 && p <= 1),
    "POSTERIOR_GEOMETRY",
  );
  assert(
    targets.length &&
      targets.every(
        (r) =>
          Number.isFinite(r.sourceStart) &&
          Number.isFinite(r.sourceEnd) &&
          r.sourceEnd > r.sourceStart &&
          r.sourceStart >= window.start &&
          r.sourceEnd <= window.end,
      ),
    "TARGET_OUTSIDE_SEARCH",
  );
  const activity = raw.rawIntervals.map((r) => {
    assert(
      Number.isFinite(r.start) &&
        Number.isFinite(r.end) &&
        r.start >= 0 &&
        r.end > r.start &&
        r.end / 100 <= pcm.frames / 16000 + 0.01,
      "INVALID_VAD_INTERVAL",
    );
    return {
      start: window.start + r.start / 100,
      end: window.start + r.end / 100,
    };
  });
  const frames = [];
  for (let begin = 0; begin < pcm.frames; begin += 320) {
    const stop = Math.min(pcm.frames, begin + 320);
    let energy = 0;
    for (let i = begin; i < stop; i++)
      energy += (pcm.data.readInt16LE(i * 2) / 32768) ** 2;
    const rmsDbfs = Math.max(
      -120,
      10 * Math.log10(Math.max(1e-12, energy / (stop - begin))),
    );
    const posteriorMax = Math.max(
      ...raw.probabilities.slice(
        Math.floor(begin / 512),
        Math.ceil(stop / 512),
      ),
    );
    frames.push({
      start: window.start + begin / 16000,
      end: window.start + stop / 16000,
      rmsDbfs,
      posteriorMax,
      quiet: rmsDbfs <= -40 && posteriorMax <= 0.2,
    });
  }
  const spans = [];
  for (const f of frames) {
    if (!f.quiet) continue;
    const last = spans.at(-1);
    if (last && Math.abs(last.end - f.start) < 1e-8) {
      last.end = f.end;
      last.maximumRmsDbfs = Math.max(last.maximumRmsDbfs, f.rmsDbfs);
      last.maximumPosterior = Math.max(last.maximumPosterior, f.posteriorMax);
    } else
      spans.push({
        start: f.start,
        end: f.end,
        maximumRmsDbfs: f.rmsDbfs,
        maximumPosterior: f.posteriorMax,
      });
  }
  const quietSpans = spans
    .filter((s) => s.end - s.start >= 0.16 - 1e-8)
    .map((s) => {
      const cut = Math.round(((s.start + s.end) / 2) * 16000) / 16000;
      const edge = s.start < window.start + 0.1 || s.end > window.end - 0.1;
      return {
        ...s,
        cut,
        cropEdgeLimited: edge,
        crossingMachineRecordIds: baseline
          .filter((r) => r.sourceStart < cut && r.sourceEnd > cut)
          .map((r) => r.recordId),
        // Silence between syllables or weak speech can satisfy this test too.
        verifiedUtteranceBoundary: false,
      };
    });
  const start = Math.min(...targets.map((r) => r.sourceStart));
  const end = Math.max(...targets.map((r) => r.sourceEnd));
  const left =
    quietSpans.filter((s) => !s.cropEdgeLimited && s.end <= start).at(-1) ??
    null;
  const right =
    quietSpans.find((s) => !s.cropEdgeLimited && s.start >= end) ?? null;
  const pair =
    left && right
      ? {
          start: left.cut,
          end: right.cut,
          seconds: right.cut - left.cut,
          withinAlignmentBudget: right.cut - left.cut <= 8,
          crossingMachineRecordIds: [
            ...new Set([
              ...left.crossingMachineRecordIds,
              ...right.crossingMachineRecordIds,
            ]),
          ],
        }
      : null;
  return {
    policy: cutPolicy,
    activity,
    frames,
    quietSpans,
    left,
    right,
    pair,
    status: pair ? "ACOUSTIC_CUT_CANDIDATE_ONLY" : "NO_TWO_SIDED_CUT_SUPPORT",
    modelDispatchAllowed: false,
    subtitleMutationAuthorized: false,
    note: "Low energy plus low VAD is a candidate cut, not silence truth or a verified sentence boundary. No timing writeback.",
  };
}
