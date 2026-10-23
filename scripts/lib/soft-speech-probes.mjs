/** VAD schedules evidence acquisition; it never vetoes ASR or proves a transcript. */
import { normalizeSpeech } from "./speech-support-policy.mjs";
export const softSpeechPolicy = Object.freeze({
  version: "soft-speech-probes-v1",
  maximumTargets: 4,
  maximumRequests: 8,
  maximumRequestSeconds: 8,
  maximumTotalSeconds: 64,
  posteriorFrameSamples: 512,
  contextSeconds: 1,
  timingAgreementSeconds: 0.35,
  retries: 0,
  lowDetectorScore: "eligible-for-diagnostic-ASR; not-silence",
});
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
const finite = (n) => typeof n === "number" && Number.isFinite(n);
export function planSoftProbes(
  regions,
  analyses,
  raw,
  duration,
  audioOffset = 0,
) {
  if (
    !finite(duration) ||
    !finite(audioOffset) ||
    audioOffset < 0 ||
    duration <= audioOffset ||
    regions.length > 4 ||
    raw.length !== regions.length ||
    analyses.length !== regions.length
  )
    throw Error("SOFT_PLAN_INPUT");
  const probes = regions.map((r, i) => {
    const a = analyses[i],
      v = raw[i];
    if (
      a.regionId !== r.id ||
      v.sampleRate !== 16000 ||
      v.inputFrames !== Math.round((r.cropEnd - r.cropStart) * 16000) ||
      !Array.isArray(v.probabilities) ||
      v.probabilities.length !== Math.ceil(v.inputFrames / 512) ||
      v.probabilities.some((p) => !finite(p) || p < 0 || p > 1)
    )
      throw Error("POSTERIOR_GEOMETRY");
    const crossing = a.intervals
      .filter((s) => overlap(s.start, s.end, r.start, r.end) > 0)
      .find((s) => s.end - s.start <= 6);
    let start,
      end,
      selection,
      peak = null;
    if (crossing) {
      start = crossing.start - 1;
      end = crossing.end + 1;
      selection = "complete-crossing-activity-plus-context";
    } else {
      const max = Math.max(...v.probabilities),
        index = v.probabilities.indexOf(max);
      // A bin center locates an 8-second diagnostic window, NEVER a cue boundary.
      const center =
        r.cropStart + Math.min(v.inputFrames - 1, index * 512 + 256) / 16000;
      start = center - 4;
      end = center + 4;
      selection = "posterior-peak-without-positive-threshold";
      peak = {
        index,
        score: max,
        approximateSourceBinCenter: center,
        subtitleTimestamp: false,
      };
    }
    if (start < audioOffset) {
      end += audioOffset - start;
      start = audioOffset;
    }
    if (end > duration) {
      start = Math.max(audioOffset, start - (end - duration));
      end = duration;
    }
    start = Math.round(start * 16000) / 16000;
    end = Math.round(end * 16000) / 16000;
    return {
      id: r.id,
      regionId: r.id,
      kind: r.kind,
      regionStart: r.start,
      regionEnd: r.end,
      recordIds: r.recordIds,
      start,
      end,
      frames: Math.round((end - start) * 16000),
      selection,
      peak,
      detectorFinding: a.finding,
      fullOriginalRegionCovered: start <= r.start && end >= r.end,
    };
  });
  if (
    probes.some((r) => r.frames <= 0 || r.frames > 8 * 16000) ||
    probes.reduce((s, r) => s + 2 * r.frames, 0) > 64 * 16000
  )
    throw Error("SOFT_PROBE_BUDGET");
  return probes;
}
export function decideSoftProbe(probe, baseline, views) {
  const abstain = (reason) => ({
    targetId: probe.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
  });
  if (
    views.length !== 2 ||
    views[0].backend !== "whisper" ||
    views[1].backend !== "kotoba" ||
    views.some((v) => v.unresolvedCount > 0 || v.records.length === 0)
  )
    return abstain("TWO_VALID_NONEMPTY_BACKENDS_REQUIRED");
  const valid = (rows) =>
    rows.every(
      (r, i) =>
        typeof r.text === "string" &&
        finite(r.sourceStart) &&
        finite(r.sourceEnd) &&
        r.sourceEnd > r.sourceStart &&
        r.sourceStart >= probe.start &&
        r.sourceEnd <= probe.end &&
        (!i || r.sourceStart >= rows[i - 1].sourceEnd),
    );
  if (views.some((v) => !valid(v.records)))
    return abstain("INVALID_OR_OVERLAPPING_DONOR");
  const text = views.map((v) =>
    normalizeSpeech(v.records.map((r) => r.text).join("")),
  );
  if (!text[0] || text[0] !== text[1])
    return abstain("CROSS_MODEL_TEXT_CONFLICT");
  const bounds = views.map((v) => [
    v.records[0].sourceStart,
    v.records.at(-1).sourceEnd,
  ]);
  if (bounds.some(([s, e]) => s <= probe.start + 0.08 || e >= probe.end - 0.08))
    return abstain("DONOR_TOUCHES_CROP_EDGE");
  if (
    Math.abs(bounds[0][0] - bounds[1][0]) > 0.35 ||
    Math.abs(bounds[0][1] - bounds[1][1]) > 0.35
  )
    return abstain("CROSS_MODEL_TIMING_CONFLICT");
  const proposal = {
    targetId: probe.id,
    status: "REVIEW_CANDIDATE",
    reason: "PAIRED_TEXT_AND_TIMING_NOT_REFERENCE_VALIDATED",
    replaceIds: [],
    records: [],
    proposedRecords: views[0].records.map((r, i) => ({
      ...r,
      recordId: `soft-${probe.id}-${i}`,
      issues: [],
    })),
    acousticTimingVerified: false,
  };
  // Acquiring evidence in 8 seconds cannot authorize dropping an entire 25-second cue.
  if (probe.kind !== "subtitle-gap")
    return { ...proposal, reason: "PARTIAL_LONG_CUE_DIAGNOSTIC_ONLY" };
  const rows = proposal.proposedRecords;
  if (
    rows.some(
      (r) => r.sourceStart < probe.regionStart || r.sourceEnd > probe.regionEnd,
    )
  )
    return { ...proposal, reason: "SPEECH_CROSSES_OLD_SUBTITLE_BOUNDARY" };
  if (
    rows.some((r) =>
      baseline.some(
        (b) =>
          overlap(r.sourceStart, r.sourceEnd, b.sourceStart, b.sourceEnd) > 0,
      ),
    )
  )
    return { ...proposal, reason: "EXISTING_DIALOGUE_COLLISION" };
  return {
    ...proposal,
    status: "CANDIDATE",
    reason: "PAIRED_WHOLE_CUES_INSIDE_UNCOVERED_GAP",
    records: rows,
  };
}
export function assembleSoftProbes(baseline, decisions) {
  const insertions = decisions
    .filter((d) => d.status === "CANDIDATE")
    .flatMap((d) => d.records);
  if (!insertions.length) return baseline.map((r) => ({ ...r }));
  for (const [i, r] of insertions.entries())
    if (
      [...baseline, ...insertions.slice(0, i)].some(
        (b) =>
          overlap(r.sourceStart, r.sourceEnd, b.sourceStart, b.sourceEnd) > 0,
      )
    )
      throw Error("INSERTION_COLLISION");
  return [...baseline, ...insertions].sort(
    (a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd,
  );
}
