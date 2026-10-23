/** Reference-free planning and conservative short-utterance proposals. */
export const speechSupportPolicy = Object.freeze({
  version: "speech-support-v1",
  maximumRegions: 4,
  maximumVadSeconds: 120,
  maximumAsrRequests: 8,
  maximumAsrSeconds: 64,
  maximumCropSeconds: 8,
  longCueSeconds: 10,
  longCueMaximumCps: 1.5,
  minimumGap: 0.3,
  maximumGap: 8,
  shortSpeechMinimum: 0.15,
  shortSpeechMaximum: 3,
  contextSeconds: 1,
  timingAgreementSeconds: 0.35,
  retries: 0,
  noSpeechMeaning: "detector-negative-not-proof-of-silence",
});
export const normalizeSpeech = (s) =>
  s.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
const valid = (s, e, duration) =>
  Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s && e <= duration;
export function planSpeechRegions(rows, duration) {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    rows.some(
      (r) =>
        !valid(r.sourceStart, r.sourceEnd, duration) ||
        typeof r.text !== "string",
    )
  )
    throw Error("INVALID_BASELINE");
  const sorted = [...rows].sort(
    (a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd,
  );
  const risks = sorted
    .filter(
      (r) =>
        r.sourceEnd - r.sourceStart >= 10 &&
        r.sourceEnd - r.sourceStart <= 28 &&
        Array.from(normalizeSpeech(r.text)).length /
          (r.sourceEnd - r.sourceStart) <
          1.5,
    )
    .slice(0, 2)
    .map((r) => ({
      kind: "long-sparse-cue",
      start: r.sourceStart,
      end: r.sourceEnd,
      recordIds: [r.recordId],
    }));
  const gaps = [];
  let cursor = 0;
  for (const r of [...sorted, { sourceStart: duration, sourceEnd: duration }]) {
    if (r.sourceStart - cursor >= 0.3 && r.sourceStart - cursor <= 8)
      gaps.push({
        kind: "subtitle-gap",
        start: cursor,
        end: r.sourceStart,
        recordIds: [],
      });
    cursor = Math.max(cursor, r.sourceEnd);
  }
  return [...risks, ...gaps.slice(0, 2)].map((r, i) => ({
    ...r,
    id: `region-${i + 1}`,
    cropStart: Math.max(0, r.start - 0.5),
    cropEnd: Math.min(duration, r.end + 0.5),
  }));
}
export function planSpeechProbes(region, vad, duration) {
  if (vad.rawUnit !== "CENTISECONDS") throw Error("VAD_UNIT");
  const expectedFrames = Math.round(
    (region.cropEnd - region.cropStart) * 16000,
  );
  if (vad.inputFrames !== expectedFrames || vad.sampleRate !== 16000)
    throw Error("VAD_FRAMES");
  const localDuration = expectedFrames / 16000;
  const intervals = vad.rawIntervals.map((r) => {
    const s = r.start / 100,
      e = r.end / 100;
    if (!valid(s, e, localDuration)) throw Error("INVALID_VAD_INTERVAL");
    return { start: region.cropStart + s, end: region.cropStart + e };
  });
  if (intervals.some((r, i) => i && r.start < intervals[i - 1].end))
    throw Error("OVERLAPPING_VAD_INTERVALS");
  const inside = intervals.filter(
    (r) => overlap(r.start, r.end, region.start, region.end) > 0,
  );
  const covered = inside.reduce(
    (n, r) => n + overlap(r.start, r.end, region.start, region.end),
    0,
  );
  const short = inside.filter(
    (r) =>
      r.start >= region.start &&
      r.end <= region.end &&
      r.end - r.start >= 0.15 &&
      r.end - r.start <= 3,
  );
  const speech = short[0];
  return {
    regionId: region.id,
    intervals,
    detectorCoverage: covered / (region.end - region.start),
    finding:
      inside.length === 0
        ? "LOW_DETECTOR_SUPPORT"
        : region.kind === "subtitle-gap"
          ? "UNSUBTITLED_ACTIVITY_CANDIDATE"
          : "SPARSE_CUE_ACTIVITY_REQUIRES_TEXT_CHECK",
    // One probe per region, deterministic source order; skipped islands remain explicit.
    deferredIntervals: inside.filter((r) => r !== speech),
    probe: speech
      ? {
          id: region.id,
          regionId: region.id,
          kind: region.kind,
          recordIds: region.recordIds,
          speechStart: speech.start,
          speechEnd: speech.end,
          start: Math.max(0, speech.start - 1),
          end: Math.min(duration, speech.end + 1),
          coversAllDetectedActivity: inside.length === 1,
        }
      : null,
  };
}
export function decideSpeechProbe(probe, baseline, views) {
  const reject = (reason) => ({
    targetId: probe.id,
    status: "ABSTAIN",
    reason,
    replaceIds: [],
    records: [],
  });
  if (
    views.length !== 2 ||
    new Set(views.map((v) => v.backend)).size !== 2 ||
    !views.some((v) => v.backend === "whisper") ||
    !views.some((v) => v.backend === "kotoba")
  )
    return reject("TWO_BACKENDS_REQUIRED");
  if (views.some((v) => v.records.length !== 1 || v.unresolvedCount > 0))
    return reject("NOT_ONE_VALID_WHOLE_CUE");
  const cues = views.map((v) => v.records[0]);
  const texts = cues.map((r) => normalizeSpeech(r.text));
  if (!texts[0] || texts[0] !== texts[1] || Array.from(texts[0]).length > 20)
    return reject("TEXT_DISAGREEMENT_OR_NOT_SHORT");
  if (
    cues.some(
      (r) =>
        !valid(r.sourceStart, r.sourceEnd, probe.end) ||
        r.sourceStart < probe.start ||
        r.sourceStart <= probe.start + 0.08 ||
        r.sourceEnd >= probe.end - 0.08,
    )
  )
    return reject("UNSUPPORTED_CROP_EDGE_TIMING");
  if (
    Math.abs(cues[0].sourceStart - cues[1].sourceStart) > 0.35 ||
    Math.abs(cues[0].sourceEnd - cues[1].sourceEnd) > 0.35
  )
    return reject("TIMING_DISAGREEMENT");
  if (
    cues.some(
      (r) =>
        overlap(
          r.sourceStart,
          r.sourceEnd,
          probe.speechStart,
          probe.speechEnd,
        ) /
          (r.sourceEnd - r.sourceStart) <
        0.5,
    )
  )
    return reject("LOW_DETECTOR_OVERLAP");
  if (probe.kind === "long-sparse-cue" && !probe.coversAllDetectedActivity)
    return reject("UNEXAMINED_ACTIVITY_IN_OLD_CUE");
  const old = baseline.filter((r) => probe.recordIds.includes(r.recordId));
  if (old.length !== probe.recordIds.length)
    return reject("MISSING_OLD_RECORD");
  const c = cues[0];
  if (
    baseline.some(
      (r) =>
        !probe.recordIds.includes(r.recordId) &&
        overlap(r.sourceStart, r.sourceEnd, c.sourceStart, c.sourceEnd) > 0,
    )
  )
    return reject("NEIGHBOR_COLLISION");
  return {
    targetId: probe.id,
    status: "CANDIDATE",
    reason: "PAIRED_SHORT_TEXT_AND_TIMING_WITH_ACTIVITY_SUPPORT",
    replaceIds: probe.recordIds,
    records: [{ ...c, recordId: `speech-support-${probe.id}`, issues: [] }],
    acousticTimingVerified: false,
    qualityStatus: "needs-review",
  };
}
export function assembleSpeechProposals(baseline, decisions) {
  const accepted = decisions.filter((d) => d.status === "CANDIDATE"),
    removed = new Set();
  for (const d of accepted)
    for (const id of d.replaceIds) {
      if (removed.has(id)) throw Error("COMPETING_REPLACEMENTS");
      removed.add(id);
    }
  const inserted = accepted.flatMap((d) => d.records);
  if (
    inserted.some((r, i) =>
      inserted
        .slice(0, i)
        .some(
          (p) =>
            overlap(r.sourceStart, r.sourceEnd, p.sourceStart, p.sourceEnd) > 0,
        ),
    )
  )
    throw Error("COMPETING_INSERTIONS");
  return [
    ...baseline.filter((r) => !removed.has(r.recordId)),
    ...inserted,
  ].sort((a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd);
}
